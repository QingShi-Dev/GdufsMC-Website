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
    itself IS written atomically (temp file + File.Replace); the PM2 stop/start is not.

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

    State is stored atomically in <Root>/shared/deployment-state.json, protected by a
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
            [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit,
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
        ($out | Out-String) | Out-File -LiteralPath $Pm2OpLog -Append -Encoding $Utf8NoBom
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
    return @($raw | ConvertFrom-Json)
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
        [System.IO.File]::Replace($tmp, $StateFile, $null)
    } else {
        [System.IO.File]::Move($tmp, $StateFile)
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
    param([string]$ReleasePath, [string]$ServerJs, [object]$Manifest)
    $port = Get-FreeTcpPort
    $cEnv = New-DeployEnv $liveEnv
    $cEnv['PORT'] = [string]$port
    $cOut = Join-Path $CandidateLogsDir "candidate-$([string]$Manifest.id).out.log"
    $cErr = Join-Path $CandidateLogsDir "candidate-$([string]$Manifest.id).err.log"
    $restore = Set-EnvSnapshot $cEnv
    $proc = $null
    try {
        # Quote the path so spaces in the release path are handled safely.
        $proc = Start-Process -FilePath $NodePath -ArgumentList @("`"$ServerJs`"") `
            -WorkingDirectory $ReleasePath -PassThru -NoNewWindow `
            -RedirectStandardOutput $cOut -RedirectStandardError $cErr
        if ($proc.HasExited) { throw "candidate process exited immediately (code $($proc.ExitCode))" }
        if (-not (Test-HealthEndpoint -Port $port -Id ([string]$Manifest.id) -Commit ([string]$Manifest.commit) -BuildId ([string]$Manifest.buildId) -IsLegacy $false)) {
            throw 'candidate health check (marker + homepage 200) failed'
        }
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
    try {
        Invoke-Pm2 -ArgumentList @('stop', 'gdufsmc') -IgnoreExit | Out-Null
        Invoke-Pm2 -ArgumentList @('delete', 'gdufsmc') -IgnoreExit | Out-Null
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
        Invoke-Pm2 -ArgumentList @('save') | Out-Null
    } catch {
        # Write-Warning (not Write-Error) so we do NOT abort before reverting.
        Write-Warning "Switch error: $_"
        try {
            Invoke-Pm2 -ArgumentList @('stop', 'gdufsmc') -IgnoreExit | Out-Null
            Invoke-Pm2 -ArgumentList @('delete', 'gdufsmc') -IgnoreExit | Out-Null
            Invoke-Pm2 -ArgumentList @('start', $Revert.configPath, '--only', 'gdufsmc') | Out-Null
            if (-not (Get-AppOnline -ReleasePath $Revert.releasePath -ExecPath $Revert.execPath `
                    -Id $Revert.id -Commit $Revert.commit -BuildId $Revert.buildId `
                    -IsLegacy $RevertIsLegacy -Port 3000)) {
                throw 'revert health check failed'
            }
            Invoke-Pm2 -ArgumentList @('save') | Out-Null
            Write-Warning "Automatically reverted to the previous application."
        } catch {
            Write-Warning "CRITICAL: automatic revert also failed: $_"
        }
        throw "Switch failed; deployment-state.json was NOT modified."
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
# Main
# ===========================================================================
Assert-AncestorNoReparse

# Acquire exclusive lock for the whole operation (prevents concurrent publishes).
$script:DeployLock = Lock-Deployment $LockFile
try {
    $state = Read-StateFile $StateFile

    if ($Rollback) {
        # ---------------- ROLLBACK MODE ----------------
        if (-not $state) { throw 'No deployment-state.json found; cannot rollback.' }
        if (-not $state.previous) { throw 'No previous deployment recorded; cannot rollback.' }
        $prev = $state.previous
        $cur  = $state.current

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
            Invoke-DeploySwitch -Target $target -Revert $revert -RevertIsLegacy $revertIsLegacy `
                -TargetIsLegacy ([bool]$prev.legacy)
            $tmp = $state.current
            $state.current = $state.previous
            $state.previous = $tmp
            try {
                Write-StateAtomic -StateFile $StateFile -State $state
                Write-Host "ROLLBACK SUCCEEDED to $([string]$target.id)"
            } catch {
                # The live app is already running the previous version, but the state
                # file could not be written. Switch the live app BACK to current so we
                # never leave a running app that disagrees with the recorded state, and
                # report the REAL outcome. We must NOT claim rollback succeeded.
                Write-Warning "Rollback switch succeeded but state write failed: $_. Restoring current app."
                try {
                    Invoke-DeploySwitch -Target $revert -Revert $target -RevertIsLegacy ([bool]$prev.legacy) `
                        -TargetIsLegacy $revertIsLegacy
                } catch {
                    Write-Warning "CRITICAL: restore to current after state-failure also failed: $_"
                }
                throw "Rollback failed: state write failed; restoration attempted. Verify PM2 health and warnings above. State unchanged."
            }
        } catch {
            Write-Warning "ROLLBACK FAILED: $_"
            throw "Rollback aborted; state unchanged."
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

        # Copy (never move); keep the original incoming artifact intact.
        Copy-Item -LiteralPath $ReleaseDirectory -Destination $newReleasePath -Recurse -Force
        # Re-validate the copied release (buildId marker + id) at the target.
        Assert-ReleaseStructure $newReleasePath $manifest

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

        # Rollback baseline config stored privately under shared WITH A UNIQUE GUID NAME
        # so we never overwrite a config that state.previous still references.
        $rollbackConfigPath = Join-Path $SharedDir ("gdufsmc-rollback-" + [System.Guid]::NewGuid().ToString('N') + ".json")
        New-Pm2ConfigFromPm2Env $live $rollbackConfigPath

        # New candidate PM2 config (absolute server.js/cwd, explicit node interpreter).
        $newConfigPath = Join-Path $SharedDir ("gdufsmc-$($newId).json")
        $newServerJs = Join-Path $newReleasePath 'server.js'
        $deployEnv = New-DeployEnv $live.env
        New-Pm2Config -Name 'gdufsmc' `
            -Script $newServerJs -Cwd $newReleasePath -Interpreter $NodePath `
            -Env $deployEnv -AppArgs @() -NodeAppArgs @('--max-old-space-size=768') `
            -OutFile (Join-Path $LogsDir "gdufsmc-$($newId)-out.log") `
            -ErrFile (Join-Path $LogsDir "gdufsmc-$($newId)-error.log") `
            -OutPath $newConfigPath

        # Pre-switch candidate health check on a random loopback port.
        Test-CandidateHealth $newReleasePath $newServerJs $manifest

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
        $revert = @{
            configPath = $rollbackConfigPath
            releasePath= [string]$oldReleasePath
            execPath   = [string]$live.pm_exec_path
            id         = [string]$oldId
            commit     = [string]$oldCommit
            buildId    = [string]$oldBuildId
        }

        try {
            Invoke-DeploySwitch -Target $target -Revert $revert -RevertIsLegacy $oldLegacy
            $newState = [ordered]@{
                current  = [ordered]@{
                    id         = [string]$manifest.id
                    releasePath= $newReleasePath
                    configPath = $newConfigPath
                    execPath   = $newServerJs
                    legacy     = $false
                    commit     = [string]$manifest.commit
                    buildId    = [string]$manifest.buildId
                }
                previous = [ordered]@{
                    id         = [string]$oldId
                    releasePath= [string]$oldReleasePath
                    configPath = $rollbackConfigPath
                    execPath   = [string]$live.pm_exec_path
                    legacy     = $oldLegacy
                    commit     = [string]$oldCommit
                    buildId    = [string]$oldBuildId
                }
            }
            try {
                Write-StateAtomic -StateFile $StateFile -State $newState
            } catch {
                # State commit failed: automatically restore the previous app + pm2 save
                # so the live system is consistent, and leave the OLD state unchanged.
                Write-Warning "State commit failed: $_. Restoring previous app; old state retained."
                try {
                    Invoke-Pm2 -ArgumentList @('stop', 'gdufsmc') -IgnoreExit | Out-Null
                    Invoke-Pm2 -ArgumentList @('delete', 'gdufsmc') -IgnoreExit | Out-Null
                    Invoke-Pm2 -ArgumentList @('start', $revert.configPath, '--only', 'gdufsmc') | Out-Null
                    if (-not (Get-AppOnline -ReleasePath $revert.releasePath -ExecPath $revert.execPath `
                            -Id $revert.id -Commit $revert.commit -BuildId $revert.buildId `
                            -IsLegacy $oldLegacy -Port 3000)) {
                        throw 'restore-after-state-failure health check failed'
                    }
                    Invoke-Pm2 -ArgumentList @('save') | Out-Null
                } catch {
                    Write-Warning "CRITICAL: restore after state failure also failed: $_"
                }
                # The failed candidate release is intentionally retained for diagnosis.
                throw "State write failed; restoration attempted, old state retained. Verify PM2 health and warnings above."
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
        } catch {
            Write-Warning "DEPLOY FAILED: $_"
            # The failed candidate release under releases/<id> is retained for diagnosis.
            throw "Deploy aborted; deployment-state.json was NOT modified."
        }
    }
} finally {
    if ($script:DeployLock) { $script:DeployLock.Close() }
}
