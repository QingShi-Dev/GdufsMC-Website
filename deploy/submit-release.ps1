<# Fixed runner-side delivery client. No checkout, elevation, PM2 or task control. #>
[CmdletBinding()]
param(
    [string]$Root = 'H:/GDUFSMC-web',
    [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]+-[0-9]+-[a-f0-9]{40}$')][string]$RequestId,
    [ValidateRange(1, 120)][int]$WaitMinutes = 30
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'content-operations.ps1')
$Root = Get-ContentFullPath $Root
$ArtifactDirectory = Get-ContentFullPath $ArtifactDirectory
$delivery = Join-Path $Root 'release-delivery'
$inbox = Join-Path $delivery 'inbox'
$resultPath = Join-Path $delivery "results/$RequestId.json"
$paused = Join-Path $delivery 'paused.json'
foreach ($path in @($ArtifactDirectory, $delivery, $inbox, $resultPath, $paused)) { Assert-ContentNoReparse $path }
foreach ($path in @($ArtifactDirectory, $inbox, (Split-Path -Parent $resultPath))) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw 'Release delivery is not installed, or the downloaded artifact is missing.' }
}
if (Test-Path -LiteralPath $paused) { throw 'Automatic release publishing is paused; administrator recovery is required.' }
$ready = Join-Path $inbox ($RequestId + '.zip')
$temporary = Join-Path $inbox ($RequestId + '.uploading')
foreach ($path in @($ready, $temporary)) { Assert-ContentNoReparse $path }
if (-not (Test-Path -LiteralPath $resultPath) -and -not (Test-Path -LiteralPath $ready)) {
    Assert-ContentNoReparse $ArtifactDirectory -Recurse
    foreach ($relative in @('outputs', 'deploy/publish-release.ps1', 'deploy/content-operations.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ArtifactDirectory $relative))) { throw "Downloaded artifact missing $relative" }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # CreateNew semantics refuse a stale partial upload; it is never promoted.
    [IO.Compression.ZipFile]::CreateFromDirectory($ArtifactDirectory, $temporary)
    Assert-ContentPathWithinRoot $inbox $temporary
    Assert-ContentPathWithinRoot $inbox $ready
    [IO.File]::Move($temporary, $ready)
    Write-Host "Submitted release $RequestId. Waiting for the administrator task."
}
$timer = [Diagnostics.Stopwatch]::StartNew()
while ($timer.Elapsed.TotalMinutes -lt $WaitMinutes) {
    if (Test-Path -LiteralPath $resultPath -PathType Leaf) {
        try { $result = Read-ContentJson $resultPath }
        catch [IO.IOException] {
            # Windows ReplaceFile can briefly hide an otherwise complete result.
            Start-Sleep -Milliseconds 250
            continue
        }
        if ($result.requestId -cne $RequestId) { throw 'Release result request id mismatch.' }
        if ($result.status -eq 'success') {
            Write-Host "Release published successfully: $RequestId"
            return
        }
        if ($result.status -eq 'failed') { throw "Release failed: $RequestId. Administrator: inspect release-delivery/logs and paused.json." }
        if ($result.status -ne 'processing') { throw 'Unknown release result status.' }
    }
    if (Test-Path -LiteralPath $paused) { throw 'Automatic release publishing paused; administrator recovery is required.' }
    Start-Sleep -Seconds 5
}
throw "Timed out waiting for $RequestId. The independent server task may still be running; do not stop it or blindly retry."
