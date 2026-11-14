/*
 * Contatos dos Gestores: planilha Google -> Firestore -> contatos.html
 * (Central do Suporte V/CERT, projeto Firebase "suporte-n2").
 *
 * O que faz: a cada edição na planilha (e, por garantia, a cada minuto)
 * lê todas as abas visíveis e grava uma cópia em planilha-contatos/ no
 * Firestore. O site escuta essa cópia e atualiza a página em segundos.
 * A planilha continua sendo o lugar de editar; o site só lê.
 *
 * Regras da planilha
 *  - A primeira linha preenchida de cada aba é o cabeçalho.
 *  - Abas ocultas e abas cujo nome começa com # ou _ ficam fora do site.
 *  - Colunas cujo cabeçalho começa com # ou _ também ficam fora (ex.: #CPF).
 *  - Os valores vão como aparecem na tela (datas e números formatados).
 *  - LGPD: a página Contatos é aberta para todo o time. Só dados corporativos.
 *
 * PASSO A PASSO (uma vez)
 *  1. A planilha precisa ser do tipo Planilhas Google. Se ela abre com o selo
 *     ".XLSX" ao lado do nome, use Arquivo > Salvar como Planilhas Google.
 *     Isso cria uma cópia nova, com outro ID (o trecho entre /d/ e /edit do
 *     link). Troque PLANILHA_CONTATOS_ID aqui E no contatos.html.
 *  2. No Firebase Console do projeto suporte-n2: Authentication > Usuários >
 *     Adicionar usuário, com o e-mail sincronizador.planilha@suporte-n2.web.app
 *     (o mesmo do firestore.rules) e uma senha forte só para isso.
 *  3. Na planilha (já convertida): Extensões > Apps Script. Cole este arquivo
 *     em Código.gs. Em Configurações do projeto (engrenagem), marque "Mostrar
 *     o arquivo de manifesto appsscript.json no editor" e cole o
 *     appsscript.json desta pasta.
 *  4. Ainda em Configurações do projeto > Propriedades do script, adicione:
 *       SINC_EMAIL = sincronizador.planilha@suporte-n2.web.app
 *       SINC_SENHA = (a senha do passo 2)
 *     Nunca escreva o e-mail ou a senha neste código.
 *  5. Selecione a função verificarConfiguracao e clique em Executar (autorize).
 *     O registro mostra as abas, as colunas e se o login funcionou. Nada é gravado.
 *  6. Selecione a função instalar e clique em Executar. Ela cria os gatilhos
 *     (ao editar, ao mudar a estrutura e a cada 1 minuto) e já sincroniza.
 *  7. Abra a página Contatos do site: a faixa fica verde com "Sincronizado".
 *     Para parar: execute desinstalar.
 */

const PLANILHA_CONTATOS_ID = "1xVGktv0h25mGgPwLQ269vzvUlFHEZC70";
const PROJETO_FIREBASE = "suporte-n2";
/* Chave pública da web do Firebase (a mesma que está no site). Não é senha. */
const CHAVE_WEB_FIREBASE = "AIzaSyANFy1o-LKD0Iauh_hxQGuqxTsr5x_Wupg";

const LINHAS_POR_PARTE = 400;
const BYTES_POR_PARTE = 700000;
const MAX_ABAS = 30;
const MAX_COLUNAS = 60;
const MAX_LINHAS = 20000;
const MAX_TEXTO_CELULA = 1000;
/* Sem mudanças, o "estou vivo" (verificadoEm) é gravado no máximo a cada 2 min.
   O site mostra a faixa amarela depois de 5 min sem notícia. */
const PULSO_MINUTOS = 2;

/* ------------------------------------------------------------
 *  Instalação
 * ------------------------------------------------------------ */
function instalar() {
  const planilha = abrirPlanilha_();
  ScriptApp.getProjectTriggers().forEach(function (g) { ScriptApp.deleteTrigger(g); });
  ScriptApp.newTrigger("aoEditar").forSpreadsheet(planilha).onEdit().create();
  ScriptApp.newTrigger("aoMudar").forSpreadsheet(planilha).onChange().create();
  ScriptApp.newTrigger("sincronizar").timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().deleteProperty("ESTADO_SINC");
  sincronizar();
  console.log("Pronto: gatilhos criados e primeira sincronização feita.");
}

function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (g) { ScriptApp.deleteTrigger(g); });
  console.log("Gatilhos removidos. O site continua mostrando a última cópia gravada.");
}

function aoEditar() { sincronizar(); }
function aoMudar() { sincronizar(); }

/* Confere tudo sem gravar nada no Firestore */
function verificarConfiguracao() {
  const planilha = abrirPlanilha_();
  console.log("Planilha: " + planilha.getName());
  lerAbas_(planilha).forEach(function (a) {
    console.log("Aba \"" + a.nome + "\" (id " + a.id + "): " + a.linhas.length + " linha(s), " + a.partes.length + " parte(s). Colunas: " + a.cabecalhos.join(" | "));
  });
  token_();
  console.log("Login do sincronizador: ok.");
}

/* ------------------------------------------------------------
 *  Sincronização
 * ------------------------------------------------------------ */
function sincronizar() {
  const trava = LockService.getScriptLock();
  if (!trava.tryLock(10000)) return;
  try {
    sincronizar_();
  } catch (erro) {
    console.error(erro);
    try { gravarErro_(erro); } catch (e) { console.error("Não foi possível registrar o erro no Firestore:", e); }
  } finally {
    trava.releaseLock();
  }
}

function sincronizar_() {
  const props = PropertiesService.getScriptProperties();
  const abas = lerAbas_(abrirPlanilha_());
  const anterior = JSON.parse(props.getProperty("ESTADO_SINC") || "null") || lerEstadoRemoto_();
  const hashGeral = hash_(JSON.stringify(abas.map(function (a) { return [a.id, a.hash]; })));
  const agora = new Date();
  const mudou = !anterior || anterior.hashGeral !== hashGeral || anterior.status !== "ok";
  if (!mudou && anterior.pulso && agora.getTime() - anterior.pulso < PULSO_MINUTOS * 60000) return;

  const token = token_();
  const antes = (anterior && anterior.abas) || {};
  if (mudou) {
    abas.forEach(function (aba) {
      const a = antes[aba.id];
      if (!a || a.hash !== aba.hash) gravarAba_(token, aba, a ? a.partes : 0);
    });
    Object.keys(antes).forEach(function (id) {
      if (abas.some(function (a) { return a.id === id; })) return;
      const escritas = [apagar_("planilha-contatos/" + id)];
      for (let i = 0; i < (antes[id].partes || 0); i++) escritas.push(apagar_("planilha-contatos/" + id + "/partes/" + i));
      commit_(token, escritas);
    });
  }
  const sincronizadoEm = mudou || !anterior.sincronizadoEm ? agora : new Date(anterior.sincronizadoEm);
  const lista = abas.map(function (a) { return { id: a.id, nome: a.nome, ordem: a.ordem, gid: a.gid, linhas: a.linhas.length, partes: a.partes.length }; });
  commit_(token, [gravar_("planilha-contatos/_estado", {
    status: "ok", erro: "", planilhaId: PLANILHA_CONTATOS_ID, versao: 1,
    abas: lista, sincronizadoEm: sincronizadoEm, verificadoEm: agora
  })]);
  const novo = { hashGeral: hashGeral, status: "ok", pulso: agora.getTime(), sincronizadoEm: sincronizadoEm.toISOString(), lista: lista, abas: {} };
  abas.forEach(function (a) { novo.abas[a.id] = { hash: a.hash, partes: a.partes.length }; });
  props.setProperty("ESTADO_SINC", JSON.stringify(novo));
  if (mudou) console.log("Sincronizado: " + abas.length + " aba(s), " + abas.reduce(function (s, a) { return s + a.linhas.length; }, 0) + " linha(s).");
}

/* Uma aba = documento da aba + partes, tudo num commit só (o site só troca quando todas as partes têm o mesmo hash) */
function gravarAba_(token, aba, partesAntes) {
  const caminho = "planilha-contatos/" + aba.id;
  const escritas = [gravar_(caminho, {
    nome: aba.nome, ordem: aba.ordem, gid: aba.gid, cabecalhos: aba.cabecalhos,
    linhas: aba.linhas.length, partes: aba.partes.length, hash: aba.hash, atualizadoEm: new Date()
  })];
  aba.partes.forEach(function (linhas, i) {
    escritas.push(gravar_(caminho + "/partes/" + i, { indice: i, hash: aba.hash, linhas: linhas }));
  });
  for (let i = aba.partes.length; i < (partesAntes || 0); i++) escritas.push(apagar_(caminho + "/partes/" + i));
  commit_(token, escritas);
}

function gravarErro_(erro) {
  const props = PropertiesService.getScriptProperties();
  const anterior = JSON.parse(props.getProperty("ESTADO_SINC") || "null") || {};
  const dados = {
    status: "erro", erro: String((erro && erro.message) || erro).slice(0, 300), planilhaId: PLANILHA_CONTATOS_ID, versao: 1,
    abas: anterior.lista || [], verificadoEm: new Date()
  };
  if (anterior.sincronizadoEm) dados.sincronizadoEm = new Date(anterior.sincronizadoEm);
  commit_(token_(), [gravar_("planilha-contatos/_estado", dados)]);
  anterior.status = "erro";
  props.setProperty("ESTADO_SINC", JSON.stringify(anterior));
}

/* ------------------------------------------------------------
 *  Leitura da planilha
 * ------------------------------------------------------------ */
function abrirPlanilha_() {
  try {
    return SpreadsheetApp.openById(PLANILHA_CONTATOS_ID);
  } catch (e) {
    throw new Error("Não consegui abrir a planilha " + PLANILHA_CONTATOS_ID + ". Se ela ainda é .xlsx, use Arquivo > Salvar como Planilhas Google "
      + "e troque PLANILHA_CONTATOS_ID aqui e no contatos.html. Detalhe: " + e.message);
  }
}

const ignorar_ = function (nome) { return /^[#_]/.test(String(nome).trim()); };

function lerAbas_(planilha) {
  const usados = {};
  return planilha.getSheets()
    .filter(function (f) { return !f.isSheetHidden() && !ignorar_(f.getName()); })
    .slice(0, MAX_ABAS)
    .map(function (folha, ordem) {
      const valores = folha.getDataRange().getDisplayValues();
      const inicio = valores.findIndex(function (l) { return l.some(function (c) { return String(c).trim(); }); });
      const cab = inicio >= 0 ? valores[inicio] : [];
      const colunas = [];
      cab.forEach(function (t, j) { if (String(t).trim() && !ignorar_(t) && colunas.length < MAX_COLUNAS) colunas.push(j); });
      const linhas = [];
      for (let i = inicio + 1; inicio >= 0 && i < valores.length && linhas.length < MAX_LINHAS; i++) {
        const v = colunas.map(function (j) { return String(valores[i][j] == null ? "" : valores[i][j]).trim().slice(0, MAX_TEXTO_CELULA); });
        if (v.some(function (x) { return x; })) linhas.push({ n: i + 1, v: v });
      }
      const nome = folha.getName().trim().slice(0, 100);
      let id = idAba_(nome) || "aba-" + folha.getSheetId();
      for (let n = 2; usados[id]; n++) id = (idAba_(nome) || "aba").slice(0, 55) + "-" + n;
      usados[id] = true;
      const aba = { id: id, nome: nome, ordem: ordem, gid: folha.getSheetId(), cabecalhos: colunas.map(function (j) { return String(cab[j]).trim().slice(0, 100); }), linhas: linhas };
      aba.hash = hash_(JSON.stringify([aba.nome, aba.ordem, aba.gid, aba.cabecalhos, aba.linhas]));
      aba.partes = dividir_(linhas);
      return aba;
    });
}

function idAba_(nome) {
  return String(nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}

/* Partes de até 400 linhas e ~700 KB (o limite do Firestore é 1 MB por documento) */
function dividir_(linhas) {
  const partes = [];
  let atual = [], bytes = 0;
  linhas.forEach(function (l) {
    const tamanho = unescape(encodeURIComponent(JSON.stringify(l))).length + 40;
    if (atual.length && (atual.length >= LINHAS_POR_PARTE || bytes + tamanho > BYTES_POR_PARTE)) { partes.push(atual); atual = []; bytes = 0; }
    atual.push(l);
    bytes += tamanho;
  });
  if (atual.length) partes.push(atual);
  return partes;
}

function hash_(texto) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8)
    .map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}

/* ------------------------------------------------------------
 *  Firebase: login do sincronizador e Firestore REST
 * ------------------------------------------------------------ */
function token_() {
  const cache = CacheService.getScriptCache();
  const salvo = cache.get("ID_TOKEN");
  if (salvo) return salvo;
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty("SINC_EMAIL");
  const senha = props.getProperty("SINC_SENHA");
  if (!email || !senha) throw new Error("Faltam SINC_EMAIL e SINC_SENHA em Configurações do projeto > Propriedades do script.");
  const r = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + CHAVE_WEB_FIREBASE, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ email: email, password: senha, returnSecureToken: true })
  });
  const corpo = JSON.parse(r.getContentText() || "{}");
  if (r.getResponseCode() !== 200 || !corpo.idToken) {
    throw new Error("O Firebase recusou o login do sincronizador (" + ((corpo.error && corpo.error.message) || r.getResponseCode()) + "). Confira SINC_EMAIL e SINC_SENHA.");
  }
  cache.put("ID_TOKEN", corpo.idToken, 50 * 60);
  return corpo.idToken;
}

const BASE_DOCUMENTOS = "projects/" + PROJETO_FIREBASE + "/databases/(default)/documents/";

function commit_(token, escritas) {
  for (let i = 0; i < escritas.length; i += 450) {
    const r = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/" + BASE_DOCUMENTOS.replace(/\/$/, "") + ":commit", {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({ writes: escritas.slice(i, i + 450) })
    });
    const codigo = r.getResponseCode();
    if (codigo === 401) { CacheService.getScriptCache().remove("ID_TOKEN"); throw new Error("Login expirado; a próxima execução entra de novo."); }
    if (codigo !== 200) throw new Error("O Firestore recusou a gravação (" + codigo + "): " + r.getContentText().slice(0, 300));
  }
}

/* Último estado gravado (leitura pública), para saber quais partes antigas apagar */
function lerEstadoRemoto_() {
  const r = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/" + BASE_DOCUMENTOS + "planilha-contatos/_estado", { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  const campos = (JSON.parse(r.getContentText()).fields) || {};
  const lista = ((campos.abas && campos.abas.arrayValue && campos.abas.arrayValue.values) || []).map(function (x) {
    const f = (x.mapValue && x.mapValue.fields) || {};
    return { id: f.id && f.id.stringValue, partes: Number(f.partes && f.partes.integerValue) || 0 };
  }).filter(function (a) { return a.id; });
  const abas = {};
  lista.forEach(function (a) { abas[a.id] = { hash: "", partes: a.partes }; });
  return { hashGeral: "", status: "", abas: abas, lista: [] };
}

const gravar_ = function (caminho, dados) { return { update: { name: BASE_DOCUMENTOS + caminho, fields: campos_(dados) } }; };
const apagar_ = function (caminho) { return { delete: BASE_DOCUMENTOS + caminho }; };

function campos_(objeto) {
  const r = {};
  Object.keys(objeto).forEach(function (k) { r[k] = valor_(objeto[k]); });
  return r;
}
function valor_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(valor_) } : {} };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "object") return { mapValue: { fields: campos_(v) } };
  return { stringValue: String(v) };
}
