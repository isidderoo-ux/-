# 지금이 인증 시간인지 확인해서, 아니면 안내 문구를 띄운다.
# 로그인할 때(ScreenCheck 작업)와 설정 창의 "지금 바로 적용" 버튼에서 실행된다.
# -DryRun: 실행하지 않고 띄울 예약 작업 이름만 돌려준다 (띄울 게 없으면 아무것도 안 돌려줌)
param([switch]$DryRun)

$now = Get-Date
$latest = $null
# 모든 켜기/끄기 예약 중 가장 최근에 실행됐어야 할 것을 찾는다
Get-ScheduledTask -TaskName "Screen*" -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -match '^Screen(On|Off)\d*$' -and $_.Triggers.Count -gt 0 } |
    ForEach-Object {
        $trigger = $_.Triggers[0]
        $time = ([datetime]$trigger.StartBoundary).TimeOfDay
        # 요일 없이 매일 실행하는 예약(이전 버전)은 모든 요일로 취급
        $mask = if ($trigger.DaysOfWeek) { [int]$trigger.DaysOfWeek } else { 127 }
        for ($d = 0; $d -le 7; $d++) {
            $day = $now.Date.AddDays(-$d)
            if (-not ($mask -band (1 -shl [int]$day.DayOfWeek))) { continue }
            $when = $day + $time
            if ($when -gt $now) { continue }
            if (-not $latest -or $when -gt $latest.When) { $latest = @{ When = $when; Task = $_ } }
            break
        }
    }

# 가장 최근 것이 "안내 문구" 끄기 예약이면 지금은 인증 시간이 아니다
if ($latest -and $latest.Task.TaskName -like "ScreenOff*" -and
    $latest.Task.Actions[0].Arguments -like "*message.ps1*") {
    if ($DryRun) { return $latest.Task.TaskName }
    Start-ScheduledTask -TaskName $latest.Task.TaskName
}
