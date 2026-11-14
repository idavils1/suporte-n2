/*
 * Gera exemplos/divulgacao-blocos.xlsx no formato da "planilha de divulgação" (blocos), com a mesma biblioteca do site:
 * título do bloco, "1º Ciclo" / "2º Ciclo" lado a lado (com uma coluna vazia entre eles), os títulos das colunas e,
 * no TJ, as seções "Acre (AC)" e "Alagoas (AL)" na 1ª coluna. Inclui de propósito: "NÃO INTEGRADO" atravessando
 * o 1º ciclo, um status fora da lista ("Em análise") e um sistema repetido na mesma seção.
 * Dados fictícios (nenhum contato real). Uso: node sites/cadeias-testes/gerar-excel-divulgacao.mjs
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("../cadeias/assets/xlsx-0.20.3.full.min.js");
const ciclos = ["1º Ciclo - Divulgação das cadeias de Certificação", "", "", "", "", "", "", "", "", "", "2º Ciclo - Teste pós implantação", "", "", ""];
const titulos = ["Sistema", "E-mail", "Telefone", "Divulgação", "Status", "Data Última", "Retorno Tel", "Retorno e-mail", "Atualizações", "", "Responsável", "Data Teste", "Resultado", "Observação"];
const vazio = Array(14).fill("");
const linhas = [
  ["Supremo Tribunal Federal (STF)"], ciclos, titulos,
  ["CAS", "suporte.cas@exemplo.jus.br", "61999990001", "Ok", "Instalado", "05/11/2026", "Retornou", "", "Cadeia instalada", "", "", "07/11/2026", "Teste ok", ""],
  ["CPE", "cpe@exemplo.jus.br", "(61) 3333-0002", "Pendente", "Cobrança", "03/11/2026", "", "Sem resposta", "", "", "", "", "", "Aguardar"],
  vazio,
  ["Superior Tribunal de Justiça (STJ)"], ciclos, titulos,
  ["Justiça Web", "jw@exemplo.jus.br", "", "Ok", "Aguardando", "", "", "", "", "", "", "", "", ""],
  ["e-STJ", "", "", "Não enviada", "Em análise", "", "", "", "", "", "", "", "", ""],
  vazio,
  ["Tribunal de Justiça (TJ)"], ciclos, titulos,
  ["Acre (AC)"],
  ["E-PROC", "", "", "", "NÃO INTEGRADO", "", "", "", "", "", "", "", "", ""],
  ["e-SAJ", "esaj@tjac.exemplo.jus.br", "68988887777", "Ok", "Instalado", "01/11/2026", "", "", "Ok", "", "", "04/11/2026", "Sem erros", ""],
  ["PJe", "NÃO INTEGRADO"],
  ["Projudi", "", "", "Pendente", "Pendente", "", "", "", "", "", "", "", "", ""],
  ["Alagoas (AL)"],
  ["e-SAJ", "esaj@tjal.exemplo.jus.br", "", "Ok", "Cobrança", "", "", "", "", "", "", "", "", ""],
  ["e-SAJ", "repetido@tjal.exemplo.jus.br", "", "Ok", "Cobrança", "", "", "", "", "", "", "", "", ""],
  ["PJe", "", "", "", "Instalado", "", "", "", "", "", "", "", "", ""]
];
const ws = XLSX.utils.aoa_to_sheet(linhas);
ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 13 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }, { s: { r: 1, c: 10 }, e: { r: 1, c: 13 } }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Divulgação");
mkdirSync(new URL("./exemplos/", import.meta.url), { recursive: true });
writeFileSync(fileURLToPath(new URL("./exemplos/divulgacao-blocos.xlsx", import.meta.url)), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("Gerado: sites/cadeias-testes/exemplos/divulgacao-blocos.xlsx");
