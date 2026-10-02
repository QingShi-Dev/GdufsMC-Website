# Shared Windows content operations. Dot-sourcing only declares functions.
# Compatible with Windows PowerShell 5.1; no install, service or PM2 operations.

function Assert-ContentAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Content setup requires an elevated Administrator session.'
    }
}

function Get-ContentFullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path -notmatch '^[A-Za-z]:[\\/]') {
        throw "An absolute local drive path is required: $Path"
    }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Assert-ContentPathWithinRoot {
    param([string]$Root, [string]$Path, [switch]$AllowRoot)
    $base = Get-ContentFullPath $Root
    $full = Get-ContentFullPath $Path
    if (($AllowRoot -and $full.Equals($base, [StringComparison]::OrdinalIgnoreCase)) -or
        $full.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) { return }
    throw "Path is outside the intended root '$base': $full"
}

function Assert-ContentNoReparse {
    param([Parameter(Mandatory = $true)][string]$Path, [switch]$Recurse)
    $full = Get-ContentFullPath $Path
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Reparse point is not permitted: $cursor"
            }
        }
        $parent = Split-Path -Parent $cursor
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    if ($Recurse -and (Test-Path -LiteralPath $full -PathType Container)) {
        $pending = New-Object 'Collections.Generic.Stack[string]'
        $pending.Push($full)
        while ($pending.Count -gt 0) {
            foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction Stop) {
                if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "Reparse point is not permitted: $($item.FullName)"
                }
                if ($item.PSIsContainer) { $pending.Push($item.FullName) }
            }
        }
    }
}

function Read-ContentJson {
    param([Parameter(Mandatory = $true)][string]$Path)
    Assert-ContentNoReparse $Path
    return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
}

function Write-ContentJsonAtomic {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Value,
        [ValidateRange(1, 20)][int]$Attempts = 5, [ValidateRange(0, 1000)][int]$RetryDelayMs = 100)
    $full = Get-ContentFullPath $Path
    Assert-ContentNoReparse $full
    $parent = Split-Path -Parent $full
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "JSON parent directory missing: $parent" }
    $token = [Guid]::NewGuid().ToString('N')
    $temporary = Join-Path $parent ('.content-write-' + $token + '.tmp')
    $backup = Join-Path $parent ('.content-write-' + $token + '.bak')
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 20) + "`n"), $utf8)
    try {
        for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
            try {
                if ([IO.File]::Exists($full)) {
                    # Supply a real backup path: PowerShell 5.1 coerces null to ''.
                    # Preserve destination ACLs; all three paths share one directory.
                    # Windows can expose a brief name gap: callers must hold the
                    # deployment lock, and public projection readers must retry.
                    [IO.File]::Replace($temporary, $full, $backup)
                } else {
                    [IO.File]::Move($temporary, $full)
                }
                break
            } catch [IO.IOException] {
                if ($attempt -eq $Attempts -or -not [IO.File]::Exists($temporary) -or [IO.File]::Exists($backup)) { throw }
                Start-Sleep -Milliseconds $RetryDelayMs
            }
        }
    } catch {
        # Preserve diagnostic files after an uncertain filesystem failure. Restore a
        # backup only when Windows removed the destination before reporting failure.
        if (-not [IO.File]::Exists($full) -and [IO.File]::Exists($backup)) {
            [IO.File]::Move($backup, $full)
        }
        throw
    }
    if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) }
}

function Enter-ContentDeploymentLock {
    param([Parameter(Mandatory = $true)][string]$Path, [int]$TimeoutSec = 60)
    if ($TimeoutSec -lt 0) { throw 'Lock timeout must not be negative.' }
    Assert-ContentNoReparse $Path
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $Path) -PathType Container)) {
        throw "Lock parent directory missing: $Path"
    }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        try {
            return [IO.File]::Open($Path, [IO.FileMode]::OpenOrCreate,
                [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        } catch [IO.IOException] {
            if ($timer.Elapsed.TotalSeconds -ge $TimeoutSec) { throw "Deployment lock busy: $Path" }
            Start-Sleep -Milliseconds 100
        }
    }
}

function Assert-ContentPm2Home {
    param([Parameter(Mandatory = $true)][string]$ExpectedHome, [string]$ConfiguredHome)
    $expected = Get-ContentFullPath $ExpectedHome
    if ($ConfiguredHome -and (Get-ContentFullPath $ConfiguredHome) -ne $expected) {
        throw "PM2_HOME must match the PM2 owner's profile directory '$expected'; refusing to select another daemon."
    }
    Assert-ContentNoReparse $expected
    if (-not (Test-Path -LiteralPath $expected -PathType Container)) { throw "Existing PM2 home directory missing: $expected" }
}

function Resolve-ContentRunnerSid {
    param([Parameter(Mandatory = $true)][string]$Identity)
    $account = New-Object Security.Principal.NTAccount($Identity)
    $sid = $account.Translate([Security.Principal.SecurityIdentifier])
    if ($sid.Value -in @('S-1-5-18', 'S-1-5-32-544') -or $sid.Value -match '-500$') {
        throw 'The content runner must not use SYSTEM or an Administrator identity.'
    }
    return $sid
}

function Assert-ContentParentAcl {
    param([Parameter(Mandatory = $true)][string]$Path)
    # Fail closed rather than changing the deployment root's unrelated permissions.
    # Unknown group membership must never turn a writable parent into a trusted tool path.
    $safe = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
    $dangerous = [Security.AccessControl.FileSystemRights]::Write -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    $cursor = Get-ContentFullPath $Path
    while ($cursor) {
        $acl = Get-Acl -LiteralPath $cursor
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -notin $safe -and $owner -ne 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464') {
            throw "Untrusted owner on deployment ancestor '$cursor': $owner"
        }
        foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
                ($rule.FileSystemRights -band $dangerous) -ne 0 -and $rule.IdentityReference.Value -notin $safe) {
                throw "Deployment ancestor '$cursor' grants unsafe write/delete rights to $($rule.IdentityReference.Value). Review its ACL before installation."
            }
        }
        $parent = Split-Path -Parent $cursor
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
        # Creating an unrelated sibling is harmless; deleting/renaming the root
        # through an ancestor or changing that ancestor's ACL is not.
        $dangerous = [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
            [Security.AccessControl.FileSystemRights]::Delete -bor
            [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
            [Security.AccessControl.FileSystemRights]::TakeOwnership
    }
}

function Set-ContentManagedAcl {
    param([string]$Path, [Security.Principal.SecurityIdentifier]$RunnerSid,
        [Security.AccessControl.FileSystemRights]$RunnerRights = 'ReadAndExecute', [switch]$File, [switch]$AdminOnly)
    Assert-ContentNoReparse $Path
    $acl = if ($File) { New-Object Security.AccessControl.FileSecurity } else { New-Object Security.AccessControl.DirectorySecurity }
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = if ($File) { [Security.AccessControl.InheritanceFlags]::None } else {
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    foreach ($sidValue in @('S-1-5-18', 'S-1-5-32-544')) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    if (-not $AdminOnly) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($RunnerSid, $RunnerRights, $inheritance, 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-ContentDeploymentProjection {
    param([Parameter(Mandatory = $true)]$Current)
    if ([string]$Current.commit -notmatch '^[0-9a-f]{40}$' -or [string]::IsNullOrWhiteSpace([string]$Current.id)) {
        throw 'Deployment baseline needs a full commit and a release id.'
    }
    return [ordered]@{ version = 1; commit = [string]$Current.commit; releaseId = [string]$Current.id }
}

function Assert-ContentOperationId {
    param([string]$OperationId)
    if ($OperationId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$') { throw 'Invalid content operation id.' }
}

function Invoke-ContentDirectorySwap {
    param([string]$Root, [string]$CandidateContent, [string]$OperationId)
    # Caller must hold shared/deployment.lock and have stopped the production app.
    Assert-ContentOperationId $OperationId
    $Root = Get-ContentFullPath $Root
    $CandidateContent = Get-ContentFullPath $CandidateContent
    Assert-ContentPathWithinRoot $Root $CandidateContent
    Assert-ContentNoReparse $CandidateContent -Recurse
    if (-not (Test-Path -LiteralPath $CandidateContent -PathType Container)) { throw 'Candidate content directory missing.' }
    $live = Join-Path $Root 'content'
    $stagingParent = Join-Path $Root ('coordination/staging/' + $OperationId)
    $staged = Join-Path $stagingParent 'content'
    $backupParent = Join-Path $Root ('content-backups/' + $OperationId)
    $backup = Join-Path $backupParent 'content'
    foreach ($path in @($live, $stagingParent, $backupParent)) {
        Assert-ContentPathWithinRoot $Root $path
        Assert-ContentNoReparse $path -Recurse
        if ($path.StartsWith($CandidateContent + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate contains a swap destination; recursive copy refused.' }
    }
    if ($CandidateContent.Equals($live, [StringComparison]::OrdinalIgnoreCase) -or
        $CandidateContent.StartsWith($live + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate must be separate from live content.' }
    if ((Test-Path -LiteralPath $stagingParent) -or (Test-Path -LiteralPath $backupParent)) { throw 'Content operation directory already exists; use a fresh operation id.' }
    if (-not (Test-Path -LiteralPath $live -PathType Container)) { throw 'Live content directory missing; cannot preserve rollback baseline.' }
    New-Item -ItemType Directory -Path $stagingParent -Force | Out-Null
    New-Item -ItemType Directory -Path $backupParent -Force | Out-Null
    Copy-Item -LiteralPath $CandidateContent -Destination $staged -Recurse
    Assert-ContentNoReparse $staged -Recurse
    [IO.Directory]::Move($live, $backup)
    try { [IO.Directory]::Move($staged, $live) }
    catch {
        if (-not (Test-Path -LiteralPath $live) -and (Test-Path -LiteralPath $backup -PathType Container)) {
            [IO.Directory]::Move($backup, $live)
        }
        throw
    }
    return [pscustomobject]@{ backupPath = $backup; operationId = $OperationId }
}

function Restore-ContentDirectorySwap {
    param([string]$Root, [string]$BackupPath, [string]$OperationId)
    # This is failure recovery. Normal rollback uses Invoke-ContentDirectorySwap
    # with a retained backup as the candidate, preserving both rollback directions.
    Assert-ContentOperationId $OperationId
    $Root = Get-ContentFullPath $Root
    $BackupPath = Get-ContentFullPath $BackupPath
    Assert-ContentPathWithinRoot (Join-Path $Root 'content-backups') $BackupPath
    if ((Split-Path -Leaf $BackupPath) -ne 'content') { throw 'Backup path must end in content.' }
    $live = Join-Path $Root 'content'
    $failedParent = Join-Path $Root ('content-failed/' + $OperationId)
    $failed = Join-Path $failedParent 'content'
    foreach ($path in @($BackupPath, $live, $failedParent)) {
        Assert-ContentPathWithinRoot $Root $path
        Assert-ContentNoReparse $path -Recurse
    }
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Container)) { throw 'Content backup missing; recovery stopped.' }
    if (Test-Path -LiteralPath $failedParent) { throw 'Failed-content destination already exists.' }
    New-Item -ItemType Directory -Path $failedParent -Force | Out-Null
    $movedLive = $false
    if (Test-Path -LiteralPath $live) { [IO.Directory]::Move($live, $failed); $movedLive = $true }
    try { [IO.Directory]::Move($BackupPath, $live) }
    catch {
        if ($movedLive -and -not (Test-Path -LiteralPath $live)) { [IO.Directory]::Move($failed, $live) }
        throw
    }
    return [pscustomobject]@{ failedPath = $failed; operationId = $OperationId }
}

# ===========================================================================
# Retention for content-backups.
#
# WHY: every successful content activation moves the live tree aside into
# <Root>/content-backups/<operationId>. Nothing ever removed those, so the
# directory grew without bound (one full content copy per CMS save). The
# production check "how much disk is left" was the only feedback loop.
#
# GUARDS (do NOT delete anything that is not provably an old backup):
#   * caller must hold shared/deployment.lock and must have ALREADY completed
#     the swap, the state write and the journal. Running this earlier would
#     let a failed publish consume a retention slot.
#   * only DIRECT children of <Root>/content-backups
#   * the name must be a valid operation id AND the folder must contain a
#     'content' subdirectory, i.e. it really is a directory-swap backup.
#     Anything else is unknown and is RETAINED for diagnosis.
#   * any operation id in -KeepOperationIds is never removed (the current
#     operation, and the backup recorded in shared/content-state.json, which
#     publish-release.ps1 -Rollback depends on)
#   * the whole tree must contain NO reparse points
#   * on any delete failure, emit a WARNING and keep going. Pruning is
#     housekeeping; it must never fail a completed publish.
#   * content-failed/ is a separate tree and is never touched here.
# ===========================================================================
function Clear-OldContentBackups {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string[]]$KeepOperationIds = @(),
        [ValidateRange(1, 500)][int]$Keep = 10
    )
    $Root = Get-ContentFullPath $Root
    $backupsRoot = Join-Path $Root 'content-backups'
    $summary = [pscustomobject]@{ retained = @(); removed = @(); skipped = @() }
    if (-not (Test-Path -LiteralPath $backupsRoot -PathType Container)) { return $summary }
    Assert-ContentNoReparse $backupsRoot
    # PowerShell variable names are case-insensitive, so a local called $keep
    # would overwrite the [int]$Keep parameter and fail the assignment.
    $pinned = @()
    if ($KeepOperationIds) { $pinned = @($KeepOperationIds | Where-Object { -not [string]::IsNullOrEmpty([string]$_) }) }

    # Newest first. CreationTimeUtc is set when the <operationId> folder is
    # created by Invoke-ContentDirectorySwap, i.e. at swap time; a manual
    # Copy-Item restore may not preserve it, so LastWriteTimeUtc breaks ties.
    $candidates = @()
    foreach ($child in (Get-ChildItem -LiteralPath $backupsRoot -Directory -Force)) {
        if ($child.Name -in $pinned) { continue }
        if ($child.Name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$' -or
            -not (Test-Path -LiteralPath (Join-Path $child.FullName 'content') -PathType Container)) {
            $summary.skipped += $child.Name
            continue
        }
        $candidates += $child
    }
    $ordered = @($candidates | Sort-Object -Property `
        @{ Expression = { $_.CreationTimeUtc }; Descending = $true },
        @{ Expression = { $_.LastWriteTimeUtc }; Descending = $true },
        @{ Expression = { $_.Name }; Descending = $true })

    for ($i = 0; $i -lt $ordered.Count; $i++) {
        $child = $ordered[$i]
        if ($i -lt $Keep) { $summary.retained += $child.Name; continue }
        try {
            Assert-ContentNoReparse $child.FullName -Recurse
            Remove-Item -LiteralPath $child.FullName -Recurse -Force -ErrorAction Stop
            $summary.removed += $child.Name
        } catch {
            Write-Warning "Skip backup removal (retained): $($child.Name): $($_.Exception.Message)"
            $summary.skipped += $child.Name
        }
    }
    return $summary
}
