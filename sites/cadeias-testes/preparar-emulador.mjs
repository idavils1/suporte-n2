/*
 * Prepara o Emulador do Firestore para o teste de interface (servidor.ps1 + nuvem-emulador.js):
 * carrega o firestore.rules de verdade no projeto "demo-cadeias-ui" e apaga os dados de testes anteriores.
 * Uso (com o Emulador rodando na porta 8085):  node sites/cadeias-testes/preparar-emulador.mjs
 */
import { readFileSync } from "node:fs";

const PROJETO = "demo-cadeias-ui", BASE = "http://127.0.0.1:8085";
const regras = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
const r1 = await fetch(`${BASE}/emulator/v1/projects/${PROJETO}:securityRules`, { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: regras }] } }) });
if (!r1.ok) throw new Error(`Regras: ${r1.status} ${await r1.text()}`);
const r2 = await fetch(`${BASE}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
if (!r2.ok) throw new Error(`Limpar: ${r2.status} ${await r2.text()}`);
console.log(`Emulador pronto: regras carregadas e dados apagados no projeto ${PROJETO}.`);
