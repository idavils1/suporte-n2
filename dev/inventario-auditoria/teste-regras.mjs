/*
 * Testes das regras do INVENTÁRIO / AUDITORIA no emulador do Firestore.
 *  1) Suba o emulador:  firebase emulators:start --only firestore   (porta 8085, firebase.json)
 *  2) Rode:             node dev/inventario-auditoria/teste-regras.mjs
 * Perfis: administradora (Lays, e-mail e senha), gestor (equipe, login anônimo ligado ao cadastro),
 * leitura (login anônimo ligado ao cadastro) e visitante sem login.
 */
const PROJETO = process.env.PROJETO || "suporte-n2";
const HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const BASE = `http://${HOST}/v1/projects/${PROJETO}/databases/(default)/documents`;
const NOME = (c) => `projects/${PROJETO}/databases/(default)/documents/${c}`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

const LAYS = { email: "lays.almeida@valid.com", provedor: "password", uid: "uid-lays" };
const GESTOR = { uid: "uid-gestor", provedor: "anonymous", cadastro: "gestor@valid.com" };
const LEITOR = { uid: "uid-leitor", provedor: "anonymous", cadastro: "leitor@valid.com" };
const ESTRANHO = { uid: "uid-estranho", provedor: "anonymous" };

function token(p) {
  if (!p) return null;
  if (p === "owner") return "owner";
  const agora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${PROJETO}`, aud: PROJETO, auth_time: agora, user_id: p.uid, sub: p.uid, iat: agora, exp: agora + 3600,
    ...(p.email ? { email: p.email, email_verified: true } : {}), firebase: { sign_in_provider: p.provedor, identities: {} }
  })}.`;
}
const valor = (v) => {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)])) } };
};
const cabecalhos = (p) => ({ "Content-Type": "application/json", ...(token(p) ? { Authorization: `Bearer ${token(p)}` } : {}) });
function escrita(caminho, dados, mesclar = false) {
  const fields = {}, transforms = [];
  for (const [k, v] of Object.entries(dados)) {
    if (v === "__AGORA__") transforms.push({ fieldPath: k, setToServerValue: "REQUEST_TIME" });
    else fields[k] = valor(v);
  }
  const w = { update: { name: NOME(caminho), fields }, updateTransforms: transforms };
  if (mesclar) w.updateMask = { fieldPaths: Object.keys(fields) };
  return w;
}
const commit = async (writes, p) => (await fetch(`${BASE}:commit`, { method: "POST", headers: cabecalhos(p), body: JSON.stringify({ writes }) })).ok;
const salvar = (c, d, p, mesclar) => commit([escrita(c, d, mesclar)], p);
const excluir = (c, p) => commit([{ delete: NOME(c) }], p);
const ler = async (c, p) => (await fetch(`${BASE}/${c}`, { headers: cabecalhos(p) })).ok;
async function listar(colecao, p, onde) {
  const consulta = { from: [{ collectionId: colecao }], ...(onde ? { where: { fieldFilter: { field: { fieldPath: onde[0] }, op: "EQUAL", value: valor(onde[1]) } } } : {}) };
  const r = await fetch(`${BASE}:runQuery`, { method: "POST", headers: cabecalhos(p), body: JSON.stringify({ structuredQuery: consulta }) });
  return r.ok;
}

let falhas = 0, total = 0;
const conferir = (nome, obtido, esperado) => {
  total++;
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "OK    " : "FALHOU"} ${nome} (esperado: ${esperado ? "permitir" : "negar"})`);
};

/* Dados de partida (gravados sem regras) */
await fetch(`http://${HOST}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
const agora = new Date();
const identidade = (email, nome, papel) => ({ email, nome, nomeChave: nome.toLowerCase(), papel, ativo: true, aprovado: true, criadoEm: agora, atualizadoEm: agora });
await salvar(`inventario-identidades/${GESTOR.cadastro}`, identidade(GESTOR.cadastro, "Gestor Teste", "equipe"), "owner");
await salvar(`inventario-identidades/${LEITOR.cadastro}`, identidade(LEITOR.cadastro, "Leitor Teste", "leitura"), "owner");
await salvar(`inventario-pessoas/${GESTOR.uid}`, { email: GESTOR.cadastro, nomeChave: "gestor teste", vinculadoEm: agora }, "owner");
await salvar(`inventario-pessoas/${LEITOR.uid}`, { email: LEITOR.cadastro, nomeChave: "leitor teste", vinculadoEm: agora }, "owner");
await salvar("inventario-colunas/vcert-sw", { titulo: "VCERT", versao: 1, colunas: [{ id: "nomeAplicacao" }], gruposColunas: [], regras: {}, atualizadoEm: agora, atualizadoPor: LAYS.email }, "owner");
await salvar("inventario-vcert-sw/s0", { campos: { nomeAplicacao: "Chrome", versao: "120", hostname: "PC-01", mesAno: "10/2026" }, criadoEm: agora, atualizadoEm: agora }, "owner");
await salvar("inventario-importacoes/i0", { destino: "vcert-sw", status: "pendente" }, "owner");
await salvar("inventario-vcert-sw-config/aparencia", { regras: [], permitirPessoal: true }, "owner");

const sw = (campos = {}, extra = {}) => ({
  campos: { nomeAplicacao: "Microsoft Office", versao: "16.0.1", hostname: "BRNCSP-7BC0LQ3", mesAno: "11/2026", fabricante: "Microsoft", ...campos },
  criadoPor: LAYS.email, criadoPorNome: "Lays", criadoPorEmail: LAYS.email, criadoEm: "__AGORA__",
  atualizadoPor: LAYS.email, atualizadoPorNome: "Lays", atualizadoPorEmail: LAYS.email, atualizadoEm: "__AGORA__", exclusao: null, ...extra
});
const hw = (campos = {}) => ({ ...sw(), campos: { hostname: "BRNCSP-7BC0LQ3", tipo: "notebook", numeroSerie: "SN123", status: "ativo", mesAno: "11/2026", ...campos } });

console.log("\n— Leitura de VCORP/VCERT —");
conferir("administradora lê VCERT Software", await ler("inventario-vcert-sw/s0", LAYS), true);
conferir("gestor lê VCERT Software", await ler("inventario-vcert-sw/s0", GESTOR), true);
conferir("leitura lê VCERT Software", await ler("inventario-vcert-sw/s0", LEITOR), true);
conferir("gestor lista VCERT Software", await listar("inventario-vcert-sw", GESTOR), true);
conferir("sem login não lê VCERT Software", await ler("inventario-vcert-sw/s0", null), false);
conferir("login anônimo sem cadastro não lê", await ler("inventario-vcert-sw/s0", ESTRANHO), false);
conferir("gestor lê as colunas (inventario-colunas)", await ler("inventario-colunas/vcert-sw", GESTOR), true);
conferir("sem login não lê as colunas", await ler("inventario-colunas/vcert-sw", null), false);

console.log("\n— Escrita em VCORP/VCERT (só administradoras) —");
conferir("administradora grava Software válido", await salvar("inventario-vcorp-sw/s1", sw(), LAYS), true);
conferir("gestor NÃO grava Software (forçando pelo console)", await salvar("inventario-vcorp-sw/s2", sw({}, { atualizadoPor: GESTOR.uid }), GESTOR), false);
conferir("leitura NÃO grava Software", await salvar("inventario-vcorp-sw/s3", sw(), LEITOR), false);
conferir("gestor NÃO edita um Software existente", await salvar("inventario-vcorp-sw/s1", { campos: { versao: "17" } }, GESTOR, true), false);
conferir("gestor NÃO exclui", await excluir("inventario-vcorp-sw/s1", GESTOR), false);
conferir("Software sem VERSÃO é recusado", await salvar("inventario-vcorp-sw/s4", sw({ versao: "" }), LAYS), false);
conferir("Software sem NOME DA APLICAÇÃO é recusado", await salvar("inventario-vcorp-sw/s5", sw({ nomeAplicacao: "" }), LAYS), false);
conferir("MÊS/ANO 13/2026 é recusado", await salvar("inventario-vcorp-sw/s6", sw({ mesAno: "13/2026" }), LAYS), false);
conferir("MÊS/ANO 2026-11 é recusado", await salvar("inventario-vcorp-sw/s7", sw({ mesAno: "2026-11" }), LAYS), false);
conferir("HOSTNAME em minúsculas é recusado", await salvar("inventario-vcorp-sw/s8", sw({ hostname: "brncsp-1" }), LAYS), false);
conferir("NOME DA APLICAÇÃO com 301 caracteres é recusado", await salvar("inventario-vcorp-sw/s9", sw({ nomeAplicacao: "x".repeat(301) }), LAYS), false);
conferir("chave desconhecida no registro é recusada", await salvar("inventario-vcorp-sw/s10", sw({}, { outra: 1 }), LAYS), false);
conferir("administradora grava Hardware válido", await salvar("inventario-vcert-hw/h1", hw(), LAYS), true);
conferir("Hardware com MÊS/ANO inválido é recusado", await salvar("inventario-vcert-hw/h2", hw({ mesAno: "00/2026" }), LAYS), false);
conferir("administradora exclui", await excluir("inventario-vcorp-sw/s1", LAYS), true);
conferir("administradora grava histórico da linha", await salvar("inventario-vcert-hw/h1/historico/e1", { acao: "editar", coluna: "status", colunaNome: "STATUS", antes: "ativo", depois: "estoque", por: LAYS.email, porNome: "Lays", porEmail: LAYS.email, em: "__AGORA__" }, LAYS), true);
conferir("gestor NÃO grava histórico", await salvar("inventario-vcert-hw/h1/historico/e2", { acao: "editar", coluna: "", colunaNome: "", antes: "", depois: "", por: GESTOR.uid, porNome: "G", porEmail: "g", em: "__AGORA__" }, GESTOR), false);
conferir("gestor lê o histórico", await ler("inventario-vcert-hw/h1/historico/e1", GESTOR), true);
const colunas = { titulo: "VCERT · SOFTWARE", versao: 2, categorias: [], colunas: [{ id: "nomeAplicacao" }], gruposColunas: [], regras: {}, colunasEquipe: [], colunasTravadas: [], listasEquipe: {}, atualizadoEm: "__AGORA__", atualizadoPor: LAYS.email };
conferir("administradora grava as colunas", await salvar("inventario-colunas/vcert-sw", colunas, LAYS), true);
conferir("gestor NÃO grava as colunas", await salvar("inventario-colunas/vcert-sw", { ...colunas, atualizadoPor: GESTOR.uid }, GESTOR), false);
conferir("colunas de planilha desconhecida são recusadas", await salvar("inventario-colunas/outra", colunas, LAYS), false);

console.log("\n— Importações e mapeamentos (só administradoras) —");
conferir("administradora lê importação", await ler("inventario-importacoes/i0", LAYS), true);
conferir("gestor NÃO lê importação", await ler("inventario-importacoes/i0", GESTOR), false);
conferir("administradora grava linha provisória", await salvar("inventario-importacoes/i0/linhas/1", { n: 1, marca: "nova", dados: { hostname: "PC-01" } }, LAYS), true);
conferir("gestor NÃO grava linha provisória", await salvar("inventario-importacoes/i0/linhas/2", { n: 2 }, GESTOR), false);
conferir("administradora grava mapeamento", await salvar("inventario-mapeamentos/sccm", { origem: "SCCM", mapa: { Host: "hostname" } }, LAYS), true);
conferir("gestor NÃO lê mapeamento", await ler("inventario-mapeamentos/sccm", GESTOR), false);

console.log("\n— Auditoria (só inclusão) —");
const aud = (p, acao, extra = {}) => ({ acao, resumo: "Teste", detalhes: "", por: p.email || p.uid, porNome: "Teste", porEmail: p.email || p.cadastro || "", planilha: "vcert-sw", alvo: "", mudancas: [], em: "__AGORA__", ...extra });
conferir("administradora registra ação com antes e depois", await salvar("inventario-auditoria/a1", aud(LAYS, "editar", { mudancas: [{ coluna: "VERSÃO", antes: "1", depois: "2" }] }), LAYS), true);
conferir("gestor registra a própria entrada", await salvar("inventario-auditoria/a2", aud(GESTOR, "entrar"), GESTOR), true);
conferir("gestor registra a própria edição (Equipamentos)", await salvar("inventario-auditoria/a3", aud(GESTOR, "editar"), GESTOR), true);
conferir("gestor NÃO registra em nome de outra pessoa", await salvar("inventario-auditoria/a4", aud(GESTOR, "entrar", { por: "uid-leitor" }), GESTOR), false);
conferir("gestor NÃO registra 'aceitar importação'", await salvar("inventario-auditoria/a5", aud(GESTOR, "aceitar"), GESTOR), false);
conferir("leitura registra a própria entrada", await salvar("inventario-auditoria/a6", aud(LEITOR, "entrar"), LEITOR), true);
conferir("leitura NÃO registra edição", await salvar("inventario-auditoria/a7", aud(LEITOR, "editar"), LEITOR), false);
conferir("sem login NÃO registra", await salvar("inventario-auditoria/a8", aud(ESTRANHO, "entrar"), null), false);
conferir("ninguém altera a trilha (administradora)", await salvar("inventario-auditoria/a1", { resumo: "mudado" }, LAYS, true), false);
conferir("ninguém apaga a trilha (administradora)", await excluir("inventario-auditoria/a1", LAYS), false);
conferir("administradora lê a trilha completa", await listar("inventario-auditoria", LAYS), true);
conferir("gestor lê só a própria atividade (where por == uid)", await listar("inventario-auditoria", GESTOR, ["por", GESTOR.uid]), true);
conferir("gestor NÃO lista a trilha inteira", await listar("inventario-auditoria", GESTOR), false);
conferir("gestor NÃO lê a atividade da administradora", await ler("inventario-auditoria/a1", GESTOR), false);
conferir("leitura NÃO lê a trilha", await listar("inventario-auditoria", LEITOR, ["por", LEITOR.uid]), false);

console.log("\n— Inventário de Equipamentos (sem regressão) —");
await salvar("inventario-config/estrutura", { titulo: "INVENTÁRIO DE EQUIPAMENTOS", versao: 1 }, "owner");
await salvar("inventario/e1", { campos: { hostname: "PC-01" }, numero: "PC-01" }, "owner");
conferir("gestor lê a estrutura do Inventário de Equipamentos", await ler("inventario-config/estrutura", GESTOR), true);
conferir("gestor lê os equipamentos", await ler("inventario/e1", GESTOR), true);
conferir("sem login NÃO lê os equipamentos", await ler("inventario/e1", null), false);
conferir("gestor lê a aparência padrão de VCERT Software", await ler("inventario-vcert-sw-config/aparencia", GESTOR), true);
conferir("gestor NÃO grava a aparência padrão", await salvar("inventario-vcert-sw-config/aparencia", { tema: null, regras: [], permitirPessoal: true, atualizadoEm: "__AGORA__", atualizadoPor: GESTOR.uid }, GESTOR), false);

console.log(`\n${total - falhas} de ${total} conferências como esperado${falhas ? ` — ${falhas} FALHA(S)` : ""}.`);
process.exit(falhas ? 1 : 0);
