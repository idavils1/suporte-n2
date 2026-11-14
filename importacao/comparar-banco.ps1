param([string]$ArquivoPlanilha, [string]$ArquivoSite, [string]$Pasta)
$ErrorActionPreference = "Stop"
$cols = @("numero","dataConcessao","responsavel","pedidoConcedido","produto","motivo","chamado","pedidoAnterior","ticketAnterior","arSolicitante","dataEmissaoAnterior","area","obsVidaas")
$datas = @("dataConcessao","dataEmissaoAnterior")
$numericas = @("numero","pedidoConcedido","chamado","pedidoAnterior","ticketAnterior")

function NormNum([string]$v) {
  $v = $v.Trim()
  if ($v -match '^-?\d+(\.\d+)?([eE][+-]?\d+)?$') {
    $d = [decimal]::Parse($v, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture)
    if ($d -eq [decimal]::Truncate($d)) { return $d.ToString("0", [Globalization.CultureInfo]::InvariantCulture) }
  }
  return $v
}
function NormData([string]$v) {
  $v = $v.Trim()
  if ($v -match '^(\d{4})-(\d{2})-(\d{2})') { return "$($matches[1])-$($matches[2])-$($matches[3])" }
  if ($v -match '^(\d{1,2})/(\d{1,2})/(\d{4})') { return "{0}-{1:00}-{2:00}" -f $matches[3], [int]$matches[2], [int]$matches[1] }
  return $v
}
function Norm([string]$col, [string]$v) {
  if ($null -eq $v) { return "" }
  $v = $v.Trim()
  if (-not $v) { return "" }
  if ($datas -contains $col) { return NormData $v }
  if ($numericas -contains $col) { return NormNum $v }
  return $v
}
function Chave([string]$v) { return ($v -replace '\s', '').ToLowerInvariant() }
function Comparavel([string]$v) { return ($v.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', '' -replace '\s+', ' ').Trim().ToLowerInvariant() }

function LerCsvSite([string]$t) {
  $linhas = New-Object System.Collections.Generic.List[object]
  $campo = New-Object Text.StringBuilder; $linha = New-Object System.Collections.Generic.List[string]; $aspas = $false
  for ($i = 0; $i -lt $t.Length; $i++) {
    $ch = $t[$i]
    if ($aspas) {
      if ($ch -eq '"' -and $i + 1 -lt $t.Length -and $t[$i + 1] -eq '"') { [void]$campo.Append('"'); $i++ }
      elseif ($ch -eq '"') { $aspas = $false }
      else { [void]$campo.Append($ch) }
    } elseif ($ch -eq '"' -and $campo.Length -eq 0) { $aspas = $true }
    elseif ($ch -eq ';') { $linha.Add($campo.ToString()); [void]$campo.Clear() }
    elseif ($ch -eq "`r" -or $ch -eq "`n") {
      if ($ch -eq "`r" -and $i + 1 -lt $t.Length -and $t[$i + 1] -eq "`n") { $i++ }
      $linha.Add($campo.ToString()); [void]$campo.Clear(); $linhas.Add($linha.ToArray()); $linha = New-Object System.Collections.Generic.List[string]
    } else { [void]$campo.Append($ch) }
  }
  $linha.Add($campo.ToString()); if (($linha | Where-Object { $_ }).Count) { $linhas.Add($linha.ToArray()) }
  return $linhas
}

$json = Get-Content $ArquivoSite -Raw -Encoding UTF8 | ConvertFrom-Json
$texto = $json.result.value
if (-not $texto) { $texto = $json.result.result.value }
$texto = $texto.TrimStart([char]0xFEFF)
$siteLinhas = LerCsvSite $texto
$site = @{}
$siteDup = 0
for ($i = 1; $i -lt $siteLinhas.Count; $i++) {
  $l = $siteLinhas[$i]
  $reg = @{}
  for ($c = 0; $c -lt $cols.Count; $c++) { $reg[$cols[$c]] = Norm $cols[$c] ([string]$l[$c]) }
  $k = Chave $reg.numero
  if (-not $k) { continue }
  if ($site.ContainsKey($k)) { $siteDup++; continue }
  $site[$k] = $reg
}

$faltando = New-Object System.Collections.Generic.List[object]
$preencher = New-Object System.Collections.Generic.List[object]
$divergentes = New-Object System.Collections.Generic.List[object]
$vazioPorCol = @{}; $cols | ForEach-Object { $vazioPorCol[$_] = 0 }
$vistos = @{}; $dupPlanilha = 0; $semTicket = 0; $total = 0
foreach ($ln in [IO.File]::ReadLines($ArquivoPlanilha, [Text.Encoding]::UTF8)) {
  $p = $ln.Split("`t")
  if ($p[0] -eq "1") { continue }
  $total++
  $reg = @{ linha = $p[0] }
  for ($c = 0; $c -lt $cols.Count; $c++) { $reg[$cols[$c]] = Norm $cols[$c] ([string]$p[$c + 1]) }
  $k = Chave $reg.numero
  if (-not $k) { $semTicket++; continue }
  if ($vistos.ContainsKey($k)) { $dupPlanilha++; continue }
  $vistos[$k] = $true
  $s = $site[$k]
  if (-not $s) { $faltando.Add($reg); continue }
  $novos = @{}
  foreach ($c in $cols) {
    if ($c -eq "numero") { continue }
    $vp = $reg[$c]; $vs = $s[$c]
    if ($vp -and -not $vs) { $novos[$c] = $vp; $vazioPorCol[$c]++ }
    elseif ($vp -and $vs -and (Comparavel $vp) -ne (Comparavel $vs)) { $divergentes.Add([pscustomobject]@{ linha = $reg.linha; ticket = $reg.numero; coluna = $c; planilha = $vp; site = $vs }) }
  }
  if ($novos.Count) { $novos["numero"] = $reg.numero; $novos["linha"] = $reg.linha; $preencher.Add($novos) }
}

"Planilha: $total linhas, $semTicket sem ticket, $dupPlanilha tickets repetidos (ignorados apos a 1a)"
"Site: $($siteLinhas.Count - 1) registros, $siteDup repetidos"
"Na planilha e nao no site: $($faltando.Count)"
"Tickets com campos vazios no site que a planilha preenche: $($preencher.Count)"
$vazioPorCol.GetEnumerator() | Where-Object { $_.Value } | Sort-Object Value -Descending | ForEach-Object { "  $($_.Key): $($_.Value)" }
"Valores diferentes (os dois preenchidos): $($divergentes.Count)"
$divergentes | Group-Object coluna | Sort-Object Count -Descending | ForEach-Object { "  $($_.Name): $($_.Count)" }

$cab = @("linha") + $cols
$sb = New-Object Text.StringBuilder
[void]$sb.AppendLine(($cab -join "`t"))
foreach ($r in $faltando) { [void]$sb.AppendLine((($cab | ForEach-Object { $r[$_] }) -join "`t")) }
[IO.File]::WriteAllText("$Pasta\faltando-no-site.tsv", $sb.ToString(), (New-Object Text.UTF8Encoding($true)))
$sb = New-Object Text.StringBuilder
[void]$sb.AppendLine(($cab -join "`t"))
foreach ($r in $preencher) { [void]$sb.AppendLine((($cab | ForEach-Object { $r[$_] }) -join "`t")) }
[IO.File]::WriteAllText("$Pasta\preencher-no-site.tsv", $sb.ToString(), (New-Object Text.UTF8Encoding($true)))
$divergentes | Export-Csv "$Pasta\divergentes.csv" -Delimiter ";" -NoTypeInformation -Encoding UTF8
