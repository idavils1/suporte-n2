/*
 * ============================================================
 *  Banco de Tickets · conexão com o Firebase (Auth + Firestore)
 *
 *  - Mesmo projeto Firebase, mas outro site de hosting e outro
 *    authDomain: a sessão daqui não vale em outros sites (e vice-versa).
 *  - Formas de entrar: e-mail e senha (administradoras) e, para a
 *    equipe, "Se registre como:" (login anônimo do Firebase + perfil
 *    declarado em tickets-pessoas/{uid}). Opcional: conta Microsoft.
 *  - ADMINS precisa ficar igual a adminTickets() no firestore.rules.
 *  - Para testes, uma nuvem simulada pode ser posta em
 *    window.__NUVEM_TESTE__ (mesmos métodos da API abaixo).
 * ============================================================
 */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyANFy1o-LKD0Iauh_hxQGuqxTsr5x_Wupg",
  authDomain: "banco-tickets-vcert.firebaseapp.com",
  projectId: "suporte-n2",
  storageBucket: "suporte-n2.firebasestorage.app",
  messagingSenderId: "790156812694",
  appId: "1:790156812694:web:3566f9dff5b31786e3bdb7"
};
export const URL_BANCO_TICKETS = "https://banco-tickets-vcert.web.app/";
export const ADMINS = [
  { email: "lays.almeida@valid.com", nome: "Lays" },
  { email: "paula.conceicao@valid.com", nome: "Paula" }
];
/* "Entrar com Microsoft": só ligue depois que a TI da Valid registrar o app no Azure
   e o provedor Microsoft for ativado no Firebase (veja a entrega). */
export const LOGIN_MICROSOFT = false;
const MICROSOFT_TENANT = "";
/* App Check (reCAPTCHA Enterprise): dificulta registros automáticos. Vazio = desligado.
   Para ligar: crie a chave no Console (App Check › Apps › reCAPTCHA Enterprise) e cole aqui. */
const APP_CHECK_CHAVE = "";
const VERSAO_SDK = "11.10.0";

export const ehEmailAdmin = (email) => ADMINS.some((a) => a.email === String(email || "").toLowerCase());

/* Convertem Timestamp em texto ISO; datas de controle voltam ao Firestore como "__DATA__:<ISO>" */
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

let promessa = null;
export function conectar() {
  if (!promessa) {
    promessa = (async () => {
      if (window.__NUVEM_TESTE__) return window.__NUVEM_TESTE__;
      try {
        const limite = new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error("tempo esgotado")), 15000));
        return await Promise.race([criarApi(), limite]);
      } catch (e) {
        console.warn("Firebase indisponível:", e);
        return null;
      }
    })();
  }
  return promessa;
}

async function criarApi() {
  const url = (m) => `https://www.gstatic.com/firebasejs/${VERSAO_SDK}/firebase-${m}.js`;
  const [{ initializeApp, getApps }, au, fs] = await Promise.all([import(url("app")), import(url("auth")), import(url("firestore"))]);
  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  if (APP_CHECK_CHAVE) {
    const ac = await import(url("app-check"));
    ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_CHAVE), isTokenAutoRefreshEnabled: true });
  }
  const auth = au.getAuth(app);
  auth.languageCode = "pt-BR";
  const db = fs.getFirestore(app);
  await au.setPersistence(auth, au.browserLocalPersistence);
  const ref = (caminho) => fs.doc(db, ...caminho.split("/"));
  const col = (caminho) => fs.collection(db, ...caminho.split("/"));
  const preparar = (dados) => {
    if (dados === "__AGORA__") return fs.serverTimestamp();
    if (dados === "__APAGAR__") return fs.deleteField();
    if (typeof dados === "string" && dados.startsWith("__DATA__:")) {
      const d = new Date(dados.slice(9));
      return isNaN(d) ? null : fs.Timestamp.fromDate(d);
    }
    if (Array.isArray(dados)) return dados.map(preparar);
    if (dados && typeof dados === "object") {
      const r = {};
      Object.keys(dados).forEach((k) => { r[k] = preparar(dados[k]); });
      return r;
    }
    return dados;
  };
  const consulta = (caminho, { ordenar, desc = false, limite } = {}) => {
    const partes = [];
    if (ordenar) partes.push(fs.orderBy(ordenar, desc ? "desc" : "asc"));
    if (limite) partes.push(fs.limit(limite));
    return partes.length ? fs.query(col(caminho), ...partes) : col(caminho);
  };
  /* anonimo = entrou por "Se registre como:" (a identidade fica em tickets-pessoas/{uid}) */
  const usuario = (u) => (u ? { uid: u.uid, email: String(u.email || "").toLowerCase(), nome: u.displayName || "", anonimo: !!u.isAnonymous } : null);
  return {
    real: true,
    aoMudarUsuario: (cb) => au.onAuthStateChanged(auth, (u) => cb(usuario(u))),
    usuarioAtual: () => usuario(auth.currentUser),
    entrarSenha: (email, senha) => au.signInWithEmailAndPassword(auth, email, senha),
    async entrarAnonimo() { const r = await au.signInAnonymously(auth); return usuario(r.user); },
    async entrarMicrosoft() {
      const p = new au.OAuthProvider("microsoft.com");
      p.setCustomParameters({ prompt: "select_account", ...(MICROSOFT_TENANT ? { tenant: MICROSOFT_TENANT } : {}) });
      await au.signInWithPopup(auth, p);
    },
    sair: () => au.signOut(auth),
    async lerDoc(caminho) {
      const s = await fs.getDoc(ref(caminho));
      return s.exists() ? converterValores(s.data()) : null;
    },
    async lerColecao(caminho, opcoes) {
      const s = await fs.getDocs(consulta(caminho, opcoes));
      return s.docs.map((d) => ({ id: d.id, ...converterValores(d.data()) }));
    },
    ouvirDoc(caminho, cb, aoErro) {
      return fs.onSnapshot(ref(caminho), (s) => cb(s.exists() ? converterValores(s.data({ serverTimestamps: "estimate" })) : null), aoErro || ((e) => console.warn(caminho, e)));
    },
    ouvirColecao(caminho, cb, aoErro, opcoes) {
      return fs.onSnapshot(consulta(caminho, opcoes), (s) => cb(s.docs.map((d) => ({ id: d.id, ...converterValores(d.data({ serverTimestamps: "estimate" })) }))), aoErro || ((e) => console.warn(caminho, e)));
    },
    novoId: (colecao) => fs.doc(col(colecao)).id,
    salvarDoc: (caminho, dados, mesclar = false) => fs.setDoc(ref(caminho), preparar(dados), mesclar ? { merge: true } : {}),
    /* Até 400 escritas e ~6 MB por lote (o Firestore aceita 500 escritas e 10 MiB por pedido). Cada lote é atômico. */
    async lote(ops) {
      const codificador = new TextEncoder();
      let i = 0;
      while (i < ops.length) {
        const b = fs.writeBatch(db);
        let n = 0, tamanho = 0;
        while (i < ops.length && n < 400) {
          const o = ops[i];
          const t = o.op === "delete" ? 200 : codificador.encode(JSON.stringify(o.dados)).length + 200;
          if (n && tamanho + t > 6000000) break;
          if (o.op === "delete") b.delete(ref(o.caminho));
          else b.set(ref(o.caminho), preparar(o.dados), o.mesclar ? { merge: true } : {});
          n++; tamanho += t; i++;
        }
        await b.commit();
      }
    }
  };
}
