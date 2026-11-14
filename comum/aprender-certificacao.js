/*
 * Trilha "Certificação digital" (versão 2 do conteúdo da Aprendizagem - Tire suas dúvidas).
 * Fonte: anotações do time no Obsidian ("O que é um certificado digital" e
 * "Composição do certificado digital"), revisadas e conferidas com o DOC-ICP-04
 * do ITI e as RFCs citadas em "Para saber mais".
 * Imagens em fotos/aprender/certificado/ (recriações com dados fictícios).
 * Depois de publicado, o texto vale o que estiver no Firestore (edite pelo site).
 */
export const TEMAS_CERTIFICACAO = [
  {
    "id": "certificado-digital",
    "trilha": "certificacao",
    "paiId": null,
    "ordem": 1,
    "nivel": "Básico",
    "titulo": "O que é o certificado digital?",
    "resumo": "A identidade eletrônica de uma pessoa ou empresa, no padrão X.509, que permite assinar com validade jurídica.",
    "palavrasChave": [
      "certificado digital",
      "e-cpf",
      "e-cnpj",
      "x.509",
      "identidade eletrônica",
      "cer",
      "crt",
      "pem",
      "pfx",
      "p12",
      "p7b",
      "certmgr"
    ],
    "secoes": {
      "frase": "O **certificado digital** é a **identidade eletrônica** de uma pessoa física (e-CPF) ou jurídica (e-CNPJ): um arquivo no padrão internacional **X.509** que permite assinar documentos, validar transações e acessar serviços do governo com **validade jurídica** e alto nível de segurança.",
      "simples": "Pense numa **carteira de identidade** emitida por um órgão de confiança:\n\n- O RG tem seus dados, uma foto e o carimbo de quem emitiu.\n- O certificado tem seus dados, a sua **chave pública** (a \"foto\" matemática que só combina com a sua chave secreta) e a **assinatura da Autoridade Certificadora (AC)** que conferiu quem você é.\n\nQuando você assina um documento, é como reconhecer firma em cartório, só que pelo computador ou pelo celular. Quem recebe confere a assinatura com o certificado, e confere o certificado subindo até uma autoridade em que o sistema já confia.\n\n![Mapa mental resumido do certificado digital: identidade, validade, chaves, assinatura da AC, confiança, revogação, permissões e identificação](fotos/aprender/certificado/mapa-mental-resumo.svg)\n\nO mapa completo, com cada campo explicado, está em [Anatomia do certificado](#anatomia-certificado).",
      "funciona": "### O que vem dentro de um arquivo .cer\n\nA estrutura segue o padrão **X.509**. Ao abrir o arquivo no Windows (ou no terminal), aparecem estes blocos principais:\n\n| Campo | O que representa | Explicação completa |\n| --- | --- | --- |\n| **Requerente (Subject)** | Quem é o dono: nome, CPF/CNPJ, razão social, e-mail | [Validade e requerente](#campo-validade-requerente) |\n| **Emissor (Issuer)** | Qual Autoridade Certificadora assinou e validou o certificado | [Emissor](#campo-emissor) |\n| **Validade** | Início (*Not Before*) e expiração (*Not After*) | [Validade e requerente](#campo-validade-requerente) |\n| **Chave pública** | O algoritmo (geralmente RSA ou ECC) e o valor da chave usada para validar assinaturas | [Chave pública](#campo-chave-publica) |\n| **Algoritmo de assinatura** | Como a AC assinou o arquivo (ex.: `sha256RSA`) | [Algoritmo de assinatura](#campo-algoritmo-assinatura) |\n| **Impressão digital (Thumbprint)** | Um hash do certificado inteiro, usado para identificá-lo e ver se não foi adulterado | [Impressão digital](#campo-impressao-digital) |\n\n### O que é o X.509\n\nO **X.509** é o padrão internacional que define o formato dos **certificados de chave pública**. É o \"esqueleto\" que determina como a identidade digital de uma pessoa, empresa ou site é estruturada e validada.\n\n- Foi criado pela **União Internacional de Telecomunicações (ITU-T)** em **1988**.\n- A versão usada hoje é a **v3**, que permite **extensões** (veja [Versão](#campo-versao)).\n- Ele garante a **interoperabilidade**: um certificado emitido no Brasil por uma AC da ICP-Brasil pode ser lido por qualquer navegador, servidor ou sistema operacional do mundo. Sem um padrão, cada empresa ou governo criaria certificados em formatos diferentes.\n\n### Onde o X.509 é usado\n\n- **e-CPF e e-CNPJ:** assinaturas digitais com validade jurídica.\n- **HTTPS (SSL/TLS):** o cadeado dos sites usa certificados X.509 para proteger a navegação.\n- **E-mail seguro (S/MIME):** assinar e criptografar e-mails corporativos.\n- **Autenticação em redes (802.1X, VPN):** validar dispositivos e usuários antes de liberar o acesso.\n\n### Formatos de arquivo mais comuns\n\n| Extensão | O que contém | Tem a chave privada? |\n| --- | --- | --- |\n| `.cer` / `.crt` | Só o certificado, em binário (DER) ou em texto Base64 | Não |\n| `.pem` | Certificado (ou cadeia) em texto Base64, entre `-----BEGIN CERTIFICATE-----` e `-----END CERTIFICATE-----` | Normalmente não (pode ter, se for um PEM de chave) |\n| `.p7b` / `.p7c` | Um ou mais certificados juntos, geralmente a **cadeia** da AC (PKCS#7) | Não |\n| `.pfx` / `.p12` | Certificado **e** chave privada, protegidos por senha (PKCS#12). É assim que um A1 costuma ser entregue e copiado | **Sim** |\n| `.crl` | Uma lista de certificados revogados publicada pela AC | Não se aplica |\n| `.csr` | O pedido de certificado (usado em certificados SSL) | Não |\n\n> [!dica] Regra prática\n> Se o arquivo tem senha para abrir e serve para \"instalar o certificado\", ele tem a chave privada (`.pfx`/`.p12`): trate como algo pessoal e secreto. Os arquivos `.cer`, `.crt` e `.p7b` podem ser enviados à vontade: só têm a parte pública.\n\n### Como abrir os detalhes de um certificado no Windows\n\n:::passo 1\n**Pelo arquivo:** dê dois cliques no arquivo `.cer` ou `.crt`. Abre a janela **Certificado**.\n:::\n\n:::passo 2\n**Pelo repositório do usuário:** aperte `Windows + R`, digite `certmgr.msc` e dê Enter. Abra **Pessoal › Certificados** e dê dois cliques no certificado. Um A3 em token só aparece aqui com o token conectado.\n:::\n\n:::passo 3\nNa aba **Geral**, confira o titular, o emissor e as datas de validade.\n:::\n\n:::passo 4\nNa aba **Detalhes**, deixe **Mostrar: <Todas>** e clique em cada campo. O valor completo aparece na caixa de baixo. Os campos estão explicados um a um em [Anatomia do certificado](#anatomia-certificado).\n:::\n\n:::passo 5\nNa aba **Caminho de Certificação**, veja a cadeia até a AC Raiz. Um \"X\" vermelho em algum nível indica cadeia incompleta, certificado vencido ou revogado (veja [Cadeia de certificação](#cadeia-certificacao)).\n:::\n\nPelo PowerShell, para listar os certificados pessoais com titular, validade e impressão digital:\n\n```powershell\nGet-ChildItem Cert:\\CurrentUser\\My | Format-List Subject, Issuer, NotAfter, Thumbprint\n```\n\nE para ver todos os campos de um arquivo:\n\n```powershell\ncertutil -dump \"C:\\caminho\\certificado.cer\"\n```\n\n### Resumo da trilha\n\n1. **O que é:** identidade eletrônica no padrão X.509, com validade jurídica quando é ICP-Brasil. Tipos em [A1, A3 e nuvem](#certificado-tipos); diferença para assinatura eletrônica em [Assinatura digital × eletrônica](#assinatura-digital-eletronica).\n2. **Por que confiamos nele:** a [PKI](#pki) e a [ICP-Brasil](#icp-brasil), com a [cadeia de certificação](#cadeia-certificacao) e a [revogação](#revogacao).\n3. **A matemática:** [chaves e RSA](#rsa), [assinatura RSA](#rsa-matematica), [hash](#hash-sha) e [datas em UTC](#utc).\n4. **Cada campo do certificado:** [Anatomia do certificado](#anatomia-certificado).",
      "exemplo": "**Cliente diz que o certificado \"não aparece\" no portal.** Confira, nesta ordem:\n\n1. **Validade:** o certificado está no prazo? Veja **Válido até** na aba Geral.\n2. **Finalidade:** o portal pede login com certificado, que exige **Autenticação de Cliente** no [Uso avançado de chave (EKU)](#campo-uso-avancado).\n3. **Onde está instalado:** no `certmgr.msc`, em **Pessoal › Certificados**? Se for A3, o token ou cartão está conectado?\n4. **Cadeia:** na aba **Caminho de Certificação** aparece algum erro? Veja [Cadeia de certificação](#cadeia-certificacao).\n\n> [!atencao] A confirmar com o time\n> Ordem de checagem e roteiro oficial do time para \"certificado não aparece\" em cada portal (navegador, middleware do token, componente de assinatura).\n\n**Cliente quer mandar o certificado por e-mail para outra pessoa assinar.** Explique a diferença: o `.cer` (só a parte pública) pode ser enviado; o `.pfx` contém a chave privada e **não deve ser compartilhado**. Quem assina em nome do titular é o próprio titular.",
      "duvidas": "### Certificado digital e assinatura digital são a mesma coisa?\nNão. O certificado é a **identidade** (o arquivo com seus dados e sua chave pública). A assinatura digital é o **ato** de assinar um documento usando a chave privada que corresponde a esse certificado. Veja [Assinatura digital × eletrônica](#assinatura-digital-eletronica).\n\n### O arquivo .cer é o meu certificado inteiro?\nÉ a parte pública dele. Quem tem só o `.cer` consegue **conferir** suas assinaturas, mas não consegue **assinar** por você: para isso é preciso a chave privada, que fica no `.pfx` (A1), no token ou cartão (A3) ou na nuvem.\n\n### Por que o certificado tem validade?\nPorque a identidade e a segurança das chaves precisam ser revistas de tempos em tempos. Depois do **Not After**, o certificado deixa de ser aceito para novas assinaturas. Assinaturas feitas dentro da validade continuam conferíveis (especialmente com carimbo do tempo; veja [UTC](#utc)).",
      "termos": "certificado-tipos, assinatura-digital-eletronica, pki, anatomia-certificado, X.509, Chave privada, Chave pública, vidaas",
      "saibaMais": "- [ITI — Instituto Nacional de Tecnologia da Informação](https://www.gov.br/iti/pt-br)\n- [RFC 5280 — perfil dos certificados X.509 na internet (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)\n- [Microsoft Learn — certutil](https://learn.microsoft.com/pt-br/windows-server/administration/windows-commands/certutil)"
    }
  },
  {
    "id": "certificado-tipos",
    "trilha": "certificacao",
    "paiId": "certificado-digital",
    "ordem": 1,
    "nivel": "Básico",
    "titulo": "Tipos: A1, A3 e em nuvem",
    "resumo": "Onde fica a chave privada, quanto tempo vale e para que serve cada tipo de certificado.",
    "palavrasChave": [
      "a1",
      "a3",
      "nuvem",
      "token",
      "smartcard",
      "cartão",
      "hsm",
      "vidaas",
      "validade",
      "pfx"
    ],
    "secoes": {
      "frase": "O que diferencia os tipos de certificado é **onde a chave privada fica guardada**: num arquivo no computador (**A1**), num dispositivo criptográfico como token ou cartão (**A3**) ou num ambiente seguro na nuvem (**A3 em nuvem**, como o VIDaaS).",
      "simples": "Pense na chave privada como a chave de casa:\n\n- **A1** é a chave guardada na gaveta (um arquivo no computador). Dá para fazer cópia, o que é prático e também mais arriscado.\n- **A3 em token ou cartão** é a chave num chaveiro que não deixa copiar: a chave nasce e fica dentro do dispositivo.\n- **A3 em nuvem** é a chave num cofre de banco: fica num equipamento seguro (HSM) e você autoriza o uso pelo celular.",
      "funciona": "| Tipo | Onde fica a chave privada | Validade máxima | Indicado para |\n| --- | --- | --- | --- |\n| **A1** | Em um arquivo no computador ou dispositivo (`.pfx`/`.p12`) | **1 ano** | Uso automatizado: permite cópia de segurança e uso em vários sistemas ao mesmo tempo (ex.: emissão de NF-e por sistema) |\n| **A3** (token USB ou cartão inteligente) | Dentro do dispositivo criptográfico, onde o par de chaves é gerado | **até 5 anos** | Assinatura pessoal com mais proteção contra cópia não autorizada |\n| **A3 em nuvem** | Em um HSM de um prestador de serviço de confiança (PSC); uso autorizado por aplicativo | **até 5 anos** | Assinar sem token, autorizando pelo celular (veja [VIDaaS](#vidaas)) |\n\n> [!info] Validade conforme o DOC-ICP-04\n> A tabela de períodos máximos do DOC-ICP-04 vigente (Tabela 6) traz **5 anos para o A3**. As anotações antigas do time citavam \"1 a 3 anos\": os produtos à venda podem ter prazos menores que o máximo permitido.\n\n> [!atencao] Mudança de nomenclatura na ICP-Brasil\n> A Resolução CG ICP-Brasil nº 211/2024 (DOC-ICP-04 v8.2 em diante) reorganizou os tipos de certificado de usuário final: **A3 e A4** passaram a ser certificados de assinatura **só para pessoa física**; para pessoa jurídica surgiram os **selos eletrônicos SE-S (em software) e SE-H (em hardware)**; e há os tipos **AE-S/AE-H** (aplicações específicas), **T3/T4** (carimbo do tempo), **A CF-e-SAT** e **OM-BR**. O tipo **A1** não aparece mais nessa lista.\n\n> [!atencao] A confirmar com o time\n> Como a Valid está aplicando a nova nomenclatura (A1, e-CNPJ, SE-S/SE-H) nos produtos vendidos hoje, e até quando os certificados A1 emitidos antes da mudança continuam válidos e à venda.\n\n### Como identificar o tipo no certificado\n\nA política de certificado (campo **Políticas Dos Certificados**) informa o tipo pelo OID. Pelo DOC-ICP-04, os certificados **A3** usam OIDs do formato `2.16.76.1.2.3.n`. Veja [Políticas de certificado](#campo-politicas).",
      "exemplo": "**Cliente comprou A1 e diz que \"sumiu\" depois de formatar o computador.** O A1 é um arquivo: se não havia cópia do `.pfx` (com a senha), ele se perdeu junto com o sistema.\n\n> [!atencao] A confirmar com o time\n> Procedimento interno para A1 perdido (nova emissão, revogação do anterior, cobrança).\n\n**Cliente com A3 em token não consegue usar em outro computador.** O token precisa do driver/middleware instalado na nova máquina. A chave não sai do token, então não há \"arquivo\" para copiar.",
      "duvidas": "### Posso copiar um A3 para outro computador?\nNão. A chave privada do A3 não sai do token, do cartão ou da nuvem. Leve o token ou cartão; no caso da nuvem, use o aplicativo.\n\n### O A1 é menos seguro?\nEle é mais exposto, porque o arquivo pode ser copiado. Com senha forte e cópia guardada com cuidado, é seguro para o uso a que se destina (ex.: sistemas que assinam sozinhos).\n\n### Certificado em nuvem é A3?\nSim. A chave fica num equipamento criptográfico (HSM) do prestador de serviço de confiança, com as mesmas exigências de proteção do A3.",
      "termos": "certificado-digital, A1, A3, Certificado em nuvem, HSM, Token, vidaas, campo-politicas",
      "saibaMais": "- [ITI — Documentos principais (DOC-ICP-04 e demais resoluções)](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais)"
    }
  },
  {
    "id": "assinatura-digital-eletronica",
    "trilha": "certificacao",
    "paiId": "certificado-digital",
    "ordem": 2,
    "nivel": "Básico",
    "titulo": "Assinatura digital × assinatura eletrônica",
    "resumo": "Os três níveis da Lei 14.063/2020 e por que a assinatura digital ICP-Brasil tem presunção de veracidade.",
    "palavrasChave": [
      "assinatura eletrônica",
      "assinatura digital",
      "qualificada",
      "avançada",
      "simples",
      "lei 14.063",
      "gov.br",
      "presunção",
      "mp 2.200-2"
    ],
    "secoes": {
      "frase": "**Assinatura eletrônica** é o gênero (qualquer forma eletrônica de assinar); **assinatura digital** é uma espécie, a mais segura: feita com um **certificado digital ICP-Brasil**, que a lei chama de **assinatura qualificada**.",
      "simples": "Pense em \"veículo\" e \"carro\": todo carro é veículo, mas nem todo veículo é carro. Toda assinatura digital é eletrônica, mas nem toda assinatura eletrônica é digital.\n\nUm clique em \"Li e aceito\" é uma assinatura eletrônica simples. Uma assinatura com e-CPF é digital: ela \"costura\" matematicamente o documento ao assinante.",
      "funciona": "A **Lei nº 14.063/2020** classificou as assinaturas eletrônicas em três níveis:\n\n| Tipo | Categoria | Como identifica quem assina | Uso indicado |\n| --- | --- | --- | --- |\n| **Simples** | Assinatura eletrônica | Dados básicos: login e senha, e-mail, IP, clique em botão de confirmação | Baixo risco: agendamentos, cadastros simples, transações do dia a dia |\n| **Avançada** | Assinatura eletrônica | Fatores adicionais: código por SMS/WhatsApp, biometria facial, código de uso único (OTP) ou conta **gov.br** nível prata ou ouro | Risco médio: a maioria dos contratos comerciais, termos administrativos e processos públicos |\n| **Qualificada** | **Assinatura digital** | **Obrigatoriamente um certificado digital ICP-Brasil** (e-CPF/e-CNPJ), baseado em PKI | Nível mais alto: exigida em casos previstos em lei, como os atos de transferência e registro de imóveis citados na Lei 14.063/2020, e usada nos documentos fiscais eletrônicos (como a NF-e), por exigência das normas fiscais |\n\n### Principais diferenças técnicas\n\n1. **Uso de criptografia assimétrica (PKI)**\n   - **Eletrônica:** depende das regras da plataforma que intermediou o acordo (registro de e-mails, logs de acesso, geolocalização).\n   - **Digital:** usa o par de chaves pública/privada do certificado X.509 da ICP-Brasil. A assinatura fica ligada matematicamente ao documento (veja [A matemática da assinatura RSA](#rsa-matematica)).\n2. **Inviolabilidade do documento**\n   - **Eletrônica:** se o documento for alterado depois de assinado, a plataforma precisa apresentar logs para provar a adulteração.\n   - **Digital:** a integridade é verificada automaticamente. Se alguém mudar um único espaço ou vírgula do PDF, o hash muda e o leitor acusa a assinatura como inválida (veja [Hash](#hash-sha)).\n3. **Presunção legal de veracidade**\n   - **Eletrônica:** aceita desde que as partes concordem com o método usado.\n   - **Digital (qualificada):** os documentos assinados com certificado ICP-Brasil **presumem-se verdadeiros em relação aos signatários** (art. 10, §1º, da MP 2.200-2/2001). Isso dá a chamada **não repúdio**: fica muito difícil negar a autoria.\n\n![Fluxo da assinatura digital: o documento vira hash, o hash é assinado com a chave privada; quem recebe recalcula o hash e compara com o extraído da assinatura usando a chave pública](fotos/aprender/certificado/assinatura-fluxo.svg)",
      "exemplo": "**Assinatura aparece como inválida no leitor de PDF.** As causas mais comuns:\n\n1. **O documento foi alterado depois de assinado** (até salvar de novo em outro programa pode mudar o arquivo). O hash não confere mais: veja [Hash](#hash-sha).\n2. **Cadeia incompleta:** o computador não tem a AC intermediária e não conseguiu baixá-la pelo AIA. Veja [Cadeia de certificação](#cadeia-certificacao) e [AIA](#campo-aia).\n3. **Certificado revogado ou vencido no momento da assinatura.** Veja [Revogação](#revogacao).\n\nPara conferir de forma independente, o **Validador ITI** analisa o arquivo assinado segundo as regras da ICP-Brasil.\n\n> [!atencao] A confirmar com o time\n> Roteiro do time para orientar o cliente no Validador ITI e o que registrar no chamado.",
      "duvidas": "### Assinatura pelo gov.br é assinatura digital?\nPela Lei 14.063/2020, a assinatura com conta gov.br prata ou ouro é **avançada**, não qualificada. A qualificada (digital) exige certificado ICP-Brasil.\n\n### \"Não repúdio\" quer dizer que é impossível contestar?\nQuer dizer que a lei presume que a assinatura é do titular do certificado. A contestação continua possível na Justiça, mas quem contesta precisa provar o contrário. As anotações antigas falavam em presunção \"absoluta\"; o texto da MP fala em presunção de veracidade, sem esse adjetivo.",
      "termos": "certificado-digital, rsa-matematica, hash-sha, Assinatura digital, icp-brasil",
      "saibaMais": "- [Lei nº 14.063/2020 (Planalto)](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm)\n- [Medida Provisória nº 2.200-2/2001 (Planalto)](https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm)\n- [Validador ITI](https://validar.iti.gov.br/)"
    }
  },
  {
    "id": "pki",
    "trilha": "certificacao",
    "paiId": null,
    "ordem": 2,
    "nivel": "Intermediário",
    "titulo": "Como a confiança funciona: PKI",
    "resumo": "Os quatro pilares da infraestrutura de chaves públicas e como um documento assinado é validado na prática.",
    "palavrasChave": [
      "pki",
      "icp",
      "infraestrutura de chaves públicas",
      "confiança",
      "ar",
      "ac",
      "cadeia",
      "revogação"
    ],
    "secoes": {
      "frase": "**PKI** (Infraestrutura de Chaves Públicas, que no Brasil é a **ICP-Brasil**) é o conjunto de regras, autoridades e tecnologias que permite confiar que uma chave pública pertence mesmo a quem diz ser.",
      "simples": "Pense na emissão de passaportes: há um governo que define as regras, um órgão que emite, postos que conferem seus documentos pessoalmente e uma lista de passaportes cancelados. Ninguém confia num passaporte \"feito em casa\", só nos emitidos por quem faz parte desse sistema.",
      "funciona": "### Os 4 pilares da PKI\n\n**1. Criptografia assimétrica (o par de chaves).** Todo certificado tem duas chaves matematicamente ligadas:\n\n- **Chave privada:** fica só com o titular (no token, no cartão, no computador ou na nuvem). Serve para **assinar** ou **descriptografar**.\n- **Chave pública:** vai dentro do certificado e pode ser compartilhada. Serve para **validar a assinatura** ou **criptografar** dados para o titular.\n\nDetalhes em [Chaves pública e privada e o RSA](#rsa).\n\n**2. Hierarquia de confiança (a cadeia de certificação).** Para ninguém criar um certificado falso em nome de outra pessoa, as autoridades formam uma pirâmide:\n\n- **AC Raiz:** a autoridade máxima do ecossistema (no Brasil, a da ICP-Brasil, mantida pelo ITI). A chave pública da raiz já vem instalada nos sistemas e navegadores.\n- **AC intermediária:** autorizada e assinada pela raiz (ou por outra intermediária) para emitir certificados em escala.\n- **Certificado final:** o seu, assinado por uma AC.\n\n```texto\n[ AC Raiz (ICP-Brasil) ]  <- o sistema confia de fábrica\n          |\n          v\n[ AC intermediária ]       <- assinada pela raiz\n          |\n          v\n[ Seu certificado (e-CPF / e-CNPJ) ]  <- assinado pela AC\n```\n\nDetalhes em [Cadeia de certificação](#cadeia-certificacao).\n\n**3. Agente de validação (a Autoridade de Registro, AR).** Antes da emissão, uma **AR** confere a identidade da pessoa ou empresa (presencialmente, por biometria ou por videoconferência) e os documentos (RG, CNH, contrato social), garantindo que você é quem diz ser antes de a AC emitir.\n\n**4. Gestão do ciclo de vida e revogação.** A PKI controla os certificados em circulação. Se uma chave privada for comprometida, o certificado é **revogado** e entra nas listas de consulta (**CRL** e **OCSP**), avisando qualquer sistema que tentar validá-lo. Detalhes em [Revogação](#revogacao).\n\n### Na prática: assinando um documento\n\n1. **Geração da assinatura:** o programa calcula o **hash** (resumo matemático) do documento e o assina com a sua **chave privada**.\n2. **Envio:** o documento segue com a assinatura e com o seu certificado (que contém a chave pública).\n3. **Validação por quem recebe:**\n   - o sistema usa a **chave pública** do certificado para conferir a assinatura e verificar que o documento não foi alterado;\n   - depois, sobe a **cadeia** para confirmar que a AC é confiável e que o certificado não está vencido nem revogado.\n\n![Cadeia de certificação: AC Raiz Brasileira, AC intermediária, AC VALID RFB v5 e certificado do titular](fotos/aprender/certificado/cadeia-certificacao.svg)\n\n### Resumo da trilha\n\n- A confiança vem da **hierarquia**: [ICP-Brasil e o papel do ITI](#icp-brasil).\n- Cada certificado é conferido \"subindo a escada\": [Cadeia de certificação](#cadeia-certificacao).\n- Certificados cancelados são avisados por listas e consultas: [Revogação: CRL, OCSP e OCSP Stapling](#revogacao).",
      "exemplo": "**\"O certificado é válido, mas o sistema diz que não é confiável.\"** Em geral, a validação parou em algum ponto da PKI: falta a AC intermediária no computador, a cadeia não chega a uma raiz confiável ou a consulta de revogação falhou. Abra o certificado e veja a aba **Caminho de Certificação**.",
      "duvidas": "### PKI e ICP são a mesma coisa?\nPKI é o nome genérico (*Public Key Infrastructure*). ICP-Brasil é a PKI oficial do Brasil.\n\n### Quem confere meus documentos é a AC?\nNormalmente é a **AR** (Autoridade de Registro), que atende o cliente. A AC emite e assina o certificado depois que a AR aprova.",
      "termos": "icp-brasil, cadeia-certificacao, revogacao, rsa, PKI, Autoridade Certificadora (AC), Autoridade de Registro (AR)",
      "saibaMais": "- [ITI — Instituto Nacional de Tecnologia da Informação](https://www.gov.br/iti/pt-br)\n- [RFC 5280 — certificados X.509 e listas de revogação (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "icp-brasil",
    "trilha": "certificacao",
    "paiId": "pki",
    "ordem": 1,
    "nivel": "Básico",
    "titulo": "ICP-Brasil e o papel do ITI",
    "resumo": "A pirâmide oficial de confiança do Brasil: Comitê Gestor, ITI (AC Raiz), ACs, ARs e prestadores de serviço.",
    "palavrasChave": [
      "icp-brasil",
      "iti",
      "ac raiz",
      "cg icp-brasil",
      "comitê gestor",
      "ac",
      "ar",
      "pss",
      "psc",
      "psbio",
      "mp 2.200-2",
      "validador iti"
    ],
    "secoes": {
      "frase": "A **ICP-Brasil** (Infraestrutura de Chaves Públicas Brasileira) é a PKI oficial do país, criada pela **Medida Provisória nº 2.200-2/2001**. O **ITI** é a sua **AC Raiz** e o órgão que credencia, audita e fiscaliza as demais entidades.",
      "simples": "Funciona como uma árvore genealógica da confiança: no topo, quem dita as regras (o Comitê Gestor); logo abaixo, quem guarda a \"chave-mestra\" do país (o ITI); depois, as empresas autorizadas a emitir (ACs) e os balcões de atendimento (ARs). Como cada nível foi autorizado pelo de cima, qualquer sistema consegue conferir um certificado subindo a árvore.",
      "funciona": "![Hierarquia da ICP-Brasil: CG ICP-Brasil no topo, ITI como AC Raiz, ACs de 1º e 2º nível, ARs e, na base, os prestadores PSS, PSC e PSBio](fotos/aprender/certificado/hierarquia-icp-brasil.svg)\n\n### A hierarquia\n\n| Nível | Entidade | Papel e responsabilidades |\n| --- | --- | --- |\n| **Normativo** | **CG ICP-Brasil** (Comitê Gestor) | Órgão com representantes do governo e da sociedade que define as políticas, as regras técnicas e as resoluções de todo o sistema |\n| **Executivo / técnico** | **ITI** (AC Raiz) | Autarquia federal que executa as regras do Comitê, gerencia a chave raiz do país e credencia e audita as demais entidades |\n| **Emissor** | **ACs** (Autoridades Certificadoras) | Entidades públicas ou privadas credenciadas para emitir, renovar e revogar certificados. Podem ser de 1º nível (assinadas pela raiz) ou de 2º nível (assinadas por uma AC de 1º nível) |\n| **Operacional** | **ARs** (Autoridades de Registro) | Postos que identificam o titular presencialmente, por biometria ou por videoconferência antes da emissão |\n| **Suporte tecnológico** | **PSS / PSC / PSBio** | Prestadores de Serviço de Suporte, de Confiança (como a guarda de chaves em nuvem/HSM) e de Biometria, com infraestrutura homologada |\n\n### O papel do ITI\n\nO **ITI (Instituto Nacional de Tecnologia da Informação)** é uma autarquia federal vinculada à Casa Civil da Presidência da República. Tem dois papéis:\n\n**1. AC Raiz**\n\n- Mantém e guarda o par de chaves primário do Brasil.\n- **Não emite certificados para cidadãos ou empresas.**\n- Sua função criptográfica é assinar os certificados das **ACs de 1º nível**, tornando-as válidas em todo o país.\n\n**2. Órgão fiscalizador e regulador**\n\n- **Credenciamento:** avalia a infraestrutura física, lógica e financeira de quem quer ser AC, AR ou prestador de serviço.\n- **Auditoria:** fiscaliza periodicamente ACs e ARs.\n- **Revogação:** publica as listas de revogação das ACs que a raiz assina e define as regras que as ACs seguem para revogar.\n- **Validação:** oferece o **Validador ITI**, ferramenta gratuita para conferir assinaturas digitais segundo o padrão nacional.\n\n> [!nota] Sobre a imagem da hierarquia\n> As anotações originais usavam uma imagem externa gerada por IA. Ela foi substituída pelo diagrama acima, feito para esta página.",
      "exemplo": "**Cliente pergunta se o certificado \"é da Valid ou do governo\".** Os dois: a AC da Valid emite e assina o certificado, e a AC da Valid é credenciada e assinada dentro da cadeia da ICP-Brasil, cuja raiz é mantida pelo ITI. Na aba **Caminho de Certificação** dá para mostrar isso ao cliente.\n\n**\"Onde confiro se a assinatura vale?\"** No **Validador ITI**, que segue as regras da ICP-Brasil.",
      "duvidas": "### O ITI emite certificado para pessoas?\nNão. Ele só assina os certificados das ACs de 1º nível. Quem emite para pessoas e empresas são as ACs credenciadas.\n\n### Certificado de fora da ICP-Brasil vale?\nPode valer entre partes que aceitem aquele certificado, mas só o ICP-Brasil tem a presunção de veracidade da MP 2.200-2/2001 (veja [Assinatura digital × eletrônica](#assinatura-digital-eletronica)).",
      "termos": "pki, cadeia-certificacao, ITI, Autoridade Certificadora (AC), Autoridade de Registro (AR), assinatura-digital-eletronica",
      "saibaMais": "- [ITI — Instituto Nacional de Tecnologia da Informação](https://www.gov.br/iti/pt-br)\n- [ITI — Documentos principais da ICP-Brasil](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais)\n- [Medida Provisória nº 2.200-2/2001 (Planalto)](https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm)\n- [Validador ITI](https://validar.iti.gov.br/)"
    }
  },
  {
    "id": "cadeia-certificacao",
    "trilha": "certificacao",
    "paiId": "pki",
    "ordem": 2,
    "nivel": "Intermediário",
    "titulo": "Cadeia de certificação",
    "resumo": "Como o sistema \"sobe a escada\" do seu certificado até a AC Raiz, e o que fazer quando a cadeia está incompleta.",
    "palavrasChave": [
      "cadeia",
      "caminho de certificação",
      "ac raiz",
      "ac intermediária",
      "p7b",
      "aia",
      "aki",
      "ski",
      "chain"
    ],
    "secoes": {
      "frase": "A **cadeia de certificação** é a sequência de certificados que liga o seu certificado a uma **AC Raiz** confiável: cada um é assinado pelo de cima, e o sistema confere elo por elo.",
      "simples": "É como conferir uma procuração assinada por um gerente: você confere a assinatura do gerente, depois a de quem nomeou o gerente, até chegar a alguém em quem você já confia. Se faltar um elo no meio, a confiança não se fecha.",
      "funciona": "![Cadeia de certificação: AC Raiz Brasileira, mantida pelo ITI; AC intermediária; AC VALID RFB v5; certificado do titular](fotos/aprender/certificado/cadeia-certificacao.svg)\n\n### Como a validação acontece\n\n1. O seu certificado (final) foi assinado pela **AC emissora**, por exemplo a **AC VALID RFB v5** (campo [Emissor](#campo-emissor)).\n2. O certificado dessa AC foi assinado por uma **AC de nível acima**.\n3. No topo está a **AC Raiz** da ICP-Brasil, cuja chave pública o sistema operacional ou o navegador **já tem instalada**.\n4. O sistema valida as assinaturas **subindo a escada** até a raiz. Se todos os elos forem válidos e nenhum certificado estiver vencido ou revogado, a identidade é confirmada.\n\n> [!atencao] A confirmar com o time\n> Nomes exatos das ACs intermediárias da cadeia de cada produto (por exemplo, para a AC VALID RFB v5). Eles aparecem na aba \"Caminho de Certificação\" do certificado do cliente.\n\n### Como o sistema encontra cada elo\n\n- **Emissor:** diz o nome da AC que assinou ([Emissor](#campo-emissor)).\n- **Identificador da chave da autoridade (AKI):** diz qual chave da AC foi usada; ele bate com o **SKI** do certificado da AC ([Identificadores de chave](#campo-identificador-chave)).\n- **AIA:** traz o endereço para **baixar o certificado da AC** quando o computador não o tem ([AIA](#campo-aia)).\n\n### Onde ver no Windows\n\nAbra o certificado e vá à aba **Caminho de Certificação**. A árvore mostra a raiz no topo e o seu certificado embaixo. Clicando num nível e em **Exibir Certificado**, você abre o certificado daquela AC.",
      "exemplo": "**Assinatura ou login falha com \"cadeia de certificados incompleta\" ou \"não confiável\".**\n\n1. Abra o certificado e veja a aba **Caminho de Certificação**: algum nível aparece com erro?\n2. Se faltar a AC intermediária, o normal é o sistema baixá-la pelo **AIA**. Em redes que bloqueiam esse download, é preciso instalar a cadeia (arquivo `.p7b` da AC).\n3. Confira se o relógio do computador está certo: data errada faz certificados válidos parecerem vencidos (veja [UTC](#utc)).\n\n> [!atencao] A confirmar com o time\n> Link oficial e passo a passo do time para instalar a cadeia de cada produto quando o AIA está bloqueado.",
      "duvidas": "### Por que o meu computador \"já confia\" na raiz?\nPorque os certificados das ACs Raiz (inclusive a da ICP-Brasil) são distribuídos com o sistema operacional, os navegadores ou os programas de assinatura. Em alguns ambientes, a raiz da ICP-Brasil precisa ser instalada à parte.\n\n### Posso instalar a cadeia sem riscos?\nSim, desde que venha da fonte oficial da AC: os certificados das ACs são públicos e não contêm chaves privadas.",
      "termos": "pki, icp-brasil, campo-emissor, campo-aia, campo-identificador-chave, Cadeia de certificação",
      "saibaMais": "- [RFC 5280 — validação do caminho de certificação (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "revogacao",
    "trilha": "certificacao",
    "paiId": "pki",
    "ordem": 3,
    "nivel": "Intermediário",
    "titulo": "Revogação: CRL, OCSP e OCSP Stapling",
    "resumo": "Como os sistemas descobrem que um certificado foi cancelado antes do vencimento: lista (CRL), consulta on-line (OCSP) e grampeamento.",
    "palavrasChave": [
      "revogação",
      "revogado",
      "crl",
      "lcr",
      "ocsp",
      "ocsp stapling",
      "grampeamento",
      "good",
      "revoked",
      "unknown",
      "cdp"
    ],
    "secoes": {
      "frase": "**Revogar** é cancelar um certificado antes do vencimento. Os sistemas descobrem isso de duas formas: baixando a **lista de revogados (CRL, ou LCR na ICP-Brasil)** ou perguntando on-line ao serviço **OCSP**.",
      "simples": "A **CRL** é como a lista de cheques sustados que o comerciante baixa de tempos em tempos e consulta. O **OCSP** é como ligar para o banco na hora e perguntar: \"este cheque específico está bom?\".",
      "funciona": "![Comparação entre CRL e OCSP: na CRL o sistema baixa a lista pelo endereço do CDP; no OCSP pergunta ao respondedor indicado no AIA](fotos/aprender/certificado/crl-x-ocsp.svg)\n\n### Por que um certificado é revogado\n\n- Perda ou roubo do token, cartão ou dispositivo.\n- Suspeita de que a chave privada foi comprometida.\n- Mudança dos dados do titular.\n- Pedido do próprio titular.\n- Determinação da Autoridade Certificadora.\n\n### 1. CRL — o método \"lista\"\n\nA CRL é uma lista de números de série revogados, gerada e **assinada** periodicamente pela AC.\n\n- **Como funciona:** o certificado traz, na extensão **Pontos de Distribuição da LCR (CDP)**, o endereço da lista. O sistema baixa a lista inteira e procura o **número de série** do certificado nela (veja [CDP](#campo-cdp)).\n- **Vantagens:** depois de baixada, funciona off-line e guarda o histórico das revogações.\n- **Desvantagens:**\n  - **Tamanho:** com o tempo as listas crescem e pesam no tráfego.\n  - **Atraso no primeiro acesso:** baixar uma lista grande atrasa a validação.\n  - **Janela de vulnerabilidade:** a lista sai em intervalos (por exemplo, a cada 24 horas). Se um certificado for revogado às 10h e a nova lista só sair às 18h, ele ainda é aceito nesse intervalo por quem usa a lista antiga.\n\n| Número de série | Situação |\n| --- | --- |\n| A12345 | Revogado |\n| B98765 | Revogado |\n| C77777 | Revogado |\n\n### 2. OCSP — o método \"consulta direta\"\n\nO **OCSP** (*Online Certificate Status Protocol*, RFC 6960) foi criado para resolver os gargalos da CRL.\n\n- **Como funciona:** o sistema faz uma requisição leve ao servidor da AC (o **respondedor OCSP**, cujo endereço vem no campo [AIA](#campo-aia)) informando o número de série. A resposta, assinada pela AC, diz a situação naquele momento: `Good` (válido), `Revoked` (revogado) ou `Unknown` (desconhecido).\n- **Vantagens:** respostas rápidas e pequenas; situação atual, sem a janela de atraso da CRL.\n- **Desvantagens:**\n  - **Privacidade:** a AC fica sabendo quais certificados estão sendo consultados.\n  - **Ponto único de falha:** se o respondedor sair do ar, o sistema pode bloquear acessos legítimos ou liberar sem validar, conforme a configuração.\n\n### Comparativo\n\n| Característica | CRL (lista de revogação) | OCSP (consulta on-line) |\n| --- | --- | --- |\n| Abordagem | Baixa o arquivo com todas as revogações | Pergunta sobre um único certificado |\n| Consumo de rede | Alto (arquivos grandes) | Baixo (pacotes pequenos) |\n| Atualização | Periódica (diária ou a cada poucas horas) | Na hora da consulta |\n| Privacidade | Preservada (o download é genérico) | Exposta (a AC sabe o que foi consultado) |\n\nMuitos sistemas consultam **os dois**: tentam o OCSP e usam a CRL como reserva (ou o contrário).\n\n### OCSP Stapling (\"grampeamento\")\n\nCriado para corrigir a **privacidade** e a **latência** do OCSP em conexões HTTPS. Em vez de o navegador consultar a AC, o **próprio servidor** consulta o OCSP de tempos em tempos, guarda a resposta assinada pela AC e a \"grampeia\" junto do certificado na conexão. O navegador confere a assinatura da AC na resposta sem fazer consultas extras.",
      "exemplo": "**Assinatura aparece como inválida e o certificado parece em dia.** Pode ter sido **revogado**. Abra o documento no leitor ou no **Validador ITI** e veja o detalhe da verificação de revogação.\n\n**Validação demora ou falha só em uma rede.** A rede pode estar bloqueando os endereços de CRL ou OCSP (campos CDP e AIA). Teste em outra rede e verifique com a TI do cliente se os endereços `http://icp-brasil.validcertificadora.com.br` e `http://icp-brasil2.validcertificadora.com.br` estão liberados.\n\n> [!atencao] A confirmar com o time\n> Lista oficial de endereços (CRL, OCSP e cadeia) que o cliente precisa liberar no firewall e o procedimento interno para pedido de revogação.",
      "duvidas": "### Por que há duas URLs de CRL no certificado?\nPara **disponibilidade**: se um servidor estiver fora do ar, o sistema tenta o segundo. Veja [CDP](#campo-cdp).\n\n### Revogado e vencido são a mesma coisa?\nNão. **Vencido** chegou ao fim da validade (*Not After*). **Revogado** foi cancelado antes disso. Nos dois casos ele não serve para novas assinaturas.\n\n### Um certificado revogado volta a valer?\nNão. A revogação é definitiva; é preciso emitir um novo certificado.",
      "termos": "campo-cdp, campo-aia, campo-numero-serie, CRL, OCSP, pki",
      "saibaMais": "- [RFC 6960 — OCSP (em inglês)](https://www.rfc-editor.org/rfc/rfc6960)\n- [RFC 5280 — certificados e listas de revogação X.509 (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)\n- [RFC 6066 — extensões do TLS, incluindo o pedido de status usado no OCSP Stapling (em inglês)](https://www.rfc-editor.org/rfc/rfc6066)"
    }
  },
  {
    "id": "criptografia",
    "trilha": "certificacao",
    "paiId": null,
    "ordem": 3,
    "nivel": "Intermediário",
    "titulo": "A criptografia por trás",
    "resumo": "Chaves pública e privada, RSA, hash e datas em UTC: a matemática que faz a assinatura digital funcionar.",
    "palavrasChave": [
      "criptografia",
      "assimétrica",
      "simétrica",
      "par de chaves",
      "rsa",
      "ecc",
      "hash",
      "sha-256",
      "utc"
    ],
    "secoes": {
      "frase": "O certificado digital funciona com **criptografia assimétrica**: um **par de chaves** (uma pública e uma privada) ligadas por matemática, combinado com funções de **hash** que resumem os documentos.",
      "simples": "Na criptografia \"comum\" (simétrica), a mesma chave tranca e destranca: as duas pessoas precisam ter a mesma senha. Na **assimétrica**, existe um **cadeado aberto** que você distribui para todo mundo (a chave pública) e uma **chave única que só você tem** (a privada). Qualquer um tranca com o seu cadeado; só você abre.",
      "funciona": "### O que cada peça faz\n\n| Peça | Para que serve | Onde aprender |\n| --- | --- | --- |\n| **Par de chaves (RSA ou ECC)** | Assinar com a privada e conferir com a pública; ou criptografar com a pública e abrir com a privada | [Chaves pública e privada e o RSA](#rsa) |\n| **Assinatura RSA** | A conta que transforma o hash do documento em assinatura e permite conferir depois | [A matemática da assinatura RSA](#rsa-matematica) |\n| **Hash (SHA-256, SHA-512)** | A \"impressão digital\" do documento: qualquer alteração muda o resultado | [Hash: SHA-256 e SHA-512](#hash-sha) |\n| **UTC** | O relógio único usado nas datas do certificado e nas assinaturas | [Por que as datas ficam em UTC](#utc) |\n\n![Fluxo da assinatura digital: documento, hash, assinatura com a chave privada, verificação com a chave pública e comparação](fotos/aprender/certificado/assinatura-fluxo.svg)\n\n### Resumo da trilha\n\n1. O titular tem uma **chave privada** secreta; a **chave pública** vai no certificado.\n2. Para assinar, calcula-se o **hash** do documento e aplica-se a operação de assinatura com a chave privada.\n3. Quem confere recalcula o hash e usa a chave pública para checar a assinatura: se bater, o documento é **íntegro** e a assinatura é do titular.\n4. As datas (validade, momento da assinatura) ficam em **UTC**, sem ambiguidade de fuso.",
      "exemplo": "**Cliente pergunta se \"a Valid tem a senha dele\".** Não: a chave privada é gerada para o titular e protegida por ele (no token, no cartão, no `.pfx` com senha ou no PSC de nuvem). O que a AC assina é o certificado com a chave **pública**.\n\n> [!atencao] A confirmar com o time\n> Como o time explica ao cliente a recuperação de acesso em cada produto (PIN/PUK do token, senha do A1, acesso ao aplicativo de nuvem).",
      "duvidas": "### A chave pública é secreta?\nNão. Ela foi feita para ser distribuída: vai dentro do certificado. O segredo está na **chave privada**.\n\n### O que é ECC?\nCriptografia de Curvas Elípticas: uma alternativa ao RSA com chaves menores para a mesma segurança. Veja [RSA](#rsa).",
      "termos": "rsa, rsa-matematica, hash-sha, utc, Chave privada, Chave pública",
      "saibaMais": "- [RFC 8017 — PKCS #1: criptografia RSA (em inglês)](https://www.rfc-editor.org/rfc/rfc8017)"
    }
  },
  {
    "id": "rsa",
    "trilha": "certificacao",
    "paiId": "criptografia",
    "ordem": 1,
    "nivel": "Intermediário",
    "titulo": "Chaves pública e privada e o RSA",
    "resumo": "O algoritmo de 1977 que permitiu assinar e criptografar com um par de chaves, e por que ele é difícil de quebrar.",
    "palavrasChave": [
      "rsa",
      "rivest",
      "shamir",
      "adleman",
      "fatoração",
      "primos",
      "2048",
      "4096",
      "ecc",
      "curvas elípticas",
      "chave pública",
      "chave privada"
    ],
    "secoes": {
      "frase": "O **RSA** é o algoritmo de **criptografia assimétrica** mais usado do mundo: com um par de chaves relacionadas, ele permite **criptografar dados** e **assinar digitalmente**. Sua segurança vem da dificuldade de **fatorar** números enormes.",
      "simples": "**O cadeado e a chave.** A chave pública é um cadeado aberto que você entrega a qualquer pessoa; a chave privada é a única chave que abre esse cadeado.\n\n- Para **mandar algo secreto para você**, a pessoa tranca com o seu cadeado (chave pública). Só você abre (chave privada). Nem quem trancou consegue reabrir.\n- Para **assinar**, o caminho é o inverso: você \"carimba\" com a chave privada e qualquer pessoa confere com a pública que o carimbo só pode ter vindo de você.",
      "funciona": "### Um pouco de história\n\nCriado em **1977** por Ron **R**ivest, Adi **S**hamir e Leonard **A**dleman (as iniciais formam o nome), o RSA foi o primeiro sistema prático a permitir, ao mesmo tempo, **criptografia** e **assinatura digital** com um par de chaves. A grande novidade: duas pessoas podem se comunicar com segurança **sem terem combinado uma senha antes**.\n\n### Os 3 passos do RSA\n\n**1. Geração do par de chaves.** O sistema gera dois valores ligados matematicamente:\n\n- **Chave pública:** pode ser enviada a qualquer pessoa ou publicada no certificado.\n- **Chave privada:** deve ficar em segredo absoluto com o dono.\n\n**2. Criptografar e descriptografar.** A matemática funciona como uma \"armadilha de mão única\":\n\n- **Criptografar:** quem quer enviar algo confidencial usa a sua **chave pública** para \"trancar\".\n- **Descriptografar:** só a sua **chave privada** \"abre\" e permite ler.\n\n**3. Assinatura digital.** O processo inverso garante a autoria:\n\n- **Assinar:** você usa a **chave privada** para gerar um código sobre o documento.\n- **Verificar:** qualquer pessoa usa a sua **chave pública** para confirmar que o código só poderia ter sido gerado pela sua chave privada e que o documento não mudou. Detalhes em [A matemática da assinatura RSA](#rsa-matematica).\n\n### O segredo: a dificuldade de fatorar\n\nO algoritmo é público; a força está na matemática:\n\n1. Para um computador, é fácil multiplicar dois números primos grandes: `p × q = n`.\n2. O caminho inverso, pegar o número gigante `n` e descobrir os primos `p` e `q` que o geraram (a **fatoração**), é extraordinariamente difícil.\n\nNos certificados atuais, o RSA usa chaves de **2048** ou **4096 bits**: o número `n` tem centenas de dígitos. Com a tecnologia atual, fatorar um número desse tamanho levaria um tempo impraticável.\n\n### Exemplo com números de brinquedo\n\n> [!atencao] Números de brinquedo\n> Os valores abaixo são minúsculos, só para ver a conta. Um certificado real usa `n` com **2048 bits ou mais** (mais de 600 dígitos decimais).\n\n```texto\n1. Dois primos:            p = 61      q = 53\n2. Módulo:                 n = p × q = 3233\n3. Totiente:               φ(n) = (p − 1) × (q − 1) = 60 × 52 = 3120\n4. Expoente público:       e = 17      (não tem divisor comum com 3120)\n5. Expoente privado:       d = 2753    (porque 17 × 2753 = 46801 = 15 × 3120 + 1)\n\nChave pública  = (e = 17,   n = 3233)\nChave privada  = (d = 2753, n = 3233)\n\nCriptografar a mensagem m = 65:     c = 65^17   mod 3233 = 2790\nDescriptografar:                    m = 2790^2753 mod 3233 = 65   (voltou!)\n```\n\n`mod` é o resto da divisão: `65^17 mod 3233` é o resto de dividir 65 elevado a 17 por 3233. As contas foram conferidas por programa.\n\n### RSA × algoritmos modernos (ECC)\n\nO RSA ainda predomina na ICP-Brasil e na web, mas divide espaço com a **criptografia de curvas elípticas (ECC)**:\n\n| Característica | RSA | ECC (curvas elípticas) |\n| --- | --- | --- |\n| Base matemática | Fatoração de números grandes | Equações de curvas elípticas |\n| Tamanho da chave | 2048 bits é o mínimo usual | 256 bits já dão segurança equivalente a um RSA de cerca de **3072 bits** |\n| Desempenho | Exige mais memória e processamento | Bem mais leve (ótimo para celulares e IoT) |\n| Uso atual | Padrão dominante em certificados digitais e PKIs | Crescendo na web (TLS 1.3, aplicativos de mensagem) |\n\n> [!info] Correção em relação às anotações\n> As anotações comparavam ECC de 256 bits a RSA de 2048 bits. Pelas tabelas de equivalência usuais (como a do NIST), ECC de 256 bits corresponde a cerca de 128 bits de segurança, o mesmo que um RSA de aproximadamente 3072 bits; um RSA de 2048 bits fica em torno de 112 bits.",
      "exemplo": "**Cliente pergunta se pode mandar a chave pública por e-mail.** Pode: ela já vai dentro do certificado (`.cer`). O que nunca se envia é a chave privada (o `.pfx` com senha, o PIN do token ou o acesso ao aplicativo de nuvem).\n\n**Ver o tamanho da chave do certificado.** No Windows, aba **Detalhes**, campo **Chave pública**: aparece, por exemplo, `RSA (2048 Bits)` (veja [Chave pública](#campo-chave-publica)).",
      "duvidas": "### A chave pública é secreta?\nNão. Ela foi feita para ser distribuída. O segredo está na chave privada.\n\n### 4096 bits é sempre melhor que 2048?\nÉ mais forte, mas mais lento. O tamanho usado em cada produto segue as normas da ICP-Brasil e da AC.\n\n### Computador quântico quebra o RSA?\nEm teoria, um computador quântico grande o bastante quebraria o RSA e a ECC. Por isso já existem padrões de criptografia \"pós-quântica\" em adoção; a migração dos certificados acontece por regras das autoridades, e não depende do usuário.",
      "termos": "criptografia, rsa-matematica, campo-chave-publica, RSA, ECC, Chave privada, Chave pública",
      "saibaMais": "- [RFC 8017 — PKCS #1: criptografia RSA (em inglês)](https://www.rfc-editor.org/rfc/rfc8017)"
    }
  },
  {
    "id": "rsa-matematica",
    "trilha": "certificacao",
    "paiId": "criptografia",
    "ordem": 2,
    "nivel": "Avançado",
    "titulo": "A matemática da assinatura RSA",
    "resumo": "Passo a passo de como o hash do documento vira assinatura com a chave privada e como qualquer um confere com a chave pública.",
    "palavrasChave": [
      "assinatura rsa",
      "hash",
      "chave privada",
      "chave pública",
      "verificação",
      "pkcs#1",
      "pss",
      "padding",
      "integridade",
      "autenticidade"
    ],
    "secoes": {
      "frase": "Para **assinar**, o RSA aplica a **chave privada** sobre o **hash** do documento; para **conferir**, qualquer pessoa aplica a **chave pública** sobre a assinatura e compara o resultado com o hash que ela mesma calculou.",
      "simples": "É como um lacre de cera com o seu brasão: só você tem o sinete (chave privada) que faz aquele desenho, e qualquer um compara o lacre com o modelo público do brasão (chave pública). Se o envelope for aberto e fechado de novo, o lacre não confere mais.",
      "funciona": "Assinar um documento grande direto na conta do RSA seria lento. Por isso entra em cena o **hash**: o RSA assina só o \"resumo\" do documento.\n\n![Fluxo da assinatura digital: quem assina calcula o hash e assina com a chave privada; quem verifica recalcula o hash, extrai o hash da assinatura com a chave pública e compara](fotos/aprender/certificado/assinatura-fluxo.svg)\n\n### Assinando (por exemplo, um contrato em PDF)\n\n**1. Gerar o hash (o resumo do documento).** O programa passa o documento por uma função hash, como o **SHA-256**. O arquivo, de qualquer tamanho, vira um valor de tamanho fixo (veja [Hash](#hash-sha)).\n\n**2. Assinar com a chave privada.** O programa aplica a conta do RSA com a **chave privada** `(d, n)`:\n\n```texto\nAssinatura = Hash^d mod n\n```\n\nO resultado é a **assinatura digital**, anexada ao PDF junto com o certificado.\n\n### Conferindo (o que o leitor de PDF faz)\n\n1. **Extrai o hash da assinatura com a chave pública** `(e, n)` do certificado que veio com o arquivo:\n\n   ```texto\n   Hash extraído = Assinatura^e mod n\n   ```\n\n2. **Calcula um hash novo** do documento recebido.\n3. **Compara os dois:**\n   - **Iguais:** a assinatura é **VÁLIDA**. Isso prova a **autenticidade** (só quem tem a chave privada poderia ter gerado aquela assinatura) e a **integridade** (o documento não mudou nem um espaço desde a assinatura).\n   - **Diferentes:** a assinatura é **INVÁLIDA** ou o documento foi corrompido.\n\n### A mesma conta com números de brinquedo\n\nUsando as chaves do exemplo de [Chaves pública e privada e o RSA](#rsa) (`d = 2753`, `e = 17`, `n = 3233`) e fingindo que o hash do documento vale **123**:\n\n```texto\nAssinar:     123^2753 mod 3233 = 2746      (assinatura)\nConferir:    2746^17  mod 3233 = 123       (igual ao hash do documento: VÁLIDA)\n\nDocumento alterado -> hash novo 124\nConferir:    2746^17  mod 3233 = 123  ≠ 124   (INVÁLIDA)\n```\n\nContas conferidas por programa. Num certificado real, o hash tem 256 bits e o `n` tem 2048 bits ou mais.\n\n### Por que ninguém consegue \"consertar\" uma alteração\n\nSe um fraudador mudar o valor de um contrato (de R$ 1.000 para R$ 100.000), o **hash novo** fica completamente diferente. Como ele não tem a **chave privada** do titular, não consegue gerar uma assinatura que confira com esse hash novo. Qualquer alteração quebra a verificação.\n\n> [!dica] Para ir além\n> Explicar como \"criptografar o hash com a chave privada\" ajuda a entender, mas, tecnicamente, assinar é uma **operação de assinatura**, não uma criptografia. Antes da conta, o hash é embalado num formato padronizado com **preenchimento** (*padding*): o **PKCS#1 v1.5**, comum nos certificados ICP-Brasil, ou o **RSA-PSS**, mais moderno. Esse preenchimento é o que torna a assinatura segura na prática. Detalhes na RFC 8017.",
      "exemplo": "**Cliente diz que \"a assinatura quebrou\" depois de mandar o PDF.** Pergunte se o arquivo foi **editado, convertido ou \"salvo como\"** depois de assinado: qualquer mudança altera o hash e a assinatura deixa de conferir. A solução é assinar de novo a versão final.\n\n**Leitor mostra \"a assinatura é válida, mas o documento foi modificado depois\".** Alguns formatos (como o PDF) permitem acrescentar coisas depois de assinar (outra assinatura, anotações). O leitor separa o que estava coberto pela assinatura do que veio depois.",
      "duvidas": "### O hash fica dentro da assinatura?\nEm certo sentido, sim: ao aplicar a chave pública sobre a assinatura, sai o hash (embalado no formato padronizado). Por isso a conferência compara esse hash com o recalculado.\n\n### Por que assinar o hash e não o documento inteiro?\nPorque o RSA só consegue operar sobre números menores que `n`, e porque assim a assinatura fica rápida e do mesmo tamanho para qualquer documento.",
      "termos": "rsa, hash-sha, assinatura-digital-eletronica, RSA, Hash, Assinatura digital",
      "saibaMais": "- [RFC 8017 — PKCS #1: assinaturas RSA (em inglês)](https://www.rfc-editor.org/rfc/rfc8017)"
    }
  },
  {
    "id": "hash-sha",
    "trilha": "certificacao",
    "paiId": "criptografia",
    "ordem": 3,
    "nivel": "Intermediário",
    "titulo": "Hash: SHA-256 e SHA-512",
    "resumo": "A \"impressão digital\" de um dado: o que é, por que qualquer mudança altera o resultado, e como calcular no terminal.",
    "palavrasChave": [
      "hash",
      "sha-256",
      "sha256",
      "sha-512",
      "sha-2",
      "sha-1",
      "md5",
      "checksum",
      "integridade",
      "get-filehash",
      "certutil",
      "sha256sum",
      "shasum",
      "avalanche"
    ],
    "secoes": {
      "frase": "Um **hash** é uma \"impressão digital\" de tamanho fixo calculada a partir de qualquer dado. **SHA-256** e **SHA-512** (família **SHA-2**) são os algoritmos usados nos certificados digitais para garantir **integridade** e permitir a **assinatura**.",
      "simples": "É como a impressão digital de uma pessoa: um \"resumo\" pequeno que identifica alguém sem precisar da pessoa inteira. Se o documento mudar uma vírgula, é como se fosse outra pessoa: a \"digital\" fica totalmente diferente.",
      "funciona": "### O que é um hash\n\nO hash transforma **qualquer informação** (uma letra ou o conteúdo de um HD inteiro) numa sequência de tamanho fixo. O **SHA-256** foi desenvolvido pela NSA (Agência de Segurança Nacional dos EUA) e publicado pelo NIST, como parte da família SHA-2.\n\nExemplos reais (texto em UTF-8):\n\n| Entrada | SHA-256 |\n| --- | --- |\n| `Olá` | `5251c3c68010bca32f4dbedb142270f720fa84a0599816524c85d50c3f589365` |\n| `Olá.` (só um ponto a mais) | `e5f95fd7da36518e4bbd8bf1d6b82a9771f4fe58e3b5d7d3317489ecafaf9427` |\n| `Olá Mundo` | `60a066e1398f009cf5a1c2eb2a508d5a7a076d076edcbc685e780b22d385569b` |\n\nO SHA-512 de `Olá Mundo`, com 128 caracteres:\n\n```texto\n0ecc298d74b6a5d376e32226b60aa33bad356d9b404d5f0112b2f5542ff0fcf44757ee8aed8355090ef089e1343442b5fd620dedb84daedd2cb12f55562f04b0\n```\n\n> [!info] Correção em relação às anotações\n> Os hashes das anotações originais não correspondiam aos textos: o valor dado para \"Olá Mundo\" (que começa com `a591a6d4…`) é, na verdade, o SHA-256 de \"Hello World\". Os valores desta página foram calculados de novo, com o texto em UTF-8.\n\n![Efeito avalanche: \"Olá\" e \"Olá.\" geram hashes SHA-256 completamente diferentes](fotos/aprender/certificado/avalanche-hash.svg)\n\n### As 4 propriedades do SHA-256\n\n1. **Mão única:** é rápido calcular o hash de uma mensagem, mas **computacionalmente inviável** fazer o caminho inverso (descobrir o texto a partir do hash).\n2. **Efeito avalanche:** qualquer mudança mínima na entrada (um espaço, uma vírgula, maiúscula ou minúscula) muda completamente o resultado.\n3. **Resistência a colisões:** é inviável, na prática, achar dois textos ou arquivos diferentes com o mesmo hash SHA-256.\n4. **Tamanho fixo:** de 1 KB a 500 GB, o resultado tem sempre 256 bits (64 caracteres hexadecimais).\n\n### Como o hash é usado na assinatura\n\n1. O sistema calcula o hash do documento com SHA-256 ou SHA-512.\n2. Esse hash é assinado com a chave privada do certificado (veja [A matemática da assinatura RSA](#rsa-matematica)).\n3. O resultado é a assinatura digital.\n4. Quem recebe recalcula o hash e compara com o valor assinado.\n\nSe os hashes forem iguais: o documento **não foi alterado**, a assinatura é **válida** e a identidade do assinante é confirmada.\n\n### Por que SHA-256 e SHA-512 (e não MD5 ou SHA-1)\n\n**1. Segurança.** Algoritmos antigos, como **MD5** e **SHA-1**, têm vulnerabilidades conhecidas e sofrem **ataques de colisão**. Por isso autoridades certificadoras e navegadores passaram a exigir algoritmos mais fortes: **SHA-256**, **SHA-384** e **SHA-512**.\n\n**2. Integridade dos dados.** Uma alteração produz um hash completamente diferente:\n\n| Texto | SHA-256 |\n| --- | --- |\n| `R$ 1.000,00` | `effbe4b9004f55e6a17ecafdf4e5fb647528cc3c9dd341fd4d40f0c5c9c4118e` |\n| `R$ 10.000,00` | `e13e940768f08599220f9322a62ad0556103b97f02bdecb83832aa99fa0dca19` |\n\nPor isso a alteração invalida a assinatura.\n\n**3. Conformidade.** Infraestruturas de chave pública, como a **ICP-Brasil**, usam algoritmos da família **SHA-2** para emitir e validar certificados.\n\n### SHA-256 × SHA-512\n\n| Característica | SHA-256 | SHA-512 |\n| --- | --- | --- |\n| Tamanho do hash | 256 bits | 512 bits |\n| Em hexadecimal | 64 caracteres | 128 caracteres |\n| Segurança | Muito alta | Ainda maior |\n| Uso comum | Certificados SSL/TLS e certificados digitais | Sistemas com exigências mais altas |\n\n**O SHA-512 é sempre melhor?** Não necessariamente. O SHA-256 já é considerado seguro para a maioria dos cenários e é o mais usado em certificados SSL/TLS, certificados ICP-Brasil, assinaturas digitais e no Bitcoin. O SHA-512 dá uma margem maior e costuma ser usado quando há exigência específica.\n\n### Onde o SHA-256 aparece\n\n- **Assinaturas digitais (certificados X.509):** em vez de aplicar a chave privada sobre um documento de centenas de páginas, assina-se só o hash, o que torna a assinatura rápida.\n- **Blockchain (Bitcoin):** é o algoritmo central da mineração (*proof-of-work*).\n- **Senhas:** sistemas não deveriam guardar a senha, e sim um valor derivado dela. Na prática, para senhas se usam funções próprias e mais lentas, com \"sal\" (como PBKDF2, bcrypt ou Argon2), e não um SHA-256 puro.\n- **Integridade de arquivos (checksum):** conferir se um download ou uma cópia não foi corrompida ou adulterada.\n\n### Calcular e conferir o hash no terminal\n\n**Windows (Prompt de Comando ou PowerShell), com o CertUtil:**\n\n```powershell\ncertutil -hashfile \"C:\\caminho\\para\\seu-arquivo.pdf\" SHA256\n```\n\n**Windows (PowerShell):**\n\n```powershell\nGet-FileHash -Path \"C:\\caminho\\para\\seu-arquivo.pdf\" -Algorithm SHA256\n```\n\nHash de um **texto** (em vez de um arquivo) no PowerShell:\n\n```powershell\n$bytes = [System.Text.Encoding]::UTF8.GetBytes(\"Olá\")\n$hash  = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)\n($hash | ForEach-Object { $_.ToString(\"x2\") }) -join \"\"\n```\n\n**Linux:**\n\n```bash\nsha256sum arquivo.pdf                      # gerar o hash\nsha256sum arquivo.pdf > checksum.sha256    # salvar o hash num arquivo\nsha256sum -c checksum.sha256               # conferir depois: \"arquivo.pdf: OK\"\n```\n\n**macOS:**\n\n```bash\nshasum -a 256 /caminho/para/seu-arquivo.pdf\n```\n\n### Como interpretar\n\n1. **Compare caractere por caractere** os 64 caracteres com o hash informado pela fonte (site de download, sistema de assinatura, órgão fiscal).\n2. **Maiúsculas e minúsculas não importam:** `A` e `a` representam o mesmo valor hexadecimal.\n3. **Um único caractere diferente** indica que o arquivo foi modificado, corrompido no download ou adulterado.",
      "exemplo": "**Conferir se um arquivo enviado pelo cliente é o mesmo que está no sistema.** Peça o hash de um lado e calcule do outro:\n\n```powershell\nGet-FileHash -Path \"C:\\Users\\voce\\Downloads\\documento.pdf\" -Algorithm SHA256\n```\n\nSe os 64 caracteres forem iguais, é o mesmo arquivo, byte a byte.\n\n**Cliente acha que o PDF assinado \"foi trocado\".** Calcule o hash do arquivo que ele tem e do arquivo de referência. Hashes diferentes indicam versões diferentes, mesmo que pareçam iguais na tela.\n\n> [!atencao] A confirmar com o time\n> Se o time usa hash como procedimento padrão em algum atendimento (por exemplo, para confirmar arquivos de instaladores) e onde está a lista de hashes oficiais.",
      "duvidas": "### Dá para \"descriptografar\" um hash?\nNão. Hash não é criptografia: é de mão única. Dá para tentar adivinhar textos curtos comparando hashes, por isso senhas precisam de funções próprias, com sal.\n\n### Por que o mesmo texto deu hash diferente no meu computador?\nNormalmente é a **codificação** (UTF-8 × outra) ou um espaço ou quebra de linha a mais. O hash é calculado sobre os **bytes**, não sobre o que se vê na tela.\n\n### SHA-1 ainda aparece no meu certificado. É inseguro?\nNo certificado ICP-Brasil, o SHA-1 aparece em **identificadores** (impressão digital, AKI/SKI), não na assinatura. Veja [Identificadores de chave](#campo-identificador-chave) e [Impressão digital](#campo-impressao-digital).",
      "termos": "rsa-matematica, campo-algoritmo-assinatura, campo-impressao-digital, Hash, rsa",
      "saibaMais": "- [Microsoft Learn — Get-FileHash](https://learn.microsoft.com/pt-br/powershell/module/microsoft.powershell.utility/get-filehash)\n- [Microsoft Learn — certutil](https://learn.microsoft.com/pt-br/windows-server/administration/windows-commands/certutil)"
    }
  },
  {
    "id": "utc",
    "trilha": "certificacao",
    "paiId": "criptografia",
    "ordem": 4,
    "nivel": "Intermediário",
    "titulo": "Por que as datas ficam em UTC",
    "resumo": "As datas do certificado e das assinaturas ficam no tempo universal; o computador só converte para o fuso local na hora de mostrar.",
    "palavrasChave": [
      "utc",
      "gmt",
      "fuso",
      "horário",
      "not before",
      "not after",
      "validade",
      "carimbo do tempo",
      "act",
      "utctime",
      "generalizedtime",
      "relógio"
    ],
    "secoes": {
      "frase": "O certificado guarda as datas (início e fim da validade) em **UTC**, o tempo universal sem fuso; o sistema só converte para o horário local na hora de **mostrar** na tela.",
      "simples": "É como o horário dos voos internacionais na torre de controle: todos usam o mesmo relógio (UTC) para não haver confusão; cada passageiro converte para o fuso da cidade dele.",
      "funciona": "### Por que o UTC é obrigatório no certificado\n\nA internet e o comércio eletrônico são globais. Registrar a hora local (por exemplo, a de Brasília, UTC−3) no certificado criaria inconsistências:\n\n- **Ordem dos fatos:** um contrato assinado às 21h em Brasília já é 9h do dia seguinte no Japão (UTC+9). Sem padronização, a ordem cronológica ficaria confusa para auditorias.\n- **Validade:** o padrão **X.509** (RFC 5280) exige que os campos `Not Before` (início) e `Not After` (fim) usem a notação ASN.1 em UTC: `UTCTime` (para datas até 2049) ou `GeneralizedTime` (de 2050 em diante). O DOC-ICP-04 da ICP-Brasil segue esse formato.\n\n### Na validade do certificado\n\nUm e-CPF emitido para valer a partir de **15/03/2026 às 14:00 (horário de Brasília)** é gravado assim:\n\n```texto\n2026-03-15 17:00:00Z      (\"Z\" = fuso \"Zulu\", ou seja, UTC)\n```\n\nO sistema operacional lê a data em UTC e só a converte para o relógio da máquina ao exibir. É por isso que a janela do Windows mostra \"Válido a partir de\" no horário local, e a linha de comando mostra em UTC/GMT:\n\n```texto\nValidity\n    Not Before: Sep 11 23:59:59 2026 GMT\n    Not After : Sep 11 23:59:59 2027 GMT\n```\n\n### Na assinatura e no carimbo do tempo\n\n1. O programa de assinatura registra a data e a hora em **UTC**.\n2. Com **carimbo do tempo**, uma **Autoridade de Carimbo do Tempo (ACT)** sincronizada à hora oficial (no Brasil, o Observatório Nacional) emite um selo com a hora exata em UTC.\n3. Um auditor em Londres, Tóquio ou São Paulo vê o mesmo instante, convertido para o fuso de cada computador.\n\n> [!info] Correção em relação às anotações\n> As anotações diziam que o UTC \"impede que alguém altere o fuso do computador para burlar prazos\". O UTC elimina a confusão de **fuso**, mas mudar a **data e a hora** do computador ainda engana a verificação **local**. Quem comprova o horário real, independentemente do relógio da máquina, é o **carimbo do tempo** da ACT.",
      "exemplo": "**Certificado aparece como \"ainda não válido\" ou \"expirado\", mas está no prazo.** Confira a **data, a hora e o fuso** do computador do cliente. Relógio adiantado ou atrasado faz o sistema comparar a validade (em UTC) com uma hora errada.\n\n**Cliente estranha a hora de emissão \"três horas diferente\".** A linha de comando ou alguns sistemas mostram a data em UTC; o Windows mostra no fuso local (Brasília é UTC−3).",
      "duvidas": "### O certificado \"vence\" à meia-noite?\nVence no instante gravado em `Not After`, em UTC. Convertido para Brasília, pode cair em outra hora ou até no dia anterior.\n\n### Horário de verão afeta o certificado?\nNão. A data fica em UTC, que não tem horário de verão. Só a exibição local muda.",
      "termos": "campo-validade-requerente, UTC, criptografia",
      "saibaMais": "- [RFC 5280 — formato das datas de validade (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "anatomia-certificado",
    "trilha": "certificacao",
    "paiId": null,
    "ordem": 4,
    "nivel": "Intermediário",
    "titulo": "Anatomia do certificado (padrão X.509)",
    "resumo": "Mapa mental e tabela com todos os campos que aparecem em \"Certificado > Detalhes\", cada um com a sua explicação.",
    "palavrasChave": [
      "anatomia",
      "x.509",
      "campos",
      "detalhes",
      "mapa mental",
      "extensões",
      "v3",
      "key usage",
      "eku",
      "san",
      "aia",
      "cdp"
    ],
    "secoes": {
      "frase": "Todo certificado ICP-Brasil segue o padrão **X.509 v3**: um conjunto de **campos** (quem é o titular, quem emitiu, validade, chave pública) e de **extensões** (para que serve, onde conferir a revogação, como montar a cadeia), tudo assinado pela AC.",
      "simples": "Pense na **CNH**: tem o nome do motorista (requerente), o órgão que emitiu (emissor, como o Detran), o número do documento (número de série), a validade e a **categoria** que diz o que você pode dirigir (as permissões do certificado). Cada linha da aba **Detalhes** do Windows é um desses itens.",
      "funciona": "### As três partes de um certificado X.509\n\n1. **Dados do certificado (*tbsCertificate*):** versão, número de série, algoritmo de assinatura, emissor, validade, titular, chave pública e as **extensões v3** (como o SAN, onde ficam CPF/CNPJ ou domínios, e o uso da chave).\n2. **Algoritmo da assinatura:** como a assinatura da AC foi gerada (ex.: `sha256WithRSAEncryption`).\n3. **Assinatura da Autoridade Certificadora:** o hash dos dados do certificado assinado com a **chave privada da AC**. É isso que impede qualquer adulteração do arquivo.\n\n### Mapa mental\n\n![Mapa mental do certificado digital X.509 v3 com oito ramos: identidade, validade, chaves, assinatura da AC, confiança, revogação, permissões e identificação](fotos/aprender/certificado/mapa-mental.svg)\n\nOs mesmos itens, em lista:\n\n- **Identidade:** [Requerente](#campo-validade-requerente) · [Nome alternativo (SAN)](#campo-san) · [Emissor](#campo-emissor)\n- **Validade:** [Not Before / Not After](#campo-validade-requerente) · [Datas em UTC](#utc)\n- **Chaves:** [Chave pública e parâmetros](#campo-chave-publica) · [Pública × privada](#rsa)\n- **Assinatura da AC:** [Algoritmo de assinatura](#campo-algoritmo-assinatura) · [Hash](#hash-sha)\n- **Confiança:** [Cadeia](#cadeia-certificacao) · [AIA](#campo-aia) · [AKI/SKI](#campo-identificador-chave) · [Políticas (OID)](#campo-politicas)\n- **Revogação:** [CRL e CDP](#campo-cdp) · [OCSP](#revogacao)\n- **Permissões:** [Uso da chave](#campo-uso-chave) · [Uso avançado (EKU)](#campo-uso-avancado) · [Restrições básicas](#campo-restricoes-basicas)\n- **Identificação:** [Número de série](#campo-numero-serie) · [Impressão digital](#campo-impressao-digital) · [Versão](#campo-versao)\n\n### Todos os campos da aba \"Detalhes\"\n\nNa ordem em que o Windows mostra (exemplos fictícios, com o formato de um e-CPF da AC VALID RFB v5):\n\n| Campo no Windows | Nome técnico | Exemplo | O que é |\n| --- | --- | --- | --- |\n| [Versão](#campo-versao) | Version | `V3` | Versão do padrão X.509 |\n| [Número de série](#campo-numero-serie) | Serial Number | `f8ed156b146fb350` | \"RG\" do certificado dentro da AC |\n| [Algoritmo de assinatura](#campo-algoritmo-assinatura) | Signature Algorithm | `sha256RSA` | Como a AC assinou |\n| [Algoritmo de hash de assinatura](#campo-algoritmo-assinatura) | — | `sha256` | O hash usado nessa assinatura |\n| [Emissor](#campo-emissor) | Issuer | `AC VALID RFB v5` | Quem emitiu e assinou |\n| [Válido a partir de / até](#campo-validade-requerente) | Validity | datas | Período de validade (gravado em UTC) |\n| [Requerente](#campo-validade-requerente) | Subject | `MARIA EXEMPLO DA SILVA:00000000000` | O titular |\n| [Chave pública](#campo-chave-publica) | Subject Public Key Info | `RSA (2048 Bits)` | A chave pública do titular |\n| [Parâmetros de chave pública](#campo-chave-publica) | Parameters | `05 00` | ASN.1 NULL: sem parâmetros extras |\n| [Acesso a Informações da Autoridade](#campo-aia) | AIA | URL da cadeia e do OCSP | Onde buscar a AC e o status |\n| [Restrições Básicas](#campo-restricoes-basicas) | Basic Constraints | `Entidade Final` | Pode ou não emitir certificados |\n| [Identificador da Chave da Autoridade](#campo-identificador-chave) | AKI | 40 caracteres hex | Qual chave da AC assinou |\n| [Políticas Dos Certificados](#campo-politicas) | Certificate Policies | `2.16.76.1.2.3.36` | Regras de emissão (OID) |\n| [Pontos de Distribuição da LCR](#campo-cdp) | CRL Distribution Points | URLs `.crl` | Onde baixar a lista de revogados |\n| [Uso Avançado de Chave](#campo-uso-avancado) | Extended Key Usage | Autenticação de Cliente | Em quais aplicações pode ser usado |\n| [Nome Alternativo Para o Requerente](#campo-san) | Subject Alternative Name | e-mail e OIDs `2.16.76.1.3.x` | Identificações extras do titular |\n| [Uso da Chave](#campo-uso-chave) | Key Usage | Assinatura Digital, Não-Recusa… | Operações criptográficas permitidas |\n| [Impressão Digital](#campo-impressao-digital) | Thumbprint | 40 caracteres hex | Hash do certificado inteiro |\n\n### Uso da chave × Uso avançado de chave\n\n| | Uso da chave (Key Usage) | Uso avançado de chave (EKU) |\n| --- | --- | --- |\n| Pergunta que responde | **O que** a chave pode fazer? | **Em qual aplicação** pode ser usada? |\n| Nível | Operação criptográfica | Finalidade de uso |\n| Exemplos | Assinatura Digital, Não-Recusa, Criptografia de Chaves | Autenticação de Cliente, E-mail Seguro, Autenticação de Servidor |\n| No e-CPF de exemplo | `Assinatura Digital, Não-Recusa, Criptografia de Chaves (e0)` | `Autenticação de Cliente (1.3.6.1.5.5.7.3.2)` e `Email Seguro (1.3.6.1.5.5.7.3.4)` |\n| Explicação | [Uso da chave](#campo-uso-chave) | [Uso avançado](#campo-uso-avancado) |\n\n### Resumo da trilha\n\n- **Quem:** [Requerente e SAN](#campo-san) identificam o titular; o [Emissor](#campo-emissor) identifica a AC.\n- **Quando:** [Validade](#campo-validade-requerente), sempre em UTC.\n- **Com que chave:** [Chave pública](#campo-chave-publica), [Algoritmo de assinatura](#campo-algoritmo-assinatura).\n- **Por que confiar:** [AIA](#campo-aia), [AKI/SKI](#campo-identificador-chave), [Políticas](#campo-politicas), [CDP](#campo-cdp).\n- **Para que serve:** [Uso da chave](#campo-uso-chave), [EKU](#campo-uso-avancado), [Restrições básicas](#campo-restricoes-basicas).\n- **Qual é exatamente:** [Número de série](#campo-numero-serie), [Impressão digital](#campo-impressao-digital).",
      "exemplo": "**Use esta página como roteiro de atendimento.** Com o cliente na tela **Certificado > Detalhes** (veja [como abrir](#certificado-digital)), siga a tabela acima linha por linha: validade, emissor, EKU e cadeia resolvem a maior parte dos casos de \"certificado não funciona\".\n\n> [!nota] Sobre as imagens desta trilha\n> As janelas mostradas nos subtemas são **recriações** com dados fictícios (titular \"MARIA EXEMPLO DA SILVA\", e-mail titular@exemplo.com.br, CPF 000.000.000-00, número de série, impressão digital e identificadores inventados). Emissor, URLs públicas e OIDs públicos da AC VALID são os reais.",
      "duvidas": "### Por que alguns campos têm ícone diferente na lista do Windows?\nOs campos básicos do X.509 aparecem com um ícone; as **extensões v3** com outro; e as extensões marcadas como **críticas** (como Uso da Chave) com um ícone de alerta. Uma extensão crítica precisa ser entendida pelo sistema, senão o certificado é recusado.\n\n### Os campos são iguais em todos os certificados?\nA estrutura é a mesma (X.509 v3). Os valores e algumas extensões mudam conforme o tipo (e-CPF, e-CNPJ, SSL) e a política da AC.",
      "termos": "certificado-digital, X.509, OID, campo-uso-chave, campo-uso-avancado, campo-san",
      "saibaMais": "- [RFC 5280 — perfil dos certificados X.509 (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)\n- [ITI — Documentos principais (DOC-ICP-04: perfis de certificado)](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais)"
    }
  },
  {
    "id": "campo-versao",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 1,
    "nivel": "Básico",
    "titulo": "Versão (por que é V3)",
    "resumo": "O campo Versão diz qual edição do padrão X.509 foi usada; a V3 é a que permite extensões.",
    "palavrasChave": [
      "versão",
      "v3",
      "v1",
      "v2",
      "x.509",
      "extensões"
    ],
    "secoes": {
      "frase": "O campo **Versão** indica qual edição do padrão X.509 o certificado segue. Hoje praticamente todo certificado é **V3**, a versão que permite **extensões**.",
      "simples": "É como a versão de um formulário: o formulário V3 tem campos extras (extensões) que os antigos V1 e V2 não tinham, e é neles que ficam informações essenciais como o CPF, as finalidades de uso e os endereços de revogação.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Versão selecionado mostrando V3 (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-versao.svg)\n\n- **V1 e V2** tinham limitações e não permitiam incluir informações adicionais importantes.\n- A **V3** criou as **extensões**: Uso da chave, Uso avançado, Nome alternativo (SAN), Pontos de distribuição da LCR, Acesso a informações da autoridade, Políticas, Restrições básicas, Identificadores de chave.\n- O DOC-ICP-04 exige a versão 3 nos certificados ICP-Brasil.\n- Internamente, a versão é gravada como número a partir de zero: o valor `2` (`0x2`) significa **v3**.",
      "exemplo": "Se aparecer um certificado **V1** num atendimento, desconfie: não é um certificado ICP-Brasil de usuário (pode ser um certificado de teste ou criado por um sistema interno).",
      "duvidas": "### Por que o valor interno é 2 e não 3?\nO padrão numera a partir de zero: v1 = 0, v2 = 1, v3 = 2. O Windows já mostra traduzido como \"V3\".",
      "termos": "anatomia-certificado, X.509",
      "saibaMais": "- [RFC 5280 — campo Version (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-numero-serie",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 2,
    "nivel": "Básico",
    "titulo": "Número de série",
    "resumo": "O identificador único do certificado dentro da AC, usado para rastrear e revogar.",
    "palavrasChave": [
      "número de série",
      "serial number",
      "serial",
      "identificador",
      "revogação",
      "crl"
    ],
    "secoes": {
      "frase": "O **número de série** é o identificador **único** que a Autoridade Certificadora dá a cada certificado no momento da emissão.",
      "simples": "É o **RG do certificado**: dois certificados da mesma AC nunca têm o mesmo número de série, mesmo que sejam do mesmo titular.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Número de série selecionado (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-numero-serie.svg)\n\n### Para que serve\n\n- Identificar o certificado de forma única.\n- Localizar o certificado nos sistemas da AC.\n- Verificar se o certificado foi **revogado**.\n- Diferenciar certificados do mesmo titular (renovações, por exemplo).\n\n### Como ele aparece\n\nEm hexadecimal, com ou sem espaços:\n\n```texto\n14a7f92b8c56d31e9\n3f 8c 74 b2 a1 56 d0 91 88 23\n```\n\nE, numa listagem resumida:\n\n```texto\nVersion: V3\nSerial Number: 4a7f92b8c56d31e9\nSignature Algorithm: sha256RSA\nIssuer: AC Certificadora XYZ\n```\n\nPelo DOC-ICP-04, o número de série é um **inteiro positivo, único para cada AC, não sequencial**, de até **20 octetos**. \"Não sequencial\" dificulta prever o próximo número.\n\n### Por que é importante na revogação\n\nSe um certificado for perdido, roubado ou comprometido, a AC coloca o **número de série** dele na lista de revogados. Os sistemas consultam esse número para saber se o certificado está **válido** ou **revogado** (veja [Revogação](#revogacao)).",
      "exemplo": "**Abrir chamado sobre um certificado específico.** Registre o **número de série** e o **emissor** (ou a [impressão digital](#campo-impressao-digital)): com esses dados a AC encontra exatamente aquele certificado, mesmo que o titular tenha vários.\n\n> [!atencao] A confirmar com o time\n> Quais dados do certificado o time registra no chamado (número de série, impressão digital, pedido) e se há algum dado que não deve ser copiado.",
      "duvidas": "### O número de série é secreto?\nNão. Ele faz parte do certificado público. Ainda assim, é um dado que identifica aquele certificado: evite expô-lo sem necessidade.\n\n### Duas ACs podem ter o mesmo número de série?\nPodem, porque a unicidade é **por AC**. Por isso o número de série sempre se lê junto com o **emissor**.",
      "termos": "campo-impressao-digital, revogacao, campo-emissor, CRL",
      "saibaMais": "- [RFC 5280 — campo Serial Number (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-algoritmo-assinatura",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 3,
    "nivel": "Intermediário",
    "titulo": "Algoritmo de assinatura",
    "resumo": "Como a AC assinou o certificado: a combinação de um hash (SHA-256, SHA-512) com um algoritmo de chave pública (RSA, ECDSA).",
    "palavrasChave": [
      "algoritmo de assinatura",
      "sha256rsa",
      "sha256withrsa",
      "sha512withrsa",
      "ecdsa",
      "signature algorithm",
      "hash"
    ],
    "secoes": {
      "frase": "O **algoritmo de assinatura** diz **como a Autoridade Certificadora assinou o certificado**: a combinação de um algoritmo de **hash** (SHA-256, SHA-512) com um algoritmo de **chave pública** (RSA, ECDSA).",
      "simples": "É o \"tipo de lacre\" que a AC usou no documento. Saber o tipo de lacre permite a qualquer um conferir se ele é autêntico.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Algoritmo de assinatura selecionado mostrando sha256RSA (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-algoritmo-assinatura.svg)\n\n### Como funciona\n\nQuando a AC emite um certificado:\n\n1. Calcula o hash dos dados do certificado (geralmente com SHA-256 ou SHA-512).\n2. Assina esse hash com a **chave privada da AC**.\n3. O resultado é a assinatura digital do certificado.\n\nQuando alguém valida o certificado:\n\n1. Recalcula o hash dos dados.\n2. Usa a **chave pública da AC** para conferir a assinatura.\n3. Compara os dois hashes.\n\nSe forem iguais, o certificado é **autêntico**, **não foi alterado** e **foi emitido pela AC indicada**.\n\n### Exemplos\n\n| Como aparece | Significa |\n| --- | --- |\n| `sha256RSA` (ou `SHA256withRSA`) | Hash **SHA-256** + chave pública **RSA** |\n| `sha512RSA` (ou `SHA512withRSA`) | Hash **SHA-512** + **RSA** |\n| `ECDSA with SHA256` | Hash **SHA-256** + **ECDSA** (assinatura com curva elíptica) |\n\nO Windows mostra também a linha **Algoritmo de hash de assinatura** (`sha256`), que é só a parte do hash.\n\n### Um exemplo simplificado\n\nImagine um certificado com:\n\n```texto\nVersão: V3\nNúmero de série: 123456789\nTitular: Empresa XYZ\n```\n\nA AC gera um hash desses dados (por exemplo, `abcd1234…`), assina esse hash com a chave privada RSA dela, e o resultado fica armazenado no certificado.\n\n> [!dica] Para ir além\n> O mesmo algoritmo aparece em **dois lugares** do certificado: dentro dos dados assinados (*signature*) e junto da assinatura no fim do arquivo (*signatureAlgorithm*). A RFC 5280 exige que os dois sejam iguais, para ninguém trocar o algoritmo sem invalidar a assinatura.",
      "exemplo": "**Sistema antigo recusa o certificado com erro de algoritmo.** Sistemas muito antigos podem não reconhecer SHA-256 ou SHA-512. A solução é atualizar o sistema, não usar algoritmos fracos.\n\n> [!atencao] A confirmar com o time\n> Casos conhecidos pelo time de sistemas de clientes que recusam certificados por algoritmo (SHA-512 em EV, por exemplo) e a orientação dada.",
      "duvidas": "### sha256RSA é o mesmo que sha256WithRSAEncryption?\nSim. É o nome curto que o Windows mostra para o OID `1.2.840.113549.1.1.11`.\n\n### Este campo diz como EU assino?\nNão. Diz como **a AC assinou o certificado**. Os algoritmos que o seu programa usa para assinar documentos são definidos pelo programa e pelas normas, usando a sua chave.",
      "termos": "hash-sha, rsa-matematica, campo-chave-publica, RSA, Hash",
      "saibaMais": "- [RFC 5280 — campo Signature Algorithm (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-emissor",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 4,
    "nivel": "Básico",
    "titulo": "Emissor (Issuer)",
    "resumo": "Quem emitiu e assinou o certificado: a AC em que o sistema precisa confiar para aceitar o seu certificado.",
    "palavrasChave": [
      "emissor",
      "issuer",
      "ac valid rfb v5",
      "autoridade certificadora",
      "cn",
      "ou",
      "o",
      "c",
      "cadeia"
    ],
    "secoes": {
      "frase": "O campo **Emissor (Issuer)** informa **qual Autoridade Certificadora emitiu e assinou** o certificado.",
      "simples": "Pense na **CNH**: o titular é o motorista e o **emissor é o Detran**. Quem confere a CNH confia nela porque foi emitida por um órgão oficial. Com o certificado é igual: a confiança no certificado vem da confiança na AC que o emitiu.\n\n```texto\nTitular  = dono do certificado\nEmissor  = Autoridade Certificadora\n```",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Emissor selecionado: CN = AC VALID RFB v5, OU = Secretaria da Receita Federal do Brasil - RFB, O = ICP-Brasil, C = BR (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-emissor.svg)\n\nNo exemplo, o emissor é:\n\n```texto\nCN = AC VALID RFB v5\nOU = Secretaria da Receita Federal do Brasil - RFB\nO  = ICP-Brasil\nC  = BR\n```\n\nOu seja: o certificado foi emitido pela **AC VALID RFB v5**, uma Autoridade Certificadora da cadeia da **ICP-Brasil** (CN = nome, OU = unidade, O = organização, C = país).\n\n### Por que o emissor é importante\n\n**1. Para saber em quem confiar.** O sistema não confia no titular automaticamente. Primeiro pergunta: *\"quem emitiu este certificado?\"*. Se a AC for confiável, o certificado também pode ser.\n\n```texto\nTitular: MARIA EXEMPLO DA SILVA\nEmissor: AC VALID RFB v5\n```\n\nO Windows verifica se conhece e confia na AC VALID RFB v5 e em toda a cadeia.\n\n**2. Para validar a assinatura do certificado.** O certificado foi assinado pela AC emissora; para conferir, o sistema usa a **chave pública dessa AC**. Sem o emissor, não daria para saber quem assinou, qual chave usar na conferência nem se o certificado é legítimo.\n\n**3. Para montar a cadeia de certificação.** O sistema sobe a cadeia até encontrar uma AC Raiz confiável. É isso que aparece na aba **Caminho de Certificação** (veja [Cadeia de certificação](#cadeia-certificacao)).\n\n**4. Para verificar a revogação.** A consulta é sempre \"o certificado de número X **emitido pela AC VALID RFB v5** está revogado?\". Sem o emissor, não haveria como fazer essa pergunta (veja [Revogação](#revogacao)).\n\n**Resumindo:** o emissor identifica a AC que criou e assinou o certificado. É ele que permite verificar a autenticidade, montar a cadeia de confiança e saber se o certificado continua válido.",
      "exemplo": "**Cliente tem dois certificados e não sabe qual é o da Valid.** Mostre o campo **Emissor** (ou \"Emitido por\", na aba Geral): o da Valid traz uma AC VALID.\n\n**Sistema diz \"emissor não confiável\".** O computador não reconhece a AC emissora ou falta um elo da cadeia: veja [Cadeia de certificação](#cadeia-certificacao) e [AIA](#campo-aia).",
      "duvidas": "### Emissor e Requerente podem ser iguais?\nSó em certificados **autoassinados** (como os das ACs Raiz). Num certificado de usuário, são sempre diferentes.\n\n### O emissor é a Valid ou a Receita Federal?\nOs dois aparecem: o **CN** é a AC da Valid (AC VALID RFB v5) e o **OU** mostra que ela pertence à cadeia da Receita Federal (RFB) na ICP-Brasil.",
      "termos": "cadeia-certificacao, campo-identificador-chave, campo-validade-requerente, icp-brasil, Autoridade Certificadora (AC)",
      "saibaMais": "- [RFC 5280 — campo Issuer (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-validade-requerente",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 5,
    "nivel": "Básico",
    "titulo": "Validade e Requerente (Subject)",
    "resumo": "Quando o certificado começa e deixa de valer, e quem é o titular. Os dois são obrigatórios.",
    "palavrasChave": [
      "validade",
      "válido a partir de",
      "válido até",
      "not before",
      "not after",
      "requerente",
      "subject",
      "titular",
      "cn",
      "cpf"
    ],
    "secoes": {
      "frase": "Os campos **Válido a partir de** / **Válido até** (*Not Before* / *Not After*) definem o período em que o certificado vale; o **Requerente (Subject)** identifica o titular. São dados **indispensáveis** e obrigatórios.",
      "simples": "São a \"data de emissão\", a \"data de validade\" e o \"nome do titular\" de qualquer documento de identidade.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Válido até selecionado (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-validade.svg)\n\n### Validade\n\n- **Válido a partir de (Not Before):** antes dessa data o certificado ainda não vale.\n- **Válido até (Not After):** depois dessa data ele vence e não serve mais para novas assinaturas.\n- As datas são **gravadas em UTC** e o Windows mostra no fuso do computador (veja [Por que as datas ficam em UTC](#utc)).\n- O período máximo depende do tipo de certificado (veja [Tipos](#certificado-tipos)).\n\n### Requerente (Subject)\n\n![Janela Certificado, aba Detalhes, com o campo Requerente selecionado: CN = MARIA EXEMPLO DA SILVA:00000000000 (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-requerente.svg)\n\nNo e-CPF, o **CN** traz o nome do titular seguido do CPF (aqui fictício):\n\n```texto\nCN = MARIA EXEMPLO DA SILVA:00000000000\nOU = RFB e-CPF A3\nO  = ICP-Brasil\nC  = BR\n```\n\nOs demais dados do titular (como data de nascimento e CPF, de forma padronizada) ficam no **SAN** (veja [Nome alternativo do requerente](#campo-san)).\n\n> [!atencao] A confirmar com o time\n> Formato exato do Requerente (unidades OU) em cada produto da Valid (e-CPF, e-CNPJ, nuvem) depois das mudanças do DOC-ICP-04.",
      "exemplo": "**\"Certificado expirou\" mas o cliente diz que comprou há pouco.** Confira o **Válido até**, a data e a hora do computador (veja [UTC](#utc)) e se o certificado instalado é mesmo o novo (compare a [impressão digital](#campo-impressao-digital)).\n\n**Portal recusa o certificado por \"titular diferente\".** Confira o **Requerente**: o CPF do certificado precisa ser o mesmo da conta no portal.",
      "duvidas": "### Posso estender a validade de um certificado?\nNão. A validade é assinada pela AC dentro do certificado; para continuar, é preciso **renovar** (emitir um novo).\n\n### Por que o nome aparece cortado ou sem acento?\nO nome segue as regras do DOC-ICP-04 e o limite de tamanho do campo. O que vale para identificação é o conjunto nome + CPF.",
      "termos": "utc, campo-san, certificado-tipos, UTC",
      "saibaMais": "- [RFC 5280 — campos Validity e Subject (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-chave-publica",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 6,
    "nivel": "Intermediário",
    "titulo": "Chave pública e parâmetros (05 00)",
    "resumo": "A parte compartilhável do par de chaves, o tamanho (RSA 2048) e o que significa o \"05 00\" dos parâmetros.",
    "palavrasChave": [
      "chave pública",
      "public key",
      "rsa 2048",
      "4096",
      "subject public key info",
      "parâmetros",
      "05 00",
      "asn.1",
      "null",
      "der",
      "rsaencryption"
    ],
    "secoes": {
      "frase": "A **chave pública** é a metade compartilhável do par de chaves do titular: fica dentro do certificado e serve para **conferir as assinaturas** feitas com a chave privada. Os **parâmetros `05 00`** são apenas o valor **NULL** do formato ASN.1.",
      "simples": "**Cadeado aberto e chave.**\n\n```texto\nChave pública  = cadeado aberto, distribuído para todos\nChave privada  = a chave que abre o cadeado\n```\n\nQualquer pessoa pode usar o seu cadeado (chave pública), mas só você tem a chave que o abre (chave privada).",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Chave pública selecionado mostrando RSA (2048 Bits) e o valor em hexadecimal (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-chave-publica.svg)\n\n### Para que serve a chave pública\n\n1. **Verificar assinaturas digitais** feitas com a chave privada.\n2. **Criptografar informações** que só o dono da chave privada conseguirá abrir.\n3. **Identificar** o titular dentro da infraestrutura de confiança.\n\n```texto\nDocumento\n   ↓\nSHA-256\n   ↓\nAssinado com a chave privada\n```\n\nQuem recebe usa a chave pública do certificado para conferir. Se der certo: o documento foi assinado pelo titular e **não foi alterado** depois.\n\n### Por que a chave pública fica dentro do certificado\n\nO certificado funciona como uma carteira de identidade digital e reúne:\n\n```texto\nTitular · Número de série · Emissor · Validade · Chave pública · Assinatura da AC\n```\n\nAssim, qualquer sistema obtém a sua chave pública e confere suas assinaturas sem pedir nada a mais, e sabe que a chave é sua porque a AC assinou o conjunto.\n\n### Como aparece\n\nNos detalhes do certificado, o campo pode se chamar **Chave pública**, **Public Key**, **RSA Public Key** ou **Subject Public Key Info**:\n\n```texto\nAlgoritmo: RSA\nTamanho: 2048 bits      (ou 4096 bits)\n```\n\nA caixa de baixo mostra a chave em **hexadecimal** (formato DER). No começo de uma chave RSA de 2048 bits:\n\n```texto\n30 82 01 0a      -> SEQUENCE (estrutura) com 266 bytes\n   02 82 01 01   -> INTEGER com 257 bytes: o módulo n (2048 bits + um byte 00)\n   ...\n   02 03 01 00 01 -> INTEGER de 3 bytes: o expoente público e = 65537 (no fim)\n```\n\n> [!info] Por que o exemplo das aulas usa e = 17 e o certificado usa 65537\n> O `e = 17` é do exemplo de números de brinquedo ([RSA](#rsa)). Nos certificados reais, o expoente público costuma ser **65537** (`01 00 01`).\n\n### Parâmetros de chave pública: o que é `05 00`\n\n![Janela Certificado, aba Detalhes, com o campo Parâmetros de chave pública selecionado mostrando 05 00 (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-parametros.svg)\n\n`05 00` é a codificação **ASN.1/DER** do tipo **NULL**:\n\n- `05` = identificador ASN.1 do tipo **NULL**;\n- `00` = comprimento zero (não há valor).\n\nOu seja, `05 00` significa apenas **NULL**: \"este algoritmo não tem parâmetros extras\".\n\nO campo pertence ao algoritmo da **chave pública** (`rsaEncryption`, OID `1.2.840.113549.1.1.1`): para chaves RSA, o padrão manda que os parâmetros sejam **NULL**. O mesmo `05 00` aparece no algoritmo de **assinatura** `sha256WithRSAEncryption`.\n\n```texto\nAlgoritmo da chave: rsaEncryption\nParâmetros: NULL (05 00)\n```\n\n> [!info] Correção em relação às anotações\n> As anotações ligavam o `05 00` só ao algoritmo de assinatura (`sha256RSA`). No Windows, a linha \"Parâmetros de chave pública\" se refere ao algoritmo da **chave pública** (RSA); o NULL também aparece na assinatura, pelo mesmo motivo.\n\n**Resumindo:** `05 00` não é uma chave nem uma configuração de segurança; é só a representação do valor **NULL**.",
      "exemplo": "**Cliente pergunta se é seguro mandar a chave pública.** Sim: ela foi feita para ser distribuída e já vai em todo documento assinado.\n\n**Conferir se o certificado do token é RSA 2048.** Aba **Detalhes**, campo **Chave pública**.",
      "duvidas": "### A chave pública é secreta?\nNão. Ela foi feita para ser distribuída. O segredo está na chave privada.\n\n### 05 00 é erro?\nNão. É totalmente normal e esperado em certificados ICP-Brasil, SSL/TLS e corporativos com chave RSA.\n\n### Dá para descobrir a chave privada a partir da pública?\nNão na prática: isso exigiria fatorar o módulo `n`, o que é inviável para chaves de 2048 bits (veja [RSA](#rsa)).",
      "termos": "rsa, criptografia, campo-algoritmo-assinatura, Chave pública, Chave privada, RSA",
      "saibaMais": "- [RFC 5280 — Subject Public Key Info (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)\n- [RFC 8017 — formato da chave pública RSA (em inglês)](https://www.rfc-editor.org/rfc/rfc8017)"
    }
  },
  {
    "id": "campo-aia",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 7,
    "nivel": "Intermediário",
    "titulo": "Acesso a informações da autoridade (AIA)",
    "resumo": "Os \"endereços de referência\" do certificado: onde baixar o certificado da AC e onde consultar o OCSP.",
    "palavrasChave": [
      "aia",
      "authority information access",
      "acesso a informações da autoridade",
      "ca issuers",
      "ocsp",
      "p7b",
      "cadeia",
      "1.3.6.1.5.5.7.48.2",
      "1.3.6.1.5.5.7.48.1"
    ],
    "secoes": {
      "frase": "A extensão **Acesso a Informações da Autoridade (AIA)** traz **endereços**: onde baixar o certificado da AC emissora (para montar a cadeia) e onde consultar o status do certificado via **OCSP**.",
      "simples": "É como o rodapé de um documento oficial com \"consulte a autenticidade em…\": diz ao sistema onde buscar o que ele precisa para confiar no certificado.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Acesso a Informações da Autoridade selecionado mostrando a URL da cadeia e a do OCSP (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-aia.svg)\n\n### O que o AIA contém\n\n1. **Emissor da Autoridade de Certificação** (OID `1.3.6.1.5.5.7.48.2`): URL para **baixar o certificado da AC** emissora.\n2. **Protocolo de Status de Certificados Online** (OID `1.3.6.1.5.5.7.48.1`): URL do **respondedor OCSP**.\n\nNo e-CPF de exemplo:\n\n```texto\n[1] Método de Acesso = Emissor da Autoridade de Certificação (1.3.6.1.5.5.7.48.2)\n    URL=http://icp-brasil.validcertificadora.com.br/ac-validrfb/ac-validrfbv5.p7b\n[2] Método de Acesso = Protocolo de Status de Certificados Online (1.3.6.1.5.5.7.48.1)\n    URL=(endereço do respondedor OCSP da AC)\n```\n\n> [!info] Correção em relação às anotações\n> As anotações traziam como exemplo `http://ac.valid.com.br/certificados/ac-valid-rfb-v5.cer` e `http://ocsp.valid.com.br`, que não correspondem ao print do certificado. O endereço real da cadeia, visível no certificado, é o `.p7b` acima.\n\n> [!atencao] A confirmar com o time\n> URL do respondedor OCSP da AC VALID RFB v5 (não aparece por inteiro nos prints usados nesta página).\n\n### Por que isso é necessário\n\n**1. Montar a cadeia de certificação.** Se o computador não tem o certificado da AC intermediária, ele o baixa pela URL do AIA:\n\n```texto\nAC Raiz ICP-Brasil\n   ↓\nAC intermediária\n   ↓\nAC VALID RFB v5\n   ↓\nSeu certificado\n```\n\n**2. Verificar se o certificado foi revogado.** O sistema pergunta ao OCSP *\"este certificado ainda está válido?\"* e recebe `Good`, `Revoked` ou `Unknown`. É mais rápido que baixar listas completas (veja [Revogação](#revogacao)).\n\n**3. Automatizar a validação.** Sem o AIA, alguém teria que instalar à mão vários certificados intermediários. Com ele, Windows, navegadores e outros sistemas encontram tudo sozinhos.\n\n### E se não existir AIA?\n\n- O certificado pode continuar funcionando se toda a cadeia já estiver instalada.\n- A validação pode falhar se o sistema não encontrar a AC intermediária ou não conseguir verificar a revogação.\n\nPor isso praticamente todos os certificados modernos (ICP-Brasil, SSL/TLS e corporativos) trazem essa extensão. O DOC-ICP-04 define que a primeira entrada do AIA traz o endereço da cadeia e a segunda, quando houver, o do OCSP.",
      "exemplo": "**Cadeia incompleta só na rede do cliente.** Se o firewall bloqueia o endereço do AIA, o computador não baixa a AC intermediária. Teste abrindo a URL do `.p7b` no navegador do cliente.\n\n> [!atencao] A confirmar com o time\n> Lista oficial de endereços que o cliente precisa liberar (cadeia, CRL e OCSP) por produto.",
      "duvidas": "### Por que a URL é http e não https?\nOs arquivos de cadeia e as respostas OCSP já são **assinados** pela AC; não precisam do https para serem confiáveis. Usar http evita um \"ovo e galinha\" (precisar validar um certificado de site para baixar a cadeia).\n\n### AIA e CDP são a mesma coisa?\nNão. O **AIA** aponta para a cadeia e o OCSP; o **CDP** aponta para as listas de revogação (CRL). Veja [CDP](#campo-cdp).",
      "termos": "cadeia-certificacao, revogacao, campo-cdp, AIA, OCSP",
      "saibaMais": "- [RFC 5280 — extensão Authority Information Access (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)\n- [RFC 6960 — OCSP (em inglês)](https://www.rfc-editor.org/rfc/rfc6960)"
    }
  },
  {
    "id": "campo-restricoes-basicas",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 8,
    "nivel": "Intermediário",
    "titulo": "Restrições básicas",
    "resumo": "Diz se o certificado é de uma Autoridade Certificadora (pode emitir outros) ou de uma Entidade Final (não pode).",
    "palavrasChave": [
      "restrições básicas",
      "basic constraints",
      "entidade final",
      "ca true",
      "ca false",
      "autoridade certificadora",
      "path length",
      "comprimento de caminho"
    ],
    "secoes": {
      "frase": "A extensão **Restrições Básicas (Basic Constraints)** informa **se o certificado pode emitir outros certificados**: se é de uma **Autoridade Certificadora** ou de uma **Entidade Final** (pessoa, empresa ou equipamento).",
      "simples": "É a diferença entre um **cartório** (que pode reconhecer firmas) e uma **pessoa** (que tem a firma reconhecida). O seu certificado é da pessoa: serve para identificar e assinar, não para \"abrir um cartório\".",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Restrições Básicas selecionado: Tipo de Requerente=Entidade Final, Restrição de Comprimento de Caminho=Nenhum(a) (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-restricoes-basicas.svg)\n\n### No certificado do titular: \"Entidade Final\"\n\n```texto\nTipo de Requerente = Entidade Final\n```\n\nO certificado foi emitido para uma pessoa ou organização e **não pode emitir novos certificados**.\n\n- ✅ Assinar documentos\n- ✅ Autenticar o usuário em sistemas\n- ✅ Acessar serviços do governo\n- ✅ Identificação digital\n- ❌ Atuar como Autoridade Certificadora\n- ❌ Emitir certificados para outras pessoas\n\n### Num certificado de AC\n\n```texto\nCA = TRUE\n```\n\nou, no Windows:\n\n```texto\nTipo de Requerente = Autoridade Certificadora\n```\n\nIsso indica que a entidade pode emitir certificados. As ACs têm permissões que o certificado do titular **não tem**:\n\n```texto\nAC Raiz ICP-Brasil\n   ↓\nAC VALID RFB v5\n   ↓\nSeu certificado\n```\n\n### Restrição de comprimento de caminho\n\nUsada **só em certificados de AC**: define quantas ACs ainda podem existir abaixo dela.\n\n```texto\nPath Length = 0\n```\n\nsignifica: \"esta AC pode emitir certificados para usuários finais, mas não pode criar ACs subordinadas\".\n\nNo certificado do titular aparece:\n\n```texto\nRestrição de Comprimento de Caminho = Nenhum(a)\n```\n\nporque ele é uma **Entidade Final**: essa limitação não se aplica.\n\n### Por que esse campo é importante\n\nSem ele, um sistema teria dificuldade em diferenciar um certificado de usuário comum de um certificado de AC, o que abriria riscos na cadeia (alguém poderia tentar usar um certificado de usuário para \"assinar\" certificados falsos). O DOC-ICP-04 exige `cA = False`, como extensão **crítica**, nos certificados de usuário.",
      "exemplo": "**Raramente é causa de problema no atendimento**, mas ajuda a explicar ao cliente por que o certificado dele \"não pode ser usado para emitir certificados para funcionários\": só uma AC credenciada pode.",
      "duvidas": "### Meu certificado mostra \"Nenhum(a)\" na restrição de caminho. Está errado?\nNão. Para Entidade Final esse valor é o esperado.",
      "termos": "cadeia-certificacao, icp-brasil, campo-uso-chave, Autoridade Certificadora (AC)",
      "saibaMais": "- [RFC 5280 — extensão Basic Constraints (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-identificador-chave",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 9,
    "nivel": "Avançado",
    "titulo": "Identificadores de chave (AKI e SKI)",
    "resumo": "Etiquetas de 40 caracteres que ligam cada certificado à chave da AC que o assinou.",
    "palavrasChave": [
      "aki",
      "ski",
      "authority key identifier",
      "subject key identifier",
      "identificador da chave",
      "sha-1",
      "cadeia"
    ],
    "secoes": {
      "frase": "O **Identificador da Chave da Autoridade (AKI)** diz **qual chave da AC** assinou o certificado; o **Identificador da Chave do Requerente (SKI)** identifica a chave do próprio certificado. Quando o AKI de um certificado bate com o SKI da AC, os dois estão ligados.",
      "simples": "É como o **CPF da chave**: uma etiqueta curta calculada a partir da chave pública. Não é a chave, só um jeito rápido de achar a chave certa entre várias.\n\n```texto\nChave pública\n   ↓\nHash SHA-1\n   ↓\ne52fd0e009a75bf21af3ce79c24a1202d9da4de3   (exemplo fictício)\n```",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Identificador da Chave da Autoridade selecionado (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-identificador-chave.svg)\n\nO valor tem **40 caracteres hexadecimais** (20 bytes), o tamanho de um hash **SHA-1**.\n\n### Como é calculado\n\nPelo método mais comum da RFC 5280:\n\n1. Pega-se a chave pública.\n2. Extrai-se a parte chamada `subjectPublicKey`.\n3. Calcula-se o **SHA-1** dessa estrutura.\n4. O resultado (160 bits = 20 bytes) vira o identificador.\n\n```texto\nChave pública\n   ↓\n3082010a0282010100…\n   ↓\nSHA-1\n   ↓\ne52fd0e009a75bf21af3ce79c24a1202d9da4de3\n```\n\nO DOC-ICP-04 define o AKI como o **hash SHA-1 de 160 bits da chave pública da AC** que emitiu o certificado.\n\n### Para que serve: ligar os elos da cadeia\n\n```texto\nSeu certificado\n   Identificador da Chave da Autoridade (AKI) = e52fd0e0…de3\n                          ↕ iguais\nCertificado da AC VALID RFB v5\n   Identificador da Chave do Requerente (SKI) = e52fd0e0…de3\n```\n\nIsso permite ao Windows identificar rapidamente: *\"este certificado foi assinado pela AC cuja chave tem este identificador\"*. É especialmente útil quando a AC renovou a chave e existem dois certificados dela com o mesmo nome.\n\n### Por que usam SHA-1 se ele é considerado inseguro?\n\nO SHA-1 **não está protegendo nada** aqui: ele é só uma **etiqueta**.\n\n- ✅ Localizar uma chave\n- ✅ Relacionar certificados na cadeia\n- ✅ Encontrar rapidamente a AC emissora\n- ❌ Assinar o certificado\n- ❌ Proteger dados\n- ❌ Garantir integridade criptográfica\n\nA segurança da assinatura vem do algoritmo de assinatura (por exemplo, `sha256RSA`). Por isso é normal ver identificadores em SHA-1 em certificados modernos assinados com SHA-256.",
      "exemplo": "**Dois certificados de AC com o mesmo nome na máquina do cliente.** O Windows escolhe o certo pelo AKI/SKI. Se a cadeia aparece \"quebrada\" mesmo com as ACs instaladas, compare o AKI do certificado do cliente com o SKI dos certificados de AC instalados: pode estar instalada uma geração antiga da AC.",
      "duvidas": "### SHA-1 no identificador é inseguro?\nNão, porque ali ele não tem papel de segurança: é só uma etiqueta para achar a chave certa.\n\n### O identificador é a chave pública?\nNão. É um hash dela, muito menor, usado só para localizar e relacionar chaves.",
      "termos": "cadeia-certificacao, campo-emissor, hash-sha, AKI, SKI",
      "saibaMais": "- [RFC 5280 — Authority/Subject Key Identifier (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-politicas",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 10,
    "nivel": "Intermediário",
    "titulo": "Políticas de certificado (OID)",
    "resumo": "Sob quais regras o certificado foi emitido: um OID da ICP-Brasil e o link para a Declaração de Práticas da AC.",
    "palavrasChave": [
      "políticas",
      "certificate policies",
      "oid",
      "2.16.76.1.2.3",
      "dpc",
      "cps",
      "declaração de práticas",
      "pc",
      "a3"
    ],
    "secoes": {
      "frase": "A extensão **Políticas Dos Certificados (Certificate Policies)** informa **sob quais regras o certificado foi emitido**, com um identificador único (**OID**) e o link para o documento da AC.",
      "simples": "Na **CNH**, é a **categoria** e as regras que se aplicam a ela. Assim como a categoria B permite dirigir certos veículos, a política diz quais requisitos foram cumpridos e em que situações o certificado deve ser aceito.\n\n```texto\nTitular                   = motorista\nEmissor                   = Detran\nNúmero de série           = número da CNH\nPolítica de certificado   = categoria da habilitação e regras\n```",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Políticas Dos Certificados selecionado: Identificador de Política=2.16.76.1.2.3.36 e link da DPC (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-politicas.svg)\n\nNo e-CPF de exemplo:\n\n```texto\nIdentificador de Política = 2.16.76.1.2.3.36\nQualificador (CPS) = http://icp-brasil.validcertificadora.com.br/ac-validrfb/dpc-ac-validrfbv5.pdf\n```\n\nO link aponta para a **DPC** (Declaração de Práticas de Certificação) da AC, o documento que detalha como ela trabalha.\n\n### Por que precisa constar no certificado\n\n**1. Define o nível de garantia da identidade.** Nem todos os certificados são emitidos da mesma forma (validação presencial, por biometria; para pessoa física, servidor ou equipamento). A política informa quais verificações foram feitas antes da emissão.\n\n**2. Ajuda a determinar o uso permitido.** Sistemas e auditores entendem para que o certificado foi emitido (autenticação de usuário, assinatura digital, acesso a sistemas do governo, transações eletrônicas) e podem recusar usos não previstos.\n\n**3. Permite auditoria e conformidade.** A ICP-Brasil exige que as ACs mantenham documentos detalhando como validam a identidade, como geram as chaves, como revogam e quais responsabilidades têm. O campo aponta para esses documentos.\n\n**4. Facilita a confiança entre organizações.** Um sistema que recebe dois certificados com políticas diferentes pode decidir qual atende aos requisitos dele.\n\n### O que é o OID\n\nUm **OID (Object Identifier)** é um número único, em formato de \"galhos\", que identifica um objeto: aqui, uma política. É como um CPF para objetos da infraestrutura de certificação.\n\n```texto\n2.16.76               -> Brasil (galho usado pela ICP-Brasil)\n2.16.76.1.2.3.n       -> políticas de certificados do tipo A3\n2.16.76.1.2.3.36      -> uma política A3 específica (a da AC do exemplo)\n```\n\nPelo DOC-ICP-04, cada tipo tem o seu galho: A3 = `2.16.76.1.2.3.n`, A4 = `2.16.76.1.2.4.n`, T3 = `2.16.76.1.2.303.n`, e assim por diante.\n\n> [!atencao] A confirmar com o time\n> A qual produto da Valid corresponde o OID 2.16.76.1.2.3.36 e os OIDs dos demais produtos (ex.: nuvem, e-CNPJ).",
      "exemplo": "**Sistema exige \"certificado A3\" e recusa o do cliente.** O sistema pode estar conferindo o **OID da política**. Veja se ele começa com `2.16.76.1.2.3.` (A3).",
      "duvidas": "### O link da DPC é obrigatório?\nPelo DOC-ICP-04, a extensão deve trazer o OID da política e o endereço da DPC da AC emitente.\n\n### OID é só para políticas?\nNão. OIDs identificam algoritmos (`1.2.840.113549.1.1.11` = sha256WithRSA), finalidades de uso (`1.3.6.1.5.5.7.3.2` = Autenticação de Cliente), campos do SAN (`2.16.76.1.3.1`) e muito mais.",
      "termos": "certificado-tipos, campo-uso-avancado, campo-san, OID, icp-brasil",
      "saibaMais": "- [ITI — Documentos principais (DOC-ICP-04: OIDs das políticas)](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais)\n- [RFC 5280 — extensão Certificate Policies (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-cdp",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 11,
    "nivel": "Intermediário",
    "titulo": "Pontos de distribuição da LCR (CDP)",
    "resumo": "Os endereços onde a AC publica a lista de certificados revogados, e por que há mais de um.",
    "palavrasChave": [
      "cdp",
      "crl distribution points",
      "pontos de distribuição",
      "lcr",
      "crl",
      "lista de certificados revogados",
      "revogação",
      "icp-brasil2"
    ],
    "secoes": {
      "frase": "A extensão **Pontos de Distribuição da Lista de Certificados Revogados (CRL Distribution Points, CDP)** informa **onde baixar a lista de certificados cancelados** da AC.",
      "simples": "É o endereço da \"lista de cheques sustados\" daquele banco: o sistema vai até lá, baixa a lista e confere se o número do seu certificado está nela.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Pontos de Distribuição da Lista de Certificados Revogados selecionado mostrando dois endereços .crl (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-cdp.svg)\n\nNo e-CPF de exemplo:\n\n```texto\nhttp://icp-brasil.validcertificadora.com.br/ac-validrfb/lcr-ac-validrfbv5.crl\nhttp://icp-brasil2.validcertificadora.com.br/ac-validrfb/lcr-ac-validrfbv5.crl\n```\n\n> [!info] Correção em relação às anotações\n> As anotações traziam `…/ac-validrfbv5.crl`. No certificado, o arquivo fica na pasta `ac-validrfb/` e se chama `lcr-ac-validrfbv5.crl` (\"LCR\" é o nome da CRL na ICP-Brasil).\n\n> [!atencao] A confirmar com o time\n> Caminho completo da segunda URL (icp-brasil2), que aparece cortada nos prints usados nesta página.\n\nEsses endereços permitem que Windows, Adobe Reader, navegadores e sistemas do governo baixem a **CRL**.\n\n### O que é a CRL\n\nUma lista publicada e assinada pela AC com os certificados que não devem mais ser aceitos:\n\n| Número de série | Situação |\n| --- | --- |\n| A12345 | Revogado |\n| B98765 | Revogado |\n| C77777 | Revogado |\n\nMotivos comuns: perda do token ou cartão, roubo do dispositivo, suspeita de comprometimento da chave privada, mudança de dados do titular, pedido do titular ou determinação da AC.\n\n### Como funciona a validação\n\n```texto\nCertificado recebido\n   ↓\nSistema verifica o emissor\n   ↓\nSistema consulta a CRL (endereço do CDP)\n   ↓\nNúmero de série encontrado?\n   ↓\nNão -> certificado válido\nSim -> certificado revogado\n```\n\n### CRL × OCSP\n\n- **CRL:** baixa a lista completa de revogados.\n- **OCSP:** pergunta diretamente *\"este certificado está revogado?\"* e recebe `Good`, `Revoked` ou `Unknown`. O endereço do OCSP fica no [AIA](#campo-aia).\n\nO OCSP é mais rápido, mas muitos sistemas consultam os dois. Comparação completa em [Revogação](#revogacao).\n\n### Por que há mais de uma URL\n\nPara **disponibilidade**:\n\n```texto\nServidor 1 indisponível\n   ↓\nSistema tenta o servidor 2\n```\n\nAssim a validação continua funcionando se um dos servidores estiver fora do ar.\n\n### Por que esse campo é importante\n\nSem ele, um sistema poderia confiar num certificado já cancelado:\n\n```texto\nCertificado roubado\n   ↓\nAC revoga o certificado\n   ↓\nSistema consulta a CRL\n   ↓\nDetecta a revogação\n```",
      "exemplo": "**Validação lenta ou falhando só em uma empresa.** O firewall pode bloquear os endereços `.crl`. Peça ao cliente para abrir a URL da LCR no navegador: se não baixar, é bloqueio de rede.",
      "duvidas": "### Por que duas URLs de CRL?\nPara que a validação continue funcionando se um dos servidores estiver fora do ar.\n\n### A CRL tem dados pessoais?\nNão: tem números de série e datas de revogação, assinados pela AC.",
      "termos": "revogacao, campo-aia, campo-numero-serie, CRL, OCSP",
      "saibaMais": "- [RFC 5280 — CRL e CRL Distribution Points (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-uso-chave",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 12,
    "nivel": "Intermediário",
    "titulo": "Uso da chave (Key Usage)",
    "resumo": "As operações criptográficas que a chave pode fazer: Assinatura Digital, Não-Recusa e Criptografia de Chaves.",
    "palavrasChave": [
      "uso da chave",
      "key usage",
      "assinatura digital",
      "não-recusa",
      "não repúdio",
      "nonrepudiation",
      "content commitment",
      "criptografia de chaves",
      "key encipherment",
      "e0"
    ],
    "secoes": {
      "frase": "A extensão **Uso da Chave (Key Usage)** define **quais operações criptográficas** a chave do certificado pode executar, como **assinar** ou **proteger outras chaves**.",
      "simples": "É o \"pode / não pode\" técnico da chave: como os itens de uma ferramenta multiuso que vêm destravados de fábrica.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Uso da Chave selecionado: Assinatura Digital, Não-Recusa, Criptografia de Chaves (e0) (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-uso-chave.svg)\n\nNo e-CPF de exemplo:\n\n```texto\nAssinatura Digital, Não-Recusa, Criptografia de Chaves (e0)\n```\n\nEssas permissões são **bits** gravados no certificado; o Windows traduz para texto. O `(e0)` é a soma dos bits ligados, em hexadecimal:\n\n| Permissão | Nome técnico | Bit | Valor |\n| --- | --- | --- | --- |\n| Assinatura Digital | digitalSignature | 0 | `80` |\n| Não-Recusa (Não-Repúdio) | nonRepudiation / contentCommitment | 1 | `40` |\n| Criptografia de Chaves | keyEncipherment | 2 | `20` |\n| **Total** | | | **`e0`** |\n\n### 1. Assinatura Digital (digitalSignature)\n\nPermite usar a chave privada para assinar documentos PDF, arquivos eletrônicos, transações e autenticações em sistemas.\n\n```texto\nDocumento\n   ↓\nAssinado com a sua chave privada\n   ↓\nAssinatura digital válida\n```\n\n### 2. Não-Recusa ou Não-Repúdio (nonRepudiation / contentCommitment)\n\nIndica que o titular não pode negar depois uma assinatura feita com a sua chave privada: *\"a assinatura foi produzida pela chave privada ligada ao certificado\"*. Os padrões mais novos chamam essa finalidade de **Content Commitment** (compromisso com o conteúdo).\n\n```texto\nMaria assina um contrato digitalmente\n   ↓\nDepois, a assinatura pode ser validada tecnicamente\n```\n\n### 3. Criptografia de Chaves (keyEncipherment)\n\nPermite que a chave pública do certificado proteja **outras chaves**:\n\n```texto\nChave de sessão AES\n   ↓\nCriptografada com a chave pública\n   ↓\nSó a chave privada correspondente consegue recuperá-la\n```\n\nMuito usado em TLS/SSL, e-mail seguro (S/MIME) e sistemas corporativos.\n\n### Uso da chave × Uso avançado da chave\n\n| | Uso da chave | Uso avançado da chave (EKU) |\n| --- | --- | --- |\n| Responde | **O que** a chave pode fazer? | **Em qual aplicação** pode ser usada? |\n| Exemplos | Assinar, criptografar chaves, trocar chaves | Autenticação de Cliente, E-mail Seguro, Servidor Web, Assinatura de Código |\n\n### Aplicando ao exemplo\n\nO certificado pode:\n\n- ✅ fazer assinaturas digitais;\n- ✅ dar a garantia de não-repúdio às assinaturas;\n- ✅ participar de criptografia e troca segura de chaves;\n- ✅ ser usado em autenticação e e-mail seguro, conforme o [EKU](#campo-uso-avancado).\n\nPelo DOC-ICP-04, nos certificados de assinatura de pessoa física o **Uso da Chave** é uma extensão **crítica**, com `digitalSignature` obrigatório e `nonRepudiation` e `keyEncipherment` permitidos. Por isso o Windows mostra o campo com ícone de alerta.",
      "exemplo": "**Programa diz que o certificado \"não serve para assinatura\".** Confira se **Assinatura Digital** (e, para documentos, **Não-Recusa**) aparece no Uso da Chave. Certificados de outros tipos (por exemplo, de servidor SSL) podem não ter essas permissões.",
      "duvidas": "### \"Não-Recusa\" e \"Não-Repúdio\" são a mesma coisa?\nSim, são traduções diferentes de *nonRepudiation*. O Windows usa \"Não-Recusa\".\n\n### Por que o campo aparece com um ícone de alerta?\nPorque é uma extensão **crítica**: o sistema que não entender esse campo deve recusar o certificado.",
      "termos": "campo-uso-avancado, assinatura-digital-eletronica, campo-restricoes-basicas, Key Usage, EKU",
      "saibaMais": "- [RFC 5280 — extensão Key Usage (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-uso-avancado",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 13,
    "nivel": "Intermediário",
    "titulo": "Uso avançado de chave (EKU)",
    "resumo": "Em quais aplicações o certificado pode ser usado: Autenticação de Cliente, E-mail Seguro e outras.",
    "palavrasChave": [
      "eku",
      "extended key usage",
      "uso avançado de chave",
      "autenticação de cliente",
      "client authentication",
      "email seguro",
      "s/mime",
      "1.3.6.1.5.5.7.3.2",
      "1.3.6.1.5.5.7.3.4",
      "server authentication"
    ],
    "secoes": {
      "frase": "A extensão **Uso Avançado de Chave (Enhanced/Extended Key Usage, EKU)** define **para quais finalidades** o certificado pode ser usado, como **login em sites** (Autenticação de Cliente) e **e-mail seguro**.",
      "simples": "Se o **Uso da Chave** diz o que a ferramenta faz (cortar, parafusar), o **EKU** diz em que serviços ela pode ser usada (só na obra, só na oficina). É uma **lista de permissões** de uso.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Uso Avançado de Chave selecionado: Autenticação de Cliente (1.3.6.1.5.5.7.3.2) e Email Seguro (1.3.6.1.5.5.7.3.4) (recriação com dados fictícios)](fotos/aprender/certificado/janela-campo-uso-avancado.svg)\n\nNo e-CPF de exemplo:\n\n```texto\nAutenticação de Cliente (1.3.6.1.5.5.7.3.2)\nEmail Seguro (1.3.6.1.5.5.7.3.4)\n```\n\n### 1. Autenticação de Cliente — OID `1.3.6.1.5.5.7.3.2`\n\nPermite usar o certificado para:\n\n- ✅ login em sistemas do governo;\n- ✅ e-CAC da Receita Federal;\n- ✅ Conectividade Social ICP;\n- ✅ portais que exigem certificado digital;\n- ✅ VPNs e aplicações corporativas.\n\nQuando um site pede certificado, o servidor confere se ele tem essa finalidade.\n\n### 2. E-mail Seguro — OID `1.3.6.1.5.5.7.3.4`\n\n- ✅ assinar e-mails digitalmente;\n- ✅ criptografar mensagens;\n- ✅ garantir a autenticidade do remetente.\n\nUsado no padrão **S/MIME**, comum em ambientes corporativos e de governo.\n\n### Por que esse campo é necessário\n\nUm certificado emitido só para um **servidor web** teria `Server Authentication`, mas **não** `Client Authentication`; assim, não poderia ser usado para login de pessoas. O EKU impede que um certificado seja usado para finalidades para as quais não foi emitido.\n\n### Outros EKUs comuns\n\n| Finalidade | OID |\n| --- | --- |\n| Autenticação de Servidor (HTTPS) | `1.3.6.1.5.5.7.3.1` |\n| Autenticação de Cliente | `1.3.6.1.5.5.7.3.2` |\n| Assinatura de Código | `1.3.6.1.5.5.7.3.3` |\n| E-mail Seguro | `1.3.6.1.5.5.7.3.4` |\n| Carimbo do Tempo | `1.3.6.1.5.5.7.3.8` |\n| Assinatura OCSP | `1.3.6.1.5.5.7.3.9` |\n\n### Uso da chave × EKU, lado a lado\n\n| | Uso da chave (Key Usage) | Uso avançado (EKU) |\n| --- | --- | --- |\n| Pergunta | O que a chave **faz**? | Em qual **aplicação** pode ser usada? |\n| No exemplo | Assinatura Digital, Não-Recusa, Criptografia de Chaves | Autenticação de Cliente, Email Seguro |\n| Detalhes | [Uso da chave](#campo-uso-chave) | esta página |\n\n**Resumindo:** o certificado de exemplo foi emitido para **identificação/autenticação do titular** em sistemas eletrônicos e para **assinatura e proteção de e-mails**.",
      "exemplo": "**Cliente diz que o certificado \"não aparece\" para escolher no portal.** Muitos portais só listam certificados com **Autenticação de Cliente** no EKU e dentro da validade. Confira os dois. Se o EKU estiver certo, veja se o certificado está em **Pessoal › Certificados** no `certmgr.msc` e, se for A3, se o token está conectado.\n\n> [!atencao] A confirmar com o time\n> Lista de portais atendidos com frequência e os requisitos de cada um (EKU, tipo A1/A3, navegador).",
      "duvidas": "### Posso usar o e-CPF para HTTPS de um site?\nNão. Para site é preciso um certificado SSL/TLS, com **Autenticação de Servidor** no EKU e o domínio no SAN.\n\n### Se o EKU não tiver \"Email Seguro\", consigo assinar e-mail?\nProgramas de e-mail costumam exigir essa finalidade para S/MIME; sem ela, o certificado pode nem aparecer na lista.",
      "termos": "campo-uso-chave, campo-san, EKU, Key Usage, OID",
      "saibaMais": "- [RFC 5280 — extensão Extended Key Usage (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-san",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 14,
    "nivel": "Avançado",
    "titulo": "Nome alternativo do requerente (SAN)",
    "resumo": "Identificações extras do titular: e-mail (RFC822) e os campos da ICP-Brasil com CPF, título de eleitor e outros, por OID.",
    "palavrasChave": [
      "san",
      "subject alternative name",
      "nome alternativo",
      "rfc822",
      "e-mail",
      "oid",
      "2.16.76.1.3.1",
      "2.16.76.1.3.5",
      "2.16.76.1.3.6",
      "2.16.76.1.3.3",
      "cpf",
      "cnpj",
      "título de eleitor",
      "cei",
      "nis",
      "rg"
    ],
    "secoes": {
      "frase": "A extensão **Nome Alternativo Para o Requerente (Subject Alternative Name, SAN)** guarda **identificações extras do titular**, além do nome do Requerente: e-mail e, na ICP-Brasil, dados como CPF, CNPJ e título de eleitor, cada um marcado por um **OID**.",
      "simples": "É o \"verso\" da identidade: no verso do RG ficam CPF, título, número de registro. No certificado, essas informações ficam no SAN, organizadas em \"gavetas\" numeradas (os OIDs), para os sistemas acharem cada uma sem adivinhar.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Nome Alternativo Para o Requerente selecionado: Nome RFC822=titular@exemplo.com.br e outros nomes com OIDs da ICP-Brasil (recriação com dados fictícios; os valores reais foram substituídos por zeros)](fotos/aprender/certificado/janela-campo-san.svg)\n\nNo exemplo (fictício):\n\n```texto\nNome RFC822=titular@exemplo.com.br\nOutro Nome:  2.16.76.1.3.1=…\nOutro Nome:  2.16.76.1.3.6=…\nOutro Nome:  2.16.76.1.3.5=…\n```\n\n### Por que existe o SAN\n\nO nome principal (Subject) nem sempre basta para identificar o titular. O SAN permite incluir: e-mail, CPF, CNPJ, data de nascimento, NIS/PIS, título de eleitor, outros atributos da ICP-Brasil e, em certificados de site, os **nomes DNS**.\n\n### RFC822: o e-mail\n\n```texto\nRFC822=titular@exemplo.com.br\n```\n\n**RFC822** é o padrão usado para representar endereços de e-mail em certificados X.509.\n\n### Os OIDs 2.16.76.1.3.x da ICP-Brasil\n\nConforme o **DOC-ICP-04**:\n\n| OID | Conteúdo | Usado em |\n| --- | --- | --- |\n| `2.16.76.1.3.1` | Dados da pessoa física titular: **data de nascimento** (8 posições, ddmmaaaa), **CPF** (11), **NIS** (PIS, PASEP ou CI, 11), **RG** (15) e **órgão expedidor e UF** | Pessoa física |\n| `2.16.76.1.3.5` | **Título de eleitor**: inscrição (12), zona (3), seção (4) e município e UF (22) | Pessoa física |\n| `2.16.76.1.3.6` | **CEI** (Cadastro Específico do INSS) da pessoa física (12) | Pessoa física |\n| `2.16.76.1.3.2` | **Nome do responsável** pelo certificado | Pessoa jurídica |\n| `2.16.76.1.3.3` | **CNPJ** da empresa titular (14) | Pessoa jurídica |\n| `2.16.76.1.3.4` | Dados do **responsável**: nascimento, CPF, NIS, RG e órgão/UF | Pessoa jurídica |\n| `2.16.76.1.3.7` | **CEI** da pessoa jurídica (12) | Pessoa jurídica |\n| `2.16.76.1.3.8` | **Nome empresarial** (como no CNPJ) | Pessoa jurídica e equipamentos/aplicações |\n\nCampos sem informação são preenchidos com zeros.\n\n> [!atencao] Correção em relação às anotações\n> As anotações diziam: 2.16.76.1.3.1 = CPF; .3.2 = nome de pessoa física; .3.3 = título de eleitor; .3.4 = data de nascimento. Pelo DOC-ICP-04, a correspondência certa é a da tabela acima: o **.3.1** junta nascimento, CPF, NIS e RG; título de eleitor é o **.3.5**; CEI é o **.3.6**; e .3.2, .3.3, .3.4, .3.7 e .3.8 são de **pessoa jurídica**.\n\n> [!atencao] A confirmar com o time\n> Se as versões mais recentes do DOC-ICP-04 mudaram onde o CPF fica gravado (nome do titular × SAN) e se há prazo de transição para o otherName 2.16.76.1.3.1.\n\n### Por que os valores aparecem em hexadecimal\n\nOs dados ficam codificados em ASN.1, e o Windows mostra os bytes em hexadecimal:\n\n```texto\n2.16.76.1.3.1=04 33 30 31 30 31 31 39 39 30 30 30 …\n```\n\n`04 33` é o \"cabeçalho\" (uma sequência de 51 bytes); depois, cada par é um caractere: `30` = \"0\", `31` = \"1\", `39` = \"9\". No exemplo fictício, `30 31 30 31 31 39 39 30` = \"01011990\" (a data de nascimento inventada) e o CPF são onze `30` (\"00000000000\").\n\n> [!erro] Cuidado com dados pessoais\n> No certificado de um cliente, essa linha contém o **CPF, a data de nascimento e o RG reais**. Não copie esse campo para chamados, chats ou prints sem necessidade, e sempre tarje antes de compartilhar.\n\n### Por que os sistemas usam o SAN\n\nPortais como o **e-CAC**, a **Conectividade Social ICP**, o **gov.br** e sistemas corporativos leem o SAN para obter os dados do titular de forma padronizada, sem precisar interpretar o nome.\n\n### Requerente × SAN\n\n```texto\nRequerente (Subject):         MARIA EXEMPLO DA SILVA:00000000000\nNome alternativo (SAN):       e-mail · CPF · identificadores ICP-Brasil · outros atributos\n```\n\nO SAN **complementa** a identificação do titular.",
      "exemplo": "**Portal diz que o CPF do certificado é diferente do cadastro.** O portal lê o CPF do SAN (`2.16.76.1.3.1`) ou do nome do titular. Confira com o cliente, sem copiar os dados para o chamado, se o certificado é mesmo do CPF da conta.\n\n**Cliente pede para \"ver o CPF no certificado\".** Mostre na aba Geral ou no Requerente (o nome vem seguido do CPF). Explique que a linha 2.16.76.1.3.1 tem os dados codificados.",
      "duvidas": "### Por que o meu e-mail está no certificado?\nPara permitir o uso em e-mail seguro (S/MIME) e identificação adicional. Ele aparece como `RFC822`.\n\n### Os OIDs do SAN são iguais no e-CNPJ?\nNão. O e-CNPJ usa os OIDs de pessoa jurídica (`.3.2`, `.3.3`, `.3.4`, `.3.7`).",
      "termos": "campo-validade-requerente, campo-politicas, campo-uso-avancado, SAN, OID",
      "saibaMais": "- [ITI — Documentos principais (DOC-ICP-04: campos otherName do SAN)](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais)\n- [RFC 5280 — extensão Subject Alternative Name (em inglês)](https://www.rfc-editor.org/rfc/rfc5280)"
    }
  },
  {
    "id": "campo-impressao-digital",
    "trilha": "certificacao",
    "paiId": "anatomia-certificado",
    "ordem": 15,
    "nivel": "Intermediário",
    "titulo": "Impressão digital (Thumbprint)",
    "resumo": "Um hash do certificado inteiro, usado para identificar exatamente qual certificado é, e achá-lo entre vários.",
    "palavrasChave": [
      "impressão digital",
      "thumbprint",
      "fingerprint",
      "sha-1",
      "hash",
      "get-childitem",
      "cert:",
      "certmgr",
      "identificar certificado"
    ],
    "secoes": {
      "frase": "A **impressão digital (Thumbprint ou Fingerprint)** é um **hash do certificado inteiro**: um identificador único que permite saber se um certificado é exatamente o esperado.",
      "simples": "Como a **impressão digital de uma pessoa**: pequena, única e impossível de \"coincidir\" por acaso. Se qualquer coisa no certificado mudar, a impressão digital muda completamente.",
      "funciona": "![Janela Certificado, aba Detalhes, com o campo Impressão Digital selecionado (recriação com valor fictício)](fotos/aprender/certificado/janela-campo-impressao-digital.svg)\n\nNo exemplo (fictício):\n\n```texto\n8f11c191ec0b470e09c37b8544b349f06d589d50\n```\n\n### Como é calculada\n\nO sistema pega todo o conteúdo do certificado (no formato DER) e aplica um hash:\n\n```texto\nCertificado completo\n   ↓\nAlgoritmo de hash\n   ↓\nImpressão digital\n```\n\nO valor tem **40 caracteres hexadecimais** = **20 bytes (160 bits)**, o tamanho de um hash **SHA-1**: é o que o Windows mostra.\n\n### A impressão digital é a chave pública?\n\nNão.\n\n| | Serve para |\n| --- | --- |\n| **Chave pública** | Conferir assinaturas e criptografar informações para o titular |\n| **Impressão digital** | Identificar unicamente o certificado |\n\n### Para que serve\n\n**1. Identificar um certificado específico.** Entre vários (certificado A, B, C), a impressão digital aponta exatamente um.\n\n**2. Verificar integridade.** Se qualquer byte mudar (nome, validade, chave pública, extensões), a impressão digital muda completamente.\n\n**3. Comparar certificados.** Impressões digitais iguais = exatamente o mesmo certificado. Diferentes = outro certificado.\n\n**4. Administração e suporte.** Em ambientes corporativos é comum identificar certificados só pela impressão digital:\n\n```powershell\nGet-ChildItem Cert:\\CurrentUser\\My\n```\n\nO Windows mostra o **Thumbprint** de cada certificado instalado, o que facilita achar o certo.\n\n### Por que usa SHA-1 se o certificado usa SHA-256?\n\nA assinatura do certificado (`sha256RSA`) é o que **protege** o certificado. A impressão digital é só um **identificador** prático: não participa da assinatura nem da validação de confiança.\n\n> [!info] Correção em relação às anotações\n> As anotações diziam que a impressão digital \"distingue esse certificado de qualquer outro no mundo\". Na prática é isso, mas, como ela usa SHA-1, ela **identifica**, e não **protege**: a garantia de que ninguém alterou o certificado vem da assinatura da AC.",
      "exemplo": "**Achar o certificado certo entre vários no Windows.** No PowerShell do cliente:\n\n```powershell\nGet-ChildItem Cert:\\CurrentUser\\My | Select-Object Subject, NotAfter, Thumbprint\n```\n\nCompare o **Thumbprint** com o do certificado esperado (aba Detalhes › Impressão Digital). Para abrir um certificado específico pelo Thumbprint:\n\n```powershell\nGet-ChildItem Cert:\\CurrentUser\\My\\8F11C191EC0B470E09C37B8544B349F06D589D50 | Format-List *\n```\n\n(O valor acima é fictício; use o do certificado do cliente.)\n\n**Sistema configurado com o certificado antigo depois da renovação.** Muitos sistemas guardam o Thumbprint do certificado escolhido. Após renovar, o certificado novo tem outra impressão digital e precisa ser selecionado de novo no sistema.\n\n> [!atencao] A confirmar com o time\n> Quais sistemas atendidos pelo time guardam o Thumbprint e exigem nova seleção após a renovação.",
      "duvidas": "### A impressão digital é secreta?\nNão. Ela é calculada a partir do certificado público.\n\n### Maiúsculas ou minúsculas fazem diferença?\nNão. `6D01…` e `6d01…` representam o mesmo valor hexadecimal.\n\n### Dois certificados podem ter a mesma impressão digital?\nNa prática, não: ela muda com qualquer byte do certificado. Na renovação, o certificado novo sempre tem outra.",
      "termos": "hash-sha, campo-numero-serie, campo-chave-publica, Thumbprint, Hash",
      "saibaMais": "- [Microsoft Learn — certutil](https://learn.microsoft.com/pt-br/windows-server/administration/windows-commands/certutil)"
    }
  }
];
