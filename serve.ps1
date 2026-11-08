# Petit serveur statique local pour tester Façade solaire (aucune dépendance).
# Usage : powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080] [-NoBrowser]
# Si le port est déjà utilisé, le script essaie automatiquement les suivants.
param([int]$Port = 8080, [switch]$NoBrowser)
$root = $PSScriptRoot
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break }
  catch { $l.Close() }
}
if (-not $listener) { Write-Host "Aucun port libre entre $Port et $($Port + 19)."; exit 1 }
$url = "http://localhost:$Port/"
Write-Host "Structura : $url  (Ctrl+C pour arreter)"
if (-not $NoBrowser) { Start-Process $url }
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8';
            '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon' }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($path -eq '') { $path = 'index.html' }
  $full = [IO.Path]::GetFullPath((Join-Path $root $path))
  if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($full)
    $ext = [IO.Path]::GetExtension($full).ToLower()
    $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
