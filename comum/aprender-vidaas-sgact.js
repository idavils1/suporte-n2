/*
 * Trilha "VIDaaS e Carimbo do Tempo (SGACT) — suporte a parceiros" (Aprendizagem - Tire suas dúvidas).
 * Fonte: "Treinamento suporte VIDaaS SGACT.pptx" (18 slides + notas), texto bruto em
 * importacao/aprender/Treinamento suporte VIDaaS SGACT.txt. O material cita: Manual VIDaaS v1.5,
 * Manual SGACT/TST v1.02 e Postman Collection PSC API v1.4.
 * Ajustes em relação ao material: client_id/client_secret do exemplo são FICTÍCIOS; o "quiz" saiu
 * (o site não tem testes); "leia a apostila" virou "Material complementar: peça ao time".
 * Depois de publicado, vale o que estiver no Firestore (edite pelo site).
 */
const L = (...linhas) => linhas.join("\n");
const NOTA = (...linhas) => L("> [!nota] Do treinamento", ...linhas.map((l) => "> " + l));
const COMPLEMENTAR = "> [!info] Material complementar\n> A apostila e o Guia Rápido do treinamento complementam estas aulas: peça ao time.";
const TRILHA = "vidaas-sgact";
const CRIADO = "2026-11-05T10:00:00.000Z";

export const TRILHA_VIDAAS_SGACT = {
  id: TRILHA, nome: "VIDaaS e Carimbo do Tempo (SGACT) — suporte a parceiros", categoria: "produtos", icone: "i-plug", cor: "azul",
  descricao: "Para atender desenvolvedores parceiros que integram com a API do Valid PSC: VIDaaS (assinatura com certificado em nuvem) e SGACT (carimbo do tempo).",
  nivel: "Intermediário", fontes: "Manual VIDaaS v1.5 · Manual SGACT/TST v1.02 · Postman Collection PSC API v1.4 (material de capacitação do Suporte N1/N2)",
  modulos: [
    { id: "visao-geral", nome: "Visão geral", ordem: 1 },
    { id: "fundamentos", nome: "Fundamentos", ordem: 2 },
    { id: "fluxo-vidaas", nome: "O fluxo VIDaaS em 5 passos", ordem: 3 },
    { id: "carimbo-tempo", nome: "Carimbo do tempo (SGACT/TST)", ordem: 4 },
    { id: "ferramentas", nome: "Ferramentas: collection Postman", ordem: 5 },
    { id: "atendimento", nome: "Atendimento", ordem: 6 }
  ],
  atualizadoEm: CRIADO
};

const aula = (id, modulo, ordem, nivel, titulo, resumo, palavrasChave, blocos) => ({
  id, trilha: TRILHA, modulo, paiId: null, ordem, nivel, titulo, resumo, palavrasChave, blocos, atualizadoEm: CRIADO
});

export const AULAS_VIDAAS_SGACT = [
  /* ---------------- Módulo 1 · Visão geral ---------------- */
  aula("vs-objetivos", "visao-geral", 1, "Básico", "Objetivos do treinamento",
    "Material de capacitação do Suporte N1/N2 para atender parceiros que integram com a API do Valid PSC.",
    ["treinamento", "objetivos", "vidaas", "sgact", "psc", "parceiros", "n1", "n2"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Capacitar o suporte a atender **desenvolvedores parceiros** que integram com o **VIDaaS** (assinatura com certificado em nuvem) e com o **SGACT** (carimbo do tempo), na API do **Valid PSC**." },
      { id: "material", titulo: "Sobre este material", icone: "i-livro", markdown: L(
        "**MATERIAL DE CAPACITAÇÃO — SUPORTE N1 / N2**",
        "",
        "**VIDaaS — Certificado em Nuvem e Carimbo do Tempo (SGACT)**",
        "",
        "Suporte a desenvolvedores parceiros na integração com a API do Valid PSC.",
        "",
        "Baseado em: **Manual VIDaaS v1.5** · **Manual SGACT/TST v1.02** · **Postman Collection PSC API v1.4**.",
        "",
        COMPLEMENTAR) },
      { id: "objetivos", titulo: "O que você vai dominar", icone: "i-trofeu", markdown: L(
        ":::passo 1",
        "**Entender os produtos** — o que são VIDaaS e SGACT e para que os parceiros os usam.",
        ":::",
        "",
        ":::passo 2",
        "**Decorar o fluxo de 5 passos** — Cadastro → user-discovery → autorização → token → assinatura.",
        ":::",
        "",
        ":::passo 3",
        "**Diagnosticar por etapa** — reconhecer em que passo o cliente travou e as causas mais comuns.",
        ":::",
        "",
        ":::passo 4",
        "**Atender e escalar bem** — coletar as informações certas e saber quando escalar para a Valid.",
        ":::") },
      { id: "papeis", titulo: "N1 e N2: o foco de cada um", icone: "i-pessoas", markdown: L(
        "| Nível | Foco |",
        "| --- | --- |",
        "| **N1** | Triagem: reconhecer **produto**, **ambiente** e **etapa**. |",
        "| **N2** | Análise técnica: **reproduzir chamadas no Postman** e orientar correções de integração. |",
        "",
        NOTA("Boas-vindas. Objetivo do treinamento: capacitar o suporte a atender desenvolvedores parceiros que integram com o VIDaaS (assinatura com certificado em nuvem) e com o SGACT (carimbo do tempo).")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-produtos, vs-fluxo, vidaas, vidaas-connect, PSC, TST" }
    ]),
  aula("vs-produtos", "visao-geral", 2, "Básico", "Os produtos: VIDaaS × SGACT",
    "Dois serviços independentes, com URLs, autenticação e erros diferentes: assinatura em nuvem e carimbo do tempo.",
    ["vidaas", "sgact", "carimbo do tempo", "tst", "rfc 3161", "mtls", "oauth", "triagem"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "**Dois serviços, dois tipos de chamado:** o **VIDaaS** assina com certificado em nuvem (OAuth 2.0 + app no celular) e o **SGACT** emite **carimbo do tempo** (mTLS + requisição binária RFC 3161)." },
      { id: "comparacao", titulo: "VIDaaS × SGACT", icone: "i-tabela", markdown: L(
        "| | VIDaaS | SGACT |",
        "| --- | --- | --- |",
        "| **O que é** | Certificado digital em nuvem (Valid PSC) | Carimbo do tempo — TST (RFC 3161) |",
        "| **Para que serve** | A aplicação do parceiro integra via **API OAuth 2.0** para assinar documentos | Prova que um documento **existia em determinada data/hora** |",
        "| **Como funciona** | A **chave privada** do titular fica na nuvem da Valid; o titular **autoriza cada uso pelo app VIDaaS** (QR Code ou push) | A aplicação envia o **hash** e recebe o **Time-Stamp Token (TST)** |",
        "| **Autenticação** | OAuth 2.0 + app no celular | Conexão exige **mTLS**: certificado ICP-Brasil cadastrado no SGACT |",
        "{tabela: listrada largura=total}") },
      { id: "triagem", titulo: "Primeira pergunta da triagem", icone: "i-ajuda", markdown: L(
        "> [!dica] Primeira pergunta da triagem",
        "> O chamado é de **VIDaaS** (assinatura) ou de **carimbo do tempo**?",
        "",
        NOTA("Deixe claro que são serviços independentes, com URLs, autenticação e erros diferentes. VIDaaS = OAuth + app no celular. SGACT = mTLS + requisição binária RFC 3161.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vidaas, vidaas-connect, vs-sgact, vs-oauth, OAuth 2.0, mTLS, TST, RFC 3161" }
    ]),

  /* ---------------- Módulo 2 · Fundamentos ---------------- */
  aula("vs-conceitos", "fundamentos", 1, "Básico", "Conceitos do dia a dia",
    "Certificado digital, PSC/nuvem, hash e assinatura digital: os termos que aparecem em todo chamado.",
    ["certificado digital", "psc", "nuvem", "hash", "sha-256", "assinatura digital", "a1", "a3"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Quatro conceitos sustentam todo o atendimento: **certificado digital**, **PSC/nuvem**, **hash** e **assinatura digital**." },
      { id: "conceitos", titulo: "Conceitos que você vai ouvir todo dia", icone: "i-livro", markdown: L(
        "| Conceito | O que é | Para aprofundar |",
        "| --- | --- | --- |",
        "| **Certificado digital** | Identidade eletrônica (e-CPF/e-CNPJ) na cadeia ICP-Brasil. Tipos **A1** (arquivo) e **A3** (mídia/nuvem). | [O que é o certificado digital?](#certificado-digital) · [A1, A3 e nuvem](#certificado-tipos) |",
        "| **PSC / nuvem** | Prestador de Serviço de Confiança: guarda a chave privada. O titular autoriza o uso pelo app VIDaaS. | [VIDaaS](#vidaas) |",
        "| **Hash** | “Impressão digital” do documento (ex.: SHA-256). É o hash que se assina — não o arquivo. | [Hash](#hash-sha) |",
        "| **Assinatura digital** | Chave privada aplicada sobre o hash. Qualquer alteração no documento invalida a assinatura. | [Assinatura digital × eletrônica](#assinatura-digital-eletronica) |",
        "{tabela: largura=total}") },
      { id: "reforco", titulo: "Reforce com o cliente", icone: "i-alerta", markdown: L(
        "> [!atencao] Em nuvem, a senha nunca vai para a aplicação do parceiro",
        "> Em nuvem o titular **NUNCA** informa senha do certificado à aplicação do parceiro — tudo passa pelo **app VIDaaS**.",
        "",
        NOTA("Glossário completo na seção 3 da apostila (material complementar: peça ao time). Aqui no site, os termos estão no [Glossário A–Z](#glossario).")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "certificado-digital, certificado-tipos, assinatura-digital-eletronica, hash-sha, vidaas, PSC, Hash, Assinatura digital" }
    ]),
  aula("vs-oauth", "fundamentos", 2, "Intermediário", "OAuth 2.0 sem mistério",
    "O mesmo padrão do “Entrar com Google”: a aplicação do parceiro nunca vê a senha nem a chave privada do titular.",
    ["oauth", "oauth 2.0", "pkce", "code_verifier", "code_challenge", "s256", "rfc 7636", "token", "client_id", "client_secret"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O **OAuth 2.0** é o mesmo padrão do “**Entrar com Google**”: a aplicação do parceiro **nunca vê a senha nem a chave privada** do titular." },
      { id: "passos", titulo: "Os 5 passos", icone: "i-engrenagem", markdown: L(
        ":::diagrama oauth",
        "",
        "1. **Aplicação se identifica** — `client_id` + `client_secret`.",
        "2. **Pede autorização** — para o CPF/CNPJ do titular.",
        "3. **Titular aprova no celular** — QR Code ou notificação push.",
        "4. **Troca código por token** — access token temporário.",
        "5. **Assina com o token** — dentro do prazo e escopo.") },
      { id: "pkce", titulo: "PKCE (RFC 7636)", icone: "i-cadeado", markdown: L(
        "A aplicação gera um `code_verifier`, envia o `code_challenge` (**S256**) na autorização e **prova o original** ao pedir o token. Se não baterem, o token é negado — **causa clássica de erro de integração**.") },
      { id: "atencao", titulo: "Onde nascem os “não funciona”", icone: "i-alerta", markdown: NOTA("O passo 3 (destacado no diagrama) é o único que depende do titular — grande parte dos chamados de “não funciona” está aí (QR Code expirado, app deslogado, push não recebido).") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-fluxo, vs-passo-3-autorizacao, vs-passo-4-token, OAuth 2.0, client_id, client_secret, PKCE, code_verifier, code_challenge, Access token" }
    ]),
  aula("vs-ambientes", "fundamentos", 3, "Básico", "Ambientes: produção, homologação, demonstração",
    "O erro nº 1 é misturar os ambientes: credenciais valem para um só.",
    ["ambiente", "produção", "homologação", "hml", "demonstração", "demo", "uri", "url", "invalid client", "prd"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "**O erro nº 1 é misturar os ambientes:** credenciais (`client_id`/`client_secret`) são **por ambiente**." },
      { id: "uris", titulo: "URIs de cada ambiente", icone: "i-globo", markdown: L(
        "| Ambiente | VIDaaS (URI base) | SGACT — carimbo do tempo |",
        "| --- | --- | --- |",
        "| **Produção** | `https://certificado.vidaas.com.br` | `https://act-icp-brasil.validcertificadora.com.br/act-request/tstRequest` |",
        "| **Homologação (HML)** | `https://hml-certificado.vidaas.com.br` | `https://hml-act-icp-brasil.validcertificadora.com.br/act-request/tstRequest` |",
        "| **Demonstração** | `https://demo-certificado.vidaas.com.br` | — |",
        "{tabela: listrada largura=total}") },
      { id: "regra", titulo: "Regra de ouro", icone: "i-alerta", markdown: L(
        "> [!atencao] Regra de ouro",
        "> Credenciais (`client_id`/`client_secret`) são **por ambiente**. Par de **HML não funciona em produção** — e vice-versa. **Sempre confirme a URL completa** que o parceiro está chamando antes de qualquer análise.",
        "",
        NOTA("Peça sempre a URL completa no chamado. “invalid client” com credenciais corretas quase sempre é ambiente trocado.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-troubleshooting, vs-postman, client_id, client_secret" }
    ]),

  /* ---------------- Módulo 3 · O fluxo VIDaaS em 5 passos ---------------- */
  aula("vs-fluxo", "fluxo-vidaas", 1, "Intermediário", "Visão geral: a sequência dos 5 passos",
    "Cadastro → user-discovery → autorização → token → assinatura: a sequência que classifica quase todo chamado.",
    ["fluxo", "5 passos", "endpoints", "oauth", "application", "user-discovery", "authorize", "token", "signatures"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Decorou esta sequência? Então você já sabe **classificar 90% dos chamados de VIDaaS**." },
      { id: "diagrama", titulo: "A sequência", icone: "i-engrenagem", markdown: L(
        ":::diagrama vidaas-5-passos",
        "",
        "| Passo | Endpoint | O que acontece | Aula |",
        "| --- | --- | --- | --- |",
        "| **1 · Cadastro da aplicação** | `POST /v0/oauth/application/` | Uma única vez. Devolve `client_id` e `client_secret`. | [Passo 1](#vs-passo-1-cadastro) |",
        "| **2 · User-discovery** | `POST /v0/oauth/user-discovery` | CPF/CNPJ tem certificado? Lista os slots. | [Passo 2](#vs-passo-2-discovery) |",
        "| **3 · Autorização** | `GET /v0/oauth/authorize` | Titular aprova no app: QR Code ou PUSH. | [Passo 3](#vs-passo-3-autorizacao) |",
        "| **4 · Token** | `POST /v0/oauth/token` | Troca o código pelo access token (Bearer). | [Passo 4](#vs-passo-4-token) |",
        "| **5 · Assinatura** | `POST .../trusted-services/signatures` | Envia hashes; recebe as assinaturas. | [Passo 5](#vs-passo-5-assinatura) |",
        "{tabela: largura=total}") },
      { id: "triagem", titulo: "Como usar na triagem", icone: "i-ajuda", markdown: NOTA("Slide âncora do treinamento. Triagem N1: “em qual desses passos aparece o erro?”. Cada passo tem uma aula própria nesta trilha (na apostila, seções 4.1 a 4.5).") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-oauth, vs-troubleshooting, vidaas, OAuth 2.0, Bearer" }
    ]),
  aula("vs-passo-1-cadastro", "fluxo-vidaas", 2, "Intermediário", "Passo 1: cadastro da aplicação",
    "Feito uma única vez por aplicação e por ambiente; devolve client_id e client_secret.",
    ["cadastro", "application", "redirect_uris", "client_id", "client_secret", "client_maintenance", "passo 1"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O cadastro é feito **uma única vez por aplicação e por ambiente** em `POST /v0/oauth/application/` e devolve o `client_id` e o `client_secret`." },
      { id: "campos", titulo: "Campos obrigatórios", icone: "i-lista", markdown: L(
        "| Campo | O que é |",
        "| --- | --- |",
        "| `name` | nome/descrição da aplicação |",
        "| `comments` | observações gerais de uso |",
        "| `redirect_uris` | URIs autorizadas para redirecionamento |",
        "| `email` | contato para indisponibilidade e mudanças de versão |") },
      { id: "resposta", titulo: "Resposta", icone: "i-documento", markdown: L(
        "Exemplo com **valores fictícios** (os reais são confidenciais):",
        "",
        "```json",
        "{ \"status\": \"success\",",
        "  \"client_id\": \"00000000-0000-0000-0000-000000000000\",",
        "  \"client_secret\": \"exemplo-secret\" }",
        "```") },
      { id: "chamado", titulo: "O que gera chamado", icone: "i-alerta", markdown: L(
        "> [!atencao] Gera chamado",
        "> O `redirect_uri` usado na autorização precisa ser **igual/contido** ao cadastrado aqui. Alterações via `PUT /v0/oauth/client_maintenance`; consulta via `GET /v0/oauth/application/<client_id>`. O `client_secret` é **confidencial** — nunca deve aparecer em chamado.",
        "",
        NOTA("Cadastro é raro de dar problema por si, mas os dados cadastrados (redirect_uris) causam erros no passo 3. N2 pode conferir o cadastro com a chamada 9 da collection (client details).")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-passo-3-autorizacao, vs-postman, vs-seguranca, client_id, client_secret, redirect_uri" }
    ]),
  aula("vs-passo-2-discovery", "fluxo-vidaas", 3, "Intermediário", "Passo 2: user-discovery",
    "Verifica se o CPF/CNPJ tem certificado no Valid PSC e lista os slots; status “N” é orientação, não bug.",
    ["user-discovery", "discovery", "slot", "slot_alias", "status s", "status n", "cpf", "cnpj", "passo 2"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O **user-discovery** (`POST /v0/oauth/user-discovery`) verifica se o CPF/CNPJ tem certificado no **Valid PSC** e lista os certificados (**slots**) disponíveis." },
      { id: "envio", titulo: "O que a aplicação envia", icone: "i-upload", markdown: "Envia: `client_id`, `client_secret`, `user_cpf_cnpj` (“CPF” ou “CNPJ”) e `val_cpf_cnpj` (o número)." },
      { id: "respostas", titulo: "Status \"S\" × status \"N\"", icone: "i-tabela", markdown: L(
        "| Status \"S\" — encontrado | Status \"N\" — não encontrado |",
        "| --- | --- |",
        "| Devolve a lista de **slots** do titular | CPF/CNPJ **sem certificado** no Valid PSC |",
        "| `slot_alias` + `label` (ex.: “e-CPF A3 em nuvem gold”) | **NÃO** é erro de integração nem bug |",
        "| Siga para a autorização | Titular precisa de certificado em nuvem Valid **ativo no app VIDaaS** |",
        "{tabela: largura=total}") },
      { id: "n1", titulo: "N1 já resolve", icone: "i-sucesso", markdown: L(
        "> [!sucesso] N1 já resolve",
        "> Status “N” é **orientação ao titular**, não escalonamento técnico.",
        "",
        NOTA("Chamado típico: “a API diz que o cliente não existe”. Verificar com o titular se o certificado em nuvem está emitido e ativo no app. Só escale se o titular garantir que tem certificado Valid ativo e o discovery continuar retornando N.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vidaas, vs-troubleshooting, user-discovery, Slot" }
    ]),
  aula("vs-passo-3-autorizacao", "fluxo-vidaas", 4, "Intermediário", "Passo 3: autorização (QR Code × PUSH) e escopos",
    "O titular aprova no app por QR Code (página de 2 minutos) ou por notificação push; o escopo define o que o token pode fazer.",
    ["autorização", "authorize", "qr code", "push", "authentications", "authorizationtoken", "escopo", "scope", "single_signature", "multi_signature", "signature_session", "authentication_session", "lifetime", "login_hint", "passo 3"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Na autorização (`GET /v0/oauth/authorize`) o **titular aprova no app VIDaaS**, por **QR Code** ou por **PUSH**, e o **escopo** pedido define o que o token vai poder fazer." },
      { id: "qr-push", titulo: "QR Code × PUSH", icone: "i-telefone", markdown: L(
        ":::diagrama qr-push",
        "",
        "| QR CODE | PUSH (`redirect_uri` `push://…`) |",
        "| --- | --- |",
        "| HTTP **302** → página de autenticação com QR Code | Titular recebe **notificação no app** — sem QR Code |",
        "| Página vale **2 minutos** | Resposta imediata traz um `code` (id da autorização) |",
        "| Titular lê com o app VIDaaS e escolhe o certificado | Aplicação consulta `GET …/authentications?code=` |",
        "| Redireciona ao `redirect_uri` com `code` na URL | Quando aprovado, devolve o `authorizationToken` |",
        "{tabela: largura=total}") },
      { id: "expirado", titulo: "“Tempo para autenticação expirado”", icone: "i-relogio", markdown: L(
        "> [!info] Não é falha",
        "> “Tempo para autenticação expirado” = titular **não autorizou em 2 min**. Basta gerar nova autorização com o **app aberto e logado**.") },
      { id: "parametros", titulo: "Parâmetros da autorização", icone: "i-lista", markdown: L(
        "Parâmetros da autorização (query):",
        "",
        "- `client_id`",
        "- `code_challenge`",
        "- `code_challenge_method=S256`",
        "- `response_type=code`",
        "- `scope`",
        "- `login_hint` (CPF/CNPJ)",
        "- `lifetime` (segundos)",
        "- `redirect_uri`",
        "",
        NOTA("Push não chega: app deslogado, notificações bloqueadas ou `push://` incorreto — teste por QR Code para isolar.")) },
      { id: "escopos", titulo: "Escopos: o que o token pode fazer", icone: "i-tag", markdown: L(
        "| Escopo | O que faz |",
        "| --- | --- |",
        "| `single_signature` | Assina **um único hash**; token invalidado após o uso. |",
        "| `multi_signature` | **Vários hashes em uma única requisição**; token invalidado após o uso. |",
        "| `signature_session` | Sessão: **várias assinaturas em várias chamadas** enquanto o token for válido. |",
        "| `authentication_session` | **Só autentica** o titular; não usa a chave privada. |",
        "{tabela: listrada largura=total}",
        "",
        "> [!dica] Sempre informe o scope",
        "> Se omitido, assume `single_signature` — mas o padrão pode mudar. Oriente o parceiro a **sempre informar o scope**. “Segunda assinatura falhou”? Provavelmente scope single/multi: use `signature_session`.",
        "",
        NOTA("Erro clássico: parceiro usa `single_signature` e tenta assinar de novo com o mesmo token. O token foi invalidado por design — não é bug.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-oauth, vs-passo-1-cadastro, vs-passo-4-token, vidaas, redirect_uri, Escopo, PKCE, code_challenge" }
    ]),
  aula("vs-passo-4-token", "fluxo-vidaas", 5, "Avançado", "Passo 4: token",
    "Troca o código pelo access token (Bearer): o campo “code” muda conforme QR Code ou PUSH.",
    ["token", "access_token", "bearer", "authorization_code", "code", "authorizationtoken", "code_verifier", "expires_in", "pkce", "passo 4"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "No `POST /v0/oauth/token` (`application/x-www-form-urlencoded`) a aplicação **troca o código pelo access token** (Bearer)." },
      { id: "envio", titulo: "O que vai no pedido", icone: "i-upload", markdown: L(
        "- `grant_type` = `authorization_code`",
        "- `client_id` + `client_secret`",
        "- `code` (veja o quadro abaixo!)",
        "- `code_verifier` — o original do `code_challenge` (PKCE)",
        "- `redirect_uri` — igual ao da autorização (se usado)") },
      { id: "code", titulo: "Qual valor vai no campo “code”?", icone: "i-ajuda", markdown: L(
        "| Fluxo | Valor do campo `code` |",
        "| --- | --- |",
        "| **QR Code** | O `code` devolvido na **URL de redirecionamento**. |",
        "| **PUSH** | O `authorizationToken` devolvido pelo **serviço de authentications**. |",
        "",
        "> [!erro] Confusão nº 1 dos integradores",
        "> Trocar os dois = “código inválido”.") },
      { id: "resposta", titulo: "Resposta", icone: "i-documento", markdown: L(
        "Resposta: `access_token` (Bearer), `expires_in` em segundos (ex.: **900 = 15 min**), `scope` e identificação autorizada. **Token expirado ou código reutilizado ⇒ refazer a autorização.**",
        "",
        NOTA("Erros aqui: PKCE divergente (verifier ≠ challenge), código expirado/já usado, code × authorizationToken trocados, credenciais de outro ambiente. Sempre perguntar o horário do erro — códigos e tokens têm vida curta.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-passo-3-autorizacao, vs-passo-5-assinatura, vs-ambientes, Access token, Bearer, PKCE, code_verifier" }
    ]),
  aula("vs-passo-5-assinatura", "fluxo-vidaas", 6, "Avançado", "Passo 5: assinatura",
    "Envia os hashes com o token Bearer e recebe as assinaturas; documento acima de 20 MB vai sempre como hash.",
    ["assinatura", "signatures", "trusted-services", "hashes", "hash_algorithm", "oid", "sha-256", "signature_format", "cms", "cades", "pades", "raw", "pdf_signature_page", "20 mb", "passo 5"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Em `POST …/trusted-services/signatures` com `Authorization: Bearer <access_token>`, a aplicação **envia os hashes** e **recebe as assinaturas**." },
      { id: "campos", titulo: "O que vai no pedido", icone: "i-lista", markdown: L(
        "- `hashes[]`: `id`, `alias`, `hash`, `hash_algorithm` (OID), `signature_format`",
        "- **SHA-256** ⇒ OID `2.16.840.1.101.3.4.2.1`",
        "- `certificate_alias` e `padding_method` (`NONE`, `PKCS1V1_5`, `PSS`) opcionais",
        "- `base64_content`: conteúdo (texto/PDF) em base64, opcional",
        "- `pdf_signature_page`: “true” acrescenta página de assinatura no PDF (padrão “false”)") },
      { id: "formatos", titulo: "Formatos aceitos", icone: "i-documento", markdown: L(
        "`RAW` · `CMS` · `CAdES_AD_RT` · `CAdES_AD_RB` · `PAdES_AD_RT` · `PAdES_AD_RB` · `RAW_DIGESTED_DATA` · `RAW_DATA`",
        "",
        "> [!atencao] Mais de 20 MB?",
        "> Documento **> 20 MB** deve ser enviado como **hash**, nunca inteiro.") },
      { id: "resposta", titulo: "Resposta", icone: "i-sucesso", markdown: L(
        "Resposta: `raw_signature` em base64 **por item**. Em CMS/CAdES/PAdES, inclui `signingTime` (hora do PSC), `messageDigest` e `signingCertificateV2`.",
        "",
        NOTA("Erros comuns: OID errado no `hash_algorithm`, formato não suportado, token expirado entre a autorização e a assinatura, arquivo grande enviado inteiro. Endpoints auxiliares: encrypt/decrypt, certificate-discovery, client_maintenance — seção 4.6 da apostila (material complementar: peça ao time).")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-passo-4-token, vs-troubleshooting, hash-sha, Bearer, CMS, CAdES, PAdES, Hash" }
    ]),

  /* ---------------- Módulo 4 · Carimbo do tempo ---------------- */
  aula("vs-sgact", "carimbo-tempo", 1, "Avançado", "SGACT — carimbo do tempo (TST)",
    "O carimbo do tempo segue a RFC 3161: TSR com o hash, canal mTLS, POST binário e resposta TST.",
    ["sgact", "carimbo do tempo", "tst", "tsr", "rfc 3161", "mtls", "timestamp", "application/timestamp-query", "truststore", "java", "c#", "bouncy castle"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O **SGACT** emite o **carimbo do tempo (TST)**: a aplicação monta um **TSR** com o hash, abre um canal **mTLS**, faz um **POST binário** e recebe o **TST**." },
      { id: "fluxo", titulo: "Os 4 passos", icone: "i-engrenagem", markdown: L(
        ":::diagrama sgact",
        "",
        "1. **Montar o TSR** — TimeStamp Request com o hash do dado.",
        "2. **Canal mTLS** — certificado de cliente + cadeia do servidor.",
        "3. **POST binário** — `Content-Type: application/timestamp-query`.",
        "4. **Resposta TST** — status **0** = sucesso; traz o nº de série.") },
      { id: "prerequisitos", titulo: "Pré-requisitos", icone: "i-lista", markdown: L(
        "- Certificado **ICP-Brasil A1/A3** (pref. cadeia Valid)",
        "- **Previamente cadastrado no SGACT** da Valid",
        "- Cadeia do servidor confiável no ambiente (**truststore**)") },
      { id: "exemplos", titulo: "Exemplos oficiais do manual", icone: "i-documento", markdown: L(
        "| Linguagem | O que o exemplo usa |",
        "| --- | --- |",
        "| **Java SE 6+** | PFX (keystore) + JKS (truststore), Bouncy Castle, Commons IO |",
        "| **C#** | PFX + `BouncyCastle.Crypto.dll`; política `2.16.76.1.6.5`, nonce aleatório |") },
      { id: "triagem", titulo: "Triagem", icone: "i-ajuda", markdown: L(
        "| Sintoma | Indica |",
        "| --- | --- |",
        "| Falha **SSL** | certificado/cadastro |",
        "| HTTP **≠ 200** | URL ou Content-Type |",
        "| **status ≠ 0** | TSR malformado |",
        "",
        NOTA("Aderente à RFC 3161. URLs: produção `act-icp-brasil.validcertificadora.com.br` e HML `hml-act-icp-brasil...` (`/act-request/tstRequest`). O cadastro do certificado no SGACT é feito pela Valid — se for essa a pendência, escalar.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-ambientes, vs-roteiro, utc, SGACT, TST, TSR, RFC 3161, mTLS" }
    ]),

  /* ---------------- Módulo 5 · Ferramentas ---------------- */
  aula("vs-postman", "ferramentas", 1, "Avançado", "Collection Postman: a ferramenta do N2",
    "“PSC API Integração V1.4 (for developers)”: pastas HML e PRD com o fluxo completo, na ordem numérica.",
    ["postman", "collection", "psc api", "hml", "prd", "client details", "client maintenance", "encrypt", "decrypt", "reproduzir"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "A collection **“PSC API Integração V1.4 (for developers)”** tem as pastas **HML** e **PRD** com o fluxo completo, na ordem numérica." },
      { id: "ordem", titulo: "As chamadas, na ordem", icone: "i-lista", markdown: L(
        "| Nº | Chamada |",
        "| --- | --- |",
        "| 0 | Client token |",
        "| 1 | Application |",
        "| 2 | User-discovery |",
        "| 3 | Autorização (QR Code / PUSH) |",
        "| 3.1 | Exibir QR Code |",
        "| 4 | Authentication |",
        "| 5 | Token |",
        "| 6 | Signature (CAdES / PKCS1) |",
        "| 6.1 / 6.2 | Encrypt / Decrypt |",
        "| 7 | Certificado público |",
        "| 8 | Client maintenance |",
        "| 9 | Client details |",
        "{tabela: compacta}") },
      { id: "checklist", titulo: "Antes de testar", icone: "i-check", markdown: L(
        "- [ ] Confirme a pasta (**HML × PRD**) antes de qualquer teste — nunca cruze credenciais de ambientes.",
        "- [ ] Preencha as variáveis: `client_id`, `client_secret`, `user_cpf`, `code_verifier`, tokens.",
        "- [ ] Reproduza **na ordem numérica** — a maioria dos erros vem de pular etapa ou reutilizar código expirado.",
        "- [ ] Peça **request + response completos** ao parceiro (sem o `client_secret`) e compare com a collection.",
        "",
        NOTA("Reproduzir o problema na collection oficial é o critério para escalar à Valid: se a chamada correta falha também no Postman, o problema não é do código do parceiro.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-fluxo, vs-ambientes, vs-roteiro, Postman, client_id" }
    ]),

  /* ---------------- Módulo 6 · Atendimento ---------------- */
  aula("vs-troubleshooting", "atendimento", 1, "Intermediário", "Troubleshooting: os 8 campeões de chamado",
    "Sintoma, causa e o que fazer nos oito chamados mais comuns de VIDaaS e carimbo do tempo.",
    ["troubleshooting", "invalid client", "status n", "qr code expirou", "push", "pkce", "segunda assinatura", "20 mb", "ssl", "carimbo do tempo"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Oito sintomas respondem pela maioria dos chamados: reconheça o **sintoma**, aponte a **causa** e oriente **o que fazer**." },
      { id: "tabela", titulo: "Sintoma · Causa · O que fazer", icone: "i-tabela", markdown: L(
        "| Sintoma | Causa | O que fazer |",
        "| --- | --- | --- |",
        "| “invalid client” | Credenciais de outro ambiente (HML × PRD) | Confirmar a URL completa e usar o par de credenciais do ambiente certo ([Ambientes](#vs-ambientes)) |",
        "| user-discovery “N” | Titular sem certificado no Valid PSC | Orientar, não escalar ([Passo 2](#vs-passo-2-discovery)) |",
        "| QR Code expirou | Página vale 2 min | Gerar nova autorização ([Passo 3](#vs-passo-3-autorizacao)) |",
        "| Push não chega | App deslogado, notificação bloqueada ou `push://` errado | Conferir o app e o `redirect_uri`; testar por QR Code para isolar |",
        "| Erro no `/oauth/token` | PKCE divergente ou code × authorizationToken trocados | Conferir o `code_verifier` e qual valor vai no campo code ([Passo 4](#vs-passo-4-token)) |",
        "| 2ª assinatura falha | Escopo single/multi invalida o token | Usar `signature_session` ([Escopos](#vs-passo-3-autorizacao)) |",
        "| Arquivo grande falha | > 20 MB deve ir como hash | Enviar o hash, nunca o arquivo inteiro ([Passo 5](#vs-passo-5-assinatura)) |",
        "| SSL no carimbo do tempo | Certificado não cadastrado no SGACT ou cadeia não confiável | Conferir cadastro e truststore; cadastro no SGACT é com a Valid ([SGACT](#vs-sgact)) |",
        "{tabela: listrada largura=total}",
        "",
        "> [!info] Tabelas completas por etapa",
        "> Apostila, seção 7, e Guia Rápido impresso (material complementar: peça ao time).") },
      { id: "exercicio", titulo: "Para treinar", icone: "i-pessoas", markdown: NOTA("Exercício sugerido: leia cada sintoma e diga em qual passo do fluxo ele acontece e o que perguntar primeiro ao cliente.") },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-fluxo, vs-roteiro, vidaas, vidaas-connect, PKCE, Escopo, mTLS" }
    ]),
  aula("vs-roteiro", "atendimento", 2, "Intermediário", "Roteiro de atendimento e escalonamento N1/N2",
    "O checklist de coleta e o que cabe ao N1, ao N2 e à Valid.",
    ["roteiro", "checklist", "escalonamento", "escalar", "n1", "n2", "valid", "suportecorp", "coleta"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "**Colete sempre o checklist completo** e escale à Valid só quando o N2 reproduziu a chamada correta e o erro persiste — ou quando só a Valid pode agir." },
      { id: "checklist", titulo: "Colete sempre (checklist)", icone: "i-check", markdown: L(
        "- [ ] Ambiente + URL completa",
        "- [ ] Etapa do fluxo (1 a 5, ou carimbo do tempo)",
        "- [ ] Request e response completos (**sem secrets**)",
        "- [ ] Data/hora do erro (expiração!)",
        "- [ ] `client_id` + CPF/CNPJ do titular",
        "- [ ] Escopo, formato e algoritmo usados",
        "- [ ] Reproduzível? Todos os titulares ou um só?") },
      { id: "niveis", titulo: "Quem faz o quê", icone: "i-pessoas", markdown: L(
        "| Quem | O que faz |",
        "| --- | --- |",
        "| **N1** | Triagem: produto, ambiente, etapa. Resolve orientações simples (QR expirado, status N, app deslogado). |",
        "| **N2** | Analisa request/response, reproduz no Postman, orienta PKCE, `redirect_uri`, escopos, OIDs, 20 MB. |",
        "| **Valid** | Indisponibilidade, erro reproduzido com requisição correta, cadastro no SGACT, emissão do certificado. |",
        "{tabela: largura=total}") },
      { id: "escalar", titulo: "Escalonamento à Valid", icone: "i-email", markdown: L(
        "> [!atencao] Escalonamento à Valid",
        "> `suportecorp.certificadora@valid.com` — **sempre com o checklist completo**.",
        "",
        NOTA("Critério objetivo de escalonamento: o N2 reproduziu a chamada correta na collection oficial e o erro persiste — ou a pendência é algo que só a Valid executa (cadastro no SGACT, estado do certificado do titular).")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-troubleshooting, vs-postman, vs-seguranca, Postman" }
    ]),
  aula("vs-seguranca", "atendimento", 3, "Básico", "Segurança em primeiro lugar",
    "Nunca peça nem registre segredos: client_secret, senha de PFX, senha do app VIDaaS.",
    ["segurança", "client_secret", "senha", "pfx", "rotacionar", "client_maintenance", "chave privada"], [
      { id: "regras", titulo: "Três regras", icone: "i-escudo", markdown: L(
        "> [!erro] Nunca peça nem registre",
        "> `client_secret`, senha de PFX, senha do app VIDaaS.",
        "",
        "> [!atencao] Secret exposto em chamado?",
        "> Oriente o parceiro a **rotacioná-lo** (`client_maintenance`).",
        "",
        "> [!atencao] A chave privada nunca sai da nuvem",
        "> A chave privada do titular **nunca sai da nuvem da Valid** — desconfie de quem pedir o contrário.") },
      { id: "proximos", titulo: "Próximos passos", icone: "i-livro", markdown: L(
        "- **Material complementar: peça ao time** — a apostila (seções 2 e 3 para N1; 4 a 7 para N2) e o Guia Rápido para manter na mesa.",
        "- Reforce os **5 passos do fluxo**, a **regra de ambientes** e a **postura de segurança**.",
        "",
        NOTA("Encerramento: reforçar os 5 passos do fluxo, a regra de ambientes e a postura de segurança.")) },
      { id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: "vs-fluxo, vs-ambientes, vs-passo-1-cadastro, vidaas, client_secret, Chave privada, PFX" }
    ])
];
