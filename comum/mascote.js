/* ============================================================
 *  Mascote da planilha: Byte, o gatinho, e mais 26 bichos (ou "Surpresa do dia", sorteada por navegador).
 *  Camada fixa por cima da página: só o bichinho recebe o ponteiro, nunca o foco (aria-hidden).
 *  Anda pela borda de baixo da planilha e, às vezes, por cima da barra de ferramentas.
 *  Conversa com a planilha só por eventos: "planilha:salvou", "planilha:erro" e "mascote:preferencias".
 *  Sem som. Animações só com transform/opacity; no modo "Calmo" (ou prefers-reduced-motion) fica sentado.
 * ============================================================ */
(() => {
  const script = document.currentScript;
  const PREFIXO = (script && script.dataset.prefixo) || "planilha";
  const SEL_GRADE = (script && script.dataset.grade) || "#planilha";
  const SEL_BARRA = (script && script.dataset.barra) || ".barra";
  const CHAVE = `${PREFIXO}-mascote`;
  const L = 56, A = 48, ESPACO = 50;
  const VELOCIDADE = 38;
  const SONO_MS = 60000, SONO_NOITE_MS = 25000;

  /* ---------- Preferências (neste navegador) ---------- */
  /* animado: modo "Animado" (mais brincadeiras e especiais). menosMovimento = modo "Calmo". */
  const PADRAO = { mostrar: true, animal: "gato", menosMovimento: false, animado: false, escondidoEm: "" };
  const lerPrefs = () => { try { return { ...PADRAO, ...(JSON.parse(localStorage.getItem(CHAVE)) || {}) }; } catch { return { ...PADRAO }; } };
  const gravarPrefs = () => { try { localStorage.setItem(CHAVE, JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };
  let prefs = lerPrefs();
  const hojeBrasilia = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const horaBrasilia = () => Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  const movimentoReduzido = matchMedia("(prefers-reduced-motion: reduce)");
  const quieto = () => prefs.menosMovimento || movimentoReduzido.matches;
  const animado = () => prefs.animado && !quieto();
  const ativo = () => prefs.mostrar && prefs.escondidoEm !== hojeBrasilia();

  /* ---------- Desenhos (SVG próprio, olhando para a direita) ---------- */
  const olhosFechados = (a, b, y, cor = "#1b1d26") => `<g class="m-fechados"><path d="M${a - 2.7} ${y} q2.7 2.4 5.4 0 M${b - 2.7} ${y} q2.7 2.4 5.4 0" fill="none" stroke="${cor}" stroke-width="1.4" stroke-linecap="round"/></g>`;
  /* Peças dos bichos novos (mesmas classes de animação dos quatro primeiros) */
  const olhosFechadosP = (a, b, y, cor = "#1b1d26") => `<g class="m-fechados"><path d="M${a - 1.6} ${y} q1.6 1.5 3.2 0 M${b - 1.6} ${y} q1.6 1.5 3.2 0" fill="none" stroke="${cor}" stroke-width="1.1" stroke-linecap="round"/></g>`;
  const olhos = (a, b, y, r, rp, cor = "#1b1d26") => `<g class="m-olhos"><circle cx="${a}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${b}" cy="${y}" r="${r}" fill="#fff"/>`
    + `<g class="m-pupilas"><circle cx="${a + 0.2}" cy="${y + 0.3}" r="${rp}" fill="${cor}"/><circle cx="${b + 0.2}" cy="${y + 0.3}" r="${rp}" fill="${cor}"/>`
    + `<circle cx="${a + 0.7}" cy="${y - 0.4}" r="${(rp * 0.35).toFixed(2)}" fill="#fff"/><circle cx="${b + 0.7}" cy="${y - 0.4}" r="${(rp * 0.35).toFixed(2)}" fill="#fff"/></g></g>`;
  const bochechas = (a, b, y, r = 1.7) => `<circle cx="${a}" cy="${y}" r="${r}" fill="#e58fa5" opacity=".45"/><circle cx="${b}" cy="${y}" r="${r}" fill="#e58fa5" opacity=".45"/>`;
  const boca = (x, y, cor) => `<path class="m-boca" d="M${x - 2.5} ${y} q1.2 1.3 2.5 0 q1.2 1.3 2.5 0" fill="none" stroke="${cor}" stroke-width="1" stroke-linecap="round"/>`;
  const bocaAberta = (x, y, rx = 2.1, ry = 2.3) => `<ellipse class="m-boca-aberta" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#5a2330"/><path class="m-lingua" d="M${x - 1.2} ${y - 1} q1.2 4.6 2.4 0 z" fill="#ef8fa0"/>`;
  const pata = (n, x, y, w, h, cor, rx = 3) => `<g class="m-pata m-pata-${n}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${cor}"/></g>`;
  /* Pé de ave (bípedes: 1+2 e 3+4 ficam sobrepostas e andam juntas) */
  const pe = (n, x, cor, grande) => grande
    ? `<g class="m-pata m-pata-${n}"><rect x="${x + 2.6}" y="44" width="2.4" height="7" rx="1" fill="${cor}"/><rect x="${x}" y="50" width="8.5" height="3.4" rx="1.7" fill="${cor}"/></g>`
    : `<g class="m-pata m-pata-${n}"><rect x="${x + 2.3}" y="45" width="1.9" height="6.5" rx=".9" fill="${cor}"/><rect x="${x}" y="50.8" width="6.4" height="2.4" rx="1.2" fill="${cor}"/></g>`;
  const ANIMAIS = {
    gato: {
      nome: "Gatinho Byte",
      ronrom: "prrr",
      oi: "Miau!",
      svg: `<g class="m-cauda"><path d="M14 38 C4 36 3 24 9 19" fill="none" stroke="#7b7d8a" stroke-width="5" stroke-linecap="round"/></g>
        <g class="m-pata m-pata-1"><rect x="17" y="40" width="6" height="13" rx="3" fill="#6c6e7a"/></g>
        <g class="m-pata m-pata-2"><rect x="25" y="40" width="6" height="13" rx="3" fill="#858795"/></g>
        <g class="m-pata m-pata-3"><rect x="37" y="40" width="6" height="13" rx="3" fill="#6c6e7a"/></g>
        <g class="m-pata m-pata-4"><rect x="45" y="40" width="6" height="13" rx="3" fill="#858795"/></g>
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="37" rx="19" ry="10.5" fill="#8b8d9b"/>
          <path d="M20 31 q4 -3 8 0 M27 30 q4 -3 8 0" stroke="#767887" stroke-width="2" fill="none" stroke-linecap="round"/>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M39.5 15 L41 2.5 L48.5 10.5 Z" fill="#8b8d9b"/><path d="M41.5 12 L42.3 5.5 L46 9.6 Z" fill="#e7a1b4"/></g>
            <g class="m-orelha"><path d="M50 10 L58.5 3 L60 16 Z" fill="#8b8d9b"/><path d="M52.6 9.8 L57.3 6 L58 12.6 Z" fill="#e7a1b4"/></g>
            <circle cx="49" cy="21" r="12.5" fill="#8b8d9b"/>
            <circle cx="42" cy="25.2" r="1.8" fill="#e58fa5" opacity=".45"/><circle cx="56.5" cy="25.2" r="1.8" fill="#e58fa5" opacity=".45"/>
            <g class="m-olhos"><ellipse cx="44.5" cy="20" rx="2.8" ry="3.4" fill="#fff"/><ellipse cx="54" cy="20" rx="2.8" ry="3.4" fill="#fff"/>
              <g class="m-pupilas"><circle cx="44.8" cy="20.4" r="2.1" fill="#5bbf7a"/><circle cx="54.3" cy="20.4" r="2.1" fill="#5bbf7a"/><circle cx="44.8" cy="20.4" r="1.1" fill="#1b1d26"/><circle cx="54.3" cy="20.4" r="1.1" fill="#1b1d26"/></g></g>
            ${olhosFechados(44.5, 54, 20.5)}
            <path d="M47.8 24.8 h3.4 l-1.7 1.7 z" fill="#e58fa5"/>
            <path class="m-boca" d="M47.2 27.2 q1.2 1.3 2.3 0 q1.1 1.3 2.3 0" fill="none" stroke="#3b3d48" stroke-width="1" stroke-linecap="round"/>
            <ellipse class="m-boca-aberta" cx="49.5" cy="28.6" rx="2" ry="2.4" fill="#5a2330"/>
            <path class="m-lingua" d="M48.4 27.6 q1.1 4.4 2.2 0 z" fill="#e58fa5"/>
            <path d="M40.5 25 h-6 M40.5 27 l-5.5 1.5 M58 25 h6 M58 27 l5.5 1.5" stroke="#d5d7e0" stroke-width=".8" stroke-linecap="round"/>
            <path d="M39.5 31 q9.5 5.5 19 0" stroke="#9b7fd4" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="49" cy="34.2" r="2" fill="#f2c94c"/>
          </g>
        </g>`
    },
    cachorro: {
      nome: "Cachorro",
      ronrom: "*abana o rabo*",
      oi: "Au!",
      svg: `<g class="m-cauda"><path d="M13 33 C7 28 7 22 10 17" fill="none" stroke="#b9824f" stroke-width="5" stroke-linecap="round"/></g>
        <g class="m-pata m-pata-1"><rect x="17" y="40" width="6" height="13" rx="3" fill="#a8733f"/></g>
        <g class="m-pata m-pata-2"><rect x="25" y="40" width="6" height="13" rx="3" fill="#c08a55"/></g>
        <g class="m-pata m-pata-3"><rect x="37" y="40" width="6" height="13" rx="3" fill="#a8733f"/></g>
        <g class="m-pata m-pata-4"><rect x="45" y="40" width="6" height="13" rx="3" fill="#c08a55"/></g>
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="37" rx="19" ry="10.5" fill="#c99561"/>
          <ellipse cx="25" cy="33" rx="6" ry="4" fill="#a8733f"/>
          <g class="m-cabeca">
            <circle cx="49" cy="21" r="12" fill="#d7a46d"/>
            <g class="m-orelha"><path d="M38.5 12 q-5 8 -1 17 q4 -1 5 -6 z" fill="#8a5a2e"/></g>
            <g class="m-orelha"><path d="M59.5 12 q5 8 1 17 q-4 -1 -5 -6 z" fill="#8a5a2e"/></g>
            <ellipse cx="50" cy="27" rx="6.5" ry="4.6" fill="#f1d2ad"/>
            <g class="m-olhos"><circle cx="44.5" cy="19.5" r="2.4" fill="#fff"/><circle cx="54" cy="19.5" r="2.4" fill="#fff"/>
              <g class="m-pupilas"><circle cx="44.7" cy="19.8" r="1.7" fill="#2a1d14"/><circle cx="54.2" cy="19.8" r="1.7" fill="#2a1d14"/></g></g>
            ${olhosFechados(44.5, 54, 20)}
            <ellipse cx="50" cy="24.8" rx="2.4" ry="1.7" fill="#2a1d14"/>
            <path class="m-boca" d="M47.5 28 q1.2 1.3 2.5 0 q1.2 1.3 2.5 0" fill="none" stroke="#5b3a1e" stroke-width="1" stroke-linecap="round"/>
            <ellipse class="m-boca-aberta" cx="50" cy="29.3" rx="2.2" ry="2.4" fill="#5a2330"/>
            <path class="m-lingua" d="M48.7 28.3 q1.3 5 2.6 0 z" fill="#ef8fa0"/>
            <path d="M39.5 31.5 q9.5 5.5 19 0" stroke="#d65a5a" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="49" cy="34.6" r="2" fill="#f2c94c"/>
          </g>
        </g>`
    },
    capivara: {
      nome: "Capivara",
      ronrom: "…zen",
      oi: "Oi!",
      svg: `<g class="m-cauda"></g>
        <g class="m-pata m-pata-1"><rect x="16" y="43" width="7" height="10" rx="3" fill="#7b5636"/></g>
        <g class="m-pata m-pata-2"><rect x="25" y="43" width="7" height="10" rx="3" fill="#8d6440"/></g>
        <g class="m-pata m-pata-3"><rect x="36" y="43" width="7" height="10" rx="3" fill="#7b5636"/></g>
        <g class="m-pata m-pata-4"><rect x="44" y="43" width="7" height="10" rx="3" fill="#8d6440"/></g>
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="30" cy="36" rx="21" ry="12" fill="#9b6f48"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="42" cy="12.5" r="2.8" fill="#7b5636"/></g>
            <g class="m-orelha"><circle cx="50" cy="11.5" r="2.8" fill="#7b5636"/></g>
            <rect x="37" y="12" width="21" height="19" rx="8" fill="#a77a51"/>
            <rect x="46" y="17" width="16" height="14" rx="6.5" fill="#a77a51"/>
            <g class="m-olhos"><circle cx="45" cy="18.5" r="1.9" fill="#fff"/><circle cx="51.5" cy="18" r="1.9" fill="#fff"/>
              <g class="m-pupilas"><circle cx="45.2" cy="18.7" r="1.3" fill="#2a1d14"/><circle cx="51.7" cy="18.2" r="1.3" fill="#2a1d14"/></g></g>
            ${olhosFechados(45, 51.5, 19)}
            <ellipse cx="57" cy="21.5" rx="1" ry=".8" fill="#3a2717"/><ellipse cx="60" cy="21.5" rx="1" ry=".8" fill="#3a2717"/>
            <path class="m-boca" d="M54 27 q2.5 1.4 5 0" fill="none" stroke="#3a2717" stroke-width="1" stroke-linecap="round"/>
            <ellipse class="m-boca-aberta" cx="56.5" cy="27.8" rx="2" ry="2.2" fill="#4a2a1a"/>
            <path class="m-lingua" d="M55.5 27.2 q1 4 2 0 z" fill="#e58fa5"/>
            <circle cx="45" cy="9.5" r="3.4" fill="#f2994a"/><path d="M45.3 6.3 l1.2 -2.2" stroke="#4f8a3a" stroke-width="1.4" stroke-linecap="round"/>
          </g>
        </g>`
    },
    pinguim: {
      nome: "Pinguim",
      ronrom: "*balança*",
      oi: "Ôpa!",
      svg: `<g class="m-cauda"><path d="M21 28 q-9 9 -4 18 q6 -4 8 -13 z" fill="#20232d"/></g>
        <g class="m-pata m-pata-1"><rect x="25" y="49" width="8" height="5" rx="2" fill="#e08a3c"/></g>
        <g class="m-pata m-pata-2"><rect x="25" y="49" width="8" height="5" rx="2" fill="#f2994a"/></g>
        <g class="m-pata m-pata-3"><rect x="36" y="49" width="8" height="5" rx="2" fill="#e08a3c"/></g>
        <g class="m-pata m-pata-4"><rect x="36" y="49" width="8" height="5" rx="2" fill="#f2994a"/></g>
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="34" cy="33" rx="15" ry="18" fill="#20232d"/>
          <ellipse cx="37" cy="36" rx="10" ry="14" fill="#f5f5f2"/>
          <g class="m-cabeca">
            <g class="m-orelha"></g>
            <circle cx="39" cy="16" r="11" fill="#20232d"/>
            <ellipse cx="42" cy="18" rx="7.5" ry="7" fill="#f5f5f2"/>
            <g class="m-olhos"><circle cx="39.5" cy="16.5" r="2" fill="#fff"/><circle cx="45" cy="16.5" r="2" fill="#fff"/>
              <g class="m-pupilas"><circle cx="39.7" cy="16.8" r="1.3" fill="#1b1d26"/><circle cx="45.2" cy="16.8" r="1.3" fill="#1b1d26"/></g></g>
            ${olhosFechados(39.5, 45, 17)}
            <path d="M47 19 l7 1.8 l-7 1.8 z" fill="#f2994a"/>
            <path class="m-boca" d="M47 22.6 h3" stroke="#c46f25" stroke-width="1" stroke-linecap="round"/>
            <ellipse class="m-boca-aberta" cx="49" cy="22.8" rx="2" ry="1.6" fill="#5a2330"/>
            <path class="m-lingua" d="M48.2 22.5 q.8 3 1.6 0 z" fill="#e58fa5"/>
            <path d="M29 27 q10 5.5 20 0" stroke="#9b7fd4" stroke-width="3" fill="none" stroke-linecap="round"/>
          </g>
        </g>`
    },
    /* Campos opcionais dos bichos novos (os quatro acima usam os padrões):
       escala (tamanho), andar "quadrupede" | "bipede", ginga (balanço lateral), velocidade, sono (fração do tempo
       até dormir), frases (entram no sorteio do clique), especial { classe, ms, efeito, poses, depois }, escuro (contorno no tema escuro),
       efeito: "fumaca" | "notas" | "rugido" | "bolhas" | "zumbido" (saem da boca) | "estrelas" (em volta do corpo),
       boca [x, y] (de onde saem fumacinha, notas e rugido, no desenho 64×56). */
    urso: {
      nome: "Urso",
      ronrom: "*abraço de urso*",
      oi: "Grrr… brincadeira! 🐻",
      frases: ["Hora de hibernar? Só depois de salvar."],
      velocidade: 0.75,
      especial: { classe: "esp-urso", ms: 1900 },
      svg: `<g class="m-cauda"><circle cx="11.5" cy="32.5" r="3.4" fill="#82512c"/></g>
        ${pata(1, 15, 40, 8, 13, "#7a4a28", 3.6)}${pata(2, 24, 40, 8, 13, "#93603a", 3.6)}${pata(3, 36, 40, 8, 13, "#7a4a28", 3.6)}${pata(4, 45, 40, 8, 13, "#93603a", 3.6)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="30" cy="36" rx="20.5" ry="12.5" fill="#9a6237"/>
          <ellipse cx="31" cy="42" rx="11" ry="4.5" fill="#c9935f"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="40" cy="11.5" r="4.6" fill="#82512c"/><circle cx="40" cy="11.5" r="2.3" fill="#d9a17a"/></g>
            <g class="m-orelha"><circle cx="57.5" cy="10.5" r="4.6" fill="#82512c"/><circle cx="57.5" cy="10.5" r="2.3" fill="#d9a17a"/></g>
            <circle cx="49" cy="21.5" r="12.5" fill="#a86d3f"/>
            ${bochechas(41.8, 57.6, 25.5)}
            <ellipse cx="50.5" cy="27" rx="6.6" ry="5" fill="#e8c79f"/>
            ${olhos(44.5, 54, 19.5, 2.4, 1.6, "#2a1d14")}
            ${olhosFechados(44.5, 54, 20)}
            <ellipse cx="50.5" cy="24.9" rx="2.4" ry="1.7" fill="#2a1d14"/>
            ${boca(50.5, 28.2, "#5b3a1e")}
            ${bocaAberta(50.5, 29.6)}
          </g>
        </g>`
    },
    pato: {
      nome: "Pato",
      ronrom: "*quack baixinho*",
      oi: "Quack!",
      frases: ["Patinho organizado, planilha feliz."],
      andar: "bipede",
      ginga: true,
      especial: { classe: "esp-pato", ms: 1300 },
      svg: `<g class="m-cauda"><path d="M16 31 l-8 -5 l1.5 8.5 z" fill="#e6c034"/></g>
        ${pe(1, 23.5, "#e08a3c", true)}${pe(2, 23.5, "#f2994a", true)}${pe(3, 33.5, "#e08a3c", true)}${pe(4, 33.5, "#f2994a", true)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="30" cy="38" rx="16" ry="11" fill="#f7d64a"/>
          <ellipse cx="38.5" cy="28" rx="6" ry="8" fill="#f7d64a"/>
          <g class="m-orelha m-asa"><path d="M20 35 q9 -8 17 0 q-8 8 -17 0 z" fill="#ecc43a"/></g>
          <g class="m-cabeca">
            <circle cx="42" cy="19" r="10" fill="#f7d64a"/>
            ${bochechas(38.8, 46.6, 23, 1.5)}
            ${olhos(41.5, 47, 17, 2.2, 1.5)}
            ${olhosFechados(41.5, 47, 17.5)}
            <path d="M49 19.5 q7.5 -.8 9.5 2 q-2 2.4 -9.5 1.6 z" fill="#f2994a"/>
            <path class="m-boca" d="M49.3 23 q5.5 .8 8.2 -.6 q-2 2.4 -8.2 1.6 z" fill="#e08a3c"/>
            <g class="m-boca-aberta"><path d="M49.5 22.8 l7 1.4 l-7 2 z" fill="#5a2330"/><path d="M49.3 23.6 q5 2.4 7.6 2.8 q-3.6 1.6 -7.6 -.6 z" fill="#e08a3c"/></g>
            <path class="m-lingua" d="M50.5 23.6 q2.4 .7 3.8 .4 q-2.2 1.1 -3.8 .4 z" fill="#ef8fa0"/>
          </g>
        </g>`
    },
    dragao: {
      nome: "Dragão",
      ronrom: "*fumacinha*",
      oi: "Rawr! (versão fofa)",
      frases: ["Guardo seus dados como um tesouro."],
      especial: { classe: "esp-dragao", ms: 1700, efeito: "fumaca" },
      boca: [61, 25],
      svg: `<g class="m-cauda"><path d="M14 38 C7 38 4 33 5.5 27" fill="none" stroke="#4fb3a9" stroke-width="5" stroke-linecap="round"/><path d="M2 27.5 l3.5 -6 l3.5 6 z" fill="#3a8f87"/></g>
        ${pata(1, 17, 40, 6, 13, "#3e978e")}${pata(2, 25, 40, 6, 13, "#58c0b5")}${pata(3, 37, 40, 6, 13, "#3e978e")}${pata(4, 45, 40, 6, 13, "#58c0b5")}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="37" rx="19" ry="10.5" fill="#4fb3a9"/>
          <ellipse cx="33" cy="42" rx="11" ry="4" fill="#cdeee0"/>
          <path d="M15 31 l2 -3.5 l2.2 3 z M20 28.5 l2 -3.5 l2.2 3 z" fill="#3a8f87"/>
          <g class="m-asa"><path d="M25 30 q-7 -9 1 -16 q0 5 4 5.5 q-1 4 3.5 6 q-2 4.5 -8.5 4.5 z" fill="#8fd3c9"/><path d="M26.5 17 q1.5 6 5 9" stroke="#4fb3a9" stroke-width=".9" fill="none"/></g>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M41.5 12 q-1.5 -6 2.5 -9 q-.7 4.5 2 8 z" fill="#f2e2b0"/></g>
            <g class="m-orelha"><path d="M50 10 q1 -6 5.5 -7 q-2.5 3.5 -1.6 7.6 z" fill="#f2e2b0"/></g>
            <circle cx="48.5" cy="21" r="11.5" fill="#58c0b5"/>
            <ellipse cx="55" cy="25.5" rx="7" ry="5" fill="#58c0b5"/>
            <circle cx="59" cy="23.6" r=".7" fill="#2f6f69"/><circle cx="61" cy="24.2" r=".7" fill="#2f6f69"/>
            ${bochechas(42.5, 52.5, 26)}
            ${olhos(44.5, 52.5, 19, 2.7, 1.8)}
            ${olhosFechados(44.5, 52.5, 19.5)}
            <path class="m-boca" d="M52.5 28.6 q1.6 1.2 3.2 0 q1.5 1.2 3 0" fill="none" stroke="#2f6f69" stroke-width="1" stroke-linecap="round"/>
            ${bocaAberta(56, 29.8, 2.2, 2.3)}
          </g>
        </g>`
    },
    macaco: {
      nome: "Macaco",
      ronrom: "*cata-cata*",
      oi: "Uh uh ah ah!",
      frases: ["Tem banana nessa planilha?"],
      escuro: true,
      especial: { classe: "esp-macaco", ms: 2000, poses: ["pendurado"] },
      svg: `<g class="m-cauda"><path d="M13 35 C3 36 2 22 9 21 C14 21 13 27 9 26" fill="none" stroke="#7a4b2a" stroke-width="3.2" stroke-linecap="round"/></g>
        ${pata(1, 17, 40, 5.5, 13, "#5f3a1d")}${pata(2, 25, 40, 5.5, 13, "#82532f")}${pata(3, 37, 40, 5.5, 13, "#5f3a1d")}${pata(4, 45, 40, 5.5, 13, "#82532f")}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="37" rx="18" ry="10" fill="#7a4b2a"/>
          <ellipse cx="33" cy="40.5" rx="9" ry="5" fill="#c9a27a"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="38" cy="21" r="4.2" fill="#7a4b2a"/><circle cx="38" cy="21" r="2.4" fill="#e9c9a0"/></g>
            <g class="m-orelha"><circle cx="60" cy="21" r="4.2" fill="#7a4b2a"/><circle cx="60" cy="21" r="2.4" fill="#e9c9a0"/></g>
            <circle cx="49" cy="21" r="11.5" fill="#7a4b2a"/>
            <path d="M41.5 19 c0 -3.8 3 -5.6 5.5 -4.6 c1.2 .5 2.8 .5 4 0 c2.5 -1 5.5 .8 5.5 4.6 c0 1.6 -.6 2.7 -1.4 3.6 c1.4 1 2.2 2.4 2.2 4 c0 3.2 -3.6 5.6 -8.3 5.6 c-4.7 0 -8.3 -2.4 -8.3 -5.6 c0 -1.6 .8 -3 2.2 -4 c-.8 -.9 -1.4 -2 -1.4 -3.6 z" fill="#e9c9a0"/>
            ${bochechas(43.6, 54.4, 25, 1.5)}
            ${olhos(45.6, 52.4, 19.4, 2.3, 1.6, "#2a1d14")}
            ${olhosFechados(45.6, 52.4, 19.9)}
            <circle cx="48.2" cy="24.6" r=".55" fill="#5b3a1e"/><circle cx="49.8" cy="24.6" r=".55" fill="#5b3a1e"/>
            <path class="m-boca" d="M46.5 27.2 q2.5 2 5 0" fill="none" stroke="#5b3a1e" stroke-width="1" stroke-linecap="round"/>
            ${bocaAberta(49, 28.4, 2.4, 2.2)}
          </g>
        </g>`
    },
    trex: {
      nome: "T-Rex",
      ronrom: "*bracinhos felizes*",
      oi: "ROAR! 🦖",
      frases: ["Não alcanço o teclado, mas torço por você."],
      andar: "bipede",
      escala: 1.08,
      escuro: true,
      especial: { classe: "esp-trex", ms: 1500, efeito: "rugido" },
      boca: [59, 21],
      svg: `<g class="m-cauda"><path d="M21 31 q-11 1 -19 8 q10 -1.5 20 -.5 z" fill="#4b8a48"/></g>
        <g class="m-pata m-pata-1"><rect x="20" y="40" width="7.5" height="12" rx="3.4" fill="#437d40"/><rect x="20" y="49.5" width="11" height="4" rx="2" fill="#437d40"/></g>
        <g class="m-pata m-pata-2"><rect x="20" y="40" width="7.5" height="12" rx="3.4" fill="#4b8a48"/><rect x="20" y="49.5" width="11" height="4" rx="2" fill="#4b8a48"/></g>
        <g class="m-pata m-pata-3"><rect x="30" y="40" width="7.5" height="12" rx="3.4" fill="#437d40"/><rect x="30" y="49.5" width="11" height="4" rx="2" fill="#437d40"/></g>
        <g class="m-pata m-pata-4"><rect x="30" y="40" width="7.5" height="12" rx="3.4" fill="#5ea35a"/><rect x="30" y="49.5" width="11" height="4" rx="2" fill="#5ea35a"/></g>
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="29" cy="34" rx="13.5" ry="11" fill="#5ea35a"/>
          <ellipse cx="33.5" cy="37" rx="7" ry="7.5" fill="#cfe8a8"/>
          <path d="M19 27 l2 -3 l2 3 z M24 24.5 l2 -3 l2 3 z" fill="#4b8a48"/>
          <ellipse cx="38" cy="24.5" rx="6.5" ry="7.5" fill="#5ea35a"/>
          <g class="m-braco"><path d="M36.5 33.5 q3.5 .8 4.2 4.2" fill="none" stroke="#437d40" stroke-width="2.2" stroke-linecap="round"/></g>
          <g class="m-braco"><path d="M38.5 32 q4 .5 5 4" fill="none" stroke="#4b8a48" stroke-width="2.4" stroke-linecap="round"/></g>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M41 10 q2 -4 4 0 q2 -4 4 0 z" fill="#4b8a48"/></g>
            <rect x="35.5" y="8.5" width="25" height="15.5" rx="7.5" fill="#5ea35a"/>
            <rect x="40" y="17" width="19" height="9" rx="4.5" fill="#5ea35a"/>
            <circle cx="58.5" cy="13" r=".75" fill="#2f5f2d"/>
            ${bochechas(42.6, 54.5, 19.4, 1.6)}
            ${olhos(45.5, 51.5, 14.5, 2.4, 1.6)}
            ${olhosFechados(45.5, 51.5, 15)}
            <g class="m-boca"><path d="M43.5 21.6 q7.5 1.6 15 -.6" fill="none" stroke="#2f5f2d" stroke-width="1" stroke-linecap="round"/><path d="M48 22.3 l1 1.4 l1 -1.3 z M53 22.1 l1 1.4 l1 -1.4 z" fill="#fff"/></g>
            <g class="m-boca-aberta"><path d="M43.5 20.5 q8 0 15.5 -1.6 q-2 6.8 -8.5 7.4 q-5.2 0 -7 -5.8 z" fill="#5a2330"/><path d="M47 20.8 l1 1.6 l1 -1.6 z M52.5 20.3 l1 1.6 l1 -1.7 z" fill="#fff"/></g>
            <path class="m-lingua" d="M48.5 24 q2.6 2.6 5.2 0 z" fill="#ef8fa0"/>
          </g>
        </g>`
    },
    hamster: {
      nome: "Hamster",
      ronrom: "*bochechas cheias*",
      oi: "Squeak!",
      frases: ["Guardei umas sementes no rascunho."],
      escala: 0.8,
      velocidade: 1.2,
      especial: { classe: "esp-hamster", ms: 1500 },
      svg: `<g class="m-cauda"><circle cx="14" cy="40" r="2.2" fill="#c98a42"/></g>
        ${pata(1, 19, 46, 6, 7, "#d08f45", 2.6)}${pata(2, 26, 46, 6, 7, "#e7a95c", 2.6)}${pata(3, 37, 46, 6, 7, "#d08f45", 2.6)}${pata(4, 44, 46, 6, 7, "#e7a95c", 2.6)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="38" rx="18" ry="13.5" fill="#e8a95a"/>
          <ellipse cx="35" cy="43" rx="10" ry="7" fill="#fbf3e6"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="40.5" cy="18" r="3.3" fill="#e8a95a"/><circle cx="40.5" cy="18" r="1.8" fill="#f4b8c0"/></g>
            <g class="m-orelha"><circle cx="51" cy="16.8" r="3.3" fill="#e8a95a"/><circle cx="51" cy="16.8" r="1.8" fill="#f4b8c0"/></g>
            <circle cx="47" cy="27" r="11" fill="#e8a95a"/>
            <ellipse class="m-bochecha" cx="45.5" cy="32" rx="3.6" ry="3" fill="#fbf3e6"/>
            <ellipse class="m-bochecha" cx="54" cy="31.5" rx="3.6" ry="3" fill="#fbf3e6"/>
            <ellipse cx="51" cy="31.5" rx="5" ry="3.8" fill="#fbf3e6"/>
            ${bochechas(44.5, 55.5, 30, 1.6)}
            ${olhos(45.5, 52.5, 25.3, 2.4, 1.9)}
            ${olhosFechados(45.5, 52.5, 25.8)}
            <ellipse cx="56.5" cy="29" rx="1.3" ry=".95" fill="#e58fa5"/>
            ${boca(55.5, 31.2, "#8a5a2e")}
            ${bocaAberta(55.5, 32.6, 1.5, 1.7)}
          </g>
        </g>`
    },
    panda: {
      nome: "Panda",
      ronrom: "*mastiga bambu*",
      oi: "Oi, eu sou fofo e sei disso.",
      frases: ["Uma pausa pro bambu?"],
      velocidade: 0.75,
      escuro: true,
      especial: { classe: "esp-panda", ms: 1300, depois: "sentado" },
      svg: `<g class="m-cauda"><circle cx="11.5" cy="33" r="2.8" fill="#dcdcd6"/></g>
        ${pata(1, 15, 40, 8, 13, "#22242a", 3.6)}${pata(2, 24, 40, 8, 13, "#363944", 3.6)}${pata(3, 36, 40, 8, 13, "#22242a", 3.6)}${pata(4, 45, 40, 8, 13, "#363944", 3.6)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="30" cy="36" rx="20.5" ry="12.5" fill="#f4f4f1" stroke="#d9d7cf" stroke-width=".8"/>
          <path d="M35 25 q9 1 9.5 12 q-4.5 3.5 -10 1.5 q2.5 -7 .5 -13.5 z" fill="#2a2c33"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="40" cy="11.5" r="4.6" fill="#2a2c33"/></g>
            <g class="m-orelha"><circle cx="57.5" cy="10.5" r="4.6" fill="#2a2c33"/></g>
            <circle cx="49" cy="21.5" r="12.5" fill="#f4f4f1" stroke="#d9d7cf" stroke-width=".8"/>
            <ellipse cx="44.5" cy="20.5" rx="3.6" ry="4.5" transform="rotate(22 44.5 20.5)" fill="#2a2c33"/>
            <ellipse cx="54" cy="20.5" rx="3.6" ry="4.5" transform="rotate(-22 54 20.5)" fill="#2a2c33"/>
            ${bochechas(41.5, 57.8, 26.5, 1.6)}
            ${olhos(44.8, 53.7, 20, 2, 1.4)}
            ${olhosFechados(44.8, 53.7, 20.5, "#f4f4f1")}
            <ellipse cx="50" cy="27" rx="5.5" ry="4" fill="#ffffff"/>
            <ellipse cx="50" cy="25.1" rx="2.2" ry="1.5" fill="#2a2c33"/>
            ${boca(50, 28.3, "#2a2c33")}
            ${bocaAberta(50, 29.6, 2, 2.2)}
          </g>
        </g>`
    },
    coala: {
      nome: "Coala",
      ronrom: "*abraço apertado*",
      oi: "…zzz… ah, oi!",
      frases: ["Acordei só pra ver você preencher."],
      velocidade: 0.7,
      sono: 0.5,
      especial: { classe: "esp-coala", ms: 2600, depois: "sentado" },
      svg: `<g class="m-cauda"><circle cx="12.5" cy="35" r="2.2" fill="#868b96"/></g>
        ${pata(1, 17, 40, 6.5, 13, "#7c818c", 3.2)}${pata(2, 25, 40, 6.5, 13, "#a1a6b0", 3.2)}${pata(3, 37, 40, 6.5, 13, "#7c818c", 3.2)}${pata(4, 45, 40, 6.5, 13, "#a1a6b0", 3.2)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="37" rx="19" ry="11" fill="#9ea3ad"/>
          <ellipse cx="33" cy="41.5" rx="10" ry="4.5" fill="#d7dae0"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="39.5" cy="14" r="6.6" fill="#9ea3ad"/><circle cx="39" cy="14.2" r="3.9" fill="#e3e5ea"/></g>
            <g class="m-orelha"><circle cx="58.5" cy="13.5" r="6.6" fill="#9ea3ad"/><circle cx="59" cy="13.7" r="3.9" fill="#e3e5ea"/></g>
            <circle cx="49" cy="22" r="11.5" fill="#a9aeb8"/>
            ${bochechas(42.5, 55.5, 27, 1.7)}
            ${olhos(44.6, 53.4, 20.8, 2.3, 1.6)}
            ${olhosFechados(44.6, 53.4, 21.3)}
            <ellipse cx="49" cy="25.8" rx="3.3" ry="4.1" fill="#2a2c33"/>
            <path class="m-boca" d="M47 30.6 q2 1.4 4 0" fill="none" stroke="#3b3d48" stroke-width="1" stroke-linecap="round"/>
            ${bocaAberta(49, 31.4, 1.9, 1.8)}
          </g>
        </g>`
    },
    calopsita: {
      nome: "Calopsita",
      ronrom: "*assobio*",
      oi: "Fiu-fiu! 🎶",
      frases: ["Assobiando enquanto você digita."],
      andar: "bipede",
      ginga: true,
      especial: { classe: "esp-calopsita", ms: 1900, efeito: "notas" },
      boca: [50, 20],
      svg: `<g class="m-cauda"><path d="M19 40 l-15 5 l16 1 z" fill="#a9adb6"/></g>
        ${pe(1, 26, "#c99383")}${pe(2, 26, "#d9a38f")}${pe(3, 32.5, "#c99383")}${pe(4, 32.5, "#d9a38f")}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="37" rx="11" ry="11.5" fill="#c9cbd1"/>
          <ellipse cx="34.5" cy="40" rx="6" ry="7" fill="#dfe0e4"/>
          <g class="m-asa"><path d="M22 32 q9 -3 13 6 q-4 7.5 -12.5 5.5 q-3 -6 -.5 -11.5 z" fill="#a9adb6"/><path d="M25 36.5 q4.5 -.5 7 3" stroke="#f5f5f2" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M34.5 13 q-3 -8 3 -11 q-1.5 4.5 1.5 8 q.5 -5.5 5 -7.5 q-2.5 4.5 -1.5 9 z" fill="#f2cf4a"/></g>
            <circle cx="39" cy="19" r="9" fill="#d3d5da"/>
            <ellipse cx="41.5" cy="20" rx="6.5" ry="6.8" fill="#f6d65a"/>
            <circle cx="43" cy="23" r="2.6" fill="#f2994a"/>
            ${olhos(39.5, 44.5, 17.5, 2, 1.4)}
            ${olhosFechados(39.5, 44.5, 18)}
            <path d="M46.5 18.3 q4.2 .4 4.2 3.6 q-2.1 -1 -4.2 -.6 z" fill="#b9a68a"/>
            <path class="m-boca" d="M46.6 21.4 q2.1 .3 3.3 1.1 q-2 .7 -3.3 -.2 z" fill="#a8957a"/>
            <g class="m-boca-aberta"><path d="M46.8 21.2 l3.6 1 l-3.6 1.4 z" fill="#5a2330"/><path d="M46.6 22.2 q2.3 1.4 3.4 2.4 q-2.4 .3 -3.4 -1.4 z" fill="#a8957a"/></g>
            <path class="m-lingua" d="M47.2 22.3 q1.2 .5 2 .4 q-1 .6 -2 .1 z" fill="#ef8fa0"/>
          </g>
        </g>`
    },
    furao: {
      nome: "Furão",
      ronrom: "*dancinha*",
      oi: "Dook dook!",
      frases: ["Escondi seu Ctrl+Z… mentira!"],
      velocidade: 1.4,
      especial: { classe: "esp-furao", ms: 1500 },
      svg: `<g class="m-cauda"><ellipse cx="5.5" cy="36" rx="6" ry="3" transform="rotate(-25 5.5 36)" fill="#a07b57"/></g>
        ${pata(1, 12, 44, 5, 9, "#5a3d2b", 2.4)}${pata(2, 19, 44, 5, 9, "#7d5940", 2.4)}${pata(3, 38, 44, 5, 9, "#5a3d2b", 2.4)}${pata(4, 45, 44, 5, 9, "#7d5940", 2.4)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="29" cy="39" rx="21" ry="7.5" fill="#ecd9b8"/>
          <path d="M11 36 q18 -9 38 -2 q-19 -3 -38 2 z" fill="#d9bf95"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="46.5" cy="24" r="2.9" fill="#d9bf95"/><circle cx="46.5" cy="24" r="1.5" fill="#f2b8c2"/></g>
            <g class="m-orelha"><circle cx="54" cy="23" r="2.9" fill="#d9bf95"/><circle cx="54" cy="23" r="1.5" fill="#f2b8c2"/></g>
            <ellipse cx="52" cy="31" rx="9" ry="8" fill="#ecd9b8"/>
            <ellipse cx="58.5" cy="33.5" rx="4.2" ry="3.1" fill="#f6ead5"/>
            <path d="M44.8 29.5 q7.2 -4.6 13.6 0 q-.8 3.2 -3.4 3.2 q-3.4 -2 -6.8 0 q-2.6 0 -3.4 -3.2 z" fill="#6b4a35"/>
            ${bochechas(48.2, 57.5, 34.5, 1.4)}
            ${olhos(48.7, 54.7, 29.6, 2, 1.4)}
            ${olhosFechados(48.7, 54.7, 30.1, "#f6ead5")}
            <ellipse cx="61.6" cy="32.6" rx="1.2" ry=".95" fill="#d77d8c"/>
            ${boca(59.6, 35.4, "#8a6a4e")}
            ${bocaAberta(59.6, 36.6, 1.6, 1.7)}
          </g>
        </g>`
    },
    lontras: {
      nome: "Lontras",
      ronrom: "*de mãos dadas*",
      oi: "Somos duas! 🦦🦦",
      frases: ["Juntas a gente preenche mais rápido."],
      andar: "bipede",
      escala: 1.05,
      especial: { classe: "esp-lontras", ms: 2000 },
      /* Duas lontras: a de trás (.m-cabeca-2) e a da frente (.m-cabeca, mais escura); 1+2 = pés esquerdos, 3+4 = direitos */
      svg: `<g class="m-cauda"><path d="M15 45 q-9 2 -11.5 -4 q5.5 1.6 11.5 0 z" fill="#8a5a3a"/></g>
        <g class="m-cauda"><path d="M34.5 46 q-6 2.5 -9 -1.5 q4.5 .8 9 -.5 z" fill="#6a4228"/></g>
        ${pata(1, 15.5, 45, 4, 8, "#7d5236", 2)}${pata(3, 20.5, 45, 4, 8, "#7d5236", 2)}${pata(2, 35, 45, 4.2, 8, "#5e3b22", 2)}${pata(4, 40.5, 45, 4.2, 8, "#5e3b22", 2)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="20" cy="37.5" rx="7.2" ry="10.5" fill="#9a6744"/>
          <ellipse cx="21" cy="40" rx="4.2" ry="6.5" fill="#d9b48f"/>
          <ellipse class="m-corpo" cx="39.5" cy="37.5" rx="7.6" ry="11" fill="#7a4d30"/>
          <ellipse cx="40.5" cy="40" rx="4.4" ry="6.8" fill="#c9a07a"/>
          <path d="M25.5 34.5 q4.8 4.5 9.6 0" fill="none" stroke="#8a5a3a" stroke-width="2.6" stroke-linecap="round"/>
          <circle cx="30.3" cy="37.6" r="1.9" fill="#6f4529"/>
          <g class="m-cabeca-2">
            <g class="m-orelha"><circle cx="16.3" cy="17.5" r="2" fill="#7d5236"/></g>
            <g class="m-orelha"><circle cx="25" cy="17" r="2" fill="#7d5236"/></g>
            <circle cx="21" cy="22.5" r="6.7" fill="#a06c48"/>
            <ellipse cx="23.2" cy="25.5" rx="3.6" ry="2.7" fill="#e8cfae"/>
            <circle cx="17.6" cy="25.4" r="1.3" fill="#e58fa5" opacity=".45"/>
            ${olhos(19.3, 24, 21.3, 1.6, 1.15)}
            ${olhosFechadosP(19.3, 24, 21.8)}
            <circle cx="25.6" cy="24.3" r=".8" fill="#2a1d14"/>
            <path class="m-boca" d="M22.4 27 q.8 .9 1.6 0 q.8 .9 1.6 0" fill="none" stroke="#5b3a1e" stroke-width=".8" stroke-linecap="round"/>
            <ellipse class="m-boca-aberta" cx="24" cy="27.8" rx="1.3" ry="1.5" fill="#5a2330"/>
            <path class="m-lingua" d="M23.3 27.3 q.7 2.8 1.4 0 z" fill="#ef8fa0"/>
          </g>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="35.5" cy="16.5" r="2.1" fill="#63401f"/></g>
            <g class="m-orelha"><circle cx="44.8" cy="16" r="2.1" fill="#63401f"/></g>
            <circle cx="40.5" cy="22" r="7" fill="#82543a"/>
            <ellipse cx="42.9" cy="25.1" rx="3.8" ry="2.8" fill="#e8cfae"/>
            <circle cx="36.9" cy="25" r="1.3" fill="#e58fa5" opacity=".45"/>
            ${olhos(38.7, 43.6, 20.8, 1.65, 1.2)}
            ${olhosFechadosP(38.7, 43.6, 21.3)}
            <circle cx="45.4" cy="23.9" r=".85" fill="#2a1d14"/>
            <path class="m-boca" d="M42.1 26.7 q.8 .9 1.6 0 q.8 .9 1.6 0" fill="none" stroke="#5b3a1e" stroke-width=".8" stroke-linecap="round"/>
            <ellipse class="m-boca-aberta" cx="43.7" cy="27.5" rx="1.3" ry="1.5" fill="#5a2330"/>
            <path class="m-lingua" d="M43 27 q.7 2.8 1.4 0 z" fill="#ef8fa0"/>
          </g>
        </g>`
    },
    coelho: {
      nome: "Coelho",
      ronrom: "*mexe o nariz*",
      oi: "Oi! Cheguei pulando!",
      frases: ["Tem cenoura no próximo chamado?"],
      velocidade: 1.15,
      especial: { classe: "esp-coelho", ms: 1600 },
      svg: `<g class="m-cauda"><circle cx="12" cy="34.5" r="3.8" fill="#fbf8f4"/></g>
        ${pata(1, 15, 42, 8.5, 11, "#cfc6bd", 3.6)}${pata(2, 23, 42, 8.5, 11, "#e3dcd3", 3.6)}${pata(3, 38, 43, 5.5, 10, "#cfc6bd", 2.6)}${pata(4, 45, 43, 5.5, 10, "#e3dcd3", 2.6)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="30" cy="37" rx="18" ry="11" fill="#ece6df"/>
          <ellipse cx="34" cy="41.5" rx="9" ry="4.5" fill="#fbf8f4"/>
          <g class="m-cabeca">
            <g class="m-orelha"><ellipse cx="43" cy="7.5" rx="3.2" ry="9" transform="rotate(-14 43 7.5)" fill="#ece6df"/><ellipse cx="43" cy="8" rx="1.5" ry="6.4" transform="rotate(-14 43 8)" fill="#f2b8c2"/></g>
            <g class="m-orelha"><ellipse cx="51.5" cy="6.5" rx="3.2" ry="9" transform="rotate(12 51.5 6.5)" fill="#ece6df"/><ellipse cx="51.5" cy="7" rx="1.5" ry="6.4" transform="rotate(12 51.5 7)" fill="#f2b8c2"/></g>
            <circle cx="48" cy="22" r="10.5" fill="#f3eee8"/>
            ${bochechas(42.5, 55.5, 26, 1.6)}
            ${olhos(44.5, 52, 20, 2.3, 1.6)}
            ${olhosFechados(44.5, 52, 20.5)}
            <path d="M55 23.4 h2.6 l-1.3 1.4 z" fill="#e58fa5"/>
            ${boca(56.2, 26.4, "#8a6a6a")}
            <rect x="55.4" y="27" width="1.6" height="1.6" rx=".3" fill="#fff" stroke="#d9d2c9" stroke-width=".3"/>
            ${bocaAberta(56.2, 27.8, 1.6, 1.8)}
          </g>
        </g>`
    },
    raposa: {
      nome: "Raposa",
      ronrom: "*cauda fofinha*",
      oi: "Oi! Vim de mansinho.",
      frases: ["Faro aguçado pra achar erro de digitação."],
      velocidade: 1.1,
      especial: { classe: "esp-raposa", ms: 1600 },
      boca: [61, 26],
      svg: `<g class="m-cauda"><ellipse cx="10.5" cy="31" rx="9.5" ry="5.2" transform="rotate(40 10.5 31)" fill="#e8823a"/><ellipse cx="4.6" cy="26" rx="3.6" ry="3" transform="rotate(40 4.6 26)" fill="#fbf3e6"/></g>
        ${pata(1, 18, 41, 5.5, 12, "#3b2a22")}${pata(2, 26, 41, 5.5, 12, "#523a2e")}${pata(3, 37, 41, 5.5, 12, "#3b2a22")}${pata(4, 45, 41, 5.5, 12, "#523a2e")}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="36" rx="18" ry="10" fill="#e8823a"/>
          <ellipse cx="42" cy="39" rx="6" ry="5.5" fill="#fbf3e6"/>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M40 15 L41.5 3 L48 11 Z" fill="#e8823a"/><path d="M41.8 12 L42.4 6.5 L45.6 10 Z" fill="#3b2a22"/></g>
            <g class="m-orelha"><path d="M50 10.5 L57 2.5 L58.5 14 Z" fill="#e8823a"/><path d="M52.4 10 L56 6 L56.8 11.8 Z" fill="#3b2a22"/></g>
            <circle cx="48.5" cy="20.5" r="10.5" fill="#e8823a"/>
            <ellipse cx="45" cy="26" rx="6.5" ry="3.6" fill="#fbf3e6"/>
            <path d="M50 19.5 q8 1 13.5 5.5 q-6 4 -14 3 z" fill="#fbf3e6"/>
            ${olhos(44, 51.5, 18.5, 2.2, 1.6)}
            ${olhosFechados(44, 51.5, 19)}
            <circle cx="62.6" cy="24.8" r="1.4" fill="#2a1d14"/>
            ${boca(57.6, 27.6, "#8a5a2e")}
            ${bocaAberta(57.6, 28.6, 1.8, 1.9)}
          </g>
        </g>`
    },
    coruja: {
      nome: "Coruja",
      ronrom: "*uhu baixinho*",
      oi: "Uhu! Boa noite… digo, bom dia!",
      frases: ["De olho em tudo (literalmente)."],
      andar: "bipede",
      velocidade: 0.85,
      especial: { classe: "esp-coruja", ms: 1900, efeito: "estrelas" },
      boca: [36, 22],
      svg: `<g class="m-cauda"><path d="M22 44 l-7 4 l8 1 z" fill="#6b4f39"/></g>
        ${pe(1, 24, "#d9952f")}${pe(2, 24, "#f2b84a")}${pe(3, 32, "#d9952f")}${pe(4, 32, "#f2b84a")}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="35" rx="12.5" ry="14" fill="#8a6a4e"/>
          <ellipse cx="33" cy="39" rx="8" ry="9.5" fill="#e8d6bc"/>
          <path d="M29 36 l1.5 1.2 l1.5 -1.2 M33 36 l1.5 1.2 l1.5 -1.2 M31 41 l1.5 1.2 l1.5 -1.2 M35 41 l1.5 1.2 l1.5 -1.2" stroke="#b39675" stroke-width=".9" fill="none" stroke-linecap="round"/>
          <g class="m-asa"><path d="M20 30 q-4 9 2 17 q6 -3 6 -11 q-3 -6 -8 -6 z" fill="#6b4f39"/></g>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M26 10.5 l-2 -8 l6.5 4.5 z" fill="#6b4f39"/></g>
            <g class="m-orelha"><path d="M44 10.5 l2 -8 l-6.5 4.5 z" fill="#6b4f39"/></g>
            <circle cx="35" cy="17" r="11" fill="#8a6a4e"/>
            <circle cx="30.5" cy="17" r="5.6" fill="#f3e7d3"/><circle cx="39.5" cy="17" r="5.6" fill="#f3e7d3"/>
            ${olhos(30.5, 39.5, 17, 3.4, 2.3)}
            ${olhosFechados(30.5, 39.5, 17.5)}
            <path d="M33.6 19.6 h2.8 l-1.4 3.4 z" fill="#e0a33c"/>
            <path class="m-boca" d="M34.2 24.2 q.8 .7 1.6 0" fill="none" stroke="#6b4f39" stroke-width=".8" stroke-linecap="round"/>
            ${bocaAberta(35, 24.4, 1.3, 1.4)}
          </g>
        </g>`
    },
    axolote: {
      nome: "Axolote",
      ronrom: "*sorrisão*",
      oi: "Oiê! 😊",
      frases: ["Sorrir sempre, até com planilha cheia."],
      velocidade: 0.8,
      especial: { classe: "esp-axolote", ms: 1600, efeito: "bolhas" },
      boca: [56, 33],
      svg: `<g class="m-cauda"><path d="M14 38 q-10 -2 -12.5 -9 q8 .5 13.5 5 z" fill="#f08fb0"/></g>
        ${pata(1, 18, 44, 4.5, 9, "#e98aa8", 2)}${pata(2, 24, 44, 4.5, 9, "#f4a6c0", 2)}${pata(3, 36, 44, 4.5, 9, "#e98aa8", 2)}${pata(4, 42, 44, 4.5, 9, "#f4a6c0", 2)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="30" cy="40" rx="18" ry="8" fill="#f4a6c0"/>
          <ellipse cx="32" cy="44" rx="11" ry="3.4" fill="#fbd3e0"/>
          <path d="M14 34.5 q13 -8 25 -2.5" stroke="#f7c3d4" stroke-width="2.4" fill="none" stroke-linecap="round"/>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M39 24 q-6 -6 -4 -10 M39.5 27 q-7 -2 -8 -6.5 M39 30 q-7 1 -9 -2" stroke="#e05f8c" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
            <g class="m-orelha"><path d="M45 21 q-1 -7 2 -9 M50 20.5 q1 -7 4 -8" stroke="#e05f8c" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
            <ellipse cx="49" cy="30" rx="12" ry="9.5" fill="#f6b2c9"/>
            ${bochechas(44, 57, 33, 1.6)}
            ${olhos(46, 53.5, 27.5, 1.9, 1.5, "#2a1d14")}
            ${olhosFechados(46, 53.5, 28)}
            <path class="m-boca" d="M46 33 q4.5 3 9 0" fill="none" stroke="#b5476f" stroke-width="1" stroke-linecap="round"/>
            ${bocaAberta(50.5, 34, 2, 1.8)}
          </g>
        </g>`
    },
    tartaruga: {
      nome: "Tartaruga",
      ronrom: "*devagar e sempre*",
      oi: "Ooooi… cheguei.",
      frases: ["Sem pressa: o importante é salvar."],
      velocidade: 0.55,
      sono: 1.3,
      especial: { classe: "esp-tartaruga", ms: 2200, depois: "sentado" },
      boca: [62, 34],
      svg: `<g class="m-cauda"><path d="M13 44 l-6 1.5 l6 2 z" fill="#8cc06a"/></g>
        ${pata(1, 15, 43, 6.5, 10, "#7cb35a", 3)}${pata(2, 22, 43, 6.5, 10, "#8cc06a", 3)}${pata(3, 38, 43, 6.5, 10, "#7cb35a", 3)}${pata(4, 45, 43, 6.5, 10, "#8cc06a", 3)}
        <g class="m-corpo-g">
          <g class="m-cabeca">
            <g class="m-orelha"></g>
            <ellipse cx="51" cy="37" rx="6" ry="3.8" fill="#8cc06a"/>
            <circle cx="57" cy="32" r="6.5" fill="#8cc06a"/>
            ${bochechas(54.5, 62.4, 34.6, 1.2)}
            ${olhos(55.6, 60.2, 30.5, 1.8, 1.3)}
            ${olhosFechados(55.6, 60.2, 31)}
            ${boca(60.5, 34.6, "#3f6b2f")}
            ${bocaAberta(60.8, 35.4, 1.4, 1.5)}
          </g>
          <path class="m-corpo" d="M12 44 q2 -22 21 -22 q19 0 21 22 z" fill="#5c8f45"/>
          <path d="M24 31 l4.5 -4 l6 0 l4.5 4 l-2 6.5 l-11 0 z M16.5 41.5 l3 -6 l5 0 l1 6 z M40.5 41.5 l-1 -6 l5 0 l3 6 z" fill="#79ab58"/>
          <rect x="10" y="42" width="46" height="4" rx="2" fill="#4a7838"/>
        </g>`
    },
    guaxinim: {
      nome: "Guaxinim",
      ronrom: "*lava as patinhas*",
      oi: "Psiu! Achei um biscoito.",
      frases: ["Revirei a lixeira… e achei seu arquivo!"],
      escuro: true,
      especial: { classe: "esp-guaxinim", ms: 1800, efeito: "bolhas", depois: "sentado" },
      boca: [52, 34],
      svg: `<g class="m-cauda"><path d="M14 36 C5 34 3 25 7 19" fill="none" stroke="#8e9099" stroke-width="6" stroke-linecap="round"/><path d="M4.4 31.5 l5.4 -2 M3.6 25.8 l5.4 -.4 M5 21 l4.6 1.4" stroke="#2f3138" stroke-width="2.2" stroke-linecap="round"/></g>
        ${pata(1, 17, 40, 6, 13, "#2f3138")}${pata(2, 25, 40, 6, 13, "#45474f")}${pata(3, 37, 40, 6, 13, "#2f3138")}${pata(4, 45, 40, 6, 13, "#45474f")}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="37" rx="19" ry="10.5" fill="#8e9099"/>
          <ellipse cx="33" cy="41" rx="10" ry="4.5" fill="#c9cbd1"/>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M40 14 L41 4 L48 10 Z" fill="#8e9099"/><path d="M41.8 11.5 L42.3 6.8 L45.6 9.8 Z" fill="#2f3138"/></g>
            <g class="m-orelha"><path d="M50.5 9.5 L57.5 3.5 L59 13.5 Z" fill="#8e9099"/><path d="M52.8 9.4 L56.4 6.6 L57 11 Z" fill="#2f3138"/></g>
            <circle cx="49" cy="21" r="11.5" fill="#a3a5ad"/>
            <ellipse cx="50" cy="24.5" rx="9.5" ry="7" fill="#eceef2"/>
            <path d="M39.5 19.5 q5 -5 10 -.5 q5 -4.5 10 .5 q-1 5 -5 5 q-2.6 -2 -5 0 q-2.4 -2 -5 0 q-4 0 -5 -5 z" fill="#2f3138"/>
            ${olhos(44.5, 54, 19.8, 2.1, 1.5)}
            ${olhosFechados(44.5, 54, 20.3, "#eceef2")}
            <ellipse cx="50" cy="26" rx="2" ry="1.4" fill="#2f3138"/>
            ${boca(50, 28.6, "#2f3138")}
            ${bocaAberta(50, 29.8, 1.8, 2)}
          </g>
        </g>`
    },
    lhama: {
      nome: "Lhama",
      ronrom: "*lã quentinha*",
      oi: "Como lhama vai? 🦙",
      frases: ["Sem drama, só lhama."],
      escala: 1.05,
      velocidade: 0.9,
      especial: { classe: "esp-lhama", ms: 1600, efeito: "estrelas" },
      boca: [56, 16],
      svg: `<g class="m-cauda"><path d="M13 31 q-5 1 -4 6 q3 -1 5 -3 z" fill="#e3d2b0"/></g>
        ${pata(1, 17, 40, 5, 13, "#d9c7a3", 2.4)}${pata(2, 24, 40, 5, 13, "#e8d9bb", 2.4)}${pata(3, 36, 40, 5, 13, "#d9c7a3", 2.4)}${pata(4, 43, 40, 5, 13, "#e8d9bb", 2.4)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="30" cy="36" rx="18" ry="9.5" fill="#efe2c8"/>
          <path d="M14 33 q3 -4 6 -1 q3 -4 6 -1 q3 -4 6 -1 q3 -4 6 -1" fill="none" stroke="#e3d2b0" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M22 28.5 h14 v6 h-14 z" fill="#9b7fd4"/><path d="M22 31.5 h14" stroke="#f2c94c" stroke-width="1.2"/>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M42.5 7 q-2 -6 1 -8 q1.6 3 1.2 7 z" fill="#e3d2b0"/></g>
            <g class="m-orelha"><path d="M47 6 q0 -6.5 3.4 -7.5 q.6 3.6 -1 7.6 z" fill="#e3d2b0"/></g>
            <rect x="40" y="12" width="8" height="24" rx="4" fill="#efe2c8"/>
            <ellipse cx="48" cy="12" rx="8" ry="6.5" fill="#efe2c8"/>
            <ellipse cx="54" cy="14.2" rx="4.6" ry="3.8" fill="#f7efdd"/>
            ${bochechas(44.5, 52.2, 15, 1.3)}
            ${olhos(45.5, 50.5, 11, 1.8, 1.3)}
            ${olhosFechados(45.5, 50.5, 11.5)}
            <path d="M56.4 12.6 q.8 .8 1.6 0" fill="none" stroke="#7a6a50" stroke-width=".9" stroke-linecap="round"/>
            ${boca(55.4, 16.2, "#7a6a50")}
            ${bocaAberta(55.4, 17, 1.4, 1.5)}
          </g>
        </g>`
    },
    peixe: {
      nome: "Peixinho",
      ronrom: "*blub blub*",
      oi: "Blub! Água fresquinha?",
      frases: ["Memória de peixe? Por isso eu salvo tudo!"],
      ginga: true,
      velocidade: 0.9,
      especial: { classe: "esp-peixe", ms: 1800, efeito: "bolhas" },
      boca: [52, 35],
      svg: `<g class="m-cauda"><path d="M16 33 l-11 -8 q2.5 8 0 16 z" fill="#f28b3c"/></g>
        ${pata(1, 24, 42, 4, 6, "#f2a65a", 2)}${pata(2, 28, 42, 4, 6, "#f7b96e", 2)}${pata(3, 36, 42, 4, 6, "#f2a65a", 2)}${pata(4, 40, 42, 4, 6, "#f7b96e", 2)}
        <g class="m-corpo-g">
          <g class="m-asa"><path d="M27 23 q6 -10 14 -2 z" fill="#f28b3c"/></g>
          <ellipse class="m-corpo" cx="33" cy="33" rx="18" ry="12" fill="#f7a440"/>
          <path d="M26 22.5 q-3 10.5 0 21 M33 21.5 q-3 11.5 0 23" stroke="#fff" stroke-width="2.4" fill="none" opacity=".85"/>
          <g class="m-cabeca">
            <g class="m-orelha"></g>
            ${bochechas(41.5, 48.5, 36, 1.5)}
            ${olhos(42.5, 47.5, 30, 2.6, 1.8)}
            ${olhosFechados(42.5, 47.5, 30.5)}
            <path class="m-boca" d="M48.6 35 q1.4 1.3 2.8 0" fill="none" stroke="#b5561e" stroke-width="1" stroke-linecap="round"/>
            ${bocaAberta(50.2, 35.6, 1.4, 1.6)}
          </g>
        </g>`
    },
    abelha: {
      nome: "Abelha",
      ronrom: "*bzzz feliz*",
      oi: "Bzz! Oi, flor!",
      frases: ["Trabalhando feito… uma abelha!"],
      andar: "bipede",
      ginga: true,
      escala: 0.85,
      velocidade: 1.25,
      especial: { classe: "esp-abelha", ms: 1800, efeito: "zumbido" },
      boca: [50, 31],
      svg: `<g class="m-cauda"><path d="M15.5 37 l-5.5 1.6 l5.5 1.8 z" fill="#3a3326"/></g>
        ${pe(1, 25, "#3a3326")}${pe(2, 25, "#4a4232")}${pe(3, 32, "#3a3326")}${pe(4, 32, "#4a4232")}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="30" cy="37" rx="14.5" ry="11" fill="#f7c948"/>
          <path d="M24 27.3 q-3 9.7 0 19.4 M31 26.4 q-3 10.6 0 21.2" stroke="#3a3326" stroke-width="3" fill="none"/>
          <g class="m-asa"><ellipse cx="27" cy="22" rx="5" ry="8" transform="rotate(-25 27 22)" fill="#dff1fb" opacity=".85" stroke="#a9d4ea" stroke-width=".8"/><ellipse cx="33" cy="21" rx="4" ry="7" transform="rotate(15 33 21)" fill="#dff1fb" opacity=".85" stroke="#a9d4ea" stroke-width=".8"/></g>
          <g class="m-cabeca">
            <g class="m-orelha"><path d="M42 19.5 q-2 -7 -5 -8" stroke="#3a3326" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="37" cy="11.5" r="1.6" fill="#3a3326"/></g>
            <g class="m-orelha"><path d="M47.5 18.5 q1 -7 4.5 -8.5" stroke="#3a3326" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="52" cy="10" r="1.6" fill="#3a3326"/></g>
            <circle cx="45" cy="27" r="9" fill="#f9d561"/>
            ${bochechas(40.5, 51.5, 30.5, 1.5)}
            ${olhos(42.5, 49, 26, 2.3, 1.6)}
            ${olhosFechados(42.5, 49, 26.5)}
            ${boca(47.5, 31, "#7a5a20")}
            ${bocaAberta(47.5, 32.2, 1.5, 1.7)}
          </g>
        </g>`
    },
    gamba: {
      nome: "Gambá",
      ronrom: "*rabinho enrolado*",
      oi: "Oi! Não tô fedendo, juro.",
      frases: ["Se o sistema cair, eu finjo de morto."],
      velocidade: 0.9,
      especial: { classe: "esp-gamba", ms: 2400, depois: "sentado" },
      boca: [61, 26],
      svg: `<g class="m-cauda"><path d="M14 38 C6 40 2 34 4 28 C5 25 8 25 8 28" fill="none" stroke="#e8a3b0" stroke-width="2.6" stroke-linecap="round"/></g>
        ${pata(1, 17, 41, 5.5, 12, "#3b3d48")}${pata(2, 25, 41, 5.5, 12, "#555866")}${pata(3, 37, 41, 5.5, 12, "#3b3d48")}${pata(4, 45, 41, 5.5, 12, "#555866")}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="37" rx="19" ry="10.5" fill="#a9acb5"/>
          <path d="M14 34 q16 -10 34 -3 q-17 -4 -34 3 z" fill="#8a8d97"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="42" cy="13" r="3.8" fill="#2f3138"/><circle cx="42" cy="13" r="1.8" fill="#e8a3b0"/></g>
            <g class="m-orelha"><circle cx="51" cy="11.5" r="3.8" fill="#2f3138"/><circle cx="51" cy="11.5" r="1.8" fill="#e8a3b0"/></g>
            <circle cx="47" cy="21" r="10" fill="#eef0f3"/>
            <path d="M50 17 q10 3 13 8 q-5 4 -13 2 z" fill="#eef0f3"/>
            <path d="M46.5 11.5 q1.4 5 -.6 9" stroke="#c9ccd3" stroke-width="2" fill="none" stroke-linecap="round"/>
            ${bochechas(42.5, 53.5, 25, 1.5)}
            ${olhos(43.5, 50.5, 19, 2.1, 1.6)}
            ${olhosFechados(43.5, 50.5, 19.5)}
            <circle cx="62.6" cy="24.8" r="1.4" fill="#e8869a"/>
            ${boca(57.5, 27.2, "#8a8d97")}
            ${bocaAberta(57.5, 28.2, 1.6, 1.8)}
          </g>
        </g>`
    },
    sapo: {
      nome: "Sapo",
      ronrom: "*croac baixinho*",
      oi: "Croac! 🐸",
      frases: ["Pegando os bugs no ar!"],
      velocidade: 0.9,
      especial: { classe: "esp-sapo", ms: 1500 },
      boca: [57, 31],
      svg: `<g class="m-cauda"></g>
        ${pata(1, 13, 42, 9, 11, "#4f9a3e", 4)}${pata(2, 21, 44, 7, 9, "#62b14f", 3.4)}${pata(3, 38, 43, 5, 10, "#4f9a3e", 2.4)}${pata(4, 44, 43, 5, 10, "#62b14f", 2.4)}
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="31" cy="39" rx="19" ry="10.5" fill="#6cbf55"/>
          <ellipse cx="36" cy="43" rx="11" ry="5" fill="#dff0c4"/>
          <circle cx="22" cy="35" r="2" fill="#57a644"/><circle cx="28" cy="31.5" r="1.5" fill="#57a644"/>
          <g class="m-cabeca">
            <g class="m-orelha"><circle cx="42" cy="20" r="5" fill="#6cbf55"/></g>
            <g class="m-orelha"><circle cx="52.5" cy="19.5" r="5" fill="#6cbf55"/></g>
            <ellipse cx="47" cy="28" rx="13" ry="8.5" fill="#6cbf55"/>
            ${bochechas(40.5, 56, 30.5, 1.8)}
            ${olhos(42, 52.5, 19.5, 3.2, 2)}
            ${olhosFechados(42, 52.5, 20)}
            <path class="m-linguao" d="M54 32 h11" stroke="#ef8fa0" stroke-width="2" stroke-linecap="round"/>
            <path class="m-boca" d="M43 31 q8 4 16 -1" fill="none" stroke="#2f6b25" stroke-width="1" stroke-linecap="round"/>
            ${bocaAberta(53, 32.4, 2.6, 2)}
          </g>
        </g>`
    },
    polvo: {
      nome: "Polvo",
      ronrom: "*abraço de oito braços*",
      oi: "Oi! Tenho braço pra tudo.",
      frases: ["Oito braços, zero chamados atrasados."],
      ginga: true,
      velocidade: 0.85,
      especial: { classe: "esp-polvo", ms: 1700, efeito: "bolhas" },
      boca: [41, 36],
      svg: `<g class="m-cauda"><path d="M19 40 q-8 4 -6 11 q1 2 3 0" fill="none" stroke="#a65ba8" stroke-width="4" stroke-linecap="round"/></g>
        <g class="m-pata m-pata-1"><path d="M22 42 q-2.5 6 .5 11" stroke="#b768b8" stroke-width="4.2" fill="none" stroke-linecap="round"/></g>
        <g class="m-pata m-pata-2"><path d="M28 43 q-1.5 5.5 1 10" stroke="#c97fca" stroke-width="4.2" fill="none" stroke-linecap="round"/></g>
        <g class="m-pata m-pata-3"><path d="M35 43 q1.5 5.5 -1 10" stroke="#b768b8" stroke-width="4.2" fill="none" stroke-linecap="round"/></g>
        <g class="m-pata m-pata-4"><path d="M41 42 q2.5 6 -.5 11" stroke="#c97fca" stroke-width="4.2" fill="none" stroke-linecap="round"/></g>
        <g class="m-corpo-g">
          <ellipse class="m-corpo" cx="33" cy="30" rx="15" ry="14" fill="#c97fca"/>
          <ellipse cx="32" cy="41" rx="13" ry="4" fill="#b768b8"/>
          <circle cx="26" cy="21.5" r="2" fill="#dba0dc"/><circle cx="33.5" cy="19.5" r="1.4" fill="#dba0dc"/><circle cx="22.5" cy="28" r="1.2" fill="#dba0dc"/>
          <g class="m-cabeca">
            <g class="m-orelha"></g>
            ${bochechas(33, 46, 34, 1.7)}
            ${olhos(36, 43, 29.5, 2.5, 1.8)}
            ${olhosFechados(36, 43, 30)}
            <path class="m-boca" d="M38.6 35 q1.3 1.3 2.6 0" fill="none" stroke="#7d3a80" stroke-width="1" stroke-linecap="round"/>
            ${bocaAberta(39.9, 35.8, 1.4, 1.5)}
          </g>
        </g>`
    }
  };
  const PADROES = { escala: 1, andar: "quadrupede", ginga: false, velocidade: 1, sono: 1, frases: [], especial: null, escuro: false, boca: [58, 24] };
  Object.values(ANIMAIS).forEach((a) => { Object.entries(PADROES).forEach(([k, v]) => { if (a[k] === undefined) a[k] = v; }); });
  /* Ordem da janela (alfabética pelo nome) e do sorteio do dia */
  const IDS_ORDEM = Object.keys(ANIMAIS).sort((x, y) => ANIMAIS[x].nome.localeCompare(ANIMAIS[y].nome, "pt-BR"));
  const FRASES = ["Bora preencher?", "Salvou tudo? 😺", "Tab pula pro lado, sabia?", "Um clique já edita!", "Ctrl+Enter preenche a seleção."];

  /* ---------- Estilo (injetado: o arquivo é deste site) ---------- */
  const estilo = document.createElement("style");
  estilo.textContent = `
.mascote-camada { position: fixed; inset: 0; z-index: 90; pointer-events: none; overflow: hidden; }
.mascote { position: absolute; left: 0; top: 0; width: ${L}px; height: ${A}px; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; transition: opacity .3s ease; will-change: transform; }
.mascote.arrastando { cursor: grabbing; }
.mascote.escondido { opacity: 0; pointer-events: none; }
.mascote .m-pulo { width: 100%; height: 100%; transform-origin: 50% 85%; }
.mascote svg { display: block; width: 100%; height: 100%; overflow: visible; }
.mascote.esquerda svg { transform: scaleX(-1); }
.mascote .m-pata, .mascote .m-corpo, .mascote .m-cabeca, .mascote .m-orelha, .mascote .m-cauda, .mascote .m-corpo-g { transform-box: fill-box; }
.mascote .m-pata { transform-origin: 50% 0; transition: transform .25s ease; }
.mascote .m-cauda { transform-origin: 100% 100%; animation: m-cauda 2.6s ease-in-out infinite; }
.mascote .m-cabeca { transform-origin: 50% 100%; transition: transform .3s ease; }
.mascote .m-orelha { transform-origin: 50% 100%; transition: transform .2s ease; }
.mascote .m-corpo { transform-origin: 50% 100%; }
.mascote .m-corpo-g { transform-origin: 50% 100%; transition: transform .3s ease; }
.mascote .m-pupilas { transition: transform .12s linear; }
.mascote .m-olhos, .mascote .m-fechados, .mascote .m-boca, .mascote .m-boca-aberta, .mascote .m-lingua { transition: opacity .15s ease; }
.mascote .m-fechados, .mascote .m-boca-aberta, .mascote .m-lingua { opacity: 0; }
.mascote.andando .m-pata-1, .mascote.andando .m-pata-4 { animation: m-passo calc(.45s / var(--vel, 1)) ease-in-out infinite alternate; }
.mascote.andando .m-pata-2, .mascote.andando .m-pata-3 { animation: m-passo calc(.45s / var(--vel, 1)) ease-in-out infinite alternate-reverse; }
.mascote.andando .m-corpo-g { animation: m-balanco calc(.225s / var(--vel, 1)) ease-in-out infinite alternate; }
.mascote.sentado .m-corpo-g, .mascote.lambendo .m-corpo-g, .mascote.bocejando .m-corpo-g { transform: translateY(3px); }
.mascote.sentado .m-pata-1, .mascote.sentado .m-pata-2, .mascote.lambendo .m-pata-1, .mascote.lambendo .m-pata-2 { transform: scaleY(.55); }
.mascote.lambendo .m-pata-4 { transform: translate(1px, -9px) rotate(-35deg); }
.mascote.lambendo .m-lingua { opacity: 1; }
.mascote.lambendo .m-cabeca { transform: rotate(6deg); }
.mascote.olhando .m-cabeca { transform: rotate(-9deg); }
.mascote.bocejando .m-boca-aberta, .mascote.miando .m-boca-aberta { opacity: 1; }
.mascote.bocejando .m-boca, .mascote.miando .m-boca { opacity: 0; }
.mascote.bocejando .m-olhos, .mascote.dormindo .m-olhos, .mascote.piscando .m-olhos { opacity: 0; }
.mascote.bocejando .m-fechados, .mascote.dormindo .m-fechados, .mascote.piscando .m-fechados { opacity: 1; }
.mascote.dormindo .m-corpo-g { transform: translateY(6px); }
.mascote.dormindo .m-pata { transform: scaleY(.3); }
.mascote.dormindo .m-corpo { animation: m-respirar 3.2s ease-in-out infinite; }
.mascote.dormindo .m-cauda { animation: none; }
.mascote.carinho .m-orelha { transform: scaleY(1.18); }
.mascote.preocupado .m-orelha { transform: rotate(22deg) scaleY(.85); }
.mascote.preocupado .m-cabeca { transform: rotate(5deg); }
.mascote.pendurado .m-pata { transform: translateY(2px); }
.mascote.pendurado .m-pulo { animation: m-pendulo 1s ease-in-out infinite alternate; }
.mascote.pulando .m-pulo { animation: m-pular .6s ease-out; }
.mascote.girando .m-pulo { animation: m-girar .7s ease-in-out; }
.mascote.pousando .m-pulo { animation: m-pousar .35s ease-out; }
.mascote-balao { position: absolute; left: 50%; bottom: 100%; transform: translate(-50%, -2px); padding: 3px 9px; border-radius: 10px; white-space: nowrap; font: 600 12px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--superficie, #fff); color: var(--cor-acao, #1b1d26); border: 1px solid var(--borda-forte, #c9c9d4); box-shadow: 0 4px 14px rgba(0,0,0,.14); opacity: 0; transition: opacity .2s ease; pointer-events: none; }
.mascote-balao.visivel { opacity: 1; }
.mascote-zzz { position: absolute; right: 2px; top: -6px; font: 700 12px/1 system-ui, sans-serif; color: var(--texto-secundario, #6b6b78); opacity: 0; pointer-events: none; }
.mascote.dormindo .mascote-zzz { animation: m-zzz 2.4s ease-in-out infinite; }
.mascote.dormindo .mascote-zzz + .mascote-zzz { animation-delay: .8s; }
.mascote.dormindo .mascote-zzz + .mascote-zzz + .mascote-zzz { animation-delay: 1.6s; }
.mascote-efeito { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform, opacity; }
.mascote-confete { width: 6px; height: 9px; border-radius: 1px; animation: m-confete 1.1s ease-out forwards; }
.mascote-coracao { font-size: 16px; line-height: 1; animation: m-coracao 1.1s ease-out forwards; }
@keyframes m-passo { from { transform: rotate(16deg); } to { transform: rotate(-16deg); } }
@keyframes m-balanco { to { transform: translateY(-1.2px); } }
@keyframes m-cauda { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(-12deg); } }
@keyframes m-respirar { 50% { transform: scale(1.03, 1.07); } }
@keyframes m-pular { 0% { transform: none; } 30% { transform: translateY(-22px) scale(.97, 1.04); } 62% { transform: none; } 78% { transform: scale(1.08, .9); } 100% { transform: none; } }
@keyframes m-girar { to { transform: rotate(360deg); } }
@keyframes m-pousar { 0% { transform: scale(1.1, .86); } 100% { transform: none; } }
@keyframes m-pendulo { from { transform: rotate(-7deg); } to { transform: rotate(7deg); } }
@keyframes m-zzz { 0% { transform: translate(0, 0) scale(.7); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(10px, -22px) scale(1.1); opacity: 0; } }
@keyframes m-confete { from { transform: translate(0, 0) rotate(0); opacity: 1; } to { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0; } }
@keyframes m-coracao { from { transform: translate(0, 0) scale(.6); opacity: 1; } to { transform: translate(var(--dx, 0px), -36px) scale(1.2); opacity: 0; } }
/* Bichos novos: tamanho (scale não briga com as animações de transform do .m-pulo), bípedes, ginga e peças extras */
.mascote .m-pulo { scale: var(--m-escala, 1); }
.mascote .m-todo { transform-box: fill-box; transform-origin: 50% 100%; }
.mascote.bipede.andando .m-pata-1, .mascote.bipede.andando .m-pata-2 { animation: m-passo calc(.45s / var(--vel, 1)) ease-in-out infinite alternate; }
.mascote.bipede.andando .m-pata-3, .mascote.bipede.andando .m-pata-4 { animation: m-passo calc(.45s / var(--vel, 1)) ease-in-out infinite alternate-reverse; }
.mascote.bipede.sentado .m-pata, .mascote.bipede.lambendo .m-pata, .mascote.bipede.bocejando .m-pata { transform: scaleY(.6); }
.mascote.ginga.andando .m-corpo-g { animation: m-ginga calc(.45s / var(--vel, 1)) ease-in-out infinite alternate; }
.mascote.a-furao.andando .m-corpo-g { animation: m-saltito calc(.45s / var(--vel, 1)) ease-in-out infinite alternate; }
.mascote.a-trex.andando .m-corpo-g { animation: m-firme calc(.45s / var(--vel, 1)) ease-in-out infinite alternate; }
.mascote .m-cabeca-2 { transform-box: fill-box; transform-origin: 50% 100%; transition: transform .3s ease; }
.mascote.lambendo .m-cabeca-2 { transform: rotate(6deg); }
.mascote.olhando .m-cabeca-2 { transform: rotate(-9deg); }
.mascote.preocupado .m-cabeca-2 { transform: rotate(5deg); }
.mascote .m-asa { transform-box: fill-box; transform-origin: 75% 85%; transition: transform .2s ease; }
.mascote .m-braco { transform-box: fill-box; transform-origin: 0 0; }
.mascote .m-bochecha { transform-box: fill-box; transform-origin: 50% 50%; }
@keyframes m-ginga { from { transform: rotate(-6deg); } to { transform: rotate(6deg); } }
@keyframes m-saltito { from { transform: none; } to { transform: translateY(-2.6px); } }
@keyframes m-firme { from { transform: none; } to { transform: translateY(-1.4px) rotate(-1.5deg); } }
@keyframes m-bater-asa { from { transform: none; } to { transform: rotate(-38deg); } }
@keyframes m-pulinho { 0%, 30%, 100% { transform: none; } 55% { transform: translateY(-10px); } 75% { transform: scale(1.05, .95); } }
/* Especiais (clique duplo ou, de vez em quando, parado) */
.mascote.a-urso.esp-urso .m-todo { transform-origin: 25% 100%; animation: m-urso-de-pe 1.9s ease-in-out; }
.mascote.a-urso.esp-urso .m-pata-3, .mascote.a-urso.esp-urso .m-pata-4 { animation: m-urso-bracos 1.9s ease-in-out; }
.mascote.a-urso.esp-urso .m-boca-aberta, .mascote.a-urso.esp-urso .m-fechados { opacity: 1; }
.mascote.a-urso.esp-urso .m-boca, .mascote.a-urso.esp-urso .m-olhos { opacity: 0; }
@keyframes m-urso-de-pe { 0%, 100% { transform: none; } 25%, 75% { transform: rotate(-24deg); } }
@keyframes m-urso-bracos { 0%, 100% { transform: none; } 30% { transform: rotate(-120deg); } 50% { transform: rotate(-165deg); } 70% { transform: rotate(-120deg); } }
.mascote.a-pato.esp-pato .m-asa { animation: m-bater-asa .18s ease-in-out 7 alternate; }
.mascote.a-pato.esp-pato .m-todo { animation: m-pulinho 1.3s ease-in-out; }
.mascote.a-dragao.esp-dragao .m-asa { animation: m-bater-asa .2s ease-in-out 8 alternate; }
.mascote.a-dragao.esp-dragao .m-cabeca { transform: rotate(-6deg); }
.mascote.a-dragao.esp-dragao .m-boca-aberta { opacity: 1; }
.mascote.a-dragao.esp-dragao .m-boca { opacity: 0; }
.mascote.a-macaco.esp-macaco .m-todo { transform-origin: 50% 50%; animation: m-macaco-pendura 2s ease-in-out; }
@keyframes m-macaco-pendura { 0%, 100% { transform: none; } 20% { transform: translateY(-16px) rotate(180deg); } 40% { transform: translateY(-16px) rotate(168deg); } 60% { transform: translateY(-16px) rotate(192deg); } 80% { transform: translateY(-16px) rotate(180deg); } }
.mascote.a-trex.esp-trex .m-boca-aberta { opacity: 1; }
.mascote.a-trex.esp-trex .m-boca { opacity: 0; }
.mascote.a-trex.esp-trex .m-cabeca { transform: rotate(-8deg); }
.mascote.a-trex.esp-trex .m-braco { animation: m-bracinho .17s ease-in-out 8 alternate; }
@keyframes m-bracinho { from { transform: none; } to { transform: rotate(-38deg); } }
.mascote.a-hamster.esp-hamster .m-bochecha { animation: m-bochechas 1.5s ease-in-out; }
.mascote.a-hamster.esp-hamster .m-corpo-g { animation: m-saltito .12s ease-in-out 8 alternate; }
@keyframes m-bochechas { 0%, 100% { transform: none; } 30%, 70% { transform: scale(1.7); } }
.mascote.a-panda.esp-panda .m-todo { transform-origin: 50% 55%; animation: m-cambalhota 1.3s ease-in-out; }
@keyframes m-cambalhota { 0% { transform: none; } 50% { transform: translate(6px, -10px) rotate(180deg); } 100% { transform: rotate(360deg); } }
.mascote.a-coala.esp-coala .m-pata-3, .mascote.a-coala.esp-coala .m-pata-4 { transform: rotate(-80deg); }
.mascote.a-coala.esp-coala .m-cabeca { transform: rotate(8deg); }
.mascote.a-coala.esp-coala .m-olhos { opacity: 0; }
.mascote.a-coala.esp-coala .m-fechados { opacity: 1; }
.mascote.a-calopsita.esp-calopsita .m-orelha { transform: scaleY(1.45) rotate(-8deg); }
.mascote.a-calopsita.esp-calopsita .m-asa { animation: m-bater-asa .16s ease-in-out 8 alternate; animation-delay: .5s; }
.mascote.a-calopsita.esp-calopsita .m-todo { animation: m-voo 1.9s ease-in-out; }
@keyframes m-voo { 0%, 25% { transform: none; } 45%, 62% { transform: translateY(-20px); } 82% { transform: scale(1.05, .95); } 100% { transform: none; } }
.mascote.a-furao.esp-furao .m-todo { animation: m-danca-furao 1.5s ease-in-out; }
.mascote.a-furao.esp-furao .m-corpo-g { transform: translateY(-1.5px) scaleY(1.1); }
@keyframes m-danca-furao { 0%, 100% { transform: none; } 16% { transform: translate(-5px, -6px); } 33% { transform: none; } 50% { transform: translate(5px, -6px); } 66% { transform: none; } 83% { transform: translate(-5px, -6px); } }
.mascote.a-lontras.esp-lontras .m-todo { transform-origin: 50% 60%; animation: m-boiar 2s ease-in-out; }
@keyframes m-boiar { 0% { transform: none; } 22% { transform: translateY(4px) rotate(-90deg); } 75% { transform: translateY(4px) rotate(-450deg); } 100% { transform: none; } }
/* Peixinho e abelha: flutuam parados (desligado no modo Calmo); a abelha bate as asas sem parar */
.mascote.a-peixe .m-todo, .mascote.a-abelha .m-todo { animation: m-flutuar 2.4s ease-in-out infinite; }
.mascote.a-abelha .m-asa { animation: m-zumbir .12s linear infinite alternate; }
.mascote.a-sapo.andando .m-corpo-g, .mascote.a-coelho.andando .m-corpo-g { animation: m-saltito calc(.45s / var(--vel, 1)) ease-in-out infinite alternate; }
.mascote .m-linguao { opacity: 0; transform-box: fill-box; transform-origin: 0 50%; }
@keyframes m-flutuar { 50% { transform: translateY(-2.5px); } }
@keyframes m-zumbir { from { transform: none; } to { transform: rotate(-18deg) scaleY(.85); } }
/* Especiais dos bichos novos */
.mascote.a-coelho.esp-coelho .m-todo { animation: m-coelho-pulos 1.6s ease-in-out; }
.mascote.a-coelho.esp-coelho .m-orelha { animation: m-orelha-mola .2s ease-in-out 8 alternate; }
@keyframes m-coelho-pulos { 0%, 100% { transform: none; } 12% { transform: translateY(-13px); } 24% { transform: none; } 28% { transform: scale(1.06, .94); } 40% { transform: translateY(-13px); } 52% { transform: none; } 56% { transform: scale(1.06, .94); } 72% { transform: translateY(-19px) rotate(-8deg); } 88% { transform: scale(1.06, .94); } }
@keyframes m-orelha-mola { from { transform: none; } to { transform: rotate(-14deg) scaleY(.9); } }
.mascote.a-raposa.esp-raposa .m-todo { animation: m-raposa-bote 1.6s ease-in-out; }
.mascote.a-raposa.esp-raposa .m-cauda { animation: m-cauda .3s ease-in-out 5; }
@keyframes m-raposa-bote { 0%, 100% { transform: none; } 25% { transform: translate(-2px, 2px) scale(1.04, .9); } 50% { transform: translate(6px, -20px) rotate(25deg); } 70% { transform: translate(10px, -2px) rotate(70deg); } 86% { transform: translate(4px, 0) rotate(8deg); } }
.mascote.a-coruja.esp-coruja .m-cabeca { transform-origin: 50% 80%; animation: m-coruja-cabeca 1.9s ease-in-out; }
.mascote.a-coruja.esp-coruja .m-olhos { transform-box: fill-box; transform-origin: 50% 50%; transform: scale(1.2); }
.mascote.a-coruja.esp-coruja .m-asa { animation: m-bater-asa .18s ease-in-out 6 alternate; animation-delay: .9s; }
.mascote.a-coruja.esp-coruja .m-todo { animation: m-coruja-pulo 1.9s ease-in-out; }
@keyframes m-coruja-cabeca { 0%, 100% { transform: none; } 14% { transform: rotate(-38deg); } 32% { transform: rotate(38deg); } 50% { transform: rotate(-38deg); } 66% { transform: rotate(22deg); } 80% { transform: none; } }
@keyframes m-coruja-pulo { 0%, 50%, 100% { transform: none; } 68% { transform: translateY(-14px); } 86% { transform: scale(1.06, .94); } }
.mascote.a-axolote.esp-axolote .m-orelha { animation: m-branquias .16s ease-in-out 10 alternate; }
.mascote.a-axolote.esp-axolote .m-todo { animation: m-pulinho 1.6s ease-in-out; }
.mascote.a-axolote.esp-axolote .m-boca-aberta { opacity: 1; }
.mascote.a-axolote.esp-axolote .m-boca { opacity: 0; }
@keyframes m-branquias { from { transform: none; } to { transform: scale(1.18) rotate(-7deg); } }
.mascote.a-tartaruga.esp-tartaruga .m-cabeca { animation: m-casco-cabeca 2.2s ease-in-out; }
.mascote.a-tartaruga.esp-tartaruga .m-pata, .mascote.a-tartaruga.esp-tartaruga .m-cauda { animation: m-casco-pata 2.2s ease-in-out; }
.mascote.a-tartaruga.esp-tartaruga .m-todo { animation: m-casco-balanco 2.2s ease-in-out; }
@keyframes m-casco-cabeca { 0%, 100% { transform: none; } 18%, 72% { transform: translateX(-9px) scale(.25); } }
@keyframes m-casco-pata { 0%, 100% { transform: none; } 18%, 72% { transform: scaleY(.12); } }
@keyframes m-casco-balanco { 0%, 25%, 70%, 100% { transform: none; } 35% { transform: rotate(-6deg); } 47% { transform: rotate(6deg); } 58% { transform: rotate(-3deg); } }
.mascote.a-guaxinim.esp-guaxinim .m-corpo-g { transform: translateY(3px); }
.mascote.a-guaxinim.esp-guaxinim .m-cabeca { transform: rotate(10deg); }
.mascote.a-guaxinim.esp-guaxinim .m-pata-3 { animation: m-lavar-a .2s ease-in-out 9 alternate; }
.mascote.a-guaxinim.esp-guaxinim .m-pata-4 { animation: m-lavar-b .2s ease-in-out 9 alternate; }
.mascote.a-guaxinim.esp-guaxinim .m-pata-1, .mascote.a-guaxinim.esp-guaxinim .m-pata-2 { transform: scaleY(.55); }
@keyframes m-lavar-a { from { transform: rotate(-70deg); } to { transform: rotate(-95deg) translateY(-1px); } }
@keyframes m-lavar-b { from { transform: rotate(-95deg) translateY(-1px); } to { transform: rotate(-70deg); } }
.mascote.a-lhama.esp-lhama .m-corpo-g { animation: m-sacudir-la .1s ease-in-out 10 alternate; }
.mascote.a-lhama.esp-lhama .m-cabeca { animation: m-lhama-pescoco 1.6s ease-in-out; }
.mascote.a-lhama.esp-lhama .m-boca-aberta { opacity: 1; }
.mascote.a-lhama.esp-lhama .m-boca { opacity: 0; }
@keyframes m-sacudir-la { from { transform: rotate(-2.5deg); } to { transform: rotate(2.5deg); } }
@keyframes m-lhama-pescoco { 0%, 100% { transform: none; } 30% { transform: rotate(-14deg); } 62% { transform: rotate(12deg); } }
.mascote.a-peixe.esp-peixe .m-todo { transform-origin: 50% 60%; animation: m-nado 1.8s ease-in-out; }
.mascote.a-peixe.esp-peixe .m-cauda { animation: m-cauda .25s ease-in-out 7; }
.mascote.a-peixe.esp-peixe .m-boca-aberta { opacity: 1; }
.mascote.a-peixe.esp-peixe .m-boca { opacity: 0; }
@keyframes m-nado { 0%, 100% { transform: none; } 25% { transform: translate(-8px, -14px) rotate(-20deg); } 50% { transform: translate(0, -22px); } 75% { transform: translate(8px, -14px) rotate(20deg); } }
.mascote.a-abelha.esp-abelha .m-todo { animation: m-voo-oito 1.8s ease-in-out; }
.mascote.a-abelha.esp-abelha .m-asa { animation: m-zumbir .06s linear infinite alternate; }
@keyframes m-voo-oito { 0%, 100% { transform: none; } 20% { transform: translate(-10px, -12px) rotate(-8deg); } 40% { transform: translate(0, -20px); } 60% { transform: translate(10px, -12px) rotate(8deg); } 80% { transform: translate(0, -4px); } }
.mascote.a-gamba.esp-gamba .m-todo { transform-origin: 50% 50%; animation: m-fingir-morto 2.4s ease-in-out; }
.mascote.a-gamba.esp-gamba .m-olhos { opacity: 0; }
.mascote.a-gamba.esp-gamba .m-fechados, .mascote.a-gamba.esp-gamba .m-lingua { opacity: 1; }
@keyframes m-fingir-morto { 0%, 100% { transform: none; } 15%, 78% { transform: rotate(-180deg); } 84% { transform: rotate(-174deg); } 90% { transform: rotate(-186deg); } }
.mascote.a-sapo.esp-sapo .m-linguao { animation: m-linguada .55s ease-out .25s; }
.mascote.a-sapo.esp-sapo .m-todo { animation: m-sapo-pulo 1.5s ease-in-out; }
.mascote.a-sapo.esp-sapo .m-boca-aberta { animation: m-mostrar 1.5s linear; }
@keyframes m-linguada { 0% { transform: scaleX(0); opacity: 1; } 45% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(0); opacity: 1; } }
@keyframes m-sapo-pulo { 0%, 52%, 100% { transform: none; } 70% { transform: translateY(-17px); } 86% { transform: scale(1.08, .92); } }
.mascote.a-polvo.esp-polvo .m-pata { animation: m-tentaculo .22s ease-in-out 8 alternate; }
.mascote.a-polvo.esp-polvo .m-pata-2, .mascote.a-polvo.esp-polvo .m-pata-3 { animation-delay: .11s; }
.mascote.a-polvo.esp-polvo .m-cauda { animation: m-tentaculo .22s ease-in-out 8 alternate; }
.mascote.a-polvo.esp-polvo .m-todo { animation: m-pulinho 1.7s ease-in-out; }
@keyframes m-tentaculo { from { transform: rotate(-22deg); } to { transform: rotate(22deg); } }
/* Comportamentos espontâneos novos (decidir) e reações a clique, hover e arraste */
@keyframes m-mostrar { 0%, 22%, 86%, 100% { opacity: 0; } 30%, 78% { opacity: 1; } }
@keyframes m-esconder { 0%, 22%, 86%, 100% { opacity: 1; } 30%, 78% { opacity: 0; } }
.mascote.espreguicando .m-corpo-g { animation: m-espreguicar 1.8s ease-in-out; }
.mascote.espreguicando .m-pata-3, .mascote.espreguicando .m-pata-4 { animation: m-esticar-pata 1.8s ease-in-out; }
.mascote.espreguicando .m-boca-aberta, .mascote.espreguicando .m-fechados { animation: m-mostrar 1.8s linear; }
.mascote.espreguicando .m-boca, .mascote.espreguicando .m-olhos { animation: m-esconder 1.8s linear; }
@keyframes m-espreguicar { 0%, 100% { transform: none; } 30%, 72% { transform: translateY(2px) rotate(7deg) scaleX(1.06); } }
@keyframes m-esticar-pata { 0%, 100% { transform: none; } 30%, 72% { transform: rotate(-38deg); } }
.mascote.cocando .m-corpo-g { transform: translateY(3px); }
.mascote.cocando .m-pata-1, .mascote.cocando .m-pata-2 { transform: scaleY(.55); }
.mascote.cocando .m-pata-4 { animation: m-cocar .14s ease-in-out 10 alternate; }
.mascote.cocando .m-cabeca { transform: rotate(9deg); }
.mascote.cocando .m-orelha { transform: rotate(-10deg); }
.mascote.cocando .m-olhos { opacity: 0; }
.mascote.cocando .m-fechados { opacity: 1; }
@keyframes m-cocar { from { transform: translate(1px, -9px) rotate(-40deg); } to { transform: translate(1px, -11px) rotate(-58deg); } }
.mascote.abanando .m-cauda { animation: m-cauda .3s ease-in-out 5; }
.mascote.abanando .m-corpo-g { animation: m-ginga .25s ease-in-out 6 alternate; }
.mascote.abanando .m-cabeca { transform: rotate(-6deg); }
.mascote.abanando .m-boca-aberta { opacity: 1; }
.mascote.abanando .m-boca { opacity: 0; }
.mascote.cochilando .m-corpo-g { transform: translateY(3px); }
.mascote.cochilando .m-cabeca { animation: m-cochilo 2.4s ease-in-out; }
.mascote.cochilando .m-olhos { animation: m-cochilo-olhos 2.4s linear; }
.mascote.cochilando .m-fechados { animation: m-cochilo-fechados 2.4s linear; }
@keyframes m-cochilo { 0%, 100% { transform: none; } 30% { transform: rotate(6deg); } 62% { transform: rotate(16deg) translateY(2px); } 74% { transform: rotate(18deg) translateY(2px); } 79% { transform: rotate(-9deg) translateY(-2px); } 90% { transform: rotate(-3deg); } }
@keyframes m-cochilo-olhos { 0%, 10%, 78%, 100% { opacity: 1; } 15%, 22% { opacity: 0; } 26%, 30% { opacity: 1; } 36%, 76% { opacity: 0; } }
@keyframes m-cochilo-fechados { 0%, 10%, 78%, 100% { opacity: 0; } 15%, 22% { opacity: 1; } 26%, 30% { opacity: 0; } 36%, 76% { opacity: 1; } }
.mascote.cheirando .m-corpo-g { transform: translateY(1px); }
.mascote.cheirando .m-cabeca { animation: m-cheirar 1.6s ease-in-out; }
@keyframes m-cheirar { 0%, 100% { transform: none; } 22% { transform: rotate(18deg) translateY(4px); } 32% { transform: rotate(15deg) translateY(4px); } 42% { transform: rotate(19deg) translateY(4px); } 52% { transform: rotate(15deg) translateY(4px); } 62% { transform: rotate(19deg) translateY(4px); } 80% { transform: rotate(17deg) translateY(4px); } }
.mascote.inclinando .m-cabeca, .mascote.inclinando .m-cabeca-2 { animation: m-inclinar 1.3s ease-in-out; }
@keyframes m-inclinar { 0%, 100% { transform: none; } 25%, 75% { transform: rotate(-16deg); } }
.mascote.correndo .m-todo { rotate: 5deg; }
.mascote.dancando .m-todo { animation: m-dancar .9s ease-in-out; }
@keyframes m-dancar { 0%, 100% { transform: none; } 20% { transform: rotate(-10deg) translateY(-3px); } 40% { transform: rotate(10deg); } 60% { transform: rotate(-10deg) translateY(-3px); } 80% { transform: rotate(8deg); } }
.mascote.rolando .m-pulo { transform-origin: 50% 55%; animation: m-rolar .9s ease-in-out; }
@keyframes m-rolar { 0% { transform: none; } 50% { transform: translateY(-8px) rotate(180deg); } 100% { transform: rotate(360deg); } }
.mascote.sacudindo .m-pulo { animation: m-sacudir .08s linear 8 alternate; }
@keyframes m-sacudir { from { transform: translateX(-2px); } to { transform: translateX(2px); } }
.mascote.saltitando .m-pulo { animation: m-saltitos .9s ease-out; }
@keyframes m-saltitos { 0%, 33%, 66%, 100% { transform: none; } 16% { transform: translateY(-9px); } 50% { transform: translateY(-11px); } 83% { transform: translateY(-9px); } }
.mascote.apaixonado .m-olhos { opacity: 0; }
.mascote.apaixonado .m-fechados { opacity: 1; }
.mascote.apaixonado .m-corpo-g { animation: m-ronrom 1.4s ease-in-out infinite alternate; }
@keyframes m-ronrom { from { transform: rotate(-2deg); } to { transform: rotate(2deg); } }
.mascote.tonto .m-cabeca, .mascote.tonto .m-cabeca-2 { animation: m-tonto .5s ease-in-out 2; }
.mascote.tonto .m-corpo-g { animation: m-ginga .25s ease-in-out 4 alternate; }
@keyframes m-tonto { 0%, 100% { transform: rotate(-9deg); } 50% { transform: rotate(9deg); } }
.mascote.aliviado .m-corpo-g { transform: translateY(3px); }
.mascote.aliviado .m-olhos { opacity: 0; }
.mascote.aliviado .m-fechados, .mascote.aliviado .m-boca-aberta { opacity: 1; }
.mascote.aliviado .m-boca { opacity: 0; }
/* Modo Calmo: sem flutuar, sem asas zumbindo */
.mascote.quieto .m-todo, .mascote.quieto .m-asa, .mascote.quieto .m-corpo-g { animation: none; }
/* Efeitos dos especiais (curtos, só transform/opacity) */
.mascote-fumaca { width: 7px; height: 7px; border-radius: 50%; background: rgba(160, 165, 175, .85); animation: m-fumaca 1.2s ease-out both; }
.mascote-nota { font: 700 13px/1 system-ui, sans-serif; color: #9b7fd4; animation: m-nota 1.3s ease-out both; }
.mascote-rugido { width: 8px; height: 14px; border: 2px solid #8a8b96; border-left-color: transparent; border-top-color: transparent; border-bottom-color: transparent; border-radius: 50%; animation: m-rugido .9s ease-out both; }
@keyframes m-fumaca { from { transform: translate(0, 0) scale(.5); opacity: .9; } to { transform: translate(var(--dx, 0px), -26px) scale(1.6); opacity: 0; } }
@keyframes m-nota { from { transform: translate(0, 0) rotate(0); opacity: 1; } to { transform: translate(var(--dx, 0px), -30px) rotate(var(--r, 0deg)); opacity: 0; } }
@keyframes m-rugido { from { transform: translateX(0) scale(.6) scaleX(var(--sx, 1)); opacity: 1; } to { transform: translateX(var(--dx, 0px)) scale(1.3) scaleX(var(--sx, 1)); opacity: 0; } }
.mascote-bolha { width: 7px; height: 7px; border-radius: 50%; border: 1.4px solid rgba(74, 163, 223, .9); background: rgba(223, 241, 251, .35); animation: m-bolha 1.4s ease-out both; }
.mascote-estrela { font: 700 12px/1 system-ui, sans-serif; color: #f2c94c; text-shadow: 0 0 2px rgba(0, 0, 0, .25); animation: m-estrela 1.1s ease-out both; }
.mascote-zumbido { font: italic 700 11px/1 system-ui, sans-serif; color: #b08a1e; animation: m-nota 1.1s ease-out both; }
.mascote-coracao.pequeno { font-size: 10px; }
@keyframes m-bolha { 0% { transform: translate(0, 0) scale(.4); opacity: 0; } 15% { opacity: 1; } 50% { transform: translate(calc(var(--dx, 0px) * .5 + 3px), -16px) scale(1); } 100% { transform: translate(var(--dx, 0px), -34px) scale(1.15); opacity: 0; } }
@keyframes m-estrela { 0% { transform: translate(0, 0) scale(.3) rotate(0); opacity: 0; } 25% { opacity: 1; } 100% { transform: translate(var(--dx, 0px), var(--dy, -20px)) scale(1.1) rotate(var(--r, 90deg)); opacity: 0; } }
/* Bichos com partes escuras: contorno claro sutil no tema escuro */
${Object.keys(ANIMAIS).filter((id) => ANIMAIS[id].escuro).map((id) => `[data-tema="escuro"] .mascote.a-${id} svg, [data-tema="escuro"] .mascote-animal.a-${id} svg`).join(", ")} { filter: drop-shadow(0 0 .6px rgba(255, 255, 255, .55)); }
@media (prefers-reduced-motion: reduce) { .mascote *, .mascote-efeito, .mascote-pref * { animation: none !important; transition: none !important; } }
@media print { .mascote-camada { display: none !important; } }
.mascote-pref .mascote-animais { margin: 0; padding: 0; border: 0; min-width: 0; }
.mascote-pref .mascote-grade-animais { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; max-height: min(52vh, 460px); overflow: auto; padding: 4px; }
.mascote-pref .mascote-animais legend { margin-bottom: 6px; font-size: 13px; font-weight: 700; }
.mascote-pref .mascote-animal { position: relative; display: grid; justify-items: center; gap: 4px; padding: 8px; border: 1px solid var(--borda, #ddd); border-radius: 10px; cursor: pointer; font-size: 13px; text-align: center; }
.mascote-pref .m-fechados, .mascote-pref .m-boca-aberta, .mascote-pref .m-lingua, .mascote-pref .m-linguao { opacity: 0; }
.mascote-pref .mascote-animal:hover svg { animation: m-previa .45s ease-out; }
.mascote-pref.sem-movimento .mascote-animal:hover svg { animation: none; }
@keyframes m-previa { 0%, 100% { transform: none; } 45% { transform: translateY(-6px); } 75% { transform: scale(1.05, .95); } }
.mascote-pref .mascote-animal:has(input:checked) { border-color: var(--lilas, #9b7fd4); background: var(--lilas-destaque, #eee6fa); }
.mascote-pref .mascote-animal svg { width: 64px; height: 56px; }
.mascote-pref .mascote-animal input { position: absolute; opacity: 0; pointer-events: none; }
.mascote-pref .mascote-animal:focus-within { outline: 2px solid var(--lilas, #9b7fd4); outline-offset: 2px; }
.mascote-pref .mascote-opcoes { display: grid; gap: 8px; }
.mascote-pref .mascote-movimento { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; gap: 6px; }
.mascote-pref .mascote-movimento legend { margin-bottom: 4px; font-size: 13px; font-weight: 700; }
.mascote-pref .mascote-surpresa-info { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 8px 0 0; font-size: 13px; }
.mascote-pref .mascote-surpresa-info[hidden] { display: none; }
.mascote-pref .mascote-conhecidos { margin: 0; font-size: 12px; color: var(--texto-secundario, #6b6b78); }
`;
  document.head.appendChild(estilo);

  /* ---------- Elementos ---------- */
  const camada = document.createElement("div");
  camada.className = "mascote-camada";
  camada.setAttribute("aria-hidden", "true");
  const el = document.createElement("div");
  el.className = "mascote escondido";
  el.innerHTML = `<span class="mascote-balao"></span><span class="mascote-zzz">z</span><span class="mascote-zzz">z</span><span class="mascote-zzz">z</span><div class="m-pulo"></div>`;
  camada.appendChild(el);
  const balao = el.querySelector(".mascote-balao");
  const pulo = el.querySelector(".m-pulo");
  const svgDe = (a) => `<svg viewBox="0 0 64 56" focusable="false"><g class="m-todo">${a.svg}</g></svg>`;
  /* "Surpresa do dia": sorteada POR NAVEGADOR. Cada navegador (cada localStorage/PREFIXO) ganha uma semente aleatória
     na primeira vez (prefs.sorteioSeed, nunca muda). O bicho do dia sai de um gerador com semente (semente + dia de Brasília
     + rodada), então fica o mesmo o dia todo neste computador e muda na virada do dia; outro computador tem outra semente.
     prefs.sorteioHistorico guarda os últimos bichos sorteados e eles ficam fora do sorteio (sem repetir em dias seguidos). */
  const TAM_HISTORICO = Math.max(1, Math.min(10, Math.floor(IDS_ORDEM.length / 2)));
  const hash32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function geradorSemente(n) {
    let t = n >>> 0;
    return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  }
  function novaSemente() {
    try { const v = new Uint32Array(2); crypto.getRandomValues(v); return v[0].toString(36) + v[1].toString(36); }
    catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  }
  function semente() {
    if (!prefs.sorteioSeed || typeof prefs.sorteioSeed !== "string") { prefs.sorteioSeed = novaSemente(); gravarPrefs(); }
    return prefs.sorteioSeed;
  }
  const historico = () => (Array.isArray(prefs.sorteioHistorico) ? prefs.sorteioHistorico : []).filter((id) => ANIMAIS[id]);
  /* Função pura: mesmo (dia, semente, evitar, rodada) => mesmo bicho. Se evitar tudo, libera os mais antigos do histórico. */
  function sorteioDoDia(dia, sem = semente(), evitar = historico(), rodada = 0) {
    const r = geradorSemente(hash32(`${sem}|${dia}|${rodada}`));
    const fora = evitar.slice();
    let candidatos = IDS_ORDEM.filter((id) => !fora.includes(id));
    while (!candidatos.length && fora.length) { fora.shift(); candidatos = IDS_ORDEM.filter((id) => !fora.includes(id)); }
    if (!candidatos.length) candidatos = IDS_ORDEM.slice();
    return candidatos[Math.floor(r() * candidatos.length)];
  }
  /* Bicho de hoje neste navegador; outro=true é o "Sortear outro hoje" (o atual entra no histórico e não volta tão cedo) */
  function surpresaDeHoje(outro = false) {
    const hoje = hojeBrasilia();
    if (!outro && prefs.sorteioDia === hoje && ANIMAIS[prefs.sorteioAnimal]) return prefs.sorteioAnimal;
    const hist = historico();
    if (outro && ANIMAIS[prefs.sorteioAnimal] && !hist.includes(prefs.sorteioAnimal)) hist.push(prefs.sorteioAnimal);
    const rodada = outro && prefs.sorteioDia === hoje ? (Number(prefs.sorteioRodada) || 0) + 1 : 0;
    const escolhido = sorteioDoDia(hoje, semente(), hist, rodada);
    hist.push(escolhido);
    while (hist.length > TAM_HISTORICO) hist.shift();
    Object.assign(prefs, { sorteioDia: hoje, sorteioAnimal: escolhido, sorteioHistorico: hist, sorteioRodada: rodada });
    gravarPrefs();
    return escolhido;
  }
  /* Só para mostrar no diálogo quem seria o bicho de hoje (não grava nada além da semente) */
  const previaSurpresa = () => (prefs.sorteioDia === hojeBrasilia() && ANIMAIS[prefs.sorteioAnimal] ? prefs.sorteioAnimal : sorteioDoDia(hojeBrasilia()));
  function idAnimal() {
    if (prefs.animal === "surpresa") return surpresaDeHoje();
    return ANIMAIS[prefs.animal] ? prefs.animal : "gato";
  }
  let desenhado = "";
  /* Desenha o bicho escolhido; devolve true quando trocou de bicho (não na primeira vez) */
  function desenhar() {
    const id = idAnimal();
    if (id === desenhado) return false;
    const a = ANIMAIS[id];
    if (desenhado) el.classList.remove(`a-${desenhado}`);
    el.classList.add(`a-${id}`);
    classe("bipede", a.andar === "bipede");
    classe("ginga", a.ginga);
    el.style.setProperty("--vel", String(a.velocidade));
    el.style.setProperty("--m-escala", String(a.escala));
    pulo.innerHTML = svgDe(a);
    const trocou = !!desenhado;
    desenhado = id;
    conquista = conhecer(id);
    return trocou;
  }
  /* Conquista leve (só neste navegador): quantos bichos diferentes já apareceram */
  const MARCOS = [5, 10, 15, 20];
  let conquista = "";
  function conhecer(id) {
    const lista = (Array.isArray(prefs.conhecidos) ? prefs.conhecidos : []).filter((x) => ANIMAIS[x]);
    if (lista.includes(id)) return "";
    lista.push(id);
    prefs.conhecidos = lista;
    gravarPrefs();
    if (lista.length === IDS_ORDEM.length) return `🏅 Você conheceu todos os ${lista.length} bichos!`;
    return MARCOS.includes(lista.length) ? `🏅 Você já conheceu ${lista.length} bichos!` : "";
  }
  const animal = () => ANIMAIS[desenhado] || ANIMAIS.gato;
  /* Galeria de dev: sorteioDoDia(dia, semente, evitar, rodada) é puro; o resultado depende da semente deste navegador */
  if (script && "galeria" in script.dataset) {
    window.__mascoteGaleria = { animais: ANIMAIS, ordem: IDS_ORDEM, svg: (id) => svgDe(ANIMAIS[id]), sorteioDoDia, semente, novaSemente, tamanhoHistorico: TAM_HISTORICO };
  }
  const montar = () => { if (!camada.isConnected) document.body.appendChild(camada); };
  if (document.body) montar(); else document.addEventListener("DOMContentLoaded", montar);

  /* ---------- Estado ---------- */
  const m = { x: 40, y: -100, alvoX: 40, dir: 1, trilha: "base", estado: "parar", ate: 0, vy: 0, pose: "sentado", turboAte: 0 };
  let ultimaAtividade = performance.now();
  let pedido = 0, ultimoQuadro = 0, rects = { grade: null, barra: null }, ultimaMedida = 0;
  let mouse = { x: -999, y: -999 };
  let temporizadorBalao = 0, temporizadorClique = 0, temporizadorHover = 0, intervaloCoracoes = 0, proximaPiscada = performance.now() + 3000;
  let cliquesRecentes = [], empolgadoAte = 0, soltouEm = 0;
  /* Especial espontâneo: 25–60 s (modo Animado: 15–35 s) */
  const intervaloEspecial = () => (animado() ? 15000 + Math.random() * 20000 : 25000 + Math.random() * 35000);
  let proximoEspecial = performance.now() + intervaloEspecial();

  const classe = (c, sim) => el.classList.toggle(c, !!sim);
  const POSES = ["sentado", "lambendo", "olhando", "bocejando"];
  function pose(p) { POSES.forEach((x) => classe(x, x === p)); m.pose = p; }
  function falar(texto, ms = 1800) {
    balao.textContent = texto;
    balao.classList.add("visivel");
    clearTimeout(temporizadorBalao);
    temporizadorBalao = setTimeout(() => balao.classList.remove("visivel"), ms);
  }
  /* Classes de uma vez só: cada uma tem o seu temporizador (re-disparar não é cortado pelo temporizador antigo) */
  const temporizadoresUnicos = {};
  function efeitoUnico(c, ms) {
    clearTimeout(temporizadoresUnicos[c]);
    el.classList.remove(c); void el.offsetWidth; el.classList.add(c);
    temporizadoresUnicos[c] = setTimeout(() => el.classList.remove(c), ms);
  }
  /* Ações de um tempo (espontâneas e de clique): limpas ao arrastar, dormir ou fazer especial */
  const ACOES = ["espreguicando", "cocando", "abanando", "cochilando", "cheirando", "inclinando", "dancando", "rolando", "sacudindo", "saltitando", "tonto", "aliviado"];
  function limparAcoes() { ACOES.forEach((c) => { clearTimeout(temporizadoresUnicos[c]); el.classList.remove(c); }); }
  function acao(c, ms) {
    limparAcoes();
    pose("");
    classe("andando", false);
    m.estado = "parar";
    m.ate = performance.now() + ms + 300;
    proximoEspecial = Math.max(proximoEspecial, performance.now() + ms + 8000);
    efeitoUnico(c, ms);
  }
  desenhar();

  /* ---------- Trilhas: borda de baixo da planilha e topo da barra de ferramentas ---------- */
  function medir() {
    const g = document.querySelector(SEL_GRADE);
    const b = document.querySelector(SEL_BARRA);
    const visivel = (r) => r && r.width > 120 && r.height > 0;
    const rg = g && g.isConnected ? g.getBoundingClientRect() : null;
    const rb = b && b.offsetParent ? b.getBoundingClientRect() : null;
    rects.grade = visivel(rg) && rg.bottom + A <= innerHeight + 2 && rg.bottom > 0 ? rg : null;
    rects.barra = visivel(rb) && rb.top - A >= 0 && rb.top < innerHeight ? rb : null;
    ultimaMedida = performance.now();
  }
  function trilha(nome) {
    const r = nome === "barra" ? rects.barra : rects.grade;
    if (!r) return null;
    return nome === "barra"
      ? { y: r.top - A + 3, min: r.left + 4, max: Math.max(r.left + 4, Math.min(r.right, innerWidth) - L - 4) }
      : { y: r.bottom + 1, min: r.left + 6, max: Math.max(r.left + 6, Math.min(r.right, innerWidth) - L - 6) };
  }
  const trilhaAtual = () => trilha(m.trilha) || trilha(m.trilha === "base" ? "barra" : "base");

  /* ---------- Obstáculos: célula em edição, lista aberta, filtros ---------- */
  function sobrepoe(r) { return r && r.width && !(r.right < m.x || r.left > m.x + L || r.bottom < m.y || r.top > m.y + A); }
  function obstaculos() {
    let tapa = false;
    document.querySelectorAll(".combo-lista:not([hidden]), .pop, .ficha.aberta, .aviso.visivel").forEach((x) => { if (sobrepoe(x.getBoundingClientRect())) tapa = true; });
    classe("afastado", tapa);
    if (tapa) el.style.opacity = "0"; else el.style.opacity = "";
    el.style.pointerEvents = tapa ? "none" : "";
    /* Alguém editando: vai para o lado oposto da célula */
    const ed = document.querySelector(`${SEL_GRADE} .editor-celula`);
    const t = trilhaAtual();
    if (ed && t && !["arrastar", "cair", "dormir"].includes(m.estado) && !quieto()) {
      const r = ed.getBoundingClientRect();
      const centro = r.left + r.width / 2;
      if (Math.abs(m.x + L / 2 - centro) < 170) {
        m.alvoX = centro < (t.min + t.max) / 2 ? t.max : t.min;
        if (m.trilha !== "base") m.trilha = "base";
        m.estado = "passear";
      }
    }
  }

  /* ---------- Decisões ---------- */
  function decidir(agora) {
    const t = trilhaAtual();
    if (!t) return;
    const sorteio = Math.random();
    /* Modo Animado: menos passeio comum e mais brincadeira */
    const passeio = animado() ? 0.4 : 0.5;
    if (sorteio < passeio) {
      m.alvoX = t.min + Math.random() * (t.max - t.min);
      m.estado = "passear";
      /* Corridinha: vai mais longe e mais rápido por 1–2 s */
      if (Math.random() < (animado() ? 0.25 : 0.14) && t.max - t.min > 160) {
        const longe = m.x - t.min > t.max - m.x ? t.min : t.max;
        m.alvoX = longe + (longe === t.min ? 1 : -1) * Math.random() * 40;
        m.turboAte = agora + 1000 + Math.random() * 1000;
      }
    } else if (sorteio < passeio + 0.08 && rects.barra && rects.grade) {
      /* Visita rápida à outra trilha (some e aparece lá) */
      el.classList.add("escondido");
      setTimeout(() => {
        m.trilha = m.trilha === "base" ? "barra" : "base";
        const n = trilhaAtual();
        if (n) { m.x = n.min + Math.random() * (n.max - n.min); m.y = n.y; m.alvoX = m.x; }
        el.classList.remove("escondido");
      }, 320);
      m.estado = "parar"; m.ate = agora + 900; pose("sentado");
    } else if (Math.random() < (animado() ? 0.65 : 0.5)) {
      comportamento(agora);
    } else {
      m.estado = "parar";
      m.ate = agora + 2500 + Math.random() * 4500;
      pose(POSES[Math.floor(Math.random() * POSES.length)]);
      if (m.pose === "bocejando") setTimeout(() => { if (m.pose === "bocejando") pose("sentado"); }, 1600);
    }
    /* Visita à barra dura pouco: volta para baixo da planilha */
    if (m.trilha === "barra" && m.estado === "parar" && Math.random() < 0.5) m.ate = agora + 1500;
  }
  /* Comportamentos espontâneos (sorteio com pesos): espreguiçar, coçar a orelha, abanar para a pessoa,
     cochilo curto com susto, cheirar o chão e inclinar a cabeça */
  const COMPORTAMENTOS = [
    { c: "espreguicando", ms: 1800, peso: 3 },
    { c: "cocando", ms: 1600, peso: 3 },
    { c: "abanando", ms: 1500, peso: 3, antes() { if (mouse.x > 0) m.dir = mouse.x < m.x + L / 2 ? -1 : 1; } },
    { c: "cochilando", ms: 2400, peso: 2, depois: [1850, () => falar("Hã?! Tô acordado! 😳", 1300)] },
    { c: "cheirando", ms: 1600, peso: 3 },
    { c: "inclinando", ms: 1300, peso: 2, antes() { if (Math.random() < 0.4) falar("?", 900); } }
  ];
  function comportamento() {
    const total = COMPORTAMENTOS.reduce((s, x) => s + x.peso, 0);
    let r = Math.random() * total;
    const b = COMPORTAMENTOS.find((x) => (r -= x.peso) < 0) || COMPORTAMENTOS[0];
    if (b.antes) b.antes();
    acao(b.c, b.ms);
    m.ate += 400 + Math.random() * 1200;
    if (b.depois) setTimeout(() => { if (el.classList.contains(b.c)) b.depois[1](); }, b.depois[0]);
    setTimeout(() => { if (m.estado === "parar" && !m.pose) pose("sentado"); }, b.ms);
  }
  function dormir() {
    limparAcoes();
    m.estado = "dormir"; pose(""); classe("andando", false); classe("dormindo", true);
  }
  function acordar() {
    if (m.estado !== "dormir") return;
    classe("dormindo", false);
    pose("bocejando");
    m.estado = "parar"; m.ate = performance.now() + 1800;
    ultimaAtividade = performance.now();
    proximoEspecial = Math.max(proximoEspecial, performance.now() + 10000);
    setTimeout(() => { if (m.pose === "bocejando") pose("sentado"); }, 1400);
  }
  const limiteSono = () => (horaBrasilia() >= 18 || horaBrasilia() < 6 ? SONO_NOITE_MS : SONO_MS) * animal().sono;
  /* Especial do bicho (clique duplo ou, de vez em quando, parado). No modo Calmo, nada animado. */
  let especialAte = 0;
  function fazerEspecial() {
    const e = animal().especial;
    if (!e || quieto() || ["dormir", "arrastar", "cair"].includes(m.estado) || performance.now() < especialAte) return false;
    especialAte = performance.now() + e.ms + 200;
    proximoEspecial = performance.now() + intervaloEspecial();
    limparAcoes();
    pose("");
    classe("andando", false);
    m.estado = "parar";
    m.ate = performance.now() + e.ms + 400;
    efeitoUnico(e.classe, e.ms);
    (e.poses || []).forEach((p) => efeitoUnico(p, e.ms));
    if (e.efeito && EFEITOS[e.efeito]) setTimeout(EFEITOS[e.efeito], 200);
    if (e.depois) setTimeout(() => { if (m.estado === "parar") pose(e.depois); }, e.ms);
    return true;
  }

  /* ---------- Quadro (rAF; para quando a aba some) ---------- */
  function quadro(agora) {
    pedido = 0;
    const dt = Math.min(0.05, (agora - (ultimoQuadro || agora)) / 1000);
    ultimoQuadro = agora;
    if (!ativo()) { el.classList.add("escondido"); return; }
    if (agora - ultimaMedida > 400) { medir(); obstaculos(); }
    const t = trilhaAtual();
    if (!t && m.estado !== "arrastar") { el.classList.add("escondido"); agendar(); return; }
    if (m.estado !== "arrastar") el.classList.remove("escondido");
    if (t && m.y < -50) { m.x = t.max; m.y = t.y; m.alvoX = m.x; }
    classe("quieto", quieto());
    const correndo = m.estado === "passear" && agora < m.turboAte && !quieto();
    if (correndo !== el.classList.contains("correndo")) {
      classe("correndo", correndo);
      el.style.setProperty("--vel", String(animal().velocidade * (correndo ? 2.2 : 1)));
    }

    if (quieto()) {
      /* Menos movimento: sentado, parado no canto direito da trilha */
      classe("andando", false);
      if (m.estado !== "arrastar" && m.estado !== "dormir") { m.estado = "parar"; if (m.pose !== "sentado") pose("sentado"); }
      if (t && m.estado !== "arrastar") { m.x = Math.min(Math.max(m.x, t.min), t.max); m.y = t.y; }
    } else if (m.estado === "passear" && t) {
      m.alvoX = Math.min(Math.max(m.alvoX, t.min), t.max);
      const dx = m.alvoX - m.x;
      const passo = VELOCIDADE * animal().velocidade * (correndo ? 2.2 : 1) * dt;
      if (Math.abs(dx) <= passo) { m.x = m.alvoX; m.estado = "parar"; m.turboAte = 0; m.ate = agora + 1200 + Math.random() * 2500; pose("sentado"); classe("andando", false); }
      else { m.x += Math.sign(dx) * passo; m.dir = Math.sign(dx); classe("andando", true); pose(""); }
      m.y = t.y;
    } else if (m.estado === "parar" && t) {
      classe("andando", false);
      m.x = Math.min(Math.max(m.x, t.min), t.max);
      m.y = t.y;
      if (agora > proximoEspecial) { proximoEspecial = agora + intervaloEspecial(); if (fazerEspecial()) { agendar(); return; } }
      if (agora > m.ate) decidir(agora);
    } else if (m.estado === "cair" && t) {
      m.vy += 1500 * dt;
      m.y += m.vy * dt;
      if (m.y >= t.y) { m.y = t.y; m.vy = 0; m.estado = "parar"; m.ate = agora + 1500; pose("sentado"); efeitoUnico("pousando", 350); depoisDoPouso(); }
    } else if (m.estado === "dormir" && t) {
      m.x = Math.min(Math.max(m.x, t.min), t.max); m.y = t.y;
    }

    if (m.estado !== "dormir" && m.estado !== "arrastar" && agora - ultimaAtividade > limiteSono()) dormir();
    if (m.estado === "dormir" && Math.hypot(mouse.x - (m.x + L / 2), mouse.y - (m.y + A / 2)) < 90) acordar();
    if (agora > proximaPiscada && m.estado !== "dormir") { efeitoUnico("piscando", 160); proximaPiscada = agora + 2500 + Math.random() * 4000; }

    classe("esquerda", m.dir < 0);
    el.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`;
    agendar();
  }
  function agendar() {
    if (pedido || document.hidden || !ativo()) return;
    pedido = requestAnimationFrame(quadro);
  }
  function reiniciar() { ultimoQuadro = 0; medir(); agendar(); }

  /* ---------- Atividade da pessoa (sono) e olhos que seguem o ponteiro ---------- */
  const marcarAtividade = () => { ultimaAtividade = performance.now(); };
  document.addEventListener("keydown", marcarAtividade, { passive: true });
  document.addEventListener("pointerdown", marcarAtividade, { passive: true });
  document.addEventListener("wheel", marcarAtividade, { passive: true });
  document.addEventListener("pointermove", (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    marcarAtividade();
    if (!el.classList.contains("carinho")) return;
    const ps = el.querySelectorAll(".m-pupilas");
    if (!ps.length) return;
    const cx = m.x + L * 0.8, cy = m.y + A * 0.4;
    const ang = Math.atan2(e.clientY - cy, (e.clientX - cx) * (m.dir < 0 ? -1 : 1));
    const t = `translate(${(Math.cos(ang) * 1.1).toFixed(2)}px, ${(Math.sin(ang) * 1).toFixed(2)}px)`;
    ps.forEach((p) => { p.style.transform = t; });
  }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(pedido); pedido = 0; } else reiniciar(); });
  addEventListener("resize", () => { medir(); }, { passive: true });
  addEventListener("scroll", () => { medir(); }, { passive: true, capture: true });

  /* ---------- Interações com o bichinho ---------- */
  /* Hover prolongado (~1,5 s): ronrona sem parar, fecha os olhos feliz e solta coraçõezinhos (no modo Calmo, só o ronrom) */
  function pararCarinhoLongo() {
    clearTimeout(temporizadorHover); clearInterval(intervaloCoracoes);
    temporizadorHover = 0; intervaloCoracoes = 0;
    classe("apaixonado", false);
  }
  el.addEventListener("pointerenter", () => {
    if (m.estado === "dormir") acordar();
    classe("carinho", true);
    if (m.estado !== "arrastar") falar(animal().ronrom, 1400);
    pararCarinhoLongo();
    temporizadorHover = setTimeout(() => {
      if (!el.classList.contains("carinho") || m.estado === "arrastar" || arraste) return;
      falar(`${animal().ronrom} 💕`, 60000);
      if (quieto()) return;
      classe("apaixonado", true);
      coracao(true);
      intervaloCoracoes = setInterval(() => { if (el.classList.contains("apaixonado")) coracao(true); }, 900);
    }, 1500);
  });
  el.addEventListener("pointerleave", () => {
    classe("carinho", false);
    if (el.classList.contains("apaixonado") || intervaloCoracoes) balao.classList.remove("visivel");
    pararCarinhoLongo();
    el.querySelectorAll(".m-pupilas").forEach((p) => { p.style.transform = ""; });
  });
  let arraste = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    arraste = { x0: e.clientX, y0: e.clientY, dx: e.clientX - m.x, dy: e.clientY - m.y, movendo: false, id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
  });
  el.addEventListener("pointermove", (e) => {
    if (!arraste) return;
    if (!arraste.movendo && Math.hypot(e.clientX - arraste.x0, e.clientY - arraste.y0) > 5) {
      arraste.movendo = true;
      pararCarinhoLongo(); limparAcoes(); classe("correndo", false); m.turboAte = 0;
      m.estado = "arrastar"; pose(""); classe("andando", false); classe("dormindo", false);
      classe("pendurado", true); classe("arrastando", true);
      falar("Iiih!", 900);
    }
    if (arraste.movendo) {
      m.x = Math.min(Math.max(0, e.clientX - arraste.dx), innerWidth - L);
      m.y = Math.min(Math.max(0, e.clientY - arraste.dy), innerHeight - A);
    }
  });
  const soltar = () => {
    if (!arraste) return;
    const movia = arraste.movendo;
    arraste = null;
    if (!movia) return;
    soltouEm = performance.now();
    classe("pendurado", false); classe("arrastando", false);
    /* Cai na trilha de baixo mais próxima (a da planilha, ou a da barra se estiver abaixo) */
    medir();
    const base = trilha("base"), barra = trilha("barra");
    const candidatas = [["barra", barra], ["base", base]].filter(([, t]) => t && t.y >= m.y - 4).sort((a, b) => a[1].y - b[1].y);
    const [nome, t] = candidatas[0] || (base ? ["base", base] : ["barra", barra]);
    if (!t) { m.estado = "parar"; return; }
    m.trilha = nome;
    m.x = Math.min(Math.max(m.x, t.min), t.max);
    if (m.y > t.y) { m.y = t.y; m.estado = "parar"; m.ate = performance.now() + 1200; pose("sentado"); efeitoUnico("pousando", 350); depoisDoPouso(); }
    else { m.vy = 0; m.estado = quieto() ? "parar" : "cair"; if (quieto()) m.y = t.y; }
  };
  /* Depois de arrastar e pousar: fica tonto (com estrelinhas) ou aliviado por ~1 s */
  function depoisDoPouso() {
    if (quieto()) return;
    setTimeout(() => {
      if (m.estado !== "parar") return;
      if (Math.random() < 0.5) { acao("tonto", 1000); falar("Tô tonto… 💫", 1200); EFEITOS.estrelas(); }
      else { acao("aliviado", 1100); falar("Ufa!", 1100); }
      m.ate = performance.now() + 1600;
      setTimeout(() => { if (m.estado === "parar" && !m.pose) pose("sentado"); }, 1100);
    }, 360);
  }
  el.addEventListener("pointerup", soltar);
  el.addEventListener("pointercancel", soltar);
  const fraseQualquer = () => { const f = [animal().oi, ...FRASES, ...animal().frases]; return f[Math.floor(Math.random() * f.length)]; };
  const sortearPeso = (lista) => { let r = Math.random() * lista.reduce((s, x) => s + x[0], 0); return (lista.find((x) => (r -= x[0]) < 0) || lista[0])[1]; };
  /* Clique simples: varia entre pulo, gingada, rolar de lado, coração e estrelinhas */
  function cliqueSimples() {
    if (m.estado === "dormir") acordar();
    efeitoUnico("miando", 700);
    if (quieto()) { falar(fraseQualquer(), 2200); return; }
    const reacao = sortearPeso([
      [30, () => { efeitoUnico("pulando", 600); falar(fraseQualquer(), 2200); }],
      [15, () => { acao("dancando", 900); falar("♪ Dancinha! ♪", 1200); }],
      [15, () => { acao("rolando", 900); falar("Weee!", 1000); }],
      [20, () => { efeitoUnico("pulando", 600); coracao(); }],
      [20, () => { efeitoUnico("pulando", 600); EFEITOS.estrelas(); falar(fraseQualquer(), 2000); }]
    ]);
    reacao();
  }
  /* Clique duplo: especial do bicho (às vezes com partículas); sem especial, gira, sacode ou dá saltitos */
  function cliqueDuplo() {
    if (m.estado === "dormir") acordar();
    if (animal().especial && fazerEspecial()) {
      falar(animal().oi, 1400);
      if (Math.random() < 0.4) setTimeout(() => (Math.random() < 0.5 ? EFEITOS.estrelas() : confete(8)), animal().especial.ms - 200);
      return;
    }
    if (!quieto()) {
      const c = sortearPeso([[2, "girando"], [1, "sacudindo"], [1, "saltitando"]]);
      if (c === "girando") efeitoUnico("girando", 700); else acao(c, c === "sacudindo" ? 700 : 900);
    }
    falar("Uiii!", 1000);
  }
  /* Clique triplo (ou 3 cliques em 1 s): sequência "empolgado" */
  const FRASES_EMPOLGADO = ["Uhuuu! 🎉", "Tô empolgado demais!", "De novo! De novo!", "Isso é que é carinho!"];
  function empolgado() {
    const agora = performance.now();
    if (agora < empolgadoAte) return;
    empolgadoAte = agora + 1500;
    cliquesRecentes = [];
    if (m.estado === "dormir") acordar();
    efeitoUnico("miando", 900);
    falar(FRASES_EMPOLGADO[Math.floor(Math.random() * FRASES_EMPOLGADO.length)], 1800);
    if (quieto()) return;
    acao("saltitando", 900);
    efeitoUnico("pulando", 600);
    confete(8);
    setTimeout(() => coracao(), 300);
  }
  el.addEventListener("click", (e) => {
    if (performance.now() - soltouEm < 300) return;
    const agora = performance.now();
    cliquesRecentes = cliquesRecentes.filter((t) => agora - t < 1000).concat(agora);
    const n = cliquesRecentes.length >= 3 ? 3 : Math.min(e.detail || 1, 3);
    clearTimeout(temporizadorClique);
    /* Espera um pouco para saber se vem outro clique (simples x duplo x triplo) */
    if (n >= 3) { empolgado(); return; }
    temporizadorClique = setTimeout(n === 2 ? cliqueDuplo : cliqueSimples, n === 2 ? 260 : 240);
  });
  el.addEventListener("dblclick", (e) => { e.preventDefault(); });
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); abrirPreferencias(); });

  /* ---------- Efeitos ---------- */
  function coracao(pequeno = false) {
    const c = document.createElement("span");
    c.className = `mascote-efeito mascote-coracao${pequeno ? " pequeno" : ""}`;
    c.textContent = "❤";
    c.style.left = `${m.x + L / 2 - (pequeno ? 4 : 8) + (pequeno ? Math.round((Math.random() - 0.5) * 24) : 0)}px`;
    c.style.top = `${m.y - 6}px`;
    c.style.color = "#e5486b";
    if (pequeno) c.style.setProperty("--dx", `${Math.round((Math.random() - 0.5) * 16)}px`);
    camada.appendChild(c);
    setTimeout(() => c.remove(), 1200);
  }
  function confete(n = 16) {
    if (quieto()) return;
    const cores = ["#9b7fd4", "#f2c94c", "#5bbf7a", "#e5486b", "#4aa3df", "#f2994a"];
    for (let i = 0; i < n; i++) {
      const c = document.createElement("span");
      c.className = "mascote-efeito mascote-confete";
      c.style.left = `${m.x + L / 2}px`;
      c.style.top = `${m.y + 8}px`;
      c.style.background = cores[i % cores.length];
      c.style.setProperty("--dx", `${Math.round((Math.random() - 0.5) * 160)}px`);
      c.style.setProperty("--dy", `${Math.round(-30 - Math.random() * 70)}px`);
      c.style.setProperty("--r", `${Math.round((Math.random() - 0.5) * 720)}deg`);
      c.style.animationDelay = `${Math.round(Math.random() * 120)}ms`;
      camada.appendChild(c);
      setTimeout(() => c.remove(), 1400);
    }
  }

  /* Fumacinha, notinhas e rugido: saem da boca do bicho (espelhada quando ele olha para a esquerda) */
  function efeito(classeEf, texto, vars, atraso, dur) {
    if (document.querySelector(`${SEL_GRADE} .editor-celula`)) return;
    const [bx, by] = animal().boca;
    const fx = bx / 64, fy = by / 56;
    const c = document.createElement("span");
    c.className = `mascote-efeito ${classeEf}`;
    c.textContent = texto;
    c.style.left = `${m.dir < 0 ? m.x + L * (1 - fx) : m.x + L * fx}px`;
    c.style.top = `${m.y + A * fy - 6}px`;
    Object.entries(vars).forEach(([k, v]) => c.style.setProperty(k, v));
    c.style.animationDelay = `${atraso}ms`;
    camada.appendChild(c);
    setTimeout(() => c.remove(), dur + atraso + 100);
  }
  const lado = () => (m.dir < 0 ? -1 : 1);
  const EFEITOS = {
    fumaca() { [0, 1, 2].forEach((i) => efeito("mascote-fumaca", "", { "--dx": `${lado() * (4 + i * 4)}px` }, i * 170, 1200)); },
    notas() { ["♪", "♫", "♪"].forEach((s, i) => efeito("mascote-nota", s, { "--dx": `${lado() * (6 + i * 5)}px`, "--r": `${(i - 1) * 18}deg` }, i * 230, 1300)); },
    rugido() { [0, 1].forEach((i) => efeito("mascote-rugido", "", { "--dx": `${lado() * (10 + i * 6)}px`, "--sx": String(lado()) }, i * 180, 900)); },
    bolhas() { [0, 1, 2, 3].forEach((i) => efeito("mascote-bolha", "", { "--dx": `${lado() * (2 + i * 3) + (i % 2 ? -4 : 4)}px` }, i * 200, 1400)); },
    zumbido() { ["bzz", "bzzz", "bz"].forEach((s, i) => efeito("mascote-zumbido", s, { "--dx": `${lado() * (8 + i * 6)}px`, "--r": `${(i - 1) * 12}deg` }, i * 260, 1100)); },
    /* Estrelinhas em volta do corpo (não saem da boca) */
    estrelas() {
      if (quieto() || document.querySelector(`${SEL_GRADE} .editor-celula`)) return;
      for (let i = 0; i < 6; i++) {
        const c = document.createElement("span");
        const ang = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
        c.className = "mascote-efeito mascote-estrela";
        c.textContent = i % 2 ? "✦" : "★";
        c.style.left = `${m.x + L / 2 - 5}px`;
        c.style.top = `${m.y + A * 0.3}px`;
        c.style.setProperty("--dx", `${Math.round(Math.cos(ang) * 30)}px`);
        c.style.setProperty("--dy", `${Math.round(Math.sin(ang) * 22 - 14)}px`);
        c.style.setProperty("--r", `${Math.round((Math.random() - 0.5) * 240)}deg`);
        c.style.animationDelay = `${i * 60}ms`;
        camada.appendChild(c);
        setTimeout(() => c.remove(), 1500);
      }
    }
  };

  /* ---------- Reações à planilha ---------- */
  document.addEventListener("planilha:salvou", (e) => {
    if (!ativo()) return;
    if (m.estado === "dormir") acordar();
    const n = e.detail && e.detail.n;
    if (!quieto()) efeitoUnico("pulando", 600);
    confete();
    falar(n > 1 ? `${n} salvos! 🎉` : "Salvou! 🎉", 2000);
  });
  document.addEventListener("planilha:erro", () => {
    if (!ativo()) return;
    if (m.estado === "dormir") acordar();
    classe("preocupado", true);
    falar("?", 1800);
    setTimeout(() => classe("preocupado", false), 1800);
  });

  /* ---------- Preferências (menu do botão direito e configuração da planilha) ---------- */
  function aplicarPrefs() {
    gravarPrefs();
    const trocou = desenhar();
    document.documentElement.style.setProperty("--espaco-mascote", ativo() ? `${ESPACO}px` : "0px");
    dispatchEvent(new Event("resize"));
    if (ativo()) { el.classList.remove("escondido"); reiniciar(); }
    else { el.classList.add("escondido"); cancelAnimationFrame(pedido); pedido = 0; }
    /* Bicho novo entra com um pulinho e diz oi */
    if (trocou && ativo()) {
      if (m.estado === "dormir") acordar();
      if (!quieto()) efeitoUnico("pulando", 600);
      falar(animal().oi, 2000);
    }
    if (conquista && ativo()) {
      const texto = conquista;
      conquista = "";
      setTimeout(() => { falar(texto, 2600); confete(10); }, trocou ? 2100 : 600);
    }
  }
  function abrirPreferencias() {
    const antigo = document.querySelector("dialog.mascote-pref");
    if (antigo) antigo.remove();
    const d = document.createElement("dialog");
    d.className = `perfil mascote-pref${quieto() ? " sem-movimento" : ""}`;
    d.setAttribute("aria-label", "Mascote");
    const escondidoHoje = prefs.escondidoEm === hojeBrasilia();
    const surpresa = `<label class="mascote-animal" data-surpresa title="Hoje neste computador: ${ANIMAIS[previaSurpresa()].nome}"><input type="radio" name="animal" value="surpresa"${prefs.animal === "surpresa" ? " checked" : ""}><svg viewBox="0 0 64 56" aria-hidden="true" focusable="false"><circle cx="32" cy="28" r="19" fill="#9b7fd4"/><text x="32" y="37" text-anchor="middle" font-size="26" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">?</text></svg><span>Surpresa do dia</span></label>`;
    const atual = prefs.animal === "surpresa" ? "surpresa" : idAnimal();
    const nivel = prefs.menosMovimento ? "calmo" : prefs.animado ? "animado" : "normal";
    const opcaoNivel = (v, texto) => `<label class="check"><input type="radio" name="nivel" value="${v}"${nivel === v ? " checked" : ""}> ${texto}</label>`;
    d.innerHTML = `<form class="form-dialog" method="dialog">
      <div class="form-topo"><h2>Mascote</h2><button type="button" class="perfil-fechar" data-fechar aria-label="Fechar"><svg class="icone" viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <label class="check"><input type="checkbox" name="mostrar"${prefs.mostrar ? " checked" : ""}> Mostrar mascote</label>
      <fieldset class="mascote-animais"><legend>Animal (${IDS_ORDEM.length} bichos)</legend>
        <div class="mascote-grade-animais">${surpresa}${IDS_ORDEM.map((id) => `<label class="mascote-animal a-${id}"><input type="radio" name="animal" value="${id}"${atual === id ? " checked" : ""}><svg viewBox="0 0 64 56" aria-hidden="true" focusable="false">${ANIMAIS[id].svg}</svg><span>${ANIMAIS[id].nome}</span></label>`).join("")}</div>
        <p class="mascote-surpresa-info" data-info-surpresa hidden><span>Hoje neste computador: <strong data-nome-surpresa></strong>. Amanhã é outra surpresa.</span><button type="button" class="btn btn-secundario btn-mini" data-sortear-outro>Sortear outro hoje</button></p>
      </fieldset>
      <div class="mascote-opcoes">
        <fieldset class="mascote-movimento"><legend>Movimento</legend>
          ${opcaoNivel("calmo", "Calmo (fica sentado, sem andar)")}
          ${opcaoNivel("normal", "Normal")}
          ${opcaoNivel("animado", "Animado (mais brincadeiras e especiais)")}
        </fieldset>
        <label class="check"><input type="checkbox" name="hoje"${escondidoHoje ? " checked" : ""}> Esconder por hoje</label>
      </div>
      <p class="mascote-conhecidos"></p>
      <p class="apoio">Sem som. Clique, clique duplo ou triplo no bichinho para brincar; deixe o ponteiro em cima para um carinho; arraste para mudar de lugar; o botão direito abre estas opções. Fica salvo neste navegador.</p>
      <div class="form-botoes"><button type="submit" class="btn">Pronto</button></div>
    </form>`;
    document.body.appendChild(d);
    const form = d.querySelector("form");
    const info = d.querySelector("[data-info-surpresa]");
    const atualizarInfo = () => {
      const ehSurpresa = prefs.animal === "surpresa";
      info.hidden = !ehSurpresa;
      const nome = ANIMAIS[ehSurpresa ? surpresaDeHoje() : previaSurpresa()].nome;
      d.querySelector("[data-nome-surpresa]").textContent = nome;
      d.querySelector("[data-surpresa]").title = `Hoje neste computador: ${nome}`;
      const n = (Array.isArray(prefs.conhecidos) ? prefs.conhecidos : []).filter((x) => ANIMAIS[x]).length;
      d.querySelector(".mascote-conhecidos").textContent = `Bichos que já apareceram neste navegador: ${n} de ${IDS_ORDEM.length}.`;
    };
    form.addEventListener("change", () => {
      prefs.mostrar = form.elements.mostrar.checked;
      prefs.animal = (form.querySelector('input[name="animal"]:checked') || {}).value || "gato";
      const nivelEscolhido = (form.querySelector('input[name="nivel"]:checked') || {}).value || "normal";
      prefs.menosMovimento = nivelEscolhido === "calmo";
      prefs.animado = nivelEscolhido === "animado";
      d.classList.toggle("sem-movimento", quieto());
      prefs.escondidoEm = form.elements.hoje.checked ? hojeBrasilia() : "";
      aplicarPrefs();
      atualizarInfo();
    });
    d.querySelector("[data-sortear-outro]").addEventListener("click", () => {
      surpresaDeHoje(true);
      aplicarPrefs();
      atualizarInfo();
    });
    atualizarInfo();
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-fechar]")) d.close(); });
    d.addEventListener("close", () => setTimeout(() => d.remove(), 300));
    d.showModal();
  }
  document.addEventListener("mascote:preferencias", abrirPreferencias);
  movimentoReduzido.addEventListener("change", reiniciar);

  /* Passa da meia-noite: "Esconder por hoje" deixa de valer e a "Surpresa do dia" troca de bicho */
  setInterval(() => { if ((ativo() && !pedido && !document.hidden) || (prefs.animal === "surpresa" && idAnimal() !== desenhado)) aplicarPrefs(); }, 60000);
  aplicarPrefs();
})();
