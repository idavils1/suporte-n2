# Servidor de testes do Cadeias V6 / V12 (só para este computador; não vai para o Firebase).
# Antes: suba o Emulador do Firestore (porta 8085) e rode  node sites\cadeias-testes\preparar-emulador.mjs
# Uso:   powershell -ExecutionPolicy Bypass -File sites\cadeias-testes\servidor.ps1
# Abra:  http://localhost:8125/?quem=lays             (administradora)
#        http://127.0.0.1:8125/?quem=anon:pc-maria    (navegador da equipe: outro endereço = outro localStorage)
# A página é o index.html real com a nuvem de teste (nuvem-emulador.js): SDK real do Firestore + regras de verdade no Emulador.
param([int]$Porta = 8125)

$raizSite = Resolve-Path (Join-Path $PSScriptRoot "..\cadeias")
$raizTeste = $PSScriptRoot
$tipos = @{ ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".svg" = "image/svg+xml"; ".json" = "application/json; charset=utf-8"; ".xlsx" = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }

$ouvinte = New-Object System.Net.HttpListener
$ouvinte.Prefixes.Add("http://localhost:$Porta/")
$ouvinte.Prefixes.Add("http://127.0.0.1:$Porta/")
$ouvinte.Start()
Write-Host "Cadeias V6 / V12 (teste) em http://localhost:$Porta/?quem=lays e http://127.0.0.1:$Porta/?quem=anon:pc-maria"

function Responder($ctx, [int]$status, [string]$tipo, [byte[]]$corpo) {
  $r = $ctx.Response
  $r.StatusCode = $status
  $r.ContentType = $tipo
  $r.Headers.Add("Cache-Control", "no-store")
  $r.ContentLength64 = $corpo.Length
  $r.OutputStream.Write($corpo, 0, $corpo.Length)
  $r.OutputStream.Close()
}
$utf8 = New-Object System.Text.UTF8Encoding($false)

while ($ouvinte.IsListening) {
  $ctx = $ouvinte.GetContext()
  try {
    $caminho = $ctx.Request.Url.AbsolutePath
    if ($caminho -eq "/" -or $caminho -eq "/index.html") {
      $html = [System.IO.File]::ReadAllText((Join-Path $raizSite "index.html"), $utf8)
      $html = $html.Replace('<script type="module" src="assets/app.js">', '<script src="/teste/nuvem-emulador.js"></script><script type="module" src="assets/app.js">')
      Responder $ctx 200 $tipos[".html"] $utf8.GetBytes($html)
      continue
    }
    $base = if ($caminho.StartsWith("/teste/")) { $raizTeste; $caminho = $caminho.Substring(6) } else { $raizSite }
    $arquivo = [System.IO.Path]::GetFullPath((Join-Path $base ($caminho.TrimStart("/") -replace "/", "\")))
    if (-not $arquivo.StartsWith([string]$base) -or -not (Test-Path $arquivo -PathType Leaf)) { Responder $ctx 404 "text/plain" $utf8.GetBytes("404"); continue }
    $ext = [System.IO.Path]::GetExtension($arquivo).ToLower()
    $tipo = if ($tipos.ContainsKey($ext)) { $tipos[$ext] } else { "application/octet-stream" }
    Responder $ctx 200 $tipo ([System.IO.File]::ReadAllBytes($arquivo))
  } catch {
    Write-Warning $_
    try { Responder $ctx 500 "text/plain" $utf8.GetBytes("500") } catch {}
  }
}
