/*
 * ============================================================
 *  MAPAS DE AJUDA: modelo de dados, árvore, modelos e textos
 *  (sem DOM; usado por mapas.js e mapas-canvas.js)
 *
 *  Firestore:
 *    mapas/{mapaId}                     metadados do mapa
 *    mapas/{mapaId}/nos/{noId}          um documento por nó (evita o limite de 1 MB e
 *                                       permite duas pessoas editando nós diferentes)
 *    mapas/{mapaId}/usos/{usoId}        "usei este roteiro": histórico de atendimentos
 *    mapas-lixeira/{id}                 mapas e ramos removidos (Restaurar / Excluir de vez)
 *  Ligações extras ficam no próprio nó de origem (campo "ligacoes": [{ para, rotulo }]):
 *  são poucas por nó, vão e voltam junto com ele (lixeira, duplicar, exportar) e não
 *  precisam de outra coleção nem de outro ouvinte em tempo real.
 * ============================================================
 */
import { normalizar, formatarData } from "./base.js";

export const ID_VALIDO = /^[a-z0-9-]{1,60}$/;
export const LIMITES = { titulo: 120, descricao: 20000, campo: 2000, passo: 500, passos: 30, tags: 20, tag: 40, ligacoes: 20, rotulo: 80, nomeMapa: 80, descricaoMapa: 500 };
export const NOVENTA_DIAS = 90 * 24 * 60 * 60 * 1000;

/* Cores (as do tema: --c-<cor> e --f-<cor>) */
export const CORES = { roxo: "Lilás", azul: "Azul", verde: "Verde", laranja: "Laranja", amarelo: "Amarelo", vermelho: "Vermelho", cinza: "Cinza" };
/* Ícones que o mapa (sistema) pode usar: mesma ideia da lista ICONES da Aprendizagem */
export const ICONES = ["i-servidor", "i-mapa", "i-grade", "i-globo", "i-plug", "i-cadeado", "i-escudo", "i-certificado", "i-cartao", "i-telefone", "i-email",
  "i-conversa", "i-pessoas", "i-documento", "i-tabela", "i-lista", "i-engrenagem", "i-ferramenta", "i-lampada", "i-alerta", "i-info", "i-livro", "i-aprender",
  "i-calendario", "i-relogio", "i-estrela", "i-tag", "i-link", "i-imagem", "i-megafone"];

/* ============================================================
 *  ESTRUTURA (tipos, campos, listas de opções, modelos)
 *  Os PADRÕES ficam aqui no código (fallback: offline, documento inexistente ou campo faltando).
 *  O Painel de edição grava mapas-config/estrutura e mapas-config/modelos; aplicarEstrutura()
 *  e aplicarModelos() MESCLAM essa configuração com os padrões.
 *  TIPOS, CAMPOS, ORDEM_TIPOS, FILHO_PADRAO e MODELOS são a ESTRUTURA ATIVA: objetos "vivos",
 *  atualizados no lugar a cada mudança (quem importou vê os valores novos). obterEstrutura()
 *  devolve a mesma estrutura ativa.
 *  Os IDs dos 7 tipos e dos campos nativos nunca mudam (dados e regras continuam válidos);
 *  só muda o que aparece na tela. Campos personalizados ficam em no.extras.
 * ============================================================ */
export const IDS_TIPOS = ["sistema", "sintoma", "teste", "contato", "solucao", "link", "nota"];
export const TIPOS_CAMPO = { texto: "Texto curto", area: "Texto longo", url: "Endereço (URL)", lista: "Lista (um por linha)", escolha: "Escolha (lista de opções)" };
export const LIMITE_EXTRAS = 20;
/* Ícones disponíveis para os tipos de nó (inclui os ícones padrão dos tipos) */
export const ICONES_TIPOS = [...new Set(["i-servidor", "i-alerta", "i-busca", "i-telefone", "i-sucesso", "i-link", "i-anotacao", ...ICONES, "i-check", "i-erro", "i-ajuda", "i-roteiro", "i-usuario", "i-olho", "i-filtro", "i-trofeu"])];

const TIPOS_PADRAO = {
  sistema: { nome: "Sistema", icone: "i-servidor", cor: "roxo", ajuda: "Raiz do mapa: o sistema.", filhoPadrao: "sintoma" },
  sintoma: { nome: "Sintoma", icone: "i-alerta", cor: "vermelho", ajuda: "O problema que o analista observa.", filhoPadrao: "teste" },
  teste: { nome: "Teste", icone: "i-busca", cor: "azul", ajuda: "Verificação a fazer e o que cada resultado significa.", filhoPadrao: "teste" },
  contato: { nome: "Quem resolve", icone: "i-telefone", cor: "laranja", ajuda: "Com quem falar, por qual canal, horário e prazo.", filhoPadrao: "nota" },
  solucao: { nome: "Solução", icone: "i-sucesso", cor: "verde", ajuda: "Correção conhecida (paliativa ou definitiva).", filhoPadrao: "nota" },
  link: { nome: "Link", icone: "i-link", cor: "cinza", ajuda: "Manual, status do serviço, caderno ou aula.", filhoPadrao: "link" },
  nota: { nome: "Nota", icone: "i-anotacao", cor: "amarelo", ajuda: "Informação livre.", filhoPadrao: "nota" }
};
/* Opções: id estável + rótulo. Migração: o texto antigo gravado nos nós vira o id (e o rótulo inicial). */
const op = (...rotulos) => rotulos.map((r) => (typeof r === "string" ? { id: r, rotulo: r } : r));
const escolha = (id, rotulo, opcoes) => ({ id, rotulo, tipo: "escolha", opcoes });
const texto = (id, rotulo, dica = "") => ({ id, rotulo, tipo: "texto", dica });
const area = (id, rotulo, dica = "") => ({ id, rotulo, tipo: "area", dica });
const CAMPOS_PADRAO = {
  sistema: [{ id: "url", rotulo: "Endereço do sistema", tipo: "url", dica: "https://…" }, texto("dono", "Responsável / dono"),
    escolha("criticidade", "Criticidade", op("Baixa", "Média", "Alta", { id: "Crítica", rotulo: "Crítica", cor: "vermelho" }))],
  sintoma: [area("palavrasChave", "Palavras-chave / mensagens de erro", "Uma por linha (ajuda a busca)"),
    escolha("frequencia", "Frequência", op("Raro", "Às vezes", "Frequente", "Constante")),
    escolha("impacto", "Impacto", op("Baixo", "Médio", "Alto", { id: "Parada total", rotulo: "Parada total", cor: "vermelho" }))],
  teste: [{ id: "passos", rotulo: "Passos", tipo: "lista", dica: "Um passo por linha" }, area("esperado", "Resultado esperado / o que significa"),
    texto("tempo", "Tempo estimado", "ex.: 5 min")],
  contato: [texto("nome", "Nome"), texto("area", "Área / equipe"), escolha("canal", "Canal", op("Teams", "E-mail", "Telefone", "Chamado", "Outro")),
    texto("email", "E-mail"), texto("telefone", "Telefone / ramal"), texto("horario", "Horário de atendimento", "ex.: seg a sex, 8h às 18h"),
    texto("sla", "SLA / prazo", "ex.: 4 h úteis"), escolha("nivel", "Nível", op("N1", "N2", "N3", "Fornecedor")), area("observacoes", "Observações")],
  solucao: [{ id: "passos", rotulo: "Passos", tipo: "lista", dica: "Um passo por linha" }, escolha("natureza", "Natureza", op("Paliativa", { id: "Definitiva", rotulo: "Definitiva", cor: "verde" })),
    area("observacoes", "Observações")],
  link: [{ id: "url", rotulo: "Endereço", tipo: "url", dica: "https://…, caderno.html?c=slug ou aprender.html#aula" }],
  nota: []
};
/* Chaves aceitas em no.campos (fixas; iguais às de noMapaValido() no firestore.rules) */
export const CAMPOS_PERMITIDOS = [...new Set(Object.values(CAMPOS_PADRAO).flat().map((c) => c.id))];

/* Estrutura ativa (objetos vivos) */
export const TIPOS = {};
export const CAMPOS = {};
export const ORDEM_TIPOS = [];
export const FILHO_PADRAO = {};
const clonar = (v) => JSON.parse(JSON.stringify(v));
const substituir = (alvo, novo) => { Object.keys(alvo).forEach((k) => delete alvo[k]); Object.assign(alvo, novo); };
export const estruturaPadrao = () => ({ tipos: clonar(TIPOS_PADRAO), ordemTipos: [...IDS_TIPOS], campos: clonar(CAMPOS_PADRAO) });
export const obterEstrutura = () => ({ TIPOS, CAMPOS, ORDEM_TIPOS, FILHO_PADRAO, MODELOS });

const txtE = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const ID_OPCAO = /^[^\n]{1,60}$/;
export const ID_CAMPO_EXTRA = /^[a-z][a-z0-9-]{0,39}$/;
function mesclarOpcoes(padrao, gravadas) {
  if (!Array.isArray(gravadas)) return clonar(padrao || []);
  const vistas = new Set();
  return gravadas.filter((o) => o && ID_OPCAO.test(String(o.id || "")) && !vistas.has(o.id) && vistas.add(o.id)).slice(0, 60).map((o) => ({
    id: String(o.id).slice(0, 60), rotulo: txtE(o.rotulo, 60) || String(o.id).slice(0, 60),
    ...(CORES[o.cor] ? { cor: o.cor } : {}), ...(o.arquivada ? { arquivada: true } : {})
  }));
}
function mesclarCampo(padrao, gravado) {
  const g = gravado || {};
  const tipo = padrao ? padrao.tipo : (TIPOS_CAMPO[g.tipo] ? g.tipo : "texto");
  const c = {
    id: padrao ? padrao.id : g.id, tipo,
    rotulo: txtE(g.rotulo, 60) || (padrao ? padrao.rotulo : g.id),
    dica: g.dica != null ? txtE(g.dica, 120) : (padrao ? padrao.dica || "" : ""),
    obrigatorio: !!g.obrigatorio, oculto: !!g.oculto, personalizado: !padrao
  };
  if (tipo === "escolha") c.opcoes = mesclarOpcoes(padrao && padrao.opcoes, g.opcoes);
  return c;
}
/* Configuração gravada (pode ser parcial ou antiga) + padrões = estrutura completa e válida */
export function mesclarEstrutura(config) {
  const cfg = config && typeof config === "object" ? config : {};
  const p = estruturaPadrao();
  const tipos = {};
  IDS_TIPOS.forEach((id) => {
    const g = (cfg.tipos && cfg.tipos[id]) || {};
    const d = p.tipos[id];
    tipos[id] = {
      nome: txtE(g.nome, 40) || d.nome,
      icone: /^i-[a-z-]{1,36}$/.test(g.icone || "") ? g.icone : d.icone,
      cor: CORES[g.cor] ? g.cor : d.cor,
      ajuda: g.ajuda != null ? txtE(g.ajuda, 200) : d.ajuda,
      filhoPadrao: IDS_TIPOS.includes(g.filhoPadrao) && g.filhoPadrao !== "sistema" ? g.filhoPadrao : d.filhoPadrao
    };
  });
  const ordem = Array.isArray(cfg.ordemTipos) ? cfg.ordemTipos.filter((t, i, a) => IDS_TIPOS.includes(t) && a.indexOf(t) === i) : [];
  IDS_TIPOS.forEach((t) => { if (!ordem.includes(t)) ordem.push(t); });
  const campos = {};
  IDS_TIPOS.forEach((t) => {
    const padroes = p.campos[t];
    const gravados = cfg.campos && Array.isArray(cfg.campos[t]) ? cfg.campos[t] : null;
    if (!gravados) { campos[t] = padroes.map((d) => mesclarCampo(d, null)); return; }
    const lista = [];
    const usados = new Set();
    gravados.forEach((g) => {
      if (!g || typeof g.id !== "string" || usados.has(g.id)) return;
      const d = padroes.find((x) => x.id === g.id);
      if (!d && (!ID_CAMPO_EXTRA.test(g.id) || CAMPOS_PERMITIDOS.includes(g.id))) return;
      if (!d && lista.filter((x) => x.personalizado).length >= LIMITE_EXTRAS) return;
      usados.add(g.id);
      lista.push(mesclarCampo(d || null, g));
    });
    /* Campo nativo que a configuração não conhece (ex.: criado depois): entra no fim */
    padroes.forEach((d) => { if (!usados.has(d.id)) lista.push(mesclarCampo(d, null)); });
    campos[t] = lista;
  });
  return { tipos, ordemTipos: ordem, campos };
}
export function aplicarEstrutura(config) {
  const e = mesclarEstrutura(config);
  substituir(TIPOS, e.tipos);
  substituir(CAMPOS, e.campos);
  ORDEM_TIPOS.length = 0; ORDEM_TIPOS.push(...e.ordemTipos);
  substituir(FILHO_PADRAO, Object.fromEntries(IDS_TIPOS.map((t) => [t, e.tipos[t].filhoPadrao])));
  return e;
}
/* Rótulo e cor de uma opção (aceita o id ou um rótulo antigo); valor fora da lista aparece como está */
export function acharOpcao(def, valor) {
  if (!def || !def.opcoes || valor == null || valor === "") return null;
  return def.opcoes.find((o) => o.id === valor) || def.opcoes.find((o) => o.rotulo === valor) || null;
}
export const rotuloOpcao = (def, valor) => { const o = acharOpcao(def, valor); return o ? o.rotulo : String(valor == null ? "" : valor); };
export const campoDoTipo = (tipo, id) => (CAMPOS[tipo] || []).find((c) => c.id === id) || null;
export const valorDoCampo = (no, def) => (def.personalizado ? (no.extras || {})[def.id] : (no.campos || {})[def.id]);

/* ------------------------------------------------------------
 *  Normalização (mesmo formato no exemplo embutido, no JSON e no Firestore)
 * ------------------------------------------------------------ */
const txt = (v, max) => String(v == null ? "" : v).slice(0, max);
export function urlSegura(u) {
  const s = String(u || "").trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^(caderno\.html\?c=[a-z0-9-]{1,40}|aprender\.html#[A-Za-z0-9/_-]{1,120}|contatos\.html(#[A-Za-z0-9_-]{0,60})?|index\.html(#[a-z0-9-]{0,60})?)$/.test(s)) return s;
  return "";
}
/* Tipo de valor de cada campo nativo (igual em todos os tipos de nó que o usam) */
const TIPO_NATIVO = Object.fromEntries(Object.values(CAMPOS_PADRAO).flat().map((c) => [c.id, c.tipo]));
function normalizarValor(tipoCampo, v, def) {
  if (tipoCampo === "lista") {
    const lista = (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => txt(x, LIMITES.passo).trim()).filter(Boolean).slice(0, LIMITES.passos);
    return lista.length ? lista : undefined;
  }
  if (tipoCampo === "url") return urlSegura(v) || undefined;
  const s = txt(Array.isArray(v) ? v.join("\n") : v, LIMITES.campo).trim();
  if (!s) return undefined;
  /* Escolha: guarda o id da opção (rótulo antigo vira o id). Valor fora da lista é MANTIDO como está,
     nunca descartado em silêncio (o Painel mostra quantos nós têm valores assim). */
  if (tipoCampo === "escolha") { const o = acharOpcao(def, s); return o ? o.id : s.slice(0, 60); }
  return s;
}
/* Mantém todos os campos nativos conhecidos, mesmo os de outro tipo (trocar o tipo do nó não apaga dados) */
function normalizarCampos(tipo, c) {
  const r = {};
  if (!c || typeof c !== "object") return r;
  CAMPOS_PERMITIDOS.forEach((id) => {
    if (c[id] == null) return;
    const v = normalizarValor(TIPO_NATIVO[id], c[id], campoDoTipo(tipo, id) || Object.values(CAMPOS).flat().find((x) => x.id === id));
    if (v !== undefined) r[id] = v;
  });
  return r;
}
/* Campos personalizados (Painel de edição): no.extras = { idDoCampo: texto | [lista] } */
function normalizarExtras(tipo, e) {
  const r = {};
  if (!e || typeof e !== "object") return r;
  Object.keys(e).filter((k) => ID_CAMPO_EXTRA.test(k)).slice(0, LIMITE_EXTRAS).forEach((k) => {
    const def = campoDoTipo(tipo, k);
    const tipoCampo = def ? def.tipo : (Array.isArray(e[k]) ? "lista" : "area");
    const v = normalizarValor(tipoCampo, e[k], def);
    if (v !== undefined) r[k] = v;
  });
  return r;
}
export function normalizarNo(d) {
  if (!d || !ID_VALIDO.test(d.id || "")) return null;
  const tipo = TIPOS[d.tipo] ? d.tipo : "nota";
  const pos = d.pos && typeof d.pos === "object" && isFinite(d.pos.x) && isFinite(d.pos.y)
    ? { x: Math.round(d.pos.x), y: Math.round(d.pos.y), v: d.pos.v === "grafo" ? "grafo" : "arvore" } : null;
  return {
    id: d.id, tipo,
    titulo: txt(d.titulo, LIMITES.titulo).trim() || TIPOS[tipo].nome,
    descricao: txt(d.descricao, LIMITES.descricao),
    paiId: d.paiId && ID_VALIDO.test(d.paiId) && d.paiId !== d.id ? d.paiId : null,
    ordem: Number.isFinite(Number(d.ordem)) ? Number(d.ordem) : 0,
    tags: (Array.isArray(d.tags) ? d.tags : []).map((t) => txt(t, LIMITES.tag).trim()).filter(Boolean).slice(0, LIMITES.tags),
    recolhido: !!d.recolhido,
    pos,
    campos: normalizarCampos(tipo, d.campos),
    extras: normalizarExtras(tipo, d.extras),
    ligacoes: (Array.isArray(d.ligacoes) ? d.ligacoes : []).filter((l) => l && ID_VALIDO.test(l.para || "") && l.para !== d.id)
      .slice(0, LIMITES.ligacoes).map((l) => ({ para: l.para, rotulo: txt(l.rotulo, LIMITES.rotulo).trim() })),
    revisadoEm: typeof d.revisadoEm === "string" && !isNaN(Date.parse(d.revisadoEm)) ? d.revisadoEm.slice(0, 30) : "",
    atualizadoEm: d.atualizadoEm || "",
    atualizadoPor: txt(d.atualizadoPor, 80)
  };
}
export function normalizarMapa(d) {
  if (!d || !ID_VALIDO.test(d.id || "")) return null;
  return {
    id: d.id,
    nome: txt(d.nome, LIMITES.nomeMapa).trim() || d.id,
    descricao: txt(d.descricao, LIMITES.descricaoMapa),
    icone: ICONES.includes(d.icone) ? d.icone : "i-servidor",
    cor: CORES[d.cor] ? d.cor : "roxo",
    layout: d.layout === "grafo" ? "grafo" : "arvore",
    tags: (Array.isArray(d.tags) ? d.tags : []).map((t) => txt(t, LIMITES.tag).trim()).filter(Boolean).slice(0, LIMITES.tags),
    criadoEm: d.criadoEm || "", criadoPor: txt(d.criadoPor, 80),
    atualizadoEm: d.atualizadoEm || "", atualizadoPor: txt(d.atualizadoPor, 80),
    excluidoEm: d.excluidoEm || null
  };
}
/* Formato gravado no Firestore (sem id; datas viram __AGORA__ em quem grava) */
export function dadosNo(no, por) {
  const d = {
    tipo: no.tipo, titulo: no.titulo, descricao: no.descricao || "", paiId: no.paiId || null, ordem: no.ordem || 0,
    tags: no.tags || [], recolhido: !!no.recolhido, pos: no.pos || null, campos: no.campos || {}, ligacoes: no.ligacoes || [],
    revisadoEm: no.revisadoEm || "", atualizadoEm: "__AGORA__", atualizadoPor: por
  };
  /* "extras" só vai quando existe (nós antigos continuam no formato de antes) */
  if (no.extras && Object.keys(no.extras).length) d.extras = no.extras;
  return d;
}
export function dadosMapa(m, por, novo = false) {
  const d = { nome: m.nome, descricao: m.descricao || "", icone: m.icone, cor: m.cor, layout: m.layout || "arvore", tags: m.tags || [],
    excluidoEm: null, atualizadoEm: "__AGORA__", atualizadoPor: por };
  if (novo) { d.criadoEm = "__AGORA__"; d.criadoPor = por; }
  return d;
}

/* ------------------------------------------------------------
 *  Árvore
 * ------------------------------------------------------------ */
export const porOrdem = (a, b) => (a.ordem - b.ordem) || a.titulo.localeCompare(b.titulo, "pt-BR");
export function indexar(nos) {
  const porId = new Map(nos.map((n) => [n.id, n]));
  let raiz = nos.find((n) => n.tipo === "sistema" && !n.paiId) || nos.find((n) => !n.paiId) || null;
  const filhos = new Map(nos.map((n) => [n.id, []]));
  const paiDe = new Map();
  nos.forEach((n) => {
    if (n === raiz) return;
    let pai = n.paiId && porId.has(n.paiId) ? n.paiId : (raiz ? raiz.id : null);
    /* Ciclo (dado corrompido ou edição simultânea): pendura na raiz */
    let p = pai, passos = 0;
    while (p && passos++ < 500) { if (p === n.id) { pai = raiz ? raiz.id : null; break; } p = porId.get(p) && porId.get(p) !== raiz ? (porId.get(p).paiId || null) : null; }
    if (pai) { filhos.get(pai).push(n); paiDe.set(n.id, pai); }
  });
  filhos.forEach((l) => l.sort(porOrdem));
  return { porId, filhos, paiDe, raiz, total: nos.length };
}
export function caminhoAteRaiz(idx, id) {
  const r = [];
  let atual = id, passos = 0;
  while (atual && passos++ < 500) { r.push(atual); atual = idx.paiDe.get(atual); }
  return r;
}
export function descendentes(idx, id) {
  const r = [];
  const pilha = [...(idx.filhos.get(id) || [])].reverse();
  while (pilha.length) { const n = pilha.pop(); r.push(n); pilha.push(...[...(idx.filhos.get(n.id) || [])].reverse()); }
  return r;
}
export function profundidade(idx, id) { return caminhoAteRaiz(idx, id).length - 1; }
export function contarPorTipo(nos) {
  const c = {};
  nos.forEach((n) => { c[n.tipo] = (c[n.tipo] || 0) + 1; });
  return c;
}
/* "Quem resolve" mais próximo: ligações do nó, a subárvore dele, e depois subindo pelos ancestrais */
export function contatoMaisProximo(idx, id) {
  const no = idx.porId.get(id);
  if (!no) return null;
  if (no.tipo === "contato") return no;
  const lig = (no.ligacoes || []).map((l) => idx.porId.get(l.para)).find((n) => n && n.tipo === "contato");
  if (lig) return lig;
  const caminho = caminhoAteRaiz(idx, id);
  for (const anc of caminho) {
    const achado = descendentes(idx, anc).find((n) => n.tipo === "contato");
    if (achado) return achado;
  }
  return null;
}
export const revisaoVencida = (no) => (no.tipo === "teste" || no.tipo === "contato")
  && (!no.revisadoEm || Date.now() - Date.parse(no.revisadoEm) > NOVENTA_DIAS);

/* ------------------------------------------------------------
 *  Busca
 * ------------------------------------------------------------ */
/* Campos visíveis do tipo, com o valor já pronto para mostrar (rótulo da opção, lista, texto) */
export function camposComValor(no, { incluirOcultos = false } = {}) {
  return (CAMPOS[no.tipo] || []).filter((def) => incluirOcultos || !def.oculto).map((def) => {
    const v = valorDoCampo(no, def);
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
    return { def, valor: v, texto: Array.isArray(v) ? v.join("\n") : (def.tipo === "escolha" ? rotuloOpcao(def, v) : String(v)), opcao: def.tipo === "escolha" ? acharOpcao(def, v) : null };
  }).filter(Boolean);
}
export function textoDoNo(no) {
  const valores = [...Object.entries(no.campos || {}), ...Object.entries(no.extras || {})].map(([id, v]) => {
    const def = campoDoTipo(no.tipo, id);
    return Array.isArray(v) ? v.join(" ") : (def && def.tipo === "escolha" ? `${v} ${rotuloOpcao(def, v)}` : v);
  }).join(" ");
  return normalizar([no.titulo, no.descricao, valores, (no.tags || []).join(" "), (TIPOS[no.tipo] || {}).nome].join(" "));
}
export function corresponde(texto, termo) {
  const t = normalizar(termo).trim();
  if (!t) return true;
  return t.split(/\s+/).every((p) => texto.includes(p));
}

/* ------------------------------------------------------------
 *  Ids e modelos iniciais
 * ------------------------------------------------------------ */
export function idCurto(prefixo = "n") {
  const a = new Uint32Array(2);
  (globalThis.crypto || window.crypto).getRandomValues(a);
  return (prefixo + a[0].toString(36) + a[1].toString(36)).slice(0, 14);
}
const no = (tipo, titulo, paiId, ordem, extra = {}) => ({ id: extra.id || idCurto(), tipo, titulo, paiId, ordem, descricao: "", tags: [], campos: {}, ligacoes: [], ...extra });

/* ---------- Modelos de mapa ("+ Novo mapa"): padrões no código; o Painel grava mapas-config/modelos ---------- */
export const LIMITE_MODELOS = 30, LIMITE_NOS_MODELO = 200;
function modelosPadrao() {
  const raiz = (id) => no("sistema", "Sistema", null, 0, { id });
  const s = no("sintoma", "Sintoma de exemplo (renomeie)", "d-raiz", 0, { id: "d-sintoma", descricao: "Descreva o que o usuário vê: mensagem, tela, horário em que acontece." });
  const contato = no("contato", "Quem resolve", s.id, 3, { id: "d-contato", campos: { nome: "[Preencher: equipe responsável]" } });
  const t1 = no("teste", "Só comigo ou geral?", s.id, 0, {
    id: "d-teste-1", campos: { passos: ["Peça para um colega abrir o sistema em outra máquina", "Teste com outro usuário na sua máquina"], esperado: "Descobrir se o problema é local (só você) ou geral (todos)." }
  });
  const t2 = no("teste", "Limpar cache / testar outro navegador", s.id, 1, {
    id: "d-teste-2", campos: { passos: ["Abra o sistema numa janela anônima", "Limpe o cache e os cookies do site", "Teste em outro navegador"] }
  });
  const t3 = no("teste", "Conexão / VPN / rede", s.id, 2, {
    id: "d-teste-3", campos: { passos: ["Confira se a VPN está conectada", "Abra outro site interno", "Faça ping no servidor do sistema"] }
  });
  t1.ligacoes = [{ para: contato.id, rotulo: "Geral (todos afetados)" }, { para: t2.id, rotulo: "Só comigo" }];
  return [
    { id: "branco", nome: "Em branco", descricao: "Só o nó do sistema.", nos: [raiz("b-raiz")] },
    { id: "diagnostico", nome: "Diagnóstico padrão", descricao: "Sistema → sintoma de exemplo → 3 testes genéricos → Quem resolve.", nos: [raiz("d-raiz"), s, t1, t2, t3, contato] }
  ];
}
export const MODELOS = [];
export function normalizarModelo(m) {
  if (!m || !ID_VALIDO.test(m.id || "")) return null;
  const nos = (Array.isArray(m.nos) ? m.nos : []).slice(0, LIMITE_NOS_MODELO).map(normalizarNo).filter(Boolean)
    .map(({ atualizadoEm, atualizadoPor, recolhido, pos, revisadoEm, ...resto }) => resto);
  if (!nos.some((n) => !n.paiId)) return null;
  return { id: m.id, nome: txtE(m.nome, 60) || m.id, descricao: txtE(m.descricao, 200), nos };
}
export const modelosPadraoNormalizados = () => modelosPadrao().map(normalizarModelo);
export function aplicarModelos(config) {
  const lista = config && Array.isArray(config.lista) ? config.lista.map(normalizarModelo).filter(Boolean).slice(0, LIMITE_MODELOS) : [];
  MODELOS.length = 0;
  MODELOS.push(...(lista.length ? lista : modelosPadraoNormalizados()));
  return MODELOS;
}
/* Nós de um modelo com ids novos; a raiz recebe o nome do sistema */
export function nosDoModelo(modeloId, nomeSistema) {
  const m = MODELOS.find((x) => x.id === modeloId) || MODELOS[0];
  const { nos } = clonarNos(m ? m.nos : [no("sistema", nomeSistema, null, 0)], true);
  const raiz = nos.find((n) => !n.paiId);
  if (raiz) { raiz.titulo = nomeSistema; raiz.tipo = "sistema"; }
  return nos;
}
/* Mapa de exemplo SCDA (sem nomes, e-mails ou telefones reais: marcadores [Preencher: …]) */
export const TAG_EXEMPLO = "exemplo-revisar";
export function mapaExemploSCDA() {
  const mapa = { id: "scda", nome: "SCDA", descricao: "Exemplo: roteiro quando o SCDA cai ou trava. Revise os testes e preencha os contatos.", icone: "i-servidor", cor: "azul", layout: "arvore", tags: [TAG_EXEMPLO] };
  const raiz = no("sistema", "SCDA", null, 0, { id: "scda-sistema", descricao: "Sistema SCDA.", campos: { dono: "[Preencher: área dona do sistema]", criticidade: "Alta" }, tags: [TAG_EXEMPLO] });
  const s1 = no("sintoma", "Sistema caindo / travando", raiz.id, 0, {
    id: "scda-caindo", descricao: "O SCDA fecha sozinho, para de responder ou fica carregando sem fim.",
    campos: { palavrasChave: "caindo\ntravando\nlento\nnão carrega\ntempo esgotado", frequencia: "Frequente", impacto: "Alto" }
  });
  const contatoInfra = no("contato", "Infra / Fornecedor do SCDA", s1.id, 3, {
    id: "scda-contato-infra", descricao: "Acione quando o problema é **geral** (outros usuários também afetados).",
    campos: { nome: "[Preencher: equipe responsável]", area: "[Preencher: Infra ou fornecedor]", canal: "Chamado", horario: "[Preencher: horário de atendimento]", sla: "[Preencher: prazo]", nivel: "N3" }
  });
  const t1 = no("teste", "Só comigo ou geral?", s1.id, 0, {
    id: "scda-teste-escopo", descricao: "Primeiro descubra o alcance: muda tudo o que vem depois.",
    campos: { passos: ["Peça para um colega abrir o SCDA em outra máquina", "Teste com outro usuário na sua máquina", "Veja se há aviso de instabilidade no canal da equipe"],
      esperado: "**Geral**: escale direto para Infra / Fornecedor. **Só comigo**: siga para o próximo teste.", tempo: "5 min" }
  });
  const t2 = no("teste", "Limpar cache / testar outro navegador", s1.id, 1, {
    id: "scda-teste-cache", campos: { passos: ["Abra o SCDA numa janela anônima", "Limpe cache e cookies do site", "Teste em outro navegador"], esperado: "Se funcionar no anônimo ou em outro navegador, o problema é cache/extensão local.", tempo: "5 min" }
  });
  const t3 = no("teste", "Conexão / VPN / ping no servidor", s1.id, 2, {
    id: "scda-teste-rede", campos: { passos: ["Confira se a VPN está conectada", "Abra outro sistema interno", "Faça ping no servidor do SCDA ([Preencher: endereço])"], esperado: "Se a rede falhar, o problema é de conexão: acione o suporte de rede.", tempo: "5 min" }
  });
  t1.ligacoes = [{ para: contatoInfra.id, rotulo: "Geral (todos afetados)" }, { para: t2.id, rotulo: "Só comigo" }];
  const sol = no("solucao", "Limpar cache resolve", t2.id, 0, { id: "scda-solucao-cache", campos: { passos: ["Limpe o cache do navegador", "Feche e abra o navegador"], natureza: "Paliativa" } });
  const s2 = no("sintoma", "Erro de login", raiz.id, 1, { id: "scda-login", campos: { palavrasChave: "senha inválida\nusuário bloqueado", impacto: "Médio" } });
  const t4 = no("teste", "Conferir usuário, senha e bloqueio", s2.id, 0, { id: "scda-teste-login", campos: { passos: ["Confirme o usuário digitado", "Tente redefinir a senha", "Verifique se o usuário está bloqueado"] } });
  const c2 = no("contato", "Quem libera acesso", s2.id, 1, { id: "scda-contato-acesso", campos: { nome: "[Preencher: equipe de acessos]", canal: "Chamado", nivel: "N2" } });
  const links = no("link", "Links úteis", raiz.id, 2, { id: "scda-links", descricao: "Manual, status do serviço e caderno relacionado." });
  const l1 = no("link", "Manual do SCDA", links.id, 0, { id: "scda-link-manual", descricao: "[Preencher: endereço do manual]" });
  return { mapa, nos: [raiz, s1, t1, t2, t3, contatoInfra, sol, s2, t4, c2, links, l1].map(normalizarNo) };
}

/* ------------------------------------------------------------
 *  Textos: roteiro (resumo copiável), Markdown e JSON
 * ------------------------------------------------------------ */
const ROTULO_RESULTADO = { resolveu: "Resolveu", "nao-resolveu": "Não resolveu", pulado: "Pulado" };
/* Contato numa linha: todos os campos visíveis do tipo, com os rótulos e opções atuais do Painel */
export function textoContato(c) {
  if (!c) return "";
  const nome = (c.campos || {}).nome;
  return [`${c.titulo}${nome && nome !== c.titulo ? ` (${nome})` : ""}`,
    ...camposComValor(c).filter((x) => x.def.id !== "nome" && x.def.tipo !== "area" && x.def.tipo !== "lista").map((x) => `${x.def.rotulo}: ${x.texto}`)].join(" · ");
}
export function resumoRoteiro({ mapa, sintoma, passos, desfecho, contato, quando = new Date() }) {
  const linhas = [
    `Sistema: ${mapa.nome}`,
    `Sintoma: ${sintoma.titulo}`,
    `Data: ${formatarData(quando, true)}`,
    "",
    "Testes realizados:"
  ];
  if (!passos.length) linhas.push("- Nenhum teste registrado.");
  passos.forEach((p, i) => linhas.push(`${i + 1}. ${p.titulo}: ${ROTULO_RESULTADO[p.resultado] || p.resultado}`));
  linhas.push("", `Resultado: ${desfecho}`);
  if (contato) linhas.push(`Contato: ${textoContato(contato)}`);
  return linhas.join("\n");
}
export function mapaParaMarkdown(mapa, nos) {
  const idx = indexar(nos);
  const linhas = [`# ${mapa.nome}`, ""];
  if (mapa.descricao) linhas.push(mapa.descricao, "");
  const escrever = (n, nivel) => {
    const rec = "  ".repeat(nivel);
    linhas.push(`${rec}- **${TIPOS[n.tipo].nome}: ${n.titulo}**`);
    if (n.descricao) n.descricao.split("\n").forEach((l) => linhas.push(`${rec}  ${l}`));
    camposComValor(n).forEach(({ def, valor, texto }) => {
      if (Array.isArray(valor)) { linhas.push(`${rec}  ${def.rotulo}:`); valor.forEach((p, i) => linhas.push(`${rec}    ${i + 1}. ${p}`)); }
      else linhas.push(`${rec}  ${def.rotulo}: ${texto}`);
    });
    (n.ligacoes || []).forEach((l) => { const alvo = idx.porId.get(l.para); if (alvo) linhas.push(`${rec}  → ${l.rotulo ? l.rotulo + ": " : ""}${alvo.titulo}`); });
    (idx.filhos.get(n.id) || []).forEach((f) => escrever(f, nivel + 1));
  };
  if (idx.raiz) escrever(idx.raiz, 0);
  return linhas.join("\n");
}
export const FORMATO_JSON = "suporte-n2-mapa";
export function mapaParaJSON(mapa, nos) {
  const limpar = (n) => { const { atualizadoEm, atualizadoPor, ...resto } = n; return resto; };
  const { criadoEm, criadoPor, atualizadoEm, atualizadoPor, excluidoEm, ...m } = mapa;
  return JSON.stringify({ formato: FORMATO_JSON, versao: 1, exportadoEm: new Date().toISOString(), mapa: m, nos: nos.map(limpar) }, null, 2);
}
/* Lê o JSON exportado. Gera ids novos quando pedido (importar como cópia) */
export function lerJSONMapa(texto, { idsNovos = true } = {}) {
  const d = JSON.parse(texto);
  if (!d || d.formato !== FORMATO_JSON || !d.mapa || !Array.isArray(d.nos)) throw new Error("Arquivo não é um mapa exportado desta página.");
  if (d.nos.length > 2000) throw new Error("Mapa grande demais (mais de 2000 nós).");
  return clonarNos(d.nos.map(normalizarNo).filter(Boolean), idsNovos, { ...d.mapa, id: d.mapa.id || "mapa" });
}
export function clonarNos(nos, idsNovos = true, mapa = null) {
  const troca = new Map(nos.map((n) => [n.id, idsNovos ? idCurto() : n.id]));
  const copia = nos.map((n) => ({
    ...n, id: troca.get(n.id), paiId: n.paiId ? (troca.get(n.paiId) || null) : null,
    ligacoes: (n.ligacoes || []).filter((l) => troca.has(l.para)).map((l) => ({ ...l, para: troca.get(l.para) }))
  }));
  return { mapa: mapa ? normalizarMapa({ ...mapa, id: ID_VALIDO.test(mapa.id || "") ? mapa.id : "mapa" }) : null, nos: copia };
}

/* Estrutura e modelos iniciais = padrões do código (a configuração da nuvem chega depois) */
aplicarEstrutura(null);
aplicarModelos(null);

/* ------------------------------------------------------------
 *  Comparação de configurações (Histórico do Painel)
 * ------------------------------------------------------------ */
export function diferencas(a, b, caminho = "", saida = []) {
  if (saida.length > 200) return saida;
  const ehObj = (v) => v && typeof v === "object";
  if (ehObj(a) && ehObj(b) && Array.isArray(a) === Array.isArray(b)) {
    /* Listas de itens com id (campos, opções, modelos): compara pelo id */
    const porId = Array.isArray(a) && [...a, ...b].every((x) => ehObj(x) && typeof x.id === "string");
    if (porId) {
      const ma = new Map(a.map((x) => [x.id, x])), mb = new Map(b.map((x) => [x.id, x]));
      new Set([...ma.keys(), ...mb.keys()]).forEach((id) => diferencas(ma.get(id), mb.get(id), `${caminho}[${id}]`, saida));
      const oa = a.map((x) => x.id).filter((id) => mb.has(id)).join(","), ob = b.map((x) => x.id).filter((id) => ma.has(id)).join(",");
      if (oa !== ob) saida.push({ caminho: `${caminho} (ordem)`, antes: oa, depois: ob });
      return saida;
    }
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => diferencas(a[k], b[k], caminho ? `${caminho}.${k}` : k, saida));
    return saida;
  }
  const ta = a === undefined ? "" : (ehObj(a) ? JSON.stringify(a) : String(a));
  const tb = b === undefined ? "" : (ehObj(b) ? JSON.stringify(b) : String(b));
  if (ta !== tb) saida.push({ caminho, antes: ta.slice(0, 160), depois: tb.slice(0, 160) });
  return saida;
}
