<# Administrator task, independent of GdufsmcContentQueue. No extra deployment lock. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'content-operations.ps1')
. (Join-Path $PSScriptRoot 'artifact-operations.ps1')
$toolRoot = Get-ContentFullPath $PSScriptRoot
$ConfigPath = Get-ContentFullPath $ConfigPath
if ($ConfigPath -ne (Join-Path $toolRoot 'config.json')) { throw 'Only the fixed release-tools/config.json is accepted.' }
$config = Read-ContentJson $ConfigPath
$root = Get-ContentFullPath ([string]$config.root)
if ($toolRoot -ne (Join-Path $root 'release-tools')) { throw 'Worker must run from installed release-tools.' }
Assert-ContentNoReparse $toolRoot -Recurse
Assert-ContentAdministrator
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ne $config.expectedUser) { throw 'Worker must run as the configured PM2 owner.' }
Assert-ContentPm2Home -ExpectedHome $config.pm2Home -ConfiguredHome $env:PM2_HOME
$env:PM2_HOME = $config.pm2Home
$env:NODE_OPTIONS = $null
$env:NODE_PATH = $null
$delivery = Join-Path $root 'release-delivery'
$inbox = Join-Path $delivery 'inbox'
$results = Join-Path $delivery 'results'
$logs = Join-Path $delivery 'logs'
$paused = Join-Path $delivery 'paused.json'
$artifacts = Join-Path $root 'artifacts'
foreach ($path in @($delivery, $inbox, $results, $logs, $artifacts, $paused)) { Assert-ContentNoReparse $path }
if (Test-Path -LiteralPath $paused) { throw 'Automatic releases paused. Recover the recorded failure before removing paused.json.' }
# A killed/rebooted worker must never automatically retry an uncertain switch.
foreach ($file in Get-ChildItem -LiteralPath $results -Filter '*.json' -File) {
    $previous = Read-ContentJson $file.FullName
    if ($previous.status -eq 'processing') {
        Write-ContentJsonAtomic $paused @{ requestId = $previous.requestId; reason = 'Interrupted release; inspect deployment journal and live state.' }
        throw 'Interrupted release detected; automatic publishing paused.'
    }
}
$requests = @(Get-ChildItem -LiteralPath $inbox -Filter '*.zip' -File | Sort-Object Name)
foreach ($request in $requests) {
    $requestId = [IO.Path]::GetFileNameWithoutExtension($request.Name)
    if ($requestId -cnotmatch '^([0-9]+)-([0-9]+)-([a-f0-9]{40})$') {
        Write-Warning "Ignoring invalid release request filename: $($request.Name)"
        continue
    }
    $commit = $Matches[3]
    $resultPath = Join-Path $results ($requestId + '.json')
    if (Test-Path -LiteralPath $resultPath) { continue }
    $transcribing = $false
    try {
        Start-Transcript -LiteralPath (Join-Path $logs ("publish-$requestId.log")) -NoClobber | Out-Null
        $transcribing = $true
        Write-ContentJsonAtomic $resultPath @{ version = 1; requestId = $requestId; status = 'processing'; updatedAt = [DateTime]::UtcNow.ToString('o') }
        Assert-ContentNoReparse $request.FullName
        $temporary = Join-Path $artifacts ($requestId + '.uploading')
        $destination = Join-Path $artifacts $request.Name
        foreach ($path in @($temporary, $destination)) {
            Assert-ContentPathWithinRoot $artifacts $path
            Assert-ContentNoReparse $path
            if (Test-Path -LiteralPath $path) { throw "Delivery destination already exists: $path" }
        }
        # Copy into an administrator-owned file; a same-volume move would preserve
        # the runner-writable ACL. FileShare.None rejects an unfinished/open upload.
        $source = [IO.File]::Open($request.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        try {
            $output = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $source.CopyTo($output) } finally { $output.Dispose() }
        } finally { $source.Dispose() }
        [IO.File]::Move($temporary, $destination)
        Remove-ArtifactPath $inbox $request.FullName
        $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $toolRoot 'publish-from-artifacts.ps1') `
                -Root $root -ZipName $request.Name -ExpectedCommit $commit -Keep $config.keep `
                -NodePath $config.nodePath -Pm2Path $config.pm2Path -ExpectedUser $config.expectedUser
            $publishExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($publishExit -ne 0) { throw "Artifact publisher failed (exit $publishExit)." }
        Write-ContentJsonAtomic $resultPath @{ version = 1; requestId = $requestId; status = 'success'; commit = $commit; updatedAt = [DateTime]::UtcNow.ToString('o') }
    } catch {
        Write-Warning $_.Exception.Message
        # Pause FIRST, including failures to write the result. Never automatically
        # consume another ZIP after uncertain deployment or cleanup.
        Write-ContentJsonAtomic $paused @{ requestId = $requestId; reason = 'Release failed; inspect administrator logs and deployment journal.' }
        Write-ContentJsonAtomic $resultPath @{ version = 1; requestId = $requestId; status = 'failed'; updatedAt = [DateTime]::UtcNow.ToString('o') }
        throw
    } finally {
        if ($transcribing) { Stop-Transcript | Out-Null }
    }
}
