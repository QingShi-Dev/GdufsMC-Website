# Artifact preparation helpers. Dot-sourcing only declares functions (PowerShell 5.1).
# content-operations.ps1 must be loaded first.
function Write-ArtifactLog {
    param([string]$Message)
    Write-Host ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

function Get-ArtifactVersions {
    param([string]$Directory)
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    foreach ($item in Get-ChildItem -LiteralPath $Directory -Directory -Force) {
        if ($item.Name -cmatch '^release-([0-9]{2})\.([1-9]|1[0-2])\.([1-9][0-9]*)$') {
            [pscustomobject]@{ Name = $item.Name; Path = $item.FullName
                Year = [int]$Matches[1]; Month = [int]$Matches[2]; Sequence = [long]$Matches[3] }
        }
    }
}

function Get-NextArtifactVersion {
    param([object[]]$Versions, [datetime]$Date = (Get-Date))
    $year = $Date.Year % 100
    $maximum = 0L
    foreach ($version in $Versions) {
        if ($version.Year -eq $year -and $version.Month -eq $Date.Month) {
            $maximum = [Math]::Max($maximum, $version.Sequence)
        }
    }
    if ($maximum -eq [long]::MaxValue) { throw 'Artifact sequence exhausted.' }
    return ('release-{0:00}.{1}.{2}' -f $year, $Date.Month, ($maximum + 1))
}

function Remove-ArtifactPath {
    param([string]$Parent, [string]$Path)
    # Validate the resolved absolute target before every recursive deletion.
    $full = Get-ContentFullPath $Path
    Assert-ContentPathWithinRoot $Parent $full
    if (-not (Split-Path -Parent $full).Equals((Get-ContentFullPath $Parent), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Deletion target must be a direct child of $Parent"
    }
    Assert-ContentNoReparse $full -Recurse
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}

function Assert-ArtifactEntryPath {
    param([string]$Name, [string]$Destination)
    $relative = $Name.Replace('\', '/')
    while ($relative.StartsWith('./')) { $relative = $relative.Substring(2) }
    if ($relative -eq '' -or $relative -eq '.') { return }
    if ($relative.StartsWith('/') -or $relative -match '[\x00-\x1f:<>"|?*]') {
        throw "Unsafe archive entry: $Name"
    }
    foreach ($part in $relative.TrimEnd('/').Split('/')) {
        if ($part -in @('', '.', '..') -or $part -match '[. ]$' -or
            $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw "Unsafe archive entry: $Name"
        }
    }
    Assert-ContentPathWithinRoot $Destination (Join-Path $Destination $relative)
}

function Expand-ArtifactZip {
    param([string]$Zip, [string]$Destination)
    Assert-ContentNoReparse $Zip
    if (Test-Path -LiteralPath $Destination) { throw "Artifact directory already exists: $Destination" }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        foreach ($entry in $archive.Entries) {
            Assert-ArtifactEntryPath $entry.FullName $Destination
            $kind = ($entry.ExternalAttributes -shr 16) -band 0xf000
            if ($kind -notin @(0, 0x8000, 0x4000)) { throw 'ZIP contains a link or special file.' }
        }
    } finally { $archive.Dispose() }
    Expand-Archive -LiteralPath $Zip -DestinationPath $Destination -ErrorAction Stop
    Assert-ContentNoReparse $Destination -Recurse
}

function Expand-ArtifactTar {
    param([string]$Tarball, [string]$Destination)
    $tar = Join-Path $env:SystemRoot 'System32/tar.exe'
    if (-not (Test-Path -LiteralPath $tar -PathType Leaf)) { throw 'Windows System32/tar.exe is missing.' }
    if (Test-Path -LiteralPath $Destination) { throw "Candidate directory already exists: $Destination" }
    # Reject traversal and links BEFORE extraction, not merely after writing them.
    $names = @(& $tar -tf $Tarball)
    if ($LASTEXITCODE -ne 0 -or $names.Count -eq 0) { throw 'Cannot list release tarball.' }
    foreach ($name in $names) { Assert-ArtifactEntryPath $name $Destination }
    $details = @(& $tar -tvf $Tarball)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect release tarball types.' }
    foreach ($line in $details) {
        if ($line -cnotmatch '^[-d]') { throw "Tarball contains a link or special file: $line" }
    }
    New-Item -ItemType Directory -Path $Destination -ErrorAction Stop | Out-Null
    & $tar -xf $Tarball -C $Destination
    if ($LASTEXITCODE -ne 0) { throw "Release extraction failed (exit $LASTEXITCODE)." }
    Assert-ContentNoReparse $Destination -Recurse
}
