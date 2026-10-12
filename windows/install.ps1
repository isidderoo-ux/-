# 사용법: powershell -ExecutionPolicy Bypass -File install.ps1 -Off 23:00 -On 07:30
#         요일/예약 번호 지정: ... -Slot 2 -Days Monday,Wednesday,Friday
param(
    [Parameter(Mandatory = $true)][string]$Off,
    [Parameter(Mandatory = $true)][string]$On,
    [System.DayOfWeek[]]$Days = @(0..6),
    [int]$Slot = 1
)
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$user = "$env:USERDOMAIN\$env:USERNAME"

function Register-ScreenTask($name, $script, $time, $days) {
    $at = [datetime]::ParseExact($time, "HH:mm", $null)
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\$script`""
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $at
    # 화면을 제어하려면 로그인한 사용자 세션에서 실행되어야 함
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "등록 완료: $name -> $($days -join ',') $time"
}

# 켜는 시각이 끄는 시각보다 이르면(예: 23:00 끄고 07:30 켜기) 다음 날 켠다
$onDays = $Days
if ($On -le $Off) {
    $onDays = $Days | ForEach-Object { [System.DayOfWeek](([int]$_ + 1) % 7) }
}

Register-ScreenTask "ScreenOff$Slot" "screen_off.ps1" $Off $Days
Register-ScreenTask "ScreenOn$Slot"  "screen_on.ps1"  $On  $onDays
