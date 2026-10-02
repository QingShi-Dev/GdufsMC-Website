# Real ZIP/tar/filesystem and child-process tests. No production paths or services.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$deploy = Join-Path $repo 'deploy'
. (Join-Path $deploy 'content-operations.ps1')
. (Join-Path $deploy 'artifact-operations.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$temporaryParent = Get-ContentFullPath ([IO.Path]::GetTempPath())
$testRoot = Join-Path $temporaryParent ('gdufsmc-artifacts-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
# Run the real scripts against isolated tools; only elevation is stubbed.
$sourceDeploy = $deploy
$deploy = Join-Path $testRoot 'test-tools'
New-Item -ItemType Directory -Path $deploy | Out-Null
foreach ($file in @('content-operations.ps1', 'artifact-operations.ps1', 'publish-from-artifacts.ps1', 'process-release-queue.ps1', 'submit-release.ps1', 'setup-release-publish.ps1', 'publish-release.ps1')) {
    Copy-Item -LiteralPath (Join-Path $sourceDeploy $file) -Destination (Join-Path $deploy $file)
}
Add-Content -LiteralPath (Join-Path $deploy 'content-operations.ps1') -Value "`nfunction Assert-ContentAdministrator { }"
$testPublisherOptions = @{ ExpectedUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name }
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$tar = Join-Path $env:SystemRoot 'System32/tar.exe'
$passed = 0
$job = $null
function Assert-Test {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Expect-Failure {
    param([scriptblock]$Action, [string]$Pattern)
    try { & $Action } catch {
        if ([string]$_ -notmatch $Pattern) { throw "Unexpected error (expected $Pattern): $_" }
        return
    }
    throw "Expected failure: $Pattern"
}
function New-TestRoot {
    $path = Join-Path $testRoot ([Guid]::NewGuid().ToString('N'))
    foreach ($relative in @('artifacts', 'incoming', 'content-tools')) {
        New-Item -ItemType Directory -Path (Join-Path $path $relative) -Force | Out-Null
    }
    [IO.File]::WriteAllText((Join-Path $path 'incoming/stale.txt'), 'clean me')
    [IO.File]::WriteAllText((Join-Path $path 'content-tools/keep.txt'), 'keep me')
    return $path
}
function New-FixtureZip {
    param([string]$Root, [string]$Name = 'a.zip', [string]$Commit = ('a' * 40), [string]$Mode = '')
    $fixture = Join-Path $testRoot ('fixture-' + [Guid]::NewGuid().ToString('N'))
    $stage = Join-Path $fixture 'stage'
    $bundle = Join-Path $fixture 'bundle'
    foreach ($path in @($stage, (Join-Path $bundle 'outputs'), (Join-Path $bundle 'deploy'))) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
    if ($Mode -ne 'no-server') { [IO.File]::WriteAllText((Join-Path $stage 'server.js'), '// fixture') }
    $manifest = @{ id = 'test-release'; commit = $Commit; nodeVersion = '24.21.0'; platform = 'win32'; arch = 'x64'; contentSyncVersion = 1 }
    if ($Mode -eq 'node') { $manifest.nodeVersion = '22.0.0' }
    [IO.File]::WriteAllText((Join-Path $stage 'release.json'), ($manifest | ConvertTo-Json))
    if ($Mode -eq 'manifest') { [IO.File]::WriteAllText((Join-Path $stage 'release.json'), '{broken') }
    if ($Mode -eq 'content') { New-Item -ItemType Directory -Path (Join-Path $stage 'content') | Out-Null }
    if ($Mode -eq 'publisher-failure') { [IO.File]::WriteAllText((Join-Path $stage 'fail-publish'), 'yes') }
    if ($Mode -eq 'hardlink') {
        New-Item -ItemType HardLink -Path (Join-Path $stage 'linked.js') -Target (Join-Path $stage 'server.js') | Out-Null
    }
    $tarball = Join-Path $bundle 'outputs/test.tar.gz'
    & $tar -czf $tarball -C $stage .
    if ($LASTEXITCODE -ne 0) { throw 'Fixture tar failed.' }
    if ($Mode -eq 'broken-tar') { [IO.File]::WriteAllText($tarball, 'not a tarball') }
    $hash = (Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash
    if ($Mode -eq 'hash') { $hash = '0' * 64 }
    [IO.File]::WriteAllText((Join-Path $bundle 'outputs/test.sha256.txt'), "$hash  test.tar.gz`n")
    if ($Mode -eq 'extra-tar') { Copy-Item -LiteralPath $tarball -Destination (Join-Path $bundle 'outputs/other.tar.gz') }
    if ($Mode -eq 'extra-sha') { Copy-Item -LiteralPath (Join-Path $bundle 'outputs/test.sha256.txt') -Destination (Join-Path $bundle 'outputs/other.sha256.txt') }
    $fakePublisher = @'
param($ReleaseDirectory, $Root, $NodePath, $Pm2Path, $ExpectedUser)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $ReleaseDirectory 'release.json') -Raw | ConvertFrom-Json
[IO.File]::AppendAllText((Join-Path $Root 'events.txt'), ($manifest.commit + "`n"))
if (Test-Path -LiteralPath (Join-Path $ReleaseDirectory 'fail-publish')) {
    Write-Output 'Simulated publisher failure after recovery completed.'
    exit 7
}
'@
    [IO.File]::WriteAllText((Join-Path $bundle 'deploy/publish-release.ps1'), $fakePublisher)
    [IO.File]::WriteAllText((Join-Path $bundle 'deploy/content-operations.ps1'), '# fixture')
    $zip = Join-Path $Root ("artifacts/$Name")
    [IO.Compression.ZipFile]::CreateFromDirectory($bundle, $zip)
    return $zip
}
function Get-Snapshot {
    param([string]$Path)
    return (@(Get-ChildItem -LiteralPath $Path -Recurse -Force | Sort-Object FullName | ForEach-Object {
        $hash = if ($_.PSIsContainer) { 'directory' } else { (Get-FileHash -LiteralPath $_.FullName).Hash }
        $_.FullName + ':' + $hash
    }) -join "`n")
}
function New-WorkerFixture {
    $root = New-TestRoot
    $tools = Join-Path $root 'release-tools'
    foreach ($relative in @('release-tools', 'release-delivery/inbox', 'release-delivery/results', 'release-delivery/logs', 'pm2-home')) {
        New-Item -ItemType Directory -Path (Join-Path $root $relative) -Force | Out-Null
    }
    foreach ($file in @('content-operations.ps1', 'artifact-operations.ps1', 'publish-from-artifacts.ps1', 'process-release-queue.ps1', 'submit-release.ps1')) {
        Copy-Item -LiteralPath (Join-Path $deploy $file) -Destination (Join-Path $tools $file)
    }
    # Only this isolated fixture skips elevation; never install or alter real tasks.
    Add-Content -LiteralPath (Join-Path $tools 'content-operations.ps1') -Value "`nfunction Assert-ContentAdministrator { }"
    Write-ContentJsonAtomic (Join-Path $tools 'config.json') @{
        root = $root; expectedUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        pm2Home = (Join-Path $root 'pm2-home'); nodePath = 'fixture-node'; pm2Path = 'fixture-pm2'; keep = 3
    }
    return $root
}
function Invoke-TestWorker {
    param([string]$Root)
    $old = $ErrorActionPreference
    $previousHome = $env:PM2_HOME
    try {
        $env:PM2_HOME = $null
        $ErrorActionPreference = 'Continue'
        & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Root 'release-tools/process-release-queue.ps1') -ConfigPath (Join-Path $Root 'release-tools/config.json') 2>&1 | Out-Host
        return $LASTEXITCODE
    } finally { $ErrorActionPreference = $old; $env:PM2_HOME = $previousHome }
}
try {
    foreach ($name in @('content-operations.ps1', 'artifact-operations.ps1', 'publish-from-artifacts.ps1', 'process-release-queue.ps1', 'submit-release.ps1', 'setup-release-publish.ps1', 'publish-release.ps1')) {
        $file = Get-Item -LiteralPath (Join-Path $deploy $name)
        $tokens = $null; $errors = $null
        [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        Assert-Test (-not $errors) "Syntax error in $($file.Name): $errors"
    }
    $root = New-TestRoot
    & (Join-Path $deploy 'publish-from-artifacts.ps1') @testPublisherOptions -Root $root
    Assert-Test (Test-Path -LiteralPath (Join-Path $root 'incoming/stale.txt')) 'Empty scan mutated incoming.'
    Assert-Test ((Get-NextArtifactVersion @() ([datetime]'2026-10-03')) -eq 'release-26.10.1') 'First sequence wrong.'
    foreach ($name in @('release-26.10.1', 'release-26.10.2', 'release-26.9.99', 'release-25.12.9')) {
        New-Item -ItemType Directory -Path (Join-Path $root "artifacts/$name") | Out-Null
    }
    $versions = @(Get-ArtifactVersions (Join-Path $root 'artifacts'))
    Assert-Test ((Get-NextArtifactVersion $versions ([datetime]'2026-10-03')) -eq 'release-26.10.3') 'Monthly sequence wrong.'
    Assert-Test ((Get-NextArtifactVersion $versions ([datetime]'2026-01-01')) -eq 'release-26.1.1') 'Year rollover wrong.'
    $passed++; Write-Host 'PASS: empty scan, monthly numbering and year rollover'

    $null = New-FixtureZip $root 'a.zip'
    $null = New-FixtureZip $root 'b.zip'
    $before = Get-Snapshot $root
    & (Join-Path $deploy 'publish-from-artifacts.ps1') @testPublisherOptions -Root $root -DryRun
    Assert-Test ((Get-Snapshot $root) -ceq $before) 'DryRun changed files or directories.'
    $passed++; Write-Host 'PASS: multiple ZIP dry run changes nothing'

    $root = New-TestRoot
    $month = 'release-{0:yy}.{1}' -f (Get-Date), (Get-Date).Month
    foreach ($sequence in @(1, 2, 9)) { New-Item -ItemType Directory -Path (Join-Path $root "artifacts/$month.$sequence") | Out-Null }
    New-Item -ItemType Directory -Path (Join-Path $root 'artifacts/release-not-a-version') | Out-Null
    $null = New-FixtureZip $root 'b.zip' ('b' * 40)
    $null = New-FixtureZip $root 'a.zip' ('a' * 40)
    & (Join-Path $deploy 'publish-from-artifacts.ps1') @testPublisherOptions -Root $root
    $names = @((Get-ArtifactVersions (Join-Path $root 'artifacts')).Name)
    Assert-Test ($names.Count -eq 3 -and "$month.9" -in $names -and "$month.10" -in $names -and "$month.11" -in $names) 'Numeric retention incorrect.'
    Assert-Test ((Get-Content -LiteralPath (Join-Path $root 'events.txt') -Raw).Trim() -eq (('a' * 40) + "`n" + ('b' * 40))) 'ZIPs not published in filename order.'
    Assert-Test (@(Get-ChildItem -LiteralPath (Join-Path $root 'candidate') -Force).Count -eq 0) 'Successful candidates not removed.'
    Assert-Test (@(Get-ChildItem -LiteralPath (Join-Path $root 'incoming') -Force).Count -eq 0) 'Incoming not cleared.'
    Assert-Test (Test-Path -LiteralPath (Join-Path $root 'content-tools/keep.txt')) 'Content tools touched.'
    Assert-Test (Test-Path -LiteralPath (Join-Path $root 'artifacts/release-not-a-version')) 'Non-version directory deleted.'
    $passed++; Write-Host 'PASS: real ZIP/tar publish, sorted batch, numeric retention and cleanup'

    $root = New-TestRoot
    $null = New-FixtureZip $root
    foreach ($sequence in @(1, 2, 3, 4)) { New-Item -ItemType Directory -Path (Join-Path $root "artifacts/$month.$sequence") | Out-Null }
    $before = Get-Snapshot $root
    Expect-Failure { & (Join-Path $deploy 'publish-from-artifacts.ps1') -Root $root -ExpectedUser 'invalid\identity' } 'PM2 owner'
    Assert-Test ((Get-Snapshot $root) -ceq $before) 'Wrong identity mutated files before rejection.'
    & (Join-Path $deploy 'publish-from-artifacts.ps1') @testPublisherOptions -Root $root -KeepArtifacts -Keep 1
    Assert-Test (@(Get-ArtifactVersions (Join-Path $root 'artifacts')).Count -eq 5) 'KeepArtifacts removed versions.'
    $passed++; Write-Host 'PASS: identity rejected before mutations; KeepArtifacts preserves all versions'

    $cases = @{
        hash = 'SHA256 mismatch'; 'extra-tar' = 'exactly one'; 'extra-sha' = 'exactly one'
        content = 'top-level content'; manifest = '.'; node = 'Invalid external'; 'no-server' = 'server.js missing'
        hardlink = 'link or special'; 'broken-tar' = '.'; 'publisher-failure' = 'Publisher failed'
    }
    foreach ($mode in $cases.Keys) {
        $root = New-TestRoot
        $null = New-FixtureZip $root 'a.zip' ('a' * 40) $mode
        $null = New-FixtureZip $root 'b.zip' ('b' * 40)
        Expect-Failure { & (Join-Path $deploy 'publish-from-artifacts.ps1') @testPublisherOptions -Root $root } $cases[$mode]
        Assert-Test (@(Get-ArtifactVersions (Join-Path $root 'artifacts')).Count -eq 1) "Lost diagnostic artifact: $mode"
        Assert-Test (Test-Path -LiteralPath (Join-Path $root 'artifacts/b.zip')) "Batch continued after $mode"
        Assert-Test (@(Get-ChildItem -LiteralPath (Join-Path $root 'incoming') -Force).Count -eq 0) "Failure did not clean incoming: $mode"
        if ($mode -ne 'publisher-failure') { Assert-Test (-not (Test-Path -LiteralPath (Join-Path $root 'events.txt'))) "Invalid package reached publisher: $mode" }
    }
    $passed++; Write-Host 'PASS: hashes, ambiguous archives, invalid manifests/content, tar links/errors and publisher exit failure'

    $root = New-TestRoot
    $zip = Join-Path $root 'artifacts/unsafe.zip'
    $archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
    try { $null = $archive.CreateEntry('../escaped.txt') } finally { $archive.Dispose() }
    Expect-Failure { & (Join-Path $deploy 'publish-from-artifacts.ps1') @testPublisherOptions -Root $root } 'Unsafe archive'
    Assert-Test (-not (Test-Path -LiteralPath (Join-Path $root 'artifacts/escaped.txt'))) 'ZIP escaped destination.'
    Assert-Test (Test-Path -LiteralPath $zip) 'Failed ZIP extraction deleted source.'
    $outside = Join-Path $testRoot 'outside'
    New-Item -ItemType Directory -Path $outside | Out-Null
    $link = Join-Path $root 'incoming/linked'
    New-Item -ItemType Junction -Path $link -Target $outside | Out-Null
    Expect-Failure { Remove-ArtifactPath (Join-Path $root 'incoming') $link } 'Reparse'
    [IO.Directory]::Delete($link)
    Expect-Failure { Remove-ArtifactPath (Join-Path $root 'incoming') $outside } 'outside'
    $passed++; Write-Host 'PASS: ZIP traversal, reparse and deletion containment guards'

    $root = New-TestRoot
    $null = New-FixtureZip $root
    $version = Get-NextArtifactVersion @()
    New-Item -ItemType Directory -Path (Join-Path $root "candidate/$version") -Force | Out-Null
    Expect-Failure { & (Join-Path $deploy 'publish-from-artifacts.ps1') @testPublisherOptions -Root $root } 'already exists'
    Assert-Test (Test-Path -LiteralPath (Join-Path $root 'artifacts/a.zip')) 'Collision consumed ZIP.'
    $root = New-TestRoot
    $null = New-FixtureZip $root
    Expect-Failure { & (Join-Path $deploy 'publish-from-artifacts.ps1') @testPublisherOptions -Root $root -ZipName 'a.zip' -ExpectedCommit ('b' * 40) } 'commit differs'
    $passed++; Write-Host 'PASS: existing candidate and wrong Actions commit rejected'

    $root = New-WorkerFixture
    $requestId = '123-1-' + ('a' * 40)
    $zip = New-FixtureZip $root ($requestId + '.zip')
    $download = Join-Path $root 'download'
    Expand-Archive -LiteralPath $zip -DestinationPath $download
    Remove-ArtifactPath (Join-Path $root 'artifacts') $zip
    $job = Start-Job -ArgumentList $root, $requestId, $powershell -ScriptBlock {
        param($Root, $RequestId, $Powershell)
        $env:PM2_HOME = $null
        $timer = [Diagnostics.Stopwatch]::StartNew()
        while (-not (Test-Path -LiteralPath (Join-Path $Root "release-delivery/inbox/$RequestId.zip"))) {
            if ($timer.Elapsed.TotalSeconds -gt 30) { throw 'No ZIP submitted.' }
            Start-Sleep -Milliseconds 100
        }
        & $Powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Root 'release-tools/process-release-queue.ps1') -ConfigPath (Join-Path $Root 'release-tools/config.json')
        if ($LASTEXITCODE -ne 0) { throw 'Worker failed.' }
    }
    & (Join-Path $root 'release-tools/submit-release.ps1') -Root $root -ArtifactDirectory $download -RequestId $requestId -WaitMinutes 1
    $null = Wait-Job $job -Timeout 30
    Receive-Job $job -ErrorAction Stop | Out-Host
    Assert-Test ($job.State -eq 'Completed') 'Delivery worker did not complete.'
    Remove-Job $job; $job = $null
    $result = Read-ContentJson (Join-Path $root "release-delivery/results/$requestId.json")
    Assert-Test ($result.status -eq 'success') 'End-to-end delivery did not report success.'
    # Same request is observed, never re-published.
    & (Join-Path $root 'release-tools/submit-release.ps1') -Root $root -ArtifactDirectory $download -RequestId $requestId -WaitMinutes 1
    Assert-Test (@(Get-Content -LiteralPath (Join-Path $root 'events.txt')).Count -eq 1) 'Duplicate request published twice.'
    $passed++; Write-Host 'PASS: submit -> protected copy -> publish -> result -> Actions client, including duplicate request'

    $root = New-WorkerFixture
    $requestId = '124-1-' + ('a' * 40)
    $zip = New-FixtureZip $root ($requestId + '.zip') ('a' * 40) 'publisher-failure'
    $inbox = Join-Path $root 'release-delivery/inbox'
    [IO.File]::Copy($zip, (Join-Path $inbox ([IO.Path]::GetFileName($zip))))
    Remove-ArtifactPath (Join-Path $root 'artifacts') $zip
    [IO.File]::WriteAllText((Join-Path $inbox 'unfinished.uploading'), 'partial')
    Assert-Test ((Invoke-TestWorker $root) -ne 0) 'Failed worker exit was not propagated.'
    Assert-Test ((Read-ContentJson (Join-Path $root "release-delivery/results/$requestId.json")).status -eq 'failed') 'Failure result missing.'
    Assert-Test (Test-Path -LiteralPath (Join-Path $root 'release-delivery/paused.json')) 'Failure did not pause queue.'
    Assert-Test (Test-Path -LiteralPath (Join-Path $inbox 'unfinished.uploading')) 'Partial upload was consumed.'
    Assert-Test ((Invoke-TestWorker $root) -ne 0) 'Paused queue restarted.'
    $snapshot = Get-Snapshot $root
    Expect-Failure { & (Join-Path $root 'release-tools/submit-release.ps1') -Root $root -ArtifactDirectory $root -RequestId ('999-1-' + ('a' * 40)) -WaitMinutes 1 } 'paused'
    Assert-Test ((Get-Snapshot $root) -ceq $snapshot) 'Paused client submitted another ZIP.'
    $root = New-WorkerFixture
    Write-ContentJsonAtomic (Join-Path $root 'release-delivery/results/interrupted.json') @{ requestId = 'interrupted'; status = 'processing' }
    Assert-Test ((Invoke-TestWorker $root) -ne 0) 'Interrupted publish silently retried.'
    Assert-Test (Test-Path -LiteralPath (Join-Path $root 'release-delivery/paused.json')) 'Interrupted worker did not pause.'
    $passed++; Write-Host 'PASS: failure and interrupted-task recovery gates; partial upload ignored'
    Write-Host "All $passed artifact publishing test groups passed."
} finally {
    if ($job) { Stop-Job $job; Remove-Job $job }
    Remove-ArtifactPath $temporaryParent $testRoot
}
