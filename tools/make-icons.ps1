Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x,           $y,           $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y,           $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d,   0, 90)
    $p.AddArc($x,           $y + $h - $d, $d, $d,  90, 90)
    $p.CloseFigure()
    return $p
}

# size    = pixel dimensions
# radius  = corner rounding as a fraction of size (0 = square, full bleed)
# content = glyph diameter as a fraction of size (smaller = more padding)
function Write-Icon([string]$file, [int]$size, [double]$radiusFrac, [double]$contentFrac) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode   = 'HighQuality'

    # Background: deep indigo to violet, top-left to bottom-right.
    $rect  = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $from  = [System.Drawing.Color]::FromArgb(255, 58, 30, 112)
    $to    = [System.Drawing.Color]::FromArgb(255, 124, 62, 214)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $from, $to, 45.0)

    if ($radiusFrac -gt 0) {
        $path = New-RoundedPath 0 0 $size $size ([single]($size * $radiusFrac))
        $g.FillPath($brush, $path)
        $path.Dispose()
    } else {
        $g.FillRectangle($brush, $rect)
    }

    # Glyph: a centred dot ringed by fading arcs - a migraine aura / throb.
    $cx = $size / 2.0
    $cy = $size / 2.0
    $u  = ($size * $contentFrac) / 2.0     # content radius

    $dotR = $u * 0.17
    $white = [System.Drawing.Color]::White
    $dotBrush = New-Object System.Drawing.SolidBrush($white)
    $g.FillEllipse($dotBrush, [single]($cx - $dotR), [single]($cy - $dotR),
                              [single]($dotR * 2), [single]($dotR * 2))

    $ringRadii  = @(0.42, 0.68, 0.94)
    $ringAlphas = @(255, 198, 132)
    $penW = [single]($u * 0.115)

    for ($i = 0; $i -lt 3; $i++) {
        $r = $u * $ringRadii[$i]
        $pen = New-Object System.Drawing.Pen(
            [System.Drawing.Color]::FromArgb($ringAlphas[$i], 255, 255, 255), $penW)
        $pen.StartCap = 'Round'
        $pen.EndCap   = 'Round'
        $box = New-Object System.Drawing.RectangleF(
            [single]($cx - $r), [single]($cy - $r), [single]($r * 2), [single]($r * 2))
        # Two mirrored arcs, leaving gaps at 12 and 6 o'clock.
        $g.DrawArc($pen, $box, 285, 150)
        $g.DrawArc($pen, $box, 105, 150)
        $pen.Dispose()
    }

    $out = Join-Path $outDir $file
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

    $dotBrush.Dispose(); $brush.Dispose(); $g.Dispose(); $bmp.Dispose()
    Write-Output ("{0}  {1}x{1}" -f $file, $size)
}

Write-Icon 'icon-192.png'           192 0.22 0.66
Write-Icon 'icon-512.png'           512 0.22 0.66
Write-Icon 'icon-maskable-512.png'  512 0.00 0.52   # padded for Android masking
Write-Icon 'apple-touch-icon.png'   180 0.00 0.64   # iOS applies its own mask
