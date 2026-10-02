<# Controlled short maintenance window; Windows PowerShell 5.1. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][Alias('Config')][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$CandidateParent,
    [Parameter(Mandatory = $true)][string]$OperationId,
    [Parameter(Mandatory = $true)][string]$ContentCommit,
    [Parameter(Mandatory = $true)][string]$CodeCommit,
    [Parameter(Mandatory = $true)][string]$ReleaseId,
    [switch]$LockHeld,
    # How many <Root>/content-backups/<operationId> trees to keep after a
    # successful activation; oldest beyond this count are pruned. The current
    # operation id and the backup recorded in shared/content-state.json are
    # always kept on top of this count (rollback depends on them).
    # content-failed/ is a separate tree and is never touched.
    [ValidateRange(1, 500)][int]$ContentBackupRetention = 10
)
$ErrorActionPreference = 'Stop'
$env:NODE_OPTIONS = $null
$env:NODE_PATH = $null
. (Join-Path $PSScriptRoot 'content-operations.ps1')

function Invoke-ContentNode {
    param([string[]]$WorkerArguments)
    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $script:NodePath $script:Worker @WorkerArguments 2>&1)
        $commandExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }
    if ($commandExit -ne 0) { throw ('Trusted content command failed: ' + $WorkerArguments[0] + ' (exit ' + $commandExit + ').') }
}

function Invoke-ContentPm2 {
    param([ValidateSet('stop', 'restart')][string]$Action)
    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $script:Pm2Path $Action 'gdufsmc' 2>&1)
        $commandExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }
    if ($commandExit -ne 0) { throw ('PM2 ' + $Action + ' failed (exit ' + $commandExit + ').') }
}

function Get-ContentPm2App {
    # Hold raw JSON in memory only. PS5.1 cannot parse username/USERNAME keys.
    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $raw = (@(& $script:Pm2Path jlist 2>$null) -join "`n")
        $commandExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }
    if ($commandExit -ne 0) { throw 'PM2 jlist failed.' }
    $project = @'
const fs = require('fs');
try {
  const text = Buffer.from(fs.readFileSync(0, 'utf8').trim(), 'base64').toString('utf8')
    .replace(/^\uFEFF/, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
  let apps;
  const candidates = [text];
  for (let i = 0; i < text.length; i++) if (text[i] === '[' && (i === 0 || text[i - 1] === '\n')) candidates.push(text.slice(i));
  for (const candidate of candidates) {
    try { const parsed = JSON.parse(candidate); if (Array.isArray(parsed)) { apps = parsed; break; } } catch {}
  }
  if (!apps) throw new Error('bad app list');
  const result = apps.filter(app => app && app.name === 'gdufsmc').map(app => ({
    name: app.name, status: app.pm2_env?.status, pid: app.pid,
    cwd: app.pm2_env?.pm_cwd, script: app.pm2_env?.pm_exec_path,
    contentRoot: app.pm2_env?.CONTENT_ROOT ?? app.pm2_env?.env?.CONTENT_ROOT
  }));
  process.stdout.write(JSON.stringify(result).replace(/[\u007f-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')));
} catch { process.stderr.write('PM2 app projection failed.\n'); process.exitCode = 1; }
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($project))
    $bootstrap = "eval(Buffer.from('$encoded','base64').toString('utf8'))"
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($raw))
    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $projected = @($payload | & $script:NodePath -e $bootstrap 2>$null)
        $commandExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }
    if ($commandExit -ne 0) { throw 'Cannot obtain the safe PM2 app projection.' }
    $apps = @(($projected -join "`n") | ConvertFrom-Json)
    if ($apps.Count -ne 1) { throw 'Exactly one PM2 app named gdufsmc is required.' }
    return $apps[0]
}

function Assert-ContentPm2Release {
    param($App, [string]$ExpectedStatus)
    if ([string]$App.status -ne $ExpectedStatus) { throw ('PM2 status is not ' + $ExpectedStatus + '.') }
    if (-not (Get-ContentFullPath ([string]$App.cwd)).Equals($script:ReleasePath, [StringComparison]::OrdinalIgnoreCase)) { throw 'PM2 cwd differs from the private deployment state.' }
    if (-not (Get-ContentFullPath ([string]$App.script)).Equals($script:ExecPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'PM2 script differs from the private deployment state.' }
    if (-not (Get-ContentFullPath ([string]$App.contentRoot)).Equals($script:ConfiguredRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'PM2 CONTENT_ROOT differs from the trusted content configuration.' }
    if ($ExpectedStatus -eq 'stopped' -and [long]$App.pid -ne 0) { throw 'PM2 process did not stop.' }
    if ($ExpectedStatus -eq 'online' -and [long]$App.pid -le 0) { throw 'PM2 process is not running.' }
}

function Wait-ContentPm2 {
    param([string]$ExpectedStatus)
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try { Assert-ContentPm2Release (Get-ContentPm2App) $ExpectedStatus; return }
        catch { if ($attempt -eq 19) { throw }; Start-Sleep -Milliseconds 250 }
    }
}

function Set-ContentJournalPhase {
    param([string]$Phase, [bool]$Completed = $false)
    $script:Journal.phase = $Phase
    $script:Journal.completed = $Completed
    $script:Journal.updatedAt = [DateTime]::UtcNow.ToString('o')
    Write-ContentJsonAtomic $script:JournalPath $script:Journal
}

function Restore-ContentStateFile {
    param([string]$Path, [bool]$Existed, $Value, [string]$FailedName)
    if ($Existed) { Write-ContentJsonAtomic $Path $Value }
    elseif (Test-Path -LiteralPath $Path) {
        $failedPath = Join-Path (Split-Path -Parent $Path) $FailedName
        Assert-ContentNoReparse $failedPath
        if (Test-Path -LiteralPath $failedPath) { throw 'State recovery destination already exists.' }
        [IO.File]::Move($Path, $failedPath)
    }
}

$deploymentLock = $null
$journalStarted = $false
$maintenanceStarted = $false
$critical = $false
$backupPath = $null
$swapCompleted = $false
try {
    $toolRoot = Get-ContentFullPath (Split-Path -Parent $PSScriptRoot)
    $ConfigPath = Get-ContentFullPath $ConfigPath
    if (-not $ConfigPath.Equals((Join-Path $toolRoot 'config.json'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Only the installed content-tools/config.json is accepted.' }
    $config = Read-ContentJson $ConfigPath
    $root = Get-ContentFullPath ([string]$config.root)
    $script:ConfiguredRoot = $root
    if (-not $toolRoot.Equals((Join-Path $root 'content-tools'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Activator is not installed in the configured content-tools directory.' }
    Assert-ContentNoReparse $toolRoot
    Assert-ContentAdministrator
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    if (-not $identity.Equals([string]$config.expectedUser, [StringComparison]::OrdinalIgnoreCase)) { throw 'Activation must run as the configured PM2 owner.' }
    $pm2Home = Get-ContentFullPath ([string]$config.pm2Home)
    Assert-ContentNoReparse $pm2Home
    if ($env:PM2_HOME -and -not (Get-ContentFullPath $env:PM2_HOME).Equals($pm2Home, [StringComparison]::OrdinalIgnoreCase)) { throw 'PM2_HOME differs from the trusted configuration.' }
    $env:PM2_HOME = $pm2Home
    Assert-ContentOperationId $OperationId
    if ($ContentCommit -cnotmatch '^[a-f0-9]{40}$' -or $CodeCommit -cnotmatch '^[a-f0-9]{40}$') { throw 'Full lowercase commit hashes are required.' }
    $CandidateParent = Get-ContentFullPath $CandidateParent
    Assert-ContentPathWithinRoot $root $CandidateParent
    Assert-ContentNoReparse $CandidateParent -Recurse
    $script:NodePath = Get-ContentFullPath ([string]$config.nodePath)
    $script:Pm2Path = Get-ContentFullPath ([string]$config.pm2Path)
    $script:Worker = Join-Path $toolRoot 'scripts/content-sync.mjs'
    foreach ($path in @($script:NodePath, $script:Pm2Path, $script:Worker)) {
        Assert-ContentNoReparse $path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Trusted activation executable is missing.' }
    }
    if (-not $LockHeld) { $deploymentLock = Enter-ContentDeploymentLock (Join-Path $root 'shared/deployment.lock') }
    $script:JournalPath = Join-Path $root 'shared/content-journal.json'
    if (Test-Path -LiteralPath $script:JournalPath) {
        $unfinished = Read-ContentJson $script:JournalPath
        if ($unfinished.completed -ne $true) {
            if ([string]$unfinished.kind -eq 'program-publish') {
                throw ('Unfinished program publish journal: ' + $script:JournalPath + '. Administrator recovery: stop gdufsmc; inspect backupPath and oldAppConfig/newAppConfig; recover the matching code, content and private deployment state together; restart and verify the origin; only then mark the journal completed. Content activation cannot recover a program publish.')
            }
            throw ('Unfinished content journal: ' + $script:JournalPath + '. Administrator recovery: stop gdufsmc; inspect live content and journal.backupPath; restore the recorded backup and oldContentState/oldCodeProjection; restart and verify the origin; only then mark the journal completed. Do not submit another update first.')
        }
    }
    $deployment = Read-ContentJson (Join-Path $root 'shared/deployment-state.json')
    if ([string]$deployment.current.commit -cne $CodeCommit -or [string]$deployment.current.id -cne $ReleaseId) { throw 'Running deployment changed before content activation.' }
    $script:ReleasePath = Get-ContentFullPath ([string]$deployment.current.releasePath)
    $script:ExecPath = Get-ContentFullPath ([string]$deployment.current.execPath)
    Assert-ContentPathWithinRoot $root $script:ReleasePath
    Assert-ContentPathWithinRoot $script:ReleasePath $script:ExecPath
    Assert-ContentNoReparse $script:ReleasePath
    Assert-ContentPm2Release (Get-ContentPm2App) 'online'
    Invoke-ContentNode @('verify-candidate', '--parent', $CandidateParent, '--commit', $ContentCommit)

    $statePath = Join-Path $root 'shared/content-state.json'
    $projectionPath = Join-Path $root 'coordination/code/current.json'
    $stateExisted = Test-Path -LiteralPath $statePath -PathType Leaf
    $projectionExisted = Test-Path -LiteralPath $projectionPath -PathType Leaf
    $oldState = if ($stateExisted) { Read-ContentJson $statePath } else { $null }
    $oldProjection = if ($projectionExisted) { Read-ContentJson $projectionPath } else { $null }
    $previousCommit = if ($oldState -and [string]$oldState.contentCommit -cmatch '^[a-f0-9]{40}$') { [string]$oldState.contentCommit } else { $null }
    $backupPath = Join-Path $root ('content-backups/' + $OperationId + '/content')
    foreach ($operationPath in @(
        (Join-Path $root ('content-backups/' + $OperationId)),
        (Join-Path $root ('coordination/staging/' + $OperationId)),
        (Join-Path $root ('content-failed/' + $OperationId))
    )) {
        Assert-ContentNoReparse $operationPath
        if (Test-Path -LiteralPath $operationPath) { throw 'Operation id already has retained files; use a fresh operation id.' }
    }
    $script:Journal = [ordered]@{
        version = 1; kind = 'content-activation'; operationId = $OperationId; codeCommit = $CodeCommit; contentCommit = $ContentCommit
        releaseId = $ReleaseId; candidateParent = $CandidateParent; backupPath = $backupPath
        oldContentStateExists = [bool]$stateExisted; oldContentState = $oldState
        oldCodeProjectionExists = [bool]$projectionExisted; oldCodeProjection = $oldProjection
        phase = 'prepared'; completed = $false; updatedAt = [DateTime]::UtcNow.ToString('o')
    }
    Write-ContentJsonAtomic $script:JournalPath $script:Journal
    $journalStarted = $true
    $maintenanceStarted = $true
    Invoke-ContentPm2 'stop'
    Wait-ContentPm2 'stopped'
    Set-ContentJournalPhase 'stopped'
    Set-ContentJournalPhase 'swapping'
    $swap = Invoke-ContentDirectorySwap -Root $root -CandidateContent (Join-Path $CandidateParent 'content') -OperationId $OperationId
    $backupPath = [string]$swap.backupPath
    $swapCompleted = $true
    Set-ContentJournalPhase 'swapped'
    Invoke-ContentPm2 'restart'
    Wait-ContentPm2 'online'
    Set-ContentJournalPhase 'checking-health'
    Invoke-ContentNode @('health', '--config', $ConfigPath, '--parent', $CandidateParent, '--code-commit', $CodeCommit, '--release-id', $ReleaseId)
    Set-ContentJournalPhase 'writing-state'
    $now = [DateTime]::UtcNow.ToString('o')
    Write-ContentJsonAtomic $statePath ([ordered]@{
        version = 1; codeCommit = $CodeCommit; contentCommit = $ContentCommit
        previousContentCommit = $previousCommit; backupPath = $backupPath
        purge = [ordered]@{ status = 'pending'; updatedAt = $now }; updatedAt = $now
    })
    Write-ContentJsonAtomic $projectionPath ([ordered]@{
        version = 1; commit = $CodeCommit; releaseId = $ReleaseId; contentCommit = $ContentCommit
    })
    Set-ContentJournalPhase 'complete' $true
    # Housekeeping, deliberately AFTER the journal is complete: a failed
    # activation must never consume a retention slot, and a successful one
    # must never be rolled back by a pruning failure. Deletion problems are
    # warnings inside Clear-OldContentBackups, so this cannot turn a good
    # publish into a failed one.
    #
    # NOTE: stdout here is a machine contract -- scripts/content-sync.mjs does
    # JSON.parse() on it. Never Write-Host from this script; report the
    # retention outcome in the result object instead.
    $prune = Clear-OldContentBackups -Root $root -KeepOperationIds @(
        $OperationId
        $(if ($oldState -and $oldState.backupPath) { Split-Path -Leaf (Split-Path -Parent ([string]$oldState.backupPath)) })
    ) -Keep $ContentBackupRetention
    [ordered]@{
        success = $true; operationId = $OperationId; codeCommit = $CodeCommit; contentCommit = $ContentCommit
        backupPath = $backupPath; retainedBackups = $prune.retained; removedBackups = $prune.removed
    } | ConvertTo-Json -Compress -Depth 5
} catch {
    $failure = $_.Exception.Message
    if ($journalStarted -and $maintenanceStarted) {
        try {
            # Recovery cannot move either tree until the app is confirmed stopped.
            Invoke-ContentPm2 'stop'
            Wait-ContentPm2 'stopped'
            Set-ContentJournalPhase 'recovering'
            if (Test-Path -LiteralPath $backupPath -PathType Container) {
                $restored = Restore-ContentDirectorySwap -Root $root -BackupPath $backupPath -OperationId $OperationId
            } elseif ($swapCompleted) {
                throw 'A completed directory swap has lost its rollback backup.'
            } elseif (-not (Test-Path -LiteralPath (Join-Path $root 'content') -PathType Container)) {
                throw 'Both live content and the recorded backup are missing.'
            }
            Restore-ContentStateFile $statePath ([bool]$stateExisted) $oldState ('content-state.failed-' + $OperationId + '.json')
            Restore-ContentStateFile $projectionPath ([bool]$projectionExisted) $oldProjection ('current.failed-' + $OperationId + '.json')
            Invoke-ContentPm2 'restart'
            Wait-ContentPm2 'online'
            Invoke-ContentNode @('health', '--config', $ConfigPath, '--parent', $root, '--code-commit', $CodeCommit, '--release-id', $ReleaseId)
            if ($oldState) {
                # New HTML may have reached an empty CDN cache after restart and
                # before rollback. Preserve the old content version but require
                # a fresh purge, even if its previous purge had succeeded.
                $recoveredState = ($oldState | ConvertTo-Json -Depth 20) | ConvertFrom-Json
                $recoveryTime = [DateTime]::UtcNow.ToString('o')
                $recoveredState | Add-Member -NotePropertyName purge -NotePropertyValue ([ordered]@{ status = 'pending'; updatedAt = $recoveryTime }) -Force
                $recoveredState | Add-Member -NotePropertyName updatedAt -NotePropertyValue $recoveryTime -Force
                Write-ContentJsonAtomic $statePath $recoveredState
            }
            Set-ContentJournalPhase 'rolled-back' $true
        } catch {
            $critical = $true
            $failure += ' CRITICAL: recovery did not complete: ' + $_.Exception.Message + '. Keep every backup and inspect shared/content-journal.json before any further update.'
            try { Set-ContentJournalPhase 'recovery-failed' } catch { }
        }
    }
    [Console]::Error.WriteLine($failure)
    [ordered]@{ success = $false; critical = $critical; operationId = $OperationId; backupPath = $backupPath; message = $failure } | ConvertTo-Json -Compress
    exit 1
} finally {
    if ($deploymentLock) { $deploymentLock.Dispose() }
}
