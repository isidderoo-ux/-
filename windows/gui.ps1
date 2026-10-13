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
            # 끄기 → 켜기 순서인 예약은 끄는 요일을 기준으로 보여준다
            $offFirst = $offTask -and $offTask.Description -eq "OffFirst"
            $baseTrigger = if ($offFirst) { $offTask.Triggers[0] } else { $onTrigger }
            # 요일 없이 매일 실행하는 예약(이전 버전)은 모든 요일로 취급
            $mask = if ($baseTrigger.DaysOfWeek) { [int]$baseTrigger.DaysOfWeek } else { 127 }
            [pscustomobject]@{
                Slot = $slot
                OffFirst = $offFirst
                Days = Format-Days $mask
                On   = ([datetime]$onTrigger.StartBoundary).ToString("HH:mm")
                Off  = if ($offTask) { ([datetime]$offTask.Triggers[0].StartBoundary).ToString("HH:mm") } else { "--:--" }
                Mode = if ($offTask -and $offTask.Actions[0].Arguments -like "*message.ps1*") { "안내 문구" } else { "끄기" }
            }
        } | Sort-Object { if ($_.OffFirst) { $_.Off } else { $_.On } }
}

function Update-List {
    $script:schedules = @(Get-Schedules)
    $list.Items.Clear()
    foreach ($s in $script:schedules) {
        if ($s.OffFirst) {
            [void]$list.Items.Add("$($s.Days)   $($s.Off) $($s.Mode)  →  $($s.On) 켜기")
        } else {
            [void]$list.Items.Add("$($s.Days)   $($s.On) 켜기  →  $($s.Off) $($s.Mode)")
        }
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
$form.ClientSize = New-Object System.Drawing.Size(860, 565)

# ── 새 예약 만들기 ──
$newBox = New-Control GroupBox 15 10 400 222
$newBox.Text = "새 예약"
$today = (Get-Date).Date

# 순서 선택 (라디오 버튼 묶음이 따로 동작하도록 패널에 넣는다)
$orderPanel = New-Control Panel 15 24 370 30
$onFirstRadio = New-Control RadioButton 50 2 140 26
$onFirstRadio.Text = "켜기 → 끄기"
$onFirstRadio.Checked = $true
$offFirstRadio = New-Control RadioButton 200 2 140 26
$offFirstRadio.Text = "끄기 → 켜기"
$orderPanel.Controls.AddRange(@((New-Label "순서" 0 0), $onFirstRadio, $offFirstRadio))

$onLabel = New-Label "켜기" 15 60
$onPicker = New-TimePicker 60 60 $today.AddHours(9)
$offLabel = New-Label "끄기" 175 60
$offPicker = New-TimePicker 220 60 $today.AddHours(18)
# 순서에 맞게 켜기/끄기 칸의 좌우 위치를 바꾼다
$onFirstRadio.Add_CheckedChanged({
    $first, $second = if ($onFirstRadio.Checked) { @(($onLabel, $onPicker), ($offLabel, $offPicker)) } else { @(($offLabel, $offPicker), ($onLabel, $onPicker)) }
    $first[0].Left = 15; $first[1].Left = 60
    $second[0].Left = 175; $second[1].Left = 220
})
$dayBoxes = @()
for ($d = 0; $d -lt 7; $d++) {
    $cb = New-Control CheckBox (15 + $d * 54) 100 52 24
    $cb.Text = $dayNames[$d]
    $cb.Checked = $d -lt 5
    $dayBoxes += $cb
}
$messageRadio = New-Control RadioButton 110 135 130 26
$messageRadio.Text = "안내 문구 표시"
$messageRadio.Checked = $true
$offRadio = New-Control RadioButton 250 135 130 26
$offRadio.Text = "모니터 끄기"
$addButton = New-Control Button 15 172 370 34
$addButton.Text = "+ 예약 추가"
$newBox.Controls.AddRange(@($orderPanel, $onLabel, $onPicker,
    $offLabel, $offPicker, (New-Label "끄는 시간에" 15 135),
    $messageRadio, $offRadio, $addButton) + $dayBoxes)

# ── 안내 화면 설정 (settings.json 에 저장, message.ps1 이 읽음) ──
$settingsPath = Join-Path $dir "settings.json"
$settings = [pscustomobject]@{ Message = "지금은 인증시간이 아닙니다"; Size = 100; ShowInfo = $true; ShowMessage = $true; Image = ""; Mode = "screen"; Url = ""; CloseButton = $true; AdminPin = "" }
if (Test-Path $settingsPath) {
    try {
        $saved = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $saved.PSObject.Properties) { $settings.($p.Name) = $p.Value }
    } catch {}
}
$script:imageFile = "$($settings.Image)"

# 이미지는 파일을 잠그지 않도록 메모리로 읽어 온다
function Read-Image($path) {
    $stream = New-Object System.IO.MemoryStream(, [System.IO.File]::ReadAllBytes($path))
    $loaded = [System.Drawing.Image]::FromStream($stream)
    $bitmap = New-Object System.Drawing.Bitmap($loaded)
    $loaded.Dispose(); $stream.Dispose()
    return $bitmap
}

function Save-Settings {
    [pscustomobject]@{
        Message = $msgText.Text.Trim(); Size = [int]$sizeInput.Value
        ShowInfo = $showInfo.Checked; ShowMessage = $showMessage.Checked; Image = $script:imageFile
        Mode = $(if ($urlRadio.Checked) { "url" } else { "screen" }); Url = $urlText.Text.Trim()
        CloseButton = $closeButtonCheck.Checked; AdminPin = $pinText.Text.Trim()
    } | ConvertTo-Json | Set-Content $settingsPath -Encoding UTF8
}

# 입력값을 확인하고 저장한다. 문제가 있으면 알려주고 $false 를 돌려준다.
function Save-CheckedSettings {
    if ($urlRadio.Checked) {
        $url = $urlText.Text.Trim()
        if (-not $url) {
            [System.Windows.Forms.MessageBox]::Show("띄울 웹사이트 주소를 입력하세요.", "알림") | Out-Null
            return $false
        }
        if ($url -notmatch '^https?://') { $urlText.Text = "https://$url" }
    } elseif ($showMessage.Checked -and -not $msgText.Text.Trim()) {
        [System.Windows.Forms.MessageBox]::Show("안내 문구를 입력하세요.", "알림") | Out-Null
        return $false
    } elseif (-not $showMessage.Checked -and -not $script:imageFile) {
        [System.Windows.Forms.MessageBox]::Show("문구나 이미지 중 하나는 있어야 합니다.", "알림") | Out-Null
        return $false
    }
    Save-Settings
    return $true
}

# 예약이 다른 폴더(예: 예전에 쓰던 폴더)의 파일을 실행하고 있으면 이 폴더로 바꾼다
function Sync-TaskFolder {
    $tasks = @(Get-ScheduledTask -TaskName "Screen*" -ErrorAction SilentlyContinue |
        Where-Object { $_.TaskName -match '^Screen(On|Off)\d*$|^ScreenCheck$' })
    $stale = @($tasks | Where-Object {
        $_.Actions[0].Arguments -match '-File "(.+)\\[^\\]+\.ps1"' -and $Matches[1] -ne $dir })
    if ($stale.Count -eq 0) { return }
    $null = $stale[0].Actions[0].Arguments -match '-File "(.+)\\[^\\]+\.ps1"'
    $oldDir = $Matches[1]
    $answer = [System.Windows.Forms.MessageBox]::Show(
        "저장된 예약이 다른 폴더의 파일을 실행하고 있습니다.`n`n예약이 쓰는 폴더: $oldDir`n지금 이 폴더: $dir`n`n예약이 이 폴더의 최신 파일을 쓰도록 바꿀까요?",
        "예약 폴더 확인", "YesNo", "Question")
    if ($answer -ne "Yes") { return }
    foreach ($t in $stale) {
        $null = $t.Actions[0].Arguments -match '-File "(.+)\\[^\\]+\.ps1"'
        $newArgs = $t.Actions[0].Arguments.Replace("`"$($Matches[1])\", "`"$dir\")
        $action = New-ScheduledTaskAction -Execute $t.Actions[0].Execute -Argument $newArgs
        Set-ScheduledTask -TaskName $t.TaskName -Action $action | Out-Null
    }
}

function Update-ImagePreview {
    if ($imagePreview.Image) { $imagePreview.Image.Dispose(); $imagePreview.Image = $null }
    $path = if ($script:imageFile) { Join-Path $dir $script:imageFile }
    if ($path -and (Test-Path $path)) {
        $imagePreview.Image = Read-Image $path
        $imageName.Text = "이미지 사용 중"
        $removeImageButton.Enabled = $true
    } else {
        $imageName.Text = "이미지 없음 (검은 배경)"
        $removeImageButton.Enabled = $false
    }
}

$msgBox = New-Control GroupBox 430 10 415 540
$msgBox.Text = "안내 화면"

# 안내 화면 종류 (라디오 버튼 묶음이 따로 동작하도록 패널에 넣는다)
$modePanel = New-Control Panel 15 22 385 30
$screenRadio = New-Control RadioButton 0 2 160 26
$screenRadio.Text = "문구 / 이미지"
$urlRadio = New-Control RadioButton 170 2 200 26
$urlRadio.Text = "웹사이트 (URL)"
$modePanel.Controls.AddRange(@($screenRadio, $urlRadio))
$urlText = New-Control TextBox 60 55 340 28
$urlText.Text = $settings.Url
$urlLabel = New-Label "주소" 15 55

$showMessage = New-Control CheckBox 15 90 200 26
$showMessage.Text = "문구 표시"
$showMessage.Checked = [bool]$settings.ShowMessage
$msgText = New-Control TextBox 15 120 385 56
$msgText.Multiline = $true
$msgText.Text = $settings.Message
$sizeInput = New-Control NumericUpDown 95 187 65 28
$sizeInput.Minimum = 30
$sizeInput.Maximum = 300
$sizeInput.Increment = 10
$sizeInput.Value = [int]$settings.Size
$showInfo = New-Control CheckBox 200 187 200 26
$showInfo.Text = "인증 시간 함께 표시"
$showInfo.Checked = [bool]$settings.ShowInfo

$chooseImageButton = New-Control Button 15 230 130 32
$chooseImageButton.Text = "이미지 선택..."
$removeImageButton = New-Control Button 150 230 90 32
$removeImageButton.Text = "이미지 빼기"
$imageName = New-Control Label 248 237 155 22
$imagePreview = New-Control PictureBox 15 270 385 180
$imagePreview.SizeMode = "Zoom"
$imagePreview.BackColor = [System.Drawing.Color]::Black
$closeButtonCheck = New-Control CheckBox 15 460 160 26
$closeButtonCheck.Text = "끄기 버튼 표시"
$closeButtonCheck.Checked = [bool]$settings.CloseButton
$pinText = New-Control TextBox 245 460 155 28
$pinText.Text = "$($settings.AdminPin)"
$previewButton = New-Control Button 15 495 385 34
$previewButton.Text = "저장하고 미리보기 (10초)"
$sizeLabel = New-Label "글자 크기" 15 187
$percentLabel = New-Label "%" 162 187
$msgBox.Controls.AddRange(@($modePanel, $urlLabel, $urlText, $showMessage, $msgText, $sizeLabel, $sizeInput,
    $percentLabel, $showInfo, $chooseImageButton, $removeImageButton, $imageName,
    $imagePreview, $closeButtonCheck, (New-Label "비밀번호" 178 460), $pinText, $previewButton))

# 고른 종류에 해당하는 칸만 쓸 수 있게 한다
function Update-ModeControls {
    $isUrl = $urlRadio.Checked
    foreach ($c in $urlLabel, $urlText) { $c.Enabled = $isUrl }
    foreach ($c in $showMessage, $msgText, $sizeLabel, $sizeInput, $percentLabel, $showInfo,
        $chooseImageButton, $removeImageButton, $imageName, $imagePreview) { $c.Enabled = -not $isUrl }
    if (-not $isUrl) { Update-ImagePreview }
}
$urlRadio.Add_CheckedChanged({ Update-ModeControls })

# ── 저장된 예약 목록 ──
$listLabel = New-Label "저장된 예약" 15 242
$list = New-Control ListBox 15 270 400 132
$deleteButton = New-Control Button 15 412 195 34
$deleteButton.Text = "선택한 예약 삭제"
$applyButton = New-Control Button 220 412 195 34
$applyButton.Text = "지금 바로 적용"
$testButton = New-Control Button 15 452 400 28
$testButton.Text = "모니터 끄기 테스트 (5초간 화면만 꺼짐, 문구 없음)"

$form.Controls.AddRange(@($newBox, $msgBox, $listLabel, $list, $deleteButton, $applyButton, $testButton))

$chooseImageButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "안내 화면에 띄울 이미지 선택"
    $dialog.Filter = "이미지 파일|*.png;*.jpg;*.jpeg;*.bmp;*.gif"
    if ($dialog.ShowDialog() -ne "OK") { return }
    try {
        # 원본을 옮기거나 지워도 괜찮도록 프로그램 폴더에 복사해 둔다
        if ($imagePreview.Image) { $imagePreview.Image.Dispose(); $imagePreview.Image = $null }
        Get-ChildItem $dir -Filter "message_image.*" | Remove-Item -Force
        $script:imageFile = "message_image" + [System.IO.Path]::GetExtension($dialog.FileName).ToLower()
        Copy-Item $dialog.FileName (Join-Path $dir $script:imageFile) -Force
        Save-Settings
    } catch {
        $script:imageFile = ""
        [System.Windows.Forms.MessageBox]::Show("이미지를 불러오지 못했습니다.`n`n$($_.Exception.Message)", "오류", "OK", "Error") | Out-Null
    }
    Update-ImagePreview
})

$removeImageButton.Add_Click({
    if ($imagePreview.Image) { $imagePreview.Image.Dispose(); $imagePreview.Image = $null }
    Get-ChildItem $dir -Filter "message_image.*" | Remove-Item -Force -ErrorAction SilentlyContinue
    $script:imageFile = ""
    Save-Settings
    Update-ImagePreview
})

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
        $offFirst = $offFirstRadio.Checked
        & "$dir\install.ps1" -Slot $slot -Off $off -On $on -Days $days -Message:$useMessage -OffFirst:$offFirst | Out-Null
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

# 예약을 기다리지 않고 지금 시각 기준으로 화면 상태를 맞춘다
$applyButton.Add_Click({
    # 화면에서 바꾼 안내 화면 설정을 먼저 저장해야 그대로 뜬다
    if (-not (Save-CheckedSettings)) { return }
    $task = & "$dir\check.ps1" -DryRun
    if (-not $task) {
        [System.Windows.Forms.MessageBox]::Show("지금은 인증 시간이라 QR 화면을 그대로 둡니다.", "지금 바로 적용") | Out-Null
        return
    }
    [System.Windows.Forms.MessageBox]::Show(
        "지금은 인증 시간이 아니므로 대기화면을 띄웁니다.`n다음 켜기 시각에 자동으로 사라집니다.", "지금 바로 적용") | Out-Null
    Start-ScheduledTask -TaskName $task
})

$previewButton.Add_Click({
    if (-not (Save-CheckedSettings)) { return }
    # 실제 예약과 같은 방식으로 실행한다
    Start-Process powershell.exe `
        -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$dir\message.ps1`"", "-Info", "`"미리보기`""
    $script = "Start-Sleep 10; & '$dir\screen_on.ps1'"
    Start-Process powershell.exe -WindowStyle Hidden `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script
})

$testButton.Add_Click({
    $script = "& '$dir\screen_off.ps1'; Start-Sleep 5; & '$dir\screen_on.ps1'"
    Start-Process powershell.exe -WindowStyle Hidden `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script
})

Sync-TaskFolder
Update-List
Update-ImagePreview
if ($settings.Mode -eq "url") { $urlRadio.Checked = $true } else { $screenRadio.Checked = $true }
Update-ModeControls
[void]$form.ShowDialog()
