# 모든 모니터를 검은 화면 + 안내 문구로 덮는다 (screen_on.ps1 이 실행되면 닫힘)
# 관리자가 직접 닫으려면 Ctrl + Shift + Q
# 문구/글자 크기는 같은 폴더의 settings.json (설정 창에서 저장)
param([string]$Info = "")
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $dir "message.log"

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $settings = [pscustomobject]@{ Message = "지금은 인증시간이 아닙니다"; Size = 100; ShowInfo = $true }
    $settingsPath = Join-Path $dir "settings.json"
    if (Test-Path $settingsPath) {
        $saved = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $saved.PSObject.Properties) { $settings.($p.Name) = $p.Value }
    }
    $message = "$($settings.Message)".Trim()
    if (-not $message) { $message = "지금은 인증시간이 아닙니다" }
    $infoText = if ($Info -and $settings.ShowInfo) { "인증 시간: $Info" } else { "" }

    $title = "ScreenTimerMessage"
    # 이미 떠 있는 안내 화면이 있으면 닫고 새로 띄운다
    Get-Process powershell -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -ne $PID -and $_.MainWindowTitle -eq $title } |
        Stop-Process -Force

    $script:allowClose = $false
    $forms = foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
        $b = $screen.Bounds
        $size = [Math]::Min($b.Width / 16, $b.Height / 12) * [double]$settings.Size / 100
        # 문구가 화면 너비를 넘으면 들어갈 때까지 줄인다
        while ($true) {
            $mainFont = New-Object System.Drawing.Font("Malgun Gothic", [float]$size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
            if ($size -le 12 -or [System.Windows.Forms.TextRenderer]::MeasureText($message, $mainFont).Width -le $b.Width * 0.92) { break }
            $size *= 0.9
        }
        $infoFont = New-Object System.Drawing.Font("Malgun Gothic", [float]($size / 2.2), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

        $f = New-Object System.Windows.Forms.Form
        $f.Text = $title
        $f.FormBorderStyle = "None"
        $f.StartPosition = "Manual"
        $f.Bounds = $b
        $f.BackColor = [System.Drawing.Color]::Black
        $f.TopMost = $true
        $f.KeyPreview = $true
        $f.Tag = @{ Main = $mainFont; Info = $infoFont }

        # 글자를 화면 가운데에 직접 그린다
        $f.Add_Paint({
            param($sender, $e)
            $fonts = $sender.Tag
            $w = $sender.ClientSize.Width
            $flags = [System.Windows.Forms.TextFormatFlags]::HorizontalCenter
            $mainSize = [System.Windows.Forms.TextRenderer]::MeasureText($message, $fonts.Main)
            $infoSize = if ($infoText) { [System.Windows.Forms.TextRenderer]::MeasureText($infoText, $fonts.Info) } else { [System.Drawing.Size]::Empty }
            $gap = if ($infoText) { [int]($fonts.Main.Size / 2) } else { 0 }
            $y = [int](($sender.ClientSize.Height - $mainSize.Height - $gap - $infoSize.Height) / 2)
            [System.Windows.Forms.TextRenderer]::DrawText($e.Graphics, $message, $fonts.Main,
                (New-Object System.Drawing.Rectangle(0, $y, $w, $mainSize.Height)), [System.Drawing.Color]::White, $flags)
            if ($infoText) {
                [System.Windows.Forms.TextRenderer]::DrawText($e.Graphics, $infoText, $fonts.Info,
                    (New-Object System.Drawing.Rectangle(0, ($y + $mainSize.Height + $gap), $w, $infoSize.Height)),
                    [System.Drawing.Color]::Gray, $flags)
            }
        })
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

    foreach ($f in $forms) {
        $f.Show()
        $f.Invalidate()
    }
    $forms[0].Activate()
    [System.Windows.Forms.Cursor]::Hide()
    [System.Windows.Forms.Application]::Run()
} catch {
    # 문제가 생기면 원인을 기록해 둔다
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $($_.Exception.Message)" | Add-Content $logPath -Encoding UTF8
}
