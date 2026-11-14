/*
 * ============================================================
 *  MAPAS DE AJUDA: PAINEL DE EDIÇÃO (só administradoras) — mapas.html#painel/<aba>
 *  Abas: Tipos de nó · Listas de opções · Campos de cada tipo · Modelos de mapa ·
 *        Conteúdo em massa · Histórico
 *  Grava:
 *    mapas-config/estrutura   { versao, tipos, ordemTipos, campos, atualizadoEm, atualizadoPor }
 *    mapas-config/modelos     { versao, lista, atualizadoEm, atualizadoPor }
 *    mapas-config/{doc}/versoes/{id}  { dados, resumo, em, por }  (uma versão por salvamento)
 *  As alterações ficam num RASCUNHO até "Salvar". Os IDs dos tipos, dos campos nativos e das
 *  opções nunca mudam: renomear muda só o rótulo; arquivar/remover opção em uso pede decisão.
 *  "Conteúdo em massa" grava direto nos nós (com prévia e confirmação), fora do rascunho.
 * ============================================================
 */
import { $, $$, escapar, normalizar, svg, slug, mostrarAviso, confirmar, criarDialogo, formatarData, baixarArquivo, registrarAuditoria } from "./base.js";
import {
  IDS_TIPOS, TIPOS_CAMPO, CORES, ICONES_TIPOS, LIMITE_EXTRAS, ID_CAMPO_EXTRA, CAMPOS_PERMITIDOS, LIMITES,
  estruturaPadrao, mesclarEstrutura, modelosPadraoNormalizados, normalizarModelo, normalizarNo, MODELOS,
  acharOpcao, indexar, diferencas, revisaoVencida, textoDoNo, corresponde, idCurto, LIMITE_MODELOS, LIMITE_NOS_MODELO,
  valorDoCampo, ID_VALIDO, clonarNos
} from "./mapas-dados.js";

const ABAS = [
  { id: "tipos", nome: "Tipos de nó", icone: "i-grade" },
  { id: "listas", nome: "Listas de opções", icone: "i-lista" },
  { id: "campos", nome: "Campos de cada tipo", icone: "i-ajustes" },
  { id: "modelos", nome: "Modelos de mapa", icone: "i-mapa" },
  { id: "conteudo", nome: "Conteúdo em massa", icone: "i-tabela" },
  { id: "historico", nome: "Histórico", icone: "i-relogio" }
];
const DOC_DA_ABA = { tipos: "estrutura", listas: "estrutura", campos: "estrutura", modelos: "modelos" };
const NOME_DOC = { estrutura: "Estrutura (tipos, listas e campos)", modelos: "Modelos de mapa" };
const FORMATO_CONFIG = "suporte-n2-mapas-config";
const clonar = (v) => JSON.parse(JSON.stringify(v));
const corSelo = (c) => (c ? `tom-${c}` : "");

export function iniciarPainel(app) {
  let raiz = null, conteudo = null, abaAtual = "tipos";
  let rascunho = { estrutura: null, modelos: null };
  let sujo = { estrutura: false, modelos: false };
  let mudouFora = { estrutura: false, modelos: false };
  let tipoCampos = "sistema";
  const pendentesConteudo = new Map();                 /* noId -> { mapaId, titulo, tipo } */
  const filtro = { mapa: "", tipo: "", tag: "", vencidos: false, busca: "" };
  const modelosAbertos = new Set();

  /* ---------- Rascunho ---------- */
  const ativo = (doc) => (doc === "estrutura" ? mesclarEstrutura(app.estado.config.estrutura) : { lista: clonar(MODELOS) });
  function garantir() {
    if (!rascunho.estrutura) rascunho.estrutura = clonar(ativo("estrutura"));
    if (!rascunho.modelos) rascunho.modelos = clonar(ativo("modelos"));
  }
  const E = () => { garantir(); return rascunho.estrutura; };
  const M = () => { garantir(); return rascunho.modelos; };
  function marcar(doc) { sujo[doc] = true; atualizarBarra(); }
  const temPendencias = () => sujo.estrutura || sujo.modelos || pendentesConteudo.size > 0;
  function descartar(silencioso = false) {
    rascunho = { estrutura: null, modelos: null };
    sujo = { estrutura: false, modelos: false };
    mudouFora = { estrutura: false, modelos: false };
    pendentesConteudo.clear();
    if (!silencioso) { mostrarAviso("Alterações descartadas."); desenhar(abaAtual); }
  }

  /* ---------- Todos os nós de todos os mapas (o app já ouve todos em tempo real) ---------- */
  function todosOsNos() {
    const r = [];
    app.estado.mapas.forEach((m) => app.nosDe(m.id).forEach((n) => r.push({ m, n })));
    return r;
  }
  const defDoRascunho = (tipo, id) => (E().campos[tipo] || []).find((c) => c.id === id) || null;
  function usoDaOpcao(tipo, campoId, opcaoId) {
    const def = defDoRascunho(tipo, campoId);
    return todosOsNos().filter(({ n }) => n.tipo === tipo && (() => { const v = valorDoCampo(n, def); const o = acharOpcao(def, v); return o && o.id === opcaoId; })());
  }
  function foraDaLista(tipo, def) {
    return todosOsNos().filter(({ n }) => { if (n.tipo !== tipo) return false; const v = valorDoCampo(n, def); return v != null && v !== "" && !acharOpcao(def, v); });
  }

  /* ---------- Estrutura da página ---------- */
  function montar(alvo) {
    raiz = alvo;
    raiz.innerHTML = `<section class="tela-painel">
      <header class="painel-cab">
        <div class="painel-cab-texto"><h2>${svg("i-engrenagem")}Painel de edição</h2>
          <p class="apoio">Estrutura dos mapas: nomes e cores dos tipos, listas de opções, campos e modelos. Só administradoras.</p></div>
        <div class="painel-cab-acoes">
          <span class="painel-estado" id="painel-estado" role="status" aria-live="polite"></span>
          <button type="button" class="btn btn-secundario btn-mini" data-p="descartar">${svg("i-desfazer")}Descartar alterações</button>
          <button type="button" class="btn btn-mini" data-p="salvar">${svg("i-salvar")}Salvar</button>
          <button type="button" class="btn-icone" data-p="mais" aria-label="Mais ações do painel" aria-haspopup="menu">${svg("i-ajustes")}</button>
        </div>
      </header>
      <div class="painel-corpo">
        <nav class="painel-abas" role="tablist" aria-label="Seções do painel" aria-orientation="vertical">
          ${ABAS.map((a) => `<a role="tab" href="#painel/${a.id}" id="aba-painel-${a.id}" data-aba="${a.id}" aria-controls="painel-conteudo">${svg(a.icone)}<span>${escapar(a.nome)}</span></a>`).join("")}
        </nav>
        <div class="painel-conteudo" id="painel-conteudo" role="tabpanel" tabindex="-1"></div>
      </div>
    </section>`;
    conteudo = $("#painel-conteudo", raiz);
    raiz.querySelector(".painel-cab").addEventListener("click", aoClicarCab);
    raiz.querySelector(".painel-abas").addEventListener("keydown", (e) => {
      const abas = $$("[role=tab]", raiz);
      const i = abas.indexOf(document.activeElement);
      if (i < 0) return;
      const j = e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % abas.length : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (i - 1 + abas.length) % abas.length : -1;
      if (j >= 0) { e.preventDefault(); abas[j].focus(); }
    });
    conteudo.addEventListener("click", aoClicar);
    conteudo.addEventListener("input", aoDigitar);
    conteudo.addEventListener("change", aoDigitar);
  }
  function atualizarBarra() {
    /* O painel pode não estar na tela (ex.: "Salvar como modelo" chamado da tela do mapa) */
    const est = raiz && raiz.querySelector("#painel-estado");
    if (!est) return;
    const partes = [];
    if (sujo.estrutura || sujo.modelos) partes.push("Alterações não salvas");
    if (pendentesConteudo.size) partes.push(`${pendentesConteudo.size} ${pendentesConteudo.size === 1 ? "nó alterado" : "nós alterados"} na tabela`);
    if (mudouFora.estrutura || mudouFora.modelos) partes.push("a configuração mudou na nuvem enquanto você editava");
    est.textContent = partes.join(" · ");
    est.classList.toggle("pendente", partes.length > 0);
    $('[data-p="salvar"]', raiz).disabled = !(sujo.estrutura || sujo.modelos);
    $('[data-p="descartar"]', raiz).disabled = !temPendencias();
  }
  function desenhar(aba) {
    if (!raiz) return;
    garantir();
    abaAtual = ABAS.some((a) => a.id === aba) ? aba : "tipos";
    $$("[role=tab]", raiz).forEach((a) => {
      const sel = a.dataset.aba === abaAtual;
      a.setAttribute("aria-selected", String(sel));
      a.tabIndex = sel ? 0 : -1;
      /* No celular as abas rolam na horizontal: deixa a aba ativa à vista */
      if (sel && a.parentElement.scrollWidth > a.parentElement.clientWidth) a.parentElement.scrollLeft = a.offsetLeft - 16;
    });
    conteudo.setAttribute("aria-labelledby", `aba-painel-${abaAtual}`);
    const rolagem = conteudo.scrollTop;
    conteudo.innerHTML = ({ tipos: htmlTipos, listas: htmlListas, campos: htmlCampos, modelos: htmlModelos, conteudo: htmlConteudo, historico: htmlHistorico })[abaAtual]();
    conteudo.scrollTop = rolagem;
    if (abaAtual === "historico") carregarHistorico();
    atualizarBarra();
  }
  const cabecalhoAba = (titulo, texto, restaurar = true) => `<div class="aba-cab"><div><h3>${escapar(titulo)}</h3><p class="apoio">${texto}</p></div>
    ${restaurar ? `<button type="button" class="btn btn-secundario btn-mini" data-acao="restaurar-aba">${svg("i-desfazer")}Restaurar padrão</button>` : ""}</div>`;

  /* ============================================================
   *  a) Tipos de nó
   * ============================================================ */
  const contarTipo = () => { const c = {}; todosOsNos().forEach(({ n }) => { c[n.tipo] = (c[n.tipo] || 0) + 1; }); return c; };
  function htmlPrevia(t) {
    const x = E().tipos[t];
    return `<svg class="quadro previa-no" viewBox="0 0 240 74" role="img" aria-label="Prévia do nó ${escapar(x.nome)}">
      <g class="no tom-${x.cor}" transform="translate(4 4)">
        <rect class="no-caixa" width="224" height="66" rx="10"/><rect class="no-faixa" width="5" height="50" x="0" y="8" rx="2.5"/>
        <svg class="no-icone" x="14" y="9" width="16" height="16" viewBox="0 0 24 24"><use href="#${escapar(x.icone)}"/></svg>
        <text class="no-tipo" x="36" y="22">${escapar((x.nome || "").toUpperCase())}</text>
        <text class="no-titulo" x="14" y="47">Exemplo de título</text>
      </g></svg>`;
  }
  function htmlTipos() {
    const e = E();
    const uso = contarTipo();
    return `${cabecalhoAba("Tipos de nó", "O nome, a cor e o ícone valem para todos os mapas na hora em que você salvar. O identificador interno de cada tipo não muda, então nenhum dado se perde.")}
      <ol class="lista-tipos">${e.ordemTipos.map((t, i) => {
        const x = e.tipos[t];
        return `<li class="cartao-tipo tom-${x.cor}" data-tipo="${t}">
          <div class="cartao-tipo-topo">
            <span class="selo">${escapar(t)}</span>
            <span class="apoio">${uso[t] ? `${uso[t]} ${uso[t] === 1 ? "nó" : "nós"} nos mapas` : '<span class="selo selo-amarelo">sem uso</span>'}</span>
            <span class="ordem-botoes"><button type="button" class="btn-icone" data-acao="tipo-subir" ${i === 0 ? "disabled" : ""} aria-label="Subir ${escapar(x.nome)} no menu">${svg("i-seta-cima")}</button>
            <button type="button" class="btn-icone" data-acao="tipo-descer" ${i === e.ordemTipos.length - 1 ? "disabled" : ""} aria-label="Descer ${escapar(x.nome)} no menu">${svg("i-seta-baixo")}</button></span>
          </div>
          <div class="cartao-tipo-corpo">
            <div class="previa-tipo">${htmlPrevia(t)}</div>
            <div class="grade-campos">
              <label class="campo"><span class="rotulo">Nome na tela</span><input data-k="tipo-nome" value="${escapar(x.nome)}" maxlength="40" required></label>
              <label class="campo"><span class="rotulo">Filho sugerido (Tab)</span><select data-k="tipo-filho">${IDS_TIPOS.filter((o) => o !== "sistema").map((o) => `<option value="${o}"${o === x.filhoPadrao ? " selected" : ""}>${escapar(e.tipos[o].nome)}</option>`).join("")}</select></label>
              <label class="campo campo-cheio"><span class="rotulo">Texto de ajuda</span><input data-k="tipo-ajuda" value="${escapar(x.ajuda)}" maxlength="200"></label>
              <fieldset class="escolha-cores campo-cheio"><legend class="rotulo">Cor</legend>${Object.entries(CORES).map(([c, nome]) =>
                `<label class="tom-${c}"><input type="radio" name="cor-${t}" data-k="tipo-cor" value="${c}"${c === x.cor ? " checked" : ""}><span class="amostra"></span>${escapar(nome)}</label>`).join("")}</fieldset>
              <details class="escolha-icone campo-cheio"><summary><span class="rotulo">Ícone</span> ${svg(x.icone)}<span class="apoio">trocar</span></summary>
                <fieldset class="escolha-icones"><legend class="sr-only">Ícone de ${escapar(x.nome)}</legend>${ICONES_TIPOS.map((ic) =>
                  `<label title="${escapar(ic.slice(2))}"><input type="radio" name="icone-${t}" data-k="tipo-icone" value="${ic}"${ic === x.icone ? " checked" : ""}><span>${svg(ic)}</span><span class="sr-only">${escapar(ic.slice(2))}</span></label>`).join("")}</fieldset>
              </details>
            </div>
          </div>
        </li>`;
      }).join("")}</ol>`;
  }

  /* ============================================================
   *  b) Listas de opções
   * ============================================================ */
  function listasDeEscolha() {
    const r = [];
    IDS_TIPOS.forEach((t) => (E().campos[t] || []).forEach((c) => { if (c.tipo === "escolha") r.push({ t, c }); }));
    return r;
  }
  function htmlListas() {
    const listas = listasDeEscolha();
    return `${cabecalhoAba("Listas de opções", "Cada opção tem um identificador fixo e um rótulo. Renomear muda só o rótulo, e os nós antigos já aparecem com o nome novo. Arquivar esconde a opção das novas escolhas; os nós que já a usam continuam iguais.")}
      ${listas.map(({ t, c }) => {
        const fora = foraDaLista(t, c);
        const ativas = c.opcoes.filter((o) => !o.arquivada).length;
        return `<section class="cartao-lista" data-tipo="${t}" data-campo="${escapar(c.id)}">
          <h4><span class="selo tom-${E().tipos[t].cor}">${escapar(E().tipos[t].nome)}</span> ${escapar(c.rotulo)} ${c.personalizado ? '<span class="selo">personalizado</span>' : ""}</h4>
          ${!ativas ? `<p class="form-erro">A lista precisa de pelo menos uma opção ativa.</p>` : ""}
          ${fora.length ? `<p class="aviso-painel">${svg("i-alerta")}${fora.length} ${fora.length === 1 ? "nó tem" : "nós têm"} um valor que não está na lista (${escapar([...new Set(fora.map(({ n }) => valorDoCampo(n, c)))].slice(0, 4).join(", "))}). O valor fica guardado e aparece como "fora da lista".</p>` : ""}
          <ol class="opcoes">${c.opcoes.map((o, i) => {
            const n = usoDaOpcao(t, c.id, o.id).length;
            return `<li class="opcao${o.arquivada ? " arquivada" : ""}" data-opcao="${escapar(o.id)}">
              <input data-k="opcao-rotulo" value="${escapar(o.rotulo)}" maxlength="60" aria-label="Rótulo da opção ${escapar(o.rotulo)}">
              <select data-k="opcao-cor" aria-label="Cor do selo de ${escapar(o.rotulo)}"><option value="">Sem cor</option>${Object.entries(CORES).map(([k, nome]) => `<option value="${k}"${o.cor === k ? " selected" : ""}>${escapar(nome)}</option>`).join("")}</select>
              <span class="selo ${corSelo(o.cor)} previa-opcao">${escapar(o.rotulo)}</span>
              <span class="apoio uso">${n ? `${n} ${n === 1 ? "nó" : "nós"}` : "sem uso"}${o.arquivada ? " · arquivada" : ""}</span>
              <span class="ordem-botoes">
                <button type="button" class="btn-icone" data-acao="opcao-subir" ${i === 0 ? "disabled" : ""} aria-label="Subir ${escapar(o.rotulo)}">${svg("i-seta-cima")}</button>
                <button type="button" class="btn-icone" data-acao="opcao-descer" ${i === c.opcoes.length - 1 ? "disabled" : ""} aria-label="Descer ${escapar(o.rotulo)}">${svg("i-seta-baixo")}</button>
                <button type="button" class="btn btn-secundario btn-mini" data-acao="${o.arquivada ? "opcao-desarquivar" : "opcao-arquivar"}">${o.arquivada ? "Reativar" : "Arquivar"}</button>
                <button type="button" class="btn-icone" data-acao="opcao-remover" aria-label="Remover ${escapar(o.rotulo)}">${svg("i-lixeira")}</button>
              </span>
            </li>`;
          }).join("")}</ol>
          <form class="nova-opcao" data-acao-form="nova-opcao"><label class="sr-only" for="nova-${t}-${escapar(c.id)}">Nova opção para ${escapar(c.rotulo)}</label>
            <input id="nova-${t}-${escapar(c.id)}" name="rotulo" maxlength="60" placeholder="Nova opção…"><button type="submit" class="btn btn-secundario btn-mini">${svg("i-mais")}Opção</button></form>
        </section>`;
      }).join("") || `<p class="apoio">Nenhum campo do tipo "escolha". Crie um na aba Campos de cada tipo.</p>`}`;
  }

  /* ============================================================
   *  c) Campos de cada tipo
   * ============================================================ */
  function htmlCampos() {
    const e = E();
    const lista = e.campos[tipoCampos] || [];
    const personalizados = lista.filter((c) => c.personalizado).length;
    return `${cabecalhoAba("Campos de cada tipo", "Mude rótulo, dica e ordem; marque como obrigatório ou oculte. Os campos personalizados ficam guardados à parte em cada nó (até 20 por tipo). Ocultar ou remover um campo NÃO apaga o que já foi preenchido.")}
      <div class="pilulas" role="group" aria-label="Tipo de nó">${e.ordemTipos.map((t) => `<button type="button" class="pilula tom-${e.tipos[t].cor}" data-acao="campos-tipo" data-tipo="${t}" aria-pressed="${t === tipoCampos}">${svg(e.tipos[t].icone)}${escapar(e.tipos[t].nome)}</button>`).join("")}</div>
      ${lista.length ? `<ol class="lista-campos">${lista.map((c, i) => `<li class="linha-campo${c.oculto ? " oculto" : ""}" data-campo="${escapar(c.id)}">
        <span class="selo">${escapar(TIPOS_CAMPO[c.tipo] || c.tipo)}${c.personalizado ? " · personalizado" : ""}</span>
        <label class="campo"><span class="rotulo">Rótulo</span><input data-k="campo-rotulo" value="${escapar(c.rotulo)}" maxlength="60"></label>
        <label class="campo"><span class="rotulo">Dica (placeholder)</span><input data-k="campo-dica" value="${escapar(c.dica || "")}" maxlength="120"></label>
        <label class="check"><input type="checkbox" data-k="campo-obrigatorio"${c.obrigatorio ? " checked" : ""}><span>Obrigatório</span></label>
        <label class="check"><input type="checkbox" data-k="campo-oculto"${c.oculto ? " checked" : ""}><span>Oculto</span></label>
        <span class="ordem-botoes">
          <button type="button" class="btn-icone" data-acao="campo-subir" ${i === 0 ? "disabled" : ""} aria-label="Subir ${escapar(c.rotulo)}">${svg("i-seta-cima")}</button>
          <button type="button" class="btn-icone" data-acao="campo-descer" ${i === lista.length - 1 ? "disabled" : ""} aria-label="Descer ${escapar(c.rotulo)}">${svg("i-seta-baixo")}</button>
          ${c.personalizado ? `<button type="button" class="btn-icone" data-acao="campo-remover" aria-label="Remover o campo ${escapar(c.rotulo)}">${svg("i-lixeira")}</button>` : ""}
        </span>
      </li>`).join("")}</ol>` : `<p class="apoio">Este tipo ainda não tem campos próprios.</p>`}
      <button type="button" class="btn btn-secundario btn-mini" data-acao="campo-novo" ${personalizados >= LIMITE_EXTRAS ? "disabled" : ""}>${svg("i-mais")}Campo personalizado</button>`;
  }
  function novoCampo() {
    const d = criarDialogo({
      titulo: `Novo campo em "${E().tipos[tipoCampos].nome}"`,
      corpo: `<label class="campo"><span class="rotulo">Rótulo</span><input name="rotulo" maxlength="60" required placeholder="ex.: Ambiente afetado"></label>
        <label class="campo"><span class="rotulo">Tipo de campo</span><select name="tipo">${Object.entries(TIPOS_CAMPO).map(([k, v]) => `<option value="${k}">${escapar(v)}</option>`).join("")}</select></label>
        <label class="campo" data-so-escolha hidden><span class="rotulo">Opções (uma por linha)</span><textarea name="opcoes" rows="4"></textarea></label>
        <label class="campo"><span class="rotulo">Dica (opcional)</span><input name="dica" maxlength="120"></label>
        <p class="form-erro" role="alert"></p>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Adicionar</button></div>`
    });
    const f = d.querySelector("form");
    f.tipo.addEventListener("change", () => { f.querySelector("[data-so-escolha]").hidden = f.tipo.value !== "escolha"; });
    f.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const rotulo = f.rotulo.value.trim();
      const erro = f.querySelector(".form-erro");
      if (!rotulo) { erro.textContent = "Informe o rótulo."; return; }
      const lista = E().campos[tipoCampos];
      let id = slug(rotulo, 30).replace(/^[^a-z]+/, "") || "campo";
      const usados = new Set([...CAMPOS_PERMITIDOS, ...lista.map((c) => c.id)]);
      let n = 2; const base = id;
      while (usados.has(id)) id = `${base}-${n++}`.slice(0, 40);
      if (!ID_CAMPO_EXTRA.test(id)) { erro.textContent = "Use letras no rótulo."; return; }
      const campo = { id, tipo: f.tipo.value, rotulo, dica: f.dica.value.trim(), obrigatorio: false, oculto: false, personalizado: true };
      if (campo.tipo === "escolha") {
        const rotulos = [...new Set(f.opcoes.value.split("\n").map((x) => x.trim()).filter(Boolean))];
        if (!rotulos.length) { erro.textContent = "Informe pelo menos uma opção."; return; }
        campo.opcoes = rotulos.slice(0, 60).map((r) => ({ id: r.slice(0, 60), rotulo: r.slice(0, 60) }));
      }
      lista.push(campo);
      marcar("estrutura");
      d.close();
      desenhar("campos");
      mostrarAviso(`Campo "${rotulo}" adicionado. Clique em Salvar para valer nos mapas.`);
    });
    d.showModal();
    f.rotulo.focus();
  }

  /* ============================================================
   *  d) Modelos de mapa
   * ============================================================ */
  function htmlArvoreModelo(mod) {
    const idx = indexar(mod.nos);
    const linhas = [];
    const andar = (n, nivel) => {
      linhas.push({ n, nivel });
      (idx.filhos.get(n.id) || []).forEach((f) => andar(f, nivel + 1));
    };
    if (idx.raiz) andar(idx.raiz, 0);
    const e = E();
    return `<ol class="arvore-modelo">${linhas.map(({ n, nivel }) => {
      const raizNo = !n.paiId;
      return `<li class="no-modelo" data-no="${escapar(n.id)}" style="--nivel:${nivel}">
        <select data-k="modelo-no-tipo" aria-label="Tipo"${raizNo ? " disabled" : ""}>${e.ordemTipos.filter((t) => raizNo || t !== "sistema").map((t) => `<option value="${t}"${t === n.tipo ? " selected" : ""}>${escapar(e.tipos[t].nome)}</option>`).join("")}</select>
        <input data-k="modelo-no-titulo" value="${escapar(raizNo ? "(nome do sistema)" : n.titulo)}" maxlength="${LIMITES.titulo}" aria-label="Título"${raizNo ? " disabled" : ""}>
        <span class="ordem-botoes">
          ${raizNo ? "" : `<button type="button" class="btn-icone" data-acao="mno-esquerda" aria-label="Subir um nível">${svg("i-chevron-esquerda")}</button>
          <button type="button" class="btn-icone" data-acao="mno-direita" aria-label="Descer um nível (vira filho do anterior)">${svg("i-chevron-direita")}</button>
          <button type="button" class="btn-icone" data-acao="mno-subir" aria-label="Subir">${svg("i-seta-cima")}</button>
          <button type="button" class="btn-icone" data-acao="mno-descer" aria-label="Descer">${svg("i-seta-baixo")}</button>`}
          <button type="button" class="btn-icone" data-acao="mno-filho" aria-label="Adicionar filho">${svg("i-mais")}</button>
          ${raizNo ? "" : `<button type="button" class="btn-icone" data-acao="mno-remover" aria-label="Remover (com o que estiver abaixo)">${svg("i-lixeira")}</button>`}
        </span>
      </li>`;
    }).join("")}</ol>`;
  }
  function htmlModelos() {
    const lista = M().lista;
    return `${cabecalhoAba("Modelos de mapa", 'Os modelos aparecem em "+ Novo mapa". O nó raiz recebe o nome do sistema na criação. Para salvar um mapa existente como modelo, use o menu do mapa (ícone de download → "Salvar como modelo de mapa").')}
      <ol class="lista-modelos">${lista.map((mod, i) => `<li class="cartao-modelo" data-modelo="${escapar(mod.id)}">
        <div class="cartao-modelo-topo">
          <label class="campo"><span class="rotulo">Nome</span><input data-k="modelo-nome" value="${escapar(mod.nome)}" maxlength="60"></label>
          <label class="campo campo-largo"><span class="rotulo">Descrição</span><input data-k="modelo-descricao" value="${escapar(mod.descricao)}" maxlength="200"></label>
          <span class="ordem-botoes">
            <button type="button" class="btn-icone" data-acao="modelo-subir" ${i === 0 ? "disabled" : ""} aria-label="Subir ${escapar(mod.nome)}">${svg("i-seta-cima")}</button>
            <button type="button" class="btn-icone" data-acao="modelo-descer" ${i === lista.length - 1 ? "disabled" : ""} aria-label="Descer ${escapar(mod.nome)}">${svg("i-seta-baixo")}</button>
            <button type="button" class="btn-icone" data-acao="modelo-duplicar" aria-label="Duplicar ${escapar(mod.nome)}">${svg("i-duplicar")}</button>
            <button type="button" class="btn-icone" data-acao="modelo-remover" ${lista.length <= 1 ? "disabled" : ""} aria-label="Remover ${escapar(mod.nome)}">${svg("i-lixeira")}</button>
          </span>
        </div>
        <details${modelosAbertos.has(mod.id) ? " open" : ""} data-detalhes-modelo><summary>Estrutura: ${mod.nos.length} ${mod.nos.length === 1 ? "nó" : "nós"}</summary>${htmlArvoreModelo(mod)}</details>
      </li>`).join("")}</ol>
      <button type="button" class="btn btn-secundario btn-mini" data-acao="modelo-novo" ${lista.length >= LIMITE_MODELOS ? "disabled" : ""}>${svg("i-mais")}Novo modelo</button>`;
  }
  const modeloDe = (el) => M().lista.find((x) => x.id === el.closest("[data-modelo]").dataset.modelo);
  function idModeloUnico(base) {
    let id = slug(base, 40) || "modelo", n = 2;
    const usados = new Set(M().lista.map((x) => x.id));
    const b = id;
    while (usados.has(id)) id = `${b}-${n++}`;
    return id;
  }
  function filhosModelo(mod, paiId) { return mod.nos.filter((n) => (n.paiId || null) === paiId).sort((a, b) => a.ordem - b.ordem); }
  function renumerar(mod, paiId) { filhosModelo(mod, paiId).forEach((n, k) => { n.ordem = k; }); }
  function acaoNoModelo(acao, mod, id) {
    const n = mod.nos.find((x) => x.id === id);
    if (!n) return;
    const irmaos = filhosModelo(mod, n.paiId || null);
    const i = irmaos.indexOf(n);
    if (acao === "mno-filho") {
      if (mod.nos.length >= LIMITE_NOS_MODELO) { mostrarAviso(`Limite de ${LIMITE_NOS_MODELO} nós por modelo.`); return; }
      const tipo = E().tipos[n.tipo].filhoPadrao || "nota";
      mod.nos.push(normalizarNo({ id: idCurto(), tipo, titulo: `Novo ${E().tipos[tipo].nome.toLowerCase()}`, paiId: n.id, ordem: filhosModelo(mod, n.id).length }));
    } else if (acao === "mno-remover") {
      const remover = new Set([n.id]);
      let mudou = true;
      while (mudou) { mudou = false; mod.nos.forEach((x) => { if (x.paiId && remover.has(x.paiId) && !remover.has(x.id)) { remover.add(x.id); mudou = true; } }); }
      mod.nos = mod.nos.filter((x) => !remover.has(x.id));
      mod.nos.forEach((x) => { x.ligacoes = (x.ligacoes || []).filter((l) => !remover.has(l.para)); });
    } else if (acao === "mno-subir" && i > 0) { [irmaos[i - 1].ordem, n.ordem] = [n.ordem, irmaos[i - 1].ordem]; }
    else if (acao === "mno-descer" && i < irmaos.length - 1) { [irmaos[i + 1].ordem, n.ordem] = [n.ordem, irmaos[i + 1].ordem]; }
    else if (acao === "mno-direita" && i > 0) { const novoPai = irmaos[i - 1]; n.paiId = novoPai.id; n.ordem = filhosModelo(mod, novoPai.id).length + 1; renumerar(mod, novoPai.id); renumerar(mod, irmaos[0].paiId || null); }
    else if (acao === "mno-esquerda") {
      const pai = mod.nos.find((x) => x.id === n.paiId);
      if (!pai || !pai.paiId) return;
      const antigo = pai.id;
      n.paiId = pai.paiId;
      n.ordem = pai.ordem + 0.5;
      renumerar(mod, pai.paiId); renumerar(mod, antigo);
    } else return;
    modelosAbertos.add(mod.id);
    marcar("modelos");
    desenhar("modelos");
    requestAnimationFrame(() => { const el = conteudo.querySelector(`[data-modelo="${CSS.escape(mod.id)}"] [data-no="${CSS.escape(id)}"] input`); if (el && !el.disabled) el.focus(); });
  }
  function salvarMapaComoModelo(mapa, nos) {
    if (!app.podeUsarPainel()) return;
    garantir();
    if (M().lista.length >= LIMITE_MODELOS) { mostrarAviso(`Limite de ${LIMITE_MODELOS} modelos.`); return; }
    if (nos.length > LIMITE_NOS_MODELO) { mostrarAviso(`O mapa tem mais de ${LIMITE_NOS_MODELO} nós: grande demais para virar modelo.`); return; }
    const { nos: copia } = clonarNos(nos, true);
    const mod = normalizarModelo({ id: idModeloUnico(`modelo-${mapa.nome}`), nome: `Modelo: ${mapa.nome}`.slice(0, 60), descricao: `Baseado no mapa ${mapa.nome}.`,
      nos: copia.map((n) => ({ ...n, tags: [], pos: null, revisadoEm: "" })) });
    if (!mod) { mostrarAviso("Não foi possível criar o modelo (mapa sem raiz)."); return; }
    M().lista.push(mod);
    modelosAbertos.add(mod.id);
    marcar("modelos");
    app.ir("#painel/modelos");
    mostrarAviso(`Modelo "${mod.nome}" criado no rascunho. Confira e clique em Salvar.`, { ms: 6000 });
  }

  /* ============================================================
   *  e) Conteúdo em massa
   * ============================================================ */
  function nosFiltrados() {
    return todosOsNos().filter(({ m, n }) => (!filtro.mapa || m.id === filtro.mapa) && (!filtro.tipo || n.tipo === filtro.tipo)
      && (!filtro.tag || (n.tags || []).includes(filtro.tag)) && (!filtro.vencidos || revisaoVencida(n))
      && (!filtro.busca || corresponde(textoDoNo(n), filtro.busca)));
  }
  function htmlConteudo() {
    const e = app.estado;
    const tags = [...new Set(todosOsNos().flatMap(({ n }) => n.tags || []))].sort();
    const lista = nosFiltrados();
    const est = E();
    const linhas = lista.slice(0, 300);
    return `${cabecalhoAba("Conteúdo em massa", "Todos os nós de todos os mapas. Edite título e tipo direto na tabela e clique em \"Salvar alterações da tabela\"; os outros campos abrem no editor do nó. O \"Buscar e substituir\" mostra a prévia antes de gravar.", false)}
      <div class="filtros-conteudo">
        <label class="campo"><span class="rotulo">Mapa</span><select data-k="f-mapa"><option value="">Todos</option>${e.mapas.map((m) => `<option value="${escapar(m.id)}"${filtro.mapa === m.id ? " selected" : ""}>${escapar(m.nome)}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Tipo</span><select data-k="f-tipo"><option value="">Todos</option>${est.ordemTipos.map((t) => `<option value="${t}"${filtro.tipo === t ? " selected" : ""}>${escapar(est.tipos[t].nome)}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Etiqueta</span><select data-k="f-tag"><option value="">Todas</option>${tags.map((t) => `<option${filtro.tag === t ? " selected" : ""}>${escapar(t)}</option>`).join("")}</select></label>
        <label class="campo"><span class="rotulo">Contém</span><input type="search" data-k="f-busca" value="${escapar(filtro.busca)}" placeholder="texto"></label>
        <label class="check"><input type="checkbox" data-k="f-vencidos"${filtro.vencidos ? " checked" : ""}><span>Revisado há mais de 90 dias</span></label>
      </div>
      <details class="substituir"><summary>${svg("i-busca")}Buscar e substituir</summary>
        <form class="form-substituir" data-acao-form="substituir">
          <label class="campo"><span class="rotulo">Buscar</span><input name="buscar" required maxlength="200"></label>
          <label class="campo"><span class="rotulo">Substituir por</span><input name="trocar" maxlength="200"></label>
          <label class="campo"><span class="rotulo">Onde</span><select name="onde"><option value="tudo">Título, descrição e campos de texto</option><option value="titulo">Só títulos</option><option value="descricao">Só descrições</option><option value="campos">Só campos de texto</option></select></label>
          <label class="check"><input type="checkbox" name="caixa"><span>Diferenciar maiúsculas</span></label>
          <button type="submit" class="btn btn-secundario btn-mini">Pré-visualizar</button>
          <p class="apoio">Vale para os nós filtrados acima (${lista.length}). Campos de escolha não entram: use a aba Listas de opções.</p>
        </form>
        <div class="previa-substituir" aria-live="polite"></div>
      </details>
      <div class="barra-tabela"><span class="apoio">${lista.length} ${lista.length === 1 ? "nó" : "nós"}${lista.length > linhas.length ? ` (mostrando os primeiros ${linhas.length}; refine os filtros)` : ""}</span>
        <button type="button" class="btn btn-mini" data-acao="salvar-tabela" ${pendentesConteudo.size ? "" : "disabled"}>${svg("i-salvar")}Salvar alterações da tabela${pendentesConteudo.size ? ` (${pendentesConteudo.size})` : ""}</button></div>
      <div class="tabela-rolagem"><table class="tabela-nos">
        <thead><tr><th scope="col">Mapa</th><th scope="col">Tipo</th><th scope="col">Título</th><th scope="col">Campos</th><th scope="col">Revisado</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${linhas.map(({ m, n }) => {
          const p = pendentesConteudo.get(n.id) || {};
          const tipo = p.tipo || n.tipo;
          const resumo = Object.entries({ ...n.campos, ...n.extras }).slice(0, 3).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length + " itens" : String(v).slice(0, 30)}`).join(" · ");
          return `<tr data-no="${escapar(n.id)}" data-mapa="${escapar(m.id)}" class="${pendentesConteudo.has(n.id) ? "alterada" : ""}">
            <td>${escapar(m.nome)}</td>
            <td><select data-k="t-tipo" aria-label="Tipo de ${escapar(n.titulo)}"${n.paiId ? "" : " disabled"}>${est.ordemTipos.filter((t) => !n.paiId || t !== "sistema").map((t) => `<option value="${t}"${t === tipo ? " selected" : ""}>${escapar(est.tipos[t].nome)}</option>`).join("")}</select></td>
            <td><input data-k="t-titulo" value="${escapar(p.titulo != null ? p.titulo : n.titulo)}" maxlength="${LIMITES.titulo}" aria-label="Título"></td>
            <td class="apoio">${escapar(resumo)}</td>
            <td class="${revisaoVencida(n) ? "vencido" : ""}">${n.revisadoEm ? formatarData(n.revisadoEm) : (n.tipo === "teste" || n.tipo === "contato" ? "nunca" : "—")}</td>
            <td><button type="button" class="btn-icone" data-acao="t-editar" aria-label="Editar todos os campos de ${escapar(n.titulo)}">${svg("i-lapis")}</button>
              <a class="btn-icone" href="#m/${escapar(m.id)}/n/${escapar(n.id)}" aria-label="Abrir ${escapar(n.titulo)} no mapa">${svg("i-externo")}</a></td>
          </tr>`;
        }).join("") || `<tr><td colspan="6" class="apoio">Nenhum nó com esses filtros.</td></tr>`}</tbody>
      </table></div>`;
  }
  function previaSubstituir(f) {
    const buscar = f.buscar.value;
    if (!buscar) return [];
    const flags = f.caixa.checked ? "g" : "gi";
    const re = new RegExp(buscar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    const trocar = f.trocar.value;
    const onde = f.onde.value;
    const mudancas = [];
    nosFiltrados().forEach(({ m, n }) => {
      const def = (k) => (E().campos[n.tipo] || []).find((c) => c.id === k);
      const alvo = { titulo: n.titulo, descricao: n.descricao, campos: clonar(n.campos || {}), extras: clonar(n.extras || {}) };
      const itens = [];
      const trocarEm = (texto, rotulo, aplicar) => { if (typeof texto !== "string" || !re.test(texto)) return; re.lastIndex = 0; const novo = texto.replace(re, trocar); re.lastIndex = 0; itens.push({ rotulo, antes: texto, depois: novo }); aplicar(novo); };
      if (onde === "tudo" || onde === "titulo") trocarEm(n.titulo, "Título", (v) => { alvo.titulo = v; });
      if (onde === "tudo" || onde === "descricao") trocarEm(n.descricao, "Descrição", (v) => { alvo.descricao = v; });
      if (onde === "tudo" || onde === "campos") {
        [["campos", alvo.campos], ["extras", alvo.extras]].forEach(([grupo, obj]) => Object.keys(obj).forEach((k) => {
          const d = def(k);
          if (d && d.tipo === "escolha") return;
          const rot = d ? d.rotulo : k;
          if (Array.isArray(obj[k])) obj[k].forEach((v, i) => trocarEm(v, `${rot} (${i + 1})`, (nv) => { obj[k][i] = nv; }));
          else trocarEm(obj[k], rot, (nv) => { obj[k] = nv; });
        }));
      }
      if (itens.length) mudancas.push({ m, n, itens, novo: { ...n, ...alvo } });
    });
    return mudancas;
  }
  async function aplicarSubstituicao(mudancas) {
    const total = mudancas.reduce((s, x) => s + x.itens.length, 0);
    if (!(await confirmar(`Gravar ${total} ${total === 1 ? "troca" : "trocas"} em ${mudancas.length} ${mudancas.length === 1 ? "nó" : "nós"}?`, { titulo: "Buscar e substituir", botao: "Gravar" }))) return;
    const porMapa = new Map();
    mudancas.forEach(({ m, novo }) => { if (!porMapa.has(m.id)) porMapa.set(m.id, []); porMapa.get(m.id).push(normalizarNo(novo)); });
    let ok = true;
    for (const [mapaId, nos] of porMapa) ok = (await app.gravarNos(mapaId, nos)) && ok;
    if (ok) {
      registrarAuditoria({ acao: "editar", alvo: "mapas", resumo: `Painel: buscar e substituir (${mudancas.length} nós)`, detalhes: [...porMapa.keys()].join(", ") });
      mostrarAviso(`Substituição gravada em ${mudancas.length} ${mudancas.length === 1 ? "nó" : "nós"}.`);
      desenhar("conteudo");
    }
  }
  async function salvarTabela() {
    const porMapa = new Map();
    pendentesConteudo.forEach((p, noId) => {
      const n = app.nosDe(p.mapaId).find((x) => x.id === noId);
      if (!n) return;
      const titulo = p.titulo != null ? p.titulo.trim() : n.titulo;
      if (!titulo) return;
      if (!porMapa.has(p.mapaId)) porMapa.set(p.mapaId, []);
      porMapa.get(p.mapaId).push(normalizarNo({ ...n, titulo, tipo: p.tipo || n.tipo }));
    });
    let ok = true;
    for (const [mapaId, nos] of porMapa) ok = (await app.gravarNos(mapaId, nos)) && ok;
    if (ok) {
      const n = pendentesConteudo.size;
      pendentesConteudo.clear();
      registrarAuditoria({ acao: "editar", alvo: "mapas", resumo: `Painel: edição em massa (${n} nós)`, detalhes: [...porMapa.keys()].join(", ") });
      mostrarAviso("Alterações da tabela gravadas.");
      desenhar("conteudo");
    }
  }

  /* ============================================================
   *  f) Histórico
   * ============================================================ */
  let versoes = null;
  function htmlHistorico() {
    return `${cabecalhoAba("Histórico", "Cada salvamento do painel guarda uma versão. Compare com a configuração atual ou restaure uma versão (a restauração também vira uma versão nova).", false)}
      <div class="lista-versoes" aria-live="polite"><p class="apoio">Carregando…</p></div>`;
  }
  async function carregarHistorico() {
    const caixa = conteudo.querySelector(".lista-versoes");
    try {
      const api = app.api();
      const [a, b] = await Promise.all(["estrutura", "modelos"].map((doc) => api.lerColecao(`mapas-config/${doc}/versoes`).then((l) => l.map((v) => ({ ...v, doc })))));
      versoes = [...a, ...b].sort((x, y) => String(y.em).localeCompare(String(x.em)));
    } catch (e) { console.warn(e); caixa.innerHTML = `<p class="form-erro">Não foi possível ler o histórico.</p>`; return; }
    if (abaAtual !== "historico") return;
    caixa.innerHTML = versoes.length ? `<ol class="versoes">${versoes.map((v) => `<li data-versao="${escapar(v.id)}" data-doc="${v.doc}">
        <div><strong>${formatarData(v.em, true)}</strong> · ${escapar(app.nomeDe(v.por))} <span class="selo">${escapar(NOME_DOC[v.doc])}</span>
          <p class="apoio">${escapar(v.resumo || "")}</p></div>
        <span class="ordem-botoes"><button type="button" class="btn btn-secundario btn-mini" data-acao="versao-comparar">Comparar com a atual</button>
        <button type="button" class="btn btn-secundario btn-mini" data-acao="versao-restaurar">Restaurar esta versão</button></span>
      </li>`).join("")}</ol>` : `<p class="apoio">Ainda não há versões: a primeira aparece quando você salvar o painel.</p>`;
  }
  const dadosAtuais = (doc) => (doc === "estrutura" ? (({ tipos, ordemTipos, campos }) => ({ tipos, ordemTipos, campos }))(ativo("estrutura")) : { lista: clonar(MODELOS) });
  function compararVersao(v) {
    const dif = diferencas(v.dados || {}, dadosAtuais(v.doc));
    const d = criarDialogo({
      titulo: `Comparar: ${formatarData(v.em, true)} × atual`, largo: true,
      corpo: `<p class="apoio">${escapar(NOME_DOC[v.doc])}. ${dif.length ? `${dif.length} ${dif.length === 1 ? "diferença" : "diferenças"}.` : "Nenhuma diferença: esta versão é igual à configuração atual."}</p>
        ${dif.length ? `<div class="tabela-rolagem"><table class="tabela-dif"><thead><tr><th>O quê</th><th>Nesta versão</th><th>Atual</th></tr></thead><tbody>${dif.slice(0, 200).map((x) => `<tr><td><code>${escapar(x.caminho)}</code></td><td>${escapar(x.antes || "—")}</td><td>${escapar(x.depois || "—")}</td></tr>`).join("")}</tbody></table></div>` : ""}
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Fechar</button></div>`
    });
    d.showModal();
  }
  async function restaurarVersao(v) {
    if (sujo[v.doc] && !(await confirmar("Há alterações não salvas nesta parte do painel. Elas serão substituídas pela versão escolhida.", { titulo: "Restaurar versão", botao: "Continuar" }))) return;
    if (!(await confirmar(`Restaurar a versão de ${formatarData(v.em, true)} (${NOME_DOC[v.doc]})? Ela passa a valer para todos os mapas.`, { titulo: "Restaurar versão", botao: "Restaurar" }))) return;
    if (v.doc === "estrutura") rascunho.estrutura = mesclarEstrutura(v.dados);
    else rascunho.modelos = { lista: (v.dados && Array.isArray(v.dados.lista) ? v.dados.lista.map(normalizarModelo).filter(Boolean) : modelosPadraoNormalizados()) };
    sujo[v.doc] = true;
    await salvar(`Restaurou a versão de ${formatarData(v.em, true)}`);
    desenhar("historico");
  }

  /* ============================================================
   *  Validação e gravação
   * ============================================================ */
  function validar() {
    const erros = [];
    const e = E();
    IDS_TIPOS.forEach((t) => { if (!String(e.tipos[t].nome || "").trim()) erros.push(`O tipo "${t}" está sem nome.`); });
    const nomes = IDS_TIPOS.map((t) => normalizar(e.tipos[t].nome).trim());
    if (new Set(nomes).size !== nomes.length) erros.push("Dois tipos estão com o mesmo nome.");
    IDS_TIPOS.forEach((t) => (e.campos[t] || []).forEach((c) => {
      if (!String(c.rotulo || "").trim()) erros.push(`Um campo de "${e.tipos[t].nome}" está sem rótulo.`);
      if (c.tipo !== "escolha") return;
      const rot = c.opcoes.map((o) => normalizar(o.rotulo).trim());
      if (rot.some((r) => !r)) erros.push(`"${c.rotulo}" (${e.tipos[t].nome}) tem opção sem rótulo.`);
      if (new Set(rot).size !== rot.length) erros.push(`"${c.rotulo}" (${e.tipos[t].nome}) tem opções com o mesmo rótulo.`);
      if (!c.opcoes.some((o) => !o.arquivada)) erros.push(`"${c.rotulo}" (${e.tipos[t].nome}) precisa de pelo menos uma opção ativa.`);
    }));
    M().lista.forEach((m) => { if (!String(m.nome || "").trim()) erros.push("Há um modelo sem nome."); });
    return erros;
  }
  async function salvar(resumoForcado = "") {
    if (!app.podeUsarPainel()) { mostrarAviso("Só administradoras podem salvar o painel."); return false; }
    const erros = validar();
    if (erros.length) {
      const d = criarDialogo({ titulo: "Corrija antes de salvar", corpo: `<ul class="lista-erros">${erros.map((x) => `<li>${escapar(x)}</li>`).join("")}</ul><div class="form-botoes"><button type="button" class="btn" data-fechar>Entendi</button></div>` });
      d.showModal();
      return false;
    }
    const api = app.api();
    const ops = [];
    const resumos = [];
    const aplicar = [];
    const versaoId = `v${Date.now().toString(36)}`;
    ["estrutura", "modelos"].forEach((doc) => {
      if (!sujo[doc]) return;
      const dados = doc === "estrutura"
        ? (({ tipos, ordemTipos, campos }) => ({ tipos, ordemTipos, campos }))(mesclarEstrutura(rascunho.estrutura))
        : { lista: M().lista.map(normalizarModelo).filter(Boolean) };
      const dif = diferencas(dadosAtuais(doc), dados);
      const resumo = (resumoForcado || (dif.length ? `${dif.length} ${dif.length === 1 ? "mudança" : "mudanças"}: ${dif.slice(0, 3).map((x) => x.caminho).join(", ")}${dif.length > 3 ? "…" : ""}` : "Sem mudanças")).slice(0, 200);
      resumos.push(`${NOME_DOC[doc]}: ${resumo}`);
      ops.push({ caminho: `mapas-config/${doc}`, dados: { versao: 1, ...dados, atualizadoEm: "__AGORA__", atualizadoPor: app.autor() } });
      ops.push({ caminho: `mapas-config/${doc}/versoes/${versaoId}`, dados: { dados, resumo, em: "__AGORA__", por: app.autor() } });
      aplicar.push([doc, dados]);
    });
    if (!ops.length) { mostrarAviso("Nada para salvar."); return false; }
    const botao = raiz && $('[data-p="salvar"]', raiz);
    if (botao) botao.disabled = true;
    try {
      await api.lote(ops);
    } catch (e) {
      console.error(e);
      mostrarAviso(/permission/i.test(e.code || e.message) ? "A nuvem recusou a gravação (só administradoras)." : "Não foi possível salvar agora. Tente de novo.");
      atualizarBarra();
      return false;
    }
    sujo = { estrutura: false, modelos: false };
    mudouFora = { estrutura: false, modelos: false };
    aplicar.forEach(([doc, dados]) => app.aplicarConfig(doc, dados));
    rascunho = { estrutura: null, modelos: null };
    registrarAuditoria({ acao: "editar", alvo: "mapas", resumo: "Painel de edição salvo", detalhes: resumos.join(" | ").slice(0, 800) });
    mostrarAviso("Painel salvo: já vale para todos os mapas.");
    desenhar(abaAtual);
    return true;
  }

  /* ---------- Exportar / importar a configuração (backup manual) ---------- */
  function exportarConfig() {
    garantir();
    baixarArquivo(`mapas-config-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({
      formato: FORMATO_CONFIG, versao: 1, exportadoEm: new Date().toISOString(),
      estrutura: (({ tipos, ordemTipos, campos }) => ({ tipos, ordemTipos, campos }))(mesclarEstrutura(rascunho.estrutura)), modelos: { lista: M().lista }
    }, null, 2), "application/json");
  }
  function importarConfig() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const arq = input.files[0];
      if (!arq) return;
      try {
        const d = JSON.parse(await arq.text());
        if (!d || d.formato !== FORMATO_CONFIG) throw new Error("O arquivo não é uma configuração exportada deste painel.");
        if (!(await confirmar("A configuração do arquivo vai para o rascunho (nada é gravado até você clicar em Salvar).", { titulo: "Importar configuração", botao: "Importar" }))) return;
        if (d.estrutura) { rascunho.estrutura = mesclarEstrutura(d.estrutura); sujo.estrutura = true; }
        if (d.modelos && Array.isArray(d.modelos.lista)) { const l = d.modelos.lista.map(normalizarModelo).filter(Boolean); if (l.length) { rascunho.modelos = { lista: l }; sujo.modelos = true; } }
        mostrarAviso("Configuração importada no rascunho. Confira e clique em Salvar.", { ms: 6000 });
        desenhar(abaAtual);
      } catch (e) { mostrarAviso(e.message || "Arquivo inválido."); }
    });
    input.click();
  }

  /* ============================================================
   *  Eventos
   * ============================================================ */
  function aoClicarCab(e) {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    if (b.dataset.p === "salvar") return salvar();
    if (b.dataset.p === "descartar") {
      confirmar("Descartar todas as alterações não salvas do painel (e da tabela de conteúdo)?", { titulo: "Descartar alterações", botao: "Descartar", perigo: true })
        .then((ok) => { if (ok) descartar(); });
      return;
    }
    if (b.dataset.p === "mais") {
      abrirMenuSimples(b, [
        { rotulo: "Exportar configuração (JSON)", icone: "i-download", acao: exportarConfig },
        { rotulo: "Importar configuração (JSON)", icone: "i-upload", acao: importarConfig },
        { rotulo: "Pré-visualizar como visitante", icone: "i-olho", acao: () => {
          if (temPendencias()) { mostrarAviso("Salve ou descarte as alterações antes de pré-visualizar."); return; }
          app.alternarComoVisitante(true);
        } }
      ]);
    }
  }
  function abrirMenuSimples(ancora, itens) {
    $$(".menu-flutuante").forEach((m) => m.remove());
    const menu = document.createElement("div");
    menu.className = "menu-flutuante";
    menu.setAttribute("role", "menu");
    menu.innerHTML = itens.map((it, i) => `<button type="button" role="menuitem" data-i="${i}">${svg(it.icone)}${escapar(it.rotulo)}</button>`).join("");
    document.body.appendChild(menu);
    const r = ancora.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4 + window.scrollY}px`;
    menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
    const fechar = () => { menu.remove(); document.removeEventListener("pointerdown", fora, true); };
    const fora = (ev) => { if (!menu.contains(ev.target)) fechar(); };
    document.addEventListener("pointerdown", fora, true);
    menu.addEventListener("click", (ev) => { const bt = ev.target.closest("button"); if (!bt) return; fechar(); ancora.focus(); itens[+bt.dataset.i].acao(); });
    menu.addEventListener("keydown", (ev) => {
      const bs = $$("button", menu); const i = bs.indexOf(document.activeElement);
      if (ev.key === "Escape") { ev.preventDefault(); fechar(); ancora.focus(); }
      if (ev.key === "ArrowDown") { ev.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      if (ev.key === "ArrowUp") { ev.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      if (ev.key === "Tab") fechar();
    });
    menu.querySelector("button").focus();
  }
  const mover = (lista, i, dir) => { const j = i + dir; if (j < 0 || j >= lista.length) return false; [lista[i], lista[j]] = [lista[j], lista[i]]; return true; };
  async function decidirOpcao(t, c, o, remover) {
    const usados = usoDaOpcao(t, c.id, o.id);
    if (!usados.length) {
      if (remover) c.opcoes = c.opcoes.filter((x) => x.id !== o.id); else o.arquivada = true;
      marcar("estrutura"); desenhar("listas");
      return;
    }
    const alternativas = c.opcoes.filter((x) => x.id !== o.id && !x.arquivada);
    const d = criarDialogo({
      titulo: `${remover ? "Remover" : "Arquivar"} "${o.rotulo}"`,
      corpo: `<p class="apoio"><strong>${usados.length} ${usados.length === 1 ? "nó usa" : "nós usam"}</strong> esta opção (${escapar([...new Set(usados.map(({ m }) => m.nome))].slice(0, 5).join(", "))}). O que fazer com ${usados.length === 1 ? "ele" : "eles"}?</p>
        <label class="check"><input type="radio" name="decisao" value="substituir" ${alternativas.length ? "checked" : "disabled"}><span>Substituir por outra opção (atualiza os nós agora):</span></label>
        <select name="nova" ${alternativas.length ? "" : "disabled"} aria-label="Opção que substitui">${alternativas.map((x) => `<option value="${escapar(x.id)}">${escapar(x.rotulo)}</option>`).join("")}</select>
        <label class="check"><input type="radio" name="decisao" value="manter" ${alternativas.length ? "" : "checked"}><span>Manter nos nós antigos, mas esconder das novas escolhas (arquivar)</span></label>
        <p class="form-erro" role="alert"></p>
        <div class="form-botoes"><button type="button" class="btn btn-secundario" data-fechar>Cancelar</button><button type="submit" class="btn">Confirmar</button></div>`
    });
    const f = d.querySelector("form");
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (f.decisao.value === "substituir") {
        const nova = f.nova.value;
        const porMapa = new Map();
        usados.forEach(({ m, n }) => {
          const copia = clonar(n);
          if (c.personalizado) copia.extras = { ...(copia.extras || {}), [c.id]: nova }; else copia.campos = { ...(copia.campos || {}), [c.id]: nova };
          if (!porMapa.has(m.id)) porMapa.set(m.id, []);
          porMapa.get(m.id).push(normalizarNo(copia));
        });
        f.querySelector('[type="submit"]').disabled = true;
        let ok = true;
        for (const [mapaId, nos] of porMapa) ok = (await app.gravarNos(mapaId, nos)) && ok;
        if (!ok) { f.querySelector(".form-erro").textContent = "Não foi possível atualizar os nós. Nada foi removido."; f.querySelector('[type="submit"]').disabled = false; return; }
        registrarAuditoria({ acao: "editar", alvo: "mapas", resumo: `Painel: "${o.rotulo}" → "${(alternativas.find((x) => x.id === nova) || {}).rotulo}" em ${usados.length} nós`, detalhes: `${t}.${c.id}` });
        if (remover) c.opcoes = c.opcoes.filter((x) => x.id !== o.id); else o.arquivada = true;
      } else {
        o.arquivada = true;   /* em uso: nunca some em silêncio, vira arquivada */
      }
      marcar("estrutura");
      d.close();
      desenhar("listas");
      mostrarAviso(f.decisao.value === "substituir" ? "Nós atualizados. Clique em Salvar para gravar a lista." : "Opção arquivada no rascunho. Clique em Salvar.");
    });
    d.showModal();
  }
  async function aoClicar(e) {
    const b = e.target.closest("[data-acao]");
    if (!b || b.disabled) return;
    const a = b.dataset.acao;
    const est = E();
    if (a === "restaurar-aba") {
      const doc = DOC_DA_ABA[abaAtual];
      if (!(await confirmar(`Voltar "${ABAS.find((x) => x.id === abaAtual).nome}" para o padrão do sistema? Fica no rascunho até você salvar.`, { titulo: "Restaurar padrão", botao: "Restaurar" }))) return;
      const padrao = mesclarEstrutura(null);
      if (abaAtual === "tipos") { est.tipos = padrao.tipos; est.ordemTipos = padrao.ordemTipos; }
      else if (abaAtual === "listas") IDS_TIPOS.forEach((t) => est.campos[t].forEach((c) => {
        const d = padrao.campos[t].find((x) => x.id === c.id);
        if (c.tipo !== "escolha" || !d) return;
        /* Opções que não existem no padrão mas estão em uso voltam como arquivadas: nada some dos nós */
        const emUso = c.opcoes.filter((o) => !d.opcoes.some((x) => x.id === o.id) && usoDaOpcao(t, c.id, o.id).length);
        c.opcoes = [...clonar(d.opcoes), ...emUso.map((o) => ({ ...o, arquivada: true }))];
      }));
      else if (abaAtual === "campos") IDS_TIPOS.forEach((t) => {
        const atuais = est.campos[t];
        est.campos[t] = [...padrao.campos[t].map((d) => (d.tipo === "escolha" ? { ...d, opcoes: (atuais.find((x) => x.id === d.id) || d).opcoes } : d)), ...atuais.filter((c) => c.personalizado)];
      });
      else if (abaAtual === "modelos") rascunho.modelos = { lista: modelosPadraoNormalizados() };
      marcar(doc);
      desenhar(abaAtual);
      return;
    }
    /* Tipos */
    const li = b.closest("[data-tipo]");
    if (a === "tipo-subir" || a === "tipo-descer") {
      const i = est.ordemTipos.indexOf(li.dataset.tipo);
      if (mover(est.ordemTipos, i, a === "tipo-subir" ? -1 : 1)) { marcar("estrutura"); desenhar("tipos"); }
      return;
    }
    /* Listas */
    const opEl = b.closest("[data-opcao]");
    if (opEl) {
      const sec = b.closest("[data-campo]");
      const t = sec.dataset.tipo;
      const c = est.campos[t].find((x) => x.id === sec.dataset.campo);
      const i = c.opcoes.findIndex((x) => x.id === opEl.dataset.opcao);
      const o = c.opcoes[i];
      if (a === "opcao-subir" || a === "opcao-descer") { if (mover(c.opcoes, i, a === "opcao-subir" ? -1 : 1)) { marcar("estrutura"); desenhar("listas"); } }
      else if (a === "opcao-arquivar") decidirOpcao(t, c, o, false);
      else if (a === "opcao-remover") decidirOpcao(t, c, o, true);
      else if (a === "opcao-desarquivar") { delete o.arquivada; marcar("estrutura"); desenhar("listas"); }
      return;
    }
    /* Campos */
    if (a === "campos-tipo") { tipoCampos = b.dataset.tipo; desenhar("campos"); return; }
    if (a === "campo-novo") return novoCampo();
    const linhaCampo = b.closest("[data-campo]");
    if (linhaCampo && a.startsWith("campo-")) {
      const lista = est.campos[tipoCampos];
      const i = lista.findIndex((x) => x.id === linhaCampo.dataset.campo);
      if (a === "campo-subir" || a === "campo-descer") { if (mover(lista, i, a === "campo-subir" ? -1 : 1)) { marcar("estrutura"); desenhar("campos"); } }
      if (a === "campo-remover") {
        const c = lista[i];
        const comValor = todosOsNos().filter(({ n }) => n.tipo === tipoCampos && n.extras && n.extras[c.id] != null).length;
        if (!(await confirmar(comValor
          ? `${comValor} ${comValor === 1 ? "nó tem" : "nós têm"} valor em "${c.rotulo}". O valor continua guardado em cada nó (não é apagado), mas o campo deixa de aparecer. Para só esconder, use "Oculto".`
          : `Remover o campo "${c.rotulo}"?`, { titulo: "Remover campo", botao: "Remover", perigo: true }))) return;
        lista.splice(i, 1);
        marcar("estrutura"); desenhar("campos");
      }
      return;
    }
    /* Modelos */
    if (a === "modelo-novo") {
      const mod = normalizarModelo({ id: idModeloUnico("modelo"), nome: "Novo modelo", descricao: "", nos: [{ id: idCurto(), tipo: "sistema", titulo: "Sistema", paiId: null, ordem: 0 }] });
      M().lista.push(mod); modelosAbertos.add(mod.id); marcar("modelos"); desenhar("modelos");
      return;
    }
    if (a.startsWith("modelo-")) {
      const lista = M().lista;
      const mod = modeloDe(b);
      const i = lista.indexOf(mod);
      if (a === "modelo-subir" || a === "modelo-descer") { if (mover(lista, i, a === "modelo-subir" ? -1 : 1)) { marcar("modelos"); desenhar("modelos"); } }
      if (a === "modelo-duplicar") {
        if (lista.length >= LIMITE_MODELOS) return;
        const { nos } = clonarNos(mod.nos, true);
        lista.splice(i + 1, 0, normalizarModelo({ id: idModeloUnico(mod.id + "-copia"), nome: `${mod.nome} (cópia)`.slice(0, 60), descricao: mod.descricao, nos }));
        marcar("modelos"); desenhar("modelos");
      }
      if (a === "modelo-remover" && lista.length > 1 && await confirmar(`Remover o modelo "${mod.nome}"? (fica no rascunho até salvar)`, { titulo: "Remover modelo", botao: "Remover", perigo: true })) {
        lista.splice(i, 1); marcar("modelos"); desenhar("modelos");
      }
      return;
    }
    if (a.startsWith("mno-")) return acaoNoModelo(a, modeloDe(b), b.closest("[data-no]").dataset.no);
    /* Conteúdo */
    if (a === "salvar-tabela") return salvarTabela();
    if (a === "t-editar") {
      const tr = b.closest("tr");
      const m = app.mapaPorId(tr.dataset.mapa);
      if (m) app.editarNo(m, tr.dataset.no);
      return;
    }
    if (a === "aplicar-substituir") return aplicarSubstituicao(ultimaPrevia || []);
    /* Histórico */
    const ver = b.closest("[data-versao]");
    if (ver && versoes) {
      const v = versoes.find((x) => x.id === ver.dataset.versao && x.doc === ver.dataset.doc);
      if (a === "versao-comparar") compararVersao(v);
      if (a === "versao-restaurar") restaurarVersao(v);
    }
  }
  let ultimaPrevia = null;
  let temporizadorFiltro = null;
  function aoDigitar(e) {
    const el = e.target;
    const k = el.dataset && el.dataset.k;
    if (e.type === "change" && el.closest("[data-acao-form]") && !k) return;
    if (!k) return;
    const est = E();
    const t = el.closest("[data-tipo]") && el.closest("[data-tipo]").dataset.tipo;
    /* Tipos */
    if (k.startsWith("tipo-")) {
      const x = est.tipos[t];
      if (k === "tipo-nome") x.nome = el.value.slice(0, 40);
      if (k === "tipo-ajuda") x.ajuda = el.value.slice(0, 200);
      if (k === "tipo-filho") x.filhoPadrao = el.value;
      if (k === "tipo-cor" && el.checked) { x.cor = el.value; el.closest(".cartao-tipo").className = `cartao-tipo tom-${x.cor}`; }
      if (k === "tipo-icone" && el.checked) { x.icone = el.value; const s = el.closest("details").querySelector("summary .icone use"); if (s) s.setAttribute("href", "#" + x.icone); }
      el.closest(".cartao-tipo").querySelector(".previa-tipo").innerHTML = htmlPrevia(t);
      marcar("estrutura");
      return;
    }
    /* Listas */
    if (k.startsWith("opcao-")) {
      const sec = el.closest("[data-campo]");
      const c = est.campos[sec.dataset.tipo].find((x) => x.id === sec.dataset.campo);
      const o = c.opcoes.find((x) => x.id === el.closest("[data-opcao]").dataset.opcao);
      if (k === "opcao-rotulo") o.rotulo = el.value.slice(0, 60);
      if (k === "opcao-cor") { if (el.value) o.cor = el.value; else delete o.cor; }
      const previa = el.closest("[data-opcao]").querySelector(".previa-opcao");
      previa.className = `selo ${corSelo(o.cor)} previa-opcao`;
      previa.textContent = o.rotulo;
      marcar("estrutura");
      return;
    }
    /* Campos */
    if (k.startsWith("campo-")) {
      const c = est.campos[tipoCampos].find((x) => x.id === el.closest("[data-campo]").dataset.campo);
      if (k === "campo-rotulo") c.rotulo = el.value.slice(0, 60);
      if (k === "campo-dica") c.dica = el.value.slice(0, 120);
      if (k === "campo-obrigatorio") c.obrigatorio = el.checked;
      if (k === "campo-oculto") { c.oculto = el.checked; el.closest(".linha-campo").classList.toggle("oculto", el.checked); }
      marcar("estrutura");
      return;
    }
    /* Modelos */
    if (k.startsWith("modelo-")) {
      const mod = modeloDe(el);
      if (k === "modelo-nome") mod.nome = el.value.slice(0, 60);
      if (k === "modelo-descricao") mod.descricao = el.value.slice(0, 200);
      if (k === "modelo-no-titulo" || k === "modelo-no-tipo") {
        const n = mod.nos.find((x) => x.id === el.closest("[data-no]").dataset.no);
        if (k === "modelo-no-titulo") n.titulo = el.value.slice(0, LIMITES.titulo);
        else n.tipo = el.value;
      }
      marcar("modelos");
      return;
    }
    /* Conteúdo: filtros e tabela */
    if (k.startsWith("f-")) {
      const chave = k.slice(2);
      filtro[chave] = el.type === "checkbox" ? el.checked : el.value;
      clearTimeout(temporizadorFiltro);
      temporizadorFiltro = setTimeout(() => {
        const foco = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
        desenhar("conteudo");
        if (foco) { const x = conteudo.querySelector(`[data-k="${foco}"]`); if (x) { x.focus(); if (x.setSelectionRange && x.type === "search") x.setSelectionRange(x.value.length, x.value.length); } }
      }, el.type === "search" ? 250 : 0);
      return;
    }
    if (k === "t-titulo" || k === "t-tipo") {
      const tr = el.closest("tr");
      const p = pendentesConteudo.get(tr.dataset.no) || { mapaId: tr.dataset.mapa };
      if (k === "t-titulo") p.titulo = el.value; else p.tipo = el.value;
      pendentesConteudo.set(tr.dataset.no, p);
      tr.classList.add("alterada");
      const bt = conteudo.querySelector('[data-acao="salvar-tabela"]');
      bt.disabled = false;
      bt.lastChild.textContent = `Salvar alterações da tabela (${pendentesConteudo.size})`;
      atualizarBarra();
    }
  }
  /* Formulários dentro do conteúdo (nova opção, buscar e substituir) */
  function aoEnviar(e) {
    const f = e.target.closest("[data-acao-form]");
    if (!f) return;
    e.preventDefault();
    if (f.dataset.acaoForm === "nova-opcao") {
      const sec = f.closest("[data-campo]");
      const c = E().campos[sec.dataset.tipo].find((x) => x.id === sec.dataset.campo);
      const rotulo = f.rotulo.value.trim();
      if (!rotulo) return;
      if (c.opcoes.some((o) => normalizar(o.rotulo) === normalizar(rotulo))) { mostrarAviso(`Já existe a opção "${rotulo}".`); return; }
      let id = rotulo.slice(0, 60), n = 2;
      while (c.opcoes.some((o) => o.id === id)) id = `${rotulo.slice(0, 55)} ${n++}`;
      c.opcoes.push({ id, rotulo: rotulo.slice(0, 60) });
      marcar("estrutura");
      desenhar("listas");
      const novo = conteudo.querySelector(`[data-campo="${CSS.escape(c.id)}"][data-tipo="${sec.dataset.tipo}"] .nova-opcao input`);
      if (novo) novo.focus();
      return;
    }
    if (f.dataset.acaoForm === "substituir") {
      const caixa = conteudo.querySelector(".previa-substituir");
      ultimaPrevia = previaSubstituir(f);
      const total = ultimaPrevia.reduce((s, x) => s + x.itens.length, 0);
      caixa.innerHTML = ultimaPrevia.length ? `<p><strong>${total} ${total === 1 ? "troca" : "trocas"} em ${ultimaPrevia.length} ${ultimaPrevia.length === 1 ? "nó" : "nós"}</strong></p>
        <ul class="lista-previa">${ultimaPrevia.slice(0, 100).map(({ m, n, itens }) => `<li><strong>${escapar(m.nome)} › ${escapar(n.titulo)}</strong>${itens.map((it) => `<div class="troca"><span class="apoio">${escapar(it.rotulo)}:</span> <del>${escapar(it.antes.slice(0, 160))}</del> → <ins>${escapar(it.depois.slice(0, 160))}</ins></div>`).join("")}</li>`).join("")}</ul>
        <button type="button" class="btn btn-mini" data-acao="aplicar-substituir">Gravar ${total} ${total === 1 ? "troca" : "trocas"}</button>`
        : `<p class="apoio">Nada encontrado nos nós filtrados.</p>`;
    }
  }

  return {
    montar(alvo) { montar(alvo); conteudo.addEventListener("submit", aoEnviar); },
    desenhar,
    temPendencias,
    descartar,
    salvarMapaComoModelo,
    /* Configuração nova (nuvem ou salvamento): sem rascunho pendente, o painel passa a mostrar a nova */
    aoMudarConfig(doc, local) {
      if (sujo[doc]) { if (!local) { mudouFora[doc] = true; atualizarBarra(); } return; }
      rascunho[doc] = null;
      if (raiz && app.estado.rota.tela === "painel" && document.body.contains(raiz.querySelector(".tela-painel"))) desenhar(abaAtual);
    }
  };
}
