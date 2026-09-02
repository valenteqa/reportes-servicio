# Construye la plantilla del reporte a partir del .docx real de referencia.
#
# Corta el documento original en: [inicio..fin del indice] + {{CUERPO}} + [sectPr final],
# tokeniza los datos variables ({{CLIENTE}}, {{FECHA}}, {{FOLIO}}...), agrega filas
# opcionales de Planta y No. de Maquina, poda las fotos del cuerpo y el thumbnail,
# y deja todas las partes en esta carpeta con un manifest.json que la app usa para
# rearmar el ZIP. Los logos, marca de agua, viñetas y estilos quedan intactos.
#
# Ejecutar solo si cambia el formato de referencia:
#   powershell -ExecutionPolicy Bypass -File plantilla/construir.ps1 -Origen "ruta\al\reporte.docx"

param(
  [string]$Origen = ''
)

$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path

# Los literales del Word de referencia (ruta, cliente, planta, marca, modelo,
# serie y tecnico) viven en plantilla/construir.local.ps1, FUERA del repo:
# el repositorio es publico y ningun dato de cliente o persona va en el codigo.
. (Join-Path $aqui 'construir.local.ps1')
if (-not $Origen) { $Origen = $OrigenLocal }
$tmp = Join-Path $env:TEMP ("plantilla-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $tmp | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($Origen, $tmp)

$sinBom = New-Object Text.UTF8Encoding $false
function LeerTxt([string]$ruta) { [IO.File]::ReadAllText($ruta, [Text.Encoding]::UTF8) }
function EscTxt([string]$ruta, [string]$texto) { [IO.File]::WriteAllText($ruta, $texto, $sinBom) }
$RX = [Text.RegularExpressions.RegexOptions]::Singleline

# ------------------------------------------------------------------
# 1. document.xml -> cabeza (hasta cerrar el indice) + {{CUERPO}} + cola (sectPr final)
# ------------------------------------------------------------------
$doc = LeerTxt (Join-Path $tmp 'word\document.xml')

$finSdt = $doc.IndexOf('</w:sdt>')
if ($finSdt -lt 0) { throw 'No se encontro el indice (sdt)' }
$cabeza = $doc.Substring(0, $finSdt + 8)
$iniSect = $doc.LastIndexOf('<w:sectPr')
$cola = $doc.Substring($iniSect)

# Tokens simples (texto contiguo en el original)
$cabeza = $cabeza.Replace($clienteOriginal, '{{CLIENTE}}')
$cabeza = $cabeza.Replace($marcaOriginal, '{{MARCA}}')
$cabeza = $cabeza.Replace($modeloOriginal, '{{MODELO}}')
$cabeza = $cabeza.Replace($serieOriginal, '{{SERIE}}')
$cabeza = $cabeza.Replace($nombreTecnico, '{{TECNICO}}')

# Celdas con texto fragmentado en varios runs: se vacia el primer parrafo de la
# celda y se deja un solo run con el token, conservando tcPr y pPr.
function TokenizarCelda([string]$xml, [string]$marca, [string]$token) {
  $mCelda = [regex]::Match($xml, '<w:tc>(?:(?!</w:tc>).)*' + [regex]::Escape($marca) + '(?:(?!</w:tc>).)*</w:tc>', $RX)
  if (-not $mCelda.Success) { throw "No se encontro la celda con '$marca'" }
  $celda = $mCelda.Value
  # Reemplazar los runs SOLO del primer parrafo (count=1) y conservar los demas
  # parrafos de la celda: descripcion y tecnico pueden compartir celda.
  $rxPar = New-Object Text.RegularExpressions.Regex(
    '(<w:p\b[^>]*>(?:<w:pPr>(?:(?!</w:pPr>).)*</w:pPr>)?).*?(</w:p>)', $RX)
  # El run nuevo lleva la fuente del tema: sin rPr caeria al docDefaults
  # (Times New Roman) y esa celda desentonaria del resto de la tabla.
  $rPr = '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cs="Calibri"/></w:rPr>'
  $nueva = $rxPar.Replace($celda,
    ('$1<w:r>' + $rPr + '<w:t xml:space="preserve">' + $token + '</w:t></w:r>$2'), 1)
  return $xml.Replace($celda, $nueva)
}

$cabeza = TokenizarCelda $cabeza 'de octubre 2024' '{{FECHA}}'
$cabeza = TokenizarCelda $cabeza 'Falla de S' '{{DESCRIPCION}}'

# Indice: que Word lo actualice al abrir
$cabeza = $cabeza.Replace('<w:fldChar w:fldCharType="begin"/>', '<w:fldChar w:fldCharType="begin" w:dirty="true"/>')

# Filas opcionales: se clona la fila de Cliente conservando su formato.
$mFila = [regex]::Match($cabeza, '<w:tr\b(?:(?!</w:tr>).)*\{\{CLIENTE\}\}(?:(?!</w:tr>).)*</w:tr>', $RX)
if (-not $mFila.Success) { throw 'No se encontro la fila de Cliente' }
$filaCliente = $mFila.Value
$filaPlanta = $filaCliente.Replace('Cliente:', 'Planta:').Replace('{{CLIENTE}}', '{{PLANTA}}')
$etiquetaNoMaq = 'No. de M' + [char]0xE1 + 'quina:'
$filaNoMaq  = $filaCliente.Replace('Cliente:', $etiquetaNoMaq).Replace('{{CLIENTE}}', '{{NOMAQUINA}}')
$cabeza = $cabeza.Replace($filaCliente, $filaCliente + $filaPlanta)

$mSerie = [regex]::Match($cabeza, '<w:tr\b(?:(?!</w:tr>).)*\{\{SERIE\}\}(?:(?!</w:tr>).)*</w:tr>', $RX)
if (-not $mSerie.Success) { throw 'No se encontro la fila de Serie' }
$cabeza = $cabeza.Replace($mSerie.Value, $mSerie.Value + $filaNoMaq)

EscTxt (Join-Path $aqui 'doc-plantilla.xml') ($cabeza + '{{CUERPO}}' + $cola)

# ------------------------------------------------------------------
# 2. header2.xml (el del logo): folio y fecha tokenizados
# ------------------------------------------------------------------
$hdr = LeerTxt (Join-Path $tmp 'word\header2.xml')
$hdr = [regex]::Replace($hdr, '<w:t>RCVQ-2</w:t></w:r>.*?<w:t>1024-0</w:t></w:r>', '<w:t>{{FOLIO}}</w:t></w:r>', $RX)
$hdr = [regex]::Replace($hdr, '<w:t>2</w:t></w:r>.*?<w:t xml:space="preserve"> de octubre 2024</w:t></w:r>', '<w:t>{{FECHA}}</w:t></w:r>', $RX)
if ($hdr -notmatch '\{\{FOLIO\}\}' -or $hdr -notmatch '\{\{FECHA\}\}') { throw 'header2: tokens no aplicados' }
EscTxt (Join-Path $aqui 'header2.xml') $hdr

# ------------------------------------------------------------------
# 3. rels podados: fuera las fotos del cuerpo y el thumbnail
# ------------------------------------------------------------------
$relsDoc = LeerTxt (Join-Path $tmp 'word\_rels\document.xml.rels')
$relsDoc = [regex]::Replace($relsDoc, '<Relationship [^>]*Target="media/[^"]*"[^>]*/>', '')
EscTxt (Join-Path $aqui 'document.xml.rels') $relsDoc

$relsRaiz = LeerTxt (Join-Path $tmp '_rels\.rels')
$relsRaiz = [regex]::Replace($relsRaiz, '<Relationship [^>]*thumbnail[^>]*/>', '')
EscTxt (Join-Path $aqui 'rels-raiz.xml') $relsRaiz

# ------------------------------------------------------------------
# 4. Copiar el resto tal cual + manifiesto
# ------------------------------------------------------------------
# [nombre en esta carpeta, ruta dentro del zip, es binario]
$mapa = @(
  @('ct.xml',                '[Content_Types].xml', $false),
  @('rels-raiz.xml',         '_rels/.rels', $false),
  @('core.xml',              'docProps/core.xml', $false),
  @('app-props.xml',         'docProps/app.xml', $false),
  @('cx-item.xml',           'customXml/item1.xml', $false),
  @('cx-props.xml',          'customXml/itemProps1.xml', $false),
  @('cx-rels.xml',           'customXml/_rels/item1.xml.rels', $false),
  @('doc-plantilla.xml',     'word/document.xml', $false),
  @('document.xml.rels',     'word/_rels/document.xml.rels', $false),
  @('styles.xml',            'word/styles.xml', $false),
  @('numbering.xml',         'word/numbering.xml', $false),
  @('numbering.xml.rels',    'word/_rels/numbering.xml.rels', $false),
  @('settings.xml',          'word/settings.xml', $false),
  @('webSettings.xml',       'word/webSettings.xml', $false),
  @('fontTable.xml',         'word/fontTable.xml', $false),
  @('endnotes.xml',          'word/endnotes.xml', $false),
  @('footnotes.xml',         'word/footnotes.xml', $false),
  @('theme1.xml',            'word/theme/theme1.xml', $false),
  @('header1.xml',           'word/header1.xml', $false),
  @('header2.xml',           'word/header2.xml', $false),
  @('header2.xml.rels',      'word/_rels/header2.xml.rels', $false),
  @('header3.xml',           'word/header3.xml', $false),
  @('footer1.xml',           'word/footer1.xml', $false),
  @('footer2.xml',           'word/footer2.xml', $false),
  @('footer3.xml',           'word/footer3.xml', $false),
  @('vineta.png',            'word/media/image1.png', $true),
  @('logo14.png',            'word/media/image14.png', $true),
  @('logo15.jpeg',           'word/media/image15.jpeg', $true),
  @('logo16.png',            'word/media/image16.png', $true)
)

$copias = @{
  'ct.xml' = '[Content_Types].xml'; 'core.xml' = 'docProps\core.xml'; 'app-props.xml' = 'docProps\app.xml';
  'cx-item.xml' = 'customXml\item1.xml'; 'cx-props.xml' = 'customXml\itemProps1.xml'; 'cx-rels.xml' = 'customXml\_rels\item1.xml.rels';
  'styles.xml' = 'word\styles.xml'; 'numbering.xml' = 'word\numbering.xml'; 'numbering.xml.rels' = 'word\_rels\numbering.xml.rels';
  'settings.xml' = 'word\settings.xml'; 'webSettings.xml' = 'word\webSettings.xml'; 'fontTable.xml' = 'word\fontTable.xml';
  'endnotes.xml' = 'word\endnotes.xml'; 'footnotes.xml' = 'word\footnotes.xml'; 'theme1.xml' = 'word\theme\theme1.xml';
  'header1.xml' = 'word\header1.xml'; 'header2.xml.rels' = 'word\_rels\header2.xml.rels'; 'header3.xml' = 'word\header3.xml';
  'footer1.xml' = 'word\footer1.xml'; 'footer2.xml' = 'word\footer2.xml'; 'footer3.xml' = 'word\footer3.xml';
  'vineta.png' = 'word\media\image1.png'; 'logo14.png' = 'word\media\image14.png';
  'logo15.jpeg' = 'word\media\image15.jpeg'; 'logo16.png' = 'word\media\image16.png'
}
foreach ($destino in $copias.Keys) {
  Copy-Item -LiteralPath (Join-Path $tmp $copias[$destino]) -Destination (Join-Path $aqui $destino) -Force
}

$manifest = $mapa | ForEach-Object { @{ archivo = $_[0]; zip = $_[1]; binario = $_[2] } }
EscTxt (Join-Path $aqui 'manifest.json') (ConvertTo-Json $manifest -Compress)

Remove-Item -Recurse -Force $tmp
"Plantilla construida en $aqui"
"Partes: $($mapa.Count)"
"Tokens en doc-plantilla: " + (([regex]::Matches((LeerTxt (Join-Path $aqui 'doc-plantilla.xml')), '\{\{[A-Z]+\}\}') | ForEach-Object { $_.Value }) -join ' ')
