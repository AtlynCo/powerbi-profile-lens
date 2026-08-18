param(
    [string]$Pbip = "samples\AtlynProfileLensSample\AtlynProfileLensSample.pbip",
    [string]$Pbix = "dist\release\AtlynProfileLensSample-1.2.0.0.pbix",
    [string]$EvidenceDirectory = "dist\release\native-evidence"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "desktop-guard.ps1")
. (Join-Path $PSScriptRoot "snapshot-guard.ps1")

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
$sourceStateJson = & node (Join-Path $root "scripts\native-source-integrity.cjs")
if ($LASTEXITCODE -ne 0) {
    throw "Native automation source verification failed"
}
$sourceState = $sourceStateJson | ConvertFrom-Json
$sourceCommit = $sourceState.sourceCommit
$resourceParityJson = & node (Join-Path $root "scripts\sample-resource-parity.cjs")
if ($LASTEXITCODE -ne 0) {
    throw "PBIVIZ to sample resource parity verification failed"
}
$resourceParity = $resourceParityJson | ConvertFrom-Json
$snapshotJson = & node (Join-Path $root "scripts\native-snapshot.cjs")
if ($LASTEXITCODE -ne 0) {
    throw "Verified native snapshot creation failed"
}
$snapshot = $snapshotJson | ConvertFrom-Json
$snapshotRoot = Join-Path $root $snapshot.logicalPath.Replace("/", "\")
$snapshotPbipPath = Join-Path $snapshotRoot $snapshot.pbip
if ($snapshot.fixtureProjectTreeSha256 -ne $computedSampleIntegrity.projectTree.sha256) {
    throw "Native snapshot fixture differs from the pre-copy verified PBIP project"
}
$script:observations = @()
$script:observationSequence = 0

function Add-SealedObservation {
    param(
        [string]$Id,
        [string]$Scenario,
        [string]$ActionKind,
        [string]$LogicalName,
        [string]$ControlType,
        [AllowEmptyString()][string]$AutomationId,
        $Before,
        $After,
        $ExpectedPredicate
    )
    $script:observationSequence++
    $unsigned = [ordered]@{
        schemaVersion = 1
        id = $Id
        scenario = $Scenario
        sequence = $script:observationSequence
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        sourceCommit = $sourceCommit
        snapshotSha256 = $snapshot.manifest.sha256
        action = [ordered]@{
            kind = $ActionKind
            control = [ordered]@{
                logicalName = $LogicalName
                controlType = $ControlType
                automationId = $AutomationId
            }
        }
        before = $Before
        after = $After
        expectedPredicate = $ExpectedPredicate
    }
    $sealedJson = ($unsigned | ConvertTo-Json -Depth 8 -Compress) |
        & node (Join-Path $root "scripts\native-observations.cjs") --seal
    if ($LASTEXITCODE -ne 0) { throw "Observation sealing failed" }
    $script:observations += $sealedJson | ConvertFrom-Json
}
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
    if ($Path -eq $snapshotPbipPath) {
        $script:computedSampleIntegrity = Get-VerifiedSampleIntegrity
        $launchSourceJson = & node (Join-Path $root "scripts\native-source-integrity.cjs")
        if ($LASTEXITCODE -ne 0) {
            throw "Automation source changed at the launch boundary"
        }
        $launchSource = $launchSourceJson | ConvertFrom-Json
        if ($launchSource.sourceCommit -ne $sourceCommit -or
            $launchSource.automation.sha256 -ne $sourceState.automation.sha256) {
            throw "Automation source identity changed at the launch boundary"
        }
        $launchParityJson = & node (Join-Path $root "scripts\sample-resource-parity.cjs")
        if ($LASTEXITCODE -ne 0) {
            throw "PBIVIZ sample parity changed at the launch boundary"
        }
        if (($launchParityJson | ConvertFrom-Json | ConvertTo-Json -Depth 8 -Compress) -ne
            ($resourceParity | ConvertTo-Json -Depth 8 -Compress)) {
            throw "PBIVIZ sample parity identity changed at the launch boundary"
        }
        $launchSnapshotJson = & node (Join-Path $root "scripts\native-snapshot.cjs") `
            --verify $snapshot.token $snapshot.manifest.sha256
        if ($LASTEXITCODE -ne 0) {
            throw "Native snapshot changed at the launch boundary"
        }
        if (($launchSnapshotJson | ConvertFrom-Json).manifest.sha256 -ne
            $snapshot.manifest.sha256) {
            throw "Native snapshot identity changed at the launch boundary"
        }
        if (($launchSnapshotJson | ConvertFrom-Json).fixtureProjectTreeSha256 -ne
            $computedSampleIntegrity.projectTree.sha256) {
            throw "Native snapshot fixture changed at the launch boundary"
        }
    }
    $known = @($existing.Id)
    Start-Process $desktopExe -ArgumentList "`"$Path`""
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        $candidates = @(Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue |
            Where-Object { $known -notcontains $_.Id -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Where-Object { [NativeDesktopGuard]::Title($_.MainWindowHandle) -like $expectedTitle })
        if ($candidates.Count -gt 1) {
            throw "Multiple newly owned Desktop windows match the expected report"
        }
        if ($candidates.Count -eq 1) {
            $candidate = $candidates[0]
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
            -Name $page -ControlTypes TabItem -AutomationId "" -TimeoutSeconds 12
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
        -Name "File" -ControlTypes @("TabItem", "Button") -AutomationId "" -TimeoutSeconds 15
    if (-not $file) { throw "File command was not exposed by the owned Desktop window" }
    Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $file
    Start-Sleep -Seconds 3
    $saveAs = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
        -Name "Save as" -ControlTypes @("ListItem", "Button") -AutomationId "" -TimeoutSeconds 15
    if (-not $saveAs) { throw "Save as command was not exposed by the owned Desktop window" }
    Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $saveAs
    Start-Sleep -Seconds 3
    $browse = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
        -Name "Browse this device" -ControlTypes @("Button", "Hyperlink", "ListItem") `
        -AutomationId "" -TimeoutSeconds 6
    if ($browse) {
        Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $browse
        Start-Sleep -Seconds 3
    }
    $filename = Find-OwnedDialogControl -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -ControlType Edit -AutomationId "1001" -RequireValuePattern
    Set-OwnedDialogValue -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -Target $filename -Value $pbixPath
    $save = Find-OwnedDialogControl -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -Name "Save" -ControlType Button -AutomationId "1" -RequireInvokePattern
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

$snapshotGuard = Open-SnapshotReadLocks -SnapshotRoot $snapshotRoot
try {
$snapshotLockEvidence = $snapshotGuard.evidence
New-Item -ItemType Directory -Force -Path (Split-Path $pbixPath), $evidencePath | Out-Null
if (Test-Path $pbixPath) { Remove-Item $pbixPath -Force }

$record = [ordered]@{
    schemaVersion = 1
    sourceCommit = $sourceCommit
    automation = $sourceState.automation
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    desktop = (Get-Item $desktopExe).VersionInfo.ProductVersion
    pbip = ($pbipRelative -replace "\\", "/")
    pbix = ($pbixRelative -replace "\\", "/")
    snapshot = [ordered]@{
        token = $snapshot.token
        logicalPath = $snapshot.logicalPath
        manifest = $snapshot.manifest
        lock = $snapshotLockEvidence
    }
    sample = [ordered]@{
        projectTreeSha256 = $computedSampleIntegrity.projectTree.sha256
        reportDefinitionTreeSha256 = $computedSampleIntegrity.reportDefinitionTree.sha256
        modelDefinitionTreeSha256 = $computedSampleIntegrity.modelDefinitionTree.sha256
        generatorSha256 = $computedSampleIntegrity.generator.sha256
        pbipSha256 = $computedSampleIntegrity.pbip.sha256
        embeddedVisualResourceSha256 = $computedSampleIntegrity.embeddedVisualResource.sha256
        resourceParity = $resourceParity
    }
    observations = $script:observations
    passes = @()
    unavailable = @(
        "touch input: no touch capability was established",
        "Power BI Service publication and dashboard pinning: not attempted",
        "Microsoft certification or Partner Center submission: not attempted"
    )
}

try {
    $process = Start-OwnedReport -Path $snapshotPbipPath
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
    Add-SealedObservation -Id "pbix-offline-reopen" -Scenario "pbixOfflineReopen" `
        -ActionKind "reopen-verify" -LogicalName "owned-report" -ControlType "Window" `
        -AutomationId "" -Before @{ sha256 = $record.pbixBeforeReopen.sha256 } `
        -After @{ sha256 = $record.pbixAfterReopen.sha256 } `
        -ExpectedPredicate @{ kind = "unchanged" }
    $record.outcome = "native-run-completed"
    $record.observations = $script:observations
} catch {
    $record.outcome = "blocked"
    $record.error = $_.Exception.Message
    throw
} finally {
    $record.completedAt = (Get-Date).ToUniversalTime().ToString("o")
    $record.observations = $script:observations
    $finalSnapshotJson = & node (Join-Path $root "scripts\native-snapshot.cjs") `
        --verify $snapshot.token $snapshot.manifest.sha256
    if ($LASTEXITCODE -ne 0) {
        throw "Native snapshot changed before evidence persistence"
    }
    $preSanitizeSourceJson = & node (Join-Path $root "scripts\native-source-integrity.cjs")
    if ($LASTEXITCODE -ne 0) {
        throw "Automation source changed before evidence sanitization"
    }
    $preSanitizeSource = $preSanitizeSourceJson | ConvertFrom-Json
    if ($preSanitizeSource.sourceCommit -ne $sourceCommit -or
        $preSanitizeSource.automation.sha256 -ne $sourceState.automation.sha256) {
        throw "Automation source identity changed before evidence sanitization"
    }
    $sanitizedJson = ($record | ConvertTo-Json -Depth 12 -Compress) |
        & node (Join-Path $root "scripts\native-evidence-sanitize.cjs")
    if ($LASTEXITCODE -ne 0) {
        throw "Evidence sanitization failed; no evidence was written"
    }
    $outputPath = Join-Path $evidencePath "native-run.json"
    Set-Content -Path $outputPath -Value $sanitizedJson
    & node (Join-Path $root "scripts\native-evidence-sanitize.cjs") --check $outputPath
    if ($LASTEXITCODE -ne 0) {
        Remove-Item $outputPath -Force
        throw "Persisted evidence failed privacy verification"
    }
    $postSanitizeSourceJson = & node (Join-Path $root "scripts\native-source-integrity.cjs")
    if ($LASTEXITCODE -ne 0) {
        Remove-Item $outputPath -Force
        throw "Automation source changed after evidence sanitization"
    }
    $postSanitizeSource = $postSanitizeSourceJson | ConvertFrom-Json
    if ($postSanitizeSource.sourceCommit -ne $sourceCommit -or
        $postSanitizeSource.automation.sha256 -ne $sourceState.automation.sha256) {
        Remove-Item $outputPath -Force
        throw "Automation source identity changed after evidence sanitization"
    }
}
} finally {
    Close-SnapshotReadLocks -Guard $snapshotGuard
}
