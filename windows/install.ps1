# 사용법: powershell -ExecutionPolicy Bypass -File install.ps1 -Off 23:00 -On 07:30
param(
    [Parameter(Mandatory = $true)][string]$Off,
    [Parameter(Mandatory = $true)][string]$On
)
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$user = "$env:USERDOMAIN\$env:USERNAME"

function Register-ScreenTask($name, $script, $time) {
    $at = [datetime]::ParseExact($time, "HH:mm", $null)
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\$script`""
    $trigger = New-ScheduledTaskTrigger -Daily -At $at
    # 화면을 제어하려면 로그인한 사용자 세션에서 실행되어야 함
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "등록 완료: $name -> 매일 $time"
}

Register-ScreenTask "ScreenOff" "screen_off.ps1" $Off
Register-ScreenTask "ScreenOn"  "screen_on.ps1"  $On
