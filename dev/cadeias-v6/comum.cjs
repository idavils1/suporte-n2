/* Acesso de leitura/escrita por REST: produção (com o login da CLI do Firebase) e Emulador (Bearer owner) */
const fs = require("fs"), os = require("os"), path = require("path");
const PROD = "https://firestore.googleapis.com/v1/projects/suporte-n2/databases/(default)/documents";
const EMU = "http://127.0.0.1:8085/v1/projects/demo-cadeias-ui/databases/(default)/documents";
let token = null;
async function tokenProducao() {
  if (token) return token;
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"), "utf8"));
  const r = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.tokens.refresh_token, client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi" }) })).json();
  if (!r.access_token) throw new Error("sem token: " + JSON.stringify(r));
  return (token = r.access_token);
}
const cab = async (base) => ({ Authorization: base === PROD ? `Bearer ${await tokenProducao()}` : "Bearer owner", "Content-Type": "application/json" });
async function listar(base, colecao) {
  const docs = [];
  let pagina = "";
  do {
    const r = await (await fetch(`${base}/${colecao}?pageSize=300${pagina ? `&pageToken=${pagina}` : ""}`, { headers: await cab(base) })).json();
    if (r.error) throw new Error(`${colecao}: ${JSON.stringify(r.error)}`);
    docs.push(...(r.documents || []));
    pagina = r.nextPageToken || "";
  } while (pagina);
  return docs;
}
/* Todos os documentos do Cadeias que a importação pode tocar (com as subcoleções das planilhas) */
async function tudo(base) {
  const r = {};
  for (const c of ["cadeias-ambientes", "cadeias-grupos", "cadeias-localidades", "cadeias-historico", "cadeias-auditoria"]) for (const d of await listar(base, c)) r[d.name.split("/documents/")[1]] = d;
  for (const k of Object.keys(r).filter((k) => k.startsWith("cadeias-localidades/") && k.split("/").length === 2)) {
    for (const s of ["registros", "arquivo", "chaves"]) for (const d of await listar(base, `${k}/${s}`)) r[d.name.split("/documents/")[1]] = d;
  }
  return r;
}
module.exports = { PROD, EMU, listar, tudo, cab, tokenProducao };
