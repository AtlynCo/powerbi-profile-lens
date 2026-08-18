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
$expectedPbipRelative = "samples\AtlynProfileLensSample\AtlynProfileLensSample.pbip"
$expectedPbixRelative = "dist\release\AtlynProfileLensSample-1.2.0.0.pbix"
$pbipRelative = [System.IO.Path]::GetRelativePath($root, $pbipPath)
$pbixRelative = [System.IO.Path]::GetRelativePath($root, $pbixPath)
$evidenceRelative = [System.IO.Path]::GetRelativePath($root, $evidencePath)
if ($pbipRelative -ne $expectedPbipRelative -or $pbixRelative -ne $expectedPbixRelative -or
    $evidenceRelative -ne "dist\release\native-evidence" -or
    [System.IO.Path]::IsPathRooted($pbipRelative) -or
    [System.IO.Path]::IsPathRooted($pbixRelative) -or
    [System.IO.Path]::IsPathRooted($evidenceRelative) -or
    $pbipRelative.StartsWith("..") -or $pbixRelative.StartsWith("..") -or
    $evidenceRelative.StartsWith("..")) {
    throw "Native validation accepts only the exact repository PBIP, PBIX, and evidence paths"
}
$reportName = [System.IO.Path]::GetFileNameWithoutExtension($pbipPath)
$expectedTitle = "*$reportName*"

function Get-VerifiedSampleIntegrity {
    $recorded = Get-Content (
        Join-Path $root "samples\AtlynProfileLensSample\sample-integrity.json"
    ) -Raw | ConvertFrom-Json
    $computedJson = & node (Join-Path $root "scripts\sample-integrity.cjs")
    if ($LASTEXITCODE -ne 0) {
        throw "Sample integrity computation failed"
    }
    $computed = $computedJson | ConvertFrom-Json
    if (($recorded | ConvertTo-Json -Depth 8 -Compress) -ne
        ($computed | ConvertTo-Json -Depth 8 -Compress)) {
        throw "The exact PBIP project differs from its deterministic integrity manifest"
    }
    return $computed
}
$computedSampleIntegrity = Get-VerifiedSampleIntegrity
$boundPaths = @(
    "package.json", "package-lock.json", "pbiviz.json", "capabilities.json",
    "assets/icon.png", "src", "style", "stringResources",
    "scripts/build-sample-report.cjs", "scripts/sample-integrity.cjs",
    "samples/AtlynProfileLensSample"
)
$dirty = @(& git -C $root status --porcelain --untracked-files=all -- @boundPaths)
if ($LASTEXITCODE -ne 0) {
    throw "Git cleanliness verification failed"
}
if ($dirty.Count -gt 0) {
    throw "Native validation requires clean tracked and untracked package and fixture paths"
}
$sourceCommit = (& git -C $root rev-parse HEAD)
if ($LASTEXITCODE -ne 0 -or $sourceCommit.Count -ne 1 -or
    $sourceCommit.Trim() -notmatch "^[0-9a-f]{40}$") {
    throw "Git source commit verification failed"
}
$sourceCommit = $sourceCommit.Trim()
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
        throw "Desktop ownership blocker: an existing Power BI Desktop process is present"
    }
    if ($Path -eq $pbipPath) {
        $script:computedSampleIntegrity = Get-VerifiedSampleIntegrity
        $launchDirty = @(
            & git -C $root status --porcelain --untracked-files=all -- @boundPaths
        )
        if ($LASTEXITCODE -ne 0 -or $launchDirty.Count -gt 0) {
            throw "Package or fixture paths changed at the launch boundary"
        }
        $launchCommit = (& git -C $root rev-parse HEAD)
        if ($LASTEXITCODE -ne 0 -or $launchCommit.Count -ne 1 -or
            $launchCommit.Trim() -ne $sourceCommit) {
            throw "Source commit changed at the launch boundary"
        }
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
    param([int]$ProcessId)
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
        $observations += [ordered]@{
            page = $page
            outcome = "page-control-invoked-render-unproven"
            control = Get-AllowlistedControlProbe -LogicalName "report-page-tab" -Element $element
        }
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
    $filename = Find-OwnedDialogControl -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -ControlType Edit -AutomationId "1001" -RequireValuePattern
    Set-OwnedDialogValue -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -Target $filename -Value $pbixPath
    $save = Find-OwnedDialogControl -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -Name "Save" -ControlType Button -RequireInvokePattern
    Invoke-OwnedDialogControl -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" -Target $save
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
    throw "Desktop did not produce a stable PBIX at the configured release path"
}

function Close-OwnedReport {
    param([int]$ProcessId)
    $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle $expectedTitle
    $process.CloseMainWindow() | Out-Null
    if (-not $process.WaitForExit(30000)) {
        Stop-Process -Id $ProcessId
        (Get-Process -Id $ProcessId).WaitForExit(10000)
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path $pbixPath), $evidencePath | Out-Null
if (Test-Path $pbixPath) { Remove-Item $pbixPath -Force }

$record = [ordered]@{
    schemaVersion = 1
    sourceCommit = $sourceCommit
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    desktop = (Get-Item $desktopExe).VersionInfo.ProductVersion
    pbip = ($pbipRelative -replace "\\", "/")
    pbix = ($pbixRelative -replace "\\", "/")
    sample = [ordered]@{
        projectTreeSha256 = $computedSampleIntegrity.projectTree.sha256
        reportDefinitionTreeSha256 = $computedSampleIntegrity.reportDefinitionTree.sha256
        modelDefinitionTreeSha256 = $computedSampleIntegrity.modelDefinitionTree.sha256
        generatorSha256 = $computedSampleIntegrity.generator.sha256
        pbipSha256 = $computedSampleIntegrity.pbip.sha256
        embeddedVisualResourceSha256 = $computedSampleIntegrity.embeddedVisualResource.sha256
    }
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
        report = $reportName
        pages = Invoke-PagePass -ProcessId $process.Id
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
        report = $reportName
        pages = Invoke-PagePass -ProcessId $process.Id
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
    $record.remainingOwnedDesktopProcessCount = @(
        Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue
    ).Count
    throw
} finally {
    $record.completedAt = (Get-Date).ToUniversalTime().ToString("o")
    $record | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $evidencePath "native-run.json")
}
