param([string]$Arquivo, [string]$Planilha = "xl/worksheets/sheet1.xml", [string]$Saida)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($Arquivo)
try {
  $ss = New-Object System.Collections.Generic.List[string]
  $r = [Xml.XmlReader]::Create($z.GetEntry("xl/sharedStrings.xml").Open())
  $atual = $null
  while ($r.Read()) {
    if ($r.NodeType -eq "Element" -and $r.LocalName -eq "si") { $atual = New-Object Text.StringBuilder; if ($r.IsEmptyElement) { $ss.Add(""); $atual = $null } }
    elseif ($r.NodeType -eq "Element" -and $r.LocalName -eq "rPh") { $r.Skip() | Out-Null }
    elseif ($r.NodeType -eq "Element" -and $r.LocalName -eq "t" -and $atual) { [void]$atual.Append($r.ReadElementContentAsString()); if ($r.NodeType -eq "EndElement" -and $r.LocalName -eq "si") { $ss.Add($atual.ToString()); $atual = $null } }
    elseif ($r.NodeType -eq "EndElement" -and $r.LocalName -eq "si" -and $atual) { $ss.Add($atual.ToString()); $atual = $null }
  }
  $r.Close()

  $estilosData = @{}
  $sr = New-Object IO.StreamReader($z.GetEntry("xl/styles.xml").Open())
  [xml]$st = $sr.ReadToEnd(); $sr.Close()
  $fmtData = @{}
  foreach ($n in @(14,15,16,17,22,45,46,47)) { $fmtData[$n] = $true }
  if ($st.styleSheet.numFmts) { foreach ($f in $st.styleSheet.numFmts.numFmt) { if ($f.formatCode -match '[dy]' -and $f.formatCode -notmatch '^\[') { $fmtData[[int]$f.numFmtId] = $true } } }
  $i = 0
  foreach ($xf in $st.styleSheet.cellXfs.xf) { if ($fmtData[[int]$xf.numFmtId]) { $estilosData[$i] = $true }; $i++ }

  $w = New-Object IO.StreamWriter($Saida, $false, (New-Object Text.UTF8Encoding($true)))
  $r = [Xml.XmlReader]::Create($z.GetEntry($Planilha).Open())
  $linha = $null; $col = 0; $tipo = ""; $estilo = 0; $numLinha = 0
  $letra = { param($ref) $l = ($ref -replace '\d', ''); $n = 0; foreach ($c in $l.ToCharArray()) { $n = $n * 26 + ([int]$c - 64) }; $n - 1 }
  while ($r.Read()) {
    if ($r.NodeType -eq "Element" -and $r.LocalName -eq "row") {
      $linha = New-Object 'string[]' 13; $numLinha = [int]$r.GetAttribute("r")
      if ($r.IsEmptyElement) { $linha = $null }
    }
    elseif ($r.NodeType -eq "Element" -and $r.LocalName -eq "c") {
      $col = & $letra $r.GetAttribute("r"); $tipo = $r.GetAttribute("t"); $s = $r.GetAttribute("s"); $estilo = if ($s) { [int]$s } else { 0 }
    }
    elseif ($r.NodeType -eq "Element" -and ($r.LocalName -eq "v" -or ($r.LocalName -eq "t" -and $tipo -eq "inlineStr"))) {
      $v = $r.ReadElementContentAsString()
      if ($col -lt 13 -and $linha) {
        if ($tipo -eq "s") { $v = $ss[[int]$v] }
        elseif (-not $tipo -and $estilosData[$estilo] -and $v -match '^\d+(\.\d+)?$') { $v = [DateTime]::FromOADate([double]$v).ToString("yyyy-MM-dd") }
        $linha[$col] = ($v -replace "[\t\r\n]+", " ").Trim()
      }
    }
    elseif ($r.NodeType -eq "EndElement" -and $r.LocalName -eq "row" -and $linha) {
      if (($linha | Where-Object { $_ }).Count) { $w.WriteLine("$numLinha`t" + ($linha -join "`t")) }
      $linha = $null
    }
  }
  $r.Close(); $w.Close()
} finally { $z.Dispose() }
