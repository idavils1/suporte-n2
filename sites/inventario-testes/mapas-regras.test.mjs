/*
 * Testes do firestore.rules (bloco MAPAS DE AJUDA) no Emulador do Firestore.
 * Na pasta sites/inventario-testes: npm run test:mapas   (precisa de Java para o emulador)
 */
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, serverTimestamp, addDoc } from "firebase/firestore";

let env;
const LAYS = "lays.almeida@valid.com";
const visitante = () => env.unauthenticatedContext().firestore();
const outraConta = () => env.authenticatedContext("x", { email: "fulano@valid.com", email_verified: true }).firestore();
const admin = () => env.authenticatedContext("lays", { email: LAYS, email_verified: true }).firestore();
/* Mesmo formato de dadosMapa() e dadosNo() em comum/mapas-dados.js */
const mapa = (extra = {}) => ({ nome: "SCDA", descricao: "Roteiro do SCDA", icone: "i-servidor", cor: "azul", layout: "arvore", tags: ["exemplo-revisar"],
  excluidoEm: null, criadoEm: serverTimestamp(), criadoPor: LAYS, atualizadoEm: serverTimestamp(), atualizadoPor: LAYS, ...extra });
const no = (extra = {}) => ({ tipo: "teste", titulo: "Só comigo ou geral?", descricao: "**Primeiro** o alcance.", paiId: "scda-caindo", ordem: 0, tags: [],
  recolhido: false, pos: null, campos: { passos: ["Peça a um colega"], esperado: "Geral: escale.", tempo: "5 min" },
  ligacoes: [{ para: "scda-contato", rotulo: "Geral" }], revisadoEm: "", atualizadoEm: serverTimestamp(), atualizadoPor: LAYS, ...extra });
const uso = (extra = {}) => ({ sintomaId: "scda-caindo", resultado: "resolvido", resolvidoNo: "scda-teste", contatoId: "", testes: [{ id: "scda-teste", r: "resolveu" }],
  em: serverTimestamp(), por: "Fulano", ...extra });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-mapas",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "mapas", "scda"), { ...mapa(), criadoEm: new Date(), atualizadoEm: new Date() });
    await setDoc(doc(db, "mapas", "scda", "nos", "scda-teste"), { ...no(), atualizadoEm: new Date() });
    await setDoc(doc(db, "mapas-lixeira", "no-scda-1"), { tipo: "no", mapaId: "scda", nome: "X", dados: { nos: [] }, removidoEm: new Date(), removidoPor: LAYS });
  });
});

test("qualquer pessoa lê mapas, nós e usos", async () => {
  await assertSucceeds(getDocs(collection(visitante(), "mapas")));
  await assertSucceeds(getDocs(collection(visitante(), "mapas", "scda", "nos")));
  await assertSucceeds(getDocs(collection(visitante(), "mapas", "scda", "usos")));
});
test("administradora cria mapa e nó no formato da página", async () => {
  await assertSucceeds(setDoc(doc(admin(), "mapas", "sgs"), mapa({ nome: "SGS" })));
  await assertSucceeds(setDoc(doc(admin(), "mapas", "sgs", "nos", "n1abc"), no({ tipo: "sistema", titulo: "SGS", paiId: null, ligacoes: [], campos: {} })));
  await assertSucceeds(setDoc(doc(admin(), "mapas", "scda", "nos", "scda-teste"), no({ pos: { x: 10, y: 20, v: "grafo" } })));
});
test("atualização parcial do mapa (atualizadoEm/Por) passa", async () => {
  await assertSucceeds(setDoc(doc(admin(), "mapas", "scda"), { atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }, { merge: true }));
});
test("qualquer pessoa cria/atualiza mapa e nó assinando com o nome; só editores excluem", async () => {
  await assertSucceeds(setDoc(doc(visitante(), "mapas", "x"), mapa({ atualizadoPor: "Fulano", criadoPor: "Fulano" })));
  await assertSucceeds(setDoc(doc(outraConta(), "mapas", "y"), mapa({ atualizadoPor: "fulano@valid.com", criadoPor: "fulano@valid.com" })));
  await assertSucceeds(setDoc(doc(outraConta(), "mapas", "scda", "nos", "n2"), no({ atualizadoPor: "fulano@valid.com" })));
  await assertFails(setDoc(doc(visitante(), "mapas", "z"), mapa({ atualizadoPor: "alguem@valid.com", criadoPor: "alguem@valid.com" })));
  await assertFails(deleteDoc(doc(outraConta(), "mapas", "scda", "nos", "scda-teste")));
  await assertFails(deleteDoc(doc(visitante(), "mapas", "scda")));
});
test("formato inválido é recusado", async () => {
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "n3"), no({ tipo: "pasta" })));
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "n3"), no({ titulo: "x".repeat(121) })));
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "n3"), no({ descricao: "x".repeat(20001) })));
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "n3"), no({ cpf: "123" })));
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "n3"), no({ campos: { senha: "x" } })));
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "N_MAIUSCULO"), no()));
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "n3"), no({ atualizadoPor: "outra@valid.com" })));
  await assertFails(setDoc(doc(admin(), "mapas", "y"), mapa({ cor: "rosa" })));
});
test("usos: qualquer pessoa registra assinando com o nome; ninguém edita", async () => {
  await assertSucceeds(setDoc(doc(visitante(), "mapas", "scda", "usos", "u1"), uso()));
  await assertFails(setDoc(doc(visitante(), "mapas", "scda", "usos", "u2"), uso({ por: "alguem@valid.com" })));
  await assertSucceeds(setDoc(doc(outraConta(), "mapas", "scda", "usos", "u3"), uso({ por: "fulano@valid.com" })));
  await assertFails(setDoc(doc(visitante(), "mapas", "scda", "usos", "u4"), uso({ resultado: "talvez" })));
  await assertFails(setDoc(doc(visitante(), "mapas", "scda", "usos", "u1"), uso({ resultado: "escalado" })));
  await assertFails(deleteDoc(doc(visitante(), "mapas", "scda", "usos", "u1")));
  await assertSucceeds(deleteDoc(doc(admin(), "mapas", "scda", "usos", "u1")));
});
test("lixeira: só quem edita lê, cria e apaga; ninguém altera", async () => {
  await assertFails(getDoc(doc(visitante(), "mapas-lixeira", "no-scda-1")));
  await assertFails(getDoc(doc(outraConta(), "mapas-lixeira", "no-scda-1")));
  await assertSucceeds(getDoc(doc(admin(), "mapas-lixeira", "no-scda-1")));
  await assertSucceeds(setDoc(doc(admin(), "mapas-lixeira", "mapa-scda-2"), { tipo: "mapa", mapaId: "scda", nome: "SCDA", dados: { mapa: {}, nos: [] }, removidoEm: serverTimestamp(), removidoPor: LAYS }));
  await assertFails(setDoc(doc(admin(), "mapas-lixeira", "no-scda-1"), { tipo: "no", mapaId: "scda", nome: "Y", dados: {}, removidoEm: serverTimestamp(), removidoPor: LAYS }));
  await assertSucceeds(deleteDoc(doc(admin(), "mapas-lixeira", "no-scda-1")));
});
test("auditoria: administradora registra ação dos mapas; conta sem permissão não", async () => {
  const reg = (porEmail) => ({ acao: "criar", alvo: "mapas", resumo: "Mapa: SCDA", detalhes: "scda", porEmail, porNome: "X", criadoEm: serverTimestamp() });
  await assertSucceeds(addDoc(collection(admin(), "auditoria"), reg(LAYS)));
  await assertFails(addDoc(collection(outraConta(), "auditoria"), reg("fulano@valid.com")));
});

/* ---------- Painel de edição: mapas-config (só administradoras) ---------- */
const PAULA = "paula.conceicao@valid.com";
const paula = () => env.authenticatedContext("paula", { email: PAULA, email_verified: true }).firestore();
const estrutura = (por, extra = {}) => ({
  versao: 1,
  tipos: { contato: { nome: "Escalonamento", icone: "i-telefone", cor: "laranja", ajuda: "", filhoPadrao: "nota" } },
  ordemTipos: ["sistema", "sintoma", "teste", "contato", "solucao", "link", "nota"],
  campos: { sintoma: [{ id: "impacto", tipo: "escolha", rotulo: "Impacto", dica: "", obrigatorio: false, oculto: false, personalizado: false,
    opcoes: [{ id: "Parada total", rotulo: "Parada total", cor: "vermelho" }, { id: "Baixo", rotulo: "Baixo", arquivada: true }] }] },
  atualizadoEm: serverTimestamp(), atualizadoPor: por, ...extra
});
test("mapas-config: administradora grava estrutura, modelos e versões; todos leem a configuração", async () => {
  await assertSucceeds(setDoc(doc(admin(), "mapas-config", "estrutura"), estrutura(LAYS)));
  await assertSucceeds(setDoc(doc(paula(), "mapas-config", "modelos"), { versao: 1, lista: [{ id: "branco", nome: "Em branco", descricao: "", nos: [] }], atualizadoEm: serverTimestamp(), atualizadoPor: PAULA }));
  await assertSucceeds(setDoc(doc(admin(), "mapas-config", "estrutura", "versoes", "v1abc"), { dados: { tipos: {} }, resumo: "1 mudança", em: serverTimestamp(), por: LAYS }));
  await assertSucceeds(getDoc(doc(visitante(), "mapas-config", "estrutura")));
});
test("mapas-config: editor comum, conta sem permissão e visitante não gravam", async () => {
  await assertFails(setDoc(doc(outraConta(), "mapas-config", "estrutura"), estrutura("fulano@valid.com")));
  await assertFails(setDoc(doc(visitante(), "mapas-config", "estrutura"), estrutura("Fulano")));
  await assertFails(setDoc(doc(outraConta(), "mapas-config", "estrutura", "versoes", "v2"), { dados: {}, resumo: "", em: serverTimestamp(), por: "fulano@valid.com" }));
  await assertFails(getDoc(doc(outraConta(), "mapas-config", "estrutura", "versoes", "v1abc")));
});
test("mapas-config: formato inválido é recusado e versões não mudam", async () => {
  await assertFails(setDoc(doc(admin(), "mapas-config", "outro"), estrutura(LAYS)));
  await assertFails(setDoc(doc(admin(), "mapas-config", "estrutura"), estrutura(LAYS, { tipos: { pasta: { nome: "Pasta" } } })));
  await assertFails(setDoc(doc(admin(), "mapas-config", "estrutura"), estrutura(LAYS, { senha: "x" })));
  await assertFails(setDoc(doc(admin(), "mapas-config", "estrutura"), estrutura(PAULA)));
  await assertFails(setDoc(doc(admin(), "mapas-config", "modelos"), { versao: 1, lista: [], tipos: {}, atualizadoEm: serverTimestamp(), atualizadoPor: LAYS }));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "mapas-config", "estrutura", "versoes", "v9"), { dados: {}, resumo: "x", em: new Date(), por: LAYS }));
  await assertFails(setDoc(doc(admin(), "mapas-config", "estrutura", "versoes", "v9"), { dados: {}, resumo: "y", em: serverTimestamp(), por: LAYS }));
  await assertFails(deleteDoc(doc(admin(), "mapas-config", "estrutura")));
});
test("nós aceitam campos personalizados em extras (até 20 chaves) e continuam recusando chaves fora da lista em campos", async () => {
  await assertSucceeds(setDoc(doc(admin(), "mapas", "scda", "nos", "n4"), no({ extras: { ambiente: "Produção", "passos-extra": ["a", "b"] } })));
  const muitos = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`c${i}`, "x"]));
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "n5"), no({ extras: muitos })));
  await assertFails(setDoc(doc(admin(), "mapas", "scda", "nos", "n6"), no({ campos: { ambiente: "x" } })));
});
