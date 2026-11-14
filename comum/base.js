/*
 * ============================================================
 *  BASE DAS PÁGINAS INTERNAS (aprender.html, contatos.html, comunicados.html)
 *
 *  FIREBASE_CONFIG e ADMINS precisam ficar IGUAIS aqui, no index.html e
 *  no caderno.html (os e-mails também no firestore.rules).
 *  index.html e caderno.html NÃO importam este arquivo.
 *
 *  Sem Firebase (apiKey vazia, sem internet ou SDK bloqueado), as páginas
 *  funcionam só leitura com o conteúdo embutido em cada uma.
 *  Para testes, uma nuvem simulada pode ser posta em window.__NUVEM_TESTE__
 *  (mesmos métodos da API criada em criarApiFirebase()).
 * ============================================================
 */
import { injetarIcones } from "./icones.js";
injetarIcones();

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyANFy1o-LKD0Iauh_hxQGuqxTsr5x_Wupg",
  authDomain: "suporte-n2.firebaseapp.com",
  projectId: "suporte-n2",
  storageBucket: "suporte-n2.firebasestorage.app",
  messagingSenderId: "790156812694",
  appId: "1:790156812694:web:3566f9dff5b31786e3bdb7"
};
export const ADMINS = [
  { email: "lays.almeida@valid.com", apelido: "lays", nome: "Lays" },
  { email: "paula.conceicao@valid.com", apelido: "paula", nome: "Paula" }
];
export const CHAVE_TEMA = "suporte-n2-tema";
const CHAVE_USUARIO = "suporte-n2-usuario";
const CHAVE_AUTOR_ANOTACAO = "suporte-n2-autor-anotacao";
const VERSAO_SDK = "10.12.2";

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function escapar(valor) {
  return String(valor == null ? "" : valor)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export const normalizar = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export const svg = (id, classe = "icone") => `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true"><use href="#${escapar(id)}"/></svg>`;
export function slug(texto, max = 40) {
  return normalizar(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "") || "item";
}
export const lerLocal = (chave, padrao) => { try { const v = localStorage.getItem(chave); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } };
export const gravarLocal = (chave, valor) => { try { localStorage.setItem(chave, JSON.stringify(valor)); return true; } catch (e) { return false; } };

/* Data e hora de Brasília (independe do fuso do computador) */
export function partesBrasilia(data = new Date()) {
  const p = {};
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(data).forEach((x) => { p[x.type] = x.value; });
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour === "24" ? "00" : p.hour, minuto: p.minute };
}
export function dataHoraBrasilia(data = new Date()) {
  const p = partesBrasilia(data);
  return `${p.dia}/${p.mes}/${p.ano} às ${p.hora}:${p.minuto}`;
}
export function formatarData(valor, comHora = false) {
  if (!valor) return "";
  const d = new Date(valor);
  if (isNaN(d)) return "";
  const p = partesBrasilia(d);
  return comHora ? `${p.dia}/${p.mes}/${p.ano} às ${p.hora}:${p.minuto}` : `${p.dia}/${p.mes}/${p.ano}`;
}

/* Tema: mesma chave do index.html; o <head> de cada página já aplica antes de pintar */
export function ligarTema(botao = $("#btn-tema")) {
  if (!botao) return;
  const atualizar = () => {
    const escuro = document.documentElement.dataset.tema === "escuro";
    botao.innerHTML = svg(escuro ? "i-sol" : "i-lua");
    botao.setAttribute("aria-label", escuro ? "Usar tema claro" : "Usar tema escuro");
    botao.title = escuro ? "Tema claro" : "Tema escuro";
  };
  botao.addEventListener("click", () => {
    const escuro = document.documentElement.dataset.tema !== "escuro";
    document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
    try { localStorage.setItem(CHAVE_TEMA, escuro ? "escuro" : "claro"); } catch (e) {}
    atualizar();
    document.dispatchEvent(new CustomEvent("tema-mudou"));
  });
  atualizar();
}

/* Aviso (toast). Com link: { link, rotuloLink } */
let temporizadorAviso = null;
export function mostrarAviso(texto, opcoes = {}) {
  let el = $("#aviso");
  if (!el) {
    el = document.createElement("div");
    el.id = "aviso";
    el.className = "aviso";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.innerHTML = escapar(texto) + (opcoes.link ? ` <a href="${escapar(opcoes.link)}">${escapar(opcoes.rotuloLink || "Abrir")}</a>` : "");
  el.classList.add("visivel");
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove("visivel"), opcoes.ms || (opcoes.link ? 7000 : 3200));
}

/* ------------------------------------------------------------
 *  Sessão
 * ------------------------------------------------------------ */
export const sessao = { email: null, admin: null, pronta: false };
export const ehAdmin = () => !!sessao.admin;
export const buscarAdmin = (email) => ADMINS.find((a) => a.email === String(email || "").toLowerCase()) || null;
const ouvintesSessao = [];
export function aoMudarSessao(fn) { ouvintesSessao.push(fn); if (sessao.pronta) fn(sessao); }

/* ------------------------------------------------------------
 *  Nuvem (Firestore + Auth)
 * ------------------------------------------------------------ */
let promessaNuvem = null;
export function conectarNuvem() {
  if (!promessaNuvem) {
    promessaNuvem = (async () => {
      if (window.__NUVEM_TESTE__) return window.__NUVEM_TESTE__;
      if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.projectId) return null;
      try {
        const limite = new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("tempo esgotado")), 12000));
        return await Promise.race([criarApiFirebase(), limite]);
      } catch (e) {
        console.warn("Firebase indisponível:", e);
        return null;
      }
    })();
  }
  return promessaNuvem;
}

function converterValores(v) {
  if (v && typeof v === "object") {
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (Array.isArray(v)) return v.map(converterValores);
    const r = {};
    Object.keys(v).forEach((k) => { r[k] = converterValores(v[k]); });
    return r;
  }
  return v;
}

async function criarApiFirebase() {
  const url = (m) => `https://www.gstatic.com/firebasejs/${VERSAO_SDK}/firebase-${m}.js`;
  const [{ initializeApp, getApps }, au, fs] = await Promise.all([import(url("app")), import(url("auth")), import(url("firestore"))]);
  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  const auth = au.getAuth(app);
  const db = fs.getFirestore(app);
  await au.setPersistence(auth, au.browserSessionPersistence);
  const ref = (caminho) => fs.doc(db, ...caminho.split("/"));
  const col = (caminho) => fs.collection(db, ...caminho.split("/"));
  const preparar = (dados) => {
    if (dados === "__AGORA__") return fs.serverTimestamp();
    if (dados === "__APAGAR__") return fs.deleteField();
    if (dados && typeof dados === "object" && !Array.isArray(dados)) {
      const r = {};
      Object.keys(dados).forEach((k) => { r[k] = preparar(dados[k]); });
      return r;
    }
    if (Array.isArray(dados)) return dados.map(preparar);
    return dados;
  };
  return {
    real: true,
    entrar: (email, senha) => au.signInWithEmailAndPassword(auth, email, senha),
    sair: () => au.signOut(auth),
    aoMudarUsuario: (cb) => au.onAuthStateChanged(auth, (u) => cb(u ? String(u.email || "").toLowerCase() : null)),
    async lerDoc(caminho) {
      const s = await fs.getDoc(ref(caminho));
      return s.exists() ? converterValores(s.data()) : null;
    },
    ouvirDoc(caminho, cb, aoErro) {
      return fs.onSnapshot(ref(caminho), (s) => cb(s.exists() ? converterValores(s.data({ serverTimestamps: "estimate" })) : null), aoErro || ((e) => console.warn(caminho, e)));
    },
    /* opcoes.onde = [campo, operador, valor]: filtro na consulta (ex.: ["oculto", "==", false] para quem não é administradora) */
    ouvirColecao(caminho, cb, aoErro, opcoes = {}) {
      const alvo = opcoes && Array.isArray(opcoes.onde) ? fs.query(col(caminho), fs.where(...opcoes.onde)) : col(caminho);
      return fs.onSnapshot(alvo, (s) => cb(s.docs.map((d) => ({ id: d.id, ...converterValores(d.data({ serverTimestamps: "estimate" })) }))), aoErro || ((e) => console.warn(caminho, e)));
    },
    async lerColecao(caminho) {
      const s = await fs.getDocs(col(caminho));
      return s.docs.map((d) => ({ id: d.id, ...converterValores(d.data()) }));
    },
    novoId: (colecao) => fs.doc(col(colecao)).id,
    salvarDoc: (caminho, dados, mesclar = false) => fs.setDoc(ref(caminho), preparar(dados), mesclar ? { merge: true } : {}),
    excluirDoc: (caminho) => fs.deleteDoc(ref(caminho)),
    async lote(ops) {
      for (let i = 0; i < ops.length; i += 400) {
        const b = fs.writeBatch(db);
        ops.slice(i, i + 400).forEach((o) => {
          if (o.op === "delete") b.delete(ref(o.caminho));
          else b.set(ref(o.caminho), preparar(o.dados), o.mesclar ? { merge: true } : {});
        });
        await b.commit();
      }
    },
    incrementar: (caminho, campo) => fs.setDoc(ref(caminho), { [campo]: fs.increment(1) }, { merge: true }),
    async criarAnotacao({ titulo, texto, autor }) {
      const r = await fs.addDoc(col("anotacoes"), {
        titulo, texto, autor, fixada: false, importante: false, importanteEm: null, anexos: [], criadoEm: fs.serverTimestamp()
      });
      return r.id;
    },
    registrarAuditoria: (dados) => fs.addDoc(col("auditoria"), { ...dados, criadoEm: fs.serverTimestamp() })
  };
}

export function registrarAuditoria({ acao, alvo, resumo, detalhes }) {
  conectarNuvem().then((api) => {
    if (!api || !api.registrarAuditoria) return;
    const porEmail = sessao.email || "visitante";
    const porNome = sessao.admin ? sessao.admin.nome : (porEmail === "visitante" ? "Visitante" : porEmail);
    return api.registrarAuditoria({
      acao: String(acao || "outro").slice(0, 40),
      alvo: String(alvo || "").slice(0, 40),
      resumo: String(resumo || "").slice(0, 200),
      detalhes: String(detalhes || "").slice(0, 800),
      porEmail: String(porEmail).slice(0, 80),
      porNome: String(porNome).slice(0, 80)
    });
  }).catch((e) => console.warn("Auditoria:", e));
}

/* ------------------------------------------------------------
 *  Diálogos genéricos
 * ------------------------------------------------------------ */
export function criarDialogo({ titulo, corpo, largo = false, rotulo }) {
  const d = document.createElement("dialog");
  d.className = "perfil" + (largo ? " largo" : "");
  d.setAttribute("aria-label", rotulo || titulo);
  d.innerHTML = `<form class="form-dialog" method="dialog" novalidate>
    <div class="form-topo"><h2>${escapar(titulo)}</h2>
      <button type="button" class="perfil-fechar" data-fechar aria-label="Fechar">${svg("i-fechar")}</button></div>
    ${corpo}
  </form>`;
  document.body.appendChild(d);
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-fechar]")) d.close();
  });
  d.addEventListener("close", () => setTimeout(() => d.remove(), 300));
  return d;
}

export function confirmar(texto, { titulo = "Confirmar", botao = "Confirmar", perigo = false } = {}) {
  return new Promise((resolver) => {
    const d = criarDialogo({
      titulo,
      corpo: `<p class="apoio">${escapar(texto)}</p>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
        <button type="submit" class="btn${perigo ? " btn-perigo" : ""}" value="ok">${escapar(botao)}</button></div>`
    });
    let ok = false;
    d.querySelector("form").addEventListener("submit", () => { ok = true; });
    d.addEventListener("close", () => resolver(ok));
    d.showModal();
  });
}

/* "Sugerir melhoria/correção": vira uma anotação na aba Anotações do index (mesma coleção e regras) */
export function abrirSugestao({ titulo, contexto = "", dica = "" }) {
  const d = criarDialogo({
    titulo: "Enviar sugestão",
    corpo: `<p class="apoio">Sua sugestão vira uma anotação na aba <strong>Anotações</strong> da Central, com o título <strong>${escapar(titulo)}</strong>.</p>
      <label class="campo"><span class="rotulo">Seu nome</span><input name="autor" maxlength="60" required autocomplete="name"></label>
      <label class="campo"><span class="rotulo">Sugestão</span><textarea name="texto" maxlength="3500" rows="6" required placeholder="${escapar(dica || "O que pode melhorar?")}"></textarea></label>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
      <button type="submit" class="btn">Enviar sugestão</button></div>`
  });
  const form = d.querySelector("form");
  try { form.autor.value = localStorage.getItem(CHAVE_AUTOR_ANOTACAO) || ""; } catch (e) {}
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const autor = form.autor.value.trim().slice(0, 60);
    const texto = form.texto.value.trim();
    const erro = form.querySelector(".form-erro");
    if (!autor || !texto) { erro.textContent = "Preencha seu nome e a sugestão."; return; }
    const api = await conectarNuvem();
    if (!api) { erro.textContent = "Sem conexão com a nuvem agora. Tente mais tarde."; return; }
    const botao = form.querySelector('[type="submit"]');
    botao.disabled = true;
    try {
      const textoFinal = (contexto ? contexto + "\n\n" : "") + texto;
      const id = await api.criarAnotacao({ titulo: String(titulo).slice(0, 120), texto: textoFinal.slice(0, 4000), autor });
      try { localStorage.setItem(CHAVE_AUTOR_ANOTACAO, autor); } catch (err) {}
      registrarAuditoria({ acao: "criar", alvo: "anotacao", resumo: "Criou anotação: " + titulo, detalhes: id });
      d.close();
      mostrarAviso("Sugestão enviada. Obrigado!");
    } catch (err) {
      console.error(err);
      erro.textContent = "Não foi possível enviar agora. Tente de novo.";
      botao.disabled = false;
    }
  });
  d.showModal();
  (form.autor.value ? form.texto : form.autor).focus();
}

/* ------------------------------------------------------------
 *  Login / logout (mesmo comportamento do index.html)
 * ------------------------------------------------------------ */
function mensagemFirebase(erro) {
  const codigo = (erro && erro.code) || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(codigo)) return "E-mail ou senha incorretos.";
  if (/too-many-requests/.test(codigo)) return "Muitas tentativas. Espere alguns minutos e tente de novo.";
  if (/network/.test(codigo)) return "Sem conexão. Verifique a internet e tente de novo.";
  return "Não foi possível entrar agora. Tente de novo.";
}

function abrirLogin(api) {
  const d = criarDialogo({
    titulo: "Entrar",
    corpo: `<p class="apoio">Acesso da administração (e de quem tem permissão de edição nesta página).</p>
      <label class="campo"><span class="rotulo">Usuário ou e-mail</span><input name="usuario" autocomplete="username" required></label>
      <label class="campo"><span class="rotulo">Senha</span><input name="senha" type="password" autocomplete="current-password" required></label>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
      <button type="submit" class="btn">Entrar</button></div>`
  });
  const form = d.querySelector("form");
  const erro = form.querySelector(".form-erro");
  let lembrado = "";
  try { lembrado = localStorage.getItem(CHAVE_USUARIO) || ""; } catch (e) {}
  form.usuario.value = lembrado;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const digitado = form.usuario.value.trim();
    if (!digitado || !form.senha.value) { erro.textContent = "Informe usuário e senha."; return; }
    if (!api) { erro.textContent = "O login está indisponível: o Firebase não carregou."; return; }
    const email = digitado.includes("@") ? digitado.toLowerCase() : (ADMINS.find((a) => a.apelido === digitado.toLowerCase())?.email || "");
    if (!email) { erro.textContent = "E-mail ou senha incorretos."; return; }
    try { localStorage.setItem(CHAVE_USUARIO, digitado); } catch (err) {}
    const botao = form.querySelector('[type="submit"]');
    botao.disabled = true;
    erro.textContent = "";
    try {
      await api.entrar(email, form.senha.value);
      d.close();
    } catch (err) {
      erro.textContent = mensagemFirebase(err);
      form.senha.value = "";
      form.senha.focus();
    } finally { botao.disabled = false; }
  });
  d.showModal();
  (lembrado ? form.senha : form.usuario).focus();
}

export async function ligarLogin(botao = $("#btn-login")) {
  const api = await conectarNuvem();
  const atualizarBotao = () => {
    if (!botao) return;
    const logado = !!sessao.email;
    botao.innerHTML = svg(logado ? "i-sair" : "i-entrar") + `<span>${logado ? "Sair" : "Entrar"}</span>`;
    botao.title = logado ? `Sair (${sessao.email})` : "Entrar";
    botao.setAttribute("aria-label", logado ? "Sair" : "Entrar");
  };
  if (botao) {
    botao.hidden = !api;
    botao.addEventListener("click", async () => {
      if (sessao.email) {
        try { await api.sair(); mostrarAviso("Você saiu."); } catch (e) { console.error(e); }
      } else abrirLogin(api);
    });
  }
  const avisar = () => { sessao.pronta = true; atualizarBotao(); ouvintesSessao.forEach((fn) => { try { fn(sessao); } catch (e) { console.error(e); } }); };
  if (!api || !api.aoMudarUsuario) { avisar(); return api; }
  api.aoMudarUsuario((email) => {
    sessao.email = email || null;
    sessao.admin = buscarAdmin(email);
    avisar();
  });
  return api;
}

/* Arquivo para baixar */
export function baixarArquivo(nome, conteudo, tipo = "text/plain;charset=utf-8") {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function copiarTexto(texto) {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch (e) {
    const t = document.createElement("textarea");
    t.value = texto; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) {}
    t.remove();
    return ok;
  }
}
