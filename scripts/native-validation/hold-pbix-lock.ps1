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
    [Console]::In.ReadLine() | Out-Null
} finally {
    $stream.Dispose()
}
