<#
.SYNOPSIS
    Inspect or install the fixed content queue processor (Windows PowerShell 5.1).
.DESCRIPTION
    Default / -Inspect and -DryRun are read-only. -Install requires the existing
    PM2-owner Administrator, a verified tool bundle and preinstalled executables.
    Installs a fixed S4U scheduled task; no dependencies/builds, Caddy changes,
    runner elevation, PM2 commands or automatic GitHub workflow activation.
#>
[CmdletBinding(DefaultParameterSetName = 'Inspect')]
param(
    [Parameter(ParameterSetName = 'Inspect')][switch]$Inspect,
    [Parameter(ParameterSetName = 'DryRun', Mandatory = $true)][switch]$DryRun,
    [Parameter(ParameterSetName = 'Install', Mandatory = $true)][switch]$Install,
    [string]$Root = 'H:/GDUFSMC-web',
    [string]$ToolDirectory,
    [string]$RunnerIdentity = 'NT AUTHORITY\NETWORK SERVICE',
    [string]$ExpectedUser = 'WINSERVER08\Administrator',
    [string]$TaskName = 'GdufsmcContentQueue',
    [string]$Repo = 'QingShi-Dev/GdufsMC-Website',
    [string]$NodePath = 'C:/Program Files/nodejs/node.exe',
    [string]$Pm2Path = 'C:/npm/pm2.cmd',
    [string]$Origin = 'http://127.0.0.1:3000',
    [string]$TccliPath,
    [string]$ZoneId,
    [string]$Region = 'ap-guangzhou'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'content-operations.ps1')
$Root = Get-ContentFullPath $Root
if ($Root -eq [IO.Path]::GetPathRoot($Root).TrimEnd('\')) { throw 'Deployment root must not be a drive root.' }
Assert-ContentNoReparse $Root
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Deployment root missing: $Root" }
$runnerSid = Resolve-ContentRunnerSid $RunnerIdentity
$toolRoot = Join-Path $Root 'content-tools'
$coordination = Join-Path $Root 'coordination'
$statePath = Join-Path $Root 'shared/deployment-state.json'
$paths = [ordered]@{
    tools = $toolRoot
    coordination = $coordination
    queue = (Join-Path $coordination 'queue')
    results = (Join-Path $coordination 'results')
    code = (Join-Path $coordination 'code')
    staging = (Join-Path $coordination 'staging')
}
foreach ($path in $paths.Values) { Assert-ContentPathWithinRoot $Root $path; Assert-ContentNoReparse $path }
if ($PSCmdlet.ParameterSetName -eq 'Inspect') {
    [pscustomobject]@{
        mode = 'Inspect'; root = $Root; runnerIdentity = $RunnerIdentity; runnerSid = $runnerSid.Value
        expectedUser = $ExpectedUser; taskName = $TaskName
        toolInstalled = (Test-Path -LiteralPath (Join-Path $toolRoot 'config.json'))
        deploymentStateExists = (Test-Path -LiteralPath $statePath); paths = $paths
        nextStep = 'Administrator: run -DryRun with ToolDirectory, TccliPath and ZoneId. No files, task or permissions were changed.'
    } | ConvertTo-Json -Depth 6
    return
}
Assert-ContentAdministrator
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $currentIdentity.Name.Equals($ExpectedUser, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Run setup as the existing PM2 owner '$ExpectedUser'; current identity is '$($currentIdentity.Name)'."
}
if ($runnerSid.Value -eq $currentIdentity.User.Value) { throw 'Runner identity and PM2 owner must be different.' }
$pm2Home = Get-ContentFullPath (Join-Path $env:USERPROFILE '.pm2')
Assert-ContentPm2Home -ExpectedHome $pm2Home -ConfiguredHome $env:PM2_HOME
Assert-ContentParentAcl $Root
if (-not $ToolDirectory -or -not $TccliPath -or -not $ZoneId) { throw 'ToolDirectory, TccliPath and ZoneId are required for DryRun/Install.' }
if ($Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or $ZoneId -notmatch '^zone-[A-Za-z0-9]+$' -or $TaskName -notmatch '^[A-Za-z0-9_-]{1,80}$') {
    throw 'Invalid repository, EdgeOne zone id or scheduled task name.'
}
$originUri = [Uri]$Origin
if (-not $originUri.IsLoopback -or $originUri.Scheme -ne 'http' -or $originUri.AbsolutePath -ne '/') { throw 'Origin must be a loopback HTTP origin without a path.' }
$ToolDirectory = Get-ContentFullPath $ToolDirectory
$NodePath = Get-ContentFullPath $NodePath
$Pm2Path = Get-ContentFullPath $Pm2Path
$TccliPath = Get-ContentFullPath $TccliPath
foreach ($path in @($NodePath, $Pm2Path, $TccliPath)) {
    Assert-ContentNoReparse $path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Executable missing: $path" }
}
Assert-ContentNoReparse $ToolDirectory -Recurse
if ($ToolDirectory.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or
    $ToolDirectory.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $Root.StartsWith($ToolDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'ToolDirectory and production Root must be separate non-nested directories.' }
foreach ($relativePath in @('scripts/content-sync.mjs', 'scripts/verify-content-root.mjs', 'deploy/content-operations.ps1', 'deploy/process-content-queue.ps1', 'node_modules')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ToolDirectory $relativePath))) { throw "Trusted tool bundle missing: $relativePath" }
}
if (Test-Path -LiteralPath $toolRoot) { throw 'content-tools already exists. Perform an explicit trusted-tool upgrade; setup never overwrites installed tools.' }
Assert-ContentNoReparse $coordination -Recurse
$state = Read-ContentJson $statePath
$projection = Get-ContentDeploymentProjection $state.current
$release = (Invoke-WebRequest -Uri ($Origin.TrimEnd('/') + '/__release.json') -UseBasicParsing -TimeoutSec 15).Content | ConvertFrom-Json
if ([string]$release.commit -ne $projection.commit -or [string]$release.id -ne $projection.releaseId) { throw 'Source-origin release marker differs from private deployment state. Resolve drift first.' }
$config = [ordered]@{
    version = 1; root = $Root; repo = $Repo; nodePath = $NodePath; pm2Path = $Pm2Path
    pm2Home = $pm2Home
    expectedUser = $ExpectedUser; origin = $Origin.TrimEnd('/'); tccliPath = $TccliPath
    zoneId = $ZoneId; region = $Region; runnerSid = $runnerSid.Value
}
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$processor = Join-Path $toolRoot 'deploy/process-content-queue.ps1'
$configPath = Join-Path $toolRoot 'config.json'
$actionArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $processor + '" -Config "' + $configPath + '"'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw 'Scheduled task already exists; setup never replaces it implicitly.' }
if ($DryRun) {
    [pscustomobject]@{ mode = 'DryRun'; config = $config; baseline = $projection; paths = $paths
        task = @{ name = $TaskName; user = $ExpectedUser; logonType = 'S4U'; arguments = $actionArguments; intervalMinutes = 1; atStartup = $true }
        writes = $false } | ConvertTo-Json -Depth 6
    return
}
$deploymentLock = $null
try {
    $deploymentLock = Enter-ContentDeploymentLock (Join-Path $Root 'shared/deployment.lock')
    $state = Read-ContentJson $statePath
    $projection = Get-ContentDeploymentProjection $state.current
    $contentStatePath = Join-Path $Root 'shared/content-state.json'
    if (Test-Path -LiteralPath $contentStatePath) {
        $contentState = Read-ContentJson $contentStatePath
        if ([string]$contentState.codeCommit -ne [string]$projection.commit) { throw 'Content state differs from the running code baseline.' }
        $projection.contentCommit = [string]$contentState.contentCommit
    }
    $release = (Invoke-WebRequest -Uri ($Origin.TrimEnd('/') + '/__release.json') -UseBasicParsing -TimeoutSec 15).Content | ConvertFrom-Json
    if ([string]$release.commit -ne $projection.commit -or [string]$release.id -ne $projection.releaseId) { throw 'Baseline changed before installation; retry after resolving drift.' }
    foreach ($path in @($coordination, $paths.queue, $paths.results, $paths.code, $paths.staging)) {
        if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path | Out-Null }
        $rights = if ($path -eq $paths.queue) { 'Modify' } else { 'ReadAndExecute' }
        Set-ContentManagedAcl -Path $path -RunnerSid $runnerSid -RunnerRights $rights -AdminOnly:($path -eq $paths.staging)
    }
    Copy-Item -LiteralPath $ToolDirectory -Destination $toolRoot -Recurse
    Set-ContentManagedAcl -Path $toolRoot -RunnerSid $runnerSid
    Write-ContentJsonAtomic $configPath $config
    Write-ContentJsonAtomic (Join-Path $paths.code 'current.json') $projection
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $actionArguments -WorkingDirectory $toolRoot
    $triggers = @(
        (New-ScheduledTaskTrigger -AtStartup),
        (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
    )
    $principal = New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType S4U -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Process validated GDUFSMC content requests with the existing PM2 owner; runner has no PM2 access.' | Out-Null
    Write-Host 'Fixed content tools and S4U queue task installed; runner can write only queue requests in the managed coordination tree.'
    Write-Host 'Existing content, PM2 and Caddy were not changed. Verify task identity and logs before explicitly enabling the content workflow.'
} finally {
    if ($deploymentLock) { $deploymentLock.Dispose() }
}
