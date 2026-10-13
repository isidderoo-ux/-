# 모든 모니터를 검은 화면 + 안내 문구로 덮는다 (screen_on.ps1 이 실행되면 닫힘)
# 관리자가 직접 닫으려면 Ctrl + Shift + Q
# 문구/글자 크기는 같은 폴더의 settings.json (설정 창에서 저장)
param([string]$Info = "")
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$settings = [pscustomobject]@{ Message = "지금은 인증시간이 아닙니다"; Size = 100; ShowInfo = $true }
$settingsPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "settings.json"
if (Test-Path $settingsPath) {
    try {
        $saved = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $saved.PSObject.Properties) { $settings.($p.Name) = $p.Value }
    } catch {}
}

$title = "ScreenTimerMessage"
# 이미 떠 있는 안내 화면이 있으면 닫고 새로 띄운다
Get-Process powershell -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -ne $PID -and $_.MainWindowTitle -eq $title } |
    Stop-Process -Force

$script:allowClose = $false
$forms = foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    $b = $screen.Bounds
    $size = [Math]::Min($b.Width / 16, $b.Height / 12) * $settings.Size / 100
    # 문구가 화면 너비를 넘으면 들어갈 때까지 줄인다
    while ($size -gt 10) {
        $font = New-Object System.Drawing.Font("Malgun Gothic", [float]$size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        if ([System.Windows.Forms.TextRenderer]::MeasureText($settings.Message, $font).Width -le $b.Width * 0.92) { break }
        $size *= 0.9
    }

    $f = New-Object System.Windows.Forms.Form
    $f.Text = $title
    $f.FormBorderStyle = "None"
    $f.StartPosition = "Manual"
    $f.Bounds = $b
    $f.BackColor = [System.Drawing.Color]::Black
    $f.TopMost = $true
    $f.KeyPreview = $true

    $main = New-Object System.Windows.Forms.Label
    $main.Text = $settings.Message
    $main.ForeColor = [System.Drawing.Color]::White
    $main.Font = New-Object System.Drawing.Font("Malgun Gothic", [float]$size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $main.TextAlign = "BottomCenter"
    $main.Dock = "Fill"

    $sub = New-Object System.Windows.Forms.Label
    $sub.Text = if ($Info -and $settings.ShowInfo) { "인증 시간: $Info" } else { "" }
    $sub.ForeColor = [System.Drawing.Color]::Gray
    $sub.Font = New-Object System.Drawing.Font("Malgun Gothic", [float]($size / 2.2), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $sub.TextAlign = "TopCenter"
    $sub.Dock = "Bottom"
    $sub.Height = [int]($b.Height / 2 - $size / 2)
    $sub.Padding = New-Object System.Windows.Forms.Padding(0, [int]($size / 2), 0, 0)

    $f.Controls.Add($main)
    $f.Controls.Add($sub)
    # Alt+F4 등으로 닫히지 않게 막는다
    $f.Add_FormClosing({ if (-not $script:allowClose) { $_.Cancel = $true } })
    $f.Add_KeyDown({
        if ($_.Control -and $_.Shift -and $_.KeyCode -eq "Q") {
            $script:allowClose = $true
            [System.Windows.Forms.Application]::Exit()
        }
    })
    $f
}

foreach ($f in $forms) { $f.Show() }
$forms[0].Activate()
[System.Windows.Forms.Cursor]::Hide()
[System.Windows.Forms.Application]::Run()
