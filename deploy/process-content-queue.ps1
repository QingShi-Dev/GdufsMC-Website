<# Fixed administrator queue processor; Windows PowerShell 5.1. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][Alias('Config')][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$env:NODE_OPTIONS = $null
$env:NODE_PATH = $null
. (Join-Path $PSScriptRoot 'content-operations.ps1')

function Write-QueueFailure {
    param([string]$Path, [string]$RequestId, [string]$Message)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-ContentJsonAtomic -Path $Path -Value ([ordered]@{
            version = 1; requestId = $RequestId; status = 'failed'; message = $Message
            updatedAt = [DateTime]::UtcNow.ToString('o')
        })
    }
}

$processed = 0
$failed = 0
try {
    $toolRoot = Get-ContentFullPath (Split-Path -Parent $PSScriptRoot)
    $ConfigPath = Get-ContentFullPath $ConfigPath
    if (-not $ConfigPath.Equals((Join-Path $toolRoot 'config.json'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Only the installed content-tools/config.json is accepted.'
    }
    Assert-ContentNoReparse $toolRoot
    $config = Read-ContentJson $ConfigPath
    $root = Get-ContentFullPath ([string]$config.root)
    if (-not $toolRoot.Equals((Join-Path $root 'content-tools'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Processor is not running from the configured fixed content-tools directory.'
    }
    Assert-ContentAdministrator
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    if (-not $identity.Equals([string]$config.expectedUser, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Queue processor must run as the configured PM2 owner.'
    }
    $pm2Home = Get-ContentFullPath ([string]$config.pm2Home)
    Assert-ContentNoReparse $pm2Home
    if ($env:PM2_HOME -and -not (Get-ContentFullPath $env:PM2_HOME).Equals($pm2Home, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'PM2_HOME differs from the trusted configuration.'
    }
    $env:PM2_HOME = $pm2Home
    $nodePath = Get-ContentFullPath ([string]$config.nodePath)
    $worker = Join-Path $toolRoot 'scripts/content-sync.mjs'
    foreach ($path in @($nodePath, $worker)) {
        Assert-ContentNoReparse $path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Trusted content worker or Node executable is missing.' }
    }
    $queue = Join-Path $root 'coordination/queue'
    $results = Join-Path $root 'coordination/results'
    foreach ($path in @($queue, $results)) {
        Assert-ContentNoReparse $path
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw 'Content coordination directory is missing.' }
    }
    $requests = @(Get-ChildItem -LiteralPath $queue -Filter '*.json' -File | Sort-Object CreationTimeUtc, Name)
    foreach ($request in $requests) {
        if ($processed -ge 10) { break }
        $requestId = [IO.Path]::GetFileNameWithoutExtension($request.Name)
        if ($requestId -cnotmatch '^[a-f0-9]{40}-[0-9]+-[0-9]+$') {
            [Console]::Error.WriteLine('Ignoring queue entry with an invalid request id.')
            continue
        }
        $resultPath = Join-Path $results ($requestId + '.json')
        Assert-ContentNoReparse $resultPath
        if (Test-Path -LiteralPath $resultPath -PathType Leaf) { continue }
        $lock = $null
        try {
            $lock = Enter-ContentDeploymentLock -Path (Join-Path $root 'shared/deployment.lock')
            if (Test-Path -LiteralPath $resultPath -PathType Leaf) { continue }
            $processed++
            Assert-ContentNoReparse $request.FullName
            $current = Get-Item -LiteralPath $request.FullName -ErrorAction Stop
            if ($current.Length -gt 4096 -or $current.Length -eq 0) {
                Write-QueueFailure $resultPath $requestId 'Queue request must contain 1 to 4096 bytes.'
                $failed++
                continue
            }
            # The installed worker validates every untrusted field and writes the
            # detailed result. Never invoke a script or path from the request.
            $previousEap = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $workerOutput = @(& $nodePath $worker process-request --config $ConfigPath --request-id $requestId --lock-held 2>&1)
                $workerExit = $LASTEXITCODE
            } finally { $ErrorActionPreference = $previousEap }
            if ($workerExit -ne 0) {
                Write-QueueFailure $resultPath $requestId ('Trusted content worker failed (exit ' + $workerExit + ').')
                $failed++
                [Console]::Error.WriteLine('Content request failed: ' + $requestId + ' (exit ' + $workerExit + ').')
            } elseif (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
                Write-QueueFailure $resultPath $requestId 'Trusted content worker finished without a result.'
                $failed++
            } else {
                $workerResult = Read-ContentJson $resultPath
                if ([string]$workerResult.status -eq 'failed') { $failed++ }
            }
        } catch {
            if ($lock) {
                Write-QueueFailure $resultPath $requestId 'Content queue processing failed; the administrator must inspect task diagnostics.'
                $failed++
            }
            [Console]::Error.WriteLine('Content queue operation failed: ' + $_.Exception.Message)
            if (-not $lock) { throw }
        } finally {
            if ($lock) { $lock.Dispose() }
        }
    }
    [ordered]@{ processed = $processed; failed = $failed } | ConvertTo-Json -Compress
    if ($failed -gt 0) { exit 1 }
} catch {
    [Console]::Error.WriteLine('Content queue processor failed: ' + $_.Exception.Message)
    [ordered]@{ processed = $processed; failed = $failed; error = 'Queue processor failed; inspect administrator diagnostics.' } | ConvertTo-Json -Compress
    exit 1
}
