/*
 * ============================================================
 *  CADEIAS V6 / V12 · Suporte V/Cert
 *  Planilhas das localidades das cadeias V6 e V12. Site à parte: não tem nenhum
 *  caminho para outros sites e não lê dados deles. Os cadastros são só daqui
 *  (quem entra em outro site não entra aqui, e vice-versa).
 *
 *  Perfis: administradora (Lays e Paula: tudo), Equipe N2 (vê e edita os registros,
 *  vê as últimas mudanças; não mexe em estrutura nem localidades; não exclui de vez)
 *  e Equipe (só visualiza). No motor, Equipe N2 = papel "equipe" e Equipe = papel "leitura".
 *  As mesmas permissões estão no firestore.rules (vale o que está lá).
 *
 *  Firestore (tudo com o prefixo "cadeias-"):
 *   cadeias-ambientes/{v6|v12}   nome, descrição, cor e a ESTRUTURA do ambiente (colunas, grupos, regras,
 *                                colunasEquipe, colunasTravadas, listasEquipe, listasOrdem, colunaChave,
 *                                colunaAbas, colunaResumo). Todas as localidades do ambiente usam essas colunas.
 *   cadeias-grupos/{id}          { ambiente, nome, ordem }: Região, etc.
 *   cadeias-localidades/{id}     { ambiente, grupo, nome, uf, codigo, responsavel, cor, icone, ordem, observacao,
 *                                ativa, colunasExtras, colunasEquipeExtras, contagem, resumo, hoje, atualizadoEm,
 *                                atualizadoPor, atualizadoPorNome, ultimoRegistro }. Os números do painel vêm daqui
 *                                (atualizados no mesmo lote de cada gravação), sem ler os registros.
 *     /registros/{id}            { campos, chave, parcial, criadoPor…, atualizadoPor…, exclusao, importacao }
 *       /historico/{e}           antes e depois de cada célula (ficha lateral)
 *     /arquivo/{parte}           registros compactados (muitos por documento)
 *     /chaves/{valor}            índice da coluna chave (valor único): { registro }
 *   cadeias-historico/{id}       as mudanças do ambiente (Últimas 15 mudanças), gravadas no mesmo lote
 *   cadeias-identidades/{email}  a "conta": { email, nome, nomeChave, perfil: "equipe-n2" | "equipe", ativo, aprovado… }
 *   cadeias-emails/{email}       vazio: "este e-mail tem cadastro" (lido um por vez, nunca listado)
 *   cadeias-pessoas/{uid}        o aparelho (login anônimo deste navegador)
 *   cadeias-config/entrada       regras de cadastro; cadeias-config/aparencia-<ambiente> (aparência padrão)
 *   cadeias-lixeira, cadeias-backups (só administradoras), cadeias-auditoria (só inclusão)
 *
 *  Motor de planilha com estrutura dinâmica (colunas, listas, regras), arquivo compactado e histórico.
 *  Todas as chaves deste site no navegador (localStorage, sessionStorage, IndexedDB) começam com "cadeias-".
 * ============================================================
 */
import { injetarIcones } from "./icones.js";
import { conectar, ehEmailAdmin, ADMINS, LOGIN_MICROSOFT } from "./firebase.js";
import { criarAparencia } from "./aparencia.js";
import { lerArquivoTabela, gerarXlsx, TAMANHO_MAXIMO_ARQUIVO } from "./planilha-arquivos.js";
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
/* Todas as chaves deste site (localStorage) começam com "cadeias-" */
const lerLocal = (chave, padrao) => { try { const v = localStorage.getItem(chave); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } };
const gravarLocal = (chave, valor) => { try { localStorage.setItem(chave, JSON.stringify(valor)); return true; } catch (e) { return false; } };
const apagarLocal = (chave) => { try { localStorage.removeItem(chave); } catch (e) {} };
const CHAVE_TEMA = "cadeias-tema";
const CHAVE_ATIVIDADE = "cadeias-ultima-atividade";
const CHAVE_COPIA = "cadeias-copia";
const CHAVE_MARCADOR = "cadeias-marcador-removidas";
const CHAVE_ULTIMO_AMBIENTE = "cadeias-ultimo-ambiente";
/* As duas cadeias. Cada uma tem a sua estrutura de colunas (cadeias-ambientes/{id}) e as suas localidades. */
const AMBIENTES = [{ id: "v6", nome: "V6" }, { id: "v12", nome: "V12" }];
const ehAmbiente = (id) => AMBIENTES.some((a) => a.id === id);
const nomeAmbiente = (id) => (AMBIENTES.find((a) => a.id === id) || { nome: String(id || "").toUpperCase() }).nome;
const outroAmbiente = (id) => (id === "v6" ? "v12" : "v6");
const COL_AMBIENTES = "cadeias-ambientes", COL_GRUPOS = "cadeias-grupos", COL_LOCALIDADES = "cadeias-localidades";
const COL_HISTORICO = "cadeias-historico", COL_CONFIG = "cadeias-config";
const COL_IDENTIDADES = "cadeias-identidades", COL_EMAILS = "cadeias-emails", COL_PESSOAS = "cadeias-pessoas";
/* Lixeira, backups e auditoria são de todas as planilhas juntas (o campo "planilha" diz de qual localidade é) */
const COL_LIXEIRA = "cadeias-lixeira", COL_BACKUPS = "cadeias-backups", COL_AUDITORIA = "cadeias-auditoria";
/* A planilha aberta é uma planilha (estado.planilha = id da localidade). planilhaAtual() devolve o formato do motor. */
const TERMO = { um: "registro", varios: "registros", novo: "Novo registro" };
const localidadePorId = (id) => estado.localidades.find((l) => l.id === id) || null;
const planilhaAtual = () => {
  const l = localidadePorId(estado.planilha);
  return { id: estado.planilha || "", ambiente: l ? l.ambiente : estado.ambiente, nome: l ? l.nome : "", curto: l ? l.nome : "", termo: TERMO, indices: true, arquivo: true };
};
const caminhoEstrutura = () => `${COL_AMBIENTES}/${planilhaAtual().ambiente || estado.ambiente}`;
const termo = () => TERMO;
const somenteAdminEdita = () => false;
const nomeCompletoPlanilha = (pl) => (pl && pl.nome ? `${nomeAmbiente(pl.ambiente)} › ${pl.nome}` : nomeAmbiente(estado.ambiente));
const daPlanilhaAtual = (doc) => !!doc && doc.planilha === planilhaAtual().id;
/* Caminhos da localidade aberta: registros, arquivo compactado e índice da coluna chave */
const LOC = (id = estado.planilha) => `${COL_LOCALIDADES}/${id}`;
const P = () => `${LOC()}/registros`;
const ARQ = () => `${LOC()}/arquivo`;
/* Cópia no navegador (sem conexão): uma por localidade */
const chaveCopia = () => `${CHAVE_COPIA}:${planilhaAtual().id}`;
/* Visões e filtros: por pessoa e por ambiente (as colunas são as mesmas em todas as planilhas);
   rascunhos e importações pendentes: por pessoa e por localidade */
const idLocal = () => (estado.usuario && (estado.usuario.email || estado.usuario.id)) || "anonimo";
const POR_AMBIENTE = ["vista", "visoes", "sugestoes-novo"];
const chaveUsuario = (nome) => `cadeias-${nome}:${POR_AMBIENTE.includes(nome) ? `amb-${planilhaAtual().ambiente}` : planilhaAtual().id}:${idLocal()}`;
const CHAVE_CONTAS = "cadeias-contas-recentes";
const CHAVE_TENTATIVAS = "cadeias-tentativas-nome";
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
 *  Estrutura (colunas, grupos e regras)
 *  O id da coluna nunca muda: renomear muda só o rótulo.
 * ------------------------------------------------------------ */
const TIPOS = [
  { id: "texto", nome: "Texto curto" }, { id: "textoLongo", nome: "Texto longo" }, { id: "numero", nome: "Número" },
  { id: "data", nome: "Data" }, { id: "dataHora", nome: "Data e hora" }, { id: "mesAno", nome: "Mês/ano (MM/AAAA)" }, { id: "lista", nome: "Lista (uma opção)" },
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
/* Quem altera cada coluna. "lista": a equipe só escolhe uma opção existente.
   "travado": a Equipe N2 preenche ao cadastrar o registro; depois, só as administradoras alteram. */
const ACESSOS = [
  { id: "bloqueado", nome: "BLOQUEADO (só administradoras)" },
  { id: "livre", nome: "LIVRE (toda a equipe)" },
  { id: "lista", nome: "LISTA (a equipe escolhe uma opção)" },
  { id: "travado", nome: "TRAVADO APÓS CRIAR (a equipe preenche só ao cadastrar)" }
];
const NOME_ACESSO_CURTO = { bloqueado: "BLOQUEADO", livre: "LIVRE", lista: "LISTA", travado: "TRAVADO APÓS CRIAR" };
const TEXTO_BLOQUEADO = "Só as administradoras alteram este campo";
const TEXTO_TRAVADO = "Para corrigir, fale com a Lays ou a Paula";
function acessoDe(c) {
  if (c.tipo && TIPOS_SEM_EDICAO.includes(c.tipo)) return "livre";
  const lista = TIPOS_LISTA.includes(c.tipo);
  if (c.acesso === "bloqueado" || (!c.acesso && c.somenteAdmin)) return "bloqueado";
  if (c.acesso === "travado") return "travado";
  if (c.acesso === "livre" && !lista) return "livre";
  return lista ? "lista" : "livre";
}
/* Texto do cadeado (cabeçalho, célula e formulário) para quem não pode alterar a coluna */
function textoTrava(col) {
  if (!col || ehAdmin()) return "";
  if (col.somenteAdmin) return TEXTO_BLOQUEADO;
  if (col.acesso === "travado") return TEXTO_TRAVADO;
  return "";
}

/* Nenhuma coluna é fixa: cada ambiente começa sem colunas até a administradora definir (assistente "Começar").
   Escolhidas pela administradora no ambiente: coluna chave (valor único, índice em <localidade>/chaves),
   coluna das abas (uma LISTA) e coluna do resumo (uma LISTA; contagem por opção nos cards das localidades). */
function colunaBase(id, nome, tipo, extra = {}) {
  return { id, nome, tipo, grupo: "geral", largura: 160, obrigatoria: false, unica: false, padrao: "", opcoes: [], ajuda: "", somenteAdmin: false, acesso: "livre", ativa: true, ...extra };
}
function estruturaVazia(amb) {
  return {
    titulo: `CADEIA ${nomeAmbiente(amb)}`, versao: 1, categorias: [], colunas: [],
    gruposColunas: [{ id: "geral", nome: "Geral", ordem: 1 }],
    regras: { equipeEdita: "todas", janelaEdicaoHoras: 0, exportacao: true }, colunaChave: "", colunaAbas: "", colunaResumo: ""
  };
}
/* Quem pode criar cadastro na tela de entrada (cadeias-config/entrada; igual ao padrão do firestore.rules).
   aprovacao: o cadastro novo fica "aguardando liberação" até uma administradora liberar (e escolher o perfil). */
const REGISTRO_PADRAO = { aberto: true, dominios: [], aprovacao: true };
const RE_DOMINIO = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
function normalizarRegistro(g) {
  g = g && typeof g === "object" ? g : {};
  return {
    aberto: g.aberto !== false,
    dominios: [...new Set((Array.isArray(g.dominios) ? g.dominios : []).map((x) => String(x).trim().toLowerCase().replace(/^@/, "")).filter((x) => RE_DOMINIO.test(x) && x.length <= 80))].slice(0, 20),
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
function normalizarColuna(c, grupos, i) {
  return {
    id: c.id, nome: txt(c.nome, 60) || c.id, tipo: c.tipo,
    grupo: grupos.some((g) => g.id === c.grupo) ? c.grupo : grupos[0].id,
    ordem: Number(c.ordem) || i + 1, largura: Math.max(60, Math.min(600, Number(c.largura) || 150)),
    ...(Number(c.ordemFormulario) > 0 ? { ordemFormulario: Math.min(999, Math.round(Number(c.ordemFormulario))) } : {}),
    obrigatoria: !!c.obrigatoria, unica: !!c.unica, padrao: txt(c.padrao, 60),
    opcoes: (Array.isArray(c.opcoes) ? c.opcoes : []).map(normalizarOpcao).filter(Boolean).slice(0, MAX_OPCOES_TOTAL),
    ajuda: txt(c.ajuda, 200), acesso: acessoDe(c), somenteAdmin: acessoDe(c) === "bloqueado", ativa: c.ativa !== false,
    ...(c.extra ? { extra: true } : {}),
    /* Texto com formato: e-mail (vira link mailto) ou telefone (máscara BR) */
    ...(c.tipo === "texto" && FORMATOS_TEXTO[c.formato] ? { formato: c.formato } : {}),
    ...(c.tipo === "automatico" ? { auto: AUTOS[c.auto] ? c.auto : "criadoEm" } : {}),
    ...(c.tipo === "derivado" ? { formula: FORMULAS[c.formula] ? c.formula : "diasEmAberto", de: txt(c.de, 40), ate: txt(c.ate, 40) } : {})
  };
}
const FORMATOS_TEXTO = { email: "E-mail", telefone: "Telefone" };
const colunaValida = (c) => c && RE_ID.test(c.id || "") && NOME_TIPO[c.tipo];
/* Estrutura do ambiente (sem as colunas extras da localidade) */
function normalizarEstruturaBase(d) {
  const grupos = (Array.isArray(d.gruposColunas) ? d.gruposColunas : []).filter((g) => g && RE_OPCAO.test(g.id || ""))
    .map((g, i) => ({ id: g.id, nome: txt(g.nome, 60) || g.id, ordem: Number(g.ordem) || i + 1 }));
  if (!grupos.length) grupos.push({ id: "geral", nome: "Geral", ordem: 1 });
  const colunas = (Array.isArray(d.colunas) ? d.colunas : []).filter(colunaValida).map((c, i) => normalizarColuna({ ...c, extra: false }, grupos, i));
  const r = d.regras || {};
  const ids = new Set(colunas.map((c) => c.id));
  const lista = (id) => (ids.has(id) && TIPOS_LISTA.includes(colunas.find((c) => c.id === id).tipo) ? id : "");
  /* Coluna chave: para a Equipe N2 vale como "travado após criar" (o índice do valor único só a administradora apaga) */
  const chave = colunas.find((c) => c.id === d.colunaChave && !TIPOS_LISTA.includes(c.tipo));
  if (chave && chave.acesso !== "bloqueado") chave.acesso = "travado";
  return {
    titulo: txt(d.titulo, 80) || `CADEIA ${nomeAmbiente(estado.ambiente)}`,
    versao: Number(d.versao) || 1,
    categorias: [], colunas, gruposColunas: grupos,
    regras: {
      equipeEdita: EQUIPE_EDITA.some((x) => x.id === r.equipeEdita) ? r.equipeEdita : "todas",
      janelaEdicaoHoras: Math.max(0, Math.min(8760, Math.floor(Number(r.janelaEdicaoHoras) || 0))),
      exportacao: r.exportacao !== false
    },
    colunaChave: chave ? chave.id : "",
    colunaAbas: lista(d.colunaAbas), colunaResumo: lista(d.colunaResumo),
    chaveComposta: !!chave && d.chaveComposta === true,
    atualizadoEm: d.atualizadoEm || "", atualizadoPor: txt(d.atualizadoPor, 120)
  };
}
/* Estrutura em uso na planilha aberta: a do ambiente + as colunas extras da localidade (grupo próprio, no fim) */
const GRUPO_EXTRAS = "extras-localidade";
/* Coluna "Seção" das planilhas por estado: não é gravada (vem do campo "secao" do registro); só aparece em "Ver por sistema" */
const COL_SECAO = "secaoDaLinha";
function normalizarEstrutura(d, loc = localidadePorId(estado.planilha)) {
  if (!d || typeof d !== "object") return null;
  const e = normalizarEstruturaBase(d);
  const extras = loc && Array.isArray(loc.colunasExtras) ? loc.colunasExtras.filter((c) => colunaValida(c) && !e.colunas.some((x) => x.id === c.id)) : [];
  const junto = e.colunas.find((c) => c.id === e.colunaChave) || e.colunas[0] || { grupo: "", ordem: 0 };
  const virtual = loc && loc.modo === "estado" && !e.colunas.some((c) => c.id === COL_SECAO)
    ? [{ ...normalizarColuna({ id: COL_SECAO, nome: "Seção", tipo: "derivado", grupo: junto.grupo, largura: 170, ordem: junto.ordem + 0.5 }, e.gruposColunas, 0), formula: "secao", extra: true, virtual: true }] : [];
  if (!extras.length && !virtual.length) return e;
  const grupos = extras.length ? [...e.gruposColunas, { id: GRUPO_EXTRAS, nome: "Desta planilha", ordem: 999 }] : e.gruposColunas;
  return { ...e, gruposColunas: grupos, colunas: [...e.colunas, ...virtual, ...extras.map((c, i) => normalizarColuna({ ...c, grupo: GRUPO_EXTRAS, extra: true }, grupos, i))] };
}
/* Listas que as regras do Firestore usam: o que a equipe pode preencher, o que fica travado depois de criado
   e as opções que a equipe pode gravar em cada coluna LISTA. As regras conferem as opções das 12 primeiras
   colunas LISTA (listasOrdem); acima disso, a conferência é só na interface. */
const MAX_LISTAS_REGRAS = 12;
const colunasDaEquipe = (e) => e.colunas.filter((c) => c.ativa && !c.somenteAdmin && !TIPOS_SEM_EDICAO.includes(c.tipo)).map((c) => c.id);
const colunasTravadas = (e) => e.colunas.filter((c) => c.acesso === "travado" && !TIPOS_SEM_EDICAO.includes(c.tipo)).map((c) => c.id);
const listasDaEquipe = (e) => Object.fromEntries(e.colunas.filter((c) => c.ativa && c.acesso === "lista")
  .map((c) => [c.id, c.opcoes.filter((o) => o.ativa !== false).map((o) => o.id)]));
/* O que vai para cadeias-ambientes/{amb} (gravado com "mesclar": nome, descrição e cor do ambiente ficam) */
function dadosEstrutura(e) {
  const semExtras = { ...e, colunas: e.colunas.filter((c) => !c.extra), gruposColunas: e.gruposColunas.filter((g) => g.id !== GRUPO_EXTRAS) };
  const normal = normalizarEstruturaBase(semExtras);
  const base = { ...normal, colunas: normal.colunas.map(({ extra, ...c }) => c) };
  const listas = listasDaEquipe(base);
  return {
    titulo: base.titulo, versao: base.versao, categorias: [], colunas: base.colunas, gruposColunas: base.gruposColunas,
    regras: { equipeEdita: base.regras.equipeEdita, janelaEdicaoHoras: base.regras.janelaEdicaoHoras, exportacao: base.regras.exportacao },
    colunasEquipe: colunasDaEquipe(base), colunasTravadas: colunasTravadas(base), listasEquipe: listas,
    listasOrdem: Object.keys(listas).slice(0, MAX_LISTAS_REGRAS),
    colunaChave: base.colunaChave || "", colunaAbas: base.colunaAbas || "", colunaResumo: base.colunaResumo || "",
    chaveComposta: !!base.chaveComposta,
    configurado: true, atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email
  };
}
const salvarEstrutura = (e, amb = planilhaAtual().ambiente || estado.ambiente) => estado.api.salvarDoc(`${COL_AMBIENTES}/${amb}`, dadosEstrutura(e), true);

/* ------------------------------------------------------------
 *  Estado
 * ------------------------------------------------------------ */
/* docs: todos os documentos do arquivo compactado da localidade (de qualquer versão); partes: os da versão em uso */
function arquivoVazio() { return { versao: 0, docs: [], partes: [], linhas: [], parteDe: new Map() }; }
const estado = {
  api: null,
  ambiente: "",               // "v6" | "v12" (ambiente aberto)
  ambientes: {},              // cadeias-ambientes/{id} (tempo real)
  carregouAmbientes: false,
  grupos: [],                 // cadeias-grupos (dos dois ambientes)
  localidades: [],            // cadeias-localidades (dos dois ambientes; só os documentos, sem os registros)
  carregouLocalidades: false,
  entrada: null,              // cadeias-config/entrada (regras de cadastro)
  planilha: "",               // localidade aberta (id)
  ouvintesPlanilha: [],       // onSnapshot só da localidade aberta
  usuario: null,              // { id (uid ou e-mail da administradora), uid, email, nome, papel: "admin" | "equipe" | "leitura", perfil, vinculadoEm }
  registrando: 0,             // > 0 durante o "Entrar" (login anônimo + ligar o aparelho ou criar o cadastro)
  estrutura: null,
  carregouEstrutura: false,
  equipamentos: [],           // registros da localidade: arquivo + registros vivos (o vivo substitui a linha do arquivo de mesmo id)
  carregouEquipamentos: false,
  vivos: [],                  // <localidade>/registros/{id}
  carregouVivos: false,
  arquivo: arquivoVazio(),    // <localidade>/arquivo
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
  pessoas: [],                // cadeias-pessoas (aparelhos), só administradoras
  identidades: [],            // cadeias-identidades, só administradoras
  pararOuvintes: [],
  mensagemBloqueio: null
};
/* Aparência livre (aparencia.js): criada no fim do arquivo, depois de tudo definido */
let aparencia = null;
const SEM_APARENCIA = { l: "", c: {} };
const papel = () => (estado.usuario ? estado.usuario.papel : "");
const ehAdmin = () => papel() === "admin";
/* Equipe N2 = papel "equipe" (edita); Equipe = papel "leitura" (só vê) */
const ehEquipeN2 = () => papel() === "equipe";
const veMudancas = () => ehAdmin() || ehEquipeN2();
const conectado = () => !!estado.api && !estado.offline;
const podeAlimentar = () => conectado() && !!estado.estrutura && estado.estrutura.colunas.length > 0 && (ehAdmin() || ehEquipeN2());
/* Exportar: administradoras sempre; as outras pessoas, conforme a regra do ambiente */
const podeExportar = () => !!estado.estrutura && (ehAdmin() || estado.estrutura.regras.exportacao !== false);
/* Selo "Somente visualização": a Equipe (não edita nada) */
const soVisualizacao = () => !!estado.usuario && papel() === "leitura";
const porId = (id) => estado.equipamentos.find((t) => t.id === id);
const mapaEquipamentos = () => new Map(estado.equipamentos.map((t) => [t.id, t]));
/* Índice da coluna chave (refeito quando a lista de registros muda) */
let indiceNumeros = null, indiceNumerosDe = null;
function equipamentosComHostname(chave) {
  if (indiceNumerosDe !== estado.equipamentos) {
    indiceNumeros = new Map();
    const id = idChave();
    estado.equipamentos.forEach((t) => {
      const n = (t.campos || {})[id];
      const k = estaVazio(n) ? t.numero : chaveDoc(n);
      if (!k) return;
      if (!indiceNumeros.has(k)) indiceNumeros.set(k, []);
      indiceNumeros.get(k).push(t);
    });
    indiceNumerosDe = estado.equipamentos;
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
const colAtiva = (id) => (COL[id] && COL[id].ativa ? COL[id] : null);
const colCategoria = () => null;
/* Coluna chave do ambiente (valor único, indexado em <localidade>/chaves/{valor}). O registro guarda o valor
   em "numero": as regras conferem que é o mesmo valor da célula e que o índice aponta para o registro. */
const colNumero = () => (estado.estrutura && estado.estrutura.colunaChave ? colAtiva(estado.estrutura.colunaChave) : null);
const idChave = () => (colNumero() ? colNumero().id : "");
let INDICES = [];
const atualizarIndices = () => { INDICES = colNumero() ? [{ campo: "numero", col: colNumero().id, colecao: "chaves" }] : []; };
const caminhoIndice = (ix, valor) => `${LOC()}/${ix.colecao}/${valor}`;
/* Chave composta (estrutura de Tribunais e Órgãos): "<seção>|<sistema em minúsculas>" (ex.: "ac|e-saj"); no modo
   "por sistema", só o sistema. O mesmo sistema pode existir em várias seções. Igual a chaveRegistroCadeias() das regras. */
const chaveComposta = (e = estado.estrutura) => !!(e && e.chaveComposta);
const montarChave = (v, secao, composta) => { const k = chaveDoc(v); return !k ? "" : composta ? `${secao ? `${secao}|` : ""}${k.toLowerCase()}` : k; };
const chaveIndice = (ix, campos, secao = "") => (colAtiva(ix.col) && !estaVazio((campos || {})[ix.col]) ? montarChave(campos[ix.col], secao, chaveComposta()) : "");
const numeroDe = (campos, secao = "") => (INDICES[0] ? chaveIndice(INDICES[0], campos, secao) : "");
/* Escritas dos índices quando os valores mudam (antes = campos atuais; depois = campos completos novos).
   Devolve { dados (numero para o registro), ops (criar o índice novo e apagar o antigo) } */
function indicesMudanca(id, antes, depois, secao = "") {
  const dados = {}, ops = [];
  INDICES.forEach((ix) => {
    if (!colAtiva(ix.col)) return;
    const a = chaveIndice(ix, antes, secao), b = chaveIndice(ix, depois, secao);
    if (a === b) return;
    dados[ix.campo] = b;
    if (b) ops.push({ op: "set", caminho: caminhoIndice(ix, b), dados: { registro: id } });
    if (a) ops.push({ op: "delete", caminho: caminhoIndice(ix, a) });
  });
  return { dados, ops };
}
/* Apagar os índices de registros que saem de vez (ou vão para a lixeira) */
const opsApagarIndices = (t) => INDICES.flatMap((ix) => { const k = chaveIndice(ix, t.campos, t.secao) || t[ix.campo] || ""; return k ? [{ op: "delete", caminho: caminhoIndice(ix, k) }] : []; });
function opcoesDe(col) {
  if (!col) return [];
  return col.opcoes;
}
const cacheOpcoes = new WeakMap();
function opcao(col, id) {
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
  if (col.formula === "secao") return nomeDaSecao(localidadePorId(estado.planilha), t.secao);
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
const RE_EMAIL_CELULA = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
/* Telefone BR: 10 ou 11 dígitos (com ou sem 55) viram (11) 91234-5678; outros textos ficam como foram escritos */
function formatarTelefone(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || /[a-z]/i.test(s.replace(/ramal|r\./gi, ""))) return s;
  let d = s.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 8 || d.length === 9) return `${d.slice(0, d.length - 4)}-${d.slice(-4)}`;
  return s;
}
/* Enquanto digita: só números viram a máscara (o que tiver letra, ramal etc. fica como está) */
function mascaraTelefone(el) {
  const s = el.value;
  if (!/^[\d\s()+-]*$/.test(s)) return;
  const d = s.replace(/\D/g, "").slice(0, 11);
  let r = d;
  if (d.length > 2) r = `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length > 6) r = `(${d.slice(0, 2)}) ${d.slice(2, d.length === 11 ? 7 : 6)}-${d.slice(d.length === 11 ? 7 : 6)}`;
  if (r !== s) el.value = r;
}
document.addEventListener("input", (e) => { if (e.target.matches && e.target.matches("input[data-formato='telefone']")) mascaraTelefone(e.target); }, true);
/* Lista ainda sem opções (ex.: GESTOR antes de as administradoras cadastrarem) */
const textoListaVazia = (col) => `Peça a uma administradora para cadastrar as opções de ${col.nome}`;
function htmlValor(t, col) {
  const v = valorBruto(t, col);
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) {
    /* Lista sem opções (ex.: Responsável no começo): o aviso só aparece nas obrigatórias, para não repetir em todas as linhas */
    return col.tipo === "lista" && col.obrigatoria && !opcoesAtivas(col).length ? `<span class="t vazio-lista">${escapar(textoListaVazia(col))}</span>` : "";
  }
  switch (col.tipo) {
    case "lista": case "status": case "prioridade": {
      const o = opcao(col, v);
      if (!o) return `<span class="t">${escapar(v)}</span><span class="selo-fora" title="Valor que não existe nas opções desta coluna">fora da lista</span>`;
      return htmlOpcao(col, o);
    }
    case "etiquetas": return (Array.isArray(v) ? v : []).map((x) => { const o = opcao(col, x); return o ? etiquetaOpcao(o) + marcaRemovida(o) : etiquetaOpcao(null, x); }).join(" ");
    case "link": return /^https?:\/\//i.test(v) ? `<a href="${escapar(v)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : `<span class="t">${escapar(v)}</span>`;
    case "booleano": return v ? etiquetaOpcao({ cor: "verde" }, "Sim") : "";
    case "derivado": { const n = Number(v); return `<span class="t"${col.formula !== "secao" && n > 7 && !finalizado(t) ? ' style="color:var(--c-vermelho);font-weight:700"' : ""}>${escapar(v)}</span>`; }
    case "texto": {
      if (col.formato === "email" && RE_EMAIL_CELULA.test(String(v).trim())) return `<a href="mailto:${escapar(String(v).trim())}" class="link-email" title="Escrever para ${escapar(String(v).trim())}">${escapar(v)}</a>`;
      return `<span class="t">${escapar(valorTexto(t, col))}</span>`;
    }
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
/* Valor da coluna chave: o documento do índice usa o valor sem espaços nas pontas e com "/" trocada por "|"
   (igual ao firestore.rules). ".", ".." e "__x__" não podem ser nome de documento. */
const chaveDoc = (v) => chaveNumero(v).replace(/\//g, "|");
const chaveIndiceValida = (v) => !!v && v.length <= 300 && v !== "." && v !== ".." && !/^__.*__$/.test(v);
const ehColunaIndice = (col) => !!col && INDICES.some((ix) => ix.col === col.id);
function chaveNumero(v) {
  return String(v == null ? "" : v).trim();
}
/* MÊS/ANO: guardado como "MM/AAAA" (as regras conferem ^(0[1-9]|1[0-2])/20[0-9]{2}$). Aceita MM/AAAA, M/AAAA,
   AAAA-MM (seletor de mês), MM-AAAA, MM.AAAA, DD/MM/AAAA, AAAA-MM-DD, "nov/2026", "novembro de 2026" e o
   número de série de data do Excel (ex.: 46327). */
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const RE_MES_ANO = /^(0[1-9]|1[0-2])\/20\d{2}$/;
function mesAnoDe(bruto) {
  if (bruto == null) return "";
  if (typeof bruto === "number" || /^\d{5}(\.\d+)?$/.test(String(bruto).trim())) {
    const n = Number(bruto);
    if (n > 36000 && n < 80000) { const d = new Date(Math.round((n - 25569) * 86400000)); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; }
  }
  const s = normalizar(String(bruto).trim()).replace(/\s+de\s+/g, "/").replace(/\s+/g, "");
  const ok = (m, a) => { m = Number(m); a = Number(String(a).length === 2 ? "20" + a : a); return m >= 1 && m <= 12 && a >= 2000 && a <= 2099 ? `${String(m).padStart(2, "0")}/${a}` : ""; };
  let r;
  if ((r = /^(\d{1,2})[/.-](\d{4})$/.exec(s))) return ok(r[1], r[2]);
  if ((r = /^(\d{4})[/.-](\d{1,2})(?:[/.-]\d{1,2})?(?:t.*)?$/.exec(s))) return ok(r[2], r[1]);
  if ((r = /^\d{1,2}[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\D.*)?$/.exec(s))) return ok(r[1], r[2]);
  if ((r = /^([a-z]{3})[a-z]*[/.-]?(\d{2}|\d{4})$/.exec(s)) && MESES.includes(r[1])) return ok(MESES.indexOf(r[1]) + 1, r[2]);
  return "";
}
/* "MM/AAAA" → "AAAA-MM" (ordenar e o seletor de mês) */
const mesAnoParaIso = (v) => { const m = /^(\d{2})\/(\d{4})$/.exec(String(v || "")); return m ? `${m[2]}-${m[1]}` : ""; };
/* "atual": valor que o registro já tem. Uma opção removida da lista só passa se já era o valor (ou uma das etiquetas). */
function validarValor(col, bruto, atual) {
  const vazio = bruto == null || bruto === "" || (Array.isArray(bruto) && !bruto.length);
  switch (col.tipo) {
    case "mesAno": {
      if (vazio || String(bruto).trim() === "") return { ok: true, valor: "" };
      const v = mesAnoDe(bruto);
      return v ? { ok: true, valor: v } : { ok: false, erro: `${col.nome}: use mês/ano no formato MM/AAAA (ex.: 11/2026).` };
    }
    case "texto": case "textoLongo": case "pessoa": {
      if (ehColunaIndice(col)) {
        const v = chaveNumero(bruto).slice(0, 300);
        if (v && !chaveIndiceValida(chaveDoc(v))) return { ok: false, erro: `${col.nome}: esse valor não pode ser usado na coluna chave.` };
        return { ok: true, valor: v };
      }
      const v = String(bruto == null ? "" : bruto).trim().slice(0, LIMITES[col.tipo]);
      return { ok: true, valor: col.formato === "telefone" ? formatarTelefone(v).slice(0, LIMITES[col.tipo]) : v };
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
      /* dd/mm/aaaa ou dd/mm/aa (ex.: 08/10/26 = 08/10/2026) */
      const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(v);
      if (br) v = `${br[3].length === 2 ? `20${br[3]}` : br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
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
/* Confere obrigatórias e únicas; "ignorar" = id do próprio registro. Valor repetido: sem diferenciar maiúsculas e acentos. */
/* "secao": a seção do registro (planilhas por estado). Com a chave composta, o sistema só não pode repetir na MESMA seção. */
function conferirRegistro(campos, ignorar, secao = secaoParaNovo()) {
  const erros = {};
  const porSecao = chaveComposta();
  colunasAtivas().forEach((c) => {
    if (TIPOS_SEM_EDICAO.includes(c.tipo)) return;
    const v = campos[c.id];
    if (c.obrigatoria && estaVazio(v) && !(c.somenteAdmin && !ehAdmin())) erros[c.id] = `${c.nome} é obrigatório.`;
    else if ((c.unica || c.id === idChave()) && !estaVazio(v)) {
      const chave = normalizar(chaveNumero(v));
      const mesmaSecao = (t) => !porSecao || c.id !== idChave() || (t.secao || "") === (secao || "");
      const outro = estado.equipamentos.find((t) => t.id !== ignorar && mesmaSecao(t) && !estaVazio((t.campos || {})[c.id]) && normalizar(chaveNumero(t.campos[c.id])) === chave);
      if (outro) {
        const nome = alvoRegistro(outro);
        const onde = porSecao && c.id === idChave() && secao ? `na seção ${nomeDaSecao(localidadePorId(estado.planilha), secao)}` : "nesta planilha";
        erros[c.id] = { texto: `${c.nome} “${valorTexto(outro, c)}” já é usado ${nome && nome !== outro.id ? `pelo registro ${nome}` : "por outro registro"} ${onde}.`, id: outro.id };
      }
    }
  });
  return erros;
}
/* Qualidade: obrigatório vazio, mês/ano fora do formato ou valor repetido na coluna chave. Recalculado a cada desenho. */
let problemasPorId = new Map();
function calcularProblemas() {
  problemasPorId = new Map();
  if (!estado.estrutura) return;
  const cols = colunasAtivas().filter((c) => !TIPOS_SEM_EDICAO.includes(c.tipo));
  const chave = idChave();
  const contagem = new Map();
  const porSecao = chaveComposta();
  const chaveDe = (t, v) => `${porSecao ? `${t.secao || ""}|` : ""}${normalizar(chaveNumero(v))}`;
  if (chave) estado.equipamentos.forEach((t) => { const v = (t.campos || {})[chave]; if (!estaVazio(v)) { const k = chaveDe(t, v); contagem.set(k, (contagem.get(k) || 0) + 1); } });
  estado.equipamentos.forEach((t) => {
    const campos = t.campos || {}, lista = [];
    cols.forEach((c) => {
      const v = campos[c.id];
      if (c.obrigatoria && estaVazio(v)) { lista.push(`${c.nome} vazio`); return; }
      if (estaVazio(v)) return;
      if (c.tipo === "mesAno" && !RE_MES_ANO.test(String(v))) lista.push(`${c.nome} fora do formato MM/AAAA`);
    });
    if (chave && !estaVazio(campos[chave]) && contagem.get(chaveDe(t, campos[chave])) > 1) lista.push(`${COL[chave].nome} repetido ${porSecao && t.secao ? "nesta seção" : "nesta planilha"}`);
    if (lista.length) problemasPorId.set(t.id, lista);
  });
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
  if (papel() !== "equipe" || somenteAdminEdita()) return false;
  const regra = estado.estrutura.regras.equipeEdita;
  if (regra === "todas") return true;
  if (regra === "proprias") return registradoPorMim(t) && dentroDaJanela(t);
  return false;
}
/* Coluna "travado após criar": a equipe preenche no cadastro; depois, só as administradoras alteram */
const podeEditarColuna = (col) => !!col && !TIPOS_SEM_EDICAO.includes(col.tipo) && (ehAdmin() || (!col.somenteAdmin && col.acesso !== "travado"));
const podeEditarCelula = (t, col) => podeEditarLinha(t) && podeEditarColuna(col);
const podePedirExclusao = (t) => conectado() && papel() === "equipe" && !somenteAdminEdita() && !!t && !t.exclusao && !t.arquivo;
function motivoSemEdicao(t, col) {
  if (!conectado()) return "Sem conexão: a edição está bloqueada.";
  if (somenteAdminEdita() && !ehAdmin()) return `Somente visualização: só a Lays e a Paula editam o ${nomeCompletoPlanilha(planilhaAtual())}.`;
  if (col && TIPOS_SEM_EDICAO.includes(col.tipo)) return `“${col.nome}” é preenchido automaticamente.`;
  if (col && col.somenteAdmin && !ehAdmin()) return `${TEXTO_BLOQUEADO}: “${col.nome}”.`;
  if (col && col.acesso === "travado" && !ehAdmin()) return `“${col.nome}” não muda depois do cadastro. ${TEXTO_TRAVADO}.`;
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
/* Colunas novas criadas pelas administradoras aparecem para todos; as que a pessoa ocultou continuam ocultas */
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
    s = normalizar([t.numero, emailAutor(t, "criadoPor"), emailAutor(t, "atualizadoPor"), t.secao ? nomeDaSecao(localidadePorId(estado.planilha), t.secao) : "", ...colunasAtivas().map((c) => valorTexto(t, c))].join(" | "));
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
  if (especial.startsWith("resumo:")) { const c = colResumo(); return !!c && (t.campos || {})[c.id] === especial.slice(7); }
  if (especial === "problemas") return problemasPorId.has(t.id);
  if (especial === "meus") return t.criadoPor === estado.usuario.id || registradoPorMim(t);
  return true;
}
/* Abas que filtram: as opções da coluna LISTA escolhida pela administradora no ambiente (opcional) */
const colAbas = () => (estado.estrutura && estado.estrutura.colunaAbas ? colAtiva(estado.estrutura.colunaAbas) : null);
/* Resumo (chips): a coluna LISTA escolhida no ambiente; sem escolha, a primeira coluna de status */
const colResumo = () => (estado.estrutura && estado.estrutura.colunaResumo ? colAtiva(estado.estrutura.colunaResumo) : null) || colPorTipo("status") || null;
/* Uma opção removida da lista continua formando a sua aba enquanto tiver registros */
function abasDaPlanilha() {
  const area = colAbas();
  if (!area) return [];
  const usadas = new Set(estado.equipamentos.map((t) => (t.campos || {})[area.id]).filter(Boolean));
  return opcoesDe(area).filter((o) => o.ativa !== false || usadas.has(o.id)).map((o) => ({ id: o.id, nome: o.nome, cor: o.cor, removida: o.ativa === false ? o : null }));
}
function naAba(t) {
  const c = colAbas();
  return estado.vista.aba === "todos" || !c || (t.campos || {})[c.id] === estado.vista.aba;
}
/* Ordem congelada: a chave de ordenação de cada linha é lida uma vez (ao abrir a planilha ou escolher a ordem) e não muda
   quando um campo é preenchido; a planilha só reordena ao trocar de planilha, de ordem, de visão ou ao recarregar */
let ordemCongelada = { assinatura: "", chaves: new Map() };
function conferirOrdemCongelada() {
  const o = estado.vista.ordenar || {};
  const assinatura = `${estado.planilha}|${o.col || ""}|${o.dir || 1}|${verPorSistema() ? 1 : 0}`;
  if (ordemCongelada.assinatura !== assinatura) ordemCongelada = { assinatura, chaves: new Map() };
}
function chaveDeOrdem(t, tipo, calcular) {
  const k = `${tipo}|${t.id}`;
  if (!ordemCongelada.chaves.has(k)) ordemCongelada.chaves.set(k, calcular(t));
  return ordemCongelada.chaves.get(k);
}
function equipamentosFiltrados() {
  const vista = estado.vista;
  conferirOrdemCongelada();
  let l = estado.equipamentos.filter((t) => naAba(t) && passaEspecial(t, vista.especial));
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
      if (col.tipo === "mesAno") return mesAnoParaIso(v) || String(v);
      if (["data", "dataHora"].includes(col.tipo) || (col.tipo === "automatico" && /Em$/.test(col.auto))) return String(v);
      return normalizar(valorTexto(t, col));
    };
    l = l.map((t) => [chaveDeOrdem(t, "coluna", chave), t]).sort(([x], [y]) => {
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
      if (x == null) return 0;
      return (typeof x === "number" ? x - y : COMPARAR(String(x), String(y))) * dir;
    }).map(([, t]) => t);
  } else {
    /* Registros mais recentes primeiro; as linhas do arquivo (sem data de registro) mantêm a ordem da planilha */
    const criado = (t) => chaveDeOrdem(t, "criado", (x) => x.criadoEm || "");
    l = [...l].sort((a, b) => { const x = criado(b), y = criado(a); return x < y ? -1 : x > y ? 1 : 0; });
  }
  return l;
}
function montarLinhas() {
  const filtrados = equipamentosFiltrados();
  estado.filtrados = filtrados;
  const loc = localidadePorId(estado.planilha);
  if (porEstado(loc)) return verPorSistema() ? montarPorSistema(filtrados) : montarPorSecao(filtrados, loc);
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

/* ---------- Planilhas por estado: uma linha de grupo por seção (na ordem da planilha), ou "Ver por sistema" ---------- */
const listaPorPlanilha = (nome) => { const v = lerLocal(chavePessoa(nome), []); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; };
const marcarPorPlanilha = (nome, id, ligar) => gravarLocal(chavePessoa(nome), [...listaPorPlanilha(nome).filter((x) => x !== id), ...(ligar ? [id] : [])].slice(-200));
const verPorSistema = () => porEstado(localidadePorId(estado.planilha)) && listaPorPlanilha("ver-por-sistema").includes(estado.planilha);
const soPendencias = () => porEstado(localidadePorId(estado.planilha)) && listaPorPlanilha("so-pendencias").includes(estado.planilha);
/* Coluna de status da cadeia (a do resumo) e as opções que contam na faixa de cada seção */
const colStatus = () => colResumo() || colPorTipo("status");
const opcaoStatus = (t) => { const c = colStatus(); return c ? opcao(c, (t.campos || {})[c.id]) || null : null; };
/* "Não integrado" e as outras faixas cinza (Status final na cor cinza, ex.: "Sistema descontinuado"): a linha fica cinza
   e o 1º ciclo mostra só o nome do Status em maiúsculas (os valores continuam gravados) */
const faixaDaLinha = (t) => { const o = opcaoStatus(t); return o && (o.id === "nao-integrado" || nomeComparavel(o.nome) === "nao integrado" || (o.final && o.cor === "cinza")) ? o : null; };
const ehNaoIntegrado = (t) => !!faixaDaLinha(t);
const pendente = (t) => !finalizado(t);
const filtrandoAlgo = () => !!(normalizar(estado.busca).trim() || estado.vista.especial || estado.vista.aba !== "todos" || Object.values(estado.vista.filtros || {}).some((f) => f && ((f.valores && f.valores.length) || f.texto)));
const semOrdemEscolhida = () => !(estado.vista.ordenar && estado.vista.ordenar.col);
const ordenarPorSistema = (lista) => {
  const c = idChave();
  if (!c) return lista;
  const nome = (t) => chaveDeOrdem(t, "sistema", (x) => String((x.campos || {})[c] || ""));
  return [...lista].sort((a, b) => COMPARAR(nome(a), nome(b)));
};
function contagemStatus(lista) {
  const c = colStatus();
  if (!c) return [];
  const n = new Map();
  lista.forEach((t) => { const v = (t.campos || {})[c.id]; if (v) n.set(v, (n.get(v) || 0) + 1); });
  return opcoesDe(c).filter((o) => n.has(o.id)).map((o) => ({ o, n: n.get(o.id) }));
}
const chaveSecao = (loc, id) => `s:${loc}:${id}`;
function montarPorSecao(filtrados, loc) {
  const filtrando = filtrandoAlgo(), so = soPendencias();
  const porSecao = new Map(loc.secoes.map((s) => [s.id, []]));
  const soltas = [];
  filtrados.forEach((t) => { const lista = porSecao.get(t.secao || ""); if (lista) lista.push(t); else soltas.push(t); });
  const linhas = [];
  const bloco = (id, rotulo, lista, sigla = "") => {
    if (filtrando && !lista.length) return;
    if (so && lista.length && !lista.some(pendente)) return;
    if (so && !lista.length) return;
    const chave = chaveSecao(loc.id, id || "__sem");
    const fechado = estado.gruposFechados.has(chave);
    linhas.push({ tipo: "grupo", chave, rotulo, sigla, secao: id, n: lista.length, fechado, contagem: contagemStatus(lista), pendentes: lista.filter(pendente).length });
    if (!fechado) (semOrdemEscolhida() ? ordenarPorSistema(lista) : lista).forEach((t) => linhas.push({ tipo: "linha", t }));
  };
  loc.secoes.forEach((s) => bloco(s.id, s.nome, porSecao.get(s.id), s.sigla));
  if (soltas.length) bloco("", "Sem seção (confira)", soltas);
  return linhas;
}
/* "Ver por sistema": a mesma planilha agrupada pelo Sistema (ex.: todos os e-SAJ juntos), com a coluna Seção */
function montarPorSistema(filtrados) {
  const c = idChave(), loc = localidadePorId(estado.planilha);
  const grupos = new Map();
  filtrados.forEach((t) => {
    const nome = String((t.campos || {})[c] || "").trim() || "(sem sistema)";
    const k = nomeComparavel(nome);
    if (!grupos.has(k)) grupos.set(k, { nome, lista: [] });
    grupos.get(k).lista.push(t);
  });
  const ordemSecao = new Map(loc.secoes.map((s, i) => [s.id, i]));
  const linhas = [];
  [...grupos.entries()].sort((a, b) => COMPARAR(a[1].nome, b[1].nome)).forEach(([k, g]) => {
    const chave = `p:${loc.id}:${k}`;
    const fechado = estado.gruposFechados.has(chave);
    linhas.push({ tipo: "grupo", chave, rotulo: g.nome, n: g.lista.length, fechado, contagem: contagemStatus(g.lista), porSistema: true });
    const posSecao = (t) => chaveDeOrdem(t, "secao", (x) => ordemSecao.get(x.secao) ?? 999);
    if (!fechado) (semOrdemEscolhida() ? [...g.lista].sort((a, b) => posSecao(a) - posSecao(b)) : g.lista).forEach((t) => linhas.push({ tipo: "linha", t }));
  });
  return linhas;
}
/* Recolher/expandir todas as seções (ou os sistemas, em "Ver por sistema") */
function recolherTodas(recolher) {
  const grupos = montarLinhasSemFechar().filter((l) => l.tipo === "grupo").map((l) => l.chave);
  grupos.forEach((k) => { if (recolher) estado.gruposFechados.add(k); else estado.gruposFechados.delete(k); });
  renderizarTudo();
}
function montarLinhasSemFechar() {
  const fechados = estado.gruposFechados;
  estado.gruposFechados = new Set();
  try { return montarLinhas(); } finally { estado.gruposFechados = fechados; }
}
/* Rola a grade até a seção (abre a seção se estiver recolhida) */
function rolarParaSecao(id) {
  const loc = localidadePorId(estado.planilha);
  if (!porEstado(loc) || !secaoPorId(loc, id)) return false;
  const chave = chaveSecao(loc.id, id);
  if (verPorSistema()) { marcarPorPlanilha("ver-por-sistema", loc.id, false); }
  estado.gruposFechados.delete(chave);
  estado.secaoNova = id;
  renderizarTudo();
  const i = estado.linhas.findIndex((l) => l.tipo === "grupo" && l.chave === chave);
  const p = $("#planilha");
  if (i < 0 || !p) { mostrarAviso("Essa seção não aparece com os filtros atuais."); return false; }
  p.scrollTop = i * alturaLinha();
  pintarLinhas(true);
  const el = $(`.linha-grupo[data-chave="${CSS.escape("g:" + chave)}"]`, p);
  if (el) { el.classList.add("piscou"); setTimeout(() => el.classList.remove("piscou"), 2500); }
  return true;
}

/* ------------------------------------------------------------
 *  Resumo (clicável = filtra) e abas de categoria
 * ------------------------------------------------------------ */
/* Resumo da localidade: total, contagem pela coluna do resumo, linhas com problema e pedidos de exclusão */
function renderizarResumo() {
  const base = estado.equipamentos.filter(naAba);
  const esp = estado.vista.especial;
  const botao = (chave, conteudo, titulo) => `<button type="button" data-especial="${escapar(chave)}" aria-pressed="${esp === chave}" title="${escapar(titulo)}">${conteudo}</button>`;
  const partes = [botao("", `Total <strong>${base.length.toLocaleString("pt-BR")}</strong>`, "Todos os registros (tira o filtro do resumo)")];
  const st = colResumo();
  if (st) {
    partes.push('<span class="sep-resumo" aria-hidden="true"></span>');
    opcoesDe(st).forEach((o) => {
      const n = base.filter((t) => (t.campos || {})[st.id] === o.id).length;
      if (o.ativa === false && !n) return;
      partes.push(botao(`resumo:${o.id}`, `<span class="ponto-cor${o.cor ? " cor-" + o.cor : ""}"></span>${escapar(o.nome)}${marcaRemovida(o)} <strong>${n}</strong>`, `Filtrar ${st.nome}: ${o.nome}`));
    });
  }
  const comProblema = base.filter((t) => problemasPorId.has(t.id)).length;
  if (comProblema) partes.push(botao("problemas", `${svg("i-alerta")}Com problema <strong>${comProblema}</strong>`, "Obrigatório vazio, formato inválido ou valor repetido na coluna chave"));
  const pedidos = base.filter((t) => t.exclusao).length;
  if (ehAdmin() && pedidos) partes.push(botao("exclusao", `${svg("i-lixeira")}Exclusão solicitada <strong>${pedidos}</strong>`, "Pedidos de exclusão da Equipe N2"));
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
  abas.setAttribute("aria-label", cat.nome);
  const lista = [{ id: "todos", nome: "Todos", cor: "" }, ...abasDaPlanilha()];
  const contagem = new Map();
  estado.equipamentos.forEach((t) => { const v = (t.campos || {})[cat.id]; if (v) contagem.set(v, (contagem.get(v) || 0) + 1); });
  const contar = (id) => (id === "todos" ? estado.equipamentos.length : contagem.get(id) || 0);
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
  const cols = colunasDaGrade();
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
  calcularProblemas();
  estado.linhas = montarLinhas();
  $("#titulo-planilha").textContent = "Cadeias V6 / V12";
  renderizarResumo();
  renderizarAbas();
  renderizarVisoes();
  const agrupaveis = colunasAtivas().filter((c) => [...TIPOS_LISTA, "pessoa", "booleano"].includes(c.tipo) || (c.tipo === "automatico" && /Por$/.test(c.auto)));
  const locAberta = localidadePorId(estado.planilha);
  if (porEstado(locAberta)) {
    $("#agrupar").innerHTML = `<option value="">${verPorSistema() ? "Agrupada por sistema" : "Agrupada por seção"}</option>`;
    $("#agrupar").disabled = true;
    $("#agrupar").title = "Nas planilhas por estado, as linhas ficam nas seções (ou por sistema, em “Ver por sistema”)";
  } else {
    $("#agrupar").disabled = false;
    $("#agrupar").title = "Agrupar por";
    $("#agrupar").innerHTML = `<option value="">Sem agrupar</option>${agrupaveis.map((c) => `<option value="${escapar(c.id)}"${estado.vista.agrupar === c.id ? " selected" : ""}>Agrupar por ${escapar(c.nome)}</option>`).join("")}`;
  }
  $("#btn-densidade").setAttribute("aria-pressed", String(!!estado.vista.compacta));
  $("#btn-selecionar").setAttribute("aria-pressed", String(estado.selecionando));
  const n = estado.filtrados.length, total = estado.equipamentos.length;
  const filtrosAtivos = Object.values(estado.vista.filtros || {}).some((f) => f && ((f.valores && f.valores.length) || f.texto)) || estado.busca || estado.vista.especial;
  $("#contagem").textContent = `${n.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} ${total === 1 ? termo().um : termo().varios}${problemasPorId.size ? ` · ${problemasPorId.size} com atenção` : ""}`;
  $("#btn-limpar-filtros").disabled = !filtrosAtivos;
  const exporta = podeExportar();
  ["#btn-csv", "#btn-xlsx"].forEach((s) => { const b = $(s); if (b) b.hidden = !exporta; });
  renderizarSelecao();
  atualizarTamanho();
  areaDados.style.setProperty("--escala", String(escala()));
  renderizarPlanilha();
}

function renderizarPlanilha() {
  const cols = colunasDaGrade();
  let planilha = $("#planilha");
  const valoresNova = lerLinhaNova();
  if (!planilha) {
    areaDados.innerHTML = `<div class="planilha" id="planilha" role="grid" aria-label="Sistemas da planilha" tabindex="0">
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
  /* Cada grupo de colunas tem a sua cor de faixa (1º ciclo, 2º ciclo…), pela ordem dos grupos na estrutura */
  const ordemGrupos = [...estado.estrutura.gruposColunas].sort((a, b) => a.ordem - b.ordem).map((g) => g.id);
  const classeGrupo = (g) => ` g-${Math.min(6, Math.max(0, ordemGrupos.indexOf(g)))}`;
  $(".cab-grupos", planilha).innerHTML = faixas.map((f) => `<div class="cab-grupo${f.primeira ? " fixa" : ""}${classeGrupo(f.g)}" style="grid-column: span ${f.n}" title="${escapar(nomeGrupo(f.g))}">${escapar(nomeGrupo(f.g))}</div>`).join("") + `<div class="cab-grupo col-acoes"></div>`;
  const ord = estado.vista.ordenar || {};
  $(".cab", planilha).innerHTML = cols.map((c, i) => {
    const col = COL[c];
    const f = (estado.vista.filtros || {})[c];
    const ativo = f && ((f.valores && f.valores.length) || f.texto);
    const sort = ord.col === c ? (ord.dir > 0 ? "ascending" : "descending") : "none";
    const trava = !podeEditarColuna(col) && !TIPOS_SEM_EDICAO.includes(col.tipo) ? svg("i-cadeado", "icone cadeado") : "";
    return `<div class="cab-celula${i === 0 ? " fixa" : ""}${classeGrupo(col.grupo)}" role="columnheader" aria-sort="${sort}" data-col="${escapar(c)}" ${i === 0 ? "" : 'draggable="true"'} title="${escapar([col.ajuda || col.nome, textoTrava(col)].filter(Boolean).join(" · "))}">
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
  const t = termo(), pl = planilhaAtual();
  if (!estado.carregouEquipamentos) return `Carregando os ${t.varios}…`;
  if (estado.equipamentos.length) return `Nenhum ${t.um} com esses filtros.`;
  if (porEstado(localidadePorId(estado.planilha)) && !(localidadePorId(estado.planilha) || { secoes: [] }).secoes.length) return ehAdmin() ? "Esta planilha por estado ainda não tem seções. Use Administração › Planilhas e grupos › Editar › Seções." : "Esta planilha ainda não tem seções.";
  return podeAlimentar() ? `Nenhum sistema em ${pl.nome || "esta planilha"} ainda. Use “${t.novo}”, “Colar do Excel” ou a linha no fim da planilha.` : `Nenhum sistema em ${pl.nome || "esta planilha"} ainda.`;
}
function htmlAcoes(t) {
  return `<button type="button" class="acao-linha" data-acao="ficha" title="Ver ficha completa" aria-label="Ver ficha do ${escapar(termo().um)} ${escapar(t.numero || alvoRegistro(t))}">${svg("i-olho")}</button>
    <button type="button" class="acao-linha" data-acao="mais" title="Mais ações" aria-label="Mais ações">⋯</button>`;
}
/* Uma linha da grade (dados ou grupo). "par" faz a listra pelo índice: na rolagem, a ordem no DOM não segue a posição */
const chaveLinha = (l) => (l.tipo === "grupo" ? "g:" + l.chave : l.t.id);
function htmlLinha(i, l, cols, h) {
    if (l.tipo === "grupo") {
    if (l.secao != null || l.porSistema) {
      const selos = (l.contagem || []).map(({ o, n }) => `<span class="etq etq-mini${o.cor ? ` cor-${o.cor}` : ""}" title="${escapar(`${o.nome}: ${n}`)}">${escapar(o.nome)} <strong>${n}</strong></span>`).join("");
      const novo = l.secao && podeAlimentar() ? `<button type="button" class="btn-secao" data-secao-acao="novo" data-secao="${escapar(l.secao)}" title="Incluir um sistema em ${escapar(l.rotulo)}">${svg("i-mais")}<span>sistema nesta seção</span></button>` : "";
      return `<div class="linha-grupo linha-secao${l.fechado ? " fechado" : ""}${l.porSistema ? " por-sistema" : ""}" style="top:${i * h}px" data-i="${i}" data-chave="${escapar(chaveLinha(l))}" data-grupo="${escapar(l.chave)}" role="row" aria-expanded="${!l.fechado}" aria-label="${escapar(`${l.rotulo}: ${l.n} sistema(s)`)}"><span class="rot">${svg("i-chevron-baixo")}<span class="nome-secao">${escapar(l.rotulo)}</span> <span class="selo">${l.n}</span>${l.pendentes ? `<span class="selo selo-pendente" title="Linhas sem status final (Instalado ou Não integrado)">${l.pendentes} pendente(s)</span>` : ""}<span class="selos-secao">${selos}</span>${novo}</span></div>`;
    }
    return `<div class="linha-grupo${l.fechado ? " fechado" : ""}" style="top:${i * h}px" data-i="${i}" data-chave="${escapar(chaveLinha(l))}" data-grupo="${escapar(l.chave)}" role="row" aria-expanded="${!l.fechado}"><span class="rot">${svg("i-chevron-baixo")}${escapar(l.rotulo || l.chave)}${marcaRemovida(l.removida)} <span class="selo">${l.n}</span></span></div>`;
    }
    const t = l.t;
    const editavel = podeEditarLinha(t);
    const sel = estado.selecionados.has(t.id);
  const iv = estado.intervalo && estado.intervalo.set.has(t.id) ? estado.intervalo.col : null;
  /* Regras de cor e cor das opções na célula inteira (classes calculadas uma vez por linha) */
  const ap = aparencia ? aparencia.daLinha(t) : SEM_APARENCIA;
  const probs = problemasPorId.get(t.id);
  const textoProbs = probs ? `Atenção: ${probs.join(" · ")}` : "";
  /* "NÃO INTEGRADO": as células dos ciclos ficam vazias (os valores continuam gravados) e o texto atravessa o 1º ciclo */
  const ni = ehNaoIntegrado(t) ? faixaNaoIntegrado(cols) : null;
  return `<div class="linha${i % 2 ? " par" : ""}${piscando(t.id) ? " piscou" : ""}${sel ? " selecionada" : ""}${t.exclusao ? " pedido-exclusao" : ""}${probs ? " com-problema" : ""}${ni ? " nao-integrado" : ""}${ap.l}" style="top:${i * h}px" role="row" aria-rowindex="${i + 2}" data-i="${i}" data-chave="${escapar(t.id)}" data-id="${escapar(t.id)}">` +
      (ni ? `<span class="faixa-nao-integrado" style="left:${ni.left}px;width:${ni.width}px;--fixa:${ni.fixa}px" aria-hidden="true"><span>${escapar(String((faixaDaLinha(t) || { nome: "Não integrado" }).nome).toUpperCase())}</span></span>` : "") +
      cols.map((c, j) => {
        const col = COL[c];
        const escondida = ni && ni.cols.has(c);
        const travada = !editavel || !podeEditarColuna(col);
        const extra = j === 0 ? `${estado.selecionando ? `<input type="checkbox" class="sel-linha" data-sel="${escapar(t.id)}"${sel ? " checked" : ""} aria-label="Selecionar linha">` : ""}${t.exclusao ? '<span class="selo-exclusao" title="Exclusão solicitada">Exclusão solicitada</span>' : ""}${probs ? `<span class="selo-problema" title="${escapar(textoProbs)}" aria-label="${escapar(textoProbs)}">!</span>` : ""}` : "";
      /* Célula sem permissão: o motivo fica no title (um clique só seleciona, sem aviso a cada clique) */
      const titulo = [tituloCelula(t, col).slice(0, 300), travada ? motivoSemEdicao(t, col) : ""].filter(Boolean).join(" · ");
      return `<div class="celula${j === 0 ? " fixa" : ""}${travada ? " travada" : ""}${iv === c ? " no-intervalo" : ""}${escondida ? " sob-nao-integrado" : ""}${ap.c[c] || ""}" role="gridcell" tabindex="-1" data-col="${escapar(c)}" title="${escapar(escondida ? `${String((faixaDaLinha(t) || { nome: "Não integrado" }).nome).toUpperCase()}${tituloCelula(t, col) ? ` · valor guardado: ${tituloCelula(t, col).slice(0, 200)}` : ""}` : titulo)}">${extra}${escondida ? "" : htmlValor(t, col)}</div>`;
      }).join("") +
      `<div class="celula col-acoes">${htmlAcoes(t)}</div></div>`;
  }
/* Onde fica o "NÃO INTEGRADO": células escondidas (as dos grupos de colunas depois da 1ª coluna) e a faixa por cima
   das colunas seguidas do grupo do Status (o 1º ciclo), nas larguras atuais da grade */
function faixaNaoIntegrado(cols) {
  const st = colStatus(), base = COL[cols[0]];
  if (!st || !base) return null;
  const esconder = new Set(cols.slice(1).filter((c) => COL[c].grupo !== base.grupo && c !== COL_SECAO));
  const larg = (c) => (estado.largurasEfetivas && estado.largurasEfetivas[c]) || emEscala(largura(c));
  let x = 0, left = -1, width = 0;
  for (const c of cols) {
    const w = larg(c);
    if (COL[c].grupo === st.grupo && c !== COL_SECAO) { if (left < 0) left = x; if (left >= 0 && x === left + width) width += w; }
    else if (left >= 0 && width) break;
    x += w;
  }
  if (left < 0 || !width) return null;
  return { cols: esconder, left, width, fixa: larg(cols[0]) };
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
  const cols = colunasDaGrade();
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
  /* Seletor de mês (AAAA-MM); validarValor() converte para MM/AAAA */
  if (col.tipo === "mesAno") return `<input type="month" ${atributos} value="${escapar(mesAnoParaIso(valor))}" min="2000-01" max="2099-12" placeholder="MM/AAAA">`;
  if (col.tipo === "numero") return `<input inputmode="decimal" ${atributos} value="${escapar(valor ?? "")}">`;
  if (col.tipo === "etiquetas") return `<input ${atributos} value="${escapar(Array.isArray(valor) ? valor.map((x) => (opcao(col, x) || { nome: x }).nome).join(", ") : valor || "")}" placeholder="${escapar(opcoesAtivas(col).slice(0, 3).map((o) => o.nome).join(", "))}…">`;
  const formato = col.formato === "telefone" ? ' data-formato="telefone" inputmode="tel"' : col.formato === "email" ? ' type="email" inputmode="email"' : "";
  return `<input ${atributos} value="${escapar(valor || "")}" maxlength="${LIMITES[col.tipo] || 300}"${col.tipo === "link" ? ' type="url" placeholder="https://"' : ""}${formato}>`;
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
  /* id e aria-describedby vão para o campo visível (o <label for> e a ajuda apontam para ele) */
  const idTexto = (/\sid="([^"]*)"/.exec(" " + atributos) || [])[1];
  const descricao = (/aria-describedby="([^"]*)"/.exec(atributos) || [])[1];
  return `<div class="combo" data-combo-col="${escapar(col.id)}"><input type="hidden" ${(" " + atributos).replace(/\s(aria-label|placeholder|id|aria-describedby)="[^"]*"/g, "").trim()} value="${escapar(valor || "")}" data-original="${escapar(valor || "")}">`
    + `<input type="text" class="combo-texto${fora ? " fora" : ""}" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" spellcheck="false"${rotulo ? ` aria-label="${rotulo}"` : ""}${idTexto ? ` id="${idTexto}"` : ""}${descricao ? ` aria-describedby="${descricao}"` : ""}`
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
    /* Na célula, o Enter escolhe E salva (segue para o editor); nos formulários, só escolhe (Ctrl+Enter escolhe e registra) */
    e.preventDefault();
    if (!t.closest(".editor-celula") && !(e.ctrlKey || e.metaKey)) e.stopPropagation();
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
  /* Nas planilhas por estado, o sistema novo entra pela faixa da seção ("+ sistema nesta seção") */
  caixa.hidden = !podeAlimentar() || porEstado(localidadePorId(estado.planilha));
  if (caixa.hidden) return;
  const focado = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.nova : null;
  caixa.innerHTML = cols.map((c, j) => {
    const col = COL[c];
    const v = valores[c] != null ? valores[c] : "";
    const conteudo = podeNaLinhaNova(col)
      ? campoEntrada(col, v, `data-nova="${escapar(c)}" aria-label="${escapar(termo().novo)}: ${escapar(col.nome)}${col.obrigatoria ? " (obrigatório)" : ""}" placeholder="${escapar(j === 0 ? "+ " + col.nome : col.nome)}"`)
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
    const secaoAcao = e.target.closest("[data-secao-acao]");
    if (secaoAcao) { adicionarSistemaNaSecao(secaoAcao.dataset.secao); return; }
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
    const cols = colunasDaGrade();
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
/* Colunas da grade na ordem da pessoa; a coluna "Seção" só aparece em "Ver por sistema" */
const colunasDaGrade = () => (estado.vista ? estado.vista.colunas.filter((c) => COL[c] && (c !== COL_SECAO || verPorSistema())) : []);
const colunasVisiveis = colunasDaGrade;
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
  } else if (!["date", "datetime-local", "month"].includes(campo.type)) {
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
        const e = conferirRegistro({ ...(t.campos || {}), [col.id]: r.valor }, t.id, t.secao)[col.id];
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
const chaveUnicaRascunho = (c, v) => (c.id === idChave() || ehColunaIndice(c) ? chaveNumero(v) : normalizar(v));
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
        ${htmlEscolhaSecao("Seção das linhas novas")}
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
  estado.equipamentos.forEach((t) => {
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
/* Rodapé de toda exportação: data e hora de Brasília e quem exportou */
const rodapeExportacao = () => `Exportado em ${formatarData(new Date(), true)} (Brasília) por ${estado.usuario ? `${estado.usuario.nome} (${estado.usuario.email})` : ""}`;
const nomeArquivoExportacao = (ext) => { const p = partesBrasilia(); return `cadeias-${planilhaAtual().ambiente}-${slug(planilhaAtual().nome || planilhaAtual().id, 50)}-${p.ano}-${p.mes}-${p.dia}.${ext}`; };
/* Tabela exportada: as colunas visíveis e as linhas filtradas (busca, filtros, aba e resumo) */
function tabelaExportacao() {
  const cols = colunasExportaveis();
  return { cols, registros: equipamentosFiltrados(), cabecalho: cols.map((c) => COL[c].nome) };
}
function conferirExportacao() {
  if (podeExportar()) return true;
  mostrarAviso("A exportação está desligada pelas administradoras.");
  return false;
}
$("#btn-csv").addEventListener("click", () => {
  if (!conferirExportacao()) return;
  const { cols, registros, cabecalho } = tabelaExportacao();
  const linhas = [cabecalho.map(csvCampo).join(";"), ...registros.map((t) => cols.map((c) => csvCampo(valorTexto(t, COL[c]))).join(";")), "", csvCampo(rodapeExportacao())];
  baixarArquivo(nomeArquivoExportacao("csv"), "\ufeff" + linhas.join("\r\n"), "text/csv;charset=utf-8");
  registrarAuditoria("exportar", `Exportou CSV: ${registros.length} linha(s) de ${nomeCompletoPlanilha(planilhaAtual())}`);
  mostrarAviso(`CSV com ${registros.length} ${registros.length === 1 ? termo().um : termo().varios} baixado.`);
});
$("#btn-csv").insertAdjacentHTML("afterend", `<button type="button" class="btn-icone so-largo" id="btn-xlsx" title="Exportar Excel (XLSX, linhas filtradas)" aria-label="Exportar Excel (XLSX)">${svg("i-tabela")}</button>`);
$("#btn-xlsx").addEventListener("click", () => {
  if (!conferirExportacao()) return;
  const { cols, registros, cabecalho } = tabelaExportacao();
  const blob = gerarXlsx([cabecalho, ...registros.map((t) => cols.map((c) => { const col = COL[c], v = valorBruto(t, col); return col.tipo === "numero" && typeof v === "number" ? v : valorTexto(t, col); })), [], [rodapeExportacao()]], planilhaAtual().curto);
  baixarBlob(nomeArquivoExportacao("xlsx"), blob);
  registrarAuditoria("exportar", `Exportou XLSX: ${registros.length} linha(s) de ${nomeCompletoPlanilha(planilhaAtual())}`);
  mostrarAviso(`Excel com ${registros.length} ${registros.length === 1 ? termo().um : termo().varios} baixado.`);
});
$("#btn-imprimir").title = "Imprimir ou salvar em PDF (linhas filtradas)";
$("#btn-imprimir").setAttribute("aria-label", "Imprimir ou salvar em PDF");
$("#btn-imprimir").addEventListener("click", () => {
  const { cols, registros } = tabelaExportacao();
  imprimirTabela(`${estado.estrutura.titulo} · ${formatarData(new Date(), true)}`, cols.map((c) => COL[c].nome), registros.map((t) => cols.map((c) => valorTexto(t, COL[c]))));
  registrarAuditoria("exportar", `Imprimiu/PDF: ${registros.length} linha(s) de ${nomeCompletoPlanilha(planilhaAtual())}`);
});
/* Impressão (o "Salvar como PDF" do navegador) com o rodapé de quem exportou */
function imprimirTabela(titulo, cabecalho, linhas) {
  $("#tabela-impressao").innerHTML = `<h1 style="font-size:14pt;margin-bottom:6px">${escapar(titulo)}</h1><table><thead><tr>${cabecalho.map((c) => `<th>${escapar(c)}</th>`).join("")}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${l.map((v) => `<td>${escapar(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>
    <p class="rodape-impressao">${escapar(rodapeExportacao())} · ${linhas.length} linha(s)</p>`;
  window.print();
}
function baixarBlob(nome, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
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
  if (/permission-denied/.test(codigo)) return contexto === "numero" ? `Não foi possível salvar: esse valor de ${colNumero() ? colNumero().nome : "coluna chave"} já está em outro registro desta planilha, ou você não tem permissão.` : "Você não tem permissão para esta mudança.";
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
/* Monta as escritas de uma mudança de campos (com o índice da coluna chave e o histórico) */
function opsAlteracao(t, mudancas, acao = "editar") {
  if (t.arquivo) return opsTirarDoArquivo(t, mudancas, acao);
  const indices = indicesMudanca(t.id, t.campos, { ...(t.campos || {}), ...mudancas }, t.secao);
  const dados = { campos: { ...mudancas }, ...indices.dados, ...assinatura() };
  const ops = [{ op: "set", caminho: `${P()}/${t.id}`, mesclar: true, dados }, ...indices.ops];
  Object.entries(mudancas).forEach(([c, v]) => {
    const col = COL[c];
    if (!col) return;
    ops.push(opHistorico(t.id, acao, { coluna: c, colunaNome: col.nome, antes: textoDoValor(col, (t.campos || {})[c]), depois: textoDoValor(col, v) }));
  });
  return ops;
}
/* Linha do arquivo editada: cria registros/{mesmo id} com "parcial: true" e SÓ os campos alterados, que valem por cima
   da linha do arquivo (vazio é gravado como ""). Assim ninguém regrava as colunas que não pode alterar. */
function opsTirarDoArquivo(t, mudancas, acao) {
  const campos = Object.fromEntries(Object.entries(mudancas).map(([c, v]) => [c, v == null ? "" : v]));
  /* Só a administradora muda a coluna chave de uma linha do arquivo ("travado após criar"): aí o índice muda junto */
  const indices = indicesMudanca(t.id, t.campos, { ...(t.campos || {}), ...campos }, t.secao);
  const chaves = Object.fromEntries(INDICES.map((ix) => [ix.campo, ix.campo in indices.dados ? indices.dados[ix.campo] : ""]));
  const ops = [{ op: "set", caminho: `${P()}/${t.id}`, dados: { campos, ...chaves, parcial: true, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura(), exclusao: null } }, ...indices.ops];
  Object.entries(mudancas).forEach(([c, v]) => {
    const col = COL[c];
    if (!col) return;
    ops.push(opHistorico(t.id, acao, { coluna: c, colunaNome: col.nome, antes: textoDoValor(col, (t.campos || {})[c]), depois: textoDoValor(col, v) }));
  });
  return ops;
}
async function salvarCampos(t, mudancas, { semDesfazer = false } = {}) {
  const mudou = Object.fromEntries(Object.entries(mudancas).filter(([c, v]) => JSON.stringify((t.campos || {})[c] ?? vazioDe(COL[c])) !== JSON.stringify(v ?? vazioDe(COL[c]))));
  const reais = mudou;
  if (!Object.keys(reais).length) return true;
  const antes = Object.fromEntries(Object.keys(reais).map((c) => [c, (t.campos || {})[c] ?? vazioDe(COL[c])]));
  const ok = await gravar(opsAlteracao(t, reais), {
    rotulo: "Edição desfeita",
    contexto: INDICES.some((ix) => ix.col in reais) ? "numero" : "",
    desfazer: semDesfazer ? null : async () => { const atual = porId(t.id); if (atual) return salvarCampos(atual, antes, { semDesfazer: true }); }
  });
  if (ok) {
    const mudancas = Object.keys(reais).filter((c) => COL[c]).map((c) => ({ coluna: COL[c].nome, antes: textoDoValor(COL[c], antes[c]), depois: textoDoValor(COL[c], reais[c]) }));
    registrarAuditoria("editar", `${semDesfazer ? "Desfez a edição de" : "Editou"} ${alvoRegistro(t)} (${mudancas.map((m) => m.coluna).join(", ")})`, "", { alvo: alvoRegistro(t), mudancas });
  }
  return ok;
}
const salvarCelula = (t, col, valor) => salvarCampos(t, { [col.id]: valor });

/* Só as colunas que a pessoa pode preencher entram no registro (as regras recusam o resto) */
function filtrarCamposPermitidos(campos) {
  const permitidas = new Set(colunasAtivas().filter((c) => podeNaLinhaNova(c)).map((c) => c.id));
  return Object.fromEntries(Object.entries(campos).filter(([c, v]) => permitidas.has(c) && !estaVazio(v)));
}
function resumoRegistro(campos) {
  return alvoRegistro(null, campos);
}
/* Escritas de um registro novo: registro (com a chave do índice), índice da coluna chave e histórico */
/* "secao": a seção da planilha por estado (vazio no modo por sistema) */
function opsNovoRegistro(id, campos, acao = "criar", secao = secaoParaNovo()) {
  const indices = indicesMudanca(id, {}, campos, secao);
  const chaves = Object.fromEntries(INDICES.map((ix) => [ix.campo, indices.dados[ix.campo] || ""]));
  return [
    { op: "set", caminho: `${P()}/${id}`, dados: { campos, ...chaves, ...(secao ? { secao } : {}), ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura(), exclusao: null } },
    ...indices.ops,
    opHistorico(id, acao, { depois: resumoRegistro(campos) })
  ];
}
/* Escritas de um registro novo (linha nova, formulário e preenchimento em massa usam o mesmo caminho) */
function opsCriarRegistro(camposBrutos, secao = secaoParaNovo()) {
  const campos = filtrarCamposPermitidos(camposBrutos);
  const id = estado.api.novoId(P());
  return { id, campos, secao, ops: opsNovoRegistro(id, campos, "criar", secao) };
}
async function criarRegistro(camposBrutos, { semDesfazer = false, secao = secaoParaNovo() } = {}) {
  const { id, campos, ops } = opsCriarRegistro(camposBrutos, secao);
  const ok = await gravar(ops, {
    rotulo: "Registro removido",
    contexto: "numero",
    desfazer: semDesfazer || !ehAdmin() ? null : async () => excluirDeVez([{ id, campos, secao, numero: numeroDe(campos, secao) }], "Desfez a criação")
  });
  if (ok) {
    document.dispatchEvent(new CustomEvent("planilha:salvou", { detail: { n: 1 } }));
    registrarAuditoria("criar", `Registrou ${alvoRegistro(null, campos) || `um ${termo().um}`}`, "", {
      alvo: alvoRegistro(null, campos), mudancas: Object.keys(campos).filter((c) => COL[c]).map((c) => ({ coluna: COL[c].nome, antes: "", depois: textoDoValor(COL[c], campos[c]) }))
    });
  }
  return ok ? id : null;
}
/* Desfazer um preenchimento em massa: apaga só os registros que ninguém alterou depois (excluir de vez é das administradoras) */
function desfazerCriacaoEmMassa(ids) {
  if (!ehAdmin()) return null;
  return async () => {
    const intactos = ids.map(porId).filter((t) => t && !t.arquivo && String(t.atualizadoEm) === String(t.criadoEm));
    if (intactos.length) await excluirDeVez(intactos.map((t) => ({ id: t.id, campos: t.campos, secao: t.secao, numero: numeroDe(t.campos, t.secao) })), "Desfez o preenchimento em massa");
    if (intactos.length < ids.length) mostrarAviso(`${ids.length - intactos.length} registro(s) foram alterados depois e ficaram.`, 5000);
  };
}
/* Monta o registro completo: valores informados + padrões + a opção da aba atual (coluna das abas) */
function completarCampos(informados) {
  const campos = {};
  colunasAtivas().forEach((c) => {
    if (!podeNaLinhaNova(c)) return;
    if (c.id in informados && !estaVazio(informados[c.id])) campos[c.id] = informados[c.id];
    else if (estado.vista.aba !== "todos" && colAbas() && c.id === colAbas().id && !opcaoRemovida(colAbas(), estado.vista.aba)) campos[c.id] = estado.vista.aba;
    else { const p = valorPadrao(c); if (!estaVazio(p)) campos[c.id] = p; }
  });
  return campos;
}
async function avisarRepetido(erro) {
  if (await confirmar(erro.texto, { titulo: "Valor repetido", botao: "Abrir" })) abrirFicha(erro.id);
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
    } else if (!["date", "datetime-local", "month"].includes(foco.type)) {
      foco.value = texto;
      if (ehCombo) foco.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  if (foco.tagName !== "SELECT" && !["date", "datetime-local", "month"].includes(foco.type) && foco.setSelectionRange) {
    const fim = foco.value.length;
    try { foco.setSelectionRange(fim, fim); } catch { /* tipos sem cursor */ }
    foco.scrollLeft = foco.scrollWidth;
  }
  if (viaClique && ["date", "datetime-local", "month"].includes(foco.type) && foco.showPicker) { try { foco.showPicker(); } catch { /* sem gesto */ } }
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
        const e = conferirRegistro({ ...(t.campos || {}), [c]: r.valor }, t.id, t.secao)[c];
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
/* Ordem do FORMULÁRIO (Novo registro e ficha), independente da grade: "ordemFormulario" da coluna.
   Sem ela, vale a ordem da grade, com os textos longos sempre no fim. */
function ordenarParaFormulario(naOrdemDaGrade) {
  const pos = new Map(naOrdemDaGrade.map((c, i) => [c.id, i]));
  const chave = (c) => (c.ordemFormulario > 0 ? c.ordemFormulario : 1000 + (c.tipo === "textoLongo" ? 1000 : 0) + pos.get(c.id));
  return [...naOrdemDaGrade].sort((a, b) => chave(a) - chave(b));
}
const colunasDoFormulario = (filtro) => ordenarParaFormulario(colunasAtivas().filter(filtro));
/* Ordem padrão do formulário (botão "Restaurar padrão" em Estrutura › Ordem no formulário): a coluna chave primeiro */
function ordemFormularioPadrao(naOrdemDaGrade) {
  const fixas = [idChave()].map((id) => naOrdemDaGrade.find((c) => c.id === id)).filter(Boolean);
  const resto = naOrdemDaGrade.filter((c) => !fixas.includes(c));
  const longos = (c) => c.tipo === "textoLongo";
  const ordem = [...fixas.filter((c) => !longos(c)), ...resto.filter((c) => !longos(c)), ...fixas.filter(longos), ...resto.filter(longos)];
  return ordem;
}
const EXEMPLOS_FORMULARIO = {};
const TEXTO_CONFIRA_TRAVADO = "Confira antes de registrar: depois, só a Lays ou a Paula alteram.";
/* Um campo do formulário: rótulo colado, ajuda no "i" (title + aria-describedby), erro e aviso de repetido logo abaixo */
function campoFormulario(c, valores) {
  const id = `f-${c.id}`;
  const largo = ["textoLongo", "etiquetas"].includes(c.tipo) || c.id === "resumo";
  const trava = c.somenteAdmin ? TEXTO_BLOQUEADO : c.acesso === "travado" && !ehAdmin() ? TEXTO_CONFIRA_TRAVADO : "";
  const ajuda = [c.ajuda, trava].filter(Boolean).join(" ");
  const idAjuda = `ajuda-${id}`, idErro = `erro-${id}`;
  const atributos = `name="${escapar(c.id)}" id="${escapar(id)}" aria-describedby="${escapar(ajuda ? `${idAjuda} ${idErro}` : idErro)}"`
    + (EXEMPLOS_FORMULARIO[c.id] ? ` placeholder="${escapar(EXEMPLOS_FORMULARIO[c.id])}"` : "")
    + "";
  const v = valores[c.id];
  let entrada;
  if (c.tipo === "textoLongo") entrada = `<textarea ${atributos} maxlength="${LIMITES.textoLongo}" rows="2" data-crescer>${escapar(v || "")}</textarea>`;
  else if (c.tipo === "etiquetas") entrada = `<div class="etiquetas-form" role="group" aria-labelledby="rot-${escapar(id)}">${opcoesParaEscolha(c, v).map((o) => `<label class="check"${o.ativa === false ? ` title="${escapar(textoRemovida(o))}"` : ""}><input type="checkbox" name="${escapar(c.id)}" value="${escapar(o.id)}"${(v || []).includes(o.id) ? " checked" : ""}> ${escapar(rotuloEscolha(o))}</label>`).join("")}</div>`;
  else if (["status", "prioridade"].includes(c.tipo)) entrada = comboLista(c, v, atributos);
  else if (c.tipo === "dataHora") entrada = `<div class="com-botao">${campoEntrada(c, v, atributos)}<button type="button" class="btn btn-secundario btn-mini" data-agora="${escapar(c.id)}" title="Preencher com a data e a hora de agora (Brasília)">Agora</button></div>`;
  else entrada = campoEntrada(c, v, atributos);
  const icones = (c.ajuda ? `<span class="info-campo" title="${escapar(c.ajuda)}" aria-hidden="true">${svg("i-info")}</span>` : "")
    + (trava ? `<span class="info-campo" title="${escapar(trava)}" aria-hidden="true">${svg("i-cadeado", "icone cadeado")}</span>` : "");
  return `<div class="campo campo-form${largo ? " largo" : ""}${c.tipo === "dataHora" ? " campo-data-hora" : ""}" data-campo="${escapar(c.id)}">`
    + `<span class="rotulo" id="rot-${escapar(id)}">${c.tipo === "etiquetas" ? escapar(c.nome) : `<label for="${escapar(id)}">${escapar(c.nome)}</label>`}${c.obrigatoria ? ' <span class="obrig">*</span>' : ""}${icones}</span>`
    + (ajuda ? `<span class="sr-only" id="${escapar(idAjuda)}">${escapar(ajuda)}</span>` : "")
    + `${entrada}<span class="erro-campo" id="${escapar(idErro)}"></span>`
    + (INDICES.some((ix) => ix.col === c.id) ? `<div class="aviso-campo" data-aviso-de="${escapar(c.id)}"></div>` : "")
    + `</div>`;
}
/* Formulário em grade (3 colunas no diálogo, 1–2 na ficha). Com um só grupo, sem moldura nem legenda. */
function htmlCamposFormulario(valores, filtro) {
  const cols = colunasDoFormulario(filtro);
  const grupos = [...estado.estrutura.gruposColunas].sort((a, b) => a.ordem - b.ordem).filter((g) => cols.some((c) => c.grupo === g.id));
  if (grupos.length <= 1) return `<div class="grade-campos">${cols.map((c) => campoFormulario(c, valores)).join("")}</div>`;
  return grupos.map((g) => `<fieldset class="grade-campos"><legend>${escapar(g.nome)}</legend>${cols.filter((c) => c.grupo === g.id).map((c) => campoFormulario(c, valores)).join("")}</fieldset>`).join("");
}
/* Comportamentos dos campos do formulário (diálogo e ficha): maiúsculas (quando pedido), texto que cresce, botão "Agora" */
function crescerTexto(el) {
  const cs = getComputedStyle(el);
  const bordas = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const maximo = (parseFloat(cs.lineHeight) || 21) * 5 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + bordas;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight + bordas, maximo) + "px";
}
function ligarCamposFormulario(raiz) {
  raiz.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.matches) return;
    if (el.matches("[data-maiusculas]")) {
      const v = el.value.toUpperCase();
      if (v !== el.value) { const a = el.selectionStart, b = el.selectionEnd; el.value = v; try { el.setSelectionRange(a, b); } catch { /* sem cursor */ } }
    }
    if (el.matches("textarea[data-crescer]")) crescerTexto(el);
  }, true);
  raiz.addEventListener("click", (e) => {
    const b = e.target.closest("[data-agora]");
    if (!b) return;
    const el = raiz.querySelector(`[name="${CSS.escape(b.dataset.agora)}"]`);
    if (!el) return;
    const p = partesBrasilia();
    el.value = el.type === "datetime-local" ? `${p.ano}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}` : `${p.dia}/${p.mes}/${p.ano} ${p.hora}:${p.minuto}`;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.focus();
  });
}
function prepararCamposFormulario(raiz) { $$("textarea[data-crescer]", raiz).forEach(crescerTexto); }
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
/* Borda vermelha e mensagem curta embaixo de cada campo com erro; devolve as mensagens sem campo no formulário */
function marcarErros(form, erros) {
  $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
  $$(".erro-campo", form).forEach((x) => { x.textContent = ""; });
  const soltas = [];
  Object.entries(erros).forEach(([c, msg]) => {
    let el = form.elements[c];
    if (el && el.type === "hidden" && el.closest(".combo")) el = el.closest(".combo").querySelector(".combo-texto");
    if (el && el.setAttribute) el.setAttribute("aria-invalid", "true");
    const caixa = $(`.campo[data-campo="${CSS.escape(c)}"] .erro-campo`, form);
    if (caixa) caixa.textContent = msg || "";
    else if (msg) soltas.push(msg);
  });
  return soltas;
}
const focarPrimeiroErro = (form) => { const el = $('[aria-invalid="true"]', form); if (el) el.focus(); };
/* Aviso de LGPD curto: "Entendi" esconde por 30 dias neste navegador (no importar/colar ele continua) */
const CHAVE_LGPD_NOVO = "cadeias-lgpd-novo-entendido-ate";
/* Lembradas por pessoa para o próximo cadastro: as colunas LISTA. "Registrar e adicionar outro" limpa as outras. */
const COLUNAS_SUGERIDAS = { filter: (f) => colunasAtivas().filter((c) => TIPOS_LISTA.includes(c.tipo)).map((c) => c.id).filter(f) };
const COLUNAS_DO_EQUIPAMENTO = { forEach: (f) => colunasAtivas().filter((c) => !TIPOS_LISTA.includes(c.tipo) && !TIPOS_SEM_EDICAO.includes(c.tipo)).map((c) => c.id).forEach(f) };
function sugestoesNovo() {
  const salvas = lerLocal(chaveUsuario("sugestoes-novo"), null);
  const valido = (c, v) => COL[c] && !estaVazio(v) && (!TIPOS_LISTA.includes(COL[c].tipo) || [].concat(v).every((x) => opcao(COL[c], x) && opcao(COL[c], x).ativa !== false));
  if (salvas && typeof salvas === "object") return Object.fromEntries(COLUNAS_SUGERIDAS.filter((c) => valido(c, salvas[c])).map((c) => [c, salvas[c]]));
  return {};
}
/* Planilha por estado: em qual seção entram as linhas novas (formulários, colar e preencher em massa) */
function htmlEscolhaSecao(rotulo = "Seção") {
  const l = localidadePorId(estado.planilha);
  if (!porEstado(l) || !l.secoes.length) return "";
  const atual = secaoParaNovo();
  return `<label class="campo campo-secao"><span class="rotulo">${escapar(rotulo)} *</span><select name="secaoNova" data-secao-nova>${l.secoes.map((s) => `<option value="${escapar(s.id)}"${s.id === atual ? " selected" : ""}>${escapar(s.nome)}</option>`).join("")}</select></label>`;
}
document.addEventListener("change", (e) => { if (e.target.matches && e.target.matches("[data-secao-nova]")) estado.secaoNova = e.target.value; }, true);
/* "+ sistema nesta seção": o nome do sistema; os outros campos se preenchem direto na grade */
function adicionarSistemaNaSecao(secao) {
  const l = localidadePorId(estado.planilha), s = secaoPorId(l, secao), col = colNumero();
  if (!s) return;
  if (!podeAlimentar()) { mostrarAviso(conectado() ? "Seu acesso é só de leitura." : "Sem conexão: a edição está bloqueada."); return; }
  if (!col) { estado.secaoNova = secao; abrirNovoRegistro(); return; }
  estado.secaoNova = secao;
  const padrao = l.sistemasPadrao.filter((n) => !estado.equipamentos.some((t) => t.secao === secao && nomeComparavel((t.campos || {})[col.id]) === nomeComparavel(n)));
  const d = criarDialogo({ titulo: `Novo sistema em ${s.nome}`, corpo: `
    <label class="campo"><span class="rotulo">${escapar(col.nome)} *</span><input name="sistema" maxlength="300" autocomplete="off" list="sistemas-sugeridos" placeholder="Ex.: ${escapar((l.sistemasPadrao[0] || "PJe"))}"></label>
    <datalist id="sistemas-sugeridos">${[...new Set([...padrao, ...estado.equipamentos.map((t) => String((t.campos || {})[col.id] || "").trim()).filter(Boolean)])].slice(0, 80).map((n) => `<option value="${escapar(n)}"></option>`).join("")}</datalist>
    ${padrao.length ? `<p class="apoio" style="font-size:12px">Sistemas padrão que faltam nesta seção: ${escapar(padrao.join(", "))}.</p>` : ""}
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-mais")}Incluir</button></div>` });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = form.querySelector(".form-erro");
    const r = validarValor(col, form.sistema.value);
    if (!r.ok || estaVazio(r.valor)) { erro.textContent = r.ok ? `Escreva o ${col.nome.toLowerCase()}.` : r.erro; form.sistema.focus(); return; }
    const campos = completarCampos({ [col.id]: r.valor });
    const conf = conferirRegistro(campos, undefined, secao)[col.id];
    if (conf) { erro.textContent = typeof conf === "string" ? conf : conf.texto; return; }
    const botao = form.querySelector("[type=submit]");
    botao.disabled = true;
    const id = await criarRegistro(campos, { secao });
    botao.disabled = false;
    if (!id) return;
    d.close();
    estado.piscar.set(id, Date.now() + 3500);
    mostrarAviso(`${r.valor} incluído em ${s.nome}.`);
    setTimeout(() => irPara(id), 300);
  });
  d.showModal();
  form.sistema.focus();
}
function abrirNovoRegistro() {
  if (!podeAlimentar()) { mostrarAviso(conectado() ? "Seu acesso é só de leitura." : "Sem conexão: a edição está bloqueada."); return; }
  const chaveRascunho = chaveUsuario("rascunho");
  const rascunho = lerLocal(chaveRascunho, null);
  const sugestoes = rascunho && rascunho.valores ? {} : sugestoesNovo();
  const valores = rascunho && rascunho.valores ? rascunho.valores : { ...sugestoes, ...completarCampos({}) };
  const cols = colunasAtivas().filter(podeNaLinhaNova);
  const lgpd = !(Number(lerLocal(CHAVE_LGPD_NOVO, 0)) > Date.now());
  const d = criarDialogo({
    titulo: `${termo().novo} · ${nomeCompletoPlanilha(planilhaAtual())}`,
    largo: true,
    corpo: `${lgpd ? `<p class="lgpd lgpd-curta" data-lgpd-novo><span><strong>LGPD:</strong> não registre CPF, RG, endereço, telefone pessoal nem dados de saúde.</span><button type="button" class="btn-link" data-lgpd-entendi>Entendi</button></p>` : ""}
      ${rascunho ? `<p class="apoio rascunho-recuperado">Rascunho recuperado deste navegador (${escapar(formatarData(rascunho.em, true))}). <button type="button" class="btn-link" data-limpar-rascunho>Começar do zero</button></p>` : ""}
      ${htmlEscolhaSecao()}
      <div class="form-registro">${htmlCamposFormulario(valores, podeNaLinhaNova)}</div>
      <p class="form-erro" role="alert" id="novo-erro"></p>
      <div class="form-botoes rodape-fixo">
        <span class="rodape-info"><span id="novo-contador" aria-live="polite"></span>${Object.keys(sugestoes).length ? `<button type="button" class="btn-link" data-limpar-sugestoes title="As colunas de lista vêm do seu último cadastro">Limpar sugestões</button>` : ""}</span>
        <button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
        <button type="button" class="btn btn-secundario" data-registrar-outro title="Registrar e adicionar outro (Ctrl+Shift+Enter): mantém as colunas de lista">${svg("i-mais")}Registrar e adicionar outro</button>
        <button type="submit" class="btn" title="Registrar (Ctrl+Enter)">${svg("i-salvar")}Registrar</button></div>`
  });
  d.classList.add("dialogo-novo");
  const form = d.querySelector("form");
  ligarCamposFormulario(form);
  let tempo = 0, registrados = 0, salvando = false;
  const guardar = () => { clearTimeout(tempo); tempo = setTimeout(() => gravarLocal(chaveRascunho, { em: new Date().toISOString(), valores: lerFormulario(form, cols).valores }), 300); };
  /* Coluna chave repetida: aviso compacto logo abaixo do campo, com "Abrir" */
  const conferirNumero = () => INDICES.forEach((ix) => {
    const caixa = $(`[data-aviso-de="${CSS.escape(ix.col)}"]`, form);
    const el = form.elements[ix.col];
    if (!caixa) return;
    const e = el && el.value.trim() && COL[ix.col] ? conferirRegistro({ [ix.col]: chaveNumero(el.value) })[ix.col] : null;
    caixa.innerHTML = e && typeof e === "object" ? `<div class="aviso-repetido">${svg("i-alerta")}<span>Já usado por ${escapar(porId(e.id) ? alvoRegistro(porId(e.id)) || "outro registro" : "outro registro")}</span><button type="button" class="btn-link" data-abrir-existente="${escapar(e.id)}" title="${escapar(e.texto)}">Abrir</button></div>` : "";
  });
  const limparCampo = (c) => {
    const el = form.elements[c];
    if (!el) return;
    if (el.type === "hidden" && el.closest(".combo")) { el.value = ""; el.dataset.original = ""; el.closest(".combo").querySelector(".combo-texto").value = ""; return; }
    el.value = "";
    if (el.matches("textarea[data-crescer]")) crescerTexto(el);
  };
  const contar = () => { $("#novo-contador", d).textContent = registrados ? `${registrados} registro${registrados === 1 ? "" : "s"} nesta janela` : ""; };
  async function registrar(continuar) {
    if (salvando) return;
    if (combo.caixa && form.contains(combo.caixa)) { if (combo.ativo >= 0) escolherCombo(combo.caixa, combo.itens[combo.ativo]); else { fecharCombo(); } }
    const { valores: lidos, erros } = lerFormulario(form, cols);
    /* Repetido: a borda fica vermelha e o aviso com "Abrir" (embaixo do campo) já explica */
    Object.entries(conferirRegistro(lidos)).forEach(([c, x]) => { if (!(c in erros)) erros[c] = typeof x === "object" ? "" : x; });
    const soltas = marcarErros(form, erros);
    $("#novo-erro", d).textContent = soltas.join(" · ");
    conferirNumero();
    if (Object.keys(erros).length) { focarPrimeiroErro(form); document.dispatchEvent(new CustomEvent("planilha:erro", { detail: { erro: Object.values(erros).find(Boolean) || "Valor repetido" } })); return; }
    salvando = true;
    $$("[type=submit], [data-registrar-outro]", form).forEach((b) => { b.disabled = true; });
    const id = await criarRegistro(lidos);
    salvando = false;
    $$("[type=submit], [data-registrar-outro]", form).forEach((b) => { b.disabled = false; });
    if (!id) return;
    gravarLocal(chaveUsuario("sugestoes-novo"), Object.fromEntries(COLUNAS_SUGERIDAS.filter((c) => !estaVazio(lidos[c])).map((c) => [c, lidos[c]])));
    apagarLocal(chaveRascunho);
    clearTimeout(tempo);
    estado.piscar.set(id, Date.now() + 3500);
    registrados++;
    if (!continuar) { d.close(); mostrarAviso(registrados > 1 ? `${registrados} registros adicionados.` : "Registro adicionado."); setTimeout(() => irPara(id), 400); return; }
    COLUNAS_DO_EQUIPAMENTO.forEach(limparCampo);
    marcarErros(form, {});
    conferirNumero();
    contar();
    mostrarAviso("Registro adicionado. Pode registrar o próximo.", 2500);
    const h = form.querySelector("input:not([type=checkbox]):not([type=hidden]), select, textarea");
    if (h) h.focus();
  }
  form.addEventListener("input", (e) => { guardar(); if (INDICES.some((ix) => ix.col === e.target.name)) conferirNumero(); });
  form.addEventListener("change", guardar);
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.isComposing) return;
    e.preventDefault();
    registrar(e.shiftKey);
  });
  d.addEventListener("click", (e) => {
    const ab = e.target.closest("[data-abrir-existente]");
    if (ab) { d.close(); abrirFicha(ab.dataset.abrirExistente); }
    if (e.target.closest("[data-limpar-rascunho]")) { apagarLocal(chaveRascunho); d.close(); setTimeout(abrirNovoRegistro, 320); }
    if (e.target.closest("[data-registrar-outro]")) registrar(true);
    if (e.target.closest("[data-lgpd-entendi]")) { gravarLocal(CHAVE_LGPD_NOVO, Date.now() + 30 * 86400000); const p = $("[data-lgpd-novo]", d); if (p) p.remove(); }
    const ls = e.target.closest("[data-limpar-sugestoes]");
    if (ls) {
      gravarLocal(chaveUsuario("sugestoes-novo"), {});
      Object.keys(sugestoes).forEach(limparCampo);
      ls.remove();
      guardar();
    }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); registrar(false); });
  d.addEventListener("close", () => clearTimeout(tempo));
  d.showModal();
  prepararCamposFormulario(form);
  const primeiro = (idChave() && form.elements[idChave()]) || form.querySelector("input:not([type=checkbox]):not([type=hidden]), select, textarea");
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
  return (cols.find((c) => n.includes(limpo(c.nome)) && limpo(c.nome).length > 3) || cols.find((c) => limpo(c.nome).includes(n) && n.length > 3) || {}).id || "";
}
function abrirColar(textoInicial = "") {
  if (!podeAlimentar()) { mostrarAviso(conectado() ? "Seu acesso é só de leitura." : "Sem conexão: a edição está bloqueada."); return; }
  const cols = colunasAtivas().filter(podeNaLinhaNova);
  const admin = ehAdmin();
  const d = criarDialogo({
    titulo: "Colar do Excel",
    largo: true,
    corpo: `<p class="lgpd"><strong>LGPD:</strong> deixe como “Ignorar” colunas de CPF, RG, endereço, telefone pessoal ou saúde.</p>
      ${htmlEscolhaSecao("Seção das linhas coladas")}
      <div class="campos-linha">
        <label class="campo"><span class="rotulo">Cole aqui as células do Excel (com o cabeçalho)</span><textarea name="colado" rows="6" placeholder="${escapar(cols.slice(0, 3).map((c) => c.nome).join("\t"))}…"></textarea></label>
        <div class="campo"><label class="campo"><span class="rotulo">Ou escolha um arquivo .csv</span><input type="file" name="arquivo" accept=".csv,text/csv,.txt"></label>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="cabecalho" checked> A primeira linha é o cabeçalho</label>
          ${admin ? `<label class="campo" style="margin-top:8px"><span class="rotulo">O que fazer</span><select name="modo">
            <option value="adicionar">Só adicionar linhas novas</option>
            ${colNumero() ? `<option value="atualizar">Atualizar pela coluna ${escapar(colNumero().nome)} (e adicionar os novos)</option>` : ""}
            <option value="substituir">Substituir TODOS os registros desta planilha (faz backup antes)</option></select></label>
            <p class="apoio" style="margin-top:8px;font-size:12px">A gravação vai em lotes. Se o limite diário do plano gratuito acabar, o que falta fica guardado para “Continuar a importação”.</p>`
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
    /* Colunas de valor único repetidas dentro da própria colagem */
    const vistosUnicos = new Map(colunasAtivas().filter((c) => c.unica && c.id !== idChave()).map((c) => [c.id, new Set()]));
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
        else if (escolha === "aceitar" && f.removida && admin) informados[c] = f.removida.id;
        else if (escolha !== "vazio") { erros.push(r.erro); celulasFora.add(i); }
      });
      const campos = completarCampos(informados);
      const chave = idChave() && campos[idChave()] ? normalizar(chaveNumero(campos[idChave()])) : "";
      const secaoColada = secaoParaNovo();
      const existente = chave ? estado.equipamentos.find((t) => (!chaveComposta() || (t.secao || "") === secaoColada) && normalizar(chaveNumero((t.campos || {})[idChave()])) === chave) || null : null;
      const repetidoNoColado = chave && vistos.has(chave);
      if (chave) vistos.add(chave);
      const m = modo();
      const conf = conferirRegistro(campos, existente && m !== "adicionar" ? existente.id : undefined);
      /* Coluna chave já cadastrada vira "Já existe"/"Atualizar"; outra coluna única repetida é erro */
      Object.entries(conf).forEach(([c, x]) => { if (typeof x === "string") erros.push(x); else if (c !== idChave()) erros.push(x.texto); });
      vistosUnicos.forEach((set, c) => {
        if (estaVazio(campos[c])) return;
        const k = normalizar(chaveNumero(campos[c]));
        if (set.has(k)) erros.push(`${COL[c].nome} “${campos[c]}” repetido na própria colagem.`);
        set.add(k);
      });
      let situacao = erros.length ? "erro" : "nova";
      if (!erros.length && repetidoNoColado) { situacao = "erro"; erros.push(`${colNumero().nome} “${campos[idChave()]}” repetido na própria colagem.`); }
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
          <select data-troca="${escapar(f.chave)}"><option value="">Corrigir depois (a linha não entra)</option>${f.removida && admin ? `<option value="aceitar"${trocas.get(f.chave) === "aceitar" ? " selected" : ""}>Aceitar mesmo assim (manter o nome)</option>` : ""}${f.sugestao ? `<option value="sugestao"${trocas.get(f.chave) === "sugestao" ? " selected" : ""}>Usar “${escapar(f.sugestao.nome)}”</option>` : ""}<option value="vazio"${trocas.get(f.chave) === "vazio" ? " selected" : ""}>Deixar o campo vazio</option></select></label>`).join("")}</div>` : ""}
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
    if (e.target.matches("[data-mapa], [data-secao-nova]")) desenhar();
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
      /* Equipe N2: cada linha num lote próprio (registro + índice da coluna chave + histórico + contador da localidade) */
      for (const l of validas) {
        progresso.textContent = `Gravando ${ok + falhas + 1} de ${validas.length}…`;
        const id = await criarRegistro(l.campos, { semDesfazer: true });
        if (id) { ok++; estado.piscar.set(id, Date.now() + 3500); } else falhas++;
      }
    } else {
      if (m === "substituir") {
        if (!(await confirmarDigitando(`Isso apaga os ${estado.equipamentos.length} registros atuais desta planilha e grava ${validas.length} no lugar. Um backup é feito antes.`, "SUBSTITUIR", { titulo: "Substituir todos os registros", botao: "Substituir" }))) { botao.disabled = false; return; }
        progresso.textContent = "Fazendo backup…";
        const bk = await criarBackup("Antes de substituir todos os registros pela colagem");
        if (!bk) { botao.disabled = false; return; }
        progresso.textContent = "Apagando os registros atuais…";
        try { await gravarArquivo([], { apagarVivos: estado.vivos }); await apagarTodosIndices(); }
        catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); botao.disabled = false; return; }
      }
      /* Um grupo de escritas por registro, gravados em lotes (dá para continuar depois) */
      const grupos = [], ids = [];
      validas.forEach((l) => {
        if (l.situacao === "atualizar" && m === "atualizar") { grupos.push(opsAlteracao(l.existente, { ...l.informados }, "importar")); return; }
        const id = estado.api.novoId(P());
        ids.push(id);
        grupos.push(opsNovoRegistro(id, filtrarCamposPermitidos(l.campos), "importar"));
      });
      progresso.textContent = `Gravando 0 de ${grupos.length}…`;
      const r = await gravarImportacao(grupos, (feitos, total) => { progresso.textContent = `Gravando ${feitos} de ${total}…`; });
      ok = r.feitos;
        ids.forEach((id) => estado.piscar.set(id, Date.now() + 3500));
      registrarAuditoria("importar", `Importou ${r.feitos} de ${validas.length} linha(s) (${m === "substituir" ? "substituindo tudo" : m === "atualizar" ? `atualizando pela coluna ${colNumero() ? colNumero().nome : "chave"}` : "só adicionando"})`, r.ok ? "" : `Faltam ${r.faltam}`);
      if (!r.ok) { progresso.textContent = ""; d.close(); mostrarAviso(textoResultadoImportacao(r), 12000); return; }
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
    ["ficha", "i-olho", veMudancas() ? "Ver ficha e histórico" : "Ver ficha"],
    ...(podeEditarLinha(t) ? [["editar", "i-lapis", "Editar na ficha"]] : []),
    ["copiar", "i-copiar", "Copiar resumo"],
    ...(ehAdmin() && conectado() && porEstado(localidadePorId(estado.planilha)) ? [["mover-secao", "i-arrastar", "Mover para outra seção"]] : []),
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
    if (m === "mover-secao") pedirMoverSecao(t);
    if (m === "recusar") recusarExclusao(t);
    if (m === "excluir") excluirParaLixeira([t], t.exclusao ? `Pedido de ${(t.exclusao.porNome || nomePessoa(t.exclusao.por))}: ${t.exclusao.motivo}` : "");
  });
  pop.querySelector("button").focus();
}
const textoRegistro = (t) => colunasAtivas().map((c) => { const v = valorTexto(t, c); return v ? `${c.nome}: ${v}` : ""; }).filter(Boolean).join("\n");

const ficha = $("#ficha");
ligarCamposFormulario(ficha);
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
  const titulo = alvoRegistro(t) || "Registro";
  let corpo;
  if (!editar) {
    corpo = grupos.map((g) => {
      const itens = colunasDoFormulario((c) => c.grupo === g.id && valorTexto(t, c));
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
    ${editar || !veMudancas() ? "" : `<section class="ficha-grupo"><h3>Histórico</h3><ul class="historico linha-tempo" id="ficha-historico"><li>Carregando…</li></ul></section>`}
  </form>`;
  ficha.dataset.id = id;
  ficha.dataset.editando = editar ? "1" : "";
  ficha.hidden = false;
  requestAnimationFrame(() => ficha.classList.add("aberta"));
  if (editar) prepararCamposFormulario(ficha);
  const primeiro = ficha.querySelector(editar ? "input:not([type=hidden]), select, textarea" : "[data-ficha]");
  if (primeiro) primeiro.focus();
  if (pararHistorico) { pararHistorico(); pararHistorico = null; }
  if (!editar && estado.api && veMudancas()) {
    pararHistorico = estado.api.ouvirColecao(`${P()}/${id}/historico`, (lista) => {
      const el = $("#ficha-historico");
      if (!el) return;
      /* Linha do tempo: as trocas das colunas LISTA ficam em destaque */
      el.innerHTML = lista.length ? lista.map((h) => {
        const quem = `<span class="quem" title="${escapar(h.porEmail || (String(h.por || "").includes("@") ? h.por : ""))}">${escapar(h.porNome || nomePessoa(h.por))}</span>`;
        const movimentacao = COLUNAS_MOVIMENTACAO.includes(h.coluna);
        let oque;
        if (h.acao === "criar") oque = `cadastrou o registro${h.depois ? `: ${escapar(h.depois)}` : ""}`;
        else if (h.acao === "importar" && !h.coluna) oque = `importou o registro${h.depois ? `: ${escapar(h.depois)}` : ""}`;
        else if (h.acao === "pedirExclusao") oque = `solicitou a exclusão: ${escapar(h.depois)}`;
        else if (h.acao === "recusarExclusao") oque = "recusou o pedido de exclusão";
        else if (h.acao === "restaurar") oque = "restaurou o registro";
        else if (movimentacao) oque = `<strong>${escapar(h.colunaNome || h.coluna)}</strong>: <span class="de">${escapar(h.antes || "(vazio)")}</span> → <span class="para">${escapar(h.depois || "(vazio)")}</span>`;
        else oque = `mudou <strong>${escapar(h.colunaNome || h.coluna)}</strong>: ${escapar(h.antes || "(vazio)")} → ${escapar(h.depois || "(vazio)")}`;
        if (h.acao === "substituirValor") oque += " (substituição de valor)";
        return `<li class="${movimentacao ? "movimentacao" : ""}"><span class="quando">${escapar(formatarData(h.em, true))}</span>${quem} ${oque}</li>`;
      }).join("") : "<li>Sem mudanças registradas.</li>";
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
  const conf = conferirRegistro({ ...(t.campos || {}), ...valores }, t.id, t.secao);
  Object.entries(conf).forEach(([c, x]) => { if (!erros[c] && cols.some((k) => k.id === c)) erros[c] = typeof x === "object" ? x.texto : x; });
  const soltas = marcarErros(form, erros);
  if (Object.keys(erros).length) { $("#ficha-erro").textContent = soltas.join(" · "); focarPrimeiroErro(form); return; }
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
    if (ok) {
      d.close();
      mostrarAviso("Pedido de exclusão enviado às administradoras.");
      registrarAuditoria("pedirExclusao", `Pediu a exclusão de ${alvoRegistro(t)}`, motivo, { alvo: alvoRegistro(t) });
    }
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
 *  Registro de ações (cadeias-auditoria: só administradoras leem tudo)
 * ------------------------------------------------------------ */
/* Colunas cuja troca aparece em destaque na linha do tempo da ficha: as colunas LISTA */
const COLUNAS_MOVIMENTACAO = { includes: (id) => !!COL[id] && TIPOS_LISTA.includes(COL[id].tipo) };
/* Trilha (cadeias-auditoria, só inclusão): administradora assina com o e-mail; a equipe e a leitura com o uid
   e só a própria atividade (as mesmas listas do firestore.rules). mudancas = [{ coluna, antes, depois }]. */
const ACOES_PROPRIAS = ["entrar", "exportar"];
const ACOES_DA_EQUIPE = ["criar", "editar", "editarMassa", "preencherMassa", "importar", "pedirExclusao"];
function registrarAuditoria(acao, resumo, detalhes = "", { planilha = planilhaAtual().id, alvo = "", mudancas = null } = {}) {
  if (!estado.api || !estado.usuario) return Promise.resolve();
  const admin = ehAdmin();
  if (!admin && !ACOES_PROPRIAS.includes(acao) && !(papel() === "equipe" && ACOES_DA_EQUIPE.includes(acao))) return Promise.resolve();
  const id = estado.api.novoId(COL_AUDITORIA);
  return estado.api.salvarDoc(`${COL_AUDITORIA}/${id}`, {
    acao: String(acao).slice(0, 40), resumo: String(resumo).slice(0, 300), detalhes: String(detalhes || "").slice(0, 1500),
    por: admin ? estado.usuario.email : estado.usuario.uid, porNome: txt(estado.usuario.nome, 80), porEmail: txt(estado.usuario.email, 120),
    planilha: txt(planilha, 40), ambiente: txt(estado.ambiente, 8), alvo: txt(alvo, 120),
    mudancas: (mudancas || []).slice(0, 60).map((m) => ({ coluna: txt(m.coluna, 60), antes: txt(m.antes, 300), depois: txt(m.depois, 300) })),
    em: "__AGORA__"
  }).catch((e) => console.warn("Auditoria:", e));
}
/* Como o registro aparece na trilha e nas últimas mudanças: a coluna chave; sem ela, as duas primeiras colunas preenchidas */
function alvoRegistro(t, campos = (t && t.campos) || {}, e = estado.estrutura || (estado.ambiente ? estruturaDoAmbiente() : null)) {
  if (!e) return (t && t.id) || "";
  const cols = e.colunas.filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo));
  const chave = e.colunaChave && cols.find((c) => c.id === e.colunaChave);
  if (chave && !estaVazio(campos[chave.id])) return String(valorTexto({ campos }, chave)).slice(0, 120);
  return cols.filter((c) => !estaVazio(campos[c.id])).slice(0, 2).map((c) => valorTexto({ campos }, c)).join(" · ").slice(0, 120) || (t && t.id) || "";
}

/* Registro pronto para gravar de novo (datas de controle viram "__DATA__:<ISO>") */
const marcaData = (iso) => (iso ? "__DATA__:" + iso : "__AGORA__");
function serializar(t) {
  return {
    campos: t.campos || {}, numero: t.numero || "", ...(t.secao ? { secao: t.secao } : {}),
    criadoPor: t.criadoPor || "", criadoEm: marcaData(t.criadoEm),
    atualizadoPor: t.atualizadoPor || "", atualizadoEm: marcaData(t.atualizadoEm),
    ...(t.criadoPorNome ? { criadoPorNome: t.criadoPorNome, criadoPorEmail: t.criadoPorEmail || "" } : {}),
    ...(t.atualizadoPorNome ? { atualizadoPorNome: t.atualizadoPorNome, atualizadoPorEmail: t.atualizadoPorEmail || "" } : {}),
    exclusao: t.exclusao ? { motivo: t.exclusao.motivo || "", por: t.exclusao.por || "", ...(t.exclusao.porNome ? { porNome: t.exclusao.porNome, porEmail: t.exclusao.porEmail || "" } : {}), em: marcaData(t.exclusao.em) } : null
  };
}

/* ------------------------------------------------------------
 *  Arquivo compactado (<localidade>/arquivo): centenas de linhas por documento
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
    if (t.secao) a.secao = t.secao;
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
    return { ...normalizarEquipamento({ ...autoria, id: String(l[0]), campos, numero: String(l[1] || ""), exclusao: null }), arquivo: true };
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
  return { ...v, ...original, campos: { ...(base.campos || {}), ...(v.campos || {}) }, numero: v.numero || base.numero, secao: v.secao || base.secao || "", parcial: true };
}
/* Registros vivos primeiro; cada vivo substitui (ou, se parcial, completa) a linha do arquivo de mesmo id */
function combinarEquipamentos() {
  const vivos = new Map(estado.vivos.map((t) => [t.id, t]));
  const doArquivo = estado.arquivo.linhas.map((t) => {
    const v = vivos.get(t.id);
    if (!v) return t;
    vivos.delete(t.id);
    return v.parcial ? mesclarParcial(t, v) : v;
  });
  estado.equipamentos = [...vivos.values(), ...doArquivo];
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
/* Grava a lista inteira como versão nova; depois apaga as versões antigas e os registros vivos indicados.
   O índice da coluna chave continua valendo (os registros compactados seguem únicos no servidor). */
async function gravarArquivo(lista, { apagarVivos = [] } = {}) {
  const versao = Date.now();
  const grupos = dividirArquivo(lista);
  const antigos = [...estado.arquivo.docs];
  await estado.api.lote(grupos.map((g, i) => ({ op: "set", caminho: `${ARQ()}/v${versao}-${String(i).padStart(3, "0")}`, dados: dadosParte(versao, i, grupos.length, jsonParte(g)) })));
  const limpeza = antigos.map((id) => ({ op: "delete", caminho: `${ARQ()}/${id}` }));
  apagarVivos.forEach((t) => { limpeza.push({ op: "delete", caminho: `${P()}/${t.id}` }); });
  if (limpeza.length) await estado.api.lote(limpeza);
  return grupos.length;
}
/* Substituir tudo ou restaurar um backup: os índices são refeitos do zero (só administradoras) */
async function apagarTodosIndices() {
  for (const ix of INDICES) {
    const docs = await estado.api.lerColecao(`${LOC()}/${ix.colecao}`);
    for (let i = 0; i < docs.length; i += 400) await estado.api.lote(docs.slice(i, i + 400).map((d) => ({ op: "delete", caminho: caminhoIndice(ix, d.id) })));
  }
}
async function recriarIndices(lista) {
  const ops = [];
  INDICES.forEach((ix) => {
    const usados = new Set();
    lista.forEach((t) => {
      const k = chaveIndice(ix, t.campos, t.secao);
      if (!k || usados.has(k)) return;
      usados.add(k);
      ops.push({ op: "set", caminho: caminhoIndice(ix, k), dados: { registro: t.id } });
    });
  });
  if (ops.length) await estado.api.lote(ops);
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
    ops.push({ op: "set", caminho: `${ARQ()}/${p.id}`, dados: dadosParte(p.versao, p.indice, p.total, json) });
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
function equipamentoDeRegistro(r) {
  const d = r.dados || {};
  const data = (v) => (typeof v === "string" && v.startsWith("__DATA__:") ? v.slice(9) : "");
  return normalizarEquipamento({ ...d, id: r.id, criadoEm: data(d.criadoEm), atualizadoEm: data(d.atualizadoEm), exclusao: null });
}
/* No backup, as linhas do arquivo vão sem os campos de autoria vazios */
function registroBackup(t) {
  if (!t.arquivo) return serializar(t);
  const r = { campos: t.campos || {}, numero: t.numero || "", ...(t.secao ? { secao: t.secao } : {}) };
  CAMPOS_AUTORIA.forEach((k) => { if (t[k]) r[k] = /Em$/.test(k) ? marcaData(t[k]) : t[k]; });
  return r;
}
async function compactarArquivo() {
  const vivos = estado.vivos.filter((t) => !t.exclusao);
  if (!vivos.length) { mostrarAviso("Todos os registros já estão no arquivo compactado."); return; }
  if (!(await confirmar(`Guardar ${vivos.length} registro(s) no arquivo compactado? Os dados e o histórico não mudam; abrir a planilha passa a gastar menos leituras do Firebase. Prefira um horário em que ninguém esteja editando. Linhas com pedido de exclusão ficam de fora.`, { titulo: "Compactar registros", botao: "Compactar" }))) return;
  mostrarAviso("Compactando…", 60000);
  try {
    const lista = estado.equipamentos.filter((t) => !t.exclusao);
    const n = await gravarArquivo(lista, { apagarVivos: vivos });
    registrarAuditoria("compactar", `Guardou ${vivos.length} registro(s) de ${planilhaAtual().nome} no arquivo compactado`, `${lista.length} linha(s) em ${n} documento(s)`);
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
  } else if (!(await confirmar(`Mover o registro ${alvoRegistro(lista[0])} para a Lixeira? Dá para restaurar depois.`, { titulo: "Excluir registro", botao: "Excluir", perigo: true }))) return false;
  const ops = [];
  lista.forEach((t) => {
    ops.push({ op: "set", caminho: `${COL_LIXEIRA}/${t.id}`, dados: { dados: serializar(t), excluidoPor: estado.usuario.email, excluidoEm: "__AGORA__", motivo: String(motivo).slice(0, 300), planilha: planilhaAtual().id } });
    /* O valor da coluna chave fica livre para outro registro (volta se o registro for restaurado) */
    ops.push(...opsApagarIndices(t));
    if (t.arquivo) return;
    ops.push({ op: "delete", caminho: `${P()}/${t.id}` });
  });
  const ids = lista.map((t) => t.id);
  const ok = await gravar(ops, { rotulo: "Registros restaurados da Lixeira", desfazer: async () => restaurarDaLixeira(ids, { silencioso: true }) });
  if (ok) {
    try { await alterarArquivo(new Map(lista.filter((t) => noArquivo(t.id)).map((t) => [t.id, null]))); }
    catch (e) { console.error(e); mostrarAviso("Os registros foram para a Lixeira, mas não saíram do arquivo compactado. Tente excluir de novo.", 8000); return false; }
    registrarAuditoria("excluir", `Moveu ${lista.length} registro(s) de ${planilhaAtual().nome} para a Lixeira`, [motivo, lista.map((t) => alvoRegistro(t)).join(", ")].filter(Boolean).join(" · "));
    estado.selecionados.clear();
    if (lista.some((t) => t.id === ficha.dataset.id)) fecharFicha();
    mostrarAviso(`${lista.length} registro(s) na Lixeira. Use Desfazer se foi sem querer.`, 5000);
  }
  return ok;
}
async function excluirDeVez(lista, motivo = "", { semAuditoria = false } = {}) {
  if (!ehAdmin() || !lista.length) return true;
  const ops = [];
  const soNoArquivo = new Set(estado.equipamentos.filter((t) => t.arquivo).map((t) => t.id));
  lista.forEach((t) => {
    ops.push(...opsApagarIndices(t));
    if (soNoArquivo.has(t.id)) return;
    ops.push({ op: "delete", caminho: `${P()}/${t.id}` });
  });
  try {
    await estado.api.lote(ops);
    await alterarArquivo(new Map(lista.filter((t) => noArquivo(t.id)).map((t) => [t.id, null])));
    if (!semAuditoria) registrarAuditoria("excluirDeVez", `Excluiu de vez ${lista.length} registro(s) de ${planilhaAtual().nome}`, motivo);
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}
async function restaurarDaLixeira(ids, { silencioso = false } = {}) {
  const itens = ids.map((id) => estado.lixeira.find((x) => x.id === id)).filter(Boolean);
  if (!itens.length) {
    for (const id of ids) { const doc = await estado.api.lerDoc(`${COL_LIXEIRA}/${id}`); if (doc) itens.push({ id, ...doc }); }
  }
  if (!itens.length) return false;
  /* O valor da coluna chave volta para o índice, a não ser que outro registro já use o valor */
  const usados = Object.fromEntries(INDICES.map((ix) => [ix.campo, new Set(estado.equipamentos.map((t) => chaveIndice(ix, t.campos, t.secao)).filter(Boolean))]));
  const ops = [];
  let conflitos = 0;
  itens.forEach((x) => {
    const dados = serializar({ ...x.dados });
    INDICES.forEach((ix) => {
      const k = chaveIndice(ix, dados.campos, dados.secao);
      if (k && usados[ix.campo].has(k)) { dados[ix.campo] = ""; conflitos++; return; }
      dados[ix.campo] = k;
      if (k) { usados[ix.campo].add(k); ops.push({ op: "set", caminho: caminhoIndice(ix, k), dados: { registro: x.id } }); }
    });
    dados.exclusao = null;
    ops.push({ op: "set", caminho: `${P()}/${x.id}`, dados });
    ops.push({ op: "delete", caminho: `${COL_LIXEIRA}/${x.id}` });
    ops.push(opHistorico(x.id, "restaurar"));
  });
  try {
    await estado.api.lote(ops);
    registrarAuditoria("restaurar", `Restaurou ${itens.length} registro(s) da Lixeira em ${planilhaAtual().nome}`, itens.map((x) => (x.dados && x.dados.numero) || x.id).join(", "));
    if (!silencioso || conflitos) mostrarAviso(`${itens.length} registro(s) restaurado(s).${conflitos ? ` ${conflitos} valor(es) da coluna chave já estão em outro registro: confira as linhas restauradas.` : ""}`, 6000);
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}
/* Backup: estrutura + todos os registros, em partes de até ~600 KB (cada parte < 1 MB) */
async function criarBackup(motivo) {
  if (!ehAdmin()) return null;
  try {
    const id = estado.api.novoId(`${COL_BACKUPS}`);
    const registros = estado.equipamentos.map((t) => ({ id: t.id, dados: registroBackup(t) }));
    const partes = [];
    let atual = [], tamanho = 0;
    registros.forEach((r) => {
      const n = bytes(JSON.stringify(r)) + 1;
      if (atual.length && tamanho + n > LIMITE_PARTE) { partes.push(atual); atual = []; tamanho = 0; }
      atual.push(r); tamanho += n;
    });
    if (atual.length) partes.push(atual);
    const ops = [{ op: "set", caminho: `${COL_BACKUPS}/${id}`, dados: {
      motivo: String(motivo).slice(0, 200), criadoPor: estado.usuario.email, criadoEm: "__AGORA__", planilha: planilhaAtual().id,
      totalRegistros: registros.length, partes: partes.length, versaoEstrutura: estado.estrutura ? estado.estrutura.versao : 0,
      estrutura: JSON.stringify(estado.estrutura ? dadosEstruturaBackup(estado.estrutura) : null)
    } }];
    partes.forEach((p, i) => ops.push({ op: "set", caminho: `${COL_BACKUPS}/${id}/partes/${i}`, dados: { indice: i, json: JSON.stringify(p) } }));
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
  const partes = await estado.api.lerColecao(`${COL_BACKUPS}/${b.id}/partes`);
  const registros = partes.sort((x, y) => x.indice - y.indice).flatMap((p) => JSON.parse(p.json || "[]"));
  return { estrutura: JSON.parse(b.estrutura || "null"), registros };
}
const RE_ID_DOC = /^[A-Za-z0-9_-]{1,100}$/;
/* Substitui os registros da localidade pelos do backup (a estrutura do ambiente NÃO muda: ela vale para todas as
   localidades). Os registros vão para o arquivo compactado; só os que têm pedido de exclusão voltam como vivos. */
async function aplicarBackup({ registros }, descricao) {
  const validos = (Array.isArray(registros) ? registros : []).filter((r) => r && typeof r.id === "string" && RE_ID_DOC.test(r.id) && r.dados && typeof r.dados === "object");
  if (!(await criarBackup(`Antes de restaurar ${descricao}`))) return false;
  mostrarAviso("Restaurando… não feche a página.", 120000);
  const vivos = validos.filter((r) => r.dados.exclusao);
  const manter = new Set(vivos.map((r) => r.id));
  const partes = await gravarArquivo(validos.filter((r) => !r.dados.exclusao).map(equipamentoDeRegistro), { apagarVivos: estado.vivos.filter((t) => !manter.has(t.id)) });
  if (vivos.length) await estado.api.lote(vivos.map((r) => ({ op: "set", caminho: `${P()}/${r.id}`, dados: r.dados })));
  /* Índice da coluna chave refeito para os registros do backup */
  await apagarTodosIndices();
  await recriarIndices(validos.map((r) => ({ id: r.id, campos: (r.dados && r.dados.campos) || {} })));
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
    if (!dados || !Array.isArray(dados.registros) || !dados.estrutura) { mostrarAviso("O arquivo não tem estrutura e registros de um backup do Cadeias."); return; }
    const est = normalizarEstrutura(dados.estrutura);
    if (!est || !est.colunas.length) { mostrarAviso("O arquivo não tem uma estrutura válida."); return; }
    const texto = `Carregar “${f.name}” em ${planilhaAtual().nome}: ${dados.registros.length.toLocaleString("pt-BR")} registro(s). Os ${estado.equipamentos.length.toLocaleString("pt-BR")} registro(s) atuais desta planilha são substituídos; antes, é feito um backup. A estrutura do ambiente não muda (vale para todas as planilhas).`;
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
    baixarArquivo(`cadeias-backup-${slug(planilhaAtual().nome || "planilha", 40)}-${p.ano}-${p.mes}-${p.dia}-${p.hora}${p.minuto}.json`,
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
    try { lista = (await estado.api.lerColecao(`${COL_BACKUPS}`, { ordenar: "criadoEm", desc: true, limite: 100 })).filter(daPlanilhaAtual).slice(0, 50); }
    catch (e) { $("#lista-backups", d).innerHTML = `<p class="apoio" style="padding:12px">Não foi possível carregar.</p>`; return; }
    $("#lista-backups", d).innerHTML = lista.length ? `<table><thead><tr><th>Quando</th><th>Motivo</th><th>Por</th><th>Registros</th><th></th></tr></thead><tbody>${lista.map((b) => `<tr>
      <td>${escapar(formatarData(b.criadoEm, true))}</td><td>${escapar(b.motivo)}</td><td>${escapar(nomePessoa(b.criadoPor))}</td><td>${escapar(b.totalRegistros)}</td>
      <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-bk="baixar" data-id="${escapar(b.id)}">${svg("i-download")}JSON</button>
        <button type="button" class="btn btn-secundario btn-mini" data-bk="restaurar" data-id="${escapar(b.id)}">${svg("i-restaurar")}Restaurar</button>
        <button type="button" class="acao-linha" data-bk="apagar" data-id="${escapar(b.id)}" title="Apagar este backup" aria-label="Apagar este backup">${svg("i-lixeira")}</button></td></tr>`).join("")}</tbody></table>` : `<p class="apoio" style="padding:12px">Nenhum backup ainda.</p>`;
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
      const partes = await estado.api.lerColecao(`${COL_BACKUPS}/${item.id}/partes`);
      await estado.api.lote([...partes.map((p) => ({ op: "delete", caminho: `${COL_BACKUPS}/${item.id}/partes/${p.id}` })), { op: "delete", caminho: `${COL_BACKUPS}/${item.id}` }]);
      registrarAuditoria("apagarBackup", `Apagou o backup de ${formatarData(item.criadoEm, true)}`);
      desenhar();
    }
  });
  desenhar();
}
function abrirLixeira() {
  const d = criarDialogo({ titulo: "Lixeira", largo: true, corpo: `<p class="apoio">Registros excluídos desta planilha. Restaurar devolve a linha à planilha; excluir de vez não tem volta.</p><div class="tabela-admin" id="lista-lixeira"></div>` });
  const numeroDe = (x) => alvoRegistro(null, (x.dados || {}).campos || {}) || x.id;
  const desenhar = () => {
    const lista = [...estado.lixeira].sort((a, b) => String(b.excluidoEm).localeCompare(String(a.excluidoEm)));
    $("#lista-lixeira", d).innerHTML = lista.length ? `<table><thead><tr><th>Registro</th><th></th><th>Excluído em</th><th>Por</th><th>Motivo</th><th></th></tr></thead><tbody>${lista.map((x) => `<tr>
      <td>${escapar(numeroDe(x))}</td><td></td><td>${escapar(formatarData(x.excluidoEm, true))}</td><td>${escapar(nomePessoa(x.excluidoPor))}</td><td>${escapar(x.motivo || "")}</td>
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
      try { await estado.api.lote([{ op: "delete", caminho: `${COL_LIXEIRA}/${x.id}` }]); registrarAuditoria("excluirDeVez", `Excluiu de vez da Lixeira o registro ${numeroDe(x)}`); }
      catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); }
    }
  });
  estado.aoMudarLixeira = desenhar;
  d.addEventListener("close", () => { estado.aoMudarLixeira = null; });
  desenhar();
  d.showModal();
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
  const ids = new Set(estado.equipamentos.map((t) => t.id));
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
  if (a === "excluir") { const m = mapaEquipamentos(); excluirParaLixeira([...estado.selecionados].map((id) => m.get(id)).filter(Boolean)); }
  renderizarSelecao(); pintarLinhas(true);
});
$("#btn-selecionar").addEventListener("click", () => {
  estado.selecionando = !estado.selecionando;
  if (!estado.selecionando) estado.selecionados.clear();
  renderizarTudo();
});
function editarEmMassa() {
  const m = mapaEquipamentos();
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
      empilharDesfazer("Edição em massa desfeita", async () => { const m = mapaEquipamentos(); await definirEmVarios(antes.map(([id, v]) => [m.get(id), v]).filter(([t]) => t), c, "desfazer"); });
      registrarAuditoria("editarMassa", `Definiu ${c.nome} = “${textoDoValor(c, r.valor)}” em ${lista.length} registro(s)`);
      d.close(); mostrarAviso(`${lista.length} registro(s) atualizados.`);
    }
  });
  d.showModal();
}

/* ------------------------------------------------------------
 *  Pessoas (só administradoras): uma linha por IDENTIDADE (e-mail), com os aparelhos dela.
 *  Perfil: "equipe-n2" (Equipe N2: edita) ou "equipe" (Equipe: só visualiza). Tudo vai para a auditoria.
 * ------------------------------------------------------------ */
const AVISO_SEM_SENHA = "A entrada é feita com e-mail e nome, sem senha. Qualquer pessoa que saiba os dois consegue entrar como esse cadastro. Bloqueie e desconecte se suspeitar de uso indevido.";
const situacaoIdentidade = (i) => (i.ativo === false ? "bloqueada" : i.aprovado ? "ativa" : "aguardando");
const aparelhosDe = (email) => estado.pessoas.filter((p) => p.vinculadoEm && p.email === email);
const desconectado = (p, i) => !!(i && i.revogadoAntesDe) && !(Date.parse(p.vinculadoEm) >= Date.parse(i.revogadoAntesDe));
const maisRecente = (datas) => datas.filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).pop() || "";
const registrosDe = (email, uids) => { const s = new Set(uids); return estado.equipamentos.filter((t) => (email && t.criadoPorEmail === email) || s.has(t.criadoPor)).length; };
const SELO_SITUACAO = {
  ativa: '<span class="selo papel-equipe">Ativa</span>',
  aguardando: '<span class="selo-exclusao">Aguardando liberação</span>',
  bloqueada: '<span class="selo-exclusao">Bloqueada</span>'
};
const PERFIS = [{ id: "equipe-n2", nome: "Equipe N2" }, { id: "equipe", nome: "Equipe" }];
const nomePerfil = (p) => (PERFIS.find((x) => x.id === p) || PERFIS[1]).nome;
const perfilValido = (p) => (p === "equipe-n2" ? "equipe-n2" : "equipe");
const opcoesPapel = (atual) => PERFIS.map((p) => `<option value="${p.id}"${perfilValido(atual) === p.id ? " selected" : ""}>${escapar(p.nome)}</option>`).join("");
async function salvarIdentidade(i, dados, texto, caixaErro) {
  if (caixaErro) caixaErro.textContent = "";
  try {
    await estado.api.salvarDoc(`${COL_IDENTIDADES}/${i.id}`, { ...dados, atualizadoEm: "__AGORA__" }, true);
    registrarAuditoria("pessoa", `${texto}: ${i.nome} (${i.email})`);
    mostrarAviso(`${texto}: ${i.nome}.`);
    return true;
  } catch (err) {
    console.error(err);
    if (caixaErro) caixaErro.textContent = mensagemErro(err); else mostrarAviso(mensagemErro(err));
    return false;
  }
}
function abrirPessoas() {
  const reg = normalizarRegistro(estado.entrada);
  const d = criarDialogo({
    titulo: "Pessoas",
    largo: true,
    corpo: `<p class="lgpd"><strong>Atenção:</strong> ${escapar(AVISO_SEM_SENHA)}</p>
      <p class="apoio">Lays e Paula são administradoras fixas e entram com senha. Antes de liberar um cadastro novo, confirme com a pessoa (por exemplo, pelo Teams) que foi ela mesma. Ao liberar, escolha o perfil: <strong>Equipe N2</strong> (vê e edita os registros e as últimas mudanças) ou <strong>Equipe</strong> (só visualiza).</p>
      <details class="cadastro-pessoas"><summary>Cadastro de pessoas novas</summary>
        <div class="campos-linha">
          <label class="check"><input type="checkbox" name="regAberto"${reg.aberto ? " checked" : ""}> Aceitar cadastros novos na tela de entrada</label>
          <label class="campo"><span class="rotulo">Domínios permitidos (vazio = qualquer)</span><input name="regDominios" value="${escapar(reg.dominios.join(", "))}" placeholder="valid.com" maxlength="400"></label>
        </div>
        <p class="apoio" style="font-size:12px">Todo cadastro novo fica “Aguardando liberação”. Quem tem acesso a outros sites não entra aqui só por isso: o cadastro do Cadeias é separado.</p>
        <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-secundario btn-mini" data-salvar-entrada>${svg("i-salvar")}Salvar regras de cadastro</button></div>
      </details>
      <div class="barra">
        <label class="busca"><span class="sr-only">Buscar pessoa</span>${svg("i-busca")}<input type="search" name="buscaPessoa" placeholder="Buscar por nome ou e-mail…" autocomplete="off"></label>
        <label class="sr-only" for="filtro-pessoas">Filtrar</label>
        <select id="filtro-pessoas" name="filtroPessoa"><option value="">Todas</option><option value="aguardando">Aguardando liberação</option><option value="ativa">Ativas</option><option value="bloqueada">Bloqueadas</option><option value="equipe-n2">Equipe N2</option><option value="equipe">Equipe</option></select>
        <span class="contagem" id="contagem-pessoas" aria-live="polite"></span>
      </div>
      <div class="tabela-admin" id="lista-pessoas"></div>
      <p class="form-erro" role="alert" id="pessoas-erro"></p>`
  });
  const form = d.querySelector("form");
  form.addEventListener("submit", (e) => e.preventDefault());
  const erro = () => $("#pessoas-erro", d);
  const passa = (texto, situacao, perfil) => {
    const termo = normalizar(form.buscaPessoa.value), filtro = form.filtroPessoa.value;
    return (!termo || normalizar(texto).includes(termo)) && (!filtro || filtro === situacao || filtro === perfil);
  };
  const desenhar = () => {
    const linhas = estado.identidades.map((i) => {
      const aps = aparelhosDe(i.id);
      return { i, aps, situacao: situacaoIdentidade(i), ultimo: maisRecente(aps.map((p) => p.ultimoAcesso)), conectados: aps.filter((p) => !desconectado(p, i)).length };
    }).filter((l) => passa(`${l.i.nome} ${l.i.email}`, l.situacao, perfilValido(l.i.perfil)))
      .sort((a, b) => (b.situacao === "aguardando") - (a.situacao === "aguardando") || String(a.i.nome || "").localeCompare(String(b.i.nome || ""), "pt-BR"));
    $("#contagem-pessoas", d).textContent = `${linhas.length} de ${estado.identidades.length} cadastro(s)${aguardando() ? ` · ${aguardando()} aguardando` : ""}`;
    $("#lista-pessoas", d).innerHTML = `<table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Aparelhos</th><th>Último acesso</th><th></th></tr></thead><tbody>
      ${linhas.map(({ i, aps, situacao, ultimo, conectados }) => `<tr data-identidade="${escapar(i.id)}"${situacao === "bloqueada" ? ' class="arquivada"' : ""}>
        <td>${escapar(i.nome)}</td><td>${escapar(i.email)}</td>
        <td><select data-papel aria-label="Perfil de ${escapar(i.nome)}"${situacao === "aguardando" ? ' title="Perfil que a pessoa recebe ao ser liberada"' : ""}>${opcoesPapel(i.perfil)}</select></td>
        <td>${SELO_SITUACAO[situacao]}</td>
        <td><button type="button" class="btn-link" data-aparelhos aria-label="Ver os aparelhos de ${escapar(i.nome)}">${conectados} de ${aps.length}</button></td>
        <td>${escapar(ultimo ? formatarData(ultimo, true) : "—")}</td>
        <td class="acoes-tab">${situacao === "aguardando"
          ? `<button type="button" class="btn btn-mini" data-liberar>Liberar</button><button type="button" class="btn btn-perigo btn-mini" data-recusar>Recusar</button>`
          : `<button type="button" class="btn ${situacao === "ativa" ? "btn-perigo" : "btn-secundario"} btn-mini" data-bloquear>${situacao === "ativa" ? "Bloquear" : "Desbloquear"}</button>`}
          <button type="button" class="btn btn-secundario btn-mini" data-corrigir-nome>${svg("i-lapis")}Corrigir nome</button></td></tr>`).join("")
        || `<tr><td colspan="7" class="apoio">${estado.identidades.length ? "Ninguém com esses filtros." : "Nenhum cadastro ainda."}</td></tr>`}
      </tbody></table>`;
  };
  form.buscaPessoa.addEventListener("input", desenhar);
  form.filtroPessoa.addEventListener("change", desenhar);
  const identidadeDaLinha = (el) => { const tr = el.closest("[data-identidade]"); return tr ? estado.identidades.find((x) => x.id === tr.dataset.identidade) : null; };
  const perfilDaLinha = (el) => { const tr = el.closest("[data-identidade]"); const s = tr && tr.querySelector("[data-papel]"); return perfilValido(s ? s.value : "equipe"); };
  d.addEventListener("change", (e) => {
    if (!e.target.matches("[data-papel]")) return;
    const i = identidadeDaLinha(e.target);
    /* Aguardando: o perfil escolhido só vale ao clicar em "Liberar" */
    if (!i || situacaoIdentidade(i) === "aguardando") return;
    const novo = perfilValido(e.target.value);
    salvarIdentidade(i, { perfil: novo }, `Mudou o perfil para ${nomePerfil(novo)}`, erro()).then((ok) => { if (!ok) desenhar(); });
  });
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.matches("[data-salvar-entrada]")) {
      const dados = normalizarRegistro({ aberto: form.regAberto.checked, dominios: form.regDominios.value.split(/[,;\s]+/), aprovacao: true });
      try {
        await estado.api.salvarDoc(`${COL_CONFIG}/entrada`, { ...dados, atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email });
        registrarAuditoria("pessoa", `Regras de cadastro: ${dados.aberto ? "aceitando cadastros novos" : "cadastros novos fechados"}${dados.dominios.length ? ` (só ${dados.dominios.join(", ")})` : ""}`, "", { planilha: "" });
        mostrarAviso("Regras de cadastro salvas.");
      } catch (err) { console.error(err); erro().textContent = mensagemErro(err); }
      return;
    }
    const i = identidadeDaLinha(b);
    if (!i) return;
    if (b.matches("[data-aparelhos]")) abrirAparelhos(i);
    if (b.matches("[data-corrigir-nome]")) corrigirNome(i);
    if (b.matches("[data-liberar]")) { const p = perfilDaLinha(b); salvarIdentidade(i, { ativo: true, aprovado: true, perfil: p }, `Liberou o acesso como ${nomePerfil(p)}`, erro()); }
    if (b.matches("[data-recusar]") && await confirmar(`Recusar o cadastro de ${i.nome} (${i.email})? A pessoa fica bloqueada; dá para desbloquear depois.`, { titulo: "Recusar cadastro", botao: "Recusar", perigo: true })) salvarIdentidade(i, { ativo: false }, "Recusou o cadastro", erro());
    if (b.matches("[data-bloquear]")) {
      if (i.ativo === false) { salvarIdentidade(i, { ativo: true, aprovado: true }, "Desbloqueou", erro()); return; }
      if (await confirmar(`Bloquear ${i.nome} (${i.email})? A pessoa deixa de ver e de gravar na hora, em todos os aparelhos.`, { titulo: "Bloquear pessoa", botao: "Bloquear", perigo: true })) salvarIdentidade(i, { ativo: false }, "Bloqueou", erro());
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
 *  Estrutura (modo "Estrutura": só administradoras)
 *  Tudo é editado num rascunho; "Aplicar" mostra a prévia, faz backup,
 *  migra os dados (conversões de tipo e colunas excluídas) e só então grava a
 *  estrutura nova. Mudar opções de uma lista nunca regrava registros.
 * ------------------------------------------------------------ */
const RE_LGPD = /cpf|cnpj|\brg\b|identidade|endere[cç]o|resid[eê]ncia|telefone pessoal|celular pessoal|nascimento|sa[uú]de|m[eé]dic|doen[cç]a/i;
const AVISO_LGPD_COLUNAS = "LGPD: não crie colunas de CPF, RG, telefone pessoal, endereço ou dados de saúde. Nomes de pessoas (ex.: responsável) são dados pessoais: guarde só o necessário.";
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
  estado.equipamentos.forEach((t) => {
    const v = (t.campos || {})[colDe.id];
    if (estaVazio(v)) return;
    total++;
    const r = converterValor(v, colDe, colPara);
    if (r.ok) ok++; else if (falhas.length < 6) falhas.push(valorTexto(t, colDe));
  });
  return { total, ok, falhas };
}
function contarUso(colId, opcaoId) {
  return estado.equipamentos.filter((t) => { const v = (t.campos || {})[colId]; return Array.isArray(v) ? v.includes(opcaoId) : v === opcaoId; }).length;
}
/* Quantos registros usam cada opção: equipamentos (vivos e do arquivo compactado) e os da lixeira.
   Os backups não são conferidos (ver o aviso no editor). */
function usoDasOpcoes(colId) {
  const uso = new Map();
  const somar = (v) => (Array.isArray(v) ? v : estaVazio(v) ? [] : [v]).forEach((x) => uso.set(x, (uso.get(x) || 0) + 1));
  estado.equipamentos.forEach((t) => somar((t.campos || {})[colId]));
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

/* Estrutura do ambiente aberto (sem as colunas extras das localidades) */
const estruturaDoAmbiente = (amb = estado.ambiente) => normalizarEstruturaBase(estado.ambientes[amb] && estado.ambientes[amb].configurado ? estado.ambientes[amb] : { ...estruturaVazia(amb), ...(estado.ambientes[amb] || {}) });
function abrirEstrutura() {
  if (!ehAdmin() || !estado.ambiente) return;
  const original = JSON.parse(JSON.stringify(estruturaDoAmbiente()));
  const r = JSON.parse(JSON.stringify(original));
  const migracoes = [];
  let aba = "colunas";
  const d = criarDialogo({
    titulo: `Estrutura de ${nomeAmbiente(estado.ambiente)} (todas as planilhas)`,
    largo: true,
    corpo: `<p class="lgpd">${escapar(AVISO_LGPD_COLUNAS)}</p>
      <div class="abas-dialogo" role="tablist">${[["colunas", "Colunas"], ["formulario", "Ordem no formulário"], ["grupos", "Grupos de colunas"], ["regras", "Regras, chave e abas"]].map(([id, nome]) => `<button type="button" role="tab" data-aba-est="${id}">${nome}</button>`).join("")}</div>
      <div id="est-conteudo"></div>
      <p class="apoio" id="est-pendente"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Descartar</button><button type="button" class="btn" data-est="aplicar">${svg("i-check")}Ver prévia e aplicar</button></div>`
  });
  const ordenadas = () => {
    const og = (g) => (r.gruposColunas.find((x) => x.id === g) || {}).ordem || 99;
    return [...r.colunas].sort((a, b) => og(a.grupo) - og(b.grupo) || a.ordem - b.ordem);
  };
  const renumerar = () => { ordenadas().forEach((c, i) => { c.ordem = i + 1; }); };
  /* Ordem no formulário (rascunho): só as colunas ativas que se preenchem; a grade não muda */
  const doFormulario = () => ordenarParaFormulario(ordenadas().filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo)));
  const numerarFormulario = (lista) => { lista.forEach((c, i) => { c.ordemFormulario = i + 1; }); };
  let arrastandoForm = null;
  const desenhar = () => {
    $$("[data-aba-est]", d).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.abaEst === aba)));
    const alvo = $("#est-conteudo", d);
    if (aba === "colunas") {
      alvo.innerHTML = `<div class="form-botoes" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn btn-mini" data-est="nova-coluna">${svg("i-mais")}Nova coluna</button></div>
        <div class="tabela-admin"><table><thead><tr><th>Ordem</th><th>Nome</th><th>Tipo</th><th>Grupo</th><th>Regras</th><th>Situação</th><th></th></tr></thead><tbody>${ordenadas().map((c) => `<tr data-col="${escapar(c.id)}"${c.ativa ? "" : ' class="arquivada"'}>
          <td class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-est="subir" title="Subir" aria-label="Subir ${escapar(c.nome)}">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-est="descer" title="Descer" aria-label="Descer ${escapar(c.nome)}">${svg("i-seta-baixo")}</button></td>
          <td><strong>${escapar(c.nome)}</strong>${RE_LGPD.test(normalizar(c.nome)) ? ` <span class="selo-exclusao">LGPD?</span>` : ""}<div class="apoio" style="font-size:11px">id: ${escapar(c.id)}</div></td>
          <td>${escapar(NOME_TIPO[c.tipo])}</td><td>${escapar((r.gruposColunas.find((g) => g.id === c.grupo) || {}).nome || "")}</td>
          <td style="font-size:12px">${[TIPOS_SEM_EDICAO.includes(c.tipo) ? "" : NOME_ACESSO_CURTO[acessoDe(c)], c.obrigatoria && "obrigatória", c.unica && "única", c.padrao && `padrão: ${c.padrao}`].filter(Boolean).map(escapar).join(" · ")}</td>
          <td>${c.ativa ? "Ativa" : "Arquivada"}</td>
          <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-est="editar-coluna">${svg("i-lapis")}Editar</button>
            <button type="button" class="btn btn-secundario btn-mini" data-est="arquivar-coluna">${svg("i-arquivo")}${c.ativa ? "Arquivar" : "Reativar"}</button>
            ${original.colunas.some((x) => x.id === c.id) ? "" : `<button type="button" class="acao-linha" data-est="excluir-coluna" title="Tirar esta coluna nova" aria-label="Tirar a coluna nova ${escapar(c.nome)}">${svg("i-lixeira")}</button>`}</td></tr>`).join("") || `<tr><td colspan="7" class="apoio">Nenhuma coluna ainda. Use “Nova coluna”.</td></tr>`}</tbody></table></div>
        <p class="apoio" style="font-size:12px;margin-top:6px">As colunas valem para todas as planilhas de ${escapar(nomeAmbiente(estado.ambiente))}. Uma coluna que já existe não se exclui de vez (os dados das localidades continuam lá): use Arquivar.</p>`;
    } else if (aba === "formulario") {
      const lista = doFormulario();
      alvo.innerHTML = `<p class="apoio" style="margin:10px 0 8px">Ordem dos campos na janela “Novo registro” e na ficha: arraste (ou use as setas). Ficam 3 por linha no formulário; textos longos ocupam a linha inteira. A ordem da grade não muda.</p>
        <ol class="ordem-formulario">${lista.map((c, i) => `<li draggable="true" data-form-col="${escapar(c.id)}">
          <span class="pegador" aria-hidden="true">⋮⋮</span><span class="num">${i + 1}</span><strong>${escapar(c.nome)}</strong><span class="apoio">${escapar(NOME_TIPO[c.tipo])}${c.tipo === "textoLongo" || c.tipo === "etiquetas" ? " · linha inteira" : ""}</span>
          <span class="acoes-tab"><button type="button" class="acao-linha" data-est="form-subir" aria-label="Subir ${escapar(c.nome)} no formulário">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-est="form-descer" aria-label="Descer ${escapar(c.nome)} no formulário">${svg("i-seta-baixo")}</button></span></li>`).join("")}</ol>
        <div class="form-botoes" style="justify-content:flex-start;margin-top:10px"><button type="button" class="btn btn-secundario btn-mini" data-est="form-padrao">${svg("i-restaurar")}Restaurar padrão</button></div>`;
    } else if (aba === "grupos") {
      const gs = [...r.gruposColunas].sort((a, b) => a.ordem - b.ordem);
      alvo.innerHTML = `<div class="form-botoes" style="justify-content:flex-start;margin:10px 0"><button type="button" class="btn btn-mini" data-est="novo-grupo">${svg("i-mais")}Novo grupo</button></div>
        <div class="tabela-admin"><table><thead><tr><th>Ordem</th><th>Nome</th><th>Colunas</th><th></th></tr></thead><tbody>${gs.map((g) => `<tr data-grupo-est="${escapar(g.id)}">
          <td class="acoes-tab" style="justify-content:flex-start"><button type="button" class="acao-linha" data-est="grupo-subir" aria-label="Subir">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-est="grupo-descer" aria-label="Descer">${svg("i-seta-baixo")}</button></td>
          <td><input data-grupo-campo="nome" value="${escapar(g.nome)}" maxlength="60" aria-label="Nome do grupo"></td>
          <td>${r.colunas.filter((c) => c.grupo === g.id).length}</td>
          <td class="acoes-tab"><button type="button" class="acao-linha" data-est="excluir-grupo" aria-label="Excluir grupo">${svg("i-lixeira")}</button></td></tr>`).join("")}</tbody></table></div>`;
    } else {
      const listas = r.colunas.filter((c) => c.ativa && TIPOS_LISTA.includes(c.tipo) && c.tipo !== "etiquetas");
      const chaves = r.colunas.filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo) && !TIPOS_LISTA.includes(c.tipo) && !["booleano", "textoLongo"].includes(c.tipo));
      const sel = (campo, lista, vazio) => `<select data-regra="${campo}"><option value="">${escapar(vazio)}</option>${lista.map((c) => `<option value="${escapar(c.id)}"${r[campo] === c.id ? " selected" : ""}>${escapar(c.nome)}</option>`).join("")}</select>`;
      alvo.innerHTML = `<div class="campos-linha" style="margin-top:10px">
        <label class="campo"><span class="rotulo">Título da planilha</span><input data-regra="titulo" value="${escapar(r.titulo)}" maxlength="80"></label>
        <label class="campo"><span class="rotulo">A Equipe N2 edita</span><select data-regra="equipeEdita">${EQUIPE_EDITA.map((x) => `<option value="${x.id}"${r.regras.equipeEdita === x.id ? " selected" : ""}>${escapar(x.nome)}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Janela de edição (horas; 0 = sem limite)</span><input data-regra="janelaEdicaoHoras" type="number" min="0" max="8760" value="${escapar(r.regras.janelaEdicaoHoras)}"><span class="ajuda">Vale para “só as linhas que a própria pessoa registrou”.</span></label>
        <label class="check" style="align-self:center"><input type="checkbox" data-regra="exportacao"${r.regras.exportacao ? " checked" : ""}> A Equipe e a Equipe N2 podem exportar CSV</label></div>
        <p class="lgpd" style="margin-top:10px">No modo “próprias”, a pessoa edita o que registrou com o mesmo e-mail, em qualquer computador. A estrutura vale para TODAS as planilhas de ${escapar(nomeAmbiente(estado.ambiente))}.</p>
        <h3 style="font-size:15px;margin-top:14px">Chave, abas e resumo</h3>
        <div class="campos-linha" style="margin-top:8px">
          <label class="campo"><span class="rotulo">Coluna chave (valor único em cada planilha; com a chave composta, em cada seção)</span>${sel("colunaChave", chaves, "Nenhuma")}<span class="ajuda">Identifica o registro nas últimas mudanças, na busca e na importação (“atualizar pela chave”). O mesmo valor não se repete numa planilha (conferido no servidor). Para a Equipe N2, ela fica TRAVADA APÓS CRIAR.</span></label>
          <label class="campo"><span class="rotulo">Abas da planilha (opcional)</span>${sel("colunaAbas", listas, "Sem abas")}<span class="ajuda">Uma coluna de lista: cada opção vira uma aba.</span></label>
          <label class="campo"><span class="rotulo">Resumo dos cards das planilhas</span>${sel("colunaResumo", listas, "Primeira coluna de status")}<span class="ajuda">Contagem por opção (ex.: STATUS) nos cards do painel e no topo da planilha.</span></label>
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
    if (t.dataset.grupoCampo) { const g = r.gruposColunas.find((x) => x.id === t.closest("[data-grupo-est]").dataset.grupoEst); g.nome = t.value.slice(0, 60); }
    if (t.dataset.regra) {
      if (t.dataset.regra === "titulo") r.titulo = t.value.slice(0, 80);
      else if (t.dataset.regra === "exportacao") r.regras.exportacao = t.checked;
      else if (t.dataset.regra === "janelaEdicaoHoras") r.regras.janelaEdicaoHoras = Math.max(0, Math.min(8760, Math.floor(Number(t.value) || 0)));
      else if (["colunaChave", "colunaAbas", "colunaResumo"].includes(t.dataset.regra)) r[t.dataset.regra] = t.value;
      else r.regras[t.dataset.regra] = t.value;
    }
  });
  d.addEventListener("dragstart", (e) => {
    const li = e.target.closest && e.target.closest("[data-form-col]");
    if (!li) return;
    arrastandoForm = li.dataset.formCol;
    li.classList.add("arrastando");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", arrastandoForm);
  });
  d.addEventListener("dragover", (e) => {
    const li = e.target.closest && e.target.closest("[data-form-col]");
    if (!arrastandoForm || !li) return;
    e.preventDefault();
    $$(".ordem-formulario .alvo-soltar", d).forEach((x) => x.classList.remove("alvo-soltar"));
    li.classList.add("alvo-soltar");
  });
  d.addEventListener("drop", (e) => {
    const li = e.target.closest && e.target.closest("[data-form-col]");
    if (!arrastandoForm || !li) return;
    e.preventDefault();
    /* A coluna arrastada fica no lugar da coluna em que foi solta */
    const lista = doFormulario();
    const de = lista.findIndex((c) => c.id === arrastandoForm), para = lista.findIndex((c) => c.id === li.dataset.formCol);
    arrastandoForm = null;
    if (de < 0 || para < 0 || de === para) { desenhar(); return; }
    const [movida] = lista.splice(de, 1);
    lista.splice(para, 0, movida);
    numerarFormulario(lista);
    desenhar();
  });
  d.addEventListener("dragend", () => { arrastandoForm = null; $$(".ordem-formulario .arrastando, .ordem-formulario .alvo-soltar", d).forEach((x) => x.classList.remove("arrastando", "alvo-soltar")); });
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
    const linhaForm = b.closest("[data-form-col]");
    if ((a === "form-subir" || a === "form-descer") && linhaForm) {
      const lista = doFormulario();
      const i = lista.findIndex((c) => c.id === linhaForm.dataset.formCol), j = i + (a === "form-subir" ? -1 : 1);
      if (i >= 0 && j >= 0 && j < lista.length) { [lista[i], lista[j]] = [lista[j], lista[i]]; numerarFormulario(lista); desenhar(); $(`[data-form-col="${CSS.escape(lista[j].id)}"] [data-est="${a}"]`, d)?.focus(); }
    }
    if (a === "form-padrao") { numerarFormulario(ordemFormularioPadrao(ordenadas().filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo)))); desenhar(); }
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
      /* Só colunas novas (ainda não aplicadas): as que já existem têm dados nas localidades e só se arquivam */
      if (original.colunas.some((c) => c.id === col.id)) { mostrarAviso(`“${col.nome}” já existe nas planilhas: use Arquivar.`); return; }
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
    const fixa = false;
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
          <label class="campo"><span class="rotulo">Nome (rótulo)</span><input name="nome" value="${escapar(base.nome)}" maxlength="60" required${fixa ? ' readonly title="Coluna fixa: o nome não muda"' : ""}><span class="ajuda" id="aviso-lgpd-nome">${fixa ? "Coluna fixa da planilha de Software: nome, tipo e obrigatoriedade não mudam." : ""}</span></label>
          <label class="campo"><span class="rotulo">Tipo</span><select name="tipo"${base.origem === "categorias" || fixa ? " disabled" : ""}>${TIPOS.map((t) => `<option value="${t.id}"${base.tipo === t.id ? " selected" : ""}>${escapar(t.nome)}</option>`).join("")}</select></label>
          <label class="campo"><span class="rotulo">Grupo</span><select name="grupo">${[...r.gruposColunas].sort((a, b) => a.ordem - b.ordem).map((g) => `<option value="${escapar(g.id)}"${base.grupo === g.id ? " selected" : ""}>${escapar(g.nome)}</option>`).join("")}</select></label>
          <label class="campo"><span class="rotulo">Largura padrão (px)</span><input name="largura" type="number" min="60" max="600" value="${escapar(base.largura)}"></label>
          <label class="campo"><span class="rotulo">Valor padrão</span><input name="padrao" value="${escapar(base.padrao)}" maxlength="60"><span class="ajuda">Para datas, “hoje”; para data e hora, “agora”; para listas, o nome de uma opção.</span></label>
          <label class="campo"><span class="rotulo">Ajuda (aparece ao passar o mouse e no formulário)</span><input name="ajuda" value="${escapar(base.ajuda)}" maxlength="200"></label>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px 20px">
          <label class="check"><input type="checkbox" name="obrigatoria"${base.obrigatoria ? " checked" : ""}> Obrigatória</label>
          <label class="check"><input type="checkbox" name="unica"${base.unica ? " checked" : ""}> Valor único (não pode repetir)</label>
        </div>
        <label class="campo"><span class="rotulo">Acesso</span><select name="acesso"></select>
          <span class="ajuda">BLOQUEADO: só a Lays e a Paula alteram (a equipe vê com cadeado). LIVRE: toda a equipe edita, em qualquer linha. LISTA: a equipe só escolhe uma opção (não cria nem renomeia). TRAVADO APÓS CRIAR: a equipe preenche ao cadastrar; depois, só a Lays e a Paula alteram.</span></label>
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
        estado.equipamentos.forEach((t) => { const v = valorTexto(t, antesOriginal); String(v).split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => { if (!nomes.has(normalizar(x)) && cabeAtiva()) { nomes.add(normalizar(x)); opcoes.push({ id: "", nome: x.slice(0, 100), cor: "" }); } }); });
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
        if (o.id && antesOriginal && (antesOriginal.opcoes || []).some((x) => x.id === o.id)) { mostrarAviso("Esta opção já existe e pode estar em registros de outras planilhas: ela fica guardada como “removida da lista” para o nome não se perder.", 7000); return; }
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
      if (antesOriginal && antesOriginal.tipo !== tipo && !TIPOS_SEM_EDICAO.includes(tipo) && !TIPOS_SEM_EDICAO.includes(antesOriginal.tipo)) { erro.textContent = "No Cadeias, o tipo de uma coluna que já existe não muda (os valores estão em todas as planilhas). Crie uma coluna nova e arquive esta."; return; }
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
      if (fixa) Object.assign(final, { nome: base.nome, tipo: base.tipo, obrigatoria: true, ativa: true, opcoes: [] });
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
      if (acessoDe(a) !== acessoDe(c)) itens.push(`Coluna “${c.nome}”: acesso ${NOME_ACESSO_CURTO[acessoDe(a)]} → ${NOME_ACESSO_CURTO[acessoDe(c)]}`);
      if (a.obrigatoria !== c.obrigatoria || a.unica !== c.unica || a.padrao !== c.padrao) itens.push(`Regras da coluna “${c.nome}” alteradas`);
    });
    const sequencia = (lista, grupos) => {
      const og = (g) => (grupos.find((x) => x.id === g) || {}).ordem || 99;
      return [...lista].sort((x, y) => og(x.grupo) - og(y.grupo) || x.ordem - y.ordem).map((c) => c.id).filter((id) => original.colunas.some((c) => c.id === id) && r.colunas.some((c) => c.id === id)).join(",");
    };
    if (sequencia(original.colunas, original.gruposColunas) !== sequencia(r.colunas, r.gruposColunas)) itens.push("Ordem das colunas alterada");
    const seqFormulario = (lista, grupos) => {
      const og = (g) => (grupos.find((x) => x.id === g) || {}).ordem || 99;
      return ordenarParaFormulario([...lista].filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo)).sort((x, y) => og(x.grupo) - og(y.grupo) || x.ordem - y.ordem)).map((c) => c.id).join(",");
    };
    if (seqFormulario(original.colunas, original.gruposColunas) !== seqFormulario(r.colunas, r.gruposColunas)) itens.push("Ordem no formulário alterada (a grade não muda)");
    original.colunas.forEach((a) => { if (!r.colunas.some((c) => c.id === a.id)) itens.push(`Coluna “${a.nome}” excluída de vez`); });
    if (JSON.stringify(original.gruposColunas) !== JSON.stringify(r.gruposColunas)) itens.push("Grupos de colunas alterados");
    if (original.titulo !== r.titulo) itens.push(`Título: “${original.titulo}” → “${r.titulo}”`);
    const nomeCol = (id) => (id ? (r.colunas.find((c) => c.id === id) || { nome: id }).nome : "nenhuma");
    [["colunaChave", "Coluna chave"], ["colunaAbas", "Abas da planilha"], ["colunaResumo", "Resumo dos cards"]].forEach(([k, nome]) => {
      if ((original[k] || "") !== (r[k] || "")) itens.push(`${nome}: ${nomeCol(original[k])} → ${nomeCol(r[k])}`);
    });
    if (JSON.stringify(original.regras) !== JSON.stringify(r.regras)) itens.push(`Regras da equipe: a Equipe N2 edita ${EQUIPE_EDITA.find((x) => x.id === r.regras.equipeEdita).nome.toLowerCase()}; janela ${r.regras.janelaEdicaoHoras || "sem limite"}${r.regras.janelaEdicaoHoras ? " h" : ""}; exportação ${r.regras.exportacao ? "liberada" : "desligada"}`);
    return [...new Set(itens)];
  }
  /* Escritas de dados que as migrações pedem (só registros que mudam) */
  function opsMigracao(estruturaNova) {
    const colsNovas = Object.fromEntries(estruturaNova.colunas.map((c) => [c.id, c]));
    const colsAntigas = Object.fromEntries(original.colunas.map((c) => [c.id, c]));
    const ops = [], arquivo = new Map(), agora = new Date().toISOString();
    let afetados = 0;
    estado.equipamentos.forEach((t) => {
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
    const so_regras = itens.every((x) => /^(Título|Regras da equipe|Ordem no formulário|Coluna chave|Abas da planilha|Resumo dos cards)/.test(x)) && !migracoes.length;
    if (!(await confirmar(so_regras ? "Confira as mudanças:" : `Confira as mudanças. Antes de aplicar, é feito um backup automático (estrutura + ${estado.equipamentos.length} registros).`, {
      titulo: "Prévia das mudanças", botao: "Aplicar",
      html: `<ul class="lista-mudancas">${itens.map((x) => `<li>${escapar(x)}</li>`).join("")}${afetados ? `<li><strong>${afetados} registro(s) terão os dados ajustados.</strong></li>` : "<li><strong>Nenhum registro será alterado.</strong></li>"}</ul>`
    }))) return;
    if (!so_regras && !(await criarBackup(`Antes de mudar a estrutura (${itens.slice(0, 3).join("; ")}${itens.length > 3 ? "…" : ""})`))) return;
    try {
      if (ops.length) await estado.api.lote(ops);
      if (arquivo.size) await alterarArquivo(arquivo);
      await salvarEstrutura((novo));
      registrarAuditoria("estrutura", `Mudou a estrutura (versão ${novo.versao})`, itens.join(" · ").slice(0, 1500));
      if (!ops.length && !arquivo.size) {
        const anterior = JSON.parse(JSON.stringify(original));
        empilharDesfazer("Estrutura anterior restaurada", async () => { anterior.versao = estruturaDoAmbiente().versao + 1; await salvarEstrutura((anterior)); registrarAuditoria("estrutura", "Desfez a última mudança de estrutura"); });
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
/* Nomes equivalentes: sem acentos, maiúsculas, pontuação, espaços e palavras como "de"/"do" ("Nome usuário" = "NOME DO USUÁRIO") */
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
  const m = mapaEquipamentos();
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
  const afetados = () => estado.equipamentos.filter((t) => usa((t.campos || {})[col().id], form.de.value));
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
        const o = nova.colunas.find((x) => x.id === c.id).opcoes.find((y) => y.id === deId);
        if (o) Object.assign(o, { ativa: false, removidaEm: new Date().toISOString(), removidaPor: estado.usuario.email });
      }, `Removeu da lista a opção “${de.nome}” de ${c.nome}`);
    }
    progresso.textContent = textoResultadoConversao(r);
    if (r.ok) { d.close(); mostrarAviso(`Pronto: ${itens.length} registro(s) alterado(s).`, 6000); }
  });
  d.showModal();
}
/* Muda só opções da estrutura (voltar para a lista, recuperar nomes). Nenhum registro é regravado. */
async function salvarOpcoesDaEstrutura(mudar, resumo, detalhes = "") {
  const nova = JSON.parse(JSON.stringify(estado.estrutura));
  mudar(nova);
  nova.versao = estado.estrutura.versao + 1;
  const dados = dadosEstrutura(normalizarEstrutura(nova));
  if (!avisarTamanhoEstrutura(dados)) return false;
  try {
    await estado.api.salvarDoc(caminhoEstrutura(), dados, true);
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
  colunasAtivas().filter((c) => TIPOS_LISTA.includes(c.tipo) && !c.origem).forEach((col) => {
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
    estado.equipamentos.forEach((t) => {
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
      if (criar.length) { nova.versao = estado.estrutura.versao + 1; await salvarEstrutura((normalizarEstrutura(nova))); }
    } catch (err) { console.error(err); progresso.textContent = ""; mostrarAviso(mensagemErro(err)); return; }
    /* 2) Dados: troca o valor nos registros (arquivo e vivos) */
    const itens = [];
    trocas.forEach((x) => estado.equipamentos.forEach((t) => { if ((t.campos || {})[x.col] === x.de) itens.push([t.id, x.col, x.para]); }));
    progresso.textContent = `Gravando ${itens.length} alteração(ões)…`;
    const r = await converterEmLotes(itens, "corrigirLista", (feitos, total) => { progresso.textContent = `Gravando… ${feitos} de ${total}`; });
    registrarAuditoria("corrigirLista", `Corrigiu valores fora da lista: ${mapear.length} mapeado(s), ${criar.length} criado(s)`, `${itens.length - r.faltam} de ${itens.length} alteração(ões) gravada(s)`);
    progresso.textContent = textoResultadoConversao(r);
    if (r.ok) { d.close(); mostrarAviso(`Pronto: ${itens.length} registro(s) corrigido(s).`, 6000); }
  });
  d.showModal();
}
/* ------------------------------------------------------------
 *  Busca global (Ctrl+K): em todas as planilhas do ambiente aberto (abrirBuscaGlobal)
 * ------------------------------------------------------------ */
$("#btn-busca-rapida").innerHTML = svg("i-busca") + '<span>Buscar em tudo</span><kbd>Ctrl K</kbd>';
$("#btn-busca-rapida").addEventListener("click", () => abrirBuscaGlobal());
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !$("#app").hidden && !document.querySelector("dialog[open]")) { e.preventDefault(); abrirBuscaGlobal(); }
});

/* ------------------------------------------------------------
 *  Importação em lotes (administradoras): ~100 registros por vez, com progresso.
 *  Se a cota diária de gravações do plano gratuito acabar (ou a conexão cair), o que falta fica
 *  guardado neste navegador para Administração › "Continuar a importação".
 * ------------------------------------------------------------ */
const chaveImportacao = () => chaveUsuario("importacao-pendente");
const LOTE_IMPORTACAO = 100;
/* grupos: [[escritas de um registro], …] (registro, índice e histórico; refazer um lote não duplica nada) */
async function gravarImportacao(grupos, aoProgresso = () => {}) {
  let feitos = 0;
  const guardar = (resto) => (resto.length ? gravarLocal(chaveImportacao(), { em: new Date().toISOString(), grupos: resto }) : apagarLocal(chaveImportacao()));
  guardar(grupos);
  try {
    for (let i = 0; i < grupos.length; i += LOTE_IMPORTACAO) {
      await estado.api.lote(grupos.slice(i, i + LOTE_IMPORTACAO).flat());
      feitos = Math.min(grupos.length, i + LOTE_IMPORTACAO);
      guardar(grupos.slice(feitos));
      aoProgresso(feitos, grupos.length);
    }
    return { ok: true, feitos, faltam: 0 };
  } catch (e) {
    console.error(e);
    return { ok: false, feitos, faltam: grupos.length - feitos, cota: /resource-exhausted|quota/i.test((e && (e.code || e.message)) || "") };
  }
}
function textoResultadoImportacao(r) {
  if (r.ok) return `${r.feitos} registro(s) gravado(s).`;
  return r.cota
    ? `${r.feitos} gravado(s). O limite diário de gravações do plano gratuito acabou: faltam ${r.faltam}, guardados neste navegador. Amanhã, use Administração › “Continuar a importação”.`
    : `${r.feitos} gravado(s). A importação parou (sem conexão ou sem permissão): faltam ${r.faltam}. Use Administração › “Continuar a importação”.`;
}
async function continuarImportacao() {
  const p = lerLocal(chaveImportacao(), null);
  if (!p || !Array.isArray(p.grupos) || !p.grupos.length) { apagarLocal(chaveImportacao()); mostrarAviso("Não há importação pendente."); return; }
  mostrarAviso(`Continuando a importação: ${p.grupos.length} registro(s)…`, 60000);
  const r = await gravarImportacao(p.grupos, (feitos, total) => mostrarAviso(`Importando… ${feitos} de ${total}`, 60000));
  registrarAuditoria("importar", `Continuou a importação em ${planilhaAtual().nome}: ${r.feitos} de ${p.grupos.length} registro(s)`);
  mostrarAviso(textoResultadoImportacao(r), 9000);
}


/* Menu Administração (só Lays e Paula): o que vale para o ambiente e, com uma planilha aberta, o dela */
function abrirMenuAdmin(botao) {
  fecharPop();
  const naPlanilha = estado.tela === "localidade" && !!estado.estrutura;
  const amb = estado.ambiente;
  const pedidos = estado.equipamentos.filter((t) => t.exclusao).length;
  const pendente = naPlanilha ? lerLocal(chavePendente(), null) : null;
  const importacao = naPlanilha ? lerLocal(chaveImportacao(), null) : null;
  const pl = planilhaAtual();
  const itens = [
    ["comecar", "i-camadas", "Começar / configurar as cadeias"],
    ...(amb ? [
      ["ambiente", "i-ajustes", `Cadeia ${nomeAmbiente(amb)}: descrição e cor`],
      ["estrutura", "i-colunas", `Estrutura de ${nomeAmbiente(amb)} (colunas, listas e regras)`],
      ["localidades", "i-pasta", `Planilhas e grupos de ${nomeAmbiente(amb)}`],
      ["tribunais", "i-predio", "Criar estrutura de Tribunais e Órgãos"],
      ["copiar-estrutura", "i-copiar", `Copiar grupos, planilhas e seções para ${nomeAmbiente(outroAmbiente(amb))}`],
      ["importar-excel", "i-upload", "Importar Excel (abas ou planilha de divulgação)"]
    ] : []),
    ...(naPlanilha ? [
      ["sep", "", `Planilha: ${pl.nome}`],
      ["editar-planilha", "i-lapis", "Editar planilha (modo, seções, sistemas padrão)"],
      ["extras", "i-mais", "Colunas extras desta planilha"],
      ["fora", "i-alerta", "Corrigir valores fora da lista"],
      ["substituir", "i-ordenar", "Substituir valor nos registros"],
      ...(importacao && importacao.grupos && importacao.grupos.length ? [["continuar-importacao", "i-upload", `Continuar a importação (${importacao.grupos.length} pendente(s))`]] : []),
      ...(pendente && pendente.itens && pendente.itens.length ? [["continuar", "i-restaurar", `Continuar a conversão (${pendente.itens.length} pendente(s))`]] : []),
      ["pedidos", "i-alerta", `Pedidos de exclusão (${pedidos})`],
      ["lixeira", "i-lixeira", `Lixeira desta planilha (${estado.lixeira.length})`],
      ["backups", "i-salvar", "Backups desta planilha"],
      ["compactar", "i-tabela", `Compactar registros (${estado.vivos.filter((t) => !t.exclusao).length} fora do arquivo)`],
      ["recontar", "i-restaurar", "Recontar os números desta planilha"]
    ] : []),
    ["sep", "", "Geral"],
    ["pessoas", "i-pessoas", `Pessoas (${estado.identidades.length})${aguardando() ? ` · ${aguardando()} aguardando` : ""}`],
    ["lixeira-localidades", "i-arquivar", "Planilhas excluídas"],
    ["registro-auditoria", "i-historico", "Auditoria completa (linha do tempo)"],
    ["lado", "i-colunas", `Barra lateral ${(lerLocal(chaveLateral(), {}) || {}).lado === "direita" ? "à esquerda" : "à direita"} (preferência sua)`]
  ];
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.style.width = "320px";
  pop.setAttribute("role", "menu");
  pop.innerHTML = itens.map(([id, icone, nome]) => (id === "sep" ? `<p class="sep-menu" role="presentation">${escapar(nome)}</p>` : `<button type="button" class="item-menu" role="menuitem" data-adm="${id}">${svg(icone)}${escapar(nome)}</button>`)).join("");
  posicionarPop(pop, botao, 320);
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-adm]");
    if (!b) return;
    fecharPop();
    const a = b.dataset.adm;
    if (!conectado() && !["registro-auditoria"].includes(a)) { mostrarAviso("Sem conexão: a administração está bloqueada."); return; }
    if (a === "comecar") abrirAssistente();
    if (a === "ambiente") abrirConfigAmbiente(amb);
    if (a === "estrutura") abrirEstrutura();
    if (a === "localidades") abrirLocalidades();
    if (a === "tribunais") abrirEstruturaTribunais();
    if (a === "copiar-estrutura") copiarEstruturaPara(outroAmbiente(amb), amb);
    if (a === "editar-planilha") { const l = localidadePorId(estado.planilha); if (l) editarLocalidade(l, l.ambiente); }
    if (a === "lado") alternarLadoLateral();
    if (a === "importar-excel") abrirImportarExcel();
    if (a === "extras") abrirColunasExtras();
    if (a === "fora") abrirForaDaLista();
    if (a === "substituir") abrirSubstituirValor();
    if (a === "continuar") continuarConversao();
    if (a === "continuar-importacao") continuarImportacao();
    if (a === "pessoas") abrirPessoas();
    if (a === "pedidos") { estado.vista.especial = "exclusao"; salvarVista(); renderizarTudo(); }
    if (a === "lixeira") abrirLixeira();
    if (a === "backups") abrirBackups();
    if (a === "compactar") compactarArquivo();
    if (a === "recontar") recontarLocalidade({ avisar: true });
    if (a === "lixeira-localidades") abrirLocalidadesExcluidas();
    if (a === "registro-auditoria") navegar({ tela: "auditoria" });
  });
  pop.querySelector("button").focus();
}
const aguardando = () => estado.identidades.filter((i) => situacaoIdentidade(i) === "aguardando").length;
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
/* Cadastro por e-mail aguardando liberação: o aparelho ligado lê a identidade e entra assim que ela é liberada */
function mostrarPendenteIdentidade(uid, aparelho) {
  pararOuvintes();
  estado.usuario = null;
  estado.mensagemBloqueio = PENDENTE;
  mostrarBloqueio(PENDENTE);
  estado.pararOuvintes.push(estado.api.ouvirDoc(`${COL_IDENTIDADES}/${aparelho.email}`, (i) => {
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
/* A Equipe (só visualiza) não vê NENHUM botão de edição: ficam escondidos, não só desligados */
function atualizarBotoes() {
  const alimenta = podeAlimentar();
  $$("[data-editor]").forEach((b) => { b.hidden = !alimenta; });
  $$("[data-admin]").forEach((b) => { b.hidden = !ehAdmin() || !estado.estrutura; });
  $("#selo-visualizacao").hidden = !soVisualizacao() || !estado.estrutura;
  $("#btn-desfazer").disabled = !estado.desfazer.length;
  $("#menu-admin").hidden = !ehAdmin();
  $("#faixa-offline").hidden = !(estado.offline || (estado.usandoCopia && !estado.carregouEquipamentos));
  $("#btn-busca-rapida").hidden = !estado.usuario || !estado.ambiente || estado.tela === "escolha" || estado.tela === "auditoria";
  $("#btn-csv").hidden = !podeExportar();
  $("#btn-imprimir").hidden = !podeExportar();
}
const NOME_PAPEL = { admin: "Administradora", equipe: "Equipe N2", leitura: "Equipe" };
function atualizarTopo() {
  const u = estado.usuario;
  const admin = u.papel === "admin";
  /* Equipe: "Você: Nome" com o menu de identificação; administradora: nome e "Sair" */
  const botao = $("#btn-identidade");
  botao.hidden = admin;
  botao.innerHTML = `${svg("i-usuario")}<span>Você: ${escapar(u.nome)}</span>`;
  botao.title = u.email;
  botao.setAttribute("aria-label", `Você: ${u.nome} (${u.email}), perfil ${NOME_PAPEL[u.papel]}. Abrir opções de identificação`);
  $("#nome-usuario").hidden = !admin;
  $("#nome-usuario").textContent = u.nome || u.email;
  $("#nome-usuario").title = u.email;
  $("#btn-sair").hidden = !admin;
  const selo = $("#selo-papel");
  selo.textContent = NOME_PAPEL[u.papel];
  selo.title = { admin: "Tudo: estrutura, planilhas, pessoas e auditoria", equipe: "Vê e edita os registros de V6 e V12", leitura: "Só visualiza" }[u.papel];
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
  pop.innerHTML = `<p class="apoio" style="font-size:12px;overflow-wrap:anywhere">${escapar(estado.usuario.nome)}<br>${escapar(estado.usuario.email)}<br>Perfil: ${escapar(NOME_PAPEL[estado.usuario.papel])}</p>
    <p class="apoio" style="font-size:12px">Para corrigir o nome, o e-mail ou o perfil, fale com a Lays ou a Paula.</p>
    <p class="sep-menu" role="presentation">Preferências (neste navegador)</p>
    <button type="button" class="item-menu" role="menuitem" data-id-acao="lado">${svg("i-colunas")}Barra lateral ${(lerLocal(chaveLateral(), {}) || {}).lado === "direita" ? "à esquerda" : "à direita"}</button>
    <button type="button" class="item-menu" role="menuitem" data-id-acao="trocar">${svg("i-sair")}Trocar de pessoa</button>`;
  posicionarPop(pop, e.currentTarget, 260);
  pop.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-id-acao]");
    if (!b) return;
    fecharPop();
    if (b.dataset.idAcao === "lado") { alternarLadoLateral(); return; }
    if (b.dataset.idAcao === "trocar" && await confirmar("Trocar de pessoa? Você volta à tela de entrada. Para voltar a este cadastro, use “Continuar como…” ou digite o seu e-mail e nome de novo. As linhas que você registrou continuam ligadas ao seu e-mail.", { titulo: "Trocar de pessoa", botao: "Trocar de pessoa" })) {
      formRegistro.reset();
      consultaEmail.email = "";
      sair();
    }
  });
  pop.querySelector("button").focus();
});
$("#btn-marca").addEventListener("click", () => navegar({ tela: "escolha" }));
/* Ambiente ainda sem colunas: a administradora vai para o assistente; as outras pessoas veem um aviso */
function renderizarSemEstrutura() {
  const caixa = $("#sem-estrutura");
  const sem = estado.carregouEstrutura && (!estado.estrutura || !estado.estrutura.colunas.length);
  caixa.hidden = !sem;
  ["#resumo", "#abas", ".barra", "#area-dados"].forEach((s) => { $(s).hidden = sem; });
  if (!sem) return;
  caixa.innerHTML = ehAdmin()
    ? `<div class="cartao-login" style="margin:24px auto;text-align:center"><h2>${escapar(nomeAmbiente(estado.ambiente))} ainda não tem colunas</h2>
        <p class="apoio">Nenhuma coluna é criada sozinha: defina as colunas da cadeia (do zero, copiando da outra cadeia ou a partir da 1ª linha de um Excel). Elas valem para todas as planilhas.</p>
        <button type="button" class="btn" id="btn-criar-estrutura">${svg("i-camadas")}Abrir o assistente “Começar”</button></div>`
    : `<div class="cartao-login" style="margin:24px auto;text-align:center"><h2>Cadeia em preparação</h2><p class="apoio">As colunas de ${escapar(nomeAmbiente(estado.ambiente))} ainda não foram definidas. Fale com a Lays ou a Paula.</p></div>`;
  const b = $("#btn-criar-estrutura");
  if (b) b.addEventListener("click", () => abrirAssistente());
}

/* ------------------------------------------------------------
 *  Entrada da equipe (e-mail + nome, sem senha) e "Sou administradora" (e-mail e senha)
 *  Sobre um login anônimo do Firebase, este navegador vira um aparelho (cadeias-pessoas/{uid})
 *  ligado à identidade do e-mail (cadeias-identidades/{email}). Quem confere o nome são as
 *  regras do Firestore (vinculoCadeias): o app nunca lê o nome cadastrado de um e-mail.
 *  Os cadastros são só deste site: quem entra em outro site não entra aqui, e vice-versa.
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

/* Ao sair do campo E-mail: "Entrar" (tem cadastro) ou "Criar cadastro" (não tem). Lê só cadeias-emails/{email}. */
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
  const existe = !!(await estado.api.lerDoc(`${COL_EMAILS}/${email}`));
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
        await api.salvarDoc(`${COL_PESSOAS}/${u.uid}`, { email, nomeChave: chave, vinculadoEm: "__AGORA__", ultimoAcesso: "__AGORA__" }, true);
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
    const registro = normalizarRegistro(await api.lerDoc(`${COL_CONFIG}/entrada`));
    if (!registro.aberto) { esconderConfirmacao(); marcarErrosIdentidade({}, "Novos cadastros estão fechados no momento. Fale com a Lays ou a Paula."); return; }
    if (registro.dominios.length && !registro.dominios.includes(email.split("@")[1])) {
      esconderConfirmacao();
      marcarErrosIdentidade({ email: `Use o seu e-mail corporativo (${registro.dominios.map((d) => "@" + d).join(" ou ")}).` });
      return;
    }
    await api.lote([
      { op: "set", caminho: `${COL_IDENTIDADES}/${email}`, dados: { email, nome, nomeChave: chave, perfil: "equipe", ativo: true, aprovado: false, criadoEm: "__AGORA__", criadoPorUid: u.uid, atualizadoEm: "__AGORA__" } },
      { op: "set", caminho: `${COL_EMAILS}/${email}`, dados: {} },
      { op: "set", caminho: `${COL_PESSOAS}/${u.uid}`, mesclar: true, dados: { email, nomeChave: chave, vinculadoEm: "__AGORA__", ultimoAcesso: "__AGORA__" } }
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
  try { Object.keys(localStorage).filter((k) => k.startsWith(`${CHAVE_COPIA}:`)).forEach(apagarLocal); } catch (e) { /* sem localStorage */ }
  apagarLocal(CHAVE_ATIVIDADE);
  cacheDados.clear();
  try { sessionStorage.removeItem(CHAVE_ENTRADA); } catch (e) { /* sem sessionStorage */ }
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
  Object.assign(estado, { estrutura: null, carregouEstrutura: false, equipamentos: [], carregouEquipamentos: false, vivos: [], carregouVivos: false, arquivo: arquivoVazio(), carregouArquivo: false, vista: null, lixeira: [], desfazer: [], usandoCopia: false, selecionando: false, busca: "", visao: "padrao", celula: null, intervalo: null });
  cacheParte.clear();
  cacheBusca = new WeakMap();
  estado.selecionados.clear();
  estado.gruposFechados.clear();
  areaDados.innerHTML = "";
}
function pararOuvintes() {
  estado.pararOuvintes.forEach((f) => { try { f && f(); } catch (e) {} });
  estado.pararOuvintes = [];
  if (estado.pararTela) { try { estado.pararTela(); } catch (e) { /* já parado */ } estado.pararTela = null; }
  estado.tela = "";
  pararOuvintesPlanilha();
  if (typeof pararMudancasPainel === "function") pararMudancasPainel();
  if (typeof pararMudancasEscolha === "function") { pararMudancasEscolha(); estado.ultimasEscolha = null; }
  Object.assign(estado, { pessoas: [], identidades: [], ambientes: {}, carregouAmbientes: false, grupos: [], localidades: [], carregouLocalidades: false, entrada: null, planilha: "", primeiraRota: true });
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
    aparelho = await estado.api.lerDoc(`${COL_PESSOAS}/${u.uid}`);
    if (aparelho && aparelho.vinculadoEm && aparelho.email) identidade = await estado.api.lerDoc(`${COL_IDENTIDADES}/${aparelho.email}`);
  } catch (e) { semConexao = !/permission/.test((e && e.code) || ""); }
  if (semConexao) {
    const copia = lerLocal(CHAVE_COPIA, null);
    if (!copia || copia.id !== u.uid || !copia.vinculadoEm) { mostrarBloqueio({ titulo: "Sem conexão", texto: "Não foi possível abrir o Cadeias agora. Verifique a internet.", verificar: true }); return; }
    entrarComIdentidade(u.uid, { email: copia.email, vinculadoEm: copia.vinculadoEm }, { nome: copia.nome, email: copia.email, perfil: copia.perfil, ativo: true, aprovado: true }, { semConexao: true });
    return;
  }
  /* Aparelho sem cadastro deste site (ex.: só tem cadastro em outro site): vai para a tela de entrada */
  if (!aparelho || !aparelho.vinculadoEm) { estado.usuario = null; if (!entradaVisivel()) mostrarRegistro(); return; }
  rotaIdentidade(u.uid, aparelho, identidade);
}
/* Lê o aparelho deste navegador (e a identidade, se ligado) e leva para a tela certa */
async function abrirAparelho(uid) {
  const aparelho = await estado.api.lerDoc(`${COL_PESSOAS}/${uid}`);
  if (!aparelho || !aparelho.vinculadoEm) {
    const estavaDentro = !!estado.usuario;
    estado.usuario = null;
    mostrarRegistro(estavaDentro ? { aviso: "Este computador saiu do seu cadastro. Entre de novo com o seu e-mail e nome." } : {});
    return;
  }
  rotaIdentidade(uid, aparelho, await estado.api.lerDoc(`${COL_IDENTIDADES}/${aparelho.email}`));
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
  const perfil = perfilValido(identidade.perfil);
  estado.usuario = { id: uid, uid, email: identidade.email, nome: identidade.nome, perfil, papel: perfil === "equipe-n2" ? "equipe" : "leitura", vinculadoEm: aparelho.vinculadoEm || "" };
  lembrarConta(identidade.email, identidade.nome);
  const ultimo = Date.parse(aparelho.ultimoAcesso || "");
  if (!semConexao && (isNaN(ultimo) || Date.now() - ultimo > 3600000)) {
    estado.api.salvarDoc(`${COL_PESSOAS}/${uid}`, { ultimoAcesso: "__AGORA__" }, true).catch((e) => console.warn("ultimoAcesso:", e));
  }
  iniciarPlanilha();
  /* Bloqueio, perfil, nome corrigido e "Desconectar todos os aparelhos" valem na hora */
  estado.pararOuvintes.push(estado.api.ouvirDoc(`${COL_IDENTIDADES}/${identidade.email}`, (i) => {
    if (!estado.usuario || estado.usuario.uid !== uid) return;
    if (!i || i.ativo === false || !i.aprovado || desconectado(aparelho, i)) { rotaIdentidade(uid, aparelho, i); return; }
    const perfilNovo = perfilValido(i.perfil);
    if (perfilNovo === estado.usuario.perfil && i.nome === estado.usuario.nome) return;
    Object.assign(estado.usuario, { perfil: perfilNovo, papel: perfilNovo === "equipe-n2" ? "equipe" : "leitura", nome: i.nome });
    lembrarConta(i.email, i.nome);
    atualizarTopo(); atualizarBotoes(); agendarRender();
    mostrarRota(rotaDaUrl(), { substituir: true, recarregar: true });
  }, (e) => { console.warn("cadastro", e); if (/permission/.test((e && e.code) || "")) reconferirAcesso(); }));
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
function normalizarEquipamento(d) {
  const ex = d.exclusao && typeof d.exclusao === "object" && d.exclusao.motivo != null
    ? { motivo: String(d.exclusao.motivo), por: String(d.exclusao.por || ""), porNome: textoOuVazio(d.exclusao.porNome), porEmail: textoOuVazio(d.exclusao.porEmail), em: d.exclusao.em || "" } : null;
  return {
    id: d.id, campos: d.campos && typeof d.campos === "object" ? d.campos : {}, numero: typeof d.numero === "string" ? d.numero : "", dna: typeof d.dna === "string" ? d.dna : "",
    secao: typeof d.secao === "string" ? d.secao.slice(0, 40) : "",
    criadoPor: String(d.criadoPor || ""), criadoPorNome: textoOuVazio(d.criadoPorNome), criadoPorEmail: textoOuVazio(d.criadoPorEmail), criadoEm: d.criadoEm || "",
    atualizadoPor: String(d.atualizadoPor || ""), atualizadoPorNome: textoOuVazio(d.atualizadoPorNome), atualizadoPorEmail: textoOuVazio(d.atualizadoPorEmail), atualizadoEm: d.atualizadoEm || "",
    exclusao: ex, ...(d.parcial === true ? { parcial: true } : {}),
    /* VCORP/VCERT: id da importação que gravou o registro (para "Desfazer importação") */
    ...(typeof d.importacao === "string" && d.importacao ? { importacao: d.importacao } : {})
  };
}
let temporizadorCopia = 0;
function salvarCopia() {
  clearTimeout(temporizadorCopia);
  temporizadorCopia = setTimeout(() => {
    if (!estado.usuario || !estado.estrutura || !estado.carregouEquipamentos) return;
    /* O arquivo compactado não cabe no armazenamento do navegador: aí a cópia guarda só a identificação */
    gravarLocal(chaveCopia(), { id: estado.usuario.id, email: estado.usuario.email, nome: estado.usuario.nome, papel: estado.usuario.papel, perfil: estado.usuario.perfil || "", vinculadoEm: estado.usuario.vinculadoEm || "", salvaEm: new Date().toISOString(), planilha: planilhaAtual().id, estrutura: dadosEstruturaBackup(estado.estrutura), equipamentos: estado.arquivo.linhas.length ? null : estado.equipamentos });
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
 *  Localidade aberta: registros vivos + arquivo compactado (só da localidade; as outras não são lidas)
 * ------------------------------------------------------------ */
/* Índice da coluna chave, título da aba do navegador e textos que dependem da localidade aberta */
function marcarPlanilha() {
  atualizarIndices();
  $("#btn-novo").innerHTML = svg("i-mais") + escapar(TERMO.novo);
}

/* Sessão (depois de entrar): ambientes, grupos e localidades em tempo real (só os documentos, poucos),
   as pessoas (administradoras), o registro da entrada e a tela do endereço */
function iniciarPlanilha() {
  mostrarTela("app");
  atualizarTopo();
  const api = estado.api;
  const aoErro = (onde) => (e) => {
    console.warn(onde, e);
    if (/permission/.test((e && e.code) || "")) { if (ehAdmin()) sair({ titulo: "Acesso encerrado", texto: "Não foi possível conferir o seu acesso. Entre de novo." }); else reconferirAcesso(); }
  };
  const prontos = new Set();
  const pronto = (qual) => { prontos.add(qual); if (prontos.size === 3 && !estado.carregouLocalidades) { estado.carregouLocalidades = true; mostrarRota(rotaDaUrl(), { substituir: true }); } else if (estado.carregouLocalidades) aoMudarCadeias(qual); };
  AMBIENTES.forEach((a) => {
    estado.pararOuvintes.push(api.ouvirDoc(`${COL_AMBIENTES}/${a.id}`, (d) => {
      estado.ambientes[a.id] = d || null;
      if (AMBIENTES.every((x) => x.id in estado.ambientes)) { estado.carregouAmbientes = true; pronto("ambientes"); }
    }, aoErro("ambiente")));
  });
  estado.pararOuvintes.push(api.ouvirColecao(COL_GRUPOS, (lista) => { estado.grupos = lista; pronto("grupos"); }, aoErro("grupos")));
  estado.pararOuvintes.push(api.ouvirColecao(COL_LOCALIDADES, (lista) => { estado.localidades = lista.map(normalizarLocalidade); pronto("localidades"); }, aoErro("localidades")));
  if (ehAdmin()) {
    const aoMudar = () => { cacheBusca = new WeakMap(); atualizarBotaoAdmin(); atualizarBotoes(); if (estado.aoMudarPessoas) estado.aoMudarPessoas(); };
    estado.pararOuvintes.push(api.ouvirColecao(COL_PESSOAS, (lista) => { estado.pessoas = lista; aoMudar(); }, (e) => console.warn("pessoas", e)));
    estado.pararOuvintes.push(api.ouvirColecao(COL_IDENTIDADES, (lista) => { estado.identidades = lista; aoMudar(); }, (e) => console.warn("identidades", e)));
    estado.pararOuvintes.push(api.ouvirDoc(`${COL_CONFIG}/entrada`, (d) => { estado.entrada = d; }, (e) => console.warn("entrada", e)));
  }
  registrarEntrada();
}
/* Abre a localidade (estado.planilha): estrutura do ambiente + colunas extras, registros vivos, arquivo
   compactado e (administradoras) a lixeira. Os números do painel não dependem disto. */
function abrirPlanilha() {
  pararOuvintesPlanilha();
  fecharPop();
  fecharCombo();
  if (!ficha.hidden) fecharFicha();
  $("#busca").value = "";
  if (aparencia) aparencia.aoTrocarPlanilha();
  const api = estado.api;
  const pl = planilhaAtual();
  aplicarEstruturaDaLocalidade();
  estado.carregouEstrutura = true;
  marcarPlanilha();
  const copia = lerLocal(chaveCopia(), null);
  if (copia && copia.id === estado.usuario.id && Array.isArray(copia.equipamentos) && copia.planilha === pl.id) {
    estado.equipamentos = copia.equipamentos.map(normalizarEquipamento);
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
  /* A planilha só aparece depois que os registros vivos e o arquivo compactado chegaram */
  const aoChegarEquipamentos = () => {
    if (!estado.carregouVivos || !estado.carregouArquivo) return;
    combinarEquipamentos();
    estado.carregouEquipamentos = true;
    estado.usandoCopia = false;
    if (!navigator.onLine) estado.offline = true; else estado.offline = false;
    atualizarBotoes();
    salvarCopia();
    agendarRender();
    renderizarCabecaLocalidade();
    if (aparencia) aparencia.aoMudarDados();
    conferirContadores();
    if (estado.aoCarregarPlanilha) { const f = estado.aoCarregarPlanilha; estado.aoCarregarPlanilha = null; setTimeout(f, 50); }
    const fid = ficha.dataset.id;
    if (!ficha.hidden && fid) {
      if (!porId(fid)) fecharFicha();
      else if (!ficha.dataset.editando && ficha.classList.contains("aberta") && !ficha.contains(document.activeElement)) abrirFicha(fid);
    }
  };
  ouvir(api.ouvirColecao(P(), (lista) => {
    const anteriores = estado.carregouVivos ? new Map(estado.vivos.map((t) => [t.id, JSON.stringify([t.campos, t.exclusao])])) : null;
    const novos = lista.map(normalizarEquipamento);
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
    aoChegarEquipamentos();
  }, aoErro("registros")));
  ouvir(api.ouvirColecao(ARQ(), (lista) => {
    aplicarArquivo(lista);
    estado.carregouArquivo = true;
    aoChegarEquipamentos();
  }, aoErro("arquivo")));
  if (ehAdmin()) ouvir(api.ouvirColecao(`${COL_LIXEIRA}`, (lista) => { estado.lixeira = lista.filter(daPlanilhaAtual); if (estado.aoMudarLixeira) estado.aoMudarLixeira(); }, (e) => console.warn("lixeira", e)));
}
/* Estrutura do ambiente + colunas extras da localidade aberta (refeita quando um dos dois documentos muda) */
function aplicarEstruturaDaLocalidade() {
  const doc = estado.ambientes[planilhaAtual().ambiente];
  const e = doc && doc.configurado ? normalizarEstrutura(doc, localidadePorId(estado.planilha)) : (doc ? normalizarEstrutura({ ...estruturaVazia(planilhaAtual().ambiente), ...doc }) : null);
  aplicarEstrutura(e);
  atualizarIndices();
}
/* ============================================================
 *  CADEIAS V6 / V12
 *  Escolha da cadeia › painel do ambiente (localidades na barra lateral) › planilha da localidade.
 *  Só a localidade aberta tem os registros lidos; o painel usa os contadores de cada planilha.
 * ============================================================ */
const CHAVE_ENTRADA = "cadeias-entrada-registrada";
const DIA_MS = 86400000;
/* Registros de outras planilhas (busca global): lidos só quando a pessoa pede, guardados 5 minutos */
const cacheDados = new Map();
const TEMPO_CACHE = 5 * 60000;
estado.tela = "";
estado.primeiraRota = true;
const COR_PADRAO = { v6: "#1f5f8b", v12: "#2e7d32" };
const CORES_AMBIENTE = ["#1f5f8b", "#2e7d32", "#6b4c9a", "#b45309", "#ad1457", "#00796b", "#c62828", "#37474f"];
const RE_COR = /^#[0-9a-f]{6}$/i;
const corAmbiente = (amb) => { const d = estado.ambientes[amb]; return d && RE_COR.test(d.cor || "") ? d.cor : COR_PADRAO[amb] || "#1f5f8b"; };
const descricaoAmbiente = (amb) => txt((estado.ambientes[amb] || {}).descricao, 200);
const ambienteConfigurado = (amb) => !!(estado.ambientes[amb] && estado.ambientes[amb].configurado && Array.isArray(estado.ambientes[amb].colunas) && estado.ambientes[amb].colunas.length);
const ICONES_LOCALIDADE = [["i-pino", "Ponto"], ["i-predio", "Prédio"], ["i-loja", "Loja"], ["i-casa", "Casa"], ["i-bandeira", "Bandeira"], ["i-servidor", "Servidor"], ["i-estrela", "Estrela"], ["i-pasta", "Pasta"]];
const chavePessoa = (nome) => `cadeias-${nome}:${idLocal()}`;

/* ---------- Localidades e grupos ---------- */
function normalizarLocalidade(d) {
  const hoje = d.hoje && typeof d.hoje === "object" ? { dia: txt(d.hoje.dia, 10), n: Math.max(0, Number(d.hoje.n) || 0) } : null;
  return {
    id: d.id, ambiente: ehAmbiente(d.ambiente) ? d.ambiente : "v6", grupo: String(d.grupo || ""), nome: txt(d.nome, 80) || "(sem nome)",
    uf: txt(d.uf, 2).toUpperCase(), codigo: txt(d.codigo, 40), responsavel: txt(d.responsavel, 80),
    cor: CORES.includes(d.cor) ? d.cor : "", icone: ICONES_LOCALIDADE.some(([i]) => i === d.icone) ? d.icone : "i-pino",
    ordem: Number(d.ordem) || 0, observacao: txt(d.observacao, 200), ativa: d.ativa !== false,
    colunasExtras: Array.isArray(d.colunasExtras) ? d.colunasExtras : [],
    contagem: Math.max(0, Number(d.contagem) || 0), resumo: d.resumo && typeof d.resumo === "object" ? d.resumo : {}, hoje,
    atualizadoEm: d.atualizadoEm || "", atualizadoPor: String(d.atualizadoPor || ""), atualizadoPorNome: typeof d.atualizadoPorNome === "string" ? d.atualizadoPorNome : "",
    criadoEm: d.criadoEm || "",
    /* Planilha: "sistema" (lista simples) ou "estado" (dividida em seções, uma por estado/região) */
    modo: d.modo === "estado" ? "estado" : "sistema",
    secoes: normalizarSecoes(d.secoes),
    sistemasPadrao: normalizarSistemas(d.sistemasPadrao),
    sigla: txt(d.sigla, 12).trim(), nomeCompleto: txt(d.nomeCompleto, 120).trim()
  };
}
/* Seções: [{ id, nome, sigla }] (id: letras minúsculas, números e "-"; até 60 por planilha) */
const MAX_SECOES = 60, MAX_SISTEMAS_PADRAO = 30;
const RE_ID_SECAO = /^[a-z0-9-]{1,20}$/;
function normalizarSecoes(lista) {
  const vistos = new Set();
  return (Array.isArray(lista) ? lista : []).filter((s) => s && RE_ID_SECAO.test(s.id || "") && !vistos.has(s.id) && vistos.add(s.id))
    .map((s) => ({ id: s.id, nome: txt(s.nome, 80).trim() || s.id.toUpperCase(), sigla: txt(s.sigla, 12).trim() })).slice(0, MAX_SECOES);
}
function normalizarSistemas(lista) {
  const vistos = new Set();
  return (Array.isArray(lista) ? lista : []).map((x) => txt(x, 80).trim().replace(/\s+/g, " ")).filter((x) => x && !vistos.has(nomeComparavel(x)) && vistos.add(nomeComparavel(x))).slice(0, MAX_SISTEMAS_PADRAO);
}
/* "Supremo Tribunal Federal (STF)" (título) e o nome sem a sigla ("Supremo Tribunal Federal") */
const tituloPlanilha = (l) => (!l ? "" : l.sigla && l.nomeCompleto && nomeComparavel(l.sigla) !== nomeComparavel(l.nomeCompleto) ? `${l.nomeCompleto} (${l.sigla})` : l.nomeCompleto || l.nome);
const nomeCurtoPlanilha = (l) => (!l ? "" : l.nomeCompleto || l.nome);
const porEstado = (l) => !!l && l.modo === "estado";
const secaoPorId = (l, id) => (l && id ? l.secoes.find((s) => s.id === id) || null : null);
const nomeDaSecao = (l, id) => { const s = secaoPorId(l, id); return s ? s.nome : id ? `Seção removida (${id})` : ""; };
/* Seção onde entra um registro novo: a escolhida por último ("+ sistema nesta seção", formulários), senão a primeira */
function secaoParaNovo() {
  const l = localidadePorId(estado.planilha);
  if (!porEstado(l) || !l.secoes.length) return "";
  return secaoPorId(l, estado.secaoNova) ? estado.secaoNova : l.secoes[0].id;
}
const SEM_GRUPO = "__sem-grupo";
const gruposDe = (amb) => estado.grupos.filter((g) => g.ambiente === amb).sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || COMPARAR(String(a.nome || ""), String(b.nome || "")));
const grupoPorId = (id) => estado.grupos.find((g) => g.id === id) || null;
const nomeDoGrupo = (id) => (grupoPorId(id) || { nome: "Sem grupo" }).nome || "Sem grupo";
const ordenarLocalidades = (lista) => [...lista].sort((a, b) => a.ordem - b.ordem || COMPARAR(a.nome, b.nome));
const localidadesDe = (amb, { arquivadas = false } = {}) => ordenarLocalidades(estado.localidades.filter((l) => l.ambiente === amb && (arquivadas || l.ativa)));
/* Localidades de um ambiente por grupo, na ordem dos grupos (as sem grupo válido ficam em "Sem grupo", no fim) */
function arvoreDe(amb, { arquivadas = false } = {}) {
  const locs = localidadesDe(amb, { arquivadas });
  const grupos = gruposDe(amb).map((g) => ({ id: g.id, nome: g.nome || "(sem nome)", locs: locs.filter((l) => l.grupo === g.id) }));
  const soltas = locs.filter((l) => !grupos.some((g) => g.id === l.grupo));
  if (soltas.length) grupos.push({ id: SEM_GRUPO, nome: "Sem grupo", locs: soltas });
  return grupos;
}
/* Nome no endereço (#v6/<nome>): sem acentos; se dois nomes derem o mesmo, entra o começo do id */
/* Planilha com sigla única na cadeia: #v6/stf; sem sigla, o nome (#v6/sao-paulo-barueri). O endereço antigo pelo nome continua abrindo. */
function slugLocalidade(l) {
  const sigla = l.sigla ? slug(l.sigla, 20) : "";
  if (sigla && !estado.localidades.some((x) => x.id !== l.id && x.ambiente === l.ambiente && (x.sigla ? slug(x.sigla, 20) : slug(x.nome, 60)) === sigla)) return sigla;
  const base = slug(l.nome, 60);
  return estado.localidades.some((x) => x.id !== l.id && x.ambiente === l.ambiente && slug(x.nome, 60) === base) ? `${base}-${l.id.slice(0, 6).toLowerCase()}` : base;
}
const localidadePorSlug = (amb, s) => estado.localidades.find((l) => l.ambiente === amb && slugLocalidade(l) === s)
  || estado.localidades.find((l) => l.ambiente === amb && slug(l.nome, 60) === s) || estado.localidades.find((l) => l.ambiente === amb && l.id === s) || null;
/* Seção pelo endereço: id ("ac"), sigla ou nome sem acentos ("acre-ac") */
const secaoPorSlug = (l, s) => (!l || !s ? null : l.secoes.find((x) => x.id === s) || l.secoes.find((x) => x.sigla && slug(x.sigla, 20) === s) || l.secoes.find((x) => slug(x.nome, 60) === s) || null);
const mesmaLocalidadeEm = (amb, l) => (l ? localidadesDe(amb).find((x) => (l.sigla && x.sigla && nomeComparavel(x.sigla) === nomeComparavel(l.sigla)) || nomeComparavel(x.nome) === nomeComparavel(l.nome)) || null : null);
/* "hoje às 14:32", "ontem às 09:10" ou "12/10/2026 às 10:00" (Brasília) */
function textoQuando(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = partesBrasilia(d), dia = dataIsoBrasilia(iso), hoje = hojeIso(), ontem = dataIsoBrasilia(new Date(Date.now() - DIA_MS));
  const hora = `${p.hora}:${p.minuto}`;
  return dia === hoje ? `hoje às ${hora}` : dia === ontem ? `ontem às ${hora}` : `${p.dia}/${p.mes}/${p.ano} às ${hora}`;
}
function textoHaQuanto(iso) {
  const ms = Date.now() - Date.parse(iso || "");
  if (isNaN(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d < 31 ? `há ${d} dia${d === 1 ? "" : "s"}` : formatarData(iso);
}
/* Indicador de atividade: verde (atualizada hoje), amarelo (mais de 30 dias sem atualização), cinza (vazia) */
function atividadeDe(l) {
  if (!l.contagem) return { classe: "cinza", texto: "Vazia" };
  if (l.atualizadoEm && dataIsoBrasilia(l.atualizadoEm) === hojeIso()) return { classe: "verde", texto: "Atualizada hoje" };
  if (!l.atualizadoEm || Date.now() - Date.parse(l.atualizadoEm) > 30 * DIA_MS) return { classe: "amarelo", texto: "Mais de 30 dias sem atualização" };
  return { classe: "", texto: "" };
}
const textoAtualizacao = (l) => (l.atualizadoEm ? `${textoQuando(l.atualizadoEm)}${l.atualizadoPorNome ? ` por ${l.atualizadoPorNome}` : ""}` : "sem atualização");
const alteradosHoje = (l) => (l.hoje && l.hoje.dia === hojeIso() ? l.hoje.n : 0);
/* Favoritas: por pessoa, neste navegador */
const favoritas = () => { const v = lerLocal(chavePessoa("favoritas"), []); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; };
const ehFavorita = (id) => favoritas().includes(id);
function alternarFavorita(id) {
  const lista = favoritas();
  gravarLocal(chavePessoa("favoritas"), lista.includes(id) ? lista.filter((x) => x !== id) : [id, ...lista].slice(0, 50));
  renderizarBarraLateral();
  if (estado.tela === "localidade") renderizarCabecaLocalidade();
}
/* ---------- Gravação: contadores da localidade e "Últimas mudanças" no MESMO lote de cada mudança ----------
   Todo estado.api.lote() passa por aqui. As escritas são separadas por registro (um registro nunca fica
   dividido entre dois lotes); em cada lote entram também:
   - o espelho de cada evento de histórico em cadeias-historico (as últimas mudanças do ambiente);
   - os contadores da localidade (contagem, resumo, alterados hoje, última atualização), com "__SOMAR__".
   Equipe N2: até 5 registros por lote (as regras leem no máximo 20 documentos por pedido).
   As administradoras ainda conferem a contagem exata ao abrir a localidade (conferirContadores). */
const RE_CAMINHO_REG = /^cadeias-localidades\/([^/]+)\/registros\/([^/]+)$/;
const RE_CAMINHO_HIST = /^cadeias-localidades\/([^/]+)\/registros\/([^/]+)\/historico\/[^/]+$/;
const RE_CAMINHO_CHAVE = /^cadeias-localidades\/([^/]+)\/chaves\//;
const RE_CAMINHO_ARQ = /^cadeias-localidades\/[^/]+\/arquivo\//;
let sequenciaHistorico = 0;
const ordemHistorico = (amb) => `${amb}|${String(Date.now()).padStart(13, "0")}|${String(++sequenciaHistorico % 10000).padStart(4, "0")}`;
const colResumoDe = (amb) => { const e = estruturaDoAmbiente(amb); const c = e.colunaResumo ? e.colunas.find((x) => x.id === e.colunaResumo) : e.colunas.find((x) => x.ativa && x.tipo === "status"); return c ? c.id : ""; };
function grupoDaOp(o, atual) {
  let m = RE_CAMINHO_REG.exec(o.caminho) || RE_CAMINHO_HIST.exec(o.caminho);
  if (m) return `${m[1]}/${m[2]}`;
  m = RE_CAMINHO_CHAVE.exec(o.caminho);
  if (m && o.dados && o.dados.registro) return `${m[1]}/${o.dados.registro}`;
  if (o.caminho.startsWith(`${COL_LIXEIRA}/`) && estado.planilha && !o.caminho.startsWith(`${COL_LIXEIRA}/loc-`)) return `${estado.planilha}/${o.caminho.split("/")[1]}`;
  return atual;
}
function dividirLote(ops) {
  const grupos = [];
  let atual = null;
  ops.forEach((o) => {
    const g = grupoDaOp(o, atual ? atual.chave : null);
    if (!atual || (g && g !== atual.chave)) { atual = { chave: g, ops: [] }; grupos.push(atual); }
    atual.ops.push(o);
  });
  const maxRegistros = ehAdmin() ? 200 : 5, maxOps = 220;
  const lotes = [];
  let lote = [], registros = 0;
  grupos.forEach((g) => {
    const temRegistro = !!g.chave;
    if (lote.length && (lote.length + g.ops.length > maxOps || (temRegistro && registros >= maxRegistros))) { lotes.push(lote); lote = []; registros = 0; }
    if (g.ops.length > maxOps) { for (let i = 0; i < g.ops.length; i += maxOps) lotes.push(g.ops.slice(i, i + maxOps)); return; }
    lote.push(...g.ops);
    if (temRegistro) registros++;
  });
  if (lote.length) lotes.push(lote);
  return lotes;
}
const valorDoResumo = (campos, c) => { const v = (campos || {})[c]; return typeof v === "string" && v && v !== "__APAGAR__" ? v : ""; };
function camposDepois(loc, reg, o) {
  const antes = loc === estado.planilha ? porId(reg) : null;
  const novos = (o.dados && o.dados.campos) || {};
  return o.mesclar || o.dados.parcial ? { ...((antes && antes.campos) || {}), ...novos } : novos;
}
function comExtras(ops) {
  if (!estado.usuario) return ops;
  const extras = [], porLoc = new Map();
  const info = (loc) => { if (!porLoc.has(loc)) porLoc.set(loc, { regs: new Set(), delta: 0, resumo: new Map(), ultimo: "" }); return porLoc.get(loc); };
  const somar = (x, op, n) => { if (op) x.resumo.set(op, (x.resumo.get(op) || 0) + n); };
  const comArquivo = ops.some((o) => RE_CAMINHO_ARQ.test(o.caminho));
  const regSet = new Map();
  ops.forEach((o) => { const m = RE_CAMINHO_REG.exec(o.caminho); if (m && o.op === "set") regSet.set(m[2], o); });
  const espelho = (loc, reg, h, campos) => {
    const l = localidadePorId(loc), amb = l ? l.ambiente : estado.ambiente;
    extras.push({ op: "set", caminho: `${COL_HISTORICO}/${estado.api.novoId(COL_HISTORICO)}`, dados: {
      ambiente: amb, localidade: loc, localidadeNome: txt(l ? l.nome : "", 80), registro: reg,
      registroNome: txt(alvoRegistro({ id: reg }, campos || {}, estruturaDoAmbiente(amb)), 120),
      acao: txt(h.acao, 30), coluna: txt(h.coluna, 40), colunaNome: txt(h.colunaNome, 60), antes: txt(h.antes, 500), depois: txt(h.depois, 500),
      por: estado.usuario.id, porNome: txt(estado.usuario.nome, 80), ordem: ordemHistorico(amb), em: "__AGORA__"
    } });
  };
  ops.forEach((o) => {
    let m = RE_CAMINHO_REG.exec(o.caminho);
    if (m) {
      const [, loc, reg] = m, x = info(loc);
      const c = colResumoDe((localidadePorId(loc) || { ambiente: estado.ambiente }).ambiente);
      if (o.op === "set") {
        x.regs.add(reg); x.ultimo = reg;
        const antes = loc === estado.planilha ? porId(reg) : null;
        const novo = !o.mesclar && o.dados && o.dados.criadoEm === "__AGORA__" && !o.dados.parcial;
        if (novo) x.delta++;
        if (c) {
          const vNovo = valorDoResumo(camposDepois(loc, reg, o), c), vAntes = antes ? valorDoResumo(antes.campos, c) : "";
          if (novo || !antes) somar(x, vNovo, 1);
          else if (vNovo !== vAntes) { somar(x, vAntes, -1); somar(x, vNovo, 1); }
        }
      } else if (o.op === "delete" && !comArquivo && !ops.some((y) => y.op === "set" && y.caminho === `${COL_LIXEIRA}/${reg}`)) {
        const antes = loc === estado.planilha ? porId(reg) : null;
        x.delta--; x.regs.add(reg);
        if (c && antes) somar(x, valorDoResumo(antes.campos, c), -1);
      }
      return;
    }
    m = RE_CAMINHO_HIST.exec(o.caminho);
    if (m && o.op === "set") {
      const [, loc, reg] = m;
      const so = regSet.get(reg);
      const antes = loc === estado.planilha ? porId(reg) : null;
      espelho(loc, reg, o.dados, so ? camposDepois(loc, reg, so) : antes ? antes.campos : {});
      if (o.dados.acao === "restaurar" && !(so && so.dados && so.dados.criadoEm === "__AGORA__")) info(loc).delta++;
      info(loc).regs.add(reg);
      return;
    }
    /* Mandar para a Lixeira: "excluiu" nas últimas mudanças e um a menos na contagem */
    if (o.op === "set" && o.caminho.startsWith(`${COL_LIXEIRA}/`) && o.dados && o.dados.dados && !o.dados.tipo) {
      const loc = o.dados.planilha, reg = o.caminho.split("/")[1];
      if (!loc) return;
      const x = info(loc);
      x.delta--; x.regs.add(reg);
      const c = colResumoDe((localidadePorId(loc) || { ambiente: estado.ambiente }).ambiente);
      if (c) somar(x, valorDoResumo(o.dados.dados.campos, c), -1);
      espelho(loc, reg, { acao: "excluir", depois: txt(o.dados.motivo, 300) }, o.dados.dados.campos);
    }
  });
  porLoc.forEach((x, loc) => {
    if (!x.regs.size || !localidadePorId(loc)) return;
    const l = localidadePorId(loc), dia = hojeIso();
    const dados = { atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.id, atualizadoPorNome: txt(estado.usuario.nome, 80), ultimoRegistro: x.ultimo || [...x.regs].pop() };
    if (x.delta) dados.contagem = `__SOMAR__:${x.delta}`;
    dados.hoje = l.hoje && l.hoje.dia === dia ? { dia, n: `__SOMAR__:${x.regs.size}` } : { dia, n: x.regs.size };
    const resumo = [...x.resumo].filter(([, n]) => n);
    if (resumo.length) dados.resumo = Object.fromEntries(resumo.map(([op, n]) => [op, `__SOMAR__:${n}`]));
    extras.push({ op: "set", caminho: LOC(loc), mesclar: true, dados });
  });
  return extras.length ? [...ops, ...extras] : ops;
}
function instalarLoteDasCadeias(api) {
  const original = api.lote.bind(api);
  api.lote = async (ops) => { for (const parte of dividirLote(ops)) await original(comExtras(parte)); };
}
/* Contagem e resumo exatos da localidade aberta (as administradoras corrigem ao abrir) */
function contadoresExatos() {
  const c = colResumoDe(planilhaAtual().ambiente), resumo = {};
  if (c) estado.equipamentos.forEach((t) => { const v = valorDoResumo(t.campos, c); if (v) resumo[v] = (resumo[v] || 0) + 1; });
  return { contagem: estado.equipamentos.length, resumo };
}
let temporizadorContadores = 0;
function conferirContadores() {
  if (!ehAdmin() || !conectado() || !estado.carregouEquipamentos || !estado.planilha) return;
  clearTimeout(temporizadorContadores);
  temporizadorContadores = setTimeout(() => recontarLocalidade({ avisar: false }), 2500);
}
async function recontarLocalidade({ avisar = false } = {}) {
  const l = localidadePorId(estado.planilha);
  if (!l || !ehAdmin() || !estado.carregouEquipamentos) return;
  const { contagem, resumo } = contadoresExatos();
  const mesmo = l.contagem === contagem && Object.keys({ ...l.resumo, ...resumo }).every((k) => (Number(l.resumo[k]) || 0) === (resumo[k] || 0));
  if (mesmo) { if (avisar) mostrarAviso(`Os números já estão certos: ${contagem} registro(s).`); return; }
  const apagar = Object.fromEntries(Object.keys(l.resumo).filter((k) => !(k in resumo)).map((k) => [k, "__APAGAR__"]));
  try {
    await estado.api.salvarDoc(LOC(l.id), { contagem, resumo: { ...apagar, ...resumo } }, true);
    if (avisar) mostrarAviso(`Números de ${l.nome} recontados: ${contagem} registro(s).`);
  } catch (e) { console.warn("contadores", e); if (avisar) mostrarAviso(mensagemErro(e)); }
}

/* ---------- Rotas: #v6 · #v12 · #v6/<localidade>?linha=<id>&busca=<texto> · #auditoria · (vazio = escolha) ---------- */
function rotaDaUrl() {
  const h = location.hash.replace(/^#/, "");
  const [caminho, qs] = h.split("?");
  const p = new URLSearchParams(qs || "");
  const partes = caminho.split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  if (partes[0] === "auditoria") return { tela: "auditoria" };
  const amb = String(partes[0] || "").toLowerCase();
  if (ehAmbiente(amb)) {
    if (partes[1]) {
      const l = localidadePorSlug(amb, partes[1]);
      const s = l && partes[2] ? secaoPorSlug(l, partes[2]) : null;
      return l ? { tela: "localidade", ambiente: amb, localidade: l.id, secao: s ? s.id : "", linha: p.get("linha") || "", busca: p.get("busca") || "", ...(partes[2] && !s ? { secaoNaoAchada: partes[2] } : {}) } : { tela: "painel", ambiente: amb, naoAchou: partes[1] };
    }
    return { tela: "painel", ambiente: amb, status: p.get("status") || "" };
  }
  return { tela: "escolha" };
}
function urlDaRota(r) {
  const base = location.pathname + location.search;
  if (r.tela === "painel") return `${base}#${r.ambiente}${r.status ? `?status=${encodeURIComponent(r.status)}` : ""}`;
  if (r.tela === "localidade") {
    const l = localidadePorId(r.localidade), q = new URLSearchParams();
    if (r.linha) q.set("linha", r.linha);
    if (r.busca) q.set("busca", r.busca);
    const s = r.secao && l ? secaoPorId(l, r.secao) : null;
    return `${base}#${r.ambiente}/${encodeURIComponent(l ? slugLocalidade(l) : r.localidade)}${s ? `/${encodeURIComponent(s.id)}` : ""}${q.toString() ? `?${q}` : ""}`;
  }
  if (r.tela === "auditoria") return `${base}#auditoria`;
  return base;
}
function navegar(r) {
  if (!estado.usuario) return;
  history.pushState({ cadeias: true }, "", urlDaRota(r));
  mostrarRota(r);
}
window.addEventListener("popstate", () => { if (estado.usuario && !$("#app").hidden) mostrarRota(rotaDaUrl()); });
/* Depois de entrar, a tela de escolha sempre aparece (#v6 ou #v12 no endereço abrem direto) */
function mostrarRota(r, { substituir = false, recarregar = false } = {}) {
  if (!estado.usuario || !estado.carregouLocalidades) return;
  if (r.tela === "auditoria" && !ehAdmin()) { mostrarAviso("A auditoria completa é só das administradoras."); r = { tela: "escolha" }; substituir = true; }
  if (r.naoAchou) mostrarAviso(`Planilha “${r.naoAchou}” não encontrada em ${nomeAmbiente(r.ambiente)}.`, 5000);
  if (r.secaoNaoAchada) mostrarAviso(`Seção “${r.secaoNaoAchada}” não encontrada nesta planilha.`, 5000);
  estado.filtroPainel = r.tela === "painel" ? r.status || "" : "";
  estado.primeiraRota = false;
  if (substituir) history.replaceState({ cadeias: true }, "", urlDaRota(r));
  fecharPop();
  fecharCombo();
  if (estado.pararTela) { try { estado.pararTela(); } catch (e) { /* já parado */ } estado.pararTela = null; }
  const anterior = estado.tela;
  estado.tela = r.tela;
  const noAmbiente = r.tela === "painel" || r.tela === "localidade";
  $("#tela-escolha").hidden = r.tela !== "escolha";
  $("#tela-auditoria").hidden = r.tela !== "auditoria";
  $("#area-ambiente").hidden = !noAmbiente;
  $("#tela-painel").hidden = r.tela !== "painel";
  $("#conteudo-planilha").hidden = r.tela !== "localidade";
  if (r.tela !== "localidade" && estado.planilha) { if (!ficha.hidden) fecharFicha(); pararOuvintesPlanilha(); estado.planilha = ""; }
  definirAmbiente(noAmbiente ? r.ambiente : r.tela === "auditoria" ? estado.ambiente : "");
  if (r.tela === "localidade") {
    if (recarregar || estado.planilha !== r.localidade) {
      if (!ficha.hidden) fecharFicha();
      estado.planilha = r.localidade;
      ordemCongelada.assinatura = "";
      abrirPlanilha();
    }
    renderizarCabecaLocalidade();
    if (r.linha || r.busca) destacarNaLocalidade(r);
    else if (r.secao) { const ir = () => rolarParaSecao(r.secao); if (estado.carregouEquipamentos && estado.estrutura) setTimeout(ir, 30); else estado.aoCarregarPlanilha = ir; }
  } else if (r.tela === "painel") renderizarPainel();
  else if (r.tela === "escolha") renderizarEscolha();
  else if (r.tela === "auditoria") renderizarTelaAuditoria();
  if (r.tela !== "painel") pararMudancasPainel();
  if (r.tela !== "escolha") { pararMudancasEscolha(); estado.ultimasEscolha = null; }
  renderizarBarraLateral();
  renderizarMigalhas(r);
  atualizarBotoes();
  fecharGaveta();
  if (anterior !== r.tela) window.scrollTo({ top: 0 });
}
/* Abre a localidade já filtrada (busca) e com a linha destacada */
function destacarNaLocalidade(r) {
  const aplicar = () => {
    if (r.busca) { estado.busca = r.busca; $("#busca").value = r.busca; }
    if (r.linha && porId(r.linha) && estado.vista) {
      estado.vista.aba = "todos"; estado.vista.especial = "";
      estado.piscar.set(r.linha, Date.now() + 6000);
    }
    renderizarTudo();
    if (r.linha && porId(r.linha)) setTimeout(() => { irPara(r.linha); setTimeout(agendarRender, 6200); }, 80);
    else if (r.linha) mostrarAviso("Esse registro não está mais nesta planilha.");
  };
  if (estado.carregouEquipamentos && estado.estrutura) aplicar(); else estado.aoCarregarPlanilha = aplicar;
}
/* Ambiente aberto: cor de destaque, faixa colorida com o nome e o seletor V6 | V12 */
function definirAmbiente(amb) {
  const mudou = estado.ambiente !== amb;
  estado.ambiente = amb;
  const raiz = document.documentElement;
  if (amb) {
    raiz.dataset.ambiente = amb;
    raiz.style.setProperty("--cor-ambiente", corAmbiente(amb));
    try { localStorage.setItem(CHAVE_ULTIMO_AMBIENTE, amb); } catch (e) { /* sem localStorage */ }
  } else { delete raiz.dataset.ambiente; raiz.style.removeProperty("--cor-ambiente"); }
  if (mudou && aparencia && estado.tela !== "localidade") aparencia.aoTrocarPlanilha();
  renderizarFaixaAmbiente();
}
function renderizarFaixaAmbiente() {
  const amb = estado.ambiente, faixa = $("#faixa-ambiente"), sel = $("#seletor-ambiente");
  const noAmbiente = !!amb && (estado.tela === "painel" || estado.tela === "localidade");
  faixa.hidden = !noAmbiente;
  sel.hidden = !noAmbiente;
  if (!noAmbiente) return;
  faixa.innerHTML = `<strong>CADEIA ${escapar(nomeAmbiente(amb))}</strong>${descricaoAmbiente(amb) ? `<span>${escapar(descricaoAmbiente(amb))}</span>` : ""}`;
  sel.innerHTML = AMBIENTES.map((a) => `<button type="button" role="radio" aria-checked="${a.id === amb}" data-trocar-ambiente="${a.id}" style="--cor-botao:${escapar(corAmbiente(a.id))}" title="${escapar(`Trocar para ${a.nome}${estado.tela === "localidade" ? " (mantendo a planilha, se existir lá)" : ""}`)}">${escapar(a.nome)}</button>`).join("");
}
$("#seletor-ambiente").addEventListener("click", (e) => { const b = e.target.closest("[data-trocar-ambiente]"); if (b) trocarAmbiente(b.dataset.trocarAmbiente); });
$("#seletor-ambiente").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  trocarAmbiente(outroAmbiente(estado.ambiente));
  setTimeout(() => { const b = $(`[data-trocar-ambiente="${estado.ambiente}"]`); if (b) b.focus(); }, 30);
});
/* Troca V6 ↔ V12 mantendo a localidade de mesmo nome aberta (se existir lá) */
function trocarAmbiente(amb) {
  if (!ehAmbiente(amb) || amb === estado.ambiente) return;
  if (estado.tela === "localidade") {
    const igual = mesmaLocalidadeEm(amb, localidadePorId(estado.planilha));
    if (igual) { navegar({ tela: "localidade", ambiente: amb, localidade: igual.id }); return; }
    mostrarAviso(`“${(localidadePorId(estado.planilha) || {}).nome || "Esta planilha"}” não existe em ${nomeAmbiente(amb)}: abrindo o início de ${nomeAmbiente(amb)}.`, 5000);
  }
  navegar({ tela: "painel", ambiente: amb });
}
/* Mudou um ambiente, um grupo ou uma planilha (tempo real): redesenha só o que depende disso */
let assinaturaEstrutura = "";
function aoMudarCadeias() {
  renderizarFaixaAmbiente();
  renderizarBarraLateral();
  if (estado.aoMudarLocalidades) estado.aoMudarLocalidades();
  if (estado.tela === "escolha") renderizarEscolha();
  if (estado.tela === "painel") renderizarPainel();
  if (estado.tela === "localidade") {
    const l = localidadePorId(estado.planilha);
    if (!l) { mostrarAviso("Esta planilha foi excluída ou movida."); navegar({ tela: "painel", ambiente: estado.ambiente }); return; }
    const doc = estado.ambientes[l.ambiente] || {};
    const assinatura = JSON.stringify([doc.versao, doc.atualizadoEm, l.colunasExtras, l.modo]);
    if (assinatura !== assinaturaEstrutura) {
      assinaturaEstrutura = assinatura;
      aplicarEstruturaDaLocalidade();
      renderizarSemEstrutura();
      atualizarBotoes();
      agendarRender();
    }
    /* Seções renomeadas, reordenadas ou novas: a grade e a lateral acompanham */
    const assSecoes = JSON.stringify([l.secoes, l.sigla, l.nomeCompleto]);
    if (assSecoes !== estado.assinaturaSecoes) { estado.assinaturaSecoes = assSecoes; cacheBusca = new WeakMap(); agendarRender(); }
    renderizarCabecaLocalidade();
  }
}


/* ---------- Escolha a cadeia: dois cards grandes (setas + Enter) ---------- */
const STATUS_FORA_DO_CARTAO = new Set(["nao integrado", "sistema descontinuado", "nao tem login com certificado"]);
function resumoDoAmbiente(amb) {
  const locs = localidadesDe(amb);
  const registros = locs.reduce((s, l) => s + l.contagem, 0);
  const ultima = locs.filter((l) => l.atualizadoEm).sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)))[0] || null;
  const hoje = locs.reduce((s, l) => s + alteradosHoje(l), 0);
  /* Soma dos contadores por status (coluna do resumo) de todas as planilhas: sem ler nenhum registro */
  const e = estruturaDoAmbiente(amb), c = e.colunas.find((x) => x.id === colResumoDe(amb));
  const porStatus = new Map();
  locs.forEach((l) => Object.entries(l.resumo || {}).forEach(([id, n]) => { if (Number(n) > 0) porStatus.set(id, (porStatus.get(id) || 0) + Number(n)); }));
  const status = (c ? [...opcoesDe(c).filter((o) => porStatus.has(o.id)).map((o) => ({ o, n: porStatus.get(o.id) })), ...[...porStatus].filter(([id]) => !opcao(c, id)).map(([id, n]) => ({ o: { id, nome: id, cor: "" }, n }))] : [])
    .filter((x) => !STATUS_FORA_DO_CARTAO.has(normalizarNomeChave(x.o.nome)));
  const grupos = arvoreDe(amb).filter((g) => g.locs.length).map((g) => ({ nome: g.nome, n: g.locs.length }));
  return { locs, registros, ultima, hoje, status, colStatus: c, grupos, nGrupos: gruposDe(amb).length };
}
/* Fundo da escolha: elos de corrente e camadas em baixa opacidade (SVG no próprio HTML, sem imagem externa) */
const FUNDO_ESCOLHA = `<svg class="fundo-escolha" aria-hidden="true" focusable="false"><defs>
  <pattern id="padrao-elos" width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
    <rect x="12" y="20" width="44" height="22" rx="11" fill="none" stroke="currentColor" stroke-width="3"/>
    <rect x="44" y="20" width="44" height="22" rx="11" fill="none" stroke="currentColor" stroke-width="3"/>
    <path d="M14 84 l26 -12 l26 12 l-26 12 z M14 94 l26 12 l26 -12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
  </pattern></defs><rect width="100%" height="100%" fill="url(#padrao-elos)"/></svg>`;
let pararUltimasEscolha = null;
function pararMudancasEscolha() { if (pararUltimasEscolha) { try { pararUltimasEscolha(); } catch (e) { /* já parado */ } pararUltimasEscolha = null; } }
function renderizarEscolha() {
  const tela = $("#tela-escolha");
  const ultimo = localStorage.getItem(CHAVE_ULTIMO_AMBIENTE);
  const nada = !AMBIENTES.some((a) => estado.ambientes[a.id]);
  const focado = document.activeElement && tela.contains(document.activeElement) ? document.activeElement.dataset.escolher || "" : "";
  tela.style.setProperty("--cor-v6", corAmbiente("v6"));
  tela.style.setProperty("--cor-v12", corAmbiente("v12"));
  const n = (v) => Number(v || 0).toLocaleString("pt-BR");
  tela.innerHTML = `${FUNDO_ESCOLHA}<div class="escolha-conteudo">
    <header class="escolha-cabeca"><h1 id="escolha-titulo" class="titulo-sistema">Escolha a cadeia</h1>
      <p class="apoio">Olá, ${escapar(estado.usuario.nome)}. Use as setas e Enter, ou clique. No topo, o seletor V6 | V12 troca de cadeia a qualquer momento.</p></header>
    ${ehAdmin() && nada ? `<div class="aviso-comecar">${svg("i-camadas")}<div><strong>Primeira vez por aqui?</strong><p class="apoio">Crie a estrutura de Tribunais e Órgãos (grupos, planilhas, seções e as colunas dos dois ciclos) ou use o assistente.</p></div><button type="button" class="btn" data-escolha="tribunais">${svg("i-predio")}Criar estrutura de Tribunais e Órgãos</button><button type="button" class="btn btn-secundario" data-escolha="comecar">Começar</button></div>` : ""}
    <div class="cards-cadeia" role="group" aria-label="Cadeias">
      ${AMBIENTES.map((a) => {
        const r = resumoDoAmbiente(a.id);
        const pronto = ambienteConfigurado(a.id);
        const total = r.status.reduce((s, x) => s + x.n, 0);
        return `<article class="card-cadeia${a.id === ultimo ? " ultima" : ""}" style="--cor-card:${escapar(corAmbiente(a.id))}" data-card-ambiente="${a.id}">
          <span class="card-cadeia-faixa" aria-hidden="true"></span>
          <button type="button" class="card-cadeia-alvo" data-escolher="${a.id}" aria-describedby="desc-${a.id} num-${a.id}"><span class="sr-only">Entrar na ${escapar(a.nome)}</span></button>
          <div class="card-cadeia-topo"><span class="card-cadeia-nome" aria-hidden="true">${escapar(a.nome)}</span>${a.id === ultimo ? '<span class="selo selo-ultima">Última escolha</span>' : ""}</div>
          <p class="card-cadeia-desc" id="desc-${a.id}">${escapar(descricaoAmbiente(a.id) || (pronto ? `Cadeia ${a.nome}` : "Ainda não configurada"))}</p>
          <dl class="card-cadeia-numeros" id="num-${a.id}">
            <div><dt>grupos</dt><dd>${n(r.nGrupos)}</dd></div><div><dt>planilhas</dt><dd>${n(r.locs.length)}</dd></div>
            <div><dt>sistemas</dt><dd>${n(r.registros)}</dd></div><div><dt>atualizados hoje</dt><dd>${n(r.hoje)}</dd></div>
          </dl>
          ${total ? `<div class="card-cadeia-status"><p class="rotulo">${escapar(r.colStatus ? r.colStatus.nome : "Status")}</p>
            <div class="barra-segmentada" role="group" aria-label="${escapar(`${r.colStatus ? r.colStatus.nome : "Status"} em ${a.nome} (clique para ver as planilhas)`)}">${r.status.map((x) => `<button type="button" class="segmento${x.o.cor ? ` cor-${x.o.cor}` : ""}" style="flex-grow:${x.n}" data-status-ambiente="${a.id}" data-status="${escapar(x.o.id)}" title="${escapar(`${x.o.nome}: ${n(x.n)} (abrir ${a.nome} filtrado)`)}"><span class="sr-only">${escapar(`${x.o.nome}: ${n(x.n)}`)}</span></button>`).join("")}</div>
            <ul class="legenda-status">${r.status.slice(0, 6).map((x) => `<li><button type="button" class="btn-link" data-status-ambiente="${a.id}" data-status="${escapar(x.o.id)}"><span class="ponto-cor${x.o.cor ? ` cor-${x.o.cor}` : ""}"></span>${escapar(x.o.nome)} <strong>${n(x.n)}</strong></button></li>`).join("")}</ul></div>` : ""}
          ${r.grupos.length ? `<p class="card-cadeia-grupos">${r.grupos.map((g) => `<span>${escapar(g.nome)} <strong>${n(g.n)}</strong></span>`).join('<span aria-hidden="true"> · </span>')}</p>` : ""}
          <p class="card-cadeia-ultima">${r.ultima ? `Última atualização: ${escapar(textoQuando(r.ultima.atualizadoEm))}${r.ultima.atualizadoPorNome ? ` por ${escapar(r.ultima.atualizadoPorNome)}` : ""}` : "Sem atualizações ainda"}</p>
          <span class="btn card-cadeia-entrar" aria-hidden="true">Entrar na ${escapar(a.nome)}${svg("i-seta-direita")}</span>
        </article>`;
      }).join("")}
    </div>
    ${veMudancas() ? `<section class="escolha-mudancas" aria-labelledby="titulo-escolha-mudancas"><h2 id="titulo-escolha-mudancas">${svg("i-atividade")}Últimas atualizações <span class="apoio">V6 e V12</span></h2>
      <ol class="lista-mudancas-cadeias lista-escolha" id="mudancas-escolha"><li class="apoio">Carregando…</li></ol></section>`
      : `<section class="escolha-ajuda"><h2>${svg("i-info")}Como usar</h2><p class="apoio">Escolha a cadeia (V6 ou V12) e, na barra lateral, o grupo e a planilha. Nas planilhas por estado, cada estado é uma seção: clique no nome para recolher ou expandir. O seu acesso é de visualização: dá para buscar, filtrar e exportar; quem edita é a Equipe N2.</p></section>`}
  </div>`;
  const alvo = focado || (ehAmbiente(ultimo) ? ultimo : "v6");
  const foco = $(`[data-escolher="${alvo}"]`, tela);
  if (foco && !document.querySelector("dialog[open]") && (focado || !document.activeElement || document.activeElement === document.body)) foco.focus();
  if (veMudancas()) ouvirMudancasEscolha();
  if (ehAdmin() && nada && !estado.assistenteMostrado) { estado.assistenteMostrado = true; setTimeout(abrirEstruturaTribunais, 300); }
}
function ouvirMudancasEscolha() {
  const desenhar = (lista, falhou) => { const el = $("#mudancas-escolha"); if (el) el.innerHTML = falhou ? '<li class="apoio">Não foi possível carregar as últimas atualizações.</li>' : htmlMudancas(lista.slice(0, 5), true); };
  if (pararUltimasEscolha) { if (estado.ultimasEscolha) desenhar(estado.ultimasEscolha); return; }
  pararUltimasEscolha = ouvirUltimasMudancas(true, "", (lista) => { estado.ultimasEscolha = lista; desenhar(lista); }, (e) => { console.warn("últimas", e); desenhar([], true); });
}
$("#tela-escolha").addEventListener("click", (e) => {
  const st = e.target.closest("[data-status-ambiente]");
  if (st) { navegar({ tela: "painel", ambiente: st.dataset.statusAmbiente, status: st.dataset.status }); return; }
  const m = e.target.closest("[data-mudanca]");
  if (m) { abrirMudanca(m.dataset.mudanca); return; }
  if (e.target.closest('[data-escolha="comecar"]')) { abrirAssistente(); return; }
  if (e.target.closest('[data-escolha="tribunais"]')) { abrirEstruturaTribunais(); return; }
  const card = e.target.closest("[data-card-ambiente]");
  if (card && !e.target.closest("a, button:not([data-escolher])")) navegar({ tela: "painel", ambiente: card.dataset.cardAmbiente });
});
$("#tela-escolha").addEventListener("keydown", (e) => {
  const b = e.target.closest("[data-escolher]");
  if (!b || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  e.preventDefault();
  const outro = $(`[data-escolher="${outroAmbiente(b.dataset.escolher)}"]`, $("#tela-escolha"));
  if (outro) outro.focus();
});

/* ---------- Barra lateral: busca, favoritas e a árvore Grupo › Planilha ---------- */
const chaveLateral = () => chavePessoa("lateral");
const chaveGruposFechados = () => chavePessoa(`grupos-fechados-${estado.ambiente}`);
let buscaLateral = "";
/* Item da planilha: sigla em destaque + nome completo, ícone do modo (⊞ por estado / ≡ por sistema), contagem e atividade.
   Planilha por estado aberta: as seções aparecem logo abaixo (recolhíveis; clicar rola até a seção). */
const chaveSecoesLateral = () => chavePessoa("secoes-lateral-fechadas");
function itemLocalidade(l, { mostrarGrupo = false, secoesAchadas = null } = {}) {
  const at = atividadeDe(l);
  const atual = estado.tela === "localidade" && estado.planilha === l.id;
  const modo = porEstado(l) ? "por estado" : "por sistema";
  const mostrarSecoes = porEstado(l) && l.secoes.length && (secoesAchadas ? secoesAchadas.length : atual && !mostrarGrupo);
  const fechadas = new Set(lerLocal(chaveSecoesLateral(), []) || []);
  const aberto = secoesAchadas ? true : !fechadas.has(l.id);
  const contagemSecao = (s) => (atual && estado.carregouEquipamentos ? estado.equipamentos.filter((t) => t.secao === s.id).length : null);
  const nomeVisivel = l.sigla && nomeComparavel(l.sigla) !== nomeComparavel(nomeCurtoPlanilha(l)) ? `<b class="sigla-planilha">${escapar(l.sigla)}</b><span class="nome-completo">${escapar(nomeCurtoPlanilha(l))}</span>` : escapar(nomeCurtoPlanilha(l));
  return `<li><div class="linha-item-localidade"><a href="${escapar(urlDaRota({ tela: "localidade", ambiente: l.ambiente, localidade: l.id }))}" class="item-localidade${l.ativa ? "" : " arquivada"}" data-loc="${escapar(l.id)}"${atual ? ' aria-current="page"' : ""} title="${escapar([tituloPlanilha(l), modo, at.texto, `${l.contagem} sistema(s)`, l.ativa ? "" : "Arquivada"].filter(Boolean).join(" · "))}">
    <span class="ponto-atividade${at.classe ? ` ${at.classe}` : ""}" aria-hidden="true"></span><span class="modo-planilha" title="${escapar(modo)}" aria-hidden="true">${porEstado(l) ? "⊞" : "≡"}</span>
    <span class="nome-localidade">${nomeVisivel}${mostrarGrupo ? `<small>${escapar(nomeDoGrupo(l.grupo))}</small>` : ""}</span><span class="n">${l.contagem.toLocaleString("pt-BR")}</span></a>
    ${mostrarSecoes && !secoesAchadas ? `<button type="button" class="btn-secoes-lateral" data-secoes-lateral="${escapar(l.id)}" aria-expanded="${aberto}" aria-label="${aberto ? "Recolher" : "Mostrar"} as seções de ${escapar(tituloPlanilha(l))}">${svg("i-chevron-baixo", "icone seta-grupo")}</button>` : ""}</div>
    ${mostrarSecoes && aberto ? `<ul class="secoes-lateral" aria-label="Seções de ${escapar(tituloPlanilha(l))}">${(secoesAchadas || l.secoes).map((s) => { const n = contagemSecao(s); return `<li><a href="${escapar(urlDaRota({ tela: "localidade", ambiente: l.ambiente, localidade: l.id, secao: s.id }))}" class="item-secao" data-loc="${escapar(l.id)}" data-ir-secao="${escapar(s.id)}"><span>${escapar(s.nome)}</span>${n != null ? `<span class="n">${n}</span>` : ""}</a></li>`; }).join("")}</ul>` : ""}</li>`;
}
function alternarLadoLateral() {
  gravarLateral((c) => { c.lado = c.lado === "direita" ? "esquerda" : "direita"; });
  renderizarBarraLateral();
  agendarAjuste();
  mostrarAviso(`Barra lateral à ${(lerLocal(chaveLateral(), {}) || {}).lado === "direita" ? "direita" : "esquerda"} (só neste navegador).`);
}
function renderizarBarraLateral() {
  const lateral = $("#barra-lateral");
  const amb = estado.ambiente;
  if (!amb || !(estado.tela === "painel" || estado.tela === "localidade")) { lateral.innerHTML = ""; return; }
  const cfg = lerLocal(chaveLateral(), {}) || {};
  $("#area-ambiente").classList.toggle("lateral-recolhida", !!cfg.recolhida);
  $("#area-ambiente").classList.toggle("lateral-direita", cfg.lado === "direita");
  $("#area-ambiente").style.setProperty("--largura-lateral", `${Math.max(220, Math.min(460, Number(cfg.largura) || 280))}px`);
  const fechados = new Set(lerLocal(chaveGruposFechados(), []) || []);
  const termo = normalizar(buscaLateral.trim());
  /* A busca encontra grupo, planilha (nome, sigla, nome completo) e seção */
  const secoesQuePassam = (l) => (termo && porEstado(l) ? l.secoes.filter((s) => normalizar(`${s.nome} ${s.sigla} ${s.id}`).includes(termo)) : []);
  const passa = (l) => !termo || normalizar(`${l.nome} ${l.sigla} ${l.nomeCompleto} ${l.uf} ${l.codigo} ${l.responsavel} ${nomeDoGrupo(l.grupo)}`).includes(termo) || secoesQuePassam(l).length > 0;
  const arvore = arvoreDe(amb, { arquivadas: ehAdmin() && !!cfg.arquivadas });
  const locsPorId = new Map(localidadesDe(amb).map((l) => [l.id, l]));
  const favs = favoritas().map((id) => locsPorId.get(id)).filter(Boolean).filter(passa);
  const ativa = lateral.querySelector("#busca-localidade") === document.activeElement;
  const total = arvore.reduce((s, g) => s + g.locs.filter(passa).length, 0);
  const direita = cfg.lado === "direita";
  lateral.innerHTML = `<div class="lateral-topo">
      <label class="busca"><span class="sr-only">Buscar grupo, planilha, sigla ou seção</span>${svg("i-busca")}<input type="search" id="busca-localidade" placeholder="Grupo, planilha, sigla ou seção…" autocomplete="off" value="${escapar(buscaLateral)}"></label>
      <button type="button" class="btn-icone" data-lateral="recolher" aria-label="${cfg.recolhida ? "Mostrar a barra das planilhas" : "Recolher a barra das planilhas"}" title="${cfg.recolhida ? "Mostrar" : "Recolher"}">${svg(cfg.recolhida ? (direita ? "i-recolher" : "i-expandir") : (direita ? "i-expandir" : "i-recolher"))}</button>
    </div>
    <div class="lateral-corpo">
      <a href="${escapar(urlDaRota({ tela: "painel", ambiente: amb }))}" class="item-inicio" data-ir-painel${estado.tela === "painel" ? ' aria-current="page"' : ""}>${svg("i-grade")}<span>Início de ${escapar(nomeAmbiente(amb))}</span></a>
      ${favs.length ? `<section class="lateral-secao"><h2>${svg("i-estrela")}Favoritas</h2><ul>${favs.map((l) => itemLocalidade(l, { mostrarGrupo: true })).join("")}</ul></section>` : ""}
     <nav class="lateral-arvore" aria-label="Grupos e planilhas de ${escapar(nomeAmbiente(amb))}">
        ${arvore.map((g) => {
          const grupoPassa = termo && normalizar(g.nome).includes(termo);
          const locs = grupoPassa ? g.locs : g.locs.filter(passa);
          if (termo && !locs.length) return "";
          const aberto = termo ? true : !fechados.has(g.id);
          const soma = g.locs.reduce((s, l) => s + l.contagem, 0);
          return `<div class="grupo-lateral"><button type="button" class="grupo-lateral-botao" data-grupo-lateral="${escapar(g.id)}" aria-expanded="${aberto}" title="${escapar(`${g.locs.length} planilha(s) · ${soma.toLocaleString("pt-BR")} sistema(s)`)}">${svg("i-chevron-baixo", "icone seta-grupo")}<span>${escapar(g.nome)}</span><span class="n">${g.locs.length}</span></button>
            ${aberto ? `<ul>${locs.map((l) => { const achadas = secoesQuePassam(l); return itemLocalidade(l, { secoesAchadas: achadas.length ? achadas : null }); }).join("") || '<li class="apoio vazio-lateral">Nenhuma planilha.</li>'}</ul>` : ""}</div>`;
        }).join("") || `<p class="apoio vazio-lateral">${termo ? "Nada encontrado com esse nome." : ehAdmin() ? "Nenhuma planilha ainda. Use Administração › Planilhas e grupos." : "Nenhuma planilha ainda."}</p>`}
      </nav>
      ${termo ? `<p class="apoio vazio-lateral" role="status">${total} planilha(s)</p>` : ""}
      ${ehAdmin() ? `<label class="check lateral-arquivadas"><input type="checkbox" data-lateral="arquivadas"${cfg.arquivadas ? " checked" : ""}> Mostrar arquivadas</label>` : ""}
      <div class="lateral-lado" role="group" aria-label="Posição da barra lateral"><span class="apoio">Barra lateral:</span>
        <button type="button" class="btn-link" data-lateral="lado" data-lado="esquerda" aria-pressed="${!direita}">à esquerda</button>
        <button type="button" class="btn-link" data-lateral="lado" data-lado="direita" aria-pressed="${direita}">à direita</button></div>
    </div>
    <div class="lateral-alca" data-lateral="alca" role="separator" aria-orientation="vertical" aria-label="Arrastar para mudar a largura" tabindex="0"></div>`;
  if (ativa) { const i = $("#busca-localidade"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
const gravarLateral = (mudar) => { const cfg = lerLocal(chaveLateral(), {}) || {}; mudar(cfg); gravarLocal(chaveLateral(), cfg); };
$("#barra-lateral").addEventListener("input", (e) => { if (e.target.id === "busca-localidade") { buscaLateral = e.target.value; renderizarBarraLateral(); } });
$("#barra-lateral").addEventListener("keydown", (e) => {
  if (e.target.id === "busca-localidade" && e.key === "Enter") { const a = $(".lateral-arvore [data-loc]", $("#barra-lateral")); if (a) { e.preventDefault(); a.click(); } }
  if (e.target.matches('[data-lateral="alca"]') && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); gravarLateral((c) => { const cresce = (e.key === "ArrowRight") !== (c.lado === "direita"); c.largura = Math.max(220, Math.min(460, (Number(c.largura) || 280) + (cresce ? 20 : -20))); }); renderizarBarraLateral(); $('[data-lateral="alca"]').focus(); }
});
$("#barra-lateral").addEventListener("change", (e) => { if (e.target.matches('[data-lateral="arquivadas"]')) { gravarLateral((c) => { c.arquivadas = e.target.checked; }); renderizarBarraLateral(); } });
$("#barra-lateral").addEventListener("click", (e) => {
  const a = e.target.closest("[data-loc], [data-ir-painel]");
  if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.button) {
    e.preventDefault();
    if (a.dataset.irSecao) {
      /* Seção da planilha aberta: só rola; de outra planilha: abre já na seção */
      if (estado.tela === "localidade" && estado.planilha === a.dataset.loc) { history.replaceState({ cadeias: true }, "", urlDaRota({ tela: "localidade", ambiente: estado.ambiente, localidade: a.dataset.loc, secao: a.dataset.irSecao })); rolarParaSecao(a.dataset.irSecao); fecharGaveta(); }
      else navegar({ tela: "localidade", ambiente: estado.ambiente, localidade: a.dataset.loc, secao: a.dataset.irSecao });
      return;
    }
    if (a.dataset.loc) navegar({ tela: "localidade", ambiente: estado.ambiente, localidade: a.dataset.loc }); else navegar({ tela: "painel", ambiente: estado.ambiente });
    return;
  }
  const sl = e.target.closest("[data-secoes-lateral]");
  if (sl) {
    const fechadas = new Set(lerLocal(chaveSecoesLateral(), []) || []);
    if (fechadas.has(sl.dataset.secoesLateral)) fechadas.delete(sl.dataset.secoesLateral); else fechadas.add(sl.dataset.secoesLateral);
    gravarLocal(chaveSecoesLateral(), [...fechadas].slice(-200));
    renderizarBarraLateral();
    const b = $(`[data-secoes-lateral="${CSS.escape(sl.dataset.secoesLateral)}"]`); if (b) b.focus();
    return;
  }
  const lado = e.target.closest('[data-lateral="lado"]');
  if (lado) { gravarLateral((c) => { c.lado = lado.dataset.lado === "direita" ? "direita" : "esquerda"; }); renderizarBarraLateral(); agendarAjuste(); const b = $(`[data-lateral="lado"][data-lado="${lado.dataset.lado}"]`); if (b) b.focus(); return; }
  const g = e.target.closest("[data-grupo-lateral]");
  if (g) {
    const fechados = new Set(lerLocal(chaveGruposFechados(), []) || []);
    if (fechados.has(g.dataset.grupoLateral)) fechados.delete(g.dataset.grupoLateral); else fechados.add(g.dataset.grupoLateral);
    gravarLocal(chaveGruposFechados(), [...fechados]);
    renderizarBarraLateral();
    const b = $(`[data-grupo-lateral="${CSS.escape(g.dataset.grupoLateral)}"]`);
    if (b) b.focus();
    return;
  }
  if (e.target.closest('[data-lateral="recolher"]')) { gravarLateral((c) => { c.recolhida = !c.recolhida; }); renderizarBarraLateral(); agendarAjuste(); }
});
/* Largura da barra (arrastando a alça); fica lembrada */
$("#barra-lateral").addEventListener("pointerdown", (e) => {
  if (!e.target.matches('[data-lateral="alca"]')) return;
  e.preventDefault();
  const area = $("#area-ambiente"), x0 = e.clientX, l0 = $("#barra-lateral").getBoundingClientRect().width;
  const sinal = area.classList.contains("lateral-direita") ? -1 : 1;
  const mover = (ev) => area.style.setProperty("--largura-lateral", `${Math.max(220, Math.min(460, l0 + sinal * (ev.clientX - x0)))}px`);
  const soltar = (ev) => {
    document.removeEventListener("pointermove", mover);
    document.removeEventListener("pointerup", soltar);
    gravarLateral((c) => { c.largura = Math.round(Math.max(220, Math.min(460, l0 + sinal * (ev.clientX - x0)))); });
    agendarAjuste();
  };
  document.addEventListener("pointermove", mover);
  document.addEventListener("pointerup", soltar);
});
/* No celular, a barra vira gaveta */
function abrirGaveta() { $("#area-ambiente").classList.add("gaveta-aberta"); $("#fundo-gaveta").hidden = false; $("#btn-gaveta").setAttribute("aria-expanded", "true"); const i = $("#busca-localidade"); if (i) i.focus(); }
function fecharGaveta() { $("#area-ambiente").classList.remove("gaveta-aberta"); $("#fundo-gaveta").hidden = true; $("#btn-gaveta").setAttribute("aria-expanded", "false"); }
$("#btn-gaveta").innerHTML = svg("i-menu");
$("#btn-gaveta").addEventListener("click", () => ($("#area-ambiente").classList.contains("gaveta-aberta") ? fecharGaveta() : abrirGaveta()));
$("#fundo-gaveta").addEventListener("click", fecharGaveta);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#area-ambiente").classList.contains("gaveta-aberta")) fecharGaveta(); });

/* ---------- Painel do ambiente: resumo, cards das localidades, últimas mudanças e busca global ---------- */
const chaveOrdemPainel = () => chavePessoa(`ordem-painel-${estado.ambiente}`);
function chipsResumo(l, max = 4) {
  const amb = l.ambiente, e = estruturaDoAmbiente(amb);
  const c = e.colunas.find((x) => x.id === colResumoDe(amb));
  if (!c) return "";
  const itens = Object.entries(l.resumo || {}).map(([id, n]) => [opcao(c, id) || { id, nome: id, cor: "" }, Number(n) || 0]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, max);
  return itens.length ? `<span class="chips-resumo" aria-label="${escapar(c.nome)}">${itens.map(([o, n]) => `<span class="chip-resumo"><span class="ponto-cor${o.cor ? ` cor-${o.cor}` : ""}"></span>${escapar(o.nome)} <strong>${n.toLocaleString("pt-BR")}</strong></span>`).join("")}</span>` : "";
}
let pintandoPainel = 0;
function renderizarPainel() {
  cancelAnimationFrame(pintandoPainel);
  pintandoPainel = requestAnimationFrame(pintarPainel);
}
function pintarPainel() {
  const tela = $("#tela-painel"), amb = estado.ambiente;
  if (!amb || estado.tela !== "painel") return;
  const locs = localidadesDe(amb);
  const hoje = hojeIso();
  const registros = locs.reduce((s, l) => s + l.contagem, 0);
  const alteradosHojeN = locs.reduce((s, l) => s + alteradosHoje(l), 0);
  const locsHoje = locs.filter((l) => alteradosHoje(l) > 0).length;
  const paradas = locs.filter((l) => l.contagem && (!l.atualizadoEm || Date.now() - Date.parse(l.atualizadoEm) > 30 * DIA_MS)).length;
  const vazias = locs.filter((l) => !l.contagem).length;
  const ordem = lerLocal(chaveOrdemPainel(), "nome");
  const ordenar = (lista) => ordem === "registros" ? [...lista].sort((a, b) => b.contagem - a.contagem || COMPARAR(a.nome, b.nome))
    : ordem === "recente" ? [...lista].sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)) || COMPARAR(a.nome, b.nome)) : lista;
  const card = (n, rotulo, icone, extra = "", filtro = "") => `<div class="card-numero"${filtro ? ` data-card-filtro="${filtro}"` : ""}>${svg(icone)}<strong>${n.toLocaleString("pt-BR")}</strong><span>${escapar(rotulo)}</span>${extra ? `<small>${escapar(extra)}</small>` : ""}</div>`;
  const configurado = ambienteConfigurado(amb);
  const campoBusca = $("#busca-global-painel", tela);
  const valorBusca = campoBusca ? campoBusca.value : "";
  /* Filtro vindo da escolha (barra por status): só as planilhas com esse status, com a quantidade em destaque */
  const cStatus = estruturaDoAmbiente(amb).colunas.find((x) => x.id === colResumoDe(amb));
  const filtro = estado.filtroPainel && cStatus ? opcao(cStatus, estado.filtroPainel) || { id: estado.filtroPainel, nome: estado.filtroPainel, cor: "" } : null;
  const nStatus = (l) => (filtro ? Number((l.resumo || {})[filtro.id]) || 0 : 0);
  const passaFiltro = (l) => !filtro || nStatus(l) > 0;
  const totalFiltro = filtro ? locs.reduce((s, l) => s + nStatus(l), 0) : 0;
  tela.innerHTML = `<header class="painel-cabeca-ambiente"><div><p class="rotulo">Cadeia</p><h1 id="painel-titulo">${escapar(nomeAmbiente(amb))}</h1>${descricaoAmbiente(amb) ? `<p class="apoio">${escapar(descricaoAmbiente(amb))}</p>` : ""}</div>
      ${ehAdmin() ? `<div class="form-botoes"><button type="button" class="btn btn-secundario btn-mini" data-painel="localidades">${svg("i-pasta")}Planilhas e grupos</button><button type="button" class="btn btn-secundario btn-mini" data-painel="tribunais">${svg("i-predio")}Estrutura de Tribunais e Órgãos</button><button type="button" class="btn btn-secundario btn-mini" data-painel="importar">${svg("i-upload")}Importar Excel</button></div>` : ""}</header>
    ${!configurado ? `<div class="aviso-comecar">${svg("i-camadas")}<div><strong>${escapar(nomeAmbiente(amb))} ainda não tem colunas.</strong><p class="apoio">${ehAdmin() ? "Use “Criar estrutura de Tribunais e Órgãos” (grupos, planilhas, seções e as colunas dos dois ciclos) ou o assistente “Começar”." : "A Lays ou a Paula ainda estão preparando esta cadeia."}</p></div>${ehAdmin() ? `<button type="button" class="btn" data-painel="tribunais">${svg("i-predio")}Criar estrutura de Tribunais e Órgãos</button><button type="button" class="btn btn-secundario" data-painel="comecar">Começar</button>` : ""}</div>` : ""}
    <div class="cards-numeros">
      ${card(gruposDe(amb).length, "grupos", "i-pasta")}
      ${card(locs.length, "planilhas", "i-tabela")}
      ${card(registros, "sistemas (linhas)", "i-lista")}
      ${card(alteradosHojeN, "atualizados hoje", "i-atividade", locsHoje ? `em ${locsHoje} planilha(s)` : "")}
      ${card(paradas, "sem atualização há +30 dias", "i-relogio", "", paradas ? "paradas" : "")}
      ${card(vazias, "planilhas vazias", "i-arquivo", "", vazias ? "vazias" : "")}
    </div>
    ${filtro ? `<div class="filtro-painel" role="status"><span class="etq${filtro.cor ? ` cor-${filtro.cor}` : ""}">${escapar(cStatus.nome)}: ${escapar(filtro.nome)}</span> <strong>${totalFiltro.toLocaleString("pt-BR")}</strong> sistema(s) em ${locs.filter(passaFiltro).length} planilha(s) <button type="button" class="btn btn-secundario btn-mini" data-painel="limpar-filtro">${svg("i-fechar")}Ver todas</button></div>` : ""}
    <form class="busca-global-painel" data-painel="buscar" role="search">
      <label class="busca"><span class="sr-only">Buscar em todas as planilhas desta cadeia</span>${svg("i-busca")}<input type="search" id="busca-global-painel" name="termo" placeholder="Buscar em todas as planilhas de ${escapar(nomeAmbiente(amb))}…" autocomplete="off" value="${escapar(valorBusca)}"></label>
      <button type="submit" class="btn btn-mini">${svg("i-busca")}Buscar</button>
    </form>
    <div class="painel-grade-cadeias">
      <section class="painel-localidades" aria-labelledby="titulo-locs"><div class="painel-sec-cabeca"><h2 id="titulo-locs">Planilhas</h2>
        <label class="ordenar-locs"><span class="sr-only">Ordenar</span><select data-painel="ordem"><option value="nome"${ordem === "nome" ? " selected" : ""}>Na ordem do grupo</option><option value="registros"${ordem === "registros" ? " selected" : ""}>Mais sistemas</option><option value="recente"${ordem === "recente" ? " selected" : ""}>Atualização mais recente</option></select></label></div>
        ${arvoreDe(amb).map((g) => { const lista = g.locs.filter(passaFiltro); return lista.length ? `<div class="grupo-cards"><h3>${svg("i-pasta")}${escapar(g.nome)} <span class="selo">${lista.length}</span></h3><div class="cards-localidades">${(filtro ? [...lista].sort((a, b) => nStatus(b) - nStatus(a)) : ordenar(lista)).map((l) => {
          const at = atividadeDe(l);
          return `<a class="card-localidade${l.cor ? ` cor-borda-${l.cor}` : ""}" href="${escapar(urlDaRota({ tela: "localidade", ambiente: amb, localidade: l.id }))}" data-loc="${escapar(l.id)}">
            <span class="card-localidade-topo"><span class="modo-planilha" aria-hidden="true">${porEstado(l) ? "⊞" : "≡"}</span>${l.sigla && nomeComparavel(l.sigla) !== nomeComparavel(nomeCurtoPlanilha(l)) ? `<span class="sigla-planilha">${escapar(l.sigla)}</span>` : ""}<strong>${escapar(nomeCurtoPlanilha(l))}</strong>${ehFavorita(l.id) ? svg("i-estrela", "icone favorita") : ""}<span class="ponto-atividade${at.classe ? ` ${at.classe}` : ""}" title="${escapar(at.texto)}"></span></span>
            <span class="apoio card-localidade-meta">${escapar([porEstado(l) ? `por estado · ${l.secoes.length} seções` : "por sistema", l.uf, l.codigo].filter(Boolean).join(" · "))}</span>
            ${filtro ? `<span class="card-localidade-n"><strong>${nStatus(l).toLocaleString("pt-BR")}</strong> ${escapar(filtro.nome)} · de ${l.contagem.toLocaleString("pt-BR")}</span>` : `<span class="card-localidade-n"><strong>${l.contagem.toLocaleString("pt-BR")}</strong> sistema(s)</span>`}
            <span class="apoio card-localidade-quando">${escapar(textoAtualizacao(l))}</span>
            ${chipsResumo(l)}
          </a>`;
        }).join("")}</div></div>` : ""; }).join("") || `<p class="apoio">${filtro ? "Nenhuma planilha com esse status." : ehAdmin() ? "Nenhuma planilha ainda. Use “Estrutura de Tribunais e Órgãos”, crie em “Planilhas e grupos” ou importe um Excel." : "Nenhuma planilha ainda."}</p>`}
      </section>
      ${veMudancas() ? `<section class="painel-mudancas" aria-labelledby="titulo-mudancas"><div class="painel-sec-cabeca"><h2 id="titulo-mudancas">${svg("i-atividade")}Últimas 15 mudanças</h2>
          <label class="check"><input type="checkbox" data-painel="juntos"${lerLocal(chavePessoa("mudancas-juntos"), false) ? " checked" : ""}> Ver V6 e V12 juntos</label></div>
        <ol class="lista-mudancas-cadeias" id="mudancas-painel"><li class="apoio">Carregando…</li></ol></section>` : ""}
    </div>`;
  if (veMudancas()) ouvirMudancasPainel();
}
$("#tela-painel").addEventListener("click", (e) => {
  const a = e.target.closest("[data-loc]");
  if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.button) { e.preventDefault(); navegar({ tela: "localidade", ambiente: estado.ambiente, localidade: a.dataset.loc }); return; }
  const m = e.target.closest("[data-mudanca]");
  if (m) { abrirMudanca(m.dataset.mudanca); return; }
  const b = e.target.closest("[data-painel]");
  if (!b) return;
  if (b.dataset.painel === "localidades") abrirLocalidades();
  if (b.dataset.painel === "importar") abrirImportarExcel();
  if (b.dataset.painel === "comecar") abrirAssistente();
  if (b.dataset.painel === "tribunais") abrirEstruturaTribunais();
  if (b.dataset.painel === "limpar-filtro") navegar({ tela: "painel", ambiente: estado.ambiente });
  const f = e.target.closest("[data-card-filtro]");
  if (f) { buscaLateral = ""; mostrarAviso(f.dataset.cardFiltro === "vazias" ? "Planilhas vazias: ponto cinza na barra lateral." : "Sem atualização há mais de 30 dias: ponto amarelo na barra lateral.", 5000); }
});
$("#tela-painel").addEventListener("change", (e) => {
  if (e.target.matches('[data-painel="ordem"]')) { gravarLocal(chaveOrdemPainel(), e.target.value); renderizarPainel(); }
  if (e.target.matches('[data-painel="juntos"]')) { gravarLocal(chavePessoa("mudancas-juntos"), e.target.checked); pararMudancasPainel(); ouvirMudancasPainel(); }
});
$("#tela-painel").addEventListener("submit", (e) => {
  if (!e.target.matches('[data-painel="buscar"]')) return;
  e.preventDefault();
  abrirBuscaGlobal(e.target.termo.value);
});

/* ---------- Últimas 15 mudanças (Equipe N2 e administradoras), em tempo real ---------- */
const NOMES_MUDANCA = {
  criar: "criou", editar: "editou", editarMassa: "editou em massa", preencherMassa: "preencheu em massa", importar: "importou",
  pedirExclusao: "pediu exclusão", recusarExclusao: "recusou a exclusão", excluir: "excluiu", restaurar: "restaurou",
  desfazer: "desfez", substituirValor: "substituiu valor", corrigirLista: "corrigiu a lista", converterTipo: "converteu"
};
/* Consulta das últimas 15: de um ambiente (intervalo em "ordem", sem índice composto) ou das duas cadeias */
function ouvirUltimasMudancas(juntos, amb, cb, aoErro) {
  const opcoes = juntos ? { ordenar: "em", desc: true, limite: 15 } : { onde: [["ordem", ">=", `${amb}|`], ["ordem", "<", `${amb}}`]], ordenar: "ordem", desc: true, limite: 15 };
  return estado.api.ouvirColecao(COL_HISTORICO, cb, aoErro, opcoes);
}
function htmlMudancas(lista, juntos) {
  if (!lista.length) return '<li class="apoio">Nenhuma mudança registrada ainda.</li>';
  return lista.map((h) => {
    const quando = h.em ? `<time datetime="${escapar(h.em)}" title="${escapar(formatarData(h.em, true))}">${escapar(textoHaQuanto(h.em))}</time>` : "";
    const valor = h.coluna ? `<span class="mudanca-valor"><span class="mudanca-coluna">${escapar(h.colunaNome || h.coluna)}:</span> <del>${escapar(h.antes || "(vazio)")}</del> → <ins>${escapar(h.depois || "(vazio)")}</ins></span>`
      : h.depois && h.depois !== h.registroNome ? `<span class="mudanca-valor">${escapar(h.depois)}</span>` : "";
    return `<li><button type="button" class="item-mudanca" data-mudanca="${escapar(`${h.ambiente}|${h.localidade}|${h.registro}`)}" title="Abrir a planilha com a linha destacada">
      <span class="mudanca-topo">${quando}${juntos ? ` <span class="selo selo-ambiente" style="--cor-botao:${escapar(corAmbiente(h.ambiente))}">${escapar(nomeAmbiente(h.ambiente))}</span>` : ""} <strong>${escapar(h.porNome || nomePessoa(h.por))}</strong> <span class="etq">${escapar(NOMES_MUDANCA[h.acao] || h.acao)}</span></span>
      <span class="mudanca-alvo">${escapar(h.localidadeNome || (localidadePorId(h.localidade) || {}).nome || "")} · <strong>${escapar(h.registroNome || h.registro)}</strong></span>${valor}</button></li>`;
  }).join("");
}
function abrirMudanca(valor) {
  const [amb, loc, reg] = String(valor).split("|");
  if (!localidadePorId(loc)) { mostrarAviso("Essa planilha não existe mais."); return; }
  $$("dialog[open]").forEach((d) => d.close());
  navegar({ tela: "localidade", ambiente: amb, localidade: loc, linha: reg });
}
let pararMudancasDoPainel = null;
/* A última lista recebida: o painel é redesenhado a cada mudança das localidades e já mostra a lista na hora */
let mudancasDoPainel = null;
function pararMudancasPainel() { if (pararMudancasDoPainel) { try { pararMudancasDoPainel(); } catch (e) { /* já parado */ } pararMudancasDoPainel = null; } mudancasDoPainel = null; }
function ouvirMudancasPainel() {
  if (pararMudancasDoPainel && mudancasDoPainel && mudancasDoPainel.ambiente !== estado.ambiente) pararMudancasPainel();
  if (pararMudancasDoPainel) { if (mudancasDoPainel) mudancasDoPainel.desenhar(); return; }
  if (!veMudancas()) return;
  const juntos = !!lerLocal(chavePessoa("mudancas-juntos"), false);
  let ultima = null, falhou = false;
  const desenhar = () => { const el = $("#mudancas-painel"); if (el && (ultima || falhou)) el.innerHTML = falhou ? '<li class="apoio">Não foi possível carregar as últimas mudanças.</li>' : htmlMudancas(ultima, juntos); };
  mudancasDoPainel = { desenhar, ambiente: estado.ambiente };
  pararMudancasDoPainel = ouvirUltimasMudancas(juntos, estado.ambiente, (lista) => { ultima = lista; desenhar(); },
    (e) => { console.warn("mudanças", e); falhou = true; desenhar(); });
  /* "há 5 min" vai envelhecendo */
  const relogio = setInterval(desenhar, 60000);
  const parar = pararMudancasDoPainel;
  pararMudancasDoPainel = () => { clearInterval(relogio); parar && parar(); };
}
/* Botão no topo da localidade: as mesmas últimas 15, numa janela */
function abrirUltimasMudancas() {
  if (!veMudancas()) return;
  let juntos = !!lerLocal(chavePessoa("mudancas-juntos"), false), lista = [], parar = null;
  const d = criarDialogo({ titulo: `Últimas 15 mudanças${juntos ? "" : ` · ${nomeAmbiente(estado.ambiente)}`}`, largo: true, corpo: `
    <label class="check"><input type="checkbox" name="juntos"${juntos ? " checked" : ""}> Ver V6 e V12 juntos</label>
    <ol class="lista-mudancas-cadeias" id="mudancas-dialogo"><li class="apoio">Carregando…</li></ol>` });
  const desenhar = () => { const el = $("#mudancas-dialogo", d); if (el) el.innerHTML = htmlMudancas(lista, juntos); };
  const ligar = () => { if (parar) parar(); parar = ouvirUltimasMudancas(juntos, estado.ambiente, (l) => { lista = l; desenhar(); }, () => { $("#mudancas-dialogo", d).innerHTML = '<li class="apoio">Não foi possível carregar.</li>'; }); };
  d.querySelector("form").juntos.addEventListener("change", (e) => { juntos = e.target.checked; gravarLocal(chavePessoa("mudancas-juntos"), juntos); ligar(); });
  d.addEventListener("click", (e) => { const m = e.target.closest("[data-mudanca]"); if (m) abrirMudanca(m.dataset.mudanca); });
  d.addEventListener("close", () => { if (parar) parar(); });
  ligar();
  d.showModal();
}

/* ---------- Cabeçalho da localidade: trilha, números, favorito, anterior/próxima e últimas mudanças ---------- */
function vizinhas(l) {
  const lista = localidadesDe(l.ambiente).filter((x) => x.grupo === l.grupo);
  const i = lista.findIndex((x) => x.id === l.id);
  return { anterior: i > 0 ? lista[i - 1] : null, proxima: i >= 0 && i < lista.length - 1 ? lista[i + 1] : null };
}
function renderizarCabecaLocalidade() {
  const caixa = $("#cabeca-localidade"), l = localidadePorId(estado.planilha);
  if (!l) { caixa.innerHTML = ""; return; }
  const { anterior, proxima } = vizinhas(l);
  const fav = ehFavorita(l.id);
  const n = estado.carregouEquipamentos ? estado.equipamentos.length : l.contagem;
  const estadoModo = porEstado(l), sistema = verPorSistema(), so = soPendencias();
  caixa.innerHTML = `<div class="cabeca-loc-titulo">${svg(estadoModo ? "i-grade" : "i-lista", `icone icone-loc${l.cor ? ` cor-${l.cor}` : ""}`)}
      <div><p class="trilha">${escapar(nomeAmbiente(l.ambiente))} › ${escapar(nomeDoGrupo(l.grupo))} · ${estadoModo ? `por estado (${l.secoes.length} seções)` : "por sistema"}</p>
        <h1>${escapar(tituloPlanilha(l))}${l.ativa ? "" : ' <span class="selo">Arquivada</span>'} <button type="button" class="btn-icone favorito" data-cabeca="favorito" aria-pressed="${fav}" aria-label="${fav ? "Tirar das favoritas" : "Marcar como favorita"}" title="${fav ? "Tirar das favoritas" : "Favorita"}">${svg("i-estrela")}</button></h1>
        <p class="apoio">${n.toLocaleString("pt-BR")} sistema(s) · atualizada ${escapar(textoAtualizacao(l))}${l.uf ? ` · ${escapar(l.uf)}` : ""}${l.codigo ? ` · código ${escapar(l.codigo)}` : ""}${l.responsavel ? ` · responsável: ${escapar(l.responsavel)}` : ""}</p>
        ${l.observacao ? `<p class="apoio obs-loc">${escapar(l.observacao)}</p>` : ""}</div></div>
    <div class="cabeca-loc-acoes">
      <button type="button" class="btn btn-secundario btn-mini" data-cabeca="anterior"${anterior ? ` title="${escapar(tituloPlanilha(anterior))}"` : " disabled"}>${svg("i-seta-esquerda")}Anterior</button>
      <button type="button" class="btn btn-secundario btn-mini" data-cabeca="proxima"${proxima ? ` title="${escapar(tituloPlanilha(proxima))}"` : " disabled"}>Próxima${svg("i-seta-direita")}</button>
      ${veMudancas() ? `<button type="button" class="btn btn-secundario btn-mini" data-cabeca="mudancas">${svg("i-atividade")}Últimas mudanças</button>` : ""}
      ${ehAdmin() ? `<button type="button" class="btn btn-secundario btn-mini" data-cabeca="editar">${svg("i-lapis")}Editar planilha</button>` : ""}
    </div>
    ${estadoModo ? `<div class="cabeca-loc-secoes" role="toolbar" aria-label="Seções">
      <button type="button" class="btn btn-secundario btn-mini" data-cabeca="recolher">${svg("i-recolher")}Recolher todas</button>
      <button type="button" class="btn btn-secundario btn-mini" data-cabeca="expandir">${svg("i-expandir")}Expandir todas</button>
      ${sistema ? "" : `<label class="check"><input type="checkbox" data-cabeca="pendencias"${so ? " checked" : ""}> Só seções com pendências</label>`}
      <button type="button" class="btn btn-mini${sistema ? "" : " btn-secundario"}" data-cabeca="por-sistema" aria-pressed="${sistema}">${svg(sistema ? "i-grade" : "i-camadas")}${sistema ? "Ver por estado" : "Ver por sistema"}</button>
    </div>` : ""}`;
  document.title = `${tituloPlanilha(l)} · ${nomeAmbiente(l.ambiente)} · Cadeias V6 / V12 · Suporte V/Cert`;
}
$("#cabeca-localidade").addEventListener("change", (e) => {
  const l = localidadePorId(estado.planilha);
  if (!l || !e.target.matches('[data-cabeca="pendencias"]')) return;
  marcarPorPlanilha("so-pendencias", l.id, e.target.checked);
  renderizarTudo();
});
$("#cabeca-localidade").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cabeca]");
  const l = localidadePorId(estado.planilha);
  if (!b || !l) return;
  const a = b.dataset.cabeca;
  if (a === "recolher" || a === "expandir") { recolherTodas(a === "recolher"); return; }
  if (a === "por-sistema") {
    marcarPorPlanilha("ver-por-sistema", l.id, !verPorSistema());
    renderizarCabecaLocalidade();
    renderizarTudo();
    renderizarBarraLateral();
    const x = $('[data-cabeca="por-sistema"]'); if (x) x.focus();
    return;
  }
  if (a === "editar") { editarLocalidade(l, l.ambiente); return; }
  if (a === "favorito") alternarFavorita(l.id);
  if (a === "mudancas") abrirUltimasMudancas();
  if (a === "anterior" || a === "proxima") { const v = vizinhas(l)[a]; if (v) navegar({ tela: "localidade", ambiente: l.ambiente, localidade: v.id }); }
});

/* ---------- Migalhas e título ---------- */
function renderizarMigalhas(r) {
  const itens = [{ rotulo: "Cadeias", rota: { tela: "escolha" } }];
  if (r.tela === "painel" || r.tela === "localidade") itens.push({ rotulo: nomeAmbiente(r.ambiente), rota: { tela: "painel", ambiente: r.ambiente } });
  if (r.tela === "localidade") { const l = localidadePorId(r.localidade); if (l) { itens.push({ rotulo: nomeDoGrupo(l.grupo) }); itens.push({ rotulo: l.sigla || nomeCurtoPlanilha(l) }); } }
  if (r.tela === "auditoria") itens.push({ rotulo: "Auditoria" });
  $("#migalhas").innerHTML = `<ol>${itens.map((it, i) => `<li>${it.rota && i < itens.length - 1 ? `<a href="${escapar(urlDaRota(it.rota))}" data-rota="${escapar(JSON.stringify(it.rota))}">${escapar(it.rotulo)}</a>` : `<span${i === itens.length - 1 ? ' aria-current="page"' : ""}>${escapar(it.rotulo)}</span>`}</li>`).join("")}</ol>`;
  $("#btn-voltar").hidden = r.tela === "escolha";
  $("#btn-gaveta").hidden = !(r.tela === "painel" || r.tela === "localidade");
  if (r.tela !== "localidade") document.title = `${r.tela === "painel" ? `${nomeAmbiente(r.ambiente)} · ` : r.tela === "auditoria" ? "Auditoria · " : ""}Cadeias V6 / V12 · Suporte V/Cert`;
}
$("#migalhas").addEventListener("click", (e) => {
  const a = e.target.closest("[data-rota]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  e.preventDefault();
  navegar(JSON.parse(a.dataset.rota));
});
$("#btn-voltar").innerHTML = svg("i-voltar");
$("#btn-voltar").addEventListener("click", () => {
  const r = rotaDaUrl();
  navegar(r.tela === "localidade" ? { tela: "painel", ambiente: r.ambiente } : { tela: "escolha" });
});

/* ---------- Busca global: todas as planilhas do ambiente (lidas só quando a pessoa pede) ---------- */
/* Registros de uma planilha: arquivo compactado + registros vivos (o vivo substitui a linha do arquivo) */
function combinarRegistros(vivosLista, docsArquivo) {
  const porVersao = new Map();
  docsArquivo.forEach((d) => { const v = Number(d.versao) || 0; if (!porVersao.has(v)) porVersao.set(v, []); porVersao.get(v).push(d); });
  const inteira = [...porVersao].filter(([, ds]) => ds.length === Number(ds[0].total)).sort((a, b) => b[0] - a[0])[0];
  const linhas = inteira ? inteira[1].sort((a, b) => a.indice - b.indice).flatMap(lerParte) : [];
  const vivos = new Map(vivosLista.map((t) => [t.id, t]));
  const doArquivo = linhas.map((t) => { const v = vivos.get(t.id); if (!v) return t; vivos.delete(t.id); return v.parcial ? mesclarParcial(t, v) : v; });
  return [...vivos.values(), ...doArquivo];
}
async function dadosDaLocalidade(id, { forcar = false } = {}) {
  if (estado.tela === "localidade" && estado.planilha === id && estado.carregouEquipamentos) return { em: Date.now(), registros: estado.equipamentos };
  const c = cacheDados.get(id);
  if (c && !forcar && Date.now() - c.em < TEMPO_CACHE) return c;
  const [vivos, arquivo] = await Promise.all([estado.api.lerColecao(`${LOC(id)}/registros`), estado.api.lerColecao(`${LOC(id)}/arquivo`)]);
  const r = { em: Date.now(), registros: combinarRegistros(vivos.map(normalizarEquipamento), arquivo) };
  cacheDados.set(id, r);
  return r;
}
$("#btn-busca-rapida").innerHTML = svg("i-busca") + '<span>Buscar nas planilhas</span><kbd>Ctrl K</kbd>';
function abrirBuscaGlobal(termoInicial = "") {
  const amb = estado.ambiente;
  if (!amb) { mostrarAviso("Escolha a cadeia primeiro."); return; }
  const locs = localidadesDe(amb);
  const e = estruturaDoAmbiente(amb);
  const cols = e.colunas.filter((c) => c.ativa);
  const d = criarDialogo({
    titulo: `Buscar em todas as planilhas de ${nomeAmbiente(amb)}`,
    largo: true,
    corpo: `<label class="busca"><span class="sr-only">Buscar</span>${svg("i-busca")}<input type="search" name="termo" placeholder="Valor, nome, código…" autocomplete="off" value="${escapar(termoInicial)}"></label>
      <p class="apoio" id="busca-global-estado" role="status">${locs.length} planilha(s). Digite pelo menos 2 letras e tecle Enter.</p>
      <div class="busca-global" id="busca-global-lista"></div>
      <p class="apoio" style="font-size:12px">Os registros de cada planilha são lidos só agora (e guardados 5 minutos). Enter busca; clique num resultado para abrir a planilha filtrada, com a linha destacada.</p>`
  });
  const form = d.querySelector("form");
  const lista = $("#busca-global-lista", d), situacao = $("#busca-global-estado", d);
  let rodada = 0;
  const buscar = async () => {
    const termoBusca = normalizar(form.termo.value.trim());
    const minha = ++rodada;
    if (termoBusca.length < 2) { lista.innerHTML = ""; situacao.textContent = "Digite pelo menos 2 letras."; return; }
    let lidas = 0, falhas = 0;
    const resultados = [];
    situacao.textContent = `Lendo 0 de ${locs.length} planilha(s)…`;
    const desenhar = () => {
      lista.innerHTML = resultados.sort((a, b) => COMPARAR(a.l.nome, b.l.nome)).map(({ l, achados }) => `<section><h3>${svg(l.icone)}${escapar(l.nome)} <span class="selo">${achados.length}</span> <span class="apoio">${escapar(nomeDoGrupo(l.grupo))}</span></h3><ul>${achados.slice(0, 8).map((t) => {
        const c = t.campos || {};
        const extra = cols.filter((x) => !estaVazio(c[x.id]) && normalizar(valorTexto(t, x)).includes(termoBusca)).slice(0, 2).map((x) => `${x.nome}: ${valorTexto(t, x)}`).join(" · ");
        return `<li><button type="button" data-resultado="${escapar(`${l.id}|${t.id}`)}"><strong>${escapar(alvoRegistro(t, c, e))}</strong><span class="apoio">${escapar(extra)}</span></button></li>`;
      }).join("")}</ul>${achados.length > 8 ? `<button type="button" class="btn-link" data-ver-todos="${escapar(l.id)}">Ver os ${achados.length} na planilha</button>` : ""}</section>`).join("")
        || (lidas === locs.length ? '<p class="apoio">Nada encontrado.</p>' : "");
    };
    const fila = [...locs];
    const trabalhador = async () => {
      while (fila.length) {
        const l = fila.shift();
        try {
          const { registros } = await dadosDaLocalidade(l.id);
          if (minha !== rodada) return;
          const achados = registros.filter((t) => cols.some((c) => normalizar(valorTexto(t, c)).includes(termoBusca)));
          if (achados.length) resultados.push({ l, achados });
        } catch (err) { console.warn(err); falhas++; }
        lidas++;
        if (minha === rodada) { situacao.textContent = lidas < locs.length ? `Lendo ${lidas} de ${locs.length} planilha(s)…` : `${resultados.reduce((s, r) => s + r.achados.length, 0)} resultado(s) em ${resultados.length} planilha(s).${falhas ? ` ${falhas} planilha(s) não puderam ser lidas.` : ""}`; desenhar(); }
      }
    };
    await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
  };
  form.addEventListener("submit", (ev) => { ev.preventDefault(); buscar(); });
  d.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-resultado]");
    if (b) { const [loc, id] = b.dataset.resultado.split("|"); d.close(); navegar({ tela: "localidade", ambiente: amb, localidade: loc, linha: id, busca: form.termo.value.trim() }); return; }
    const todos = ev.target.closest("[data-ver-todos]");
    if (todos) { d.close(); navegar({ tela: "localidade", ambiente: amb, localidade: todos.dataset.verTodos, busca: form.termo.value.trim() }); }
  });
  d.showModal();
  form.termo.focus();
  if (termoInicial.trim().length >= 2) buscar();
}


/* ============================================================
 *  Administração das cadeias (só Lays e Paula)
 * ============================================================ */
const assinaturaAdmin = () => ({ atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email });
const seletorCor = (nome, atual) => `<div class="cores-ambiente" role="radiogroup" aria-label="Cor de destaque">${CORES_AMBIENTE.map((c) => `<label class="cor-amostra" style="--amostra:${c}"><input type="radio" name="${escapar(nome)}" value="${c}"${String(atual).toLowerCase() === c ? " checked" : ""}><span class="sr-only">${c}</span></label>`).join("")}
  <label class="campo cor-livre"><span class="rotulo">Outra (#RRGGBB)</span><input name="${escapar(nome)}-livre" value="${CORES_AMBIENTE.includes(String(atual).toLowerCase()) ? "" : escapar(atual)}" maxlength="7" placeholder="#1f5f8b"></label></div>`;
const corEscolhida = (form, nome, padrao) => { const livre = (form.elements[`${nome}-livre`] || {}).value || ""; if (RE_COR.test(livre.trim())) return livre.trim().toLowerCase(); const r = form.querySelector(`[name="${nome}"]:checked`); return r ? r.value : padrao; };
async function salvarAmbienteMeta(amb, { descricao, cor }) {
  await estado.api.salvarDoc(`${COL_AMBIENTES}/${amb}`, { nome: nomeAmbiente(amb), descricao: txt(descricao, 200), cor, ...assinaturaAdmin() }, true);
  registrarAuditoria("ambiente", `Cadeia ${nomeAmbiente(amb)}: descrição e cor`, `${descricao} · ${cor}`, { planilha: "" });
}
function abrirConfigAmbiente(amb = estado.ambiente) {
  if (!ehAdmin() || !ehAmbiente(amb)) return;
  const d = criarDialogo({ titulo: `Cadeia ${nomeAmbiente(amb)}`, corpo: `
    <label class="campo"><span class="rotulo">Descrição curta (aparece no card da escolha e na faixa do topo)</span><textarea name="descricao" maxlength="200" rows="2">${escapar(descricaoAmbiente(amb))}</textarea></label>
    <div class="campo"><span class="rotulo">Cor de destaque</span>${seletorCor("cor", corAmbiente(amb))}</div>
    <p class="apoio" style="font-size:12px">Cada cadeia tem a sua cor para ninguém confundir V6 com V12.</p>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}Salvar</button></div>` });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await salvarAmbienteMeta(amb, { descricao: form.descricao.value.trim(), cor: corEscolhida(form, "cor", corAmbiente(amb)) }); d.close(); mostrarAviso("Cadeia salva."); }
    catch (err) { console.error(err); form.querySelector(".form-erro").textContent = mensagemErro(err); }
  });
  d.showModal();
}

/* ---------- Planilhas (antes "localidades") e grupos ---------- */
const novaOrdem = (lista) => Math.max(0, ...lista.map((x) => Number(x.ordem) || 0)) + 1;
function formLocalidade(l, amb) {
  const grupos = gruposDe(amb);
  const modo = l ? l.modo : "sistema";
  return `<div class="campos-linha">
    <label class="campo"><span class="rotulo">Sigla</span><input name="sigla" value="${escapar(l ? l.sigla : "")}" maxlength="12" placeholder="STF" autocomplete="off"></label>
    <label class="campo largo"><span class="rotulo">Nome completo *</span><input name="nomeCompleto" value="${escapar(l ? nomeCurtoPlanilha(l) : "")}" maxlength="120" required placeholder="Supremo Tribunal Federal"></label>
    <label class="campo"><span class="rotulo">Grupo</span><select name="grupo"><option value="">Sem grupo</option>${grupos.map((g) => `<option value="${escapar(g.id)}"${l && l.grupo === g.id ? " selected" : ""}>${escapar(g.nome)}</option>`).join("")}</select></label>
    <fieldset class="campo modo-planilha-escolha"><legend class="rotulo">Modo</legend>
      <label class="check"><input type="radio" name="modo" value="sistema"${modo === "sistema" ? " checked" : ""}> ≡ Por sistema (lista simples)</label>
      <label class="check"><input type="radio" name="modo" value="estado"${modo === "estado" ? " checked" : ""}> ⊞ Por estado (dividida em seções)</label></fieldset>
  </div>
  <p class="apoio" style="font-size:12px" data-previa-nome></p>
  <details class="mais-detalhes"><summary>Mais detalhes (UF, código, responsável, cor, ícone, observação)</summary><div class="campos-linha">
    <label class="campo"><span class="rotulo">UF</span><input name="uf" value="${escapar(l ? l.uf : "")}" maxlength="2" placeholder="SP"></label>
    <label class="campo"><span class="rotulo">Código</span><input name="codigo" value="${escapar(l ? l.codigo : "")}" maxlength="40"></label>
    <label class="campo"><span class="rotulo">Responsável</span><input name="responsavel" value="${escapar(l ? l.responsavel : "")}" maxlength="80"></label>
    <label class="campo"><span class="rotulo">Cor</span><select name="cor"><option value="">Sem cor</option>${CORES.map((c) => `<option value="${c}"${l && l.cor === c ? " selected" : ""}>${escapar(NOME_COR[c])}</option>`).join("")}</select></label>
    <label class="campo"><span class="rotulo">Ícone</span><select name="icone">${ICONES_LOCALIDADE.map(([i, n]) => `<option value="${i}"${(l ? l.icone : "i-predio") === i ? " selected" : ""}>${escapar(n)}</option>`).join("")}</select></label>
    <label class="campo largo"><span class="rotulo">Observação curta</span><input name="observacao" value="${escapar(l ? l.observacao : "")}" maxlength="200"></label>
  </div></details>`;
}
/* "Supremo Tribunal Federal (STF)": o nome da planilha (título, endereço antigo, troca V6 ↔ V12) vem da sigla e do nome completo */
const nomeDaPlanilha = (sigla, nomeCompleto) => (sigla && nomeComparavel(sigla) !== nomeComparavel(nomeCompleto) ? `${nomeCompleto} (${sigla})` : nomeCompleto).slice(0, 80);
const dadosDoForm = (form) => {
  const sigla = form.sigla.value.trim().replace(/\s+/g, " ").slice(0, 12);
  const nomeCompleto = form.nomeCompleto.value.trim().replace(/\s+/g, " ").slice(0, 120);
  return {
    nome: nomeDaPlanilha(sigla, nomeCompleto), sigla, nomeCompleto, grupo: form.grupo.value,
    modo: (form.querySelector('[name="modo"]:checked') || {}).value === "estado" ? "estado" : "sistema",
    uf: form.uf.value.trim().toUpperCase().slice(0, 2), codigo: form.codigo.value.trim().slice(0, 40), responsavel: form.responsavel.value.trim().slice(0, 80),
    cor: CORES.includes(form.cor.value) ? form.cor.value : "", icone: form.icone.value, observacao: form.observacao.value.trim().slice(0, 200)
  };
};
function nomeLocalidadeRepetido(amb, nome, ignorar = "") { return estado.localidades.some((x) => x.ambiente === amb && x.id !== ignorar && nomeComparavel(x.nome) === nomeComparavel(nome)); }
const siglaRepetida = (amb, sigla, ignorar = "") => !!sigla && estado.localidades.some((x) => x.ambiente === amb && x.id !== ignorar && x.sigla && nomeComparavel(x.sigla) === nomeComparavel(sigla));
/* Documento novo de planilha (contadores zerados). secaoIds: a lista de ids que as regras conferem na criação dos registros. */
const dadosNovaLocalidade = (amb, campos, ordem) => ({
  ambiente: amb, modo: "sistema", secoes: [], sistemasPadrao: [], sigla: "", nomeCompleto: campos.nome || "", ...campos,
  secaoIds: (campos.secoes || []).map((s) => s.id), ordem, ativa: true, colunasExtras: [], colunasEquipeExtras: [], contagem: 0, resumo: {}, hoje: null,
  criadoEm: "__AGORA__", criadoPor: estado.usuario.email, atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email, atualizadoPorNome: estado.usuario.nome, ultimoRegistro: ""
});
const dadosSecoes = (secoes) => ({ secoes: secoes.map((s) => ({ id: s.id, nome: txt(s.nome, 80), sigla: txt(s.sigla, 12) })), secaoIds: secoes.map((s) => s.id) });
/* Listas prontas de seções (composições conferidas no TST, TRF1/CJF e IBGE; tudo continua editável) */
function idSecaoNovo(nome, existentes) {
  const base = slug(nome, 16) || "secao";
  let id = base, n = 2;
  while (existentes.includes(id)) id = `${base.slice(0, 14)}-${n++}`;
  return id;
}
function editarLocalidade(l, amb = estado.ambiente, aoSalvar = () => {}) {
  let secoes = l ? l.secoes.map((s) => ({ ...s })) : [];
  let arrastando = null;
  const d = criarDialogo({ titulo: l ? `Planilha “${tituloPlanilha(l)}”` : `Nova planilha em ${nomeAmbiente(amb)}`, largo: true, corpo: `${formLocalidade(l, amb)}
    <section class="editor-secoes" data-editor-secoes>
      <h3>Seções <span class="selo" data-n-secoes></span></h3>
      <p class="apoio" style="font-size:12px">Uma seção por estado ou região, na ordem da planilha. Arraste (⋮⋮) para mudar a ordem; o nome e a sigla podem ser trocados a qualquer momento.</p>
      <div class="form-botoes" style="justify-content:flex-start">
        <label class="campo"><span class="sr-only">Lista pronta</span><select name="listaPronta"><option value="">Carregar lista pronta…</option>${Object.entries(LISTAS_SECOES).map(([id, x]) => `<option value="${id}">${escapar(x.nome)}</option>`).join("")}</select></label>
        <button type="button" class="btn btn-secundario btn-mini" data-sec="carregar">${svg("i-download")}Carregar (só as que faltam)</button>
        <input name="novaSecao" maxlength="80" placeholder="Nova seção (ex.: Acre (AC))" aria-label="Nome da nova seção">
        <button type="button" class="btn btn-secundario btn-mini" data-sec="nova">${svg("i-mais")}Adicionar seção</button>
      </div>
      <ol class="lista-secoes" data-lista-secoes></ol>
    </section>
    <section class="editor-sistemas">
      <h3>Sistemas padrão</h3>
      <label class="campo"><span class="rotulo">Um por linha (ex.: E-PROC, e-SAJ, PJe, Projudi). Ao criar uma seção (ou a planilha), estas linhas já nascem vazias.</span><textarea name="sistemasPadrao" rows="3" maxlength="2400">${escapar(l ? l.sistemasPadrao.join("\n") : "")}</textarea></label>
      ${l ? `<button type="button" class="btn btn-secundario btn-mini" data-sec="aplicar-sistemas">${svg("i-check")}Aplicar às seções que não têm esses sistemas…</button>` : ""}
    </section>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}${l ? "Salvar" : "Criar planilha"}</button></div>` });
  const form = d.querySelector("form");
  const erro = form.querySelector(".form-erro");
  const lista = $("[data-lista-secoes]", d);
  const modoAtual = () => ((form.querySelector('[name="modo"]:checked') || {}).value === "estado" ? "estado" : "sistema");
  const desenhar = () => {
    $("[data-editor-secoes]", d).hidden = modoAtual() !== "estado";
    $("[data-n-secoes]", d).textContent = String(secoes.length);
    const contar = (id) => (l && estado.planilha === l.id && estado.carregouEquipamentos ? estado.equipamentos.filter((t) => t.secao === id).length : null);
    lista.innerHTML = secoes.map((s, i) => { const n = contar(s.id); return `<li draggable="true" data-sec-i="${i}">
      <span class="pegador" aria-hidden="true">⋮⋮</span>
      <input data-sec-campo="nome" value="${escapar(s.nome)}" maxlength="80" aria-label="Nome da seção ${i + 1}">
      <input data-sec-campo="sigla" value="${escapar(s.sigla)}" maxlength="12" aria-label="Sigla da seção ${i + 1}" class="sigla-secao" placeholder="Sigla">
      ${n != null ? `<span class="apoio">${n} linha(s)</span>` : ""}
      <span class="acoes-tab"><button type="button" class="acao-linha" data-sec="subir" aria-label="Subir ${escapar(s.nome)}">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-sec="descer" aria-label="Descer ${escapar(s.nome)}">${svg("i-seta-baixo")}</button><button type="button" class="acao-linha perigo" data-sec="remover" aria-label="Remover ${escapar(s.nome)}">${svg("i-lixeira")}</button></span></li>`; }).join("")
      || '<li class="apoio vazio-grupo">Nenhuma seção. Carregue uma lista pronta (27 UFs, 26 capitais, TRT, TRF) ou adicione uma a uma.</li>';
    const dados = dadosDoForm(form);
    $("[data-previa-nome]", d).textContent = dados.nomeCompleto ? `Título: ${dados.nome}` : "";
  };
  form.addEventListener("input", (e) => {
    const li = e.target.closest("[data-sec-i]");
    if (li) { const s = secoes[Number(li.dataset.secI)]; if (s) s[e.target.dataset.secCampo] = e.target.value.slice(0, e.target.dataset.secCampo === "nome" ? 80 : 12); return; }
    if (e.target.name === "sigla" || e.target.name === "nomeCompleto") { const dados = dadosDoForm(form); $("[data-previa-nome]", d).textContent = dados.nomeCompleto ? `Título: ${dados.nome}` : ""; }
  });
  form.addEventListener("change", (e) => { if (e.target.name === "modo") desenhar(); });
  form.addEventListener("keydown", (e) => { if (e.target.name === "novaSecao" && e.key === "Enter") { e.preventDefault(); $('[data-sec="nova"]', d).click(); } });
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-sec]");
    if (!b) return;
    const a = b.dataset.sec, li = b.closest("[data-sec-i]"), i = li ? Number(li.dataset.secI) : -1;
    if (a === "nova") {
      const nome = form.novaSecao.value.trim().replace(/\s+/g, " ").slice(0, 80);
      if (!nome) { form.novaSecao.focus(); return; }
      if (secoes.some((s) => nomeComparavel(s.nome) === nomeComparavel(nome))) { erro.textContent = `Já existe a seção “${nome}”.`; return; }
      if (secoes.length >= MAX_SECOES) { erro.textContent = `No máximo ${MAX_SECOES} seções por planilha.`; return; }
      const uf = /\(([A-Za-z]{2})\)\s*$/.exec(nome);
      const id = uf && !secoes.some((s) => s.id === uf[1].toLowerCase()) ? uf[1].toLowerCase() : idSecaoNovo(nome, secoes.map((s) => s.id));
      secoes.push({ id, nome, sigla: uf ? uf[1].toUpperCase() : "" });
      form.novaSecao.value = ""; erro.textContent = "";
      desenhar(); form.novaSecao.focus();
    }
    if (a === "carregar") {
      const pronta = LISTAS_SECOES[form.listaPronta.value];
      if (!pronta) { form.listaPronta.focus(); return; }
      const faltam = pronta.secoes().filter((s) => !secoes.some((x) => x.id === s.id));
      if (secoes.length + faltam.length > MAX_SECOES) { erro.textContent = `No máximo ${MAX_SECOES} seções por planilha.`; return; }
      secoes.push(...faltam.map((s) => ({ ...s })));
      erro.textContent = "";
      mostrarAviso(faltam.length ? `${faltam.length} seção(ões) acrescentada(s).` : "Todas as seções dessa lista já estão aqui.");
      desenhar();
    }
    if ((a === "subir" || a === "descer") && i >= 0) {
      const j = i + (a === "subir" ? -1 : 1);
      if (j < 0 || j >= secoes.length) return;
      [secoes[i], secoes[j]] = [secoes[j], secoes[i]];
      desenhar();
      const x = $(`[data-sec-i="${j}"] [data-sec="${a}"]`, d); if (x) x.focus();
    }
    if (a === "remover" && i >= 0) { secoes.splice(i, 1); desenhar(); }
    if (a === "aplicar-sistemas" && l) aplicarSistemasPadrao(l, normalizarSistemas(form.sistemasPadrao.value.split(/\r?\n/)), secoes);
  });
  d.addEventListener("dragstart", (e) => { const li = e.target.closest && e.target.closest("[data-sec-i]"); if (!li || e.target.closest("input")) return; arrastando = Number(li.dataset.secI); li.classList.add("arrastando"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(arrastando)); });
  d.addEventListener("dragend", () => { arrastando = null; $$(".arrastando, .alvo-soltar", d).forEach((x) => x.classList.remove("arrastando", "alvo-soltar")); });
  d.addEventListener("dragover", (e) => { if (arrastando == null) return; const li = e.target.closest("[data-sec-i]"); if (!li) return; e.preventDefault(); $$(".alvo-soltar", d).forEach((x) => x.classList.remove("alvo-soltar")); li.classList.add("alvo-soltar"); });
  d.addEventListener("drop", (e) => {
    if (arrastando == null) return;
    const li = e.target.closest("[data-sec-i]");
    if (!li) return;
    e.preventDefault();
    const de = arrastando, para = Number(li.dataset.secI);
    arrastando = null;
    if (de === para) return;
    const [s] = secoes.splice(de, 1);
    secoes.splice(para, 0, s);
    desenhar();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const dados = dadosDoForm(form);
    const sistemas = normalizarSistemas(form.sistemasPadrao.value.split(/\r?\n/));
    if (!dados.nomeCompleto) { erro.textContent = "Dê um nome à planilha."; form.nomeCompleto.focus(); return; }
    if (nomeLocalidadeRepetido(amb, dados.nome, l ? l.id : "")) { erro.textContent = `Já existe uma planilha “${dados.nome}” em ${nomeAmbiente(amb)}.`; return; }
    if (siglaRepetida(amb, dados.sigla, l ? l.id : "")) { erro.textContent = `Já existe uma planilha com a sigla “${dados.sigla}” em ${nomeAmbiente(amb)}.`; form.sigla.focus(); return; }
    const final = secoes.map((s) => ({ id: s.id, nome: String(s.nome || "").trim().replace(/\s+/g, " ").slice(0, 80) || s.id.toUpperCase(), sigla: String(s.sigla || "").trim().slice(0, 12) }));
    if (new Set(final.map((s) => nomeComparavel(s.nome))).size !== final.length) { erro.textContent = "Há duas seções com o mesmo nome."; return; }
    if (dados.modo === "estado" && !final.length && !(await confirmar("A planilha por estado está sem seções. Salvar assim mesmo? Dá para acrescentar depois.", { titulo: "Sem seções", botao: "Salvar" }))) return;
    const botao = form.querySelector("[type=submit]");
    botao.disabled = true;
    try {
      if (l) {
        const removidas = l.secoes.filter((s) => !final.some((x) => x.id === s.id));
        const novas = final.filter((s) => !l.secoes.some((x) => x.id === s.id));
        if (l.modo !== dados.modo && !(await confirmar(dados.modo === "sistema"
          ? "Trocar para “por sistema”? As linhas ficam numa lista só; a seção de cada linha continua gravada (voltando para “por estado”, elas voltam para as seções)."
          : "Trocar para “por estado”? As linhas que ainda não têm seção aparecem em “Sem seção” até você mover cada uma (menu ⋯ da linha › Mover para outra seção).", { titulo: "Trocar o modo", botao: "Trocar" }))) { botao.disabled = false; return; }
        /* Seções removidas que têm linhas: para onde vão (ou lixeira) */
        if (removidas.length && !(await tratarSecoesRemovidas(l, removidas, final))) { botao.disabled = false; return; }
        const mudouGrupo = l.grupo !== dados.grupo;
        await estado.api.salvarDoc(LOC(l.id), { ...dados, ...dadosSecoes(dados.modo === "estado" || l.modo === "estado" ? final : l.secoes), sistemasPadrao: sistemas, ...(mudouGrupo ? { ordem: novaOrdem(estado.localidades.filter((x) => x.ambiente === amb && x.grupo === dados.grupo)) } : {}), ...assinaturaAdmin() }, true);
        registrarAuditoria("localidade", `Editou a planilha ${dados.nome}${l.nome !== dados.nome ? ` (antes: ${l.nome})` : ""}${mudouGrupo ? ` · grupo: ${nomeDoGrupo(dados.grupo)}` : ""}${l.modo !== dados.modo ? ` · modo: ${dados.modo === "estado" ? "por estado" : "por sistema"}` : ""}`, [novas.length ? `Seções novas: ${novas.map((s) => s.nome).join(", ")}` : "", removidas.length ? `Seções removidas: ${removidas.map((s) => s.nome).join(", ")}` : ""].filter(Boolean).join(" · ").slice(0, 1500), { planilha: l.id });
        if (dados.modo === "estado" && novas.length && sistemas.length) {
          const n = await criarLinhasPadrao(l.id, amb, novas.map((s) => s.id), sistemas);
          if (n) mostrarAviso(`${n} linha(s) dos sistemas padrão criadas nas seções novas.`, 5000);
        }
      } else {
        const id = estado.api.novoId(COL_LOCALIDADES);
        await estado.api.salvarDoc(LOC(id), dadosNovaLocalidade(amb, { ...dados, ...dadosSecoes(dados.modo === "estado" ? final : []), sistemasPadrao: sistemas }, novaOrdem(estado.localidades.filter((x) => x.ambiente === amb && x.grupo === dados.grupo))));
        registrarAuditoria("localidade", `Criou a planilha ${dados.nome} em ${nomeAmbiente(amb)} (${dados.modo === "estado" ? `por estado, ${final.length} seções` : "por sistema"})`, nomeDoGrupo(dados.grupo), { planilha: id });
        if (dados.modo === "estado" && final.length && sistemas.length) await criarLinhasPadrao(id, amb, final.map((s) => s.id), sistemas, { nova: true });
        else if (dados.modo === "sistema" && sistemas.length) await criarLinhasPadrao(id, amb, [""], sistemas, { nova: true });
      }
      d.close();
      mostrarAviso(l ? "Planilha salva." : "Planilha criada.");
      aoSalvar();
    } catch (err) { console.error(err); erro.textContent = mensagemErro(err); botao.disabled = false; }
  });
  desenhar();
  d.showModal();
  form.nomeCompleto.focus();
}
/* Lista de Grupo › Localidades: criar, renomear, mover de grupo, reordenar (arrastar ou setas), arquivar, excluir */
function abrirLocalidades() {
  if (!ehAdmin() || !estado.ambiente) return;
  const amb = estado.ambiente;
  let arquivadas = true, arrastando = null;
  const d = criarDialogo({ titulo: `Planilhas e grupos de ${nomeAmbiente(amb)}`, largo: true, corpo: `
    <div class="form-botoes" style="justify-content:flex-start">
      <button type="button" class="btn btn-mini" data-lg="nova-loc">${svg("i-mais")}Nova planilha</button>
      <button type="button" class="btn btn-secundario btn-mini" data-lg="novo-grupo">${svg("i-pasta")}Novo grupo</button>
      <button type="button" class="btn btn-secundario btn-mini" data-lg="tribunais">${svg("i-predio")}Estrutura de Tribunais e Órgãos</button>
      <button type="button" class="btn btn-secundario btn-mini" data-lg="copiar-estrutura">${svg("i-copiar")}Copiar para ${escapar(nomeAmbiente(outroAmbiente(amb)))}</button>
      <button type="button" class="btn btn-secundario btn-mini" data-lg="importar">${svg("i-upload")}Importar Excel</button>
      <label class="check" style="margin-left:auto"><input type="checkbox" name="arquivadas" checked> Mostrar arquivadas</label>
    </div>
    <p class="apoio" style="font-size:12px">Arraste as planilhas (⋮⋮) para mudar a ordem ou o grupo; as setas fazem o mesmo pelo teclado. “Editar” muda sigla, nome, modo, seções e sistemas padrão.</p>
    <div id="lista-localidades" class="lista-localidades"></div>
    <p class="form-erro" role="alert"></p>` });
  const form = d.querySelector("form");
  form.addEventListener("submit", (e) => e.preventDefault());
  const erro = () => d.querySelector(".form-erro");
  const desenhar = () => {
    const arvore = arvoreDe(amb, { arquivadas });
    const grupos = gruposDe(amb);
    $("#lista-localidades", d).innerHTML = arvore.map((g) => `<section class="grupo-admin" data-grupo-admin="${escapar(g.id)}">
      <div class="grupo-admin-cabeca">${svg("i-pasta")}
        ${g.id === SEM_GRUPO ? `<strong>Sem grupo</strong>` : `<input data-grupo-nome value="${escapar(g.nome)}" maxlength="60" aria-label="Nome do grupo">`}
        <span class="selo">${g.locs.length}</span>
        ${g.id === SEM_GRUPO ? "" : `<span class="acoes-tab"><button type="button" class="acao-linha" data-lg="grupo-subir" aria-label="Subir o grupo ${escapar(g.nome)}">${svg("i-seta-cima")}</button><button type="button" class="acao-linha" data-lg="grupo-descer" aria-label="Descer o grupo ${escapar(g.nome)}">${svg("i-seta-baixo")}</button><button type="button" class="acao-linha" data-lg="grupo-remover" aria-label="Remover o grupo ${escapar(g.nome)}">${svg("i-lixeira")}</button></span>`}
      </div>
      <ol class="locs-admin">${g.locs.map((l) => `<li draggable="true" data-loc-admin="${escapar(l.id)}"${l.ativa ? "" : ' class="arquivada"'}>
        <span class="pegador" aria-hidden="true">⋮⋮</span><span class="modo-planilha" aria-hidden="true">${porEstado(l) ? "⊞" : "≡"}</span>
        <span class="loc-admin-nome"><strong>${escapar(tituloPlanilha(l))}</strong><span class="apoio">${escapar([porEstado(l) ? `por estado · ${l.secoes.length} seções` : "por sistema", l.sistemasPadrao.length ? `padrão: ${l.sistemasPadrao.join(", ")}` : "", l.uf, l.codigo, l.responsavel, `${l.contagem} sistema(s)`, l.ativa ? "" : "arquivada"].filter(Boolean).join(" · "))}</span></span>
        <span class="acoes-tab">
          <button type="button" class="acao-linha" data-lg="subir" aria-label="Subir ${escapar(l.nome)}">${svg("i-seta-cima")}</button>
          <button type="button" class="acao-linha" data-lg="descer" aria-label="Descer ${escapar(l.nome)}">${svg("i-seta-baixo")}</button>
          <button type="button" class="btn btn-secundario btn-mini" data-lg="editar">${svg("i-lapis")}Editar</button>
          <button type="button" class="btn btn-secundario btn-mini" data-lg="extras" title="Copiar as colunas extras de outra planilha">${svg("i-copiar")}Extras</button>
          <button type="button" class="btn btn-secundario btn-mini" data-lg="arquivar">${svg("i-arquivar")}${l.ativa ? "Arquivar" : "Restaurar"}</button>
          <button type="button" class="acao-linha perigo" data-lg="excluir" aria-label="Excluir ${escapar(l.nome)} (vai para a lixeira com as linhas)">${svg("i-lixeira")}</button>
        </span></li>`).join("") || '<li class="apoio vazio-grupo">Arraste planilhas para cá.</li>'}</ol></section>`).join("")
      || `<p class="apoio">Nenhum grupo nem planilha ainda. Use “Estrutura de Tribunais e Órgãos” ou comece por “Novo grupo” e “Nova planilha”.</p>`;
    if (!grupos.length && !arvore.length) return;
  };
  /* Reordena (e muda de grupo): renumera as localidades do grupo de destino e grava só as que mudaram */
  async function reposicionar(id, grupoDestino, antesDe) {
    const l = localidadePorId(id);
    if (!l) return;
    const destino = grupoDestino === SEM_GRUPO ? "" : grupoDestino;
    const lista = ordenarLocalidades(estado.localidades.filter((x) => x.ambiente === amb && (destino ? x.grupo === destino : !grupoPorId(x.grupo)) && x.id !== id));
    const i = antesDe ? lista.findIndex((x) => x.id === antesDe) : -1;
    lista.splice(i < 0 ? lista.length : i, 0, l);
    const ops = lista.map((x, k) => ({ x, ordem: k + 1 })).filter(({ x, ordem }) => x.ordem !== ordem || (x.id === id && x.grupo !== destino))
      .map(({ x, ordem }) => ({ op: "set", caminho: LOC(x.id), mesclar: true, dados: { ordem, ...(x.id === id ? { grupo: destino } : {}), ...assinaturaAdmin() } }));
    if (!ops.length) return;
    try { await estado.api.lote(ops); if (l.grupo !== destino) registrarAuditoria("localidade", `Moveu ${l.nome} para o grupo ${nomeDoGrupo(destino)}`, "", { planilha: l.id }); }
    catch (err) { console.error(err); erro().textContent = mensagemErro(err); }
  }
  async function moverGrupo(id, delta) {
    const gs = gruposDe(amb), i = gs.findIndex((g) => g.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= gs.length) return;
    [gs[i], gs[j]] = [gs[j], gs[i]];
    try { await estado.api.lote(gs.map((g, k) => ({ op: "set", caminho: `${COL_GRUPOS}/${g.id}`, mesclar: true, dados: { ordem: k + 1, ...assinaturaAdmin() } }))); }
    catch (err) { console.error(err); erro().textContent = mensagemErro(err); }
  }
  form.arquivadas.addEventListener("change", () => { arquivadas = form.arquivadas.checked; desenhar(); });
  d.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-grupo-nome]")) return;
    const g = grupoPorId(e.target.closest("[data-grupo-admin]").dataset.grupoAdmin);
    const nome = e.target.value.trim().slice(0, 60);
    if (!g || !nome || nome === g.nome) { e.target.value = g ? g.nome : ""; return; }
    try { await estado.api.salvarDoc(`${COL_GRUPOS}/${g.id}`, { nome, ...assinaturaAdmin() }, true); registrarAuditoria("localidade", `Renomeou o grupo ${g.nome} para ${nome}`, "", { planilha: "" }); }
    catch (err) { console.error(err); erro().textContent = mensagemErro(err); }
  });
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-lg]");
    if (!b) return;
    const a = b.dataset.lg;
    const li = b.closest("[data-loc-admin]"), l = li ? localidadePorId(li.dataset.locAdmin) : null;
    const sec = b.closest("[data-grupo-admin]"), g = sec ? grupoPorId(sec.dataset.grupoAdmin) : null;
    if (a === "nova-loc") editarLocalidade(null, amb);
    if (a === "importar") { d.close(); abrirImportarExcel(); }
    if (a === "tribunais") { d.close(); abrirEstruturaTribunais(); }
    if (a === "copiar-estrutura") copiarEstruturaPara(outroAmbiente(amb), amb);
    if (a === "novo-grupo") {
      const nome = await pedirTexto("Novo grupo", "Nome do grupo (ex.: TRIBUNAIS)", 60);
      if (!nome) return;
      const id = estado.api.novoId(COL_GRUPOS);
      try { await estado.api.salvarDoc(`${COL_GRUPOS}/${id}`, { ambiente: amb, nome, ordem: novaOrdem(gruposDe(amb)), criadoEm: "__AGORA__", ...assinaturaAdmin() }); registrarAuditoria("localidade", `Criou o grupo ${nome} em ${nomeAmbiente(amb)}`, "", { planilha: "" }); }
      catch (err) { console.error(err); erro().textContent = mensagemErro(err); }
    }
    if ((a === "grupo-subir" || a === "grupo-descer") && g) moverGrupo(g.id, a === "grupo-subir" ? -1 : 1);
    if (a === "grupo-remover" && g) removerGrupo(g);
    if (!l) return;
    if (a === "editar") editarLocalidade(l, amb);
    if (a === "extras") copiarColunasExtras(l);
    if (a === "subir" || a === "descer") {
      const lista = ordenarLocalidades(estado.localidades.filter((x) => x.ambiente === amb && x.grupo === l.grupo));
      const i = lista.findIndex((x) => x.id === l.id), j = i + (a === "subir" ? -1 : 1);
      if (j < 0 || j >= lista.length) return;
      await reposicionar(l.id, l.grupo || SEM_GRUPO, a === "subir" ? lista[j].id : (lista[j + 1] || {}).id);
      setTimeout(() => { const x = $(`[data-loc-admin="${CSS.escape(l.id)}"] [data-lg="${a}"]`, d); if (x) x.focus(); }, 150);
    }
    if (a === "arquivar") {
      try { await estado.api.salvarDoc(LOC(l.id), { ativa: !l.ativa, ...assinaturaAdmin() }, true); registrarAuditoria("localidade", `${l.ativa ? "Arquivou" : "Restaurou"} a localidade ${l.nome}`, "", { planilha: l.id }); }
      catch (err) { console.error(err); erro().textContent = mensagemErro(err); }
    }
    if (a === "excluir") excluirLocalidade(l);
  });
  d.addEventListener("dragstart", (e) => { const li = e.target.closest && e.target.closest("[data-loc-admin]"); if (!li) return; arrastando = li.dataset.locAdmin; li.classList.add("arrastando"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", arrastando); });
  d.addEventListener("dragend", () => { arrastando = null; $$(".arrastando, .alvo-soltar", d).forEach((x) => x.classList.remove("arrastando", "alvo-soltar")); });
  d.addEventListener("dragover", (e) => { if (!arrastando) return; const alvo = e.target.closest("[data-loc-admin], [data-grupo-admin]"); if (!alvo) return; e.preventDefault(); $$(".alvo-soltar", d).forEach((x) => x.classList.remove("alvo-soltar")); alvo.classList.add("alvo-soltar"); });
  d.addEventListener("drop", (e) => {
    if (!arrastando) return;
    e.preventDefault();
    const li = e.target.closest("[data-loc-admin]"), sec = e.target.closest("[data-grupo-admin]");
    if (!sec) return;
    const id = arrastando;
    arrastando = null;
    reposicionar(id, sec.dataset.grupoAdmin, li && li.dataset.locAdmin !== id ? li.dataset.locAdmin : null);
  });
  const anterior = estado.aoMudarLocalidades;
  estado.aoMudarLocalidades = desenhar;
  d.addEventListener("close", () => { estado.aoMudarLocalidades = anterior || null; });
  desenhar();
  d.showModal();
}
function pedirTexto(titulo, rotulo, max = 80, inicial = "") {
  return new Promise((resolver) => {
    const d = criarDialogo({ titulo, corpo: `<label class="campo"><span class="rotulo">${escapar(rotulo)}</span><input name="texto" maxlength="${max}" value="${escapar(inicial)}" autocomplete="off"></label>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">OK</button></div>` });
    let valor = null;
    d.querySelector("form").addEventListener("submit", (e) => { valor = e.target.texto.value.trim().replace(/\s+/g, " ").slice(0, max) || null; });
    d.addEventListener("close", () => resolver(valor));
    d.showModal();
    d.querySelector("input").focus();
  });
}
/* Remover grupo: pergunta para onde vão as localidades dele */
function removerGrupo(g) {
  const amb = g.ambiente, locs = estado.localidades.filter((l) => l.grupo === g.id);
  const outros = gruposDe(amb).filter((x) => x.id !== g.id);
  const d = criarDialogo({ titulo: `Remover o grupo “${g.nome}”`, corpo: `<p class="apoio">${locs.length} planilha(s) estão neste grupo. Para onde elas vão?</p>
    <label class="campo"><span class="rotulo">Mover as planilhas para</span><select name="destino"><option value="">Sem grupo</option>${outros.map((x) => `<option value="${escapar(x.id)}">${escapar(x.nome)}</option>`).join("")}</select></label>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn btn-perigo">Remover o grupo</button></div>` });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const destino = form.destino.value;
    const base = novaOrdem(estado.localidades.filter((l) => l.ambiente === amb && l.grupo === destino));
    const ops = ordenarLocalidades(locs).map((l, i) => ({ op: "set", caminho: LOC(l.id), mesclar: true, dados: { grupo: destino, ordem: base + i, ...assinaturaAdmin() } }));
    ops.push({ op: "delete", caminho: `${COL_GRUPOS}/${g.id}` });
    try { await estado.api.lote(ops); registrarAuditoria("localidade", `Removeu o grupo ${g.nome}`, `${locs.length} planilha(s) para ${nomeDoGrupo(destino)}`, { planilha: "" }); d.close(); }
    catch (err) { console.error(err); form.querySelector(".form-erro").textContent = mensagemErro(err); }
  });
  d.showModal();
}

/* ============================================================
 *  Tribunais e Órgãos: listas de seções, colunas dos dois ciclos e a estrutura inicial
 *  Composições conferidas em fonte oficial (nov/2026): TRT pelo TST (tst.jus.br/justica-do-trabalho, 24 regiões);
 *  TRF pelo TRF1 (Emenda Regimental 6/2022, com MG no TRF6) e CNJ. Tudo continua editável em "Editar planilha".
 * ============================================================ */
const UFS = [["AC", "Acre", "Rio Branco"], ["AL", "Alagoas", "Maceió"], ["AP", "Amapá", "Macapá"], ["AM", "Amazonas", "Manaus"], ["BA", "Bahia", "Salvador"],
  ["CE", "Ceará", "Fortaleza"], ["DF", "Distrito Federal", ""], ["ES", "Espírito Santo", "Vitória"], ["GO", "Goiás", "Goiânia"], ["MA", "Maranhão", "São Luís"],
  ["MT", "Mato Grosso", "Cuiabá"], ["MS", "Mato Grosso do Sul", "Campo Grande"], ["MG", "Minas Gerais", "Belo Horizonte"], ["PA", "Pará", "Belém"],
  ["PB", "Paraíba", "João Pessoa"], ["PR", "Paraná", "Curitiba"], ["PE", "Pernambuco", "Recife"], ["PI", "Piauí", "Teresina"], ["RJ", "Rio de Janeiro", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte", "Natal"], ["RS", "Rio Grande do Sul", "Porto Alegre"], ["RO", "Rondônia", "Porto Velho"], ["RR", "Roraima", "Boa Vista"],
  ["SC", "Santa Catarina", "Florianópolis"], ["SP", "São Paulo", "São Paulo"], ["SE", "Sergipe", "Aracaju"], ["TO", "Tocantins", "Palmas"]];
const porNomeUf = (a, b) => COMPARAR(a[1], b[1]);
const TRT_REGIOES = ["RJ", "SP - Capital", "MG", "RS", "BA", "PE", "CE", "PA/AP", "PR", "DF/TO", "AM/RR", "SC", "PB", "RO/AC", "SP - Interior", "MA", "ES", "GO", "AL", "SE", "RN", "PI", "MT", "MS"];
const TRF_REGIOES = ["AC/AM/AP/BA/DF/GO/MA/MT/PA/PI/RO/RR/TO", "RJ/ES", "SP/MS", "PR/RS/SC", "AL/CE/PB/PE/RN/SE", "MG"];
const LISTAS_SECOES = {
  ufs: { nome: "27 UFs (estados e DF)", secoes: () => [...UFS].sort(porNomeUf).map(([uf, nome]) => ({ id: uf.toLowerCase(), nome: `${nome} (${uf})`, sigla: uf })) },
  capitais: { nome: "26 capitais (prefeituras)", secoes: () => [...UFS].filter((u) => u[2]).sort(porNomeUf).map(([uf, , cap]) => ({ id: uf.toLowerCase(), nome: `${cap} (${uf})`, sigla: uf })) },
  trt: { nome: "TRT 1ª a 24ª Região", secoes: () => TRT_REGIOES.map((e, i) => ({ id: `r${i + 1}`, nome: `TRT ${i + 1}ª Região (${e})`, sigla: `${i + 1}ª` })) },
  trf: { nome: "TRF 1ª a 6ª Região", secoes: () => TRF_REGIOES.map((e, i) => ({ id: `r${i + 1}`, nome: `TRF ${i + 1}ª Região (${e})`, sigla: `${i + 1}ª` })) },
  tjm: { nome: "TJM: SP, MG e RS", secoes: () => [["SP", "São Paulo"], ["MG", "Minas Gerais"], ["RS", "Rio Grande do Sul"]].map(([uf, nome]) => ({ id: uf.toLowerCase(), nome: `${nome} (${uf})`, sigla: uf })) }
};
const ESTRUTURA_TRIBUNAIS = [
  { grupo: "TRIBUNAIS", planilhas: [
    { sigla: "CNJ", nome: "Conselho Nacional de Justiça" },
    { sigla: "STF", nome: "Supremo Tribunal Federal" },
    { sigla: "STJ", nome: "Superior Tribunal de Justiça" },
    { sigla: "TJ", nome: "Tribunal de Justiça", secoes: "ufs", sistemas: ["E-PROC", "e-SAJ", "PJe", "Projudi"] },
    { sigla: "TST", nome: "Tribunal Superior do Trabalho" },
    { sigla: "TRT", nome: "Tribunal Regional do Trabalho", secoes: "trt" },
    { sigla: "TRF", nome: "Tribunal Regional Federal", secoes: "trf" },
    { sigla: "TJM", nome: "Tribunal de Justiça Militar", secoes: "tjm" },
    { sigla: "TSE", nome: "Tribunal Superior Eleitoral" },
    { sigla: "TRE", nome: "Tribunal Regional Eleitoral", secoes: "ufs" }
  ] },
  { grupo: "ÓRGÃOS - GOV - OUTROS", planilhas: [
    { sigla: "RFB", nome: "Receita Federal do Brasil" },
    { sigla: "", nome: "Prefeituras - Capitais", secoes: "capitais" },
    { sigla: "SEFAZ", nome: "Secretaria da Fazenda", secoes: "ufs" },
    { sigla: "", nome: "Junta Comercial", secoes: "ufs" },
    { sigla: "", nome: "Outros" }
  ] }
];
/* Colunas da cadeia (V6 e V12), na ordem, com os dois grupos de colunas da planilha de divulgação */
const GRUPOS_TRIBUNAIS = [
  { id: "identificacao", nome: "Identificação", ordem: 1 },
  { id: "ciclo-1", nome: "1º Ciclo - Divulgação das cadeias de Certificação", ordem: 2 },
  { id: "ciclo-2", nome: "2º Ciclo - Teste pós implantação", ordem: 3 }
];
const op = (id, nome, cor = "", final = false) => ({ id, nome, cor, ...(final ? { final: true } : {}) });
const COLUNAS_TRIBUNAIS = [
  { id: "sistema", nome: "Sistema", tipo: "texto", grupo: "identificacao", obrigatoria: true, largura: 170, acesso: "travado", ajuda: "Nome do sistema (ex.: PJe, e-SAJ)" },
  { id: "email", nome: "E-mail", tipo: "texto", formato: "email", grupo: "ciclo-1", largura: 210 },
  { id: "telefone", nome: "Telefone", tipo: "texto", formato: "telefone", grupo: "ciclo-1", largura: 150 },
  { id: "divulgacao", nome: "Divulgação", tipo: "lista", grupo: "ciclo-1", largura: 130, acesso: "lista", opcoes: [op("ok", "Ok", "verde"), op("pendente", "Pendente", "laranja"), op("nao-enviada", "Não enviada", "cinza")] },
  { id: "status", nome: "Status", tipo: "status", grupo: "ciclo-1", largura: 150, acesso: "lista", opcoes: [op("instalado", "Instalado", "verde", true), op("cobranca", "Cobrança", "amarelo"), op("aguardando", "Aguardando", "azul"), op("pendente", "Pendente", "laranja"), op("nao-integrado", "Não integrado", "cinza", true)] },
  { id: "dataUltima", nome: "Data Última", tipo: "data", grupo: "ciclo-1", largura: 130 },
  { id: "retornoTel", nome: "Retorno Tel", tipo: "texto", grupo: "ciclo-1", largura: 160 },
  { id: "retornoEmail", nome: "Retorno e-mail", tipo: "texto", grupo: "ciclo-1", largura: 170 },
  { id: "atualizacoes", nome: "Atualizações", tipo: "textoLongo", grupo: "ciclo-1", largura: 240 },
  { id: "responsavel", nome: "Responsável", tipo: "lista", grupo: "ciclo-2", largura: 160, acesso: "lista", opcoes: [], ajuda: "Pessoas da equipe (as administradoras cadastram em Estrutura)" },
  { id: "dataTeste", nome: "Data Teste", tipo: "data", grupo: "ciclo-2", largura: 130 },
  { id: "resultado", nome: "Resultado", tipo: "texto", grupo: "ciclo-2", largura: 170 },
  { id: "observacao", nome: "Observação", tipo: "textoLongo", grupo: "ciclo-2", largura: 240 }
];
/* Prévia de "aplicar a estrutura de Tribunais e Órgãos" numa cadeia que já tem colunas: reaproveita por nome,
   cria as que faltam e arquiva as que sobram (os valores continuam gravados nos registros) */
function planoColunasTribunais(amb) {
  const atual = estruturaDoAmbiente(amb);
  const usados = new Set(), ids = atual.colunas.map((c) => c.id);
  const itens = COLUNAS_TRIBUNAIS.map((m, i) => {
    const existente = atual.colunas.find((c) => !usados.has(c.id) && (nomeComparavel(c.nome) === nomeComparavel(m.nome) || c.id === m.id));
    if (existente) usados.add(existente.id);
    const id = existente ? existente.id : ids.includes(m.id) ? idUnico(m.nome, ids, true) : m.id;
    ids.push(id);
    const mesmoTipo = !existente || existente.tipo === m.tipo;
    const tipo = mesmoTipo ? m.tipo : existente.tipo;
    const opcoes = TIPOS_LISTA.includes(tipo) ? [...(existente ? existente.opcoes : []), ...(m.opcoes || []).filter((o) => !(existente ? existente.opcoes : []).some((x) => x.id === o.id || nomeComparavel(x.nome) === nomeComparavel(o.nome)))] : [];
    const col = { ...colunaBase(id, m.nome, tipo, { grupo: m.grupo, largura: m.largura, obrigatoria: !!m.obrigatoria, acesso: m.acesso || (TIPOS_LISTA.includes(tipo) ? "lista" : "livre"), ajuda: m.ajuda || "", ordem: i + 1, opcoes }), ...(m.formato && tipo === "texto" ? { formato: m.formato } : {}) };
    return { m, existente, col, mesmoTipo };
  });
  const sobram = atual.colunas.filter((c) => !usados.has(c.id) && c.ativa);
  const grupos = [...GRUPOS_TRIBUNAIS, ...atual.gruposColunas.filter((g) => !GRUPOS_TRIBUNAIS.some((x) => x.id === g.id) && atual.colunas.some((c) => c.grupo === g.id && !usados.has(c.id))).map((g, i) => ({ ...g, ordem: 10 + i }))];
  const colunas = [...itens.map((x) => x.col), ...atual.colunas.filter((c) => !usados.has(c.id)).map((c, i) => ({ ...c, ativa: false, ordem: 100 + i }))];
  const status = itens.find((x) => x.m.id === "status").col, chave = itens.find((x) => x.m.id === "sistema").col;
  return {
    atual, itens, sobram,
    estrutura: { ...atual, titulo: atual.titulo || `CADEIA ${nomeAmbiente(amb)}`, versao: atual.versao + 1, colunas, gruposColunas: grupos, colunaChave: chave.tipo === "texto" ? chave.id : atual.colunaChave, chaveComposta: chave.tipo === "texto", colunaResumo: TIPOS_LISTA.includes(status.tipo) ? status.id : atual.colunaResumo, colunaAbas: "" }
  };
}
/* O que falta criar numa cadeia: grupos e planilhas (pela sigla ou pelo nome); nada que já existe é mexido */
function planoPlanilhasTribunais(amb) {
  const grupos = [], planilhas = [];
  ESTRUTURA_TRIBUNAIS.forEach((g, gi) => {
    const existente = gruposDe(amb).find((x) => nomeComparavel(x.nome) === nomeComparavel(g.grupo));
    const gid = existente ? existente.id : `__novo-${gi}`;
    if (!existente) grupos.push({ tmp: gid, nome: g.grupo });
    g.planilhas.forEach((p) => {
      const nome = nomeDaPlanilha(p.sigla, p.nome);
      const ja = estado.localidades.find((l) => l.ambiente === amb && ((p.sigla && l.sigla && nomeComparavel(l.sigla) === nomeComparavel(p.sigla)) || nomeComparavel(l.nome) === nomeComparavel(nome) || nomeComparavel(l.nomeCompleto) === nomeComparavel(p.nome)));
      if (ja) return;
      const secoes = p.secoes ? LISTAS_SECOES[p.secoes].secoes() : [];
      planilhas.push({ grupo: gid, sigla: p.sigla, nomeCompleto: p.nome, nome, modo: p.secoes ? "estado" : "sistema", secoes, sistemasPadrao: p.sistemas || [] });
    });
  });
  return { grupos, planilhas, linhas: planilhas.reduce((s, p) => s + (p.modo === "estado" ? p.secoes.length : 1) * p.sistemasPadrao.length, 0) };
}
/* Cópia da estrutura do ambiente antes de trocar as colunas (cadeias-backups, tipo "estrutura") */
async function backupEstruturaAmbiente(amb, motivo) {
  const id = estado.api.novoId(COL_BACKUPS);
  await estado.api.salvarDoc(`${COL_BACKUPS}/${id}`, { motivo: txt(motivo, 200), criadoPor: estado.usuario.email, criadoEm: "__AGORA__", planilha: "", ambiente: amb, tipo: "estrutura", totalRegistros: 0, partes: 0, versaoEstrutura: estruturaDoAmbiente(amb).versao, estrutura: JSON.stringify(estado.ambientes[amb] || null) });
  return id;
}
function abrirEstruturaTribunais() {
  if (!ehAdmin()) return;
  const d = criarDialogo({ titulo: "Criar estrutura de Tribunais e Órgãos", largo: true, corpo: `
    <p class="apoio">Cria os grupos <strong>TRIBUNAIS</strong> e <strong>ÓRGÃOS - GOV - OUTROS</strong>, as 15 planilhas (por sistema ou por estado, com as seções) e as colunas dos dois ciclos. Só cria o que ainda não existe; nenhum contato, e-mail ou telefone é cadastrado.</p>
    <fieldset class="campo"><legend class="rotulo">Onde criar</legend>
      <label class="check"><input type="radio" name="onde" value="ambas" checked> Nas duas cadeias (V6 e V12)</label>
      <label class="check"><input type="radio" name="onde" value="v6"> Só na V6</label></fieldset>
    <div id="previa-tribunais"></div>
    <p class="apoio" id="progresso-tribunais" role="status"></p>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-check")}Criar</button></div>` });
  const form = d.querySelector("form");
  const ambientes = () => (form.querySelector('[name="onde"]:checked').value === "v6" ? ["v6"] : ["v6", "v12"]);
  const desenhar = () => {
    $("#previa-tribunais", d).innerHTML = ambientes().map((amb) => {
      const c = planoColunasTribunais(amb), p = planoPlanilhasTribunais(amb);
      const temColunas = c.atual.colunas.length > 0;
      return `<section class="previa-tribunais" style="--cor-card:${escapar(corAmbiente(amb))}"><h3>${escapar(nomeAmbiente(amb))}</h3>
        <p><strong>Colunas:</strong> ${temColunas ? `${c.itens.filter((x) => x.existente).length} reaproveitada(s) pelo nome, ${c.itens.filter((x) => !x.existente).length} nova(s)${c.sobram.length ? `, ${c.sobram.length} arquivada(s) (os valores continuam gravados): ${escapar(c.sobram.map((x) => x.nome).join(", "))}` : ""}. Um backup da estrutura é feito antes.` : `${c.itens.length} colunas novas em dois ciclos.`}</p>
        ${c.itens.some((x) => !x.mesmoTipo) ? `<p class="apoio" style="font-size:12px">Tipo mantido (a coluna já existe com outro tipo): ${escapar(c.itens.filter((x) => !x.mesmoTipo).map((x) => `${x.existente.nome} (${NOME_TIPO[x.existente.tipo]})`).join(", "))}.</p>` : ""}
        <p><strong>Grupos novos:</strong> ${p.grupos.length ? escapar(p.grupos.map((g) => g.nome).join(", ")) : "nenhum (já existem)"} · <strong>Planilhas novas:</strong> ${p.planilhas.length}${p.planilhas.length ? ` (${escapar(p.planilhas.map((x) => x.sigla || x.nomeCompleto).join(", "))})` : ""} · <strong>Linhas dos sistemas padrão:</strong> ${p.linhas}</p>
        <details><summary>Ver as colunas</summary><ol class="lista-colunas-previa">${c.itens.map((x) => `<li><span class="etq-mini etq">${escapar(nomeGrupoTribunais(x.col.grupo))}</span> ${escapar(x.col.nome)} <span class="apoio">${escapar(NOME_TIPO[x.col.tipo])}${x.col.formato ? ` · ${escapar(FORMATOS_TEXTO[x.col.formato])}` : ""}${x.existente ? " · reaproveitada" : " · nova"}</span></li>`).join("")}</ol></details></section>`;
    }).join("");
  };
  form.addEventListener("change", desenhar);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erro = form.querySelector(".form-erro"), progresso = $("#progresso-tribunais", d);
    const lista = ambientes();
    const comColunas = lista.filter((amb) => estruturaDoAmbiente(amb).colunas.length);
    if (comColunas.length && !(await confirmar(`${comColunas.map(nomeAmbiente).join(" e ")} já ${comColunas.length > 1 ? "têm" : "tem"} colunas. Aplicar a estrutura de Tribunais e Órgãos? As colunas com o mesmo nome são reaproveitadas, as outras ficam arquivadas (sem perder dados) e um backup da estrutura é feito antes.`, { titulo: "Aplicar estrutura", botao: "Aplicar" }))) return;
    const botao = form.querySelector("[type=submit]");
    botao.disabled = true;
    try {
      let planilhas = 0, linhas = 0;
      for (const amb of lista) {
        progresso.textContent = `${nomeAmbiente(amb)}: colunas…`;
        const c = planoColunasTribunais(amb);
        if (c.atual.colunas.length) await backupEstruturaAmbiente(amb, "Antes de aplicar a estrutura de Tribunais e Órgãos");
        await salvarEstrutura(c.estrutura, amb);
        registrarAuditoria("estrutura", `Estrutura de Tribunais e Órgãos em ${nomeAmbiente(amb)}: colunas dos dois ciclos`, c.itens.map((x) => x.col.nome).join(", "), { planilha: "" });
        await esperarEstrutura(amb);
        /* Chave composta (seção + sistema): o índice das planilhas que já têm linhas é refeito */
        if (!c.atual.chaveComposta) for (const l of localidadesDe(amb, { arquivadas: true }).filter((x) => x.contagem > 0)) { progresso.textContent = `${nomeAmbiente(amb)}: índice de ${l.nome}…`; await refazerIndiceEm(l.id, amb); }
        const p = planoPlanilhasTribunais(amb);
        const idsGrupo = new Map();
        let ordemGrupo = novaOrdem(gruposDe(amb));
        for (const g of p.grupos) {
          const gid = estado.api.novoId(COL_GRUPOS);
          idsGrupo.set(g.tmp, gid);
          await estado.api.salvarDoc(`${COL_GRUPOS}/${gid}`, { ambiente: amb, nome: g.nome, ordem: ordemGrupo++, criadoEm: "__AGORA__", ...assinaturaAdmin() });
        }
        const ordemPor = new Map();
        for (const x of p.planilhas) {
          const grupo = idsGrupo.get(x.grupo) || x.grupo;
          const ordem = ordemPor.has(grupo) ? ordemPor.get(grupo) : novaOrdem(estado.localidades.filter((l) => l.ambiente === amb && l.grupo === grupo));
          ordemPor.set(grupo, ordem + 1);
          const id = estado.api.novoId(COL_LOCALIDADES);
          progresso.textContent = `${nomeAmbiente(amb)}: ${x.nome}…`;
          await estado.api.salvarDoc(LOC(id), dadosNovaLocalidade(amb, { nome: x.nome, sigla: x.sigla, nomeCompleto: x.nomeCompleto, grupo, modo: x.modo, ...dadosSecoes(x.secoes), sistemasPadrao: x.sistemasPadrao, uf: "", codigo: "", responsavel: "", cor: "", icone: "i-predio", observacao: "" }, ordem));
          planilhas++;
          if (x.sistemasPadrao.length) linhas += await criarLinhasPadrao(id, amb, x.modo === "estado" ? x.secoes.map((s) => s.id) : [""], x.sistemasPadrao, { nova: true });
        }
        registrarAuditoria("localidade", `Estrutura de Tribunais e Órgãos em ${nomeAmbiente(amb)}: ${p.grupos.length} grupo(s), ${p.planilhas.length} planilha(s)`, p.planilhas.map((x) => x.nome).join(", ").slice(0, 1500), { planilha: "" });
      }
      progresso.textContent = "";
      d.close();
      mostrarAviso(`Estrutura criada: ${planilhas} planilha(s) e ${linhas} linha(s) dos sistemas padrão.`, 7000);
      if (!estado.ambiente) navegar({ tela: "painel", ambiente: lista[0] });
    } catch (err) { console.error(err); botao.disabled = false; progresso.textContent = ""; erro.textContent = mensagemErro(err); }
  });
  desenhar();
  d.showModal();
}
const nomeGrupoTribunais = (id) => (GRUPOS_TRIBUNAIS.find((g) => g.id === id) || { nome: id }).nome;
/* Espera o documento do ambiente voltar do servidor já com a estrutura nova (a chave composta vale nas gravações seguintes) */
function esperarEstrutura(amb) {
  return new Promise((ok) => {
    const ate = Date.now() + 8000;
    const ver = () => (estruturaDoAmbiente(amb).chaveComposta || Date.now() > ate ? ok() : setTimeout(ver, 150));
    ver();
  });
}
/* Linhas vazias dos sistemas padrão (secoes: ids das seções; [""] no modo por sistema), direto no arquivo compactado */
async function criarLinhasPadrao(loc, amb, secoes, sistemas, { nova = false } = {}) {
  const e = estruturaDoAmbiente(amb), col = e.colunaChave;
  if (!col || !sistemas.length || !secoes.length) return 0;
  const existentes = nova ? [] : (await dadosDaLocalidade(loc, { forcar: true })).registros;
  const ja = new Set(existentes.map((t) => `${t.secao || ""}|${nomeComparavel((t.campos || {})[col])}`));
  const agora = new Date().toISOString();
  const novos = [];
  secoes.forEach((s) => sistemas.forEach((nome) => {
    if (ja.has(`${s}|${nomeComparavel(nome)}`)) return;
    ja.add(`${s}|${nomeComparavel(nome)}`);
    novos.push(normalizarEquipamento({ id: estado.api.novoId(COL_LOCALIDADES), campos: { [col]: nome }, secao: s, numero: montarChave(nome, s, e.chaveComposta),
      criadoPor: estado.usuario.email, criadoPorNome: estado.usuario.nome, criadoPorEmail: estado.usuario.email, criadoEm: agora,
      atualizadoPor: estado.usuario.email, atualizadoPorNome: estado.usuario.nome, atualizadoPorEmail: estado.usuario.email, atualizadoEm: agora }));
  }));
  if (!novos.length) return 0;
  await gravarLinhasNoArquivo(loc, amb, { novos });
  return novos.length;
}
/* Acrescenta (e/ou altera) linhas no arquivo compactado de qualquer planilha: as linhas atuais continuam, os registros vivos
   valem por cima (os alterados recebem só os campos mudados), o índice da chave é criado para as novas e os números ficam exatos.
   alterar: Map id → campos que mudam. */
async function gravarLinhasNoArquivo(loc, amb, { novos = [], alterar = new Map() } = {}) {
  const [vivos, arquivo] = await Promise.all([estado.api.lerColecao(`${LOC(loc)}/registros`), estado.api.lerColecao(`${LOC(loc)}/arquivo`)]);
  const vivosN = vivos.map(normalizarEquipamento);
  const vivoPorId = new Map(vivosN.map((v) => [v.id, v]));
  const agora = new Date().toISOString();
  const autor = { atualizadoPor: estado.usuario.email, atualizadoPorNome: estado.usuario.nome, atualizadoPorEmail: estado.usuario.email };
  let mudouArquivo = !!novos.length;
  const linhas = combinarRegistros([], arquivo).map((t) => {
    const m = alterar.get(t.id);
    if (!m || vivoPorId.has(t.id)) return t;
    mudouArquivo = true;
    return { ...t, campos: { ...(t.campos || {}), ...m }, ...autor, atualizadoEm: agora };
  });
  if (mudouArquivo) await gravarArquivoEm(loc, [...linhas, ...novos], arquivo.map((p) => p.id));
  const opsVivos = [...alterar].filter(([id]) => vivoPorId.has(id)).map(([id, m]) => ({ op: "set", caminho: `${LOC(loc)}/registros/${id}`, mesclar: true, dados: { campos: m, ...autor, atualizadoEm: "__AGORA__" } }));
  for (let i = 0; i < opsVivos.length; i += 200) await estado.api.lote(opsVivos.slice(i, i + 200));
  if (novos.length) await gravarChavesEm(loc, amb, novos);
  const porId = new Map([...linhas, ...novos].map((t) => [t.id, t]));
  vivosN.forEach((v) => { const base = porId.get(v.id); const m = alterar.get(v.id); const x = v.parcial && base ? mesclarParcial(base, v) : v; porId.set(v.id, m ? { ...x, campos: { ...x.campos, ...m } } : x); });
  await gravarContadoresEm(loc, amb, [...porId.values()], localidadePorId(loc));
  cacheDados.delete(loc);
}
/* Índice da coluna chave refeito do zero (a chave passou a ser composta: seção + sistema) */
async function refazerIndiceEm(loc, amb) {
  const e = estruturaDoAmbiente(amb);
  const chaves = await estado.api.lerColecao(`${LOC(loc)}/chaves`);
  for (let i = 0; i < chaves.length; i += 400) await estado.api.lote(chaves.slice(i, i + 400).map((c) => ({ op: "delete", caminho: `${LOC(loc)}/chaves/${c.id}` })));
  const { registros } = await dadosDaLocalidade(loc, { forcar: true });
  if (e.colunaChave) await gravarChavesEm(loc, amb, registros);
}
/* "Aplicar às seções que não têm esses sistemas" (com prévia) */
async function aplicarSistemasPadrao(l, sistemas, secoes = l.secoes) {
  if (!sistemas.length) { mostrarAviso("Escreva os sistemas padrão (um por linha)."); return; }
  const e = estruturaDoAmbiente(l.ambiente);
  if (!e.colunaChave) { mostrarAviso("A cadeia ainda não tem a coluna chave (Sistema)."); return; }
  const { registros } = await dadosDaLocalidade(l.id, { forcar: true });
  const ja = new Set(registros.map((t) => `${t.secao || ""}|${nomeComparavel((t.campos || {})[e.colunaChave])}`));
  const alvo = porEstado(l) ? secoes.filter((s) => l.secoes.some((x) => x.id === s.id)) : [{ id: "", nome: tituloPlanilha(l) }];
  const faltam = alvo.map((s) => ({ s, nomes: sistemas.filter((n) => !ja.has(`${s.id}|${nomeComparavel(n)}`)) })).filter((x) => x.nomes.length);
  const total = faltam.reduce((s, x) => s + x.nomes.length, 0);
  if (!total) { mostrarAviso("Todas as seções já têm esses sistemas."); return; }
  if (!(await confirmar(`Criar ${total} linha(s) vazia(s) em ${faltam.length} seção(ões)?`, { titulo: "Aplicar sistemas padrão", botao: "Criar", html: `<ul class="previa-sistemas">${faltam.slice(0, 30).map((x) => `<li><strong>${escapar(x.s.nome)}</strong>: ${escapar(x.nomes.join(", "))}</li>`).join("")}${faltam.length > 30 ? `<li>… e mais ${faltam.length - 30} seção(ões)</li>` : ""}</ul>` }))) return;
  mostrarAviso("Criando as linhas…", 60000);
  try {
    let n = 0;
    for (const x of faltam) n += await criarLinhasPadrao(l.id, l.ambiente, [x.s.id], x.nomes);
    registrarAuditoria("localidade", `Sistemas padrão aplicados em ${l.nome}: ${n} linha(s)`, sistemas.join(", "), { planilha: l.id });
    mostrarAviso(`${n} linha(s) criada(s).`, 5000);
  } catch (err) { console.error(err); mostrarAviso(mensagemErro(err), 7000); }
}
/* Seções removidas que têm linhas: mover as linhas para outra seção ou mandar para a lixeira (planilha aberta) */
async function tratarSecoesRemovidas(l, removidas, final) {
  const aberta = estado.planilha === l.id && estado.carregouEquipamentos;
  const registros = aberta ? estado.equipamentos : (await dadosDaLocalidade(l.id, { forcar: true })).registros;
  const comLinhas = removidas.map((s) => ({ s, linhas: registros.filter((t) => t.secao === s.id) })).filter((x) => x.linhas.length);
  if (!comLinhas.length) return true;
  if (!aberta) { mostrarAviso(`Abra a planilha ${l.nome} para remover seções que têm linhas (${comLinhas.map((x) => x.s.nome).join(", ")}).`, 8000); return false; }
  return new Promise((resolver) => {
    let ok = false;
    const d = criarDialogo({ titulo: "Seções removidas com linhas", corpo: `<p class="apoio">Estas seções têm linhas. Para onde elas vão?</p>
      ${comLinhas.map((x, i) => `<label class="campo"><span class="rotulo">${escapar(x.s.nome)} · ${x.linhas.length} linha(s)</span><select name="destino-${i}">${final.map((s) => `<option value="${escapar(s.id)}">Mover para ${escapar(s.nome)}</option>`).join("")}<option value="__lixeira">Mandar para a lixeira</option></select></label>`).join("")}
      <p class="apoio" style="font-size:12px">Uma linha cujo sistema já existe na seção de destino fica em “Sem seção” para você conferir.</p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Continuar</button></div>` });
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const escolhas = comLinhas.map((x, i) => ({ ...x, destino: e.target.elements[`destino-${i}`].value }));
      d.querySelector("[type=submit]").disabled = true;
      try {
        for (const x of escolhas.filter((y) => y.destino === "__lixeira")) if (!(await excluirParaLixeira(x.linhas, `Seção removida: ${x.s.nome}`))) { d.close(); return; }
        for (const x of escolhas.filter((y) => y.destino !== "__lixeira")) await moverParaSecao(x.linhas, x.destino);
        ok = true;
        d.close();
      } catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); d.close(); }
    });
    d.addEventListener("close", () => resolver(ok));
    d.showModal();
  });
}
/* Muda a seção de linhas da planilha aberta (administradoras): seção + número + índice da chave. Quem tem o mesmo
   sistema no destino continua onde está (aparece em "Sem seção" se a seção antiga sumiu). */
async function moverParaSecao(lista, destino) {
  if (!ehAdmin()) return 0;
  const col = idChave();
  const ocupado = new Set(estado.equipamentos.filter((t) => t.secao === destino).map((t) => nomeComparavel((t.campos || {})[col])));
  const mover = lista.filter((t) => t.secao !== destino && (!col || !ocupado.has(nomeComparavel((t.campos || {})[col]))) && (ocupado.add(nomeComparavel((t.campos || {})[col])) || true));
  if (!mover.length) return 0;
  const ops = [], doArquivo = new Map();
  const agora = new Date().toISOString();
  mover.forEach((t) => {
    const antes = numeroDe(t.campos, t.secao), depois = numeroDe(t.campos, destino);
    if (antes) ops.push({ op: "delete", caminho: caminhoIndice(INDICES[0], antes) });
    if (depois) ops.push({ op: "set", caminho: caminhoIndice(INDICES[0], depois), dados: { registro: t.id } });
    if (t.arquivo && !estado.vivos.some((v) => v.id === t.id)) doArquivo.set(t.id, { ...t, secao: destino, numero: depois, ...autoria("atualizadoPor"), atualizadoEm: agora });
    else ops.push({ op: "set", caminho: `${P()}/${t.id}`, mesclar: true, dados: { secao: destino, ...(t.parcial ? {} : { numero: depois }), ...assinatura() } });
    ops.push(opHistorico(t.id, "editar", { coluna: "secao", colunaNome: "Seção", antes: nomeDaSecao(localidadePorId(estado.planilha), t.secao), depois: nomeDaSecao(localidadePorId(estado.planilha), destino) }));
  });
  if (doArquivo.size) await alterarArquivo(doArquivo);
  for (let i = 0; i < ops.length; i += 300) await estado.api.lote(ops.slice(i, i + 300));
  registrarAuditoria("editar", `Moveu ${mover.length} linha(s) para a seção ${nomeDaSecao(localidadePorId(estado.planilha), destino)}`, mover.map((t) => alvoRegistro(t)).join(", ").slice(0, 1500));
  return mover.length;
}
/* Linha da planilha aberta → outra seção (menu ⋯ da linha) */
function pedirMoverSecao(t) {
  const l = localidadePorId(estado.planilha);
  if (!ehAdmin() || !porEstado(l) || !l.secoes.length) return;
  const d = criarDialogo({ titulo: `Mover ${alvoRegistro(t)} para outra seção`, corpo: `
    <label class="campo"><span class="rotulo">Seção de destino</span><select name="destino">${l.secoes.map((s) => `<option value="${escapar(s.id)}"${s.id === t.secao ? " selected" : ""}>${escapar(s.nome)}</option>`).join("")}</select></label>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Mover</button></div>` });
  d.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const destino = e.target.destino.value;
    if (destino === t.secao) { d.close(); return; }
    try {
      const n = await moverParaSecao([t], destino);
      if (!n) { d.querySelector(".form-erro").textContent = "Esse sistema já existe na seção de destino."; return; }
      d.close();
      mostrarAviso(`Movido para ${nomeDaSecao(l, destino)}.`);
    } catch (err) { console.error(err); d.querySelector(".form-erro").textContent = mensagemErro(err); }
  });
  d.showModal();
}
/* Copiar grupos, planilhas e seções de uma cadeia para a outra, sem os dados (só o que falta; as seções que faltam
   nas planilhas iguais são acrescentadas). As linhas dos sistemas padrão nascem vazias nas planilhas novas. */
async function copiarEstruturaPara(destino, origem) {
  if (!ehAdmin() || !ehAmbiente(destino) || !ehAmbiente(origem) || destino === origem) return;
  const locs = localidadesDe(origem, { arquivadas: false });
  if (!locs.length) { mostrarAviso(`${nomeAmbiente(origem)} não tem planilhas para copiar.`); return; }
  const novasG = gruposDe(origem).filter((g) => !gruposDe(destino).some((x) => nomeComparavel(x.nome) === nomeComparavel(g.nome)));
  const novasP = locs.filter((l) => !mesmaLocalidadeEm(destino, l));
  const iguais = locs.map((l) => ({ l, d: mesmaLocalidadeEm(destino, l) })).filter((x) => x.d && porEstado(x.l));
  const secoesFaltando = iguais.map((x) => ({ ...x, faltam: x.l.secoes.filter((s) => !x.d.secoes.some((y) => y.id === s.id)) })).filter((x) => x.faltam.length);
  if (!novasG.length && !novasP.length && !secoesFaltando.length) { mostrarAviso(`${nomeAmbiente(destino)} já tem todos os grupos, planilhas e seções de ${nomeAmbiente(origem)}.`); return; }
  if (!(await confirmar(`Copiar de ${nomeAmbiente(origem)} para ${nomeAmbiente(destino)}: ${novasG.length} grupo(s), ${novasP.length} planilha(s)${secoesFaltando.length ? ` e seções que faltam em ${secoesFaltando.length} planilha(s)` : ""}? Os dados (linhas) não são copiados.`, { titulo: "Copiar estrutura", botao: "Copiar" }))) return;
  if (!ambienteConfigurado(destino) && ambienteConfigurado(origem) && await confirmar(`${nomeAmbiente(destino)} ainda não tem colunas. Copiar também as colunas de ${nomeAmbiente(origem)}?`, { titulo: "Colunas", botao: "Copiar as colunas" })) {
    await salvarEstrutura({ ...estruturaDoAmbiente(origem), versao: estruturaDoAmbiente(destino).versao + 1, titulo: `CADEIA ${nomeAmbiente(destino)}` }, destino);
    await esperarEstrutura(destino);
  }
  mostrarAviso("Copiando…", 60000);
  try {
    const mapaG = new Map(gruposDe(destino).map((g) => [nomeComparavel(g.nome), g.id]));
    let ordemG = novaOrdem(gruposDe(destino));
    for (const g of novasG) { const id = estado.api.novoId(COL_GRUPOS); mapaG.set(nomeComparavel(g.nome), id); await estado.api.salvarDoc(`${COL_GRUPOS}/${id}`, { ambiente: destino, nome: g.nome, ordem: ordemG++, criadoEm: "__AGORA__", ...assinaturaAdmin() }); }
    let linhas = 0;
    for (const l of novasP) {
      const grupo = grupoPorId(l.grupo) ? mapaG.get(nomeComparavel(nomeDoGrupo(l.grupo))) || "" : "";
      const id = estado.api.novoId(COL_LOCALIDADES);
      await estado.api.salvarDoc(LOC(id), dadosNovaLocalidade(destino, { nome: l.nome, sigla: l.sigla, nomeCompleto: l.nomeCompleto, grupo, modo: l.modo, ...dadosSecoes(l.secoes), sistemasPadrao: l.sistemasPadrao, uf: l.uf, codigo: l.codigo, responsavel: l.responsavel, cor: l.cor, icone: l.icone, observacao: l.observacao }, l.ordem));
      if (l.sistemasPadrao.length && estruturaDoAmbiente(destino).colunaChave) linhas += await criarLinhasPadrao(id, destino, porEstado(l) ? l.secoes.map((s) => s.id) : [""], l.sistemasPadrao, { nova: true });
    }
    for (const x of secoesFaltando) {
      await estado.api.salvarDoc(LOC(x.d.id), { ...dadosSecoes([...x.d.secoes, ...x.faltam]), ...assinaturaAdmin() }, true);
      if (x.d.sistemasPadrao.length) linhas += await criarLinhasPadrao(x.d.id, destino, x.faltam.map((s) => s.id), x.d.sistemasPadrao);
    }
    registrarAuditoria("localidade", `Copiou a estrutura de ${nomeAmbiente(origem)} para ${nomeAmbiente(destino)}: ${novasG.length} grupo(s), ${novasP.length} planilha(s)`, novasP.map((l) => l.nome).join(", ").slice(0, 1500), { planilha: "" });
    mostrarAviso(`Estrutura copiada para ${nomeAmbiente(destino)}${linhas ? ` (${linhas} linha(s) dos sistemas padrão)` : ""}.`, 7000);
  } catch (err) { console.error(err); mostrarAviso(mensagemErro(err), 8000); }
}

/* ---------- Colunas extras de uma planilha (além das do ambiente) ---------- */
const TIPOS_EXTRA = ["texto", "textoLongo", "numero", "data", "lista", "booleano", "link"];
function abrirColunasExtras(l = localidadePorId(estado.planilha)) {
  if (!ehAdmin() || !l) return;
  const e = estruturaDoAmbiente(l.ambiente);
  let extras = JSON.parse(JSON.stringify(l.colunasExtras || []));
  const d = criarDialogo({ titulo: `Colunas extras de ${l.nome}`, largo: true, corpo: `
    <p class="apoio">Colunas que só esta planilha tem. Elas aparecem depois das colunas de ${escapar(nomeAmbiente(l.ambiente))}, no grupo “Desta planilha”. As opções de lista das colunas extras são conferidas na interface.</p>
    <div class="tabela-admin"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Quem altera</th><th>Opções (lista: uma por linha)</th><th>Situação</th></tr></thead><tbody id="lista-extras"></tbody></table></div>
    <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-secundario btn-mini" data-ex="nova">${svg("i-mais")}Nova coluna extra</button></div>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}Salvar colunas extras</button></div>` });
  const form = d.querySelector("form");
  const desenhar = () => {
    $("#lista-extras", d).innerHTML = extras.map((c, i) => `<tr data-ex-i="${i}"${c.ativa === false ? ' class="arquivada"' : ""}>
      <td><input data-ex-campo="nome" value="${escapar(c.nome)}" maxlength="60" aria-label="Nome da coluna extra"></td>
      <td><select data-ex-campo="tipo"${c.id ? " disabled" : ""}>${TIPOS_EXTRA.map((t) => `<option value="${t}"${c.tipo === t ? " selected" : ""}>${escapar(NOME_TIPO[t])}</option>`).join("")}</select></td>
      <td><select data-ex-campo="acesso"><option value="livre"${c.acesso !== "bloqueado" ? " selected" : ""}>${c.tipo === "lista" ? "LISTA (Equipe N2 escolhe)" : "LIVRE (Equipe N2)"}</option><option value="bloqueado"${c.acesso === "bloqueado" ? " selected" : ""}>BLOQUEADO (só administradoras)</option></select></td>
      <td>${c.tipo === "lista" ? `<textarea data-ex-campo="opcoes" rows="2" aria-label="Opções">${escapar((c.opcoes || []).filter((o) => o.ativa !== false).map((o) => o.nome).join("\n"))}</textarea>` : '<span class="apoio">—</span>'}</td>
      <td><button type="button" class="btn btn-secundario btn-mini" data-ex="arquivar">${c.ativa === false ? "Reativar" : "Arquivar"}</button></td></tr>`).join("") || '<tr><td colspan="5" class="apoio">Nenhuma coluna extra.</td></tr>';
  };
  d.addEventListener("input", (ev) => {
    const tr = ev.target.closest("[data-ex-i]");
    if (!tr) return;
    const c = extras[Number(tr.dataset.exI)], k = ev.target.dataset.exCampo;
    if (k === "nome") c.nome = ev.target.value.slice(0, 60);
    if (k === "acesso") c.acesso = ev.target.value === "bloqueado" ? "bloqueado" : c.tipo === "lista" ? "lista" : "livre";
    if (k === "tipo") { c.tipo = ev.target.value; c.acesso = c.tipo === "lista" ? "lista" : "livre"; desenhar(); }
    if (k === "opcoes") c.textoOpcoes = ev.target.value;
  });
  d.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ex]");
    if (!b) return;
    if (b.dataset.ex === "nova") { extras.push({ id: "", nome: "", tipo: "texto", acesso: "livre", ativa: true, opcoes: [] }); desenhar(); }
    if (b.dataset.ex === "arquivar") { const c = extras[Number(b.closest("[data-ex-i]").dataset.exI)]; if (!c.id) extras = extras.filter((x) => x !== c); else c.ativa = c.ativa === false; desenhar(); }
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erro = form.querySelector(".form-erro");
    const usados = [...e.colunas.map((c) => c.id), ...extras.map((c) => c.id).filter(Boolean)];
    const finais = [];
    for (const c of extras) {
      const nome = String(c.nome || "").trim();
      if (!nome) { erro.textContent = "Dê um nome a cada coluna extra."; return; }
      if ([...e.colunas, ...finais].some((x) => normalizar(x.nome) === normalizar(nome))) { erro.textContent = `Já existe uma coluna “${nome}”.`; return; }
      const id = c.id || idUnico(`extra ${nome}`, usados, true);
      usados.push(id);
      let opcoes = c.opcoes || [];
      if (c.tipo === "lista" && typeof c.textoOpcoes === "string") {
        const nomes = [...new Set(c.textoOpcoes.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))].slice(0, MAX_OPCOES);
        const existentes = new Map(opcoes.map((o) => [normalizar(o.nome), o]));
        const ids = opcoes.map((o) => o.id);
        const ativas = nomes.map((n) => { const o = existentes.get(normalizar(n)); if (o) return { ...o, nome: n, ativa: true }; const nid = idUnico(n, ids); ids.push(nid); return { id: nid, nome: n, cor: "" }; });
        const removidas = opcoes.filter((o) => !ativas.some((x) => x.id === o.id)).map((o) => ({ ...o, ativa: false, removidaEm: o.removidaEm || new Date().toISOString(), removidaPor: o.removidaPor || estado.usuario.email }));
        opcoes = [...ativas.map(({ ativa, removidaEm, removidaPor, ...o }) => o), ...removidas];
      }
      if (c.tipo === "lista" && !opcoes.some((o) => o.ativa !== false)) { erro.textContent = `Adicione ao menos uma opção em “${nome}”.`; return; }
      finais.push(colunaBase(id, nome.slice(0, 60), c.tipo, { grupo: GRUPO_EXTRAS, acesso: c.acesso === "bloqueado" ? "bloqueado" : c.tipo === "lista" ? "lista" : "livre", somenteAdmin: c.acesso === "bloqueado", ativa: c.ativa !== false, opcoes: c.tipo === "lista" ? opcoes : [], ordem: finais.length + 1 }));
    }
    const norm = finais.map((c, i) => normalizarColuna(c, [{ id: GRUPO_EXTRAS }], i)).map(({ extra, ...c }) => c);
    try {
      await estado.api.salvarDoc(LOC(l.id), { colunasExtras: norm, colunasEquipeExtras: norm.filter((c) => c.ativa && !c.somenteAdmin).map((c) => c.id), ...assinaturaAdmin() }, true);
      registrarAuditoria("estrutura", `Colunas extras de ${l.nome}: ${norm.map((c) => c.nome).join(", ") || "nenhuma"}`, "", { planilha: l.id });
      d.close();
      mostrarAviso("Colunas extras salvas.");
    } catch (err) { console.error(err); erro.textContent = mensagemErro(err); }
  });
  desenhar();
  d.showModal();
}
/* "Duplicar estrutura extra": copia as colunas extras de outra planilha do mesmo ambiente */
function copiarColunasExtras(destino) {
  const fontes = localidadesDe(destino.ambiente, { arquivadas: true }).filter((l) => l.id !== destino.id && l.colunasExtras.length);
  if (!fontes.length) { mostrarAviso("Nenhuma outra planilha tem colunas extras."); return; }
  const d = criarDialogo({ titulo: `Copiar colunas extras para ${destino.nome}`, corpo: `
    <label class="campo"><span class="rotulo">Copiar de</span><select name="de">${fontes.map((l) => `<option value="${escapar(l.id)}">${escapar(l.nome)} (${l.colunasExtras.map((c) => c.nome).join(", ")})</option>`).join("")}</select></label>
    <p class="apoio" style="font-size:12px">As colunas extras de ${escapar(destino.nome)} são substituídas (os valores já gravados continuam nos registros).</p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Copiar</button></div>` });
  d.querySelector("form").addEventListener("submit", async (e) => {
    const fonte = localidadePorId(e.target.de.value);
    if (!fonte) return;
    try {
      await estado.api.salvarDoc(LOC(destino.id), { colunasExtras: fonte.colunasExtras, colunasEquipeExtras: fonte.colunasExtras.filter((c) => c.ativa !== false && !c.somenteAdmin && c.acesso !== "bloqueado").map((c) => c.id), ...assinaturaAdmin() }, true);
      registrarAuditoria("estrutura", `Copiou as colunas extras de ${fonte.nome} para ${destino.nome}`, "", { planilha: destino.id });
      mostrarAviso("Colunas extras copiadas.");
    } catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); }
  });
  d.showModal();
}

/* ---------- Excluir localidade (vai para a lixeira com os registros) e restaurar ---------- */
const COL_PARTES = (id) => `${COL_BACKUPS}/${id}/partes`;
function partesDeBackup(registros) {
  const partes = [];
  let atual = [], tamanho = 0;
  registros.forEach((r) => { const n = bytes(JSON.stringify(r)) + 1; if (atual.length && tamanho + n > LIMITE_PARTE) { partes.push(atual); atual = []; tamanho = 0; } atual.push(r); tamanho += n; });
  if (atual.length) partes.push(atual);
  return partes;
}
const RE_DADOS_DOC = /^[^/]{1,1500}$/;
async function excluirLocalidade(l) {
  if (!(await confirmarDigitando(`Excluir a planilha “${l.nome}” com os ${l.contagem} registro(s)? Ela vai para “Planilhas excluídas” (Administração), de onde dá para restaurar.`, l.nome, { titulo: "Excluir localidade", botao: "Excluir localidade" }))) return;
  mostrarAviso("Guardando a planilha na lixeira…", 60000);
  try {
    const [vivos, arquivo, chaves] = await Promise.all([estado.api.lerColecao(`${LOC(l.id)}/registros`), estado.api.lerColecao(`${LOC(l.id)}/arquivo`), estado.api.lerColecao(`${LOC(l.id)}/chaves`)]);
    const registros = combinarRegistros(vivos.map(normalizarEquipamento), arquivo).map((t) => ({ id: t.id, dados: registroBackup(t) }));
    const bid = estado.api.novoId(COL_BACKUPS);
    const partes = partesDeBackup(registros);
    const { id, contagem, resumo, hoje, ...doc } = l;
    const ops = [{ op: "set", caminho: `${COL_BACKUPS}/${bid}`, dados: { motivo: `Planilha excluída: ${l.nome}`.slice(0, 200), criadoPor: estado.usuario.email, criadoEm: "__AGORA__", planilha: l.id, tipo: "localidade", totalRegistros: registros.length, partes: partes.length, versaoEstrutura: 0, estrutura: JSON.stringify(null) } }];
    partes.forEach((p, i) => ops.push({ op: "set", caminho: `${COL_PARTES(bid)}/${i}`, dados: { indice: i, json: JSON.stringify(p) } }));
    ops.push({ op: "set", caminho: `${COL_LIXEIRA}/loc-${l.id}`, dados: { tipo: "localidade", planilha: "", ambiente: l.ambiente, localidade: JSON.stringify({ ...doc, id: l.id }), backup: bid, totalRegistros: registros.length, excluidoPor: estado.usuario.email, excluidoEm: "__AGORA__", motivo: "" } });
    await estado.api.lote(ops);
    const apagar = [...vivos.map((t) => `${LOC(l.id)}/registros/${t.id}`), ...arquivo.map((p) => `${LOC(l.id)}/arquivo/${p.id}`), ...chaves.map((c) => `${LOC(l.id)}/chaves/${c.id}`)];
    for (let i = 0; i < apagar.length; i += 400) await estado.api.lote(apagar.slice(i, i + 400).map((caminho) => ({ op: "delete", caminho })));
    await estado.api.lote([{ op: "delete", caminho: LOC(l.id) }]);
    cacheDados.delete(l.id);
    registrarAuditoria("excluirLocalidade", `Excluiu a planilha ${l.nome} (${registros.length} registro(s)) de ${nomeAmbiente(l.ambiente)}`, "Guardada em Planilhas excluídas", { planilha: l.id });
    mostrarAviso(`“${l.nome}” foi para Planilhas excluídas.`, 6000);
    if (estado.planilha === l.id) navegar({ tela: "painel", ambiente: l.ambiente });
  } catch (err) { console.error(err); mostrarAviso(`Não foi possível excluir. ${mensagemErro(err)}`, 8000); }
}
/* Grava registros direto no arquivo compactado de QUALQUER localidade (importação e restauração) */
async function gravarArquivoEm(loc, lista, antigos = []) {
  const versao = Date.now();
  const grupos = dividirArquivo(lista);
  const ops = grupos.map((g, i) => ({ op: "set", caminho: `${LOC(loc)}/arquivo/v${versao}-${String(i).padStart(3, "0")}`, dados: dadosParte(versao, i, grupos.length, jsonParte(g)) }));
  for (let i = 0; i < ops.length; i += 20) await estado.api.lote(ops.slice(i, i + 20));
  if (antigos.length) for (let i = 0; i < antigos.length; i += 400) await estado.api.lote(antigos.slice(i, i + 400).map((id) => ({ op: "delete", caminho: `${LOC(loc)}/arquivo/${id}` })));
  return grupos.length;
}
/* Índice da coluna chave (um documento por valor) para registros gravados no arquivo de uma planilha */
async function gravarChavesEm(loc, amb, lista) {
  const e = estruturaDoAmbiente(amb);
  if (!e.colunaChave) return;
  const usados = new Set(), ops = [];
  lista.forEach((t) => { const v = (t.campos || {})[e.colunaChave]; const k = estaVazio(v) ? "" : montarChave(v, t.secao, e.chaveComposta); if (!k || !chaveIndiceValida(k) || usados.has(k)) return; usados.add(k); ops.push({ op: "set", caminho: `${LOC(loc)}/chaves/${k}`, dados: { registro: t.id } }); });
  for (let i = 0; i < ops.length; i += 400) await estado.api.lote(ops.slice(i, i + 400));
}
/* Contagem e resumo exatos de uma lista de registros, gravados na planilha (administradoras) */
async function gravarContadoresEm(loc, amb, lista, l = localidadePorId(loc)) {
  const c = colResumoDe(amb), resumo = {};
  if (c) lista.forEach((t) => { const v = valorDoResumo(t.campos, c); if (v) resumo[v] = (resumo[v] || 0) + 1; });
  const apagar = l ? Object.fromEntries(Object.keys(l.resumo || {}).filter((k) => !(k in resumo)).map((k) => [k, "__APAGAR__"])) : {};
  await estado.api.salvarDoc(LOC(loc), { contagem: lista.length, resumo: { ...apagar, ...resumo }, atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email, atualizadoPorNome: estado.usuario.nome }, true);
}
function abrirLocalidadesExcluidas() {
  if (!ehAdmin()) return;
  const d = criarDialogo({ titulo: "Planilhas excluídas", largo: true, corpo: `<p class="apoio">Restaurar devolve a planilha (com as linhas) ao lugar. Excluir de vez não tem volta.</p><div class="tabela-admin" id="lista-loc-excluidas"><p class="apoio" style="padding:12px">Carregando…</p></div>` });
  let lista = [];
  const desenhar = async () => {
    try { lista = await estado.api.lerColecao(COL_LIXEIRA, { onde: ["tipo", "==", "localidade"] }); }
    catch (e) { console.warn(e); $("#lista-loc-excluidas", d).innerHTML = '<p class="apoio" style="padding:12px">Não foi possível carregar.</p>'; return; }
    const nomeDe = (x) => { try { return JSON.parse(x.localidade || "{}").nome || x.id; } catch (e) { return x.id; } };
    $("#lista-loc-excluidas", d).innerHTML = lista.length ? `<table><thead><tr><th>Planilha</th><th>Cadeia</th><th>Registros</th><th>Excluída em</th><th>Por</th><th></th></tr></thead><tbody>${lista.sort((a, b) => String(b.excluidoEm).localeCompare(String(a.excluidoEm))).map((x) => `<tr>
      <td>${escapar(nomeDe(x))}</td><td>${escapar(nomeAmbiente(x.ambiente))}</td><td>${escapar(x.totalRegistros || 0)}</td><td>${escapar(formatarData(x.excluidoEm, true))}</td><td>${escapar(nomePessoa(x.excluidoPor))}</td>
      <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-lx-loc="restaurar" data-id="${escapar(x.id)}">${svg("i-restaurar")}Restaurar</button><button type="button" class="btn btn-perigo btn-mini" data-lx-loc="apagar" data-id="${escapar(x.id)}">Excluir de vez</button></td></tr>`).join("")}</tbody></table>`
      : '<p class="apoio" style="padding:12px">Nenhuma planilha excluída.</p>';
  };
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-lx-loc]");
    if (!b) return;
    const x = lista.find((y) => y.id === b.dataset.id);
    if (!x) return;
    let doc = {};
    try { doc = JSON.parse(x.localidade || "{}"); } catch (err) { doc = {}; }
    if (b.dataset.lxLoc === "restaurar") {
      if (!doc.id || !ehAmbiente(doc.ambiente)) { mostrarAviso("Os dados desta planilha estão incompletos."); return; }
      if (nomeLocalidadeRepetido(doc.ambiente, doc.nome)) { mostrarAviso(`Já existe uma planilha “${doc.nome}” em ${nomeAmbiente(doc.ambiente)}. Renomeie a atual antes de restaurar.`, 7000); return; }
      b.disabled = true;
      mostrarAviso("Restaurando…", 60000);
      try {
        const partes = await estado.api.lerColecao(COL_PARTES(x.backup));
        const registros = partes.sort((p, q) => p.indice - q.indice).flatMap((p) => JSON.parse(p.json || "[]")).filter((r) => r && typeof r.id === "string" && RE_ID_DOC.test(r.id));
        const lista2 = registros.map(equipamentoDeRegistro);
        const { id, ...resto } = doc;
        await estado.api.salvarDoc(LOC(id), { ...resto, ambiente: doc.ambiente, grupo: grupoPorId(doc.grupo) ? doc.grupo : "", contagem: 0, resumo: {}, hoje: null, ...assinaturaAdmin(), atualizadoPorNome: estado.usuario.nome, ultimoRegistro: "" });
        await gravarArquivoEm(id, lista2);
        await gravarChavesEm(id, doc.ambiente, lista2);
        await gravarContadoresEm(id, doc.ambiente, lista2, null);
        await estado.api.lote([{ op: "delete", caminho: `${COL_LIXEIRA}/${x.id}` }]);
        registrarAuditoria("restaurarLocalidade", `Restaurou a planilha ${doc.nome} (${lista2.length} registro(s))`, "", { planilha: id });
        mostrarAviso(`“${doc.nome}” restaurada.`, 5000);
        desenhar();
      } catch (err) { console.error(err); b.disabled = false; mostrarAviso(mensagemErro(err), 7000); }
    }
    if (b.dataset.lxLoc === "apagar" && await confirmarDigitando(`Excluir de vez “${doc.nome || x.id}” e os ${x.totalRegistros || 0} registro(s)? Não tem volta.`, String(doc.nome || x.id), { titulo: "Excluir de vez", botao: "Excluir de vez" })) {
      try {
        const partes = x.backup ? await estado.api.lerColecao(COL_PARTES(x.backup)) : [];
        await estado.api.lote([...partes.map((p) => ({ op: "delete", caminho: `${COL_PARTES(x.backup)}/${p.id}` })), ...(x.backup ? [{ op: "delete", caminho: `${COL_BACKUPS}/${x.backup}` }] : []), { op: "delete", caminho: `${COL_LIXEIRA}/${x.id}` }]);
        registrarAuditoria("excluirDeVez", `Excluiu de vez a planilha ${doc.nome || x.id}`, "", { planilha: doc.id || "" });
        desenhar();
      } catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); }
    }
  });
  desenhar();
  d.showModal();
}

/* ---------- Assistente "Começar": cadeias, colunas e primeiras localidades ---------- */
function abrirAssistente() {
  if (!ehAdmin()) return;
  let passo = 1;
  const d = criarDialogo({ titulo: "Começar: cadeias V6 e V12", largo: true, corpo: `
    <ol class="passos-importacao" id="passos-assistente"><li data-passo="1">Cadeias</li><li data-passo="2">Colunas</li><li data-passo="3">Primeiras planilhas</li></ol>
    <div id="assistente-corpo"></div>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button><button type="button" class="btn btn-secundario" data-as="voltar">Voltar</button><button type="button" class="btn" data-as="avancar">Avançar</button></div>` });
  const corpo = $("#assistente-corpo", d), erro = d.querySelector(".form-erro");
  const desenhar = () => {
    erro.textContent = "";
    $$("#passos-assistente li", d).forEach((li) => { if (Number(li.dataset.passo) === passo) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current"); });
    $('[data-as="voltar"]', d).hidden = passo === 1;
    $('[data-as="avancar"]', d).textContent = passo === 3 ? "Concluir" : "Avançar";
    if (passo === 1) {
      corpo.innerHTML = AMBIENTES.map((a) => `<fieldset class="assistente-ambiente" style="--cor-card:${escapar(corAmbiente(a.id))}"><legend>Cadeia ${escapar(a.nome)}</legend>
        <label class="campo"><span class="rotulo">Descrição curta</span><textarea name="descricao-${a.id}" maxlength="200" rows="2" placeholder="Ex.: Informações da cadeia ${escapar(a.nome)}">${escapar(descricaoAmbiente(a.id))}</textarea></label>
        <div class="campo"><span class="rotulo">Cor de destaque</span>${seletorCor(`cor-${a.id}`, corAmbiente(a.id))}</div></fieldset>`).join("");
    } else if (passo === 2) {
      corpo.innerHTML = `<p class="apoio">Nenhuma coluna é inventada: cada cadeia começa sem colunas até você definir. Elas valem para todas as planilhas da cadeia.</p>
        ${AMBIENTES.map((a) => { const n = estruturaDoAmbiente(a.id).colunas.length; const outro = outroAmbiente(a.id); return `<fieldset class="assistente-ambiente" style="--cor-card:${escapar(corAmbiente(a.id))}"><legend>Colunas de ${escapar(a.nome)}</legend>
          <p class="apoio">${n ? `${n} coluna(s): ${escapar(estruturaDoAmbiente(a.id).colunas.map((c) => c.nome).join(", ").slice(0, 300))}` : "Ainda sem colunas."}</p>
          <div class="form-botoes" style="justify-content:flex-start">
            <button type="button" class="btn btn-secundario btn-mini" data-as="zero" data-amb="${a.id}">${svg("i-colunas")}${n ? "Editar as colunas" : "Definir do zero"}</button>
            ${estruturaDoAmbiente(outro).colunas.length ? `<button type="button" class="btn btn-secundario btn-mini" data-as="copiar" data-amb="${a.id}">${svg("i-copiar")}Copiar as colunas de ${escapar(nomeAmbiente(outro))}</button>` : ""}
            <button type="button" class="btn btn-secundario btn-mini" data-as="excel" data-amb="${a.id}">${svg("i-upload")}A partir da 1ª linha de um Excel</button>
          </div></fieldset>`; }).join("")}`;
    } else {
      corpo.innerHTML = `<p class="apoio">Uma planilha por linha, no formato <strong>Grupo › Planilha</strong> (ou Grupo; Planilha). Sem grupo, escreva só o nome. Para criar muitas de uma vez com os registros, use “Importar Excel” (uma aba por localidade).</p>
        ${AMBIENTES.map((a) => `<label class="campo"><span class="rotulo">Planilhas de ${escapar(a.nome)} (${localidadesDe(a.id).length} já criadas)</span><textarea name="locs-${a.id}" rows="4" placeholder="Sudeste › São Paulo - Barueri&#10;Sudeste › Rio de Janeiro - Centro&#10;Sul › Curitiba"></textarea></label>`).join("")}
        <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-secundario btn-mini" data-as="importar">${svg("i-upload")}Importar Excel (cada aba vira uma planilha)</button></div>`;
    }
  };
  const form = d.querySelector("form");
  async function salvarPasso() {
    if (passo === 1) {
      for (const a of AMBIENTES) await salvarAmbienteMeta(a.id, { descricao: form.elements[`descricao-${a.id}`].value.trim(), cor: corEscolhida(form, `cor-${a.id}`, corAmbiente(a.id)) });
    }
    if (passo === 3) {
      let criadas = 0;
      for (const a of AMBIENTES) {
        const linhas = form.elements[`locs-${a.id}`].value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (!linhas.length) continue;
        const grupos = new Map(gruposDe(a.id).map((g) => [nomeComparavel(g.nome), g.id]));
        const ops = [];
        let ordemGrupo = novaOrdem(gruposDe(a.id));
        const ordemPorGrupo = new Map();
        const nomesNovos = new Set();
        for (const linha of linhas) {
          const partes = linha.split(/\s*(?:›|>|;|\t)\s*/).filter(Boolean);
          const nome = partes.pop().slice(0, 80), grupoNome = partes.join(" ").slice(0, 60);
          if (!nome || nomeLocalidadeRepetido(a.id, nome) || nomesNovos.has(nomeComparavel(nome))) continue;
          nomesNovos.add(nomeComparavel(nome));
          let gid = "";
          if (grupoNome) {
            gid = grupos.get(nomeComparavel(grupoNome));
            if (!gid) { gid = estado.api.novoId(COL_GRUPOS); grupos.set(nomeComparavel(grupoNome), gid); ops.push({ op: "set", caminho: `${COL_GRUPOS}/${gid}`, dados: { ambiente: a.id, nome: grupoNome, ordem: ordemGrupo++, criadoEm: "__AGORA__", ...assinaturaAdmin() } }); }
          }
          const base = ordemPorGrupo.has(gid) ? ordemPorGrupo.get(gid) : novaOrdem(estado.localidades.filter((l) => l.ambiente === a.id && l.grupo === gid));
          ordemPorGrupo.set(gid, base + 1);
          ops.push({ op: "set", caminho: LOC(estado.api.novoId(COL_LOCALIDADES)), dados: dadosNovaLocalidade(a.id, { nome, grupo: gid, uf: "", codigo: "", responsavel: "", cor: "", icone: "i-pino", observacao: "" }, base) });
          criadas++;
        }
        for (let i = 0; i < ops.length; i += 400) await estado.api.lote(ops.slice(i, i + 400));
      }
      if (criadas) { registrarAuditoria("localidade", `Assistente: criou ${criadas} planilha(s)`, "", { planilha: "" }); mostrarAviso(`${criadas} planilha(s) criada(s).`); }
    }
  }
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-as]");
    if (!b) return;
    const a = b.dataset.as, amb = b.dataset.amb;
    try {
      if (a === "avancar") { b.disabled = true; await salvarPasso(); b.disabled = false; if (passo === 3) { d.close(); if (!estado.ambiente) navegar({ tela: "painel", ambiente: "v6" }); return; } passo++; desenhar(); }
      if (a === "voltar") { passo = Math.max(1, passo - 1); desenhar(); }
      if (a === "zero") { d.close(); definirAmbiente(amb); abrirEstrutura(); }
      if (a === "copiar") {
        const fonte = estruturaDoAmbiente(outroAmbiente(amb));
        if (estruturaDoAmbiente(amb).colunas.length && !(await confirmar(`${nomeAmbiente(amb)} já tem colunas. Substituir pelas de ${nomeAmbiente(outroAmbiente(amb))}? Os registros já gravados continuam, mas colunas que não existirem lá deixam de aparecer.`, { titulo: "Copiar colunas", botao: "Substituir" }))) return;
        await salvarEstrutura({ ...fonte, versao: estruturaDoAmbiente(amb).versao + 1, titulo: `CADEIA ${nomeAmbiente(amb)}` }, amb);
        registrarAuditoria("estrutura", `Copiou as colunas de ${nomeAmbiente(outroAmbiente(amb))} para ${nomeAmbiente(amb)}`, fonte.colunas.map((c) => c.nome).join(", "), { planilha: "" });
        mostrarAviso("Colunas copiadas.");
        desenhar();
      }
      if (a === "excel") colunasDoExcel(amb, desenhar);
      if (a === "importar") { d.close(); if (!estado.ambiente) definirAmbiente("v6"); abrirImportarExcel(); }
    } catch (err) { console.error(err); b.disabled = false; erro.textContent = mensagemErro(err); }
  });
  desenhar();
  d.showModal();
}
/* Colunas a partir da 1ª linha de um Excel (ou CSV): cada título vira uma coluna; dá para escolher o tipo e a chave */
async function colunasDoExcel(amb, depois = () => {}) {
  const arquivo = await escolherArquivo(".xlsx,.xls,.ods,.csv,.txt");
  if (!arquivo) return;
  let titulos = [];
  try { const abas = await lerPlanilhaExcel(arquivo); titulos = (abas[0] && abas[0].cabecalho) || []; }
  catch (e) { console.error(e); mostrarAviso(e.message || "Não foi possível ler o arquivo."); return; }
  titulos = [...new Set(titulos.map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 80);
  if (!titulos.length) { mostrarAviso("A primeira linha do arquivo está vazia."); return; }
  const d = criarDialogo({ titulo: `Colunas de ${nomeAmbiente(amb)} a partir de “${arquivo.name.slice(0, 60)}”`, largo: true, corpo: `
    <p class="lgpd">${escapar(AVISO_LGPD_COLUNAS)}</p>
    <div class="tabela-admin"><table><thead><tr><th>Usar</th><th>Coluna</th><th>Tipo</th><th>Chave</th></tr></thead><tbody>${titulos.map((t, i) => `<tr>
      <td><input type="checkbox" name="usar-${i}" checked aria-label="Usar ${escapar(t)}"></td><td><input name="nome-${i}" value="${escapar(t.slice(0, 60))}" maxlength="60"></td>
      <td><select name="tipo-${i}">${["texto", "textoLongo", "numero", "data", "lista", "status", "booleano", "link"].map((x) => `<option value="${x}">${escapar(NOME_TIPO[x])}</option>`).join("")}</select></td>
      <td><input type="radio" name="chave" value="${i}"${i === 0 ? " checked" : ""} aria-label="${escapar(t)} é a coluna chave"></td></tr>`).join("")}</tbody></table></div>
    <p class="apoio" style="font-size:12px">Colunas de lista começam sem opções: ao importar o Excel, cada valor encontrado pode entrar na lista (“Acrescentar à lista”), ou cadastre as opções em Estrutura. Tudo dá para ajustar depois em Estrutura.</p>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-check")}Criar as colunas</button></div>` });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const base = estruturaDoAmbiente(amb);
    if (base.colunas.length && !(await confirmar(`${nomeAmbiente(amb)} já tem ${base.colunas.length} coluna(s). As novas entram depois delas (nomes repetidos ficam de fora).`, { titulo: "Acrescentar colunas", botao: "Acrescentar" }))) return;
    const ids = base.colunas.map((c) => c.id), nomes = new Set(base.colunas.map((c) => normalizar(c.nome)));
    const novas = [];
    let chave = base.colunaChave;
    titulos.forEach((t, i) => {
      if (!form.elements[`usar-${i}`].checked) return;
      const nome = form.elements[`nome-${i}`].value.trim().slice(0, 60);
      if (!nome || nomes.has(normalizar(nome))) return;
      nomes.add(normalizar(nome));
      const tipo = form.elements[`tipo-${i}`].value;
      const id = idUnico(nome, ids, true);
      ids.push(id);
      const lista = TIPOS_LISTA.includes(tipo);
      novas.push(colunaBase(id, nome, tipo, { acesso: lista ? "lista" : "livre", opcoes: [], ordem: base.colunas.length + novas.length + 1 }));
      if (form.chave.value === String(i) && !lista) chave = id;
    });
    if (!novas.length) { form.querySelector(".form-erro").textContent = "Nenhuma coluna nova para criar."; return; }
    try {
      await salvarEstrutura({ ...base, colunas: [...base.colunas, ...novas], colunaChave: chave || "", versao: base.versao + 1 }, amb);
      registrarAuditoria("estrutura", `Criou ${novas.length} coluna(s) em ${nomeAmbiente(amb)} a partir de um Excel`, novas.map((c) => c.nome).join(", "), { planilha: "" });
      d.close();
      mostrarAviso(`${novas.length} coluna(s) criada(s) em ${nomeAmbiente(amb)}.`);
      depois();
    } catch (err) { console.error(err); form.querySelector(".form-erro").textContent = mensagemErro(err); }
  });
  d.showModal();
}


/* ============================================================
 *  Importar Excel (.xlsx com várias abas): cada aba vira uma planilha
 *  Leitura com SheetJS 0.20.3, copiada em assets/ (a CSP só permite scripts do próprio site) e carregada só aqui.
 *  Os registros entram direto no arquivo compactado da localidade (poucas gravações: o plano gratuito agradece).
 * ============================================================ */
const ARQUIVO_SHEETJS = "assets/xlsx-0.20.3.full.min.js";
let promessaSheetJS = null;
function carregarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!promessaSheetJS) promessaSheetJS = new Promise((ok, falhou) => {
    const s = document.createElement("script");
    s.src = ARQUIVO_SHEETJS;
    s.onload = () => (window.XLSX ? ok(window.XLSX) : falhou(new Error("Leitor de Excel indisponível.")));
    s.onerror = () => { promessaSheetJS = null; falhou(new Error("Não foi possível carregar o leitor de Excel.")); };
    document.head.appendChild(s);
  });
  return promessaSheetJS;
}
function escolherArquivo(aceita) {
  return new Promise((ok) => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = aceita;
    i.addEventListener("change", () => ok(i.files[0] || null));
    i.click();
  });
}
const MAX_LINHAS_ABA = 20000, MAX_ARQUIVO_EXCEL = 15 * 1024 * 1024;
/* [{ nome (da aba), cabecalho: [títulos], linhas: [[valores]] }]. CSV = uma aba só. */
async function lerPlanilhaExcel(arquivo) {
  if (arquivo.size > MAX_ARQUIVO_EXCEL) throw new Error("Arquivo grande demais (máximo de 15 MB).");
  if (/\.(csv|txt)$/i.test(arquivo.name)) {
    let texto = await arquivo.text();
    if (texto.includes("\ufffd")) { try { texto = new TextDecoder("windows-1252").decode(await arquivo.arrayBuffer()); } catch (e) { /* fica o texto lido */ } }
    const t = lerTabelaTexto(texto);
    return [{ nome: arquivo.name.replace(/\.[^.]+$/, ""), cabecalho: (t[0] || []).map((x) => String(x).trim()), linhas: t.slice(1) }];
  }
  const XLSX = await carregarSheetJS();
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: "array", cellDates: true, dense: true });
  return wb.SheetNames.map((nome) => {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, defval: "", blankrows: false, dateNF: "dd/mm/yyyy" })
      .map((l) => l.map((v) => String(v == null ? "" : v).trim())).filter((l) => l.some(Boolean));
    return { nome: String(nome).trim(), cabecalho: linhas[0] || [], linhas: linhas.slice(1, MAX_LINHAS_ABA + 1), cortadas: Math.max(0, linhas.length - 1 - MAX_LINHAS_ABA) };
  });
}
const chaveImportacaoExcel = () => chavePessoa("importacao-excel");
function abrirImportarExcel() {
  if (!ehAdmin() || !estado.ambiente) return;
  const amb = estado.ambiente;
  const e = estruturaDoAmbiente(amb);
  const cols = e.colunas.filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo));
  const pendente = lerLocal(chaveImportacaoExcel(), null);
  if (!cols.length) { mostrarAviso(`${nomeAmbiente(amb)} ainda não tem colunas. Defina as colunas primeiro (Administração › Começar).`, 7000); return; }
  let abas = [], mapa = new Map(), trocas = new Map(), novasOpcoes = new Map(), existentes = new Map(), analise = null;
  /* Todos os valores fora da lista já vistos (um valor aceito como opção nova deixa de aparecer como "fora") */
  const foraVistos = new Map();
  const d = criarDialogo({ titulo: `Importar Excel em ${nomeAmbiente(amb)}`, largo: true, corpo: `
    <p class="lgpd"><strong>LGPD:</strong> deixe como “Ignorar” colunas de CPF, RG, endereço, telefone pessoal ou saúde.</p>
    <div class="formato-importacao" role="group" aria-label="Formato do arquivo">
      <button type="button" class="btn btn-mini" aria-pressed="true" disabled>${svg("i-tabela")}Uma aba por planilha</button>
      <button type="button" class="btn btn-secundario btn-mini" data-ix="blocos" aria-pressed="false">${svg("i-camadas")}Planilha de divulgação (blocos)</button>
      <span class="apoio" style="font-size:12px">Blocos: títulos como “Supremo Tribunal Federal (STF)”, os dois ciclos lado a lado e as seções “Acre (AC)” na 1ª coluna.</span>
    </div>
    ${pendente && pendente.lotes && pendente.lotes.length ? `<div class="aviso-comecar">${svg("i-upload")}<div><strong>Há uma importação pela metade</strong><p class="apoio">${escapar(pendente.lotes.length)} planilha(s) ainda não gravadas (de ${escapar(formatarData(pendente.em, true))}).</p></div><button type="button" class="btn" data-ix="continuar">Continuar a importação</button></div>` : ""}
    <div class="campos-linha">
      <label class="campo"><span class="rotulo">Arquivo Excel (.xlsx, várias abas) ou CSV</span><input type="file" name="arquivo" accept=".xlsx,.xls,.ods,.csv"></label>
      <label class="campo"><span class="rotulo">Grupo de destino das planilhas novas</span><select name="grupo"><option value="">Sem grupo</option>${gruposDe(amb).map((g) => `<option value="${escapar(g.id)}">${escapar(g.nome)}</option>`).join("")}<option value="__novo">Novo grupo…</option></select></label>
      <label class="campo" data-novo-grupo hidden><span class="rotulo">Nome do grupo novo</span><input name="grupoNovo" maxlength="60"></label>
    </div>
    <p class="apoio" style="font-size:12px">Cada aba vira uma planilha (nome da aba = nome da planilha). Se já existir uma planilha com o mesmo nome em ${escapar(nomeAmbiente(amb))}, as linhas entram nela. Nada é gravado antes da conferência.</p>
    <div id="ix-conferencia"></div>
    <p class="apoio" id="ix-progresso" role="status"></p>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn" id="ix-ok" disabled>Importar</button></div>` });
  const form = d.querySelector("form");
  const erro = d.querySelector(".form-erro"), progresso = $("#ix-progresso", d);
  form.grupo.addEventListener("change", () => { d.querySelector("[data-novo-grupo]").hidden = form.grupo.value !== "__novo"; });
  const chaveTitulo = (t) => normalizar(t).replace(/[^a-z0-9]+/g, " ").trim();
  const localidadeDaAba = (a) => localidadesDe(amb, { arquivadas: true }).find((l) => nomeComparavel(l.nome) === nomeComparavel(a.destino)) || null;
  /* Confere todas as abas: valores fora das listas, obrigatórios, repetidos da coluna chave (na aba e na planilha existente) */
  function analisar() {
    const fora = new Map();
    const porAba = abas.map((a, ia) => {
      if (!a.incluir) return { a, linhas: [], ok: 0, erros: 0 };
      const l = localidadeDaAba(a);
      const atuais = l && existentes.get(l.id) ? existentes.get(l.id) : [];
      const vistos = new Set(atuais.filter((t) => e.colunaChave && !estaVazio((t.campos || {})[e.colunaChave])).map((t) => normalizar(chaveNumero(t.campos[e.colunaChave]))));
      const linhas = a.linhas.map((bruta, il) => {
        const campos = {}, problemas = [];
        a.cabecalho.forEach((t, i) => {
          const c = mapa.get(chaveTitulo(t));
          const col = c && cols.find((x) => x.id === c);
          const valor = String(bruta[i] == null ? "" : bruta[i]).trim();
          if (!col || !valor) return;
          const extra = novasOpcoes.get(col.id) || [];
          const colComExtras = extra.length ? { ...col, opcoes: [...col.opcoes, ...extra] } : col;
          const r = validarValor(colComExtras, valor);
          if (r.ok) { campos[col.id] = r.valor; return; }
          if (!TIPOS_LISTA.includes(col.tipo) || col.tipo === "etiquetas") { problemas.push(r.erro); return; }
          const k = `${col.id}|${nomeComparavel(valor)}`;
          const f = fora.get(k) || { chave: k, col, bruto: valor, n: 0, sugestao: r.sugestao || null };
          f.n++;
          fora.set(k, f);
          if (!foraVistos.has(k)) foraVistos.set(k, f);
          const escolha = trocas.get(k) || "";
          if (escolha === "sugestao" && f.sugestao) campos[col.id] = f.sugestao.id;
          else if (escolha === "vazio") { /* fica vazio */ }
          else problemas.push(`${col.nome}: “${valor}” fora da lista`);
        });
        cols.forEach((c) => { if (c.obrigatoria && estaVazio(campos[c.id]) && !problemas.length) problemas.push(`${c.nome} é obrigatório`); });
        if (e.colunaChave && !estaVazio(campos[e.colunaChave]) && !problemas.length) {
          const k = normalizar(chaveNumero(campos[e.colunaChave]));
          if (vistos.has(k)) problemas.push(`${(cols.find((c) => c.id === e.colunaChave) || {}).nome || "Chave"} “${campos[e.colunaChave]}” repetido`);
          vistos.add(k);
        }
        return { n: il + 2, campos, problemas, vazia: !Object.keys(campos).length };
      }).filter((x) => !x.vazia || x.problemas.length);
      return { a, ia, l, linhas, ok: linhas.filter((x) => !x.problemas.length).length, erros: linhas.filter((x) => x.problemas.length).length };
    });
    analise = { porAba, fora: [...fora.values()] };
    return analise;
  }
  function desenhar() {
    if (!abas.length) { $("#ix-conferencia", d).innerHTML = ""; $("#ix-ok", d).disabled = true; return; }
    const an = analisar();
    const titulos = [...new Map(abas.filter((a) => a.incluir).flatMap((a) => a.cabecalho).filter(Boolean).map((t) => [chaveTitulo(t), t])).values()];
    const total = an.porAba.reduce((s, x) => s + x.ok, 0), comErro = an.porAba.reduce((s, x) => s + x.erros, 0);
    $("#ix-conferencia", d).innerHTML = `
      <h3 style="font-size:15px;margin-top:6px">1. Abas (${abas.filter((a) => a.incluir).length} de ${abas.length} incluídas)</h3>
      <div class="tabela-admin"><table><thead><tr><th>Incluir</th><th>Aba</th><th>Planilha</th><th>Linhas</th><th>Conferência</th></tr></thead><tbody>${an.porAba.map((x, i) => `<tr${x.a.incluir ? "" : ' class="arquivada"'}>
        <td><input type="checkbox" data-ix-incluir="${i}"${x.a.incluir ? " checked" : ""} aria-label="Incluir a aba ${escapar(x.a.nome)}"></td>
        <td>${escapar(x.a.nome)}${x.a.cortadas ? ` <span class="selo-exclusao">${x.a.cortadas} linha(s) acima do limite ficam de fora</span>` : ""}</td>
        <td><input data-ix-destino="${i}" value="${escapar(x.a.destino)}" maxlength="80" aria-label="Planilha da aba ${escapar(x.a.nome)}"> ${x.l ? `<span class="selo">existe: as linhas entram nela</span>` : '<span class="selo selo-lilas">nova</span>'}</td>
        <td>${x.a.linhas.length}</td>
        <td>${x.a.incluir ? `<strong>${x.ok}</strong> ok${x.erros ? ` · <span style="color:var(--erro-texto)">${x.erros} com problema (ficam de fora)</span>` : ""}` : "ignorada"}</td></tr>`).join("")}</tbody></table></div>
      <h3 style="font-size:15px;margin-top:12px">2. Colunas do Excel → colunas de ${escapar(nomeAmbiente(amb))}</h3>
      <div class="mapa-colunas">${titulos.map((t) => `<label><span>${escapar(t)}</span><select data-ix-mapa="${escapar(chaveTitulo(t))}"><option value="">Ignorar</option>${cols.map((c) => `<option value="${escapar(c.id)}"${mapa.get(chaveTitulo(t)) === c.id ? " selected" : ""}>${escapar(c.nome)}</option>`).join("")}</select></label>`).join("")}</div>
      ${foraVistos.size ? `<div class="fora-colagem"><h3 style="font-size:15px">3. Valores fora das listas (${foraVistos.size})</h3><p class="apoio" style="font-size:13px">Enquanto não escolher, as linhas com esses valores ficam de fora.</p>
        ${[...foraVistos.values()].map((f) => `<label><span><strong>${escapar(f.col.nome)}</strong>: <span class="valor-fora">“${escapar(f.bruto)}”</span> · ${f.n} linha(s)</span>
          <select data-ix-troca="${escapar(f.chave)}"><option value="">Linha fica de fora</option>${f.sugestao ? `<option value="sugestao"${trocas.get(f.chave) === "sugestao" ? " selected" : ""}>Usar “${escapar(f.sugestao.nome)}”</option>` : ""}<option value="nova"${trocas.get(f.chave) === "nova" ? " selected" : ""}>Acrescentar “${escapar(f.bruto.slice(0, 60))}” à lista</option><option value="vazio"${trocas.get(f.chave) === "vazio" ? " selected" : ""}>Deixar vazio</option></select></label>`).join("")}</div>` : ""}
      ${comErro ? `<details class="erros-import"><summary>Ver as linhas com problema (${comErro})</summary><ul>${an.porAba.flatMap((x) => x.linhas.filter((y) => y.problemas.length).slice(0, 30).map((y) => `<li><strong>${escapar(x.a.nome)}</strong>, linha ${y.n}: ${escapar(y.problemas.join("; "))}</li>`)).join("")}</ul></details>` : ""}
      <p class="apoio" style="margin-top:8px"><strong>${total.toLocaleString("pt-BR")}</strong> registro(s) prontos para entrar em ${an.porAba.filter((x) => x.a.incluir && x.ok).length} planilha(s).</p>`;
    $("#ix-ok", d).disabled = !total;
    $("#ix-ok", d).textContent = `Importar ${total.toLocaleString("pt-BR")} registro(s)`;
  }
  /* Opção nova (escolha "Acrescentar à lista"): entra na estrutura antes de gravar */
  const atualizarNovasOpcoes = () => {
    novasOpcoes = new Map();
    foraVistos.forEach((f) => {
      if (trocas.get(f.chave) !== "nova") return;
      const lista = novasOpcoes.get(f.col.id) || [];
      if (lista.some((o) => nomeComparavel(o.nome) === nomeComparavel(f.bruto))) return;
      lista.push({ id: idUnico(f.bruto, [...f.col.opcoes, ...lista].map((o) => o.id)), nome: f.bruto.slice(0, 100), cor: "" });
      novasOpcoes.set(f.col.id, lista);
    });
  };
  async function lerExistentes() {
    const lista = abas.filter((a) => a.incluir).map(localidadeDaAba).filter((l) => l && !existentes.has(l.id));
    for (const l of lista) {
      progresso.textContent = `Conferindo os registros de ${l.nome}…`;
      try { existentes.set(l.id, (await dadosDaLocalidade(l.id, { forcar: true })).registros); } catch (err) { console.warn(err); existentes.set(l.id, []); }
    }
    progresso.textContent = "";
  }
  form.arquivo.addEventListener("change", async () => {
    const f = form.arquivo.files[0];
    erro.textContent = "";
    if (!f) return;
    progresso.textContent = "Lendo o arquivo…";
    try { abas = (await lerPlanilhaExcel(f)).map((a) => ({ ...a, destino: a.nome.slice(0, 80), incluir: a.linhas.length > 0 })); }
    catch (err) { console.error(err); progresso.textContent = ""; erro.textContent = err.message || "Não foi possível ler o arquivo."; return; }
    if (!abas.length) { progresso.textContent = ""; erro.textContent = "O arquivo não tem abas com dados."; return; }
    mapa = new Map();
    const usados = new Set();
    abas.flatMap((a) => a.cabecalho).forEach((t) => { const k = chaveTitulo(t); if (!k || mapa.has(k)) return; const c = adivinharColuna(t, cols); if (c && !usados.has(c)) { usados.add(c); mapa.set(k, c); } else mapa.set(k, ""); });
    await lerExistentes();
    desenhar();
  });
  d.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.dataset.ixIncluir != null) { abas[Number(t.dataset.ixIncluir)].incluir = t.checked; await lerExistentes(); desenhar(); }
    if (t.dataset.ixDestino != null) { abas[Number(t.dataset.ixDestino)].destino = t.value.trim().replace(/\s+/g, " ").slice(0, 80) || abas[Number(t.dataset.ixDestino)].nome; await lerExistentes(); desenhar(); }
    if (t.dataset.ixMapa != null) { mapa.set(t.dataset.ixMapa, t.value); desenhar(); }
    if (t.dataset.ixTroca != null) { trocas.set(t.dataset.ixTroca, t.value); atualizarNovasOpcoes(); desenhar(); }
  });
  d.addEventListener("click", (ev) => {
    if (ev.target.closest('[data-ix="continuar"]')) { d.close(); continuarImportacaoExcel(); }
    if (ev.target.closest('[data-ix="blocos"]')) { d.close(); setTimeout(abrirImportarBlocos, 250); }
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!analise) return;
    const escolhidas = analise.porAba.filter((x) => x.a.incluir && x.ok);
    const nomes = new Set();
    for (const x of escolhidas) { const k = nomeComparavel(x.a.destino); if (nomes.has(k)) { erro.textContent = `Duas abas vão para a mesma planilha “${x.a.destino}”. Troque o nome de uma delas.`; return; } nomes.add(k); }
    let grupo = form.grupo.value;
    if (grupo === "__novo" && !form.grupoNovo.value.trim()) { erro.textContent = "Dê um nome ao grupo novo."; form.grupoNovo.focus(); return; }
    const total = escolhidas.reduce((s, x) => s + x.ok, 0);
    if (!(await confirmar(`Importar ${total.toLocaleString("pt-BR")} registro(s) em ${escolhidas.length} planilha(s) de ${nomeAmbiente(amb)}?${escolhidas.some((x) => x.l) ? " Nas localidades que já existem, as linhas são acrescentadas." : ""}`, { titulo: "Importar Excel", botao: "Importar" }))) return;
    $("#ix-ok", d).disabled = true;
    try {
      /* 1) Grupo novo e opções novas nas listas (estrutura do ambiente) */
      if (grupo === "__novo") {
        const nome = form.grupoNovo.value.trim().slice(0, 60);
        const existente = gruposDe(amb).find((g) => nomeComparavel(g.nome) === nomeComparavel(nome));
        grupo = existente ? existente.id : estado.api.novoId(COL_GRUPOS);
        if (!existente) await estado.api.salvarDoc(`${COL_GRUPOS}/${grupo}`, { ambiente: amb, nome, ordem: novaOrdem(gruposDe(amb)), criadoEm: "__AGORA__", ...assinaturaAdmin() });
      }
      if (novasOpcoes.size) {
        const base = estruturaDoAmbiente(amb);
        const nova = { ...base, versao: base.versao + 1, colunas: base.colunas.map((c) => (novasOpcoes.has(c.id) ? { ...c, opcoes: [...c.opcoes, ...novasOpcoes.get(c.id)] } : c)) };
        await salvarEstrutura(nova, amb);
        registrarAuditoria("estrutura", `Importação: acrescentou opções às listas de ${nomeAmbiente(amb)}`, [...novasOpcoes].map(([c, os]) => `${(cols.find((x) => x.id === c) || {}).nome}: ${os.map((o) => o.nome).join(", ")}`).join(" · ").slice(0, 1500), { planilha: "" });
      }
      /* 2) Plano de gravação (guardado neste navegador: dá para continuar depois se a cota do dia acabar) */
      const imp = `excel-${Date.now()}`;
      const agora = new Date().toISOString();
      let ordem = novaOrdem(estado.localidades.filter((l) => l.ambiente === amb && l.grupo === grupo));
      const lotes = escolhidas.map((x) => ({
        ambiente: amb, aba: x.a.nome, nome: x.a.destino, existente: x.l ? x.l.id : "", grupo, ordem: x.l ? 0 : ordem++, localidade: x.l ? x.l.id : estado.api.novoId(COL_LOCALIDADES),
        registros: x.linhas.filter((y) => !y.problemas.length).map((y) => ({ id: estado.api.novoId(COL_LOCALIDADES), campos: y.campos }))
      }));
      const plano = { em: agora, imp, lotes };
      if (!gravarLocal(chaveImportacaoExcel(), plano)) gravarLocal(chaveImportacaoExcel(), { em: agora, imp, lotes: lotes.map((l) => ({ ...l, registros: [] })), semDados: true });
      d.close();
      await executarImportacaoExcel(plano);
    } catch (err) { console.error(err); $("#ix-ok", d).disabled = false; erro.textContent = mensagemErro(err); }
  });
  d.showModal();
}
/* Grava localidade por localidade: documento (se nova), registros no arquivo compactado, índice da chave,
   contadores exatos e um evento nas últimas mudanças. O que falta continua guardado no navegador. */
async function executarImportacaoExcel(plano) {
  const total = plano.lotes.length;
  let feitas = 0;
  for (const lote of [...plano.lotes]) {
    mostrarAviso(`Importando ${lote.nome} (${feitas + 1} de ${total})…`, 120000);
    try {
      const amb = lote.ambiente;
      let l = localidadePorId(lote.localidade);
      let antigos = [], atuais = [], vivosLidos = [];
      if (!l && !lote.existente) {
        await estado.api.salvarDoc(LOC(lote.localidade), dadosNovaLocalidade(amb, { nome: lote.nome, grupo: lote.grupo, uf: "", codigo: "", responsavel: "", cor: "", icone: "i-pino", observacao: `Importada do Excel (aba ${lote.aba})`.slice(0, 200) }, lote.ordem));
      } else {
        const [vivos, arquivo] = await Promise.all([estado.api.lerColecao(`${LOC(lote.localidade)}/registros`), estado.api.lerColecao(`${LOC(lote.localidade)}/arquivo`)]);
        antigos = arquivo.map((p) => p.id);
        vivosLidos = vivos.map(normalizarEquipamento);
        /* Todas as linhas do arquivo continuam (um registro vivo de mesmo id vale por cima, inclusive o parcial) */
        atuais = combinarRegistros([], arquivo);
      }
      const e = estruturaDoAmbiente(amb);
      const novos = lote.registros.map((r) => normalizarEquipamento({
        id: r.id, campos: r.campos, numero: e.colunaChave && !estaVazio(r.campos[e.colunaChave]) ? montarChave(r.campos[e.colunaChave], "", e.chaveComposta) : "",
        criadoPor: estado.usuario.email, criadoPorNome: estado.usuario.nome, criadoPorEmail: estado.usuario.email, criadoEm: plano.em,
        atualizadoPor: estado.usuario.email, atualizadoPorNome: estado.usuario.nome, atualizadoPorEmail: estado.usuario.email, atualizadoEm: plano.em, importacao: plano.imp
      }));
      /* As linhas do arquivo antigo (sem os vivos, que continuam valendo por cima) + as novas */
      await gravarArquivoEm(lote.localidade, [...atuais, ...novos], antigos);
      await gravarChavesEm(lote.localidade, amb, novos);
      const porIdTodos = new Map([...atuais, ...novos].map((t) => [t.id, t]));
      vivosLidos.forEach((v) => { const base = porIdTodos.get(v.id); porIdTodos.set(v.id, v.parcial && base ? mesclarParcial(base, v) : v); });
      const todos = [...porIdTodos.values()];
      await gravarContadoresEm(lote.localidade, amb, todos, localidadePorId(lote.localidade));
      await estado.api.lote([{ op: "set", caminho: `${COL_HISTORICO}/${estado.api.novoId(COL_HISTORICO)}`, dados: {
        ambiente: amb, localidade: lote.localidade, localidadeNome: txt(lote.nome, 80), registro: (novos[0] || { id: "" }).id, registroNome: `${novos.length} registro(s) do Excel`,
        acao: "importar", coluna: "", colunaNome: "", antes: "", depois: txt(`Aba “${lote.aba}”`, 500), por: estado.usuario.id, porNome: txt(estado.usuario.nome, 80), ordem: ordemHistorico(amb), em: "__AGORA__"
      } }]);
      registrarAuditoria("importar", `Importou ${novos.length} registro(s) do Excel em ${lote.nome}${lote.existente ? "" : " (planilha nova)"}`, `Aba “${lote.aba}”`, { planilha: lote.localidade });
      cacheDados.delete(lote.localidade);
      feitas++;
      plano.lotes = plano.lotes.filter((x) => x !== lote);
      if (plano.lotes.length) gravarLocal(chaveImportacaoExcel(), plano); else apagarLocal(chaveImportacaoExcel());
    } catch (err) {
      console.error(err);
      const cota = /resource-exhausted|quota/i.test((err && (err.code || err.message)) || "");
      mostrarAviso(`${feitas} de ${total} planilha(s) importada(s). ${cota ? "O limite diário de gravações do plano gratuito acabou: o resto fica guardado neste navegador. Amanhã, use Importar Excel › “Continuar a importação”." : `A importação parou em “${lote.nome}” (${mensagemErro(err)}). Use Importar Excel › “Continuar a importação”.`}`, 15000);
      return false;
    }
  }
  mostrarAviso(`Pronto: ${total} planilha(s) importada(s).`, 7000);
  if (estado.tela === "localidade" && plano.lotes.every((x) => x.localidade !== estado.planilha)) recontarLocalidade();
  return true;
}
async function continuarImportacaoExcel() {
  const p = lerLocal(chaveImportacaoExcel(), null);
  if (!p || !Array.isArray(p.lotes) || !p.lotes.length) { apagarLocal(chaveImportacaoExcel()); mostrarAviso("Não há importação pendente."); return; }
  if (p.semDados) { apagarLocal(chaveImportacaoExcel()); mostrarAviso("Os dados da importação não couberam neste navegador. Importe o arquivo de novo (as planilhas já gravadas aparecem como existentes).", 9000); return; }
  await executarImportacaoExcel(p);
}


/* ============================================================
 *  Importar a "Planilha de divulgação (blocos)" (o formato da planilha oficial da cadeia).
 *  Cada aba é um grupo (Tribunais, Órgãos - GOV, Outros). Numa aba, cada bloco começa com o título
 *  ("Supremo Tribunal Federal (STF)", "RFB"…), os cabeçalhos "1º Ciclo"/"2º Ciclo" lado a lado e a linha de
 *  títulos das colunas, que diz como o bloco se separa:
 *   - "Sistema": uma linha por sistema (planilha por sistema; subtítulos como "PLATAFORMAS DE SAÚDE" viram seções);
 *   - "Acre (AC) | E-mail | …": o estado na própria linha de títulos e os sistemas embaixo (TJ: por estado);
 *   - "ESTADOS" / "Regiões": uma linha por estado ou região, com o sistema na coluna Observação (PJe, ePROC)
 *     ou no próprio nome ("TRF6 - ePROC").
 *  Faixas que atravessam a linha ("NÃO INTEGRADO", "SISTEMA DESCONTINUADO"…) viram o Status (cinza).
 *  Planilhas, seções, grupos e colunas extras que faltam são criados; o que já existe é atualizado.
 * ============================================================ */
const chaveImportacaoBlocos = () => chavePessoa("importacao-blocos");
const RE_CICLO = /\b([12])\s*[ºo°ª]?\s*ciclo\b/i;
const ehNaoIntegradoTexto = (v) => nomeComparavel(v).replace(/[^a-z ]/g, "").trim() === "nao integrado";
const RE_SISTEMA_CONHECIDO = /^(pje|e-?proc|e-?saj|projudi|seeu|pjd)$/i;
const PRIMEIRA_SISTEMA = ["sistema", "sistemas"], PRIMEIRA_SECAO = ["estados", "estado", "regioes", "regiao", "uf", "ufs"];
/* "PLATAFORMAS DE SAÚDE" → "Plataformas de saúde" */
const frase = (t) => { const s = String(t || "").trim().toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
/* Faixa que atravessa a linha: um texto só, em maiúsculas, sem e-mail nem número (ex.: "SISTEMA DESCONTINUADO") */
const ehFaixaTexto = (v) => { const t = String(v || "").trim(); return t.length >= 6 && t === t.toUpperCase() && /[A-ZÀ-Ú]{3}/.test(t) && !/[@\d]|https?:/i.test(t); };
/* Sigla entre parênteses no fim do título ("Supremo Tribunal Federal (STF)") ou o título curto todo em maiúsculas ("RFB") */
function siglaDoTitulo(t) {
  const m = /\(([^()]{2,12})\)\s*$/.exec(String(t || "").trim());
  if (m) return { sigla: m[1].trim(), nome: String(t).slice(0, m.index).trim() };
  const s = String(t || "").trim();
  return /^[A-ZÀ-Ú]{2,8}$/.test(s) ? { sigla: s, nome: s } : { sigla: "", nome: s };
}
/* Linha por estado sem sistema na Observação (ex.: RFB "Acesso via Gov.Br"): o sistema é o próprio órgão */
function sistemaPadraoDoBloco(titulo) {
  const { sigla, nome } = siglaDoTitulo(titulo);
  if (sigla) return sigla;
  const modelo = ESTRUTURA_TRIBUNAIS.flatMap((g) => g.planilhas).find((p) => nomeComparavel(p.nome) === nomeComparavel(nome));
  return modelo ? modelo.nome : nome;
}
/* Planilha da cadeia pelo título do bloco: pela sigla ou pelo nome (de preferência no grupo da aba) */
function planilhaDoTitulo(amb, texto, grupo = "") {
  const { sigla, nome } = siglaDoTitulo(texto);
  const locs = localidadesDe(amb, { arquivadas: true });
  const achar = (lista) => (sigla && lista.find((x) => x.sigla && nomeComparavel(x.sigla) === nomeComparavel(sigla)))
    || lista.find((x) => [x.nome, x.nomeCompleto].some((n) => n && [texto, nome].some((t) => nomeComparavel(n) === nomeComparavel(t)))) || null;
  return (grupo && achar(locs.filter((x) => x.grupo === grupo))) || achar(locs);
}
/* Seção pelo texto: "Acre (AC)" → ac; "TRF1" / "TRT 2ª Região (…)" → r1 / r2; ou pelo nome */
function secaoDoTexto(secoes, texto) {
  const t = String(texto || "").trim();
  const exato = secoes.find((s) => nomeComparavel(s.nome) === nomeComparavel(t));
  if (exato) return exato;
  const uf = /\(([A-Za-z]{2})\)\s*$/.exec(t);
  if (uf) { const s = secoes.find((x) => x.id === uf[1].toLowerCase() || nomeComparavel(x.sigla) === nomeComparavel(uf[1])); if (s) return s; }
  const reg = /^(?:TR[FT]\s*)(\d{1,2})\b/i.exec(t) || /(\d{1,2})\s*[ªa°º]?\s*regi/i.exec(t);
  if (reg) { const s = secoes.find((x) => x.id === `r${Number(reg[1])}`); if (s) return s; }
  return secoes.find((s) => s.sigla && nomeComparavel(s.sigla) === nomeComparavel(t)) || null;
}
const secaoDaLinha = (l, texto) => (porEstado(l) ? secaoDoTexto(l.secoes, texto) : null);
/* Seção nova a partir do texto da planilha (id curto: a UF, r1…r24 nas regiões, ou o nome sem acentos) */
function secaoNova(texto, existentes) {
  const t = String(texto || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const uf = /\(([A-Za-z]{2})\)\s*$/.exec(t), reg = /^TR[FT]\s*(\d{1,2})\b/i.exec(t);
  const ids = existentes.map((s) => s.id);
  let id = uf ? uf[1].toLowerCase() : reg ? `r${Number(reg[1])}` : slug(t, 20);
  if (!RE_ID_SECAO.test(id) || ids.includes(id)) id = idSecaoNovo(t, ids);
  return { id, nome: t, sigla: uf ? uf[1].toUpperCase() : "" };
}
/* Lê as abas e devolve os blocos: { aba, titulo, semTitulo, tipo, secoes: [textos], linhas: [{ n, sistema, secaoTexto, valores, faixa }] } */
function lerBlocos(abas) {
  const blocos = [], titulosMapa = new Map();
  abas.forEach((a) => {
    const todas = [a.cabecalho, ...a.linhas].map((r) => r.map((v) => String(v == null ? "" : v).trim()));
    const ehCabecalho = (r) => r.some((v) => /^e-?mail$/i.test(v)) && r.some((v) => /^status$/i.test(v));
    const ehCiclo = (r) => r.some((v) => RE_CICLO.test(v)) && !ehCabecalho(r);
    /* Título = uma célula só, seguida (em até 3 linhas) dos ciclos ou dos títulos das colunas */
    const cabecalhoLogo = (ri) => { for (let k = ri + 1, vistos = 0; k < todas.length && vistos < 3; k++) { if (!todas[k].some(Boolean)) continue; vistos++; if (ehCiclo(todas[k]) || ehCabecalho(todas[k])) return true; } return false; };
    let b = null, cicloDois = -1, cab = null, pos = 0, secaoTexto = "";
    const novoBloco = (titulo, semTitulo) => { b = { aba: a.nome, titulo, semTitulo, tipo: "", secoes: [], linhas: [], subtitulos: 0 }; blocos.push(b); cicloDois = -1; cab = null; secaoTexto = ""; };
    const marcarSecao = (t) => { secaoTexto = t; if (t && !b.secoes.includes(t)) b.secoes.push(t); };
    todas.forEach((r, ri) => {
      const cheias = r.map((v, i) => [v, i]).filter(([v]) => v);
      if (!cheias.length) return;
      if (cheias.length === 1 && cabecalhoLogo(ri)) { novoBloco(cheias[0][0], false); return; }
      if (ehCiclo(r)) { if (!b) novoBloco(a.nome, true); const dois = cheias.find(([v]) => (RE_CICLO.exec(v) || [])[1] === "2"); cicloDois = dois ? dois[1] : -1; return; }
      if (ehCabecalho(r)) {
        if (!b) novoBloco(a.nome, true);
        const [p, ip] = cheias[0];
        pos = ip;
        const k1 = nomeComparavel(p);
        const tipo = PRIMEIRA_SISTEMA.includes(k1) ? "sistema" : PRIMEIRA_SECAO.includes(k1) ? "linhaPorSecao" : "secaoNoCabecalho";
        if (!b.tipo) b.tipo = tipo;
        if (tipo === "secaoNoCabecalho") marcarSecao(p);
        cab = r.map((t, i) => { if (!t || i === pos) return ""; const ciclo = cicloDois >= 0 && i >= cicloDois ? 2 : 1; const k = `${ciclo}|${nomeComparavel(t)}`; if (!titulosMapa.has(k)) titulosMapa.set(k, { chave: k, titulo: t, ciclo }); return k; });
        return;
      }
      if (!b || !cab) return;
      const primeiro = r[pos] || "";
      const resto = cheias.filter(([, i]) => i !== pos);
      /* Subtítulo numa lista por sistema ("PLATAFORMAS DE SAÚDE"): vira seção */
      if (b.tipo === "sistema" && !resto.length && ehFaixaTexto(primeiro) && /\s/.test(primeiro)) { b.subtitulos++; marcarSecao(frase(primeiro)); return; }
      if (!primeiro) return;
      let faixa = "";
      if (resto.length === 1 && ehFaixaTexto(resto[0][0])) faixa = resto[0][0];
      else { const ni = resto.find(([v]) => ehNaoIntegradoTexto(v)); if (ni) faixa = ni[0]; }
      let valores = faixa ? [] : resto.map(([v, i]) => [cab[i], v]).filter(([k]) => k);
      let sistema = primeiro, sec = secaoTexto;
      if (b.tipo === "linhaPorSecao") {
        /* "TRF6 - ePROC": região e sistema; senão o sistema vem da Observação (PJe, ePROC) */
        const partes = /^(.+?)\s+-\s+(.+)$/.exec(primeiro);
        sec = partes ? partes[1].trim() : primeiro;
        const obs = valores.find(([k, v]) => /observa/.test(k) && RE_SISTEMA_CONHECIDO.test(v));
        sistema = partes ? partes[2].trim() : obs ? obs[1] : sistemaPadraoDoBloco(b.titulo);
        if (obs && (!partes || nomeComparavel(obs[1]) === nomeComparavel(sistema))) valores = valores.filter((x) => x !== obs);
        if (!b.secoes.includes(sec)) b.secoes.push(sec);
      } else if (b.tipo === "sistema" && b.subtitulos === 0) sec = "";
      b.linhas.push({ n: ri + 1, sistema, secaoTexto: sec, valores, faixa });
    });
    /* Lista por sistema com subtítulos: as linhas antes do 1º subtítulo ficam na seção "Sistemas" */
    blocos.filter((x) => x.aba === a.nome && x.tipo === "sistema" && x.subtitulos).forEach((x) => { if (x.linhas.some((l) => !l.secaoTexto)) { x.secoes.unshift("Sistemas"); x.linhas.forEach((l) => { if (!l.secaoTexto) l.secaoTexto = "Sistemas"; }); } });
  });
  blocos.forEach((x) => { x.porEstado = x.tipo !== "sistema" || x.subtitulos > 0; });
  return { blocos, titulos: [...titulosMapa.values()] };
}
/* Nome da planilha nova a partir do bloco (o modelo de Tribunais e Órgãos completa o nome das siglas conhecidas) */
function planilhaNovaDoBloco(b, usados) {
  const { sigla, nome } = siglaDoTitulo(b.titulo);
  const modelo = ESTRUTURA_TRIBUNAIS.flatMap((g) => g.planilhas).find((p) => (sigla && nomeComparavel(p.sigla) === nomeComparavel(sigla)) || nomeComparavel(p.nome) === nomeComparavel(nome));
  let nomeCompleto = modelo && (nomeComparavel(nome) === nomeComparavel(sigla) || nomeComparavel(modelo.nome) === nomeComparavel(nome)) ? modelo.nome : nome;
  /* Aba sem título (ex.: "Outros", com as empresas) não pode ter o mesmo nome de outra planilha */
  if (b.semTitulo && usados.has(nomeComparavel(nomeCompleto))) nomeCompleto = nomeComparavel(b.aba) === "outros" ? "Empresas e plataformas" : `${b.aba} (aba)`;
  const siglaFinal = sigla && nomeComparavel(sigla) !== nomeComparavel(nomeCompleto) ? sigla : modelo && modelo.sigla && nomeComparavel(modelo.nome) === nomeComparavel(nomeCompleto) ? modelo.sigla : "";
  return { sigla: siglaFinal.slice(0, 12), nomeCompleto: nomeCompleto.slice(0, 120), nome: nomeDaPlanilha(siglaFinal.slice(0, 12), nomeCompleto.slice(0, 120)) };
}
const grupoDaAba = (amb, aba) => gruposDe(amb).find((g) => nomeComparavel(g.nome) === nomeComparavel(aba)) || gruposDe(amb).find((g) => nomeComparavel(g.nome).startsWith(nomeComparavel(aba).slice(0, 6))) || null;
function abrirImportarBlocos() {
  if (!ehAdmin() || !estado.ambiente) return;
  const amb = estado.ambiente;
  const e = estruturaDoAmbiente(amb);
  const cols = e.colunas.filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo));
  const colSistema = cols.find((c) => c.id === e.colunaChave);
  const colSt = cols.find((c) => c.id === colResumoDe(amb)) || cols.find((c) => c.tipo === "status");
  if (!colSistema) { mostrarAviso(`${nomeAmbiente(amb)} ainda não tem a coluna Sistema. Use “Criar estrutura de Tribunais e Órgãos” primeiro.`, 7000); return; }
  const pendente = lerLocal(chaveImportacaoBlocos(), null);
  let lido = null, mapa = new Map(), existentes = new Map(), analise = null, destinos = [];
  const trocas = new Map(), foraVistos = new Map();
  let novasOpcoes = new Map();
  const EXTRA = "__extra";
  const d = criarDialogo({ titulo: `Importar planilha de divulgação (blocos) em ${nomeAmbiente(amb)}`, largo: true, corpo: `
    <p class="apoio">Cada aba vira um grupo (Tribunais, Órgãos - GOV, Outros) e cada bloco, uma planilha (pela sigla ou pelo nome). Blocos com “Sistema” ficam <strong>por sistema</strong>; blocos com o estado nos títulos (TJ) ou com “ESTADOS”/“Regiões” ficam <strong>por estado</strong>, com uma seção por estado ou região. O sistema das linhas por estado vem da coluna Observação (PJe, ePROC) ou do nome (“TRF6 - ePROC”). Faixas como “NÃO INTEGRADO” viram o Status. Planilhas, seções e grupos que faltam são criados; os sistemas que já existem são atualizados. Nada é gravado antes da conferência.</p>
    ${pendente && pendente.lotes && pendente.lotes.length ? `<div class="aviso-comecar">${svg("i-upload")}<div><strong>Há uma importação pela metade</strong><p class="apoio">${escapar(pendente.lotes.length)} planilha(s) ainda não gravadas (de ${escapar(formatarData(pendente.em, true))}).</p></div><button type="button" class="btn" data-bx="continuar">Continuar a importação</button></div>` : ""}
    <label class="campo"><span class="rotulo">Arquivo Excel (.xlsx) no formato da planilha de divulgação</span><input type="file" name="arquivo" accept=".xlsx,.xls,.ods,.csv"></label>
    <div id="bx-conferencia"></div>
    <p class="apoio" id="bx-progresso" role="status"></p>
    <p class="form-erro" role="alert"></p>
    <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn" id="bx-ok" disabled>Importar</button></div>` });
  const form = d.querySelector("form");
  const erro = form.querySelector(".form-erro"), progresso = $("#bx-progresso", d);
  const colPorChave = (k) => cols.find((c) => c.id === mapa.get(k)) || null;
  function adivinhar() {
    mapa = new Map();
    const usados = new Map();
    lido.titulos.forEach((t) => {
      const doCiclo = cols.filter((c) => c.id !== colSistema.id && (t.ciclo === 2 ? c.grupo === "ciclo-2" : c.grupo !== "ciclo-2"));
      const exato = doCiclo.find((c) => nomeComparavel(c.nome) === nomeComparavel(t.titulo)) || cols.find((c) => c.id !== colSistema.id && nomeComparavel(c.nome) === nomeComparavel(t.titulo));
      const c = exato ? exato.id : adivinharColuna(t.titulo, doCiclo.length ? doCiclo : cols);
      const k = `${t.ciclo}|${c}`;
      /* Título sem coluna igual (ex.: EMPRESA): vira coluna extra da planilha */
      if (c && !usados.has(k)) { usados.set(k, true); mapa.set(t.chave, c); } else mapa.set(t.chave, c ? "" : EXTRA);
    });
  }
  /* Destino de cada bloco: planilha existente (pela sigla ou pelo nome, de preferência no grupo da aba) ou nova; seções que faltam */
  function resolverDestinos() {
    const usados = new Set(localidadesDe(amb, { arquivadas: true }).map((l) => nomeComparavel(l.nome)));
    const novasPorNome = new Map();
    destinos = lido.blocos.map((b) => {
      const g = grupoDaAba(amb, b.aba);
      let l = b.semTitulo ? null : planilhaDoTitulo(amb, b.titulo, g ? g.id : "");
      if (b.semTitulo) { const p = planilhaNovaDoBloco(b, usados); l = localidadesDe(amb, { arquivadas: true }).find((x) => nomeComparavel(x.nome) === nomeComparavel(p.nome)) || null; }
      let nova = null;
      if (!l) {
        nova = planilhaNovaDoBloco(b, usados);
        const k = nomeComparavel(nova.nome);
        if (novasPorNome.has(k)) nova = novasPorNome.get(k); else { novasPorNome.set(k, nova); usados.add(k); nova.id = estado.api.novoId(COL_LOCALIDADES); nova.secoes = []; }
      }
      const secoes = l ? [...(porEstado(l) ? l.secoes : [])] : nova.secoes;
      const secoesNovas = [];
      if (b.porEstado) b.secoes.forEach((t) => { if (!secaoDoTexto([...secoes, ...secoesNovas], t)) secoesNovas.push(secaoNova(t, [...secoes, ...secoesNovas])); });
      if (nova) { nova.secoes.push(...secoesNovas.filter((s) => !nova.secoes.some((x) => x.id === s.id))); }
      return { b, grupo: g, grupoNovo: g ? "" : frase(b.aba).toUpperCase(), l, nova, secoesNovas: nova ? [] : secoesNovas, trocaModo: !!(l && b.porEstado && !porEstado(l)), todasSecoes: nova ? nova.secoes : [...secoes, ...secoesNovas] };
    });
  }
  function analisar() {
    const fora = new Map(), vistos = new Set(), longos = new Map(), extrasUsados = new Map();
    const porBloco = destinos.map((x) => {
      const { b } = x;
      const dest = x.l ? x.l.id : x.nova.id;
      const atuais = x.l ? existentes.get(x.l.id) || [] : [];
      const indice = new Map(atuais.map((t) => [`${t.secao || ""}|${nomeComparavel((t.campos || {})[colSistema.id])}`, t]));
      const linhas = b.linhas.map((y) => {
        const problemas = [], campos = {}, extras = {};
        const s = b.porEstado ? secaoDoTexto(x.todasSecoes, y.secaoTexto) : null;
        if (b.porEstado && !s) problemas.push(`seção “${y.secaoTexto || "(sem seção)"}” não encontrada`);
        if (!y.sistema) problemas.push("sem o nome do sistema");
        const rs = validarValor(colSistema, y.sistema);
        if (!rs.ok) problemas.push(rs.erro); else if (!estaVazio(rs.valor)) campos[colSistema.id] = rs.valor;
        y.valores.forEach(([k, v]) => {
          if (mapa.get(k) === EXTRA) { const t = lido.titulos.find((z) => z.chave === k); extras[k] = v.slice(0, 300); if (!extrasUsados.has(dest)) extrasUsados.set(dest, new Map()); extrasUsados.get(dest).set(k, t.titulo); return; }
          const col = colPorChave(k);
          if (!col) return;
          if (col.tipo === "texto" && v.length > LIMITES.texto) longos.set(col.id, Math.max(longos.get(col.id) || 0, v.length));
          const extra = novasOpcoes.get(col.id) || [];
          const r = validarValor(extra.length ? { ...col, opcoes: [...col.opcoes, ...extra] } : col.tipo === "texto" && v.length > LIMITES.texto ? { ...col, tipo: "textoLongo" } : col, v);
          if (r.ok) { if (!estaVazio(r.valor)) campos[col.id] = r.valor; return; }
          if (!TIPOS_LISTA.includes(col.tipo) || col.tipo === "etiquetas") { problemas.push(r.erro); return; }
          const fk = `${col.id}|${nomeComparavel(v)}`;
          const f = fora.get(fk) || { chave: fk, col, bruto: v, n: 0, sugestao: r.sugestao || null };
          f.n++; fora.set(fk, f);
          if (!foraVistos.has(fk)) {
            foraVistos.set(fk, f);
            /* Sem escolha ainda: a sugestão forte ("Cobrança realizada" → "Cobrança") ou, na lista vazia (Responsável), acrescentar */
            if (!trocas.has(fk)) { if (sugestaoForte(f.sugestao)) trocas.set(fk, "sugestao"); else if (!opcoesAtivas(col).length) trocas.set(fk, "nova"); }
          }
          const escolha = trocas.get(fk) || "";
          if (escolha === "sugestao" && f.sugestao) campos[col.id] = f.sugestao.id;
          else if (escolha === "nova") { const o = (novasOpcoes.get(col.id) || []).find((z) => nomeComparavel(z.nome) === nomeComparavel(v)); if (o) campos[col.id] = o.id; }
          else if (escolha !== "vazio") problemas.push(`${col.nome}: “${v}” fora da lista`);
        });
        /* Faixa ("NÃO INTEGRADO", "SISTEMA DESCONTINUADO"…): o Status com esse nome (cinza; criado se faltar) */
        if (y.faixa && colSt) {
          const nome = ehNaoIntegradoTexto(y.faixa) ? "Não integrado" : frase(y.faixa);
          const o = opcoesDe(colSt).find((z) => nomeComparavel(z.nome) === nomeComparavel(nome) || (ehNaoIntegradoTexto(y.faixa) && z.id === "nao-integrado")) || (novasOpcoes.get(colSt.id) || []).find((z) => nomeComparavel(z.nome) === nomeComparavel(nome));
          if (o) campos[colSt.id] = o.id;
          else { const lista = novasOpcoes.get(colSt.id) || []; const no = { id: idUnico(nome, [...colSt.opcoes, ...lista].map((z) => z.id)), nome, cor: "cinza", final: true, faixa: true }; lista.push(no); novasOpcoes.set(colSt.id, lista); campos[colSt.id] = no.id; }
        }
        const secao = s ? s.id : "";
        const chave = `${dest}|${secao}|${nomeComparavel(y.sistema)}`;
        let situacao = problemas.length ? "erro" : "nova", existente = null;
        if (!problemas.length && vistos.has(chave)) { situacao = "duplicada"; problemas.push("repetida no arquivo (fica de fora)"); }
        vistos.add(chave);
        if (situacao === "nova") { existente = indice.get(`${secao}|${nomeComparavel(y.sistema)}`) || null; if (existente) situacao = "atualizar"; }
        return { ...y, secao, campos, extras, problemas, situacao, existente };
      });
      return { x, linhas, conta: (s) => linhas.filter((y) => y.situacao === s).length };
    });
    analise = { porBloco, fora: [...fora.values()], longos, extrasUsados };
    return analise;
  }
  function desenhar() {
    if (!lido) { $("#bx-conferencia", d).innerHTML = ""; return; }
    const an = analisar();
    const soma = (s) => an.porBloco.reduce((t, x) => t + x.conta(s), 0);
    const gravaveis = soma("nova") + soma("atualizar");
    const faixas = (novasOpcoes.get(colSt ? colSt.id : "") || []).filter((o) => o.faixa);
    const gruposNovos = [...new Set(destinos.filter((x) => !x.grupo).map((x) => x.grupoNovo))];
    $("#bx-conferencia", d).innerHTML = `
      <h3 style="font-size:15px;margin-top:6px">1. Blocos (${an.porBloco.length}) → planilhas de ${escapar(nomeAmbiente(amb))}</h3>
      ${gruposNovos.length ? `<p class="apoio" style="font-size:13px">Grupos novos: <strong>${escapar(gruposNovos.join(", "))}</strong></p>` : ""}
      <div class="tabela-admin"><table><thead><tr><th>Aba / grupo</th><th>Bloco</th><th>Planilha</th><th>Separação</th><th>Novas</th><th>Atualizar</th><th>Duplicadas</th><th>Com problema</th></tr></thead><tbody>${an.porBloco.map(({ x, conta }) => `<tr>
        <td>${escapar(x.b.aba)}<br><span class="apoio">${escapar(x.grupo ? x.grupo.nome : `${x.grupoNovo} (novo)`)}</span></td><td>${escapar(x.b.titulo)}</td>
        <td>${x.l ? escapar(tituloPlanilha(x.l)) : `${escapar(x.nova.nome)} <span class="selo selo-lilas">nova</span>`}</td>
        <td>${x.b.porEstado ? `⊞ por estado · ${x.todasSecoes.length} seções${x.nova ? "" : x.secoesNovas.length ? ` (${x.secoesNovas.length} nova(s))` : ""}${x.trocaModo ? ' <span class="selo selo-pendente">passa a ser por estado</span>' : ""}` : "≡ por sistema"}</td>
        <td>${conta("nova")}</td><td>${conta("atualizar")}</td><td>${conta("duplicada")}</td><td>${conta("erro") ? `<span style="color:var(--erro-texto)">${conta("erro")}</span>` : 0}</td></tr>`).join("")}</tbody></table></div>
      <h3 style="font-size:15px;margin-top:12px">2. Colunas do Excel → colunas de ${escapar(nomeAmbiente(amb))}</h3>
      <div class="mapa-colunas">${lido.titulos.map((t) => `<label><span>${escapar(t.titulo)} <span class="apoio">${t.ciclo}º ciclo</span></span><select data-bx-mapa="${escapar(t.chave)}"><option value="">Ignorar</option><option value="${EXTRA}"${mapa.get(t.chave) === EXTRA ? " selected" : ""}>Coluna extra da planilha (“${escapar(frase(t.titulo))}”)</option>${cols.filter((c) => c.id !== colSistema.id).map((c) => `<option value="${escapar(c.id)}"${mapa.get(t.chave) === c.id ? " selected" : ""}>${escapar(c.nome)}</option>`).join("")}</select></label>`).join("")}</div>
      ${an.longos.size ? `<p class="apoio" style="font-size:13px">${[...an.longos].map(([c, n]) => `<strong>${escapar(COL[c] ? COL[c].nome : (cols.find((z) => z.id === c) || {}).nome)}</strong> tem textos de até ${n} caracteres`).join("; ")}: ${an.longos.size > 1 ? "essas colunas passam" : "a coluna passa"} a ser <strong>Texto longo</strong> (nada é cortado).</p>` : ""}
      ${faixas.length ? `<p class="apoio" style="font-size:13px">Status novos (faixas cinza, como “NÃO INTEGRADO”): <strong>${escapar(faixas.map((o) => o.nome).join(", "))}</strong>.</p>` : ""}
      ${foraVistos.size ? `<div class="fora-colagem"><h3 style="font-size:15px">3. Valores fora das listas (${foraVistos.size})</h3><p class="apoio" style="font-size:13px">Já vêm escolhidas a opção parecida (ex.: “Cobrança realizada” → “Cobrança”) e, nas listas ainda vazias (Responsável), acrescentar. Confira.</p>
        ${[...foraVistos.values()].map((f) => `<label><span><strong>${escapar(f.col.nome)}</strong>: <span class="valor-fora">“${escapar(f.bruto)}”</span> · ${f.n} linha(s)</span>
          <select data-bx-troca="${escapar(f.chave)}"><option value="">Linha fica de fora</option>${f.sugestao ? `<option value="sugestao"${trocas.get(f.chave) === "sugestao" ? " selected" : ""}>Usar “${escapar(f.sugestao.nome)}”</option>` : ""}<option value="nova"${trocas.get(f.chave) === "nova" ? " selected" : ""}>Acrescentar “${escapar(f.bruto.slice(0, 60))}” à lista</option><option value="vazio"${trocas.get(f.chave) === "vazio" ? " selected" : ""}>Deixar vazio</option></select></label>`).join("")}</div>` : ""}
      ${soma("erro") + soma("duplicada") ? `<details class="erros-import"><summary>Ver as linhas que ficam de fora (${soma("erro") + soma("duplicada")})</summary><ul>${an.porBloco.flatMap(({ x, linhas }) => linhas.filter((y) => y.problemas.length).slice(0, 40).map((y) => `<li><strong>${escapar(x.b.titulo)}</strong>, linha ${y.n} (${escapar(y.sistema || "?")}${y.secaoTexto ? ` · ${escapar(y.secaoTexto)}` : ""}): ${escapar(y.problemas.join("; "))}</li>`)).join("")}</ul></details>` : ""}
      <p class="apoio" style="margin-top:8px"><strong>${soma("nova")}</strong> linha(s) nova(s) e <strong>${soma("atualizar")}</strong> para atualizar em ${an.porBloco.filter(({ linhas }) => linhas.some((y) => ["nova", "atualizar"].includes(y.situacao))).length} planilha(s) (${destinos.filter((x) => x.nova).length} nova(s)). A gravação vai planilha por planilha; se o limite diário do plano gratuito acabar, o resto fica guardado para “Continuar a importação”.</p>`;
    $("#bx-ok", d).disabled = !gravaveis;
    $("#bx-ok", d).textContent = `Importar ${gravaveis} linha(s)`;
  }
  const atualizarNovasOpcoes = () => {
    const faixas = (novasOpcoes.get(colSt ? colSt.id : "") || []).filter((o) => o.faixa);
    novasOpcoes = new Map(faixas.length ? [[colSt.id, faixas]] : []);
    foraVistos.forEach((f) => {
      if (trocas.get(f.chave) !== "nova") return;
      const lista = novasOpcoes.get(f.col.id) || [];
      if (lista.some((o) => nomeComparavel(o.nome) === nomeComparavel(f.bruto))) return;
      lista.push({ id: idUnico(f.bruto, [...f.col.opcoes, ...lista].map((o) => o.id)), nome: f.bruto.slice(0, 100), cor: "" });
      novasOpcoes.set(f.col.id, lista);
    });
  };
  /* A 1ª análise escolhe as trocas padrão; a 2ª já usa as opções novas que elas criam */
  const analisarDuasVezes = () => { analisar(); atualizarNovasOpcoes(); desenhar(); };
  form.arquivo.addEventListener("change", async () => {
    const f = form.arquivo.files[0];
    erro.textContent = "";
    if (!f) return;
    progresso.textContent = "Lendo o arquivo…";
    try { lido = lerBlocos(await lerPlanilhaExcel(f)); }
    catch (err) { console.error(err); progresso.textContent = ""; erro.textContent = err.message || "Não foi possível ler o arquivo."; return; }
    if (!lido.blocos.length) { progresso.textContent = ""; erro.textContent = "Nenhum bloco encontrado (título como “Supremo Tribunal Federal (STF)” e a linha de títulos com “E-mail” e “Status”)."; lido = null; return; }
    adivinhar();
    resolverDestinos();
    for (const x of destinos) if (x.l && !existentes.has(x.l.id)) { progresso.textContent = `Conferindo ${x.l.nome}…`; try { existentes.set(x.l.id, (await dadosDaLocalidade(x.l.id, { forcar: true })).registros); } catch (err) { console.warn(err); existentes.set(x.l.id, []); } }
    progresso.textContent = "";
    trocas.clear(); foraVistos.clear(); novasOpcoes = new Map();
    analisarDuasVezes();
  });
  d.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.bxMapa != null) { mapa.set(t.dataset.bxMapa, t.value); analisarDuasVezes(); }
    if (t.dataset.bxTroca != null) { trocas.set(t.dataset.bxTroca, t.value); atualizarNovasOpcoes(); desenhar(); }
  });
  d.addEventListener("click", (ev) => { if (ev.target.closest('[data-bx="continuar"]')) { d.close(); continuarImportacaoBlocos(); } });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!analise) return;
    const porPlanilha = new Map();
    analise.porBloco.forEach(({ x, linhas }) => {
      const dest = x.l ? x.l.id : x.nova.id;
      if (!porPlanilha.has(dest)) {
        const extrasMapa = analise.extrasUsados.get(dest) || new Map();
        const extras = [...extrasMapa].map(([k, titulo]) => ({ chave: k, nome: frase(titulo).slice(0, 60) }));
        porPlanilha.set(dest, { localidade: dest, ambiente: amb, nome: x.l ? x.l.nome : x.nova.nome, blocos: new Set(), novos: [], alterar: [], extras,
          grupoAba: x.grupo ? x.grupo.id : `__novo:${x.grupoNovo}`,
          criar: x.nova ? { nome: x.nova.nome, sigla: x.nova.sigla, nomeCompleto: x.nova.nomeCompleto, modo: x.b.porEstado ? "estado" : "sistema", secoes: x.nova.secoes } : null,
          mudar: x.l && (x.secoesNovas.length || x.trocaModo) ? { modo: x.b.porEstado ? "estado" : x.l.modo, secoesNovas: x.secoesNovas } : null });
      }
      const p = porPlanilha.get(dest);
      p.blocos.add(x.b.titulo);
      /* Coluna extra que a planilha já tem (mesmo nome): grava direto nela; senão, ela é criada na gravação */
      const extraExistente = (k) => { const t = lido.titulos.find((z) => z.chave === k); const c = x.l && t ? x.l.colunasExtras.find((z) => nomeComparavel(z.nome) === nomeComparavel(frase(t.titulo))) : null; return c ? c.id : `extra:${k}`; };
      linhas.filter((y) => ["nova", "atualizar"].includes(y.situacao)).forEach((y) => {
        const extrasCampos = Object.fromEntries(Object.entries(y.extras).map(([k, v]) => [extraExistente(k), v]));
        if (y.situacao === "atualizar") {
          const mudou = Object.fromEntries(Object.entries({ ...y.campos, ...extrasCampos }).filter(([c, v]) => c !== colSistema.id && JSON.stringify((y.existente.campos || {})[c] ?? "") !== JSON.stringify(v)));
          if (Object.keys(mudou).length) p.alterar.push([y.existente.id, mudou]);
        } else p.novos.push({ id: estado.api.novoId(COL_LOCALIDADES), campos: { ...y.campos, ...extrasCampos }, secao: y.secao });
      });
    });
    const lotes = [...porPlanilha.values()].filter((p) => p.novos.length || p.alterar.length || p.criar || p.mudar).map((p) => ({ ...p, blocos: [...p.blocos] }));
    if (!lotes.some((p) => p.novos.length || p.alterar.length)) { erro.textContent = "Nada para gravar: as linhas que existem já estão com esses valores."; return; }
    const nNovas = lotes.reduce((s, p) => s + p.novos.length, 0), nAlt = lotes.reduce((s, p) => s + p.alterar.length, 0), nCriar = lotes.filter((p) => p.criar).length;
    if (!(await confirmar(`Gravar ${nNovas} linha(s) nova(s) e atualizar ${nAlt} em ${lotes.length} planilha(s) de ${nomeAmbiente(amb)}${nCriar ? ` (${nCriar} planilha(s) nova(s))` : ""}?`, { titulo: "Importar planilha de divulgação", botao: "Importar" }))) return;
    $("#bx-ok", d).disabled = true;
    try {
      /* 1) Estrutura da cadeia: opções novas (Status das faixas, Responsável…) e colunas de texto que viram texto longo */
      if (novasOpcoes.size || analise.longos.size) {
        const base = estruturaDoAmbiente(amb);
        await salvarEstrutura({ ...base, versao: base.versao + 1, colunas: base.colunas.map((c) => ({
          ...c,
          ...(analise.longos.has(c.id) && c.tipo === "texto" ? { tipo: "textoLongo", formato: undefined } : {}),
          ...(novasOpcoes.has(c.id) ? { opcoes: [...c.opcoes, ...novasOpcoes.get(c.id).map(({ faixa, ...o }) => o)] } : {})
        })) }, amb);
        await esperarEstrutura(amb);
        registrarAuditoria("estrutura", `Importação (blocos): ajustou as listas e colunas de ${nomeAmbiente(amb)}`, [...[...novasOpcoes].map(([c, os]) => `${(cols.find((x) => x.id === c) || {}).nome}: ${os.map((o) => o.nome).join(", ")}`), ...[...analise.longos.keys()].map((c) => `${(cols.find((x) => x.id === c) || {}).nome}: texto longo`)].join(" · ").slice(0, 1500), { planilha: "" });
      }
      /* 2) Grupos novos (um por aba que ainda não tem grupo) */
      const gruposNovos = new Map();
      let ordemG = novaOrdem(gruposDe(amb));
      for (const p of lotes) {
        if (!p.grupoAba.startsWith("__novo:")) continue;
        const nome = p.grupoAba.slice(7);
        if (!gruposNovos.has(nome)) { const id = estado.api.novoId(COL_GRUPOS); gruposNovos.set(nome, id); await estado.api.salvarDoc(`${COL_GRUPOS}/${id}`, { ambiente: amb, nome, ordem: ordemG++, criadoEm: "__AGORA__", ...assinaturaAdmin() }); }
        p.grupoAba = gruposNovos.get(nome);
      }
      const plano = { em: new Date().toISOString(), imp: `blocos-${Date.now()}`, lotes };
      if (!gravarLocal(chaveImportacaoBlocos(), plano)) gravarLocal(chaveImportacaoBlocos(), { ...plano, lotes: [], semDados: true });
      d.close();
      await executarImportacaoBlocos(plano);
    } catch (err) { console.error(err); $("#bx-ok", d).disabled = false; erro.textContent = mensagemErro(err); }
  });
  d.showModal();
}
/* Coluna extra (ex.: EMPRESA) de uma planilha: id estável a partir do nome */
const colunaExtraImportada = (nome, ids) => normalizarColuna(colunaBase(idUnico(`extra ${nome}`, ids, true), nome, "texto", { grupo: GRUPO_EXTRAS, acesso: "livre", ordem: ids.length + 1 }), [{ id: GRUPO_EXTRAS }], 0);
async function executarImportacaoBlocos(plano) {
  const total = plano.lotes.length;
  let feitas = 0;
  for (const lote of [...plano.lotes]) {
    mostrarAviso(`Importando ${lote.nome} (${feitas + 1} de ${total})…`, 120000);
    try {
      const amb = lote.ambiente;
      /* Planilha nova, ou a existente com seções novas / trocando para "por estado"; colunas extras */
      const atual = localidadePorId(lote.localidade);
      const extrasAtuais = atual ? atual.colunasExtras : [];
      const ids = [...estruturaDoAmbiente(amb).colunas.map((c) => c.id), ...extrasAtuais.map((c) => c.id)];
      const extrasNovas = [];
      const idDoExtra = new Map((lote.extras || []).map((x) => {
        const ja = [...extrasAtuais, ...extrasNovas].find((c) => nomeComparavel(c.nome) === nomeComparavel(x.nome));
        if (ja) return [x.chave, ja.id];
        const c = colunaExtraImportada(x.nome, ids); ids.push(c.id); extrasNovas.push(c); return [x.chave, c.id];
      }));
      const extrasFinal = [...extrasAtuais, ...extrasNovas].map(({ extra, ...c }) => c);
      const dadosExtras = extrasNovas.length ? { colunasExtras: extrasFinal, colunasEquipeExtras: extrasFinal.filter((c) => c.ativa !== false && !c.somenteAdmin).map((c) => c.id) } : {};
      if (lote.criar && !atual) {
        const ordem = novaOrdem(estado.localidades.filter((l) => l.ambiente === amb && l.grupo === lote.grupoAba));
        await estado.api.salvarDoc(LOC(lote.localidade), { ...dadosNovaLocalidade(amb, { nome: lote.criar.nome, sigla: lote.criar.sigla, nomeCompleto: lote.criar.nomeCompleto, grupo: lote.grupoAba, modo: lote.criar.modo, ...dadosSecoes(lote.criar.secoes), sistemasPadrao: [], uf: "", codigo: "", responsavel: "", cor: "", icone: "i-predio", observacao: "" }, ordem), ...dadosExtras });
        registrarAuditoria("localidade", `Importação (blocos): criou a planilha ${lote.criar.nome} em ${nomeAmbiente(amb)} (${lote.criar.modo === "estado" ? `por estado, ${lote.criar.secoes.length} seções` : "por sistema"})`, "", { planilha: lote.localidade });
      } else if (atual && (lote.mudar || extrasNovas.length)) {
        const secoes = lote.mudar ? [...(porEstado(atual) ? atual.secoes : []), ...lote.mudar.secoesNovas.filter((s) => !atual.secoes.some((x) => x.id === s.id))] : atual.secoes;
        await estado.api.salvarDoc(LOC(atual.id), { ...(lote.mudar ? { modo: lote.mudar.modo, ...dadosSecoes(secoes) } : {}), ...dadosExtras, ...assinaturaAdmin() }, true);
        if (lote.mudar) registrarAuditoria("localidade", `Importação (blocos): ${lote.mudar.secoesNovas.length} seção(ões) nova(s) em ${atual.nome}${lote.mudar.modo !== atual.modo ? " · passou a ser por estado" : ""}`, lote.mudar.secoesNovas.map((s) => s.nome).join(", ").slice(0, 1500), { planilha: atual.id });
      } else if (!atual && !lote.criar) throw Object.assign(new Error("Planilha não existe mais"), { code: "not-found" });
      lote.criar = null; lote.mudar = null; lote.extras = [];
      const trocarExtras = (campos) => Object.fromEntries(Object.entries(campos).map(([c, v]) => [c.startsWith("extra:") ? idDoExtra.get(c.slice(6)) || c : c, v]).filter(([c]) => !c.startsWith("extra:")));
      lote.novos = lote.novos.map((r) => ({ ...r, campos: trocarExtras(r.campos) }));
      lote.alterar = lote.alterar.map(([id, m]) => [id, trocarExtras(m)]);
      gravarLocal(chaveImportacaoBlocos(), plano);
      const e = estruturaDoAmbiente(amb);
      const novos = lote.novos.map((r) => normalizarEquipamento({
        id: r.id, campos: r.campos, secao: r.secao, numero: e.colunaChave && !estaVazio(r.campos[e.colunaChave]) ? montarChave(r.campos[e.colunaChave], r.secao, e.chaveComposta) : "",
        criadoPor: estado.usuario.email, criadoPorNome: estado.usuario.nome, criadoPorEmail: estado.usuario.email, criadoEm: plano.em,
        atualizadoPor: estado.usuario.email, atualizadoPorNome: estado.usuario.nome, atualizadoPorEmail: estado.usuario.email, atualizadoEm: plano.em, importacao: plano.imp
      }));
      if (novos.length || lote.alterar.length) {
        await gravarLinhasNoArquivo(lote.localidade, amb, { novos, alterar: new Map(lote.alterar) });
        await estado.api.lote([{ op: "set", caminho: `${COL_HISTORICO}/${estado.api.novoId(COL_HISTORICO)}`, dados: {
          ambiente: amb, localidade: lote.localidade, localidadeNome: txt(lote.nome, 80), registro: (novos[0] || { id: (lote.alterar[0] || [""])[0] }).id, registroNome: txt(`${novos.length} nova(s), ${lote.alterar.length} atualizada(s)`, 120),
          acao: "importar", coluna: "", colunaNome: "", antes: "", depois: txt(`Planilha de divulgação: ${lote.blocos.join(", ")}`, 500), por: estado.usuario.id, porNome: txt(estado.usuario.nome, 80), ordem: ordemHistorico(amb), em: "__AGORA__"
        } }]);
        registrarAuditoria("importar", `Importou a planilha de divulgação em ${lote.nome}: ${novos.length} linha(s) nova(s), ${lote.alterar.length} atualizada(s)`, lote.blocos.join(", ").slice(0, 1500), { planilha: lote.localidade });
      }
      feitas++;
      plano.lotes = plano.lotes.filter((x) => x !== lote);
      if (plano.lotes.length) gravarLocal(chaveImportacaoBlocos(), plano); else apagarLocal(chaveImportacaoBlocos());
    } catch (err) {
      console.error(err);
      const cota = /resource-exhausted|quota/i.test((err && (err.code || err.message)) || "");
      mostrarAviso(`${feitas} de ${total} planilha(s) importada(s). ${cota ? "O limite diário de gravações do plano gratuito acabou: o resto fica guardado neste navegador. Amanhã, use Importar Excel › Planilha de divulgação › “Continuar a importação”." : `A importação parou em “${lote.nome}” (${mensagemErro(err)}). Use “Continuar a importação”.`}`, 15000);
      return false;
    }
  }
  mostrarAviso(`Pronto: ${total} planilha(s) importada(s).`, 7000);
  return true;
}
async function continuarImportacaoBlocos() {
  const p = lerLocal(chaveImportacaoBlocos(), null);
  if (!p || !Array.isArray(p.lotes) || !p.lotes.length) { apagarLocal(chaveImportacaoBlocos()); mostrarAviso("Não há importação pendente."); return; }
  if (p.semDados) { apagarLocal(chaveImportacaoBlocos()); mostrarAviso("Os dados da importação não couberam neste navegador. Importe o arquivo de novo (o que já foi gravado aparece para atualizar).", 9000); return; }
  await executarImportacaoBlocos(p);
}

/* Registro da entrada na trilha (uma vez por sessão do navegador) */
function registrarEntrada() {
  try {
    if (sessionStorage.getItem(CHAVE_ENTRADA) === estado.usuario.uid) return;
    sessionStorage.setItem(CHAVE_ENTRADA, estado.usuario.uid);
  } catch (e) { /* sem sessionStorage: registra de novo */ }
  registrarAuditoria("entrar", `Entrou no Cadeias V6 / V12 (${NOME_PAPEL[papel()]})`, "", { planilha: "" });
}

/* ---------- Auditoria completa (administradoras): todas as ações, com filtros e exportação ---------- */
const NOMES_ACOES = {
  entrar: "Entrou", exportar: "Exportou", criar: "Criou", editar: "Editou", editarMassa: "Editou em massa", preencherMassa: "Preencheu em massa",
  excluir: "Excluiu (Lixeira)", excluirDeVez: "Excluiu de vez", restaurar: "Restaurou", importar: "Importou", pedirExclusao: "Pediu exclusão",
  recusarExclusao: "Recusou exclusão", estrutura: "Estrutura", pessoa: "Pessoas", backup: "Backup", restaurarBackup: "Restaurou backup",
  apagarBackup: "Apagou backup", compactar: "Compactou", substituirValor: "Substituiu valor", corrigirLista: "Corrigiu lista", aparencia: "Aparência",
  ambiente: "Cadeia", localidade: "Planilhas", excluirLocalidade: "Excluiu planilha", restaurarLocalidade: "Restaurou planilha"
};
const nomeAcao = (a) => NOMES_ACOES[a] || a;
async function renderizarTelaAuditoria() {
  const tela = $("#tela-auditoria");
  let lista = null, falhou = false;
  const f = { de: "", ate: "", pessoa: "", ambiente: "", planilha: "", acao: "", texto: "" };
  const nomeLoc = (id) => (localidadePorId(id) || {}).nome || "";
  tela.innerHTML = `<div class="menu-cabeca"><div><h1 id="auditoria-titulo">Auditoria</h1><p class="apoio">Todas as ações registradas nas duas cadeias, da mais recente para a mais antiga. A trilha é só de inclusão: ninguém edita nem apaga.</p></div>
      <div class="form-botoes"><button type="button" class="btn btn-secundario btn-mini" data-aud="csv">${svg("i-download")}CSV</button><button type="button" class="btn btn-secundario btn-mini" data-aud="pdf">${svg("i-imprimir")}PDF</button></div></div>
    <div class="filtros-auditoria">
      <label class="campo"><span class="rotulo">De</span><input type="date" data-f="de"></label>
      <label class="campo"><span class="rotulo">Até</span><input type="date" data-f="ate"></label>
      <label class="campo"><span class="rotulo">Pessoa</span><select data-f="pessoa"><option value="">Todas</option></select></label>
      <label class="campo"><span class="rotulo">Cadeia</span><select data-f="ambiente"><option value="">V6 e V12</option>${AMBIENTES.map((a) => `<option value="${a.id}">${escapar(a.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span class="rotulo">Planilha</span><select data-f="planilha"><option value="">Todas</option>${AMBIENTES.map((a) => `<optgroup label="${escapar(a.nome)}">${localidadesDe(a.id, { arquivadas: true }).map((l) => `<option value="${escapar(l.id)}">${escapar(l.nome)}</option>`).join("")}</optgroup>`).join("")}<option value="__geral">Geral (entradas, pessoas, estrutura)</option></select></label>
      <label class="campo"><span class="rotulo">Ação</span><select data-f="acao"><option value="">Todas</option></select></label>
      <label class="campo"><span class="rotulo">Buscar</span><input type="search" data-f="texto" placeholder="Registro, resumo…"></label>
    </div>
    <p class="apoio" id="aud-contagem" role="status"></p>
    <ol class="linha-tempo-auditoria" id="aud-lista"><li class="apoio">Carregando…</li></ol>`;
  const filtrados = () => (lista || []).filter((a) => {
    const dia = dataIsoBrasilia(a.em);
    if (f.de && dia < f.de) return false;
    if (f.ate && dia > f.ate) return false;
    if (f.pessoa && a.por !== f.pessoa) return false;
    if (f.ambiente && a.ambiente !== f.ambiente) return false;
    if (f.planilha === "__geral") { if (a.planilha) return false; }
    else if (f.planilha && a.planilha !== f.planilha) return false;
    if (f.acao && a.acao !== f.acao) return false;
    if (f.texto && !normalizar([a.resumo, a.detalhes, a.alvo, a.porNome, ...(a.mudancas || []).flatMap((m) => [m.coluna, m.antes, m.depois])].join(" ")).includes(normalizar(f.texto))) return false;
    return true;
  });
  const quem = (a) => a.porNome || nomePessoa(a.por);
  const desenhar = () => {
    const caixa = $("#aud-lista", tela);
    if (falhou) { caixa.innerHTML = `<li><div class="erro-carregar"><p>Não foi possível carregar a auditoria.</p><button type="button" class="btn btn-secundario btn-mini" data-aud="tentar">Tentar de novo</button></div></li>`; return; }
    if (!lista) return;
    const vis = filtrados();
    $("#aud-contagem", tela).textContent = `${vis.length} de ${lista.length} evento(s)`;
    caixa.innerHTML = vis.length ? vis.slice(0, 1000).map((a) => `<li><div class="aud-cab"><time datetime="${escapar(a.em)}">${escapar(formatarData(a.em, true))}</time> <strong>${escapar(quem(a))}</strong>${a.porEmail ? ` <span class="apoio">${escapar(a.porEmail)}</span>` : ""} <span class="etq">${escapar(nomeAcao(a.acao))}</span>${a.ambiente ? ` <span class="selo selo-ambiente" style="--cor-botao:${escapar(corAmbiente(a.ambiente))}">${escapar(nomeAmbiente(a.ambiente))}</span>` : ""}${a.planilha && nomeLoc(a.planilha) ? ` <span class="selo">${escapar(nomeLoc(a.planilha))}</span>` : ""}</div>
        <p>${escapar(a.resumo)}</p>${a.detalhes ? `<p class="apoio aud-detalhes">${escapar(a.detalhes)}</p>` : ""}
        ${a.mudancas && a.mudancas.length ? `<table class="aud-mudancas"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${a.mudancas.map((m) => `<tr><td>${escapar(m.coluna)}</td><td><del>${escapar(m.antes || "(vazio)")}</del></td><td><ins>${escapar(m.depois || "(vazio)")}</ins></td></tr>`).join("")}</tbody></table>` : ""}</li>`).join("") : '<li class="apoio">Nenhum evento com esses filtros.</li>';
  };
  const preencherFiltros = () => {
    const acoes = [...new Set(lista.map((a) => a.acao))].sort((a, b) => COMPARAR(nomeAcao(a), nomeAcao(b)));
    $('[data-f="acao"]', tela).innerHTML = `<option value="">Todas</option>${acoes.map((a) => `<option value="${escapar(a)}">${escapar(nomeAcao(a))}</option>`).join("")}`;
    const pessoas = [...new Map(lista.map((a) => [a.por, quem(a)])).entries()].sort((a, b) => COMPARAR(a[1], b[1]));
    $('[data-f="pessoa"]', tela).innerHTML = `<option value="">Todas</option>${pessoas.map(([id, n]) => `<option value="${escapar(id)}">${escapar(n)}</option>`).join("")}`;
  };
  const carregar = async () => {
    falhou = false; lista = null;
    $("#aud-lista", tela).innerHTML = '<li class="apoio">Carregando…</li>';
    try { lista = await estado.api.lerColecao(COL_AUDITORIA, { ordenar: "em", desc: true, limite: 2000 }); preencherFiltros(); }
    catch (e) { console.warn(e); falhou = true; }
    desenhar();
  };
  tela.oninput = (e) => { const k = e.target.dataset.f; if (k) { f[k] = e.target.value; desenhar(); } };
  tela.onchange = tela.oninput;
  tela.onclick = (e) => {
    const b = e.target.closest("[data-aud]");
    if (!b) return;
    if (b.dataset.aud === "tentar") { carregar(); return; }
    const vis = filtrados();
    const cab = ["Quando", "Quem", "E-mail", "Ação", "Cadeia", "Planilha", "Alvo", "Resumo", "Detalhes", "Antes → depois"];
    const linhas = vis.map((a) => [formatarData(a.em, true), quem(a), a.porEmail || (String(a.por).includes("@") ? a.por : ""), nomeAcao(a.acao), a.ambiente ? nomeAmbiente(a.ambiente) : "", nomeLoc(a.planilha), a.alvo || "", a.resumo || "", a.detalhes || "", (a.mudancas || []).map((m) => `${m.coluna}: ${m.antes || "(vazio)"} → ${m.depois || "(vazio)"}`).join(" | ")]);
    if (b.dataset.aud === "csv") {
      const p = partesBrasilia();
      baixarArquivo(`cadeias-auditoria-${p.ano}-${p.mes}-${p.dia}.csv`, "\ufeff" + [cab, ...linhas].map((l) => l.map(csvCampo).join(";")).concat(["", csvCampo(rodapeExportacao())]).join("\r\n"), "text/csv;charset=utf-8");
    } else imprimirTabela(`Auditoria · Cadeias V6 / V12 · ${formatarData(new Date(), true)}`, cab, linhas);
    registrarAuditoria("exportar", `Exportou a trilha de auditoria (${b.dataset.aud.toUpperCase()}): ${vis.length} evento(s)`, "", { planilha: "" });
  };
  carregar();
}
window.addEventListener("offline", () => { estado.offline = true; if (estado.usuario) { atualizarBotoes(); agendarRender(); } });
window.addEventListener("online", () => { estado.offline = false; if (estado.usuario) { atualizarBotoes(); agendarRender(); } });

/* ------------------------------------------------------------
 *  Início
 * ------------------------------------------------------------ */
ligarTema();
marcarPlanilha();
/* "Lembrar minha escolha" saiu (a escolha sempre aparece depois de entrar): a chave antiga deste navegador é apagada */
try { Object.keys(localStorage).filter((k) => k.startsWith("cadeias-lembrar-escolha") || k.startsWith("cadeias-recentes:")).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* sem localStorage */ }
/* Aparência livre: por pessoa (este navegador) e padrão de cada cadeia (cadeias-config/aparencia-<ambiente>,
   só administradoras gravam). O padrão só é ouvido com a sessão aberta (as regras exigem login). */
const ambienteDaAparencia = () => (ehAmbiente(estado.ambiente) ? estado.ambiente : "v6");
aparencia = criarAparencia({
  prefixo: "cadeias",
  planilha: () => ({ id: ambienteDaAparencia(), nome: `Cadeia ${nomeAmbiente(ambienteDaAparencia())}` }),
  usuario: () => (estado.usuario ? estado.usuario.email || estado.usuario.id : ""),
  ehAdmin,
  colunas: () => (estado.estrutura ? colunasAtivas() : []),
  valor: (t, col) => valorBruto(t, col),
  texto: (t, col) => valorTexto(t, col),
  opcoes: (col) => opcoesDe(col),
  registros: () => estado.equipamentos,
  repintar: () => { if (estado.estrutura && estado.vista && !$("#app").hidden) pintarLinhas(true); },
  remedir: agendarAjuste,
  aviso: mostrarAviso,
  confirmar,
  ancora: $("#app [data-tema-botao]"),
  padrao: {
    ouvir: (cb) => (estado.api && estado.usuario ? estado.api.ouvirDoc(`${COL_CONFIG}/aparencia-${ambienteDaAparencia()}`, cb, (e) => console.warn("aparência", e)) : null),
    lerImagem: async () => { const d = estado.api && estado.usuario ? await estado.api.lerDoc(`${COL_CONFIG}/aparencia-imagem-${ambienteDaAparencia()}`) : null; return d && d.imagem; },
    /* imagem: texto = grava a imagem; null = apaga; undefined = não mexe */
    gravar: async (dados, imagem) => {
      const amb = ambienteDaAparencia();
      const assinatura = { atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email };
      const ops = [{ op: "set", caminho: `${COL_CONFIG}/aparencia-${amb}`, dados: { tema: dados.tema, regras: dados.regras, permitirPessoal: dados.permitirPessoal, ...assinatura } }];
      if (imagem === null) ops.push({ op: "delete", caminho: `${COL_CONFIG}/aparencia-imagem-${amb}` });
      else if (typeof imagem === "string") ops.push({ op: "set", caminho: `${COL_CONFIG}/aparencia-imagem-${amb}`, dados: { imagem, ...assinatura } });
      await estado.api.lote(ops);
      registrarAuditoria("aparencia", `Padrão de aparência de ${nomeAmbiente(amb)}${dados.permitirPessoal ? "" : " (aparência pessoal desligada)"}`, "", { planilha: "" });
    },
    remover: async () => {
      const amb = ambienteDaAparencia();
      await estado.api.lote([{ op: "delete", caminho: `${COL_CONFIG}/aparencia-${amb}` }, { op: "delete", caminho: `${COL_CONFIG}/aparencia-imagem-${amb}` }]);
      registrarAuditoria("aparencia", `Padrão de aparência de ${nomeAmbiente(amb)} removido`, "", { planilha: "" });
    }
  }
});
(async () => {
  const api = await conectar();
  estado.api = api;
  if (!api) { mostrarRegistro(); marcarErrosIdentidade({}, "Sem conexão com o servidor. Verifique a internet e recarregue a página."); return; }
  instalarLoteDasCadeias(api);
  api.aoMudarUsuario((u) => { aoMudarUsuario(u).catch((e) => { console.error(e); mostrarBloqueio({ titulo: "Algo deu errado", texto: "Não foi possível abrir o Cadeias. Recarregue a página.", verificar: true }); }); });
})();
window.__cadeias = { estado, get aparencia() { return aparencia; } };
