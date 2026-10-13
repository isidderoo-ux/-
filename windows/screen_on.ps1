# 모니터를 켠다 - 마우스를 1픽셀 움직였다가 되돌려서 화면을 깨운다
# 안내 화면(message.ps1)이 떠 있으면 먼저 닫는다
Get-Process powershell -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -ne $PID -and $_.MainWindowTitle -eq "ScreenTimerMessage" } |
    Stop-Process -Force

# 안내용으로 띄운 웹사이트(전용 프로필의 크롬/Edge)도 닫는다. 다른 브라우저 창은 건드리지 않는다.
$browserProfile = Join-Path $PSScriptRoot "browser_profile"
$browser = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$browserProfile*" })
if ($browser.Count -gt 0) {
    # 정상 종료를 먼저 시도해야 다음 실행 때 "복원" 안내가 뜨지 않는다
    $browser | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).CloseMainWindow() } | Out-Null
    Start-Sleep -Seconds 2
    $browser | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

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
