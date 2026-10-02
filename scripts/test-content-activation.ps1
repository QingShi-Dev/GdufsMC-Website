# Isolated PM2/worker mocks; never contacts or controls a real service.
$ErrorActionPreference = 'Stop'
$env:CONTENT_ACTIVATION_TEST_REPO = Split-Path -Parent $PSScriptRoot
$oldEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const repo = process.env.CONTENT_ACTIVATION_TEST_REPO;
const nodePath = fs.realpathSync(process.execPath);
const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'content-activation-test-'));
const code = 'a'.repeat(40), content = 'b'.repeat(40), previous = 'd'.repeat(40);
const operation = content + '-123-1';
const identity = spawnSync(powershell, ['-NoProfile', '-Command', '[Security.Principal.WindowsIdentity]::GetCurrent().Name'], {encoding:'utf8', windowsHide:true}).stdout.trim();
let failures = 0, tests = 0;
const write = (file, value) => { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,value); };
const json = (file, value) => write(file,JSON.stringify(value));
const read = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function fixture(name) {
  const root = path.join(parent,name), tools = path.join(root,'content-tools');
  for(const dir of ['deploy','scripts']) fs.mkdirSync(path.join(tools,dir),{recursive:true});
  for(const file of ['activate-content.ps1','process-content-queue.ps1','content-operations.ps1']) fs.copyFileSync(path.join(repo,'deploy',file),path.join(tools,'deploy',file));
  // Bypass elevation only in this private fixture; retain all filesystem helpers.
  fs.appendFileSync(path.join(tools,'deploy/content-operations.ps1'), `
function Assert-ContentAdministrator { }
$script:OriginalContentWrite = \${function:Write-ContentJsonAtomic}
function Write-ContentJsonAtomic {
 param([string]$Path,$Value)
 if ($Path.EndsWith('content-state.json') -and $Value.contentCommit -eq '${content}' -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent (Split-Path -Parent $Path)) 'fail-state-write'))) { throw 'Injected state write failure' }
 if ($Path.EndsWith('current.json') -and $Value.contentCommit -eq '${content}' -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $Path))) 'fail-projection-write'))) { throw 'Injected projection write failure' }
 & $script:OriginalContentWrite -Path $Path -Value $Value
}
$script:OriginalContentSwap = \${function:Invoke-ContentDirectorySwap}
function Invoke-ContentDirectorySwap {
 param([string]$Root,[string]$CandidateContent,[string]$OperationId)
 $result = & $script:OriginalContentSwap -Root $Root -CandidateContent $CandidateContent -OperationId $OperationId
 if (Test-Path -LiteralPath (Join-Path $Root 'fail-after-swap')) { throw 'Injected failure after filesystem swap' }
 return $result
}
$script:OriginalContentRestore = \${function:Restore-ContentDirectorySwap}
function Restore-ContentDirectorySwap {
 param([string]$Root,[string]$BackupPath,[string]$OperationId)
 if (Test-Path -LiteralPath (Join-Path $Root 'fail-restore')) { throw 'Injected restore failure' }
 & $script:OriginalContentRestore -Root $Root -BackupPath $BackupPath -OperationId $OperationId
}
`);
  for(const dir of ['shared','coordination/queue','coordination/results','coordination/code','coordination/staging','pm2-home','releases/release-1']) fs.mkdirSync(path.join(root,dir),{recursive:true});
  write(path.join(root,'content/news/live.txt'),'OLD');
  const candidate = path.join(root,'coordination/staging/download-'+operation);
  write(path.join(candidate,'content/news/live.txt'),'NEW');
  const release = path.join(root,'releases/release-1'), executable = path.join(release,'server.js');
  write(executable,'// fixture');
  json(path.join(root,'shared/deployment-state.json'),{current:{id:'release-1',commit:code,releasePath:release,execPath:executable}});
  const oldState={version:1,codeCommit:code,contentCommit:previous,purge:{status:'complete'}};
  const oldProjection={version:1,commit:code,releaseId:'release-1',contentCommit:previous};
  json(path.join(root,'shared/content-state.json'),oldState);
  json(path.join(root,'coordination/code/current.json'),oldProjection);
  json(path.join(tools,'mock-pm2-state.json'),[{name:'gdufsmc',pid:123,pm2_env:{status:'online',pm_cwd:release,pm_exec_path:executable,CONTENT_ROOT:root,username:'RAW_ENV_CANARY',USERNAME:'RAW_ENV_CANARY'}}]);
  write(path.join(tools,'mock-pm2.mjs'), `import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const tools=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(tools),state=path.join(tools,'mock-pm2-state.json');
const cmd=process.argv[2],apps=JSON.parse(fs.readFileSync(state,'utf8'));fs.appendFileSync(path.join(root,'pm2-actions.log'),cmd+'\\n');
if(fs.existsSync(path.join(root,'native-warnings')))console.error('Harmless mock native warning');
if(cmd==='jlist'){console.log(JSON.stringify(apps));process.exit(0)}
if(cmd==='stop'){apps[0].pid=fs.existsSync(path.join(root,'fail-stop'))?321:0;apps[0].pm2_env.status='stopped'}
else if(cmd==='restart'){const marker=path.join(root,'fail-restart-once');if(fs.existsSync(marker)){fs.unlinkSync(marker);process.exit(9)}apps[0].pid=123;apps[0].pm2_env.status='online'}
else process.exit(8);fs.writeFileSync(state,JSON.stringify(apps));`);
  write(path.join(tools,'mock-pm2.cmd'),'@echo off\r\n"'+nodePath+'" "%~dp0mock-pm2.mjs" %*\r\n');
  write(path.join(tools,'scripts/content-sync.mjs'), `import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');const command=process.argv[2],args=process.argv.slice(3),arg=name=>args[args.indexOf(name)+1];
if(fs.existsSync(path.join(root,'native-warnings')))console.error('Harmless mock native warning');
if(command==='verify-candidate'){if(fs.existsSync(path.join(root,'fail-verify')))process.exit(6)}
else if(command==='health'){if(fs.existsSync(path.join(root,'fail-health'))&&path.resolve(arg('--parent'))!==root)process.exit(7)}
else if(command==='process-request'){const id=arg('--request-id'),request=JSON.parse(fs.readFileSync(path.join(root,'coordination/queue',id+'.json'),'utf8'));if(request.fail)process.exit(8);fs.writeFileSync(path.join(root,'coordination/results',id+'.json'),JSON.stringify({version:1,requestId:id,status:request.resultFailed?'failed':'succeeded',message:request.resultFailed?'Preserve detailed worker error':undefined}))}
else process.exit(9);`);
  const config=path.join(tools,'config.json');
  json(config,{version:1,root,nodePath,pm2Path:path.join(tools,'mock-pm2.cmd'),pm2Home:path.join(root,'pm2-home'),expectedUser:identity});
  return {root,tools,candidate,config,oldState,oldProjection};
}
function invoke(f, file='activate-content.ps1') {
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(f.tools,'deploy',file),'-Config',f.config];
  if(file==='activate-content.ps1')args.push('-CandidateParent',f.candidate,'-OperationId',operation,'-ContentCommit',content,'-CodeCommit',code,'-ReleaseId','release-1');
  const result=spawnSync(powershell,args,{encoding:'utf8',windowsHide:true,timeout:90000,env:{...process.env,PM2_HOME:path.join(f.root,'pm2-home')}});
  assert.ifError(result.error);assert.equal(result.signal,null);assert.ok(!result.stdout.includes('RAW_ENV_CANARY'));assert.ok(!result.stderr.includes('RAW_ENV_CANARY'));
  try{return {...result,json:JSON.parse(result.stdout.trim())}}catch{throw new Error('Non-JSON stdout: '+result.stdout+'\n'+result.stderr)}
}
function assertOld(f, purgePending=false) {
  assert.equal(fs.readFileSync(path.join(f.root,'content/news/live.txt'),'utf8'),'OLD');
  const state=read(path.join(f.root,'shared/content-state.json'));
  if(purgePending){
    assert.equal(state.purge.status,'pending');assert.equal(state.purge.jobId,undefined);assert.ok(Number.isFinite(Date.parse(state.purge.updatedAt)));
    const {purge,updatedAt,...rest}=state;const {purge:oldPurge,...oldRest}=f.oldState;assert.deepEqual(rest,oldRest);
  } else assert.deepEqual(state,f.oldState);
  assert.deepEqual(read(path.join(f.root,'coordination/code/current.json')),f.oldProjection);
  assert.equal(read(path.join(f.tools,'mock-pm2-state.json'))[0].pm2_env.status,'online');
}
function test(name, run) {tests++;try{run();console.log('PASS '+name)}catch(error){failures++;console.error('FAIL '+name+'\n'+error.stack)}}

test('success stops the existing app, preserves backup and commits state',()=>{
 const f=fixture('success'),r=invoke(f);assert.equal(r.status,0,r.stderr);assert.equal(r.json.success,true);
 assert.equal(fs.readFileSync(path.join(f.root,'content/news/live.txt'),'utf8'),'NEW');
 assert.equal(fs.readFileSync(path.join(r.json.backupPath,'news/live.txt'),'utf8'),'OLD');
 assert.equal(read(path.join(f.root,'shared/content-state.json')).previousContentCommit,previous);
 assert.equal(read(path.join(f.root,'shared/content-state.json')).purge.status,'pending');
 assert.equal(read(path.join(f.root,'coordination/code/current.json')).contentCommit,content);
 assert.equal(read(path.join(f.root,'shared/content-journal.json')).completed,true);
 assert.equal(read(path.join(f.tools,'mock-pm2-state.json'))[0].pm2_env.status,'online');
});
test('native stderr warnings with exit zero do not trigger rollback or queue failure',()=>{
 const f=fixture('native-warnings');write(path.join(f.root,'native-warnings'),'1');const r=invoke(f);assert.equal(r.status,0,r.stderr);assert.equal(r.json.success,true);
 json(path.join(f.root,'coordination/queue',operation+'.json'),{});const q=invoke(f,'process-content-queue.ps1');assert.equal(q.status,0,q.stderr);assert.equal(q.json.failed,0);
});
for(const marker of ['fail-health','fail-after-swap','fail-restart-once','fail-state-write','fail-projection-write'])test(marker+' rolls back content and both state files',()=>{
 const f=fixture(marker);write(path.join(f.root,marker),'1');const r=invoke(f);assert.equal(r.status,1);assert.equal(r.json.critical,false,r.stderr);assertOld(f,true);
 assert.equal(read(path.join(f.root,'shared/content-journal.json')).phase,'rolled-back');
 assert.equal(fs.readFileSync(path.join(f.root,'content-failed',operation,'content/news/live.txt'),'utf8'),'NEW');
});
test('candidate verification failure never stops the app',()=>{
 const f=fixture('verify');write(path.join(f.root,'fail-verify'),'1');const r=invoke(f);assert.equal(r.status,1);assertOld(f);
 assert.ok(!fs.existsSync(path.join(f.root,'shared/content-journal.json')));assert.ok(!fs.readFileSync(path.join(f.root,'pm2-actions.log'),'utf8').includes('stop'));
});
test('runtime CONTENT_ROOT drift is rejected before stopping PM2',()=>{
 const f=fixture('root-drift'),state=path.join(f.tools,'mock-pm2-state.json'),apps=read(state);apps[0].pm2_env.CONTENT_ROOT=path.join(f.root,'wrong');json(state,apps);
 const r=invoke(f);assert.equal(r.status,1);assert.match(r.json.message,/CONTENT_ROOT/);assertOld(f);assert.ok(!fs.readFileSync(path.join(f.root,'pm2-actions.log'),'utf8').includes('stop'));
});
test('rollback restores the absence of an initial content-state file',()=>{
 const f=fixture('initial-state');fs.unlinkSync(path.join(f.root,'shared/content-state.json'));write(path.join(f.root,'fail-projection-write'),'1');const r=invoke(f);
 assert.equal(r.status,1);assert.equal(r.json.critical,false,r.stderr);assert.ok(!fs.existsSync(path.join(f.root,'shared/content-state.json')));
 assert.equal(fs.readFileSync(path.join(f.root,'content/news/live.txt'),'utf8'),'OLD');assert.deepEqual(read(path.join(f.root,'coordination/code/current.json')),f.oldProjection);
 assert.equal(read(path.join(f.root,'shared','content-state.failed-'+operation+'.json')).contentCommit,content);
});
test('unfinished journal refuses new work with recovery guidance',()=>{
 const f=fixture('journal');json(path.join(f.root,'shared/content-journal.json'),{completed:false,phase:'swapping'});const r=invoke(f);
 assert.equal(r.status,1);assert.match(r.json.message,/Administrator recovery/);assertOld(f);assert.ok(!fs.existsSync(path.join(f.root,'pm2-actions.log')));
});
test('reused operation id never consumes a historical backup',()=>{
 const f=fixture('duplicate');write(path.join(f.root,'content-backups',operation,'content/retained.txt'),'KEEP');const r=invoke(f);
 assert.equal(r.status,1);assertOld(f);assert.equal(fs.readFileSync(path.join(f.root,'content-backups',operation,'content/retained.txt'),'utf8'),'KEEP');assert.ok(!fs.readFileSync(path.join(f.root,'pm2-actions.log'),'utf8').includes('stop'));
});
test('recovery failure remains critical and journal stays unfinished',()=>{
 const f=fixture('critical');write(path.join(f.root,'fail-health'),'1');write(path.join(f.root,'fail-restore'),'1');const r=invoke(f);
 assert.equal(r.status,1);assert.equal(r.json.critical,true);assert.equal(read(path.join(f.root,'shared/content-journal.json')).completed,false);
 assert.equal(fs.readFileSync(path.join(f.root,'content-backups',operation,'content/news/live.txt'),'utf8'),'OLD');
});
test('queue processes at most ten requests and skips completed results',()=>{
 const f=fixture('queue');for(let i=1;i<=12;i++)json(path.join(f.root,'coordination/queue',content+'-'+i+'-1.json'),{});
 const r=invoke(f,'process-content-queue.ps1');assert.equal(r.status,0,r.stderr);assert.equal(r.json.processed,10);assert.equal(fs.readdirSync(path.join(f.root,'coordination/results')).length,10);
 const next=invoke(f,'process-content-queue.ps1');assert.equal(next.status,0,next.stderr);assert.equal(next.json.processed,2);
});
test('queue records oversized requests and worker nonzero exits',()=>{
 const f=fixture('queue-errors');json(path.join(f.root,'coordination/queue',operation+'.json'),{fail:true});write(path.join(f.root,'coordination/queue',content+'-124-1.json'),'x'.repeat(4097));
 const r=invoke(f,'process-content-queue.ps1');assert.equal(r.status,1);assert.equal(r.json.failed,2);assert.equal(read(path.join(f.root,'coordination/results',operation+'.json')).status,'failed');
 assert.match(read(path.join(f.root,'coordination/results',content+'-124-1.json')).message,/4096/);
});
test('queue marks a worker-written failed result as a failed task',()=>{
 const f=fixture('queue-result-failed');json(path.join(f.root,'coordination/queue',operation+'.json'),{resultFailed:true});const r=invoke(f,'process-content-queue.ps1');
 assert.equal(r.status,1);assert.equal(r.json.failed,1);assert.equal(read(path.join(f.root,'coordination/results',operation+'.json')).message,'Preserve detailed worker error');
});
console.log(`${tests-failures}/${tests} content activation/queue tests passed.`);
if(failures){console.error('Preserved fixtures: '+parent);process.exitCode=1}
else{
 const absolute=path.resolve(parent),temp=path.resolve(os.tmpdir()),rel=path.relative(temp,absolute);
 assert.ok(!path.isAbsolute(rel)&&!rel.startsWith('..')&&!rel.includes(path.sep)&&rel.startsWith('content-activation-test-'));
 fs.rmSync(absolute,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
'@ | node --input-type=module
    if ($LASTEXITCODE -ne 0) { throw 'Content activation mock tests failed.' }
} finally {
    $OutputEncoding = $oldEncoding
}
