/*
 * Testes do firestore.rules (bloco CADEIAS V6 / V12) no Emulador do Firestore.
 * Precisa de Node 18+, Java 11+ e firebase-tools. Na pasta sites/cadeias-testes:
 *   npm install      (ou use o node_modules de sites/inventario-testes)
 *   npm test
 * (o "npm test" sobe o Emulador na porta do firebase.json e roda este arquivo).
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, writeBatch, serverTimestamp, increment, Timestamp } from "firebase/firestore";

/* Igual a normalizarNomeChave() do app.js */
const chave = (t) => String(t ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim();
const N2 = "n2@valid.com", LEITOR = "leitor@valid.com", BIA = "bia@valid.com";
const antes = (dias) => Timestamp.fromDate(new Date(Date.now() - dias * 86400000));
let seq = 0;
const ordem = (amb) => `${amb}|${String(Date.now()).padStart(13, "0")}|${String(++seq % 10000).padStart(4, "0")}`;

/* Estrutura de V12 (a de V6 é igual): CÓDIGO (chave, travado após criar), NOME (livre), STATUS (lista), OBS (bloqueado) */
const ESTRUTURA = {
  nome: "V12", descricao: "Cadeia V12", cor: "#2e7d32", titulo: "CADEIA V12", versao: 1, categorias: [],
  colunas: [
    { id: "codigo", nome: "CÓDIGO", tipo: "texto", acesso: "travado" },
    { id: "nome", nome: "NOME", tipo: "texto", acesso: "livre" },
    { id: "status", nome: "STATUS", tipo: "status", acesso: "lista", opcoes: [{ id: "ativo", nome: "Ativo" }, { id: "inativo", nome: "Inativo" }, { id: "antigo", nome: "Antigo", ativa: false }] },
    { id: "obs", nome: "OBS", tipo: "texto", acesso: "bloqueado", somenteAdmin: true }
  ],
  gruposColunas: [{ id: "geral", nome: "Geral", ordem: 1 }],
  regras: { equipeEdita: "todas", janelaEdicaoHoras: 0, exportacao: true },
  colunasEquipe: ["codigo", "nome", "status"], colunasTravadas: ["codigo"], listasEquipe: { status: ["ativo", "inativo"] }, listasOrdem: ["status"],
  colunaChave: "codigo", colunaAbas: "", colunaResumo: "status", configurado: true
};

let env;
const anonimo = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();
const admin = () => env.authenticatedContext("lays", { email: "lays.almeida@valid.com", email_verified: true, firebase: { sign_in_provider: "password" } }).firestore();
const identidade = (email, nome, extra = {}) => ({
  email, nome, nomeChave: chave(nome), perfil: "equipe", ativo: true, aprovado: true,
  criadoEm: antes(10), criadoPorUid: "uid-antigo", atualizadoEm: antes(10), ...extra
});
const vincular = (db, uid, email, nome, colecao = "cadeias-pessoas") =>
  setDoc(doc(db, colecao, uid), { email, nomeChave: chave(nome), vinculadoEm: serverTimestamp(), ultimoAcesso: serverTimestamp() }, { merge: true });
function cadastroNovo(db, uid, email, nome, extra = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "cadeias-identidades", email), {
    email, nome, nomeChave: chave(nome), perfil: "equipe", ativo: true, aprovado: false,
    criadoEm: serverTimestamp(), criadoPorUid: uid, atualizadoEm: serverTimestamp(), ...extra
  });
  b.set(doc(db, "cadeias-emails", email), {});
  b.set(doc(db, "cadeias-pessoas", uid), { email, nomeChave: chave(nome), vinculadoEm: serverTimestamp(), ultimoAcesso: serverTimestamp() }, { merge: true });
  return b.commit();
}
const autoria = (prefixo, uid, nome, email) => ({ [`${prefixo}Por`]: uid, [`${prefixo}PorNome`]: nome, [`${prefixo}PorEmail`]: email, [`${prefixo}Em`]: serverTimestamp() });
/* Como o app grava (mesmo lote): registro + índice da chave + histórico da linha + últimas mudanças + contadores */
function criarRegistro(db, uid, loc, id, campos, { nome = "Nina Dois", email = N2, semExtras = false, contagem = 1, ambiente = "v12", acao = "criar" } = {}) {
  const b = writeBatch(db);
  const numero = campos.codigo ? String(campos.codigo).trim().replace(/\//g, "|") : "";
  b.set(doc(db, "cadeias-localidades", loc, "registros", id), { campos, numero, ...autoria("criado", uid, nome, email), ...autoria("atualizado", uid, nome, email), exclusao: null });
  if (numero) b.set(doc(db, "cadeias-localidades", loc, "chaves", numero), { registro: id });
  if (!semExtras) {
    b.set(doc(db, "cadeias-localidades", loc, "registros", id, "historico", `h-${id}`), { acao, coluna: "", colunaNome: "", antes: "", depois: numero, por: uid, porNome: nome, porEmail: email, em: serverTimestamp() });
    b.set(doc(db, "cadeias-historico", `m-${id}`), { ambiente, localidade: loc, localidadeNome: "Barueri", registro: id, registroNome: numero, acao, coluna: "", colunaNome: "", antes: "", depois: numero, por: uid, porNome: nome, ordem: ordem(ambiente), em: serverTimestamp() });
    b.set(doc(db, "cadeias-localidades", loc), { contagem: increment(contagem), atualizadoEm: serverTimestamp(), atualizadoPor: uid, atualizadoPorNome: nome, ultimoRegistro: id, hoje: { dia: "2026-11-11", n: 1 } }, { merge: true });
  }
  return b.commit();
}
function editarRegistro(db, uid, loc, id, mudancas, { nome = "Nina Dois", email = N2, coluna = Object.keys(mudancas)[0], espelho = true } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "cadeias-localidades", loc, "registros", id), { campos: mudancas, ...autoria("atualizado", uid, nome, email) }, { merge: true });
  b.set(doc(db, "cadeias-localidades", loc, "registros", id, "historico", `e-${Date.now()}-${++seq}`), { acao: "editar", coluna, colunaNome: coluna.toUpperCase(), antes: "x", depois: "y", por: uid, porNome: nome, porEmail: email, em: serverTimestamp() });
  if (espelho) b.set(doc(db, "cadeias-historico", `me-${Date.now()}-${seq}`), { ambiente: "v12", localidade: loc, localidadeNome: "Barueri", registro: id, registroNome: "A1", acao: "editar", coluna, colunaNome: coluna.toUpperCase(), antes: "x", depois: "y", por: uid, porNome: nome, ordem: ordem("v12"), em: serverTimestamp() });
  b.set(doc(db, "cadeias-localidades", loc), { atualizadoEm: serverTimestamp(), atualizadoPor: uid, atualizadoPorNome: nome, ultimoRegistro: id }, { merge: true });
  return b.commit();
}
async function entrar(uid, email, nome) {
  const db = anonimo(uid);
  await vincular(db, uid, email, nome);
  return db;
}
const equipeN2 = (uid = "pc-n2") => entrar(uid, N2, "Nina Dois");
const leitor = (uid = "pc-leitor") => entrar(uid, LEITOR, "Leo Leitor");

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-cadeias",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "cadeias-ambientes", "v12"), { ...ESTRUTURA, atualizadoEm: antes(30), atualizadoPor: "lays.almeida@valid.com" });
    await setDoc(doc(db, "cadeias-ambientes", "v6"), { ...ESTRUTURA, nome: "V6", titulo: "CADEIA V6", cor: "#1f5f8b", atualizadoEm: antes(30), atualizadoPor: "lays.almeida@valid.com" });
    await setDoc(doc(db, "cadeias-grupos", "g1"), { ambiente: "v12", nome: "Sudeste", ordem: 1 });
    const loc = (ambiente) => ({ ambiente, grupo: "g1", nome: "São Paulo - Barueri", ordem: 1, ativa: true, colunasExtras: [], colunasEquipeExtras: [], contagem: 1, resumo: { ativo: 1 }, hoje: null, atualizadoEm: antes(2), atualizadoPor: "uid-a", atualizadoPorNome: "Nina Dois", ultimoRegistro: "r1" });
    await setDoc(doc(db, "cadeias-localidades", "L12"), loc("v12"));
    await setDoc(doc(db, "cadeias-localidades", "L6"), loc("v6"));
    await setDoc(doc(db, "cadeias-localidades", "L12", "registros", "r1"), {
      campos: { codigo: "A1", nome: "Loja 1", status: "ativo", obs: "só admin" }, numero: "A1",
      criadoPor: "uid-a", criadoPorNome: "Nina Dois", criadoPorEmail: N2, criadoEm: antes(2),
      atualizadoPor: "uid-a", atualizadoPorNome: "Nina Dois", atualizadoPorEmail: N2, atualizadoEm: antes(2), exclusao: null
    });
    await setDoc(doc(db, "cadeias-localidades", "L12", "chaves", "A1"), { registro: "r1" });
    await setDoc(doc(db, "cadeias-localidades", "L12", "registros", "r1", "historico", "h0"), { acao: "criar", coluna: "", colunaNome: "", antes: "", depois: "A1", por: "uid-a", porNome: "Nina Dois", porEmail: N2, em: antes(2) });
    await setDoc(doc(db, "cadeias-historico", "m0"), { ambiente: "v12", localidade: "L12", localidadeNome: "Barueri", registro: "r1", registroNome: "A1", acao: "criar", coluna: "", colunaNome: "", antes: "", depois: "A1", por: "uid-a", porNome: "Nina Dois", ordem: "v12|0000000000001|0001", em: antes(2) });
    await setDoc(doc(db, "cadeias-identidades", N2), identidade(N2, "Nina Dois", { perfil: "equipe-n2" }));
    await setDoc(doc(db, "cadeias-emails", N2), {});
    await setDoc(doc(db, "cadeias-identidades", LEITOR), identidade(LEITOR, "Leo Leitor"));
    await setDoc(doc(db, "cadeias-emails", LEITOR), {});
    await setDoc(doc(db, "cadeias-identidades", "bloqueado@valid.com"), identidade("bloqueado@valid.com", "Pessoa Bloqueada", { ativo: false }));
    await setDoc(doc(db, "cadeias-emails", "bloqueado@valid.com"), {});
    /* Bia: liberada no Inventário e no Banco de Tickets, sem cadastro no Cadeias */
    await setDoc(doc(db, "inventario-identidades", BIA), { ...identidade(BIA, "Bia Souza"), papel: "equipe" });
    await setDoc(doc(db, "inventario-emails", BIA), {});
    await setDoc(doc(db, "tickets-identidades", BIA), { ...identidade(BIA, "Bia Souza"), papel: "equipe" });
    await setDoc(doc(db, "tickets-emails", BIA), {});
  });
});

/* ---------- Entrada (igual ao Banco de Tickets e ao Inventário, com cadastros próprios) ---------- */
test("e-mail cadastrado + nome certo: liga o aparelho e lê V6 e V12", async () => {
  const db = anonimo("b1");
  await assertSucceeds(vincular(db, "b1", N2, "Nina Dois"));
  await assertSucceeds(getDocs(collection(db, "cadeias-localidades")));
  await assertSucceeds(getDoc(doc(db, "cadeias-ambientes", "v6")));
  await assertSucceeds(getDocs(collection(db, "cadeias-localidades", "L12", "registros")));
  await assertSucceeds(getDocs(collection(db, "cadeias-localidades", "L6", "registros")));
});
test("nome errado: recusa; acento, maiúscula e espaços diferentes: liga", async () => {
  await assertFails(vincular(anonimo("b2"), "b2", N2, "Nina Tres"));
  await assertSucceeds(vincular(anonimo("b3"), "b3", N2, "  nina   DOIS. "));
});
test("e-mail novo: cria o cadastro aguardando liberação (perfil Equipe) e não lê nada", async () => {
  const db = anonimo("n1");
  await assertSucceeds(cadastroNovo(db, "n1", "nova@valid.com", "Ângela Müller-Çelik"));
  await assertSucceeds(getDoc(doc(db, "cadeias-identidades", "nova@valid.com")));
  await assertFails(getDocs(collection(db, "cadeias-localidades")));
  await assertFails(getDoc(doc(db, "cadeias-ambientes", "v12")));
});
test("cadastro novo já aprovado, como Equipe N2, com nomeChave errado ou e-mail já cadastrado: recusa", async () => {
  await assertFails(cadastroNovo(anonimo("n2"), "n2", "x1@valid.com", "Outra Pessoa", { aprovado: true }));
  await assertFails(cadastroNovo(anonimo("n3"), "n3", "x2@valid.com", "Outra Pessoa", { perfil: "equipe-n2" }));
  await assertFails(cadastroNovo(anonimo("n4"), "n4", "x3@valid.com", "Outra Pessoa", { nomeChave: "qualquer" }));
  await assertFails(cadastroNovo(anonimo("n5"), "n5", N2, "Nina Dois"));
});
test("e-mail de administradora na entrada da equipe: recusa", async () => {
  await assertFails(cadastroNovo(anonimo("n6"), "n6", "lays.almeida@valid.com", "Lays Almeida"));
});
test("Lays libera como Equipe N2: o mesmo aparelho passa a ler e a gravar", async () => {
  const db = anonimo("n7");
  await assertSucceeds(cadastroNovo(db, "n7", "maria@valid.com", "Maria Teste"));
  await assertFails(getDocs(collection(db, "cadeias-localidades")));
  await assertSucceeds(updateDoc(doc(admin(), "cadeias-identidades", "maria@valid.com"), { aprovado: true, perfil: "equipe-n2", atualizadoEm: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(db, "cadeias-localidades")));
  await assertSucceeds(criarRegistro(db, "n7", "L12", "rm", { codigo: "M1", nome: "Maria", status: "ativo" }, { nome: "Maria Teste", email: "maria@valid.com" }));
});
test("perfil inválido na liberação: recusa", async () => {
  await assertFails(updateDoc(doc(admin(), "cadeias-identidades", LEITOR), { perfil: "admin", atualizadoEm: serverTimestamp() }));
});
test("identidade bloqueada: liga o aparelho, mas não lê", async () => {
  const db = anonimo("bl");
  await assertSucceeds(vincular(db, "bl", "bloqueado@valid.com", "Pessoa Bloqueada"));
  await assertFails(getDocs(collection(db, "cadeias-localidades")));
});
test("Desconectar todos os aparelhos: o aparelho antigo perde o acesso; ligando de novo, volta", async () => {
  const db = await equipeN2("ap1");
  await assertSucceeds(getDocs(collection(db, "cadeias-localidades")));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "cadeias-identidades", N2), { revogadoAntesDe: Timestamp.fromDate(new Date(Date.now() + 1000)) }));
  await assertFails(getDocs(collection(db, "cadeias-localidades")));
  await new Promise((r) => setTimeout(r, 1100));
  await assertSucceeds(vincular(db, "ap1", N2, "Nina Dois"));
  await assertSucceeds(getDocs(collection(db, "cadeias-localidades")));
});
test("equipe não lê nem lista identidades de outras pessoas; cadeias-emails não se lista", async () => {
  const db = await equipeN2();
  await assertSucceeds(getDoc(doc(db, "cadeias-identidades", N2)));
  await assertFails(getDoc(doc(db, "cadeias-identidades", LEITOR)));
  await assertFails(getDocs(collection(db, "cadeias-identidades")));
  await assertSucceeds(getDoc(doc(db, "cadeias-emails", LEITOR)));
  await assertFails(getDocs(collection(db, "cadeias-emails")));
});
test("ninguém liga o aparelho de outro uid", async () => {
  await assertFails(vincular(anonimo("x"), "outro-uid", N2, "Nina Dois"));
});
test("pessoa liberada no Inventário ou no Banco de Tickets NÃO lê o Cadeias", async () => {
  const db = anonimo("pc-bia");
  await assertSucceeds(vincular(db, "pc-bia", BIA, "Bia Souza", "inventario-pessoas"));
  await assertSucceeds(vincular(db, "pc-bia", BIA, "Bia Souza", "tickets-pessoas"));
  await assertFails(getDocs(collection(db, "cadeias-localidades")));
  await assertFails(getDoc(doc(db, "cadeias-ambientes", "v6")));
  await assertFails(vincular(db, "pc-bia", BIA, "Bia Souza"));
  await assertFails(getDocs(collection(db, "cadeias-localidades", "L12", "registros")));
});
test("sem login: nada", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDocs(collection(db, "cadeias-localidades")));
  await assertFails(getDoc(doc(db, "cadeias-config", "entrada")));
});

/* ---------- Equipe (só leitura) ---------- */
test("Equipe lê V6 e V12, mas não grava registro (nem pelo console) e não lê as últimas mudanças", async () => {
  const db = await leitor();
  await assertSucceeds(getDocs(collection(db, "cadeias-localidades", "L12", "registros")));
  await assertSucceeds(getDocs(collection(db, "cadeias-localidades", "L6", "registros")));
  await assertFails(criarRegistro(db, "pc-leitor", "L12", "rl", { codigo: "L1", nome: "x" }, { nome: "Leo Leitor", email: LEITOR }));
  await assertFails(criarRegistro(db, "pc-leitor", "L12", "rl2", { nome: "x" }, { nome: "Leo Leitor", email: LEITOR, semExtras: true }));
  await assertFails(updateDoc(doc(db, "cadeias-localidades", "L12", "registros", "r1"), { "campos.nome": "y", atualizadoPor: "pc-leitor", atualizadoPorNome: "Leo Leitor", atualizadoPorEmail: LEITOR, atualizadoEm: serverTimestamp() }));
  await assertFails(getDocs(collection(db, "cadeias-historico")));
  await assertFails(getDocs(collection(db, "cadeias-localidades", "L12", "registros", "r1", "historico")));
  await assertFails(setDoc(doc(db, "cadeias-localidades", "L12"), { contagem: 5 }, { merge: true }));
});

/* ---------- Equipe N2 ---------- */
test("Equipe N2 cria registro (com índice, histórico, últimas mudanças e contadores no mesmo lote) e lê as últimas mudanças", async () => {
  const db = await equipeN2();
  await assertSucceeds(criarRegistro(db, "pc-n2", "L12", "r2", { codigo: "B2", nome: "Loja 2", status: "inativo" }));
  await assertSucceeds(getDocs(query(collection(db, "cadeias-historico"), where("ordem", ">=", "v12|"), where("ordem", "<", "v12}"), orderBy("ordem", "desc"), limit(15))));
  await assertSucceeds(getDocs(query(collection(db, "cadeias-historico"), orderBy("em", "desc"), limit(15))));
  const l = await getDoc(doc(db, "cadeias-localidades", "L12"));
  if (l.data().contagem !== 2) throw new Error(`contagem ${l.data().contagem}`);
});
test("Equipe N2: cinco registros num lote só (como o app divide) passam", async () => {
  const db = await equipeN2();
  const b = writeBatch(db);
  for (let i = 0; i < 5; i++) {
    const id = `lote${i}`, numero = `L-${i}`;
    b.set(doc(db, "cadeias-localidades", "L12", "registros", id), { campos: { codigo: numero, nome: `n${i}`, status: "ativo" }, numero, ...autoria("criado", "pc-n2", "Nina Dois", N2), ...autoria("atualizado", "pc-n2", "Nina Dois", N2), exclusao: null });
    b.set(doc(db, "cadeias-localidades", "L12", "chaves", numero), { registro: id });
    b.set(doc(db, "cadeias-localidades", "L12", "registros", id, "historico", `h${i}`), { acao: "preencherMassa", coluna: "", colunaNome: "", antes: "", depois: numero, por: "pc-n2", porNome: "Nina Dois", porEmail: N2, em: serverTimestamp() });
    b.set(doc(db, "cadeias-historico", `mm${i}`), { ambiente: "v12", localidade: "L12", localidadeNome: "Barueri", registro: id, registroNome: numero, acao: "preencherMassa", coluna: "", colunaNome: "", antes: "", depois: numero, por: "pc-n2", porNome: "Nina Dois", ordem: ordem("v12"), em: serverTimestamp() });
  }
  b.set(doc(db, "cadeias-localidades", "L12"), { contagem: increment(5), atualizadoEm: serverTimestamp(), atualizadoPor: "pc-n2", atualizadoPorNome: "Nina Dois", ultimoRegistro: "lote4" }, { merge: true });
  await assertSucceeds(b.commit());
});
test("Equipe N2: colar sobre a seleção (5 registros × 2 colunas, com histórico e últimas mudanças) cabe num lote", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (let i = 0; i < 5; i++) await setDoc(doc(db, "cadeias-localidades", "L12", "registros", `e${i}`), { campos: { codigo: `E${i}`, nome: "a", status: "ativo" }, numero: `E${i}`, criadoPor: "x", criadoPorNome: "x", criadoPorEmail: N2, criadoEm: antes(1), atualizadoPor: "x", atualizadoPorNome: "x", atualizadoPorEmail: N2, atualizadoEm: antes(1), exclusao: null });
  });
  const db = await equipeN2();
  const b = writeBatch(db);
  for (let i = 0; i < 5; i++) {
    const id = `e${i}`;
    b.set(doc(db, "cadeias-localidades", "L12", "registros", id), { campos: { nome: `novo ${i}`, status: "inativo" }, ...autoria("atualizado", "pc-n2", "Nina Dois", N2) }, { merge: true });
    ["nome", "status"].forEach((c) => {
      b.set(doc(db, "cadeias-localidades", "L12", "registros", id, "historico", `c${i}${c}`), { acao: "editarMassa", coluna: c, colunaNome: c.toUpperCase(), antes: "a", depois: "b", por: "pc-n2", porNome: "Nina Dois", porEmail: N2, em: serverTimestamp() });
      b.set(doc(db, "cadeias-historico", `mc${i}${c}`), { ambiente: "v12", localidade: "L12", localidadeNome: "Barueri", registro: id, registroNome: `E${i}`, acao: "editarMassa", coluna: c, colunaNome: c.toUpperCase(), antes: "a", depois: "b", por: "pc-n2", porNome: "Nina Dois", ordem: ordem("v12"), em: serverTimestamp() });
    });
  }
  b.set(doc(db, "cadeias-localidades", "L12"), { atualizadoEm: serverTimestamp(), atualizadoPor: "pc-n2", atualizadoPorNome: "Nina Dois", ultimoRegistro: "e4", resumo: { ativo: increment(-5), inativo: increment(5) } }, { merge: true });
  await assertSucceeds(b.commit());
});
test("Equipe N2 edita LIVRE e LISTA (opção ativa); não edita BLOQUEADO, a coluna chave nem opção removida", async () => {
  const db = await equipeN2();
  await assertSucceeds(editarRegistro(db, "pc-n2", "L12", "r1", { nome: "Loja 1 nova" }));
  await assertSucceeds(editarRegistro(db, "pc-n2", "L12", "r1", { status: "inativo" }));
  await assertFails(editarRegistro(db, "pc-n2", "L12", "r1", { status: "inventado" }));
  await assertFails(editarRegistro(db, "pc-n2", "L12", "r1", { status: "antigo" }));
  await assertFails(editarRegistro(db, "pc-n2", "L12", "r1", { obs: "mudei" }));
  await assertFails(editarRegistro(db, "pc-n2", "L12", "r1", { codigo: "Z9" }));
});
test("Equipe N2 cria com coluna BLOQUEADA ou chave repetida: recusa; em nome de outra pessoa: recusa", async () => {
  const db = await equipeN2();
  await assertFails(criarRegistro(db, "pc-n2", "L12", "r3", { codigo: "C3", obs: "x" }));
  await assertFails(criarRegistro(db, "pc-n2", "L12", "r4", { codigo: "A1", nome: "repetido" }));
  await assertFails(criarRegistro(db, "pc-n2", "L12", "r5", { codigo: "C5" }, { nome: "Outra Pessoa" }));
});
test("Equipe N2 pede exclusão, mas não exclui de vez", async () => {
  const db = await equipeN2();
  await assertSucceeds(updateDoc(doc(db, "cadeias-localidades", "L12", "registros", "r1"), {
    exclusao: { motivo: "duplicado", por: "pc-n2", porNome: "Nina Dois", porEmail: N2, em: serverTimestamp() },
    atualizadoPor: "pc-n2", atualizadoPorNome: "Nina Dois", atualizadoPorEmail: N2, atualizadoEm: serverTimestamp()
  }));
  await assertFails(deleteDoc(doc(db, "cadeias-localidades", "L12", "registros", "r1")));
  await assertFails(deleteDoc(doc(db, "cadeias-localidades", "L12", "chaves", "A1")));
  await assertFails(setDoc(doc(db, "cadeias-lixeira", "r1"), { dados: {}, planilha: "L12" }));
});
test("Equipe N2 não mexe na estrutura, nas localidades nem nos grupos", async () => {
  const db = await equipeN2();
  await assertFails(setDoc(doc(db, "cadeias-ambientes", "v12"), { colunasEquipe: ["codigo", "nome", "status", "obs"] }, { merge: true }));
  await assertFails(setDoc(doc(db, "cadeias-localidades", "L12"), { nome: "Outro nome" }, { merge: true }));
  await assertFails(setDoc(doc(db, "cadeias-localidades", "LX"), { ambiente: "v12", nome: "Nova" }));
  await assertFails(deleteDoc(doc(db, "cadeias-localidades", "L12")));
  await assertFails(setDoc(doc(db, "cadeias-grupos", "g2"), { ambiente: "v12", nome: "Sul", ordem: 2 }));
  await assertFails(setDoc(doc(db, "cadeias-localidades", "L12", "arquivo", "v1-000"), { versao: 1, indice: 0, total: 1, json: "{}", criadoPor: N2, criadoEm: serverTimestamp() }));
  await assertFails(getDocs(collection(db, "cadeias-auditoria")));
  await assertFails(getDocs(collection(db, "cadeias-lixeira")));
  await assertFails(getDocs(collection(db, "cadeias-backups")));
});

/* ---------- Contadores e últimas mudanças só junto de uma gravação real ---------- */
test("contadores da localidade: sem gravar um registro de verdade, não mudam", async () => {
  const db = await equipeN2();
  await assertFails(setDoc(doc(db, "cadeias-localidades", "L12"), { contagem: 99, atualizadoEm: serverTimestamp(), atualizadoPor: "pc-n2", atualizadoPorNome: "Nina Dois", ultimoRegistro: "r1" }, { merge: true }));
  await assertFails(setDoc(doc(db, "cadeias-localidades", "L12"), { contagem: increment(1), atualizadoEm: serverTimestamp(), atualizadoPor: "pc-n2", atualizadoPorNome: "Nina Dois", ultimoRegistro: "naoexiste" }, { merge: true }));
  /* Diminuir (a Equipe N2 não exclui) também é recusado, mesmo junto de uma gravação */
  const b = writeBatch(db);
  b.set(doc(db, "cadeias-localidades", "L12", "registros", "r1"), { campos: { nome: "z" }, ...autoria("atualizado", "pc-n2", "Nina Dois", N2) }, { merge: true });
  b.set(doc(db, "cadeias-localidades", "L12"), { contagem: increment(-1), atualizadoEm: serverTimestamp(), atualizadoPor: "pc-n2", atualizadoPorNome: "Nina Dois", ultimoRegistro: "r1" }, { merge: true });
  await assertFails(b.commit());
});
test("últimas mudanças: sem mudança real do registro, a Equipe N2 não cria; ninguém edita nem apaga", async () => {
  const db = await equipeN2();
  await assertFails(setDoc(doc(db, "cadeias-historico", "falso"), { ambiente: "v12", localidade: "L12", localidadeNome: "Barueri", registro: "r1", registroNome: "A1", acao: "editar", coluna: "nome", colunaNome: "NOME", antes: "a", depois: "b", por: "pc-n2", porNome: "Nina Dois", ordem: ordem("v12"), em: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, "cadeias-historico", "m0"), { depois: "outro" }));
  await assertFails(deleteDoc(doc(admin(), "cadeias-historico", "m0")));
  /* Ambiente trocado (V6 numa localidade de V12): recusa */
  const b = writeBatch(db);
  b.set(doc(db, "cadeias-localidades", "L12", "registros", "r1"), { campos: { nome: "w" }, ...autoria("atualizado", "pc-n2", "Nina Dois", N2) }, { merge: true });
  b.set(doc(db, "cadeias-historico", "trocado"), { ambiente: "v6", localidade: "L12", localidadeNome: "Barueri", registro: "r1", registroNome: "A1", acao: "editar", coluna: "nome", colunaNome: "NOME", antes: "a", depois: "w", por: "pc-n2", porNome: "Nina Dois", ordem: ordem("v6"), em: serverTimestamp() });
  await assertFails(b.commit());
});

/* ---------- Administradoras ---------- */
test("administradora grava estrutura, localidade, grupo, exclui de vez e lê a auditoria; a sem senha não", async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, "cadeias-ambientes", "v6"), { descricao: "Nova descrição", atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com" }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, "cadeias-grupos", "g2"), { ambiente: "v12", nome: "Sul", ordem: 2, atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com" }));
  await assertSucceeds(setDoc(doc(db, "cadeias-localidades", "L12"), { nome: "Barueri (SP)", atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com" }, { merge: true }));
  await assertSucceeds(deleteDoc(doc(db, "cadeias-localidades", "L12", "registros", "r1")));
  await assertSucceeds(getDocs(collection(db, "cadeias-auditoria")));
  await assertSucceeds(getDocs(collection(db, "cadeias-identidades")));
  const semSenha = env.authenticatedContext("lays2", { email: "lays.almeida@valid.com", firebase: { sign_in_provider: "google.com" } }).firestore();
  await assertFails(setDoc(doc(semSenha, "cadeias-ambientes", "v6"), { descricao: "x" }, { merge: true }));
});
test("administradora: a localidade não muda de ambiente; estrutura com chaves estranhas é recusada", async () => {
  const db = admin();
  await assertFails(setDoc(doc(db, "cadeias-localidades", "L12"), { ambiente: "v6" }, { merge: true }));
  await assertFails(setDoc(doc(db, "cadeias-ambientes", "v12"), { hackeado: true, atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com" }, { merge: true }));
  await assertFails(setDoc(doc(db, "cadeias-ambientes", "v99"), { nome: "V99", atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com" }));
});
test("auditoria: Equipe registra só entrar/exportar; Equipe N2 também as próprias edições; ninguém lê além das administradoras", async () => {
  const ev = (por, acao) => ({ acao, resumo: "x", detalhes: "", por, porNome: "n", porEmail: "e", planilha: "", ambiente: "v12", alvo: "", mudancas: [], em: serverTimestamp() });
  const l = await leitor();
  await assertSucceeds(setDoc(doc(l, "cadeias-auditoria", "a1"), ev("pc-leitor", "entrar")));
  await assertFails(setDoc(doc(l, "cadeias-auditoria", "a2"), ev("pc-leitor", "editar")));
  const n = await equipeN2();
  await assertSucceeds(setDoc(doc(n, "cadeias-auditoria", "a3"), ev("pc-n2", "editar")));
  await assertFails(setDoc(doc(n, "cadeias-auditoria", "a4"), ev("pc-n2", "estrutura")));
  await assertFails(getDocs(collection(n, "cadeias-auditoria")));
});
test("aparência e regras de cadastro: só administradoras gravam; a entrada é legível antes do cadastro", async () => {
  await assertSucceeds(setDoc(doc(admin(), "cadeias-config", "entrada"), { aberto: false, dominios: ["valid.com"], aprovacao: true, atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com" }));
  await assertSucceeds(getDoc(doc(anonimo("novo"), "cadeias-config", "entrada")));
  await assertFails(cadastroNovo(anonimo("n8"), "n8", "fechado@valid.com", "Pessoa Fechada"));
  const n = await equipeN2();
  await assertFails(setDoc(doc(n, "cadeias-config", "entrada"), { aberto: true, dominios: [], aprovacao: true }));
  await assertFails(setDoc(doc(n, "cadeias-config", "aparencia-v6"), { tema: null, regras: [], permitirPessoal: true, atualizadoPor: N2 }));
  await assertFails(getDoc(doc(anonimo("novo2"), "cadeias-config", "aparencia-v6")));
});
