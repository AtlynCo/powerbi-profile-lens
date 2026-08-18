function Get-SddlSha256 {
    param([string]$Sddl)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Sddl)
    return [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($bytes)
    ).ToLowerInvariant()
}

function Open-DirectoryPins {
    param([string]$RepoRoot, [string[]]$Targets)
    $paths = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $repo = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd("\")
    foreach ($target in $Targets) {
        $full = [System.IO.Path]::GetFullPath($target)
        $current = $repo
        $paths.Add($current) | Out-Null
        $relative = [System.IO.Path]::GetRelativePath($repo, $full)
        if ($relative -ne ".") {
            foreach ($segment in $relative.Split("\")) {
                $current = Join-Path $current $segment
                $paths.Add($current) | Out-Null
            }
        }
    }
    $pins = @()
    try {
        foreach ($path in $paths) {
            $handle = [DirectoryPin]::CreateFile(
                $path,
                0,
                0x1 -bor 0x2,
                [IntPtr]::Zero,
                3,
                0x02000000,
                [IntPtr]::Zero
            )
            if ($handle -eq [IntPtr](-1)) { throw "Directory pin creation failed" }
            $pins += $handle
        }
        foreach ($target in $Targets) {
            Assert-NoReparseComponents -RepoRoot $RepoRoot -Target $target
        }
        return ,$pins
    } catch {
        foreach ($handle in $pins) { [DirectoryPin]::CloseHandle($handle) | Out-Null }
        throw
    }
}

function Close-DirectoryPins {
    param([array]$Pins)
    foreach ($handle in $Pins) { [DirectoryPin]::CloseHandle($handle) | Out-Null }
}

function Get-SemanticAclSha256 {
    param([string]$Sddl)
    $normalized = $Sddl -replace "D:AI", "D:" -replace "S:AI", "S:"
    return Get-SddlSha256 $normalized
}

function Write-AtomicBytes {
    param([string]$Path, [byte[]]$Bytes)
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    $temporary = "$Path.tmp"
    $stream = [System.IO.FileStream]::new(
        $temporary,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None,
        4096,
        [System.IO.FileOptions]::WriteThrough
    )
    try {
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush($true)
    } finally {
        $stream.Dispose()
    }
    if (-not [RecoveryMove]::MoveFileEx($temporary, $Path, 0x1 -bor 0x8)) {
        throw "Write-through file rename failed"
    }
}

function Get-RecoveryHmacKey {
    param([string]$RecoveryRoot)
    $keyPath = Join-Path (Split-Path $RecoveryRoot -Parent) "native-recovery.key"
    $entropy = [System.Text.Encoding]::UTF8.GetBytes("AtlynProfileLens.NativeRecovery.v1")
    if (Test-Path $keyPath) {
        $protected = [System.IO.File]::ReadAllBytes($keyPath)
        $key = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $protected,
            $entropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        if ($key.Length -ne 32) { throw "Recovery HMAC key length is invalid" }
        return $key
    }
    $key = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($key)
    $protected = [System.Security.Cryptography.ProtectedData]::Protect(
        $key,
        $entropy,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    Write-AtomicBytes -Path $keyPath -Bytes $protected
    return $key
}

function Get-JournalHmac {
    param($Payload, [byte[]]$Key)
    $canonical = $Payload | ConvertTo-Json -Depth 8 -Compress
    $hmac = [System.Security.Cryptography.HMACSHA256]::new($Key)
    try {
        return [Convert]::ToHexString(
            $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($canonical))
        ).ToLowerInvariant()
    } finally {
        $hmac.Dispose()
    }
}

function Assert-NoReparseComponents {
        param([string]$RepoRoot, [string]$Target)
        $repo = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd("\")
        $full = [System.IO.Path]::GetFullPath($Target)
        if ($full -ne $repo -and
            -not $full.StartsWith("$repo\", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Path is outside the repository root"
        }
        $current = $repo
        if (((Get-Item $current).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "Repository root is a reparse point"
        }
        $relative = [System.IO.Path]::GetRelativePath($repo, $full)
        if ($relative -ne ".") {
            foreach ($segment in $relative.Split("\")) {
                $current = Join-Path $current $segment
                if (((Get-Item $current).Attributes -band
                    [System.IO.FileAttributes]::ReparsePoint)) {
                    throw "Path contains a reparse-point component"
            }
        }
    }
}

function Assert-JournalSchemaAndContainment {
    param($Payload, [string]$RepoRoot)
    $expectedProperties = @(
        "schemaVersion", "harnessId", "runId", "snapshotToken",
        "snapshotLogicalPath", "directories", "recoveryErrors"
    )
    $payloadProperties = if ($Payload -is [System.Collections.IDictionary]) {
        @($Payload.Keys)
    } else {
        @($Payload.PSObject.Properties.Name)
    }
    if ($payloadProperties.Count -ne $expectedProperties.Count -or
        @($payloadProperties | Where-Object { $_ -notin $expectedProperties }).Count) {
        throw "Recovery journal schema contains unexpected properties"
    }
    if ($Payload.schemaVersion -ne 1 -or
        $Payload.harnessId -ne "atlyn-profile-lens-native-validation" -or
        $Payload.runId -notmatch "^[0-9a-f]{32}$" -or
        $Payload.snapshotToken -notmatch "^[0-9a-f]{64}$" -or
        $Payload.snapshotLogicalPath -ne
            "dist/release/native-snapshot/$($Payload.snapshotToken)") {
        throw "Recovery journal identity is invalid"
    }
    $snapshotRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $RepoRoot $Payload.snapshotLogicalPath.Replace("/", "\"))
    )
    $expectedRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $RepoRoot "dist\release\native-snapshot\$($Payload.snapshotToken)")
    )
    if ($snapshotRoot -ne $expectedRoot -or
        ((Get-Item $snapshotRoot).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        throw "Recovery snapshot root is outside the canonical non-reparse location"
    }
    Assert-NoReparseComponents -RepoRoot $RepoRoot -Target $snapshotRoot
    $seen = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $allowedSids = @(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
        "S-1-5-18",
        "S-1-5-32-544"
    )
    foreach ($entry in $Payload.directories) {
        $directoryProperties = if ($entry -is [System.Collections.IDictionary]) {
            @($entry.Keys)
        } else {
            @($entry.PSObject.Properties.Name)
        }
        if ($directoryProperties.Count -ne 4 -or
            @($directoryProperties | Where-Object {
                $_ -notin @("relativePath", "sddl", "sddlSha256", "semanticAclSha256")
            }).Count) {
            throw "Recovery journal directory schema is invalid"
        }
        $relative = [string]$entry.relativePath
        if ([System.IO.Path]::IsPathRooted($relative) -or $relative.Contains("\") -or
            $relative.Contains(":") -or ($relative.Split("/") -contains "..") -or
            -not $seen.Add($relative)) {
            throw "Recovery journal directory path is invalid or duplicated"
        }
        $target = [System.IO.Path]::GetFullPath(
            (Join-Path $snapshotRoot $relative.Replace("/", "\"))
        )
        if ($target -ne $snapshotRoot -and
            -not $target.StartsWith("$snapshotRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Recovery journal directory escapes the snapshot root"
        }
        if (((Get-Item $target).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "Recovery journal directory is a reparse point"
        }
        Assert-NoReparseComponents -RepoRoot $RepoRoot -Target $target
        $security = New-Object System.Security.AccessControl.DirectorySecurity
        $security.SetSecurityDescriptorSddlForm($entry.sddl)
        $owner = $security.GetOwner(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
        if ($owner -notin $allowedSids) {
            throw "Recovery journal ACL contains an unexpected owner"
        }
        foreach ($rule in $security.GetAccessRules(
            $true,
            $true,
            [System.Security.Principal.SecurityIdentifier]
        )) {
            if ($rule.IdentityReference.Value -notin $allowedSids) {
                throw "Recovery journal ACL contains an unexpected principal"
            }
            if ($rule.AccessControlType -ne
                [System.Security.AccessControl.AccessControlType]::Allow) {
                throw "Recovery journal ACL contains unexpected deny rights"
            }
        }
    }
    return $snapshotRoot
}

function Read-AuthenticatedRecoveryJournal {
    param([string]$Path, [string]$RepoRoot)
    $envelope = Get-Content $Path -Raw | ConvertFrom-Json
    if (@($envelope.PSObject.Properties.Name).Count -ne 2 -or
        -not $envelope.payload -or $envelope.hmacSha256 -notmatch "^[0-9a-f]{64}$") {
        throw "Recovery journal envelope is invalid"
    }
    $key = Get-RecoveryHmacKey -RecoveryRoot (Split-Path $Path -Parent)
    $expected = Get-JournalHmac -Payload $envelope.payload -Key $key
    if (-not [System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals(
        [Convert]::FromHexString($expected),
        [Convert]::FromHexString($envelope.hmacSha256)
    )) {
        throw "Recovery journal authentication failed"
    }
    Assert-JournalSchemaAndContainment -Payload $envelope.payload -RepoRoot $RepoRoot | Out-Null
    return $envelope.payload
}

function Write-AtomicRecoveryJournal {
    param([string]$Path, $Journal)
    $key = Get-RecoveryHmacKey -RecoveryRoot (Split-Path $Path -Parent)
    $envelope = [ordered]@{
        payload = $Journal
        hmacSha256 = Get-JournalHmac -Payload $Journal -Key $key
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(
        ($envelope | ConvertTo-Json -Depth 10 -Compress)
    )
    Write-AtomicBytes -Path $Path -Bytes $bytes
}

function Restore-SnapshotAclJournal {
    param(
        [string]$RepoRoot,
        [string]$JournalPath,
        [scriptblock]$AclWriter = { param($Path, $Acl) Set-Acl -Path $Path -AclObject $Acl }
    )
    $journal = Read-AuthenticatedRecoveryJournal -Path $JournalPath -RepoRoot $RepoRoot
    $expectedName = "$($journal.snapshotToken)-$($journal.runId).json"
    if ((Split-Path $JournalPath -Leaf) -ne $expectedName) {
        throw "Recovery journal filename does not match its authenticated identity"
    }
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
    $restoreTargets = @($journal.directories | ForEach-Object {
        if ($_.relativePath) {
            Join-Path $snapshotRoot $_.relativePath.Replace("/", "\")
        } else {
            $snapshotRoot
        }
    })
    $pins = Open-DirectoryPins -RepoRoot $RepoRoot -Targets $restoreTargets
    foreach ($entry in @($journal.directories | Sort-Object { $_.relativePath.Length } -Descending)) {
        try {
            $directory = if ($entry.relativePath) {
                Join-Path $snapshotRoot $entry.relativePath.Replace("/", "\")
            } else {
                $snapshotRoot
            }
            $restore = New-Object System.Security.AccessControl.DirectorySecurity
            $restore.SetSecurityDescriptorSddlForm($entry.sddl)
            Assert-NoReparseComponents -RepoRoot $RepoRoot -Target $directory
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
    Close-DirectoryPins -Pins $pins
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
    foreach ($journal in Get-ChildItem -Path $RecoveryRoot -File) {
        if ($journal.Name -notmatch "^[0-9a-f]{64}-[0-9a-f]{32}\.json$") {
            throw "Unrecognized file exists in the dedicated recovery journal directory"
        }
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
    $directoryPins = @()
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
        $directoryTargets = @($directories | ForEach-Object {
            if ($_.relativePath) {
                Join-Path $SnapshotRoot $_.relativePath.Replace("/", "\")
            } else {
                $SnapshotRoot
            }
        })
        $directoryPins = Open-DirectoryPins -RepoRoot $RepoRoot -Targets $directoryTargets
        $journal = [ordered]@{
            schemaVersion = 1
            harnessId = "atlyn-profile-lens-native-validation"
            runId = $RunId
            snapshotToken = $token
            snapshotLogicalPath = $logicalPath
            directories = $directories
            recoveryErrors = @()
        }
        Assert-JournalSchemaAndContainment -Payload $journal -RepoRoot $RepoRoot | Out-Null
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
            Assert-NoReparseComponents -RepoRoot $RepoRoot -Target $directory
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
            directoryPins = $directoryPins
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
        Close-DirectoryPins -Pins $directoryPins
        if (Test-Path $journalPath) {
            Restore-SnapshotAclJournal -RepoRoot $RepoRoot -JournalPath $journalPath | Out-Null
        }
        throw "Could not establish recoverable OS snapshot protections: $($_.Exception.Message)"
    }
}

function Close-SnapshotReadLocks {
    param($Guard)
    foreach ($lock in $Guard.streams) { $lock.Dispose() }
    try {
        $result = Restore-SnapshotAclJournal -RepoRoot $Guard.repoRoot `
            -JournalPath $Guard.journalPath
    } finally {
        Close-DirectoryPins -Pins $Guard.directoryPins
    }
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

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DirectoryPin {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@ -ErrorAction SilentlyContinue
