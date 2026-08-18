function Open-SnapshotReadLocks {
    param([Parameter(Mandatory)][string]$SnapshotRoot)
    $locks = @()
    $directoryAcls = @()
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rights = [System.Security.AccessControl.FileSystemRights]::CreateFiles `
            -bor [System.Security.AccessControl.FileSystemRights]::CreateDirectories `
            -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles `
            -bor [System.Security.AccessControl.FileSystemRights]::Delete
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity,
            $rights,
            "ContainerInherit,ObjectInherit",
            "None",
            "Deny"
        )
        foreach ($directory in @(
            Get-Item $SnapshotRoot
            Get-ChildItem -Path $SnapshotRoot -Directory -Recurse
        )) {
            $acl = Get-Acl $directory.FullName
            $directoryAcls += [ordered]@{
                path = $directory.FullName
                sddl = $acl.Sddl
            }
            $acl.AddAccessRule($rule) | Out-Null
            Set-Acl -Path $directory.FullName -AclObject $acl
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
            directoryAcls = $directoryAcls
            evidence = [ordered]@{
                mode = "os-file-share-and-directory-deny-acl"
                lockedFiles = $locks.Count
                guardedDirectories = $directoryAcls.Count
                writesDeletesAndAdditionsDenied = $true
            }
        }
    } catch {
        foreach ($lock in $locks) { $lock.Dispose() }
        foreach ($entry in @($directoryAcls | Sort-Object { $_.path.Length } -Descending)) {
            $restore = New-Object System.Security.AccessControl.DirectorySecurity
            $restore.SetSecurityDescriptorSddlForm($entry.sddl)
            Set-Acl -Path $entry.path -AclObject $restore
        }
        throw "Could not establish OS-enforced read-only snapshot locks"
    }
}

function Close-SnapshotReadLocks {
    param($Guard)
    foreach ($lock in $Guard.streams) { $lock.Dispose() }
    foreach ($entry in @($Guard.directoryAcls | Sort-Object { $_.path.Length } -Descending)) {
        $restore = New-Object System.Security.AccessControl.DirectorySecurity
        $restore.SetSecurityDescriptorSddlForm($entry.sddl)
        Set-Acl -Path $entry.path -AclObject $restore
    }
}
