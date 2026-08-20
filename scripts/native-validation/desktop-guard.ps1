$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeDesktopGuard {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint first, uint second, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }

    public static string Title(IntPtr handle) {
        var text = new StringBuilder(512);
        GetWindowText(handle, text, text.Capacity);
        return text.ToString();
    }

    public static bool ForceForeground(IntPtr handle) {
        var foreground = GetForegroundWindow();
        if (foreground == handle) return true;
        uint ignored;
        var foregroundThread = GetWindowThreadProcessId(foreground, out ignored);
        var currentThread = GetCurrentThreadId();
        AttachThreadInput(currentThread, foregroundThread, true);
        ShowWindow(handle, 3);
        BringWindowToTop(handle);
        var result = SetForegroundWindow(handle);
        AttachThreadInput(currentThread, foregroundThread, false);
        return result;
    }
}
'@ -ErrorAction SilentlyContinue

Add-Type @'
using System;
using System.Diagnostics;
using System.Text;
using System.Runtime.InteropServices;
public static class OwnedProcessJob {
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const int JobObjectExtendedLimitInformation = 9;
    const int JobObjectBasicAccountingInformation = 1;
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute;
        public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct BASIC_LIMIT {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct EXTENDED_LIMIT {
        public BASIC_LIMIT BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct BASIC_ACCOUNTING {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    public sealed class Launch {
        public IntPtr Job;
        public int ProcessId;
        public long StartTimeUtcTicks;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateProcess(string app, StringBuilder command, IntPtr pa, IntPtr ta,
        bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info,
        uint length, out uint returned);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit,
        out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr handle);

    public static Launch Start(string executable, string argument, string cwd) {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new InvalidOperationException("CreateJobObject failed");
        var limits = new EXTENDED_LIMIT();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf<EXTENDED_LIMIT>();
        IntPtr limitPtr = Marshal.AllocHGlobal(size);
        try {
            Marshal.StructureToPtr(limits, limitPtr, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, limitPtr, (uint)size))
                throw new InvalidOperationException("SetInformationJobObject failed");
        } finally { Marshal.FreeHGlobal(limitPtr); }
        var si = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFO>() };
        PROCESS_INFORMATION pi;
        var command = new StringBuilder("\"" + executable + "\" \"" + argument + "\"");
        if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false,
            CREATE_SUSPENDED, IntPtr.Zero, cwd, ref si, out pi)) {
            CloseHandle(job); throw new InvalidOperationException("CreateProcess failed");
        }
        try {
            long creation, exit, kernel, user;
            if (!GetProcessTimes(pi.hProcess, out creation, out exit, out kernel, out user)) {
                TerminateProcess(pi.hProcess, 1);
                throw new InvalidOperationException("GetProcessTimes failed");
            }
            if (!AssignProcessToJobObject(job, pi.hProcess)) {
                TerminateProcess(pi.hProcess, 1);
                throw new InvalidOperationException("AssignProcessToJobObject failed");
            }
            if (ResumeThread(pi.hThread) == 0xffffffff) {
                TerminateJobObject(job, 1);
                throw new InvalidOperationException("ResumeThread failed");
            }
            return new Launch {
                Job = job,
                ProcessId = pi.dwProcessId,
                StartTimeUtcTicks = DateTime.FromFileTimeUtc(creation).Ticks
            };
        } catch {
            CloseHandle(job); throw;
        } finally {
            CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
        }
    }
    public static uint ActiveProcesses(IntPtr job) {
        int size = Marshal.SizeOf<BASIC_ACCOUNTING>();
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try {
            uint returned;
            if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, ptr,
                (uint)size, out returned)) return uint.MaxValue;
            return Marshal.PtrToStructure<BASIC_ACCOUNTING>(ptr).ActiveProcesses;
        } finally { Marshal.FreeHGlobal(ptr); }
    }
}
'@ -ErrorAction SilentlyContinue

function Get-OwnedDesktop {
    param(
        [Parameter(Mandatory)][int]$ProcessId,
        [Parameter(Mandatory)][string]$ExpectedTitle
    )
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    if ($process.Path -ne "C:\Program Files\Microsoft Power BI Desktop\bin\PBIDesktop.exe") {
        throw "Owned process executable changed: $($process.Path)"
    }
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) {
        throw "Owned process has no main window"
    }
    $title = [NativeDesktopGuard]::Title($process.MainWindowHandle)
    if ($title -notlike $ExpectedTitle) {
        throw "Owned window title '$title' does not match '$ExpectedTitle'"
    }
    return $process
}

function Assert-OwnedForeground {
    param(
        [Parameter(Mandatory)][int]$ProcessId,
        [Parameter(Mandatory)][string]$ExpectedTitle,
        [int]$Attempts = 8
    )
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
        [NativeDesktopGuard]::ForceForeground($process.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 600
        $foreground = [NativeDesktopGuard]::GetForegroundWindow()
        if ($foreground -eq $process.MainWindowHandle -and
            [NativeDesktopGuard]::Title($foreground) -like $ExpectedTitle) {
            return $process
        }

    }
    throw "Refusing input: the owned '$ExpectedTitle' window could not be proven foreground"
}

function Assert-OwnedWindowBounds {
    param(
        [Parameter(Mandatory)][int]$ProcessId,
        [Parameter(Mandatory)][string]$ExpectedTitle
    )
    $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
    $window = New-Object NativeDesktopGuard+Rect
    if (-not [NativeDesktopGuard]::GetWindowRect($process.MainWindowHandle, [ref]$window) -or
        $window.Right -le $window.Left -or $window.Bottom -le $window.Top) {
        throw "Owned Desktop window has no safe visible rectangle"
    }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    if (-not $root -or $root.Current.ProcessId -ne $ProcessId) {
        throw "Owned Desktop UI Automation root does not match the expected process"
    }
    $rootRectangle = $root.Current.BoundingRectangle
    if ($rootRectangle.Width -le 0 -or $rootRectangle.Height -le 0 -or
        $rootRectangle.X -lt $window.Left -or $rootRectangle.Y -lt $window.Top -or
        ($rootRectangle.X + $rootRectangle.Width) -gt $window.Right -or
        ($rootRectangle.Y + $rootRectangle.Height) -gt $window.Bottom) {
        throw "Owned Desktop UI Automation root is not bounded by its native window"
    }
    return [ordered]@{ process = $process; root = $root; rectangle = $window }
}

function Assert-OwnedDialogForeground {
    param([int]$ProcessId, [string]$ExpectedDialogTitle, [int]$Attempts = 8)
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
        $foreground = [NativeDesktopGuard]::GetForegroundWindow()
        [uint32]$foregroundProcessId = 0
        [NativeDesktopGuard]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcessId) | Out-Null
        $title = [NativeDesktopGuard]::Title($foreground)
        if ($foregroundProcessId -eq $ProcessId -and $title -like $ExpectedDialogTitle) {
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Refusing input: foreground dialog is not '$ExpectedDialogTitle' owned by PID $ProcessId"
}

function Get-OwnedDialog {
            param([int]$ProcessId, [string]$ExpectedDialogTitle, [int]$TimeoutSeconds = 10)
            $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
            while ((Get-Date) -lt $deadline) {
                Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
                $titleCondition = New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::NameProperty,
                    ($ExpectedDialogTitle -replace "^\*|\*$", "")
                )
                $processCondition = New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
                    $ProcessId
                )
                $typeCondition = New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Window
                )
                $condition = New-Object System.Windows.Automation.AndCondition(
                    $titleCondition,
                    $processCondition,
                    $typeCondition
                )
                $dialogs = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll(
                    [System.Windows.Automation.TreeScope]::Children,
                    $condition
                ))
                $dialog = Select-UniqueCandidate -Candidates $dialogs -LogicalName "Save As dialog"
                if ($dialog) { return $dialog }
                $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle "*AtlynProfileLensSample*"
                $root = [System.Windows.Automation.AutomationElement]::FromHandle(
                    $process.MainWindowHandle
                )
                $hostCondition = New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
                    "FileNameControlHost"
                )
                $hosts = @($root.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    $hostCondition
                ))
                if ($hosts.Count -eq 1 -and $hosts[0].Current.ProcessId -eq $ProcessId) {
                    return $root
                }
                Start-Sleep -Milliseconds 400
            }
            throw "The verified owned Save As dialog was not exposed through UI Automation"
}

function Assert-ControlInsideDialog {
            param([int]$ProcessId, [string]$ExpectedDialogTitle, $Dialog, $Control)
            Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
            $isTitledDialog = $Dialog.Current.Name -like $ExpectedDialogTitle -and
                $Dialog.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window
            $hostCondition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
                "FileNameControlHost"
            )
            $isEmbeddedDialog = $Dialog.Current.NativeWindowHandle -ne 0 -and
                @($Dialog.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    $hostCondition
                )).Count -eq 1
            if ($Dialog.Current.ProcessId -ne $ProcessId -or
                (-not $isTitledDialog -and -not $isEmbeddedDialog)) {
                throw "Refusing control action: the owned dialog identity changed"
            }
            if ($Control.Current.ProcessId -ne $ProcessId) {
                throw "Refusing control action: the target process changed"
            }
            $dialogRectangle = $Dialog.Current.BoundingRectangle
            $controlRectangle = $Control.Current.BoundingRectangle
            if ($controlRectangle.Width -le 0 -or $controlRectangle.Height -le 0 -or
                $controlRectangle.X -lt $dialogRectangle.X -or
                $controlRectangle.Y -lt $dialogRectangle.Y -or
                ($controlRectangle.X + $controlRectangle.Width) -gt
                    ($dialogRectangle.X + $dialogRectangle.Width) -or
                ($controlRectangle.Y + $controlRectangle.Height) -gt
                    ($dialogRectangle.Y + $dialogRectangle.Height)) {
                throw "Refusing control action: the target is not visibly bounded inside the owned dialog"
            }
}

function Find-OwnedDialogControl {
            param(
                [int]$ProcessId,
                [string]$ExpectedDialogTitle,
                [string]$Name,
                [string]$ControlType,
                [string]$AutomationId,
                [switch]$RequireValuePattern,
                [switch]$RequireInvokePattern
            )
            $dialog = Get-OwnedDialog -ProcessId $ProcessId -ExpectedDialogTitle $ExpectedDialogTitle
            $conditions = @(
                (New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::$ControlType
                ))
            )
            if ($Name) {
                $conditions += New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::NameProperty,
                    $Name
                )
            }
            if ($AutomationId) {
                $conditions += New-Object System.Windows.Automation.PropertyCondition(
                    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
                    $AutomationId
                )
            }
            $condition = if ($conditions.Count -eq 1) {
                $conditions[0]
            } else {
                New-Object System.Windows.Automation.AndCondition($conditions)
            }
            $controls = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            $matches = @()
            foreach ($control in $controls) {
                try {
                    Assert-ControlInsideDialog -ProcessId $ProcessId -ExpectedDialogTitle $ExpectedDialogTitle `
                        -Dialog $dialog -Control $control
                    if ($RequireValuePattern) {
                        $control.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) | Out-Null
                    }
                    if ($RequireInvokePattern) {
                        $control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) | Out-Null
                    }
                    $matches += $control
                } catch {}
            }
            if ($matches.Count -eq 1) {
                return [ordered]@{ dialog = $dialog; control = $matches[0] }
            }
            if ($matches.Count -gt 1) {
                throw "The owned Save As dialog exposes multiple matching $ControlType controls"
            }
            throw "The owned Save As dialog exposes no safe bound $ControlType control for '$Name'"
}

function Set-OwnedDialogValue {
            param([int]$ProcessId, [string]$ExpectedDialogTitle, $Target, [string]$Value)
            Assert-ControlInsideDialog -ProcessId $ProcessId -ExpectedDialogTitle $ExpectedDialogTitle `
                -Dialog $Target.dialog -Control $Target.control
            $pattern = $Target.control.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $pattern.SetValue($Value)
}

function Invoke-OwnedDialogControl {
            param([int]$ProcessId, [string]$ExpectedDialogTitle, $Target)
            Assert-ControlInsideDialog -ProcessId $ProcessId -ExpectedDialogTitle $ExpectedDialogTitle `
                -Dialog $Target.dialog -Control $Target.control
            $pattern = $Target.control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $pattern.Invoke()
}

function Get-OwnedRoot {
    param([int]$ProcessId, [string]$ExpectedTitle)
    $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
    return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
}

function Select-UniqueCandidate {
    param([array]$Candidates, [string]$LogicalName)
    if ($Candidates.Count -eq 0) { return $null }
    if ($Candidates.Count -ne 1) {
        throw "Ambiguous owned UIA target for '$LogicalName'"
    }
    return $Candidates[0]
}

function Select-EquivalentOwnedCandidate {
    param([array]$Candidates, [string]$LogicalName)
    if ($Candidates.Count -eq 0) { return $null }
    $identities = @($Candidates | ForEach-Object {
        $rectangle = $_.Current.BoundingRectangle
        "$($_.Current.ProcessId)|$($_.Current.Name)|$($_.Current.AutomationId)|" +
            "$($_.Current.ControlType.ProgrammaticName)|$($rectangle.X)|$($rectangle.Y)|" +
            "$($rectangle.Width)|$($rectangle.Height)"
    } | Select-Object -Unique)
    if ($identities.Count -ne 1) {
        throw "Ambiguous owned UIA target for '$LogicalName'"
    }
    return $Candidates[0]
}

function Find-OwnedElement {
    param(
        [int]$ProcessId,
        [string]$ExpectedTitle,
        [string]$Name,
        [string[]]$ControlTypes,
        [AllowEmptyString()][string]$AutomationId,
        $OwnedJob,
        [int]$TimeoutSeconds = 10
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $root = Get-OwnedRoot -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $Name
        )
        $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
        $window = New-Object NativeDesktopGuard+Rect
        [NativeDesktopGuard]::GetWindowRect($process.MainWindowHandle, [ref]$window) | Out-Null
        $matches = @()
        foreach ($element in $root.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            $condition
        )) {
            $type = $element.Current.ControlType.ProgrammaticName -replace "^ControlType\.", ""
            $rectangle = $element.Current.BoundingRectangle
            $elementProcess = Get-Process -Id $element.Current.ProcessId -ErrorAction SilentlyContinue
            $owned = $elementProcess -and (
                $element.Current.ProcessId -eq $ProcessId -or
                ($OwnedJob -and (Test-OwnedJobMembership -Process $elementProcess -Job $OwnedJob))
            )
            if (-not $owned -or $ControlTypes -notcontains $type -or
                $element.Current.AutomationId -ne $AutomationId -or
                $rectangle.Width -le 0 -or $rectangle.Height -le 0 -or
                $rectangle.X -lt $window.Left -or $rectangle.Y -lt $window.Top -or
                ($rectangle.X + $rectangle.Width) -gt $window.Right -or
                ($rectangle.Y + $rectangle.Height) -gt $window.Bottom) {
                continue
            }
            $matches += $element
        }
        $selected = Select-EquivalentOwnedCandidate -Candidates $matches -LogicalName $Name
        if ($selected) { return $selected }
        Start-Sleep -Milliseconds 400
    }
    return $null
}

function Invoke-OwnedElement {
    param([int]$ProcessId, [string]$ExpectedTitle, $Element, $OwnedJob)
    $owned = Assert-OwnedWindowBounds -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
    $rectangle = $Element.Current.BoundingRectangle
    $elementProcess = Get-Process -Id $Element.Current.ProcessId -ErrorAction Stop
    if ($Element.Current.ProcessId -ne $ProcessId -and
        (-not $OwnedJob -or
            -not (Test-OwnedJobMembership -Process $elementProcess -Job $OwnedJob))) {
        throw "Refusing input: UIA target process identity changed"
    }
    $window = $owned.rectangle
    if ($rectangle.Width -le 0 -or $rectangle.Height -le 0 -or
        $rectangle.X -lt $window.Left -or $rectangle.Y -lt $window.Top -or
        ($rectangle.X + $rectangle.Width) -gt $window.Right -or
        ($rectangle.Y + $rectangle.Height) -gt $window.Bottom) {
        throw "Refusing input: UIA target is not visibly bounded inside the owned window"
    }
    foreach ($pattern in @(
        [System.Windows.Automation.SelectionItemPattern]::Pattern,
        [System.Windows.Automation.InvokePattern]::Pattern
    )) {
        try {
            $Element.GetCurrentPattern($pattern).Invoke()
            return
        } catch {
            try {
                $Element.GetCurrentPattern($pattern).Select()
                return
            } catch {}
        }
    }
    throw "UIA target '$($Element.Current.Name)' has no safe invokable pattern"
}

function Get-AllowlistedControlProbe {
    param([string]$LogicalName, $Element)
    return [ordered]@{
        logicalName = $LogicalName
        controlType = $Element.Current.ControlType.ProgrammaticName -replace "^ControlType\.", ""
        enabled = $Element.Current.IsEnabled
        offscreen = $Element.Current.IsOffscreen
    }
}

function Start-OwnedProcessJob {
    param([string]$Executable, [string]$Argument, [string]$WorkingDirectory)
    $launch = [OwnedProcessJob]::Start($Executable, $Argument, $WorkingDirectory)
    return [ordered]@{
        handle = $launch.Job
        rootProcessId = $launch.ProcessId
        rootStartTimeUtcTicks = $launch.StartTimeUtcTicks
        closed = $false
        cleanupResult = $null
    }
}

function Test-OwnedJobMembership {
    param([System.Diagnostics.Process]$Process, $Job)
    [bool]$belongs = $false
    if (-not [OwnedProcessJob]::IsProcessInJob($Process.Handle, $Job.handle, [ref]$belongs)) {
        throw "Could not verify owned job membership"
    }
    return $belongs
}

function Invoke-OwnedProcessCleanup {
    param(
        $Job,
        [scriptblock]$GracefulCloser = {
            param($OwnedJob)
            $root = Get-Process -Id $OwnedJob.rootProcessId -ErrorAction SilentlyContinue
            if ($root -and
                $root.StartTime.ToUniversalTime().Ticks -eq $OwnedJob.rootStartTimeUtcTicks -and
                $root.CloseMainWindow()) {
                return $root.WaitForExit(15000)
            }
            return $false
        }
    )
    $result = [ordered]@{
        graceful = $false
        forced = $false
        complete = $false
        activeProcessCount = $null
        errors = @()
    }
    if ($Job.cleanupResult) {
        return $Job.cleanupResult
    }
    $active = [OwnedProcessJob]::ActiveProcesses($Job.handle)
    if ($active -eq [uint32]::MaxValue) {
        $result.errors += "job process query failed"
        return $result
    }
    $result.activeProcessCount = $active
    try {
        $result.graceful = [bool](& $GracefulCloser $Job)
    } catch {
        $result.errors += "graceful close failed"
    }
    $active = [OwnedProcessJob]::ActiveProcesses($Job.handle)
    if ($active -ne [uint32]::MaxValue -and $active -gt 0) {
        try {
            if (-not [OwnedProcessJob]::TerminateJobObject($Job.handle, 1)) {
                throw "job termination failed"
            }
            $result.forced = $true
            $deadline = (Get-Date).AddSeconds(15)
            while ((Get-Date) -lt $deadline -and
                [OwnedProcessJob]::ActiveProcesses($Job.handle) -ne 0) {
                Start-Sleep -Milliseconds 200
            }
        } catch {
            $result.errors += "owned job cleanup failed"
        }
    }
    $active = [OwnedProcessJob]::ActiveProcesses($Job.handle)
    if ($active -ne [uint32]::MaxValue) {
        $result.activeProcessCount = $active
        $result.complete = $active -eq 0
    } else {
        $result.errors += "terminal job process query failed"
    }
    if ($result.complete) {
        [OwnedProcessJob]::CloseHandle($Job.handle) | Out-Null
        $Job.closed = $true
    }
    if ($result.complete) {
        $Job.cleanupResult = $result
    }
    return $result
}

function Select-RunFailure {
        param($PrimaryFailure, $CleanupFailure)
        if ($PrimaryFailure) { return $PrimaryFailure }
        return $CleanupFailure
}
