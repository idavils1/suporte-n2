/*
 * Nuvem de teste do Cadeias V6 / V12: a MESMA API do assets/firebase.js, mas com o SDK real do Firestore
 * ligado ao Emulador (127.0.0.1:8085) e às regras de verdade (carregadas por preparar-emulador.mjs).
 * Só para este computador (não vai para o Firebase). A pessoa vem do endereço:
 *   ?quem=lays | ?quem=paula            administradora (e-mail e senha)
 *   ?quem=anon:<uid>                     navegador da equipe (login anônimo com esse uid)
 * O Emulador não tem Authentication: o "login" é o token de teste (mockUserToken) da pessoa escolhida.
 */
(function () {
  var PROJETO = "demo-cadeias-ui";
  var SDK = "https://www.gstatic.com/firebasejs/11.10.0/firebase-";
  var p = new URLSearchParams(location.search);
  var quem = p.get("quem") || "anon:pc-teste";
  var ADM = { lays: "lays.almeida@valid.com", paula: "paula.conceicao@valid.com" };
  var admin = ADM[quem] || "";
  var uid = admin ? quem : quem.replace(/^anon:/, "");
  var token = admin
    ? { sub: uid, user_id: uid, email: admin, email_verified: true, firebase: { sign_in_provider: "password" } }
    : { sub: uid, user_id: uid, firebase: { sign_in_provider: "anonymous" } };
  var usuario = admin ? { uid: uid, email: admin, nome: "", anonimo: false } : null;
  var ouvintesUsuario = [];
  var avisar = function () { ouvintesUsuario.forEach(function (cb) { cb(usuario); }); };
  var letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var novoId = function () { var s = ""; for (var i = 0; i < 20; i++) s += letras[Math.floor(Math.random() * letras.length)]; return s; };
  var pronto = Promise.all([import(SDK + "app.js"), import(SDK + "firestore.js")]).then(function (m) {
    var app = m[0].initializeApp({ projectId: PROJETO, apiKey: "teste" }, "cadeias-teste");
    var fs = m[1];
    var db = fs.getFirestore(app);
    fs.connectFirestoreEmulator(db, "127.0.0.1", 8085, { mockUserToken: token });
    return { fs: fs, db: db };
  });
  var converter = function (v) {
    if (v && typeof v === "object") {
      if (typeof v.toDate === "function") return v.toDate().toISOString();
      if (Array.isArray(v)) return v.map(converter);
      var r = {}; Object.keys(v).forEach(function (k) { r[k] = converter(v[k]); }); return r;
    }
    return v;
  };
  var api = function (x) {
    var fs = x.fs, db = x.db;
    var ref = function (c) { return fs.doc.apply(null, [db].concat(c.split("/"))); };
    var col = function (c) { return fs.collection.apply(null, [db].concat(c.split("/"))); };
    var preparar = function (d) {
      if (d === "__AGORA__") return fs.serverTimestamp();
      if (d === "__APAGAR__") return fs.deleteField();
      if (typeof d === "string" && d.indexOf("__SOMAR__:") === 0) return fs.increment(Number(d.slice(10)) || 0);
      if (typeof d === "string" && d.indexOf("__DATA__:") === 0) { var t = new Date(d.slice(9)); return isNaN(t) ? null : fs.Timestamp.fromDate(t); }
      if (Array.isArray(d)) return d.map(preparar);
      if (d && typeof d === "object") { var r = {}; Object.keys(d).forEach(function (k) { r[k] = preparar(d[k]); }); return r; }
      return d;
    };
    var consulta = function (c, o) {
      o = o || {};
      var partes = [];
      if (Array.isArray(o.onde)) (Array.isArray(o.onde[0]) ? o.onde : [o.onde]).forEach(function (w) { partes.push(fs.where.apply(null, w)); });
      if (o.ordenar) partes.push(fs.orderBy(o.ordenar, o.desc ? "desc" : "asc"));
      if (o.limite) partes.push(fs.limit(o.limite));
      return partes.length ? fs.query.apply(null, [col(c)].concat(partes)) : col(c);
    };
    return { fs: fs, ref: ref, preparar: preparar, consulta: consulta, db: db };
  };
  var comSdk = function (f) { return pronto.then(function (x) { return f(api(x)); }); };
  var ouvir = function (montar) {
    var parar = null, parado = false;
    pronto.then(function (x) { if (!parado) parar = montar(api(x)); });
    return function () { parado = true; if (parar) parar(); };
  };
  window.__NUVEM_TESTE__ = {
    real: false,
    aoMudarUsuario: function (cb) { ouvintesUsuario.push(cb); pronto.then(function () { cb(usuario); }); return function () {}; },
    usuarioAtual: function () { return usuario; },
    entrarSenha: function () { if (!admin) return Promise.reject({ code: "auth/invalid-credential" }); usuario = { uid: uid, email: admin, nome: "", anonimo: false }; avisar(); return Promise.resolve(); },
    entrarAnonimo: function () { if (admin) return Promise.reject({ code: "auth/operation-not-allowed" }); usuario = { uid: uid, email: "", nome: "", anonimo: true }; return Promise.resolve(usuario); },
    entrarMicrosoft: function () { return Promise.reject({ code: "auth/operation-not-allowed" }); },
    sair: function () { usuario = null; avisar(); return Promise.resolve(); },
    lerDoc: function (c) { return comSdk(function (a) { return a.fs.getDoc(a.ref(c)).then(function (s) { return s.exists() ? converter(s.data()) : null; }); }); },
    lerColecao: function (c, o) { return comSdk(function (a) { return a.fs.getDocs(a.consulta(c, o)).then(function (s) { return s.docs.map(function (d) { return Object.assign({ id: d.id }, converter(d.data())); }); }); }); },
    ouvirDoc: function (c, cb, erro) { return ouvir(function (a) { return a.fs.onSnapshot(a.ref(c), function (s) { cb(s.exists() ? converter(s.data({ serverTimestamps: "estimate" })) : null); }, erro || function (e) { console.warn(c, e); }); }); },
    ouvirColecao: function (c, cb, erro, o) { return ouvir(function (a) { return a.fs.onSnapshot(a.consulta(c, o), function (s) { cb(s.docs.map(function (d) { return Object.assign({ id: d.id }, converter(d.data({ serverTimestamps: "estimate" }))); })); }, erro || function (e) { console.warn(c, e); }); }); },
    novoId: function () { return novoId(); },
    salvarDoc: function (c, d, mesclar) { return comSdk(function (a) { return a.fs.setDoc(a.ref(c), a.preparar(d), mesclar ? { merge: true } : {}); }); },
    lote: function (ops) {
      return comSdk(function (a) {
        var b = a.fs.writeBatch(a.db);
        ops.forEach(function (o) { if (o.op === "delete") b.delete(a.ref(o.caminho)); else b.set(a.ref(o.caminho), a.preparar(o.dados), o.mesclar ? { merge: true } : {}); });
        return b.commit();
      });
    },
    /* Só no teste: gravar direto pelo "console" (para conferir que as regras recusam) */
    _sdk: function () { return pronto.then(function (x) { return api(x); }); },
    _quem: quem
  };
})();
