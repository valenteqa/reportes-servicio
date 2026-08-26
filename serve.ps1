# Servidor estatico minimo para desarrollo local.
# No requiere Node ni Python. Uso:  powershell -ExecutionPolicy Bypass -File serve.ps1
param([int]$Port = 8123)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  '.html'        = 'text/html; charset=utf-8'
  '.css'         = 'text/css; charset=utf-8'
  '.js'          = 'text/javascript; charset=utf-8'
  '.mjs'         = 'text/javascript; charset=utf-8'
  '.json'        = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.png'         = 'image/png'
  '.jpg'         = 'image/jpeg'
  '.jpeg'        = 'image/jpeg'
  '.svg'         = 'image/svg+xml'
  '.ico'         = 'image/x-icon'
  '.docx'        = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

function Send-Response {
  param($Stream, [int]$Code, [string]$Status, [string]$ContentType, [byte[]]$Body)
  $head = "HTTP/1.1 $Code $Status`r`n" +
          "Content-Type: $ContentType`r`n" +
          "Content-Length: $($Body.Length)`r`n" +
          "Cache-Control: no-store`r`n" +
          "Service-Worker-Allowed: /`r`n" +
          "Connection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($hb, 0, $hb.Length)
  if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
  $Stream.Flush()
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "App Reportes -> http://127.0.0.1:$Port/"
Write-Host "Raiz: $Root"
Write-Host "Ctrl+C para detener."

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 15000
    $stream = $client.GetStream()

    $buf = New-Object byte[] 16384
    $read = $stream.Read($buf, 0, $buf.Length)
    if ($read -le 0) { $client.Close(); continue }

    $req   = [System.Text.Encoding]::ASCII.GetString($buf, 0, $read)
    $line  = ($req -split "`r`n")[0]
    $parts = $line -split ' '
    $verb  = $parts[0]
    $url   = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
    $path  = ($url -split '\?')[0]

    if ($verb -ne 'GET' -and $verb -ne 'HEAD') {
      Send-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('Solo GET'))
      $client.Close(); continue
    }

    $rel = [System.Uri]::UnescapeDataString($path).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $rel = $rel -replace '/', '\'

    $full = Join-Path $Root $rel
    try { $resolved = (Resolve-Path -LiteralPath $full -ErrorAction Stop).Path }
    catch { $resolved = $null }

    # Guardia contra path traversal
    if ($resolved -and -not $resolved.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
      $resolved = $null
    }

    if ($resolved -and (Test-Path -LiteralPath $resolved -PathType Leaf)) {
      $ext  = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
      $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $body = [System.IO.File]::ReadAllBytes($resolved)
      Write-Host ("  200  " + $path)
      Send-Response $stream 200 'OK' $type $body
    } else {
      Write-Host ("  404  " + $path)
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 - no encontrado: $path")
      Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' $body
    }
  } catch {
    Write-Host ("  ERR  " + $_.Exception.Message)
  } finally {
    try { $client.Close() } catch {}
  }
}
