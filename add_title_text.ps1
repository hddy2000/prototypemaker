$ErrorActionPreference = "Stop"
$outputDir = "C:\Users\HP\Pictures\good_morning_poo"
$titleText = "good morning poo"

Add-Type -AssemblyName System.Drawing

function Add-TitleText($imagePath, $titleText) {
    # Read file bytes into memory to avoid file locking
    $fileBytes = [System.IO.File]::ReadAllBytes($imagePath)
    $ms = New-Object System.IO.MemoryStream(,$fileBytes)
    $originalImage = [System.Drawing.Image]::FromStream($ms)
    $bitmap = New-Object System.Drawing.Bitmap($originalImage.Width, $originalImage.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.DrawImage($originalImage, 0, 0, $originalImage.Width, $originalImage.Height)

    $imgW = [float]$originalImage.Width
    $imgH = [float]$originalImage.Height
    $fontSize = [int]($imgH * 0.05)
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

    $stringFormat = New-Object System.Drawing.StringFormat
    $stringFormat.Alignment = [System.Drawing.StringAlignment]::Center
    $stringFormat.LineAlignment = [System.Drawing.StringAlignment]::Near

    # Use explicit float values to avoid PowerShell array unwrapping issues
    $rectX = 0.0
    $rectY = $imgH * 0.03
    $rectW = $imgW
    $rectH = [float]($fontSize * 2)

    $textRect = New-Object System.Drawing.RectangleF($rectX, $rectY, $rectW, $rectH)
    $shadowRect = New-Object System.Drawing.RectangleF(($rectX + 3.0), ($rectY + 3.0), $rectW, $rectH)

    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 0, 0, 0))
    $graphics.DrawString($titleText, $font, $shadowBrush, $shadowRect, $stringFormat)

    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $graphics.DrawString($titleText, $font, $whiteBrush, $textRect, $stringFormat)

    # Save to temp file first, then replace original (avoids GDI+ file lock)
    $tempPath = [System.IO.Path]::GetTempFileName()
    $bitmap.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $graphics.Dispose()
    $bitmap.Dispose()
    $originalImage.Dispose()
    $ms.Dispose()
    $font.Dispose()
    $whiteBrush.Dispose()
    $shadowBrush.Dispose()
    $stringFormat.Dispose()

    # Replace original file
    [System.IO.File]::Delete($imagePath)
    [System.IO.File]::Move($tempPath, $imagePath)
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Adding title text to all images" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

$images = Get-ChildItem -Path $outputDir -Filter "good_morning_poo_*.png" | Sort-Object Name
$successCount = 0
$failCount = 0

foreach ($img in $images) {
    Write-Host "Processing: $($img.Name)" -ForegroundColor Green
    try {
        Add-TitleText $img.FullName $titleText
        Write-Host "  [OK] title added" -ForegroundColor Green
        $successCount++
    } catch {
        Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red
        $failCount++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Done! success: $successCount, fail: $failCount" -ForegroundColor Green
Write-Host "  output: $outputDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Yellow
