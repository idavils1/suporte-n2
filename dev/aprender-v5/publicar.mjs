// Publica a versão 5 da Aprendizagem (trilha ssl-guia) na produção, como o botão "Publicar agora", gravando só o que muda.
// node dev/aprender-v5/publicar.mjs [--gravar]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { TRILHAS_PADRAO, TEMAS_PADRAO, GLOSSARIO_PADRAO, CONTEUDO_VERSAO, TEMAS_COM_TERMOS_NOVOS } from "../../comum/aprender-conteudo.js";

const GRAVAR = process.argv.includes("--gravar");
const AUTOR = "publicacao-automatica";
const RAIZ = "projects/suporte-n2/databases/(default)/documents";
const URL = `https://firestore.googleapis.com/v1/${RAIZ}`;

/* Normalização: cópia de comum/aprender.js */
const NIVEIS = ["Básico", "Intermediário", "Avançado"];
const SECOES = ["frase", "simples", "funciona", "exemplo", "duvidas", "termos", "saibaMais"];
const ICONES = ["i-livro", "i-aprender", "i-certificado", "i-escudo", "i-cadeado", "i-plug", "i-telefone", "i-globo", "i-ferramenta", "i-engrenagem", "i-lampada",
  "i-pessoas", "i-conversa", "i-documento", "i-tabela", "i-lista", "i-tag", "i-ajuda", "i-info", "i-alerta", "i-erro", "i-sucesso", "i-check", "i-trofeu", "i-estrela",
  "i-relogio", "i-calendario", "i-busca", "i-email", "i-link", "i-externo", "i-upload", "i-download", "i-megafone", "i-cartao", "i-imagem", "i-grade"];
const CORES = ["roxo", "azul", "verde", "laranja", "amarelo", "vermelho", "cinza"];
const ID_VALIDO = /^[a-z0-9-]{1,60}$/, ID_BLOCO = /^[a-z0-9-]{1,40}$/;
const txt = (v, max) => String(v == null ? "" : v).slice(0, max);
const numero = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
const corValida = (c) => (CORES.includes(c) ? c : "");
const normalizarCapa = (c) => (!c || typeof c !== "object" ? null : c.tipo === "imagem" ? { tipo: "imagem" } : c.tipo === "gradiente" ? { tipo: "gradiente", estilo: ["diagonal", "ondas", "pontos"].includes(c.estilo) ? c.estilo : "diagonal" } : null);
const normalizarModulo = (m, i) => (!m || !ID_VALIDO.test(m.id || "") ? null : { id: m.id, nome: txt(m.nome, 80) || m.id, descricao: txt(m.descricao, 300), ordem: Number(m.ordem) || i + 1, oculto: m.oculto === true, icone: ICONES.includes(m.icone) ? m.icone : "", cor: corValida(m.cor) });
function normalizarTrilha(t, i) {
  const aviso = t.aviso && typeof t.aviso === "object" && txt(t.aviso.texto, 200).trim() ? { texto: txt(t.aviso.texto, 200).trim(), aula: ID_VALIDO.test(t.aviso.aula || "") ? t.aviso.aula : "" } : null;
  return {
    id: t.id, nome: txt(t.nome, 100) || t.id, descricao: txt(t.descricao, 300), icone: ICONES.includes(t.icone) ? t.icone : "i-livro", ordem: Number(t.ordem) || i + 1,
    categoria: ID_VALIDO.test(t.categoria || "") ? t.categoria : "",
    modulos: (Array.isArray(t.modulos) ? t.modulos : []).map(normalizarModulo).filter(Boolean).slice(0, 30),
    oculto: t.oculto === true, destaque: numero(t.destaque, 0, 99), cor: corValida(t.cor), capa: normalizarCapa(t.capa),
    nivel: NIVEIS.includes(t.nivel) ? t.nivel : "", tempo: numero(t.tempo, 0, 6000), aviso, fontes: txt(t.fontes, 400),
    atualizadoEm: typeof t.atualizadoEm === "string" ? t.atualizadoEm : ""
  };
}
const normalizarBloco = (b, i) => ({ id: ID_BLOCO.test(b.id || "") ? b.id : `b${i + 1}`, titulo: txt(b.titulo, 120).trim() || "Seção", icone: ICONES.includes(b.icone) ? b.icone : "i-livro", markdown: txt(b.markdown, 200000) });
function dadosAula(t) {
  const s = t.secoes || {}, secoes = {};
  SECOES.forEach((x) => { secoes[x] = txt(s[x], 60000); });
  return {
    trilha: txt(t.trilha, 60), modulo: ID_VALIDO.test(t.modulo || "") ? t.modulo : "", paiId: null, ordem: Number(t.ordem) || 0,
    titulo: txt(t.titulo, 120) || t.id, resumo: txt(t.resumo, 300), nivel: NIVEIS.includes(t.nivel) ? t.nivel : "Básico",
    palavrasChave: (t.palavrasChave || []).map((p) => txt(p, 40)).filter(Boolean).slice(0, 30),
    secoes, blocos: (t.blocos || []).map(normalizarBloco).slice(0, 40),
    oculto: false, ocultaPropria: false, destaque: 0, cor: "", icone: "", tempo: 0, capa: null, revisarEm: "", atualizadoPor: AUTOR
  };
}
const normalizarTermo = (g) => ({ termo: txt(g.termo, 60).trim(), definicao: txt(g.definicao, 400).trim(), tema: ID_VALIDO.test(g.tema || "") ? g.tema : "" });
const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/* Valores do Firestore (REST) */
function paraFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(paraFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, paraFs(x)])) } };
}
function deFs(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(deFs);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, deFs(x)]));
  return null;
}

async function token() {
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"), "utf8"));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.tokens.refresh_token, client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("sem token: " + JSON.stringify(j));
  return j.access_token;
}
const tk = await token();
const cab = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };
const ler = async (caminho) => { const r = await fetch(`${URL}/${caminho}`, { headers: cab }); if (r.status === 404) return null; if (!r.ok) throw new Error(`${caminho}: ${r.status} ${await r.text()}`); return r.json(); };
async function listarIds(colecao) {
  const ids = []; let pagina = "";
  do { const r = await fetch(`${URL}/${colecao}?pageSize=300&mask.fieldPaths=titulo${pagina ? `&pageToken=${pagina}` : ""}`, { headers: cab }); const j = await r.json(); (j.documents || []).forEach((d) => ids.push(d.name.split("/").pop())); pagina = j.nextPageToken || ""; } while (pagina);
  return ids;
}

/* Estado atual e cópia de segurança */
const [trilhasDoc, glossarioDoc, categoriasDoc, sslDoc, httpsDoc] = await Promise.all(["conhecimento-config/trilhas", "conhecimento-config/glossario", "conhecimento-config/categorias", "conhecimento/ssl", "conhecimento/https"].map(ler));
const idsPublicados = await listarIds("conhecimento");
const versao = Number(trilhasDoc.fields.versao.integerValue);
const backup = path.join("backup", "2026-11-12-aprender-ssl", "producao-antes-publicar.json");
if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify({ lidoEm: new Date().toISOString(), versao, idsPublicados, trilhasDoc, glossarioDoc, categoriasDoc, sslDoc, httpsDoc }, null, 1));
console.log(`publicado: versão ${versao}, ${idsPublicados.length} aulas · embutido: versão ${CONTEUDO_VERSAO}`);
if (versao >= CONTEUDO_VERSAO) { console.log("Já está na versão nova. Nada a fazer."); process.exit(0); }
if (versao !== 4) { console.log("Versão publicada inesperada; pare e confira."); process.exit(1); }

const writes = [];
const agora = (campo) => ({ fieldPath: campo, setToServerValue: "REQUEST_TIME" });

/* 1. Trilhas: as publicadas como estão; as novas no fim */
const listaPublicada = deFs(trilhasDoc.fields.lista);
const novasTrilhas = TRILHAS_PADRAO.map(normalizarTrilha).filter((e) => !listaPublicada.some((t) => t.id === e.id));
const lista = [...listaPublicada];
novasTrilhas.forEach((e) => lista.push({ ...e, ordem: lista.length + 1 }));
writes.push({ update: { name: `${RAIZ}/conhecimento-config/trilhas`, fields: { lista: paraFs(lista), versao: paraFs(CONTEUDO_VERSAO), atualizadoPor: paraFs(AUTOR) } }, updateTransforms: [agora("atualizadoEm")] });

/* 2. Aulas novas (só das trilhas novas e que ainda não existem) */
const idsNovasTrilhas = new Set(novasTrilhas.map((t) => t.id));
const aulasNovas = TEMAS_PADRAO.filter((t) => idsNovasTrilhas.has(t.trilha) && !idsPublicados.includes(t.id));
aulasNovas.forEach((t) => writes.push({ update: { name: `${RAIZ}/conhecimento/${t.id}`, fields: paraFs(dadosAula(t)).mapValue.fields }, updateTransforms: [agora("atualizadoEm")], currentDocument: { exists: false } }));

/* 3. Aulas publicadas que ganham "Termos relacionados" novos (só trilha, módulo, ordem e termos) */
const embutidos = new Map(TEMAS_PADRAO.map((t) => [t.id, t]));
const comTermos = Object.entries(TEMAS_COM_TERMOS_NOVOS).filter(([id, v]) => versao < v && idsPublicados.includes(id)).map(([id]) => id);
comTermos.forEach((id) => {
  const e = embutidos.get(id);
  writes.push({ update: { name: `${RAIZ}/conhecimento/${id}`, fields: { trilha: paraFs(e.trilha), modulo: paraFs(e.modulo || ""), ordem: paraFs(Number(e.ordem) || 0), secoes: { mapValue: { fields: { termos: paraFs(e.secoes.termos) } } }, atualizadoPor: paraFs(AUTOR) } },
    updateMask: { fieldPaths: ["trilha", "modulo", "ordem", "secoes.termos", "atualizadoPor"] }, updateTransforms: [agora("atualizadoEm")], currentDocument: { exists: true } });
});

/* 4. Glossário: termos publicados mantêm a definição; os sem aula ligada recebem a do embutido; os novos entram no fim */
const termos = deFs(glossarioDoc.fields.termos).map((g) => ({ termo: g.termo, definicao: g.definicao, tema: g.tema || "" }));
const termosNovos = [], ligados = [];
GLOSSARIO_PADRAO.map(normalizarTermo).forEach((g) => {
  const i = termos.findIndex((x) => norm(x.termo) === norm(g.termo));
  if (i < 0) { termos.push(g); termosNovos.push(g.termo); }
  else if (!termos[i].tema && g.tema) { termos[i] = { ...termos[i], tema: g.tema }; ligados.push(`${g.termo}→${g.tema}`); }
});
writes.push({ update: { name: `${RAIZ}/conhecimento-config/glossario`, fields: { termos: paraFs(termos.slice(0, 400)), atualizadoPor: paraFs(AUTOR) } }, updateTransforms: [agora("atualizadoEm")] });

/* 5. Auditoria */
const resumo = `Publicou o conteúdo novo da Aprendizagem (versão ${CONTEUDO_VERSAO}, ${aulasNovas.length + comTermos.length} aulas)`;
writes.push({ update: { name: `${RAIZ}/auditoria/${crypto.randomBytes(15).toString("base64url").slice(0, 20)}`, fields: paraFs({ acao: "publicar", alvo: "aprendizagem", resumo, detalhes: `Trilha nova: ${novasTrilhas.map((t) => t.nome).join(", ")}. Aulas novas: ${aulasNovas.length}. Termos relacionados atualizados: ${comTermos.join(", ")}. Glossário: ${termosNovos.length} termos novos, ${ligados.length} ligados a aulas.`.slice(0, 800), porEmail: AUTOR, porNome: "Publicação automática do conteúdo do site" }).mapValue.fields }, updateTransforms: [agora("criadoEm")], currentDocument: { exists: false } });

console.log(JSON.stringify({ trilhasNovas: novasTrilhas.map((t) => `${t.id} (ordem ${lista.find((x) => x.id === t.id).ordem})`), aulasNovas: aulasNovas.map((t) => t.id), comTermos, termosNovos, ligados, escritas: writes.length,
  maiorAula: Math.max(...aulasNovas.map((t) => JSON.stringify(dadosAula(t)).length)) }, null, 1));
if (!GRAVAR) { console.log("Simulação: nada gravado. Use --gravar."); process.exit(0); }
const r = await fetch(`${URL}:commit`, { method: "POST", headers: cab, body: JSON.stringify({ writes }) });
const j = await r.json();
if (!r.ok) { console.log("ERRO", r.status, JSON.stringify(j).slice(0, 1500)); process.exit(1); }
console.log(`Gravado: ${j.writeResults.length} escrita(s) em ${j.commitTime}`);
