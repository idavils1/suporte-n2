/*
 * ============================================================
 *  Arquivos de planilha sem bibliotecas externas (a CSP do site só libera scripts do próprio site)
 *  - Leitura: CSV/TXT (texto), XLSX (Excel) e ODS (LibreOffice/Calc), só a primeira aba.
 *  - Gravação: XLSX simples (uma aba, cabeçalho em negrito).
 *  XLSX e ODS são ZIP: lidos com DecompressionStream("deflate-raw") (Chrome/Edge 103+, Firefox 113+, Safari 16.4+).
 * ============================================================
 */
export const TAMANHO_MAXIMO_ARQUIVO = 10 * 1024 * 1024;
const MAX_COLUNAS = 200;

/* ---------- ZIP ---------- */
function lerZip(buffer) {
  const v = new DataView(buffer);
  let fim = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error("Arquivo ZIP inválido (não é XLSX/ODS ou está corrompido).");
  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const entradas = new Map();
  const nomeDe = (ini, n) => new TextDecoder().decode(new Uint8Array(buffer, ini, n));
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const nLen = v.getUint16(p + 28, true), eLen = v.getUint16(p + 30, true), cLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = nomeDe(p + 46, nLen);
    entradas.set(nome, { metodo, comprimido, local });
    p += 46 + nLen + eLen + cLen;
  }
  return {
    nomes: () => [...entradas.keys()],
    async texto(nome) {
      const e = entradas.get(nome);
      if (!e) return null;
      const nl = v.getUint16(e.local + 26, true), el = v.getUint16(e.local + 28, true);
      const dados = new Uint8Array(buffer, e.local + 30 + nl + el, e.comprimido);
      if (e.metodo === 0) return new TextDecoder().decode(dados);
      if (e.metodo !== 8) throw new Error("Compressão do arquivo não suportada.");
      if (typeof DecompressionStream === "undefined") throw new Error("Este navegador não abre XLSX/ODS. Use o Chrome ou o Edge atualizados, ou salve como CSV.");
      const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(fluxo).text();
    }
  };
}
const xml = (texto) => new DOMParser().parseFromString(texto, "application/xml");
const porNome = (raiz, nome) => [...raiz.getElementsByTagName("*")].filter((el) => el.localName === nome);
const filhos = (el, nome) => [...el.children].filter((x) => x.localName === nome);

/* ---------- XLSX ---------- */
const FORMATOS_DATA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const doisDigitos = (n) => String(n).padStart(2, "0");
function serialParaData(n) {
  const d = new Date(Math.round((Number(n) - 25569) * 86400000));
  return isNaN(d) ? String(n) : `${doisDigitos(d.getUTCDate())}/${doisDigitos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
const colunaDaRef = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
async function lerXlsx(zip) {
  const pasta = xml(await zip.texto("xl/workbook.xml") || "<w/>");
  const primeira = porNome(pasta, "sheet")[0];
  let caminho = "xl/worksheets/sheet1.xml", nomeAba = primeira ? primeira.getAttribute("name") : "";
  if (primeira) {
    const rid = primeira.getAttribute("r:id") || [...primeira.attributes].find((a) => a.localName === "id")?.value;
    const rels = xml(await zip.texto("xl/_rels/workbook.xml.rels") || "<r/>");
    const alvo = porNome(rels, "Relationship").find((r) => r.getAttribute("Id") === rid);
    if (alvo) { const t = alvo.getAttribute("Target"); caminho = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); }
  }
  const compartilhadas = [];
  const ss = await zip.texto("xl/sharedStrings.xml");
  if (ss) porNome(xml(ss), "si").forEach((si) => compartilhadas.push(porNome(si, "t").filter((t) => !t.closest || t.parentNode.localName !== "rPh").map((t) => t.textContent).join("")));
  /* Estilos que são datas (para não virar número de série) */
  const datas = new Set();
  const st = await zip.texto("xl/styles.xml");
  if (st) {
    const doc = xml(st);
    const proprios = new Map(porNome(doc, "numFmt").map((f) => [Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") || ""]));
    const ehData = (id) => FORMATOS_DATA.has(id) || (proprios.has(id) && /[dmy]/i.test(proprios.get(id).replace(/"[^"]*"|\[[^\]]*\]/g, "")) && !/0\.0|#/.test(proprios.get(id)));
    const cellXfs = porNome(doc, "cellXfs")[0];
    if (cellXfs) filhos(cellXfs, "xf").forEach((xf, i) => { if (ehData(Number(xf.getAttribute("numFmtId")))) datas.add(i); });
  }
  const folha = xml(await zip.texto(caminho) || "<w/>");
  const linhas = [];
  porNome(folha, "row").forEach((row) => {
    const linha = [];
    filhos(row, "c").forEach((c, i) => {
      const col = c.getAttribute("r") ? colunaDaRef(c.getAttribute("r")) : i;
      if (col >= MAX_COLUNAS) return;
      const t = c.getAttribute("t"), vEl = filhos(c, "v")[0];
      let valor = vEl ? vEl.textContent : "";
      if (t === "s") valor = compartilhadas[Number(valor)] ?? "";
      else if (t === "inlineStr") valor = porNome(c, "t").map((x) => x.textContent).join("");
      else if (t === "b") valor = valor === "1" ? "VERDADEIRO" : "FALSO";
      else if (t !== "str" && t !== "e" && valor !== "" && datas.has(Number(c.getAttribute("s")))) valor = serialParaData(valor);
      linha[col] = valor;
    });
    for (let k = 0; k < linha.length; k++) if (linha[k] == null) linha[k] = "";
    if (linha.some((x) => String(x).trim())) linhas.push(linha);
  });
  return { linhas, aba: nomeAba };
}

/* ---------- ODS ---------- */
async function lerOds(zip) {
  const doc = xml(await zip.texto("content.xml") || "<w/>");
  const tabela = porNome(doc, "table")[0];
  if (!tabela) return { linhas: [], aba: "" };
  const atributo = (el, nome) => [...el.attributes].find((a) => a.localName === nome)?.value || "";
  const linhas = [];
  porNome(tabela, "table-row").forEach((row) => {
    if (linhas.length > 100000) return;
    const linha = [];
    filhos(row, "table-cell").concat(filhos(row, "covered-table-cell")).sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1)).forEach((c) => {
      const repetir = Math.min(Number(atributo(c, "number-columns-repeated")) || 1, MAX_COLUNAS);
      const tipo = atributo(c, "value-type");
      let valor = porNome(c, "p").map((p) => p.textContent).join("\n");
      if (tipo === "date") { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(atributo(c, "date-value")); if (m) valor = `${m[3]}/${m[2]}/${m[1]}`; }
      else if (tipo === "float" || tipo === "percentage" || tipo === "currency") valor = atributo(c, "value") || valor;
      for (let k = 0; k < repetir && linha.length < MAX_COLUNAS; k++) linha.push(valor);
    });
    while (linha.length && !String(linha[linha.length - 1]).trim()) linha.pop();
    if (!linha.some((x) => String(x).trim())) return;
    const vezes = Math.min(Number(atributo(row, "number-rows-repeated")) || 1, 1000);
    for (let k = 0; k < vezes; k++) linhas.push(linha.slice());
  });
  return { linhas, aba: atributo(tabela, "name") };
}

/* ---------- Entrada ---------- */
/* lerTexto(texto) → linhas (CSV/TXT): passado pelo app (mesmo leitor do "Colar do Excel") */
export async function lerArquivoTabela(arquivo, lerTexto) {
  if (!arquivo) throw new Error("Escolha um arquivo.");
  if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO) throw new Error("Arquivo grande demais (máximo de 10 MB).");
  const nome = String(arquivo.name || "").toLowerCase();
  const buffer = await arquivo.arrayBuffer();
  const cabecalho = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  const ehZip = cabecalho[0] === 0x50 && cabecalho[1] === 0x4b;
  if (ehZip || /\.(xlsx|xlsm|ods)$/.test(nome)) {
    const zip = lerZip(buffer);
    if (zip.nomes().includes("content.xml") && !zip.nomes().includes("xl/workbook.xml")) return { ...(await lerOds(zip)), formato: "ODS" };
    if (zip.nomes().includes("xl/workbook.xml")) return { ...(await lerXlsx(zip)), formato: "XLSX" };
    throw new Error("Não reconheci o arquivo: use CSV, XLSX ou ODS.");
  }
  if (/\.xls$/.test(nome)) throw new Error("O formato .xls (Excel 97-2003) não é aceito: no Excel, salve como .xlsx ou .csv.");
  let texto = new TextDecoder("utf-8").decode(buffer);
  if (texto.includes("\ufffd")) { try { texto = new TextDecoder("windows-1252").decode(buffer); } catch (e) { /* fica o UTF-8 */ } }
  return { linhas: lerTexto(texto), aba: "", formato: "CSV" };
}

/* ---------- XLSX (gravação) ---------- */
const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipSemCompressao(arquivos) {
  const cod = new TextEncoder();
  const partes = [], central = [];
  let deslocamento = 0;
  arquivos.forEach(({ nome, conteudo }) => {
    const n = cod.encode(nome), dados = cod.encode(conteudo), crc = crc32(dados);
    const local = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, dados.length, 4], [22, dados.length, 4], [26, n.length, 2], [28, 0, 2]]
      .forEach(([o, v, t]) => (t === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true)));
    partes.push(new Uint8Array(local.buffer), n, dados);
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, dados.length, 4], [24, dados.length, 4], [28, n.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, deslocamento, 4]]
      .forEach(([o, v, t]) => (t === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true)));
    central.push(new Uint8Array(c.buffer), n);
    deslocamento += 30 + n.length + dados.length;
  });
  const tamanhoCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, arquivos.length, 2], [10, arquivos.length, 2], [12, tamanhoCentral, 4], [16, deslocamento, 4], [20, 0, 2]]
    .forEach(([o, v, t]) => (t === 4 ? fim.setUint32(o, v, true) : fim.setUint16(o, v, true)));
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const escaparXml = (s) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const letraColuna = (i) => { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
/* linhas: a primeira é o cabeçalho (negrito). Números viram número; o resto, texto. */
export function gerarXlsx(linhas, nomeAba = "Planilha") {
  const aba = escaparXml(String(nomeAba).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Planilha");
  const corpo = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => {
    const ref = `${letraColuna(c)}${r + 1}`, estilo = r === 0 ? ' s="1"' : "";
    if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${estilo}><v>${v}</v></c>`;
    const t = String(v == null ? "" : v);
    return t ? `<c r="${ref}" t="inlineStr"${estilo}><is><t xml:space="preserve">${escaparXml(t)}</t></is></c>` : "";
  }).join("")}</row>`).join("");
  return zipSemCompressao([
    { nome: "[Content_Types].xml", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nome: "_rels/.rels", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nome: "xl/workbook.xml", conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${aba}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { nome: "xl/_rels/workbook.xml.rels", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nome: "xl/styles.xml", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' },
    { nome: "xl/worksheets/sheet1.xml", conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${corpo}</sheetData></worksheet>` }
  ]);
}
