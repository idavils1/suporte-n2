/*
 * Trilha "IntegraICP API v3 — Playbook de suporte" (Aprendizagem - Tire suas dúvidas).
 * Fonte: "Playbook de Suporte IntegraICP.pptx" (15 slides + notas), texto bruto em
 * importacao/aprender/Playbook de Suporte IntegraICP.txt.
 * Cada resposta leva o SELO do material (:::selo validado | a-confirmar | nao-repassar | interno).
 * Ajuste em relação ao material: os volumes e quantidades do Datadog NÃO são publicados
 * (no lugar: "volume alto nos últimos 30 dias"). O módulo de investigação é de uso interno.
 * Depois de publicado, vale o que estiver no Firestore (edite pelo site).
 */
const L = (...linhas) => linhas.join("\n");
const NOTA = (...linhas) => L("> [!nota] Do playbook", ...linhas.map((l) => "> " + l));
const SELO = (tipo, ...linhas) => L(`:::selo ${tipo}`, ...linhas, ":::");
const TRILHA = "integraicp-v3";
const CRIADO = "2026-11-05T10:00:00.000Z";

export const TRILHA_INTEGRAICP = {
  id: TRILHA, nome: "IntegraICP API v3 — Playbook de suporte", categoria: "integracoes", icone: "i-plug", cor: "verde",
  descricao: "Respostas prontas para as dúvidas mais comuns de quem integra o IntegraICP, com o selo de confiabilidade de cada uma.",
  nivel: "Avançado", fontes: "Documentação da API v3 (rev. 22/05/2024) · Q&A interno de 23/10/2026 · logs e APM do VIDaaS no Datadog (30 dias) · Playbook Nov/2026",
  aviso: { texto: "Playbook em validação: 7 pendências com o time do IntegraICP", aula: "ii-pendencias" },
  modulos: [
    { id: "como-usar", nome: "Como usar este playbook", ordem: 1 },
    { id: "fluxo-conceitos", nome: "Fluxo e conceitos", ordem: 2 },
    { id: "faq", nome: "Perguntas frequentes", ordem: 3 },
    { id: "referencia", nome: "Referência rápida", ordem: 4 },
    { id: "investigacao", nome: "Investigação (N2) — USO INTERNO", ordem: 5 },
    { id: "escalonamento", nome: "Escalonamento", ordem: 6 },
    { id: "pendencias", nome: "Pendências", ordem: 7 }
  ],
  atualizadoEm: CRIADO
};

const aula = (id, modulo, ordem, nivel, titulo, resumo, palavrasChave, blocos) => ({
  id, trilha: TRILHA, modulo, paiId: null, ordem, nivel, titulo, resumo, palavrasChave, blocos, atualizadoEm: CRIADO
});

export const AULAS_INTEGRAICP = [
  /* ---------------- Módulo 1 · Como usar ---------------- */
  aula("ii-como-usar", "como-usar", 1, "Básico", "Como usar este playbook: os selos",
    "Cada resposta tem um selo. Só repasse ao cliente o que estiver como Validado.",
    ["playbook", "selo", "validado", "a confirmar", "não repassar", "integraicp", "api v3"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Cada resposta tem um **selo**. Só repasse ao cliente o que estiver como **Validado**." },
      { id: "objetivo", titulo: "Para que serve", icone: "i-livro", markdown: L(
        "**Playbook de Suporte · IntegraICP · API v3** — material de treinamento (Nov/2026).",
        "",
        NOTA("Objetivo: dar ao Suporte respostas prontas para as dúvidas mais comuns de quem integra o IntegraICP. Tudo foi conferido na documentação oficial da API v3, no Q&A interno de 23/10 e nos logs do VIDaaS no Datadog. O que ainda depende de confirmação está separado no final ([Pendências](#ii-pendencias)).")) },
      { id: "selos", titulo: "Os selos", icone: "i-tag", markdown: L(
        SELO("validado", "**Validado** — confirmado na documentação oficial ou nos logs do VIDaaS.", "", "**Repassar: sim.**"),
        "",
        SELO("a-confirmar", "**A confirmar** — informado pelo time, mas sem respaldo na doc ou nos logs.", "", "**Repassar: só com a ressalva “conforme orientação atual”.**"),
        "",
        SELO("nao-repassar", "**Não repassar** — diverge da documentação oficial ou dos logs.", "", "**Repassar: não — escalar.**"),
        "",
        "Nas aulas, use o botão **“Mostrar só o que posso repassar ao cliente”** para esconder o que é “Não repassar” e “Uso interno”.") },
      { id: "fontes", titulo: "Fontes", icone: "i-documento", markdown: L(
        "- Documentação da API v3 (rev. 22/05/2024)",
        "- Q&A interno de 23/10/2026",
        "- Logs e APM do VIDaaS no Datadog (30 dias)",
        "",
        NOTA("O selo é a regra mais importante do playbook. Um “A confirmar” pode ser dito com ressalva; um “Não repassar” sempre vira escalonamento. O Datadog da Valid mostra o lado do VIDaaS como provedor; os códigos próprios do IntegraICP não aparecem lá.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-fluxo, ii-pendencias, integracao, api" }
    ]),

  /* ---------------- Módulo 2 · Fluxo e conceitos ---------------- */
  aula("ii-fluxo", "fluxo-conceitos", 1, "Intermediário", "O fluxo de assinatura em 6 passos",
    "Autenticação, escolha do provedor, autorização, hash, assinatura e consulta da credencial — com o PKCE nos passos 1, 5 e 6.",
    ["fluxo", "6 passos", "authentications", "clearance", "autostart", "credentialid", "contentdigest", "signatures", "credentials", "pkce", "broker"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O **IntegraICP é um broker**: reúne VIDaaS, BirdID e outros atrás de uma única API. A aplicação do cliente **nunca fala direto com o provedor**." },
      { id: "passos", titulo: "Os 6 passos", icone: "i-engrenagem", markdown: L(
        ":::diagrama integraicp-6-passos",
        "",
        "| Passo | O que acontece | Detalhe |",
        "| --- | --- | --- |",
        "| **1 · Autenticação** | Lista de provedores | `GET /authentications` |",
        "| **2 · Escolha do provedor** | App escolhe a Clearance | `autostart=true` (opcional) |",
        "| **3 · Autorização** | Titular autoriza no VIDaaS | `credentialId` na callback |",
        "| **4 · Preparar o hash** | SHA-256 em Base64 | `contentDigest` (44 caract.) |",
        "| **5 · Assinar** | Dividido em blocos de 20 | `POST /signatures` |",
        "| **6 · Consultar credencial** | Dados do certificado | `GET /credentials` |",
        "{tabela: largura=total}",
        "",
        "> [!atencao] PKCE",
        "> `code_challenge` no **passo 1** · `code_verifier` nos **passos 5 e 6**.") },
      { id: "chamados", titulo: "Onde nascem os chamados", icone: "i-alerta", markdown: NOTA("A maioria dos chamados nasce em três pontos: o PKCE trocado entre os passos 1 e 5, o hash no formato errado no passo 4 e os limites do passo 5.") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-conceitos, ii-codigos-erro, vs-oauth, PKCE, Clearance, credentialId, contentDigest" }
    ]),
  aula("ii-conceitos", "fluxo-conceitos", 2, "Intermediário", "Conceitos que o suporte precisa dominar",
    "Channel, Clearance, subject_key, credentialId, PKCE, contentDigest, contentId e signaturePolicy — e o erro típico de cada um.",
    ["channel", "clearance", "subject_key", "credentialid", "pkce", "contentdigest", "contentid", "signaturepolicy", "raw", "cms", "secret_data", "403201", "400204", "400101"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Oito termos explicam quase todos os erros: para cada um, **o que é** e o **erro típico do cliente**." },
      { id: "tabela", titulo: "Termo · O que é · Erro típico", icone: "i-tabela", markdown: L(
        SELO("validado",
          "| Termo | O que é | Erro típico do cliente |",
          "| --- | --- | --- |",
          "| **Channel** | API-Key da aplicação; define provedores | Channel errado → `400101` |",
          "| **Clearance** | Provedor apto a autenticar o titular | Achar que lista todo o mercado |",
          "| **subject_key** | CPF do titular, só números | Enviar com máscara ou CNPJ |",
          "| **credentialId** | ID devolvido na `callback_uri` | Reusar após expirar → `403` |",
          "| **PKCE** | Par challenge (passo 1) / verifier (5 e 6) | Mesmo valor nas duas etapas → `403201` |",
          "| **contentDigest** | SHA-256 em Base64 padrão, 44 caracteres | Hex ou Base64 URL-safe → `400204` |",
          "| **contentId** | ID livre para correlacionar cada item | Achar que evita duplicidade |",
          "| **signaturePolicy** | RAW (hash puro) ou CMS (PKCS#7) | Política diferente da do Channel |",
          "{tabela: listrada largura=total}")) },
      { id: "atencao", titulo: "Cuidado com os exemplos da documentação", icone: "i-alerta", markdown: L(
        "> [!atencao] Atenção",
        "> Os exemplos da doc oficial repetem o **mesmo `secret_data`** na autenticação e na consulta de credencial — causa comum do `403201`.",
        "",
        NOTA("Todos os termos estão validados na documentação oficial. O erro de PKCE é o mais traiçoeiro porque a própria documentação induz ao erro nos exemplos.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-fluxo, ii-codigos-erro, Channel, Clearance, subject_key, credentialId, PKCE, contentDigest, CMS" }
    ]),

  /* ---------------- Módulo 3 · Perguntas frequentes ---------------- */
  aula("ii-faq-autenticacao", "faq", 1, "Intermediário", "FAQ: autenticação e credencial",
    "Por que só aparece o VIDaaS, lista vazia, CNPJ e os erros 403/404 na credencial.",
    ["faq", "autenticação", "credencial", "unavailable_clearances", "subject_key", "cnpj", "403", "404", "prospecção", "clearance", "168 h", "24 h"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "As dúvidas de **autenticação e credencial** se resolvem pelo `subject_key`, pelo Channel e pelo `credentialId` — confira o selo antes de repassar." },
      { id: "respostas", titulo: "Perguntas e respostas", icone: "i-ajuda", markdown: L(
        SELO("validado", "#### Por que só aparece o VIDaaS?", "Com `subject_key`: só provedores em que o CPF tem certificado ativo. Sem `subject_key`: todos os habilitados no Channel."),
        "",
        SELO("validado", "#### A lista de provedores veio vazia", "`UNAVAILABLE_CLEARANCES`: o CPF não tem certificado em nenhum provedor do Channel. Confira o CPF (só números)."),
        "",
        SELO("nao-repassar", "#### Funciona com CNPJ?", "A doc aceita só CPF em `subject_type`; o Q&A fala em CPF/CNPJ. **Escale pedidos de CNPJ.**"),
        "",
        SELO("validado", "#### Recebi 403 ou 404 na credencial", "**403**: `code_verifier` errado ou credencial expirada. **404**: `credentialId` inexistente ou de outro Channel.")) },
      { id: "doc", titulo: "Também validado na documentação", icone: "i-documento", markdown: SELO("validado",
        "Quando o titular tem mais de um certificado, o IntegraICP faz uma **“Assinatura de Prospecção”**, uma vez por sessão, que aparece no histórico do provedor.",
        "",
        "Validades: **clearance até 24 h**, **credencial até 168 h**.") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-conceitos, ii-codigos-erro, ii-pendencias, subject_key, Clearance, credentialId, Channel" }
    ]),
  aula("ii-faq-lote", "faq", 2, "Intermediário", "FAQ: assinatura em lote",
    "Itens por chamada, falha de um item, idempotência e timeout.",
    ["faq", "lote", "20 itens", "contentid", "idempotência", "timeout", "60 s", "reenvio", "cobrança"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "No lote, **cada hash é processado separadamente**, **não há idempotência** e o **timeout sempre escala** — nunca reenviar automático." },
      { id: "respostas", titulo: "Perguntas e respostas", icone: "i-ajuda", markdown: L(
        SELO("validado", "#### Quantos itens por chamada?", "O VIDaaS aceita **até 20 por requisição**; o IntegraICP divide lotes maiores automaticamente."),
        "",
        SELO("validado", "#### Um item falhou: perco o lote?", "_(No material: “Validado pelo time”.)_", "", "Não. Cada hash é processado separadamente. **Reenvie só o item que falhou**, comparando os `contentId`."),
        "",
        SELO("validado", "#### Existe idempotência?", "Não. O `contentId` só correlaciona; **um reenvio gera nova assinatura — e nova cobrança**."),
        "",
        SELO("a-confirmar", "#### Deu timeout: foi assinado?", "Não há consulta posterior. Timeout do cliente de **no mínimo 60 s** e **nunca reenviar automático**. **Escalar.**")) },
      { id: "datadog", titulo: "O que os logs mostram", icone: "i-info", markdown: NOTA("No Datadog confirmamos que o VIDaaS executa cada item do lote separadamente. Em 30 dias não houve falha parcial num lote com vários itens, então o retorno parcial ainda não foi observado na prática. Tempo típico das chamadas do IntegraICP ao VIDaaS: 0,3 a 1,4 s.") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-limites, ii-escalonamento, ii-pendencias, Idempotência, Rate limit" }
    ]),
  aula("ii-faq-pdf", "faq", 3, "Avançado", "FAQ: PDF, PAdES e cadeia",
    "Como inserir o CMS no PDF, os perfis PAdES/carimbo do tempo e o que vem na resposta.",
    ["faq", "pdf", "pades", "cms", "cades_ad_rt", "byterange", "contents", "itext", "pdfbox", "cadeia", "aia", "carimbo do tempo"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Para PDF, o cliente **reserva o espaço**, envia o **SHA-256 do ByteRange** com `signaturePolicy` **CMS** e **insere o CMS** retornado no `/Contents`." },
      { id: "respostas", titulo: "Perguntas e respostas", icone: "i-ajuda", markdown: L(
        SELO("validado", "#### Inserir o CMS no PDF",
          "1. Reservar o espaço da assinatura no PDF.",
          "2. Enviar o SHA-256 do **ByteRange** com `signaturePolicy` **CMS**.",
          "3. Inserir o CMS retornado no `/Contents`.",
          "",
          "Java: **iText 7** ou **Apache PDFBox**. O exemplo de referência pode ser pedido ao time."),
        "",
        SELO("a-confirmar", "#### Perfis PAdES e carimbo do tempo", "**CMS**: sem política e sem carimbo. **CAdES_AD_RT**: o Verificador do ITI reconhece, segundo o time, mas a política não está na doc oficial."),
        "",
        SELO("validado", "#### A resposta traz a cadeia?", "Não, só o certificado do signatário. Intermediárias e Raiz: extensão **AIA** ou repositório do **ITI**.")) },
      { id: "raw", titulo: "Com RAW", icone: "i-info", markdown: NOTA("Com RAW, o cliente monta o CMS e pode atingir qualquer perfil, cuidando do carimbo do tempo e dos dados de validação. A política CAdES_AD_RT segue a confirmar até entrar na documentação oficial.") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "cadeia-certificacao, campo-aia, vs-sgact, ii-pendencias, CMS, PAdES, CAdES, AIA" }
    ]),

  /* ---------------- Módulo 4 · Referência rápida ---------------- */
  aula("ii-limites", "referencia", 1, "Intermediário", "Limites operacionais",
    "20 itens, 44 caracteres, 60 s, 24 h e 168 h — e o rate limit que ainda não pode ser repassado.",
    ["limites", "20 itens", "rate limit", "429", "413", "44 caracteres", "60 s", "45 s", "24 h", "168 h", "7 dias"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Os números que o suporte mais usa — cada um com o seu selo." },
      { id: "limites", titulo: "Os limites", icone: "i-tabela", markdown: L(
        SELO("validado", "**20** — itens por requisição; o broker divide lotes maiores."),
        "",
        SELO("nao-repassar", "**50 ou 100** — por titular: o Q&A diz 50/min, os logs do VIDaaS 100/conta."),
        "",
        SELO("validado", "**44** — caracteres do SHA-256 em Base64 padrão."),
        "",
        SELO("a-confirmar", "**60 s** — timeout mínimo no cliente; o broker espera até 45 s."),
        "",
        SELO("validado", "**24 h** — validade máxima da clearance."),
        "",
        SELO("validado", "**168 h** — validade máxima da credencial (7 dias).")) },
      { id: "orientacao", titulo: "Enquanto o rate limit não for confirmado", icone: "i-alerta", markdown: NOTA("Enquanto o rate limit não for confirmado, oriente o cliente a espalhar as assinaturas de um mesmo titular e a tratar HTTP 429 com espera antes de nova tentativa, nunca com reenvio imediato. Também há limite de tamanho da requisição (HTTP 413), valor não registrado.") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-faq-lote, ii-codigos-erro, ii-pendencias, Rate limit, contentDigest, Clearance, credentialId" }
    ]),
  aula("ii-codigos-erro", "referencia", 2, "Intermediário", "Códigos de erro do IntegraICP",
    "O que o cliente vê — documentado na API v3: HTTP, código, significado e o que orientar.",
    ["códigos de erro", "erro", "400101", "400204", "403201", "404000", "unavailable_clearances", "302", "429", "413", "invalid channel", "credential not found", "pkce inválido"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "A tabela abaixo é **o que o cliente vê** — documentado na API v3 (**Validado**). Comece sempre pelo HTTP e pelo código." },
      { id: "tabela", titulo: "HTTP · Código · Significado · O que orientar", icone: "i-tabela", markdown: L(
        SELO("validado",
          "| HTTP | Código | Significado | O que orientar |",
          "| --- | --- | --- | --- |",
          "| 400 | `400101` | Invalid Channel | Conferir o channelId na URL |",
          "| 400 | `400204` | Hash fora do padrão | SHA-256 em Base64, 44 caracteres |",
          "| 403 | `403201` | PKCE inválido | Enviar o code_verifier correto |",
          "| 404 | `404000` | Credential Not Found | Usar o credentialId da callback |",
          "| 200 | `UNAVAILABLE_CLEARANCES` | Lista de provedores vazia | Conferir CPF e certificado ativo |",
          "| 302 | — | Redirecionamento | Esperado com autostart=true |",
          "{tabela: listrada largura=total legenda=\"Códigos de erro do IntegraICP (API v3)\"}")) },
      { id: "sem-codigo", titulo: "Sem código documentado", icone: "i-alerta", markdown: L(
        SELO("a-confirmar", "Sem código documentado: **429** (rate limit), **413** (requisição grande) e a resposta em caso de **timeout**. O catálogo completo está nas [pendências](#ii-pendencias)."),
        "",
        NOTA("Esta é a camada que o cliente enxerga. A [causa raiz](#ii-causa-raiz) desses erros, quando o provedor é o VIDaaS, o N2 consegue confirmar no Datadog.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-diagnostico, ii-conceitos, ii-causa-raiz, Channel, PKCE, contentDigest, credentialId, Clearance" }
    ]),
  aula("ii-diagnostico", "referencia", 3, "Intermediário", "Diagnóstico rápido",
    "Comece pelo HTTP e pelo código que o cliente recebeu: primeira ação e quem resolve.",
    ["diagnóstico", "triagem", "400101", "400204", "403201", "404000", "429", "invalid request data", "timeout", "n1", "n2", "escalar"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "**Comece pelo HTTP e pelo código** que o cliente recebeu: a tabela diz a primeira ação e quem resolve." },
      { id: "tabela", titulo: "Cliente recebeu · Primeira ação · Quem", icone: "i-tabela", markdown: L(
        "| Cliente recebeu | Primeira ação | Quem |",
        "| --- | --- | --- |",
        "| `400101` Invalid Channel | Conferir o Channel do cliente | N1 |",
        "| `400204` / hash size is not 32 bytes | SHA-256 em Base64 padrão, 44 caracteres | N1 |",
        "| `403201` / Access token not found | Refazer a autenticação com um par PKCE novo | N1 |",
        "| `404000` Credential Not Found | Usar o credentialId da callback, no mesmo Channel | N1 |",
        "| Lista de provedores vazia | Conferir o CPF (só números) e o certificado ativo | N1 |",
        "| 400 Invalid request data | Ver no Datadog o payload que chegou ao VIDaaS | N2 |",
        "| 429 Too many requests | Confirmar no Datadog; aguardar antes de nova tentativa | N2 |",
        "| Timeout sem resposta | Orientar a não reenviar o lote | Escalar |",
        "{tabela: listrada largura=total}") },
      { id: "ressalva", titulo: "O que ainda está em confirmação", icone: "i-alerta", markdown: L(
        SELO("a-confirmar", "Os casos de **429** e **Invalid request data** vêm dos logs do VIDaaS; o código exato que o IntegraICP devolve nesses casos ainda está em confirmação."),
        "",
        NOTA("O N1 resolve a maioria pelo código. Timeout sempre escala, porque há risco de assinatura e cobrança duplicadas.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-codigos-erro, ii-datadog, ii-escalonamento, PKCE, Channel, Rate limit" }
    ]),

  /* ---------------- Módulo 5 · Investigação (N2) — uso interno ---------------- */
  aula("ii-causa-raiz", "investigacao", 1, "Avançado", "Causa raiz no VIDaaS (uso interno)",
    "Os tipos de erro em POST /signatures vistos no Datadog e a causa de cada um — para a investigação N2.",
    ["causa raiz", "datadog", "429", "403", "400", "413", "too many requests", "access token not found", "error during signature operation", "invalid request data", "request.body.size.limit.rejected", "hash size is not 32 bytes", "uso interno"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: SELO("interno", "Erros em `POST /signatures` de **todas as aplicações** que usam o VIDaaS, nos últimos 30 dias (Datadog): os **tipos** e as **causas**, para o N2 ligar ao que o cliente viu.") },
      { id: "erros", titulo: "Tipos de erro e causas", icone: "i-tabela", markdown: SELO("interno",
        "Todos com **volume alto nos últimos 30 dias**, do mais para o menos frequente:",
        "",
        "| HTTP | Mensagem | Causa |",
        "| --- | --- | --- |",
        "| 429 | Too many requests | Rate limit por titular (100 por conta) |",
        "| 403 | Access token not found | Autorização expirada ou inexistente |",
        "| 400 | Error during signature operation | Erro genérico; ex.: hash com 200 bytes em vez de 32 |",
        "| 400 | Invalid request data | Payload malformado |",
        "| 413 | `request.body.size.limit.rejected` | Requisição grande demais |",
        "{tabela: listrada largura=total}",
        "",
        "Aplicações do IntegraICP: assinaturas CMS nos últimos 14 dias **sem erro registrado**.") },
      { id: "ligacao", titulo: "Como ligar as duas camadas", icone: "i-info", markdown: SELO("interno",
        "Os volumes são de **todas as aplicações** que usam o VIDaaS, não só do IntegraICP. O erro **“hash size is not 32 bytes”** aparece junto do 400 genérico e é a provável origem do `400204` do IntegraICP. A ligação entre as duas camadas ainda depende do catálogo oficial do IntegraICP ([pendência 5](#ii-pendencias)).") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-datadog, ii-codigos-erro, ii-diagnostico, Rate limit, trace_id" }
    ]),
  aula("ii-datadog", "investigacao", 2, "Avançado", "Como investigar no Datadog (N2)",
    "Passo a passo para achar o client_id, as assinaturas e os erros, e o que registrar no chamado.",
    ["datadog", "investigação", "n2", "client_id", "valid-tsp-api-authorizations", "valid-tsp-api-signatures", "apm", "trace_id", "ratelimit acc", "limit = 20", "hash size is not 32 bytes", "token invalid or not found", "keyexportthrottle", "uso interno"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: SELO("interno", "O Datadog da Valid mostra **o lado do VIDaaS como provedor**. Sempre registre o **trace_id** antes de escalar.") },
      { id: "passos", titulo: "Passo a passo", icone: "i-lista", markdown: SELO("interno",
        ":::passo 1",
        "**Achar o client_id:** `valid-tsp-api-authorizations`, buscando “`services.integraicp.com.br`”.",
        ":::",
        "",
        ":::passo 2",
        "**Ver as assinaturas:** `valid-tsp-api-signatures` + o `client_id`.",
        ":::",
        "",
        ":::passo 3",
        "**Erros em APM:** `POST /signatures` com status ≥ 400, agrupados por mensagem.",
        ":::",
        "",
        ":::passo 4",
        "**Registrar no chamado:** `trace_id`, horário e mensagem encontrada.",
        ":::") },
      { id: "termos-log", titulo: "Termos para buscar no log", icone: "i-busca", markdown: SELO("interno",
        "| Buscar | Indica |",
        "| --- | --- |",
        "| `RATELIMIT ACC` | rate limit por titular |",
        "| `limit = 20` | lote acima do limite |",
        "| `hash size is not 32 bytes` | hash em formato errado |",
        "| `Token invalid or not found` | autorização expirada |",
        "",
        "Sucesso aparece como “**Signature DONE**” e “**Sending signature response**”.") },
      { id: "atencao", titulo: "Atenção", icone: "i-alerta", markdown: SELO("interno",
        "> [!atencao] Dados pessoais nos logs",
        "> `KeyExportThrottle` **não tem relação** com o IntegraICP. Os logs contêm **CPF**: trate como dado pessoal e não copie para canais abertos.") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-causa-raiz, ii-diagnostico, ii-escalonamento, trace_id, Rate limit" }
    ]),

  /* ---------------- Módulo 6 · Escalonamento ---------------- */
  aula("ii-escalonamento", "escalonamento", 1, "Intermediário", "Escalonamento",
    "O que coletar do cliente e quem resolve cada situação.",
    ["escalonamento", "escalar", "coletar", "channelid", "requestid", "credentialid", "contentdigest", "timeout", "n1", "n2", "sla"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Sem os dados do checklist o time técnico **devolve o chamado**: colete tudo antes de escalar." },
      { id: "coletar", titulo: "O que coletar do cliente", icone: "i-check", markdown: L(
        "- [ ] Cliente e `channelId`",
        "- [ ] Endpoint chamado",
        "- [ ] Data e hora, com fuso",
        "- [ ] HTTP status, `code` e `message`",
        "- [ ] `requestId` ou `credentialId`",
        "- [ ] Itens no lote e `signaturePolicy`",
        "- [ ] Um `contentDigest` (**nunca o documento**)",
        "- [ ] Timeout do cliente HTTP") },
      { id: "quem", titulo: "Quem resolve", icone: "i-pessoas", markdown: L(
        "| Situação | Nível |",
        "| --- | --- |",
        "| Conceito ou código documentado | N1 resolve |",
        "| Sem código, 429, 413, lote parcial | N2 no Datadog |",
        "| Timeout com risco de duplicidade | Escalar |",
        "| CNPJ, CAdES_AD_RT, PAdES | Escalar |",
        "| Suspeita de falha no IntegraICP | Escalar |",
        "{tabela: listrada largura=total}",
        "",
        SELO("a-confirmar", "**A definir:** destino do escalonamento (squad, canal e SLA) — [pendência 7](#ii-pendencias).")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-diagnostico, ii-datadog, ii-pendencias, credentialId, contentDigest, Channel" }
    ]),

  /* ---------------- Módulo 7 · Pendências ---------------- */
  aula("ii-pendencias", "pendencias", 1, "Básico", "Pendências antes da publicação",
    "Sete pontos para fechar com o time do IntegraICP. Até lá, vale a regra dos selos.",
    ["pendências", "a confirmar", "cades_ad_rt", "cnpj", "rate limit", "signaturesresult", "catálogo de erros", "timeout", "escalonamento", "sla"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "**7 pontos para fechar com o time do IntegraICP** antes de publicar o playbook para o Suporte. Até essas respostas chegarem, o Suporte segue os selos: “A confirmar” com ressalva e “Não repassar” sempre escalado." },
      { id: "lista", titulo: "As 7 pendências", icone: "i-lista", markdown: L(
        SELO("a-confirmar", "**1 · CAdES_AD_RT em produção e na doc oficial** — por que importa: libera resposta sobre PAdES e carimbo do tempo."),
        "",
        SELO("a-confirmar", "**2 · CNPJ é aceito como subject_key?** — por que importa: a doc diz só CPF; hoje escalamos."),
        "",
        SELO("a-confirmar", "**3 · Rate limit: 50/min ou 100/conta? Qual janela e código?** — por que importa: orientar retry e identificar o erro."),
        "",
        SELO("a-confirmar", "**4 · Como o item falho aparece no SignaturesResult** — por que importa: orientar o reenvio só do item."),
        "",
        SELO("a-confirmar", "**5 · Catálogo completo de erros do IntegraICP** — por que importa: fechar a tabela de erros em duas camadas."),
        "",
        SELO("a-confirmar", "**6 · Consulta após timeout (assinatura e cobrança)** — por que importa: evitar assinatura e cobrança duplicadas."),
        "",
        SELO("a-confirmar", "**7 · Destino do escalonamento: squad, canal e SLA** — por que importa: fechar o fluxo N1 → N2 → time técnico.")) },
      { id: "resolvido", titulo: "Já resolvido com o time", icone: "i-sucesso", markdown: L(
        SELO("validado", "- O IntegraICP **divide lotes acima de 20 itens**.", "- A **falha de um item não afeta os demais**.", "- O Verificador do ITI **reconhece a política CAdES AD-RT**."),
        "",
        NOTA("Os três primeiros itens bloqueiam respostas que clientes já pedem. O exemplo de referência em Java (iText/PDFBox) entra como anexo quando estiver disponível.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "ii-como-usar, ii-faq-pdf, ii-limites, ii-escalonamento, CAdES, subject_key, Rate limit" }
    ])
];
