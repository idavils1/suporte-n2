/*
 * ============================================================
 *  MAPAS DE AJUDA: modelo de dados, árvore, modelos e textos
 *  (sem DOM; usado por mapas.js e mapas-canvas.js)
 *
 *  Firestore:
 *    mapas/{mapaId}                     metadados do mapa
 *    mapas/{mapaId}/nos/{noId}          um documento por nó (evita o limite de 1 MB e
 *                                       permite duas pessoas editando nós diferentes)
 *    mapas/{mapaId}/usos/{usoId}        "usei este roteiro": histórico de atendimentos
 *    mapas-lixeira/{id}                 mapas e ramos removidos (Restaurar / Excluir de vez)
 *  Ligações extras ficam no próprio nó de origem (campo "ligacoes": [{ para, rotulo }]):
 *  são poucas por nó, vão e voltam junto com ele (lixeira, duplicar, exportar) e não
 *  precisam de outra coleção nem de outro ouvinte em tempo real.
 * ============================================================
 */
import { normalizar, formatarData } from "./base.js";

export const ID_VALIDO = /^[a-z0-9-]{1,60}$/;
export const LIMITES = { titulo: 120, descricao: 20000, campo: 2000, passo: 500, passos: 30, tags: 20, tag: 40, ligacoes: 20, rotulo: 80, nomeMapa: 80, descricaoMapa: 500 };
export const NOVENTA_DIAS = 90 * 24 * 60 * 60 * 1000;

/* Cores (as do tema: --c-<cor> e --f-<cor>) */
export const CORES = { roxo: "Lilás", azul: "Azul", verde: "Verde", laranja: "Laranja", amarelo: "Amarelo", vermelho: "Vermelho", cinza: "Cinza" };
/* Ícones que o mapa (sistema) pode usar: mesma ideia da lista ICONES da Aprendizagem */
export const ICONES = ["i-servidor", "i-mapa", "i-grade", "i-globo", "i-plug", "i-cadeado", "i-escudo", "i-certificado", "i-cartao", "i-telefone", "i-email",
  "i-conversa", "i-pessoas", "i-documento", "i-tabela", "i-lista", "i-engrenagem", "i-ferramenta", "i-lampada", "i-alerta", "i-info", "i-livro", "i-aprender",
  "i-calendario", "i-relogio", "i-estrela", "i-tag", "i-link", "i-imagem", "i-megafone"];

export const TIPOS = {
  sistema: { nome: "Sistema", icone: "i-servidor", cor: "roxo", ajuda: "Raiz do mapa: o sistema." },
  sintoma: { nome: "Sintoma", icone: "i-alerta", cor: "vermelho", ajuda: "O problema que o analista observa." },
  teste: { nome: "Teste", icone: "i-busca", cor: "azul", ajuda: "Verificação a fazer e o que cada resultado significa." },
  contato: { nome: "Quem resolve", icone: "i-telefone", cor: "laranja", ajuda: "Com quem falar, por qual canal, horário e prazo." },
  solucao: { nome: "Solução", icone: "i-sucesso", cor: "verde", ajuda: "Correção conhecida (paliativa ou definitiva)." },
  link: { nome: "Link", icone: "i-link", cor: "cinza", ajuda: "Manual, status do serviço, caderno ou aula." },
  nota: { nome: "Nota", icone: "i-anotacao", cor: "amarelo", ajuda: "Informação livre." }
};
export const ORDEM_TIPOS = ["sistema", "sintoma", "teste", "contato", "solucao", "link", "nota"];
/* Tipo sugerido para um filho novo (Tab) */
export const FILHO_PADRAO = { sistema: "sintoma", sintoma: "teste", teste: "teste", contato: "nota", solucao: "nota", link: "link", nota: "nota" };

/* Campos próprios de cada tipo (ficam em no.campos) */
const escolha = (id, rotulo, opcoes) => ({ id, rotulo, tipo: "escolha", opcoes });
const texto = (id, rotulo, dica = "") => ({ id, rotulo, tipo: "texto", dica });
const area = (id, rotulo, dica = "") => ({ id, rotulo, tipo: "area", dica });
export const CAMPOS = {
  sistema: [{ id: "url", rotulo: "Endereço do sistema", tipo: "url", dica: "https://…" }, texto("dono", "Responsável / dono"),
    escolha("criticidade", "Criticidade", ["Baixa", "Média", "Alta", "Crítica"])],
  sintoma: [area("palavrasChave", "Palavras-chave / mensagens de erro", "Uma por linha (ajuda a busca)"),
    escolha("frequencia", "Frequência", ["Raro", "Às vezes", "Frequente", "Constante"]),
    escolha("impacto", "Impacto", ["Baixo", "Médio", "Alto", "Parada total"])],
  teste: [{ id: "passos", rotulo: "Passos", tipo: "lista", dica: "Um passo por linha" }, area("esperado", "Resultado esperado / o que significa"),
    texto("tempo", "Tempo estimado", "ex.: 5 min")],
  contato: [texto("nome", "Nome"), texto("area", "Área / equipe"), escolha("canal", "Canal", ["Teams", "E-mail", "Telefone", "Chamado", "Outro"]),
    texto("email", "E-mail"), texto("telefone", "Telefone / ramal"), texto("horario", "Horário de atendimento", "ex.: seg a sex, 8h às 18h"),
    texto("sla", "SLA / prazo", "ex.: 4 h úteis"), escolha("nivel", "Nível", ["N1", "N2", "N3", "Fornecedor"]), area("observacoes", "Observações")],
  solucao: [{ id: "passos", rotulo: "Passos", tipo: "lista", dica: "Um passo por linha" }, escolha("natureza", "Natureza", ["Paliativa", "Definitiva"]),
    area("observacoes", "Observações")],
  link: [{ id: "url", rotulo: "Endereço", tipo: "url", dica: "https://…, caderno.html?c=slug ou aprender.html#aula" }],
  nota: []
};
export const CAMPOS_PERMITIDOS = [...new Set(Object.values(CAMPOS).flat().map((c) => c.id))];

/* ------------------------------------------------------------
 *  Normalização (mesmo formato no exemplo embutido, no JSON e no Firestore)
 * ------------------------------------------------------------ */
const txt = (v, max) => String(v == null ? "" : v).slice(0, max);
export function urlSegura(u) {
  const s = String(u || "").trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^(caderno\.html\?c=[a-z0-9-]{1,40}|aprender\.html#[A-Za-z0-9/_-]{1,120}|contatos\.html(#[A-Za-z0-9_-]{0,60})?|index\.html(#[a-z0-9-]{0,60})?)$/.test(s)) return s;
  return "";
}
function normalizarCampos(tipo, c) {
  const r = {};
  if (!c || typeof c !== "object") return r;
  (CAMPOS[tipo] || []).forEach((def) => {
    const v = c[def.id];
    if (def.tipo === "lista") {
      const lista = (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => txt(x, LIMITES.passo).trim()).filter(Boolean).slice(0, LIMITES.passos);
      if (lista.length) r[def.id] = lista;
    } else if (def.tipo === "escolha") {
      if (def.opcoes.includes(v)) r[def.id] = v;
    } else if (def.tipo === "url") {
      const u = urlSegura(v);
      if (u) r[def.id] = u;
    } else {
      const s = txt(v, LIMITES.campo).trim();
      if (s) r[def.id] = s;
    }
  });
  return r;
}
export function normalizarNo(d) {
  if (!d || !ID_VALIDO.test(d.id || "")) return null;
  const tipo = TIPOS[d.tipo] ? d.tipo : "nota";
  const pos = d.pos && typeof d.pos === "object" && isFinite(d.pos.x) && isFinite(d.pos.y)
    ? { x: Math.round(d.pos.x), y: Math.round(d.pos.y), v: d.pos.v === "grafo" ? "grafo" : "arvore" } : null;
  return {
    id: d.id, tipo,
    titulo: txt(d.titulo, LIMITES.titulo).trim() || TIPOS[tipo].nome,
    descricao: txt(d.descricao, LIMITES.descricao),
    paiId: d.paiId && ID_VALIDO.test(d.paiId) && d.paiId !== d.id ? d.paiId : null,
    ordem: Number.isFinite(Number(d.ordem)) ? Number(d.ordem) : 0,
    tags: (Array.isArray(d.tags) ? d.tags : []).map((t) => txt(t, LIMITES.tag).trim()).filter(Boolean).slice(0, LIMITES.tags),
    recolhido: !!d.recolhido,
    pos,
    campos: normalizarCampos(tipo, d.campos),
    ligacoes: (Array.isArray(d.ligacoes) ? d.ligacoes : []).filter((l) => l && ID_VALIDO.test(l.para || "") && l.para !== d.id)
      .slice(0, LIMITES.ligacoes).map((l) => ({ para: l.para, rotulo: txt(l.rotulo, LIMITES.rotulo).trim() })),
    revisadoEm: typeof d.revisadoEm === "string" && !isNaN(Date.parse(d.revisadoEm)) ? d.revisadoEm.slice(0, 30) : "",
    atualizadoEm: d.atualizadoEm || "",
    atualizadoPor: txt(d.atualizadoPor, 80)
  };
}
export function normalizarMapa(d) {
  if (!d || !ID_VALIDO.test(d.id || "")) return null;
  return {
    id: d.id,
    nome: txt(d.nome, LIMITES.nomeMapa).trim() || d.id,
    descricao: txt(d.descricao, LIMITES.descricaoMapa),
    icone: ICONES.includes(d.icone) ? d.icone : "i-servidor",
    cor: CORES[d.cor] ? d.cor : "roxo",
    layout: d.layout === "grafo" ? "grafo" : "arvore",
    tags: (Array.isArray(d.tags) ? d.tags : []).map((t) => txt(t, LIMITES.tag).trim()).filter(Boolean).slice(0, LIMITES.tags),
    criadoEm: d.criadoEm || "", criadoPor: txt(d.criadoPor, 80),
    atualizadoEm: d.atualizadoEm || "", atualizadoPor: txt(d.atualizadoPor, 80),
    excluidoEm: d.excluidoEm || null
  };
}
/* Formato gravado no Firestore (sem id; datas viram __AGORA__ em quem grava) */
export function dadosNo(no, por) {
  const d = {
    tipo: no.tipo, titulo: no.titulo, descricao: no.descricao || "", paiId: no.paiId || null, ordem: no.ordem || 0,
    tags: no.tags || [], recolhido: !!no.recolhido, pos: no.pos || null, campos: no.campos || {}, ligacoes: no.ligacoes || [],
    revisadoEm: no.revisadoEm || "", atualizadoEm: "__AGORA__", atualizadoPor: por
  };
  return d;
}
export function dadosMapa(m, por, novo = false) {
  const d = { nome: m.nome, descricao: m.descricao || "", icone: m.icone, cor: m.cor, layout: m.layout || "arvore", tags: m.tags || [],
    excluidoEm: null, atualizadoEm: "__AGORA__", atualizadoPor: por };
  if (novo) { d.criadoEm = "__AGORA__"; d.criadoPor = por; }
  return d;
}

/* ------------------------------------------------------------
 *  Árvore
 * ------------------------------------------------------------ */
export const porOrdem = (a, b) => (a.ordem - b.ordem) || a.titulo.localeCompare(b.titulo, "pt-BR");
export function indexar(nos) {
  const porId = new Map(nos.map((n) => [n.id, n]));
  let raiz = nos.find((n) => n.tipo === "sistema" && !n.paiId) || nos.find((n) => !n.paiId) || null;
  const filhos = new Map(nos.map((n) => [n.id, []]));
  const paiDe = new Map();
  nos.forEach((n) => {
    if (n === raiz) return;
    let pai = n.paiId && porId.has(n.paiId) ? n.paiId : (raiz ? raiz.id : null);
    /* Ciclo (dado corrompido ou edição simultânea): pendura na raiz */
    let p = pai, passos = 0;
    while (p && passos++ < 500) { if (p === n.id) { pai = raiz ? raiz.id : null; break; } p = porId.get(p) && porId.get(p) !== raiz ? (porId.get(p).paiId || null) : null; }
    if (pai) { filhos.get(pai).push(n); paiDe.set(n.id, pai); }
  });
  filhos.forEach((l) => l.sort(porOrdem));
  return { porId, filhos, paiDe, raiz, total: nos.length };
}
export function caminhoAteRaiz(idx, id) {
  const r = [];
  let atual = id, passos = 0;
  while (atual && passos++ < 500) { r.push(atual); atual = idx.paiDe.get(atual); }
  return r;
}
export function descendentes(idx, id) {
  const r = [];
  const pilha = [...(idx.filhos.get(id) || [])].reverse();
  while (pilha.length) { const n = pilha.pop(); r.push(n); pilha.push(...[...(idx.filhos.get(n.id) || [])].reverse()); }
  return r;
}
export function profundidade(idx, id) { return caminhoAteRaiz(idx, id).length - 1; }
export function contarPorTipo(nos) {
  const c = {};
  nos.forEach((n) => { c[n.tipo] = (c[n.tipo] || 0) + 1; });
  return c;
}
/* "Quem resolve" mais próximo: ligações do nó, a subárvore dele, e depois subindo pelos ancestrais */
export function contatoMaisProximo(idx, id) {
  const no = idx.porId.get(id);
  if (!no) return null;
  if (no.tipo === "contato") return no;
  const lig = (no.ligacoes || []).map((l) => idx.porId.get(l.para)).find((n) => n && n.tipo === "contato");
  if (lig) return lig;
  const caminho = caminhoAteRaiz(idx, id);
  for (const anc of caminho) {
    const achado = descendentes(idx, anc).find((n) => n.tipo === "contato");
    if (achado) return achado;
  }
  return null;
}
export const revisaoVencida = (no) => (no.tipo === "teste" || no.tipo === "contato")
  && (!no.revisadoEm || Date.now() - Date.parse(no.revisadoEm) > NOVENTA_DIAS);

/* ------------------------------------------------------------
 *  Busca
 * ------------------------------------------------------------ */
export function textoDoNo(no) {
  const campos = Object.values(no.campos || {}).map((v) => (Array.isArray(v) ? v.join(" ") : v)).join(" ");
  return normalizar([no.titulo, no.descricao, campos, (no.tags || []).join(" "), TIPOS[no.tipo].nome].join(" "));
}
export function corresponde(texto, termo) {
  const t = normalizar(termo).trim();
  if (!t) return true;
  return t.split(/\s+/).every((p) => texto.includes(p));
}

/* ------------------------------------------------------------
 *  Ids e modelos iniciais
 * ------------------------------------------------------------ */
export function idCurto(prefixo = "n") {
  const a = new Uint32Array(2);
  (globalThis.crypto || window.crypto).getRandomValues(a);
  return (prefixo + a[0].toString(36) + a[1].toString(36)).slice(0, 14);
}
const no = (tipo, titulo, paiId, ordem, extra = {}) => ({ id: extra.id || idCurto(), tipo, titulo, paiId, ordem, descricao: "", tags: [], campos: {}, ligacoes: [], ...extra });

export const MODELOS = {
  branco: { nome: "Em branco", descricao: "Só o nó do sistema." },
  diagnostico: { nome: "Diagnóstico padrão", descricao: "Sistema → sintoma de exemplo → 3 testes genéricos → Quem resolve." }
};
export function nosDoModelo(modelo, nomeSistema) {
  const raiz = no("sistema", nomeSistema, null, 0);
  if (modelo !== "diagnostico") return [raiz];
  const s = no("sintoma", "Sintoma de exemplo (renomeie)", raiz.id, 0, { descricao: "Descreva o que o usuário vê: mensagem, tela, horário em que acontece." });
  const contato = no("contato", "Quem resolve", s.id, 3, { campos: { nome: "[Preencher: equipe responsável]" } });
  const t1 = no("teste", "Só comigo ou geral?", s.id, 0, {
    campos: { passos: ["Peça para um colega abrir o sistema em outra máquina", "Teste com outro usuário na sua máquina"], esperado: "Descobrir se o problema é local (só você) ou geral (todos)." }
  });
  const t2 = no("teste", "Limpar cache / testar outro navegador", s.id, 1, {
    campos: { passos: ["Abra o sistema numa janela anônima", "Limpe o cache e os cookies do site", "Teste em outro navegador"] }
  });
  const t3 = no("teste", "Conexão / VPN / rede", s.id, 2, {
    campos: { passos: ["Confira se a VPN está conectada", "Abra outro site interno", "Faça ping no servidor do sistema"] }
  });
  t1.ligacoes = [{ para: contato.id, rotulo: "Geral (todos afetados)" }, { para: t2.id, rotulo: "Só comigo" }];
  return [raiz, s, t1, t2, t3, contato];
}
/* Mapa de exemplo SCDA (sem nomes, e-mails ou telefones reais: marcadores [Preencher: …]) */
export const TAG_EXEMPLO = "exemplo-revisar";
export function mapaExemploSCDA() {
  const mapa = { id: "scda", nome: "SCDA", descricao: "Exemplo: roteiro quando o SCDA cai ou trava. Revise os testes e preencha os contatos.", icone: "i-servidor", cor: "azul", layout: "arvore", tags: [TAG_EXEMPLO] };
  const raiz = no("sistema", "SCDA", null, 0, { id: "scda-sistema", descricao: "Sistema SCDA.", campos: { dono: "[Preencher: área dona do sistema]", criticidade: "Alta" }, tags: [TAG_EXEMPLO] });
  const s1 = no("sintoma", "Sistema caindo / travando", raiz.id, 0, {
    id: "scda-caindo", descricao: "O SCDA fecha sozinho, para de responder ou fica carregando sem fim.",
    campos: { palavrasChave: "caindo\ntravando\nlento\nnão carrega\ntempo esgotado", frequencia: "Frequente", impacto: "Alto" }
  });
  const contatoInfra = no("contato", "Infra / Fornecedor do SCDA", s1.id, 3, {
    id: "scda-contato-infra", descricao: "Acione quando o problema é **geral** (outros usuários também afetados).",
    campos: { nome: "[Preencher: equipe responsável]", area: "[Preencher: Infra ou fornecedor]", canal: "Chamado", horario: "[Preencher: horário de atendimento]", sla: "[Preencher: prazo]", nivel: "N3" }
  });
  const t1 = no("teste", "Só comigo ou geral?", s1.id, 0, {
    id: "scda-teste-escopo", descricao: "Primeiro descubra o alcance: muda tudo o que vem depois.",
    campos: { passos: ["Peça para um colega abrir o SCDA em outra máquina", "Teste com outro usuário na sua máquina", "Veja se há aviso de instabilidade no canal da equipe"],
      esperado: "**Geral**: escale direto para Infra / Fornecedor. **Só comigo**: siga para o próximo teste.", tempo: "5 min" }
  });
  const t2 = no("teste", "Limpar cache / testar outro navegador", s1.id, 1, {
    id: "scda-teste-cache", campos: { passos: ["Abra o SCDA numa janela anônima", "Limpe cache e cookies do site", "Teste em outro navegador"], esperado: "Se funcionar no anônimo ou em outro navegador, o problema é cache/extensão local.", tempo: "5 min" }
  });
  const t3 = no("teste", "Conexão / VPN / ping no servidor", s1.id, 2, {
    id: "scda-teste-rede", campos: { passos: ["Confira se a VPN está conectada", "Abra outro sistema interno", "Faça ping no servidor do SCDA ([Preencher: endereço])"], esperado: "Se a rede falhar, o problema é de conexão: acione o suporte de rede.", tempo: "5 min" }
  });
  t1.ligacoes = [{ para: contatoInfra.id, rotulo: "Geral (todos afetados)" }, { para: t2.id, rotulo: "Só comigo" }];
  const sol = no("solucao", "Limpar cache resolve", t2.id, 0, { id: "scda-solucao-cache", campos: { passos: ["Limpe o cache do navegador", "Feche e abra o navegador"], natureza: "Paliativa" } });
  const s2 = no("sintoma", "Erro de login", raiz.id, 1, { id: "scda-login", campos: { palavrasChave: "senha inválida\nusuário bloqueado", impacto: "Médio" } });
  const t4 = no("teste", "Conferir usuário, senha e bloqueio", s2.id, 0, { id: "scda-teste-login", campos: { passos: ["Confirme o usuário digitado", "Tente redefinir a senha", "Verifique se o usuário está bloqueado"] } });
  const c2 = no("contato", "Quem libera acesso", s2.id, 1, { id: "scda-contato-acesso", campos: { nome: "[Preencher: equipe de acessos]", canal: "Chamado", nivel: "N2" } });
  const links = no("link", "Links úteis", raiz.id, 2, { id: "scda-links", descricao: "Manual, status do serviço e caderno relacionado." });
  const l1 = no("link", "Manual do SCDA", links.id, 0, { id: "scda-link-manual", descricao: "[Preencher: endereço do manual]" });
  return { mapa, nos: [raiz, s1, t1, t2, t3, contatoInfra, sol, s2, t4, c2, links, l1].map(normalizarNo) };
}

/* ------------------------------------------------------------
 *  Textos: roteiro (resumo copiável), Markdown e JSON
 * ------------------------------------------------------------ */
const ROTULO_RESULTADO = { resolveu: "Resolveu", "nao-resolveu": "Não resolveu", pulado: "Pulado" };
export function textoContato(c) {
  if (!c) return "";
  const f = c.campos || {};
  return [`${c.titulo}${f.nome && f.nome !== c.titulo ? ` (${f.nome})` : ""}`,
    f.area && `Área: ${f.area}`, f.canal && `Canal: ${f.canal}`, f.email && `E-mail: ${f.email}`, f.telefone && `Telefone: ${f.telefone}`,
    f.horario && `Horário: ${f.horario}`, f.sla && `SLA: ${f.sla}`, f.nivel && `Nível: ${f.nivel}`].filter(Boolean).join(" · ");
}
export function resumoRoteiro({ mapa, sintoma, passos, desfecho, contato, quando = new Date() }) {
  const linhas = [
    `Sistema: ${mapa.nome}`,
    `Sintoma: ${sintoma.titulo}`,
    `Data: ${formatarData(quando, true)}`,
    "",
    "Testes realizados:"
  ];
  if (!passos.length) linhas.push("- Nenhum teste registrado.");
  passos.forEach((p, i) => linhas.push(`${i + 1}. ${p.titulo}: ${ROTULO_RESULTADO[p.resultado] || p.resultado}`));
  linhas.push("", `Resultado: ${desfecho}`);
  if (contato) linhas.push(`Contato: ${textoContato(contato)}`);
  return linhas.join("\n");
}
export function mapaParaMarkdown(mapa, nos) {
  const idx = indexar(nos);
  const linhas = [`# ${mapa.nome}`, ""];
  if (mapa.descricao) linhas.push(mapa.descricao, "");
  const escrever = (n, nivel) => {
    const rec = "  ".repeat(nivel);
    linhas.push(`${rec}- **${TIPOS[n.tipo].nome}: ${n.titulo}**`);
    if (n.descricao) n.descricao.split("\n").forEach((l) => linhas.push(`${rec}  ${l}`));
    (CAMPOS[n.tipo] || []).forEach((def) => {
      const v = n.campos[def.id];
      if (!v) return;
      if (Array.isArray(v)) { linhas.push(`${rec}  ${def.rotulo}:`); v.forEach((p, i) => linhas.push(`${rec}    ${i + 1}. ${p}`)); }
      else linhas.push(`${rec}  ${def.rotulo}: ${v}`);
    });
    (n.ligacoes || []).forEach((l) => { const alvo = idx.porId.get(l.para); if (alvo) linhas.push(`${rec}  → ${l.rotulo ? l.rotulo + ": " : ""}${alvo.titulo}`); });
    (idx.filhos.get(n.id) || []).forEach((f) => escrever(f, nivel + 1));
  };
  if (idx.raiz) escrever(idx.raiz, 0);
  return linhas.join("\n");
}
export const FORMATO_JSON = "suporte-n2-mapa";
export function mapaParaJSON(mapa, nos) {
  const limpar = (n) => { const { atualizadoEm, atualizadoPor, ...resto } = n; return resto; };
  const { criadoEm, criadoPor, atualizadoEm, atualizadoPor, excluidoEm, ...m } = mapa;
  return JSON.stringify({ formato: FORMATO_JSON, versao: 1, exportadoEm: new Date().toISOString(), mapa: m, nos: nos.map(limpar) }, null, 2);
}
/* Lê o JSON exportado. Gera ids novos quando pedido (importar como cópia) */
export function lerJSONMapa(texto, { idsNovos = true } = {}) {
  const d = JSON.parse(texto);
  if (!d || d.formato !== FORMATO_JSON || !d.mapa || !Array.isArray(d.nos)) throw new Error("Arquivo não é um mapa exportado desta página.");
  if (d.nos.length > 2000) throw new Error("Mapa grande demais (mais de 2000 nós).");
  return clonarNos(d.nos.map(normalizarNo).filter(Boolean), idsNovos, { ...d.mapa, id: d.mapa.id || "mapa" });
}
export function clonarNos(nos, idsNovos = true, mapa = null) {
  const troca = new Map(nos.map((n) => [n.id, idsNovos ? idCurto() : n.id]));
  const copia = nos.map((n) => ({
    ...n, id: troca.get(n.id), paiId: n.paiId ? (troca.get(n.paiId) || null) : null,
    ligacoes: (n.ligacoes || []).filter((l) => troca.has(l.para)).map((l) => ({ ...l, para: troca.get(l.para) }))
  }));
  return { mapa: mapa ? normalizarMapa({ ...mapa, id: ID_VALIDO.test(mapa.id || "") ? mapa.id : "mapa" }) : null, nos: copia };
}
