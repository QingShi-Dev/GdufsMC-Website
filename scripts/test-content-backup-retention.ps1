# Isolated unit test for Clear-OldContentBackups. Never touches a real deployment
# root: every path lives under a private temp directory that is removed on success.
# Windows PowerShell 5.1 compatible.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $repoRoot 'deploy/content-operations.ps1')

$script:fixtures = @()
$script:failures = 0
$script:tests = 0

function New-FixtureRoot {
    $path = Join-Path ([IO.Path]::GetTempPath()) ('content-backup-retention-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $path 'content-backups') -Force | Out-Null
    return $path
}

# Creates content-backups/<id>/content/marker.txt and pins the slot's creation
# time so "newest N" is deterministic instead of depending on wall-clock order.
function Add-Backup {
    param([string]$Root, [string]$Id, [datetime]$CreatedUtc, [string]$Marker = 'x')
    $slot = Join-Path $Root ('content-backups/' + $Id)
    New-Item -ItemType Directory -Path (Join-Path $slot 'content') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $slot 'content/marker.txt'), $Marker)
    $item = Get-Item -LiteralPath $slot -Force
    $item.CreationTimeUtc = $CreatedUtc
    $item.LastWriteTimeUtc = $CreatedUtc
    return $slot
}

function Get-BackupIds {
    param([string]$Root)
    return @(Get-ChildItem -LiteralPath (Join-Path $Root 'content-backups') -Directory -Force |
        Sort-Object -Property Name | ForEach-Object { $_.Name })
}

function Test-Retention {
    param([string]$Name, [scriptblock]$Body)
    $script:tests++
    try {
        & $Body
        Write-Host "PASS $Name"
    } catch {
        $script:failures++
        Write-Host "FAIL $Name"
        Write-Host ('  ' + $_.Exception.Message)
    }
}

$base = [datetime]::new(2026, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)

Test-Retention 'keeps the newest N and removes the oldest beyond it' {
    $root = New-FixtureRoot
    $script:fixtures += $root
    foreach ($i in 1..12) { Add-Backup -Root $root -Id ('op-{0:d2}' -f $i) -CreatedUtc $base.AddHours($i) | Out-Null }
    $summary = Clear-OldContentBackups -Root $root -Keep 10
    $ids = Get-BackupIds $root
    if ($ids.Count -ne 10) { throw "expected 10 kept, got $($ids.Count): $($ids -join ',')" }
    if (($ids -join ',') -ne 'op-03,op-04,op-05,op-06,op-07,op-08,op-09,op-10,op-11,op-12') {
        throw "kept the wrong set: $($ids -join ',')"
    }
    if ($summary.removed.Count -ne 2) { throw "expected 2 removed, got $($summary.removed.Count)" }
}

Test-Retention 'pinned operation ids are never removed even when oldest' {
    $root = New-FixtureRoot
    $script:fixtures += $root
    Add-Backup -Root $root -Id 'pinned-a' -CreatedUtc $base | Out-Null
    Add-Backup -Root $root -Id 'pinned-b' -CreatedUtc $base.AddMinutes(1) | Out-Null
    foreach ($i in 1..12) { Add-Backup -Root $root -Id ('op-{0:d2}' -f $i) -CreatedUtc $base.AddHours($i) | Out-Null }
    $summary = Clear-OldContentBackups -Root $root -Keep 3 -KeepOperationIds @('pinned-a', 'pinned-b')
    $ids = Get-BackupIds $root
    if ($ids -notcontains 'pinned-a' -or $ids -notcontains 'pinned-b') { throw "pinned backup removed: $($ids -join ',')" }
    # 2 pinned + 3 newest ordinary backups.
    if ($ids.Count -ne 5) { throw "expected 5 total, got $($ids.Count): $($ids -join ',')" }
    if (($ids | Where-Object { $_ -like 'op-*' }) -join ',' -ne 'op-10,op-11,op-12') {
        throw "kept the wrong ordinary set: $($ids -join ',')"
    }
    if ($summary.removed -contains 'pinned-a') { throw 'summary reported a pinned removal' }
}

Test-Retention 'a folder that is not a directory-swap backup is retained' {
    $root = New-FixtureRoot
    $script:fixtures += $root
    # Valid operation-id name but no content/ subdirectory: unknown shape, so the
    # prune must leave it alone rather than guess.
    $junk = Join-Path $root 'content-backups/notes-from-operator'
    New-Item -ItemType Directory -Path $junk -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $junk 'readme.txt'), 'hand written')
    # Invalid operation-id characters: also retained.
    $weird = Join-Path $root 'content-backups/op escape'
    New-Item -ItemType Directory -Path (Join-Path $weird 'content') -Force | Out-Null
    foreach ($i in 1..12) { Add-Backup -Root $root -Id ('op-{0:d2}' -f $i) -CreatedUtc $base.AddHours($i) | Out-Null }
    $summary = Clear-OldContentBackups -Root $root -Keep 2
    $ids = Get-BackupIds $root
    if ($ids -notcontains 'notes-from-operator') { throw 'unknown folder was removed' }
    if ($ids -notcontains 'op escape') { throw 'invalid operation id was removed' }
    if ($summary.skipped -notcontains 'notes-from-operator' -or $summary.skipped -notcontains 'op escape') {
        throw "skipped list incomplete: $($summary.skipped -join ',')"
    }
    if (($ids | Where-Object { $_ -like 'op-0*' -or $_ -like 'op-1*' }).Count -ne 2) {
        throw "expected only 2 ordinary backups kept: $($ids -join ',')"
    }
}

Test-Retention 'content-failed is a separate tree and is never touched' {
    $root = New-FixtureRoot
    $script:fixtures += $root
    $failed = Join-Path $root 'content-failed/op-failed'
    New-Item -ItemType Directory -Path (Join-Path $failed 'content') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $failed 'content/marker.txt'), 'FAILED')
    Add-Backup -Root $root -Id 'op-01' -CreatedUtc $base | Out-Null
    $null = Clear-OldContentBackups -Root $root -Keep 1
    if (-not (Test-Path -LiteralPath (Join-Path $failed 'content/marker.txt') -PathType Leaf)) {
        throw 'content-failed was pruned'
    }
}

Test-Retention 'a missing backups directory is not an error' {
    $root = Join-Path ([IO.Path]::GetTempPath()) ('content-backup-retention-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $script:fixtures += $root
    $summary = Clear-OldContentBackups -Root $root -Keep 10
    if ($summary.retained.Count -ne 0) { throw 'expected an empty summary' }
}

Test-Retention 'removal failure warns and retains instead of throwing' {
    $root = New-FixtureRoot
    $script:fixtures += $root
    Add-Backup -Root $root -Id 'op-01' -CreatedUtc $base | Out-Null
    foreach ($i in 2..13) { Add-Backup -Root $root -Id ('op-{0:d2}' -f $i) -CreatedUtc $base.AddHours($i) | Out-Null }
    # Hold a read handle on the oldest slot's marker so Remove-Item cannot clear
    # the tree. This mimics a locked/permission-denied backup on a live server.
    $locked = Join-Path $root 'content-backups/op-01/content/marker.txt'
    $handle = [IO.File]::Open($locked, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $warnings = @()
        $summary = Clear-OldContentBackups -Root $root -Keep 3 -WarningVariable warnings
    } finally {
        $handle.Dispose()
    }
    $ids = Get-BackupIds $root
    if ($ids -notcontains 'op-01') { throw 'locked backup was not retained' }
    if ($summary.skipped -notcontains 'op-01') { throw "locked backup missing from skipped: $($summary.skipped -join ',')" }
    if ($warnings.Count -lt 1) { throw 'expected a warning for the locked backup' }
    if ($ids.Count -ne 4) { throw "expected 3 newest plus the locked one, got $($ids.Count): $($ids -join ',')" }
}

Write-Host "$($script:tests - $script:failures)/$script:tests content backup retention tests passed."

foreach ($path in $script:fixtures) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}
if ($script:failures) { exit 1 }
