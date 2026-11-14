/* 1) Backup da produção (todo o Cadeias que a importação pode tocar) e cópia da estrutura para o Emulador */
const fs = require("fs");
const { PROD, EMU, tudo, cab } = require("./comum.cjs");
(async () => {
  const prod = await tudo(PROD);
  fs.writeFileSync("backup/2026-11-11-cadeias-v6-importacao/producao-antes.json", JSON.stringify(prod));
  fs.writeFileSync(__dirname + "/producao-antes.json", JSON.stringify(prod));
  let n = 0;
  for (const [k, d] of Object.entries(prod)) {
    if (k.startsWith("cadeias-historico/") || k.startsWith("cadeias-auditoria/")) continue;
    const w = await fetch(`${EMU}/${k.split("/").map(encodeURIComponent).join("/")}`, { method: "PATCH", headers: await cab(EMU), body: JSON.stringify({ fields: d.fields || {} }) });
    if (!w.ok) throw new Error(`${k}: ${w.status} ${await w.text()}`);
    n++;
  }
  console.log(`Backup: ${Object.keys(prod).length} documento(s) da produção. Copiados para o Emulador: ${n}.`);
  console.log(Object.keys(prod).filter((k) => !/historico|auditoria/.test(k)).join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
