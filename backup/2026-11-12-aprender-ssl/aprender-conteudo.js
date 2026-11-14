/*
 * Conteúdo inicial da Aprendizagem - Tire suas dúvidas (reserva embutida).
 * Na primeira vez que uma administradora abre aprender.html, o botão
 * "Publicar conteúdo inicial" grava isto no Firestore (conhecimento/
 * e conhecimento-config/). Depois disso, vale o que está no Firestore.
 *
 * Fontes: anotações do time em importacao/onenote-paula/ ("CIN + vidaaS",
 * "27 - CERTIFICADOS SSL", "23 - API e INTEGRA ICP", "01 - CONHECIMENTO N2 -
 * TECNICO", "Temas diversos", "17 - PROJETO TJSP") + conceitos gerais.
 * Detalhes de produto da Valid que não estão no material ficam marcados
 * com o aviso "A confirmar com o time".
 * Os temas de Certificação digital (exceto VIDaaS) vêm de aprender-certificacao.js; as trilhas
 * "VIDaaS e Carimbo do Tempo (SGACT)" e "IntegraICP API v3" vêm de aprender-vidaas-sgact.js e
 * aprender-integraicp.js (conteúdo dos treinamentos em importacao/aprender/). A trilha "API — O Guia Completo"
 * vem de aprender-guia-apis.js (Guia Completo de APIs, edição 2026).
 * Hierarquia: CATEGORIA (área) → TRILHA (curso) → MÓDULO (capítulo) → AULA (tema; subtema = aula filha).
 */
import { TEMAS_CERTIFICACAO } from "./aprender-certificacao.js";
import { TRILHA_VIDAAS_SGACT, AULAS_VIDAAS_SGACT } from "./aprender-vidaas-sgact.js";
import { TRILHA_INTEGRAICP, AULAS_INTEGRAICP } from "./aprender-integraicp.js";
import { TRILHA_GUIA_APIS, AULAS_GUIA_APIS } from "./aprender-guia-apis.js";

/* Suba CONTEUDO_VERSAO quando o conteúdo embutido mudar: aprender.html mostra às
   administradoras a faixa "Há conteúdo novo" enquanto conhecimento-config/trilhas
   tiver uma versão menor. */
export const CONTEUDO_VERSAO = 4;
export const NOVIDADES_CONTEUDO = [
  "Trilha nova “API — O Guia Completo” (categoria Integrações e APIs): 7 módulos e 24 aulas do Guia Completo de APIs — fundamentos, HTTP, métodos e códigos de status, REST e outros estilos, segurança (OAuth 2.0, JWT, OWASP), boas práticas, testes, APIs no mundo real, checklist, revisão e referências.",
  "Cada aula da trilha nova tem o bloco “Na prática no Suporte N2”, com ligações às aulas do VIDaaS/SGACT e do IntegraICP.",
  "A aula “API” ganha ligações para a trilha nova em “Termos relacionados”.",
  "Glossário: API Gateway, API Key, autenticação, autorização, backoff, BFF, BOLA, cache, circuit breaker, Content-Type, CORS, CRUD, curl, DELETE, ETag, GraphQL, gRPC, HATEOAS, header, HTTP, JWT, latência, MCP, mock, OpenAPI, OpenID Connect, OWASP, PATCH, payload, polling, Problem Details, PUT, query string, refresh token, REST, SDK, serialização, SLA, SOAP, SSE, stateless, status HTTP, throughput, webhook, Web Service, WebSocket e XML.",
  "As edições já feitas nas aulas publicadas são mantidas."
];
/* Versão 2 (para quem publicou a versão 1): textos substituídos inteiros */
export const TEMAS_SUBSTITUIDOS = ["certificado-digital", "icp-brasil"];
/* Aulas publicadas que recebem só os campos novos (trilha, módulo e "Termos relacionados"); o resto do texto fica */
export const TEMAS_COM_TERMOS_NOVOS = ["vidaas", "vidaas-connect", "api"];

/* Categorias (áreas): ícone e cor de destaque próprios. "cor" = cores do tema (roxo é o lilás da Central). */
export const CATEGORIAS_PADRAO = [
  { id: "certificacao", nome: "Certificação digital", descricao: "Certificado digital, ICP-Brasil, cadeia, criptografia e cada campo do certificado.", icone: "i-certificado", cor: "roxo", ordem: 1 },
  { id: "produtos", nome: "Produtos Valid", descricao: "VIDaaS, VIDaaS Connect e o suporte a parceiros que integram com o Valid PSC.", icone: "i-telefone", cor: "azul", ordem: 2 },
  { id: "integracoes", nome: "Integrações e APIs", descricao: "API, endpoints e integrações entre sistemas, o guia completo de APIs e o playbook do IntegraICP.", icone: "i-plug", cor: "verde", ordem: 3 },
  { id: "seguranca", nome: "Segurança e web", descricao: "SSL/TLS e HTTPS: como um site prova quem é e protege a conexão.", icone: "i-escudo", cor: "laranja", ordem: 4 },
  { id: "ferramentas", nome: "Ferramentas do time", descricao: "Os sistemas que o Suporte N2 usa no dia a dia.", icone: "i-ferramenta", cor: "cinza", ordem: 5 }
];

export const TRILHAS_PADRAO = [
  { id: "certificacao", nome: "Certificação digital", categoria: "certificacao", cor: "roxo", nivel: "Básico", descricao: "O que é um certificado digital, os tipos (A1, A3 e nuvem), a ICP-Brasil, a cadeia, a criptografia e cada campo do certificado.", icone: "i-certificado", ordem: 1 },
  { id: "vidaas", nome: "VIDaaS", categoria: "produtos", cor: "azul", nivel: "Básico", descricao: "O aplicativo da Valid para certificado em nuvem e o VIDaaS Connect, que leva o certificado aos sistemas do computador.", icone: "i-telefone", ordem: 2, modulos: [{ id: "conteudo", nome: "Conteúdo", ordem: 1 }] },
  TRILHA_VIDAAS_SGACT,
  { id: "integracoes", nome: "Integrações", categoria: "integracoes", cor: "verde", nivel: "Básico", descricao: "API, endpoints e integrações entre sistemas, com exemplos do dia a dia.", icone: "i-plug", ordem: 4 },
  TRILHA_GUIA_APIS,
  TRILHA_INTEGRAICP,
  { id: "seguranca", nome: "Segurança e web", categoria: "seguranca", cor: "laranja", nivel: "Intermediário", descricao: "SSL/TLS e HTTPS: como um site prova quem é e protege a conexão.", icone: "i-escudo", ordem: 6 },
  { id: "ferramentas", nome: "Ferramentas do time", categoria: "ferramentas", cor: "cinza", nivel: "Básico", descricao: "Os sistemas que o Suporte N2 usa no dia a dia. Em breve.", icone: "i-ferramenta", ordem: 7 }
].map((t, i) => ({ ...t, ordem: i + 1 }));

const CONFIRMAR = (texto) => `> [!atencao] A confirmar com o time\n> ${texto.replace(/\n/g, "\n> ")}`;

export const TEMAS_PADRAO = [
  ...TEMAS_CERTIFICACAO,
  {
    id: "vidaas", trilha: "vidaas", modulo: "conteudo", paiId: null, ordem: 1, nivel: "Básico",
    titulo: "VIDaaS",
    resumo: "O aplicativo da Valid para certificado digital em nuvem: assinatura autorizada pelo celular.",
    palavrasChave: ["vidaas", "nuvem", "aplicativo", "celular", "emissão", "direito de uso", "senha de emissão"],
    secoes: {
      frase: "O **VIDaaS** é o aplicativo da Valid para **certificado digital em nuvem**: a chave fica guardada em um ambiente seguro na nuvem e a pessoa **autoriza o uso pelo celular**, sem token.",
      simples: "Pense em um cofre de banco. O certificado fica guardado no cofre (a nuvem) e o celular funciona como a chave do cofre: cada vez que um sistema precisa do certificado, a pessoa confirma no aplicativo.",
      funciona: "- É um certificado **A3 em nuvem**: a chave privada não fica no celular nem no computador.\n- Na **emissão**, o cliente usa a **senha de emissão** e depois define a **senha do certificado**, que vai usar no dia a dia.\n- Para usar no computador, o sistema conversa com o VIDaaS — por integração direta ou pelo **VIDaaS Connect**.\n- Alguns produtos em nuvem são vendidos por **período de direito de uso** (no catálogo aparecem, por exemplo, opções de 4 meses e de 1, 2 ou 3 anos, e renovações de direito de uso).\n\n" + CONFIRMAR("Regras de renovação do direito de uso, troca de celular e recuperação de acesso seguem procedimentos internos e podem mudar."),
      exemplo: "**Emitir pelo aplicativo** (passo a passo anotado pelo time):\n\n1. Abrir o app VIDaaS e tocar em **Emitir novo e-CPF**.\n2. Digitar o CPF e tocar em **Emitir novo certificado**.\n3. Selecionar a **data de atendimento**.\n4. Prosseguir com a **senha de emissão** e, depois, definir a **senha do certificado**.\n\n**Ativar/importar um certificado em nuvem:** reinstalar o app VIDaaS → **Novo** → **Ativar** → informar o CPF → concordar com o termo → **Confirmar** → **Ativar certificado** → com a opção **Ativar** selecionada, o botão **Prosseguir** é liberado.\n\n**O app travou ou não abre o certificado:** desinstalar o VIDaaS, reiniciar o celular, instalar de novo e, ao abrir, tocar em **Novo**.\n\n" + CONFIRMAR("Em instabilidade geral do VIDaaS, o time registrou que é preciso comunicar no grupo de acompanhamento e formalizar por e-mail. Confirme o canal atual antes de seguir."),
      duvidas: "### O certificado do VIDaaS fica no celular?\nNão. Fica na nuvem. O celular só autoriza o uso. Por isso, trocar de celular não \"perde\" o certificado, mas exige reativar o acesso.\n\n" + CONFIRMAR("Passo a passo oficial para troca de celular.") + "\n\n### Funciona em qualquer sistema?\nNa maioria dos sistemas que aceitam certificado em nuvem, sim. Alguns portais exigem um tipo específico de integração com token e não aceitam — veja **VIDaaS Connect**.",
      termos: "certificado-digital, certificado-tipos, assinatura-digital-eletronica, vidaas-connect, vs-produtos, vs-fluxo, vs-troubleshooting, Certificado em nuvem, Direito de uso, HSM, PSC",
      saibaMais: "- [Valid — Instalação do VIDaaS no smartphone](https://validcertificadora.com.br/pages/instalacao-do-vidaas-no-seu-smartphone)\n- [Valid — Senha de utilização do VIDaaS](https://validcertificadora.com.br/pages/senha-de-utilizacao-vidaas)"
    }
  },
  {
    id: "vidaas-connect", trilha: "vidaas", modulo: "conteudo", paiId: "vidaas", ordem: 1, nivel: "Intermediário",
    titulo: "VIDaaS Connect",
    resumo: "O programa que leva o certificado em nuvem do VIDaaS para os sistemas do computador.",
    palavrasChave: ["vidaas connect", "connect", "computador", "pkcs#11", "tjsp", "portal de custas", "qr code"],
    secoes: {
      frase: "O **VIDaaS Connect** é o programa instalado no computador que faz a **ponte** entre o computador e o certificado em nuvem do VIDaaS, para que sistemas e navegadores consigam usar esse certificado.",
      simples: "É como um adaptador de tomada. Muitos sistemas foram feitos esperando um token espetado no computador. O Connect faz o certificado que está na nuvem \"parecer\" um token conectado — e cada uso continua sendo autorizado no celular.",
      funciona: "1. A pessoa instala o VIDaaS Connect no computador.\n2. Vincula o Connect ao aplicativo VIDaaS do celular.\n3. Quando um sistema pede o certificado, o Connect busca a autorização no celular.\n\n**Limitação importante:** sistemas que dependem de uma integração específica com token (por exemplo, implementações baseadas em **PKCS#11**) podem não funcionar com o Connect.\n\n" + CONFIRMAR("Lista atualizada de sistemas compatíveis e incompatíveis, versões do Connect e o passo a passo de vínculo (QR Code) para cada sistema operacional."),
      exemplo: "**Magistrado não consegue assinar no portal de custas (TJSP) com o VIDaaS.** Registro do time: no portal de custas o VIDaaS Connect **não funciona** porque o portal não é homologado para ele — usa outro tipo de criptografia e depende de **PKCS#11**, que não tem suporte. Nesse caso, configurar de novo não resolve; é preciso outra forma de certificado para aquele portal.\n\n" + CONFIRMAR("Qual alternativa oferecer ao cliente nesse caso."),
      duvidas: "### Preciso do Connect para usar o VIDaaS?\nSó quando o sistema roda no computador e não tem integração direta com o VIDaaS. Muitos sistemas já se integram com a nuvem sem o Connect.\n\n### O Connect guarda o certificado no computador?\nNão. O certificado continua na nuvem; o Connect só faz a ponte.",
      termos: "vidaas, certificado-tipos, cadeia-certificacao, vs-produtos, vs-troubleshooting, PKCS#11, Certificado em nuvem",
      saibaMais: ""
    }
  },
  {
    id: "ssl", trilha: "seguranca", paiId: null, ordem: 1, nivel: "Intermediário",
    titulo: "SSL/TLS",
    resumo: "O certificado que prova a identidade de um site e permite a conexão criptografada.",
    palavrasChave: ["ssl", "tls", "csr", "pfx", "chave privada", "dv", "ov", "ev", "sectigo", "rsa", "sha"],
    secoes: {
      frase: "**SSL/TLS** é a tecnologia que cria um \"túnel\" protegido entre o navegador e o site. O **certificado SSL** prova que o site é mesmo quem diz ser.",
      simples: "É como um envelope lacrado com o crachá de quem enviou. O lacre (criptografia) impede que alguém leia no caminho; o crachá (certificado) mostra que o remetente é verdadeiro.\n\nO nome certo hoje é **TLS** (a versão moderna), mas todo mundo ainda fala \"SSL\".",
      funciona: "1. O cliente gera, **no próprio servidor**, um par de chaves e uma **CSR** (o pedido do certificado, com a chave pública e os dados do domínio, como o **CN**).\n2. A certificadora valida e emite o certificado (arquivo **.cer/.crt**).\n3. O certificado é instalado no servidor **junto com a chave privada** que ficou lá.\n4. Quando alguém acessa o site, o navegador confere: foi emitido por uma AC confiável? O domínio bate? Está na validade? Se sim, a conexão é criptografada.\n\n**Tipos de validação:**\n\n- **DV** — valida só o **domínio** (ex.: que o domínio pertence a quem pediu).\n- **OV** — valida o domínio **e a organização** (CNPJ e razão social).\n- **EV** — validação estendida, a mais rigorosa.\n\n**PFX:** para gerar um arquivo .pfx, é preciso juntar a **chave privada** (de onde a CSR foi gerada) com o **.cer** emitido.",
      exemplo: "**Anotações do time sobre SSL** (conferir se continuam valendo):\n\n" + CONFIRMAR("- Certificados **OV e DV** são internacionais (Sectigo); o **EV** é emitido na cadeia Brasil.\n- Erro registrado em validação **SSL EV**: CSR gerada com **SHA-256**, mas a categoria do produto usa **SHA-512**.\n- As emissões usam chave **RSA 2048** (o sistema de emissão não aceitava 4096).\n- **Certificado internacional:** antes da validação, é preciso enviar para a Sectigo definir o **domínio primário**.\n- **Redefinição de senha** dos produtos SSL funciona quando feita pelo responsável pelo CNPJ.") + "\n\n**Conferir uma CSR:** use um decodificador de CSR para ver o CN (domínio) e os dados antes de seguir com a emissão.",
      duvidas: "### O que é o CN?\nÉ o **Common Name**, o nome principal do certificado — normalmente o domínio (ex.: `www.exemplo.com.br`).\n\n### O cliente perdeu a chave privada. Dá para recuperar?\nNão. A chave privada só existe no servidor onde a CSR foi gerada. Sem ela não é possível montar o PFX; o caminho é gerar uma nova CSR.\n\n" + CONFIRMAR("Como funciona a reemissão nesse caso.") + "\n\n### RSA 2048 ou 4096?\nO número é o tamanho da chave. A 4096 é mais forte, mas mais lenta. A 2048 continua sendo um padrão muito usado.",
      termos: "https, CSR, Chave privada, PFX, CN (Common Name), DV, OV, EV, RSA",
      saibaMais: ""
    }
  },
  {
    id: "https", trilha: "seguranca", paiId: null, ordem: 2, nivel: "Básico",
    titulo: "HTTPS",
    resumo: "O HTTP com proteção: o cadeado do navegador e os avisos de segurança.",
    palavrasChave: ["https", "http", "cadeado", "443", "aviso", "conexão não é particular"],
    secoes: {
      frase: "**HTTPS** é o HTTP (o \"idioma\" da web) **com a proteção do TLS**: é o que faz aparecer o cadeado ao lado do endereço do site.",
      simples: "HTTP sem o S é como mandar um cartão-postal: qualquer um no caminho consegue ler. HTTPS é como uma carta registrada e lacrada: só o destinatário abre.",
      funciona: "- Endereços com `https://` usam a porta **443** por padrão (o HTTP comum usa a **80**).\n- Antes de trocar qualquer dado, o navegador confere o **certificado SSL** do site.\n- Se algo não bate, o navegador mostra um aviso como \"Sua conexão não é particular\".\n\n**Causas comuns de aviso:**\n\n- Certificado **vencido**.\n- O endereço acessado é **diferente** do domínio do certificado (ex.: com e sem `www`).\n- **Cadeia** de certificados incompleta no servidor.\n- **Data e hora erradas** no computador de quem acessa.",
      exemplo: "**Cliente diz que um site mostra aviso de segurança.** Antes de tudo, confira a **data e a hora** do computador dele. Depois, veja se o endereço digitado é exatamente o do certificado. Se o site é do cliente (certificado SSL dele), confira validade e cadeia instalada no servidor.",
      duvidas: "### O cadeado garante que o site é honesto?\nNão. Garante que a conexão é protegida e que o certificado é daquele domínio. Um site falso também pode ter cadeado.\n\n### Por que alguns sites redirecionam do HTTP para o HTTPS?\nPara que ninguém use a versão sem proteção por engano.",
      termos: "ssl, SSL/TLS, Cadeia de certificados",
      saibaMais: "- [MDN — HTTP (Mozilla)](https://developer.mozilla.org/pt-BR/docs/Web/HTTP)"
    }
  },
  {
    id: "api", trilha: "integracoes", paiId: null, ordem: 1, nivel: "Básico",
    titulo: "API",
    resumo: "Como programas conversam entre si: pedidos, endpoints, métodos e respostas.",
    palavrasChave: ["api", "endpoint", "get", "post", "json", "rest", "integração", "requisição"],
    secoes: {
      frase: "Uma **API** (Interface de Programação de Aplicações) é um conjunto de regras que permite que **um programa peça informações ou serviços a outro**, sem precisar saber como ele funciona por dentro.",
      simples: "**Analogia do restaurante:** o cliente faz o pedido ao garçom, o garçom leva até a cozinha e volta com o prato pronto.\n\n- **Cliente** = o sistema que precisa de algo.\n- **Garçom** = a API.\n- **Cozinha** = o sistema que processa e devolve os dados.",
      funciona: "Uma chamada de API tem quatro partes:\n\n1. **Endpoint** — o endereço (URL) onde a API recebe o pedido. Ex.: `https://api.exemplo.com/usuarios`.\n2. **Método HTTP** — o que se quer fazer: `GET` (buscar), `POST` (criar), `PUT` (alterar), `DELETE` (apagar).\n3. **Dados de entrada** — parâmetros ou um corpo em **JSON**.\n4. **Resposta** — normalmente em JSON, com um código de situação (ex.: 200 deu certo, 400 pedido inválido).\n\nO método **GET** só busca dados e não deve alterar nada. Parâmetros do GET vão na própria URL, por isso **nunca** se manda senha por GET.\n\nExemplo simples de resposta de uma API:\n\n```json\n{ \"message\": \"Olá, mundo!\" }\n```",
      exemplo: "**Erro de integração (Integra ICP) que já chegou ao N2:**\n\n```json\n{\"code\":\"invalidParameter\",\"message\":\"Um ou mais campos da requisição são inválidos.\",\n \"details\":[{\"code\":\"Size\",\"message\":\"O campo name do comprador não pode ter mais de 30 caracteres.\"},\n            {\"code\":\"NotBlank\",\"message\":\"O campo lastName do comprador é obrigatório.\"}]}\n```\n\n**Como ler:** a própria resposta diz o problema. O nome completo foi enviado em `name` (que aceita até 30 caracteres) e `lastName` ficou vazio. **Correção:** `name` com o primeiro nome e `lastName` com o(s) sobrenome(s), abreviando se passar do limite.",
      duvidas: "### API e site são a mesma coisa?\nNão. O site é feito para pessoas lerem; a API é feita para programas conversarem.\n\n### O que é JSON?\nUm formato de texto organizado em pares \"nome\": valor, fácil para programas lerem. É o formato mais comum nas APIs.",
      termos: "integracao, ga-o-que-e, ga-cliente-servidor-http, ga-metodos-http, ga-codigos-status, ga-formatos-dados, Endpoint, JSON, GET, POST",
      saibaMais: "- [MDN — Métodos de requisição HTTP (Mozilla)](https://developer.mozilla.org/pt-BR/docs/Web/HTTP/Methods)"
    }
  },
  {
    id: "integracao", trilha: "integracoes", paiId: null, ordem: 2, nivel: "Intermediário",
    titulo: "Integração (ex.: Integra ICP)",
    resumo: "Quando sistemas trocam dados sozinhos por API — e como ler os erros que aparecem.",
    palavrasChave: ["integração", "integra icp", "order", "pedido", "erro", "invalidparameter"],
    secoes: {
      frase: "**Integração** é quando dois sistemas trocam dados automaticamente, normalmente por **API**, sem ninguém precisar digitar de novo.",
      simples: "É como dois setores que, em vez de trocar papéis na mão, combinaram um formulário padrão: cada um preenche do seu lado e o outro entende na hora.",
      funciona: "- O sistema do cliente (ou parceiro) monta um pedido no formato combinado e envia para o **endpoint** da API.\n- A API **valida** os campos: tamanho, obrigatórios, formato.\n- Se algo estiver errado, ela devolve um erro explicando **qual campo** e **por quê**.\n\nNo material do time, o **Integra ICP** aparece recebendo pedidos no endpoint `/v1/order`, com dados do comprador (`buyer`).\n\n" + CONFIRMAR("Para que exatamente o Integra ICP é usado, quem são os clientes que integram e qual o fluxo de atendimento quando o erro é do lado do cliente."),
      exemplo: "**Erro `invalidParameter` no `/v1/order`:**\n\n- `Size` — *O campo name do comprador não pode ter mais de 30 caracteres.*\n- `NotBlank` — *O campo lastName do comprador é obrigatório.*\n\n**Tratativa registrada:** orientar o cliente a enviar o **primeiro nome** em `name` e os **sobrenomes** em `lastName`, abreviando quando passar de 30 caracteres.",
      duvidas: "### Como saber se o erro é nosso ou do cliente?\nErros de validação (campo inválido, obrigatório vazio, tamanho) mostram que o pedido chegou com dados fora do padrão — a correção é no envio. Erros de servidor indicam problema do nosso lado.\n\n" + CONFIRMAR("Para onde escalar quando o erro é do nosso lado."),
      termos: "api, ii-fluxo, ii-codigos-erro, Endpoint, JSON",
      saibaMais: ""
    }
  },
  ...AULAS_VIDAAS_SGACT,
  ...AULAS_INTEGRAICP,
  ...AULAS_GUIA_APIS
];

export const GLOSSARIO_PADRAO = [
  { termo: "A1", definicao: "Certificado digital cuja chave privada fica em um arquivo no computador (geralmente .pfx ou .p12).", tema: "certificado-tipos" },
  { termo: "A3", definicao: "Certificado digital cuja chave privada é gerada e fica protegida em hardware criptográfico: token, cartão inteligente ou HSM na nuvem. Validade de até 5 anos, conforme o DOC-ICP-04.", tema: "certificado-tipos" },
  { termo: "AIA", definicao: "Authority Information Access: extensão com os endereços para baixar o certificado da AC (cadeia) e consultar o OCSP.", tema: "campo-aia" },
  { termo: "AKI", definicao: "Authority Key Identifier: identificador (hash SHA-1) da chave da AC que assinou o certificado.", tema: "campo-identificador-chave" },
  { termo: "API", definicao: "Conjunto de regras que permite que um programa peça dados ou serviços a outro.", tema: "api" },
  { termo: "Assinatura digital", definicao: "Assinatura feita com a chave privada de um certificado; qualquer pessoa confere com a chave pública.", tema: "assinatura-digital-eletronica" },
  { termo: "Autoridade Certificadora (AC)", definicao: "Entidade credenciada que emite, assina e revoga certificados digitais.", tema: "pki" },
  { termo: "Autoridade de Registro (AR)", definicao: "Entidade que atende o cliente, confere identidade e documentos e encaminha o pedido para a AC.", tema: "icp-brasil" },
  { termo: "Cadeia de certificados", definicao: "Sequência que liga o certificado do titular à AC que emitiu e à AC Raiz; precisa estar instalada para o certificado ser reconhecido.", tema: "cadeia-certificacao" },
  { termo: "Certificado digital", definicao: "Identidade eletrônica de uma pessoa (e-CPF) ou empresa (e-CNPJ), emitida por uma AC.", tema: "certificado-digital" },
  { termo: "Certificado em nuvem", definicao: "Certificado A3 cuja chave fica em ambiente seguro na nuvem; o uso é autorizado por aplicativo, como o VIDaaS." },
  { termo: "Chave privada", definicao: "Parte secreta do par de chaves; só o titular tem e é com ela que se assina ou se decifra.", tema: "criptografia" },
  { termo: "Chave pública", definicao: "Parte do par de chaves que vai dentro do certificado; serve para conferir assinaturas.", tema: "campo-chave-publica" },
  { termo: "CN (Common Name)", definicao: "Nome principal de um certificado SSL, normalmente o domínio do site." },
  { termo: "CRL", definicao: "Certificate Revocation List (na ICP-Brasil, LCR): lista assinada pela AC com os números de série dos certificados revogados.", tema: "revogacao" },
  { termo: "CSR", definicao: "Pedido de certificado (Certificate Signing Request) com a chave pública e os dados do domínio, gerado no servidor." },
  { termo: "Direito de uso", definicao: "Período em que um certificado em nuvem pode ser usado, conforme o produto contratado." },
  { termo: "DV", definicao: "Certificado SSL de validação de domínio: confere só que o domínio pertence a quem pediu." },
  { termo: "e-CNPJ", definicao: "Certificado digital de pessoa jurídica (empresa)." },
  { termo: "e-CPF", definicao: "Certificado digital de pessoa física." },
  { termo: "ECC", definicao: "Criptografia de curvas elípticas: chaves menores que as do RSA com segurança equivalente (ECC de 256 bits ≈ RSA de 3072 bits).", tema: "criptografia" },
  { termo: "EKU", definicao: "Extended Key Usage (Uso avançado de chave): em quais aplicações o certificado pode ser usado, como Autenticação de Cliente e E-mail Seguro.", tema: "campo-uso-avancado" },
  { termo: "Endpoint", definicao: "Endereço (URL) onde uma API recebe pedidos.", tema: "ga-o-que-e" },
  { termo: "EV", definicao: "Certificado SSL de validação estendida, com a verificação mais rigorosa da organização." },
  { termo: "GET", definicao: "Método HTTP para buscar dados sem alterar nada; os parâmetros vão na URL.", tema: "ga-metodos-http" },
  { termo: "Hash", definicao: "Resumo de tamanho fixo calculado a partir de um conteúdo (ex.: SHA-256); qualquer mudança no conteúdo muda o hash por completo.", tema: "hash-sha" },
  { termo: "HSM", definicao: "Hardware Security Module: equipamento seguro que guarda chaves criptográficas, usado nos certificados em nuvem." },
  { termo: "HTTPS", definicao: "HTTP protegido por TLS; é o que faz aparecer o cadeado no navegador.", tema: "https" },
  { termo: "ICP-Brasil", definicao: "Infraestrutura de Chaves Públicas Brasileira: o sistema oficial de certificação digital do país.", tema: "icp-brasil" },
  { termo: "ITI", definicao: "Instituto Nacional de Tecnologia da Informação, a AC Raiz da ICP-Brasil.", tema: "icp-brasil" },
  { termo: "JSON", definicao: "Formato de texto com pares \"nome\": valor, muito usado nas respostas de API.", tema: "ga-formatos-dados" },
  { termo: "Key Usage", definicao: "Uso da chave: operações criptográficas que a chave pode fazer, como Assinatura Digital, Não-Recusa e Criptografia de Chaves.", tema: "campo-uso-chave" },
  { termo: "OCSP", definicao: "Online Certificate Status Protocol: consulta em tempo real se um certificado está válido, revogado ou desconhecido.", tema: "revogacao" },
  { termo: "OID", definicao: "Object Identifier: número único em formato de galhos (ex.: 2.16.76.1.2.3.36) que identifica políticas, algoritmos e campos.", tema: "campo-politicas" },
  { termo: "OV", definicao: "Certificado SSL que valida o domínio e a organização (CNPJ e razão social)." },
  { termo: "PFX", definicao: "Arquivo que junta o certificado e a chave privada, protegido por senha (também chamado .p12)." },
  { termo: "PIN", definicao: "Senha de uso de um token ou cartão inteligente." },
  { termo: "PKCS#11", definicao: "Padrão técnico para sistemas conversarem com tokens e cartões criptográficos." },
  { termo: "PKI", definicao: "Public Key Infrastructure (Infraestrutura de Chaves Públicas): o conjunto de regras, ACs e sistemas que dá confiança aos certificados.", tema: "pki" },
  { termo: "POST", definicao: "Método HTTP para enviar dados e criar algo novo.", tema: "ga-metodos-http" },
  { termo: "PUK", definicao: "Código para desbloquear um token ou cartão travado por erros de PIN." },
  { termo: "RSA", definicao: "Algoritmo de criptografia de chave pública; o número (2048, 4096) é o tamanho da chave.", tema: "rsa" },
  { termo: "SAN", definicao: "Subject Alternative Name (Nome alternativo do requerente): identificações extras do titular, como e-mail e, na ICP-Brasil, CPF e CNPJ por OID.", tema: "campo-san" },
  { termo: "SKI", definicao: "Subject Key Identifier: identificador (hash) da chave pública do próprio certificado; liga-se ao AKI dos certificados que ele assina.", tema: "campo-identificador-chave" },
  { termo: "SSL/TLS", definicao: "Tecnologia que cria a conexão criptografada entre navegador e site; TLS é a versão moderna do SSL.", tema: "ssl" },
  { termo: "Thumbprint", definicao: "Impressão digital: hash do certificado inteiro, usado para identificar exatamente um certificado.", tema: "campo-impressao-digital" },
  { termo: "Token", definicao: "Dispositivo USB que guarda a chave privada de um certificado A3." },
  { termo: "UTC", definicao: "Tempo Universal Coordenado: referência de horário usada nas datas de validade dos certificados.", tema: "utc" },
  { termo: "VIDaaS", definicao: "Aplicativo da Valid para certificado digital em nuvem.", tema: "vidaas" },
  { termo: "VIDaaS Connect", definicao: "Programa que liga o certificado em nuvem do VIDaaS aos sistemas do computador.", tema: "vidaas-connect" },
  { termo: "X.509", definicao: "Padrão internacional que define o formato dos certificados digitais (a versão atual, v3, permite extensões).", tema: "anatomia-certificado" },
  /* Termos das trilhas VIDaaS/SGACT e IntegraICP (versão 3) */
  { termo: "OAuth 2.0", definicao: "Padrão de autorização (o mesmo do “Entrar com Google”): a aplicação recebe um token sem ver a senha nem a chave privada do titular.", tema: "vs-oauth" },
  { termo: "client_id", definicao: "Identificador da aplicação do parceiro, gerado no cadastro; vale para um só ambiente.", tema: "vs-passo-1-cadastro" },
  { termo: "client_secret", definicao: "Segredo da aplicação, gerado junto com o client_id. Confidencial: nunca pode aparecer em chamado.", tema: "vs-seguranca" },
  { termo: "PKCE", definicao: "Proteção do OAuth (RFC 7636): a aplicação envia o code_challenge na autorização e prova o code_verifier original ao pedir o token.", tema: "vs-oauth" },
  { termo: "code_verifier", definicao: "Valor secreto gerado pela aplicação no PKCE; é enviado ao pedir o token (no IntegraICP, nos passos 5 e 6).", tema: "vs-passo-4-token" },
  { termo: "code_challenge", definicao: "Resumo (S256) do code_verifier, enviado na autorização (no IntegraICP, no passo 1).", tema: "vs-oauth" },
  { termo: "redirect_uri", definicao: "Endereço para onde a autorização volta; precisa ser igual (ou contido) ao cadastrado. push://… faz a autorização por notificação.", tema: "vs-passo-1-cadastro" },
  { termo: "user-discovery", definicao: "Chamada que verifica se o CPF/CNPJ tem certificado no Valid PSC e lista os slots; status “N” = sem certificado.", tema: "vs-passo-2-discovery" },
  { termo: "Slot", definicao: "Cada certificado disponível do titular no Valid PSC (slot_alias + label, ex.: “e-CPF A3 em nuvem gold”).", tema: "vs-passo-2-discovery" },
  { termo: "Escopo", definicao: "O que o token pode fazer (scope): single_signature, multi_signature, signature_session ou authentication_session.", tema: "vs-passo-3-autorizacao" },
  { termo: "Access token", definicao: "Token temporário (Bearer) entregue no passo do token; expira (ex.: 900 s = 15 min).", tema: "vs-passo-4-token" },
  { termo: "Bearer", definicao: "Forma de enviar o access token no cabeçalho: Authorization: Bearer <access_token>.", tema: "vs-passo-5-assinatura" },
  { termo: "PSC", definicao: "Prestador de Serviço de Confiança: guarda a chave privada do titular na nuvem; o uso é autorizado pelo app VIDaaS.", tema: "vs-conceitos" },
  { termo: "SGACT", definicao: "Serviço de carimbo do tempo da Valid (TST, RFC 3161), acessado por mTLS.", tema: "vs-sgact" },
  { termo: "TST", definicao: "Time-Stamp Token: o carimbo do tempo devolvido pelo SGACT (status 0 = sucesso).", tema: "vs-sgact" },
  { termo: "TSR", definicao: "TimeStamp Request: o pedido de carimbo do tempo, com o hash do dado.", tema: "vs-sgact" },
  { termo: "RFC 3161", definicao: "Padrão do carimbo do tempo (Time-Stamp Protocol) seguido pelo SGACT.", tema: "vs-sgact" },
  { termo: "mTLS", definicao: "TLS mútuo: cliente e servidor apresentam certificado; no SGACT, o certificado ICP-Brasil precisa estar cadastrado.", tema: "vs-sgact" },
  { termo: "Postman", definicao: "Ferramenta para montar e repetir chamadas de API; a collection “PSC API Integração V1.4” é a ferramenta do N2.", tema: "vs-postman" },
  { termo: "Channel", definicao: "No IntegraICP, a API-Key da aplicação; define os provedores. Channel errado → 400101.", tema: "ii-conceitos" },
  { termo: "Clearance", definicao: "No IntegraICP, o provedor apto a autenticar o titular (não é a lista de todo o mercado).", tema: "ii-conceitos" },
  { termo: "subject_key", definicao: "No IntegraICP, o CPF do titular, só números (sem máscara).", tema: "ii-conceitos" },
  { termo: "credentialId", definicao: "No IntegraICP, o ID devolvido na callback_uri; reusar após expirar → 403.", tema: "ii-conceitos" },
  { termo: "contentDigest", definicao: "No IntegraICP, o SHA-256 em Base64 padrão (44 caracteres); hex ou Base64 URL-safe → 400204.", tema: "ii-conceitos" },
  { termo: "CMS", definicao: "Formato de assinatura (PKCS#7) que embrulha a assinatura com o certificado; é o que se insere no PDF.", tema: "ii-faq-pdf" },
  { termo: "PAdES", definicao: "Perfil de assinatura digital para PDF (ex.: PAdES_AD_RT, PAdES_AD_RB).", tema: "ii-faq-pdf" },
  { termo: "CAdES", definicao: "Perfil de assinatura digital sobre CMS (ex.: CAdES_AD_RT, CAdES_AD_RB).", tema: "ii-faq-pdf" },
  { termo: "Rate limit", definicao: "Limite de chamadas num intervalo; acima dele a resposta é HTTP 429 (Too many requests).", tema: "ii-limites" },
  { termo: "Idempotência", definicao: "Repetir uma chamada sem efeito duplicado. No IntegraICP não existe: um reenvio gera nova assinatura e nova cobrança.", tema: "ii-faq-lote" },
  { termo: "trace_id", definicao: "Identificador de uma chamada nos logs (Datadog); registre no chamado antes de escalar.", tema: "ii-datadog" },
  /* Termos da trilha "API — O Guia Completo" (versão 4) */
  { termo: "API Gateway", definicao: "Ponto único de entrada que roteia, autentica e limita chamadas para vários serviços (a “portaria do condomínio”).", tema: "ga-arquitetura" },
  { termo: "API Key", definicao: "Chave secreta que identifica a aplicação que está chamando a API (não necessariamente o usuário).", tema: "ga-autenticacao" },
  { termo: "Autenticação", definicao: "Provar quem você é (“Quem é você?”). Falta de autenticação → HTTP 401.", tema: "ga-autenticacao" },
  { termo: "Autorização", definicao: "Definir o que você pode fazer (“O que você pode fazer?”). Autenticado, mas sem permissão → HTTP 403.", tema: "ga-autenticacao" },
  { termo: "Backoff", definicao: "Aumentar o tempo de espera entre retentativas (1 s, 2 s, 4 s...), de preferência com um pouco de aleatoriedade (jitter).", tema: "ga-performance" },
  { termo: "BFF", definicao: "Backend For Frontend: back-end dedicado a um tipo de cliente (ex.: um para o app, outro para o site).", tema: "ga-arquitetura" },
  { termo: "BOLA", definicao: "Broken Object Level Authorization: falha em verificar se o usuário pode acessar aquele objeto específico. Risco nº 1 do OWASP API Top 10.", tema: "ga-seguranca-owasp" },
  { termo: "Cache", definicao: "Cópia temporária de uma resposta para evitar refazer o trabalho; controlada pelo cabeçalho Cache-Control.", tema: "ga-performance" },
  { termo: "Circuit breaker", definicao: "Como o disjuntor de casa: se um serviço falha muito, para de chamá-lo por um tempo para evitar efeito cascata.", tema: "ga-performance" },
  { termo: "Content-Type", definicao: "Cabeçalho que diz o formato do corpo enviado, como application/json.", tema: "ga-formatos-dados" },
  { termo: "CORS", definicao: "Cross-Origin Resource Sharing: mecanismo do navegador que controla chamadas entre origens diferentes. Não substitui autenticação.", tema: "ga-seguranca-owasp" },
  { termo: "CRUD", definicao: "Create, Read, Update, Delete: as quatro operações básicas (POST, GET, PUT/PATCH, DELETE).", tema: "ga-metodos-http" },
  { termo: "curl", definicao: "Ferramenta de linha de comando para fazer chamadas HTTP; curl -v mostra a conversa inteira.", tema: "ga-consumindo" },
  { termo: "DELETE", definicao: "Método HTTP para remover um recurso; é idempotente.", tema: "ga-metodos-http" },
  { termo: "ETag", definicao: "Identificador da versão de um recurso; com If-None-Match, o servidor responde 304 se nada mudou.", tema: "ga-performance" },
  { termo: "GraphQL", definicao: "Linguagem de consulta em que o cliente escolhe os campos que quer, em um único endpoint.", tema: "ga-alem-do-rest" },
  { termo: "gRPC", definicao: "Framework de chamadas remotas binárias (Protocol Buffers) sobre HTTP/2, muito usado entre microsserviços.", tema: "ga-alem-do-rest" },
  { termo: "HATEOAS", definicao: "Respostas com links para as próximas ações possíveis (nível 3 do Modelo de Maturidade de Richardson).", tema: "ga-rest" },
  { termo: "Header", definicao: "Cabeçalho: metadado de uma requisição ou resposta HTTP, no formato chave: valor (ex.: Authorization, Content-Type).", tema: "ga-cliente-servidor-http" },
  { termo: "HTTP", definicao: "O protocolo que cliente e servidor usam para conversar na web: requisição (método + URL + cabeçalhos + corpo) e resposta (código de status + cabeçalhos + corpo).", tema: "ga-cliente-servidor-http" },
  { termo: "JWT", definicao: "JSON Web Token: token assinado em três partes (header, payload e assinatura). É assinado, não criptografado: não leva dados sensíveis.", tema: "ga-autenticacao" },
  { termo: "Latência", definicao: "Tempo entre enviar a requisição e receber a resposta; costuma ser medida no p95, não na média.", tema: "ga-observabilidade" },
  { termo: "MCP", definicao: "Model Context Protocol: padrão aberto para conectar aplicações de IA a ferramentas e APIs.", tema: "ga-brasil-ia" },
  { termo: "Mock", definicao: "Simulação de uma API para testes ou desenvolvimento, inclusive de respostas de erro e de lentidão.", tema: "ga-testando" },
  { termo: "OpenAPI", definicao: "Especificação padrão (antiga Swagger) para descrever APIs REST em YAML ou JSON; gera documentação, SDKs e mocks.", tema: "ga-openapi" },
  { termo: "OpenID Connect", definicao: "Camada sobre o OAuth 2.0 que adiciona autenticação: devolve um id_token (JWT) dizendo quem é o usuário.", tema: "ga-autenticacao" },
  { termo: "OWASP", definicao: "Organização aberta de segurança de aplicações; mantém o API Security Top 10 (2023).", tema: "ga-seguranca-owasp" },
  { termo: "PATCH", definicao: "Método HTTP para alterar só parte de um recurso.", tema: "ga-metodos-http" },
  { termo: "Payload", definicao: "O conteúdo “útil” de uma mensagem (o corpo da requisição ou da resposta).", tema: "ga-cliente-servidor-http" },
  { termo: "Polling", definicao: "Perguntar repetidamente se algo mudou (“já chegou?”); o webhook é a alternativa.", tema: "ga-alem-do-rest" },
  { termo: "Problem Details", definicao: "Formato padrão de erro em APIs (RFC 9457): type, title, status, detail e instance, com Content-Type application/problem+json.", tema: "ga-boas-praticas" },
  { termo: "PUT", definicao: "Método HTTP para substituir um recurso por completo; é idempotente. Campos não enviados são removidos.", tema: "ga-metodos-http" },
  { termo: "Query string", definicao: "Parte da URL depois do “?” (ex.: ?cor=azul&ordenar=preco), usada para filtrar, ordenar ou paginar.", tema: "ga-cliente-servidor-http" },
  { termo: "Refresh token", definicao: "Token de vida longa do OAuth, usado só para obter novos access tokens sem pedir login de novo.", tema: "ga-autenticacao" },
  { termo: "REST", definicao: "Estilo arquitetural baseado em recursos (URIs) e na semântica do HTTP; o padrão mais popular das Web APIs.", tema: "ga-rest" },
  { termo: "SDK", definicao: "Software Development Kit: biblioteca pronta que facilita o uso de uma API.", tema: "ga-o-que-e" },
  { termo: "Serialização", definicao: "Converter objetos da memória em texto ou bytes para transmissão (ex.: JSON.stringify); o inverso é a desserialização.", tema: "ga-formatos-dados" },
  { termo: "SLA", definicao: "Acordo de nível de serviço: a promessa contratual ao cliente (ex.: 99,5% de disponibilidade ao mês). SLI é o que se mede; SLO, a meta interna.", tema: "ga-observabilidade" },
  { termo: "SOAP", definicao: "Protocolo de mensagens XML com contrato WSDL; comum em bancos e governo (ex.: NF-e).", tema: "ga-alem-do-rest" },
  { termo: "SSE", definicao: "Server-Sent Events: conexão HTTP em que só o servidor envia eventos, um atrás do outro.", tema: "ga-alem-do-rest" },
  { termo: "Stateless", definicao: "Sem estado: o servidor não guarda sessão entre requisições; cada chamada traz tudo o que precisa (inclusive o token).", tema: "ga-rest" },
  { termo: "Status HTTP", definicao: "Código de três dígitos da resposta: 2xx sucesso, 3xx redirecionamento, 4xx erro do cliente, 5xx erro do servidor.", tema: "ga-codigos-status" },
  { termo: "Throughput", definicao: "Quantidade de requisições processadas por unidade de tempo.", tema: "ga-observabilidade" },
  { termo: "Web Service", definicao: "Termo mais antigo para “API acessível pela rede”, muito associado ao SOAP.", tema: "ga-o-que-e" },
  { termo: "Webhook", definicao: "Chamada HTTP que um serviço faz para avisar você de um evento (“não me ligue, eu te ligo”).", tema: "ga-alem-do-rest" },
  { termo: "WebSocket", definicao: "Conexão persistente e bidirecional entre cliente e servidor, para tempo real (chat, jogos).", tema: "ga-alem-do-rest" },
  { termo: "XML", definicao: "Formato de dados com marcações (<tag>), esquemas rígidos e namespaces; usado no SOAP e na NF-e.", tema: "ga-formatos-dados" }
];
