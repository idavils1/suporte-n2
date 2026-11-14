/*
 * ============================================================
 *  APARÊNCIA LIVRE DA PLANILHA ("Tema livre")
 *  Cópia própria deste site (nenhum código é carregado de fora desta pasta). O mesmo motor existe
 *  nos outros sites do projeto: ao corrigir aqui, corrija lá também.
 *
 *  Tudo vira VARIÁVEIS CSS (style.setProperty no <html>) e classes na grade. Nada de CSS digitado
 *  pela pessoa: cores #RRGGBB(AA), números em faixas e opções de listas fechadas, validados na
 *  leitura (localStorage, Firestore, código importado). O CSS gerado para colunas e regras usa
 *  só ids validados e cores validadas.
 *
 *  Camadas: padrão do site (sem nada) → padrão da planilha (administradoras, Firestore) → pessoal
 *  (este navegador, por planilha: localStorage; a imagem de fundo no IndexedDB).
 *  "<prefixo>-aparencia-aplicada:<planilha>" guarda as variáveis já calculadas: o tema.js aplica
 *  antes da primeira pintura (sem piscar o tema padrão).
 * ============================================================
 */

/* ------------------------------------------------------------
 *  Utilitários
 * ------------------------------------------------------------ */
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const limitar = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (v, a, b, padrao) => { const n = Number(v); return Number.isFinite(n) ? limitar(Math.round(n), a, b) : padrao; };
const RE_COR = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
const corOk = (v) => typeof v === "string" && RE_COR.test(v);
const corOuVazio = (v) => (corOk(v) ? v.toLowerCase() : "");
const RE_IDCOL = /^[A-Za-z0-9_-]{1,60}$/;
const RE_IDOPC = /^[A-Za-z0-9_-]{1,60}$/;
const umDe = (v, lista, padrao) => (lista.includes(v) ? v : padrao);
const clonar = (x) => JSON.parse(JSON.stringify(x));
const normalizarTexto = (t) => String(t == null ? "" : t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/* Cores: hex ⇄ rgb ⇄ hsl, luminância e contraste WCAG */
function rgb(hex) {
  const h = hex.slice(1);
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}
const dois = (n) => limitar(Math.round(n), 0, 255).toString(16).padStart(2, "0");
const hexDe = ({ r, g, b }, a) => `#${dois(r)}${dois(g)}${dois(b)}${a != null && a < 1 ? dois(a * 255) : ""}`;
function paraHsl(hex) {
  const { r, g, b } = rgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function deHsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s = limitar(s, 0, 1); l = limitar(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hexDe({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}
const opaca = (hex) => hex.slice(0, 7);
function luminancia(hex) {
  const { r, g, b } = rgb(hex);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/* Cor com transparência sobre um fundo opaco (para medir o contraste do que a pessoa vê) */
function sobre(frente, fundo) {
  const a = rgb(frente), b = rgb(opaca(fundo));
  if (a.a >= 1) return opaca(frente);
  return hexDe({ r: a.r * a.a + b.r * (1 - a.a), g: a.g * a.a + b.g * (1 - a.a), b: a.b * a.a + b.b * (1 - a.a) });
}
function contraste(a, b) {
  const la = luminancia(opaca(a)), lb = luminancia(opaca(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function misturar(a, b, p) {
  const x = rgb(a), y = rgb(b);
  return hexDe({ r: x.r + (y.r - x.r) * p, g: x.g + (y.g - x.g) * p, b: x.b + (y.b - x.b) * p });
}
const comAlfa = (hex, a) => hexDe(rgb(opaca(hex)), limitar(a, 0, 1));
const escura = (hex) => luminancia(opaca(hex)) < 0.18;
/* Ajusta a luminosidade mantendo o tom até o contraste chegar ao alvo (texto: 4,5:1; outros: 3:1) */
function ajustarContraste(cor, fundo, alvo = 4.5) {
  cor = opaca(cor);
  if (contraste(cor, fundo) >= alvo) return cor;
  const { h, s, l } = paraHsl(cor);
  const clarear = luminancia(opaca(fundo)) < 0.45;
  for (let i = 1; i <= 50; i++) {
    const nl = clarear ? l + ((1 - l) * i) / 50 : l - (l * i) / 50;
    const c = deHsl(h, s, nl);
    if (contraste(c, fundo) >= alvo) return c;
  }
  return clarear ? "#ffffff" : "#000000";
}
/* Texto automático (claro ou escuro) sobre uma cor */
function textoSobre(fundo, matiz) {
  const f = opaca(fundo);
  const escuroT = matiz != null ? deHsl(matiz, 0.18, 0.1) : "#111212";
  const claroT = matiz != null ? deHsl(matiz, 0.2, 0.96) : "#ffffff";
  return contraste(escuroT, f) >= contraste(claroT, f) ? ajustarContraste(escuroT, f, 4.5) : ajustarContraste(claroT, f, 4.5);
}
/* Versão escura de uma cor de fundo (mantém o tom) */
function versaoEscura(cor, l) {
  const { h, s, l: lAtual } = paraHsl(opaca(cor));
  if (lAtual <= 0.3) return opaca(cor);
  return deHsl(h, Math.min(s, 0.32), l);
}
/* Cores escolhidas para fundos (cabeçalho, regras, colunas) no modo escuro */
const paraModo = (cor, modo, l = 0.24) => (modo === "escuro" && corOk(cor) && paraHsl(opaca(cor)).l > 0.55 ? versaoEscura(cor, l) : cor);
const RE_HSL_ID = /^ap-/;

/* ------------------------------------------------------------
 *  Modelo do tema (validado em toda leitura)
 * ------------------------------------------------------------ */
const NOMES_COR = ["cinza", "vermelho", "laranja", "amarelo", "verde", "azul", "roxo", "rosa"];
const NOME_COR = { cinza: "Cinza", vermelho: "Vermelho", laranja: "Laranja", amarelo: "Amarelo", verde: "Verde", azul: "Azul", roxo: "Roxo", rosa: "Rosa" };
/* Variáveis que o modo avançado ajusta (nome amigável) */
const VARS_AVANCADAS = [
  ["--cor-acao", "Texto"], ["--texto-secundario", "Texto secundário"], ["--fundo", "Fundo da página"], ["--superficie", "Grade e caixas"],
  ["--superficie-suave", "Superfície suave"], ["--superficie-quente", "Superfície das barras"], ["--borda", "Bordas"], ["--borda-forte", "Bordas fortes"],
  ["--lilas", "Destaque"], ["--lilas-destaque", "Destaque suave"], ["--cor-icone", "Ícones e links"], ["--btn-fundo", "Botão"], ["--btn-texto", "Texto do botão"],
  ["--foco", "Foco do teclado"], ["--ap-cab-fundo", "Cabeçalho da planilha"], ["--ap-cab-texto", "Texto do cabeçalho"], ["--ap-zebra", "Linha alternada"],
  ["--ap-hover", "Linha ao passar o mouse"], ["--ap-selecao", "Linha selecionada"], ["--ap-ativa", "Célula ativa"], ["--ap-nova", "Linha nova"],
  ["--ap-borda", "Bordas da grade"], ["--ap-fixa", "1ª coluna"]
];
const NOMES_AVANCADOS = VARS_AVANCADAS.map((v) => v[0]);
const FORMAS = { pontos: "Pontos", listras: "Listras diagonais", grade: "Grade", xadrez: "Xadrez", ondas: "Ondas", circulos: "Círculos", triangulos: "Triângulos", quadriculado: "Papel quadriculado" };
const ICONES_REGRA = { "": "Nenhum", alerta: "⚠ Alerta", estrela: "★ Estrela", check: "✓ Certo", relogio: "⏱ Relógio", bandeira: "⚑ Bandeira", ponto: "● Ponto", info: "ℹ Informação" };
const CONTEUDO_ICONE = { alerta: "\\26A0", estrela: "\\2605", check: "\\2713", relogio: "\\23F1", bandeira: "\\2691", ponto: "\\25CF", info: "\\2139" };
const FONTES = { site: '"Bricolage Grotesque", system-ui, sans-serif', sistema: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', mono: 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "Liberation Mono", monospace' };

const temaBase = () => ({
  v: 1, nome: "", alto: false,
  base: { destaque: "#9b7fd4", fundo: "#ffffff", grade: "#ffffff" },
  avancado: { claro: {}, escuro: {} },
  listas: { claro: {}, escuro: {} },
  fundo: {
    tipo: "nenhum", area: "pagina", cor: "#eef0f6",
    g: { tipo: "linear", cores: ["#c9b8e6", "#9bd3f0"], angulo: 135, x: 50, y: 50 },
    p: { forma: "pontos", cor: "#9b7fd4", fundo: "#f4f2f8", opacidade: 35, escala: 24, rotacao: 0 },
    i: { ajuste: "cobrir", focoX: 50, focoY: 50, desfoque: 0, brilho: 100, saturacao: 100, veuCor: "#ffffff", veuOpacidade: 35 },
    temImagem: false
  },
  grade: {
    solida: true, opacidade: 92, vidro: false, cabFundo: "", cabTexto: "", cabNegrito: true, cabMaiusculas: false,
    zebra: true, zebraCor: "", hoverCor: "", selecaoCor: "", ativaCor: "", novaCor: "", bordaCor: "", borda: "normal", bordaEstilo: "todas",
    cantos: 8, sombra: "nenhuma", fixaCor: "", fonte: "site", mono: []
  },
  colunas: {}
});
function validarMapaCores(m, chaves) {
  const r = {};
  if (m && typeof m === "object") Object.keys(m).slice(0, 60).forEach((k) => { if (chaves.includes(k) && corOk(m[k])) r[k] = m[k].toLowerCase(); });
  return r;
}
function validarTema(t) {
  if (!t || typeof t !== "object") return null;
  const b = temaBase();
  const base = t.base || {};
  b.nome = String(t.nome || "").slice(0, 40);
  b.alto = t.alto === true;
  b.base = { destaque: corOk(base.destaque) ? opaca(base.destaque) : b.base.destaque, fundo: corOk(base.fundo) ? opaca(base.fundo) : b.base.fundo, grade: corOk(base.grade) ? opaca(base.grade) : b.base.grade };
  const av = t.avancado || {};
  b.avancado = { claro: validarMapaCores(av.claro, NOMES_AVANCADOS), escuro: validarMapaCores(av.escuro, NOMES_AVANCADOS) };
  const li = t.listas || {};
  ["claro", "escuro"].forEach((m) => {
    const src = li[m] || {};
    b.listas[m] = {};
    NOMES_COR.forEach((c) => { const x = src[c]; if (x && typeof x === "object" && (corOk(x.c) || corOk(x.f))) b.listas[m][c] = { c: corOuVazio(x.c), f: corOuVazio(x.f) }; });
  });
  const f = t.fundo || {}, g = f.g || {}, p = f.p || {}, im = f.i || {};
  b.fundo = {
    tipo: umDe(f.tipo, ["nenhum", "cor", "gradiente", "padrao", "imagem"], "nenhum"),
    area: umDe(f.area, ["pagina", "moldura"], "pagina"),
    cor: corOk(f.cor) ? opaca(f.cor) : b.fundo.cor,
    g: {
      tipo: umDe(g.tipo, ["linear", "radial"], "linear"),
      cores: (Array.isArray(g.cores) ? g.cores.filter(corOk).map(opaca) : []).slice(0, 3),
      angulo: num(g.angulo, 0, 360, 135), x: num(g.x, 0, 100, 50), y: num(g.y, 0, 100, 50)
    },
    p: {
      forma: umDe(p.forma, Object.keys(FORMAS), "pontos"), cor: corOk(p.cor) ? opaca(p.cor) : b.fundo.p.cor, fundo: corOk(p.fundo) ? opaca(p.fundo) : b.fundo.p.fundo,
      opacidade: num(p.opacidade, 5, 100, 35), escala: num(p.escala, 8, 120, 24), rotacao: num(p.rotacao, 0, 360, 0)
    },
    i: {
      ajuste: umDe(im.ajuste, ["cobrir", "conter", "repetir"], "cobrir"), focoX: num(im.focoX, 0, 100, 50), focoY: num(im.focoY, 0, 100, 50),
      desfoque: num(im.desfoque, 0, 20, 0), brilho: num(im.brilho, 40, 160, 100), saturacao: num(im.saturacao, 0, 200, 100),
      veuCor: corOk(im.veuCor) ? opaca(im.veuCor) : "#ffffff", veuOpacidade: num(im.veuOpacidade, 0, 85, 35)
    },
    temImagem: f.temImagem === true
  };
  if (b.fundo.g.cores.length < 2) b.fundo.g.cores = temaBase().fundo.g.cores;
  const gr = t.grade || {};
  b.grade = {
    solida: gr.solida !== false, opacidade: num(gr.opacidade, 60, 100, 92), vidro: gr.vidro === true,
    cabFundo: corOuVazio(gr.cabFundo), cabTexto: corOuVazio(gr.cabTexto), cabNegrito: gr.cabNegrito !== false, cabMaiusculas: gr.cabMaiusculas === true,
    zebra: gr.zebra !== false, zebraCor: corOuVazio(gr.zebraCor), hoverCor: corOuVazio(gr.hoverCor), selecaoCor: corOuVazio(gr.selecaoCor),
    ativaCor: corOuVazio(gr.ativaCor), novaCor: corOuVazio(gr.novaCor), bordaCor: corOuVazio(gr.bordaCor),
    borda: umDe(gr.borda, ["fina", "normal", "grossa"], "normal"), bordaEstilo: umDe(gr.bordaEstilo, ["todas", "horizontais", "nenhuma"], "todas"),
    cantos: umDe(Number(gr.cantos), [0, 4, 8, 12], 8), sombra: umDe(gr.sombra, ["nenhuma", "suave", "forte"], "nenhuma"),
    fixaCor: corOuVazio(gr.fixaCor), fonte: umDe(gr.fonte, ["site", "sistema", "mono"], "site"),
    mono: (Array.isArray(gr.mono) ? gr.mono.filter((c) => typeof c === "string" && RE_IDCOL.test(c)) : []).slice(0, 80)
  };
  b.colunas = {};
  if (t.colunas && typeof t.colunas === "object") {
    Object.keys(t.colunas).slice(0, 80).forEach((id) => {
      const c = t.colunas[id];
      if (!RE_IDCOL.test(id) || !c || typeof c !== "object") return;
      const x = { cab: corOuVazio(c.cab), tom: corOuVazio(c.tom), cheia: c.cheia === true };
      if (x.cab || x.tom || x.cheia) b.colunas[id] = x;
    });
  }
  return b;
}
/* Regras de cor (formatação condicional) */
const CONDICOES = {
  texto: [["igual", "é igual a"], ["contem", "contém"], ["comeca", "começa com"], ["vazio", "está vazio"], ["naoVazio", "não está vazio"]],
  lista: [["em", "é uma destas opções"], ["naoEm", "não é nenhuma destas"], ["vazio", "está vazio"], ["naoVazio", "não está vazio"]],
  numero: [["eq", "="], ["ne", "≠"], ["gt", ">"], ["lt", "<"], ["entre", "entre"], ["vazio", "está vazio"], ["naoVazio", "não está vazio"]],
  data: [["antes", "antes de"], ["depois", "depois de"], ["ultimos", "nos últimos N dias"], ["haMais", "há mais de N dias"], ["hoje", "é hoje"], ["vazio", "está vazio"], ["naoVazio", "não está vazio"]],
  booleano: [["sim", "é sim"], ["nao", "é não"]]
};
const TODAS_CONDICOES = [...new Set(Object.values(CONDICOES).flat().map((c) => c[0])), "corOpcao", "obrigatorios"];
const MAX_REGRAS = 30;
function validarRegra(r) {
  if (!r || typeof r !== "object") return null;
  const cond = umDe(r.cond, TODAS_CONDICOES, "");
  if (!cond) return null;
  if (cond !== "obrigatorios" && !RE_IDCOL.test(r.col || "")) return null;
  return {
    id: /^[a-z0-9]{1,16}$/.test(r.id || "") ? r.id : Math.random().toString(36).slice(2, 10),
    ativa: r.ativa !== false, col: cond === "obrigatorios" ? "" : r.col, cond,
    valores: (Array.isArray(r.valores) ? r.valores.filter((v) => typeof v === "string" && RE_IDOPC.test(v)) : []).slice(0, 60),
    valor: String(r.valor == null ? "" : r.valor).slice(0, 120), valor2: String(r.valor2 == null ? "" : r.valor2).slice(0, 120),
    n: num(r.n, 0, 3650, 30),
    alvo: umDe(r.alvo, ["linha", "celula", "texto"], "linha"),
    fundo: corOuVazio(r.fundo), texto: corOuVazio(r.texto), negrito: r.negrito === true, riscado: r.riscado === true,
    icone: umDe(r.icone, Object.keys(ICONES_REGRA), "")
  };
}
const validarRegras = (lista) => (Array.isArray(lista) ? lista.map(validarRegra).filter(Boolean).slice(0, MAX_REGRAS) : []);

/* ------------------------------------------------------------
 *  Temas prontos
 * ------------------------------------------------------------ */
function preset(nome, base, extra = {}) {
  const t = temaBase();
  t.nome = nome;
  t.base = { ...t.base, ...base };
  Object.keys(extra).forEach((k) => { t[k] = typeof extra[k] === "object" && !Array.isArray(extra[k]) ? { ...t[k], ...extra[k] } : extra[k]; });
  return validarTema(t);
}
const PRESETS = [
  ["lilas", preset("Lilás", { destaque: "#9b7fd4", fundo: "#ffffff", grade: "#ffffff" })],
  ["oceano", preset("Oceano", { destaque: "#1f7fbf", fundo: "#eaf4fa", grade: "#ffffff" }, { grade: { cabFundo: "#d6eaf7" } })],
  ["floresta", preset("Floresta", { destaque: "#2f7d4f", fundo: "#edf5ee", grade: "#ffffff" }, { grade: { cabFundo: "#dcefe0", cantos: 12 } })],
  ["por-do-sol", preset("Pôr do sol", { destaque: "#d9582b", fundo: "#fff3ea", grade: "#fffaf6" }, {
    fundo: { tipo: "gradiente", area: "moldura", g: { tipo: "linear", cores: ["#ffcf9e", "#f7a1a8", "#b58ad8"], angulo: 135, x: 50, y: 50 } }, grade: { cabFundo: "#ffe2cf", sombra: "suave", cantos: 12 } })],
  ["grafite", preset("Grafite", { destaque: "#4b5563", fundo: "#f1f2f4", grade: "#ffffff" }, { grade: { cabFundo: "#e3e5e8", cantos: 4 } })],
  ["areia", preset("Areia", { destaque: "#9a6b2f", fundo: "#f6efe2", grade: "#fffdf8" }, {
    fundo: { tipo: "padrao", area: "pagina", p: { forma: "pontos", cor: "#c9a77a", fundo: "#f6efe2", opacidade: 30, escala: 22, rotacao: 0 } }, grade: { cabFundo: "#efe3cd" } })],
  ["pastel", preset("Pastel", { destaque: "#7a8fd6", fundo: "#f5f2fb", grade: "#fefdff" }, { grade: { cabFundo: "#e9e4f7", zebraCor: "#f4f8fd", cantos: 12 } })],
  ["noite-neon", preset("Noite neon", { destaque: "#22d3ee", fundo: "#0b0f1a", grade: "#111827" }, {
    fundo: { tipo: "padrao", area: "pagina", p: { forma: "grade", cor: "#22d3ee", fundo: "#0b0f1a", opacidade: 12, escala: 32, rotacao: 0 } }, grade: { cabFundo: "#0e1d2b", sombra: "forte" } })],
  ["vcert", preset("V/Cert", { destaque: "#c8102e", fundo: "#f4f4f4", grade: "#ffffff" }, { grade: { cabFundo: "#111111", cabTexto: "#ffffff", cabMaiusculas: true, ativaCor: "#c8102e", cantos: 4 } })],
  ["alto-contraste", preset("Alto contraste", { destaque: "#0040c0", fundo: "#ffffff", grade: "#ffffff" }, {
    alto: true,
    avancado: { claro: { "--cor-acao": "#000000", "--texto-secundario": "#1f1f1f", "--borda": "#000000", "--borda-forte": "#000000", "--ap-borda": "#000000" },
      escuro: { "--fundo": "#000000", "--superficie": "#000000", "--cor-acao": "#ffffff", "--texto-secundario": "#f0f0f0", "--lilas": "#ffd400", "--cor-icone": "#ffd400", "--borda": "#ffffff", "--borda-forte": "#ffffff", "--ap-borda": "#ffffff", "--ap-ativa": "#ffd400" } },
    grade: { borda: "grossa", cabNegrito: true } })]
];

/* ------------------------------------------------------------
 *  Geração das variáveis (claro e escuro) a partir das escolhas
 * ------------------------------------------------------------ */
const querMaisContraste = () => { try { return matchMedia("(prefers-contrast: more)").matches; } catch (e) { return false; } };
function gerarVariaveis(t, modo) {
  const alvoTexto = t.alto || querMaisContraste() ? 7 : 4.5;
  let D = t.base.destaque, F = t.base.fundo, G = t.base.grade;
  if (modo === "escuro") {
    F = versaoEscura(F, 0.075);
    G = versaoEscura(G, 0.115);
  }
  const matiz = paraHsl(D).h;
  const v = {};
  v["--fundo"] = F;
  v["--superficie"] = G;
  const textoBase = escura(G) ? deHsl(matiz, 0.14, 0.94) : deHsl(matiz, 0.12, 0.08);
  v["--superficie-suave"] = misturar(G, D, escura(G) ? 0.07 : 0.045);
  v["--superficie-quente"] = misturar(G, D, escura(G) ? 0.14 : 0.1);
  v["--lilas"] = escura(G) ? ajustarContraste(D, G, 3) : D;
  v["--lilas-destaque"] = misturar(G, D, escura(G) ? 0.3 : 0.22);
  let texto = textoBase;
  [G, F, v["--superficie-suave"], v["--superficie-quente"], v["--lilas-destaque"]].forEach((x) => { texto = ajustarContraste(texto, x, alvoTexto); });
  v["--cor-acao"] = texto;
  let sec = misturar(texto, G, 0.38);
  [G, v["--superficie-suave"], v["--superficie-quente"]].forEach((x) => { sec = ajustarContraste(sec, x, 4.5); });
  v["--texto-secundario"] = sec;
  v["--placeholder"] = sec;
  v["--borda"] = misturar(G, texto, escura(G) ? 0.16 : 0.12);
  v["--borda-forte"] = misturar(G, D, escura(G) ? 0.45 : 0.38);
  v["--cor-icone"] = ajustarContraste(D, v["--superficie-quente"], 4.5);
  v["--btn-fundo"] = escura(G) ? ajustarContraste(D, G, 4.5) : texto;
  v["--btn-texto"] = textoSobre(v["--btn-fundo"]);
  v["--btn-fundo-hover"] = misturar(v["--btn-fundo"], G, 0.15);
  v["--foco"] = ajustarContraste(D, G, 3);
  v["--aviso-fundo"] = texto;
  v["--aviso-texto"] = textoSobre(texto);
  /* Grade */
  const gr = t.grade;
  const cab = gr.cabFundo ? paraModo(gr.cabFundo, modo, 0.2) : v["--superficie-quente"];
  v["--ap-cab-fundo"] = cab;
  v["--ap-cab-texto"] = gr.cabTexto && modo === "claro" ? gr.cabTexto : gr.cabFundo ? textoSobre(cab, matiz) : texto;
  v["--ap-zebra"] = gr.zebra ? (gr.zebraCor ? paraModo(gr.zebraCor, modo, 0.15) : v["--superficie-suave"]) : G;
  v["--ap-hover"] = gr.hoverCor ? paraModo(gr.hoverCor, modo, 0.2) : v["--superficie-quente"];
  v["--ap-selecao"] = gr.selecaoCor ? paraModo(gr.selecaoCor, modo, 0.26) : v["--lilas-destaque"];
  v["--ap-ativa"] = gr.ativaCor ? ajustarContraste(gr.ativaCor, G, 3) : v["--lilas"];
  v["--ap-nova"] = gr.novaCor ? paraModo(gr.novaCor, modo, 0.18) : v["--superficie-quente"];
  v["--ap-borda"] = gr.bordaCor ? paraModo(gr.bordaCor, modo, 0.32) : gr.borda === "fina" ? misturar(G, texto, 0.07) : v["--borda"];
  v["--ap-fixa"] = gr.fixaCor ? comAlfa(paraModo(gr.fixaCor, modo, 0.3), 0.22) : "#00000000";
  /* Ajustes finos (modo avançado) por cima */
  Object.entries(t.avancado[modo] || {}).forEach(([k, c]) => { v[k] = c; });
  /* Listas (texto e fundo do selo) */
  NOMES_COR.forEach((c) => {
    const x = (t.listas[modo] || {})[c];
    if (x && x.c) v[`--c-${c}`] = x.c;
    if (x && x.f) v[`--f-${c}`] = x.f;
  });
  return v;
}
/* Variáveis não-cor (medidas, fontes) e as da grade translúcida */
function variaveisGrade(t, v, modo) {
  const gr = t.grade;
  const w = gr.borda === "grossa" ? "2px" : "1px";
  const r = {
    "--ap-cab-peso": gr.cabNegrito ? "700" : "500",
    "--ap-cab-caixa": gr.cabMaiusculas ? "uppercase" : "none",
    "--ap-borda-v": gr.bordaEstilo === "todas" ? `${w} solid ${v["--ap-borda"]}` : "0 solid transparent",
    "--ap-borda-h": gr.bordaEstilo === "nenhuma" ? "0 solid transparent" : `${w} solid ${v["--ap-borda"]}`,
    "--ap-raio": gr.cantos + "px",
    "--ap-sombra": gr.sombra === "forte" ? "0 10px 32px #00000040" : gr.sombra === "suave" ? "0 3px 12px #0000001f" : "none",
    "--ap-fonte": FONTES[gr.fonte],
    "--ap-mono": FONTES.mono
  };
  const vidro = t.fundo.tipo !== "nenhum" && !gr.solida;
  const a = vidro ? gr.opacidade / 100 : 1;
  r["--ap-linha"] = vidro ? comAlfa(v["--superficie"], a) : v["--superficie"];
  r["--ap-linha-par"] = vidro ? comAlfa(v["--ap-zebra"], a) : v["--ap-zebra"];
  r["--ap-linha-hover"] = vidro ? comAlfa(v["--ap-hover"], Math.min(1, a + 0.05)) : v["--ap-hover"];
  r["--ap-painel"] = comAlfa(v["--fundo"], 0.86);
  return r;
}
/* Fundo personalizado: cor, gradiente, padrão (SVG gerado aqui) */
function svgPadrao(p) {
  const e = p.escala, op = (p.opacidade / 100).toFixed(2), c = p.cor;
  let forma = "";
  switch (p.forma) {
    case "pontos": forma = `<circle cx="${e / 2}" cy="${e / 2}" r="${(e * 0.12).toFixed(1)}" fill="${c}" fill-opacity="${op}"/>`; break;
    case "listras": forma = `<rect x="0" y="0" width="${(e * 0.3).toFixed(1)}" height="${e}" fill="${c}" fill-opacity="${op}" transform="rotate(45 ${e / 2} ${e / 2})"/>`; break;
    case "grade": forma = `<path d="M ${e} 0 L 0 0 0 ${e}" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="1.2"/>`; break;
    case "xadrez": forma = `<rect width="${e / 2}" height="${e / 2}" fill="${c}" fill-opacity="${op}"/><rect x="${e / 2}" y="${e / 2}" width="${e / 2}" height="${e / 2}" fill="${c}" fill-opacity="${op}"/>`; break;
    case "ondas": forma = `<path d="M0 ${e / 2} Q ${e / 4} ${e / 4} ${e / 2} ${e / 2} T ${e} ${e / 2}" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="${Math.max(1, e / 14).toFixed(1)}"/>`; break;
    case "circulos": forma = `<circle cx="${e / 2}" cy="${e / 2}" r="${(e * 0.36).toFixed(1)}" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="1.4"/>`; break;
    case "triangulos": forma = `<path d="M${e / 2} ${e * 0.18} L${e * 0.84} ${e * 0.78} L${e * 0.16} ${e * 0.78} Z" fill="${c}" fill-opacity="${op}"/>`; break;
    case "quadriculado": forma = `<path d="M ${e} 0 L 0 0 0 ${e}" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="1"/><path d="M ${e / 2} 0 V ${e} M 0 ${e / 2} H ${e}" fill="none" stroke="${c}" stroke-opacity="${(op * 0.45).toFixed(2)}" stroke-width="0.6"/>`; break;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><defs><pattern id="p" width="${e}" height="${e}" patternUnits="userSpaceOnUse" patternTransform="rotate(${p.rotacao})">${forma}</pattern></defs><rect width="1600" height="1000" fill="${p.fundo}"/><rect width="1600" height="1000" fill="url(#p)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
function variaveisFundo(t, modo) {
  const f = t.fundo, r = {};
  if (f.tipo === "nenhum") return r;
  const c = (x) => paraModo(x, modo, 0.16);
  r["--ap-bg-cor"] = f.tipo === "cor" ? c(f.cor) : f.tipo === "padrao" ? c(f.p.fundo) : f.tipo === "gradiente" ? c(f.g.cores[0]) : c(t.base.fundo);
  r["--ap-bg-img"] = "none";
  r["--ap-bg-tam"] = "cover";
  r["--ap-bg-pos"] = "center";
  r["--ap-bg-rep"] = "no-repeat";
  if (f.tipo === "gradiente") {
    const cores = f.g.cores.map(c).join(", ");
    r["--ap-bg-img"] = f.g.tipo === "radial" ? `radial-gradient(circle at ${f.g.x}% ${f.g.y}%, ${cores})` : `linear-gradient(${f.g.angulo}deg, ${cores})`;
  }
  if (f.tipo === "padrao") r["--ap-bg-img"] = svgPadrao({ ...f.p, cor: modo === "escuro" ? f.p.cor : f.p.cor, fundo: c(f.p.fundo) });
  if (f.tipo === "imagem") {
    const i = f.i;
    r["--ap-img-tam"] = i.ajuste === "cobrir" ? "cover" : i.ajuste === "conter" ? "contain" : "auto";
    r["--ap-img-rep"] = i.ajuste === "repetir" ? "repeat" : "no-repeat";
    r["--ap-img-pos"] = `${i.focoX}% ${i.focoY}%`;
    r["--ap-img-filtro"] = `blur(${i.desfoque}px) brightness(${i.brilho}%) saturate(${i.saturacao}%)`;
    r["--ap-veu"] = comAlfa(modo === "escuro" ? versaoEscura(i.veuCor, 0.08) : i.veuCor, i.veuOpacidade / 100);
  }
  return r;
}

/* ------------------------------------------------------------
 *  Regras de cor: avaliação (com cache por linha) e CSS gerado
 * ------------------------------------------------------------ */
function tipoRegra(col) {
  if (!col) return "texto";
  if (["lista", "status", "prioridade", "etiquetas"].includes(col.tipo)) return "lista";
  if (["numero", "derivado"].includes(col.tipo)) return "numero";
  if (["data", "dataHora"].includes(col.tipo) || (col.tipo === "automatico" && /Em$/.test(col.auto || ""))) return "data";
  if (col.tipo === "booleano") return "booleano";
  return "texto";
}
const vazio = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
function diaIso(v) {
  const s = String(v == null ? "" : v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const b = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return b ? `${b[3]}-${b[2]}-${b[1]}` : "";
}
const diasEntre = (a, b) => Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000);
function hojeLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function passa(regra, col, bruto, texto) {
  const tipo = tipoRegra(col), c = regra.cond;
  if (c === "vazio") return vazio(bruto);
  if (c === "naoVazio") return !vazio(bruto);
  if (tipo === "lista") {
    const vals = Array.isArray(bruto) ? bruto : vazio(bruto) ? [] : [String(bruto)];
    const algum = vals.some((x) => regra.valores.includes(x));
    return c === "em" ? algum : c === "naoEm" ? !algum : false;
  }
  if (tipo === "booleano") return c === "sim" ? bruto === true : c === "nao" ? bruto !== true : false;
  if (tipo === "numero") {
    if (vazio(bruto)) return false;
    const n = typeof bruto === "number" ? bruto : Number(String(bruto).replace(/\./g, "").replace(",", "."));
    const a = Number(String(regra.valor).replace(",", ".")), b = Number(String(regra.valor2).replace(",", "."));
    if (!Number.isFinite(n) || !Number.isFinite(a)) return false;
    return c === "eq" ? n === a : c === "ne" ? n !== a : c === "gt" ? n > a : c === "lt" ? n < a : c === "entre" ? Number.isFinite(b) && n >= Math.min(a, b) && n <= Math.max(a, b) : false;
  }
  if (tipo === "data") {
    const d = diaIso(bruto);
    if (!d) return false;
    const hoje = hojeLocal();
    if (c === "hoje") return d === hoje;
    if (c === "antes") return !!diaIso(regra.valor) && d < diaIso(regra.valor);
    if (c === "depois") return !!diaIso(regra.valor) && d > diaIso(regra.valor);
    if (c === "ultimos") { const n = diasEntre(d, hoje); return n >= 0 && n <= regra.n; }
    if (c === "haMais") return diasEntre(d, hoje) > regra.n;
    return false;
  }
  const t = normalizarTexto(texto != null ? texto : bruto), v = normalizarTexto(regra.valor);
  return c === "igual" ? t === v : c === "contem" ? !!v && t.includes(v) : c === "comeca" ? !!v && t.startsWith(v) : false;
}
/* CSS das colunas e das regras (ids e cores já validados; nada vem digitado) */
function cssDinamico(t, regras, modo, colunas) {
  const linhas = [];
  const sel = (id) => `[data-col="${id}"]`;
  const v = t ? gerarVariaveis(t, modo) : null;
  const G = v ? v["--superficie"] : modo === "escuro" ? "#1b1b1f" : "#ffffff";
  const C = ":root .planilha ";
  if (t) {
    Object.entries(t.colunas).forEach(([id, c]) => {
      if (!RE_IDCOL.test(id)) return;
      if (c.cab) {
        const f = paraModo(c.cab, modo, 0.22), tx = textoSobre(f);
        linhas.push(`${C}.cab-celula${sel(id)}{background-color:${f};color:${tx};--cor-icone:${tx}}`);
      }
      if (c.tom) {
        const tom = comAlfa(paraModo(c.tom, modo, 0.4), modo === "escuro" ? 0.24 : 0.16);
        linhas.push(`${C}.linha>.celula${sel(id)}{background-image:linear-gradient(${tom},${tom})}`);
      }
    });
    t.grade.mono.forEach((id) => { if (RE_IDCOL.test(id)) linhas.push(`${C}.linha>.celula${sel(id)},.ficha [data-campo="${id}"]{font-family:var(--ap-mono)}`); });
  }
  /* Regras: a de menor prioridade primeiro (a de cima da lista vence). O prefixo ":root .planilha" deixa a regra
     acima da zebra, do "passar o mouse" e da grade translúcida; a linha selecionada e a célula ativa continuam visíveis. */
  const R = ":root .planilha ";
  [...regras].reverse().forEach((r) => {
    if (!r.ativa) return;
    const cls = `ap-r-${r.id}`;
    const fundo = r.fundo && r.alvo !== "texto" ? paraModo(r.fundo, modo, 0.26) : "";
    const ref = fundo || G;
    const texto = r.texto ? (fundo ? r.texto : ajustarContraste(r.texto, G, 3)) : fundo ? textoSobre(fundo) : "";
    const extras = `${r.negrito ? "font-weight:700;" : ""}${r.riscado ? "text-decoration:line-through;" : ""}`;
    const icone = r.icone && CONTEUDO_ICONE[r.icone] ? `content:"${CONTEUDO_ICONE[r.icone]}";margin-right:5px;flex-shrink:0;${texto ? `color:${texto};` : ""}` : "";
    if (r.cond === "corOpcao") {
      linhas.push(`${R}.linha.${cls}:not(.selecionada){background-color:var(--f)}${R}.linha.${cls}>.celula{color:var(--c)}`);
      return;
    }
    if (r.alvo === "linha") {
      if (fundo) linhas.push(`${R}.linha.${cls}:not(.selecionada){background-color:${fundo}}`);
      if (texto || extras) linhas.push(`${R}.linha.${cls}>.celula{${texto ? `color:${texto};` : ""}${extras}}`);
      if (texto) linhas.push(`${R}.linha.${cls} .acao-linha{color:${texto}}${R}.linha.${cls} .acao-linha .icone{stroke:${texto}}`);
      if (icone) linhas.push(`${R}.linha.${cls}>.celula.fixa::before{${icone}}`);
    } else {
      if (fundo && r.alvo === "celula") linhas.push(`${R}.linha>.celula.${cls}:not(.no-intervalo){background-color:${fundo}}`);
      if (texto || extras) linhas.push(`${R}.linha>.celula.${cls}{${texto ? `color:${texto};` : ""}${extras}}`);
      if (icone) linhas.push(`${R}.linha>.celula.${cls}::before{${icone}}`);
    }
    if (texto && ref) { /* o contraste de cada regra aparece no painel */ }
  });
  return linhas.join("\n");
}

/* ------------------------------------------------------------
 *  IndexedDB (imagem de fundo pessoal e cópia da imagem padrão)
 * ------------------------------------------------------------ */
function abrirBanco(nome) {
  return new Promise((ok, erro) => {
    if (!("indexedDB" in window)) { erro(new Error("sem IndexedDB")); return; }
    const pedido = indexedDB.open(nome, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore("imagens");
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => erro(pedido.error);
  });
}
async function idb(nome, modo, fn) {
  const db = await abrirBanco(nome);
  return new Promise((ok, erro) => {
    const tx = db.transaction("imagens", modo);
    const r = fn(tx.objectStore("imagens"));
    tx.oncomplete = () => { db.close(); ok(r && "result" in r ? r.result : undefined); };
    tx.onerror = () => { db.close(); erro(tx.error); };
  });
}

/* Imagem: valida carregando num <img>, comprime (lado maior até 1920 px, WebP/JPEG) */
function carregarImagem(fonte) {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => erro(new Error("Não foi possível abrir esta imagem."));
    img.src = fonte;
  });
}
async function comprimirImagem(arquivo, { lado = 1920, limiteBytes = 600000, comoDataUrl = false, limiteDataUrl = 690000 } = {}) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(arquivo.type)) throw new Error("Use uma imagem JPG, PNG ou WebP.");
  const url = URL.createObjectURL(arquivo);
  let img;
  try { img = await carregarImagem(url); } finally { URL.revokeObjectURL(url); }
  if (!img.naturalWidth || !img.naturalHeight) throw new Error("A imagem está vazia.");
  const teste = document.createElement("canvas");
  teste.width = teste.height = 1;
  const formato = teste.toDataURL("image/webp").startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
  let escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  for (let tentativa = 0; tentativa < 7; tentativa++) {
    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (let q = 0.86; q >= 0.46; q -= 0.08) {
      if (comoDataUrl) { const d = canvas.toDataURL(formato, q); if (d.length <= limiteDataUrl) return d; }
      else {
        const b = await new Promise((ok) => canvas.toBlob(ok, formato, q));
        if (b && b.size <= limiteBytes) return b;
      }
    }
    escala *= 0.8;
  }
  throw new Error("A imagem continua grande demais depois de comprimida.");
}
const blobParaDataUrl = (b) => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => erro(r.error); r.readAsDataURL(b); });
const dataUrlOk = (v, max = 700000) => typeof v === "string" && v.length <= max && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
async function dataUrlParaBlob(d) { const r = await fetch(d); return r.blob(); }

/* Ícone de paleta (sem depender do conjunto de ícones do site) */
const ICONE_PALETA = '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.6-9-7.6Z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7.2" r="1.2"/><circle cx="14.5" cy="7.2" r="1.2"/><circle cx="17" cy="11" r="1.2"/></svg>';
const ic = (d) => `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  desfazer: ic('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  refazer: ic('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  fechar: ic('<path d="M18 6 6 18M6 6l12 12"/>'),
  gotas: ic('<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>'),
  copiar: ic('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  colar: ic('<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
  limpar: ic('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  cima: ic('<path d="m18 15-6-6-6 6"/>'), baixo: ic('<path d="m6 9 6 6 6-6"/>'),
  alca: ic('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  sorte: ic('<rect width="16" height="16" x="4" y="4" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>')
};

/* ------------------------------------------------------------
 *  Motor da aparência
 *  cfg: { prefixo, planilha(): {id, nome}, ehAdmin(), colunas(): [col do motor], valor(t, col), texto(t, col),
 *         opcoes(col), registros(), repintar(), remedir(), aviso(texto), confirmar(texto, op),
 *         padrao: { ouvir(cb) → parar, lerImagem() → dataUrl|null, gravar(dados, imagem|undefined|null), remover() },
 *         ancora: elemento antes do qual entra o botão "Aparência" }
 * ------------------------------------------------------------ */
export function criarAparencia(cfg) {
  const raiz = document.documentElement;
  const P = cfg.prefixo;
  const BANCO = `${P}-aparencia`;
  /* Pessoal: por planilha e por pessoa (cfg.usuario: e-mail ou id; sem login, o navegador) */
  const quem = () => { const u = cfg.usuario ? String(cfg.usuario() || "") : ""; return u ? ":" + u.toLowerCase().replace(/[^a-z0-9@._-]/g, "").slice(0, 120) : ""; };
  const chavePessoal = () => `${P}-aparencia:${cfg.planilha().id}${quem()}`;
  const chaveAplicada = () => `${P}-aparencia-aplicada:${cfg.planilha().id}`;
  const chaveMeus = () => `${P}-aparencia-meus${quem()}`;
  const CHAVE_RECENTES = `${P}-aparencia-recentes`;
  const CHAVE_PAINEL = `${P}-aparencia-painel`;
  const ler = (k, padrao) => { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const apagar = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
  const modoAtual = () => (raiz.dataset.tema === "escuro" ? "escuro" : "claro");

  const est = {
    pessoal: null,      // { tema|null, regras: [] } deste navegador
    padrao: null,       // { tema|null, regras, permitirPessoal, atualizadoPor, atualizadoEm } da planilha
    pararPadrao: null,
    versao: 0,          // muda a cada aplicação (invalida o cache das linhas)
    cache: new WeakMap(),
    imagemUrl: "",      // blob: da imagem aplicada
    imagemDe: "",       // "pessoal" | "padrao:<versão>"
    painel: null,
    aba: (ler(CHAVE_PAINEL, {}) || {}).aba || "temas",
    largura: num((ler(CHAVE_PAINEL, {}) || {}).largura, 320, 720, 380),
    pilha: [], refazer: [],
    colunaFoco: "",
    editandoRegra: null,
    imagemPendente: null // imagem pessoal ainda não gravada (pré-visualização)
  };

  /* Camadas efetivas */
  const pessoalPermitido = () => !est.padrao || est.padrao.permitirPessoal !== false || cfg.ehAdmin();
  const temaEfetivo = () => (est.pessoal && est.pessoal.tema && pessoalPermitido() ? est.pessoal.tema : est.padrao && est.padrao.tema ? est.padrao.tema : null);
  const origemTema = () => (est.pessoal && est.pessoal.tema && pessoalPermitido() ? "pessoal" : est.padrao && est.padrao.tema ? "padrao" : "");
  const regrasPessoais = () => (est.pessoal && pessoalPermitido() ? est.pessoal.regras : []);
  const regrasPlanilha = () => (est.padrao ? est.padrao.regras : []);
  /* Ids das regras pessoais e da planilha não se misturam no CSS */
  const regrasEfetivas = () => [...regrasPessoais().map((r) => ({ ...r, id: "p" + r.id })), ...regrasPlanilha().map((r) => ({ ...r, id: "q" + r.id }))];
  const colunasMotor = () => cfg.colunas() || [];
  const colPorId = (id) => colunasMotor().find((c) => c.id === id);

  function lerPessoal() {
    const d = ler(chavePessoal(), null);
    if (!d || typeof d !== "object") return null;
    const tema = d.tema ? validarTema(d.tema) : null;
    const regras = validarRegras(d.regras);
    return tema || regras.length ? { tema, regras } : null;
  }
  function gravarPessoal() {
    if (est.pessoal && (est.pessoal.tema || est.pessoal.regras.length)) gravar(chavePessoal(), est.pessoal);
    else apagar(chavePessoal());
  }

  /* ---------- Aplicar ---------- */
  let varsAplicadas = [];
  let estilo = null;
  function elEstilo() {
    if (!estilo || !estilo.isConnected) {
      estilo = document.getElementById("ap-dinamico") || document.createElement("style");
      estilo.id = "ap-dinamico";
      document.head.appendChild(estilo);
    }
    return estilo;
  }
  function calcular(t, modo) {
    const v = gerarVariaveis(t, modo);
    return { ...v, ...variaveisGrade(t, v, modo), ...variaveisFundo(t, modo) };
  }
  const lentoOuSemVidro = () => {
    try { if (matchMedia("(prefers-reduced-transparency: reduce)").matches) return true; } catch (e) {}
    return (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2;
  };
  function atributos(t) {
    const a = {};
    if (!t) return a;
    a["data-ap"] = "1";
    if (t.fundo.tipo !== "nenhum") { a["data-ap-fundo"] = t.fundo.tipo; a["data-ap-area"] = t.fundo.area; }
    if (t.fundo.tipo !== "nenhum" && !t.grade.solida) { a["data-ap-vidro"] = "1"; if (t.grade.vidro && !lentoOuSemVidro()) a["data-ap-vidro-blur"] = "1"; }
    return a;
  }
  const ATRIBUTOS = ["data-ap", "data-ap-fundo", "data-ap-area", "data-ap-vidro", "data-ap-vidro-blur"];
  function aplicar({ repintar = true } = {}) {
    const t = temaEfetivo();
    const modo = modoAtual();
    varsAplicadas.forEach((k) => raiz.style.removeProperty(k));
    varsAplicadas = [];
    ATRIBUTOS.forEach((a) => raiz.removeAttribute(a));
    let cacheTema = null;
    if (t) {
      const claro = calcular(t, "claro"), escuro = calcular(t, "escuro");
      const v = modo === "escuro" ? escuro : claro;
      Object.entries(v).forEach(([k, val]) => { raiz.style.setProperty(k, val); varsAplicadas.push(k); });
      const at = atributos(t);
      Object.entries(at).forEach(([k, val]) => raiz.setAttribute(k, val));
      cacheTema = { v: 1, claro: Object.entries(claro), escuro: Object.entries(escuro), attrs: at };
    }
    const regras = regrasEfetivas();
    elEstilo().textContent = cssDinamico(t, regras, modo, colunasMotor());
    if (cacheTema) gravar(chaveAplicada(), cacheTema); else apagar(chaveAplicada());
    aplicarImagem(t);
    /* Cor muda só variáveis e CSS; a grade é repintada só quando as classes das linhas mudam (regras, "célula inteira") */
    const assinatura = JSON.stringify([regras, t ? Object.keys(t.colunas).filter((id) => t.colunas[id].cheia) : []]);
    if (assinatura !== est.assinatura) {
      est.assinatura = assinatura;
      est.versao++;
      est.cache = new WeakMap();
      if (repintar) agendarRepintar();
    }
  }
  let pedidoRepintar = 0;
  function agendarRepintar() { cancelAnimationFrame(pedidoRepintar); pedidoRepintar = requestAnimationFrame(() => { try { cfg.repintar(); } catch (e) { console.warn(e); } }); }

  /* Imagem de fundo: pessoal (IndexedDB) ou do padrão da planilha (Firestore, com cópia no IndexedDB) */
  function elImagem() {
    let el = document.getElementById("ap-imagem");
    if (!el) { el = document.createElement("div"); el.id = "ap-imagem"; el.setAttribute("aria-hidden", "true"); document.body.prepend(el); }
    return el;
  }
  function trocarImagem(url, de) {
    const el = elImagem();
    if (est.imagemUrl === url && el.classList.contains("visivel")) return;
    if (est.imagemUrl && est.imagemUrl !== url && est.imagemUrl.startsWith("blob:")) { const antiga = est.imagemUrl; setTimeout(() => URL.revokeObjectURL(antiga), 2000); }
    est.imagemUrl = url;
    est.imagemDe = de;
    if (!url) { el.classList.remove("visivel"); el.style.backgroundImage = ""; return; }
    el.classList.remove("visivel");
    el.style.backgroundImage = `url("${url}")`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("visivel")));
  }
  let pedidoImagem = 0;
  async function aplicarImagem(t) {
    const meu = ++pedidoImagem;
    if (!t || t.fundo.tipo !== "imagem") { trocarImagem("", ""); return; }
    try {
      if (est.imagemPendente && origemTema() === "pessoal") { trocarImagem(est.imagemPendente.url, "pendente"); return; }
      if (origemTema() === "pessoal") {
        if (est.imagemDe === "pessoal" && est.imagemUrl) return;
        const b = await idb(BANCO, "readonly", (s) => s.get(`pessoal:${cfg.planilha().id}${quem()}`)).catch(() => null);
        if (meu !== pedidoImagem) return;
        trocarImagem(b instanceof Blob ? URL.createObjectURL(b) : "", "pessoal");
        return;
      }
      const versao = `padrao:${(est.padrao && est.padrao.atualizadoEm) || ""}`;
      if (est.imagemDe === versao && est.imagemUrl) return;
      const chave = `padrao:${cfg.planilha().id}`;
      const guardada = await idb(BANCO, "readonly", (s) => s.get(chave)).catch(() => null);
      if (meu !== pedidoImagem) return;
      if (guardada && guardada.versao === versao && guardada.blob instanceof Blob) { trocarImagem(URL.createObjectURL(guardada.blob), versao); return; }
      const d = cfg.padrao && cfg.padrao.lerImagem ? await cfg.padrao.lerImagem() : null;
      if (meu !== pedidoImagem) return;
      if (!dataUrlOk(d)) { trocarImagem("", ""); return; }
      const blob = await dataUrlParaBlob(d);
      idb(BANCO, "readwrite", (s) => s.put({ versao, blob }, chave)).catch(() => {});
      trocarImagem(URL.createObjectURL(blob), versao);
    } catch (e) { console.warn("Imagem de fundo:", e); }
  }

  /* ---------- Classes de cada linha (só as visíveis são pintadas; cache por linha) ---------- */
  function daLinha(t) {
    const c = est.cache.get(t);
    if (c) return c;
    const r = { l: "", c: {} };
    const regras = regrasEfetivas();
    const tema = temaEfetivo();
    const cols = colunasMotor();
    let linhaFeita = false;
    for (const rg of regras) {
      if (!rg.ativa) continue;
      if (rg.cond === "obrigatorios") {
        cols.forEach((col) => { if (col.obrigatoria && vazio(cfg.valor(t, col))) r.c[col.id] = (r.c[col.id] || "") + ` ap-r-${rg.id}`; });
        continue;
      }
      const col = cols.find((x) => x.id === rg.col);
      if (!col) continue;
      if (rg.cond === "corOpcao") {
        if (linhaFeita) continue;
        const b = cfg.valor(t, col);
        const o = (cfg.opcoes(col) || []).find((x) => x.id === (Array.isArray(b) ? b[0] : b));
        if (o && o.cor && NOMES_COR.includes(o.cor)) { r.l += ` ap-r-${rg.id} ap-pintada cor-${o.cor}`; linhaFeita = true; }
        continue;
      }
      if (rg.alvo === "linha" && linhaFeita) continue;
      let ok = false;
      try { ok = passa(rg, col, cfg.valor(t, col), tipoRegra(col) === "texto" ? cfg.texto(t, col) : null); } catch (e) { ok = false; }
      if (!ok) continue;
      if (rg.alvo === "linha") { r.l += ` ap-r-${rg.id}${rg.fundo || rg.cond === "corOpcao" ? " ap-pintada" : ""}`; linhaFeita = true; }
      else r.c[col.id] = (r.c[col.id] || "") + ` ap-r-${rg.id}`;
    }
    if (tema) {
      Object.entries(tema.colunas).forEach(([id, cc]) => {
        if (!cc.cheia) return;
        const col = cols.find((x) => x.id === id);
        if (!col) return;
        const b = cfg.valor(t, col);
        const o = (cfg.opcoes(col) || []).find((x) => x.id === (Array.isArray(b) ? b[0] : b));
        if (o && o.cor && NOMES_COR.includes(o.cor)) r.c[id] = (r.c[id] || "") + ` ap-cheia cor-${o.cor}`;
      });
    }
    est.cache.set(t, r);
    return r;
  }
  const contarRegra = (rg) => {
    const cols = colunasMotor();
    const col = cols.find((x) => x.id === rg.col);
    let n = 0;
    for (const t of cfg.registros() || []) {
      if (rg.cond === "obrigatorios") { if (cols.some((c) => c.obrigatoria && vazio(cfg.valor(t, c)))) n++; continue; }
      if (!col) return 0;
      if (rg.cond === "corOpcao") { const b = cfg.valor(t, col); const o = (cfg.opcoes(col) || []).find((x) => x.id === (Array.isArray(b) ? b[0] : b)); if (o && o.cor) n++; continue; }
      try { if (passa(rg, col, cfg.valor(t, col), tipoRegra(col) === "texto" ? cfg.texto(t, col) : null)) n++; } catch (e) {}
    }
    return n;
  };

  /* ---------- Edição (pessoal), desfazer/refazer ---------- */
  const podeEditar = () => pessoalPermitido();
  /* Regras pessoais sem copiar o tema (o padrão da planilha continua valendo para as cores) */
  function comRegras() {
    if (!est.pessoal) est.pessoal = { tema: null, regras: [] };
    return est.pessoal;
  }
  function rascunho() {
    if (!est.pessoal) est.pessoal = { tema: null, regras: [] };
    if (!est.pessoal.tema) est.pessoal.tema = clonar(temaEfetivo() || PRESETS[0][1]);
    return est.pessoal;
  }
  let temporizadorPilha = 0, ultimoEstado = null;
  function marcarPilha() {
    const agora = JSON.stringify(est.pessoal);
    if (ultimoEstado == null) ultimoEstado = agora;
    clearTimeout(temporizadorPilha);
    temporizadorPilha = setTimeout(() => {
      const atual = JSON.stringify(est.pessoal);
      if (atual === ultimoEstado) return;
      est.pilha.push(ultimoEstado);
      if (est.pilha.length > 60) est.pilha.shift();
      est.refazer = [];
      ultimoEstado = atual;
      atualizarTopo();
    }, 350);
  }
  let temporizadorGravar = 0;
  function mudou({ painel = false, repintar = true } = {}) {
    clearTimeout(temporizadorGravar);
    temporizadorGravar = setTimeout(gravarPessoal, 250);
    marcarPilha();
    aplicar({ repintar });
    if (painel) desenharPainel(); else { atualizarContraste(); atualizarTopo(); }
  }
  function restaurarDe(json) {
    est.pessoal = json ? JSON.parse(json) : null;
    if (est.pessoal) est.pessoal = { tema: est.pessoal.tema ? validarTema(est.pessoal.tema) : null, regras: validarRegras(est.pessoal.regras) };
    ultimoEstado = JSON.stringify(est.pessoal);
    gravarPessoal();
    aplicar();
    desenharPainel();
  }
  function desfazer() {
    clearTimeout(temporizadorPilha);
    const atual = JSON.stringify(est.pessoal);
    if (ultimoEstado != null && ultimoEstado !== atual) { est.pilha.push(ultimoEstado); ultimoEstado = atual; }
    if (!est.pilha.length) return;
    est.refazer.push(JSON.stringify(est.pessoal));
    restaurarDe(est.pilha.pop());
  }
  function refazerAcao() {
    if (!est.refazer.length) return;
    est.pilha.push(JSON.stringify(est.pessoal));
    restaurarDe(est.refazer.pop());
  }

  /* Caminhos de campo: "base.destaque", "grade.cabFundo", "avancado.claro.--cor-acao", "listas.escuro.verde.c",
     "colunas.<id>.cab", "fundo.g.cores.1", "regra.<id>.fundo" */
  function lerCampo(caminho) {
    const t = (est.pessoal && est.pessoal.tema) || temaEfetivo() || PRESETS[0][1];
    const p = caminho.split(".");
    if (p[0] === "regra") { const r = (est.pessoal ? est.pessoal.regras : []).find((x) => x.id === p[1]); return r ? r[p[2]] : ""; }
    if (p[0] === "avancado") return (t.avancado[p[1]] || {})[p.slice(2).join(".")] || "";
    if (p[0] === "listas") return ((t.listas[p[1]] || {})[p[2]] || {})[p[3]] || "";
    if (p[0] === "colunas") return (t.colunas[p[1]] || {})[p[2]] || "";
    let o = t;
    for (const k of p) { if (o == null) return ""; o = o[k]; }
    return o == null ? "" : o;
  }
  function escreverCampo(caminho, valor) {
    if (!podeEditar()) return;
    const p = caminho.split(".");
    if (p[0] === "regra") {
      const r = comRegras().regras.find((x) => x.id === p[1]);
      if (r) Object.assign(r, validarRegra({ ...r, [p[2]]: valor }));
      return;
    }
    const t = rascunho().tema;
    if (p[0] === "avancado") { const k = p.slice(2).join("."); if (valor) t.avancado[p[1]][k] = valor; else delete t.avancado[p[1]][k]; }
    else if (p[0] === "listas") { const m = t.listas[p[1]]; m[p[2]] = { c: "", f: "", ...(m[p[2]] || {}), [p[3]]: valor }; if (!m[p[2]].c && !m[p[2]].f) delete m[p[2]]; }
    else if (p[0] === "colunas") { t.colunas[p[1]] = { cab: "", tom: "", cheia: false, ...(t.colunas[p[1]] || {}), [p[2]]: valor }; }
    else {
      let o = t;
      for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
      o[p[p.length - 1]] = valor;
    }
    est.pessoal.tema = validarTema(t);
  }

  /* ---------- Contraste (WCAG) ---------- */
  function problemasContraste() {
    const t = temaEfetivo();
    const lista = [];
    const modo = modoAtual();
    if (t) {
      const v = calcular(t, modo);
      const par = (nome, frente, fundo, campo, alvo = 4.5) => {
        const f = sobre(frente, fundo);
        const r = contraste(f, fundo);
        if (r < alvo) lista.push({ nome, r, frente, fundo: opaca(fundo), campo, alvo });
      };
      const fundoGrade = v["--superficie"];
      par("Texto sobre a grade", v["--cor-acao"], fundoGrade, `avancado.${modo}.--cor-acao`);
      par("Texto nas linhas alternadas", v["--cor-acao"], v["--ap-zebra"], `avancado.${modo}.--cor-acao`);
      par("Texto na linha selecionada", v["--cor-acao"], v["--ap-selecao"], `avancado.${modo}.--cor-acao`);
      par("Texto secundário", v["--texto-secundario"], fundoGrade, `avancado.${modo}.--texto-secundario`);
      par("Texto do cabeçalho", v["--ap-cab-texto"], v["--ap-cab-fundo"], `avancado.${modo}.--ap-cab-texto`);
      par("Texto dos botões", v["--btn-texto"], v["--btn-fundo"], `avancado.${modo}.--btn-texto`);
      par("Ícones e links", v["--cor-icone"], fundoGrade, `avancado.${modo}.--cor-icone`);
      par("Texto sobre o fundo da página", v["--cor-acao"], v["--fundo"], `avancado.${modo}.--cor-acao`);
      NOMES_COR.forEach((c) => {
        const cor = v[`--c-${c}`], fundo = v[`--f-${c}`];
        if (cor && fundo && ((t.listas[modo] || {})[c])) par(`Selo ${NOME_COR[c]}`, cor, fundo, `listas.${modo}.${c}.c`);
      });
    }
    /* Regras pessoais com cor de texto escolhida ("só o texto": contra a grade e a linha alternada) */
    const vg = t ? calcular(t, modo) : null;
    const G = vg ? vg["--superficie"] : modo === "escuro" ? "#1b1b1f" : "#ffffff";
    const Z = vg ? vg["--ap-zebra"] : G;
    regrasPessoais().forEach((r) => {
      if (!r.texto || !r.ativa) return;
      const fundos = r.alvo !== "texto" && r.fundo ? [paraModo(r.fundo, modo, 0.26)] : [G, Z];
      fundos.forEach((fundo) => {
        const x = contraste(r.texto, fundo);
        if (x < 4.5 && !lista.some((p) => p.campo === `regra.${r.id}.texto` && p.fundo === fundo)) lista.push({ nome: `Regra: ${resumoRegra(r)}`, r: x, frente: r.texto, fundo, campo: `regra.${r.id}.texto`, alvo: 4.5 });
      });
    });
    return lista;
  }
  /* A mesma cor (ex.: o texto) pode falhar contra vários fundos: ajusta contra todos, mantendo o tom */
  function corrigirContraste() {
    let probs = problemasContraste();
    if (!probs.length) return;
    rascunho();
    for (let passada = 0; passada < 4 && probs.length; passada++) {
      const porCampo = new Map();
      probs.forEach((p) => { if (!porCampo.has(p.campo)) porCampo.set(p.campo, { frente: p.frente, itens: [] }); porCampo.get(p.campo).itens.push(p); });
      porCampo.forEach(({ frente, itens }, campo) => {
        let cor = opaca(frente);
        for (let i = 0; i < 3; i++) itens.forEach((p) => { cor = ajustarContraste(cor, p.fundo, p.alvo + 0.1); });
        escreverCampo(campo, cor);
      });
      probs = problemasContraste();
    }
    mudou({ painel: true });
    cfg.aviso(probs.length ? "Contraste melhorado; confira os avisos que restaram." : "Contraste corrigido.");
  }

  /* ---------- Painel ---------- */
  const ABAS = [["temas", "Temas"], ["cores", "Cores"], ["fundo", "Fundo"], ["grade", "Grade"], ["colunas", "Colunas"], ["regras", "Regras"], ["meus", "Meus temas"]];
  function criarBotao() {
    if (!cfg.ancora || document.getElementById("btn-aparencia")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.id = "btn-aparencia";
    b.className = "btn-icone btn-aparencia";
    b.title = "Aparência da planilha";
    b.setAttribute("aria-label", "Aparência da planilha");
    b.setAttribute("aria-expanded", "false");
    b.setAttribute("aria-controls", "ap-painel");
    b.innerHTML = ICONE_PALETA;
    cfg.ancora.parentNode.insertBefore(b, cfg.ancora);
    b.addEventListener("click", () => (est.painel && !est.painel.hidden ? fechar() : abrir()));
  }
  function abrir(aba, coluna) {
    if (aba) est.aba = aba;
    if (coluna) est.colunaFoco = coluna;
    if (!est.painel) montarPainel();
    est.painel.hidden = false;
    raiz.classList.add("ap-painel-aberto");
    raiz.style.setProperty("--ap-largura", est.largura + "px");
    const b = document.getElementById("btn-aparencia");
    if (b) b.setAttribute("aria-expanded", "true");
    desenharPainel();
    setTimeout(() => { const a = est.painel.querySelector(`[data-aba="${est.aba}"]`); if (a) a.focus(); if (coluna) { const c = est.painel.querySelector(`[data-coluna-cartao="${CSS.escape(coluna)}"]`); if (c) c.scrollIntoView({ block: "center" }); } }, 30);
    if (cfg.remedir) setTimeout(cfg.remedir, 60);
  }
  function fechar() {
    if (!est.painel) return;
    est.painel.hidden = true;
    raiz.classList.remove("ap-painel-aberto");
    const b = document.getElementById("btn-aparencia");
    if (b) { b.setAttribute("aria-expanded", "false"); b.focus(); }
    if (cfg.remedir) setTimeout(cfg.remedir, 60);
  }
  function montarPainel() {
    const p = document.createElement("aside");
    p.id = "ap-painel";
    p.className = "ap-painel";
    p.setAttribute("aria-label", "Aparência da planilha");
    p.hidden = true;
    p.innerHTML = `<div class="ap-redim" role="separator" aria-orientation="vertical" aria-label="Largura do painel (setas para ajustar)" tabindex="0"></div>
      <div class="ap-conteudo">
        <header class="ap-topo">
          <div class="ap-titulo"><h2>Aparência</h2><button type="button" class="ap-botao-icone" data-ap="fechar" aria-label="Fechar o painel" title="Fechar">${I.fechar}</button></div>
          <div class="ap-acoes-topo"><button type="button" class="ap-mini" data-ap="desfazer">${I.desfazer}Desfazer</button><button type="button" class="ap-mini" data-ap="refazer">${I.refazer}Refazer</button><button type="button" class="ap-mini" data-ap="restaurar">Restaurar padrão</button></div>
          <p class="ap-origem" aria-live="polite"></p>
        </header>
        <nav class="ap-abas" role="tablist" aria-label="Partes da aparência">${ABAS.map(([id, nome]) => `<button type="button" role="tab" id="ap-aba-${id}" data-aba="${id}" aria-controls="ap-corpo">${nome}</button>`).join("")}</nav>
        <div class="ap-contraste" role="alert" hidden></div>
        <div class="ap-corpo" id="ap-corpo" role="tabpanel"></div>
      </div>`;
    document.body.appendChild(p);
    est.painel = p;
    p.addEventListener("click", aoClicar);
    p.addEventListener("input", aoDigitar);
    p.addEventListener("change", aoMudar);
    p.addEventListener("keydown", aoTecla);
    ligarRedimensionar(p.querySelector(".ap-redim"));
    ligarArrastarRegras(p);
  }
  function ligarRedimensionar(alca) {
    let inicio = null;
    const mover = (x) => {
      est.largura = limitar(Math.round(innerWidth - x), 320, Math.min(720, innerWidth - 120));
      raiz.style.setProperty("--ap-largura", est.largura + "px");
    };
    alca.addEventListener("pointerdown", (e) => { inicio = e.pointerId; alca.setPointerCapture(e.pointerId); });
    alca.addEventListener("pointermove", (e) => { if (inicio === e.pointerId) mover(e.clientX); });
    const fim = () => { if (inicio == null) return; inicio = null; salvarPainel(); if (cfg.remedir) cfg.remedir(); };
    alca.addEventListener("pointerup", fim);
    alca.addEventListener("pointercancel", fim);
    alca.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      est.largura = limitar(est.largura + (e.key === "ArrowLeft" ? 20 : -20), 320, Math.min(720, innerWidth - 120));
      raiz.style.setProperty("--ap-largura", est.largura + "px");
      salvarPainel();
      if (cfg.remedir) cfg.remedir();
    });
  }
  const salvarPainel = () => gravar(CHAVE_PAINEL, { ...(ler(CHAVE_PAINEL, {}) || {}), aba: est.aba, largura: est.largura });

  function atualizarTopo() {
    if (!est.painel || est.painel.hidden) return;
    const p = est.painel;
    p.querySelector('[data-ap="desfazer"]').disabled = !est.pilha.length && !(ultimoEstado != null && ultimoEstado !== JSON.stringify(est.pessoal));
    p.querySelector('[data-ap="refazer"]').disabled = !est.refazer.length;
    p.querySelector('[data-ap="restaurar"]').disabled = !est.pessoal;
    const o = origemTema();
    const travado = !pessoalPermitido();
    p.querySelector(".ap-origem").textContent = travado
      ? "As administradoras definiram a aparência desta planilha para todos. A aparência pessoal está desligada."
      : o === "pessoal" ? `Sua aparência pessoal (só neste navegador)${est.padrao && est.padrao.tema ? ", por cima do padrão da planilha" : ""}.`
      : o === "padrao" ? "Padrão desta planilha (definido pelas administradoras). Mude algo para criar a sua por cima."
      : "Aparência padrão do site. Escolha um tema ou mude as cores: vale só para você, neste navegador.";
    p.querySelectorAll("[data-aba]").forEach((b) => { b.setAttribute("aria-selected", String(b.dataset.aba === est.aba)); b.tabIndex = b.dataset.aba === est.aba ? 0 : -1; });
  }
  function atualizarContraste() {
    if (!est.painel || est.painel.hidden) return;
    const caixa = est.painel.querySelector(".ap-contraste");
    const probs = problemasContraste();
    caixa.hidden = !probs.length;
    caixa.innerHTML = probs.length ? `<strong>O texto ficou difícil de ler</strong>
      <ul>${probs.slice(0, 6).map((p) => `<li><span class="ap-amostra" style="background:${p.fundo};color:${opaca(p.frente)}">Aa</span>${esc(p.nome)}: ${p.r.toFixed(1).replace(".", ",")}:1 (mínimo ${String(p.alvo).replace(".", ",")}:1)</li>`).join("")}</ul>
      ${podeEditar() ? '<button type="button" class="ap-mini ap-mini-forte" data-ap="corrigir">Corrigir automaticamente</button>' : ""}` : "";
  }
  function desenharPainel() {
    if (!est.painel || est.painel.hidden) return;
    atualizarTopo();
    atualizarContraste();
    const corpo = est.painel.querySelector(".ap-corpo");
    corpo.setAttribute("aria-labelledby", `ap-aba-${est.aba}`);
    const rolagem = corpo.scrollTop;
    const html = { temas: htmlTemas, cores: htmlCores, fundo: htmlFundo, grade: htmlGrade, colunas: htmlColunas, regras: htmlRegras, meus: htmlMeus }[est.aba]();
    corpo.innerHTML = (podeEditar() ? "" : '<p class="ap-nota">Você pode ver as opções, mas a aparência desta planilha está fixada pelas administradoras.</p>') + html;
    corpo.querySelectorAll("input, select, textarea, button").forEach((el) => { if (!podeEditar() && !el.closest("[data-sempre]")) el.disabled = true; });
    corpo.scrollTop = rolagem;
  }

  /* Campo de cor: seletor + #hex + conta-gotas + copiar/colar */
  function campoCor(caminho, rotulo, { vazioPermitido = false, dica = "" } = {}) {
    const atual = lerCampo(caminho);
    const mostrado = corOk(atual) ? opaca(atual) : "#ffffff";
    const id = "ap-c-" + caminho.replace(/[^A-Za-z0-9_-]/g, "_");
    return `<div class="ap-cor" data-campo-cor="${esc(caminho)}">
      <label class="ap-cor-rotulo" for="${id}">${esc(rotulo)}${dica ? `<span class="ap-dica">${esc(dica)}</span>` : ""}</label>
      <div class="ap-cor-linha">
        <input type="color" id="${id}" value="${mostrado}" data-cor-seletor aria-label="${esc(rotulo)}">
        <input type="text" class="ap-hex" value="${esc(atual || "")}" placeholder="${vazioPermitido ? "automático" : "#rrggbb"}" maxlength="9" spellcheck="false" data-cor-hex aria-label="Código da cor: ${esc(rotulo)}">
        ${"EyeDropper" in window ? `<button type="button" class="ap-botao-icone" data-cor="gotas" title="Conta-gotas" aria-label="Conta-gotas: ${esc(rotulo)}">${I.gotas}</button>` : ""}
        <button type="button" class="ap-botao-icone" data-cor="copiar" title="Copiar a cor" aria-label="Copiar a cor: ${esc(rotulo)}">${I.copiar}</button>
        <button type="button" class="ap-botao-icone" data-cor="colar" title="Colar a cor" aria-label="Colar a cor: ${esc(rotulo)}">${I.colar}</button>
        ${vazioPermitido ? `<button type="button" class="ap-botao-icone" data-cor="limpar" title="Voltar ao automático" aria-label="Voltar ao automático: ${esc(rotulo)}">${I.limpar}</button>` : ""}
      </div></div>`;
  }
  const recentes = () => (ler(CHAVE_RECENTES, []) || []).filter(corOk).slice(0, 12);
  function lembrarCor(c) {
    if (!corOk(c)) return;
    gravar(CHAVE_RECENTES, [c.toLowerCase(), ...recentes().filter((x) => x !== c.toLowerCase())].slice(0, 12));
  }
  let ultimoCampoCor = "";
  let corCopiada = "";
  const htmlRecentes = () => {
    const r = recentes();
    return r.length ? `<div class="ap-recentes" data-sempre><span class="ap-dica">Cores recentes (clique para usar na última cor escolhida):</span><div>${r.map((c) => `<button type="button" class="ap-amostra-cor" style="background:${c}" data-recente="${c}" title="${c}" aria-label="Usar a cor ${c}"></button>`).join("")}</div></div>` : "";
  };
  const linhaOpcoes = (nome, valor, opcoes, rotulo) => `<label class="ap-campo"><span>${esc(rotulo)}</span><select data-campo="${esc(nome)}">${opcoes.map(([v, r]) => `<option value="${esc(v)}"${String(valor) === String(v) ? " selected" : ""}>${esc(r)}</option>`).join("")}</select></label>`;
  const linhaFaixa = (nome, valor, min, max, rotulo, sufixo = "") => `<label class="ap-campo ap-faixa"><span>${esc(rotulo)} <output>${esc(valor)}${sufixo}</output></span><input type="range" min="${min}" max="${max}" value="${esc(valor)}" data-campo="${esc(nome)}" data-sufixo="${esc(sufixo)}"></label>`;
  const linhaCheck = (nome, valor, rotulo) => `<label class="ap-check"><input type="checkbox" data-campo="${esc(nome)}"${valor ? " checked" : ""}> ${esc(rotulo)}</label>`;

  /* Aba Temas */
  function miniatura(t, modo) {
    const v = calcular(t, modo);
    const bg = t.fundo.tipo === "gradiente" ? v["--ap-bg-img"] : t.fundo.tipo === "padrao" ? v["--ap-bg-img"] : v["--ap-bg-cor"] || v["--fundo"];
    return `<span class="ap-mini-tema" aria-hidden="true" style="background:${v["--fundo"]};${t.fundo.tipo !== "nenhum" ? `background-image:${bg.startsWith("url") || bg.includes("gradient") ? bg : "none"};background-color:${v["--ap-bg-cor"] || v["--fundo"]};background-size:cover;` : ""}">
      <span class="ap-mini-grade" style="background:${v["--superficie"]};border-color:${v["--ap-borda"]};border-radius:${Math.min(6, t.grade.cantos)}px">
        <span class="ap-mini-cab" style="background:${v["--ap-cab-fundo"]};color:${v["--ap-cab-texto"]}">▬ ▬</span>
        <span class="ap-mini-linha" style="background:${v["--superficie"]};color:${v["--cor-acao"]}">▬▬ <i style="background:${v["--lilas"]}"></i></span>
        <span class="ap-mini-linha" style="background:${v["--ap-zebra"]};color:${v["--cor-acao"]}">▬ ▬</span>
        <span class="ap-mini-linha" style="background:${v["--superficie"]};color:${v["--texto-secundario"]}">▬▬▬</span>
      </span></span>`;
  }
  function htmlTemas() {
    const modo = modoAtual();
    const atual = temaEfetivo();
    return `<p class="ap-nota">Um clique aplica o tema (na versão ${modo === "escuro" ? "escura" : "clara"}; o botão de tema claro/escuro continua valendo). Depois ajuste o que quiser.</p>
      <div class="ap-galeria">${PRESETS.map(([id, t]) => `<button type="button" class="ap-tema-cartao" data-preset="${id}"${atual && atual.nome === t.nome ? ' aria-current="true"' : ""}>${miniatura(t, modo)}<span>${esc(t.nome)}</span></button>`).join("")}</div>
      <button type="button" class="ap-mini ap-mini-forte" data-ap="sorte">${I.sorte}Surpreenda-me</button>
      <p class="ap-dica">Gera uma paleta harmoniosa a partir de uma cor de destaque aleatória, com contraste garantido.</p>`;
  }
  function surpreenda() {
    const h = Math.floor(Math.random() * 360);
    const s = 0.5 + Math.random() * 0.3;
    const t = clonar(PRESETS[0][1]);
    t.nome = "Surpresa";
    t.base = { destaque: deHsl(h, s, 0.46), fundo: deHsl(h + 20, 0.4, 0.955), grade: deHsl(h, 0.3, 0.995) };
    const tipo = ["cor", "gradiente", "padrao", "nenhum"][Math.floor(Math.random() * 4)];
    t.fundo.tipo = tipo;
    t.fundo.area = Math.random() < 0.5 ? "pagina" : "moldura";
    t.fundo.cor = deHsl(h + 30, 0.45, 0.9);
    t.fundo.g = { tipo: Math.random() < 0.7 ? "linear" : "radial", cores: [deHsl(h - 25, 0.6, 0.86), deHsl(h + 35, 0.55, 0.8), deHsl(h + 90, 0.5, 0.88)].slice(0, Math.random() < 0.5 ? 2 : 3), angulo: Math.floor(Math.random() * 360), x: 30 + Math.floor(Math.random() * 40), y: 20 + Math.floor(Math.random() * 40) };
    t.fundo.p = { forma: Object.keys(FORMAS)[Math.floor(Math.random() * 8)], cor: deHsl(h, s, 0.5), fundo: deHsl(h + 20, 0.4, 0.955), opacidade: 18 + Math.floor(Math.random() * 20), escala: 18 + Math.floor(Math.random() * 30), rotacao: [0, 15, 30, 45][Math.floor(Math.random() * 4)] };
    t.grade.cabFundo = deHsl(h, 0.45, 0.9);
    t.grade.cantos = [4, 8, 12][Math.floor(Math.random() * 3)];
    return validarTema(t);
  }

  /* Aba Cores */
  function htmlCores() {
    const modo = modoAtual();
    const avancado = (ler(CHAVE_PAINEL, {}) || {}).avancado === true;
    const t = (est.pessoal && est.pessoal.tema) || temaEfetivo() || PRESETS[0][1];
    const v = calcular(t, modo);
    const simples = `<div class="ap-grupo"><h3>Modo simples</h3><p class="ap-dica">As versões clara e escura saem destas três cores, com contraste conferido.</p>
      ${campoCor("base.destaque", "Cor de destaque", { dica: "botões, seleção, abas e foco" })}
      ${campoCor("base.fundo", "Cor de fundo da página")}
      ${campoCor("base.grade", "Cor da grade", { dica: "superfície das células" })}</div>`;
    const modoAv = (ler(CHAVE_PAINEL, {}) || {}).modoAv || modo;
    const av = `<div class="ap-grupo"><h3>Modo avançado</h3>
      <div class="ap-segmento" role="group" aria-label="Versão">${[["claro", "Versão clara"], ["escuro", "Ajustar versão escura"]].map(([m, r]) => `<button type="button" data-modo-av="${m}" aria-pressed="${modoAv === m}">${r}</button>`).join("")}</div>
      <p class="ap-dica">Vazio = automático (calculado). Valor atual em ${modoAv === "escuro" ? "modo escuro" : "modo claro"}.</p>
      ${VARS_AVANCADAS.map(([k, nome]) => campoCorAv(k, nome, modoAv, calcular(t, modoAv)[k])).join("")}</div>`;
    const listas = `<div class="ap-grupo"><h3>Cores das listas (${modo === "escuro" ? "versão escura" : "versão clara"})</h3><p class="ap-dica">As opções continuam usando os mesmos nomes de cor (“verde”, “azul”…); aqui muda só como cada cor aparece.</p>
      <div class="ap-listas">${NOMES_COR.map((c) => `<div class="ap-lista-cor"><span class="etq cor-${c}">${NOME_COR[c]}</span>
        ${campoCor(`listas.${modo}.${c}.c`, `${NOME_COR[c]}: texto`, { vazioPermitido: true })}${campoCor(`listas.${modo}.${c}.f`, `${NOME_COR[c]}: fundo do selo`, { vazioPermitido: true })}</div>`).join("")}</div></div>`;
    return `<div class="ap-segmento" role="group" aria-label="Modo">${[["simples", "Simples"], ["avancado", "Avançado"]].map(([m, r]) => `<button type="button" data-modo-cores="${m}" aria-pressed="${(m === "avancado") === avancado}">${r}</button>`).join("")}</div>
      ${avancado ? av : simples}${listas}${htmlRecentes()}<p class="ap-dica">Destaque atual: <span class="ap-amostra" style="background:${v["--lilas"]};color:${textoSobre(v["--lilas"])}">Aa</span></p>`;
  }
  function campoCorAv(k, nome, modoAv, calculado) {
    const caminho = `avancado.${modoAv}.${k}`;
    const html = campoCor(caminho, nome, { vazioPermitido: true });
    return calculado && !lerCampo(caminho) ? html.replace('placeholder="automático"', `placeholder="${esc(opaca(calculado))} (auto)"`).replace(/value="#ffffff" data-cor-seletor/, `value="${esc(opaca(calculado))}" data-cor-seletor`) : html;
  }

  /* Aba Fundo */
  function htmlFundo() {
    const t = (est.pessoal && est.pessoal.tema) || temaEfetivo() || PRESETS[0][1];
    const f = t.fundo;
    const tipos = [["nenhum", "Nenhum"], ["cor", "Cor sólida"], ["gradiente", "Gradiente"], ["padrao", "Padrão"], ["imagem", "Imagem"]];
    let det = "";
    if (f.tipo === "cor") det = campoCor("fundo.cor", "Cor do fundo");
    if (f.tipo === "gradiente") {
      det = `${linhaOpcoes("fundo.g.tipo", f.g.tipo, [["linear", "Linear"], ["radial", "Radial"]], "Tipo")}
        ${f.g.cores.map((c, i) => campoCor(`fundo.g.cores.${i}`, `Cor ${i + 1}`)).join("")}
        <div class="ap-botoes-linha">${f.g.cores.length < 3 ? '<button type="button" class="ap-mini" data-ap="cor3">+ 3ª cor</button>' : '<button type="button" class="ap-mini" data-ap="sem-cor3">Tirar a 3ª cor</button>'}</div>
        ${f.g.tipo === "linear" ? `<div class="ap-roda-linha"><div class="ap-roda" role="slider" tabindex="0" aria-label="Ângulo do gradiente" aria-valuemin="0" aria-valuemax="360" aria-valuenow="${f.g.angulo}" data-roda><span class="ap-roda-ponto" style="transform:rotate(${f.g.angulo}deg) translateY(-30px)"></span></div>${linhaFaixa("fundo.g.angulo", f.g.angulo, 0, 360, "Ângulo", "°")}</div>`
          : `${linhaFaixa("fundo.g.x", f.g.x, 0, 100, "Centro (horizontal)", "%")}${linhaFaixa("fundo.g.y", f.g.y, 0, 100, "Centro (vertical)", "%")}`}`;
    }
    if (f.tipo === "padrao") {
      det = `${linhaOpcoes("fundo.p.forma", f.p.forma, Object.entries(FORMAS), "Desenho")}
        ${campoCor("fundo.p.cor", "Cor do desenho")}${campoCor("fundo.p.fundo", "Cor de fundo")}
        ${linhaFaixa("fundo.p.opacidade", f.p.opacidade, 5, 100, "Opacidade", "%")}${linhaFaixa("fundo.p.escala", f.p.escala, 8, 120, "Escala", " px")}${linhaFaixa("fundo.p.rotacao", f.p.rotacao, 0, 360, "Rotação", "°")}`;
    }
    if (f.tipo === "imagem") {
      const i = f.i;
      det = `<div class="ap-imagem-envio"><label class="ap-mini ap-mini-forte"><input type="file" accept="image/jpeg,image/png,image/webp" data-ap-arquivo hidden>Enviar imagem do computador</label>
          <span class="ap-dica">${f.temImagem ? "Há uma imagem guardada neste navegador." : "JPG, PNG ou WebP. É comprimida aqui mesmo (até 1920 px)."}</span></div>
        <div class="ap-foco" data-foco aria-label="Ponto de foco: arraste ou use as 9 posições"><span class="ap-foco-ponto" style="left:${i.focoX}%;top:${i.focoY}%"></span></div>
        <div class="ap-nove" role="group" aria-label="Ponto de foco">${[0, 50, 100].map((y) => [0, 50, 100].map((x) => `<button type="button" data-foco-pos="${x},${y}" aria-pressed="${i.focoX === x && i.focoY === y}" aria-label="Foco ${x === 0 ? "à esquerda" : x === 50 ? "no centro" : "à direita"}, ${y === 0 ? "em cima" : y === 50 ? "no meio" : "embaixo"}"></button>`).join("")).join("")}</div>
        ${linhaOpcoes("fundo.i.ajuste", i.ajuste, [["cobrir", "Cobrir"], ["conter", "Conter"], ["repetir", "Repetir"]], "Ajuste")}
        ${linhaFaixa("fundo.i.desfoque", i.desfoque, 0, 20, "Desfoque", " px")}${linhaFaixa("fundo.i.brilho", i.brilho, 40, 160, "Brilho", "%")}${linhaFaixa("fundo.i.saturacao", i.saturacao, 0, 200, "Saturação", "%")}
        ${campoCor("fundo.i.veuCor", "Véu por cima (para manter a leitura)")}${linhaFaixa("fundo.i.veuOpacidade", i.veuOpacidade, 0, 85, "Opacidade do véu", "%")}`;
    }
    return `<div class="ap-grupo"><h3>Tipo de fundo</h3><div class="ap-segmento ap-segmento-largo" role="group" aria-label="Tipo de fundo">${tipos.map(([v, r]) => `<button type="button" data-fundo-tipo="${v}" aria-pressed="${f.tipo === v}">${r}</button>`).join("")}</div>
      ${f.tipo !== "nenhum" ? linhaOpcoes("fundo.area", f.area, [["pagina", "Em toda a página"], ["moldura", "Só nas bordas (moldura)"]], "Onde aparece") : ""}</div>
      ${det ? `<div class="ap-grupo">${det}</div>` : ""}
      ${f.tipo !== "nenhum" ? `<div class="ap-grupo"><h3>Grade sobre o fundo</h3>
        ${linhaOpcoes("grade.solida", t.grade.solida ? "1" : "0", [["1", "Sólida"], ["0", "Translúcida"]], "Grade")}
        ${!t.grade.solida ? `${linhaFaixa("grade.opacidade", t.grade.opacidade, 60, 100, "Opacidade da grade", "%")}${linhaCheck("grade.vidro", t.grade.vidro, "Desfoque de vidro (desliga sozinho em aparelhos lentos ou com “reduzir transparência”)")}` : ""}</div>` : ""}
      ${htmlRecentes()}<p class="ap-dica">Na impressão o fundo some: a grade sai branca e o texto preto.</p>`;
  }

  /* Aba Grade */
  function htmlGrade() {
    const t = (est.pessoal && est.pessoal.tema) || temaEfetivo() || PRESETS[0][1];
    const g = t.grade;
    const cols = colunasMotor();
    return `<div class="ap-grupo"><h3>Cabeçalho</h3>${campoCor("grade.cabFundo", "Fundo do cabeçalho", { vazioPermitido: true })}${campoCor("grade.cabTexto", "Texto do cabeçalho", { vazioPermitido: true, dica: "vazio = escolhe claro ou escuro sozinho" })}
        ${linhaCheck("grade.cabNegrito", g.cabNegrito, "Negrito")}${linhaCheck("grade.cabMaiusculas", g.cabMaiusculas, "MAIÚSCULAS")}</div>
      <div class="ap-grupo"><h3>Linhas</h3>${linhaCheck("grade.zebra", g.zebra, "Zebrada (linhas alternadas)")}${g.zebra ? campoCor("grade.zebraCor", "Cor da linha alternada", { vazioPermitido: true }) : ""}
        ${campoCor("grade.hoverCor", "Ao passar o mouse", { vazioPermitido: true })}${campoCor("grade.selecaoCor", "Linha selecionada", { vazioPermitido: true })}
        ${campoCor("grade.ativaCor", "Célula ativa (contorno)", { vazioPermitido: true })}${campoCor("grade.novaCor", "Linha nova (fim da grade)", { vazioPermitido: true })}</div>
      <div class="ap-grupo"><h3>Bordas e caixa</h3>${campoCor("grade.bordaCor", "Cor das bordas", { vazioPermitido: true })}
        ${linhaOpcoes("grade.borda", g.borda, [["fina", "Fina"], ["normal", "Normal"], ["grossa", "Grossa"]], "Espessura")}
        ${linhaOpcoes("grade.bordaEstilo", g.bordaEstilo, [["todas", "Todas"], ["horizontais", "Só horizontais"], ["nenhuma", "Nenhuma"]], "Bordas")}
        ${linhaOpcoes("grade.cantos", g.cantos, [[0, "0 px"], [4, "4 px"], [8, "8 px"], [12, "12 px"]], "Cantos da caixa")}
        ${linhaOpcoes("grade.sombra", g.sombra, [["nenhuma", "Nenhuma"], ["suave", "Suave"], ["forte", "Forte"]], "Sombra")}
        ${campoCor("grade.fixaCor", "Destaque da 1ª coluna", { vazioPermitido: true })}</div>
      <div class="ap-grupo"><h3>Fonte</h3>${linhaOpcoes("grade.fonte", g.fonte, [["site", "A do site (Bricolage)"], ["sistema", "A do sistema"], ["mono", "Monoespaçada"]], "Fonte da grade")}
        <fieldset class="ap-lista-colunas"><legend>Monoespaçada nas colunas de código</legend>${cols.map((c) => `<label class="ap-check"><input type="checkbox" data-mono="${esc(c.id)}"${g.mono.includes(c.id) ? " checked" : ""}> ${esc(c.nome)}</label>`).join("") || '<span class="ap-dica">Sem colunas.</span>'}</fieldset></div>
      ${htmlRecentes()}`;
  }

  /* Aba Colunas */
  function htmlColunas() {
    const t = (est.pessoal && est.pessoal.tema) || temaEfetivo() || PRESETS[0][1];
    const cols = colunasMotor();
    return `<p class="ap-nota">Cor do cabeçalho e um tom leve nas células de cada coluna. Nas colunas de lista dá para pintar a célula inteira com a cor da opção.</p>
      ${cols.map((c) => {
        const cc = t.colunas[c.id] || {};
        const lista = ["lista", "status", "prioridade", "etiquetas"].includes(c.tipo);
        return `<div class="ap-grupo ap-coluna${est.colunaFoco === c.id ? " ap-em-foco" : ""}" data-coluna-cartao="${esc(c.id)}"><h3>${esc(c.nome)}</h3>
          ${campoCor(`colunas.${c.id}.cab`, "Cor do cabeçalho", { vazioPermitido: true })}${campoCor(`colunas.${c.id}.tom`, "Tom nas células", { vazioPermitido: true })}
          ${lista ? `<label class="ap-check"><input type="checkbox" data-coluna-cheia="${esc(c.id)}"${cc.cheia ? " checked" : ""}> Usar a cor da opção na célula inteira</label>` : ""}</div>`;
      }).join("") || '<p class="ap-dica">A planilha ainda não tem colunas.</p>'}`;
  }

  /* Aba Regras */
  function resumoRegra(r) {
    if (r.cond === "obrigatorios") return "Campos obrigatórios vazios";
    const col = colPorId(r.col);
    const nome = col ? col.nome : "(coluna removida)";
    if (r.cond === "corOpcao") return `Linha com a cor da opção de ${nome}`;
    const tipo = tipoRegra(col);
    const cond = ((CONDICOES[tipo] || []).find((c) => c[0] === r.cond) || ["", r.cond])[1];
    let valor = "";
    if (["em", "naoEm"].includes(r.cond)) valor = r.valores.map((id) => ((cfg.opcoes(col) || []).find((o) => o.id === id) || { nome: id }).nome).join(", ");
    else if (["ultimos", "haMais"].includes(r.cond)) valor = `${r.n} dias`;
    else if (r.cond === "entre") valor = `${r.valor} e ${r.valor2}`;
    else if (!["vazio", "naoVazio", "hoje", "sim", "nao"].includes(r.cond)) valor = `“${r.valor}”`;
    return `${nome} ${cond.replace(" N dias", "").replace("N ", "")} ${valor}`.replace(/\s+/g, " ").trim();
  }
  const ALVOS = [["linha", "a linha inteira"], ["celula", "só a célula"], ["texto", "só o texto"]];
  function amostraRegra(r) {
    const modo = modoAtual();
    const t = temaEfetivo();
    const G = t ? calcular(t, modo)["--superficie"] : modo === "escuro" ? "#1b1b1f" : "#ffffff";
    const comFundo = r.fundo && r.alvo !== "texto";
    const f = comFundo ? paraModo(r.fundo, modo, 0.26) : G;
    const tx = r.texto ? opaca(r.texto) : comFundo ? textoSobre(f) : "";
    return `<span class="ap-amostra" style="background:${f};${tx ? `color:${tx};` : ""}${r.negrito ? "font-weight:700;" : ""}${r.riscado ? "text-decoration:line-through;" : ""}">${r.icone ? esc((ICONES_REGRA[r.icone] || "").slice(0, 1)) : ""}Aa</span>`;
  }
  function htmlRegras() {
    const pessoais = est.pessoal ? est.pessoal.regras : [];
    const daPlanilha = regrasPlanilha();
    const cols = colunasMotor();
    const listas = cols.filter((c) => ["lista", "status", "prioridade"].includes(c.tipo));
    const editor = est.editandoRegra ? htmlEditorRegra(pessoais.find((r) => r.id === est.editandoRegra)) : "";
    return `<p class="ap-nota">Aplicadas de cima para baixo: a de cima vence. Arraste pela alça (ou use as setas) para mudar a prioridade. Até ${MAX_REGRAS} regras.</p>
      <div class="ap-grupo"><h3>Atalhos</h3><div class="ap-atalhos">
        ${listas.length ? `<label class="ap-campo"><span>Pintar a linha com a cor da opção de</span><span class="ap-botoes-linha"><select data-atalho-col>${listas.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}</select><button type="button" class="ap-mini" data-atalho="corOpcao">Criar</button></span></label>` : ""}
        <button type="button" class="ap-mini" data-atalho="obrigatorios">Destacar campos obrigatórios vazios</button>
        <label class="ap-campo"><span>Linhas sem</span><span class="ap-botoes-linha"><select data-atalho-vazio>${cols.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}</select><button type="button" class="ap-mini" data-atalho="vazio">Criar</button></span></label>
      </div></div>
      <div class="ap-grupo"><div class="ap-titulo-grupo"><h3>Minhas regras</h3><button type="button" class="ap-mini ap-mini-forte" data-ap="nova-regra"${pessoais.length >= MAX_REGRAS ? " disabled" : ""}>+ Nova regra</button></div>
        <ol class="ap-regras" data-regras>${pessoais.map((r, i) => `<li class="ap-regra${r.ativa ? "" : " desligada"}" data-regra="${esc(r.id)}" draggable="true">
          <button type="button" class="ap-botao-icone ap-alca" data-regra-mover aria-label="Mover a regra ${i + 1} (setas para cima e para baixo)" title="Arraste para mudar a prioridade">${I.alca}</button>
          <label class="ap-check"><input type="checkbox" data-regra-ativa="${esc(r.id)}"${r.ativa ? " checked" : ""} aria-label="Regra ligada"></label>
          ${amostraRegra(r)}<span class="ap-regra-texto">${esc(resumoRegra(r))}<span class="ap-dica"> → ${esc((ALVOS.find((a) => a[0] === r.alvo) || ALVOS[0])[1])} · <span data-contagem="${esc(r.id)}">${contarRegra(r).toLocaleString("pt-BR")}</span> registro(s)</span></span>
          <span class="ap-regra-acoes"><button type="button" class="ap-botao-icone" data-regra-subir="${esc(r.id)}" aria-label="Subir a regra"${i === 0 ? " disabled" : ""}>${I.cima}</button><button type="button" class="ap-botao-icone" data-regra-descer="${esc(r.id)}" aria-label="Descer a regra"${i === pessoais.length - 1 ? " disabled" : ""}>${I.baixo}</button>
          <button type="button" class="ap-mini" data-regra-editar="${esc(r.id)}">Editar</button><button type="button" class="ap-botao-icone" data-regra-apagar="${esc(r.id)}" aria-label="Apagar a regra">${I.limpar}</button></span></li>`).join("") || '<li class="ap-dica">Nenhuma regra ainda.</li>'}</ol>
        ${editor}</div>
      ${daPlanilha.length ? `<div class="ap-grupo" data-sempre><h3>Regras da planilha (administradoras)</h3><ol class="ap-regras">${daPlanilha.map((r) => `<li class="ap-regra${r.ativa ? "" : " desligada"}">${amostraRegra(r)}<span class="ap-regra-texto">${esc(resumoRegra(r))}<span class="ap-dica"> · ${contarRegra(r).toLocaleString("pt-BR")} registro(s)</span></span></li>`).join("")}</ol></div>` : ""}
      ${htmlRecentes()}`;
  }
  function htmlEditorRegra(r) {
    if (!r) return "";
    const cols = colunasMotor();
    const col = colPorId(r.col);
    const tipo = tipoRegra(col);
    const conds = r.cond === "corOpcao" ? [["corOpcao", "cor da opção (pinta a linha)"]] : r.cond === "obrigatorios" ? [["obrigatorios", "campos obrigatórios vazios"]] : CONDICOES[tipo];
    let valor = "";
    if (tipo === "lista" && ["em", "naoEm"].includes(r.cond)) {
      valor = `<fieldset class="ap-lista-colunas"><legend>Opções</legend>${(cfg.opcoes(col) || []).map((o) => `<label class="ap-check"><input type="checkbox" data-regra-opcao="${esc(o.id)}"${r.valores.includes(o.id) ? " checked" : ""}> ${o.cor ? `<span class="etq cor-${esc(o.cor)}">${esc(o.nome)}</span>` : esc(o.nome)}${o.ativa === false ? ' <span class="ap-dica">(removida da lista)</span>' : ""}</label>`).join("")}</fieldset>`;
    } else if (["ultimos", "haMais"].includes(r.cond)) valor = `<label class="ap-campo"><span>N (dias)</span><input type="number" min="0" max="3650" value="${r.n}" data-regra-campo="n"></label>`;
    else if (["antes", "depois"].includes(r.cond)) valor = `<label class="ap-campo"><span>Data</span><input type="date" value="${esc(diaIso(r.valor))}" data-regra-campo="valor"></label>`;
    else if (r.cond === "entre") valor = `<div class="ap-botoes-linha"><label class="ap-campo"><span>De</span><input type="number" value="${esc(r.valor)}" data-regra-campo="valor"></label><label class="ap-campo"><span>Até</span><input type="number" value="${esc(r.valor2)}" data-regra-campo="valor2"></label></div>`;
    else if (!["vazio", "naoVazio", "hoje", "sim", "nao", "corOpcao", "obrigatorios"].includes(r.cond)) valor = `<label class="ap-campo"><span>Valor</span><input type="${tipo === "numero" ? "number" : "text"}" value="${esc(r.valor)}" maxlength="120" data-regra-campo="valor"></label>`;
    const fixo = ["corOpcao", "obrigatorios"].includes(r.cond);
    return `<div class="ap-editor-regra" data-editor-regra="${esc(r.id)}"><h4>Editar regra</h4>
      ${r.cond !== "obrigatorios" ? `<label class="ap-campo"><span>SE a coluna</span><select data-regra-campo="col">${cols.map((c) => `<option value="${esc(c.id)}"${c.id === r.col ? " selected" : ""}>${esc(c.nome)}</option>`).join("")}</select></label>` : ""}
      <label class="ap-campo"><span>Condição</span><select data-regra-campo="cond"${fixo ? " disabled" : ""}>${conds.map(([v, n]) => `<option value="${v}"${v === r.cond ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      ${valor}
      ${r.cond !== "corOpcao" ? `<label class="ap-campo"><span>ENTÃO pintar</span><select data-regra-campo="alvo"${r.cond === "obrigatorios" ? " disabled" : ""}>${ALVOS.map(([v, n]) => `<option value="${v}"${v === r.alvo ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      ${r.alvo !== "texto" ? campoCor(`regra.${r.id}.fundo`, "Cor de fundo", { vazioPermitido: true }) : ""}${campoCor(`regra.${r.id}.texto`, "Cor do texto", { vazioPermitido: true, dica: "vazio = automático (claro ou escuro)" })}
      <div class="ap-botoes-linha">${linhaCheck(`regra.${r.id}.negrito`, r.negrito, "Negrito")}${linhaCheck(`regra.${r.id}.riscado`, r.riscado, "Riscado")}</div>
      <label class="ap-campo"><span>Ícone</span><select data-regra-campo="icone">${Object.entries(ICONES_REGRA).map(([v, n]) => `<option value="${v}"${v === r.icone ? " selected" : ""}>${n}</option>`).join("")}</select></label>` : '<p class="ap-dica">Usa a cor de fundo e de texto de cada opção (as mesmas dos selos), com o contraste delas.</p>'}
      <div class="ap-botoes-linha"><button type="button" class="ap-mini ap-mini-forte" data-ap="fechar-regra">Pronto</button></div></div>`;
  }
  function novaRegra(dados) {
    const p = comRegras();
    if (p.regras.length >= MAX_REGRAS) { cfg.aviso(`Até ${MAX_REGRAS} regras por planilha.`); return null; }
    const r = validarRegra({ id: Math.random().toString(36).slice(2, 10), ativa: true, alvo: "linha", ...dados });
    if (!r) return null;
    p.regras.push(r);
    return r;
  }

  /* Aba Meus temas (salvar, exportar, importar) e padrão da planilha */
  const meus = () => (ler(chaveMeus(), []) || []).map((m) => (m && typeof m === "object" ? { id: String(m.id || "").slice(0, 16), nome: String(m.nome || "Tema").slice(0, 40), tema: validarTema(m.tema), regras: validarRegras(m.regras) } : null)).filter((m) => m && m.tema).slice(0, 10);
  function htmlMeus() {
    const lista = meus();
    const admin = cfg.ehAdmin();
    const pd = est.padrao;
    return `<div class="ap-grupo"><div class="ap-titulo-grupo"><h3>Meus temas</h3><button type="button" class="ap-mini ap-mini-forte" data-ap="salvar-meu"${lista.length >= 10 ? " disabled" : ""}>Salvar o atual</button></div>
        <ul class="ap-meus">${lista.map((m) => `<li><span class="ap-meu-mini">${miniatura(m.tema, modoAtual())}</span><span class="ap-meu-nome">${esc(m.nome)}</span>
          <span class="ap-regra-acoes"><button type="button" class="ap-mini" data-meu-aplicar="${esc(m.id)}">Aplicar</button><button type="button" class="ap-mini" data-meu-renomear="${esc(m.id)}" data-sempre>Renomear</button>
          <button type="button" class="ap-mini" data-meu-duplicar="${esc(m.id)}" data-sempre>Duplicar</button><button type="button" class="ap-botao-icone" data-meu-apagar="${esc(m.id)}" aria-label="Apagar ${esc(m.nome)}" data-sempre>${I.limpar}</button></span></li>`).join("") || '<li class="ap-dica">Nenhum tema salvo (até 10).</li>'}</ul></div>
      <div class="ap-grupo" data-sempre><h3>Compartilhar com um colega</h3>
        <div class="ap-botoes-linha"><button type="button" class="ap-mini" data-ap="exportar-codigo">Copiar código do tema</button><button type="button" class="ap-mini" data-ap="exportar-arquivo">Baixar arquivo (.json, com a imagem)</button></div>
        <label class="ap-campo"><span>Importar: cole o código</span><textarea rows="3" data-importar-codigo spellcheck="false" placeholder="Cole aqui o código do tema"></textarea></label>
        <div class="ap-botoes-linha"><button type="button" class="ap-mini ap-mini-forte" data-ap="importar-codigo">Importar código</button><label class="ap-mini">Importar arquivo .json<input type="file" accept="application/json,.json" data-ap-importar-arquivo hidden></label></div>
        <p class="ap-dica">O código curto não leva a imagem de fundo; o arquivo leva. Tudo é conferido na importação.</p></div>
      ${admin ? `<div class="ap-grupo ap-admin" data-sempre><h3>Padrão desta planilha (para todos)</h3>
        <p class="ap-dica">${pd && pd.tema ? `Há um padrão definido${pd.atualizadoPor ? ` por ${esc(pd.atualizadoPor)}` : ""}.` : "Sem padrão: cada pessoa vê o padrão do site ou a própria aparência."}</p>
        <button type="button" class="ap-mini ap-mini-forte" data-ap="usar-padrao"${temaEfetivo() || regrasPessoais().length ? "" : " disabled"}>Usar como padrão desta planilha para todos</button>
        <label class="ap-check"><input type="checkbox" data-ap-permitir${!pd || pd.permitirPessoal !== false ? " checked" : ""}${pd ? "" : " disabled"}> Permitir aparência pessoal</label>
        <button type="button" class="ap-mini" data-ap="remover-padrao"${pd ? "" : " disabled"}>Remover padrão</button></div>` : ""}`;
  }
  function pacoteAtual() {
    const t = (est.pessoal && est.pessoal.tema) || temaEfetivo();
    return { v: 1, tema: t ? validarTema(t) : null, regras: est.pessoal ? est.pessoal.regras : regrasPlanilha() };
  }
  function codigoDe(pacote) {
    const json = JSON.stringify(pacote);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return "AP1." + btoa(bin);
  }
  function lerCodigo(texto) {
    const s = String(texto || "").trim().replace(/\s+/g, "");
    if (!/^AP1\.[A-Za-z0-9+/=]{10,200000}$/.test(s)) throw new Error("Código inválido.");
    const bin = atob(s.slice(4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function importarPacote(d, imagem) {
    if (!podeEditar()) throw new Error("A aparência desta planilha está fixada pelas administradoras.");
    if (!d || typeof d !== "object" || d.v !== 1) throw new Error("Este arquivo não é um tema da planilha.");
    const tema = d.tema ? validarTema(d.tema) : null;
    const ids = new Set(colunasMotor().map((c) => c.id));
    const regras = validarRegras(d.regras).filter((r) => r.cond === "obrigatorios" || ids.has(r.col));
    if (!tema && !regras.length) throw new Error("Nada para importar.");
    if (tema && Object.keys(tema.colunas).some((id) => !ids.has(id))) Object.keys(tema.colunas).forEach((id) => { if (!ids.has(id)) delete tema.colunas[id]; });
    if (tema) tema.grade.mono = tema.grade.mono.filter((id) => ids.has(id));
    if (tema && tema.fundo.tipo === "imagem") {
      if (dataUrlOk(imagem, 1200000)) {
        const blob = await dataUrlParaBlob(imagem);
        await idb(BANCO, "readwrite", (s) => s.put(blob, `pessoal:${cfg.planilha().id}${quem()}`));
        est.imagemDe = "";
        tema.fundo.temImagem = true;
      } else { tema.fundo.tipo = "cor"; tema.fundo.temImagem = false; }
    }
    rascunho();
    est.pessoal = { tema, regras };
    est.imagemDe = "";
    mudou({ painel: true });
  }
  async function enviarImagem(arquivo) {
    try {
      const blob = await comprimirImagem(arquivo);
      await idb(BANCO, "readwrite", (s) => s.put(blob, `pessoal:${cfg.planilha().id}${quem()}`));
      est.imagemDe = "";
      escreverCampo("fundo.temImagem", true);
      escreverCampo("fundo.tipo", "imagem");
      mudou({ painel: true });
      cfg.aviso(`Imagem pronta (${Math.round(blob.size / 1024)} KB).`);
    } catch (e) { cfg.aviso(e.message || "Não foi possível usar esta imagem."); }
  }
  async function usarComoPadrao() {
    if (!cfg.ehAdmin() || !cfg.padrao) return;
    const pac = pacoteAtual();
    if (!(await cfg.confirmar("Esta aparência passa a ser o padrão desta planilha para todos que não personalizaram. Continuar?", { titulo: "Padrão da planilha", botao: "Usar como padrão" }))) return;
    let imagem = null;
    if (pac.tema && pac.tema.fundo.tipo === "imagem") {
      try {
        let blob = origemTema() === "pessoal" ? await idb(BANCO, "readonly", (s) => s.get(`pessoal:${cfg.planilha().id}${quem()}`)) : null;
        if (!blob && origemTema() === "padrao") { const g = await idb(BANCO, "readonly", (s) => s.get(`padrao:${cfg.planilha().id}`)); blob = g && g.blob; }
        if (blob instanceof Blob) {
          let d = await blobParaDataUrl(blob);
          if (!dataUrlOk(d, 690000)) d = await comprimirImagem(new File([blob], "fundo", { type: blob.type }), { comoDataUrl: true, limiteDataUrl: 690000 });
          imagem = d;
        }
      } catch (e) { console.warn(e); }
      if (!imagem) { cfg.aviso("A imagem de fundo não foi encontrada neste navegador: o padrão vai sem imagem."); pac.tema.fundo.tipo = "cor"; }
    }
    try {
      await cfg.padrao.gravar({ tema: pac.tema, regras: pac.regras, permitirPessoal: !est.padrao || est.padrao.permitirPessoal !== false }, pac.tema && pac.tema.fundo.tipo === "imagem" ? imagem : null);
      est.pessoal = null;
      gravarPessoal();
      ultimoEstado = JSON.stringify(est.pessoal);
      aplicar();
      desenharPainel();
      cfg.aviso("Padrão da planilha salvo para todos.");
    } catch (e) { console.error(e); cfg.aviso("Não foi possível salvar o padrão (confira a conexão e o login)."); }
  }

  /* ---------- Eventos do painel ---------- */
  function aplicarCorCampo(caminho, valor, { painel = false } = {}) {
    if (!corOk(valor) && valor !== "") return;
    escreverCampo(caminho, valor ? valor.toLowerCase() : "");
    if (valor) lembrarCor(valor);
    ultimoCampoCor = caminho;
    mudou({ painel });
  }
  function aoDigitar(e) {
    const el = e.target;
    const cor = el.closest("[data-campo-cor]");
    if (cor && el.matches("[data-cor-seletor]")) {
      const hex = cor.querySelector("[data-cor-hex]");
      hex.value = el.value;
      aplicarCorCampo(cor.dataset.campoCor, el.value);
      return;
    }
    if (cor && el.matches("[data-cor-hex]")) {
      const v = el.value.trim();
      el.setAttribute("aria-invalid", String(!!v && !corOk(v)));
      if (corOk(v)) { cor.querySelector("[data-cor-seletor]").value = opaca(v); aplicarCorCampo(cor.dataset.campoCor, v); }
      return;
    }
    if (el.matches('input[type="range"][data-campo]')) {
      const out = el.closest("label").querySelector("output");
      if (out) out.textContent = el.value + (el.dataset.sufixo || "");
      escreverCampo(el.dataset.campo, Number(el.value));
      if (el.dataset.campo === "fundo.g.angulo") { const pt = est.painel.querySelector(".ap-roda-ponto"); if (pt) pt.style.transform = `rotate(${el.value}deg) translateY(-30px)`; }
      mudou({ repintar: false });
      return;
    }
    if (el.matches("[data-regra-campo]") && ["valor", "valor2", "n"].includes(el.dataset.regraCampo)) {
      escreverCampo(`regra.${el.closest("[data-editor-regra]").dataset.editorRegra}.${el.dataset.regraCampo}`, el.value);
      mudou();
      atualizarContagens();
    }
  }
  function atualizarContagens() {
    if (!est.painel) return;
    (est.pessoal ? est.pessoal.regras : []).forEach((r) => { const s = est.painel.querySelector(`[data-contagem="${CSS.escape(r.id)}"]`); if (s) s.textContent = contarRegra(r).toLocaleString("pt-BR"); });
  }
  function aoMudar(e) {
    const el = e.target;
    if (el.matches("[data-ap-arquivo]")) { if (el.files[0]) enviarImagem(el.files[0]); return; }
    if (el.matches("[data-ap-importar-arquivo]")) {
      const f = el.files[0];
      if (!f) return;
      if (f.size > 3000000) { cfg.aviso("Arquivo grande demais."); return; }
      f.text().then((txt) => { const d = JSON.parse(txt); return importarPacote(d, d && d.imagem); }).then(() => cfg.aviso("Tema importado.")).catch((err) => cfg.aviso(err.message || "Não foi possível importar."));
      return;
    }
    if (el.matches("[data-ap-permitir]")) {
      if (!cfg.ehAdmin() || !est.padrao) return;
      cfg.padrao.gravar({ tema: est.padrao.tema, regras: est.padrao.regras, permitirPessoal: el.checked }, undefined)
        .then(() => cfg.aviso(el.checked ? "As pessoas podem personalizar por cima do padrão." : "Aparência pessoal desligada nesta planilha."))
        .catch(() => { cfg.aviso("Não foi possível salvar."); el.checked = !el.checked; });
      return;
    }
    if (el.matches("select[data-campo]")) {
      let v = el.value;
      if (el.dataset.campo === "grade.solida") v = v === "1";
      else if (el.dataset.campo === "grade.cantos") v = Number(v);
      escreverCampo(el.dataset.campo, v);
      mudou({ painel: true });
      return;
    }
    if (el.matches('input[type="checkbox"][data-campo]')) { escreverCampo(el.dataset.campo, el.checked); mudou({ painel: el.dataset.campo === "grade.zebra" }); return; }
    if (el.matches("[data-mono]")) {
      const t = rascunho().tema;
      const set = new Set(t.grade.mono);
      if (el.checked) set.add(el.dataset.mono); else set.delete(el.dataset.mono);
      t.grade.mono = [...set];
      mudou();
      return;
    }
    if (el.matches("[data-coluna-cheia]")) { escreverCampo(`colunas.${el.dataset.colunaCheia}.cheia`, el.checked); mudou(); return; }
    if (el.matches("[data-regra-ativa]")) { escreverCampo(`regra.${el.dataset.regraAtiva}.ativa`, el.checked); mudou(); el.closest(".ap-regra").classList.toggle("desligada", !el.checked); return; }
    if (el.matches("[data-regra-opcao]")) {
      const id = el.closest("[data-editor-regra]").dataset.editorRegra;
      const r = comRegras().regras.find((x) => x.id === id);
      const set = new Set(r.valores);
      if (el.checked) set.add(el.dataset.regraOpcao); else set.delete(el.dataset.regraOpcao);
      r.valores = [...set];
      mudou({ painel: true });
      return;
    }
    if (el.matches("select[data-regra-campo]")) {
      const id = el.closest("[data-editor-regra]").dataset.editorRegra;
      const r = comRegras().regras.find((x) => x.id === id);
      if (el.dataset.regraCampo === "col") {
        const col = colPorId(el.value);
        const tipo = tipoRegra(col);
        Object.assign(r, { col: el.value, cond: CONDICOES[tipo][0][0], valores: [], valor: "", valor2: "" });
      } else escreverCampo(`regra.${id}.${el.dataset.regraCampo}`, el.value);
      mudou({ painel: true });
    }
  }
  async function aoClicar(e) {
    const b = e.target.closest("button, [data-roda]");
    if (!b) return;
    const aba = b.dataset.aba;
    if (aba) { est.aba = aba; salvarPainel(); desenharPainel(); return; }
    const acao = b.dataset.ap;
    if (acao === "fechar") { fechar(); return; }
    if (acao === "desfazer") { desfazer(); return; }
    if (acao === "refazer") { refazerAcao(); return; }
    if (acao === "restaurar") {
      if (!(await cfg.confirmar(est.padrao && est.padrao.tema ? "Apagar a sua aparência pessoal desta planilha e voltar ao padrão da planilha?" : "Apagar a sua aparência pessoal desta planilha e voltar ao padrão do site?", { titulo: "Restaurar padrão", botao: "Restaurar" }))) return;
      est.pilha.push(JSON.stringify(est.pessoal));
      est.pessoal = null;
      est.imagemPendente = null;
      idb(BANCO, "readwrite", (s) => s.delete(`pessoal:${cfg.planilha().id}${quem()}`)).catch(() => {});
      est.imagemDe = "";
      mudou({ painel: true });
      return;
    }
    if (acao === "corrigir") { corrigirContraste(); return; }
    if (!podeEditar() && !b.closest("[data-sempre]") && !b.matches("[data-modo-cores], [data-modo-av]")) return;
    if (b.dataset.preset) {
      const p = PRESETS.find(([id]) => id === b.dataset.preset);
      if (!p) return;
      const atual = rascunho();
      const colunas = atual.tema ? atual.tema.colunas : {};
      const mono = atual.tema ? atual.tema.grade.mono : [];
      atual.tema = clonar(p[1]);
      atual.tema.colunas = colunas;
      atual.tema.grade.mono = mono;
      mudou({ painel: true });
      cfg.aviso(`Tema “${p[1].nome}” aplicado.`);
      return;
    }
    if (acao === "sorte") { const atual = rascunho(); const t = surpreenda(); t.colunas = atual.tema.colunas; t.grade.mono = atual.tema.grade.mono; atual.tema = t; mudou({ painel: true }); return; }
    if (b.dataset.modoCores) { const pref = ler(CHAVE_PAINEL, {}) || {}; pref.avancado = b.dataset.modoCores === "avancado"; gravar(CHAVE_PAINEL, { ...pref, aba: est.aba, largura: est.largura }); desenharPainel(); return; }
    if (b.dataset.modoAv) { const pref = ler(CHAVE_PAINEL, {}) || {}; pref.modoAv = b.dataset.modoAv; gravar(CHAVE_PAINEL, { ...pref, aba: est.aba, largura: est.largura }); desenharPainel(); return; }
    const caixaCor = b.closest("[data-campo-cor]");
    if (caixaCor && b.dataset.cor) {
      const caminho = caixaCor.dataset.campoCor;
      if (b.dataset.cor === "limpar") { aplicarCorCampo(caminho, "", { painel: true }); return; }
      if (b.dataset.cor === "copiar") { const v = lerCampo(caminho); corCopiada = corOk(v) ? v : ""; try { await navigator.clipboard.writeText(corCopiada); } catch (err) {} cfg.aviso(corCopiada ? `Cor ${corCopiada} copiada.` : "Sem cor para copiar."); return; }
      if (b.dataset.cor === "colar") {
        let v = corCopiada;
        try { const t = (await navigator.clipboard.readText()).trim(); if (corOk(t)) v = t; } catch (err) {}
        if (corOk(v)) aplicarCorCampo(caminho, v, { painel: true }); else cfg.aviso("Copie uma cor (#rrggbb) antes de colar.");
        return;
      }
      if (b.dataset.cor === "gotas" && "EyeDropper" in window) {
        try { const r = await new window.EyeDropper().open(); if (r && corOk(r.sRGBHex)) aplicarCorCampo(caminho, r.sRGBHex, { painel: true }); } catch (err) {}
        return;
      }
    }
    if (b.dataset.recente) { if (ultimoCampoCor) aplicarCorCampo(ultimoCampoCor, b.dataset.recente, { painel: true }); else cfg.aviso("Escolha primeiro uma cor em algum campo."); return; }
    if (b.dataset.fundoTipo) {
      escreverCampo("fundo.tipo", b.dataset.fundoTipo);
      mudou({ painel: true });
      if (b.dataset.fundoTipo === "imagem" && !lerCampo("fundo.temImagem")) setTimeout(() => { const f = est.painel.querySelector("[data-ap-arquivo]"); if (f) f.click(); }, 50);
      return;
    }
    if (acao === "cor3") { const t = rascunho().tema; t.fundo.g.cores = [...t.fundo.g.cores, misturar(t.fundo.g.cores[0], t.fundo.g.cores[1], 0.5)].slice(0, 3); mudou({ painel: true }); return; }
    if (acao === "sem-cor3") { const t = rascunho().tema; t.fundo.g.cores = t.fundo.g.cores.slice(0, 2); mudou({ painel: true }); return; }
    if (b.dataset.focoPos) { const [x, y] = b.dataset.focoPos.split(",").map(Number); escreverCampo("fundo.i.focoX", x); escreverCampo("fundo.i.focoY", y); mudou({ painel: true }); return; }
    /* Regras */
    if (b.dataset.atalho) {
      const a = b.dataset.atalho;
      let r = null;
      if (a === "corOpcao") r = novaRegra({ col: est.painel.querySelector("[data-atalho-col]").value, cond: "corOpcao", alvo: "linha" });
      if (a === "obrigatorios") r = novaRegra({ cond: "obrigatorios", alvo: "celula", fundo: "#fde2e1" });
      if (a === "vazio") r = novaRegra({ col: est.painel.querySelector("[data-atalho-vazio]").value, cond: "vazio", alvo: "linha", fundo: "#fdf3c4" });
      if (r) { est.editandoRegra = r.id; mudou({ painel: true }); }
      return;
    }
    if (acao === "nova-regra") {
      const col = colunasMotor()[0];
      if (!col) return;
      const r = novaRegra({ col: col.id, cond: CONDICOES[tipoRegra(col)][0][0], alvo: "linha", fundo: "#fde2e1" });
      if (r) { est.editandoRegra = r.id; mudou({ painel: true }); }
      return;
    }
    if (acao === "fechar-regra") { est.editandoRegra = null; desenharPainel(); return; }
    if (b.dataset.regraEditar) { est.editandoRegra = est.editandoRegra === b.dataset.regraEditar ? null : b.dataset.regraEditar; desenharPainel(); return; }
    if (b.dataset.regraApagar) { comRegras().regras = est.pessoal.regras.filter((r) => r.id !== b.dataset.regraApagar); if (est.editandoRegra === b.dataset.regraApagar) est.editandoRegra = null; mudou({ painel: true }); return; }
    if (b.dataset.regraSubir || b.dataset.regraDescer) { moverRegra(b.dataset.regraSubir || b.dataset.regraDescer, b.dataset.regraSubir ? -1 : 1); return; }
    /* Meus temas */
    if (acao === "salvar-meu") {
      const lista = meus();
      if (lista.length >= 10) { cfg.aviso("Até 10 temas salvos."); return; }
      const nome = (prompt("Nome do tema:", (temaEfetivo() && temaEfetivo().nome) || "Meu tema") || "").trim().slice(0, 40);
      if (!nome) return;
      const pac = pacoteAtual();
      if (!pac.tema) { cfg.aviso("Escolha um tema ou mude as cores antes de salvar."); return; }
      gravar(chaveMeus(), [...lista, { id: Math.random().toString(36).slice(2, 10), nome, tema: { ...pac.tema, nome }, regras: pac.regras }]);
      desenharPainel();
      return;
    }
    if (b.dataset.meuAplicar) { const m = meus().find((x) => x.id === b.dataset.meuAplicar); if (m) { await importarPacote({ v: 1, tema: m.tema, regras: m.regras }); cfg.aviso(`Tema “${m.nome}” aplicado.`); } return; }
    if (b.dataset.meuRenomear) {
      const lista = meus(); const m = lista.find((x) => x.id === b.dataset.meuRenomear); if (!m) return;
      const nome = (prompt("Novo nome:", m.nome) || "").trim().slice(0, 40); if (!nome) return;
      m.nome = nome; m.tema.nome = nome; gravar(chaveMeus(), lista); desenharPainel(); return;
    }
    if (b.dataset.meuDuplicar) {
      const lista = meus(); const m = lista.find((x) => x.id === b.dataset.meuDuplicar); if (!m) return;
      if (lista.length >= 10) { cfg.aviso("Até 10 temas salvos."); return; }
      lista.push({ ...clonar(m), id: Math.random().toString(36).slice(2, 10), nome: `${m.nome} (cópia)`.slice(0, 40) }); gravar(chaveMeus(), lista); desenharPainel(); return;
    }
    if (b.dataset.meuApagar) { if (!(await cfg.confirmar("Apagar este tema salvo?", { titulo: "Meus temas", botao: "Apagar", perigo: true }))) return; gravar(chaveMeus(), meus().filter((x) => x.id !== b.dataset.meuApagar)); desenharPainel(); return; }
    if (acao === "exportar-codigo") {
      const c = codigoDe(pacoteAtual());
      let ok = false;
      try { await navigator.clipboard.writeText(c); ok = true; } catch (err) {}
      const caixa = est.painel.querySelector("[data-importar-codigo]");
      if (caixa && !ok) { caixa.value = c; caixa.select(); }
      cfg.aviso(ok ? "Código do tema copiado. Mande para o colega colar em “Importar”." : "Copie o código que apareceu na caixa.");
      return;
    }
    if (acao === "exportar-arquivo") {
      const pac = pacoteAtual();
      if (pac.tema && pac.tema.fundo.tipo === "imagem") {
        try {
          const blob = origemTema() === "pessoal" ? await idb(BANCO, "readonly", (s) => s.get(`pessoal:${cfg.planilha().id}${quem()}`)) : ((await idb(BANCO, "readonly", (s) => s.get(`padrao:${cfg.planilha().id}`))) || {}).blob;
          if (blob instanceof Blob) pac.imagem = await blobParaDataUrl(blob);
        } catch (err) {}
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(pac)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `tema-${(cfg.planilha().id || "planilha").replace(/[^a-z0-9-]/gi, "")}.json`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      return;
    }
    if (acao === "importar-codigo") {
      try { await importarPacote(lerCodigo(est.painel.querySelector("[data-importar-codigo]").value)); cfg.aviso("Tema importado."); }
      catch (err) { cfg.aviso(err.message || "Código inválido."); }
      return;
    }
    if (acao === "usar-padrao") { await usarComoPadrao(); return; }
    if (acao === "remover-padrao") {
      if (!cfg.ehAdmin() || !(await cfg.confirmar("Remover o padrão desta planilha? Cada pessoa volta a ver o padrão do site ou a própria aparência.", { titulo: "Remover padrão", botao: "Remover", perigo: true }))) return;
      try { await cfg.padrao.remover(); cfg.aviso("Padrão da planilha removido."); } catch (err) { cfg.aviso("Não foi possível remover."); }
    }
  }
  function moverRegra(id, passo) {
    const lista = comRegras().regras;
    const i = lista.findIndex((r) => r.id === id), j = i + passo;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    mudou({ painel: true });
    setTimeout(() => { const el = est.painel.querySelector(`[data-regra="${CSS.escape(id)}"] [data-regra-mover]`); if (el) el.focus(); }, 0);
  }
  function ligarArrastarRegras(p) {
    let arrastada = null;
    p.addEventListener("dragstart", (e) => { const li = e.target.closest("[data-regra]"); if (!li) return; arrastada = li.dataset.regra; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", arrastada); });
    p.addEventListener("dragover", (e) => { if (arrastada && e.target.closest("[data-regra]")) e.preventDefault(); });
    p.addEventListener("drop", (e) => {
      const li = e.target.closest("[data-regra]");
      if (!arrastada || !li) return;
      e.preventDefault();
      const lista = comRegras().regras;
      const de = lista.findIndex((r) => r.id === arrastada), para = lista.findIndex((r) => r.id === li.dataset.regra);
      if (de >= 0 && para >= 0 && de !== para) { const [r] = lista.splice(de, 1); lista.splice(para, 0, r); mudou({ painel: true }); }
      arrastada = null;
    });
    p.addEventListener("dragend", () => { arrastada = null; });
  }
  function aoTecla(e) {
    if (e.key === "Escape") { e.stopPropagation(); fechar(); return; }
    const aba = e.target.closest("[data-aba]");
    if (aba && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const i = ABAS.findIndex((a) => a[0] === aba.dataset.aba);
      const j = e.key === "Home" ? 0 : e.key === "End" ? ABAS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + ABAS.length) % ABAS.length;
      est.aba = ABAS[j][0]; salvarPainel(); desenharPainel();
      est.painel.querySelector(`[data-aba="${est.aba}"]`).focus();
      return;
    }
    const mover = e.target.closest("[data-regra-mover]");
    if (mover && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); moverRegra(mover.closest("[data-regra]").dataset.regra, e.key === "ArrowUp" ? -1 : 1); return; }
    const roda = e.target.closest("[data-roda]");
    if (roda && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const a = (Number(lerCampo("fundo.g.angulo")) + (e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : -5) + 360) % 360;
      escreverCampo("fundo.g.angulo", a); mudou({ painel: true, repintar: false });
      setTimeout(() => { const r = est.painel.querySelector("[data-roda]"); if (r) r.focus(); }, 0);
    }
  }
  /* Roda do ângulo e ponto de foco da imagem: arrastar */
  document.addEventListener("pointerdown", (e) => {
    const roda = e.target.closest && e.target.closest("[data-roda]");
    const foco = e.target.closest && e.target.closest("[data-foco]");
    if ((!roda && !foco) || !est.painel || !est.painel.contains(e.target) || !podeEditar()) return;
    e.preventDefault();
    const alvo = roda || foco;
    const mover = (ev) => {
      const r = alvo.getBoundingClientRect();
      if (roda) {
        const a = Math.round(((Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2)) * 180) / Math.PI + 90 + 360) % 360);
        escreverCampo("fundo.g.angulo", a);
        const pt = alvo.querySelector(".ap-roda-ponto"); if (pt) pt.style.transform = `rotate(${a}deg) translateY(-30px)`;
        alvo.setAttribute("aria-valuenow", String(a));
      } else {
        const x = limitar(Math.round(((ev.clientX - r.left) / r.width) * 100), 0, 100), y = limitar(Math.round(((ev.clientY - r.top) / r.height) * 100), 0, 100);
        escreverCampo("fundo.i.focoX", x); escreverCampo("fundo.i.focoY", y);
        const pt = alvo.querySelector(".ap-foco-ponto"); if (pt) { pt.style.left = x + "%"; pt.style.top = y + "%"; }
      }
      mudou({ repintar: false });
    };
    mover(e);
    const fim = () => { document.removeEventListener("pointermove", mover); document.removeEventListener("pointerup", fim); desenharPainel(); };
    document.addEventListener("pointermove", mover);
    document.addEventListener("pointerup", fim);
  });

  /* ---------- Padrão da planilha (Firestore) ---------- */
  function validarPadrao(d) {
    if (!d || typeof d !== "object") return null;
    const tema = d.tema ? validarTema(d.tema) : null;
    const regras = validarRegras(d.regras);
    if (!tema && !regras.length) return null;
    return { tema, regras, permitirPessoal: d.permitirPessoal !== false, atualizadoPor: String(d.atualizadoPor || "").slice(0, 120), atualizadoEm: String(d.atualizadoEm || "").slice(0, 40) };
  }
  /* O último padrão recebido fica guardado: ao abrir a página ele já vale (sem piscar) até o Firestore responder */
  const chavePadrao = () => `${P}-aparencia-padrao:${cfg.planilha().id}`;
  function desligarPadrao() {
    if (est.pararPadrao) { try { est.pararPadrao(); } catch (e) {} est.pararPadrao = null; }
  }
  function ouvirPadrao() {
    desligarPadrao();
    if (!cfg.padrao || !cfg.padrao.ouvir) return;
    const id = cfg.planilha().id;
    est.pararPadrao = cfg.padrao.ouvir((d) => {
      if (cfg.planilha().id !== id) return;
      est.padrao = validarPadrao(d);
      if (est.padrao) gravar(chavePadrao(), est.padrao); else apagar(chavePadrao());
      aplicar();
      desenharPainel();
    }) || null;
  }

  /* ---------- Início, troca de planilha, tema claro/escuro ---------- */
  function carregar() {
    est.pessoal = lerPessoal();
    est.padrao = validarPadrao(ler(chavePadrao(), null));
    est.pilha = []; est.refazer = []; ultimoEstado = JSON.stringify(est.pessoal);
    est.imagemDe = ""; est.imagemPendente = null; est.editandoRegra = null;
    aplicar();
    ouvirPadrao();
    desenharPainel();
  }
  new MutationObserver((m) => { if (m.some((x) => x.attributeName === "data-tema")) { aplicar(); desenharPainel(); } }).observe(raiz, { attributes: true, attributeFilter: ["data-tema"] });
  try { matchMedia("(prefers-contrast: more)").addEventListener("change", () => aplicar()); } catch (e) {}
  criarBotao();
  /* Com login (cfg.usuario), a aparência da pessoa entra depois de entrar; até lá vale o que o tema.js já pintou */
  if (!cfg.usuario || cfg.usuario()) carregar();

  return {
    /* Classes da linha e das células (cache por linha; invalidado quando a linha ou a aparência muda) */
    daLinha,
    abrir, fechar,
    corDaColuna: (colId) => abrir("colunas", colId),
    aoTrocarPlanilha: carregar,
    /* Estrutura nova (colunas/opções): recalcula o CSS e as classes */
    aoMudarEstrutura: () => { est.cache = new WeakMap(); aplicar({ repintar: false }); if (est.painel && !est.painel.hidden && ["colunas", "regras", "grade"].includes(est.aba)) desenharPainel(); },
    /* Linhas novas ou alteradas chegam como objetos novos: o cache por linha já se renova sozinho */
    aoMudarDados: () => { if (est.painel && !est.painel.hidden && est.aba === "regras") atualizarContagens(); },
    aoMudarSessao: () => { aplicar(); desenharPainel(); },
    /* Conexão pronta (ou login feito): passa a ouvir o padrão da planilha; ao sair, para de ouvir */
    religarPadrao: ouvirPadrao,
    desligarPadrao,
    /* Para os testes */
    _estado: est, _validarTema: validarTema, _validarRegras: validarRegras, _gerar: gerarVariaveis, _contraste: contraste, _presets: PRESETS, _codigo: codigoDe, _lerCodigo: lerCodigo, _problemas: problemasContraste
  };
}
