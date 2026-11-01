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
    param([string]$Tarball, [string]$Destination, [string]$Extractor, [string]$NodePath)
    if (Test-Path -LiteralPath $Destination) { throw "Candidate directory already exists: $Destination" }
    if (-not (Test-Path -LiteralPath $Extractor -PathType Leaf)) { throw 'Packaged release extractor is missing.' }
    $package = Join-Path (Split-Path -Parent $Extractor) 'node_modules/modern-tar/package.json'
    if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { throw 'Packaged tar dependency is missing.' }
    Assert-ContentNoReparse $Tarball
    Assert-ContentNoReparse (Split-Path -Parent $Extractor) -Recurse
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $NodePath $Extractor $Tarball $Destination 2>&1)
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($exitCode -ne 0) { throw "Release extraction failed (exit $exitCode): $($output -join ' ')" }
    Assert-ContentNoReparse $Destination -Recurse
}
