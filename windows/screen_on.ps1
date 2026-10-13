# 모니터를 켠다 - 마우스를 1픽셀 움직였다가 되돌려서 화면을 깨운다
# 안내 문구 화면(message.ps1)이 떠 있으면 먼저 닫는다
Get-Process powershell -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq "ScreenTimerMessage" } |
    Stop-Process -Force

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Wake {
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint flags);
}
"@
$MOUSEEVENTF_MOVE = 0x0001
[Wake]::mouse_event($MOUSEEVENTF_MOVE, 0, 1, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 100
[Wake]::mouse_event($MOUSEEVENTF_MOVE, 0, -1, 0, [UIntPtr]::Zero)
# ES_DISPLAY_REQUIRED(0x2): 디스플레이 켜짐 신호
[Wake]::SetThreadExecutionState(0x2) | Out-Null
