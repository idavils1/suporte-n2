# Servidor de testes do Inventário de Equipamentos (só para este computador; não vai para o Firebase).
# Uso:  powershell -ExecutionPolicy Bypass -File sites\inventario-testes\servidor.ps1
# Abra  http://localhost:8124/teste.html   (navegador "A")
#  e    http://127.0.0.1:8124/teste.html   (navegador "B": outro endereço = outro localStorage)
# A página de teste é o index.html real com a nuvem simulada (nuvem-teste.js) no lugar do Firebase.
# O banco simulado fica na memória deste servidor e é compartilhado pelos dois endereços.
param([int]$Porta = 8124)

$raizSite = Resolve-Path (Join-Path $PSScriptRoot "..\inventario-equipamentos")
$raizTeste = $PSScriptRoot
$banco = @{ versao = 0; dados = "null" }
$tipos = @{ ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".svg" = "image/svg+xml"; ".json" = "application/json; charset=utf-8" }

$ouvinte = New-Object System.Net.HttpListener
$ouvinte.Prefixes.Add("http://localhost:$Porta/")
$ouvinte.Prefixes.Add("http://127.0.0.1:$Porta/")
$ouvinte.Start()
Write-Host "Inventário de Equipamentos (teste) em http://localhost:$Porta/teste.html e http://127.0.0.1:$Porta/teste.html"

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
    if ($caminho -eq "/banco") {
      if ($ctx.Request.HttpMethod -eq "PUT") {
        $leitor = New-Object System.IO.StreamReader($ctx.Request.InputStream, $utf8)
        $banco.dados = $leitor.ReadToEnd()
        $banco.versao++
      }
      Responder $ctx 200 "application/json; charset=utf-8" $utf8.GetBytes("{""versao"":$($banco.versao),""dados"":$($banco.dados)}")
      continue
    }
    if ($caminho -eq "/" -or $caminho -eq "/teste.html") {
      $html = [System.IO.File]::ReadAllText((Join-Path $raizSite "index.html"), $utf8)
      $html = $html.Replace('<script type="module" src="assets/app.js">', '<script src="/teste/nuvem-teste.js"></script><script type="module" src="assets/app.js">')
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
