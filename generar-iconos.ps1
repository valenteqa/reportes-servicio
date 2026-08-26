# Genera los iconos PNG de la app usando System.Drawing (viene con Windows).
# Diseño v2: carbon oscuro, documento con esquina cortada, cian electrico.
# Ejecutar solo si se cambia el diseño:  powershell -ExecutionPolicy Bypass -File generar-iconos.ps1

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$dir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'icons'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

function New-Icono {
  param([int]$Tamano, [string]$Archivo, [double]$Escala)

  $bmp = New-Object System.Drawing.Bitmap($Tamano, $Tamano)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $fondoA = [System.Drawing.ColorTranslator]::FromHtml('#101823')
  $fondoB = [System.Drawing.ColorTranslator]::FromHtml('#06080d')
  $panel  = [System.Drawing.ColorTranslator]::FromHtml('#0e1826')
  $cian   = [System.Drawing.ColorTranslator]::FromHtml('#35e0f2')
  $acero  = [System.Drawing.ColorTranslator]::FromHtml('#8fa8bd')
  $ambar  = [System.Drawing.ColorTranslator]::FromHtml('#f2b63c')
  $oscuro = [System.Drawing.ColorTranslator]::FromHtml('#041418')

  # Fondo: degradado carbon, esquinas rectas (a sangre)
  $rectTodo = New-Object System.Drawing.Rectangle(0, 0, $Tamano, $Tamano)
  $brochaFondo = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      $rectTodo, $fondoA, $fondoB, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
  $g.FillRectangle($brochaFondo, $rectTodo)

  # Documento con esquina superior derecha cortada
  $w = [single]($Tamano * $Escala)
  $h = [single]($w * 1.22)
  $x = [single](($Tamano - $w) / 2)
  $y = [single](($Tamano - $h) / 2)
  $corte = [single]($w * 0.2)

  $doc = @(
    (New-Object System.Drawing.PointF($x, $y)),
    (New-Object System.Drawing.PointF(($x + $w - $corte), $y)),
    (New-Object System.Drawing.PointF(($x + $w), ($y + $corte))),
    (New-Object System.Drawing.PointF(($x + $w), ($y + $h))),
    (New-Object System.Drawing.PointF($x, ($y + $h)))
  )
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($panel)), $doc)
  $plumaDoc = New-Object System.Drawing.Pen($cian, [single]([Math]::Max(3, $Tamano * 0.016)))
  $plumaDoc.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
  $g.DrawPolygon($plumaDoc, $doc)

  # Renglones: tres de acero y uno ambar (el dato medido)
  $margen = [single]($w * 0.16)
  $altoL  = [single]($h * 0.055)
  $sep    = [single]($h * 0.125)
  $yl     = [single]($y + $h * 0.2)

  foreach ($a in @(0.62, 0.5, 0.56)) {
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($acero)),
      ($x + $margen), $yl, [single]($w * $a), $altoL)
    $yl = [single]($yl + $sep)
  }
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($ambar)),
    ($x + $margen), $yl, [single]($w * 0.38), $altoL)

  # Insignia: cuadrado cian con palomita, esquina inferior derecha
  $lado = [single]($w * 0.36)
  $bx = [single]($x + $w - $lado * 0.62)
  $by = [single]($y + $h - $lado * 0.62)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($oscuro)),
    ($bx - $lado/2 - $Tamano*0.012), ($by - $lado/2 - $Tamano*0.012),
    ($lado + $Tamano*0.024), ($lado + $Tamano*0.024))
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($cian)),
    ($bx - $lado/2), ($by - $lado/2), $lado, $lado)

  $plumaCheck = New-Object System.Drawing.Pen($oscuro, [single]($lado * 0.17))
  $plumaCheck.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $plumaCheck.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $plumaCheck.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $puntos = @(
    (New-Object System.Drawing.PointF([single]($bx - $lado*0.21), [single]($by + $lado*0.02))),
    (New-Object System.Drawing.PointF([single]($bx - $lado*0.05), [single]($by + $lado*0.17))),
    (New-Object System.Drawing.PointF([single]($bx + $lado*0.22), [single]($by - $lado*0.18)))
  )
  $g.DrawLines($plumaCheck, $puntos)

  $g.Dispose()
  $ruta = Join-Path $dir $Archivo
  $bmp.Save($ruta, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  generado  $Archivo  ($Tamano x $Tamano)"
}

Write-Host "Generando iconos en $dir"
New-Icono -Tamano 192 -Archivo 'icono-192.png' -Escala 0.6
New-Icono -Tamano 512 -Archivo 'icono-512.png' -Escala 0.6
# Maskable: Android recorta hasta un circulo; el contenido va mas chico.
New-Icono -Tamano 512 -Archivo 'icono-maskable-512.png' -Escala 0.44
Write-Host "Listo."
