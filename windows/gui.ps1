# 화면 자동 끄기/켜기 설정 창
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-TaskTime($name) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task -and $task.Triggers.Count -gt 0) {
        return [datetime]$task.Triggers[0].StartBoundary
    }
    return $null
}

function Update-Status {
    $off = Get-TaskTime "ScreenOff"
    $on = Get-TaskTime "ScreenOn"
    if ($off -and $on) {
        $status.Text = "현재 예약: 매일 $($off.ToString('HH:mm')) 끄기 / $($on.ToString('HH:mm')) 켜기"
        $status.ForeColor = [System.Drawing.Color]::DarkGreen
    } else {
        $status.Text = "현재 등록된 예약이 없습니다."
        $status.ForeColor = [System.Drawing.Color]::DimGray
    }
}

function New-TimePicker($y, $default) {
    $picker = New-Object System.Windows.Forms.DateTimePicker
    $picker.Format = "Custom"
    $picker.CustomFormat = "HH:mm"
    $picker.ShowUpDown = $true
    $picker.Location = New-Object System.Drawing.Point(150, $y)
    $picker.Width = 100
    $picker.Value = $default
    return $picker
}

function New-Label($text, $x, $y) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $text
    $label.Location = New-Object System.Drawing.Point($x, ($y + 3))
    $label.AutoSize = $true
    return $label
}

function New-Button($text, $x, $y, $width) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $text
    $button.Location = New-Object System.Drawing.Point($x, $y)
    $button.Size = New-Object System.Drawing.Size($width, 34)
    return $button
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "화면 자동 끄기/켜기"
$form.ClientSize = New-Object System.Drawing.Size(340, 250)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font("Malgun Gothic", 10)

$today = (Get-Date).Date
$offTime = Get-TaskTime "ScreenOff"
$onTime = Get-TaskTime "ScreenOn"
$offPicker = New-TimePicker 20 $(if ($offTime) { $today + $offTime.TimeOfDay } else { $today.AddHours(23) })
$onPicker = New-TimePicker 60 $(if ($onTime) { $today + $onTime.TimeOfDay } else { $today.AddHours(7.5) })

$saveButton = New-Button "예약 저장" 20 105 145
$deleteButton = New-Button "예약 삭제" 175 105 145
$testButton = New-Button "테스트: 끄고 5초 뒤 켜기" 20 150 300

$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(20, 205)
$status.Size = New-Object System.Drawing.Size(300, 30)

$saveButton.Add_Click({
    $off = $offPicker.Value.ToString("HH:mm")
    $on = $onPicker.Value.ToString("HH:mm")
    try {
        & "$dir\install.ps1" -Off $off -On $on | Out-Null
        Update-Status
        [System.Windows.Forms.MessageBox]::Show("저장했습니다.`n매일 $off 에 끄고 $on 에 켭니다.", "완료") | Out-Null
    } catch {
        [System.Windows.Forms.MessageBox]::Show("저장하지 못했습니다.`n`n$($_.Exception.Message)", "오류", "OK", "Error") | Out-Null
    }
})

$deleteButton.Add_Click({
    & "$dir\uninstall.ps1" | Out-Null
    Update-Status
    [System.Windows.Forms.MessageBox]::Show("예약을 삭제했습니다.", "완료") | Out-Null
})

$testButton.Add_Click({
    $script = "& '$dir\screen_off.ps1'; Start-Sleep 5; & '$dir\screen_on.ps1'"
    Start-Process powershell.exe -WindowStyle Hidden `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script
})

$form.Controls.AddRange(@(
    (New-Label "화면 끄기 시각" 20 20), $offPicker,
    (New-Label "화면 켜기 시각" 20 60), $onPicker,
    $saveButton, $deleteButton, $testButton, $status
))

Update-Status
[void]$form.ShowDialog()
