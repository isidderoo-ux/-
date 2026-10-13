# 화면 자동 끄기/켜기 설정 창
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dayNames = "월", "화", "수", "목", "금", "토", "일"
$dayValues = [System.DayOfWeek[]]@(1, 2, 3, 4, 5, 6, 0)

function Format-Days($mask) {
    $picked = @(0..6 | Where-Object { $mask -band (1 -shl [int]$dayValues[$_]) })
    $text = ($picked | ForEach-Object { $dayNames[$_] }) -join ""
    switch ($text) {
        "월화수목금토일" { return "매일" }
        "월화수목금" { return "평일" }
        "토일" { return "주말" }
        default { return $text }
    }
}

# 작업 스케줄러에 등록된 예약 목록을 읽어 온다
function Get-Schedules {
    Get-ScheduledTask -TaskName "ScreenOn*" -ErrorAction SilentlyContinue |
        Where-Object { $_.TaskName -match '^ScreenOn(\d*)$' } |
        ForEach-Object {
            $slot = $_.TaskName -replace '^ScreenOn', ''
            $onTrigger = $_.Triggers[0]
            $offTask = Get-ScheduledTask -TaskName "ScreenOff$slot" -ErrorAction SilentlyContinue
            # 요일 없이 매일 실행하는 예약(이전 버전)은 모든 요일로 취급
            $mask = if ($onTrigger.DaysOfWeek) { [int]$onTrigger.DaysOfWeek } else { 127 }
            [pscustomobject]@{
                Slot = $slot
                Days = Format-Days $mask
                On   = ([datetime]$onTrigger.StartBoundary).ToString("HH:mm")
                Off  = if ($offTask) { ([datetime]$offTask.Triggers[0].StartBoundary).ToString("HH:mm") } else { "--:--" }
            }
        } | Sort-Object On
}

function Update-List {
    $script:schedules = @(Get-Schedules)
    $list.Items.Clear()
    foreach ($s in $script:schedules) {
        [void]$list.Items.Add("$($s.Days)   $($s.On) 켜기  →  $($s.Off) 끄기")
    }
    if ($script:schedules.Count -eq 0) { [void]$list.Items.Add("(저장된 예약이 없습니다)") }
    $deleteButton.Enabled = $false
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
$form.ClientSize = New-Object System.Drawing.Size(430, 470)

# ── 새 예약 만들기 ──
$newBox = New-Control GroupBox 15 10 400 160
$newBox.Text = "새 예약"
$today = (Get-Date).Date
$onPicker = New-TimePicker 60 28 $today.AddHours(9)
$offPicker = New-TimePicker 220 28 $today.AddHours(18)
$dayBoxes = @()
for ($d = 0; $d -lt 7; $d++) {
    $cb = New-Control CheckBox (15 + $d * 54) 70 52 24
    $cb.Text = $dayNames[$d]
    $cb.Checked = $d -lt 5
    $dayBoxes += $cb
}
$addButton = New-Control Button 15 110 370 34
$addButton.Text = "+ 예약 추가"
$newBox.Controls.AddRange(@((New-Label "켜기" 15 28), $onPicker,
    (New-Label "끄기" 175 28), $offPicker, $addButton) + $dayBoxes)

# ── 저장된 예약 목록 ──
$listLabel = New-Label "저장된 예약" 15 180
$list = New-Control ListBox 15 208 400 150
$deleteButton = New-Control Button 15 366 400 34
$deleteButton.Text = "선택한 예약 삭제"
$testButton = New-Control Button 15 420 400 34
$testButton.Text = "테스트: 끄고 5초 뒤 켜기"

$form.Controls.AddRange(@($newBox, $listLabel, $list, $deleteButton, $testButton))

$addButton.Add_Click({
    $days = @(for ($d = 0; $d -lt 7; $d++) { if ($dayBoxes[$d].Checked) { $dayValues[$d] } })
    $off = $offPicker.Value.ToString("HH:mm")
    $on = $onPicker.Value.ToString("HH:mm")
    if ($days.Count -eq 0) {
        [System.Windows.Forms.MessageBox]::Show("요일을 하나 이상 선택하세요.", "알림") | Out-Null
        return
    }
    if ($off -eq $on) {
        [System.Windows.Forms.MessageBox]::Show("켜기와 끄기 시각이 같습니다.", "알림") | Out-Null
        return
    }
    # 비어 있는 예약 번호를 찾는다
    $used = @($script:schedules | ForEach-Object { $_.Slot })
    $slot = 1
    while ($used -contains "$slot") { $slot++ }
    try {
        & "$dir\install.ps1" -Slot $slot -Off $off -On $on -Days $days | Out-Null
        Update-List
    } catch {
        [System.Windows.Forms.MessageBox]::Show("추가하지 못했습니다.`n`n$($_.Exception.Message)", "오류", "OK", "Error") | Out-Null
    }
})

$list.Add_SelectedIndexChanged({
    $deleteButton.Enabled = $list.SelectedIndex -ge 0 -and $list.SelectedIndex -lt $script:schedules.Count
})

$deleteButton.Add_Click({
    $s = $script:schedules[$list.SelectedIndex]
    $answer = [System.Windows.Forms.MessageBox]::Show(
        "이 예약을 삭제할까요?`n`n$($list.SelectedItem)", "예약 삭제", "YesNo", "Question")
    if ($answer -ne "Yes") { return }
    foreach ($name in "ScreenOff$($s.Slot)", "ScreenOn$($s.Slot)") {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    }
    Update-List
})

$testButton.Add_Click({
    $script = "& '$dir\screen_off.ps1'; Start-Sleep 5; & '$dir\screen_on.ps1'"
    Start-Process powershell.exe -WindowStyle Hidden `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script
})

Update-List
[void]$form.ShowDialog()
