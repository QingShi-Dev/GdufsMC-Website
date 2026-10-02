<#
.SYNOPSIS
    Safe manual publish / rollback for the GDUFSMC web app on Windows (PowerShell 5.1).
.DESCRIPTION
    Deploy mode (ReleaseDirectory required): validates a trusted, pre-extracted release
    artifact, copies it (never moves) into <Root>/releases/<id>, pre-checks it via a
    direct Node child process on a random loopback port, then switches the single PM2
    app "gdufsmc" to the new version. Rollback mode (-Rollback) safely switches back to
    the previously recorded deployment.

    IMPORTANT (non-atomic switch): the switch is performed with `pm2 stop` + `pm2 delete`
    + `pm2 start`. This is NOT an atomic operation. If the new app fails health, the
    script automatically reverts to the previous app. The deployment-state.json file
    uses temporary-file replacement under the shared lock. There is no cross-file
    filesystem transaction; failures are recovered with the maintenance journal.

    SECURITY MODEL (all enforced before any mutation):
      * Must run as Administrator and as the ExpectedUser (default WINSERVER08\Administrator).
      * PM2_HOME must equal $env:USERPROFILE\.pm2; a mismatched value is rejected (never
        silently swapped, which would control the wrong daemon).
      * The Node exe at NodePath must report EXACTLY manifest.nodeVersion (the leading "v"
        is stripped before comparison), and the manifest must declare platform=win32 arch=x64.
      * release.json id is restricted to [a-z0-9-]; commit is exactly 40 hex; server.js,
        .next/BUILD_ID and public/__release.json must exist and agree on the buildId marker.
      * The new target <Root>/releases/<id> must not already exist; copy is used (source kept).
      * No reparse points anywhere in the source tree, nor on the Root/shared/releases
        ancestor directories. Recursive source/target relationships are blocked.
      * PM2 operations use an explicit pm2 path; exactly one app named "gdufsmc" may exist,
        so other PM2 apps are never touched. `pm2 jlist` JSON is parsed in-memory only and
        never logged or printed (it can contain secrets).

    The live PM2 app is captured as the rollback baseline. On first run the live app is
    treated as "legacy" (e.g. the existing next start) and its config is stored privately
    under <Root>/shared (with a unique GUID name so state.previous is never corrupted) for
    rollback; the legacy ecosystem/source is never modified.

    State is stored in <Root>/shared/deployment-state.json, protected by a
    separate exclusive lock file <Root>/shared/deployment.lock (FileShare.None). Only
    `current` and `previous` are retained. Two successful versions are kept; the
    superseded (two-versions-old) release under <Root>/releases is removed only after a
    successful switch and ONLY when it passes strict guards (direct child, valid manifest
    whose id matches the folder name, no reparse points in the whole tree). A FAILED
    candidate release is intentionally RETAINED for diagnosis and is never auto-deleted
    (documented; operator removes it after triage).

    This script does NOT: auto-install, register services, modify startup/caddy, delete the
    old root, touch incoming artifacts, or run any network install. The SHA/trust of the
    incoming tarball is verified externally by the operator (documented, not in this script).
.PARAMETER ReleaseDirectory
    Required for deploy mode. Path to a fresh, fully extracted, operator-trusted release
    directory (e.g. incoming/<id>). Its release.json is the manifest.
.PARAMETER Rollback
    Switch to rollback mode. No ReleaseDirectory is required.
.PARAMETER Root
    Deployment root. Default H:/GDUFSMC-web.
.PARAMETER NodePath
    Node executable. Default C:/Program Files/nodejs/node.exe.
.PARAMETER Pm2Path
    PM2 launcher. Default C:/npm/pm2.cmd.
.PARAMETER ExpectedUser
    Required identity "DOMAIN\user". Default WINSERVER08\Administrator.
.PARAMETER SyntaxCheck
    Parse this script with the PowerShell parser and exit. Performs NO real publish and
    writes NO files (not even directories / lock files).
#>

[CmdletBinding(DefaultParameterSetName = 'Deploy')]
param(
    [Parameter(ParameterSetName = 'Deploy', Mandatory = $true)]
    [string]$ReleaseDirectory,

    [Parameter(ParameterSetName = 'Rollback')]
    [switch]$Rollback,

    [string]$Root = 'H:/GDUFSMC-web',
    [string]$NodePath = 'C:/Program Files/nodejs/node.exe',
    [string]$Pm2Path = 'C:/npm/pm2.cmd',
    [string]$ExpectedUser = 'WINSERVER08\Administrator',

    [Parameter(ParameterSetName = 'SyntaxCheck')]
    [switch]$SyntaxCheck
)

$ErrorActionPreference = 'Stop'

# ===========================================================================
# 0. SYNTAX CHECK FIRST -- absolutely no file writes (no mkdir, no lock, no log)
# ===========================================================================
if ($SyntaxCheck) {
    $tokens = $null
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile(
        $MyInvocation.MyCommand.Path, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) {
        foreach ($e in $errors) { Write-Error "Line $($e.Extent.StartLineNumber): $($e.Message)" }
        exit 1
    }
    Write-Host "Syntax OK: no parse errors."
    exit 0
}

. (Join-Path $PSScriptRoot 'content-operations.ps1')

# Normalize Root to a full, backslash-separated, normalized path.
$Root = [System.IO.Path]::GetFullPath($Root).Replace('/', '\').TrimEnd('\')

# ===========================================================================
# 1. IDENTITY CHECKS -- read-only, no file writes. Must run before any mkdir.
# ===========================================================================
function Assert-Administrator {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object System.Security.Principal.WindowsPrincipal($id)
    if (-not $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Current process is not running as Administrator. Refusing.'
    }
}

function Assert-ExpectedUser {
    $curName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    if ($curName -notmatch ('^' + [System.Text.RegularExpressions.Regex]::Escape($ExpectedUser) + '$')) {
        throw "Current user '$curName' does not match ExpectedUser '$ExpectedUser'. Refusing."
    }
}

function Assert-Pm2Home {
    $expected = Join-Path $env:USERPROFILE '.pm2'
    if ($env:PM2_HOME) {
        if ($env:PM2_HOME -ne $expected) {
            throw "PM2_HOME='$($env:PM2_HOME)' but must be '$expected'. Refusing to silently switch daemon home."
        }
    } else {
        Write-Host "PM2_HOME not set; setting to $expected"
        $env:PM2_HOME = $expected
    }
}

Assert-Administrator
Assert-ExpectedUser
Assert-Pm2Home

# ===========================================================================
# Paths (all derived from Root; nothing outside Root is created/deleted here)
# ===========================================================================
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$SharedDir        = Join-Path $Root 'shared'
$LogsDir          = Join-Path $Root 'logs'
$ReleasesDir      = Join-Path $Root 'releases'
$StateFile        = Join-Path $SharedDir 'deployment-state.json'
$LockFile         = Join-Path $SharedDir 'deployment.lock'
$CandidateLogsDir = Join-Path $LogsDir 'candidate'
$Pm2OpLog         = Join-Path $SharedDir 'pm2-ops.log'
$ContentStateFile = Join-Path $SharedDir 'content-state.json'
$ContentSyncConfigPath = Join-Path $Root 'content-tools/config.json'
$ProjectionFile = Join-Path $Root 'coordination/code/current.json'
$ContentJournalFile = Join-Path $SharedDir 'content-journal.json'

# Now that identity is established we may create directories (still no mutation
# of the actual deployment has happened yet).
foreach ($d in @($SharedDir, $LogsDir, $ReleasesDir, $CandidateLogsDir)) {
    if (-not (Test-Path -LiteralPath $d)) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
    }
}

# Make the shared directory private: only the current user, SYSTEM and
# Administrators have access. This protects state/rollback config in depth.
function Set-PrivateAcl {
    param([string]$Path)
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    # Do not inherit from parent; remove inherited rules.
    $acl.SetAccessRuleProtection($true, $false)
    $identities = @(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
        'NT AUTHORITY\SYSTEM',
        'BUILTIN\Administrators'
    )
    foreach ($id in $identities) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $id, 'FullControl',
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
             [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None,
            'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
Set-PrivateAcl $SharedDir

# ===========================================================================
# Helpers: parsing / JSON / reparse
# ===========================================================================
function Read-JsonFile {
    param([string]$Path)
    $raw = [System.IO.File]::ReadAllText($Path)
    return ($raw | ConvertFrom-Json)
}

function Test-ReparsePoint {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path -Force
    return (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Test-TreeHasReparsePoint {
    param([string]$Path)
    if (Test-ReparsePoint $Path) { return $true }
    if (Test-Path -LiteralPath $Path -PathType Container) {
        foreach ($item in (Get-ChildItem -LiteralPath $Path -Recurse -Force)) {
            if (Test-ReparsePoint $item.FullName) { return $true }
        }
    }
    return $false
}

function Get-FreeTcpPort {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = (($listener.LocalEndpoint).Port)
    $listener.Stop()
    return $port
}

function Set-EnvSnapshot {
    param([hashtable]$Vars)
    $restore = @{}
    foreach ($k in $Vars.Keys) {
        if (Test-Path -LiteralPath "env:$k") {
            $restore[$k] = (Get-Item -LiteralPath "env:$k").Value
        } else {
            $restore[$k] = $null
        }
        if ($null -eq $Vars[$k]) {
            Remove-Item -LiteralPath "env:$k" -ErrorAction SilentlyContinue
        } else {
            Set-Item -LiteralPath "env:$k" -Value $Vars[$k]
        }
    }
    return $restore
}

function Restore-Env {
    param([hashtable]$Restore)
    foreach ($k in $Restore.Keys) {
        if ($null -eq $Restore[$k]) {
            Remove-Item -LiteralPath "env:$k" -ErrorAction SilentlyContinue
        } else {
            Set-Item -LiteralPath "env:$k" -Value $Restore[$k]
        }
    }
}

# ===========================================================================
# PM2 helpers (explicit path; JSON kept private; exit code checked; stderr safe)
# ===========================================================================
function Invoke-Pm2 {
    param([string[]]$ArgumentList, [switch]$IgnoreExit)
    # In PS5.1 a native command writing to stderr can raise a NativeCommandError
    # when $ErrorActionPreference is 'Stop'. We downgrade locally to 'Continue',
    # capture the real exit code via $LASTEXITCODE, then restore the preference.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $Pm2Path @ArgumentList 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    # Never log `jlist` output (it may contain secrets in the env block).
    $cmdline = ($ArgumentList -join ' ')
    if ($ArgumentList.Count -eq 0 -or $ArgumentList[0] -ne 'jlist') {
        [System.IO.File]::AppendAllText($Pm2OpLog, ($out | Out-String), $Utf8NoBom)
    }
    if (-not $IgnoreExit -and $exitCode -ne 0) {
        throw "pm2 $cmdline failed (exit $exitCode)"
    }
    return $out
}

function Get-Pm2AppList {
    # Returns parsed JSON objects only; never dumped to console or log.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & $Pm2Path jlist 2>$null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($exitCode -ne 0) { throw 'pm2 jlist failed' }
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    # PS5.1 rejects case-variant keys (PM2 commonly emits username/USERNAME).
    # Normalize in memory through Node; never write environment secrets to disk.
    # Windows environment names are case-insensitive; prefer the uppercase key.
    $normalize = @'
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  try {
    function normalize(value) {
      if (Array.isArray(value)) return value.map(normalize);
      if (value === null || typeof value !== "object") return value;
      const chosen = new Map();
      for (const key of Object.keys(value)) {
        const folded = key.toLowerCase();
        if (!chosen.has(folded) || key === key.toUpperCase()) chosen.set(folded, key);
      }
      return Object.fromEntries([...chosen.values()].map(key => [key, normalize(value[key])]));
    }
    // The PowerShell pipe carries only base64 ASCII, avoiding codepage/BOM
    // conversion of the JSON itself. PM2 may prefix jlist with banner lines.
    const text = Buffer.from(input.trim(), "base64").toString("utf8")
      .replace(/^\uFEFF/, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();
    let apps;
    const candidates = [text];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "[" && (i === 0 || text[i - 1] === "\n")) candidates.push(text.slice(i));
    }
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.every(app => app && typeof app.name === "string" && app.pm2_env && typeof app.pm2_env === "object")) {
          apps = parsed;
          break;
        }
      } catch { /* Try another line boundary, never echo JSON contents. */ }
    }
    if (!apps) {
      process.stderr.write(`PM2 JSON is not an app array (chars=${text.length}, lines=${text.split("\n").length})\n`);
      process.exitCode = 1;
      return;
    }
    const json = JSON.stringify(normalize(apps));
    process.stdout.write(json.replace(/[\u007f-\uffff]/g, ch => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")));
  } catch (error) {
    process.stderr.write(`Cannot normalize PM2 JSON (type=${error.name})\n`);
    process.exitCode = 1;
  }
});
'@
    # Base64 avoids Windows PowerShell 5.1 native-argument quote stripping.
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($normalize))
    $bootstrap = "eval(Buffer.from('$encoded','base64').toString('utf8'))"
    $oldOutputEncoding = $OutputEncoding
    try {
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($raw -join "`n")))
        $normalized = $payload | & $NodePath -e $bootstrap
        if ($LASTEXITCODE -ne 0) { throw 'PM2 JSON normalization failed' }
    } finally { $OutputEncoding = $oldOutputEncoding }
    return @(($normalized -join "`n") | ConvertFrom-Json)
}

# ===========================================================================
# Lock file (deployment.lock, FileShare.None) for the whole operation
# ===========================================================================
function Lock-Deployment {
    param([string]$Path, [int]$TimeoutSec = 60)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        try {
            $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::OpenOrCreate,
                [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            return $fs
        } catch [System.IO.IOException] {
            if ($sw.Elapsed.TotalSeconds -ge $TimeoutSec) {
                throw "Could not acquire exclusive lock on '$Path' within $TimeoutSec s (another publish running?)."
            }
            Start-Sleep -Seconds 1
        }
    }
}

function Read-StateFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $raw = [System.IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ($raw | ConvertFrom-Json)
}

function Write-StateAtomic {
    param([string]$StateFile, [object]$State)
    $dir = Split-Path -Parent $StateFile
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $tmp = Join-Path $dir ([System.IO.Path]::GetRandomFileName())
    $json = $State | ConvertTo-Json -Depth 12
    # UTF-8 WITHOUT BOM, so a Chinese environment is never corrupted by ASCII encoding.
    [System.IO.File]::WriteAllText($tmp, $json, $Utf8NoBom)
    if (Test-Path -LiteralPath $StateFile) {
        # Atomic replace (same directory => same volume).
        # PowerShell 5.1 binds $null to "" when calling [System.IO.File]::Replace,
        # which makes .NET throw "The path is not of a legal form" on the third
        # (backupFileName) argument. Move-Item -Force uses Win32 MoveFileEx with
        # REPLACE_EXISTING and is atomic on the same NTFS volume.
        Move-Item -LiteralPath $tmp -Destination $StateFile -Force
    } else {
        Move-Item -LiteralPath $tmp -Destination $StateFile
    }
}

# ===========================================================================
# Validation
# ===========================================================================
function Assert-AncestorNoReparse {
    foreach ($p in @($Root, $SharedDir, $ReleasesDir)) {
        if (Test-ReparsePoint $p) {
            throw "Ancestor path is a reparse point; refusing: $p"
        }
    }
}

function Assert-Manifest {
    param([object]$M)
    if (-not $M) { throw 'release.json (manifest) missing or unreadable.' }
    if ([string]$M.platform -ne 'win32') { throw "manifest.platform='$([string]$M.platform)' expected win32" }
    if ([string]$M.arch -ne 'x64')        { throw "manifest.arch='$([string]$M.arch)' expected x64" }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $nv = & $NodePath --version 2>$null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($exitCode -ne 0) { throw 'node --version failed' }
    # Strip the leading "v" (e.g. node prints "v18.19.0"); manifest stores "18.19.0".
    $nv = ([string]$nv).Trim().TrimStart('v')
    if ($nv -ne [string]$M.nodeVersion) {
        throw "node version '$nv' != manifest.nodeVersion '$([string]$M.nodeVersion)' (must match EXACTLY, without a 'v' prefix)"
    }
}

function Assert-ReleaseStructure {
    param([string]$Dir, [object]$M)
    if (-not (Test-Path -LiteralPath (Join-Path $Dir 'server.js'))) {
        throw "server.js missing in $Dir"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Dir '.next/BUILD_ID'))) {
        throw ".next/BUILD_ID missing in $Dir"
    }
    $buildId = ([System.IO.File]::ReadAllText((Join-Path $Dir '.next/BUILD_ID'))).Trim()
    if ($buildId -ne [string]$M.buildId) {
        throw "BUILD_ID '$buildId' != manifest.buildId '$([string]$M.buildId)'"
    }
    $pub = Join-Path $Dir 'public/__release.json'
    if (-not (Test-Path -LiteralPath $pub)) { throw "public/__release.json missing in $Dir" }
    $pj = Read-JsonFile $pub
    if ([string]$pj.buildId -ne [string]$M.buildId) { throw 'public/__release.json buildId mismatch' }
    if ([string]$pj.id       -ne [string]$M.id)      { throw 'public/__release.json id mismatch' }
    if ([string]$pj.commit   -ne [string]$M.commit)  { throw 'public/__release.json commit mismatch' }
    if ([string]$M.id -notmatch '^[a-z0-9-]+$') {
        throw "manifest.id '$([string]$M.id)' invalid (allowed charset [a-z0-9-])"
    }
    if ([string]$M.commit -notmatch '^[0-9a-f]{40}$') {
        throw "manifest.commit '$([string]$M.commit)' is not 40 hex"
    }
}

function Assert-SafeCopySource {
    param([string]$Source, [string]$Target)
    if (Test-ReparsePoint $Source) { throw 'Source is a reparse point; refusing' }
    if (Test-ReparsePoint $Target) { throw 'Target is a reparse point; refusing' }
    # Reject any reparse point anywhere in the source tree.
    if (Test-TreeHasReparsePoint $Source) { throw 'Source tree contains a reparse point; refusing' }
    $srcNorm = [System.IO.Path]::GetFullPath($Source).Replace('/', '\').TrimEnd('\')
    $tgtNorm = [System.IO.Path]::GetFullPath($Target).Replace('/', '\').TrimEnd('\')
    $relNorm = [System.IO.Path]::GetFullPath($ReleasesDir).Replace('/', '\').TrimEnd('\')
    if ($srcNorm -eq $tgtNorm) { throw 'Source equals target; refusing' }
    if ($srcNorm.StartsWith($relNorm + '\')) { throw 'Source is inside releases dir; refusing recursive copy' }
    if ($srcNorm.StartsWith($tgtNorm + '\')) { throw 'Source is under target; refusing' }
    if ($tgtNorm.StartsWith($srcNorm + '\')) { throw 'Target is under source; refusing' }
    $parent = Split-Path -Parent $tgtNorm
    if ($parent.TrimEnd('\') -ne $relNorm) { throw 'Target is not a direct child of releases dir' }
}

# ===========================================================================
# PM2 config generation (UTF-8 no BOM; args/node_args kept as ARRAYS)
# ===========================================================================
function New-DeployEnv {
    param($SourceEnv)
    $e = @{}
    if ($SourceEnv) {
        foreach ($p in $SourceEnv.PSObject.Properties) { $e[$p.Name] = [string]$p.Value }
    }
    $e['HOSTNAME']  = '127.0.0.1'
    $e['PORT']      = '3000'
    $e['NODE_ENV']  = 'production'
    # CONTENT_ROOT selects where news / leaderboard / content images are read
    # from at runtime. It is inherited from the live app's env above, so once a
    # single release has been published with it set, every later release keeps
    # it automatically. When the source release ships content/ inside itself
    # (the default, RELEASE_EXTERNAL_CONTENT unset) the variable is absent and
    # lib/news falls back to <release>/content, which is correct.
    #
    # Setting it here is therefore a no-op for the bundled case. It only
    # matters when the operator deliberately exports CONTENT_ROOT for an
    # external-content release, and then the value we propagate must be the one
    # the app is actually running with, not a guess.
    if ($e.ContainsKey('CONTENT_ROOT')) {
        Write-Host "  content root (inherited from live app): $($e['CONTENT_ROOT'])"
    } else {
        Write-Host "  content root: bundled in release (no CONTENT_ROOT)"
    }
    return $e
}

function Write-Pm2ConfigFile {
    param([string]$OutPath, [object]$ConfigObject)
    $json = $ConfigObject | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($OutPath, $json, $Utf8NoBom)
    return $OutPath
}

# Build a strongly-typed List[string] from an arbitrary value (array, scalar, or
# null). This is the reliable way to guarantee PM2 config args/node_args serialize
# as a JSON array ("[]" / ["x"]); a bare [string[]] cast of a single-element array
# inside an if-expression can collapse to a scalar string in PowerShell 5.1.
function ConvertTo-StringList {
    param($Value)
    $l = New-Object System.Collections.ArrayList
    if ($null -eq $Value) { return }
    if ($Value -is [System.Array]) {
        foreach ($x in $Value) { if ($null -ne $x) { $null = $l.Add([string]$x) } }
    } else {
        $null = $l.Add([string]$Value)
    }
    # IMPORTANT: a bare `return $l` would enumerate the collection and, for a
    # single-element list, unwrap it into a scalar string. -NoEnumerate keeps the
    # ArrayList intact so ConvertTo-Json emits a real JSON array.
    Write-Output -NoEnumerate $l
}

function New-Pm2Config {
    param(
        [string]$Name, [string]$Script, [string]$Cwd, [string]$Interpreter,
        [hashtable]$Env, [string[]]$AppArgs, [string[]]$NodeAppArgs,
        [string]$OutFile, [string]$ErrFile, [string]$OutPath
    )
    # NOTE: never name a parameter $Args -- it collides with PowerShell's automatic
    # $Args variable and silently becomes empty. Use ConvertTo-StringList so the
    # value is always a real JSON array ("[]" / ["x"]), never "{}" or a scalar.
    $argsArray    = ConvertTo-StringList $AppArgs
    $nodeArgsArray= ConvertTo-StringList $NodeAppArgs
    $app = [ordered]@{
        name              = $Name
        script            = $Script
        cwd               = $Cwd
        interpreter       = $Interpreter
        args              = $argsArray
        node_args         = $nodeArgsArray
        instances         = 1
        exec_mode         = 'fork'
        autorestart       = $true
        max_memory_restart= '1024M'
        min_uptime        = 30000
        max_restarts      = 10
        restart_delay     = 2000
        kill_timeout      = 5000
        listen_timeout    = 8000
        error_file        = $ErrFile
        out_file          = $OutFile
        env               = $Env
    }
    $cfg = [ordered]@{ apps = @($app) }
    return (Write-Pm2ConfigFile -OutPath $OutPath -ConfigObject $cfg)
}

function New-Pm2ConfigFromPm2Env {
    param([object]$Pm, [string]$OutPath)
    $env = @{}
    if ($Pm.env) { foreach ($p in $Pm.env.PSObject.Properties) { $env[$p.Name] = [string]$p.Value } }
    # Keep args / node_args as arrays. ConvertTo-StringList always yields a real
    # JSON array (never "{}" or a scalar string). Do NOT cast to a single [string]
    # -- that would corrupt multi-argument launch configs.
    $argsArray    = ConvertTo-StringList $Pm.args
    $nodeArgsArray= ConvertTo-StringList $Pm.node_args
    $app = [ordered]@{
        name              = 'gdufsmc'
        script            = [string]$Pm.pm_exec_path
        cwd               = [string]$Pm.pm_cwd
        interpreter       = [string]$Pm.exec_interpreter
        args              = $argsArray
        node_args         = $nodeArgsArray
        instances         = 1
        exec_mode         = 'fork'
        autorestart       = $true
        max_memory_restart= '1024M'
        error_file        = Join-Path $LogsDir 'gdufsmc-error.log'
        out_file          = Join-Path $LogsDir 'gdufsmc-out.log'
        env               = $env
    }
    $cfg = [ordered]@{ apps = @($app) }
    return (Write-Pm2ConfigFile -OutPath $OutPath -ConfigObject $cfg)
}

function Get-LegacyInfo {
    param([object]$Pm)
    $cwd     = [string]$Pm.pm_cwd
    $id      = 'legacy'
    $legacy  = $true
    $relPath = $cwd
    $commit  = $null
    $buildId = $null
    if ($cwd -and (Test-Path -LiteralPath (Join-Path $cwd 'release.json'))) {
        try {
            $rj = Read-JsonFile (Join-Path $cwd 'release.json')
            if ([string]$rj.id -match '^[a-z0-9-]+$') {
                $id      = [string]$rj.id
                $legacy  = $false
                $commit  = [string]$rj.commit
                $buildId = [string]$rj.buildId
                $relPath = $cwd
            }
        } catch { }
    }
    return $id, $relPath, $legacy, $commit, $buildId
}

# ===========================================================================
# Health checks (polling, legacy skips the /__release marker)
# ===========================================================================
function Test-HealthEndpoint {
    param([int]$Port, [string]$Id, [string]$Commit, [string]$BuildId, [bool]$IsLegacy,
          [int]$Attempts = 25, [int]$DelaySec = 2)
    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            if (-not $IsLegacy) {
                $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/__release.json" -UseBasicParsing -TimeoutSec 5
                if ($r.StatusCode -eq 200) {
                    $j = $r.Content | ConvertFrom-Json
                    if ([string]$j.id -eq $Id -and [string]$j.commit -eq $Commit -and [string]$j.buildId -eq $BuildId) {
                        $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
                        if ($h.StatusCode -eq 200) { return $true }
                    }
                }
            } else {
                $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
                if ($h.StatusCode -eq 200) { return $true }
            }
        } catch { }
        Start-Sleep -Seconds $DelaySec
    }
    return $false
}

function Get-AppOnline {
    param([string]$ReleasePath, [string]$ExecPath, [string]$Id, [string]$Commit,
          [string]$BuildId, [bool]$IsLegacy, [int]$Port = 3000,
          [int]$Attempts = 15, [int]$DelaySec = 2)
    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            $apps = Get-Pm2AppList
            $g = @($apps | Where-Object { $_.name -eq 'gdufsmc' })
            if ($g.Count -ne 1) { Start-Sleep -Seconds $DelaySec; continue }
            if ([string]$g[0].pm2_env.status -ne 'online') { Start-Sleep -Seconds $DelaySec; continue }
            if ($ReleasePath -and [string]$g[0].pm2_env.pm_cwd -ne $ReleasePath) { Start-Sleep -Seconds $DelaySec; continue }
            # PM2 records pm_exec_path as the SCRIPT path (e.g. .../server.js), NOT
            # the interpreter. Compare NORMALIZED full paths so a difference in
            # casing/slashes does not false-fail, while a genuinely different script
            # (e.g. a wrong release) is correctly rejected.
            if ($ExecPath) {
                $runExe = [string]$g[0].pm2_env.pm_exec_path
                if ($runExe) {
                    $runNorm  = [System.IO.Path]::GetFullPath($runExe).Replace('/', '\').TrimEnd('\')
                    $wantNorm = [System.IO.Path]::GetFullPath($ExecPath).Replace('/', '\').TrimEnd('\')
                    if ($runNorm -ne $wantNorm) { Start-Sleep -Seconds $DelaySec; continue }
                }
            }
            $h = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5
            if ($h.StatusCode -ne 200) { Start-Sleep -Seconds $DelaySec; continue }
            if (-not $IsLegacy -and $Id) {
                $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/__release.json" -UseBasicParsing -TimeoutSec 5
                if ($r.StatusCode -ne 200) { Start-Sleep -Seconds $DelaySec; continue }
                $j = $r.Content | ConvertFrom-Json
                if ([string]$j.id -ne $Id -or [string]$j.commit -ne $Commit -or [string]$j.buildId -ne $BuildId) {
                    Start-Sleep -Seconds $DelaySec; continue
                }
            }
            return $true
        } catch { }
        Start-Sleep -Seconds $DelaySec
    }
    return $false
}

function Test-CandidateHealth {
    param([string]$ReleasePath, [string]$ServerJs, [object]$Manifest, [hashtable]$CandidateEnv)
    $port = Get-FreeTcpPort
    $cEnv = if ($CandidateEnv) { $CandidateEnv.Clone() } else { New-DeployEnv $liveEnv }
    $cEnv['PORT'] = [string]$port
    $cOut = Join-Path $CandidateLogsDir "candidate-$([string]$Manifest.id).out.log"
    $cErr = Join-Path $CandidateLogsDir "candidate-$([string]$Manifest.id).err.log"
    $restore = Set-EnvSnapshot $cEnv
    $proc = $null
    try {
        # Quote the path so spaces in the release path are handled safely.
        $proc = Start-Process -FilePath $NodePath -ArgumentList @("`"$ServerJs`"") `
            -WorkingDirectory $ReleasePath -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput $cOut -RedirectStandardError $cErr
        if ($proc.HasExited) { throw "candidate process exited immediately (code $($proc.ExitCode))" }
        if (-not (Test-HealthEndpoint -Port $port -Id ([string]$Manifest.id) -Commit ([string]$Manifest.commit) -BuildId ([string]$Manifest.buildId) -IsLegacy $false)) {
            throw 'candidate health check (marker + homepage 200) failed'
        }
        if ($Manifest.contentSyncVersion -eq 1) { Assert-PublishContentHealth -Port $port -Parent $cEnv['CONTENT_ROOT'] }
        Write-Host "Candidate passed pre-switch health check on loopback port $port"
    } finally {
        if ($proc) {
            # Wait briefly for graceful exit, then ensure the process is gone so the
            # loopback port is released before we continue.
            try { if (-not $proc.HasExited) { $proc.WaitForExit(2000) } } catch { }
            if (-not $proc.HasExited) {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                try { $proc.WaitForExit(5000) } catch { }
            }
        }
        Restore-Env $restore
    }
}

function Assert-PublishContentHealth {
    param([int]$Port, [string]$Parent)
    $newsPath = Join-Path $Parent 'content/news'
    $articles = @(Get-ChildItem -LiteralPath $newsPath -File | Where-Object { $_.Extension -ieq '.md' })
    if ($articles.Count -eq 0) { throw 'Content health check found no markdown articles.' }
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/news" -UseBasicParsing -TimeoutSec 15
    $slugs = @([regex]::Matches($response.Content, 'href="/news/([^"?#]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    if ($response.StatusCode -ne 200 -or $slugs.Count -lt $articles.Count) { throw 'News route did not render the expected article count.' }
    $detail = Invoke-WebRequest -Uri ("http://127.0.0.1:$Port/news/" + $slugs[0]) -UseBasicParsing -TimeoutSec 15
    if ($detail.StatusCode -ne 200) { throw 'News detail route failed content health check.' }
}

function Assert-PublishWorkerHealth {
    param([string]$Parent, [string]$CodeCommit, [string]$ReleaseId)
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $healthOutput = & $NodePath (Join-Path $Root 'content-tools/scripts/content-sync.mjs') health `
            --config $ContentSyncConfigPath --parent $Parent --code-commit $CodeCommit --release-id $ReleaseId
        $healthExit = $LASTEXITCODE
        foreach ($line in $healthOutput) { Write-Host $line }
    } finally { $ErrorActionPreference = $previousEap }
    if ($healthExit -ne 0) { throw "Live content verification failed (exit $healthExit)." }
}

# ===========================================================================
# Switch + automatic revert
# NOTE: this is intentionally NOT atomic (stop -> delete -> start). On failure
# we automatically revert; the state file is only mutated after a successful switch.
# ===========================================================================
function Invoke-DeploySwitch {
    param(
        [hashtable]$Target,  # configPath, releasePath, execPath, id, commit, buildId
        [hashtable]$Revert,  # configPath, releasePath, execPath, id, commit, buildId
        [bool]$RevertIsLegacy,
        [bool]$TargetIsLegacy = $false
    )
    $contentSwap = $null
    $journal = $null
    if ($Target.contentSource) {
        $journalPath = Join-Path $Root 'shared/content-journal.json'
        $journal = [ordered]@{
            version = 1; kind = 'program-publish'; completed = $false; phase = 'prepared'
            operationId = $Target.contentOperationId; candidateParent = (Split-Path -Parent $Target.contentSource)
            backupPath = (Join-Path $Root ('content-backups/' + $Target.contentOperationId + '/content'))
            oldAppConfig = $Revert.configPath; newAppConfig = $Target.configPath
            oldCodeCommit = $Revert.commit; newCodeCommit = $Target.commit
            updatedAt = [DateTime]::UtcNow.ToString('o')
        }
        foreach ($entry in @(
            @{ key = 'oldDeploymentState'; path = (Join-Path $Root 'shared/deployment-state.json') },
            @{ key = 'oldContentState'; path = (Join-Path $Root 'shared/content-state.json') },
            @{ key = 'oldCodeProjection'; path = (Join-Path $Root 'coordination/code/current.json') }
        )) {
            $existed = Test-Path -LiteralPath $entry.path -PathType Leaf
            $journal[$entry.key + 'Exists'] = [bool]$existed
            $journal[$entry.key] = if ($existed) { Read-ContentJson $entry.path } else { $null }
        }
        Write-ContentJsonAtomic -Path $journalPath -Value $journal
    }
    try {
        Invoke-Pm2 -ArgumentList @('stop', 'gdufsmc') -IgnoreExit | Out-Null
        Invoke-Pm2 -ArgumentList @('delete', 'gdufsmc') -IgnoreExit | Out-Null
        if ($Target.contentSource -or $Target.restoreContentBackup) { Assert-AppStoppedForContent }
        if ($journal) { Set-PublishJournalPhase -Phase 'stopped' }
        if ($Target.restoreContentBackup) {
            Restore-ContentDirectorySwap -Root $Root -BackupPath $Target.restoreContentBackup `
                -OperationId ('restore-' + [Guid]::NewGuid().ToString('N')) | Out-Null
        } elseif ($Target.contentSource) {
            Set-PublishJournalPhase -Phase 'swapping'
            $contentSwap = Invoke-ContentDirectorySwap -Root $Root -CandidateContent $Target.contentSource `
                -OperationId $Target.contentOperationId
            Set-PublishJournalPhase -Phase 'swapped'
        }
        Invoke-Pm2 -ArgumentList @('start', $Target.configPath, '--only', 'gdufsmc') | Out-Null

        $apps = Get-Pm2AppList
        $g = @($apps | Where-Object { $_.name -eq 'gdufsmc' })
        if ($g.Count -ne 1) { throw "pm2 app count after start = $($g.Count) (expected 1)" }
        if ([string]$g[0].pm2_env.pm_cwd -ne $Target.releasePath) {
            throw "pm2 cwd after start ('$([string]$g[0].pm2_env.pm_cwd)') != '$($Target.releasePath)'"
        }
        if ([string]$g[0].pm2_env.status -ne 'online') {
            throw "pm2 status after start = '$([string]$g[0].pm2_env.status)'"
        }
        if (-not (Get-AppOnline -ReleasePath $Target.releasePath -ExecPath $Target.execPath `
                -Id $Target.id -Commit $Target.commit -BuildId $Target.buildId `
                -IsLegacy $TargetIsLegacy -Port 3000)) {
            throw 'post-switch health (marker + homepage 200) failed'
        }
        if ($Target.contentSource -or $Target.restoreContentBackup) {
            if ($Target.verifyWithContentWorker -and -not $TargetIsLegacy) {
                $healthParent = if ($Target.contentSource) { Split-Path -Parent $Target.contentSource } else { $Root }
                Assert-PublishWorkerHealth -Parent $healthParent -CodeCommit $Target.commit -ReleaseId $Target.id
            } else { Assert-PublishContentHealth -Port 3000 -Parent $Root }
        }
        Invoke-Pm2 -ArgumentList @('save') | Out-Null
        if ($journal) { Set-PublishJournalPhase -Phase 'app-online' }
    } catch {
        # Write-Warning (not Write-Error) so we do NOT abort before reverting.
        Write-Warning "Switch error: $_"
        if ($Target.restoreContentBackup) {
            # This call is already recovering a failed state commit. Restoring its
            # backup may have consumed the old directory; starting Revert here
            # could pair the candidate code with the restored previous content.
            $confirmedStopped = $false
            try {
                Invoke-Pm2 -ArgumentList @('stop', 'gdufsmc') -IgnoreExit | Out-Null
                Invoke-Pm2 -ArgumentList @('delete', 'gdufsmc') -IgnoreExit | Out-Null
                Assert-AppStoppedForContent
                $confirmedStopped = $true
            } catch { Write-Warning "CRITICAL: could not confirm application stopped during recovery: $_" }
            try { Set-PublishJournalPhase -Phase 'recovery-failed' }
            catch { Write-Warning "CRITICAL: could not persist recovery failure: $_" }
            throw "CRITICAL: recovery switch failed; refusing another code/content switch. Application stopped=$confirmedStopped. Manual journal recovery is required."
        }
        try {
            Invoke-Pm2 -ArgumentList @('stop', 'gdufsmc') -IgnoreExit | Out-Null
            Invoke-Pm2 -ArgumentList @('delete', 'gdufsmc') -IgnoreExit | Out-Null
            $recoveryBackup = if ($contentSwap) { $contentSwap.backupPath } elseif ($journal) { $journal.backupPath } else { $null }
            if ($recoveryBackup -and (Test-Path -LiteralPath $recoveryBackup -PathType Container)) {
                Assert-AppStoppedForContent
                Restore-ContentDirectorySwap -Root $Root -BackupPath $recoveryBackup `
                    -OperationId ('failed-' + [Guid]::NewGuid().ToString('N')) | Out-Null
            } elseif ($contentSwap -or ($journal -and -not (Test-Path -LiteralPath (Join-Path $Root 'content') -PathType Container))) {
                throw 'Content recovery cannot find the recorded backup or a valid live directory.'
            }
            Invoke-Pm2 -ArgumentList @('start', $Revert.configPath, '--only', 'gdufsmc') | Out-Null
            if (-not (Get-AppOnline -ReleasePath $Revert.releasePath -ExecPath $Revert.execPath `
                    -Id $Revert.id -Commit $Revert.commit -BuildId $Revert.buildId `
                    -IsLegacy $RevertIsLegacy -Port 3000)) {
                throw 'revert health check failed'
            }
            if ($journal) {
                if ($Target.verifyWithContentWorker -and -not $RevertIsLegacy) {
                    Assert-PublishWorkerHealth -Parent $Root -CodeCommit $Revert.commit -ReleaseId $Revert.id
                } else { Assert-PublishContentHealth -Port 3000 -Parent $Root }
            }
            Invoke-Pm2 -ArgumentList @('save') | Out-Null
            if ($journal) { Reset-PublishContentPurge -CodeCommit $Revert.commit }
            if ($journal) { Set-PublishJournalPhase -Phase 'rolled-back' -Completed }
            Write-Warning "Automatically reverted to the previous application."
        } catch {
            Write-Warning "CRITICAL: automatic revert also failed: $_"
        }
        throw 'Switch failed; verify recovery warnings and the maintenance journal before retrying.'
    }
    return $contentSwap
}

function Assert-AppStoppedForContent {
    $remaining = @(Get-Pm2AppList | Where-Object { $_.name -eq 'gdufsmc' })
    if ($remaining.Count -ne 0) { throw 'gdufsmc is still registered after stop/delete; refusing to replace live content.' }
}

function Set-PublishJournalPhase {
    param([string]$Phase, [switch]$Completed)
    if ($Completed -and $script:PublishStateRecoveryFailed) { throw 'CRITICAL: state recovery is incomplete; journal must remain unfinished.' }
    $journalPath = Join-Path $Root 'shared/content-journal.json'
    $journal = Read-ContentJson $journalPath
    $journal.phase = $Phase
    $journal.completed = [bool]$Completed
    $journal.updatedAt = [DateTime]::UtcNow.ToString('o')
    Write-ContentJsonAtomic -Path $journalPath -Value $journal
}

function Get-PublishContentState {
    param([string]$CodeCommit)
    if (-not (Test-Path -LiteralPath $ContentStateFile)) { return $null }
    $contentState = Read-ContentJson $ContentStateFile
    if ($contentState.version -ne 1 -or [string]$contentState.codeCommit -ne $CodeCommit) {
        throw 'Content state differs from the current code baseline; resolve drift before publish.'
    }
    return $contentState
}

function Reset-PublishContentPurge {
    param([string]$CodeCommit)
    if (-not (Test-Path -LiteralPath $ContentStateFile -PathType Leaf)) { return }
    $contentState = Read-ContentJson $ContentStateFile
    if ([string]$contentState.codeCommit -ne $CodeCommit) { throw 'Recovered app and content state differ; journal must remain unfinished.' }
    # A briefly online candidate may have populated the CDN. The next queue run
    # must create a new purge for restored content, rather than reuse an old job.
    $now = [DateTime]::UtcNow.ToString('o')
    $contentState.purge = [pscustomobject]@{ status = 'pending'; updatedAt = $now }
    $contentState.updatedAt = $now
    Write-ContentJsonAtomic -Path $ContentStateFile -Value $contentState
}

function Write-PublishState {
    param([object]$DeploymentState, [object]$ContentState)
    # All participating publishers and the queue processor hold shared/deployment.lock.
    # Keep an in-memory old value for recovery if any of the coordinated writes fails.
    $script:PublishStateRecoveryFailed = $false
    $writes = @()
    if (Test-Path -LiteralPath $ContentSyncConfigPath) {
        $projection = Get-ContentDeploymentProjection $DeploymentState.current
        $projection.contentCommit = $ContentState.contentCommit
        $writes += @{ path = $ContentStateFile; value = $ContentState }
        $writes += @{ path = $ProjectionFile; value = $projection }
    }
    $writes += @{ path = $StateFile; value = $DeploymentState }
    $journalPath = Join-Path $Root 'shared/content-journal.json'
    if (Test-Path -LiteralPath $journalPath) {
        $journal = Read-ContentJson $journalPath
        if ($journal.kind -eq 'program-publish' -and $journal.completed -ne $true) {
            $journal.phase = 'complete'; $journal.completed = $true; $journal.updatedAt = [DateTime]::UtcNow.ToString('o')
            $writes += @{ path = $journalPath; value = $journal }
        }
    }
    foreach ($write in $writes) {
        Assert-ContentPathWithinRoot $Root $write.path
        $write.existed = Test-Path -LiteralPath $write.path
        $write.previous = if ($write.existed) { Read-ContentJson $write.path } else { $null }
    }
    try {
        foreach ($write in $writes) { Write-ContentJsonAtomic -Path $write.path -Value $write.value }
    } catch {
        $failure = $_
        $recoveryFailures = @()
        foreach ($write in $writes) {
            try {
                if ($write.existed) { Write-ContentJsonAtomic -Path $write.path -Value $write.previous }
                elseif (Test-Path -LiteralPath $write.path) { [IO.File]::Delete($write.path) }
            } catch {
                $recoveryFailures += $write.path
                Write-Warning "CRITICAL: failed restoring state file '$($write.path)': $_"
            }
        }
        if ($recoveryFailures.Count -gt 0) {
            $script:PublishStateRecoveryFailed = $true
            try { Set-PublishJournalPhase -Phase 'recovery-failed' } catch { Write-Warning "CRITICAL: could not persist the unfinished recovery journal: $_" }
            throw ('CRITICAL: state recovery incomplete for ' + ($recoveryFailures -join ', ') + '. Original failure: ' + $failure.Exception.Message)
        }
        throw $failure
    }
}

function New-PublishContentState {
    param([string]$CodeCommit, [AllowNull()][string]$ContentCommit,
        [AllowNull()][string]$PreviousContentCommit, [AllowNull()][string]$BackupPath)
    $now = [DateTime]::UtcNow.ToString('o')
    return [ordered]@{
        version = 1; codeCommit = $CodeCommit; contentCommit = $ContentCommit
        previousContentCommit = $PreviousContentCommit; backupPath = $BackupPath
        purge = [ordered]@{ status = 'pending'; updatedAt = $now }; updatedAt = $now
    }
}

# ===========================================================================
# Cleanup of superseded releases.
# GUARDS (do NOT delete anything that is not explicitly retired):
#   * only an EXPLICIT $RetiredIds entry may be cleaned (caller decides what is
#     safe to remove; we never auto-discover deletable folders)
#   * the retired id must NOT be current or previous (as recorded by $State)
#   * only DIRECT children of <Root>/releases
#   * the child must have a readable release.json whose id matches the folder name
#   * the whole tree must contain NO reparse points
#   * on any delete failure, emit a WARNING and keep going (do not roll back a
#     successful publish). A FAILED candidate is intentionally RETAINED for
#     diagnosis: it was never recorded as current/previous, so it is never placed
#     in $RetiredIds and therefore can never be deleted here.
# ===========================================================================
function Clear-OldReleases {
    param(
        [object]$State,
        [string[]]$RetiredIds = @()
    )
    $keep = @()
    if ($State.current  -and $State.current.id)  { $keep += [string]$State.current.id }
    if ($State.previous -and $State.previous.id) { $keep += [string]$State.previous.id }
    if (-not (Test-Path -LiteralPath $ReleasesDir)) { return }
    foreach ($child in (Get-ChildItem -LiteralPath $ReleasesDir -Directory)) {
        if ($child.Name -in $keep) { continue }
        # Only an explicit retired id is eligible. Anything else (including a FAILED
        # candidate that was never promoted) is retained for diagnosis.
        if (-not $RetiredIds -or $child.Name -notin $RetiredIds) { continue }
        if (Test-ReparsePoint $child.FullName) {
            Write-Warning "Skip reparse point (not removed): $($child.FullName)"
            continue
        }
        $rj = Join-Path $child.FullName 'release.json'
        if (-not (Test-Path -LiteralPath $rj)) {
            Write-Warning "Skip (no release.json, not a versioned release): $($child.FullName)"
            continue
        }
        try { $mj = Read-JsonFile $rj } catch {
            Write-Warning "Skip (unreadable release.json): $($child.FullName)"
            continue
        }
        if ([string]$mj.id -notmatch '^[a-z0-9-]+$') {
            Write-Warning "Skip (invalid id): $($child.FullName)"
            continue
        }
        if ([string]$mj.id -ne $child.Name) {
            Write-Warning "Skip (id/folder mismatch): $($child.FullName)"
            continue
        }
        if (Test-TreeHasReparsePoint $child.FullName) {
            Write-Warning "Skip (reparse point inside tree): $($child.FullName)"
            continue
        }
        try {
            Remove-Item -LiteralPath $child.FullName -Recurse -Force
            Write-Host "Cleaned superseded release: $($child.FullName)"
        } catch {
            # Cleanup failure must NOT roll back a successful publish.
            Write-Warning "Cleanup failed (publish still succeeded): $($child.FullName): $_"
        }
    }
}

# ===========================================================================
# EdgeOne cache purge (deploy automation)
# After a successful switch (deploy or rollback), purge all cached HTML for
# the EdgeOne zone so users see the new version immediately instead of waiting
# up to s-maxage=86400 (1 day) for the cache to expire naturally.
#
# This step is intentionally NON-FATAL: a purge failure does NOT roll back a
# successful deploy. The HTML s-maxage=86400 set in next.config.ts is the
# safety net -- worst case, users see stale content for up to 1 day instead
# of 1 year.
#
# Operator requirements:
#   * tccli (Tencent Cloud CLI) installed on the operator host:
#       pip install tccli
#       tccli configure set secretId   <CAM sub-account SecretId>
#       tccli configure set secretKey <CAM sub-account SecretKey>
#       tccli configure set region    <EdgeOne region, e.g. ap-guangzhou>
#   * <Root>/secrets.edgeone.json (NOT shipped in dev repo; created on the
#     operator host with restricted ACL -- Administrator + SYSTEM read only):
#       {
#         "zoneId": "zone-3vdw90vs6duq",
#         "region": "ap-guangzhou"
#       }
#   * A CAM sub-account with a least-privilege policy (see deploy/README.md):
#       Action  : teo:CreatePurgeTask, teo:DescribePurgeTasks
#       Resource: qcs::teo::uin/<主账号UIN>:zone/<zone-id>
# ===========================================================================
function Invoke-EdgeOnePurge {
    param(
        [string]$SecretsFile = (Join-Path $Root 'secrets.edgeone.json'),
        [int]$MaxRetries    = 3,
        [int]$RetryDelaySec = 5
    )

    if (-not (Test-Path -LiteralPath $SecretsFile)) {
        Write-Warning "EdgeOne secrets file not found: $SecretsFile (skipping cache purge)"
        Write-Warning "  Deploy succeeded, but users may see stale HTML for up to 1 day."
        return
    }
    try {
        $secrets = Read-JsonFile $SecretsFile
    } catch {
        Write-Warning "EdgeOne secrets JSON unreadable: $_ (skipping cache purge)"
        return
    }
    if (-not $secrets.zoneId) {
        Write-Warning "EdgeOne zoneId missing in $SecretsFile (skipping cache purge)"
        return
    }
    $zoneId = [string]$secrets.zoneId
    $region = if ($secrets.region) { [string]$secrets.region } else { '' }

    # Build the tccli argument vector. --region is OPTIONAL for the EdgeOne API,
    # but tccli requires it as a top-level flag (it is not a teo CreatePurgeTask
    # input parameter, despite the API doc listing Region as 'public params').
    $purgeArgs = @('--cli-unfold-argument', '--ZoneId', $zoneId, '--Type', 'purge_all')
    if ($region) {
        $purgeArgs = @('--region', $region) + $purgeArgs
    }

    $attempt = 0
    while ($attempt -lt $MaxRetries) {
        $attempt++
        Write-Host "EdgeOne purge: attempt $attempt/$MaxRetries (zone=$zoneId, type=purge_all)"
        # PS5.1: a native command writing to stderr raises NativeCommandError when
        # $ErrorActionPreference is 'Stop'. Downgrade locally to capture the real
        # exit code via $LASTEXITCODE, then restore the preference.
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $out = & tccli teo CreatePurgeTask @purgeArgs 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $prevEap
        }
        if ($exitCode -eq 0) {
            Write-Host "EdgeOne purge submitted successfully (zone=$zoneId)"
            return
        }
        Write-Warning "EdgeOne purge attempt $attempt failed (exit $exitCode): $out"
        if ($attempt -lt $MaxRetries) { Start-Sleep -Seconds $RetryDelaySec }
    }
    Write-Warning "EdgeOne purge FAILED after $MaxRetries attempts. Users may see stale HTML for up to 1 day."
    Write-Warning "  Manually purge via EdgeOne console: https://console.cloud.tencent.com/edgeone"
}

# ===========================================================================
# Main
# ===========================================================================
Assert-AncestorNoReparse

# Acquire exclusive lock for the whole operation (prevents concurrent publishes).
$script:DeployLock = Lock-Deployment $LockFile
try {
    $state = Read-StateFile $StateFile
    if (Test-Path -LiteralPath $ContentJournalFile) {
        $pendingJournal = Read-ContentJson $ContentJournalFile
        if ($pendingJournal.completed -ne $true) { throw 'An unfinished content operation requires recovery before program publish/rollback.' }
    }

    if ($Rollback) {
        # ---------------- ROLLBACK MODE ----------------
        if (-not $state) { throw 'No deployment-state.json found; cannot rollback.' }
        if (-not $state.previous) { throw 'No previous deployment recorded; cannot rollback.' }
        $prev = $state.previous
        $cur  = $state.current
        $oldContentState = Get-PublishContentState -CodeCommit ([string]$cur.commit)
        $currentContentCommit = if ($oldContentState) { [string]$oldContentState.contentCommit } else { $null }
        $rollbackContentCommit = if ($prev.PSObject.Properties['contentCommit']) { [string]$prev.contentCommit } else { $currentContentCommit }

        # Validate identity / node version / target manifest before switching back.
        Assert-Administrator
        Assert-ExpectedUser
        Assert-Pm2Home

        if (-not (Test-Path -LiteralPath $prev.configPath)) {
            throw "Previous config missing: $([string]$prev.configPath)"
        }
        if (-not (Test-Path -LiteralPath $prev.configPath -PathType Leaf)) {
            throw "Previous config is not a file: $([string]$prev.configPath)"
        }
        if ($cur -and -not (Test-Path -LiteralPath $cur.configPath -PathType Leaf)) {
            throw "Current config missing: $([string]$cur.configPath)"
        }
        if (-not $prev.legacy -and $prev.releasePath -and `
            -not (Test-Path -LiteralPath $prev.releasePath -PathType Container)) {
            throw "Previous release path missing: $([string]$prev.releasePath)"
        }
        # Verify the previous target manifest + node version so we never roll back
        # onto an incompatible node runtime.
        if (-not $prev.legacy -and $prev.releasePath -and `
            (Test-Path -LiteralPath (Join-Path $prev.releasePath 'release.json'))) {
            $prevManifest = Read-JsonFile (Join-Path $prev.releasePath 'release.json')
            Assert-Manifest $prevManifest
        }

        $target = @{
            configPath = [string]$prev.configPath
            releasePath= [string]$prev.releasePath
            execPath   = [string]$prev.execPath
            id         = [string]$prev.id
            commit     = [string]$prev.commit
            buildId    = [string]$prev.buildId
        }
        if ($prev.PSObject.Properties['contentPath'] -and $prev.contentPath) {
            Assert-ContentPathWithinRoot $Root ([string]$prev.contentPath)
            Assert-ContentNoReparse ([string]$prev.contentPath) -Recurse
            $target.contentSource = [string]$prev.contentPath
            $target.contentOperationId = 'rollback-' + [Guid]::NewGuid().ToString('N')
            $target.verifyWithContentWorker = Test-Path -LiteralPath $ContentSyncConfigPath
        } elseif ($rollbackContentCommit -ne $currentContentCommit) {
            throw 'Rollback content differs but its retained backup path is missing. Refusing an incompatible code/content pair.'
        }
        $revert = if ($cur) {
            @{
                configPath = [string]$cur.configPath
                releasePath= [string]$cur.releasePath
                execPath   = [string]$cur.execPath
                id         = [string]$cur.id
                commit     = [string]$cur.commit
                buildId    = [string]$cur.buildId
            }
        } else {
            $target  # nothing to revert to; will simply report below
        }
        $revertIsLegacy = if ($cur) { [bool]$cur.legacy } else { [bool]$prev.legacy }

        try {
            # Switch the live app back to the previous deployment. The target IS
            # $prev, so its legacy flag drives the post-switch health check (legacy
            # skips the /__release marker).
            $contentSwap = Invoke-DeploySwitch -Target $target -Revert $revert -RevertIsLegacy $revertIsLegacy `
                -TargetIsLegacy ([bool]$prev.legacy)
            $tmp = $state.current
            $state.current = $state.previous
            $state.previous = $tmp
            $state.current | Add-Member -NotePropertyName contentCommit -NotePropertyValue $rollbackContentCommit -Force
            $state.previous | Add-Member -NotePropertyName contentCommit -NotePropertyValue $currentContentCommit -Force
            $state.previous | Add-Member -NotePropertyName contentPath -NotePropertyValue $(if ($contentSwap) { [string]$contentSwap.backupPath } else { $null }) -Force
            try {
                $rollbackContentState = New-PublishContentState -CodeCommit ([string]$target.commit) `
                    -ContentCommit $rollbackContentCommit -PreviousContentCommit $currentContentCommit `
                    -BackupPath $(if ($contentSwap) { [string]$contentSwap.backupPath } else { $null })
                Write-PublishState -DeploymentState $state -ContentState $rollbackContentState
                Write-Host "ROLLBACK SUCCEEDED to $([string]$target.id)"
                Invoke-EdgeOnePurge
            } catch {
                # The live app is already running the previous version, but the state
                # file could not be written. Switch the live app BACK to current so we
                # never leave a running app that disagrees with the recorded state, and
                # report the REAL outcome. We must NOT claim rollback succeeded.
                Write-Warning "Rollback switch succeeded but state write failed: $_. Restoring current app."
                try {
                    if ($contentSwap) {
                        $revert.restoreContentBackup = [string]$contentSwap.backupPath
                        $revert.verifyWithContentWorker = Test-Path -LiteralPath $ContentSyncConfigPath
                    }
                    Invoke-DeploySwitch -Target $revert -Revert $target -RevertIsLegacy ([bool]$prev.legacy) `
                        -TargetIsLegacy $revertIsLegacy | Out-Null
                    if ($contentSwap -and -not $script:PublishStateRecoveryFailed) {
                        Reset-PublishContentPurge -CodeCommit $revert.commit
                        Set-PublishJournalPhase -Phase 'rolled-back' -Completed
                    }
                } catch {
                    Write-Warning "CRITICAL: restore to current after state-failure also failed: $_"
                }
                throw 'Rollback failed: state write failed; restoration attempted. Check PM2, saved state and the maintenance journal before retrying.'
            }
        } catch {
            Write-Warning "ROLLBACK FAILED: $_"
            throw 'Rollback aborted; verify recovery warnings and the maintenance journal before retrying.'
        }
    } else {
        # ---------------- DEPLOY MODE ----------------
        if (-not (Test-Path -LiteralPath $ReleaseDirectory -PathType Container)) {
            throw "ReleaseDirectory not found or not a directory: $ReleaseDirectory"
        }

        Assert-Administrator
        Assert-ExpectedUser
        Assert-Pm2Home

        # Manifest + node version (v-prefix stripped internally).
        $manifest = Read-JsonFile (Join-Path $ReleaseDirectory 'release.json')
        Assert-Manifest $manifest
        Assert-ReleaseStructure $ReleaseDirectory $manifest

        # Target
        $newId = [string]$manifest.id
        $newReleasePath = Join-Path $ReleasesDir $newId
        if (Test-Path -LiteralPath $newReleasePath) {
            throw "Target release already exists: $newReleasePath"
        }
        Assert-SafeCopySource $ReleaseDirectory $newReleasePath

        # Capture live PM2 app: exactly one app named "gdufsmc" must exist.
        $apps = Get-Pm2AppList
        $g = @($apps | Where-Object { $_.name -eq 'gdufsmc' })
        if ($g.Count -ne 1) {
            throw "Exactly one PM2 app named 'gdufsmc' is required (found $($g.Count)); refusing first migration without an existing online app."
        }
        $live = $g[0].pm2_env
        $liveEnv = $live.env
        $oldId, $oldReleasePath, $oldLegacy, $oldCommit, $oldBuildId = Get-LegacyInfo $live

        # Preflight drift guard: the live app must match state.current so we never
        # publish on top of an unexpected/changed deployment.
        if ($state -and $state.current -and -not $state.current.legacy) {
            if ([string]$live.pm_cwd -ne [string]$state.current.releasePath) {
                throw "Drift detected: live cwd '$([string]$live.pm_cwd)' != state.current '$([string]$state.current.releasePath)'. Refusing to publish."
            }
            if (-not (Get-AppOnline -ReleasePath ([string]$state.current.releasePath) `
                    -ExecPath ([string]$state.current.execPath) -Id ([string]$state.current.id) `
                    -Commit ([string]$state.current.commit) -BuildId ([string]$state.current.buildId) `
                    -IsLegacy $false -Port 3000)) {
                throw "Drift detected: state.current '$([string]$state.current.id)' is not healthy/online. Refusing to publish."
            }
        }

        # Copy only after PM2 parsing and live-state preflight have succeeded.
        Copy-Item -LiteralPath $ReleaseDirectory -Destination $newReleasePath -Recurse -Force
        Assert-ReleaseStructure $newReleasePath $manifest

        $oldContentState = Get-PublishContentState -CodeCommit ([string]$oldCommit)
        $oldContentCommit = if ($oldContentState) { [string]$oldContentState.contentCommit } else { $null }
        $newContentCommit = $oldContentCommit
        $candidateContentRoot = $null
        if ($manifest.contentSyncVersion -and $manifest.contentSyncVersion -ne 1) { throw 'Unsupported release contentSyncVersion.' }
        if ($manifest.contentSyncVersion -eq 1) {
            if (-not (Test-Path -LiteralPath $ContentSyncConfigPath -PathType Leaf)) {
                throw 'This release requires content sync setup. Run setup-content-sync.ps1 as Administrator first.'
            }
            $tool = Join-Path $Root 'content-tools/scripts/content-sync.mjs'
            Assert-ContentNoReparse $tool
            Assert-ContentNoReparse $ContentSyncConfigPath
            $syncConfig = Read-ContentJson $ContentSyncConfigPath
            if ((Get-ContentFullPath $syncConfig.root) -ne $Root -or $syncConfig.expectedUser -ne $ExpectedUser) {
                throw 'Installed content tools target a different root or PM2 owner.'
            }
            $previousEap = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                & $NodePath $tool prepare-release --config $ContentSyncConfigPath --release $newReleasePath --lock-held
                $prepareExit = $LASTEXITCODE
            } finally { $ErrorActionPreference = $previousEap }
            if ($prepareExit -ne 0) { throw "Content sidecar verification failed (exit $prepareExit)." }
            $candidateContentRoot = Join-Path $newReleasePath 'content-snapshot'
            $contentManifest = Read-ContentJson (Join-Path $candidateContentRoot 'manifest.json')
            if ([string]$contentManifest.commit -ne [string]$manifest.commit) { throw 'Sidecar content commit differs from release commit.' }
            $newContentCommit = [string]$contentManifest.commit
        }

        # Content-root preflight.
        #
        # A release that ships no content/ can only render news if the runtime
        # knows where to read it from. Publishing one without CONTENT_ROOT set
        # would come up green (server starts, /news returns 200) and show an
        # empty news list, empty leaderboard, and 404 images -- a silent
        # content outage that survives every health check in this script.
        # Detect the two release shapes from disk and refuse the bad pairing.
        $releaseContentDir = Join-Path $newReleasePath 'content'
        $releaseHasContent = Test-Path -LiteralPath $releaseContentDir
        $liveContentRoot = $null
        if ($live.env -and $live.env.PSObject.Properties['CONTENT_ROOT']) {
            $liveContentRoot = [string]$live.env.CONTENT_ROOT
        }
        if ($candidateContentRoot) {
            Write-Host "  content: verified release sidecar, commit=$newContentCommit"
        } elseif ($releaseHasContent) {
            Write-Host "  content: bundled in this release"
        } elseif ($liveContentRoot) {
            Write-Host "  content: external, CONTENT_ROOT=$liveContentRoot"
            if (-not (Test-Path -LiteralPath $liveContentRoot)) {
                throw ("Candidate ships no content/ and the inherited CONTENT_ROOT " +
                       "'$liveContentRoot' does not exist. Publishing would start the app " +
                       "with an empty news list. Fix CONTENT_ROOT or publish a release " +
                       "that bundles content.")
            }
        } else {
            throw ("Candidate ships no content/ and no CONTENT_ROOT is set on the live app. " +
                   "lib/news would fall back to <release>/content, which does not exist, " +
                   "and every news page would render empty. Either set CONTENT_ROOT on the " +
                   "running app or publish a release built without RELEASE_EXTERNAL_CONTENT=1.")
        }

        # Rollback baseline config stored privately under shared WITH A UNIQUE GUID NAME
        # so we never overwrite a config that state.previous still references.
        $rollbackConfigPath = Join-Path $SharedDir ("gdufsmc-rollback-" + [System.Guid]::NewGuid().ToString('N') + ".json")
        New-Pm2ConfigFromPm2Env $live $rollbackConfigPath

        # New candidate PM2 config (absolute server.js/cwd, explicit node interpreter).
        $newConfigPath = Join-Path $SharedDir ("gdufsmc-$($newId).json")
        $newServerJs = Join-Path $newReleasePath 'server.js'
        $deployEnv = New-DeployEnv $live.env
        if ($candidateContentRoot) { $deployEnv['CONTENT_ROOT'] = $Root }
        New-Pm2Config -Name 'gdufsmc' `
            -Script $newServerJs -Cwd $newReleasePath -Interpreter $NodePath `
            -Env $deployEnv -AppArgs @() -NodeAppArgs @('--max-old-space-size=768') `
            -OutFile (Join-Path $LogsDir "gdufsmc-$($newId)-out.log") `
            -ErrFile (Join-Path $LogsDir "gdufsmc-$($newId)-error.log") `
            -OutPath $newConfigPath

        # Pre-switch candidate health check on a random loopback port.
        $candidateEnv = $deployEnv.Clone()
        if ($candidateContentRoot) { $candidateEnv['CONTENT_ROOT'] = $candidateContentRoot }
        Test-CandidateHealth $newReleasePath $newServerJs $manifest $candidateEnv

        # Switch (with automatic revert on failure).
        $target = @{
            configPath = $newConfigPath
            releasePath= $newReleasePath
            # PM2 records pm_exec_path as the SCRIPT path (server.js), not the node
            # interpreter. Store the script path so Get-AppOnline's normalized exec
            # check matches the running app.
            execPath   = $newServerJs
            id         = [string]$manifest.id
            commit     = [string]$manifest.commit
            buildId    = [string]$manifest.buildId
        }
        if ($candidateContentRoot) {
            $target.contentSource = Join-Path $candidateContentRoot 'content'
            $target.contentOperationId = 'publish-' + [Guid]::NewGuid().ToString('N')
            $target.verifyWithContentWorker = $true
        }
        $revert = @{
            configPath = $rollbackConfigPath
            releasePath= [string]$oldReleasePath
            execPath   = [string]$live.pm_exec_path
            id         = [string]$oldId
            commit     = [string]$oldCommit
            buildId    = [string]$oldBuildId
        }

        try {
            $contentSwap = Invoke-DeploySwitch -Target $target -Revert $revert -RevertIsLegacy $oldLegacy
            $newState = [ordered]@{
                current  = [ordered]@{
                    id         = [string]$manifest.id
                    releasePath= $newReleasePath
                    configPath = $newConfigPath
                    execPath   = $newServerJs
                    legacy     = $false
                    commit     = [string]$manifest.commit
                    buildId    = [string]$manifest.buildId
                    contentCommit = $newContentCommit
                }
                previous = [ordered]@{
                    id         = [string]$oldId
                    releasePath= [string]$oldReleasePath
                    configPath = $rollbackConfigPath
                    execPath   = [string]$live.pm_exec_path
                    legacy     = $oldLegacy
                    commit     = [string]$oldCommit
                    buildId    = [string]$oldBuildId
                    contentCommit = $oldContentCommit
                    contentPath = if ($contentSwap) { [string]$contentSwap.backupPath } else { $null }
                }
            }
            try {
                $newContentState = New-PublishContentState -CodeCommit ([string]$manifest.commit) `
                    -ContentCommit $newContentCommit -PreviousContentCommit $oldContentCommit `
                    -BackupPath $(if ($contentSwap) { [string]$contentSwap.backupPath } else { $null })
                Write-PublishState -DeploymentState $newState -ContentState $newContentState
            } catch {
                # State commit failed: restore the previous app/content. State recovery
                # has its own failure flag; a partial restoration must keep the gate shut.
                Write-Warning "State commit failed: $_. Restoring previous app and content."
                try {
                    Invoke-Pm2 -ArgumentList @('stop', 'gdufsmc') -IgnoreExit | Out-Null
                    Invoke-Pm2 -ArgumentList @('delete', 'gdufsmc') -IgnoreExit | Out-Null
                    if ($contentSwap) {
                        Assert-AppStoppedForContent
                        Restore-ContentDirectorySwap -Root $Root -BackupPath $contentSwap.backupPath `
                            -OperationId ('state-failed-' + [Guid]::NewGuid().ToString('N')) | Out-Null
                    }
                    Invoke-Pm2 -ArgumentList @('start', $revert.configPath, '--only', 'gdufsmc') | Out-Null
                    if (-not (Get-AppOnline -ReleasePath $revert.releasePath -ExecPath $revert.execPath `
                            -Id $revert.id -Commit $revert.commit -BuildId $revert.buildId `
                            -IsLegacy $oldLegacy -Port 3000)) {
                        throw 'restore-after-state-failure health check failed'
                    }
                    if ($contentSwap) {
                        if (-not $oldLegacy) {
                            Assert-PublishWorkerHealth -Parent $Root -CodeCommit $revert.commit -ReleaseId $revert.id
                        } else { Assert-PublishContentHealth -Port 3000 -Parent $Root }
                    }
                    Invoke-Pm2 -ArgumentList @('save') | Out-Null
                    if ($contentSwap -and -not $script:PublishStateRecoveryFailed) {
                        Reset-PublishContentPurge -CodeCommit $revert.commit
                        Set-PublishJournalPhase -Phase 'rolled-back' -Completed
                    }
                } catch {
                    Write-Warning "CRITICAL: restore after state failure also failed: $_"
                }
                # The failed candidate release is intentionally retained for diagnosis.
                throw 'State write failed; restoration attempted. Check PM2, saved state and the maintenance journal before retrying.'
            }
            # Only the explicitly superseded release (the OLD previous, two versions
            # ago) may be cleaned. A legacy previous is never deleted (its path is
            # not under releases/), and a FAILED candidate is never in $RetiredIds,
            # so it is always retained for diagnosis.
            $retiredIds = @()
            if ($state -and $state.previous -and -not $state.previous.legacy -and $state.previous.id) {
                $retiredIds = @([string]$state.previous.id)
            }
            Clear-OldReleases -State $newState -RetiredIds $retiredIds
            Write-Host "DEPLOY SUCCEEDED: $([string]$manifest.id)"
            Invoke-EdgeOnePurge
        } catch {
            Write-Warning "DEPLOY FAILED: $_"
            # The failed candidate release under releases/<id> is retained for diagnosis.
            throw 'Deploy aborted; verify recovery warnings and the maintenance journal before retrying.'
        }
    }
} finally {
    if ($script:DeployLock) { $script:DeployLock.Close() }
}
