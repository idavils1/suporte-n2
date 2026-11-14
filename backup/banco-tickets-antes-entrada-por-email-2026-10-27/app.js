/*
 * ============================================================
 *  BANCO DE TICKETS · Suporte V/Cert
 *  Planilha online compartilhada com outra equipe. Site à parte:
 *  não tem nenhum caminho para outros sites e não lê dados deles.
 *
 *  Papéis: administradora (tudo, inclusive estrutura), equipe
 *  (vê, pesquisa e alimenta), leitura (só vê e pesquisa).
 *  As mesmas permissões estão no firestore.rules (vale o que está lá).
 *
 *  Duas planilhas com o mesmo motor (PLANILHAS): cada uma usa as coleções do seu prefixo
 *  ("tickets" = BANCO DE TICKETS; "sig" = SIG - INFORMAÇÕES). A identificação
 *  (tickets-pessoas) e as regras de registro (tickets-config) valem para as duas.
 *
 *  Firestore (prefixo "tickets"; o SIG usa "sig", "sig-config", "sig-arquivo"…):
 *   tickets-config/estrutura   colunas (acesso: bloqueado | livre | lista), categorias, grupos, regras,
 *                              listasEquipe { idColuna: [ids das opções ativas] } e modelo (v2 do Banco)
 *   tickets/{id}               { campos: {colunaId: valor}, numero, criadoPor (uid ou e-mail da administradora),
 *                                criadoPorNome, criadoPorEmail, criadoEm, atualizadoPor, atualizadoPorNome,
 *                                atualizadoPorEmail, atualizadoEm, exclusao }
 *   tickets/{id}/historico/{e} quem (por, porNome, porEmail), quando, coluna, antes, depois
 *   tickets-arquivo/{parte}    registros compactados (muitos por documento): { versao, indice, total, json }.
 *                              O plano gratuito do Firebase lê ~50 mil documentos por dia; com dezenas de milhares
 *                              de linhas, cada abertura do site leria todas. Um registro em tickets/{id} com o
 *                              mesmo id substitui a linha do arquivo; com "parcial: true" ele só traz os campos
 *                              alterados, por cima da linha (assim a equipe não regrava colunas bloqueadas).
 *   tickets-numeros/{numero}   índice do "Nº do ticket" (único)
 *   tickets-pessoas/{uid}      identificação declarada pela pessoa em "Se registre como:"
 *   tickets-lixeira, tickets-backups, tickets-auditoria (só administradoras)
 * ============================================================
 */
import { injetarIcones } from "./icones.js";
import { conectar, ehEmailAdmin, ADMINS, LOGIN_MICROSOFT } from "./firebase.js";
injetarIcones();

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
const CHAVE_TEMA = "banco-tickets-tema";
const CHAVE_ATIVIDADE = "banco-tickets-ultima-atividade";
const CHAVE_COPIA = "banco-tickets-copia";
const CHAVE_PLANILHA = "banco-tickets-planilha-ativa";
const PLANILHAS = [
  { id: "banco-tickets", nome: "BANCO DE TICKETS", prefixo: "tickets" },
  { id: "sig-informacoes", nome: "SIG - INFORMAÇÕES", prefixo: "sig" }
];
const planilhaAtual = () => PLANILHAS.find((p) => p.id === estado.planilha) || PLANILHAS[0];
/* Prefixo das coleções da planilha aberta ("tickets" no Banco de Tickets, "sig" no SIG) */
const P = () => planilhaAtual().prefixo;
const ehBanco = () => planilhaAtual().id === PLANILHAS[0].id;
const chaveCopia = () => (ehBanco() ? CHAVE_COPIA : `${CHAVE_COPIA}:${planilhaAtual().id}`);
/* Visões, filtros e rascunho: por pessoa e por planilha */
const chaveUsuario = (nome) => `banco-tickets-${nome}:${planilhaAtual().id}:${(estado.usuario && estado.usuario.id) || "anonimo"}`;
const chaveUsuarioAntiga = (nome) => `banco-tickets-${nome}:${(estado.usuario && estado.usuario.id) || "anonimo"}`;
const CHAVE_IDENTIDADE = "banco-tickets-identidade";
const LIMITE_INATIVIDADE_MS = 12 * 60 * 60 * 1000;

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
function confirmar(texto, { titulo = "Confirmar", botao = "Confirmar", perigo = false, html = "" } = {}) {
  return new Promise((resolver) => {
    const d = criarDialogo({
      titulo,
      corpo: `<p class="apoio">${escapar(texto)}</p>${html}
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
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
 *  Estrutura (colunas, categorias, grupos e regras)
 *  O id da coluna e da categoria nunca muda: renomear muda só o rótulo.
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
const MAX_OPCOES = 400;
const EQUIPE_EDITA = [
  { id: "proprias", nome: "Só as linhas que a própria pessoa registrou" },
  { id: "todas", nome: "Qualquer linha" },
  { id: "nenhuma", nome: "Nenhuma (a equipe só adiciona)" }
];
/* Quem altera cada coluna. "lista": a equipe só escolhe uma opção existente. */
const ACESSOS = [
  { id: "bloqueado", nome: "BLOQUEADO (só administradoras)" },
  { id: "livre", nome: "LIVRE (toda a equipe)" },
  { id: "lista", nome: "LISTA (a equipe escolhe uma opção)" }
];
const TEXTO_BLOQUEADO = "Só as administradoras alteram este campo";
function acessoDe(c) {
  if (c.tipo && TIPOS_SEM_EDICAO.includes(c.tipo)) return "livre";
  const lista = TIPOS_LISTA.includes(c.tipo);
  if (c.acesso === "bloqueado" || (!c.acesso && c.somenteAdmin)) return "bloqueado";
  if (c.acesso === "livre" && !lista) return "livre";
  return lista ? "lista" : "livre";
}

function estruturaInicial() {
  const op = (nome, cor = "", extra = {}) => ({ id: slug(nome, 40), nome, cor, ...extra });
  const col = (id, nome, tipo, grupo, extra = {}) => ({ id, nome, tipo, grupo, largura: 150, obrigatoria: false, unica: false, padrao: "", opcoes: [], ajuda: "", somenteAdmin: false, ativa: true, ...extra });
  const colunas = [
    col("numero", "Nº do ticket", "texto", "identificacao", { obrigatoria: true, unica: true, largura: 140, ajuda: "Número do chamado no sistema de origem (ex.: GLPI 123456)." }),
    col("abertura", "Data de abertura", "data", "identificacao", { padrao: "hoje", largura: 130 }),
    col("origem", "Origem", "lista", "identificacao", { opcoes: ["GLPI", "Plusoft OMNI", "CALLBOX", "E-mail", "Teams", "Telefone", "Outro"].map((n) => op(n)) }),
    col("categoria", "Categoria", "lista", "identificacao", { origem: "categorias", largura: 170 }),
    col("cliente", "Cliente / parceiro", "texto", "cliente", { largura: 190, ajuda: "Nome do cliente ou parceiro. Não informe CPF/CNPJ completo." }),
    col("produto", "Produto", "lista", "cliente", { opcoes: ["e-CPF A1", "e-CPF A3", "e-CNPJ A1", "e-CNPJ A3", "VIDaaS", "SSL", "Outro"].map((n) => op(n)) }),
    col("resumo", "Resumo", "texto", "problema", { obrigatoria: true, largura: 260 }),
    col("descricao", "Descrição", "textoLongo", "problema", { largura: 240 }),
    col("prioridade", "Prioridade", "prioridade", "problema", { largura: 120, padrao: "media",
      opcoes: [op("Baixa", "cinza"), op("Média", "azul"), op("Alta", "laranja"), op("Crítica", "vermelho")] }),
    col("status", "Status", "status", "problema", { largura: 160, padrao: "aberto",
      opcoes: [op("Aberto", "azul"), op("Em andamento", "roxo"), op("Aguardando cliente", "amarelo"), op("Escalado N3", "laranja"), op("Resolvido", "verde", { final: true }), op("Cancelado", "cinza", { final: true })] }),
    col("responsavel", "Responsável", "pessoa", "tratativa", { largura: 170 }),
    col("escalado", "Escalado para", "lista", "tratativa", { padrao: "nao-escalado", opcoes: ["Não escalado", "N3", "Desenvolvimento", "Fornecedor", "Comercial"].map((n) => op(n)) }),
    col("prazo", "Prazo", "dataHora", "tratativa", { largura: 160 }),
    col("resolucao", "Data de resolução", "data", "tratativa", { largura: 140 }),
    col("diasAberto", "Dias em aberto", "derivado", "tratativa", { formula: "diasEmAberto", de: "abertura", ate: "resolucao", largura: 120 }),
    col("solucao", "Solução aplicada", "textoLongo", "tratativa", { largura: 240 }),
    col("linkTicket", "Link do ticket", "link", "tratativa", { largura: 120 }),
    col("registradoPor", "Registrado por", "automatico", "controle", { auto: "criadoPor", largura: 190 }),
    col("registradoEm", "Registrado em", "automatico", "controle", { auto: "criadoEm", largura: 150 }),
    col("atualizadoPor", "Atualizado por", "automatico", "controle", { auto: "atualizadoPor", largura: 190 }),
    col("atualizadoEm", "Atualizado em", "automatico", "controle", { auto: "atualizadoEm", largura: 150 })
  ].map((c, i) => ({ ...c, ordem: i + 1 }));
  return {
    titulo: "Banco de Tickets",
    versao: 1,
    categorias: [["Certificado digital", "azul"], ["VIDaaS", "roxo"], ["SSL", "verde"], ["Sistemas internos", "laranja"], ["Outros", "cinza"]]
      .map(([nome, cor], i) => ({ id: slug(nome, 40), nome, cor, icone: "", ordem: i + 1, ativa: true })),
    colunas,
    gruposColunas: [["identificacao", "Identificação"], ["cliente", "Cliente"], ["problema", "Problema"], ["tratativa", "Tratativa"], ["controle", "Controle (automático)"]]
      .map(([id, nome], i) => ({ id, nome, ordem: i + 1 })),
    regras: { equipeEdita: "proprias", janelaEdicaoHoras: 0, exportacao: true, registro: { ...REGISTRO_PADRAO } }
  };
}
/* Quem pode se registrar em "Se registre como:" (igual ao padrão do firestore.rules) */
/* aprovacao: quem se registra fica "aguardando liberação" até uma administradora liberar */
const REGISTRO_PADRAO = { aberto: true, dominios: [], papelPadrao: "equipe", aprovacao: true };
const RE_DOMINIO = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
function normalizarRegistro(g) {
  g = g && typeof g === "object" ? g : {};
  return {
    aberto: g.aberto !== false,
    dominios: [...new Set((Array.isArray(g.dominios) ? g.dominios : []).map((x) => String(x).trim().toLowerCase().replace(/^@/, "")).filter((x) => RE_DOMINIO.test(x) && x.length <= 80))].slice(0, 20),
    papelPadrao: g.papelPadrao === "leitura" ? "leitura" : "equipe",
    aprovacao: g.aprovacao !== false
  };
}

const txt = (v, max) => String(v == null ? "" : v).slice(0, max);
function normalizarOpcao(o) {
  if (!o || !RE_OPCAO.test(o.id || "")) return null;
  return { id: o.id, nome: txt(o.nome, 100) || o.id, cor: CORES.includes(o.cor) ? o.cor : "", ...(o.final ? { final: true } : {}), ...(o.ativa === false ? { ativa: false } : {}) };
}
/* Planilha reorganizada (v2 do Banco de Tickets): ids finais das colunas usadas no resumo, nas abas e nas regras */
const PAPEIS_MODELO = ["ticket", "dataConcessao", "responsavel", "motivo", "area", "arSolicitante"];
function normalizarModelo(m) {
  if (!m || typeof m !== "object" || !Number(m.versao)) return null;
  const colunas = {};
  PAPEIS_MODELO.forEach((k) => { const v = (m.colunas || {})[k]; if (typeof v === "string" && RE_ID.test(v)) colunas[k] = v; });
  return { versao: Math.floor(Number(m.versao)), colunas };
}
function normalizarEstrutura(d) {
  if (!d || typeof d !== "object") return null;
  const grupos = (Array.isArray(d.gruposColunas) ? d.gruposColunas : []).filter((g) => g && RE_OPCAO.test(g.id || ""))
    .map((g, i) => ({ id: g.id, nome: txt(g.nome, 60) || g.id, ordem: Number(g.ordem) || i + 1 }));
  if (!grupos.length) grupos.push({ id: "geral", nome: "Geral", ordem: 1 });
  const colunas = (Array.isArray(d.colunas) ? d.colunas : []).filter((c) => c && RE_ID.test(c.id || "") && NOME_TIPO[c.tipo]).map((c, i) => ({
    id: c.id, nome: txt(c.nome, 60) || c.id, tipo: c.tipo,
    grupo: grupos.some((g) => g.id === c.grupo) ? c.grupo : grupos[0].id,
    ordem: Number(c.ordem) || i + 1, largura: Math.max(60, Math.min(600, Number(c.largura) || 150)),
    obrigatoria: !!c.obrigatoria, unica: !!c.unica, padrao: txt(c.padrao, 60),
    opcoes: (Array.isArray(c.opcoes) ? c.opcoes : []).map(normalizarOpcao).filter(Boolean).slice(0, MAX_OPCOES),
    ajuda: txt(c.ajuda, 200), acesso: acessoDe(c), somenteAdmin: acessoDe(c) === "bloqueado", ativa: c.ativa !== false,
    ...(c.origem === "categorias" ? { origem: "categorias" } : {}),
    ...(c.tipo === "automatico" ? { auto: AUTOS[c.auto] ? c.auto : "criadoEm" } : {}),
    ...(c.tipo === "derivado" ? { formula: FORMULAS[c.formula] ? c.formula : "diasEmAberto", de: txt(c.de, 40), ate: txt(c.ate, 40) } : {})
  }));
  const categorias = (Array.isArray(d.categorias) ? d.categorias : []).filter((c) => c && RE_OPCAO.test(c.id || ""))
    .map((c, i) => ({ id: c.id, nome: txt(c.nome, 60) || c.id, cor: CORES.includes(c.cor) ? c.cor : "", icone: txt(c.icone, 30), ordem: Number(c.ordem) || i + 1, ativa: c.ativa !== false }));
  const r = d.regras || {};
  return {
    titulo: txt(d.titulo, 80) || "Banco de Tickets",
    versao: Number(d.versao) || 1,
    categorias, colunas, gruposColunas: grupos,
    regras: {
      equipeEdita: EQUIPE_EDITA.some((x) => x.id === r.equipeEdita) ? r.equipeEdita : "proprias",
      janelaEdicaoHoras: Math.max(0, Math.min(8760, Math.floor(Number(r.janelaEdicaoHoras) || 0))),
      exportacao: r.exportacao !== false,
      registro: normalizarRegistro(r.registro)
    },
    ...(normalizarModelo(d.modelo) ? { modelo: normalizarModelo(d.modelo) } : {}),
    atualizadoEm: d.atualizadoEm || "", atualizadoPor: txt(d.atualizadoPor, 120)
  };
}
/* Lista que as regras do Firestore usam para saber o que a equipe pode preencher */
const colunasDaEquipe = (e) => e.colunas.filter((c) => c.ativa && !c.somenteAdmin && !TIPOS_SEM_EDICAO.includes(c.tipo)).map((c) => c.id);
/* Opções que a equipe pode gravar em cada coluna LISTA (as regras validam por este mapa) */
const listasDaEquipe = (e) => Object.fromEntries(e.colunas.filter((c) => c.ativa && c.acesso === "lista" && !c.origem)
  .map((c) => [c.id, c.opcoes.filter((o) => o.ativa !== false).map((o) => o.id)]));
function dadosEstrutura(e) {
  const { atualizadoEm, atualizadoPor, ...resto } = e;
  return { ...resto, colunasEquipe: colunasDaEquipe(e), listasEquipe: listasDaEquipe(e), atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email };
}

/* ------------------------------------------------------------
 *  Estado
 * ------------------------------------------------------------ */
/* docs: todos os documentos de tickets-arquivo (de qualquer versão); partes: os da versão em uso */
function arquivoVazio() { return { versao: 0, docs: [], partes: [], linhas: [], parteDe: new Map() }; }
const estado = {
  api: null,
  planilha: PLANILHAS[0].id,  // planilha aberta (PLANILHAS)
  ouvintesPlanilha: [],       // onSnapshot só da planilha aberta (desligados ao trocar de aba)
  usuario: null,              // { id (uid ou e-mail da administradora), uid, email, nome, papel: "admin" | "equipe" | "leitura" }
  registrando: false,         // durante o "Confirmar" (login anônimo + perfil)
  estrutura: null,
  carregouEstrutura: false,
  tickets: [],                // arquivo + registros vivos (o vivo substitui a linha do arquivo de mesmo id)
  carregouTickets: false,
  vivos: [],                  // tickets/{id}
  carregouVivos: false,
  arquivo: arquivoVazio(),    // tickets-arquivo
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
  cartoesLimite: 60,
  desfazer: [],
  piscar: new Map(),
  selecionando: false,
  selecionados: new Set(),
  lixeira: [],
  pessoas: [],
  pararOuvintes: [],
  mensagemBloqueio: null
};
const papel = () => (estado.usuario ? estado.usuario.papel : "");
const ehAdmin = () => papel() === "admin";
const conectado = () => !!estado.api && !estado.offline;
const podeAlimentar = () => conectado() && !!estado.estrutura && (ehAdmin() || papel() === "equipe");
const porId = (id) => estado.tickets.find((t) => t.id === id);
const mapaTickets = () => new Map(estado.tickets.map((t) => [t.id, t]));
/* Índice do "Nº do ticket" (refeito quando a lista de tickets muda) */
let indiceNumeros = null, indiceNumerosDe = null;
function ticketsComNumero(chave) {
  if (indiceNumerosDe !== estado.tickets) {
    indiceNumeros = new Map();
    const id = idChave();
    estado.tickets.forEach((t) => {
      const n = (t.campos || {})[id];
      const k = estaVazio(n) ? t.numero : chaveNumero(n);
      if (!k) return;
      if (!indiceNumeros.has(k)) indiceNumeros.set(k, []);
      indiceNumeros.get(k).push(t);
    });
    indiceNumerosDe = estado.tickets;
  }
  return indiceNumeros.get(chave) || [];
}

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
const colCategoria = () => colunasAtivas().find((c) => c.origem === "categorias");
const modelo = () => (estado.estrutura && estado.estrutura.modelo) || null;
/* Coluna de um papel do modelo v2 (ex.: "area"), se estiver ativa */
const colModelo = (papelCol) => { const m = modelo(); const id = m && m.colunas[papelCol]; return id && COL[id] && COL[id].ativa ? COL[id] : null; };
/* Coluna-chave (valor único, indexado em <prefixo>-numeros): TICKET CONCEDIDO no modelo v2; "numero" antes dele */
const colNumero = () => colModelo("ticket") || (COL.numero && COL.numero.ativa ? COL.numero : null);
const idChave = () => (colNumero() || { id: "numero" }).id;
function opcoesDe(col) {
  if (!col) return [];
  if (col.origem === "categorias") return [...estado.estrutura.categorias].sort((a, b) => a.ordem - b.ordem).map((c) => ({ id: c.id, nome: c.nome, cor: c.cor, ativa: c.ativa }));
  return col.opcoes;
}
const cacheOpcoes = new WeakMap();
function opcao(col, id) {
  if (col.origem === "categorias") return opcoesDe(col).find((o) => o.id === id);
  let m = cacheOpcoes.get(col.opcoes);
  if (!m || m.size !== col.opcoes.length) { m = new Map(col.opcoes.map((o) => [o.id, o])); cacheOpcoes.set(col.opcoes, m); }
  return m.get(id);
}
const nomeGrupo = (id) => ((estado.estrutura && estado.estrutura.gruposColunas.find((g) => g.id === id)) || {}).nome || "";

/* ------------------------------------------------------------
 *  Valores das células
 * ------------------------------------------------------------ */
/* id = uid (equipe) ou e-mail (administradora; também os registros antigos) */
const nomePessoa = (id) => {
  const a = ADMINS.find((x) => x.email === id);
  if (a) return a.nome;
  if (estado.usuario && id === estado.usuario.id) return estado.usuario.nome || id;
  const p = estado.pessoas.find((x) => x.id === id);
  return (p && p.nome) || id || "";
};
/* Autoria gravada no registro (cópia do nome e do e-mail no momento da gravação).
   Registros antigos só têm o e-mail em criadoPor/atualizadoPor. */
const nomeAutor = (t, campo) => (t && (t[campo + "Nome"] || nomePessoa(t[campo]))) || "";
function emailAutor(t, campo) {
  if (!t) return "";
  if (t[campo + "Email"]) return t[campo + "Email"];
  const v = String(t[campo] || "");
  if (v.includes("@")) return v;
  const p = estado.pessoas.find((x) => x.id === v);
  return p ? p.email : estado.usuario && v === estado.usuario.id ? estado.usuario.email : "";
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
function htmlValor(t, col) {
  const v = valorBruto(t, col);
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
  switch (col.tipo) {
    case "lista": case "status": case "prioridade": {
      const o = opcao(col, v);
      if (!o || o.ativa === false) return `<span class="t">${escapar(o ? o.nome : v)}</span><span class="selo-fora" title="Valor antigo que não está nas opções atuais">fora da lista</span>`;
      return o.cor || col.tipo !== "lista" || col.origem ? etiquetaOpcao(o) : `<span class="t">${escapar(o.nome)}</span>`;
    }
    case "etiquetas": return (Array.isArray(v) ? v : []).map((x) => etiquetaOpcao(opcao(col, x), (opcao(col, x) || { nome: x }).nome)).join(" ");
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
/* Valor de lista que não é uma opção ativa (dado antigo) */
function foraDaLista(col, v) {
  if (!col || !TIPOS_LISTA.includes(col.tipo) || col.tipo === "etiquetas" || col.origem || estaVazio(v)) return false;
  const o = opcao(col, v);
  return !o || o.ativa === false;
}

/* Validação: devolve { ok, valor } ou { ok: false, erro }. Vazio é válido (obrigatoriedade é conferida à parte). */
function chaveNumero(v) {
  return normalizar(v).toUpperCase().replace(/[^A-Z0-9._-]+/g, "-").replace(/^[-._]+|-+$/g, "").slice(0, 80);
}
function validarValor(col, bruto) {
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
      const o = opcaoPeloTexto(col, v);
      if (o) return { ok: true, valor: o.id };
      const s = sugerirOpcao(col, v);
      return { ok: false, erro: `“${v}” não está na lista de ${col.nome}.${s ? ` Você quis dizer “${s.nome}”?` : ""}`, sugestao: s };
    }
    case "etiquetas": {
      const itens = (Array.isArray(bruto) ? bruto : String(bruto || "").split(/[,;|]/)).map((x) => String(x).trim()).filter(Boolean);
      const ids = [], faltam = [];
      itens.forEach((x) => { const o = opcoesDe(col).find((y) => y.id === x || normalizar(y.nome) === normalizar(x)); if (o) ids.push(o.id); else faltam.push(x); });
      if (faltam.length) return { ok: false, erro: `Fora da lista de ${col.nome}: ${faltam.join(", ")}.` };
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
 *  Permissões (as mesmas do firestore.rules)
 * ------------------------------------------------------------ */
function dentroDaJanela(t) {
  const h = estado.estrutura ? estado.estrutura.regras.janelaEdicaoHoras : 0;
  if (!h) return true;
  const criado = Date.parse(t.criadoEm);
  return !isNaN(criado) && Date.now() - criado < h * 3600000;
}
function podeEditarLinha(t) {
  if (!conectado() || !estado.estrutura || !t) return false;
  if (ehAdmin()) return true;
  if (papel() !== "equipe") return false;
  const regra = estado.estrutura.regras.equipeEdita;
  if (regra === "todas") return true;
  if (regra === "proprias") return t.criadoPor === estado.usuario.id && dentroDaJanela(t);
  return false;
}
const podeEditarColuna = (col) => !!col && !TIPOS_SEM_EDICAO.includes(col.tipo) && (ehAdmin() || !col.somenteAdmin);
const podeEditarCelula = (t, col) => podeEditarLinha(t) && podeEditarColuna(col);
const podePedirExclusao = (t) => conectado() && papel() === "equipe" && !!t && !t.exclusao && !t.arquivo;
function motivoSemEdicao(t, col) {
  if (!conectado()) return "Sem conexão: a edição está bloqueada.";
  if (col && TIPOS_SEM_EDICAO.includes(col.tipo)) return `“${col.nome}” é preenchido automaticamente.`;
  if (col && col.somenteAdmin && !ehAdmin()) return `${TEXTO_BLOQUEADO}: “${col.nome}”.`;
  if (papel() === "leitura") return "Seu acesso é só de leitura.";
  const regra = estado.estrutura && estado.estrutura.regras.equipeEdita;
  if (regra === "nenhuma") return "A equipe só adiciona registros; para corrigir, fale com a Lays ou a Paula.";
  if (regra === "proprias" && t && t.criadoPor !== estado.usuario.id) return "Você só pode editar as linhas que registrou neste navegador.";
  if (regra === "proprias" && t && !dentroDaJanela(t)) return "O prazo para editar esta linha já passou.";
  return "Você não pode editar esta célula.";
}

/* ------------------------------------------------------------
 *  Visão de cada pessoa (colunas, larguras, filtros): só neste navegador
 * ------------------------------------------------------------ */
const versaoModelo = () => (modelo() ? modelo().versao : 0);
const VISTA_PADRAO = () => ({ colunas: colunasAtivas().map((c) => c.id), ocultas: [], larguras: {}, ordenar: { col: "", dir: 1 }, filtros: {}, agrupar: "", compacta: false, cartoes: null, aba: "todos", especial: "", modelo: versaoModelo() });
function carregarVista() {
  const salva = lerLocal(chaveUsuario("vista"), null);
  estado.vista = { ...VISTA_PADRAO(), ...(salva && typeof salva === "object" ? salva : {}) };
  ajustarVista();
}
/* Colunas novas criadas pelas administradoras aparecem para todos; as que a pessoa ocultou continuam ocultas */
function ajustarVista() {
  const v = estado.vista;
  const ativas = colunasAtivas().map((c) => c.id);
  /* Planilha reorganizada (ex.: v2): ordem, larguras e colunas ocultas voltam ao padrão para todos */
  if ((v.modelo || 0) !== versaoModelo()) Object.assign(v, { colunas: ativas.slice(), ocultas: [], larguras: {}, ordenar: { col: "", dir: 1 }, filtros: {}, agrupar: "", especial: "", aba: "todos", modelo: versaoModelo() });
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
    s = normalizar([t.numero, emailAutor(t, "criadoPor"), emailAutor(t, "atualizadoPor"), ...colunasAtivas().map((c) => valorTexto(t, c))].join(" | "));
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
  if (especial === "exclusao") return !!t.exclusao;
  if (especial === "concHoje") return dataConcessao(t) === hojeIso();
  if (especial === "concMes") return dataConcessao(t).startsWith(hojeIso().slice(0, 7));
  if (especial.startsWith("motivoMes:")) { const m = colModelo("motivo"); return !!m && (t.campos || {})[m.id] === especial.slice(10) && dataConcessao(t).startsWith(hojeIso().slice(0, 7)); }
  if (especial === "meus") return t.criadoPor === estado.usuario.id;
  return true;
}
/* Abas que filtram: categorias (estrutura antiga) ou, no modelo v2, as opções de ÁREA */
const colAbas = () => colCategoria() || colModelo("area");
function abasDaPlanilha() {
  const cat = colCategoria();
  if (cat) return estado.estrutura.categorias.filter((c) => c.ativa).sort((a, b) => a.ordem - b.ordem);
  const area = colModelo("area");
  return area ? opcoesAtivas(area).map((o) => ({ id: o.id, nome: o.nome, cor: o.cor })) : [];
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
  const chaves = [...grupos.keys()].sort((a, b) => (ordem ? ((ordem.indexOf(a) + 1 || 999) - (ordem.indexOf(b) + 1 || 999)) : 0) || a.localeCompare(b, "pt-BR"));
  const linhas = [];
  chaves.forEach((k) => {
    const fechado = estado.gruposFechados.has(k);
    linhas.push({ tipo: "grupo", chave: k, n: grupos.get(k).length, fechado });
    if (!fechado) grupos.get(k).forEach((t) => linhas.push({ tipo: "linha", t }));
  });
  return linhas;
}

/* ------------------------------------------------------------
 *  Resumo (clicável = filtra) e abas de categoria
 * ------------------------------------------------------------ */
/* DATA DE CONCESSÃO DO TICKET (aaaa-mm-dd), no modelo v2 */
function dataConcessao(t) {
  const c = colModelo("dataConcessao");
  const v = c ? (t.campos || {})[c.id] : "";
  return typeof v === "string" ? v : "";
}
/* Resumo do modelo v2: total, concedidos hoje e no mês, 5 motivos mais comuns no mês e total por área */
function renderizarResumoV2() {
  const base = estado.tickets.filter(naAba);
  const esp = estado.vista.especial;
  const hoje = hojeIso(), mes = hoje.slice(0, 7);
  const botao = (chave, conteudo, titulo, extra = "") => `<button type="button" data-especial="${escapar(chave)}" aria-pressed="${esp === chave}" title="${escapar(titulo)}"${extra}>${conteudo}</button>`;
  const partes = [botao("", `Total <strong>${base.length.toLocaleString("pt-BR")}</strong>`, "Mostrar todos (tira o filtro do resumo)")];
  if (colModelo("dataConcessao")) {
    const doMes = base.filter((t) => dataConcessao(t).startsWith(mes));
    partes.push(botao("concHoje", `${svg("i-calendario")}Concedidos hoje <strong>${doMes.filter((t) => dataConcessao(t) === hoje).length}</strong>`, "DATA DE CONCESSÃO DO TICKET = hoje"));
    partes.push(botao("concMes", `Neste mês <strong>${doMes.length}</strong>`, "DATA DE CONCESSÃO DO TICKET neste mês"));
    const m = colModelo("motivo");
    if (m) {
      const contagem = new Map();
      doMes.forEach((t) => { const v = (t.campos || {})[m.id]; if (v) contagem.set(v, (contagem.get(v) || 0) + 1); });
      const top = [...contagem].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (top.length) {
        partes.push('<span class="sep-resumo" aria-hidden="true"></span>');
        top.forEach(([id, n]) => { const nome = (opcao(m, id) || { nome: id }).nome; partes.push(botao(`motivoMes:${id}`, `${escapar(nome)} <strong>${n}</strong>`, `MOTIVO neste mês: ${nome}`)); });
      }
    }
  }
  const area = colModelo("area");
  if (area) {
    partes.push('<span class="sep-resumo" aria-hidden="true"></span>');
    opcoesAtivas(area).forEach((o) => {
      const n = estado.tickets.filter((t) => (t.campos || {})[area.id] === o.id).length;
      partes.push(`<button type="button" data-aba-resumo="${escapar(o.id)}" aria-pressed="${estado.vista.aba === o.id}" title="${escapar(`Filtrar ÁREA: ${o.nome}`)}">${escapar(o.nome)} <strong>${n.toLocaleString("pt-BR")}</strong></button>`);
    });
  }
  const pedidos = base.filter((t) => t.exclusao).length;
  if (ehAdmin() && pedidos) partes.push(botao("exclusao", `${svg("i-lixeira")}Exclusão solicitada <strong>${pedidos}</strong>`, "Pedidos de exclusão da equipe"));
  $("#resumo").innerHTML = partes.join("");
}
function renderizarResumo() {
  if (modelo() && modelo().versao >= 2) { renderizarResumoV2(); return; }
  const base = estado.tickets.filter(naAba);
  const esp = estado.vista.especial;
  const botao = (chave, conteudo, titulo) => `<button type="button" data-especial="${escapar(chave)}" aria-pressed="${esp === chave}" title="${escapar(titulo)}">${conteudo}</button>`;
  const partes = [];
  const st = colPorTipo("status");
  if (st) {
    opcoesDe(st).forEach((o) => {
      const n = base.filter((t) => (t.campos || {})[st.id] === o.id).length;
      partes.push(botao(`status:${o.id}`, `<span class="ponto-cor${o.cor ? " cor-" + o.cor : ""}"></span>${escapar(o.nome)} <strong>${n}</strong>`, `Filtrar ${st.nome}: ${o.nome}`));
    });
    partes.push('<span class="sep-resumo" aria-hidden="true"></span>');
  }
  if (st || colDias()) partes.push(botao("atrasados", `${svg("i-relogio")}Em aberto há mais de 7 dias <strong>${base.filter((t) => emAbertoHaMaisDe(t, 7)).length}</strong>`, "Abertos há mais de 7 dias"));
  if (colPorTipo("prioridade")) partes.push(botao("criticos", `${svg("i-alerta")}Críticos em aberto <strong>${base.filter(critico).length}</strong>`, "Prioridade mais alta e ainda em aberto"));
  const hoje = hojeIso();
  partes.push(botao("hoje", `${svg("i-calendario")}Registrados hoje <strong>${base.filter((t) => t.criadoEm && dataIsoBrasilia(t.criadoEm) === hoje).length}</strong>`, "Registrados hoje (horário de Brasília)"));
  const pedidos = base.filter((t) => t.exclusao).length;
  if (ehAdmin() && pedidos) partes.push(botao("exclusao", `${svg("i-lixeira")}Exclusão solicitada <strong>${pedidos}</strong>`, "Pedidos de exclusão da equipe"));
  $("#resumo").innerHTML = partes.join("");
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
  abas.innerHTML = lista.map((a) => `<button type="button" class="aba-grupo" role="tab" data-aba="${escapar(a.id)}" aria-selected="${estado.vista.aba === a.id}" tabindex="${estado.vista.aba === a.id ? 0 : -1}">${a.id === "todos" ? "" : `<span class="ponto-cor${a.cor ? " cor-" + a.cor : ""}"></span>`}${escapar(a.nome)}<span class="n">${contar(a.id)}</span></button>`).join("");
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
 *  Renderização: planilha virtualizada ou cartões
 * ------------------------------------------------------------ */
const areaDados = $("#area-dados");
const LARGURA_ACOES = 74;
const usarCartoes = () => (estado.vista.cartoes == null ? matchMedia("(max-width: 768px)").matches : estado.vista.cartoes);
const largura = (c) => Number(estado.vista.larguras[c]) || (COL[c] ? COL[c].largura : 150);
const alturaLinha = () => (estado.vista.compacta ? 32 : 40);
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
  $("#titulo-planilha").textContent = estado.estrutura.titulo;
  renderizarResumo();
  renderizarAbas();
  renderizarVisoes();
  const agrupaveis = colunasAtivas().filter((c) => [...TIPOS_LISTA, "pessoa", "booleano"].includes(c.tipo) || (c.tipo === "automatico" && /Por$/.test(c.auto)));
  $("#agrupar").innerHTML = `<option value="">Sem agrupar</option>${agrupaveis.map((c) => `<option value="${escapar(c.id)}"${estado.vista.agrupar === c.id ? " selected" : ""}>Agrupar por ${escapar(c.nome)}</option>`).join("")}`;
  $("#btn-densidade").setAttribute("aria-pressed", String(!!estado.vista.compacta));
  $("#btn-cartoes").setAttribute("aria-pressed", String(usarCartoes()));
  $("#btn-selecionar").setAttribute("aria-pressed", String(estado.selecionando));
  const n = estado.filtrados.length, total = estado.tickets.length;
  const filtrosAtivos = Object.values(estado.vista.filtros || {}).some((f) => f && ((f.valores && f.valores.length) || f.texto)) || estado.busca || estado.vista.especial;
  $("#contagem").textContent = `${n.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} registro${total === 1 ? "" : "s"}`;
  $("#btn-limpar-filtros").disabled = !filtrosAtivos;
  $("#btn-csv").hidden = !(ehAdmin() || estado.estrutura.regras.exportacao);
  renderizarSelecao();
  if (usarCartoes()) renderizarCartoes(); else renderizarPlanilha();
}

function renderizarPlanilha() {
  const cols = estado.vista.colunas.filter((c) => COL[c]);
  const total = cols.reduce((s, c) => s + largura(c), 0) + LARGURA_ACOES;
  let planilha = $("#planilha");
  const valoresNova = lerLinhaNova();
  if (!planilha) {
    areaDados.innerHTML = `<div class="planilha" id="planilha" role="grid" aria-label="Planilha de tickets" tabindex="0">
      <div class="cab-grupos" aria-hidden="true"></div><div class="cab" role="row"></div><div class="corpo" role="rowgroup"></div><div class="linha-nova" role="row" hidden></div></div>`;
    planilha = $("#planilha");
    ligarPlanilha(planilha);
  }
  planilha.classList.toggle("compacta", !!estado.vista.compacta);
  planilha.style.setProperty("--colunas", cols.map((c) => largura(c) + "px").join(" ") + ` ${LARGURA_ACOES}px`);
  planilha.style.setProperty("--largura-total", total + "px");
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
  corpo.style.height = estado.linhas.length * alturaLinha() + "px";
  if (!estado.linhas.length) corpo.innerHTML = `<div class="vazio">${escapar(textoVazio())}</div>`;
  estado.ultimoIntervalo = null;
  pintarLinhas(true);
  renderizarLinhaNova(cols, valoresNova);
}
function textoVazio() {
  if (!estado.carregouTickets) return "Carregando os registros…";
  if (estado.tickets.length) return "Nenhum registro com esses filtros.";
  return podeAlimentar() ? "Nenhum registro ainda. Use “Novo registro” ou a linha no fim da planilha." : "Nenhum registro ainda.";
}
function htmlAcoes(t) {
  return `<button type="button" class="acao-linha" data-acao="ficha" title="Ver ficha completa" aria-label="Ver ficha do registro ${escapar(t.numero || "")}">${svg("i-olho")}</button>
    <button type="button" class="acao-linha" data-acao="mais" title="Mais ações" aria-label="Mais ações">⋯</button>`;
}
function pintarLinhas(forcar) {
  const planilha = $("#planilha");
  if (!planilha || !estado.linhas.length) return;
  const h = alturaLinha();
  const topoCorpo = 64;
  const inicio = Math.max(0, Math.floor((planilha.scrollTop - topoCorpo) / h) - 8);
  const fim = Math.min(estado.linhas.length, Math.ceil((planilha.scrollTop + planilha.clientHeight) / h) + 8);
  if (!forcar && estado.ultimoIntervalo && estado.ultimoIntervalo[0] === inicio && estado.ultimoIntervalo[1] === fim) return;
  estado.ultimoIntervalo = [inicio, fim];
  const focoNaGrade = planilha.contains(document.activeElement) && document.activeElement.classList.contains("celula");
  const cols = estado.vista.colunas.filter((c) => COL[c]);
  let html = "";
  for (let i = inicio; i < fim; i++) {
    const l = estado.linhas[i];
    if (l.tipo === "grupo") {
      html += `<div class="linha-grupo${l.fechado ? " fechado" : ""}" style="top:${i * h}px" data-grupo="${escapar(l.chave)}" role="row" aria-expanded="${!l.fechado}"><span class="rot">${svg("i-chevron-baixo")}${escapar(l.chave)} <span class="selo">${l.n}</span></span></div>`;
      continue;
    }
    const t = l.t;
    const editavel = podeEditarLinha(t);
    const sel = estado.selecionados.has(t.id);
    html += `<div class="linha${piscando(t.id) ? " piscou" : ""}${sel ? " selecionada" : ""}${t.exclusao ? " pedido-exclusao" : ""}" style="top:${i * h}px" role="row" aria-rowindex="${i + 2}" data-id="${escapar(t.id)}">` +
      cols.map((c, j) => {
        const col = COL[c];
        const travada = !editavel || !podeEditarColuna(col);
        const extra = j === 0 ? `${estado.selecionando ? `<input type="checkbox" class="sel-linha" data-sel="${escapar(t.id)}"${sel ? " checked" : ""} aria-label="Selecionar linha">` : ""}${t.exclusao ? '<span class="selo-exclusao" title="Exclusão solicitada">Exclusão solicitada</span>' : ""}` : "";
        const titulo = [tituloCelula(t, col).slice(0, 300), col.somenteAdmin && !ehAdmin() ? TEXTO_BLOQUEADO : ""].filter(Boolean).join(" · ");
        return `<div class="celula${j === 0 ? " fixa" : ""}${travada ? " travada" : ""}" role="gridcell" tabindex="-1" data-col="${escapar(c)}" title="${escapar(titulo)}">${extra}${htmlValor(t, col)}</div>`;
      }).join("") +
      `<div class="celula col-acoes">${htmlAcoes(t)}</div></div>`;
  }
  $(".corpo", planilha).innerHTML = html;
  if (estado.celula) {
    const el = celulaEl(estado.celula.id, estado.celula.col);
    if (el) { el.classList.add("ativa"); el.tabIndex = 0; if (focoNaGrade) el.focus({ preventScroll: true }); }
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
  const opcoes = opcoesDe(col).filter((o) => o.ativa !== false || o.id === valor);
  if (col.tipo === "lista") return comboLista(col, valor, atributos);
  if (["status", "prioridade"].includes(col.tipo)) return `<select ${atributos}><option value="">—</option>${opcoes.map((o) => `<option value="${escapar(o.id)}"${o.id === valor ? " selected" : ""}>${escapar(o.nome)}</option>`).join("")}</select>`;
  if (col.tipo === "booleano") return `<select ${atributos}><option value="">Não</option><option value="sim"${valor === true || valor === "sim" ? " selected" : ""}>Sim</option></select>`;
  if (col.tipo === "data") return valor && !/^\d{4}-\d{2}-\d{2}$/.test(valor)
    ? `<input ${atributos} value="${escapar(valor)}" data-original="${escapar(valor)}" placeholder="dd/mm/aaaa" maxlength="60">`
    : `<input type="date" ${atributos} value="${escapar(valor || "")}">`;
  if (col.tipo === "dataHora") return `<input type="datetime-local" ${atributos} value="${escapar(valor || "")}">`;
  if (col.tipo === "numero") return `<input inputmode="decimal" ${atributos} value="${escapar(valor ?? "")}">`;
  if (col.tipo === "etiquetas") return `<input ${atributos} value="${escapar(Array.isArray(valor) ? valor.map((x) => (opcao(col, x) || { nome: x }).nome).join(", ") : valor || "")}" placeholder="${escapar(opcoes.slice(0, 3).map((o) => o.nome).join(", "))}…">`;
  return `<input ${atributos} value="${escapar(valor || "")}" maxlength="${LIMITES[col.tipo] || 300}"${col.tipo === "link" ? ' type="url" placeholder="https://"' : ""}>`;
}
/* Valor antigo que não passaria na validação (data "27/007/2024", opção fora da lista): se não mudou, fica como está */
const valorOriginalMantido = (el, col) => (col.tipo === "data" || TIPOS_LISTA.includes(col.tipo)) && !!el && !!el.dataset && el.dataset.original != null && el.dataset.original !== "" && el.value === el.dataset.original;

/* Lista pesquisável (colunas LISTA): o id da opção fica no campo escondido; digitar só filtra, nunca cria opção.
   O painel de opções é um só, flutuante, dentro do diálogo aberto (ou da página), para não ser cortado pela grade. */
const MAX_OPCOES_VISIVEIS = 50;
function comboLista(col, valor, atributos) {
  const o = valor ? opcao(col, valor) : null;
  const fora = !!valor && (!o || o.ativa === false);
  const rotulo = (/aria-label="([^"]*)"/.exec(atributos) || [])[1];
  const dica = (/placeholder="([^"]*)"/.exec(atributos) || [])[1];
  return `<div class="combo" data-combo-col="${escapar(col.id)}"><input type="hidden" ${atributos.replace(/\s(aria-label|placeholder)="[^"]*"/g, "")} value="${escapar(valor || "")}" data-original="${escapar(valor || "")}">`
    + `<input type="text" class="combo-texto${fora ? " fora" : ""}" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" spellcheck="false"${rotulo ? ` aria-label="${rotulo}"` : ""}`
    + ` value="${escapar(o ? o.nome : valor || "")}" placeholder="${dica || "Pesquisar…"}"${fora ? ' title="Valor fora da lista: troque por uma opção válida"' : ""}></div>`;
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
  Object.assign(combo, { caixa, ul, itens: achadas.slice(0, MAX_OPCOES_VISIVEIS), ativo: -1 });
  ul.setAttribute("aria-label", `Opções de ${col.nome}`);
  ul.innerHTML = combo.itens.map((o, i) => `<li role="option" id="${ul.id}-${i}" data-i="${i}" aria-selected="${o.id === escondido.value}">${escapar(o.nome)}</li>`).join("")
    || `<li class="combo-aviso" aria-disabled="true">Nenhuma opção encontrada. Peça a uma administradora para incluir.</li>`;
  if (achadas.length > MAX_OPCOES_VISIVEIS) ul.insertAdjacentHTML("beforeend", `<li class="combo-aviso" aria-disabled="true">Mais ${achadas.length - MAX_OPCOES_VISIVEIS} opção(ões): continue digitando para filtrar.</li>`);
  ul.hidden = false;
  const r = texto.getBoundingClientRect();
  ul.style.width = Math.max(r.width, 240) + "px";
  ul.style.left = Math.max(8, Math.min(innerWidth - Math.max(r.width, 240) - 8, r.left)) + "px";
  const alto = Math.min(ul.scrollHeight, 280);
  ul.style.top = (r.bottom + alto + 8 > innerHeight && r.top > alto + 8 ? r.top - alto - 4 : r.bottom + 2) + "px";
  texto.setAttribute("aria-expanded", "true");
  texto.setAttribute("aria-controls", ul.id);
  const atual = combo.itens.findIndex((o) => o.id === escondido.value);
  if (atual >= 0) marcarCombo(atual);
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
  if (t) abrirCombo(t.closest(".combo"), t.value);
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
    e.preventDefault(); e.stopPropagation();
    if (combo.ativo >= 0) escolherCombo(caixa, combo.itens[combo.ativo]);
    else if (combo.itens.length === 1) escolherCombo(caixa, combo.itens[0]);
    else if (!t.value.trim()) escolherCombo(caixa, null);
  } else if (e.key === "Escape" && aberta) {
    e.preventDefault(); e.stopPropagation();
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
document.addEventListener("scroll", (e) => { if (combo.ul && e.target !== combo.ul && !combo.ul.contains(e.target)) fecharCombo(); }, true);
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
      ? campoEntrada(col, v, `data-nova="${escapar(c)}" aria-label="Novo registro: ${escapar(col.nome)}${col.obrigatoria ? " (obrigatório)" : ""}" placeholder="${escapar(j === 0 ? "+ " + col.nome : col.nome)}"`)
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
    const cel = e.target.closest(".celula[data-col]");
    if (cel && !e.target.closest("a")) selecionar(cel.closest("[data-id]").dataset.id, cel.dataset.col, true);
  });
  planilha.addEventListener("dblclick", (e) => {
    const cel = e.target.closest(".linha .celula[data-col]");
    if (cel && !e.target.closest("[data-sel]")) iniciarEdicao(cel.closest("[data-id]").dataset.id, cel.dataset.col);
  });
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
    if (texto && /[\t\n]/.test(texto.trim()) && podeAlimentar()) { e.preventDefault(); abrirColar(texto); }
  });
  /* Redimensionar colunas (só na própria visão) */
  planilha.addEventListener("pointerdown", (e) => {
    const r = e.target.closest("[data-redim]");
    if (!r) return;
    e.preventDefault();
    const col = r.dataset.redim;
    const x0 = e.clientX, l0 = largura(col);
    const mover = (ev) => { estado.vista.larguras[col] = Math.max(60, Math.min(600, Math.round(l0 + ev.clientX - x0))); renderizarPlanilha(); };
    const soltar = () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); salvarVista(); };
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
function selecionar(id, col, focar) {
  $$(".celula.ativa").forEach((x) => { x.classList.remove("ativa"); x.tabIndex = -1; });
  estado.celula = { id, col };
  const el = celulaEl(id, col);
  if (el) { el.classList.add("ativa"); el.tabIndex = 0; if (focar) el.focus({ preventScroll: false }); }
}
function moverSelecao(dLinha, dCol) {
  const linhasDados = estado.linhas.map((l, i) => ({ ...l, i })).filter((l) => l.tipo === "linha");
  if (!linhasDados.length) return;
  const cols = estado.vista.colunas.filter((c) => COL[c]);
  let li = estado.celula ? linhasDados.findIndex((l) => l.t.id === estado.celula.id) : 0;
  let ci = estado.celula ? cols.indexOf(estado.celula.col) : 0;
  li = Math.max(0, Math.min(linhasDados.length - 1, (li < 0 ? 0 : li) + dLinha));
  ci = Math.max(0, Math.min(cols.length - 1, (ci < 0 ? 0 : ci) + dCol));
  const alvo = linhasDados[li];
  const planilha = $("#planilha");
  const h = alturaLinha();
  const y = alvo.i * h;
  if (y < planilha.scrollTop) planilha.scrollTop = y;
  else if (y + h + 64 + 50 > planilha.scrollTop + planilha.clientHeight) planilha.scrollTop = y + h + 64 + 50 - planilha.clientHeight;
  pintarLinhas(true);
  selecionar(alvo.t.id, cols[ci], true);
}
function teclaPlanilha(e) {
  if (estado.editando || e.target.closest(".editor-celula")) return;
  if (!e.target.classList.contains("celula") && e.target.id !== "planilha") return;
  const mapa = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], PageDown: [10, 0], PageUp: [-10, 0] };
  if (mapa[e.key]) { e.preventDefault(); moverSelecao(...mapa[e.key]); return; }
  if (!estado.celula) return;
  if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); iniciarEdicao(estado.celula.id, estado.celula.col); return; }
  if (e.key === "Home") { e.preventDefault(); moverSelecao(0, -999); }
  if (e.key === "End") { e.preventDefault(); moverSelecao(0, 999); }
  if (e.key === "Delete") {
    const t = porId(estado.celula.id), col = COL[estado.celula.col];
    if (t && col && podeEditarCelula(t, col) && !col.obrigatoria) { e.preventDefault(); salvarCelula(t, col, vazioDe(col)); }
  }
  if (e.key === " " && estado.selecionando) { e.preventDefault(); alternarSelecao(estado.celula.id, !estado.selecionados.has(estado.celula.id)); }
}

/* Cartões (celular) */
function renderizarCartoes() {
  let html = "", n = 0;
  const st = colPorTipo("status"), pr = colPorTipo("prioridade"), cat = colCategoria();
  /* Modelo v2: responsável e data de concessão na segunda linha; motivo e área como etiquetas */
  const v2 = versaoModelo() >= 2;
  const resumoCol = v2 ? null : COL.resumo && COL.resumo.ativa ? COL.resumo : colunasAtivas().find((c) => c.tipo === "texto" && c.id !== idChave());
  const linha2V2 = [colModelo("responsavel"), colModelo("dataConcessao")].filter(Boolean);
  const etiquetasCols = v2 ? [colModelo("motivo"), colModelo("area")].filter(Boolean) : [st, pr, cat].filter(Boolean);
  const titulo = colNumero() || colunasAtivas()[0];
  for (const l of estado.linhas) {
    if (n >= estado.cartoesLimite) break;
    if (l.tipo === "grupo") { html += `<div class="cartao-grupo" data-grupo="${escapar(l.chave)}" role="button" tabindex="0">${escapar(l.chave)} <span class="selo">${l.n}</span></div>`; continue; }
    const t = l.t;
    n++;
    html += `<article class="cartao-ticket${piscando(t.id) ? " piscou" : ""}" data-id="${escapar(t.id)}">
      <div class="topo"><div><div class="numero">${escapar(titulo ? valorTexto(t, titulo) || "(sem número)" : "")}</div>
        ${resumoCol ? `<div class="linha2">${escapar(valorTexto(t, resumoCol))}</div>` : ""}${v2 ? `<div class="linha2">${escapar(linha2V2.map((c) => valorTexto(t, c)).filter(Boolean).join(" · ") || "Ainda não concedido")}</div>` : ""}</div>
        ${estado.selecionando ? `<input type="checkbox" class="sel-linha" data-sel="${escapar(t.id)}"${estado.selecionados.has(t.id) ? " checked" : ""} aria-label="Selecionar registro">` : ""}</div>
      <div class="etiquetas">${etiquetasCols.map((c) => htmlValor(t, c)).join(" ")}${t.exclusao ? ' <span class="selo-exclusao">Exclusão solicitada</span>' : ""}</div>
      <div class="linha2" title="${escapar(emailAutor(t, "criadoPor"))}">${escapar([nomeAutor(t, "criadoPor"), formatarData(t.criadoEm, true)].filter(Boolean).join(" · "))}</div>
      <div class="acoes-c">${htmlAcoes(t)}</div></article>`;
  }
  const restantes = estado.filtrados.length - n;
  areaDados.innerHTML = estado.linhas.length
    ? `<div class="cartoes">${html}</div>${restantes > 0 ? `<p style="text-align:center;margin-top:12px"><button type="button" class="btn btn-secundario" id="mais-cartoes">Mostrar mais (${restantes})</button></p>` : ""}`
    : `<div class="vazio">${escapar(textoVazio())}</div>`;
}
areaDados.addEventListener("click", (e) => {
  if (e.target.closest("#mais-cartoes")) { estado.cartoesLimite += 60; renderizarCartoes(); return; }
  if ($("#planilha")) return;
  const sel = e.target.closest("[data-sel]");
  if (sel) { alternarSelecao(sel.dataset.sel, sel.checked); return; }
  const acao = e.target.closest("[data-acao]");
  if (acao) { executarAcao(acao.dataset.acao, porId(acao.closest("[data-id]").dataset.id), acao); return; }
  const g = e.target.closest("[data-grupo]");
  if (g) { const k = g.dataset.grupo; if (estado.gruposFechados.has(k)) estado.gruposFechados.delete(k); else estado.gruposFechados.add(k); renderizarTudo(); return; }
  const cartao = e.target.closest(".cartao-ticket");
  if (cartao && !e.target.closest("a, button, input")) abrirFicha(cartao.dataset.id);
});

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
  const valores = usarLista ? [...set].sort((a, b) => (ordem ? (ordem.indexOf(a) + 1 || 999) - (ordem.indexOf(b) + 1 || 999) : 0) || a.localeCompare(b, "pt-BR")) : [];
  const comTexto = !porLista;
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Filtrar " + col.nome);
  pop.innerHTML = `<strong style="font-size:13px">Filtrar: ${escapar(col.nome)}</strong>
    ${comTexto ? `<input type="search" placeholder="Contém…" value="${escapar(f.texto || "")}" data-contem>` : ""}
    ${usarLista ? `<div class="opcoes">${valores.map((v) => `<label class="check"><input type="checkbox" value="${escapar(v)}"${(f.valores || []).includes(v) ? " checked" : ""}> ${escapar(v)}</label>`).join("") || '<span class="apoio">Sem valores.</span>'}</div>` : ""}
    <div class="form-botoes"><button type="button" class="btn btn-secundario btn-mini" data-pop="limpar">Limpar</button><button type="button" class="btn btn-mini" data-pop="aplicar">Aplicar</button></div>`;
  posicionarPop(pop, botao);
  const entrada = pop.querySelector("input");
  if (entrada) entrada.focus();
  const aplicar = (limpar) => {
    estado.vista.filtros = estado.vista.filtros || {};
    if (limpar) delete estado.vista.filtros[c];
    else estado.vista.filtros[c] = { valores: $$("input[type=checkbox]:checked", pop).map((i) => i.value), texto: comTexto ? pop.querySelector("[data-contem]").value.trim() : "" };
    fecharPop(); salvarVista(); renderizarTudo();
  };
  pop.addEventListener("click", (e) => { const b = e.target.closest("[data-pop]"); if (b) aplicar(b.dataset.pop === "limpar"); });
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
$("#btn-cartoes").innerHTML = svg("i-grade");
$("#btn-csv").innerHTML = svg("i-download");
$("#btn-imprimir").innerHTML = svg("i-imprimir");
$("#btn-novo").innerHTML = svg("i-mais") + "Novo registro";
$("#btn-colar").innerHTML = svg("i-upload") + "Colar do Excel";
$("#btn-selecionar").innerHTML = svg("i-selecionar");
$("#btn-desfazer").innerHTML = svg("i-desfazer");
$("#btn-densidade").addEventListener("click", () => { estado.vista.compacta = !estado.vista.compacta; salvarVista(); renderizarTudo(); });
$("#btn-cartoes").addEventListener("click", () => { estado.vista.cartoes = !usarCartoes(); salvarVista(); renderizarTudo(); });
$("#btn-colunas").addEventListener("click", () => {
  const vis = new Set(estado.vista.colunas);
  const grupos = [...estado.estrutura.gruposColunas].sort((a, b) => a.ordem - b.ordem);
  const primeira = estado.vista.colunas[0];
  const d = criarDialogo({
    titulo: "Colunas (só para você)",
    corpo: `<p class="apoio">Mostre, oculte e reordene colunas só na sua visão. Para todos, só as administradoras mudam a estrutura.</p>
      <div class="colunas-escolha">${grupos.map((g) => {
        const cols = colunasAtivas().filter((c) => c.grupo === g.id);
        if (!cols.length) return "";
        return `<fieldset><legend>${escapar(g.nome)}</legend>
          ${cols.map((c) => `<label class="check"><input type="checkbox" data-col-vis="${escapar(c.id)}"${vis.has(c.id) ? " checked" : ""}${c.id === primeira ? " disabled" : ""}> ${escapar(c.nome)}</label>`).join("")}</fieldset>`;
      }).join("")}</div>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-col-padrao>Voltar ao padrão</button><button type="submit" class="btn">Aplicar</button></div>`
  });
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
    salvarVista(); renderizarTudo();
  });
  d.showModal();
});
const colunasExportaveis = () => estado.vista.colunas.filter((c) => COL[c]);
function csvCampo(t) { const s = String(t == null ? "" : t); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
$("#btn-csv").addEventListener("click", () => {
  if (!ehAdmin() && !estado.estrutura.regras.exportacao) { mostrarAviso("A exportação está desligada pelas administradoras."); return; }
  const cols = colunasExportaveis();
  const linhas = [cols.map((c) => csvCampo(COL[c].nome)).join(";"), ...ticketsFiltrados().map((t) => cols.map((c) => csvCampo(valorTexto(t, COL[c]))).join(";"))];
  const p = partesBrasilia();
  baixarArquivo(`banco-de-tickets-${p.ano}-${p.mes}-${p.dia}.csv`, "\ufeff" + linhas.join("\r\n"), "text/csv;charset=utf-8");
  mostrarAviso(`CSV com ${linhas.length - 1} registro(s) baixado.`);
});
$("#btn-imprimir").addEventListener("click", () => {
  const cols = colunasExportaveis();
  $("#tabela-impressao").innerHTML = `<h1 style="font-size:14pt;margin-bottom:6px">${escapar(estado.estrutura.titulo)} · ${escapar(formatarData(new Date(), true))}</h1><table><thead><tr>${cols.map((c) => `<th>${escapar(COL[c].nome)}</th>`).join("")}</tr></thead>
    <tbody>${ticketsFiltrados().map((t) => `<tr>${cols.map((c) => `<td>${escapar(valorTexto(t, COL[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  window.print();
});
/* Atalhos: "/" busca, Ctrl+Z desfaz, N novo registro (fora de campos) */
document.addEventListener("keydown", (e) => {
  if ($("#app").hidden || document.querySelector("dialog[open]")) return;
  const emCampo = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
  if (e.key === "/" && !emCampo) { e.preventDefault(); $("#busca").focus(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !emCampo) { e.preventDefault(); desfazer(); return; }
  if (e.key.toLowerCase() === "n" && e.altKey && podeAlimentar()) { e.preventDefault(); abrirNovoRegistro(); }
});
let resizeAntes = innerWidth;
window.addEventListener("resize", () => {
  if (!estado.vista) return;
  if ((resizeAntes <= 768) !== (innerWidth <= 768) && estado.vista.cartoes == null) renderizarTudo();
  else pintarLinhas(true);
  resizeAntes = innerWidth;
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
  const hid = estado.api.novoId(`${P()}/${id}/historico`);
  return { op: "set", caminho: `${P()}/${id}/historico/${hid}`, dados: {
    acao, coluna: extra.coluna || "", colunaNome: texto500(extra.colunaNome).slice(0, 60),
    antes: texto500(extra.antes), depois: texto500(extra.depois), ...autoria("por"), em: "__AGORA__"
  } };
}
/* Quem grava: uid (equipe) ou e-mail (administradora), com cópia do nome e do e-mail do perfil */
const autoria = (prefixo) => ({ [prefixo]: estado.usuario.id, [prefixo + "Nome"]: estado.usuario.nome, [prefixo + "Email"]: estado.usuario.email });
const assinatura = () => ({ ...autoria("atualizadoPor"), atualizadoEm: "__AGORA__" });
function mensagemErro(e, contexto = "") {
  const codigo = (e && e.code) || "";
  if (/permission-denied/.test(codigo)) return contexto === "numero" ? "Não foi possível salvar: esse Nº do ticket já existe ou você não tem permissão." : "Você não tem permissão para esta mudança.";
  if (/unavailable|network|deadline/.test(codigo)) return "Sem conexão. Tente de novo quando a internet voltar.";
  return "Não foi possível salvar agora. Tente de novo.";
}
function empilharDesfazer(rotulo, fn) {
  if (!fn) return;
  estado.desfazer.push({ rotulo, fn });
  if (estado.desfazer.length > 30) estado.desfazer.shift();
  atualizarBotoes();
}
async function gravar(ops, { desfazer: fn = null, rotulo = "", contexto = "" } = {}) {
  if (!conectado()) { mostrarAviso("Sem conexão: a edição está bloqueada."); return false; }
  try {
    await estado.api.lote(ops);
    empilharDesfazer(rotulo, fn);
    return true;
  } catch (e) {
    console.error(e);
    mostrarAviso(mensagemErro(e, contexto), 5000);
    return false;
  }
}
/* Monta as escritas de uma mudança de campos (com o índice do Nº do ticket e o histórico) */
function opsAlteracao(t, mudancas, acao = "editar") {
  if (t.arquivo) return opsTirarDoArquivo(t, mudancas, acao);
  const dados = { campos: { ...mudancas }, ...assinatura() };
  const ops = [];
  const k = idChave();
  if (k in mudancas && colNumero()) {
    const nova = chaveNumero(mudancas[k]);
    if (nova !== (t.numero || "")) {
      dados.numero = nova;
      if (nova) ops.push({ op: "set", caminho: `${P()}-numeros/${nova}`, dados: { ticket: t.id } });
      if (t.numero) ops.push({ op: "delete", caminho: `${P()}-numeros/${t.numero}` });
    }
  }
  ops.unshift({ op: "set", caminho: `${P()}/${t.id}`, mesclar: true, dados });
  Object.entries(mudancas).forEach(([c, v]) => {
    const col = COL[c];
    if (!col) return;
    ops.push(opHistorico(t.id, acao, { coluna: c, colunaNome: col.nome, antes: textoDoValor(col, (t.campos || {})[c]), depois: textoDoValor(col, v) }));
  });
  return ops;
}
/* Linha do arquivo editada: cria tickets/{mesmo id} com "parcial: true" e SÓ os campos alterados, que valem por cima
   da linha do arquivo (vazio é gravado como ""). Assim ninguém regrava as colunas que não pode alterar. */
function opsTirarDoArquivo(t, mudancas, acao) {
  const k = idChave();
  const campos = Object.fromEntries(Object.entries(mudancas).map(([c, v]) => [c, v == null ? "" : v]));
  const numero = colNumero() && k in campos && !estaVazio(campos[k]) ? chaveNumero(campos[k]) : "";
  const ops = [{ op: "set", caminho: `${P()}/${t.id}`, dados: { campos, numero, parcial: true, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura(), exclusao: null } }];
  if (numero) ops.push({ op: "set", caminho: `${P()}-numeros/${numero}`, dados: { ticket: t.id } });
  Object.entries(mudancas).forEach(([c, v]) => {
    const col = COL[c];
    if (!col) return;
    ops.push(opHistorico(t.id, acao, { coluna: c, colunaNome: col.nome, antes: textoDoValor(col, (t.campos || {})[c]), depois: textoDoValor(col, v) }));
  });
  return ops;
}
async function salvarCampos(t, mudancas, { semDesfazer = false } = {}) {
  const reais = Object.fromEntries(Object.entries(mudancas).filter(([c, v]) => JSON.stringify((t.campos || {})[c] ?? vazioDe(COL[c])) !== JSON.stringify(v ?? vazioDe(COL[c]))));
  if (!Object.keys(reais).length) return true;
  const antes = Object.fromEntries(Object.keys(reais).map((c) => [c, (t.campos || {})[c] ?? vazioDe(COL[c])]));
  const ok = await gravar(opsAlteracao(t, reais), {
    rotulo: "Edição desfeita",
    contexto: idChave() in reais ? "numero" : "",
    desfazer: semDesfazer ? null : async () => { const atual = porId(t.id); if (atual) return salvarCampos(atual, antes, { semDesfazer: true }); }
  });
  return ok;
}
const salvarCelula = (t, col, valor) => salvarCampos(t, { [col.id]: valor });

/* Só as colunas que a pessoa pode preencher entram no registro (as regras recusam o resto) */
function filtrarCamposPermitidos(campos) {
  const permitidas = new Set(colunasAtivas().filter((c) => podeNaLinhaNova(c)).map((c) => c.id));
  return Object.fromEntries(Object.entries(campos).filter(([c, v]) => permitidas.has(c) && !estaVazio(v)));
}
function resumoRegistro(campos) {
  const r = COL.resumo ? campos.resumo : "";
  return [campos[idChave()], r].filter(Boolean).join(" · ");
}
async function criarRegistro(camposBrutos, { semDesfazer = false } = {}) {
  const campos = filtrarCamposPermitidos(camposBrutos);
  const id = estado.api.novoId(P());
  const numero = colNumero() && campos[idChave()] ? chaveNumero(campos[idChave()]) : "";
  const ops = [{ op: "set", caminho: `${P()}/${id}`, dados: { campos, numero, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura(), exclusao: null } }];
  if (numero) ops.push({ op: "set", caminho: `${P()}-numeros/${numero}`, dados: { ticket: id } });
  ops.push(opHistorico(id, "criar", { depois: resumoRegistro(campos) }));
  const ok = await gravar(ops, {
    rotulo: "Registro removido",
    contexto: numero ? "numero" : "",
    desfazer: semDesfazer || !ehAdmin() ? null : async () => excluirDeVez([{ id, numero }], "Desfez a criação")
  });
  return ok ? id : null;
}
/* Monta o registro completo: valores informados + padrões + categoria da aba atual */
function completarCampos(informados) {
  const campos = {};
  colunasAtivas().forEach((c) => {
    if (!podeNaLinhaNova(c)) return;
    if (c.id in informados && !estaVazio(informados[c.id])) campos[c.id] = informados[c.id];
    else if (estado.vista.aba !== "todos" && colAbas() && c.id === colAbas().id) campos[c.id] = estado.vista.aba;
    else { const p = valorPadrao(c); if (!estaVazio(p)) campos[c.id] = p; }
  });
  return campos;
}
async function avisarRepetido(erro) {
  if (await confirmar(erro.texto, { titulo: "Nº do ticket repetido", botao: "Abrir o registro existente" })) abrirFicha(erro.id);
}

/* ------------------------------------------------------------
 *  Edição na célula (duplo clique, Enter ou F2; Esc cancela)
 * ------------------------------------------------------------ */
function iniciarEdicao(id, c) {
  const t = porId(id);
  const col = COL[c];
  if (!t || !col) return;
  if (!podeEditarCelula(t, col)) { mostrarAviso(motivoSemEdicao(t, col)); return; }
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
  if (col.tipo === "etiquetas") campo = `<select multiple>${opcoesDe(col).map((o) => `<option value="${escapar(o.id)}"${(valor || []).includes(o.id) ? " selected" : ""}>${escapar(o.nome)}</option>`).join("")}</select>`;
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
  foco.focus();
  if (!ehCombo && entrada.select && entrada.tagName === "INPUT" && !["date", "datetime-local"].includes(entrada.type)) entrada.select();
  let terminado = false;
  const terminar = async (salvar) => {
    if (terminado) return;
    if (ehCombo) { fecharCombo(); sairDoCombo(entrada); }
    let bruto = campoValor.value;
    if (col.tipo === "booleano") bruto = entrada.value === "sim";
    if (col.tipo === "etiquetas") bruto = [...entrada.selectedOptions].map((o) => o.value);
    if (salvar) {
      const r = valorOriginalMantido(campoValor, col) ? { ok: true, valor } : validarValor(col, bruto);
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
        foco.focus();
        return;
      }
      terminado = true;
      estado.editando = null;
      box.remove();
      linha.style.zIndex = "";
      await salvarCelula(t, col, r.valor);
    } else {
      terminado = true;
      estado.editando = null;
      box.remove();
      linha.style.zIndex = "";
    }
    if (renderPendente) agendarRender();
    const el = celulaEl(id, c);
    if (el) el.focus();
  };
  entrada.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); terminar(false); }
    if (e.key === "Enter" && !((col.tipo === "textoLongo" || col.tipo === "etiquetas") && e.shiftKey) && col.tipo !== "etiquetas") { e.preventDefault(); terminar(true).then(() => moverSelecao(1, 0)); }
    if (e.key === "Enter" && col.tipo === "etiquetas" && !e.shiftKey) { e.preventDefault(); terminar(true); }
    if (e.key === "Tab") { e.preventDefault(); terminar(true).then(() => moverSelecao(0, e.shiftKey ? -1 : 1)); }
  });
  foco.addEventListener("blur", () => setTimeout(() => { if (!terminado && !box.contains(document.activeElement)) terminar(true); }, 0));
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
    erro = el ? e : `${e} Use “Novo registro” para preencher todas as colunas.`;
  }
  if (erro) { mostrarAviso(erro, 5000); return; }
  const id = await criarRegistro(completos);
  if (!id) return;
  campos.forEach((el) => { el.value = ""; });
  $$("#planilha .linha-nova .combo-texto").forEach((el) => { el.value = ""; });
  estado.piscar.set(id, Date.now() + 3500);
  mostrarAviso("Registro adicionado. A linha nova está pronta para o próximo.");
  const primeiroCampo = campos[0];
  if (primeiroCampo) primeiroCampo.focus();
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
      else if (c.tipo === "etiquetas") entrada = `<div style="display:flex;flex-wrap:wrap;gap:8px 14px">${opcoesDe(c).map((o) => `<label class="check"><input type="checkbox" name="${escapar(c.id)}" value="${escapar(o.id)}"${(valores[c.id] || []).includes(o.id) ? " checked" : ""}> ${escapar(o.nome)}</label>`).join("")}</div>`;
      else entrada = campoEntrada(c, valores[c.id], `name="${escapar(c.id)}" id="f-${escapar(c.id)}"`);
      return `<label class="campo${largo ? " largo" : ""}"><span class="rotulo">${escapar(c.nome)}${c.obrigatoria ? ' <span class="obrig">*</span>' : ""}${c.somenteAdmin ? ` <span title="${escapar(TEXTO_BLOQUEADO)}">${svg("i-cadeado", "icone cadeado")}</span>` : ""}</span>${entrada}${c.ajuda ? `<span class="ajuda">${escapar(c.ajuda)}</span>` : ""}</label>`;
    }).join("")}</fieldset>`;
  }).join("");
}
function lerFormulario(form, cols) {
  const valores = {}, erros = {};
  cols.forEach((c) => {
    let bruto, el = null;
    if (c.tipo === "etiquetas") bruto = $$(`[name="${CSS.escape(c.id)}"]:checked`, form).map((i) => i.value);
    else { el = form.elements[c.id]; if (!el) return; bruto = c.tipo === "booleano" ? el.value === "sim" : el.value; }
    const r = valorOriginalMantido(el, c) ? { ok: true, valor: el.dataset.original } : validarValor(c, bruto);
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
    titulo: "Novo registro",
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
    const k = idChave();
    const el = form.elements[k];
    const caixa = $("#aviso-repetido", d);
    if (!el || !el.value.trim()) { caixa.innerHTML = ""; return; }
    const e = conferirRegistro({ [k]: el.value })[k];
    caixa.innerHTML = e && typeof e === "object" ? `<div class="aviso-repetido">${svg("i-alerta")}<span>${escapar(e.texto)}</span><button type="button" class="btn btn-secundario btn-mini" data-abrir-existente="${escapar(e.id)}">Abrir o registro existente</button></div>` : "";
  };
  form.addEventListener("input", (e) => { guardar(); if (e.target.name === idChave()) conferirNumero(); });
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
    mostrarAviso("Registro adicionado.");
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
 *  Equipe: só ADICIONA linhas novas. Administradoras: também atualiza ou substitui.
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
  const sinonimos = { numero: ["n ticket", "no ticket", "numero", "ticket", "chamado", "protocolo"], abertura: ["abertura", "data"], resumo: ["resumo", "assunto", "titulo"], descricao: ["descricao", "detalhe"], cliente: ["cliente", "parceiro"], responsavel: ["responsavel", "analista"] };
  const s = Object.entries(sinonimos).find(([id, lista]) => cols.some((c) => c.id === id) && lista.some((x) => n === x || n.includes(x)));
  return s ? s[0] : (cols.find((c) => n.includes(limpo(c.nome)) && limpo(c.nome).length > 3) || {}).id || "";
}
function abrirColar(textoInicial = "") {
  if (!podeAlimentar()) { mostrarAviso(conectado() ? "Seu acesso é só de leitura." : "Sem conexão: a edição está bloqueada."); return; }
  const cols = colunasAtivas().filter(podeNaLinhaNova);
  const admin = ehAdmin();
  const d = criarDialogo({
    titulo: "Colar do Excel",
    largo: true,
    corpo: `<p class="lgpd"><strong>LGPD:</strong> deixe como “Ignorar” colunas de CPF/CNPJ completo, RG, endereço, telefone pessoal ou saúde.</p>
      <div class="campos-linha">
        <label class="campo"><span class="rotulo">Cole aqui as células do Excel (com o cabeçalho)</span><textarea name="colado" rows="6" placeholder="${escapar(cols.slice(0, 3).map((c) => c.nome).join("\t"))}…"></textarea></label>
        <div class="campo"><label class="campo"><span class="rotulo">Ou escolha um arquivo .csv</span><input type="file" name="arquivo" accept=".csv,text/csv,.txt"></label>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="cabecalho" checked> A primeira linha é o cabeçalho</label>
          ${admin ? `<label class="campo" style="margin-top:8px"><span class="rotulo">O que fazer</span><select name="modo">
            <option value="adicionar">Só adicionar linhas novas</option>
            <option value="atualizar">Atualizar pelo ${escapar(colNumero() ? colNumero().nome : "Nº do ticket")} (e adicionar os novos)</option>
            <option value="substituir">Substituir TODOS os registros (faz backup antes)</option></select></label>`
            : '<p class="apoio" style="margin-top:8px">As linhas coladas sempre entram como registros novos. Nada que já existe é alterado.</p>'}
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
  const modo = () => (admin ? form.modo.value : "adicionar");
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
        const chave = `${c}|${nomeComparavel(bruto)}`;
        const f = fora.get(chave) || { chave, col: COL[c], bruto, n: 0, sugestao: r.sugestao || null };
        f.n++;
        fora.set(chave, f);
        const escolha = trocas.get(chave) || "";
        if (escolha === "sugestao" && f.sugestao) informados[c] = f.sugestao.id;
        else if (escolha !== "vazio") { erros.push(r.erro); celulasFora.add(i); }
      });
      const campos = completarCampos(informados);
      const chave = campos[idChave()] ? chaveNumero(campos[idChave()]) : "";
      const existente = chave ? ticketsComNumero(chave)[0] || null : null;
      const repetidoNoColado = chave && vistos.has(chave);
      if (chave) vistos.add(chave);
      const m = modo();
      const conf = conferirRegistro(campos, existente && m !== "adicionar" ? existente.id : undefined);
      Object.entries(conf).forEach(([c, x]) => { if (typeof x === "string") erros.push(x); });
      let situacao = erros.length ? "erro" : "nova";
      if (!erros.length && repetidoNoColado) { situacao = "erro"; erros.push("Nº do ticket repetido na própria colagem."); }
      else if (!erros.length && existente) situacao = m === "adicionar" ? "repetido" : m === "atualizar" ? "atualizar" : "nova";
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
        ${a.fora.map((f) => `<label><span><strong>${escapar(f.col.nome)}</strong>: <span class="valor-fora">“${escapar(f.bruto)}”</span> · ${f.n} linha(s)</span>
          <select data-troca="${escapar(f.chave)}"><option value="">Corrigir depois (a linha não entra)</option>${f.sugestao ? `<option value="sugestao"${trocas.get(f.chave) === "sugestao" ? " selected" : ""}>Usar “${escapar(f.sugestao.nome)}”</option>` : ""}<option value="vazio"${trocas.get(f.chave) === "vazio" ? " selected" : ""}>Deixar o campo vazio</option></select></label>`).join("")}</div>` : ""}
      <div class="previa-import"><table><thead><tr><th>Situação</th>${a.titulos.map((t) => `<th>${escapar(t)}</th>`).join("")}</tr></thead><tbody>${a.linhas.slice(0, 50).map((l) => `<tr class="${l.situacao === "erro" ? "com-erro" : l.situacao === "repetido" ? "repetido" : ""}"><td>${escapar(l.situacao === "erro" ? l.erros.join(" ") : l.situacao === "repetido" ? "Já existe" : l.situacao === "atualizar" ? "Atualizar" : "Nova")}</td>${a.titulos.map((_, i) => `<td${l.celulasFora.has(i) ? ' class="celula-fora"' : ""}>${escapar(String(l.original[i] || "").slice(0, 40))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const validas = a.linhas.filter((l) => ["nova", "atualizar"].includes(l.situacao)).length;
    $("#colar-ok", d).disabled = !validas && modo() !== "substituir";
    $("#colar-ok", d).textContent = modo() === "substituir" ? `Substituir por ${validas} registro(s)` : `Gravar ${validas} linha(s)`;
  };
  form.colado.addEventListener("input", () => { tabela = lerTabelaTexto(form.colado.value); $("#colar-conferencia", d).innerHTML = ""; desenhar(); });
  form.cabecalho.addEventListener("change", () => { $("#colar-conferencia", d).innerHTML = ""; desenhar(); });
  if (form.modo) form.modo.addEventListener("change", desenhar);
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
    const botao = $("#colar-ok", d);
    botao.disabled = true;
    const progresso = $("#colar-progresso", d);
    let ok = 0, falhas = 0;
    if (!admin) {
      /* Equipe: cada linha num lote próprio (registro + índice do Nº + histórico) */
      for (const l of validas) {
        progresso.textContent = `Gravando ${ok + falhas + 1} de ${validas.length}…`;
        const id = await criarRegistro(l.campos, { semDesfazer: true });
        if (id) { ok++; estado.piscar.set(id, Date.now() + 3500); } else falhas++;
      }
    } else {
      if (m === "substituir") {
        if (!(await confirmarDigitando(`Isso apaga os ${estado.tickets.length} registros atuais e grava ${validas.length} no lugar. Um backup é feito antes.`, "SUBSTITUIR", { titulo: "Substituir todos os registros", botao: "Substituir" }))) { botao.disabled = false; return; }
        progresso.textContent = "Fazendo backup…";
        const bk = await criarBackup("Antes de substituir todos os registros pela colagem");
        if (!bk) { botao.disabled = false; return; }
        progresso.textContent = "Apagando os registros atuais…";
        try { await gravarArquivo([], { apagarVivos: estado.vivos }); }
        catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); botao.disabled = false; return; }
      }
      const ops = [], ids = [];
      validas.forEach((l) => {
        if (l.situacao === "atualizar" && m === "atualizar") {
          const campos = Object.fromEntries(Object.entries(l.informados));
          ops.push(...opsAlteracao(l.existente, campos, "importar"));
          return;
        }
        const id = estado.api.novoId(P());
        ids.push(id);
        const campos = filtrarCamposPermitidos(l.campos);
        const numero = colNumero() && campos[idChave()] ? chaveNumero(campos[idChave()]) : "";
        ops.push({ op: "set", caminho: `${P()}/${id}`, dados: { campos, numero, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura(), exclusao: null } });
        if (numero) ops.push({ op: "set", caminho: `${P()}-numeros/${numero}`, dados: { ticket: id } });
        ops.push(opHistorico(id, "importar", { depois: resumoRegistro(campos) }));
      });
      progresso.textContent = "Gravando…";
      if (await gravar(ops, { rotulo: "Importação desfeita", desfazer: ids.length ? async () => excluirDeVez(ids.map((id) => ({ id, numero: (porId(id) || {}).numero || "" })), "Desfez a importação") : null })) {
        ok = validas.length;
        ids.forEach((id) => estado.piscar.set(id, Date.now() + 3500));
        registrarAuditoria("importar", `Importou ${validas.length} linha(s) (${m === "substituir" ? "substituindo tudo" : m === "atualizar" ? "atualizando pelo Nº do ticket" : "só adicionando"})`);
      } else falhas = validas.length;
    }
    progresso.textContent = "";
    if (ok) { d.close(); mostrarAviso(`${ok} linha(s) gravada(s).${falhas ? ` ${falhas} falharam.` : ""}`, 6000); }
    else { botao.disabled = false; $("#colar-erro", d).textContent = "Nada foi gravado. Confira as linhas com erro."; }
  });
  d.showModal();
  if (textoInicial) { form.colado.value = textoInicial; tabela = lerTabelaTexto(textoInicial); desenhar(); }
  form.colado.focus();
}
$("#btn-colar").addEventListener("click", () => abrirColar());

/* ------------------------------------------------------------
 *  Ações da linha e ficha lateral (ver, editar, histórico, exclusão)
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
    ...(podePedirExclusao(t) ? [["pedir", "i-lixeira", "Solicitar exclusão", "perigo"]] : []),
    ...(ehAdmin() && conectado() && t.exclusao ? [["recusar", "i-fechar", "Recusar o pedido de exclusão"]] : []),
    ...(ehAdmin() && conectado() ? [["excluir", "i-lixeira", t.exclusao ? "Aprovar exclusão (vai para a Lixeira)" : "Excluir (vai para a Lixeira)", "perigo"]] : [])
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
    if (m === "pedir") pedirExclusao(t);
    if (m === "recusar") recusarExclusao(t);
    if (m === "excluir") excluirParaLixeira([t], t.exclusao ? `Pedido de ${(t.exclusao.porNome || nomePessoa(t.exclusao.por))}: ${t.exclusao.motivo}` : "");
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
  const titulo = colNumero() ? valorTexto(t, colNumero()) || "(sem número)" : "Registro";
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
  const exclusao = t.exclusao ? `<div class="aviso-exclusao"><span>${svg("i-alerta")} <strong>Exclusão solicitada</strong> por ${escapar((t.exclusao.porNome || nomePessoa(t.exclusao.por)))}${t.exclusao.em ? " em " + escapar(formatarData(t.exclusao.em, true)) : ""}: ${escapar(t.exclusao.motivo)}</span>
      ${ehAdmin() && conectado() ? `<span class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-perigo btn-mini" data-ficha="excluir">${svg("i-check")}Aprovar (vai para a Lixeira)</button><button type="button" class="btn btn-secundario btn-mini" data-ficha="recusar">Recusar</button></span>` : ""}</div>` : "";
  const botoes = editar
    ? `<button type="button" class="btn btn-secundario" data-ficha="ver">Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}Salvar</button>`
    : [
      ehAdmin() && conectado() && !t.exclusao ? `<button type="button" class="btn btn-perigo btn-mini" data-ficha="excluir">${svg("i-lixeira")}Excluir</button>` : "",
      podePedirExclusao(t) ? `<button type="button" class="btn btn-secundario btn-mini" data-ficha="pedir">${svg("i-lixeira")}Solicitar exclusão</button>` : "",
      `<button type="button" class="btn btn-secundario btn-mini" data-ficha="copiar">${svg("i-copiar")}Copiar</button>`,
      podeEditarLinha(t) ? `<button type="button" class="btn" data-ficha="editar">${svg("i-lapis")}Editar</button>` : ""
    ].join("");
  ficha.innerHTML = `<form class="ficha-corpo" novalidate>
    <div class="form-topo"><h2>${escapar(titulo)}</h2>
      <button type="button" class="perfil-fechar" data-ficha="fechar" aria-label="Fechar ficha">${svg("i-fechar")}</button></div>
    ${exclusao}
    ${!editar && !podeEditarLinha(t) && papel() !== "leitura" ? `<p class="apoio" style="font-size:13px">${svg("i-cadeado", "icone cadeado")} ${escapar(motivoSemEdicao(t))}</p>` : ""}
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
    pararHistorico = estado.api.ouvirColecao(`${P()}/${id}/historico`, (lista) => {
      const el = $("#ficha-historico");
      if (!el) return;
      el.innerHTML = lista.length ? lista.map((h) => {
        const quem = `<span title="${escapar(h.porEmail || (String(h.por || "").includes("@") ? h.por : ""))}">${escapar(h.porNome || nomePessoa(h.por))}</span>`;
        let oque;
        if (h.acao === "criar") oque = `registrou${h.depois ? `: ${escapar(h.depois)}` : ""}`;
        else if (h.acao === "importar" && !h.coluna) oque = "importou o registro";
        else if (h.acao === "pedirExclusao") oque = `solicitou a exclusão: ${escapar(h.depois)}`;
        else if (h.acao === "recusarExclusao") oque = "recusou o pedido de exclusão";
        else if (h.acao === "restaurar") oque = "restaurou o registro";
        else oque = `mudou <strong>${escapar(h.colunaNome || h.coluna)}</strong>: ${escapar(h.antes || "(vazio)")} → ${escapar(h.depois || "(vazio)")}`;
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
  if (a === "pedir") pedirExclusao(t);
  if (a === "recusar") recusarExclusao(t);
  if (a === "excluir") excluirParaLixeira([t], t.exclusao ? `Pedido de ${(t.exclusao.porNome || nomePessoa(t.exclusao.por))}: ${t.exclusao.motivo}` : "");
});
ficha.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = porId(ficha.dataset.id);
  if (!t || !podeEditarLinha(t)) return;
  const form = e.target;
  const cols = colunasAtivas().filter((c) => podeEditarCelula(t, c));
  const { valores, erros } = lerFormulario(form, cols);
  const conf = conferirRegistro({ ...(t.campos || {}), ...valores }, t.id);
  Object.entries(conf).forEach(([c, x]) => { if (!erros[c] && cols.some((k) => k.id === c)) erros[c] = typeof x === "object" ? x.texto : x; });
  marcarErros(form, erros);
  if (Object.keys(erros).length) { $("#ficha-erro").textContent = Object.values(erros).join(" · "); return; }
  if (await salvarCampos(t, valores)) { mostrarAviso("Registro salvo."); setTimeout(() => abrirFicha(t.id, false), 150); }
});
ficha.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); fecharFicha(); } });

function pedirExclusao(t) {
  if (!podePedirExclusao(t)) return;
  const d = criarDialogo({
    titulo: "Solicitar exclusão",
    corpo: `<p class="apoio">A linha fica marcada com “Exclusão solicitada”. Só uma administradora pode confirmar a exclusão.</p>
      <label class="campo"><span class="rotulo">Motivo *</span><textarea name="motivo" maxlength="300" rows="3" required></textarea></label>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn btn-perigo">Solicitar exclusão</button></div>`
  });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const motivo = form.motivo.value.trim().slice(0, 300);
    if (!motivo) { form.querySelector(".form-erro").textContent = "Diga o motivo."; return; }
    const ok = await gravar([
      { op: "set", caminho: `${P()}/${t.id}`, mesclar: true, dados: { exclusao: { motivo, ...autoria("por"), em: "__AGORA__" }, ...assinatura() } },
      opHistorico(t.id, "pedirExclusao", { depois: motivo })
    ]);
    if (ok) { d.close(); mostrarAviso("Pedido de exclusão enviado às administradoras."); }
  });
  d.showModal();
  form.motivo.focus();
}
async function recusarExclusao(t) {
  if (!ehAdmin() || !t.exclusao) return;
  const ok = await gravar([
    { op: "set", caminho: `${P()}/${t.id}`, mesclar: true, dados: { exclusao: null, ...assinatura() } },
    opHistorico(t.id, "recusarExclusao", { antes: t.exclusao.motivo })
  ]);
  if (ok) { registrarAuditoria("recusarExclusao", `Recusou o pedido de exclusão de ${t.numero || t.id}`, t.exclusao.motivo); mostrarAviso("Pedido de exclusão recusado."); }
}

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
 *  Auditoria própria (tickets-auditoria: só administradoras leem)
 * ------------------------------------------------------------ */
function registrarAuditoria(acao, resumo, detalhes = "") {
  if (!ehAdmin() || !estado.api) return;
  const id = estado.api.novoId(`${P()}-auditoria`);
  estado.api.salvarDoc(`${P()}-auditoria/${id}`, {
    acao: String(acao).slice(0, 40), resumo: String(resumo).slice(0, 300), detalhes: String(detalhes || "").slice(0, 1500),
    por: estado.usuario.email, em: "__AGORA__"
  }).catch((e) => console.warn("Auditoria:", e));
}

/* Registro pronto para gravar de novo (datas de controle viram "__DATA__:<ISO>") */
const marcaData = (iso) => (iso ? "__DATA__:" + iso : "__AGORA__");
function serializar(t) {
  return {
    campos: t.campos || {}, numero: t.numero || "",
    criadoPor: t.criadoPor || "", criadoEm: marcaData(t.criadoEm),
    atualizadoPor: t.atualizadoPor || "", atualizadoEm: marcaData(t.atualizadoEm),
    ...(t.criadoPorNome ? { criadoPorNome: t.criadoPorNome, criadoPorEmail: t.criadoPorEmail || "" } : {}),
    ...(t.atualizadoPorNome ? { atualizadoPorNome: t.atualizadoPorNome, atualizadoPorEmail: t.atualizadoPorEmail || "" } : {}),
    exclusao: t.exclusao ? { motivo: t.exclusao.motivo || "", por: t.exclusao.por || "", ...(t.exclusao.porNome ? { porNome: t.exclusao.porNome, porEmail: t.exclusao.porEmail || "" } : {}), em: marcaData(t.exclusao.em) } : null
  };
}

/* ------------------------------------------------------------
 *  Arquivo compactado (tickets-arquivo): centenas de linhas por documento
 *  Cada gravação completa cria uma versão nova e só depois apaga a anterior;
 *  quem está com a página aberta só passa a usar uma versão quando ela está inteira.
 * ------------------------------------------------------------ */
const LIMITE_PARTE = 600000;       // bytes de JSON por documento (o Firestore aceita até 1 MiB)
const LIMITE_PARTE_MAX = 950000;
const codificador = new TextEncoder();
const bytes = (s) => codificador.encode(s).length;
const CAMPOS_AUTORIA = ["criadoPor", "criadoPorNome", "criadoPorEmail", "criadoEm", "atualizadoPor", "atualizadoPorNome", "atualizadoPorEmail", "atualizadoEm"];
const noArquivo = (id) => estado.arquivo.parteDe.has(id);
const comCampo = (campos, c, v) => { const r = { ...(campos || {}) }; if (estaVazio(v) || v === false || v === "__APAGAR__") delete r[c]; else r[c] = v; return r; };

/* { c: [ids das colunas], l: [[id, numero, autoria ou 0, valor1, valor2…]] }; "" = vazio */
function jsonParte(lista) {
  const cols = [...new Set(lista.flatMap((t) => Object.keys(t.campos || {})))];
  return JSON.stringify({ c: cols, l: lista.map((t) => {
    const a = {};
    CAMPOS_AUTORIA.forEach((k) => { if (t[k]) a[k] = t[k]; });
    return [t.id, t.numero || "", Object.keys(a).length ? a : 0, ...cols.map((c) => { const v = (t.campos || {})[c]; return estaVazio(v) || v === false ? "" : v; })];
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
    return { ...normalizarTicket({ ...autoria, id: String(l[0]), campos, numero: String(l[1] || ""), exclusao: null }), arquivo: true };
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
  const original = base.criadoPor
    ? { criadoPor: base.criadoPor, criadoPorNome: base.criadoPorNome, criadoPorEmail: base.criadoPorEmail, criadoEm: base.criadoEm } : {};
  return { ...v, ...original, campos: { ...(base.campos || {}), ...(v.campos || {}) }, numero: v.numero || base.numero, parcial: true };
}
/* Registros vivos primeiro; cada vivo substitui (ou, se parcial, completa) a linha do arquivo de mesmo id */
function combinarTickets() {
  const vivos = new Map(estado.vivos.map((t) => [t.id, t]));
  const doArquivo = estado.arquivo.linhas.map((t) => {
    const v = vivos.get(t.id);
    if (!v) return t;
    vivos.delete(t.id);
    return v.parcial ? mesclarParcial(t, v) : v;
  });
  estado.tickets = [...vivos.values(), ...doArquivo];
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
/* Grava a lista inteira como versão nova; depois apaga as versões antigas e os registros vivos indicados */
async function gravarArquivo(lista, { apagarVivos = [] } = {}) {
  const versao = Date.now();
  const grupos = dividirArquivo(lista);
  const antigos = [...estado.arquivo.docs];
  await estado.api.lote(grupos.map((g, i) => ({ op: "set", caminho: `${P()}-arquivo/v${versao}-${String(i).padStart(3, "0")}`, dados: dadosParte(versao, i, grupos.length, jsonParte(g)) })));
  const limpeza = antigos.map((id) => ({ op: "delete", caminho: `${P()}-arquivo/${id}` }));
  apagarVivos.forEach((t) => {
    limpeza.push({ op: "delete", caminho: `${P()}/${t.id}` });
    if (t.numero) limpeza.push({ op: "delete", caminho: `${P()}-numeros/${t.numero}` });
  });
  if (limpeza.length) await estado.api.lote(limpeza);
  return grupos.length;
}
/* Troca linhas do arquivo (Map id → registro novo, ou null para tirar) regravando só as partes em que estão */
async function alterarArquivo(alterados) {
  const partes = new Set();
  alterados.forEach((_, id) => { const p = estado.arquivo.parteDe.get(id); if (p) partes.add(p); });
  if (!partes.size) return;
  const trocar = (lista) => lista.map((t) => (alterados.has(t.id) ? alterados.get(t.id) : t)).filter(Boolean);
  const ops = [];
  for (const p of partes) {
    const json = jsonParte(trocar(p.linhas));
    if (bytes(json) > LIMITE_PARTE_MAX) { await gravarArquivo(trocar(estado.arquivo.linhas)); return; }
    ops.push({ op: "set", caminho: `${P()}-arquivo/${p.id}`, dados: dadosParte(p.versao, p.indice, p.total, json) });
  }
  await estado.api.lote(ops);
}
/* Mesma coluna em vários registros: os vivos com histórico; as linhas do arquivo regravando as partes */
async function definirEmVarios(pares, col, acao) {
  const vivos = pares.filter(([t]) => !t.arquivo), doArquivo = pares.filter(([t]) => t.arquivo);
  if (vivos.length) await estado.api.lote(vivos.flatMap(([t, v]) => opsAlteracao(t, { [col.id]: v }, acao)));
  if (doArquivo.length) {
    const agora = new Date().toISOString();
    await alterarArquivo(new Map(doArquivo.map(([t, v]) => [t.id, { ...t, campos: comCampo(t.campos, col.id, v), ...autoria("atualizadoPor"), atualizadoEm: agora }])));
  }
}
/* Registro de backup (datas marcadas com "__DATA__:") → linha do arquivo */
function ticketDeRegistro(r) {
  const d = r.dados || {};
  const data = (v) => (typeof v === "string" && v.startsWith("__DATA__:") ? v.slice(9) : "");
  return normalizarTicket({ ...d, id: r.id, criadoEm: data(d.criadoEm), atualizadoEm: data(d.atualizadoEm), exclusao: null });
}
/* No backup, as linhas do arquivo vão sem os campos de autoria vazios */
function registroBackup(t) {
  if (!t.arquivo) return serializar(t);
  const r = { campos: t.campos || {}, numero: t.numero || "" };
  CAMPOS_AUTORIA.forEach((k) => { if (t[k]) r[k] = /Em$/.test(k) ? marcaData(t[k]) : t[k]; });
  return r;
}
async function compactarArquivo() {
  const vivos = estado.vivos.filter((t) => !t.exclusao);
  if (!vivos.length) { mostrarAviso("Todos os registros já estão no arquivo compactado."); return; }
  if (!(await confirmar(`Guardar ${vivos.length} registro(s) no arquivo compactado? Os dados e o histórico não mudam; abrir a planilha passa a gastar menos leituras do Firebase. Prefira um horário em que ninguém esteja editando. Linhas com pedido de exclusão ficam de fora.`, { titulo: "Compactar registros", botao: "Compactar" }))) return;
  mostrarAviso("Compactando…", 60000);
  try {
    const lista = estado.tickets.filter((t) => !t.exclusao);
    const n = await gravarArquivo(lista, { apagarVivos: vivos });
    registrarAuditoria("compactar", `Guardou ${vivos.length} registro(s) no arquivo compactado`, `${lista.length} linha(s) em ${n} documento(s)`);
    mostrarAviso(`${vivos.length} registro(s) guardados no arquivo compactado.`, 5000);
  } catch (e) { console.error(e); mostrarAviso("Não foi possível compactar. Nada se perdeu: os registros continuam onde estavam.", 8000); }
}

/* ------------------------------------------------------------
 *  Lixeira, exclusão definitiva e backups (só administradoras)
 * ------------------------------------------------------------ */
async function excluirParaLixeira(lista, motivo = "") {
  if (!ehAdmin() || !lista.length) return false;
  const varias = lista.length > 1;
  if (varias) {
    if (!(await confirmarDigitando(`Mover ${lista.length} registros para a Lixeira? Um backup é feito antes.`, `EXCLUIR ${lista.length}`, { titulo: "Excluir em massa", botao: "Excluir" }))) return false;
    if (!(await criarBackup(`Antes de excluir ${lista.length} registros`))) return false;
  } else if (!(await confirmar(`Mover o registro ${lista[0].numero || ""} para a Lixeira? Dá para restaurar depois.`, { titulo: "Excluir registro", botao: "Excluir", perigo: true }))) return false;
  const ops = [];
  lista.forEach((t) => {
    ops.push({ op: "set", caminho: `${P()}-lixeira/${t.id}`, dados: { dados: serializar(t), excluidoPor: estado.usuario.email, excluidoEm: "__AGORA__", motivo: String(motivo).slice(0, 300) } });
    if (t.arquivo) return;
    ops.push({ op: "delete", caminho: `${P()}/${t.id}` });
    if (t.numero) ops.push({ op: "delete", caminho: `${P()}-numeros/${t.numero}` });
  });
  const ids = lista.map((t) => t.id);
  const ok = await gravar(ops, { rotulo: "Registros restaurados da Lixeira", desfazer: async () => restaurarDaLixeira(ids, { silencioso: true }) });
  if (ok) {
    try { await alterarArquivo(new Map(lista.filter((t) => noArquivo(t.id)).map((t) => [t.id, null]))); }
    catch (e) { console.error(e); mostrarAviso("Os registros foram para a Lixeira, mas não saíram do arquivo compactado. Tente excluir de novo.", 8000); return false; }
    registrarAuditoria("excluir", `Moveu ${lista.length} registro(s) para a Lixeira`, [motivo, lista.map((t) => t.numero || t.id).join(", ")].filter(Boolean).join(" · "));
    estado.selecionados.clear();
    if (lista.some((t) => t.id === ficha.dataset.id)) fecharFicha();
    mostrarAviso(`${lista.length} registro(s) na Lixeira. Use Desfazer se foi sem querer.`, 5000);
  }
  return ok;
}
async function excluirDeVez(lista, motivo = "", { semAuditoria = false } = {}) {
  if (!ehAdmin() || !lista.length) return true;
  const ops = [];
  const soNoArquivo = new Set(estado.tickets.filter((t) => t.arquivo).map((t) => t.id));
  lista.forEach((t) => {
    if (soNoArquivo.has(t.id)) return;
    ops.push({ op: "delete", caminho: `${P()}/${t.id}` });
    if (t.numero) ops.push({ op: "delete", caminho: `${P()}-numeros/${t.numero}` });
  });
  try {
    await estado.api.lote(ops);
    await alterarArquivo(new Map(lista.filter((t) => noArquivo(t.id)).map((t) => [t.id, null])));
    if (!semAuditoria) registrarAuditoria("excluirDeVez", `Excluiu de vez ${lista.length} registro(s)`, motivo);
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}
async function restaurarDaLixeira(ids, { silencioso = false } = {}) {
  const itens = ids.map((id) => estado.lixeira.find((x) => x.id === id)).filter(Boolean);
  if (!itens.length) {
    for (const id of ids) { const doc = await estado.api.lerDoc(`${P()}-lixeira/${id}`); if (doc) itens.push({ id, ...doc }); }
  }
  if (!itens.length) return false;
  const usados = new Set(estado.tickets.map((t) => t.numero).filter(Boolean));
  const ops = [];
  let conflitos = 0;
  itens.forEach((x) => {
    const dados = serializar({ ...x.dados });
    if (dados.numero && usados.has(dados.numero)) { dados.numero = ""; conflitos++; }
    if (dados.numero) { usados.add(dados.numero); ops.push({ op: "set", caminho: `${P()}-numeros/${dados.numero}`, dados: { ticket: x.id } }); }
    dados.exclusao = null;
    ops.push({ op: "set", caminho: `${P()}/${x.id}`, dados });
    ops.push({ op: "delete", caminho: `${P()}-lixeira/${x.id}` });
    ops.push(opHistorico(x.id, "restaurar"));
  });
  try {
    await estado.api.lote(ops);
    registrarAuditoria("restaurar", `Restaurou ${itens.length} registro(s) da Lixeira`, itens.map((x) => (x.dados && x.dados.numero) || x.id).join(", "));
    if (!silencioso || conflitos) mostrarAviso(`${itens.length} registro(s) restaurado(s).${conflitos ? ` ${conflitos} voltaram sem o índice do Nº do ticket porque o número já está em uso.` : ""}`, 6000);
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}
/* Backup: estrutura + todos os registros, em partes de até ~600 KB (cada parte < 1 MB) */
async function criarBackup(motivo) {
  if (!ehAdmin()) return null;
  try {
    const id = estado.api.novoId(`${P()}-backups`);
    const registros = estado.tickets.map((t) => ({ id: t.id, dados: registroBackup(t) }));
    const partes = [];
    let atual = [], tamanho = 0;
    registros.forEach((r) => {
      const n = bytes(JSON.stringify(r)) + 1;
      if (atual.length && tamanho + n > LIMITE_PARTE) { partes.push(atual); atual = []; tamanho = 0; }
      atual.push(r); tamanho += n;
    });
    if (atual.length) partes.push(atual);
    const ops = [{ op: "set", caminho: `${P()}-backups/${id}`, dados: {
      motivo: String(motivo).slice(0, 200), criadoPor: estado.usuario.email, criadoEm: "__AGORA__",
      totalRegistros: registros.length, partes: partes.length, versaoEstrutura: estado.estrutura ? estado.estrutura.versao : 0,
      estrutura: JSON.stringify(estado.estrutura ? dadosEstruturaBackup(estado.estrutura) : null)
    } }];
    partes.forEach((p, i) => ops.push({ op: "set", caminho: `${P()}-backups/${id}/partes/${i}`, dados: { indice: i, json: JSON.stringify(p) } }));
    await estado.api.lote(ops);
    registrarAuditoria("backup", `Backup automático: ${motivo}`, `${registros.length} registro(s), ${partes.length} parte(s)`);
    return id;
  } catch (e) {
    console.error(e);
    mostrarAviso("Não foi possível fazer o backup. Nada foi alterado.", 6000);
    return null;
  }
}
const dadosEstruturaBackup = (e) => { const { atualizadoEm, atualizadoPor, ...resto } = e; return resto; };
async function lerBackup(b) {
  const partes = await estado.api.lerColecao(`${P()}-backups/${b.id}/partes`);
  const registros = partes.sort((x, y) => x.indice - y.indice).flatMap((p) => JSON.parse(p.json || "[]"));
  return { estrutura: JSON.parse(b.estrutura || "null"), registros };
}
const RE_ID_DOC = /^[A-Za-z0-9_-]{1,100}$/;
/* Substitui estrutura e registros pelos do backup. Os registros vão para o arquivo compactado;
   só os que têm pedido de exclusão voltam como registros vivos. Sem "regras" no backup, ficam as atuais. */
async function aplicarBackup({ estrutura, registros }, descricao) {
  const base = estrutura && typeof estrutura === "object" && !estrutura.regras && estado.estrutura ? { ...estrutura, regras: estado.estrutura.regras } : estrutura;
  const est = normalizarEstrutura(base);
  if (!est || !est.colunas.length) { mostrarAviso("Backup sem estrutura válida."); return false; }
  const validos = (Array.isArray(registros) ? registros : []).filter((r) => r && typeof r.id === "string" && RE_ID_DOC.test(r.id) && r.dados && typeof r.dados === "object");
  if (!(await criarBackup(`Antes de restaurar ${descricao}`))) return false;
  mostrarAviso("Restaurando… não feche a página.", 120000);
  const vivos = validos.filter((r) => r.dados.exclusao);
  const manter = new Set(vivos.map((r) => r.id));
  est.versao = (estado.estrutura ? estado.estrutura.versao : 0) + 1;
  await estado.api.salvarDoc(`${P()}-config/estrutura`, dadosEstrutura(est));
  const partes = await gravarArquivo(validos.filter((r) => !r.dados.exclusao).map(ticketDeRegistro), { apagarVivos: estado.vivos.filter((t) => !manter.has(t.id)) });
  if (vivos.length) {
    await estado.api.lote(vivos.flatMap((r) => [
      { op: "set", caminho: `${P()}/${r.id}`, dados: r.dados },
      ...(r.dados.numero ? [{ op: "set", caminho: `${P()}-numeros/${r.dados.numero}`, dados: { ticket: r.id } }] : [])
    ]));
  }
  registrarAuditoria("restaurarBackup", `Restaurou ${descricao}`, `${validos.length} registro(s) em ${partes} documento(s) do arquivo${validos.length < (registros || []).length ? ` · ${(registros || []).length - validos.length} ignorado(s) por id inválido` : ""}`);
  mostrarAviso(`Pronto: ${validos.length.toLocaleString("pt-BR")} registro(s) carregados.`, 6000);
  return true;
}
async function restaurarBackup(b) {
  if (!(await confirmarDigitando(`A planilha volta a ficar como estava em ${formatarData(b.criadoEm, true)} (${b.totalRegistros} registros). Antes, é feito um backup do estado atual.`, "RESTAURAR", { titulo: "Restaurar backup", botao: "Restaurar" }))) return;
  mostrarAviso("Restaurando…", 10000);
  try {
    const { estrutura, registros } = await lerBackup(b);
    await aplicarBackup({ estrutura, registros }, `o backup de ${formatarData(b.criadoEm, true)}`);
  } catch (e) { console.error(e); mostrarAviso("Não foi possível restaurar o backup. Se algo ficou pela metade, restaure o backup automático feito antes.", 8000); }
}
/* Arquivo .json no formato do botão "JSON" dos backups (também serve para importar uma planilha convertida) */
function restaurarDeArquivo() {
  const entrada = document.createElement("input");
  entrada.type = "file";
  entrada.accept = ".json,application/json";
  entrada.addEventListener("change", async () => {
    const f = entrada.files[0];
    if (!f) return;
    let dados;
    try { dados = JSON.parse(await f.text()); } catch (e) { mostrarAviso("Esse arquivo não é um JSON válido."); return; }
    if (!dados || !Array.isArray(dados.registros) || !dados.estrutura) { mostrarAviso("O arquivo não tem estrutura e registros de um backup do Banco de Tickets."); return; }
    const est = normalizarEstrutura(dados.estrutura);
    if (!est || !est.colunas.length) { mostrarAviso("O arquivo não tem uma estrutura válida."); return; }
    const texto = `Carregar “${f.name}”: ${dados.registros.length.toLocaleString("pt-BR")} registro(s) e ${est.colunas.filter((c) => c.ativa).length} coluna(s)${dados.motivo ? ` (${String(dados.motivo).slice(0, 200)})` : ""}. A estrutura e os ${estado.tickets.length.toLocaleString("pt-BR")} registro(s) atuais são substituídos; antes, é feito um backup.${dados.estrutura.regras ? "" : " As regras da equipe continuam as atuais."}`;
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
    baixarArquivo(`banco-de-tickets-backup-${p.ano}-${p.mes}-${p.dia}-${p.hora}${p.minuto}.json`,
      JSON.stringify({ criadoEm: b.criadoEm, criadoPor: b.criadoPor, motivo: b.motivo, estrutura, registros }, null, 2), "application/json;charset=utf-8");
  } catch (e) { console.error(e); mostrarAviso("Não foi possível baixar o backup."); }
}
async function abrirBackups() {
  const d = criarDialogo({ titulo: "Backups", largo: true, corpo: `<p class="apoio">Feitos automaticamente antes de mudanças na estrutura, exclusões em massa e restaurações. Também dá para fazer um agora.</p>
    <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-secundario btn-mini" data-bk="agora">${svg("i-salvar")}Fazer backup agora</button>
      <button type="button" class="btn btn-secundario btn-mini" data-bk="arquivo">${svg("i-upload")}Restaurar de um arquivo (.json)</button></div>
    <div class="tabela-admin" id="lista-backups"><p class="apoio" style="padding:12px">Carregando…</p></div>` });
  d.showModal();
  let lista = [];
  const desenhar = async () => {
    try { lista = await estado.api.lerColecao(`${P()}-backups`, { ordenar: "criadoEm", desc: true, limite: 50 }); }
    catch (e) { $("#lista-backups", d).innerHTML = `<p class="apoio" style="padding:12px">Não foi possível carregar.</p>`; return; }
    const antesV2 = lista.find((b) => b.motivo === MOTIVO_BACKUP_V2);
    $("#lista-backups", d).innerHTML = (antesV2 ? `<div class="aviso-repetido" style="margin:8px">${svg("i-restaurar")}<span>Backup de antes da nova estrutura (v2): ${escapar(formatarData(antesV2.criadoEm, true))}, ${escapar(antesV2.totalRegistros)} registro(s).</span>
      <button type="button" class="btn btn-secundario btn-mini" data-bk="restaurar" data-id="${escapar(antesV2.id)}">Restaurar o backup de antes da v2</button></div>` : "") + (lista.length ? `<table><thead><tr><th>Quando</th><th>Motivo</th><th>Por</th><th>Registros</th><th></th></tr></thead><tbody>${lista.map((b) => `<tr>
      <td>${escapar(formatarData(b.criadoEm, true))}</td><td>${escapar(b.motivo)}</td><td>${escapar(nomePessoa(b.criadoPor))}</td><td>${escapar(b.totalRegistros)}</td>
      <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-bk="baixar" data-id="${escapar(b.id)}">${svg("i-download")}JSON</button>
        <button type="button" class="btn btn-secundario btn-mini" data-bk="restaurar" data-id="${escapar(b.id)}">${svg("i-restaurar")}Restaurar</button>
        <button type="button" class="acao-linha" data-bk="apagar" data-id="${escapar(b.id)}" title="Apagar este backup" aria-label="Apagar este backup">${svg("i-lixeira")}</button></td></tr>`).join("")}</tbody></table>` : `<p class="apoio" style="padding:12px">Nenhum backup ainda.</p>`);
  };
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-bk]");
    if (!b) return;
    const item = lista.find((x) => x.id === b.dataset.id);
    if (b.dataset.bk === "agora") { if (await criarBackup("Backup manual")) { mostrarAviso("Backup feito."); desenhar(); } }
    if (b.dataset.bk === "arquivo") { d.close(); restaurarDeArquivo(); }
    if (b.dataset.bk === "baixar" && item) baixarBackup(item);
    if (b.dataset.bk === "restaurar" && item) { d.close(); restaurarBackup(item); }
    if (b.dataset.bk === "apagar" && item && await confirmar(`Apagar o backup de ${formatarData(item.criadoEm, true)}?`, { titulo: "Apagar backup", botao: "Apagar", perigo: true })) {
      const partes = await estado.api.lerColecao(`${P()}-backups/${item.id}/partes`);
      await estado.api.lote([...partes.map((p) => ({ op: "delete", caminho: `${P()}-backups/${item.id}/partes/${p.id}` })), { op: "delete", caminho: `${P()}-backups/${item.id}` }]);
      registrarAuditoria("apagarBackup", `Apagou o backup de ${formatarData(item.criadoEm, true)}`);
      desenhar();
    }
  });
  desenhar();
}
function abrirLixeira() {
  const d = criarDialogo({ titulo: "Lixeira", largo: true, corpo: `<p class="apoio">Registros excluídos. Restaurar devolve a linha à planilha; excluir de vez não tem volta.</p><div class="tabela-admin" id="lista-lixeira"></div>` });
  const numeroDe = (x) => (x.dados && ((x.dados.campos && x.dados.campos[idChave()]) || x.dados.numero)) || x.id;
  const desenhar = () => {
    const lista = [...estado.lixeira].sort((a, b) => String(b.excluidoEm).localeCompare(String(a.excluidoEm)));
    $("#lista-lixeira", d).innerHTML = lista.length ? `<table><thead><tr><th>Nº do ticket</th><th>Resumo</th><th>Excluído em</th><th>Por</th><th>Motivo</th><th></th></tr></thead><tbody>${lista.map((x) => `<tr>
      <td>${escapar(numeroDe(x))}</td><td>${escapar(((x.dados || {}).campos || {}).resumo || "")}</td><td>${escapar(formatarData(x.excluidoEm, true))}</td><td>${escapar(nomePessoa(x.excluidoPor))}</td><td>${escapar(x.motivo || "")}</td>
      <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-lx="restaurar" data-id="${escapar(x.id)}">${svg("i-restaurar")}Restaurar</button>
        <button type="button" class="btn btn-perigo btn-mini" data-lx="apagar" data-id="${escapar(x.id)}">Excluir de vez</button></td></tr>`).join("")}</tbody></table>` : `<p class="apoio" style="padding:12px">A Lixeira está vazia.</p>`;
  };
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-lx]");
    if (!b) return;
    const x = estado.lixeira.find((y) => y.id === b.dataset.id);
    if (!x) return;
    if (b.dataset.lx === "restaurar") { if (await restaurarDaLixeira([x.id])) desenhar(); }
    if (b.dataset.lx === "apagar" && await confirmarDigitando(`Excluir de vez o registro ${numeroDe(x)}? Não tem volta.`, String(numeroDe(x)), { titulo: "Excluir de vez", botao: "Excluir de vez" })) {
      try { await estado.api.lote([{ op: "delete", caminho: `${P()}-lixeira/${x.id}` }]); registrarAuditoria("excluirDeVez", `Excluiu de vez da Lixeira o registro ${numeroDe(x)}`); }
      catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); }
    }
  });
  estado.aoMudarLixeira = desenhar;
  d.addEventListener("close", () => { estado.aoMudarLixeira = null; });
  desenhar();
  d.showModal();
}
async function abrirAuditoria() {
  const d = criarDialogo({ titulo: "Auditoria do Banco de Tickets", largo: true, corpo: `<p class="apoio">Mudanças de estrutura, exclusões, pessoas, importações e restaurações (últimos 300 eventos). O histórico de cada linha fica na ficha do registro.</p><div class="tabela-admin" id="lista-auditoria"><p class="apoio" style="padding:12px">Carregando…</p></div>` });
  d.showModal();
  try {
    const lista = await estado.api.lerColecao(`${P()}-auditoria`, { ordenar: "em", desc: true, limite: 300 });
    $("#lista-auditoria", d).innerHTML = lista.length ? `<table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Resumo</th><th>Detalhes</th></tr></thead><tbody>${lista.map((a) => `<tr><td>${escapar(formatarData(a.em, true))}</td><td>${escapar(nomePessoa(a.por))}</td><td>${escapar(a.acao)}</td><td>${escapar(a.resumo)}</td><td style="max-width:320px;overflow-wrap:anywhere">${escapar(a.detalhes)}</td></tr>`).join("")}</tbody></table>` : `<p class="apoio" style="padding:12px">Sem eventos.</p>`;
  } catch (e) { $("#lista-auditoria", d).innerHTML = `<p class="apoio" style="padding:12px">Não foi possível carregar.</p>`; }
}

/* ------------------------------------------------------------
 *  Seleção, edição em massa e exclusão em massa (administradoras)
 * ------------------------------------------------------------ */
function alternarSelecao(id, marcar) {
  if (marcar) estado.selecionados.add(id); else estado.selecionados.delete(id);
  renderizarSelecao();
  pintarLinhas(true);
}
function renderizarSelecao() {
  const barra = $("#barra-selecao");
  if (!ehAdmin() || !estado.selecionando) { barra.hidden = true; return; }
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
      ? `<div style="display:flex;flex-wrap:wrap;gap:8px 14px">${opcoesDe(c).map((o) => `<label class="check"><input type="checkbox" name="valor" value="${escapar(o.id)}"> ${escapar(o.nome)}</label>`).join("")}</div>`
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
      registrarAuditoria("editarMassa", `Definiu ${c.nome} = “${textoDoValor(c, r.valor)}” em ${lista.length} registro(s)`);
      d.close(); mostrarAviso(`${lista.length} registro(s) atualizados.`);
    }
  });
  d.showModal();
}

/* ------------------------------------------------------------
 *  Pessoas (quem se registrou em "Se registre como:")
 *  Só administradoras: mudar papel e bloquear/desbloquear.
 * ------------------------------------------------------------ */
const RE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
function abrirPessoas() {
  const d = criarDialogo({
    titulo: "Pessoas",
    largo: true,
    corpo: `<p class="lgpd"><strong>Atenção:</strong> a identificação é declarada pela própria pessoa (não há confirmação de e-mail). Antes de liberar um registro, confirme com a pessoa (por exemplo, pelo Teams) que foi ela mesma.</p>
      <p class="apoio">Lays e Paula são administradoras fixas e entram com senha. Bloquear impede a pessoa de ver e de gravar na hora.</p>
      <div class="barra">
        <label class="busca"><span class="sr-only">Buscar pessoa</span>${svg("i-busca")}<input type="search" name="buscaPessoa" placeholder="Buscar por nome ou e-mail…" autocomplete="off"></label>
        <label class="sr-only" for="filtro-pessoas">Filtrar</label>
        <select id="filtro-pessoas" name="filtroPessoa"><option value="">Todas</option><option value="aguardando">Aguardando liberação</option><option value="ativas">Ativas</option><option value="bloqueadas">Bloqueadas</option><option value="equipe">Equipe</option><option value="leitura">Leitura</option></select>
        <span class="contagem" id="contagem-pessoas"></span>
      </div>
      <div class="tabela-admin" id="lista-pessoas"></div>
      <p class="form-erro" role="alert" id="pessoas-erro"></p>`
  });
  const form = d.querySelector("form");
  form.addEventListener("submit", (e) => e.preventDefault());
  const contarRegistros = (id) => estado.tickets.filter((t) => t.criadoPor === id).length;
  const desenhar = () => {
    const termo = normalizar(form.buscaPessoa.value);
    const filtro = form.filtroPessoa.value;
    const lista = [...estado.pessoas]
      .filter((p) => !termo || normalizar(`${p.nome} ${p.email}`).includes(termo))
      .filter((p) => !filtro || (filtro === "aguardando" ? p.pendente : filtro === "ativas" ? p.ativo : filtro === "bloqueadas" ? !p.ativo && !p.pendente : p.papel === filtro))
      .sort((a, b) => (b.pendente ? 1 : 0) - (a.pendente ? 1 : 0) || String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));
    $("#contagem-pessoas", d).textContent = `${lista.length} de ${estado.pessoas.length} pessoa(s)`;
    $("#lista-pessoas", d).innerHTML = `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Criado em</th><th>Último acesso</th><th>Registros</th><th></th></tr></thead><tbody>
      ${lista.map((p) => `<tr data-pessoa="${escapar(p.id)}"${p.ativo ? "" : ' class="arquivada"'}>
        <td>${escapar(p.nome)}</td><td>${escapar(p.email)}</td>
        <td><select data-papel aria-label="Papel de ${escapar(p.nome)}"><option value="equipe"${p.papel === "equipe" ? " selected" : ""}>Equipe</option><option value="leitura"${p.papel === "leitura" ? " selected" : ""}>Leitura</option></select></td>
        <td>${p.pendente ? '<span class="selo-exclusao">Aguardando liberação</span>' : p.ativo ? '<span class="selo papel-equipe">Ativa</span>' : '<span class="selo-exclusao">Bloqueada</span>'}</td>
        <td>${escapar(formatarData(p.criadoEm, true))}</td><td>${escapar(p.ultimoAcesso ? formatarData(p.ultimoAcesso, true) : "—")}</td>
        <td>${contarRegistros(p.id)}</td>
        <td class="acoes-tab">${p.pendente
          ? `<button type="button" class="btn btn-mini" data-liberar>Liberar</button><button type="button" class="btn btn-perigo btn-mini" data-recusar>Recusar</button>`
          : `<button type="button" class="btn ${p.ativo ? "btn-perigo" : "btn-secundario"} btn-mini" data-bloquear>${p.ativo ? "Bloquear" : "Desbloquear"}</button>`}</td></tr>`).join("")
        || `<tr><td colspan="8" class="apoio">${estado.pessoas.length ? "Ninguém com esses filtros." : "Ninguém se registrou ainda."}</td></tr>`}
      </tbody></table>`;
  };
  form.buscaPessoa.addEventListener("input", desenhar);
  form.filtroPessoa.addEventListener("change", desenhar);
  const salvar = async (p, dados, texto) => {
    const erro = $("#pessoas-erro", d);
    erro.textContent = "";
    try {
      await estado.api.salvarDoc(`tickets-pessoas/${p.id}`, dados, true);
      registrarAuditoria("pessoa", `${texto}: ${p.nome} (${p.email})`);
      mostrarAviso(`${texto}: ${p.nome}.`);
    } catch (err) { console.error(err); erro.textContent = mensagemErro(err); desenhar(); }
  };
  d.addEventListener("change", (e) => {
    if (!e.target.matches("[data-papel]")) return;
    const p = estado.pessoas.find((x) => x.id === e.target.closest("[data-pessoa]").dataset.pessoa);
    if (p) salvar(p, { papel: e.target.value === "leitura" ? "leitura" : "equipe" }, e.target.value === "leitura" ? "Mudou para Leitura" : "Mudou para Equipe");
  });
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-bloquear], [data-liberar], [data-recusar]");
    if (!b) return;
    const p = estado.pessoas.find((x) => x.id === b.closest("[data-pessoa]").dataset.pessoa);
    if (!p) return;
    if (b.matches("[data-liberar]")) { salvar(p, { ativo: true, pendente: false }, "Liberou o acesso"); return; }
    if (b.matches("[data-recusar]")) {
      if (await confirmar(`Recusar o registro de ${p.nome} (${p.email})? A pessoa fica bloqueada; dá para desbloquear depois.`, { titulo: "Recusar registro", botao: "Recusar", perigo: true })) salvar(p, { ativo: false, pendente: false }, "Recusou o registro");
      return;
    }
    if (p.ativo && !(await confirmar(`Bloquear ${p.nome} (${p.email})? A pessoa deixa de ver e de gravar na hora.`, { titulo: "Bloquear pessoa", botao: "Bloquear", perigo: true }))) return;
    salvar(p, { ativo: !p.ativo }, p.ativo ? "Bloqueou" : "Desbloqueou");
  });
  estado.aoMudarPessoas = desenhar;
  d.addEventListener("close", () => { estado.aoMudarPessoas = null; });
  desenhar();
  d.showModal();
}

/* ------------------------------------------------------------
 *  Estrutura (modo "Estrutura": só administradoras)
 *  Tudo é editado num rascunho; "Aplicar" mostra a prévia, faz backup,
 *  migra os dados (conversões, opções e categorias movidas, colunas
 *  excluídas) e só então grava a estrutura nova.
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

function abrirEstrutura() {
  if (!ehAdmin() || !estado.estrutura) return;
  const original = JSON.parse(JSON.stringify(estado.estrutura));
  const r = JSON.parse(JSON.stringify(estado.estrutura));
  const migracoes = [];
  let aba = "colunas";
  const d = criarDialogo({
    titulo: "Estrutura da planilha",
    largo: true,
    corpo: `<p class="lgpd">${escapar(AVISO_LGPD_COLUNAS)}</p>
      <div class="abas-dialogo" role="tablist">${[["colunas", "Colunas"], ["categorias", "Categorias"], ["grupos", "Grupos de colunas"], ["regras", "Título e regras da equipe"]].map(([id, nome]) => `<button type="button" role="tab" data-aba-est="${id}">${nome}</button>`).join("")}</div>
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
          <td style="font-size:12px">${[TIPOS_SEM_EDICAO.includes(c.tipo) ? "" : acessoDe(c).toUpperCase(), c.obrigatoria && "obrigatória", c.unica && "única", c.padrao && `padrão: ${c.padrao}`].filter(Boolean).map(escapar).join(" · ")}</td>
          <td>${c.ativa ? "Ativa" : "Arquivada"}</td>
          <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-est="editar-coluna">${svg("i-lapis")}Editar</button>
            <button type="button" class="btn btn-secundario btn-mini" data-est="arquivar-coluna">${svg("i-arquivo")}${c.ativa ? "Arquivar" : "Reativar"}</button>
            <button type="button" class="acao-linha" data-est="excluir-coluna" title="Excluir de vez" aria-label="Excluir de vez ${escapar(c.nome)}">${svg("i-lixeira")}</button></td></tr>`).join("")}</tbody></table></div>`;
    } else if (aba === "categorias") {
      const cats = [...r.categorias].sort((a, b) => a.ordem - b.ordem);
      alvo.innerHTML = `<div class="form-botoes" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn btn-mini" data-est="nova-categoria">${svg("i-mais")}Nova categoria</button></div>
        <div class="tabela-admin"><table><thead><tr><th>Ordem</th><th>Nome</th><th>Cor</th><th>Ativa</th><th>Registros</th><th></th></tr></thead><tbody>${cats.map((c) => `<tr data-cat="${escapar(c.id)}"${c.ativa ? "" : ' class="arquivada"'}>
          <td class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-est="cat-subir" aria-label="Subir">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-est="cat-descer" aria-label="Descer">${svg("i-seta-baixo")}</button></td>
          <td><input data-cat-campo="nome" value="${escapar(c.nome)}" maxlength="60" aria-label="Nome da categoria"></td>
          <td><select data-cat-campo="cor" aria-label="Cor">${["", ...CORES].map((x) => `<option value="${x}"${c.cor === x ? " selected" : ""}>${x ? NOME_COR[x] : "Sem cor"}</option>`).join("")}</select></td>
          <td><input type="checkbox" data-cat-campo="ativa"${c.ativa ? " checked" : ""} aria-label="Ativa (desmarque para arquivar)"></td>
          <td>${colCategoria() ? contarUso(colCategoria().id, c.id) : 0}</td>
          <td class="acoes-tab"><button type="button" class="acao-linha" data-est="excluir-categoria" title="Excluir" aria-label="Excluir ${escapar(c.nome)}">${svg("i-lixeira")}</button></td></tr>`).join("")}</tbody></table></div>`;
    } else if (aba === "grupos") {
      const gs = [...r.gruposColunas].sort((a, b) => a.ordem - b.ordem);
      alvo.innerHTML = `<div class="form-botoes" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn btn-mini" data-est="novo-grupo">${svg("i-mais")}Novo grupo</button></div>
        <div class="tabela-admin"><table><thead><tr><th>Ordem</th><th>Nome</th><th>Colunas</th><th></th></tr></thead><tbody>${gs.map((g) => `<tr data-grupo-est="${escapar(g.id)}">
          <td class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-est="grupo-subir" aria-label="Subir">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-est="grupo-descer" aria-label="Descer">${svg("i-seta-baixo")}</button></td>
          <td><input data-grupo-campo="nome" value="${escapar(g.nome)}" maxlength="60" aria-label="Nome do grupo"></td>
          <td>${r.colunas.filter((c) => c.grupo === g.id).length}</td>
          <td class="acoes-tab"><button type="button" class="acao-linha" data-est="excluir-grupo" aria-label="Excluir grupo">${svg("i-lixeira")}</button></td></tr>`).join("")}</tbody></table></div>`;
    } else {
      alvo.innerHTML = `<div class="campos-linha" style="margin-top:10px">
        <label class="campo"><span class="rotulo">Título da planilha</span><input data-regra="titulo" value="${escapar(r.titulo)}" maxlength="80"></label>
        <label class="campo"><span class="rotulo">A equipe edita</span><select data-regra="equipeEdita">${EQUIPE_EDITA.map((x) => `<option value="${x.id}"${r.regras.equipeEdita === x.id ? " selected" : ""}>${escapar(x.nome)}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Janela de edição (horas; 0 = sem limite)</span><input data-regra="janelaEdicaoHoras" type="number" min="0" max="8760" value="${escapar(r.regras.janelaEdicaoHoras)}"><span class="ajuda">Vale para “só as linhas que a própria pessoa registrou”.</span></label>
        <label class="check" style="align-self:center"><input type="checkbox" data-regra="exportacao"${r.regras.exportacao ? " checked" : ""}> A equipe pode exportar CSV</label></div>
        <p class="lgpd" style="margin-top:10px">No modo “próprias”, a pessoa só edita o que registrou NESTE navegador. Se ela limpar o navegador ou trocar de computador, peça a uma administradora para editar ou use o modo “todas”.</p>
        <h3 style="font-size:15px;margin-top:14px">Quem pode se registrar</h3>
        <div class="campos-linha" style="margin-top:8px">
          <label class="check" style="align-self:start"><input type="checkbox" data-registro="aberto"${r.regras.registro.aberto ? " checked" : ""}> Permitir novos registros</label>
          <label class="check" style="align-self:start"><input type="checkbox" data-registro="aprovacao"${r.regras.registro.aprovacao ? " checked" : ""}> Novos registros só entram depois de liberados em Pessoas</label>
          <label class="campo"><span class="rotulo">Papel de quem se registra</span><select data-registro="papelPadrao"><option value="equipe"${r.regras.registro.papelPadrao === "equipe" ? " selected" : ""}>Equipe (vê, pesquisa e alimenta)</option><option value="leitura"${r.regras.registro.papelPadrao === "leitura" ? " selected" : ""}>Leitura (só vê e pesquisa)</option></select></label>
          <label class="campo"><span class="rotulo">Domínios de e-mail permitidos (um por linha)</span><textarea data-registro="dominios" rows="3" placeholder="valid.com&#10;empresa-parceira.com.br">${escapar(r.regras.registro.dominios.join("\n"))}</textarea><span class="ajuda">Vazio = qualquer domínio. Quem já se registrou não é afetado; para tirar alguém, bloqueie em Pessoas.</span></label>
        </div>`;
    }
    const n = migracoes.length;
    $("#est-pendente", d).textContent = n ? `${n} mudança(s) nos dados pendente(s) (conversões, opções, categorias ou colunas excluídas).` : "";
  };
  const mover = (lista, id, delta, chave = "id") => {
    const ord = [...lista].sort((a, b) => a.ordem - b.ordem);
    const i = ord.findIndex((x) => x[chave] === id), j = i + delta;
    if (i < 0 || j < 0 || j >= ord.length) return;
    [ord[i].ordem, ord[j].ordem] = [ord[j].ordem, ord[i].ordem];
  };
  d.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.catCampo) { const c = r.categorias.find((x) => x.id === t.closest("[data-cat]").dataset.cat); if (t.dataset.catCampo === "ativa") c.ativa = t.checked; else c[t.dataset.catCampo] = t.value.slice(0, 60); }
    if (t.dataset.grupoCampo) { const g = r.gruposColunas.find((x) => x.id === t.closest("[data-grupo-est]").dataset.grupoEst); g.nome = t.value.slice(0, 60); }
    if (t.dataset.regra) {
      if (t.dataset.regra === "titulo") r.titulo = t.value.slice(0, 80);
      else if (t.dataset.regra === "exportacao") r.regras.exportacao = t.checked;
      else if (t.dataset.regra === "janelaEdicaoHoras") r.regras.janelaEdicaoHoras = Math.max(0, Math.min(8760, Math.floor(Number(t.value) || 0)));
      else r.regras[t.dataset.regra] = t.value;
    }
    if (t.dataset.registro) {
      const g = r.regras.registro;
      if (t.dataset.registro === "aberto") g.aberto = t.checked;
      else if (t.dataset.registro === "aprovacao") g.aprovacao = t.checked;
      else if (t.dataset.registro === "papelPadrao") g.papelPadrao = t.value === "leitura" ? "leitura" : "equipe";
      else g.dominios = normalizarRegistro({ dominios: t.value.split(/[\n,;\s]+/) }).dominios;
    }
  });
  d.addEventListener("change", (e) => { if (e.target.dataset.catCampo === "ativa" || e.target.dataset.catCampo === "cor") { e.target.dispatchEvent(new Event("input", { bubbles: true })); desenhar(); } });
  d.addEventListener("click", async (e) => {
    const ab = e.target.closest("[data-aba-est]");
    if (ab) { aba = ab.dataset.abaEst; desenhar(); return; }
    const b = e.target.closest("[data-est]");
    if (!b) return;
    const a = b.dataset.est;
    const linhaCol = b.closest("[data-col]");
    const col = linhaCol && r.colunas.find((c) => c.id === linhaCol.dataset.col);
    if (a === "nova-coluna") editarColuna(null);
    if (a === "editar-coluna" && col) editarColuna(col);
    if ((a === "subir" || a === "descer") && col) {
      renumerar();
      const mesmas = ordenadas().filter((c) => c.grupo === col.grupo);
      const i = mesmas.indexOf(col), j = i + (a === "subir" ? -1 : 1);
      if (j >= 0 && j < mesmas.length) [mesmas[i].ordem, mesmas[j].ordem] = [mesmas[j].ordem, mesmas[i].ordem];
      desenhar();
    }
    if (a === "arquivar-coluna" && col) {
      if (col.id === idChave() && col.ativa && !(await confirmar(`Arquivar “${col.nome}” desliga a conferência de valor repetido. Continuar?`, { titulo: "Arquivar coluna" }))) return;
      col.ativa = !col.ativa; desenhar();
    }
    if (a === "excluir-coluna" && col) {
      const usados = estado.tickets.filter((t) => !estaVazio((t.campos || {})[col.id])).length;
      if (!(await confirmarDigitando(`Excluir de vez a coluna “${col.nome}”? ${usados} registro(s) perdem esse valor. Um backup é feito antes de aplicar. Para só esconder, use Arquivar.`, col.nome, { titulo: "Excluir coluna de vez", botao: "Excluir coluna" }))) return;
      r.colunas = r.colunas.filter((c) => c !== col);
      r.colunas.forEach((c) => { if (c.tipo === "derivado") { if (c.de === col.id) c.de = ""; if (c.ate === col.id) c.ate = ""; } });
      if (original.colunas.some((c) => c.id === col.id)) migracoes.push({ tipo: "excluirColuna", col: col.id, nome: col.nome });
      desenhar();
    }
    if (a === "nova-categoria") {
      const nome = prompt("Nome da nova categoria:");
      if (!nome || !nome.trim()) return;
      r.categorias.push({ id: idUnico(nome, r.categorias.map((c) => c.id)), nome: nome.trim().slice(0, 60), cor: "", icone: "", ordem: Math.max(0, ...r.categorias.map((c) => c.ordem)) + 1, ativa: true });
      desenhar();
    }
    const linhaCat = b.closest("[data-cat]");
    const cat = linhaCat && r.categorias.find((c) => c.id === linhaCat.dataset.cat);
    if ((a === "cat-subir" || a === "cat-descer") && cat) { mover(r.categorias, cat.id, a === "cat-subir" ? -1 : 1); desenhar(); }
    if (a === "excluir-categoria" && cat) {
      const outras = r.categorias.filter((c) => c !== cat);
      const usados = colCategoria() ? contarUso(colCategoria().id, cat.id) : 0;
      const destino = await escolherDestino(`Excluir a categoria “${cat.nome}”`, `${usados} registro(s) estão nela. Para qual categoria eles vão?`, outras.map((c) => ({ id: c.id, nome: c.nome })), "(sem categoria)");
      if (destino === null) return;
      if (!(await confirmarDigitando(`Excluir a categoria “${cat.nome}”? Um backup é feito antes de aplicar.`, cat.nome, { titulo: "Excluir categoria", botao: "Excluir categoria" }))) return;
      r.categorias = outras;
      if (usados && colCategoria()) migracoes.push({ tipo: "moverOpcao", col: colCategoria().id, de: cat.id, para: destino, nome: `categoria ${cat.nome}` });
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
    const movidas = [];
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
          <span class="ajuda">BLOQUEADO: só a Lays e a Paula alteram (a equipe vê com cadeado). LIVRE: toda a equipe edita, em qualquer linha. LISTA: a equipe só escolhe uma opção (não cria nem renomeia).</span></label>
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
      form.acesso.innerHTML = ACESSOS.filter((a) => (lista ? a.id !== "livre" : a.id !== "lista")).map((a) => `<option value="${a.id}"${atual === a.id ? " selected" : ""}>${escapar(a.nome)}</option>`).join("");
      form.acesso.disabled = TIPOS_SEM_EDICAO.includes(tipoAtual());
    };
    const desenharExtra = () => {
      const tipo = tipoAtual();
      const extra = $("#col-extra", ed);
      desenharAcesso();
      if (TIPOS_LISTA.includes(tipo) && base.origem !== "categorias") {
        extra.innerHTML = `<h3 style="font-size:14px;margin-top:6px">Opções (${opcoes.filter((o) => o.ativa !== false).length} ativas${opcoes.some((o) => o.ativa === false) ? `, ${opcoes.filter((o) => o.ativa === false).length} arquivadas` : ""})</h3><div class="opcoes-editor">${opcoes.map((o, i) => `<div class="opcao${o.ativa === false ? " arquivada" : ""}" data-op="${i}">
            <span class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-op-mover="-1" aria-label="Subir ${escapar(o.nome)}">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-op-mover="1" aria-label="Descer ${escapar(o.nome)}">${svg("i-seta-baixo")}</button></span>
            <input data-op-campo="nome" value="${escapar(o.nome)}" maxlength="100" aria-label="Nome da opção">
            <select data-op-campo="cor" aria-label="Cor">${["", ...CORES].map((x) => `<option value="${x}"${o.cor === x ? " selected" : ""}>${x ? NOME_COR[x] : "Sem cor"}</option>`).join("")}</select>
            ${tipo === "status" ? `<label class="check" style="font-size:12px"><input type="checkbox" data-op-campo="final"${o.final ? " checked" : ""}> Encerra</label>` : "<span></span>"}
            <label class="check" style="font-size:12px" title="Desmarque para arquivar: some das escolhas, mas os registros que já a usam continuam com ela"><input type="checkbox" data-op-campo="ativa"${o.ativa === false ? "" : " checked"}> Ativa</label>
            <button type="button" class="acao-linha" data-op-remover="${i}" aria-label="Remover opção">${svg("i-lixeira")}</button></div>`).join("")}</div>
          <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-secundario btn-mini" data-op-nova>${svg("i-mais")}Adicionar opção</button>
          <button type="button" class="btn btn-secundario btn-mini" data-op-colar>Colar várias opções</button>
          ${antesOriginal && !TIPOS_LISTA.includes(antesOriginal.tipo) ? `<button type="button" class="btn btn-secundario btn-mini" data-op-dos-valores>Criar opções com os valores atuais</button>` : ""}</div>
          <div id="op-colar" hidden><label class="campo"><span class="rotulo">Uma opção por linha (as que já existem são ignoradas)</span><textarea rows="5" data-op-colar-texto></textarea></label>
            <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-mini" data-op-colar-ok>Adicionar estas opções</button></div></div>
          <p class="ajuda">Renomear uma opção muda só o nome: os registros continuam ligados a ela. Arquivar tira a opção das escolhas sem mexer nos registros.${tipo === "status" ? " “Encerra” marca as opções que tiram o registro de “em aberto”." : ""}${tipo === "prioridade" ? " A última opção conta como “crítica” no resumo." : ""}</p>`;
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
        else if (e.target.dataset.opCampo === "ativa") { if (e.target.checked) delete o.ativa; else o.ativa = false; i.classList.toggle("arquivada", !e.target.checked); }
        else o[e.target.dataset.opCampo] = e.target.value;
        desenharConversao();
      }
      if (e.target.name === "nome") $("#aviso-lgpd-nome", ed).textContent = RE_LGPD.test(normalizar(e.target.value)) ? "Atenção: esse nome parece de dado pessoal. Confira a regra de LGPD acima." : "";
    });
    ed.addEventListener("change", (e) => { if (e.target.name === "tipo") desenharExtra(); if (e.target.dataset.opCampo === "cor") e.target.dispatchEvent(new Event("input", { bubbles: true })); });
    ed.addEventListener("click", async (e) => {
      if (e.target.closest("[data-op-nova]")) { opcoes.push({ id: "", nome: "", cor: "" }); desenharExtra(); $$("[data-op-campo='nome']", ed).pop().focus(); }
      const mov = e.target.closest("[data-op-mover]");
      if (mov) {
        const i = Number(mov.closest("[data-op]").dataset.op), j = i + Number(mov.dataset.opMover);
        if (j >= 0 && j < opcoes.length) { [opcoes[i], opcoes[j]] = [opcoes[j], opcoes[i]]; desenharExtra(); }
        return;
      }
      if (e.target.closest("[data-op-colar]")) { const caixa = $("#op-colar", ed); caixa.hidden = !caixa.hidden; if (!caixa.hidden) $("[data-op-colar-texto]", ed).focus(); return; }
      if (e.target.closest("[data-op-colar-ok]")) {
        const nomes = new Set(opcoes.map((o) => nomeComparavel(o.nome)));
        let n = 0;
        $("[data-op-colar-texto]", ed).value.split(/\r?\n/).map((x) => x.trim().slice(0, 100)).filter(Boolean).forEach((nome) => {
          if (nomes.has(nomeComparavel(nome)) || opcoes.length >= MAX_OPCOES) return;
          nomes.add(nomeComparavel(nome)); opcoes.push({ id: "", nome, cor: "" }); n++;
        });
        desenharExtra();
        mostrarAviso(`${n} opção(ões) adicionada(s).`);
        return;
      }
      if (e.target.closest("[data-op-dos-valores]")) {
        const nomes = new Set(opcoes.map((o) => normalizar(o.nome)));
        estado.tickets.forEach((t) => { const v = valorTexto(t, antesOriginal); String(v).split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => { if (!nomes.has(normalizar(x)) && opcoes.length < MAX_OPCOES) { nomes.add(normalizar(x)); opcoes.push({ id: "", nome: x.slice(0, 100), cor: "" }); } }); });
        desenharExtra();
      }
      const rem = e.target.closest("[data-op-remover]");
      if (rem) {
        const o = opcoes[Number(rem.dataset.opRemover)];
        const usados = o.id && antesOriginal ? contarUso(base.id, o.id) : 0;
        if (usados) {
          const destino = await escolherDestino(`Remover a opção “${o.nome}”`, `${usados} registro(s) usam essa opção. Para qual valor eles vão?`, opcoes.filter((x) => x !== o && x.id).map((x) => ({ id: x.id, nome: x.nome })), "(deixar vazio)");
          if (destino === null) return;
          movidas.push({ de: o.id, para: destino, nome: o.nome });
        }
        opcoes = opcoes.filter((x) => x !== o);
        desenharExtra();
      }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const erro = form.querySelector(".form-erro");
      const nome = form.nome.value.trim();
      if (!nome) { erro.textContent = "Dê um nome à coluna."; return; }
      if (r.colunas.some((c) => c.id !== base.id && normalizar(c.nome) === normalizar(nome))) { erro.textContent = "Já existe uma coluna com esse nome."; return; }
      const tipo = tipoAtual();
      if (TIPOS_LISTA.includes(tipo) && base.origem !== "categorias" && !opcoes.some((o) => o.nome.trim())) { erro.textContent = "Adicione ao menos uma opção."; return; }
      const usadosIds = opcoes.map((o) => o.id).filter(Boolean);
      const opcoesFinais = opcoes.filter((o) => o.nome.trim()).map((o) => {
        const id = o.id || idUnico(o.nome, usadosIds);
        usadosIds.push(id);
        return { id, nome: o.nome.trim().slice(0, 100), cor: o.cor || "", ...(tipo === "status" && o.final ? { final: true } : {}), ...(o.ativa === false ? { ativa: false } : {}) };
      });
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
        const op = final.opcoes.find((o) => normalizar(o.nome) === normalizar(final.padrao) || o.id === final.padrao);
        if (!op) { erro.textContent = "O valor padrão precisa ser o nome de uma das opções."; return; }
        final.padrao = op.id;
      }
      if (nova) {
        final.id = idUnico(nome, r.colunas.map((c) => c.id), true);
        final.ordem = Math.max(0, ...r.colunas.filter((c) => c.grupo === final.grupo).map((c) => c.ordem)) + 0.5;
        r.colunas.push(final);
      } else {
        Object.keys(col).forEach((k) => delete col[k]);
        Object.assign(col, final);
        movidas.forEach((m) => migracoes.push({ tipo: "moverOpcao", col: final.id, de: m.de, para: m.para, nome: `opção ${m.nome} de ${final.nome}` }));
        if (antesOriginal && antesOriginal.tipo !== tipo && !TIPOS_SEM_EDICAO.includes(tipo) && !TIPOS_SEM_EDICAO.includes(antesOriginal.tipo)) {
          const i = migracoes.findIndex((m) => m.tipo === "converter" && m.col === final.id);
          if (i >= 0) migracoes.splice(i, 1);
          migracoes.push({ tipo: "converter", col: final.id, nome: final.nome });
        }
      }
      renumerar();
      ed.close();
      desenhar();
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
      if (JSON.stringify(a.opcoes) !== JSON.stringify(c.opcoes)) itens.push(`Opções de “${c.nome}” alteradas`);
      if (acessoDe(a) !== acessoDe(c)) itens.push(`Coluna “${c.nome}”: acesso ${acessoDe(a).toUpperCase()} → ${acessoDe(c).toUpperCase()}`);
      if (a.obrigatoria !== c.obrigatoria || a.unica !== c.unica || a.padrao !== c.padrao) itens.push(`Regras da coluna “${c.nome}” alteradas`);
    });
    const sequencia = (lista, grupos) => {
      const og = (g) => (grupos.find((x) => x.id === g) || {}).ordem || 99;
      return [...lista].sort((x, y) => og(x.grupo) - og(y.grupo) || x.ordem - y.ordem).map((c) => c.id).filter((id) => original.colunas.some((c) => c.id === id) && r.colunas.some((c) => c.id === id)).join(",");
    };
    if (sequencia(original.colunas, original.gruposColunas) !== sequencia(r.colunas, r.gruposColunas)) itens.push("Ordem das colunas alterada");
    original.colunas.forEach((a) => { if (!r.colunas.some((c) => c.id === a.id)) itens.push(`Coluna “${a.nome}” excluída de vez`); });
    const cAnt = Object.fromEntries(original.categorias.map((c) => [c.id, c]));
    r.categorias.forEach((c) => {
      const a = cAnt[c.id];
      if (!a) itens.push(`Nova categoria “${c.nome}”`);
      else {
        if (a.nome !== c.nome) itens.push(`Categoria “${a.nome}” renomeada para “${c.nome}”`);
        if (a.ativa !== c.ativa) itens.push(`Categoria “${c.nome}” ${c.ativa ? "reativada" : "arquivada"}`);
        if (a.cor !== c.cor || a.ordem !== c.ordem) itens.push(`Categoria “${c.nome}”: cor ou ordem alterada`);
      }
    });
    original.categorias.forEach((a) => { if (!r.categorias.some((c) => c.id === a.id)) itens.push(`Categoria “${a.nome}” excluída`); });
    if (JSON.stringify(original.gruposColunas) !== JSON.stringify(r.gruposColunas)) itens.push("Grupos de colunas alterados");
    if (original.titulo !== r.titulo) itens.push(`Título: “${original.titulo}” → “${r.titulo}”`);
    if (JSON.stringify(original.regras) !== JSON.stringify(r.regras)) itens.push(`Regras da equipe: edita ${EQUIPE_EDITA.find((x) => x.id === r.regras.equipeEdita).nome.toLowerCase()}; janela ${r.regras.janelaEdicaoHoras || "sem limite"}${r.regras.janelaEdicaoHoras ? " h" : ""}; exportação ${r.regras.exportacao ? "liberada" : "desligada"}; novos registros ${r.regras.registro.aberto ? "permitidos" : "fechados"}${r.regras.registro.dominios.length ? ` (só ${r.regras.registro.dominios.join(", ")})` : ""}${r.regras.registro.aprovacao ? ", com liberação" : ", sem liberação"}, como ${r.regras.registro.papelPadrao === "leitura" ? "Leitura" : "Equipe"}`);
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
        if (m.tipo === "moverOpcao") {
          if (Array.isArray(atual) && atual.includes(m.de)) mud[m.col] = [...new Set(atual.map((x) => (x === m.de ? m.para : x)).filter(Boolean))];
          else if (atual === m.de) mud[m.col] = m.para || "";
        }
        if (m.tipo === "converter" && !estaVazio(atual) && colsAntigas[m.col] && colsNovas[m.col]) {
          const rr = converterValor(atual, colsAntigas[m.col], colsNovas[m.col]);
          mud[m.col] = rr.ok ? rr.valor : vazioDe(colsNovas[m.col]);
        }
      });
      if (Object.keys(mud).length) {
        afetados++;
        if (t.arquivo) arquivo.set(t.id, { ...t, campos: Object.entries(mud).reduce((cs, [c, v]) => comCampo(cs, c, v), t.campos), ...autoria("atualizadoPor"), atualizadoEm: agora });
        else ops.push({ op: "set", caminho: `${P()}/${t.id}`, mesclar: true, dados: { campos: mud, ...assinatura() } });
      }
    });
    return { ops, arquivo, afetados };
  }
  async function aplicar() {
    const itens = resumoMudancas();
    if (!itens.length && !migracoes.length) { mostrarAviso("Nenhuma mudança para aplicar."); return; }
    const novo = normalizarEstrutura({ ...r, versao: original.versao + 1 });
    const { ops, arquivo, afetados } = opsMigracao(novo);
    const so_regras = itens.every((x) => /^(Título|Regras da equipe)/.test(x)) && !migracoes.length;
    if (!(await confirmar(so_regras ? "Confira as mudanças:" : `Confira as mudanças. Antes de aplicar, é feito um backup automático (estrutura + ${estado.tickets.length} registros).`, {
      titulo: "Prévia das mudanças", botao: "Aplicar",
      html: `<ul class="lista-mudancas">${itens.map((x) => `<li>${escapar(x)}</li>`).join("")}${afetados ? `<li><strong>${afetados} registro(s) terão os dados ajustados.</strong></li>` : ""}</ul>`
    }))) return;
    if (!so_regras && !(await criarBackup(`Antes de mudar a estrutura (${itens.slice(0, 3).join("; ")}${itens.length > 3 ? "…" : ""})`))) return;
    try {
      if (ops.length) await estado.api.lote(ops);
      if (arquivo.size) await alterarArquivo(arquivo);
      await estado.api.salvarDoc(`${P()}-config/estrutura`, dadosEstrutura(novo));
      registrarAuditoria("estrutura", `Mudou a estrutura (versão ${novo.versao})`, itens.join(" · ").slice(0, 1500));
      if (!ops.length && !arquivo.size) {
        const anterior = JSON.parse(JSON.stringify(original));
        empilharDesfazer("Estrutura anterior restaurada", async () => { anterior.versao = estado.estrutura.versao + 1; await estado.api.salvarDoc(`${P()}-config/estrutura`, dadosEstrutura(anterior)); registrarAuditoria("estrutura", "Desfez a última mudança de estrutura"); });
      }
      d.close();
      mostrarAviso(`Estrutura aplicada${afetados ? ` (${afetados} registro(s) ajustados)` : ""}.`, 5000);
    } catch (e) { console.error(e); mostrarAviso("Não foi possível aplicar. Se algo ficou pela metade, restaure o backup em Administração › Backups.", 8000); }
  }
  desenhar();
  d.showModal();
}
/* Pergunta para onde mover valores; devolve o id escolhido, "" (vazio) ou null (cancelou) */
function escolherDestino(titulo, texto, opcoes, rotuloVazio) {
  return new Promise((resolver) => {
    const d = criarDialogo({ titulo, corpo: `<p class="apoio">${escapar(texto)}</p>
      <label class="campo"><span class="rotulo">Mover para</span><select name="destino"><option value="">${escapar(rotuloVazio)}</option>${opcoes.map((o) => `<option value="${escapar(o.id)}">${escapar(o.nome)}</option>`).join("")}</select></label>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Continuar</button></div>` });
    let valor = null;
    d.querySelector("form").addEventListener("submit", (e) => { valor = e.target.destino.value; });
    d.addEventListener("close", () => resolver(valor));
    d.showModal();
  });
}

/* ------------------------------------------------------------
 *  BANCO DE TICKETS v2: só 13 colunas, acesso por coluna e listas fixas.
 *  Muda só a estrutura: os dados continuam ligados aos mesmos ids de coluna.
 * ------------------------------------------------------------ */
const LISTAS_V2 = {
  motivo: ["AUDITORIA", "COLETA BIOMETRIA", "COMBO REMUNERAÇÃO", "CONCESSAO AUTORIZADA", "CORTESIA", "EMISSAO COLABORADOR", "ERRO OPERACIONAL AR", "ERRO OPERACIONAL AR VALID", "ERRO SISTEMICO", "ERRO SISTEMICO QR CODE", "POLITICA DE GARANTIA", "SUBSTITUICAO PRE PAGO", "SUBSTITUICAO PROJETO AMOR E SAUDE", "TESTE INTERNO"],
  responsavel: ["Adriano Bessa", "Alan Anjos", "Ana Karollyne", "Anderson Leite", "Caique Souza", "Davi Santos", "David Bezerra", "David Moraes", "Edna Teresa", "Erica Queiroz", "Fabiana Santos", "Guilherme Bezerra", "Guilherme Matos", "Guilherme Neto", "Guilherme Ruzo", "Isaac Lima", "Isaque Pereira", "Jessica Rombalde", "Keithe Nelle", "Lais Vergueiro", "Lays Almeida", "Leticia Amabile", "Lucilene Esteves", "Marcelo Teixeira", "Nadia Costamanha", "Nayara Machado", "Paula Katiele", "Roger Liash", "Thaina Santos", "Thiago Mari", "Vinicius Silva", "Wellington Santos"],
  area: ["SAC", "SUPORTE OPERACIONAL", "SUPORTE N2"],
  arSolicitante: ["AR A A A GSM CERTIFICADORA", "AR A DIGIFORTE", "AR A PENTA", "AR A. C. CERTIFICADOS", "AR AAAA HGL", "AR AASP", "AR ABSOLUTA CERTIFICADO DIGITAL", "AR ACAO CERTIFICADORA", "AR ACERTCAM", "AR ACERTO DIGITAL", "AR ADAPT DATA TECNOLOGIA", "AR AGREP CERTIFICACAO DIGITAL E SOLUCOES EMPRESARIAIS", "AR AGUILAR & FANTINI CONSULTORIA E REPRESENTACOES", "AR ALTECH", "AR ALTERNATIVA MARCAS E PATENTES", "AR AMAZONIA DIGITAL", "AR ANCORA CERTIFICACAO DIGITAL", "AR APTACERT CERTIFICADOS DIGITAIS", "AR ARACERT", "AR ARJ - CERTIFICACAO DIGITAL", "AR ASCON", "AR ASL SERVICOS ADMINISTRATIVOS", "AR ASPLAN", "AR ASSESSORIA DOCUMENTAL BRASIL E ESTADOS UNIDOS LTDA", "AR ASSOCIACAO DO COMERCIO E INDUSTRIA DE FRANCA", "AR ATENA TECNOLOGIA", "AR ATOCSIGN CERTIFICACAO DIGITAL", "AR ATOS CERTIFICADORA", "AR AUTENTIC CERTIFICADORA", "AR BANRISUL", "AR BARUC ADMINISTRACAO E SAUDE", "AR BETTER", "AR BID", "AR BITCOM", "AR BJM CERTIFICADORA", "AR BRACERT CERTIFICADO DIGITAL", "AR BRAS CENTER", "AR BRASID CERTIFICADORA DIGITAL", "AR BRASIL PONTO DIGITAL", "AR BRSIGN TECH", "AR CAMBARA", "AR CARDS", "AR CCS CERTIFICADORA", "AR CDPR", "AR CEL CERTIFICADORA DIGITAL", "AR CENTERDATA", "AR CERT ONE", "AR CERT SOLUTIONS CERTIFICACAO DIGITAL", "AR CERTBANK", "AR CERTDADOS SOLUCOES DIGITAIS", "AR CERTDATA", "AR CERTFOZ CERTIFICADO DIGITAL", "AR CERTIBEM", "AR CERTICARD CERTIFICADORA DIGITAL LTDA", "AR CERTIFICA DIGITAL", "AR CERTIFICA GOIAS", "AR CERTIFICA WEB", "AR CERTIFICADORA DIGITAL SERVICOS INTELIGENTES", "AR CERTIFICADORA DO VALE", "AR CERTIFICADORA NUNES", "AR CERTIFICAR", "AR CERTIVIP", "AR CERTJA SERVICOS DIGITAIS", "AR CERTLINE SOLUCOES EM CERTIFICADOS", "AR CERTLUNE CERTIFICADO DIGITAL", "AR CERTSEC", "AR CERTSIM", "AR CFM", "AR CIESP", "AR COBRA CERTIFICADOS DIGITAIS", "AR COMPUTEK COMERCIO E SERVICOS LTDA", "AR CONCEPTUS CERTIFICACAO DIGITAL", "AR CONECTSIGN", "AR CONEXAO CERTIFICADORA", "AR CONFIRMA ASSESSORIA CONTABIL E EMPRESARIAL", "AR CONSYSTE", "AR CONTACT - SOLUCOES EM GESTAO EMPRESARIAL", "AR DANTE MARON", "AR DIGITA CERTIFICADOS DIGITAIS", "AR DIGITAL CERTIFICAR TECNOLOGIA", "AR DIGITAL CERTY", "AR DIGITAL NORTE SUL", "AR DIGITAL SYSTEM", "AR DIGITALCERT", "AR DM CERTIFICADORA", "AR DNA", "AR DOC PRIME CERTIFICADO DIGITAL", "AR DORITEC", "AR EASY SIGN CERTIFICACAO DIGITAL", "AR E-CONNECT SOLUCOES", "AR ECOSCARD", "AR ESSENCIAL CERTIFICADORA DIGITAL", "AR E-VAL COMERCIO E SERVICOS DE INFORMATICA EM SAUDE", "AR EVAL SISTEMAS EM INFORMATICA", "AR EXITOS AUTOMACAO E SISTEMAS", "AR EXPRESS CERTIFICACAO DIGITAL", "AR EZ CERT", "AR FACILID CERTIFICADORA DIGITAL", "AR FANTINI", "AR FLEX. ID CERTIFICACAO DIGITAL", "AR FLORIPA CERTIFICACAO DIGITAL", "AR FLY CERTIFICADORA DIGITAL LTDA", "AR FORTE", "AR FREDIGITAL", "AR GEBRAM", "AR GESOIS", "AR GIARETTA ASSESSORIA EMPRESARIAL", "AR GLOBALCERTI", "AR GOLD", "AR GOLDEN CERTIFICACAO DIGITAL", "AR GOOD HEALTH PLANOS DE SAUDE E SEGUROS", "AR HARDTECH INFORMATICA", "AR HZ CERTIFICADO DIGITAL", "AR IFTEC", "AR IMPERIO CERTIFICACAO DIGITAL", "AR INFORMBANK", "AR INTER", "AR IPIRANGA CERTIFICADOS", "AR JCLV CERTIFICADOS DIGITAIS", "AR JL CERTIFICADO DIGITAL", "AR JM GROUP", "AR JR", "AR JUNTOS", "AR L&V CERTIFICADORA", "AR LEMONID", "AR LICICOM DIGITAL", "AR LIMACORP TECNOLOGIA", "AR LINHA VIP CERTIFICACAO DIGITAL UNIPESSOAL LTDA", "AR LION CERTIFICACAO DIGITAL", "AR LOCALCERT", "AR LOUSANO CORRETORA DE SEGUROS", "AR MAC BR", "AR MACSEG CERTIFICACAO DIGITAL", "AR MARRA CERTIFICADORA", "AR MC CERTIFICADO DIGITAL", "AR MEGATRIANGULO INFORMATICA", "AR MERCOSUL", "AR MG SOLUCOES", "AR MOURA CONTABILIDADE", "AR MOVE ID IDENTIFICACAO DIGITAL", "AR MS CERTIFICACAO DIGITAL", "AR NATHYELLE", "AR NEW CONPRATIC", "AR NEWCERT", "AR NORDESTE DIGITAL", "AR NOVO CERTIFICADO DIGITAL", "AR O C CONSULTORIA EM TECNOLOGIA LTDA", "AR OAB SP", "AR OBJETIVA CERTIFICACAO DIGITAL E SERVICOS ADMINISTRATIVO", "AR ONE", "AR ONLINE CERTIFICADORA", "AR ONLINE NORDESTE CERTIFICADORA", "AR ONLINE SOLUCOES DIGITAIS", "AR ONLINE SUL", "AR PARANA CERTIFICADORA", "AR PARCERIA CERTIFICACAO DIGITAL", "AR PDA CERTIFICADORA", "AR PENTA", "AR POLO SOLUCOES DIGITAIS", "AR PRAKTUS", "AR PRATICA CERTIFICACAO DIGITAL", "AR PREMIER", "AR PREMIUM DIGITAL", "AR PRIMECERT", "AR PRO CONSULTORIA", "AR PROJJECTTO", "AR PRYOR INSURANCE CORRETORA DE SEGUROS", "AR QUANTICA DIGITAL", "AR R.E.INVENT", "AR R/C CARTUCHOS, INFORMATICA E PAPELARIA", "AR RADAR CERTIFICADORA", "AR RADAR CONSULTAS LTDA", "AR REGIONAL CERTIFICADORA", "AR RENOVE TECNOLOGIA", "AR REPORT", "AR RIO MADEIRA", "AR SAFE RIO CERTIFICACAO", "AR SC DIGITAL", "AR SC FORTE CERTIFICADO DIGITAL", "AR SEABRA MEDEIROS", "AR SECCERT", "AR SELETO CERTIFICADO DIGITAL", "AR SENHA DIGITAL", "AR SERCOM", "AR SERCON SERVICOS CONTABEIS", "AR SIC", "AR SIG", "AR SIG CERTIFICADORA", "AR SIGNIT CERTIFICADORA DIGITAL", "AR SIMBOLO CONTABILIDADE", "AR SMART FACILITIES", "AR SOLIMOES", "AR SOLIMOES CERTIFICADORA", "AR SOLUTION SP", "AR SP CERTIFICADOS", "AR SSC SISTEMA SUL CERTIFICADORA", "AR SULCREDI/CREDILUZ", "AR SYSTEM CERTIFICADORA", "AR T SERVICOS", "AR TEC TECNOLOGIA DIGITAL", "AR TECH CERTIFICADO MATOS", "AR TECH CLOUD", "AR TEKSUL", "AR TOP ID", "AR TOPCERT", "AR TOTALCERT SERVICOS DIGITAIS E ADMINISTRATIVOS", "AR TUALANG COWORKING", "AR UP 2 TECH DO BRASIL", "AR V7 CERTIFICADORA", "AR VALECERT", "AR VALID CD", "AR VALIDE DIGITAL SOLUCOES", "AR VAZ TECNOLOGIA", "AR VD DIGITAL", "AR VENDOR", "AR VERSATIL SOFTWARES E CERTIFICACAO DIGITAL", "AR VIAVOZ", "AR VIDA", "AR VIDA DE OURO VALE DO PARAIBA", "AR VISATTO GESTAO EMPRESARIAL", "AR VL SERVICOS", "AR WA CERTIFICADO DIGITAL", "AR WD CERTIFICACAO DIGITAL", "AR WL CERTIFICADOS", "AR YOU DIGITAL", "AR ZAZ BRASIL"]
};
/* PEDIDO ANTERIOR: LIVRE (como TICKET ANTERIOR); a Lays troca para BLOQUEADO no modo Estrutura, se for o caso */
const COLUNAS_V2 = [
  { papel: "ticket", nome: "TICKET CONCEDIDO", id: "ticketConcedido", tipo: "texto", acesso: "bloqueado", unica: true, largura: 150 },
  { papel: "dataConcessao", nome: "DATA DE CONCESSÃO DO TICKET", id: "dataConcessao", tipo: "data", acesso: "livre", largura: 130 },
  { papel: "responsavel", nome: "RESPONSÁVEL", id: "responsavel", tipo: "lista", acesso: "lista", largura: 170, lista: LISTAS_V2.responsavel },
  { nome: "PEDIDO CONCEDIDO", id: "pedidoConcedido", tipo: "texto", acesso: "bloqueado", largura: 150 },
  { nome: "PRODUTO", id: "produto", tipo: "texto", acesso: "bloqueado", largura: 160 },
  { papel: "motivo", nome: "MOTIVO", id: "motivo", tipo: "lista", acesso: "lista", largura: 220, lista: LISTAS_V2.motivo },
  { nome: "CHAMADO", id: "chamado", tipo: "texto", acesso: "livre", largura: 140 },
  { nome: "PEDIDO ANTERIOR", id: "pedidoAnterior", tipo: "texto", acesso: "livre", largura: 150 },
  { nome: "TICKET ANTERIOR", id: "ticketAnterior", tipo: "texto", acesso: "livre", largura: 150 },
  { papel: "arSolicitante", nome: "AR SOLICITANTE", id: "arSolicitante", tipo: "lista", acesso: "lista", largura: 280, lista: LISTAS_V2.arSolicitante },
  { nome: "DATA DE EMISSÃO ANTERIOR", id: "dataEmissaoAnterior", tipo: "data", acesso: "livre", largura: 130 },
  { papel: "area", nome: "ÁREA", id: "area", tipo: "lista", acesso: "lista", largura: 180, lista: LISTAS_V2.area },
  { nome: "OBSERVAÇÃO VIDAAS", id: "observacaoVidaas", tipo: "textoLongo", acesso: "livre", largura: 280 }
];
const MOTIVO_BACKUP_V2 = "Antes da nova estrutura (v2)";
const v2Pendente = () => ehBanco() && !!estado.estrutura && !(modelo() && modelo().versao >= 2);
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
/* Opções da lista nova: reaproveita o id da opção antiga de mesmo nome (sem acentos/maiúsculas/pontuação);
   as antigas que sobram ficam arquivadas (os registros que as usam aparecem como "fora da lista") */
function opcoesV2(antigas, nomes) {
  const ids = new Set(antigas.map((o) => o.id)), usadas = new Set();
  const porNome = new Map();
  antigas.forEach((o) => { if (!porNome.has(compacto(o.nome))) porNome.set(compacto(o.nome), o); });
  const novas = nomes.map((nome) => {
    const o = porNome.get(compacto(nome));
    if (o && !usadas.has(o.id)) { usadas.add(o.id); return { id: o.id, nome, cor: o.cor || "" }; }
    let id = slug(nome, 40), n = 2;
    while (ids.has(id)) id = `${slug(nome, 36)}-${n++}`;
    ids.add(id);
    return { id, nome, cor: "" };
  });
  return [...novas, ...antigas.filter((o) => !usadas.has(o.id)).map((o) => ({ ...o, ativa: false }))];
}
/* Plano da v2 a partir da estrutura publicada (sem gravar nada) */
function planoV2(est) {
  const usadas = new Set();
  const achadas = new Map();
  /* Primeiro os nomes iguais, depois id, depois nomes parecidos, para um nome parecido não roubar a coluna certa */
  [false, "id", true].forEach((modo) => COLUNAS_V2.forEach((spec) => {
    if (achadas.has(spec.nome)) return;
    const livres = est.colunas.filter((c) => !usadas.has(c.id) && !TIPOS_SEM_EDICAO.includes(c.tipo));
    const ordem = [...livres.filter((c) => c.ativa), ...livres.filter((c) => !c.ativa)];
    const c = modo === "id" ? ordem.find((x) => x.id === spec.id) : ordem.find((x) => nomesEquivalentes(x.nome, spec.nome, modo));
    if (c) { usadas.add(c.id); achadas.set(spec.nome, c); }
  }));
  const ids = new Set(est.colunas.map((c) => c.id));
  const colunas = COLUNAS_V2.map((spec) => {
    const antiga = achadas.get(spec.nome) || null;
    let id = antiga ? antiga.id : spec.id;
    if (!antiga) { let n = 2; while (ids.has(id)) id = `${spec.id}${n++}`; ids.add(id); }
    return { spec, antiga, id };
  });
  const finais = new Set(colunas.map((c) => c.id));
  const arquivadas = est.colunas.filter((c) => !finais.has(c.id) && c.ativa);
  return { colunas, arquivadas };
}
function montarEstruturaV2(est, plano) {
  const nova = JSON.parse(JSON.stringify(est));
  let grupo = nova.gruposColunas.find((g) => g.id === "planilha");
  if (!grupo) { grupo = { id: idUnico("planilha", nova.gruposColunas.map((g) => g.id)), nome: "BANCO DE TICKETS", ordem: 0 }; nova.gruposColunas.push(grupo); }
  nova.gruposColunas.forEach((g) => { g.ordem = g === grupo ? 1 : g.ordem + 1; });
  plano.colunas.forEach(({ spec, antiga, id }, i) => {
    const base = antiga ? nova.colunas.find((c) => c.id === antiga.id) : null;
    const col = base || { id, padrao: "", ajuda: "", opcoes: [] };
    Object.assign(col, {
      nome: spec.nome, tipo: spec.tipo, grupo: grupo.id, ordem: i + 1, largura: spec.largura,
      obrigatoria: false, unica: !!spec.unica, acesso: spec.acesso, somenteAdmin: spec.acesso === "bloqueado", ativa: true,
      opcoes: spec.lista ? opcoesV2((antiga && antiga.opcoes) || [], spec.lista) : []
    });
    delete col.origem; delete col.auto; delete col.formula; delete col.de; delete col.ate;
    if (spec.tipo !== "data" && col.padrao === "hoje") col.padrao = "";
    if (spec.lista && col.padrao && !col.opcoes.some((o) => o.id === col.padrao && o.ativa !== false)) col.padrao = "";
    if (!base) nova.colunas.push(col);
  });
  const finais = new Set(plano.colunas.map((c) => c.id));
  nova.colunas.forEach((c) => { if (!finais.has(c.id)) { c.ativa = false; c.ordem = 100 + (c.ordem || 0); } });
  nova.categorias.forEach((c) => { c.ativa = false; });
  nova.regras.equipeEdita = "todas";
  nova.modelo = { versao: 2, colunas: Object.fromEntries(plano.colunas.filter((c) => c.spec.papel).map((c) => [c.spec.papel, c.id])) };
  nova.versao = (est.versao || 1) + 1;
  return normalizarEstrutura(nova);
}
/* Contagens da prévia: valores das listas reconhecidos x fora da lista, e valores que não se encaixam no tipo novo */
function previaV2(est, nova, plano) {
  const porCol = Object.fromEntries(nova.colunas.map((c) => [c.id, c]));
  const listas = [], tipos = [];
  plano.colunas.forEach(({ spec, antiga, id }) => {
    const col = porCol[id];
    if (spec.lista) {
      let ok = 0, fora = 0;
      const distintos = new Map();
      estado.tickets.forEach((t) => {
        const v = (t.campos || {})[id];
        if (estaVazio(v)) return;
        if (foraDaLista(col, v)) { fora++; const nome = (opcao(col, v) || { nome: v }).nome; distintos.set(nome, (distintos.get(nome) || 0) + 1); } else ok++;
      });
      listas.push({ nome: spec.nome, ok, fora, distintos: [...distintos].sort((a, b) => b[1] - a[1]) });
    } else if (antiga && antiga.tipo !== spec.tipo && !(["texto", "textoLongo"].includes(antiga.tipo) && ["texto", "textoLongo"].includes(spec.tipo))) {
      const exemplos = [];
      let n = 0;
      estado.tickets.forEach((t) => {
        const v = (t.campos || {})[id];
        if (estaVazio(v)) return;
        const encaixa = spec.tipo === "data" ? /^\d{4}-\d{2}-\d{2}$/.test(v) : spec.tipo === "numero" ? typeof v === "number" : typeof v === "string";
        if (!encaixa) { n++; if (exemplos.length < 5) exemplos.push(String(Array.isArray(v) ? v.join(", ") : v)); }
      });
      tipos.push({ nome: spec.nome, de: NOME_TIPO[antiga.tipo], para: NOME_TIPO[spec.tipo], n, exemplos });
    }
  });
  const contar = (id) => estado.tickets.filter((t) => !estaVazio((t.campos || {})[id])).length;
  return { listas, tipos, arquivadas: plano.arquivadas.map((c) => ({ nome: c.nome, id: c.id, n: TIPOS_SEM_EDICAO.includes(c.tipo) ? null : contar(c.id) })) };
}
/* Backup completo (estrutura + todos os registros, inclusive os do arquivo) e cópia em JSON baixada */
async function backupComDownload(motivo) {
  const id = await criarBackup(motivo);
  if (!id) return null;
  const p = partesBrasilia();
  baixarArquivo(`${planilhaAtual().id}-backup-${p.ano}-${p.mes}-${p.dia}-${p.hora}${p.minuto}.json`,
    JSON.stringify({ criadoEm: new Date().toISOString(), criadoPor: estado.usuario.email, motivo, estrutura: dadosEstruturaBackup(estado.estrutura), registros: estado.tickets.map((t) => ({ id: t.id, dados: registroBackup(t) })) }),
    "application/json;charset=utf-8");
  return id;
}
async function aplicarV2() {
  if (!ehAdmin() || !conectado() || !v2Pendente()) return;
  if (!estado.carregouTickets) { mostrarAviso("Espere os registros terminarem de carregar."); return; }
  if (!(await confirmar("Antes de mostrar a prévia, é feito um backup completo (estrutura e todos os registros) e uma cópia em JSON é baixada neste computador. Nada muda até você clicar em “Aplicar”.", { titulo: "Aplicar nova estrutura (v2)", botao: "Fazer backup e ver a prévia" }))) return;
  mostrarAviso("Fazendo o backup…", 20000);
  if (!(await backupComDownload(MOTIVO_BACKUP_V2))) return;
  mostrarAviso("Backup feito e cópia em JSON baixada. Confira a prévia.", 4000);
  const est = JSON.parse(JSON.stringify(estado.estrutura));
  const plano = planoV2(est);
  const nova = montarEstruturaV2(est, plano);
  const pr = previaV2(est, nova, plano);
  const total = estado.tickets.length;
  const linhaCol = ({ spec, antiga, id }) => `<tr><td>${escapar(spec.nome)}</td><td>${antiga ? `reaproveitada: “${escapar(antiga.nome)}”` : "<strong>criada</strong>"}</td><td><code>${escapar(id)}</code></td><td>${escapar(NOME_TIPO[spec.tipo])}</td><td>${escapar(spec.acesso.toUpperCase())}</td></tr>`;
  const html = `<h3 style="font-size:14px">As 13 colunas, nesta ordem</h3>
    <div class="tabela-admin"><table><thead><tr><th>Coluna</th><th>Origem</th><th>id</th><th>Tipo</th><th>Acesso</th></tr></thead><tbody>${plano.colunas.map(linhaCol).join("")}</tbody></table></div>
    <h3 style="font-size:14px;margin-top:10px">Colunas arquivadas (${pr.arquivadas.length}) — os valores continuam guardados e aparecem na ficha</h3>
    <ul class="lista-mudancas">${pr.arquivadas.map((a) => `<li>${escapar(a.nome)}${a.n == null ? " (automática: a informação continua na ficha e no histórico)" : ` — ${a.n.toLocaleString("pt-BR")} registro(s) com valor`}</li>`).join("") || "<li>Nenhuma</li>"}</ul>
    <h3 style="font-size:14px;margin-top:10px">Listas</h3>
    <ul class="lista-mudancas">${pr.listas.map((l) => `<li><strong>${escapar(l.nome)}</strong>: ${l.ok.toLocaleString("pt-BR")} valor(es) reconhecido(s); ${l.fora.toLocaleString("pt-BR")} fora da lista${l.distintos.length ? ` (${l.distintos.slice(0, 8).map(([n, q]) => `“${escapar(n)}” ${q}`).join(", ")}${l.distintos.length > 8 ? "…" : ""})` : ""}</li>`).join("")}</ul>
    ${pr.tipos.length ? `<h3 style="font-size:14px;margin-top:10px">Mudança de tipo</h3><ul class="lista-mudancas">${pr.tipos.map((x) => `<li>${escapar(x.nome)}: ${escapar(x.de)} → ${escapar(x.para)}; ${x.n} valor(es) não se encaixam e ficam como estão${x.exemplos.length ? ` (${x.exemplos.map((e) => `“${escapar(e)}”`).join(", ")})` : ""}</li>`).join("")}</ul>` : ""}
    <p class="apoio" style="margin-top:10px">Também: abas por ÁREA no lugar das categorias, resumo do topo novo e “A equipe edita: qualquer linha” (LIVRE e LISTA valem em todas as linhas). Os ${total.toLocaleString("pt-BR")} registros não são regravados. Os valores “fora da lista” não são apagados: corrija depois em Administração › Corrigir valores fora da lista.</p>`;
  if (!(await confirmar("Confira a nova estrutura. O backup já foi feito (Administração › Backups).", { titulo: "Prévia da nova estrutura (v2)", botao: "Aplicar", html }))) return;
  try {
    await estado.api.salvarDoc(`${P()}-config/estrutura`, dadosEstrutura(nova));
    const resumo = `13 colunas (${plano.colunas.filter((c) => c.antiga).length} reaproveitadas, ${plano.colunas.filter((c) => !c.antiga).length} criadas); ${pr.arquivadas.length} arquivadas; fora da lista: ${pr.listas.map((l) => `${l.nome} ${l.fora}`).join(", ")}`;
    registrarAuditoria("estrutura", `Aplicou a nova estrutura (v2) — versão ${nova.versao}`, resumo);
    await confirmar(`Nova estrutura aplicada. ${resumo}. Os ${total.toLocaleString("pt-BR")} registros continuam como estavam.`, { titulo: "Pronto", botao: "OK" });
  } catch (e) { console.error(e); mostrarAviso("Não foi possível aplicar. Nada foi alterado; o backup está em Administração › Backups.", 8000); }
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
  porRegistro.forEach((mud, id) => { const t = m.get(id); if (!t) { Object.keys(mud).forEach((c) => pendentes.delete(`${id}|${c}`)); return; } (t.arquivo ? doArquivo : vivos).push([t, mud]); });
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
    ? `O limite diário de gravações do plano gratuito acabou. Faltam ${r.faltam} alteração(ões); elas ficaram guardadas neste navegador. Amanhã, use Administração › “Continuar a conversão”.`
    : `A conversão parou (sem conexão ou sem permissão). Faltam ${r.faltam} alteração(ões); use Administração › “Continuar a conversão”.`;
}
async function continuarConversao() {
  const p = lerLocal(chavePendente(), null);
  if (!p || !p.itens || !p.itens.length) { apagarLocal(chavePendente()); mostrarAviso("Não há conversão pendente."); return; }
  mostrarAviso(`Continuando: ${p.itens.length} alteração(ões)…`, 20000);
  const r = await converterEmLotes(p.itens, p.rotulo || "corrigirLista");
  registrarAuditoria("corrigirLista", `Continuou a conversão: ${p.itens.length - r.faltam} de ${p.itens.length} alteração(ões)`);
  mostrarAviso(textoResultadoConversao(r), 9000);
}
function abrirForaDaLista() {
  if (!ehAdmin() || !estado.estrutura) return;
  const cols = colunasAtivas().filter((c) => c.tipo === "lista" && !c.origem);
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
      <p class="apoio" role="status" id="fora-progresso"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button><button type="submit" class="btn">Aplicar</button></div>`
      : `<p class="apoio">Nenhum valor fora da lista nas colunas LISTA.</p><div class="form-botoes"><button type="button" class="btn" data-fechar>Fechar</button></div>`
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
      const arquivada = col.opcoes.find((o) => o.id === g.valor);
      if (arquivada) { delete arquivada.ativa; return; }
      const id = idUnico(g.nome, col.opcoes.map((o) => o.id));
      col.opcoes.push({ id, nome: String(g.nome).slice(0, 100), cor: "" });
      trocas.push({ col: g.col.id, de: g.valor, para: id });
    });
    mapear.forEach((g) => trocas.push({ col: g.col.id, de: g.valor, para: g.para }));
    try {
      if (criar.length) { nova.versao = estado.estrutura.versao + 1; await estado.api.salvarDoc(`${P()}-config/estrutura`, dadosEstrutura(normalizarEstrutura(nova))); }
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
/* Registros antigos com "Nº do ticket" (id numero) preenchido e TICKET CONCEDIDO vazio (só quando são colunas diferentes) */
function casosCopiarNumero() {
  const t = colModelo("ticket");
  const antiga = estado.estrutura && estado.estrutura.colunas.find((c) => c.id === "numero");
  if (!t || t.id === "numero" || !antiga) return [];
  return estado.tickets.filter((x) => !estaVazio((x.campos || {}).numero) && estaVazio((x.campos || {})[t.id]));
}
async function copiarNumeroParaTicket() {
  const lista = casosCopiarNumero(), t = colModelo("ticket");
  if (!lista.length || !t) { mostrarAviso("Nenhum registro para copiar."); return; }
  const html = `<ul class="lista-mudancas">${lista.slice(0, 15).map((x) => `<li>${escapar(String(x.campos.numero))}</li>`).join("")}${lista.length > 15 ? `<li>… e mais ${lista.length - 15}</li>` : ""}</ul>`;
  if (!(await confirmar(`Copiar o Nº do ticket para ${t.nome} em ${lista.length} registro(s) onde ${t.nome} está vazio? Um backup é feito antes.`, { titulo: "Copiar Nº do ticket", botao: "Copiar", html }))) return;
  if (!(await criarBackup("Antes de copiar o Nº do ticket"))) return;
  const r = await converterEmLotes(lista.map((x) => [x.id, t.id, String(x.campos.numero)]), "copiarNumero");
  registrarAuditoria("copiarNumero", `Copiou o Nº do ticket para ${t.nome}`, `${lista.length - r.faltam} de ${lista.length} registro(s)`);
  mostrarAviso(textoResultadoConversao(r), 8000);
}

/* Menu Administração */
function abrirMenuAdmin(botao) {
  fecharPop();
  const pedidos = estado.tickets.filter((t) => t.exclusao).length;
  const pendente = lerLocal(chavePendente(), null);
  const copiar = casosCopiarNumero().length;
  const itens = [
    ...(v2Pendente() ? [["v2", "i-check", "Aplicar nova estrutura (v2)"]] : []),
    ["estrutura", "i-ajustes", "Estrutura (colunas, categorias, regras)"],
    ["fora", "i-alerta", "Corrigir valores fora da lista"],
    ...(copiar ? [["copiar-numero", "i-copiar", `Copiar Nº do ticket para ${colModelo("ticket").nome} (${copiar})`]] : []),
    ...(pendente && pendente.itens && pendente.itens.length ? [["continuar", "i-restaurar", `Continuar a conversão (${pendente.itens.length} pendente(s))`]] : []),
    ["pessoas", "i-pessoas", `Pessoas (${estado.pessoas.length})${aguardando() ? ` · ${aguardando()} aguardando` : ""}`],
    ["pedidos", "i-alerta", `Pedidos de exclusão (${pedidos})`],
    ["lixeira", "i-lixeira", `Lixeira (${estado.lixeira.length})`],
    ["backups", "i-salvar", "Backups"],
    ["compactar", "i-tabela", `Compactar registros (${estado.vivos.filter((t) => !t.exclusao).length} fora do arquivo)`],
    ["auditoria", "i-historico", "Auditoria"]
  ];
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.style.width = "270px";
  pop.setAttribute("role", "menu");
  pop.innerHTML = itens.map(([id, icone, nome]) => `<button type="button" class="item-menu" role="menuitem" data-adm="${id}">${svg(icone)}${escapar(nome)}</button>`).join("");
  posicionarPop(pop, botao, 270);
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-adm]");
    if (!b) return;
    fecharPop();
    const a = b.dataset.adm;
    if (!conectado() && a !== "auditoria") { mostrarAviso("Sem conexão: a administração está bloqueada."); return; }
    if (a === "v2") aplicarV2();
    if (a === "fora") abrirForaDaLista();
    if (a === "copiar-numero") copiarNumeroParaTicket();
    if (a === "continuar") continuarConversao();
    if (a === "estrutura") abrirEstrutura();
    if (a === "pessoas") abrirPessoas();
    if (a === "pedidos") { estado.vista.especial = "exclusao"; salvarVista(); renderizarTudo(); }
    if (a === "lixeira") abrirLixeira();
    if (a === "backups") abrirBackups();
    if (a === "compactar") compactarArquivo();
    if (a === "auditoria") abrirAuditoria();
  });
  pop.querySelector("button").focus();
}
const aguardando = () => estado.pessoas.filter((p) => p.pendente).length;
function atualizarBotaoAdmin() {
  const n = aguardando();
  $("#btn-admin").innerHTML = svg("i-engrenagem") + `<span>Administração${n ? ` (${n} aguardando)` : ""}</span>`;
  $("#btn-admin").title = n ? `${n} pessoa(s) aguardando liberação em Pessoas` : "";
}
atualizarBotaoAdmin();
$("#btn-admin").addEventListener("click", (e) => abrirMenuAdmin(e.currentTarget));

/* ------------------------------------------------------------
 *  Telas, botões do topo e estado sem estrutura
 * ------------------------------------------------------------ */
function mostrarTela(qual) {
  ["tela-carregando", "tela-login", "tela-bloqueio", "app"].forEach((id) => { $("#" + id).hidden = id !== qual; });
}
const BLOQUEADA = { titulo: "Acesso bloqueado", texto: "Seu acesso foi bloqueado. Fale com a Lays ou a Paula.", verificar: true };
const PENDENTE = { titulo: "Aguardando liberação", texto: "Seu registro foi recebido. A Lays ou a Paula precisam liberar o seu acesso; esta página abre sozinha quando isso acontecer.", verificar: true };
/* Registro aguardando liberação: a própria pessoa só lê o próprio perfil, e entra assim que ele é liberado */
function mostrarPendente(uid) {
  pararOuvintes();
  estado.mensagemBloqueio = PENDENTE;
  mostrarBloqueio(PENDENTE);
  estado.pararOuvintes.push(estado.api.ouvirDoc(`tickets-pessoas/${uid}`, (d) => {
    if (!d || d.pendente || estado.mensagemBloqueio !== PENDENTE) return;
    if (d.ativo) entrarComPerfil(uid, d);
    else { pararOuvintes(); estado.mensagemBloqueio = BLOQUEADA; mostrarBloqueio(BLOQUEADA); }
  }, (e) => console.warn("perfil", e)));
}
function mostrarBloqueio({ titulo, texto, verificar = false }) {
  $("#bloqueio-titulo").textContent = titulo;
  $("#bloqueio-texto").textContent = texto;
  $("#btn-bloqueio-verificar").hidden = !verificar;
  $("#btn-bloqueio-voltar").hidden = verificar;
  mostrarTela("tela-bloqueio");
}
$("#btn-bloqueio-voltar").addEventListener("click", () => { estado.mensagemBloqueio = null; mostrarRegistro(); });
$("#btn-bloqueio-verificar").addEventListener("click", () => location.reload());
function atualizarBotoes() {
  const alimenta = podeAlimentar();
  $$("[data-editor]").forEach((b) => { b.hidden = !alimenta; });
  $$("[data-admin]").forEach((b) => { b.hidden = !ehAdmin() || !estado.estrutura; });
  $("#btn-desfazer").disabled = !estado.desfazer.length;
  $("#menu-admin").hidden = !ehAdmin();
  $("#faixa-offline").hidden = !(estado.offline || (estado.usandoCopia && !estado.carregouTickets));
  $("#faixa-v2").hidden = !(ehAdmin() && v2Pendente());
}
$("#btn-faixa-v2").addEventListener("click", aplicarV2);
function atualizarTopo() {
  const u = estado.usuario;
  const admin = u.papel === "admin";
  /* Equipe: "Você: Nome" com o menu de identificação; administradora: nome e "Sair" */
  const botao = $("#btn-identidade");
  botao.hidden = admin;
  botao.innerHTML = `${svg("i-usuario")}<span>Você: ${escapar(u.nome)}</span>`;
  botao.title = u.email;
  botao.setAttribute("aria-label", `Você: ${u.nome} (${u.email}). Abrir opções de identificação`);
  $("#nome-usuario").hidden = !admin;
  $("#nome-usuario").textContent = u.nome || u.email;
  $("#nome-usuario").title = u.email;
  $("#btn-sair").hidden = !admin;
  const selo = $("#selo-papel");
  selo.textContent = { admin: "Administradora", equipe: "Equipe", leitura: "Leitura" }[u.papel];
  selo.className = `selo papel-${u.papel}`;
}
$("#btn-sair").innerHTML = svg("i-sair") + "<span>Sair</span>";
$("#btn-sair").addEventListener("click", () => sair());
$("#btn-identidade").addEventListener("click", (e) => {
  fecharPop();
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.style.width = "260px";
  pop.setAttribute("role", "menu");
  pop.innerHTML = `<p class="apoio" style="font-size:12px;overflow-wrap:anywhere">${escapar(estado.usuario.nome)}<br>${escapar(estado.usuario.email)}</p>
    <button type="button" class="item-menu" role="menuitem" data-id-acao="editar">${svg("i-lapis")}Editar minha identificação</button>
    <button type="button" class="item-menu" role="menuitem" data-id-acao="trocar">${svg("i-sair")}Trocar de pessoa</button>`;
  posicionarPop(pop, e.currentTarget, 260);
  pop.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-id-acao]");
    if (!b) return;
    fecharPop();
    if (b.dataset.idAcao === "editar") mostrarRegistro({ editar: true });
    if (b.dataset.idAcao === "trocar" && await confirmar("Trocar de pessoa? Este navegador esquece a identificação atual. As linhas que você registrou continuam na planilha, mas no modo “próprias” você deixa de poder editá-las.", { titulo: "Trocar de pessoa", botao: "Trocar de pessoa" })) {
      apagarLocal(CHAVE_IDENTIDADE);
      sair();
    }
  });
  pop.querySelector("button").focus();
});
$("#btn-marca").addEventListener("click", () => { window.scrollTo({ top: 0 }); const p = $("#planilha"); if (p) p.scrollTop = 0; });
function renderizarSemEstrutura() {
  const caixa = $("#sem-estrutura");
  const sem = estado.carregouEstrutura && !estado.estrutura;
  caixa.hidden = !sem;
  ["#resumo", "#abas", ".barra", "#area-dados"].forEach((s) => { $(s).hidden = sem; });
  if (!sem) return;
  if (!ehBanco()) {
    const nome = planilhaAtual().nome;
    caixa.innerHTML = ehAdmin()
      ? `<div class="cartao-login assistente-planilha"><div class="cabeca"><h2>Criar a planilha ${escapar(nome)}</h2>
          <p class="apoio">Escolha como começar. Depois dá para ajustar tudo em Administração › Estrutura.</p></div>
          <button type="button" class="caminho" data-criar="zero"><strong>Começar do zero</strong><span>Cria a planilha vazia e abre o modo Estrutura para montar as colunas.</span></button>
          <button type="button" class="caminho" data-criar="colar"><strong>Colar do Excel ou importar CSV</strong><span>A primeira linha vira as colunas (com o tipo sugerido pelo conteúdo) e as demais linhas viram os registros.</span></button>
          <button type="button" class="caminho" data-criar="copiar"><strong>Copiar a estrutura do ${escapar(PLANILHAS[0].nome)}</strong><span>Só as colunas, sem dados.</span></button></div>`
      : `<div class="cartao-login" style="margin:24px auto;text-align:center"><h2>${escapar(nome)}</h2><p class="apoio">Esta planilha ainda está sendo preparada pelas administradoras.</p></div>`;
    caixa.querySelectorAll("[data-criar]").forEach((b) => b.addEventListener("click", () => criarPlanilha(b.dataset.criar)));
    return;
  }
  caixa.innerHTML = ehAdmin()
    ? `<div class="cartao-login" style="margin:24px auto;text-align:center"><h2>A planilha ainda não tem estrutura</h2>
        <p class="apoio">Crie a estrutura sugerida (categorias Certificado digital, VIDaaS, SSL, Sistemas internos e Outros; colunas de identificação, cliente, problema, tratativa e controle). Depois dá para ajustar tudo em Administração › Estrutura.</p>
        <button type="button" class="btn" id="btn-criar-estrutura">${svg("i-mais")}Criar estrutura inicial</button></div>`
    : `<div class="cartao-login" style="margin:24px auto;text-align:center"><h2>Planilha em preparação</h2><p class="apoio">A planilha ainda não foi configurada. Fale com a Lays ou a Paula.</p></div>`;
  const b = $("#btn-criar-estrutura");
  if (b) b.addEventListener("click", criarEstruturaInicial);
}
async function criarEstruturaInicial() {
  if (!ehAdmin() || !conectado()) return;
  try {
    if (await estado.api.lerDoc(`${P()}-config/estrutura`)) { mostrarAviso("A estrutura já existe."); return; }
    const e = normalizarEstrutura(estruturaInicial());
    await estado.api.salvarDoc(`${P()}-config/estrutura`, dadosEstrutura(e));
    registrarAuditoria("estrutura", "Criou a estrutura inicial do Banco de Tickets");
    mostrarAviso("Estrutura criada. Ajuste o que quiser em Administração › Estrutura.", 5000);
  } catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); }
}

/* ------------------------------------------------------------
 *  Criar uma planilha vazia (SIG - INFORMAÇÕES): do zero, colando do Excel ou copiando a estrutura do Banco
 * ------------------------------------------------------------ */
const estruturaVazia = () => ({
  titulo: planilhaAtual().nome, versao: 1, categorias: [], colunas: [],
  gruposColunas: [{ id: "geral", nome: "Geral", ordem: 1 }],
  regras: { equipeEdita: "todas", janelaEdicaoHoras: 0, exportacao: true, registro: { ...REGISTRO_PADRAO } }
});
async function criarPlanilha(caminho) {
  if (!ehAdmin() || !conectado()) return;
  if (caminho === "colar") { abrirCriarPorColagem(); return; }
  try {
    if (await estado.api.lerDoc(`${P()}-config/estrutura`)) { mostrarAviso("Esta planilha já foi criada."); return; }
    let e;
    if (caminho === "copiar") {
      const banco = normalizarEstrutura(await estado.api.lerDoc(`${PLANILHAS[0].prefixo}-config/estrutura`));
      if (!banco) { mostrarAviso(`O ${PLANILHAS[0].nome} ainda não tem estrutura.`); return; }
      const { modelo: _m, atualizadoEm, atualizadoPor, ...colunasEtc } = banco;
      e = normalizarEstrutura({ ...colunasEtc, titulo: planilhaAtual().nome, versao: 1 });
    } else e = normalizarEstrutura(estruturaVazia());
    if (caminho === "zero") estado.abrirEstruturaAoCarregar = true;
    await estado.api.salvarDoc(`${P()}-config/estrutura`, dadosEstrutura(e));
    registrarAuditoria("estrutura", caminho === "copiar" ? `Criou a planilha copiando as colunas do ${PLANILHAS[0].nome}` : "Criou a planilha vazia");
    mostrarAviso(caminho === "copiar" ? `Planilha criada com as ${e.colunas.length} colunas do ${PLANILHAS[0].nome}.` : "Planilha criada. Monte as colunas no modo Estrutura.", 5000);
  } catch (err) { console.error(err); estado.abrirEstruturaAoCarregar = false; mostrarAviso(mensagemErro(err)); }
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
function abrirCriarPorColagem() {
  const d = criarDialogo({
    titulo: `Criar ${planilhaAtual().nome} colando do Excel`,
    largo: true,
    corpo: `<p class="lgpd">${escapar(AVISO_LGPD_COLUNAS)} Deixe essas colunas fora da colagem.</p>
      <div class="campos-linha">
        <label class="campo"><span class="rotulo">Cole aqui as células do Excel, com a linha de títulos</span><textarea name="colado" rows="6"></textarea></label>
        <label class="campo"><span class="rotulo">Ou escolha um arquivo .csv</span><input type="file" name="arquivo" accept=".csv,text/csv,.txt"></label>
      </div>
      <div id="criar-previa"></div>
      <p class="form-erro" role="alert" id="criar-erro"></p>
      <p class="apoio" role="status" id="criar-progresso"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn" id="criar-ok" disabled>Criar planilha</button></div>`
  });
  const form = d.querySelector("form");
  let tabela = [], colunas = [];
  const desenhar = () => {
    const titulos = tabela[0] || [], linhas = tabela.slice(1);
    const vistos = new Set();
    colunas = titulos.map((t, i) => {
      let nome = String(t || "").trim().slice(0, 60) || `Coluna ${i + 1}`;
      while (vistos.has(nomeComparavel(nome))) nome = `${nome} (${i + 1})`.slice(0, 60);
      vistos.add(nomeComparavel(nome));
      const valores = linhas.map((l) => l[i]);
      return { nome, tipo: sugerirTipo(valores), indice: i, distintos: new Set(valores.map((x) => String(x || "").trim()).filter(Boolean)).size, exemplo: String(valores.find((x) => String(x || "").trim()) || "").slice(0, 40) };
    });
    $("#criar-previa", d).innerHTML = titulos.length ? `<h3 style="font-size:15px">${colunas.length} coluna(s) e ${linhas.length} registro(s)</h3>
      <p class="apoio" style="font-size:13px">Confira o tipo de cada coluna. Lista: cada valor diferente vira uma opção (a equipe escolhe entre elas).</p>
      <div class="tabela-admin"><table><thead><tr><th>Coluna</th><th>Tipo</th><th>Exemplo</th><th>Valores diferentes</th></tr></thead><tbody>${colunas.map((c, i) => `<tr>
        <td><input data-criar-nome="${i}" value="${escapar(c.nome)}" maxlength="60" aria-label="Nome da coluna ${i + 1}"></td>
        <td><select data-criar-tipo="${i}" aria-label="Tipo da coluna ${escapar(c.nome)}">${TIPOS.filter((t) => !TIPOS_SEM_EDICAO.includes(t.id) && t.id !== "etiquetas").map((t) => `<option value="${t.id}"${c.tipo === t.id ? " selected" : ""}>${escapar(t.nome)}</option>`).join("")}</select></td>
        <td>${escapar(c.exemplo)}</td><td>${c.distintos}</td></tr>`).join("")}</tbody></table></div>` : "";
    $("#criar-ok", d).disabled = !titulos.length;
  };
  form.colado.addEventListener("input", () => { tabela = lerTabelaTexto(form.colado.value); desenhar(); });
  form.arquivo.addEventListener("change", async () => {
    const f = form.arquivo.files[0];
    if (!f) return;
    if (f.size > 20_000_000) { $("#criar-erro", d).textContent = "Arquivo grande demais (máx. 20 MB)."; return; }
    let texto = await f.text();
    if (texto.includes("\ufffd")) { try { texto = new TextDecoder("windows-1252").decode(await f.arrayBuffer()); } catch (e) {} }
    tabela = lerTabelaTexto(texto);
    desenhar();
  });
  d.addEventListener("input", (e) => { const i = e.target.dataset.criarNome; if (i != null) colunas[Number(i)].nome = e.target.value.trim().slice(0, 60); });
  d.addEventListener("change", (e) => { const i = e.target.dataset.criarTipo; if (i != null) colunas[Number(i)].tipo = e.target.value; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = $("#criar-erro", d), progresso = $("#criar-progresso", d), botao = $("#criar-ok", d);
    if (colunas.some((c) => !c.nome)) { erro.textContent = "Dê um nome a todas as colunas."; return; }
    if (new Set(colunas.map((c) => nomeComparavel(c.nome))).size !== colunas.length) { erro.textContent = "Há colunas com o mesmo nome."; return; }
    if (colunas.length > 70) { erro.textContent = "Use no máximo 70 colunas."; return; }
    const linhas = tabela.slice(1);
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
    const registros = linhas.map((l) => {
      const campos = {};
      estrutura.colunas.forEach((col, i) => {
        const bruto = String(l[colunas[i].indice] ?? "").trim();
        if (!bruto) return;
        const r = validarValor(col, bruto);
        campos[col.id] = r.ok && !estaVazio(r.valor) ? r.valor : bruto;
      });
      return { id: estado.api.novoId(P()), numero: "", campos, exclusao: null };
    }).filter((t) => Object.keys(t.campos).length);
    botao.disabled = true;
    erro.textContent = "";
    try {
      if (await estado.api.lerDoc(`${P()}-config/estrutura`)) { erro.textContent = "Esta planilha já foi criada."; botao.disabled = false; return; }
      progresso.textContent = `Gravando ${registros.length} registro(s)…`;
      const partes = await gravarArquivo(registros);
      await estado.api.salvarDoc(`${P()}-config/estrutura`, dadosEstrutura(estrutura));
      registrarAuditoria("importar", `Criou a planilha colando do Excel: ${estrutura.colunas.length} coluna(s), ${registros.length} registro(s)`, `${partes} documento(s) no arquivo compactado`);
      d.close();
      mostrarAviso(`Planilha criada: ${estrutura.colunas.length} coluna(s) e ${registros.length} registro(s).`, 6000);
    } catch (err) { console.error(err); botao.disabled = false; progresso.textContent = ""; erro.textContent = mensagemErro(err); }
  });
  d.showModal();
  form.colado.focus();
}

/* ------------------------------------------------------------
 *  "Se registre como:" (equipe, sem senha) e "Sou administradora"
 *  A identidade é declarada pela própria pessoa: login anônimo do
 *  Firebase + perfil em tickets-pessoas/{uid}. Fica lembrada neste
 *  navegador (sem saída automática para a equipe).
 * ------------------------------------------------------------ */
const formRegistro = $("#form-registro");
const formLogin = $("#form-login");
let editandoIdentidade = false;
/* Mesmo formato aceito pelo firestore.rules */
const RE_EMAIL_PESSOA = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const PARTICULAS = ["da", "das", "de", "do", "dos", "e", "di", "du", "del", "van", "von"];
function capitalizarNome(texto) {
  return String(texto || "").trim().replace(/\s+/g, " ").split(" ").map((p, i) => {
    const min = p.toLocaleLowerCase("pt-BR");
    if (i > 0 && PARTICULAS.includes(min)) return min;
    return min.replace(/(^|[-'’])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase("pt-BR"));
  }).join(" ");
}
/* Devolve { email, nome, erros: { email?, nome? } } */
function validarIdentidade(emailBruto, nomeBruto, registro) {
  const erros = {};
  const email = String(emailBruto || "").replace(/\s+/g, "").toLowerCase();
  if (!email) erros.email = "Informe o seu e-mail.";
  else if (email.length > 120 || !RE_EMAIL_PESSOA.test(email)) erros.email = "E-mail inválido. Exemplo: suaconta@valid.com";
  else if (ehEmailAdmin(email)) erros.email = "Este e-mail é de administradora. Use “Sou administradora”.";
  else if (registro && registro.dominios.length && !registro.dominios.includes(email.split("@")[1])) erros.email = `Use o seu e-mail corporativo (${registro.dominios.map((d) => "@" + d).join(" ou ")}).`;
  const nome = capitalizarNome(nomeBruto);
  if (!nome) erros.nome = "Informe o seu nome.";
  else if ((nome.match(/\p{L}/gu) || []).length < 2) erros.nome = "O nome precisa ter pelo menos 2 letras.";
  else if (nome.length > 80) erros.nome = "Use no máximo 80 caracteres.";
  return { email, nome, erros };
}
function marcarErrosIdentidade(erros, geral = "") {
  [["email", "#reg-email", "#reg-email-erro"], ["nome", "#reg-nome", "#reg-nome-erro"]].forEach(([campo, entrada, aviso]) => {
    $(aviso).textContent = erros[campo] || "";
    if (erros[campo]) $(entrada).setAttribute("aria-invalid", "true"); else $(entrada).removeAttribute("aria-invalid");
  });
  $("#registro-erro").textContent = geral;
  const primeiro = erros.email ? "#reg-email" : erros.nome ? "#reg-nome" : null;
  if (primeiro) $(primeiro).focus();
}
function mostrarRegistro({ editar = false } = {}) {
  if (estado.mensagemBloqueio && !editar) { mostrarBloqueio(estado.mensagemBloqueio); return; }
  editandoIdentidade = editar && !!estado.usuario;
  mostrarTela("tela-login");
  formRegistro.hidden = false;
  formLogin.hidden = true;
  $("#registro-titulo").textContent = editandoIdentidade ? "Editar minha identificação:" : "Se registre como:";
  $("#btn-registro-cancelar").hidden = !editandoIdentidade;
  $("#btn-sou-admin").parentElement.hidden = editandoIdentidade;
  $("#btn-registro-confirmar").textContent = editandoIdentidade ? "Salvar" : "Confirmar";
  const lembrada = editandoIdentidade ? { email: estado.usuario.email, nome: estado.usuario.nome } : lerLocal(CHAVE_IDENTIDADE, null) || {};
  formRegistro.email.value = lembrada.email || "";
  formRegistro.nome.value = lembrada.nome || "";
  marcarErrosIdentidade({});
  (formRegistro.email.value ? (formRegistro.nome.value ? $("#btn-registro-confirmar") : formRegistro.nome) : formRegistro.email).focus();
}
function mostrarLoginAdmin() {
  mostrarTela("tela-login");
  formRegistro.hidden = true;
  formLogin.hidden = false;
  $("#bloco-microsoft").hidden = !LOGIN_MICROSOFT;
  $("#login-erro").textContent = "";
  formLogin.email.focus();
}
$("#btn-sou-admin").addEventListener("click", mostrarLoginAdmin);
$("#btn-login-voltar").addEventListener("click", () => mostrarRegistro());
$("#btn-registro-cancelar").addEventListener("click", () => { editandoIdentidade = false; mostrarTela("app"); });
function mensagemRegistro(erro) {
  const c = (erro && erro.code) || "";
  if (/network|unavailable|deadline/.test(c)) return "Não foi possível entrar. Verifique a internet e tente de novo.";
  if (/operation-not-allowed|admin-restricted/.test(c)) return "O registro ainda não foi ativado. Fale com a Lays ou a Paula.";
  if (/too-many-requests|quota/.test(c)) return "Muitas tentativas. Espere alguns minutos e tente de novo.";
  if (/permission/.test(c)) return "Não foi possível registrar com esses dados. Confira o e-mail ou fale com a Lays ou a Paula.";
  return "Não foi possível entrar. Verifique a internet e tente de novo.";
}
formRegistro.addEventListener("submit", async (e) => {
  e.preventDefault();
  const api = estado.api;
  if (!api) { marcarErrosIdentidade({}, "Não foi possível entrar. Verifique a internet e tente de novo."); return; }
  let { email, nome, erros } = validarIdentidade(formRegistro.email.value, formRegistro.nome.value, estado.estrutura ? estado.estrutura.regras.registro : null);
  if (Object.keys(erros).length) { marcarErrosIdentidade(erros); return; }
  formRegistro.nome.value = nome;
  const botao = $("#btn-registro-confirmar");
  botao.disabled = true;
  estado.registrando = true;
  try {
    let u = api.usuarioAtual();
    if (!u || !u.anonimo) u = await api.entrarAnonimo();
    const cfg = normalizarEstrutura(await api.lerDoc("tickets-config/estrutura"));
    if (!cfg) { marcarErrosIdentidade({}, "A planilha ainda não foi configurada. Fale com a Lays ou a Paula."); return; }
    const registro = cfg.regras.registro;
    ({ erros } = validarIdentidade(email, nome, registro));
    if (Object.keys(erros).length) { marcarErrosIdentidade(erros); return; }
    const caminho = `tickets-pessoas/${u.uid}`;
    let perfil = await api.lerDoc(caminho);
    if (perfil && perfil.ativo === false) { if (perfil.pendente) mostrarPendente(u.uid); else { estado.mensagemBloqueio = BLOQUEADA; mostrarBloqueio(BLOQUEADA); } return; }
    if (!perfil) {
      if (!registro.aberto) { marcarErrosIdentidade({}, "Novos registros estão fechados no momento. Fale com a Lays ou a Paula."); return; }
      perfil = { nome, email, papel: registro.papelPadrao, ativo: !registro.aprovacao, ...(registro.aprovacao ? { pendente: true } : {}), criadoEm: "__AGORA__", ultimoAcesso: "__AGORA__" };
      await api.salvarDoc(caminho, perfil);
      gravarLocal(CHAVE_IDENTIDADE, { email, nome });
      if (registro.aprovacao) { mostrarPendente(u.uid); return; }
      perfil = { ...perfil, criadoEm: new Date().toISOString(), ultimoAcesso: new Date().toISOString() };
    } else if (perfil.nome !== nome || perfil.email !== email) {
      await api.salvarDoc(caminho, { nome, email }, true);
      perfil = { ...perfil, nome, email };
    }
    gravarLocal(CHAVE_IDENTIDADE, { email, nome });
    if (editandoIdentidade && estado.usuario && estado.usuario.id === u.uid) {
      editandoIdentidade = false;
      Object.assign(estado.usuario, { nome, email });
      atualizarTopo();
      mostrarTela("app");
      agendarRender();
      mostrarAviso("Identificação atualizada. Os registros novos usam o nome novo.");
      return;
    }
    entrarComPerfil(u.uid, perfil);
  } catch (err) {
    console.warn(err);
    marcarErrosIdentidade({}, mensagemRegistro(err));
  } finally {
    estado.registrando = false;
    botao.disabled = false;
  }
});
function mensagemLogin(erro) {
  const c = (erro && erro.code) || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return "E-mail ou senha incorretos.";
  if (/too-many-requests|quota/.test(c)) return "Muitas tentativas. Espere alguns minutos e tente de novo.";
  if (/network/.test(c)) return "Sem conexão. Verifique a internet e tente de novo.";
  if (/operation-not-allowed/.test(c)) return "Essa forma de entrar ainda não foi ativada.";
  if (/popup/.test(c)) return "A janela de login foi fechada ou bloqueada pelo navegador.";
  return "Não foi possível entrar agora. Tente de novo.";
}
formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = $("#login-erro");
  erro.textContent = "";
  const api = estado.api;
  if (!api) { erro.textContent = "Sem conexão com o servidor de login. Verifique a internet e recarregue a página."; return; }
  const email = formLogin.email.value.trim().toLowerCase();
  if (!email || !formLogin.senha.value) { erro.textContent = "Informe e-mail e senha."; (email ? formLogin.senha : formLogin.email).focus(); return; }
  if (!ehEmailAdmin(email)) { erro.textContent = "Esta entrada é só para as administradoras. Use “Voltar” e se registre."; return; }
  const botao = formLogin.querySelector('[type="submit"]');
  botao.disabled = true;
  try {
    await api.entrarSenha(email, formLogin.senha.value);
    formLogin.senha.value = "";
  } catch (err) {
    console.warn(err);
    erro.textContent = mensagemLogin(err);
  } finally { botao.disabled = false; }
});
$("#btn-microsoft").innerHTML = svg("i-microsoft") + "Entrar com Microsoft";
$("#btn-microsoft").addEventListener("click", async () => {
  try { await estado.api.entrarMicrosoft(); } catch (err) { console.warn(err); $("#login-erro").textContent = mensagemLogin(err); }
});

/* ------------------------------------------------------------
 *  Sessão: papel; saída automática após 12 h sem uso (só administradoras)
 * ------------------------------------------------------------ */
let ultimaGravacaoAtividade = 0;
function registrarAtividade(forcar) {
  if (!estado.usuario && !forcar) return;
  const agora = Date.now();
  if (!forcar && agora - ultimaGravacaoAtividade < 60000) return;
  ultimaGravacaoAtividade = agora;
  gravarLocal(CHAVE_ATIVIDADE, agora);
}
["pointerdown", "keydown", "wheel"].forEach((ev) => document.addEventListener(ev, () => registrarAtividade(false), { passive: true }));
function sessaoExpirou() {
  const ultima = Number(lerLocal(CHAVE_ATIVIDADE, 0));
  return !!ultima && Date.now() - ultima > LIMITE_INATIVIDADE_MS;
}
const SESSAO_ENCERRADA = { titulo: "Sessão encerrada", texto: "Sua sessão terminou depois de 12 horas sem uso. Entre de novo." };
setInterval(() => {
  if (ehAdmin() && sessaoExpirou()) sair(SESSAO_ENCERRADA);
}, 60000);
async function sair(mensagem) {
  estado.mensagemBloqueio = mensagem || null;
  apagarLocal(CHAVE_COPIA);
  apagarLocal(CHAVE_ATIVIDADE);
  pararOuvintes();
  fecharFicha();
  $$("dialog[open]").forEach((d) => d.close());
  try { if (estado.api) await estado.api.sair(); } catch (e) { console.warn(e); }
  estado.usuario = null;
  if (!estado.api) mostrarRegistro();
}
/* Desliga os ouvintes da planilha aberta e esquece os dados dela (a sessão continua) */
function pararOuvintesPlanilha() {
  estado.ouvintesPlanilha.forEach((f) => { try { f && f(); } catch (e) {} });
  estado.ouvintesPlanilha = [];
  if (pararHistorico) { pararHistorico(); pararHistorico = null; }
  Object.assign(estado, { estrutura: null, carregouEstrutura: false, tickets: [], carregouTickets: false, vivos: [], carregouVivos: false, arquivo: arquivoVazio(), carregouArquivo: false, vista: null, lixeira: [], desfazer: [], usandoCopia: false, selecionando: false, busca: "", visao: "padrao", cartoesLimite: 60, celula: null });
  cacheParte.clear();
  cacheBusca = new WeakMap();
  estado.selecionados.clear();
  estado.gruposFechados.clear();
  areaDados.innerHTML = "";
}
function pararOuvintes() {
  estado.pararOuvintes.forEach((f) => { try { f && f(); } catch (e) {} });
  estado.pararOuvintes = [];
  pararOuvintesPlanilha();
  estado.pessoas = [];
}
async function aoMudarUsuario(u) {
  /* Durante o "Confirmar" o próprio formulário termina a entrada */
  if (estado.registrando) return;
  pararOuvintes();
  if (!u) { estado.usuario = null; mostrarRegistro(); return; }
  if (!u.anonimo) {
    if (!ehEmailAdmin(u.email)) { await sair({ titulo: "Entrada não permitida", texto: "Só as administradoras entram com senha. Volte ao início e use “Se registre como:”." }); return; }
    if (sessaoExpirou()) { await sair(SESSAO_ENCERRADA); return; }
    registrarAtividade(true);
    estado.mensagemBloqueio = null;
    estado.usuario = { id: u.email, uid: u.uid, email: u.email, nome: (ADMINS.find((a) => a.email === u.email) || {}).nome || u.email, papel: "admin" };
    iniciarPlanilha();
    return;
  }
  /* Equipe: perfil declarado em tickets-pessoas/{uid} */
  let perfil = null, semConexao = false;
  try { perfil = await estado.api.lerDoc(`tickets-pessoas/${u.uid}`); }
  catch (e) { semConexao = !/permission/.test((e && e.code) || ""); }
  if (semConexao) {
    const copia = PLANILHAS.map((p) => lerLocal(p.id === PLANILHAS[0].id ? CHAVE_COPIA : `${CHAVE_COPIA}:${p.id}`, null)).find((c) => c && c.id === u.uid);
    if (copia) perfil = { nome: copia.nome, email: copia.email, papel: copia.papel, ativo: true };
    else { mostrarBloqueio({ titulo: "Sem conexão", texto: "Não foi possível abrir a planilha agora. Verifique a internet.", verificar: true }); return; }
  }
  if (!perfil) { estado.usuario = null; mostrarRegistro(); return; }
  if (perfil.ativo === false && perfil.pendente) { mostrarPendente(u.uid); return; }
  if (perfil.ativo === false) { estado.mensagemBloqueio = BLOQUEADA; mostrarBloqueio(BLOQUEADA); return; }
  entrarComPerfil(u.uid, perfil, { semConexao });
}
function entrarComPerfil(uid, perfil, { semConexao = false } = {}) {
  pararOuvintes();
  estado.mensagemBloqueio = null;
  estado.usuario = { id: uid, uid, email: perfil.email, nome: perfil.nome, papel: perfil.papel === "leitura" ? "leitura" : "equipe" };
  gravarLocal(CHAVE_IDENTIDADE, { email: perfil.email, nome: perfil.nome });
  const ultimo = Date.parse(perfil.ultimoAcesso || "");
  if (!semConexao && (isNaN(ultimo) || Date.now() - ultimo > 3600000)) {
    estado.api.salvarDoc(`tickets-pessoas/${uid}`, { ultimoAcesso: "__AGORA__" }, true).catch((e) => console.warn("ultimoAcesso:", e));
  }
  iniciarPlanilha();
  /* Bloqueio ou mudança de papel valem na hora */
  estado.pararOuvintes.push(estado.api.ouvirDoc(`tickets-pessoas/${uid}`, (d) => {
    if (!estado.usuario || estado.usuario.id !== uid || !d) return;
    if (d.ativo === false) { pararOuvintes(); estado.mensagemBloqueio = BLOQUEADA; mostrarBloqueio(BLOQUEADA); return; }
    const papelNovo = d.papel === "leitura" ? "leitura" : "equipe";
    if (papelNovo !== estado.usuario.papel) { estado.usuario.papel = papelNovo; atualizarTopo(); atualizarBotoes(); agendarRender(); }
  }, (e) => console.warn("perfil", e)));
}

/* ------------------------------------------------------------
 *  Dados em tempo real, cópia no navegador e sem conexão
 * ------------------------------------------------------------ */
const textoOuVazio = (v) => (typeof v === "string" ? v : "");
function normalizarTicket(d) {
  const ex = d.exclusao && typeof d.exclusao === "object" && d.exclusao.motivo != null
    ? { motivo: String(d.exclusao.motivo), por: String(d.exclusao.por || ""), porNome: textoOuVazio(d.exclusao.porNome), porEmail: textoOuVazio(d.exclusao.porEmail), em: d.exclusao.em || "" } : null;
  return {
    id: d.id, campos: d.campos && typeof d.campos === "object" ? d.campos : {}, numero: typeof d.numero === "string" ? d.numero : "",
    criadoPor: String(d.criadoPor || ""), criadoPorNome: textoOuVazio(d.criadoPorNome), criadoPorEmail: textoOuVazio(d.criadoPorEmail), criadoEm: d.criadoEm || "",
    atualizadoPor: String(d.atualizadoPor || ""), atualizadoPorNome: textoOuVazio(d.atualizadoPorNome), atualizadoPorEmail: textoOuVazio(d.atualizadoPorEmail), atualizadoEm: d.atualizadoEm || "",
    exclusao: ex, ...(d.parcial === true ? { parcial: true } : {})
  };
}
let temporizadorCopia = 0;
function salvarCopia() {
  clearTimeout(temporizadorCopia);
  temporizadorCopia = setTimeout(() => {
    if (!estado.usuario || !estado.estrutura || !estado.carregouTickets) return;
    /* O arquivo compactado não cabe no armazenamento do navegador: aí a cópia guarda só a identificação */
    gravarLocal(chaveCopia(), { id: estado.usuario.id, email: estado.usuario.email, nome: estado.usuario.nome, papel: estado.usuario.papel, salvaEm: new Date().toISOString(), estrutura: dadosEstruturaBackup(estado.estrutura), tickets: estado.arquivo.linhas.length ? null : estado.tickets });
  }, 1500);
}
function aplicarEstrutura(e) {
  estado.estrutura = e;
  recalcularColunas();
  cacheBusca = new WeakMap();
  if (e) { if (!estado.vista) carregarVista(); else ajustarVista(); }
}

/* ------------------------------------------------------------
 *  Planilhas: BANCO DE TICKETS e SIG - INFORMAÇÕES
 *  A aba ativa fica no endereço (#banco-tickets / #sig-informacoes) e neste navegador.
 * ------------------------------------------------------------ */
const planilhaDoEndereco = () => { const h = decodeURIComponent(location.hash.replace(/^#/, "")); return PLANILHAS.some((p) => p.id === h) ? h : ""; };
function planilhaInicial() {
  let salva = "";
  try { salva = localStorage.getItem(CHAVE_PLANILHA) || ""; } catch (e) {}
  return planilhaDoEndereco() || (PLANILHAS.some((p) => p.id === salva) ? salva : PLANILHAS[0].id);
}
function renderizarAbasPlanilhas() {
  $("#abas-planilhas").innerHTML = PLANILHAS.map((p) => `<button type="button" class="aba-grupo" role="tab" id="aba-planilha-${escapar(p.id)}" data-planilha="${escapar(p.id)}" aria-controls="conteudo-planilha" aria-selected="${p.id === estado.planilha}" tabindex="${p.id === estado.planilha ? 0 : -1}">${escapar(p.nome)}</button>`).join("");
  $("#conteudo-planilha").setAttribute("aria-labelledby", `aba-planilha-${estado.planilha}`);
}
function marcarPlanilha(id) {
  estado.planilha = PLANILHAS.some((p) => p.id === id) ? id : PLANILHAS[0].id;
  try { localStorage.setItem(CHAVE_PLANILHA, estado.planilha); } catch (e) {}
  if (planilhaDoEndereco() !== estado.planilha) history.replaceState(null, "", `#${estado.planilha}`);
  document.title = `${planilhaAtual().nome} · Suporte V/Cert`;
  $("#titulo-planilha").textContent = planilhaAtual().nome;
  renderizarAbasPlanilhas();
}
/* Trocar de aba troca tudo: estrutura, dados, resumo, filtros, visões e busca */
function trocarPlanilha(id) {
  if (id === estado.planilha) return;
  marcarPlanilha(id);
  if (estado.usuario && !$("#app").hidden) abrirPlanilha();
}
$("#abas-planilhas").addEventListener("click", (e) => {
  const b = e.target.closest("[data-planilha]");
  if (b) trocarPlanilha(b.dataset.planilha);
});
$("#abas-planilhas").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const i = PLANILHAS.findIndex((p) => p.id === estado.planilha);
  const j = e.key === "Home" ? 0 : e.key === "End" ? PLANILHAS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + PLANILHAS.length) % PLANILHAS.length;
  trocarPlanilha(PLANILHAS[j].id);
  $(`#aba-planilha-${PLANILHAS[j].id}`).focus();
});
window.addEventListener("hashchange", () => { const h = planilhaDoEndereco(); if (h && h !== estado.planilha) trocarPlanilha(h); });
/* Visões, filtros e rascunho do Banco de Tickets eram salvos sem o id da planilha */
function migrarChavesAntigas() {
  if (!ehBanco() || !estado.usuario) return;
  ["vista", "visoes", "rascunho"].forEach((nome) => {
    const antiga = lerLocal(chaveUsuarioAntiga(nome), null);
    if (antiga != null && lerLocal(chaveUsuario(nome), null) == null) gravarLocal(chaveUsuario(nome), antiga);
  });
}

/* Sessão (depois de entrar): topo, abas de planilha e, para administradoras, a lista de pessoas */
function iniciarPlanilha() {
  mostrarTela("app");
  atualizarTopo();
  marcarPlanilha(estado.planilha);
  if (ehAdmin()) {
    estado.pararOuvintes.push(estado.api.ouvirColecao("tickets-pessoas", (lista) => { estado.pessoas = lista; cacheBusca = new WeakMap(); atualizarBotaoAdmin(); if (estado.aoMudarPessoas) estado.aoMudarPessoas(); }, (e) => console.warn("pessoas", e)));
  }
  abrirPlanilha();
}
/* Abre a planilha ativa: só ela tem ouvintes (a outra não consome leituras) */
function abrirPlanilha() {
  pararOuvintesPlanilha();
  fecharPop();
  fecharCombo();
  if (!ficha.hidden) fecharFicha();
  $("#busca").value = "";
  migrarChavesAntigas();
  const api = estado.api;
  const copia = lerLocal(chaveCopia(), null);
  if (copia && copia.id === estado.usuario.id && Array.isArray(copia.tickets)) {
    aplicarEstrutura(normalizarEstrutura(copia.estrutura));
    estado.tickets = copia.tickets.map(normalizarTicket);
    estado.usandoCopia = true;
  }
  atualizarBotoes();
  renderizarSemEstrutura();
  if (estado.estrutura) renderizarTudo();
  const aoErro = (onde) => (e) => {
    console.warn(onde, e);
    if (/permission/.test((e && e.code) || "")) {
      if (ehAdmin()) { sair({ titulo: "Acesso encerrado", texto: "Não foi possível conferir o seu acesso. Entre de novo." }); return; }
      pararOuvintes(); estado.mensagemBloqueio = BLOQUEADA; mostrarBloqueio(BLOQUEADA); return;
    }
    estado.offline = true; atualizarBotoes(); agendarRender();
  };
  const ouvir = (f) => estado.ouvintesPlanilha.push(f);
  ouvir(api.ouvirDoc(`${P()}-config/estrutura`, (d) => {
    aplicarEstrutura(normalizarEstrutura(d));
    estado.carregouEstrutura = true;
    renderizarSemEstrutura();
    atualizarBotoes();
    salvarCopia();
    agendarRender();
    if (estado.estrutura && estado.abrirEstruturaAoCarregar) { estado.abrirEstruturaAoCarregar = false; setTimeout(abrirEstrutura, 200); }
  }, aoErro("estrutura")));
  /* A planilha só aparece depois que os registros vivos e o arquivo compactado chegaram */
  const aoChegarTickets = () => {
    if (!estado.carregouVivos || !estado.carregouArquivo) return;
    combinarTickets();
    estado.carregouTickets = true;
    estado.usandoCopia = false;
    if (!navigator.onLine) estado.offline = true; else estado.offline = false;
    atualizarBotoes();
    salvarCopia();
    agendarRender();
    const fid = ficha.dataset.id;
    if (!ficha.hidden && fid) {
      if (!porId(fid)) fecharFicha();
      else if (!ficha.dataset.editando && ficha.classList.contains("aberta") && !ficha.contains(document.activeElement)) abrirFicha(fid);
    }
  };
  ouvir(api.ouvirColecao(P(), (lista) => {
    const anteriores = estado.carregouVivos ? new Map(estado.vivos.map((t) => [t.id, JSON.stringify([t.campos, t.exclusao])])) : null;
    const novos = lista.map(normalizarTicket);
    if (anteriores) {
      const mudaram = novos.filter((t) => anteriores.get(t.id) !== JSON.stringify([t.campos, t.exclusao]));
      if (mudaram.length && mudaram.length <= 50) {
        const ate = Date.now() + 3500;
        mudaram.forEach((t) => { if (!estado.piscar.has(t.id)) estado.piscar.set(t.id, ate); });
        setTimeout(agendarRender, 3700);
      }
    }
    estado.vivos = novos;
    estado.carregouVivos = true;
    aoChegarTickets();
  }, aoErro("tickets")));
  ouvir(api.ouvirColecao(`${P()}-arquivo`, (lista) => {
    aplicarArquivo(lista);
    estado.carregouArquivo = true;
    aoChegarTickets();
  }, aoErro("arquivo")));
  if (ehAdmin()) ouvir(api.ouvirColecao(`${P()}-lixeira`, (lista) => { estado.lixeira = lista; if (estado.aoMudarLixeira) estado.aoMudarLixeira(); }, (e) => console.warn("lixeira", e)));
}
window.addEventListener("offline", () => { estado.offline = true; if (estado.usuario) { atualizarBotoes(); agendarRender(); } });
window.addEventListener("online", () => { estado.offline = false; if (estado.usuario) { atualizarBotoes(); agendarRender(); } });

/* ------------------------------------------------------------
 *  Início
 * ------------------------------------------------------------ */
ligarTema();
marcarPlanilha(planilhaInicial());
(async () => {
  const api = await conectar();
  estado.api = api;
  if (!api) { mostrarRegistro(); marcarErrosIdentidade({}, "Sem conexão com o servidor. Verifique a internet e recarregue a página."); return; }
  api.aoMudarUsuario((u) => { aoMudarUsuario(u).catch((e) => { console.error(e); mostrarBloqueio({ titulo: "Algo deu errado", texto: "Não foi possível abrir a planilha. Recarregue a página.", verificar: true }); }); });
})();
window.__bancoTickets = { estado };
