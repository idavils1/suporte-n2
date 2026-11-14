/*
 * Nuvem simulada do Banco de Tickets, só para testar no navegador (não vai para o Firebase).
 * Imita a API de assets/firebase.js (window.__NUVEM_TESTE__) e, de forma simplificada,
 * as regras do firestore.rules para a entrada por e-mail e nome. Quem vale de verdade é o
 * firestore.rules: confira-o no Emulador com regras.test.mjs.
 * O banco fica no servidor de teste (servidor.ps1), compartilhado entre localhost e 127.0.0.1.
 * Administradoras: lays.almeida@valid.com ou paula.conceicao@valid.com, senha "teste123".
 */
(function () {
  const ADMINS = ["lays.almeida@valid.com", "paula.conceicao@valid.com"];
  const SENHA = "teste123";
  const CHAVE_SESSAO = "nuvem-teste-sessao";
  const RE_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}$/;
  const CAMPOS_APARELHO = ["email", "nomeChave", "vinculadoEm", "ultimoAcesso"];
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
  const aparelhoDe = (db, u) => (u ? db[`tickets-pessoas/${u.uid}`] : null);
  const identidadeDe = (db, email) => db[`tickets-identidades/${email}`];
  function perfil(db, u) {
    const p = aparelhoDe(db, u);
    if (!p) return null;
    return p.vinculadoEm ? identidadeDe(db, p.email) || null : p;
  }
  function naLista(db, u) {
    if (!u || ehAdmin(u)) return false;
    const p = aparelhoDe(db, u);
    if (!p) return false;
    if (!p.vinculadoEm) return p.ativo === true;
    const i = identidadeDe(db, p.email);
    return !!i && i.ativo === true && i.aprovado === true && (!i.revogadoAntesDe || p.vinculadoEm >= i.revogadoAntesDe);
  }
  const noTickets = (db, u) => ehAdmin(u) || naLista(db, u);
  const equipe = (db, u) => naLista(db, u) && (perfil(db, u) || {}).papel === "equipe";
  function registro(db) {
    const c = db["tickets-config/estrutura"] || {};
    return Object.assign({ aberto: true, dominios: [], papelPadrao: "equipe", aprovacao: true }, (c.regras || {}).registro || {});
  }
  function podeLer(db, u, caminho, lista) {
    const [col, id] = caminho.split("/");
    if (!u) return false;
    if (col.endsWith("-config")) return true;
    if (col === "tickets-emails") return !lista;
    if (col === "tickets-identidades") {
      if (ehAdmin(u)) return true;
      const p = aparelhoDe(db, u);
      return !lista && !!p && !!p.vinculadoEm && p.email === id;
    }
    if (col === "tickets-pessoas") return ehAdmin(u) || (!lista && id === u.uid);
    if (/-(lixeira|backups|auditoria)$/.test(col)) return ehAdmin(u);
    return noTickets(db, u);
  }
  const mudancas = (velho, novo) => [...new Set([...Object.keys(velho || {}), ...Object.keys(novo || {})])]
    .filter((k) => JSON.stringify((velho || {})[k]) !== JSON.stringify((novo || {})[k]));
  function podeGravar(antes, depois, u, o) {
    if (!u) return false;
    const partes = o.caminho.split("/");
    const [col, id] = partes;
    const velho = antes[o.caminho], novo = depois[o.caminho], admin = ehAdmin(u);
    if (col === "tickets-identidades") {
      if (o.op === "delete" || velho) return admin;
      if (admin) return true;
      const r = registro(antes), p = depois[`tickets-pessoas/${u.uid}`];
      return r.aberto && novo.email === id && RE_EMAIL.test(id) && !ADMINS.includes(id)
        && (!r.dominios.length || r.dominios.includes(id.split("@")[1]))
        && novo.nomeChave === chaveDoNome(novo.nome) && novo.nomeChave.length >= 2
        && novo.papel === r.papelPadrao && novo.ativo === true && novo.aprovado === !r.aprovacao
        && novo.criadoPorUid === u.uid && !!depois[`tickets-emails/${id}`] && !!p && p.email === id;
    }
    if (col === "tickets-emails") {
      if (o.op === "delete" || velho) return admin;
      const i = depois[`tickets-identidades/${id}`];
      return admin || (!!i && i.criadoPorUid === u.uid);
    }
    if (col === "tickets-pessoas") {
      if (o.op === "delete") return admin;
      if (admin) return !!velho;
      if (id !== u.uid) return false;
      const i = novo && depois[`tickets-identidades/${novo.email}`];
      const alteradas = mudancas(velho, novo);
      const vinculo = !!i && novo.nomeChave === i.nomeChave && (o.dados || {}).vinculadoEm === "__AGORA__"
        && (velho ? alteradas : Object.keys(novo)).every((k) => CAMPOS_APARELHO.includes(k));
      return vinculo || (!!velho && alteradas.every((k) => k === "ultimoAcesso"));
    }
    if (col.endsWith("-config") || /-(lixeira|backups|auditoria)$/.test(col)) return admin;
    if (admin) return true;
    if (!equipe(antes, u)) return false;
    if (partes.length > 2 || col.endsWith("-numeros")) return true;
    if (col.endsWith("-arquivo") || o.op === "delete") return false;
    const pf = perfil(antes, u);
    const pedindoExclusao = !!velho && !!novo.exclusao && !velho.exclusao;
    if (velho && !pedindoExclusao) {
      const cfg = antes[`${col}-config/estrutura`] || {};
      const regra = (cfg.regras || {}).equipeEdita || "proprias";
      if (regra === "nenhuma") return false;
      if (regra === "proprias" && (!velho.criadoPorEmail || velho.criadoPorEmail !== pf.email)) return false;
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
  /* Atalhos no console: __teste.banco(), __teste.zerar() (volta à semente), __teste.sessao() */
  window.__teste = {
    banco: () => clonar(banco),
    sessao: () => usuarioPublico(),
    async zerar() { banco = semente(); await gravarServidor(); localStorage.clear(); location.reload(); }
  };

  /* ---------- dados de exemplo: só cadastros antigos (antes da unificação) ---------- */
  function semente() {
    const dia = (n) => new Date(Date.now() - n * 86400000).toISOString();
    const db = {};
    db["tickets-config/estrutura"] = {
      titulo: "Banco de Tickets (teste)", versao: 1, categorias: [], gruposColunas: [{ id: "geral", nome: "Geral", ordem: 1 }],
      colunas: [
        { id: "numero", nome: "Nº do ticket", tipo: "texto", grupo: "geral", ordem: 1, largura: 150, obrigatoria: true, unica: true, padrao: "", opcoes: [], ajuda: "", acesso: "livre", ativa: true },
        { id: "resumo", nome: "Resumo", tipo: "texto", grupo: "geral", ordem: 2, largura: 260, obrigatoria: false, unica: false, padrao: "", opcoes: [], ajuda: "", acesso: "livre", ativa: true },
        { id: "status", nome: "Status", tipo: "status", grupo: "geral", ordem: 3, largura: 150, obrigatoria: false, unica: false, padrao: "aberto", ajuda: "", acesso: "lista", ativa: true,
          opcoes: [{ id: "aberto", nome: "Aberto", cor: "azul" }, { id: "resolvido", nome: "Resolvido", cor: "verde", final: true }] },
        { id: "registradoPor", nome: "Registrado por", tipo: "automatico", auto: "criadoPor", grupo: "geral", ordem: 4, largura: 190, ativa: true },
        { id: "atualizadoPor", nome: "Atualizado por", tipo: "automatico", auto: "atualizadoPor", grupo: "geral", ordem: 5, largura: 190, ativa: true }
      ],
      regras: { equipeEdita: "proprias", janelaEdicaoHoras: 0, exportacao: true, registro: { aberto: true, dominios: [], papelPadrao: "equipe", aprovacao: true } },
      colunasEquipe: ["numero", "resumo", "status"], listasEquipe: { status: ["aberto", "resolvido"] },
      atualizadoEm: dia(30), atualizadoPor: "lays.almeida@valid.com"
    };
    const antigo = (uid, nome, email, papel, ativo, pendente, criado) => {
      db[`tickets-pessoas/${uid}`] = { nome, email, papel, ativo, pendente, criadoEm: dia(criado), ultimoAcesso: dia(criado - 1) };
    };
    antigo("antigo-davi-1", "Davi Lopes", "davi.lsantos@valid.com", "equipe", true, false, 20);
    antigo("antigo-davi-2", "Davi Santos", "DAVI.LSANTOS@valid.com", "equipe", false, true, 10);
    antigo("antigo-ana", "Ana Karollyne", "ana.karollyne@valid.com", "leitura", true, false, 15);
    antigo("antigo-bruno", "Bruno Teste", "bruno.teste@valid.com", "equipe", false, false, 12);
    antigo("antigo-bruno-2", "Bruno Teste", "bruno.teste@valid.com", "equipe", true, false, 4);
    const ticket = (id, numero, resumo, uid, nome, email, criado) => {
      db[`tickets/${id}`] = {
        campos: { numero, resumo, status: "aberto" }, numero,
        criadoPor: uid, ...(email ? { criadoPorNome: nome, criadoPorEmail: email } : {}), criadoEm: dia(criado),
        atualizadoPor: uid, ...(email ? { atualizadoPorNome: nome, atualizadoPorEmail: email } : {}), atualizadoEm: dia(criado), exclusao: null
      };
      db[`tickets-numeros/${numero}`] = { ticket: id };
    };
    ticket("t-davi-a", "GLPI-1001", "Registrado pelo Davi no computador A", "antigo-davi-1", "Davi Lopes", "davi.lsantos@valid.com", 6);
    ticket("t-ana", "GLPI-1002", "Registrado pela Ana", "antigo-ana", "Ana Karollyne", "ana.karollyne@valid.com", 5);
    ticket("t-sem-email", "GLPI-0999", "Registro antigo sem e-mail de quem registrou", "antigo-davi-1", "", "", 40);
    return db;
  }
})();
