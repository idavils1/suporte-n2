/*
 * Nuvem simulada do Inventário de Equipamentos, só para testar no navegador (não vai para o Firebase).
 * Imita a API de assets/firebase.js (window.__NUVEM_TESTE__) e, de forma simplificada,
 * as regras do firestore.rules (entrada por e-mail e nome, "travado após criar", listas,
 * índices de HOSTNAME e DNA). Quem vale de verdade é o firestore.rules: confira-o no
 * Emulador com regras.test.mjs.
 * O banco fica no servidor de teste (servidor.ps1), compartilhado entre localhost e 127.0.0.1.
 * Administradoras: lays.almeida@valid.com ou paula.conceicao@valid.com, senha "teste123".
 */
(function () {
  const ADMINS = ["lays.almeida@valid.com", "paula.conceicao@valid.com"];
  const SENHA = "teste123";
  const CHAVE_SESSAO = "inventario-nuvem-teste-sessao";
  const RE_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}$/;
  const CAMPOS_APARELHO = ["email", "nomeChave", "vinculadoEm", "ultimoAcesso"];
  const LISTAS = ["area", "gestor", "status", "auditoria", "tecnico"];
  let banco = {}, versao = -1;
  let usuario = JSON.parse(localStorage.getItem(CHAVE_SESSAO) || "null");
  const ouvintes = new Set(), ouvintesAuth = new Set();

  const clonar = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const erro = (code) => Object.assign(new Error(code), { code });
  const chaveDoNome = (t) => String(t == null ? "" : t).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim();
  function preparar(d, quando) {
    if (d === "__AGORA__") return quando;
    if (typeof d === "string" && d.startsWith("__DATA__:")) return d.slice(9);
    if (Array.isArray(d)) return d.map((x) => preparar(x, quando));
    if (d && typeof d === "object") { const r = {}; Object.keys(d).forEach((k) => { r[k] = preparar(d[k], quando); }); return r; }
    return d;
  }
  function mesclar(alvo, d) {
    Object.keys(d).forEach((k) => {
      const v = d[k];
      if (v === "__APAGAR__") delete alvo[k];
      else if (v && typeof v === "object" && !Array.isArray(v) && alvo[k] && typeof alvo[k] === "object" && !Array.isArray(alvo[k])) mesclar(alvo[k], v);
      else alvo[k] = v;
    });
    return alvo;
  }
  const semApagar = (d) => mesclar({}, d);

  /* ---------- servidor ---------- */
  async function lerServidor() {
    const r = await fetch("/banco", { cache: "no-store" });
    return r.json();
  }
  async function gravarServidor() {
    const r = await fetch("/banco", { method: "PUT", body: JSON.stringify(banco) });
    versao = (await r.json()).versao;
  }
  const pronto = (async () => {
    const j = await lerServidor();
    if (j.dados == null) { banco = semente(); await gravarServidor(); }
    else { banco = j.dados; versao = j.versao; }
  })();
  setInterval(async () => {
    try { const j = await lerServidor(); if (j.dados && j.versao !== versao) { banco = j.dados; versao = j.versao; avisar(); } } catch (e) {}
  }, 700);

  /* ---------- regras (resumo do firestore.rules) ---------- */
  const ehAdmin = (u) => !!u && !u.anonimo && ADMINS.includes(u.email);
  const aparelhoDe = (db, u) => (u ? db[`inventario-pessoas/${u.uid}`] : null);
  const identidadeDe = (db, email) => db[`inventario-identidades/${email}`];
  function perfil(db, u) {
    const p = aparelhoDe(db, u);
    return p && p.vinculadoEm ? identidadeDe(db, p.email) || null : null;
  }
  function naLista(db, u) {
    if (!u || ehAdmin(u)) return false;
    const p = aparelhoDe(db, u);
    if (!p || !p.vinculadoEm) return false;
    const i = identidadeDe(db, p.email);
    return !!i && i.ativo === true && i.aprovado === true && (!i.revogadoAntesDe || p.vinculadoEm >= i.revogadoAntesDe);
  }
  const noInventario = (db, u) => ehAdmin(u) || naLista(db, u);
  const equipe = (db, u) => naLista(db, u) && ["equipe", "gestor"].includes((perfil(db, u) || {}).papel);
  const config = (db) => db["inventario-config/estrutura"] || null;
  function registro(db) {
    const c = config(db) || {};
    return Object.assign({ aberto: true, dominios: [], papelPadrao: "equipe", aprovacao: true }, (c.regras || {}).registro || {});
  }
  function podeLer(db, u, caminho, lista) {
    const [col, id] = caminho.split("/");
    if (!u) return false;
    if (col === "inventario-config") return true;
    if (col === "inventario-emails") return !lista;
    if (col === "inventario-identidades") {
      if (ehAdmin(u)) return true;
      const p = aparelhoDe(db, u);
      return !lista && !!p && !!p.vinculadoEm && p.email === id;
    }
    if (col === "inventario-pessoas") return ehAdmin(u) || (!lista && id === u.uid);
    if (/-(lixeira|backups|auditoria|hostnames|dnas)$/.test(col)) return ehAdmin(u);
    return noInventario(db, u);
  }
  const mudancas = (velho, novo) => [...new Set([...Object.keys(velho || {}), ...Object.keys(novo || {})])]
    .filter((k) => JSON.stringify((velho || {})[k]) !== JSON.stringify((novo || {})[k]));
  /* Só o valor alterado é conferido; etiquetas: só as acrescentadas precisam estar ativas */
  const listasOk = (cfg, campos, alteradas, antes = {}) => LISTAS.every((c) => {
    if (!alteradas.includes(c) || !campos[c] || (Array.isArray(campos[c]) && !campos[c].length)) return true;
    const ativas = (cfg.listasEquipe || {})[c] || [];
    if (!Array.isArray(campos[c])) return ativas.includes(campos[c]);
    const ja = Array.isArray(antes[c]) ? antes[c] : [];
    return campos[c].filter((x) => !ja.includes(x)).every((x) => ativas.includes(x));
  });
  function podeGravar(antes, depois, u, o) {
    if (!u) return false;
    const partes = o.caminho.split("/");
    const [col, id] = partes;
    const velho = antes[o.caminho], novo = depois[o.caminho], admin = ehAdmin(u);
    if (col === "inventario-identidades") {
      if (o.op === "delete" || velho) return admin;
      if (admin) return false;
      const r = registro(antes), p = depois[`inventario-pessoas/${u.uid}`];
      return !!config(antes) && r.aberto && novo.email === id && RE_EMAIL.test(id) && !ADMINS.includes(id)
        && (!r.dominios.length || r.dominios.includes(id.split("@")[1]))
        && novo.nomeChave === chaveDoNome(novo.nome) && novo.nomeChave.length >= 2
        && novo.papel === r.papelPadrao && novo.ativo === true && novo.aprovado === !r.aprovacao
        && novo.criadoPorUid === u.uid && !!depois[`inventario-emails/${id}`] && !!p && p.email === id;
    }
    if (col === "inventario-emails") {
      if (o.op === "delete" || velho) return admin;
      const i = depois[`inventario-identidades/${id}`];
      return admin || (!!i && i.criadoPorUid === u.uid);
    }
    if (col === "inventario-pessoas") {
      if (o.op === "delete") return admin;
      if (id !== u.uid) return false;
      const i = novo && depois[`inventario-identidades/${novo.email}`];
      const alteradas = mudancas(velho, novo);
      const vinculo = !!i && novo.nomeChave === i.nomeChave && (o.dados || {}).vinculadoEm === "__AGORA__"
        && (velho ? alteradas : Object.keys(novo)).every((k) => CAMPOS_APARELHO.includes(k));
      return vinculo || (!!velho && alteradas.every((k) => k === "ultimoAcesso"));
    }
    if (col === "inventario-config" || /-(lixeira|backups|auditoria|arquivo|hostnames|dnas)$/.test(col)) return admin;
    if (admin) return true;
    if (!equipe(antes, u)) return false;
    const cfg = config(antes) || {};
    const gestor = (perfil(antes, u) || {}).papel === "gestor";
    const timeN2 = !gestor;
    /* VCORP/VCERT: gestor (colunas liberadas da planilha) e Time N2 (todas) criam e editam, assinando com o próprio perfil; ninguém exclui */
    if (/^inventario-vc(orp|ert)-(hw|sw)$/.test(col)) {
      if (partes.length > 2) return true;
      if (o.op === "delete") return false;
      const cp = antes[`inventario-colunas/${col.replace(/^inventario-/, "")}`] || {};
      const alteradas = velho ? mudancas(velho.campos, novo.campos) : Object.keys(novo.campos || {});
      if (!timeN2 && Array.isArray(cp.colunasEquipe) && alteradas.some((c) => !cp.colunasEquipe.includes(c))) return false;
      const pf = perfil(antes, u);
      return novo.atualizadoPor === u.uid && novo.atualizadoPorNome === pf.nome && novo.atualizadoPorEmail === pf.email;
    }
    if (partes.length > 2) return true;
    if (o.op === "delete") return false;
    const pf = perfil(antes, u);
    const pedindoExclusao = !!velho && !!novo.exclusao && !velho.exclusao;
    if (velho && !pedindoExclusao) {
      const regra = gestor ? "todas" : (cfg.regras || {}).equipeEdita || "todas";
      if (regra === "nenhuma") return false;
      if (regra === "proprias" && (!velho.criadoPorEmail || velho.criadoPorEmail !== pf.email)) return false;
      const alteradas = mudancas(velho.campos, novo.campos);
      if (!timeN2 && alteradas.some((c) => !(cfg.colunasEquipe || []).includes(c) || (cfg.colunasTravadas || []).includes(c))) return false;
      const chavesDoc = mudancas(velho, novo);
      const permitidas = ["campos", "atualizadoPor", "atualizadoPorNome", "atualizadoPorEmail", "atualizadoEm", "exclusao", ...(timeN2 ? ["numero", "dna"] : [])];
      if (chavesDoc.some((k) => !permitidas.includes(k))) return false;
      const c = novo.campos || {};
      if ((chavesDoc.includes("numero") || alteradas.includes("hostname")) && (novo.numero || "") !== (c.hostname || "")) return false;
      if ((chavesDoc.includes("dna") || alteradas.includes("dna")) && (novo.dna || "") !== (c.dna || "")) return false;
      if (!listasOk(cfg, novo.campos || {}, alteradas, velho.campos || {})) return false;
    }
    if (!velho) {
      const chaves = Object.keys(novo.campos || {});
      if (!timeN2 && chaves.some((c) => !(cfg.colunasEquipe || []).includes(c))) return false;
      if (!timeN2 && novo.parcial && chaves.some((c) => (cfg.colunasTravadas || []).includes(c))) return false;
      if (!listasOk(cfg, novo.campos || {}, chaves)) return false;
      if ((novo.numero || "") !== ((novo.campos || {}).hostname || "") || (novo.dna || "") !== ((novo.campos || {}).dna || "")) return false;
    }
    return novo.atualizadoPor === u.uid && novo.atualizadoPorNome === pf.nome && novo.atualizadoPorEmail === pf.email;
  }

  /* ---------- API (mesmos métodos de assets/firebase.js) ---------- */
  function avisar() { ouvintes.forEach((o) => o.disparar()); }
  const usuarioPublico = () => (usuario ? { uid: usuario.uid, email: usuario.email || "", nome: "", anonimo: !!usuario.anonimo } : null);
  function definirUsuario(u) {
    usuario = u;
    if (u) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(u)); else localStorage.removeItem(CHAVE_SESSAO);
    setTimeout(() => { avisar(); ouvintesAuth.forEach((cb) => cb(usuarioPublico())); }, 0);
  }
  function docsDaColecao(caminho) {
    const n = caminho.split("/").length + 1;
    return Object.keys(banco).filter((k) => k.startsWith(caminho + "/") && k.split("/").length === n).map((k) => ({ id: k.split("/").pop(), ...clonar(banco[k]) }));
  }
  function consultar(lista, op = {}) {
    if (op.ordenar) lista.sort((a, b) => (String(a[op.ordenar] || "") < String(b[op.ordenar] || "") ? -1 : 1) * (op.desc ? -1 : 1));
    return op.limite ? lista.slice(0, op.limite) : lista;
  }
  function ouvir(ler, cb, aoErro) {
    let ultimo, ativo = true;
    const o = {
      disparar() {
        if (!ativo) return;
        let v;
        try { v = ler(); } catch (e) { ativo = false; ouvintes.delete(o); (aoErro || console.warn)(e); return; }
        const s = JSON.stringify(v);
        if (s === ultimo) return;
        ultimo = s;
        cb(v);
      }
    };
    ouvintes.add(o);
    pronto.then(() => setTimeout(() => o.disparar(), 0));
    return () => { ativo = false; ouvintes.delete(o); };
  }
  async function aplicar(ops) {
    await pronto;
    await new Promise((r) => setTimeout(r, 120));
    const quando = new Date().toISOString();
    const antes = banco, depois = clonar(banco);
    ops.forEach((o) => {
      if (o.op === "delete") { delete depois[o.caminho]; return; }
      const d = preparar(o.dados, quando);
      depois[o.caminho] = o.mesclar && depois[o.caminho] ? mesclar(depois[o.caminho], d) : semApagar(d);
    });
    for (const o of ops) if (!podeGravar(antes, depois, usuario, o)) { console.info("[nuvem-teste] recusado:", o.caminho, o.dados); throw erro("permission-denied"); }
    banco = depois;
    avisar();
    await gravarServidor();
  }
  window.__NUVEM_TESTE__ = {
    real: false,
    aoMudarUsuario(cb) { ouvintesAuth.add(cb); pronto.then(() => cb(usuarioPublico())); return () => ouvintesAuth.delete(cb); },
    usuarioAtual: () => usuarioPublico(),
    async entrarSenha(email, senha) {
      await pronto;
      if (!ADMINS.includes(email) || senha !== SENHA) throw erro("auth/invalid-credential");
      definirUsuario({ uid: `adm-${email.split("@")[0]}`, email, anonimo: false });
    },
    async entrarAnonimo() {
      await pronto;
      definirUsuario({ uid: `anon-${Math.random().toString(36).slice(2, 10)}`, anonimo: true });
      return usuarioPublico();
    },
    async entrarMicrosoft() { throw erro("auth/operation-not-allowed"); },
    async sair() { definirUsuario(null); },
    async lerDoc(caminho) {
      await pronto;
      if (!podeLer(banco, usuario, caminho, false)) throw erro("permission-denied");
      return banco[caminho] ? clonar(banco[caminho]) : null;
    },
    async lerColecao(caminho, op) {
      await pronto;
      if (!podeLer(banco, usuario, `${caminho}/x`, true)) throw erro("permission-denied");
      return consultar(docsDaColecao(caminho), op);
    },
    ouvirDoc(caminho, cb, aoErro) {
      return ouvir(() => { if (!podeLer(banco, usuario, caminho, false)) throw erro("permission-denied"); return banco[caminho] ? clonar(banco[caminho]) : null; }, cb, aoErro);
    },
    ouvirColecao(caminho, cb, aoErro, op) {
      return ouvir(() => { if (!podeLer(banco, usuario, `${caminho}/x`, true)) throw erro("permission-denied"); return consultar(docsDaColecao(caminho), op); }, cb, aoErro);
    },
    novoId: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    salvarDoc: (caminho, dados, mesclarDados = false) => aplicar([{ op: "set", caminho, dados, mesclar: mesclarDados }]),
    lote: (ops) => aplicar(ops)
  };
  /* Atalhos no console: __teste.banco(), __teste.zerar() (volta à semente), __teste.sessao(), __teste.tentar(ops) */
  window.__teste = {
    banco: () => clonar(banco),
    sessao: () => usuarioPublico(),
    tentar: (ops) => aplicar(ops).then(() => "GRAVOU", (e) => e.code),
    async zerar() { banco = semente(); await gravarServidor(); localStorage.clear(); location.reload(); }
  };

  /* ---------- dados de exemplo: nada (a Lays cria a estrutura na primeira entrada) ---------- */
  function semente() { return {}; }
})();
