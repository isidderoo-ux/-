# 등록한 화면 끄기/켜기 예약을 삭제한다
# 사용법: uninstall.ps1          (전부 삭제)
#         uninstall.ps1 -Slot 2  (예약 2만 삭제)
param([int]$Slot = 0)
$pattern = if ($Slot -gt 0) { "Screen*$Slot" } else { "Screen*" }
Get-ScheduledTask -TaskName $pattern -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -match '^Screen(Off|On)\d*$|^ScreenCheck$' } |
    ForEach-Object {
        Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false
        Write-Host "삭제: $($_.TaskName)"
    }
