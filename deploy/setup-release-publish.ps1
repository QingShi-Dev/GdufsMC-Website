<# Install only the independent full-release delivery task. Default is read-only. #>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$DryRun,
    [string]$Root = 'H:/GDUFSMC-web',
    [string]$RunnerIdentity = 'NT AUTHORITY\NETWORK SERVICE',
    [string]$ExpectedUser = 'WINSERVER08\Administrator',
    [string]$NodePath = 'C:/Program Files/nodejs/node.exe',
    [string]$Pm2Path = 'C:/npm/pm2.cmd',
    [ValidateRange(1, 1000)][int]$Keep = 3
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'content-operations.ps1')
if ($Install -and $DryRun) { throw 'Choose Install or DryRun.' }
$Root = Get-ContentFullPath $Root
if ($Root -eq [IO.Path]::GetPathRoot($Root).TrimEnd('\')) { throw 'Deployment root cannot be a drive root.' }
Assert-ContentNoReparse $Root
Assert-ContentAdministrator
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ne $ExpectedUser) { throw 'Run setup as the existing PM2 owner.' }
Assert-ContentParentAcl $Root
$runnerSid = Resolve-ContentRunnerSid $RunnerIdentity
if ($runnerSid.Value -eq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Runner must differ from PM2 owner.' }
$pm2Home = Get-ContentFullPath (Join-Path $env:USERPROFILE '.pm2')
Assert-ContentPm2Home -ExpectedHome $pm2Home -ConfiguredHome $env:PM2_HOME
$toolRoot = Join-Path $Root 'release-tools'
$delivery = Join-Path $Root 'release-delivery'
$taskName = 'GdufsmcReleasePublish'
if ((Test-Path -LiteralPath $toolRoot) -or (Test-Path -LiteralPath $delivery) -or (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
    throw 'Release tools, delivery directory or task already exists. Inspect the existing installation; setup never overwrites it.'
}
$files = @('content-operations.ps1', 'artifact-operations.ps1', 'publish-from-artifacts.ps1', 'process-release-queue.ps1', 'submit-release.ps1')
foreach ($file in $files) {
    $source = Join-Path $PSScriptRoot $file
    Assert-ContentNoReparse $source
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Installer bundle missing $file" }
}
foreach ($path in @($NodePath, $Pm2Path, (Join-Path $Root 'content-tools/config.json'), (Join-Path $Root 'shared/deployment-state.json'))) {
    Assert-ContentNoReparse $path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required production dependency missing: $path" }
}
$nodeVersion = (& $NodePath --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v24.21.0') { throw 'Production Node must be exactly 24.21.0.' }
$paths = @($toolRoot, $delivery, (Join-Path $delivery 'inbox'), (Join-Path $delivery 'results'), (Join-Path $delivery 'logs'), (Join-Path $Root 'artifacts'))
foreach ($path in $paths) { Assert-ContentPathWithinRoot $Root $path; Assert-ContentNoReparse $path -Recurse }
$config = [ordered]@{ version = 1; root = $Root; expectedUser = $ExpectedUser; pm2Home = $pm2Home
    nodePath = (Get-ContentFullPath $NodePath); pm2Path = (Get-ContentFullPath $Pm2Path); keep = $Keep }
if (-not $Install) {
    [ordered]@{ mode = 'DryRun'; task = $taskName; identity = $ExpectedUser; intervalMinutes = 1
        runnerWrite = (Join-Path $delivery 'inbox'); config = $config; creates = $paths
        note = 'No files, ACLs or tasks changed. Install first, then enable RELEASE_PUBLISH_ENABLED in GitHub.' } | ConvertTo-Json -Depth 5
    return
}
foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path | Out-Null }
    if ($path -eq (Join-Path $delivery 'inbox')) {
        Set-ContentManagedAcl -Path $path -RunnerSid $runnerSid -RunnerRights Modify
    } elseif ($path -in @((Join-Path $delivery 'logs'), (Join-Path $Root 'artifacts'))) {
        Set-ContentManagedAcl -Path $path -RunnerSid $runnerSid -AdminOnly
    } else { Set-ContentManagedAcl -Path $path -RunnerSid $runnerSid }
}
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $toolRoot $file) }
Write-ContentJsonAtomic (Join-Path $toolRoot 'config.json') $config
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $toolRoot 'process-release-queue.ps1') + '" -ConfigPath "' + (Join-Path $toolRoot 'config.json') + '"'
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $toolRoot
$triggers = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
$principal = New-ScheduledTaskPrincipal -UserId $ExpectedUser -LogonType S4U -RunLevel Highest
# No timeout: terminating the administrator process could interrupt rollback.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Publish verified full releases as the PM2 owner; independent of the content queue.' | Out-Null
Write-Host 'Release delivery installed. Verify GdufsmcReleasePublish, then enable RELEASE_PUBLISH_ENABLED=true in GitHub.'
