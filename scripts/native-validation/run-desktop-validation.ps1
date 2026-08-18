param(
    [string]$Pbip = "samples\AtlynProfileLensSample\AtlynProfileLensSample.pbip",
    [string]$Pbix = "dist\release\AtlynProfileLensSample-1.2.0.0.pbix",
    [string]$EvidenceDirectory = "dist\release\native-evidence"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "desktop-guard.ps1")

$desktopExe = "C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pbipPath = (Resolve-Path (Join-Path $root $Pbip)).Path
$pbixPath = [System.IO.Path]::GetFullPath((Join-Path $root $Pbix))
$evidencePath = [System.IO.Path]::GetFullPath((Join-Path $root $EvidenceDirectory))
$reportName = [System.IO.Path]::GetFileNameWithoutExtension($pbipPath)
$expectedTitle = "*$reportName*"
$pages = @(
    "1 - Entity and band",
    "2 - Entity, period, band with series",
    "3 - Nongeographic grid and hex",
    "4 - Bound WGS84 points",
    "5 - Simple bound polygons",
    "6 - World countries (synthetic)",
    "7 - US states and equivalents (synthetic)",
    "8 - US counties and equivalents (synthetic)",
    "9 - Six profiles and interaction modes",
    "10 - Normalization modes",
    "11 - World 50m exact-key diagnostics",
    "12 - Progressive authoring landing"
)

function Start-OwnedReport {
    param([string]$Path)
    $existing = @(Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue)
    if ($existing.Count -gt 0) {
        throw "Desktop ownership blocker: existing PBIDesktop processes: $($existing.Id -join ', ')"
    }
    $known = @($existing.Id)
    Start-Process $desktopExe -ArgumentList "`"$Path`""
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        $candidate = Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue |
            Where-Object { $known -notcontains $_.Id -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Where-Object { [NativeDesktopGuard]::Title($_.MainWindowHandle) -like $expectedTitle } |
            Select-Object -First 1
        if ($candidate) {
            Assert-OwnedForeground -ProcessId $candidate.Id -ExpectedTitle $expectedTitle | Out-Null
            return $candidate
        }
    }
    throw "No newly owned Desktop window reached expected title '$expectedTitle'"
}

function Invoke-PagePass {
    param([int]$ProcessId, [string]$Pass)
    $observations = @()
    foreach ($page in $pages) {
        $element = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
            -Name $page -TimeoutSeconds 12
        if (-not $element) {
            $observations += [ordered]@{ page = $page; outcome = "not-observed"; reason = "page UIA target not found" }
            continue
        }
        Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $element
        Start-Sleep -Seconds 5
        $fileName = ($page -replace "[^A-Za-z0-9]+", "-").Trim("-").ToLowerInvariant()
        $capture = Capture-OwnedWindow -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
            -Path (Join-Path $evidencePath "$Pass-$fileName.png")
        $observations += [ordered]@{ page = $page; outcome = "observed"; screenshot = $capture }
    }
    return $observations
}

function Invoke-SaveAs {
    param([int]$ProcessId)
    $file = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
        -Name "File" -TimeoutSeconds 15
    if (-not $file) { throw "File command was not exposed by the owned Desktop window" }
    Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $file
    Start-Sleep -Seconds 3
    $saveAs = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
        -Name "Save as" -TimeoutSeconds 15
    if (-not $saveAs) { throw "Save as command was not exposed by the owned Desktop window" }
    Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $saveAs
    Start-Sleep -Seconds 3
    $browse = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
        -Name "Browse this device" -TimeoutSeconds 6
    if ($browse) {
        Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $browse
        Start-Sleep -Seconds 3
    }
    Assert-OwnedDialogForeground -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*"
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    Assert-OwnedDialogForeground -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*"
    [System.Windows.Forms.SendKeys]::SendWait($pbixPath)
    Assert-OwnedDialogForeground -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*"
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    $deadline = (Get-Date).AddMinutes(5)
    $lastLength = -1
    $stable = 0
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        if (Test-Path $pbixPath) {
            $length = (Get-Item $pbixPath).Length
            if ($length -gt 0 -and $length -eq $lastLength) { $stable++ } else { $stable = 0 }
            if ($stable -ge 2) { return }
            $lastLength = $length
        }
    }
    throw "Desktop did not produce a stable PBIX at '$pbixPath'"
}

function Close-OwnedReport {
    param([int]$ProcessId)
    $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle $expectedTitle
    $process.CloseMainWindow() | Out-Null
    if (-not $process.WaitForExit(30000)) {
        $probe = Get-OwnedUiaProbe -ProcessId $ProcessId -ExpectedTitle $expectedTitle
        $probe | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidencePath "close-blocker-uia.json")
        Stop-Process -Id $ProcessId
        (Get-Process -Id $ProcessId).WaitForExit(10000)
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path $pbixPath), $evidencePath | Out-Null
if (Test-Path $pbixPath) { Remove-Item $pbixPath -Force }

$record = [ordered]@{
    schemaVersion = 1
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    desktop = (Get-Item $desktopExe).VersionInfo.ProductVersion
    pbip = $pbipPath
    pbix = $pbixPath
    passes = @()
    unavailable = @(
        "touch input: no touch capability was established",
        "Power BI Service publication and dashboard pinning: not attempted",
        "Microsoft certification or Partner Center submission: not attempted"
    )
}

try {
    $process = Start-OwnedReport -Path $pbipPath
    $record.passes += [ordered]@{
        kind = "pbip"
        processId = $process.Id
        title = [NativeDesktopGuard]::Title($process.MainWindowHandle)
        pages = Invoke-PagePass -ProcessId $process.Id -Pass "pbip"
        uiaProbe = Get-OwnedUiaProbe -ProcessId $process.Id -ExpectedTitle $expectedTitle
    }
    Invoke-SaveAs -ProcessId $process.Id
    $record.pbixBeforeReopen = [ordered]@{
        bytes = (Get-Item $pbixPath).Length
        sha256 = (Get-FileHash $pbixPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    Close-OwnedReport -ProcessId $process.Id

    $process = Start-OwnedReport -Path $pbixPath
    $record.passes += [ordered]@{
        kind = "pbix-reopen"
        processId = $process.Id
        title = [NativeDesktopGuard]::Title($process.MainWindowHandle)
        pages = Invoke-PagePass -ProcessId $process.Id -Pass "pbix"
        uiaProbe = Get-OwnedUiaProbe -ProcessId $process.Id -ExpectedTitle $expectedTitle
    }
    Close-OwnedReport -ProcessId $process.Id
    $record.pbixAfterReopen = [ordered]@{
        bytes = (Get-Item $pbixPath).Length
        sha256 = (Get-FileHash $pbixPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $record.pbixStable = $record.pbixBeforeReopen.sha256 -eq $record.pbixAfterReopen.sha256
    if (-not $record.pbixStable) { throw "PBIX bytes changed across reopen without an intentional save" }
    $record.outcome = "completed"
} catch {
    $record.outcome = "blocked"
    $record.error = $_.Exception.Message
    $remaining = @(Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue)
    $record.remainingDesktopProcesses = @($remaining | ForEach-Object {
        [ordered]@{ id = $_.Id; title = $_.MainWindowTitle }
    })
    throw
} finally {
    $record.completedAt = (Get-Date).ToUniversalTime().ToString("o")
    $record | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $evidencePath "native-run.json")
}
