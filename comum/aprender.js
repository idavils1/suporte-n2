/*
 * ============================================================
 *  APRENDIZAGEM - TIRE SUAS DÚVIDAS (aprender.html)
 *  Hierarquia: CATEGORIA (área) → TRILHA (curso) → MÓDULO (capítulo) → AULA (tema).
 *  "Tema" antigo = aula; "subtema" = aula filha (paiId). Endereços:
 *    #inicio · #categoria/<id> · #trilha/<id> (e o antigo #trilha-<id>) · #<aula> · #<aula>/<seção> · #glossario[/<termo>]
 *  Dados: conhecimento/{aula}, conhecimento-config/{trilhas|categorias|glossario}, conhecimento-capas/{tipo-id}.
 *  Sem nada publicado, vale o conteúdo embutido (aprender-conteudo.js). Quem não é administradora
 *  só recebe aulas com oculto == false (filtro na consulta + firestore.rules).
 *  O modo edição das administradoras está em aprender-editor.js.
 * ============================================================
 */
import { $, $$, escapar, normalizar, svg, slug, mostrarAviso, ligarTema, ligarLogin, aoMudarSessao, ehAdmin, sessao,
  registrarAuditoria, confirmar, abrirSugestao, lerLocal, gravarLocal, partesBrasilia, formatarData } from "./base.js";
import { renderizarMarkdown } from "./markdown.js";
import { CATEGORIAS_PADRAO, TRILHAS_PADRAO, TEMAS_PADRAO, GLOSSARIO_PADRAO, CONTEUDO_VERSAO, NOVIDADES_CONTEUDO, TEMAS_SUBSTITUIDOS, TEMAS_COM_TERMOS_NOVOS } from "./aprender-conteudo.js";
import { DIAGRAMAS } from "./aprender-diagramas.js";
import { iniciarEditor } from "./aprender-editor.js";

export const NOME = "Aprendizagem - Tire suas dúvidas";
const NIVEIS = ["Básico", "Intermediário", "Avançado"];
const SECOES = [
  { id: "frase", titulo: "Em uma frase", icone: "i-lampada" },
  { id: "simples", titulo: "Explicando de um jeito simples", icone: "i-pessoas" },
  { id: "funciona", titulo: "Como funciona", icone: "i-engrenagem" },
  { id: "exemplo", titulo: "Exemplo prático no Suporte N2", icone: "i-ferramenta" },
  { id: "duvidas", titulo: "Erros e dúvidas comuns", icone: "i-ajuda" },
  { id: "termos", titulo: "Termos relacionados", icone: "i-tag" },
  { id: "saibaMais", titulo: "Para saber mais", icone: "i-externo" }
];
/* Ícones do site que podem ir em categoria, trilha, módulo, aula e seção */
const ICONES = ["i-livro", "i-aprender", "i-certificado", "i-escudo", "i-cadeado", "i-plug", "i-telefone", "i-globo", "i-ferramenta", "i-engrenagem", "i-lampada",
  "i-pessoas", "i-conversa", "i-documento", "i-tabela", "i-lista", "i-tag", "i-ajuda", "i-info", "i-alerta", "i-erro", "i-sucesso", "i-check", "i-trofeu", "i-estrela",
  "i-relogio", "i-calendario", "i-busca", "i-email", "i-link", "i-externo", "i-upload", "i-download", "i-megafone", "i-cartao", "i-imagem", "i-grade"];
/* Cores de destaque (as do tema; "roxo" é o lilás da Central). Sem rosa/magenta de propósito. */
const CORES = { roxo: "Lilás", azul: "Azul", verde: "Verde", laranja: "Laranja", amarelo: "Amarelo", vermelho: "Vermelho", cinza: "Cinza" };
const CHAVE_APRENDIDOS = "suporte-n2-aprender-aprendidos";
const CHAVE_ULTIMO = "suporte-n2-aprender-ultimo";
const CHAVE_RECENTES = "suporte-n2-aprender-recentes";
const CHAVE_LATERAL = "suporte-n2-aprender-lateral-recolhida";
const CHAVE_REPASSAR = "suporte-n2-aprender-so-repassar";
const CHAVE_MODULOS = "suporte-n2-aprender-modulos-fechados";
const ID_VALIDO = /^[a-z0-9-]{1,60}$/;
const ID_BLOCO = /^[a-z0-9-]{1,40}$/;
const QUINZE_DIAS = 15 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------
 *  Normalização (mesmo formato no embutido e no Firestore)
 * ------------------------------------------------------------ */
const txt = (v, max) => String(v == null ? "" : v).slice(0, max);
const numero = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
const corValida = (c) => (CORES[c] ? c : "");
function normalizarCapa(c) {
  if (!c || typeof c !== "object") return null;
  if (c.tipo === "imagem") return { tipo: "imagem" };
  if (c.tipo === "gradiente") return { tipo: "gradiente", estilo: ["diagonal", "ondas", "pontos"].includes(c.estilo) ? c.estilo : "diagonal" };
  return null;
}
function normalizarCategoria(c, i) {
  if (!c || !ID_VALIDO.test(c.id || "")) return null;
  return { id: c.id, nome: txt(c.nome, 60) || c.id, descricao: txt(c.descricao, 300), icone: ICONES.includes(c.icone) ? c.icone : "i-livro",
    cor: corValida(c.cor) || "roxo", ordem: Number(c.ordem) || i + 1, oculto: c.oculto === true, capa: normalizarCapa(c.capa) };
}
function normalizarModulo(m, i) {
  if (!m || !ID_VALIDO.test(m.id || "")) return null;
  return { id: m.id, nome: txt(m.nome, 80) || m.id, descricao: txt(m.descricao, 300), ordem: Number(m.ordem) || i + 1, oculto: m.oculto === true,
    icone: ICONES.includes(m.icone) ? m.icone : "", cor: corValida(m.cor) };
}
function normalizarTrilha(t, i) {
  if (!t || !ID_VALIDO.test(t.id || "")) return null;
  const aviso = t.aviso && typeof t.aviso === "object" && txt(t.aviso.texto, 200).trim() ? { texto: txt(t.aviso.texto, 200).trim(), aula: ID_VALIDO.test(t.aviso.aula || "") ? t.aviso.aula : "" } : null;
  return {
    id: t.id, nome: txt(t.nome, 100) || t.id, descricao: txt(t.descricao, 300), icone: ICONES.includes(t.icone) ? t.icone : "i-livro", ordem: Number(t.ordem) || i + 1,
    categoria: ID_VALIDO.test(t.categoria || "") ? t.categoria : "",
    modulos: (Array.isArray(t.modulos) ? t.modulos : []).map(normalizarModulo).filter(Boolean).slice(0, 30),
    oculto: t.oculto === true, destaque: numero(t.destaque, 0, 99), cor: corValida(t.cor), capa: normalizarCapa(t.capa),
    nivel: NIVEIS.includes(t.nivel) ? t.nivel : "", tempo: numero(t.tempo, 0, 6000), aviso, fontes: txt(t.fontes, 400),
    atualizadoEm: typeof t.atualizadoEm === "string" ? t.atualizadoEm : ""
  };
}
function normalizarBloco(b, i) {
  if (!b || typeof b !== "object") return null;
  return { id: ID_BLOCO.test(b.id || "") ? b.id : `b${i + 1}`, titulo: txt(b.titulo, 120).trim() || "Seção", icone: ICONES.includes(b.icone) ? b.icone : "i-livro", markdown: txt(b.markdown, 200000) };
}
function normalizarTema(t) {
  if (!t || !ID_VALIDO.test(t.id || "")) return null;
  const s = t.secoes && typeof t.secoes === "object" ? t.secoes : {};
  const secoes = {};
  SECOES.forEach((x) => { secoes[x.id] = txt(s[x.id], 60000); });
  const vistos = new Set();
  const blocos = (Array.isArray(t.blocos) ? t.blocos : []).map(normalizarBloco).filter(Boolean).slice(0, 40)
    .map((b) => { let id = b.id, n = 2; while (vistos.has(id)) id = `${b.id}-${n++}`; vistos.add(id); return { ...b, id }; });
  return {
    id: t.id, trilha: txt(t.trilha, 60), modulo: ID_VALIDO.test(t.modulo || "") ? t.modulo : "", paiId: ID_VALIDO.test(t.paiId || "") ? t.paiId : null, ordem: Number(t.ordem) || 0,
    titulo: txt(t.titulo, 120) || t.id, resumo: txt(t.resumo, 300), nivel: NIVEIS.includes(t.nivel) ? t.nivel : "Básico",
    palavrasChave: Array.isArray(t.palavrasChave) ? t.palavrasChave.map((p) => txt(p, 40)).filter(Boolean).slice(0, 30) : [],
    secoes, blocos,
    oculto: t.oculto === true, ocultaPropria: t.ocultaPropria === true, destaque: numero(t.destaque, 0, 99),
    cor: corValida(t.cor), icone: ICONES.includes(t.icone) ? t.icone : "", tempo: numero(t.tempo, 0, 600), capa: normalizarCapa(t.capa),
    revisarEm: /^\d{4}-\d{2}-\d{2}$/.test(t.revisarEm || "") ? t.revisarEm : "",
    atualizadoEm: t.atualizadoEm || "", atualizadoPor: txt(t.atualizadoPor, 80)
  };
}
const normalizarGlossario = (lista) => (Array.isArray(lista) ? lista : []).map((g) => ({ termo: txt(g && g.termo, 60).trim(), definicao: txt(g && g.definicao, 400).trim(), tema: ID_VALIDO.test((g && g.tema) || "") ? g.tema : "" })).filter((g) => g.termo && g.definicao);

const estado = {
  api: null,
  categorias: CATEGORIAS_PADRAO.map(normalizarCategoria).filter(Boolean),
  trilhas: TRILHAS_PADRAO.map(normalizarTrilha).filter(Boolean),
  temas: TEMAS_PADRAO.map(normalizarTema).filter(Boolean),
  glossario: normalizarGlossario(GLOSSARIO_PADRAO),
  capas: new Map(),
  publicado: false,
  carregou: { temas: false, trilhas: false, categorias: false },
  versaoPublicada: null,
  configTrilhas: null,
  rota: null,
  edicao: false,
  ultimaBusca: "",
  geracao: 0
};

/* ------------------------------------------------------------
 *  Hierarquia, visibilidade e ordem
 * ------------------------------------------------------------ */
const porOrdem = (a, b) => (a.ordem || 0) - (b.ordem || 0) || String(a.titulo || a.nome || "").localeCompare(String(b.titulo || b.nome || ""), "pt-BR");
const porId = (id) => estado.temas.find((t) => t.id === id);
const trilhaPorId = (id) => estado.trilhas.find((t) => t.id === id);
const categoriaPorId = (id) => estado.categorias.find((c) => c.id === id);
const MODULO_UNICO = { id: "conteudo", nome: "Conteúdo", descricao: "", ordem: 1, oculto: false, icone: "", cor: "", virtual: true };
/* Trilhas antigas sem módulos ganham um módulo único "Conteúdo" */
const modulosDe = (tr) => (tr && tr.modulos.length ? [...tr.modulos].sort(porOrdem) : [MODULO_UNICO]);
function moduloDe(a, profundidade = 0) {
  const pai = a.paiId && porId(a.paiId);
  if (pai && profundidade < 10) return moduloDe(pai, profundidade + 1);
  const ms = modulosDe(trilhaPorId(a.trilha));
  return ms.some((m) => m.id === a.modulo) ? a.modulo : ms[0].id;
}
const categoriaOculta = (id) => { const c = categoriaPorId(id); return !!c && c.oculto; };
const trilhaOculta = (tr) => !tr || tr.oculto || categoriaOculta(tr.categoria);
/* Oculta de fato: a própria aula, a mãe, o módulo, a trilha ou a categoria estão ocultos (é o que vai no campo "oculto") */
function ocultoEfetivo(a, profundidade = 0) {
  if (a.ocultaPropria) return true;
  const tr = trilhaPorId(a.trilha);
  if (trilhaOculta(tr)) return true;
  const m = modulosDe(tr).find((x) => x.id === moduloDe(a));
  if (m && m.oculto) return true;
  const pai = a.paiId && porId(a.paiId);
  return !!pai && profundidade < 10 && ocultoEfetivo(pai, profundidade + 1);
}
const visivel = (a) => !!a && (ehAdmin() || !ocultoEfetivo(a));
const trilhaVisivel = (tr) => !!tr && (ehAdmin() || !trilhaOculta(tr));
const categoriaVisivel = (c) => !!c && (ehAdmin() || !c.oculto);
const categoriasOrdenadas = () => [...estado.categorias].sort(porOrdem).filter(categoriaVisivel);
/* Trilhas cuja categoria não existe ficam em "Outras" */
const categoriaDaTrilha = (tr) => (categoriaPorId(tr.categoria) ? tr.categoria : "outras");
const trilhasDaCategoria = (id) => [...estado.trilhas].sort(porOrdem).filter((t) => categoriaDaTrilha(t) === id && trilhaVisivel(t));
function trilhasOrdenadas() {
  const cats = categoriasOrdenadas().map((c) => c.id).concat("outras");
  return cats.flatMap(trilhasDaCategoria);
}
const filhos = (id) => estado.temas.filter((t) => t.paiId === id && visivel(t)).sort(porOrdem);
const raizesDoModulo = (trilha, modulo) => estado.temas.filter((t) => t.trilha === trilha && (!t.paiId || !porId(t.paiId)) && moduloDe(t) === modulo && visivel(t)).sort(porOrdem);
/* Aulas da trilha na ordem de leitura: módulo, aula, filhas */
function aulasDaTrilha(id, comModulo = false) {
  const tr = trilhaPorId(id);
  if (!tr) return [];
  const lista = [];
  const visitar = (t, m, nivel) => { lista.push(comModulo ? { aula: t, modulo: m, nivel } : t); filhos(t.id).forEach((f) => visitar(f, m, nivel + 1)); };
  modulosDe(tr).filter((m) => ehAdmin() || !m.oculto).forEach((m) => raizesDoModulo(id, m.id).forEach((t) => visitar(t, m, 0)));
  return lista;
}
const aprendidos = () => new Set(lerLocal(CHAVE_APRENDIDOS, []));
function progresso(trilha, lista = aulasDaTrilha(trilha)) {
  const feitos = aprendidos();
  const n = lista.filter((t) => feitos.has(t.id)).length;
  return { n, total: lista.length, pct: lista.length ? Math.round((n / lista.length) * 100) : 0 };
}
const blocosDe = (t) => (t.blocos && t.blocos.length ? t.blocos
  : SECOES.filter((s) => (t.secoes[s.id] || "").trim()).map((s) => ({ id: s.id, titulo: s.titulo, icone: s.icone, markdown: t.secoes[s.id] })));
const textoDaAula = (t) => blocosDe(t).map((b) => b.markdown).join(" ");
const minutosLeitura = (t) => t.tempo || Math.max(1, Math.round(textoDaAula(t).split(/\s+/).filter(Boolean).length / 200));
const minutosTrilha = (tr, lista = aulasDaTrilha(tr.id)) => tr.tempo || lista.reduce((s, t) => s + minutosLeitura(t), 0);
const textoTempo = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);
function dataMaisRecente(tr, lista = aulasDaTrilha(tr.id)) {
  return [tr.atualizadoEm, ...lista.map((t) => t.atualizadoEm)].filter(Boolean).map((d) => Date.parse(d)).filter((n) => !isNaN(n)).reduce((a, b) => Math.max(a, b), 0);
}
const ehNovo = (tr, lista) => { const d = dataMaisRecente(tr, lista); return d > 0 && Date.now() - d < QUINZE_DIAS; };
const podeEditar = () => ehAdmin() && !!estado.api && estado.publicado;
const estilosCor = (cor) => (cor ? ` style="--c: var(--c-${cor}); --f: var(--f-${cor})"` : "");
const corDaTrilha = (tr) => tr.cor || (categoriaPorId(tr.categoria) || {}).cor || "roxo";

/* Recentes ("Continue de onde parou") */
function registrarRecente(id) {
  const lista = lerLocal(CHAVE_RECENTES, []).filter((x) => x && x.id !== id).slice(0, 11);
  gravarLocal(CHAVE_RECENTES, [{ id, em: Date.now() }, ...lista]);
  gravarLocal(CHAVE_ULTIMO, id);
}
function recentes() {
  const lista = lerLocal(CHAVE_RECENTES, []);
  const ult = lerLocal(CHAVE_ULTIMO, "");
  if (ult && !lista.some((x) => x && x.id === ult)) lista.unshift({ id: ult, em: 0 });
  return lista.map((x) => x && porId(x.id)).filter((t) => t && visivel(t) && trilhaPorId(t.trilha));
}

/* ------------------------------------------------------------
 *  Markdown
 * ------------------------------------------------------------ */
const md = (texto) => renderizarMarkdown(texto || "", { diagramas: DIAGRAMAS }).html;
function htmlDuvidas(texto) {
  const partes = String(texto || "").split(/^###\s+/m);
  const intro = partes.shift().trim();
  return (intro ? `<div class="md">${md(intro)}</div>` : "") + partes.map((p) => {
    const [pergunta, ...resto] = p.split("\n");
    return `<details class="duvida"><summary>${escapar(pergunta.trim())}</summary><div class="md">${md(resto.join("\n").trim())}</div></details>`;
  }).join("");
}
function htmlTermos(texto) {
  const itens = String(texto || "").split(",").map((x) => x.trim()).filter(Boolean);
  return `<div class="chips">${itens.map((x) => {
    const tema = porId(x) || estado.temas.find((t) => normalizar(t.titulo) === normalizar(x));
    if (tema && visivel(tema)) return `<a class="chip" href="#${escapar(tema.id)}">${svg("i-livro")}${escapar(tema.titulo)}</a>`;
    if (tema) return "";
    const g = estado.glossario.find((k) => normalizar(k.termo) === normalizar(x));
    if (g) return `<a class="chip" href="#glossario/${escapar(slug(g.termo, 60))}" title="${escapar(g.definicao)}">${escapar(g.termo)}</a>`;
    return `<span class="chip">${escapar(x)}</span>`;
  }).join("")}</div>`;
}
const corpoDoBloco = (b) => (b.id === "frase" ? `<div class="em-uma-frase md">${md(b.markdown)}</div>`
  : b.id === "duvidas" ? htmlDuvidas(b.markdown)
  : b.id === "termos" ? htmlTermos(b.markdown)
  : `<div class="md">${md(b.markdown)}</div>`);

/* ------------------------------------------------------------
 *  Peças comuns
 * ------------------------------------------------------------ */
const seloRascunho = (oculto) => (ehAdmin() && oculto ? `<span class="selo selo-rascunho" title="Oculto: só as administradoras veem">${svg("i-olho-cortado")}Rascunho</span>` : "");
const barraProgresso = (p, rotulo, classe = "") => `<div class="progresso${classe}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-label="${escapar(rotulo)}"><i style="width:${p.pct}%"></i></div>`;
function estiloCapa(tipo, item, cor) {
  const imagem = item.capa && item.capa.tipo === "imagem" && estado.capas.get(`${tipo}-${item.id}`);
  if (imagem) return ` style="--c: var(--c-${cor}); --f: var(--f-${cor}); background-image: url('${escapar(imagem)}')" data-capa="imagem"`;
  return ` style="--c: var(--c-${cor}); --f: var(--f-${cor})" data-capa="${escapar((item.capa && item.capa.estilo) || "diagonal")}"`;
}
/* Ilustração própria da categoria: formas simples com a cor de destaque + o ícone */
function ilustracaoCategoria(c, i) {
  const formas = [
    '<circle cx="104" cy="14" r="34" class="ilu-a"/><circle cx="18" cy="74" r="22" class="ilu-b"/><path d="M0 58 Q60 30 120 56" class="ilu-c"/>',
    '<rect x="70" y="-10" width="70" height="70" rx="18" transform="rotate(18 105 25)" class="ilu-a"/><circle cx="24" cy="18" r="10" class="ilu-b"/><path d="M0 70 L40 44 L80 64 L120 40" class="ilu-c"/>',
    '<circle cx="96" cy="64" r="30" class="ilu-a"/><rect x="6" y="6" width="34" height="34" rx="10" class="ilu-b"/><path d="M10 64 Q50 84 70 50 T120 20" class="ilu-c"/>'
  ][i % 3];
  return `<span class="cat-ilustracao" aria-hidden="true"><svg viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">${formas}</svg><span class="cat-icone">${svg(c.icone)}</span></span>`;
}

/* ------------------------------------------------------------
 *  Início (hero, continue, categorias, trilhas, destaques)
 * ------------------------------------------------------------ */
function saudacao() {
  const h = Number(partesBrasilia().hora);
  return h < 12 ? "Bom dia!" : h < 18 ? "Boa tarde!" : "Boa noite!";
}
function htmlCartaoTrilha(tr, emDestaque = false) {
  const lista = aulasDaTrilha(tr.id);
  const p = progresso(tr.id, lista);
  const cor = corDaTrilha(tr);
  const n = lista.length;
  return `<article class="cartao-trilha"${emDestaque ? ed.item("destaque", "trilha:" + tr.id) : ed.item("trilha", tr.id)}>
    <div class="cartao-capa"${estiloCapa("trilha", tr, cor)}><span class="cartao-icone">${svg(tr.icone)}</span>
      <span class="cartao-selos">${ehNovo(tr, lista) ? '<span class="selo selo-novo">Novo</span>' : ""}${tr.destaque ? `<span class="selo selo-destaque" title="Em destaque">${svg("i-estrela")}</span>` : ""}${seloRascunho(trilhaOculta(tr))}</span></div>
    <div class="cartao-corpo">
      <h3><a class="cartao-link" href="#trilha/${escapar(tr.id)}"${ed.renomeavel("trilha", tr.id)}>${escapar(tr.nome)}</a></h3>
      <p class="cartao-descricao">${escapar(tr.descricao)}</p>
      <p class="cartao-meta">${tr.nivel ? `<span class="selo nivel-${slug(tr.nivel)}">${escapar(tr.nivel)}</span>` : ""}<span>${svg("i-livro")}${n} aula${n === 1 ? "" : "s"}</span>${n ? `<span>${svg("i-relogio")}${textoTempo(minutosTrilha(tr, lista))}</span>` : ""}</p>
      ${n ? `${barraProgresso(p, `Progresso em ${tr.nome}`)}<span class="cartao-progresso">${p.n ? `${p.n} de ${n} aprendida${p.n === 1 ? "" : "s"}` : "Ainda não começou"}</span>` : '<span class="selo">Em breve</span>'}
    </div>${emDestaque ? ed.controles("destaque", "trilha:" + tr.id) : ed.controles("trilha", tr.id)}</article>`;
}
function htmlCartaoAula(t, rotulo = "") {
  const tr = trilhaPorId(t.trilha);
  const cor = t.cor || (tr ? corDaTrilha(tr) : "roxo");
  const p = tr ? progresso(tr.id) : null;
  return `<article class="cartao-aula"${estilosCor(cor)}${rotulo ? "" : ed.item("destaque", "aula:" + t.id)}>
    <span class="cartao-aula-icone">${svg(t.icone || (tr && tr.icone) || "i-livro")}</span>
    <div><span class="cartao-aula-trilha">${escapar(rotulo || (tr ? tr.nome : ""))}</span>
      <h3><a class="cartao-link" href="#${escapar(t.id)}">${escapar(t.titulo)}</a></h3>
      ${p && p.total ? `${barraProgresso(p, `Progresso na trilha ${tr.nome}`, " fino")}<span class="cartao-progresso">${p.pct}% da trilha</span>` : ""}</div>${rotulo ? "" : ed.controles("destaque", "aula:" + t.id)}</article>`;
}
function htmlInicio(filtro) {
  const cats = categoriasOrdenadas();
  const semCategoria = trilhasDaCategoria("outras");
  const catAtual = filtro && categoriaPorId(filtro);
  const vistos = recentes().slice(0, 10);
  const chips = `<nav class="chips-categorias" aria-label="Filtrar por categoria"><a class="chip-cat" href="#inicio"${!catAtual ? ' aria-current="page"' : ""}>Todas</a>${cats.map((c) => `<a class="chip-cat"${estilosCor(c.cor)} href="#categoria/${escapar(c.id)}"${catAtual && catAtual.id === c.id ? ' aria-current="page"' : ""}>${svg(c.icone)}${escapar(c.nome)}</a>`).join("")}</nav>`;
  const destaques = [
    ...estado.trilhas.filter((t) => t.destaque && trilhaVisivel(t)).map((t) => ({ ordem: t.destaque, html: htmlCartaoTrilha(t, true), chave: "trilha:" + t.id })),
    ...estado.temas.filter((t) => t.destaque && visivel(t)).map((t) => ({ ordem: t.destaque, html: htmlCartaoAula(t), chave: "aula:" + t.id }))
  ].sort((a, b) => a.ordem - b.ordem);
  const atualizadas = estado.temas.filter((t) => visivel(t) && t.atualizadoEm && trilhaPorId(t.trilha)).sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm))).slice(0, 6);
  const secaoCategoria = (c, trilhas) => `<section class="secao-categoria"${estilosCor(c.cor)} aria-labelledby="cat-${escapar(c.id)}"${ed.item("categoria", c.id)}>
      <div class="secao-categoria-topo"><h2 id="cat-${escapar(c.id)}">${svg(c.icone)}<span${ed.renomeavel("categoria", c.id)}>${escapar(c.nome)}</span>${seloRascunho(c.oculto)}</h2>${ed.controles("categoria", c.id)}</div>
      ${c.descricao ? `<p class="apoio">${escapar(c.descricao)}</p>` : ""}
      <div class="grade-trilhas"${ed.zona("trilha", c.id)}>${trilhas.map((t) => htmlCartaoTrilha(t)).join("") || '<p class="apoio vazia">Ainda não há trilhas nesta categoria.</p>'}${ed.adicionar("trilha", c.id)}</div></section>`;
  return `${htmlFaixaPublicar()}
    <section class="hero"${catAtual ? estilosCor(catAtual.cor) : ""}>
      <div class="hero-texto"><p class="hero-saudacao">${saudacao()}</p>
        <h1>${catAtual ? escapar(catAtual.nome) : escapar(NOME)}</h1>
        <p class="hero-frase">${catAtual ? escapar(catAtual.descricao || "Trilhas desta categoria.") : "Conceitos e procedimentos do Suporte explicados de um jeito simples. Busque uma aula, um termo ou um código de erro."}</p>
        <div id="lugar-busca" class="lugar-busca"></div></div>
      <div class="hero-arte" aria-hidden="true"><svg viewBox="0 0 240 200"><circle cx="170" cy="70" r="58" class="ilu-a"/><rect x="40" y="96" width="96" height="74" rx="18" class="ilu-b"/><path d="M20 60 Q90 10 150 60 T230 150" class="ilu-c"/><circle cx="64" cy="54" r="12" class="ilu-c-cheio"/></svg><span class="hero-icone">${svg(catAtual ? catAtual.icone : "i-aprender")}</span></div>
    </section>
    ${chips}
    ${!catAtual && vistos.length ? `<section class="secao-home" aria-labelledby="t-continue"><div class="secao-home-topo"><h2 id="t-continue">Continue de onde parou</h2>
        <div class="carrossel-botoes"><button type="button" class="btn-icone" data-carrossel="-1" aria-label="Voltar no carrossel">${svg("i-chevron-esquerda")}</button><button type="button" class="btn-icone" data-carrossel="1" aria-label="Avançar no carrossel">${svg("i-chevron-direita")}</button></div></div>
      <ul class="carrossel" id="carrossel" aria-label="Últimas aulas abertas">${vistos.map((t) => `<li>${htmlCartaoAula(t, (trilhaPorId(t.trilha) || {}).nome || "")}</li>`).join("")}</ul></section>` : ""}
    ${!catAtual && (destaques.length || ed.ativo()) ? `<section class="secao-home" aria-labelledby="t-destaque"><div class="secao-home-topo"><h2 id="t-destaque">${svg("i-estrela")}Em destaque</h2>${ed.ativo() ? '<span class="apoio">Arraste para mudar a ordem. Use o menu ⋯ de uma trilha ou aula para pôr ou tirar do destaque.</span>' : ""}</div>
      <div class="grade-destaques"${ed.zona("destaque", "")}>${destaques.map((d) => d.html).join("") || '<p class="apoio vazia">Nada em destaque ainda.</p>'}</div></section>` : ""}
    ${!catAtual ? `<section class="secao-home" aria-labelledby="t-categorias"><div class="secao-home-topo"><h2 id="t-categorias">Categorias</h2></div>
      <div class="grade-categorias">${cats.map((c, i) => {
        const trs = trilhasDaCategoria(c.id);
        const aulas = trs.reduce((s, t) => s + aulasDaTrilha(t.id).length, 0);
        return `<a class="cartao-categoria"${estilosCor(c.cor)} href="#categoria/${escapar(c.id)}">${ilustracaoCategoria(c, i)}<span class="cartao-categoria-corpo"><strong>${escapar(c.nome)}</strong>${seloRascunho(c.oculto)}<span class="apoio">${trs.length} trilha${trs.length === 1 ? "" : "s"} · ${aulas} aula${aulas === 1 ? "" : "s"}</span></span></a>`;
      }).join("")}${ed.adicionar("categoria", "")}</div></section>` : ""}
    <div class="lista-categorias"${ed.zona("categoria", "")}>
      ${(catAtual ? [catAtual] : cats).map((c) => secaoCategoria(c, trilhasDaCategoria(c.id))).join("")}
      ${!catAtual && semCategoria.length ? secaoCategoria({ id: "outras", nome: "Outras trilhas", descricao: "", icone: "i-livro", cor: "cinza", oculto: false }, semCategoria) : ""}
    </div>
    ${!catAtual && atualizadas.length ? `<section class="secao-home" aria-labelledby="t-recentes"><div class="secao-home-topo"><h2 id="t-recentes">${svg("i-relogio")}Atualizadas recentemente</h2></div>
      <div class="grade-destaques">${atualizadas.map((t) => htmlCartaoAula(t, `${(trilhaPorId(t.trilha) || {}).nome || ""} · ${formatarData(t.atualizadoEm)}`)).join("")}</div></section>` : ""}
    <section class="secao-home"><a class="cartao-glossario" href="#glossario"><span class="cartao-aula-icone">${svg("i-livro")}</span><span><strong>Glossário A–Z</strong><span class="apoio">${estado.glossario.length} termos explicados em uma linha.</span></span>${svg("i-chevron-direita")}</a></section>`;
}

/* ------------------------------------------------------------
 *  Trilha (capa + módulos em acordeão)
 * ------------------------------------------------------------ */
const modulosFechados = () => new Set(lerLocal(CHAVE_MODULOS, []));
function htmlFaixaTrilha(tr) {
  if (!tr || !tr.aviso) return "";
  const alvo = tr.aviso.aula && porId(tr.aviso.aula);
  return `<div class="faixa-trilha" role="note">${svg("i-alerta")}<span>${escapar(tr.aviso.texto)}</span>${alvo && visivel(alvo) ? `<a href="#${escapar(alvo.id)}">Ver ${escapar(alvo.titulo)}</a>` : ""}</div>`;
}
function proximaAula(tr, lista = aulasDaTrilha(tr.id)) {
  const feitos = aprendidos();
  return lista.find((t) => !feitos.has(t.id)) || lista[0];
}
function htmlTrilha(id) {
  const tr = trilhaPorId(id);
  const cat = categoriaPorId(tr.categoria);
  const lista = aulasDaTrilha(id, true);
  const aulas = lista.map((x) => x.aula);
  const p = progresso(id, aulas);
  const feitos = aprendidos();
  const fechados = modulosFechados();
  const cor = corDaTrilha(tr);
  const prox = aulas.length ? proximaAula(tr, aulas) : null;
  const item = (t, nivel) => `<li class="aula-item${feitos.has(t.id) ? " feita" : ""}" style="--nivel:${nivel}"${ed.item("aula", t.id)}>
      <a href="#${escapar(t.id)}"><span class="aula-marca" aria-hidden="true">${feitos.has(t.id) ? svg("i-check") : svg(t.icone || "i-livro")}</span>
        <span class="aula-titulo"${ed.renomeavel("aula", t.id)}>${escapar(t.titulo)}</span>${feitos.has(t.id) ? '<span class="sr-only">(aprendida)</span>' : ""}
        <span class="aula-meta">${seloRascunho(ocultoEfetivo(t))}<span class="selo nivel-${slug(t.nivel)}">${escapar(t.nivel)}</span><span>${minutosLeitura(t)} min</span></span></a>${ed.controles("aula", t.id)}</li>`;
  const modulos = modulosDe(tr).filter((m) => ehAdmin() || !m.oculto);
  return `${htmlFaixaPublicar()}<div class="pagina-trilha"${estilosCor(cor)}>
    <header class="trilha-topo">
      <div class="trilha-capa"${estiloCapa("trilha", tr, cor)}><span class="cartao-icone">${svg(tr.icone)}</span></div>
      <div class="trilha-info">
        <nav class="migalhas" aria-label="Você está em"><a href="#inicio">Aprendizagem</a> › ${cat ? `<a href="#categoria/${escapar(cat.id)}">${escapar(cat.nome)}</a> › ` : ""}<span aria-current="page">${escapar(tr.nome)}</span></nav>
        <h1${ed.renomeavel("trilha", tr.id)}>${escapar(tr.nome)}</h1>${seloRascunho(trilhaOculta(tr))}
        <p class="resumo">${escapar(tr.descricao)}</p>
        <p class="cartao-meta">${tr.nivel ? `<span class="selo nivel-${slug(tr.nivel)}">${escapar(tr.nivel)}</span>` : ""}<span>${svg("i-lista")}${modulos.length} módulo${modulos.length === 1 ? "" : "s"}</span><span>${svg("i-livro")}${aulas.length} aula${aulas.length === 1 ? "" : "s"}</span>${aulas.length ? `<span>${svg("i-relogio")}${textoTempo(minutosTrilha(tr, aulas))}</span>` : ""}${ehNovo(tr, aulas) ? '<span class="selo selo-novo">Novo</span>' : ""}</p>
        ${aulas.length ? `<div class="trilha-progresso">${barraProgresso(p, `Progresso em ${tr.nome}`)}<span class="apoio">${p.n} de ${p.total} aulas aprendidas</span></div>
          <a class="btn" href="#${escapar(prox.id)}">${svg(p.n ? "i-chevron-direita" : "i-aprender")}${p.n ? (p.n === p.total ? "Rever a trilha" : "Continuar") : "Começar"}</a>` : ""}
        ${tr.fontes ? `<p class="fontes">${svg("i-documento")}<span><strong>Fontes:</strong> ${escapar(tr.fontes)}</span></p>` : ""}
      </div>${ed.controles("trilha", tr.id, { pagina: true })}
    </header>
    ${htmlFaixaTrilha(tr)}
    <div class="modulos"${ed.zona("modulo", tr.id)}>${modulos.map((m, i) => {
      const daqui = lista.filter((x) => x.modulo.id === m.id);
      const pm = progresso(id, daqui.map((x) => x.aula));
      const aberto = !fechados.has(`${tr.id}/${m.id}`);
      const corpoId = `mod-${escapar(tr.id)}-${escapar(m.id)}`;
      return `<section class="modulo${aberto ? " aberto" : ""}"${m.cor ? estilosCor(m.cor) : ""}${m.virtual ? "" : ed.item("modulo", `${tr.id}/${m.id}`)}>
        <div class="modulo-topo"><h2><button type="button" class="modulo-cabeca" data-modulo="${escapar(tr.id)}/${escapar(m.id)}" aria-expanded="${aberto}" aria-controls="${corpoId}">
          <span class="modulo-num" aria-hidden="true">${i + 1}</span><span class="modulo-textos"><span class="modulo-rotulo">Módulo ${i + 1}</span>
          <span class="modulo-nome"${m.virtual ? "" : ed.renomeavel("modulo", `${tr.id}/${m.id}`)}>${escapar(m.nome)}</span></span>
          <span class="modulo-meta">${seloRascunho(m.oculto)}<span>${daqui.length} aula${daqui.length === 1 ? "" : "s"}</span>${daqui.length ? `<span class="modulo-pct">${pm.pct}%</span>` : ""}</span>${svg("i-chevron-baixo", "icone seta")}</button></h2>
          ${m.virtual ? "" : ed.controles("modulo", `${tr.id}/${m.id}`)}</div>
        ${daqui.length ? barraProgresso(pm, `Progresso no módulo ${m.nome}`, " fino") : ""}
        <div class="modulo-corpo" id="${corpoId}"${aberto ? "" : " hidden"}>${m.descricao ? `<p class="apoio">${escapar(m.descricao)}</p>` : ""}
          <ol class="lista-aulas"${ed.zona("aula", `${tr.id}/${m.id}`)}>${daqui.map((x) => item(x.aula, x.nivel)).join("") || '<li class="apoio vazia">Ainda não há aulas neste módulo.</li>'}</ol>
          ${ed.adicionar("aula", `${tr.id}/${m.id}`)}</div></section>`;
    }).join("")}</div>
    ${ed.adicionar("modulo", tr.id)}${ed.zonaOutrasTrilhas(tr.id)}</div>`;
}

/* ------------------------------------------------------------
 *  Aula (árvore lateral, conteúdo em seções e sumário)
 * ------------------------------------------------------------ */
function htmlArvore(tr, atual) {
  const lista = aulasDaTrilha(tr.id, true);
  const feitos = aprendidos();
  const p = progresso(tr.id, lista.map((x) => x.aula));
  const modulos = modulosDe(tr).filter((m) => ehAdmin() || !m.oculto);
  return `<div class="arvore-topo"><a class="arvore-trilha" href="#trilha/${escapar(tr.id)}">${svg(tr.icone)}<span>${escapar(tr.nome)}</span></a>
      ${barraProgresso(p, `Progresso em ${tr.nome}`, " fino")}<span class="apoio arvore-pct">${p.n} de ${p.total} aprendidas</span></div>
    <nav class="arvore" aria-label="Aulas da trilha">${modulos.map((m, i) => {
      const daqui = lista.filter((x) => x.modulo.id === m.id);
      if (!daqui.length) return "";
      return `<div class="arvore-modulo"><p class="arvore-modulo-nome"><span aria-hidden="true">${i + 1}</span>${escapar(m.nome)}</p><ul>${daqui.map((x) => `<li style="--nivel:${x.nivel}"><a href="#${escapar(x.aula.id)}"${x.aula.id === atual ? ' aria-current="page"' : ""}>
        <span class="arvore-marca" aria-hidden="true">${feitos.has(x.aula.id) ? svg("i-check", "icone ok") : ""}</span><span>${escapar(x.aula.titulo)}</span>${feitos.has(x.aula.id) ? '<span class="sr-only">(aprendida)</span>' : ""}</a></li>`).join("")}</ul></div>`;
    }).join("")}</nav>
    <div class="lateral-rodape"><a href="#inicio">${svg("i-casa")}Início</a><a href="#glossario">${svg("i-livro")}Glossário A–Z</a></div>`;
}
function htmlTema(t) {
  const tr = trilhaPorId(t.trilha);
  const cat = tr && categoriaPorId(tr.categoria);
  const m = tr && modulosDe(tr).find((x) => x.id === moduloDe(t));
  const caminho = [];
  let pai = t.paiId && porId(t.paiId);
  while (pai && caminho.length < 5) { caminho.unshift(pai); pai = pai.paiId && porId(pai.paiId); }
  const seq = tr ? aulasDaTrilha(tr.id) : [t];
  const i = seq.findIndex((x) => x.id === t.id);
  const ant = seq[i - 1], prox = seq[i + 1];
  const feito = aprendidos().has(t.id);
  const hoje = (() => { const x = partesBrasilia(); return `${x.ano}-${x.mes}-${x.dia}`; })();
  const blocos = blocosDe(t);
  const sub = filhos(t.id);
  const cor = t.cor || (tr ? corDaTrilha(tr) : "roxo");
  const recolhida = lerLocal(CHAVE_LATERAL, false) === true;
  const capa = t.capa ? `<div class="aula-capa"${estiloCapa("aula", t, cor)}></div>` : "";
  return `${htmlFaixaPublicar()}<div class="aula-layout${recolhida ? " lateral-recolhida" : ""}"${estilosCor(cor)}>
    <aside class="lateral" id="lateral" aria-label="Aulas da trilha">${tr ? htmlArvore(tr, t.id) : ""}
      <button type="button" class="btn btn-secundario btn-mini btn-recolher" data-acao="recolher" aria-expanded="${!recolhida}" aria-controls="lateral">${svg("i-chevron-esquerda")}<span>Recolher</span></button></aside>
    <article class="artigo${lerLocal(CHAVE_REPASSAR, false) === true ? " so-repassar" : ""}" id="artigo">
      <button type="button" class="btn btn-secundario btn-mini btn-trilhas" data-acao="abrir-lateral" aria-controls="lateral" aria-expanded="false">${svg("i-lista")}Aulas da trilha</button>
      <button type="button" class="btn btn-secundario btn-mini btn-mostrar-lateral" data-acao="recolher" aria-controls="lateral" aria-expanded="false">${svg("i-lista")}Mostrar as aulas</button>
      ${htmlFaixaTrilha(tr)}${capa}
      <nav class="migalhas" aria-label="Você está em"><a href="#inicio">Aprendizagem</a> › ${cat ? `<a href="#categoria/${escapar(cat.id)}">${escapar(cat.nome)}</a> › ` : ""}${tr ? `<a href="#trilha/${escapar(tr.id)}">${escapar(tr.nome)}</a> › ` : ""}${m && !m.virtual ? `<span>${escapar(m.nome)}</span> › ` : ""}${caminho.map((c) => `<a href="#${escapar(c.id)}">${escapar(c.titulo)}</a> › `).join("")}<span aria-current="page">${escapar(t.titulo)}</span></nav>
      <h1${ed.renomeavel("aula", t.id)}>${escapar(t.titulo)}</h1>
      <div class="meta">${seloRascunho(ocultoEfetivo(t))}<span class="selo nivel-${slug(t.nivel)}">${escapar(t.nivel)}</span><span>${svg("i-relogio")} ${minutosLeitura(t)} min de leitura</span>
        ${t.atualizadoEm ? `<span>Atualizado em ${escapar(formatarData(t.atualizadoEm))}</span>` : ""}
        ${ehAdmin() && t.revisarEm ? `<span class="selo${t.revisarEm <= hoje ? " revisar-vencido" : ""}">Revisar em ${escapar(formatarData(t.revisarEm + "T12:00:00"))}</span>` : ""}</div>
      <div class="acoes-artigo">
        <button type="button" class="btn btn-secundario btn-mini btn-repassar" data-acao="repassar" aria-pressed="false" hidden>${svg("i-filtro")}Mostrar só o que posso repassar ao cliente</button>
        ${ed.botoesAula(t)}
      </div>
      <p class="aviso-repassar apoio" hidden></p>
      ${t.resumo ? `<p class="resumo">${escapar(t.resumo)}</p>` : ""}
      ${blocos.map((b) => `<section class="secao" id="sec-${escapar(b.id)}" aria-labelledby="sec-${escapar(b.id)}-t"><h2 id="sec-${escapar(b.id)}-t">${svg(b.icone)}${escapar(b.titulo)}</h2>${corpoDoBloco(b)}</section>`).join("")}
      ${sub.length ? `<section class="secao"><h2>${svg("i-livro")}Dentro desta aula</h2><div class="chips">${sub.map((s) => `<a class="chip" href="#${escapar(s.id)}">${escapar(s.titulo)}</a>`).join("")}</div></section>` : ""}
      <footer class="rodape-artigo">
        <div class="rodape-acoes">
          <button type="button" class="btn${feito ? " btn-secundario" : ""}" data-acao="aprendido" aria-pressed="${feito}">${svg(feito ? "i-check" : "i-trofeu")}${feito ? "Aprendido" : "Marcar como aprendido"}</button>
          <button type="button" class="btn btn-secundario" data-acao="sugerir">${svg("i-anotacao")}Sugerir melhoria</button>
          <button type="button" class="btn btn-secundario" data-acao="imprimir">${svg("i-imprimir")}Imprimir</button>
        </div>
        <nav class="navegacao" aria-label="Aula anterior e próxima">
          ${ant ? `<a href="#${escapar(ant.id)}"><span>← Aula anterior</span><strong>${escapar(ant.titulo)}</strong></a>` : ""}
          ${prox ? `<a class="proximo" href="#${escapar(prox.id)}"><span>Próxima aula →</span><strong>${escapar(prox.titulo)}</strong></a>`
            : tr ? `<a class="proximo" href="#trilha/${escapar(tr.id)}"><span>Fim da trilha →</span><strong>Voltar para ${escapar(tr.nome)}</strong></a>` : ""}
        </nav>
      </footer></article>
    <nav class="sumario" aria-label="Nesta aula"><p class="sumario-titulo">Nesta aula</p><ol>${blocos.map((b) => `<li><a href="#${escapar(t.id)}/${escapar(b.id)}" data-ir-secao="${escapar(b.id)}">${escapar(b.titulo)}</a></li>`).join("")}</ol></nav>
  </div>`;
}

/* ------------------------------------------------------------
 *  Glossário
 * ------------------------------------------------------------ */
function htmlGlossario() {
  const ordenados = [...estado.glossario].sort((a, b) => a.termo.localeCompare(b.termo, "pt-BR", { sensitivity: "base" }));
  const porLetra = new Map();
  ordenados.forEach((g) => { const l = normalizar(g.termo).charAt(0).toUpperCase(); const k = /[A-Z]/.test(l) ? l : "#"; if (!porLetra.has(k)) porLetra.set(k, []); porLetra.get(k).push(g); });
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  return `<div class="artigo glossario"><nav class="migalhas" aria-label="Você está em"><a href="#inicio">Aprendizagem</a> › <span aria-current="page">Glossário</span></nav>
    <h1>Glossário A–Z</h1><p class="resumo">Os termos que aparecem no dia a dia, explicados em uma linha.</p>
    ${ed.botoesGlossario()}
    <nav class="glossario-letras" aria-label="Letras">${letras.map((l) => porLetra.has(l) ? `<a href="#glossario" data-letra="${l}">${l}</a>` : `<span aria-hidden="true">${l}</span>`).join("")}</nav>
    ${[...porLetra.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([l, itens]) => `<h2 id="letra-${l}">${l}</h2><dl>${itens.map((g) => {
      const tema = g.tema && porId(g.tema);
      return `<dt id="termo-${slug(g.termo, 60)}">${escapar(g.termo)}</dt><dd>${escapar(g.definicao)}${tema && visivel(tema) ? ` <a href="#${escapar(g.tema)}">Ver a aula</a>` : ""}</dd>`;
    }).join("")}</dl>`).join("")}</div>`;
}

/* ------------------------------------------------------------
 *  Rotas
 * ------------------------------------------------------------ */
function lerRota() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h || h === "inicio") return { tipo: "inicio" };
  if (h.startsWith("categoria/")) { const c = categoriaPorId(h.slice(10)); return c && categoriaVisivel(c) ? { tipo: "inicio", categoria: c.id } : { tipo: "inicio", desconhecido: h }; }
  if (h === "glossario" || h.startsWith("glossario/")) return { tipo: "glossario", termo: h.split("/")[1] || "" };
  if (h.startsWith("trilha/") || h.startsWith("trilha-")) { const tr = trilhaPorId(h.slice(7)); if (tr && trilhaVisivel(tr)) return { tipo: "trilha", id: tr.id }; }
  const [aula, bloco] = h.split("/");
  const t = porId(aula);
  if (t && visivel(t)) return { tipo: "tema", id: aula, bloco: bloco || "" };
  return { tipo: "inicio", desconhecido: h };
}
let ultimoDesconhecido = "";
function navegar(focar = true) {
  estado.rota = lerRota();
  const p = $("#pagina");
  const rota = estado.rota;
  const posicao = window.scrollY;
  devolverBusca();
  if (rota.tipo === "tema") p.innerHTML = htmlTema(porId(rota.id));
  else if (rota.tipo === "trilha") p.innerHTML = htmlTrilha(rota.id);
  else if (rota.tipo === "glossario") p.innerHTML = htmlGlossario();
  else p.innerHTML = htmlInicio(rota.categoria);
  document.body.dataset.rota = rota.tipo;
  colocarBusca();
  if (rota.tipo === "tema") {
    const t = porId(rota.id);
    realcarTermos(p, rota.id);
    ativarMapas(p);
    prepararRepassar(p);
    ligarSumario(p);
    registrarRecente(rota.id);
    document.title = `${t.titulo} · ${NOME}`;
  } else if (rota.tipo === "trilha") document.title = `${trilhaPorId(rota.id).nome} · ${NOME}`;
  else if (rota.tipo === "glossario") document.title = `Glossário · ${NOME}`;
  else document.title = rota.categoria ? `${categoriaPorId(rota.categoria).nome} · ${NOME}` : NOME;
  if (rota.desconhecido && rota.desconhecido !== ultimoDesconhecido && (estado.carregou.temas || !estado.api)) {
    ultimoDesconhecido = rota.desconhecido;
    mostrarAviso("Esse endereço não existe (ou não está disponível). Abrimos o início.");
  }
  ed.aoNavegar(p);
  if (rota.tipo === "glossario" && rota.termo) {
    const alvo = document.getElementById("termo-" + rota.termo);
    if (alvo) { alvo.classList.add("alvo"); alvo.scrollIntoView({ block: "center" }); return; }
  }
  if (rota.tipo === "tema" && rota.bloco) { irParaSecao(rota.bloco, focar); return; }
  if (focar) { window.scrollTo({ top: 0 }); p.focus({ preventScroll: true }); }
  else window.scrollTo({ top: posicao });
}
window.addEventListener("hashchange", () => navegar(true));
/* Re-desenho por mudança de dados (sem perder a posição); adiado enquanto alguém digita num campo da página */
let redesenhoPendente = 0;
function redesenhar() {
  estado.geracao++;
  cancelAnimationFrame(redesenhoPendente);
  redesenhoPendente = requestAnimationFrame(() => {
    if (document.querySelector("#pagina [data-renomeando]")) { setTimeout(redesenhar, 400); return; }
    const foco = seletorDoFoco();
    navegar(false);
    if (foco) { const el = document.querySelector(foco); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
  });
}
/* O re-desenho troca o HTML da página: o foco do teclado volta para o elemento equivalente */
function seletorDoFoco() {
  const el = document.activeElement;
  if (!el || !el.closest("#pagina") || el.id === "pagina") return "";
  const esc = (v) => CSS.escape(v);
  const box = el.closest(".ed-controles");
  if (box) return `.ed-controles[data-ed-tipo="${esc(box.dataset.edTipo)}"][data-ed-id="${esc(box.dataset.edId)}"] ${el.matches("[data-ed-arrastar]") ? "[data-ed-arrastar]" : el.dataset.edAcao ? `[data-ed-acao="${esc(el.dataset.edAcao)}"]` : "[data-ed-menu]"}`;
  if (el.id) return "#" + esc(el.id);
  if (el.dataset.modulo) return `[data-modulo="${esc(el.dataset.modulo)}"]`;
  if (el.dataset.acao) return `#pagina [data-acao="${esc(el.dataset.acao)}"]`;
  if (el.dataset.edNovo) return `[data-ed-novo="${esc(el.dataset.edNovo)}"][data-ed-pai="${esc(el.dataset.edPai)}"]`;
  if (el.matches("a[href]")) return `#pagina a[href="${esc(el.getAttribute("href"))}"]`;
  return "";
}

/* ------------------------------------------------------------
 *  Comportamentos da página
 * ------------------------------------------------------------ */
function irParaSecao(bloco, focar) {
  const sec = document.getElementById("sec-" + bloco);
  if (!sec) { if (focar) window.scrollTo({ top: 0 }); return; }
  sec.querySelectorAll("details").forEach((d) => { d.open = true; });
  /* Busca por código (ex.: 400204): a linha da tabela que tem o termo ganha destaque */
  const termo = normalizar(estado.ultimaBusca).trim();
  if (termo) {
    const linha = [...sec.querySelectorAll("tbody tr")].find((tr) => normalizar(tr.textContent).includes(termo));
    if (linha) { linha.classList.add("linha-encontrada"); linha.scrollIntoView({ block: "center" }); linha.setAttribute("tabindex", "-1"); linha.focus({ preventScroll: true }); return; }
  }
  sec.scrollIntoView({ block: "start" });
  if (focar) { sec.setAttribute("tabindex", "-1"); sec.focus({ preventScroll: true }); }
}
function prepararRepassar(raiz) {
  const restritos = $$('.md-selo[data-selo="nao-repassar"], .md-selo[data-selo="interno"]', raiz);
  const b = $(".btn-repassar", raiz);
  if (!b || !restritos.length) return;
  b.hidden = false;
  const artigo = $("#artigo", raiz);
  const ligado = artigo.classList.contains("so-repassar");
  b.setAttribute("aria-pressed", String(ligado));
  const aviso = $(".aviso-repassar", raiz);
  aviso.hidden = !ligado;
  aviso.textContent = ligado ? `${restritos.length} trecho${restritos.length === 1 ? "" : "s"} “Não repassar” ou “Uso interno” escondido${restritos.length === 1 ? "" : "s"}.` : "";
}
function ligarSumario(raiz) {
  const links = $$(".sumario [data-ir-secao]", raiz);
  if (!links.length || !("IntersectionObserver" in window)) return;
  const obs = new IntersectionObserver((entradas) => {
    entradas.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((l) => l.removeAttribute("aria-current"));
      const ativo = links.find((l) => "sec-" + l.dataset.irSecao === e.target.id);
      if (ativo) ativo.setAttribute("aria-current", "true");
    });
  }, { rootMargin: "-20% 0px -70% 0px" });
  $$(".secao[id]", raiz).forEach((s) => obs.observe(s));
}
function fecharLateral() {
  const l = $("#lateral");
  if (l) l.classList.remove("aberta");
  $$('[data-acao="abrir-lateral"]').forEach((b) => b.setAttribute("aria-expanded", "false"));
}
$("#pagina").addEventListener("click", async (e) => {
  const letra = e.target.closest("[data-letra]");
  if (letra) { e.preventDefault(); const alvo = document.getElementById("letra-" + letra.dataset.letra); if (alvo) alvo.scrollIntoView({ behavior: movimentoReduzido() ? "auto" : "smooth" }); return; }
  const secao = e.target.closest("[data-ir-secao]");
  if (secao) { e.preventDefault(); estado.ultimaBusca = ""; history.replaceState(null, "", secao.getAttribute("href")); irParaSecao(secao.dataset.irSecao, true); return; }
  const mod = e.target.closest("[data-modulo]");
  if (mod) {
    const chave = mod.dataset.modulo, fechados = modulosFechados();
    const abrir = fechados.has(chave);
    if (abrir) fechados.delete(chave); else fechados.add(chave);
    gravarLocal(CHAVE_MODULOS, [...fechados]);
    mod.setAttribute("aria-expanded", String(abrir));
    const corpo = document.getElementById(mod.getAttribute("aria-controls"));
    if (corpo) corpo.hidden = !abrir;
    mod.closest(".modulo").classList.toggle("aberto", abrir);
    return;
  }
  const car = e.target.closest("[data-carrossel]");
  if (car) { const trilho = $("#carrossel"); if (trilho) trilho.scrollBy({ left: Number(car.dataset.carrossel) * trilho.clientWidth * 0.8, behavior: movimentoReduzido() ? "auto" : "smooth" }); return; }
  if (e.target.closest(".lateral a")) fecharLateral();
  const b = e.target.closest("[data-acao], [data-publicar], [data-publicar-novo]");
  if (!b) return;
  if (b.dataset.publicar !== undefined) { publicarConteudoInicial(b); return; }
  if (b.dataset.publicarNovo !== undefined) { publicarAtualizacao(b); return; }
  const acao = b.dataset.acao;
  if (acao === "abrir-lateral") { const l = $("#lateral"); const ab = !l.classList.contains("aberta"); l.classList.toggle("aberta", ab); b.setAttribute("aria-expanded", String(ab)); if (ab) { const a = $("a", l); if (a) a.focus(); } return; }
  if (acao === "recolher") {
    const layout = $(".aula-layout");
    const recolher = !layout.classList.contains("lateral-recolhida");
    layout.classList.toggle("lateral-recolhida", recolher);
    gravarLocal(CHAVE_LATERAL, recolher);
    $$('[data-acao="recolher"]').forEach((x) => x.setAttribute("aria-expanded", String(!recolher)));
    const proximo = $(recolher ? ".btn-mostrar-lateral" : ".btn-recolher");
    if (proximo) proximo.focus({ preventScroll: true });
    return;
  }
  const t = estado.rota && estado.rota.tipo === "tema" ? porId(estado.rota.id) : null;
  if (!t) return;
  if (acao === "repassar") {
    const artigo = $("#artigo");
    const ligar = !artigo.classList.contains("so-repassar");
    artigo.classList.toggle("so-repassar", ligar);
    gravarLocal(CHAVE_REPASSAR, ligar);
    prepararRepassar($("#pagina"));
    mostrarAviso(ligar ? "Mostrando só o que pode ser repassado ao cliente." : "Mostrando tudo, inclusive o que não pode ser repassado.");
  }
  if (acao === "aprendido") {
    const set = aprendidos();
    if (set.has(t.id)) set.delete(t.id); else set.add(t.id);
    gravarLocal(CHAVE_APRENDIDOS, [...set]);
    const p = progresso(t.trilha);
    mostrarAviso(set.has(t.id) ? `Marcada como aprendida. ${p.n} de ${p.total} nesta trilha.` : "Desmarcada.");
    navegar(false);
    const botao = $('[data-acao="aprendido"]');
    if (botao) botao.focus();
  }
  if (acao === "imprimir") { $$("details").forEach((d) => { d.open = true; }); window.print(); }
  if (acao === "sugerir") abrirSugestao({ titulo: `Sugestão para Aprendizagem: ${t.titulo}`.slice(0, 120), contexto: `Aula: ${t.titulo} (aprender.html#${t.id})`, dica: "O que ficou confuso, faltou ou está desatualizado?" });
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#lateral.aberta")) { fecharLateral(); const b = $('[data-acao="abrir-lateral"]'); if (b) b.focus(); } });
const movimentoReduzido = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Mapas mentais do site: a imagem vira o próprio SVG para os ramos serem links (#aula).
   Só arquivos desta pasta; o SVG perde scripts, eventos on* e links que não sejam #id. */
const MAPAS_INTERATIVOS = /^fotos\/aprender\/certificado\/mapa-mental(-resumo)?\.svg$/;
function ativarMapas(raiz) {
  $$("img.md-img-externa", raiz).forEach(async (img) => {
    const src = img.getAttribute("src") || "";
    if (!MAPAS_INTERATIVOS.test(src)) return;
    try {
      const r = await fetch(src);
      if (!r.ok) return;
      const doc = new DOMParser().parseFromString(await r.text(), "image/svg+xml");
      const raizSvg = doc.documentElement;
      if (raizSvg.nodeName !== "svg" || doc.querySelector("parsererror")) return;
      raizSvg.querySelectorAll("script, foreignObject, iframe, image, use").forEach((el) => el.remove());
      raizSvg.querySelectorAll("*").forEach((el) => [...el.attributes].forEach((a) => { if (/^on/i.test(a.name) || a.name === "id") el.removeAttribute(a.name); }));
      raizSvg.querySelectorAll("a").forEach((a) => {
        const destino = a.getAttribute("href") || "";
        if (!/^#[a-z0-9-]{1,60}$/.test(destino) || !visivel(porId(destino.slice(1)))) { a.replaceWith(...a.childNodes); return; }
        a.removeAttribute("xlink:href");
        a.setAttribute("aria-label", porId(destino.slice(1)).titulo);
      });
      raizSvg.removeAttribute("aria-labelledby");
      raizSvg.removeAttribute("width");
      raizSvg.removeAttribute("height");
      raizSvg.setAttribute("role", "group");
      raizSvg.setAttribute("aria-label", `${img.alt} (clique em um ramo para abrir a aula)`);
      raizSvg.setAttribute("class", "md-img-externa mapa-interativo");
      if (img.isConnected) img.replaceWith(document.importNode(raizSvg, true));
    } catch (err) { console.warn("Mapa mental sem interação:", err); }
  });
}

/* Termos do glossário no texto: sublinhado pontilhado + definição ao passar o mouse */
function realcarTermos(raiz, temaAtual) {
  const itens = [];
  const proprias = estado.glossario.filter((g) => g.tema === temaAtual).map((g) => normalizar(g.termo.replace(/\s*\([^)]*\)\s*$/, "")));
  estado.glossario.forEach((g) => {
    if (g.tema === temaAtual) return;
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(g.termo);
    const formas = m ? [m[1], m[2]] : [g.termo];
    formas.forEach((f) => { if (f.trim().length >= 2) itens.push({ forma: f.trim(), g, exata: f.trim().length <= 3 }); });
  });
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /* Termo curto que faz parte de um termo maior presente na aula (ex.: "Token" com "access token") fica sem realce: o sentido é o do termo maior */
  const textoAula = normalizar(raiz.textContent);
  const formas = itens.map((i) => normalizar(i.forma));
  for (let k = itens.length - 1; k >= 0; k--) {
    const f = formas[k];
    const dentro = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(f)}([^\\p{L}\\p{N}]|$)`, "u");
    if (formas.some((f2) => f2.length > f.length && dentro.test(f2) && textoAula.includes(f2))) itens.splice(k, 1);
  }
  if (!itens.length) return;
  itens.sort((a, b) => b.forma.length - a.forma.length);
  const usados = new Set();
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${itens.map((i) => esc(i.forma)).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  $$(".secao .md", raiz).forEach((bloco) => {
    const andar = document.createTreeWalker(bloco, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest("a, code, pre, h1, h2, h3, h4, summary, .callout-titulo, .selo-etiqueta, .termo, figure") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const nos = [];
    while (andar.nextNode()) nos.push(andar.currentNode);
    nos.forEach((no) => {
      const texto = no.nodeValue;
      re.lastIndex = 0;
      let m, ultimo = 0, frag = null;
      while ((m = re.exec(texto))) {
        const item = itens.find((i) => (i.exata ? i.forma === m[1] : normalizar(i.forma) === normalizar(m[1])));
        if (!item || usados.has(item.g.termo)) continue;
        const adiante = normalizar(texto.slice(m.index, m.index + 60));
        if (proprias.some((p) => p.length > m[1].length && adiante.startsWith(p))) continue;
        usados.add(item.g.termo);
        frag = frag || document.createDocumentFragment();
        frag.appendChild(document.createTextNode(texto.slice(ultimo, m.index)));
        const a = document.createElement("a");
        a.className = "termo";
        a.href = "#glossario/" + slug(item.g.termo, 60);
        a.dataset.def = item.g.definicao;
        a.setAttribute("aria-label", `${m[1]}: ${item.g.definicao}`);
        a.textContent = m[1];
        frag.appendChild(a);
        ultimo = m.index + m[1].length;
      }
      if (frag) { frag.appendChild(document.createTextNode(texto.slice(ultimo))); no.parentNode.replaceChild(frag, no); }
    });
  });
}

/* ------------------------------------------------------------
 *  Busca (Ctrl+K ou /): aulas, termos do glossário e linhas de tabela (códigos de erro), sem acentos
 * ------------------------------------------------------------ */
const busca = $("#busca"), resultados = $("#resultados"), barraBusca = $("#barra-busca");
let selecionado = -1, indice = null, indiceGeracao = -1;
/* A barra de busca fica no hero do início e no topo das outras páginas */
function colocarBusca() {
  const lugar = $("#lugar-busca");
  barraBusca.classList.toggle("no-hero", !!lugar);
  if (lugar) lugar.appendChild(barraBusca);
  else $("#topo-busca").appendChild(barraBusca);
}
function devolverBusca() { if (barraBusca.parentElement && barraBusca.parentElement.id === "lugar-busca") $("#topo-busca").appendChild(barraBusca); }
function montarIndice() {
  if (indice && indiceGeracao === estado.geracao) return indice;
  indice = estado.temas.filter((t) => visivel(t) && trilhaPorId(t.trilha)).map((t) => {
    const blocos = blocosDe(t);
    const linhas = [];
    blocos.forEach((b) => String(b.markdown).split("\n").forEach((l) => {
      const s = l.trim();
      if (!/^\|.*\|$/.test(s) || /^\|\s*:?-{2,}/.test(s)) return;
      const celulas = s.slice(1, -1).split("|").map((c) => c.replace(/[`*]/g, "").trim());
      linhas.push({ bloco: b.id, celulas, n: normalizar(celulas.join(" ")) });
    }));
    return { t, titulo: normalizar(t.titulo), chaves: normalizar(t.palavrasChave.join(" ")), resumo: normalizar(t.resumo), corpo: normalizar(blocos.map((b) => b.titulo + " " + b.markdown).join(" ")), linhas, blocos };
  });
  indiceGeracao = estado.geracao;
  return indice;
}
function buscar(termo) {
  const q = normalizar(termo).trim();
  if (q.length < 2) return [];
  const partes = q.split(/\s+/);
  const aulas = [], tabelas = [], termos = [];
  montarIndice().forEach((x) => {
    let pontos = 0;
    for (const p of partes) {
      const pp = (x.titulo.includes(p) ? 10 : 0) + (x.chaves.includes(p) ? 6 : 0) + (x.resumo.includes(p) ? 3 : 0) + (x.corpo.includes(p) ? 1 : 0);
      if (!pp) { pontos = 0; break; }
      pontos += pp;
    }
    const tr = trilhaPorId(x.t.trilha);
    if (pontos) {
      /* Primeiro bloco onde o termo aparece: o resultado abre direto nele */
      const b = x.blocos.find((k) => partes.every((p) => normalizar(k.titulo + " " + k.markdown).includes(p)));
      aulas.push({ pontos, href: `#${x.t.id}${b && !x.titulo.includes(q) ? "/" + b.id : ""}`, titulo: x.t.titulo, sub: tr ? tr.nome : "" });
    }
    x.linhas.forEach((l) => {
      if (!partes.every((p) => l.n.includes(p))) return;
      const exata = l.celulas.some((c) => normalizar(c) === q);
      tabelas.push({ pontos: exata ? 20 : 2, href: `#${x.t.id}/${l.bloco}`, titulo: l.celulas.filter(Boolean).slice(0, 3).join(" · "), sub: `Tabela em ${x.t.titulo}`, codigo: /\d{3}/.test(q) || exata });
    });
  });
  estado.glossario.forEach((g) => {
    const n = normalizar(g.termo + " " + g.definicao);
    if (partes.every((p) => n.includes(p))) termos.push({ pontos: normalizar(g.termo).includes(q) ? 5 : 1, href: "#glossario/" + slug(g.termo, 60), titulo: g.termo, sub: g.definicao });
  });
  const ord = (l) => l.sort((a, b) => b.pontos - a.pontos);
  const grupos = [];
  const tab = ord(tabelas).slice(0, 5);
  const temCodigo = tab.some((x) => x.codigo);
  if (temCodigo && tab.length) grupos.push({ nome: "Códigos de erro e tabelas", itens: tab });
  if (aulas.length) grupos.push({ nome: "Aulas", itens: ord(aulas).slice(0, 8) });
  if (termos.length) grupos.push({ nome: "Glossário", itens: ord(termos).slice(0, 5) });
  if (!temCodigo && tab.length) grupos.push({ nome: "Em tabelas", itens: tab });
  return grupos;
}
function mostrarResultados() {
  const grupos = buscar(busca.value);
  const itens = grupos.flatMap((g) => g.itens);
  selecionado = itens.length ? 0 : -1;
  resultados.hidden = !busca.value.trim();
  busca.setAttribute("aria-expanded", String(!resultados.hidden));
  let i = 0;
  resultados.innerHTML = itens.length ? grupos.map((g) => `<p class="resultados-grupo" role="presentation">${escapar(g.nome)}</p>${g.itens.map((r) => {
    const n = i++;
    return `<a class="resultado" role="option" id="res-${n}" href="${escapar(r.href)}" aria-selected="${n === 0}"><strong>${escapar(r.titulo)}</strong><span>${escapar(r.sub.slice(0, 120))}</span></a>`;
  }).join("")}`).join("")
    : `<p class="apoio" style="padding:10px">Nada encontrado para “${escapar(busca.value)}”.</p>`;
  if (itens.length) busca.setAttribute("aria-activedescendant", "res-0"); else busca.removeAttribute("aria-activedescendant");
}
busca.addEventListener("input", mostrarResultados);
busca.addEventListener("keydown", (e) => {
  const itens = $$(".resultado", resultados);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!itens.length) return;
    selecionado = (selecionado + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens.forEach((x, i) => x.setAttribute("aria-selected", String(i === selecionado)));
    busca.setAttribute("aria-activedescendant", "res-" + selecionado);
    itens[selecionado].scrollIntoView({ block: "nearest" });
  }
  if (e.key === "Enter" && itens[selecionado]) { e.preventDefault(); abrirResultado(itens[selecionado].getAttribute("href")); }
  if (e.key === "Escape") fecharBusca();
});
resultados.addEventListener("click", (e) => { const r = e.target.closest(".resultado"); if (r) { e.preventDefault(); abrirResultado(r.getAttribute("href")); } });
function abrirResultado(href) {
  estado.ultimaBusca = busca.value;
  fecharBusca();
  if (location.hash === href) navegar(true); else location.hash = href;
}
function fecharBusca() { resultados.hidden = true; busca.setAttribute("aria-expanded", "false"); busca.removeAttribute("aria-activedescendant"); busca.value = ""; busca.blur(); }
document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#barra-busca")) { resultados.hidden = true; busca.setAttribute("aria-expanded", "false"); } });
document.addEventListener("keydown", (e) => {
  const digitando = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
  if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !digitando)) {
    if (document.querySelector("dialog[open]")) return;
    e.preventDefault();
    busca.focus();
    busca.select();
  }
});

/* ------------------------------------------------------------
 *  Publicação (conteúdo inicial e atualização para CONTEUDO_VERSAO)
 * ------------------------------------------------------------ */
function htmlFaixaPublicar() {
  if (!ehAdmin() || !estado.api || !estado.carregou.temas || !estado.carregou.trilhas) return "";
  if (!estado.publicado) {
    return `<div class="faixa-publicar">${svg("i-info")}<span>O conteúdo desta página ainda é o embutido no site. Publique para poder editar pelo navegador.</span>
      <button type="button" class="btn btn-mini" data-publicar>${svg("i-upload")}Publicar conteúdo inicial</button></div>`;
  }
  if ((estado.versaoPublicada || 1) >= CONTEUDO_VERSAO) return "";
  return `<div class="faixa-publicar"><div style="flex:1 1 320px">${svg("i-info")} <strong>Há conteúdo novo na Aprendizagem.</strong>
      <details style="margin-top:6px"><summary>O que vai mudar</summary><ul style="margin:6px 0 0;padding-left:18px">${NOVIDADES_CONTEUDO.map((n) => `<li>${escapar(n)}</li>`).join("")}</ul></details></div>
    <button type="button" class="btn btn-mini" data-publicar-novo>${svg("i-upload")}Publicar agora</button></div>`;
}
const assinatura = () => ({ atualizadoEm: "__AGORA__", atualizadoPor: sessao.email || "" });
/* Documento da aula para o Firestore: "oculto" é sempre o efetivo (a regra e a consulta dos visitantes usam este campo) */
function dadosTema(t, { semAssinatura = false } = {}) {
  const { id, atualizadoEm, atualizadoPor, ...resto } = t;
  return { ...resto, paiId: t.paiId || null, oculto: ocultoEfetivo(t), ...(semAssinatura ? {} : assinatura()) };
}
const dadosTrilha = (t) => ({ ...t });
async function publicarConteudoInicial(botao) {
  if (!ehAdmin() || !estado.api) return;
  botao.disabled = true;
  try {
    const trilhas = TRILHAS_PADRAO.map(normalizarTrilha).filter(Boolean);
    const categorias = CATEGORIAS_PADRAO.map(normalizarCategoria).filter(Boolean);
    estado.trilhas = trilhas;
    estado.categorias = categorias;
    const temas = TEMAS_PADRAO.map(normalizarTema).filter(Boolean);
    estado.temas = temas;
    await estado.api.lote([
      ...temas.map((t) => ({ op: "set", caminho: `conhecimento/${t.id}`, dados: dadosTema(t) })),
      { op: "set", caminho: "conhecimento-config/categorias", dados: { lista: categorias, ...assinatura() } },
      { op: "set", caminho: "conhecimento-config/trilhas", dados: { lista: trilhas.map(dadosTrilha), versao: CONTEUDO_VERSAO, ...assinatura() } },
      { op: "set", caminho: "conhecimento-config/glossario", dados: { termos: normalizarGlossario(GLOSSARIO_PADRAO), ...assinatura() } }
    ]);
    registrarAuditoria({ acao: "publicar", alvo: "aprendizagem", resumo: `Publicou o conteúdo inicial da ${NOME} (${temas.length} aulas, versão ${CONTEUDO_VERSAO})` });
    mostrarAviso("Conteúdo inicial publicado.");
  } catch (e) {
    console.error(e);
    mostrarAviso("Não foi possível publicar. Confira se você entrou como administradora.");
    botao.disabled = false;
  }
}
/* Atualização: aulas e trilhas novas entram; as publicadas mantêm as edições. Versão 2: TEMAS_SUBSTITUIDOS regravados inteiros.
   TEMAS_COM_TERMOS_NOVOS recebem trilha, módulo e "Termos relacionados" novos só se a versão publicada for menor que a da aula. */
async function publicarAtualizacao(botao) {
  if (!ehAdmin() || !estado.api) return;
  if (!(await confirmar(`Publicar o conteúdo novo agora? ${NOVIDADES_CONTEUDO.length} mudanças (veja “O que vai mudar” na faixa). As edições já feitas nas aulas são mantidas.`, { titulo: "Conteúdo novo da Aprendizagem", botao: "Publicar agora" }))) return;
  botao.disabled = true;
  try {
    const versao = estado.versaoPublicada || 1;
    const embutidos = new Map(TEMAS_PADRAO.map(normalizarTema).filter(Boolean).map((t) => [t.id, t]));
    const trilhasEmb = TRILHAS_PADRAO.map(normalizarTrilha).filter(Boolean);
    /* Trilhas: as publicadas ganham categoria/módulos se ainda não tiverem; as novas entram no fim */
    const trilhasNovas = new Set(trilhasEmb.filter((e) => !estado.trilhas.some((t) => t.id === e.id)).map((e) => e.id));
    const trilhas = estado.trilhas.map((t) => {
      const e = trilhasEmb.find((x) => x.id === t.id);
      return e ? { ...t, categoria: t.categoria || e.categoria, cor: t.cor || e.cor, nivel: t.nivel || e.nivel, modulos: t.modulos.length ? t.modulos : e.modulos, aviso: t.aviso || e.aviso, fontes: t.fontes || e.fontes } : t;
    });
    trilhasEmb.forEach((e) => { if (!trilhas.some((t) => t.id === e.id)) trilhas.push({ ...e, ordem: trilhas.length + 1 }); });
    const categorias = estado.carregou.categoriasPublicadas ? estado.categorias : CATEGORIAS_PADRAO.map(normalizarCategoria).filter(Boolean);
    estado.trilhas = trilhas;
    estado.categorias = categorias;
    const ops = [];
    const gravados = new Set();
    const temas = estado.temas.map((t) => {
      const novo = embutidos.get(t.id);
      if (novo && versao < 2 && TEMAS_SUBSTITUIDOS.includes(t.id)) return novo;
      if (novo && versao < (TEMAS_COM_TERMOS_NOVOS[t.id] || 0)) return { ...t, trilha: novo.trilha, modulo: novo.modulo, ordem: novo.ordem, secoes: { ...t.secoes, termos: novo.secoes.termos } };
      return t;
    });
    /* Só entram aulas embutidas das trilhas novas (e, vindo da versão 1, as de Certificação digital): uma aula que a administradora removeu não volta */
    embutidos.forEach((t, id) => { if (!temas.some((x) => x.id === id) && (trilhasNovas.has(t.trilha) || (versao < 2 && t.trilha === "certificacao"))) temas.push(t); });
    estado.temas = temas;
    temas.forEach((t) => { ops.push({ op: "set", caminho: `conhecimento/${t.id}`, dados: dadosTema(t) }); gravados.add(t.id); });
    const termos = [...estado.glossario];
    /* Termos já publicados mantêm a definição; os que estão sem aula ligada recebem a do embutido */
    normalizarGlossario(GLOSSARIO_PADRAO).forEach((g) => {
      const i = termos.findIndex((x) => normalizar(x.termo) === normalizar(g.termo));
      if (i < 0) termos.push(g); else if (versao < 2) termos[i] = g; else if (!termos[i].tema && g.tema) termos[i] = { ...termos[i], tema: g.tema };
    });
    ops.push({ op: "set", caminho: "conhecimento-config/categorias", dados: { lista: categorias, ...assinatura() } });
    ops.push({ op: "set", caminho: "conhecimento-config/trilhas", dados: { lista: trilhas.map(dadosTrilha), versao: CONTEUDO_VERSAO, ...assinatura() } });
    ops.push({ op: "set", caminho: "conhecimento-config/glossario", dados: { termos: termos.slice(0, 400), ...assinatura() } });
    await estado.api.lote(ops);
    registrarAuditoria({ acao: "publicar", alvo: "aprendizagem", resumo: `Publicou o conteúdo novo da Aprendizagem (versão ${CONTEUDO_VERSAO}, ${gravados.size} aulas)` });
    mostrarAviso("Conteúdo novo publicado.");
  } catch (e) {
    console.error(e);
    mostrarAviso("Não foi possível publicar. Confira se você entrou como administradora.");
    botao.disabled = false;
  }
}

/* ------------------------------------------------------------
 *  Modo edição (só administradoras) e carregamento
 * ------------------------------------------------------------ */
const app = {
  estado, NOME, NIVEIS, SECOES, ICONES, CORES, CONTEUDO_VERSAO,
  normalizarTema, normalizarTrilha, normalizarCategoria, normalizarModulo, normalizarBloco, normalizarGlossario,
  porId, trilhaPorId, categoriaPorId, modulosDe, moduloDe, filhos, raizesDoModulo, aulasDaTrilha, trilhasDaCategoria, categoriasOrdenadas, categoriaDaTrilha,
  blocosDe, corpoDoBloco, htmlDuvidas, htmlTermos, md, ocultoEfetivo, trilhaOculta, dadosTema, dadosTrilha, assinatura, podeEditar, porOrdem,
  navegar, redesenhar, registrarAuditoria
};
const ed = iniciarEditor(app);

ligarTema();
navegar(false);
let pararTemas = null;
/* Visitantes só recebem as aulas com oculto == false (a regra do Firestore exige este filtro); administradoras, todas */
function ouvirTemas() {
  if (!estado.api) return;
  if (pararTemas) pararTemas();
  const admin = ehAdmin();
  pararTemas = estado.api.ouvirColecao("conhecimento", (lista) => {
    const temas = lista.map(normalizarTema).filter(Boolean);
    estado.carregou.temas = true;
    if (estado.publicado || temas.length) estado.temas = temas;
    redesenhar();
  }, (e) => { console.warn("conhecimento:", e); estado.carregou.temas = true; redesenhar(); }, admin ? {} : { onde: ["oculto", "==", false] });
}
let adminAnterior = null;
aoMudarSessao(() => {
  if (adminAnterior !== null && adminAnterior !== ehAdmin()) ouvirTemas();
  adminAnterior = ehAdmin();
  ed.aoMudarSessao();
  redesenhar();
});
ligarLogin().then((api) => {
  estado.api = api;
  $("#faixa-offline").hidden = !!api;
  if (!api) return;
  adminAnterior = ehAdmin();
  ouvirTemas();
  api.ouvirDoc("conhecimento-config/trilhas", (d) => {
    const lista = d && Array.isArray(d.lista) ? d.lista.map(normalizarTrilha).filter(Boolean) : [];
    estado.carregou.trilhas = true;
    estado.configTrilhas = d;
    estado.versaoPublicada = d ? Number(d.versao) || 1 : null;
    /* Publicado = a configuração das trilhas existe (as aulas podem estar todas ocultas para visitantes) */
    estado.publicado = !!d;
    if (lista.length) estado.trilhas = lista;
    redesenhar();
  }, () => { estado.carregou.trilhas = true; redesenhar(); });
  api.ouvirDoc("conhecimento-config/categorias", (d) => {
    const lista = d && Array.isArray(d.lista) ? d.lista.map(normalizarCategoria).filter(Boolean) : [];
    estado.carregou.categorias = true;
    estado.carregou.categoriasPublicadas = !!d;
    if (lista.length) estado.categorias = lista;
    redesenhar();
  }, () => { estado.carregou.categorias = true; });
  api.ouvirDoc("conhecimento-config/glossario", (d) => {
    const lista = d ? normalizarGlossario(d.termos) : [];
    if (lista.length) { estado.glossario = lista; redesenhar(); }
  }, () => {});
  api.ouvirColecao("conhecimento-capas", (lista) => {
    estado.capas = new Map(lista.filter((c) => typeof c.src === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(c.src)).map((c) => [c.id, c.src]));
    redesenhar();
  }, () => {});
});
window.__aprender = { estado, app };
