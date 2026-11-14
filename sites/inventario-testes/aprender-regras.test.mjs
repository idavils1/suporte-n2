/*
 * Testes do firestore.rules (bloco APRENDIZAGEM - TIRE SUAS DÚVIDAS) no Emulador do Firestore.
 * Na pasta sites/inventario-testes: npm run test:aprender
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, serverTimestamp, writeBatch } from "firebase/firestore";

let env;
const LAYS = "lays.almeida@valid.com";
const visitante = () => env.unauthenticatedContext().firestore();
const outraConta = () => env.authenticatedContext("x", { email: "fulano@valid.com", email_verified: true }).firestore();
const admin = () => env.authenticatedContext("lays", { email: LAYS, email_verified: true, firebase: { sign_in_provider: "password" } }).firestore();
/* Mesmo formato de dadosTema() em comum/aprender.js */
const aula = (extra = {}) => ({
  trilha: "integraicp-v3", modulo: "referencia", paiId: null, ordem: 1, titulo: "Códigos de erro do IntegraICP", resumo: "Tabela de códigos.", nivel: "Avançado",
  palavrasChave: ["400204"], secoes: { frase: "", simples: "", funciona: "", exemplo: "", duvidas: "", termos: "", saibaMais: "" },
  blocos: [{ id: "tabela", titulo: "Códigos", icone: "i-tabela", markdown: ":::selo validado\n| HTTP | Código |\n|---|---|\n| 400 | 400204 |\n:::" }],
  oculto: false, ocultaPropria: false, destaque: 0, cor: "", icone: "", tempo: 0, capa: null, revisarEm: "",
  atualizadoEm: serverTimestamp(), atualizadoPor: LAYS, ...extra
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-aprender",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "conhecimento", "ii-codigos-erro"), { ...aula(), atualizadoEm: new Date() });
    await setDoc(doc(db, "conhecimento", "ii-rascunho"), { ...aula({ titulo: "Rascunho", oculto: true, ocultaPropria: true }), atualizadoEm: new Date() });
    await setDoc(doc(db, "conhecimento-config", "trilhas"), { lista: [{ id: "integraicp-v3", nome: "IntegraICP" }], versao: 3, atualizadoEm: new Date(), atualizadoPor: LAYS });
    await setDoc(doc(db, "conhecimento", "ii-codigos-erro", "versoes", "v1"), { dados: { titulo: "x" }, resumo: "Antes", em: new Date(), por: LAYS });
    await setDoc(doc(db, "conhecimento-lixeira", "aula-x-1"), { tipo: "aula", itemId: "x", nome: "X", grupo: "g", origem: {}, dados: {}, removidoEm: new Date(), removidoPor: LAYS });
  });
});

/* ---------- Leitura: oculto só para administradoras ---------- */
test("visitante lê as aulas com o filtro oculto == false (como o site faz)", async () => {
  const s = await assertSucceeds(getDocs(query(collection(visitante(), "conhecimento"), where("oculto", "==", false))));
  if (s.docs.some((d) => d.id === "ii-rascunho")) throw new Error("rascunho apareceu");
});
test("visitante: consulta sem filtro e leitura direta de aula oculta são negadas (nem pelo endereço)", async () => {
  await assertFails(getDocs(collection(visitante(), "conhecimento")));
  await assertFails(getDoc(doc(visitante(), "conhecimento", "ii-rascunho")));
  await assertSucceeds(getDoc(doc(visitante(), "conhecimento", "ii-codigos-erro")));
  await assertFails(getDoc(doc(outraConta(), "conhecimento", "ii-rascunho")));
});
test("administradora lê tudo, inclusive rascunhos", async () => {
  await assertSucceeds(getDocs(collection(admin(), "conhecimento")));
  await assertSucceeds(getDoc(doc(admin(), "conhecimento", "ii-rascunho")));
});

/* ---------- Escrita: só administradoras, formato da aula ---------- */
test("administradora grava aula com módulo, blocos, selos e campos novos", async () => {
  await assertSucceeds(setDoc(doc(admin(), "conhecimento", "nova-aula"), aula({ ocultaPropria: true, oculto: true, destaque: 2, cor: "verde", icone: "i-plug", tempo: 12, capa: { tipo: "gradiente", estilo: "ondas" } })));
});
test("aula com campo desconhecido, oculto não booleano ou mais de 40 blocos: recusa", async () => {
  await assertFails(setDoc(doc(admin(), "conhecimento", "a1"), aula({ campoEstranho: 1 })));
  await assertFails(setDoc(doc(admin(), "conhecimento", "a2"), aula({ oculto: "nao" })));
  await assertFails(setDoc(doc(admin(), "conhecimento", "a3"), aula({ blocos: Array.from({ length: 41 }, (_, i) => ({ id: "b" + i, titulo: "S", icone: "i-livro", markdown: "" })) })));
});
test("visitante e outras contas não escrevem nada da Aprendizagem", async () => {
  for (const db of [visitante(), outraConta()]) {
    await assertFails(setDoc(doc(db, "conhecimento", "x"), aula({ atualizadoPor: "fulano@valid.com" })));
    await assertFails(updateDoc(doc(db, "conhecimento", "ii-codigos-erro"), { oculto: true }));
    await assertFails(deleteDoc(doc(db, "conhecimento", "ii-codigos-erro")));
    await assertFails(setDoc(doc(db, "conhecimento-config", "categorias"), { lista: [], atualizadoEm: serverTimestamp(), atualizadoPor: "fulano@valid.com" }));
  }
});
test("configuração: categorias, trilhas e glossário (administradora); outro documento: recusa", async () => {
  const cfg = (lista) => ({ lista, atualizadoEm: serverTimestamp(), atualizadoPor: LAYS });
  await assertSucceeds(setDoc(doc(admin(), "conhecimento-config", "categorias"), cfg([{ id: "produtos", nome: "Produtos Valid", oculto: false }])));
  await assertSucceeds(setDoc(doc(admin(), "conhecimento-config", "trilhas"), { ...cfg([{ id: "a", modulos: [] }]), versao: 3 }));
  await assertFails(setDoc(doc(admin(), "conhecimento-config", "outro"), cfg([])));
  await assertFails(setDoc(doc(admin(), "conhecimento-config", "categorias"), cfg(Array.from({ length: 61 }, (_, i) => ({ id: "c" + i })))));
  await assertSucceeds(getDoc(doc(visitante(), "conhecimento-config", "categorias")));
});

/* ---------- Versões, lixeira e capas ---------- */
test("versões: administradora cria, lê e apaga; não altera; visitante não lê", async () => {
  const v = { dados: { titulo: "Antes" }, resumo: "Antes da publicação", em: serverTimestamp(), por: LAYS };
  await assertSucceeds(setDoc(doc(admin(), "conhecimento", "ii-codigos-erro", "versoes", "v2abc"), v));
  await assertSucceeds(getDocs(collection(admin(), "conhecimento", "ii-codigos-erro", "versoes")));
  await assertFails(updateDoc(doc(admin(), "conhecimento", "ii-codigos-erro", "versoes", "v1"), { resumo: "x" }));
  await assertFails(getDocs(collection(visitante(), "conhecimento", "ii-codigos-erro", "versoes")));
  await assertFails(setDoc(doc(admin(), "conhecimento", "ii-codigos-erro", "versoes", "v3"), { ...v, por: "outra@valid.com" }));
  await assertSucceeds(deleteDoc(doc(admin(), "conhecimento", "ii-codigos-erro", "versoes", "v1")));
});
test("lixeira: administradora move, lê, restaura (apaga); visitante não vê", async () => {
  const db = admin();
  const b = writeBatch(db);
  b.delete(doc(db, "conhecimento", "ii-rascunho"));
  b.set(doc(db, "conhecimento-lixeira", "aula-ii-rascunho-k1"), { tipo: "aula", itemId: "ii-rascunho", nome: "Rascunho", grupo: "aula-ii-rascunho-k1", origem: { trilha: "integraicp-v3" }, dados: { titulo: "Rascunho" }, removidoEm: serverTimestamp(), removidoPor: LAYS });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDocs(collection(admin(), "conhecimento-lixeira")));
  await assertFails(getDocs(collection(visitante(), "conhecimento-lixeira")));
  await assertFails(setDoc(doc(admin(), "conhecimento-lixeira", "y"), { tipo: "planilha", itemId: "y", nome: "Y", grupo: "g", origem: {}, dados: {}, removidoEm: serverTimestamp(), removidoPor: LAYS }));
  await assertSucceeds(deleteDoc(doc(admin(), "conhecimento-lixeira", "aula-x-1")));
});
test("capas: imagem comprimida (data URL) só da administradora; leitura livre", async () => {
  const capa = { src: "data:image/webp;base64,UklGRg==", atualizadoEm: serverTimestamp(), atualizadoPor: LAYS };
  await assertSucceeds(setDoc(doc(admin(), "conhecimento-capas", "trilha-integraicp-v3"), capa));
  await assertSucceeds(getDoc(doc(visitante(), "conhecimento-capas", "trilha-integraicp-v3")));
  await assertFails(setDoc(doc(admin(), "conhecimento-capas", "trilha-x"), { ...capa, src: "https://site.com/x.png" }));
  await assertFails(setDoc(doc(admin(), "conhecimento-capas", "planilha-x"), capa));
  await assertFails(setDoc(doc(visitante(), "conhecimento-capas", "trilha-y"), { ...capa, atualizadoPor: "Visitante" }));
});
test("a regra final continua negando o que não está listado", async () => {
  await assertFails(setDoc(doc(admin(), "colecao-inexistente", "x"), { a: 1 }));
  await assertFails(getDoc(doc(visitante(), "colecao-inexistente", "x")));
});
