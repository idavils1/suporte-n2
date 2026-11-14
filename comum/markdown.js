/*
 * ============================================================
 *  RENDERIZADOR DE MARKDOWN — CÓPIA do caderno.html
 *  (primeiro <script> do caderno.html, do "MARKDOWN (renderizador
 *  próprio, sem bibliotecas)" até pontuar()/trechoDestacado()).
 *  Copiado (e não movido) para não mudar nada no caderno.
 *  Ao corrigir algo no renderizador do caderno, copie aqui também.
 *  Todo texto é escapado; só saem as tags montadas aqui.
 * ============================================================
 */
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const normalizar = (texto) => String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const escapar = (texto) => String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const svg = (id, classe = "icone") => `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true"><use href="#${escapar(id)}"/></svg>`;
const slug = (texto) => normalizar(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const novoId = (prefixo) => `${prefixo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const contarTexto = (n, singular, plural) => `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : plural}`;
const doisDigitos = (n) => String(n).padStart(2, "0");
const limitar = (n, min, max) => Math.min(max, Math.max(min, Number(n) || min));
const capitalizar = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`; };
const fmtHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const SLUG_VALIDO = /^[a-z0-9-]{1,40}$/;
const COR_HEX = /^#[0-9a-f]{6}$/i;
const AGORA = "__AGORA__";
const SESSAO = novoId("s");
const DEZ_MINUTOS = 10 * 60 * 1000;
const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;
const LIMITE_MARKDOWN = 800000;
const MAX_VERSOES = 30;
const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/webp"];
const LIMITE_IMAGEM = 700000;
const LIMITE_MINIATURA = 140000;

/* Caminho de logo: relativo ou https (igual ao index.html) */
function caminhoLogo(texto) {
  const t = String(texto || "").trim();
  if (!t || /^https:\/\/[^\s"'<>]+$/i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//") || /[\s"'<>\\]/.test(t)) return null;
  return t;
}

/*
 * ============================================================
 *  MARKDOWN (renderizador próprio, sem bibliotecas)
 * ============================================================
 *  Todo o texto da nota é escapado antes de virar HTML e só
 *  saem as tags montadas aqui. HTML escrito na nota aparece
 *  como texto: não existe <script>, <iframe>, <style> nem on*.
 * ============================================================
 */
const CORES = ["cinza", "vermelho", "laranja", "amarelo", "verde", "azul", "roxo", "rosa"];
const NOMES_CORES = { cinza: "Cinza", vermelho: "Vermelho", laranja: "Laranja", amarelo: "Amarelo", verde: "Verde", azul: "Azul", roxo: "Roxo", rosa: "Rosa" };
const CALLOUTS = {
  info: { icone: "i-info", titulo: "Informação" },
  dica: { icone: "i-lampada", titulo: "Dica" },
  atencao: { icone: "i-alerta", titulo: "Atenção" },
  erro: { icone: "i-erro", titulo: "Erro" },
  sucesso: { icone: "i-sucesso", titulo: "Sucesso" },
  nota: { icone: "i-lapis", titulo: "Nota" },
  pergunta: { icone: "i-ajuda", titulo: "Pergunta" }
};
const APELIDOS_CALLOUT = {
  note: "info", informacao: "info", tip: "dica", hint: "dica", warning: "atencao", aviso: "atencao", cuidado: "atencao",
  caution: "atencao", danger: "erro", error: "erro", perigo: "erro", bug: "erro", failure: "erro", success: "sucesso", ok: "sucesso", check: "sucesso", done: "sucesso",
  question: "pergunta", faq: "pergunta", duvida: "pergunta", help: "pergunta"
};
const LINGUAGENS_CODIGO = ["texto", "bash", "powershell", "sql", "json", "xml", "html", "js", "python"];

const RE_ITEM_LISTA = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_CERCA = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)(?:\s+(quebrar))?\s*$/;
const RE_TITULO = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_SEP_TABELA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RE_DETALHES = /^:::\s*detalhes\b\s*(.*)$/i;
/* Blocos ":::" (o fechamento é uma linha só com ":::").
   Só na Aprendizagem (não existe no caderno.html): ":::selo <tipo>" e ":::diagrama <id>" (uma linha, sem fechamento). */
const RE_BLOCO_ABRE = /^:::\s*(detalhes|galeria|passo|comparar|selo)\b/i;
const RE_BLOCO_FECHA = /^:::\s*$/;
const RE_SELO = /^:::\s*selo\s+(validado|a-confirmar|nao-repassar|interno)\s*$/i;
const RE_DIAGRAMA = /^:::\s*diagrama\s+([a-z0-9-]{1,40})\s*$/i;
/* Selos de confiabilidade: o que pode ou não ser repassado ao cliente */
const SELOS = {
  validado: { rotulo: "Validado", icone: "i-sucesso", explicacao: "Confirmado na documentação oficial ou nos logs. Pode repassar ao cliente." },
  "a-confirmar": { rotulo: "A confirmar", icone: "i-alerta", explicacao: "Informado pelo time, sem respaldo na documentação ou nos logs. Repasse só com a ressalva “conforme orientação atual”." },
  "nao-repassar": { rotulo: "Não repassar", icone: "i-erro", explicacao: "Diverge da documentação oficial ou dos logs. Não repasse ao cliente: escale." },
  interno: { rotulo: "Uso interno", icone: "i-cadeado", explicacao: "Só para o time (investigação N2). Não repasse ao cliente." }
};
const RE_GALERIA = /^:::\s*galeria(?:\s+([2-4]))?\s*$/i;
const RE_PASSO = /^:::\s*passo(?:\s+(\d{1,3}))?\s*$/i;
const RE_COMPARAR = /^:::\s*comparar\s*$/i;
const RE_ATRIBUTOS_TABELA = /^\s*\{tabela:([^}\n]*)\}\s*$/;
/* Imagem do caderno: ![[img:<id>|legenda|parâmetros…]]. Um "]" só entra seguido de "(" (link na legenda) */
const PARTE_IMG = "(?:[^|\\]\\n]|\\](?=\\())*";
const RE_IMG_CADERNO = new RegExp(`!\\[\\[img:([\\w-]{1,60})((?:\\|${PARTE_IMG})*)\\]\\]`, "g");
const RE_IMG_SOZINHA = new RegExp(`^\\s*(!\\[\\[img:[\\w-]{1,60}(?:\\|${PARTE_IMG})*\\]\\])\\s*$`);
const RE_TAREFA_LINHA = /^([\s>]*(?:[-*+]|\d{1,9}[.)])\s+)\[( |x|X)\](?=\s|$)/;
const RE_COR = new RegExp(`\\{cor:(${CORES.join("|")})\\}([\\s\\S]*?)\\{\\/cor\\}`, "g");
const RE_FUNDO = new RegExp(`\\{fundo:(${CORES.join("|")})\\}([\\s\\S]*?)\\{\\/fundo\\}`, "g");
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const indentacao = (l) => /^[ \t]*/.exec(l)[0].replace(/\t/g, "  ").length;

function urlLinkSegura(url) {
  const u = String(url || "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if (/^#[\w-]*$/.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) return null;
  return u;
}
function urlImagemSegura(url) {
  const u = String(url || "").trim();
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(u)) return u;
  if (/^https:\/\//i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) return null;
  return u;
}

const textoPuro = (t) => String(t)
  .replace(RE_IMG_CADERNO, "")
  .replace(/!\[\[[^\]]*\]\]/g, "")
  .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/\{\/?(?:cor|fundo)[^}]*\}|[*_~=`]/g, "")
  .trim();

function renderizarMarkdown(md, opcoes = {}) {
  const ctx = {
    titulos: [], ids: new Map(), imagens: [], tarefas: 0, tabelas: [], galerias: 0, passos: 0,
    editavel: !!opcoes.editavel, slug: opcoes.slug || "", resolverNota: opcoes.resolverNota || (() => null),
    diagramas: opcoes.diagramas || {}
  };
  const linhas = String(md || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").split("\n");
  return { html: blocos(linhas, ctx, true), titulos: ctx.titulos, imagens: ctx.imagens, tabelas: ctx.tabelas };
}

function idTitulo(texto, ctx) {
  const base = `t-${slug(textoPuro(texto)) || "secao"}`;
  const n = (ctx.ids.get(base) || 0) + 1;
  ctx.ids.set(base, n);
  return n > 1 ? `${base}-${n}` : base;
}

function ehInicioDeBloco(linhas, i) {
  const l = linhas[i];
  return RE_CERCA.test(l) || RE_TITULO.test(l) || RE_HR.test(l) || /^\s*>/.test(l) || RE_ITEM_LISTA.test(l)
    || RE_BLOCO_ABRE.test(l) || RE_DIAGRAMA.test(l) || RE_IMG_SOZINHA.test(l)
    || (l.includes("|") && i + 1 < linhas.length && RE_SEP_TABELA.test(linhas[i + 1]));
}

const celulasTabela = (l) => l.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));

/* Estilo da tabela numa linha logo abaixo dela, ex.: {tabela: listrada bordas=horizontais compacta largura=total cabecalho=azul legenda="Contatos"}.
   Só valores desta lista fechada; qualquer coisa fora dela faz a linha inteira ser ignorada (e aparecer como texto). */
const CORES_CABECALHO = [...CORES, "lilas"];
const ATRIBUTOS_TABELA_PADRAO = { listrada: false, bordas: "todas", densidade: "normal", largura: "auto", cabecalho: "", primeiraColuna: false, colunaFixa: false, semCabecalho: false, legenda: "" };
function lerAtributosTabela(linha) {
  const m = RE_ATRIBUTOS_TABELA.exec(linha || "");
  if (!m) return null;
  const a = { ...ATRIBUTOS_TABELA_PADRAO };
  const tokens = m[1].match(/[^\s"=]+(?:="[^"]*"|=[^\s"]+)?/g) || [];
  if (tokens.join("").replace(/\s+/g, "") !== m[1].replace(/\s+/g, "")) return null;
  for (const t of tokens) {
    const [chave, ...resto] = t.split("=");
    const valor = resto.join("=").replace(/^"|"$/g, "");
    const k = normalizar(chave);
    if (k === "listrada" && !resto.length) a.listrada = true;
    else if (k === "bordas" && (!resto.length || ["todas", "horizontais", "nenhuma"].includes(valor))) a.bordas = valor || "todas";
    else if (["compacta", "espacosa", "normal"].includes(k) && !resto.length) a.densidade = k;
    else if (k === "densidade" && ["compacta", "normal", "espacosa"].includes(normalizar(valor))) a.densidade = normalizar(valor);
    else if (k === "largura" && ["auto", "total"].includes(valor)) a.largura = valor;
    else if (k === "cabecalho" && (CORES_CABECALHO.includes(valor) || valor === "padrao")) a.cabecalho = valor === "padrao" ? "" : valor;
    else if (k === "primeira-coluna" && !resto.length) a.primeiraColuna = true;
    else if (k === "coluna-fixa" && !resto.length) a.colunaFixa = true;
    else if (k === "sem-cabecalho" && !resto.length) a.semCabecalho = true;
    else if (k === "legenda" && /^"[^"]*"$/.test(resto.join("="))) a.legenda = valor.slice(0, 200);
    else return null;
  }
  return a;
}
function montarAtributosTabela(a) {
  const t = [];
  if (a.listrada) t.push("listrada");
  if (a.bordas && a.bordas !== "todas") t.push(`bordas=${a.bordas}`);
  if (a.densidade && a.densidade !== "normal") t.push(a.densidade);
  if (a.largura === "total") t.push("largura=total");
  if (a.cabecalho) t.push(`cabecalho=${a.cabecalho}`);
  if (a.primeiraColuna) t.push("primeira-coluna");
  if (a.colunaFixa) t.push("coluna-fixa");
  if (a.semCabecalho) t.push("sem-cabecalho");
  const legenda = String(a.legenda || "").replace(/["{}|\n]/g, " ").replace(/\s+/g, " ").trim();
  if (legenda) t.push(`legenda="${legenda}"`);
  return t.length ? `{tabela: ${t.join(" ")}}` : "";
}
/* Célula: <br> vira quebra de linha (o resto continua escapado pelo inline) */
const htmlCelula = (texto, ctx) => String(texto).split(/<br\s*\/?>/i).map((t) => inline(t, ctx)).join("<br>");
function htmlTabela(cabecalho, alinhamentos, corpo, a, ctx, indice) {
  const n = cabecalho.length;
  const celula = (txt, j, tag) => `<${tag}${alinhamentos[j] ? ` style="text-align:${alinhamentos[j]}"` : ""}>${htmlCelula(txt, ctx)}</${tag}>`;
  const linha = (l, tag) => `<tr>${Array.from({ length: n }, (_, j) => celula(l[j] || "", j, tag)).join("")}</tr>`;
  const classes = [a.listrada && "t-listrada", a.bordas && a.bordas !== "todas" && `t-bordas-${a.bordas}`, a.densidade && a.densidade !== "normal" && `t-${a.densidade}`,
    a.largura === "total" && "t-total", a.cabecalho && `t-cab-${a.cabecalho}`, a.primeiraColuna && "t-primeira-coluna", a.colunaFixa && "t-coluna-fixa"].filter(Boolean).join(" ");
  const linhasCorpo = a.semCabecalho ? [cabecalho, ...corpo] : corpo;
  const tabela = `<table${classes ? ` class="${classes}"` : ""}>${a.semCabecalho ? "" : `<thead>${linha(cabecalho, "th")}</thead>`}<tbody>${linhasCorpo.map((l) => linha(l, "td")).join("")}</tbody></table>`;
  const acoes = `<span class="tabela-acoes"><button type="button" class="btn btn-secundario btn-mini" data-copiar-tabela>${svg("i-copiar")}Copiar tabela</button>`
    + `${ctx.editavel && indice >= 0 ? `<button type="button" class="btn btn-secundario btn-mini" data-editar-tabela="${indice}">${svg("i-tabela")}Editar tabela</button>` : ""}</span>`;
  return `<div class="tabela-bloco${a.largura === "total" ? " total" : ""}">${a.legenda ? `<p class="tabela-legenda">${inline(a.legenda, ctx)}</p>` : ""}`
    + `<div class="tabela-rolagem${linhasCorpo.length > 15 ? " longa" : ""}">${tabela}</div>${acoes}</div>`;
}

/* :::galeria 2|3|4 — uma imagem (ou texto) por linha */
function htmlGaleria(corpo, colunas, ctx) {
  const itens = corpo.filter((l) => l.trim()).map((l) => `<div class="galeria-item">${inline(l.trim(), ctx)}</div>`);
  return itens.length ? `<div class="md-galeria colunas-${colunas}" data-galeria="${ctx.galerias++}">${itens.join("")}</div>` : "";
}
/* :::passo — a primeira imagem vai para o lado, o resto é o texto do passo */
function htmlPasso(corpo, numero, ctx) {
  const k = corpo.findIndex((l) => RE_IMG_SOZINHA.test(l));
  const midia = k >= 0 ? inline(corpo[k].trim(), ctx) : "";
  const texto = blocos(corpo.filter((_, j) => j !== k), ctx);
  return `<div class="md-passo${midia ? "" : " sem-imagem"}"><span class="passo-num" aria-hidden="true">${numero}</span>`
    + `${midia ? `<div class="passo-midia">${midia}</div>` : ""}<div class="passo-texto"><span class="sr-only">Passo ${numero}. </span>${texto}</div></div>`;
}
/* :::comparar — as duas primeiras imagens, com um controle deslizante (sem duas imagens vira texto normal) */
function htmlComparar(corpo, ctx) {
  const imgs = [];
  corpo.forEach((l) => { for (const r of l.matchAll(RE_IMG_CADERNO)) imgs.push({ id: r[1], p: lerParametrosImagem(r[2]) }); });
  if (imgs.length < 2) return null;
  imgs.forEach((x) => ctx.imagens.push(x.id));
  const [antes, depois] = imgs;
  const nome = (x, padrao) => escapar(textoPuro(x.p.legenda) || padrao);
  return `<div class="md-comparar" style="--pos:50%"><div class="comparar-quadro">`
    + `<img src="${PIXEL}" alt="${nome(depois, "Depois")}" data-img-id="${escapar(depois.id)}">`
    + `<span class="comparar-antes"><img src="${PIXEL}" alt="${nome(antes, "Antes")}" data-img-id="${escapar(antes.id)}"></span>`
    + `<span class="comparar-linha" aria-hidden="true"></span>`
    + `<input type="range" class="comparar-controle" min="0" max="100" value="50" aria-label="Comparar ${nome(antes, "Antes")} e ${nome(depois, "Depois")}"></div>`
    + `<div class="comparar-legendas"><span>${inline(antes.p.legenda || "Antes", ctx)}</span><span>${inline(depois.p.legenda || "Depois", ctx)}</span></div></div>`;
}

/* :::selo <tipo> — etiqueta colorida com a explicação (title e texto para leitor de tela) */
function htmlSelo(corpo, tipo, ctx) {
  const s = SELOS[tipo];
  return `<div class="md-selo selo-${tipo}" data-selo="${tipo}"><p class="selo-etiqueta" title="${escapar(s.explicacao)}">${svg(s.icone)}<span>${escapar(s.rotulo)}</span>`
    + `<span class="sr-only">: ${escapar(s.explicacao)}</span></p><div class="selo-corpo">${blocos(corpo, ctx)}</div></div>`;
}
/* :::diagrama <id> — só diagramas fornecidos pela página (SVG próprio, nunca texto da nota), com a versão em lista */
function htmlDiagrama(id, ctx) {
  const d = ctx.diagramas[id];
  if (!d) return null;
  return `<figure class="md-diagrama" role="group" aria-label="${escapar(d.titulo)}">${d.svg}`
    + `<figcaption>${inline(d.legenda || d.titulo, ctx)}</figcaption>`
    + `<details class="diagrama-lista"><summary>Ver o diagrama em lista</summary><ol>${d.passos.map((p) => `<li>${inline(p, ctx)}</li>`).join("")}</ol></details></figure>`;
}

/* Linha de fechamento de um bloco ":::" (conta blocos dentro dele e pula cercas de código); -1 = sem fechamento */
function fimDoBloco(linhas, inicio) {
  let nivel = 1;
  let cerca = null;
  for (let j = inicio + 1; j < linhas.length; j++) {
    const f = /^\s*(`{3,}|~{3,})/.exec(linhas[j]);
    if (f && (!cerca || f[1][0] === cerca)) { cerca = cerca ? null : f[1][0]; continue; }
    if (cerca) continue;
    if (RE_BLOCO_ABRE.test(linhas[j])) nivel++;
    else if (RE_BLOCO_FECHA.test(linhas[j]) && --nivel === 0) return j;
  }
  return -1;
}

/* raiz: só as tabelas do nível de fora ganham "Editar tabela" (a posição delas é a linha no texto da nota) */
function blocos(linhas, ctx, raiz = false) {
  let html = "";
  let i = 0;
  while (i < linhas.length) {
    const linha = linhas[i];
    if (!linha.trim()) { i++; continue; }

    let m = RE_CERCA.exec(linha);
    if (m) {
      const marca = m[1][0];
      const corpo = [];
      i++;
      while (i < linhas.length && !new RegExp(`^\\s*\\${marca}{3,}\\s*$`).test(linhas[i])) corpo.push(linhas[i++]);
      i++;
      let ling = m[2] || "";
      let quebrar = !!m[3];
      if (ling === "quebrar" && !quebrar) { ling = ""; quebrar = true; }
      html += `<pre${ling ? ` data-ling="${escapar(ling)}"` : ""}${quebrar ? ' class="quebrar"' : ""}><button type="button" class="pre-copiar" data-copiar-codigo>Copiar</button><code>${escapar(corpo.join("\n"))}</code></pre>`;
      continue;
    }

    m = RE_DETALHES.exec(linha);
    if (m) {
      const corpo = [];
      let nivel = 1;
      i++;
      while (i < linhas.length) {
        if (RE_BLOCO_ABRE.test(linhas[i])) nivel++;
        else if (RE_BLOCO_FECHA.test(linhas[i]) && --nivel === 0) break;
        corpo.push(linhas[i++]);
      }
      i++;
      html += `<details class="md-detalhes"><summary>${inline(m[1].trim() || "Detalhes", ctx)}</summary>${blocos(corpo, ctx)}</details>`;
      continue;
    }

    m = RE_DIAGRAMA.exec(linha);
    if (m) {
      const fig = htmlDiagrama(m[1].toLowerCase(), ctx);
      if (fig) { html += fig; i++; continue; }
    }

    /* Galeria, passo, comparar e selo: sem a linha ":::" de fechamento, o texto aparece como está */
    m = RE_GALERIA.exec(linha) || RE_PASSO.exec(linha) || RE_COMPARAR.exec(linha) || RE_SELO.exec(linha);
    if (m) {
      const fim = fimDoBloco(linhas, i);
      const corpo = fim > 0 ? linhas.slice(i + 1, fim) : null;
      let bloco = null;
      if (corpo && RE_SELO.test(linha)) bloco = htmlSelo(corpo, m[1].toLowerCase(), ctx);
      else if (corpo && RE_GALERIA.test(linha)) bloco = htmlGaleria(corpo, +(m[1] || 3), ctx);
      else if (corpo && RE_PASSO.test(linha)) bloco = htmlPasso(corpo, m[1] ? (ctx.passos = +m[1]) : ++ctx.passos, ctx);
      else if (corpo) bloco = htmlComparar(corpo, ctx) ?? blocos(corpo, ctx);
      if (bloco != null) { html += bloco; i = fim + 1; continue; }
    }

    m = RE_TITULO.exec(linha);
    if (m) {
      const nivel = m[1].length;
      const id = idTitulo(m[2], ctx);
      ctx.titulos.push({ nivel, texto: textoPuro(m[2]), id });
      html += `<h${nivel} id="${id}">${inline(m[2], ctx)}</h${nivel}>`;
      i++;
      continue;
    }

    if (RE_HR.test(linha)) {
      const t = linha.trim();
      html += /^\*(\s+\*){2,}$/.test(t) ? '<hr class="hr-pontilhada">' : /^_(\s+_){2,}$/.test(t) ? '<hr class="hr-espaco">' : "<hr>";
      i++;
      continue;
    }

    m = RE_IMG_SOZINHA.exec(linha);
    if (m) { html += `<div class="md-bloco-img">${inline(m[1], ctx)}</div>`; i++; continue; }

    if (/^\s*>/.test(linha)) {
      const corpo = [];
      while (i < linhas.length && /^\s*>/.test(linhas[i])) corpo.push(linhas[i++].replace(/^\s*>\s?/, ""));
      const c = /^\[!([\wÀ-ÿ-]+)\]([+-]?)\s*(.*)$/.exec(corpo[0] || "");
      if (c) {
        const chave = normalizar(c[1]);
        const tipo = CALLOUTS[chave] ? chave : APELIDOS_CALLOUT[chave] || "info";
        const def = CALLOUTS[tipo];
        const titulo = c[3].trim() ? inline(c[3].trim(), ctx) : escapar(def.titulo);
        const cabeca = `${svg(def.icone)}<span>${titulo}</span>`;
        const interno = blocos(corpo.slice(1), ctx);
        html += c[2]
          ? `<details class="md-callout callout-${tipo}"${c[2] === "+" ? " open" : ""}><summary>${cabeca}</summary><div class="callout-corpo">${interno}</div></details>`
          : `<div class="md-callout callout-${tipo}" role="note"><p class="callout-titulo">${cabeca}</p>${interno ? `<div class="callout-corpo">${interno}</div>` : ""}</div>`;
      } else {
        html += `<blockquote>${blocos(corpo, ctx)}</blockquote>`;
      }
      continue;
    }

    if (linha.includes("|") && i + 1 < linhas.length && RE_SEP_TABELA.test(linhas[i + 1])) {
      const inicio = i;
      const cabecalho = celulasTabela(linha);
      const alinhamentos = celulasTabela(linhas[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""));
      i += 2;
      const corpo = [];
      while (i < linhas.length && linhas[i].trim() && linhas[i].includes("|")) corpo.push(celulasTabela(linhas[i++]));
      const atributos = i < linhas.length ? lerAtributosTabela(linhas[i]) : null;
      if (atributos) i++;
      const indice = raiz ? ctx.tabelas.push({ inicio, fim: i }) - 1 : -1;
      html += htmlTabela(cabecalho, alinhamentos, corpo, atributos || {}, ctx, indice);
      continue;
    }

    if (RE_ITEM_LISTA.test(linha)) {
      const r = lista(linhas, i, ctx);
      html += r.html;
      i = r.fim;
      continue;
    }

    const paragrafo = [linha];
    i++;
    while (i < linhas.length && linhas[i].trim() && !ehInicioDeBloco(linhas, i)) paragrafo.push(linhas[i++]);
    html += `<p>${paragrafo.map((l) => inline(l.trim(), ctx)).join("<br>")}</p>`;
  }
  return html;
}

function lista(linhas, inicio, ctx) {
  const primeira = RE_ITEM_LISTA.exec(linhas[inicio]);
  const base = indentacao(linhas[inicio]);
  const ordenada = /\d/.test(primeira[2]);
  const itens = [];
  let i = inicio;
  while (i < linhas.length) {
    const l = linhas[i];
    if (!l.trim()) {
      let j = i + 1;
      while (j < linhas.length && !linhas[j].trim()) j++;
      if (j < linhas.length && itens.length && indentacao(linhas[j]) > base + 1) { itens[itens.length - 1].filhos.push(""); i = j; continue; }
      const mj = j < linhas.length ? RE_ITEM_LISTA.exec(linhas[j]) : null;
      if (mj && Math.abs(indentacao(linhas[j]) - base) <= 1 && /\d/.test(mj[2]) === ordenada) { i = j; continue; }
      break;
    }
    const ind = indentacao(l);
    const m = RE_ITEM_LISTA.exec(l);
    if (ind < base) break;
    if (m && ind <= base + 1) {
      if (/\d/.test(m[2]) !== ordenada) break;
      itens.push({ texto: [m[3]], filhos: [], num: parseInt(m[2], 10) });
      i++;
      continue;
    }
    if (!itens.length) break;
    const atual = itens[itens.length - 1];
    if (ind > base + 1) { atual.filhos.push(l); i++; continue; }
    if (ehInicioDeBloco(linhas, i)) break;
    atual.texto.push(l.trim());
    i++;
  }
  const linhasInline = (texto) => texto.split("\n").map((t) => inline(t, ctx)).join("<br>");
  const tag = ordenada ? "ol" : "ul";
  const inicioNum = ordenada && itens[0].num > 1 ? ` start="${itens[0].num}"` : "";
  const html = `<${tag}${inicioNum}>${itens.map((it) => {
    const texto = it.texto.join("\n");
    const tarefa = /^\[( |x|X)\](?:[ \t]+|$)([\s\S]*)$/.exec(texto);
    const numero = tarefa ? ctx.tarefas++ : -1;
    let filhos = "";
    if (it.filhos.length) {
      const preenchidas = it.filhos.filter((f) => f.trim());
      const recuo = preenchidas.length ? Math.min(...preenchidas.map(indentacao)) : 0;
      filhos = blocos(it.filhos.map((f) => f.replace(/^\t+/, (t) => "  ".repeat(t.length)).slice(Math.min(recuo, indentacao(f)))), ctx);
    }
    if (tarefa) {
      const feita = tarefa[1] !== " ";
      return `<li class="tarefa${feita ? " feita" : ""}"><input type="checkbox" data-tarefa="${numero}"${feita ? " checked" : ""}${ctx.editavel ? "" : " disabled"} aria-label="${feita ? "Tarefa concluída" : "Tarefa pendente"}"><span class="tarefa-texto">${linhasInline(tarefa[2])}${filhos}</span></li>`;
    }
    return `<li>${linhasInline(texto)}${filhos}</li>`;
  }).join("")}</${tag}>`;
  return { html, fim: i };
}

function htmlLinkInterno(alvo, ancora, rotulo, ctx) {
  const id = ctx.resolverNota(alvo);
  const texto = escapar(rotulo ? rotulo.trim() : alvo + (ancora ? ` › ${ancora.trim()}` : ""));
  if (id) {
    return `<a href="?c=${encodeURIComponent(ctx.slug)}&amp;n=${encodeURIComponent(id)}" class="md-wiki" data-nota="${escapar(id)}"${ancora ? ` data-ancora="${escapar(ancora.trim())}"` : ""}>${texto}</a>`;
  }
  return `<a href="#" class="md-wiki md-wiki-novo" data-criar="${escapar(alvo)}" title="Esta nota ainda não existe">${texto}</a>`;
}

/* Parâmetros da imagem: o 1º é sempre a legenda (como antes); depois, em qualquer ordem:
   pequena|media|grande|inteira, larg=10..100 (%), alinhar=esquerda|centro|direita, ao-lado,
   borda, sombra, arredondada, moldura, alt=…, link=https://… ou link=nota:Nome, original=<id>.
   Parâmetro desconhecido é ignorado na exibição, mas continua no texto. */
const TAMANHOS_IMG = { pequena: "pequena", media: "media", "média": "media", grande: "grande", inteira: "inteira" };
const ESTILOS_IMG = ["borda", "sombra", "arredondada", "moldura"];
function lerParametrosImagem(texto) {
  const partes = String(texto || "").split("|").slice(1);
  const p = { legenda: (partes[0] || "").trim(), tamanho: "", larg: 0, alinhar: "", aoLado: false, estilos: [], alt: "", link: "", original: "", outros: [] };
  partes.slice(1).forEach((bruto) => {
    const t = bruto.trim();
    const minusc = t.toLowerCase();
    let m;
    if (!t) return;
    if (TAMANHOS_IMG[minusc]) p.tamanho = TAMANHOS_IMG[minusc];
    else if ((m = /^larg=(\d{1,3})$/i.exec(t))) p.larg = limitar(+m[1], 10, 100);
    else if ((m = /^alinhar=(esquerda|centro|direita)$/i.exec(t))) p.alinhar = m[1].toLowerCase();
    else if (minusc === "ao-lado") p.aoLado = true;
    else if (ESTILOS_IMG.includes(minusc)) { if (!p.estilos.includes(minusc)) p.estilos.push(minusc); }
    else if ((m = /^alt=(.*)$/i.exec(t))) p.alt = m[1].trim().slice(0, 200);
    else if ((m = /^link=(.+)$/i.exec(t))) p.link = m[1].trim();
    else if ((m = /^original=([\w-]{1,60})$/i.exec(t))) p.original = m[1];
    else p.outros.push(t);
  });
  return p;
}
/* Legenda e texto alternativo não podem ter "|", quebra de linha nem "]" solto (um "]" seguido de "(" é link) */
const limparLegenda = (t) => String(t || "").replace(/[|\r\n]+/g, " ").replace(/\](?!\()/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
const limparAlt = (t) => String(t || "").replace(/[|\r\n\[\]=]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
function montarTagImagem(id, p) {
  const partes = [p.legenda || ""];
  if (p.tamanho) partes.push(p.tamanho);
  if (p.larg) partes.push(`larg=${p.larg}`);
  if (p.alinhar) partes.push(`alinhar=${p.alinhar}`);
  if (p.aoLado) partes.push("ao-lado");
  ESTILOS_IMG.forEach((e) => { if (p.estilos.includes(e)) partes.push(e); });
  if (p.alt) partes.push(`alt=${p.alt}`);
  if (p.link) partes.push(`link=${p.link}`);
  if (p.original) partes.push(`original=${p.original}`);
  partes.push(...(p.outros || []));
  while (partes.length > 1 && !partes[partes.length - 1]) partes.pop();
  return `![[img:${id}${partes.length === 1 && !partes[0] ? "" : `|${partes.join("|")}`}]]`;
}
/* Destino do link da imagem: endereço seguro ou nota do caderno (link=nota:Nome) */
function destinoLinkImagem(link, ctx) {
  const m = /^nota:(.+)$/i.exec(link || "");
  if (m) {
    const id = ctx.resolverNota(m[1].trim());
    return id ? { href: `?c=${encodeURIComponent(ctx.slug)}&n=${encodeURIComponent(id)}`, nota: id } : null;
  }
  const u = link && urlLinkSegura(link);
  return u ? { href: u, externo: /^(https?:|mailto:)/i.test(u) } : null;
}

function htmlFigura(id, bruto, ctx) {
  const p = lerParametrosImagem(bruto);
  const tamanho = p.tamanho || "media";
  const indice = ctx.imagens.push(id) - 1;
  const leg = p.legenda;
  const alt = p.alt || textoPuro(leg);
  const classes = ["md-figura", `larg-${tamanho}`, p.larg && "larg-livre", p.alinhar && `alinhar-${p.alinhar}`, p.aoLado && "ao-lado", ...p.estilos.map((e) => `estilo-${e}`)].filter(Boolean).join(" ");
  const imagem = `<img src="${PIXEL}" alt="${escapar(alt)}" data-img-id="${escapar(id)}">`;
  const destino = p.link ? destinoLinkImagem(p.link, ctx) : null;
  const abrir = destino
    ? `<a class="md-figura-abrir md-figura-link" href="${escapar(destino.href)}"${destino.nota ? ` data-nota-img="${escapar(destino.nota)}"` : ""}${destino.externo ? ' target="_blank" rel="noopener noreferrer"' : ""} aria-label="${escapar(alt || "Imagem")} (abre ${destino.nota ? "a nota" : "o link"})">${imagem}</a>`
    : `<button type="button" class="md-figura-abrir" data-abrir-img="${indice}" aria-label="Ampliar imagem${alt ? `: ${escapar(alt)}` : ""}">${imagem}</button>`;
  const botao = (attrs, titulo, conteudo, pressionado) => `<button type="button" ${attrs} data-img-indice="${indice}" title="${titulo}" aria-label="${titulo}"${pressionado != null ? ` aria-pressed="${pressionado}"` : ""}>${conteudo}</button>`;
  const barra = ctx.editavel
    ? `<span class="figura-barra" role="toolbar" aria-label="Imagem">`
      + [["pequena", "P", "Pequena"], ["media", "M", "Média"], ["grande", "G", "Grande"], ["inteira", "I", "Inteira"]].map(([v, l, n]) => botao(`data-img-tamanho="${v}"`, `Tamanho ${n}`, l, !p.larg && tamanho === v)).join("")
      + `<span class="sep" aria-hidden="true"></span>`
      + botao('data-img-menu="alinhar" aria-haspopup="menu"', "Alinhamento", svg(p.aoLado ? "i-texto-lado" : `i-alinhar-${p.alinhar || "centro"}`))
      + botao('data-img-menu="estilo" aria-haspopup="menu"', "Estilo", svg("i-moldura"))
      + botao('data-img-menu="legenda"', "Editar legenda", svg("i-lapis"))
      + botao('data-img-menu="mais" aria-haspopup="menu"', "Mais opções da imagem", "⋯")
      + `</span><span class="figura-alca" data-img-alca="${indice}" title="Arraste para mudar a largura" aria-hidden="true"></span>`
    : "";
  return `<span class="${classes}" data-figura="${indice}"${p.larg ? ` style="width:${p.larg}%"` : ""}>${abrir}${leg ? `<span class="legenda">${inline(leg, ctx)}</span>` : ""}${barra}</span>`;
}

function inline(texto, ctx) {
  const guardados = [];
  const guardar = (html) => `\u0000${guardados.push(html) - 1}\u0000`;
  let t = String(texto);
  t = t.replace(/\\([\\`*_{}\[\]()#+\-.!|=~>])/g, (_, c) => guardar(escapar(c)));
  t = t.replace(/(`+)(.+?)\1/g, (_, c, codigo) => guardar(`<code>${escapar(codigo)}</code>`));
  t = t.replace(RE_IMG_CADERNO, (_, id, params) => guardar(htmlFigura(id, params, ctx)));
  t = t.replace(/!\[([^\]\n]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (todo, alt, url) => {
    const u = urlImagemSegura(url);
    return u ? guardar(`<img class="md-img-externa" src="${escapar(u)}" alt="${escapar(alt)}" loading="lazy">`) : todo;
  });
  t = t.replace(/\[\[([^\[\]|#\n]+?)(?:#([^\[\]|\n]+?))?(?:\|([^\[\]\n]+?))?\]\]/g, (_, alvo, ancora, rotulo) => guardar(htmlLinkInterno(alvo.trim(), ancora, rotulo, ctx)));
  /* Título opcional "nova aba" / "mesma aba" troca o padrão (endereços externos abrem em nova aba) */
  t = t.replace(/\[([^\]\n]+)\]\(\s*([^)\s]+)(?:\s+"([^"\n]*)")?\s*\)/g, (todo, rotulo, url, titulo) => {
    const u = urlLinkSegura(url);
    if (!u) return todo;
    const aba = normalizar(titulo || "");
    const novaAba = aba === "nova aba" ? true : aba === "mesma aba" ? false : /^(https?:|mailto:)/i.test(u);
    return guardar(`<a href="${escapar(u)}"${novaAba ? ' target="_blank" rel="noopener noreferrer"' : ""}>${inline(rotulo, ctx)}</a>`);
  });
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<>()\u0000]*[^\s<>().,;:!?'"\u0000])/g, (_, antes, url) => antes + guardar(`<a href="${escapar(url)}" target="_blank" rel="noopener noreferrer">${escapar(url)}</a>`));
  t = escapar(t)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^\s*](?:[^*]*?[^\s*])?)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\p{L}\p{N}])_([^\s_](?:[^_]*?[^\s_])?)_(?![_\p{L}\p{N}])/gu, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/==(?=\S)([\s\S]*?\S)==/g, "<mark>$1</mark>")
    .replace(RE_COR, '<span class="cor-$1">$2</span>')
    .replace(RE_FUNDO, '<span class="fundo-$1">$2</span>')
    .replace(/(^|[\s>(])#([\p{L}_][\p{L}\p{N}_\/-]*)/gu, (_, antes, tag) => `${antes}<a href="#" class="md-tag" data-tag="${tag}">#${tag}</a>`);
  return t.replace(/\u0000(\d+)\u0000/g, (_, n) => guardados[+n]);
}

/* Remove código (bloco e trecho), onde # e [[ ]] não contam como tag nem link */
const semCodigo = (md) => String(md || "")
  .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, "")
  .replace(/`[^`\n]+`/g, "");

function extrairTags(md) {
  const tags = new Set();
  for (const m of semCodigo(md).matchAll(/(^|[\s>(])#([\p{L}_][\p{L}\p{N}_\/-]*)/gu)) tags.add(m[2].toLowerCase());
  return [...tags].slice(0, 200);
}
function extrairAlvos(md) {
  const alvos = new Set();
  for (const m of semCodigo(md).matchAll(/\[\[([^\[\]|#\n]+?)(?:#[^\[\]|\n]+?)?(?:\|[^\[\]\n]+?)?\]\]/g)) alvos.add(m[1].trim());
  return [...alvos];
}
const extrairImagens = (md) => [...new Set([...String(md || "").matchAll(RE_IMG_CADERNO)].map((m) => m[1]))];

/* Troca a n-ésima ocorrência (fora de blocos de código), na mesma ordem em que a leitura numera */
function substituirOcorrencia(md, regex, n, trocar) {
  const linhas = md.split("\n");
  let cerca = null;
  let contagem = 0;
  let feito = false;
  for (let i = 0; i < linhas.length && !feito; i++) {
    const f = /^\s*(`{3,}|~{3,})/.exec(linhas[i]);
    if (f && (!cerca || f[1][0] === cerca)) { cerca = cerca ? null : f[1][0]; continue; }
    if (cerca) continue;
    linhas[i] = linhas[i].replace(regex, (...args) => {
      if (feito) return args[0];
      if (contagem++ === n) { feito = true; return trocar(...args); }
      return args[0];
    });
  }
  return feito ? linhas.join("\n") : null;
}

/* Realce leve da sintaxe no editor (só cor: a medida das letras não muda) */
const RE_REALCE = /(!\[\[img:(?:[^\]\n]|\](?=\())*\]\])|(\[\[[^\]\n]*\]\])|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(==[^=\n]+==)|(~~[^~\n]+~~)|(\{\/?(?:cor|fundo)(?::[a-z]+)?\})|(\[[^\]\n]+\]\([^)\n]+\))|((?:^|(?<=[\s(]))#[\p{L}_][\p{L}\p{N}_\/-]*)/gu;
const CLASSES_REALCE = ["r-img", "r-wiki", "r-codigo-inline", "r-negrito", "r-realce", "r-tachado", "r-cor", "r-link", "r-tag"];

function realcarLinha(linha) {
  let prefixo = "";
  let resto = linha;
  let m = /^(\s*(?:>\s?)+)/.exec(resto);
  if (m) { prefixo += `<span class="r-citacao">${escapar(m[1])}</span>`; resto = resto.slice(m[1].length); }
  m = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s)?)/.exec(resto);
  if (m) { prefixo += `<span class="r-marcador">${escapar(m[1])}</span>`; resto = resto.slice(m[1].length); }
  let html = "";
  let ultimo = 0;
  for (const r of resto.matchAll(RE_REALCE)) {
    html += escapar(resto.slice(ultimo, r.index));
    const grupo = r.slice(1, 10).findIndex((g) => g !== undefined);
    html += `<span class="${CLASSES_REALCE[grupo]}">${escapar(r[0])}</span>`;
    ultimo = r.index + r[0].length;
  }
  return prefixo + html + escapar(resto.slice(ultimo));
}

function realcarMarkdown(md) {
  let cerca = null;
  return md.split("\n").map((linha) => {
    let html;
    const f = /^\s*(`{3,}|~{3,})/.exec(linha);
    if (f && (!cerca || f[1][0] === cerca)) { cerca = cerca ? null : f[1][0]; html = `<span class="r-cerca">${escapar(linha)}</span>`; }
    else if (cerca) html = `<span class="r-codigo">${escapar(linha)}</span>`;
    else if (RE_TITULO.test(linha)) html = `<span class="r-titulo">${escapar(linha)}</span>`;
    else if (/^:::/.test(linha) && (RE_BLOCO_ABRE.test(linha) || RE_BLOCO_FECHA.test(linha) || RE_DIAGRAMA.test(linha))) html = `<span class="r-bloco">${escapar(linha)}</span>`;
    else if (RE_ATRIBUTOS_TABELA.test(linha)) html = `<span class="r-atributo">${escapar(linha)}</span>`;
    else html = realcarLinha(linha);
    return `<div class="ln">${html || "<br>"}</div>`;
  }).join("");
}

/* Busca aproximada (nome de nota, comandos) */
function pontuar(consulta, alvo) {
  const q = normalizar(consulta).trim();
  const t = normalizar(alvo);
  if (!q) return 1;
  const i = t.indexOf(q);
  if (i >= 0) return 200 - Math.min(i, 100) + (i === 0 ? 100 : 0) - t.length / 100;
  let pos = -1;
  let pontos = 0;
  let seguidos = 0;
  for (const ch of q.replace(/\s+/g, "")) {
    const p = t.indexOf(ch, pos + 1);
    if (p < 0) return 0;
    seguidos = p === pos + 1 ? seguidos + 1 : 0;
    pontos += 1 + seguidos * 2;
    pos = p;
  }
  return pontos;
}

/* Trecho com o termo destacado, ignorando acentos (mesma ideia do destacar() do site) */
function trechoDestacado(texto, termo, raio = 70) {
  const letras = Array.from(String(texto).replace(/\s+/g, " "));
  const plano = letras.map((c) => normalizar(c)[0] || " ").join("");
  const q = normalizar(termo).trim();
  const i = q ? plano.indexOf(q) : -1;
  if (i < 0) return escapar(letras.slice(0, raio * 2).join("")) + (letras.length > raio * 2 ? "…" : "");
  const ini = Math.max(0, i - raio);
  const fim = Math.min(letras.length, i + q.length + raio);
  return (ini > 0 ? "…" : "") + escapar(letras.slice(ini, i).join("")) + "<mark>" + escapar(letras.slice(i, i + q.length).join("")) + "</mark>"
    + escapar(letras.slice(i + q.length, fim).join("")) + (fim < letras.length ? "…" : "");
}

export { renderizarMarkdown, textoPuro, pontuar, trechoDestacado, urlLinkSegura, realcarMarkdown, lerAtributosTabela, montarAtributosTabela, celulasTabela, CALLOUTS, CORES, SELOS };
