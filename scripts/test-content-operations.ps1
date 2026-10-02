# Run with both Windows PowerShell 5.1 and PowerShell 7. No production paths,
# service changes, credentials or Administrator privileges are used.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/content-operations.ps1')
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$testRoot = Join-Path $temporaryParent ('gdufsmc-content-ops-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$passed = 0
$reader = $null
$junction = $null
function Assert-Test {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Expect-Throws {
    # $Pattern matches the message, $InnerType matches the INNER exception when
    # the failure is a method-invocation wrapper. Two things make a message-only
    # assertion unreliable here: .NET localises messages (a zh-CN host reports
    # "另一个进程正在使用此文件" where an en-US host says "The process cannot
    # access the file because it is being used by another process"), and
    # [IO.File]::Replace surfaces as MethodInvocationException rather than as
    # the IOException underneath it.
    param([scriptblock]$Action, [string]$Pattern, [string]$InnerType)
    try { & $Action } catch {
        $messageOk = ([string]$_ -match $Pattern)
        $typeOk = $true
        if ($InnerType) {
            $chain = @()
            $e = $_.Exception
            while ($null -ne $e) { $chain += $e.GetType().Name; $e = $e.InnerException }
            $typeOk = (($chain -join ',') -match $InnerType)
        }
        if (-not ($messageOk -and $typeOk)) {
            throw ("Unexpected failure: " + $_.Exception.GetType().Name + ": " + [string]$_ +
                   " (expected message '$Pattern'" +
                   $(if ($InnerType) { " and inner type '$InnerType'" }) + ")")
        }
        return
    }
    throw "Expected failure matching '$Pattern'."
}
try {
    $statePath = Join-Path $testRoot 'state.json'
    Assert-ContentPathWithinRoot $testRoot $statePath
    Expect-Throws { Assert-ContentPathWithinRoot $testRoot ($testRoot + '-other/state.json') } 'outside'
    Expect-Throws { Get-ContentFullPath 'relative/file.json' } 'absolute local'
    Expect-Throws { Get-ContentFullPath '\\server\share\file.json' } 'absolute local'
    Expect-Throws { Assert-ContentPathWithinRoot $testRoot 'Z:\other\state.json' } 'outside'
    $passed++; Write-Host 'PASS: path containment, relative/UNC and other-volume rejection'

    $target = Join-Path $testRoot 'junction-target'
    $junction = Join-Path $testRoot 'junction'
    New-Item -ItemType Directory -Path $target | Out-Null
    New-Item -ItemType Junction -Path $junction -Target $target | Out-Null
    Expect-Throws { Assert-ContentNoReparse $junction } 'Reparse'
    Expect-Throws { Assert-ContentNoReparse (Join-Path $junction 'missing/file.json') } 'Reparse'
    Expect-Throws { Assert-ContentNoReparse $testRoot -Recurse } 'Reparse'
    [IO.Directory]::Delete($junction)
    $junction = $null
    $passed++; Write-Host 'PASS: reparse point and ancestor rejection'

    Write-ContentJsonAtomic $statePath ([ordered]@{ version = 1; number = 0; text = 'initial' })
    Write-ContentJsonAtomic $statePath ([ordered]@{ version = 1; number = 1; text = 'replacement' })
    $actual = Read-ContentJson $statePath
    Assert-Test ($actual.number -eq 1 -and $actual.text -eq 'replacement') 'Atomic create/replace returned incorrect JSON.'
    Assert-Test (@(Get-ChildItem -LiteralPath $testRoot -Filter '.content-write-*').Count -eq 0) 'Successful replacement left temporary files.'
    $passed++; Write-Host 'PASS: create/replace JSON and cleanup using same-directory temporary files'

    $held = [IO.File]::Open($statePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $timer = [Diagnostics.Stopwatch]::StartNew()
        # The message is asserted loosely on purpose: it is localised. The
    # retry-exhaustion behaviour is what matters, and that is covered by the
    # IOException check on the wrapped inner exception.
    Expect-Throws { Write-ContentJsonAtomic $statePath @{ number = 2 } -Attempts 2 -RetryDelayMs 25 } '.' 'IOException'
        Assert-Test ($timer.Elapsed.TotalSeconds -lt 2) 'File-sharing retries were not bounded.'
    } finally { $held.Dispose() }
    Assert-Test ((Read-ContentJson $statePath).number -eq 1) 'Failed replacement changed the old JSON.'
    $passed++; Write-Host 'PASS: occupied file fails within bounded retry budget and keeps old value'

    $lockPath = Join-Path $testRoot 'deployment.lock'
    $held = Enter-ContentDeploymentLock $lockPath
    try { Expect-Throws { Enter-ContentDeploymentLock $lockPath -TimeoutSec 0 } 'lock busy' }
    finally { $held.Dispose() }
    $held = Enter-ContentDeploymentLock $lockPath -TimeoutSec 0
    $held.Dispose()
    $passed++; Write-Host 'PASS: exclusive deployment lock blocks contention and releases correctly'

    $testPm2Home = Join-Path $testRoot 'pm2-profile'
    New-Item -ItemType Directory -Path $testPm2Home | Out-Null
    Assert-ContentPm2Home -ExpectedHome $testPm2Home
    Assert-ContentPm2Home -ExpectedHome $testPm2Home -ConfiguredHome ($testPm2Home + '\')
    Expect-Throws { Assert-ContentPm2Home -ExpectedHome $testPm2Home -ConfiguredHome (Join-Path $testRoot 'another-pm2') } 'another daemon'
    Expect-Throws { Assert-ContentPm2Home -ExpectedHome (Join-Path $testRoot 'missing-pm2') } 'directory missing'
    $passed++; Write-Host 'PASS: setup PM2 home guard rejects alternate daemon homes and missing profile directories'

    $readyPath = Join-Path $testRoot 'reader-ready'
    $donePath = Join-Path $testRoot 'writer-done'
    Write-ContentJsonAtomic $statePath @{ number = 0; payload = ('x' * 8192) }
    $reader = Start-Job -ArgumentList $statePath, $readyPath, $donePath -ScriptBlock {
        param($Path, $Ready, $Done)
        $ErrorActionPreference = 'Stop'
        [IO.File]::WriteAllText($Ready, 'ready')
        $seen = 0
        $gaps = 0
        $timer = [Diagnostics.Stopwatch]::StartNew()
        do {
            try {
                $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read,
                    ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
            } catch [IO.IOException] {
                # Windows ReplaceFile may briefly hide the name. All private-state
                # users share the deployment lock; public projection readers retry.
                $gaps++
                Start-Sleep -Milliseconds 5
                continue
            }
            $textReader = New-Object IO.StreamReader($stream)
            try { $value = $textReader.ReadToEnd() | ConvertFrom-Json }
            finally { $textReader.Dispose(); $stream.Dispose() }
            if ($value.number -lt 0 -or $value.number -gt 100 -or $value.payload.Length -ne 8192) {
                throw 'A reader saw partial or malformed JSON.'
            }
            $seen++
        } while (-not [IO.File]::Exists($Done) -and $timer.Elapsed.TotalSeconds -lt 15)
        if ($seen -eq 0) { throw 'The concurrent reader did not observe any versions.' }
        return @{ seen = $seen; retriedNameGaps = $gaps }
    }
    $start = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath $readyPath) -and $start.Elapsed.TotalSeconds -lt 10) { Start-Sleep -Milliseconds 25 }
    Assert-Test (Test-Path -LiteralPath $readyPath) 'Concurrent reader did not start.'
    for ($i = 1; $i -le 100; $i++) {
        Write-ContentJsonAtomic $statePath @{ number = $i; payload = ('x' * 8192) }
        Start-Sleep -Milliseconds 2
    }
    [IO.File]::WriteAllText($donePath, 'done')
    $null = Wait-Job $reader -Timeout 10
    if ($reader.State -eq 'Failed') { Receive-Job $reader -ErrorAction Stop }
    Assert-Test ($reader.State -eq 'Completed') ('Concurrent reader failed: ' + $reader.State)
    $observations = Receive-Job $reader -ErrorAction Stop
    Assert-Test ([int]$observations.seen -gt 0) 'Concurrent reader returned no observations.'
    $passed++; Write-Host "PASS: concurrent reader saw $($observations.seen) complete documents; retried $($observations.retriedNameGaps) transient name gaps"

    $projection = Get-ContentDeploymentProjection @{ commit = ('a' * 40); id = '123-1-aaaaaaa' }
    Assert-Test ($projection.version -eq 1 -and $projection.releaseId -eq '123-1-aaaaaaa') 'Incorrect code projection.'
    Expect-Throws { Get-ContentDeploymentProjection @{ commit = 'short'; id = 'bad' } } 'full commit'
    $passed++; Write-Host 'PASS: code projection validates full commit and release id'

    $swapRoot = Join-Path $testRoot 'site'
    $live = Join-Path $swapRoot 'content'
    $candidate = Join-Path $swapRoot 'release/content-snapshot/content'
    New-Item -ItemType Directory -Path $live -Force | Out-Null
    New-Item -ItemType Directory -Path $candidate -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $live 'version.txt'), 'old')
    [IO.File]::WriteAllText((Join-Path $candidate 'version.txt'), 'new')
    Expect-Throws { Invoke-ContentDirectorySwap -Root $swapRoot -CandidateContent $live -OperationId 'same' } 'separate'
    Expect-Throws { Invoke-ContentDirectorySwap -Root $swapRoot -CandidateContent $testRoot -OperationId 'outside' } 'outside'
    $swap = Invoke-ContentDirectorySwap -Root $swapRoot -CandidateContent $candidate -OperationId 'test-switch'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $live 'version.txt')) -eq 'new') 'New content was not activated.'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $swap.backupPath 'version.txt')) -eq 'old') 'Old content was not backed up.'
    Assert-Test (Test-Path -LiteralPath (Join-Path $candidate 'version.txt')) 'Candidate source was moved instead of copied.'
    Expect-Throws { Invoke-ContentDirectorySwap -Root $swapRoot -CandidateContent $candidate -OperationId 'test-switch' } 'already exists'
    $restored = Restore-ContentDirectorySwap -Root $swapRoot -BackupPath $swap.backupPath -OperationId 'failed-switch'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $live 'version.txt')) -eq 'old') 'Content recovery did not restore the original.'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $restored.failedPath 'version.txt')) -eq 'new') 'Failed content was not retained.'
    $passed++; Write-Host 'PASS: directory swap, retained source/backup, duplicate rejection and recovery'

    # Load only named function definitions, never the publisher's top-level script.
    $publisherPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/publish-release.ps1'
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($publisherPath, [ref]$tokens, [ref]$parseErrors)
    Assert-Test ($parseErrors.Count -eq 0) 'Publisher has syntax errors.'
    foreach ($name in @('Invoke-DeploySwitch', 'New-PublishContentState', 'Write-PublishState', 'Set-PublishJournalPhase', 'Assert-AppStoppedForContent', 'Reset-PublishContentPurge')) {
        $definition = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true) |
            Where-Object { $_.Name -eq $name } | Select-Object -First 1
        Invoke-Expression $definition.Extent.Text
    }
    $Root = $swapRoot
    $ContentStateFile = Join-Path $Root 'shared/content-state.json'
    New-Item -ItemType Directory -Path (Join-Path $Root 'shared') -Force | Out-Null
    $script:mockActiveConfig = 'old-config'
    $script:mockRegistered = $true
    $script:mockFailCandidate = $false
    $script:mockFailOldApp = $false
    $script:mockStarts = @()
    function Invoke-Pm2 {
        param($ArgumentList, [switch]$IgnoreExit)
        if ($ArgumentList[0] -eq 'start') {
            $script:mockActiveConfig = $ArgumentList[1]; $script:mockRegistered = $true
            $script:mockStarts += $ArgumentList[1]
        }
        if ($ArgumentList[0] -eq 'delete') { $script:mockRegistered = $false }
    }
    function Get-Pm2AppList {
        if (-not $script:mockRegistered) { return @() }
        $cwd = if ($script:mockActiveConfig -eq 'new-config') { 'new-release' } else { 'old-release' }
        return @([pscustomobject]@{ name = 'gdufsmc'; pm2_env = [pscustomobject]@{ pm_cwd = $cwd; status = 'online' } })
    }
    function Get-AppOnline {
        param($ReleasePath, $ExecPath, $Id, $Commit, $BuildId, $IsLegacy, $Port)
        return (-not (($script:mockFailCandidate -and $ReleasePath -eq 'new-release') -or
            ($script:mockFailOldApp -and $ReleasePath -eq 'old-release')))
    }
    $script:contentHealthVersions = @()
    $script:mockFailOldContentHealth = $false
    function Assert-PublishContentHealth {
        param($Port, $Parent)
        $version = [IO.File]::ReadAllText((Join-Path $Parent 'content/version.txt'))
        $script:contentHealthVersions += $version
        if ($script:mockFailOldContentHealth -and $version -eq 'old') { throw 'Injected old content health failure' }
    }
    $targetApp = @{ configPath = 'new-config'; releasePath = 'new-release'; id = 'new'; commit = ('b' * 40)
        contentSource = $candidate; contentOperationId = 'publisher-success' }
    $oldApp = @{ configPath = 'old-config'; releasePath = 'old-release'; id = 'old'; commit = ('a' * 40) }
    $published = Invoke-DeploySwitch -Target $targetApp -Revert $oldApp -RevertIsLegacy $false
    $journalPath = Join-Path $Root 'shared/content-journal.json'
    $savedJournal = Read-ContentJson $journalPath
    Assert-Test ($savedJournal.oldDeploymentStateExists -eq $false -and $savedJournal.oldContentStateExists -eq $false -and $savedJournal.oldCodeProjectionExists -eq $false) 'Journal fabricated a pre-migration state baseline.'
    Assert-Test ($script:mockActiveConfig -eq 'new-config') 'Publisher did not select new app.'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $live 'version.txt')) -eq 'new') 'Publisher did not activate candidate content.'
    Restore-ContentDirectorySwap -Root $Root -BackupPath $published.backupPath -OperationId 'reset-publisher-success' | Out-Null
    $script:mockActiveConfig = 'old-config'
    $script:mockFailCandidate = $true
    $targetApp.contentOperationId = 'publisher-failure'
    Expect-Throws { Invoke-DeploySwitch -Target $targetApp -Revert $oldApp -RevertIsLegacy $false } 'Switch failed'
    Assert-Test ($script:mockActiveConfig -eq 'old-config') 'Publisher did not restore old app after failed health.'
    Assert-Test ([IO.File]::ReadAllText((Join-Path $live 'version.txt')) -eq 'old') 'Publisher did not restore old content after failed health.'
    Assert-Test ($script:contentHealthVersions[-1] -eq 'old') 'Recovered content was not health checked.'
    $passed++; Write-Host 'PASS: publisher switches paired content and restores app/content when candidate health fails (PM2 mocked)'

    # Reproduce a first-move success followed by both activation and helper recovery
    # failing: the helper throws before it can return its backup descriptor.
    $realSwap = (Get-Command Invoke-ContentDirectorySwap).ScriptBlock
    function Invoke-ContentDirectorySwap {
        param($Root, $CandidateContent, $OperationId)
        $backup = Join-Path $Root ('content-backups/' + $OperationId + '/content')
        New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
        [IO.Directory]::Move((Join-Path $Root 'content'), $backup)
        throw 'Injected failure after moving live content, without a returned swap descriptor'
    }
    try {
        $script:mockFailCandidate = $false
        $targetApp.contentOperationId = 'publisher-half-swap'
        Expect-Throws { Invoke-DeploySwitch -Target $targetApp -Revert $oldApp -RevertIsLegacy $false } 'Switch failed'
        Assert-Test ([IO.File]::ReadAllText((Join-Path $live 'version.txt')) -eq 'old') 'Journal backup did not recover a half-finished directory swap.'
        Assert-Test ($script:mockActiveConfig -eq 'old-config') 'Old app did not recover after half-finished directory swap.'
        Assert-Test ((Read-ContentJson $journalPath).completed -eq $true) 'Recovered half-swap was not completed after old content health passed.'
        $script:mockFailOldContentHealth = $true
        $targetApp.contentOperationId = 'publisher-half-swap-unhealthy'
        Expect-Throws { Invoke-DeploySwitch -Target $targetApp -Revert $oldApp -RevertIsLegacy $false } 'Switch failed'
        Assert-Test ((Read-ContentJson $journalPath).completed -eq $false) 'Unhealthy recovered content incorrectly opened the journal gate.'
    } finally {
        Set-Item -Path function:Invoke-ContentDirectorySwap -Value $realSwap
        $script:mockFailOldContentHealth = $false
    }
    $passed++; Write-Host 'PASS: publisher recovers a half-finished swap from its journal, and refuses completion if old content health fails'

    $secondRecoverySwap = Invoke-ContentDirectorySwap -Root $Root -CandidateContent $candidate -OperationId 'publisher-secondary-recovery'
    $secondaryTarget = $oldApp.Clone()
    $secondaryTarget.restoreContentBackup = $secondRecoverySwap.backupPath
    $script:mockStarts = @()
    $script:mockFailOldApp = $true
    try {
        Expect-Throws { Invoke-DeploySwitch -Target $secondaryTarget -Revert $targetApp -RevertIsLegacy $false } 'CRITICAL: recovery switch failed'
        Assert-Test (-not $script:mockRegistered) 'Failed secondary recovery left an application registered.'
        Assert-Test ($script:mockStarts.Count -eq 1 -and $script:mockStarts[0] -eq 'old-config') 'Secondary recovery attempted to start candidate code against restored old content.'
        Assert-Test ([IO.File]::ReadAllText((Join-Path $live 'version.txt')) -eq 'old') 'Secondary recovery lost the recovered original content.'
        Assert-Test ((Read-ContentJson $journalPath).completed -eq $false) 'Failed secondary recovery reopened the maintenance gate.'
    } finally {
        $script:mockFailOldApp = $false
        $script:mockRegistered = $true
    }
    $passed++; Write-Host 'PASS: failed secondary recovery stops the app without launching a mismatched code/content pair'

    $setupPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/setup-content-sync.ps1'
    $beforeInspect = @(Get-ChildItem -LiteralPath $Root -Recurse -Force | ForEach-Object { $_.FullName } | Sort-Object)
    $inspection = (& $setupPath -Root $Root -Inspect | Out-String) | ConvertFrom-Json
    $afterInspect = @(Get-ChildItem -LiteralPath $Root -Recurse -Force | ForEach-Object { $_.FullName } | Sort-Object)
    Assert-Test ($inspection.mode -eq 'Inspect') 'Setup did not default to a read-only inspection.'
    Assert-Test (@(Compare-Object $beforeInspect $afterInspect).Count -eq 0) 'Setup Inspect wrote files.'
    $passed++; Write-Host 'PASS: setup inspection creates no files or scheduled tasks'

    # Inspect ACL objects without applying them to local files or elevating this test.
    function Set-Acl { param($LiteralPath, $AclObject) $script:lastTestAcl = $AclObject }
    $runnerSid = Resolve-ContentRunnerSid 'NT AUTHORITY\NETWORK SERVICE'
    Set-ContentManagedAcl -Path $Root -RunnerSid $runnerSid -RunnerRights Modify
    $rules = @($script:lastTestAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $runnerSid.Value })
    Assert-Test ($script:lastTestAcl.AreAccessRulesProtected -and $rules.Count -eq 1) 'Queue ACL lacks protected runner rule.'
    Assert-Test (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0) 'Queue ACL cannot accept requests.'
    Set-ContentManagedAcl -Path $Root -RunnerSid $runnerSid
    $rules = @($script:lastTestAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $runnerSid.Value })
    Assert-Test (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -eq 0) 'Code/results ACL grants runner write.'
    Set-ContentManagedAcl -Path $Root -RunnerSid $runnerSid -AdminOnly
    $rules = @($script:lastTestAcl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $runnerSid.Value })
    Assert-Test ($rules.Count -eq 0) 'Staging ACL includes a runner rule.'
    $passed++; Write-Host 'PASS: ACL plans limit runner writes to queue and exclude staging (Set-Acl mocked)'

    $StateFile = Join-Path $Root 'shared/deployment-state.json'
    $ContentStateFile = Join-Path $Root 'shared/content-state.json'
    $ContentSyncConfigPath = Join-Path $Root 'content-tools/config.json'
    $ProjectionFile = Join-Path $Root 'coordination/code/current.json'
    foreach ($path in @($StateFile, $ContentStateFile, $ContentSyncConfigPath, $ProjectionFile)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    }
    [IO.File]::WriteAllText($ContentSyncConfigPath, '{}')
    $oldDeployment = @{ current = @{ commit = ('a' * 40); id = 'old-release' } }
    $oldContent = New-PublishContentState -CodeCommit ('a' * 40) -ContentCommit ('c' * 40) -PreviousContentCommit $null -BackupPath $null
    $oldContent.purge = @{ status = 'complete'; jobId = 'old-purge'; updatedAt = 'before' }
    Write-PublishState -DeploymentState $oldDeployment -ContentState $oldContent
    $script:mockFailCandidate = $true
    $targetApp.contentOperationId = 'publisher-journal-originals'
    Expect-Throws { Invoke-DeploySwitch -Target $targetApp -Revert $oldApp -RevertIsLegacy $false } 'Switch failed'
    $savedJournal = Read-ContentJson $journalPath
    Assert-Test ($savedJournal.oldDeploymentStateExists -and $savedJournal.oldDeploymentState.current.id -eq 'old-release') 'Journal lost the actual previous deployment state.'
    Assert-Test ($savedJournal.oldContentStateExists -and $savedJournal.oldContentState.contentCommit -eq ('c' * 40)) 'Journal confused content-only updates with the code commit.'
    Assert-Test ($savedJournal.oldCodeProjectionExists -and $savedJournal.oldCodeProjection.commit -eq ('a' * 40)) 'Journal lost the previous code projection.'
    $recoveredContent = Read-ContentJson $ContentStateFile
    Assert-Test ($recoveredContent.purge.status -eq 'pending' -and -not $recoveredContent.purge.PSObject.Properties['jobId']) 'Restored content reused an old CDN purge job.'
    $passed++; Write-Host 'PASS: program journal records exact original state and recovery schedules a fresh purge'
    $script:realAtomicWrite = (Get-Command Write-ContentJsonAtomic).ScriptBlock
    $script:failStateWriteOnce = $true
    $script:failStatePath = $StateFile
    function Write-ContentJsonAtomic {
        param($Path, $Value)
        if ($script:failContentRecovery -and $Path -eq $ContentStateFile -and $Value.codeCommit -eq ('a' * 40)) {
            throw 'Injected content-state recovery failure'
        }
        if ($script:failStateWriteOnce -and $Path -eq $script:failStatePath) {
            $script:failStateWriteOnce = $false
            throw 'Injected private-state write failure'
        }
        & $script:realAtomicWrite -Path $Path -Value $Value
    }
    $newDeployment = @{ current = @{ commit = ('b' * 40); id = 'new-release' } }
    $newContent = New-PublishContentState -CodeCommit ('b' * 40) -ContentCommit ('b' * 40) -PreviousContentCommit ('a' * 40) -BackupPath 'retained'
    Expect-Throws { Write-PublishState -DeploymentState $newDeployment -ContentState $newContent } 'Injected'
    Assert-Test ((Read-ContentJson $StateFile).current.commit -eq ('a' * 40)) 'Private deployment state did not recover.'
    Assert-Test ((Read-ContentJson $ContentStateFile).codeCommit -eq ('a' * 40)) 'Content state did not recover.'
    Assert-Test ((Read-ContentJson $ProjectionFile).commit -eq ('a' * 40)) 'Public code projection did not recover.'
    $journalPath = Join-Path $Root 'shared/content-journal.json'
    & $script:realAtomicWrite -Path $journalPath -Value @{ kind = 'program-publish'; completed = $false; phase = 'app-online'; updatedAt = 'before' }
    $script:failStatePath = $journalPath
    $script:failStateWriteOnce = $true
    Expect-Throws { Write-PublishState -DeploymentState $newDeployment -ContentState $newContent } 'Injected'
    Assert-Test ((Read-ContentJson $StateFile).current.commit -eq ('a' * 40)) 'Late journal failure did not restore deployment state.'
    Assert-Test ((Read-ContentJson $ContentStateFile).codeCommit -eq ('a' * 40)) 'Late journal failure did not restore content state.'
    Assert-Test ((Read-ContentJson $ProjectionFile).commit -eq ('a' * 40)) 'Late journal failure did not restore projection.'
    Assert-Test ((Read-ContentJson $journalPath).completed -eq $false) 'Late journal failure incorrectly claimed completion.'
    $passed++; Write-Host 'PASS: coordinated publisher state/projection writes restore previous values on failure'

    $script:failStatePath = $StateFile
    $script:failStateWriteOnce = $true
    $script:failContentRecovery = $true
    Expect-Throws { Write-PublishState -DeploymentState $newDeployment -ContentState $newContent } 'CRITICAL: state recovery incomplete'
    Assert-Test ($script:PublishStateRecoveryFailed) 'Partial state restoration did not report a critical failure.'
    Assert-Test ((Read-ContentJson $ContentStateFile).codeCommit -eq ('b' * 40)) 'Fault injection did not leave a mixed state as intended.'
    Assert-Test ((Read-ContentJson $ProjectionFile).commit -eq ('a' * 40)) 'Other recoverable state was not restored.'
    Assert-Test ((Read-ContentJson $journalPath).completed -eq $false) 'Partial state restoration reopened the maintenance gate.'
    Expect-Throws { Set-PublishJournalPhase -Phase 'rolled-back' -Completed } 'state recovery is incomplete'
    Assert-Test ((Read-ContentJson $journalPath).phase -eq 'recovery-failed') 'Critical recovery journal was not preserved.'
    $script:failContentRecovery = $false
    $passed++; Write-Host 'PASS: partial state recovery keeps an unfinished journal and rejects a later completion attempt'
    Write-Host "ALL $passed CONTENT OPERATION TESTS PASSED (PowerShell $($PSVersionTable.PSVersion))"
} finally {
    if ($reader) { Stop-Job $reader -ErrorAction SilentlyContinue; Remove-Job $reader -Force -ErrorAction SilentlyContinue }
    if ($junction -and (Test-Path -LiteralPath $junction)) { [IO.Directory]::Delete($junction) }
    # Verify the only recursive deletion target belongs to this test invocation.
    Assert-ContentPathWithinRoot $temporaryParent $testRoot
    if ((Split-Path -Leaf $testRoot) -notmatch '^gdufsmc-content-ops-[0-9a-f]{32}$') { throw 'Unsafe test cleanup target.' }
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}
