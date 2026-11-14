/*
 * ============================================================
 *  APRENDIZAGEM — MODO EDIÇÃO (só administradoras: Lays e Paula)
 *  Controles no lugar (⋮⋮ arrastar, lápis, menu ⋯) para CATEGORIAS, TRILHAS, MÓDULOS e AULAS:
 *  adicionar, renomear, mover (arrastar e soltar, Alt+setas ou "Mover para…"), duplicar, ocultar,
 *  remover (vai para conhecimento-lixeira, com Restaurar), aparência, destaque.
 *  Editor de aula com seções flexíveis, barra de formatação, selos, prévia ao vivo e rascunho no navegador.
 *  Cada publicação de aula guarda a anterior em conhecimento/{id}/versoes (Ver diferenças / Restaurar).
 *  Ações de estrutura podem ser desfeitas por 10 s. Tudo vai para a Auditoria (alvo "aprendizagem").
 * ============================================================
 */
import { $, $$, escapar, svg, slug, mostrarAviso, sessao, criarDialogo, confirmar, lerLocal, gravarLocal, formatarData } from "./base.js";
import { SELOS, CALLOUTS, CORES as CORES_TEXTO, celulasTabela } from "./markdown.js";

const CHAVE_EDICAO = "suporte-n2-aprender-modo-edicao";
const CHAVE_RASCUNHO = (id) => `suporte-n2-aprender-rascunho-${id}`;
const MAX_VERSOES = 30;
const LIMITE_AULA = 900000;
const ESTILOS_CAPA = { diagonal: "Diagonal", ondas: "Ondas", pontos: "Pontos" };
const clonar = (x) => JSON.parse(JSON.stringify(x));
const NOMES_TIPO = { categoria: "categoria", trilha: "trilha", modulo: "módulo", aula: "aula" };

export function iniciarEditor(app) {
  const { estado } = app;
  const ativo = () => estado.edicao && app.podeEditar();

  /* ------------------------------------------------------------
   *  Botão "Modo edição" e barra do modo
   * ------------------------------------------------------------ */
  const botao = $("#btn-edicao");
  const barra = $("#barra-edicao");
  function atualizarBotao() {
    botao.hidden = !app.podeEditar();
    botao.setAttribute("aria-pressed", String(ativo()));
    botao.innerHTML = `${svg("i-lapis")}<span>${ativo() ? "Sair do modo edição" : "Modo edição"}</span>`;
    barra.hidden = !ativo();
    document.body.classList.toggle("modo-edicao", ativo());
  }
  botao.addEventListener("click", () => {
    estado.edicao = !estado.edicao;
    try { sessionStorage.setItem(CHAVE_EDICAO, estado.edicao ? "1" : ""); } catch (e) {}
    atualizarBotao();
    app.navegar(false);
    mostrarAviso(estado.edicao ? "Modo edição ligado: os controles aparecem onde cada coisa está." : "Modo edição desligado.");
  });
  try { estado.edicao = sessionStorage.getItem(CHAVE_EDICAO) === "1"; } catch (e) {}
  barra.innerHTML = `<span>${svg("i-lapis")}<strong>Modo edição</strong> · arraste pela alça ⋮⋮ (ou foque nela e use Alt+↑/↓), clique no título para renomear, use ⋯ para o resto.</span>
    <span class="barra-edicao-acoes"><button type="button" class="btn btn-secundario btn-mini" data-ed-global="lixeira">${svg("i-lixeira")}Lixeira</button>
    <button type="button" class="btn btn-secundario btn-mini" data-ed-global="glossario">${svg("i-livro")}Glossário</button></span>`;
  barra.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ed-global]");
    if (!b) return;
    if (b.dataset.edGlobal === "lixeira") abrirLixeira();
    if (b.dataset.edGlobal === "glossario") editarGlossario();
  });

  /* ------------------------------------------------------------
   *  Peças que as páginas incluem (vazias fora do modo edição)
   * ------------------------------------------------------------ */
  const nomeDe = (tipo, id) => {
    if (tipo === "categoria") return (app.categoriaPorId(id) || {}).nome || id;
    if (tipo === "trilha") return (app.trilhaPorId(id) || {}).nome || id;
    if (tipo === "modulo") { const [tr, m] = id.split("/"); return (app.modulosDe(app.trilhaPorId(tr)).find((x) => x.id === m) || {}).nome || m; }
    if (tipo === "aula") return (app.porId(id) || {}).titulo || id;
    return id;
  };
  const item = (tipo, id) => (ativo() ? ` data-ed-item="${escapar(tipo)}" data-ed-id="${escapar(id)}"` : "");
  const zona = (tipo, pai) => (ativo() ? ` data-ed-zona="${escapar(tipo)}" data-ed-pai="${escapar(pai)}"` : "");
  const renomeavel = (tipo, id) => (ativo() ? ` data-ed-renomear="${escapar(tipo)}" data-ed-id="${escapar(id)}" title="Clique para renomear"` : "");
  function controles(tipo, id, opcoes = {}) {
    if (!ativo()) return "";
    if (tipo === "destaque") {
      const [t, i] = id.split(/:(.+)/);
      const n = nomeDe(t, i);
      return `<div class="ed-controles" data-ed-tipo="destaque" data-ed-id="${escapar(id)}">
        <button type="button" class="ed-alca" draggable="true" data-ed-arrastar aria-label="Mudar a ordem do destaque ${escapar(n)}: arraste ou use Alt+seta para cima/baixo" title="Arraste para mudar a ordem (ou Alt+↑/↓)">⋮⋮</button>
        <button type="button" class="ed-botao" data-ed-acao="tirar-destaque" aria-label="Tirar ${escapar(n)} do destaque" title="Tirar do destaque">${svg("i-fechar")}</button></div>`;
    }
    const nome = nomeDe(tipo, id);
    return `<div class="ed-controles" data-ed-tipo="${escapar(tipo)}" data-ed-id="${escapar(id)}">
      ${opcoes.pagina ? "" : `<button type="button" class="ed-alca" draggable="true" data-ed-arrastar aria-label="Mover ${escapar(NOMES_TIPO[tipo])} ${escapar(nome)}: arraste ou use Alt+seta para cima/baixo" title="Arraste para mover (ou Alt+↑/↓)">⋮⋮</button>`}
      <button type="button" class="ed-botao" data-ed-acao="renomear" aria-label="Renomear ${escapar(nome)}" title="Renomear">${svg("i-lapis")}</button>
      <button type="button" class="ed-botao" data-ed-menu aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações: ${escapar(nome)}" title="Mais ações">⋯</button></div>`;
  }
  function adicionar(tipo, pai) {
    if (!ativo()) return "";
    const rotulo = { categoria: "Nova categoria", trilha: "Nova trilha", modulo: "Novo módulo", aula: "Nova aula" }[tipo];
    return `<button type="button" class="ed-adicionar" data-ed-novo="${escapar(tipo)}" data-ed-pai="${escapar(pai)}">${svg("i-mais")}${rotulo}</button>`;
  }
  function zonaOutrasTrilhas(trilhaAtual) {
    if (!ativo()) return "";
    const outras = app.categoriasOrdenadas().flatMap((c) => app.trilhasDaCategoria(c.id)).filter((t) => t.id !== trilhaAtual);
    if (!outras.length) return "";
    return `<div class="ed-outras-trilhas" aria-label="Mover aula para outra trilha"><p class="apoio">Arraste uma aula até aqui para mover para outra trilha (ela vai junto com as aulas de dentro):</p>
      <div class="ed-outras-lista">${outras.map((t) => `<span class="ed-destino" data-ed-zona="aula" data-ed-pai="${escapar(t.id)}/${escapar(app.modulosDe(t)[0].id)}">${svg(t.icone)}${escapar(t.nome)}</span>`).join("")}</div></div>`;
  }
  function botoesAula(t) {
    if (!app.podeEditar()) return "";
    return `<button type="button" class="btn btn-secundario btn-mini" data-ed-aula="editar" data-ed-id="${escapar(t.id)}">${svg("i-lapis")}Editar aula</button>
      <button type="button" class="btn btn-secundario btn-mini" data-ed-aula="historico" data-ed-id="${escapar(t.id)}">${svg("i-relogio")}Histórico</button>
      ${ativo() ? controles("aula", t.id, { pagina: true }) : ""}`;
  }
  const botoesGlossario = () => (app.podeEditar() ? `<p><button type="button" class="btn btn-secundario btn-mini" data-ed-global-pagina="glossario">${svg("i-lapis")}Editar glossário</button></p>` : "");

  /* ------------------------------------------------------------
   *  Gravação com desfazer (10 s) e auditoria
   *  m = { categorias, trilhas, aulas: [objetos], apagarAulas: [ids], ops: [extras], opsDesfazer: [extras] }
   * ------------------------------------------------------------ */
  function aplicarLocal(m) {
    if (m.categorias) estado.categorias = m.categorias;
    if (m.trilhas) estado.trilhas = m.trilhas;
    const mapa = new Map(estado.temas.map((t) => [t.id, t]));
    (m.aulas || []).forEach((a) => mapa.set(a.id, a));
    (m.apagarAulas || []).forEach((id) => mapa.delete(id));
    estado.temas = [...mapa.values()];
    const tocadas = new Set((m.aulas || []).map((a) => a.id));
    /* "oculto" efetivo mudou (categoria, trilha ou módulo ocultos/mostrados): a aula é regravada */
    estado.temas.forEach((a) => { const ef = app.ocultoEfetivo(a); if (ef !== a.oculto) { a.oculto = ef; tocadas.add(a.id); } });
    return { mapa, tocadas };
  }
  function opsDe(m, { mapa, tocadas }) {
    const ops = [];
    if (m.categorias) ops.push({ op: "set", caminho: "conhecimento-config/categorias", dados: { lista: estado.categorias, ...app.assinatura() } });
    if (m.trilhas) ops.push({ op: "set", caminho: "conhecimento-config/trilhas", dados: { lista: estado.trilhas.map(app.dadosTrilha), versao: estado.versaoPublicada || app.CONTEUDO_VERSAO, ...app.assinatura() } });
    tocadas.forEach((id) => { const a = mapa.get(id); if (a) ops.push({ op: "set", caminho: `conhecimento/${id}`, dados: app.dadosTema(a) }); });
    (m.apagarAulas || []).forEach((id) => ops.push({ op: "delete", caminho: `conhecimento/${id}` }));
    ops.push(...(m.ops || []));
    return ops;
  }
  async function gravar(m, meta) {
    const antes = { categorias: clonar(estado.categorias), trilhas: clonar(estado.trilhas), temas: clonar(estado.temas) };
    const r = aplicarLocal(m);
    const ops = opsDe(m, r);
    app.redesenhar();
    try {
      await estado.api.lote(ops);
    } catch (e) {
      console.error(e);
      estado.categorias = antes.categorias; estado.trilhas = antes.trilhas; estado.temas = antes.temas;
      app.redesenhar();
      mostrarAviso("Não foi possível salvar. Confira a conexão e se você entrou como administradora.");
      throw e;
    }
    app.registrarAuditoria({ acao: meta.acao || "editar", alvo: "aprendizagem", resumo: String(meta.resumo).slice(0, 200), detalhes: meta.detalhes || "" });
    if (meta.desfazer !== false) avisoDesfazer(meta.resumo, () => desfazer(antes, m, r, meta));
    else mostrarAviso(meta.resumo);
  }
  /* Volta as listas e as aulas tocadas ao estado anterior; aulas criadas são apagadas */
  async function desfazer(antes, m, r, meta) {
    const ids = new Set([...r.tocadas, ...(m.apagarAulas || [])]);
    const antigas = new Map(antes.temas.map((t) => [t.id, t]));
    const volta = {
      categorias: m.categorias ? antes.categorias : null,
      trilhas: m.trilhas ? antes.trilhas : null,
      aulas: [...ids].map((id) => antigas.get(id)).filter(Boolean),
      apagarAulas: [...ids].filter((id) => !antigas.has(id)),
      ops: m.opsDesfazer || []
    };
    if (!volta.categorias) delete volta.categorias;
    if (!volta.trilhas) delete volta.trilhas;
    await gravar(volta, { acao: "desfazer", resumo: `Desfez: ${meta.resumo}`.slice(0, 200), desfazer: false });
  }
  let temporizadorDesfazer = null;
  function avisoDesfazer(texto, fn) {
    let el = $("#aviso-desfazer");
    if (!el) {
      el = document.createElement("div");
      el.id = "aviso-desfazer";
      el.className = "aviso-desfazer";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    clearInterval(temporizadorDesfazer);
    let s = 10;
    el.innerHTML = `<span>${escapar(texto)}</span><button type="button" class="btn btn-mini">${svg("i-desfazer")}Desfazer <span class="contador">(${s})</span></button>`;
    el.hidden = false;
    const fechar = () => { clearInterval(temporizadorDesfazer); el.hidden = true; };
    el.querySelector("button").addEventListener("click", async () => { fechar(); try { await fn(); } catch (e) { /* aviso já mostrado */ } });
    temporizadorDesfazer = setInterval(() => { s--; const c = el.querySelector(".contador"); if (c) c.textContent = `(${s})`; if (s <= 0) fechar(); }, 1000);
  }

  /* ------------------------------------------------------------
   *  Operações de estrutura
   * ------------------------------------------------------------ */
  const idUnico = (base, existe) => { let id = slug(base, 50) || "item", n = 2; const raiz = id; while (existe(id)) id = `${raiz}-${n++}`; return id; };
  const proximaOrdem = (lista) => lista.reduce((m, x) => Math.max(m, x.ordem || 0), 0) + 1;
  const renumerar = (lista) => lista.forEach((x, i) => { x.ordem = i + 1; });
  const agoraIso = () => new Date().toISOString();
  /* Descendentes de uma aula (vão junto quando ela muda de lugar) */
  function descendentes(id) {
    const r = [];
    const visitar = (pid) => estado.temas.filter((t) => t.paiId === pid).forEach((t) => { r.push(t); visitar(t.id); });
    visitar(id);
    return r;
  }
  /* Trilha sem módulos (módulo virtual "Conteúdo"): ao criar o primeiro módulo de verdade, o "Conteúdo" passa a existir */
  function garantirModulosReais(tr) {
    if (!tr.modulos.length) tr.modulos = [{ id: "conteudo", nome: "Conteúdo", descricao: "", ordem: 1, oculto: false, icone: "", cor: "" }];
  }
  function moduloPorChave(chave) {
    const [trId, mId] = String(chave).split("/");
    const tr = app.trilhaPorId(trId);
    return { tr, m: tr ? app.modulosDe(tr).find((x) => x.id === mId) : null, trId, mId };
  }

  async function renomear(tipo, id, nome) {
    nome = nome.trim();
    if (!nome) return;
    if (tipo === "categoria") {
      const lista = clonar(estado.categorias); const c = lista.find((x) => x.id === id); if (!c || c.nome === nome) return;
      const antigo = c.nome; c.nome = nome.slice(0, 60);
      await gravar({ categorias: lista }, { resumo: `Renomeou a categoria “${antigo}” para “${c.nome}”` });
    }
    if (tipo === "trilha") {
      const lista = clonar(estado.trilhas); const t = lista.find((x) => x.id === id); if (!t || t.nome === nome) return;
      const antigo = t.nome; t.nome = nome.slice(0, 100); t.atualizadoEm = agoraIso();
      await gravar({ trilhas: lista }, { resumo: `Renomeou a trilha “${antigo}” para “${t.nome}”` });
    }
    if (tipo === "modulo") {
      const [trId, mId] = id.split("/");
      const lista = clonar(estado.trilhas); const t = lista.find((x) => x.id === trId); if (!t) return;
      garantirModulosReais(t);
      const m = t.modulos.find((x) => x.id === mId); if (!m || m.nome === nome) return;
      const antigo = m.nome; m.nome = nome.slice(0, 80);
      await gravar({ trilhas: lista }, { resumo: `Renomeou o módulo “${antigo}” para “${m.nome}” (${t.nome})` });
    }
    if (tipo === "aula") {
      const a = app.porId(id); if (!a || a.titulo === nome) return;
      const novo = { ...clonar(a), titulo: nome.slice(0, 120) };
      await gravar({ aulas: [novo] }, { resumo: `Renomeou a aula “${a.titulo}” para “${novo.titulo}”`, detalhes: id });
    }
  }

  /* Mover: "pai" é o contêiner de destino (categoria, trilha, "trilha/módulo" ou "" para a lista de categorias/destaques) */
  async function mover(tipo, id, pai, indice) {
    if (tipo === "categoria") {
      const lista = clonar(estado.categorias).sort(app.porOrdem);
      const i = lista.findIndex((c) => c.id === id); if (i < 0) return;
      const [c] = lista.splice(i, 1); lista.splice(Math.max(0, Math.min(lista.length, indice)), 0, c); renumerar(lista);
      await gravar({ categorias: lista }, { resumo: `Moveu a categoria “${c.nome}” para a posição ${lista.indexOf(c) + 1}` });
    }
    if (tipo === "trilha") {
      const lista = clonar(estado.trilhas);
      const t = lista.find((x) => x.id === id); if (!t) return;
      const origem = t.categoria;
      t.categoria = pai;
      const daCat = lista.filter((x) => x !== t && app.categoriaDaTrilha(x) === pai).sort(app.porOrdem);
      daCat.splice(Math.max(0, Math.min(daCat.length, indice)), 0, t); renumerar(daCat);
      const cat = app.categoriaPorId(pai);
      await gravar({ trilhas: lista }, { resumo: origem === pai ? `Reordenou a trilha “${t.nome}”` : `Moveu a trilha “${t.nome}” para a categoria “${cat ? cat.nome : pai}”` });
    }
    if (tipo === "modulo") {
      const [trOrigem, mId] = id.split("/");
      const lista = clonar(estado.trilhas);
      const origem = lista.find((x) => x.id === trOrigem), destino = lista.find((x) => x.id === pai);
      if (!origem || !destino) return;
      garantirModulosReais(origem);
      const m = origem.modulos.find((x) => x.id === mId); if (!m) return;
      const aulas = [];
      if (origem !== destino) {
        garantirModulosReais(destino);
        origem.modulos = origem.modulos.filter((x) => x !== m);
        let novoId = m.id;
        if (destino.modulos.some((x) => x.id === novoId)) novoId = idUnico(m.nome, (x) => destino.modulos.some((k) => k.id === x));
        /* As aulas do módulo (com as filhas) vão junto para a outra trilha */
        estado.temas.filter((a) => a.trilha === trOrigem && app.moduloDe(a) === mId && (!a.paiId || !app.porId(a.paiId))).forEach((a) => {
          [a, ...descendentes(a.id)].forEach((x) => aulas.push({ ...clonar(x), trilha: destino.id, modulo: x === a ? novoId : x.modulo }));
        });
        m.id = novoId;
      } else destino.modulos = destino.modulos.filter((x) => x !== m);
      const ordem = [...destino.modulos].sort(app.porOrdem);
      ordem.splice(Math.max(0, Math.min(ordem.length, indice)), 0, m); renumerar(ordem);
      destino.modulos = ordem;
      await gravar({ trilhas: lista, aulas }, { resumo: origem === destino ? `Reordenou o módulo “${m.nome}” (${destino.nome})` : `Moveu o módulo “${m.nome}” de “${origem.nome}” para “${destino.nome}” (${aulas.length} aula(s))` });
    }
    if (tipo === "aula") {
      const a = app.porId(id); if (!a) return;
      const { tr, trId, mId } = moduloPorChave(pai); if (!tr) return;
      let trilhas = null;
      if (!app.modulosDe(tr).some((x) => x.id === mId)) return;
      const raizes = estado.temas.filter((t) => t.id !== id && t.trilha === trId && (!t.paiId || !app.porId(t.paiId)) && app.moduloDe(t) === mId).sort(app.porOrdem).map(clonar);
      const movida = { ...clonar(a), trilha: trId, modulo: mId, paiId: null };
      raizes.splice(Math.max(0, Math.min(raizes.length, indice)), 0, movida); renumerar(raizes);
      const filhas = trId !== a.trilha ? descendentes(id).map((x) => ({ ...clonar(x), trilha: trId })) : [];
      const m = app.modulosDe(tr).find((x) => x.id === mId);
      const resumo = a.trilha === trId && app.moduloDe(a) === mId && !a.paiId ? `Reordenou a aula “${a.titulo}”` : `Moveu a aula “${a.titulo}” para “${tr.nome} › ${m.nome}”${filhas.length ? ` (com ${filhas.length} aula(s) de dentro)` : ""}`;
      await gravar({ trilhas, aulas: [...raizes, ...filhas] }, { resumo, detalhes: id });
    }
    if (tipo === "destaque") {
      const itens = [...estado.trilhas.filter((t) => t.destaque).map((t) => ({ chave: "trilha:" + t.id, ordem: t.destaque })), ...estado.temas.filter((t) => t.destaque).map((t) => ({ chave: "aula:" + t.id, ordem: t.destaque }))].sort((x, y) => x.ordem - y.ordem);
      const i = itens.findIndex((x) => x.chave === id); if (i < 0) return;
      const [x] = itens.splice(i, 1); itens.splice(Math.max(0, Math.min(itens.length, indice)), 0, x);
      await aplicarDestaques(itens.map((k) => k.chave), "Mudou a ordem dos destaques");
    }
  }
  async function aplicarDestaques(chaves, resumo) {
    const trilhas = clonar(estado.trilhas);
    const aulas = [];
    trilhas.forEach((t) => { const n = chaves.indexOf("trilha:" + t.id) + 1; t.destaque = n; });
    estado.temas.forEach((t) => { const n = chaves.indexOf("aula:" + t.id) + 1; if ((t.destaque || 0) !== n) aulas.push({ ...clonar(t), destaque: n }); });
    await gravar({ trilhas, aulas }, { resumo });
  }
  const chavesDestaque = () => [...estado.trilhas.filter((t) => t.destaque).map((t) => ({ k: "trilha:" + t.id, o: t.destaque })), ...estado.temas.filter((t) => t.destaque).map((t) => ({ k: "aula:" + t.id, o: t.destaque }))].sort((a, b) => a.o - b.o).map((x) => x.k);
  async function alternarDestaque(tipo, id) {
    const chave = `${tipo}:${id}`;
    const atuais = chavesDestaque();
    const em = atuais.includes(chave);
    await aplicarDestaques(em ? atuais.filter((k) => k !== chave) : [...atuais, chave], `${em ? "Tirou do" : "Pôs em"} destaque: ${nomeDe(tipo, id)}`);
  }
  async function alternarOculto(tipo, id) {
    if (tipo === "categoria") { const l = clonar(estado.categorias); const c = l.find((x) => x.id === id); c.oculto = !c.oculto; await gravar({ categorias: l }, { resumo: `${c.oculto ? "Ocultou" : "Mostrou"} a categoria “${c.nome}”` }); }
    if (tipo === "trilha") { const l = clonar(estado.trilhas); const t = l.find((x) => x.id === id); t.oculto = !t.oculto; await gravar({ trilhas: l }, { resumo: `${t.oculto ? "Ocultou" : "Mostrou"} a trilha “${t.nome}”` }); }
    if (tipo === "modulo") {
      const [trId, mId] = id.split("/"); const l = clonar(estado.trilhas); const t = l.find((x) => x.id === trId);
      garantirModulosReais(t); const m = t.modulos.find((x) => x.id === mId); m.oculto = !m.oculto;
      await gravar({ trilhas: l }, { resumo: `${m.oculto ? "Ocultou" : "Mostrou"} o módulo “${m.nome}” (${t.nome})` });
    }
    if (tipo === "aula") { const a = clonar(app.porId(id)); a.ocultaPropria = !a.ocultaPropria; await gravar({ aulas: [a] }, { resumo: `${a.ocultaPropria ? "Ocultou (rascunho)" : "Mostrou"} a aula “${a.titulo}”`, detalhes: id }); }
  }
  async function duplicar(tipo, id) {
    if (tipo === "aula") {
      const a = app.porId(id);
      const novoId = idUnico(`${id}-copia`, (x) => !!app.porId(x));
      const copia = { ...clonar(a), id: novoId, titulo: `${a.titulo} (cópia)`.slice(0, 120), ocultaPropria: true, destaque: 0, ordem: (a.ordem || 0) + 0.5, atualizadoEm: "", atualizadoPor: "" };
      await gravar({ aulas: [copia] }, { acao: "criar", resumo: `Duplicou a aula “${a.titulo}” como rascunho`, detalhes: novoId });
      location.hash = "#" + novoId;
    }
    if (tipo === "trilha") {
      const tr = app.trilhaPorId(id);
      const lista = clonar(estado.trilhas);
      const novoId = idUnico(`${id}-copia`, (x) => lista.some((t) => t.id === x));
      lista.push({ ...clonar(tr), id: novoId, nome: `${tr.nome} (cópia)`.slice(0, 100), oculto: true, destaque: 0, ordem: proximaOrdem(lista), atualizadoEm: agoraIso() });
      const daTrilha = estado.temas.filter((t) => t.trilha === id);
      const novos = new Map();
      daTrilha.forEach((t) => novos.set(t.id, idUnico(`${t.id}-c`, (x) => !!app.porId(x) || [...novos.values()].includes(x))));
      const aulas = daTrilha.map((t) => ({ ...clonar(t), id: novos.get(t.id), trilha: novoId, paiId: t.paiId && novos.has(t.paiId) ? novos.get(t.paiId) : null, destaque: 0, atualizadoEm: "", atualizadoPor: "" }));
      await gravar({ trilhas: lista, aulas }, { acao: "criar", resumo: `Duplicou a trilha “${tr.nome}” como rascunho (${aulas.length} aula(s))`, detalhes: novoId });
      location.hash = "#trilha/" + novoId;
    }
  }

  /* Lixeira: um documento por item removido; os itens removidos juntos têm o mesmo "grupo" */
  const idLixeira = (tipo, id) => `${tipo}-${String(id).replace(/[^a-z0-9-]/g, "_").slice(0, 80)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  function entradaLixeira(tipo, id, nome, grupo, dados, origem = {}) {
    return { op: "set", caminho: `conhecimento-lixeira/${idLixeira(tipo, id)}`, dados: { tipo, itemId: id, nome: String(nome).slice(0, 120), grupo, origem, dados, removidoEm: "__AGORA__", removidoPor: sessao.email || "" } };
  }
  const dadosAulaLixeira = (a) => ({ ...app.dadosTema(a, { semAssinatura: true }), id: a.id });
  async function remover(tipo, id) {
    const grupo = `${tipo}-${id}-${Date.now().toString(36)}`;
    if (tipo === "aula") {
      const a = app.porId(id);
      const junto = descendentes(id);
      if (!(await confirmar(`Mover a aula “${a.titulo}”${junto.length ? ` e as ${junto.length} aula(s) de dentro dela` : ""} para a lixeira? Dá para restaurar depois.`, { titulo: "Remover aula", botao: "Mover para a lixeira", perigo: true }))) return;
      const todas = [a, ...junto];
      const ops = todas.map((x) => entradaLixeira("aula", x.id, x.titulo, grupo, dadosAulaLixeira(x), { trilha: x.trilha, modulo: app.moduloDe(x), paiId: x.paiId }));
      await gravar({ apagarAulas: todas.map((x) => x.id), ops, opsDesfazer: ops.map((o) => ({ op: "delete", caminho: o.caminho })) }, { acao: "excluir", resumo: `Removeu a aula “${a.titulo}” (lixeira)`, detalhes: id });
      if (app.estado.rota && app.estado.rota.id === id) location.hash = "#trilha/" + a.trilha;
      return;
    }
    const conteudo = tipo === "categoria" ? app.trilhasDaCategoria(id) : tipo === "trilha" ? estado.temas.filter((t) => t.trilha === id) : null;
    let aulasModulo = [];
    if (tipo === "modulo") { const { trId, mId } = moduloPorChave(id); aulasModulo = estado.temas.filter((t) => t.trilha === trId && app.moduloDe(t) === mId); }
    const temConteudo = tipo === "modulo" ? aulasModulo.length : conteudo.length;
    let destino = null;
    if (temConteudo) {
      destino = await escolherDestinoRemocao(tipo, id, temConteudo);
      if (destino === null) return;
    } else if (!(await confirmar(`Remover ${NOMES_TIPO[tipo]} “${nomeDe(tipo, id)}”? Vai para a lixeira.`, { titulo: `Remover ${NOMES_TIPO[tipo]}`, botao: "Mover para a lixeira", perigo: true }))) return;
    const ops = [];
    let categorias = null, trilhas = clonar(estado.trilhas), aulas = [], apagarAulas = [];
    if (tipo === "categoria") {
      const c = app.categoriaPorId(id);
      categorias = clonar(estado.categorias).filter((x) => x.id !== id);
      ops.push(entradaLixeira("categoria", id, c.nome, grupo, clonar(c)));
      conteudo.forEach((tr) => {
        const t = trilhas.find((x) => x.id === tr.id);
        if (destino !== "tudo") t.categoria = destino;
        else {
          ops.push(entradaLixeira("trilha", tr.id, tr.nome, grupo, clonar(tr), { categoria: id }));
          estado.temas.filter((a) => a.trilha === tr.id).forEach((a) => { ops.push(entradaLixeira("aula", a.id, a.titulo, grupo, dadosAulaLixeira(a), { trilha: a.trilha, modulo: app.moduloDe(a), paiId: a.paiId })); apagarAulas.push(a.id); });
        }
      });
      if (destino === "tudo") trilhas = trilhas.filter((t) => !conteudo.some((c2) => c2.id === t.id));
    }
    if (tipo === "trilha") {
      const tr = app.trilhaPorId(id);
      trilhas = trilhas.filter((x) => x.id !== id);
      ops.push(entradaLixeira("trilha", id, tr.nome, grupo, clonar(tr), { categoria: tr.categoria }));
      conteudo.forEach((a) => {
        if (destino === "tudo") { ops.push(entradaLixeira("aula", a.id, a.titulo, grupo, dadosAulaLixeira(a), { trilha: id, modulo: app.moduloDe(a), paiId: a.paiId })); apagarAulas.push(a.id); }
        else { const { trId, mId } = moduloPorChave(destino); aulas.push({ ...clonar(a), trilha: trId, modulo: a.paiId && app.porId(a.paiId) ? a.modulo : mId }); }
      });
    }
    if (tipo === "modulo") {
      const { trId, mId, m } = moduloPorChave(id);
      const t = trilhas.find((x) => x.id === trId);
      garantirModulosReais(t);
      t.modulos = t.modulos.filter((x) => x.id !== mId);
      ops.push(entradaLixeira("modulo", id, m.nome, grupo, clonar(m), { trilha: trId }));
      aulasModulo.forEach((a) => {
        if (destino === "tudo") { ops.push(entradaLixeira("aula", a.id, a.titulo, grupo, dadosAulaLixeira(a), { trilha: trId, modulo: mId, paiId: a.paiId })); apagarAulas.push(a.id); }
        else { const d = moduloPorChave(destino); aulas.push({ ...clonar(a), trilha: d.trId, modulo: d.mId }); }
      });
      if (!t.modulos.length && !aulas.some((a) => a.trilha === trId)) t.modulos = [];
    }
    const m = { trilhas, aulas, apagarAulas, ops, opsDesfazer: ops.map((o) => ({ op: "delete", caminho: o.caminho })) };
    if (categorias) m.categorias = categorias;
    await gravar(m, { acao: "excluir", resumo: `Removeu ${NOMES_TIPO[tipo]} “${nomeDe(tipo, id)}” (lixeira)${destino && destino !== "tudo" ? "; o conteúdo foi movido" : ""}`, detalhes: id });
    if (tipo !== "categoria" && app.estado.rota && app.estado.rota.tipo === "trilha" && (tipo === "trilha" ? app.estado.rota.id === id : false)) location.hash = "#inicio";
  }
  /* Remover com conteúdo: mover o conteúdo para outro lugar ou mandar tudo junto para a lixeira (null = cancelou) */
  function escolherDestinoRemocao(tipo, id, n) {
    return new Promise((resolver) => {
      let opcoes = [];
      if (tipo === "categoria") opcoes = app.categoriasOrdenadas().filter((c) => c.id !== id).map((c) => [c.id, c.nome]);
      else {
        const [trAtual, mAtual] = tipo === "modulo" ? id.split("/") : [id, ""];
        app.categoriasOrdenadas().flatMap((c) => app.trilhasDaCategoria(c.id)).forEach((t) => {
          app.modulosDe(t).forEach((m) => { if (tipo === "trilha" ? t.id !== trAtual : !(t.id === trAtual && m.id === mAtual)) opcoes.push([`${t.id}/${m.id}`, `${t.nome} › ${m.nome}`]); });
        });
      }
      const rotulo = tipo === "categoria" ? `${n} trilha(s)` : `${n} aula(s)`;
      const d = criarDialogo({ titulo: `Remover ${NOMES_TIPO[tipo]} “${nomeDe(tipo, id)}”`, corpo: `<p class="apoio">Este ${NOMES_TIPO[tipo]} tem ${rotulo}. O que fazer com o conteúdo?</p>
        <label class="check"><input type="radio" name="destino" value="mover" checked> Mover para:</label>
        <label class="campo"><span class="sr-only">Destino</span><select name="lugar"${opcoes.length ? "" : " disabled"}>${opcoes.map(([v, r]) => `<option value="${escapar(v)}">${escapar(r)}</option>`).join("")}</select></label>
        <label class="check"><input type="radio" name="destino" value="tudo"${opcoes.length ? "" : " checked"}> Remover tudo (vai junto para a lixeira)</label>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn btn-perigo">Remover</button></div>` });
      let valor = null;
      d.querySelector("form").addEventListener("submit", (e) => {
        const f = e.target;
        valor = f.destino.value === "tudo" || !opcoes.length ? "tudo" : f.lugar.value;
      });
      d.addEventListener("close", () => resolver(valor));
      d.showModal();
    });
  }

  /* ------------------------------------------------------------
   *  Novos itens
   * ------------------------------------------------------------ */
  function pedirNome(titulo, rotulo, inicial = "") {
    return new Promise((resolver) => {
      const d = criarDialogo({ titulo, corpo: `<label class="campo"><span class="rotulo">${escapar(rotulo)}</span><input name="nome" maxlength="100" required value="${escapar(inicial)}"></label>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-mais")}Criar</button></div>` });
      let valor = null;
      d.querySelector("form").addEventListener("submit", (e) => { const v = e.target.nome.value.trim(); if (!v) { e.preventDefault(); return; } valor = v; });
      d.addEventListener("close", () => resolver(valor));
      d.showModal();
      d.querySelector("input").focus();
    });
  }
  async function novo(tipo, pai) {
    if (tipo === "categoria") {
      const nome = await pedirNome("Nova categoria", "Nome da categoria"); if (!nome) return;
      const lista = clonar(estado.categorias);
      const id = idUnico(nome, (x) => lista.some((c) => c.id === x) || x === "outras");
      lista.push(app.normalizarCategoria({ id, nome, icone: "i-livro", cor: "roxo", ordem: proximaOrdem(lista) }, lista.length));
      await gravar({ categorias: lista }, { acao: "criar", resumo: `Criou a categoria “${nome}”`, detalhes: id });
    }
    if (tipo === "trilha") {
      const nome = await pedirNome("Nova trilha", "Nome da trilha"); if (!nome) return;
      const lista = clonar(estado.trilhas);
      const id = idUnico(nome, (x) => lista.some((t) => t.id === x));
      const cat = app.categoriaPorId(pai);
      lista.push(app.normalizarTrilha({ id, nome, categoria: pai, icone: cat ? cat.icone : "i-livro", ordem: proximaOrdem(lista), modulos: [{ id: "modulo-1", nome: "Módulo 1", ordem: 1 }], atualizadoEm: agoraIso() }, lista.length));
      await gravar({ trilhas: lista }, { acao: "criar", resumo: `Criou a trilha “${nome}”`, detalhes: id });
      location.hash = "#trilha/" + id;
    }
    if (tipo === "modulo") {
      const nome = await pedirNome("Novo módulo", "Nome do módulo"); if (!nome) return;
      const lista = clonar(estado.trilhas); const t = lista.find((x) => x.id === pai); if (!t) return;
      garantirModulosReais(t);
      const id = idUnico(nome, (x) => t.modulos.some((m) => m.id === x));
      t.modulos.push({ id, nome: nome.slice(0, 80), descricao: "", ordem: proximaOrdem(t.modulos), oculto: false, icone: "", cor: "" });
      await gravar({ trilhas: lista }, { acao: "criar", resumo: `Criou o módulo “${nome}” em “${t.nome}”` });
    }
    if (tipo === "aula") { const { trId, mId } = moduloPorChave(pai); editarAula(null, { trilha: trId, modulo: mId }); }
  }

  /* ------------------------------------------------------------
   *  Renomear no lugar (Enter salva, Esc cancela)
   * ------------------------------------------------------------ */
  function iniciarRenomear(el) {
    if (!el || el.dataset.renomeando) return;
    const tipo = el.dataset.edRenomear, id = el.dataset.edId;
    const original = nomeDe(tipo, id);
    el.dataset.renomeando = "1";
    const input = document.createElement("input");
    input.className = "ed-renomear";
    input.value = original;
    input.maxLength = tipo === "aula" ? 120 : 100;
    input.setAttribute("aria-label", `Novo nome de ${NOMES_TIPO[tipo]} (Enter salva, Esc cancela)`);
    /* O campo fica ao lado (nunca dentro de link ou botão) e o original some enquanto edita */
    const host = el.closest("button") || el.closest("a") || el;
    host.hidden = true;
    host.after(input);
    input.focus();
    input.select();
    let feito = false;
    const terminar = async (salvar) => {
      if (feito) return;
      feito = true;
      delete el.dataset.renomeando;
      const nome = input.value.trim();
      input.remove();
      host.hidden = false;
      if (salvar && nome && nome !== original) { try { await renomear(tipo, id, nome); } catch (e) { /* aviso já mostrado */ } }
      else { app.redesenhar(); const volta = document.querySelector(`.ed-controles[data-ed-tipo="${tipo}"][data-ed-id="${CSS.escape(id)}"] [data-ed-acao="renomear"]`); if (volta) volta.focus(); }
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); terminar(true); }
      if (e.key === "Escape") { e.preventDefault(); terminar(false); }
    });
    input.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    input.addEventListener("blur", () => terminar(true));
  }

  /* ------------------------------------------------------------
   *  Menu ⋯
   * ------------------------------------------------------------ */
  let menuAberto = null;
  function fecharMenu(focarBotao = false) {
    if (!menuAberto) return;
    const { el, botao } = menuAberto;
    el.remove();
    botao.setAttribute("aria-expanded", "false");
    if (focarBotao) botao.focus();
    menuAberto = null;
  }
  function itensMenu(tipo, id) {
    const it = [];
    const oculto = tipo === "categoria" ? (app.categoriaPorId(id) || {}).oculto : tipo === "trilha" ? (app.trilhaPorId(id) || {}).oculto
      : tipo === "modulo" ? (moduloPorChave(id).m || {}).oculto : (app.porId(id) || {}).ocultaPropria;
    if (tipo === "aula") it.push(["editar", "i-lapis", "Editar conteúdo"]);
    it.push(["renomear", "i-lapis", "Renomear"], ["aparencia", "i-imagem", "Aparência…"], ["mover", "i-ordenar", "Mover para…"]);
    if (tipo === "aula" || tipo === "trilha") it.push(["duplicar", "i-duplicar", "Duplicar como rascunho"]);
    it.push(["ocultar", oculto ? "i-olho" : "i-olho-cortado", oculto ? "Mostrar (publicar)" : "Ocultar (rascunho)"]);
    if (tipo === "aula" || tipo === "trilha") {
      const em = tipo === "aula" ? (app.porId(id) || {}).destaque : (app.trilhaPorId(id) || {}).destaque;
      it.push(["destaque", "i-estrela", em ? "Tirar do destaque" : "Pôr em destaque na página inicial"]);
    }
    if (tipo === "aula") it.push(["historico", "i-relogio", "Histórico de versões"]);
    it.push(["remover", "i-lixeira", "Remover (lixeira)"]);
    return it;
  }
  function abrirMenu(botaoMenu) {
    fecharMenu();
    const box = botaoMenu.closest(".ed-controles");
    const tipo = box.dataset.edTipo, id = box.dataset.edId;
    const el = document.createElement("div");
    el.className = "ed-menu";
    el.setAttribute("role", "menu");
    el.setAttribute("aria-label", `Ações: ${nomeDe(tipo, id)}`);
    el.innerHTML = itensMenu(tipo, id).map(([acao, icone, rotulo]) => `<button type="button" role="menuitem" data-ed-acao="${acao}" tabindex="-1"${acao === "remover" ? ' class="perigo"' : ""}>${svg(icone)}${escapar(rotulo)}</button>`).join("");
    el.dataset.edTipo = tipo;
    el.dataset.edId = id;
    document.body.appendChild(el);
    const r = botaoMenu.getBoundingClientRect();
    el.style.top = `${Math.min(window.innerHeight - el.offsetHeight - 8, r.bottom + 4) + window.scrollY}px`;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.right - el.offsetWidth)) + window.scrollX}px`;
    botaoMenu.setAttribute("aria-expanded", "true");
    menuAberto = { el, botao: botaoMenu };
    const itens = $$("[role=menuitem]", el);
    itens[0].focus();
    el.addEventListener("keydown", (e) => {
      const i = itens.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length].focus(); }
      if (e.key === "Home") { e.preventDefault(); itens[0].focus(); }
      if (e.key === "End") { e.preventDefault(); itens[itens.length - 1].focus(); }
      if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); fecharMenu(true); }
    });
  }
  async function executar(acao, tipo, id) {
    try {
      if (acao === "renomear") {
        const alvo = document.querySelector(`[data-ed-renomear="${tipo}"][data-ed-id="${CSS.escape(id)}"]`);
        if (alvo) iniciarRenomear(alvo);
        else { const nome = await pedirNome(`Renomear ${NOMES_TIPO[tipo]}`, "Novo nome", nomeDe(tipo, id)); if (nome) await renomear(tipo, id, nome); }
      }
      if (acao === "tirar-destaque") { const [t, i] = id.split(/:(.+)/); await alternarDestaque(t, i); }
      if (acao === "editar") editarAula(app.porId(id));
      if (acao === "historico") abrirHistorico(app.porId(id));
      if (acao === "aparencia") editarAparencia(tipo, id);
      if (acao === "mover") moverPara(tipo, id);
      if (acao === "duplicar") await duplicar(tipo, id);
      if (acao === "ocultar") await alternarOculto(tipo, id);
      if (acao === "destaque") await alternarDestaque(tipo, id);
      if (acao === "remover") await remover(tipo, id);
    } catch (e) { console.error(e); }
  }

  /* "Mover para…": alternativa ao arrastar (teclado e leitores de tela) */
  function moverPara(tipo, id) {
    let destinos = [], atual = "", posicoes;
    if (tipo === "categoria") { mostrarPosicao(tipo, id, "", app.categoriasOrdenadas().map((c) => [c.id, c.nome])); return; }
    if (tipo === "trilha") { destinos = app.categoriasOrdenadas().map((c) => [c.id, c.nome]); atual = (app.trilhaPorId(id) || {}).categoria; }
    if (tipo === "modulo") { destinos = app.categoriasOrdenadas().flatMap((c) => app.trilhasDaCategoria(c.id)).map((t) => [t.id, t.nome]); atual = id.split("/")[0]; }
    if (tipo === "aula") {
      app.categoriasOrdenadas().flatMap((c) => app.trilhasDaCategoria(c.id)).forEach((t) => app.modulosDe(t).forEach((m) => destinos.push([`${t.id}/${m.id}`, `${t.nome} › ${m.nome}`])));
      const a = app.porId(id); atual = `${a.trilha}/${app.moduloDe(a)}`;
    }
    posicoes = (destino) => {
      if (tipo === "trilha") return app.trilhasDaCategoria(destino).filter((t) => t.id !== id).map((t) => t.nome);
      if (tipo === "modulo") return app.modulosDe(app.trilhaPorId(destino)).filter((m) => `${destino}/${m.id}` !== id).map((m) => m.nome);
      const { trId, mId } = moduloPorChave(destino);
      return app.raizesDoModulo(trId, mId).filter((t) => t.id !== id).map((t) => t.titulo);
    };
    const d = criarDialogo({ titulo: `Mover ${NOMES_TIPO[tipo]}: ${nomeDe(tipo, id)}`, corpo: `
      <label class="campo"><span class="rotulo">Para</span><select name="destino">${destinos.map(([v, r]) => `<option value="${escapar(v)}"${v === atual ? " selected" : ""}>${escapar(r)}</option>`).join("")}</select></label>
      <label class="campo"><span class="rotulo">Posição</span><select name="posicao"></select></label>
      ${tipo === "aula" ? '<p class="apoio">A aula vai junto com as aulas de dentro dela.</p>' : tipo === "modulo" ? '<p class="apoio">O módulo vai junto com as aulas dele.</p>' : ""}
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-ordenar")}Mover</button></div>` });
    const f = d.querySelector("form");
    const preencher = () => { const ps = posicoes(f.destino.value); f.posicao.innerHTML = ps.map((n, i) => `<option value="${i}">Antes de “${escapar(n)}”</option>`).join("") + `<option value="${ps.length}" selected>No fim</option>`; };
    f.destino.addEventListener("change", preencher);
    preencher();
    f.addEventListener("submit", () => { mover(tipo, id, f.destino.value, Number(f.posicao.value)).catch(() => {}); });
    d.showModal();
  }
  function mostrarPosicao(tipo, id, pai, lista) {
    const outros = lista.filter(([v]) => v !== id);
    const d = criarDialogo({ titulo: `Mover ${NOMES_TIPO[tipo]}: ${nomeDe(tipo, id)}`, corpo: `<label class="campo"><span class="rotulo">Posição</span><select name="posicao">${outros.map(([, n], i) => `<option value="${i}">Antes de “${escapar(n)}”</option>`).join("")}<option value="${outros.length}">No fim</option></select></label>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-ordenar")}Mover</button></div>` });
    d.querySelector("form").addEventListener("submit", (e) => { mover(tipo, id, pai, Number(e.target.posicao.value)).catch(() => {}); });
    d.showModal();
  }

  /* ------------------------------------------------------------
   *  Arrastar e soltar (e Alt+↑/↓ na alça)
   * ------------------------------------------------------------ */
  let arrastando = null;
  const limparAlvos = () => $$(".ed-alvo-antes, .ed-alvo-depois, .ed-alvo-dentro").forEach((x) => x.classList.remove("ed-alvo-antes", "ed-alvo-depois", "ed-alvo-dentro"));
  /* Destino do soltar: item do mesmo tipo (antes/depois dele) ou a zona (no fim) */
  function alvoDe(e) {
    if (!arrastando) return null;
    const itemAlvo = e.target.closest("[data-ed-item]");
    if (itemAlvo && itemAlvo.dataset.edItem === arrastando.tipo && itemAlvo.dataset.edId !== arrastando.id) {
      const z = itemAlvo.parentElement.closest("[data-ed-zona]");
      if (z && z.dataset.edZona === arrastando.tipo) {
        const r = itemAlvo.getBoundingClientRect();
        const horizontal = getComputedStyle(itemAlvo.parentElement).display === "grid" && r.width < z.getBoundingClientRect().width * 0.9;
        const depois = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        return { el: itemAlvo, zona: z, depois };
      }
    }
    const z = e.target.closest("[data-ed-zona]");
    if (z && z.dataset.edZona === arrastando.tipo) return { el: null, zona: z };
    return null;
  }
  function indiceNaZona(zonaEl, itemEl, depois) {
    const irmaos = $$(":scope > [data-ed-item], :scope > li > [data-ed-item]", zonaEl).filter((x) => x.dataset.edItem === arrastando.tipo && x.dataset.edId !== arrastando.id);
    let lista = irmaos;
    if (arrastando.tipo === "aula") lista = irmaos.filter((x) => { const a = app.porId(x.dataset.edId); return a && (!a.paiId || !app.porId(a.paiId)); });
    if (!itemEl) return lista.length;
    let alvo = itemEl;
    if (arrastando.tipo === "aula") { let a = app.porId(itemEl.dataset.edId); while (a && a.paiId && app.porId(a.paiId)) a = app.porId(a.paiId); alvo = lista.find((x) => a && x.dataset.edId === a.id) || itemEl; }
    const i = lista.indexOf(alvo);
    return i < 0 ? lista.length : i + (depois ? 1 : 0);
  }
  document.addEventListener("dragstart", (e) => {
    const alca = e.target.closest && e.target.closest("[data-ed-arrastar]");
    if (!alca || !ativo()) return;
    const box = alca.closest(".ed-controles");
    arrastando = { tipo: box.dataset.edTipo, id: box.dataset.edId };
    const itemEl = alca.closest("[data-ed-item]");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${arrastando.tipo}:${arrastando.id}`);
    if (itemEl) { e.dataTransfer.setDragImage(itemEl, 20, 20); itemEl.classList.add("ed-arrastando"); }
    document.body.classList.add("ed-arrastando-" + arrastando.tipo);
  });
  document.addEventListener("dragover", (e) => {
    const alvo = alvoDe(e);
    if (!alvo) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    limparAlvos();
    if (alvo.el) alvo.el.classList.add(alvo.depois ? "ed-alvo-depois" : "ed-alvo-antes");
    else alvo.zona.classList.add("ed-alvo-dentro");
  });
  document.addEventListener("drop", (e) => {
    const alvo = alvoDe(e);
    if (!alvo) return;
    e.preventDefault();
    const { tipo, id } = arrastando;
    const indice = indiceNaZona(alvo.zona, alvo.el, alvo.depois);
    const pai = alvo.zona.dataset.edPai;
    limparAlvos();
    mover(tipo, id, tipo === "modulo" ? id.split("/")[0] : pai, indice).catch(() => {});
  });
  document.addEventListener("dragend", () => {
    limparAlvos();
    $$(".ed-arrastando").forEach((x) => x.classList.remove("ed-arrastando"));
    document.body.className = document.body.className.replace(/\bed-arrastando-\S+/g, "").trim();
    arrastando = null;
  });
  /* Teclado: Alt+↑/↓ na alça move uma posição dentro do mesmo contêiner */
  document.addEventListener("keydown", (e) => {
    const alca = e.target.closest && e.target.closest("[data-ed-arrastar]");
    if (!alca || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const box = alca.closest(".ed-controles");
    const tipo = box.dataset.edTipo, id = box.dataset.edId;
    const itemEl = alca.closest("[data-ed-item]");
    const z = itemEl && itemEl.parentElement.closest("[data-ed-zona]");
    if (!z) return;
    arrastando = { tipo, id };
    const irmaos = $$(":scope > [data-ed-item], :scope > li > [data-ed-item]", z).filter((x) => x.dataset.edItem === tipo);
    let lista = irmaos;
    if (tipo === "aula") lista = irmaos.filter((x) => { const a = app.porId(x.dataset.edId); return a && (!a.paiId || !app.porId(a.paiId)); });
    const atual = lista.findIndex((x) => x.dataset.edId === id);
    arrastando = null;
    if (atual < 0) { mostrarAviso("Aulas de dentro de outra aula se movem junto com ela."); return; }
    const novo = atual + (e.key === "ArrowUp" ? -1 : 1);
    if (novo < 0 || novo >= lista.length) return;
    focoDepois = { tipo, id };
    mover(tipo, id, tipo === "modulo" ? id.split("/")[0] : z.dataset.edPai, novo).catch(() => {});
  });
  let focoDepois = null;

  /* ------------------------------------------------------------
   *  Cliques do modo edição
   * ------------------------------------------------------------ */
  document.addEventListener("click", (e) => {
    if (menuAberto && !e.target.closest(".ed-menu") && !e.target.closest("[data-ed-menu]")) fecharMenu();
    const aulaB = e.target.closest("[data-ed-aula]");
    if (aulaB) { const a = app.porId(aulaB.dataset.edId); if (aulaB.dataset.edAula === "editar") editarAula(a); else abrirHistorico(a); return; }
    if (e.target.closest("[data-ed-global-pagina]")) { editarGlossario(); return; }
    if (!ativo()) return;
    const menuB = e.target.closest("[data-ed-menu]");
    if (menuB) { e.preventDefault(); e.stopPropagation(); if (menuAberto && menuAberto.botao === menuB) fecharMenu(); else abrirMenu(menuB); return; }
    const acaoMenu = e.target.closest(".ed-menu [data-ed-acao]");
    if (acaoMenu) { const m = acaoMenu.closest(".ed-menu"); const { edTipo, edId } = m.dataset; fecharMenu(); executar(acaoMenu.dataset.edAcao, edTipo, edId); return; }
    const acao = e.target.closest(".ed-controles [data-ed-acao]");
    if (acao) { e.preventDefault(); e.stopPropagation(); const box = acao.closest(".ed-controles"); executar(acao.dataset.edAcao, box.dataset.edTipo, box.dataset.edId); return; }
    const novoB = e.target.closest("[data-ed-novo]");
    if (novoB) { novo(novoB.dataset.edNovo, novoB.dataset.edPai); return; }
    const ren = e.target.closest("[data-ed-renomear]");
    if (ren && ren.tagName !== "A" && !e.target.closest(".ed-renomear")) { e.preventDefault(); e.stopPropagation(); iniciarRenomear(ren); }
  }, true);
  /* Enter no título renomeável (teclado) */
  document.addEventListener("keydown", (e) => {
    if (!ativo() || e.key !== "Enter") return;
    const ren = e.target.closest && e.target.closest("[data-ed-renomear]");
    if (ren && ren.tagName !== "A" && !e.target.closest(".ed-renomear")) { e.preventDefault(); iniciarRenomear(ren); }
  });

  /* ------------------------------------------------------------
   *  Aparência (ícone, cor, capa, descrição, nível, tempo)
   * ------------------------------------------------------------ */
  function editarAparencia(tipo, id) {
    const obj = tipo === "categoria" ? app.categoriaPorId(id) : tipo === "trilha" ? app.trilhaPorId(id) : tipo === "modulo" ? moduloPorChave(id).m : app.porId(id);
    if (!obj) return;
    const comCapa = tipo !== "modulo", comNivel = tipo === "trilha" || tipo === "aula";
    const chaveCapa = `${tipo}-${tipo === "modulo" ? id.replace("/", "-") : id}`;
    let imagemNova = undefined;
    const capaAtual = obj.capa ? (obj.capa.tipo === "imagem" ? "imagem" : obj.capa.estilo) : "";
    const descricao = tipo === "aula" ? obj.resumo : obj.descricao;
    const trilhaAulas = tipo === "trilha" ? app.aulasDaTrilha(id) : [];
    const d = criarDialogo({ titulo: `Aparência: ${nomeDe(tipo, id)}`, largo: true, corpo: `
      <label class="campo"><span class="rotulo">${tipo === "aula" ? "Resumo (uma linha)" : "Descrição"}</span><textarea name="descricao" rows="2" maxlength="300">${escapar(descricao || "")}</textarea></label>
      <fieldset class="ed-escolha"><legend>Ícone</legend><div class="ed-icones">${(tipo === "aula" || tipo === "modulo" ? [""] : []).concat(app.ICONES).map((ic) => `<label title="${ic ? ic.slice(2) : "Padrão"}"><input type="radio" name="icone" value="${ic}"${(obj.icone || "") === ic ? " checked" : ""}><span>${ic ? svg(ic) : "—"}</span><span class="sr-only">${ic ? ic.slice(2) : "Padrão"}</span></label>`).join("")}</div></fieldset>
      <fieldset class="ed-escolha"><legend>Cor de destaque</legend><div class="ed-cores">${(tipo === "categoria" ? [] : [""]).concat(Object.keys(app.CORES)).map((c) => `<label><input type="radio" name="cor" value="${c}"${(obj.cor || "") === c ? " checked" : ""}><span class="ed-cor"${c ? ` style="--c: var(--c-${c}); --f: var(--f-${c})"` : ""}></span>${c ? app.CORES[c] : "Da categoria"}</label>`).join("")}</div></fieldset>
      ${comCapa ? `<fieldset class="ed-escolha"><legend>Capa</legend><div class="ed-capas">
        <label><input type="radio" name="capa" value=""${!capaAtual ? " checked" : ""}> Padrão</label>
        ${Object.entries(ESTILOS_CAPA).map(([v, n]) => `<label><input type="radio" name="capa" value="${v}"${capaAtual === v ? " checked" : ""}> Gradiente: ${n}</label>`).join("")}
        <label><input type="radio" name="capa" value="imagem"${capaAtual === "imagem" ? " checked" : ""}> Imagem</label></div>
        <div class="ed-capa-imagem"><label class="btn btn-secundario btn-mini">${svg("i-upload")}Enviar imagem<input type="file" accept="image/jpeg,image/png,image/webp" data-capa-arquivo hidden></label>
          <span class="apoio" data-capa-info>${estado.capas.get(chaveCapa) ? "Há uma imagem enviada." : "JPG, PNG ou WebP; é comprimida no navegador."}</span>
          <img class="ed-capa-previa" alt="" data-capa-previa${estado.capas.get(chaveCapa) ? ` src="${escapar(estado.capas.get(chaveCapa))}"` : " hidden"}></div></fieldset>` : ""}
      ${comNivel ? `<div class="campos-linha"><label class="campo"><span class="rotulo">Nível</span><select name="nivel">${tipo === "trilha" ? '<option value="">—</option>' : ""}${app.NIVEIS.map((n) => `<option${obj.nivel === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Tempo estimado (min; 0 = calcular pela leitura)</span><input name="tempo" type="number" min="0" max="${tipo === "trilha" ? 6000 : 600}" value="${obj.tempo || 0}"></label></div>` : ""}
      ${tipo === "trilha" ? `<label class="campo"><span class="rotulo">Fontes (aparece no topo da trilha)</span><input name="fontes" maxlength="400" value="${escapar(obj.fontes || "")}"></label>
        <div class="campos-linha"><label class="campo"><span class="rotulo">Faixa de aviso em toda a trilha (vazio = sem faixa)</span><input name="avisoTexto" maxlength="200" value="${escapar((obj.aviso && obj.aviso.texto) || "")}"></label>
        <label class="campo"><span class="rotulo">Link da faixa</span><select name="avisoAula"><option value="">— sem link</option>${trilhaAulas.map((a) => `<option value="${escapar(a.id)}"${obj.aviso && obj.aviso.aula === a.id ? " selected" : ""}>${escapar(a.titulo)}</option>`).join("")}</select></label></div>` : ""}
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}Salvar aparência</button></div>` });
    const f = d.querySelector("form");
    const arquivo = d.querySelector("[data-capa-arquivo]");
    if (arquivo) arquivo.addEventListener("change", async () => {
      const file = arquivo.files[0];
      if (!file) return;
      try {
        const url = await comprimirImagem(file, 1400, 300000);
        imagemNova = url;
        const prev = d.querySelector("[data-capa-previa]");
        prev.src = url; prev.hidden = false;
        d.querySelector("[data-capa-info]").textContent = `Imagem pronta (${Math.round(url.length / 1024)} KB).`;
        f.capa.value = "imagem";
      } catch (err) { d.querySelector(".form-erro").textContent = err.message || "Não foi possível usar esta imagem."; }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const capaValor = comCapa ? f.capa.value : "";
      if (capaValor === "imagem" && !imagemNova && !estado.capas.get(chaveCapa)) { d.querySelector(".form-erro").textContent = "Envie uma imagem ou escolha outra capa."; return; }
      const novo = clonar(obj);
      if (tipo === "aula") novo.resumo = f.descricao.value.trim().slice(0, 300); else novo.descricao = f.descricao.value.trim().slice(0, 300);
      novo.icone = f.icone.value || (tipo === "categoria" || tipo === "trilha" ? "i-livro" : "");
      novo.cor = f.cor.value || (tipo === "categoria" ? "roxo" : "");
      if (comCapa) novo.capa = capaValor === "imagem" ? { tipo: "imagem" } : capaValor ? { tipo: "gradiente", estilo: capaValor } : null;
      if (comNivel) { novo.nivel = f.nivel.value; novo.tempo = Math.max(0, Math.round(Number(f.tempo.value) || 0)); }
      if (tipo === "trilha") { novo.fontes = f.fontes.value.trim(); const texto = f.avisoTexto.value.trim(); novo.aviso = texto ? { texto, aula: f.avisoAula.value } : null; novo.atualizadoEm = agoraIso(); }
      const ops = [], opsDesfazer = [];
      if (imagemNova && capaValor === "imagem") {
        ops.push({ op: "set", caminho: `conhecimento-capas/${chaveCapa}`, dados: { src: imagemNova, ...app.assinatura() } });
        const antiga = estado.capas.get(chaveCapa);
        opsDesfazer.push(antiga ? { op: "set", caminho: `conhecimento-capas/${chaveCapa}`, dados: { src: antiga, ...app.assinatura() } } : { op: "delete", caminho: `conhecimento-capas/${chaveCapa}` });
      }
      const m = { ops, opsDesfazer };
      if (tipo === "categoria") m.categorias = clonar(estado.categorias).map((c) => (c.id === id ? novo : c));
      if (tipo === "trilha") m.trilhas = clonar(estado.trilhas).map((t) => (t.id === id ? novo : t));
      if (tipo === "modulo") { const [trId] = id.split("/"); m.trilhas = clonar(estado.trilhas); const t = m.trilhas.find((x) => x.id === trId); garantirModulosReais(t); t.modulos = t.modulos.map((x) => (x.id === novo.id ? novo : x)); }
      if (tipo === "aula") m.aulas = [novo];
      d.close();
      try { await gravar(m, { resumo: `Mudou a aparência de ${NOMES_TIPO[tipo]} “${nomeDe(tipo, id)}”`, detalhes: id }); } catch (err) { /* aviso já mostrado */ }
    });
    d.showModal();
  }

  /* Compressão de imagem no navegador (mesma ideia do caderno: WebP/JPEG, reduzindo até caber no limite) */
  function comprimirImagem(arquivo, ladoMax, limite) {
    return new Promise((resolver, rejeitar) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(arquivo.type)) { rejeitar(new Error(`“${arquivo.name}” não é JPG, PNG ou WebP.`)); return; }
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const teste = document.createElement("canvas");
        teste.width = teste.height = 1;
        const formato = teste.toDataURL("image/webp").startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
        let escala = Math.min(1, ladoMax / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        for (let tentativa = 0; tentativa < 6; tentativa++) {
          canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          for (let q = 0.82; q >= 0.45; q -= 0.07) { const u = canvas.toDataURL(formato, q); if (u.length < limite) { resolver(u); return; } }
          escala *= 0.8;
        }
        rejeitar(new Error("A imagem é grande demais mesmo depois de comprimida."));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rejeitar(new Error(`“${arquivo.name}” não é uma imagem válida.`)); };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------
   *  Editor de aula: seções flexíveis, barra de formatação, prévia ao vivo, rascunho
   * ------------------------------------------------------------ */
  const PRESETS = [
    { id: "frase", titulo: "Em uma frase", icone: "i-lampada", rotulo: "Em uma frase (destaque)" },
    { id: "", titulo: "Nova seção", icone: "i-livro", rotulo: "Texto livre" },
    { id: "duvidas", titulo: "Erros e dúvidas comuns", icone: "i-ajuda", rotulo: "Perguntas (### pergunta)" },
    { id: "termos", titulo: "Termos relacionados", icone: "i-tag", rotulo: "Termos relacionados (separados por vírgula)" }
  ];
  function editarAula(t, novoEm = null) {
    if (!app.podeEditar()) return;
    const novo = !t;
    const base = t ? clonar(t) : app.normalizarTema({ id: "nova", trilha: novoEm.trilha, modulo: novoEm.modulo, titulo: "", ocultaPropria: true, ordem: 999, blocos: [{ id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "" }, { id: "conteudo", titulo: "Como funciona", icone: "i-engrenagem", markdown: "" }] });
    let blocos = app.blocosDe(base).map((b) => ({ ...b }));
    const chave = CHAVE_RASCUNHO(novo ? `nova-${base.trilha}-${base.modulo}` : base.id);
    const rascunho = lerLocal(chave, null);
    const temRascunho = rascunho && rascunho.dados && (!base.atualizadoEm || rascunho.em > Date.parse(base.atualizadoEm));
    const trilhas = app.categoriasOrdenadas().flatMap((c) => app.trilhasDaCategoria(c.id));
    const d = criarDialogo({ titulo: novo ? "Nova aula" : `Editar: ${base.titulo}`, largo: true, corpo: `
      ${temRascunho ? `<div class="faixa-rascunho">${svg("i-info")}<span>Há um rascunho deste navegador de ${escapar(formatarData(new Date(rascunho.em).toISOString(), true))} que ainda não foi publicado.</span>
        <button type="button" class="btn btn-mini" data-rascunho="recuperar">Recuperar rascunho</button><button type="button" class="btn btn-secundario btn-mini" data-rascunho="descartar">Descartar</button></div>` : ""}
      <div class="campos-linha">
        <label class="campo"><span class="rotulo">Título</span><input name="titulo" required maxlength="120" value="${escapar(base.titulo)}"></label>
        <label class="campo"><span class="rotulo">Nível</span><select name="nivel">${app.NIVEIS.map((n) => `<option${base.nivel === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Trilha</span><select name="trilha">${trilhas.map((x) => `<option value="${escapar(x.id)}"${x.id === base.trilha ? " selected" : ""}>${escapar(x.nome)}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Módulo</span><select name="modulo"></select></label>
        <label class="campo"><span class="rotulo">Dentro de (aula mãe)</span><select name="paiId"></select></label>
        <label class="campo"><span class="rotulo">Revisar em</span><input name="revisarEm" type="date" value="${escapar(base.revisarEm)}"></label>
      </div>
      <label class="campo"><span class="rotulo">Resumo (uma linha)</span><input name="resumo" maxlength="300" value="${escapar(base.resumo)}"></label>
      <label class="campo"><span class="rotulo">Palavras-chave (para a busca, separadas por vírgula)</span><input name="palavrasChave" value="${escapar(base.palavrasChave.join(", "))}"></label>
      <label class="check"><input type="checkbox" name="rascunho"${base.ocultaPropria ? " checked" : ""}> Rascunho (oculta: só as administradoras veem)</label>
      ${barraFormatacao()}
      <div class="ed-blocos" data-ed-blocos></div>
      <div class="ed-novo-bloco"><span class="rotulo">Adicionar seção:</span>${PRESETS.map((p, i) => `<button type="button" class="btn btn-secundario btn-mini" data-novo-bloco="${i}">${svg("i-mais")}${escapar(p.rotulo)}</button>`).join("")}</div>
      <p class="apoio">Markdown igual ao dos cadernos, mais <code>:::selo validado</code> (ou <code>a-confirmar</code>, <code>nao-repassar</code>, <code>interno</code>) … <code>:::</code> e <code>:::diagrama &lt;id&gt;</code>. O rascunho fica salvo neste navegador enquanto você escreve.</p>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes ed-rodape-editor">${novo ? "" : `<button type="button" class="btn btn-secundario" data-historico style="margin-right:auto">${svg("i-relogio")}Histórico</button>`}<span class="apoio" data-status-rascunho></span>
        <button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}${novo ? "Criar aula" : "Publicar"}</button></div>` });
    d.classList.add("ed-dialogo-aula");
    /* Clique fora não fecha o editor (só Cancelar, Fechar ou Esc) */
    d.addEventListener("click", (e) => { if (e.target === d) e.stopImmediatePropagation(); }, true);
    const f = d.querySelector("form");
    const lista = $("[data-ed-blocos]", d);
    let ultimoCampo = null;
    const opcoesModulo = () => { const tr = app.trilhaPorId(f.trilha.value); f.modulo.innerHTML = app.modulosDe(tr).map((m) => `<option value="${escapar(m.id)}"${m.id === (f.trilha.value === base.trilha ? app.moduloDe(base) : "") ? " selected" : ""}>${escapar(m.nome)}</option>`).join(""); };
    const opcoesPai = () => { f.paiId.innerHTML = `<option value="">— nenhuma (aula principal)</option>` + estado.temas.filter((x) => x.trilha === f.trilha.value && !x.paiId && x.id !== base.id).map((x) => `<option value="${escapar(x.id)}"${x.id === base.paiId ? " selected" : ""}>${escapar(x.titulo)}</option>`).join(""); };
    opcoesModulo(); opcoesPai();
    f.trilha.addEventListener("change", () => { opcoesModulo(); opcoesPai(); });
    function desenharBlocos(focarIndice = -1) {
      lista.innerHTML = blocos.map((b, i) => `<section class="ed-bloco" data-bloco="${i}">
        <div class="ed-bloco-topo"><button type="button" class="ed-alca" draggable="true" data-bloco-alca aria-label="Mover a seção ${escapar(b.titulo)} (arraste ou Alt+↑/↓)" title="Arraste para reordenar">⋮⋮</button>
          <label class="campo ed-bloco-titulo"><span class="sr-only">Título da seção ${i + 1}</span><input data-campo="titulo" value="${escapar(b.titulo)}" maxlength="120"></label>
          <label class="campo"><span class="sr-only">Ícone da seção</span><select data-campo="icone">${app.ICONES.map((ic) => `<option value="${ic}"${ic === b.icone ? " selected" : ""}>${ic.slice(2)}</option>`).join("")}</select></label>
          <button type="button" class="btn-icone" data-bloco-mover="-1" aria-label="Subir a seção"${i === 0 ? " disabled" : ""}>${svg("i-seta-cima")}</button>
          <button type="button" class="btn-icone" data-bloco-mover="1" aria-label="Descer a seção"${i === blocos.length - 1 ? " disabled" : ""}>${svg("i-seta-baixo")}</button>
          <button type="button" class="btn-icone" data-bloco-remover aria-label="Remover a seção ${escapar(b.titulo)}">${svg("i-lixeira")}</button>
          ${["frase", "duvidas", "termos"].includes(b.id) ? `<span class="selo" title="Formato especial da seção">${b.id === "frase" ? "destaque" : b.id === "duvidas" ? "perguntas" : "termos"}</span>` : ""}</div>
        <div class="ed-bloco-corpo"><label class="campo"><span class="sr-only">Conteúdo da seção ${escapar(b.titulo)} (Markdown)</span><textarea data-campo="markdown" rows="${Math.min(18, Math.max(4, b.markdown.split("\n").length + 1))}" spellcheck="true">${escapar(b.markdown)}</textarea></label>
          <div class="ed-previa secao" aria-label="Prévia" data-previa>${app.corpoDoBloco(b)}</div></div></section>`).join("") || '<p class="apoio">Nenhuma seção. Adicione uma abaixo.</p>';
      if (focarIndice >= 0) { const ta = $$(`[data-bloco="${focarIndice}"] [data-campo="titulo"]`, lista)[0]; if (ta) ta.focus(); }
    }
    desenharBlocos();
    /* Rascunho no navegador */
    let tempo = 0;
    const lerForm = () => ({ titulo: f.titulo.value, nivel: f.nivel.value, trilha: f.trilha.value, modulo: f.modulo.value, paiId: f.paiId.value, revisarEm: f.revisarEm.value, resumo: f.resumo.value, palavrasChave: f.palavrasChave.value, rascunho: f.rascunho.checked, blocos });
    const guardar = () => { clearTimeout(tempo); tempo = setTimeout(() => { gravarLocal(chave, { em: Date.now(), dados: lerForm() }); const s = $("[data-status-rascunho]", d); if (s) s.textContent = "Rascunho salvo neste navegador."; }, 800); };
    let previaTempo = 0;
    lista.addEventListener("input", (e) => {
      const sec = e.target.closest("[data-bloco]"); if (!sec) return;
      const b = blocos[Number(sec.dataset.bloco)];
      b[e.target.dataset.campo] = e.target.value;
      if (e.target.dataset.campo === "markdown") { clearTimeout(previaTempo); previaTempo = setTimeout(() => { $("[data-previa]", sec).innerHTML = app.corpoDoBloco(b); }, 250); }
      guardar();
    });
    lista.addEventListener("change", (e) => { const sec = e.target.closest("[data-bloco]"); if (sec && e.target.dataset.campo === "icone") { blocos[Number(sec.dataset.bloco)].icone = e.target.value; guardar(); } });
    f.addEventListener("input", (e) => { if (!e.target.closest("[data-ed-blocos]")) guardar(); });
    lista.addEventListener("focusin", (e) => { if (e.target.matches("textarea")) ultimoCampo = e.target; });
    d.addEventListener("click", (e) => {
      const nb = e.target.closest("[data-novo-bloco]");
      if (nb) {
        const p = PRESETS[Number(nb.dataset.novoBloco)];
        const usados = new Set(blocos.map((b) => b.id));
        let id = p.id && !usados.has(p.id) ? p.id : `secao-${blocos.length + 1}`;
        let n = 2; while (usados.has(id)) id = `secao-${blocos.length + n++}`;
        blocos.push({ id, titulo: p.titulo, icone: p.icone, markdown: "" });
        desenharBlocos(blocos.length - 1); guardar(); return;
      }
      const mv = e.target.closest("[data-bloco-mover]");
      if (mv) { const i = Number(mv.closest("[data-bloco]").dataset.bloco), j = i + Number(mv.dataset.blocoMover); if (j >= 0 && j < blocos.length) { [blocos[i], blocos[j]] = [blocos[j], blocos[i]]; desenharBlocos(); $$(`[data-bloco="${j}"] [data-bloco-mover="${mv.dataset.blocoMover}"]`, lista)[0]?.focus(); guardar(); } return; }
      const rm = e.target.closest("[data-bloco-remover]");
      if (rm) { const i = Number(rm.closest("[data-bloco]").dataset.bloco); confirmar(`Remover a seção “${blocos[i].titulo}”?`, { titulo: "Remover seção", botao: "Remover", perigo: true }).then((ok) => { if (ok) { blocos.splice(i, 1); desenharBlocos(); guardar(); } }); return; }
      const rr = e.target.closest("[data-rascunho]");
      if (rr) {
        if (rr.dataset.rascunho === "recuperar") {
          const x = rascunho.dados;
          f.titulo.value = x.titulo; f.nivel.value = x.nivel; f.trilha.value = x.trilha; opcoesModulo(); opcoesPai(); f.modulo.value = x.modulo; f.paiId.value = x.paiId || "";
          f.revisarEm.value = x.revisarEm; f.resumo.value = x.resumo; f.palavrasChave.value = x.palavrasChave; f.rascunho.checked = !!x.rascunho;
          blocos = (x.blocos || []).map(app.normalizarBloco).filter(Boolean); desenharBlocos();
        } else localStorage.removeItem(chave);
        rr.closest(".faixa-rascunho").remove(); return;
      }
      if (e.target.closest("[data-historico]")) { abrirHistorico(base); return; }
      const fmt = e.target.closest("[data-fmt]");
      if (fmt) { e.preventDefault(); aplicarFormato(fmt, ultimoCampo, d); return; }
    });
    /* Arrastar seções */
    let blocoArrastado = -1;
    lista.addEventListener("dragstart", (e) => { const a = e.target.closest("[data-bloco-alca]"); if (!a) return; blocoArrastado = Number(a.closest("[data-bloco]").dataset.bloco); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "secao"); });
    lista.addEventListener("dragover", (e) => { if (blocoArrastado < 0) return; const s = e.target.closest("[data-bloco]"); if (!s) return; e.preventDefault(); $$(".ed-alvo-antes", lista).forEach((x) => x.classList.remove("ed-alvo-antes")); s.classList.add("ed-alvo-antes"); });
    lista.addEventListener("drop", (e) => { if (blocoArrastado < 0) return; const s = e.target.closest("[data-bloco]"); if (!s) return; e.preventDefault(); const j = Number(s.dataset.bloco); const [b] = blocos.splice(blocoArrastado, 1); blocos.splice(j > blocoArrastado ? j - 1 : j, 0, b); blocoArrastado = -1; desenharBlocos(); guardar(); });
    lista.addEventListener("dragend", () => { blocoArrastado = -1; $$(".ed-alvo-antes", lista).forEach((x) => x.classList.remove("ed-alvo-antes")); });
    lista.addEventListener("keydown", (e) => {
      const a = e.target.closest("[data-bloco-alca]");
      if (a && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const i = Number(a.closest("[data-bloco]").dataset.bloco), j = i + (e.key === "ArrowUp" ? -1 : 1);
        if (j < 0 || j >= blocos.length) return;
        [blocos[i], blocos[j]] = [blocos[j], blocos[i]]; desenharBlocos(); $$(`[data-bloco="${j}"] [data-bloco-alca]`, lista)[0]?.focus(); guardar();
        return;
      }
      if (e.target.matches("textarea") && (e.ctrlKey || e.metaKey)) {
        const k = e.key.toLowerCase();
        const mapa = { b: "negrito", i: "italico", "`": "codigo" };
        const alvo = e.shiftKey ? { x: "tachado", h: "realce" }[k] : mapa[k];
        if (alvo) { e.preventDefault(); aplicarFormato({ dataset: { fmt: alvo } }, e.target, d); }
      }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const erro = $(".form-erro", d);
      const titulo = f.titulo.value.trim();
      if (!titulo) { erro.textContent = "Informe o título."; f.titulo.focus(); return; }
      let id = base.id;
      if (novo) id = idUnico(titulo, (x) => !!app.porId(x));
      const final = app.normalizarTema({ ...base, id, titulo, nivel: f.nivel.value, trilha: f.trilha.value, modulo: f.modulo.value, paiId: f.paiId.value || null,
        revisarEm: f.revisarEm.value, resumo: f.resumo.value.trim(), palavrasChave: f.palavrasChave.value.split(",").map((x) => x.trim()).filter(Boolean),
        ocultaPropria: f.rascunho.checked, blocos, secoes: {} });
      if (final.paiId === final.id) final.paiId = null;
      if (novo) final.ordem = app.raizesDoModulo(final.trilha, final.modulo).length + 1;
      const tamanho = JSON.stringify(app.dadosTema(final)).length;
      if (tamanho > LIMITE_AULA) { erro.textContent = `A aula ficou grande demais (${Math.round(tamanho / 1024)} KB; o limite é ~900 KB). Divida em duas aulas ou use imagens menores.`; return; }
      const botaoSalvar = f.querySelector('[type="submit"]');
      botaoSalvar.disabled = true;
      const ops = [];
      if (!novo) ops.push(opVersao(base, "Antes da publicação"));
      try {
        await gravar({ aulas: [final], ops }, { acao: novo ? "criar" : "editar", resumo: `${novo ? "Criou" : "Publicou"} a aula “${titulo}”`, detalhes: id, desfazer: false });
        localStorage.removeItem(chave);
        clearTimeout(tempo);
        d.close();
        if (novo || location.hash.slice(1).split("/")[0] !== id) location.hash = "#" + id;
        podarVersoes(id);
      } catch (err) { erro.textContent = "Não foi possível salvar. Confira se você entrou como administradora."; botaoSalvar.disabled = false; }
    });
    d.addEventListener("close", () => clearTimeout(tempo));
    d.showModal();
    f.titulo.focus();
  }

  /* Barra de formatação (mesmos grupos da barra do caderno) */
  function barraFormatacao() {
    const b = (fmt, rotulo, conteudo, menu = false) => `<button type="button" class="btn-icone fmt-botao" data-fmt="${fmt}" aria-label="${escapar(rotulo)}" title="${escapar(rotulo)}"${menu ? ' aria-haspopup="menu"' : ""}>${conteudo}</button>`;
    return `<div class="barra-formatacao" role="toolbar" aria-label="Formatação (vale para a seção em que o cursor está)">
      <div class="fmt-grupo" role="group" aria-label="Desfazer e refazer">${b("desfazer", "Desfazer (Ctrl+Z)", svg("i-desfazer"))}${b("refazer", "Refazer (Ctrl+Y)", '<span style="display:inline-block;transform:scaleX(-1)">' + svg("i-desfazer") + "</span>")}</div>
      <div class="fmt-grupo" role="group" aria-label="Estilo">${b("estilo", "Estilo do parágrafo", '<span class="fmt-letra">T</span>', true)}</div>
      <div class="fmt-grupo" role="group" aria-label="Formatar o trecho">${b("negrito", "Negrito (Ctrl+B)", '<span class="fmt-letra"><b>B</b></span>')}${b("italico", "Itálico (Ctrl+I)", '<span class="fmt-letra"><i>I</i></span>')}${b("tachado", "Tachado (Ctrl+Shift+X)", '<span class="fmt-letra"><s>S</s></span>')}${b("realce", "Realce (Ctrl+Shift+H)", '<span class="fmt-letra amostra-realce">A</span>')}${b("codigo", "Código (Ctrl+`)", '<span class="fmt-letra">&lt;/&gt;</span>')}</div>
      <div class="fmt-grupo" role="group" aria-label="Cor">${b("cor", "Cor do texto e do fundo", '<span class="fmt-letra cor-roxo">A</span>', true)}</div>
      <div class="fmt-grupo" role="group" aria-label="Listas e recuo">${b("listas", "Listas", svg("i-lista"), true)}${b("recuo-menos", "Diminuir recuo", "⇤")}${b("recuo-mais", "Aumentar recuo", "⇥")}</div>
      <div class="fmt-grupo" role="group" aria-label="Inserir">${b("tabela", "Tabela (editor visual)", svg("i-tabela"))}${b("inserir", "Inserir: destaque, passo a passo, galeria, imagem, link…", svg("i-mais"), true)}</div>
      <div class="fmt-grupo" role="group" aria-label="Selos">${b("selo", "Selo de confiabilidade (Validado, A confirmar, Não repassar, Uso interno)", `${svg("i-sucesso")}<span class="fmt-rotulo">Selo</span>`, true)}</div>
    </div>`;
  }
  /* Edição do texto com execCommand("insertText"): o Ctrl+Z do navegador continua funcionando */
  function substituir(ta, inicio, fim, texto, selIni, selFim) {
    ta.focus();
    ta.setSelectionRange(inicio, fim);
    if (!document.execCommand("insertText", false, texto)) ta.setRangeText(texto, inicio, fim, "end");
    ta.setSelectionRange(inicio + (selIni ?? texto.length), inicio + (selFim ?? texto.length));
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function envolver(ta, antes, depois, exemplo) {
    const { selectionStart: i, selectionEnd: j, value } = ta;
    const sel = value.slice(i, j) || exemplo;
    substituir(ta, i, j, antes + sel + depois, antes.length, antes.length + sel.length);
  }
  function linhasSelecionadas(ta) {
    const v = ta.value;
    const i = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    let j = v.indexOf("\n", ta.selectionEnd); if (j < 0) j = v.length;
    return { i, j, linhas: v.slice(i, j).split("\n") };
  }
  function prefixar(ta, fn) {
    const { i, j, linhas } = linhasSelecionadas(ta);
    const novo = linhas.map(fn).join("\n");
    substituir(ta, i, j, novo, 0, novo.length);
  }
  function inserirBloco(ta, texto, selIni, selFim) {
    const v = ta.value;
    let pos = ta.selectionEnd;
    const fimLinha = v.indexOf("\n", pos); pos = fimLinha < 0 ? v.length : fimLinha;
    const antes = pos > 0 ? (v[pos - 1] === "\n" ? "\n" : "\n\n") : "";
    const bloco = antes + texto + "\n";
    substituir(ta, pos, pos, bloco, antes.length + (selIni ?? 0), antes.length + (selFim ?? texto.length));
  }
  function menuFormato(botaoFmt, itens, aoEscolher) {
    fecharMenuFmt();
    const el = document.createElement("div");
    el.className = "ed-menu ed-menu-fmt";
    el.setAttribute("role", "menu");
    el.innerHTML = itens.map(([v, r], k) => `<button type="button" role="menuitem" data-v="${k}" tabindex="-1">${r}</button>`).join("");
    botaoFmt.closest("dialog").appendChild(el);
    const r = botaoFmt.getBoundingClientRect();
    el.style.position = "fixed";
    el.style.top = `${Math.min(window.innerHeight - 20, r.bottom + 4)}px`;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - 260, r.left))}px`;
    const botoes = $$("[role=menuitem]", el);
    botoes[0].focus();
    menuFmt = el;
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; fecharMenuFmt(); aoEscolher(itens[Number(b.dataset.v)][0]); });
    el.addEventListener("keydown", (e) => {
      const i = botoes.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); botoes[(i + (e.key === "ArrowDown" ? 1 : -1) + botoes.length) % botoes.length].focus(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecharMenuFmt(); botaoFmt.focus(); }
    });
  }
  let menuFmt = null;
  function fecharMenuFmt() { if (menuFmt) { menuFmt.remove(); menuFmt = null; } }
  document.addEventListener("pointerdown", (e) => { if (menuFmt && !e.target.closest(".ed-menu-fmt") && !e.target.closest("[data-fmt]")) fecharMenuFmt(); });
  function aplicarFormato(botaoFmt, ta, d) {
    const fmt = botaoFmt.dataset.fmt;
    if (!ta || !ta.isConnected) ta = $("textarea[data-campo=markdown]", d);
    if (!ta) { mostrarAviso("Adicione uma seção para escrever."); return; }
    if (fmt === "desfazer" || fmt === "refazer") { ta.focus(); document.execCommand(fmt === "desfazer" ? "undo" : "redo"); ta.dispatchEvent(new Event("input", { bubbles: true })); return; }
    if (fmt === "negrito") return envolver(ta, "**", "**", "negrito");
    if (fmt === "italico") return envolver(ta, "*", "*", "itálico");
    if (fmt === "tachado") return envolver(ta, "~~", "~~", "tachado");
    if (fmt === "realce") return envolver(ta, "==", "==", "realce");
    if (fmt === "codigo") return envolver(ta, "`", "`", "código");
    if (fmt === "recuo-mais") return prefixar(ta, (l) => (l ? "  " + l : l));
    if (fmt === "recuo-menos") return prefixar(ta, (l) => l.replace(/^ {1,2}/, ""));
    if (fmt === "estilo") return menuFormato(botaoFmt, [["", "Texto normal"], ["## ", "Título 2"], ["### ", "Título 3"], ["#### ", "Título 4"]], (p) => prefixar(ta, (l) => p + l.replace(/^#{1,6}\s+/, "")));
    if (fmt === "cor") return menuFormato(botaoFmt, CORES_TEXTO.flatMap((c) => [[`cor:${c}`, `<span class="cor-${c}">A</span> Texto ${c}`], [`fundo:${c}`, `<span class="fundo-${c}">A</span> Fundo ${c}`]]), (v) => { const [k, c] = v.split(":"); envolver(ta, `{${k}:${c}}`, `{/${k}}`, "texto"); });
    if (fmt === "listas") return menuFormato(botaoFmt, [["-", "Lista com marcadores"], ["1", "Lista numerada"], ["[]", "Lista de tarefas"]], (v) => {
      let n = 0;
      prefixar(ta, (l) => { const limpo = l.replace(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "$1"); const recuo = /^\s*/.exec(limpo)[0]; const resto = limpo.slice(recuo.length); return v === "-" ? `${recuo}- ${resto}` : v === "1" ? `${recuo}${++n}. ${resto}` : `${recuo}- [ ] ${resto}`; });
    });
    if (fmt === "selo") return menuFormato(botaoFmt, Object.entries(SELOS).map(([k, s]) => [k, `${svg(s.icone)}${escapar(s.rotulo)} — ${escapar(s.explicacao)}`]), (k) => {
      const { selectionStart: i, selectionEnd: j, value } = ta;
      const sel = value.slice(i, j);
      if (sel) substituir(ta, i, j, `:::selo ${k}\n${sel}\n:::`, 0, sel.length + k.length + 15);
      else inserirBloco(ta, `:::selo ${k}\nTexto com o selo ${SELOS[k].rotulo}.\n:::`, k.length + 10, k.length + 10 + `Texto com o selo ${SELOS[k].rotulo}.`.length);
    });
    if (fmt === "tabela") return editarTabela(ta);
    if (fmt === "inserir") return menuFormato(botaoFmt, [
      ...Object.entries(CALLOUTS).map(([k, c]) => [`callout:${k}`, `${svg(c.icone)}Destaque: ${escapar(c.titulo)}`]),
      ["passo", `${svg("i-lista")}Passo a passo (:::passo)`], ["galeria", `${svg("i-grade")}Galeria (:::galeria)`], ["imagem", `${svg("i-imagem")}Imagem (enviar)`],
      ["link", `${svg("i-link")}Link`], ["detalhes", `${svg("i-chevron-baixo")}Bloco recolhível`], ["codigo", `${svg("i-documento")}Bloco de código`], ["linha", "— Linha horizontal"]
    ], async (v) => {
      if (v.startsWith("callout:")) { const k = v.slice(8); return inserirBloco(ta, `> [!${k}] ${CALLOUTS[k].titulo}\n> Texto do destaque.`, k.length + CALLOUTS[k].titulo.length + 9, k.length + CALLOUTS[k].titulo.length + 26); }
      if (v === "passo") return inserirBloco(ta, ":::passo\nDescreva o passo.\n:::", 9, 26);
      if (v === "galeria") return inserirBloco(ta, ":::galeria 3\n![Legenda](endereço-da-imagem)\n:::", 13, 43);
      if (v === "link") return envolver(ta, "[", "](https://)", "texto do link");
      if (v === "detalhes") return inserirBloco(ta, ":::detalhes Título\nConteúdo que fica recolhido.\n:::", 12, 18);
      if (v === "codigo") return inserirBloco(ta, "```\ncódigo\n```", 4, 10);
      if (v === "linha") return inserirBloco(ta, "---");
      if (v === "imagem") {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/jpeg,image/png,image/webp";
        input.addEventListener("change", async () => {
          const file = input.files[0]; if (!file) return;
          try {
            const url = await comprimirImagem(file, 1400, 220000);
            inserirBloco(ta, `![Descreva a imagem](${url})`, 2, 19);
            mostrarAviso(`Imagem inserida (${Math.round(url.length / 1024)} KB). Cada aula tem limite de ~900 KB.`);
          } catch (err) { mostrarAviso(err.message || "Não foi possível usar esta imagem."); }
        });
        input.click();
      }
    });
  }
  /* Tabela com editor visual: edita a tabela onde o cursor está ou cria uma nova */
  function editarTabela(ta) {
    const v = ta.value;
    const linhasTexto = v.split("\n");
    let pos = 0, linhaCursor = 0;
    for (let k = 0; k < linhasTexto.length; k++) { if (pos + linhasTexto[k].length >= ta.selectionStart) { linhaCursor = k; break; } pos += linhasTexto[k].length + 1; }
    const ehLinhaTabela = (l) => /^\s*\|.*\|\s*$/.test(l || "");
    let ini = -1, fim = -1;
    if (ehLinhaTabela(linhasTexto[linhaCursor])) { ini = linhaCursor; while (ini > 0 && ehLinhaTabela(linhasTexto[ini - 1])) ini--; fim = linhaCursor; while (fim + 1 < linhasTexto.length && ehLinhaTabela(linhasTexto[fim + 1])) fim++; }
    let dados = [["Coluna 1", "Coluna 2", "Coluna 3"], ["", "", ""], ["", "", ""]];
    if (ini >= 0 && fim - ini >= 1) dados = linhasTexto.slice(ini, fim + 1).filter((l, k) => k !== 1).map((l) => celulasTabela(l));
    const n = Math.max(...dados.map((l) => l.length));
    dados = dados.map((l) => Array.from({ length: n }, (_, k) => l[k] || ""));
    const d = criarDialogo({ titulo: ini >= 0 ? "Editar tabela" : "Nova tabela", largo: true, corpo: `<div class="ed-tabela-rolagem"><table class="ed-tabela" data-tab></table></div>
      <div class="form-botoes" style="justify-content:flex-start"><button type="button" class="btn btn-secundario btn-mini" data-tab-acao="linha">${svg("i-mais")}Linha</button><button type="button" class="btn btn-secundario btn-mini" data-tab-acao="coluna">${svg("i-mais")}Coluna</button>
        <button type="button" class="btn btn-secundario btn-mini" data-tab-acao="menos-linha">Tirar a última linha</button><button type="button" class="btn btn-secundario btn-mini" data-tab-acao="menos-coluna">Tirar a última coluna</button></div>
      <p class="apoio">A primeira linha é o cabeçalho. Use &lt;br&gt; para quebrar linha dentro de uma célula.</p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-tabela")}Aplicar tabela</button></div>` });
    const tab = $("[data-tab]", d);
    const desenhar = () => { tab.innerHTML = dados.map((l, i) => `<tr>${l.map((c, j) => `<td><input data-l="${i}" data-c="${j}" value="${escapar(c)}" aria-label="${i === 0 ? "Cabeçalho" : `Linha ${i}`}, coluna ${j + 1}"${i === 0 ? ' class="cab"' : ""}></td>`).join("")}</tr>`).join(""); };
    desenhar();
    tab.addEventListener("input", (e) => { const x = e.target; dados[Number(x.dataset.l)][Number(x.dataset.c)] = x.value; });
    d.addEventListener("click", (e) => {
      const a = e.target.closest("[data-tab-acao]"); if (!a) return;
      const k = a.dataset.tabAcao;
      if (k === "linha") dados.push(Array(dados[0].length).fill(""));
      if (k === "coluna") dados.forEach((l, i) => l.push(i ? "" : `Coluna ${l.length + 1}`));
      if (k === "menos-linha" && dados.length > 2) dados.pop();
      if (k === "menos-coluna" && dados[0].length > 1) dados.forEach((l) => l.pop());
      desenhar();
    });
    d.querySelector("form").addEventListener("submit", () => {
      const limpa = (c) => String(c).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
      const md = [`| ${dados[0].map(limpa).join(" | ")} |`, `| ${dados[0].map(() => "---").join(" | ")} |`, ...dados.slice(1).map((l) => `| ${l.map(limpa).join(" | ")} |`)].join("\n");
      if (ini >= 0) {
        const inicio = linhasTexto.slice(0, ini).join("\n").length + (ini ? 1 : 0);
        const fimPos = linhasTexto.slice(0, fim + 1).join("\n").length;
        substituir(ta, inicio, fimPos, md);
      } else inserirBloco(ta, md);
    });
    d.showModal();
  }

  /* ------------------------------------------------------------
   *  Versões (conhecimento/{id}/versoes): ver diferenças e restaurar
   * ------------------------------------------------------------ */
  function opVersao(aula, resumo) {
    const vid = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return { op: "set", caminho: `conhecimento/${aula.id}/versoes/${vid}`, dados: { dados: { ...app.dadosTema(aula, { semAssinatura: true }), atualizadoEm: aula.atualizadoEm || "", atualizadoPor: aula.atualizadoPor || "" }, resumo: String(resumo).slice(0, 200), em: "__AGORA__", por: sessao.email || "" } };
  }
  async function podarVersoes(id) {
    try {
      const lista = (await estado.api.lerColecao(`conhecimento/${id}/versoes`)).sort((a, b) => String(b.em).localeCompare(String(a.em)));
      const sobra = lista.slice(MAX_VERSOES);
      if (sobra.length) await estado.api.lote(sobra.map((v) => ({ op: "delete", caminho: `conhecimento/${id}/versoes/${v.id}` })));
    } catch (e) { console.warn("Versões:", e); }
  }
  const textoPlano = (a) => [`# ${a.titulo}`, a.resumo ? `Resumo: ${a.resumo}` : "", ...app.blocosDe(app.normalizarTema({ ...a, id: a.id || "x" })).flatMap((b) => [`## ${b.titulo}`, ...String(b.markdown).split("\n")])].filter((x) => x !== "");
  /* Diferença linha a linha (LCS) */
  function diferencas(antes, depois) {
    const n = antes.length, m = depois.length;
    if (n * m > 400000) return [...antes.map((l) => ["-", l]), ...depois.map((l) => ["+", l])];
    const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = antes[i] === depois[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    const r = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (antes[i] === depois[j]) { r.push([" ", antes[i]]); i++; j++; }
      else if (t[i + 1][j] >= t[i][j + 1]) r.push(["-", antes[i++]]);
      else r.push(["+", depois[j++]]);
    }
    while (i < n) r.push(["-", antes[i++]]);
    while (j < m) r.push(["+", depois[j++]]);
    return r;
  }
  async function abrirHistorico(aula) {
    if (!aula || !app.podeEditar()) return;
    const d = criarDialogo({ titulo: `Histórico: ${aula.titulo}`, largo: true, corpo: `<p class="apoio">Cada publicação guarda a versão anterior (as ${MAX_VERSOES} mais recentes ficam).</p><div data-versoes><p class="apoio">Carregando…</p></div><div data-diff></div>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button></div>` });
    d.showModal();
    let versoes = [];
    try { versoes = (await estado.api.lerColecao(`conhecimento/${aula.id}/versoes`)).sort((a, b) => String(b.em).localeCompare(String(a.em))); }
    catch (e) { $("[data-versoes]", d).innerHTML = '<p class="form-erro">Não foi possível carregar o histórico.</p>'; return; }
    $("[data-versoes]", d).innerHTML = versoes.length ? `<ol class="ed-versoes">${versoes.map((v, i) => `<li><span><strong>${escapar(formatarData(v.em, true))}</strong> · ${escapar(v.por || "")}<br><span class="apoio">${escapar(v.resumo || "")}${v.dados && v.dados.atualizadoEm ? ` · versão de ${escapar(formatarData(v.dados.atualizadoEm, true))}` : ""}</span></span>
      <span class="ed-versao-acoes"><button type="button" class="btn btn-secundario btn-mini" data-diff="${i}">${svg("i-colunas")}Ver diferenças</button><button type="button" class="btn btn-mini" data-restaurar="${i}">${svg("i-desfazer")}Restaurar</button></span></li>`).join("")}</ol>` : '<p class="apoio">Ainda não há versões anteriores desta aula.</p>';
    d.addEventListener("click", async (e) => {
      const df = e.target.closest("[data-diff]");
      if (df) {
        const v = versoes[Number(df.dataset.diff)];
        const linhas = diferencas(textoPlano(v.dados || {}), textoPlano(app.porId(aula.id) || aula));
        const mudou = linhas.filter((l) => l[0] !== " ").length;
        $("[data-diff]", d).innerHTML = `<h3 class="ed-diff-titulo">Diferenças: versão de ${escapar(formatarData(v.em, true))} → atual (${mudou} linha(s))</h3>
          <p class="apoio"><span class="ed-diff-menos">− linha que só existia na versão antiga</span> · <span class="ed-diff-mais">+ linha nova na versão atual</span></p>
          <pre class="ed-diff">${linhas.map(([s, l]) => `<span class="${s === "+" ? "ed-diff-mais" : s === "-" ? "ed-diff-menos" : ""}">${s} ${escapar(l)}</span>`).join("\n")}</pre>`;
        return;
      }
      const rs = e.target.closest("[data-restaurar]");
      if (rs) {
        const v = versoes[Number(rs.dataset.restaurar)];
        if (!(await confirmar(`Restaurar a versão de ${formatarData(v.em, true)}? A versão atual fica guardada no histórico.`, { titulo: "Restaurar versão", botao: "Restaurar" }))) return;
        const atual = app.porId(aula.id) || aula;
        const restaurada = app.normalizarTema({ ...v.dados, id: aula.id });
        try {
          await gravar({ aulas: [restaurada], ops: [opVersao(atual, `Antes de restaurar a versão de ${formatarData(v.em, true)}`)] }, { acao: "editar", resumo: `Restaurou uma versão anterior da aula “${restaurada.titulo}”`, detalhes: aula.id, desfazer: false });
          d.close();
          podarVersoes(aula.id);
        } catch (err) { /* aviso já mostrado */ }
      }
    });
  }

  /* ------------------------------------------------------------
   *  Lixeira (conhecimento-lixeira)
   * ------------------------------------------------------------ */
  async function abrirLixeira() {
    const d = criarDialogo({ titulo: "Lixeira da Aprendizagem", largo: true, corpo: `<div data-lixeira><p class="apoio">Carregando…</p></div><div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button></div>` });
    d.showModal();
    const desenhar = async () => {
      let itens = [];
      try { itens = await estado.api.lerColecao("conhecimento-lixeira"); } catch (e) { $("[data-lixeira]", d).innerHTML = '<p class="form-erro">Não foi possível abrir a lixeira.</p>'; return; }
      const grupos = new Map();
      itens.forEach((x) => { if (!grupos.has(x.grupo)) grupos.set(x.grupo, []); grupos.get(x.grupo).push(x); });
      const ordem = ["categoria", "trilha", "modulo", "aula"];
      const lista = [...grupos.values()].map((g) => g.sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo))).sort((a, b) => String(b[0].removidoEm).localeCompare(String(a[0].removidoEm)));
      $("[data-lixeira]", d).innerHTML = lista.length ? `<ul class="ed-lixeira">${lista.map((g, i) => `<li><span><strong>${escapar(NOMES_TIPO[g[0].tipo])}: ${escapar(g[0].nome)}</strong>${g.length > 1 ? ` <span class="apoio">(+ ${g.length - 1} item(ns) junto)</span>` : ""}<br><span class="apoio">Removido em ${escapar(formatarData(g[0].removidoEm, true))}${g[0].removidoPor ? ` por ${escapar(g[0].removidoPor)}` : ""}</span></span>
        <span class="ed-versao-acoes"><button type="button" class="btn btn-mini" data-lx-restaurar="${i}">${svg("i-desfazer")}Restaurar</button><button type="button" class="btn btn-perigo btn-mini" data-lx-excluir="${i}">${svg("i-lixeira")}Excluir de vez</button></span></li>`).join("")}</ul>` : '<p class="apoio">A lixeira está vazia.</p>';
      d.onclick = async (e) => {
        const rs = e.target.closest("[data-lx-restaurar]"), ex = e.target.closest("[data-lx-excluir]");
        if (rs) { try { await restaurarGrupo(lista[Number(rs.dataset.lxRestaurar)]); desenhar(); } catch (err) { /* aviso já mostrado */ } }
        if (ex) {
          const g = lista[Number(ex.dataset.lxExcluir)];
          if (!(await confirmar(`Excluir de vez “${g[0].nome}”${g.length > 1 ? ` e mais ${g.length - 1} item(ns)` : ""}? Isso não pode ser desfeito.`, { titulo: "Excluir de vez", botao: "Excluir de vez", perigo: true }))) return;
          await estado.api.lote(g.map((x) => ({ op: "delete", caminho: `conhecimento-lixeira/${x.id}` })));
          app.registrarAuditoria({ acao: "excluir", alvo: "aprendizagem", resumo: `Excluiu de vez da lixeira: ${NOMES_TIPO[g[0].tipo]} “${g[0].nome}”`.slice(0, 200) });
          desenhar();
        }
      };
    };
    desenhar();
  }
  async function restaurarGrupo(g) {
    let categorias = null, trilhas = null;
    const aulas = [];
    const cats = clonar(estado.categorias), trs = clonar(estado.trilhas);
    const mapaIds = new Map();
    g.forEach((x) => {
      if (x.tipo === "categoria") {
        const c = app.normalizarCategoria(x.dados, cats.length);
        if (cats.some((k) => k.id === c.id)) { const novo = idUnico(c.id, (k) => cats.some((z) => z.id === k)); mapaIds.set("categoria:" + c.id, novo); c.id = novo; }
        if (!c.ordem) c.ordem = proximaOrdem(cats);
        cats.push(c); categorias = cats;
      }
      if (x.tipo === "trilha") {
        const t = app.normalizarTrilha(x.dados, trs.length);
        if (trs.some((k) => k.id === t.id)) { const novo = idUnico(t.id, (k) => trs.some((z) => z.id === k)); mapaIds.set("trilha:" + t.id, novo); t.id = novo; }
        const catOrig = mapaIds.get("categoria:" + t.categoria) || t.categoria;
        t.categoria = cats.some((c) => c.id === catOrig) ? catOrig : (cats[0] || {}).id || "";
        if (!t.ordem) t.ordem = proximaOrdem(trs);
        trs.push(t); trilhas = trs;
      }
      if (x.tipo === "modulo") {
        const [trId] = x.itemId.split("/");
        const t = trs.find((k) => k.id === trId) || trs[0];
        if (!t) return;
        garantirModulosReais(t);
        const m = app.normalizarModulo(x.dados, t.modulos.length);
        if (t.modulos.some((k) => k.id === m.id)) m.id = idUnico(m.id, (k) => t.modulos.some((z) => z.id === k));
        if (!m.ordem) m.ordem = proximaOrdem(t.modulos);
        t.modulos.push(m); trilhas = trs;
        mapaIds.set("modulo:" + x.itemId, `${t.id}/${m.id}`);
      }
    });
    g.filter((x) => x.tipo === "aula").forEach((x) => {
      const a = app.normalizarTema({ ...x.dados, id: x.itemId });
      if (!a) return;
      if (app.porId(a.id)) a.id = idUnico(`${a.id}-restaurada`, (k) => !!app.porId(k));
      const trOrig = mapaIds.get("trilha:" + a.trilha) || a.trilha;
      const modChave = mapaIds.get(`modulo:${(x.origem || {}).trilha}/${(x.origem || {}).modulo}`);
      if (modChave) { const [t2, m2] = modChave.split("/"); a.trilha = t2; a.modulo = m2; }
      else a.trilha = trs.some((t) => t.id === trOrig) ? trOrig : (trs[0] || {}).id;
      aulas.push(a);
    });
    const m = { aulas, ops: g.map((x) => ({ op: "delete", caminho: `conhecimento-lixeira/${x.id}` })) };
    if (categorias) m.categorias = categorias;
    if (trilhas) m.trilhas = trilhas;
    await gravar(m, { acao: "restaurar", resumo: `Restaurou da lixeira: ${NOMES_TIPO[g[0].tipo]} “${g[0].nome}”${g.length > 1 ? ` (+ ${g.length - 1})` : ""}`, desfazer: false });
  }

  /* ------------------------------------------------------------
   *  Glossário (um termo por linha: Termo :: definição :: id-da-aula)
   * ------------------------------------------------------------ */
  function editarGlossario() {
    if (!app.podeEditar()) return;
    const d = criarDialogo({ titulo: "Glossário", largo: true, corpo: `<p class="apoio">Um termo por linha, no formato <code>Termo :: definição</code>. Para ligar a uma aula, acrescente <code>:: id-da-aula</code> no fim.</p>
      <label class="campo"><span class="rotulo">Termos</span><textarea name="termos" rows="18" style="font-family:ui-monospace,Consolas,monospace;font-size:13px">${escapar(estado.glossario.map((g) => `${g.termo} :: ${g.definicao}${g.tema ? " :: " + g.tema : ""}`).join("\n"))}</textarea></label>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${svg("i-salvar")}Salvar glossário</button></div>` });
    d.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const termos = app.normalizarGlossario(e.target.termos.value.split("\n").map((l) => { const [termo, definicao, tema] = l.split("::").map((x) => (x || "").trim()); return { termo, definicao, tema }; })).slice(0, 400);
      try {
        await estado.api.salvarDoc("conhecimento-config/glossario", { termos, ...app.assinatura() });
        app.registrarAuditoria({ acao: "editar", alvo: "aprendizagem", resumo: `Atualizou o glossário (${termos.length} termos)` });
        d.close();
        mostrarAviso("Glossário salvo.");
      } catch (err) { console.error(err); d.querySelector(".form-erro").textContent = "Não foi possível salvar."; }
    });
    d.showModal();
  }

  return {
    ativo, item, zona, renomeavel, controles, adicionar, zonaOutrasTrilhas, botoesAula, botoesGlossario,
    aoNavegar() {
      fecharMenu();
      atualizarBotao();
      if (focoDepois) {
        const { tipo, id } = focoDepois;
        focoDepois = null;
        const alca = document.querySelector(`.ed-controles[data-ed-tipo="${tipo}"][data-ed-id="${CSS.escape(id)}"] [data-ed-arrastar]`);
        if (alca) alca.focus();
      }
    },
    aoMudarSessao: atualizarBotao,
    editarAula
  };
}
