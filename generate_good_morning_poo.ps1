$ErrorActionPreference = "Stop"
$outputDir = "C:\Users\HP\Pictures\good_morning_poo"
if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
Write-Host "output: $outputDir" -ForegroundColor Cyan

$basePrompt = "1girl, solo, full body, side view, from side, sitting on toilet, bottomless, pants down, black sweater, upper body clothed, lower body nude, barefoot, bare legs, navel, stomach, ass, buttocks, toilet, toilet paper, bathroom, morning, soft morning light, indoors, realistic, very aesthetic, masterpiece, best quality, ultra-detailed, miaoka, high contrast, huge filesize"

$negativePrompt = "extra toes, lowres, (bad), text, error, fewer, extra, missing, worst quality, jpeg artifacts, low quality, watermark, unfinished, displeasing, oldest, early, signature, artistic error, username, bad feet, scan, [abstract], english text, shiny hair, (bad anatomy:1.3), (three legs:1.9), (three arms:1.9), bad hands, (worst quality:1.4), (low quality), (simple background:1.2), (multiple panties:1.4), url, border, artist signature, patreon, low detail, sketch, vignette"

$hairVariations = @(
    @{ name = "01_long_black_straight"; prompt = "long black hair, straight hair, hair down" },
    @{ name = "02_blonde_twin_tails"; prompt = "blonde hair, twintails, hair ribbons" },
    @{ name = "03_silver_short_bob"; prompt = "silver hair, short hair, bob cut, blunt bangs" },
    @{ name = "04_pink_wavy_long"; prompt = "pink hair, wavy hair, long hair, side swept bangs" },
    @{ name = "05_blue_ponytail"; prompt = "blue hair, ponytail, long hair, hair tie" },
    @{ name = "06_red_messy"; prompt = "red hair, messy hair, bedhead, medium length" },
    @{ name = "07_purple_braid"; prompt = "purple hair, single braid, long hair, braided" },
    @{ name = "08_green_hime_cut"; prompt = "green hair, hime cut, long hair, straight bangs" },
    @{ name = "09_orange_fluffy"; prompt = "orange hair, fluffy hair, curly hair, short" },
    @{ name = "10_brown_curly"; prompt = "brown hair, curly hair, long hair, loose curls" }
)

$steps = 30
$cfgScale = 5.0
$sampler = "Euler a"
$width = 768
$height = 1280

function Add-TitleText($imagePath, $titleText) {
    Add-Type -AssemblyName System.Drawing
    $originalImage = [System.Drawing.Image]::FromFile($imagePath)
    $bitmap = New-Object System.Drawing.Bitmap($originalImage.Width, $originalImage.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.DrawImage($originalImage, 0, 0, $originalImage.Width, $originalImage.Height)
    $fontSize = [int]($originalImage.Height * 0.05)
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $stringFormat = New-Object System.Drawing.StringFormat
    $stringFormat.Alignment = [System.Drawing.StringAlignment]::Center
    $stringFormat.LineAlignment = [System.Drawing.StringAlignment]::Near
    $textRect = New-Object System.Drawing.RectangleF(0, [float]($originalImage.Height * 0.03), [float]$originalImage.Width, [float]($fontSize * 2))
    $shadowRect = New-Object System.Drawing.RectangleF($textRect.X + 3, $textRect.Y + 3, $textRect.Width, $textRect.Height)
    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 0, 0, 0))
    $graphics.DrawString($titleText, $font, $shadowBrush, $shadowRect, $stringFormat)
    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $graphics.DrawString($titleText, $font, $whiteBrush, $textRect, $stringFormat)
    $bitmap.Save($imagePath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $bitmap.Dispose()
    $originalImage.Dispose()
    $font.Dispose()
    $whiteBrush.Dispose()
    $shadowBrush.Dispose()
    $stringFormat.Dispose()
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  good morning poo - 10 images" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

$successCount = 0
$failCount = 0

for ($i = 0; $i -lt $hairVariations.Count; $i++) {
    $variation = $hairVariations[$i]
    $fullPrompt = "$($variation.prompt), $basePrompt"
    $seed = Get-Random -Minimum 1000000000 -Maximum 9999999999
    $fileName = "good_morning_poo_$($variation.name).png"
    $filePath = Join-Path $outputDir $fileName

    Write-Host "[$($i+1)/10] $($variation.name)" -ForegroundColor Green
    Write-Host "  seed: $seed, size: ${width}x${height}"

    $requestObj = @{
        prompt            = $fullPrompt
        negative_prompt   = $negativePrompt
        steps             = $steps
        cfg_scale         = $cfgScale
        sampler_name      = $sampler
        width             = $width
        height            = $height
        seed              = $seed
        batch_size        = 1
        n_iter            = 1
        restore_faces     = $false
        tiling            = $false
        send_seed         = $true
        override_settings = @{ CLIP_stop_at_last_layers = 2 }
    }
    $requestBody = $requestObj | ConvertTo-Json -Depth 5

    try {
        Write-Host "  generating..." -ForegroundColor DarkGray
        $startTime = Get-Date
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:7860/sdapi/v1/txt2img" -Method POST -Body $requestBody -ContentType "application/json" -TimeoutSec 300
        $elapsed = (Get-Date) - $startTime
        Write-Host "  time: $($elapsed.TotalSeconds.ToString('F1'))s" -ForegroundColor DarkGray

        if ($response.images -and $response.images.Count -gt 0) {
            $imageData = $response.images[0]
            [System.IO.File]::WriteAllBytes($filePath, [System.Convert]::FromBase64String($imageData))
            Write-Host "  saved: $filePath" -ForegroundColor Cyan
            Write-Host "  adding title..." -ForegroundColor DarkGray
            Add-TitleText $filePath "good morning poo"
            Write-Host "  [OK]" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "  [FAIL] no image data" -ForegroundColor Red
            $failCount++
        }
    } catch {
        Write-Host "  [FAIL] $($_.Exception.Message)" -ForegroundColor Red
        $failCount++
    }
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  done! success: $successCount / 10" -ForegroundColor Green
Write-Host "  output: $outputDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Get-ChildItem -Path $outputDir -Filter "good_morning_poo_*.png" | ForEach-Object { Write-Host "  $($_.Name) - $([math]::Round($_.Length/1KB, 1)) KB" }
