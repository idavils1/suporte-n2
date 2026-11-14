/* Captura as telas do tutorial dos gestores no servidor de testes (sites/inventario-testes/servidor.ps1).
   Uso: node dev/tutorial-gestores/capturar.mjs [etapa...]  */
import { mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { abrirChrome, espera } from "./cdp.mjs";

const PASTA = join(dirname(fileURLToPath(import.meta.url)), "img");
mkdirSync(PASTA, { recursive: true });
const SITE = "http://127.0.0.1:8124/teste.html";
const f = (n) => join(PASTA, n + ".png");

/* Marcadores do tutorial: moldura + número sobre os elementos */
const MARCADORES = `
window.__marcar = (lista) => {
  __limpar();
  const raiz = document.createElement("div");
  raiz.id = "tut-marcas";
  raiz.setAttribute("popover", "manual");
  raiz.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647";
  lista.forEach((m) => {
    const els = [...document.querySelectorAll(m.sel)].filter((e) => e.getClientRects().length);
    if (!els.length) return;
    const rs = els.map((e) => e.getBoundingClientRect());
    const r = { left: Math.min(...rs.map((x) => x.left)), top: Math.min(...rs.map((x) => x.top)), right: Math.max(...rs.map((x) => x.right)), bottom: Math.max(...rs.map((x) => x.bottom)) };
    const p = m.folga ?? 4;
    const caixa = document.createElement("div");
    caixa.style.cssText = "position:fixed;border:3px solid #e5484d;border-radius:10px;box-shadow:0 0 0 4px rgba(229,72,77,.18)";
    Object.assign(caixa.style, { left: r.left - p + "px", top: r.top - p + "px", width: r.right - r.left + 2 * p + "px", height: r.bottom - r.top + 2 * p + "px" });
    raiz.appendChild(caixa);
    if (m.n != null) {
      const b = document.createElement("div");
      b.textContent = m.n;
      b.style.cssText = "position:fixed;width:28px;height:28px;border-radius:50%;background:#e5484d;color:#fff;font:700 15px/28px system-ui,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.3)";
      const lado = m.lado || "esq";
      const x = lado === "dir" ? r.right + p - 6 : lado === "cima" ? (r.left + r.right) / 2 - 14 : r.left - p - 22;
      const y = lado === "cima" ? r.top - p - 30 : r.top - p - 14;
      Object.assign(b.style, { left: Math.max(2, x) + "px", top: Math.max(2, y) + "px" });
      raiz.appendChild(b);
    }
  });
  document.body.appendChild(raiz);
  raiz.showPopover();
};
window.__limpar = () => { const r = document.getElementById("tut-marcas"); if (r) r.remove(); };
`;

/* Banco simulado: estrutura de produção + equipamentos fictícios + cadastro liberado da gestora */
async function semear() {
  const est = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "sites", "inventario-testes", "estrutura-producao.json"), "utf8"));
  est.atualizadoEm = "2026-11-04T17:07:02.838Z";
  const db = { "inventario-config/estrutura": est };
  const adm = { criadoPor: "lays.almeida@valid.com", criadoPorNome: "Lays", criadoPorEmail: "lays.almeida@valid.com", atualizadoPor: "lays.almeida@valid.com", atualizadoPorNome: "Lays", atualizadoPorEmail: "lays.almeida@valid.com" };
  const L = [
    ["VCSP-NB0412", "480213", "Ana Souza", "validacao", "jessica-rombalde", "em-uso", "auditado-ok", "davi-santos", "", "2026-10-28T10:15", "vcert"],
    ["VCSP-NB0413", "480377", "Bruno Lima", "validacao", "jessica-rombalde", "em-uso", "pendente", "", "", "", "vcert"],
    ["VCSP-DT0158", "471902", "Carla Mendes", "sac-sap", "elaine-dayane-silva", "em-uso", "auditado-ok", "maria-luisa-chaves", "Monitor extra na mesa", "2026-10-27T14:40", "vcert"],
    ["VCSP-DT0161", "471955", "Diego Ferreira", "sac-sap", "elaine-dayane-silva", "disponivel", "nao-localizado", "isaque-pereira", "Máquina formatada em 21/10. DNA novo: 490110", "2026-10-21T09:05", "vcert"],
    ["VCSP-NB0520", "490110", "Diego Ferreira", "sac-sap", "elaine-dayane-silva", "em-uso", "auditado-ok", "isaque-pereira", "Substitui o DNA 471955", "2026-10-21T09:30", "vcert"],
    ["VCRP-NB0077", "462318", "Eduarda Rocha", "comercial", "marcela-sudre", "em-uso", "divergencia-encontrada", "", "Usuária de férias até 15/11", "", "vcorp"],
    ["VCRP-NB0081", "462402", "Felipe Andrade", "comercial", "marcela-sudre", "em-uso", "pendente", "", "", "", "vcorp"],
    ["VCSP-DT0203", "475640", "Gabriela Nunes", "antifraude", "ramon-lica", "em-uso", "auditado-ok", "david-bezerra", "", "2026-10-30T11:20", "vcert"],
    ["VCSP-DT0207", "475688", "Henrique Alves", "antifraude", "ramon-lica", "em-uso", "pendente", "", "", "", "vcert"],
    ["VCSP-NB0390", "478801", "Isabela Costa", "produtos", "franscisco-helio-diniz", "em-uso", "auditado-ok", "fabiana-santos", "", "2026-10-29T16:00", "vcert"],
    ["VCSP-NB0394", "478845", "João Pedro Dias", "produtos", "franscisco-helio-diniz", "em-uso", "pendente", "", "", "", "vcert"],
    ["VCSP-DT0099", "469930", "Larissa Prado", "administrativo", "elisabete-biondo-guimaraes", "em-uso", "auditado-ok", "anderson-leite", "", "2026-10-26T08:50", "vcert"],
    ["VCSP-DT0102", "469971", "Marcos Vieira", "administrativo", "elisabete-biondo-guimaraes", "disponivel", "nao-localizado", "anderson-leite", "Desligado da empresa em 10/10", "2026-10-10T17:10", "vcert"],
    ["VCSP-NB0601", "491500", "Natália Ramos", "central-de-verificacao", "jessica-rombalde", "em-uso", "pendente", "", "", "", "vcert"]
  ];
  const base = Date.parse("2026-10-20T12:00:00Z");
  L.forEach((r, i) => {
    const id = "eq" + String(i + 1).padStart(3, "0");
    const campos = { hostname: r[0], dna: r[1], usuario: r[2], area: r[3], gestor: r[4], status: r[5], auditoria: r[6], ar: r[10] };
    if (r[7]) campos.tecnico = r[7];
    if (r[8]) campos.observacao = r[8];
    if (r[9]) campos.dataFeita = r[9];
    const quando = new Date(base + i * 3600e3 * 9).toISOString();
    db[`inventario/${id}`] = { campos, numero: r[0], dna: r[1], ...adm, criadoEm: quando, atualizadoEm: quando, exclusao: null };
    db[`inventario-hostnames/${r[0]}`] = { equipamento: id };
    db[`inventario-dnas/${r[1]}`] = { equipamento: id };
  });
  const em = "jessica.rombalde@valid.com";
  db[`inventario-identidades/${em}`] = { email: em, nome: "Jessica Rombalde", nomeChave: "jessica rombalde", papel: "equipe", ativo: true, aprovado: true, criadoEm: "2026-10-30T12:00:00.000Z", criadoPorUid: "anon-seed", atualizadoEm: "2026-10-30T13:00:00.000Z" };
  db[`inventario-emails/${em}`] = {};
  await fetch("http://127.0.0.1:8124/banco", { method: "PUT", body: JSON.stringify(db) });
}

await semear();
const b = await abrirChrome({ largura: 1366, altura: 860, escala: 2 });
const cel = (id, col) => `.linha[data-id="${id}"] .celula[data-col="${col}"]`;
const fecharDialogo = async () => { await b.js(`(() => { const d = document.querySelector("dialog[open]"); if (d) d.close(); })()`); await espera(450); };
/* Combo (lista pesquisável): foca, digita e escolhe a 1ª opção com Enter */
const escolher = async (sel, texto) => { await b.focar(sel); await b.digitar(texto); await b.tecla("Enter"); };
try {
  await b.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("inventario-mascote", JSON.stringify({ mostrar: false })); localStorage.setItem("inventario-tema", "claro"); } catch (e) {}\n${MARCADORES}` });
  await b.ir(SITE);
  await b.esperar(`!document.getElementById("tela-login").hidden`);
  await b.js(`document.fonts.ready.then(() => true)`);
  await espera(600);

  /* ---------- 1. Entrada ---------- */
  await b.focar("#reg-email");
  await b.digitar("jessica.rombalde@valid.com");
  await b.focar("#reg-nome");
  await b.esperar(`/Cadastro encontrado/.test(document.getElementById("dica-cadastro").textContent)`);
  await b.digitar("Jessica Rombalde");
  await espera(300);
  await b.js(`__marcar([{ sel: "#reg-email", n: 1 }, { sel: "#reg-nome", n: 2 }, { sel: "#btn-registro-confirmar", n: 3 }])`);
  await b.foto(f("01-login"), { sel: "#form-registro", folga: 24 });
  await b.js(`__limpar()`);

  /* Primeiro acesso: e-mail sem cadastro mostra a confirmação */
  await b.js(`(() => { const f = document.getElementById("form-registro"); f.email.value = ""; f.nome.value = ""; })()`);
  await b.focar("#reg-email");
  await b.digitar("elaine.silva@valid.com");
  await b.focar("#reg-nome");
  await b.esperar(`/Primeira vez/.test(document.getElementById("dica-cadastro").textContent)`);
  await b.digitar("Elaine Dayane Silva");
  await b.clicar("#btn-registro-confirmar");
  await b.esperar(`!document.getElementById("confirmar-cadastro").hidden`);
  await espera(300);
  await b.js(`__marcar([{ sel: "#btn-criar-cadastro", n: 1, lado: "dir" }])`);
  await b.foto(f("02-primeiro-acesso"), { sel: "#form-registro", folga: 24 });
  await b.js(`__limpar()`);
  await b.clicar("#btn-criar-cadastro");
  await b.esperar(`!document.getElementById("tela-bloqueio").hidden`);
  await espera(500);
  await b.foto(f("02b-aguardando"), { sel: "#tela-bloqueio .cartao-login", folga: 24 });
  await b.clicar("#btn-bloqueio-voltar");
  await b.esperar(`!document.getElementById("tela-login").hidden`);

  /* Entrar como Jessica */
  await b.js(`(() => { const f = document.getElementById("form-registro"); f.email.value = ""; f.nome.value = ""; })()`);
  await b.focar("#reg-email");
  await b.digitar("jessica.rombalde@valid.com");
  await b.focar("#reg-nome");
  await b.esperar(`/Cadastro encontrado/.test(document.getElementById("dica-cadastro").textContent)`);
  await b.digitar("Jessica Rombalde");
  await b.clicar("#btn-registro-confirmar");
  await b.esperar(`!document.getElementById("app").hidden && document.querySelector("#planilha .linha[data-id]")`, 15000);
  await espera(1200);

  /* ---------- 2. A tela ---------- */
  await b.foto(f("03-visao-geral"));
  await b.js(`__marcar([
    { sel: "#btn-busca-rapida", n: 1 }, { sel: ".usuario-topo", n: 2 }, { sel: "#resumo", n: 3 }, { sel: "#abas", n: 4 },
    { sel: ".barra .busca, #visao, #agrupar, #btn-limpar-filtros", n: 5 }, { sel: "#btn-novo", n: 6 }, { sel: "#btn-colar, #btn-massa", n: 7 },
    { sel: "#btn-desfazer", n: 8, lado: "dir" }, { sel: "#planilha .cab, #planilha .linha[data-id]", n: 9, folga: 0 }, { sel: "#planilha .linha-nova", n: 10, folga: 0 }
  ])`);
  await b.foto(f("04-visao-geral-marcada"));
  await b.js(`__limpar()`);

  /* ---------- 3. Incluir ---------- */
  await b.js(`__marcar([{ sel: "#btn-novo", n: 1, lado: "dir" }, { sel: "#btn-colar", n: 2 }, { sel: "#btn-massa", n: 3, lado: "dir" }])`);
  await b.foto(f("05-botoes-incluir"), { sel: ".barra", folga: 16 });
  await b.js(`__limpar()`);

  await b.clicar("#btn-novo");
  await b.esperar(`document.querySelector("dialog[open] #f-hostname")`);
  await espera(400);
  await b.foto(f("06-novo-vazio"), { sel: "dialog[open]", folga: 0 });
  await b.focar("#f-hostname"); await b.digitar("VCSP-NB0412");
  await b.focar("#f-dna"); await b.digitar("493210");
  await b.esperar(`document.querySelector('[data-aviso-de="hostname"] .aviso-repetido')`);
  await espera(300);
  await b.js(`__marcar([{ sel: '[data-campo="hostname"]', folga: 6 }])`);
  await b.foto(f("08-repetido"), { sel: '[data-campo="hostname"], [data-campo="dna"]', folga: 18 });
  await b.js(`__limpar()`);
  await b.js(`(() => { const el = document.getElementById("f-hostname"); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await b.focar("#f-hostname"); await b.digitar("VCSP-NB0733");
  await escolher("#f-ar", "VCERT");
  await b.focar("#f-usuario"); await b.digitar("Paulo Henrique Moraes");
  await escolher("#f-area", "VALIDA");
  await b.focar("#f-gestor"); await b.digitar("JES");
  await espera(300);
  await b.foto(f("07-novo-lista"), { sel: "dialog[open]", folga: 0 });
  await b.tecla("Enter");
  await escolher("#f-status", "ATIVO");
  await escolher("#f-auditoria", "PENDENTE");
  await b.focar("#f-observacao"); await b.digitar("Notebook novo entregue ao colaborador.");
  await b.js(`document.activeElement.blur()`);
  await b.js(`__marcar([{ sel: 'dialog[open] [data-campo="hostname"]', n: 1, folga: 3 }, { sel: 'dialog[open] [data-campo="dna"]', n: 1, folga: 3 }, { sel: 'dialog[open] [data-campo="ar"]', n: 1, folga: 3 }, { sel: "dialog[open] button[type=submit]", n: 2, lado: "dir" }])`);
  await b.foto(f("09-novo-preenchido"), { sel: "dialog[open]", folga: 0 });
  await b.js(`__limpar()`);
  await b.clicar("dialog[open] button[type=submit]");
  await b.esperar(`!document.querySelector("dialog[open]")`);
  await espera(700);
  await b.foto(f("10-registrado"));

  /* Linha nova no fim da grade */
  await espera(3800);
  await b.focar('#planilha .linha-nova [data-nova="hostname"]'); await b.digitar("VCSP-NB0734");
  await b.focar('#planilha .linha-nova [data-nova="dna"]'); await b.digitar("493211");
  await b.focar('#planilha .linha-nova [data-nova="usuario"]'); await b.digitar("Renata Oliveira");
  await b.js(`document.activeElement.blur()`);
  await b.js(`__marcar([{ sel: "#planilha .linha-nova", folga: 2 }])`);
  await b.foto(f("11-linha-nova"), { ret: await b.js(`(() => { const r = document.querySelector("#planilha .linha-nova").getBoundingClientRect(); return { x: 0, y: r.top - 130, x2: innerWidth, y2: r.bottom + 14 }; })()`), folga: 0 });
  await b.js(`__limpar()`);
  await b.js(`document.querySelectorAll('#planilha .linha-nova [data-nova]').forEach((el) => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); })`);

  /* Preencher em massa */
  await b.clicar("#btn-massa");
  await b.esperar(`document.querySelector("dialog[open] .massa-campo")`);
  const linhasMassa = [["VCSP-DT0310", "494001", "Sérgio Tavares", "ANTIFRAUDE", "RAMON LICA", "ATIVO", "PENDENTE", "VCERT"], ["VCSP-DT0311", "494002", "Tatiane Gomes", "ANTIFRAUDE", "RAMON LICA", "ATIVO", "PENDENTE", "VCERT"]];
  const ordemMassa = await b.js(`[...document.querySelectorAll("dialog[open] .massa-cab-nome")].map((e) => e.textContent.replace("*", "").trim())`);
  const nomes = ["HOSTNAME", "DNA", "NOME DO USUÁRIO", "ÁREA", "GESTOR", "STATUS", "AUDITORIA", "AR"];
  for (let r = 0; r < linhasMassa.length; r++) {
    for (let k = 0; k < nomes.length; k++) {
      const ci = ordemMassa.indexOf(nomes[k]);
      if (ci < 0) continue;
      await b.focar(`dialog[open] .massa-campo[data-r="${r}"][data-ci="${ci}"]`);
      await b.digitar(linhasMassa[r][k]);
    }
  }
  await b.js(`document.activeElement.blur()`);
  await b.js(`document.querySelector("dialog[open] .massa-rolagem").scrollLeft = 0`);
  await espera(600);
  await b.foto(f("12-massa"), { sel: "dialog[open]", folga: 0 });
  await b.js(`(() => { const d = document.querySelector('dialog[open] [data-m="descartar"]'); if (d) d.click(); })()`);
  await espera(400);
  if (await b.js(`!!document.querySelector("dialog[open] .form-dialog .btn-perigo, dialog[open] button[type=submit][value=ok]")`)) await b.clicar("dialog[open] button[type=submit][value=ok]");
  await fecharDialogo(); await fecharDialogo();

  /* Colar do Excel */
  await b.clicar("#btn-colar");
  await b.esperar(`document.querySelector("dialog[open] textarea[name=colado]")`);
  const tsv = "HOSTNAME\tDNA\tNOME DO USUÁRIO\tÁREA\tGESTOR\tSTATUS\tAUDITORIA\tAR\nVCSP-NB0801\t495101\tUlisses Prado\tPRODUTOS\tFRANSCISCO HÉLIO DINIZ\tATIVO\tPENDENTE\tVCERT\nVCSP-NB0802\t495102\tVanessa Lima\tPRODUTOS\tFRANSCISCO HÉLIO DINIZ\tATIVO\tPENDENTE\tVCERT";
  await b.focar("dialog[open] textarea[name=colado]");
  await b.digitar(tsv);
  await espera(900);
  await b.foto(f("13-colar"), { sel: "dialog[open]", folga: 0 });
  await fecharDialogo();

  /* ---------- 4. Alterar ---------- */
  await b.js(`document.getElementById("planilha").scrollTop = 0`);
  await espera(300);
  const idBruno = "eq002";
  await b.clicar(cel(idBruno, "usuario"));
  await b.esperar(`document.querySelector(".editor-celula input, .editor-celula textarea")`);
  await b.tecla("a", { ctrl: true });
  await b.digitar("Bruno Lima Santos");
  await b.js(`__marcar([{ sel: ".editor-celula", folga: 3 }])`);
  await b.foto(f("14-editar-celula"), { ret: await b.js(`(() => { const h = document.querySelector("#planilha .cab").getBoundingClientRect(); const e = document.querySelector(".editor-celula").getBoundingClientRect(); return { x: 0, y: h.top - 4, x2: innerWidth, y2: e.bottom + 46 }; })()`), folga: 0 });
  await b.js(`__limpar()`);
  await b.tecla("Enter");
  await espera(800);

  await b.clicar(cel(idBruno, "gestor"));
  await b.esperar(`document.querySelector(".combo-lista:not([hidden])")`);
  await espera(300);
  await b.foto(f("15-editar-lista"));
  await b.tecla("Escape"); await b.tecla("Escape");
  await espera(300);

  await b.clicar(cel(idBruno, "hostname"));
  await b.tecla("Enter");
  await b.esperar(`document.querySelector("#aviso.visivel")`);
  await b.js(`__marcar([{ sel: "#aviso" }, { sel: '${cel(idBruno, "hostname")}', folga: 1 }])`);
  await b.foto(f("16-cadeado"));
  await b.js(`__limpar()`);
  await espera(3800);

  await b.clicar(`.linha[data-id="${idBruno}"] [data-acao="mais"]`);
  await b.esperar(`document.querySelector(".pop [data-m]")`);
  await b.foto(f("17-menu-acoes"), { sel: ".pop, .linha[data-id='" + idBruno + "'] .col-acoes", folga: 14 });
  await b.tecla("Escape");
  await b.js(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  await espera(300);

  await b.clicar(`.linha[data-id="${idBruno}"] [data-acao="ficha"]`);
  await b.esperar(`document.querySelector("#ficha.aberta #ficha-historico li")`);
  await espera(900);
  await b.foto(f("18-ficha"));
  await b.clicar('#ficha [data-ficha="editar"]');
  await b.esperar(`document.querySelector("#ficha [type=submit]")`);
  await espera(500);
  await b.foto(f("19-ficha-editar"));
  await b.clicar('#ficha [data-ficha="ver"]');
  await b.clicar('#ficha [data-ficha="fechar"]');
  await espera(500);

  /* ---------- 5. Inativar ---------- */
  const idFelipe = "eq007";
  await b.clicar(`.linha[data-id="${idFelipe}"] [data-acao="ficha"]`);
  await b.esperar(`document.querySelector("#ficha.aberta")`);
  await b.clicar('#ficha [data-ficha="editar"]');
  await b.esperar(`document.querySelector("#ficha #f-status")`);
  await b.focar("#ficha #f-status"); await b.digitar("INAT");
  await espera(300);
  await b.foto(f("20-inativar-lista"));
  await b.tecla("Enter");
  await b.focar("#ficha #f-observacao");
  await b.digitar("INATIVADO em 04/11/2026 - colaborador desligado. Notebook devolvido ao TI (chamado GLPI 18452).");
  await b.clicar('#ficha [data-agora="dataFeita"]');
  await b.js(`document.activeElement.blur()`);
  await espera(300);
  await b.js(`__marcar([{ sel: '#ficha [data-campo="status"]', n: 1 }, { sel: '#ficha [data-campo="observacao"]', n: 2 }, { sel: '#ficha [data-campo="dataFeita"]', n: 3 }, { sel: "#ficha [type=submit]", n: 4, lado: "esq" }])`);
  await b.foto(f("21-inativar-ficha"), { sel: "#ficha", folga: 0 });
  await b.js(`__limpar()`);
  await b.clicar("#ficha [type=submit]");
  await b.esperar(`document.querySelector("#ficha.aberta #ficha-historico li.movimentacao")`, 10000);
  await espera(900);
  await b.js(`__marcar([{ sel: "#ficha .ficha-grupo:last-of-type", folga: 2 }])`);
  await b.foto(f("22-inativado-historico"), { sel: "#ficha", folga: 0 });
  await b.js(`__limpar()`);
  await b.clicar('#ficha [data-ficha="fechar"]');
  await espera(500);

  await b.clicar(`.linha[data-id="eq003"] .celula[data-col="status"]`);
  await b.esperar(`document.querySelector(".editor-celula select")`);
  /* A lista nativa não aparece na captura: mostra as opções abertas só para a foto */
  await b.js(`(() => { const s = document.querySelector(".editor-celula select"); s.size = 3; s.style.height = "auto"; s.style.background = "var(--superficie, #fff)"; s.closest(".editor-celula").style.height = "auto"; const o = [...s.options].find((x) => x.textContent.trim() === "INATIVO"); if (o) o.selected = true; })()`);
  await espera(300);
  await b.foto(f("23-inativar-celula"), { ret: await b.js(`(() => { const a = document.querySelector('.linha[data-id="eq003"]').getBoundingClientRect(); const l = document.querySelector(".editor-celula").getBoundingClientRect(); const h = document.querySelector("#planilha .cab").getBoundingClientRect(); return { x: 0, y: h.top, x2: innerWidth, y2: Math.max(a.bottom, l.bottom) + 30 }; })()`), folga: 0 });
  await b.tecla("Escape");
  await espera(400);

  await b.clicar('#resumo [data-especial="status:disponivel"]');
  await espera(700);
  await b.js(`__marcar([{ sel: '#resumo [data-especial="status:disponivel"]', n: 1 }])`);
  await b.foto(f("24-filtro-inativos"));
  await b.js(`__limpar()`);
  await b.clicar('#resumo [data-especial="status:disponivel"]');
  await espera(400);

  await b.focar("#busca"); await b.digitar("Diego");
  await espera(800);
  await b.foto(f("25-troca-dna"));
  await b.js(`(() => { const el = document.getElementById("busca"); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await espera(600);

  /* Solicitar exclusão (registro feito por engano) */
  await b.clicar(`.linha[data-id="eq014"] [data-acao="mais"]`);
  await b.esperar(`document.querySelector('.pop [data-m="pedir"]')`);
  await b.clicar('.pop [data-m="pedir"]');
  await b.esperar(`document.querySelector("dialog[open] textarea[name=motivo]")`);
  await b.digitar("Cadastro duplicado por engano: o HOSTNAME correto é VCSP-NB0610.");
  await b.foto(f("26-solicitar-exclusao"), { sel: "dialog[open]", folga: 0 });
  await b.clicar("dialog[open] button[type=submit]");
  await b.esperar(`document.querySelector('.linha[data-id="eq014"].pedido-exclusao')`);
  await espera(500);
  await b.foto(f("27-exclusao-solicitada"), { sel: "#planilha .cab, .linha[data-id='eq014']", folga: 6 });

  /* ---------- 6. Extras ---------- */
  await b.clicar("#btn-busca-rapida");
  await b.esperar(`document.querySelector("dialog[open] input")`);
  await b.digitar("490110");
  await espera(600);
  await b.foto(f("28-busca-rapida"), { sel: "dialog[open]", folga: 0 });
  await fecharDialogo();

  await b.clicar('#planilha [data-filtrar="gestor"]');
  await b.esperar(`document.querySelector(".pop")`);
  await espera(400);
  await b.foto(f("29-filtro-coluna"), { sel: ".pop, #planilha .cab", folga: 12 });
  await b.js(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
  await b.tecla("Escape");
  await espera(300);

  await b.js(`__marcar([{ sel: "#btn-colunas", n: 1, lado: "cima" }, { sel: "#btn-densidade", n: 2, lado: "cima" }, { sel: ".tamanho-grade", n: 3, lado: "cima" }, { sel: "#btn-csv", n: 4, lado: "cima" }, { sel: "#btn-imprimir", n: 5, lado: "cima" }, { sel: "#btn-desfazer", n: 6, lado: "cima" }])`);
  await b.foto(f("30-ferramentas"), { sel: ".barra", folga: 40 });
  await b.js(`__limpar()`);

  await b.clicar("#btn-identidade");
  await espera(500);
  await b.foto(f("31-menu-pessoa"), { sel: ".pop, .topo-acoes", folga: 14 });

  console.log("ok");
} finally {
  await b.fechar();
}
