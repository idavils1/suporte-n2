/*
 * ============================================================
 *  PLANILHAS DA CENTRAL · Suporte V/CERT (planilha.html?p=<id>)
 *
 *  ORIGEM: motor COPIADO E ADAPTADO de sites/banco-tickets/assets/app.js (Banco de Tickets):
 *  grade virtualizada, tipos de coluna, ficha, filtros, visões, colar do Excel, arquivo
 *  compactado, lixeira, backups e editor de estrutura. A Central não pode depender daquele
 *  site (a hospedagem ignora sites/**): ao corrigir o motor, corrija nos dois lugares.
 *
 *  Diferença: aqui NÃO há a segurança do Banco (sem "Se registre como:", pessoas ou papéis).
 *  Como nos cadernos, qualquer pessoa lê e edita, assinando com o nome (pedido na primeira
 *  alteração e guardado no navegador). Lays e Paula logadas na Central assinam com o e-mail e
 *  são as únicas que alteram as colunas "Só administradoras". Vale o que está no firestore.rules.
 *
 *  Firestore (uma "pasta" por planilha):
 *   planilhas/{id}                       { titulo, estrutura { colunas, gruposColunas, abas, resumo, regras },
 *                                          colunasIds, colunasAdmin, versao, criadoEm, criadoPor, atualizadoEm, atualizadoPor }
 *                                          colunasIds/colunasAdmin: as regras usam essas listas para conferir as linhas.
 *   planilhas/{id}/linhas/{linha}        { campos: { idColuna: valor }, parcial?, removida?, criadoPor, criadoPorNome,
 *                                          criadoEm, atualizadoPor, atualizadoPorNome, atualizadoEm }
 *                                          criadoPor/atualizadoPor: e-mail (administradora) ou nome (sem login).
 *                                          removida: true = está na lixeira (a linha some da grade e pode ser restaurada).
 *   planilhas/{id}/linhas/{linha}/historico/{e}   acao, coluna, colunaNome, antes, depois, por, porNome, em
 *   planilhas/{id}/arquivo/{parte}       linhas compactadas (muitas por documento; só administradoras gravam). Uma linha
 *                                          em linhas/{mesmo id} substitui a do arquivo; com "parcial: true", só os campos
 *                                          alterados valem por cima dela.
 *   planilhas/{id}/lixeira/{linha}       cópia da linha excluída (para listar); restaurar = removida: false
 *   planilhas/{id}/backups/{b}           + /partes/{n}
 * ============================================================
 */
import { ADMINS, conectarNuvem, ligarLogin, aoMudarSessao } from "./base.js";
import { criarAparencia } from "./planilha-aparencia.js";

/* Ícones do motor que não estão em comum/icones.js (mesmo traço) */
(function injetarIconesPlanilha() {
  if (document.getElementById("icones-planilha")) return;
  const SIMBOLOS = {
    "i-arquivo": '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    "i-restaurar": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    "i-historico": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    "i-selecionar": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>'
  };
  const box = document.createElement("div");
  box.innerHTML = `<svg id="icones-planilha" xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${Object.entries(SIMBOLOS).map(([id, d]) => `<symbol id="${id}" viewBox="0 0 24 24">${d}</symbol>`).join("")}</svg>`;
  document.body.prepend(box.firstChild);
})();

/* Planilha aberta: identificador fixo do bloco (mesmo formato do caderno) */
const PARAMETROS = new URLSearchParams(location.search);
const ID = (PARAMETROS.get("p") || "").trim();
const ID_OK = /^[a-z0-9-]{1,40}$/.test(ID);
const DOC = `planilhas/${ID}`;
const LINHAS = `${DOC}/linhas`;
const ARQUIVO = `${DOC}/arquivo`;
const LIXEIRA = `${DOC}/lixeira`;
const BACKUPS = `${DOC}/backups`;

/* ------------------------------------------------------------
 *  Utilitários
 * ------------------------------------------------------------ */
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
function escapar(valor) {
  return String(valor == null ? "" : valor)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const normalizar = (t) => String(t == null ? "" : t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const svg = (id, classe = "icone") => `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true"><use href="#${escapar(id)}"/></svg>`;
function slug(texto, max = 40) {
  return normalizar(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "") || "item";
}
/* Todas as chaves deste site começam com "banco-tickets-" */
const lerLocal = (chave, padrao) => { try { const v = localStorage.getItem(chave); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } };
const gravarLocal = (chave, valor) => { try { localStorage.setItem(chave, JSON.stringify(valor)); return true; } catch (e) { return false; } };
const apagarLocal = (chave) => { try { localStorage.removeItem(chave); } catch (e) {} };
/* Chaves deste navegador: tema da Central, nome de quem assina (o mesmo dos cadernos) e, por planilha,
   visão, visões salvas, rascunho e cópia para quando a conexão cair */
const CHAVE_TEMA = "suporte-n2-tema";
const CHAVE_AUTOR = "suporte-n2-autor-caderno";
const CHAVE_COPIA = `suporte-n2-planilha-${ID}-copia`;
const CHAVE_MARCADOR = "suporte-n2-planilha-marcador-removidas";
const chaveUsuario = (nome) => `suporte-n2-planilha-${ID}-${nome}`;

const FORMATO_BRASILIA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function partesBrasilia(data = new Date()) {
  const p = {};
  FORMATO_BRASILIA.formatToParts(data).forEach((x) => { p[x.type] = x.value; });
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour === "24" ? "00" : p.hour, minuto: p.minute };
}
const hojeIso = () => { const p = partesBrasilia(); return `${p.ano}-${p.mes}-${p.dia}`; };
function formatarData(valor, comHora = false) {
  if (!valor) return "";
  const d = new Date(valor);
  if (isNaN(d)) return "";
  const p = partesBrasilia(d);
  return comHora ? `${p.dia}/${p.mes}/${p.ano} ${p.hora}:${p.minuto}` : `${p.dia}/${p.mes}/${p.ano}`;
}
const dataIsoBrasilia = (valor) => { const d = new Date(valor); if (isNaN(d)) return ""; const p = partesBrasilia(d); return `${p.ano}-${p.mes}-${p.dia}`; };

let temporizadorAviso = null;
function mostrarAviso(texto, ms) {
  let el = $("#aviso");
  if (!el) {
    el = document.createElement("div");
    el.id = "aviso";
    el.className = "aviso";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = texto;
  el.classList.add("visivel");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove("visivel"), ms || 3600);
}
function criarDialogo({ titulo, corpo, largo = false }) {
  const d = document.createElement("dialog");
  d.className = "perfil" + (largo ? " largo" : "");
  d.setAttribute("aria-label", titulo);
  d.innerHTML = `<form class="form-dialog" method="dialog" novalidate>
    <div class="form-topo"><h2>${escapar(titulo)}</h2>
      <button type="button" class="perfil-fechar" data-fechar aria-label="Fechar">${svg("i-fechar")}</button></div>
    ${corpo}
  </form>`;
  document.body.appendChild(d);
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-fechar]")) d.close(); });
  d.addEventListener("close", () => setTimeout(() => d.remove(), 300));
  return d;
}
function confirmar(texto, { titulo = "Confirmar", botao = "Confirmar", perigo = false, html = "", cancelar = true } = {}) {
  return new Promise((resolver) => {
    const d = criarDialogo({
      titulo,
      corpo: `<p class="apoio">${escapar(texto)}</p>${html}
        <div class="form-botoes">${cancelar ? '<button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>' : ""}
        <button type="submit" class="btn${perigo ? " btn-perigo" : ""}" value="ok">${escapar(botao)}</button></div>`
    });
    let ok = false;
    d.querySelector("form").addEventListener("submit", () => { ok = true; });
    d.addEventListener("close", () => resolver(ok));
    d.showModal();
  });
}
/* Ações drásticas: só confirma digitando exatamente o texto pedido (ex.: o nome da coluna) */
function confirmarDigitando(texto, exigido, { titulo = "Confirmar", botao = "Confirmar" } = {}) {
  return new Promise((resolver) => {
    const d = criarDialogo({
      titulo,
      corpo: `<p class="apoio">${escapar(texto)}</p>
        <label class="campo"><span class="rotulo">Digite <strong>${escapar(exigido)}</strong> para confirmar</span><input name="digitado" autocomplete="off"></label>
        <p class="form-erro" role="alert"></p>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
        <button type="submit" class="btn btn-perigo" value="ok">${escapar(botao)}</button></div>`
    });
    const form = d.querySelector("form");
    let ok = false;
    form.addEventListener("submit", (e) => {
      if (form.digitado.value.trim() !== exigido) { e.preventDefault(); form.querySelector(".form-erro").textContent = "O texto não confere."; return; }
      ok = true;
    });
    d.addEventListener("close", () => resolver(ok));
    d.showModal();
    form.digitado.focus();
  });
}
function baixarArquivo(nome, conteudo, tipo = "text/plain;charset=utf-8") {
  const blob = new Blob([conteudo], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch (e) { return false; }
}
function ligarTema() {
  const atualizar = () => {
    const escuro = document.documentElement.dataset.tema === "escuro";
    $$("[data-tema-botao]").forEach((b) => {
      b.innerHTML = svg(escuro ? "i-sol" : "i-lua");
      b.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
      b.title = escuro ? "Tema claro" : "Tema escuro";
    });
  };
  $$("[data-tema-botao]").forEach((b) => b.addEventListener("click", () => {
    const escuro = document.documentElement.dataset.tema !== "escuro";
    document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
    try { localStorage.setItem(CHAVE_TEMA, escuro ? "escuro" : "claro"); } catch (e) {}
    atualizar();
  }));
  atualizar();
}

/* ------------------------------------------------------------
 *  Estrutura (colunas, grupos, abas e resumo)
 *  O id da coluna nunca muda: renomear muda só o rótulo.
 * ------------------------------------------------------------ */
const TIPOS = [
  { id: "texto", nome: "Texto curto" }, { id: "textoLongo", nome: "Texto longo" }, { id: "numero", nome: "Número" },
  { id: "data", nome: "Data" }, { id: "dataHora", nome: "Data e hora" }, { id: "lista", nome: "Lista (uma opção)" },
  { id: "etiquetas", nome: "Etiquetas (várias opções)" }, { id: "status", nome: "Status (lista com cor)" },
  { id: "prioridade", nome: "Prioridade (lista com cor)" }, { id: "pessoa", nome: "Pessoa (e-mail ou nome)" },
  { id: "link", nome: "Link" }, { id: "booleano", nome: "Sim / Não" },
  { id: "derivado", nome: "Calculado (ex.: dias em aberto)" }, { id: "automatico", nome: "Automático (registrado/atualizado por/em)" }
];
const NOME_TIPO = Object.fromEntries(TIPOS.map((t) => [t.id, t.nome]));
const TIPOS_LISTA = ["lista", "etiquetas", "status", "prioridade"];
const TIPOS_SEM_EDICAO = ["derivado", "automatico"];
const CORES = ["cinza", "vermelho", "laranja", "amarelo", "verde", "azul", "roxo", "rosa"];
const NOME_COR = { cinza: "Cinza", vermelho: "Vermelho", laranja: "Laranja", amarelo: "Amarelo", verde: "Verde", azul: "Azul", roxo: "Roxo", rosa: "Rosa" };
const AUTOS = { criadoPor: "Registrado por", criadoEm: "Registrado em", atualizadoPor: "Atualizado por", atualizadoEm: "Atualizado em" };
const FORMULAS = { diasEmAberto: "Dias em aberto (da data de abertura até a resolução ou hoje)" };
const LIMITES = { texto: 300, textoLongo: 5000, link: 500, pessoa: 120 };
const RE_ID = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const RE_OPCAO = /^[a-z0-9-]{1,40}$/;
/* MAX_OPCOES: opções ativas (as que aparecem para escolher). As removidas da lista continuam guardadas
   (o nome aparece nas linhas que já as usam) até MAX_OPCOES_TOTAL por coluna. */
const MAX_OPCOES = 400;
const MAX_OPCOES_TOTAL = 1000;
const MAX_COLUNAS = 80;
/* Quem altera cada coluna. "lista": escolhe uma opção existente (não digita). "bloqueado": Só administradoras. */
const ACESSOS = [
  { id: "livre", nome: "LIVRE (qualquer pessoa)" },
  { id: "lista", nome: "LISTA (escolhe uma opção, não digita)" },
  { id: "bloqueado", nome: "Só administradoras (Lays e Paula logadas na Central)" }
];
const ACESSO_CURTO = { livre: "LIVRE", lista: "LISTA", bloqueado: "SÓ ADMINISTRADORAS" };
const TEXTO_BLOQUEADO = "Só as administradoras (Lays e Paula, logadas na Central) alteram este campo";
function acessoDe(c) {
  if (c.tipo && TIPOS_SEM_EDICAO.includes(c.tipo)) return "livre";
  const lista = TIPOS_LISTA.includes(c.tipo);
  if (c.acesso === "bloqueado" || (!c.acesso && c.somenteAdmin)) return "bloqueado";
  if (c.acesso === "livre" && !lista) return "livre";
  return lista ? "lista" : "livre";
}

const txt = (v, max) => String(v == null ? "" : v).slice(0, max);
/* ativa: false = removida da lista (some das escolhas; as linhas que já a usam continuam mostrando o nome).
   nomesAnteriores: nomes corrigidos em todas as linhas ("antes chamada X"). */
function normalizarOpcao(o) {
  if (!o || !RE_OPCAO.test(o.id || "")) return null;
  const anteriores = (Array.isArray(o.nomesAnteriores) ? o.nomesAnteriores : []).filter((x) => x && x.nome)
    .map((x) => ({ nome: txt(x.nome, 100), ate: txt(x.ate, 40), por: txt(x.por, 120) })).slice(-5);
  return {
    id: o.id, nome: txt(o.nome, 100) || o.id, cor: CORES.includes(o.cor) ? o.cor : "", ...(o.final ? { final: true } : {}),
    ...(o.ativa === false ? { ativa: false, removidaEm: txt(o.removidaEm, 40), removidaPor: txt(o.removidaPor, 120) } : {}),
    ...(anteriores.length ? { nomesAnteriores: anteriores } : {})
  };
}
/* Aceita o documento planilhas/{id} (estrutura dentro de "estrutura") ou a estrutura solta (backups e cópias).
   No documento, "colunasAdmin" é quem manda: é a lista que as regras usam. */
function normalizarEstrutura(doc) {
  if (!doc || typeof doc !== "object") return null;
  const d = doc.estrutura && typeof doc.estrutura === "object" ? doc.estrutura : doc;
  const admins = Array.isArray(doc.colunasAdmin) ? new Set(doc.colunasAdmin) : null;
  const grupos = (Array.isArray(d.gruposColunas) ? d.gruposColunas : []).filter((g) => g && RE_OPCAO.test(g.id || ""))
    .map((g, i) => ({ id: g.id, nome: txt(g.nome, 60) || g.id, ordem: Number(g.ordem) || i + 1 })).slice(0, 20);
  if (!grupos.length) grupos.push({ id: "geral", nome: "Geral", ordem: 1 });
  const colunas = (Array.isArray(d.colunas) ? d.colunas : []).filter((c) => c && RE_ID.test(c.id || "") && NOME_TIPO[c.tipo]).slice(0, MAX_COLUNAS).map((c, i) => {
    const somenteAdmin = !TIPOS_SEM_EDICAO.includes(c.tipo) && (admins ? admins.has(c.id) : acessoDe(c) === "bloqueado");
    const acesso = somenteAdmin ? "bloqueado" : acessoDe({ ...c, acesso: c.acesso === "bloqueado" ? "" : c.acesso, somenteAdmin: false });
    return {
      id: c.id, nome: txt(c.nome, 60) || c.id, tipo: c.tipo,
      grupo: grupos.some((g) => g.id === c.grupo) ? c.grupo : grupos[0].id,
      ordem: Number(c.ordem) || i + 1, largura: Math.max(60, Math.min(600, Number(c.largura) || 150)),
      obrigatoria: !!c.obrigatoria, unica: !!c.unica, padrao: txt(c.padrao, 60),
      opcoes: (Array.isArray(c.opcoes) ? c.opcoes : []).map(normalizarOpcao).filter(Boolean).slice(0, MAX_OPCOES_TOTAL),
      ajuda: txt(c.ajuda, 200), acesso, somenteAdmin, ativa: c.ativa !== false,
      ...(c.tipo === "automatico" ? { auto: AUTOS[c.auto] ? c.auto : "criadoEm" } : {}),
      ...(c.tipo === "derivado" ? { formula: FORMULAS[c.formula] ? c.formula : "diasEmAberto", de: txt(c.de, 40), ate: txt(c.ate, 40) } : {})
    };
  });
  const abas = d.abas && typeof d.abas === "object" && RE_ID.test(d.abas.coluna || "") ? { coluna: d.abas.coluna } : {};
  const resumo = { mostrar: !(d.resumo && d.resumo.mostrar === false) };
  return {
    titulo: txt(doc.titulo || d.titulo, 120),
    versao: Math.floor(Number(doc.versao || d.versao)) || 1,
    categorias: [], colunas, gruposColunas: grupos, abas, resumo, regras: {},
    atualizadoEm: doc.atualizadoEm || "", atualizadoPor: txt(doc.atualizadoPor, 120)
  };
}
/* Listas que as regras do Firestore usam: ids de todas as colunas editáveis e das "Só administradoras" */
const colunasIdsDe = (e) => e.colunas.filter((c) => !TIPOS_SEM_EDICAO.includes(c.tipo)).map((c) => c.id);
const colunasAdminDe = (e) => e.colunas.filter((c) => c.somenteAdmin && !TIPOS_SEM_EDICAO.includes(c.tipo)).map((c) => c.id);
/* Só a estrutura (sem controle), para o documento, os backups e a cópia deste navegador */
const dadosEstruturaBackup = (e) => ({ colunas: e.colunas, gruposColunas: e.gruposColunas, abas: e.abas || {}, resumo: e.resumo || { mostrar: true }, regras: {} });

/* ------------------------------------------------------------
 *  Estado
 * ------------------------------------------------------------ */
/* docs: todos os documentos do arquivo (de qualquer versão); partes: os da versão em uso */
function arquivoVazio() { return { versao: 0, docs: [], partes: [], linhas: [], parteDe: new Map() }; }
const estado = {
  api: null,
  usuario: { admin: false },  // { admin, email, nome } (administradora logada na Central) ou { admin: false } (assina com o nome)
  bloco: null,                // { nome, catId, rascunho } do bloco da Central que abre esta planilha
  docExiste: false,           // planilhas/{id} já foi gravado (a primeira coluna já foi criada)
  estrutura: null,
  carregouEstrutura: false,
  tickets: [],                // linhas visíveis: arquivo + linhas vivas (a viva substitui a do arquivo de mesmo id)
  carregouTickets: false,
  vivos: [],                  // linhas/{id} (inclusive as que estão na lixeira, com removida: true)
  removidas: [],              // linhas na lixeira, já mescladas com a do arquivo
  carregouVivos: false,
  arquivo: arquivoVazio(),
  carregouArquivo: false,
  offline: !navigator.onLine,
  usandoCopia: false,
  vista: null,
  visao: "padrao",
  busca: "",
  linhas: [],
  filtrados: [],
  celula: null,
  editando: null,
  gruposFechados: new Set(),
  intervalo: null,            // células de uma coluna selecionadas juntas (Shift+clique, arrastar, Shift+setas)
  desfazer: [],
  piscar: new Map(),
  selecionando: false,
  selecionados: new Set(),
  lixeira: [],
  ouvintesPlanilha: []
};
const ehAdmin = () => !!(estado.usuario && estado.usuario.admin);
/* Aparência livre (planilha-aparencia.js): criada no fim do arquivo, depois de tudo definido */
let aparencia = null;
const SEM_APARENCIA = { l: "", c: {} };
/* Conta da Central que não é de administradora: só lê (as regras não aceitam a assinatura dela) */
const contaSemPermissao = () => !!(estado.usuario && estado.usuario.semPermissao);
const conectado = () => !!estado.api && !estado.offline;
const podeAlimentar = () => conectado() && !!estado.estrutura && !contaSemPermissao();
const porId = (id) => estado.tickets.find((t) => t.id === id);
const mapaTickets = () => new Map(estado.tickets.map((t) => [t.id, t]));
/* As planilhas da Central não têm o índice "Nº do ticket" do Banco: valores únicos são conferidos linha a linha */
const idChave = () => "";
const ticketsComNumero = () => [];

/* Colunas ativas na ordem padrão (grupo, depois coluna). A estrutura nunca é alterada no lugar. */
let cacheAtivas = [], cacheAtivasDe = null;
function colunasAtivas() {
  const e = estado.estrutura;
  if (!e) return [];
  if (cacheAtivasDe !== e) {
    const ordemGrupo = (g) => (e.gruposColunas.find((x) => x.id === g) || {}).ordem || 99;
    cacheAtivas = e.colunas.filter((c) => c.ativa).sort((a, b) => ordemGrupo(a.grupo) - ordemGrupo(b.grupo) || a.ordem - b.ordem);
    cacheAtivasDe = e;
  }
  return cacheAtivas.slice();
}
let COL = {};
function recalcularColunas() { COL = Object.fromEntries((estado.estrutura ? estado.estrutura.colunas : []).map((c) => [c.id, c])); }
const colPorTipo = (tipo) => colunasAtivas().find((c) => c.tipo === tipo);
const colCategoria = () => null;
/* Coluna que dá o título da linha (ficha, cartões, lixeira): a primeira coluna ativa */
const colTitulo = () => colunasAtivas().find((c) => !TIPOS_SEM_EDICAO.includes(c.tipo)) || colunasAtivas()[0] || null;
/* Coluna de valor único usada para "Atualizar" ao colar do Excel */
const colChave = () => colunasAtivas().find((c) => c.unica && ["texto", "numero", "link", "pessoa"].includes(c.tipo)) || null;
const chaveValor = (v) => nomeComparavel(Array.isArray(v) ? v.join(",") : v);
function opcoesDe(col) { return col ? col.opcoes : []; }
const cacheOpcoes = new WeakMap();
function opcao(col, id) {
  let m = cacheOpcoes.get(col.opcoes);
  if (!m || m.size !== col.opcoes.length) { m = new Map(col.opcoes.map((o) => [o.id, o])); cacheOpcoes.set(col.opcoes, m); }
  return m.get(id);
}
const nomeGrupo = (id) => ((estado.estrutura && estado.estrutura.gruposColunas.find((g) => g.id === id)) || {}).nome || "";
/* Título = nome do bloco na Central (o do documento só vale se o conteúdo da Central não carregar) */
const tituloPlanilha = () => (estado.bloco && estado.bloco.nome) || (estado.estrutura && estado.estrutura.titulo) || ID;

/* ------------------------------------------------------------
 *  Valores das células
 * ------------------------------------------------------------ */
/* Quem assinou: e-mail (administradora) vira o nome dela; sem login, o próprio nome */
const nomePessoa = (id) => {
  const a = ADMINS.find((x) => x.email === String(id || "").toLowerCase());
  return a ? a.nome : String(id || "");
};
const nomeAutor = (t, campo) => (t && (t[campo + "Nome"] || nomePessoa(t[campo]))) || "";
function emailAutor(t, campo) {
  const v = String((t && t[campo]) || "");
  return v.includes("@") ? v : "";
}
const ehAutoPor = (col) => col && col.tipo === "automatico" && /Por$/.test(col.auto);
/* Texto do "title" da célula: nas colunas "por", o e-mail junto do nome */
function tituloCelula(t, col) {
  const v = valorTexto(t, col);
  const e = ehAutoPor(col) ? emailAutor(t, col.auto) : "";
  return e && e !== v ? `${v} · ${e}` : v;
}
function finalizado(t) {
  const st = colPorTipo("status");
  if (!st) return false;
  const o = opcao(st, (t.campos || {})[st.id]);
  return !!(o && o.final);
}
function diasEmAberto(t, col) {
  const campos = t.campos || {};
  const de = (col.de && campos[col.de]) || dataIsoBrasilia(t.criadoEm);
  if (!de) return "";
  let ate = col.ate && campos[col.ate];
  if (!ate) ate = finalizado(t) ? dataIsoBrasilia(t.atualizadoEm) || hojeIso() : hojeIso();
  const dias = Math.floor((Date.parse(ate + "T12:00:00") - Date.parse(de + "T12:00:00")) / 86400000);
  return isNaN(dias) ? "" : Math.max(0, dias);
}
function valorBruto(t, col) {
  if (col.tipo === "automatico") return t[col.auto] || "";
  if (col.tipo === "derivado") return diasEmAberto(t, col);
  return (t.campos || {})[col.id];
}
function valorTexto(t, col) {
  const v = valorBruto(t, col);
  if (v == null || v === "") return "";
  switch (col.tipo) {
    case "lista": case "status": case "prioridade": { const o = opcao(col, v); return o ? o.nome : String(v); }
    case "etiquetas": return (Array.isArray(v) ? v : []).map((x) => (opcao(col, x) || { nome: x }).nome).join(", ");
    case "booleano": return v ? "Sim" : "Não";
    /* Valores importados que não eram datas (ex.: "27/007/2024", "-") aparecem como foram escritos */
    case "data": { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v); }
    case "dataHora": return formatarData(v, true);
    case "numero": return typeof v === "number" ? v.toLocaleString("pt-BR") : String(v);
    case "derivado": return String(v);
    case "automatico": return /Em$/.test(col.auto) ? formatarData(v, true) : nomeAutor(t, col.auto);
    default: return String(v);
  }
}
const etiquetaOpcao = (o, texto) => `<span class="etq${o && o.cor ? " cor-" + o.cor : ""}">${escapar(texto != null ? texto : o ? o.nome : "")}</span>`;
/* Opção removida da lista: o nome aparece normalmente, com um marcador discreto (cada pessoa liga ou desliga) */
const mostrarMarcador = () => lerLocal(CHAVE_MARCADOR, true) !== false;
const textoRemovida = (o) => `Removido da lista${o && o.removidaEm ? ` em ${formatarData(o.removidaEm)}` : ""}. O valor foi mantido.`;
const marcaRemovida = (o) => (o && o.ativa === false && mostrarMarcador() ? `<span class="marca-removida" title="${escapar(textoRemovida(o))}" aria-label="${escapar(textoRemovida(o))}"></span>` : "");
const textoAnteriores = (o) => (o && o.nomesAnteriores && o.nomesAnteriores.length ? `Antes chamada ${o.nomesAnteriores.map((x) => `“${x.nome}”`).join(", ")}` : "");
const htmlOpcao = (col, o) => {
  const h = (o.cor || col.tipo !== "lista" || col.origem ? etiquetaOpcao(o) : `<span class="t">${escapar(o.nome)}</span>`) + marcaRemovida(o);
  return textoAnteriores(o) ? `<span title="${escapar(textoAnteriores(o))}">${h}</span>` : h;
};
function htmlValor(t, col) {
  const v = valorBruto(t, col);
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
  switch (col.tipo) {
    case "lista": case "status": case "prioridade": {
      const o = opcao(col, v);
      if (!o) return `<span class="t">${escapar(v)}</span><span class="selo-fora" title="Valor que não existe nas opções desta coluna">fora da lista</span>`;
      return htmlOpcao(col, o);
    }
    case "etiquetas": return (Array.isArray(v) ? v : []).map((x) => { const o = opcao(col, x); return o ? etiquetaOpcao(o) + marcaRemovida(o) : etiquetaOpcao(null, x); }).join(" ");
    case "link": return /^https?:\/\//i.test(v) ? `<a href="${escapar(v)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : `<span class="t">${escapar(v)}</span>`;
    case "booleano": return v ? etiquetaOpcao({ cor: "verde" }, "Sim") : "";
    case "derivado": { const n = Number(v); return `<span class="t"${n > 7 && !finalizado(t) ? ' style="color:var(--c-vermelho);font-weight:700"' : ""}>${escapar(v)}</span>`; }
    default: return `<span class="t">${escapar(valorTexto(t, col))}</span>`;
  }
}

/* Opções de lista: comparação sem acentos, maiúsculas e espaços extras; só opções ativas */
const nomeComparavel = (t) => normalizar(t).replace(/\s+/g, " ").trim();
const compacto = (t) => normalizar(t).replace(/[^a-z0-9]+/g, "");
const opcoesAtivas = (col) => opcoesDe(col).filter((o) => o.ativa !== false);
function opcaoPeloTexto(col, v) {
  const n = nomeComparavel(v);
  return opcoesAtivas(col).find((x) => x.id === v || nomeComparavel(x.nome) === n) || null;
}
/* Semelhança de 0 a 1 (pares de letras), com bônus quando um nome começa pelo outro */
function semelhanca(a, b) {
  a = compacto(a); b = compacto(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pares = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); m.set(p, (m.get(p) || 0) + 1); } return m; };
  const pa = pares(a), pb = pares(b);
  let comuns = 0;
  pa.forEach((q, p) => { comuns += Math.min(q, pb.get(p) || 0); });
  const dice = (2 * comuns) / Math.max(1, a.length + b.length - 2);
  return Math.min(1, dice + (a.startsWith(b) || b.startsWith(a) ? 0.15 : 0));
}
/* Sugestão da opção mais parecida ({...opção, nota, contem}). Vale mais quando todas as palavras de um nome estão
   no outro, sem contar "AR" ("AR CERTICARD" → "AR CERTICARD CERTIFICADORA DIGITAL LTDA"), desde que entre elas haja
   uma palavra específica (não só CERTIFICADO, DIGITAL…). Ver sugestaoForte(). */
const PALAVRAS_GENERICAS = new Set(["certificado", "certificados", "certificadora", "certificacao", "digital", "digitais", "solucoes", "servicos", "ltda", "tecnologia", "informatica"]);
const palavrasComparaveis = (t) => palavrasDoNome(t).filter((p) => p !== "ar");
function sugerirOpcao(col, v, minimo = 0.5) {
  const pv = palavrasComparaveis(v);
  let melhor = null, nota = 0, contem = false;
  opcoesAtivas(col).forEach((o) => {
    let s = semelhanca(v, o.nome), c = false;
    const po = palavrasComparaveis(o.nome);
    if (pv.length && po.length) {
      const [menor, maior] = pv.length <= po.length ? [pv, po] : [po, pv];
      if (menor.every((p) => maior.includes(p)) && menor.some((p) => !PALAVRAS_GENERICAS.has(p))) { s = Math.max(s, 0.85 + 0.1 * (menor.length / maior.length)); c = true; }
    }
    if (s > nota) { nota = s; melhor = o; contem = c; }
  });
  return nota >= minimo ? { ...melhor, nota, contem } : null;
}
/* Forte (já vem marcada para mapear): um nome contém o outro, ou são quase iguais (erro de digitação, acentos).
   Só a semelhança por letras não basta: "AR LEMON CERTIFICACAO DIGITAL" × "AR LION…" dá 0,898. */
const sugestaoForte = (s) => !!s && (s.contem || s.nota >= 0.91);
/* Valor de lista que NÃO existe nas opções (valor solto, de importação ou de dados antigos): selo de alerta */
function foraDaLista(col, v) {
  if (!col || !TIPOS_LISTA.includes(col.tipo) || col.tipo === "etiquetas" || col.origem || estaVazio(v)) return false;
  return !opcao(col, v);
}
/* Valor que é uma opção removida da lista: não é erro, o nome continua valendo. Devolve a opção ou null. */
function opcaoRemovida(col, v) {
  if (!col || !TIPOS_LISTA.includes(col.tipo) || estaVazio(v) || Array.isArray(v)) return null;
  const o = opcao(col, v);
  return o && o.ativa === false ? o : null;
}
/* Opções para uma nova escolha: só as ativas, mais as removidas que a linha já tem (para não sumirem ao editar) */
const opcoesParaEscolha = (col, atual) => {
  const ja = new Set(Array.isArray(atual) ? atual : estaVazio(atual) ? [] : [atual]);
  return opcoesDe(col).filter((o) => o.ativa !== false || ja.has(o.id));
};
const rotuloEscolha = (o) => (o.ativa === false ? `${o.nome} (removido da lista)` : o.nome);

/* Validação: devolve { ok, valor } ou { ok: false, erro }. Vazio é válido (obrigatoriedade é conferida à parte). */
function chaveNumero(v) {
  return normalizar(v).toUpperCase().replace(/[^A-Z0-9._-]+/g, "-").replace(/^[-._]+|-+$/g, "").slice(0, 80);
}
/* "atual": valor que a linha já tem. Uma opção removida da lista só passa se já era o valor (ou uma das etiquetas). */
function validarValor(col, bruto, atual) {
  const vazio = bruto == null || bruto === "" || (Array.isArray(bruto) && !bruto.length);
  switch (col.tipo) {
    case "texto": case "textoLongo": case "pessoa": {
      const v = String(bruto == null ? "" : bruto).trim().slice(0, LIMITES[col.tipo]);
      if (col.id === idChave() && v && !chaveNumero(v)) return { ok: false, erro: `Use letras e números em ${col.nome}.` };
      return { ok: true, valor: v };
    }
    case "link": {
      const v = String(bruto || "").trim();
      if (v && !/^https?:\/\/[^\s"'<>]+$/i.test(v)) return { ok: false, erro: "Use um link que comece com https://" };
      return { ok: true, valor: v.slice(0, LIMITES.link) };
    }
    case "numero": {
      if (vazio || String(bruto).trim() === "") return { ok: true, valor: "" };
      if (typeof bruto === "number") return { ok: true, valor: bruto };
      const s = String(bruto).trim().replace(/\s/g, "");
      const n = Number(/,/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s);
      return isFinite(n) ? { ok: true, valor: n } : { ok: false, erro: "Número inválido." };
    }
    case "data": {
      let v = String(bruto || "").trim();
      if (!v) return { ok: true, valor: "" };
      if (normalizar(v) === "hoje") v = hojeIso();
      const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      if (br) v = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
      const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v);
      if (!iso || isNaN(Date.parse(iso[1] + "T12:00:00"))) return { ok: false, erro: "Data inválida (dd/mm/aaaa)." };
      return { ok: true, valor: iso[1] };
    }
    case "dataHora": {
      let v = String(bruto || "").trim();
      if (!v) return { ok: true, valor: "" };
      const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v);
      if (br) v = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T${(br[4] || "00").padStart(2, "0")}:${br[5] || "00"}`;
      const iso = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(v);
      if (!iso || isNaN(Date.parse(`${iso[1]}T${iso[2] || "00:00"}`))) return { ok: false, erro: "Data e hora inválidas (dd/mm/aaaa hh:mm)." };
      return { ok: true, valor: `${iso[1]}T${iso[2] || "00:00"}` };
    }
    case "lista": case "status": case "prioridade": {
      const v = String(bruto == null ? "" : bruto).trim();
      if (!v) return { ok: true, valor: "" };
      if (!estaVazio(atual) && v === atual && opcao(col, v)) return { ok: true, valor: v };
      const o = opcaoPeloTexto(col, v);
      if (o) return { ok: true, valor: o.id };
      const s = sugerirOpcao(col, v);
      const n = nomeComparavel(v);
      const removida = opcoesDe(col).find((x) => x.ativa === false && (x.id === v || nomeComparavel(x.nome) === n));
      if (removida) return { ok: false, erro: `“${removida.nome}” foi removido da lista de ${col.nome}: escolha outra opção ou deixe vazio.${s ? ` Você quis dizer “${s.nome}”?` : ""}`, sugestao: s, removida };
      return { ok: false, erro: `“${v}” não está na lista de ${col.nome}.${s ? ` Você quis dizer “${s.nome}”?` : ""}`, sugestao: s };
    }
    case "etiquetas": {
      const itens = (Array.isArray(bruto) ? bruto : String(bruto || "").split(/[,;|]/)).map((x) => String(x).trim()).filter(Boolean);
      const ja = new Set(Array.isArray(atual) ? atual : []);
      const ids = [], faltam = [], removidas = [];
      itens.forEach((x) => {
        const o = opcoesDe(col).find((y) => y.id === x || normalizar(y.nome) === normalizar(x));
        if (!o) faltam.push(x);
        else if (o.ativa === false && !ja.has(o.id)) removidas.push(o.nome);
        else ids.push(o.id);
      });
      if (faltam.length) return { ok: false, erro: `Fora da lista de ${col.nome}: ${faltam.join(", ")}.` };
      if (removidas.length) return { ok: false, erro: `Removido da lista de ${col.nome}: ${removidas.join(", ")}. Escolha outra opção ou deixe vazio.` };
      return { ok: true, valor: [...new Set(ids)].slice(0, 20) };
    }
    case "booleano": return { ok: true, valor: bruto === true || /^(sim|s|true|1|x)$/i.test(String(bruto == null ? "" : bruto).trim()) };
    default: return { ok: true, valor: bruto };
  }
}
const vazioDe = (col) => (col.tipo === "etiquetas" ? [] : col.tipo === "booleano" ? false : "");
const estaVazio = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
function valorPadrao(col) {
  if (!col.padrao) return vazioDe(col);
  if (col.tipo === "data" && col.padrao === "hoje") return hojeIso();
  if (col.tipo === "dataHora" && col.padrao === "agora") { const p = partesBrasilia(); return `${p.ano}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}`; }
  const r = validarValor(col, col.padrao);
  return r.ok ? r.valor : vazioDe(col);
}
/* Confere obrigatórias e únicas; "ignorar" = id do próprio registro */
function conferirRegistro(campos, ignorar) {
  const erros = {};
  colunasAtivas().forEach((c) => {
    if (TIPOS_SEM_EDICAO.includes(c.tipo)) return;
    const v = campos[c.id];
    if (c.obrigatoria && estaVazio(v) && !(c.somenteAdmin && !ehAdmin())) erros[c.id] = `${c.nome} é obrigatório.`;
    else if (c.unica && !estaVazio(v)) {
      const ehChave = c.id === idChave();
      const chave = ehChave ? chaveNumero(v) : normalizar(v);
      const outro = ehChave
        ? ticketsComNumero(chave).find((t) => t.id !== ignorar && !estaVazio((t.campos || {})[c.id]))
        : estado.tickets.find((t) => t.id !== ignorar && !estaVazio((t.campos || {})[c.id]) && normalizar(t.campos[c.id]) === chave);
      if (outro) erros[c.id] = { texto: `Já existe um registro com ${c.nome} “${valorTexto(outro, c)}”.`, id: outro.id };
    }
  });
  return erros;
}

/* ------------------------------------------------------------
 *  Permissões (as mesmas do firestore.rules): qualquer pessoa edita, menos as colunas
 *  "Só administradoras"; as linhas na lixeira não são editadas.
 * ------------------------------------------------------------ */
const podeEditarLinha = (t) => podeAlimentar() && !!t;
const podeEditarColuna = (col) => !!col && !TIPOS_SEM_EDICAO.includes(col.tipo) && (ehAdmin() || !col.somenteAdmin);
const podeEditarCelula = (t, col) => podeEditarLinha(t) && podeEditarColuna(col);
function motivoSemEdicao(t, col) {
  if (!conectado()) return "Sem conexão: a edição está bloqueada.";
  if (contaSemPermissao()) return "Esta conta não edita as planilhas. Saia da conta para editar com o seu nome.";
  if (col && TIPOS_SEM_EDICAO.includes(col.tipo)) return `“${col.nome}” é preenchido automaticamente.`;
  if (col && col.somenteAdmin && !ehAdmin()) return `${TEXTO_BLOQUEADO}: “${col.nome}”.`;
  return "Você não pode editar esta célula.";
}

/* ------------------------------------------------------------
 *  Visão de cada pessoa (colunas, larguras, filtros): só neste navegador
 * ------------------------------------------------------------ */
const VISTA_PADRAO = () => ({ colunas: colunasAtivas().map((c) => c.id), ocultas: [], larguras: {}, ordenar: { col: "", dir: 1 }, filtros: {}, agrupar: "", compacta: false, aba: "todos", especial: "" });
function carregarVista() {
  const salva = lerLocal(chaveUsuario("vista"), null);
  estado.vista = { ...VISTA_PADRAO(), ...(salva && typeof salva === "object" ? salva : {}) };
  ajustarVista();
  /* A planilha é sempre a grade: a preferência antiga "cartões" sai da visão e das visões salvas */
  if (salva && typeof salva === "object" && "cartoes" in salva) salvarVista();
  const visoes = lerLocal(chaveUsuario("visoes"), []);
  if (Array.isArray(visoes) && visoes.some((v) => v && v.vista && "cartoes" in v.vista)) {
    visoes.forEach((v) => { if (v && v.vista) delete v.vista.cartoes; });
    gravarLocal(chaveUsuario("visoes"), visoes);
  }
}
/* Colunas novas aparecem para todos; as que a pessoa ocultou continuam ocultas */
function ajustarVista() {
  const v = estado.vista;
  delete v.cartoes;
  const ativas = colunasAtivas().map((c) => c.id);
  v.ocultas = (v.ocultas || []).filter((c) => ativas.includes(c));
  v.colunas = (v.colunas || []).filter((c) => ativas.includes(c));
  ativas.forEach((c, i) => {
    if (v.colunas.includes(c) || v.ocultas.includes(c)) return;
    const anterior = ativas.slice(0, i).reverse().find((x) => v.colunas.includes(x));
    v.colunas.splice(anterior ? v.colunas.indexOf(anterior) + 1 : 0, 0, c);
  });
  if (!v.colunas.length) v.colunas = ativas.slice(0, 1);
  Object.keys(v.filtros || {}).forEach((c) => { if (!COL[c]) delete v.filtros[c]; });
  if (v.ordenar && v.ordenar.col && !COL[v.ordenar.col]) v.ordenar = { col: "", dir: 1 };
  if (v.agrupar && !COL[v.agrupar]) v.agrupar = "";
  if (v.aba !== "todos" && !abasDaPlanilha().some((a) => a.id === v.aba)) v.aba = "todos";
}
const salvarVista = () => gravarLocal(chaveUsuario("vista"), estado.vista);

/* ------------------------------------------------------------
 *  Filtrar, ordenar, agrupar
 * ------------------------------------------------------------ */
const COMPARAR = new Intl.Collator("pt-BR", { numeric: true }).compare;
let cacheBusca = new WeakMap();
function textoBusca(t) {
  let s = cacheBusca.get(t);
  if (s == null) {
    s = normalizar([nomeAutor(t, "criadoPor"), emailAutor(t, "criadoPor"), nomeAutor(t, "atualizadoPor"), ...colunasAtivas().map((c) => valorTexto(t, c))].join(" | "));
    cacheBusca.set(t, s);
  }
  return s;
}
function colDias() { return colunasAtivas().find((c) => c.tipo === "derivado" && c.formula === "diasEmAberto"); }
function emAbertoHaMaisDe(t, dias) {
  if (finalizado(t)) return false;
  const c = colDias();
  const n = c ? Number(diasEmAberto(t, c)) : Math.floor((Date.now() - Date.parse(t.criadoEm)) / 86400000);
  return n > dias;
}
/* "Crítico" = a última opção da coluna de prioridade (ex.: Crítica) */
function critico(t) {
  const p = colPorTipo("prioridade");
  if (!p || !p.opcoes.length || finalizado(t)) return false;
  return (t.campos || {})[p.id] === p.opcoes[p.opcoes.length - 1].id;
}
function passaEspecial(t, especial) {
  if (!especial) return true;
  if (especial.startsWith("status:")) { const st = colPorTipo("status"); return !!st && (t.campos || {})[st.id] === especial.slice(7); }
  if (especial === "abertos") return !finalizado(t);
  if (especial === "atrasados") return emAbertoHaMaisDe(t, 7);
  if (especial === "criticos") return critico(t);
  if (especial === "hoje") return !!t.criadoEm && dataIsoBrasilia(t.criadoEm) === hojeIso();
  if (especial === "meus") return !!autorAtual() && t.criadoPor === autorAtual();
  return true;
}
/* Abas que filtram: as opções de uma coluna de lista escolhida na Estrutura (Abas e resumo) */
const colAbas = () => {
  const id = estado.estrutura && estado.estrutura.abas && estado.estrutura.abas.coluna;
  const c = id && COL[id];
  return c && c.ativa && ["lista", "status", "prioridade"].includes(c.tipo) ? c : null;
};
/* Uma opção removida da lista continua formando a sua aba enquanto tiver linhas */
function abasDaPlanilha() {
  const c = colAbas();
  if (!c) return [];
  const usadas = new Set(estado.tickets.map((t) => (t.campos || {})[c.id]).filter(Boolean));
  return opcoesDe(c).filter((o) => o.ativa !== false || usadas.has(o.id)).map((o) => ({ id: o.id, nome: o.nome, cor: o.cor, removida: o.ativa === false ? o : null }));
}
function naAba(t) {
  const c = colAbas();
  return estado.vista.aba === "todos" || !c || (t.campos || {})[c.id] === estado.vista.aba;
}
function ticketsFiltrados() {
  const vista = estado.vista;
  let l = estado.tickets.filter((t) => naAba(t) && passaEspecial(t, vista.especial));
  const termos = normalizar(estado.busca).split(/\s+/).filter(Boolean);
  if (termos.length) l = l.filter((t) => { const s = textoBusca(t); return termos.every((x) => s.includes(x)); });
  Object.entries(vista.filtros || {}).forEach(([c, f]) => {
    const col = COL[c];
    if (!col || !f) return;
    if (Array.isArray(f.valores) && f.valores.length) {
      const set = new Set(f.valores);
      l = l.filter((t) => {
        if (col.tipo === "etiquetas") { const v = valorBruto(t, col) || []; return v.length ? v.some((x) => set.has((opcao(col, x) || { nome: x }).nome)) : set.has("(vazio)"); }
        return set.has(valorTexto(t, col) || "(vazio)");
      });
    }
    if (f.texto) { const n = normalizar(f.texto); l = l.filter((t) => normalizar(valorTexto(t, col)).includes(n)); }
  });
  const { col: c, dir } = vista.ordenar || {};
  const col = c && COL[c];
  if (col) {
    const ordemOpcoes = TIPOS_LISTA.includes(col.tipo) && col.tipo !== "etiquetas" ? opcoesDe(col).map((o) => o.id) : null;
    const chave = (t) => {
      const v = valorBruto(t, col);
      if (estaVazio(v)) return null;
      if (ordemOpcoes) return ordemOpcoes.indexOf(v) + 1 || 999;
      if (col.tipo === "numero" || col.tipo === "derivado") return Number(v);
      if (["data", "dataHora"].includes(col.tipo) || (col.tipo === "automatico" && /Em$/.test(col.auto))) return String(v);
      return normalizar(valorTexto(t, col));
    };
    l = l.map((t) => [chave(t), t]).sort(([x], [y]) => {
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
      if (x == null) return 0;
      return (typeof x === "number" ? x - y : COMPARAR(String(x), String(y))) * dir;
    }).map(([, t]) => t);
  } else {
    /* Registros mais recentes primeiro; as linhas do arquivo (sem data de registro) mantêm a ordem da planilha */
    l = [...l].sort((a, b) => { const x = b.criadoEm || "", y = a.criadoEm || ""; return x < y ? -1 : x > y ? 1 : 0; });
  }
  return l;
}
function montarLinhas() {
  const filtrados = ticketsFiltrados();
  estado.filtrados = filtrados;
  const g = estado.vista.agrupar && COL[estado.vista.agrupar];
  if (!g) return filtrados.map((t) => ({ tipo: "linha", t }));
  const grupos = new Map();
  filtrados.forEach((t) => {
    let chaves;
    if (g.tipo === "etiquetas") { const v = valorBruto(t, g) || []; chaves = v.length ? v.map((x) => (opcao(g, x) || { nome: x }).nome) : [`(sem ${g.nome.toLowerCase()})`]; }
    else chaves = [valorTexto(t, g) || `(sem ${g.nome.toLowerCase()})`];
    chaves.forEach((k) => { if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(t); });
  });
  const ordem = TIPOS_LISTA.includes(g.tipo) ? opcoesDe(g).map((o) => o.nome) : null;
  const removidas = new Map(TIPOS_LISTA.includes(g.tipo) ? opcoesDe(g).filter((o) => o.ativa === false).map((o) => [o.nome, o]) : []);
  const chaves = [...grupos.keys()].sort((a, b) => (ordem ? ((ordem.indexOf(a) + 1 || 999) - (ordem.indexOf(b) + 1 || 999)) : 0) || a.localeCompare(b, "pt-BR"));
  const linhas = [];
  chaves.forEach((k) => {
    const fechado = estado.gruposFechados.has(k);
    linhas.push({ tipo: "grupo", chave: k, n: grupos.get(k).length, fechado, removida: removidas.get(k) || null });
    if (!fechado) grupos.get(k).forEach((t) => linhas.push({ tipo: "linha", t }));
  });
  return linhas;
}

/* ------------------------------------------------------------
 *  Resumo (clicável = filtra) e abas de categoria
 * ------------------------------------------------------------ */
function renderizarResumo() {
  const caixa = $("#resumo");
  if (estado.estrutura.resumo && estado.estrutura.resumo.mostrar === false) { caixa.innerHTML = ""; return; }
  const base = estado.tickets.filter(naAba);
  const esp = estado.vista.especial;
  const botao = (chave, conteudo, titulo) => `<button type="button" data-especial="${escapar(chave)}" aria-pressed="${esp === chave}" title="${escapar(titulo)}">${conteudo}</button>`;
  const partes = [botao("", `Total <strong>${base.length.toLocaleString("pt-BR")}</strong>`, "Mostrar todas as linhas (tira o filtro do resumo)")];
  const st = colPorTipo("status");
  if (st) {
    partes.push('<span class="sep-resumo" aria-hidden="true"></span>');
    opcoesDe(st).forEach((o) => {
      const n = base.filter((t) => (t.campos || {})[st.id] === o.id).length;
      if (o.ativa === false && !n) return;
      partes.push(botao(`status:${o.id}`, `<span class="ponto-cor${o.cor ? " cor-" + o.cor : ""}"></span>${escapar(o.nome)}${marcaRemovida(o)} <strong>${n}</strong>`, `Filtrar ${st.nome}: ${o.nome}`));
    });
  }
  if (st || colDias()) partes.push(botao("atrasados", `${svg("i-relogio")}Em aberto há mais de 7 dias <strong>${base.filter((t) => emAbertoHaMaisDe(t, 7)).length}</strong>`, "Em aberto há mais de 7 dias"));
  if (colPorTipo("prioridade")) partes.push(botao("criticos", `${svg("i-alerta")}Críticos em aberto <strong>${base.filter(critico).length}</strong>`, "Prioridade mais alta e ainda em aberto"));
  const hoje = hojeIso();
  partes.push(botao("hoje", `${svg("i-calendario")}Registrados hoje <strong>${base.filter((t) => t.criadoEm && dataIsoBrasilia(t.criadoEm) === hoje).length}</strong>`, "Registrados hoje (horário de Brasília)"));
  caixa.innerHTML = partes.join("");
}
$("#resumo").addEventListener("click", (e) => {
  const ar = e.target.closest("[data-aba-resumo]");
  if (ar) { estado.vista.aba = estado.vista.aba === ar.dataset.abaResumo ? "todos" : ar.dataset.abaResumo; salvarVista(); renderizarTudo(); return; }
  const b = e.target.closest("[data-especial]");
  if (!b) return;
  estado.vista.especial = estado.vista.especial === b.dataset.especial ? "" : b.dataset.especial;
  salvarVista();
  renderizarTudo();
});
function renderizarAbas() {
  const cat = colAbas();
  const abas = $("#abas");
  if (!cat) { abas.hidden = true; return; }
  abas.hidden = false;
  abas.setAttribute("aria-label", colCategoria() ? "Categorias" : cat.nome);
  const lista = [{ id: "todos", nome: "Todos", cor: "" }, ...abasDaPlanilha()];
  const contagem = new Map();
  estado.tickets.forEach((t) => { const v = (t.campos || {})[cat.id]; if (v) contagem.set(v, (contagem.get(v) || 0) + 1); });
  const contar = (id) => (id === "todos" ? estado.tickets.length : contagem.get(id) || 0);
  abas.innerHTML = lista.map((a) => `<button type="button" class="aba-grupo" role="tab" data-aba="${escapar(a.id)}" aria-selected="${estado.vista.aba === a.id}" tabindex="${estado.vista.aba === a.id ? 0 : -1}">${a.id === "todos" ? "" : `<span class="ponto-cor${a.cor ? " cor-" + a.cor : ""}"></span>`}${escapar(a.nome)}${marcaRemovida(a.removida)}<span class="n">${contar(a.id)}</span></button>`).join("");
}
$("#abas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-aba]");
  if (!b) return;
  estado.vista.aba = b.dataset.aba;
  salvarVista();
  renderizarTudo();
});
$("#abas").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const bs = $$("[data-aba]", $("#abas"));
  const i = bs.findIndex((b) => b.dataset.aba === estado.vista.aba);
  const n = bs[(i + (e.key === "ArrowRight" ? 1 : -1) + bs.length) % bs.length];
  n.click();
  $(`[data-aba="${CSS.escape(n.dataset.aba)}"]`).focus();
});

/* ------------------------------------------------------------
 *  Visões prontas e salvas (por pessoa, neste navegador)
 * ------------------------------------------------------------ */
const VISOES_PRONTAS = {
  padrao: { nome: "Todos os registros", especial: "" },
  abertos: { nome: "Em aberto", especial: "abertos" },
  meus: { nome: "Registrados por mim", especial: "meus" }
};
function renderizarVisoes() {
  const salvas = lerLocal(chaveUsuario("visoes"), []);
  $("#visao").innerHTML = `<optgroup label="Visões prontas">${Object.entries(VISOES_PRONTAS).map(([id, v]) => `<option value="${id}"${estado.visao === id ? " selected" : ""}>${escapar(v.nome)}</option>`).join("")}</optgroup>
    ${salvas.length ? `<optgroup label="Minhas visões">${salvas.map((v, i) => `<option value="salva-${i}"${estado.visao === "salva-" + i ? " selected" : ""}>${escapar(v.nome)}</option>`).join("")}</optgroup>` : ""}
    <optgroup label="Ações"><option value="__salvar">Salvar visão atual…</option>${salvas.length ? '<option value="__excluir">Excluir uma visão salva…</option>' : ""}</optgroup>`;
}
$("#visao").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "__salvar") {
    const d = criarDialogo({ titulo: "Salvar visão", corpo: `<label class="campo"><span class="rotulo">Nome da visão</span><input name="nome" maxlength="40" required></label>
      <p class="apoio">Guarda colunas, ordem, filtros e agrupamento só para você, neste navegador.</p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn" type="submit">Salvar</button></div>` });
    d.querySelector("form").addEventListener("submit", (ev) => {
      const nome = ev.target.nome.value.trim();
      if (!nome) { ev.preventDefault(); return; }
      const salvas = lerLocal(chaveUsuario("visoes"), []);
      salvas.push({ nome, vista: JSON.parse(JSON.stringify(estado.vista)) });
      gravarLocal(chaveUsuario("visoes"), salvas.slice(-20));
      estado.visao = "salva-" + (Math.min(salvas.length, 20) - 1);
      mostrarAviso("Visão salva.");
    });
    d.addEventListener("close", renderizarVisoes);
    d.showModal();
    return;
  }
  if (v === "__excluir") {
    const salvas = lerLocal(chaveUsuario("visoes"), []);
    const d = criarDialogo({ titulo: "Excluir visão salva", corpo: `<div style="display:grid;gap:6px">${salvas.map((s, i) => `<button type="button" class="btn btn-secundario" data-exc="${i}">${svg("i-lixeira")}${escapar(s.nome)}</button>`).join("")}</div>` });
    d.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-exc]");
      if (!b) return;
      salvas.splice(Number(b.dataset.exc), 1);
      gravarLocal(chaveUsuario("visoes"), salvas);
      estado.visao = "padrao";
      d.close();
    });
    d.addEventListener("close", renderizarVisoes);
    d.showModal();
    return;
  }
  aplicarVisao(v);
});
function aplicarVisao(id) {
  if (VISOES_PRONTAS[id]) estado.vista = { ...estado.vista, filtros: {}, ordenar: { col: "", dir: 1 }, agrupar: "", especial: VISOES_PRONTAS[id].especial };
  else if (id.startsWith("salva-")) {
    const s = lerLocal(chaveUsuario("visoes"), [])[Number(id.slice(6))];
    if (s) estado.vista = { ...VISTA_PADRAO(), ...s.vista };
  }
  estado.visao = id;
  ajustarVista();
  salvarVista();
  renderizarTudo();
}

/* ------------------------------------------------------------
 *  Renderização: planilha virtualizada (sempre a grade, também no celular)
 * ------------------------------------------------------------ */
const areaDados = $("#area-dados");
const LARGURA_ACOES = 74;
/* Largura MÍNIMA da coluna (a que a pessoa arrastou, ou a da estrutura), sem a escala do "Tamanho" */
const largura = (c) => Number(estado.vista.larguras[c]) || (COL[c] ? COL[c].largura : 150);
/* "Tamanho" da grade e dos cartões (por pessoa e planilha): fontes, alturas e larguras mínimas, sempre em px inteiros */
const ESCALAS = [0.85, 1, 1.15, 1.3];
const escala = () => (estado.vista && ESCALAS.includes(Number(estado.vista.escala)) ? Number(estado.vista.escala) : 1);
const emEscala = (n) => Math.round(n * escala());
const alturaLinha = () => emEscala(estado.vista.compacta ? 32 : 40);
const ajustarLarguras = () => estado.vista.ajustarLarguras !== false;
/* Peso de cada tipo na divisão da sobra de largura (a 1ª coluna e Ações não crescem) */
const PESO_TIPO = { textoLongo: 3, texto: 2, pessoa: 2, link: 2, lista: 1.5, etiquetas: 1.5, status: 1.5, prioridade: 1.5 };
const pesoColuna = (col) => (col && PESO_TIPO[col.tipo] != null ? PESO_TIPO[col.tipo] : 0.5);
/* Larguras efetivas: a mínima de cada coluna e, sobrando espaço na caixa, a sobra dividida por peso.
   O resto do arredondamento vai para a coluna de maior peso, para fechar exatamente na borda. */
function largurasEfetivas(cols, disponivel) {
  const ws = cols.map((c) => emEscala(largura(c)));
  const acoes = emEscala(LARGURA_ACOES);
  const sobra = Math.floor(disponivel) - ws.reduce((s, w) => s + w, 0) - acoes;
  if (ajustarLarguras() && sobra > 0 && cols.length) {
    const pesos = cols.map((c, i) => (i === 0 ? 0 : pesoColuna(COL[c])));
    if (!pesos.some((p) => p > 0)) pesos[0] = 1;
    const totalPesos = pesos.reduce((s, p) => s + p, 0);
    let usado = 0;
    pesos.forEach((p, i) => { const extra = Math.floor((sobra * p) / totalPesos); ws[i] += extra; usado += extra; });
    ws[pesos.indexOf(Math.max(...pesos))] += sobra - usado;
  }
  return { ws, acoes, total: ws.reduce((s, w) => s + w, 0) + acoes };
}
function aplicarLarguras(planilha, cols) {
  const { ws, acoes, total } = largurasEfetivas(cols, planilha.clientWidth);
  const colunas = ws.map((w) => w + "px").join(" ") + ` ${acoes}px`;
  if (planilha.style.getPropertyValue("--colunas") !== colunas) planilha.style.setProperty("--colunas", colunas);
  if (planilha.style.getPropertyValue("--largura-total") !== total + "px") planilha.style.setProperty("--largura-total", total + "px");
  estado.largurasEfetivas = Object.fromEntries(cols.map((c, i) => [c, ws[i]]));
}
/* Alturas da grade (linhas, cabeçalhos) em px inteiros, na escala escolhida: bordas nítidas em qualquer zoom */
function aplicarMedidas(planilha) {
  areaDados.style.setProperty("--escala", String(escala()));
  planilha.style.setProperty("--alt", alturaLinha() + "px");
  planilha.style.setProperty("--alt-cab", emEscala(38) + "px");
  planilha.style.setProperty("--alt-grupos-base", emEscala(26) + "px");
}
/* O cabeçalho de colunas gruda logo abaixo da faixa de grupos: a distância é a altura medida dessa faixa */
function medirCabecalho(planilha) {
  const g = $(".cab-grupos", planilha);
  const alt = Math.round(g ? g.getBoundingClientRect().height : 26) + "px";
  if (planilha.style.getPropertyValue("--alt-grupos") !== alt) planilha.style.setProperty("--alt-grupos", alt);
}
const topoGrade = (planilha) => ["cab-grupos", "cab"].reduce((s, c) => { const el = $("." + c, planilha); return s + (el ? el.offsetHeight : 0); }, 0);
/* Altura da caixa: abraça o conteúdo (poucas linhas) ou vai até o fim da tela (muitas), com rolagem só dentro dela */
function ajustarAltura() {
  const p = $("#planilha");
  if (!p || !p.isConnected) return;
  const vh = window.visualViewport ? visualViewport.height : innerHeight;
  const rolagem = (document.scrollingElement || document.documentElement).scrollTop;
  const pagina = p.closest(".pagina");
  const margem = pagina ? parseFloat(getComputedStyle(pagina).paddingBottom) || 0 : 0;
  const disponivel = Math.floor(vh - (p.getBoundingClientRect().top + rolagem) - margem);
  const conteudo = [".cab-grupos", ".cab", ".corpo", ".linha-nova"].reduce((s, sel) => { const el = $(sel, p); return s + (el && !el.hidden ? el.offsetHeight : 0); }, 0)
    + (p.offsetHeight - p.clientHeight);
  const altura = Math.round(Math.max(Math.min(220, conteudo), Math.min(conteudo, disponivel)));
  if (p.style.height !== altura + "px") p.style.height = altura + "px";
}
/* Larguras e altura juntas: a barra de rolagem vertical que aparece (ou some) muda a largura útil */
function ajustarGrade() {
  const p = $("#planilha");
  if (!p) return;
  const cols = estado.vista.colunas.filter((c) => COL[c]);
  medirCabecalho(p);
  for (let i = 0; i < 3; i++) {
    const antes = p.clientWidth;
    aplicarLarguras(p, cols);
    ajustarAltura();
    if (p.clientWidth === antes) break;
  }
}
/* Zoom do navegador, janela e "Tamanho": tudo passa por um só ajuste por quadro (sem laço de ResizeObserver) */
let pedidoAjuste = 0;
function agendarAjuste() { cancelAnimationFrame(pedidoAjuste); pedidoAjuste = requestAnimationFrame(reajustar); }
function reajustar() {
  if (!estado.vista || !estado.estrutura || $("#app").hidden) return;
  const p = $("#planilha");
  if (!p) return;
  if (estado.editando) { renderPendente = true; ajustarAltura(); return; }
  const h = alturaLinha(), primeira = Math.floor(p.scrollTop / h);
  ajustarGrade();
  if (Math.floor(p.scrollTop / h) !== primeira) p.scrollTop = primeira * h;
  pintarLinhas(true);
}
function ligarObservadores() {
  const ro = new ResizeObserver(agendarAjuste);
  ro.observe(areaDados);
  if (areaDados.parentElement) ro.observe(areaDados.parentElement);
  window.addEventListener("resize", agendarAjuste);
  if (window.visualViewport) visualViewport.addEventListener("resize", agendarAjuste);
  /* Mudança de devicePixelRatio (zoom do navegador): a consulta é renovada a cada mudança */
  const ouvirZoom = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener("change", () => { agendarAjuste(); ouvirZoom(); }, { once: true });
  ouvirZoom();
}
ligarObservadores();
/* Controle "Tamanho" na barra (− / 100% / +) e atalhos Ctrl+Alt+= / Ctrl+Alt+− / Ctrl+Alt+0 com o foco na planilha */
$("#btn-densidade").insertAdjacentHTML("afterend", `<div class="tamanho-grade" role="group" aria-label="Tamanho da planilha">
  <button type="button" data-tamanho="-1" title="Diminuir a planilha (Ctrl+Alt+−)" aria-label="Diminuir a planilha">−</button>
  <button type="button" data-tamanho="0" class="tamanho-atual" title="Tamanho normal (Ctrl+Alt+0)" aria-label="Tamanho da planilha: 100%. Voltar ao normal">100%</button>
  <button type="button" data-tamanho="1" title="Aumentar a planilha (Ctrl+Alt+=)" aria-label="Aumentar a planilha">+</button></div>`);
function atualizarTamanho() {
  const i = ESCALAS.indexOf(escala()), pct = Math.round(escala() * 100) + "%";
  const atual = $(".tamanho-grade .tamanho-atual");
  atual.textContent = pct;
  atual.setAttribute("aria-label", `Tamanho da planilha: ${pct}. Voltar ao normal`);
  $('.tamanho-grade [data-tamanho="-1"]').disabled = i <= 0;
  $('.tamanho-grade [data-tamanho="1"]').disabled = i >= ESCALAS.length - 1;
}
function mudarEscala(passo) {
  if (!estado.vista) return;
  const i = ESCALAS.indexOf(escala());
  const nova = passo === 0 ? 1 : ESCALAS[Math.max(0, Math.min(ESCALAS.length - 1, i + passo))];
  if (nova === escala()) return;
  const p = $("#planilha");
  const primeira = p ? Math.floor(p.scrollTop / alturaLinha()) : 0;
  estado.vista.escala = nova;
  salvarVista();
  renderizarTudo();
  const p2 = $("#planilha");
  if (p2) { p2.scrollTop = primeira * alturaLinha(); pintarLinhas(true); }
  mostrarAviso(`Tamanho da planilha: ${Math.round(nova * 100)}%`, 1500);
}
$(".tamanho-grade").addEventListener("click", (e) => { const b = e.target.closest("[data-tamanho]"); if (b) mudarEscala(Number(b.dataset.tamanho)); });
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey || $("#app").hidden || document.querySelector("dialog[open]")) return;
  if (!areaDados.contains(document.activeElement) && !e.target.closest(".tamanho-grade")) return;
  const passo = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1, Digit0: 0, Numpad0: 0 }[e.code];
  if (passo === undefined) return;
  e.preventDefault();
  mudarEscala(passo);
});
let renderPendente = false;
/* Enquanto alguém edita uma célula, as mudanças que chegam esperam o fim da edição */
function agendarRender() {
  if (estado.editando) { renderPendente = true; return; }
  renderPendente = false;
  renderizarTudo();
}
function renderizarTudo() {
  if (!estado.estrutura || !estado.vista) return;
  estado.linhas = montarLinhas();
  renderizarResumo();
  renderizarAbas();
  renderizarVisoes();
  const agrupaveis = colunasAtivas().filter((c) => [...TIPOS_LISTA, "pessoa", "booleano"].includes(c.tipo) || (c.tipo === "automatico" && /Por$/.test(c.auto)));
  $("#agrupar").innerHTML = `<option value="">Sem agrupar</option>${agrupaveis.map((c) => `<option value="${escapar(c.id)}"${estado.vista.agrupar === c.id ? " selected" : ""}>Agrupar por ${escapar(c.nome)}</option>`).join("")}`;
  $("#btn-densidade").setAttribute("aria-pressed", String(!!estado.vista.compacta));
  $("#btn-selecionar").setAttribute("aria-pressed", String(estado.selecionando));
  const n = estado.filtrados.length, total = estado.tickets.length;
  const filtrosAtivos = Object.values(estado.vista.filtros || {}).some((f) => f && ((f.valores && f.valores.length) || f.texto)) || estado.busca || estado.vista.especial;
  $("#contagem").textContent = `${n.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} linha${total === 1 ? "" : "s"}`;
  $("#btn-limpar-filtros").disabled = !filtrosAtivos;
  renderizarSelecao();
  atualizarTamanho();
  areaDados.style.setProperty("--escala", String(escala()));
  renderizarPlanilha();
}

function renderizarPlanilha() {
  const cols = estado.vista.colunas.filter((c) => COL[c]);
  let planilha = $("#planilha");
  const valoresNova = lerLinhaNova();
  if (!planilha) {
    areaDados.innerHTML = `<div class="planilha" id="planilha" role="grid" aria-label="Planilha de tickets" tabindex="0">
      <div class="cab-grupos" aria-hidden="true"></div><div class="cab" role="row"></div><div class="corpo" role="rowgroup"></div><div class="linha-nova" role="row" hidden></div></div>`;
    planilha = $("#planilha");
    ligarPlanilha(planilha);
  }
  planilha.classList.toggle("compacta", !!estado.vista.compacta);
  aplicarMedidas(planilha);
  if (!planilha.style.getPropertyValue("--colunas")) aplicarLarguras(planilha, cols);
  planilha.setAttribute("aria-rowcount", String(estado.filtrados.length + 1));
  const faixas = [];
  cols.forEach((c, i) => {
    const g = COL[c].grupo;
    if (faixas.length && faixas[faixas.length - 1].g === g) faixas[faixas.length - 1].n++;
    else faixas.push({ g, n: 1, primeira: i === 0 });
  });
  $(".cab-grupos", planilha).innerHTML = faixas.map((f) => `<div class="cab-grupo${f.primeira ? " fixa" : ""}" style="grid-column: span ${f.n}">${escapar(nomeGrupo(f.g))}</div>`).join("") + `<div class="cab-grupo col-acoes"></div>`;
  const ord = estado.vista.ordenar || {};
  $(".cab", planilha).innerHTML = cols.map((c, i) => {
    const col = COL[c];
    const f = (estado.vista.filtros || {})[c];
    const ativo = f && ((f.valores && f.valores.length) || f.texto);
    const sort = ord.col === c ? (ord.dir > 0 ? "ascending" : "descending") : "none";
    const trava = !podeEditarColuna(col) && !TIPOS_SEM_EDICAO.includes(col.tipo) ? svg("i-cadeado", "icone cadeado") : "";
    return `<div class="cab-celula${i === 0 ? " fixa" : ""}" role="columnheader" aria-sort="${sort}" data-col="${escapar(c)}" ${i === 0 ? "" : 'draggable="true"'} title="${escapar([col.ajuda || col.nome, col.somenteAdmin && !ehAdmin() ? TEXTO_BLOQUEADO : ""].filter(Boolean).join(" · "))}">
      <button type="button" class="cab-ordenar" data-ordenar="${escapar(c)}" title="Ordenar por ${escapar(col.nome)}">${trava}<span>${escapar(col.nome)}</span>${sort !== "none" ? svg(sort === "ascending" ? "i-seta-cima" : "i-seta-baixo") : ""}</button>
      <button type="button" class="cab-filtro${ativo ? " ativo" : ""}" data-filtrar="${escapar(c)}" aria-label="Filtrar ${escapar(col.nome)}">${svg("i-filtro")}</button>
      <span class="cab-redim" data-redim="${escapar(c)}" aria-hidden="true"></span></div>`;
  }).join("") + `<div class="cab-celula col-acoes" role="columnheader">Ações</div>`;
  const corpo = $(".corpo", planilha);
  /* Sem linhas, o corpo tem a altura da mensagem (a caixa não estica) */
  corpo.style.height = estado.linhas.length ? estado.linhas.length * alturaLinha() + "px" : "";
  if (!estado.linhas.length) corpo.innerHTML = `<div class="vazio">${escapar(textoVazio())}</div>`;
  estado.ultimoIntervalo = null;
  renderizarLinhaNova(cols, valoresNova);
  ajustarGrade();
  pintarLinhas(true);
}
function textoVazio() {
  if (!estado.carregouTickets) return "Carregando os registros…";
  if (estado.tickets.length) return "Nenhum registro com esses filtros.";
  return podeAlimentar() ? "Nenhuma linha ainda. Use “Nova linha”, “Colar do Excel” ou a linha no fim da planilha." : "Nenhuma linha ainda.";
}
function htmlAcoes(t) {
  return `<button type="button" class="acao-linha" data-acao="ficha" title="Ver ficha completa" aria-label="Ver ficha do registro ${escapar(t.numero || "")}">${svg("i-olho")}</button>
    <button type="button" class="acao-linha" data-acao="mais" title="Mais ações" aria-label="Mais ações">⋯</button>`;
}
/* Uma linha da grade (dados ou grupo). "par" faz a listra pelo índice: na rolagem, a ordem no DOM não segue a posição */
const chaveLinha = (l) => (l.tipo === "grupo" ? "g:" + l.chave : l.t.id);
function htmlLinha(i, l, cols, h) {
    if (l.tipo === "grupo") {
    return `<div class="linha-grupo${l.fechado ? " fechado" : ""}" style="top:${i * h}px" data-i="${i}" data-chave="${escapar(chaveLinha(l))}" data-grupo="${escapar(l.chave)}" role="row" aria-expanded="${!l.fechado}"><span class="rot">${svg("i-chevron-baixo")}${escapar(l.chave)}${marcaRemovida(l.removida)} <span class="selo">${l.n}</span></span></div>`;
    }
    const t = l.t;
    const editavel = podeEditarLinha(t);
    const sel = estado.selecionados.has(t.id);
  const iv = estado.intervalo && estado.intervalo.set.has(t.id) ? estado.intervalo.col : null;
  /* Regras de cor e cor das opções na célula inteira (classes calculadas uma vez por linha) */
  const ap = aparencia ? aparencia.daLinha(t) : SEM_APARENCIA;
  return `<div class="linha${i % 2 ? " par" : ""}${piscando(t.id) ? " piscou" : ""}${sel ? " selecionada" : ""}${t.exclusao ? " pedido-exclusao" : ""}${ap.l}" style="top:${i * h}px" role="row" aria-rowindex="${i + 2}" data-i="${i}" data-chave="${escapar(t.id)}" data-id="${escapar(t.id)}">` +
      cols.map((c, j) => {
        const col = COL[c];
        const travada = !editavel || !podeEditarColuna(col);
        const extra = j === 0 ? `${estado.selecionando ? `<input type="checkbox" class="sel-linha" data-sel="${escapar(t.id)}"${sel ? " checked" : ""} aria-label="Selecionar linha">` : ""}${t.exclusao ? '<span class="selo-exclusao" title="Exclusão solicitada">Exclusão solicitada</span>' : ""}` : "";
      /* Célula sem permissão: o motivo fica no title (um clique só seleciona, sem aviso a cada clique) */
      const titulo = [tituloCelula(t, col).slice(0, 300), travada ? motivoSemEdicao(t, col) : ""].filter(Boolean).join(" · ");
      return `<div class="celula${j === 0 ? " fixa" : ""}${travada ? " travada" : ""}${iv === c ? " no-intervalo" : ""}${ap.c[c] || ""}" role="gridcell" tabindex="-1" data-col="${escapar(c)}" title="${escapar(titulo)}">${extra}${htmlValor(t, col)}</div>`;
      }).join("") +
      `<div class="celula col-acoes">${htmlAcoes(t)}</div></div>`;
  }
/* Virtualização: só as linhas visíveis existem no DOM. Na rolagem, as que continuam visíveis NÃO são recriadas
   (um clique ou a edição não perdem o elemento no meio do caminho); "forcar" redesenha tudo (dados mudaram). */
function pintarLinhas(forcar) {
  const planilha = $("#planilha");
  if (!planilha || !estado.linhas.length) return;
  const h = alturaLinha();
  const topoCorpo = topoGrade(planilha);
  const inicio = Math.max(0, Math.floor((planilha.scrollTop - topoCorpo) / h) - 8);
  const fim = Math.min(estado.linhas.length, Math.ceil((planilha.scrollTop + planilha.clientHeight) / h) + 8);
  if (!forcar && estado.ultimoIntervalo && estado.ultimoIntervalo[0] === inicio && estado.ultimoIntervalo[1] === fim) return;
  estado.ultimoIntervalo = [inicio, fim];
  const focoNaGrade = planilha.contains(document.activeElement) && document.activeElement.classList.contains("celula");
  const cols = estado.vista.colunas.filter((c) => COL[c]);
  const corpo = $(".corpo", planilha);
  /* O editor da célula fica dentro da linha: durante a edição só entram e saem linhas, a editada fica */
  if (forcar && estado.editando) { renderPendente = true; forcar = false; }
  if (forcar) {
    let html = "";
    for (let i = inicio; i < fim; i++) html += htmlLinha(i, estado.linhas[i], cols, h);
    corpo.innerHTML = html;
  } else {
    const ficam = new Set();
    [...corpo.children].forEach((el) => {
      const i = Number(el.dataset.i);
      const l = el.dataset.i != null ? estado.linhas[i] : null;
      if ((l && i >= inicio && i < fim && el.dataset.chave === chaveLinha(l)) || el.querySelector(".editor-celula")) ficam.add(i);
      else el.remove();
    });
    let html = "";
    for (let i = inicio; i < fim; i++) if (!ficam.has(i)) html += htmlLinha(i, estado.linhas[i], cols, h);
    if (html) corpo.insertAdjacentHTML("beforeend", html);
  }
  if (estado.celula) {
    const el = celulaEl(estado.celula.id, estado.celula.col);
    if (el) { el.classList.add("ativa"); el.tabIndex = 0; if (focoNaGrade && !el.contains(document.activeElement)) el.focus({ preventScroll: true }); }
  }
}
const celulaEl = (id, col) => $(`.linha[data-id="${CSS.escape(id)}"] .celula[data-col="${CSS.escape(col)}"]`);

/* Linha nova fixa no fim da grade: digite e aperte Enter para registrar (e já começar a próxima) */
const podeNaLinhaNova = (col) => !TIPOS_SEM_EDICAO.includes(col.tipo) && (ehAdmin() || !col.somenteAdmin);
function lerLinhaNova() {
  const r = {};
  $$("#planilha .linha-nova [data-nova]").forEach((el) => { r[el.dataset.nova] = el.value; });
  return r;
}
function campoEntrada(col, valor, atributos) {
  const opcoes = opcoesParaEscolha(col, valor);
  if (col.tipo === "lista") return comboLista(col, valor, atributos);
  if (["status", "prioridade"].includes(col.tipo)) {
    const solto = !estaVazio(valor) && !opcao(col, valor) ? `<option value="${escapar(valor)}" selected>${escapar(valor)} (fora da lista)</option>` : "";
    const removida = opcaoRemovida(col, valor);
    return `<select ${atributos} data-original="${escapar(valor || "")}"${removida ? ` title="${escapar(textoRemovida(removida))}"` : ""}><option value="">—</option>${solto}${opcoes.map((o) => `<option value="${escapar(o.id)}"${o.id === valor ? " selected" : ""}>${escapar(rotuloEscolha(o))}</option>`).join("")}</select>`;
  }
  if (col.tipo === "booleano") return `<select ${atributos}><option value="">Não</option><option value="sim"${valor === true || valor === "sim" ? " selected" : ""}>Sim</option></select>`;
  if (col.tipo === "data") return valor && !/^\d{4}-\d{2}-\d{2}$/.test(valor)
    ? `<input ${atributos} value="${escapar(valor)}" data-original="${escapar(valor)}" placeholder="dd/mm/aaaa" maxlength="60">`
    : `<input type="date" ${atributos} value="${escapar(valor || "")}">`;
  if (col.tipo === "dataHora") return `<input type="datetime-local" ${atributos} value="${escapar(valor || "")}">`;
  if (col.tipo === "numero") return `<input inputmode="decimal" ${atributos} value="${escapar(valor ?? "")}">`;
  if (col.tipo === "etiquetas") return `<input ${atributos} value="${escapar(Array.isArray(valor) ? valor.map((x) => (opcao(col, x) || { nome: x }).nome).join(", ") : valor || "")}" placeholder="${escapar(opcoesAtivas(col).slice(0, 3).map((o) => o.nome).join(", "))}…">`;
  return `<input ${atributos} value="${escapar(valor || "")}" maxlength="${LIMITES[col.tipo] || 300}"${col.tipo === "link" ? ' type="url" placeholder="https://"' : ""}>`;
}
/* Valor antigo que não passaria na validação (data "27/007/2024", opção fora da lista): se não mudou, fica como está */
const valorOriginalMantido = (el, col) => (col.tipo === "data" || TIPOS_LISTA.includes(col.tipo)) && !!el && !!el.dataset && el.dataset.original != null && el.dataset.original !== "" && el.value === el.dataset.original;

/* Lista pesquisável (colunas LISTA): o id da opção fica no campo escondido; digitar só filtra, nunca cria opção.
   O painel de opções é um só, flutuante, dentro do diálogo aberto (ou da página), para não ser cortado pela grade. */
const MAX_OPCOES_VISIVEIS = 50;
function comboLista(col, valor, atributos) {
  const o = valor ? opcao(col, valor) : null;
  const fora = !!valor && !o;
  const titulo = fora ? "Valor que não existe nas opções desta coluna" : o && o.ativa === false ? textoRemovida(o) : "";
  const rotulo = (/aria-label="([^"]*)"/.exec(atributos) || [])[1];
  const dica = (/placeholder="([^"]*)"/.exec(atributos) || [])[1];
  return `<div class="combo" data-combo-col="${escapar(col.id)}"><input type="hidden" ${atributos.replace(/\s(aria-label|placeholder)="[^"]*"/g, "")} value="${escapar(valor || "")}" data-original="${escapar(valor || "")}">`
    + `<input type="text" class="combo-texto${fora ? " fora" : ""}" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" spellcheck="false"${rotulo ? ` aria-label="${rotulo}"` : ""}`
    + ` value="${escapar(o ? o.nome : valor || "")}" placeholder="${dica || "Pesquisar…"}"${titulo ? ` title="${escapar(titulo)}"` : ""}></div>`;
}
const combo = { caixa: null, ul: null, itens: [], ativo: -1 };
const partesCombo = (caixa) => ({ escondido: caixa.querySelector('input[type="hidden"]'), texto: caixa.querySelector(".combo-texto"), col: COL[caixa.dataset.comboCol] });
function painelCombo(caixa) {
  const pai = caixa.closest("dialog") || document.body;
  let ul = [...pai.children].find((x) => x.classList.contains("combo-lista"));
  if (!ul) {
    ul = document.createElement("ul");
    ul.className = "combo-lista";
    ul.setAttribute("role", "listbox");
    ul.id = `combo-lista-${Math.random().toString(36).slice(2, 8)}`;
    ul.hidden = true;
    pai.appendChild(ul);
  }
  return ul;
}
function abrirCombo(caixa, filtro) {
  const { escondido, texto, col } = partesCombo(caixa);
  if (!col) return;
  const ul = painelCombo(caixa);
  const n = nomeComparavel(filtro || "");
  const achadas = n ? opcoesAtivas(col).filter((o) => nomeComparavel(o.nome).includes(n)) : opcoesAtivas(col);
  /* Valor atual removido da lista: aparece no topo para manter (trocar é escolha da pessoa) */
  const removidaAtual = escondido.dataset.original && escondido.dataset.original === escondido.value ? opcaoRemovida(col, escondido.value) : null;
  const doTopo = removidaAtual && (!n || nomeComparavel(removidaAtual.nome).includes(n) || nomeComparavel(texto.value) === nomeComparavel(removidaAtual.nome)) ? [removidaAtual] : [];
  Object.assign(combo, { caixa, ul, itens: [...doTopo, ...achadas.slice(0, MAX_OPCOES_VISIVEIS)], ativo: -1 });
  ul.setAttribute("aria-label", `Opções de ${col.nome}`);
  ul.innerHTML = combo.itens.map((o, i) => `<li role="option" id="${ul.id}-${i}" data-i="${i}" aria-selected="${o.id === escondido.value}"${o.ativa === false ? ' class="combo-atual"' : ""}>${o.ativa === false ? `Atual: ${escapar(o.nome)} <span class="apoio">(removido da lista)</span>` : escapar(o.nome)}</li>`).join("")
    || `<li class="combo-aviso" aria-disabled="true">Nenhuma opção encontrada. Peça a uma administradora para incluir.</li>`;
  if (achadas.length > MAX_OPCOES_VISIVEIS) ul.insertAdjacentHTML("beforeend", `<li class="combo-aviso" aria-disabled="true">Mais ${achadas.length - MAX_OPCOES_VISIVEIS} opção(ões): continue digitando para filtrar.</li>`);
  ul.hidden = false;
  posicionarCombo();
  texto.setAttribute("aria-expanded", "true");
  texto.setAttribute("aria-controls", ul.id);
  const atual = combo.itens.findIndex((o) => o.id === escondido.value);
  if (atual >= 0) marcarCombo(atual);
}
function posicionarCombo() {
  if (!combo.caixa || !combo.ul) return;
  const ul = combo.ul;
  const r = partesCombo(combo.caixa).texto.getBoundingClientRect();
  ul.style.width = Math.max(r.width, 240) + "px";
  ul.style.left = Math.max(8, Math.min(innerWidth - Math.max(r.width, 240) - 8, r.left)) + "px";
  const alto = Math.min(ul.scrollHeight, 280);
  ul.style.top = (r.bottom + alto + 8 > innerHeight && r.top > alto + 8 ? r.top - alto - 4 : r.bottom + 2) + "px";
}
function fecharCombo() {
  if (!combo.caixa) return;
  const { texto } = partesCombo(combo.caixa);
  if (texto) { texto.setAttribute("aria-expanded", "false"); texto.removeAttribute("aria-activedescendant"); }
  if (combo.ul) combo.ul.hidden = true;
  Object.assign(combo, { caixa: null, ul: null, itens: [], ativo: -1 });
}
function marcarCombo(i) {
  if (!combo.ul || !combo.itens.length) return;
  combo.ativo = (i + combo.itens.length) % combo.itens.length;
  $$("[data-i]", combo.ul).forEach((li) => li.classList.toggle("ativa", Number(li.dataset.i) === combo.ativo));
  const li = $(`[data-i="${combo.ativo}"]`, combo.ul);
  if (li) { li.scrollIntoView({ block: "nearest" }); partesCombo(combo.caixa).texto.setAttribute("aria-activedescendant", li.id); }
}
function escolherCombo(caixa, o) {
  const { escondido, texto } = partesCombo(caixa);
  escondido.value = o ? o.id : "";
  texto.value = o ? o.nome : "";
  texto.classList.remove("fora");
  texto.removeAttribute("title");
  escondido.dispatchEvent(new Event("change", { bubbles: true }));
  fecharCombo();
}
/* Ao sair do campo: texto vazio limpa; texto digitado sem escolher volta ao valor escolhido */
function sairDoCombo(caixa) {
  const { escondido, texto, col } = partesCombo(caixa);
  if (!texto) return;
  if (!texto.value.trim()) { if (escondido.value) { escondido.value = ""; escondido.dispatchEvent(new Event("change", { bubbles: true })); } return; }
  const o = escondido.value ? opcao(col, escondido.value) : null;
  texto.value = o ? o.nome : escondido.value;
}
document.addEventListener("focusin", (e) => {
  const t = e.target.closest && e.target.closest(".combo-texto");
  if (t) { abrirCombo(t.closest(".combo"), ""); t.select(); }
});
document.addEventListener("input", (e) => {
  const t = e.target.closest && e.target.closest(".combo-texto");
  if (!t) return;
  abrirCombo(t.closest(".combo"), t.value);
  /* Digitando, a 1ª opção que bate fica destacada (Enter/Tab escolhem) */
  if (t.value.trim() && combo.itens.length && combo.ativo < 0) marcarCombo(0);
}, true);
document.addEventListener("focusout", (e) => {
  const t = e.target.closest && e.target.closest(".combo-texto");
  if (!t) return;
  const caixa = t.closest(".combo");
  if (combo.caixa === caixa) fecharCombo();
  sairDoCombo(caixa);
}, true);
/* Fase de captura: Enter/Esc com a lista aberta ficam com a lista (não salvam nem cancelam a célula) */
document.addEventListener("keydown", (e) => {
  const t = e.target.closest && e.target.closest(".combo-texto");
  if (!t) return;
  const caixa = t.closest(".combo");
  const aberta = combo.caixa === caixa && combo.ul && !combo.ul.hidden;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault(); e.stopPropagation();
    if (!aberta) abrirCombo(caixa, "");
    marcarCombo(combo.ativo < 0 && e.key === "ArrowUp" ? -1 : combo.ativo + (e.key === "ArrowDown" ? 1 : -1));
  } else if (e.key === "Enter" && aberta) {
    /* Na célula, o Enter escolhe E salva (segue para o editor); nos formulários, só escolhe */
    e.preventDefault();
    if (!t.closest(".editor-celula")) e.stopPropagation();
    if (combo.ativo >= 0) escolherCombo(caixa, combo.itens[combo.ativo]);
    else if (combo.itens.length === 1) escolherCombo(caixa, combo.itens[0]);
    else if (!t.value.trim()) escolherCombo(caixa, null);
  } else if (e.key === "Escape" && aberta) {
    e.preventDefault();
    if (!t.closest(".editor-celula")) e.stopPropagation();
    fecharCombo();
    sairDoCombo(caixa);
  } else if (e.key === "Tab" && aberta && combo.ativo >= 0) {
    escolherCombo(caixa, combo.itens[combo.ativo]);
  }
}, true);
document.addEventListener("mousedown", (e) => {
  const li = e.target.closest && e.target.closest(".combo-lista li");
  if (!li) return;
  e.preventDefault();
  if (li.dataset.i != null && combo.caixa) escolherCombo(combo.caixa, combo.itens[Number(li.dataset.i)]);
}, true);
/* Rolar a área que contém o campo (a grade rolando até a célula em edição) só reposiciona a lista; outra rolagem fecha */
document.addEventListener("scroll", (e) => {
  if (!combo.ul || e.target === combo.ul || combo.ul.contains(e.target)) return;
  if (combo.caixa && e.target.contains && e.target.contains(combo.caixa)) posicionarCombo();
  else fecharCombo();
}, true);
function renderizarLinhaNova(cols, valores) {
  const caixa = $("#planilha .linha-nova");
  if (!caixa) return;
  caixa.hidden = !podeAlimentar();
  if (caixa.hidden) return;
  const focado = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.nova : null;
  caixa.innerHTML = cols.map((c, j) => {
    const col = COL[c];
    const v = valores[c] != null ? valores[c] : "";
    const conteudo = podeNaLinhaNova(col)
      ? campoEntrada(col, v, `data-nova="${escapar(c)}" aria-label="Nova linha: ${escapar(col.nome)}${col.obrigatoria ? " (obrigatório)" : ""}" placeholder="${escapar(j === 0 ? "+ " + col.nome : col.nome)}"`)
      : `<span class="apoio" style="font-size:11px">${TIPOS_SEM_EDICAO.includes(col.tipo) ? "automático" : ""}</span>`;
    return `<div class="celula${j === 0 ? " fixa" : ""}" role="gridcell">${conteudo}</div>`;
  }).join("") + `<div class="celula col-acoes"><button type="button" class="acao-linha" data-nova-salvar title="Registrar (Enter)" aria-label="Registrar a linha nova">${svg("i-mais")}</button></div>`;
  if (focado) { const el = $(`#planilha .linha-nova [data-nova="${CSS.escape(focado)}"]`); if (el) el.focus({ preventScroll: true }); }
}

function ligarPlanilha(planilha) {
  let pedido = 0;
  planilha.addEventListener("scroll", () => { cancelAnimationFrame(pedido); pedido = requestAnimationFrame(() => pintarLinhas(false)); }, { passive: true });
  planilha.addEventListener("click", (e) => {
    if (e.target.closest(".linha-nova")) { if (e.target.closest("[data-nova-salvar]")) salvarLinhaNova(); return; }
    const ordenar = e.target.closest("[data-ordenar]");
    if (ordenar) {
      const col = ordenar.dataset.ordenar;
      const o = estado.vista.ordenar || {};
      estado.vista.ordenar = o.col !== col ? { col, dir: 1 } : o.dir === 1 ? { col, dir: -1 } : { col: "", dir: 1 };
      salvarVista(); renderizarTudo(); return;
    }
    const filtrar = e.target.closest("[data-filtrar]");
    if (filtrar) { abrirFiltro(filtrar.dataset.filtrar, filtrar); return; }
    const grupo = e.target.closest("[data-grupo]");
    if (grupo) {
      const k = grupo.dataset.grupo;
      if (estado.gruposFechados.has(k)) estado.gruposFechados.delete(k); else estado.gruposFechados.add(k);
      renderizarTudo(); return;
    }
    const sel = e.target.closest("[data-sel]");
    if (sel) { alternarSelecao(sel.dataset.sel, sel.checked); return; }
    const acao = e.target.closest("[data-acao]");
    if (acao) { executarAcao(acao.dataset.acao, porId(acao.closest("[data-id]").dataset.id), acao); return; }
    /* Um clique edita (rota única: não há duplo clique abrindo de novo). Links, caixa de seleção e Ações ficam de fora. */
    const cel = e.target.closest(".linha .celula[data-col]");
    if (!cel || e.target.closest("a, .editor-celula")) return;
    if (arrastouIntervalo) { arrastouIntervalo = false; return; }
    const id = cel.closest("[data-id]").dataset.id;
    if (e.shiftKey && estado.celula) { definirIntervalo(cel.dataset.col, estado.intervalo && estado.intervalo.col === cel.dataset.col ? estado.intervalo.ancora : estado.celula.id, id); selecionar(id, cel.dataset.col, true); return; }
    limparIntervalo();
    cliqueNaCelula(id, cel.dataset.col);
  });
  /* Clique fora da célula em edição: salva a anterior JÁ (antes do clique chegar), para o clique abrir a nova */
  planilha.addEventListener("pointerdown", (e) => {
    if (estado.editando && !e.target.closest(".editor-celula") && estado.editando.confirmar) estado.editando.confirmar();
    /* Arrastar com o mouse numa coluna seleciona várias células (Parte 4.6) */
    const cel = e.button === 0 && e.pointerType === "mouse" && !e.shiftKey ? e.target.closest(".linha .celula[data-col]") : null;
    if (!cel || estado.editando || e.target.closest("a, input, .editor-celula, [data-acao]")) return;
    const col = cel.dataset.col, ancora = cel.closest("[data-id]").dataset.id;
    let ultimo = ancora;
    const mover = (ev) => {
      const sob = document.elementFromPoint(ev.clientX, ev.clientY);
      const linha = sob && sob.closest && sob.closest("#planilha .linha[data-id]");
      if (!linha || linha.dataset.id === ultimo) return;
      ultimo = linha.dataset.id;
      arrastouIntervalo = ultimo !== ancora;
      definirIntervalo(col, ancora, ultimo);
      const s = window.getSelection && window.getSelection();
      if (s) s.removeAllRanges();
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar);
      if (arrastouIntervalo) { selecionar(ultimo, col, true); setTimeout(() => { arrastouIntervalo = false; }, 0); }
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }, true);
  planilha.addEventListener("keydown", (e) => {
    if (e.target.closest(".linha-nova")) {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); salvarLinhaNova(); }
      return;
    }
    teclaPlanilha(e);
  });
  planilha.addEventListener("paste", (e) => {
    if (e.target.closest(".linha-nova, .editor-celula") || estado.editando) return;
    const texto = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!texto) return;
    /* Bloco colado sobre várias células selecionadas: substitui os valores (com prévia) */
    if (estado.intervalo) { e.preventDefault(); colarSobreIntervalo(texto); return; }
    if (/[\t\n]/.test(texto.trim()) && podeAlimentar()) { e.preventDefault(); abrirColar(texto); }
  });
  /* Redimensionar colunas (só na própria visão) */
  planilha.addEventListener("pointerdown", (e) => {
    const r = e.target.closest("[data-redim]");
    if (!r) return;
    e.preventDefault();
    /* A pessoa arrasta a largura MÍNIMA: durante o arraste, as outras colunas ficam como estão e a largura efetiva
       aparece no cabeçalho; ao soltar, a sobra é redistribuída */
    const col = r.dataset.redim;
    const cols = estado.vista.colunas.filter((c) => COL[c]);
    const efetivas = cols.map((c) => (estado.largurasEfetivas && estado.largurasEfetivas[c]) || emEscala(largura(c)));
    const i = cols.indexOf(col), x0 = e.clientX, l0 = efetivas[i];
    const cab = r.closest(".cab-celula");
    const rotulo = document.createElement("span");
    rotulo.className = "cab-largura";
    cab.appendChild(rotulo);
    let w = l0;
    const mover = (ev) => {
      w = Math.max(emEscala(60), Math.min(emEscala(600), Math.round(l0 + ev.clientX - x0)));
      const ws = efetivas.map((x, k) => (k === i ? w : x));
      planilha.style.setProperty("--colunas", ws.map((x) => x + "px").join(" ") + ` ${emEscala(LARGURA_ACOES)}px`);
      planilha.style.setProperty("--largura-total", ws.reduce((s, x) => s + x, 0) + emEscala(LARGURA_ACOES) + "px");
      rotulo.textContent = `${w} px`;
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar);
      rotulo.remove();
      if (w !== l0) { estado.vista.larguras[col] = Math.max(60, Math.min(600, Math.round(w / escala()))); salvarVista(); }
      ajustarGrade(); pintarLinhas(true);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  });
  /* Reordenar colunas arrastando o cabeçalho (só na própria visão) */
  let arrastada = null;
  planilha.addEventListener("dragstart", (e) => {
    const cab = e.target.closest(".cab-celula[data-col]");
    if (!cab || e.target.closest("[data-redim]")) return;
    arrastada = cab.dataset.col;
    cab.classList.add("arrastando");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", arrastada);
  });
  planilha.addEventListener("dragover", (e) => {
    const cab = e.target.closest(".cab-celula[data-col]");
    if (!arrastada || !cab || cab.dataset.col === estado.vista.colunas[0]) return;
    e.preventDefault();
    $$(".alvo-soltar", planilha).forEach((x) => x.classList.remove("alvo-soltar"));
    cab.classList.add("alvo-soltar");
  });
  planilha.addEventListener("drop", (e) => {
    const cab = e.target.closest(".cab-celula[data-col]");
    if (!arrastada || !cab || cab.dataset.col === estado.vista.colunas[0]) return;
    e.preventDefault();
    const cols = estado.vista.colunas.filter((c) => c !== arrastada);
    cols.splice(cols.indexOf(cab.dataset.col), 0, arrastada);
    estado.vista.colunas = cols;
    arrastada = null;
    salvarVista(); renderizarPlanilha();
  });
  planilha.addEventListener("dragend", () => { arrastada = null; $$(".arrastando, .alvo-soltar", planilha).forEach((x) => x.classList.remove("arrastando", "alvo-soltar")); });
}
let arrastouIntervalo = false;
/* O foco nunca rola a grade sozinho (preventScroll): quem rola é garantirVisivel, sem recriar a linha clicada */
function selecionar(id, col, focar) {
  $$(".celula.ativa").forEach((x) => { x.classList.remove("ativa"); x.tabIndex = -1; });
  estado.celula = { id, col };
  const el = celulaEl(id, col);
  if (el) { el.classList.add("ativa"); el.tabIndex = 0; if (focar) el.focus({ preventScroll: true }); }
}
const colunasVisiveis = () => estado.vista.colunas.filter((c) => COL[c]);
const indiceLinha = (id) => estado.linhas.findIndex((l) => l.tipo === "linha" && l.t.id === id);
/* Rola só o necessário para a célula aparecer inteira: abaixo dos cabeçalhos fixos, acima da linha nova,
   à direita da 1ª coluna fixa e à esquerda de Ações */
function garantirVisivel(i, col) {
  const planilha = $("#planilha");
  if (!planilha || i < 0) return;
  const h = alturaLinha(), y = i * h;
  const nova = $(".linha-nova", planilha);
  const margem = topoGrade(planilha) + (nova && !nova.hidden ? nova.offsetHeight : 0);
  if (y < planilha.scrollTop) planilha.scrollTop = y;
  else if (y + h + margem > planilha.scrollTop + planilha.clientHeight) planilha.scrollTop = y + h + margem - planilha.clientHeight;
  const cols = colunasVisiveis();
  const j = cols.indexOf(col);
  if (j > 0) {
    const ws = cols.map((c) => (estado.largurasEfetivas && estado.largurasEfetivas[c]) || emEscala(largura(c)));
    const x = ws.slice(0, j).reduce((s, w) => s + w, 0);
    const acoes = emEscala(LARGURA_ACOES);
    if (x - ws[0] < planilha.scrollLeft) planilha.scrollLeft = x - ws[0];
    else if (x + ws[j] > planilha.scrollLeft + planilha.clientWidth - acoes) planilha.scrollLeft = x + ws[j] - planilha.clientWidth + acoes;
  } else if (j === 0) planilha.scrollLeft = 0;
  pintarLinhas(false);
}
function moverSelecao(dLinha, dCol) {
  const linhasDados = estado.linhas.map((l, i) => ({ ...l, i })).filter((l) => l.tipo === "linha");
  if (!linhasDados.length) return;
  const cols = colunasVisiveis();
  let li = estado.celula ? linhasDados.findIndex((l) => l.t.id === estado.celula.id) : 0;
  let ci = estado.celula ? cols.indexOf(estado.celula.col) : 0;
  li = Math.max(0, Math.min(linhasDados.length - 1, (li < 0 ? 0 : li) + dLinha));
  ci = Math.max(0, Math.min(cols.length - 1, (ci < 0 ? 0 : ci) + dCol));
  const alvo = linhasDados[li];
  garantirVisivel(alvo.i, cols[ci]);
  selecionar(alvo.t.id, cols[ci], true);
}
function proximaLinhaDados(i, dir) {
  for (let k = i + dir; k >= 0 && k < estado.linhas.length; k += dir) if (estado.linhas[k].tipo === "linha") return k;
  return -1;
}
/* Ordem de leitura do Tab: direita e, no fim da linha, 1ª coluna da linha de baixo (Shift+Tab: o contrário).
   Editando, pula as colunas travadas, automáticas, calculadas e sem permissão. */
function proximaCelula(id, c, dir, soEditaveis) {
  const cols = colunasVisiveis();
  let i = indiceLinha(id), j = cols.indexOf(c);
  if (i < 0 || j < 0) return null;
  for (let passos = 0; passos < cols.length * 200; passos++) {
    j += dir;
    if (j >= cols.length) { j = 0; i = proximaLinhaDados(i, 1); }
    else if (j < 0) { j = cols.length - 1; i = proximaLinhaDados(i, -1); }
    if (i < 0) return null;
    const t = estado.linhas[i].t;
    if (!soEditaveis || podeEditarCelula(t, COL[cols[j]])) return { i, id: t.id, col: cols[j] };
  }
  return null;
}
/* Depois da última linha, o Tab vai para o 1º campo da linha nova (quem pode alimentar); o foco nunca sai da grade */
function focarLinhaNova() {
  const caixa = $("#planilha .linha-nova");
  if (!caixa || caixa.hidden) return false;
  const el = $$("input:not([type=hidden]), select, textarea", caixa)[0];
  if (!el) return false;
  $("#planilha").scrollLeft = 0;
  el.focus({ preventScroll: true });
  return true;
}
function irParaProxima(id, c, dir, editar) {
  const prox = proximaCelula(id, c, dir, editar);
  if (!prox) {
    if (dir > 0 && focarLinhaNova()) return;
    const i = indiceLinha(id);
    if (i >= 0) { garantirVisivel(i, c); selecionar(id, c, true); }
    return;
  }
  garantirVisivel(prox.i, prox.col);
  selecionar(prox.id, prox.col, true);
  if (editar) iniciarEdicao(prox.id, prox.col);
}
/* Enter/Shift+Enter depois de salvar: desce/sobe na mesma coluna */
function irParaVertical(id, c, dir) {
  const i = proximaLinhaDados(indiceLinha(id), dir);
  if (i < 0) { const k = indiceLinha(id); if (k >= 0) { garantirVisivel(k, c); selecionar(id, c, true); } return; }
  garantirVisivel(i, c);
  selecionar(estado.linhas[i].t.id, c, true);
}
/* Um clique numa célula editável abre a edição; sem permissão, só seleciona (o motivo está no title) */
function cliqueNaCelula(id, c) {
  if (estado.editando) return;
  const t = porId(id), col = COL[c];
  selecionar(id, c, true);
  if (!t || !col || !podeEditarCelula(t, col)) return;
  if (col.tipo === "booleano") { salvarCelula(t, col, !(t.campos || {})[c]); return; }
  iniciarEdicao(id, c, { viaClique: true });
}
function teclaPlanilha(e) {
  if (estado.editando || e.target.closest(".editor-celula")) return;
  if (!e.target.classList.contains("celula") && e.target.id !== "planilha") return;
  if (e.key === "Tab") {
    e.preventDefault();
    if (!estado.celula) { moverSelecao(0, 0); return; }
    limparIntervalo();
    irParaProxima(estado.celula.id, estado.celula.col, e.shiftKey ? -1 : 1, false);
    return;
  }
  const mapa = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], PageDown: [10, 0], PageUp: [-10, 0] };
  if (mapa[e.key]) {
    e.preventDefault();
    if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && estado.celula) { estenderIntervalo(e.key === "ArrowDown" ? 1 : -1); return; }
    limparIntervalo();
    moverSelecao(...mapa[e.key]);
    return;
  }
  if (!estado.celula) return;
  if (e.key === "Escape" && estado.intervalo) { e.preventDefault(); limparIntervalo(); return; }
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && estado.intervalo) { e.preventDefault(); focarBarraIntervalo(); return; }
  if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); iniciarEdicao(estado.celula.id, estado.celula.col); return; }
  if (e.key === "Home") { e.preventDefault(); moverSelecao(0, -999); }
  if (e.key === "End") { e.preventDefault(); moverSelecao(0, 999); }
  if (e.key === "Delete") {
    const t = porId(estado.celula.id), col = COL[estado.celula.col];
    if (t && col && podeEditarCelula(t, col) && !col.obrigatoria) { e.preventDefault(); salvarCelula(t, col, vazioDe(col)); }
  }
  if (e.key === " " && estado.selecionando) { e.preventDefault(); alternarSelecao(estado.celula.id, !estado.selecionados.has(estado.celula.id)); return; }
  /* Digitar uma tecla com a célula selecionada começa a editar com ela (substitui o conteúdo) */
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
    if (estado.intervalo) { e.preventDefault(); focarBarraIntervalo(e.key); return; }
    const t = porId(estado.celula.id), col = COL[estado.celula.col];
    if (t && col && col.tipo !== "booleano" && podeEditarCelula(t, col)) { e.preventDefault(); iniciarEdicao(t.id, col.id, { texto: e.key }); }
  }
}

/* ------------------------------------------------------------
 *  Várias células de uma coluna (Shift+clique, arrastar, Shift+setas): um valor para todas (Ctrl+Enter)
 *  ou um bloco colado por cima. Só onde a pessoa pode editar; o resto é pulado e contado.
 * ------------------------------------------------------------ */
function definirIntervalo(c, idA, idB) {
  const iA = indiceLinha(idA), iB = indiceLinha(idB);
  if (iA < 0 || iB < 0 || !COL[c]) { limparIntervalo(); return; }
  const [a, b] = iA <= iB ? [iA, iB] : [iB, iA];
  const ids = estado.linhas.slice(a, b + 1).filter((l) => l.tipo === "linha").map((l) => l.t.id);
  estado.intervalo = ids.length > 1 ? { col: c, ancora: idA, fim: idB, ids, set: new Set(ids) } : null;
  marcarIntervalo();
}
function limparIntervalo() {
  if (!estado.intervalo) return;
  estado.intervalo = null;
  marcarIntervalo();
}
function estenderIntervalo(dir) {
  const iv = estado.intervalo;
  const c = iv ? iv.col : estado.celula.col;
  const ancora = iv ? iv.ancora : estado.celula.id;
  const i = proximaLinhaDados(indiceLinha(iv ? iv.fim : estado.celula.id), dir);
  if (i < 0) return;
  const fim = estado.linhas[i].t.id;
  garantirVisivel(i, c);
  definirIntervalo(c, ancora, fim);
  selecionar(fim, c, true);
}
function marcarIntervalo() {
  const iv = estado.intervalo;
  $$("#planilha .celula.no-intervalo").forEach((x) => x.classList.remove("no-intervalo"));
  if (iv) $$("#planilha .linha[data-id]").forEach((l) => {
    if (!iv.set.has(l.dataset.id)) return;
    const el = l.querySelector(`.celula[data-col="${CSS.escape(iv.col)}"]`);
    if (el) el.classList.add("no-intervalo");
  });
  renderizarBarraIntervalo();
}
function barraIntervalo() {
  let b = $("#barra-intervalo");
  if (b) return b;
  b = document.createElement("div");
  b.id = "barra-intervalo";
  b.className = "barra-selecao barra-intervalo";
  b.hidden = true;
  $("#barra-selecao").after(b);
  b.addEventListener("click", (e) => {
    const x = e.target.closest("[data-intervalo]");
    if (!x) return;
    if (x.dataset.intervalo === "aplicar") aplicarIntervalo();
    else { const c = estado.celula; limparIntervalo(); if (c) selecionar(c.id, c.col, true); }
  });
  b.addEventListener("keydown", (e) => {
    if (!e.target.closest("[data-intervalo-valor], .combo-texto")) return;
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); aplicarIntervalo(); }
    if (e.key === "Escape") { e.preventDefault(); const c = estado.celula; limparIntervalo(); if (c) selecionar(c.id, c.col, true); }
  });
  return b;
}
function renderizarBarraIntervalo() {
  const iv = estado.intervalo;
  const b = barraIntervalo();
  if (!iv) { b.hidden = true; b.innerHTML = ""; return; }
  const col = COL[iv.col];
  const lista = iv.ids.map(porId).filter(Boolean);
  const podem = lista.filter((t) => podeEditarCelula(t, col)).length;
  b.hidden = false;
  b.innerHTML = `<strong>${iv.ids.length} células de ${escapar(col.nome)}</strong>`
    + (podem ? `<span class="campo-intervalo">${campoEntrada(col, "", `data-intervalo-valor aria-label="Valor para ${podem} célula(s) de ${escapar(col.nome)}" placeholder="Valor para todas"`)}</span>
      <button type="button" class="btn btn-mini" data-intervalo="aplicar">${svg("i-lapis")}Aplicar às ${podem} células</button>` : "")
    + (lista.length - podem ? `<span class="apoio">${lista.length - podem} sem permissão: serão puladas</span>` : "")
    + `<span class="apoio">Ctrl+Enter aplica · Ctrl+V cola um bloco</span>`
    + `<button type="button" class="btn btn-secundario btn-mini" data-intervalo="limpar">Cancelar</button>`;
}
function focarBarraIntervalo(tecla) {
  const b = barraIntervalo();
  if (b.hidden) return;
  const campo = $(".combo-texto", b) || $("[data-intervalo-valor]", b);
  if (!campo) { mostrarAviso("Você não tem permissão para alterar estas células."); return; }
  campo.focus();
  if (!tecla) return;
  if (campo.tagName === "SELECT") {
    const o = [...campo.options].find((x) => x.value && normalizar(x.textContent).startsWith(normalizar(tecla)));
    if (o) campo.value = o.value;
  } else if (!["date", "datetime-local"].includes(campo.type)) {
    campo.value = tecla;
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
/* Grava mudanças de vários registros em lotes de até ~400 escritas, cada registro inteiro (com histórico e índices) */
async function gravarEmPartes(pares, acao) {
  let lote = [];
  for (const [t, mudancas] of pares) {
    const ops = opsAlteracao(t, mudancas, acao);
    if (lote.length && lote.length + ops.length > 400) { await estado.api.lote(lote); lote = []; }
    lote.push(...ops);
  }
  if (lote.length) await estado.api.lote(lote);
}
async function aplicarMudancas(pares, resumo, puladas = 0) {
  if (!conectado()) { mostrarAviso("Sem conexão: a edição está bloqueada."); return false; }
  const antes = pares.map(([t, m]) => [t.id, Object.fromEntries(Object.keys(m).map((c) => [c, (t.campos || {})[c] ?? vazioDe(COL[c])]))]);
  const n = pares.reduce((s, [, m]) => s + Object.keys(m).length, 0);
  try { await gravarEmPartes(pares, "editarMassa"); }
  catch (e) {
    console.error(e);
    mostrarAviso(mensagemErro(e), 6000);
    document.dispatchEvent(new CustomEvent("planilha:erro", { detail: { erro: mensagemErro(e) } }));
    return false;
  }
  empilharDesfazer("Edição em massa desfeita", async () => {
    await gravarEmPartes(antes.map(([id, m]) => [porId(id), m]).filter(([t]) => t), "desfazer");
  });
  registrarAuditoria("editarMassa", resumo, `${n} célula(s) em ${pares.length} registro(s)${puladas ? `; ${puladas} pulada(s) sem permissão` : ""}`);
  mostrarAviso(`${n} célula(s) alterada(s).${puladas ? ` ${puladas} pulada(s): sem permissão.` : ""}`, 5000);
  document.dispatchEvent(new CustomEvent("planilha:salvou", { detail: { n: pares.length } }));
  limparIntervalo();
  return true;
}
async function aplicarIntervalo() {
  const iv = estado.intervalo;
  if (!iv) return;
  const col = COL[iv.col];
  const el = $("#barra-intervalo [data-intervalo-valor]");
  if (!col || !el) return;
  if (el.closest(".combo")) sairDoCombo(el.closest(".combo"));
  const r = validarValor(col, col.tipo === "booleano" ? el.value === "sim" : el.value);
  let erro = r.ok ? "" : r.erro;
  if (r.ok && col.obrigatoria && estaVazio(r.valor)) erro = `${col.nome} é obrigatório.`;
  if (r.ok && !erro && col.unica && !estaVazio(r.valor)) erro = `${col.nome} não pode repetir: o mesmo valor não vai para várias linhas.`;
  if (erro) { mostrarAviso(erro, 5000); document.dispatchEvent(new CustomEvent("planilha:erro", { detail: { erro } })); return; }
  const lista = iv.ids.map(porId).filter(Boolean);
  const podem = lista.filter((t) => podeEditarCelula(t, col));
  const puladas = lista.length - podem.length;
  const mudam = podem.filter((t) => JSON.stringify((t.campos || {})[col.id] ?? vazioDe(col)) !== JSON.stringify(r.valor));
  if (!mudam.length) { mostrarAviso(puladas && !podem.length ? `Nada foi alterado: ${puladas} célula(s) sem permissão.` : "Nada muda: as células já têm esse valor."); return; }
  if (mudam.length > 20 && !(await confirmar(`Isto vai alterar ${mudam.length} células de ${col.nome} para “${textoDoValor(col, r.valor) || "vazio"}”.${puladas ? ` ${puladas} pulada(s): sem permissão.` : ""} Confirmar?`, { titulo: "Alterar várias células", botao: "Alterar" }))) return;
  await aplicarMudancas(mudam.map((t) => [t, { [col.id]: r.valor }]), `Definiu ${col.nome} = “${textoDoValor(col, r.valor)}” em ${mudam.length} registro(s)`, puladas);
}
/* Bloco do Excel colado sobre a seleção: substitui os valores a partir da 1ª célula (prévia antes de gravar) */
async function colarSobreIntervalo(texto) {
  const iv = estado.intervalo;
  if (!iv) return;
  const limpo = String(texto).replace(/\r?\n$/, "");
  const tabela = limpo.includes("\t") ? lerTabelaTexto(limpo) : limpo.split(/\r?\n/).map((l) => [l]);
  if (!tabela.length) return;
  const cols = colunasVisiveis();
  const j0 = cols.indexOf(iv.col);
  /* Um valor só repete em todas as células selecionadas */
  const blocos = tabela.length === 1 && tabela[0].length === 1 ? iv.ids.map(() => tabela[0]) : tabela;
  const mudancas = new Map(), erros = [], vistos = new Map();
  let celulas = 0, puladas = 0;
  let k = indiceLinha(iv.ids[0]);
  for (const valores of blocos) {
    if (k < 0) break;
    const t = estado.linhas[k].t;
    valores.forEach((txt, d) => {
      const col = COL[cols[j0 + d]];
      if (!col) return;
      if (!podeEditarCelula(t, col)) { puladas++; return; }
      const atual = (t.campos || {})[col.id];
      const r = validarValor(col, String(txt).trim(), atual);
      if (!r.ok) { erros.push(r.erro); return; }
      if (col.obrigatoria && estaVazio(r.valor)) { erros.push(`${col.nome} é obrigatório.`); return; }
      if (JSON.stringify(atual ?? vazioDe(col)) === JSON.stringify(r.valor)) return;
      if (col.unica && !estaVazio(r.valor)) {
        const chave = `${col.id}:${normalizar(r.valor)}`;
        if (vistos.has(chave)) { erros.push(`${col.nome} “${textoDoValor(col, r.valor)}” repete no bloco colado.`); return; }
        vistos.set(chave, true);
        const e = conferirRegistro({ ...(t.campos || {}), [col.id]: r.valor }, t.id)[col.id];
        if (e) { erros.push(typeof e === "string" ? e : e.texto); return; }
      }
      const m = mudancas.get(t.id) || {};
      m[col.id] = r.valor;
      mudancas.set(t.id, m);
      celulas++;
    });
    k = proximaLinhaDados(k, 1);
  }
  if (!celulas) {
    const msg = erros.length ? `Nada foi alterado. ${erros[0]}` : puladas ? `Nada foi alterado: ${puladas} célula(s) sem permissão.` : "Nada muda: as células já têm esses valores.";
    mostrarAviso(msg, 6000);
    if (erros.length) document.dispatchEvent(new CustomEvent("planilha:erro", { detail: { erro: msg } }));
    return;
  }
  const aviso = `${puladas ? ` ${puladas} pulada(s): sem permissão.` : ""}${erros.length ? ` ${erros.length} valor(es) com problema ficam de fora (ex.: ${erros[0]})` : ""}`;
  if (!(await confirmar(`Isto vai alterar ${celulas} célula(s) em ${mudancas.size} registro(s).${aviso} Confirmar?`, { titulo: "Colar sobre a seleção", botao: "Alterar" }))) return;
  await aplicarMudancas([...mudancas].map(([id, m]) => [porId(id), m]).filter(([t]) => t), `Colou ${celulas} célula(s) sobre a seleção`, puladas);
}

/* ------------------------------------------------------------
 *  Preencher em massa: grade de rascunho (colar do Excel, Ctrl+D, alça, preencher coluna), validação ao vivo
 *  e gravação em lotes pelo MESMO caminho da linha nova. O rascunho fica neste navegador.
 * ------------------------------------------------------------ */
const LINHAS_RASCUNHO = 20;
const OPS_POR_LOTE = 400;
/* As colunas da visão, na mesma ordem, que a pessoa pode preencher; obrigatórias escondidas entram no fim */
function colunasDoRascunho() {
  const vis = colunasVisiveis().map((c) => COL[c]).filter((c) => c && podeNaLinhaNova(c));
  const faltam = colunasAtivas().filter((c) => c.obrigatoria && podeNaLinhaNova(c) && !vis.includes(c));
  return [...vis, ...faltam];
}
const chaveUnicaRascunho = (c, v) => normalizar(v);
/* Valor de um campo tipado (menu da coluna) → texto do rascunho */
function textoParaRascunho(col, v) {
  if (estaVazio(v)) return "";
  if (col.tipo === "booleano") return v === "sim" || v === true ? "Sim" : "Não";
  if (col.tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("/");
  if (["lista", "status", "prioridade"].includes(col.tipo)) { const o = opcao(col, v); return o ? o.nome : String(v); }
  return String(v);
}
function abrirPreencherMassa() {
  if (!podeAlimentar()) { mostrarAviso(conectado() ? "Seu acesso é só de leitura." : "Sem conexão: a edição está bloqueada."); return; }
  const cols = colunasDoRascunho();
  if (!cols.length) { mostrarAviso("Nenhuma coluna desta visão pode ser preenchida por você."); return; }
  const chave = chaveUsuario("rascunho-massa");
  const salvo = lerLocal(chave, null);
  const vazias = (n) => Array.from({ length: n }, () => ({}));
  let linhas = salvo && Array.isArray(salvo.linhas) && salvo.linhas.length ? salvo.linhas.map((l) => (l && typeof l === "object" && !Array.isArray(l) ? l : {})) : vazias(LINHAS_RASCUNHO);
  const temDados = (lin) => cols.some((c) => String(lin[c.id] ?? "").trim());
  const d = criarDialogo({
    titulo: "Preencher em massa",
    largo: true,
    corpo: `<div class="massa">
      <div class="massa-topo">
        <p class="apoio">Digite, cole um bloco do Excel (Ctrl+V), copie para baixo (Ctrl+D) ou arraste a alça ◢ da célula. Linhas vazias são ignoradas. O rascunho fica salvo neste navegador.</p>
        <div class="massa-botoes">
          <button type="button" class="btn btn-secundario btn-mini" data-m="mais10">${svg("i-mais")}10 linhas</button>
          <button type="button" class="btn btn-secundario btn-mini" data-m="mais50">${svg("i-mais")}50 linhas</button>
          <button type="button" class="btn btn-secundario btn-mini" data-m="limpar">Limpar rascunho</button>
          <button type="button" class="btn btn-secundario btn-mini" data-m="descartar">Descartar rascunho</button>
          <button type="button" class="btn btn-mini massa-selo" data-m="problemas" hidden></button>
        </div>
      </div>
      <div class="massa-rolagem"><div class="massa-grade" role="grid" aria-label="Rascunho: uma linha por registro"></div></div>
      <div hidden>${cols.map((c, ci) => (TIPOS_LISTA.includes(c.tipo) || c.tipo === "booleano") ? `<datalist id="massa-dl-${ci}">${(c.tipo === "booleano" ? [{ nome: "Sim" }, { nome: "Não" }] : opcoesAtivas(c)).map((o) => `<option value="${escapar(o.nome)}"></option>`).join("")}</datalist>` : "").join("")}</div>
      <div class="massa-progresso" hidden><progress max="1" value="0"></progress><span class="apoio" role="status"></span></div>
      <div class="form-botoes"><span class="apoio massa-status" role="status"></span>
        <button type="button" class="btn btn-secundario" data-fechar>Fechar</button>
        <button type="button" class="btn btn-secundario" data-m="salvar-validas" hidden></button>
        <button type="button" class="btn" data-m="salvar" disabled>${svg("i-salvar")}Salvar 0 registros</button></div>
    </div>`
  });
  d.classList.add("dialogo-massa");
  const form = d.querySelector("form");
  const grade = $(".massa-grade", d);
  const alca = document.createElement("span");
  alca.className = "massa-alca";
  alca.title = "Arraste para copiar para as células de baixo";
  let foco = { r: 0, c: 0 }, sel = null, problemas = [], validas = [], ultimoN = 0, salvando = false, menu = null;
  let tempoGuardar = 0, tempoValidar = 0, redesenhando = false;
  const pilha = [], refazer = [];
  const foto = () => JSON.stringify(linhas);
  const marcar = () => { const f = foto(); if (pilha[pilha.length - 1] !== f) { pilha.push(f); if (pilha.length > 100) pilha.shift(); refazer.length = 0; } };
  const guardarJa = () => { clearTimeout(tempoGuardar); if (linhas.some(temDados)) gravarLocal(chave, { em: new Date().toISOString(), linhas }); else apagarLocal(chave); };
  const guardar = () => { clearTimeout(tempoGuardar); tempoGuardar = setTimeout(guardarJa, 400); };
  const campo = (r, ci) => grade.querySelector(`.massa-campo[data-r="${r}"][data-ci="${ci}"]`);
  const status = (t) => { $(".massa-status", d).textContent = t; };
  const ret = (a, b) => ({ r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r), c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c), ancora: a });
  const tamanhoSel = () => (sel ? (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1) : 0);
  function htmlCampo(col, r, ci, v) {
    const lista = TIPOS_LISTA.includes(col.tipo) || col.tipo === "booleano" ? ` list="massa-dl-${ci}"` : "";
    const dica = { data: "dd/mm/aaaa", dataHora: "dd/mm/aaaa hh:mm", etiquetas: "a, b, c", numero: "0" }[col.tipo] || "";
    return `<input class="massa-campo" data-r="${r}" data-ci="${ci}" value="${escapar(v ?? "")}" autocomplete="off" spellcheck="false"${lista}${dica ? ` placeholder="${dica}"` : ""}${col.tipo === "numero" ? ' inputmode="decimal"' : ""} aria-label="Linha ${r + 1}: ${escapar(col.nome)}">`;
  }
  function desenhar() {
    const tinhaFoco = grade.contains(document.activeElement);
    grade.style.setProperty("--massa-colunas", cols.length);
    grade.innerHTML = `<div class="massa-linha massa-cab" role="row"><span class="massa-n" role="columnheader">#</span>${cols.map((c, ci) => `<span class="massa-cab-celula" role="columnheader" title="${escapar(c.ajuda || c.nome)}"><span class="massa-cab-nome">${escapar(c.nome)}${c.obrigatoria ? ' <span class="obrig">*</span>' : ""}</span><button type="button" class="massa-menu" data-menu="${ci}" aria-label="Opções da coluna ${escapar(c.nome)}" title="Preencher ou limpar a coluna">${svg("i-chevron-baixo")}</button></span>`).join("")}</div>`
      + linhas.map((lin, r) => `<div class="massa-linha" role="row"><span class="massa-n" role="rowheader">${r + 1}</span>${cols.map((c, ci) => `<span class="massa-celula" role="gridcell">${htmlCampo(c, r, ci, lin[c.id])}</span>`).join("")}</div>`).join("");
    validar();
    marcarSelecao();
    const el = campo(Math.min(foco.r, linhas.length - 1), foco.c);
    if (el) { el.parentElement.appendChild(alca); if (tinhaFoco) { redesenhando = true; el.focus({ preventScroll: true }); redesenhando = false; } }
  }
  function definir(r, ci, v) {
    linhas[r][cols[ci].id] = v;
    const el = campo(r, ci);
    if (el) el.value = v;
  }
  function depoisDeMudar() { guardar(); validar(); }
  function irPara(r, ci, criar) {
    if (r >= linhas.length && criar) { linhas.push({}); desenhar(); }
    r = Math.max(0, Math.min(linhas.length - 1, r));
    ci = Math.max(0, Math.min(cols.length - 1, ci));
    const el = campo(r, ci);
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  function marcarSelecao() {
    $$(".massa-campo.no-intervalo", grade).forEach((x) => x.classList.remove("no-intervalo"));
    if (sel && tamanhoSel() > 1) {
      for (let r = sel.r1; r <= sel.r2; r++) for (let ci = sel.c1; ci <= sel.c2; ci++) { const el = campo(r, ci); if (el) el.classList.add("no-intervalo"); }
      status(`${tamanhoSel()} células selecionadas: digite um valor e Ctrl+Enter para todas.`);
    }
  }
  /* Validação ao vivo: obrigatórias, tipo, lista (com sugestão), tamanho e únicas (no rascunho e nos já existentes) */
  function validar() {
    clearTimeout(tempoValidar);
    problemas = []; validas = [];
    const unicas = cols.filter((c) => c.unica).map((c) => [c, new Map()]);
    linhas.forEach((lin, r) => {
      if (!temDados(lin)) return;
      const valores = {};
      let ruim = false;
      const add = (ci, texto, extra = {}) => { problemas.push({ r, ci, texto, ...extra }); ruim = true; };
      cols.forEach((c, ci) => {
        const txt = String(lin[c.id] ?? "").trim();
        if (!txt) return;
        if (LIMITES[c.tipo] && txt.length > LIMITES[c.tipo]) { add(ci, `${c.nome}: no máximo ${LIMITES[c.tipo]} caracteres (tem ${txt.length}).`); return; }
        const v = validarValor(c, txt);
        if (!v.ok) add(ci, v.erro, v.sugestao ? { sugestao: v.sugestao.nome } : {});
        else valores[c.id] = v.valor;
      });
      const completos = completarCampos(valores);
      Object.entries(conferirRegistro(completos)).forEach(([cid, e]) => {
        const ci = cols.findIndex((c) => c.id === cid);
        if (ci >= 0 && problemas.some((p) => p.r === r && p.ci === ci)) return;
        const texto = typeof e === "object" ? e.texto : e;
        add(ci >= 0 ? ci : 0, ci >= 0 ? texto : `${texto} (coluna fora do rascunho)`, typeof e === "object" ? { existente: e.id } : {});
      });
      unicas.forEach(([c, vistos]) => {
        const v = completos[c.id];
        if (estaVazio(v)) return;
        const k = chaveUnicaRascunho(c, v);
        if (vistos.has(k)) add(cols.indexOf(c), `${c.nome} “${textoDoValor(c, v)}” repete a linha ${vistos.get(k) + 1} do rascunho.`);
        else vistos.set(k, r);
      });
      if (!ruim) validas.push({ r, campos: completos });
    });
    $$(".massa-campo.com-erro", grade).forEach((x) => { x.classList.remove("com-erro"); x.removeAttribute("title"); x.removeAttribute("aria-invalid"); });
    problemas.forEach((p) => {
      const el = campo(p.r, p.ci);
      if (!el) return;
      el.classList.add("com-erro");
      el.setAttribute("aria-invalid", "true");
      el.title = (el.title ? el.title + " · " : "") + p.texto + (p.sugestao ? " (veja em “problemas”: um clique aceita a sugestão)" : "");
    });
    const linhasRuins = new Set(problemas.map((p) => p.r)).size;
    const total = validas.length + linhasRuins;
    const selo = $('[data-m="problemas"]', d);
    selo.hidden = !problemas.length;
    selo.textContent = `${problemas.length} problema${problemas.length === 1 ? "" : "s"}`;
    const botao = $('[data-m="salvar"]', d);
    botao.innerHTML = `${svg("i-salvar")}Salvar ${total} registro${total === 1 ? "" : "s"}`;
    botao.disabled = salvando || !total || !!problemas.length;
    const so = $('[data-m="salvar-validas"]', d);
    so.hidden = !problemas.length || !validas.length;
    so.textContent = `Salvar só as ${validas.length} linha(s) sem problema`;
    so.disabled = salvando;
    if (problemas.length > ultimoN) document.dispatchEvent(new CustomEvent("planilha:erro", { detail: { erro: problemas[problemas.length - 1].texto } }));
    ultimoN = problemas.length;
    if (menu && menu.dataset.tipo === "problemas") abrirProblemas();
  }
  const validarDepois = () => { clearTimeout(tempoValidar); tempoValidar = setTimeout(validar, 150); };
  function desfazerM() {
    const atual = foto();
    while (pilha.length && pilha[pilha.length - 1] === atual) pilha.pop();
    if (!pilha.length) return;
    refazer.push(atual);
    linhas = JSON.parse(pilha.pop());
    desenhar(); guardar();
  }
  function refazerM() {
    if (!refazer.length) return;
    pilha.push(foto());
    linhas = JSON.parse(refazer.pop());
    desenhar(); guardar();
  }
  /* Ctrl+D: a 1ª linha da seleção desce para as outras; sem seleção, copia a célula de cima */
  function copiarParaBaixo() {
    marcar();
    if (sel && sel.r2 > sel.r1) {
      for (let ci = sel.c1; ci <= sel.c2; ci++) for (let r = sel.r1 + 1; r <= sel.r2; r++) definir(r, ci, linhas[sel.r1][cols[ci].id] ?? "");
    } else if (foco.r > 0) definir(foco.r, foco.c, linhas[foco.r - 1][cols[foco.c].id] ?? "");
    depoisDeMudar();
  }
  function preencherSelecao(v) {
    if (!sel || tamanhoSel() < 2) return;
    marcar();
    for (let r = sel.r1; r <= sel.r2; r++) for (let ci = sel.c1; ci <= sel.c2; ci++) definir(r, ci, v);
    depoisDeMudar();
  }
  function fecharMenu() { if (menu) { menu.remove(); menu = null; } }
  function abrirPop(html, botao, tipo) {
    fecharMenu();
    menu = document.createElement("div");
    menu.className = "pop massa-pop";
    menu.dataset.tipo = tipo;
    menu.innerHTML = html;
    d.appendChild(menu);
    const r = botao.getBoundingClientRect();
    const w = Math.min(360, innerWidth - 16);
    menu.style.width = w + "px";
    menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px";
    menu.style.top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, r.bottom + 4)) + "px";
    return menu;
  }
  function abrirMenuColuna(ci, botao) {
    const col = cols[ci];
    const m = abrirPop(`<p class="massa-pop-titulo">${escapar(col.nome)}</p>
      <label class="campo"><span class="rotulo">Preencher todas as linhas com…</span>${campoEntrada(col, "", `data-mm-valor aria-label="Valor para todas as linhas de ${escapar(col.nome)}"`)}</label>
      <div class="massa-pop-botoes">${col.tipo === "data" ? '<button type="button" class="btn btn-secundario btn-mini" data-mm="hoje">Hoje</button>' : ""}<button type="button" class="btn btn-mini" data-mm="preencher">Preencher</button>
        <button type="button" class="btn btn-secundario btn-mini" data-mm="limpar">Limpar coluna</button></div>
      <p class="apoio" style="font-size:12px">Vale para as linhas já preenchidas (ou para todas, se o rascunho estiver vazio).</p>`, botao, "coluna");
    const entrada = $("[data-mm-valor]", m);
    const preencher = (valor) => {
      const texto = textoParaRascunho(col, valor);
      const alvo = linhas.some(temDados) ? linhas.map((l, r) => (temDados(l) ? r : -1)).filter((r) => r >= 0) : linhas.map((_, r) => r);
      marcar();
      alvo.forEach((r) => definir(r, ci, texto));
      depoisDeMudar();
      fecharMenu();
      irPara(foco.r, ci);
    };
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mm]");
      if (!b) return;
      if (b.dataset.mm === "hoje") preencher(hojeIso());
      if (b.dataset.mm === "preencher") { if (entrada.closest(".combo")) sairDoCombo(entrada.closest(".combo")); preencher(entrada.value); }
      if (b.dataset.mm === "limpar") { marcar(); linhas.forEach((_, r) => definir(r, ci, "")); depoisDeMudar(); fecharMenu(); }
    });
    m.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === entrada) { e.preventDefault(); preencher(entrada.value); } });
    const f = $(".combo-texto", m) || entrada;
    f.focus();
  }
  function abrirProblemas() {
    const botao = $('[data-m="problemas"]', d);
    if (!problemas.length) { fecharMenu(); return; }
    const ativo = document.activeElement;
    const m = abrirPop(`<p class="massa-pop-titulo">${problemas.length} problema(s): clique para ir até a célula</p>
      <ul class="massa-problemas">${problemas.slice(0, 100).map((p, i) => `<li><button type="button" class="btn-link" data-ir="${i}">Linha ${p.r + 1} · ${escapar(cols[p.ci].nome)}</button> <span>${escapar(p.texto)}</span>
        ${p.sugestao ? `<button type="button" class="btn btn-secundario btn-mini" data-aceitar="${i}">Usar “${escapar(p.sugestao)}”</button>` : ""}
        ${p.existente ? `<button type="button" class="btn btn-secundario btn-mini" data-abrir="${escapar(p.existente)}">já existe: abrir</button>` : ""}</li>`).join("")}</ul>
      ${problemas.length > 100 ? `<p class="apoio">Mais ${problemas.length - 100}: corrija estes primeiro.</p>` : ""}`, botao, "problemas");
    m.addEventListener("click", (e) => {
      const ir = e.target.closest("[data-ir]"), aceitar = e.target.closest("[data-aceitar]"), abrir = e.target.closest("[data-abrir]");
      if (ir) { const p = problemas[Number(ir.dataset.ir)]; fecharMenu(); if (p) irPara(p.r, p.ci); }
      if (aceitar) { const p = problemas[Number(aceitar.dataset.aceitar)]; if (p) { marcar(); definir(p.r, p.ci, p.sugestao); depoisDeMudar(); } }
      if (abrir) { guardarJa(); d.close(); abrirFicha(abrir.dataset.abrir); }
    });
    if (ativo && d.contains(ativo) && !m.contains(ativo)) ativo.focus({ preventScroll: true });
  }
  /* Colar um bloco do Excel: preenche a partir da célula (cria linhas se faltar); um valor só preenche a seleção */
  grade.addEventListener("paste", (e) => {
    const el = e.target.closest(".massa-campo");
    const texto = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!el || !texto) return;
    const limpo = texto.replace(/\r?\n$/, "");
    if (!/[\t\n]/.test(limpo)) {
      if (tamanhoSel() > 1) { e.preventDefault(); preencherSelecao(limpo.trim()); }
      return;
    }
    e.preventDefault();
    const tabela = limpo.includes("\t") ? lerTabelaTexto(limpo) : limpo.split(/\r?\n/).map((l) => [l]);
    const r0 = sel && tamanhoSel() > 1 ? sel.r1 : Number(el.dataset.r), c0 = sel && tamanhoSel() > 1 ? sel.c1 : Number(el.dataset.ci);
    if (tabela.length > 1 && tabela[0].some((v) => v.trim()) && tabela[0].every((v, k) => !v.trim() || (cols[c0 + k] && normalizar(v.trim()) === normalizar(cols[c0 + k].nome)))) tabela.shift();
    marcar();
    while (linhas.length < r0 + tabela.length) linhas.push({});
    let fora = 0;
    tabela.forEach((vals, dr) => vals.forEach((v, dc) => { if (c0 + dc < cols.length) linhas[r0 + dr][cols[c0 + dc].id] = String(v).trim(); else if (String(v).trim()) fora++; }));
    const largura = Math.max(...tabela.map((v) => v.length));
    desenhar(); guardar();
    sel = ret({ r: r0, c: c0 }, { r: r0 + tabela.length - 1, c: Math.min(cols.length - 1, c0 + largura - 1) });
    marcarSelecao();
    status(`${tabela.length} linha(s) colada(s).${fora ? ` ${fora} valor(es) além da última coluna ficaram de fora.` : ""}`);
    irPara(r0, c0);
  });
  grade.addEventListener("input", (e) => {
    const el = e.target.closest(".massa-campo");
    if (!el) return;
    linhas[Number(el.dataset.r)][cols[Number(el.dataset.ci)].id] = el.value;
    guardar(); validarDepois();
  });
  grade.addEventListener("focusin", (e) => {
    const el = e.target.closest(".massa-campo");
    if (!el) return;
    if (!redesenhando) marcar();
    foco = { r: Number(el.dataset.r), c: Number(el.dataset.ci) };
    /* Como no Excel: a célula ativa saindo da seleção desfaz a seleção */
    if (sel && (foco.r < sel.r1 || foco.r > sel.r2 || foco.c < sel.c1 || foco.c > sel.c2)) { sel = null; marcarSelecao(); }
    el.parentElement.appendChild(alca);
  });
  grade.addEventListener("click", (e) => {
    const b = e.target.closest("[data-menu]");
    if (b) abrirMenuColuna(Number(b.dataset.menu), b);
  });
  grade.addEventListener("pointerdown", (e) => {
    if (e.target === alca) { arrastarAlca(e); return; }
    const el = e.target.closest(".massa-campo");
    if (!el) return;
    const p = { r: Number(el.dataset.r), c: Number(el.dataset.ci) };
    if (e.shiftKey) { e.preventDefault(); sel = ret(sel ? sel.ancora : foco, p); marcarSelecao(); return; }
    sel = null; marcarSelecao();
    if (e.pointerType !== "mouse") return;
    const mover = (ev) => {
      const x = document.elementFromPoint(ev.clientX, ev.clientY);
      const alvo = x && x.closest && x.closest(".massa-campo");
      if (!alvo) return;
      const q = { r: Number(alvo.dataset.r), c: Number(alvo.dataset.ci) };
      if (!sel && q.r === p.r && q.c === p.c) return;
      sel = ret(p, q);
      marcarSelecao();
    };
    const soltar = () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  });
  /* Alça de preenchimento: arrastar para baixo (ou para cima) repete a célula, ou o bloco selecionado */
  function arrastarAlca(e) {
    e.preventDefault();
    const origem = sel && tamanhoSel() > 1 ? { ...sel } : { r1: foco.r, r2: foco.r, c1: foco.c, c2: foco.c };
    let ate = origem.r2;
    const marcarAlvo = () => {
      $$(".massa-campo.massa-alvo", grade).forEach((x) => x.classList.remove("massa-alvo"));
      const [a, b] = ate > origem.r2 ? [origem.r2 + 1, ate] : ate < origem.r1 ? [ate, origem.r1 - 1] : [1, 0];
      for (let r = a; r <= b; r++) for (let ci = origem.c1; ci <= origem.c2; ci++) { const el = campo(r, ci); if (el) el.classList.add("massa-alvo"); }
    };
    const mover = (ev) => {
      const x = document.elementFromPoint(ev.clientX, ev.clientY);
      const alvo = x && x.closest && x.closest(".massa-campo");
      if (alvo) { ate = Number(alvo.dataset.r); marcarAlvo(); }
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar);
      $$(".massa-campo.massa-alvo", grade).forEach((x) => x.classList.remove("massa-alvo"));
      if (ate >= origem.r1 && ate <= origem.r2) return;
      marcar();
      const altura = origem.r2 - origem.r1 + 1;
      const [a, b] = ate > origem.r2 ? [origem.r2 + 1, ate] : [ate, origem.r1 - 1];
      for (let r = a; r <= b; r++) for (let ci = origem.c1; ci <= origem.c2; ci++) {
        const k = ((r - origem.r1) % altura + altura) % altura;
        definir(r, ci, linhas[origem.r1 + k][cols[ci].id] ?? "");
      }
      sel = ret({ r: Math.min(a, origem.r1), c: origem.c1 }, { r: Math.max(b, origem.r2), c: origem.c2 });
      depoisDeMudar(); marcarSelecao();
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }
  grade.addEventListener("keydown", (e) => {
    const el = e.target.closest(".massa-campo");
    if (!el) return;
    const r = Number(el.dataset.r), ci = Number(el.dataset.ci);
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && k === "z" && !e.shiftKey) { e.preventDefault(); desfazerM(); return; }
    if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); refazerM(); return; }
    if (ctrl && k === "d") { e.preventDefault(); copiarParaBaixo(); return; }
    if (ctrl && e.key === "Enter") { e.preventDefault(); preencherSelecao(el.value); return; }
    if (e.key === "Enter") { e.preventDefault(); sel = null; marcarSelecao(); irPara(r + (e.shiftKey ? -1 : 1), ci, !e.shiftKey); return; }
    const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    if (e.shiftKey && (vertical || (horizontal && (!el.value || tamanhoSel() > 1)))) {
      e.preventDefault();
      const base = sel ? { r: sel.ancora.r === sel.r1 ? sel.r2 : sel.r1, c: sel.ancora.c === sel.c1 ? sel.c2 : sel.c1 } : { r, c: ci };
      const q = { r: Math.max(0, Math.min(linhas.length - 1, base.r + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0))), c: Math.max(0, Math.min(cols.length - 1, base.c + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0))) };
      sel = ret(sel ? sel.ancora : { r, c: ci }, q);
      marcarSelecao();
      const alvo = campo(q.r, q.c);
      if (alvo) alvo.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    if (vertical) { e.preventDefault(); sel = null; marcarSelecao(); irPara(r + (e.key === "ArrowDown" ? 1 : -1), ci); return; }
    if (e.key === "ArrowRight" && el.selectionStart === el.value.length && el.selectionEnd === el.value.length && ci < cols.length - 1) { e.preventDefault(); irPara(r, ci + 1); return; }
    if (e.key === "ArrowLeft" && el.selectionStart === 0 && el.selectionEnd === 0 && ci > 0) { e.preventDefault(); irPara(r, ci - 1); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && tamanhoSel() > 1) { e.preventDefault(); preencherSelecao(""); }
  });
  d.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target) && !e.target.closest("[data-menu], [data-m='problemas'], .combo-lista")) fecharMenu(); });
  d.addEventListener("cancel", (e) => { if (menu) { e.preventDefault(); fecharMenu(); } });
  form.addEventListener("submit", (e) => e.preventDefault());
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-m]");
    if (!b || salvando) return;
    const acao = b.dataset.m;
    if (acao === "mais10" || acao === "mais50") { marcar(); linhas.push(...vazias(acao === "mais10" ? 10 : 50)); desenhar(); guardar(); irPara(linhas.length - (acao === "mais10" ? 10 : 50), 0); }
    if (acao === "limpar") { marcar(); linhas = vazias(LINHAS_RASCUNHO); sel = null; desenhar(); guardar(); status("Rascunho limpo (Ctrl+Z desfaz)."); }
    if (acao === "descartar") {
      if (!(await confirmar("Descartar o rascunho? Tudo o que foi digitado aqui some deste navegador.", { titulo: "Descartar rascunho", botao: "Descartar", perigo: true }))) return;
      apagarLocal(chave); linhas = vazias(LINHAS_RASCUNHO); pilha.length = 0; refazer.length = 0; d.close();
    }
    if (acao === "problemas") { if (menu && menu.dataset.tipo === "problemas") fecharMenu(); else abrirProblemas(); }
    if (acao === "salvar") salvar(false);
    if (acao === "salvar-validas") salvar(true);
  });
  async function salvar(soValidas) {
    validar();
    if (problemas.length && !soValidas) { abrirProblemas(); return; }
    if (!validas.length) return;
    if (!conectado()) { mostrarAviso("Sem conexão: a edição está bloqueada."); return; }
    salvando = true; validar();
    fecharMenu();
    const grupos = validas.map((v) => ({ r: v.r, ...opsCriarRegistro(v.campos) }));
    const caixa = $(".massa-progresso", d), barra = $("progress", caixa), texto = $("[role=status]", caixa);
    caixa.hidden = false; barra.max = grupos.length; barra.value = 0;
    texto.textContent = `Salvando 0 de ${grupos.length}…`;
    const criados = [], gravadas = new Set();
    let lote = [], doLote = [], erro = null;
    const enviar = async () => {
      await estado.api.lote(lote);
      doLote.forEach((g) => { criados.push(g.id); gravadas.add(g.r); });
      lote = []; doLote = [];
      barra.value = criados.length;
      texto.textContent = `Salvando ${criados.length} de ${grupos.length}…`;
    };
    try {
      for (const g of grupos) {
        if (lote.length && lote.length + g.ops.length > OPS_POR_LOTE) await enviar();
        lote.push(...g.ops); doLote.push(g);
      }
      if (lote.length) await enviar();
    } catch (e) { console.error(e); erro = e; }
    linhas = linhas.filter((_, r) => !gravadas.has(r));
    if (!linhas.some(temDados)) linhas = vazias(LINHAS_RASCUNHO);
    else while (linhas.length < LINHAS_RASCUNHO) linhas.push({});
    pilha.length = 0; refazer.length = 0; sel = null;
    guardarJa();
    salvando = false;
    caixa.hidden = true;
    desenhar();
    const fn = criados.length ? desfazerCriacaoEmMassa(criados) : null;
    if (criados.length) {
      criados.forEach((id) => estado.piscar.set(id, Date.now() + 3500));
      empilharDesfazer("Preenchimento em massa desfeito", fn);
      registrarAuditoria("preencherMassa", `Adicionou ${criados.length} registro(s) em massa`, `${cols.length} coluna(s): ${cols.map((c) => c.nome).join(", ")}`.slice(0, 500));
      document.dispatchEvent(new CustomEvent("planilha:salvou", { detail: { n: criados.length } }));
    }
    if (erro) {
      const faltam = grupos.length - criados.length;
      const cota = /resource-exhausted|quota/i.test((erro && erro.code) || "");
      const msg = `${cota ? "O limite diário de gravações do plano gratuito acabou." : mensagemErro(erro, "numero")} ${criados.length} registro(s) adicionado(s); ${faltam} continua(m) no rascunho${cota ? " para salvar depois" : ""}.`;
      status(msg); mostrarAviso(msg, 8000);
      document.dispatchEvent(new CustomEvent("planilha:erro", { detail: { erro: msg } }));
      return;
    }
    const n = criados.length;
    mostrarAviso(`${n} registro${n === 1 ? "" : "s"} adicionado${n === 1 ? "" : "s"}.${fn ? " Use Desfazer para voltar." : ""}`, 6000);
    if (!linhas.some(temDados)) d.close();
    else status(`${n} registro(s) adicionado(s). As linhas com problema continuam aqui.`);
  }
  d.addEventListener("close", () => { guardarJa(); clearTimeout(tempoValidar); fecharMenu(); });
  desenhar();
  d.showModal();
  if (salvo && linhas.some(temDados)) status(`Rascunho recuperado deste navegador (${formatarData(salvo.em, true)}).`);
  irPara(0, 0);
}

/* ------------------------------------------------------------
 *  Filtro por coluna (popover)
 * ------------------------------------------------------------ */
let popAtual = null;
function fecharPop() { if (popAtual) { popAtual.remove(); popAtual = null; } }
document.addEventListener("pointerdown", (e) => { if (popAtual && !e.target.closest(".pop") && !e.target.closest("[data-filtrar], [data-acao='mais'], #btn-admin")) fecharPop(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && popAtual) fecharPop(); });
function posicionarPop(pop, botao, larguraPop = 260) {
  document.body.appendChild(pop);
  const r = botao.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - larguraPop - 10, r.right - larguraPop)) + "px";
  pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 6)) + "px";
  popAtual = pop;
}
function abrirFiltro(c, botao) {
  fecharPop();
  const col = COL[c];
  const f = (estado.vista.filtros || {})[c] || {};
  const porLista = TIPOS_LISTA.includes(col.tipo) || ["booleano", "pessoa"].includes(col.tipo) || (col.tipo === "automatico" && /Por$/.test(col.auto));
  const set = new Set();
  estado.tickets.forEach((t) => {
    if (col.tipo === "etiquetas") { const v = valorBruto(t, col) || []; if (!v.length) set.add("(vazio)"); v.forEach((x) => set.add((opcao(col, x) || { nome: x }).nome)); }
    else set.add(valorTexto(t, col) || "(vazio)");
  });
  const usarLista = porLista || (["texto"].includes(col.tipo) && set.size <= 60);
  const ordem = TIPOS_LISTA.includes(col.tipo) ? opcoesDe(col).map((o) => o.nome) : null;
  const todos = usarLista ? [...set].sort((a, b) => (ordem ? (ordem.indexOf(a) + 1 || 999) - (ordem.indexOf(b) + 1 || 999) : 0) || a.localeCompare(b, "pt-BR")) : [];
  /* Opções removidas da lista que ainda têm linhas: seção própria, também dá para filtrar por elas */
  const nomesRemovidos = new Set(TIPOS_LISTA.includes(col.tipo) ? opcoesDe(col).filter((o) => o.ativa === false).map((o) => o.nome) : []);
  const valores = todos.filter((v) => !nomesRemovidos.has(v)), removidos = todos.filter((v) => nomesRemovidos.has(v));
  const caixa = (v) => `<label class="check"><input type="checkbox" value="${escapar(v)}"${(f.valores || []).includes(v) ? " checked" : ""}> ${escapar(v)}</label>`;
  const comTexto = !porLista;
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Filtrar " + col.nome);
  pop.innerHTML = `<strong style="font-size:13px">Filtrar: ${escapar(col.nome)}</strong>
    ${comTexto ? `<input type="search" placeholder="Contém…" value="${escapar(f.texto || "")}" data-contem>` : ""}
    ${usarLista ? `<div class="opcoes">${valores.map(caixa).join("") || (removidos.length ? "" : '<span class="apoio">Sem valores.</span>')}
      ${removidos.length ? `<div class="filtro-removidas"><span class="apoio">Removidas da lista</span>${removidos.map(caixa).join("")}</div>` : ""}</div>` : ""}
    <div class="form-botoes"><button type="button" class="btn btn-secundario btn-mini" data-pop="limpar">Limpar</button><button type="button" class="btn btn-mini" data-pop="aplicar">Aplicar</button></div>
    <button type="button" class="item-menu" data-pop-cor>Cor da coluna…</button>`;
  posicionarPop(pop, botao);
  const entrada = pop.querySelector("input");
  if (entrada) entrada.focus();
  const aplicar = (limpar) => {
    estado.vista.filtros = estado.vista.filtros || {};
    if (limpar) delete estado.vista.filtros[c];
    else estado.vista.filtros[c] = { valores: $$("input[type=checkbox]:checked", pop).map((i) => i.value), texto: comTexto ? pop.querySelector("[data-contem]").value.trim() : "" };
    fecharPop(); salvarVista(); renderizarTudo();
  };
  pop.addEventListener("click", (e) => {
    if (e.target.closest("[data-pop-cor]")) { fecharPop(); if (aparencia) aparencia.corDaColuna(c); return; }
    const b = e.target.closest("[data-pop]"); if (b) aplicar(b.dataset.pop === "limpar");
  });
  pop.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-contem]")) { e.preventDefault(); aplicar(false); } });
}

/* ------------------------------------------------------------
 *  Barra: busca, agrupar, limpar, colunas, densidade, cartões, CSV, imprimir
 * ------------------------------------------------------------ */
let temporizadorBusca = 0;
$("#busca").addEventListener("input", (e) => { clearTimeout(temporizadorBusca); temporizadorBusca = setTimeout(() => { estado.busca = e.target.value; renderizarTudo(); }, 120); });
$("#agrupar").addEventListener("change", (e) => { estado.vista.agrupar = e.target.value; estado.gruposFechados.clear(); salvarVista(); renderizarTudo(); });
$("#btn-limpar-filtros").innerHTML = svg("i-fechar") + "Limpar filtros";
$("#btn-limpar-filtros").addEventListener("click", () => {
  estado.vista.filtros = {}; estado.vista.especial = ""; estado.busca = ""; $("#busca").value = "";
  if (VISOES_PRONTAS[estado.visao]) estado.visao = "padrao";
  salvarVista(); renderizarTudo();
});
$("#btn-colunas").innerHTML = svg("i-colunas");
$("#btn-densidade").innerHTML = svg("i-tabela");
$("#btn-csv").innerHTML = svg("i-download");
$("#btn-imprimir").innerHTML = svg("i-imprimir");
$("#btn-novo").innerHTML = svg("i-mais") + "Nova linha";
$("#btn-colar").innerHTML = svg("i-upload") + "Colar do Excel";
$("#btn-massa").innerHTML = svg("i-grade-lapis") + "Preencher em massa";
$("#btn-selecionar").innerHTML = svg("i-selecionar");
$("#btn-desfazer").innerHTML = svg("i-desfazer");
$("#btn-densidade").addEventListener("click", () => { estado.vista.compacta = !estado.vista.compacta; salvarVista(); renderizarTudo(); });
$("#btn-colunas").addEventListener("click", () => {
  const vis = new Set(estado.vista.colunas);
  const grupos = [...estado.estrutura.gruposColunas].sort((a, b) => a.ordem - b.ordem);
  const primeira = estado.vista.colunas[0];
  const d = criarDialogo({
    titulo: "Colunas (só para você)",
    corpo: `<p class="apoio">Mostre, oculte e reordene colunas só na sua visão. Para mudar as colunas de todos, use Planilha › Estrutura.</p>
      <div class="colunas-escolha">${grupos.map((g) => {
        const cols = colunasAtivas().filter((c) => c.grupo === g.id);
        if (!cols.length) return "";
        return `<fieldset><legend>${escapar(g.nome)}</legend>
          ${cols.map((c) => `<label class="check"><input type="checkbox" data-col-vis="${escapar(c.id)}"${vis.has(c.id) ? " checked" : ""}${c.id === primeira ? " disabled" : ""}> ${escapar(c.nome)}</label>`).join("")}</fieldset>`;
      }).join("")}</div>
      <fieldset class="pref-larguras"><legend>Largura das colunas</legend>
        <label class="check"><input type="radio" name="larguras" value="ajustar"${ajustarLarguras() ? " checked" : ""}> Ajustar colunas à largura (preenche a planilha; a largura arrastada é a mínima)</label>
        <label class="check"><input type="radio" name="larguras" value="fixas"${ajustarLarguras() ? "" : " checked"}> Larguras fixas (exatamente como arrastadas)</label></fieldset>
      <label class="check" style="margin-top:10px" title="Ponto cinza ao lado dos nomes que foram removidos da lista (o valor continua o mesmo)"><input type="checkbox" data-pref-marcador${mostrarMarcador() ? " checked" : ""}> Mostrar marcador de opções removidas</label>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-mascote>Mascote…</button><button type="button" class="btn btn-secundario" data-col-padrao>Voltar ao padrão</button><button type="submit" class="btn">Aplicar</button></div>`
  });
  d.querySelector("[data-mascote]").addEventListener("click", () => document.dispatchEvent(new CustomEvent("mascote:preferencias")));
  d.querySelector("[data-col-padrao]").addEventListener("click", () => {
    const padrao = colunasAtivas().map((c) => c.id);
    estado.vista.colunas = padrao; estado.vista.ocultas = []; estado.vista.larguras = {};
    salvarVista(); renderizarTudo(); d.close();
  });
  d.querySelector("form").addEventListener("submit", () => {
    const marcadas = new Set($$("[data-col-vis]:checked", d).map((i) => i.dataset.colVis));
    marcadas.add(primeira);
    const atuais = estado.vista.colunas.filter((c) => marcadas.has(c));
    colunasAtivas().forEach((c) => { if (marcadas.has(c.id) && !atuais.includes(c.id)) atuais.push(c.id); });
    estado.vista.colunas = atuais;
    estado.vista.ocultas = colunasAtivas().map((c) => c.id).filter((c) => !marcadas.has(c));
    gravarLocal(CHAVE_MARCADOR, d.querySelector("[data-pref-marcador]").checked);
    estado.vista.ajustarLarguras = d.querySelector('[name="larguras"]:checked').value !== "fixas";
    salvarVista(); renderizarTudo();
  });
  d.showModal();
});
const colunasExportaveis = () => estado.vista.colunas.filter((c) => COL[c]);
function csvCampo(t) { const s = String(t == null ? "" : t); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
$("#btn-csv").addEventListener("click", () => {
  if (!estado.estrutura) return;
  const cols = colunasExportaveis();
  const linhas = [cols.map((c) => csvCampo(COL[c].nome)).join(";"), ...ticketsFiltrados().map((t) => cols.map((c) => csvCampo(valorTexto(t, COL[c]))).join(";"))];
  const p = partesBrasilia();
  baixarArquivo(`${ID}-${p.ano}-${p.mes}-${p.dia}.csv`, "\ufeff" + linhas.join("\r\n"), "text/csv;charset=utf-8");
  mostrarAviso(`CSV com ${linhas.length - 1} linha(s) baixado.`);
});
$("#btn-imprimir").addEventListener("click", () => {
  if (!estado.estrutura) return;
  const cols = colunasExportaveis();
  $("#tabela-impressao").innerHTML = `<h1 style="font-size:14pt;margin-bottom:6px">${escapar(tituloPlanilha())} · ${escapar(formatarData(new Date(), true))}</h1><table><thead><tr>${cols.map((c) => `<th>${escapar(COL[c].nome)}</th>`).join("")}</tr></thead>
    <tbody>${ticketsFiltrados().map((t) => `<tr>${cols.map((c) => `<td>${escapar(valorTexto(t, COL[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  window.print();
});
/* Atalhos: "/" busca, Ctrl+Z desfaz, Alt+N nova linha (fora de campos) */
document.addEventListener("keydown", (e) => {
  if ($("#app").hidden || document.querySelector("dialog[open]")) return;
  const emCampo = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
  if (e.key === "/" && !emCampo) { e.preventDefault(); $("#busca").focus(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !emCampo) { e.preventDefault(); desfazer(); return; }
  if (e.key.toLowerCase() === "n" && e.altKey && podeAlimentar()) { e.preventDefault(); abrirNovoRegistro(); }
});

/* ------------------------------------------------------------
 *  Gravação (cada mudança leva um evento de histórico no mesmo lote)
 * ------------------------------------------------------------ */
function piscando(id) {
  const ate = estado.piscar.get(id);
  if (!ate) return false;
  if (ate < Date.now()) { estado.piscar.delete(id); return false; }
  return true;
}
const texto500 = (v) => String(v == null ? "" : v).slice(0, 500);
function textoDoValor(col, v) { return valorTexto({ campos: { [col.id]: v } }, col); }
function opHistorico(id, acao, extra = {}) {
  const hid = estado.api.novoId(`${LINHAS}/${id}/historico`);
  return { op: "set", caminho: `${LINHAS}/${id}/historico/${hid}`, dados: {
    acao, coluna: extra.coluna || "", colunaNome: texto500(extra.colunaNome).slice(0, 60),
    antes: texto500(extra.antes), depois: texto500(extra.depois), ...autoria("por"), em: "__AGORA__"
  } };
}

/* ------------------------------------------------------------
 *  Quem assina (como nos cadernos): administradora logada na Central = e-mail;
 *  sem login = o nome informado na primeira alteração, guardado neste navegador.
 * ------------------------------------------------------------ */
const limparNome = (t) => String(t || "").replace(/@/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
const lerTexto = (chave) => { try { return localStorage.getItem(chave) || ""; } catch (e) { return ""; } };
const nomeGuardado = () => limparNome(lerTexto(CHAVE_AUTOR));
const nomeSugerido = () => limparNome(lerTexto(CHAVE_AUTOR) || lerTexto("suporte-n2-autor-anotacao") || lerTexto("suporte-n2-autor-galeria"));
const autorAtual = () => (ehAdmin() ? estado.usuario.email : nomeGuardado());
const nomeAtual = () => (ehAdmin() ? estado.usuario.nome : nomeGuardado());
/* Sem o nome ainda, as escritas levam marcas que a conexão troca pelo nome pedido na hora de gravar */
const autoria = (prefixo) => ({ [prefixo]: autorAtual() || "__AUTOR__", [prefixo + "Nome"]: nomeAtual() || "__AUTOR_NOME__" });
const assinatura = () => ({ ...autoria("atualizadoPor"), atualizadoEm: "__AGORA__" });
let pedindoNome = null;
function pedirNome({ trocar = false } = {}) {
  if (pedindoNome) return pedindoNome;
  pedindoNome = new Promise((resolver) => {
    const d = criarDialogo({
      titulo: trocar ? "Trocar o nome" : "Antes de editar",
      corpo: `<label class="campo"><span class="rotulo">Seu nome (assina as suas alterações) *</span><input name="nome" maxlength="60" autocomplete="name" required value="${escapar(nomeSugerido())}"></label>
        <p class="apoio" style="font-size:13px">Aparece no histórico de cada linha e na auditoria da Central. Fica guardado neste navegador (é o mesmo nome dos cadernos).</p>
        <p class="form-erro" role="alert"></p>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Continuar</button></div>`
    });
    const form = d.querySelector("form");
    let ok = false;
    form.addEventListener("submit", (e) => {
      const nome = limparNome(form.nome.value);
      if (!nome) { e.preventDefault(); form.querySelector(".form-erro").textContent = "Informe o seu nome."; form.nome.setAttribute("aria-invalid", "true"); form.nome.focus(); return; }
      try { localStorage.setItem(CHAVE_AUTOR, nome); } catch (err) {}
      ok = true;
    });
    d.addEventListener("close", () => { pedindoNome = null; resolver(ok); });
    d.showModal();
    form.nome.focus();
    form.nome.select();
  });
  return pedindoNome;
}
async function exigirNome() {
  if (ehAdmin() || nomeGuardado()) return true;
  return pedirNome();
}

function mensagemErro(e) {
  const codigo = (e && e.code) || "";
  if (codigo === "sem-nome") return "Nada foi salvo: informe o seu nome para assinar a alteração.";
  if (/permission-denied/.test(codigo)) return ehAdmin()
    ? "O servidor recusou a gravação. Recarregue a página e tente de novo."
    : "O servidor recusou a mudança (por exemplo, numa coluna “Só administradoras”). Recarregue a página e tente de novo.";
  if (/resource-exhausted|quota/i.test(codigo)) return "O limite diário de gravações do plano gratuito acabou. Tente de novo amanhã.";
  if (/unavailable|network|deadline/.test(codigo)) return "Sem conexão. Tente de novo quando a internet voltar.";
  return "Não foi possível salvar agora. Tente de novo.";
}
function empilharDesfazer(rotulo, fn) {
  if (!fn) return;
  estado.desfazer.push({ rotulo, fn });
  if (estado.desfazer.length > 30) estado.desfazer.shift();
  atualizarBotoes();
}
async function gravar(ops, { desfazer: fn = null, rotulo = "" } = {}) {
  if (!conectado()) { mostrarAviso("Sem conexão: a edição está bloqueada."); return false; }
  try {
    await estado.api.lote(ops);
    empilharDesfazer(rotulo, fn);
    return true;
  } catch (e) {
    console.error(e);
    mostrarAviso(mensagemErro(e), 6000);
    return false;
  }
}
/* Escritas de uma mudança de campos, com o histórico de cada coluna no mesmo lote */
function opsAlteracao(t, mudancas, acao = "editar") {
  if (t.arquivo) return opsTirarDoArquivo(t, mudancas, acao);
  const ops = [{ op: "set", caminho: `${LINHAS}/${t.id}`, mesclar: true, dados: { campos: { ...mudancas }, ...assinatura() } }];
  Object.entries(mudancas).forEach(([c, v]) => {
    const col = COL[c];
    if (!col) return;
    ops.push(opHistorico(t.id, acao, { coluna: c, colunaNome: col.nome, antes: textoDoValor(col, (t.campos || {})[c]), depois: v === "__APAGAR__" ? "" : textoDoValor(col, v) }));
  });
  return ops;
}
/* Linha do arquivo editada: cria linhas/{mesmo id} com "parcial: true" e SÓ os campos alterados, que valem por cima
   da linha do arquivo (vazio é gravado como ""). Assim ninguém regrava as colunas que não pode alterar. */
function opsTirarDoArquivo(t, mudancas, acao) {
  const campos = Object.fromEntries(Object.entries(mudancas).map(([c, v]) => [c, v == null || v === "__APAGAR__" ? "" : v]));
  const ops = [{ op: "set", caminho: `${LINHAS}/${t.id}`, dados: { campos, parcial: true, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura() } }];
  Object.entries(mudancas).forEach(([c, v]) => {
    const col = COL[c];
    if (!col) return;
    ops.push(opHistorico(t.id, acao, { coluna: c, colunaNome: col.nome, antes: textoDoValor(col, (t.campos || {})[c]), depois: v === "__APAGAR__" ? "" : textoDoValor(col, v) }));
  });
  return ops;
}
async function salvarCampos(t, mudancas, { semDesfazer = false } = {}) {
  const reais = Object.fromEntries(Object.entries(mudancas).filter(([c, v]) => COL[c] && podeEditarCelula(t, COL[c])
    && JSON.stringify((t.campos || {})[c] ?? vazioDe(COL[c])) !== JSON.stringify(v ?? vazioDe(COL[c]))));
  if (!Object.keys(reais).length) return true;
  const antes = Object.fromEntries(Object.keys(reais).map((c) => [c, (t.campos || {})[c] ?? vazioDe(COL[c])]));
  return gravar(opsAlteracao(t, reais), {
    rotulo: "Edição desfeita",
    desfazer: semDesfazer ? null : async () => { const atual = porId(t.id); if (atual) return salvarCampos(atual, antes, { semDesfazer: true }); }
  });
}
const salvarCelula = (t, col, valor) => salvarCampos(t, { [col.id]: valor });

/* Só as colunas que a pessoa pode preencher entram na linha (as regras recusam o resto) */
function filtrarCamposPermitidos(campos) {
  const permitidas = new Set(colunasAtivas().filter((c) => podeNaLinhaNova(c)).map((c) => c.id));
  return Object.fromEntries(Object.entries(campos).filter(([c, v]) => permitidas.has(c) && !estaVazio(v)));
}
function resumoRegistro(campos) {
  const c = colTitulo();
  return c ? textoDoValor(c, campos[c.id]) : "";
}
/* Escritas de uma linha nova (linha nova, formulário e preenchimento em massa usam o mesmo caminho) */
function opsCriarRegistro(camposBrutos) {
  const campos = filtrarCamposPermitidos(camposBrutos);
  const id = estado.api.novoId(LINHAS);
  const ops = [
    { op: "set", caminho: `${LINHAS}/${id}`, dados: { campos, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura() } },
    opHistorico(id, "criar", { depois: resumoRegistro(campos) })
  ];
  return { id, campos, ops };
}
async function criarRegistro(camposBrutos, { semDesfazer = false } = {}) {
  const { id, ops } = opsCriarRegistro(camposBrutos);
  const ok = await gravar(ops, { rotulo: "Linha desfeita", desfazer: semDesfazer ? null : async () => desfazerCriacao([id]) });
  if (ok) document.dispatchEvent(new CustomEvent("planilha:salvou", { detail: { n: 1 } }));
  return ok ? id : null;
}
/* Desfazer um preenchimento em massa: só as linhas que ninguém alterou depois (administradora exclui; as outras pessoas, lixeira) */
function desfazerCriacaoEmMassa(ids) {
  return async () => {
    const intactos = ids.map(porId).filter((t) => t && String(t.atualizadoEm) === String(t.criadoEm)).map((t) => t.id);
    if (intactos.length) await desfazerCriacao(intactos);
    if (intactos.length < ids.length) mostrarAviso(`${ids.length - intactos.length} linha(s) foram alteradas depois e ficaram.`, 5000);
  };
}
/* Desfazer linhas criadas agora: a administradora exclui de vez; as outras pessoas mandam para a lixeira */
async function desfazerCriacao(ids) {
  if (ehAdmin()) return excluirDeVez(ids.map((id) => ({ id })), "Desfez a criação", { semAuditoria: true });
  const m = mapaTickets();
  return excluirParaLixeira(ids.map((id) => m.get(id)).filter(Boolean), "Desfeito logo depois de criar", { silencioso: true });
}
/* Linha completa: valores informados + padrões + a opção da aba aberta */
function completarCampos(informados) {
  const campos = {};
  const abas = colAbas();
  colunasAtivas().forEach((c) => {
    if (!podeNaLinhaNova(c)) return;
    if (c.id in informados && !estaVazio(informados[c.id])) campos[c.id] = informados[c.id];
    else if (estado.vista.aba !== "todos" && abas && c.id === abas.id && !opcaoRemovida(abas, estado.vista.aba)) campos[c.id] = estado.vista.aba;
    else { const p = valorPadrao(c); if (!estaVazio(p)) campos[c.id] = p; }
  });
  return campos;
}
async function avisarRepetido(erro) {
  if (await confirmar(erro.texto, { titulo: "Valor repetido", botao: "Abrir a linha existente" })) abrirFicha(erro.id);
}
/* ------------------------------------------------------------
 *  Edição na célula (um clique, Enter, F2 ou começando a digitar; Esc cancela)
 * ------------------------------------------------------------ */
function iniciarEdicao(id, c, { texto = null, viaClique = false } = {}) {
  const t = porId(id);
  const col = COL[c];
  if (!t || !col || estado.editando) return;
  if (!podeEditarCelula(t, col)) { if (!viaClique) mostrarAviso(motivoSemEdicao(t, col)); return; }
  garantirVisivel(indiceLinha(id), c);
  const cel = celulaEl(id, c);
  if (!cel) return;
  const linha = cel.closest(".linha");
  const box = document.createElement("div");
  box.className = "editor-celula";
  box.style.left = cel.offsetLeft + "px";
  box.style.top = "0px";
  box.style.width = Math.max(cel.offsetWidth, col.tipo === "textoLongo" ? 320 : col.tipo === "etiquetas" ? 220 : 160) + "px";
  box.style.height = ["textoLongo", "etiquetas"].includes(col.tipo) ? "auto" : "100%";
  const valor = (t.campos || {})[c];
  let campo;
  if (col.tipo === "etiquetas") campo = `<select multiple>${opcoesParaEscolha(col, valor).map((o) => `<option value="${escapar(o.id)}"${(valor || []).includes(o.id) ? " selected" : ""}>${escapar(rotuloEscolha(o))}</option>`).join("")}</select>`;
  else if (col.tipo === "textoLongo") campo = `<textarea maxlength="${LIMITES.textoLongo}">${escapar(valor || "")}</textarea>`;
  else campo = campoEntrada(col, valor, "");
  box.innerHTML = campo;
  linha.appendChild(box);
  linha.style.zIndex = 3;
  const entrada = box.firstElementChild;
  /* Lista pesquisável: o foco fica no texto e o valor no campo escondido */
  const ehCombo = entrada.classList.contains("combo");
  const foco = ehCombo ? entrada.querySelector(".combo-texto") : entrada;
  const campoValor = ehCombo ? entrada.querySelector('input[type="hidden"]') : entrada;
  estado.editando = { id, col: c, box };
  foco.focus({ preventScroll: true });
  if (texto != null) {
    /* Começou digitando: a tecla substitui o conteúdo */
    if (foco.tagName === "SELECT") {
      const n = normalizar(texto);
      const o = [...foco.options].find((x) => x.value && normalizar(x.textContent).startsWith(n));
      if (o) foco.value = o.value;
    } else if (!["date", "datetime-local"].includes(foco.type)) {
      foco.value = texto;
      if (ehCombo) foco.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  if (foco.tagName !== "SELECT" && !["date", "datetime-local"].includes(foco.type) && foco.setSelectionRange) {
    const fim = foco.value.length;
    try { foco.setSelectionRange(fim, fim); } catch { /* tipos sem cursor */ }
    foco.scrollLeft = foco.scrollWidth;
  }
  if (viaClique && ["date", "datetime-local"].includes(foco.type) && foco.showPicker) { try { foco.showPicker(); } catch { /* sem gesto */ } }
  let terminado = false;
  /* Devolve true quando fechou (salvou ou cancelou); false = valor inválido, a edição continua.
     voltarFoco: false quando a pessoa já clicou em outro lugar (o foco fica onde ela clicou). */
  const terminar = async (salvar, { voltarFoco = true } = {}) => {
    if (terminado) return true;
    if (ehCombo) { fecharCombo(); sairDoCombo(entrada); }
    let bruto = campoValor.value;
    if (col.tipo === "booleano") bruto = entrada.value === "sim";
    if (col.tipo === "etiquetas") bruto = [...entrada.selectedOptions].map((o) => o.value);
    if (salvar) {
      const r = valorOriginalMantido(campoValor, col) ? { ok: true, valor } : validarValor(col, bruto, valor);
      let erro = r.ok ? "" : r.erro;
      if (r.ok && col.obrigatoria && estaVazio(r.valor)) erro = `${col.nome} é obrigatório.`;
      if (r.ok && !erro && col.unica && !estaVazio(r.valor)) {
        const e = conferirRegistro({ ...(t.campos || {}), [c]: r.valor }, t.id)[c];
        if (e) erro = typeof e === "string" ? e : e.texto;
      }
      if (erro) {
        foco.setAttribute("aria-invalid", "true");
        let el = box.querySelector(".editor-erro");
        if (!el) { el = document.createElement("div"); el.className = "editor-erro"; el.setAttribute("role", "alert"); box.appendChild(el); }
        el.textContent = erro;
        foco.focus({ preventScroll: true });
        document.dispatchEvent(new CustomEvent("planilha:erro", { detail: { erro } }));
        return false;
      }
      terminado = true;
      estado.editando = null;
      box.remove();
      linha.style.zIndex = "";
      if (voltarFoco) { const el = celulaEl(id, c); if (el) el.focus({ preventScroll: true }); }
      /* A gravação segue em segundo plano: Tab/Enter já vão para a próxima célula */
      salvarCelula(t, col, r.valor).then(() => { if (renderPendente) agendarRender(); });
      return true;
    } else {
      terminado = true;
      estado.editando = null;
      box.remove();
      linha.style.zIndex = "";
      if (voltarFoco) { const el = celulaEl(id, c); if (el) el.focus({ preventScroll: true }); }
    }
    if (renderPendente) agendarRender();
    return true;
  };
  estado.editando.confirmar = () => terminar(true, { voltarFoco: false });
  entrada.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); terminar(false); return; }
    if (e.key === "Enter" && e.altKey && col.tipo === "textoLongo") {
      /* Alt+Enter: quebra de linha dentro do texto */
      e.preventDefault();
      const a = foco.selectionStart, b = foco.selectionEnd;
      foco.setRangeText("\n", a, b, "end");
      return;
    }
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault(); e.stopPropagation();
      if (await terminar(true)) irParaVertical(id, c, e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      if (await terminar(true, { voltarFoco: false })) irParaProxima(id, c, e.shiftKey ? -1 : 1, true);
    }
  });
  foco.addEventListener("blur", () => setTimeout(() => { if (!terminado && !box.contains(document.activeElement)) terminar(true, { voltarFoco: false }); }, 0));
}

/* Linha nova (fim da grade) */
async function salvarLinhaNova() {
  if (!podeAlimentar()) return;
  const campos = $$("#planilha .linha-nova [data-nova]");
  const informados = {};
  let erro = "";
  campos.forEach((el) => {
    el.removeAttribute("aria-invalid");
    const col = COL[el.dataset.nova];
    if (!col || el.value === "") return;
    const r = validarValor(col, col.tipo === "booleano" ? el.value === "sim" : el.value);
    if (!r.ok) { el.setAttribute("aria-invalid", "true"); erro = erro || r.erro; } else informados[col.id] = r.valor;
  });
  if (!Object.keys(informados).length) { mostrarAviso("Preencha a linha antes de registrar."); return; }
  const completos = completarCampos(informados);
  const erros = conferirRegistro(completos);
  const [primeiro] = Object.entries(erros);
  if (!erro && primeiro) {
    const [c, e] = primeiro;
    const el = $(`#planilha .linha-nova [data-nova="${CSS.escape(c)}"]`);
    if (el) el.setAttribute("aria-invalid", "true");
    if (typeof e === "object") { avisarRepetido(e); return; }
    erro = el ? e : `${e} Use “Nova linha” para preencher todas as colunas.`;
  }
  if (erro) { mostrarAviso(erro, 5000); return; }
  const id = await criarRegistro(completos);
  if (!id) return;
  campos.forEach((el) => { el.value = ""; });
  $$("#planilha .linha-nova .combo-texto").forEach((el) => { el.value = ""; });
  estado.piscar.set(id, Date.now() + 3500);
  mostrarAviso("Registro adicionado. A linha nova está pronta para o próximo.");
  focarLinhaNova();
}

/* ------------------------------------------------------------
 *  Novo registro (formulário completo, com rascunho no navegador)
 * ------------------------------------------------------------ */
function htmlCamposFormulario(valores, filtro) {
  const grupos = [...estado.estrutura.gruposColunas].sort((a, b) => a.ordem - b.ordem);
  return grupos.map((g) => {
    const cols = colunasAtivas().filter((c) => c.grupo === g.id && filtro(c));
    if (!cols.length) return "";
    return `<fieldset><legend>${escapar(g.nome)}</legend>${cols.map((c) => {
      const largo = ["textoLongo", "etiquetas"].includes(c.tipo) || c.id === "resumo";
      let entrada;
      if (c.tipo === "textoLongo") entrada = `<textarea name="${escapar(c.id)}" maxlength="${LIMITES.textoLongo}" rows="3">${escapar(valores[c.id] || "")}</textarea>`;
      else if (c.tipo === "etiquetas") entrada = `<div style="display:flex;flex-wrap:wrap;gap:8px 14px">${opcoesParaEscolha(c, valores[c.id]).map((o) => `<label class="check"${o.ativa === false ? ` title="${escapar(textoRemovida(o))}"` : ""}><input type="checkbox" name="${escapar(c.id)}" value="${escapar(o.id)}"${(valores[c.id] || []).includes(o.id) ? " checked" : ""}> ${escapar(rotuloEscolha(o))}</label>`).join("")}</div>`;
      else entrada = campoEntrada(c, valores[c.id], `name="${escapar(c.id)}" id="f-${escapar(c.id)}"`);
      return `<label class="campo${largo ? " largo" : ""}"><span class="rotulo">${escapar(c.nome)}${c.obrigatoria ? ' <span class="obrig">*</span>' : ""}${c.somenteAdmin ? ` <span title="${escapar(TEXTO_BLOQUEADO)}">${svg("i-cadeado", "icone cadeado")}</span>` : ""}</span>${entrada}${c.ajuda ? `<span class="ajuda">${escapar(c.ajuda)}</span>` : ""}</label>`;
    }).join("")}</fieldset>`;
  }).join("");
}
/* atuais: campos que a linha já tem (edição na ficha); opções removidas da lista só passam se já estavam lá */
function lerFormulario(form, cols, atuais = {}) {
  const valores = {}, erros = {};
  cols.forEach((c) => {
    let bruto, el = null;
    if (c.tipo === "etiquetas") bruto = $$(`[name="${CSS.escape(c.id)}"]:checked`, form).map((i) => i.value);
    else { el = form.elements[c.id]; if (!el) return; bruto = c.tipo === "booleano" ? el.value === "sim" : el.value; }
    const r = valorOriginalMantido(el, c) ? { ok: true, valor: el.dataset.original } : validarValor(c, bruto, atuais[c.id]);
    if (r.ok) valores[c.id] = r.valor; else erros[c.id] = r.erro;
  });
  return { valores, erros };
}
function marcarErros(form, erros) {
  $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
  Object.keys(erros).forEach((c) => {
    let el = form.elements[c];
    if (el && el.type === "hidden" && el.closest(".combo")) el = el.closest(".combo").querySelector(".combo-texto");
    if (el && el.setAttribute) el.setAttribute("aria-invalid", "true");
  });
}
function abrirNovoRegistro() {
  if (!podeAlimentar()) { mostrarAviso(conectado() ? "Seu acesso é só de leitura." : "Sem conexão: a edição está bloqueada."); return; }
  const chaveRascunho = chaveUsuario("rascunho");
  const rascunho = lerLocal(chaveRascunho, null);
  const valores = rascunho && rascunho.valores ? rascunho.valores : completarCampos({});
  const cols = colunasAtivas().filter(podeNaLinhaNova);
  const d = criarDialogo({
    titulo: "Nova linha",
    largo: true,
    corpo: `<p class="lgpd"><strong>LGPD:</strong> não registre CPF/CNPJ completo, RG, endereço, telefone pessoal nem dados de saúde.</p>
      ${rascunho ? `<p class="apoio">Rascunho recuperado deste navegador (${escapar(formatarData(rascunho.em, true))}). <button type="button" class="btn-link" data-limpar-rascunho>Começar do zero</button></p>` : ""}
      <div class="form-registro">${htmlCamposFormulario(valores, podeNaLinhaNova)}</div>
      <div id="aviso-repetido"></div>
      <p class="form-erro" role="alert" id="novo-erro"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}Registrar</button></div>`
  });
  const form = d.querySelector("form");
  let tempo = 0;
  const guardar = () => { clearTimeout(tempo); tempo = setTimeout(() => gravarLocal(chaveRascunho, { em: new Date().toISOString(), valores: lerFormulario(form, cols).valores }), 300); };
  const conferirNumero = () => {
    const k = (colChave() || {}).id || "";
    const el = form.elements[k];
    const caixa = $("#aviso-repetido", d);
    if (!el || !el.value.trim()) { caixa.innerHTML = ""; return; }
    const e = conferirRegistro({ [k]: el.value })[k];
    caixa.innerHTML = e && typeof e === "object" ? `<div class="aviso-repetido">${svg("i-alerta")}<span>${escapar(e.texto)}</span><button type="button" class="btn btn-secundario btn-mini" data-abrir-existente="${escapar(e.id)}">Abrir a linha existente</button></div>` : "";
  };
  form.addEventListener("input", (e) => { guardar(); if (colChave() && e.target.name === colChave().id) conferirNumero(); });
  form.addEventListener("change", guardar);
  d.addEventListener("click", (e) => {
    const ab = e.target.closest("[data-abrir-existente]");
    if (ab) { d.close(); abrirFicha(ab.dataset.abrirExistente); }
    if (e.target.closest("[data-limpar-rascunho]")) { apagarLocal(chaveRascunho); d.close(); setTimeout(abrirNovoRegistro, 320); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { valores: lidos, erros } = lerFormulario(form, cols);
    const regras = conferirRegistro(lidos);
    Object.entries(regras).forEach(([c, x]) => { if (!erros[c]) erros[c] = typeof x === "object" ? x.texto : x; });
    marcarErros(form, erros);
    if (Object.keys(erros).length) { $("#novo-erro", d).textContent = Object.values(erros).join(" · "); conferirNumero(); return; }
    const botao = form.querySelector('[type="submit"]');
    botao.disabled = true;
    const id = await criarRegistro(lidos);
    botao.disabled = false;
    if (!id) return;
    apagarLocal(chaveRascunho);
    clearTimeout(tempo);
    d.close();
    estado.piscar.set(id, Date.now() + 3500);
    mostrarAviso("Linha adicionada.");
    setTimeout(() => irPara(id), 400);
  });
  d.addEventListener("close", () => clearTimeout(tempo));
  d.showModal();
  const primeiro = form.querySelector("input:not([type=checkbox]):not([type=hidden]), select, textarea");
  if (primeiro) primeiro.focus();
  conferirNumero();
}
$("#btn-novo").addEventListener("click", abrirNovoRegistro);
function irPara(id) {
  if (!$("#planilha")) return;
  const i = estado.linhas.findIndex((l) => l.tipo === "linha" && l.t.id === id);
  if (i < 0) return;
  $("#planilha").scrollTop = Math.max(0, i * alturaLinha() - 100);
  pintarLinhas(true);
  selecionar(id, estado.vista.colunas[0], true);
}

/* ------------------------------------------------------------
 *  Colar do Excel / importar CSV (com conferência e mapeamento)
 *  Todos adicionam e atualizam (pela coluna de valor único). Administradoras: também substituem tudo.
 * ------------------------------------------------------------ */
function lerTabelaTexto(texto) {
  const t = String(texto || "").replace(/^\ufeff/, "");
  const primeira = t.split(/\r?\n/)[0] || "";
  const sep = primeira.includes("\t") ? "\t" : (primeira.split(";").length >= primeira.split(",").length ? ";" : ",");
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"' && campo === "") aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((x) => x.trim())) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim())) linhas.push(linha);
  return linhas;
}
function adivinharColuna(cabecalho, cols) {
  const n = normalizar(cabecalho).replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return "";
  const limpo = (x) => normalizar(x).replace(/[^a-z0-9]+/g, " ").trim();
  const exato = cols.find((c) => limpo(c.nome) === n || normalizar(c.id) === n.replace(/ /g, ""));
  if (exato) return exato.id;
  const parecida = cols.find((c) => nomesEquivalentes(c.nome, cabecalho, true));
  if (parecida) return parecida.id;
  return (cols.find((c) => n.includes(limpo(c.nome)) && limpo(c.nome).length > 3) || {}).id || "";
}
function abrirColar(textoInicial = "") {
  if (!podeAlimentar()) { mostrarAviso(motivoSemEdicao()); return; }
  const cols = colunasAtivas().filter(podeNaLinhaNova);
  const admin = ehAdmin();
  const chave = colChave();
  const d = criarDialogo({
    titulo: "Colar do Excel",
    largo: true,
    corpo: `<p class="lgpd"><strong>LGPD:</strong> deixe como “Ignorar” colunas de CPF/CNPJ completo, RG, endereço, telefone pessoal ou saúde.</p>
      <div class="campos-linha">
        <label class="campo"><span class="rotulo">Cole aqui as células do Excel (com o cabeçalho)</span><textarea name="colado" rows="6" placeholder="${escapar(cols.slice(0, 3).map((c) => c.nome).join("\t"))}…"></textarea></label>
        <div class="campo"><label class="campo"><span class="rotulo">Ou escolha um arquivo .csv</span><input type="file" name="arquivo" accept=".csv,text/csv,.txt"></label>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="cabecalho" checked> A primeira linha é o cabeçalho</label>
          <label class="campo" style="margin-top:8px"><span class="rotulo">O que fazer</span><select name="modo">
            <option value="adicionar">Só adicionar linhas novas</option>
            ${chave ? `<option value="atualizar">Atualizar pela coluna ${escapar(chave.nome)} (e adicionar as novas)</option>` : ""}
            ${admin ? '<option value="substituir">Substituir TODAS as linhas (faz backup antes)</option>' : ""}</select>
            ${chave ? "" : '<span class="ajuda">Para atualizar linhas que já existem, marque uma coluna como “Valor único” na Estrutura.</span>'}</label>
        </div>
      </div>
      <div id="colar-conferencia"></div>
      <p class="form-erro" role="alert" id="colar-erro"></p>
      <p class="apoio" id="colar-progresso" role="status"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn" id="colar-ok" disabled>Conferir</button></div>`
  });
  const form = d.querySelector("form");
  let tabela = [];
  let analise = null;
  const modo = () => form.modo.value;
  /* Linhas que já existem, pela coluna de valor único */
  const indice = new Map();
  if (chave) estado.tickets.forEach((t) => { const v = (t.campos || {})[chave.id]; if (!estaVazio(v) && !indice.has(chaveValor(v))) indice.set(chaveValor(v), t); });
  /* Valores de LISTA que não são opções: "sugestao" (usa a mais parecida), "vazio" ou "" (a linha não entra) */
  const trocas = new Map();
  const analisar = () => {
    const cab = form.cabecalho.checked;
    const titulos = cab ? tabela[0] || [] : (tabela[0] || []).map((_, i) => `Coluna ${i + 1}`);
    const dados = cab ? tabela.slice(1) : tabela;
    const mapa = $$("[data-mapa]", d).length ? $$("[data-mapa]", d).map((s) => s.value) : (() => { const usados = new Set(); return titulos.map((t) => { const k = adivinharColuna(t, cols); if (k && !usados.has(k)) { usados.add(k); return k; } return ""; }); })();
    const vistos = new Set();
    const fora = new Map();
    const linhas = dados.map((l) => {
      const informados = {}, erros = [], celulasFora = new Set();
      mapa.forEach((c, i) => {
        if (!c) return;
        const bruto = String(l[i] ?? "").trim();
        if (!bruto) return;
        const r = validarValor(COL[c], bruto);
        if (r.ok) { informados[c] = r.valor; return; }
        if (!TIPOS_LISTA.includes(COL[c].tipo) || COL[c].tipo === "etiquetas") { erros.push(r.erro); return; }
        const k = `${c}|${nomeComparavel(bruto)}`;
        const f = fora.get(k) || { chave: k, col: COL[c], bruto, n: 0, sugestao: r.sugestao || null, removida: r.removida || null };
        f.n++;
        fora.set(k, f);
        const escolha = trocas.get(k) || "";
        if (escolha === "sugestao" && f.sugestao) informados[c] = f.sugestao.id;
        else if (escolha === "aceitar" && f.removida && ehAdmin()) informados[c] = f.removida.id;
        else if (escolha !== "vazio") { erros.push(r.erro); celulasFora.add(i); }
      });
      const campos = completarCampos(informados);
      const k = chave && !estaVazio(campos[chave.id]) ? chaveValor(campos[chave.id]) : "";
      const existente = k ? indice.get(k) || null : null;
      const repetidoNoColado = k && vistos.has(k);
      if (k) vistos.add(k);
      const m = modo();
      const conf = conferirRegistro(campos, existente && m === "atualizar" ? existente.id : undefined);
      Object.entries(conf).forEach(([c, x]) => { if (typeof x === "string") erros.push(x); else if (!(chave && c === chave.id)) erros.push(x.texto); });
      let situacao = erros.length ? "erro" : "nova";
      if (!erros.length && repetidoNoColado) { situacao = "erro"; erros.push(`${chave.nome} repetido na própria colagem.`); }
      else if (!erros.length && existente && m !== "substituir") situacao = m === "atualizar" ? "atualizar" : "repetido";
      return { campos, informados, erros, situacao, existente, original: l, celulasFora };
    });
    analise = { titulos, mapa, linhas, fora: [...fora.values()] };
    return analise;
  };
  const desenhar = () => {
    if (!tabela.length) { $("#colar-conferencia", d).innerHTML = ""; $("#colar-ok", d).disabled = true; return; }
    const a = analisar();
    const conta = (s) => a.linhas.filter((l) => l.situacao === s).length;
    $("#colar-conferencia", d).innerHTML = `
      <h3 style="font-size:15px">Conferência: ${a.linhas.length} linha(s) · ${conta("nova")} nova(s)${conta("atualizar") ? ` · ${conta("atualizar")} para atualizar` : ""}${conta("repetido") ? ` · ${conta("repetido")} já existe(m) e será(ão) ignorada(s)` : ""}${conta("erro") ? ` · <span style="color:var(--erro-texto)">${conta("erro")} com erro (não entram)</span>` : ""}</h3>
      <div class="mapa-colunas">${a.titulos.map((t, i) => `<label><span>${escapar(t || "(sem título)")} <span class="apoio">ex.: ${escapar(String((a.linhas[0] ? a.linhas[0].original[i] : "") || "").slice(0, 30))}</span></span>
        <select data-mapa="${i}"><option value="">Ignorar</option>${cols.map((c) => `<option value="${escapar(c.id)}"${a.mapa[i] === c.id ? " selected" : ""}>${escapar(c.nome)}</option>`).join("")}</select></label>`).join("")}</div>
      ${a.fora.length ? `<div class="fora-colagem"><h3 style="font-size:14px">Valores fora da lista (${a.fora.length})</h3>
        <p class="apoio" style="font-size:13px">Só entram opções que já existem. Escolha o que fazer com cada valor; enquanto não escolher, a linha não é gravada.</p>
        ${a.fora.map((f) => `<label><span><strong>${escapar(f.col.nome)}</strong>: <span class="valor-fora">“${escapar(f.bruto)}”</span>${f.removida ? ' <span class="apoio">Removido da lista: escolha outra opção ou deixe vazio</span>' : ""} · ${f.n} linha(s)</span>
          <select data-troca="${escapar(f.chave)}"><option value="">Corrigir depois (a linha não entra)</option>${f.removida && ehAdmin() ? `<option value="aceitar"${trocas.get(f.chave) === "aceitar" ? " selected" : ""}>Aceitar mesmo assim (manter o nome)</option>` : ""}${f.sugestao ? `<option value="sugestao"${trocas.get(f.chave) === "sugestao" ? " selected" : ""}>Usar “${escapar(f.sugestao.nome)}”</option>` : ""}<option value="vazio"${trocas.get(f.chave) === "vazio" ? " selected" : ""}>Deixar o campo vazio</option></select></label>`).join("")}</div>` : ""}
      <div class="previa-import"><table><thead><tr><th>Situação</th>${a.titulos.map((t) => `<th>${escapar(t)}</th>`).join("")}</tr></thead><tbody>${a.linhas.slice(0, 50).map((l) => `<tr class="${l.situacao === "erro" ? "com-erro" : l.situacao === "repetido" ? "repetido" : ""}"><td>${escapar(l.situacao === "erro" ? l.erros.join(" ") : l.situacao === "repetido" ? "Já existe" : l.situacao === "atualizar" ? "Atualizar" : "Nova")}</td>${a.titulos.map((_, i) => `<td${l.celulasFora.has(i) ? ' class="celula-fora"' : ""}>${escapar(String(l.original[i] || "").slice(0, 40))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const validas = a.linhas.filter((l) => ["nova", "atualizar"].includes(l.situacao)).length;
    $("#colar-ok", d).disabled = !validas && modo() !== "substituir";
    $("#colar-ok", d).textContent = modo() === "substituir" ? `Substituir por ${validas} linha(s)` : `Gravar ${validas} linha(s)`;
  };
  form.colado.addEventListener("input", () => { tabela = lerTabelaTexto(form.colado.value); $("#colar-conferencia", d).innerHTML = ""; desenhar(); });
  form.cabecalho.addEventListener("change", () => { $("#colar-conferencia", d).innerHTML = ""; desenhar(); });
  form.modo.addEventListener("change", desenhar);
  d.addEventListener("change", (e) => {
    if (e.target.matches("[data-troca]")) { trocas.set(e.target.dataset.troca, e.target.value); desenhar(); }
    if (e.target.matches("[data-mapa]")) desenhar();
  });
  form.arquivo.addEventListener("change", async () => {
    const f = form.arquivo.files[0];
    if (!f) return;
    if (f.size > 3_000_000) { $("#colar-erro", d).textContent = "Arquivo grande demais (máx. 3 MB)."; return; }
    let texto = await f.text();
    if (texto.includes("\ufffd")) { try { texto = new TextDecoder("windows-1252").decode(await f.arrayBuffer()); } catch (e) {} }
    tabela = lerTabelaTexto(texto);
    $("#colar-conferencia", d).innerHTML = "";
    desenhar();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!analise) return;
    const m = modo();
    const validas = analise.linhas.filter((l) => ["nova", "atualizar"].includes(l.situacao));
    if (validas.length > 2000) { $("#colar-erro", d).textContent = "Cole no máximo 2.000 linhas por vez."; return; }
    if (!(await exigirNome())) return;
    const botao = $("#colar-ok", d);
    botao.disabled = true;
    const progresso = $("#colar-progresso", d);
    if (m === "substituir") {
      if (!admin) { botao.disabled = false; return; }
      if (!(await confirmarDigitando(`Isso apaga as ${estado.tickets.length} linhas atuais e grava ${validas.length} no lugar. Um backup é feito antes.`, "SUBSTITUIR", { titulo: "Substituir todas as linhas", botao: "Substituir" }))) { botao.disabled = false; return; }
      progresso.textContent = "Fazendo backup…";
      if (!(await criarBackup("Antes de substituir todas as linhas pela colagem"))) { botao.disabled = false; progresso.textContent = ""; return; }
      progresso.textContent = "Apagando as linhas atuais…";
      try { await gravarArquivo([], { apagarVivos: estado.vivos }); await apagarLixeira(estado.lixeira.map((x) => x.id)); }
      catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); botao.disabled = false; progresso.textContent = ""; return; }
    }
    const ops = [], ids = [];
    validas.forEach((l) => {
      if (l.situacao === "atualizar" && m === "atualizar") { ops.push(...opsAlteracao(l.existente, { ...l.informados }, "importar")); return; }
      const id = estado.api.novoId(LINHAS);
      ids.push(id);
      const campos = filtrarCamposPermitidos(l.campos);
      ops.push({ op: "set", caminho: `${LINHAS}/${id}`, dados: { campos, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura() } });
      ops.push(opHistorico(id, "importar", { depois: resumoRegistro(campos) }));
    });
    progresso.textContent = `Gravando ${validas.length} linha(s)…`;
    const ok = await gravar(ops, { rotulo: "Colagem desfeita", desfazer: ids.length ? async () => desfazerCriacao(ids) : null });
    progresso.textContent = "";
    if (ok) {
      ids.forEach((id) => estado.piscar.set(id, Date.now() + 3500));
      if (m === "substituir") registrarAuditoria("excluir", `Substituiu todas as linhas pela colagem (${validas.length} linha(s))`);
      d.close();
      mostrarAviso(`${validas.length} linha(s) gravada(s).`, 6000);
    } else { botao.disabled = false; $("#colar-erro", d).textContent = "Nada foi gravado. Confira a conexão e tente de novo."; }
  });
  d.showModal();
  if (textoInicial) { form.colado.value = textoInicial; tabela = lerTabelaTexto(textoInicial); desenhar(); }
  form.colado.focus();
}
$("#btn-colar").addEventListener("click", () => abrirColar());
$("#btn-massa").addEventListener("click", abrirPreencherMassa);

/* ------------------------------------------------------------
 *  Ações da linha e ficha lateral (ver, editar, histórico, excluir)
 * ------------------------------------------------------------ */
function executarAcao(acao, t, botao) {
  if (!t) return;
  if (acao === "ficha") { abrirFicha(t.id); return; }
  if (acao !== "mais") return;
  fecharPop();
  const itens = [
    ["ficha", "i-olho", "Ver ficha e histórico"],
    ...(podeEditarLinha(t) ? [["editar", "i-lapis", "Editar na ficha"]] : []),
    ["copiar", "i-copiar", "Copiar resumo"],
    ...(podeAlimentar() ? [["excluir", "i-lixeira", "Excluir (vai para a Lixeira)", "perigo"]] : [])
  ];
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.style.width = "250px";
  pop.setAttribute("role", "menu");
  pop.innerHTML = itens.map(([id, icone, nome, classe]) => `<button type="button" class="item-menu${classe ? " " + classe : ""}" role="menuitem" data-m="${id}">${svg(icone)}${escapar(nome)}</button>`).join("");
  posicionarPop(pop, botao, 250);
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    fecharPop();
    const m = b.dataset.m;
    if (m === "ficha") abrirFicha(t.id);
    if (m === "editar") abrirFicha(t.id, true);
    if (m === "copiar") copiarTexto(textoRegistro(t)).then((ok) => mostrarAviso(ok ? "Resumo copiado." : "Não foi possível copiar."));
    if (m === "excluir") excluirParaLixeira([t]);
  });
  pop.querySelector("button").focus();
}
const textoRegistro = (t) => colunasAtivas().map((c) => { const v = valorTexto(t, c); return v ? `${c.nome}: ${v}` : ""; }).filter(Boolean).join("\n");

const ficha = $("#ficha");
let pararHistorico = null;
function fecharFicha() {
  ficha.classList.remove("aberta");
  if (pararHistorico) { pararHistorico(); pararHistorico = null; }
  setTimeout(() => { if (!ficha.classList.contains("aberta")) ficha.hidden = true; }, 220);
}
function abrirFicha(id, editar = false) {
  const t = porId(id);
  if (!t) return;
  if (editar && !podeEditarLinha(t)) editar = false;
  const grupos = [...estado.estrutura.gruposColunas].sort((a, b) => a.ordem - b.ordem);
  const tc = colTitulo();
  const titulo = (tc && valorTexto(t, tc)) || "Linha";
  let corpo;
  if (!editar) {
    corpo = grupos.map((g) => {
      const itens = colunasAtivas().filter((c) => c.grupo === g.id && valorTexto(t, c));
      if (!itens.length) return "";
      return `<section class="ficha-grupo"><h3>${escapar(g.nome)}</h3><dl>${itens.map((c) => `<dt>${escapar(c.nome)}</dt><dd>${TIPOS_LISTA.includes(c.tipo) || ["link", "booleano"].includes(c.tipo) ? htmlValor(t, c) : escapar(tituloCelula(t, c))}</dd>`).join("")}</dl></section>`;
    }).join("");
    /* Registrado/atualizado por/em: na ficha mesmo quando as colunas automáticas estão fora da grade */
    if (!colunasAtivas().some((c) => c.tipo === "automatico")) {
      const controle = [["Registrado por", nomeAutor(t, "criadoPor"), emailAutor(t, "criadoPor")], ["Registrado em", formatarData(t.criadoEm, true)],
        ["Atualizado por", nomeAutor(t, "atualizadoPor"), emailAutor(t, "atualizadoPor")], ["Atualizado em", formatarData(t.atualizadoEm, true)]].filter(([, v]) => v);
      if (controle.length) corpo += `<section class="ficha-grupo"><h3>Controle</h3><dl>${controle.map(([n, v, e]) => `<dt>${escapar(n)}</dt><dd${e ? ` title="${escapar(e)}"` : ""}>${escapar(v)}</dd>`).join("")}</dl></section>`;
    }
    /* Colunas arquivadas: os valores continuam guardados (só leitura) */
    const arquivadas = estado.estrutura.colunas.filter((c) => !c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo) && valorTexto(t, c));
    if (arquivadas.length) corpo += `<details class="ficha-grupo campos-arquivados"><summary>Campos arquivados (${arquivadas.length})</summary><dl>${arquivadas.map((c) => `<dt>${escapar(c.nome)}</dt><dd>${escapar(valorTexto(t, c))}</dd>`).join("")}</dl></details>`;
  } else {
    corpo = `<p class="lgpd"><strong>LGPD:</strong> não registre CPF/CNPJ completo, RG, endereço, telefone pessoal nem dados de saúde.</p>
      <div class="form-registro">${htmlCamposFormulario(t.campos || {}, (c) => podeEditarCelula(t, c))}</div><p class="form-erro" role="alert" id="ficha-erro"></p>`;
  }
  const botoes = editar
    ? `<button type="button" class="btn btn-secundario" data-ficha="ver">Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}Salvar</button>`
    : [
      podeAlimentar() ? `<button type="button" class="btn btn-perigo btn-mini" data-ficha="excluir">${svg("i-lixeira")}Excluir</button>` : "",
      `<button type="button" class="btn btn-secundario btn-mini" data-ficha="copiar">${svg("i-copiar")}Copiar</button>`,
      podeEditarLinha(t) ? `<button type="button" class="btn" data-ficha="editar">${svg("i-lapis")}Editar</button>` : ""
    ].join("");
  ficha.innerHTML = `<form class="ficha-corpo" novalidate>
    <div class="form-topo"><h2>${escapar(titulo)}</h2>
      <button type="button" class="perfil-fechar" data-ficha="fechar" aria-label="Fechar ficha">${svg("i-fechar")}</button></div>
    ${!editar && !podeEditarLinha(t) ? `<p class="apoio" style="font-size:13px">${svg("i-cadeado", "icone cadeado")} ${escapar(motivoSemEdicao(t))}</p>` : ""}
    ${corpo}
    <div class="form-botoes">${botoes}</div>
    ${editar ? "" : `<section class="ficha-grupo"><h3>Histórico</h3><ul class="historico" id="ficha-historico"><li>Carregando…</li></ul></section>`}
  </form>`;
  ficha.dataset.id = id;
  ficha.dataset.editando = editar ? "1" : "";
  ficha.hidden = false;
  requestAnimationFrame(() => ficha.classList.add("aberta"));
  const primeiro = ficha.querySelector(editar ? "input:not([type=hidden]), select, textarea" : "[data-ficha]");
  if (primeiro) primeiro.focus();
  if (pararHistorico) { pararHistorico(); pararHistorico = null; }
  if (!editar && estado.api) {
    pararHistorico = estado.api.ouvirColecao(`${LINHAS}/${id}/historico`, (lista) => {
      const el = $("#ficha-historico");
      if (!el) return;
      el.innerHTML = lista.length ? lista.map((h) => {
        const quem = `<span title="${escapar(String(h.por || "").includes("@") ? h.por : "")}">${escapar(h.porNome || nomePessoa(h.por))}</span>`;
        let oque;
        if (h.acao === "criar") oque = `registrou${h.depois ? `: ${escapar(h.depois)}` : ""}`;
        else if (h.acao === "importar" && !h.coluna) oque = "colou a linha do Excel";
        else if (h.acao === "excluir") oque = `mandou para a Lixeira${h.depois ? `: ${escapar(h.depois)}` : ""}`;
        else if (h.acao === "restaurar") oque = "restaurou da Lixeira";
        else oque = `mudou <strong>${escapar(h.colunaNome || h.coluna)}</strong>: ${escapar(h.antes || "(vazio)")} → ${escapar(h.depois || "(vazio)")}`;
        if (h.acao === "substituirValor") oque += " (substituição de valor)";
        return `<li><span class="quando">${escapar(formatarData(h.em, true))}</span>${quem} ${oque}</li>`;
      }).join("") : "<li>Sem eventos registrados.</li>";
    }, () => { const el = $("#ficha-historico"); if (el) el.innerHTML = "<li>Não foi possível carregar o histórico.</li>"; }, { ordenar: "em", desc: true, limite: 100 });
  }
}
ficha.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ficha]");
  if (!b) return;
  const t = porId(ficha.dataset.id);
  const a = b.dataset.ficha;
  if (a === "fechar") { fecharFicha(); return; }
  if (!t) return;
  if (a === "editar") abrirFicha(t.id, true);
  if (a === "ver") abrirFicha(t.id, false);
  if (a === "copiar") copiarTexto(textoRegistro(t)).then((ok) => mostrarAviso(ok ? "Resumo copiado." : "Não foi possível copiar."));
  if (a === "excluir") excluirParaLixeira([t]);
});
ficha.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = porId(ficha.dataset.id);
  if (!t || !podeEditarLinha(t)) return;
  const form = e.target;
  const cols = colunasAtivas().filter((c) => podeEditarCelula(t, c));
  const { valores, erros } = lerFormulario(form, cols, t.campos || {});
  const conf = conferirRegistro({ ...(t.campos || {}), ...valores }, t.id);
  Object.entries(conf).forEach(([c, x]) => { if (!erros[c] && cols.some((k) => k.id === c)) erros[c] = typeof x === "object" ? x.texto : x; });
  marcarErros(form, erros);
  if (Object.keys(erros).length) { $("#ficha-erro").textContent = Object.values(erros).join(" · "); return; }
  if (await salvarCampos(t, valores)) { mostrarAviso("Linha salva."); setTimeout(() => abrirFicha(t.id, false), 150); }
});
ficha.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); fecharFicha(); } });

/* Desfazer a última ação (enquanto a página estiver aberta) */
async function desfazer() {
  const a = estado.desfazer.pop();
  atualizarBotoes();
  if (!a) { mostrarAviso("Nada para desfazer."); return; }
  try { await a.fn(); mostrarAviso(a.rotulo || "Desfeito."); }
  catch (e) { console.error(e); mostrarAviso("Não foi possível desfazer."); }
  atualizarBotoes();
}
$("#btn-desfazer").addEventListener("click", desfazer);

/* ------------------------------------------------------------
 *  Auditoria da Central (alvo "planilha"): criação, estrutura e exclusões.
 *  Edição de célula fica só no histórico da linha.
 * ------------------------------------------------------------ */
const ACOES_AUDITORIA = { criar: "criar", estrutura: "editar", corrigirLista: "editar", substituirValor: "editar", compactar: "editar", excluir: "excluir", excluirDeVez: "excluir", apagarBackup: "excluir", restaurar: "restaurar", restaurarBackup: "restaurar" };
function registrarAuditoria(acao, resumo, detalhes = "") {
  if (!estado.api || !ACOES_AUDITORIA[acao] || contaSemPermissao()) return;
  estado.api.registrarAuditoria({
    acao: ACOES_AUDITORIA[acao], alvo: "planilha",
    resumo: `${resumo} · ${tituloPlanilha()}`.slice(0, 200),
    detalhes: [`planilha: ${ID}`, detalhes].filter(Boolean).join(" · ").slice(0, 800)
  }).catch((e) => console.warn("Auditoria:", e));
}

/* Linha pronta para gravar de novo (datas de controle viram "__DATA__:<ISO>") */
const marcaData = (iso) => (iso ? "__DATA__:" + iso : "__AGORA__");
function serializar(t) {
  return {
    campos: t.campos || {},
    criadoPor: t.criadoPor || "", criadoPorNome: t.criadoPorNome || "", criadoEm: marcaData(t.criadoEm),
    atualizadoPor: t.atualizadoPor || "", atualizadoPorNome: t.atualizadoPorNome || "", atualizadoEm: marcaData(t.atualizadoEm)
  };
}

/* ------------------------------------------------------------
 *  Arquivo compactado (planilhas/{id}/arquivo): centenas de linhas por documento
 *  Cada gravação completa cria uma versão nova e só depois apaga a anterior;
 *  quem está com a página aberta só passa a usar uma versão quando ela está inteira.
 * ------------------------------------------------------------ */
const LIMITE_PARTE = 600000;       // bytes de JSON por documento (o Firestore aceita até 1 MiB)
const LIMITE_PARTE_MAX = 950000;
const LIMITE_VIVAS = 3000;         // acima disso, a administradora é convidada a compactar
const codificador = new TextEncoder();
const bytes = (s) => codificador.encode(s).length;
const CAMPOS_AUTORIA = ["criadoPor", "criadoPorNome", "criadoEm", "atualizadoPor", "atualizadoPorNome", "atualizadoEm"];
const noArquivo = (id) => estado.arquivo.parteDe.has(id);
const comCampo = (campos, c, v) => { const r = { ...(campos || {}) }; if (estaVazio(v) || v === false || v === "__APAGAR__") delete r[c]; else r[c] = v; return r; };

/* { c: [ids das colunas], l: [[id, "", autoria ou 0, valor1, valor2…]] }; "" = vazio (mesmo formato do Banco) */
function jsonParte(lista) {
  const cols = [...new Set(lista.flatMap((t) => Object.keys(t.campos || {})))];
  return JSON.stringify({ c: cols, l: lista.map((t) => {
    const a = {};
    CAMPOS_AUTORIA.forEach((k) => { if (t[k]) a[k] = t[k]; });
    return [t.id, "", Object.keys(a).length ? a : 0, ...cols.map((c) => { const v = (t.campos || {})[c]; return estaVazio(v) || v === false ? "" : v; })];
  }) });
}
function lerParte(doc) {
  let d;
  try { d = JSON.parse(doc.json || ""); } catch (e) { console.warn("Parte do arquivo ilegível:", doc.id); return []; }
  const cols = Array.isArray(d.c) ? d.c : [];
  return (Array.isArray(d.l) ? d.l : []).filter((l) => Array.isArray(l) && l[0]).map((l) => {
    const campos = {};
    cols.forEach((c, i) => { const v = l[3 + i]; if (v !== "" && v != null) campos[c] = v; });
    const autoria = l[2] && typeof l[2] === "object" ? l[2] : {};
    return { ...normalizarTicket({ ...autoria, id: String(l[0]), campos }), arquivo: true };
  });
}
const cacheParte = new Map();      // id do documento → { json, linhas }
function aplicarArquivo(docs) {
  const porVersao = new Map();
  docs.forEach((d) => { const v = Number(d.versao) || 0; if (!porVersao.has(v)) porVersao.set(v, []); porVersao.get(v).push(d); });
  /* A versão inteira mais nova (uma gravação pela metade fica de fora) */
  const inteira = [...porVersao].filter(([, ds]) => ds.length === Number(ds[0].total)).sort((a, b) => b[0] - a[0])[0];
  const [versao, docsVersao] = inteira || [0, []];
  const ids = new Set(docsVersao.map((d) => d.id));
  [...cacheParte.keys()].forEach((id) => { if (!ids.has(id)) cacheParte.delete(id); });
  const parteDe = new Map(), linhas = [];
  const partes = docsVersao.sort((a, b) => a.indice - b.indice).map((d) => {
    let c = cacheParte.get(d.id);
    if (!c || c.json !== d.json) { c = { json: d.json, linhas: lerParte(d) }; cacheParte.set(d.id, c); }
    const p = { id: d.id, versao, indice: d.indice, total: d.total, linhas: c.linhas };
    c.linhas.forEach((t) => { parteDe.set(t.id, p); linhas.push(t); });
    return p;
  });
  estado.arquivo = { versao, docs: docs.map((d) => d.id), partes, linhas, parteDe };
}
/* Edição parcial por cima da linha do arquivo: campos alterados valem; a autoria original continua */
function mesclarParcial(base, v) {
  const original = base.criadoPor ? { criadoPor: base.criadoPor, criadoPorNome: base.criadoPorNome, criadoEm: base.criadoEm } : {};
  return { ...v, ...original, campos: { ...(base.campos || {}), ...(v.campos || {}) }, parcial: true };
}
/* Linhas vivas primeiro; cada viva substitui (ou, se parcial, completa) a linha do arquivo de mesmo id.
   Linhas com "removida: true" estão na Lixeira: saem da grade (e escondem a linha do arquivo). */
function combinarTickets() {
  const vivos = new Map(estado.vivos.map((t) => [t.id, t]));
  const removidas = [], doArquivo = [], soVivas = [];
  estado.arquivo.linhas.forEach((t) => {
    const v = vivos.get(t.id);
    if (!v) { doArquivo.push(t); return; }
    vivos.delete(t.id);
    const r = v.parcial ? mesclarParcial(t, v) : v;
    (v.removida ? removidas : doArquivo).push(r);
  });
  vivos.forEach((v) => (v.removida ? removidas : soVivas).push(v));
  estado.tickets = [...soVivas, ...doArquivo];
  estado.removidas = removidas;
}
function dividirArquivo(lista) {
  const grupos = [];
  let atual = [], tam = 0;
  lista.forEach((t) => {
    const n = bytes(JSON.stringify(t.campos || {})) + 60 + (t.criadoPor || t.atualizadoPor ? 400 : 0);
    if (atual.length && tam + n > LIMITE_PARTE) { grupos.push(atual); atual = []; tam = 0; }
    atual.push(t); tam += n;
  });
  if (atual.length || !grupos.length) grupos.push(atual);
  return grupos;
}
const dadosParte = (versao, indice, total, json) => {
  if (bytes(json) > LIMITE_PARTE_MAX) throw new Error("Parte do arquivo grande demais.");
  return { versao, indice, total, json, criadoPor: estado.usuario.email, criadoEm: "__AGORA__" };
};
/* Grava a lista inteira como versão nova; depois apaga as versões antigas e as linhas vivas indicadas (só administradoras) */
async function gravarArquivo(lista, { apagarVivos = [] } = {}) {
  const versao = Date.now();
  const grupos = dividirArquivo(lista);
  const antigos = [...estado.arquivo.docs];
  await estado.api.lote(grupos.map((g, i) => ({ op: "set", caminho: `${ARQUIVO}/v${versao}-${String(i).padStart(3, "0")}`, dados: dadosParte(versao, i, grupos.length, jsonParte(g)) })));
  const limpeza = antigos.map((id) => ({ op: "delete", caminho: `${ARQUIVO}/${id}` }));
  apagarVivos.forEach((t) => limpeza.push({ op: "delete", caminho: `${LINHAS}/${t.id}` }));
  if (limpeza.length) await estado.api.lote(limpeza);
  return grupos.length;
}
/* Troca linhas do arquivo (Map id → linha nova, ou null para tirar) regravando só as partes em que estão */
async function alterarArquivo(alterados) {
  const partes = new Set();
  alterados.forEach((_, id) => { const p = estado.arquivo.parteDe.get(id); if (p) partes.add(p); });
  if (!partes.size) return;
  const trocar = (lista) => lista.map((t) => (alterados.has(t.id) ? alterados.get(t.id) : t)).filter(Boolean);
  const ops = [];
  for (const p of partes) {
    const json = jsonParte(trocar(p.linhas));
    if (bytes(json) > LIMITE_PARTE_MAX) { await gravarArquivo(trocar(estado.arquivo.linhas)); return; }
    ops.push({ op: "set", caminho: `${ARQUIVO}/${p.id}`, dados: dadosParte(p.versao, p.indice, p.total, json) });
  }
  await estado.api.lote(ops);
}
/* Mesma coluna em várias linhas. Administradora: as do arquivo regravando as partes.
   Outras pessoas: todas viram linhas vivas (as do arquivo, parciais), com histórico. */
async function definirEmVarios(pares, col, acao) {
  if (!ehAdmin()) { await estado.api.lote(pares.flatMap(([t, v]) => opsAlteracao(t, { [col.id]: v }, acao))); return; }
  const vivos = pares.filter(([t]) => !t.arquivo), doArquivo = pares.filter(([t]) => t.arquivo);
  if (vivos.length) await estado.api.lote(vivos.flatMap(([t, v]) => opsAlteracao(t, { [col.id]: v }, acao)));
  if (doArquivo.length) {
    const agora = new Date().toISOString();
    await alterarArquivo(new Map(doArquivo.map(([t, v]) => [t.id, { ...t, campos: comCampo(t.campos, col.id, v), ...autoria("atualizadoPor"), atualizadoEm: agora }])));
  }
}
/* Linha de backup (datas marcadas com "__DATA__:") → linha do arquivo */
function ticketDeRegistro(r) {
  const d = r.dados || {};
  const data = (v) => (typeof v === "string" && v.startsWith("__DATA__:") ? v.slice(9) : "");
  return normalizarTicket({ ...d, id: r.id, criadoEm: data(d.criadoEm), atualizadoEm: data(d.atualizadoEm) });
}
/* No backup, as linhas do arquivo vão sem os campos de autoria vazios */
function registroBackup(t) {
  if (!t.arquivo) return serializar(t);
  const r = { campos: t.campos || {} };
  CAMPOS_AUTORIA.forEach((k) => { if (t[k]) r[k] = /Em$/.test(k) ? marcaData(t[k]) : t[k]; });
  return r;
}
async function compactarArquivo() {
  if (!ehAdmin()) return;
  const vivos = estado.vivos.filter((t) => !t.removida);
  if (!vivos.length) { mostrarAviso("Todas as linhas já estão no arquivo compactado."); return; }
  if (!(await confirmar(`Guardar ${vivos.length} linha(s) no arquivo compactado? Os dados e o histórico não mudam; abrir a planilha passa a gastar menos leituras do Firebase. Prefira um horário em que ninguém esteja editando. As linhas da Lixeira ficam de fora.`, { titulo: "Compactar linhas", botao: "Compactar" }))) return;
  mostrarAviso("Compactando…", 60000);
  try {
    /* Linhas da Lixeira que completam uma linha do arquivo passam a guardar a linha inteira (a do arquivo vai sumir) */
    const parciais = estado.removidas.filter((t) => t.parcial);
    if (parciais.length) await estado.api.lote(parciais.map((t) => ({ op: "set", caminho: `${LINHAS}/${t.id}`, dados: { ...serializar(t), removida: true } })));
    const lista = [...estado.tickets];
    const n = await gravarArquivo(lista, { apagarVivos: vivos });
    registrarAuditoria("compactar", `Guardou ${vivos.length} linha(s) no arquivo compactado`, `${lista.length} linha(s) em ${n} documento(s)`);
    mostrarAviso(`${vivos.length} linha(s) guardadas no arquivo compactado.`, 5000);
  } catch (e) { console.error(e); mostrarAviso("Não foi possível compactar. Nada se perdeu: as linhas continuam onde estavam.", 8000); }
}

/* ------------------------------------------------------------
 *  Lixeira e backups
 *  Excluir = a linha ganha "removida: true" e uma cópia vai para a Lixeira (qualquer pessoa restaura).
 *  Excluir de vez, esvaziar a Lixeira, restaurar e apagar backups: só administradoras.
 * ------------------------------------------------------------ */
/* Sem login, as regras conferem cada linha excluída/restaurada: vão poucas por lote */
const tamanhoLote = () => (ehAdmin() ? 120 : 6);
async function emLotes(itens, opsDe) {
  const tam = tamanhoLote();
  let feitas = 0;
  for (let i = 0; i < itens.length; i += tam) {
    try { await estado.api.lote(itens.slice(i, i + tam).flatMap(opsDe)); }
    catch (e) { e.feitas = feitas; throw e; }
    feitas = Math.min(itens.length, i + tam);
  }
  return feitas;
}
const resumoLinha = (t) => resumoRegistro((t && t.campos) || {}) || (t && t.id) || "";
async function excluirParaLixeira(lista, motivo = "", { silencioso = false } = {}) {
  if (!podeAlimentar() || !lista.length) return false;
  if (!silencioso) {
    if (lista.length > 1) {
      if (!(await confirmarDigitando(`Mover ${lista.length} linhas para a Lixeira? Um backup é feito antes.`, `EXCLUIR ${lista.length}`, { titulo: "Excluir em massa", botao: "Excluir" }))) return false;
      if (!(await criarBackup(`Antes de excluir ${lista.length} linhas`))) return false;
    } else if (!(await confirmar(`Mover a linha “${resumoLinha(lista[0])}” para a Lixeira? Qualquer pessoa pode restaurar depois.`, { titulo: "Excluir linha", botao: "Excluir", perigo: true }))) return false;
  }
  if (!(await exigirNome())) return false;
  const opsDe = (t) => [
    { op: "set", caminho: `${LIXEIRA}/${t.id}`, dados: { dados: serializar(t), ...autoria("excluidoPor"), excluidoEm: "__AGORA__", motivo: String(motivo).slice(0, 300) } },
    t.arquivo
      ? { op: "set", caminho: `${LINHAS}/${t.id}`, dados: { campos: {}, parcial: true, removida: true, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura() } }
      : { op: "set", caminho: `${LINHAS}/${t.id}`, mesclar: true, dados: { removida: true, ...assinatura() } },
    opHistorico(t.id, "excluir", { depois: String(motivo || resumoLinha(t)) })
  ];
  let feitas;
  try { feitas = await emLotes(lista, opsDe); }
  catch (e) {
    console.error(e);
    feitas = e.feitas || 0;
    mostrarAviso(feitas ? `${feitas} linha(s) foram para a Lixeira; as outras não. ${mensagemErro(e)}` : mensagemErro(e), 8000);
    if (!feitas) return false;
  }
  const feitasLista = lista.slice(0, feitas);
  const ids = feitasLista.map((t) => t.id);
  if (!silencioso) empilharDesfazer("Linhas restauradas da Lixeira", async () => restaurarDaLixeira(ids, { silencioso: true }));
  registrarAuditoria("excluir", `Mandou ${ids.length} linha(s) para a Lixeira`, [motivo, feitasLista.slice(0, 30).map(resumoLinha).join(", ")].filter(Boolean).join(" · "));
  estado.selecionados.clear();
  if (ids.includes(ficha.dataset.id)) fecharFicha();
  if (!silencioso && feitas === lista.length) mostrarAviso(`${feitas} linha(s) na Lixeira. Use Desfazer se foi sem querer.`, 5000);
  return feitas === lista.length;
}
/* Só administradoras: some de vez (Lixeira, linha viva e linha do arquivo) */
async function excluirDeVez(lista, motivo = "", { semAuditoria = false } = {}) {
  if (!ehAdmin() || !lista.length) return true;
  const vivos = new Set(estado.vivos.map((t) => t.id));
  const ops = [];
  lista.forEach((t) => {
    ops.push({ op: "delete", caminho: `${LIXEIRA}/${t.id}` });
    if (vivos.has(t.id)) ops.push({ op: "delete", caminho: `${LINHAS}/${t.id}` });
  });
  try {
    await alterarArquivo(new Map(lista.filter((t) => noArquivo(t.id)).map((t) => [t.id, null])));
    await estado.api.lote(ops);
    if (!semAuditoria) registrarAuditoria("excluirDeVez", `Excluiu de vez ${lista.length} linha(s)`, motivo);
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}
async function apagarLixeira(ids) {
  if (!ehAdmin() || !ids.length) return;
  await estado.api.lote(ids.map((id) => ({ op: "delete", caminho: `${LIXEIRA}/${id}` })));
}
/* Restaurar = "removida" volta a false e a cópia sai da Lixeira. Se a linha não existe mais
   (ex.: depois de restaurar um backup), só a administradora consegue recriá-la a partir da cópia. */
async function restaurarDaLixeira(ids, { silencioso = false } = {}) {
  const vivos = new Map(estado.vivos.map((t) => [t.id, t]));
  const naLinha = ids.filter((id) => vivos.has(id) && vivos.get(id).removida);
  const orfas = ehAdmin() ? ids.filter((id) => !vivos.has(id)).map((id) => estado.lixeira.find((x) => x.id === id)).filter(Boolean) : [];
  if (!naLinha.length && !orfas.length) { if (!silencioso) mostrarAviso("Essas linhas não estão mais na Lixeira."); return false; }
  if (!(await exigirNome())) return false;
  let feitas = 0;
  try {
    feitas = await emLotes(naLinha, (id) => [
      { op: "update", caminho: `${LINHAS}/${id}`, dados: { removida: false, ...assinatura() } },
      { op: "delete", caminho: `${LIXEIRA}/${id}` },
      opHistorico(id, "restaurar")
    ]);
    if (orfas.length) {
      await estado.api.lote(orfas.flatMap((x) => [
        { op: "set", caminho: `${LINHAS}/${x.id}`, dados: serializar({ ...(x.dados || {}) }) },
        { op: "delete", caminho: `${LIXEIRA}/${x.id}` },
        opHistorico(x.id, "restaurar")
      ]));
      feitas += orfas.length;
    }
  } catch (e) { console.error(e); feitas += e.feitas || 0; mostrarAviso(mensagemErro(e)); if (!feitas) return false; }
  registrarAuditoria("restaurar", `Restaurou ${feitas} linha(s) da Lixeira`);
  if (!silencioso) mostrarAviso(`${feitas} linha(s) restaurada(s).`, 5000);
  return true;
}
/* Backup: estrutura + todas as linhas, em partes de até ~600 KB (cada parte < 1 MB). Qualquer pessoa pode fazer. */
async function criarBackup(motivo) {
  if (!podeAlimentar()) return null;
  if (!(await exigirNome())) return null;
  try {
    const id = estado.api.novoId(BACKUPS);
    const registros = estado.tickets.map((t) => ({ id: t.id, dados: registroBackup(t) }));
    const partes = [];
    let atual = [], tamanho = 0;
    registros.forEach((r) => {
      const n = bytes(JSON.stringify(r)) + 1;
      if (atual.length && tamanho + n > LIMITE_PARTE) { partes.push(atual); atual = []; tamanho = 0; }
      atual.push(r); tamanho += n;
    });
    if (atual.length) partes.push(atual);
    const ops = [{ op: "set", caminho: `${BACKUPS}/${id}`, dados: {
      motivo: String(motivo).slice(0, 200), ...autoria("criadoPor"), criadoEm: "__AGORA__",
      totalRegistros: registros.length, partes: partes.length, versaoEstrutura: estado.estrutura ? estado.estrutura.versao : 0,
      estrutura: JSON.stringify(estado.estrutura ? dadosEstruturaBackup(estado.estrutura) : null)
    } }];
    partes.forEach((p, i) => ops.push({ op: "set", caminho: `${BACKUPS}/${id}/partes/${i}`, dados: { indice: i, json: JSON.stringify(p) } }));
    await estado.api.lote(ops);
    return id;
  } catch (e) {
    console.error(e);
    mostrarAviso("Não foi possível fazer o backup. Nada foi alterado.", 6000);
    return null;
  }
}
async function lerBackup(b) {
  const partes = await estado.api.lerColecao(`${BACKUPS}/${b.id}/partes`);
  const registros = partes.sort((x, y) => x.indice - y.indice).flatMap((p) => JSON.parse(p.json || "[]"));
  return { estrutura: JSON.parse(b.estrutura || "null"), registros };
}
const RE_ID_DOC = /^[A-Za-z0-9_-]{1,100}$/;
/* Substitui estrutura e linhas pelas do backup (só administradoras). As linhas vão para o arquivo compactado;
   as cópias da Lixeira continuam lá (a administradora pode restaurá-las). */
async function aplicarBackup({ estrutura, registros }, descricao) {
  if (!ehAdmin()) return false;
  const est = normalizarEstrutura(estrutura);
  if (!est || !est.colunas.length) { mostrarAviso("Backup sem estrutura válida."); return false; }
  const validos = (Array.isArray(registros) ? registros : []).filter((r) => r && typeof r.id === "string" && RE_ID_DOC.test(r.id) && r.dados && typeof r.dados === "object");
  if (!(await criarBackup(`Antes de restaurar ${descricao}`))) return false;
  mostrarAviso("Restaurando… não feche a página.", 120000);
  est.versao = (estado.estrutura ? estado.estrutura.versao : 0) + 1;
  await salvarEstrutura(est);
  const partes = await gravarArquivo(validos.map(ticketDeRegistro), { apagarVivos: estado.vivos });
  registrarAuditoria("restaurarBackup", `Restaurou ${descricao}`, `${validos.length} linha(s) em ${partes} documento(s) do arquivo${validos.length < (registros || []).length ? ` · ${(registros || []).length - validos.length} ignorada(s) por id inválido` : ""}`);
  mostrarAviso(`Pronto: ${validos.length.toLocaleString("pt-BR")} linha(s) carregadas.`, 6000);
  return true;
}
async function restaurarBackup(b) {
  if (!ehAdmin()) return;
  if (!(await confirmarDigitando(`A planilha volta a ficar como estava em ${formatarData(b.criadoEm, true)} (${b.totalRegistros} linhas). Antes, é feito um backup do estado atual.`, "RESTAURAR", { titulo: "Restaurar backup", botao: "Restaurar" }))) return;
  mostrarAviso("Restaurando…", 10000);
  try {
    const { estrutura, registros } = await lerBackup(b);
    await aplicarBackup({ estrutura, registros }, `o backup de ${formatarData(b.criadoEm, true)}`);
  } catch (e) { console.error(e); mostrarAviso("Não foi possível restaurar o backup. Se algo ficou pela metade, restaure o backup automático feito antes.", 8000); }
}
/* Arquivo .json no formato do botão "JSON" dos backups */
function restaurarDeArquivo() {
  if (!ehAdmin()) return;
  const entrada = document.createElement("input");
  entrada.type = "file";
  entrada.accept = ".json,application/json";
  entrada.addEventListener("change", async () => {
    const f = entrada.files[0];
    if (!f) return;
    let dados;
    try { dados = JSON.parse(await f.text()); } catch (e) { mostrarAviso("Esse arquivo não é um JSON válido."); return; }
    if (!dados || !Array.isArray(dados.registros) || !dados.estrutura) { mostrarAviso("O arquivo não tem estrutura e linhas de um backup de planilha."); return; }
    const est = normalizarEstrutura(dados.estrutura);
    if (!est || !est.colunas.length) { mostrarAviso("O arquivo não tem uma estrutura válida."); return; }
    const texto = `Carregar “${f.name}”: ${dados.registros.length.toLocaleString("pt-BR")} linha(s) e ${est.colunas.filter((c) => c.ativa).length} coluna(s)${dados.motivo ? ` (${String(dados.motivo).slice(0, 200)})` : ""}. A estrutura e as ${estado.tickets.length.toLocaleString("pt-BR")} linha(s) atuais são substituídas; antes, é feito um backup.`;
    if (!(await confirmarDigitando(texto, "RESTAURAR", { titulo: "Restaurar de um arquivo", botao: "Restaurar" }))) return;
    try { await aplicarBackup(dados, `o arquivo ${f.name.slice(0, 80)}`); }
    catch (e) { console.error(e); mostrarAviso("Não foi possível carregar o arquivo. Se algo ficou pela metade, restaure o backup automático feito antes.", 8000); }
  });
  entrada.click();
}
async function baixarBackup(b) {
  try {
    const { estrutura, registros } = await lerBackup(b);
    const p = partesBrasilia(new Date(b.criadoEm));
    baixarArquivo(`${ID}-backup-${p.ano}-${p.mes}-${p.dia}-${p.hora}${p.minuto}.json`,
      JSON.stringify({ criadoEm: b.criadoEm, criadoPor: b.criadoPor, motivo: b.motivo, estrutura, registros }, null, 2), "application/json;charset=utf-8");
  } catch (e) { console.error(e); mostrarAviso("Não foi possível baixar o backup."); }
}
async function abrirBackups() {
  const admin = ehAdmin();
  const d = criarDialogo({ titulo: "Backups", largo: true, corpo: `<p class="apoio">Feitos automaticamente antes de mudanças grandes na estrutura, exclusões em massa e restaurações. Qualquer pessoa pode fazer um agora e baixar o JSON; restaurar e apagar backups é só das administradoras.</p>
    <div class="form-botoes" style="justify-content:flex-start">${podeAlimentar() ? `<button type="button" class="btn btn-secundario btn-mini" data-bk="agora">${svg("i-salvar")}Fazer backup agora</button>` : ""}
      ${admin ? `<button type="button" class="btn btn-secundario btn-mini" data-bk="arquivo">${svg("i-upload")}Restaurar de um arquivo (.json)</button>` : ""}</div>
    <div class="tabela-admin" id="lista-backups"><p class="apoio" style="padding:12px">Carregando…</p></div>` });
  d.showModal();
  let lista = [];
  const desenhar = async () => {
    try { lista = await estado.api.lerColecao(BACKUPS, { ordenar: "criadoEm", desc: true, limite: 50 }); }
    catch (e) { $("#lista-backups", d).innerHTML = `<p class="apoio" style="padding:12px">Não foi possível carregar.</p>`; return; }
    $("#lista-backups", d).innerHTML = lista.length ? `<table><thead><tr><th>Quando</th><th>Motivo</th><th>Por</th><th>Linhas</th><th></th></tr></thead><tbody>${lista.map((b) => `<tr>
      <td>${escapar(formatarData(b.criadoEm, true))}</td><td>${escapar(b.motivo)}</td><td>${escapar(b.criadoPorNome || nomePessoa(b.criadoPor))}</td><td>${escapar(b.totalRegistros)}</td>
      <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-bk="baixar" data-id="${escapar(b.id)}">${svg("i-download")}JSON</button>
        ${admin ? `<button type="button" class="btn btn-secundario btn-mini" data-bk="restaurar" data-id="${escapar(b.id)}">${svg("i-restaurar")}Restaurar</button>
        <button type="button" class="acao-linha" data-bk="apagar" data-id="${escapar(b.id)}" title="Apagar este backup" aria-label="Apagar este backup">${svg("i-lixeira")}</button>` : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="apoio" style="padding:12px">Nenhum backup ainda.</p>`;
  };
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-bk]");
    if (!b) return;
    const item = lista.find((x) => x.id === b.dataset.id);
    if (b.dataset.bk === "agora") { if (await criarBackup("Backup manual")) { mostrarAviso("Backup feito."); desenhar(); } }
    if (b.dataset.bk === "arquivo") { d.close(); restaurarDeArquivo(); }
    if (b.dataset.bk === "baixar" && item) baixarBackup(item);
    if (b.dataset.bk === "restaurar" && item) { d.close(); restaurarBackup(item); }
    if (b.dataset.bk === "apagar" && item && admin && await confirmar(`Apagar o backup de ${formatarData(item.criadoEm, true)}?`, { titulo: "Apagar backup", botao: "Apagar", perigo: true })) {
      try {
        const partes = await estado.api.lerColecao(`${BACKUPS}/${item.id}/partes`);
        await estado.api.lote([...partes.map((p) => ({ op: "delete", caminho: `${BACKUPS}/${item.id}/partes/${p.id}` })), { op: "delete", caminho: `${BACKUPS}/${item.id}` }]);
        registrarAuditoria("apagarBackup", `Apagou o backup de ${formatarData(item.criadoEm, true)}`);
      } catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); }
      desenhar();
    }
  });
  desenhar();
}
function abrirLixeira() {
  const admin = ehAdmin();
  const d = criarDialogo({ titulo: "Lixeira", largo: true, corpo: `<p class="apoio">Linhas excluídas. Qualquer pessoa restaura; excluir de vez e esvaziar a Lixeira é só das administradoras.</p>
    ${admin ? `<div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-perigo btn-mini" data-lx="esvaziar">${svg("i-lixeira")}Esvaziar a Lixeira</button></div>` : ""}
    <div class="tabela-admin" id="lista-lixeira"></div>` });
  const resumoDe = (x) => resumoRegistro(((x.dados || {}).campos) || {}) || x.id;
  const vivas = () => new Map(estado.vivos.map((t) => [t.id, t]));
  const desenhar = () => {
    const v = vivas();
    const lista = [...estado.lixeira].sort((a, b) => String(b.excluidoEm).localeCompare(String(a.excluidoEm)));
    const botao = d.querySelector('[data-lx="esvaziar"]');
    if (botao) botao.disabled = !lista.length;
    $("#lista-lixeira", d).innerHTML = lista.length ? `<table><thead><tr><th>Linha</th><th>Excluída em</th><th>Por</th><th>Motivo</th><th></th></tr></thead><tbody>${lista.map((x) => {
      const restauravel = (v.has(x.id) && v.get(x.id).removida) || (admin && !v.has(x.id));
      return `<tr>
      <td>${escapar(resumoDe(x))}</td><td>${escapar(formatarData(x.excluidoEm, true))}</td><td>${escapar(x.excluidoPorNome || nomePessoa(x.excluidoPor))}</td><td>${escapar(x.motivo || "")}</td>
      <td class="acoes-tab">${restauravel && podeAlimentar() ? `<button type="button" class="btn btn-secundario btn-mini" data-lx="restaurar" data-id="${escapar(x.id)}">${svg("i-restaurar")}Restaurar</button>` : restauravel ? "" : '<span class="apoio" style="font-size:12px">Só as administradoras restauram esta linha</span>'}
        ${admin ? `<button type="button" class="btn btn-perigo btn-mini" data-lx="apagar" data-id="${escapar(x.id)}">Excluir de vez</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table>` : `<p class="apoio" style="padding:12px">A Lixeira está vazia.</p>`;
  };
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-lx]");
    if (!b) return;
    if (b.dataset.lx === "esvaziar") {
      if (!admin || !estado.lixeira.length) return;
      const n = estado.lixeira.length;
      if (!(await confirmarDigitando(`Excluir de vez as ${n} linha(s) da Lixeira? Não tem volta.`, "ESVAZIAR", { titulo: "Esvaziar a Lixeira", botao: "Esvaziar" }))) return;
      if (await excluirDeVez(estado.lixeira.map((x) => ({ id: x.id })), "", { semAuditoria: true })) { registrarAuditoria("excluirDeVez", `Esvaziou a Lixeira (${n} linha(s))`); mostrarAviso("Lixeira esvaziada."); }
      return;
    }
    const x = estado.lixeira.find((y) => y.id === b.dataset.id);
    if (!x) return;
    if (b.dataset.lx === "restaurar") { if (await restaurarDaLixeira([x.id])) desenhar(); }
    if (b.dataset.lx === "apagar" && admin && await confirmarDigitando(`Excluir de vez a linha “${resumoDe(x)}”? Não tem volta.`, "EXCLUIR", { titulo: "Excluir de vez", botao: "Excluir de vez" })) {
      if (await excluirDeVez([{ id: x.id }], "", { semAuditoria: true })) registrarAuditoria("excluirDeVez", `Excluiu de vez da Lixeira a linha “${resumoDe(x)}”`);
    }
  });
  estado.aoMudarLixeira = desenhar;
  d.addEventListener("close", () => { estado.aoMudarLixeira = null; });
  desenhar();
  d.showModal();
}

/* ------------------------------------------------------------
 *  Seleção, edição em massa e exclusão em massa
 * ------------------------------------------------------------ */
function alternarSelecao(id, marcar) {
  if (marcar) estado.selecionados.add(id); else estado.selecionados.delete(id);
  renderizarSelecao();
  pintarLinhas(true);
}
function renderizarSelecao() {
  const barra = $("#barra-selecao");
  if (!podeAlimentar() || !estado.selecionando) { barra.hidden = true; return; }
  const ids = new Set(estado.tickets.map((t) => t.id));
  [...estado.selecionados].forEach((id) => { if (!ids.has(id)) estado.selecionados.delete(id); });
  const n = estado.selecionados.size;
  barra.hidden = false;
  barra.innerHTML = `<strong>${n} selecionado(s)</strong>
    <button type="button" class="btn btn-secundario btn-mini" data-sel-acao="todos">Selecionar os ${estado.filtrados.length} filtrados</button>
    <button type="button" class="btn btn-secundario btn-mini" data-sel-acao="limpar"${n ? "" : " disabled"}>Limpar seleção</button>
    <button type="button" class="btn btn-mini" data-sel-acao="definir"${n ? "" : " disabled"}>${svg("i-lapis")}Definir valor…</button>
    <button type="button" class="btn btn-perigo btn-mini" data-sel-acao="excluir"${n ? "" : " disabled"}>${svg("i-lixeira")}Excluir</button>`;
}
$("#barra-selecao").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sel-acao]");
  if (!b) return;
  const a = b.dataset.selAcao;
  if (a === "todos") estado.filtrados.forEach((t) => estado.selecionados.add(t.id));
  if (a === "limpar") estado.selecionados.clear();
  if (a === "definir") editarEmMassa();
  if (a === "excluir") { const m = mapaTickets(); excluirParaLixeira([...estado.selecionados].map((id) => m.get(id)).filter(Boolean)); }
  renderizarSelecao(); pintarLinhas(true);
});
$("#btn-selecionar").addEventListener("click", () => {
  estado.selecionando = !estado.selecionando;
  if (!estado.selecionando) estado.selecionados.clear();
  renderizarTudo();
});
function editarEmMassa() {
  const m = mapaTickets();
  const lista = [...estado.selecionados].map((id) => m.get(id)).filter(Boolean);
  if (!lista.length) return;
  const cols = colunasAtivas().filter((c) => podeEditarColuna(c) && !c.unica);
  const d = criarDialogo({
    titulo: `Definir valor em ${lista.length} registro(s)`,
    corpo: `<label class="campo"><span class="rotulo">Coluna</span><select name="coluna">${cols.map((c) => `<option value="${escapar(c.id)}">${escapar(c.nome)}</option>`).join("")}</select></label>
      <div class="campo" id="massa-valor"></div>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Aplicar</button></div>`
  });
  const form = d.querySelector("form");
  const desenharValor = () => {
    const c = COL[form.coluna.value];
    $("#massa-valor", d).innerHTML = `<span class="rotulo">Novo valor</span>${c.tipo === "etiquetas"
      ? `<div style="display:flex;flex-wrap:wrap;gap:8px 14px">${opcoesAtivas(c).map((o) => `<label class="check"><input type="checkbox" name="valor" value="${escapar(o.id)}"> ${escapar(o.nome)}</label>`).join("")}</div>`
      : c.tipo === "textoLongo" ? `<textarea name="valor" rows="3"></textarea>` : campoEntrada(c, "", 'name="valor"')}`;
  };
  form.coluna.addEventListener("change", desenharValor);
  desenharValor();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = COL[form.coluna.value];
    const bruto = c.tipo === "etiquetas" ? $$('[name="valor"]:checked', form).map((i) => i.value) : c.tipo === "booleano" ? form.valor.value === "sim" : form.valor.value;
    const r = validarValor(c, bruto);
    if (!r.ok) { form.querySelector(".form-erro").textContent = r.erro; return; }
    if (c.obrigatoria && estaVazio(r.valor)) { form.querySelector(".form-erro").textContent = `${c.nome} é obrigatório.`; return; }
    if (!conectado()) { mostrarAviso("Sem conexão: a edição está bloqueada."); return; }
    const antes = lista.map((t) => [t.id, (t.campos || {})[c.id] ?? vazioDe(c)]);
    let ok = true;
    try { await definirEmVarios(lista.map((t) => [t, r.valor]), c, "editarMassa"); }
    catch (err) { console.error(err); mostrarAviso(mensagemErro(err), 5000); ok = false; }
    if (ok) {
      empilharDesfazer("Edição em massa desfeita", async () => { const m = mapaTickets(); await definirEmVarios(antes.map(([id, v]) => [m.get(id), v]).filter(([t]) => t), c, "desfazer"); });
      d.close(); mostrarAviso(`${lista.length} linha(s) atualizada(s).`);
    }
  });
  d.showModal();
}


/* ------------------------------------------------------------
 *  Estrutura (Planilha › Estrutura: qualquer pessoa; colunas "Só administradoras",
 *  excluir coluna de vez e bloquear colunas: só Lays e Paula)
 *  Tudo é editado num rascunho; "Aplicar" mostra a prévia, faz backup
 *  (nas mudanças grandes), migra os dados (conversões de tipo e colunas
 *  excluídas) e só então grava a estrutura nova. Mudar opções nunca regrava linhas.
 * ------------------------------------------------------------ */
const RE_LGPD = /cpf|cnpj|\brg\b|identidade|endere[cç]o|resid[eê]ncia|telefone pessoal|celular pessoal|nascimento|sa[uú]de|m[eé]dic|doen[cç]a/i;
const AVISO_LGPD_COLUNAS = "LGPD: não crie colunas de CPF/CNPJ completo, RG, endereço, telefone pessoal ou dados de saúde.";
function idUnico(nome, existentes, camel) {
  const base = camel
    ? (normalizar(nome).replace(/[^a-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^[^a-z]+/, "") || "coluna").slice(0, 32)
    : slug(nome, 34);
  let id = base, n = 2;
  while (existentes.includes(id)) id = `${base}${camel ? "" : "-"}${n++}`;
  return id;
}
/* Converte um valor da coluna antiga para o tipo novo, passando pelo texto */
function converterValor(v, colDe, colPara) {
  if (estaVazio(v)) return { ok: true, valor: vazioDe(colPara) };
  const texto = valorTexto({ campos: { [colDe.id]: v } }, { ...colDe, id: colDe.id });
  if (colPara.tipo === "booleano") return { ok: true, valor: /^(sim|s|true|1|x)$/i.test(texto) };
  return validarValor(colPara, texto);
}
function previaConversao(colDe, colPara) {
  let total = 0, ok = 0;
  const falhas = [];
  estado.tickets.forEach((t) => {
    const v = (t.campos || {})[colDe.id];
    if (estaVazio(v)) return;
    total++;
    const r = converterValor(v, colDe, colPara);
    if (r.ok) ok++; else if (falhas.length < 6) falhas.push(valorTexto(t, colDe));
  });
  return { total, ok, falhas };
}
function contarUso(colId, opcaoId) {
  return estado.tickets.filter((t) => { const v = (t.campos || {})[colId]; return Array.isArray(v) ? v.includes(opcaoId) : v === opcaoId; }).length;
}
/* Quantas linhas usam cada opção: linhas (vivas e do arquivo compactado) e as da Lixeira.
   Os backups não são conferidos (ver o aviso no editor). */
function usoDasOpcoes(colId) {
  const uso = new Map();
  const somar = (v) => (Array.isArray(v) ? v : estaVazio(v) ? [] : [v]).forEach((x) => uso.set(x, (uso.get(x) || 0) + 1));
  estado.tickets.forEach((t) => somar((t.campos || {})[colId]));
  estado.lixeira.forEach((x) => somar(x.dados && x.dados.campos && x.dados.campos[colId]));
  return uso;
}
/* "lays.almeida@valid.com" → "Lays"; sem login, o nome que a pessoa informou */
const nomeCurto = (x) => { const s = String(x || ""); if (!s.includes("@")) return s; const p = s.split(/[.@]/)[0]; return p.charAt(0).toUpperCase() + p.slice(1); };
const textoRemovidaEm = (o) => [o.removidaEm ? `removida em ${formatarData(o.removidaEm)}` : "removida", o.removidaPor ? `por ${nomeCurto(o.removidaPor)}` : ""].filter(Boolean).join(" ");
const TITULO_TIRAR = "Some das escolhas. As linhas que já usam este nome continuam iguais.";
const tituloEmUso = (n) => `Em uso em ${n} linha(s). Para não perder o nome, ela só pode ser removida da lista.`;
/* Renomear uma opção que já tem linhas: corrigir o nome em todas ou manter o antigo nas linhas existentes */
function perguntarRenomear(antigo, novo, n) {
  return new Promise((resolver) => {
    const d = criarDialogo({ titulo: "Renomear opção", corpo: `<p class="apoio">“${escapar(antigo)}” → “${escapar(novo)}”. ${n} linha(s) usam esta opção.</p>
      <div class="escolhas-renomear">
        <label class="check"><input type="radio" name="modo" value="manter" checked> <span><strong>Manter o nome antigo nas linhas existentes</strong> e usar o novo daqui para frente<br><span class="apoio">“${escapar(antigo)}” sai da lista (continua nas linhas) e “${escapar(novo)}” entra no lugar. Nenhuma linha é regravada.</span></span></label>
        <label class="check"><input type="radio" name="modo" value="corrigir"> <span><strong>Corrigir o nome em TODAS as linhas</strong> (ex.: erro de digitação)<br><span class="apoio">As ${n} linha(s) passam a mostrar “${escapar(novo)}”. O histórico guarda que antes se chamava “${escapar(antigo)}”.</span></span></label>
      </div>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Continuar</button></div>` });
    let valor = null;
    d.querySelector("form").addEventListener("submit", (e) => { valor = e.target.modo.value; });
    d.addEventListener("close", () => resolver(valor));
    d.showModal();
  });
}

function abrirEstrutura({ novaColuna = false } = {}) {
  if (!podeMontar()) return;
  /* Planilha vazia: a estrutura só é gravada quando a primeira coluna é criada */
  const atual = estado.estrutura || normalizarEstrutura(estruturaVazia());
  const primeira = !estado.docExiste;
  const admin = ehAdmin();
  const original = JSON.parse(JSON.stringify(atual));
  const r = JSON.parse(JSON.stringify(atual));
  const migracoes = [];
  let aba = "colunas";
  const d = criarDialogo({
    titulo: "Estrutura da planilha",
    largo: true,
    corpo: `<p class="lgpd">${escapar(AVISO_LGPD_COLUNAS)}</p>
      <div class="abas-dialogo" role="tablist">${[["colunas", "Colunas"], ["grupos", "Grupos de colunas"], ["abas", "Abas e resumo"]].map(([id, nome]) => `<button type="button" role="tab" data-aba-est="${id}">${nome}</button>`).join("")}</div>
      <div id="est-conteudo"></div>
      <p class="apoio" id="est-pendente"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Descartar</button><button type="button" class="btn" data-est="aplicar">${svg("i-check")}Ver prévia e aplicar</button></div>`
  });
  const ordenadas = () => {
    const og = (g) => (r.gruposColunas.find((x) => x.id === g) || {}).ordem || 99;
    return [...r.colunas].sort((a, b) => og(a.grupo) - og(b.grupo) || a.ordem - b.ordem);
  };
  const renumerar = () => { ordenadas().forEach((c, i) => { c.ordem = i + 1; }); };
  const desenhar = () => {
    $$("[data-aba-est]", d).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.abaEst === aba)));
    const alvo = $("#est-conteudo", d);
    if (aba === "colunas") {
      alvo.innerHTML = `<div class="form-botoes" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn btn-mini" data-est="nova-coluna">${svg("i-mais")}Nova coluna</button></div>
        <div class="tabela-admin"><table><thead><tr><th>Ordem</th><th>Nome</th><th>Tipo</th><th>Grupo</th><th>Regras</th><th>Situação</th><th></th></tr></thead><tbody>${ordenadas().map((c) => `<tr data-col="${escapar(c.id)}"${c.ativa ? "" : ' class="arquivada"'}>
          <td class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-est="subir" title="Subir" aria-label="Subir ${escapar(c.nome)}">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-est="descer" title="Descer" aria-label="Descer ${escapar(c.nome)}">${svg("i-seta-baixo")}</button></td>
          <td><strong>${escapar(c.nome)}</strong>${RE_LGPD.test(normalizar(c.nome)) ? ` <span class="selo-exclusao">LGPD?</span>` : ""}<div class="apoio" style="font-size:11px">id: ${escapar(c.id)}</div></td>
          <td>${escapar(NOME_TIPO[c.tipo])}${c.origem === "categorias" ? " (categorias)" : ""}</td><td>${escapar((r.gruposColunas.find((g) => g.id === c.grupo) || {}).nome || "")}</td>
          <td style="font-size:12px">${[TIPOS_SEM_EDICAO.includes(c.tipo) ? "" : ACESSO_CURTO[acessoDe(c)], c.obrigatoria && "obrigatória", c.unica && "única", c.padrao && `padrão: ${c.padrao}`].filter(Boolean).map(escapar).join(" · ")}</td>
          <td>${c.ativa ? "Ativa" : "Arquivada"}</td>
          <td class="acoes-tab">${!admin && c.somenteAdmin ? `<span class="apoio" style="font-size:12px" title="${escapar(TEXTO_BLOQUEADO)}">${svg("i-cadeado", "icone cadeado")} Só administradoras</span>` : `<button type="button" class="btn btn-secundario btn-mini" data-est="editar-coluna">${svg("i-lapis")}Editar</button>
            <button type="button" class="btn btn-secundario btn-mini" data-est="arquivar-coluna">${svg("i-arquivo")}${c.ativa ? "Arquivar" : "Reativar"}</button>`}
            ${admin ? `<button type="button" class="acao-linha" data-est="excluir-coluna" title="Excluir de vez" aria-label="Excluir de vez ${escapar(c.nome)}">${svg("i-lixeira")}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
        ${r.colunas.length ? "" : '<p class="apoio" style="padding:12px">Nenhuma coluna ainda. Use “Nova coluna”.</p>'}
        <p class="apoio" style="font-size:13px">Arquivar esconde a coluna sem apagar os valores. Excluir de vez (só administradoras) apaga os valores em todas as linhas.</p>`;
    } else if (aba === "grupos") {
      const gs = [...r.gruposColunas].sort((a, b) => a.ordem - b.ordem);
      alvo.innerHTML = `<div class="form-botoes" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn btn-mini" data-est="novo-grupo">${svg("i-mais")}Novo grupo</button></div>
        <div class="tabela-admin"><table><thead><tr><th>Ordem</th><th>Nome</th><th>Colunas</th><th></th></tr></thead><tbody>${gs.map((g) => `<tr data-grupo-est="${escapar(g.id)}">
          <td class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-est="grupo-subir" aria-label="Subir">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-est="grupo-descer" aria-label="Descer">${svg("i-seta-baixo")}</button></td>
          <td><input data-grupo-campo="nome" value="${escapar(g.nome)}" maxlength="60" aria-label="Nome do grupo"></td>
          <td>${r.colunas.filter((c) => c.grupo === g.id).length}</td>
          <td class="acoes-tab"><button type="button" class="acao-linha" data-est="excluir-grupo" aria-label="Excluir grupo">${svg("i-lixeira")}</button></td></tr>`).join("")}</tbody></table></div>`;
    } else {
      const candidatas = r.colunas.filter((c) => c.ativa && ["lista", "status", "prioridade"].includes(c.tipo));
      alvo.innerHTML = `<div class="campos-linha" style="margin-top:10px">
        <label class="campo"><span class="rotulo">Abas acima da planilha</span><select data-abas="coluna"><option value="">Sem abas</option>${candidatas.map((c) => `<option value="${escapar(c.id)}"${r.abas && r.abas.coluna === c.id ? " selected" : ""}>Uma aba por opção de “${escapar(c.nome)}”</option>`).join("")}</select>
          <span class="ajuda">Só colunas de Lista, Status ou Prioridade. A aba aberta já preenche essa coluna nas linhas novas.</span></label>
        <label class="check" style="align-self:center"><input type="checkbox" data-abas="resumo"${r.resumo && r.resumo.mostrar === false ? "" : " checked"}> Mostrar o resumo no topo (total, status, atrasados)</label></div>`;
    }
    const n = migracoes.length;
    $("#est-pendente", d).textContent = n ? `${n} mudança(s) nos dados pendente(s) (conversões, opções ou colunas excluídas).` : "";
  };
  const mover = (lista, id, delta, chave = "id") => {
    const ord = [...lista].sort((a, b) => a.ordem - b.ordem);
    const i = ord.findIndex((x) => x[chave] === id), j = i + delta;
    if (i < 0 || j < 0 || j >= ord.length) return;
    [ord[i].ordem, ord[j].ordem] = [ord[j].ordem, ord[i].ordem];
  };
  d.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.grupoCampo) { const g = r.gruposColunas.find((x) => x.id === t.closest("[data-grupo-est]").dataset.grupoEst); g.nome = t.value.slice(0, 60); }
    if (t.dataset.abas === "coluna") r.abas = t.value ? { coluna: t.value } : {};
    if (t.dataset.abas === "resumo") r.resumo = { mostrar: t.checked };
  });
  d.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba-est]");
    if (ab) { aba = ab.dataset.abaEst; desenhar(); return; }
    const b = e.target.closest("[data-est]");
    if (!b) return;
    const a = b.dataset.est;
    const linhaCol = b.closest("[data-col]");
    const col = linhaCol && r.colunas.find((c) => c.id === linhaCol.dataset.col);
    if (col && col.somenteAdmin && !admin && a !== "subir" && a !== "descer") { mostrarAviso(TEXTO_BLOQUEADO + "."); return; }
    if (a === "nova-coluna") { if (r.colunas.length >= MAX_COLUNAS) { mostrarAviso(`Use no máximo ${MAX_COLUNAS} colunas.`); return; } editarColuna(null); }
    if (a === "editar-coluna" && col) editarColuna(col);
    if ((a === "subir" || a === "descer") && col) {
      renumerar();
      const mesmas = ordenadas().filter((c) => c.grupo === col.grupo);
      const i = mesmas.indexOf(col), j = i + (a === "subir" ? -1 : 1);
      if (j >= 0 && j < mesmas.length) [mesmas[i].ordem, mesmas[j].ordem] = [mesmas[j].ordem, mesmas[i].ordem];
      desenhar();
    }
    if (a === "arquivar-coluna" && col) {
      if (col.unica && col.ativa && !(await confirmar(`Arquivar “${col.nome}” desliga a conferência de valor repetido. Continuar?`, { titulo: "Arquivar coluna" }))) return;
      col.ativa = !col.ativa; desenhar();
    }
    if (a === "excluir-coluna" && col && admin) {
      const usados = estado.tickets.filter((t) => !estaVazio((t.campos || {})[col.id])).length;
      if (!(await confirmarDigitando(`Excluir de vez a coluna “${col.nome}”? ${usados} linha(s) perdem esse valor. Um backup é feito antes de aplicar. Para só esconder, use Arquivar.`, col.nome, { titulo: "Excluir coluna de vez", botao: "Excluir coluna" }))) return;
      r.colunas = r.colunas.filter((c) => c !== col);
      r.colunas.forEach((c) => { if (c.tipo === "derivado") { if (c.de === col.id) c.de = ""; if (c.ate === col.id) c.ate = ""; } });
      if (original.colunas.some((c) => c.id === col.id)) migracoes.push({ tipo: "excluirColuna", col: col.id, nome: col.nome });
      desenhar();
    }
    if (a === "novo-grupo") {
      const nome = prompt("Nome do novo grupo de colunas:");
      if (!nome || !nome.trim()) return;
      r.gruposColunas.push({ id: idUnico(nome, r.gruposColunas.map((g) => g.id)), nome: nome.trim().slice(0, 60), ordem: Math.max(0, ...r.gruposColunas.map((g) => g.ordem)) + 1 });
      desenhar();
    }
    const linhaGrupo = b.closest("[data-grupo-est]");
    const grupo = linhaGrupo && r.gruposColunas.find((g) => g.id === linhaGrupo.dataset.grupoEst);
    if ((a === "grupo-subir" || a === "grupo-descer") && grupo) { mover(r.gruposColunas, grupo.id, a === "grupo-subir" ? -1 : 1); desenhar(); }
    if (a === "excluir-grupo" && grupo) {
      if (r.colunas.some((c) => c.grupo === grupo.id)) { mostrarAviso("Mova as colunas deste grupo para outro antes de excluí-lo."); return; }
      if (r.gruposColunas.length < 2) return;
      r.gruposColunas = r.gruposColunas.filter((g) => g !== grupo); desenhar();
    }
    if (a === "aplicar") aplicar();
  });

  /* Editor de uma coluna (rascunho) */
  function editarColuna(col) {
    const nova = !col;
    const base = col ? JSON.parse(JSON.stringify(col)) : { id: "", nome: "", tipo: "texto", grupo: r.gruposColunas[0].id, ordem: 999, largura: 150, obrigatoria: false, unica: false, padrao: "", opcoes: [], ajuda: "", somenteAdmin: false, ativa: true };
    const antesOriginal = original.colunas.find((c) => c.id === base.id);
    let opcoes = JSON.parse(JSON.stringify(base.opcoes || []));
    const uso = antesOriginal ? usoDasOpcoes(base.id) : new Map();
    const usoDe = (o) => (o.id ? uso.get(o.id) || 0 : 0);
    let removidasAbertas = false;
    const datas = r.colunas.filter((c) => ["data", "dataHora"].includes(c.tipo));
    const ed = criarDialogo({
      titulo: nova ? "Nova coluna" : `Coluna “${base.nome}”`,
      largo: true,
      corpo: `<p class="lgpd">${escapar(AVISO_LGPD_COLUNAS)}</p>
        <div class="campos-linha">
          <label class="campo"><span class="rotulo">Nome (rótulo)</span><input name="nome" value="${escapar(base.nome)}" maxlength="60" required><span class="ajuda" id="aviso-lgpd-nome"></span></label>
          <label class="campo"><span class="rotulo">Tipo</span><select name="tipo"${base.origem === "categorias" ? " disabled" : ""}>${TIPOS.map((t) => `<option value="${t.id}"${base.tipo === t.id ? " selected" : ""}>${escapar(t.nome)}</option>`).join("")}</select></label>
          <label class="campo"><span class="rotulo">Grupo</span><select name="grupo">${[...r.gruposColunas].sort((a, b) => a.ordem - b.ordem).map((g) => `<option value="${escapar(g.id)}"${base.grupo === g.id ? " selected" : ""}>${escapar(g.nome)}</option>`).join("")}</select></label>
          <label class="campo"><span class="rotulo">Largura padrão (px)</span><input name="largura" type="number" min="60" max="600" value="${escapar(base.largura)}"></label>
          <label class="campo"><span class="rotulo">Valor padrão</span><input name="padrao" value="${escapar(base.padrao)}" maxlength="60"><span class="ajuda">Para datas, “hoje”; para listas, o nome de uma opção.</span></label>
          <label class="campo"><span class="rotulo">Ajuda (aparece ao passar o mouse e no formulário)</span><input name="ajuda" value="${escapar(base.ajuda)}" maxlength="200"></label>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px 20px">
          <label class="check"><input type="checkbox" name="obrigatoria"${base.obrigatoria ? " checked" : ""}> Obrigatória</label>
          <label class="check"><input type="checkbox" name="unica"${base.unica ? " checked" : ""}> Valor único (não pode repetir)</label>
        </div>
        <label class="campo"><span class="rotulo">Acesso</span><select name="acesso"></select>
          <span class="ajuda">LIVRE: qualquer pessoa edita, em qualquer linha. LISTA: escolhe uma das opções (não digita). SÓ ADMINISTRADORAS: só a Lays e a Paula, logadas na Central, alteram (as outras pessoas veem com cadeado)${admin ? "" : "; só elas marcam essa opção"}.</span></label>
        <div id="col-extra"></div>
        <div id="col-conversao"></div>
        <p class="form-erro" role="alert"></p>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${nova ? "Criar coluna" : "Guardar no rascunho"}</button></div>`
    });
    const form = ed.querySelector("form");
    const tipoAtual = () => (base.origem === "categorias" ? "lista" : form.tipo.value);
    const desenharAcesso = () => {
      const lista = TIPOS_LISTA.includes(tipoAtual());
      const atual = acessoDe({ tipo: tipoAtual(), acesso: form.acesso.value || base.acesso, somenteAdmin: base.somenteAdmin });
      form.acesso.innerHTML = ACESSOS.filter((a) => (lista ? a.id !== "livre" : a.id !== "lista") && (admin || a.id !== "bloqueado")).map((a) => `<option value="${a.id}"${atual === a.id ? " selected" : ""}>${escapar(a.nome)}</option>`).join("");
      form.acesso.disabled = TIPOS_SEM_EDICAO.includes(tipoAtual());
    };
    const desenharExtra = () => {
      const tipo = tipoAtual();
      const extra = $("#col-extra", ed);
      desenharAcesso();
      if (TIPOS_LISTA.includes(tipo) && base.origem !== "categorias") {
        const ativas = opcoes.map((o, i) => [o, i]).filter(([o]) => o.ativa !== false);
        const removidas = opcoes.map((o, i) => [o, i]).filter(([o]) => o.ativa === false);
        const botaoSubstituir = (o, i) => (admin && o.id && usoDe(o) ? `<button type="button" class="acao-linha" data-op-substituir="${i}" title="Substituir valor nas linhas" aria-label="Substituir “${escapar(o.nome)}” nas linhas">${svg("i-ordenar")}</button>` : "");
        extra.innerHTML = `<h3 style="font-size:14px;margin-top:6px">Opções (${ativas.length} na lista${removidas.length ? `, ${removidas.length} removida(s)` : ""})</h3><div class="opcoes-editor">${ativas.map(([o, i]) => `<div class="opcao" data-op="${i}">
            <span class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-op-mover="-1" aria-label="Subir ${escapar(o.nome)}">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-op-mover="1" aria-label="Descer ${escapar(o.nome)}">${svg("i-seta-baixo")}</button></span>
            <input data-op-campo="nome" value="${escapar(o.nome)}" maxlength="100" aria-label="Nome da opção">
            <select data-op-campo="cor" aria-label="Cor">${["", ...CORES].map((x) => `<option value="${x}"${o.cor === x ? " selected" : ""}>${x ? NOME_COR[x] : "Sem cor"}</option>`).join("")}</select>
            ${tipo === "status" ? `<label class="check" style="font-size:12px"><input type="checkbox" data-op-campo="final"${o.final ? " checked" : ""}> Encerra</label>` : "<span></span>"}
            <span class="apoio uso-opcao" title="Linhas que usam esta opção">${o.id ? `${usoDe(o)} lin.` : "nova"}</span>
            <span class="acoes-tab">${botaoSubstituir(o, i)}<button type="button" class="acao-linha" data-op-tirar="${i}" title="${o.id ? TITULO_TIRAR : "Tirar esta opção nova"}" aria-label="Remover da lista: ${escapar(o.nome)}">${svg(o.id ? "i-olho-cortado" : "i-fechar")}</button></span></div>`).join("")}</div>
          ${removidas.length ? `<details class="opcoes-removidas"${removidasAbertas ? " open" : ""}><summary>Removidas da lista (${removidas.length})</summary>
            <p class="apoio" style="font-size:12px">Não aparecem para novas escolhas. As linhas que já as usam continuam mostrando o nome. A contagem inclui o arquivo compactado e a Lixeira (os backups não são conferidos).</p>
            ${removidas.map(([o, i]) => `<div class="opcao removida" data-op="${i}">
              <span class="nome-removido">${escapar(o.nome)}</span>
              <span class="apoio">${escapar(textoRemovidaEm(o))} · ${usoDe(o)} linha(s)</span>
              <span class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-op-voltar="${i}">${svg("i-desfazer")}Voltar para a lista</button>
              ${usoDe(o) ? `${botaoSubstituir(o, i)}<span class="info-uso" title="${escapar(tituloEmUso(usoDe(o)))}" aria-label="${escapar(tituloEmUso(usoDe(o)))}">${svg("i-info")}</span>`
                : `<button type="button" class="btn btn-secundario btn-mini" data-op-excluir="${i}">${svg("i-lixeira")}Excluir de vez</button>`}</span></div>`).join("")}</details>` : ""}
          <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-secundario btn-mini" data-op-nova>${svg("i-mais")}Adicionar opção</button>
          <button type="button" class="btn btn-secundario btn-mini" data-op-colar>Colar várias opções</button>
          ${antesOriginal && !TIPOS_LISTA.includes(antesOriginal.tipo) ? `<button type="button" class="btn btn-secundario btn-mini" data-op-dos-valores>Criar opções com os valores atuais</button>` : ""}</div>
          <div id="op-colar" hidden><label class="campo"><span class="rotulo">Uma opção por linha (as que já existem são ignoradas)</span><textarea rows="5" data-op-colar-texto></textarea></label>
            <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-mini" data-op-colar-ok>Adicionar estas opções</button></div></div>
          <p class="ajuda">Mudar a lista nunca altera as linhas: “Remover da lista” só tira a opção das novas escolhas, e o nome continua nas linhas que já o usam. Ao renomear uma opção em uso, você escolhe se corrige o nome em todas ou se mantém o antigo.${tipo === "status" ? " “Encerra” marca as opções que tiram o registro de “em aberto”." : ""}${tipo === "prioridade" ? " A última opção conta como “crítica” no resumo." : ""}</p>`;
      } else if (base.origem === "categorias") {
        extra.innerHTML = `<p class="apoio">As opções desta coluna são as categorias (aba “Categorias”).</p>`;
      } else if (tipo === "derivado") {
        extra.innerHTML = `<div class="campos-linha"><label class="campo"><span class="rotulo">Cálculo</span><select name="formula">${Object.entries(FORMULAS).map(([id, n]) => `<option value="${id}">${escapar(n)}</option>`).join("")}</select></label>
          <label class="campo"><span class="rotulo">Data de início</span><select name="de"><option value="">Data em que foi registrado</option>${datas.map((c) => `<option value="${escapar(c.id)}"${base.de === c.id ? " selected" : ""}>${escapar(c.nome)}</option>`).join("")}</select></label>
          <label class="campo"><span class="rotulo">Data de fim</span><select name="ate"><option value="">Hoje (ou quando foi encerrado)</option>${datas.map((c) => `<option value="${escapar(c.id)}"${base.ate === c.id ? " selected" : ""}>${escapar(c.nome)}</option>`).join("")}</select></label></div>`;
      } else if (tipo === "automatico") {
        extra.innerHTML = `<label class="campo"><span class="rotulo">Mostra</span><select name="auto">${Object.entries(AUTOS).map(([id, n]) => `<option value="${id}"${base.auto === id ? " selected" : ""}>${escapar(n)}</option>`).join("")}</select></label>`;
      } else extra.innerHTML = "";
      desenharConversao();
    };
    const colunaDoForm = () => ({ ...base, tipo: tipoAtual(), nome: form.nome.value.trim(), opcoes: opcoes.filter((o) => o.nome.trim()) });
    const desenharConversao = () => {
      const caixa = $("#col-conversao", ed);
      if (!antesOriginal || antesOriginal.tipo === tipoAtual() || TIPOS_SEM_EDICAO.includes(tipoAtual()) || TIPOS_SEM_EDICAO.includes(antesOriginal.tipo)) { caixa.innerHTML = ""; return; }
      const p = previaConversao(antesOriginal, colunaDoForm());
      caixa.innerHTML = `<div class="aviso-repetido" style="display:grid">${svg("i-info")}<strong>Prévia da conversão de “${escapar(NOME_TIPO[antesOriginal.tipo])}” para “${escapar(NOME_TIPO[tipoAtual()])}”</strong>
        <span>${p.total} registro(s) com valor: ${p.ok} convertem; ${p.total - p.ok} não convertem e ficarão vazios.</span>
        ${p.falhas.length ? `<span>Exemplos que não convertem: ${p.falhas.map((x) => `“${escapar(x)}”`).join(", ")}</span>` : ""}</div>`;
    };
    ed.addEventListener("input", (e) => {
      const i = e.target.closest("[data-op]");
      if (i && e.target.dataset.opCampo) {
        const o = opcoes[Number(i.dataset.op)];
        if (e.target.dataset.opCampo === "final") o.final = e.target.checked;
        else o[e.target.dataset.opCampo] = e.target.value;
        desenharConversao();
      }
      if (e.target.name === "nome") $("#aviso-lgpd-nome", ed).textContent = RE_LGPD.test(normalizar(e.target.value)) ? "Atenção: esse nome parece de dado pessoal. Confira a regra de LGPD acima." : "";
    });
    ed.addEventListener("change", (e) => { if (e.target.name === "tipo") desenharExtra(); if (e.target.dataset.opCampo === "cor") e.target.dispatchEvent(new Event("input", { bubbles: true })); });
    const cabeAtiva = () => opcoes.filter((o) => o.ativa !== false).length < MAX_OPCOES && opcoes.length < MAX_OPCOES_TOTAL;
    const quemRemove = () => String(autorAtual() || "").slice(0, 120);
    ed.addEventListener("toggle", (e) => { if (e.target.matches && e.target.matches(".opcoes-removidas")) removidasAbertas = e.target.open; }, true);
    ed.addEventListener("click", async (e) => {
      if (e.target.closest("[data-op-nova]")) {
        if (!cabeAtiva()) { mostrarAviso(`Limite de ${MAX_OPCOES} opções na lista (${MAX_OPCOES_TOTAL} contando as removidas).`); return; }
        opcoes.push({ id: "", nome: "", cor: "" }); desenharExtra(); $$(".opcoes-editor [data-op-campo='nome']", ed).pop().focus();
      }
      const mov = e.target.closest("[data-op-mover]");
      if (mov) {
        /* Sobe/desce entre as opções da lista (as removidas ficam à parte) */
        const i = Number(mov.closest("[data-op]").dataset.op);
        const ativos = opcoes.map((o, k) => [o, k]).filter(([o]) => o.ativa !== false).map(([, k]) => k);
        const p = ativos.indexOf(i), q = p + Number(mov.dataset.opMover);
        if (p >= 0 && q >= 0 && q < ativos.length) { const j = ativos[q]; [opcoes[i], opcoes[j]] = [opcoes[j], opcoes[i]]; desenharExtra(); }
        return;
      }
      if (e.target.closest("[data-op-colar]")) { const caixa = $("#op-colar", ed); caixa.hidden = !caixa.hidden; if (!caixa.hidden) $("[data-op-colar-texto]", ed).focus(); return; }
      if (e.target.closest("[data-op-colar-ok]")) {
        const nomes = new Set(opcoes.map((o) => nomeComparavel(o.nome)));
        let n = 0, removidasIguais = 0;
        $("[data-op-colar-texto]", ed).value.split(/\r?\n/).map((x) => x.trim().slice(0, 100)).filter(Boolean).forEach((nome) => {
          if (nomes.has(nomeComparavel(nome))) { if (opcoes.some((o) => o.ativa === false && nomeComparavel(o.nome) === nomeComparavel(nome))) removidasIguais++; return; }
          if (!cabeAtiva()) return;
          nomes.add(nomeComparavel(nome)); opcoes.push({ id: "", nome, cor: "" }); n++;
        });
        desenharExtra();
        mostrarAviso(`${n} opção(ões) adicionada(s).${removidasIguais ? ` ${removidasIguais} já existe(m) entre as removidas: use “Voltar para a lista”.` : ""}`, 6000);
        return;
      }
      if (e.target.closest("[data-op-dos-valores]")) {
        const nomes = new Set(opcoes.map((o) => normalizar(o.nome)));
        estado.tickets.forEach((t) => { const v = valorTexto(t, antesOriginal); String(v).split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => { if (!nomes.has(normalizar(x)) && cabeAtiva()) { nomes.add(normalizar(x)); opcoes.push({ id: "", nome: x.slice(0, 100), cor: "" }); } }); });
        desenharExtra();
      }
      /* Remover da lista: a opção sai das escolhas; nenhuma linha é alterada */
      const tirar = e.target.closest("[data-op-tirar]");
      if (tirar) {
        const o = opcoes[Number(tirar.dataset.opTirar)];
        if (!o.id) opcoes = opcoes.filter((x) => x !== o);
        else Object.assign(o, { ativa: false, removidaEm: new Date().toISOString(), removidaPor: quemRemove() });
        desenharExtra();
        return;
      }
      const voltar = e.target.closest("[data-op-voltar]");
      if (voltar) {
        if (!cabeAtiva()) { mostrarAviso(`Limite de ${MAX_OPCOES} opções na lista.`); return; }
        const o = opcoes[Number(voltar.dataset.opVoltar)];
        delete o.ativa; delete o.removidaEm; delete o.removidaPor;
        desenharExtra();
        return;
      }
      /* Excluir de vez: só opção removida e sem nenhuma linha (senão o nome se perderia) */
      const exc = e.target.closest("[data-op-excluir]");
      if (exc) {
        const o = opcoes[Number(exc.dataset.opExcluir)];
        if (usoDe(o)) { mostrarAviso(tituloEmUso(usoDe(o)), 6000); return; }
        opcoes = opcoes.filter((x) => x !== o);
        desenharExtra();
        return;
      }
      const sub = e.target.closest("[data-op-substituir]");
      if (sub) {
        const o = opcoes[Number(sub.dataset.opSubstituir)];
        if (o.id && antesOriginal) abrirSubstituirValor(base.id, o.id);
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const erro = form.querySelector(".form-erro");
      const nome = form.nome.value.trim();
      if (!nome) { erro.textContent = "Dê um nome à coluna."; return; }
      if (r.colunas.some((c) => c.id !== base.id && normalizar(c.nome) === normalizar(nome))) { erro.textContent = "Já existe uma coluna com esse nome."; return; }
      const tipo = tipoAtual();
      if (TIPOS_LISTA.includes(tipo) && base.origem !== "categorias" && !opcoes.some((o) => o.nome.trim())) { erro.textContent = "Adicione ao menos uma opção."; return; }
      /* Opção em uso renomeada: pergunta antes (padrão: manter o nome antigo nas linhas existentes) */
      const renomeadas = [];
      for (const o of opcoes) {
        const antes = o.id && antesOriginal && TIPOS_LISTA.includes(antesOriginal.tipo) ? antesOriginal.opcoes.find((x) => x.id === o.id) : null;
        if (!antes || o.ativa === false || !o.nome.trim() || antes.nome === o.nome.trim() || !usoDe(o)) continue;
        const modo = await perguntarRenomear(antes.nome, o.nome.trim(), usoDe(o));
        if (modo === null) return;
        renomeadas.push({ o, antigo: antes.nome, modo });
      }
      const agora = new Date().toISOString();
      const novaNoLugar = new Map();
      renomeadas.forEach(({ o, antigo, modo }) => {
        if (modo === "corrigir") { o.nomesAnteriores = [...(o.nomesAnteriores || []), { nome: antigo, ate: agora, por: quemRemove() }].slice(-5); return; }
        const nova = { id: "", nome: o.nome.trim(), cor: o.cor || "", ...(o.final ? { final: true } : {}) };
        Object.assign(o, { nome: antigo, ativa: false, removidaEm: agora, removidaPor: quemRemove() });
        opcoes.splice(opcoes.indexOf(o), 0, nova);
        novaNoLugar.set(o.id, nova);
      });
      const usadosIds = opcoes.map((o) => o.id).filter(Boolean);
      const opcoesFinais = opcoes.filter((o) => o.nome.trim()).map((o) => {
        const id = o.id || idUnico(o.nome, usadosIds);
        o.id = id;
        usadosIds.push(id);
        return {
          id, nome: o.nome.trim().slice(0, 100), cor: o.cor || "", ...(tipo === "status" && o.final ? { final: true } : {}),
          ...(o.ativa === false ? { ativa: false, removidaEm: o.removidaEm || agora, removidaPor: o.removidaPor || quemRemove() } : {}),
          ...(o.nomesAnteriores && o.nomesAnteriores.length ? { nomesAnteriores: o.nomesAnteriores } : {})
        };
      });
      const totalAtivas = opcoesFinais.filter((o) => o.ativa !== false).length;
      if (totalAtivas > MAX_OPCOES || opcoesFinais.length > MAX_OPCOES_TOTAL) { erro.textContent = `Limite: ${MAX_OPCOES} opções na lista e ${MAX_OPCOES_TOTAL} no total (contando as removidas). Exclua de vez removidas sem uso.`; return; }
      const acesso = acessoDe({ tipo, acesso: form.acesso.value });
      const final = {
        ...base, nome, tipo, grupo: form.grupo.value, largura: Math.max(60, Math.min(600, Number(form.largura.value) || 150)),
        padrao: form.padrao.value.trim().slice(0, 60), ajuda: form.ajuda.value.trim().slice(0, 200),
        obrigatoria: form.obrigatoria.checked, unica: form.unica.checked, acesso, somenteAdmin: acesso === "bloqueado",
        opcoes: TIPOS_LISTA.includes(tipo) && base.origem !== "categorias" ? opcoesFinais : []
      };
      delete final.auto; delete final.formula; delete final.de; delete final.ate;
      if (tipo === "derivado") Object.assign(final, { formula: form.formula ? form.formula.value : "diasEmAberto", de: form.de ? form.de.value : "", ate: form.ate ? form.ate.value : "" });
      if (tipo === "automatico") final.auto = form.auto ? form.auto.value : "criadoEm";
      if (TIPOS_LISTA.includes(tipo) && final.padrao && base.origem !== "categorias") {
        /* O padrão de linhas novas é sempre uma opção da lista (se a antiga saiu ao renomear, vale a nova) */
        const ativasFinais = final.opcoes.filter((o) => o.ativa !== false);
        const op = ativasFinais.find((o) => normalizar(o.nome) === normalizar(final.padrao) || o.id === final.padrao) || (novaNoLugar.has(final.padrao) ? novaNoLugar.get(final.padrao) : null);
        if (!op) { erro.textContent = "O valor padrão precisa ser o nome de uma opção da lista (não removida)."; return; }
        final.padrao = op.id;
      }
      if (nova) {
        final.id = idUnico(nome, r.colunas.map((c) => c.id), true);
        final.ordem = Math.max(0, ...r.colunas.filter((c) => c.grupo === final.grupo).map((c) => c.ordem)) + 0.5;
        r.colunas.push(final);
      } else {
        Object.keys(col).forEach((k) => delete col[k]);
        Object.assign(col, final);
        if (antesOriginal && antesOriginal.tipo !== tipo && !TIPOS_SEM_EDICAO.includes(tipo) && !TIPOS_SEM_EDICAO.includes(antesOriginal.tipo)) {
          const i = migracoes.findIndex((m) => m.tipo === "converter" && m.col === final.id);
          if (i >= 0) migracoes.splice(i, 1);
          migracoes.push({ tipo: "converter", col: final.id, nome: final.nome });
        }
      }
      renumerar();
      ed.close();
      desenhar();
      if (nova && primeira && novaColuna) aplicar();
    });
    desenharExtra();
    ed.showModal();
    form.nome.focus();
  }

  /* Prévia e aplicação */
  function resumoMudancas() {
    const itens = [];
    const ant = Object.fromEntries(original.colunas.map((c) => [c.id, c]));
    r.colunas.forEach((c) => {
      const a = ant[c.id];
      if (!a) { itens.push(`Nova coluna “${c.nome}” (${NOME_TIPO[c.tipo]})`); return; }
      if (a.nome !== c.nome) itens.push(`Coluna “${a.nome}” renomeada para “${c.nome}”`);
      if (a.tipo !== c.tipo) itens.push(`Coluna “${c.nome}”: tipo ${NOME_TIPO[a.tipo]} → ${NOME_TIPO[c.tipo]}`);
      if (a.ativa !== c.ativa) itens.push(`Coluna “${c.nome}” ${c.ativa ? "reativada" : "arquivada"}`);
      if (a.grupo !== c.grupo) itens.push(`Coluna “${c.nome}” mudou de grupo`);
      if (JSON.stringify(a.opcoes) !== JSON.stringify(c.opcoes)) itens.push(...mudancasDeOpcoes(a, c));
      if (acessoDe(a) !== acessoDe(c)) itens.push(`Coluna “${c.nome}”: acesso ${ACESSO_CURTO[acessoDe(a)]} → ${ACESSO_CURTO[acessoDe(c)]}`);
      if (a.obrigatoria !== c.obrigatoria || a.unica !== c.unica || a.padrao !== c.padrao) itens.push(`Regras da coluna “${c.nome}” alteradas`);
    });
    const sequencia = (lista, grupos) => {
      const og = (g) => (grupos.find((x) => x.id === g) || {}).ordem || 99;
      return [...lista].sort((x, y) => og(x.grupo) - og(y.grupo) || x.ordem - y.ordem).map((c) => c.id).filter((id) => original.colunas.some((c) => c.id === id) && r.colunas.some((c) => c.id === id)).join(",");
    };
    if (sequencia(original.colunas, original.gruposColunas) !== sequencia(r.colunas, r.gruposColunas)) itens.push("Ordem das colunas alterada");
    original.colunas.forEach((a) => { if (!r.colunas.some((c) => c.id === a.id)) itens.push(`Coluna “${a.nome}” excluída de vez`); });
    if (JSON.stringify(original.gruposColunas) !== JSON.stringify(r.gruposColunas)) itens.push("Grupos de colunas alterados");
    if (JSON.stringify(original.abas || {}) !== JSON.stringify(r.abas || {})) {
      const c = r.abas && r.abas.coluna && r.colunas.find((x) => x.id === r.abas.coluna);
      itens.push(c ? `Abas por “${c.nome}”` : "Sem abas");
    }
    if (JSON.stringify(original.resumo || {}) !== JSON.stringify(r.resumo || {})) itens.push(r.resumo && r.resumo.mostrar === false ? "Resumo do topo escondido" : "Resumo do topo visível");
    return [...new Set(itens)];
  }
  /* Escritas de dados que as migrações pedem (só registros que mudam) */
  function opsMigracao(estruturaNova) {
    const colsNovas = Object.fromEntries(estruturaNova.colunas.map((c) => [c.id, c]));
    const colsAntigas = Object.fromEntries(original.colunas.map((c) => [c.id, c]));
    const ops = [], arquivo = new Map(), agora = new Date().toISOString();
    let afetados = 0;
    estado.tickets.forEach((t) => {
      const campos = t.campos || {};
      const mud = {};
      migracoes.forEach((m) => {
        const atual = m.col in mud ? mud[m.col] : campos[m.col];
        if (m.tipo === "excluirColuna" && m.col in campos) mud[m.col] = "__APAGAR__";
        if (m.tipo === "converter" && !estaVazio(atual) && colsAntigas[m.col] && colsNovas[m.col]) {
          const rr = converterValor(atual, colsAntigas[m.col], colsNovas[m.col]);
          mud[m.col] = rr.ok ? rr.valor : vazioDe(colsNovas[m.col]);
        }
      });
      if (Object.keys(mud).length) {
        afetados++;
        /* Só a administradora regrava o arquivo compactado; as outras pessoas tiram a linha do arquivo (parcial) */
        if (t.arquivo && admin) arquivo.set(t.id, { ...t, campos: Object.entries(mud).reduce((cs, [c, v]) => comCampo(cs, c, v), t.campos), ...autoria("atualizadoPor"), atualizadoEm: agora });
        else if (t.arquivo) ops.push(...opsTirarDoArquivo(t, mud, "estrutura"));
        else ops.push({ op: "set", caminho: `${LINHAS}/${t.id}`, mesclar: true, dados: { campos: mud, ...assinatura() } });
      }
    });
    return { ops, arquivo, afetados };
  }
  async function aplicar() {
    const itens = resumoMudancas();
    if (!itens.length && !migracoes.length) { mostrarAviso("Nenhuma mudança para aplicar."); return; }
    if (!r.colunas.length) { mostrarAviso("A planilha precisa de ao menos uma coluna."); return; }
    const novo = normalizarEstrutura({ ...r, versao: primeira ? 1 : original.versao + 1 });
    if (!avisarTamanhoEstrutura(novo)) return;
    const { ops, arquivo, afetados } = opsMigracao(novo);
    /* Backup automático antes das mudanças grandes: dados ajustados, colunas arquivadas, excluídas ou com outro tipo */
    const grande = !primeira && (migracoes.length > 0 || itens.some((x) => /arquivada|excluída de vez|: tipo /.test(x)));
    if (!primeira && !(await confirmar(grande ? `Confira as mudanças. Antes de aplicar, é feito um backup automático (estrutura + ${estado.tickets.length} linhas).` : "Confira as mudanças:", {
      titulo: "Prévia das mudanças", botao: "Aplicar",
      html: `<ul class="lista-mudancas">${itens.map((x) => `<li>${escapar(x)}</li>`).join("")}${afetados ? `<li><strong>${afetados} linha(s) terão os dados ajustados.</strong></li>` : "<li><strong>Nenhuma linha será alterada.</strong></li>"}</ul>`
    }))) return;
    if (grande && !(await criarBackup(`Antes de mudar a estrutura (${itens.slice(0, 3).join("; ")}${itens.length > 3 ? "…" : ""})`))) return;
    try {
      if (ops.length) await estado.api.lote(ops);
      if (arquivo.size) await alterarArquivo(arquivo);
      await salvarEstrutura(novo);
      if (primeira) registrarAuditoria("criar", `Criou a planilha com ${novo.colunas.length} coluna(s)`, novo.colunas.map((c) => c.nome).join(", "));
      else registrarAuditoria("estrutura", `Mudou a estrutura (versão ${novo.versao})`, itens.join(" · "));
        const anterior = JSON.parse(JSON.stringify(original));
      if (!primeira && !ops.length && !arquivo.size && (admin || colunasIdsDe(novo).every((id) => colunasIdsDe(anterior).includes(id)))) {
        empilharDesfazer("Estrutura anterior restaurada", async () => { anterior.versao = estado.estrutura.versao + 1; await salvarEstrutura(normalizarEstrutura(anterior)); registrarAuditoria("estrutura", "Desfez a última mudança de estrutura"); });
      }
      d.close();
      mostrarAviso(primeira ? "Planilha criada. Crie mais colunas em Planilha › Estrutura ou comece a preencher." : `Estrutura aplicada${afetados ? ` (${afetados} linha(s) ajustadas)` : ""}.`, 5000);
    } catch (e) { console.error(e); mostrarAviso(primeira ? mensagemErro(e) : "Não foi possível aplicar. Se algo ficou pela metade, restaure o backup em Planilha › Backups.", 8000); }
  }
  desenhar();
  d.showModal();
  if (novaColuna) editarColuna(null);
}
/* Itens da prévia: o que mudou nas opções de uma coluna (nenhuma linha é alterada por isso) */
function mudancasDeOpcoes(a, c) {
  const ant = new Map(a.opcoes.map((o) => [o.id, o]));
  const nov = new Map(c.opcoes.map((o) => [o.id, o]));
  const lista = (xs) => xs.map((x) => `“${x}”`).join(", ");
  const novas = c.opcoes.filter((o) => !ant.has(o.id)).map((o) => o.nome);
  const removidas = c.opcoes.filter((o) => ant.has(o.id) && o.ativa === false && ant.get(o.id).ativa !== false).map((o) => o.nome);
  const voltaram = c.opcoes.filter((o) => ant.has(o.id) && o.ativa !== false && ant.get(o.id).ativa === false).map((o) => o.nome);
  const renomeadas = c.opcoes.filter((o) => ant.has(o.id) && ant.get(o.id).nome !== o.nome).map((o) => `“${ant.get(o.id).nome}” → “${o.nome}”`);
  const excluidas = a.opcoes.filter((o) => !nov.has(o.id)).map((o) => o.nome);
  const itens = [];
  if (novas.length) itens.push(`${c.nome}: nova(s) opção(ões) ${lista(novas)}`);
  if (removidas.length) itens.push(`${c.nome}: removida(s) da lista ${lista(removidas)} (as linhas continuam com o nome)`);
  if (voltaram.length) itens.push(`${c.nome}: voltou(aram) para a lista ${lista(voltaram)}`);
  if (renomeadas.length) itens.push(`${c.nome}: nome corrigido em todas as linhas ${renomeadas.join(", ")}`);
  if (excluidas.length) itens.push(`${c.nome}: excluída(s) de vez (sem uso) ${lista(excluidas)}`);
  if (!itens.length) itens.push(`Opções de “${c.nome}” alteradas (ordem, cor ou “Encerra”)`);
  return itens;
}


/* Nomes equivalentes: sem acentos, maiúsculas, pontuação, espaços e palavras como "de"/"do" ("Data concessão ticket" = "DATA DE CONCESSÃO DO TICKET") */
const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e"]);
const ABREVIACOES = { obs: "observacao", dt: "data", n: "numero", no: "numero", nro: "numero", num: "numero" };
const palavrasDoNome = (t) => normalizar(t).split(/[^a-z0-9]+/).filter(Boolean).map((p) => ABREVIACOES[p] || p).filter((p) => !PALAVRAS_VAZIAS.has(p));
function nomesEquivalentes(a, b, parcial) {
  const pa = palavrasDoNome(a), pb = palavrasDoNome(b);
  if (!pa.length || !pb.length) return false;
  if (pa.join("") === pb.join("")) return true;
  if (!parcial) return false;
  const [menor, maior] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  return menor.length >= 2 && menor.every((p) => maior.includes(p));
}

/* ------------------------------------------------------------
 *  Valores fora da lista: mapear para uma opção, criar como opção nova ou manter.
 *  A gravação vai em lotes; se a cota diária do plano gratuito acabar, o que falta fica guardado para continuar.
 * ------------------------------------------------------------ */
const chavePendente = () => chaveUsuario("conversao-pendente");
const LOTE_VIVOS = 100;
/* itens: [[idRegistro, idColuna, valorNovo]] */
async function converterEmLotes(itens, rotulo, aoProgresso = () => {}) {
  const pendentes = new Map(itens.map(([id, c, v]) => [`${id}|${c}`, [id, c, v]]));
  const guardar = () => (pendentes.size ? gravarLocal(chavePendente(), { rotulo, itens: [...pendentes.values()] }) : apagarLocal(chavePendente()));
  guardar();
  const total = pendentes.size;
  const m = mapaTickets();
  const porRegistro = new Map();
  pendentes.forEach(([id, c, v]) => { if (!porRegistro.has(id)) porRegistro.set(id, {}); porRegistro.get(id)[c] = v; });
  const doArquivo = [], vivos = [];
  porRegistro.forEach((mud, id) => { const t = m.get(id); if (!t) { Object.keys(mud).forEach((c) => pendentes.delete(`${id}|${c}`)); return; } (t.arquivo && ehAdmin() ? doArquivo : vivos).push([t, mud]); });
  const concluir = (lista) => lista.forEach(([t, mud]) => Object.keys(mud).forEach((c) => pendentes.delete(`${t.id}|${c}`)));
  try {
    /* Linhas do arquivo: uma só regravação das partes afetadas (todas as colunas juntas) */
    if (doArquivo.length) {
      const agora = new Date().toISOString();
      await alterarArquivo(new Map(doArquivo.map(([t, mud]) => [t.id, { ...t, campos: Object.entries(mud).reduce((cs, [c, v]) => comCampo(cs, c, v), t.campos), ...autoria("atualizadoPor"), atualizadoEm: agora }])));
      concluir(doArquivo); guardar(); aoProgresso(total - pendentes.size, total);
    }
    for (let i = 0; i < vivos.length; i += LOTE_VIVOS) {
      const lote = vivos.slice(i, i + LOTE_VIVOS);
      await estado.api.lote(lote.flatMap(([t, mud]) => opsAlteracao(t, mud, rotulo)));
      concluir(lote); guardar(); aoProgresso(total - pendentes.size, total);
    }
    return { ok: true, faltam: 0 };
  } catch (e) {
    console.error(e);
    guardar();
    return { ok: false, faltam: pendentes.size, cota: /resource-exhausted|quota/i.test((e && (e.code || e.message)) || "") };
  }
}
function textoResultadoConversao(r) {
  if (r.ok) return "Conversão concluída.";
  return r.cota
    ? `O limite diário de gravações do plano gratuito acabou. Faltam ${r.faltam} alteração(ões); elas ficaram guardadas neste navegador. Amanhã, use Planilha › “Continuar a conversão”.`
    : `A conversão parou (sem conexão ou sem permissão). Faltam ${r.faltam} alteração(ões); use Planilha › “Continuar a conversão”.`;
}
async function continuarConversao() {
  const p = lerLocal(chavePendente(), null);
  if (!p || !p.itens || !p.itens.length) { apagarLocal(chavePendente()); mostrarAviso("Não há conversão pendente."); return; }
  mostrarAviso(`Continuando: ${p.itens.length} alteração(ões)…`, 20000);
  const r = await converterEmLotes(p.itens, p.rotulo || "corrigirLista");
  registrarAuditoria("corrigirLista", `Continuou a conversão: ${p.itens.length - r.faltam} de ${p.itens.length} alteração(ões)`);
  mostrarAviso(textoResultadoConversao(r), 9000);
}
/* ------------------------------------------------------------
 *  Substituir valor nas linhas (só administradoras, nunca automático): prévia, backup, lotes com
 *  "continuar depois", histórico em cada linha e auditoria. A opção de origem não é apagada.
 * ------------------------------------------------------------ */
function abrirSubstituirValor(colInicial = "", opInicial = "") {
  if (!ehAdmin() || !estado.estrutura) return;
  const cols = colunasAtivas().filter((c) => TIPOS_LISTA.includes(c.tipo) && podeEditarColuna(c));
  if (!cols.length) { mostrarAviso("Não há colunas de lista."); return; }
  const d = criarDialogo({
    titulo: "Substituir valor nas linhas",
    largo: true,
    corpo: `<p class="apoio">Troca um valor por outro em todas as linhas que o usam (inclusive no arquivo compactado). Antes, é feito um backup. Cada linha alterada ganha o registro no histórico.</p>
      <div class="campos-linha">
        <label class="campo"><span class="rotulo">Coluna</span><select name="coluna">${cols.map((c) => `<option value="${escapar(c.id)}"${c.id === colInicial ? " selected" : ""}>${escapar(c.nome)}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Trocar</span><select name="de"></select></label>
        <label class="campo"><span class="rotulo">Por</span><select name="para"></select></label>
      </div>
      <label class="check"><input type="checkbox" name="tirar"> Depois, remover a opção de origem da lista (se ela ainda estiver na lista)</label>
      <div id="sub-previa" class="aviso-repetido" style="display:grid;margin-top:10px" hidden></div>
      <p class="apoio" role="status" id="sub-progresso"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button><button type="submit" class="btn" id="sub-ok">Substituir</button></div>`
  });
  const form = d.querySelector("form");
  const col = () => COL[form.coluna.value];
  const usa = (v, id) => (Array.isArray(v) ? v.includes(id) : v === id);
  const afetados = () => estado.tickets.filter((t) => usa((t.campos || {})[col().id], form.de.value));
  const desenharOpcoes = (opInicialAgora) => {
    const c = col();
    const uso = usoDasOpcoes(c.id);
    form.de.innerHTML = opcoesDe(c).filter((o) => uso.get(o.id)).map((o) => `<option value="${escapar(o.id)}"${o.id === opInicialAgora ? " selected" : ""}>${escapar(o.nome)}${o.ativa === false ? " (removida da lista)" : ""} · ${uso.get(o.id)} lin.</option>`).join("") || '<option value="">(nenhuma opção em uso)</option>';
    desenharDestino();
  };
  const desenharDestino = () => {
    form.para.innerHTML = `<option value="">(deixar vazio)</option>${opcoesAtivas(col()).filter((o) => o.id !== form.de.value).map((o) => `<option value="${escapar(o.id)}">${escapar(o.nome)}</option>`).join("")}`;
    desenharPrevia();
  };
  const desenharPrevia = () => {
    const caixa = $("#sub-previa", d);
    const lista = form.de.value ? afetados() : [];
    caixa.hidden = !form.de.value;
    const c = col(), de = opcao(c, form.de.value), para = form.para.value ? opcao(c, form.para.value) : null;
    const titulo = colTitulo();
    caixa.innerHTML = `${svg("i-info")}<strong>Prévia: ${lista.length} linha(s) mudam de “${escapar(de ? de.nome : "")}” para “${escapar(para ? para.nome : "(vazio)")}”.</strong>
      ${lista.length ? `<span>Exemplos: ${lista.slice(0, 5).map((t) => escapar((titulo && valorTexto(t, titulo)) || t.id)).join(", ")}${lista.length > 5 ? "…" : ""}</span>` : ""}
      <span>A opção “${escapar(de ? de.nome : "")}” não é apagada.</span>`;
    $("#sub-ok", d).disabled = !lista.length;
  };
  form.coluna.addEventListener("change", () => desenharOpcoes(""));
  form.de.addEventListener("change", desenharDestino);
  form.para.addEventListener("change", desenharPrevia);
  desenharOpcoes(opInicial);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = col(), deId = form.de.value, paraId = form.para.value;
    const de = opcao(c, deId), para = paraId ? opcao(c, paraId) : null;
    const lista = afetados();
    if (!de || !lista.length) return;
    if (!(await confirmar(`${lista.length} linha(s) de ${c.nome} passam de “${de.nome}” para “${para ? para.nome : "(vazio)"}”. Um backup é feito antes. Continuar?`, { titulo: "Substituir valor nas linhas", botao: "Substituir" }))) return;
    const progresso = $("#sub-progresso", d);
    $("#sub-ok", d).disabled = true;
    progresso.textContent = "Fazendo o backup…";
    if (!(await criarBackup(`Antes de substituir “${de.nome}” por “${para ? para.nome : "(vazio)"}” em ${c.nome}`))) { progresso.textContent = ""; $("#sub-ok", d).disabled = false; return; }
    const itens = lista.map((t) => {
      const v = (t.campos || {})[c.id];
      const novo = Array.isArray(v) ? [...new Set(v.map((x) => (x === deId ? paraId : x)).filter(Boolean))] : paraId;
      return [t.id, c.id, novo];
    });
    progresso.textContent = `Gravando ${itens.length} alteração(ões)…`;
    const r = await converterEmLotes(itens, "substituirValor", (feitos, total) => { progresso.textContent = `Gravando… ${feitos} de ${total}`; });
    registrarAuditoria("substituirValor", `Substituiu “${de.nome}” por “${para ? para.nome : "(vazio)"}” em ${c.nome}`, `${itens.length - r.faltam} de ${itens.length} linha(s) alterada(s)`);
    if (r.ok && form.tirar.checked && de.ativa !== false) {
      await salvarOpcoesDaEstrutura((nova) => {
        const o = nova.colunas.find((x) => x.id === c.id).opcoes.find((y) => y.id === deId);
        if (o) Object.assign(o, { ativa: false, removidaEm: new Date().toISOString(), removidaPor: String(autorAtual() || "").slice(0, 120) });
      }, `Removeu da lista a opção “${de.nome}” de ${c.nome}`);
    }
    progresso.textContent = textoResultadoConversao(r);
    if (r.ok) { d.close(); mostrarAviso(`Pronto: ${itens.length} linha(s) alterada(s).`, 6000); }
  });
  d.showModal();
}
/* ------------------------------------------------------------
 *  Recuperar nomes de opções apagadas (antes desta versão, apagar uma opção tirava o nome da estrutura).
 *  Procura o nome nos backups, no histórico das linhas e na auditoria da Central; recria a opção como
 *  REMOVIDA DA LISTA. Nenhuma linha é regravada.
 * ------------------------------------------------------------ */
/* Valores com cara de id de opção ("paula-katiele") que não existem mais na coluna */
function idsSoltos() {
  const lista = [];
  colunasAtivas().filter((c) => TIPOS_LISTA.includes(c.tipo) && !c.origem).forEach((col) => {
    const n = new Map();
    estado.tickets.forEach((t) => {
      const v = (t.campos || {})[col.id];
      (Array.isArray(v) ? v : estaVazio(v) ? [] : [v]).forEach((x) => { if (typeof x === "string" && RE_OPCAO.test(x) && !opcao(col, x)) n.set(x, (n.get(x) || 0) + 1); });
    });
    n.forEach((qtd, id) => lista.push({ col, id, n: qtd }));
  });
  return lista;
}
const nomeDoId = (id) => id.replace(/-\d+$/, "").split("-").filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
async function procurarNomes(soltos) {
  const achados = new Map();
  const chave = (s) => `${s.col.id}|${s.id}`;
  const confere = (id, nome) => { const s = slug(nome, 40); return !!s && (s === id || id.replace(/-\d+$/, "") === s); };
  const guardar = (s, nome, fonte, exato) => { if (!achados.has(chave(s)) && nome && (exato || confere(s.id, nome))) achados.set(chave(s), { nome: String(nome).slice(0, 100), fonte }); };
  /* 1) Estrutura guardada nos backups: o id e o nome exatos */
  try {
    const backups = await estado.api.lerColecao(BACKUPS, { ordenar: "criadoEm", desc: true, limite: 50 });
    backups.forEach((b) => {
      let e = null;
      try { e = JSON.parse(b.estrutura || "null"); } catch (err) { e = null; }
      if (!e) return;
      soltos.forEach((s) => {
        const c = (e.colunas || []).find((x) => x.id === s.col.id);
        const o = c && (c.opcoes || []).find((y) => y.id === s.id);
        if (o) guardar(s, o.nome, `backup de ${formatarData(b.criadoEm)}`, true);
      });
    });
  } catch (e) { console.warn("Backups:", e); }
  /* 2) Histórico das linhas que têm o valor (até 5 linhas por valor): o nome que aparecia na época */
  for (const s of soltos) {
    if (achados.has(chave(s))) continue;
    const linhas = estado.tickets.filter((t) => { const v = (t.campos || {})[s.col.id]; return Array.isArray(v) ? v.includes(s.id) : v === s.id; }).slice(0, 5);
    for (const t of linhas) {
      try {
        const hs = await estado.api.lerColecao(`${LINHAS}/${t.id}/historico`, { ordenar: "em", desc: true, limite: 50 });
        hs.filter((h) => h.coluna === s.col.id || h.colunaNome === s.col.nome).forEach((h) => [h.depois, h.antes].forEach((x) => String(x || "").split(",").forEach((nome) => guardar(s, nome.trim(), "histórico da linha"))));
      } catch (e) { console.warn("Histórico:", e); }
      if (achados.has(chave(s))) break;
    }
  }
  /* 3) Auditoria da Central (só desta planilha): nomes entre aspas */
  if (soltos.some((s) => !achados.has(chave(s)))) {
    try {
      const aud = (await estado.api.lerColecao("auditoria", { ordenar: "criadoEm", desc: true, limite: 500 })).filter((a) => a.alvo === "planilha" && String(a.detalhes || "").includes(`planilha: ${ID}`));
      aud.forEach((a) => (`${a.resumo || ""} ${a.detalhes || ""}`.match(/“([^”]{1,100})”/g) || []).forEach((q) => soltos.forEach((s) => guardar(s, q.slice(1, -1), "auditoria"))));
    } catch (e) { console.warn("Auditoria:", e); }
  }
  return achados;
}
async function abrirRecuperarNomes() {
  if (!ehAdmin() || !estado.estrutura) return;
  const soltos = idsSoltos();
  const d = criarDialogo({ titulo: "Recuperar nomes de opções apagadas", largo: true, corpo: `<p class="apoio">Valores gravados nas linhas cuja opção foi apagada da lista antes desta atualização. O nome é procurado nos backups, no histórico das linhas e na auditoria. Ao confirmar, a opção volta à estrutura como <strong>removida da lista</strong>: as linhas passam a mostrar o nome e nenhuma delas é regravada.</p>
    <div id="rec-lista"><p class="apoio">${soltos.length ? "Procurando os nomes…" : "Nenhum valor sem nome encontrado."}</p></div>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button>${soltos.length ? '<button type="submit" class="btn" id="rec-ok" disabled>Recriar como removidas da lista</button>' : ""}</div>` });
  d.showModal();
  if (!soltos.length) return;
  const achados = await procurarNomes(soltos);
  const itens = soltos.map((s) => ({ ...s, ...(achados.get(`${s.col.id}|${s.id}`) || { nome: nomeDoId(s.id), fonte: "" }) }));
  $("#rec-lista", d).innerHTML = `<div class="tabela-admin"><table><thead><tr><th></th><th>Coluna</th><th>Valor gravado</th><th>Linhas</th><th>Nome</th><th>Encontrado em</th></tr></thead><tbody>${itens.map((x, i) => `<tr>
    <td><input type="checkbox" data-rec="${i}" checked aria-label="Recriar ${escapar(x.id)}"></td><td>${escapar(x.col.nome)}</td><td><code>${escapar(x.id)}</code></td><td>${x.n}</td>
    <td><input data-rec-nome="${i}" value="${escapar(x.nome)}" maxlength="100" aria-label="Nome de ${escapar(x.id)}"></td>
    <td>${x.fonte ? escapar(x.fonte) : '<span class="apoio">não encontrado: sugestão a partir do id, confira</span>'}</td></tr>`).join("")}</tbody></table></div>`;
  $("#rec-ok", d).disabled = false;
  d.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const escolhidos = itens.map((x, i) => ({ ...x, nome: $(`[data-rec-nome="${i}"]`, d).value.trim().slice(0, 100) })).filter((x, i) => $(`[data-rec="${i}"]`, d).checked && x.nome);
    if (!escolhidos.length) { mostrarAviso("Marque ao menos um valor com nome."); return; }
    if (!(await confirmar(`${escolhidos.length} opção(ões) voltam à estrutura como removidas da lista: ${escolhidos.map((x) => `“${x.nome}”`).join(", ").slice(0, 400)}. Nenhuma linha é regravada.`, { titulo: "Recuperar nomes", botao: "Recriar" }))) return;
    const agora = new Date().toISOString();
    const ok = await salvarOpcoesDaEstrutura((nova) => escolhidos.forEach((x) => {
      const c = nova.colunas.find((y) => y.id === x.col.id);
      if (c && !c.opcoes.some((o) => o.id === x.id)) c.opcoes.push({ id: x.id, nome: x.nome, cor: "", ativa: false, removidaEm: agora, removidaPor: String(autorAtual() || "").slice(0, 120) });
    }), `Recuperou ${escolhidos.length} nome(s) de opções apagadas`, escolhidos.map((x) => `${x.col.nome}: ${x.id} → “${x.nome}”${x.fonte ? ` (${x.fonte})` : ""}`).join(" · "));
    if (ok) { d.close(); mostrarAviso(`${escolhidos.length} nome(s) recuperado(s). As linhas já mostram o nome.`, 6000); }
  });
}
/* Na primeira abertura de uma administradora depois desta atualização (em cada planilha): procura valores sem nome, sem custo de leitura */
const CHAVE_NOMES_VERIFICADOS = `suporte-n2-planilha-${ID}-nomes-verificados-v1`;
let nomesVerificados = false;
function verificarNomesPerdidos() {
  if (nomesVerificados || !ehAdmin() || !estado.estrutura || !estado.carregouTickets || lerLocal(CHAVE_NOMES_VERIFICADOS, false)) return;
  nomesVerificados = true;
  gravarLocal(CHAVE_NOMES_VERIFICADOS, true);
  const n = idsSoltos().length;
  if (!n) return;
  setTimeout(async () => {
    if (await confirmar(`${n} valor(es) sem nome encontrado(s) nesta planilha: são de opções apagadas da lista antes desta atualização e hoje aparecem como “fora da lista”.`, { titulo: "Valores sem nome", botao: "Revisar" })) abrirRecuperarNomes();
  }, 1500);
}
/* Muda só opções da estrutura (voltar para a lista, recuperar nomes). Nenhuma linha é regravada. */
async function salvarOpcoesDaEstrutura(mudar, resumo, detalhes = "") {
  const nova = JSON.parse(JSON.stringify(estado.estrutura));
  mudar(nova);
  nova.versao = estado.estrutura.versao + 1;
  const e = normalizarEstrutura(nova);
  if (!avisarTamanhoEstrutura(e)) return false;
  try {
    await salvarEstrutura(e);
    registrarAuditoria("estrutura", resumo, detalhes);
    return true;
  } catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); return false; }
}
/* O documento da planilha (com a estrutura) precisa ficar abaixo de 1 MB (limite do Firestore) */
const LIMITE_ESTRUTURA = 1000000;
function avisarTamanhoEstrutura(e) {
  const n = bytes(JSON.stringify(dadosEstruturaBackup(e)));
  if (n > LIMITE_ESTRUTURA * 0.95) { mostrarAviso(`A estrutura ficou grande demais (${Math.round(n / 1024)} KB de 1.000 KB). Exclua de vez opções removidas sem uso antes de continuar.`, 9000); return false; }
  if (n > LIMITE_ESTRUTURA * 0.75) mostrarAviso(`Atenção: a estrutura já usa ${Math.round(n / 1024)} KB de 1.000 KB. Exclua de vez opções removidas sem uso.`, 8000);
  return true;
}
/* Opções removidas da lista que ainda têm linhas (informativo: não são erro) */
function removidasEmUso() {
  const lista = [];
  colunasAtivas().filter((c) => TIPOS_LISTA.includes(c.tipo) && !c.origem).forEach((col) => {
    opcoesDe(col).filter((o) => o.ativa === false).forEach((o) => { const n = contarUso(col.id, o.id); if (n) lista.push({ col, o, n }); });
  });
  return lista;
}
function abrirForaDaLista() {
  if (!podeAlimentar()) return;
  const cols = colunasAtivas().filter((c) => c.tipo === "lista" && !c.origem && podeEditarColuna(c));
  const emUso = removidasEmUso();
  const htmlRemovidas = emUso.length ? `<h3 style="font-size:14px;margin-top:14px">Opções removidas ainda em uso (${emUso.length})</h3>
    <p class="apoio" style="font-size:13px">Não são erro: as linhas continuam com o nome. Nada precisa ser corrigido.</p>
    <div class="tabela-admin"><table><thead><tr><th>Coluna</th><th>Opção</th><th>Linhas</th><th></th></tr></thead><tbody>${emUso.map((x, i) => `<tr>
      <td>${escapar(x.col.nome)}</td><td>${escapar(x.o.nome)}${marcaRemovida(x.o)}</td><td>${x.n}</td>
      <td>${podeMontar() ? `<button type="button" class="btn btn-secundario btn-mini" data-voltar-lista="${i}">Voltar para a lista</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : "";
  const grupos = [];
  cols.forEach((col) => {
    const porValor = new Map();
    estado.tickets.forEach((t) => {
      const v = (t.campos || {})[col.id];
      if (!foraDaLista(col, v)) return;
      if (!porValor.has(v)) porValor.set(v, { col, valor: v, nome: (opcao(col, v) || { nome: String(v) }).nome, n: 0 });
      porValor.get(v).n++;
    });
    [...porValor.values()].sort((a, b) => b.n - a.n).forEach((g) => { g.sugestao = sugerirOpcao(col, g.nome, 0.45); g.forte = sugestaoForte(g.sugestao); grupos.push(g); });
  });
  const d = criarDialogo({
    titulo: "Corrigir valores fora da lista",
    largo: true,
    corpo: grupos.length ? `<p class="apoio">Valores antigos que não são opções ativas. Nada é apagado: escolha o que fazer com cada um. Antes de aplicar, é feito um backup.</p>
      <div class="tabela-admin"><table><thead><tr><th>Coluna</th><th>Valor</th><th>Registros</th><th>O que fazer</th></tr></thead><tbody>${grupos.map((g, i) => `<tr data-g="${i}">
        <td>${escapar(g.col.nome)}</td><td><strong>${escapar(g.nome)}</strong></td><td>${g.n}</td>
        <td><select data-acao-fora="${i}" aria-label="O que fazer com ${escapar(g.nome)}"><option value="manter">Manter como está</option><option value="mapear"${g.forte ? " selected" : ""}>Mapear para opção</option><option value="criar">Criar como nova opção</option></select>
          <select data-opcao-fora="${i}" aria-label="Opção para ${escapar(g.nome)}"${g.forte ? "" : " hidden"}>${opcoesAtivas(g.col).map((o) => `<option value="${escapar(o.id)}"${g.sugestao && g.sugestao.id === o.id ? " selected" : ""}>${escapar(o.nome)}</option>`).join("")}</select>
          ${g.sugestao && !g.forte ? `<span class="apoio" style="font-size:12px">Parecida: ${escapar(g.sugestao.nome)} (confira antes de mapear)</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="apoio" style="font-size:13px">“Mapear” já vem marcado só quando o nome é igual ou contém o da opção (ou vice-versa). Confira cada linha antes de aplicar.</p>
      <p class="apoio" role="status" id="fora-progresso"></p>${htmlRemovidas}
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button><button type="submit" class="btn">Aplicar</button></div>`
      : `<p class="apoio">Nenhum valor fora da lista nas colunas LISTA.</p>${htmlRemovidas}<div class="form-botoes"><button type="button" class="btn" data-fechar>Fechar</button></div>`
  });
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-voltar-lista]");
    if (!b) return;
    const x = emUso[Number(b.dataset.voltarLista)];
    b.disabled = true;
    const ok = await salvarOpcoesDaEstrutura((nova) => {
      const o = nova.colunas.find((c) => c.id === x.col.id).opcoes.find((y) => y.id === x.o.id);
      if (o) { delete o.ativa; delete o.removidaEm; delete o.removidaPor; }
    }, `Voltou para a lista a opção “${x.o.nome}” de ${x.col.nome}`);
    if (ok) { b.closest("tr").remove(); mostrarAviso(`“${x.o.nome}” voltou para a lista.`); } else b.disabled = false;
  });
  d.addEventListener("change", (e) => {
    const i = e.target.dataset.acaoFora;
    if (i != null) $(`[data-opcao-fora="${i}"]`, d).hidden = e.target.value !== "mapear";
  });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!grupos.length) return;
    const escolhas = grupos.map((g, i) => ({ ...g, acao: $(`[data-acao-fora="${i}"]`, d).value, para: $(`[data-opcao-fora="${i}"]`, d).value }));
    const mapear = escolhas.filter((g) => g.acao === "mapear" && g.para);
    const criar = escolhas.filter((g) => g.acao === "criar");
    if (!mapear.length && !criar.length) { mostrarAviso("Nada para aplicar."); return; }
    const afetados = [...mapear, ...criar].reduce((s, g) => s + g.n, 0);
    if (!(await confirmar(`${mapear.length} valor(es) mapeado(s) e ${criar.length} criado(s) como opção nova; ${afetados} registro(s) afetado(s). Um backup é feito antes.`, { titulo: "Corrigir valores fora da lista", botao: "Aplicar" }))) return;
    const progresso = $("#fora-progresso", d);
    progresso.textContent = "Fazendo o backup…";
    if (!(await criarBackup("Antes de corrigir valores fora da lista"))) { progresso.textContent = ""; return; }
    /* 1) Estrutura: opção arquivada volta a ser ativa; valor solto vira opção nova */
    const nova = JSON.parse(JSON.stringify(estado.estrutura));
    const trocas = [];
    criar.forEach((g) => {
      const col = nova.colunas.find((c) => c.id === g.col.id);
      const id = idUnico(g.nome, col.opcoes.map((o) => o.id));
      col.opcoes.push({ id, nome: String(g.nome).slice(0, 100), cor: "" });
      trocas.push({ col: g.col.id, de: g.valor, para: id });
    });
    mapear.forEach((g) => trocas.push({ col: g.col.id, de: g.valor, para: g.para }));
    try {
      if (criar.length) { nova.versao = estado.estrutura.versao + 1; await salvarEstrutura(normalizarEstrutura(nova)); }
    } catch (err) { console.error(err); progresso.textContent = ""; mostrarAviso(mensagemErro(err)); return; }
    /* 2) Dados: troca o valor nos registros (arquivo e vivos) */
    const itens = [];
    trocas.forEach((x) => estado.tickets.forEach((t) => { if ((t.campos || {})[x.col] === x.de) itens.push([t.id, x.col, x.para]); }));
    progresso.textContent = `Gravando ${itens.length} alteração(ões)…`;
    const r = await converterEmLotes(itens, "corrigirLista", (feitos, total) => { progresso.textContent = `Gravando… ${feitos} de ${total}`; });
    registrarAuditoria("corrigirLista", `Corrigiu valores fora da lista: ${mapear.length} mapeado(s), ${criar.length} criado(s)`, `${itens.length - r.faltam} de ${itens.length} alteração(ões) gravada(s)`);
    progresso.textContent = textoResultadoConversao(r);
    if (r.ok) { d.close(); mostrarAviso(`Pronto: ${itens.length} registro(s) corrigido(s).`, 6000); }
  });
  d.showModal();
}

/* Menu "Planilha" (para todos; as ações de administradora só aparecem para elas) */
const podeMontar = () => conectado() && !contaSemPermissao();
function abrirMenuPlanilha(botao) {
  fecharPop();
  const pendente = lerLocal(chavePendente(), null);
  const vivas = estado.vivos.filter((t) => !t.removida).length;
  const itens = [
    ...(podeMontar() ? [["estrutura", "i-ajustes", "Estrutura (colunas, grupos, abas e resumo)"]] : []),
    ...(podeAlimentar() ? [["fora", "i-alerta", "Corrigir valores fora da lista"]] : []),
    ...(ehAdmin() ? [["substituir", "i-ordenar", "Substituir valor nas linhas"], ["recuperar-nomes", "i-relogio", "Recuperar nomes de opções apagadas"]] : []),
    ...(podeAlimentar() && pendente && pendente.itens && pendente.itens.length ? [["continuar", "i-restaurar", `Continuar a conversão (${pendente.itens.length} pendente(s))`]] : []),
    ["lixeira", "i-lixeira", `Lixeira (${estado.lixeira.length})`],
    ["backups", "i-salvar", "Backups"],
    ...(ehAdmin() ? [["compactar", "i-tabela", `Compactar linhas (${vivas} fora do arquivo)`]] : []),
    ...(!ehAdmin() && !contaSemPermissao() ? [["nome", "i-usuario", nomeGuardado() ? `Seu nome: ${nomeGuardado()} (trocar)` : "Informar o seu nome"]] : [])
  ];
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.style.width = "280px";
  pop.setAttribute("role", "menu");
  pop.innerHTML = itens.map(([id, icone, nome]) => `<button type="button" class="item-menu" role="menuitem" data-adm="${id}">${svg(icone)}${escapar(nome)}</button>`).join("");
  posicionarPop(pop, botao, 280);
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-adm]");
    if (!b) return;
    fecharPop();
    const a = b.dataset.adm;
    if (a === "nome") { pedirNome({ trocar: true }).then((ok) => { if (ok) mostrarAviso(`Suas alterações serão assinadas como ${nomeGuardado()}.`); }); return; }
    if (!conectado()) { mostrarAviso("Sem conexão: as ferramentas da planilha ficam bloqueadas."); return; }
    if (a === "estrutura") abrirEstrutura();
    if (a === "fora") abrirForaDaLista();
    if (a === "substituir") abrirSubstituirValor();
    if (a === "recuperar-nomes") abrirRecuperarNomes();
    if (a === "continuar") continuarConversao();
    if (a === "lixeira") abrirLixeira();
    if (a === "backups") abrirBackups();
    if (a === "compactar") compactarArquivo();
  });
  pop.querySelector("button").focus();
}
$("#btn-admin").innerHTML = svg("i-engrenagem") + "<span>Planilha</span>";
$("#btn-admin").addEventListener("click", (e) => abrirMenuPlanilha(e.currentTarget));
$("#btn-faixa-compactar").addEventListener("click", () => { if (!conectado()) { mostrarAviso("Sem conexão."); return; } compactarArquivo(); });

/* ------------------------------------------------------------
 *  Telas e botões
 * ------------------------------------------------------------ */
function mostrarTela(qual) {
  ["tela-carregando", "tela-nao-encontrada", "app"].forEach((id) => { $("#" + id).hidden = id !== qual; });
}
function mostrarNaoEncontrada(texto, titulo = "Planilha não encontrada") {
  $("#tela-nao-encontrada h1").textContent = titulo;
  if (texto) $("#nao-encontrada-texto").textContent = texto;
  $(".topo-planilha .busca").hidden = true;
  document.title = `${titulo} · Suporte V/CERT`;
  mostrarTela("tela-nao-encontrada");
}
function atualizarBotoes() {
  const alimenta = podeAlimentar();
  $$("[data-editor]").forEach((b) => { b.hidden = !alimenta; });
  $("#btn-desfazer").disabled = !estado.desfazer.length;
  $("#btn-admin").hidden = !estado.api;
  $("#faixa-offline").hidden = !(estado.offline || (estado.usandoCopia && !estado.carregouTickets));
  $("#faixa-rascunho").hidden = !(estado.bloco && estado.bloco.rascunho);
  $("#faixa-conta").hidden = !contaSemPermissao();
  const vivas = estado.vivos.filter((t) => !t.removida).length;
  const compactar = ehAdmin() && vivas > LIMITE_VIVAS;
  $("#faixa-compactar").hidden = !compactar;
  if (compactar) $("#faixa-compactar-texto").textContent = `${vivas.toLocaleString("pt-BR")} linhas fora do arquivo compactado: abrir a planilha gasta mais leituras do Firebase. Compacte num horário em que ninguém esteja editando.`;
}
function marcarTitulo() {
  const nome = tituloPlanilha();
  $("#titulo-planilha").textContent = nome;
  document.title = `${nome} · Suporte V/CERT`;
  if (estado.bloco && estado.bloco.catId) $("#btn-voltar").href = `index.html#${encodeURIComponent(estado.bloco.catId)}`;
}

/* ------------------------------------------------------------
 *  Planilha nova (vazia): sem colunas e sem linhas, com 3 caminhos.
 *  Nada é gravado até a primeira coluna ser criada.
 * ------------------------------------------------------------ */
function renderizarSemEstrutura() {
  const caixa = $("#sem-estrutura");
  const sem = estado.carregouEstrutura && !estado.estrutura;
  caixa.hidden = !sem;
  ["#resumo", "#abas", ".barra", "#area-dados"].forEach((s) => { $(s).hidden = sem; });
  if (!sem) return;
  caixa.innerHTML = `<div class="cartao-login assistente-planilha"><div class="cabeca"><h2>${escapar(tituloPlanilha())}</h2>
      <p class="apoio">Planilha vazia: ainda não tem colunas nem linhas. Escolha como começar. Nada é gravado até a primeira coluna ser criada.</p></div>
      ${podeMontar() ? `<button type="button" class="caminho" data-criar="coluna"><strong>+ Adicionar primeira coluna</strong><span>Escolha o nome e o tipo. Depois dá para criar as outras em Planilha › Estrutura.</span></button>
      <button type="button" class="caminho" data-criar="colar"><strong>Colar do Excel</strong><span>A primeira linha vira os nomes das colunas (com o tipo sugerido pelo conteúdo). As outras linhas só viram registros se você marcar a opção.</span></button>
      <button type="button" class="caminho" data-criar="copiar"><strong>Usar a estrutura de outra planilha</strong><span>Copia só as colunas, sem as linhas.</span></button>`
      : `<p class="apoio">${escapar(contaSemPermissao() ? "Esta conta não edita as planilhas. Saia da conta para começar a planilha assinando com o seu nome." : "Sem conexão: as colunas podem ser criadas quando a internet voltar.")}</p>`}</div>`;
  caixa.querySelectorAll("[data-criar]").forEach((b) => b.addEventListener("click", () => criarPlanilha(b.dataset.criar)));
}
const estruturaVazia = () => ({ titulo: tituloPlanilha(), versao: 1, colunas: [], gruposColunas: [{ id: "geral", nome: "Geral", ordem: 1 }], abas: {}, resumo: { mostrar: true } });
function criarPlanilha(caminho) {
  if (!podeMontar()) return;
  if (estado.docExiste) { mostrarAviso("Esta planilha já tem colunas."); return; }
  if (caminho === "coluna") abrirEstrutura({ novaColuna: true });
  if (caminho === "colar") abrirCriarPorColagem();
  if (caminho === "copiar") abrirCopiarEstrutura();
}
/* Grava a estrutura em planilhas/{id}. colunasIds e colunasAdmin são as listas que as regras conferem. */
async function salvarEstrutura(e) {
  const dados = {
    titulo: String(tituloPlanilha()).slice(0, 120), estrutura: dadosEstruturaBackup(e),
    colunasIds: colunasIdsDe(e), colunasAdmin: colunasAdminDe(e), versao: Math.floor(Number(e.versao)) || 1,
    atualizadoPor: autorAtual() || "__AUTOR__", atualizadoEm: "__AGORA__"
  };
  if (estado.docExiste) await estado.api.atualizarDoc(DOC, dados);
  else await estado.api.salvarDoc(DOC, { ...dados, criadoPor: autorAtual() || "__AUTOR__", criadoEm: "__AGORA__" });
  estado.docExiste = true;
}
/* Sem login, ninguém cria colunas "Só administradoras": elas viram LIVRE/LISTA */
function semColunasAdmin(e) {
  let n = 0;
  e.colunas.forEach((c) => { if (c.somenteAdmin) { n++; c.somenteAdmin = false; c.acesso = acessoDe({ tipo: c.tipo }); } });
  return n;
}
async function abrirCopiarEstrutura() {
  const d = criarDialogo({ titulo: "Usar a estrutura de outra planilha", corpo: `<p class="apoio">Copia só as colunas (nomes, tipos, opções, grupos e abas). Nenhuma linha é copiada.</p>
    <div id="copiar-lista"><p class="apoio">Carregando as planilhas…</p></div>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn" id="copiar-ok" disabled>Copiar as colunas</button></div>` });
  const form = d.querySelector("form");
  const erro = form.querySelector(".form-erro");
  d.showModal();
  let lista = [];
  try {
    lista = (await estado.api.lerColecao("planilhas")).filter((p) => p.id !== ID && p.estrutura && Array.isArray(p.estrutura.colunas) && p.estrutura.colunas.length)
      .sort((a, b) => String(a.titulo || a.id).localeCompare(String(b.titulo || b.id), "pt-BR"));
  } catch (e) { console.error(e); $("#copiar-lista", d).innerHTML = '<p class="apoio">Não foi possível carregar as planilhas.</p>'; return; }
  $("#copiar-lista", d).innerHTML = lista.length
    ? `<label class="campo"><span class="rotulo">Planilha de origem</span><select name="origem">${lista.map((p) => `<option value="${escapar(p.id)}">${escapar(p.titulo || p.id)} (${p.estrutura.colunas.length} coluna(s))</option>`).join("")}</select></label>`
    : '<p class="apoio">Nenhuma outra planilha da Central tem colunas ainda.</p>';
  $("#copiar-ok", d).disabled = !lista.length;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = lista.find((x) => x.id === form.origem.value);
    if (!p) return;
    if (estado.docExiste) { erro.textContent = "Esta planilha já tem colunas."; return; }
    const est = normalizarEstrutura(p);
    if (!est || !est.colunas.length) { erro.textContent = "Essa planilha não tem uma estrutura válida."; return; }
    est.versao = 1;
    const desbloqueadas = ehAdmin() ? 0 : semColunasAdmin(est);
    const botao = $("#copiar-ok", d);
    botao.disabled = true;
    try {
      await salvarEstrutura(est);
      registrarAuditoria("criar", `Criou a planilha copiando as colunas de “${p.titulo || p.id}”`, `${est.colunas.length} coluna(s)`);
      d.close();
      mostrarAviso(`Planilha criada com as ${est.colunas.length} colunas de “${p.titulo || p.id}”.${desbloqueadas ? ` ${desbloqueadas} coluna(s) “Só administradoras” vieram liberadas: só a Lays ou a Paula podem bloqueá-las de novo.` : ""}`, 8000);
    } catch (err) { console.error(err); botao.disabled = false; erro.textContent = mensagemErro(err); }
  });
}
/* Tipo sugerido pelo conteúdo da coluna colada */
function sugerirTipo(valores) {
  const v = valores.map((x) => String(x == null ? "" : x).trim()).filter(Boolean);
  if (!v.length) return "texto";
  if (v.some((x) => x.length > 300 || /\n/.test(x))) return "textoLongo";
  if (v.every((x) => /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.test(x) || /^\d{4}-\d{2}-\d{2}$/.test(x))) return "data";
  /* Códigos (tickets, pedidos, CPF: só dígitos, 6 ou mais) ficam como texto, sem pontos de milhar nem perda de zeros */
  if (v.every((x) => (/^-?\d{1,5}$/.test(x) || /^-?\d{1,9}[.,]\d+$/.test(x)) && !/^0\d/.test(x))) return "numero";
  const distintos = new Set(v.map(nomeComparavel));
  if (v.length >= 5 && distintos.size <= 30 && distintos.size <= Math.max(2, v.length / 2) && [...distintos].every((x) => x.length <= 100)) return "lista";
  return "texto";
}
const MAX_LINHAS_COLAGEM = 2000;
function abrirCriarPorColagem() {
  const d = criarDialogo({
    titulo: `Criar ${tituloPlanilha()} colando do Excel`,
    largo: true,
    corpo: `<p class="lgpd">${escapar(AVISO_LGPD_COLUNAS)} Deixe essas colunas fora da colagem.</p>
      <div class="campos-linha">
        <label class="campo"><span class="rotulo">Cole aqui as células do Excel, com a linha de títulos</span><textarea name="colado" rows="6"></textarea></label>
        <div class="campo"><label class="campo"><span class="rotulo">Ou escolha um arquivo .csv</span><input type="file" name="arquivo" accept=".csv,text/csv,.txt"></label>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="comLinhas"> Importar também as outras linhas como registros</label></div>
      </div>
      <div id="criar-previa"></div>
      <p class="form-erro" role="alert" id="criar-erro"></p>
      <p class="apoio" role="status" id="criar-progresso"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn" id="criar-ok" disabled>Criar as colunas</button></div>`
  });
  const form = d.querySelector("form");
  let tabela = [], colunas = [];
  const desenhar = () => {
    const titulos = tabela[0] || [], linhas = tabela.slice(1);
    const comLinhas = form.comLinhas.checked;
    const vistos = new Set();
    colunas = titulos.map((t, i) => {
      const antiga = colunas[i];
      let nome = String(t || "").trim().slice(0, 60) || `Coluna ${i + 1}`;
      while (vistos.has(nomeComparavel(nome))) nome = `${nome} (${i + 1})`.slice(0, 60);
      vistos.add(nomeComparavel(nome));
      const valores = linhas.map((l) => l[i]);
      return { nome: antiga && antiga.editado ? antiga.nome : nome, editado: !!(antiga && antiga.editado), tipo: antiga && antiga.tipoEscolhido ? antiga.tipo : sugerirTipo(valores), tipoEscolhido: !!(antiga && antiga.tipoEscolhido), indice: i,
        distintos: new Set(valores.map((x) => String(x || "").trim()).filter(Boolean)).size, exemplo: String(valores.find((x) => String(x || "").trim()) || "").slice(0, 40) };
    });
    $("#criar-previa", d).innerHTML = titulos.length ? `<h3 style="font-size:15px">${colunas.length} coluna(s)${comLinhas ? ` e ${linhas.length} linha(s)` : ` · ${linhas.length} linha(s) de exemplo (não serão gravadas)`}</h3>
      <p class="apoio" style="font-size:13px">Confira o nome e o tipo de cada coluna. Lista: cada valor diferente vira uma opção.</p>
      <div class="tabela-admin"><table><thead><tr><th>Coluna</th><th>Tipo</th><th>Exemplo</th><th>Valores diferentes</th></tr></thead><tbody>${colunas.map((c, i) => `<tr>
        <td><input data-criar-nome="${i}" value="${escapar(c.nome)}" maxlength="60" aria-label="Nome da coluna ${i + 1}"></td>
        <td><select data-criar-tipo="${i}" aria-label="Tipo da coluna ${escapar(c.nome)}">${TIPOS.filter((t) => !TIPOS_SEM_EDICAO.includes(t.id) && t.id !== "etiquetas").map((t) => `<option value="${t.id}"${c.tipo === t.id ? " selected" : ""}>${escapar(t.nome)}</option>`).join("")}</select></td>
        <td>${escapar(c.exemplo)}</td><td>${c.distintos}</td></tr>`).join("")}</tbody></table></div>` : "";
    $("#criar-ok", d).disabled = !titulos.length;
    $("#criar-ok", d).textContent = comLinhas && linhas.length ? `Criar as colunas e ${linhas.length} linha(s)` : "Criar as colunas";
  };
  form.colado.addEventListener("input", () => { tabela = lerTabelaTexto(form.colado.value); colunas = []; desenhar(); });
  form.comLinhas.addEventListener("change", desenhar);
  form.arquivo.addEventListener("change", async () => {
    const f = form.arquivo.files[0];
    if (!f) return;
    if (f.size > 20_000_000) { $("#criar-erro", d).textContent = "Arquivo grande demais (máx. 20 MB)."; return; }
    let texto = await f.text();
    if (texto.includes("\ufffd")) { try { texto = new TextDecoder("windows-1252").decode(await f.arrayBuffer()); } catch (e) {} }
    tabela = lerTabelaTexto(texto);
    colunas = [];
    desenhar();
  });
  d.addEventListener("input", (e) => { const i = e.target.dataset.criarNome; if (i != null) { colunas[Number(i)].nome = e.target.value.trim().slice(0, 60); colunas[Number(i)].editado = true; } });
  d.addEventListener("change", (e) => { const i = e.target.dataset.criarTipo; if (i != null) { colunas[Number(i)].tipo = e.target.value; colunas[Number(i)].tipoEscolhido = true; } });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#criar-erro", d), progresso = $("#criar-progresso", d), botao = $("#criar-ok", d);
    if (estado.docExiste) { erro.textContent = "Esta planilha já tem colunas."; return; }
    if (colunas.some((c) => !c.nome)) { erro.textContent = "Dê um nome a todas as colunas."; return; }
    if (new Set(colunas.map((c) => nomeComparavel(c.nome))).size !== colunas.length) { erro.textContent = "Há colunas com o mesmo nome."; return; }
    if (colunas.length > 70) { erro.textContent = "Use no máximo 70 colunas."; return; }
    const linhas = tabela.slice(1);
    const comLinhas = form.comLinhas.checked;
    const est = estruturaVazia();
    const ids = [];
    est.colunas = colunas.map((c, ordem) => {
      const id = idUnico(c.nome, ids, true);
      ids.push(id);
      let tipo = c.tipo, opcoes = [];
      if (tipo === "lista") {
        const nomes = [], vistos = new Set();
        linhas.forEach((l) => { const v = String(l[c.indice] ?? "").trim().slice(0, 100); if (v && !vistos.has(nomeComparavel(v))) { vistos.add(nomeComparavel(v)); nomes.push(v); } });
        if (nomes.length > MAX_OPCOES) tipo = "texto";
        else { const usados = []; opcoes = nomes.map((nome) => { const oid = idUnico(nome, usados); usados.push(oid); return { id: oid, nome, cor: "" }; }); }
      }
      return { id, nome: c.nome, tipo, grupo: "geral", ordem: ordem + 1, largura: tipo === "textoLongo" ? 240 : 160, obrigatoria: false, unica: false, padrao: "", opcoes, ajuda: "", acesso: acessoDe({ tipo }), ativa: true };
    });
    const estrutura = normalizarEstrutura(est);
    /* Valores que não passam no tipo escolhido ficam como foram escritos (como na importação do Banco) */
    const agora = new Date().toISOString();
    const registros = comLinhas ? linhas.map((l) => {
      const campos = {};
      estrutura.colunas.forEach((col, i) => {
        const bruto = String(l[colunas[i].indice] ?? "").trim();
        if (!bruto) return;
        const r = validarValor(col, bruto);
        campos[col.id] = r.ok && !estaVazio(r.valor) ? r.valor : bruto;
      });
      return { id: estado.api.novoId(LINHAS), campos, criadoPor: autorAtual(), criadoPorNome: nomeAtual(), criadoEm: agora };
    }).filter((t) => Object.keys(t.campos).length) : [];
    const noArquivoCompactado = ehAdmin() && registros.length > LIMITE_VIVAS;
    if (registros.length > MAX_LINHAS_COLAGEM && !noArquivoCompactado) {
      erro.textContent = `Dá para importar até ${MAX_LINHAS_COLAGEM.toLocaleString("pt-BR")} linhas de uma vez${ehAdmin() ? "" : " sem login"}. Crie só as colunas agora e cole o resto em partes com “Colar do Excel”.`;
      return;
    }
    if (!(await exigirNome())) return;
    botao.disabled = true;
    erro.textContent = "";
    try {
      if (await estado.api.lerDoc(DOC)) { erro.textContent = "Esta planilha já tem colunas."; botao.disabled = false; return; }
      progresso.textContent = "Criando as colunas…";
      await salvarEstrutura(estrutura);
      if (registros.length) {
        progresso.textContent = `Gravando ${registros.length} linha(s)…`;
        if (noArquivoCompactado) {
          registros.forEach((t) => { t.criadoEm = agora; });
          await gravarArquivo(registros);
        } else {
          /* A estrutura acabou de ser gravada e ainda não chegou pelo ouvinte: o resumo usa a primeira coluna colada */
          const primeira = estrutura.colunas[0];
          await estado.api.lote(registros.flatMap((t) => [
            { op: "set", caminho: `${LINHAS}/${t.id}`, dados: { campos: t.campos, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura() } },
            opHistorico(t.id, "importar", { depois: textoDoValor(primeira, t.campos[primeira.id]) })
          ]));
        }
      }
      registrarAuditoria("criar", `Criou a planilha colando do Excel: ${estrutura.colunas.length} coluna(s)${registros.length ? `, ${registros.length} linha(s)` : ""}`);
      d.close();
      mostrarAviso(`Planilha criada: ${estrutura.colunas.length} coluna(s)${registros.length ? ` e ${registros.length} linha(s)` : ""}.`, 6000);
    } catch (err) { console.error(err); botao.disabled = false; progresso.textContent = ""; erro.textContent = mensagemErro(err); }
  });
  d.showModal();
  form.colado.focus();
}

/* ------------------------------------------------------------
 *  Sessão da Central: administradora logada assina com o e-mail; outra conta só lê;
 *  sem login, cada pessoa assina com o nome.
 * ------------------------------------------------------------ */
function aoMudarSessaoPlanilha(s) {
  const antes = JSON.stringify(estado.usuario);
  if (s.admin) estado.usuario = { admin: true, email: s.email, nome: s.admin.nome };
  else if (s.email) estado.usuario = { admin: false, semPermissao: true, email: s.email };
  else estado.usuario = { admin: false };
  if (antes === JSON.stringify(estado.usuario)) return;
  atualizarBotoes();
  renderizarSemEstrutura();
  if (estado.estrutura) agendarRender();
  if (aparencia) aparencia.aoMudarSessao();
}

/* ------------------------------------------------------------
 *  Conexão com o Firestore (mesmo app Firebase da Central, iniciado por comum/base.js)
 * ------------------------------------------------------------ */
const VERSAO_SDK = "10.12.2";
function converterValores(v) {
  if (v && typeof v === "object") {
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (Array.isArray(v)) return v.map(converterValores);
    const r = {};
    Object.keys(v).forEach((k) => { r[k] = converterValores(v[k]); });
    return r;
  }
  return v;
}
async function criarApi() {
  const base = await conectarNuvem();
  if (!base) return null;
  /* Toda escrita é assinada: sem o nome (ou com uma conta que não é de administradora), nada é gravado */
  const exigirAutor = async () => {
    if (contaSemPermissao()) { const e = new Error("conta sem permissão"); e.code = "permission-denied"; throw e; }
    if (!(await exigirNome())) { const e = new Error("sem nome"); e.code = "sem-nome"; throw e; }
  };
  if (window.__NUVEM_TESTE__) {
    return { ...base,
      salvarDoc: async (...a) => { await exigirAutor(); return base.salvarDoc(...a); },
      atualizarDoc: async (...a) => { await exigirAutor(); return base.atualizarDoc(...a); },
      lote: async (ops) => { if (ops.length) await exigirAutor(); return base.lote(ops); } };
  }
  const url = (m) => `https://www.gstatic.com/firebasejs/${VERSAO_SDK}/firebase-${m}.js`;
  const [{ getApps }, fs] = await Promise.all([import(url("app")), import(url("firestore"))]);
  const db = fs.getFirestore(getApps()[0]);
  const ref = (caminho) => fs.doc(db, ...caminho.split("/"));
  const col = (caminho) => fs.collection(db, ...caminho.split("/"));
  /* Marcas: "__AGORA__" (hora do servidor), "__APAGAR__", "__DATA__:<ISO>", "__AUTOR__"/"__AUTOR_NOME__" (quem assina) */
  const preparar = (dados) => {
    if (dados === "__AGORA__") return fs.serverTimestamp();
    if (dados === "__APAGAR__") return fs.deleteField();
    if (dados === "__AUTOR__") return autorAtual();
    if (dados === "__AUTOR_NOME__") return nomeAtual();
    if (typeof dados === "string" && dados.startsWith("__DATA__:")) {
      const d = new Date(dados.slice(9));
      return isNaN(d) ? null : fs.Timestamp.fromDate(d);
    }
    if (Array.isArray(dados)) return dados.map(preparar);
    if (dados && typeof dados === "object") {
      const r = {};
      Object.keys(dados).forEach((k) => { r[k] = preparar(dados[k]); });
      return r;
    }
    return dados;
  };
  const consulta = (caminho, { ordenar, desc = false, limite } = {}) => {
    const partes = [];
    if (ordenar) partes.push(fs.orderBy(ordenar, desc ? "desc" : "asc"));
    if (limite) partes.push(fs.limit(limite));
    return partes.length ? fs.query(col(caminho), ...partes) : col(caminho);
  };
  return {
    real: true,
    async lerDoc(caminho) {
      const s = await fs.getDoc(ref(caminho));
      return s.exists() ? converterValores(s.data()) : null;
    },
    async lerColecao(caminho, opcoes) {
      const s = await fs.getDocs(consulta(caminho, opcoes));
      return s.docs.map((d) => ({ id: d.id, ...converterValores(d.data()) }));
    },
    ouvirDoc(caminho, cb, aoErro) {
      return fs.onSnapshot(ref(caminho), (s) => cb(s.exists() ? converterValores(s.data({ serverTimestamps: "estimate" })) : null), aoErro || ((e) => console.warn(caminho, e)));
    },
    ouvirColecao(caminho, cb, aoErro, opcoes) {
      return fs.onSnapshot(consulta(caminho, opcoes), (s) => cb(s.docs.map((d) => ({ id: d.id, ...converterValores(d.data({ serverTimestamps: "estimate" })) }))), aoErro || ((e) => console.warn(caminho, e)));
    },
    novoId: (colecao) => fs.doc(col(colecao)).id,
    async salvarDoc(caminho, dados, mesclar = false) { await exigirAutor(); return fs.setDoc(ref(caminho), preparar(dados), mesclar ? { merge: true } : {}); },
    async atualizarDoc(caminho, dados) { await exigirAutor(); return fs.updateDoc(ref(caminho), preparar(dados)); },
    /* Até 400 escritas e ~6 MB por lote (o Firestore aceita 500 escritas e 10 MiB por pedido). Cada lote é atômico. */
    async lote(ops) {
      if (!ops.length) return;
      await exigirAutor();
      const codificador = new TextEncoder();
      let i = 0;
      while (i < ops.length) {
        const b = fs.writeBatch(db);
        let n = 0, tamanho = 0;
        while (i < ops.length && n < 400) {
          const o = ops[i];
          const t = o.op === "delete" ? 200 : codificador.encode(JSON.stringify(o.dados)).length + 200;
          if (n && tamanho + t > 6000000) break;
          if (o.op === "delete") b.delete(ref(o.caminho));
          else if (o.op === "update") b.update(ref(o.caminho), preparar(o.dados));
          else b.set(ref(o.caminho), preparar(o.dados), o.mesclar ? { merge: true } : {});
          n++; tamanho += t; i++;
        }
        await b.commit();
      }
    },
    /* Auditoria da Central: administradora com o e-mail; sem login, "visitante" com o nome informado */
    registrarAuditoria: (d) => fs.addDoc(col("auditoria"), {
      acao: String(d.acao).slice(0, 40), alvo: String(d.alvo).slice(0, 40), resumo: String(d.resumo || "").slice(0, 200), detalhes: String(d.detalhes || "").slice(0, 800),
      porEmail: ehAdmin() ? estado.usuario.email : "visitante",
      porNome: String((ehAdmin() ? estado.usuario.nome : nomeGuardado()) || "Visitante").slice(0, 80),
      criadoEm: fs.serverTimestamp()
    })
  };
}

/* ------------------------------------------------------------
 *  Bloco da Central que abre esta planilha (conteudo/site; se ainda não foi publicado,
 *  o rascunho deste navegador). false = nenhum bloco usa este identificador.
 * ------------------------------------------------------------ */
function blocoNoSite(dados) {
  let site;
  try { site = JSON.parse(dados); } catch (e) { return null; }
  const cats = site && Array.isArray(site.categorias) ? site.categorias : [];
  for (const c of cats) {
    const it = (c && Array.isArray(c.itens) ? c.itens : []).find((x) => x && typeof x === "object" && x.planilha === ID);
    if (it) return { nome: String(it.nome || ID).slice(0, 120), catId: String((c && c.id) || "") };
  }
  return false;
}
async function acharBloco(api) {
  let achado = null;
  try {
    const site = api ? await api.lerDoc("conteudo/site") : null;
    if (site && typeof site.dados === "string") achado = blocoNoSite(site.dados);
  } catch (e) { console.warn("Conteúdo da Central indisponível; usando o identificador como título.", e); }
  if (achado) return achado;
  let rascunho = null;
  try { rascunho = localStorage.getItem("suporte-n2-site-rascunho"); } catch (e) {}
  const doRascunho = rascunho ? blocoNoSite(rascunho) : null;
  if (doRascunho) return { ...doRascunho, rascunho: true };
  return achado;
}

/* ------------------------------------------------------------
 *  Dados em tempo real, cópia no navegador e sem conexão
 * ------------------------------------------------------------ */
const textoOuVazio = (v) => (typeof v === "string" ? v : "");
function normalizarTicket(d) {
  return {
    id: d.id, campos: d.campos && typeof d.campos === "object" ? d.campos : {},
    criadoPor: String(d.criadoPor || ""), criadoPorNome: textoOuVazio(d.criadoPorNome), criadoEm: d.criadoEm || "",
    atualizadoPor: String(d.atualizadoPor || ""), atualizadoPorNome: textoOuVazio(d.atualizadoPorNome), atualizadoEm: d.atualizadoEm || "",
    ...(d.parcial === true ? { parcial: true } : {}), ...(d.removida === true ? { removida: true } : {})
  };
}
let temporizadorCopia = 0;
function salvarCopia() {
  clearTimeout(temporizadorCopia);
  temporizadorCopia = setTimeout(() => {
    if (estado.carregouEstrutura && !estado.estrutura) { apagarLocal(CHAVE_COPIA); return; }
    if (!estado.estrutura || !estado.carregouTickets) return;
    /* O arquivo compactado não cabe no armazenamento do navegador: aí a cópia guarda só a estrutura */
    gravarLocal(CHAVE_COPIA, { salvaEm: new Date().toISOString(), estrutura: dadosEstruturaBackup(estado.estrutura), tickets: estado.arquivo.linhas.length ? null : estado.tickets });
  }, 1500);
}
function aplicarEstrutura(e) {
  estado.estrutura = e;
  recalcularColunas();
  cacheBusca = new WeakMap();
  if (e) { if (!estado.vista) carregarVista(); else ajustarVista(); }
  if (aparencia) aparencia.aoMudarEstrutura();
}
function abrirPlanilha() {
  const api = estado.api;
  /* Padrão de aparência da planilha (campo "aparencia" de planilhas/{id}): ouvido com a conexão pronta */
  if (aparencia) aparencia.religarPadrao();
  const copia = lerLocal(CHAVE_COPIA, null);
  if (copia && copia.estrutura && Array.isArray(copia.tickets)) {
    const e = normalizarEstrutura(copia.estrutura);
    if (e && e.colunas.length) {
      aplicarEstrutura(e);
      estado.tickets = copia.tickets.map(normalizarTicket);
      estado.usandoCopia = true;
    }
  }
  atualizarBotoes();
  if (estado.estrutura) renderizarTudo();
  if (!api) { estado.offline = true; atualizarBotoes(); return; }
  const aoErro = (onde) => (e) => { console.warn(onde, e); estado.offline = true; atualizarBotoes(); agendarRender(); };
  const ouvir = (f) => estado.ouvintesPlanilha.push(f);
  ouvir(api.ouvirDoc(DOC, (d) => {
    estado.docExiste = !!d;
    const e = d ? normalizarEstrutura(d) : null;
    aplicarEstrutura(e && e.colunas.length ? e : null);
    estado.carregouEstrutura = true;
    renderizarSemEstrutura();
    atualizarBotoes();
    salvarCopia();
    agendarRender();
  }, aoErro("estrutura")));
  /* A planilha só aparece depois que as linhas vivas e o arquivo compactado chegaram */
  const aoChegarTickets = () => {
    if (!estado.carregouVivos || !estado.carregouArquivo) return;
    combinarTickets();
    estado.carregouTickets = true;
    estado.usandoCopia = false;
    estado.offline = !navigator.onLine;
    atualizarBotoes();
    salvarCopia();
    agendarRender();
    if (aparencia) aparencia.aoMudarDados();
    verificarNomesPerdidos();
    if (estado.aoMudarLixeira) estado.aoMudarLixeira();
    const fid = ficha.dataset.id;
    if (!ficha.hidden && fid) {
      if (!porId(fid)) fecharFicha();
      else if (!ficha.dataset.editando && ficha.classList.contains("aberta") && !ficha.contains(document.activeElement)) abrirFicha(fid);
    }
  };
  ouvir(api.ouvirColecao(LINHAS, (lista) => {
    const anteriores = estado.carregouVivos ? new Map(estado.vivos.map((t) => [t.id, JSON.stringify([t.campos, t.removida])])) : null;
    const novos = lista.map(normalizarTicket);
    if (anteriores) {
      const mudaram = novos.filter((t) => !t.removida && anteriores.get(t.id) !== JSON.stringify([t.campos, t.removida]));
      if (mudaram.length && mudaram.length <= 50) {
        const ate = Date.now() + 3500;
        mudaram.forEach((t) => { if (!estado.piscar.has(t.id)) estado.piscar.set(t.id, ate); });
        setTimeout(agendarRender, 3700);
      }
    }
    estado.vivos = novos;
    estado.carregouVivos = true;
    aoChegarTickets();
  }, aoErro("linhas")));
  ouvir(api.ouvirColecao(ARQUIVO, (lista) => {
    aplicarArquivo(lista);
    estado.carregouArquivo = true;
    aoChegarTickets();
  }, aoErro("arquivo")));
  ouvir(api.ouvirColecao(LIXEIRA, (lista) => {
    estado.lixeira = lista;
    if (estado.aoMudarLixeira) estado.aoMudarLixeira();
  }, (e) => console.warn("lixeira", e)));
}
window.addEventListener("offline", () => { estado.offline = true; atualizarBotoes(); agendarRender(); });
window.addEventListener("online", () => { estado.offline = !estado.api; atualizarBotoes(); agendarRender(); });

/* ------------------------------------------------------------
 *  Início
 * ------------------------------------------------------------ */
ligarTema();
/* Aparência livre: pessoal (este navegador, por planilha) e padrão da planilha (campo "aparencia" em
   planilhas/{id} + planilhas/{id}/config/aparencia-imagem; só administradoras gravam) */
if (ID_OK) aparencia = criarAparencia({
  prefixo: "suporte-n2-planilha",
  planilha: () => ({ id: ID, nome: tituloPlanilha() }),
  ehAdmin,
  colunas: () => (estado.estrutura ? colunasAtivas() : []),
  valor: (t, col) => valorBruto(t, col),
  texto: (t, col) => valorTexto(t, col),
  opcoes: (col) => opcoesDe(col),
  registros: () => estado.tickets,
  repintar: () => { if (estado.estrutura && estado.vista && !$("#app").hidden) pintarLinhas(true); },
  remedir: agendarAjuste,
  aviso: mostrarAviso,
  confirmar,
  ancora: $(".topo-acoes [data-tema-botao]"),
  padrao: {
    ouvir: (cb) => (estado.api ? estado.api.ouvirDoc(DOC, (d) => cb(d && d.aparencia ? d.aparencia : null), (e) => console.warn("aparência", e)) : null),
    lerImagem: async () => { const d = estado.api ? await estado.api.lerDoc(`${DOC}/config/aparencia-imagem`) : null; return d && d.imagem; },
    /* imagem: texto = grava a imagem; null = apaga; undefined = não mexe */
    gravar: async (dados, imagem) => {
      if (!estado.docExiste) throw new Error("A planilha ainda não tem colunas.");
      const por = estado.usuario.email;
      const ops = [{ op: "update", caminho: DOC, dados: { aparencia: { tema: dados.tema, regras: dados.regras, permitirPessoal: dados.permitirPessoal, atualizadoEm: "__AGORA__", atualizadoPor: por }, atualizadoEm: "__AGORA__", atualizadoPor: por } }];
      if (imagem === null) ops.push({ op: "delete", caminho: `${DOC}/config/aparencia-imagem` });
      else if (typeof imagem === "string") ops.push({ op: "set", caminho: `${DOC}/config/aparencia-imagem`, dados: { imagem, atualizadoEm: "__AGORA__", atualizadoPor: por } });
      await estado.api.lote(ops);
      registrarAuditoria("estrutura", `Padrão de aparência da planilha${dados.permitirPessoal ? "" : " (aparência pessoal desligada)"}`);
    },
    remover: async () => {
      const por = estado.usuario.email;
      await estado.api.lote([{ op: "update", caminho: DOC, dados: { aparencia: "__APAGAR__", atualizadoEm: "__AGORA__", atualizadoPor: por } }, { op: "delete", caminho: `${DOC}/config/aparencia-imagem` }]);
      registrarAuditoria("estrutura", "Padrão de aparência da planilha removido");
    }
  }
});
(async () => {
  if (!ID_OK) { mostrarNaoEncontrada("O endereço precisa trazer o identificador da planilha (planilha.html?p=…), com letras minúsculas, números e hífens."); return; }
  aoMudarSessao(aoMudarSessaoPlanilha);
  ligarLogin($("#btn-login")).catch((e) => console.warn("Login:", e));
  let api = null;
  try {
    const limite = new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("tempo esgotado")), 15000));
    api = await Promise.race([criarApi(), limite]);
  } catch (e) { console.warn("Firebase indisponível:", e); }
  estado.api = api;
  const bloco = await acharBloco(api);
  if (bloco === false) { mostrarNaoEncontrada(); return; }
  if (!api && !lerLocal(CHAVE_COPIA, null)) {
    mostrarNaoEncontrada("Não foi possível carregar a planilha agora. Verifique a internet e recarregue a página.", "Planilha indisponível");
    return;
  }
  estado.bloco = bloco;
  marcarTitulo();
  mostrarTela("app");
  abrirPlanilha();
})();
window.__planilha = { estado, get aparencia() { return aparencia; } };
