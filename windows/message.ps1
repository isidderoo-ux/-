# 모든 모니터를 안내 화면(이미지 및/또는 문구)으로 덮는다 (screen_on.ps1 이 실행되면 닫힘)
# 관리자가 직접 닫으려면 Ctrl + Shift + Q
# 문구/글자 크기/이미지는 같은 폴더의 settings.json (설정 창에서 저장)
param([string]$Info = "")
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $dir "message.log"

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $settings = [pscustomobject]@{ Message = "지금은 인증시간이 아닙니다"; Size = 100; ShowInfo = $true; ShowMessage = $true; Image = "" }
    $settingsPath = Join-Path $dir "settings.json"
    if (Test-Path $settingsPath) {
        $saved = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $saved.PSObject.Properties) { $settings.($p.Name) = $p.Value }
    }
    $message = if ($settings.ShowMessage) { "$($settings.Message)".Trim() } else { "" }
    $infoText = if ($Info -and $settings.ShowInfo) { "인증 시간: $Info" } else { "" }

    # 이미지는 파일을 잠그지 않도록 메모리로 읽어 온다
    $image = $null
    if ($settings.Image) {
        $imagePath = Join-Path $dir $settings.Image
        if (Test-Path $imagePath) {
            $stream = New-Object System.IO.MemoryStream(, [System.IO.File]::ReadAllBytes($imagePath))
            $loaded = [System.Drawing.Image]::FromStream($stream)
            $image = New-Object System.Drawing.Bitmap($loaded)
            $loaded.Dispose(); $stream.Dispose()
        }
    }
    if (-not $image -and -not $message -and -not $infoText) { $message = "지금은 인증시간이 아닙니다" }

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
            if (-not $message -or $size -le 12 -or
                [System.Windows.Forms.TextRenderer]::MeasureText($message, $mainFont).Width -le $b.Width * 0.92) { break }
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

        $f.Add_Paint({
            param($sender, $e)
            $g = $e.Graphics
            $fonts = $sender.Tag
            $w = $sender.ClientSize.Width
            $h = $sender.ClientSize.Height

            # 이미지는 비율을 유지한 채 화면에 꽉 차게(잘리지 않게) 가운데 배치
            if ($image) {
                $scale = [Math]::Min($w / $image.Width, $h / $image.Height)
                $iw = [int]($image.Width * $scale)
                $ih = [int]($image.Height * $scale)
                $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $g.DrawImage($image, [int](($w - $iw) / 2), [int](($h - $ih) / 2), $iw, $ih)
            }
            if (-not $message -and -not $infoText) { return }

            $flags = [System.Windows.Forms.TextFormatFlags]::HorizontalCenter
            $mainSize = if ($message) { [System.Windows.Forms.TextRenderer]::MeasureText($message, $fonts.Main) } else { [System.Drawing.Size]::Empty }
            $infoSize = if ($infoText) { [System.Windows.Forms.TextRenderer]::MeasureText($infoText, $fonts.Info) } else { [System.Drawing.Size]::Empty }
            $gap = if ($message -and $infoText) { [int]($fonts.Main.Size / 2) } else { 0 }
            $total = $mainSize.Height + $gap + $infoSize.Height
            $y = [int](($h - $total) / 2)

            # 이미지 위에서는 글자가 잘 보이도록 반투명 띠를 깐다
            if ($image) {
                $pad = [int]($fonts.Main.Size / 2)
                $band = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(160, 0, 0, 0))
                $g.FillRectangle($band, 0, $y - $pad, $w, $total + $pad * 2)
                $band.Dispose()
            }
            if ($message) {
                [System.Windows.Forms.TextRenderer]::DrawText($g, $message, $fonts.Main,
                    (New-Object System.Drawing.Rectangle(0, $y, $w, $mainSize.Height)), [System.Drawing.Color]::White, $flags)
            }
            if ($infoText) {
                $infoColor = if ($image) { [System.Drawing.Color]::Gainsboro } else { [System.Drawing.Color]::Gray }
                [System.Windows.Forms.TextRenderer]::DrawText($g, $infoText, $fonts.Info,
                    (New-Object System.Drawing.Rectangle(0, ($y + $mainSize.Height + $gap), $w, $infoSize.Height)),
                    $infoColor, $flags)
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
