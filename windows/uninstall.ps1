# 등록한 화면 끄기/켜기 예약을 삭제한다
foreach ($name in "ScreenOff", "ScreenOn") {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "삭제: $name"
}
