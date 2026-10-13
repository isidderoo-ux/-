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
                Mode = if ($offTask -and $offTask.Actions[0].Arguments -like "*message.ps1*") { "안내 문구" } else { "끄기" }
            }
        } | Sort-Object On
}

function Update-List {
    $script:schedules = @(Get-Schedules)
    $list.Items.Clear()
    foreach ($s in $script:schedules) {
        [void]$list.Items.Add("$($s.Days)   $($s.On) 켜기  →  $($s.Off) $($s.Mode)")
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
$form.ClientSize = New-Object System.Drawing.Size(430, 660)

# ── 새 예약 만들기 ──
$newBox = New-Control GroupBox 15 10 400 195
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
$messageRadio = New-Control RadioButton 110 105 130 26
$messageRadio.Text = "안내 문구 표시"
$messageRadio.Checked = $true
$offRadio = New-Control RadioButton 250 105 130 26
$offRadio.Text = "모니터 끄기"
$addButton = New-Control Button 15 145 370 34
$addButton.Text = "+ 예약 추가"
$newBox.Controls.AddRange(@((New-Label "켜기" 15 28), $onPicker,
    (New-Label "끄기" 175 28), $offPicker, (New-Label "끄는 시간에" 15 105),
    $messageRadio, $offRadio, $addButton) + $dayBoxes)

# ── 안내 문구 설정 (settings.json 에 저장, message.ps1 이 읽음) ──
$settingsPath = Join-Path $dir "settings.json"
$settings = [pscustomobject]@{ Message = "지금은 인증시간이 아닙니다"; Size = 100; ShowInfo = $true }
if (Test-Path $settingsPath) {
    try {
        $saved = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $saved.PSObject.Properties) { $settings.($p.Name) = $p.Value }
    } catch {}
}

$msgBox = New-Control GroupBox 15 215 400 180
$msgBox.Text = "안내 문구"
$msgText = New-Control TextBox 15 25 370 56
$msgText.Multiline = $true
$msgText.Text = $settings.Message
$sizeInput = New-Control NumericUpDown 95 92 65 28
$sizeInput.Minimum = 30
$sizeInput.Maximum = 300
$sizeInput.Increment = 10
$sizeInput.Value = [int]$settings.Size
$showInfo = New-Control CheckBox 200 92 185 26
$showInfo.Text = "인증 시간 함께 표시"
$showInfo.Checked = [bool]$settings.ShowInfo
$previewButton = New-Control Button 15 130 370 34
$previewButton.Text = "저장하고 미리보기 (8초)"
$msgBox.Controls.AddRange(@($msgText, (New-Label "글자 크기" 15 92), $sizeInput,
    (New-Label "%" 162 92), $showInfo, $previewButton))

# ── 저장된 예약 목록 ──
$listLabel = New-Label "저장된 예약" 15 405
$list = New-Control ListBox 15 433 400 130
$deleteButton = New-Control Button 15 570 400 34
$deleteButton.Text = "선택한 예약 삭제"
$testButton = New-Control Button 15 615 400 34
$testButton.Text = "모니터 끄기 테스트 (5초간 화면만 꺼짐, 문구 없음)"

$form.Controls.AddRange(@($newBox, $msgBox, $listLabel, $list, $deleteButton, $testButton))

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
        $useMessage = $messageRadio.Checked
        & "$dir\install.ps1" -Slot $slot -Off $off -On $on -Days $days -Message:$useMessage | Out-Null
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

$previewButton.Add_Click({
    if (-not $msgText.Text.Trim()) {
        [System.Windows.Forms.MessageBox]::Show("안내 문구를 입력하세요.", "알림") | Out-Null
        return
    }
    [pscustomobject]@{ Message = $msgText.Text.Trim(); Size = [int]$sizeInput.Value; ShowInfo = $showInfo.Checked } |
        ConvertTo-Json | Set-Content $settingsPath -Encoding UTF8
    # 실제 예약과 같은 방식으로 실행한다
    Start-Process powershell.exe `
        -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$dir\message.ps1`"", "-Info", "`"미리보기`""
    $script = "Start-Sleep 8; & '$dir\screen_on.ps1'"
    Start-Process powershell.exe -WindowStyle Hidden `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script
})

$testButton.Add_Click({
    $script = "& '$dir\screen_off.ps1'; Start-Sleep 5; & '$dir\screen_on.ps1'"
    Start-Process powershell.exe -WindowStyle Hidden `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script
})

Update-List
[void]$form.ShowDialog()
