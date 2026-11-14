/* Gera o PDF do tutorial a partir de tutorial.html (Chrome headless). Uso: node dev/tutorial-gestores/gerar-pdf.mjs */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { abrirChrome, espera } from "./cdp.mjs";

const PASTA = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(PASTA, "Tutorial - Inventario de Equipamentos - Gestores.pdf");
const b = await abrirChrome({ porta: 9335, escala: 1 });
try {
  await b.ir(pathToFileURL(join(PASTA, "tutorial.html")).href);
  await b.js(`document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))))`);
  await espera(800);
  /* Sem rodapé do Chrome: o rodapé (sem a capa) é carimbado depois por rodape.py */
  const { data } = await b.cdp("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
  writeFileSync(SAIDA, Buffer.from(data, "base64"));
  execFileSync("python", [join(PASTA, "rodape.py"), SAIDA], { stdio: "inherit" });
  console.log("PDF:", SAIDA);
} finally {
  await b.fechar();
}
