/*
 * ============================================================
 *  MAPAS DE AJUDA (mapas.html): mapas mentais de diagnóstico, um por sistema.
 *  Sistema → Sintoma → Testes → Quem resolve (qualquer profundidade, 7 tipos de nó).
 *
 *  Endereços:  #  (lista)  ·  #m/<mapa>  ·  #m/<mapa>/n/<nó>  ·  #m/<mapa>/roteiro/<sintoma>
 *  Dados (ver mapas-dados.js): mapas/{id}, mapas/{id}/nos/{id}, mapas/{id}/usos/{id}, mapas-lixeira/{id}.
 *
 *  ESTRUTURA (tipos, campos, listas de opções, modelos): vem de mapas-dados.js (padrões) mesclada com
 *  mapas-config/estrutura e /modelos, editados no Painel de edição (#painel, comum/mapas-painel.js).
 *  QUEM CRIA/EDITA MAPAS E NÓS: qualquer pessoa (sem login assina com o nome, como a Galeria).
 *  QUEM EXCLUI / LIXEIRA: administradoras (ADMINS em base.js) + EDITORES_MAPAS abaixo.
 *  QUEM USA O PAINEL: só administradoras (podeUsarPainel(); ehAdmin() em mapas-config no firestore.rules).
 *  Mantenha EDITORES_MAPAS igual à função podeEditarMapas() do firestore.rules.
 *  "Registrar atendimento" (usos) também é aberto a qualquer pessoa, assinando com o nome.
 *
 *  Teste local sem tocar na produção: abra mapas.html?nuvem-teste em localhost
 *  (carrega dev/mapas/nuvem-teste.js, uma nuvem simulada no navegador).
 * ============================================================
 */
import { $, $$, escapar, normalizar, svg, slug, mostrarAviso, ligarTema, ligarLogin, aoMudarSessao, ehAdmin, sessao,
  registrarAuditoria, confirmar, criarDialogo, formatarData, baixarArquivo, copiarTexto, ADMINS } from "./base.js";
import { renderizarMarkdown } from "./markdown.js";
import {
  ID_VALIDO, LIMITES, CORES, ICONES, TIPOS, ORDEM_TIPOS, FILHO_PADRAO, CAMPOS, MODELOS, TAG_EXEMPLO,
  normalizarNo, normalizarMapa, dadosNo, dadosMapa, indexar, descendentes, caminhoAteRaiz, contarPorTipo, contatoMaisProximo,
  revisaoVencida, textoDoNo, corresponde, idCurto, nosDoModelo, mapaExemploSCDA, resumoRoteiro, textoContato,
  mapaParaMarkdown, mapaParaJSON, lerJSONMapa, clonarNos, urlSegura, porOrdem,
  camposComValor, acharOpcao, rotuloOpcao, campoDoTipo, aplicarEstrutura, aplicarModelos
} from "./mapas-dados.js";
import { criarCanvas } from "./mapas-canvas.js";
import { iniciarPainel } from "./mapas-painel.js";

/* Quem pode excluir / usar a lixeira além das administradoras (e-mails em minúsculas). Igual a podeEditarMapas() no firestore.rules. */
const EDITORES_MAPAS = [
  // "nome.sobrenome@valid.com",
];
const CHAVE_EDICAO = "suporte-n2-mapas-edicao";
const CHAVE_RECOLHIDOS = "suporte-n2-mapas-recolhidos";
const CHAVE_VISTA = "suporte-n2-mapas-vista";
const CHAVE_QUADRO = "suporte-n2-mapas-quadro";
const CHAVE_POSICOES = "suporte-n2-mapas-posicoes";
const CHAVE_AUTOR = "suporte-n2-autor-anotacao";
const CELULAR = window.matchMedia("(max-width: 640px)");

if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("nuvem-teste")) {
  try { await import("../dev/mapas/nuvem-teste.js"); } catch (e) { console.warn("Nuvem de teste indisponível:", e); }
}

const lerJSON = (chave, padrao, area = localStorage) => { try { const v = area.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
const gravarJSON = (chave, valor, area = localStorage) => { try { area.setItem(chave, JSON.stringify(valor)); } catch (e) {} };
const lerAutorLocal = () => { try { return (localStorage.getItem(CHAVE_AUTOR) || "").trim().replace(/@/g, "").slice(0, 60); } catch (e) { return ""; } };
const gravarAutorLocal = (nome) => { try { localStorage.setItem(CHAVE_AUTOR, nome); } catch (e) {} };

const estado = {
  api: null, carregou: false,
  mapas: [], nos: new Map(), usos: new Map(), ouvintesNos: new Map(), ouvinteUsos: null,
  rota: { tela: "lista" },
  edicao: lerJSON(CHAVE_EDICAO, false, sessionStorage),
  vista: lerJSON(CHAVE_VISTA, null), quadros: lerJSON(CHAVE_QUADRO, {}),
  recolhidos: lerJSON(CHAVE_RECOLHIDOS, {}),
  /* Posições livres (árvore/grafo): só neste navegador — não vão para a nuvem. */
  posicoesLocais: lerJSON(CHAVE_POSICOES, {}),
  selecionado: null, apontado: null, buscaMapa: "", roteiro: null, canvas: null,
  /* Configuração do Painel de edição (mapas-config/estrutura e /modelos), como veio da nuvem */
  config: { estrutura: null, modelos: null },
  /* "Pré-visualizar como visitante" (Painel): esconde tudo o que é de edição, só nesta aba */
  comoVisitante: lerJSON("suporte-n2-mapas-como-visitante", false, sessionStorage)
};
/* Criar/editar/mover: qualquer pessoa com nuvem (sem login assina com o nome). Excluir: admins + EDITORES_MAPAS. */
const podeEditar = () => !estado.comoVisitante && !!estado.api;
const podeExcluir = () => podeEditar() && !!sessao.email && (ehAdmin() || EDITORES_MAPAS.includes(sessao.email));
/* Painel de edição (estrutura dos mapas): SÓ administradoras. Igual a ehAdmin() em mapas-config no firestore.rules. */
const podeUsarPainel = () => !estado.comoVisitante && !!estado.api && ehAdmin();
const editando = () => estado.edicao && podeEditar();
const autor = () => sessao.email || lerAutorLocal();
const nomeDe = (email) => { const a = ADMINS.find((x) => x.email === email); return a ? a.nome : (email || "").split("@")[0]; };
const md = (t) => renderizarMarkdown(t || "").html;
const mapaPorId = (id) => estado.mapas.find((m) => m.id === id) || null;
const nosDe = (id) => estado.nos.get(id) || [];
/* Vista do mapa: ignora pos da nuvem e aplica só o layout local deste computador. */
function nosParaVista(mapaId) {
  const locais = estado.posicoesLocais[mapaId] || {};
  return nosDe(mapaId).map((n) => {
    const p = locais[n.id];
    const pos = p && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? { x: Math.round(p.x), y: Math.round(p.y), v: p.v === "grafo" ? "grafo" : "arvore" }
      : null;
    return { ...n, pos };
  });
}
function gravarPosicaoLocal(mapaId, noId, pos) {
  const porMapa = { ...(estado.posicoesLocais[mapaId] || {}) };
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    porMapa[noId] = { x: Math.round(pos.x), y: Math.round(pos.y), v: pos.v === "grafo" ? "grafo" : "arvore" };
  } else delete porMapa[noId];
  if (Object.keys(porMapa).length) estado.posicoesLocais[mapaId] = porMapa;
  else delete estado.posicoesLocais[mapaId];
  gravarJSON(CHAVE_POSICOES, estado.posicoesLocais);
}
function limparPosicoesLocais(mapaId) {
  if (!estado.posicoesLocais[mapaId]) return false;
  delete estado.posicoesLocais[mapaId];
  gravarJSON(CHAVE_POSICOES, estado.posicoesLocais);
  return true;
}

/* ============================================================
 *  Persistência
 * ============================================================ */
function opsTocarMapa(mapaId) {
  return { caminho: `mapas/${mapaId}`, dados: { atualizadoEm: "__AGORA__", atualizadoPor: autor() }, mesclar: true };
}
/* Sem login: pede o nome (igual Galeria/Anotações). Com login, usa o e-mail. */
function pedirAutor() {
  if (sessao.email) return Promise.resolve(sessao.email);
  const salvo = lerAutorLocal();
  if (salvo) return Promise.resolve(salvo);
  return new Promise((resolver) => {
    const d = criarDialogo({
      titulo: "Como você se chama?",
      corpo: `<p class="apoio">Seu nome assina o mapa (nada além disso é gravado). Sem “@”.</p>
        <label class="campo"><span class="rotulo">Seu nome</span><input name="autor" maxlength="60" required autocomplete="name"></label>
        <p class="form-erro" role="alert"></p>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Continuar</button></div>`
    });
    const form = d.querySelector("form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const nome = form.autor.value.trim().replace(/@/g, "").slice(0, 60);
      if (!nome) { form.querySelector(".form-erro").textContent = "Informe seu nome."; return; }
      gravarAutorLocal(nome);
      d.close();
      resolver(nome);
    });
    d.addEventListener("close", () => resolver(lerAutorLocal() || null), { once: true });
    d.showModal();
    form.autor.focus();
  });
}
async function gravar(ops, { aviso = null, auditoria = null } = {}) {
  if (!podeEditar()) { mostrarAviso("Sem permissão para editar."); return false; }
  const por = await pedirAutor();
  if (!por) return false;
  /* Garante que opsNos / dadosMapa usem o nome acabado de informar */
  ops.forEach((op) => {
    if (op.dados && "atualizadoPor" in op.dados) op.dados.atualizadoPor = por;
    if (op.dados && "criadoPor" in op.dados) op.dados.criadoPor = por;
    if (op.dados && "removidoPor" in op.dados) op.dados.removidoPor = por;
  });
  try {
    await estado.api.lote(ops);
    if (aviso) mostrarAviso(aviso);
    if (auditoria) registrarAuditoria({ alvo: "mapas", ...auditoria });
    return true;
  } catch (e) {
    console.error(e);
    mostrarAviso(/permission/i.test(e.code || e.message) ? "A nuvem recusou a gravação (permissão)." : "Não foi possível salvar agora. Tente de novo.");
    return false;
  }
}
function opsNos(mapaId, nos) { return nos.map((n) => ({ caminho: `mapas/${mapaId}/nos/${n.id}`, dados: dadosNo(n, autor()) })); }
async function salvarNos(mapaId, nos, opcoes = {}) {
  return gravar([...opsNos(mapaId, nos), opsTocarMapa(mapaId)], opcoes);
}
function idUnico(base) {
  let id = slug(base, 50) || "mapa";
  const usados = new Set(estado.mapas.map((m) => m.id));
  if (!usados.has(id)) return id;
  for (let i = 2; i < 999; i++) if (!usados.has(`${id}-${i}`)) return `${id}-${i}`;
  return `${id}-${idCurto("")}`.slice(0, 60);
}
async function criarMapa(mapa, nos, { auditoria = "criar" } = {}) {
  const id = idUnico(mapa.nome);
  const m = normalizarMapa({ ...mapa, id });
  const ops = [{ caminho: `mapas/${id}`, dados: dadosMapa(m, autor(), true) }, ...opsNos(id, nos)];
  const ok = await gravar(ops, { aviso: `Mapa "${m.nome}" criado.`, auditoria: { acao: auditoria, resumo: `Mapa: ${m.nome}`, detalhes: `${id} · ${nos.length} nós` } });
  return ok ? id : null;
}
function tamanhoJSON(v) { try { return new Blob([JSON.stringify(v)]).size; } catch (e) { return Infinity; } }
async function moverParaLixeira(tipo, mapa, nos, nome) {
  if (!podeExcluir()) { mostrarAviso("Só administradoras (e editores) podem excluir."); return false; }
  const dados = tipo === "mapa" ? { mapa, nos } : { nos };
  if (tamanhoJSON(dados) > 900000) { mostrarAviso("Grande demais para a lixeira: exporte o JSON antes de excluir."); return false; }
  const id = `${tipo}-${mapa.id}-${Date.now().toString(36)}`.slice(0, 100);
  const ops = [{ caminho: `mapas-lixeira/${id}`, dados: { tipo, mapaId: mapa.id, nome: String(nome).slice(0, 120), dados, removidoEm: "__AGORA__", removidoPor: autor() } }];
  nos.forEach((n) => ops.push({ op: "delete", caminho: `mapas/${mapa.id}/nos/${n.id}` }));
  if (tipo === "mapa") ops.push({ op: "delete", caminho: `mapas/${mapa.id}` });
  else ops.push(opsTocarMapa(mapa.id));
  return gravar(ops, { aviso: tipo === "mapa" ? `Mapa "${nome}" foi para a lixeira.` : `"${nome}" foi para a lixeira.`,
    auditoria: { acao: "excluir", resumo: `${tipo === "mapa" ? "Mapa" : "Nó"}: ${nome}`, detalhes: `${mapa.id} · ${nos.length} nós` } });
}

/* ============================================================
 *  Conexão e ouvintes em tempo real
 * ============================================================ */
let pedidoDesenho = false;
function redesenhar() {
  if (pedidoDesenho) return;
  pedidoDesenho = true;
  requestAnimationFrame(() => { pedidoDesenho = false; desenharTela(); });
}
function ouvirNosDosMapas() {
  const ids = new Set(estado.mapas.map((m) => m.id));
  estado.ouvintesNos.forEach((parar, id) => { if (!ids.has(id)) { parar(); estado.ouvintesNos.delete(id); estado.nos.delete(id); } });
  ids.forEach((id) => {
    if (estado.ouvintesNos.has(id)) return;
    estado.ouvintesNos.set(id, estado.api.ouvirColecao(`mapas/${id}/nos`, (lista) => {
      estado.nos.set(id, lista.map(normalizarNo).filter(Boolean));
      redesenhar();
    }, (e) => console.warn("nós de", id, e)));
  });
}
function ouvirUsos(mapaId) {
  if (estado.ouvinteUsos && estado.ouvinteUsos.id === mapaId) return;
  if (estado.ouvinteUsos) estado.ouvinteUsos.parar();
  if (!estado.api || !mapaId) { estado.ouvinteUsos = null; return; }
  estado.ouvinteUsos = { id: mapaId, parar: estado.api.ouvirColecao(`mapas/${mapaId}/usos`, (lista) => { estado.usos.set(mapaId, lista); redesenhar(); }, () => {}) };
}

/* ============================================================
 *  Rotas
 * ============================================================ */
function lerRota() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const p = h.split("/");
  if (p[0] === "m" && ID_VALIDO.test(p[1] || "")) {
    if (p[2] === "roteiro" && ID_VALIDO.test(p[3] || "")) return { tela: "roteiro", mapaId: p[1], sintomaId: p[3] };
    return { tela: "mapa", mapaId: p[1], noId: p[2] === "n" && ID_VALIDO.test(p[3] || "") ? p[3] : null };
  }
  if (p[0] === "painel") return { tela: "painel", aba: /^[a-z]{1,20}$/.test(p[1] || "") ? p[1] : "tipos", mapaId: null };
  return { tela: "lista" };
}
function ir(hash) { if (location.hash !== hash) location.hash = hash; else aoMudarRota(); }
let telaMontada = null;
let hashAnterior = location.hash;
function aoMudarRota() {
  const anterior = estado.rota;
  const proxima = lerRota();
  /* Saindo do Painel com alterações não salvas: confirma antes */
  if (anterior.tela === "painel" && proxima.tela !== "painel" && painel.temPendencias()
    && !window.confirm("Há alterações não salvas no Painel de edição. Sair mesmo assim? (elas serão descartadas)")) {
    history.replaceState(null, "", hashAnterior);
    return;
  }
  if (anterior.tela === "painel" && proxima.tela !== "painel") painel.descartar(true);
  hashAnterior = location.hash;
  estado.rota = proxima;
  if (estado.rota.tela !== "mapa" || anterior.mapaId !== estado.rota.mapaId) { estado.selecionado = null; estado.apontado = null; estado.buscaMapa = ""; }
  if (estado.rota.tela === "mapa") estado.selecionado = estado.rota.noId || null;
  if (estado.rota.tela === "roteiro" && (!estado.roteiro || estado.roteiro.sintomaId !== estado.rota.sintomaId || estado.roteiro.mapaId !== estado.rota.mapaId)) estado.roteiro = null;
  telaMontada = null;
  ouvirUsos(estado.rota.mapaId);
  desenharTela();
  $("#conteudo").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ============================================================
 *  Topo: modo edição, título
 * ============================================================ */
function atualizarTopo() {
  const botao = $("#btn-edicao");
  botao.hidden = !podeEditar();
  botao.setAttribute("aria-pressed", String(editando()));
  botao.innerHTML = `${svg("i-lapis")}<span>${editando() ? "Sair do modo edição" : "Modo edição"}</span>`;
  const barra = $("#barra-edicao");
  barra.hidden = !editando();
  document.body.classList.toggle("modo-edicao", editando());
  const bp = $("#btn-painel");
  bp.hidden = !podeUsarPainel();
  bp.setAttribute("aria-pressed", String(estado.rota.tela === "painel"));
  /* Faixa "vendo como visitante": só aparece para quem ativou a pré-visualização */
  const fv = $("#faixa-visitante");
  fv.hidden = !estado.comoVisitante;
  const m = estado.rota.mapaId && mapaPorId(estado.rota.mapaId);
  const titulo = estado.rota.tela === "painel" ? "Mapas de Ajuda · Painel de edição" : (m ? `Mapas de Ajuda · ${m.nome}` : "Mapas de Ajuda");
  $("#titulo-pagina span").textContent = titulo;
  document.title = `${estado.rota.tela === "painel" ? "Painel de edição · " : (m ? m.nome + " · " : "")}Mapas de Ajuda · Central do Suporte V/CERT`;
}
function alternarComoVisitante(ligar) {
  estado.comoVisitante = ligar;
  gravarJSON("suporte-n2-mapas-como-visitante", ligar, sessionStorage);
  telaMontada = null;
  mostrarAviso(ligar ? "Pré-visualizando como visitante: os controles de edição ficaram escondidos." : "Pré-visualização encerrada.");
  if (ligar && estado.rota.tela === "painel") ir("#"); else desenharTela();
}
function montarBarraEdicao() {
  $("#barra-edicao").innerHTML = `<span>${svg("i-lapis")}<strong>Modo edição</strong> · <kbd>Tab</kbd> filho · <kbd>Enter</kbd> irmão · <kbd>F2</kbd> editar${podeExcluir() ? " · <kbd>Delete</kbd> excluir" : ""} · <kbd>Alt</kbd>+<kbd>↑/↓</kbd> reordenar · arraste um nó sobre outro para trocar o pai. Arrastar o nó (árvore ou grafo) move só neste computador.</span>
    <span class="barra-edicao-acoes">${podeExcluir() ? `<button type="button" class="btn btn-secundario btn-mini" data-acao="lixeira">${svg("i-lixeira")}Lixeira</button>` : ""}</span>`;
  $("#barra-edicao").addEventListener("click", (e) => { if (e.target.closest('[data-acao="lixeira"]')) abrirLixeira(); });
  $("#btn-edicao").addEventListener("click", () => {
    estado.edicao = !estado.edicao;
    gravarJSON(CHAVE_EDICAO, estado.edicao, sessionStorage);
    mostrarAviso(estado.edicao ? "Modo edição ligado." : "Modo edição desligado.");
    telaMontada = null;
    desenharTela();
  });
}

/* ============================================================
 *  Tela: lista de mapas
 * ============================================================ */
function desenharTela() {
  atualizarTopo();
  if (!estado.carregou) return;
  const r = estado.rota;
  if (r.tela !== "roteiro") $("#conteudo").onclick = null;
  if (r.tela === "lista") return desenharLista();
  if (r.tela === "painel") {
    if (estado.canvas) { estado.canvas.destruir(); estado.canvas = null; }
    if (!podeUsarPainel()) {
      telaMontada = null;
      $("#conteudo").innerHTML = `<div class="vazio"><p><strong>Painel de edição</strong></p><p class="apoio">${sessao.pronta && !sessao.email ? "Entre com a conta de administradora para usar o painel." : "Só as administradoras podem mudar a estrutura dos mapas."}</p><a class="btn" href="#">Ver os mapas</a></div>`;
      return;
    }
    if (telaMontada !== "painel") { telaMontada = "painel"; painel.montar($("#conteudo")); }
    return painel.desenhar(r.aba);
  }
  const m = mapaPorId(r.mapaId);
  if (!m) {
    $("#conteudo").innerHTML = `<div class="vazio"><p>Mapa não encontrado. Ele pode ter sido excluído.</p><a class="btn" href="#">Ver todos os mapas</a></div>`;
    telaMontada = null;
    return;
  }
  if (r.tela === "roteiro") return desenharRoteiro(m);
  return desenharMapa(m);
}

function htmlCard(m) {
  const nos = nosDe(m.id);
  const c = contarPorTipo(nos);
  const exemplo = m.tags.includes(TAG_EXEMPLO);
  return `<article class="card-mapa tom-${m.cor}">
    <a class="card-link" href="#m/${escapar(m.id)}" aria-label="Abrir mapa ${escapar(m.nome)}">
      <span class="card-icone">${svg(m.icone)}</span>
      <span class="card-texto"><strong>${escapar(m.nome)}</strong>${exemplo ? ' <span class="selo selo-amarelo">Exemplo: revisar</span>' : ""}
        ${m.descricao ? `<span class="apoio">${escapar(m.descricao)}</span>` : ""}</span>
    </a>
    <div class="card-numeros"><span>${svg(TIPOS.sintoma.icone)}${escapar(TIPOS.sintoma.nome)}: ${c.sintoma || 0}</span>
      <span>${svg(TIPOS.contato.icone)}${escapar(TIPOS.contato.nome)}: ${c.contato || 0}</span><span>${svg("i-lista")}${nos.length} nós</span></div>
    <div class="card-rodape"><span class="apoio">${m.atualizadoEm ? `Atualizado em ${formatarData(m.atualizadoEm)}${m.atualizadoPor ? " por " + escapar(nomeDe(m.atualizadoPor)) : ""}` : "&nbsp;"}</span>
      <button type="button" class="btn-icone" data-menu-mapa="${escapar(m.id)}" aria-label="Ações do mapa ${escapar(m.nome)}" aria-haspopup="menu">${svg("i-ajustes")}</button></div>
  </article>`;
}
function desenharLista() {
  const raiz = $("#conteudo");
  if (telaMontada !== "lista") {
    telaMontada = "lista";
    raiz.innerHTML = `<section class="tela-lista">
      <div class="lista-topo">
        <div><h2>Mapas de diagnóstico</h2><p class="apoio">Um mapa por sistema: o <strong>sintoma</strong>, os <strong>testes</strong> em ordem e <strong>quem resolve</strong>.</p></div>
        <div class="lista-acoes" id="lista-acoes"></div>
      </div>
      <form class="atalho-problema" id="atalho-problema">
        <span class="rotulo">Estou com problema em…</span>
        <label class="sr-only" for="atalho-mapa">Sistema</label><select id="atalho-mapa"></select>
        <label class="sr-only" for="atalho-sintoma">Sintoma</label><select id="atalho-sintoma"></select>
        <button type="submit" class="btn btn-mini">${svg("i-roteiro")}Abrir roteiro</button>
      </form>
      <div class="busca-mapas" role="search">
        ${svg("i-busca")}<label class="sr-only" for="busca-mapas">Buscar nos mapas</label>
        <input type="search" id="busca-mapas" placeholder="Buscar sistema, sintoma, teste ou contato (ex.: travando)" autocomplete="off">
      </div>
      <div id="resultados-busca" aria-live="polite"></div>
      <div class="grade-mapas" id="grade-mapas"></div>
    </section>`;
    $("#busca-mapas").addEventListener("input", () => { desenharResultados(); desenharCards(); });
    $("#atalho-mapa").addEventListener("change", preencherSintomas);
    $("#atalho-problema").addEventListener("submit", (e) => {
      e.preventDefault();
      const m = $("#atalho-mapa").value, s = $("#atalho-sintoma").value;
      if (m && s) ir(`#m/${m}/roteiro/${s}`); else if (m) ir(`#m/${m}`);
    });
  }
  $("#lista-acoes").innerHTML = podeEditar() ? `<button type="button" class="btn btn-mini" data-acao="novo">${svg("i-mais")}Novo mapa</button>
    ${editando() ? `<button type="button" class="btn btn-secundario btn-mini" data-acao="importar">${svg("i-upload")}Importar JSON</button>` : ""}` : "";
  const sel = $("#atalho-mapa"), atual = sel.value;
  const ordenados = [...estado.mapas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  sel.innerHTML = `<option value="">Escolha o sistema</option>` + ordenados.map((m) => `<option value="${escapar(m.id)}">${escapar(m.nome)}</option>`).join("");
  sel.value = ordenados.some((m) => m.id === atual) ? atual : "";
  preencherSintomas();
  desenharResultados();
  desenharCards();
}
function preencherSintomas() {
  const m = $("#atalho-mapa").value;
  const s = $("#atalho-sintoma");
  const atual = s.value;
  const sintomas = m ? nosDe(m).filter((n) => n.tipo === "sintoma").sort(porOrdem) : [];
  s.innerHTML = `<option value="">${m ? (sintomas.length ? "Escolha o sintoma" : "Nenhum sintoma cadastrado") : "…e o sintoma"}</option>` + sintomas.map((n) => `<option value="${escapar(n.id)}">${escapar(n.titulo)}</option>`).join("");
  s.disabled = !sintomas.length;
  if (sintomas.some((n) => n.id === atual)) s.value = atual;
}
function desenharCards() {
  const termo = $("#busca-mapas").value;
  const grade = $("#grade-mapas");
  const lista = [...estado.mapas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .filter((m) => corresponde(normalizar(`${m.nome} ${m.descricao} ${m.tags.join(" ")}`), termo) || (termo && nosDe(m.id).some((n) => corresponde(textoDoNo(n), termo))));
  if (!estado.mapas.length) {
    grade.innerHTML = `<div class="vazio">
      <p><strong>Nenhum mapa ainda.</strong></p>
      ${podeEditar() ? `<p class="apoio">Qualquer pessoa pode criar. Comece pelo exemplo do SCDA ou monte um mapa do zero.</p>
        <div class="vazio-acoes"><button type="button" class="btn" data-acao="exemplo">${svg("i-mapa")}Criar mapa de exemplo</button>
        <button type="button" class="btn btn-secundario" data-acao="novo">${svg("i-mais")}Novo mapa</button></div>`
        : `<p class="apoio">Sem conexão com a nuvem agora: não dá para criar mapas.</p>`}
    </div>`;
    return;
  }
  grade.innerHTML = lista.length ? lista.map(htmlCard).join("") : `<p class="apoio">Nenhum mapa com “${escapar(termo)}”.</p>`;
}
function desenharResultados() {
  const termo = $("#busca-mapas").value.trim();
  const caixa = $("#resultados-busca");
  if (termo.length < 2) { caixa.innerHTML = ""; return; }
  const achados = [];
  estado.mapas.forEach((m) => {
    const idx = indexar(nosDe(m.id));
    nosDe(m.id).forEach((n) => {
      if (n.tipo !== "sistema" && corresponde(textoDoNo(n), termo)) achados.push({ m, n, caminho: caminhoAteRaiz(idx, n.id).slice(1, -1).reverse().map((id) => idx.porId.get(id).titulo) });
    });
  });
  caixa.innerHTML = achados.length ? `<h3 class="rotulo">Nos mapas (${achados.length})</h3><ul class="resultados-nos">${achados.slice(0, 40).map(({ m, n, caminho }) =>
    `<li><a href="#m/${escapar(m.id)}/n/${escapar(n.id)}"><span class="selo tom-${TIPOS[n.tipo].cor}">${svg(TIPOS[n.tipo].icone)}${escapar(TIPOS[n.tipo].nome)}</span>
      <span><strong>Mapa: ${escapar(m.nome)}</strong> › ${caminho.length ? escapar(caminho.join(" › ")) + " › " : ""}${escapar(n.titulo)}</span></a></li>`).join("")}</ul>` : "";
}
function aoClicarLista(e) {
  const acao = e.target.closest("[data-acao]");
  if (acao) {
    if (acao.dataset.acao === "novo") return editarMapa(null);
    if (acao.dataset.acao === "importar") return importarJSON();
    if (acao.dataset.acao === "exemplo") return criarExemplo();
  }
  const menu = e.target.closest("[data-menu-mapa]");
  if (menu) abrirMenuMapa(menu, mapaPorId(menu.dataset.menuMapa));
}
async function criarExemplo() {
  const { mapa, nos } = mapaExemploSCDA();
  const id = await criarMapa(mapa, nos, { auditoria: "criar" });
  if (id) ir(`#m/${id}`);
}

/* Menu flutuante simples (Escape fecha, setas navegam) */
function abrirMenu(ancora, itens) {
  $$(".menu-flutuante").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "menu-flutuante";
  menu.setAttribute("role", "menu");
  menu.innerHTML = itens.filter(Boolean).map((it, i) => `<button type="button" role="menuitem" data-i="${i}" class="${it.perigo ? "perigo" : ""}">${svg(it.icone)}${escapar(it.rotulo)}</button>`).join("");
  document.body.appendChild(menu);
  const r = ancora.getBoundingClientRect();
  const largura = menu.offsetWidth;
  menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4) + window.scrollY}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - largura - 8, r.right - largura))}px`;
  const botoes = $$("button", menu);
  const lista = itens.filter(Boolean);
  const fechar = () => { menu.remove(); document.removeEventListener("pointerdown", fora, true); ancora.focus(); };
  const fora = (e) => { if (!menu.contains(e.target)) fechar(); };
  document.addEventListener("pointerdown", fora, true);
  menu.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; fechar(); lista[+b.dataset.i].acao(); });
  menu.addEventListener("keydown", (e) => {
    const i = botoes.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); fechar(); }
    if (e.key === "ArrowDown") { e.preventDefault(); botoes[(i + 1) % botoes.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); botoes[(i - 1 + botoes.length) % botoes.length].focus(); }
    if (e.key === "Tab") fechar();
  });
  botoes[0] && botoes[0].focus();
}
function abrirMenuMapa(ancora, m) {
  if (!m) return;
  const ed = editando();
  abrirMenu(ancora, [
    { rotulo: "Abrir", icone: "i-mapa", acao: () => ir(`#m/${m.id}`) },
    ed && { rotulo: "Editar nome, ícone e cor", icone: "i-lapis", acao: () => editarMapa(m) },
    ed && { rotulo: "Duplicar", icone: "i-duplicar", acao: () => duplicarMapa(m) },
    { rotulo: "Exportar JSON", icone: "i-download", acao: () => baixarArquivo(`mapa-${m.id}.json`, mapaParaJSON(m, nosDe(m.id)), "application/json") },
    { rotulo: "Exportar roteiro (Markdown)", icone: "i-documento", acao: () => baixarArquivo(`mapa-${m.id}.md`, mapaParaMarkdown(m, nosDe(m.id)), "text/markdown;charset=utf-8") },
    podeExcluir() && { rotulo: "Excluir (vai para a lixeira)", icone: "i-lixeira", perigo: true, acao: () => excluirMapa(m) }
  ]);
}

/* ---------- Diálogo do mapa (novo / editar) ---------- */
function htmlEscolhaIcone(atual) {
  return `<fieldset class="escolha-icones"><legend class="rotulo">Ícone</legend>${ICONES.map((i) =>
    `<label title="${escapar(i.slice(2))}"><input type="radio" name="icone" value="${i}"${i === atual ? " checked" : ""}><span>${svg(i)}</span><span class="sr-only">${escapar(i.slice(2))}</span></label>`).join("")}</fieldset>`;
}
function htmlEscolhaCor(atual) {
  return `<fieldset class="escolha-cores"><legend class="rotulo">Cor</legend>${Object.entries(CORES).map(([c, nome]) =>
    `<label class="tom-${c}"><input type="radio" name="cor" value="${c}"${c === atual ? " checked" : ""}><span class="amostra"></span>${escapar(nome)}</label>`).join("")}</fieldset>`;
}
function editarMapa(m) {
  const novo = !m;
  const outros = estado.mapas.filter((x) => nosDe(x.id).length > 1);
  const d = criarDialogo({
    titulo: novo ? "Novo mapa" : "Editar mapa", largo: false,
    corpo: `<label class="campo"><span class="rotulo">Nome do sistema</span><input name="nome" maxlength="${LIMITES.nomeMapa}" required value="${escapar(m ? m.nome : "")}" placeholder="ex.: SCDA"></label>
      <label class="campo"><span class="rotulo">Descrição curta</span><textarea name="descricao" maxlength="${LIMITES.descricaoMapa}" rows="2">${escapar(m ? m.descricao : "")}</textarea></label>
      ${htmlEscolhaIcone(m ? m.icone : "i-servidor")}
      ${htmlEscolhaCor(m ? m.cor : "roxo")}
      <label class="campo"><span class="rotulo">Etiquetas</span><input name="tags" value="${escapar(m ? m.tags.join(", ") : "")}" placeholder="separe por vírgula"></label>
      ${novo ? `<label class="campo"><span class="rotulo">Modelo inicial</span><select name="modelo">
        ${MODELOS.map((x, i) => `<option value="${escapar(x.id)}"${x.id === "diagnostico" || (i === 0 && !MODELOS.some((y) => y.id === "diagnostico")) ? " selected" : ""}>${escapar(x.nome)}${x.descricao ? ": " + escapar(x.descricao) : ""}</option>`).join("")}
        ${outros.map((x) => `<option value="copiar:${escapar(x.id)}">Copiar a estrutura de: ${escapar(x.nome)}</option>`).join("")}
      </select></label>` : ""}
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">${novo ? "Criar mapa" : "Salvar"}</button></div>`
  });
  const form = d.querySelector("form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = form.nome.value.trim();
    if (!nome) { form.querySelector(".form-erro").textContent = "Informe o nome do sistema."; form.nome.focus(); return; }
    const dados = { nome, descricao: form.descricao.value.trim(), icone: form.icone.value, cor: form.cor.value,
      tags: form.tags.value.split(",").map((t) => t.trim()).filter(Boolean) };
    form.querySelector('[type="submit"]').disabled = true;
    if (novo) {
      let nos;
      const modelo = form.modelo.value;
      if (modelo.startsWith("copiar:")) {
        const origem = clonarNos(nosDe(modelo.slice(7)), true).nos;
        const raiz = indexar(origem).raiz;
        if (raiz) raiz.titulo = nome;
        nos = origem;
      } else nos = nosDoModelo(modelo, nome).map(normalizarNo);
      const id = await criarMapa({ ...dados, layout: "arvore" }, nos);
      d.close();
      if (id) ir(`#m/${id}`);
    } else {
      const ok = await gravar([{ caminho: `mapas/${m.id}`, dados: dadosMapa({ ...m, ...dados }, autor()), mesclar: true }],
        { aviso: "Mapa salvo.", auditoria: { acao: "editar", resumo: `Mapa: ${nome}`, detalhes: m.id } });
      if (ok) d.close(); else form.querySelector('[type="submit"]').disabled = false;
    }
  });
  d.showModal();
  form.nome.focus();
}
async function duplicarMapa(m) {
  const { nos } = clonarNos(nosDe(m.id), true);
  const id = await criarMapa({ ...m, nome: `${m.nome} (cópia)`, tags: m.tags.filter((t) => t !== TAG_EXEMPLO) }, nos, { auditoria: "duplicar" });
  if (id) ir(`#m/${id}`);
}
async function excluirMapa(m) {
  const n = nosDe(m.id).length;
  if (!(await confirmar(`O mapa "${m.nome}" e seus ${n} nós vão para a lixeira (dá para restaurar).`, { titulo: "Excluir mapa", botao: "Excluir", perigo: true }))) return;
  const ok = await moverParaLixeira("mapa", m, nosDe(m.id), m.nome);
  if (ok && estado.rota.mapaId === m.id) ir("#");
}
function importarJSON() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const arq = input.files[0];
    if (!arq) return;
    try {
      const { mapa, nos } = lerJSONMapa(await arq.text(), { idsNovos: true });
      const id = await criarMapa(mapa, nos, { auditoria: "importar" });
      if (id) ir(`#m/${id}`);
    } catch (e) { mostrarAviso(e.message || "Arquivo inválido."); }
  });
  input.click();
}

/* ---------- Lixeira ---------- */
async function abrirLixeira() {
  if (!podeEditar()) return;
  const d = criarDialogo({ titulo: "Lixeira dos mapas", largo: true, corpo: `<div class="lixeira-lista"><p class="apoio">Carregando…</p></div>` });
  d.showModal();
  const caixa = d.querySelector(".lixeira-lista");
  const carregar = async () => {
    let itens = [];
    try { itens = await estado.api.lerColecao("mapas-lixeira"); } catch (e) { caixa.innerHTML = `<p class="form-erro">Não foi possível ler a lixeira.</p>`; return; }
    itens.sort((a, b) => String(b.removidoEm).localeCompare(String(a.removidoEm)));
    caixa.innerHTML = itens.length ? `<ul class="lixeira">${itens.map((it) => `<li>
        <span><strong>${escapar(it.nome)}</strong> <span class="selo">${it.tipo === "mapa" ? "Mapa" : "Ramo de " + escapar((mapaPorId(it.mapaId) || {}).nome || it.mapaId)}</span>
        <span class="apoio">${(it.dados && it.dados.nos || []).length} nós · removido em ${formatarData(it.removidoEm, true)} por ${escapar(nomeDe(it.removidoPor))}</span></span>
        <span class="lixeira-acoes"><button type="button" class="btn btn-secundario btn-mini" data-restaurar="${escapar(it.id)}">Restaurar</button>
        <button type="button" class="btn btn-perigo btn-mini" data-apagar="${escapar(it.id)}">Excluir de vez</button></span></li>`).join("")}</ul>`
      : `<p class="apoio">A lixeira está vazia.</p>`;
    caixa.onclick = async (e) => {
      const r = e.target.closest("[data-restaurar]"), a = e.target.closest("[data-apagar]");
      const it = itens.find((x) => x.id === (r || a || {}).dataset?.[r ? "restaurar" : "apagar"]);
      if (!it) return;
      if (a) {
        if (!(await confirmar(`"${it.nome}" será apagado para sempre.`, { titulo: "Excluir de vez", botao: "Excluir de vez", perigo: true }))) return;
        if (await gravar([{ op: "delete", caminho: `mapas-lixeira/${it.id}` }], { aviso: "Excluído de vez.", auditoria: { acao: "excluir-de-vez", resumo: it.nome, detalhes: it.id } })) carregar();
        return;
      }
      if (await restaurar(it)) { carregar(); }
    };
  };
  carregar();
}
async function restaurar(it) {
  const nos = (it.dados && it.dados.nos || []).map(normalizarNo).filter(Boolean);
  if (it.tipo === "mapa") {
    const m = normalizarMapa({ ...(it.dados.mapa || {}), id: it.mapaId });
    const id = mapaPorId(m.id) ? idUnico(m.nome) : m.id;
    const ops = [{ caminho: `mapas/${id}`, dados: dadosMapa({ ...m, id }, autor(), true) }, ...opsNos(id, nos), { op: "delete", caminho: `mapas-lixeira/${it.id}` }];
    return gravar(ops, { aviso: `Mapa "${m.nome}" restaurado.`, auditoria: { acao: "restaurar", resumo: `Mapa: ${m.nome}`, detalhes: id } });
  }
  if (!mapaPorId(it.mapaId)) { mostrarAviso("O mapa deste ramo não existe mais: restaure o mapa primeiro."); return false; }
  const existentes = new Set(nosDe(it.mapaId).map((n) => n.id));
  const raiz = indexar(nosDe(it.mapaId)).raiz;
  nos.forEach((n) => { if (n.paiId && !existentes.has(n.paiId) && !nos.some((x) => x.id === n.paiId)) n.paiId = raiz ? raiz.id : null; });
  return gravar([...opsNos(it.mapaId, nos), opsTocarMapa(it.mapaId), { op: "delete", caminho: `mapas-lixeira/${it.id}` }],
    { aviso: `"${it.nome}" restaurado.`, auditoria: { acao: "restaurar", resumo: `Nó: ${it.nome}`, detalhes: it.mapaId } });
}

/* ============================================================
 *  Tela: mapa (quadro SVG ou lista em árvore + painel de detalhes)
 * ============================================================ */
const vistaAtual = () => estado.vista || (CELULAR.matches ? "lista" : "mapa");
const quadroAtual = (m) => estado.quadros[m.id] || m.layout || "arvore";
function recolhidosDe(m, idx) {
  const local = estado.recolhidos[m.id] || {};
  const s = new Set();
  idx.porId.forEach((n) => {
    if (!(idx.filhos.get(n.id) || []).length) return;
    const v = n.id in local ? local[n.id] : n.recolhido;
    if (v) s.add(n.id);
  });
  return s;
}
function expandirAte(m, idx, id) {
  const local = estado.recolhidos[m.id] || (estado.recolhidos[m.id] = {});
  caminhoAteRaiz(idx, id).slice(1).forEach((a) => { local[a] = false; });
  gravarJSON(CHAVE_RECOLHIDOS, estado.recolhidos);
}
async function alternar(m, id) {
  const idx = indexar(nosDe(m.id));
  const no = idx.porId.get(id);
  if (!no) return;
  const rec = recolhidosDe(m, idx).has(id);
  if (editando()) {
    const local = estado.recolhidos[m.id] || {};
    delete local[id];
    gravarJSON(CHAVE_RECOLHIDOS, estado.recolhidos);
    await salvarNos(m.id, [{ ...no, recolhido: !rec }]);
  } else {
    (estado.recolhidos[m.id] || (estado.recolhidos[m.id] = {}))[id] = !rec;
    gravarJSON(CHAVE_RECOLHIDOS, estado.recolhidos);
    redesenhar();
  }
}

function desenharMapa(m) {
  const raiz = $("#conteudo");
  const nos = nosParaVista(m.id);
  const idx = indexar(nos);
  if (estado.selecionado && !idx.porId.has(estado.selecionado)) estado.selecionado = null;
  const chave = `mapa:${m.id}:${vistaAtual()}:${editando()}`;
  if (telaMontada !== chave) {
    telaMontada = chave;
    if (estado.canvas) { estado.canvas.destruir(); estado.canvas = null; }
    raiz.innerHTML = `<section class="tela-mapa">
      <div class="barra-mapa">
        <a class="btn btn-secundario btn-mini" href="#">${svg("i-voltar")}<span>Mapas</span></a>
        <h2 class="nome-mapa tom-${m.cor}"><span class="card-icone">${svg(m.icone)}</span><span id="nome-mapa"></span></h2>
        <div class="segmentado" role="group" aria-label="Forma de ver">
          <button type="button" data-vista="mapa" aria-pressed="${vistaAtual() === "mapa"}">${svg("i-mapa")}<span>Mapa</span></button>
          <button type="button" data-vista="lista" aria-pressed="${vistaAtual() === "lista"}">${svg("i-lista")}<span>Lista</span></button>
        </div>
        <div class="segmentado" role="group" aria-label="Arrumação do mapa" ${vistaAtual() === "lista" ? "hidden" : ""}>
          <button type="button" data-quadro="arvore">${svg("i-arvore")}<span>Árvore</span></button>
          <button type="button" data-quadro="grafo">${svg("i-grafo")}<span>Grafo</span></button>
        </div>
        <button type="button" class="btn btn-mini" data-acao="roteiro">${svg("i-roteiro")}<span>Roteiro</span></button>
        <div class="busca-mapa" role="search">${svg("i-busca")}<label class="sr-only" for="busca-mapa">Buscar neste mapa</label>
          <input type="search" id="busca-mapa" placeholder="Buscar neste mapa" autocomplete="off" value="${escapar(estado.buscaMapa)}"><span class="apoio" id="busca-mapa-total"></span></div>
        <div class="barra-mapa-fim">
          ${vistaAtual() === "mapa" ? `<button type="button" class="btn btn-secundario btn-mini" data-acao="reorganizar" title="Volta as posições deste computador ao layout automático (árvore ou grafo)">${svg("i-desfazer")}<span>Reorganizar</span></button>` : ""}
          <button type="button" class="btn-icone" data-acao="mais" aria-label="Exportar e mais ações" aria-haspopup="menu">${svg("i-download")}</button>
        </div>
      </div>
      <div class="area-mapa">
        <div class="palco" id="palco"${vistaAtual() === "lista" ? " hidden" : ""}>
          <div class="zoom-controles" role="group" aria-label="Zoom">
            <button type="button" class="btn-icone" data-zoom="mais" aria-label="Aproximar">${svg("i-mais")}</button>
            <button type="button" class="btn-icone" data-zoom="menos" aria-label="Afastar">${svg("i-menos")}</button>
            <button type="button" class="btn-icone" data-zoom="centro" aria-label="Centralizar">${svg("i-alvo")}</button>
            <button type="button" class="btn-icone" data-zoom="ajustar" aria-label="Ajustar à tela">${svg("i-ajustar")}</button>
          </div>
          <div class="legenda" aria-hidden="true">${ORDEM_TIPOS.map((t) => `<span class="tom-${TIPOS[t].cor}"><i></i>${escapar(TIPOS[t].nome)}</span>`).join("")}</div>
        </div>
        <div class="outline" id="outline"${vistaAtual() === "lista" ? "" : " hidden"}></div>
        <aside class="painel" id="painel" hidden aria-label="Detalhes do nó"></aside>
      </div>
    </section>`;
    ligarBarraMapa(m);
    if (vistaAtual() === "mapa") {
      estado.canvas = criarCanvas($("#palco"), {
        aoSelecionar: (id) => selecionar(m, id),
        aoApontar: (id) => apontar(m, id),
        aoAbrir: (id) => { if (editando()) editarNo(m, id); else selecionar(m, id); },
        aoAlternar: (id) => alternar(m, id),
        /* Arrastar nó: posição livre só neste navegador (não replica para outros). */
        aoMover: (_id, pos) => { gravarPosicaoLocal(m.id, _id, pos); },
        /* Soltar sobre outro nó (trocar pai): só no modo edição, para não mudar a árvore sem querer. */
        aoReparentar: editando() ? (id, alvo) => reparentar(m, id, alvo) : null,
        aoTecla: (e, id) => teclaEdicao(m, e, id),
        aoClicarFundo: () => { if (estado.selecionado || estado.apontado) { estado.selecionado = null; estado.apontado = null; trocarHash(m, null); redesenhar(); } }
      });
    }
  }
  $("#nome-mapa").textContent = m.nome;
  $$("[data-quadro]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.quadro === quadroAtual(m))));
  const termo = estado.buscaMapa.trim();
  const marcados = new Set(termo.length >= 2 ? nos.filter((n) => corresponde(textoDoNo(n), termo)).map((n) => n.id) : []);
  $("#busca-mapa-total").textContent = termo.length >= 2 ? `${marcados.size}` : "";
  const rec = recolhidosDe(m, idx);
  if (estado.canvas) {
    /* editavel: qualquer pessoa pode arrastar nós só neste computador (árvore ou grafo). */
    estado.canvas.atualizar({ idx, recolhidos: rec, quadro: quadroAtual(m), editavel: true, selecionado: estado.selecionado, marcados });
    if (estado.rota.noId && estado.pendenteFoco !== `${m.id}/${estado.rota.noId}` && idx.porId.has(estado.rota.noId)) {
      estado.pendenteFoco = `${m.id}/${estado.rota.noId}`;
      if (rec.size && caminhoAteRaiz(idx, estado.rota.noId).slice(1).some((a) => rec.has(a))) { expandirAte(m, idx, estado.rota.noId); return redesenhar(); }
      requestAnimationFrame(() => estado.canvas && estado.canvas.focar(estado.rota.noId, { zoom: 1 }));
    }
  } else desenharOutline(m, idx, rec, marcados);
  desenharPainel(m, idx);
}
function trocarHash(m, id) {
  const h = id ? `#m/${m.id}/n/${id}` : `#m/${m.id}`;
  if (location.hash !== h) history.replaceState(null, "", h);
  estado.rota = lerRota();
}
function selecionar(m, id) {
  estado.selecionado = id;
  estado.apontado = null;
  trocarHash(m, id);
  redesenhar();
  if (CELULAR.matches || vistaAtual() === "lista") requestAnimationFrame(() => { const p = $("#painel"); if (p && !p.hidden) p.focus({ preventScroll: false }); });
}
/* Passar o mouse sobre um bloco (Árvore, Grafo ou Lista) mostra as informações no painel sem empurrar o quadro. */
let timerLimparApontado = null;
function apontar(m, id) {
  if (CELULAR.matches) return;
  clearTimeout(timerLimparApontado);
  if (!id) {
    timerLimparApontado = setTimeout(() => {
      const p = $("#painel");
      if (p && p.matches(":hover")) return;
      if (estado.apontado) { estado.apontado = null; desenharPainel(m, indexar(nosDe(m.id))); }
    }, 120);
    return;
  }
  if (estado.apontado === id) return;
  estado.apontado = id;
  desenharPainel(m, indexar(nosDe(m.id)));
}
function ligarBarraMapa(m) {
  const barra = $(".barra-mapa");
  barra.addEventListener("click", async (e) => {
    const v = e.target.closest("[data-vista]");
    if (v) { estado.vista = v.dataset.vista; gravarJSON(CHAVE_VISTA, estado.vista); telaMontada = null; return desenharTela(); }
    const q = e.target.closest("[data-quadro]");
    if (q) {
      const m2 = mapaPorId(m.id);
      if (editando()) await gravar([{ caminho: `mapas/${m.id}`, dados: dadosMapa({ ...m2, layout: q.dataset.quadro }, autor()), mesclar: true }]);
      estado.quadros[m.id] = q.dataset.quadro;
      gravarJSON(CHAVE_QUADRO, estado.quadros);
      redesenhar();
      requestAnimationFrame(() => requestAnimationFrame(() => estado.canvas && estado.canvas.ajustar()));
      return;
    }
    const a = e.target.closest("[data-acao]");
    if (!a) return;
    if (a.dataset.acao === "roteiro") return escolherSintoma(m, a);
    if (a.dataset.acao === "reorganizar") return reorganizar(m);
    if (a.dataset.acao === "mais") return menuExportar(m, a);
  });
  $("#busca-mapa").addEventListener("input", (e) => { estado.buscaMapa = e.target.value; redesenhar(); });
  $("#busca-mapa").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const idx = indexar(nosDe(m.id));
    const achado = nosDe(m.id).find((n) => corresponde(textoDoNo(n), estado.buscaMapa));
    if (!achado) return;
    expandirAte(m, idx, achado.id);
    selecionar(m, achado.id);
    requestAnimationFrame(() => estado.canvas ? estado.canvas.focar(achado.id) : focarOutline(achado.id));
  });
  const palco = $("#palco");
  palco.addEventListener("click", (e) => {
    const z = e.target.closest("[data-zoom]");
    if (!z || !estado.canvas) return;
    ({ mais: () => estado.canvas.zoom(1.25), menos: () => estado.canvas.zoom(0.8), centro: () => estado.canvas.centralizar(), ajustar: () => estado.canvas.ajustar() })[z.dataset.zoom]();
  });
}
function menuExportar(m, ancora) {
  const ed = editando();
  abrirMenu(ancora, [
    estado.canvas && { rotulo: "Exportar imagem (PNG)", icone: "i-imagem", acao: async () => { const b = await estado.canvas.exportarPNG(); if (b) baixarArquivo(`mapa-${m.id}.png`, b); } },
    estado.canvas && { rotulo: "Exportar desenho (SVG)", icone: "i-grafo", acao: () => { const s = estado.canvas.exportarSVG(); if (s) baixarArquivo(`mapa-${m.id}.svg`, s.texto, "image/svg+xml"); } },
    { rotulo: "Exportar roteiro (Markdown)", icone: "i-documento", acao: () => baixarArquivo(`mapa-${m.id}.md`, mapaParaMarkdown(m, nosDe(m.id)), "text/markdown;charset=utf-8") },
    { rotulo: "Exportar JSON", icone: "i-download", acao: () => baixarArquivo(`mapa-${m.id}.json`, mapaParaJSON(m, nosDe(m.id)), "application/json") },
    ed && { rotulo: "Editar nome, ícone e cor", icone: "i-lapis", acao: () => editarMapa(m) },
    ed && { rotulo: "Duplicar mapa", icone: "i-duplicar", acao: () => duplicarMapa(m) },
    podeUsarPainel() && { rotulo: "Salvar como modelo de mapa", icone: "i-grade", acao: () => painel.salvarMapaComoModelo(m, nosDe(m.id)) },
    podeExcluir() && { rotulo: "Excluir mapa", icone: "i-lixeira", perigo: true, acao: () => excluirMapa(m) }
  ]);
}
async function reorganizar(m) {
  const tinhaLocal = limparPosicoesLocais(m.id);
  /* Limpa posições antigas que ainda estejam na nuvem (legado), sem afetar o conteúdo. */
  const comPosNuvem = nosDe(m.id).filter((n) => n.pos);
  if (!tinhaLocal && !comPosNuvem.length) {
    mostrarAviso("O mapa já está no layout automático.");
    estado.canvas && estado.canvas.ajustar();
    return;
  }
  if (comPosNuvem.length && podeEditar()) {
    await salvarNos(m.id, comPosNuvem.map((n) => ({ ...n, pos: null })), { aviso: "Mapa reorganizado neste computador." });
  } else {
    mostrarAviso("Mapa reorganizado neste computador.");
  }
  redesenhar();
  requestAnimationFrame(() => requestAnimationFrame(() => estado.canvas && estado.canvas.ajustar()));
}

/* ---------- Lista em árvore (outline): padrão no celular e para leitores de tela ---------- */
function desenharOutline(m, idx, rec, marcados) {
  const caixa = $("#outline");
  if (!idx.raiz) { caixa.innerHTML = `<p class="apoio">Mapa vazio.</p>`; return; }
  const item = (n, nivel) => {
    const f = idx.filhos.get(n.id) || [];
    const aberto = !rec.has(n.id);
    const t = TIPOS[n.tipo];
    return `<li role="treeitem" data-id="${escapar(n.id)}" aria-level="${nivel}"${f.length ? ` aria-expanded="${aberto}"` : ""} aria-selected="${estado.selecionado === n.id}" tabindex="-1"
      class="${marcados.has(n.id) ? "marcado" : ""}">
      <div class="linha tom-${t.cor}">
        ${f.length ? `<span class="alternar" data-alternar="${escapar(n.id)}" aria-hidden="true">${svg(aberto ? "i-chevron-baixo" : "i-chevron-direita")}</span>` : `<span class="alternar alternar-vazio"></span>`}
        <span class="selo tom-${t.cor}">${svg(t.icone)}${escapar(t.nome)}</span>
        <span class="titulo">${escapar(n.titulo)}</span>
        ${revisaoVencida(n) ? `<span class="selo selo-amarelo" title="Sem revisão há mais de 90 dias">revisar</span>` : ""}
        ${f.length && !aberto ? `<span class="apoio">+${f.length}</span>` : ""}
      </div>
      ${f.length && aberto ? `<ul role="group">${f.map((x) => item(x, nivel + 1)).join("")}</ul>` : ""}
    </li>`;
  };
  const focoAntes = document.activeElement && caixa.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  caixa.innerHTML = `<ul role="tree" aria-label="Mapa ${escapar(m.nome)} em lista">${item(idx.raiz, 1)}</ul>`;
  const alvoTab = caixa.querySelector(`[data-id="${CSS.escape(focoAntes || estado.selecionado || idx.raiz.id)}"]`) || caixa.querySelector("[role=treeitem]");
  if (alvoTab) alvoTab.tabIndex = 0;
  if (focoAntes) focarOutline(focoAntes);
  if (!caixa.dataset.ligado) {
    caixa.dataset.ligado = "1";
    caixa.addEventListener("click", (e) => {
      const li = e.target.closest("[role=treeitem]");
      if (!li) return;
      const m2 = mapaPorId(estado.rota.mapaId);
      if (e.target.closest("[data-alternar]")) { alternar(m2, li.dataset.id); return; }
      selecionar(m2, li.dataset.id);
    });
    caixa.addEventListener("pointerover", (e) => {
      const linha = e.target.closest(".linha");
      const li = linha && linha.closest("[role=treeitem]");
      if (li) apontar(mapaPorId(estado.rota.mapaId), li.dataset.id);
    });
    caixa.addEventListener("pointerleave", () => apontar(mapaPorId(estado.rota.mapaId), null));
    caixa.addEventListener("keydown", (e) => {
      const li = e.target.closest("[role=treeitem]");
      if (!li) return;
      const m2 = mapaPorId(estado.rota.mapaId);
      const id = li.dataset.id;
      if (teclaEdicao(m2, e, id)) { e.preventDefault(); return; }
      const todos = $$("[role=treeitem]", caixa);
      const i = todos.indexOf(li);
      const idx2 = indexar(nosDe(m2.id));
      if (e.key === "ArrowDown") { e.preventDefault(); todos[i + 1] && focarOutline(todos[i + 1].dataset.id); }
      else if (e.key === "ArrowUp") { e.preventDefault(); todos[i - 1] && focarOutline(todos[i - 1].dataset.id); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (li.getAttribute("aria-expanded") === "false") alternar(m2, id); else { const f = (idx2.filhos.get(id) || [])[0]; if (f) focarOutline(f.id); } }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (li.getAttribute("aria-expanded") === "true") alternar(m2, id); else { const p = idx2.paiDe.get(id); if (p) focarOutline(p); } }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selecionar(m2, id); }
      else if (e.key === "Home") { e.preventDefault(); focarOutline(todos[0].dataset.id); }
      else if (e.key === "End") { e.preventDefault(); focarOutline(todos[todos.length - 1].dataset.id); }
    });
  }
}
function focarOutline(id) {
  const caixa = $("#outline");
  if (!caixa) return;
  const li = caixa.querySelector(`[role=treeitem][data-id="${CSS.escape(id)}"]`);
  if (!li) return;
  $$("[role=treeitem]", caixa).forEach((x) => { x.tabIndex = -1; });
  li.tabIndex = 0;
  li.focus();
}

/* ---------- Painel lateral de detalhes ---------- */
function htmlCampos(no) {
  const linhas = camposComValor(no).map(({ def, valor: v, texto, opcao }) => {
    let valor;
    if (def.tipo === "lista") valor = `<ol class="passos">${v.map((p, i) => `<li><label class="check"><input type="checkbox" data-passo="${i}"><span>${escapar(p)}</span></label></li>`).join("")}</ol>`;
    else if (def.tipo === "url") valor = `<a href="${escapar(v)}"${/^https?:/.test(v) ? ' target="_blank" rel="noopener"' : ""}>${escapar(v)}</a>`;
    else if (def.id === "email" && /^[^\s@]+@[^\s@]+$/.test(v)) valor = `<a href="mailto:${escapar(v)}">${escapar(v)}</a>`;
    else if (def.tipo === "escolha") valor = opcao && opcao.cor ? `<span class="selo tom-${opcao.cor}">${escapar(texto)}</span>` : escapar(texto) + (opcao ? "" : ' <span class="apoio" title="Este valor não está mais na lista de opções">(fora da lista)</span>');
    else if (def.tipo === "area") valor = md(v);
    else valor = escapar(v);
    return `<div class="campo-detalhe${def.tipo === "lista" || def.tipo === "area" ? " largo" : ""}"><dt>${escapar(def.rotulo)}</dt><dd>${valor}</dd></div>`;
  }).join("");
  return linhas ? `<dl class="campos-detalhe">${linhas}</dl>` : "";
}
function desenharPainel(m, idx) {
  const painel = $("#painel");
  const idAtivo = (estado.apontado && idx.porId.has(estado.apontado) ? estado.apontado : null)
    || (estado.selecionado && idx.porId.has(estado.selecionado) ? estado.selecionado : null);
  const no = idAtivo && idx.porId.get(idAtivo);
  const previa = !!no && idAtivo !== estado.selecionado;
  const area = document.querySelector(".area-mapa");
  area.classList.toggle("com-painel", !!no);
  painel.classList.toggle("flutuante", previa);
  if (!no) { painel.hidden = true; painel.innerHTML = ""; return; }
  painel.hidden = false;
  painel.tabIndex = -1;
  const t = TIPOS[no.tipo];
  const ed = editando();
  const caminho = caminhoAteRaiz(idx, no.id).slice(1).reverse().map((id) => idx.porId.get(id));
  const filhos = idx.filhos.get(no.id) || [];
  const usos = estado.usos.get(m.id) || [];
  const usosAqui = no.tipo === "sintoma" ? usos.filter((u) => u.sintomaId === no.id) : [];
  const resolveuAqui = usos.filter((u) => u.resultado === "resolvido" && u.resolvidoNo === no.id).length;
  const vencido = revisaoVencida(no);
  const ligacoes = (no.ligacoes || []).map((l) => ({ ...l, alvo: idx.porId.get(l.para) })).filter((l) => l.alvo);
  const chegam = [...idx.porId.values()].filter((n) => (n.ligacoes || []).some((l) => l.para === no.id));
  painel.innerHTML = `<div class="painel-topo tom-${t.cor}">
      <span class="selo tom-${t.cor}">${svg(t.icone)}${escapar(t.nome)}</span>
      <span class="painel-topo-fim">
        ${previa ? `<span class="apoio painel-dica">Clique no bloco para fixar</span>` : ""}
        <button type="button" class="btn-icone" data-painel="fechar" aria-label="Fechar detalhes">${svg("i-fechar")}</button>
      </span>
    </div>
    ${caminho.length ? `<nav class="trilha-no" aria-label="Caminho">${caminho.map((n) => `<a href="#m/${escapar(m.id)}/n/${escapar(n.id)}" data-ir="${escapar(n.id)}">${escapar(n.titulo)}</a>`).join(" › ")}</nav>` : ""}
    <h3 class="painel-titulo">${escapar(no.titulo)}</h3>
    ${(no.tipo === "teste" || no.tipo === "contato") ? `<p class="revisao ${vencido ? "vencida" : ""}">${svg(vencido ? "i-alerta" : "i-check")}${no.revisadoEm ? `Revisado em ${formatarData(no.revisadoEm)}${vencido ? ": há mais de 90 dias, confira se ainda vale." : ""}` : "Nunca revisado: confira se ainda vale."}</p>` : ""}
    ${no.descricao ? `<div class="md">${md(no.descricao)}</div>` : ""}
    ${htmlCampos(no)}
    ${no.tipo === "contato" ? `<button type="button" class="btn btn-secundario btn-mini" data-painel="copiar-contato">${svg("i-copiar")}Copiar contato</button>` : ""}
    ${ligacoes.length ? `<div class="bloco-painel"><h4 class="rotulo">Se der… vá para</h4><ul class="ligacoes-painel">${ligacoes.map((l) =>
      `<li><a href="#m/${escapar(m.id)}/n/${escapar(l.para)}" data-ir="${escapar(l.para)}">${l.rotulo ? `<strong>${escapar(l.rotulo)}</strong> → ` : "→ "}<span class="selo tom-${TIPOS[l.alvo.tipo].cor}">${escapar(TIPOS[l.alvo.tipo].nome)}</span> ${escapar(l.alvo.titulo)}</a></li>`).join("")}</ul></div>` : ""}
    ${chegam.length ? `<div class="bloco-painel"><h4 class="rotulo">Chegam aqui</h4><ul class="ligacoes-painel">${chegam.map((n) => `<li><a href="#m/${escapar(m.id)}/n/${escapar(n.id)}" data-ir="${escapar(n.id)}">${escapar(n.titulo)}</a></li>`).join("")}</ul></div>` : ""}
    ${filhos.length ? `<div class="bloco-painel"><h4 class="rotulo">Abaixo (${filhos.length})</h4><ul class="filhos-painel">${filhos.map((f) =>
      `<li><a href="#m/${escapar(m.id)}/n/${escapar(f.id)}" data-ir="${escapar(f.id)}"><span class="selo tom-${TIPOS[f.tipo].cor}">${svg(TIPOS[f.tipo].icone)}${escapar(TIPOS[f.tipo].nome)}</span> ${escapar(f.titulo)}</a></li>`).join("")}</ul></div>` : ""}
    ${no.tipo === "sintoma" ? `<div class="bloco-painel"><button type="button" class="btn" data-painel="roteiro">${svg("i-roteiro")}Iniciar roteiro deste sintoma</button>
      ${usosAqui.length ? `<p class="apoio">Usado ${usosAqui.length} ${usosAqui.length === 1 ? "vez" : "vezes"}: ${usosAqui.filter((u) => u.resultado === "resolvido").length} resolvido(s), ${usosAqui.filter((u) => u.resultado !== "resolvido").length} escalado(s).</p>` : ""}</div>` : ""}
    ${no.tipo === "teste" && resolveuAqui ? `<p class="apoio estatistica">${svg("i-trofeu")}Resolveu o problema ${resolveuAqui} ${resolveuAqui === 1 ? "vez" : "vezes"} em atendimentos registrados.</p>` : ""}
    ${no.tags.length ? `<p class="tags-no">${no.tags.map((x) => `<span class="selo">${escapar(x)}</span>`).join("")}</p>` : ""}
    ${no.atualizadoEm ? `<p class="apoio rodape-no">Atualizado em ${formatarData(no.atualizadoEm, true)}${no.atualizadoPor ? " por " + escapar(nomeDe(no.atualizadoPor)) : ""}</p>` : ""}
    ${ed ? `<div class="acoes-painel">
      <button type="button" class="btn btn-mini" data-painel="editar">${svg("i-lapis")}Editar</button>
      <button type="button" class="btn btn-secundario btn-mini" data-painel="filho">${svg("i-mais")}Filho</button>
      ${no.paiId ? `<button type="button" class="btn btn-secundario btn-mini" data-painel="irmao">${svg("i-mais")}Irmão</button>
      <button type="button" class="btn-icone" data-painel="subir" aria-label="Subir entre os irmãos">${svg("i-seta-cima")}</button>
      <button type="button" class="btn-icone" data-painel="descer" aria-label="Descer entre os irmãos">${svg("i-seta-baixo")}</button>` : ""}
      ${(no.tipo === "teste" || no.tipo === "contato") ? `<button type="button" class="btn btn-secundario btn-mini" data-painel="revisado">${svg("i-check")}Revisado hoje</button>` : ""}
      ${no.paiId && podeExcluir() ? `<button type="button" class="btn btn-perigo btn-mini" data-painel="excluir">${svg("i-lixeira")}Excluir</button>` : ""}
    </div>` : ""}`;
  if (!painel.dataset.ligado) {
    painel.dataset.ligado = "1";
    painel.addEventListener("pointerleave", () => {
      if (estado.apontado) { estado.apontado = null; const m2 = mapaPorId(estado.rota.mapaId); if (m2) desenharPainel(m2, indexar(nosDe(m2.id))); }
    });
    painel.addEventListener("click", (e) => {
      const m2 = mapaPorId(estado.rota.mapaId);
      const id = estado.apontado || estado.selecionado;
      const irPara = e.target.closest("[data-ir]");
      if (irPara) {
        e.preventDefault();
        const idx2 = indexar(nosDe(m2.id));
        expandirAte(m2, idx2, irPara.dataset.ir);
        selecionar(m2, irPara.dataset.ir);
        requestAnimationFrame(() => estado.canvas ? estado.canvas.focar(irPara.dataset.ir) : focarOutline(irPara.dataset.ir));
        return;
      }
      const b = e.target.closest("[data-painel]");
      if (!b || !m2 || !id) return;
      const a = b.dataset.painel;
      if (a === "fechar") { estado.selecionado = null; estado.apontado = null; trocarHash(m2, null); return redesenhar(); }
      if (a === "roteiro") return ir(`#m/${m2.id}/roteiro/${id}`);
      if (a === "copiar-contato") { const no2 = indexar(nosDe(m2.id)).porId.get(id); copiarTexto(textoContato(no2)).then((ok) => mostrarAviso(ok ? "Contato copiado." : "Não foi possível copiar.")); return; }
      if (a === "editar") return editarNo(m2, id);
      if (a === "filho") return adicionarNo(m2, id, "filho");
      if (a === "irmao") return adicionarNo(m2, id, "irmao");
      if (a === "subir") return reordenar(m2, id, -1);
      if (a === "descer") return reordenar(m2, id, 1);
      if (a === "excluir") return excluirNo(m2, id);
      if (a === "revisado") { const no2 = indexar(nosDe(m2.id)).porId.get(id); return salvarNos(m2.id, [{ ...no2, revisadoEm: new Date().toISOString() }], { aviso: "Marcado como revisado hoje." }); }
    });
  }
}

/* ---------- Edição de nós ---------- */
function teclaEdicao(m, e, id) {
  if (!editando() || e.altKey && !["ArrowUp", "ArrowDown"].includes(e.key)) return false;
  if (e.ctrlKey || e.metaKey) return false;
  if (e.key === "Tab" && !e.shiftKey) { adicionarNo(m, id, "filho"); return true; }
  if (e.key === "Enter") { const no = indexar(nosDe(m.id)).porId.get(id); if (no && no.paiId) adicionarNo(m, id, "irmao"); else selecionar(m, id); return true; }
  if (e.key === "F2") { editarNo(m, id); return true; }
  if (e.key === "Delete" && podeExcluir()) { excluirNo(m, id); return true; }
  if (e.altKey && e.key === "ArrowUp") { reordenar(m, id, -1); return true; }
  if (e.altKey && e.key === "ArrowDown") { reordenar(m, id, 1); return true; }
  return false;
}
async function adicionarNo(m, refId, como) {
  const idx = indexar(nosDe(m.id));
  const ref = idx.porId.get(refId);
  if (!ref) return;
  const paiId = como === "filho" ? ref.id : idx.paiDe.get(ref.id);
  if (!paiId) return;
  const pai = idx.porId.get(paiId);
  const irmaos = idx.filhos.get(paiId) || [];
  let ordem;
  if (como === "filho") ordem = irmaos.length ? irmaos[irmaos.length - 1].ordem + 1 : 0;
  else { const i = irmaos.findIndex((n) => n.id === ref.id); const prox = irmaos[i + 1]; ordem = prox ? (ref.ordem + prox.ordem) / 2 : ref.ordem + 1; }
  const tipo = como === "filho" ? FILHO_PADRAO[pai.tipo] : (ref.tipo === "sistema" ? "sintoma" : ref.tipo);
  const novo = normalizarNo({ id: idCurto(), tipo, titulo: `Novo ${TIPOS[tipo].nome.toLowerCase()}`, paiId, ordem, descricao: "" });
  const ops = opsNos(m.id, [novo]);
  if (como === "filho" && recolhidosDe(m, idx).has(paiId)) ops.push(...opsNos(m.id, [{ ...pai, recolhido: false }]));
  const local = estado.recolhidos[m.id]; if (local) { delete local[paiId]; gravarJSON(CHAVE_RECOLHIDOS, estado.recolhidos); }
  if (!(await gravar([...ops, opsTocarMapa(m.id)]))) return;
  estado.selecionado = novo.id;
  trocarHash(m, novo.id);
  editarNo(m, novo.id, { novo: true, rascunho: novo });
}
/* Nome do controle no formulário: nativos em no.campos, personalizados em no.extras */
const chaveCampo = (def) => (def.personalizado ? `extra-${def.id}` : `campo-${def.id}`);
function htmlCampoTipo(def, valor) {
  const nome = chaveCampo(def);
  const rotulo = `<span class="rotulo">${escapar(def.rotulo)}${def.obrigatorio ? ' <span class="obrigatorio" aria-hidden="true">*</span>' : ""}</span>`;
  const req = def.obrigatorio ? " required" : "";
  if (def.tipo === "escolha") {
    /* Opções arquivadas somem das novas escolhas, mas continuam aparecendo no nó que já as usa; valor fora da lista também */
    const atual = acharOpcao(def, valor);
    const opcoes = def.opcoes.filter((o) => !o.arquivada || (atual && atual.id === o.id));
    const fora = valor && !atual ? `<option value="${escapar(valor)}" selected>${escapar(valor)} (fora da lista)</option>` : "";
    return `<label class="campo">${rotulo}<select name="${nome}"${req}><option value="">—</option>${opcoes.map((o) => `<option value="${escapar(o.id)}"${atual && atual.id === o.id ? " selected" : ""}>${escapar(o.rotulo)}${o.arquivada ? " (arquivada)" : ""}</option>`).join("")}${fora}</select></label>`;
  }
  if (def.tipo === "lista") return `<label class="campo">${rotulo}<textarea name="${nome}" rows="4" placeholder="${escapar(def.dica)}"${req}>${escapar((valor || []).join("\n"))}</textarea><span class="ajuda">${escapar(def.dica || "Um item por linha")}</span></label>`;
  if (def.tipo === "area") return `<label class="campo">${rotulo}<textarea name="${nome}" rows="3" maxlength="${LIMITES.campo}" placeholder="${escapar(def.dica || "")}"${req}>${escapar(valor || "")}</textarea></label>`;
  return `<label class="campo">${rotulo}<input name="${nome}" maxlength="${def.tipo === "url" ? 500 : LIMITES.campo}" value="${escapar(valor || "")}" placeholder="${escapar(def.dica || "")}"${req}></label>`;
}
function editarNo(m, id, { novo = false, rascunho = null } = {}) {
  const idx = indexar(nosDe(m.id));
  const no = idx.porId.get(id) || rascunho;
  if (!no) return;
  const outros = [...idx.porId.values()].filter((n) => n.id !== no.id).sort((a, b) => ORDEM_TIPOS.indexOf(a.tipo) - ORDEM_TIPOS.indexOf(b.tipo) || a.titulo.localeCompare(b.titulo, "pt-BR"));
  const opcoesAlvo = (atual) => outros.map((n) => `<option value="${escapar(n.id)}"${n.id === atual ? " selected" : ""}>${escapar(TIPOS[n.tipo].nome)}: ${escapar(n.titulo)}</option>`).join("");
  const linhaLigacao = (l = { para: "", rotulo: "" }) => `<div class="linha-ligacao"><input name="lig-rotulo" maxlength="${LIMITES.rotulo}" placeholder="Se der… (ex.: Geral)" value="${escapar(l.rotulo)}" aria-label="Condição">
    <select name="lig-para" aria-label="Vá para o nó"><option value="">Vá para…</option>${opcoesAlvo(l.para)}</select>
    <button type="button" class="btn-icone" data-remover-ligacao aria-label="Remover ligação">${svg("i-fechar")}</button></div>`;
  const ehRaiz = !no.paiId;
  const d = criarDialogo({
    titulo: novo ? "Novo nó" : "Editar nó", largo: true,
    corpo: `<div class="campos-linha">
        <label class="campo"><span class="rotulo">Tipo</span><select name="tipo"${ehRaiz ? " disabled" : ""}>${ORDEM_TIPOS.filter((t) => ehRaiz || t !== "sistema").map((t) => `<option value="${t}"${t === no.tipo ? " selected" : ""}>${escapar(TIPOS[t].nome)}</option>`).join("")}</select></label>
        <label class="campo campo-largo"><span class="rotulo">Título</span><input name="titulo" maxlength="${LIMITES.titulo}" required value="${escapar(no.titulo)}"></label>
      </div>
      <p class="apoio ajuda-tipo"></p>
      <label class="campo"><span class="rotulo">Descrição (Markdown)</span><textarea name="descricao" rows="5" maxlength="${LIMITES.descricao}">${escapar(no.descricao)}</textarea></label>
      <div class="campos-tipo"></div>
      <fieldset class="ligacoes-form"><legend class="rotulo">Ligações extras (“se der X → vá para o nó Y”)</legend>
        <div class="lista-ligacoes">${(no.ligacoes || []).map(linhaLigacao).join("")}</div>
        <button type="button" class="btn btn-secundario btn-mini" data-nova-ligacao>${svg("i-mais")}Ligação</button></fieldset>
      <label class="campo"><span class="rotulo">Etiquetas</span><input name="tags" value="${escapar(no.tags.join(", "))}" placeholder="separe por vírgula"></label>
      <label class="check revisado-check"><input type="checkbox" name="revisado"><span>Conferi agora: marcar como revisado hoje</span></label>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>${novo ? "Manter assim" : "Cancelar"}</button><button type="submit" class="btn">Salvar</button></div>`
  });
  const form = d.querySelector("form");
  const camposTipo = form.querySelector(".campos-tipo");
  /* Valores por chave do controle (campo-x / extra-x): trocar o tipo não perde o que foi digitado */
  const valores = {};
  Object.entries(no.campos || {}).forEach(([k, v]) => { valores[`campo-${k}`] = v; });
  Object.entries(no.extras || {}).forEach(([k, v]) => { valores[`extra-${k}`] = v; });
  const visiveis = (t) => (CAMPOS[t] || []).filter((def) => !def.oculto);
  const lerCamposTela = () => {
    visiveis(form.tipo.value).forEach((def) => {
      const el = form.elements[chaveCampo(def)];
      if (el) valores[chaveCampo(def)] = def.tipo === "lista" ? el.value.split("\n") : el.value;
    });
  };
  const montarCampos = () => {
    const t = form.tipo.value;
    camposTipo.innerHTML = visiveis(t).length ? `<div class="grade-campos">${visiveis(t).map((def) => htmlCampoTipo(def, valores[chaveCampo(def)])).join("")}</div>` : "";
    form.querySelector(".ajuda-tipo").textContent = TIPOS[t].ajuda;
    form.querySelector(".revisado-check").hidden = !(t === "teste" || t === "contato");
  };
  montarCampos();
  form.tipo.addEventListener("change", () => { lerCamposTela(); montarCampos(); });
  form.tipo.addEventListener("focus", lerCamposTela);
  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-nova-ligacao]")) {
      if (form.querySelectorAll(".linha-ligacao").length >= LIMITES.ligacoes) return;
      form.querySelector(".lista-ligacoes").insertAdjacentHTML("beforeend", linhaLigacao());
      form.querySelector(".linha-ligacao:last-child input").focus();
    }
    const rem = e.target.closest("[data-remover-ligacao]");
    if (rem) rem.closest(".linha-ligacao").remove();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titulo = form.titulo.value.trim();
    if (!titulo) { form.querySelector(".form-erro").textContent = "Informe o título."; return; }
    lerCamposTela();
    const tipo = ehRaiz ? no.tipo : form.tipo.value;
    const vazio = (v) => !String(Array.isArray(v) ? v.join("") : v || "").trim();
    const faltando = visiveis(tipo).find((c) => c.obrigatorio && vazio(valores[chaveCampo(c)]));
    if (faltando) { form.querySelector(".form-erro").textContent = `Preencha "${faltando.rotulo}" (obrigatório).`; form.elements[chaveCampo(faltando)]?.focus(); return; }
    const urls = visiveis(tipo).filter((c) => c.tipo === "url" && !vazio(valores[chaveCampo(c)]));
    const ruim = urls.find((c) => !urlSegura(valores[chaveCampo(c)]));
    if (ruim) { form.querySelector(".form-erro").textContent = `"${ruim.rotulo}": use https://…, caderno.html?c=slug ou aprender.html#aula.`; return; }
    const campos = {}, extras = {};
    Object.entries(valores).forEach(([k, v]) => { if (k.startsWith("campo-")) campos[k.slice(6)] = v; else if (k.startsWith("extra-")) extras[k.slice(6)] = v; });
    const ligacoes = [...form.querySelectorAll(".linha-ligacao")].map((l) => ({ rotulo: l.querySelector('[name="lig-rotulo"]').value.trim(), para: l.querySelector('[name="lig-para"]').value }))
      .filter((l) => l.para);
    const atualizado = normalizarNo({
      ...no, tipo, titulo, descricao: form.descricao.value, campos, extras, ligacoes,
      tags: form.tags.value.split(",").map((t) => t.trim()).filter(Boolean),
      revisadoEm: form.revisado.checked ? new Date().toISOString() : no.revisadoEm
    });
    form.querySelector('[type="submit"]').disabled = true;
    if (await salvarNos(m.id, [atualizado], { aviso: "Nó salvo.", auditoria: novo ? null : { acao: "editar", resumo: `${m.nome} › ${titulo}`, detalhes: no.id } })) d.close();
    else form.querySelector('[type="submit"]').disabled = false;
  });
  d.addEventListener("close", () => requestAnimationFrame(() => estado.canvas ? estado.canvas.focarNo(no.id) : focarOutline(no.id)));
  d.showModal();
  form.titulo.focus();
  form.titulo.select();
}
async function excluirNo(m, id) {
  const idx = indexar(nosDe(m.id));
  const no = idx.porId.get(id);
  if (!no || !no.paiId) { mostrarAviso("O nó do sistema (raiz) não pode ser excluído: exclua o mapa."); return; }
  const sub = descendentes(idx, id);
  if (sub.length && !(await confirmar(`"${no.titulo}" e ${sub.length === 1 ? "o nó abaixo dele vão" : `os ${sub.length} nós abaixo dele vão`} para a lixeira.`, { titulo: "Excluir ramo", botao: "Excluir", perigo: true }))) return;
  const pai = idx.paiDe.get(id);
  if (await moverParaLixeira("no", m, [no, ...sub], no.titulo)) {
    estado.selecionado = pai || null;
    trocarHash(m, estado.selecionado);
    redesenhar();
    requestAnimationFrame(() => pai && (estado.canvas ? estado.canvas.focarNo(pai) : focarOutline(pai)));
  }
}
async function reordenar(m, id, direcao) {
  const idx = indexar(nosDe(m.id));
  const pai = idx.paiDe.get(id);
  if (!pai) return;
  const irmaos = [...idx.filhos.get(pai)];
  const i = irmaos.findIndex((n) => n.id === id), j = i + direcao;
  if (j < 0 || j >= irmaos.length) return;
  [irmaos[i], irmaos[j]] = [irmaos[j], irmaos[i]];
  const mudados = irmaos.map((n, k) => ({ ...n, ordem: k })).filter((n, k) => idx.porId.get(n.id).ordem !== k);
  if (await salvarNos(m.id, mudados)) requestAnimationFrame(() => estado.canvas ? estado.canvas.focarNo(id) : focarOutline(id));
}
async function reparentar(m, id, novoPai) {
  const idx = indexar(nosDe(m.id));
  const no = idx.porId.get(id);
  if (!no || !no.paiId || id === novoPai || caminhoAteRaiz(idx, novoPai).includes(id)) { redesenhar(); return; }
  if (idx.paiDe.get(id) === novoPai) { redesenhar(); return; }
  const irmaos = idx.filhos.get(novoPai) || [];
  gravarPosicaoLocal(m.id, id, null);
  const ok = await salvarNos(m.id, [{ ...no, paiId: novoPai, ordem: irmaos.length ? irmaos[irmaos.length - 1].ordem + 1 : 0, pos: null }],
    { aviso: `"${no.titulo}" agora fica abaixo de "${idx.porId.get(novoPai).titulo}".` });
  if (!ok) redesenhar();
}

/* ---------- Escolher sintoma para o roteiro ---------- */
function escolherSintoma(m, ancora) {
  const sintomas = nosDe(m.id).filter((n) => n.tipo === "sintoma").sort(porOrdem);
  if (!sintomas.length) { mostrarAviso("Este mapa ainda não tem sintomas."); return; }
  if (estado.selecionado && sintomas.some((s) => s.id === estado.selecionado)) return ir(`#m/${m.id}/roteiro/${estado.selecionado}`);
  if (sintomas.length === 1) return ir(`#m/${m.id}/roteiro/${sintomas[0].id}`);
  abrirMenu(ancora, sintomas.map((s) => ({ rotulo: s.titulo, icone: "i-alerta", acao: () => ir(`#m/${m.id}/roteiro/${s.id}`) })));
}

/* ============================================================
 *  Modo roteiro (passo a passo)
 * ============================================================ */
function testesDoSintoma(idx, sintomaId) { return descendentes(idx, sintomaId).filter((n) => n.tipo === "teste").map((n) => n.id); }
function desenharRoteiro(m) {
  const idx = indexar(nosDe(m.id));
  const sintoma = idx.porId.get(estado.rota.sintomaId);
  const raiz = $("#conteudo");
  telaMontada = "roteiro";
  if (!sintoma) { raiz.innerHTML = `<div class="vazio"><p>Sintoma não encontrado neste mapa.</p><a class="btn" href="#m/${escapar(m.id)}">Voltar ao mapa</a></div>`; return; }
  if (!estado.roteiro) estado.roteiro = { mapaId: m.id, sintomaId: sintoma.id, fila: testesDoSintoma(idx, sintoma.id), i: 0, passos: [], desfecho: null, contatoId: null, resolvidoNo: null, registrado: false, inicio: new Date() };
  const r = estado.roteiro;
  r.fila = r.fila.filter((id) => idx.porId.has(id));
  const atual = !r.desfecho && r.fila[r.i] ? idx.porId.get(r.fila[r.i]) : null;
  const feitos = r.passos.length;
  const html = [];
  html.push(`<section class="tela-roteiro">
    <div class="roteiro-topo"><a class="btn btn-secundario btn-mini" href="#m/${escapar(m.id)}/n/${escapar(sintoma.id)}">${svg("i-voltar")}Voltar ao mapa</a>
      <div><p class="rotulo">Roteiro · ${escapar(m.nome)}</p><h2>${escapar(sintoma.titulo)}</h2></div>
      <button type="button" class="btn btn-secundario btn-mini" data-roteiro="recomecar">${svg("i-desfazer")}Recomeçar</button></div>`);
  if (sintoma.descricao) html.push(`<div class="md roteiro-sintoma">${md(sintoma.descricao)}</div>`);
  html.push(`<ol class="roteiro-progresso" aria-label="Progresso">${r.fila.map((id, k) => {
    const p = r.passos.find((x) => x.id === id);
    const cls = p ? `feito ${p.resultado}` : (atual && atual.id === id ? "atual" : "");
    return `<li class="${cls}" title="${escapar(idx.porId.get(id).titulo)}"><span class="sr-only">${escapar(idx.porId.get(id).titulo)}${p ? ": " + p.resultado : ""}</span></li>`;
  }).join("")}</ol>`);
  if (atual) {
    const ligs = (atual.ligacoes || []).map((l) => ({ ...l, alvo: idx.porId.get(l.para) })).filter((l) => l.alvo);
    html.push(`<article class="cartao-teste" aria-live="polite">
      <p class="rotulo">Teste ${r.i + 1} de ${r.fila.length}${atual.campos.tempo ? ` · ${escapar(atual.campos.tempo)}` : ""}</p>
      <h3>${escapar(atual.titulo)}</h3>
      ${atual.descricao ? `<div class="md">${md(atual.descricao)}</div>` : ""}
      ${atual.campos.passos ? `<ol class="passos">${atual.campos.passos.map((p) => `<li><label class="check"><input type="checkbox"><span>${escapar(p)}</span></label></li>`).join("")}</ol>` : ""}
      ${atual.campos.esperado ? `<div class="esperado"><strong>O que significa:</strong> ${md(atual.campos.esperado)}</div>` : ""}
      ${ligs.length ? `<div class="desvios"><p class="rotulo">Se der…</p>${ligs.map((l) => `<button type="button" class="btn btn-secundario btn-mini" data-desvio="${escapar(l.para)}">${escapar(l.rotulo || "Ir")} → ${escapar(TIPOS[l.alvo.tipo].nome)}: ${escapar(l.alvo.titulo)}</button>`).join("")}</div>` : ""}
      <div class="roteiro-botoes">
        <button type="button" class="btn btn-sucesso" data-roteiro="resolveu">${svg("i-check")}Resolveu</button>
        <button type="button" class="btn btn-secundario" data-roteiro="nao">${svg("i-fechar")}Não resolveu</button>
        <button type="button" class="btn btn-secundario" data-roteiro="pular">${svg("i-chevron-direita")}Próximo</button>
        <button type="button" class="btn btn-alerta" data-roteiro="escalar">${svg("i-telefone")}Escalar</button>
      </div>
    </article>`);
  } else {
    if (!r.desfecho) {
      html.push(`<article class="cartao-teste"><h3>${r.fila.length ? "Os testes acabaram e o problema continua." : "Este sintoma ainda não tem testes."}</h3>
        <p class="apoio">Escale para quem resolve, com o resumo do que já foi feito.</p>
        <div class="roteiro-botoes"><button type="button" class="btn btn-alerta" data-roteiro="escalar">${svg("i-telefone")}Escalar</button></div></article>`);
    } else {
      const contato = r.contatoId && idx.porId.get(r.contatoId);
      const resolvidoNo = r.resolvidoNo && idx.porId.get(r.resolvidoNo);
      const solucoes = resolvidoNo ? descendentes(idx, resolvidoNo.id).filter((n) => n.tipo === "solucao") : [];
      html.push(`<article class="cartao-teste desfecho ${r.desfecho}" aria-live="polite">
        ${r.desfecho === "resolvido"
          ? `<h3>${svg("i-sucesso")}Resolvido${resolvidoNo ? ` no teste “${escapar(resolvidoNo.titulo)}”` : ""}</h3>
             ${solucoes.map((s) => `<div class="solucao"><p class="rotulo">${escapar(TIPOS.solucao.nome)}${s.campos.natureza ? " · " + escapar(rotuloOpcao(campoDoTipo("solucao", "natureza"), s.campos.natureza)) : ""}</p><strong>${escapar(s.titulo)}</strong>${s.descricao ? md(s.descricao) : ""}${s.campos.passos ? `<ol>${s.campos.passos.map((p) => `<li>${escapar(p)}</li>`).join("")}</ol>` : ""}</div>`).join("")}`
          : `<h3>${svg("i-telefone")}Escalar para quem resolve</h3>
             ${contato ? `<div class="contato-roteiro"><strong>${escapar(contato.titulo)}</strong>${htmlCampos(contato)}${contato.descricao ? md(contato.descricao) : ""}</div>`
               : `<p class="apoio">Nenhum nó “Quem resolve” encontrado perto deste sintoma. ${podeEditar() ? "Inclua um no mapa." : "Avise quem cuida dos mapas."}</p>`}`}
        <div class="roteiro-botoes">
          <button type="button" class="btn" data-roteiro="copiar">${svg("i-copiar")}Copiar resumo</button>
          ${r.registrado ? `<span class="selo selo-verde">${svg("i-check")}Atendimento registrado</span>` : (estado.api ? `<button type="button" class="btn btn-secundario" data-roteiro="registrar">${svg("i-salvar")}Registrar atendimento</button>` : "")}
          ${r.desfecho === "escalado" && r.fila[r.i] ? `<button type="button" class="btn btn-secundario" data-roteiro="voltar">Voltar aos testes</button>` : ""}
        </div>
        <details class="previa-resumo"><summary>Ver o resumo</summary><pre>${escapar(textoResumo(m, idx))}</pre></details>
      </article>`);
    }
  }
  if (r.passos.length) html.push(`<div class="historico-roteiro"><h3 class="rotulo">Feito até agora</h3><ol>${r.passos.map((p) => `<li><span class="selo ${p.resultado === "resolveu" ? "selo-verde" : p.resultado === "pulado" ? "" : "selo-vermelho"}">${({ resolveu: "Resolveu", "nao-resolveu": "Não resolveu", pulado: "Pulado" })[p.resultado]}</span> ${escapar(p.titulo)}</li>`).join("")}</ol></div>`);
  html.push(`</section>`);
  raiz.innerHTML = html.join("");
  raiz.onclick = (e) => roteiroClique(e, m);
  const foco = raiz.querySelector(".cartao-teste h3");
  if (foco && feitos !== estado.ultimoFocoRoteiro) { estado.ultimoFocoRoteiro = feitos; foco.tabIndex = -1; foco.focus({ preventScroll: true }); }
}
function textoResumo(m, idx) {
  const r = estado.roteiro;
  const desfecho = r.desfecho === "resolvido" ? `Resolvido${r.resolvidoNo ? " no teste: " + idx.porId.get(r.resolvidoNo).titulo : ""}` : "Escalado (não resolvido nos testes)";
  return resumoRoteiro({ mapa: m, sintoma: idx.porId.get(r.sintomaId), passos: r.passos, desfecho, contato: r.contatoId ? idx.porId.get(r.contatoId) : null, quando: r.inicio });
}
function registrarPasso(idx, id, resultado) {
  const r = estado.roteiro;
  r.passos = r.passos.filter((p) => p.id !== id);
  r.passos.push({ id, titulo: idx.porId.get(id).titulo, resultado });
}
async function roteiroClique(e, m) {
  const r = estado.roteiro;
  if (!r || estado.rota.tela !== "roteiro") return;
  const idx = indexar(nosDe(m.id));
  const desvio = e.target.closest("[data-desvio]");
  const atualId = r.fila[r.i];
  if (desvio) {
    const alvo = idx.porId.get(desvio.dataset.desvio);
    if (atualId) registrarPasso(idx, atualId, "nao-resolveu");
    if (alvo.tipo === "teste") {
      const k = r.fila.indexOf(alvo.id);
      if (k >= 0) r.i = k; else { r.fila.splice(r.i + 1, 0, alvo.id); r.i++; }
    } else if (alvo.tipo === "contato") { r.desfecho = "escalado"; r.contatoId = alvo.id; }
    else if (alvo.tipo === "solucao") { r.desfecho = "resolvido"; r.resolvidoNo = atualId; }
    else { r.desfecho = "escalado"; r.contatoId = contatoMaisProximo(idx, alvo.id)?.id || null; }
    return desenharRoteiro(m);
  }
  const b = e.target.closest("[data-roteiro]");
  if (!b) return;
  const a = b.dataset.roteiro;
  if (a === "recomecar") { estado.roteiro = null; estado.ultimoFocoRoteiro = null; return desenharRoteiro(m); }
  if (a === "resolveu") { registrarPasso(idx, atualId, "resolveu"); r.desfecho = "resolvido"; r.resolvidoNo = atualId; }
  if (a === "nao" || a === "pular") { registrarPasso(idx, atualId, a === "nao" ? "nao-resolveu" : "pulado"); r.i++; }
  if (a === "escalar") { r.desfecho = "escalado"; r.contatoId = contatoMaisProximo(idx, atualId || r.sintomaId)?.id || null; }
  if (a === "voltar") { r.desfecho = null; r.contatoId = null; }
  if (a === "copiar") { const ok = await copiarTexto(textoResumo(m, idx)); mostrarAviso(ok ? "Resumo copiado: cole no ticket, e-mail ou Teams." : "Não foi possível copiar: use “Ver o resumo”."); return; }
  if (a === "registrar") return registrarAtendimento(m, idx);
  desenharRoteiro(m);
}
function registrarAtendimento(m, idx) {
  const r = estado.roteiro;
  const salvar = async (por) => {
    const id = `u${Date.now().toString(36)}${idCurto("").slice(0, 6)}`;
    const dados = {
      sintomaId: r.sintomaId, resultado: r.desfecho === "resolvido" ? "resolvido" : (r.contatoId ? "escalado" : "sem-solucao"),
      resolvidoNo: r.resolvidoNo || "", contatoId: r.contatoId || "",
      testes: r.passos.slice(0, 60).map((p) => ({ id: p.id, r: p.resultado })), em: "__AGORA__", por
    };
    try {
      await estado.api.salvarDoc(`mapas/${m.id}/usos/${id}`, dados);
      r.registrado = true;
      mostrarAviso("Atendimento registrado. Obrigado!");
      desenharRoteiro(m);
      return true;
    } catch (e) { console.error(e); mostrarAviso("Não foi possível registrar agora."); return false; }
  };
  if (sessao.email) { salvar(sessao.email); return; }
  const d = criarDialogo({
    titulo: "Registrar atendimento",
    corpo: `<p class="apoio">Fica no histórico do sintoma e mostra quais testes mais resolvem. Nada além do resultado e do seu nome é gravado.</p>
      <label class="campo"><span class="rotulo">Seu nome</span><input name="autor" maxlength="60" required autocomplete="name"></label>
      <p class="form-erro" role="alert"></p>
      <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Registrar</button></div>`
  });
  const form = d.querySelector("form");
  try { form.autor.value = localStorage.getItem(CHAVE_AUTOR) || ""; } catch (e) {}
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = form.autor.value.trim().replace(/@/g, "").slice(0, 60);
    if (!nome) { form.querySelector(".form-erro").textContent = "Informe seu nome."; return; }
    try { localStorage.setItem(CHAVE_AUTOR, nome); } catch (err) {}
    if (await salvar(nome)) d.close();
  });
  d.showModal();
  form.autor.focus();
}

/* ============================================================
 *  Painel de edição (comum/mapas-painel.js): só administradoras
 * ============================================================ */
const painel = iniciarPainel({
  estado, podeUsarPainel, autor, nomeDe, nosDe, mapaPorId, redesenhar, ir, alternarComoVisitante, gravarNos: salvarNos, editarNo,
  api: () => estado.api,
  aplicarConfig: (doc, dados) => aoMudarConfig(doc, dados, true)
});
/* Configuração nova (da nuvem ou recém-salva): aplica e redesenha tudo (mapa, lista, painel lateral, roteiro) */
function aoMudarConfig(doc, dados, local = false) {
  estado.config[doc] = dados || null;
  if (doc === "estrutura") aplicarEstrutura(dados);
  else aplicarModelos(dados);
  /* Nós normalizados de novo: opções renomeadas/novas valem já para os dados em memória */
  estado.nos.forEach((lista, id) => estado.nos.set(id, lista.map(normalizarNo).filter(Boolean)));
  if (estado.rota.tela !== "painel") telaMontada = null;
  painel.aoMudarConfig(doc, local);
  redesenhar();
}

/* ============================================================
 *  Início
 * ============================================================ */
ligarTema();
montarBarraEdicao();
$("#sair-visitante").addEventListener("click", () => alternarComoVisitante(false));
window.addEventListener("beforeunload", (e) => { if (painel.temPendencias()) { e.preventDefault(); e.returnValue = ""; } });
$("#conteudo").addEventListener("click", (e) => { if (telaMontada === "lista") aoClicarLista(e); });
document.addEventListener("tema-mudou", () => redesenhar());
window.addEventListener("hashchange", aoMudarRota);
CELULAR.addEventListener("change", () => { if (!estado.vista) { telaMontada = null; redesenhar(); } });
estado.rota = lerRota();
aoMudarSessao(() => { telaMontada = null; redesenhar(); });
/* Sem nuvem (ou a nuvem recusou a leitura): só o exemplo embutido, em somente leitura */
function usarExemploSemNuvem(texto) {
  estado.api = null;
  estado.ouvintesNos.forEach((parar) => parar());
  estado.ouvintesNos.clear();
  const { mapa, nos } = mapaExemploSCDA();
  estado.mapas = [normalizarMapa(mapa)];
  estado.nos = new Map([[mapa.id, nos]]);
  const faixa = $("#faixa-offline");
  if (texto) faixa.textContent = texto;
  faixa.hidden = false;
  estado.carregou = true;
  aoMudarRota();
}
ligarLogin().then((api) => {
  estado.api = api;
  $("#faixa-offline").hidden = !!api;
  if (!api) return usarExemploSemNuvem();
  /* Estrutura e modelos do Painel: em tempo real; sem documento (ou erro), valem os padrões do código */
  ["estrutura", "modelos"].forEach((doc) => api.ouvirDoc(`mapas-config/${doc}`, (d) => aoMudarConfig(doc, d), (e) => console.warn(`mapas-config/${doc}:`, e)));
  api.ouvirColecao("mapas", (lista) => {
    estado.mapas = lista.map(normalizarMapa).filter(Boolean);
    ouvirNosDosMapas();
    if (!estado.carregou) { estado.carregou = true; aoMudarRota(); } else redesenhar();
  }, (e) => {
    /* Ex.: regras do Firestore ainda sem a coleção "mapas" (firebase deploy --only firestore:rules) */
    console.warn("mapas:", e);
    usarExemploSemNuvem("Não foi possível ler os mapas da nuvem agora: mostrando só o mapa de exemplo, em somente leitura.");
  });
});
window.__mapas = { estado };
