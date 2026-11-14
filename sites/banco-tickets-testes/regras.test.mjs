/*
 * Testes do firestore.rules (bloco BANCO DE TICKETS) no Emulador do Firestore.
 * Precisa de Node 18+, Java 11+ e firebase-tools. Na pasta sites/banco-tickets-testes:
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
const antes = (dias) => Timestamp.fromDate(new Date(Date.now() - dias * 86400000));

let env;
const anonimo = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();
const admin = () => env.authenticatedContext("lays", { email: "lays.almeida@valid.com", email_verified: true, firebase: { sign_in_provider: "password" } }).firestore();
const identidade = (email, nome, extra = {}) => ({
  email, nome, nomeChave: chave(nome), papel: "equipe", ativo: true, aprovado: true,
  criadoEm: antes(10), criadoPorUid: "uid-antigo", atualizadoEm: antes(10), ...extra
});
const vincular = (db, uid, email, nome) => setDoc(doc(db, "tickets-pessoas", uid), { email, nomeChave: chave(nome), vinculadoEm: serverTimestamp(), ultimoAcesso: serverTimestamp() }, { merge: true });
function cadastroNovo(db, uid, email, nome, extra = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "tickets-identidades", email), {
    email, nome, nomeChave: chave(nome), papel: "equipe", ativo: true, aprovado: false,
    criadoEm: serverTimestamp(), criadoPorUid: uid, atualizadoEm: serverTimestamp(), ...extra
  });
  b.set(doc(db, "tickets-emails", email), {});
  b.set(doc(db, "tickets-pessoas", uid), { email, nomeChave: chave(nome), vinculadoEm: serverTimestamp(), ultimoAcesso: serverTimestamp() }, { merge: true });
  return b.commit();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-banco-tickets",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "tickets-config", "estrutura"), {
      titulo: "Banco de Tickets", versao: 1, categorias: [], colunas: [], gruposColunas: [],
      regras: { equipeEdita: "proprias", janelaEdicaoHoras: 0, exportacao: true, registro: { aberto: true, dominios: [], papelPadrao: "equipe", aprovacao: true } },
      /* "paula-katiele" (RESPONSÁVEL) e "ar-antiga" (AR SOLICITANTE) foram removidas da lista: não estão em listasEquipe */
      colunasEquipe: ["resumo", "responsavel", "arSolicitante"], listasEquipe: { responsavel: ["ana-souza", "bia-lima"], arSolicitante: ["ar-a", "ar-b"] },
      atualizadoEm: antes(30), atualizadoPor: "lays.almeida@valid.com"
    });
    await setDoc(doc(db, "tickets-identidades", DAVI), identidade(DAVI, "Davi Lopes"));
    await setDoc(doc(db, "tickets-emails", DAVI), {});
    await setDoc(doc(db, "tickets-identidades", "jose@valid.com"), identidade("jose@valid.com", "José Antônio Çaçapava"));
    await setDoc(doc(db, "tickets-emails", "jose@valid.com"), {});
    await setDoc(doc(db, "tickets-identidades", "bloqueado@valid.com"), identidade("bloqueado@valid.com", "Pessoa Bloqueada", { ativo: false }));
    await setDoc(doc(db, "tickets-emails", "bloqueado@valid.com"), {});
    /* Cadastro antigo (antes da unificação) */
    await setDoc(doc(db, "tickets-pessoas", "antigo"), { nome: "Ana Antiga", email: "ana@valid.com", papel: "equipe", ativo: true, pendente: false, criadoEm: antes(20), ultimoAcesso: antes(19) });
    await setDoc(doc(db, "tickets", "t1"), {
      campos: { resumo: "do Davi", responsavel: "paula-katiele", arSolicitante: ["ar-a", "ar-antiga"] }, numero: "", criadoPor: "uid-a", criadoPorNome: "Davi Lopes", criadoPorEmail: DAVI, criadoEm: antes(2),
      atualizadoPor: "uid-a", atualizadoPorNome: "Davi Lopes", atualizadoPorEmail: DAVI, atualizadoEm: antes(2), exclusao: null
    });
  });
});

test("e-mail cadastrado + nome certo: liga o aparelho e lê a planilha", async () => {
  const db = anonimo("b1");
  await assertSucceeds(vincular(db, "b1", DAVI, "Davi Lopes"));
  await assertSucceeds(getDocs(collection(db, "tickets")));
  await assertSucceeds(getDoc(doc(db, "tickets-identidades", DAVI)));
});
test("nome errado: recusa", async () => {
  await assertFails(vincular(anonimo("b2"), "b2", DAVI, "Davi Santos"));
});
test("acento, maiúscula e espaços diferentes: liga", async () => {
  await assertSucceeds(vincular(anonimo("b3"), "b3", DAVI, "  davi   LOPES. "));
  await assertSucceeds(vincular(anonimo("b4"), "b4", "jose@valid.com", "JOSE ANTONIO CACAPAVA"));
});
test("e-mail novo: cria o cadastro aguardando liberação (sem acesso à planilha)", async () => {
  const db = anonimo("n1");
  await assertSucceeds(cadastroNovo(db, "n1", "nova@valid.com", "Ângela Müller-Çelik"));
  await assertSucceeds(getDoc(doc(db, "tickets-identidades", "nova@valid.com")));
  await assertFails(getDocs(collection(db, "tickets")));
});
test("cadastro novo com nomeChave que não bate com o nome, aprovado sem liberação ou e-mail já cadastrado: recusa", async () => {
  await assertFails(cadastroNovo(anonimo("n2"), "n2", "outra@valid.com", "Outra Pessoa", { nomeChave: "qualquer coisa" }));
  await assertFails(cadastroNovo(anonimo("n3"), "n3", "outra2@valid.com", "Outra Pessoa", { aprovado: true }));
  await assertFails(cadastroNovo(anonimo("n4"), "n4", DAVI, "Davi Lopes"));
});
test("e-mail de administradora na entrada da equipe: recusa", async () => {
  await assertFails(cadastroNovo(anonimo("n5"), "n5", "lays.almeida@valid.com", "Lays Almeida"));
});
test("identidade bloqueada: liga, mas não lê a planilha", async () => {
  const db = anonimo("x1");
  await assertSucceeds(vincular(db, "x1", "bloqueado@valid.com", "Pessoa Bloqueada"));
  await assertFails(getDocs(collection(db, "tickets")));
});
test("Desconectar todos os aparelhos: o aparelho antigo perde o acesso; ligando de novo, volta", async () => {
  const db = anonimo("d1");
  await assertSucceeds(vincular(db, "d1", DAVI, "Davi Lopes"));
  await assertSucceeds(getDocs(collection(db, "tickets")));
  await new Promise((r) => setTimeout(r, 50));
  await assertSucceeds(updateDoc(doc(admin(), "tickets-identidades", DAVI), { revogadoAntesDe: serverTimestamp(), atualizadoEm: serverTimestamp() }));
  await assertFails(getDocs(collection(db, "tickets")));
  await assertSucceeds(vincular(db, "d1", DAVI, "Davi Lopes"));
  await assertSucceeds(getDocs(collection(db, "tickets")));
});
test("equipe não lê nem lista identidades de outras pessoas", async () => {
  const db = anonimo("e1");
  await assertSucceeds(vincular(db, "e1", DAVI, "Davi Lopes"));
  await assertFails(getDoc(doc(db, "tickets-identidades", "jose@valid.com")));
  await assertFails(getDocs(collection(db, "tickets-identidades")));
  await assertFails(getDoc(doc(anonimo("sem-aparelho"), "tickets-identidades", DAVI)));
});
test("tickets-emails: lê um e-mail por vez, mas não lista", async () => {
  const db = anonimo("m1");
  await assertSucceeds(getDoc(doc(db, "tickets-emails", DAVI)));
  await assertFails(getDocs(collection(db, "tickets-emails")));
});
test("ninguém liga o aparelho de outro uid nem muda papel/ativo pelo aparelho", async () => {
  await assertFails(vincular(anonimo("p1"), "p2", DAVI, "Davi Lopes"));
  const db = anonimo("p3");
  await assertSucceeds(vincular(db, "p3", DAVI, "Davi Lopes"));
  await assertFails(updateDoc(doc(db, "tickets-identidades", DAVI), { papel: "equipe", ativo: true, atualizadoEm: serverTimestamp() }));
});
test("regra \"próprias\": edita no computador B o que registrou no A; outra pessoa não", async () => {
  const b = anonimo("pc-b");
  await assertSucceeds(vincular(b, "pc-b", DAVI, "Davi Lopes"));
  await assertSucceeds(updateDoc(doc(b, "tickets", "t1"), { "campos.resumo": "editado no B", atualizadoPor: "pc-b", atualizadoPorNome: "Davi Lopes", atualizadoPorEmail: DAVI, atualizadoEm: serverTimestamp() }));
  const outro = anonimo("pc-j");
  await assertSucceeds(vincular(outro, "pc-j", "jose@valid.com", "José Antônio Çaçapava"));
  await assertFails(updateDoc(doc(outro, "tickets", "t1"), { "campos.resumo": "não", atualizadoPor: "pc-j", atualizadoPorNome: "José Antônio Çaçapava", atualizadoPorEmail: "jose@valid.com", atualizadoEm: serverTimestamp() }));
});
test("cadastro antigo (antes de unificar) continua lendo a planilha", async () => {
  await assertSucceeds(getDocs(collection(anonimo("antigo"), "tickets")));
});
test("unificação pela administradora: cria identidade, tickets-emails e liga o aparelho antigo", async () => {
  const db = admin();
  const b = writeBatch(db);
  b.set(doc(db, "tickets-identidades", "ana@valid.com"), { email: "ana@valid.com", nome: "Ana Antiga", nomeChave: chave("Ana Antiga"), papel: "equipe", ativo: true, aprovado: true, criadoEm: antes(20), criadoPorUid: "antigo", atualizadoEm: serverTimestamp() });
  b.set(doc(db, "tickets-emails", "ana@valid.com"), {});
  b.set(doc(db, "tickets-pessoas", "antigo"), { email: "ana@valid.com", nomeChave: chave("Ana Antiga"), vinculadoEm: serverTimestamp() }, { merge: true });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDocs(collection(anonimo("antigo"), "tickets")));
  await assertSucceeds(getDocs(collection(db, "tickets-identidades")));
});

/* ---------- Opções removidas da lista: nenhum registro muda; só valores NOVOS precisam ser opções ativas ---------- */
const editarT1 = (db, uid, mudancas) => updateDoc(doc(db, "tickets", "t1"), {
  ...Object.fromEntries(Object.entries(mudancas).map(([k, v]) => [`campos.${k}`, v])),
  atualizadoPor: uid, atualizadoPorNome: "Davi Lopes", atualizadoPorEmail: DAVI, atualizadoEm: serverTimestamp()
});
async function equipeDavi(uid) {
  const db = anonimo(uid);
  await vincular(db, uid, DAVI, "Davi Lopes");
  return db;
}
test("opção removida: equipe edita outra coluna do registro que a usa", async () => {
  await assertSucceeds(editarT1(await equipeDavi("rem1"), "rem1", { resumo: "editou outra coluna" }));
});
test("opção removida: equipe mantém o valor e salva (o valor reenviado igual passa)", async () => {
  await assertSucceeds(editarT1(await equipeDavi("rem2"), "rem2", { responsavel: "paula-katiele", resumo: "salvou sem trocar" }));
});
test("opção removida como valor NOVO: recusa (mas trocar por uma ativa passa)", async () => {
  const db = await equipeDavi("rem3");
  await assertSucceeds(editarT1(db, "rem3", { responsavel: "ana-souza" }));
  await assertFails(editarT1(db, "rem3", { responsavel: "paula-katiele" }));
});
test("etiquetas: acrescenta etiqueta ativa numa linha com etiqueta removida: passa; acrescentar a removida: recusa", async () => {
  const db = await equipeDavi("rem4");
  await assertSucceeds(editarT1(db, "rem4", { arSolicitante: ["ar-a", "ar-antiga", "ar-b"] }));
  await assertSucceeds(editarT1(db, "rem4", { arSolicitante: ["ar-antiga", "ar-b"] }));
  await assertFails(editarT1(db, "rem4", { arSolicitante: ["ar-antiga", "ar-b", "ar-c-removida"] }));
});
test("etiquetas na criação: a lista inteira precisa ser de opções ativas", async () => {
  const db = await equipeDavi("rem5");
  const novo = (id, ar) => setDoc(doc(db, "tickets", id), {
    campos: { resumo: "novo", arSolicitante: ar }, numero: "", criadoPor: "rem5", criadoPorNome: "Davi Lopes", criadoPorEmail: DAVI, criadoEm: serverTimestamp(),
    atualizadoPor: "rem5", atualizadoPorNome: "Davi Lopes", atualizadoPorEmail: DAVI, atualizadoEm: serverTimestamp(), exclusao: null
  });
  await assertFails(novo("n-rem", ["ar-a", "ar-antiga"]));
  await assertSucceeds(novo("n-ok", ["ar-a"]));
});
test("estrutura com opção removida (ativa, removidaEm, removidaPor, nomesAnteriores) gravada por admin: passa", async () => {
  await assertSucceeds(setDoc(doc(admin(), "tickets-config", "estrutura"), {
    titulo: "Banco de Tickets", versao: 2, categorias: [], gruposColunas: [{ id: "geral", nome: "Geral", ordem: 1 }],
    colunas: [{ id: "responsavel", nome: "RESPONSÁVEL", tipo: "lista", opcoes: [
      { id: "ana-souza", nome: "Ana Souza", cor: "", nomesAnteriores: [{ nome: "Ana S.", ate: "2026-10-30T12:00:00.000Z", por: "lays.almeida@valid.com" }] },
      { id: "paula-katiele", nome: "Paula Katiele", cor: "", ativa: false, removidaEm: "2026-10-30T12:00:00.000Z", removidaPor: "lays.almeida@valid.com" }
    ] }],
    regras: { equipeEdita: "proprias", janelaEdicaoHoras: 0, exportacao: true, registro: { aberto: true, dominios: [], papelPadrao: "equipe", aprovacao: true } },
    colunasEquipe: ["resumo", "responsavel"], listasEquipe: { responsavel: ["ana-souza"] },
    atualizadoEm: serverTimestamp(), atualizadoPor: "lays.almeida@valid.com"
  }));
});

/* ---------- Aparência livre: padrão da planilha (<prefixo>-config/aparencia e aparencia-imagem) ---------- */
const LAYS = "lays.almeida@valid.com";
const TEMA = {
  v: 1, nome: "Oceano", alto: false, base: { destaque: "#1f7fbf", fundo: "#eaf4fa", grade: "#ffffff" },
  avancado: { claro: { "--cor-acao": "#111111" }, escuro: {} }, listas: { claro: {}, escuro: {} },
  fundo: { tipo: "gradiente", area: "moldura", cor: "#eef0f6", g: { tipo: "linear", cores: ["#c9b8e6", "#9bd3f0"], angulo: 135, x: 50, y: 50 }, temImagem: false },
  grade: { solida: true, cantos: 8, mono: ["hostname"] }, colunas: { status: { cab: "#1565c0", tom: "", cheia: true } }
};
const REGRA = { id: "r1", ativa: true, col: "status", cond: "em", valores: ["inativo"], alvo: "linha", fundo: "#e53935" };
const aparencia = (por, extra = {}) => ({ tema: TEMA, regras: [REGRA], permitirPessoal: true, atualizadoEm: serverTimestamp(), atualizadoPor: por, ...extra });
const IMAGEM = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
test("aparência: administradora grava o padrão e a imagem; a equipe liberada lê", async () => {
  await assertSucceeds(setDoc(doc(admin(), "tickets-config", "aparencia"), aparencia(LAYS)));
  await assertSucceeds(setDoc(doc(admin(), "tickets-config", "aparencia-imagem"), { imagem: IMAGEM, atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  const db = await equipeDavi("ap1");
  await assertSucceeds(getDoc(doc(db, "tickets-config", "aparencia")));
  await assertSucceeds(getDoc(doc(db, "tickets-config", "aparencia-imagem")));
});
test("aparência: a equipe não grava nem apaga o padrão (nem a imagem)", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "tickets-config", "aparencia"), { ...aparencia(LAYS), atualizadoEm: antes(1) }); });
  const db = await equipeDavi("ap2");
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia"), aparencia(DAVI)));
  await assertFails(updateDoc(doc(db, "tickets-config", "aparencia"), { permitirPessoal: false, atualizadoEm: serverTimestamp(), atualizadoPor: DAVI }));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia-imagem"), { imagem: IMAGEM, atualizadoEm: serverTimestamp(), atualizadoPor: DAVI }));
  await assertFails(deleteDoc(doc(db, "tickets-config", "aparencia")));
});
test("aparência: chaves, tipos, faixas e tamanhos validados", async () => {
  const db = admin();
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia"), aparencia(LAYS, { css: "body{}" })));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia"), aparencia(LAYS, { tema: { ...TEMA, base: { ...TEMA.base, destaque: "red" } } })));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia"), aparencia(LAYS, { tema: { ...TEMA, fundo: { ...TEMA.fundo, tipo: "video" } } })));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia"), aparencia(LAYS, { tema: { ...TEMA, extra: 1 } })));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia"), aparencia(LAYS, { regras: Array.from({ length: 31 }, (_, i) => ({ ...REGRA, id: "r" + i })) })));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia"), aparencia(LAYS, { permitirPessoal: "sim" })));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia"), aparencia("outra@valid.com")));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia-imagem"), { imagem: "https://site.com/fundo.png", atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertFails(setDoc(doc(db, "tickets-config", "aparencia-imagem"), { imagem: "data:image/webp;base64," + "A".repeat(700000), atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertFails(setDoc(doc(db, "tickets-config", "tema"), aparencia(LAYS)));
  await assertSucceeds(setDoc(doc(db, "tickets-config", "aparencia"), aparencia(LAYS, { tema: null, permitirPessoal: false })));
});
test("aparência: quem ainda não foi liberado não lê o padrão (a estrutura continua legível para a entrada)", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "tickets-config", "aparencia"), { ...aparencia(LAYS), atualizadoEm: antes(1) }); });
  const db = anonimo("sem-cadastro");
  await assertSucceeds(getDoc(doc(db, "tickets-config", "estrutura")));
  await assertFails(getDoc(doc(db, "tickets-config", "aparencia")));
});
test("aparência: administradora remove o padrão; o SIG segue as mesmas regras", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "tickets-config", "aparencia"), { ...aparencia(LAYS), atualizadoEm: antes(1) }); });
  await assertSucceeds(deleteDoc(doc(admin(), "tickets-config", "aparencia")));
  await assertSucceeds(deleteDoc(doc(admin(), "tickets-config", "aparencia-imagem")));
  await assertSucceeds(setDoc(doc(admin(), "sig-config", "aparencia"), aparencia(LAYS)));
  await assertFails(setDoc(doc(await equipeDavi("ap3"), "sig-config", "aparencia"), aparencia(DAVI)));
});
