/*
 * Gera exemplos/cadeias-12-abas.xlsx (12 abas = 12 localidades) com a mesma biblioteca do site (SheetJS 0.20.3).
 * Inclui de propósito um STATUS fora da lista ("Em obras") e um CÓDIGO repetido, para testar a conferência.
 * Uso: node sites/cadeias-testes/gerar-excel-exemplo.mjs
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("../cadeias/assets/xlsx-0.20.3.full.min.js");
const LOCALIDADES = ["São Paulo - Barueri", "São Paulo - Centro", "Campinas", "Santos", "Rio de Janeiro - Centro", "Niterói", "Belo Horizonte", "Vitória", "Curitiba", "Florianópolis", "Porto Alegre", "Joinville"];
const STATUS = ["Ativo", "Inativo", "Em implantação"];
const wb = XLSX.utils.book_new();
LOCALIDADES.forEach((nome, k) => {
  const linhas = [["CÓDIGO", "NOME DA LOJA", "STATUS", "RESPONSÁVEL", "OBSERVAÇÃO"]];
  const n = 4 + (k % 5) * 2;
  for (let i = 1; i <= n; i++) linhas.push([`${String(k + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`, `Loja ${nome} ${i}`, STATUS[(i + k) % 3], ["Ana", "Bruno", "Carla"][i % 3], i === 2 ? "Conferir horário" : ""]);
  if (k === 0) { linhas.push(["01-900", "Loja nova em obras", "Em obras", "Ana", ""]); linhas.push(["01-001", "Código repetido", "Ativo", "Bruno", ""]); }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome.slice(0, 31));
});
mkdirSync(new URL("./exemplos/", import.meta.url), { recursive: true });
writeFileSync(fileURLToPath(new URL("./exemplos/cadeias-12-abas.xlsx", import.meta.url)), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("Gerado: sites/cadeias-testes/exemplos/cadeias-12-abas.xlsx");
