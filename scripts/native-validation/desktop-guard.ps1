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
                Assert-OwnedDialogForeground -ProcessId $ProcessId -ExpectedDialogTitle $ExpectedDialogTitle
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
                Start-Sleep -Milliseconds 400
            }
            throw "The verified owned Save As dialog was not exposed through UI Automation"
}

function Assert-ControlInsideDialog {
            param([int]$ProcessId, [string]$ExpectedDialogTitle, $Dialog, $Control)
            Assert-OwnedDialogForeground -ProcessId $ProcessId -ExpectedDialogTitle $ExpectedDialogTitle
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

function Find-OwnedElement {
    param(
        [int]$ProcessId,
        [string]$ExpectedTitle,
        [string]$Name,
        [string[]]$ControlTypes,
        [AllowEmptyString()][string]$AutomationId,
        [int]$TimeoutSeconds = 10
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $root = Get-OwnedRoot -ProcessId $ProcessId -ExpectedTitle $ExpectedTitle
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::NameProperty,
            $Name
        )
        $processCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
            $ProcessId
        )
        $condition = New-Object System.Windows.Automation.AndCondition($condition, $processCondition)
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
            if ($ControlTypes -notcontains $type -or
                $element.Current.AutomationId -ne $AutomationId -or
                $rectangle.Width -le 0 -or $rectangle.Height -le 0 -or
                $rectangle.X -lt $window.Left -or $rectangle.Y -lt $window.Top -or
                ($rectangle.X + $rectangle.Width) -gt $window.Right -or
                ($rectangle.Y + $rectangle.Height) -gt $window.Bottom) {
                continue
            }
            $matches += $element
        }
        $selected = Select-UniqueCandidate -Candidates $matches -LogicalName $Name
        if ($selected) { return $selected }
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

function Get-AllowlistedControlProbe {
    param([string]$LogicalName, $Element)
    return [ordered]@{
        logicalName = $LogicalName
        controlType = $Element.Current.ControlType.ProgrammaticName -replace "^ControlType\.", ""
        enabled = $Element.Current.IsEnabled
        offscreen = $Element.Current.IsOffscreen
    }
}
