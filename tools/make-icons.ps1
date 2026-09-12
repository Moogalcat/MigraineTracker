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

    # Background: solid charcoal, matching the app's quiet logbook palette.
    $rect  = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $brush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(255, 37, 42, 44))

    if ($radiusFrac -gt 0) {
        $path = New-RoundedPath 0 0 $size $size ([single]($size * $radiusFrac))
        $g.FillPath($brush, $path)
        $path.Dispose()
    } else {
        $g.FillRectangle($brush, $rect)
    }

    # Glyph: a small paper log with an accent spine and three written lines.
    $cx = $size / 2.0
    $cy = $size / 2.0
    $u  = ($size * $contentFrac) / 2.0
    $paperX = [single]($cx - $u * 0.72)
    $paperY = [single]($cy - $u * 0.88)
    $paperW = [single]($u * 1.44)
    $paperH = [single]($u * 1.76)
    $paperPath = New-RoundedPath $paperX $paperY $paperW $paperH ([single]($u * 0.10))
    $paperBrush = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(255, 226, 224, 218))
    $g.FillPath($paperBrush, $paperPath)

    $accentPen = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(255, 111, 135, 144), [single]($u * 0.12))
    $accentPen.StartCap = 'Round'; $accentPen.EndCap = 'Round'
    $spineX = [single]($paperX + $u * 0.32)
    $g.DrawLine($accentPen, $spineX, [single]($paperY + $u * 0.22),
                            $spineX, [single]($paperY + $paperH - $u * 0.22))

    $inkPen = New-Object System.Drawing.Pen(
        [System.Drawing.Color]::FromArgb(255, 73, 79, 77), [single]($u * 0.075))
    $inkPen.StartCap = 'Round'; $inkPen.EndCap = 'Round'
    $lineX = [single]($paperX + $u * 0.55)
    $lineEnd = [single]($paperX + $paperW - $u * 0.22)
    foreach ($offset in @(-0.42, 0.0, 0.42)) {
        $lineY = [single]($cy + $u * $offset)
        $g.DrawLine($inkPen, $lineX, $lineY, $lineEnd, $lineY)
    }

    $out = Join-Path $outDir $file
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

    $inkPen.Dispose(); $accentPen.Dispose(); $paperBrush.Dispose(); $paperPath.Dispose()
    $brush.Dispose(); $g.Dispose(); $bmp.Dispose()
    Write-Output ("{0}  {1}x{1}" -f $file, $size)
}

Write-Icon 'icon-192.png'           192 0.22 0.66
Write-Icon 'icon-512.png'           512 0.22 0.66
Write-Icon 'icon-maskable-512.png'  512 0.00 0.52   # padded for Android masking
Write-Icon 'apple-touch-icon.png'   180 0.00 0.64   # iOS applies its own mask
