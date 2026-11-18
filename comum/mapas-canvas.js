/*
 * ============================================================
 *  MAPAS DE AJUDA: quadro em SVG (sem bibliotecas)
 *  - Árvore horizontal (raiz à esquerda) ou "Visão grafo" (forças, estilo Obsidian)
 *  - Pan (arrastar o fundo), zoom (roda / pinça / botões), nós arrastáveis nos dois modos
 *  - Posição livre (no.pos) vale em árvore e grafo; sem pos, usa o layout automático
 *  - Passar o mouse (ou focar) destaca o caminho até a raiz e os filhos diretos
 *  - Teclado: setas navegam entre pai, filhos e irmãos; Espaço recolhe/expande
 *  Tudo o que muda dados é avisado por callbacks; quem grava é mapas.js.
 * ============================================================
 */
import { TIPOS, caminhoAteRaiz, revisaoVencida } from "./mapas-dados.js";

const NS = "http://www.w3.org/2000/svg";
const L = 224, A = 66, VAO_X = 72, VAO_Y = 16;       /* caixa do nó na árvore */
const ZOOM_MIN = 0.15, ZOOM_MAX = 2.5;
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Quebra o título em até 2 linhas de ~max caracteres */
function linhasTitulo(texto, max = 27) {
  const palavras = String(texto).split(/\s+/);
  const linhas = [""];
  for (const p of palavras) {
    const atual = linhas[linhas.length - 1];
    if ((atual + " " + p).trim().length <= max) linhas[linhas.length - 1] = (atual + " " + p).trim();
    else if (linhas.length < 2) linhas.push(p.length > max ? p.slice(0, max - 1) + "…" : p);
    else { linhas[1] = (linhas[1] + " " + p).slice(0, max - 1).trim() + "…"; break; }
  }
  if (linhas[0].length > max) linhas[0] = linhas[0].slice(0, max - 1) + "…";
  return linhas.filter(Boolean);
}

/* ------------------------------------------------------------
 *  Layouts
 * ------------------------------------------------------------ */
function visiveis(idx, recolhidos) {
  const r = [];
  if (!idx.raiz) return r;
  const pilha = [[idx.raiz, 0]];
  while (pilha.length) {
    const [n, d] = pilha.pop();
    r.push({ no: n, prof: d });
    if (recolhidos.has(n.id)) continue;
    const f = idx.filhos.get(n.id) || [];
    for (let i = f.length - 1; i >= 0; i--) pilha.push([f[i], d + 1]);
  }
  return r;
}
function layoutArvore(idx, recolhidos) {
  const pos = new Map();
  let proximaLinha = 0;
  const passo = A + VAO_Y;
  const visitar = (n, d) => {
    const f = recolhidos.has(n.id) ? [] : (idx.filhos.get(n.id) || []);
    let y;
    if (!f.length) { y = proximaLinha * passo; proximaLinha++; }
    else {
      const ys = f.map((c) => visitar(c, d + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    pos.set(n.id, { x: d * (L + VAO_X), y });
    return y;
  };
  if (idx.raiz) visitar(idx.raiz, 0);
  return pos;
}
/* Forças simples: repulsão entre todos, molas nas arestas, gravidade ao centro.
   Calculado de uma vez (sem animação): ~300 nós em poucos milissegundos. */
const cacheGrafo = new Map();
function layoutGrafo(idx, recolhidos, ligacoesExtras) {
  const lista = visiveis(idx, recolhidos);
  const chave = lista.map((v) => v.no.id + ">" + (idx.paiDe.get(v.no.id) || "")).join("|") + "#" + ligacoesExtras.length;
  if (cacheGrafo.has(chave)) return cacheGrafo.get(chave);
  const n = lista.length;
  const ids = lista.map((v) => v.no.id);
  const ix = new Map(ids.map((id, i) => [id, i]));
  const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  /* Começo radial por profundidade (estável: sem aleatoriedade) */
  const porProf = new Map();
  lista.forEach((v) => { if (!porProf.has(v.prof)) porProf.set(v.prof, []); porProf.get(v.prof).push(v.no.id); });
  porProf.forEach((grupo, d) => grupo.forEach((id, k) => {
    const ang = (2 * Math.PI * k) / grupo.length + d * 0.6;
    x[ix.get(id)] = Math.cos(ang) * d * 140; y[ix.get(id)] = Math.sin(ang) * d * 140;
  }));
  const arestas = [];
  ids.forEach((id) => { const p = idx.paiDe.get(id); if (p && ix.has(p)) arestas.push([ix.get(p), ix.get(id), 120]); });
  ligacoesExtras.forEach(([a, b]) => { if (ix.has(a) && ix.has(b)) arestas.push([ix.get(a), ix.get(b), 220]); });
  const iteracoes = n > 200 ? 180 : 260;
  for (let it = 0; it < iteracoes; it++) {
    const alfa = 1 - it / iteracoes;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let dx = x[i] - x[j], dy = y[i] - y[j];
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = (i - j) * 0.5 || 0.5; dy = 0.5; d2 = 1; }
      if (d2 > 640000) continue;
      const f = (9000 / d2) * alfa;
      const d = Math.sqrt(d2);
      vx[i] += (dx / d) * f; vy[i] += (dy / d) * f; vx[j] -= (dx / d) * f; vy[j] -= (dy / d) * f;
    }
    for (const [a, b, alvo] of arestas) {
      const dx = x[b] - x[a], dy = y[b] - y[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - alvo) * 0.04 * alfa;
      vx[a] += (dx / d) * f; vy[a] += (dy / d) * f; vx[b] -= (dx / d) * f; vy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      vx[i] -= x[i] * 0.004 * alfa; vy[i] -= y[i] * 0.004 * alfa;
      x[i] += Math.max(-40, Math.min(40, vx[i])); y[i] += Math.max(-40, Math.min(40, vy[i]));
      vx[i] *= 0.55; vy[i] *= 0.55;
    }
  }
  const pos = new Map(ids.map((id, i) => [id, { x: Math.round(x[i]), y: Math.round(y[i]) }]));
  if (cacheGrafo.size > 20) cacheGrafo.clear();
  cacheGrafo.set(chave, pos);
  return pos;
}

/* ------------------------------------------------------------
 *  Quadro
 * ------------------------------------------------------------ */
export function criarCanvas(container, cb = {}) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "quadro");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Mapa: use Tab para chegar aos nós e as setas para navegar");
  svg.innerHTML = `<defs>
      <marker id="seta-ligacao" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" class="seta-ligacao"/></marker>
    </defs>
    <rect class="quadro-fundo" x="-100000" y="-100000" width="200000" height="200000"/>
    <g class="mundo"><g class="arestas"></g><g class="ligacoes"></g><g class="nos"></g></g>`;
  container.appendChild(svg);
  const mundo = svg.querySelector(".mundo");
  const gArestas = svg.querySelector(".arestas"), gLig = svg.querySelector(".ligacoes"), gNos = svg.querySelector(".nos");

  const est = {
    t: { x: 40, y: 40, k: 1 }, dados: null, pos: new Map(), visiveis: [], quadro: "arvore",
    pendente: false, primeiro: true, arrasto: null, ponteiros: new Map(), pinca: null, destaque: null
  };
  const aplicar = () => {
    if (est.pendente) return;
    est.pendente = true;
    requestAnimationFrame(() => {
      est.pendente = false;
      mundo.setAttribute("transform", `translate(${est.t.x.toFixed(1)} ${est.t.y.toFixed(1)}) scale(${est.t.k.toFixed(4)})`);
      svg.classList.toggle("longe", est.t.k < 0.45);
    });
  };
  const tamanho = () => { const r = svg.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 600, r }; };
  const paraMundo = (cx, cy) => { const { r } = tamanho(); return { x: (cx - r.left - est.t.x) / est.t.k, y: (cy - r.top - est.t.y) / est.t.k }; };
  function zoomEm(fator, cx, cy) {
    const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, est.t.k * fator));
    const { r } = tamanho();
    const px = (cx == null ? r.left + r.width / 2 : cx) - r.left, py = (cy == null ? r.top + r.height / 2 : cy) - r.top;
    est.t.x = px - ((px - est.t.x) * k) / est.t.k;
    est.t.y = py - ((py - est.t.y) * k) / est.t.k;
    est.t.k = k;
    aplicar();
  }
  const ehGrafo = () => est.quadro === "grafo";
  /* Retângulo do nó em coordenadas do mundo (árvore: canto; grafo: centro) */
  function caixa(id) {
    const p = est.pos.get(id);
    if (!p) return null;
    if (ehGrafo()) { const r = raioGrafo(id); return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2, cx: p.x, cy: p.y }; }
    return { x: p.x, y: p.y, w: L, h: A, cx: p.x + L / 2, cy: p.y + A / 2 };
  }
  function raioGrafo(id) {
    const d = est.dados;
    const f = (d.idx.filhos.get(id) || []).length;
    return d.idx.raiz && d.idx.raiz.id === id ? 22 : Math.min(18, 8 + f * 2);
  }

  /* ---------- Desenho ---------- */
  function desenhar() {
    const d = est.dados;
    if (!d) return;
    est.quadro = d.quadro;
    est.visiveis = visiveis(d.idx, d.recolhidos);
    const visivel = new Set(est.visiveis.map((v) => v.no.id));
    const extras = [];
    est.visiveis.forEach(({ no }) => (no.ligacoes || []).forEach((l) => { if (visivel.has(l.para)) extras.push([no.id, l.para, l.rotulo]); }));
    const auto = ehGrafo() ? layoutGrafo(d.idx, d.recolhidos, extras) : layoutArvore(d.idx, d.recolhidos);
    est.pos = new Map();
    /* Posição livre vale nos dois modos (árvore e grafo): se o nó tem pos, usa; senão, layout automático. */
    est.visiveis.forEach(({ no }) => {
      const manual = no.pos && Number.isFinite(no.pos.x) && Number.isFinite(no.pos.y) ? no.pos : null;
      est.pos.set(no.id, manual ? { x: manual.x, y: manual.y } : (auto.get(no.id) || { x: 0, y: 0 }));
    });
    const foco = document.activeElement && document.activeElement.closest && document.activeElement.closest(".no");
    const idFoco = foco && svg.contains(foco) ? foco.dataset.id : null;
    svg.classList.toggle("grafo", ehGrafo());
    svg.classList.toggle("editavel", !!d.editavel);

    /* Arestas da árvore */
    let html = "";
    est.visiveis.forEach(({ no }) => {
      const pai = d.idx.paiDe.get(no.id);
      if (!pai || !visivel.has(pai)) return;
      html += `<path class="aresta" data-de="${esc(pai)}" data-para="${esc(no.id)}" d="${caminhoAresta(pai, no.id)}"/>`;
    });
    gArestas.innerHTML = html;
    /* Ligações extras (tracejadas, com rótulo) */
    html = "";
    extras.forEach(([de, para, rotulo]) => {
      const a = caixa(de), b = caixa(para);
      if (!a || !b) return;
      let d, tx, ty;
      if (ehGrafo()) {
        const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2 - 40;
        d = `M${a.cx} ${a.cy} Q${mx} ${my} ${b.cx} ${b.cy}`; tx = mx; ty = my + 14;
      } else if (b.x > a.x + L / 2) {
        /* Alvo mais à direita: sai da direita e entra pela esquerda */
        const x1 = a.x + L, x2 = b.x, m = (x1 + x2) / 2;
        d = `M${x1} ${a.cy + 10} C${m} ${a.cy + 10} ${m} ${b.cy - 10} ${x2} ${b.cy - 10}`; tx = m; ty = (a.cy + b.cy) / 2 - 4;
      } else {
        /* Mesma coluna (ou para trás): faz um arco por fora, à direita das caixas */
        const x1 = a.x + L + 12, x2 = b.x + L + 12, fora = Math.max(x1, x2) + 46 + Math.min(80, Math.abs(a.cy - b.cy) / 4);
        d = `M${x1} ${a.cy + 12} C${fora} ${a.cy + 12} ${fora} ${b.cy - 12} ${x2} ${b.cy - 12}`; tx = fora - 18; ty = (a.cy + b.cy) / 2 + 4;
      }
      html += `<g class="ligacao" data-de="${esc(de)}" data-para="${esc(para)}"><path d="${d}" marker-end="url(#seta-ligacao)"/>${rotulo ? `<text x="${tx}" y="${ty}" text-anchor="middle">${esc(rotulo)}</text>` : ""}</g>`;
    });
    gLig.innerHTML = html;
    /* Nós */
    html = "";
    est.visiveis.forEach(({ no }) => { html += ehGrafo() ? htmlNoGrafo(no) : htmlNoArvore(no); });
    gNos.innerHTML = html;
    if (est.destaque) destacar(est.destaque);
    aplicar();
    if (idFoco) { const el = gNos.querySelector(`.no[data-id="${CSS.escape(idFoco)}"]`); if (el) el.focus({ preventScroll: true }); }
    if (est.primeiro && est.visiveis.length) { est.primeiro = false; ajustar(true); }
  }
  function caminhoAresta(de, para) {
    const a = caixa(de), b = caixa(para);
    if (ehGrafo()) return `M${a.cx} ${a.cy} L${b.cx} ${b.cy}`;
    const x1 = a.x + L, y1 = a.cy, x2 = b.x, y2 = b.cy, m = (x1 + x2) / 2;
    return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
  }
  function rotuloAria(no) {
    const d = est.dados;
    const f = (d.idx.filhos.get(no.id) || []).length;
    return `${TIPOS[no.tipo].nome}: ${no.titulo}${f ? `. ${f} ${f === 1 ? "item abaixo" : "itens abaixo"}${d.recolhidos.has(no.id) ? ", recolhido" : ""}` : ""}`;
  }
  function htmlNoArvore(no) {
    const d = est.dados;
    const p = est.pos.get(no.id);
    const tipo = TIPOS[no.tipo];
    const f = (d.idx.filhos.get(no.id) || []).length;
    const rec = d.recolhidos.has(no.id);
    const linhas = linhasTitulo(no.titulo);
    const sel = d.selecionado === no.id ? " selecionado" : "";
    const marcado = d.marcados && d.marcados.has(no.id) ? " marcado" : "";
    const vencido = revisaoVencida(no);
    return `<g class="no tipo-${no.tipo} tom-${tipo.cor}${sel}${marcado}" data-id="${esc(no.id)}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(rotuloAria(no))}"${d.selecionado === no.id ? ' aria-current="true"' : ""}>
      <rect class="no-caixa" width="${L}" height="${A}" rx="10"/>
      <rect class="no-faixa" width="5" height="${A - 16}" x="0" y="8" rx="2.5"/>
      <svg class="no-icone" x="14" y="9" width="16" height="16" viewBox="0 0 24 24"><use href="#${tipo.icone}"/></svg>
      <text class="no-tipo" x="36" y="22">${esc(tipo.nome.toUpperCase())}</text>
      ${vencido ? `<circle class="no-vencido" cx="${L - 14}" cy="16" r="5"><title>Sem revisão há mais de 90 dias</title></circle>` : ""}
      ${linhas.map((t, i) => `<text class="no-titulo" x="14" y="${43 + i * 16}">${esc(t)}</text>`).join("")}
      ${f ? `<g class="no-alternar" data-alternar="${esc(no.id)}" transform="translate(${L} ${A / 2})"><circle r="11"/><text y="4" text-anchor="middle">${rec ? "+" + f : "−"}</text></g>` : ""}
    </g>`;
  }
  function htmlNoGrafo(no) {
    const d = est.dados;
    const p = est.pos.get(no.id);
    const tipo = TIPOS[no.tipo];
    const f = (d.idx.filhos.get(no.id) || []).length;
    const rec = d.recolhidos.has(no.id);
    const r = raioGrafo(no.id);
    const sel = d.selecionado === no.id ? " selecionado" : "";
    const marcado = d.marcados && d.marcados.has(no.id) ? " marcado" : "";
    const titulo = no.titulo.length > 34 ? no.titulo.slice(0, 33) + "…" : no.titulo;
    return `<g class="no tipo-${no.tipo} tom-${tipo.cor}${sel}${marcado}" data-id="${esc(no.id)}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(rotuloAria(no))}">
      <circle class="no-bola" r="${r}"/>
      ${rec && f ? `<text class="no-mais" y="4" text-anchor="middle">+${f}</text>` : ""}
      <text class="no-rotulo" y="${r + 15}" text-anchor="middle">${esc(titulo)}</text>
    </g>`;
  }

  /* ---------- Destaque (hover/foco): caminho até a raiz + filhos diretos ---------- */
  function destacar(id) {
    est.destaque = id;
    const d = est.dados;
    if (!d || !id || !est.pos.has(id)) { limparDestaque(); return; }
    const ativos = new Set(caminhoAteRaiz(d.idx, id));
    (d.recolhidos.has(id) ? [] : (d.idx.filhos.get(id) || [])).forEach((f) => ativos.add(f.id));
    const no = d.idx.porId.get(id);
    (no.ligacoes || []).forEach((l) => ativos.add(l.para));
    svg.classList.add("com-destaque");
    gNos.querySelectorAll(".no").forEach((el) => el.classList.toggle("ativo", ativos.has(el.dataset.id)));
    gArestas.querySelectorAll(".aresta").forEach((el) => el.classList.toggle("ativo", ativos.has(el.dataset.de) && ativos.has(el.dataset.para)));
    gLig.querySelectorAll(".ligacao").forEach((el) => el.classList.toggle("ativo", el.dataset.de === id || el.dataset.para === id));
  }
  function limparDestaque() {
    est.destaque = null;
    svg.classList.remove("com-destaque");
  }

  /* ---------- Enquadramento ---------- */
  function limites(ids) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    (ids || [...est.pos.keys()]).forEach((id) => {
      const c = caixa(id);
      if (!c) return;
      x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y); x2 = Math.max(x2, c.x + c.w); y2 = Math.max(y2, c.y + c.h + (ehGrafo() ? 20 : 0));
    });
    return isFinite(x1) ? { x1, y1, x2, y2 } : null;
  }
  function ajustar(soReduzir = false) {
    const b = limites();
    if (!b) return;
    const { w, h } = tamanho();
    const m = 40;
    let k = Math.min((w - m * 2) / Math.max(1, b.x2 - b.x1), (h - m * 2) / Math.max(1, b.y2 - b.y1));
    k = Math.max(ZOOM_MIN, Math.min(soReduzir ? 1 : ZOOM_MAX, k));
    est.t.k = k;
    est.t.x = (w - (b.x2 - b.x1) * k) / 2 - b.x1 * k;
    est.t.y = (h - (b.y2 - b.y1) * k) / 2 - b.y1 * k;
    aplicar();
  }
  function focar(id, { zoom = null } = {}) {
    const c = caixa(id);
    if (!c) return false;
    const { w, h } = tamanho();
    if (zoom) est.t.k = zoom;
    est.t.x = w / 2 - c.cx * est.t.k;
    est.t.y = h / 2 - c.cy * est.t.k;
    aplicar();
    return true;
  }
  function centralizar() {
    const d = est.dados;
    if (d && d.selecionado && focar(d.selecionado)) return;
    if (d && d.idx.raiz) focar(d.idx.raiz.id, { zoom: 1 });
  }
  function focarNo(id) {
    const el = gNos.querySelector(`.no[data-id="${CSS.escape(id)}"]`);
    if (!el) return false;
    el.focus({ preventScroll: true });
    const c = caixa(id), { w, h } = tamanho();
    const sx = c.cx * est.t.k + est.t.x, sy = c.cy * est.t.k + est.t.y;
    if (sx < 60 || sx > w - 60 || sy < 60 || sy > h - 60) focar(id);
    return true;
  }

  /* ---------- Ponteiro: pan, zoom por pinça, arrastar nós ---------- */
  function noSob(cx, cy, ignorar) {
    const p = paraMundo(cx, cy);
    for (const [id] of est.pos) {
      if (ignorar.has(id)) continue;
      const c = caixa(id);
      if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) return id;
    }
    return null;
  }
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    est.ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (est.ponteiros.size === 2) {
      const [a, b] = [...est.ponteiros.values()];
      est.pinca = { d: Math.hypot(a.x - b.x, a.y - b.y), k: est.t.k };
      est.arrasto = null;
      return;
    }
    const alternar = e.target.closest("[data-alternar]");
    if (alternar) return;
    const noEl = e.target.closest(".no");
    est.arrasto = noEl
      ? { tipo: "no", id: noEl.dataset.id, el: noEl, x0: e.clientX, y0: e.clientY, inicio: { ...est.pos.get(noEl.dataset.id) }, moveu: false }
      : { tipo: "fundo", x0: e.clientX, y0: e.clientY, tx: est.t.x, ty: est.t.y, moveu: false };
    try { svg.setPointerCapture(e.pointerId); } catch (erro) { /* ponteiro sintético ou já liberado */ }
  });
  svg.addEventListener("pointermove", (e) => {
    if (est.ponteiros.has(e.pointerId)) est.ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (est.pinca && est.ponteiros.size === 2) {
      const [a, b] = [...est.ponteiros.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomEm((est.pinca.k * dist) / est.pinca.d / est.t.k, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const ar = est.arrasto;
    if (!ar) return;
    const dx = e.clientX - ar.x0, dy = e.clientY - ar.y0;
    if (!ar.moveu && Math.hypot(dx, dy) < 5) return;
    ar.moveu = true;
    if (ar.tipo === "fundo") { est.t.x = ar.tx + dx; est.t.y = ar.ty + dy; svg.classList.add("arrastando"); aplicar(); return; }
    if (!est.dados.editavel) return;
    const p = { x: Math.round(ar.inicio.x + dx / est.t.k), y: Math.round(ar.inicio.y + dy / est.t.k) };
    est.pos.set(ar.id, p);
    svg.classList.add("arrastando-no");
    ar.el.classList.add("arrastado");
    if (!ar.raf) ar.raf = requestAnimationFrame(() => {
      ar.raf = null;
      ar.el.setAttribute("transform", `translate(${est.pos.get(ar.id).x} ${est.pos.get(ar.id).y})`);
      gArestas.querySelectorAll(`[data-de="${CSS.escape(ar.id)}"],[data-para="${CSS.escape(ar.id)}"]`).forEach((a) => a.setAttribute("d", caminhoAresta(a.dataset.de, a.dataset.para)));
      const proibidos = new Set([ar.id, ...descendentesVisiveis(ar.id)]);
      const alvo = noSob(e.clientX, e.clientY, proibidos);
      gNos.querySelectorAll(".no.alvo-soltar").forEach((el) => el.classList.remove("alvo-soltar"));
      if (alvo) { const el = gNos.querySelector(`.no[data-id="${CSS.escape(alvo)}"]`); if (el) el.classList.add("alvo-soltar"); }
      ar.alvo = alvo;
    });
  });
  function descendentesVisiveis(id) {
    const r = [];
    const pilha = [...(est.dados.idx.filhos.get(id) || [])];
    while (pilha.length) { const n = pilha.pop(); r.push(n.id); pilha.push(...(est.dados.idx.filhos.get(n.id) || [])); }
    return r;
  }
  function terminar(e) {
    est.ponteiros.delete(e.pointerId);
    if (est.pinca) { if (est.ponteiros.size < 2) est.pinca = null; return; }
    const ar = est.arrasto;
    est.arrasto = null;
    svg.classList.remove("arrastando", "arrastando-no");
    if (!ar) return;
    if (ar.tipo === "fundo") { if (!ar.moveu && cb.aoClicarFundo) cb.aoClicarFundo(); return; }
    if (!ar.moveu) return;   /* clique simples: tratado no "click" */
    if (ar.raf) { cancelAnimationFrame(ar.raf); ar.raf = null; }
    /* Alvo calculado de novo com a posição final (o último quadro pode não ter rodado) */
    if (est.dados.editavel) ar.alvo = noSob(e.clientX, e.clientY, new Set([ar.id, ...descendentesVisiveis(ar.id)]));
    ar.el.classList.remove("arrastado");
    gNos.querySelectorAll(".no.alvo-soltar").forEach((el) => el.classList.remove("alvo-soltar"));
    est.ignorarClique = true;
    setTimeout(() => { est.ignorarClique = false; }, 0);
    if (!est.dados.editavel) return;
    if (ar.alvo && cb.aoReparentar) cb.aoReparentar(ar.id, ar.alvo);
    else if (cb.aoMover) cb.aoMover(ar.id, { ...est.pos.get(ar.id), v: est.quadro });
  }
  svg.addEventListener("pointerup", terminar);
  svg.addEventListener("pointercancel", terminar);
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const fator = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
    zoomEm(fator, e.clientX, e.clientY);
  }, { passive: false });
  svg.addEventListener("click", (e) => {
    if (est.ignorarClique) return;
    const alt = e.target.closest("[data-alternar]");
    if (alt) { e.stopPropagation(); cb.aoAlternar && cb.aoAlternar(alt.dataset.alternar); return; }
    const noEl = e.target.closest(".no");
    if (noEl && cb.aoSelecionar) cb.aoSelecionar(noEl.dataset.id);
  });
  svg.addEventListener("dblclick", (e) => {
    const noEl = e.target.closest(".no");
    if (noEl && cb.aoAbrir) { e.preventDefault(); cb.aoAbrir(noEl.dataset.id); }
  });
  svg.addEventListener("pointerover", (e) => { const noEl = e.target.closest(".no"); if (noEl && !est.arrasto) destacar(noEl.dataset.id); });
  svg.addEventListener("pointerout", (e) => { const noEl = e.target.closest(".no"); if (noEl && !noEl.contains(e.relatedTarget)) limparDestaque(); });
  svg.addEventListener("focusin", (e) => { const noEl = e.target.closest(".no"); if (noEl) destacar(noEl.dataset.id); });
  svg.addEventListener("focusout", () => limparDestaque());

  /* ---------- Teclado ---------- */
  svg.addEventListener("keydown", (e) => {
    const noEl = e.target.closest && e.target.closest(".no");
    if (!noEl) return;
    const id = noEl.dataset.id;
    const d = est.dados;
    if (cb.aoTecla && cb.aoTecla(e, id)) { e.preventDefault(); return; }
    const pai = d.idx.paiDe.get(id);
    const irmaos = pai ? d.idx.filhos.get(pai) : [d.idx.raiz];
    const i = irmaos.findIndex((n) => n.id === id);
    let alvo = null;
    if (e.key === "ArrowLeft") alvo = pai;
    else if (e.key === "ArrowRight") {
      const f = d.idx.filhos.get(id) || [];
      if (f.length && d.recolhidos.has(id)) { cb.aoAlternar && cb.aoAlternar(id); e.preventDefault(); return; }
      alvo = f[0] && f[0].id;
    } else if (e.key === "ArrowUp") alvo = irmaos[i - 1] && irmaos[i - 1].id;
    else if (e.key === "ArrowDown") alvo = irmaos[i + 1] && irmaos[i + 1].id;
    else if (e.key === " ") { if ((d.idx.filhos.get(id) || []).length) cb.aoAlternar && cb.aoAlternar(id); e.preventDefault(); return; }
    else if (e.key === "Enter") { cb.aoSelecionar && cb.aoSelecionar(id); e.preventDefault(); return; }
    else if (e.key === "+" || e.key === "=") { zoomEm(1.2); e.preventDefault(); return; }
    else if (e.key === "-") { zoomEm(1 / 1.2); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    if (alvo) focarNo(alvo);
  });

  /* ---------- Exportar (SVG/PNG com as cores atuais do tema) ---------- */
  function exportarSVG() {
    const b = limites();
    if (!b) return null;
    const m = 30;
    const copia = svg.cloneNode(true);
    const origem = [svg, ...svg.querySelectorAll("*")];
    const destino = [copia, ...copia.querySelectorAll("*")];
    const props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-weight", "font-family", "letter-spacing"];
    origem.forEach((el, i) => {
      const cs = getComputedStyle(el);
      destino[i].setAttribute("style", props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
      destino[i].removeAttribute("class"); destino[i].removeAttribute("tabindex");
    });
    copia.querySelector("rect").remove();     /* fundo infinito */
    copia.querySelector("g").setAttribute("transform", "");
    const usados = new Set([...copia.querySelectorAll("use")].map((u) => u.getAttribute("href").slice(1)));
    const defs = copia.querySelector("defs");
    usados.forEach((id) => { const s = document.getElementById(id); if (s) defs.appendChild(s.cloneNode(true)); });
    const w = b.x2 - b.x1 + m * 2, h = b.y2 - b.y1 + m * 2;
    copia.setAttribute("xmlns", NS);
    copia.setAttribute("viewBox", `${b.x1 - m} ${b.y1 - m} ${w} ${h}`);
    copia.setAttribute("width", w); copia.setAttribute("height", h);
    const fundo = document.createElementNS(NS, "rect");
    fundo.setAttribute("x", b.x1 - m); fundo.setAttribute("y", b.y1 - m); fundo.setAttribute("width", w); fundo.setAttribute("height", h);
    fundo.setAttribute("fill", getComputedStyle(document.body).backgroundColor);
    copia.insertBefore(fundo, copia.querySelector("g"));
    return { texto: new XMLSerializer().serializeToString(copia), w, h };
  }
  async function exportarPNG() {
    const s = exportarSVG();
    if (!s) return null;
    const escala = Math.min(2, 8000 / Math.max(s.w, s.h));
    const img = new Image();
    const url = URL.createObjectURL(new Blob([s.texto], { type: "image/svg+xml" }));
    await new Promise((ok, erro) => { img.onload = ok; img.onerror = erro; img.src = url; });
    const c = document.createElement("canvas");
    c.width = Math.round(s.w * escala); c.height = Math.round(s.h * escala);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return new Promise((ok) => c.toBlob(ok, "image/png"));
  }

  const aoRedimensionar = new ResizeObserver(() => aplicar());
  aoRedimensionar.observe(svg);
  return {
    atualizar(dados) { est.dados = dados; desenhar(); },
    zoom: (f) => zoomEm(f),
    ajustar: () => ajustar(false),
    centralizar,
    focar: (id, opcoes) => focar(id, opcoes),
    focarNo,
    exportarSVG, exportarPNG,
    destruir() { aoRedimensionar.disconnect(); svg.remove(); }
  };
}
