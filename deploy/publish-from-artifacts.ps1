<#
.SYNOPSIS
    Prepare Actions ZIPs and invoke the existing publisher; Windows PowerShell 5.1.
.DESCRIPTION
    DryRun is read-only. ZIPs are processed in filename order; the first failure
    stops the batch. Run only one instance (the installed task uses IgnoreNew).
    No additional deployment lock: publish-release.ps1 owns that lock and rollback.
#>
[CmdletBinding()]
param(
    [string]$Root = 'H:/GDUFSMC-web',
    [switch]$DryRun,
    [switch]$KeepArtifacts,
    [ValidateRange(1, 1000)][int]$Keep = 3,
    [string]$ZipName,
    [string]$ExpectedCommit,
    [string]$NodePath = 'C:/Program Files/nodejs/node.exe',
    [string]$Pm2Path = 'C:/npm/pm2.cmd',
    [string]$ExpectedUser = 'WINSERVER08\Administrator'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'content-operations.ps1')
. (Join-Path $PSScriptRoot 'artifact-operations.ps1')
$Root = Get-ContentFullPath $Root
if ($Root -eq [IO.Path]::GetPathRoot($Root).TrimEnd('\')) { throw 'Deployment root cannot be a drive root.' }
$artifacts = Join-Path $Root 'artifacts'
$candidate = Join-Path $Root 'candidate'
$incoming = Join-Path $Root 'incoming'
foreach ($path in @($Root, $artifacts, $candidate, $incoming)) { Assert-ContentNoReparse $path }
if ($ZipName -and ($ZipName -ne [IO.Path]::GetFileName($ZipName) -or $ZipName -notmatch '\.zip$')) {
    throw 'ZipName must be a ZIP filename, without a directory.'
}
if ($ExpectedCommit -and (-not $ZipName -or $ExpectedCommit -cnotmatch '^[a-f0-9]{40}$')) {
    throw 'ExpectedCommit requires a single ZipName and a full lowercase commit.'
}
$zips = @()
if (Test-Path -LiteralPath $artifacts -PathType Container) {
    $zips = @(Get-ChildItem -LiteralPath $artifacts -Filter '*.zip' -File | Sort-Object Name |
        Where-Object { -not $ZipName -or $_.Name -eq $ZipName })
}
if ($zips.Count -eq 0) {
    if ($ZipName) { throw "Requested ZIP is missing: $ZipName" }
    Write-ArtifactLog 'No ZIP files to process.'
    return
}
if (-not $DryRun) {
    Assert-ContentAdministrator
    if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ne $ExpectedUser) {
        throw 'Run artifact publishing as the existing PM2 owner.'
    }
}
$versions = @(Get-ArtifactVersions $artifacts)
foreach ($zip in $zips) {
    $version = Get-NextArtifactVersion -Versions $versions
    $art = Join-Path $artifacts $version
    $stage = Join-Path $candidate $version
    foreach ($path in @($zip.FullName, $art, $stage)) { Assert-ContentNoReparse $path }
    if ((Test-Path -LiteralPath $art) -or (Test-Path -LiteralPath $stage)) { throw "Version directory already exists: $version" }
    Write-ArtifactLog "Prepare $($zip.Name) -> $version"
    $parts = $version.Substring(8).Split('.')
    $versions += [pscustomobject]@{ Name = $version; Path = $art; Year = [int]$parts[0]; Month = [int]$parts[1]; Sequence = [long]$parts[2] }
    $retired = @($versions | Sort-Object Year, Month, Sequence -Descending | Select-Object -Skip $Keep)
    # Never delete an in-flight candidate if future-dated directories are present.
    if (-not $KeepArtifacts -and @($retired | Where-Object Name -eq $version).Count -gt 0) {
        throw 'New version sorts outside the retention window; check server date or use KeepArtifacts.'
    }
    if ($DryRun) {
        Write-ArtifactLog "DRY RUN: expand ZIP to $art; delete ZIP only after successful extraction."
        if (-not $KeepArtifacts) {
            foreach ($old in $retired) { Write-ArtifactLog "DRY RUN: remove old artifact $($old.Name)" }
            $versions = @($versions | Where-Object { $_.Name -notin @($retired.Name) })
        }
        Write-ArtifactLog "DRY RUN: verify exactly one SHA256/tarball pair; extract to $stage; validate manifest and external content."
        Write-ArtifactLog "DRY RUN: invoke artifact deploy/publish-release.ps1; clear incoming on success/failure; remove successful candidate."
        continue
    }
    $failure = $null
    try {
        Expand-ArtifactZip $zip.FullName $art
        Write-ArtifactLog "ZIP extracted; deleting $($zip.Name)"
        Remove-ArtifactPath $artifacts $zip.FullName
        if (-not $KeepArtifacts) {
            foreach ($old in $retired) {
                Write-ArtifactLog "Remove old artifact $($old.Name)"
                Remove-ArtifactPath $artifacts $old.Path
            }
            $versions = @($versions | Where-Object { $_.Name -notin @($retired.Name) })
        }
        $outputs = Join-Path $art 'outputs'
        $tarballs = @(Get-ChildItem -LiteralPath $outputs -Filter '*.tar.gz' -File)
        $checksums = @(Get-ChildItem -LiteralPath $outputs -Filter '*.sha256.txt' -File)
        if ($tarballs.Count -ne 1 -or $checksums.Count -ne 1) { throw 'Expected exactly one tar.gz and one sha256.txt.' }
        $tarball = $tarballs[0]
        if ($checksums[0].Name -ne ($tarball.Name -replace '\.tar\.gz$', '.sha256.txt')) { throw 'Checksum sidecar name differs from tarball.' }
        $checksum = (Get-Content -LiteralPath $checksums[0].FullName -Raw).Trim()
        if ($checksum -notmatch '^([a-fA-F0-9]{64})\s+\*?([^\r\n]+)$' -or $Matches[2] -cne $tarball.Name) {
            throw 'Invalid SHA256 sidecar or mismatched archive filename.'
        }
        $expected = $Matches[1]
        $actual = (Get-FileHash -LiteralPath $tarball.FullName -Algorithm SHA256).Hash
        if ($actual -ne $expected) { throw 'SHA256 mismatch; artifact retained for diagnosis.' }
        Write-ArtifactLog 'SHA256 verified; extracting release with System32/tar.exe.'
        foreach ($file in @('deploy/publish-release.ps1', 'deploy/content-operations.ps1')) {
            if (-not (Test-Path -LiteralPath (Join-Path $art $file) -PathType Leaf)) { throw "Artifact missing $file" }
        }
        if (-not (Test-Path -LiteralPath $candidate)) { New-Item -ItemType Directory -Path $candidate | Out-Null }
        Expand-ArtifactTar $tarball.FullName $stage
        if (-not (Test-Path -LiteralPath (Join-Path $stage 'server.js') -PathType Leaf)) { throw 'Candidate server.js missing.' }
        if (Test-Path -LiteralPath (Join-Path $stage 'content')) { throw 'External release must not contain top-level content/.' }
        $manifest = Read-ContentJson (Join-Path $stage 'release.json')
        if (-not $manifest -or $manifest.nodeVersion -ne '24.21.0' -or $manifest.platform -ne 'win32' -or
            $manifest.arch -ne 'x64' -or $manifest.contentSyncVersion -ne 1 -or
            [string]$manifest.commit -cnotmatch '^[a-f0-9]{40}$' -or [string]$manifest.id -cnotmatch '^[a-z0-9][a-z0-9-]*$') {
            throw 'Invalid external Windows release manifest (requires Node 24.21.0 and contentSyncVersion 1).'
        }
        if ($ExpectedCommit -and $manifest.commit -cne $ExpectedCommit) { throw 'Candidate commit differs from Actions request.' }
        Write-ArtifactLog "Publish $version (commit $($manifest.commit)), source $($zip.Name)"
        # A separate process isolates publisher exit codes and lets our finally run.
        # Never timeout/kill this process: its failure recovery must finish.
        $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $art 'deploy/publish-release.ps1') `
                -ReleaseDirectory $stage -Root $Root -NodePath $NodePath -Pm2Path $Pm2Path -ExpectedUser $ExpectedUser
            $publisherExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($publisherExit -ne 0) { throw "Publisher failed (exit $publisherExit); inspect its recovery output and journal." }
        Write-ArtifactLog "Published $version; remove successful candidate."
        Remove-ArtifactPath $candidate $stage
    } catch {
        $failure = $_
        Write-ArtifactLog "FAILED $version : $($_.Exception.Message)"
    } finally {
        try {
            Write-ArtifactLog 'Clear incoming after this attempt.'
            Assert-ContentNoReparse $incoming -Recurse
            if (Test-Path -LiteralPath $incoming -PathType Container) {
                foreach ($item in Get-ChildItem -LiteralPath $incoming -Force) { Remove-ArtifactPath $incoming $item.FullName }
            }
        } catch {
            if ($failure) { Write-Warning "Incoming cleanup also failed: $_" } else { $failure = $_ }
        }
    }
    if ($failure) { throw $failure }
}
