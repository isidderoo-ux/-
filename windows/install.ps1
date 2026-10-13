# 사용법: powershell -ExecutionPolicy Bypass -File install.ps1 -On 09:00 -Off 18:00
#         요일/예약 번호 지정: ... -Slot 2 -Days Monday,Wednesday,Friday
#         -Days 는 켜는 요일이다. (-OffFirst 를 붙이면 끄는 요일, 순서도 끄기 → 켜기)
#         -Message 를 붙이면 끄는 시각에 모니터를 끄는 대신 안내 문구를 띄운다.
param(
    [Parameter(Mandatory = $true)][string]$Off,
    [Parameter(Mandatory = $true)][string]$On,
    [System.DayOfWeek[]]$Days = @(0..6),
    [int]$Slot = 1,
    [switch]$Message,
    [switch]$OffFirst
)
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$user = "$env:USERDOMAIN\$env:USERNAME"

function Register-ScreenTask($name, $script, $time, $days, $extraArgs = "", $description = "") {
    $at = [datetime]::ParseExact($time, "HH:mm", $null)
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\$script`" $extraArgs"
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $at
    # 화면을 제어하려면 로그인한 사용자 세션에서 실행되어야 함
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $extra = @{}
    if ($description) { $extra.Description = $description }
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force @extra | Out-Null
    Write-Host "등록 완료: $name -> $($days -join ',') $time"
}

function Get-NextDays($days) { $days | ForEach-Object { [System.DayOfWeek](([int]$_ + 1) % 7) } }

# 두 번째 동작의 시각이 첫 번째보다 이르면(예: 07:30 켜고 01:00 끄기) 다음 날 실행한다
$onDays = $Days
$offDays = $Days
if ($OffFirst) {
    if ($On -le $Off) { $onDays = Get-NextDays $Days }
} else {
    if ($Off -le $On) { $offDays = Get-NextDays $Days }
}

Register-ScreenTask "ScreenOn$Slot"  "screen_on.ps1"  $On  $onDays
# 로그인할 때 지금이 인증 시간이 아니면 안내 문구를 바로 띄운다 (재부팅 대비)
try {
    $checkAction = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\check.ps1`""
    $checkTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $checkTrigger.Delay = "PT15S"
    Register-ScheduledTask -TaskName "ScreenCheck" -Action $checkAction -Trigger $checkTrigger `
        -Principal (New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive) `
        -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) -Force | Out-Null
} catch {
    Write-Warning "로그인 시 확인 작업을 등록하지 못했습니다: $($_.Exception.Message)"
}

if ($Message) {
    $names = @{ Monday = "월"; Tuesday = "화"; Wednesday = "수"; Thursday = "목"; Friday = "금"; Saturday = "토"; Sunday = "일" }
    $dayText = (@("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday") |
        Where-Object { $Days -contains [System.DayOfWeek]$_ } | ForEach-Object { $names[$_] }) -join ""
    $dayText = switch ($dayText) { "월화수목금토일" { "매일" } "월화수목금" { "평일" } "토일" { "주말" } default { $dayText } }
    $info = if ($OffFirst) { "$dayText $On 부터" } else { "$dayText $On ~ $Off" }
    Register-ScreenTask "ScreenOff$Slot" "message.ps1" $Off $offDays "-Info `"$info`"" $(if ($OffFirst) { "OffFirst" })
} else {
    Register-ScreenTask "ScreenOff$Slot" "screen_off.ps1" $Off $offDays "" $(if ($OffFirst) { "OffFirst" })
}
