/*
 * Nuvem simulada dos Mapas de Ajuda: SÓ para testar no navegador (a pasta dev/ não vai para o Firebase).
 * Abra http://localhost:<porta>/mapas.html?nuvem-teste  (mapas.js carrega este arquivo só em localhost).
 * Imita a API de comum/base.js (window.__NUVEM_TESTE__) e, de forma simplificada, as regras:
 *   - mapas/**, mapas-lixeira/**: só quem pode editar (lays.almeida@valid.com ou paula.conceicao@valid.com)
 *   - mapas/{id}/usos: qualquer pessoa cria
 * Contas de teste (senha "teste123"): lays.almeida@valid.com (administradora) e fulano@valid.com (sem permissão).
 * O banco fica no localStorage: duas abas em localhost veem as mudanças uma da outra (tempo real).
 * Quem vale de verdade é o firestore.rules (teste no Emulador: sites/inventario-testes/mapas-regras.test.mjs).
 */
(function () {
  /* ?sem-raf: troca requestAnimationFrame por um temporizador (para testes em aba/painel oculto, onde o rAF fica pausado) */
  if (new URLSearchParams(location.search).has("sem-raf")) {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
  const EDITORES = ["lays.almeida@valid.com", "paula.conceicao@valid.com"];
  const CONTAS = [...EDITORES, "fulano@valid.com"];
  const SENHA = "teste123";
  const CHAVE_BANCO = "mapas-nuvem-teste-banco", CHAVE_SESSAO = "mapas-nuvem-teste-sessao";
  let banco = JSON.parse(localStorage.getItem(CHAVE_BANCO) || "{}");
  let usuario = sessionStorage.getItem(CHAVE_SESSAO) || null;
  const ouvintes = new Set(), ouvintesAuth = new Set();
  const clonar = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const erro = (code) => Object.assign(new Error(code), { code });
  const segs = (c) => c.split("/").length;
  function preparar(d, agora) {
    if (d === "__AGORA__") return agora;
    if (Array.isArray(d)) return d.map((x) => preparar(x, agora));
    if (d && typeof d === "object") { const r = {}; Object.keys(d).forEach((k) => { if (d[k] !== "__APAGAR__") r[k] = preparar(d[k], agora); }); return r; }
    return d;
  }
  function podeEscrever(caminho) {
    if (caminho.startsWith("auditoria/")) return true;
    if (/^mapas\/[^/]+\/usos\/[^/]+$/.test(caminho)) return true;
    return !!usuario && EDITORES.includes(usuario);
  }
  function aplicar(ops) {
    ops.forEach((o) => { if (!podeEscrever(o.caminho)) throw erro("permission-denied"); });
    const agora = new Date().toISOString();
    ops.forEach((o) => {
      if (o.op === "delete") { delete banco[o.caminho]; return; }
      const novo = preparar(o.dados, agora);
      if (o.mesclar && banco[o.caminho]) {
        const atual = banco[o.caminho];
        Object.keys(o.dados).forEach((k) => { if (o.dados[k] === "__APAGAR__") delete atual[k]; });
        banco[o.caminho] = { ...atual, ...novo };
      } else banco[o.caminho] = novo;
    });
    localStorage.setItem(CHAVE_BANCO, JSON.stringify(banco));
    avisar();
  }
  function avisar() { ouvintes.forEach((o) => setTimeout(() => o.disparar(), 0)); }
  window.addEventListener("storage", (e) => { if (e.key === CHAVE_BANCO) { banco = JSON.parse(e.newValue || "{}"); avisar(); } });
  const colecao = (c) => Object.keys(banco).filter((k) => k.startsWith(c + "/") && segs(k) === segs(c) + 1).map((k) => ({ id: k.split("/").pop(), ...clonar(banco[k]) }));
  const atraso = () => new Promise((ok) => setTimeout(ok, 30));
  window.__NUVEM_TESTE__ = {
    real: false,
    async entrar(email, senha) {
      await atraso();
      if (!CONTAS.includes(email) || senha !== SENHA) throw erro("auth/invalid-credential");
      usuario = email; sessionStorage.setItem(CHAVE_SESSAO, email);
      ouvintesAuth.forEach((cb) => cb(usuario));
    },
    async sair() { usuario = null; sessionStorage.removeItem(CHAVE_SESSAO); ouvintesAuth.forEach((cb) => cb(null)); },
    aoMudarUsuario(cb) { ouvintesAuth.add(cb); setTimeout(() => cb(usuario), 0); return () => ouvintesAuth.delete(cb); },
    async lerDoc(c) { await atraso(); return clonar(banco[c]) || null; },
    ouvirDoc(c, cb) {
      const o = { disparar: () => cb(clonar(banco[c]) || null) };
      ouvintes.add(o); setTimeout(o.disparar, 0); return () => ouvintes.delete(o);
    },
    ouvirColecao(c, cb, aoErro) {
      if (c === "mapas-lixeira" && !(usuario && EDITORES.includes(usuario))) { setTimeout(() => aoErro && aoErro(erro("permission-denied")), 0); return () => {}; }
      const o = { disparar: () => cb(colecao(c)) };
      ouvintes.add(o); setTimeout(o.disparar, 0); return () => ouvintes.delete(o);
    },
    async lerColecao(c) {
      await atraso();
      if (c === "mapas-lixeira" && !(usuario && EDITORES.includes(usuario))) throw erro("permission-denied");
      return colecao(c);
    },
    novoId: () => Math.random().toString(36).slice(2, 12),
    async salvarDoc(c, d, mesclar = false) { await atraso(); aplicar([{ caminho: c, dados: d, mesclar }]); },
    async excluirDoc(c) { await atraso(); aplicar([{ op: "delete", caminho: c }]); },
    async lote(ops) { await atraso(); aplicar(ops); },
    async registrarAuditoria(d) { aplicar([{ caminho: `auditoria/a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, dados: { ...d, criadoEm: "__AGORA__" } }]); },
    async criarAnotacao() { return "x"; },
    /* Utilitário dos testes: zera o banco simulado */
    zerar() { banco = {}; localStorage.removeItem(CHAVE_BANCO); avisar(); }
  };
})();
