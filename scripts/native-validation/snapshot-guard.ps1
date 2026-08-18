function Open-SnapshotReadLocks {
    param(
        [Parameter(Mandatory)][string]$SnapshotRoot,
        [Parameter(Mandatory)][int]$ExpectedFileCount
    )
    $files = @(Get-ChildItem -Path $SnapshotRoot -File -Recurse)
    if ($files.Count -ne $ExpectedFileCount) {
        throw "Snapshot file set differs before lock acquisition"
    }
    $streams = @()
    try {
        foreach ($file in $files) {
            $streams += [System.IO.File]::Open(
                $file.FullName,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::Read
            )
        }
        return [ordered]@{
            streams = $streams
            evidence = [ordered]@{
                mode = "controlled-run-file-read-locks-and-phase-manifests"
                lockedFiles = $streams.Count
                writesAndDeletesDeniedForExpectedFiles = $true
                directoryAdditionsRequirePhaseDetection = $true
                adversarialSameUserImmutability = $false
            }
        }
    } catch {
        foreach ($stream in $streams) { $stream.Dispose() }
        throw "Could not establish controlled-run snapshot file locks"
    }
}

function Close-SnapshotReadLocks {
    param($Guard)
    foreach ($stream in $Guard.streams) { $stream.Dispose() }
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
