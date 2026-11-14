/*
 * ============================================================
 *  INVENTÁRIO DE EQUIPAMENTOS · Suporte V/Cert
 *  Planilha online do inventário de equipamentos. Site à parte: não tem
 *  nenhum caminho para outros sites e não lê dados deles. Os cadastros
 *  são só daqui (quem entra em outro site não entra aqui, e vice-versa).
 *
 *  Papéis: administradora (tudo, inclusive estrutura), equipe
 *  (vê, pesquisa e alimenta), leitura (só vê e pesquisa).
 *  As mesmas permissões estão no firestore.rules (vale o que está lá).
 *
 *  Firestore (prefixo "inventario"):
 *   inventario-config/estrutura  colunas (acesso: bloqueado | livre | lista | travado), grupos, regras,
 *                                colunasEquipe, colunasTravadas e listasEquipe { idColuna: [ids das opções ativas] }
 *   inventario-config/ciclo      ciclo de auditoria { inicio, encerradoEm, resumo }
 *   inventario/{id}              { campos: {colunaId: valor}, numero (HOSTNAME), dna (DNA), criadoPor (uid ou e-mail
 *                                da administradora), criadoPorNome, criadoPorEmail, criadoEm, atualizadoPor,
 *                                atualizadoPorNome, atualizadoPorEmail, atualizadoEm, exclusao }
 *   inventario/{id}/historico/{e} quem (por, porNome, porEmail), quando, coluna, antes, depois
 *   inventario-arquivo/{parte}   equipamentos compactados (muitos por documento): { versao, indice, total, json }.
 *                                Um registro em inventario/{id} com o mesmo id substitui a linha do arquivo; com
 *                                "parcial: true" ele só traz os campos alterados, por cima da linha.
 *   inventario-hostnames/{valor} índice do HOSTNAME (único): { equipamento }
 *   inventario-dnas/{valor}      índice do DNA (único): { equipamento }
 *   inventario-identidades/{email} a "conta" da equipe: { email, nome, nomeChave, papel, ativo, aprovado,
 *                                criadoEm, criadoPorUid, atualizadoEm, revogadoAntesDe }. Só administradoras
 *                                e os aparelhos ligados a ela leem.
 *   inventario-emails/{email}    vazio: "este e-mail tem cadastro" (lido um por vez, nunca listado)
 *   inventario-pessoas/{uid}     o aparelho (login anônimo deste navegador): { email, nomeChave, vinculadoEm, ultimoAcesso }
 *   inventario-lixeira, inventario-backups (só administradoras), inventario-auditoria (só inclusão)
 *
 *  Motor de planilha com estrutura dinâmica (colunas, listas, regras), arquivo compactado e histórico.
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
/* Todas as chaves deste site (localStorage) começam com "inventario-" */
const lerLocal = (chave, padrao) => { try { const v = localStorage.getItem(chave); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } };
const gravarLocal = (chave, valor) => { try { localStorage.setItem(chave, JSON.stringify(valor)); return true; } catch (e) { return false; } };
const apagarLocal = (chave) => { try { localStorage.removeItem(chave); } catch (e) {} };
const CHAVE_TEMA = "inventario-tema";
const CHAVE_ATIVIDADE = "inventario-ultima-atividade";
const CHAVE_COPIA = "inventario-copia";
const CHAVE_MARCADOR = "inventario-marcador-removidas";
/* Planilhas do INVENTÁRIO / AUDITORIA. O id do Inventário de Equipamentos continua "inventario" (visões e
   rascunhos já salvos usam esse id). As de VCORP/VCERT só as administradoras editam (soAdmin; as regras do
   Firestore garantem). Só o Inventário de Equipamentos tem índices de HOSTNAME/DNA, ciclo de auditoria e
   arquivo compactado. "estrutura": onde ficam as colunas; "chave" = nome no endereço (?inv=…&aba=…). */
const PLANILHAS = [
  { id: "inventario", chave: "equipamentos", nome: "INVENTÁRIO DE EQUIPAMENTOS", curto: "Inventário de Equipamentos", prefixo: "inventario",
    estrutura: "inventario-config/estrutura", indices: true, ciclo: true, arquivo: true,
    termo: { um: "equipamento", varios: "equipamentos", novo: "Novo equipamento" } },
  { id: "vcorp-hw", grupo: "vcorp", aba: "hw", tipo: "hw", nome: "INVENTÁRIO VCORP · HARDWARE", curto: "Hardware", prefixo: "inventario-vcorp-hw",
    estrutura: "inventario-colunas/vcorp-hw", soAdmin: true, termo: { um: "equipamento", varios: "equipamentos", novo: "Novo hardware" } },
  { id: "vcorp-sw", grupo: "vcorp", aba: "sw", tipo: "sw", nome: "INVENTÁRIO VCORP · SOFTWARE", curto: "Software", prefixo: "inventario-vcorp-sw",
    estrutura: "inventario-colunas/vcorp-sw", soAdmin: true, termo: { um: "software", varios: "softwares", novo: "Novo software" } },
  { id: "vcert-hw", grupo: "vcert", aba: "hw", tipo: "hw", nome: "INVENTÁRIO VCERT · HARDWARE", curto: "Hardware", prefixo: "inventario-vcert-hw",
    estrutura: "inventario-colunas/vcert-hw", soAdmin: true, termo: { um: "equipamento", varios: "equipamentos", novo: "Novo hardware" } },
  { id: "vcert-sw", grupo: "vcert", aba: "sw", tipo: "sw", nome: "INVENTÁRIO VCERT · SOFTWARE", curto: "Software", prefixo: "inventario-vcert-sw",
    estrutura: "inventario-colunas/vcert-sw", soAdmin: true, termo: { um: "software", varios: "softwares", novo: "Novo software" } }
];
const GRUPOS_INVENTARIO = { vcorp: "VCORP", vcert: "VCERT" };
const planilhaPorId = (id) => PLANILHAS.find((p) => p.id === id) || null;
const planilhaDe = (grupo, aba) => PLANILHAS.find((p) => p.grupo === grupo && p.aba === aba) || null;
const planilhaAtual = () => PLANILHAS.find((p) => p.id === estado.planilha) || PLANILHAS[0];
const caminhoEstrutura = (pl = planilhaAtual()) => pl.estrutura;
const termo = () => planilhaAtual().termo;
const somenteAdminEdita = () => !!planilhaAtual().soAdmin;
const nomeCompletoPlanilha = (pl) => (pl.grupo ? `Inventário ${GRUPOS_INVENTARIO[pl.grupo]} · ${pl.curto}` : pl.curto);
/* Lixeira, backups e auditoria são das quatro… cinco planilhas juntas (o campo "planilha" diz de qual é) */
const COL_LIXEIRA = "inventario-lixeira", COL_BACKUPS = "inventario-backups", COL_AUDITORIA = "inventario-auditoria";
const daPlanilhaAtual = (doc) => (doc && doc.planilha ? doc.planilha : "inventario") === planilhaAtual().id;
/* Prefixo das coleções da planilha ("inventario") */
const P = () => planilhaAtual().prefixo;
/* Cópia no navegador (sem conexão): uma por planilha; a do Inventário de Equipamentos guarda também a identificação */
const chaveCopia = () => (planilhaAtual().id === "inventario" ? CHAVE_COPIA : `${CHAVE_COPIA}:${planilhaAtual().id}`);
/* Visões, filtros e rascunho: por pessoa (e-mail) e por planilha */
const idLocal = () => (estado.usuario && (estado.usuario.email || estado.usuario.id)) || "anonimo";
const chaveUsuario = (nome) => `inventario-${nome}:${planilhaAtual().id}:${idLocal()}`;
const CHAVE_CONTAS = "inventario-contas-recentes";
const CHAVE_TENTATIVAS = "inventario-tentativas-nome";
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
   "travado": a equipe preenche ao cadastrar o equipamento; depois, só as administradoras alteram. */
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

/* Colunas do inventário (os ids são usados nas regras do Firestore: não mude) */
const ID_HOSTNAME = "hostname", ID_DNA = "dna", ID_AREA = "area", ID_GESTOR = "gestor", ID_STATUS = "status", ID_AUDITORIA = "auditoria", ID_TECNICO = "tecnico";
const AUD_PENDENTE = "pendente", AUD_OK = "auditado-ok", AUD_DIVERGENCIA = "divergencia-encontrada", AUD_NAO_LOCALIZADO = "nao-localizado";
const STATUS_BAIXADO = "baixado-descartado";
function estruturaInicial() {
  const op = (nome, cor = "", extra = {}) => ({ id: slug(nome, 40), nome, cor, ...extra });
  const col = (id, nome, tipo, extra = {}) => ({ id, nome, tipo, grupo: "equipamento", largura: 160, obrigatoria: false, unica: false, padrao: "", opcoes: [], ajuda: "", somenteAdmin: false, ativa: true, ...extra });
  const colunas = [
    col(ID_HOSTNAME, "HOSTNAME", "texto", { obrigatoria: true, unica: true, acesso: "travado", largura: 170, ajuda: "Nome da máquina na rede. Fica em maiúsculas, sem espaços." }),
    col(ID_DNA, "DNA", "texto", { unica: true, acesso: "travado", largura: 150, ajuda: "Identificador da máquina no cadastro DNA." }),
    col("usuario", "NOME DO USUÁRIO", "texto", { acesso: "livre", largura: 220 }),
    col(ID_AREA, "ÁREA", "lista", { acesso: "lista", largura: 190, opcoes: ["SAC", "SUPORTE OPERACIONAL", "SUPORTE N2"].map((n) => op(n)) }),
    col(ID_GESTOR, "GESTOR", "lista", { acesso: "lista", largura: 200, opcoes: [] }),
    col(ID_STATUS, "STATUS", "status", { acesso: "lista", largura: 190, opcoes: [
      op("Em uso", "verde"), op("Disponível", "azul"), op("Em manutenção", "laranja"), op("Aguardando devolução", "amarelo"),
      op("Emprestado", "roxo"), op("Extraviado", "vermelho"), op("Baixado/descartado", "cinza", { final: true })] }),
    col(ID_AUDITORIA, "AUDITORIA", "lista", { acesso: "lista", largura: 200, opcoes: [
      op("Pendente", "amarelo"), op("Auditado - OK", "verde"), op("Divergência encontrada", "laranja"), op("Não localizado", "vermelho")] }),
    col(ID_TECNICO, "TÉCNICO", "lista", { acesso: "lista", largura: 180, opcoes: ["Anderson Leite", "Davi Santos", "David Bezerra", "Fabiana Santos", "Guilherme Bezerra", "Isaque Pereira", "Lays Almeida", "Maria Luisa Chaves", "Paula Katiele"].map((n) => op(n)) }),
    col("observacao", "OBSERVAÇÃO", "textoLongo", { acesso: "livre", largura: 280 })
  ].map((c, i) => ({ ...c, ordem: i + 1 }));
  return {
    titulo: "INVENTÁRIO DE EQUIPAMENTOS",
    versao: 1,
    categorias: [],
    colunas,
    gruposColunas: [{ id: "equipamento", nome: "Equipamento", ordem: 1 }],
    regras: { equipeEdita: "todas", janelaEdicaoHoras: 0, exportacao: true, registro: { ...REGISTRO_PADRAO } }
  };
}
/* VCORP/VCERT · Software: quatro colunas FIXAS, nesta ordem, obrigatórias, que não se removem nem se renomeiam
   (os ids são conferidos no firestore.rules). As extras entram depois delas. */
const ID_APLICACAO = "nomeAplicacao", ID_VERSAO = "versao", ID_MES_ANO = "mesAno", ID_SERIE = "numeroSerie";
const COLUNAS_FIXAS_SW = [
  { id: ID_APLICACAO, nome: "NOME DA APLICAÇÃO", tipo: "texto", largura: 240, ajuda: "Nome do programa instalado." },
  { id: ID_VERSAO, nome: "VERSÃO", tipo: "texto", largura: 130, ajuda: "Ex.: 10.2.3" },
  { id: ID_HOSTNAME, nome: "HOSTNAME", tipo: "texto", largura: 170, formato: "hostname", ajuda: "Nome da máquina na rede. Fica em maiúsculas, sem espaços." },
  { id: ID_MES_ANO, nome: "MÊS/ANO", tipo: "mesAno", largura: 120, ajuda: "Mês da coleta (MM/AAAA)." }
];
const FIXAS_SW = COLUNAS_FIXAS_SW.map((c) => c.id);
const ehColunaFixa = (pl, id) => !!pl && pl.tipo === "sw" && FIXAS_SW.includes(id);
function colunaBase(id, nome, tipo, extra = {}) {
  return { id, nome, tipo, grupo: "geral", largura: 160, obrigatoria: false, unica: false, padrao: "", opcoes: [], ajuda: "", somenteAdmin: false, acesso: "livre", ativa: true, ...extra };
}
function estruturaInicialPerfil(pl) {
  const op = (nome, cor = "", extra = {}) => ({ id: slug(nome, 40), nome, cor, ...extra });
  const colunas = pl.tipo === "sw"
    ? [...COLUNAS_FIXAS_SW.map((c) => colunaBase(c.id, c.nome, c.tipo, { ...c, obrigatoria: true })),
      colunaBase("fabricante", "FABRICANTE", "texto"), colunaBase("licenca", "LICENÇA", "texto"), colunaBase("observacao", "OBSERVAÇÃO", "textoLongo", { largura: 260 })]
    : [colunaBase(ID_HOSTNAME, "HOSTNAME", "texto", { largura: 170, formato: "hostname", ajuda: "Nome da máquina na rede. Fica em maiúsculas, sem espaços." }),
      colunaBase("tipo", "TIPO", "lista", { acesso: "lista", opcoes: ["Desktop", "Notebook", "Servidor", "Monitor", "Outro"].map((n) => op(n)) }),
      colunaBase("fabricante", "FABRICANTE", "texto"), colunaBase("modelo", "MODELO", "texto"),
      colunaBase(ID_SERIE, "Nº DE SÉRIE", "texto", { largura: 150, ajuda: "Identifica o equipamento (sem série, vale o HOSTNAME)." }),
      colunaBase("patrimonio", "PATRIMÔNIO", "texto", { largura: 130 }), colunaBase("processador", "PROCESSADOR", "texto"),
      colunaBase("memoria", "MEMÓRIA", "texto", { largura: 120 }), colunaBase("armazenamento", "ARMAZENAMENTO", "texto", { largura: 140 }),
      colunaBase("sistemaOperacional", "SISTEMA OPERACIONAL", "texto", { largura: 180 }), colunaBase("localizacao", "LOCALIZAÇÃO", "texto"),
      colunaBase("responsavel", "RESPONSÁVEL", "texto"),
      colunaBase(ID_STATUS, "STATUS", "status", { acesso: "lista", opcoes: [op("Ativo", "verde"), op("Estoque", "azul"), op("Manutenção", "laranja"), op("Baixado", "cinza", { final: true })] }),
      colunaBase(ID_MES_ANO, "MÊS/ANO", "mesAno", { largura: 120, ajuda: "Mês da coleta (MM/AAAA)." })];
  return {
    titulo: pl.nome, versao: 1, categorias: [],
    colunas: colunas.map((c, i) => ({ ...c, ordem: i + 1 })),
    gruposColunas: [{ id: "geral", nome: pl.tipo === "sw" ? "Software" : "Hardware", ordem: 1 }],
    regras: { equipeEdita: "nenhuma", janelaEdicaoHoras: 0, exportacao: true, registro: { ...REGISTRO_PADRAO } }
  };
}
/* Software: as quatro fixas sempre existem, ativas, obrigatórias, com o nome e o tipo certos, antes das extras */
function garantirFixasSoftware(e) {
  const grupo = ([...e.gruposColunas].sort((a, b) => a.ordem - b.ordem)[0] || { id: "geral" }).id;
  const fixas = COLUNAS_FIXAS_SW.map((f, i) => {
    const atual = e.colunas.find((c) => c.id === f.id);
    return { ...colunaBase(f.id, f.nome, f.tipo, f), ...(atual || {}), id: f.id, nome: f.nome, tipo: f.tipo, ...(f.formato ? { formato: f.formato } : {}),
      obrigatoria: true, ativa: true, somenteAdmin: false, acesso: "livre", opcoes: [], grupo: atual ? atual.grupo : grupo, ordem: i + 1, fixa: true };
  });
  const extras = e.colunas.filter((c) => !FIXAS_SW.includes(c.id)).map((c, i) => ({ ...c, ordem: FIXAS_SW.length + 1 + i }));
  const og = (g) => (e.gruposColunas.find((x) => x.id === g) || {}).ordem || 99;
  extras.sort((a, b) => og(a.grupo) - og(b.grupo) || a.ordem - b.ordem).forEach((c, i) => { c.ordem = FIXAS_SW.length + 1 + i; });
  /* As fixas ficam no primeiro grupo, sempre na frente */
  fixas.forEach((c) => { c.grupo = grupo; });
  return { ...e, colunas: [...fixas, ...extras] };
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
function normalizarEstrutura(d, pl = planilhaAtual()) {
  if (!d || typeof d !== "object") return null;
  const e = normalizarEstruturaBase(d);
  return pl && pl.tipo === "sw" ? garantirFixasSoftware(e) : e;
}
function normalizarEstruturaBase(d) {
  const grupos = (Array.isArray(d.gruposColunas) ? d.gruposColunas : []).filter((g) => g && RE_OPCAO.test(g.id || ""))
    .map((g, i) => ({ id: g.id, nome: txt(g.nome, 60) || g.id, ordem: Number(g.ordem) || i + 1 }));
  if (!grupos.length) grupos.push({ id: "geral", nome: "Geral", ordem: 1 });
  const colunas = (Array.isArray(d.colunas) ? d.colunas : []).filter((c) => c && RE_ID.test(c.id || "") && NOME_TIPO[c.tipo]).map((c, i) => ({
    id: c.id, nome: txt(c.nome, 60) || c.id, tipo: c.tipo,
    grupo: grupos.some((g) => g.id === c.grupo) ? c.grupo : grupos[0].id,
    ordem: Number(c.ordem) || i + 1, largura: Math.max(60, Math.min(600, Number(c.largura) || 150)),
    ...(Number(c.ordemFormulario) > 0 ? { ordemFormulario: Math.min(999, Math.round(Number(c.ordemFormulario))) } : {}),
    obrigatoria: !!c.obrigatoria, unica: !!c.unica, padrao: txt(c.padrao, 60),
    opcoes: (Array.isArray(c.opcoes) ? c.opcoes : []).map(normalizarOpcao).filter(Boolean).slice(0, MAX_OPCOES_TOTAL),
    ajuda: txt(c.ajuda, 200), acesso: acessoDe(c), somenteAdmin: acessoDe(c) === "bloqueado", ativa: c.ativa !== false,
    ...(c.formato === "hostname" ? { formato: "hostname" } : {}),
    ...(c.tipo === "automatico" ? { auto: AUTOS[c.auto] ? c.auto : "criadoEm" } : {}),
    ...(c.tipo === "derivado" ? { formula: FORMULAS[c.formula] ? c.formula : "diasEmAberto", de: txt(c.de, 40), ate: txt(c.ate, 40) } : {})
  }));
  const r = d.regras || {};
  return {
    titulo: txt(d.titulo, 80) || planilhaAtual().nome,
    versao: Number(d.versao) || 1,
    categorias: [], colunas, gruposColunas: grupos,
    regras: {
      equipeEdita: EQUIPE_EDITA.some((x) => x.id === r.equipeEdita) ? r.equipeEdita : "todas",
      janelaEdicaoHoras: Math.max(0, Math.min(8760, Math.floor(Number(r.janelaEdicaoHoras) || 0))),
      exportacao: r.exportacao !== false,
      registro: normalizarRegistro(r.registro)
    },
    atualizadoEm: d.atualizadoEm || "", atualizadoPor: txt(d.atualizadoPor, 120)
  };
}
/* Listas que as regras do Firestore usam: o que a equipe pode preencher, o que fica travado depois de criado
   e as opções que a equipe pode gravar em cada coluna LISTA */
const colunasDaEquipe = (e) => e.colunas.filter((c) => c.ativa && !c.somenteAdmin && !TIPOS_SEM_EDICAO.includes(c.tipo)).map((c) => c.id);
const colunasTravadas = (e) => e.colunas.filter((c) => c.acesso === "travado" && !TIPOS_SEM_EDICAO.includes(c.tipo)).map((c) => c.id);
const listasDaEquipe = (e) => Object.fromEntries(e.colunas.filter((c) => c.ativa && c.acesso === "lista")
  .map((c) => [c.id, c.opcoes.filter((o) => o.ativa !== false).map((o) => o.id)]));
function dadosEstrutura(e) {
  const { atualizadoEm, atualizadoPor, ...resto } = e;
  return { ...resto, colunasEquipe: colunasDaEquipe(e), colunasTravadas: colunasTravadas(e), listasEquipe: listasDaEquipe(e), atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email };
}

/* ------------------------------------------------------------
 *  Estado
 * ------------------------------------------------------------ */
/* docs: todos os documentos de inventario-arquivo (de qualquer versão); partes: os da versão em uso */
function arquivoVazio() { return { versao: 0, docs: [], partes: [], linhas: [], parteDe: new Map() }; }
const estado = {
  api: null,
  planilha: PLANILHAS[0].id,  // planilha aberta (PLANILHAS)
  ouvintesPlanilha: [],       // onSnapshot só da planilha aberta
  usuario: null,              // { id (uid ou e-mail da administradora), uid, email, nome, papel: "admin" | "equipe" | "leitura", vinculadoEm }
  registrando: 0,             // > 0 durante o "Entrar" (login anônimo + ligar o aparelho ou criar o cadastro)
  estrutura: null,
  carregouEstrutura: false,
  ciclo: null,                // inventario-config/ciclo (ciclo de auditoria)
  equipamentos: [],                // equipamentos: arquivo + registros vivos (o vivo substitui a linha do arquivo de mesmo id)
  carregouEquipamentos: false,
  vivos: [],                  // inventario/{id}
  carregouVivos: false,
  arquivo: arquivoVazio(),    // inventario-arquivo
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
  pessoas: [],                // inventario-pessoas (aparelhos), só administradoras
  identidades: [],            // inventario-identidades, só administradoras
  pararOuvintes: [],
  mensagemBloqueio: null
};
/* Aparência livre (aparencia.js): criada no fim do arquivo, depois de tudo definido */
let aparencia = null;
const SEM_APARENCIA = { l: "", c: {} };
const papel = () => (estado.usuario ? estado.usuario.papel : "");
const ehAdmin = () => papel() === "admin";
const conectado = () => !!estado.api && !estado.offline;
const podeAlimentar = () => conectado() && !!estado.estrutura && (ehAdmin() || (papel() === "equipe" && !somenteAdminEdita()));
/* Exportar: administradoras sempre; VCORP/VCERT, todo mundo; Inventário de Equipamentos, conforme a regra da estrutura */
const podeExportar = () => !!estado.estrutura && (ehAdmin() || somenteAdminEdita() || estado.estrutura.regras.exportacao !== false);
/* Selo "Somente visualização": quem não pode alterar nada nesta planilha */
const soVisualizacao = () => !!estado.usuario && !ehAdmin() && (somenteAdminEdita() || papel() === "leitura");
const porId = (id) => estado.equipamentos.find((t) => t.id === id);
const mapaEquipamentos = () => new Map(estado.equipamentos.map((t) => [t.id, t]));
/* Índice do HOSTNAME (refeito quando a lista de equipamentos muda) */
let indiceNumeros = null, indiceNumerosDe = null;
function equipamentosComHostname(chave) {
  if (indiceNumerosDe !== estado.equipamentos) {
    indiceNumeros = new Map();
    const id = idChave();
    estado.equipamentos.forEach((t) => {
      const n = (t.campos || {})[id];
      const k = estaVazio(n) ? t.numero : chaveNumero(n);
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
/* Coluna-chave (valor único, indexado em inventario-hostnames): HOSTNAME. Só no Inventário de Equipamentos;
   nas planilhas VCORP/VCERT o HOSTNAME se repete (um por software) e a duplicidade tem regra própria. */
const colNumero = () => colAtiva(ID_HOSTNAME);
const idChave = () => (planilhaAtual().indices ? ID_HOSTNAME : "");
/* Valores únicos indexados no servidor, no mesmo lote do registro. O registro guarda a chave em "numero" (HOSTNAME)
   e "dna" (DNA): as regras conferem que é o mesmo valor da célula e que o índice aponta para o registro.
   Trocado em marcarPlanilha(): vazio nas planilhas sem índice. */
const INDICES_EQUIPAMENTOS = [
  { campo: "numero", col: ID_HOSTNAME, colecao: "hostnames" },
  { campo: "dna", col: ID_DNA, colecao: "dnas" }
];
let INDICES = INDICES_EQUIPAMENTOS;
const chaveIndice = (ix, campos) => (colAtiva(ix.col) && !estaVazio((campos || {})[ix.col]) ? chaveNumero(campos[ix.col]) : "");
/* Escritas dos índices quando os valores mudam (antes = campos atuais; depois = campos completos novos).
   Devolve { dados (numero/dna para o registro), ops (criar o índice novo e apagar o antigo) } */
function indicesMudanca(id, antes, depois) {
  const dados = {}, ops = [];
  INDICES.forEach((ix) => {
    if (!colAtiva(ix.col)) return;
    const a = chaveIndice(ix, antes), b = chaveIndice(ix, depois);
    if (a === b) return;
    dados[ix.campo] = b;
    if (b) ops.push({ op: "set", caminho: `${P()}-${ix.colecao}/${b}`, dados: { equipamento: id } });
    if (a) ops.push({ op: "delete", caminho: `${P()}-${ix.colecao}/${a}` });
  });
  return { dados, ops };
}
/* Apagar os índices de equipamentos que saem de vez (ou vão para a lixeira) */
const opsApagarIndices = (t) => INDICES.flatMap((ix) => { const k = chaveIndice(ix, t.campos) || t[ix.campo] || ""; return k ? [{ op: "delete", caminho: `${P()}-${ix.colecao}/${k}` }] : []; });
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
/* Lista ainda sem opções (ex.: GESTOR antes de as administradoras cadastrarem) */
const textoListaVazia = (col) => (col.id === ID_GESTOR ? "Peça a uma administradora para cadastrar os gestores" : `Peça a uma administradora para cadastrar as opções de ${col.nome}`);
function htmlValor(t, col) {
  const v = valorBruto(t, col);
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) {
    return col.tipo === "lista" && !opcoesAtivas(col).length ? `<span class="t vazio-lista">${escapar(textoListaVazia(col))}</span>` : "";
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
/* HOSTNAME e DNA: maiúsculas, sem espaços nas pontas. A chave do índice é o próprio valor (as regras conferem). */
const RE_CHAVE_INDICE = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;
const ehColunaIndice = (col) => !!col && INDICES.some((ix) => ix.col === col.id);
function chaveNumero(v) {
  return String(v == null ? "" : v).trim().toUpperCase();
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
      if (ehColunaIndice(col) || col.formato === "hostname") {
        const v = chaveNumero(bruto);
        if (v && !RE_CHAVE_INDICE.test(v)) return { ok: false, erro: `${col.nome}: use só letras, números, ponto, hífen ou sublinhado (sem espaços nem acentos), até 80.` };
        return { ok: true, valor: v };
      }
      const v = String(bruto == null ? "" : bruto).trim().slice(0, LIMITES[col.tipo]);
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
      const chave = ehChave || ehColunaIndice(c) ? chaveNumero(v) : normalizar(v);
      const outro = ehChave
        ? equipamentosComHostname(chave).find((t) => t.id !== ignorar && !estaVazio((t.campos || {})[c.id]))
        : estado.equipamentos.find((t) => t.id !== ignorar && !estaVazio((t.campos || {})[c.id]) && (ehColunaIndice(c) ? chaveNumero(t.campos[c.id]) : normalizar(t.campos[c.id])) === chave);
      if (outro) {
        const hostname = colNumero() && outro.campos && outro.campos[idChave()];
        erros[c.id] = { texto: `${c.nome} “${valorTexto(outro, c)}” já é usado pelo equipamento ${hostname || "sem HOSTNAME"}.`, id: outro.id };
      }
    }
  });
  const chave = chaveDuplicidade(campos);
  if (chave) {
    const outro = estado.equipamentos.find((t) => t.id !== ignorar && chaveDuplicidade(t.campos || {}) === chave);
    const col = colunaDaDuplicidade(campos);
    if (outro && col && !erros[col]) erros[col] = { texto: `Já existe ${planilhaAtual().tipo === "sw" ? "este software (mesmo HOSTNAME, aplicação, versão e mês/ano)" : "um equipamento com este Nº DE SÉRIE (ou HOSTNAME)"} nesta planilha.`, id: outro.id };
  }
  return erros;
}
/* Chave de duplicidade das planilhas VCORP/VCERT. Software: HOSTNAME + NOME DA APLICAÇÃO + VERSÃO + MÊS/ANO.
   Hardware: Nº DE SÉRIE (ou HOSTNAME, se não houver série). Vazio = não confere. */
function chaveDuplicidade(campos, pl = planilhaAtual()) {
  const v = (id) => normalizar(String((campos || {})[id] == null ? "" : campos[id]).trim());
  if (pl.tipo === "sw") {
    const partes = [chaveNumero(campos[ID_HOSTNAME] || ""), v(ID_APLICACAO), v(ID_VERSAO), String(campos[ID_MES_ANO] || "")];
    return partes.every(Boolean) ? "sw|" + partes.join("|") : "";
  }
  if (pl.tipo === "hw") {
    if (v(ID_SERIE)) return "serie|" + v(ID_SERIE);
    return campos[ID_HOSTNAME] ? "host|" + chaveNumero(campos[ID_HOSTNAME]) : "";
  }
  return "";
}
const colunaDaDuplicidade = (campos, pl = planilhaAtual()) => (pl.tipo === "sw" ? ID_APLICACAO : pl.tipo === "hw" ? (String((campos || {})[ID_SERIE] || "").trim() ? ID_SERIE : ID_HOSTNAME) : "");
/* Qualidade (VCORP/VCERT): obrigatório vazio, formato inválido ou duplicado. Recalculado a cada desenho da planilha. */
let problemasPorId = new Map();
function calcularProblemas() {
  problemasPorId = new Map();
  if (!planilhaAtual().tipo || !estado.estrutura) return;
  const cols = colunasAtivas().filter((c) => !TIPOS_SEM_EDICAO.includes(c.tipo));
  const contagem = new Map();
  estado.equipamentos.forEach((t) => { const k = chaveDuplicidade(t.campos || {}); if (k) contagem.set(k, (contagem.get(k) || 0) + 1); });
  estado.equipamentos.forEach((t) => {
    const campos = t.campos || {}, lista = [];
    cols.forEach((c) => {
      const v = campos[c.id];
      if (c.obrigatoria && estaVazio(v)) { lista.push(`${c.nome} vazio`); return; }
      if (estaVazio(v)) return;
      if (c.tipo === "mesAno" && !RE_MES_ANO.test(String(v))) lista.push(`${c.nome} fora do formato MM/AAAA`);
      if (c.formato === "hostname" && !RE_CHAVE_INDICE.test(String(v))) lista.push(`${c.nome} em formato inválido`);
    });
    const k = chaveDuplicidade(campos);
    if (k && contagem.get(k) > 1) lista.push("duplicado nesta planilha");
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
  /* Auditoria (só equipamentos que não estão "Baixado/descartado") e "Sem técnico" */
  if (especial.startsWith("aud:")) return naAuditoria(t) && (t.campos || {})[ID_AUDITORIA] === especial.slice(4);
  if (especial === "semTecnico") return naAuditoria(t) && estaVazio((t.campos || {})[ID_TECNICO]);
  if (especial === "meus") return t.criadoPor === estado.usuario.id || registradoPorMim(t);
  return true;
}
/* Abas que filtram: as opções da lista ÁREA (acompanham as opções que as administradoras ajustam) */
const colAbas = () => colAtiva(ID_AREA);
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
function equipamentosFiltrados() {
  const vista = estado.vista;
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
  const filtrados = equipamentosFiltrados();
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
/* Resumo do inventário: total, por STATUS, auditoria (pendente, divergências, não localizados) e sem técnico */
function renderizarResumo() {
  const base = estado.equipamentos.filter(naAba);
  const esp = estado.vista.especial;
  const botao = (chave, conteudo, titulo) => `<button type="button" data-especial="${escapar(chave)}" aria-pressed="${esp === chave}" title="${escapar(titulo)}">${conteudo}</button>`;
  const partes = [botao("", `Total <strong>${base.length.toLocaleString("pt-BR")}</strong>`, "Todos os equipamentos (tira o filtro do resumo)")];
  const st = colAtiva(ID_STATUS);
  if (st) {
    partes.push('<span class="sep-resumo" aria-hidden="true"></span>');
    opcoesDe(st).forEach((o) => {
      const n = base.filter((t) => (t.campos || {})[st.id] === o.id).length;
      if (o.ativa === false && !n) return;
      partes.push(botao(`status:${o.id}`, `<span class="ponto-cor${o.cor ? " cor-" + o.cor : ""}"></span>${escapar(o.nome)}${marcaRemovida(o)} <strong>${n}</strong>`, `Filtrar ${st.nome}: ${o.nome}`));
    });
  }
  const aud = colAtiva(ID_AUDITORIA);
  if (aud) {
    partes.push('<span class="sep-resumo" aria-hidden="true"></span>');
    [[AUD_PENDENTE, "Auditoria pendente", "i-relogio"], [AUD_DIVERGENCIA, "Divergências", "i-alerta"], [AUD_NAO_LOCALIZADO, "Não localizados", "i-alerta"]].forEach(([id, nome, icone]) => {
      if (!opcao(aud, id)) return;
      partes.push(botao(`aud:${id}`, `${svg(icone)}${escapar(nome)} <strong>${base.filter((t) => passaEspecial(t, `aud:${id}`)).length}</strong>`, `${aud.nome}: ${opcao(aud, id).nome}`));
    });
  }
  if (colAtiva(ID_TECNICO)) partes.push(botao("semTecnico", `${svg("i-usuario")}Sem técnico <strong>${base.filter((t) => passaEspecial(t, "semTecnico")).length}</strong>`, "Equipamentos sem TÉCNICO"));
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
  calcularProblemas();
  estado.linhas = montarLinhas();
  $("#titulo-planilha").textContent = estado.estrutura.titulo;
  renderizarCiclo();
  renderizarResumo();
  renderizarAbas();
  renderizarVisoes();
  const agrupaveis = colunasAtivas().filter((c) => [...TIPOS_LISTA, "pessoa", "booleano"].includes(c.tipo) || (c.tipo === "automatico" && /Por$/.test(c.auto)));
  $("#agrupar").innerHTML = `<option value="">Sem agrupar</option>${agrupaveis.map((c) => `<option value="${escapar(c.id)}"${estado.vista.agrupar === c.id ? " selected" : ""}>Agrupar por ${escapar(c.nome)}</option>`).join("")}`;
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
  const cols = estado.vista.colunas.filter((c) => COL[c]);
  let planilha = $("#planilha");
  const valoresNova = lerLinhaNova();
  if (!planilha) {
    areaDados.innerHTML = `<div class="planilha" id="planilha" role="grid" aria-label="Inventário de equipamentos" tabindex="0">
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
    return `<div class="cab-celula${i === 0 ? " fixa" : ""}" role="columnheader" aria-sort="${sort}" data-col="${escapar(c)}" ${i === 0 ? "" : 'draggable="true"'} title="${escapar([col.ajuda || col.nome, textoTrava(col)].filter(Boolean).join(" · "))}">
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
  if (pl.grupo) return `Nenhum ${pl.tipo === "sw" ? "software" : "hardware"} cadastrado em ${GRUPOS_INVENTARIO[pl.grupo]}.${podeAlimentar() ? ` Use “${t.novo}”, a linha no fim da planilha ou Importações.` : ""}`;
  return podeAlimentar() ? "Nenhum equipamento ainda. Use “Novo equipamento” ou a linha no fim da planilha." : "Nenhum equipamento ainda.";
}
function htmlAcoes(t) {
  return `<button type="button" class="acao-linha" data-acao="ficha" title="Ver ficha completa" aria-label="Ver ficha do ${escapar(termo().um)} ${escapar(t.numero || alvoRegistro(t))}">${svg("i-olho")}</button>
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
  const probs = problemasPorId.get(t.id);
  const textoProbs = probs ? `Atenção: ${probs.join(" · ")}` : "";
  return `<div class="linha${i % 2 ? " par" : ""}${piscando(t.id) ? " piscou" : ""}${sel ? " selecionada" : ""}${t.exclusao ? " pedido-exclusao" : ""}${probs ? " com-problema" : ""}${ap.l}" style="top:${i * h}px" role="row" aria-rowindex="${i + 2}" data-i="${i}" data-chave="${escapar(t.id)}" data-id="${escapar(t.id)}">` +
      cols.map((c, j) => {
        const col = COL[c];
        const travada = !editavel || !podeEditarColuna(col);
        const extra = j === 0 ? `${estado.selecionando ? `<input type="checkbox" class="sel-linha" data-sel="${escapar(t.id)}"${sel ? " checked" : ""} aria-label="Selecionar linha">` : ""}${t.exclusao ? '<span class="selo-exclusao" title="Exclusão solicitada">Exclusão solicitada</span>' : ""}${probs ? `<span class="selo-problema" title="${escapar(textoProbs)}" aria-label="${escapar(textoProbs)}">!</span>` : ""}` : "";
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
  /* Seletor de mês (AAAA-MM); validarValor() converte para MM/AAAA */
  if (col.tipo === "mesAno") return `<input type="month" ${atributos} value="${escapar(mesAnoParaIso(valor))}" min="2000-01" max="2099-12" placeholder="MM/AAAA">`;
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
  caixa.hidden = !podeAlimentar();
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
$("#btn-novo").innerHTML = svg("i-mais") + "Novo equipamento";
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
const nomeArquivoExportacao = (ext) => { const p = partesBrasilia(); return `inventario-${planilhaAtual().chave || planilhaAtual().id}-${p.ano}-${p.mes}-${p.dia}.${ext}`; };
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
  if (/permission-denied/.test(codigo)) return contexto === "numero" ? "Não foi possível salvar: esse HOSTNAME ou DNA já está em outro equipamento, ou você não tem permissão." : "Você não tem permissão para esta mudança.";
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
/* Monta as escritas de uma mudança de campos (com os índices de HOSTNAME e DNA e o histórico) */
function opsAlteracao(t, mudancas, acao = "editar") {
  if (t.arquivo) return opsTirarDoArquivo(t, mudancas, acao);
  const indices = indicesMudanca(t.id, t.campos, { ...(t.campos || {}), ...mudancas });
  const dados = { campos: { ...mudancas }, ...indices.dados, ...assinatura() };
  const ops = [{ op: "set", caminho: `${P()}/${t.id}`, mesclar: true, dados }, ...indices.ops];
  Object.entries(mudancas).forEach(([c, v]) => {
    const col = COL[c];
    if (!col) return;
    ops.push(opHistorico(t.id, acao, { coluna: c, colunaNome: col.nome, antes: textoDoValor(col, (t.campos || {})[c]), depois: textoDoValor(col, v) }));
  });
  return ops;
}
/* Linha do arquivo editada: cria equipamentos/{mesmo id} com "parcial: true" e SÓ os campos alterados, que valem por cima
   da linha do arquivo (vazio é gravado como ""). Assim ninguém regrava as colunas que não pode alterar. */
function opsTirarDoArquivo(t, mudancas, acao) {
  const campos = Object.fromEntries(Object.entries(mudancas).map(([c, v]) => [c, v == null ? "" : v]));
  /* Só a administradora muda HOSTNAME/DNA de uma linha do arquivo: aí o índice muda junto */
  const indices = indicesMudanca(t.id, t.campos, { ...(t.campos || {}), ...campos });
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
  return [campos[idChave()], campos[ID_DNA] ? `DNA ${campos[ID_DNA]}` : "", campos.usuario].filter(Boolean).join(" · ");
}
/* Escritas de um equipamento novo: registro (com as chaves dos índices), índices de HOSTNAME e DNA e histórico */
function opsNovoRegistro(id, campos, acao = "criar") {
  const indices = indicesMudanca(id, {}, campos);
  const chaves = Object.fromEntries(INDICES.map((ix) => [ix.campo, indices.dados[ix.campo] || ""]));
  return [
    { op: "set", caminho: `${P()}/${id}`, dados: { campos, ...chaves, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura(), exclusao: null } },
    ...indices.ops,
    opHistorico(id, acao, { depois: resumoRegistro(campos) })
  ];
}
/* Escritas de um registro novo (linha nova, formulário e preenchimento em massa usam o mesmo caminho) */
function opsCriarRegistro(camposBrutos) {
  const campos = filtrarCamposPermitidos(camposBrutos);
  const id = estado.api.novoId(P());
  return { id, campos, ops: opsNovoRegistro(id, campos) };
}
async function criarRegistro(camposBrutos, { semDesfazer = false } = {}) {
  const { id, campos, ops } = opsCriarRegistro(camposBrutos);
  const ok = await gravar(ops, {
    rotulo: "Equipamento removido",
    contexto: "numero",
    desfazer: semDesfazer || !ehAdmin() ? null : async () => excluirDeVez([{ id, campos, numero: chaveNumero(campos[idChave()] || ""), dna: chaveNumero(campos[ID_DNA] || "") }], "Desfez a criação")
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
    if (intactos.length) await excluirDeVez(intactos.map((t) => ({ id: t.id, campos: t.campos, numero: chaveNumero((t.campos || {})[idChave()] || ""), dna: chaveNumero((t.campos || {})[ID_DNA] || "") })), "Desfez o preenchimento em massa");
    if (intactos.length < ids.length) mostrarAviso(`${ids.length - intactos.length} registro(s) foram alterados depois e ficaram.`, 5000);
  };
}
/* Monta o registro completo: valores informados + padrões + ÁREA da aba atual */
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
    erro = el ? e : `${e} Use “Novo equipamento” para preencher todas as colunas.`;
  }
  if (erro) { mostrarAviso(erro, 5000); return; }
  const id = await criarRegistro(completos);
  if (!id) return;
  campos.forEach((el) => { el.value = ""; });
  $$("#planilha .linha-nova .combo-texto").forEach((el) => { el.value = ""; });
  estado.piscar.set(id, Date.now() + 3500);
  mostrarAviso("Equipamento adicionado. A linha nova está pronta para o próximo.");
  focarLinhaNova();
}

/* ------------------------------------------------------------
 *  Novo equipamento (formulário completo, com rascunho no navegador)
 * ------------------------------------------------------------ */
/* Ordem do FORMULÁRIO (Novo equipamento e ficha), independente da grade: "ordemFormulario" da coluna.
   Sem ela, vale a ordem da grade, com os textos longos sempre no fim. */
function ordenarParaFormulario(naOrdemDaGrade) {
  const pos = new Map(naOrdemDaGrade.map((c, i) => [c.id, i]));
  const chave = (c) => (c.ordemFormulario > 0 ? c.ordemFormulario : 1000 + (c.tipo === "textoLongo" ? 1000 : 0) + pos.get(c.id));
  return [...naOrdemDaGrade].sort((a, b) => chave(a) - chave(b));
}
const colunasDoFormulario = (filtro) => ordenarParaFormulario(colunasAtivas().filter(filtro));
/* Ordem padrão do formulário do Inventário (botão "Restaurar padrão" em Estrutura › Ordem no formulário) */
const ORDEM_FORMULARIO_PADRAO = [ID_HOSTNAME, ID_DNA, "ar", "usuario", ID_AREA, ID_GESTOR, ID_STATUS, ID_AUDITORIA, ID_TECNICO, "dataFeita", "observacao"];
function ordemFormularioPadrao(naOrdemDaGrade) {
  const fixas = ORDEM_FORMULARIO_PADRAO.map((id) => naOrdemDaGrade.find((c) => c.id === id)).filter(Boolean);
  const resto = naOrdemDaGrade.filter((c) => !fixas.includes(c));
  const longos = (c) => c.tipo === "textoLongo";
  const ordem = [...fixas.filter((c) => !longos(c)), ...resto.filter((c) => !longos(c)), ...fixas.filter(longos), ...resto.filter(longos)];
  return ordem;
}
const EXEMPLOS_FORMULARIO = { [ID_HOSTNAME]: "Ex.: BRNCSP-7BC0LQ3", [ID_DNA]: "Ex.: 76217705-474A-…" };
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
    + (c.id === ID_HOSTNAME ? " data-maiusculas" : "");
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
/* Comportamentos dos campos do formulário (diálogo e ficha): HOSTNAME em maiúsculas, observação que cresce, botão "Agora" */
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
const CHAVE_LGPD_NOVO = "inventario-lgpd-novo-entendido-ate";
/* Lembrados por pessoa para o próximo cadastro; "Registrar e adicionar outro" limpa só os do equipamento */
const COLUNAS_SUGERIDAS = [ID_AREA, ID_GESTOR, ID_TECNICO, "ar"];
const COLUNAS_DO_EQUIPAMENTO = [ID_HOSTNAME, ID_DNA, "usuario", "observacao"];
function sugestoesNovo() {
  const salvas = lerLocal(chaveUsuario("sugestoes-novo"), null);
  const valido = (c, v) => COL[c] && !estaVazio(v) && (!TIPOS_LISTA.includes(COL[c].tipo) || (opcao(COL[c], v) && opcao(COL[c], v).ativa !== false));
  if (salvas && typeof salvas === "object") return Object.fromEntries(COLUNAS_SUGERIDAS.filter((c) => valido(c, salvas[c])).map((c) => [c, salvas[c]]));
  /* Primeira vez: a própria pessoa como TÉCNICO, se o nome dela estiver na lista */
  const tec = COL[ID_TECNICO] && estado.usuario ? opcoesAtivas(COL[ID_TECNICO]).find((o) => nomeComparavel(o.nome) === nomeComparavel(estado.usuario.nome || "")) : null;
  return tec ? { [ID_TECNICO]: tec.id } : {};
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
    titulo: planilhaAtual().grupo ? `${termo().novo} · ${nomeCompletoPlanilha(planilhaAtual())}` : "Novo equipamento",
    largo: true,
    corpo: `${lgpd ? `<p class="lgpd lgpd-curta" data-lgpd-novo><span><strong>LGPD:</strong> não registre CPF, RG, endereço, telefone pessoal nem dados de saúde.</span><button type="button" class="btn-link" data-lgpd-entendi>Entendi</button></p>` : ""}
      ${rascunho ? `<p class="apoio rascunho-recuperado">Rascunho recuperado deste navegador (${escapar(formatarData(rascunho.em, true))}). <button type="button" class="btn-link" data-limpar-rascunho>Começar do zero</button></p>` : ""}
      <div class="form-registro">${htmlCamposFormulario(valores, podeNaLinhaNova)}</div>
      <p class="form-erro" role="alert" id="novo-erro"></p>
      <div class="form-botoes rodape-fixo">
        <span class="rodape-info"><span id="novo-contador" aria-live="polite"></span>${Object.keys(sugestoes).length ? `<button type="button" class="btn-link" data-limpar-sugestoes title="Área, gestor, técnico e AR vêm do seu último cadastro">Limpar sugestões</button>` : ""}</span>
        <button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
        <button type="button" class="btn btn-secundario" data-registrar-outro title="Registrar e adicionar outro (Ctrl+Shift+Enter): mantém área, gestor, status, auditoria, técnico, data e AR">${svg("i-mais")}Registrar e adicionar outro</button>
        <button type="submit" class="btn" title="Registrar (Ctrl+Enter)">${svg("i-salvar")}Registrar</button></div>`
  });
  d.classList.add("dialogo-novo");
  const form = d.querySelector("form");
  ligarCamposFormulario(form);
  let tempo = 0, registrados = 0, salvando = false;
  const guardar = () => { clearTimeout(tempo); tempo = setTimeout(() => gravarLocal(chaveRascunho, { em: new Date().toISOString(), valores: lerFormulario(form, cols).valores }), 300); };
  /* HOSTNAME e DNA repetidos: aviso compacto logo abaixo do campo, com "Abrir" */
  const conferirNumero = () => INDICES.forEach((ix) => {
    const caixa = $(`[data-aviso-de="${CSS.escape(ix.col)}"]`, form);
    const el = form.elements[ix.col];
    if (!caixa) return;
    const e = el && el.value.trim() && COL[ix.col] ? conferirRegistro({ [ix.col]: chaveNumero(el.value) })[ix.col] : null;
    caixa.innerHTML = e && typeof e === "object" ? `<div class="aviso-repetido">${svg("i-alerta")}<span>Já usado por ${escapar(colNumero() && porId(e.id) ? valorTexto(porId(e.id), colNumero()) || "outro equipamento" : "outro equipamento")}</span><button type="button" class="btn-link" data-abrir-existente="${escapar(e.id)}" title="${escapar(e.texto)}">Abrir</button></div>` : "";
  });
  const limparCampo = (c) => {
    const el = form.elements[c];
    if (!el) return;
    if (el.type === "hidden" && el.closest(".combo")) { el.value = ""; el.dataset.original = ""; el.closest(".combo").querySelector(".combo-texto").value = ""; return; }
    el.value = "";
    if (el.matches("textarea[data-crescer]")) crescerTexto(el);
  };
  const contar = () => { $("#novo-contador", d).textContent = registrados ? `${registrados} equipamento${registrados === 1 ? "" : "s"} registrado${registrados === 1 ? "" : "s"} nesta janela` : ""; };
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
    if (!continuar) { d.close(); mostrarAviso(registrados > 1 ? `${registrados} equipamentos adicionados.` : "Equipamento adicionado."); setTimeout(() => irPara(id), 400); return; }
    COLUNAS_DO_EQUIPAMENTO.forEach(limparCampo);
    marcarErros(form, {});
    conferirNumero();
    contar();
    mostrarAviso("Equipamento adicionado. Pode registrar o próximo.", 2500);
    const h = form.elements[ID_HOSTNAME];
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
  const primeiro = form.elements[ID_HOSTNAME] || form.querySelector("input:not([type=checkbox]):not([type=hidden]), select, textarea");
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
  const sinonimos = {
    hostname: ["hostname", "host name", "host", "nome da maquina", "nome do computador", "maquina", "computador", "equipamento"],
    dna: ["dna", "id dna", "codigo dna"], usuario: ["nome do usuario", "usuario", "colaborador", "funcionario"], area: ["area", "setor", "departamento"],
    gestor: ["gestor", "lider", "coordenador"], status: ["status", "situacao do equipamento", "situacao"], auditoria: ["auditoria", "auditado"],
    tecnico: ["tecnico", "responsavel tecnico", "analista"], observacao: ["observacao", "observacoes", "obs"]
  };
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
    corpo: `<p class="lgpd"><strong>LGPD:</strong> NOME DO USUÁRIO e GESTOR são dados pessoais. Deixe como “Ignorar” colunas de CPF, RG, endereço, telefone pessoal ou saúde.</p>
      <div class="campos-linha">
        <label class="campo"><span class="rotulo">Cole aqui as células do Excel (com o cabeçalho)</span><textarea name="colado" rows="6" placeholder="${escapar(cols.slice(0, 3).map((c) => c.nome).join("\t"))}…"></textarea></label>
        <div class="campo"><label class="campo"><span class="rotulo">Ou escolha um arquivo .csv</span><input type="file" name="arquivo" accept=".csv,text/csv,.txt"></label>
          <label class="check" style="margin-top:8px"><input type="checkbox" name="cabecalho" checked> A primeira linha é o cabeçalho</label>
          ${admin ? `<label class="campo" style="margin-top:8px"><span class="rotulo">O que fazer</span><select name="modo">
            <option value="adicionar">Só adicionar linhas novas</option>
            <option value="atualizar">Atualizar pelo ${escapar(colNumero() ? colNumero().nome : "HOSTNAME")} (e adicionar os novos)</option>
            <option value="substituir">Substituir TODOS os equipamentos (faz backup antes)</option></select></label>
            <p class="apoio" style="margin-top:8px;font-size:12px">A gravação vai em lotes. Se o limite diário do plano gratuito acabar, o que falta fica guardado para “Continuar a importação”.</p>`
            : '<p class="apoio" style="margin-top:8px">As linhas coladas sempre entram como equipamentos novos. Nada que já existe é alterado.</p>'}
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
    /* DNA (e outras colunas de valor único) repetido dentro da própria colagem */
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
      const chave = campos[idChave()] ? chaveNumero(campos[idChave()]) : "";
      const existente = chave ? equipamentosComHostname(chave)[0] || null : null;
      const repetidoNoColado = chave && vistos.has(chave);
      if (chave) vistos.add(chave);
      const m = modo();
      const conf = conferirRegistro(campos, existente && m !== "adicionar" ? existente.id : undefined);
      /* HOSTNAME já cadastrado vira "Já existe"/"Atualizar"; DNA de outro equipamento é erro */
      Object.entries(conf).forEach(([c, x]) => { if (typeof x === "string") erros.push(x); else if (c !== idChave()) erros.push(x.texto); });
      vistosUnicos.forEach((set, c) => {
        if (estaVazio(campos[c])) return;
        const k = ehColunaIndice(COL[c]) ? chaveNumero(campos[c]) : normalizar(campos[c]);
        if (set.has(k)) erros.push(`${COL[c].nome} “${campos[c]}” repetido na própria colagem.`);
        set.add(k);
      });
      let situacao = erros.length ? "erro" : "nova";
      if (!erros.length && repetidoNoColado) { situacao = "erro"; erros.push(`${colNumero() ? colNumero().nome : "HOSTNAME"} “${campos[idChave()]}” repetido na própria colagem.`); }
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
    $("#colar-ok", d).textContent = modo() === "substituir" ? `Substituir por ${validas} equipamento(s)` : `Gravar ${validas} linha(s)`;
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
      /* Equipe: cada linha num lote próprio (registro + índices de HOSTNAME e DNA + histórico) */
      for (const l of validas) {
        progresso.textContent = `Gravando ${ok + falhas + 1} de ${validas.length}…`;
        const id = await criarRegistro(l.campos, { semDesfazer: true });
        if (id) { ok++; estado.piscar.set(id, Date.now() + 3500); } else falhas++;
      }
    } else {
      if (m === "substituir") {
        if (!(await confirmarDigitando(`Isso apaga os ${estado.equipamentos.length} equipamentos atuais e grava ${validas.length} no lugar. Um backup é feito antes.`, "SUBSTITUIR", { titulo: "Substituir todos os equipamentos", botao: "Substituir" }))) { botao.disabled = false; return; }
        progresso.textContent = "Fazendo backup…";
        const bk = await criarBackup("Antes de substituir todos os equipamentos pela colagem");
        if (!bk) { botao.disabled = false; return; }
        progresso.textContent = "Apagando os equipamentos atuais…";
        try { await gravarArquivo([], { apagarVivos: estado.vivos }); await apagarTodosIndices(); }
        catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); botao.disabled = false; return; }
      }
      /* Um grupo de escritas por equipamento, gravados em lotes (dá para continuar depois) */
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
      registrarAuditoria("importar", `Importou ${r.feitos} de ${validas.length} linha(s) (${m === "substituir" ? "substituindo tudo" : m === "atualizar" ? "atualizando pelo HOSTNAME" : "só adicionando"})`, r.ok ? "" : `Faltam ${r.faltam}`);
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
  const host = String((t.campos || {})[ID_HOSTNAME] || "");
  const itens = [
    ["ficha", "i-olho", "Ver ficha e histórico"],
    ...(host ? [["host", "i-busca", `Ficha do HOSTNAME ${host}`]] : []),
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
    if (m === "host") abrirFichaHostname(host, planilhaAtual().grupo || "");
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
  const titulo = colNumero() ? valorTexto(t, colNumero()) || "(sem HOSTNAME)" : "Equipamento";
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
      (t.campos || {})[ID_HOSTNAME] ? `<button type="button" class="btn btn-secundario btn-mini" data-ficha="host">${svg("i-busca")}Ficha do HOSTNAME</button>` : "",
      podeEditarLinha(t) ? `<button type="button" class="btn" data-ficha="editar">${svg("i-lapis")}Editar</button>` : ""
    ].join("");
  ficha.innerHTML = `<form class="ficha-corpo" novalidate>
    <div class="form-topo"><h2>${escapar(titulo)}</h2>
      <button type="button" class="perfil-fechar" data-ficha="fechar" aria-label="Fechar ficha">${svg("i-fechar")}</button></div>
    ${exclusao}
    ${!editar && !podeEditarLinha(t) && papel() !== "leitura" ? `<p class="apoio" style="font-size:13px">${svg("i-cadeado", "icone cadeado")} ${escapar(motivoSemEdicao(t))}</p>` : ""}
    ${corpo}
    <div class="form-botoes">${botoes}</div>
    ${editar ? "" : `<section class="ficha-grupo"><h3>Movimentações</h3><ul class="historico linha-tempo" id="ficha-historico"><li>Carregando…</li></ul></section>`}
  </form>`;
  ficha.dataset.id = id;
  ficha.dataset.editando = editar ? "1" : "";
  ficha.hidden = false;
  requestAnimationFrame(() => ficha.classList.add("aberta"));
  if (editar) prepararCamposFormulario(ficha);
  const primeiro = ficha.querySelector(editar ? "input:not([type=hidden]), select, textarea" : "[data-ficha]");
  if (primeiro) primeiro.focus();
  if (pararHistorico) { pararHistorico(); pararHistorico = null; }
  if (!editar && estado.api) {
    pararHistorico = estado.api.ouvirColecao(`${P()}/${id}/historico`, (lista) => {
      const el = $("#ficha-historico");
      if (!el) return;
      /* Linha do tempo de MOVIMENTAÇÕES: troca de usuário, área, gestor, status, técnico e auditoria em destaque */
      el.innerHTML = lista.length ? lista.map((h) => {
        const quem = `<span class="quem" title="${escapar(h.porEmail || (String(h.por || "").includes("@") ? h.por : ""))}">${escapar(h.porNome || nomePessoa(h.por))}</span>`;
        const movimentacao = COLUNAS_MOVIMENTACAO.includes(h.coluna);
        let oque;
        if (h.acao === "criar") oque = `cadastrou o equipamento${h.depois ? `: ${escapar(h.depois)}` : ""}`;
        else if (h.acao === "importar" && !h.coluna) oque = `importou o equipamento${h.depois ? `: ${escapar(h.depois)}` : ""}`;
        else if (h.acao === "pedirExclusao") oque = `solicitou a exclusão: ${escapar(h.depois)}`;
        else if (h.acao === "recusarExclusao") oque = "recusou o pedido de exclusão";
        else if (h.acao === "restaurar") oque = "restaurou o equipamento";
        else if (movimentacao) oque = `<strong>${escapar(h.colunaNome || h.coluna)}</strong>: <span class="de">${escapar(h.antes || "(vazio)")}</span> → <span class="para">${escapar(h.depois || "(vazio)")}</span>${h.acao === "iniciarAuditoria" ? " (nova auditoria)" : ""}`;
        else oque = `mudou <strong>${escapar(h.colunaNome || h.coluna)}</strong>: ${escapar(h.antes || "(vazio)")} → ${escapar(h.depois || "(vazio)")}`;
        if (h.acao === "substituirValor") oque += " (substituição de valor)";
        return `<li class="${movimentacao ? "movimentacao" : ""}"><span class="quando">${escapar(formatarData(h.em, true))}</span>${quem} ${oque}</li>`;
      }).join("") : "<li>Sem movimentações registradas.</li>";
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
  if (a === "host") abrirFichaHostname(String((t.campos || {})[ID_HOSTNAME] || ""), planilhaAtual().grupo || "");
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
  const soltas = marcarErros(form, erros);
  if (Object.keys(erros).length) { $("#ficha-erro").textContent = soltas.join(" · "); focarPrimeiroErro(form); return; }
  if (await salvarCampos(t, valores)) { mostrarAviso(planilhaAtual().tipo === "sw" ? "Software salvo." : "Equipamento salvo."); setTimeout(() => abrirFicha(t.id, false), 150); }
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
 *  Registro de ações (inventario-auditoria: só administradoras leem)
 * ------------------------------------------------------------ */
/* Colunas cuja troca aparece em destaque na linha do tempo da ficha (MOVIMENTAÇÕES) */
const COLUNAS_MOVIMENTACAO = ["usuario", ID_AREA, ID_GESTOR, ID_STATUS, ID_TECNICO, ID_AUDITORIA];
/* Trilha (inventario-auditoria, só inclusão): administradora assina com o e-mail; a equipe e a leitura com o uid
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
    planilha: txt(planilha, 40), alvo: txt(alvo, 120),
    mudancas: (mudancas || []).slice(0, 60).map((m) => ({ coluna: txt(m.coluna, 60), antes: txt(m.antes, 300), depois: txt(m.depois, 300) })),
    em: "__AGORA__"
  }).catch((e) => console.warn("Auditoria:", e));
}
/* Como o registro aparece na trilha: HOSTNAME, aplicação, versão… */
function alvoRegistro(t, campos = (t && t.campos) || {}) {
  const pl = planilhaAtual();
  if (pl.tipo === "sw") return [campos[ID_HOSTNAME], campos[ID_APLICACAO], campos[ID_VERSAO], campos[ID_MES_ANO]].filter(Boolean).join(" · ") || (t && t.id) || "";
  if (pl.tipo === "hw") return [campos[ID_HOSTNAME], campos[ID_SERIE] ? `série ${campos[ID_SERIE]}` : ""].filter(Boolean).join(" · ") || (t && t.id) || "";
  return [campos[ID_HOSTNAME], campos[ID_DNA] ? `DNA ${campos[ID_DNA]}` : ""].filter(Boolean).join(" · ") || (t && (t.numero || t.id)) || "";
}

/* Registro pronto para gravar de novo (datas de controle viram "__DATA__:<ISO>") */
const marcaData = (iso) => (iso ? "__DATA__:" + iso : "__AGORA__");
function serializar(t) {
  return {
    campos: t.campos || {}, numero: t.numero || "", dna: t.dna || "",
    criadoPor: t.criadoPor || "", criadoEm: marcaData(t.criadoEm),
    atualizadoPor: t.atualizadoPor || "", atualizadoEm: marcaData(t.atualizadoEm),
    ...(t.criadoPorNome ? { criadoPorNome: t.criadoPorNome, criadoPorEmail: t.criadoPorEmail || "" } : {}),
    ...(t.atualizadoPorNome ? { atualizadoPorNome: t.atualizadoPorNome, atualizadoPorEmail: t.atualizadoPorEmail || "" } : {}),
    exclusao: t.exclusao ? { motivo: t.exclusao.motivo || "", por: t.exclusao.por || "", ...(t.exclusao.porNome ? { porNome: t.exclusao.porNome, porEmail: t.exclusao.porEmail || "" } : {}), em: marcaData(t.exclusao.em) } : null
  };
}

/* ------------------------------------------------------------
 *  Arquivo compactado (inventario-arquivo): centenas de linhas por documento
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
    return { ...normalizarEquipamento({ ...autoria, id: String(l[0]), campos, numero: String(l[1] || ""), dna: campos[ID_DNA] ? chaveNumero(campos[ID_DNA]) : "", exclusao: null }), arquivo: true };
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
  return { ...v, ...original, campos: { ...(base.campos || {}), ...(v.campos || {}) }, numero: v.numero || base.numero, dna: v.dna || base.dna, parcial: true };
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
   Os índices de HOSTNAME e DNA continuam valendo (os equipamentos compactados seguem únicos no servidor). */
async function gravarArquivo(lista, { apagarVivos = [] } = {}) {
  const versao = Date.now();
  const grupos = dividirArquivo(lista);
  const antigos = [...estado.arquivo.docs];
  await estado.api.lote(grupos.map((g, i) => ({ op: "set", caminho: `${P()}-arquivo/v${versao}-${String(i).padStart(3, "0")}`, dados: dadosParte(versao, i, grupos.length, jsonParte(g)) })));
  const limpeza = antigos.map((id) => ({ op: "delete", caminho: `${P()}-arquivo/${id}` }));
  apagarVivos.forEach((t) => { limpeza.push({ op: "delete", caminho: `${P()}/${t.id}` }); });
  if (limpeza.length) await estado.api.lote(limpeza);
  return grupos.length;
}
/* Substituir tudo ou restaurar um backup: os índices são refeitos do zero (só administradoras) */
async function apagarTodosIndices() {
  for (const ix of INDICES) {
    const docs = await estado.api.lerColecao(`${P()}-${ix.colecao}`);
    if (docs.length) await estado.api.lote(docs.map((d) => ({ op: "delete", caminho: `${P()}-${ix.colecao}/${d.id}` })));
  }
}
async function recriarIndices(lista) {
  const ops = [];
  INDICES.forEach((ix) => {
    const usados = new Set();
    lista.forEach((t) => {
      const k = chaveIndice(ix, t.campos);
      if (!k || usados.has(k)) return;
      usados.add(k);
      ops.push({ op: "set", caminho: `${P()}-${ix.colecao}/${k}`, dados: { equipamento: t.id } });
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
function equipamentoDeRegistro(r) {
  const d = r.dados || {};
  const data = (v) => (typeof v === "string" && v.startsWith("__DATA__:") ? v.slice(9) : "");
  return normalizarEquipamento({ ...d, id: r.id, criadoEm: data(d.criadoEm), atualizadoEm: data(d.atualizadoEm), exclusao: null });
}
/* No backup, as linhas do arquivo vão sem os campos de autoria vazios */
function registroBackup(t) {
  if (!t.arquivo) return serializar(t);
  const r = { campos: t.campos || {}, numero: t.numero || "", dna: t.dna || "" };
  CAMPOS_AUTORIA.forEach((k) => { if (t[k]) r[k] = /Em$/.test(k) ? marcaData(t[k]) : t[k]; });
  return r;
}
async function compactarArquivo() {
  const vivos = estado.vivos.filter((t) => !t.exclusao);
  if (!vivos.length) { mostrarAviso("Todos os equipamentos já estão no arquivo compactado."); return; }
  if (!(await confirmar(`Guardar ${vivos.length} equipamento(s) no arquivo compactado? Os dados e o histórico não mudam; abrir a planilha passa a gastar menos leituras do Firebase. Prefira um horário em que ninguém esteja editando. Linhas com pedido de exclusão ficam de fora.`, { titulo: "Compactar registros", botao: "Compactar" }))) return;
  mostrarAviso("Compactando…", 60000);
  try {
    const lista = estado.equipamentos.filter((t) => !t.exclusao);
    const n = await gravarArquivo(lista, { apagarVivos: vivos });
    registrarAuditoria("compactar", `Guardou ${vivos.length} equipamento(s) no arquivo compactado`, `${lista.length} linha(s) em ${n} documento(s)`);
    mostrarAviso(`${vivos.length} equipamento(s) guardados no arquivo compactado.`, 5000);
  } catch (e) { console.error(e); mostrarAviso("Não foi possível compactar. Nada se perdeu: os equipamentos continuam onde estavam.", 8000); }
}

/* ------------------------------------------------------------
 *  Lixeira, exclusão definitiva e backups (só administradoras)
 * ------------------------------------------------------------ */
async function excluirParaLixeira(lista, motivo = "") {
  if (!ehAdmin() || !lista.length) return false;
  const varias = lista.length > 1;
  if (varias) {
    if (!(await confirmarDigitando(`Mover ${lista.length} equipamentos para a Lixeira? Um backup é feito antes.`, `EXCLUIR ${lista.length}`, { titulo: "Excluir em massa", botao: "Excluir" }))) return false;
    if (!(await criarBackup(`Antes de excluir ${lista.length} equipamentos`))) return false;
  } else if (!(await confirmar(`Mover o equipamento ${(lista[0].campos || {})[idChave()] || ""} para a Lixeira? Dá para restaurar depois.`, { titulo: "Excluir equipamento", botao: "Excluir", perigo: true }))) return false;
  const ops = [];
  lista.forEach((t) => {
    ops.push({ op: "set", caminho: `${COL_LIXEIRA}/${t.id}`, dados: { dados: serializar(t), excluidoPor: estado.usuario.email, excluidoEm: "__AGORA__", motivo: String(motivo).slice(0, 300), planilha: planilhaAtual().id } });
    /* HOSTNAME e DNA ficam livres para outro equipamento (voltam se o equipamento for restaurado) */
    ops.push(...opsApagarIndices(t));
    if (t.arquivo) return;
    ops.push({ op: "delete", caminho: `${P()}/${t.id}` });
  });
  const ids = lista.map((t) => t.id);
  const ok = await gravar(ops, { rotulo: "Registros restaurados da Lixeira", desfazer: async () => restaurarDaLixeira(ids, { silencioso: true }) });
  if (ok) {
    try { await alterarArquivo(new Map(lista.filter((t) => noArquivo(t.id)).map((t) => [t.id, null]))); }
    catch (e) { console.error(e); mostrarAviso("Os registros foram para a Lixeira, mas não saíram do arquivo compactado. Tente excluir de novo.", 8000); return false; }
    registrarAuditoria("excluir", `Moveu ${lista.length} equipamento(s) para a Lixeira`, [motivo, lista.map((t) => t.numero || t.id).join(", ")].filter(Boolean).join(" · "));
    estado.selecionados.clear();
    if (lista.some((t) => t.id === ficha.dataset.id)) fecharFicha();
    mostrarAviso(`${lista.length} equipamento(s) na Lixeira. Use Desfazer se foi sem querer.`, 5000);
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
    if (!semAuditoria) registrarAuditoria("excluirDeVez", `Excluiu de vez ${lista.length} equipamento(s)`, motivo);
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}
async function restaurarDaLixeira(ids, { silencioso = false } = {}) {
  const itens = ids.map((id) => estado.lixeira.find((x) => x.id === id)).filter(Boolean);
  if (!itens.length) {
    for (const id of ids) { const doc = await estado.api.lerDoc(`${COL_LIXEIRA}/${id}`); if (doc) itens.push({ id, ...doc }); }
  }
  if (!itens.length) return false;
  /* HOSTNAME e DNA voltam para o índice, a não ser que outro equipamento já use o valor */
  const usados = Object.fromEntries(INDICES.map((ix) => [ix.campo, new Set(estado.equipamentos.map((t) => chaveIndice(ix, t.campos)).filter(Boolean))]));
  const ops = [];
  let conflitos = 0;
  itens.forEach((x) => {
    const dados = serializar({ ...x.dados });
    INDICES.forEach((ix) => {
      const k = chaveIndice(ix, dados.campos);
      if (k && usados[ix.campo].has(k)) { dados[ix.campo] = ""; conflitos++; return; }
      dados[ix.campo] = k;
      if (k) { usados[ix.campo].add(k); ops.push({ op: "set", caminho: `${P()}-${ix.colecao}/${k}`, dados: { equipamento: x.id } }); }
    });
    dados.exclusao = null;
    ops.push({ op: "set", caminho: `${P()}/${x.id}`, dados });
    ops.push({ op: "delete", caminho: `${COL_LIXEIRA}/${x.id}` });
    ops.push(opHistorico(x.id, "restaurar"));
  });
  try {
    await estado.api.lote(ops);
    registrarAuditoria("restaurar", `Restaurou ${itens.length} equipamento(s) da Lixeira`, itens.map((x) => (x.dados && x.dados.numero) || x.id).join(", "));
    if (!silencioso || conflitos) mostrarAviso(`${itens.length} equipamento(s) restaurado(s).${conflitos ? ` ${conflitos} valor(es) de HOSTNAME/DNA já estão em outro equipamento: confira as linhas restauradas.` : ""}`, 6000);
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
  await estado.api.salvarDoc(caminhoEstrutura(), dadosEstrutura(est));
  const partes = await gravarArquivo(validos.filter((r) => !r.dados.exclusao).map(equipamentoDeRegistro), { apagarVivos: estado.vivos.filter((t) => !manter.has(t.id)) });
  if (vivos.length) await estado.api.lote(vivos.map((r) => ({ op: "set", caminho: `${P()}/${r.id}`, dados: r.dados })));
  /* Índices de HOSTNAME e DNA refeitos para os equipamentos do backup */
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
    if (!dados || !Array.isArray(dados.registros) || !dados.estrutura) { mostrarAviso("O arquivo não tem estrutura e equipamentos de um backup do Inventário."); return; }
    const est = normalizarEstrutura(dados.estrutura);
    if (!est || !est.colunas.length) { mostrarAviso("O arquivo não tem uma estrutura válida."); return; }
    const texto = `Carregar “${f.name}”: ${dados.registros.length.toLocaleString("pt-BR")} equipamento(s) e ${est.colunas.filter((c) => c.ativa).length} coluna(s)${dados.motivo ? ` (${String(dados.motivo).slice(0, 200)})` : ""}. A estrutura e os ${estado.equipamentos.length.toLocaleString("pt-BR")} equipamento(s) atuais são substituídos; antes, é feito um backup.${dados.estrutura.regras ? "" : " As regras da equipe continuam as atuais."}`;
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
    baixarArquivo(`inventario-backup-${p.ano}-${p.mes}-${p.dia}-${p.hora}${p.minuto}.json`,
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
    $("#lista-backups", d).innerHTML = lista.length ? `<table><thead><tr><th>Quando</th><th>Motivo</th><th>Por</th><th>Equipamentos</th><th></th></tr></thead><tbody>${lista.map((b) => `<tr>
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
  const d = criarDialogo({ titulo: "Lixeira", largo: true, corpo: `<p class="apoio">Equipamentos excluídos. Restaurar devolve a linha à planilha; excluir de vez não tem volta.</p><div class="tabela-admin" id="lista-lixeira"></div>` });
  const perfil = !!planilhaAtual().tipo;
  const numeroDe = (x) => (perfil ? alvoRegistro(null, (x.dados || {}).campos || {}) : (x.dados && ((x.dados.campos && x.dados.campos[idChave()]) || x.dados.numero))) || x.id;
  const desenhar = () => {
    const lista = [...estado.lixeira].sort((a, b) => String(b.excluidoEm).localeCompare(String(a.excluidoEm)));
    $("#lista-lixeira", d).innerHTML = lista.length ? `<table><thead><tr><th>${perfil ? "Registro" : "HOSTNAME"}</th><th>${perfil ? "" : "DNA · usuário"}</th><th>Excluído em</th><th>Por</th><th>Motivo</th><th></th></tr></thead><tbody>${lista.map((x) => `<tr>
      <td>${escapar(numeroDe(x))}</td><td>${perfil ? "" : escapar([((x.dados || {}).campos || {})[ID_DNA], ((x.dados || {}).campos || {}).usuario].filter(Boolean).join(" · "))}</td><td>${escapar(formatarData(x.excluidoEm, true))}</td><td>${escapar(nomePessoa(x.excluidoPor))}</td><td>${escapar(x.motivo || "")}</td>
      <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-lx="restaurar" data-id="${escapar(x.id)}">${svg("i-restaurar")}Restaurar</button>
        <button type="button" class="btn btn-perigo btn-mini" data-lx="apagar" data-id="${escapar(x.id)}">Excluir de vez</button></td></tr>`).join("")}</tbody></table>` : `<p class="apoio" style="padding:12px">A Lixeira está vazia.</p>`;
  };
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-lx]");
    if (!b) return;
    const x = estado.lixeira.find((y) => y.id === b.dataset.id);
    if (!x) return;
    if (b.dataset.lx === "restaurar") { if (await restaurarDaLixeira([x.id])) desenhar(); }
    if (b.dataset.lx === "apagar" && await confirmarDigitando(`Excluir de vez o equipamento ${numeroDe(x)}? Não tem volta.`, String(numeroDe(x)), { titulo: "Excluir de vez", botao: "Excluir de vez" })) {
      try { await estado.api.lote([{ op: "delete", caminho: `${COL_LIXEIRA}/${x.id}` }]); registrarAuditoria("excluirDeVez", `Excluiu de vez da Lixeira o equipamento ${numeroDe(x)}`); }
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
 *  Tudo vai para a auditoria do Inventário.
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
const opcoesPapel = (atual) => `<option value="equipe"${atual === "equipe" ? " selected" : ""}>Equipe</option><option value="leitura"${atual === "leitura" ? " selected" : ""}>Leitura</option>`;
async function salvarIdentidade(i, dados, texto, caixaErro) {
  if (caixaErro) caixaErro.textContent = "";
  try {
    await estado.api.salvarDoc(`inventario-identidades/${i.id}`, { ...dados, atualizadoEm: "__AGORA__" }, true);
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
  const d = criarDialogo({
    titulo: "Pessoas",
    largo: true,
    corpo: `<p class="lgpd"><strong>Atenção:</strong> ${escapar(AVISO_SEM_SENHA)}</p>
      <p class="apoio">Lays e Paula são administradoras fixas e entram com senha. Antes de liberar um cadastro novo, confirme com a pessoa (por exemplo, pelo Teams) que foi ela mesma.</p>
      <div class="barra">
        <label class="busca"><span class="sr-only">Buscar pessoa</span>${svg("i-busca")}<input type="search" name="buscaPessoa" placeholder="Buscar por nome ou e-mail…" autocomplete="off"></label>
        <label class="sr-only" for="filtro-pessoas">Filtrar</label>
        <select id="filtro-pessoas" name="filtroPessoa"><option value="">Todas</option><option value="aguardando">Aguardando liberação</option><option value="ativa">Ativas</option><option value="bloqueada">Bloqueadas</option><option value="equipe">Equipe</option><option value="leitura">Leitura</option></select>
        <span class="contagem" id="contagem-pessoas" aria-live="polite"></span>
      </div>
      <div class="tabela-admin" id="lista-pessoas"></div>
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
        || `<tr><td colspan="8" class="apoio">${estado.identidades.length ? "Ninguém com esses filtros." : "Nenhum cadastro ainda."}</td></tr>`}
      </tbody></table>`;
  };
  form.buscaPessoa.addEventListener("input", desenhar);
  form.filtroPessoa.addEventListener("change", desenhar);
  const identidadeDaLinha = (el) => { const tr = el.closest("[data-identidade]"); return tr ? estado.identidades.find((x) => x.id === tr.dataset.identidade) : null; };
  d.addEventListener("change", (e) => {
    if (!e.target.matches("[data-papel]")) return;
    const papelNovo = e.target.value === "leitura" ? "leitura" : "equipe";
    const i = identidadeDaLinha(e.target);
    if (i) salvarIdentidade(i, { papel: papelNovo }, papelNovo === "leitura" ? "Mudou para Leitura" : "Mudou para Equipe", erro()).then((ok) => { if (!ok) desenhar(); });
  });
  d.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const i = identidadeDaLinha(b);
    if (!i) return;
    if (b.matches("[data-aparelhos]")) abrirAparelhos(i);
    if (b.matches("[data-corrigir-nome]")) corrigirNome(i);
    if (b.matches("[data-liberar]")) salvarIdentidade(i, { ativo: true, aprovado: true }, "Liberou o acesso", erro());
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
const AVISO_LGPD_COLUNAS = "LGPD: NOME DO USUÁRIO e GESTOR já são dados pessoais. Não crie colunas de CPF, RG, telefone pessoal, endereço ou dados de saúde.";
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
      <div class="abas-dialogo" role="tablist">${[["colunas", "Colunas"], ["formulario", "Ordem no formulário"], ["grupos", "Grupos de colunas"], ["regras", "Título e regras da equipe"]].map(([id, nome]) => `<button type="button" role="tab" data-aba-est="${id}">${nome}</button>`).join("")}</div>
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
            ${ehColunaFixa(planilhaAtual(), c.id) ? `<span class="selo" title="Coluna fixa de toda planilha de Software: não se remove nem se renomeia">${svg("i-cadeado")}Fixa</span>` : `<button type="button" class="btn btn-secundario btn-mini" data-est="arquivar-coluna">${svg("i-arquivo")}${c.ativa ? "Arquivar" : "Reativar"}</button>
            <button type="button" class="acao-linha" data-est="excluir-coluna" title="Excluir de vez" aria-label="Excluir de vez ${escapar(c.nome)}">${svg("i-lixeira")}</button>`}</td></tr>`).join("")}</tbody></table></div>
        ${planilhaAtual().tipo === "sw" ? `<p class="apoio" style="font-size:12px;margin-top:6px">As quatro primeiras colunas (NOME DA APLICAÇÃO, VERSÃO, HOSTNAME e MÊS/ANO) são fixas em toda planilha de Software: ficam sempre na frente, obrigatórias. As colunas novas entram depois delas.</p>` : ""}`;
    } else if (aba === "formulario") {
      const lista = doFormulario();
      alvo.innerHTML = `<p class="apoio" style="margin:10px 0 8px">Ordem dos campos na janela “Novo equipamento” e na ficha: arraste (ou use as setas). Ficam 3 por linha no formulário; textos longos ocupam a linha inteira. A ordem da grade não muda.</p>
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
    if ((a === "arquivar-coluna" || a === "excluir-coluna") && col && ehColunaFixa(planilhaAtual(), col.id)) { mostrarAviso(`“${col.nome}” é uma coluna fixa da planilha de Software: não se remove.`); return; }
    if ((a === "subir" || a === "descer") && col && planilhaAtual().tipo === "sw") {
      const ord = ordenadas(), i = ord.indexOf(col), j = i + (a === "subir" ? -1 : 1);
      if (ehColunaFixa(planilhaAtual(), col.id) || (ord[j] && ehColunaFixa(planilhaAtual(), ord[j].id))) { mostrarAviso("As quatro colunas fixas ficam sempre na frente, nesta ordem."); return; }
    }
    if (a === "arquivar-coluna" && col) {
      if (col.id === idChave() && col.ativa && !(await confirmar(`Arquivar “${col.nome}” desliga a conferência de valor repetido. Continuar?`, { titulo: "Arquivar coluna" }))) return;
      col.ativa = !col.ativa; desenhar();
    }
    if (a === "excluir-coluna" && col) {
      const usados = estado.equipamentos.filter((t) => !estaVazio((t.campos || {})[col.id])).length;
      if (!(await confirmarDigitando(`Excluir de vez a coluna “${col.nome}”? ${usados} registro(s) perdem esse valor. Um backup é feito antes de aplicar. Para só esconder, use Arquivar.`, col.nome, { titulo: "Excluir coluna de vez", botao: "Excluir coluna" }))) return;
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
    const fixa = !nova && ehColunaFixa(planilhaAtual(), base.id);
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
    if (JSON.stringify(original.regras) !== JSON.stringify(r.regras)) itens.push(`Regras da equipe: edita ${EQUIPE_EDITA.find((x) => x.id === r.regras.equipeEdita).nome.toLowerCase()}; janela ${r.regras.janelaEdicaoHoras || "sem limite"}${r.regras.janelaEdicaoHoras ? " h" : ""}; exportação ${r.regras.exportacao ? "liberada" : "desligada"}; novos registros ${r.regras.registro.aberto ? "permitidos" : "fechados"}${r.regras.registro.dominios.length ? ` (só ${r.regras.registro.dominios.join(", ")})` : ""}${r.regras.registro.aprovacao ? ", com liberação" : ", sem liberação"}, como ${r.regras.registro.papelPadrao === "leitura" ? "Leitura" : "Equipe"}`);
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
    const so_regras = itens.every((x) => /^(Título|Regras da equipe|Ordem no formulário)/.test(x)) && !migracoes.length;
    if (!(await confirmar(so_regras ? "Confira as mudanças:" : `Confira as mudanças. Antes de aplicar, é feito um backup automático (estrutura + ${estado.equipamentos.length} registros).`, {
      titulo: "Prévia das mudanças", botao: "Aplicar",
      html: `<ul class="lista-mudancas">${itens.map((x) => `<li>${escapar(x)}</li>`).join("")}${afetados ? `<li><strong>${afetados} registro(s) terão os dados ajustados.</strong></li>` : "<li><strong>Nenhum registro será alterado.</strong></li>"}</ul>`
    }))) return;
    if (!so_regras && !(await criarBackup(`Antes de mudar a estrutura (${itens.slice(0, 3).join("; ")}${itens.length > 3 ? "…" : ""})`))) return;
    try {
      if (ops.length) await estado.api.lote(ops);
      if (arquivo.size) await alterarArquivo(arquivo);
      await estado.api.salvarDoc(caminhoEstrutura(), dadosEstrutura(novo));
      registrarAuditoria("estrutura", `Mudou a estrutura (versão ${novo.versao})`, itens.join(" · ").slice(0, 1500));
      if (!ops.length && !arquivo.size) {
        const anterior = JSON.parse(JSON.stringify(original));
        empilharDesfazer("Estrutura anterior restaurada", async () => { anterior.versao = estado.estrutura.versao + 1; await estado.api.salvarDoc(caminhoEstrutura(), dadosEstrutura(anterior)); registrarAuditoria("estrutura", "Desfez a última mudança de estrutura"); });
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
    estado.equipamentos.forEach((t) => {
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
    const backups = await estado.api.lerColecao(`${COL_BACKUPS}`, { ordenar: "criadoEm", desc: true, limite: 50 });
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
    const linhas = estado.equipamentos.filter((t) => { const v = (t.campos || {})[s.col.id]; return Array.isArray(v) ? v.includes(s.id) : v === s.id; }).slice(0, 5);
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
      const aud = await estado.api.lerColecao(`${COL_AUDITORIA}`, { ordenar: "em", desc: true, limite: 300 });
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
/* Na primeira abertura de uma administradora depois desta atualização: procura valores sem nome (sem custo de leitura) */
const CHAVE_NOMES_VERIFICADOS = "inventario-nomes-verificados-v1";
let nomesVerificados = false;
function verificarNomesPerdidos() {
  if (nomesVerificados || !ehAdmin() || !estado.estrutura || !estado.carregouEquipamentos || lerLocal(CHAVE_NOMES_VERIFICADOS, false)) return;
  nomesVerificados = true;
  gravarLocal(CHAVE_NOMES_VERIFICADOS, true);
  const n = idsSoltos().length;
  if (!n) return;
  setTimeout(async () => {
    if (await confirmar(`${n} valor(es) sem nome encontrado(s): são de opções apagadas da lista antes desta atualização e hoje aparecem como “fora da lista”.`, { titulo: "Valores sem nome", botao: "Revisar" })) abrirRecuperarNomes();
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
    await estado.api.salvarDoc(caminhoEstrutura(), dados);
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
      if (criar.length) { nova.versao = estado.estrutura.versao + 1; await estado.api.salvarDoc(caminhoEstrutura(), dadosEstrutura(normalizarEstrutura(nova))); }
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
 *  Ciclo de auditoria (só administradoras): os equipamentos que não estão "Baixado/descartado"
 *  voltam para AUDITORIA = "Pendente" e a faixa do topo mostra o andamento até o ciclo ser encerrado.
 * ------------------------------------------------------------ */
const CAMINHO_CICLO = () => `${P()}-config/ciclo`;
const cicloAberto = () => !!(estado.ciclo && estado.ciclo.inicio && !estado.ciclo.encerradoEm);
const naAuditoria = (t) => (t.campos || {})[ID_STATUS] !== STATUS_BAIXADO;
function andamentoCiclo() {
  const lista = estado.equipamentos.filter(naAuditoria);
  const conta = (id) => lista.filter((t) => (t.campos || {})[ID_AUDITORIA] === id).length;
  const ok = conta(AUD_OK), divergencias = conta(AUD_DIVERGENCIA), naoLocalizados = conta(AUD_NAO_LOCALIZADO);
  const auditados = ok + divergencias + naoLocalizados;
  return { total: lista.length, auditados, ok, divergencias, naoLocalizados, pendentes: lista.length - auditados };
}
function renderizarCiclo() {
  const faixa = $("#faixa-ciclo");
  if (!cicloAberto() || !colAtiva(ID_AUDITORIA) || !estado.estrutura) { faixa.hidden = true; return; }
  const a = andamentoCiclo();
  const pct = a.total ? Math.round((a.auditados / a.total) * 100) : 0;
  faixa.hidden = false;
  faixa.innerHTML = `<div class="ciclo-texto">${svg("i-escudo")}<span>Auditoria iniciada em ${escapar(formatarData(estado.ciclo.inicio))} · <strong>${a.auditados.toLocaleString("pt-BR")} de ${a.total.toLocaleString("pt-BR")} auditados (${pct}%)</strong></span>
      <button type="button" class="btn-link" data-ciclo="pendentes">Ver pendentes</button>
      ${ehAdmin() ? '<button type="button" class="btn btn-secundario btn-mini" data-ciclo="encerrar">Encerrar ciclo</button>' : ""}</div>
    <div class="barra-progresso" role="progressbar" aria-label="Andamento da auditoria" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`;
}
$("#faixa-ciclo").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ciclo]");
  if (!b) return;
  if (b.dataset.ciclo === "encerrar") encerrarCiclo();
  if (b.dataset.ciclo === "pendentes") { estado.vista.especial = `aud:${AUD_PENDENTE}`; salvarVista(); renderizarTudo(); }
});
async function iniciarCiclo() {
  if (!ehAdmin() || !conectado()) return;
  const aud = colAtiva(ID_AUDITORIA);
  if (!aud || !opcao(aud, AUD_PENDENTE)) { mostrarAviso("A coluna AUDITORIA, com a opção “Pendente”, precisa estar ativa."); return; }
  if (cicloAberto() && !(await confirmar(`Já existe uma auditoria aberta desde ${formatarData(estado.ciclo.inicio)}. Começar outra do zero?`, { titulo: "Iniciar nova auditoria", botao: "Começar outra" }))) return;
  const lista = estado.equipamentos.filter(naAuditoria);
  const mudar = lista.filter((t) => (t.campos || {})[aud.id] !== AUD_PENDENTE);
  if (!(await confirmar(`Os ${lista.length} equipamento(s) que não estão “Baixado/descartado” voltam para AUDITORIA = “Pendente” (${mudar.length} mudam agora). Antes, é feito um backup automático.`, { titulo: "Iniciar nova auditoria", botao: "Iniciar auditoria" }))) return;
  mostrarAviso("Fazendo o backup…", 30000);
  if (!(await criarBackup("Antes de iniciar uma nova auditoria"))) return;
  mostrarAviso(`Marcando ${mudar.length} equipamento(s) como pendentes…`, 60000);
  try {
    for (let i = 0; i < mudar.length; i += 100) await definirEmVarios(mudar.slice(i, i + 100).map((t) => [t, AUD_PENDENTE]), aud, "iniciarAuditoria");
    await estado.api.salvarDoc(CAMINHO_CICLO(), { inicio: "__AGORA__", encerradoEm: null, resumo: null, atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email });
    registrarAuditoria("auditoria", `Iniciou uma nova auditoria: ${lista.length} equipamento(s)`, `${mudar.length} voltaram para Pendente`);
    mostrarAviso(`Auditoria iniciada: ${lista.length} equipamento(s) para auditar.`, 6000);
  } catch (e) {
    console.error(e);
    mostrarAviso(`${mensagemErro(e)} Se algo ficou pela metade, use “Iniciar nova auditoria” de novo (o backup já foi feito).`, 9000);
  }
}
async function encerrarCiclo() {
  if (!ehAdmin() || !cicloAberto()) return;
  const a = andamentoCiclo();
  const inicio = estado.ciclo.inicio;
  if (!(await confirmar(`Encerrar a auditoria iniciada em ${formatarData(inicio)}?`, {
    titulo: "Encerrar ciclo", botao: "Encerrar ciclo",
    html: `<ul class="lista-mudancas"><li>Equipamentos na auditoria: <strong>${a.total}</strong></li><li>Auditado - OK: <strong>${a.ok}</strong></li><li>Divergências: <strong>${a.divergencias}</strong></li><li>Não localizados: <strong>${a.naoLocalizados}</strong></li><li>Ainda pendentes: <strong>${a.pendentes}</strong></li></ul>`
  }))) return;
  try {
    await estado.api.salvarDoc(CAMINHO_CICLO(), { encerradoEm: "__AGORA__", resumo: { total: a.total, ok: a.ok, divergencias: a.divergencias, naoLocalizados: a.naoLocalizados, pendentes: a.pendentes }, atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email }, true);
    registrarAuditoria("auditoria", `Encerrou a auditoria iniciada em ${formatarData(inicio)}`, `OK ${a.ok} · divergências ${a.divergencias} · não localizados ${a.naoLocalizados} · pendentes ${a.pendentes} (de ${a.total})`);
    if (await confirmar(`Auditoria encerrada: ${a.ok} OK, ${a.divergencias} divergência(s), ${a.naoLocalizados} não localizado(s) e ${a.pendentes} pendente(s). Baixar o CSV com o resultado?`, { titulo: "Resultado da auditoria", botao: "Baixar CSV" })) exportarResultadoAuditoria(inicio);
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e), 6000); }
}
/* CSV do resultado: todos os equipamentos que entram na auditoria, com a situação de cada um */
function exportarResultadoAuditoria(inicio = estado.ciclo && estado.ciclo.inicio) {
  const cols = colunasAtivas().filter((c) => !TIPOS_SEM_EDICAO.includes(c.tipo));
  const lista = estado.equipamentos.filter(naAuditoria).sort((a, b) => COMPARAR(String((a.campos || {})[ID_HOSTNAME] || ""), String((b.campos || {})[ID_HOSTNAME] || "")));
  const linhas = [[...cols.map((c) => c.nome), "Atualizado por", "Atualizado em"].map(csvCampo).join(";"),
    ...lista.map((t) => [...cols.map((c) => valorTexto(t, c)), nomeAutor(t, "atualizadoPor"), formatarData(t.atualizadoEm, true)].map(csvCampo).join(";"))];
  const p = partesBrasilia();
  baixarArquivo(`inventario-auditoria-${p.ano}-${p.mes}-${p.dia}.csv`, "\ufeff" + linhas.join("\r\n"), "text/csv;charset=utf-8");
  mostrarAviso(`CSV da auditoria${inicio ? ` iniciada em ${formatarData(inicio)}` : ""} com ${lista.length} equipamento(s) baixado.`, 5000);
}

/* ------------------------------------------------------------
 *  Busca rápida (Ctrl+K): em todos os inventários que a pessoa pode ver (abrirBuscaGlobal)
 * ------------------------------------------------------------ */
$("#btn-busca-rapida").innerHTML = svg("i-busca") + '<span>Buscar em tudo</span><kbd>Ctrl K</kbd>';
$("#btn-busca-rapida").addEventListener("click", () => abrirBuscaGlobal());
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !$("#app").hidden && !document.querySelector("dialog[open]")) { e.preventDefault(); abrirBuscaGlobal(); }
});

/* ------------------------------------------------------------
 *  Importação em lotes (administradoras): ~100 equipamentos por vez, com progresso.
 *  Se a cota diária de gravações do plano gratuito acabar (ou a conexão cair), o que falta fica
 *  guardado neste navegador para Administração › "Continuar a importação".
 * ------------------------------------------------------------ */
const chaveImportacao = () => chaveUsuario("importacao-pendente");
const LOTE_IMPORTACAO = 100;
/* grupos: [[escritas de um equipamento], …] (registro, índices e histórico; refazer um lote não duplica nada) */
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
  if (r.ok) return `${r.feitos} equipamento(s) gravado(s).`;
  return r.cota
    ? `${r.feitos} gravado(s). O limite diário de gravações do plano gratuito acabou: faltam ${r.faltam}, guardados neste navegador. Amanhã, use Administração › “Continuar a importação”.`
    : `${r.feitos} gravado(s). A importação parou (sem conexão ou sem permissão): faltam ${r.faltam}. Use Administração › “Continuar a importação”.`;
}
async function continuarImportacao() {
  const p = lerLocal(chaveImportacao(), null);
  if (!p || !Array.isArray(p.grupos) || !p.grupos.length) { apagarLocal(chaveImportacao()); mostrarAviso("Não há importação pendente."); return; }
  mostrarAviso(`Continuando a importação: ${p.grupos.length} equipamento(s)…`, 60000);
  const r = await gravarImportacao(p.grupos, (feitos, total) => mostrarAviso(`Importando… ${feitos} de ${total}`, 60000));
  registrarAuditoria("importar", `Continuou a importação: ${r.feitos} de ${p.grupos.length} equipamento(s)`);
  mostrarAviso(textoResultadoImportacao(r), 9000);
}


/* Menu Administração */
function abrirMenuAdmin(botao) {
  fecharPop();
  const naPlanilha = estado.tela === "planilha" && !!estado.estrutura;
  const pl = planilhaAtual();
  const pedidos = estado.equipamentos.filter((t) => t.exclusao).length;
  const pendente = naPlanilha ? lerLocal(chavePendente(), null) : null;
  const importacao = naPlanilha ? lerLocal(chaveImportacao(), null) : null;
  const itens = [
    ...(naPlanilha ? [
      ["estrutura", "i-ajustes", "Estrutura (colunas, listas e regras)"],
      ["fora", "i-alerta", "Corrigir valores fora da lista"],
      ["substituir", "i-ordenar", "Substituir valor nos registros"],
      ...(pl.indices ? [["recuperar-nomes", "i-historico", "Recuperar nomes de opções apagadas"]] : []),
      ...(importacao && importacao.grupos && importacao.grupos.length ? [["continuar-importacao", "i-upload", `Continuar a importação (${importacao.grupos.length} pendente(s))`]] : []),
      ...(pendente && pendente.itens && pendente.itens.length ? [["continuar", "i-restaurar", `Continuar a conversão (${pendente.itens.length} pendente(s))`]] : []),
      ...(pl.ciclo ? [
        ["auditoria-iniciar", "i-escudo", cicloAberto() ? "Iniciar nova auditoria (há uma aberta)" : "Iniciar nova auditoria"],
        ...(cicloAberto() ? [["auditoria-encerrar", "i-check", "Encerrar ciclo de auditoria"]] : []),
        ["auditoria-csv", "i-download", "Baixar resultado da auditoria (CSV)"]] : [])
    ] : []),
    ["pessoas", "i-pessoas", `Pessoas (${estado.identidades.length})${aguardando() ? ` · ${aguardando()} aguardando` : ""}`],
    ...(naPlanilha ? [
      ...(!pl.soAdmin ? [["pedidos", "i-alerta", `Pedidos de exclusão (${pedidos})`]] : []),
      ["lixeira", "i-lixeira", `Lixeira (${estado.lixeira.length})`],
      ["backups", "i-salvar", "Backups"],
      ...(pl.arquivo ? [["compactar", "i-tabela", `Compactar registros (${estado.vivos.filter((t) => !t.exclusao).length} fora do arquivo)`]] : [])
    ] : []),
    ["importacoes", "i-upload", "Importações (tabela provisória)"],
    ["registro-auditoria", "i-historico", "Auditoria (linha do tempo)"]
  ];
  const pop = document.createElement("div");
  pop.className = "pop";
  pop.style.width = "290px";
  pop.setAttribute("role", "menu");
  pop.innerHTML = itens.map(([id, icone, nome]) => `<button type="button" class="item-menu" role="menuitem" data-adm="${id}">${svg(icone)}${escapar(nome)}</button>`).join("");
  posicionarPop(pop, botao, 290);
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-adm]");
    if (!b) return;
    fecharPop();
    const a = b.dataset.adm;
    if (!conectado() && !["registro-auditoria", "auditoria-csv", "importacoes"].includes(a)) { mostrarAviso("Sem conexão: a administração está bloqueada."); return; }
    if (a === "fora") abrirForaDaLista();
    if (a === "substituir") abrirSubstituirValor();
    if (a === "recuperar-nomes") abrirRecuperarNomes();
    if (a === "continuar") continuarConversao();
    if (a === "continuar-importacao") continuarImportacao();
    if (a === "estrutura") abrirEstrutura();
    if (a === "auditoria-iniciar") iniciarCiclo();
    if (a === "auditoria-encerrar") encerrarCiclo();
    if (a === "auditoria-csv") exportarResultadoAuditoria();
    if (a === "pessoas") abrirPessoas();
    if (a === "pedidos") { estado.vista.especial = "exclusao"; salvarVista(); renderizarTudo(); }
    if (a === "lixeira") abrirLixeira();
    if (a === "backups") abrirBackups();
    if (a === "compactar") compactarArquivo();
    if (a === "importacoes") navegar({ tela: "importacoes" });
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
  estado.pararOuvintes.push(estado.api.ouvirDoc(`inventario-identidades/${aparelho.email}`, (i) => {
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
  const pl = planilhaAtual();
  $$("[data-editor]").forEach((b) => { b.hidden = !alimenta; });
  $$("[data-admin]").forEach((b) => { b.hidden = !ehAdmin() || !estado.estrutura; });
  $$("[data-perfil]").forEach((b) => { b.hidden = !pl.grupo || !estado.estrutura; });
  $$("[data-perfil-sw]").forEach((b) => { b.hidden = pl.tipo !== "sw" || !estado.estrutura; });
  $("#selo-visualizacao").hidden = !soVisualizacao() || !estado.estrutura;
  $("#btn-desfazer").disabled = !estado.desfazer.length;
  $("#menu-admin").hidden = !ehAdmin();
  $("#faixa-offline").hidden = !(estado.offline || (estado.usandoCopia && !estado.carregouEquipamentos));
  $("#btn-busca-rapida").hidden = !estado.usuario;
}
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
$("#btn-marca").addEventListener("click", () => navegar({ tela: "menu" }));
function renderizarSemEstrutura() {
  const caixa = $("#sem-estrutura");
  const sem = estado.carregouEstrutura && !estado.estrutura;
  caixa.hidden = !sem;
  ["#resumo", "#abas", ".barra", "#area-dados"].forEach((s) => { $(s).hidden = sem; });
  if (!sem) return;
  const pl = planilhaAtual();
  const colunasIniciais = pl.tipo ? estruturaInicialPerfil(pl).colunas.map((c) => c.nome).join(", ") : "HOSTNAME, DNA, NOME DO USUÁRIO, ÁREA, GESTOR, STATUS, AUDITORIA, TÉCNICO e OBSERVAÇÃO";
  caixa.innerHTML = ehAdmin()
    ? `<div class="cartao-login" style="margin:24px auto;text-align:center"><h2>${escapar(nomeCompletoPlanilha(pl))} ainda não tem estrutura</h2>
        <p class="apoio">Crie a estrutura inicial: ${escapar(colunasIniciais)}.${pl.tipo === "sw" ? " As quatro primeiras são fixas em toda planilha de Software." : ""} A planilha nasce vazia; depois dá para ajustar em Administração › Estrutura.</p>
        <button type="button" class="btn" id="btn-criar-estrutura">${svg("i-mais")}Criar estrutura inicial</button></div>`
    : `<div class="cartao-login" style="margin:24px auto;text-align:center"><h2>Inventário em preparação</h2><p class="apoio">${pl.grupo ? `Ainda não há ${pl.tipo === "sw" ? "software" : "hardware"} cadastrado em ${GRUPOS_INVENTARIO[pl.grupo]}.` : "O inventário ainda não foi configurado."} Fale com a Lays ou a Paula.</p></div>`;
  const b = $("#btn-criar-estrutura");
  if (b) b.addEventListener("click", () => criarEstruturaInicial());
}
async function criarEstruturaInicial(pl = planilhaAtual()) {
  if (!ehAdmin() || !conectado()) return false;
  try {
    if (await estado.api.lerDoc(caminhoEstrutura(pl))) { if (pl === planilhaAtual()) mostrarAviso("A estrutura já existe."); return true; }
    const e = normalizarEstrutura(pl.tipo ? estruturaInicialPerfil(pl) : estruturaInicial(), pl);
    await estado.api.salvarDoc(caminhoEstrutura(pl), dadosEstrutura(e));
    registrarAuditoria("estrutura", `Criou a estrutura inicial do ${nomeCompletoPlanilha(pl)}`, "", { planilha: pl.id });
    if (pl === planilhaAtual()) mostrarAviso(pl.tipo ? "Estrutura criada." : "Estrutura criada. Inclua os gestores em Administração › Estrutura (coluna GESTOR).", 7000);
    return true;
  } catch (err) { console.error(err); mostrarAviso(mensagemErro(err)); return false; }
}

/* ------------------------------------------------------------
 *  "Entrar no Inventário de Equipamentos" (equipe: e-mail + nome, sem senha) e "Sou administradora"
 *  Sobre um login anônimo do Firebase, este navegador vira um aparelho (inventario-pessoas/{uid})
 *  ligado à identidade do e-mail (inventario-identidades/{email}). Quem confere o nome são as
 *  regras do Firestore (vinculoInventario): o app nunca lê o nome cadastrado de um e-mail.
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

/* Ao sair do campo E-mail: "Entrar" (tem cadastro) ou "Criar cadastro" (não tem). Lê só inventario-emails/{email}. */
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
  const existe = !!(await estado.api.lerDoc(`inventario-emails/${email}`));
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
        await api.salvarDoc(`inventario-pessoas/${u.uid}`, { email, nomeChave: chave, vinculadoEm: "__AGORA__", ultimoAcesso: "__AGORA__" }, true);
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
    const cfg = normalizarEstrutura(await api.lerDoc("inventario-config/estrutura"));
    if (!cfg) { esconderConfirmacao(); marcarErrosIdentidade({}, "A planilha ainda não foi configurada. Fale com a Lays ou a Paula."); return; }
    const registro = cfg.regras.registro;
    if (!registro.aberto) { esconderConfirmacao(); marcarErrosIdentidade({}, "Novos cadastros estão fechados no momento. Fale com a Lays ou a Paula."); return; }
    if (registro.dominios.length && !registro.dominios.includes(email.split("@")[1])) {
      esconderConfirmacao();
      marcarErrosIdentidade({ email: `Use o seu e-mail corporativo (${registro.dominios.map((d) => "@" + d).join(" ou ")}).` });
      return;
    }
    await api.lote([
      { op: "set", caminho: `inventario-identidades/${email}`, dados: { email, nome, nomeChave: chave, papel: registro.papelPadrao, ativo: true, aprovado: !registro.aprovacao, criadoEm: "__AGORA__", criadoPorUid: u.uid, atualizadoEm: "__AGORA__" } },
      { op: "set", caminho: `inventario-emails/${email}`, dados: {} },
      { op: "set", caminho: `inventario-pessoas/${u.uid}`, mesclar: true, dados: { email, nomeChave: chave, vinculadoEm: "__AGORA__", ultimoAcesso: "__AGORA__" } }
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
  PLANILHAS.forEach((p) => apagarLocal(`${CHAVE_COPIA}:${p.id}`));
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
  Object.assign(estado, { estrutura: null, carregouEstrutura: false, ciclo: null, equipamentos: [], carregouEquipamentos: false, vivos: [], carregouVivos: false, arquivo: arquivoVazio(), carregouArquivo: false, vista: null, lixeira: [], desfazer: [], usandoCopia: false, selecionando: false, busca: "", visao: "padrao", celula: null, intervalo: null });
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
    aparelho = await estado.api.lerDoc(`inventario-pessoas/${u.uid}`);
    if (aparelho && aparelho.vinculadoEm && aparelho.email) identidade = await estado.api.lerDoc(`inventario-identidades/${aparelho.email}`);
  } catch (e) { semConexao = !/permission/.test((e && e.code) || ""); }
  if (semConexao) {
    const copia = lerLocal(CHAVE_COPIA, null);
    if (!copia || copia.id !== u.uid || !copia.vinculadoEm) { mostrarBloqueio({ titulo: "Sem conexão", texto: "Não foi possível abrir o inventário agora. Verifique a internet.", verificar: true }); return; }
    entrarComIdentidade(u.uid, { email: copia.email, vinculadoEm: copia.vinculadoEm }, { nome: copia.nome, email: copia.email, papel: copia.papel, ativo: true, aprovado: true }, { semConexao: true });
    return;
  }
  /* Aparelho sem cadastro deste site (ex.: só tem cadastro em outro site): vai para a tela de entrada */
  if (!aparelho || !aparelho.vinculadoEm) { estado.usuario = null; if (!entradaVisivel()) mostrarRegistro(); return; }
  rotaIdentidade(u.uid, aparelho, identidade);
}
/* Lê o aparelho deste navegador (e a identidade, se ligado) e leva para a tela certa */
async function abrirAparelho(uid) {
  const aparelho = await estado.api.lerDoc(`inventario-pessoas/${uid}`);
  if (!aparelho || !aparelho.vinculadoEm) {
    const estavaDentro = !!estado.usuario;
    estado.usuario = null;
    mostrarRegistro(estavaDentro ? { aviso: "Este computador saiu do seu cadastro. Entre de novo com o seu e-mail e nome." } : {});
    return;
  }
  rotaIdentidade(uid, aparelho, await estado.api.lerDoc(`inventario-identidades/${aparelho.email}`));
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
    estado.api.salvarDoc(`inventario-pessoas/${uid}`, { ultimoAcesso: "__AGORA__" }, true).catch((e) => console.warn("ultimoAcesso:", e));
  }
  iniciarPlanilha();
  /* Bloqueio, papel, nome corrigido e "Desconectar todos os aparelhos" valem na hora */
  estado.pararOuvintes.push(estado.api.ouvirDoc(`inventario-identidades/${identidade.email}`, (i) => {
    if (!estado.usuario || estado.usuario.uid !== uid) return;
    if (!i || i.ativo === false || !i.aprovado || desconectado(aparelho, i)) { rotaIdentidade(uid, aparelho, i); return; }
    const papelNovo = i.papel === "leitura" ? "leitura" : "equipe";
    if (papelNovo === estado.usuario.papel && i.nome === estado.usuario.nome) return;
    Object.assign(estado.usuario, { papel: papelNovo, nome: i.nome });
    lembrarConta(i.email, i.nome);
    atualizarTopo(); atualizarBotoes(); agendarRender();
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
    gravarLocal(chaveCopia(), { id: estado.usuario.id, email: estado.usuario.email, nome: estado.usuario.nome, papel: estado.usuario.papel, vinculadoEm: estado.usuario.vinculadoEm || "", salvaEm: new Date().toISOString(), planilha: planilhaAtual().id, estrutura: dadosEstruturaBackup(estado.estrutura), equipamentos: estado.arquivo.linhas.length ? null : estado.equipamentos });
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
 *  Planilhas: Inventário de Equipamentos e VCORP/VCERT (Hardware e Software)
 * ------------------------------------------------------------ */
/* Índices de HOSTNAME/DNA, título da aba do navegador e textos que dependem da planilha aberta */
function marcarPlanilha() {
  const pl = planilhaAtual();
  INDICES = pl.indices ? INDICES_EQUIPAMENTOS : [];
  $("#btn-novo").innerHTML = svg("i-mais") + escapar(pl.termo.novo);
}

/* Sessão (depois de entrar): topo, as pessoas (administradoras), o registro da entrada e a tela do endereço */
function iniciarPlanilha() {
  mostrarTela("app");
  atualizarTopo();
  if (ehAdmin()) {
    const aoMudar = () => { cacheBusca = new WeakMap(); atualizarBotaoAdmin(); atualizarBotoes(); if (estado.aoMudarPessoas) estado.aoMudarPessoas(); };
    estado.pararOuvintes.push(estado.api.ouvirColecao("inventario-pessoas", (lista) => { estado.pessoas = lista; aoMudar(); }, (e) => console.warn("pessoas", e)));
    estado.pararOuvintes.push(estado.api.ouvirColecao("inventario-identidades", (lista) => { estado.identidades = lista; aoMudar(); }, (e) => console.warn("identidades", e)));
  }
  registrarEntrada();
  mostrarRota(rotaDaUrl(), { substituir: true });
}
/* Abre a planilha: estrutura, ciclo de auditoria, equipamentos vivos, arquivo compactado e (administradoras) lixeira */
function abrirPlanilha() {
  pararOuvintesPlanilha();
  fecharPop();
  fecharCombo();
  if (!ficha.hidden) fecharFicha();
  $("#busca").value = "";
  /* Aparência do inventário (pessoal deste navegador + padrão no Firestore) */
  if (aparencia) aparencia.aoTrocarPlanilha();
  const api = estado.api;
  const pl = planilhaAtual();
  marcarPlanilha();
  const copia = lerLocal(chaveCopia(), null);
  if (copia && copia.id === estado.usuario.id && Array.isArray(copia.equipamentos) && (copia.planilha || "inventario") === pl.id) {
    aplicarEstrutura(normalizarEstrutura(copia.estrutura));
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
  ouvir(api.ouvirDoc(caminhoEstrutura(), (d) => {
    aplicarEstrutura(normalizarEstrutura(d));
    estado.carregouEstrutura = true;
    renderizarSemEstrutura();
    atualizarBotoes();
    salvarCopia();
    agendarRender();
  }, aoErro("estrutura")));
  if (pl.ciclo) ouvir(api.ouvirDoc(CAMINHO_CICLO(), (d) => { estado.ciclo = d; renderizarCiclo(); }, (e) => console.warn("ciclo", e)));
  /* A planilha só aparece depois que os registros vivos e o arquivo compactado chegaram */
  const aoChegarEquipamentos = () => {
    if (!estado.carregouVivos || !estado.carregouArquivo) return;
    combinarEquipamentos();
    estado.carregouEquipamentos = true;
    estado.usandoCopia = false;
    if (!navigator.onLine) estado.offline = true; else estado.offline = false;
    cacheDados.set(pl.id, { em: Date.now(), registros: estado.equipamentos, estrutura: estado.estrutura });
    atualizarBotoes();
    salvarCopia();
    agendarRender();
    if (aparencia) aparencia.aoMudarDados();
    if (pl.indices) verificarNomesPerdidos();
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
  }, aoErro("equipamentos")));
  /* Arquivo compactado: só no Inventário de Equipamentos */
  if (pl.arquivo) {
    ouvir(api.ouvirColecao(`${P()}-arquivo`, (lista) => {
      aplicarArquivo(lista);
      estado.carregouArquivo = true;
      aoChegarEquipamentos();
    }, aoErro("arquivo")));
  } else { aplicarArquivo([]); estado.carregouArquivo = true; }
  if (ehAdmin()) ouvir(api.ouvirColecao(`${COL_LIXEIRA}`, (lista) => { estado.lixeira = lista.filter(daPlanilhaAtual); if (estado.aoMudarLixeira) estado.aoMudarLixeira(); }, (e) => console.warn("lixeira", e)));
}
/* ============================================================
 *  INVENTÁRIO / AUDITORIA
 *  Navegação (Menu do Gestor › inventário › aba), leitura das planilhas para cruzar dados (ficha do
 *  HOSTNAME, alertas, painel e busca global), importações com tabela provisória e a tela de Auditoria.
 * ============================================================ */
const CHAVE_ENTRADA = "inventario-entrada-registrada";
const COL_IMPORTACOES = "inventario-importacoes", COL_MAPEAMENTOS = "inventario-mapeamentos";
const MAX_LINHAS_IMPORTACAO = 5000, DIAS_DESFAZER = 7, DIAS_EXPIRAR = 30, DIA_MS = 86400000;
estado.tela = "";
estado.passos = 0;
/* Dados das planilhas que não estão abertas (ficha do HOSTNAME, painel, alertas, busca): 5 minutos */
const cacheDados = new Map();
const TEMPO_CACHE = 5 * 60000;

/* Registro da entrada na trilha (uma vez por sessão do navegador) */
function registrarEntrada() {
  try {
    if (sessionStorage.getItem(CHAVE_ENTRADA) === estado.usuario.uid) return;
    sessionStorage.setItem(CHAVE_ENTRADA, estado.usuario.uid);
  } catch (e) { /* sem sessionStorage: registra de novo */ }
  registrarAuditoria("entrar", `Entrou no Inventário e Auditoria (${{ admin: "administradora", equipe: "equipe", leitura: "leitura" }[papel()]})`, "", { planilha: "" });
}

/* ---------- Rotas: ?inv=equipamentos | ?inv=vcorp&aba=hw|sw | ?inv=vcert&aba=hw|sw | ?tela=importacoes | ?tela=auditoria ---------- */
function rotaDaUrl() {
  const p = new URLSearchParams(location.search);
  const tela = (p.get("tela") || "").toLowerCase();
  if (tela === "importacoes") return { tela, id: p.get("id") || "" };
  if (tela === "auditoria") return { tela };
  const inv = (p.get("inv") || "").toLowerCase();
  if (inv === "equipamentos") return { tela: "planilha", planilha: "inventario" };
  if (GRUPOS_INVENTARIO[inv]) return { tela: "planilha", planilha: `${inv}-${(p.get("aba") || "").toLowerCase() === "sw" ? "sw" : "hw"}` };
  return { tela: "menu" };
}
function urlDaRota(r) {
  const base = location.pathname;
  if (r.tela === "planilha") { const pl = planilhaPorId(r.planilha) || PLANILHAS[0]; return pl.grupo ? `${base}?inv=${pl.grupo}&aba=${pl.aba}` : `${base}?inv=equipamentos`; }
  if (r.tela === "importacoes") return `${base}?tela=importacoes${r.id ? `&id=${encodeURIComponent(r.id)}` : ""}`;
  if (r.tela === "auditoria") return `${base}?tela=auditoria`;
  return base;
}
function navegar(r) {
  if (!estado.usuario) return;
  history.pushState({ inventario: true }, "", urlDaRota(r));
  estado.passos++;
  mostrarRota(r);
}
window.addEventListener("popstate", () => {
  if (!estado.usuario || $("#app").hidden) return;
  estado.passos = Math.max(0, estado.passos - 1);
  mostrarRota(rotaDaUrl());
});
const podeVerAuditoria = () => ehAdmin() || papel() === "equipe";
function mostrarRota(r, { substituir = false } = {}) {
  if (r.tela === "importacoes" && !ehAdmin()) { mostrarAviso("Importações: só as administradoras."); r = { tela: "menu" }; substituir = true; }
  if (r.tela === "auditoria" && !podeVerAuditoria()) { mostrarAviso("A auditoria não está liberada para o seu acesso."); r = { tela: "menu" }; substituir = true; }
  if (r.tela === "planilha" && !planilhaPorId(r.planilha)) r = { tela: "menu" };
  if (substituir) history.replaceState({ inventario: true }, "", urlDaRota(r));
  fecharPop();
  fecharCombo();
  if (estado.pararTela) { try { estado.pararTela(); } catch (e) { /* já parado */ } estado.pararTela = null; }
  const anterior = estado.tela;
  estado.tela = r.tela;
  ["tela-menu", "tela-importacoes", "tela-auditoria", "conteudo-planilha"].forEach((id) => { $("#" + id).hidden = true; });
  if (r.tela !== "planilha" && (anterior === "planilha" || estado.carregouEstrutura)) { if (!ficha.hidden) fecharFicha(); pararOuvintesPlanilha(); }
  if (r.tela === "planilha") {
    $("#conteudo-planilha").hidden = false;
    if (anterior !== "planilha" || estado.planilha !== r.planilha) {
      if (anterior === "planilha" && !ficha.hidden) fecharFicha();
      estado.planilha = r.planilha;
      abrirPlanilha();
    }
    renderizarAbasPerfil();
  } else if (r.tela === "menu") { $("#tela-menu").hidden = false; renderizarMenu(); }
  else if (r.tela === "importacoes") { $("#tela-importacoes").hidden = false; renderizarImportacoes(r.id); }
  else if (r.tela === "auditoria") { $("#tela-auditoria").hidden = false; renderizarTelaAuditoria(); }
  renderizarMigalhas(r);
  atualizarBotoes();
  if (anterior !== r.tela || r.tela !== "planilha") window.scrollTo({ top: 0 });
}
function tituloDaRota(r) {
  if (r.tela === "planilha") return nomeCompletoPlanilha(planilhaPorId(r.planilha));
  return { importacoes: "Importações", auditoria: "Auditoria" }[r.tela] || "Menu";
}
function renderizarMigalhas(r) {
  const itens = [{ rotulo: "Menu", rota: r.tela === "menu" ? null : { tela: "menu" } }];
  if (r.tela === "planilha") {
    const pl = planilhaPorId(r.planilha);
    if (pl.grupo) itens.push({ rotulo: GRUPOS_INVENTARIO[pl.grupo], rota: { tela: "planilha", planilha: `${pl.grupo}-${pl.aba === "hw" ? "sw" : "hw"}` }, titulo: `Trocar para ${pl.aba === "hw" ? "Software" : "Hardware"}` });
    itens.push({ rotulo: pl.grupo ? pl.curto : "Inventário de Equipamentos" });
  }
  if (r.tela === "importacoes") { itens.push({ rotulo: "Importações", rota: r.id ? { tela: "importacoes" } : null }); if (r.id) itens.push({ rotulo: "Revisão" }); }
  if (r.tela === "auditoria") itens.push({ rotulo: "Auditoria" });
  $("#migalhas").innerHTML = `<ol>${itens.map((it, i) => `<li>${it.rota && i < itens.length - 1 ? `<a href="${escapar(urlDaRota(it.rota))}" data-rota="${escapar(JSON.stringify(it.rota))}"${it.titulo ? ` title="${escapar(it.titulo)}"` : ""}>${escapar(it.rotulo)}</a>` : `<span${i === itens.length - 1 ? ' aria-current="page"' : ""}>${escapar(it.rotulo)}</span>`}</li>`).join("")}</ol>`;
  $("#btn-voltar").hidden = r.tela === "menu";
  if (r.tela !== "planilha") $("#titulo-planilha").textContent = "Inventário e Auditoria";
  document.title = `${tituloDaRota(r)} · Inventário e Auditoria · Suporte V/Cert`;
}
$("#migalhas").addEventListener("click", (e) => {
  const a = e.target.closest("[data-rota]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  e.preventDefault();
  navegar(JSON.parse(a.dataset.rota));
});
$("#btn-voltar").innerHTML = svg("i-voltar");
$("#btn-voltar").addEventListener("click", () => {
  if (estado.passos > 0) { history.back(); return; }
  const r = rotaDaUrl();
  navegar(r.tela === "importacoes" && r.id ? { tela: "importacoes" } : { tela: "menu" });
});
/* VCORP/VCERT: troca rápida entre Hardware e Software */
function renderizarAbasPerfil() {
  let caixa = $("#abas-perfil");
  if (!caixa) {
    caixa = document.createElement("div");
    caixa.id = "abas-perfil";
    caixa.className = "abas-perfil";
    caixa.setAttribute("role", "tablist");
    $("#conteudo-planilha").prepend(caixa);
    caixa.addEventListener("click", (e) => { const b = e.target.closest("[data-ir-planilha]"); if (b && b.dataset.irPlanilha !== estado.planilha) navegar({ tela: "planilha", planilha: b.dataset.irPlanilha }); });
  }
  const pl = planilhaAtual();
  caixa.hidden = !pl.grupo;
  if (!pl.grupo) return;
  caixa.setAttribute("aria-label", `Inventário ${GRUPOS_INVENTARIO[pl.grupo]}`);
  caixa.innerHTML = ["hw", "sw"].map((aba) => { const p = planilhaDe(pl.grupo, aba); return `<button type="button" role="tab" class="aba-grupo" data-ir-planilha="${p.id}" aria-selected="${p.id === pl.id}">${svg(aba === "hw" ? "i-tabela" : "i-documento")}${escapar(p.curto)}</button>`; }).join("");
}

/* ---------- Dados de qualquer planilha (a aberta vem do estado; as outras, lidas uma vez e guardadas 5 min) ---------- */
function combinarRegistros(vivosLista, docsArquivo) {
  const porVersao = new Map();
  docsArquivo.forEach((d) => { const v = Number(d.versao) || 0; if (!porVersao.has(v)) porVersao.set(v, []); porVersao.get(v).push(d); });
  const inteira = [...porVersao].filter(([, ds]) => ds.length === Number(ds[0].total)).sort((a, b) => b[0] - a[0])[0];
  const linhas = inteira ? inteira[1].sort((a, b) => a.indice - b.indice).flatMap(lerParte) : [];
  const vivos = new Map(vivosLista.map((t) => [t.id, t]));
  const doArquivo = linhas.map((t) => { const v = vivos.get(t.id); if (!v) return t; vivos.delete(t.id); return v.parcial ? mesclarParcial(t, v) : v; });
  return [...vivos.values(), ...doArquivo];
}
async function dadosDaPlanilha(id, { forcar = false } = {}) {
  const pl = planilhaPorId(id);
  if (estado.tela === "planilha" && estado.planilha === id && estado.carregouEquipamentos && !forcar) return { em: Date.now(), registros: estado.equipamentos, estrutura: estado.estrutura };
  const c = cacheDados.get(id);
  if (c && !forcar && Date.now() - c.em < TEMPO_CACHE) return c;
  const [vivos, arquivo, est] = await Promise.all([
    estado.api.lerColecao(pl.prefixo),
    pl.arquivo ? estado.api.lerColecao(`${pl.prefixo}-arquivo`) : Promise.resolve([]),
    estado.api.lerDoc(pl.estrutura)
  ]);
  const r = { em: Date.now(), registros: combinarRegistros(vivos.map(normalizarEquipamento), arquivo), estrutura: est ? normalizarEstrutura(est, pl) : null };
  cacheDados.set(id, r);
  return r;
}
const ultimaAtualizacao = (registros) => registros.reduce((m, t) => { const em = String(t.atualizadoEm || t.criadoEm || ""); return em && (!m || em > m.em) ? { em, t } : m; }, null);
const textoUltima = (u) => (u ? `${formatarData(u.em, true)}${nomeAutor(u.t, "atualizadoPor") ? ` · ${nomeAutor(u.t, "atualizadoPor")}` : ""}` : "sem registros");
const hostDe = (t) => chaveNumero((t.campos || {})[ID_HOSTNAME] || "");
const ordemMesAno = (a, b) => (mesAnoParaIso(b) || "").localeCompare(mesAnoParaIso(a) || "");

/* ---------- Alertas de consistência (VCORP/VCERT) ---------- */
function alertasDoGrupo(hw, sw) {
  const hostsHw = new Set(hw.registros.map(hostDe).filter(Boolean));
  const hostsSw = new Map();
  sw.registros.forEach((t) => { const h = hostDe(t); if (h) hostsSw.set(h, (hostsSw.get(h) || 0) + 1); });
  const semHardware = [...hostsSw.keys()].filter((h) => !hostsHw.has(h)).sort(COMPARAR).map((h) => ({ host: h, n: hostsSw.get(h) }));
  /* Mesma aplicação com várias versões, no MÊS/ANO mais recente da planilha de Software */
  const meses = [...new Set(sw.registros.map((t) => (t.campos || {})[ID_MES_ANO]).filter((m) => RE_MES_ANO.test(String(m || ""))))].sort(ordemMesAno);
  const ultimoMes = meses[0] || "";
  const porApp = new Map();
  sw.registros.filter((t) => (t.campos || {})[ID_MES_ANO] === ultimoMes).forEach((t) => {
    const nome = String((t.campos || {})[ID_APLICACAO] || "").trim();
    if (!nome) return;
    const k = normalizar(nome);
    if (!porApp.has(k)) porApp.set(k, { nome, versoes: new Map() });
    const v = String((t.campos || {})[ID_VERSAO] || "").trim();
    const a = porApp.get(k);
    if (!a.versoes.has(v)) a.versoes.set(v, new Set());
    a.versoes.get(v).add(hostDe(t));
  });
  const variasVersoes = [...porApp.values()].filter((a) => a.versoes.size > 1).sort((a, b) => b.versoes.size - a.versoes.size || COMPARAR(a.nome, b.nome));
  /* Equipamento com STATUS que encerra (ex.: Baixado) e ainda com software */
  const st = hw.estrutura && hw.estrutura.colunas.find((c) => c.id === ID_STATUS);
  const finais = new Set(st ? st.opcoes.filter((o) => o.final).map((o) => o.id) : ["baixado"]);
  const baixados = hw.registros.filter((t) => finais.has((t.campos || {})[ID_STATUS]) && hostsSw.has(hostDe(t))).map((t) => ({ host: hostDe(t), n: hostsSw.get(hostDe(t)), status: st ? valorTexto(t, st) : "Baixado" }));
  return { semHardware, variasVersoes, baixados, ultimoMes, total: semHardware.length + variasVersoes.length + baixados.length };
}
async function abrirAlertas(grupo = planilhaAtual().grupo) {
  if (!grupo) return;
  const d = criarDialogo({ titulo: `Alertas de consistência · ${GRUPOS_INVENTARIO[grupo]}`, largo: true, corpo: `<div id="alertas-corpo"><p class="apoio">Carregando Hardware e Software…</p></div><div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button></div>` });
  d.showModal();
  const corpo = $("#alertas-corpo", d);
  const desenhar = async (forcar) => {
    corpo.innerHTML = `<p class="apoio">Carregando Hardware e Software…</p>`;
    try {
      const [hw, sw] = await Promise.all([dadosDaPlanilha(`${grupo}-hw`, { forcar }), dadosDaPlanilha(`${grupo}-sw`, { forcar })]);
      const a = alertasDoGrupo(hw, sw);
      const host = (h) => `<button type="button" class="btn-link" data-host="${escapar(h)}">${escapar(h)}</button>`;
      corpo.innerHTML = a.total ? `
        <section class="secao-alerta"><h3>${svg("i-alerta")}HOSTNAME em Software sem cadastro em Hardware <span class="selo">${a.semHardware.length}</span></h3>
          ${a.semHardware.length ? `<ul class="lista-hosts">${a.semHardware.map((x) => `<li>${host(x.host)} <span class="apoio">${x.n} software(s)</span></li>`).join("")}</ul>` : '<p class="apoio">Nenhum.</p>'}</section>
        <section class="secao-alerta"><h3>${svg("i-alerta")}Mesma aplicação com várias versões${a.ultimoMes ? ` em ${escapar(a.ultimoMes)}` : ""} <span class="selo">${a.variasVersoes.length}</span></h3>
          ${a.variasVersoes.length ? `<div class="tabela-admin"><table><thead><tr><th>Aplicação</th><th>Versões (HOSTNAMEs)</th></tr></thead><tbody>${a.variasVersoes.map((x) => `<tr><td><strong>${escapar(x.nome)}</strong></td><td>${[...x.versoes].map(([v, hs]) => `<div><span class="etq">${escapar(v || "(sem versão)")}</span> ${[...hs].slice(0, 12).map(host).join(", ")}${hs.size > 12 ? ` e mais ${hs.size - 12}` : ""}</div>`).join("")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="apoio">Nenhuma.</p>'}</section>
        <section class="secao-alerta"><h3>${svg("i-alerta")}Equipamento baixado ainda com software <span class="selo">${a.baixados.length}</span></h3>
          ${a.baixados.length ? `<ul class="lista-hosts">${a.baixados.map((x) => `<li>${host(x.host)} <span class="apoio">${escapar(x.status)} · ${x.n} software(s)</span></li>`).join("")}</ul>` : '<p class="apoio">Nenhum.</p>'}</section>`
        : `<p class="apoio" style="padding:8px 0">${svg("i-check")} Nenhum alerta em ${GRUPOS_INVENTARIO[grupo]}: todo HOSTNAME de Software tem Hardware, cada aplicação tem uma versão só no último mês e nenhum equipamento baixado tem software.</p>`;
    } catch (e) {
      console.warn(e);
      corpo.innerHTML = `<div class="erro-carregar"><p>Não foi possível carregar os dados de ${GRUPOS_INVENTARIO[grupo]}.</p><button type="button" class="btn btn-secundario btn-mini" data-tentar>Tentar de novo</button></div>`;
    }
  };
  d.addEventListener("click", (e) => {
    const h = e.target.closest("[data-host]");
    if (h) { abrirFichaHostname(h.dataset.host, grupo); return; }
    if (e.target.closest("[data-tentar]")) desenhar(true);
  });
  desenhar(false);
}
$("#btn-alertas").innerHTML = svg("i-alerta") + "Alertas";
$("#btn-alertas").addEventListener("click", () => abrirAlertas());

/* ---------- Ficha do HOSTNAME: o hardware e todos os softwares do mesmo HOSTNAME (e o Inventário de Equipamentos) ---------- */
async function abrirFichaHostname(hostname, grupo = "") {
  const host = chaveNumero(hostname);
  if (!host) return;
  const d = criarDialogo({ titulo: `Ficha do HOSTNAME ${host}`, largo: true, corpo: `<div id="ficha-host-corpo"><p class="apoio">Carregando…</p></div><div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button></div>` });
  d.showModal();
  const corpo = $("#ficha-host-corpo", d);
  const grupos = grupo ? [grupo] : Object.keys(GRUPOS_INVENTARIO);
  const lista = (est, t) => `<dl class="dl-ficha">${(est ? est.colunas.filter((c) => c.ativa) : []).map((c) => { const v = valorTexto(t, c); return v ? `<dt>${escapar(c.nome)}</dt><dd>${escapar(v)}</dd>` : ""; }).join("")}</dl>`;
  const desenhar = async (forcar) => {
    corpo.innerHTML = `<p class="apoio">Carregando…</p>`;
    try {
      const partes = [];
      for (const g of grupos) {
        const [hw, sw] = await Promise.all([dadosDaPlanilha(`${g}-hw`, { forcar }), dadosDaPlanilha(`${g}-sw`, { forcar })]);
        const hws = hw.registros.filter((t) => hostDe(t) === host);
        const sws = sw.registros.filter((t) => hostDe(t) === host).sort((a, b) => ordemMesAno((a.campos || {})[ID_MES_ANO], (b.campos || {})[ID_MES_ANO]) || COMPARAR(String((a.campos || {})[ID_APLICACAO] || ""), String((b.campos || {})[ID_APLICACAO] || "")));
        if (!hws.length && !sws.length && grupos.length > 1) continue;
        const colsSw = sw.estrutura ? sw.estrutura.colunas.filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo) && c.id !== ID_HOSTNAME) : [];
        partes.push(`<section class="ficha-host-grupo"><h3>Inventário ${GRUPOS_INVENTARIO[g]}</h3>
          <h4>${svg("i-tabela")}Hardware ${hws.length ? "" : '<span class="selo">sem cadastro</span>'}<button type="button" class="btn-link" data-abrir-planilha="${g}-hw">Abrir na planilha</button></h4>
          ${hws.map((t) => lista(hw.estrutura, t)).join("") || `<p class="apoio">Nenhum hardware com este HOSTNAME em ${GRUPOS_INVENTARIO[g]}.</p>`}
          <h4>${svg("i-documento")}Software <span class="selo">${sws.length}</span><button type="button" class="btn-link" data-abrir-planilha="${g}-sw">Abrir na planilha</button></h4>
          ${sws.length ? `<div class="tabela-admin"><table><thead><tr>${colsSw.map((c) => `<th>${escapar(c.nome)}</th>`).join("")}</tr></thead><tbody>${sws.map((t) => `<tr>${colsSw.map((c) => `<td>${escapar(valorTexto(t, c))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="apoio">Nenhum software com este HOSTNAME em ${GRUPOS_INVENTARIO[g]}.</p>`}</section>`);
      }
      let eq = null;
      try { eq = await dadosDaPlanilha("inventario", { forcar }); } catch (e) { /* sem acesso ao arquivo: segue sem */ }
      const eqs = eq ? eq.registros.filter((t) => hostDe(t) === host || chaveNumero(t.numero) === host) : [];
      if (eqs.length) partes.push(`<section class="ficha-host-grupo"><h3>Inventário de Equipamentos<button type="button" class="btn-link" data-abrir-planilha="inventario">Abrir na planilha</button></h3>${eqs.map((t) => lista(eq.estrutura, t)).join("")}</section>`);
      corpo.innerHTML = partes.join("") || `<p class="apoio">Nenhum registro com o HOSTNAME ${escapar(host)} nos inventários.</p>`;
    } catch (e) {
      console.warn(e);
      corpo.innerHTML = `<div class="erro-carregar"><p>Não foi possível carregar a ficha.</p><button type="button" class="btn btn-secundario btn-mini" data-tentar>Tentar de novo</button></div>`;
    }
  };
  d.addEventListener("click", (e) => {
    const b = e.target.closest("[data-abrir-planilha]");
    if (b) { d.close(); abrirPlanilhaComBusca(b.dataset.abrirPlanilha, host); return; }
    if (e.target.closest("[data-tentar]")) desenhar(true);
  });
  desenhar(false);
}
/* Abre uma planilha já filtrada por um termo (ex.: o HOSTNAME) */
function abrirPlanilhaComBusca(id, termoBusca) {
  const filtrar = () => { $("#busca").value = termoBusca; estado.busca = termoBusca; renderizarTudo(); };
  if (estado.tela === "planilha" && estado.planilha === id && estado.carregouEquipamentos) { filtrar(); return; }
  estado.aoCarregarPlanilha = filtrar;
  navegar({ tela: "planilha", planilha: id });
}

/* ---------- Comparação mês a mês (Software): entrou, saiu e mudou de versão ---------- */
function abrirComparacao() {
  const pl = planilhaAtual();
  if (pl.tipo !== "sw") return;
  const meses = [...new Set(estado.equipamentos.map((t) => (t.campos || {})[ID_MES_ANO]).filter((m) => RE_MES_ANO.test(String(m || ""))))].sort(ordemMesAno);
  if (meses.length < 2) { mostrarAviso("A comparação precisa de pelo menos dois MÊS/ANO diferentes na planilha."); return; }
  const opcoesMes = (sel) => meses.map((m) => `<option value="${escapar(m)}"${m === sel ? " selected" : ""}>${escapar(m)}</option>`).join("");
  const d = criarDialogo({
    titulo: `Comparar meses · ${nomeCompletoPlanilha(pl)}`, largo: true,
    corpo: `<div class="campos-linha"><label class="campo"><span class="rotulo">De (mês anterior)</span><select name="a">${opcoesMes(meses[1])}</select></label>
      <label class="campo"><span class="rotulo">Para (mês mais novo)</span><select name="b">${opcoesMes(meses[0])}</select></label></div>
      <div id="comparacao-corpo"></div>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button><button type="button" class="btn btn-secundario" data-comparar-csv>${svg("i-download")}Exportar CSV</button></div>`
  });
  const form = d.querySelector("form");
  let resultado = [];
  const agrupar = (mes) => {
    const m = new Map();
    estado.equipamentos.filter((t) => (t.campos || {})[ID_MES_ANO] === mes).forEach((t) => {
      const app = String((t.campos || {})[ID_APLICACAO] || "").trim();
      const k = `${hostDe(t)}|${normalizar(app)}`;
      if (!m.has(k)) m.set(k, { host: hostDe(t), app, versoes: new Set() });
      m.get(k).versoes.add(String((t.campos || {})[ID_VERSAO] || "").trim());
    });
    return m;
  };
  const desenhar = () => {
    const a = form.a.value, b = form.b.value;
    const ma = agrupar(a), mb = agrupar(b);
    const versoes = (x) => [...x.versoes].sort(COMPARAR).join(", ");
    resultado = [];
    mb.forEach((x, k) => { if (!ma.has(k)) resultado.push({ tipo: "Entrou", host: x.host, app: x.app, antes: "", depois: versoes(x) }); });
    ma.forEach((x, k) => { if (!mb.has(k)) resultado.push({ tipo: "Saiu", host: x.host, app: x.app, antes: versoes(x), depois: "" }); });
    ma.forEach((x, k) => { const y = mb.get(k); if (y && versoes(x) !== versoes(y)) resultado.push({ tipo: "Mudou de versão", host: x.host, app: x.app, antes: versoes(x), depois: versoes(y) }); });
    resultado.sort((p, q) => COMPARAR(p.tipo, q.tipo) || COMPARAR(p.host, q.host) || COMPARAR(p.app, q.app));
    const conta = (t) => resultado.filter((r) => r.tipo === t).length;
    $("#comparacao-corpo", d).innerHTML = a === b ? '<p class="apoio">Escolha dois meses diferentes.</p>' : `
      <p class="resumo-comparacao"><span class="etq cor-verde">Entraram ${conta("Entrou")}</span> <span class="etq cor-vermelho">Saíram ${conta("Saiu")}</span> <span class="etq cor-azul">Mudaram de versão ${conta("Mudou de versão")}</span></p>
      ${resultado.length ? `<div class="tabela-admin"><table><thead><tr><th>O que mudou</th><th>HOSTNAME</th><th>Aplicação</th><th>Versão em ${escapar(a)}</th><th>Versão em ${escapar(b)}</th></tr></thead><tbody>${resultado.slice(0, 2000).map((r) => `<tr><td>${escapar(r.tipo)}</td><td>${escapar(r.host)}</td><td>${escapar(r.app)}</td><td>${escapar(r.antes)}</td><td>${escapar(r.depois)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="apoio">Nada mudou entre os dois meses.</p>'}`;
  };
  d.addEventListener("change", desenhar);
  d.querySelector("[data-comparar-csv]").addEventListener("click", () => {
    if (!resultado.length) { mostrarAviso("Nada para exportar."); return; }
    const linhas = [["O que mudou", "HOSTNAME", "Aplicação", `Versão em ${form.a.value}`, `Versão em ${form.b.value}`].map(csvCampo).join(";"), ...resultado.map((r) => [r.tipo, r.host, r.app, r.antes, r.depois].map(csvCampo).join(";")), "", csvCampo(rodapeExportacao())];
    baixarArquivo(nomeArquivoExportacao("comparacao.csv"), "\ufeff" + linhas.join("\r\n"), "text/csv;charset=utf-8");
    registrarAuditoria("exportar", `Exportou a comparação ${form.a.value} × ${form.b.value} de ${nomeCompletoPlanilha(pl)}`);
  });
  desenhar();
  d.showModal();
}
$("#btn-comparar").innerHTML = svg("i-ordenar") + "Comparar meses";
$("#btn-comparar").addEventListener("click", abrirComparacao);

/* ---------- Busca global (Ctrl+K): todos os inventários que a pessoa pode ver ---------- */
const CAMPOS_BUSCA = [ID_HOSTNAME, ID_DNA, ID_SERIE, "patrimonio", ID_APLICACAO, "usuario"];
function abrirBuscaGlobal() {
  if ($("#app").hidden || !estado.usuario) return;
  const d = criarDialogo({
    titulo: "Buscar em todos os inventários",
    corpo: `<label class="campo"><span class="rotulo">HOSTNAME, DNA, Nº de série, patrimônio ou aplicação</span><input name="termo" autocomplete="off" spellcheck="false" placeholder="Ex.: NB-SUP-0123"></label>
      <p class="apoio" id="busca-global-estado" role="status">Carregando os inventários…</p>
      <div class="busca-global" id="busca-global-lista"></div>
      <p class="apoio" style="font-size:12px">Enter abre o primeiro resultado. Atalho: Ctrl+K.</p>`
  });
  const form = d.querySelector("form");
  const lista = $("#busca-global-lista", d), situacao = $("#busca-global-estado", d);
  const dados = new Map();
  let resultados = [];
  const desenhar = () => {
    const termoBusca = normalizar(form.termo.value.trim());
    resultados = [];
    if (termoBusca.length >= 2) {
      PLANILHAS.forEach((pl) => {
        const r = dados.get(pl.id);
        if (!r) return;
        const achados = r.registros.filter((t) => CAMPOS_BUSCA.some((c) => normalizar((t.campos || {})[c]).includes(termoBusca)));
        achados.sort((a, b) => (hostDe(a) === termoBusca.toUpperCase() ? -1 : 0) - (hostDe(b) === termoBusca.toUpperCase() ? -1 : 0));
        if (achados.length) resultados.push({ pl, achados });
      });
    }
    lista.innerHTML = resultados.map(({ pl, achados }) => `<section><h3>${escapar(nomeCompletoPlanilha(pl))} <span class="selo">${achados.length}</span></h3><ul>${achados.slice(0, 8).map((t) => {
      const c = t.campos || {};
      const principal = pl.tipo === "sw" ? `${c[ID_APLICACAO] || ""} ${c[ID_VERSAO] || ""}` : c[ID_HOSTNAME] || c[ID_SERIE] || "(sem HOSTNAME)";
      const extra = pl.tipo === "sw" ? [c[ID_HOSTNAME], c[ID_MES_ANO]] : pl.tipo === "hw" ? [c[ID_SERIE] ? `série ${c[ID_SERIE]}` : "", c.patrimonio ? `patrimônio ${c.patrimonio}` : ""] : [c[ID_DNA] ? `DNA ${c[ID_DNA]}` : "", c.usuario];
      return `<li><button type="button" data-resultado="${escapar(pl.id)}|${escapar(t.id)}"><strong>${escapar(principal)}</strong><span class="apoio">${escapar(extra.filter(Boolean).join(" · "))}</span></button></li>`;
    }).join("")}</ul>${achados.length > 8 ? `<button type="button" class="btn-link" data-ver-todos="${escapar(pl.id)}">Ver os ${achados.length} na planilha</button>` : ""}</section>`).join("")
      || (termoBusca.length >= 2 && dados.size ? '<p class="apoio">Nada encontrado.</p>' : "");
  };
  const abrir = (plId, id) => {
    const pl = planilhaPorId(plId);
    const r = dados.get(plId);
    const t = r && r.registros.find((x) => x.id === id);
    d.close();
    if (!t) return;
    if (estado.tela === "planilha" && estado.planilha === plId && porId(id)) { abrirFicha(id); return; }
    if (pl.grupo && hostDe(t)) { abrirFichaHostname(hostDe(t), pl.grupo); return; }
    estado.aoCarregarPlanilha = () => { if (porId(id)) abrirFicha(id); };
    navegar({ tela: "planilha", planilha: plId });
  };
  form.termo.addEventListener("input", desenhar);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const exato = chaveNumero(form.termo.value);
    const daAtual = resultados.find((r) => r.pl.id === estado.planilha && estado.tela === "planilha");
    const comExato = [daAtual, ...resultados].filter(Boolean).map((r) => ({ r, t: r.achados.find((t) => hostDe(t) === exato || chaveNumero((t.campos || {})[ID_DNA]) === exato) })).find((x) => x.t);
    if (comExato) { abrir(comExato.r.pl.id, comExato.t.id); return; }
    const primeiro = resultados[0];
    if (primeiro) abrir(primeiro.pl.id, primeiro.achados[0].id);
  });
  d.addEventListener("click", (e) => {
    const b = e.target.closest("[data-resultado]");
    if (b) { const [plId, id] = b.dataset.resultado.split("|"); abrir(plId, id); return; }
    const todos = e.target.closest("[data-ver-todos]");
    if (todos) { const termoBusca = form.termo.value.trim(); d.close(); abrirPlanilhaComBusca(todos.dataset.verTodos, termoBusca); }
  });
  d.showModal();
  form.termo.focus();
  Promise.allSettled(PLANILHAS.map((pl) => dadosDaPlanilha(pl.id).then((r) => dados.set(pl.id, r)))).then((rs) => {
    const falhas = rs.filter((r) => r.status === "rejected").length;
    situacao.textContent = falhas ? `${falhas} inventário(s) não puderam ser lidos agora.` : "";
    situacao.hidden = !falhas;
    desenhar();
  });
}

/* ---------- Menu do Gestor ---------- */
async function renderizarMenu({ forcar = false } = {}) {
  const tela = $("#tela-menu");
  const admin = ehAdmin();
  const card = (id, icone, titulo, corpo, acoes) => `<article class="card-inventario" data-card="${id}"><h2>${svg(icone)}${escapar(titulo)}</h2><div class="card-corpo">${corpo}</div><div class="card-acoes">${acoes}</div></article>`;
  const carregando = '<p class="apoio card-carregando">Carregando…</p>';
  const grupoCard = (g) => card(g, "i-tabela", `Inventário ${GRUPOS_INVENTARIO[g]}`, `<div data-stat="${g}">${carregando}</div>`,
    `<button type="button" class="btn btn-mini" data-ir="${g}-hw">${svg("i-tabela")}Hardware</button><button type="button" class="btn btn-mini" data-ir="${g}-sw">${svg("i-documento")}Software</button><button type="button" class="btn btn-secundario btn-mini" data-alertas="${g}" hidden>${svg("i-alerta")}Alertas</button>`);
  tela.innerHTML = `<div class="menu-cabeca"><div><h1 id="menu-titulo" class="titulo-sistema">INVENTÁRIO DE EQUIPAMENTOS</h1><p class="subtitulo-sistema">Inventário e Auditoria</p>
      <p class="apoio">Olá, ${escapar(estado.usuario.nome)}. Escolha o inventário.${!admin ? " Em VCORP e VCERT você vê, busca e exporta; só as administradoras editam." : ""}</p></div>
      <button type="button" class="btn btn-secundario btn-mini" data-menu="atualizar">${svg("i-restaurar")}Atualizar números</button></div>
    <div class="cards-inventario">
      ${card("inventario", "i-tabela", "Inventário de Equipamentos", `<div data-stat="inventario">${carregando}</div>`, `<button type="button" class="btn btn-mini" data-ir="inventario">${svg("i-olho")}Abrir</button>`)}
      ${grupoCard("vcorp")}${grupoCard("vcert")}
      ${admin ? card("importacoes", "i-upload", "Importações pendentes", `<div data-stat="importacoes">${carregando}</div>`, `<button type="button" class="btn btn-mini" data-menu="importacoes">${svg("i-olho")}Abrir</button><button type="button" class="btn btn-secundario btn-mini" data-menu="nova-importacao">${svg("i-mais")}Nova importação</button>`) : ""}
      ${podeVerAuditoria() ? card("auditoria", "i-historico", admin ? "Auditoria" : "Minha atividade", `<p class="apoio">${admin ? "Linha do tempo de todas as ações: quem, quando, onde e o antes e o depois." : "As suas entradas, exportações e edições no Inventário."}</p>`, `<button type="button" class="btn btn-mini" data-menu="auditoria">${svg("i-olho")}Abrir</button>`) : ""}
    </div>
    <section class="painel-inventario" aria-labelledby="painel-titulo"><h2 id="painel-titulo">Painel</h2><div id="painel-conteudo">${carregando}</div></section>`;
  const valores = {};
  const resultados = await Promise.allSettled(PLANILHAS.map((pl) => dadosDaPlanilha(pl.id, { forcar }).then((r) => { valores[pl.id] = r; })));
  if (estado.tela !== "menu" || !tela.isConnected) return;
  const falhou = (id) => resultados[PLANILHAS.findIndex((p) => p.id === id)].status === "rejected";
  const erro = `<div class="erro-carregar"><p>Não foi possível carregar.</p><button type="button" class="btn btn-secundario btn-mini" data-menu="atualizar">Tentar de novo</button></div>`;
  const n = (x) => x.toLocaleString("pt-BR");
  const eq = valores.inventario;
  $('[data-stat="inventario"]', tela).innerHTML = falhou("inventario") ? erro : `<p class="numero-grande">${n(eq.registros.length)} <span>equipamento(s)</span></p><p class="apoio">Última atualização: ${escapar(textoUltima(ultimaAtualizacao(eq.registros)))}</p>`;
  Object.keys(GRUPOS_INVENTARIO).forEach((g) => {
    const caixa = $(`[data-stat="${g}"]`, tela);
    if (falhou(`${g}-hw`) || falhou(`${g}-sw`)) { caixa.innerHTML = erro; return; }
    const hw = valores[`${g}-hw`], sw = valores[`${g}-sw`];
    const u = ultimaAtualizacao([...hw.registros, ...sw.registros]);
    const a = alertasDoGrupo(hw, sw);
    caixa.innerHTML = `<p class="numeros-duplos"><span><strong>${n(hw.registros.length)}</strong> hardware</span><span><strong>${n(sw.registros.length)}</strong> software</span></p>
      <p class="apoio">Última atualização: ${escapar(textoUltima(u))}</p>${a.total ? `<p class="alerta-card">${svg("i-alerta")}${a.total} alerta(s) de consistência</p>` : ""}`;
    const b = $(`[data-alertas="${g}"]`, tela);
    b.hidden = !a.total;
    b.innerHTML = `${svg("i-alerta")}Alertas (${a.total})`;
  });
  if (admin) {
    try {
      const imps = await estado.api.lerColecao(COL_IMPORTACOES, { ordenar: "criadoEm", desc: true, limite: 200 });
      const pendentes = imps.filter((i) => i.status === "pendente");
      const exp = pendentes.filter(expirada).length;
      const caixa = $('[data-stat="importacoes"]', tela);
      if (caixa) caixa.innerHTML = `<p class="numero-grande">${pendentes.length} <span>pendente(s)</span></p>${exp ? `<p class="alerta-card">${svg("i-alerta")}${exp} expirada(s) (mais de ${DIAS_EXPIRAR} dias)</p>` : '<p class="apoio">Documentos aguardando revisão antes de entrar na planilha.</p>'}`;
    } catch (e) { const caixa = $('[data-stat="importacoes"]', tela); if (caixa) caixa.innerHTML = erro; }
  }
  renderizarPainel(valores, falhou);
}
function renderizarPainel(valores, falhou) {
  const caixa = $("#painel-conteudo");
  if (!caixa) return;
  const n = (x) => x.toLocaleString("pt-BR");
  const totais = PLANILHAS.map((pl) => `<tr><td>${escapar(nomeCompletoPlanilha(pl))}</td><td class="num">${falhou(pl.id) ? "—" : n(valores[pl.id].registros.length)}</td></tr>`).join("");
  /* STATUS: Inventário de Equipamentos e Hardware de VCORP/VCERT */
  const porStatus = ["inventario", "vcorp-hw", "vcert-hw"].filter((id) => !falhou(id) && valores[id].estrutura).map((id) => {
    const r = valores[id], st = r.estrutura.colunas.find((c) => c.id === ID_STATUS);
    if (!st) return "";
    const cont = new Map();
    r.registros.forEach((t) => { const v = valorTexto(t, st) || "(sem status)"; cont.set(v, (cont.get(v) || 0) + 1); });
    const total = r.registros.length || 1;
    return `<div class="painel-bloco"><h3>${escapar(nomeCompletoPlanilha(planilhaPorId(id)))}</h3>${cont.size ? [...cont].sort((a, b) => b[1] - a[1]).map(([nome, q]) => `<div class="barra-status"><span>${escapar(nome)}</span><span class="barra"><i style="width:${Math.round((q / total) * 100)}%"></i></span><strong>${n(q)}</strong></div>`).join("") : '<p class="apoio">Sem registros.</p>'}</div>`;
  }).join("");
  /* Top 10 aplicações (VCORP + VCERT), pelo número de HOSTNAMEs */
  const apps = new Map();
  ["vcorp-sw", "vcert-sw"].filter((id) => !falhou(id)).forEach((id) => valores[id].registros.forEach((t) => {
    const nome = String((t.campos || {})[ID_APLICACAO] || "").trim();
    if (!nome) return;
    const k = normalizar(nome);
    if (!apps.has(k)) apps.set(k, { nome, hosts: new Set(), versoes: new Set() });
    apps.get(k).hosts.add(`${id}|${hostDe(t)}`);
    apps.get(k).versoes.add(String((t.campos || {})[ID_VERSAO] || "").trim());
  }));
  const top = [...apps.values()].sort((a, b) => b.hosts.size - a.hosts.size || COMPARAR(a.nome, b.nome)).slice(0, 10);
  caixa.innerHTML = `<div class="painel-grade">
    <div class="painel-bloco"><h3>Total por inventário</h3><div class="tabela-admin"><table><tbody>${totais}</tbody></table></div></div>
    ${porStatus}
    <div class="painel-bloco"><h3>Top 10 aplicações (VCORP + VCERT)</h3>${top.length ? `<div class="tabela-admin"><table><thead><tr><th>Aplicação</th><th class="num">HOSTNAMEs</th><th class="num">Versões</th></tr></thead><tbody>${top.map((a) => `<tr><td>${escapar(a.nome)}</td><td class="num">${n(a.hosts.size)}</td><td class="num">${n(a.versoes.size)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="apoio">Nenhum software cadastrado ainda.</p>'}</div>
  </div>`;
}
$("#tela-menu").addEventListener("click", (e) => {
  const ir = e.target.closest("[data-ir]");
  if (ir) { navegar({ tela: "planilha", planilha: ir.dataset.ir }); return; }
  const al = e.target.closest("[data-alertas]");
  if (al) { abrirAlertas(al.dataset.alertas); return; }
  const m = e.target.closest("[data-menu]");
  if (!m) return;
  if (m.dataset.menu === "atualizar") renderizarMenu({ forcar: true });
  if (m.dataset.menu === "importacoes") navegar({ tela: "importacoes" });
  if (m.dataset.menu === "nova-importacao") abrirNovaImportacao();
  if (m.dataset.menu === "auditoria") navegar({ tela: "auditoria" });
});

/* ---------- Importações (só administradoras): assistente → tabela provisória → aceitar, rejeitar ou desfazer ---------- */
const MARCAS = {
  nova: { nome: "NOVA", cor: "verde" }, alterada: { nome: "ALTERADA", cor: "azul" }, identica: { nome: "IDÊNTICA", cor: "cinza" },
  invalida: { nome: "INVÁLIDA", cor: "vermelho" }, duplicada: { nome: "DUPLICADA", cor: "laranja" }
};
const etiquetaMarca = (m) => `<span class="etq cor-${MARCAS[m].cor}">${MARCAS[m].nome}</span>`;
const expirada = (imp) => imp.status === "pendente" && Date.now() - Date.parse(imp.criadoEm || "") > DIAS_EXPIRAR * DIA_MS;
const podeDesfazerImportacao = (imp) => imp.status === "aceita" && Date.now() - Date.parse(imp.decididoEm || "") < DIAS_DESFAZER * DIA_MS;
function situacaoImportacao(imp) {
  if (expirada(imp)) return { nome: "Expirada", cor: "vermelho" };
  return { pendente: { nome: "Pendente", cor: "amarelo" }, aceita: { nome: "Aceita", cor: "verde" }, rejeitada: { nome: "Rejeitada", cor: "cinza" }, desfeita: { nome: "Desfeita", cor: "roxo" } }[imp.status] || { nome: imp.status || "?", cor: "cinza" };
}
const textoContagens = (c = {}) => [[c.nova, "nova(s)"], [c.alterada, "alterada(s)"], [c.invalida, "inválida(s)"], [c.identica, "idêntica(s)"], [c.duplicada, "duplicada(s)"]].filter(([q]) => q).map(([q, t]) => `${q} ${t}`).join(", ") || "nenhuma linha";
/* Sinônimos para casar o cabeçalho do arquivo com a coluna (o mapeamento salvo por origem vale antes) */
const SINONIMOS_PERFIL = {
  [ID_APLICACAO]: ["nome da aplicacao", "aplicacao", "aplicativo", "software", "programa", "nome do software", "nome do programa", "produto", "application", "name", "display name"],
  [ID_VERSAO]: ["versao", "version", "release", "build", "display version"],
  [ID_HOSTNAME]: ["hostname", "host name", "host", "computador", "nome do computador", "maquina", "nome da maquina", "device", "dispositivo", "estacao", "computer name"],
  [ID_MES_ANO]: ["mes ano", "mes/ano", "mes", "competencia", "data", "data da coleta", "periodo", "referencia", "data do inventario"],
  fabricante: ["fabricante", "fornecedor", "publisher", "editor", "marca", "vendor", "manufacturer"],
  licenca: ["licenca", "license", "chave", "tipo de licenca"],
  [ID_SERIE]: ["numero de serie", "n de serie", "no de serie", "serie", "serial", "serial number", "s n", "sn"],
  patrimonio: ["patrimonio", "asset", "tag", "etiqueta", "numero do patrimonio"],
  tipo: ["tipo", "categoria", "tipo de equipamento"], modelo: ["modelo", "model"],
  processador: ["processador", "cpu", "processor"], memoria: ["memoria", "ram", "memoria ram", "memory"],
  armazenamento: ["armazenamento", "disco", "hd", "ssd", "storage"], sistemaOperacional: ["sistema operacional", "so", "os", "operating system"],
  localizacao: ["localizacao", "local", "site", "unidade", "filial", "setor"], responsavel: ["responsavel", "usuario", "owner", "colaborador"],
  [ID_STATUS]: ["status", "situacao", "estado"], observacao: ["observacao", "observacoes", "obs", "comentario"]
};
const limparCabecalho = (t) => normalizar(t).replace(/[^a-z0-9/]+/g, " ").trim();
function adivinharColunaPerfil(cabecalho, cols) {
  const n = limparCabecalho(cabecalho);
  if (!n) return "";
  const exato = cols.find((c) => limparCabecalho(c.nome) === n || normalizar(c.id) === n.replace(/ /g, ""));
  if (exato) return exato.id;
  const s = Object.entries(SINONIMOS_PERFIL).find(([id, lista]) => cols.some((c) => c.id === id) && lista.some((x) => n === x));
  if (s) return s[0];
  const parcial = Object.entries(SINONIMOS_PERFIL).find(([id, lista]) => cols.some((c) => c.id === id) && lista.some((x) => x.length > 3 && n.includes(x)));
  return parcial ? parcial[0] : "";
}
/* Marca de cada linha contra a planilha de destino: NOVA, ALTERADA (antes e depois), IDÊNTICA, INVÁLIDA (motivo) ou DUPLICADA no arquivo */
function analisarLinhasImportacao(pl, estrutura, registros, dados, mapa) {
  const cols = estrutura.colunas.filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo));
  const colPorId = Object.fromEntries(cols.map((c) => [c.id, c]));
  const existentes = new Map();
  registros.forEach((t) => { const k = chaveDuplicidade(t.campos || {}, pl); if (k && !existentes.has(k)) existentes.set(k, t); });
  const vistos = new Set();
  const igual = (a, b) => String(a == null ? "" : Array.isArray(a) ? a.join(",") : a) === String(b == null ? "" : Array.isArray(b) ? b.join(",") : b);
  return dados.map((l, idx) => {
    const campos = {}, motivos = [];
    mapa.forEach((cid, i) => {
      const col = colPorId[cid];
      if (!col) return;
      const bruto = l[i] == null ? "" : String(l[i]).replace(/\s+/g, " ").trim();
      if (!bruto) return;
      const r = validarValor(col, bruto);
      if (r.ok) { if (!estaVazio(r.valor)) campos[cid] = r.valor; } else motivos.push(r.erro);
    });
    cols.forEach((c) => { if (c.obrigatoria && estaVazio(campos[c.id]) && !motivos.some((m) => m.startsWith(c.nome))) motivos.push(`${c.nome} vazio.`); });
    const k = chaveDuplicidade(campos, pl);
    if (!motivos.length && !k) motivos.push(pl.tipo === "hw" ? "Sem Nº DE SÉRIE nem HOSTNAME para identificar o equipamento." : "Faltam campos da chave.");
    let marca, existente = null, antes = null;
    if (motivos.length) marca = "invalida";
    else if (vistos.has(k)) { marca = "duplicada"; motivos.push("Repetida no próprio arquivo (mesma chave de uma linha anterior)."); }
    else {
      vistos.add(k);
      existente = existentes.get(k) || null;
      if (!existente) marca = "nova";
      else {
        const dif = Object.keys(campos).filter((c) => !igual((existente.campos || {})[c], campos[c]));
        if (!dif.length) marca = "identica";
        else { marca = "alterada"; antes = Object.fromEntries(dif.map((c) => [c, (existente.campos || {})[c] ?? ""])); }
      }
    }
    return { n: idx + 1, dados: campos, marca, motivo: motivos.join(" ").slice(0, 500), idDestino: existente ? existente.id : "", antes, bruto: l.slice(0, 60).map((x) => String(x == null ? "" : x).slice(0, 200)) };
  });
}
const contarMarcas = (linhas) => Object.fromEntries(Object.keys(MARCAS).map((m) => [m, linhas.filter((l) => l.marca === m).length]));
const destinosImportacao = () => PLANILHAS.filter((p) => p.grupo);

function abrirNovaImportacao() {
  if (!ehAdmin() || !conectado()) { mostrarAviso(conectado() ? "Importações: só as administradoras." : "Sem conexão: tente quando a internet voltar."); return; }
  const d = criarDialogo({
    titulo: "Nova importação", largo: true,
    corpo: `<ol class="passos-importacao" aria-label="Etapas"><li data-passo="1" aria-current="step">Destino e arquivo</li><li data-passo="2">Colunas</li><li data-passo="3">Conferência</li></ol>
      <div id="imp-etapa"></div>
      <p class="form-erro" role="alert" id="imp-erro"></p>
      <p class="apoio" id="imp-progresso" role="status"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="button" class="btn btn-secundario" id="imp-voltar" hidden>Voltar</button><button type="button" class="btn" id="imp-avancar">Próximo</button></div>`
  });
  const etapa = $("#imp-etapa", d), erro = $("#imp-erro", d), progresso = $("#imp-progresso", d);
  const btnAvancar = $("#imp-avancar", d), btnVoltar = $("#imp-voltar", d);
  const s = { passo: 1, destino: "", origem: "", arquivo: null, cabecalho: true, tabela: null, titulos: [], dados: [], mapa: [], estrutura: null, registros: [], salvarMapa: true, linhas: null, mapeamentos: [] };
  estado.api.lerColecao(COL_MAPEAMENTOS).then((l) => { s.mapeamentos = l; const dl = $("#imp-origens", d); if (dl) dl.innerHTML = [...new Set(l.map((m) => m.origem).filter(Boolean))].map((o) => `<option value="${escapar(o)}"></option>`).join(""); }).catch(() => {});
  const marcarPasso = () => $$("[data-passo]", d).forEach((li) => { if (Number(li.dataset.passo) === s.passo) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current"); });
  const pl = () => planilhaPorId(s.destino);
  const desenhar = () => {
    erro.textContent = ""; progresso.textContent = "";
    marcarPasso();
    btnVoltar.hidden = s.passo === 1;
    if (s.passo === 1) {
      btnAvancar.textContent = "Próximo";
      etapa.innerHTML = `<fieldset class="destinos"><legend class="rotulo">1. Para onde vai</legend>${destinosImportacao().map((p) => `<label class="check"><input type="radio" name="destino" value="${p.id}"${s.destino === p.id ? " checked" : ""}> ${escapar(nomeCompletoPlanilha(p))}</label>`).join("")}</fieldset>
        <div class="campos-linha">
          <label class="campo"><span class="rotulo">2. Origem (nome do site de onde veio)</span><input name="origem" maxlength="60" list="imp-origens" value="${escapar(s.origem)}" placeholder="Ex.: SCCM, GLPI, VCertAR" required><datalist id="imp-origens"></datalist><span class="ajuda">O mapeamento de colunas fica salvo por origem.</span></label>
          <label class="campo"><span class="rotulo">3. Arquivo (CSV, XLSX ou ODS, até 10 MB)</span><input type="file" name="arquivo" accept=".csv,.txt,.xlsx,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet">
            <label class="check" style="margin-top:6px"><input type="checkbox" name="cabecalho"${s.cabecalho ? " checked" : ""}> A primeira linha é o cabeçalho</label></label>
        </div>
        <p class="apoio" style="font-size:13px">Nada entra na planilha agora: as linhas vão para uma tabela provisória, com a marca de cada uma, para você aceitar ou rejeitar.</p>`;
      if (s.arquivo) $("[name=arquivo]", etapa).insertAdjacentHTML("afterend", `<span class="ajuda">Escolhido: ${escapar(s.arquivo.name)}</span>`);
    } else if (s.passo === 2) {
      btnAvancar.textContent = "Conferir";
      const cols = s.estrutura.colunas.filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo));
      const obrig = pl().tipo === "sw" ? COLUNAS_FIXAS_SW.map((c) => c.nome).join(", ") : "HOSTNAME ou Nº DE SÉRIE";
      etapa.innerHTML = `<p class="apoio">${escapar(s.arquivo.name)} · ${s.dados.length} linha(s) · destino <strong>${escapar(nomeCompletoPlanilha(pl()))}</strong>. Confira para qual coluna vai cada coluna do arquivo (obrigatórias: ${escapar(obrig)}).</p>
        <div class="mapa-colunas">${s.titulos.map((t, i) => `<label><span>${escapar(t || `(coluna ${i + 1})`)} <span class="apoio">ex.: ${escapar(String((s.dados[0] || [])[i] ?? "").slice(0, 30))}</span></span>
          <select data-mapa="${i}"><option value="">Ignorar</option>${cols.map((c) => `<option value="${escapar(c.id)}"${s.mapa[i] === c.id ? " selected" : ""}>${escapar(c.nome)}</option>`).join("")}</select></label>`).join("")}</div>
        <label class="check" style="margin-top:8px"><input type="checkbox" name="salvar-mapa"${s.salvarMapa ? " checked" : ""}> Salvar este mapeamento para a origem “${escapar(s.origem)}”</label>`;
    } else {
      btnAvancar.textContent = "Criar tabela provisória";
      const c = contarMarcas(s.linhas);
      const cols = s.mapa.filter(Boolean).map((id) => s.estrutura.colunas.find((x) => x.id === id)).filter(Boolean);
      etapa.innerHTML = `<p class="resumo-importacao">${Object.keys(MARCAS).map((m) => `${etiquetaMarca(m)} <strong>${c[m]}</strong>`).join(" ")}</p>
        <p class="apoio">${escapar(textoContagens(c))}. Prévia das primeiras 30 linhas:</p>
        <div class="previa-import"><table><thead><tr><th>#</th><th>Marca</th>${cols.map((x) => `<th>${escapar(x.nome)}</th>`).join("")}<th>Motivo / mudança</th></tr></thead><tbody>${s.linhas.slice(0, 30).map((l) => `<tr class="marca-${l.marca}"><td>${l.n}</td><td>${etiquetaMarca(l.marca)}</td>${cols.map((x) => `<td>${escapar(textoDoValorCol(x, l.dados[x.id]))}</td>`).join("")}<td>${escapar(l.marca === "alterada" ? Object.entries(l.antes).map(([k, v]) => `${(s.estrutura.colunas.find((x) => x.id === k) || { nome: k }).nome}: ${textoDoValorCol(s.estrutura.colunas.find((x) => x.id === k), v) || "(vazio)"} → ${textoDoValorCol(s.estrutura.colunas.find((x) => x.id === k), l.dados[k])}`).join(" · ") : l.motivo)}</td></tr>`).join("")}</tbody></table></div>`;
    }
  };
  d.addEventListener("change", (e) => {
    if (e.target.name === "destino") s.destino = e.target.value;
    if (e.target.name === "origem") s.origem = e.target.value.trim();
    if (e.target.name === "cabecalho") s.cabecalho = e.target.checked;
    if (e.target.name === "arquivo") s.arquivo = e.target.files[0] || null;
    if (e.target.name === "salvar-mapa") s.salvarMapa = e.target.checked;
    if (e.target.matches("[data-mapa]")) s.mapa[Number(e.target.dataset.mapa)] = e.target.value;
  });
  d.addEventListener("input", (e) => { if (e.target.name === "origem") s.origem = e.target.value.trim(); });
  btnVoltar.addEventListener("click", () => { s.passo = Math.max(1, s.passo - 1); desenhar(); });
  btnAvancar.addEventListener("click", async () => {
    erro.textContent = "";
    if (s.passo === 1) {
      if (!s.destino) { erro.textContent = "Escolha para onde vai (VCORP ou VCERT, Hardware ou Software)."; return; }
      if (!s.origem) { erro.textContent = "Informe a origem (o nome do site de onde veio o documento)."; return; }
      if (!s.arquivo) { erro.textContent = "Escolha o arquivo."; return; }
      if (s.arquivo.size > TAMANHO_MAXIMO_ARQUIVO) { erro.textContent = "Arquivo grande demais (máximo de 10 MB)."; return; }
      btnAvancar.disabled = true;
      try {
        progresso.textContent = "Lendo o arquivo…";
        const lido = await lerArquivoTabela(s.arquivo, lerTabelaTexto);
        const linhas = lido.linhas.filter((l) => l.some((x) => String(x ?? "").trim()));
        if (!linhas.length) throw new Error("O arquivo está vazio.");
        s.titulos = s.cabecalho ? linhas[0].map((x) => String(x ?? "").trim()) : linhas[0].map((_, i) => `Coluna ${i + 1}`);
        s.dados = s.cabecalho ? linhas.slice(1) : linhas;
        if (!s.dados.length) throw new Error("O arquivo só tem o cabeçalho.");
        if (s.dados.length > MAX_LINHAS_IMPORTACAO) throw new Error(`O arquivo tem ${s.dados.length} linhas: importe no máximo ${MAX_LINHAS_IMPORTACAO} por vez (divida o arquivo).`);
        s.formato = lido.formato;
        progresso.textContent = "Lendo a planilha de destino…";
        let dest = await dadosDaPlanilha(s.destino, { forcar: true });
        if (!dest.estrutura) {
          progresso.textContent = "Criando a estrutura da planilha de destino…";
          if (!(await criarEstruturaInicial(pl()))) throw new Error("Não foi possível criar a estrutura da planilha de destino.");
          dest = await dadosDaPlanilha(s.destino, { forcar: true });
        }
        s.estrutura = dest.estrutura;
        s.registros = dest.registros;
        const cols = s.estrutura.colunas.filter((c) => c.ativa && !TIPOS_SEM_EDICAO.includes(c.tipo));
        const salvo = s.mapeamentos.find((m) => m.id === `${slug(s.origem, 40)}-${pl().tipo}`);
        const usados = new Set();
        s.mapa = s.titulos.map((t) => {
          const k = salvo && salvo.mapa ? salvo.mapa[limparCabecalho(t)] : undefined;
          const id = k !== undefined ? k : adivinharColunaPerfil(t, cols);
          if (id && cols.some((c) => c.id === id) && !usados.has(id)) { usados.add(id); return id; }
          return "";
        });
        s.passo = 2;
        desenhar();
      } catch (e) { console.warn(e); erro.textContent = e.message || "Não foi possível ler o arquivo."; progresso.textContent = ""; }
      finally { btnAvancar.disabled = false; }
      return;
    }
    if (s.passo === 2) {
      const usados = s.mapa.filter(Boolean);
      if (new Set(usados).size !== usados.length) { erro.textContent = "Duas colunas do arquivo foram para a mesma coluna: ajuste o mapeamento."; return; }
      if (pl().tipo === "sw") {
        const faltam = COLUNAS_FIXAS_SW.filter((c) => !usados.includes(c.id)).map((c) => c.nome);
        if (faltam.length) { erro.textContent = `Ligue as colunas obrigatórias: ${faltam.join(", ")}.`; return; }
      } else if (!usados.includes(ID_HOSTNAME) && !usados.includes(ID_SERIE)) { erro.textContent = "Ligue pelo menos HOSTNAME ou Nº DE SÉRIE."; return; }
      s.linhas = analisarLinhasImportacao(pl(), s.estrutura, s.registros, s.dados, s.mapa);
      s.passo = 3;
      desenhar();
      return;
    }
    /* Passo 3: grava a tabela provisória */
    btnAvancar.disabled = true;
    try {
      const c = contarMarcas(s.linhas);
      const id = estado.api.novoId(COL_IMPORTACOES);
      const colunas = s.mapa.filter(Boolean);
      const ops = [{ op: "set", caminho: `${COL_IMPORTACOES}/${id}`, dados: {
        destino: s.destino, origem: s.origem.slice(0, 60), arquivoNome: String(s.arquivo.name).slice(0, 200), formato: s.formato || "", status: "pendente",
        contagens: { ...c, total: s.linhas.length }, colunas, mapeamento: Object.fromEntries(s.titulos.map((t, i) => [limparCabecalho(t) || `coluna ${i + 1}`, s.mapa[i] || ""]).slice(0, 200)),
        criadoPor: estado.usuario.email, criadoPorNome: estado.usuario.nome, criadoEm: "__AGORA__",
        decididoPor: "", decididoPorNome: "", decididoEm: null, motivo: "", idsGravados: []
      } }];
      s.linhas.forEach((l) => ops.push({ op: "set", caminho: `${COL_IMPORTACOES}/${id}/linhas/${String(l.n).padStart(5, "0")}`, dados: { n: l.n, dados: l.dados, marca: l.marca, motivo: l.motivo, idDestino: l.idDestino, antes: l.antes || null, bruto: l.bruto } }));
      if (s.salvarMapa) {
        ops.push({ op: "set", caminho: `${COL_MAPEAMENTOS}/${slug(s.origem, 40)}-${pl().tipo}`, dados: {
          origem: s.origem.slice(0, 60), tipo: pl().tipo, mapa: Object.fromEntries(s.titulos.map((t, i) => [limparCabecalho(t), s.mapa[i] || ""]).filter(([t]) => t).slice(0, 200)),
          atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email
        } });
      }
      progresso.textContent = `Gravando a tabela provisória (${s.linhas.length} linha(s))…`;
      await estado.api.lote(ops);
      registrarAuditoria("importar", `Criou a tabela provisória de ${s.arquivo.name} (origem ${s.origem}) para ${nomeCompletoPlanilha(pl())}: ${textoContagens(c)}`, `Arquivo ${s.formato || ""}; ${s.linhas.length} linha(s)`, { planilha: s.destino, alvo: id });
      d.close();
      mostrarAviso("Tabela provisória criada. Revise e aceite ou rejeite.", 5000);
      navegar({ tela: "importacoes", id });
    } catch (e) { console.error(e); erro.textContent = mensagemErro(e); progresso.textContent = ""; btnAvancar.disabled = false; }
  });
  desenhar();
  d.showModal();
}
/* Texto de um valor numa coluna de outra planilha (sem depender da planilha aberta) */
const textoDoValorCol = (col, v) => (col ? valorTexto({ campos: { [col.id]: v } }, col) : String(v == null ? "" : v));

function renderizarImportacoes(idRevisao) {
  if (idRevisao) { renderizarRevisao(idRevisao); return; }
  const tela = $("#tela-importacoes");
  let filtro = "pendente", lista = null, falhou = false;
  tela.innerHTML = `<div class="menu-cabeca"><div><h1 id="importacoes-titulo">Importações</h1><p class="apoio">Documentos prontos vindos de outros sites entram numa tabela provisória. Nada vai para a planilha antes de você aceitar. Pendências com mais de ${DIAS_EXPIRAR} dias aparecem como expiradas.</p></div>
      <button type="button" class="btn" data-imp="nova">${svg("i-mais")}Nova importação</button></div>
    <div class="abas-dialogo" role="tablist" aria-label="Situação">${[["pendente", "Pendentes"], ["aceita", "Aceitas"], ["rejeitada", "Rejeitadas"], ["todas", "Todas"]].map(([id, nome]) => `<button type="button" role="tab" data-filtro-imp="${id}">${nome}</button>`).join("")}</div>
    <div id="lista-importacoes"><p class="apoio">Carregando…</p></div>`;
  const desenhar = () => {
    $$("[data-filtro-imp]", tela).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.filtroImp === filtro)));
    const caixa = $("#lista-importacoes", tela);
    if (falhou) { caixa.innerHTML = `<div class="erro-carregar"><p>Não foi possível carregar as importações.</p><button type="button" class="btn btn-secundario btn-mini" data-imp="tentar">Tentar de novo</button></div>`; return; }
    if (!lista) return;
    const vis = lista.filter((i) => filtro === "todas" || i.status === filtro || (filtro === "aceita" && i.status === "desfeita"));
    caixa.innerHTML = vis.length ? `<div class="tabela-admin"><table><thead><tr><th>Criada em</th><th>Destino</th><th>Origem</th><th>Arquivo</th><th>Situação</th><th>Linhas</th><th>Por</th><th></th></tr></thead><tbody>${vis.map((i) => {
      const s = situacaoImportacao(i), p = planilhaPorId(i.destino);
      return `<tr class="${expirada(i) ? "expirada" : ""}"><td>${escapar(formatarData(i.criadoEm, true))}</td><td>${escapar(p ? nomeCompletoPlanilha(p) : i.destino)}</td><td>${escapar(i.origem)}</td><td style="overflow-wrap:anywhere">${escapar(i.arquivoNome)}</td>
        <td><span class="etq cor-${s.cor}">${escapar(s.nome)}</span>${i.status === "rejeitada" && i.motivo ? `<div class="apoio" style="font-size:12px">${escapar(i.motivo)}</div>` : ""}</td>
        <td style="font-size:12px">${escapar(textoContagens(i.contagens))}</td><td>${escapar(i.criadoPorNome || nomePessoa(i.criadoPor))}</td>
        <td class="acoes-tab"><button type="button" class="btn btn-secundario btn-mini" data-revisar="${escapar(i.id)}">${i.status === "pendente" ? "Revisar" : "Ver"}</button>${podeDesfazerImportacao(i) ? `<button type="button" class="btn btn-perigo btn-mini" data-desfazer-imp="${escapar(i.id)}">Desfazer</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="apoio vazio-tela">${filtro === "pendente" ? "Nenhuma importação pendente." : "Nenhuma importação aqui."}</p>`;
  };
  const ouvir = () => {
    falhou = false;
    estado.pararTela = estado.api.ouvirColecao(COL_IMPORTACOES, (l) => { lista = l.map((x) => ({ ...x, criadoEm: x.criadoEm || "" })); desenhar(); }, (e) => { console.warn(e); falhou = true; desenhar(); }, { ordenar: "criadoEm", desc: true, limite: 300 });
  };
  tela.onclick = (e) => {
    const f = e.target.closest("[data-filtro-imp]");
    if (f) { filtro = f.dataset.filtroImp; desenhar(); return; }
    const b = e.target.closest("[data-imp]");
    if (b && b.dataset.imp === "nova") abrirNovaImportacao();
    if (b && b.dataset.imp === "tentar") ouvir();
    const r = e.target.closest("[data-revisar]");
    if (r) navegar({ tela: "importacoes", id: r.dataset.revisar });
    const dz = e.target.closest("[data-desfazer-imp]");
    if (dz && lista) { const imp = lista.find((x) => x.id === dz.dataset.desfazerImp); if (imp) desfazerImportacao(imp); }
  };
  ouvir();
}

async function renderizarRevisao(id) {
  const tela = $("#tela-importacoes");
  tela.innerHTML = `<p class="apoio">Carregando a importação…</p>`;
  let imp = null, linhas = [], estrutura = null, filtro = "todas";
  const selecionadas = new Set();
  const carregar = async () => {
    try {
      imp = await estado.api.lerDoc(`${COL_IMPORTACOES}/${id}`);
      if (!imp) { tela.innerHTML = `<div class="erro-carregar"><p>Importação não encontrada.</p><button type="button" class="btn btn-secundario btn-mini" data-voltar-lista>Ver as importações</button></div>`; return; }
      imp.id = id;
      const p = planilhaPorId(imp.destino);
      const [ls, dest] = await Promise.all([estado.api.lerColecao(`${COL_IMPORTACOES}/${id}/linhas`, { ordenar: "n", limite: MAX_LINHAS_IMPORTACAO + 10 }), dadosDaPlanilha(p.id)]);
      linhas = ls;
      estrutura = dest.estrutura;
      desenhar();
    } catch (e) {
      console.warn(e);
      tela.innerHTML = `<div class="erro-carregar"><p>Não foi possível carregar a importação.</p><button type="button" class="btn btn-secundario btn-mini" data-tentar-rev>Tentar de novo</button></div>`;
    }
  };
  const colDe = (cid) => (estrutura ? estrutura.colunas.find((c) => c.id === cid) : null) || { id: cid, nome: cid, tipo: "texto", opcoes: [] };
  const selecionaveis = () => linhas.filter((l) => l.marca === "nova" || l.marca === "alterada");
  const desenhar = () => {
    const p = planilhaPorId(imp.destino);
    const s = situacaoImportacao(imp);
    const c = imp.contagens || contarMarcas(linhas);
    const cols = (imp.colunas || []).map(colDe);
    const pendente = imp.status === "pendente";
    const vis = linhas.filter((l) => filtro === "todas" || l.marca === filtro);
    tela.innerHTML = `<div class="menu-cabeca"><div><h1 id="importacoes-titulo">Revisão da importação</h1>
        <p class="apoio"><strong>${escapar(imp.arquivoNome)}</strong> · origem ${escapar(imp.origem)} · destino <strong>${escapar(nomeCompletoPlanilha(p))}</strong> · criada por ${escapar(imp.criadoPorNome || imp.criadoPor)} em ${escapar(formatarData(imp.criadoEm, true))} <span class="etq cor-${s.cor}">${escapar(s.nome)}</span></p>
        ${expirada(imp) ? `<p class="aviso-repetido">${svg("i-alerta")} Esta importação está pendente há mais de ${DIAS_EXPIRAR} dias (expirada). Os dados podem ter mudado desde então: ao aceitar, cada linha é conferida de novo com a planilha atual.</p>` : ""}
        ${imp.status === "rejeitada" ? `<p class="aviso-exclusao">Rejeitada por ${escapar(imp.decididoPorNome || imp.decididoPor)} em ${escapar(formatarData(imp.decididoEm, true))}: ${escapar(imp.motivo)}. As linhas provisórias foram apagadas.</p>` : ""}
        ${imp.status === "aceita" || imp.status === "desfeita" ? `<p class="apoio">${imp.status === "aceita" ? "Aceita" : "Aceita e depois desfeita"} por ${escapar(imp.decididoPorNome || imp.decididoPor)} em ${escapar(formatarData(imp.decididoEm, true))}: ${escapar(String((imp.idsGravados || []).length))} nova(s) e ${escapar(String(imp.alteradasGravadas || 0))} alterada(s) gravadas.${imp.status === "desfeita" ? ` Desfeita em ${escapar(formatarData(imp.desfeitoEm, true))}.` : ""}</p>` : ""}</div></div>
      <p class="resumo-importacao" aria-label="Resumo">${Object.keys(MARCAS).map((m) => `<button type="button" class="filtro-marca" data-filtro-marca="${m}" aria-pressed="${filtro === m}">${etiquetaMarca(m)} <strong>${c[m] || 0}</strong></button>`).join("")}<button type="button" class="filtro-marca" data-filtro-marca="todas" aria-pressed="${filtro === "todas"}">Todas <strong>${linhas.length}</strong></button></p>
      <p class="apoio">${escapar(textoContagens(c))}.</p>
      ${pendente ? `<div class="form-botoes" style="justify-content:flex-start">
        <button type="button" class="btn" data-rev="aceitar-tudo"${selecionaveis().length ? "" : " disabled"}>${svg("i-check")}Aceitar tudo (${selecionaveis().length})</button>
        <button type="button" class="btn btn-secundario" data-rev="aceitar-sel"${selecionadas.size ? "" : " disabled"}>${svg("i-check")}Aceitar selecionadas (${selecionadas.size})</button>
        <button type="button" class="btn btn-perigo" data-rev="rejeitar">${svg("i-fechar")}Rejeitar…</button></div>` : ""}
      ${podeDesfazerImportacao(imp) ? `<div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-perigo" data-rev="desfazer">${svg("i-desfazer")}Desfazer importação</button><span class="apoio">Possível até ${escapar(formatarData(Date.parse(imp.decididoEm) + DIAS_DESFAZER * DIA_MS, true))}.</span></div>` : ""}
      ${linhas.length ? `<div class="previa-import revisao"><table><thead><tr>${pendente ? `<th><input type="checkbox" data-sel-todas aria-label="Selecionar todas as novas e alteradas visíveis"></th>` : ""}<th>#</th><th>Marca</th>${cols.map((x) => `<th>${escapar(x.nome)}</th>`).join("")}<th>Motivo / mudança</th></tr></thead><tbody>${vis.slice(0, 2000).map((l) => {
        const sel = l.marca === "nova" || l.marca === "alterada";
        return `<tr class="marca-${l.marca}">${pendente ? `<td>${sel ? `<input type="checkbox" data-sel-linha="${escapar(l.id)}"${selecionadas.has(l.id) ? " checked" : ""} aria-label="Selecionar a linha ${l.n}">` : ""}</td>` : ""}<td>${l.n}</td><td>${etiquetaMarca(l.marca)}</td>
          ${cols.map((x) => { const novo = textoDoValorCol(x, (l.dados || {})[x.id]); const mudou = l.marca === "alterada" && l.antes && x.id in l.antes; return `<td>${mudou ? `<del>${escapar(textoDoValorCol(x, l.antes[x.id]) || "(vazio)")}</del> → <ins>${escapar(novo)}</ins>` : escapar(novo)}</td>`; }).join("")}
          <td style="font-size:12px">${escapar(l.marca === "alterada" ? `${Object.keys(l.antes || {}).length} campo(s) mudam` : l.motivo || "")}</td></tr>`;
      }).join("")}</tbody></table>${vis.length > 2000 ? `<p class="apoio">Mostrando 2.000 de ${vis.length} linhas.</p>` : ""}</div>` : `<p class="apoio vazio-tela">${imp.status === "rejeitada" ? "As linhas provisórias foram apagadas na rejeição." : "Sem linhas."}</p>`}`;
  };
  tela.onclick = async (e) => {
    if (e.target.closest("[data-voltar-lista]")) { navegar({ tela: "importacoes" }); return; }
    if (e.target.closest("[data-tentar-rev]")) { carregar(); return; }
    const fm = e.target.closest("[data-filtro-marca]");
    if (fm) { filtro = filtro === fm.dataset.filtroMarca ? "todas" : fm.dataset.filtroMarca; desenhar(); return; }
    const sl = e.target.closest("[data-sel-linha]");
    if (sl) { if (sl.checked) selecionadas.add(sl.dataset.selLinha); else selecionadas.delete(sl.dataset.selLinha); desenhar(); return; }
    const st = e.target.closest("[data-sel-todas]");
    if (st) { linhas.filter((l) => (filtro === "todas" || l.marca === filtro) && (l.marca === "nova" || l.marca === "alterada")).forEach((l) => { if (st.checked) selecionadas.add(l.id); else selecionadas.delete(l.id); }); desenhar(); return; }
    const b = e.target.closest("[data-rev]");
    if (!b || !imp) return;
    b.disabled = true;
    try {
      if (b.dataset.rev === "aceitar-tudo") { if (await aceitarImportacao(imp, selecionaveis())) await carregar(); }
      if (b.dataset.rev === "aceitar-sel") { if (await aceitarImportacao(imp, linhas.filter((l) => selecionadas.has(l.id)))) { selecionadas.clear(); await carregar(); } }
      if (b.dataset.rev === "rejeitar") { if (await rejeitarImportacao(imp, linhas)) await carregar(); }
      if (b.dataset.rev === "desfazer") { if (await desfazerImportacao(imp)) await carregar(); }
    } finally { if (b.isConnected) b.disabled = false; }
  };
  carregar();
}
/* Grava na planilha definitiva em lotes atômicos (≤ 400 escritas). Cada linha é conferida de novo com a planilha atual. */
async function aceitarImportacao(imp, escolhidas) {
  const p = planilhaPorId(imp.destino);
  if (!escolhidas.length) { mostrarAviso("Nenhuma linha nova ou alterada para gravar."); return false; }
  const nN = escolhidas.filter((l) => l.marca === "nova").length, nA = escolhidas.length - nN;
  if (!(await confirmar(`Gravar ${escolhidas.length} linha(s) em ${nomeCompletoPlanilha(p)} (${nN} nova(s), ${nA} alterada(s))? Dá para desfazer em até ${DIAS_DESFAZER} dias.`, { titulo: "Aceitar importação", botao: "Aceitar e gravar" }))) return false;
  try {
    const { registros, estrutura } = await dadosDaPlanilha(p.id, { forcar: true });
    const porIdDest = new Map(registros.map((t) => [t.id, t]));
    const porChave = new Map();
    registros.forEach((t) => { const k = chaveDuplicidade(t.campos || {}, p); if (k && !porChave.has(k)) porChave.set(k, t); });
    const colNome = (cid) => ((estrutura && estrutura.colunas.find((c) => c.id === cid)) || { nome: cid }).nome;
    const colObj = (cid) => (estrutura && estrutura.colunas.find((c) => c.id === cid)) || null;
    const ops = [], criados = [];
    let alteradas = 0, ignoradas = 0;
    const historico = (rid, cid, antes, depois) => {
      const hid = estado.api.novoId(`${p.prefixo}/${rid}/historico`);
      return { op: "set", caminho: `${p.prefixo}/${rid}/historico/${hid}`, dados: { acao: "importar", coluna: cid, colunaNome: String(colNome(cid)).slice(0, 60), antes: texto500(textoDoValorCol(colObj(cid), antes)), depois: texto500(textoDoValorCol(colObj(cid), depois)), ...autoria("por"), em: "__AGORA__" } };
    };
    for (const l of escolhidas) {
      const k = chaveDuplicidade(l.dados || {}, p);
      const atual = (l.idDestino && porIdDest.get(l.idDestino)) || (k && porChave.get(k)) || null;
      if (!atual) {
        const rid = estado.api.novoId(p.prefixo);
        criados.push(rid);
        if (k) porChave.set(k, { id: rid, campos: l.dados });
        ops.push({ op: "set", caminho: `${p.prefixo}/${rid}`, dados: { campos: l.dados, ...autoria("criadoPor"), criadoEm: "__AGORA__", ...assinatura(), exclusao: null, importacao: imp.id } });
        ops.push({ op: "set", caminho: `${COL_IMPORTACOES}/${imp.id}/linhas/${l.id}`, mesclar: true, dados: { aplicada: "nova", idDestino: rid } });
        continue;
      }
      const mud = {}, antes = {};
      Object.keys(l.dados || {}).forEach((cid) => { const a = (atual.campos || {})[cid]; if (String(a == null ? "" : a) !== String(l.dados[cid] == null ? "" : l.dados[cid])) { mud[cid] = l.dados[cid]; antes[cid] = a == null ? "" : a; } });
      if (!Object.keys(mud).length) { ignoradas++; continue; }
      alteradas++;
      ops.push({ op: "set", caminho: `${p.prefixo}/${atual.id}`, mesclar: true, dados: { campos: mud, ...assinatura(), importacao: imp.id } });
      Object.keys(mud).forEach((cid) => ops.push(historico(atual.id, cid, antes[cid], mud[cid])));
      ops.push({ op: "set", caminho: `${COL_IMPORTACOES}/${imp.id}/linhas/${l.id}`, mesclar: true, dados: { aplicada: "alterada", idDestino: atual.id, antesAplicado: antes, depoisAplicado: mud } });
    }
    ops.push({ op: "set", caminho: `${COL_IMPORTACOES}/${imp.id}`, mesclar: true, dados: { status: "aceita", decididoPor: estado.usuario.email, decididoPorNome: estado.usuario.nome, decididoEm: "__AGORA__", idsGravados: criados, alteradasGravadas: alteradas, ignoradas } });
    mostrarAviso(`Gravando ${criados.length + alteradas} linha(s)…`, 8000);
    await estado.api.lote(ops);
    cacheDados.delete(p.id);
    registrarAuditoria("aceitar", `Aceitou a importação de ${imp.arquivoNome} (origem ${imp.origem}) em ${nomeCompletoPlanilha(p)}: ${criados.length} nova(s), ${alteradas} alterada(s)${ignoradas ? `, ${ignoradas} já igual(is)` : ""}`, `Linhas escolhidas: ${escolhidas.length}`, { planilha: p.id, alvo: imp.id });
    mostrarAviso(`Importação aceita: ${criados.length} nova(s) e ${alteradas} alterada(s) gravadas.`, 6000);
    return true;
  } catch (e) { console.error(e); mostrarAviso(`${mensagemErro(e)} Nada ficou pela metade dentro de cada lote; confira a planilha.`, 8000); return false; }
}
/* Rejeitar: motivo obrigatório; apaga as linhas provisórias e fica só o resumo (quem, quando, motivo) */
function pedirMotivo(titulo, texto) {
  return new Promise((resolver) => {
    const d = criarDialogo({ titulo, corpo: `<p class="apoio">${escapar(texto)}</p><label class="campo"><span class="rotulo">Motivo (obrigatório)</span><textarea name="motivo" rows="3" maxlength="300" required></textarea></label><p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn btn-perigo">${escapar(titulo)}</button></div>` });
    const form = d.querySelector("form");
    let motivo = null;
    form.addEventListener("submit", (e) => {
      const m = form.motivo.value.trim();
      if (!m) { e.preventDefault(); form.querySelector(".form-erro").textContent = "Informe o motivo."; return; }
      motivo = m.slice(0, 300);
    });
    d.addEventListener("close", () => resolver(motivo));
    d.showModal();
    form.motivo.focus();
  });
}
async function rejeitarImportacao(imp, linhas) {
  const motivo = await pedirMotivo("Rejeitar", `Rejeitar a importação de ${imp.arquivoNome}? As ${linhas.length} linha(s) provisórias são apagadas; fica só o registro de quem rejeitou, quando e por quê. Nada é gravado na planilha.`);
  if (!motivo) return false;
  try {
    const ops = linhas.map((l) => ({ op: "delete", caminho: `${COL_IMPORTACOES}/${imp.id}/linhas/${l.id}` }));
    ops.push({ op: "set", caminho: `${COL_IMPORTACOES}/${imp.id}`, mesclar: true, dados: { status: "rejeitada", motivo, decididoPor: estado.usuario.email, decididoPorNome: estado.usuario.nome, decididoEm: "__AGORA__", linhasApagadas: linhas.length } });
    await estado.api.lote(ops);
    const p = planilhaPorId(imp.destino);
    registrarAuditoria("rejeitar", `Rejeitou a importação de ${imp.arquivoNome} (origem ${imp.origem}) para ${p ? nomeCompletoPlanilha(p) : imp.destino}`, `Motivo: ${motivo} · ${textoContagens(imp.contagens)}`, { planilha: imp.destino, alvo: imp.id });
    mostrarAviso("Importação rejeitada e linhas provisórias apagadas.");
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}
/* Desfazer (até 7 dias): apaga os registros criados e devolve o "antes" dos alterados, só se ninguém mexeu neles depois */
async function desfazerImportacao(imp) {
  const p = planilhaPorId(imp.destino);
  if (!podeDesfazerImportacao(imp)) { mostrarAviso(`Só dá para desfazer uma importação aceita há menos de ${DIAS_DESFAZER} dias.`); return false; }
  if (!(await confirmar(`Desfazer a importação de ${imp.arquivoNome} em ${nomeCompletoPlanilha(p)}? Os ${(imp.idsGravados || []).length} registro(s) criados são apagados e os alterados voltam ao valor anterior. Registros mexidos depois da importação ficam como estão.`, { titulo: "Desfazer importação", botao: "Desfazer", perigo: true }))) return false;
  try {
    const [{ registros }, linhas] = await Promise.all([dadosDaPlanilha(p.id, { forcar: true }), estado.api.lerColecao(`${COL_IMPORTACOES}/${imp.id}/linhas`, { ordenar: "n", limite: MAX_LINHAS_IMPORTACAO + 10 })]);
    const porIdDest = new Map(registros.map((t) => [t.id, t]));
    const ops = [];
    let apagados = 0, restaurados = 0, mantidos = 0;
    const igual = (a, b) => String(a == null ? "" : a) === String(b == null ? "" : b);
    linhas.forEach((l) => {
      const t = l.idDestino ? porIdDest.get(l.idDestino) : null;
      if (l.aplicada === "nova") {
        if (!t) return;
        const intacto = t.importacao === imp.id && Object.keys(l.dados || {}).every((cid) => igual((t.campos || {})[cid], l.dados[cid])) && Object.keys(t.campos || {}).every((cid) => cid in (l.dados || {}));
        if (intacto) { ops.push({ op: "delete", caminho: `${p.prefixo}/${t.id}` }); apagados++; } else mantidos++;
      } else if (l.aplicada === "alterada" && t) {
        const depois = l.depoisAplicado || {}, antes = l.antesAplicado || {};
        if (!Object.keys(depois).every((cid) => igual((t.campos || {})[cid], depois[cid]))) { mantidos++; return; }
        const volta = Object.fromEntries(Object.keys(depois).map((cid) => [cid, estaVazio(antes[cid]) ? "__APAGAR__" : antes[cid]]));
        ops.push({ op: "set", caminho: `${p.prefixo}/${t.id}`, mesclar: true, dados: { campos: volta, ...assinatura() } });
        Object.keys(depois).forEach((cid) => { const hid = estado.api.novoId(`${p.prefixo}/${t.id}/historico`); ops.push({ op: "set", caminho: `${p.prefixo}/${t.id}/historico/${hid}`, dados: { acao: "desfazerImportacao", coluna: cid, colunaNome: cid, antes: texto500(depois[cid]), depois: texto500(antes[cid]), ...autoria("por"), em: "__AGORA__" } }); });
        restaurados++;
      }
    });
    ops.push({ op: "set", caminho: `${COL_IMPORTACOES}/${imp.id}`, mesclar: true, dados: { status: "desfeita", desfeitoPor: estado.usuario.email, desfeitoPorNome: estado.usuario.nome, desfeitoEm: "__AGORA__", desfeitos: { apagados, restaurados, mantidos } } });
    await estado.api.lote(ops);
    cacheDados.delete(p.id);
    registrarAuditoria("desfazerImportacao", `Desfez a importação de ${imp.arquivoNome} em ${nomeCompletoPlanilha(p)}: ${apagados} apagado(s), ${restaurados} restaurado(s)${mantidos ? `, ${mantidos} mantido(s) por terem sido alterados depois` : ""}`, "", { planilha: p.id, alvo: imp.id });
    mostrarAviso(`Importação desfeita: ${apagados} registro(s) apagado(s) e ${restaurados} restaurado(s).${mantidos ? ` ${mantidos} ficaram (foram alterados depois).` : ""}`, 7000);
    return true;
  } catch (e) { console.error(e); mostrarAviso(mensagemErro(e)); return false; }
}

/* ---------- Auditoria: linha do tempo (administradoras: tudo; equipe: a própria atividade) ---------- */
const NOMES_ACOES = {
  entrar: "Entrou", exportar: "Exportou", criar: "Criou", editar: "Editou", editarMassa: "Editou em massa", preencherMassa: "Preencheu em massa",
  excluir: "Excluiu (Lixeira)", excluirDeVez: "Excluiu de vez", restaurar: "Restaurou", importar: "Importou", aceitar: "Aceitou importação",
  rejeitar: "Rejeitou importação", desfazerImportacao: "Desfez importação", pedirExclusao: "Pediu exclusão", recusarExclusao: "Recusou exclusão",
  estrutura: "Estrutura", pessoa: "Pessoas", backup: "Backup", restaurarBackup: "Restaurou backup", apagarBackup: "Apagou backup", compactar: "Compactou",
  auditoria: "Ciclo de auditoria", substituirValor: "Substituiu valor", corrigirLista: "Corrigiu lista", aparencia: "Aparência"
};
const nomeAcao = (a) => NOMES_ACOES[a] || a;
async function renderizarTelaAuditoria() {
  const tela = $("#tela-auditoria");
  const admin = ehAdmin();
  let lista = null, falhou = false;
  const f = { de: "", ate: "", pessoa: "", planilha: "", acao: "", texto: "" };
  tela.innerHTML = `<div class="menu-cabeca"><div><h1 id="auditoria-titulo">${admin ? "Auditoria" : "Minha atividade"}</h1><p class="apoio">${admin ? "Todas as ações registradas, da mais recente para a mais antiga. A trilha é só de inclusão: ninguém edita nem apaga." : "As suas entradas, exportações e edições registradas no Inventário."}</p></div>
      <div class="form-botoes"><button type="button" class="btn btn-secundario btn-mini" data-aud="csv">${svg("i-download")}CSV</button><button type="button" class="btn btn-secundario btn-mini" data-aud="pdf">${svg("i-imprimir")}PDF</button></div></div>
    <div class="filtros-auditoria">
      <label class="campo"><span class="rotulo">De</span><input type="date" data-f="de"></label>
      <label class="campo"><span class="rotulo">Até</span><input type="date" data-f="ate"></label>
      ${admin ? `<label class="campo"><span class="rotulo">Pessoa</span><select data-f="pessoa"><option value="">Todas</option></select></label>` : ""}
      <label class="campo"><span class="rotulo">Inventário</span><select data-f="planilha"><option value="">Todos</option>${PLANILHAS.map((p) => `<option value="${p.id}">${escapar(nomeCompletoPlanilha(p))}</option>`).join("")}<option value="__geral">Geral (entradas, importações)</option></select></label>
      <label class="campo"><span class="rotulo">Ação</span><select data-f="acao"><option value="">Todas</option></select></label>
      <label class="campo"><span class="rotulo">Buscar</span><input type="search" data-f="texto" placeholder="HOSTNAME, resumo…"></label>
    </div>
    <p class="apoio" id="aud-contagem" role="status"></p>
    <ol class="linha-tempo-auditoria" id="aud-lista"><li class="apoio">Carregando…</li></ol>`;
  const filtrados = () => (lista || []).filter((a) => {
    const dia = dataIsoBrasilia(a.em);
    if (f.de && dia < f.de) return false;
    if (f.ate && dia > f.ate) return false;
    if (f.pessoa && a.por !== f.pessoa) return false;
    /* Eventos antigos (sem "planilha") são todos do Inventário de Equipamentos */
    const pa = a.planilha === undefined ? "inventario" : a.planilha;
    if (f.planilha === "__geral") { if (pa && planilhaPorId(pa)) return false; }
    else if (f.planilha && pa !== f.planilha) return false;
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
    caixa.innerHTML = vis.length ? vis.slice(0, 1000).map((a) => {
      const p = a.planilha ? planilhaPorId(a.planilha) : null;
      return `<li><div class="aud-cab"><time datetime="${escapar(a.em)}">${escapar(formatarData(a.em, true))}</time> <strong>${escapar(quem(a))}</strong>${a.porEmail ? ` <span class="apoio">${escapar(a.porEmail)}</span>` : ""} <span class="etq">${escapar(nomeAcao(a.acao))}</span>${p ? ` <span class="selo">${escapar(nomeCompletoPlanilha(p))}</span>` : ""}</div>
        <p>${escapar(a.resumo)}</p>${a.detalhes ? `<p class="apoio aud-detalhes">${escapar(a.detalhes)}</p>` : ""}
        ${a.mudancas && a.mudancas.length ? `<table class="aud-mudancas"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${a.mudancas.map((m) => `<tr><td>${escapar(m.coluna)}</td><td><del>${escapar(m.antes || "(vazio)")}</del></td><td><ins>${escapar(m.depois || "(vazio)")}</ins></td></tr>`).join("")}</tbody></table>` : ""}</li>`;
    }).join("") : '<li class="apoio">Nenhum evento com esses filtros.</li>';
  };
  const preencherFiltros = () => {
    const acoes = [...new Set(lista.map((a) => a.acao))].sort((a, b) => COMPARAR(nomeAcao(a), nomeAcao(b)));
    $('[data-f="acao"]', tela).innerHTML = `<option value="">Todas</option>${acoes.map((a) => `<option value="${escapar(a)}">${escapar(nomeAcao(a))}</option>`).join("")}`;
    const sel = $('[data-f="pessoa"]', tela);
    if (sel) { const pessoas = [...new Map(lista.map((a) => [a.por, quem(a)])).entries()].sort((a, b) => COMPARAR(a[1], b[1])); sel.innerHTML = `<option value="">Todas</option>${pessoas.map(([id, n]) => `<option value="${escapar(id)}">${escapar(n)}</option>`).join("")}`; }
  };
  const carregar = async () => {
    falhou = false; lista = null;
    $("#aud-lista", tela).innerHTML = '<li class="apoio">Carregando…</li>';
    try {
      lista = admin
        ? await estado.api.lerColecao(COL_AUDITORIA, { ordenar: "em", desc: true, limite: 2000 })
        : (await estado.api.lerColecao(COL_AUDITORIA, { onde: ["por", "==", estado.usuario.uid], limite: 1000 })).sort((a, b) => String(b.em).localeCompare(String(a.em)));
      preencherFiltros();
    } catch (e) { console.warn(e); falhou = true; }
    desenhar();
  };
  tela.oninput = (e) => { const k = e.target.dataset.f; if (k) { f[k] = e.target.value; desenhar(); } };
  tela.onchange = tela.oninput;
  tela.onclick = (e) => {
    const b = e.target.closest("[data-aud]");
    if (!b) return;
    if (b.dataset.aud === "tentar") { carregar(); return; }
    const vis = filtrados();
    const cab = ["Quando", "Quem", "E-mail", "Ação", "Inventário", "Alvo", "Resumo", "Detalhes", "Antes → depois"];
    const linhas = vis.map((a) => [formatarData(a.em, true), quem(a), a.porEmail || (String(a.por).includes("@") ? a.por : ""), nomeAcao(a.acao), a.planilha && planilhaPorId(a.planilha) ? nomeCompletoPlanilha(planilhaPorId(a.planilha)) : "", a.alvo || "", a.resumo || "", a.detalhes || "", (a.mudancas || []).map((m) => `${m.coluna}: ${m.antes || "(vazio)"} → ${m.depois || "(vazio)"}`).join(" | ")]);
    if (b.dataset.aud === "csv") {
      const p = partesBrasilia();
      baixarArquivo(`inventario-auditoria-${p.ano}-${p.mes}-${p.dia}.csv`, "\ufeff" + [cab, ...linhas].map((l) => l.map(csvCampo).join(";")).concat(["", csvCampo(rodapeExportacao())]).join("\r\n"), "text/csv;charset=utf-8");
    } else imprimirTabela(`${admin ? "Auditoria" : "Minha atividade"} · Inventário e Auditoria · ${formatarData(new Date(), true)}`, cab, linhas);
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
/* Aparência livre: por pessoa (este navegador) e padrão do inventário (inventario-config/aparencia,
   só administradoras gravam). O padrão só é ouvido com a sessão aberta (as regras exigem login). */
aparencia = criarAparencia({
  prefixo: "inventario",
  planilha: () => ({ id: planilhaAtual().id, nome: planilhaAtual().nome }),
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
    ouvir: (cb) => (estado.api && estado.usuario ? estado.api.ouvirDoc(`${P()}-config/aparencia`, cb, (e) => console.warn("aparência", e)) : null),
    lerImagem: async () => { const d = estado.api && estado.usuario ? await estado.api.lerDoc(`${P()}-config/aparencia-imagem`) : null; return d && d.imagem; },
    /* imagem: texto = grava a imagem; null = apaga; undefined = não mexe */
    gravar: async (dados, imagem) => {
      const assinatura = { atualizadoEm: "__AGORA__", atualizadoPor: estado.usuario.email };
      const ops = [{ op: "set", caminho: `${P()}-config/aparencia`, dados: { tema: dados.tema, regras: dados.regras, permitirPessoal: dados.permitirPessoal, ...assinatura } }];
      if (imagem === null) ops.push({ op: "delete", caminho: `${P()}-config/aparencia-imagem` });
      else if (typeof imagem === "string") ops.push({ op: "set", caminho: `${P()}-config/aparencia-imagem`, dados: { imagem, ...assinatura } });
      await estado.api.lote(ops);
      registrarAuditoria("aparencia", `Padrão de aparência do inventário${dados.permitirPessoal ? "" : " (aparência pessoal desligada)"}`);
    },
    remover: async () => {
      await estado.api.lote([{ op: "delete", caminho: `${P()}-config/aparencia` }, { op: "delete", caminho: `${P()}-config/aparencia-imagem` }]);
      registrarAuditoria("aparencia", "Padrão de aparência do inventário removido");
    }
  }
});
(async () => {
  const api = await conectar();
  estado.api = api;
  if (!api) { mostrarRegistro(); marcarErrosIdentidade({}, "Sem conexão com o servidor. Verifique a internet e recarregue a página."); return; }
  api.aoMudarUsuario((u) => { aoMudarUsuario(u).catch((e) => { console.error(e); mostrarBloqueio({ titulo: "Algo deu errado", texto: "Não foi possível abrir o inventário. Recarregue a página.", verificar: true }); }); });
})();
window.__inventario = { estado, get aparencia() { return aparencia; } };
