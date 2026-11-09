# Rasterize the music-note mark used in the app for iOS and the web manifest.
Add-Type -AssemblyName System.Drawing
$iconBitmap = New-Object System.Drawing.Bitmap 512, 512
$iconGraphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
$iconGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$iconBounds = New-Object System.Drawing.Rectangle 0, 0, 512, 512
$iconGradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush $iconBounds, ([System.Drawing.ColorTranslator]::FromHtml('#ff6585')), ([System.Drawing.ColorTranslator]::FromHtml('#e51e49')), 90
$iconGraphics.FillRectangle($iconGradient, $iconBounds)
$iconGraphics.TranslateTransform(40, 40)
$iconGraphics.ScaleTransform(18, 18)
$iconPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$iconPoints = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(8, 5), [System.Drawing.PointF]::new(21, 3),
    [System.Drawing.PointF]::new(21, 16), [System.Drawing.PointF]::new(19, 16),
    [System.Drawing.PointF]::new(19, 7), [System.Drawing.PointF]::new(10, 8.4),
    [System.Drawing.PointF]::new(10, 18), [System.Drawing.PointF]::new(8, 18)
)
$iconPath.AddPolygon($iconPoints)
$iconGraphics.FillPath([System.Drawing.Brushes]::White, $iconPath)
$iconGraphics.FillEllipse([System.Drawing.Brushes]::White, 3, 15, 7, 6)
$iconGraphics.FillEllipse([System.Drawing.Brushes]::White, 14, 13, 7, 6)
$iconBitmap.Save((Join-Path $PSScriptRoot 'music-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$touchBitmap = New-Object System.Drawing.Bitmap 180, 180
$touchGraphics = [System.Drawing.Graphics]::FromImage($touchBitmap)
$touchGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$touchGraphics.DrawImage($iconBitmap, 0, 0, 180, 180)
$touchBitmap.Save((Join-Path $PSScriptRoot 'apple-touch-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$touchGraphics.Dispose()
$touchBitmap.Dispose()
$iconPath.Dispose()
$iconGradient.Dispose()
$iconGraphics.Dispose()
$iconBitmap.Dispose()
