$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

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
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr handle, IntPtr deviceContext, uint flags);

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
    }
    throw "Refusing input: the owned '$ExpectedTitle' window could not be proven foreground"
}

function Get-OwnedRoot {
    param([int]$ProcessId, [string]$ExpectedTitle)
    $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
    return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
}

function Find-OwnedElement {
    param(
        [int]$ProcessId,
        [string]$ExpectedTitle,
        [string]$Name,
        [string]$ControlType,
        [int]$TimeoutSeconds = 10
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $root = Get-OwnedRoot -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $Name
        )
        if ($ControlType) {
            $typeCondition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::$ControlType
            )
            $condition = New-Object System.Windows.Automation.AndCondition($condition, $typeCondition)
        }
        $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if ($element) { return $element }
        Start-Sleep -Milliseconds 400
    }
    return $null
}

function Invoke-OwnedElement {
    param([int]$ProcessId, [string]$ExpectedTitle, $Element)
    Assert-OwnedForeground -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle | Out-Null
    $rectangle = $Element.Current.BoundingRectangle
    $process = Get-OwnedDesktop -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
    $window = New-Object NativeDesktopGuard+Rect
    [NativeDesktopGuard]::GetWindowRect($process.MainWindowHandle, [ref]$window) | Out-Null
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

function Capture-OwnedWindow {
    param([int]$ProcessId, [string]$ExpectedTitle, [string]$Path)
    $process = Assert-OwnedForeground -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
    $rectangle = New-Object NativeDesktopGuard+Rect
    [NativeDesktopGuard]::GetWindowRect($process.MainWindowHandle, [ref]$rectangle) | Out-Null
    $width = $rectangle.Right - $rectangle.Left
    $height = $rectangle.Bottom - $rectangle.Top
    if ($width -lt 800 -or $height -lt 500) { throw "Owned window is not captureable: ${width}x${height}" }
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $deviceContext = $graphics.GetHdc()
    [NativeDesktopGuard]::PrintWindow($process.MainWindowHandle, $deviceContext, 2) | Out-Null
    $graphics.ReleaseHdc($deviceContext)
    $graphics.Dispose()
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    return @{ path = $Path; width = $width; height = $height; sha256 = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
}

function Get-OwnedUiaProbe {
    param([int]$ProcessId, [string]$ExpectedTitle)
    $root = Get-OwnedRoot -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
    $elements = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    $result = @()
    foreach ($element in $elements) {
        if ($result.Count -ge 2000) { break }
        $name = $element.Current.Name
        if ($name) {
            $result += [ordered]@{
                name = $name
                type = $element.Current.ControlType.ProgrammaticName -replace "^ControlType\.", ""
                automationId = $element.Current.AutomationId
            }
        }
    }
    return $result
}
