# Fixed, administrator-owned EdgeOne adapter. Never accepts executable paths or
# API parameters from a queue request. Credentials remain in the owner's tccli profile.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][Alias('Config')][string]$ConfigPath,
    [Parameter(Mandatory = $true)][ValidateSet('Create', 'Describe')][string]$Action,
    [string]$JobId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'content-operations.ps1')
Assert-ContentAdministrator
$config = Read-ContentJson $ConfigPath
$root = Get-ContentFullPath $config.root
$expectedConfig = Join-Path $root 'content-tools/config.json'
if (-not (Get-ContentFullPath $ConfigPath).Equals($expectedConfig.Replace('/', '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected content configuration path.' }
if (-not [Security.Principal.WindowsIdentity]::GetCurrent().Name.Equals([string]$config.expectedUser, [StringComparison]::OrdinalIgnoreCase)) { throw 'Run as the configured PM2 owner.' }
$tccli = Get-ContentFullPath $config.tccliPath
Assert-ContentNoReparse $tccli
if (-not (Test-Path -LiteralPath $tccli -PathType Leaf)) { throw 'Configured tccli executable is missing.' }
if ([string]$config.zoneId -notmatch '\Azone-[A-Za-z0-9]+\z') { throw 'Invalid EdgeOne zone.' }
if ([string]$config.region -notmatch '\A[a-z]+-[a-z]+[0-9]?\z') { throw 'Invalid EdgeOne region.' }
$request = @{ ZoneId = [string]$config.zoneId }
if ($Action -eq 'Create') {
    $method = 'CreatePurgeTask'
    $request.Type = 'purge_all'
} else {
    if ($JobId -notmatch '\A[A-Za-z0-9_-]{1,128}\z') { throw 'Invalid purge job id.' }
    $method = 'DescribePurgeTasks'
    $request.Filters = @(@{ Name = 'job-id'; Values = @($JobId) })
    $request.Limit = 1000
}
$temporary = Join-Path $root ('shared/purge-request-' + [Guid]::NewGuid().ToString('N') + '.json')
$errorPath = $temporary + '.stderr'
Assert-ContentPathWithinRoot (Join-Path $root 'shared') $temporary
try {
    Write-ContentJsonAtomic $temporary $request
    # File input avoids PowerShell 5.1/native argument quoting of JSON objects.
    $arguments = @('teo', $method, '--cli-input-json', ('file://' + $temporary), '--version', '2022-09-01', '--region', [string]$config.region, '--timeout', '30')
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $raw = & $tccli @arguments 2> $errorPath; $nativeExit = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previousEap }
    if ($nativeExit -ne 0) { throw "EdgeOne $method failed (exit $nativeExit). Check the administrator tccli profile and CAM permissions." }
    try { $response = ($raw -join "`n") | ConvertFrom-Json } catch { throw 'EdgeOne returned invalid JSON.' }
    if ($response.PSObject.Properties['Response']) { $response = $response.Response }
    if ($response.PSObject.Properties['Error']) { throw 'EdgeOne returned an API error.' }
    if ($Action -eq 'Create') {
        if ([string]$response.JobId -notmatch '\A[A-Za-z0-9_-]{1,128}\z') { throw 'EdgeOne response has no valid JobId.' }
        @{ jobId = [string]$response.JobId } | ConvertTo-Json -Compress
    } else {
        $statuses = @($response.Tasks | Where-Object { [string]$_.JobId -eq $JobId } | ForEach-Object { [string]$_.Status })
        @{ jobId = $JobId; statuses = $statuses; totalCount = $response.TotalCount } | ConvertTo-Json -Compress
    }
} finally {
    # Delete only this invocation's known private request file, never a directory.
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    if ([IO.File]::Exists($errorPath)) { [IO.File]::Delete($errorPath) }
}
