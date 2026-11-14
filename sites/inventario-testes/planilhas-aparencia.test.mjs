/*
 * Testes do firestore.rules (PLANILHAS DA CENTRAL: aparência padrão) no Emulador do Firestore.
 * Na pasta sites/inventario-testes: npm run test:planilhas
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, Timestamp } from "firebase/firestore";

let env;
const LAYS = "lays.almeida@valid.com";
const antes = (dias) => Timestamp.fromDate(new Date(Date.now() - dias * 86400000));
const visitante = () => env.unauthenticatedContext().firestore();
const admin = () => env.authenticatedContext("lays", { email: LAYS, email_verified: true }).firestore();
const outraConta = () => env.authenticatedContext("x", { email: "fulano@valid.com", email_verified: true }).firestore();
const ESTRUTURA = { colunas: [{ id: "hostname", nome: "HOSTNAME", tipo: "texto" }, { id: "status", nome: "STATUS", tipo: "status" }], gruposColunas: [{ id: "geral", nome: "Geral", ordem: 1 }], abas: {}, resumo: { mostrar: true }, regras: {} };
const TEMA = { v: 1, nome: "Grafite", alto: false, base: { destaque: "#4b5563", fundo: "#f1f2f4", grade: "#ffffff" }, avancado: { claro: {}, escuro: {} }, listas: { claro: {}, escuro: {} },
  fundo: { tipo: "nenhum", area: "pagina", cor: "#eef0f6", temImagem: false }, grade: { solida: true, cantos: 4, mono: ["hostname"] }, colunas: {} };
const aparencia = (extra = {}) => ({ tema: TEMA, regras: [{ id: "r1", ativa: true, col: "status", cond: "em", valores: ["inativo"], alvo: "linha", fundo: "#e53935" }], permitirPessoal: true, atualizadoEm: serverTimestamp(), atualizadoPor: LAYS, ...extra });
const IMAGEM = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-planilhas",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "planilhas", "p1"), {
      titulo: "Planilha", estrutura: ESTRUTURA, colunasIds: ["hostname", "status"], colunasAdmin: [], versao: 1,
      criadoEm: antes(10), criadoPor: "Ana", atualizadoEm: antes(10), atualizadoPor: "Ana",
      aparencia: { ...aparencia(), atualizadoEm: antes(5) }
    });
  });
});

test("administradora grava o padrão de aparência (campo aparencia) e a imagem; qualquer pessoa lê", async () => {
  await assertSucceeds(updateDoc(doc(admin(), "planilhas", "p1"), { aparencia: aparencia({ permitirPessoal: false }), atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertSucceeds(setDoc(doc(admin(), "planilhas", "p1", "config", "aparencia-imagem"), { imagem: IMAGEM, atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertSucceeds(getDoc(doc(visitante(), "planilhas", "p1")));
  await assertSucceeds(getDoc(doc(visitante(), "planilhas", "p1", "config", "aparencia-imagem")));
});
test("sem login: edita a estrutura normalmente (a aparência continua igual)", async () => {
  await assertSucceeds(updateDoc(doc(visitante(), "planilhas", "p1"), { titulo: "Planilha nova", atualizadoEm: serverTimestamp(), atualizadoPor: "Ana" }));
});
test("sem login (ou outra conta): não muda, não apaga e não cria o padrão de aparência", async () => {
  await assertFails(updateDoc(doc(visitante(), "planilhas", "p1"), { aparencia: aparencia({ atualizadoPor: "Ana" }), atualizadoEm: serverTimestamp(), atualizadoPor: "Ana" }));
  await assertFails(updateDoc(doc(visitante(), "planilhas", "p1"), { aparencia: deleteField(), atualizadoEm: serverTimestamp(), atualizadoPor: "Ana" }));
  await assertFails(updateDoc(doc(outraConta(), "planilhas", "p1"), { aparencia: aparencia({ atualizadoPor: "fulano@valid.com" }), atualizadoEm: serverTimestamp(), atualizadoPor: "fulano@valid.com" }));
  await assertFails(setDoc(doc(visitante(), "planilhas", "p2"), { titulo: "P2", estrutura: ESTRUTURA, colunasIds: ["hostname"], colunasAdmin: [], versao: 1, criadoEm: serverTimestamp(), criadoPor: "Ana", atualizadoEm: serverTimestamp(), atualizadoPor: "Ana", aparencia: aparencia({ atualizadoPor: "Ana" }) }));
  await assertFails(setDoc(doc(visitante(), "planilhas", "p1", "config", "aparencia-imagem"), { imagem: IMAGEM, atualizadoEm: serverTimestamp(), atualizadoPor: "Ana" }));
});
test("padrão inválido é recusado até para a administradora; remover o padrão é dela", async () => {
  await assertFails(updateDoc(doc(admin(), "planilhas", "p1"), { aparencia: aparencia({ regras: Array.from({ length: 31 }, (_, i) => ({ id: "r" + i })) }), atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertFails(updateDoc(doc(admin(), "planilhas", "p1"), { aparencia: aparencia({ tema: { ...TEMA, fundo: { tipo: "url" } } }), atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertFails(setDoc(doc(admin(), "planilhas", "p1", "config", "aparencia-imagem"), { imagem: "https://site.com/x.png", atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertFails(setDoc(doc(admin(), "planilhas", "p1", "config", "outro"), { imagem: IMAGEM, atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertSucceeds(updateDoc(doc(admin(), "planilhas", "p1"), { aparencia: deleteField(), atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await assertSucceeds(deleteDoc(doc(admin(), "planilhas", "p1", "config", "aparencia-imagem")));
});
