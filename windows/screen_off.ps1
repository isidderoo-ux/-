# 모니터만 끈다 (컴퓨터는 계속 동작) - 별도 프로그램 설치 불필요
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Monitor {
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
# WM_SYSCOMMAND(0x0112), SC_MONITORPOWER(0xF170), 2 = 끄기
[Monitor]::PostMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr]2) | Out-Null
