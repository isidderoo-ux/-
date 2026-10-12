# 화면 자동 끄기/켜기 설정 창
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SlotCount = 2
$dayNames = "월", "화", "수", "목", "금", "토", "일"
$dayValues = [System.DayOfWeek[]]@(1, 2, 3, 4, 5, 6, 0)

function Get-Trigger($name) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task -and $task.Triggers.Count -gt 0) { return $task.Triggers[0] }
    return $null
}

function Get-SlotSummary($slot) {
    $days = (0..6 | Where-Object { $slot.DayBoxes[$_].Checked } | ForEach-Object { $dayNames[$_] }) -join ""
    return "$days $($slot.Off.Value.ToString('HH:mm'))~$($slot.On.Value.ToString('HH:mm'))"
}

function Update-Status {
    $lines = @()
    for ($i = 1; $i -le $SlotCount; $i++) {
        if (Get-Trigger "ScreenOff$i") { $lines += "예약 $i : $(Get-SlotSummary $slots[$i - 1])" }
    }
    if ($lines.Count -gt 0) {
        $status.Text = "저장된 예약  " + ($lines -join "  /  ")
        $status.ForeColor = [System.Drawing.Color]::DarkGreen
    } else {
        $status.Text = "저장된 예약이 없습니다."
        $status.ForeColor = [System.Drawing.Color]::DimGray
    }
}

function New-Control($type, $x, $y, $w, $h) {
    $c = New-Object "System.Windows.Forms.$type"
    $c.Location = New-Object System.Drawing.Point($x, $y)
    if ($w) { $c.Size = New-Object System.Drawing.Size($w, $h) }
    return $c
}

function New-TimePicker($x, $y, $value) {
    $p = New-Control DateTimePicker $x $y 80 28
    $p.Format = "Custom"
    $p.CustomFormat = "HH:mm"
    $p.ShowUpDown = $true
    $p.Value = $value
    return $p
}

function New-Label($text, $x, $y) {
    $l = New-Control Label $x ($y + 3) $null $null
    $l.Text = $text
    $l.AutoSize = $true
    return $l
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "화면 자동 끄기/켜기"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font("Malgun Gothic", 10)

$today = (Get-Date).Date
$slots = @()
$y = 10
for ($i = 1; $i -le $SlotCount; $i++) {
    $offTrigger = Get-Trigger "ScreenOff$i"
    $onTrigger = Get-Trigger "ScreenOn$i"

    $box = New-Control GroupBox 15 $y 400 125
    $box.Text = "예약 $i"

    $enabled = New-Control CheckBox 15 25 70 24
    $enabled.Text = "사용"
    $enabled.Checked = [bool]$offTrigger

    $offValue = if ($offTrigger) { $today + ([datetime]$offTrigger.StartBoundary).TimeOfDay } else { $today.AddHours(23) }
    $onValue = if ($onTrigger) { $today + ([datetime]$onTrigger.StartBoundary).TimeOfDay } else { $today.AddHours(7.5) }
    $offPicker = New-TimePicker 140 24 $offValue
    $onPicker = New-TimePicker 290 24 $onValue

    $dayBoxes = @()
    for ($d = 0; $d -lt 7; $d++) {
        $cb = New-Control CheckBox (15 + $d * 54) 70 52 24
        $cb.Text = $dayNames[$d]
        $cb.Checked = if ($offTrigger) {
            ($offTrigger.DaysOfWeek -band (1 -shl [int]$dayValues[$d])) -ne 0
        } else { $d -lt 5 }
        $dayBoxes += $cb
    }

    $box.Controls.AddRange(@($enabled, (New-Label "끄기" 100 24), $offPicker,
        (New-Label "켜기" 250 24), $onPicker) + $dayBoxes)
    $form.Controls.Add($box)
    $slots += [pscustomobject]@{ Enabled = $enabled; Off = $offPicker; On = $onPicker; DayBoxes = $dayBoxes }
    $y += 135
}

$saveButton = New-Control Button 15 $y 195 34
$saveButton.Text = "저장"
$deleteButton = New-Control Button 220 $y 195 34
$deleteButton.Text = "모두 삭제"
$testButton = New-Control Button 15 ($y + 42) 400 34
$testButton.Text = "테스트: 끄고 5초 뒤 켜기"
$status = New-Control Label 15 ($y + 86) 400 44
$form.ClientSize = New-Object System.Drawing.Size(430, ($y + 135))
$form.Controls.AddRange(@($saveButton, $deleteButton, $testButton, $status))

$saveButton.Add_Click({
    try {
        # 이전 버전(요일 없이 매일)으로 등록한 예약 정리
        foreach ($legacy in "ScreenOff", "ScreenOn") {
            Unregister-ScheduledTask -TaskName $legacy -Confirm:$false -ErrorAction SilentlyContinue
        }
        for ($i = 1; $i -le $SlotCount; $i++) {
            $slot = $slots[$i - 1]
            $days = @(for ($d = 0; $d -lt 7; $d++) { if ($slot.DayBoxes[$d].Checked) { $dayValues[$d] } })
            if (-not $slot.Enabled.Checked) {
                & "$dir\uninstall.ps1" -Slot $i | Out-Null
                continue
            }
            if ($days.Count -eq 0) { throw "예약 $i 에 요일을 하나 이상 선택하세요." }
            $off = $slot.Off.Value.ToString("HH:mm")
            $on = $slot.On.Value.ToString("HH:mm")
            if ($off -eq $on) { throw "예약 $i 의 끄기/켜기 시각이 같습니다." }
            & "$dir\install.ps1" -Slot $i -Off $off -On $on -Days $days | Out-Null
        }
        Update-Status
        [System.Windows.Forms.MessageBox]::Show("저장했습니다.", "완료") | Out-Null
    } catch {
        [System.Windows.Forms.MessageBox]::Show("저장하지 못했습니다.`n`n$($_.Exception.Message)", "오류", "OK", "Error") | Out-Null
    }
})

$deleteButton.Add_Click({
    & "$dir\uninstall.ps1" | Out-Null
    foreach ($slot in $slots) { $slot.Enabled.Checked = $false }
    Update-Status
    [System.Windows.Forms.MessageBox]::Show("모든 예약을 삭제했습니다.", "완료") | Out-Null
})

$testButton.Add_Click({
    $script = "& '$dir\screen_off.ps1'; Start-Sleep 5; & '$dir\screen_on.ps1'"
    Start-Process powershell.exe -WindowStyle Hidden `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script
})

Update-Status
[void]$form.ShowDialog()
