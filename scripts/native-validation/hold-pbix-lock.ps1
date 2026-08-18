param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = "Stop"
$stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
)
try {
    [Console]::Out.WriteLine("LOCKED")
    [Console]::Out.Flush()
    while ($true) {
        $command = [Console]::In.ReadLine()
        if ($null -eq $command -or $command -eq "RELEASE") { break }
        if ($command -eq "PING") {
            [Console]::Out.WriteLine("ALIVE")
            [Console]::Out.Flush()
        }
    }
} finally {
    $stream.Dispose()
}
