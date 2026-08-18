function Get-SddlSha256 {
    param([string]$Sddl)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Sddl)
    return [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($bytes)
    ).ToLowerInvariant()
}

function Get-SemanticAclSha256 {
    param([string]$Sddl)
    $normalized = $Sddl -replace "D:AI", "D:" -replace "S:AI", "S:"
    return Get-SddlSha256 $normalized
}

function Write-AtomicRecoveryJournal {
    param([string]$Path, $Journal)
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    $temporary = "$Path.tmp"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(
        ($Journal | ConvertTo-Json -Depth 8 -Compress)
    )
    $stream = [System.IO.FileStream]::new(
        $temporary,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough
    )
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally {
        $stream.Dispose()
    }
    if (-not [RecoveryMove]::MoveFileEx($temporary, $Path, 0x1 -bor 0x8)) {
        throw "Write-through recovery journal rename failed"
    }
}

function Restore-SnapshotAclJournal {
    param(
        [string]$RepoRoot,
        [string]$JournalPath,
        [scriptblock]$AclWriter = { param($Path, $Acl) Set-Acl -Path $Path -AclObject $Acl }
    )
    $journal = Get-Content $JournalPath -Raw | ConvertFrom-Json
    $snapshotRoot = Join-Path $RepoRoot $journal.snapshotLogicalPath.Replace("/", "\")
    $errors = @()
    $resolved = @()
    foreach ($entry in $journal.directories) {
        try {
            $validate = New-Object System.Security.AccessControl.DirectorySecurity
            $validate.SetSecurityDescriptorSddlForm($entry.sddl)
            if ((Get-SddlSha256 $entry.sddl) -ne $entry.sddlSha256 -or
                (Get-SemanticAclSha256 $entry.sddl) -ne $entry.semanticAclSha256) {
                throw "journal ACL hash differs"
            }
        } catch {
            $errors += "$($entry.relativePath): invalid journal ACL"
        }
    }
    if ($errors.Count -gt 0) {
        $journal.recoveryErrors = $errors
        Write-AtomicRecoveryJournal -Path $JournalPath -Journal $journal
        return [ordered]@{ recovered = $false; errors = $errors }
    }
    foreach ($entry in @($journal.directories | Sort-Object { $_.relativePath.Length } -Descending)) {
        try {
            $directory = if ($entry.relativePath) {
                Join-Path $snapshotRoot $entry.relativePath.Replace("/", "\")
            } else {
                $snapshotRoot
            }
            $restore = New-Object System.Security.AccessControl.DirectorySecurity
            $restore.SetSecurityDescriptorSddlForm($entry.sddl)
            & $AclWriter $directory $restore
            $resolved += [ordered]@{ directory = $directory; entry = $entry }
        } catch {
            $errors += "$($entry.relativePath): $($_.Exception.Message)"
        }
    }
    foreach ($item in $resolved) {
        try {
            $actual = (Get-Acl $item.directory).Sddl
            if ((Get-SemanticAclSha256 $actual) -ne $item.entry.semanticAclSha256) {
                throw "restored ACL hash differs"
            }
        } catch {
            $errors += "$($item.entry.relativePath): $($_.Exception.Message)"
        }
    }
    if ($errors.Count -eq 0) {
        Remove-Item $JournalPath -Force
        return [ordered]@{ recovered = $true; errors = @() }
    }
    $journal.recoveryErrors = $errors
    Write-AtomicRecoveryJournal -Path $JournalPath -Journal $journal
    return [ordered]@{ recovered = $false; errors = $errors }
}

function Recover-StaleSnapshotAclJournals {
    param(
        [string]$RepoRoot,
        [string]$RecoveryRoot,
        [scriptblock]$AclWriter = { param($Path, $Acl) Set-Acl -Path $Path -AclObject $Acl }
    )
    if (-not (Test-Path $RecoveryRoot)) { return @() }
    foreach ($temporary in Get-ChildItem -Path $RecoveryRoot -File -Filter "*.tmp") {
        $final = $temporary.FullName.Substring(0, $temporary.FullName.Length - 4)
        if (Test-Path $final) {
            Remove-Item $temporary.FullName -Force
        } else {
            # ACL mutation starts only after final journal publication, so a lone temp is pre-mutation.
            Remove-Item $temporary.FullName -Force
        }
    }
    $results = @()
    foreach ($journal in Get-ChildItem -Path $RecoveryRoot -File -Filter "*.json") {
        $results += Restore-SnapshotAclJournal -RepoRoot $RepoRoot `
            -JournalPath $journal.FullName -AclWriter $AclWriter
    }
    $failed = @($results | Where-Object { -not $_.recovered })
    if ($failed.Count -gt 0) {
        throw "Snapshot ACL recovery is incomplete; recovery journals were preserved"
    }
    return $results
}

function Open-SnapshotReadLocks {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$SnapshotRoot,
        [Parameter(Mandatory)][string]$RecoveryRoot,
        [Parameter(Mandatory)][string]$RunId,
        [scriptblock]$AclWriter = { param($Path, $Acl) Set-Acl -Path $Path -AclObject $Acl }
    )
    $locks = @()
    $directories = @()
    $token = Split-Path $SnapshotRoot -Leaf
    $logicalPath = [System.IO.Path]::GetRelativePath($RepoRoot, $SnapshotRoot).Replace("\", "/")
    $journalPath = Join-Path $RecoveryRoot "$token-$RunId.json"
    try {
        foreach ($directory in @(
            Get-Item $SnapshotRoot
            Get-ChildItem -Path $SnapshotRoot -Directory -Recurse
        )) {
            $acl = Get-Acl $directory.FullName
            $relative = [System.IO.Path]::GetRelativePath($SnapshotRoot, $directory.FullName)
            if ($relative -eq ".") { $relative = "" }
            $directories += [ordered]@{
                relativePath = $relative.Replace("\", "/")
                sddl = $acl.Sddl
                sddlSha256 = Get-SddlSha256 $acl.Sddl
                semanticAclSha256 = Get-SemanticAclSha256 $acl.Sddl
            }
        }
        $journal = [ordered]@{
            schemaVersion = 1
            runId = $RunId
            snapshotToken = $token
            snapshotLogicalPath = $logicalPath
            directories = $directories
            recoveryErrors = @()
        }
        Write-AtomicRecoveryJournal -Path $journalPath -Journal $journal

        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rights = [System.Security.AccessControl.FileSystemRights]::CreateFiles `
            -bor [System.Security.AccessControl.FileSystemRights]::CreateDirectories `
            -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity,
            $rights,
            "ContainerInherit,ObjectInherit",
            "None",
            "Deny"
        )
        foreach ($entry in $directories) {
            $directory = if ($entry.relativePath) {
                Join-Path $SnapshotRoot $entry.relativePath.Replace("/", "\")
            } else {
                $SnapshotRoot
            }
            $acl = Get-Acl $directory
            $acl.AddAccessRule($rule) | Out-Null
            & $AclWriter $directory $acl
        }
        foreach ($file in Get-ChildItem -Path $SnapshotRoot -File -Recurse) {
            $locks += [System.IO.File]::Open(
                $file.FullName,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::Read
            )
        }
        return [ordered]@{
            streams = $locks
            journalPath = $journalPath
            repoRoot = $RepoRoot
            evidence = [ordered]@{
                mode = "os-file-share-and-journaled-directory-deny-acl"
                runId = $RunId
                recoveryJournal = "dist/release/native-recovery/$token-$RunId.json"
                lockedFiles = $locks.Count
                guardedDirectories = $directories.Count
                writesDeletesAndAdditionsDenied = $true
            }
        }
    } catch {
        foreach ($lock in $locks) { $lock.Dispose() }
        if (Test-Path $journalPath) {
            Restore-SnapshotAclJournal -RepoRoot $RepoRoot -JournalPath $journalPath | Out-Null
        }
        throw "Could not establish recoverable OS snapshot protections: $($_.Exception.Message)"
    }
}

function Close-SnapshotReadLocks {
    param($Guard)
    foreach ($lock in $Guard.streams) { $lock.Dispose() }
    $result = Restore-SnapshotAclJournal -RepoRoot $Guard.repoRoot `
        -JournalPath $Guard.journalPath
    if (-not $result.recovered) {
        throw "Snapshot ACL restoration is incomplete: $($result.errors -join '; ')"
    }
}

function Open-PbixReadLock {
    param([Parameter(Mandatory)][string]$Path)
    return [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::Read
    )
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RecoveryMove {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool MoveFileEx(string existingFile, string newFile, int flags);
}
'@ -ErrorAction SilentlyContinue
