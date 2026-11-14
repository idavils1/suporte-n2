/* 2) Leva para a produção o que a importação criou ou mudou no Emulador.
   - Só documentos novos ou alterados; nos alterados, só os campos que mudaram (o resto fica como está na produção).
   - Autoria: o que a importação gravou como "Lays" passa a ser "Importação da planilha oficial".
   - Antes de gravar, confere que a produção não mudou desde o backup. Uso: node 2-gravar.cjs [--gravar] */
const fs = require("fs");
const { PROD, EMU, tudo, cab } = require("./comum.cjs");
const GRAVAR = process.argv.includes("--gravar");
const LAYS = "lays.almeida@valid.com", ID = "importacao-planilha-oficial", NOME = "Importação da planilha oficial";
const raiz = "projects/suporte-n2/databases/(default)/documents/";
/* Troca a autoria num valor REST (recursivo); "chave" é o nome do campo */
function trocar(v, chave = "") {
  if (!v || typeof v !== "object") return v;
  if ("stringValue" in v) {
    const s = v.stringValue;
    if (s === LAYS) return { stringValue: /Email$/.test(chave) ? "" : ID };
    if (s === "Lays" && /Nome$/.test(chave)) return { stringValue: NOME };
    if (chave === "json" && s.includes(LAYS)) {
      const d = JSON.parse(s);
      (d.l || []).forEach((l) => { const a = l[2]; if (a && typeof a === "object") Object.keys(a).forEach((k) => { if (a[k] === LAYS) a[k] = /Email$/.test(k) ? "" : ID; else if (a[k] === "Lays" && /Nome$/.test(k)) a[k] = NOME; }); });
      return { stringValue: JSON.stringify(d) };
    }
    return v;
  }
  if ("mapValue" in v) return { mapValue: { fields: Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, trocar(x, k)])) } };
  if ("arrayValue" in v) return { arrayValue: { values: (v.arrayValue.values || []).map((x) => trocar(x, chave)) } };
  return v;
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
  const antes = JSON.parse(fs.readFileSync(__dirname + "/producao-antes.json", "utf8"));
  const emu = await tudo(EMU);
  const agora = await tudo(PROD);
  /* A produção mudou desde o backup? (as entradas novas na auditoria/últimas mudanças, de quem entrou no site, não contam) */
  const mudou = [...new Set([...Object.keys(antes), ...Object.keys(agora)])].filter((k) => !/^cadeias-(auditoria|historico)\//.test(k) && (!antes[k] || !agora[k] || antes[k].updateTime !== agora[k].updateTime));
  if (mudou.length) { console.log("A PRODUÇÃO MUDOU desde o backup; nada foi gravado:", mudou.join(", ")); process.exit(2); }
  const escritas = [], resumo = {};
  for (const [k, d] of Object.entries(emu)) {
    if (k.startsWith("cadeias-auditoria/")) { const f = d.fields || {}; if ((f.acao || {}).stringValue === "entrar" || antes[k]) continue; }
    if (k.startsWith("cadeias-historico/") && antes[k]) continue;
    const p = antes[k];
    let fields;
    if (!p) fields = Object.fromEntries(Object.entries(d.fields || {}).map(([c, v]) => [c, trocar(v, c)]));
    else {
      const mudados = Object.keys(d.fields || {}).filter((c) => !igual((p.fields || {})[c], d.fields[c]));
      if (!mudados.length) continue;
      fields = { ...(p.fields || {}), ...Object.fromEntries(mudados.map((c) => [c, trocar(d.fields[c], c)])) };
    }
    escritas.push({ update: { name: raiz + k, fields } });
    const tipo = k.split("/").length > 2 ? `${k.split("/")[0]}/*/${k.split("/")[2]}` : k.split("/")[0];
    resumo[`${tipo}${p ? " (alterado)" : " (novo)"}`] = (resumo[`${tipo}${p ? " (alterado)" : " (novo)"}`] || 0) + 1;
  }
  const apagar = Object.keys(antes).filter((k) => !emu[k] && /^cadeias-localidades\/[^/]+\/(arquivo|chaves|registros)\//.test(k));
  apagar.forEach((k) => escritas.push({ delete: raiz + k }));
  console.log(JSON.stringify(resumo, null, 1), "\napagar:", apagar.length, "· total de escritas:", escritas.length);
  const sobrou = JSON.stringify(escritas).split(LAYS).length - 1;
  console.log("ocorrências do e-mail da Lays nas escritas:", sobrou, "(só em campos que a importação não mudou)");
  if (!GRAVAR) { console.log("Simulação: nada gravado. Use --gravar."); return; }
  for (let i = 0; i < escritas.length; i += 400) {
    const r = await fetch(`https://firestore.googleapis.com/v1/${raiz.slice(0, -1).replace(/\/documents$/, "")}/documents:commit`, { method: "POST", headers: await cab(PROD), body: JSON.stringify({ writes: escritas.slice(i, i + 400) }) });
    if (!r.ok) throw new Error(`lote ${i}: ${r.status} ${await r.text()}`);
    console.log(`gravado ${Math.min(i + 400, escritas.length)} de ${escritas.length}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
