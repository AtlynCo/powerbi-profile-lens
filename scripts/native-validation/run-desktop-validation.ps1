param(
    [string]$Pbip = "samples\AtlynProfileLensSample\AtlynProfileLensSample.pbip",
    [string]$Pbix,
    [string]$EvidenceDirectory = "dist\release\native-evidence",
    [Parameter(DontShow)][scriptblock]$SnapshotLockOpener = {
        param($Root, $ExpectedFileCount)
        Open-SnapshotReadLocks -SnapshotRoot $Root -ExpectedFileCount $ExpectedFileCount
    },
    [Parameter(DontShow)][scriptblock]$PostSnapshotFixtureValidator = {
        param($Snapshot, $ComputedSampleIntegrity)
        if ($Snapshot.fixtureProjectTreeSha256 -ne
            $ComputedSampleIntegrity.projectTree.sha256) {
            throw "Native snapshot fixture differs from the pre-copy verified PBIP project"
        }
    },
    [Parameter(DontShow)][scriptblock]$DesktopEvidenceInitializer = {
        param($DesktopExecutable)
        (Get-Item $DesktopExecutable).VersionInfo.ProductVersion
    }
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "desktop-guard.ps1")
. (Join-Path $PSScriptRoot "snapshot-guard.ps1")

$validationMutex = [System.Threading.Mutex]::new(
    $false,
    "Global\AtlynProfileLensNativeValidation"
)
$mutexOwned = $false
try {
    try {
        $mutexOwned = $validationMutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $mutexOwned = $true
    }
    if (-not $mutexOwned) {
        throw "Another native validation run owns the controlled-run boundary"
    }

$desktopExe = "C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$visualManifest = Get-Content (Join-Path $root "pbiviz.json") -Raw | ConvertFrom-Json
if (-not $Pbix) {
    $Pbix = "dist\release\AtlynProfileLensSample-$($visualManifest.visual.version).pbix"
}
$earlyFinalizableEvidence = Join-Path $root "dist\release\native-evidence\native-run.json"
if (Test-Path $earlyFinalizableEvidence) {
    Remove-Item $earlyFinalizableEvidence -Force
}
if (@(Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue).Count -gt 0) {
    throw "Desktop ownership blocker: Power BI Desktop is already running"
}
$pbipPath = (Resolve-Path (Join-Path $root $Pbip)).Path
$pbixPath = [System.IO.Path]::GetFullPath((Join-Path $root $Pbix))
$evidencePath = [System.IO.Path]::GetFullPath((Join-Path $root $EvidenceDirectory))
$expectedPbipRelative = "samples\AtlynProfileLensSample\AtlynProfileLensSample.pbip"
$expectedPbixRelative = "dist\release\AtlynProfileLensSample-$($visualManifest.visual.version).pbix"
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
$script:observations = @()
$script:observationSequence = 0
$script:ownedProcessJobs = @()
$runId = [Guid]::NewGuid().ToString("N")
$snapshotGuard = $null
$guardsRestored = $false
$cleanupCompleted = $false
$primaryFailure = $null
$secondaryFailure = $null
$cleanupFailure = $null
$pbixReadLock = $null
$releasePbixReadLock = $null
$ownedCleanupIncomplete = $false
$record = $null
$finalizableEvidencePath = Join-Path $evidencePath "native-run.json"

function Create-LaunchSnapshot {
    $snapshotScript = Join-Path $root "scripts\native-snapshot.cjs"
    $tokenJson = & node $snapshotScript --token
    if ($LASTEXITCODE -ne 0) {
        throw "Native snapshot token computation failed before creation"
    }
    $expectedToken = ($tokenJson | ConvertFrom-Json).token
    $snapshotJson = & node $snapshotScript
    if ($LASTEXITCODE -ne 0) {
        throw "Verified native snapshot creation failed"
    }
    try {
        $created = $snapshotJson | ConvertFrom-Json
        if ($created.token -ne $expectedToken -or -not $created.absolutePath -or
            -not $created.manifest) {
            throw "Native snapshot creator returned an invalid result"
        }
        return $created
    } catch {
        $primary = $_
        $rollbackToken = if ($created -and
            $created.token -match "^[0-9a-f]{64}$") {
            $created.token
        } else {
            $expectedToken
        }
        $cleanupJson = & node $snapshotScript --remove $rollbackToken
        if ($LASTEXITCODE -ne 0) {
            throw [System.AggregateException]::new(
                "Native snapshot result failed validation and atomic rollback failed",
                @($primary.Exception, [System.Exception]::new(
                    "Integrity-gated snapshot rollback failed"
                ))
            )
        }
        $cleanup = $cleanupJson | ConvertFrom-Json
        if (-not $cleanup.removed) {
            throw [System.AggregateException]::new(
                "Native snapshot result failed validation and no created snapshot was removed",
                @($primary.Exception, [System.Exception]::new(
                    "Atomic rollback did not remove a snapshot"
                ))
            )
        }
        throw $primary
    }
}

$snapshot = Create-LaunchSnapshot

try {
$record = [ordered]@{
    schemaVersion = 1
    runId = $runId
    sourceCommit = $sourceCommit
    automation = $sourceState.automation
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    desktop = $null
    pbip = ($pbipRelative -replace "\\", "/")
    pbix = ($pbixRelative -replace "\\", "/")
    snapshot = [ordered]@{
        token = $snapshot.token
        logicalPath = $snapshot.logicalPath
        manifest = $snapshot.manifest
        pathPreflight = $snapshot.pathPreflight
        lock = $null
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

New-Item -ItemType Directory -Force -Path $evidencePath | Out-Null
$snapshotRoot = $snapshot.absolutePath
$snapshotPbipPath = Join-Path $snapshotRoot $snapshot.pbip
& $PostSnapshotFixtureValidator $snapshot $computedSampleIntegrity
$record.desktop = & $DesktopEvidenceInitializer $desktopExe
if (-not $record.desktop) {
    throw "Desktop metadata and evidence initialization returned no version"
}

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
    "1 - Explore World Community Profiles",
    "2 - Demographic profile: Population by Age Band",
    "3 - Multi-period census and urban/rural series",
    "4 - Nongeographic grid and hex community matrices",
    "5 - Bound WGS84 community points",
    "6 - District boundary polygons (WKT)",
    "7 - Global demographics: World countries (110m)",
    "8 - Regional demographics: US states & territories",
    "9 - Local demographics: US counties & equivalents",
    "10 - Viewport lens navigation (World 50m probe)",
    "11 - Six demographic profile indicators",
    "12 - Demographic normalization modes",
    "13 - Boundary diagnostics: World 50m exact keys",
    "14 - Progressive authoring landing"
)

function Start-OwnedReport {
    param([string]$Path)
    $launchBasename = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    $launchExpectedTitle = "*$launchBasename*"
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
    $job = Start-OwnedProcessJob -Executable $desktopExe -Argument $Path -WorkingDirectory $root
    $script:ownedProcessJobs += $job
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        $candidates = @(Get-Process -Name PBIDesktop -ErrorAction SilentlyContinue |
            Where-Object { $known -notcontains $_.Id -and $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Where-Object { [NativeDesktopGuard]::Title($_.MainWindowHandle) -like $launchExpectedTitle })
        if ($candidates.Count -gt 1) {
            throw "Multiple newly owned Desktop windows match the expected report"
        }
        if ($candidates.Count -eq 1) {
            $candidate = $candidates[0]
            if (-not (Test-OwnedJobMembership -Process $candidate -Job $job)) {
                throw "Expected Desktop window is not a member of the owned process job"
            }
            $candidate | Add-Member -NotePropertyName OwnedJob -NotePropertyValue $job
            Assert-OwnedWindowBounds -ProcessId $candidate.Id `
                -ExpectedTitle $launchExpectedTitle | Out-Null
            $script:expectedTitle = $launchExpectedTitle
            return $candidate
        }
    }
    throw "No newly owned Desktop window reached expected title '$expectedTitle'"
}

function Invoke-PagePass {
    param([int]$ProcessId, $OwnedJob)
    $observations = @()
    foreach ($page in $pages) {
        $element = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
            -Name $page -ControlTypes TabItem -AutomationId "" -OwnedJob $OwnedJob `
            -TimeoutSeconds 12
        if (-not $element) {
            $observations += [ordered]@{ page = $page; outcome = "not-observed"; reason = "page UIA target not found" }
            continue
        }
        Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $element `
            -OwnedJob $OwnedJob
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
    param([int]$ProcessId, $OwnedJob)
    $file = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
        -Name "File" -ControlTypes TabItem -AutomationId "Ribbon-file" -OwnedJob $OwnedJob `
        -TimeoutSeconds 15
    if (-not $file) { throw "File command was not exposed by the owned Desktop window" }
    Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $file `
        -OwnedJob $OwnedJob
    Start-Sleep -Seconds 3
    $saveAs = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
        -Name "Save as" -ControlTypes @("TabItem", "ListItem", "Button") -AutomationId "" `
        -OwnedJob $OwnedJob -TimeoutSeconds 15
    if (-not $saveAs) { throw "Save as command was not exposed by the owned Desktop window" }
    Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $saveAs `
        -OwnedJob $OwnedJob
    Start-Sleep -Seconds 3
    $browse = Find-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle `
        -Name "Browse this device" -ControlTypes @("Button", "Hyperlink", "ListItem") `
        -AutomationId "" -OwnedJob $OwnedJob -TimeoutSeconds 6
    if ($browse) {
        Invoke-OwnedElement -ProcessId $ProcessId -ExpectedTitle $expectedTitle -Element $browse `
            -OwnedJob $OwnedJob
        Start-Sleep -Seconds 3
    }
    $filename = Find-OwnedDialogControl -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -ControlType Pane -AutomationId "1001" -RequireValuePattern
    Set-OwnedDialogValue -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -Target $filename -Value $pbixPath
    $save = Find-OwnedDialogControl -ProcessId $ProcessId -ExpectedDialogTitle "*Save As*" `
        -Name "Save" -ControlType Pane -AutomationId "1" -RequireInvokePattern
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
    param($Job)
    return Invoke-OwnedProcessCleanup -Job $Job
}

New-Item -ItemType Directory -Force -Path (Split-Path $pbixPath) | Out-Null
if (Test-Path $pbixPath) { Remove-Item $pbixPath -Force }
$snapshotGuard = & $SnapshotLockOpener $snapshotRoot $snapshot.manifest.files
if (-not $snapshotGuard -or -not $snapshotGuard.evidence) {
    throw "Snapshot lock acquisition returned no guard evidence"
}
$record.snapshot.lock = $snapshotGuard.evidence

try {
    $process = Start-OwnedReport -Path $snapshotPbipPath
    $record.passes += [ordered]@{
        kind = "pbip"
        report = $reportName
        pages = Invoke-PagePass -ProcessId $process.Id -OwnedJob $process.OwnedJob
    }
    Invoke-SaveAs -ProcessId $process.Id -OwnedJob $process.OwnedJob
    $record.pbixBeforeReopen = [ordered]@{
        bytes = (Get-Item $pbixPath).Length
        sha256 = (Get-FileHash $pbixPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $writerCleanup = Close-OwnedReport -Job $process.OwnedJob
    if (-not $writerCleanup.complete) {
        throw "The owned Desktop writer process did not exit"
    }
    $releasePbixReadLock = Open-PbixReadLock -Path $pbixPath
    $pbixSnapshotJson = & node (Join-Path $root "scripts\native-pbix-snapshot.cjs") $pbixPath
    if ($LASTEXITCODE -ne 0) { throw "PBIX snapshot creation failed" }
    $pbixSnapshot = $pbixSnapshotJson | ConvertFrom-Json
    $pbixSnapshotPath = Join-Path $root $pbixSnapshot.logicalPath.Replace("/", "\")
    $pbixReadLock = Open-PbixReadLock -Path $pbixSnapshotPath
    $record.pbixSnapshot = $pbixSnapshot
    $record.pbixTitleGuard = [ordered]@{
        basename = [System.IO.Path]::GetFileNameWithoutExtension($pbixSnapshot.basename)
        snapshotSha256 = $pbixSnapshot.snapshot.sha256
        runId = $runId
    }
    $record.releasePbixLock = [ordered]@{
        logicalPath = ($pbixRelative -replace "\\", "/")
        sha256 = $pbixSnapshot.original.sha256
        bytes = $pbixSnapshot.original.bytes
        heldThroughEvidencePublication = $true
    }

    $process = Start-OwnedReport -Path $pbixSnapshotPath
    $record.passes += [ordered]@{
        kind = "pbix-reopen"
        report = $reportName
        pages = Invoke-PagePass -ProcessId $process.Id -OwnedJob $process.OwnedJob
    }
    $readerCleanup = Close-OwnedReport -Job $process.OwnedJob
    if (-not $readerCleanup.complete) {
        throw "The owned Desktop reader process did not exit"
    }
    $verifiedPbixSnapshotJson = & node (Join-Path $root "scripts\native-pbix-snapshot.cjs") `
        --verify $pbixSnapshot.token
    if ($LASTEXITCODE -ne 0) { throw "PBIX snapshot changed during reopen" }
    $verifiedPbixSnapshot = $verifiedPbixSnapshotJson | ConvertFrom-Json
    $record.pbixAfterReopen = [ordered]@{
        bytes = (Get-Item $pbixPath).Length
        sha256 = (Get-FileHash $pbixPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $record.pbixStable = $record.pbixBeforeReopen.sha256 -eq $record.pbixAfterReopen.sha256
    if (-not $record.pbixStable) { throw "PBIX bytes changed across reopen without an intentional save" }
    Add-SealedObservation -Id "pbix-offline-reopen" -Scenario "pbixOfflineReopen" `
        -ActionKind "reopen-verify" -LogicalName "owned-report" -ControlType "Window" `
        -AutomationId "" -Before @{ sha256 = $pbixSnapshot.snapshot.sha256 } `
        -After @{ sha256 = $verifiedPbixSnapshot.snapshot.sha256 } `
        -ExpectedPredicate @{ kind = "unchanged" }
    $record.outcome = "native-run-completed"
    $record.observations = $script:observations
} catch {
    $record.outcome = "blocked"
    $record.error = $_.Exception.Message
    $primaryFailure = $_
} finally {
    $cleanupSummaries = @()
    foreach ($ownedJob in $script:ownedProcessJobs) {
        try {
            $cleanup = Invoke-OwnedProcessCleanup -Job $ownedJob
        } catch {
            $cleanup = [ordered]@{
                graceful = $false
                forced = $false
                complete = $false
                activeProcessCount = $null
                errors = @("cleanup threw")
            }
        }
        $cleanupSummaries += [ordered]@{
            graceful = $cleanup.graceful
            forced = $cleanup.forced
            complete = $cleanup.complete
            activeProcessCount = $cleanup.activeProcessCount
            errorCount = $cleanup.errors.Count
        }
        if (-not $cleanup.complete) { $ownedCleanupIncomplete = $true }
    }
    $cleanupCompleted = $true
    $record.cleanup = [ordered]@{
        ownedProcessCount = $script:ownedProcessJobs.Count
        outcomes = $cleanupSummaries
        allExited = -not $ownedCleanupIncomplete
    }
    if ($ownedCleanupIncomplete) {
        $cleanupFailure = [System.Exception]::new("Owned Desktop cleanup is incomplete")
    }
    if ($pbixReadLock -and -not $ownedCleanupIncomplete) {
        $pbixReadLock.Dispose()
        $pbixReadLock = $null
    }
    $record.completedAt = (Get-Date).ToUniversalTime().ToString("o")
    $record.observations = $script:observations
    $finalSnapshotJson = & node (Join-Path $root "scripts\native-snapshot.cjs") `
        --verify $snapshot.token $snapshot.manifest.sha256
    if ($LASTEXITCODE -ne 0) {
        $secondaryFailure = [System.Exception]::new(
            "Native snapshot changed before evidence persistence"
        )
    }
}
} catch {
    if (-not $primaryFailure) {
        $primaryFailure = $_
        $record.outcome = "blocked"
        $record.error = $_.Exception.Message
    }
} finally {
    if (-not $cleanupCompleted) {
        $cleanupSummaries = @()
        foreach ($ownedJob in $script:ownedProcessJobs) {
            try {
                $cleanup = Invoke-OwnedProcessCleanup -Job $ownedJob
            } catch {
                $cleanup = [ordered]@{
                    graceful = $false
                    forced = $false
                    complete = $false
                    activeProcessCount = $null
                    errors = @("cleanup threw")
                }
                if (-not $cleanupFailure) { $cleanupFailure = $_ }
            }
            $cleanupSummaries += [ordered]@{
                graceful = $cleanup.graceful
                forced = $cleanup.forced
                complete = $cleanup.complete
                activeProcessCount = $cleanup.activeProcessCount
                errorCount = $cleanup.errors.Count
            }
            if (-not $cleanup.complete) {
                $ownedCleanupIncomplete = $true
            }
        }
        $cleanupCompleted = $true
        $record.cleanup = [ordered]@{
            ownedProcessCount = $script:ownedProcessJobs.Count
            outcomes = $cleanupSummaries
            allExited = -not $ownedCleanupIncomplete
        }
    }
    if ($pbixReadLock -and -not $ownedCleanupIncomplete) {
        $pbixReadLock.Dispose()
    }
    if (-not $ownedCleanupIncomplete) {
        try {
            if ($snapshotGuard) {
                Close-SnapshotReadLocks -Guard $snapshotGuard
            }
            $guardsRestored = $true
        } catch {
            if (-not $cleanupFailure) { $cleanupFailure = $_ }
        }
    } elseif (-not $cleanupFailure) {
        $cleanupFailure = [System.Exception]::new(
            "Snapshot protections retained because an owned Desktop process remains"
        )
    }
    if (-not $record.completedAt) {
        $record.completedAt = (Get-Date).ToUniversalTime().ToString("o")
        $record.observations = $script:observations
    }
}

$blockedSnapshotCleanup = $null
$requiresBlockedSnapshotCleanup = $record.outcome -eq "blocked" -or
    $primaryFailure -or $secondaryFailure -or $cleanupFailure
if ($requiresBlockedSnapshotCleanup) {
    $blockedSnapshotCleanup = Invoke-BlockedSnapshotCleanup `
        -AllOwnedProcessesExited $record.cleanup.allExited `
        -GuardsRestored $guardsRestored `
        -CleanupAction {
            $cleanupJson = & node (Join-Path $root "scripts\native-snapshot.cjs") `
                --remove $snapshot.token
            if ($LASTEXITCODE -ne 0) {
                throw "Integrity-gated native snapshot cleanup failed"
            }
            return $cleanupJson | ConvertFrom-Json
        }
    $record.snapshotCleanup = $blockedSnapshotCleanup
    if ($blockedSnapshotCleanup.errorCount -gt 0 -and -not $cleanupFailure) {
        $cleanupFailure = [System.Exception]::new(
            "Integrity-gated native snapshot cleanup failed"
        )
    }
}

$failure = Select-RunFailure -PrimaryFailure $primaryFailure `
    -CleanupFailure (Select-RunFailure -PrimaryFailure $cleanupFailure -CleanupFailure $secondaryFailure)
$record.guardsRestored = $guardsRestored
if ($failure -or -not $guardsRestored -or -not $record.cleanup.allExited) {
    $record.outcome = "blocked"
}
try {
    $preSanitizeSourceJson = & node (Join-Path $root "scripts\native-source-integrity.cjs")
    if ($LASTEXITCODE -ne 0) { throw "Automation source changed before evidence sanitization" }
    $preSanitizeSource = $preSanitizeSourceJson | ConvertFrom-Json
    if ($preSanitizeSource.sourceCommit -ne $sourceCommit -or
        $preSanitizeSource.automation.sha256 -ne $sourceState.automation.sha256) {
        throw "Automation source identity changed before evidence sanitization"
    }
    $sanitizedJson = ($record | ConvertTo-Json -Depth 12 -Compress) |
        & node (Join-Path $root "scripts\native-evidence-sanitize.cjs")
    if ($LASTEXITCODE -ne 0) { throw "Evidence sanitization failed" }
    $outputPath = if ($failure -or -not $guardsRestored -or -not $record.cleanup.allExited) {
        Join-Path $evidencePath "native-failure.json"
    } else {
        $finalizableEvidencePath
    }
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
} catch {
    if (-not $failure) { $failure = $_ }
}
if ($failure) { throw $failure }
} finally {
    if ($releasePbixReadLock -and -not $ownedCleanupIncomplete) {
        $releasePbixReadLock.Dispose()
    }
    if ($mutexOwned) { $validationMutex.ReleaseMutex() }
    $validationMutex.Dispose()
}
