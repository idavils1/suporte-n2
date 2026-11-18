/*
 * Testes do firestore.rules (bloco INVENTÁRIO DE EQUIPAMENTOS) no Emulador do Firestore.
 * Precisa de Node 18+, Java 11+ e firebase-tools. Na pasta sites/inventario-testes:
 *   npm install
 *   npm test
 * (o "npm test" sobe o Emulador na porta do firebase.json e roda este arquivo).
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp } from "firebase/firestore";

/* Igual a normalizarNomeChave() do app.js */
const chave = (t) => String(t ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim();
const DAVI = "davi.lsantos@valid.com";
const BIA = "bia@valid.com"; /* liberada só no Banco de Tickets */
const antes = (dias) => Timestamp.fromDate(new Date(Date.now() - dias * 86400000));

const ESTRUTURA = {
  titulo: "INVENTÁRIO DE EQUIPAMENTOS", versao: 1, categorias: [], colunas: [], gruposColunas: [],
  regras: { equipeEdita: "todas", janelaEdicaoHoras: 0, exportacao: true, registro: { aberto: true, dominios: [], papelPadrao: "equipe", aprovacao: true } },
  colunasEquipe: ["hostname", "dna", "usuario", "area", "gestor", "status", "auditoria", "tecnico", "observacao"],
  colunasTravadas: ["hostname", "dna"],
  listasEquipe: {
    area: ["sac", "suporte-operacional", "suporte-n2"],
    gestor: [],
    status: ["em-uso", "disponivel", "em-manutencao", "aguardando-devolucao", "emprestado", "extraviado", "baixado-descartado"],
    auditoria: ["pendente", "auditado-ok", "divergencia-encontrada", "nao-localizado"],
    tecnico: ["anderson-leite", "davi-santos", "david-bezerra", "fabiana-santos", "guilherme-bezerra", "isaque-pereira", "lays-almeida", "maria-luisa-chaves", "paula-katiele"]
  }
};

let env;
const anonimo = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();
const admin = () => env.authenticatedContext("lays", { email: "lays.almeida@valid.com", email_verified: true, firebase: { sign_in_provider: "password" } }).firestore();
const identidade = (email, nome, extra = {}) => ({
  email, nome, nomeChave: chave(nome), papel: "equipe", ativo: true, aprovado: true,
  criadoEm: antes(10), criadoPorUid: "uid-antigo", atualizadoEm: antes(10), ...extra
});
const vincular = (db, uid, email, nome, colecao = "inventario-pessoas") =>
  setDoc(doc(db, colecao, uid), { email, nomeChave: chave(nome), vinculadoEm: serverTimestamp(), ultimoAcesso: serverTimestamp() }, { merge: true });
function cadastroNovo(db, uid, email, nome, extra = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "inventario-identidades", email), {
    email, nome, nomeChave: chave(nome), papel: "equipe", ativo: true, aprovado: false,
    criadoEm: serverTimestamp(), criadoPorUid: uid, atualizadoEm: serverTimestamp(), ...extra
  });
  b.set(doc(db, "inventario-emails", email), {});
  b.set(doc(db, "inventario-pessoas", uid), { email, nomeChave: chave(nome), vinculadoEm: serverTimestamp(), ultimoAcesso: serverTimestamp() }, { merge: true });
  return b.commit();
}
const autoria = (prefixo, uid, nome, email) => ({
  [`${prefixo}Por`]: uid, [`${prefixo}PorNome`]: nome, [`${prefixo}PorEmail`]: email, [`${prefixo}Em`]: serverTimestamp()
});
/* Cadastro pela equipe: equipamento + índices de HOSTNAME e DNA no mesmo lote (como o app faz) */
function criarEquipamento(db, uid, id, campos, { nome = "Davi Santos", email = DAVI, indices = {} } = {}) {
  const b = writeBatch(db);
  const numero = campos.hostname ?? "", dna = campos.dna ?? "";
  b.set(doc(db, "inventario", id), { campos, numero, dna, ...autoria("criado", uid, nome, email), ...autoria("atualizado", uid, nome, email), exclusao: null });
  if (numero) b.set(doc(db, "inventario-hostnames", indices.hostname ?? numero), { equipamento: id });
  if (dna) b.set(doc(db, "inventario-dnas", indices.dna ?? dna), { equipamento: id });
  return b.commit();
}
const editar = (db, uid, id, mudancas, { nome = "Davi Santos", email = DAVI, extra = {} } = {}) => updateDoc(doc(db, "inventario", id), {
  ...Object.fromEntries(Object.entries(mudancas).map(([k, v]) => [`campos.${k}`, v])),
  atualizadoPor: uid, atualizadoPorNome: nome, atualizadoPorEmail: email, atualizadoEm: serverTimestamp(), ...extra
});
async function equipeDavi(uid = "pc-davi") {
  const db = anonimo(uid);
  await vincular(db, uid, DAVI, "Davi Santos");
  return db;
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-inventario",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "inventario-config", "estrutura"), { ...ESTRUTURA, atualizadoEm: antes(30), atualizadoPor: "lays.almeida@valid.com" });
    await setDoc(doc(db, "inventario-identidades", DAVI), identidade(DAVI, "Davi Santos"));
    await setDoc(doc(db, "inventario-emails", DAVI), {});
    await setDoc(doc(db, "inventario-identidades", "jose@valid.com"), identidade("jose@valid.com", "José Antônio Çaçapava"));
    await setDoc(doc(db, "inventario-emails", "jose@valid.com"), {});
    await setDoc(doc(db, "inventario-identidades", "leitura@valid.com"), identidade("leitura@valid.com", "Pessoa Leitura", { papel: "leitura" }));
    await setDoc(doc(db, "inventario-emails", "leitura@valid.com"), {});
    await setDoc(doc(db, "inventario-identidades", "bloqueado@valid.com"), identidade("bloqueado@valid.com", "Pessoa Bloqueada", { ativo: false }));
    await setDoc(doc(db, "inventario-emails", "bloqueado@valid.com"), {});
    await setDoc(doc(db, "inventario", "e1"), {
      campos: { hostname: "NB-0001", dna: "DNA1001", status: "em-uso" }, numero: "NB-0001", dna: "DNA1001",
      criadoPor: "uid-a", criadoPorNome: "Davi Santos", criadoPorEmail: DAVI, criadoEm: antes(2),
      atualizadoPor: "uid-a", atualizadoPorNome: "Davi Santos", atualizadoPorEmail: DAVI, atualizadoEm: antes(2), exclusao: null
    });
    await setDoc(doc(db, "inventario-hostnames", "NB-0001"), { equipamento: "e1" });
    await setDoc(doc(db, "inventario-dnas", "DNA1001"), { equipamento: "e1" });
    /* Banco de Tickets: Bia liberada lá; Davi não tem cadastro lá */
    await setDoc(doc(db, "tickets-identidades", BIA), identidade(BIA, "Bia Souza"));
    await setDoc(doc(db, "tickets-emails", BIA), {});
  });
});

/* ---------- Entrada (igual ao Banco, com cadastros próprios) ---------- */
test("e-mail cadastrado + nome certo: liga o aparelho e lê o inventário", async () => {
  const db = anonimo("b1");
  await assertSucceeds(vincular(db, "b1", DAVI, "Davi Santos"));
  await assertSucceeds(getDocs(collection(db, "inventario")));
  await assertSucceeds(getDoc(doc(db, "inventario-identidades", DAVI)));
});
test("nome errado: recusa", async () => {
  await assertFails(vincular(anonimo("b2"), "b2", DAVI, "Davi Lopes"));
});
test("acento, maiúscula e espaços diferentes: liga", async () => {
  await assertSucceeds(vincular(anonimo("b3"), "b3", DAVI, "  davi   SANTOS. "));
  await assertSucceeds(vincular(anonimo("b4"), "b4", "jose@valid.com", "JOSE ANTONIO CACAPAVA"));
});
test("e-mail novo: cria o cadastro aguardando liberação (sem acesso ao inventário)", async () => {
  const db = anonimo("n1");
  await assertSucceeds(cadastroNovo(db, "n1", "nova@valid.com", "Ângela Müller-Çelik"));
  await assertSucceeds(getDoc(doc(db, "inventario-identidades", "nova@valid.com")));
  await assertFails(getDocs(collection(db, "inventario")));
});
test("Lays libera o cadastro novo: o mesmo aparelho passa a ler o inventário", async () => {
  const db = anonimo("n6");
  await assertSucceeds(cadastroNovo(db, "n6", "maria@valid.com", "Maria Teste"));
  await assertFails(getDocs(collection(db, "inventario")));
  await assertSucceeds(updateDoc(doc(admin(), "inventario-identidades", "maria@valid.com"), { aprovado: true, atualizadoEm: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(db, "inventario")));
});
test("cadastro novo com nomeChave que não bate, aprovado sem liberação ou e-mail já cadastrado: recusa", async () => {
  await assertFails(cadastroNovo(anonimo("n2"), "n2", "outra@valid.com", "Outra Pessoa", { nomeChave: "qualquer coisa" }));
  await assertFails(cadastroNovo(anonimo("n3"), "n3", "outra2@valid.com", "Outra Pessoa", { aprovado: true }));
  await assertFails(cadastroNovo(anonimo("n4"), "n4", DAVI, "Davi Santos"));
});
test("e-mail de administradora na entrada da equipe: recusa", async () => {
  await assertFails(cadastroNovo(anonimo("n5"), "n5", "lays.almeida@valid.com", "Lays Almeida"));
  await assertFails(cadastroNovo(anonimo("n7"), "n7", "paula.conceicao@valid.com", "Paula Conceição"));
});
test("identidade bloqueada: liga, mas não lê o inventário", async () => {
  const db = anonimo("x1");
  await assertSucceeds(vincular(db, "x1", "bloqueado@valid.com", "Pessoa Bloqueada"));
  await assertFails(getDocs(collection(db, "inventario")));
});
test("Desconectar todos os aparelhos: o aparelho antigo perde o acesso; ligando de novo, volta", async () => {
  const db = anonimo("d1");
  await assertSucceeds(vincular(db, "d1", DAVI, "Davi Santos"));
  await assertSucceeds(getDocs(collection(db, "inventario")));
  await new Promise((r) => setTimeout(r, 50));
  await assertSucceeds(updateDoc(doc(admin(), "inventario-identidades", DAVI), { revogadoAntesDe: serverTimestamp(), atualizadoEm: serverTimestamp() }));
  await assertFails(getDocs(collection(db, "inventario")));
  await assertSucceeds(vincular(db, "d1", DAVI, "Davi Santos"));
  await assertSucceeds(getDocs(collection(db, "inventario")));
});
test("equipe não lê nem lista identidades de outras pessoas", async () => {
  const db = await equipeDavi("e1");
  await assertFails(getDoc(doc(db, "inventario-identidades", "jose@valid.com")));
  await assertFails(getDocs(collection(db, "inventario-identidades")));
  await assertFails(getDoc(doc(anonimo("sem-aparelho"), "inventario-identidades", DAVI)));
});
test("inventario-emails: lê um e-mail por vez, mas não lista", async () => {
  const db = anonimo("m1");
  await assertSucceeds(getDoc(doc(db, "inventario-emails", DAVI)));
  await assertFails(getDocs(collection(db, "inventario-emails")));
});
test("ninguém liga o aparelho de outro uid nem muda papel/ativo pelo aparelho", async () => {
  await assertFails(vincular(anonimo("p1"), "p2", DAVI, "Davi Santos"));
  const db = await equipeDavi("p3");
  await assertFails(updateDoc(doc(db, "inventario-identidades", DAVI), { papel: "equipe", ativo: true, atualizadoEm: serverTimestamp() }));
});

/* ---------- Cadastros separados do Banco de Tickets ---------- */
test("pessoa liberada no Banco de Tickets NÃO lê o Inventário", async () => {
  const db = anonimo("bia-pc");
  await assertSucceeds(vincular(db, "bia-pc", BIA, "Bia Souza", "tickets-pessoas"));
  await assertSucceeds(getDocs(collection(db, "tickets")));
  await assertFails(getDocs(collection(db, "inventario")));
  await assertFails(getDoc(doc(db, "inventario", "e1")));
  await assertFails(vincular(db, "bia-pc", BIA, "Bia Souza"));
  await assertFails(getDocs(collection(db, "inventario")));
});
test("pessoa liberada no Inventário NÃO lê o Banco de Tickets", async () => {
  const db = await equipeDavi("davi-pc");
  await assertSucceeds(getDocs(collection(db, "inventario")));
  await assertFails(getDocs(collection(db, "tickets")));
  await assertFails(getDoc(doc(db, "tickets-identidades", DAVI)));
  await assertFails(vincular(db, "davi-pc", DAVI, "Davi Santos", "tickets-pessoas"));
  await assertFails(getDocs(collection(db, "tickets")));
});
test("administradora do Inventário não precisa de cadastro; aparelho anônimo sem cadastro não lê nada", async () => {
  await assertSucceeds(getDocs(collection(admin(), "inventario")));
  await assertFails(getDocs(collection(anonimo("ninguem"), "inventario")));
  await assertFails(getDocs(collection(anonimo("ninguem"), "inventario-hostnames")));
});

/* ---------- Equipamentos: travado após criar, únicos e listas ---------- */
test("equipe cadastra com HOSTNAME + DNA (índices no mesmo lote)", async () => {
  const db = await equipeDavi();
  await assertSucceeds(criarEquipamento(db, "pc-davi", "n1", { hostname: "NB-0100", dna: "DNA0100", status: "em-uso", tecnico: "davi-santos", area: "sac" }));
  await assertSucceeds(getDoc(doc(db, "inventario-hostnames", "NB-0100")));
});
test("equipe cadastra sem os índices ou com índice apontando para outro equipamento: recusa", async () => {
  const db = await equipeDavi();
  const b = writeBatch(db);
  b.set(doc(db, "inventario", "n2"), { campos: { hostname: "NB-0200" }, numero: "NB-0200", dna: "", ...autoria("criado", "pc-davi", "Davi Santos", DAVI), ...autoria("atualizado", "pc-davi", "Davi Santos", DAVI), exclusao: null });
  await assertFails(b.commit());
  await assertFails(criarEquipamento(db, "pc-davi", "n3", { hostname: "NB-0300", dna: "DNA0300" }, { indices: { hostname: "NB-9999" } }));
});
test("HOSTNAME repetido: recusa (e DNA repetido também)", async () => {
  const db = await equipeDavi();
  await assertFails(criarEquipamento(db, "pc-davi", "n4", { hostname: "NB-0001", dna: "DNA0400" }));
  await assertFails(criarEquipamento(db, "pc-davi", "n5", { hostname: "NB-0500", dna: "DNA1001" }));
});
test("HOSTNAME fora do formato (minúsculas/espaço): recusa", async () => {
  const db = await equipeDavi();
  await assertFails(criarEquipamento(db, "pc-davi", "n6", { hostname: "nb 0600" }));
});
test("equipe altera STATUS, TÉCNICO e OBSERVAÇÃO", async () => {
  const db = await equipeDavi();
  await assertSucceeds(editar(db, "pc-davi", "e1", { status: "disponivel", tecnico: "isaque-pereira", observacao: "Voltou do conserto" }));
});
test("equipe NÃO altera HOSTNAME nem DNA depois de criado (travado após criar)", async () => {
  const db = await equipeDavi();
  await assertFails(editar(db, "pc-davi", "e1", { hostname: "NB-0002" }));
  await assertFails(editar(db, "pc-davi", "e1", { dna: "DNA2002" }));
  await assertFails(editar(db, "pc-davi", "e1", { hostname: "NB-0002" }, { extra: { numero: "NB-0002" } }));
});
/* Preencher em massa / aplicar a várias células: o app manda lotes de registros inteiros (com índices) */
function loteEmMassa(db, uid, registros) {
  const b = writeBatch(db);
  registros.forEach(([id, campos]) => {
    b.set(doc(db, "inventario", id), { campos, numero: campos.hostname ?? "", dna: campos.dna ?? "", ...autoria("criado", uid, "Davi Santos", DAVI), ...autoria("atualizado", uid, "Davi Santos", DAVI), exclusao: null });
    if (campos.hostname) b.set(doc(db, "inventario-hostnames", campos.hostname), { equipamento: id });
    if (campos.dna) b.set(doc(db, "inventario-dnas", campos.dna), { equipamento: id });
  });
  return b.commit();
}
test("preencher em massa (equipe): lote de 3 registros com índices passa", async () => {
  const db = await equipeDavi();
  await assertSucceeds(loteEmMassa(db, "pc-davi", [["m1", { hostname: "NV-001", dna: "DN901", status: "em-uso" }], ["m2", { hostname: "NV-002", dna: "DN902", area: "sac" }], ["m3", { hostname: "NV-003", observacao: "ok" }]]));
});
test("preencher em massa (equipe): uma coluna BLOQUEADA em um registro derruba o lote inteiro (nem pelo console)", async () => {
  const db = await equipeDavi();
  await assertFails(loteEmMassa(db, "pc-davi", [["m4", { hostname: "NV-004", status: "em-uso" }], ["m5", { hostname: "NV-005", bloqueado: "x" }]]));
  await env.withSecurityRulesDisabled(async (ctx) => { const s = await getDoc(doc(ctx.firestore(), "inventario", "m4")); if (s.exists()) throw new Error("o lote recusado gravou parte"); });
});
test("aplicar a várias células (equipe): STATUS em vários passa; coluna BLOQUEADA recusa", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "inventario", "e2"), { campos: { hostname: "NB-0002", status: "em-uso" }, numero: "NB-0002", dna: "", criadoPor: "uid-a", criadoPorNome: "Davi Santos", criadoPorEmail: DAVI, criadoEm: antes(2), atualizadoPor: "uid-a", atualizadoPorNome: "Davi Santos", atualizadoPorEmail: DAVI, atualizadoEm: antes(2), exclusao: null });
  });
  const db = await equipeDavi();
  const lote = (mud) => { const b = writeBatch(db); ["e1", "e2"].forEach((id) => b.update(doc(db, "inventario", id), { ...Object.fromEntries(Object.entries(mud).map(([k, v]) => [`campos.${k}`, v])), atualizadoPor: "pc-davi", atualizadoPorNome: "Davi Santos", atualizadoPorEmail: DAVI, atualizadoEm: serverTimestamp() })); return b.commit(); };
  await assertSucceeds(lote({ status: "disponivel" }));
  await assertFails(lote({ bloqueado: "x" }));
});
test("administradora altera HOSTNAME (com a troca do índice)", async () => {
  const db = admin();
  const b = writeBatch(db);
  b.update(doc(db, "inventario", "e1"), { "campos.hostname": "NB-0002", numero: "NB-0002", atualizadoPor: "lays.almeida@valid.com", atualizadoEm: serverTimestamp() });
  b.delete(doc(db, "inventario-hostnames", "NB-0001"));
  b.set(doc(db, "inventario-hostnames", "NB-0002"), { equipamento: "e1" });
  await assertSucceeds(b.commit());
});
test("valor fora da lista: recusa (STATUS, TÉCNICO, ÁREA, AUDITORIA e GESTOR sem opções)", async () => {
  const db = await equipeDavi();
  await assertFails(editar(db, "pc-davi", "e1", { status: "quebrado" }));
  await assertFails(editar(db, "pc-davi", "e1", { tecnico: "fulano" }));
  await assertFails(editar(db, "pc-davi", "e1", { area: "financeiro" }));
  await assertFails(editar(db, "pc-davi", "e1", { auditoria: "talvez" }));
  await assertFails(editar(db, "pc-davi", "e1", { gestor: "alguem" }));
  await assertFails(criarEquipamento(db, "pc-davi", "n7", { hostname: "NB-0700", status: "quebrado" }));
  await assertSucceeds(editar(db, "pc-davi", "e1", { gestor: "" }));
});
test("equipe não grava em nome de outra pessoa", async () => {
  const db = await equipeDavi();
  await assertFails(editar(db, "pc-davi", "e1", { status: "disponivel" }, { nome: "José Antônio Çaçapava", email: "jose@valid.com" }));
});
test("equipe NÃO exclui (nem o equipamento nem o índice); só solicita exclusão", async () => {
  const db = await equipeDavi();
  await assertFails(deleteDoc(doc(db, "inventario", "e1")));
  await assertFails(deleteDoc(doc(db, "inventario-hostnames", "NB-0001")));
  await assertFails(setDoc(doc(db, "inventario-hostnames", "NB-0001"), { equipamento: "outro" }));
  await assertSucceeds(updateDoc(doc(db, "inventario", "e1"), {
    exclusao: { motivo: "Duplicado", por: "pc-davi", porNome: "Davi Santos", porEmail: DAVI, em: serverTimestamp() },
    atualizadoPor: "pc-davi", atualizadoPorNome: "Davi Santos", atualizadoPorEmail: DAVI, atualizadoEm: serverTimestamp()
  }));
  await assertSucceeds(deleteDoc(doc(admin(), "inventario", "e1")));
});
test("leitura lê, mas não cria nem altera", async () => {
  const db = anonimo("pc-leitura");
  await assertSucceeds(vincular(db, "pc-leitura", "leitura@valid.com", "Pessoa Leitura"));
  await assertSucceeds(getDocs(collection(db, "inventario")));
  await assertFails(editar(db, "pc-leitura", "e1", { status: "disponivel" }, { nome: "Pessoa Leitura", email: "leitura@valid.com" }));
  await assertFails(criarEquipamento(db, "pc-leitura", "n8", { hostname: "NB-0800" }, { nome: "Pessoa Leitura", email: "leitura@valid.com" }));
});

/* ---------- Só administradoras: estrutura, ciclo de auditoria e áreas restritas ---------- */
test("equipe NÃO muda a estrutura; administradora muda", async () => {
  const dados = { ...ESTRUTURA, colunasTravadas: [], atualizadoEm: serverTimestamp(), atualizadoPor: DAVI };
  await assertFails(setDoc(doc(await equipeDavi(), "inventario-config", "estrutura"), dados));
  await assertSucceeds(setDoc(doc(admin(), "inventario-config", "estrutura"), { ...dados, colunasTravadas: ["hostname", "dna"], atualizadoPor: "lays.almeida@valid.com" }));
});
test("equipe NÃO inicia nem encerra ciclo de auditoria; administradora inicia e encerra", async () => {
  const ciclo = (por) => ({ inicio: serverTimestamp(), encerradoEm: null, resumo: null, atualizadoEm: serverTimestamp(), atualizadoPor: por });
  await assertFails(setDoc(doc(await equipeDavi(), "inventario-config", "ciclo"), ciclo(DAVI)));
  const db = admin();
  await assertSucceeds(setDoc(doc(db, "inventario-config", "ciclo"), ciclo("lays.almeida@valid.com")));
  await assertSucceeds(setDoc(doc(db, "inventario-config", "ciclo"), { encerradoEm: serverTimestamp(), resumo: { total: 1, ok: 1 }, atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com" }, { merge: true }));
  await assertFails(setDoc(doc(await equipeDavi("pc-2"), "inventario-config", "ciclo"), { encerradoEm: null, atualizadoEm: serverTimestamp(), atualizadoPor: DAVI }, { merge: true }));
});
test("equipe não lê nem grava backups, lixeira, auditoria e arquivo compactado", async () => {
  const db = await equipeDavi();
  await assertFails(getDocs(collection(db, "inventario-backups")));
  await assertFails(setDoc(doc(db, "inventario-backups", "b1"), { x: 1 }));
  await assertFails(getDocs(collection(db, "inventario-lixeira")));
  await assertFails(getDocs(collection(db, "inventario-auditoria")));
  await assertFails(setDoc(doc(db, "inventario-arquivo", "p0"), { versao: 1, indice: 0, total: 1, json: "[]", criadoPor: DAVI, criadoEm: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(db, "inventario-arquivo")));
});
test("histórico só entra junto com a mudança real do equipamento", async () => {
  const db = await equipeDavi();
  const evento = { acao: "editar", coluna: "status", colunaNome: "STATUS", antes: "em-uso", depois: "disponivel", por: "pc-davi", porNome: "Davi Santos", porEmail: DAVI, em: serverTimestamp() };
  await assertFails(setDoc(doc(db, "inventario", "e1", "historico", "h1"), evento));
  const b = writeBatch(db);
  b.update(doc(db, "inventario", "e1"), { "campos.status": "disponivel", atualizadoPor: "pc-davi", atualizadoPorNome: "Davi Santos", atualizadoPorEmail: DAVI, atualizadoEm: serverTimestamp() });
  b.set(doc(db, "inventario", "e1", "historico", "h2"), evento);
  await assertSucceeds(b.commit());
});

/* ---------- Opções removidas da lista: nenhum registro muda; só valores NOVOS precisam ser opções ativas ---------- */
/* "paula-katiele" (TÉCNICO) e "g-antigo" (GESTOR, em forma de etiquetas) removidas: fora de listasEquipe */
async function removerDaLista() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "inventario-config", "estrutura"), {
      ...ESTRUTURA, listasEquipe: { ...ESTRUTURA.listasEquipe, tecnico: ESTRUTURA.listasEquipe.tecnico.filter((x) => x !== "paula-katiele"), gestor: ["g-a", "g-b"] },
      atualizadoEm: antes(1), atualizadoPor: "lays.almeida@valid.com"
    });
    await setDoc(doc(db, "inventario", "e1"), { campos: { tecnico: "paula-katiele", gestor: ["g-a", "g-antigo"] } }, { merge: true });
  });
}
test("opção removida: equipe edita outra coluna do equipamento que a usa", async () => {
  await removerDaLista();
  await assertSucceeds(editar(await equipeDavi(), "pc-davi", "e1", { status: "disponivel", observacao: "outra coluna" }));
});
test("opção removida: equipe mantém o valor e salva (o valor reenviado igual passa)", async () => {
  await removerDaLista();
  await assertSucceeds(editar(await equipeDavi(), "pc-davi", "e1", { tecnico: "paula-katiele", observacao: "salvou sem trocar" }));
});
test("opção removida como valor NOVO: recusa (na edição e no cadastro)", async () => {
  await removerDaLista();
  const db = await equipeDavi();
  await assertSucceeds(editar(db, "pc-davi", "e1", { tecnico: "davi-santos" }));
  await assertFails(editar(db, "pc-davi", "e1", { tecnico: "paula-katiele" }));
  await assertFails(criarEquipamento(db, "pc-davi", "n9", { hostname: "NB-0900", tecnico: "paula-katiele" }));
});
test("etiquetas: acrescenta etiqueta ativa numa linha com etiqueta removida: passa; acrescentar a removida: recusa", async () => {
  await removerDaLista();
  const db = await equipeDavi();
  await assertSucceeds(editar(db, "pc-davi", "e1", { gestor: ["g-a", "g-antigo", "g-b"] }));
  await assertSucceeds(editar(db, "pc-davi", "e1", { gestor: ["g-antigo", "g-b"] }));
  await assertFails(editar(db, "pc-davi", "e1", { gestor: ["g-antigo", "g-b", "g-removido"] }));
  await assertFails(criarEquipamento(db, "pc-davi", "n10", { hostname: "NB-1000", gestor: ["g-a", "g-antigo"] }));
});
test("estrutura com opção removida (ativa, removidaEm, removidaPor, nomesAnteriores) gravada por admin: passa", async () => {
  await assertSucceeds(setDoc(doc(admin(), "inventario-config", "estrutura"), {
    ...ESTRUTURA, versao: 2,
    colunas: [{ id: "tecnico", nome: "TÉCNICO", tipo: "lista", opcoes: [
      { id: "davi-santos", nome: "Davi Lopes Santos", cor: "", nomesAnteriores: [{ nome: "Davi Santos", ate: "2026-10-30T12:00:00.000Z", por: "lays.almeida@valid.com" }] },
      { id: "paula-katiele", nome: "Paula Katiele", cor: "", ativa: false, removidaEm: "2026-10-30T12:00:00.000Z", removidaPor: "lays.almeida@valid.com" }
    ] }],
    listasEquipe: { ...ESTRUTURA.listasEquipe, tecnico: ["davi-santos"] },
    atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com"
  }));
});

/* ---------- Gestor: alimenta e edita qualquer linha; também cria e edita no VCORP/VCERT ---------- */
const GESTORA = "gestora@valid.com";
async function gestora(uid = "pc-gestora") {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, "inventario-identidades", GESTORA), identidade(GESTORA, "Gestora Teste", { papel: "gestor" }));
    await setDoc(doc(f, "inventario-emails", GESTORA), {});
    await setDoc(doc(f, "inventario-colunas", "vcorp-hw"), { titulo: "INVENTÁRIO VCORP · HARDWARE", versao: 1, colunas: [{ id: "hostname" }], gruposColunas: [], regras: {}, colunasEquipe: ["hostname", "numeroSerie", "patrimonio", "modelo"], atualizadoEm: antes(5), atualizadoPor: LAYS_EMAIL });
    await setDoc(doc(f, "inventario-colunas", "vcorp-sw"), { titulo: "INVENTÁRIO VCORP · SOFTWARE", versao: 1, colunas: [{ id: "hostname" }], gruposColunas: [], regras: {}, colunasEquipe: ["hostname", "nomeAplicacao", "versao", "mesAno"], atualizadoEm: antes(5), atualizadoPor: LAYS_EMAIL });
  });
  const db = anonimo(uid);
  await vincular(db, uid, GESTORA, "Gestora Teste");
  return db;
}
const LAYS_EMAIL = "lays.almeida@valid.com";
function criarPerfil(db, colecao, id, campos, { uid = "pc-gestora", nome = "Gestora Teste", email = GESTORA, historico = true, extra = {} } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, colecao, id), { campos, ...autoria("criado", uid, nome, email), ...autoria("atualizado", uid, nome, email), exclusao: null, ...extra });
  if (historico) b.set(doc(db, colecao, id, "historico", `h-${id}`), { acao: "criar", coluna: "", colunaNome: "", antes: "", depois: "x", por: uid, porNome: nome, porEmail: email, em: serverTimestamp() });
  return b.commit();
}
const editarPerfil = (db, colecao, id, mudancas, { uid = "pc-gestora", nome = "Gestora Teste", email = GESTORA } = {}) => updateDoc(doc(db, colecao, id), {
  ...Object.fromEntries(Object.entries(mudancas).map(([k, v]) => [`campos.${k}`, v])),
  atualizadoPor: uid, atualizadoPorNome: nome, atualizadoPorEmail: email, atualizadoEm: serverTimestamp()
});
test("gestor: a administradora define o papel; papel desconhecido recusa", async () => {
  await assertSucceeds(updateDoc(doc(admin(), "inventario-identidades", DAVI), { papel: "gestor", atualizadoEm: serverTimestamp() }));
  await assertFails(updateDoc(doc(admin(), "inventario-identidades", DAVI), { papel: "chefe", atualizadoEm: serverTimestamp() }));
  await assertFails(updateDoc(doc(await equipeDavi(), "inventario-identidades", DAVI), { papel: "gestor", atualizadoEm: serverTimestamp() }));
});
test("gestor: cadastra no Inventário de Equipamentos e edita linha de outra pessoa mesmo com 'só as próprias'", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "inventario-config", "estrutura"), { ...ESTRUTURA, regras: { ...ESTRUTURA.regras, equipeEdita: "proprias" }, atualizadoEm: antes(1), atualizadoPor: LAYS_EMAIL }); });
  const db = await gestora();
  await assertSucceeds(criarEquipamento(db, "pc-gestora", "g1", { hostname: "NB-GEST1", status: "em-uso" }, { nome: "Gestora Teste", email: GESTORA }));
  await assertSucceeds(editar(db, "pc-gestora", "e1", { status: "disponivel" }, { nome: "Gestora Teste", email: GESTORA }));
  await assertFails(editar(db, "pc-gestora", "e1", { hostname: "NB-TROCA" }, { nome: "Gestora Teste", email: GESTORA }));
  const jose = anonimo("pc-jose");
  await vincular(jose, "pc-jose", "jose@valid.com", "José Antônio Çaçapava");
  await assertFails(editar(jose, "pc-jose", "e1", { status: "em-uso" }, { nome: "José Antônio Çaçapava", email: "jose@valid.com" }));
});
test("gestor: NÃO exclui, não mexe na estrutura nem lê backups e lixeira", async () => {
  const db = await gestora();
  await assertFails(deleteDoc(doc(db, "inventario", "e1")));
  await assertFails(setDoc(doc(db, "inventario-config", "estrutura"), { ...ESTRUTURA, atualizadoEm: serverTimestamp(), atualizadoPor: GESTORA }));
  await assertFails(getDocs(collection(db, "inventario-backups")));
  await assertFails(getDocs(collection(db, "inventario-lixeira")));
});
test("VCORP/VCERT: gestor cria (com histórico) e edita; equipe N2 e leitura não gravam", async () => {
  const db = await gestora();
  await assertSucceeds(criarPerfil(db, "inventario-vcorp-hw", "h1", { hostname: "NB-VC1", numeroSerie: "S1" }));
  await assertSucceeds(editarPerfil(db, "inventario-vcorp-hw", "h1", { modelo: "Latitude 5440" }));
  await assertSucceeds(criarPerfil(db, "inventario-vcorp-sw", "s1", { hostname: "NB-VC1", nomeAplicacao: "Office", versao: "2021", mesAno: "11/2026" }));
  const equipe = await equipeDavi();
  await assertFails(criarPerfil(equipe, "inventario-vcorp-hw", "h2", { hostname: "NB-VC2" }, { uid: "pc-davi", nome: "Davi Santos", email: DAVI }));
  await assertFails(editarPerfil(equipe, "inventario-vcorp-hw", "h1", { modelo: "X" }, { uid: "pc-davi", nome: "Davi Santos", email: DAVI }));
});
test("VCORP/VCERT: gestor não exclui, não usa coluna fora das liberadas, não assina por outra pessoa e respeita o formato", async () => {
  const db = await gestora();
  await assertSucceeds(criarPerfil(db, "inventario-vcorp-hw", "h1", { hostname: "NB-VC1" }));
  await assertFails(deleteDoc(doc(db, "inventario-vcorp-hw", "h1")));
  await assertFails(editarPerfil(db, "inventario-vcorp-hw", "h1", { custo: "100" }));
  await assertFails(criarPerfil(db, "inventario-vcorp-hw", "h3", { hostname: "NB-VC3" }, { nome: "Outra Pessoa" }));
  await assertFails(criarPerfil(db, "inventario-vcorp-hw", "h4", { hostname: "nb vc4" }));
  await assertFails(criarPerfil(db, "inventario-vcorp-sw", "s2", { hostname: "NB-VC1", nomeAplicacao: "Office", mesAno: "11/2026" }));
  await assertFails(criarPerfil(db, "inventario-vcorp-hw", "h5", { hostname: "NB-VC5" }, { extra: { importacao: "imp-1" } }));
});
test("VCORP/VCERT: histórico do gestor só entra junto com a própria mudança", async () => {
  const db = await gestora();
  await assertSucceeds(criarPerfil(db, "inventario-vcorp-hw", "h1", { hostname: "NB-VC1" }));
  await assertFails(setDoc(doc(db, "inventario-vcorp-hw", "h1", "historico", "solto"), { acao: "editar", coluna: "", colunaNome: "", antes: "", depois: "x", por: "pc-gestora", porNome: "Gestora Teste", porEmail: GESTORA, em: serverTimestamp() }));
});

/* ---------- Aparência livre: padrão do Inventário (inventario-config/aparencia e aparencia-imagem) ---------- */
const LAYS = "lays.almeida@valid.com";
const TEMA = {
  v: 1, nome: "Floresta", alto: false, base: { destaque: "#2f7d4f", fundo: "#edf5ee", grade: "#ffffff" },
  avancado: { claro: {}, escuro: {} }, listas: { claro: { verde: { c: "#1b5e20", f: "#dff3e0" } }, escuro: {} },
  fundo: { tipo: "padrao", area: "pagina", cor: "#eef0f6", p: { forma: "pontos", cor: "#9b7fd4", fundo: "#f4f2f8", opacidade: 35, escala: 24, rotacao: 0 }, temImagem: false },
  grade: { solida: false, opacidade: 90, vidro: true, mono: ["hostname", "dna"] }, colunas: { hostname: { cab: "#1565c0", tom: "#1565c0", cheia: false } }
};
const aparencia = (por, extra = {}) => ({ tema: TEMA, regras: [{ id: "r1", ativa: true, col: "status", cond: "em", valores: ["baixado-descartado"], alvo: "linha", fundo: "#e53935" }], permitirPessoal: true, atualizadoEm: serverTimestamp(), atualizadoPor: por, ...extra });
const IMAGEM = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
test("aparência: administradora grava o padrão e a imagem; a equipe lê; ninguém de fora lê", async () => {
  await assertSucceeds(setDoc(doc(admin(), "inventario-config", "aparencia"), aparencia(LAYS)));
  await assertSucceeds(setDoc(doc(admin(), "inventario-config", "aparencia-imagem"), { imagem: IMAGEM, atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  const db = await equipeDavi("ap1");
  await assertSucceeds(getDoc(doc(db, "inventario-config", "aparencia")));
  await assertSucceeds(getDoc(doc(db, "inventario-config", "aparencia-imagem")));
  await assertFails(getDoc(doc(anonimo("de-fora"), "inventario-config", "aparencia")));
  await assertSucceeds(getDoc(doc(anonimo("de-fora"), "inventario-config", "estrutura")));
});
test("aparência: a equipe não grava, não altera e não apaga o padrão", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "inventario-config", "aparencia"), { ...aparencia(LAYS), atualizadoEm: antes(1) }); });
  const db = await equipeDavi("ap2");
  await assertFails(setDoc(doc(db, "inventario-config", "aparencia"), aparencia(DAVI)));
  await assertFails(updateDoc(doc(db, "inventario-config", "aparencia"), { permitirPessoal: false, atualizadoEm: serverTimestamp(), atualizadoPor: DAVI }));
  await assertFails(setDoc(doc(db, "inventario-config", "aparencia-imagem"), { imagem: IMAGEM, atualizadoEm: serverTimestamp(), atualizadoPor: DAVI }));
  await assertFails(deleteDoc(doc(db, "inventario-config", "aparencia")));
});
test("aparência: chaves, tipos, faixas e tamanhos validados; a administradora remove", async () => {
  const db = admin();
  await assertFails(setDoc(doc(db, "inventario-config", "aparencia"), aparencia(LAYS, { css: "x" })));
  await assertFails(setDoc(doc(db, "inventario-config", "aparencia"), aparencia(LAYS, { tema: { ...TEMA, base: { destaque: "#12345" } } })));
  await assertFails(setDoc(doc(db, "inventario-config", "aparencia"), aparencia(LAYS, { regras: Array.from({ length: 31 }, (_, i) => ({ id: "r" + i })) })));
  await assertFails(setDoc(doc(db, "inventario-config", "aparencia-imagem"), { imagem: "javascript:alert(1)", atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertSucceeds(setDoc(doc(db, "inventario-config", "aparencia"), aparencia(LAYS)));
  await assertSucceeds(deleteDoc(doc(db, "inventario-config", "aparencia")));
});
