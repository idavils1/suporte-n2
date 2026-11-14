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
 *  (tickets-identidades, tickets-emails, tickets-pessoas) e as regras de registro
 *  (tickets-config) valem para as duas.
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
 *   tickets-identidades/{email} a "conta" da equipe: { email, nome, nomeChave, papel, ativo, aprovado,
 *                              criadoEm, criadoPorUid, atualizadoEm, revogadoAntesDe }. Só administradoras
 *                              e os aparelhos ligados a ela leem.
 *   tickets-emails/{email}     vazio: "este e-mail tem cadastro" (lido um por vez, nunca listado)
 *   tickets-pessoas/{uid}      o aparelho (login anônimo deste navegador): { email, nomeChave, vinculadoEm,
 *                              ultimoAcesso }. Cadastros antigos, ainda não unificados, guardam ali mesmo
 *                              { nome, email, papel, ativo, pendente } e continuam valendo.
 *   tickets-lixeira, tickets-backups, tickets-auditoria (só administradoras)
 * ============================================================
 */
import { injetarIcones } from "./icones.js";
import { conectar, ehEmailAdmin, ADMINS, LOGIN_MICROSOFT } from "./firebase.js";
import { criarAparencia } from "./aparencia.js";
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
const CHAVE_MARCADOR = "banco-tickets-marcador-removidas";
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
/* Visões, filtros e rascunho: por pessoa (e-mail; antes, o uid do navegador) e por planilha */
const idLocal = () => (estado.usuario && (estado.usuario.email || estado.usuario.id)) || "anonimo";
const chaveUsuario = (nome) => `banco-tickets-${nome}:${planilhaAtual().id}:${idLocal()}`;
const chaveUsuarioAntiga = (nome) => `banco-tickets-${nome}:${(estado.usuario && estado.usuario.id) || "anonimo"}`;
const chaveUsuarioPorUid = (nome) => `banco-tickets-${nome}:${planilhaAtual().id}:${(estado.usuario && estado.usuario.uid) || "anonimo"}`;
/* Última identificação usada (formato antigo): vira a primeira das contas recentes */
const CHAVE_IDENTIDADE = "banco-tickets-identidade";
const CHAVE_CONTAS = "banco-tickets-contas-recentes";
const CHAVE_TENTATIVAS = "banco-tickets-tentativas-nome";
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
/* MAX_OPCOES: opções ativas (as que aparecem para escolher). As removidas da lista continuam guardadas
   (o nome aparece nos registros que já as usam) até MAX_OPCOES_TOTAL por coluna. */
const MAX_OPCOES = 400;
const MAX_OPCOES_TOTAL = 1000;
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
/* Quem pode criar cadastro na tela de entrada (igual ao padrão do firestore.rules) */
/* aprovacao: o cadastro novo fica "aguardando liberação" até uma administradora liberar */
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
/* ativa: false = removida da lista (some das escolhas; os registros que já a usam continuam mostrando o nome).
   nomesAnteriores: nomes corrigidos em todos os registros ("antes chamada X"). */
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
    opcoes: (Array.isArray(c.opcoes) ? c.opcoes : []).map(normalizarOpcao).filter(Boolean).slice(0, MAX_OPCOES_TOTAL),
    ajuda: txt(c.ajuda, 200), acesso: acessoDe(c), somenteAdmin: acessoDe(c) === "bloqueado", ativa: c.ativa !== false,
    ...(c.origem === "categorias" ? { origem: "categorias" } : {}),
    ...(c.tipo === "automatico" ? { auto: AUTOS[c.auto] ? c.auto : "criadoEm" } : {}),
    ...(c.tipo === "derivado" ? { formula: FORMULAS[c.formula] ? c.formula : "diasEmAberto", de: txt(c.de, 40), ate: txt(c.ate, 40) } : {})
  }));
  /* Categoria removida da lista (ativa: false): continua guardada para o nome aparecer nos registros */
  const categorias = (Array.isArray(d.categorias) ? d.categorias : []).filter((c) => c && RE_OPCAO.test(c.id || ""))
    .map((c, i) => ({ id: c.id, nome: txt(c.nome, 60) || c.id, cor: CORES.includes(c.cor) ? c.cor : "", icone: txt(c.icone, 30), ordem: Number(c.ordem) || i + 1, ativa: c.ativa !== false,
      ...(c.ativa === false ? { removidaEm: txt(c.removidaEm, 40), removidaPor: txt(c.removidaPor, 120) } : {}) }));
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
  usuario: null,              // { id (uid ou e-mail da administradora), uid, email, nome, papel: "admin" | "equipe" | "leitura", vinculadoEm }
  registrando: 0,             // > 0 durante o "Entrar" (login anônimo + ligar o aparelho ou criar o cadastro)
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
  intervalo: null,            // células de uma coluna selecionadas juntas (Shift+clique, arrastar, Shift+setas)
  desfazer: [],
  piscar: new Map(),
  selecionando: false,
  selecionados: new Set(),
  lixeira: [],
  pessoas: [],                // tickets-pessoas (aparelhos), só administradoras
  identidades: [],            // tickets-identidades, só administradoras
  pararOuvintes: [],
  mensagemBloqueio: null
};
/* Aparência livre (aparencia.js): criada no fim do arquivo, depois de tudo definido */
let aparencia = null;
const SEM_APARENCIA = { l: "", c: {} };
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
  if (col.origem === "categorias") return [...estado.estrutura.categorias].sort((a, b) => a.ordem - b.ordem).map((c) => ({ id: c.id, nome: c.nome, cor: c.cor, ...(c.ativa ? {} : { ativa: false, removidaEm: c.removidaEm || "", removidaPor: c.removidaPor || "" }) }));
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
/* Aparelho (uid) → { nome, email }: o aparelho ligado não guarda o nome; ele vem da identidade */
function pessoaDoAparelho(uid) {
  const p = estado.pessoas.find((x) => x.id === uid);
  if (!p) return null;
  const i = p.vinculadoEm ? estado.identidades.find((x) => x.id === p.email) : null;
  return { nome: (i && i.nome) || p.nome || "", email: (i && i.email) || p.email || "" };
}
/* id = uid (equipe) ou e-mail (administradora; também os registros antigos) */
const nomePessoa = (id) => {
  const a = ADMINS.find((x) => x.email === id);
  if (a) return a.nome;
  if (estado.usuario && id === estado.usuario.id) return estado.usuario.nome || id;
  const p = pessoaDoAparelho(id);
  if (p && p.nome) return p.nome;
  const i = estado.identidades.find((x) => x.id === id);
  return (i && i.nome) || id || "";
};
/* Autoria gravada no registro (cópia do nome e do e-mail no momento da gravação).
   Registros antigos só têm o e-mail em criadoPor/atualizadoPor. */
const nomeAutor = (t, campo) => (t && (t[campo + "Nome"] || nomePessoa(t[campo]))) || "";
function emailAutor(t, campo) {
  if (!t) return "";
  if (t[campo + "Email"]) return t[campo + "Email"];
  const v = String(t[campo] || "");
  if (v.includes("@")) return v;
  const p = pessoaDoAparelho(v);
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
/* Opções para uma nova escolha: só as ativas, mais as removidas que o registro já tem (para não sumirem ao editar) */
const opcoesParaEscolha = (col, atual) => {
  const ja = new Set(Array.isArray(atual) ? atual : estaVazio(atual) ? [] : [atual]);
  return opcoesDe(col).filter((o) => o.ativa !== false || ja.has(o.id));
};
const rotuloEscolha = (o) => (o.ativa === false ? `${o.nome} (removido da lista)` : o.nome);

/* Validação: devolve { ok, valor } ou { ok: false, erro }. Vazio é válido (obrigatoriedade é conferida à parte). */
function chaveNumero(v) {
  return normalizar(v).toUpperCase().replace(/[^A-Z0-9._-]+/g, "-").replace(/^[-._]+|-+$/g, "").slice(0, 80);
}
/* "atual": valor que o registro já tem. Uma opção removida da lista só passa se já era o valor (ou uma das etiquetas). */
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
 *  Permissões (as mesmas do firestore.rules)
 * ------------------------------------------------------------ */
function dentroDaJanela(t) {
  const h = estado.estrutura ? estado.estrutura.regras.janelaEdicaoHoras : 0;
  if (!h) return true;
  const criado = Date.parse(t.criadoEm);
  return !isNaN(criado) && Date.now() - criado < h * 3600000;
}
/* "Próprias": pelo e-mail de quem registrou, em qualquer aparelho (igual ao firestore.rules) */
const registradoPorMim = (t) => !!t && !!t.criadoPorEmail && !!estado.usuario && t.criadoPorEmail === estado.usuario.email;
function podeEditarLinha(t) {
  if (!conectado() || !estado.estrutura || !t) return false;
  if (ehAdmin()) return true;
  if (papel() !== "equipe") return false;
  const regra = estado.estrutura.regras.equipeEdita;
  if (regra === "todas") return true;
  if (regra === "proprias") return registradoPorMim(t) && dentroDaJanela(t);
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
  if (regra === "proprias" && t && !registradoPorMim(t)) return "Você só pode editar as linhas que registrou.";
  if (regra === "proprias" && t && !dentroDaJanela(t)) return "O prazo para editar esta linha já passou.";
  return "Você não pode editar esta célula.";
}

/* ------------------------------------------------------------
 *  Visão de cada pessoa (colunas, larguras, filtros): só neste navegador
 * ------------------------------------------------------------ */
const versaoModelo = () => (modelo() ? modelo().versao : 0);
const VISTA_PADRAO = () => ({ colunas: colunasAtivas().map((c) => c.id), ocultas: [], larguras: {}, ordenar: { col: "", dir: 1 }, filtros: {}, agrupar: "", compacta: false, aba: "todos", especial: "", modelo: versaoModelo() });
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
/* Colunas novas criadas pelas administradoras aparecem para todos; as que a pessoa ocultou continuam ocultas */
function ajustarVista() {
  const v = estado.vista;
  delete v.cartoes;
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
  if (especial.startsWith("verificar:")) return problemasDoRegistro(t).includes(especial.slice(10));
  if (especial === "meus") return t.criadoPor === estado.usuario.id || registradoPorMim(t);
  return true;
}
/* Abas que filtram: categorias (estrutura antiga) ou, no modelo v2, as opções de ÁREA */
const colAbas = () => colCategoria() || colModelo("area");
/* Uma opção (ou categoria) removida da lista continua formando a sua aba enquanto tiver registros */
function abasDaPlanilha() {
  const col = colAbas();
  if (!col) return [];
  const usadas = new Set(estado.tickets.map((t) => (t.campos || {})[col.id]).filter(Boolean));
  return opcoesDe(col).filter((o) => o.ativa !== false || usadas.has(o.id)).map((o) => ({ id: o.id, nome: o.nome, cor: o.cor, removida: o.ativa === false ? o : null }));
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
  const verificando = String(esp || "").startsWith("verificar:") && PROBLEMAS[esp.slice(10)];
  if (verificando) partes.push(botao(esp, `${svg("i-alerta")}${escapar(verificando.curto)} <strong>${base.filter((t) => passaEspecial(t, esp)).length}</strong>`, "Registros apontados em Verificar dados (clique para tirar o filtro)"));
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
    opcoesDe(area).forEach((o) => {
      const n = estado.tickets.filter((t) => (t.campos || {})[area.id] === o.id).length;
      if (o.ativa === false && !n) return;
      partes.push(`<button type="button" data-aba-resumo="${escapar(o.id)}" aria-pressed="${estado.vista.aba === o.id}" title="${escapar(`Filtrar ÁREA: ${o.nome}`)}">${escapar(o.nome)}${marcaRemovida(o)} <strong>${n.toLocaleString("pt-BR")}</strong></button>`);
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
      if (o.ativa === false && !n) return;
      partes.push(botao(`status:${o.id}`, `<span class="ponto-cor${o.cor ? " cor-" + o.cor : ""}"></span>${escapar(o.nome)}${marcaRemovida(o)} <strong>${n}</strong>`, `Filtrar ${st.nome}: ${o.nome}`));
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
  $("#titulo-planilha").textContent = estado.estrutura.titulo;
  renderizarResumo();
  renderizarAbas();
  renderizarVisoes();
  const agrupaveis = colunasAtivas().filter((c) => [...TIPOS_LISTA, "pessoa", "booleano"].includes(c.tipo) || (c.tipo === "automatico" && /Por$/.test(c.auto)));
  $("#agrupar").innerHTML = `<option value="">Sem agrupar</option>${agrupaveis.map((c) => `<option value="${escapar(c.id)}"${estado.vista.agrupar === c.id ? " selected" : ""}>Agrupar por ${escapar(c.nome)}</option>`).join("")}`;
  $("#btn-densidade").setAttribute("aria-pressed", String(!!estado.vista.compacta));
  $("#btn-selecionar").setAttribute("aria-pressed", String(estado.selecionando));
  const n = estado.filtrados.length, total = estado.tickets.length;
  const filtrosAtivos = Object.values(estado.vista.filtros || {}).some((f) => f && ((f.valores && f.valores.length) || f.texto)) || estado.busca || estado.vista.especial;
  $("#contagem").textContent = `${n.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} registro${total === 1 ? "" : "s"}`;
  $("#btn-limpar-filtros").disabled = !filtrosAtivos;
  $("#btn-csv").hidden = !(ehAdmin() || estado.estrutura.regras.exportacao);
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
  return podeAlimentar() ? "Nenhum registro ainda. Use “Novo registro” ou a linha no fim da planilha." : "Nenhum registro ainda.";
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
  pares = pares.map(([t, m]) => [t, comDataDeConcessao(t.campos, m, (c) => podeEditarCelula(t, c))]);
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
const chaveUnicaRascunho = (c, v) => (c.id === idChave() ? chaveNumero(v) : normalizar(v));
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
  /* Opções removidas da lista que ainda têm registros: seção própria, também dá para filtrar por elas */
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
$("#btn-novo").innerHTML = svg("i-mais") + "Novo registro";
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
    corpo: `<p class="apoio">Mostre, oculte e reordene colunas só na sua visão. Para todos, só as administradoras mudam a estrutura.</p>
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
  const mudou = Object.fromEntries(Object.entries(mudancas).filter(([c, v]) => JSON.stringify((t.campos || {})[c] ?? vazioDe(COL[c])) !== JSON.stringify(v ?? vazioDe(COL[c]))));
  const reais = comDataDeConcessao(t.campos, mudou, (c) => podeEditarCelula(t, c));
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
/* Escritas de um registro novo (linha nova, formulário e preenchimento em massa usam o mesmo caminho) */
function opsCriarRegistro(camposBrutos) {
  const campos = filtrarCamposPermitidos(comDataDeConcessao({}, camposBrutos, podeNaLinhaNova));
  const id = estado.api.novoId(P());
  const numero = colNumero() && campos[idChave()] ? chaveNumero(campos[idChave()]) : "";
  const ops = [{ op: "set", caminho: `${P()}/${id}`, dados: { campos, numero, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura(), exclusao: null } }];
  if (numero) ops.push({ op: "set", caminho: `${P()}-numeros/${numero}`, dados: { ticket: id } });
  ops.push(opHistorico(id, "criar", { depois: resumoRegistro(campos) }));
  return { id, campos, numero, ops };
}
async function criarRegistro(camposBrutos, { semDesfazer = false } = {}) {
  const { id, numero, ops } = opsCriarRegistro(camposBrutos);
  const ok = await gravar(ops, {
    rotulo: "Registro removido",
    contexto: numero ? "numero" : "",
    desfazer: semDesfazer || !ehAdmin() ? null : async () => excluirDeVez([{ id, numero }], "Desfez a criação")
  });
  if (ok) document.dispatchEvent(new CustomEvent("planilha:salvou", { detail: { n: 1 } }));
  return ok ? id : null;
}
/* Desfazer um preenchimento em massa: apaga só os registros que ninguém alterou depois (excluir de vez é das administradoras) */
function desfazerCriacaoEmMassa(ids) {
  if (!ehAdmin()) return null;
  return async () => {
    const intactos = ids.map(porId).filter((t) => t && !t.arquivo && String(t.atualizadoEm) === String(t.criadoEm));
    if (intactos.length) await excluirDeVez(intactos.map((t) => ({ id: t.id, numero: t.numero || "" })), "Desfez o preenchimento em massa");
    if (intactos.length < ids.length) mostrarAviso(`${ids.length - intactos.length} registro(s) foram alterados depois e ficaram.`, 5000);
  };
}
/* Monta o registro completo: valores informados + padrões + categoria da aba atual.
   Ticket sem RESPONSÁVEL ainda não foi concedido: a DATA DE CONCESSÃO não recebe o padrão ("hoje"). */
function completarCampos(informados) {
  const campos = {};
  const data = colModelo("dataConcessao"), resp = colModelo("responsavel");
  colunasAtivas().forEach((c) => {
    if (!podeNaLinhaNova(c)) return;
    if (c.id in informados && !estaVazio(informados[c.id])) campos[c.id] = informados[c.id];
    else if (estado.vista.aba !== "todos" && colAbas() && c.id === colAbas().id && !opcaoRemovida(colAbas(), estado.vista.aba)) campos[c.id] = estado.vista.aba;
    else if (data && resp && c.id === data.id && estaVazio(informados[resp.id])) return;
    else { const p = valorPadrao(c); if (!estaVazio(p)) campos[c.id] = p; }
  });
  return campos;
}
/* RESPONSÁVEL e DATA DE CONCESSÃO andam juntos: quem passa a ser responsável por um ticket sem data o concede hoje.
   "antes" = campos atuais do registro ({} quando é novo); devolve as mudanças com a data, se for o caso. */
function comDataDeConcessao(antes, mudancas, podeData) {
  const data = colModelo("dataConcessao"), resp = colModelo("responsavel");
  if (!data || !resp || !podeData(data) || estaVazio(mudancas[resp.id]) || mudancas[resp.id] === (antes || {})[resp.id]) return mudancas;
  const atual = data.id in mudancas ? mudancas[data.id] : (antes || {})[data.id];
  return estaVazio(atual) ? { ...mudancas, [data.id]: hojeIso() } : mudancas;
}
async function avisarRepetido(erro) {
  if (await confirmar(erro.texto, { titulo: "Nº do ticket repetido", botao: "Abrir o registro existente" })) abrirFicha(erro.id);
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
    erro = el ? e : `${e} Use “Novo registro” para preencher todas as colunas.`;
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
/* atuais: campos que o registro já tem (edição na ficha); opções removidas da lista só passam se já estavam lá */
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
        const f = fora.get(chave) || { chave, col: COL[c], bruto, n: 0, sugestao: r.sugestao || null, removida: r.removida || null };
        f.n++;
        fora.set(chave, f);
        const escolha = trocas.get(chave) || "";
        if (escolha === "sugestao" && f.sugestao) informados[c] = f.sugestao.id;
        else if (escolha === "aceitar" && f.removida && ehAdmin()) informados[c] = f.removida.id;
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
        ${a.fora.map((f) => `<label><span><strong>${escapar(f.col.nome)}</strong>: <span class="valor-fora">“${escapar(f.bruto)}”</span>${f.removida ? ' <span class="apoio">Removido da lista: escolha outra opção ou deixe vazio</span>' : ""} · ${f.n} linha(s)</span>
          <select data-troca="${escapar(f.chave)}"><option value="">Corrigir depois (a linha não entra)</option>${f.removida && ehAdmin() ? `<option value="aceitar"${trocas.get(f.chave) === "aceitar" ? " selected" : ""}>Aceitar mesmo assim (manter o nome)</option>` : ""}${f.sugestao ? `<option value="sugestao"${trocas.get(f.chave) === "sugestao" ? " selected" : ""}>Usar “${escapar(f.sugestao.nome)}”</option>` : ""}<option value="vazio"${trocas.get(f.chave) === "vazio" ? " selected" : ""}>Deixar o campo vazio</option></select></label>`).join("")}</div>` : ""}
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
          const campos = comDataDeConcessao(l.existente.campos, { ...l.informados }, podeNaLinhaNova);
          ops.push(...opsAlteracao(l.existente, campos, "importar"));
          return;
        }
        const id = estado.api.novoId(P());
        ids.push(id);
        const campos = filtrarCamposPermitidos(comDataDeConcessao({}, l.campos, podeNaLinhaNova));
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
$("#btn-massa").addEventListener("click", abrirPreencherMassa);

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
  const { valores, erros } = lerFormulario(form, cols, t.campos || {});
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
/* Pessoas e cadastros valem para as duas planilhas: vão sempre para a auditoria do Banco de Tickets (prefixo "tickets") */
function registrarAuditoria(acao, resumo, detalhes = "", prefixo = P()) {
  if (!ehAdmin() || !estado.api) return;
  const id = estado.api.novoId(`${prefixo}-auditoria`);
  estado.api.salvarDoc(`${prefixo}-auditoria/${id}`, {
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
    baixarArquivo(`banco-de-tickets-${b.tipo === "pessoas" ? "cadastros" : "backup"}-${p.ano}-${p.mes}-${p.dia}-${p.hora}${p.minuto}.json`,
      JSON.stringify({ criadoEm: b.criadoEm, criadoPor: b.criadoPor, motivo: b.motivo, ...(b.tipo === "pessoas" ? { tipo: "pessoas" } : { estrutura }), registros }, null, 2), "application/json;charset=utf-8");
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
    const antesV2 = lista.find((b) => b.motivo === MOTIVO_BACKUP_V2 && b.tipo !== "pessoas");
    $("#lista-backups", d).innerHTML = (antesV2 ? `<div class="aviso-repetido" style="margin:8px">${svg("i-restaurar")}<span>Backup de antes da nova estrutura (v2): ${escapar(formatarData(antesV2.criadoEm, true))}, ${escapar(antesV2.totalRegistros)} registro(s).</span>
      <button type="button" class="btn btn-secundario btn-mini" data-bk="restaurar" data-id="${escapar(antesV2.id)}">Restaurar o backup de antes da v2</button></div>` : "") + (lista.length ? `<table><thead><tr><th>Quando</th><th>Motivo</th><th>Por</th><th>Registros</th><th></th></tr></thead><tbody>${lista.map((b) => `<tr>
      <td>${escapar(formatarData(b.criadoEm, true))}</td><td>${escapar(b.motivo)}</td><td>${escapar(nomePessoa(b.criadoPor))}</td><td>${escapar(b.totalRegistros)}</td>
      <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-bk="baixar" data-id="${escapar(b.id)}">${svg("i-download")}JSON</button>
        ${b.tipo === "pessoas" ? "" : `<button type="button" class="btn btn-secundario btn-mini" data-bk="restaurar" data-id="${escapar(b.id)}">${svg("i-restaurar")}Restaurar</button>`}
        <button type="button" class="acao-linha" data-bk="apagar" data-id="${escapar(b.id)}" title="Apagar este backup" aria-label="Apagar este backup">${svg("i-lixeira")}</button></td></tr>`).join("")}</tbody></table>` : `<p class="apoio" style="padding:12px">Nenhum backup ainda.</p>`);
  };
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-bk]");
    if (!b) return;
    const item = lista.find((x) => x.id === b.dataset.id);
    if (b.dataset.bk === "agora") { if (await criarBackup("Backup manual")) { mostrarAviso("Backup feito."); desenhar(); } }
    if (b.dataset.bk === "arquivo") { d.close(); restaurarDeArquivo(); }
    if (b.dataset.bk === "baixar" && item) baixarBackup(item);
    if (b.dataset.bk === "restaurar" && item && item.tipo !== "pessoas") { d.close(); restaurarBackup(item); }
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
      registrarAuditoria("editarMassa", `Definiu ${c.nome} = “${textoDoValor(c, r.valor)}” em ${lista.length} registro(s)`);
      d.close(); mostrarAviso(`${lista.length} registro(s) atualizados.`);
    }
  });
  d.showModal();
}

/* ------------------------------------------------------------
 *  Pessoas (só administradoras): uma linha por IDENTIDADE (e-mail), com os aparelhos dela.
 *  Os cadastros antigos (aparelho sem identidade) aparecem à parte até serem unificados.
 *  Tudo vai para a auditoria do Banco de Tickets.
 * ------------------------------------------------------------ */
const AVISO_SEM_SENHA = "A entrada é feita com e-mail e nome, sem senha. Qualquer pessoa que saiba os dois consegue entrar como esse cadastro. Bloqueie e desconecte se suspeitar de uso indevido.";
const cadastrosAntigos = () => estado.pessoas.filter((p) => !p.vinculadoEm);
const situacaoIdentidade = (i) => (i.ativo === false ? "bloqueada" : i.aprovado ? "ativa" : "aguardando");
const aparelhosDe = (email) => estado.pessoas.filter((p) => p.vinculadoEm && p.email === email);
const desconectado = (p, i) => !!(i && i.revogadoAntesDe) && !(Date.parse(p.vinculadoEm) >= Date.parse(i.revogadoAntesDe));
const maisRecente = (datas) => datas.filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).pop() || "";
const registrosDe = (email, uids) => { const s = new Set(uids); return estado.tickets.filter((t) => (email && t.criadoPorEmail === email) || s.has(t.criadoPor)).length; };
const SELO_SITUACAO = {
  ativa: '<span class="selo papel-equipe">Ativa</span>',
  aguardando: '<span class="selo-exclusao">Aguardando liberação</span>',
  bloqueada: '<span class="selo-exclusao">Bloqueada</span>'
};
const opcoesPapel = (atual) => `<option value="equipe"${atual === "equipe" ? " selected" : ""}>Equipe</option><option value="leitura"${atual === "leitura" ? " selected" : ""}>Leitura</option>`;
async function salvarIdentidade(i, dados, texto, caixaErro) {
  if (caixaErro) caixaErro.textContent = "";
  try {
    await estado.api.salvarDoc(`tickets-identidades/${i.id}`, { ...dados, atualizadoEm: "__AGORA__" }, true);
    registrarAuditoria("pessoa", `${texto}: ${i.nome} (${i.email})`, "", "tickets");
    mostrarAviso(`${texto}: ${i.nome}.`);
    return true;
  } catch (err) {
    console.error(err);
    if (caixaErro) caixaErro.textContent = mensagemErro(err); else mostrarAviso(mensagemErro(err));
    return false;
  }
}
async function salvarCadastroAntigo(p, dados, texto, caixaErro) {
  if (caixaErro) caixaErro.textContent = "";
  try {
    await estado.api.salvarDoc(`tickets-pessoas/${p.id}`, dados, true);
    registrarAuditoria("pessoa", `${texto} (cadastro antigo): ${p.nome} (${p.email})`, "", "tickets");
    mostrarAviso(`${texto}: ${p.nome}.`);
  } catch (err) { console.error(err); if (caixaErro) caixaErro.textContent = mensagemErro(err); }
}
function abrirPessoas() {
  const d = criarDialogo({
    titulo: "Pessoas",
    largo: true,
    corpo: `<p class="lgpd"><strong>Atenção:</strong> ${escapar(AVISO_SEM_SENHA)}</p>
      <p class="apoio">Lays e Paula são administradoras fixas e entram com senha. Antes de liberar um cadastro novo, confirme com a pessoa (por exemplo, pelo Teams) que foi ela mesma.</p>
      <div id="pessoas-unificar"></div>
      <div class="barra">
        <label class="busca"><span class="sr-only">Buscar pessoa</span>${svg("i-busca")}<input type="search" name="buscaPessoa" placeholder="Buscar por nome ou e-mail…" autocomplete="off"></label>
        <label class="sr-only" for="filtro-pessoas">Filtrar</label>
        <select id="filtro-pessoas" name="filtroPessoa"><option value="">Todas</option><option value="aguardando">Aguardando liberação</option><option value="ativa">Ativas</option><option value="bloqueada">Bloqueadas</option><option value="equipe">Equipe</option><option value="leitura">Leitura</option></select>
        <span class="contagem" id="contagem-pessoas" aria-live="polite"></span>
      </div>
      <div class="tabela-admin" id="lista-pessoas"></div>
      <div id="pessoas-antigas"></div>
      <p class="form-erro" role="alert" id="pessoas-erro"></p>`
  });
  const form = d.querySelector("form");
  form.addEventListener("submit", (e) => e.preventDefault());
  const erro = () => $("#pessoas-erro", d);
  const passa = (texto, situacao, papelPessoa) => {
    const termo = normalizar(form.buscaPessoa.value), filtro = form.filtroPessoa.value;
    return (!termo || normalizar(texto).includes(termo)) && (!filtro || filtro === situacao || filtro === papelPessoa);
  };
  const desenhar = () => {
    const antigos = cadastrosAntigos();
    const emailsAntigos = new Set(antigos.map((p) => normalizarEmail(p.email)));
    $("#pessoas-unificar", d).innerHTML = antigos.length
      ? `<div class="faixa-v2"><span>Há cadastros antigos para unificar: ${antigos.length} cadastro(s) de ${emailsAntigos.size} e-mail(s) ainda entram só pelo navegador em que a pessoa se registrou.</span><button type="button" class="btn btn-mini" data-unificar>${svg("i-pessoas")}Unificar cadastros por e-mail</button></div>`
      : "";
    const linhas = estado.identidades.map((i) => {
      const aps = aparelhosDe(i.id);
      return { i, aps, situacao: situacaoIdentidade(i), ultimo: maisRecente(aps.map((p) => p.ultimoAcesso)), conectados: aps.filter((p) => !desconectado(p, i)).length };
    }).filter((l) => passa(`${l.i.nome} ${l.i.email}`, l.situacao, l.i.papel))
      .sort((a, b) => (b.situacao === "aguardando") - (a.situacao === "aguardando") || String(a.i.nome || "").localeCompare(String(b.i.nome || ""), "pt-BR"));
    $("#contagem-pessoas", d).textContent = `${linhas.length} de ${estado.identidades.length} cadastro(s)`;
    $("#lista-pessoas", d).innerHTML = `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Aparelhos</th><th>Último acesso</th><th>Registros</th><th></th></tr></thead><tbody>
      ${linhas.map(({ i, aps, situacao, ultimo, conectados }) => `<tr data-identidade="${escapar(i.id)}"${situacao === "bloqueada" ? ' class="arquivada"' : ""}>
        <td>${escapar(i.nome)}</td><td>${escapar(i.email)}</td>
        <td><select data-papel aria-label="Papel de ${escapar(i.nome)}">${opcoesPapel(i.papel)}</select></td>
        <td>${SELO_SITUACAO[situacao]}</td>
        <td><button type="button" class="btn-link" data-aparelhos aria-label="Ver os aparelhos de ${escapar(i.nome)}">${conectados} de ${aps.length}</button></td>
        <td>${escapar(ultimo ? formatarData(ultimo, true) : "—")}</td>
        <td>${registrosDe(i.email, aps.map((p) => p.id))}</td>
        <td class="acoes-tab">${situacao === "aguardando"
          ? `<button type="button" class="btn btn-mini" data-liberar>Liberar</button><button type="button" class="btn btn-perigo btn-mini" data-recusar>Recusar</button>`
          : `<button type="button" class="btn ${situacao === "ativa" ? "btn-perigo" : "btn-secundario"} btn-mini" data-bloquear>${situacao === "ativa" ? "Bloquear" : "Desbloquear"}</button>`}
          <button type="button" class="btn btn-secundario btn-mini" data-corrigir-nome>${svg("i-lapis")}Corrigir nome</button></td></tr>`).join("")
        || `<tr><td colspan="8" class="apoio">${estado.identidades.length ? "Ninguém com esses filtros." : "Nenhum cadastro por e-mail ainda."}</td></tr>`}
      </tbody></table>`;
    const antigosVisiveis = antigos.map((p) => ({ p, situacao: p.pendente ? "aguardando" : p.ativo ? "ativa" : "bloqueada" }))
      .filter((l) => passa(`${l.p.nome} ${l.p.email}`, l.situacao, l.p.papel))
      .sort((a, b) => (b.situacao === "aguardando") - (a.situacao === "aguardando") || String(a.p.nome || "").localeCompare(String(b.p.nome || ""), "pt-BR"));
    $("#pessoas-antigas", d).innerHTML = antigos.length ? `<details class="pessoas-antigas"${antigosVisiveis.some((l) => l.situacao === "aguardando") ? " open" : ""}>
      <summary>Cadastros antigos ainda não unificados (${antigos.length})</summary>
      <p class="apoio" style="font-size:13px">Cada linha é um navegador. A pessoa só entra por ele até a unificação.</p>
      <div class="tabela-admin"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Criado em</th><th>Último acesso</th><th>Registros</th><th></th></tr></thead><tbody>
      ${antigosVisiveis.map(({ p, situacao }) => `<tr data-antigo="${escapar(p.id)}"${situacao === "bloqueada" ? ' class="arquivada"' : ""}>
        <td>${escapar(p.nome)}</td><td>${escapar(p.email)}</td>
        <td><select data-papel-antigo aria-label="Papel de ${escapar(p.nome)}">${opcoesPapel(p.papel)}</select></td>
        <td>${SELO_SITUACAO[situacao]}</td>
        <td>${escapar(formatarData(p.criadoEm, true))}</td><td>${escapar(p.ultimoAcesso ? formatarData(p.ultimoAcesso, true) : "—")}</td>
        <td>${registrosDe("", [p.id])}</td>
        <td class="acoes-tab">${situacao === "aguardando"
          ? `<button type="button" class="btn btn-mini" data-antigo-liberar>Liberar</button><button type="button" class="btn btn-perigo btn-mini" data-antigo-recusar>Recusar</button>`
          : `<button type="button" class="btn ${situacao === "ativa" ? "btn-perigo" : "btn-secundario"} btn-mini" data-antigo-bloquear>${situacao === "ativa" ? "Bloquear" : "Desbloquear"}</button>`}</td></tr>`).join("")
        || `<tr><td colspan="8" class="apoio">Ninguém com esses filtros.</td></tr>`}
      </tbody></table></div></details>` : "";
  };
  form.buscaPessoa.addEventListener("input", desenhar);
  form.filtroPessoa.addEventListener("change", desenhar);
  const identidadeDaLinha = (el) => { const tr = el.closest("[data-identidade]"); return tr ? estado.identidades.find((x) => x.id === tr.dataset.identidade) : null; };
  const antigoDaLinha = (el) => { const tr = el.closest("[data-antigo]"); return tr ? estado.pessoas.find((x) => x.id === tr.dataset.antigo) : null; };
  d.addEventListener("change", (e) => {
    const papelNovo = e.target.value === "leitura" ? "leitura" : "equipe";
    const texto = papelNovo === "leitura" ? "Mudou para Leitura" : "Mudou para Equipe";
    if (e.target.matches("[data-papel]")) { const i = identidadeDaLinha(e.target); if (i) salvarIdentidade(i, { papel: papelNovo }, texto, erro()).then((ok) => { if (!ok) desenhar(); }); }
    if (e.target.matches("[data-papel-antigo]")) { const p = antigoDaLinha(e.target); if (p) salvarCadastroAntigo(p, { papel: papelNovo }, texto, erro()); }
  });
  d.addEventListener("click", async (e) => {
    if (e.target.closest("[data-unificar]")) { d.close(); abrirUnificacao(); return; }
    const b = e.target.closest("button");
    if (!b) return;
    const i = identidadeDaLinha(b);
    if (i) {
      if (b.matches("[data-aparelhos]")) abrirAparelhos(i);
      if (b.matches("[data-corrigir-nome]")) corrigirNome(i);
      if (b.matches("[data-liberar]")) salvarIdentidade(i, { ativo: true, aprovado: true }, "Liberou o acesso", erro());
      if (b.matches("[data-recusar]") && await confirmar(`Recusar o cadastro de ${i.nome} (${i.email})? A pessoa fica bloqueada; dá para desbloquear depois.`, { titulo: "Recusar cadastro", botao: "Recusar", perigo: true })) salvarIdentidade(i, { ativo: false }, "Recusou o cadastro", erro());
      if (b.matches("[data-bloquear]")) {
        if (i.ativo === false) { salvarIdentidade(i, { ativo: true, aprovado: true }, "Desbloqueou", erro()); return; }
        if (await confirmar(`Bloquear ${i.nome} (${i.email})? A pessoa deixa de ver e de gravar na hora, em todos os aparelhos.`, { titulo: "Bloquear pessoa", botao: "Bloquear", perigo: true })) salvarIdentidade(i, { ativo: false }, "Bloqueou", erro());
      }
      return;
    }
    const p = antigoDaLinha(b);
    if (!p) return;
    if (b.matches("[data-antigo-liberar]")) salvarCadastroAntigo(p, { ativo: true, pendente: false }, "Liberou o acesso", erro());
    if (b.matches("[data-antigo-recusar]") && await confirmar(`Recusar o registro de ${p.nome} (${p.email})? A pessoa fica bloqueada; dá para desbloquear depois.`, { titulo: "Recusar registro", botao: "Recusar", perigo: true })) salvarCadastroAntigo(p, { ativo: false, pendente: false }, "Recusou o registro", erro());
    if (b.matches("[data-antigo-bloquear]")) {
      if (p.ativo && !(await confirmar(`Bloquear ${p.nome} (${p.email})? A pessoa deixa de ver e de gravar na hora.`, { titulo: "Bloquear pessoa", botao: "Bloquear", perigo: true }))) return;
      salvarCadastroAntigo(p, { ativo: !p.ativo }, p.ativo ? "Bloqueou" : "Desbloqueou", erro());
    }
  });
  const anterior = estado.aoMudarPessoas;
  estado.aoMudarPessoas = desenhar;
  d.addEventListener("close", () => { estado.aoMudarPessoas = anterior || null; });
  desenhar();
  d.showModal();
}
/* Corrigir o nome: a pessoa passa a entrar com o nome novo (os aparelhos já ligados continuam) */
function corrigirNome(i) {
  const d = criarDialogo({
    titulo: "Corrigir o nome",
    corpo: `<p class="apoio">${escapar(i.email)}</p>
      <label class="campo"><span class="rotulo">Nome</span><input name="nome" value="${escapar(i.nome)}" maxlength="80" autocomplete="off" aria-describedby="corrigir-nome-aviso"></label>
      <p class="lgpd" id="corrigir-nome-aviso">A pessoa passará a entrar com o novo nome. Os computadores em que ela já entrou continuam conectados; o nome antigo deixa de servir para entrar em outro computador.</p>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}Salvar o nome</button></div>`
  });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const caixa = form.querySelector(".form-erro");
    const { nome, chave, erro } = validarNome(form.nome.value);
    if (erro) { caixa.textContent = erro; form.nome.setAttribute("aria-invalid", "true"); form.nome.focus(); return; }
    if (nome === i.nome && chave === i.nomeChave) { d.close(); return; }
    if (await salvarIdentidade(i, { nome, nomeChave: chave }, `Corrigiu o nome (antes: ${i.nome})`, caixa)) d.close();
  });
  d.showModal();
  form.nome.focus();
}
/* Aparelhos (navegadores) ligados a uma identidade e "Desconectar todos os aparelhos" */
function abrirAparelhos(identidade) {
  const d = criarDialogo({
    titulo: `Aparelhos de ${identidade.nome}`,
    largo: true,
    corpo: `<p class="apoio">${escapar(identidade.email)}. Cada navegador em que a pessoa entrou com e-mail e nome é um aparelho.</p>
      <div class="tabela-admin" id="lista-aparelhos"></div>
      <p class="apoio" style="font-size:13px">“Desconectar todos os aparelhos” tira o acesso de todos os navegadores na hora. A pessoa precisa entrar de novo com e-mail e nome (bloqueie também se suspeitar que outra pessoa sabe os dois).</p>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button><button type="button" class="btn btn-perigo" data-desconectar>${svg("i-sair")}Desconectar todos os aparelhos</button></div>`
  });
  const atual = () => estado.identidades.find((x) => x.id === identidade.id) || identidade;
  const desenhar = () => {
    const i = atual();
    const aps = aparelhosDe(i.id).sort((a, b) => Date.parse(b.ultimoAcesso || b.vinculadoEm) - Date.parse(a.ultimoAcesso || a.vinculadoEm));
    $("#lista-aparelhos", d).innerHTML = aps.length ? `<table><thead><tr><th>Aparelho</th><th>Conectado em</th><th>Último acesso</th><th>Situação</th></tr></thead><tbody>${aps.map((p) => `<tr${desconectado(p, i) ? ' class="arquivada"' : ""}>
      <td><code>${escapar(p.id.slice(0, 8))}…</code></td><td>${escapar(formatarData(p.vinculadoEm, true))}</td><td>${escapar(p.ultimoAcesso ? formatarData(p.ultimoAcesso, true) : "—")}</td>
      <td>${desconectado(p, i) ? '<span class="selo-exclusao">Desconectado</span>' : '<span class="selo papel-equipe">Conectado</span>'}</td></tr>`).join("")}</tbody></table>`
      : `<p class="apoio" style="padding:12px">Nenhum aparelho ligado a este cadastro.</p>`;
    if (i.revogadoAntesDe) $("#lista-aparelhos", d).insertAdjacentHTML("beforeend", `<p class="apoio" style="padding:8px 12px;font-size:13px">Última desconexão: ${escapar(formatarData(i.revogadoAntesDe, true))}.</p>`);
  };
  d.querySelector("[data-desconectar]").addEventListener("click", async () => {
    const i = atual();
    if (!(await confirmar(`Desconectar todos os aparelhos de ${i.nome} (${i.email})? Quem estiver com a planilha aberta sai na hora e precisa entrar de novo com e-mail e nome.`, { titulo: "Desconectar todos os aparelhos", botao: "Desconectar", perigo: true }))) return;
    await salvarIdentidade(i, { revogadoAntesDe: "__AGORA__" }, "Desconectou todos os aparelhos", d.querySelector(".form-erro"));
  });
  const anterior = estado.aoMudarPessoas;
  estado.aoMudarPessoas = () => { if (anterior) anterior(); desenhar(); };
  d.addEventListener("close", () => { estado.aoMudarPessoas = anterior || null; });
  desenhar();
  d.showModal();
}

/* ------------------------------------------------------------
 *  Unificar cadastros por e-mail (só administradoras)
 *  Cada e-mail dos cadastros antigos vira uma identidade (ou completa a que já existe) e os
 *  aparelhos antigos daquele e-mail passam a seguir a identidade. Pode ser rodado de novo:
 *  o que já foi unificado não aparece mais.
 * ------------------------------------------------------------ */
const dataIso = (v) => { const t = Date.parse(v || ""); return isNaN(t) ? "" : new Date(t).toISOString(); };
function planoUnificacao() {
  const grupos = new Map(), ignorados = [];
  cadastrosAntigos().forEach((p) => {
    const email = normalizarEmail(p.email);
    if (email.length > 120 || !RE_EMAIL_PESSOA.test(email) || ehEmailAdmin(email)) { ignorados.push(p); return; }
    if (!grupos.has(email)) grupos.set(email, { email, aparelhos: [], variantes: new Set() });
    const g = grupos.get(email);
    g.aparelhos.push(p);
    if (String(p.email || "") !== email) g.variantes.add(String(p.email || ""));
  });
  const lista = [];
  grupos.forEach((g) => { const m = montarGrupoUnificacao(g); if (m) lista.push(m); else ignorados.push(...g.aparelhos); });
  return { grupos: lista.sort((a, b) => a.email.localeCompare(b.email)), ignorados };
}
function montarGrupoUnificacao(g) {
  const identidade = estado.identidades.find((i) => i.id === g.email) || null;
  const nomes = new Map();
  const somarNome = (nome, criadoEm, uid) => {
    const { nome: limpo, chave } = validarNome(nome);
    if (chave.length < 2) return;
    if (!nomes.has(chave)) nomes.set(chave, { chave, nome: limpo.slice(0, 80), desde: "", aparelhos: [], registros: 0 });
    const n = nomes.get(chave);
    const quando = dataIso(criadoEm);
    if (quando && (!n.desde || quando < n.desde)) n.desde = quando;
    if (uid) n.aparelhos.push(uid);
  };
  if (identidade) somarNome(identidade.nome, identidade.criadoEm, "");
  g.aparelhos.forEach((p) => somarNome(p.nome, p.criadoEm, p.id));
  if (!nomes.size) return null;
  nomes.forEach((n) => {
    const uids = new Set(n.aparelhos);
    n.registros = estado.tickets.filter((t) => uids.has(t.criadoPor) || (t.criadoPorEmail === g.email && normalizarNomeChave(t.criadoPorNome) === n.chave)).length;
  });
  /* Nome padrão: o do cadastro mais antigo */
  const listaNomes = [...nomes.values()].sort((a, b) => (a.desde || "9999").localeCompare(b.desde || "9999"));
  /* Papel e liberação: os do cadastro mais liberado; algum bloqueado deixa a identidade bloqueada (conferência) */
  const identidadeLiberada = !!identidade && identidade.ativo !== false && identidade.aprovado === true;
  const liberados = g.aparelhos.filter((p) => p.ativo === true);
  const bloqueado = g.aparelhos.some((p) => p.ativo === false && !p.pendente) || (!!identidade && identidade.ativo === false);
  const papeis = [...liberados.map((p) => p.papel), ...(identidadeLiberada ? [identidade.papel] : [])];
  const todos = papeis.length ? papeis : [...g.aparelhos.map((p) => p.papel), ...(identidade ? [identidade.papel] : [])];
  const maisAntigo = [...g.aparelhos].sort((a, b) => (dataIso(a.criadoEm) || "9999").localeCompare(dataIso(b.criadoEm) || "9999"))[0];
  const criadoEm = [...g.aparelhos.map((p) => dataIso(p.criadoEm)), identidade ? dataIso(identidade.criadoEm) : ""].filter(Boolean).sort()[0] || "";
  /* Cadastros repetidos do mesmo e-mail: fica o do navegador usado mais recentemente; os outros são apagados.
     Fica também quem é a única fonte do nome de algum registro antigo (registro sem o nome de quem fez). */
  const usoRecente = (p) => Date.parse(p.ultimoAcesso || p.criadoEm || "") || 0;
  const semNome = new Set(estado.tickets.flatMap((t) => [!t.criadoPorNome ? t.criadoPor : "", !t.atualizadoPorNome ? t.atualizadoPor : ""]).filter(Boolean));
  const ordenados = [...g.aparelhos].sort((a, b) => usoRecente(b) - usoRecente(a));
  const manter = ordenados.filter((p, i) => i === 0 || semNome.has(p.id));
  return {
    email: g.email, aparelhos: g.aparelhos, manter, repetidos: ordenados.filter((p) => !manter.includes(p)),
    variantes: [...g.variantes], identidade, nomes: listaNomes,
    aprovado: liberados.length > 0 || identidadeLiberada, bloqueado,
    papel: todos.includes("equipe") ? "equipe" : todos.includes("leitura") ? "leitura" : "equipe",
    criadoEm, criadoPorUid: maisAntigo ? maisAntigo.id : ""
  };
}
/* Backup do tickets-pessoas (e das identidades) antes de unificar: em tickets-backups (tipo "pessoas") e baixado em JSON */
async function backupCadastros(motivo) {
  try {
    const id = estado.api.novoId("tickets-backups");
    const semId = ({ id: _id, ...resto }) => resto;
    const registros = [
      ...estado.pessoas.map((p) => ({ id: `tickets-pessoas/${p.id}`, dados: semId(p) })),
      ...estado.identidades.map((i) => ({ id: `tickets-identidades/${i.id}`, dados: semId(i) }))
    ];
    const partes = [];
    let atual = [], tamanho = 0;
    registros.forEach((r) => {
      const n = bytes(JSON.stringify(r)) + 1;
      if (atual.length && tamanho + n > LIMITE_PARTE) { partes.push(atual); atual = []; tamanho = 0; }
      atual.push(r); tamanho += n;
    });
    if (atual.length) partes.push(atual);
    await estado.api.lote([
      { op: "set", caminho: `tickets-backups/${id}`, dados: { tipo: "pessoas", motivo: String(motivo).slice(0, 200), criadoPor: estado.usuario.email, criadoEm: "__AGORA__", totalRegistros: registros.length, partes: partes.length, versaoEstrutura: 0, estrutura: "null" } },
      ...partes.map((p, i) => ({ op: "set", caminho: `tickets-backups/${id}/partes/${i}`, dados: { indice: i, json: JSON.stringify(p) } }))
    ]);
    const agora = partesBrasilia();
    baixarArquivo(`banco-de-tickets-cadastros-${agora.ano}-${agora.mes}-${agora.dia}-${agora.hora}${agora.minuto}.json`,
      JSON.stringify({ criadoEm: new Date().toISOString(), criadoPor: estado.usuario.email, motivo, tipo: "pessoas", registros }, null, 2), "application/json;charset=utf-8");
    registrarAuditoria("backup", `Backup dos cadastros: ${motivo}`, `${estado.pessoas.length} aparelho(s) e ${estado.identidades.length} identidade(s)`, "tickets");
    return id;
  } catch (e) {
    console.error(e);
    mostrarAviso("Não foi possível fazer o backup dos cadastros. Nada foi alterado.", 6000);
    return null;
  }
}
function abrirUnificacao() {
  if (!ehAdmin() || !conectado()) return;
  const { grupos, ignorados } = planoUnificacao();
  if (!grupos.length) { mostrarAviso(ignorados.length ? `Nada para unificar: ${ignorados.length} cadastro(s) antigo(s) têm e-mail inválido ou de administradora.` : "Não há cadastros antigos para unificar.", 6000); return; }
  const novos = grupos.filter((g) => !g.identidade).length;
  const conflitosNome = grupos.filter((g) => g.nomes.length > 1);
  const bloqueios = grupos.filter((g) => g.bloqueado);
  const variantes = grupos.filter((g) => g.variantes.length);
  const totalAparelhos = grupos.reduce((s, g) => s + g.aparelhos.length, 0);
  const totalRepetidos = grupos.reduce((s, g) => s + g.repetidos.length, 0);
  const situacaoTexto = (g) => (g.bloqueado ? "Bloqueado" : g.aprovado ? "Ativo" : "Aguardando liberação");
  const d = criarDialogo({
    titulo: "Unificar cadastros por e-mail",
    largo: true,
    corpo: `<p class="apoio">Cada e-mail vira um cadastro só. A pessoa passa a entrar de qualquer computador com o mesmo e-mail e nome, e os navegadores em que ela já entrou continuam funcionando.</p>
      <ul class="lista-mudancas">
        <li><strong>${totalAparelhos}</strong> cadastro(s) antigo(s) de <strong>${grupos.length}</strong> e-mail(s).</li>
        <li>${novos} cadastro(s) novo(s) por e-mail${grupos.length - novos ? `; ${grupos.length - novos} e-mail(s) já têm cadastro e serão completados` : ""}.</li>
        <li>Nome: o do cadastro mais antigo. Papel e liberação: os do cadastro mais liberado. Se algum estiver bloqueado, o cadastro unificado fica bloqueado (confira abaixo).</li>
        ${totalRepetidos ? `<li><strong>${totalRepetidos}</strong> cadastro(s) repetido(s) do mesmo e-mail serão apagados; fica o do navegador usado mais recentemente. Quem usava um navegador apagado entra de novo com o mesmo e-mail e nome.</li>` : ""}
        ${ignorados.length ? `<li>${ignorados.length} cadastro(s) com e-mail inválido ou de administradora ficam como estão.</li>` : ""}
        <li>Antes de gravar, é feito um backup dos cadastros (em Backups e baixado neste computador).</li>
      </ul>
      ${conflitosNome.length ? `<h3 style="font-size:15px">Mesmo e-mail com nomes diferentes (${conflitosNome.length})</h3>
        <p class="apoio" style="font-size:13px">Escolha o nome oficial. A pessoa passa a entrar com ele.</p>
        ${conflitosNome.map((g, k) => `<fieldset class="conflito-nome"><legend>${escapar(g.email)}</legend>${g.nomes.map((n, j) => `<label class="check"><input type="radio" name="nome-${k}" data-nome-email="${escapar(g.email)}" value="${escapar(n.chave)}"${j === 0 ? " checked" : ""}>
          <span><strong>${escapar(n.nome)}</strong> <span class="apoio" style="font-size:12px">desde ${escapar(formatarData(n.desde) || "—")} · ${n.aparelhos.length} aparelho(s) · ${n.registros} registro(s)${n.aparelhos.length ? "" : " · cadastro por e-mail"}</span></span></label>`).join("")}</fieldset>`).join("")}` : ""}
      ${bloqueios.length ? `<h3 style="font-size:15px">Bloqueados (${bloqueios.length})</h3>
        <p class="apoio" style="font-size:13px">Algum cadastro destes e-mails está bloqueado. Por padrão, o cadastro unificado fica bloqueado.</p>
        <div class="tabela-admin"><table><thead><tr><th>E-mail</th><th>Nome(s)</th><th>Cadastros</th><th>O que fazer</th></tr></thead><tbody>${bloqueios.map((g) => `<tr>
          <td>${escapar(g.email)}</td><td>${escapar(g.nomes.map((n) => n.nome).join(", "))}</td>
          <td>${g.aparelhos.map((p) => (p.ativo === false && !p.pendente ? "bloqueado" : p.pendente ? "aguardando" : "ativo")).join(", ")}${g.identidade ? `, por e-mail: ${escapar(situacaoIdentidade(g.identidade))}` : ""}</td>
          <td><select data-bloqueio-email="${escapar(g.email)}" aria-label="O que fazer com ${escapar(g.email)}"><option value="manter">Manter bloqueado</option><option value="liberar">Liberar</option></select></td></tr>`).join("")}</tbody></table></div>` : ""}
      ${variantes.length ? `<h3 style="font-size:15px">E-mails escritos de jeitos diferentes (${variantes.length})</h3>
        <p class="apoio" style="font-size:13px">Diferem só por maiúsculas ou espaços e serão unidos:</p>
        <ul class="lista-mudancas">${variantes.map((g) => `<li>${g.variantes.map((v) => `“${escapar(v)}”`).join(", ")} → <strong>${escapar(g.email)}</strong></li>`).join("")}</ul>` : ""}
      <details><summary>Ver todos os e-mails (${grupos.length})</summary>
        <div class="tabela-admin"><table><thead><tr><th>E-mail</th><th>Nome</th><th>Cadastros</th><th>Papel</th><th>Situação</th><th></th></tr></thead><tbody>${grupos.map((g) => `<tr>
          <td>${escapar(g.email)}</td><td>${escapar(g.nomes[0].nome)}${g.nomes.length > 1 ? ` <span class="selo-exclusao">${g.nomes.length} nomes</span>` : ""}</td><td>${g.aparelhos.length}${g.repetidos.length ? ` (${g.repetidos.length} repetido(s) apagado(s))` : ""}</td>
          <td>${g.papel === "leitura" ? "Leitura" : "Equipe"}</td><td>${escapar(situacaoTexto(g))}</td><td>${g.identidade ? "já tem cadastro" : "novo"}</td></tr>`).join("")}</tbody></table></div></details>
      <p class="apoio" role="status" id="unificar-progresso"></p>
      <p class="form-erro" role="alert" id="unificar-erro"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-check")}Fazer backup e unificar</button></div>`
  });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!conectado()) { $("#unificar-erro", d).textContent = "Sem conexão. Tente de novo quando a internet voltar."; return; }
    const botao = form.querySelector('[type="submit"]');
    const progresso = $("#unificar-progresso", d);
    botao.disabled = true;
    progresso.textContent = "Fazendo o backup dos cadastros…";
    if (!(await backupCadastros("Antes de unificar os cadastros por e-mail"))) { botao.disabled = false; progresso.textContent = ""; return; }
    const ops = [], relatorio = [];
    let criadas = 0, completadas = 0, ligados = 0, apagados = 0, nomesEscolhidos = 0, liberadosNaConferencia = 0;
    grupos.forEach((g) => {
      const marcado = $$("[data-nome-email]", d).find((x) => x.dataset.nomeEmail === g.email && x.checked);
      const oficial = (marcado && g.nomes.find((n) => n.chave === marcado.value)) || g.nomes[0];
      const escolha = $$("[data-bloqueio-email]", d).find((x) => x.dataset.bloqueioEmail === g.email);
      const liberar = g.bloqueado && escolha && escolha.value === "liberar";
      const ativo = !g.bloqueado || liberar;
      const aprovado = g.aprovado || liberar;
      if (g.nomes.length > 1) { nomesEscolhidos++; relatorio.push(`${g.email}: nome oficial “${oficial.nome}” (outros: ${g.nomes.filter((n) => n !== oficial).map((n) => n.nome).join(", ")})`); }
      if (g.bloqueado) { if (liberar) liberadosNaConferencia++; relatorio.push(`${g.email}: ${liberar ? "liberado na conferência" : "mantido bloqueado"}`); }
      if (!g.identidade) {
        criadas++;
        ops.push({ op: "set", caminho: `tickets-identidades/${g.email}`, dados: {
          email: g.email, nome: oficial.nome, nomeChave: oficial.chave, papel: g.papel, ativo, aprovado,
          criadoEm: g.criadoEm ? `__DATA__:${g.criadoEm}` : "__AGORA__", ...(g.criadoPorUid ? { criadoPorUid: g.criadoPorUid } : {}), atualizadoEm: "__AGORA__"
        } });
      } else {
        const i = g.identidade;
        const mud = {};
        if (i.nomeChave !== oficial.chave) Object.assign(mud, { nome: oficial.nome, nomeChave: oficial.chave });
        if (i.papel !== g.papel) mud.papel = g.papel;
        if ((i.ativo !== false) !== ativo) mud.ativo = ativo;
        if (!!i.aprovado !== aprovado) mud.aprovado = aprovado;
        if (Object.keys(mud).length) { completadas++; ops.push({ op: "set", caminho: `tickets-identidades/${g.email}`, mesclar: true, dados: { ...mud, atualizadoEm: "__AGORA__" } }); }
      }
      ops.push({ op: "set", caminho: `tickets-emails/${g.email}`, dados: {} });
      g.manter.forEach((p) => { ligados++; ops.push({ op: "set", caminho: `tickets-pessoas/${p.id}`, mesclar: true, dados: { email: g.email, nomeChave: oficial.chave, vinculadoEm: "__AGORA__" } }); });
      g.repetidos.forEach((p) => { apagados++; ops.push({ op: "delete", caminho: `tickets-pessoas/${p.id}` }); });
      if (g.repetidos.length) relatorio.push(`${g.email}: ${g.repetidos.length} cadastro(s) repetido(s) apagado(s)`);
    });
    progresso.textContent = `Gravando ${grupos.length} cadastro(s)…`;
    try { await estado.api.lote(ops); }
    catch (err) {
      console.error(err);
      botao.disabled = false;
      progresso.textContent = "";
      $("#unificar-erro", d).textContent = `${mensagemErro(err)} O que foi gravado continua valendo; rode a unificação de novo para terminar.`;
      registrarAuditoria("unificar", "Unificação de cadastros interrompida", mensagemErro(err), "tickets");
      return;
    }
    const resumo = `${criadas} cadastro(s) por e-mail criado(s), ${completadas} completado(s), ${ligados} aparelho(s) ligado(s), ${apagados} repetido(s) apagado(s), ${nomesEscolhidos + bloqueios.length} conflito(s) resolvido(s)`;
    registrarAuditoria("unificar", `Unificou os cadastros por e-mail: ${resumo}`, relatorio.join(" · ").slice(0, 1500), "tickets");
    d.close();
    await confirmar(`Pronto: ${resumo}. ${liberadosNaConferencia ? `${liberadosNaConferencia} bloqueado(s) liberado(s) na conferência. ` : ""}Daqui em diante, essas pessoas entram de qualquer computador com o mesmo e-mail e nome.`, {
      titulo: "Cadastros unificados", botao: "OK", cancelar: false,
      html: relatorio.length ? `<ul class="lista-mudancas">${relatorio.slice(0, 60).map((x) => `<li>${escapar(x)}</li>`).join("")}${relatorio.length > 60 ? `<li>… e mais ${relatorio.length - 60}</li>` : ""}</ul>` : ""
    });
  });
  d.showModal();
}

/* ------------------------------------------------------------
 *  Estrutura (modo "Estrutura": só administradoras)
 *  Tudo é editado num rascunho; "Aplicar" mostra a prévia, faz backup,
 *  migra os dados (conversões de tipo e colunas excluídas) e só então grava a
 *  estrutura nova. Mudar opções ou categorias nunca regrava registros.
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
/* Quantos registros usam cada opção: registros (vivos e do arquivo compactado) e os da lixeira.
   Os backups não são conferidos (ver o aviso no editor). */
function usoDasOpcoes(colId) {
  const uso = new Map();
  const somar = (v) => (Array.isArray(v) ? v : estaVazio(v) ? [] : [v]).forEach((x) => uso.set(x, (uso.get(x) || 0) + 1));
  estado.tickets.forEach((t) => somar((t.campos || {})[colId]));
  estado.lixeira.forEach((x) => somar(x.dados && x.dados.campos && x.dados.campos[colId]));
  return uso;
}
/* "lays.almeida@valid.com" → "Lays" (quem removeu uma opção da lista) */
const nomeCurto = (x) => { const s = String(x || ""); if (!s.includes("@")) return s; const p = s.split(/[.@]/)[0]; return p.charAt(0).toUpperCase() + p.slice(1); };
const textoRemovidaEm = (o) => [o.removidaEm ? `removida em ${formatarData(o.removidaEm)}` : "removida", o.removidaPor ? `por ${nomeCurto(o.removidaPor)}` : ""].filter(Boolean).join(" ");
const TITULO_TIRAR = "Some das escolhas. Os registros que já usam este nome continuam iguais.";
const tituloEmUso = (n) => `Em uso em ${n} registro(s). Para não perder o nome, ela só pode ser removida da lista.`;
/* Renomear uma opção que já tem registros: corrigir o nome em todos ou manter o antigo nos registros existentes */
function perguntarRenomear(antigo, novo, n) {
  return new Promise((resolver) => {
    const d = criarDialogo({ titulo: "Renomear opção", corpo: `<p class="apoio">“${escapar(antigo)}” → “${escapar(novo)}”. ${n} registro(s) usam esta opção.</p>
      <div class="escolhas-renomear">
        <label class="check"><input type="radio" name="modo" value="manter" checked> <span><strong>Manter o nome antigo nos registros existentes</strong> e usar o novo daqui para frente<br><span class="apoio">“${escapar(antigo)}” sai da lista (continua nos registros) e “${escapar(novo)}” entra no lugar. Nenhum registro é regravado.</span></span></label>
        <label class="check"><input type="radio" name="modo" value="corrigir"> <span><strong>Corrigir o nome em TODOS os registros</strong> (ex.: erro de digitação)<br><span class="apoio">Os ${n} registro(s) passam a mostrar “${escapar(novo)}”. O histórico guarda que antes se chamava “${escapar(antigo)}”.</span></span></label>
      </div>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Continuar</button></div>` });
    let valor = null;
    d.querySelector("form").addEventListener("submit", (e) => { valor = e.target.modo.value; });
    d.addEventListener("close", () => resolver(valor));
    d.showModal();
  });
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
      const ativas = cats.filter((c) => c.ativa), removidas = cats.filter((c) => !c.ativa);
      const usoCat = colCategoria() ? usoDasOpcoes(colCategoria().id) : new Map();
      /* Remover da lista não mexe nos registros: a categoria some das escolhas e o nome continua neles */
      const linhaCat = (c) => {
        const n = usoCat.get(c.id) || 0;
        return `<tr data-cat="${escapar(c.id)}"${c.ativa ? "" : ' class="arquivada"'}>
          <td class="acoes-tab" style="justify-content:flex-start">${c.ativa ? `<button type="button" class="acao-linha" data-est="cat-subir" aria-label="Subir">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-est="cat-descer" aria-label="Descer">${svg("i-seta-baixo")}</button>` : ""}</td>
          <td>${c.ativa ? `<input data-cat-campo="nome" value="${escapar(c.nome)}" maxlength="60" aria-label="Nome da categoria">` : `<span class="nome-removido">${escapar(c.nome)}</span><div class="apoio" style="font-size:11px">${escapar(textoRemovidaEm(c))}</div>`}</td>
          <td><select data-cat-campo="cor" aria-label="Cor">${["", ...CORES].map((x) => `<option value="${x}"${c.cor === x ? " selected" : ""}>${x ? NOME_COR[x] : "Sem cor"}</option>`).join("")}</select></td>
          <td>${n}</td>
          <td class="acoes-tab">${c.ativa
            ? `<button type="button" class="acao-linha" data-est="cat-tirar" title="${TITULO_TIRAR}" aria-label="Remover da lista: ${escapar(c.nome)}">${svg("i-olho-cortado")}</button>`
            : `<button type="button" class="btn btn-secundario btn-mini" data-est="cat-voltar">${svg("i-restaurar")}Voltar para a lista</button>${n
              ? `<span class="info-uso" title="${escapar(tituloEmUso(n))}" aria-label="${escapar(tituloEmUso(n))}">${svg("i-info")}</span>`
              : `<button type="button" class="btn btn-secundario btn-mini" data-est="cat-excluir">${svg("i-lixeira")}Excluir de vez</button>`}`}</td></tr>`;
      };
      alvo.innerHTML = `<div class="form-botoes" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn btn-mini" data-est="nova-categoria">${svg("i-mais")}Nova categoria</button></div>
        <div class="tabela-admin"><table><thead><tr><th>Ordem</th><th>Nome</th><th>Cor</th><th>Registros</th><th></th></tr></thead><tbody>${ativas.map(linhaCat).join("")}
          ${removidas.length ? `<tr><td colspan="5" class="apoio" style="font-size:12px"><strong>Removidas da lista (${removidas.length})</strong>: não aparecem para novas escolhas; os registros continuam com o nome. A contagem inclui o arquivo compactado e a lixeira (os backups não são conferidos).</td></tr>${removidas.map(linhaCat).join("")}` : ""}</tbody></table></div>`;
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
        <p class="lgpd" style="margin-top:10px">No modo “próprias”, a pessoa edita o que registrou com o mesmo e-mail, em qualquer computador. Linhas antigas sem o e-mail de quem registrou só as administradoras editam.</p>
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
    if (t.dataset.catCampo) { const c = r.categorias.find((x) => x.id === t.closest("[data-cat]").dataset.cat); c[t.dataset.catCampo] = t.value.slice(0, 60); }
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
  d.addEventListener("change", (e) => { if (e.target.dataset.catCampo === "cor") { e.target.dispatchEvent(new Event("input", { bubbles: true })); desenhar(); } });
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
    if (a === "cat-tirar" && cat) { Object.assign(cat, { ativa: false, removidaEm: new Date().toISOString(), removidaPor: estado.usuario.email }); desenhar(); }
    if (a === "cat-voltar" && cat) { cat.ativa = true; delete cat.removidaEm; delete cat.removidaPor; desenhar(); }
    /* Excluir de vez: só categoria removida e sem nenhum registro (senão o nome se perderia) */
    if (a === "cat-excluir" && cat) {
      const usados = colCategoria() ? usoDasOpcoes(colCategoria().id).get(cat.id) || 0 : 0;
      if (usados) { mostrarAviso(tituloEmUso(usados), 6000); return; }
      r.categorias = r.categorias.filter((c) => c !== cat);
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
        const ativas = opcoes.map((o, i) => [o, i]).filter(([o]) => o.ativa !== false);
        const removidas = opcoes.map((o, i) => [o, i]).filter(([o]) => o.ativa === false);
        extra.innerHTML = `<h3 style="font-size:14px;margin-top:6px">Opções (${ativas.length} na lista${removidas.length ? `, ${removidas.length} removida(s)` : ""})</h3><div class="opcoes-editor">${ativas.map(([o, i]) => `<div class="opcao" data-op="${i}">
            <span class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-op-mover="-1" aria-label="Subir ${escapar(o.nome)}">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-op-mover="1" aria-label="Descer ${escapar(o.nome)}">${svg("i-seta-baixo")}</button></span>
            <input data-op-campo="nome" value="${escapar(o.nome)}" maxlength="100" aria-label="Nome da opção">
            <select data-op-campo="cor" aria-label="Cor">${["", ...CORES].map((x) => `<option value="${x}"${o.cor === x ? " selected" : ""}>${x ? NOME_COR[x] : "Sem cor"}</option>`).join("")}</select>
            ${tipo === "status" ? `<label class="check" style="font-size:12px"><input type="checkbox" data-op-campo="final"${o.final ? " checked" : ""}> Encerra</label>` : "<span></span>"}
            <span class="apoio uso-opcao" title="Registros que usam esta opção">${o.id ? `${usoDe(o)} reg.` : "nova"}</span>
            <span class="acoes-tab">${o.id && usoDe(o) ? `<button type="button" class="acao-linha" data-op-substituir="${i}" title="Substituir valor nos registros" aria-label="Substituir “${escapar(o.nome)}” nos registros">${svg("i-ordenar")}</button>` : ""}<button type="button" class="acao-linha" data-op-tirar="${i}" title="${o.id ? TITULO_TIRAR : "Tirar esta opção nova"}" aria-label="Remover da lista: ${escapar(o.nome)}">${svg(o.id ? "i-olho-cortado" : "i-fechar")}</button></span></div>`).join("")}</div>
          ${removidas.length ? `<details class="opcoes-removidas"${removidasAbertas ? " open" : ""}><summary>Removidas da lista (${removidas.length})</summary>
            <p class="apoio" style="font-size:12px">Não aparecem para novas escolhas. Os registros que já as usam continuam mostrando o nome. A contagem inclui o arquivo compactado e a lixeira (os backups não são conferidos).</p>
            ${removidas.map(([o, i]) => `<div class="opcao removida" data-op="${i}">
              <span class="nome-removido">${escapar(o.nome)}</span>
              <span class="apoio">${escapar(textoRemovidaEm(o))} · ${usoDe(o)} registro(s)</span>
              <span class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-op-voltar="${i}">${svg("i-restaurar")}Voltar para a lista</button>
              ${usoDe(o) ? `<button type="button" class="acao-linha" data-op-substituir="${i}" title="Substituir valor nos registros" aria-label="Substituir “${escapar(o.nome)}” nos registros">${svg("i-ordenar")}</button><span class="info-uso" title="${escapar(tituloEmUso(usoDe(o)))}" aria-label="${escapar(tituloEmUso(usoDe(o)))}">${svg("i-info")}</span>`
                : `<button type="button" class="btn btn-secundario btn-mini" data-op-excluir="${i}">${svg("i-lixeira")}Excluir de vez</button>`}</span></div>`).join("")}</details>` : ""}
          <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-secundario btn-mini" data-op-nova>${svg("i-mais")}Adicionar opção</button>
          <button type="button" class="btn btn-secundario btn-mini" data-op-colar>Colar várias opções</button>
          ${antesOriginal && !TIPOS_LISTA.includes(antesOriginal.tipo) ? `<button type="button" class="btn btn-secundario btn-mini" data-op-dos-valores>Criar opções com os valores atuais</button>` : ""}</div>
          <div id="op-colar" hidden><label class="campo"><span class="rotulo">Uma opção por linha (as que já existem são ignoradas)</span><textarea rows="5" data-op-colar-texto></textarea></label>
            <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-mini" data-op-colar-ok>Adicionar estas opções</button></div></div>
          <p class="ajuda">Mudar a lista nunca altera os registros: “Remover da lista” só tira a opção das novas escolhas, e o nome continua nos registros que já o usam. Ao renomear uma opção em uso, você escolhe se corrige o nome em todos ou se mantém o antigo.${tipo === "status" ? " “Encerra” marca as opções que tiram o registro de “em aberto”." : ""}${tipo === "prioridade" ? " A última opção conta como “crítica” no resumo." : ""}</p>`;
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
      /* Remover da lista: a opção sai das escolhas; nenhum registro é alterado */
      const tirar = e.target.closest("[data-op-tirar]");
      if (tirar) {
        const o = opcoes[Number(tirar.dataset.opTirar)];
        if (!o.id) opcoes = opcoes.filter((x) => x !== o);
        else Object.assign(o, { ativa: false, removidaEm: new Date().toISOString(), removidaPor: estado.usuario.email });
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
      /* Excluir de vez: só opção removida e sem nenhum registro (senão o nome se perderia) */
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
      /* Opção em uso renomeada: pergunta antes (padrão: manter o nome antigo nos registros existentes) */
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
        if (modo === "corrigir") { o.nomesAnteriores = [...(o.nomesAnteriores || []), { nome: antigo, ate: agora, por: estado.usuario.email }].slice(-5); return; }
        const nova = { id: "", nome: o.nome.trim(), cor: o.cor || "", ...(o.final ? { final: true } : {}) };
        Object.assign(o, { nome: antigo, ativa: false, removidaEm: agora, removidaPor: estado.usuario.email });
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
          ...(o.ativa === false ? { ativa: false, removidaEm: o.removidaEm || agora, removidaPor: o.removidaPor || estado.usuario.email } : {}),
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
        /* O padrão de registros novos é sempre uma opção da lista (se a antiga saiu ao renomear, vale a nova) */
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
        if (a.ativa !== c.ativa) itens.push(`Categoria “${c.nome}” ${c.ativa ? "voltou para a lista" : "removida da lista (os registros continuam com o nome)"}`);
        if (a.cor !== c.cor || a.ordem !== c.ordem) itens.push(`Categoria “${c.nome}”: cor ou ordem alterada`);
      }
    });
    original.categorias.forEach((a) => { if (!r.categorias.some((c) => c.id === a.id)) itens.push(`Categoria “${a.nome}” excluída de vez (sem uso)`); });
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
    if (!avisarTamanhoEstrutura(dadosEstrutura(novo))) return;
    const { ops, arquivo, afetados } = opsMigracao(novo);
    const so_regras = itens.every((x) => /^(Título|Regras da equipe)/.test(x)) && !migracoes.length;
    if (!(await confirmar(so_regras ? "Confira as mudanças:" : `Confira as mudanças. Antes de aplicar, é feito um backup automático (estrutura + ${estado.tickets.length} registros).`, {
      titulo: "Prévia das mudanças", botao: "Aplicar",
      html: `<ul class="lista-mudancas">${itens.map((x) => `<li>${escapar(x)}</li>`).join("")}${afetados ? `<li><strong>${afetados} registro(s) terão os dados ajustados.</strong></li>` : "<li><strong>Nenhum registro será alterado.</strong></li>"}</ul>`
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
/* Itens da prévia: o que mudou nas opções de uma coluna (nenhum registro é alterado por isso) */
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
  if (removidas.length) itens.push(`${c.nome}: removida(s) da lista ${lista(removidas)} (os registros continuam com o nome)`);
  if (voltaram.length) itens.push(`${c.nome}: voltou(aram) para a lista ${lista(voltaram)}`);
  if (renomeadas.length) itens.push(`${c.nome}: nome corrigido em todos os registros ${renomeadas.join(", ")}`);
  if (excluidas.length) itens.push(`${c.nome}: excluída(s) de vez (sem uso) ${lista(excluidas)}`);
  if (!itens.length) itens.push(`Opções de “${c.nome}” alteradas (ordem, cor ou “Encerra”)`);
  return itens;
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
/* ------------------------------------------------------------
 *  Substituir valor nos registros (só administradoras, nunca automático): prévia, backup, lotes com
 *  "continuar depois", histórico em cada linha e auditoria. A opção de origem não é apagada.
 * ------------------------------------------------------------ */
function abrirSubstituirValor(colInicial = "", opInicial = "") {
  if (!ehAdmin() || !estado.estrutura) return;
  const cols = colunasAtivas().filter((c) => TIPOS_LISTA.includes(c.tipo) && podeEditarColuna(c));
  if (!cols.length) { mostrarAviso("Não há colunas de lista."); return; }
  const d = criarDialogo({
    titulo: "Substituir valor nos registros",
    largo: true,
    corpo: `<p class="apoio">Troca um valor por outro em todos os registros que o usam (inclusive no arquivo compactado). Antes, é feito um backup. Cada linha alterada ganha o registro no histórico.</p>
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
    form.de.innerHTML = opcoesDe(c).filter((o) => uso.get(o.id)).map((o) => `<option value="${escapar(o.id)}"${o.id === opInicialAgora ? " selected" : ""}>${escapar(o.nome)}${o.ativa === false ? " (removida da lista)" : ""} · ${uso.get(o.id)} reg.</option>`).join("") || '<option value="">(nenhuma opção em uso)</option>';
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
    const chave = colNumero();
    caixa.innerHTML = `${svg("i-info")}<strong>Prévia: ${lista.length} registro(s) mudam de “${escapar(de ? de.nome : "")}” para “${escapar(para ? para.nome : "(vazio)")}”.</strong>
      ${lista.length ? `<span>Exemplos: ${lista.slice(0, 5).map((t) => escapar((chave && (t.campos || {})[chave.id]) || t.id)).join(", ")}${lista.length > 5 ? "…" : ""}</span>` : ""}
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
    if (!(await confirmar(`${lista.length} registro(s) de ${c.nome} passam de “${de.nome}” para “${para ? para.nome : "(vazio)"}”. Um backup é feito antes. Continuar?`, { titulo: "Substituir valor nos registros", botao: "Substituir" }))) return;
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
    registrarAuditoria("substituirValor", `Substituiu “${de.nome}” por “${para ? para.nome : "(vazio)"}” em ${c.nome}`, `${itens.length - r.faltam} de ${itens.length} registro(s) alterado(s)`);
    if (r.ok && form.tirar.checked && de.ativa !== false) {
      await salvarOpcoesDaEstrutura((nova) => {
        const agora = new Date().toISOString();
        if (c.origem === "categorias") { const cat = nova.categorias.find((y) => y.id === deId); if (cat) Object.assign(cat, { ativa: false, removidaEm: agora, removidaPor: estado.usuario.email }); return; }
        const o = nova.colunas.find((x) => x.id === c.id).opcoes.find((y) => y.id === deId);
        if (o) Object.assign(o, { ativa: false, removidaEm: agora, removidaPor: estado.usuario.email });
      }, `Removeu da lista a opção “${de.nome}” de ${c.nome}`);
    }
    progresso.textContent = textoResultadoConversao(r);
    if (r.ok) { d.close(); mostrarAviso(`Pronto: ${itens.length} registro(s) alterado(s).`, 6000); }
  });
  d.showModal();
}
/* ------------------------------------------------------------
 *  Recuperar nomes de opções apagadas (antes desta versão, apagar uma opção tirava o nome da estrutura).
 *  Procura o nome nos backups, no histórico das linhas e na auditoria; recria a opção como REMOVIDA DA LISTA.
 *  Nenhum registro é regravado.
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
    const backups = await estado.api.lerColecao(`${P()}-backups`, { ordenar: "criadoEm", desc: true, limite: 50 });
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
        const hs = await estado.api.lerColecao(`${P()}/${t.id}/historico`, { ordenar: "em", desc: true, limite: 50 });
        hs.filter((h) => h.coluna === s.col.id || h.colunaNome === s.col.nome).forEach((h) => [h.depois, h.antes].forEach((x) => String(x || "").split(",").forEach((nome) => guardar(s, nome.trim(), "histórico da linha"))));
      } catch (e) { console.warn("Histórico:", e); }
      if (achados.has(chave(s))) break;
    }
  }
  /* 3) Auditoria: nomes entre aspas nas ações registradas */
  if (soltos.some((s) => !achados.has(chave(s)))) {
    try {
      const aud = await estado.api.lerColecao(`${P()}-auditoria`, { ordenar: "em", desc: true, limite: 300 });
      aud.forEach((a) => (`${a.resumo || ""} ${a.detalhes || ""}`.match(/“([^”]{1,100})”/g) || []).forEach((q) => soltos.forEach((s) => guardar(s, q.slice(1, -1), "auditoria"))));
    } catch (e) { console.warn("Auditoria:", e); }
  }
  return achados;
}
async function abrirRecuperarNomes() {
  if (!ehAdmin() || !estado.estrutura) return;
  const soltos = idsSoltos();
  const d = criarDialogo({ titulo: "Recuperar nomes de opções apagadas", largo: true, corpo: `<p class="apoio">Valores gravados nos registros cuja opção foi apagada da lista antes desta atualização. O nome é procurado nos backups, no histórico das linhas e na auditoria. Ao confirmar, a opção volta à estrutura como <strong>removida da lista</strong>: os registros passam a mostrar o nome e nenhum deles é regravado.</p>
    <div id="rec-lista"><p class="apoio">${soltos.length ? "Procurando os nomes…" : "Nenhum valor sem nome encontrado."}</p></div>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button>${soltos.length ? '<button type="submit" class="btn" id="rec-ok" disabled>Recriar como removidas da lista</button>' : ""}</div>` });
  d.showModal();
  if (!soltos.length) return;
  const achados = await procurarNomes(soltos);
  const itens = soltos.map((s) => ({ ...s, ...(achados.get(`${s.col.id}|${s.id}`) || { nome: nomeDoId(s.id), fonte: "" }) }));
  $("#rec-lista", d).innerHTML = `<div class="tabela-admin"><table><thead><tr><th></th><th>Coluna</th><th>Valor gravado</th><th>Registros</th><th>Nome</th><th>Encontrado em</th></tr></thead><tbody>${itens.map((x, i) => `<tr>
    <td><input type="checkbox" data-rec="${i}" checked aria-label="Recriar ${escapar(x.id)}"></td><td>${escapar(x.col.nome)}</td><td><code>${escapar(x.id)}</code></td><td>${x.n}</td>
    <td><input data-rec-nome="${i}" value="${escapar(x.nome)}" maxlength="100" aria-label="Nome de ${escapar(x.id)}"></td>
    <td>${x.fonte ? escapar(x.fonte) : '<span class="apoio">não encontrado: sugestão a partir do id, confira</span>'}</td></tr>`).join("")}</tbody></table></div>`;
  $("#rec-ok", d).disabled = false;
  d.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const escolhidos = itens.map((x, i) => ({ ...x, nome: $(`[data-rec-nome="${i}"]`, d).value.trim().slice(0, 100) })).filter((x, i) => $(`[data-rec="${i}"]`, d).checked && x.nome);
    if (!escolhidos.length) { mostrarAviso("Marque ao menos um valor com nome."); return; }
    if (!(await confirmar(`${escolhidos.length} opção(ões) voltam à estrutura como removidas da lista: ${escolhidos.map((x) => `“${x.nome}”`).join(", ").slice(0, 400)}. Nenhum registro é regravado.`, { titulo: "Recuperar nomes", botao: "Recriar" }))) return;
    const agora = new Date().toISOString();
    const ok = await salvarOpcoesDaEstrutura((nova) => escolhidos.forEach((x) => {
      const c = nova.colunas.find((y) => y.id === x.col.id);
      if (c && !c.opcoes.some((o) => o.id === x.id)) c.opcoes.push({ id: x.id, nome: x.nome, cor: "", ativa: false, removidaEm: agora, removidaPor: estado.usuario.email });
    }), `Recuperou ${escolhidos.length} nome(s) de opções apagadas`, escolhidos.map((x) => `${x.col.nome}: ${x.id} → “${x.nome}”${x.fonte ? ` (${x.fonte})` : ""}`).join(" · "));
    if (ok) { d.close(); mostrarAviso(`${escolhidos.length} nome(s) recuperado(s). Os registros já mostram o nome.`, 6000); }
  });
}
/* Na primeira abertura de uma administradora depois desta atualização (em cada planilha): procura valores sem nome, sem custo de leitura */
const chaveNomesVerificados = () => `banco-tickets-nomes-verificados-v1:${estado.planilha}`;
const planilhasVerificadas = new Set();
function verificarNomesPerdidos() {
  if (planilhasVerificadas.has(estado.planilha) || !ehAdmin() || !estado.estrutura || !estado.carregouTickets || lerLocal(chaveNomesVerificados(), false)) return;
  planilhasVerificadas.add(estado.planilha);
  gravarLocal(chaveNomesVerificados(), true);
  const n = idsSoltos().length;
  if (!n) return;
  setTimeout(async () => {
    if (await confirmar(`${n} valor(es) sem nome encontrado(s) nesta planilha: são de opções apagadas da lista antes desta atualização e hoje aparecem como “fora da lista”.`, { titulo: "Valores sem nome", botao: "Revisar" })) abrirRecuperarNomes();
  }, 1500);
}
/* Muda só opções da estrutura (voltar para a lista, recuperar nomes). Nenhum registro é regravado. */
async function salvarOpcoesDaEstrutura(mudar, resumo, detalhes = "") {
  const nova = JSON.parse(JSON.stringify(estado.estrutura));
  mudar(nova);
  nova.versao = estado.estrutura.versao + 1;
  const dados = dadosEstrutura(normalizarEstrutura(nova));
  if (!avisarTamanhoEstrutura(dados)) return false;
  try {
    await estado.api.salvarDoc(`${P()}-config/estrutura`, dados);
    registrarAuditoria("estrutura", resumo, detalhes);
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}
/* O documento da estrutura precisa ficar abaixo de 1 MB (limite do Firestore) */
const LIMITE_ESTRUTURA = 1000000;
function avisarTamanhoEstrutura(dados) {
  const n = bytes(JSON.stringify(dados));
  if (n > LIMITE_ESTRUTURA * 0.95) { mostrarAviso(`A estrutura ficou grande demais (${Math.round(n / 1024)} KB de 1.000 KB). Exclua de vez opções removidas sem uso antes de continuar.`, 9000); return false; }
  if (n > LIMITE_ESTRUTURA * 0.75) mostrarAviso(`Atenção: a estrutura já usa ${Math.round(n / 1024)} KB de 1.000 KB. Exclua de vez opções removidas sem uso.`, 8000);
  return true;
}
/* Opções removidas da lista que ainda têm registros (informativo: não são erro) */
function removidasEmUso() {
  const lista = [];
  colunasAtivas().filter((c) => TIPOS_LISTA.includes(c.tipo)).forEach((col) => {
    opcoesDe(col).filter((o) => o.ativa === false).forEach((o) => { const n = contarUso(col.id, o.id); if (n) lista.push({ col, o, n }); });
  });
  return lista;
}
function abrirForaDaLista() {
  if (!ehAdmin() || !estado.estrutura) return;
  const cols = colunasAtivas().filter((c) => c.tipo === "lista" && !c.origem);
  const emUso = removidasEmUso();
  const htmlRemovidas = emUso.length ? `<h3 style="font-size:14px;margin-top:14px">Opções removidas ainda em uso (${emUso.length})</h3>
    <p class="apoio" style="font-size:13px">Não são erro: os registros continuam com o nome. Nada precisa ser corrigido.</p>
    <div class="tabela-admin"><table><thead><tr><th>Coluna</th><th>Opção</th><th>Registros</th><th></th></tr></thead><tbody>${emUso.map((x, i) => `<tr>
      <td>${escapar(x.col.nome)}</td><td>${escapar(x.o.nome)}${marcaRemovida(x.o)}</td><td>${x.n}</td>
      <td><button type="button" class="btn btn-secundario btn-mini" data-voltar-lista="${i}">Voltar para a lista</button></td></tr>`).join("")}</tbody></table></div>` : "";
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
      if (x.col.origem === "categorias") { const cat = nova.categorias.find((y) => y.id === x.o.id); if (cat) { cat.ativa = true; delete cat.removidaEm; delete cat.removidaPor; } return; }
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

/* ------------------------------------------------------------
 *  Verificar dados (modelo v2): TICKET CONCEDIDO, RESPONSÁVEL e DATA DE CONCESSÃO em TODOS os registros
 *  (arquivo compactado + vivos) e comparação com a planilha de origem (.xlsx ou .csv do Google Planilhas).
 *  Só corrige sozinho o que não depende de alguém decidir; o resto aparece na planilha (filtro) e no relatório.
 * ------------------------------------------------------------ */
const INICIO_CONCESSOES = "2022-01-01";
const PROBLEMAS = {
  dataAuto: { nome: "Data de concessão preenchida sozinha ao cadastrar o ticket (sem responsável nem motivo)", curto: "Data automática sem responsável", correcao: "Limpar a data" },
  dataSemResp: { nome: "Data de concessão sem responsável", curto: "Data sem responsável" },
  respSemData: { nome: "Responsável sem data de concessão", curto: "Responsável sem data" },
  dataInvalida: { nome: "Data de concessão que não é uma data (ex.: “27/007/2023”, “utilizado”)", curto: "Data inválida", correcao: "Corrigir as datas reconhecíveis" },
  dataFutura: { nome: "Data de concessão no futuro", curto: "Data no futuro" },
  dataAntiga: { nome: `Data de concessão antes de ${INICIO_CONCESSOES.slice(0, 4)}`, curto: "Data muito antiga" },
  respForaLista: { nome: "Responsável fora da lista (nome antigo ou digitado diferente)", curto: "Responsável fora da lista" },
  ticketVazio: { nome: "TICKET CONCEDIDO vazio", curto: "Sem ticket" },
  ticketRepetido: { nome: "TICKET CONCEDIDO repetido em mais de um registro", curto: "Ticket repetido" },
  indice: { nome: "Índice do ticket diferente do TICKET CONCEDIDO", curto: "Índice desatualizado" }
};
function dataIsoValida(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof v === "string" ? v : "");
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
/* Data com erro de digitação ("20/12//2023", "13/O9/2023", "27/007/2023") → aaaa-mm-dd; "" quando há dúvida */
function dataSugerida(v) {
  const s = String(v == null ? "" : v).trim().replace(/[oO]/g, "0").replace(/\s+/g, "").replace(/[.-]/g, "/").replace(/\/{2,}/g, "/");
  let m = /^(\d{1,3})\/(\d{1,3})\/(\d{4})$/.exec(s), iso = "";
  if (m) iso = `${m[3]}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
  else if ((m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s))) iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return dataIsoValida(iso) && iso >= INICIO_CONCESSOES && iso <= hojeIso() ? iso : "";
}
function contextoVerificacao() {
  const data = colModelo("dataConcessao"), resp = colModelo("responsavel");
  const outras = ["motivo", "area", "arSolicitante"].map(colModelo).filter(Boolean);
  return { data, resp, ticket: colNumero(), outras, hoje: hojeIso() };
}
/* Códigos de PROBLEMAS de um registro */
function problemasDoRegistro(t, ctx = contextoVerificacao()) {
  const campos = t.campos || {}, lista = [];
  const { data, resp, ticket } = ctx;
  if (data && resp) {
    const d = campos[data.id], temData = !estaVazio(d), temResp = !estaVazio(campos[resp.id]);
    if (temData && !temResp) {
      const automatica = !!t.criadoEm && d === dataIsoBrasilia(t.criadoEm) && ctx.outras.every((c) => estaVazio(campos[c.id]));
      lista.push(automatica ? "dataAuto" : "dataSemResp");
    }
    if (temResp && !temData) lista.push("respSemData");
    if (temData && !dataIsoValida(d)) lista.push("dataInvalida");
    else if (temData && d > ctx.hoje) lista.push("dataFutura");
    else if (temData && d < INICIO_CONCESSOES) lista.push("dataAntiga");
    if (temResp && foraDaLista(resp, campos[resp.id])) lista.push("respForaLista");
  }
  if (ticket) {
    const v = campos[ticket.id];
    if (estaVazio(v)) lista.push("ticketVazio");
    else {
      const chave = chaveNumero(v);
      if (ticketsComNumero(chave).length > 1) lista.push("ticketRepetido");
      if ((t.numero || "") !== chave) lista.push("indice");
    }
  }
  return lista;
}
function verificarRegistros() {
  const ctx = contextoVerificacao();
  const grupos = Object.fromEntries(Object.keys(PROBLEMAS).map((k) => [k, []]));
  estado.tickets.forEach((t) => problemasDoRegistro(t, ctx).forEach((p) => grupos[p].push(t)));
  return { ctx, grupos };
}

/* Planilha de origem: .xlsx lido no próprio navegador (zip + XML) ou .csv/.txt */
async function lerXlsx(arquivo) {
  const buf = new Uint8Array(await arquivo.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const utf8 = new TextDecoder();
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error("O arquivo não é um .xlsx válido.");
  const entradas = new Map();
  for (let i = 0, p = dv.getUint32(fim + 16, true); i < dv.getUint16(fim + 10, true); i++) {
    const nome = utf8.decode(buf.subarray(p + 46, p + 46 + dv.getUint16(p + 28, true)));
    entradas.set(nome, { metodo: dv.getUint16(p + 10, true), tamanho: dv.getUint32(p + 20, true), local: dv.getUint32(p + 42, true) });
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  const ler = async (nome) => {
    const e = entradas.get(nome);
    if (!e) return "";
    const inicio = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    const dados = buf.subarray(inicio, inicio + e.tamanho);
    if (e.metodo === 0) return utf8.decode(dados);
    return new Response(new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  };
  const ent = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
  const textos = (xml) => ent([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
  const compartilhadas = [...(await ler("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]));
  /* Aba "Banco de tickets" (ou a primeira) */
  const abas = [...(await ler("xl/workbook.xml")).matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ nome: ent((m[0].match(/name="([^"]*)"/) || [])[1] || ""), rid: (m[0].match(/r:id="([^"]*)"/) || [])[1] }));
  const rels = new Map([...(await ler("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [(m[0].match(/Id="([^"]*)"/) || [])[1], (m[0].match(/Target="([^"]*)"/) || [])[1]]));
  const aba = abas.find((a) => nomesEquivalentes(a.nome, "Banco de tickets")) || abas[0];
  if (!aba) throw new Error("O .xlsx não tem abas.");
  const alvo = String(rels.get(aba.rid) || "").replace(/^\//, "");
  const xml = await ler(alvo.startsWith("xl/") ? alvo : `xl/${alvo}`);
  const coluna = (ref) => { let n = 0; for (const ch of ref) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  /* Números como o Excel/Google guardam: "2.0", "3.4265751255E10" → "2", "34265751255" */
  const numero = (x) => (x !== "" && Number.isFinite(Number(x)) ? String(Number(x)) : x);
  const linhas = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (c[1].match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (!ref) continue;
      const tipo = (c[1].match(/\bt="(\w+)"/) || [])[1], corpo = c[2] || "";
      const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      linha[coluna(ref)] = tipo === "s" ? compartilhadas[+v] || "" : tipo === "inlineStr" ? textos(corpo) : v == null ? "" : !tipo || tipo === "n" ? numero(v) : ent(v);
    }
    if (linha.some((x) => String(x || "").trim())) linhas.push(Array.from(linha, (x) => x || ""));
  }
  return { aba: aba.nome, linhas };
}
async function lerPlanilhaOrigem(arquivo) {
  if (/\.xlsx$/i.test(arquivo.name)) return lerXlsx(arquivo);
  let texto = await arquivo.text();
  if (texto.includes("\ufffd")) { try { texto = new TextDecoder("windows-1252").decode(await arquivo.arrayBuffer()); } catch (e) {} }
  return { aba: "", linhas: lerTabelaTexto(texto) };
}
/* Data da planilha: número de série do Excel, dd/mm/aaaa ou aaaa-mm-dd. "valor" = a data, só se for plausível para gravar. */
function dataDaPlanilha(v) {
  const bruto = String(v == null ? "" : v).trim();
  let iso = "";
  if (/^\d{5}(\.\d+)?$/.test(bruto) && +bruto > 20000 && +bruto < 80000) iso = new Date(Date.UTC(1899, 11, 30) + Math.floor(+bruto) * 86400000).toISOString().slice(0, 10);
  else {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(bruto);
    if (m) iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    else if (/^\d{4}-\d{2}-\d{2}/.test(bruto)) iso = bruto.slice(0, 10);
  }
  if (!dataIsoValida(iso)) iso = dataSugerida(bruto);
  return { bruto, iso, valor: iso >= INICIO_CONCESSOES && iso <= hojeIso() ? iso : "" };
}
const dataBr = (iso) => iso.split("-").reverse().join("/");
const COMPARACAO = {
  respVazioSite: { nome: "Responsável na planilha e vazio no site", correcao: "Copiar da planilha", marcada: true },
  dataVaziaSite: { nome: "Data de concessão na planilha e vazia no site", correcao: "Copiar da planilha", marcada: true },
  respDiferente: { nome: "Responsável diferente", correcao: "Usar o da planilha" },
  dataDiferente: { nome: "Data de concessão diferente", correcao: "Usar a da planilha" },
  respVazioPlanilha: { nome: "Responsável no site e vazio na planilha" },
  dataVaziaPlanilha: { nome: "Data de concessão no site e vazia na planilha" },
  soNaPlanilha: { nome: "Ticket só na planilha (não existe no site)" },
  repetidoPlanilha: { nome: "Ticket repetido na própria planilha" }
};
function compararComPlanilha({ linhas }, ctx) {
  const { ticket, resp, data } = ctx;
  const titulos = (linhas[0] || []).map((x) => String(x || ""));
  const achar = (col) => { let i = titulos.findIndex((x) => nomesEquivalentes(x, col.nome)); if (i < 0) i = titulos.findIndex((x) => nomesEquivalentes(x, col.nome, true)); return i; };
  const iT = achar(ticket), iR = achar(resp), iD = achar(data);
  const faltam = [[iT, ticket], [iR, resp], [iD, data]].filter(([i]) => i < 0).map(([, c]) => c.nome);
  if (faltam.length) return { erro: `Não achei no cabeçalho: ${faltam.join(", ")}. Cabeçalho lido: ${titulos.filter(Boolean).join(" | ") || "(vazio)"}.` };
  /* Mesmo responsável escrito de outro jeito ("Lucilene Leal Esteves" = "Lucilene Esteves") */
  const cache = new Map();
  const opcaoResp = (nome) => {
    const k = nomeComparavel(nome);
    if (!cache.has(k)) { const s = opcaoPeloTexto(resp, nome) || sugerirOpcao(resp, nome); cache.set(k, s && (s.nota == null || sugestaoForte(s)) ? s : null); }
    return cache.get(k);
  };
  const canonico = (nome) => (opcaoResp(nome) || {}).id || nomeComparavel(nome);
  const grupos = Object.fromEntries(Object.keys(COMPARACAO).map((k) => [k, []]));
  const vistos = new Set();
  linhas.slice(1).forEach((l, i) => {
    const bruto = String(l[iT] || "").trim();
    if (!bruto) return;
    const chave = chaveNumero(bruto), linha = i + 2;
    if (vistos.has(chave)) { grupos.repetidoPlanilha.push({ ticket: bruto, linha }); return; }
    vistos.add(chave);
    const t = ticketsComNumero(chave)[0];
    if (!t) { grupos.soNaPlanilha.push({ ticket: bruto, linha }); return; }
    const campos = t.campos || {};
    const rP = String(l[iR] || "").trim(), dP = dataDaPlanilha(l[iD]);
    const rS = campos[resp.id], dS = estaVazio(campos[data.id]) ? "" : String(campos[data.id]);
    const item = { t, ticket: bruto, linha, respPlanilha: rP, dataPlanilha: dP.iso ? dataBr(dP.iso) : dP.bruto };
    if (rP && estaVazio(rS)) grupos.respVazioSite.push({ ...item, col: resp.id, valor: (opcaoResp(rP) || {}).id || "" });
    else if (!rP && !estaVazio(rS)) grupos.respVazioPlanilha.push(item);
    else if (rP && canonico(rP) !== canonico(valorTexto(t, resp))) grupos.respDiferente.push({ ...item, col: resp.id, valor: (opcaoResp(rP) || {}).id || "" });
    if (dP.bruto && !dS) grupos.dataVaziaSite.push({ ...item, col: data.id, valor: dP.valor });
    else if (!dP.bruto && dS) grupos.dataVaziaPlanilha.push(item);
    else if (dP.bruto && dP.bruto !== dS && (!dP.iso || dP.iso !== dS)) grupos.dataDiferente.push({ ...item, col: data.id, valor: dP.valor });
  });
  const soNoSite = estado.tickets.filter((t) => { const v = (t.campos || {})[ticket.id]; return !estaVazio(v) && !vistos.has(chaveNumero(v)); }).length;
  return { grupos, soNoSite, linhas: linhas.length - 1 };
}

function abrirVerificacao() {
  if (!ehAdmin() || !estado.estrutura) return;
  if (!estado.carregouTickets) { mostrarAviso("Espere os registros terminarem de carregar."); return; }
  const { ctx, grupos } = verificarRegistros();
  if (!ctx.data || !ctx.resp || !ctx.ticket) { mostrarAviso("A verificação usa as colunas TICKET CONCEDIDO, RESPONSÁVEL e DATA DE CONCESSÃO da estrutura v2."); return; }
  const sugestoes = new Map(grupos.dataInvalida.map((t) => [t.id, dataSugerida(t.campos[ctx.data.id])]).filter(([, v]) => v));
  let comparacao = null;
  const n = (x) => x.toLocaleString("pt-BR");
  const exemplos = (lista, ticketDe) => lista.slice(0, 3).map((x) => escapar(ticketDe(x) || "(sem ticket)")).join(", ") + (lista.length > 3 ? "…" : "");
  const doSite = (t) => valorTexto(t, ctx.ticket);
  const linhaInterna = ([k, lista]) => {
    const p = PROBLEMAS[k];
    const corrigiveis = k === "dataAuto" ? lista.length : k === "dataInvalida" ? sugestoes.size : 0;
    const acoes = [
      `<button type="button" class="btn btn-secundario btn-mini" data-ver="${k}">${svg("i-olho")}Mostrar</button>`,
      k === "respForaLista" ? `<button type="button" class="btn btn-secundario btn-mini" data-ir-fora>${svg("i-alerta")}Corrigir…</button>` : "",
      corrigiveis ? `<label class="check"><input type="checkbox" data-corrigir="${k}" checked> ${escapar(p.correcao)} (${n(corrigiveis)})</label>` : ""
    ].join(" ");
    return `<tr><td>${escapar(p.nome)}</td><td><strong>${n(lista.length)}</strong></td><td style="font-size:12px">${exemplos(lista, doSite)}</td><td>${acoes}</td></tr>`;
  };
  const desenharComparacao = () => {
    const el = $("#verif-comparacao", d);
    if (!comparacao) { el.innerHTML = ""; return; }
    if (comparacao.erro) { el.innerHTML = `<p class="form-erro" role="alert">${escapar(comparacao.erro)}</p>`; return; }
    const linhas = Object.entries(comparacao.grupos).filter(([, l]) => l.length).map(([k, lista]) => {
      const c = COMPARACAO[k], corrigiveis = c.correcao ? lista.filter((x) => x.valor).length : 0;
      return `<tr><td>${escapar(c.nome)}</td><td><strong>${n(lista.length)}</strong></td><td style="font-size:12px">${exemplos(lista, (x) => x.ticket)}</td>
        <td>${corrigiveis ? `<label class="check"><input type="checkbox" data-copiar="${k}"${c.marcada ? " checked" : ""}> ${escapar(c.correcao)} (${n(corrigiveis)})</label>` : ""}${c.correcao && corrigiveis < lista.length ? `<span class="apoio" style="font-size:12px"> ${n(lista.length - corrigiveis)} sem valor reconhecível: veja o relatório</span>` : ""}</td></tr>`;
    });
    el.innerHTML = `<p class="apoio">${n(comparacao.linhas)} linha(s) lidas${comparacao.aba ? ` da aba “${escapar(comparacao.aba)}”` : ""}. ${n(comparacao.soNoSite)} ticket(s) do site não estão nessa planilha (ex.: os que vieram da aba SIG ou foram cadastrados só no site).</p>
      ${linhas.length ? `<div class="tabela-admin"><table><thead><tr><th>Diferença</th><th>Registros</th><th>Exemplos</th><th>O que fazer</th></tr></thead><tbody>${linhas.join("")}</tbody></table></div>` : "<p class=\"apoio\"><strong>Responsável e data de concessão iguais aos da planilha em todos os tickets.</strong></p>"}`;
  };
  const totalProblemas = Object.values(grupos).reduce((s, l) => s + l.length, 0);
  const d = criarDialogo({
    titulo: "Verificar dados",
    largo: true,
    corpo: `<p class="apoio">Conferidos <strong>${n(estado.tickets.length)}</strong> registros (arquivo compactado e registros novos): TICKET CONCEDIDO, RESPONSÁVEL e DATA DE CONCESSÃO.</p>
      ${totalProblemas ? `<div class="tabela-admin"><table><thead><tr><th>Problema</th><th>Registros</th><th>Exemplos</th><th>O que fazer</th></tr></thead><tbody>${Object.entries(grupos).filter(([, l]) => l.length).map(linhaInterna).join("")}</tbody></table></div>`
        : "<p class=\"apoio\"><strong>Nenhum problema encontrado.</strong></p>"}
      <h3 style="font-size:14px;margin-top:12px">Comparar com a planilha de origem</h3>
      <p class="apoio" style="font-size:13px">Escolha o arquivo baixado do Google Planilhas (.xlsx, ou .csv da aba “Banco de tickets”). Escolher o arquivo não grava nada.</p>
      <label class="campo"><input type="file" name="planilha" accept=".xlsx,.csv,.txt,text/csv"></label>
      <div id="verif-comparacao"></div>
      <p class="apoio" style="font-size:13px">“Mostrar” filtra a planilha (o filtro aparece no resumo do topo). Antes de aplicar as correções marcadas, é feito um backup.</p>
      <p class="apoio" role="status" id="verif-progresso"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-relatorio>${svg("i-salvar")}Baixar relatório (CSV)</button><button type="button" class="btn btn-secundario" data-fechar>Fechar</button><button type="submit" class="btn">Aplicar correções marcadas</button></div>`
  });
  const form = d.querySelector("form");
  const progresso = $("#verif-progresso", d);
  form.planilha.addEventListener("change", async () => {
    const f = form.planilha.files[0];
    if (!f) return;
    if (f.size > 40_000_000) { comparacao = { erro: "Arquivo grande demais (máx. 40 MB)." }; desenharComparacao(); return; }
    progresso.textContent = "Lendo a planilha…";
    try {
      const lida = await lerPlanilhaOrigem(f);
      comparacao = { ...compararComPlanilha(lida, ctx), aba: lida.aba };
    } catch (e) { console.error(e); comparacao = { erro: `Não foi possível ler o arquivo: ${e.message || e}` }; }
    progresso.textContent = "";
    desenharComparacao();
  });
  d.addEventListener("click", (e) => {
    const ver = e.target.closest("[data-ver]");
    if (ver) { d.close(); estado.vista.especial = `verificar:${ver.dataset.ver}`; salvarVista(); renderizarTudo(); return; }
    if (e.target.closest("[data-ir-fora]")) { d.close(); abrirForaDaLista(); return; }
    if (!e.target.closest("[data-relatorio]")) return;
    const cab = ["TICKET CONCEDIDO", "PROBLEMA", "RESPONSÁVEL NO SITE", "DATA NO SITE", "RESPONSÁVEL NA PLANILHA", "DATA NA PLANILHA", "LINHA NA PLANILHA", "CORREÇÃO POSSÍVEL"];
    const linha = (t, problema, extra = {}) => [t ? doSite(t) : extra.ticket, problema, t ? valorTexto(t, ctx.resp) : "", t ? valorTexto(t, ctx.data) : "", extra.respPlanilha || "", extra.dataPlanilha || "", extra.linha || "", extra.correcao || ""].map(csvCampo).join(";");
    const linhas = [cab.join(";")];
    Object.entries(grupos).forEach(([k, lista]) => lista.forEach((t) => linhas.push(linha(t, PROBLEMAS[k].curto, { correcao: k === "dataAuto" ? "Limpar a data" : k === "dataInvalida" && sugestoes.get(t.id) ? `Data ${dataBr(sugestoes.get(t.id))}` : "" }))));
    if (comparacao && comparacao.grupos) Object.entries(comparacao.grupos).forEach(([k, lista]) => lista.forEach((x) => linhas.push(linha(x.t, `Planilha: ${COMPARACAO[k].nome}`, { ...x, correcao: x.valor ? `${COMPARACAO[k].correcao}: ${textoDoValor(COL[x.col], x.valor)}` : "" }))));
    const p = partesBrasilia();
    baixarArquivo(`verificacao-banco-de-tickets-${p.ano}-${p.mes}-${p.dia}-${p.hora}${p.minuto}.csv`, "\ufeff" + linhas.join("\r\n"), "text/csv;charset=utf-8");
    mostrarAviso(`Relatório com ${n(linhas.length - 1)} linha(s) baixado.`);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const itens = new Map();
    const marcado = (sel) => { const el = $(sel, d); return !!el && el.checked; };
    if (marcado('[data-corrigir="dataAuto"]')) grupos.dataAuto.forEach((t) => itens.set(`${t.id}|${ctx.data.id}`, [t.id, ctx.data.id, ""]));
    if (marcado('[data-corrigir="dataInvalida"]')) sugestoes.forEach((v, id) => itens.set(`${id}|${ctx.data.id}`, [id, ctx.data.id, v]));
    if (comparacao && comparacao.grupos) Object.entries(comparacao.grupos).forEach(([k, lista]) => {
      if (marcado(`[data-copiar="${k}"]`)) lista.filter((x) => x.valor).forEach((x) => itens.set(`${x.t.id}|${x.col}`, [x.t.id, x.col, x.valor]));
    });
    if (!itens.size) { mostrarAviso("Nada marcado para corrigir."); return; }
    const registros = new Set([...itens.values()].map(([id]) => id)).size;
    if (!(await confirmar(`${n(itens.size)} alteração(ões) em ${n(registros)} registro(s). Um backup é feito antes; o histórico de cada registro mostra a mudança.`, { titulo: "Aplicar correções", botao: "Aplicar" }))) return;
    progresso.textContent = "Fazendo o backup…";
    if (!(await criarBackup("Antes de corrigir dados (Verificar dados)"))) { progresso.textContent = ""; return; }
    const lista = [...itens.values()];
    const r = await converterEmLotes(lista, "verificarDados", (feitos, total) => { progresso.textContent = `Gravando… ${feitos} de ${total}`; });
    registrarAuditoria("verificarDados", `Corrigiu dados pela verificação: ${n(lista.length - r.faltam)} de ${n(lista.length)} alteração(ões)`, Object.entries(grupos).filter(([, l]) => l.length).map(([k, l]) => `${PROBLEMAS[k].curto}: ${l.length}`).join(" · "));
    progresso.textContent = textoResultadoConversao(r);
    if (r.ok) { d.close(); mostrarAviso(`Pronto: ${n(lista.length)} alteração(ões) em ${n(registros)} registro(s). Abra “Verificar dados” de novo para conferir.`, 8000); }
  });
  d.showModal();
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
    ["substituir", "i-ordenar", "Substituir valor nos registros"],
    ["recuperar-nomes", "i-historico", "Recuperar nomes de opções apagadas"],
    ...(colModelo("responsavel") && colModelo("dataConcessao") ? [["verificar", "i-check", "Verificar dados (responsável e data de concessão)"]] : []),
    ...(copiar ? [["copiar-numero", "i-copiar", `Copiar Nº do ticket para ${colModelo("ticket").nome} (${copiar})`]] : []),
    ...(pendente && pendente.itens && pendente.itens.length ? [["continuar", "i-restaurar", `Continuar a conversão (${pendente.itens.length} pendente(s))`]] : []),
    ["pessoas", "i-pessoas", `Pessoas (${estado.identidades.length + cadastrosAntigos().length})${aguardando() ? ` · ${aguardando()} aguardando` : ""}`],
    ...(cadastrosAntigos().length ? [["unificar", "i-pessoas", `Unificar cadastros por e-mail (${cadastrosAntigos().length})`]] : []),
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
    if (a === "substituir") abrirSubstituirValor();
    if (a === "recuperar-nomes") abrirRecuperarNomes();
    if (a === "verificar") abrirVerificacao();
    if (a === "copiar-numero") copiarNumeroParaTicket();
    if (a === "continuar") continuarConversao();
    if (a === "estrutura") abrirEstrutura();
    if (a === "pessoas") abrirPessoas();
    if (a === "unificar") abrirUnificacao();
    if (a === "pedidos") { estado.vista.especial = "exclusao"; salvarVista(); renderizarTudo(); }
    if (a === "lixeira") abrirLixeira();
    if (a === "backups") abrirBackups();
    if (a === "compactar") compactarArquivo();
    if (a === "auditoria") abrirAuditoria();
  });
  pop.querySelector("button").focus();
}
const aguardando = () => estado.identidades.filter((i) => situacaoIdentidade(i) === "aguardando").length + cadastrosAntigos().filter((p) => p.pendente).length;
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
/* "voltar": a equipe pode voltar à tela de entrada (por exemplo, para entrar com outro e-mail) */
const BLOQUEADA = { titulo: "Acesso bloqueado", texto: "Seu acesso foi bloqueado. Fale com a Lays ou a Paula.", verificar: true, voltar: true };
const PENDENTE = { titulo: "Aguardando liberação", texto: "Seu cadastro foi recebido. A Lays ou a Paula precisam liberar o seu acesso; esta página abre sozinha quando isso acontecer.", verificar: true, voltar: true };
function mostrarBloqueada() {
  pararOuvintes();
  estado.usuario = null;
  estado.mensagemBloqueio = BLOQUEADA;
  mostrarBloqueio(BLOQUEADA);
}
/* Cadastro antigo aguardando liberação: a pessoa só lê o próprio aparelho e entra assim que ele é liberado */
function mostrarPendente(uid) {
  pararOuvintes();
  estado.mensagemBloqueio = PENDENTE;
  mostrarBloqueio(PENDENTE);
  estado.pararOuvintes.push(estado.api.ouvirDoc(`tickets-pessoas/${uid}`, (d) => {
    if (!d || estado.mensagemBloqueio !== PENDENTE) return;
    if (d.vinculadoEm) { abrirAparelho(uid).catch((e) => { console.warn(e); mostrarBloqueada(); }); return; }
    if (d.pendente) return;
    if (d.ativo) entrarComPerfil(uid, d);
    else mostrarBloqueada();
  }, (e) => console.warn("perfil", e)));
}
/* Cadastro por e-mail aguardando liberação: o aparelho ligado lê a identidade e entra assim que ela é liberada */
function mostrarPendenteIdentidade(uid, aparelho) {
  pararOuvintes();
  estado.usuario = null;
  estado.mensagemBloqueio = PENDENTE;
  mostrarBloqueio(PENDENTE);
  estado.pararOuvintes.push(estado.api.ouvirDoc(`tickets-identidades/${aparelho.email}`, (i) => {
    if (estado.mensagemBloqueio !== PENDENTE || (i && i.ativo !== false && !i.aprovado && !desconectado(aparelho, i))) return;
    rotaIdentidade(uid, aparelho, i);
  }, (e) => console.warn("cadastro", e)));
}
function mostrarBloqueio({ titulo, texto, verificar = false, voltar = !verificar }) {
  $("#bloqueio-titulo").textContent = titulo;
  $("#bloqueio-texto").textContent = texto;
  $("#btn-bloqueio-verificar").hidden = !verificar;
  $("#btn-bloqueio-voltar").hidden = !voltar;
  mostrarTela("tela-bloqueio");
}
$("#btn-bloqueio-voltar").addEventListener("click", () => { estado.mensagemBloqueio = null; pararOuvintes(); estado.usuario = null; mostrarRegistro(); });
$("#btn-bloqueio-verificar").addEventListener("click", () => location.reload());
function atualizarBotoes() {
  const alimenta = podeAlimentar();
  $$("[data-editor]").forEach((b) => { b.hidden = !alimenta; });
  $$("[data-admin]").forEach((b) => { b.hidden = !ehAdmin() || !estado.estrutura; });
  $("#btn-desfazer").disabled = !estado.desfazer.length;
  $("#menu-admin").hidden = !ehAdmin();
  $("#faixa-offline").hidden = !(estado.offline || (estado.usandoCopia && !estado.carregouTickets));
  $("#faixa-v2").hidden = !(ehAdmin() && v2Pendente());
  const antigos = ehAdmin() ? cadastrosAntigos().length : 0;
  $("#faixa-unificar").hidden = !antigos;
  if (antigos) $("#faixa-unificar-texto").textContent = `Há cadastros antigos para unificar: ${antigos} cadastro(s) ainda entram só pelo navegador em que a pessoa se registrou. Unifique para que todos entrem de qualquer computador com e-mail e nome.`;
}
$("#btn-faixa-v2").addEventListener("click", aplicarV2);
$("#btn-faixa-unificar").addEventListener("click", () => { if (!conectado()) { mostrarAviso("Sem conexão: a administração está bloqueada."); return; } abrirUnificacao(); });
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
    <p class="apoio" style="font-size:12px">Para corrigir o nome ou o e-mail, fale com a Lays ou a Paula.</p>
    <button type="button" class="item-menu" role="menuitem" data-id-acao="trocar">${svg("i-sair")}Trocar de pessoa</button>`;
  posicionarPop(pop, e.currentTarget, 260);
  pop.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-id-acao]");
    if (!b) return;
    fecharPop();
    if (b.dataset.idAcao === "trocar" && await confirmar("Trocar de pessoa? Você volta à tela de entrada. Para voltar a este cadastro, use “Continuar como…” ou digite o seu e-mail e nome de novo. As linhas que você registrou continuam ligadas ao seu e-mail.", { titulo: "Trocar de pessoa", botao: "Trocar de pessoa" })) {
      formRegistro.reset();
      consultaEmail.email = "";
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
 *  "Entrar no Banco de Tickets" (equipe: e-mail + nome, sem senha) e "Sou administradora"
 *  Sobre um login anônimo do Firebase, este navegador vira um aparelho (tickets-pessoas/{uid})
 *  ligado à identidade do e-mail (tickets-identidades/{email}). Quem confere o nome são as
 *  regras do Firestore (vinculoValido): o app nunca lê o nome cadastrado de um e-mail.
 *  Quem não tem cadastro cria na mesma tela. A sessão fica lembrada neste navegador.
 * ------------------------------------------------------------ */
const formRegistro = $("#form-registro");
const formLogin = $("#form-login");
/* Mesmo formato aceito pelo firestore.rules */
const RE_EMAIL_PESSOA = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
/* Letras do latim (com ou sem acento), espaço, ponto, hífen e apóstrofo: as que chaveDoNome() do firestore.rules normaliza igual */
const RE_NOME_PERMITIDO = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F .'\u2019-]+$/;
const MAX_CONTAS = 5;
const MAX_TENTATIVAS = 5;
const ESPERA_TENTATIVAS_MS = 60000;
const normalizarEmail = (t) => String(t == null ? "" : t).trim().toLowerCase();
/* Nome usado para entrar (igual a chaveDoNome() no firestore.rules): minúsculas, sem acentos,
   espaços repetidos viram um e sem pontos nas pontas. "  Davi   LOPES " e "davi lopes" → "davi lopes". */
function normalizarNomeChave(t) {
  return String(t == null ? "" : t).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim();
}
const PARTICULAS = ["da", "das", "de", "do", "dos", "e", "di", "du", "del", "van", "von"];
function capitalizarNome(texto) {
  return String(texto || "").trim().replace(/\s+/g, " ").split(" ").map((p, i) => {
    const min = p.toLocaleLowerCase("pt-BR");
    if (i > 0 && PARTICULAS.includes(min)) return min;
    return min.replace(/(^|[-'’])(\p{L})/gu, (_, sep, letra) => sep + letra.toLocaleUpperCase("pt-BR"));
  }).join(" ");
}
/* { nome (como exibir), chave (nomeChave), erro } */
function validarNome(nomeBruto) {
  const nome = capitalizarNome(nomeBruto);
  const chave = normalizarNomeChave(nome);
  let erro = "";
  if (!nome) erro = "Informe o seu nome.";
  else if (nome.length > 80) erro = "Use no máximo 80 caracteres.";
  else if (!RE_NOME_PERMITIDO.test(nome)) erro = "Use só letras, espaços, hífen, ponto ou apóstrofo no nome.";
  else if ((chave.match(/\p{L}/gu) || []).length < 2) erro = "O nome precisa ter pelo menos 2 letras.";
  return { nome, chave, erro };
}
/* { email, nome, chave, erros: { email?, nome? } } */
function validarEntrada(emailBruto, nomeBruto) {
  const erros = {};
  const email = normalizarEmail(emailBruto);
  if (!email) erros.email = "Informe o seu e-mail.";
  else if (email.length > 120 || !RE_EMAIL_PESSOA.test(email)) erros.email = "E-mail inválido. Exemplo: suaconta@valid.com";
  else if (ehEmailAdmin(email)) erros.email = "Use “Sou administradora”.";
  const { nome, chave, erro } = validarNome(nomeBruto);
  if (erro) erros.nome = erro;
  return { email, nome, chave, erros };
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

/* "Continuar como…": só quem já entrou NESTE navegador (até 5), guardado só aqui */
function contasRecentes() {
  const lista = lerLocal(CHAVE_CONTAS, []);
  return (Array.isArray(lista) ? lista : [])
    .filter((c) => c && typeof c.email === "string" && RE_EMAIL_PESSOA.test(c.email) && typeof c.nome === "string" && c.nome.trim())
    .slice(0, MAX_CONTAS);
}
function lembrarConta(email, nome) {
  if (!email || !nome || ehEmailAdmin(email)) return;
  gravarLocal(CHAVE_CONTAS, [{ email, nome: String(nome).slice(0, 80), em: new Date().toISOString() }, ...contasRecentes().filter((c) => c.email !== email)].slice(0, MAX_CONTAS));
}
const esquecerConta = (email) => gravarLocal(CHAVE_CONTAS, contasRecentes().filter((c) => c.email !== email));
/* A identificação do formato antigo (uma por navegador) vira uma conta recente */
function migrarIdentidadeAntiga() {
  const antiga = lerLocal(CHAVE_IDENTIDADE, null);
  if (!antiga) return;
  const email = normalizarEmail(antiga.email);
  if (RE_EMAIL_PESSOA.test(email) && antiga.nome && !contasRecentes().some((c) => c.email === email)) {
    gravarLocal(CHAVE_CONTAS, [...contasRecentes(), { email, nome: String(antiga.nome).slice(0, 80), em: "" }].slice(0, MAX_CONTAS));
  }
  apagarLocal(CHAVE_IDENTIDADE);
}
function renderizarContasRecentes() {
  const caixa = $("#contas-recentes");
  const contas = contasRecentes();
  caixa.hidden = !contas.length;
  caixa.innerHTML = contas.length ? `<p class="rotulo">Neste computador</p><ul>${contas.map((c) => `<li>
      <button type="button" class="conta-recente" data-conta="${escapar(c.email)}" aria-label="Continuar como ${escapar(c.nome)} (${escapar(c.email)})">${svg("i-usuario")}<span class="conta-textos"><span class="conta-nome">Continuar como ${escapar(c.nome)}</span><span class="conta-email">${escapar(c.email)}</span></span></button>
      <button type="button" class="btn-icone conta-esquecer" data-esquecer="${escapar(c.email)}" title="Esquecer neste computador" aria-label="Esquecer ${escapar(c.nome)} (${escapar(c.email)}) neste computador">${svg("i-fechar")}</button></li>`).join("")}</ul>
    <p class="ou">ou entre com outro e-mail</p>` : "";
}
$("#contas-recentes").addEventListener("click", (e) => {
  const esquecer = e.target.closest("[data-esquecer]");
  if (esquecer) {
    esquecerConta(esquecer.dataset.esquecer);
    renderizarContasRecentes();
    ($("[data-conta]") || formRegistro.email).focus();
    return;
  }
  const b = e.target.closest("[data-conta]");
  if (!b) return;
  const c = contasRecentes().find((x) => x.email === b.dataset.conta);
  if (!c) return;
  formRegistro.email.value = c.email;
  formRegistro.nome.value = c.nome;
  entrar(c.email, c.nome);
});

/* Freio no navegador para nome errado: depois de 5 tentativas, 1 minuto de espera.
   A proteção de verdade é a das regras (o nome é conferido no servidor). */
function esperaTentativas() {
  const t = lerLocal(CHAVE_TENTATIVAS, null);
  return t && Number(t.ate) > Date.now() ? Number(t.ate) - Date.now() : 0;
}
function registrarErroNome() {
  const t = lerLocal(CHAVE_TENTATIVAS, null) || {};
  const n = (Number(t.ate) > 0 ? 0 : Number(t.n) || 0) + 1;
  const travou = n >= MAX_TENTATIVAS;
  gravarLocal(CHAVE_TENTATIVAS, travou ? { n: 0, ate: Date.now() + ESPERA_TENTATIVAS_MS } : { n, ate: 0 });
  return travou;
}
const limparTentativas = () => apagarLocal(CHAVE_TENTATIVAS);
let ocupadoEntrada = false;
let temporizadorEspera = 0;
function atualizarBotoesEntrada() {
  const espera = esperaTentativas();
  const botao = $("#btn-registro-confirmar");
  botao.disabled = ocupadoEntrada || espera > 0;
  $("#btn-criar-cadastro").disabled = ocupadoEntrada;
  $$("[data-conta]").forEach((b) => { b.disabled = ocupadoEntrada || espera > 0; });
  formRegistro.setAttribute("aria-busy", String(ocupadoEntrada));
  if (ocupadoEntrada) botao.textContent = "Entrando…";
  else if (espera > 0) botao.textContent = `Aguarde ${Math.ceil(espera / 1000)} s`;
  else atualizarTextoEntrar();
  if (espera > 0 && !temporizadorEspera) temporizadorEspera = setInterval(atualizarBotoesEntrada, 1000);
  if (!espera && temporizadorEspera) { clearInterval(temporizadorEspera); temporizadorEspera = 0; }
}

/* Ao sair do campo E-mail: "Entrar" (tem cadastro) ou "Criar cadastro" (não tem). Lê só tickets-emails/{email}. */
const consultaEmail = { email: "", existe: null };
async function garantirSessao() {
  const u = estado.api.usuarioAtual();
  if (u && u.anonimo) return u;
  estado.registrando++;
  try { return await estado.api.entrarAnonimo(); } finally { estado.registrando--; }
}
async function emailTemCadastro(email) {
  if (consultaEmail.email === email && consultaEmail.existe != null) return consultaEmail.existe;
  await garantirSessao();
  const existe = !!(await estado.api.lerDoc(`tickets-emails/${email}`));
  Object.assign(consultaEmail, { email, existe });
  return existe;
}
function atualizarTextoEntrar() {
  const email = normalizarEmail(formRegistro.email.value);
  const conhecido = consultaEmail.email === email ? consultaEmail.existe : null;
  $("#btn-registro-confirmar").textContent = conhecido === false ? "Criar cadastro" : "Entrar";
  $("#dica-cadastro").textContent = conhecido === true ? "Cadastro encontrado. Digite o nome como você se registrou."
    : conhecido === false ? "Primeira vez com este e-mail? Vamos criar o seu cadastro." : "";
  $("#dica-cadastro").dataset.situacao = conhecido === true ? "ok" : conhecido === false ? "novo" : "";
}
formRegistro.email.addEventListener("blur", async () => {
  const email = normalizarEmail(formRegistro.email.value);
  if (!estado.api || email.length > 120 || !RE_EMAIL_PESSOA.test(email) || ehEmailAdmin(email) || consultaEmail.email === email) { atualizarTextoEntrar(); return; }
  $("#dica-cadastro").textContent = "Procurando o cadastro…";
  $("#dica-cadastro").dataset.situacao = "";
  try { await emailTemCadastro(email); } catch (e) { console.warn(e); }
  if (normalizarEmail(formRegistro.email.value) === email && !ocupadoEntrada) atualizarTextoEntrar();
});
function mostrarConfirmacaoCadastro(email, nome) {
  $("#confirmar-cadastro-texto").textContent = `Não encontramos cadastro para ${email}. Criar cadastro como “${nome}”?`;
  $("#confirmar-cadastro").hidden = false;
  $("#botoes-entrar").hidden = true;
  $("#btn-criar-cadastro").focus();
}
function esconderConfirmacao() {
  $("#confirmar-cadastro").hidden = true;
  $("#botoes-entrar").hidden = false;
}
formRegistro.email.addEventListener("input", () => { esconderConfirmacao(); if (!ocupadoEntrada) atualizarBotoesEntrada(); });
formRegistro.nome.addEventListener("input", esconderConfirmacao);
$("#btn-corrigir-email").addEventListener("click", () => { esconderConfirmacao(); formRegistro.email.focus(); formRegistro.email.select(); });
$("#btn-criar-cadastro").addEventListener("click", () => entrar(formRegistro.email.value, formRegistro.nome.value, { criar: true }));
formRegistro.addEventListener("submit", (e) => { e.preventDefault(); entrar(formRegistro.email.value, formRegistro.nome.value); });

/* Entrar: liga este aparelho ao cadastro do e-mail (as regras conferem o nome) ou, com "criar", cria o cadastro */
async function entrar(emailBruto, nomeBruto, { criar = false } = {}) {
  if (ocupadoEntrada) return;
  const api = estado.api;
  if (!api) { marcarErrosIdentidade({}, "Não foi possível entrar. Verifique a internet e tente de novo."); return; }
  if (esperaTentativas()) { atualizarBotoesEntrada(); marcarErrosIdentidade({}, "Muitas tentativas com o nome errado. Espere a contagem terminar e tente de novo."); return; }
  const { email, nome, chave, erros } = validarEntrada(emailBruto, nomeBruto);
  if (!erros.email) formRegistro.email.value = email;
  if (Object.keys(erros).length) { esconderConfirmacao(); marcarErrosIdentidade(erros); return; }
  marcarErrosIdentidade({});
  $("#aviso-entrada").hidden = true;
  ocupadoEntrada = true;
  estado.registrando++;
  atualizarBotoesEntrada();
  try {
    const u = await garantirSessao();
    if (!criar && await emailTemCadastro(email)) {
      try {
        await api.salvarDoc(`tickets-pessoas/${u.uid}`, { email, nomeChave: chave, vinculadoEm: "__AGORA__", ultimoAcesso: "__AGORA__" }, true);
      } catch (err) {
        if (!/permission/.test((err && err.code) || "")) throw err;
        const travou = registrarErroNome();
        marcarErrosIdentidade({ nome: "O nome não confere com o cadastro deste e-mail. Digite o nome exatamente como você se registrou ou fale com a Lays ou a Paula." },
          travou ? "Muitas tentativas com o nome errado. Espere 1 minuto e tente de novo." : "");
        return;
      }
      limparTentativas();
      await abrirAparelho(u.uid);
      return;
    }
    if (!criar) { mostrarConfirmacaoCadastro(email, nome); return; }
    const cfg = normalizarEstrutura(await api.lerDoc("tickets-config/estrutura"));
    if (!cfg) { esconderConfirmacao(); marcarErrosIdentidade({}, "A planilha ainda não foi configurada. Fale com a Lays ou a Paula."); return; }
    const registro = cfg.regras.registro;
    if (!registro.aberto) { esconderConfirmacao(); marcarErrosIdentidade({}, "Novos cadastros estão fechados no momento. Fale com a Lays ou a Paula."); return; }
    if (registro.dominios.length && !registro.dominios.includes(email.split("@")[1])) {
      esconderConfirmacao();
      marcarErrosIdentidade({ email: `Use o seu e-mail corporativo (${registro.dominios.map((d) => "@" + d).join(" ou ")}).` });
      return;
    }
    await api.lote([
      { op: "set", caminho: `tickets-identidades/${email}`, dados: { email, nome, nomeChave: chave, papel: registro.papelPadrao, ativo: true, aprovado: !registro.aprovacao, criadoEm: "__AGORA__", criadoPorUid: u.uid, atualizadoEm: "__AGORA__" } },
      { op: "set", caminho: `tickets-emails/${email}`, dados: {} },
      { op: "set", caminho: `tickets-pessoas/${u.uid}`, mesclar: true, dados: { email, nomeChave: chave, vinculadoEm: "__AGORA__", ultimoAcesso: "__AGORA__" } }
    ]);
    Object.assign(consultaEmail, { email, existe: true });
    esconderConfirmacao();
    await abrirAparelho(u.uid);
  } catch (err) {
    console.warn(err);
    consultaEmail.email = "";
    esconderConfirmacao();
    marcarErrosIdentidade({}, mensagemRegistro(err, criar));
  } finally {
    estado.registrando--;
    ocupadoEntrada = false;
    atualizarBotoesEntrada();
  }
}
function mostrarRegistro({ aviso = "", email = "" } = {}) {
  if (estado.mensagemBloqueio) { mostrarBloqueio(estado.mensagemBloqueio); return; }
  mostrarTela("tela-login");
  formRegistro.hidden = false;
  formLogin.hidden = true;
  esconderConfirmacao();
  renderizarContasRecentes();
  $("#aviso-entrada").textContent = aviso;
  $("#aviso-entrada").hidden = !aviso;
  if (email) { formRegistro.email.value = email; formRegistro.nome.value = ""; }
  marcarErrosIdentidade({});
  atualizarBotoesEntrada();
  (email ? formRegistro.nome : $("[data-conta]") || formRegistro.email).focus();
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
function mensagemRegistro(erro, criando = false) {
  const c = (erro && erro.code) || "";
  if (/network|unavailable|deadline/.test(c)) return "Não foi possível entrar. Verifique a internet e tente de novo.";
  if (/operation-not-allowed|admin-restricted/.test(c)) return "A entrada da equipe ainda não foi ativada. Fale com a Lays ou a Paula.";
  if (/too-many-requests|quota/.test(c)) return "Muitas tentativas. Espere alguns minutos e tente de novo.";
  if (/permission/.test(c)) return criando ? "Não foi possível criar o cadastro com esses dados. Confira o e-mail ou fale com a Lays ou a Paula." : "Não foi possível entrar com esses dados. Fale com a Lays ou a Paula.";
  return "Não foi possível entrar. Verifique a internet e tente de novo.";
}
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
  if (!ehEmailAdmin(email)) { erro.textContent = "Esta entrada é só para as administradoras. Use “Voltar” e entre com o seu e-mail e nome."; return; }
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
  if (aparencia) aparencia.desligarPadrao();
  estado.ouvintesPlanilha.forEach((f) => { try { f && f(); } catch (e) {} });
  estado.ouvintesPlanilha = [];
  if (pararHistorico) { pararHistorico(); pararHistorico = null; }
  Object.assign(estado, { estrutura: null, carregouEstrutura: false, tickets: [], carregouTickets: false, vivos: [], carregouVivos: false, arquivo: arquivoVazio(), carregouArquivo: false, vista: null, lixeira: [], desfazer: [], usandoCopia: false, selecionando: false, busca: "", visao: "padrao", celula: null, intervalo: null });
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
  estado.identidades = [];
}
/* Tela de entrada, sem apagar o que a pessoa já está digitando nela */
const entradaVisivel = () => !$("#tela-login").hidden;
async function aoMudarUsuario(u) {
  /* Durante o "Entrar" o próprio formulário termina a entrada */
  if (estado.registrando > 0) return;
  if (u && estado.usuario && estado.usuario.uid === u.uid && !$("#app").hidden) return;
  pararOuvintes();
  if (!u) { estado.usuario = null; if (!entradaVisivel()) mostrarRegistro(); return; }
  if (!u.anonimo) {
    if (!ehEmailAdmin(u.email)) { await sair({ titulo: "Entrada não permitida", texto: "Só as administradoras entram com senha. Volte ao início e entre com o seu e-mail e nome." }); return; }
    if (sessaoExpirou()) { await sair(SESSAO_ENCERRADA); return; }
    registrarAtividade(true);
    estado.mensagemBloqueio = null;
    estado.usuario = { id: u.email, uid: u.uid, email: u.email, nome: (ADMINS.find((a) => a.email === u.email) || {}).nome || u.email, papel: "admin" };
    iniciarPlanilha();
    return;
  }
  /* Equipe: o aparelho deste navegador e, se ele estiver ligado, a identidade do e-mail */
  let aparelho = null, identidade = null, semConexao = false;
  try {
    aparelho = await estado.api.lerDoc(`tickets-pessoas/${u.uid}`);
    if (aparelho && aparelho.vinculadoEm && aparelho.email) identidade = await estado.api.lerDoc(`tickets-identidades/${aparelho.email}`);
  } catch (e) { semConexao = !/permission/.test((e && e.code) || ""); }
  if (semConexao) {
    const copia = PLANILHAS.map((p) => lerLocal(p.id === PLANILHAS[0].id ? CHAVE_COPIA : `${CHAVE_COPIA}:${p.id}`, null)).find((c) => c && c.id === u.uid);
    if (!copia) { mostrarBloqueio({ titulo: "Sem conexão", texto: "Não foi possível abrir a planilha agora. Verifique a internet.", verificar: true }); return; }
    const perfil = { nome: copia.nome, email: copia.email, papel: copia.papel, ativo: true };
    if (copia.vinculadoEm) entrarComIdentidade(u.uid, { email: copia.email, vinculadoEm: copia.vinculadoEm }, { ...perfil, aprovado: true }, { semConexao: true });
    else entrarComPerfil(u.uid, perfil, { semConexao: true });
    return;
  }
  if (!aparelho) { estado.usuario = null; if (!entradaVisivel()) mostrarRegistro(); return; }
  if (!aparelho.vinculadoEm) { rotaCadastroAntigo(u.uid, aparelho); return; }
  rotaIdentidade(u.uid, aparelho, identidade);
}
/* Lê o aparelho deste navegador (e a identidade, se ligado) e leva para a tela certa */
async function abrirAparelho(uid) {
  const aparelho = await estado.api.lerDoc(`tickets-pessoas/${uid}`);
  if (!aparelho) {
    const estavaDentro = !!estado.usuario;
    estado.usuario = null;
    mostrarRegistro(estavaDentro ? { aviso: "Este computador saiu do seu cadastro. Entre de novo com o seu e-mail e nome." } : {});
    return;
  }
  if (!aparelho.vinculadoEm) { rotaCadastroAntigo(uid, aparelho); return; }
  rotaIdentidade(uid, aparelho, await estado.api.lerDoc(`tickets-identidades/${aparelho.email}`));
}
/* Cadastro antigo (ainda não unificado): vale o próprio aparelho, como antes */
function rotaCadastroAntigo(uid, perfil) {
  if (perfil.ativo === false && perfil.pendente) { mostrarPendente(uid); return; }
  if (perfil.ativo === false) { mostrarBloqueada(); return; }
  entrarComPerfil(uid, perfil);
}
/* Cadastro por e-mail: liberado entra; aguardando, bloqueado ou desconectado vão para a tela de cada caso */
function rotaIdentidade(uid, aparelho, identidade) {
  pararOuvintes();
  estado.mensagemBloqueio = null;
  if (!identidade) {
    estado.usuario = null;
    mostrarRegistro({ aviso: "Não encontramos o seu cadastro. Entre de novo com o seu e-mail e nome ou fale com a Lays ou a Paula.", email: aparelho.email || "" });
    return;
  }
  lembrarConta(identidade.email, identidade.nome);
  if (desconectado(aparelho, identidade)) {
    estado.usuario = null;
    mostrarRegistro({ aviso: "Este computador foi desconectado do seu cadastro. Entre de novo com o seu e-mail e nome.", email: identidade.email });
    return;
  }
  if (identidade.ativo === false) { mostrarBloqueada(); return; }
  if (!identidade.aprovado) { mostrarPendenteIdentidade(uid, aparelho); return; }
  entrarComIdentidade(uid, aparelho, identidade);
}
function entrarComIdentidade(uid, aparelho, identidade, { semConexao = false } = {}) {
  pararOuvintes();
  estado.mensagemBloqueio = null;
  estado.usuario = { id: uid, uid, email: identidade.email, nome: identidade.nome, papel: identidade.papel === "leitura" ? "leitura" : "equipe", vinculadoEm: aparelho.vinculadoEm || "" };
  lembrarConta(identidade.email, identidade.nome);
  const ultimo = Date.parse(aparelho.ultimoAcesso || "");
  if (!semConexao && (isNaN(ultimo) || Date.now() - ultimo > 3600000)) {
    estado.api.salvarDoc(`tickets-pessoas/${uid}`, { ultimoAcesso: "__AGORA__" }, true).catch((e) => console.warn("ultimoAcesso:", e));
  }
  iniciarPlanilha();
  /* Bloqueio, papel, nome corrigido e "Desconectar todos os aparelhos" valem na hora */
  estado.pararOuvintes.push(estado.api.ouvirDoc(`tickets-identidades/${identidade.email}`, (i) => {
    if (!estado.usuario || estado.usuario.uid !== uid) return;
    if (!i || i.ativo === false || !i.aprovado || desconectado(aparelho, i)) { rotaIdentidade(uid, aparelho, i); return; }
    const papelNovo = i.papel === "leitura" ? "leitura" : "equipe";
    if (papelNovo === estado.usuario.papel && i.nome === estado.usuario.nome) return;
    Object.assign(estado.usuario, { papel: papelNovo, nome: i.nome });
    lembrarConta(i.email, i.nome);
    atualizarTopo(); atualizarBotoes(); agendarRender();
  }, (e) => { console.warn("cadastro", e); if (/permission/.test((e && e.code) || "")) reconferirAcesso(); }));
}
function entrarComPerfil(uid, perfil, { semConexao = false } = {}) {
  pararOuvintes();
  estado.mensagemBloqueio = null;
  estado.usuario = { id: uid, uid, email: perfil.email, nome: perfil.nome, papel: perfil.papel === "leitura" ? "leitura" : "equipe" };
  lembrarConta(perfil.email, perfil.nome);
  const ultimo = Date.parse(perfil.ultimoAcesso || "");
  if (!semConexao && (isNaN(ultimo) || Date.now() - ultimo > 3600000)) {
    estado.api.salvarDoc(`tickets-pessoas/${uid}`, { ultimoAcesso: "__AGORA__" }, true).catch((e) => console.warn("ultimoAcesso:", e));
  }
  iniciarPlanilha();
  /* Bloqueio, mudança de papel ou unificação (o aparelho passa a seguir a identidade) valem na hora */
  estado.pararOuvintes.push(estado.api.ouvirDoc(`tickets-pessoas/${uid}`, (d) => {
    if (!estado.usuario || estado.usuario.id !== uid || !d) return;
    if (d.vinculadoEm) { reconferirAcesso(); return; }
    if (d.ativo === false) { mostrarBloqueada(); return; }
    const papelNovo = d.papel === "leitura" ? "leitura" : "equipe";
    if (papelNovo !== estado.usuario.papel) { estado.usuario.papel = papelNovo; atualizarTopo(); atualizarBotoes(); agendarRender(); }
  }, (e) => console.warn("perfil", e)));
}
/* Acesso recusado no meio do uso (bloqueio, desconexão, unificação): relê o aparelho e decide a tela.
   Se voltar a ser recusado logo em seguida, mostra o bloqueio (evita ficar entrando e saindo). */
let reconferindo = null, ultimaReconferencia = 0;
function reconferirAcesso() {
  if (reconferindo) return reconferindo;
  const u = estado.api && estado.api.usuarioAtual();
  if (!u || !u.anonimo || Date.now() - ultimaReconferencia < 15000) { mostrarBloqueada(); return Promise.resolve(); }
  ultimaReconferencia = Date.now();
  pararOuvintes();
  reconferindo = abrirAparelho(u.uid)
    .catch((e) => { console.warn(e); mostrarBloqueada(); })
    .finally(() => { reconferindo = null; });
  return reconferindo;
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
    gravarLocal(chaveCopia(), { id: estado.usuario.id, email: estado.usuario.email, nome: estado.usuario.nome, papel: estado.usuario.papel, vinculadoEm: estado.usuario.vinculadoEm || "", salvaEm: new Date().toISOString(), estrutura: dadosEstruturaBackup(estado.estrutura), tickets: estado.arquivo.linhas.length ? null : estado.tickets });
  }, 1500);
}
function aplicarEstrutura(e) {
  estado.estrutura = e;
  recalcularColunas();
  cacheBusca = new WeakMap();
  if (e) { if (!estado.vista) carregarVista(); else ajustarVista(); }
  if (aparencia) aparencia.aoMudarEstrutura();
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
/* Visões, filtros e rascunho eram salvos sem o id da planilha (Banco de Tickets) e, para a equipe, pelo uid do navegador */
function migrarChavesAntigas() {
  if (!estado.usuario) return;
  ["vista", "visoes", "rascunho"].forEach((nome) => {
    if (lerLocal(chaveUsuario(nome), null) != null) return;
    const porUid = estado.usuario.uid && chaveUsuarioPorUid(nome) !== chaveUsuario(nome) ? lerLocal(chaveUsuarioPorUid(nome), null) : null;
    const antiga = porUid != null ? porUid : ehBanco() ? lerLocal(chaveUsuarioAntiga(nome), null) : null;
    if (antiga != null) gravarLocal(chaveUsuario(nome), antiga);
  });
}

/* Sessão (depois de entrar): topo, abas de planilha e, para administradoras, a lista de pessoas */
function iniciarPlanilha() {
  mostrarTela("app");
  atualizarTopo();
  marcarPlanilha(estado.planilha);
  if (ehAdmin()) {
    const aoMudar = () => { cacheBusca = new WeakMap(); atualizarBotaoAdmin(); atualizarBotoes(); if (estado.aoMudarPessoas) estado.aoMudarPessoas(); };
    estado.pararOuvintes.push(estado.api.ouvirColecao("tickets-pessoas", (lista) => { estado.pessoas = lista; aoMudar(); }, (e) => console.warn("pessoas", e)));
    estado.pararOuvintes.push(estado.api.ouvirColecao("tickets-identidades", (lista) => { estado.identidades = lista; aoMudar(); }, (e) => console.warn("identidades", e)));
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
  /* Aparência da planilha aberta (pessoal deste navegador + padrão da planilha no Firestore) */
  if (aparencia) aparencia.aoTrocarPlanilha();
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
      reconferirAcesso(); return;
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
    if (aparencia) aparencia.aoMudarDados();
    verificarNomesPerdidos();
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
migrarIdentidadeAntiga();
marcarPlanilha(planilhaInicial());
/* Aparência livre: por pessoa (este navegador, por planilha) e padrão da planilha (<prefixo>-config/aparencia,
   só administradoras gravam). O padrão só é ouvido com a sessão aberta (as regras exigem login). */
aparencia = criarAparencia({
  prefixo: "banco-tickets",
  planilha: () => ({ id: planilhaAtual().id, nome: planilhaAtual().nome }),
  usuario: () => (estado.usuario ? estado.usuario.email || estado.usuario.id : ""),
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
  ancora: $("#app [data-tema-botao]"),
  padrao: {
    ouvir: (cb) => (estado.api && estado.usuario ? estado.api.ouvirDoc(`${P()}-config/aparencia`, cb, (e) => console.warn("aparência", e)) : null),
    lerImagem: async () => { const d = estado.api && estado.usuario ? await estado.api.lerDoc(`${P()}-config/aparencia-imagem`) : null; return d && d.imagem; },
    /* imagem: texto = grava a imagem; null = apaga; undefined = não mexe */
    gravar: async (dados, imagem) => {
      const assinatura = { atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email };
      const ops = [{ op: "set", caminho: `${P()}-config/aparencia`, dados: { tema: dados.tema, regras: dados.regras, permitirPessoal: dados.permitirPessoal, ...assinatura } }];
      if (imagem === null) ops.push({ op: "delete", caminho: `${P()}-config/aparencia-imagem` });
      else if (typeof imagem === "string") ops.push({ op: "set", caminho: `${P()}-config/aparencia-imagem`, dados: { imagem, ...assinatura } });
      await estado.api.lote(ops);
      registrarAuditoria("aparencia", `Padrão de aparência da planilha ${planilhaAtual().nome}${dados.permitirPessoal ? "" : " (aparência pessoal desligada)"}`);
    },
    remover: async () => {
      await estado.api.lote([{ op: "delete", caminho: `${P()}-config/aparencia` }, { op: "delete", caminho: `${P()}-config/aparencia-imagem` }]);
      registrarAuditoria("aparencia", `Padrão de aparência removido da planilha ${planilhaAtual().nome}`);
    }
  }
});
(async () => {
  const api = await conectar();
  estado.api = api;
  if (!api) { mostrarRegistro(); marcarErrosIdentidade({}, "Sem conexão com o servidor. Verifique a internet e recarregue a página."); return; }
  api.aoMudarUsuario((u) => { aoMudarUsuario(u).catch((e) => { console.error(e); mostrarBloqueio({ titulo: "Algo deu errado", texto: "Não foi possível abrir a planilha. Recarregue a página.", verificar: true }); }); });
})();
window.__bancoTickets = { estado, get aparencia() { return aparencia; } };
