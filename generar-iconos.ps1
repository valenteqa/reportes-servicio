# Genera los iconos PNG de la app usando System.Drawing (viene con Windows).
# Ejecutar solo si se cambia el diseño:  powershell -ExecutionPolicy Bypass -File generar-iconos.ps1

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$dir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'icons'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

function New-RoundedPath {
  param([single]$x, [single]$y, [single]$w, [single]$h, [single]$r)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x,          $y,          $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y,          $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d,   0, 90)
  $p.AddArc($x,          $y + $h - $d, $d, $d,  90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icono {
  param([int]$Tamano, [string]$Archivo, [double]$Escala = 0.62, [bool]$FondoCompleto = $false)

  $bmp = New-Object System.Drawing.Bitmap($Tamano, $Tamano)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $azul   = [System.Drawing.ColorTranslator]::FromHtml('#0d3b66')
  $azul2  = [System.Drawing.ColorTranslator]::FromHtml('#1257a0')
  $blanco = [System.Drawing.Color]::White
  $gris   = [System.Drawing.ColorTranslator]::FromHtml('#94a7ba')
  $ambar  = [System.Drawing.ColorTranslator]::FromHtml('#e8a33d')

  # Fondo con degradado sutil
  $rectTodo = New-Object System.Drawing.Rectangle(0, 0, $Tamano, $Tamano)
  $brochaFondo = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      $rectTodo, $azul2, $azul, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)

  if ($FondoCompleto) {
    $g.FillRectangle($brochaFondo, $rectTodo)
  } else {
    $radio = [single]($Tamano * 0.22)
    $fondo = New-RoundedPath 0 0 ([single]$Tamano) ([single]$Tamano) $radio
    $g.FillPath($brochaFondo, $fondo)
    $fondo.Dispose()
  }

  # Hoja de reporte, centrada
  $hojaW = [single]($Tamano * $Escala)
  $hojaH = [single]($hojaW * 1.24)
  if ($hojaH -gt $Tamano * $Escala * 1.35) { $hojaH = [single]($Tamano * $Escala * 1.35) }
  $hx = [single](($Tamano - $hojaW) / 2)
  $hy = [single](($Tamano - $hojaH) / 2)
  $rHoja = [single]($hojaW * 0.09)

  # Sombra
  $sombra = New-RoundedPath ($hx + $Tamano*0.012) ($hy + $Tamano*0.016) $hojaW $hojaH $rHoja
  $brochaSombra = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(48, 0, 0, 0))
  $g.FillPath($brochaSombra, $sombra)

  $hoja = New-RoundedPath $hx $hy $hojaW $hojaH $rHoja
  $g.FillPath((New-Object System.Drawing.SolidBrush($blanco)), $hoja)

  # Renglones del reporte
  $margen = [single]($hojaW * 0.15)
  $altoLinea = [single]($hojaH * 0.062)
  $sep = [single]($hojaH * 0.135)
  $y = [single]($hy + $hojaH * 0.20)

  $anchos = @(0.70, 0.55, 0.62)
  foreach ($a in $anchos) {
    $r = New-RoundedPath ($hx + $margen) $y ([single]($hojaW * $a)) $altoLinea ([single]($altoLinea/2))
    $g.FillPath((New-Object System.Drawing.SolidBrush($gris)), $r)
    $r.Dispose()
    $y = [single]($y + $sep)
  }

  # Barra ambar: el dato medido
  $rA = New-RoundedPath ($hx + $margen) $y ([single]($hojaW * 0.40)) $altoLinea ([single]($altoLinea/2))
  $g.FillPath((New-Object System.Drawing.SolidBrush($ambar)), $rA)
  $rA.Dispose()

  # Marca de verificacion en la esquina inferior derecha
  $cD = [single]($hojaW * 0.42)
  $cx = [single]($hx + $hojaW - $cD * 0.62)
  $cy = [single]($hy + $hojaH - $cD * 0.62)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($blanco)), $cx - $cD/2 - $Tamano*0.012, $cy - $cD/2 - $Tamano*0.012, $cD + $Tamano*0.024, $cD + $Tamano*0.024)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($azul2)), $cx - $cD/2, $cy - $cD/2, $cD, $cD)

  $lapiz = New-Object System.Drawing.Pen($blanco, [single]($cD * 0.155))
  $lapiz.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $lapiz.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $lapiz.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $puntos = @(
    (New-Object System.Drawing.PointF([single]($cx - $cD*0.21), [single]($cy + $cD*0.02))),
    (New-Object System.Drawing.PointF([single]($cx - $cD*0.05), [single]($cy + $cD*0.17))),
    (New-Object System.Drawing.PointF([single]($cx + $cD*0.22), [single]($cy - $cD*0.18)))
  )
  $g.DrawLines($lapiz, $puntos)

  $g.Dispose()
  $ruta = Join-Path $dir $Archivo
  $bmp.Save($ruta, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  generado  $Archivo  ($Tamano x $Tamano)"
}

Write-Host "Generando iconos en $dir"
New-Icono -Tamano 192 -Archivo 'icono-192.png' -Escala 0.62
New-Icono -Tamano 512 -Archivo 'icono-512.png' -Escala 0.62
# Maskable: Android recorta hasta un circulo; el contenido va mas chico y a sangre.
New-Icono -Tamano 512 -Archivo 'icono-maskable-512.png' -Escala 0.46 -FondoCompleto $true
Write-Host "Listo."
