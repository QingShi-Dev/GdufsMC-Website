# Native tccli contract tests in private fixtures; never contacts Tencent Cloud.
# The child process uses the same PowerShell engine as this test entry point.
$ErrorActionPreference = 'Stop'
$previousRepo = $env:CONTENT_PURGE_TEST_REPO
$previousShell = $env:CONTENT_PURGE_TEST_SHELL
$oldEncoding = $OutputEncoding
try {
    $env:CONTENT_PURGE_TEST_REPO = Split-Path -Parent $PSScriptRoot
    $env:CONTENT_PURGE_TEST_SHELL = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const repo = process.env.CONTENT_PURGE_TEST_REPO;
const powershell = process.env.CONTENT_PURGE_TEST_SHELL;
const nodePath = fs.realpathSync(process.execPath);
const environment = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', '[pscustomobject]@{ identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name; version = $PSVersionTable.PSVersion.ToString() } | ConvertTo-Json -Compress'], {encoding:'utf8',windowsHide:true,timeout:15000});
assert.ifError(environment.error);
assert.equal(environment.status, 0, environment.stderr);
const {identity, version} = JSON.parse(environment.stdout.trim());
assert.ok(identity);
console.log('PowerShell ' + version + ': native purge adapter tests');
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'content-purge-test-'));
let tests = 0, failures = 0;
const jobId = 'job-ABC_123';
const warning = 'PRIVATE_TCCLI_STDERR_CANARY';
const write = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file,value); };
const json = (file, value) => write(file, JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));

function fixture(name, mode = {}) {
  const root = path.join(parent, name + ' path with spaces');
  const tools = path.join(root, 'content-tools');
  fs.mkdirSync(path.join(root,'shared'), {recursive:true});
  fs.mkdirSync(path.join(tools,'deploy'), {recursive:true});
  for (const file of ['invoke-content-purge.ps1','content-operations.ps1']) {
    fs.copyFileSync(path.join(repo,'deploy',file),path.join(tools,'deploy',file));
  }
  // Bypass elevation only in the private fixture. Keep real identity and path checks.
  fs.appendFileSync(path.join(tools,'deploy/content-operations.ps1'), '\nfunction Assert-ContentAdministrator { }\n');
  const executable = path.join(tools,'mock tccli.cmd');
  write(executable, '@echo off\r\n"' + nodePath + '" "%~dp0mock-tccli.mjs" %*\r\n');
  write(path.join(tools,'mock-tccli.mjs'), `import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const tools=path.dirname(fileURLToPath(import.meta.url)), root=path.dirname(tools);
const args=process.argv.slice(2), mode=JSON.parse(fs.readFileSync(path.join(root,'mode.json'),'utf8'));
assert.equal(args.length,10);assert.equal(args[0],'teo');
assert.ok(['CreatePurgeTask','DescribePurgeTasks'].includes(args[1]));
assert.deepEqual(args.slice(2).filter((_,i)=>i%2===0),['--cli-input-json','--version','--region','--timeout']);
assert.equal(args[5],'2022-09-01');assert.equal(args[7],'ap-guangzhou');assert.equal(args[9],'30');
assert.ok(args[3].startsWith('file://'));const requestPath=args[3].slice(7);
assert.equal(path.dirname(requestPath),path.join(root,'shared'));
assert.match(path.basename(requestPath),/^purge-request-[a-f0-9]{32}\\.json$/);
const request=JSON.parse(fs.readFileSync(requestPath,'utf8').replace(/^\\uFEFF/,''));
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify({args,requestPath,request})+'\\n');
if(mode.warning)console.error('${warning}');
if(mode.raw!==undefined)process.stdout.write(mode.raw);
else {const response=mode.response??(args[1]==='CreatePurgeTask'?{JobId:'${jobId}'}:{Tasks:[],TotalCount:0});console.log(JSON.stringify(mode.wrapped?{Response:response}:response));}
process.exit(mode.exit??0);
`);
  json(path.join(root,'mode.json'),mode);
  const config = path.join(tools,'config.json');
  json(config,{version:1,root,expectedUser:identity,tccliPath:executable,zoneId:'zone-test123',region:'ap-guangzhou'});
  return {root,tools,config};
}

function calls(f) {
  const file = path.join(f.root,'calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}

function invoke(f, action = 'Create', id = undefined) {
  const args = ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(f.tools,'deploy/invoke-content-purge.ps1'),'-Config',f.config,'-Action',action];
  if (id !== undefined) args.push('-JobId',id);
  const result = spawnSync(powershell,args,{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.ifError(result.error);
  assert.equal(result.signal,null);
  assert.ok(!result.stdout.includes(warning),'private native stderr leaked to stdout');
  assert.ok(!result.stderr.includes(warning),'private native stderr leaked to stderr');
  assert.deepEqual(fs.readdirSync(path.join(f.root,'shared')),[],'request/stderr temporary files must be cleaned after success or failure');
  return result;
}

function success(result) {
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  return JSON.parse(result.stdout.trim());
}
function rejected(result, message) {
  assert.notEqual(result.status,0,'adapter must return failure');
  assert.equal(result.stdout.trim(),'','failure must not produce a success payload');
  assert.match(result.stderr,message);
}
function test(name, run) {
  tests++;
  try { run(); console.log('PASS '+name); }
  catch (error) { failures++; console.error('FAIL '+name+'\n'+error.stack); }
}

test('Create uses file input, fixed API version and purge_all with native stderr isolated',()=>{
  const f=fixture('create',{warning:true});
  assert.deepEqual(success(invoke(f)),{jobId});
  assert.equal(calls(f).length,1);
  assert.deepEqual(calls(f)[0].request,{ZoneId:'zone-test123',Type:'purge_all'});
  assert.equal(calls(f)[0].args[1],'CreatePurgeTask');
  assert.ok(calls(f)[0].requestPath.includes('path with spaces'));
});

test('Create supports the Response wrapper',()=>{
  const f=fixture('create wrapped',{wrapped:true});
  assert.deepEqual(success(invoke(f)),{jobId});
});

for (const wrapped of [false,true]) {
  test('Describe filters job-id with Limit 1000 and returns only matching tasks (wrapped='+wrapped+')',()=>{
    const f=fixture('describe '+wrapped,{wrapped,warning:true,response:{Tasks:[{JobId:'other-job',Status:'failed'},{JobId:jobId,Status:'processing'},{JobId:jobId,Status:'success'}],TotalCount:3}});
    assert.deepEqual(success(invoke(f,'Describe',jobId)),{jobId,statuses:['processing','success'],totalCount:3});
    assert.equal(calls(f).length,1);
    assert.deepEqual(calls(f)[0].request,{ZoneId:'zone-test123',Filters:[{Name:'job-id',Values:[jobId]}],Limit:1000});
    assert.equal(calls(f)[0].args[1],'DescribePurgeTasks');
  });
}

for (const count of [0,1]) {
  test('Describe preserves a JSON array for '+count+' matching task(s)',()=>{
    const f=fixture('describe count '+count,{response:{Tasks:count?[{JobId:jobId,Status:'success'}]:[],TotalCount:count}});
    assert.deepEqual(success(invoke(f,'Describe',jobId)),{jobId,statuses:count?['success']:[],totalCount:count});
  });
}

test('nonzero native exit rejects even a valid success body and keeps stderr private',()=>{
  const f=fixture('native exit',{warning:true,exit:9});
  rejected(invoke(f),/failed \(exit 9\)/);
  assert.equal(calls(f).length,1);
});

test('invalid JSON stdout rejects',()=>{
  const f=fixture('invalid json',{warning:true,raw:'not-json'});
  rejected(invoke(f),/returned invalid JSON/);
});

for (const wrapped of [false,true]) {
  test('API error rejects (wrapped='+wrapped+')',()=>{
    const f=fixture('api error '+wrapped,{wrapped,response:{Error:{Code:'AuthFailure',Message:'PRIVATE_API_MESSAGE'},JobId:jobId}});
    const result=invoke(f);
    rejected(result,/returned an API error/);
    assert.ok(!result.stderr.includes('PRIVATE_API_MESSAGE'));
  });
}

for (const [name,value] of [['missing',undefined],['empty',''],['slash','job/123'],['shell punctuation','job;whoami'],['overlong','a'.repeat(129)],['trailing newline','job\n']]) {
  test('Describe rejects '+name+' job ID before native invocation',()=>{
    const f=fixture('invalid request '+name);
    rejected(invoke(f,'Describe',value),/Invalid purge job id/);
    assert.deepEqual(calls(f),[]);
  });
}

for (const [name,value] of [['missing',undefined],['slash','job/123'],['overlong','a'.repeat(129)],['trailing newline','job\n']]) {
  test('Create rejects '+name+' response JobId',()=>{
    const f=fixture('invalid response '+name,{response:value===undefined?{}:{JobId:value}});
    rejected(invoke(f),/no valid JobId/);
    assert.equal(calls(f).length,1);
  });
}

console.log((tests-failures)+'/'+tests+' purge adapter tests passed on PowerShell '+version);
if (failures) {
  console.error('Preserved private fixtures for diagnosis: '+parent);
  process.exitCode=1;
} else {
  const resolved=fs.realpathSync(parent), expected=fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(resolved).toLowerCase(),expected.toLowerCase());
  assert.ok(path.basename(resolved).startsWith('content-purge-test-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
'@ | node --input-type=module
    if ($LASTEXITCODE -ne 0) { throw 'Content purge tests failed.' }
} finally {
    $OutputEncoding = $oldEncoding
    $env:CONTENT_PURGE_TEST_REPO = $previousRepo
    $env:CONTENT_PURGE_TEST_SHELL = $previousShell
}
