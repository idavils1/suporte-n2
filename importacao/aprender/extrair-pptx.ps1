# Extrai o texto de um .pptx (lido como ZIP) na ordem dos slides: parágrafos, tabelas (a:tbl) e notas.
# Uso: powershell -File extrair-pptx.ps1 "<arquivo.pptx>" "<saida.txt>"
param([string]$Arquivo, [string]$Saida)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Arquivo)
$ns = @{ a = "http://schemas.openxmlformats.org/drawingml/2006/main"; p = "http://schemas.openxmlformats.org/presentationml/2006/main" }
function LerXml($nome) {
  $e = $zip.GetEntry($nome); if (-not $e) { return $null }
  $r = New-Object System.IO.StreamReader($e.Open(), [System.Text.Encoding]::UTF8); $x = [xml]$r.ReadToEnd(); $r.Close(); return $x
}
function TextoParagrafo($p) { ($p.SelectNodes(".//a:t", $script:nsm) | ForEach-Object { $_.InnerText }) -join "" }
$saidaTxt = New-Object System.Text.StringBuilder
$slides = $zip.Entries | Where-Object { $_.FullName -match '^ppt/slides/slide(\d+)\.xml$' } | Sort-Object { [int]([regex]::Match($_.FullName, '(\d+)\.xml$').Groups[1].Value) }
foreach ($s in $slides) {
  $n = [int]([regex]::Match($s.FullName, '(\d+)\.xml$').Groups[1].Value)
  $x = LerXml $s.FullName
  $script:nsm = New-Object System.Xml.XmlNamespaceManager($x.NameTable)
  $script:nsm.AddNamespace("a", $ns.a); $script:nsm.AddNamespace("p", $ns.p)
  [void]$saidaTxt.AppendLine("=================== SLIDE $n ===================")
  # Formas na ordem do arquivo; tabelas viram linhas "| c1 | c2 |"
  foreach ($no in $x.SelectNodes("//p:spTree/*", $script:nsm)) {
    $tabelas = $no.SelectNodes(".//a:tbl", $script:nsm)
    if ($tabelas.Count -gt 0) {
      foreach ($tbl in $tabelas) {
        [void]$saidaTxt.AppendLine("[TABELA]")
        foreach ($tr in $tbl.SelectNodes("a:tr", $script:nsm)) {
          $cel = foreach ($tc in $tr.SelectNodes("a:tc", $script:nsm)) { (($tc.SelectNodes(".//a:p", $script:nsm) | ForEach-Object { TextoParagrafo $_ }) | Where-Object { $_ -ne "" }) -join " / " }
          [void]$saidaTxt.AppendLine("| " + ($cel -join " | ") + " |")
        }
        [void]$saidaTxt.AppendLine("[/TABELA]")
      }
      continue
    }
    $pars = $no.SelectNodes(".//a:p", $script:nsm)
    $linhas = @()
    foreach ($p in $pars) {
      $t = TextoParagrafo $p
      if ($t.Trim() -ne "") {
        $nivel = $p.SelectSingleNode("a:pPr/@lvl", $script:nsm)
        $recuo = if ($nivel) { "  " * [int]$nivel.Value } else { "" }
        $linhas += "$recuo$t"
      }
    }
    if ($linhas.Count) { [void]$saidaTxt.AppendLine(($linhas -join "`n")); [void]$saidaTxt.AppendLine("---") }
  }
  $nota = LerXml "ppt/notesSlides/notesSlide$n.xml"
  if ($nota) {
    $script:nsm = New-Object System.Xml.XmlNamespaceManager($nota.NameTable); $script:nsm.AddNamespace("a", $ns.a); $script:nsm.AddNamespace("p", $ns.p)
    $tn = ($nota.SelectNodes("//a:p", $script:nsm) | ForEach-Object { TextoParagrafo $_ } | Where-Object { $_.Trim() -ne "" -and $_ -notmatch '^\d+$' }) -join "`n"
    if ($tn) { [void]$saidaTxt.AppendLine("[NOTAS]"); [void]$saidaTxt.AppendLine($tn); [void]$saidaTxt.AppendLine("[/NOTAS]") }
  }
}
$zip.Dispose()
[System.IO.File]::WriteAllText($Saida, $saidaTxt.ToString(), (New-Object System.Text.UTF8Encoding $false))
"ok: $Saida ($($slides.Count) slides)"
