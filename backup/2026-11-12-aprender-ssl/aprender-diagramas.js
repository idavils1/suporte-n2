/*
 * Diagramas da Aprendizagem (":::diagrama <id>" no Markdown). SVG próprio, montado aqui:
 * as cores vêm das classes .dg-* do markdown.css (legíveis nos temas claro e escuro).
 * O SVG fica aria-hidden; quem lê é a figura (aria-label) e a versão em lista (passos).
 */
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Texto em várias linhas centralizado em x */
const linhas = (x, y, textos, classe, altura = 16) =>
  `<text class="${classe}" x="${x}" y="${y}" text-anchor="middle">${textos.map((t, i) => `<tspan x="${x}" dy="${i ? altura : 0}">${esc(t)}</tspan>`).join("")}</text>`;
const seta = (x1, y1, x2, y2) => {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const p = (d, a) => `${(x2 - d * Math.cos(ang + a)).toFixed(1)},${(y2 - d * Math.sin(ang + a)).toFixed(1)}`;
  return `<line class="dg-seta" x1="${x1}" y1="${y1}" x2="${(x2 - 6 * Math.cos(ang)).toFixed(1)}" y2="${(y2 - 6 * Math.sin(ang)).toFixed(1)}"/><polygon class="dg-seta-ponta" points="${x2},${y2} ${p(10, 0.45)} ${p(10, -0.45)}"/>`;
};

/* Passos numerados em linhas: cada passo = { titulo:[...], texto:[...], codigo:[...], destaque } */
function fluxo(passos, { porLinha = passos.length, largura = 980, alturaCaixa = 150, rodape = "" } = {}) {
  const gap = 34, margem = 10;
  const w = (largura - margem * 2 - gap * (porLinha - 1)) / porLinha;
  const nLinhas = Math.ceil(passos.length / porLinha);
  const alturaLinha = alturaCaixa + 40;
  const altura = nLinhas * alturaLinha + (rodape ? 46 : 6);
  let html = "";
  passos.forEach((p, i) => {
    const linha = Math.floor(i / porLinha), col = i % porLinha;
    const x = margem + col * (w + gap), y = 24 + linha * alturaLinha;
    const cx = x + w / 2;
    html += `<rect class="${p.destaque ? "dg-caixa-atencao" : "dg-caixa"}" x="${x}" y="${y}" width="${w}" height="${alturaCaixa}" rx="12"/>`;
    html += `<circle class="dg-num" cx="${cx}" cy="${y}" r="16"/>` + linhas(cx, y + 5, [String(i + 1)], "dg-num-texto");
    let ty = y + 34;
    html += linhas(cx, ty, p.titulo, "dg-titulo", 17);
    ty += p.titulo.length * 17 + 6;
    if (p.codigo && p.codigo.length) { html += linhas(cx, ty, p.codigo, "dg-codigo", 14); ty += p.codigo.length * 14 + 6; }
    if (p.texto && p.texto.length) html += linhas(cx, ty, p.texto, "dg-texto", 15);
    const prox = i + 1;
    if (prox < passos.length) {
      if (Math.floor(prox / porLinha) === linha) html += seta(x + w + 3, y + alturaCaixa / 2, x + w + gap - 3, y + alturaCaixa / 2);
      else {
        /* Quebra de linha: desce e volta para o começo da próxima linha */
        const yb = y + alturaCaixa + 4, ym = y + alturaCaixa + 22, x0 = margem + w / 2;
        html += `<path class="dg-seta" d="M${cx} ${yb} V${ym} H${x0} V${ym + 12}"/>` + seta(x0, ym + 10, x0, ym + 16);
      }
    }
  });
  if (rodape) html += linhas(largura / 2, altura - 14, [rodape], "dg-texto");
  return `<svg viewBox="0 0 ${largura} ${altura}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${html}</svg>`;
}

/* QR Code × PUSH: duas colunas que chegam ao passo 4 (token) com valores diferentes no campo "code" */
function qrPush() {
  const W = 980, H = 420, cw = 400, x1 = 40, x2 = W - 40 - cw;
  const coluna = (x, titulo, itens, final, classe) => {
    let h = `<rect class="${classe}" x="${x}" y="20" width="${cw}" height="270" rx="12"/>` + linhas(x + cw / 2, 50, [titulo], "dg-titulo");
    itens.forEach((t, i) => {
      const y = 76 + i * 50;
      h += `<rect class="dg-caixa" x="${x + 20}" y="${y}" width="${cw - 40}" height="38" rx="8"/>` + linhas(x + cw / 2, y + 24, [t], "dg-texto");
      if (i < itens.length - 1) h += seta(x + cw / 2, y + 39, x + cw / 2, y + 49);
    });
    h += seta(x + cw / 2, 291, x + cw / 2, 330) + `<rect class="dg-caixa-forte" x="${x + 40}" y="332" width="${cw - 80}" height="52" rx="10"/>`
      + linhas(x + cw / 2, 352, ["Passo 4 · campo “code”:"], "dg-texto") + linhas(x + cw / 2, 372, [final], "dg-codigo");
    return h;
  };
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">`
    + coluna(x1, "QR CODE", ["HTTP 302 → página com QR Code", "Página vale 2 minutos", "Titular lê com o app VIDaaS", "Redireciona ao redirect_uri com code"], "o code da URL", "dg-caixa-azul")
    + coluna(x2, "PUSH (redirect_uri push://…)", ["Notificação no app — sem QR Code", "Resposta imediata traz um code", "Consulta GET …/authentications?code=", "Aprovado: devolve o authorizationToken"], "o authorizationToken", "dg-caixa-verde")
    + linhas(W / 2, 410, ["Trocar os dois = “código inválido”"], "dg-texto")
    + `</svg>`;
}

export const DIAGRAMAS = {
  oauth: {
    titulo: "Fluxo OAuth 2.0 em 5 passos",
    legenda: "OAuth 2.0: a aplicação do parceiro nunca vê a senha nem a chave privada do titular. O passo 3 é o único que depende do titular.",
    passos: ["**Aplicação se identifica**: `client_id` + `client_secret`.", "**Pede autorização** para o CPF/CNPJ do titular.", "**Titular aprova no celular** (QR Code ou notificação push) — o passo que depende do titular.", "**Troca código por token**: access token temporário.", "**Assina com o token**, dentro do prazo e escopo."],
    svg: fluxo([
      { titulo: ["Aplicação", "se identifica"], codigo: ["client_id +", "client_secret"] },
      { titulo: ["Pede", "autorização"], texto: ["para o CPF/CNPJ", "do titular"] },
      { titulo: ["Titular aprova", "no celular"], texto: ["QR Code ou", "notificação push"], destaque: true },
      { titulo: ["Troca código", "por token"], texto: ["access token", "temporário"] },
      { titulo: ["Assina com", "o token"], texto: ["dentro do prazo", "e escopo"] }
    ], { rodape: "PKCE: code_challenge (S256) na autorização · code_verifier ao pedir o token" })
  },
  "vidaas-5-passos": {
    titulo: "O fluxo VIDaaS em 5 passos",
    legenda: "Cadastro → user-discovery → autorização → token → assinatura.",
    passos: ["**Cadastro da aplicação** — `POST /v0/oauth/application/`: uma única vez; devolve `client_id` e `client_secret`.", "**User-discovery** — `POST /v0/oauth/user-discovery`: o CPF/CNPJ tem certificado? Lista os slots.", "**Autorização** — `GET /v0/oauth/authorize`: titular aprova no app (QR Code ou PUSH).", "**Token** — `POST /v0/oauth/token`: troca o código pelo access token (Bearer).", "**Assinatura** — `POST .../trusted-services/signatures`: envia hashes e recebe as assinaturas."],
    svg: fluxo([
      { titulo: ["Cadastro da", "aplicação"], codigo: ["POST /v0/oauth/", "application/"], texto: ["Uma única vez."] },
      { titulo: ["User-discovery"], codigo: ["POST /v0/oauth/", "user-discovery"], texto: ["Tem certificado?", "Lista os slots."] },
      { titulo: ["Autorização"], codigo: ["GET /v0/oauth/", "authorize"], texto: ["QR Code ou PUSH"], destaque: true },
      { titulo: ["Token"], codigo: ["POST /v0/oauth/", "token"], texto: ["access token", "(Bearer)"] },
      { titulo: ["Assinatura"], codigo: ["POST .../trusted-", "services/signatures"], texto: ["hashes →", "assinaturas"] }
    ], { alturaCaixa: 160 })
  },
  "qr-push": {
    titulo: "Autorização: QR Code × PUSH",
    legenda: "No QR Code, o campo “code” do token leva o code da URL de redirecionamento; no PUSH, leva o authorizationToken.",
    passos: ["**QR Code:** HTTP 302 → página com QR Code, que vale 2 minutos; o titular lê com o app VIDaaS; redireciona ao `redirect_uri` com `code` na URL. No passo 4, o campo `code` leva esse code.", "**PUSH** (`redirect_uri` `push://…`): notificação no app, sem QR Code; a resposta imediata traz um `code` (id da autorização); a aplicação consulta `GET …/authentications?code=`; quando aprovado, devolve o `authorizationToken`. No passo 4, o campo `code` leva o `authorizationToken`.", "Trocar os dois = “código inválido”."],
    svg: qrPush()
  },
  sgact: {
    titulo: "Carimbo do tempo (SGACT) em 4 passos",
    legenda: "Triagem: falha SSL = certificado/cadastro · HTTP ≠ 200 = URL ou Content-Type · status ≠ 0 = TSR malformado.",
    passos: ["**Montar o TSR**: TimeStamp Request com o hash do dado.", "**Canal mTLS**: certificado de cliente + cadeia do servidor.", "**POST binário**: `Content-Type: application/timestamp-query`.", "**Resposta TST**: status 0 = sucesso; traz o nº de série."],
    svg: fluxo([
      { titulo: ["Montar o TSR"], texto: ["TimeStamp Request", "com o hash do dado"] },
      { titulo: ["Canal mTLS"], texto: ["certificado de cliente", "+ cadeia do servidor"], destaque: true },
      { titulo: ["POST binário"], codigo: ["application/", "timestamp-query"] },
      { titulo: ["Resposta TST"], texto: ["status 0 = sucesso", "traz o nº de série"] }
    ], { alturaCaixa: 130, rodape: "Pré-requisito: certificado ICP-Brasil A1/A3 cadastrado no SGACT da Valid" })
  },
  "integraicp-6-passos": {
    titulo: "O fluxo de assinatura do IntegraICP em 6 passos",
    legenda: "PKCE: code_challenge no passo 1 · code_verifier nos passos 5 e 6.",
    passos: ["**Autenticação**: lista de provedores (`GET /authentications`).", "**Escolha do provedor**: o app escolhe a Clearance (`autostart=true` é opcional).", "**Autorização**: o titular autoriza no VIDaaS; o `credentialId` vem na callback.", "**Preparar o hash**: SHA-256 em Base64 (`contentDigest`, 44 caracteres).", "**Assinar**: dividido em blocos de 20 (`POST /signatures`).", "**Consultar credencial**: dados do certificado (`GET /credentials`)."],
    svg: fluxo([
      { titulo: ["Autenticação"], texto: ["Lista de provedores"], codigo: ["GET /authentications"] },
      { titulo: ["Escolha do", "provedor"], texto: ["App escolhe a Clearance"], codigo: ["autostart=true (opcional)"] },
      { titulo: ["Autorização"], texto: ["Titular autoriza no VIDaaS"], codigo: ["credentialId na callback"], destaque: true },
      { titulo: ["Preparar o hash"], texto: ["SHA-256 em Base64"], codigo: ["contentDigest (44 caract.)"] },
      { titulo: ["Assinar"], texto: ["Dividido em blocos de 20"], codigo: ["POST /signatures"] },
      { titulo: ["Consultar", "credencial"], texto: ["Dados do certificado"], codigo: ["GET /credentials"] }
    ], { porLinha: 3, alturaCaixa: 140, rodape: "PKCE: code_challenge no passo 1 · code_verifier nos passos 5 e 6" })
  },
  "api-garcom": {
    titulo: "A API é o garçom",
    legenda: "A API leva o pedido à cozinha e traz a resposta. O cliente nunca entra na cozinha.",
    passos: ["**Pedido (requisição)**: o cliente (app, site) olha o cardápio (a documentação) e faz o pedido.", "**Leva à cozinha**: o garçom (a API) leva o pedido.", "**Prato pronto**: a cozinha (o servidor + banco de dados) prepara.", "**Entrega (resposta)**: o garçom traz o prato. Se o pedido não está no cardápio, “não temos” (404); se a cozinha pega fogo, “estamos com problemas” (500)."],
    svg: fluxo([
      { titulo: ["Pedido"], texto: ["Você (o cliente)", "faz a requisição"], codigo: ["GET /pizzas"] },
      { titulo: ["Leva à cozinha"], texto: ["o garçom", "é a API"], destaque: true },
      { titulo: ["Prato pronto"], texto: ["a cozinha: servidor", "+ banco de dados"] },
      { titulo: ["Entrega"], texto: ["a resposta volta", "para o cliente"], codigo: ["200 OK + JSON"] }
    ], { alturaCaixa: 130, rodape: "O cardápio é a documentação: você nunca entra na cozinha" })
  },
  "oauth-pkce": {
    titulo: "OAuth 2.0: Authorization Code + PKCE",
    legenda: "O app nunca vê a senha do usuário: só recebe um token com permissões limitadas (escopos).",
    passos: ["**“Entrar com Google”**: o usuário clica no app.", "**Redireciona para /authorize**: o app manda o usuário ao servidor de autorização (com o `code_challenge` do PKCE).", "**Login + consentimento**: o usuário faz login e clica em “Permitir” — só ele vê a senha.", "**Devolve o code**: o servidor de autorização volta ao app com `?code=abc123`.", "**POST /token**: o app troca o code (+ `code_verifier` do PKCE) por `access_token` e `refresh_token`.", "**Chama a API**: `GET /perfil` com `Authorization: Bearer <access_token>` → 200 OK."],
    svg: fluxo([
      { titulo: ["“Entrar com", "Google”"], texto: ["o usuário clica", "no app"] },
      { titulo: ["Redireciona"], codigo: ["/authorize", "+ code_challenge"] },
      { titulo: ["Login +", "consentimento"], texto: ["o usuário clica", "“Permitir”"], destaque: true },
      { titulo: ["Devolve o code"], codigo: ["?code=abc123"] },
      { titulo: ["Troca por token"], codigo: ["POST /token", "+ code_verifier"], texto: ["access + refresh"] },
      { titulo: ["Chama a API"], codigo: ["GET /perfil", "Bearer <token>"], texto: ["200 OK"] }
    ], { porLinha: 3, alturaCaixa: 140, rodape: "O app NUNCA vê a senha do usuário: só recebe um token com escopos" })
  },
  "ciclo-vida-api": {
    titulo: "O ciclo de vida de uma API",
    legenda: "Planejar → desenhar → mockar → implementar → publicar → monitorar → evoluir → aposentar.",
    passos: ["**Planejar**: quem usa? para quê?", "**Desenhar**: o contrato OpenAPI.", "**Mockar**: validar com os consumidores.", "**Implementar** e testar.", "**Publicar**: documentação + portal.", "**Monitorar**: métricas e feedback.", "**Evoluir**: novas versões.", "**Aposentar**: cabeçalhos `Deprecation` + `Sunset`."],
    svg: fluxo([
      { titulo: ["Planejar"], texto: ["quem usa?", "para quê?"] },
      { titulo: ["Desenhar"], texto: ["contrato OpenAPI"] },
      { titulo: ["Mockar"], texto: ["validar com", "consumidores"] },
      { titulo: ["Implementar"], texto: ["e testar"] },
      { titulo: ["Publicar"], texto: ["docs + portal"] },
      { titulo: ["Monitorar"], texto: ["métricas e", "feedback"], destaque: true },
      { titulo: ["Evoluir"], texto: ["novas versões"] },
      { titulo: ["Aposentar"], codigo: ["Deprecation", "+ Sunset"] }
    ], { porLinha: 4, alturaCaixa: 110 })
  }
};
