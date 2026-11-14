/*
 * Trilha "Certificados SSL — Guia do Suporte" (Aprendizagem - Tire suas dúvidas).
 * Fonte: página "SSL" do SharePoint do Suporte Técnico N2 (tipos de certificado, mercado financeiro,
 * CSR com OpenSSL, modelos de comando por produto, preenchimento e conversões), com complementos
 * (TLS, validação DV/OV/EV, formatos de arquivo, PFX, conferências com OpenSSL).
 * As aulas são públicas: os comandos usam dados FICTÍCIOS no lugar dos clientes, CNPJs e IDs reais do material.
 * Correções em relação ao material: exemplos Teste/Produção do COMPE estavam trocados; a conversão DER → PEM
 * gravava por cima do próprio arquivo; o comando multi-domínio usava aspas curvas (o OpenSSL não aceita).
 * Prints em fotos/aprender/ssl/ (os que mostravam dados de cliente ou o usuário de um colega ficaram de fora).
 * Depois de publicado, vale o que estiver no Firestore (edite pelo site).
 */
const L = (...linhas) => linhas.join("\n");
const CAIXA = (tipo, titulo, ...linhas) => L(`> [!${tipo}] ${titulo}`, ...linhas.map((l) => "> " + l));
const CONFIRMAR = (...linhas) => CAIXA("atencao", "A confirmar com o time", ...linhas);
const CODIGO = (linguagem, ...linhas) => L("```" + linguagem + " quebrar", ...linhas, "```");
const IMG = (arquivo, alt) => `![${alt}](fotos/aprender/ssl/${arquivo})`;
const TRILHA = "ssl-guia";
const CRIADO = "2026-11-12T10:00:00.000Z";

export const TRILHA_SSL = {
  id: TRILHA, nome: "Certificados SSL — Guia do Suporte", categoria: "seguranca", icone: "i-cadeado", cor: "laranja",
  descricao: "Os modelos de certificado SSL e do mercado financeiro, como gerar e conferir a CSR no OpenSSL, o modelo de comando de cada produto, o preenchimento e as conversões de arquivo.",
  nivel: "Intermediário", fontes: "Página “SSL” do Suporte Técnico N2 (Lays Santos Almeida de Farias, Líder de Suporte) · documentação do OpenSSL · regras do CA/Browser Forum",
  modulos: [
    { id: "fundamentos", nome: "Fundamentos", descricao: "O que o SSL/TLS protege, os níveis de validação (DV, OV e EV), Wildcard e Multi-domínio.", ordem: 1 },
    { id: "catalogo", nome: "Catálogo de certificados", descricao: "Autenticação de servidores, Code Signing, S/MIME, Equipamento A1, Infoconv, mercado financeiro ICP-Brasil e Open Finance.", ordem: 2 },
    { id: "csr", nome: "CSR na prática", descricao: "O que é a CSR, como gerar no OpenSSL, como preencher cada campo e o modelo de comando de cada produto.", ordem: 3 },
    { id: "arquivos", nome: "Arquivos e conversões", descricao: "PEM, DER, CER, KEY, PFX e P7B: como reconhecer, converter e montar o PFX.", ordem: 4 },
    { id: "atendimento", nome: "No atendimento", descricao: "Checklist antes de enviar a CSR, erros comuns e perguntas frequentes.", ordem: 5 }
  ],
  atualizadoEm: CRIADO
};

const aula = (id, modulo, ordem, nivel, titulo, resumo, palavrasChave, blocos) => ({
  id, trilha: TRILHA, modulo, paiId: null, ordem, nivel, titulo, resumo, palavrasChave, blocos, atualizadoEm: CRIADO
});
const SUPORTE = (...linhas) => ({ id: "suporte", titulo: "Na prática no Suporte N2", icone: "i-ferramenta", markdown: L(...linhas) });
const TERMOS = (texto) => ({ id: "termos", titulo: "Termos relacionados", icone: "i-tag", markdown: texto });

/* Modelo de CSR dos certificados do mercado financeiro (CIP): CN, OU sigla+ambiente, OU cadastro, OU razão social */
const CSR_CIP = (arquivo, cn, ou, razao) => `openssl req -sha256 -newkey rsa:2048 -keyout ${arquivo}.key -out ${arquivo}.csr -subj /CN="${cn}"/OU="${ou}"/OU="12345678"/OU="${razao}"/O="ICP-Brasil"/L="SAO PAULO"/ST="SP"/C="BR"/`;
const TESTE_PRODUCAO = (teste, producao, ...depois) => L(
  "**Teste (homologação):**", "", CODIGO("bash", teste), "", "**Produção:**", "", CODIGO("bash", producao), ...(depois.length ? ["", ...depois] : []));
/* Campos do modelo dos certificados da CIP (C3, CTC, ECO, R2C3, SCC, SCG, SEC, SELTEC e SILOC) */
const CAMPOS_CIP = (sigla) => L(
  "| Campo | O que preencher | Exemplo |",
  "| --- | --- | --- |",
  "| **CN** (Common Name) | Endereço (servidor/domínio) onde o certificado será usado | `servidor.exemplo.com.br` |",
  "| **O** (Organization) | Sempre **ICP-Brasil** | `ICP-Brasil` |",
  `| **OU** (1ª) | Sigla do produto + **P** (produção) ou **T** (teste) + número do cadastro da empresa | \`${sigla} P001\` |`,
  "| **OU** (2ª) | Número do cadastro da organização, com **8 dígitos** | `12345678` |",
  "| **OU** (3ª) | Razão social conforme o cadastro do CNPJ, sem abreviações e sem caracteres especiais | `EMPRESA EXEMPLO S.A.` |",
  "| **L** (Locality) | Cidade da empresa | `Sao Paulo` |",
  "| **ST** (State) | Estado da empresa | `SP` |",
  "| **C** (Country) | Sigla do país | `BR` |",
  "{tabela: listrada largura=total}");

export const AULAS_SSL = [
  /* ---------------- Módulo 1 · Fundamentos ---------------- */
  aula("sg-introducao", "fundamentos", 1, "Básico", "SSL/TLS: o que é e o que protege",
    "A segurança digital que cria a comunicação criptografada com um site e prova que ele é verdadeiro: autenticidade, privacidade e integridade.",
    ["ssl", "tls", "https", "criptografia", "autenticidade", "privacidade", "integridade", "handshake", "cadeado", "secure sockets layer"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "**SSL** significa *Secure Sockets Layer*: um tipo de segurança digital que permite a **comunicação criptografada** entre o visitante e o domínio de um site, garantindo **autenticidade**, **privacidade**, **integridade dos dados** e **proteção** nas transações e operações online." },
      { id: "protege", titulo: "O que o certificado SSL protege", icone: "i-escudo", markdown: L(
        "O certificado SSL protege as informações de quem navega no site onde ele está instalado. Ele **criptografa** os dados dos visitantes, para que não sejam **capturados, interceptados ou visualizados** no caminho até o servidor que hospeda o site.",
        "",
        "| Garantia | O que significa | Sem SSL |",
        "| --- | --- | --- |",
        "| **Autenticidade** | O site é mesmo quem diz ser: o certificado foi emitido para aquele domínio por uma Autoridade Certificadora confiável | Um site falso pode se passar pelo verdadeiro |",
        "| **Privacidade** | Só o navegador e o servidor conseguem ler o que trafega | Senhas e dados de cartão viajam “abertos” |",
        "| **Integridade** | Ninguém altera os dados no caminho sem que isso seja percebido | Alguém no meio pode trocar o conteúdo |",
        "{tabela: listrada largura=total}") },
      { id: "nome", titulo: "SSL ou TLS?", icone: "i-info", markdown: L(
        "O nome técnico certo hoje é **TLS** (*Transport Layer Security*), a versão moderna do SSL. Todo mundo — inclusive o mercado e os catálogos — continua dizendo “certificado SSL”, e o certificado é o mesmo.",
        "",
        "| Versão | Situação |",
        "| --- | --- |",
        "| SSL 2.0 e SSL 3.0 | Obsoletos e inseguros (não usar) |",
        "| TLS 1.0 e TLS 1.1 | Descontinuados desde 2021 (RFC 8996) |",
        "| **TLS 1.2** | Em uso e aceito |",
        "| **TLS 1.3** | A versão atual, mais rápida e mais segura |",
        "{tabela: listrada compacta}",
        "",
        "A versão do protocolo é configurada **no servidor** do cliente; o certificado não muda por causa dela.") },
      { id: "handshake", titulo: "Como a conexão é criada (o handshake)", icone: "i-cadeado", markdown: L(
        ":::diagrama tls-handshake",
        "",
        CAIXA("dica", "Analogia: o envelope lacrado com crachá",
          "O **lacre** (a criptografia) impede que alguém leia no caminho; o **crachá** (o certificado) mostra que o remetente é verdadeiro. O navegador confere o crachá antes de abrir o envelope.")) },
      { id: "brasil-internacional", titulo: "Cadeia internacional e cadeia Brasil (ICP-Brasil)", icone: "i-globo", markdown: L(
        "Na Valid, os certificados de servidor aparecem em **duas cadeias**:",
        "",
        "- **Internacional (Sectigo):** os SSL **DV**, **OV** e **EV** usados em sites públicos. A raiz da Sectigo já vem nos navegadores, então qualquer visitante confia no site. A CSR vai para o **consultor comercial da Valid** que fez o pedido junto à Sectigo.",
        "- **Brasil (ICP-Brasil):** os certificados do **mercado financeiro** (SPB, CIP), o **Equipamento A1** e outros usados **entre sistemas** (servidor com servidor), em que as duas pontas instalam a cadeia ICP-Brasil. A CSR vai para o **agente de registro**.",
        "",
        "Detalhes de cada produto no módulo [Catálogo de certificados](#sg-servidor-outros).") },
      SUPORTE(
        "- Quando o cliente fala “SSL”, descubra primeiro **qual produto** ele comprou: o modelo de CSR, o destino da CSR e até o algoritmo mudam de um para outro (veja [Comandos por produto](#sg-comandos-ssl)).",
        "- Dúvidas de navegador (“sua conexão não é particular”) estão na aula [HTTPS](#https).",
        "- A visão geral do SSL dentro da trilha Segurança e web está em [SSL/TLS](#ssl)."),
      TERMOS("ssl, https, sg-validacao, sg-csr, cadeia-certificacao, criptografia, SSL/TLS, HTTPS, Cadeia de certificados")
    ]),

  aula("sg-validacao", "fundamentos", 2, "Básico", "Níveis de validação: DV, OV e EV",
    "O que a certificadora confere antes de emitir: só o domínio (DV), domínio e empresa (OV) ou a validação completa (EV).",
    ["dv", "ov", "ev", "validação de domínio", "validação organizacional", "validação estendida", "sectigo", "dcv", "validade", "398 dias", "200 dias"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Os três níveis dizem **o quanto a certificadora conferiu** antes de emitir: **DV** confere o domínio, **OV** confere o domínio **e a organização**, e **EV** faz a validação **mais completa** do mercado." },
      { id: "tipos", titulo: "Os três níveis", icone: "i-tabela", markdown: L(
        "| | **DV** — Validação de Domínio | **OV** — Validação Organizacional | **EV** — Validação Estendida |",
        "| --- | --- | --- | --- |",
        "| **O que garante** | Que o visitante está acessando o site verdadeiro daquele domínio | O mesmo do DV **e** os dados da organização responsável pelo domínio | A validação mais completa: razão social e informações da empresa responsável |",
        "| **O que a certificadora confere** | Que quem pediu controla o domínio | Domínio + existência da empresa (CNPJ, razão social, endereço) | Domínio + empresa + existência legal, física e operacional, com contato confirmado |",
        "| **Indicado para** | Empresas construindo a marca | Empresas que valorizam e querem proteger a marca | Marcas que têm muito a zelar e querem um certificado de última geração |",
        "| **Wildcard** | Sim | Sim | **Não existe** |",
        "| **Prazo típico de emissão** | Minutos, depois da validação do domínio | Alguns dias | Mais longo (mais documentos) |",
        "{tabela: listrada largura=total cabecalho=laranja}",
        "",
        CAIXA("info", "E aquela barra verde do EV?",
          "Até 2019 os navegadores mostravam a razão social do EV em verde na barra de endereço. Hoje Chrome, Edge e Firefox mostram o mesmo cadeado para DV, OV e EV; os dados da empresa aparecem ao clicar no cadeado › detalhes do certificado. O EV continua sendo a validação mais rigorosa.")) },
      { id: "dcv", titulo: "Como o domínio é validado (DV, OV e EV)", icone: "i-check", markdown: L(
        "Em todos os níveis a certificadora precisa confirmar que o cliente **controla o domínio** (*Domain Control Validation*). Os jeitos mais comuns:",
        "",
        "1. **E-mail:** a certificadora manda um link para um endereço administrativo do domínio, como `admin@`, `administrator@`, `webmaster@`, `hostmaster@` ou `postmaster@` + o domínio.",
        "2. **DNS:** o cliente cria um registro (CNAME ou TXT) com o valor que a certificadora informar.",
        "3. **Arquivo no site (HTTP):** o cliente publica um arquivo de texto no endereço `http://dominio/.well-known/pki-validation/`.",
        "",
        CONFIRMAR("Qual método o time orienta primeiro em cada caso e quem acompanha a validação junto à Sectigo (consultor comercial ou Suporte).")) },
      { id: "validade", titulo: "Validade dos certificados SSL públicos", icone: "i-calendario", markdown: L(
        "Os certificados SSL internacionais seguem as regras do **CA/Browser Forum** (o grupo de certificadoras e navegadores). O prazo máximo de cada certificado está diminuindo:",
        "",
        "| Emitido a partir de | Validade máxima |",
        "| --- | --- |",
        "| Set/2020 | 398 dias |",
        "| **15/03/2026** | **200 dias** |",
        "| 15/03/2027 | 100 dias |",
        "| 15/03/2029 | 47 dias |",
        "{tabela: listrada compacta}",
        "",
        "Na prática, um plano de vários anos passa a exigir **reemissões** dentro do período contratado, cada uma com uma CSR (nova ou a mesma).",
        "",
        CONFIRMAR("Como a Valid vende e reemite os planos plurianuais da Sectigo e se a Sectigo exige CSR nova a cada reemissão.")) },
      SUPORTE(
        "- **OV e DV** são internacionais (Sectigo). Antes da validação, é preciso enviar para a Sectigo definir o **domínio primário**.",
        "- O **EV internacional não tem Wildcard**. Se o cliente precisa de vários subdomínios com EV, a saída é um certificado **Multi-domínio** (veja [Wildcard e Multi-domínio](#sg-wildcard-multidominio)).",
        "- A **redefinição de senha** dos produtos SSL funciona quando é feita pelo **responsável pelo CNPJ**."),
      TERMOS("sg-introducao, sg-wildcard-multidominio, sg-comandos-ssl, DV, OV, EV, Sectigo")
    ]),

  aula("sg-wildcard-multidominio", "fundamentos", 3, "Intermediário", "Wildcard e Multi-domínio",
    "Um certificado para todos os subdomínios (*.dominio.com) ou um certificado para vários domínios diferentes (SAN).",
    ["wildcard", "curinga", "asterisco", "subdomínio", "multi-domínio", "multidomínio", "san", "subjectaltname", "ucc", "sans"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O **Wildcard** (“certificado curinga”) protege **um número ilimitado de subdomínios** de um mesmo domínio em um só certificado; o **Multi-domínio** protege **uma lista de nomes**, que podem ser de domínios diferentes." },
      { id: "wildcard", titulo: "Wildcard SSL", icone: "i-estrela", markdown: L(
        "O asterisco é a parte variável do nome: `*.dominio.com`.",
        "",
        "- Disponível em **DV** e **OV** (não existe em EV).",
        "- Indicado para quem hospeda ou gerencia **várias páginas ou sites sob o mesmo domínio**.",
        "",
        "| Endereço | `*.exemplo.com.br` protege? |",
        "| --- | --- |",
        "| `www.exemplo.com.br` | ✅ Sim |",
        "| `loja.exemplo.com.br` | ✅ Sim |",
        "| `exemplo.com.br` (sem nada antes) | ⚠️ Só se o domínio raiz também estiver no certificado |",
        "| `api.loja.exemplo.com.br` (dois níveis) | ❌ Não: o asterisco vale para **um nível** só |",
        "| `exemplo.com` (outro domínio) | ❌ Não |",
        "{tabela: listrada compacta}",
        "",
        "Na CSR, o Wildcard só muda o **CN**: `/CN=\"*.exemplo.com.br\"` (veja [Comandos por produto](#sg-comandos-ssl)).",
        "",
        CONFIRMAR("Se a Sectigo inclui o domínio raiz (sem o asterisco) automaticamente nos Wildcard vendidos pela Valid.")) },
      { id: "multi", titulo: "Multi-domínio (SAN)", icone: "i-lista", markdown: L(
        "O certificado Multi-domínio leva uma lista de nomes no campo **SAN** (*Subject Alternative Name*). Ele funciona com os SSL internacionais **DV, OV e EV**.",
        "",
        "- Ex.: `exemplo.com.br`, `www.exemplo.com.br`, `exemplo.com` e `outraempresa.com.br` no mesmo certificado.",
        "- A CSR é igual à dos SSL internacionais, com o acréscimo de `-addext \"subjectAltName=DNS:...,DNS:...\"` no fim do comando.",
        "- Depois de gerar, confira os nomes num decodificador: eles aparecem no campo **SANS**.",
        "",
        IMG("decodificador-sans.png", "Decodificador de CSR mostrando o campo SANS com exemplo.com e www.exemplo.com"),
        "",
        "O comando completo está em [Comandos por produto](#sg-comandos-ssl).") },
      { id: "escolher", titulo: "Qual escolher?", icone: "i-ajuda", markdown: L(
        "| O cliente precisa de… | Indicação |",
        "| --- | --- |",
        "| Um único site (`www.exemplo.com.br`) | SSL DV, OV ou EV comum |",
        "| Muitos subdomínios do mesmo domínio, que mudam com frequência | **Wildcard** (DV ou OV) |",
        "| Domínios diferentes, ou vários subdomínios com EV | **Multi-domínio** |",
        "{tabela: listrada largura=total}") },
      TERMOS("sg-validacao, sg-comandos-ssl, campo-san, Wildcard, Multi-domínio, SAN, CN (Common Name)")
    ]),

  /* ---------------- Módulo 2 · Catálogo ---------------- */
  aula("sg-servidor-outros", "catalogo", 1, "Básico", "Autenticação de servidores e outros certificados",
    "SSL DV, OV e EV, Wildcard, Equipamento A1, Infoconv A1, FGC, Code Signing / JRE, S/MIME e e-PJ em HSM: para que serve cada um.",
    ["autenticação de servidores", "equipamento a1", "infoconv", "infoconv-ws", "fgc", "code signing", "jre", "applet", "s/mime", "smime", "hsm", "e-pj", "ev a1", "cadeia v10"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Além do SSL de site, a família de **certificados de servidor** inclui certificados para **máquinas e aplicações**, para **órgãos públicos** consultarem a Receita, para **assinar programas** e para **proteger e-mails**." },
      { id: "catalogo", titulo: "O catálogo", icone: "i-tabela", markdown: L(
        "| Certificado | Para que serve | Indicado para |",
        "| --- | --- | --- |",
        "| **SSL DV** — Validação de Domínio | Verifica o site e garante ao visitante que ele está no site verdadeiro | Empresas construindo a marca |",
        "| **SSL OV** — Validação Organizacional | O mesmo do DV e ainda mostra os dados da organização responsável pelo domínio | Empresas que valorizam e querem proteger a marca |",
        "| **SSL EV** — Validação Estendida | A validação mais completa: traz a razão social e as informações da empresa | Marcas com muito a zelar (o mais escolhido pelas marcas online) |",
        "| **Wildcard SSL** | Protege subdomínios ilimitados (`*.dominio.com`), em DV ou OV | Quem gerencia várias páginas sob o mesmo domínio |",
        "| **Equipamento A1** | Protege a comunicação entre **servidores, máquinas e suas aplicações** | Integrações servidor a servidor |",
        "| **Infoconv A1** | Acesso ao sistema **InfoConv-WS** da Receita Federal, que permite consultar dados cadastrais (CPF/CNPJ) por convênio | Órgãos públicos conveniados |",
        "| **FGC** | Certificado para o **Fundo Garantidor de Créditos** | Instituições que se comunicam com o FGC |",
        "| **Code Signing / JRE** | Assinatura de código: prova quem publicou o programa e que ele não foi alterado (`.exe`, `.cab`, `.dll`, `.ocx`, `.msi`, `.xpi`, `.xap` e Applet Java) | Desenvolvedores e editores de software para Windows e Java |",
        "| **S/MIME** | Criptografia e assinatura de **e-mails** | Quem precisa provar a origem do e-mail e proteger o conteúdo |",
        "| **e-PJ em HSM** | Certificado de pessoa jurídica com a chave gerada no **HSM** do cliente (há modelo de CSR de 2 anos) | Órgãos e empresas que guardam as chaves em HSM próprio |",
        "{tabela: listrada largura=total cabecalho=laranja}") },
      { id: "sem-csr", titulo: "Equipamento A1 e Infoconv: sem CSR", icone: "i-alerta", markdown: L(
        CAIXA("atencao", "Não peça CSR para estes dois",
          "Os certificados **Equipamento A1** e **Infoconv** não têm CSR: basta informar ao **consultor** a **URL** em formato **FQDN** (*Fully Qualified Domain Name*, o nome completo do servidor, como `servidor.exemplo.com.br`)."),
        "",
        "Há também o modelo **AE-Equipamento A1 Cadeia V10** (o antigo **SSL EV A1**), que tem CSR e usa **SHA-512** — veja [Comandos por produto](#sg-comandos-ssl).",
        "",
        CONFIRMAR("Diferença entre o “Equipamento A1” sem CSR e o “AE-Equipamento A1 Cadeia V10” (antigo SSL EV A1), que tem CSR, e quando oferecer cada um.")) },
      SUPORTE(
        "- Para Code Signing, o **CN** e o **O** são a **razão social** de quem publica o software, não um domínio.",
        "- S/MIME e Code Signing não são instalados em servidor web: o primeiro vai no programa de e-mail, o segundo na ferramenta que assina o programa (ex.: `signtool` do Windows)."),
      TERMOS("sg-validacao, sg-mercado-financeiro, sg-comandos-ssl, Code Signing, S/MIME, FQDN, HSM")
    ]),

  aula("sg-mercado-financeiro", "catalogo", 2, "Intermediário", "Mercado financeiro (ICP-Brasil): SPB e CIP",
    "Os certificados do Sistema de Pagamentos Brasileiro e da Câmara Interbancária de Pagamentos: SPB, SPB PIX, C3, CTC, SCC, SCG, SEC, SELTEC, SILOC, COMPE e outros.",
    ["spb", "spb pix", "pix", "bacen", "banco central", "cip", "câmara interbancária", "c3", "ctc", "scc", "scg", "sec", "seltec", "siloc", "siloc bb", "compe", "eco", "r2c3", "cmp", "ispb", "sisbacen", "rsfn"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "No **mercado financeiro**, os certificados ICP-Brasil identificam **a instituição e o servidor** nas trocas de mensagens e arquivos com o **Banco Central (SPB)** e com a **CIP** (Câmara Interbancária de Pagamentos)." },
      { id: "spb", titulo: "SPB — Sistema de Pagamentos Brasileiro", icone: "i-globo", markdown: L(
        "O certificado digital **SPB** é indicado para instituições ligadas aos sistemas que fazem parte do **Sistema de Pagamentos Brasileiro**. Esses certificados fazem parte dos serviços oferecidos pelo **BACEN**.",
        "",
        "- **Certificado Digital SPB**",
        "- **Certificado Digital SPB PIX**",
        "",
        "Na CSR do SPB entram o código **ISPB** (8 dígitos, que identifica a instituição no SPB) e o código **SISBACEN** (5 dígitos). Modelo em [Comandos do mercado financeiro](#sg-comandos-financeiro).") },
      { id: "cip", titulo: "Certificados para os sistemas da CIP", icone: "i-plug", markdown: L(
        "Os certificados para a **CIP** garantem o acesso às operações de **transferência de arquivos** entre os servidores das instituições financeiras, conforme as normas da Câmara Interbancária de Pagamentos.",
        "",
        "| Certificado | Sigla na CSR | Para quem |",
        "| --- | --- | --- |",
        "| **C3** | `CCC` | Instituições financeiras, FIDCs (Fundos de Investimento em Direitos Creditórios) e demais entidades autorizadas pelo Banco Central que fazem **cessão de créditos** ou usam contratos de crédito como garantia em operações estruturadas — por exemplo, a emissão de DPGE II (Depósito a Prazo com Garantias Especiais) do FGC |",
        "| **SEC** | `SEC` | Instituições financeiras que acessam o sistema **Cadastro Positivo** |",
        "| **SELTEC** | `SLC` nos exemplos (veja a nota abaixo) | Instituições autorizadas pelo Banco Central que oferecem o **pagamento eletrônico de títulos enviados a cartórios de protesto**, e as Centrais de Remessa de Arquivos |",
        "| **CTC** | `CTC` | Instituições financeiras, credoras originais e proponentes que, a pedido do cliente, fazem a **portabilidade de operações de crédito** |",
        "| **SCC** | `SCC` | Órgãos públicos (federais, estaduais e municipais), consignatários financeiros e não financeiros, servidores públicos civis e policiais militares (ativos, aposentados, pensionistas ou reformados) — **crédito consignado** |",
        "| **SCG** | `SCG` | Credenciadoras de cartões de crédito e débito, instituições financeiras, cooperativas de crédito e Caixas Econômicas que atuam como **domicílio bancário** de estabelecimentos comerciais junto às credenciadoras |",
        "| **SILOC** | `SLC` | Instituições autorizadas pelo Banco Central que oferecem **DOC**, pagamento de boleto de cobrança e proposta, **TEC**, pagamento de títulos em cartório e operações com cartões de débito e crédito |",
        "| **SILOC BB** | `SLN` | Ajustes do projeto de **criptografia dos arquivos trafegados no SILOC**, para os produtos Cobrança, DOC e TEC |",
        "| **COMPE** | `COMPE-` | Compensação: a CSR leva o código **IF** e o código **COMPE** da instituição |",
        "| **ECO** | `CBC` | O material traz só o modelo da CSR |",
        "| **R2C3** | `RRC` | O material traz só o modelo da CSR |",
        "| **CMP** | `CMP` | O material traz só o modelo da CSR |",
        "{tabela: listrada largura=total cabecalho=laranja}",
        "",
        CONFIRMAR(
          "- **SELTEC:** o modelo de preenchimento indica a sigla `SEC`, mas o exemplo de comando usa `SLC`. Confirmar qual vale.",
          "- Para que servem os certificados **ECO**, **R2C3** e **CMP** (o material traz só o modelo da CSR).")) },
      { id: "producao-teste", titulo: "Produção e Teste (homologação)", icone: "i-engrenagem", markdown: L(
        "Vários desses produtos têm um certificado de **Produção** e outro de **Teste** (homologação). O **comando da CSR não muda**: muda só a letra no campo do produto (a sigla do certificado):",
        "",
        "- **P** = Produção → `CCC P001`",
        "- **T** = Teste → `CCC T001`",
        "- No **ECO**, os exemplos usam **H** (homologação) para teste: `CBC H465`.",
        "",
        "Os números depois da letra são o **número do cadastro** da empresa naquele produto.") },
      TERMOS("sg-comandos-financeiro, sg-preenchimento, sg-open-finance, icp-brasil, SPB, CIP, ISPB, ICP-Brasil")
    ]),

  aula("sg-open-finance", "catalogo", 3, "Avançado", "Open Finance: BRSEAL e BRCAC",
    "Os dois certificados do Open Finance Brasil: BRSEAL (assinatura, cadeia V5) e BRCAC (transporte, cadeia V10), com cada campo da CSR explicado.",
    ["open finance", "open banking", "brseal", "brcac", "transporte", "assinatura", "mtls", "uid", "organizationidentifier", "2.5.4.97", "ofbbr", "software statement", "jurisdiction"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "No **Open Finance Brasil**, cada participante usa dois certificados ICP-Brasil: o **BRCAC**, de **transporte** (protege a conexão entre as instituições), e o **BRSEAL**, de **assinatura** (assina as mensagens trocadas)." },
      { id: "dois", titulo: "Os dois certificados", icone: "i-tabela", markdown: L(
        "| | **BRSEAL** — Assinatura | **BRCAC** — Transporte |",
        "| --- | --- | --- |",
        "| **Cadeia** | V5 | V10 |",
        "| **Para que serve** | Assinar as mensagens do Open Finance | Autenticar a conexão (TLS mútuo) entre as instituições |",
        "| **CN** | Razão social | URL (domínio) |",
        "| **UID** | ID da **organização** | ID da **declaração de software** (*software statement*) |",
        "| **O** | `ICP-Brasil` | Razão social |",
        "{tabela: listrada largura=total cabecalho=laranja}") },
      { id: "brseal", titulo: "BRSEAL (V5 · assinatura): campos", icone: "i-documento", markdown: L(
        CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo-brseal.key -out exemplo-brseal.csr -subj /CN="EMPRESA EXEMPLO S.A."/UID="11111111-2222-3333-4444-555555555555"/O="ICP-Brasil"/L="SAO PAULO"/ST="SP"/C="BR"/'),
        "",
        "| Campo | O que preencher |",
        "| --- | --- |",
        "| **CN** | Razão social |",
        "| **UID** | ID da Organização (no diretório do Open Finance) |",
        "| **O** | ICP-Brasil |",
        "| **L** | Cidade |",
        "| **ST** | Estado (**somente a sigla**) |",
        "| **C** | País (**somente a sigla**) |",
        "{tabela: listrada compacta}") },
      { id: "brcac", titulo: "BRCAC (V10 · transporte): campos", icone: "i-documento", markdown: L(
        CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo-brcac.key -out exemplo-brcac.csr -subj /CN="exemplo.com.br"/O="EMPRESA EXEMPLO S.A."/L="SAO PAULO"/ST="SP"/1.3.6.1.4.1.311.60.2.1.2="SP"/1.3.6.1.4.1.311.60.2.1.3="BR"/C="BR"/serialNumber="12345678000190"/UID="66666666-7777-8888-9999-000000000000"/2.5.4.97="OFBBR-11111111-2222-3333-4444-555555555555"'),
        "",
        "| Campo | O que preencher |",
        "| --- | --- |",
        "| **CN** | URL (domínio) |",
        "| **O** | Razão social |",
        "| **L** | Cidade |",
        "| **ST** | Estado (somente a sigla) |",
        "| `1.3.6.1.4.1.311.60.2.1.2` | Estado da jurisdição (somente a sigla) |",
        "| `1.3.6.1.4.1.311.60.2.1.3` | País da jurisdição (somente a sigla) |",
        "| **C** | País (somente a sigla) |",
        "| **serialNumber** | CNPJ (só números) |",
        "| **UID** | ID da declaração de software |",
        "| `2.5.4.97` | `OFBBR-` + ID da Organização |",
        "{tabela: listrada compacta}",
        "",
        CAIXA("info", "O que são esses números no lugar do nome do campo?",
          "São **OIDs**: identificadores de campos que não têm sigla curta no OpenSSL. `1.3.6.1.4.1.311.60.2.1.2` e `.3` são o estado e o país da **jurisdição** (onde a empresa foi registrada) e `2.5.4.97` é o **organizationIdentifier** (o identificador da organização no Open Finance).")) },
      SUPORTE(
        "- Os IDs (Organização e declaração de software) vêm do **diretório do Open Finance** do cliente: quem gera a CSR precisa ter esses dados em mãos.",
        "- Não confunda os UIDs: no BRSEAL é o ID da organização; no BRCAC é o ID do software, e o ID da organização vai no `2.5.4.97`."),
      TERMOS("sg-mercado-financeiro, sg-comandos-ssl, campo-politicas, Open Finance, BRCAC, BRSEAL, OID, mTLS")
    ]),

  /* ---------------- Módulo 3 · CSR na prática ---------------- */
  aula("sg-csr", "csr", 1, "Básico", "O que é a CSR",
    "A solicitação de assinatura de certificado: os dados da empresa e a chave pública, assinados com a chave privada que fica com o cliente.",
    ["csr", "certificate signing request", "solicitação de assinatura", "chave privada", ".key", "chave pública", "agente de registro", "consultor", "sectigo", "distinguished name"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "A **CSR** (*Certificate Signing Request*, solicitação de assinatura de certificado) é uma das **primeiras etapas** para obter o certificado SSL/TLS: é o pedido que a Autoridade Certificadora usa para criar o certificado." },
      { id: "conteudo", titulo: "O que vai dentro da CSR", icone: "i-documento", markdown: L(
        "- **Dados do titular** (o *Distinguished Name*): nome comum (CN), empresa (O), cidade (L), estado (ST), país (C) e, conforme o produto, unidades (OU) e outros campos.",
        "- A **chave pública**, que vai ser incluída no certificado.",
        "- A **assinatura** da própria CSR, feita com a **chave privada** correspondente — prova que quem pediu tem a chave.",
        "",
        "A CSR é um texto que começa com `-----BEGIN CERTIFICATE REQUEST-----`. Ela **não é secreta**: pode ser enviada por e-mail.",
        "",
        ":::diagrama ssl-emissao") },
      { id: "chave", titulo: "A chave privada (.key) fica com o cliente", icone: "i-cadeado", markdown: L(
        "Ao gerar a CSR, nasce junto a **chave privada** (arquivo `.key`). Ela é protegida pela senha **PEM pass phrase**, criada pelo cliente.",
        "",
        CAIXA("erro", "A Valid não precisa do arquivo .key em nenhum momento",
          "O `.key` deve ficar **em posse do cliente**. Sem ele não é possível instalar o certificado nem montar o PFX; e se a chave vazar, qualquer um se passa pelo site.")) },
      { id: "destino", titulo: "Para onde enviar a CSR", icone: "i-email", markdown: L(
        "| Cadeia do certificado | Enviar a CSR para |",
        "| --- | --- |",
        "| **Brasil** (ICP-Brasil: mercado financeiro, Equipamento A1 V10, e-PJ…) | O **agente de registro** |",
        "| **Internacional** (Sectigo: SSL DV, OV, EV, Wildcard, Multi-domínio, Code Signing…) | O **consultor comercial da Valid** que gerou o pedido de requisição junto à Sectigo |",
        "{tabela: listrada largura=total}") },
      { id: "iis", titulo: "CSR gerada pelo Microsoft IIS", icone: "i-info", markdown: L(
        "Se o cliente gerou a CSR pelo **IIS**, o `.key` fica “escondido”: o Windows guarda a chave no próprio servidor e a acompanha o tempo todo.",
        "",
        "- Quando o certificado chegar, a instalação deve ser concluída **no mesmo servidor** onde a CSR foi gerada (no IIS: **Concluir solicitação de certificado**). É aí que o Windows junta o certificado com a chave.",
        "- Depois disso, o cliente consegue exportar um **PFX** pelo console de certificados do computador (`certlm.msc`) para levar a outro servidor.") },
      TERMOS("sg-openssl, sg-preenchimento, sg-pfx, CSR, Chave privada, Chave pública, PEM pass phrase")
    ]),

  aula("sg-openssl", "csr", 2, "Intermediário", "Gerar a CSR com o OpenSSL",
    "Passo a passo no Windows: instalar o OpenSSL, abrir o cmd na pasta bin, rodar o comando do produto, criar a senha e encontrar a CSR e a chave.",
    ["openssl", "gerar csr", "cmd", "prompt de comando", "administrador", "pasta bin", "pem pass phrase", "senha da chave", "slproweb", "win64"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Para gerar a CSR usamos a ferramenta **OpenSSL**: um comando no Prompt de Comando gera **dois arquivos** — a CSR (para enviar) e a chave privada (que fica com o cliente)." },
      { id: "passo1", titulo: "1. Baixar e instalar o OpenSSL", icone: "i-download", markdown: L(
        "Baixe o instalador em [slproweb.com — Win32/Win64 OpenSSL](https://slproweb.com/products/Win32OpenSSL.html) (para Windows 64 bits, a versão **Win64 OpenSSL**; a versão *Light* já basta) e instale com as opções padrão.") },
      { id: "passo2", titulo: "2. Copiar o endereço da pasta bin", icone: "i-documento", markdown: L(
        "Depois de instalar, abra a pasta **bin** do OpenSSL e copie o endereço, por exemplo:",
        "",
        CODIGO("texto", "C:\\Program Files\\OpenSSL-Win64\\bin"),
        "",
        IMG("openssl-pasta-bin.png", "Explorador de Arquivos com o endereço C:\\Program Files\\OpenSSL-Win64\\bin selecionado")) },
      { id: "passo3", titulo: "3. Abrir o cmd como administrador e entrar na pasta", icone: "i-ferramenta", markdown: L(
        "Abra o **Prompt de Comando (cmd) como administrador**, digite `cd`, cole o caminho copiado e aperte **Enter**:",
        "",
        CODIGO("bash", "cd C:\\Program Files\\OpenSSL-Win64\\bin"),
        "",
        IMG("openssl-cmd-pasta-bin.webp", "Prompt de Comando como administrador dentro da pasta C:\\Program Files\\OpenSSL-Win64\\bin"),
        "",
        CAIXA("info", "Por que como administrador?",
          "A CSR e a chave são gravadas na pasta onde o cmd está — e a pasta `Program Files` só aceita gravação de administrador. Sem isso o OpenSSL dá erro ao salvar os arquivos.")) },
      { id: "passo4", titulo: "4. Rodar o comando do produto", icone: "i-lista", markdown: L(
        "Cole o comando da CSR. **Cada produto tem o seu comando** — veja [Comandos por produto](#sg-comandos-ssl) e [Comandos do mercado financeiro](#sg-comandos-financeiro). O formato geral é:",
        "",
        CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo.key -out exemplo.csr -subj /CN="www.exemplo.com.br"/O="EMPRESA EXEMPLO S.A."/L="Sao Paulo"/ST="SP"/C="BR"/'),
        "",
        "| Parte do comando | O que faz |",
        "| --- | --- |",
        "| `openssl req` | Cria uma solicitação de certificado (CSR) |",
        "| `-sha256` / `-sha512` | O algoritmo de hash que assina a CSR (alguns produtos exigem SHA-512) |",
        "| `-newkey rsa:2048` | Cria uma chave privada nova, RSA de 2048 bits |",
        "| `-keyout exemplo.key` | Nome do arquivo da **chave privada** |",
        "| `-out exemplo.csr` | Nome do arquivo da **CSR** |",
        "| `-subj /CN=…/O=…` | Os dados do certificado, campo a campo (veja [Orientações de preenchimento](#sg-preenchimento)) |",
        "{tabela: listrada largura=total}") },
      { id: "passo5", titulo: "5. Criar a senha da chave privada (PEM pass phrase)", icone: "i-cadeado", markdown: L(
        "Ao rodar o comando, o OpenSSL pede o **PEM pass phrase**: a senha da chave privada, **criada pelo cliente**. Depois pede para confirmar:",
        "",
        CODIGO("texto", "Enter PEM pass phrase:", "Verifying - Enter PEM pass phrase:"),
        "",
        "- **Nada aparece na tela enquanto se digita** (nem asteriscos): é normal. Digite e aperte Enter.",
        "- A senha precisa ter pelo menos 4 caracteres.",
        "",
        CAIXA("atencao", "Essa senha não pode ser esquecida",
          "Ela é pedida para instalar o certificado e para montar o PFX. Se o cliente esquecer, a chave não abre mais e é preciso gerar uma CSR nova.")) },
      { id: "passo6", titulo: "6. Encontrar a CSR e a chave", icone: "i-sucesso", markdown: L(
        "Depois de criar e confirmar a senha, a **CSR** e a **chave privada** já estão na pasta **bin**:",
        "",
        IMG("csr-arquivos-gerados.png", "Pasta com os arquivos chave.key (Arquivo KEY) e csr.csr (Arquivo CSR) gerados"),
        "",
        "- Envie **só a CSR**: cadeia Brasil → **agente de registro**; internacional → **consultor comercial** da Valid (pedido na Sectigo).",
        "- O `.key` fica com o cliente. A Valid não precisa dele em nenhum momento.") },
      { id: "conferir", titulo: "Conferir a CSR antes de enviar", icone: "i-busca", markdown: L(
        "Antes de enviar, confira os dados da CSR de uma destas formas:",
        "",
        "- **Pelo OpenSSL** (mostra os campos e confere a assinatura da CSR):",
        "",
        CODIGO("bash", "openssl req -in exemplo.csr -noout -text -verify"),
        "",
        "- **Por um decodificador on-line**, como o [CertLogik Decoder](https://certlogik.com/decoder/): cole o texto da CSR (de `-----BEGIN` até `END-----`). Nos certificados Multi-domínio, os nomes aparecem no campo **SANS**.",
        "",
        "Confira principalmente o **CN**, a **razão social** e, nos produtos financeiros, a letra **P/T** e os números.") },
      { id: "duvidas", titulo: "Dúvidas comuns", icone: "i-ajuda", markdown: L(
        "### Dá para gerar a CSR pelo PowerShell ou pelo Git Bash?",
        "Prefira o **cmd**, como no passo a passo. No **Git Bash**, o `-subj` que começa com `/` é trocado por um caminho de pasta: use `//CN=...` no começo ou rode `MSYS_NO_PATHCONV=1 openssl req ...`. No PowerShell, as aspas são tratadas de outro jeito e o comando pode sair diferente.",
        "",
        "### Posso salvar os arquivos em outra pasta?",
        "Sim: use o caminho completo nos nomes, como `-keyout C:\\certificados\\exemplo.key -out C:\\certificados\\exemplo.csr` (a pasta precisa existir).",
        "",
        "### Apareceu “problems making Certificate Request”.",
        "Normalmente é um campo do `-subj` mal escrito: aspas abertas, uma barra faltando ou caractere especial. Confira o comando com calma e veja [Checklist e erros comuns](#sg-checklist)."),
        },
      TERMOS("sg-csr, sg-comandos-ssl, sg-comandos-financeiro, sg-preenchimento, sg-checklist, OpenSSL, CSR, PEM pass phrase")
    ]),

  aula("sg-preenchimento", "csr", 3, "Intermediário", "Orientações de preenchimento",
    "O que vai em cada campo da CSR (CN, O, OU, L, ST, C) e o modelo de cada produto: SSL EV A1, C3, COMPE, CTC, ECO, R2C3, SCC, SCG, SEC, SELTEC, SILOC e SPB.",
    ["preenchimento", "template", "modelo", "common name", "organization", "organization unit", "locality", "state", "country", "ou", "cn", "caracteres especiais", "razão social"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Os campos da CSR devem ser preenchidos **sem caracteres especiais** (como `~`, `ç`, `^`, acentos) — **com exceção do Common Name** — e a razão social vai **sem abreviações**, conforme o cadastro do CNPJ." },
      { id: "campos", titulo: "Os campos", icone: "i-tabela", markdown: L(
        "| Sigla | Nome | O que é |",
        "| --- | --- | --- |",
        "| **CN** | Common Name | O nome principal: o endereço web (domínio/servidor) ou, em alguns produtos, a razão social |",
        "| **O** | Organization | A organização: a razão social ou, nos produtos financeiros, `ICP-Brasil` |",
        "| **OU** | Organization Unit | Unidade/departamento; nos produtos financeiros, os códigos do produto e do cadastro (pode haver várias) |",
        "| **L** | Locality | A cidade. Ex.: `Sao Paulo` |",
        "| **ST** | State | O estado. Ex.: `Sao Paulo` ou `SP` |",
        "| **C** | Country | A sigla do país, com 2 letras. Ex.: `BR` |",
        "{tabela: listrada largura=total}",
        "",
        CAIXA("dica", "Mantenha a ordem do modelo",
          "Nos produtos com várias **OU**, siga exatamente a ordem do modelo do produto (sigla, depois cadastro, depois razão social).")) },
      { id: "ev-a1", titulo: "SSL EV A1", icone: "i-documento", markdown: L(
        "| Campo | O que preencher | Exemplo |",
        "| --- | --- | --- |",
        "| **CN** | Endereço web onde o certificado será usado | `site.com.br` |",
        "| **O** | Razão social, sem abreviações e conforme o cadastro do CNPJ | `EMPRESA EXEMPLO S.A.` |",
        "| **OU** | Opcional: nome do departamento, sem abreviações ou caracteres especiais | `Tecnologia` |",
        "| **L** | Cidade da empresa | `Sao Paulo` |",
        "| **ST** | Estado da empresa | `Sao Paulo` |",
        "| **C** | Sigla do país | `BR` |",
        "{tabela: listrada largura=total}") },
      { id: "cip", titulo: "C3, CTC, ECO, R2C3, SCC, SCG, SEC, SELTEC e SILOC", icone: "i-documento", markdown: L(
        "Esses produtos seguem o **mesmo modelo**; muda só a **sigla** da primeira OU:",
        "",
        "| Produto | Sigla | Exemplo da 1ª OU |",
        "| --- | --- | --- |",
        "| C3 | `CCC` | `CCC P001` |",
        "| CTC | `CTC` | `CTC P001` |",
        "| ECO | `CBC` | `CBC P001` (aceita só o número: `465`) |",
        "| R2C3 | `RRC` | `RRC T001` |",
        "| SCC | `SCC` | `SCC T001` |",
        "| SCG | `SCG` | `SCG T001` |",
        "| SEC | `SEC` | `SEC T001` |",
        "| SELTEC | `SEC` no modelo · `SLC` nos exemplos | a confirmar |",
        "| SILOC | `SLC` | `SLC T001` |",
        "{tabela: listrada compacta}",
        "",
        "Os campos do modelo:",
        "",
        CAMPOS_CIP("CCC"),
        "",
        "**P** = produção e **T** = teste. Modelos completos em [Comandos do mercado financeiro](#sg-comandos-financeiro).") },
      { id: "compe", titulo: "COMPE", icone: "i-documento", markdown: L(
        "| Campo | O que preencher | Exemplo |",
        "| --- | --- | --- |",
        "| **CN** | Razão social (nos exemplos do time, precedida do código do banco) | `0000-BANCO EXEMPLO SA` |",
        "| **OU** | `IF-` + código com **8 dígitos** | `IF-12345678` |",
        "| **OU** | `COMPE-` + **P** ou **T** + código com **9 dígitos** | `COMPE-P000000001` |",
        "| **O** | ICP-Brasil | `ICP-Brasil` |",
        "| **C** | Sigla do país | `BR` |",
        "{tabela: listrada largura=total}") },
      { id: "spb", titulo: "SPB", icone: "i-documento", markdown: L(
        "| Campo | O que preencher | Exemplo |",
        "| --- | --- | --- |",
        "| **CN** | Razão social + **P** ou **T** e o número de cadastro | `BANCO XYZ P001` |",
        "| **OU** | `ISPB-` + código com **8 dígitos** | `ISPB-12345678` |",
        "| **OU** | `SISBACEN-` + código com **5 dígitos** | `SISBACEN-12345` |",
        "| **O** | ICP-Brasil | `ICP-Brasil` |",
        "| **C** | Sigla do país | `BR` |",
        "{tabela: listrada largura=total}",
        "",
        "Os exemplos de comando do SPB também trazem **L** (cidade) e **ST** (estado).") },
      { id: "estado", titulo: "Estado por extenso ou sigla?", icone: "i-ajuda", markdown: CONFIRMAR(
        "Os modelos de preenchimento pedem o estado por extenso (`Sao Paulo`), mas quase todos os exemplos de comando usam a sigla (`SP`) — e o Open Finance pede **somente a sigla**. Confirmar o que cada produto aceita.") },
      TERMOS("sg-csr, sg-comandos-ssl, sg-comandos-financeiro, sg-mercado-financeiro, CN (Common Name), CSR")
    ]),

  aula("sg-comandos-ssl", "csr", 4, "Intermediário", "Comandos por produto: SSL, Code Signing, e-PJ e Multi-domínio",
    "O modelo de comando OpenSSL de cada produto: Equipamento A1 V10, SSL OV, DV e EV (com e sem Wildcard), Code Signing, e-PJ em HSM, Open Finance e Multi-domínio.",
    ["comando", "openssl req", "ssl ov", "ssl dv", "ssl ev", "wildcard", "code signing", "equipamento a1", "cadeia v10", "sha512", "e-pj", "hsm", "multi-domínio", "addext", "subjectaltname"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Cada produto tem **o seu comando**. Copie o modelo, troque **só os dados** (domínio, razão social, cidade, estado) e mantenha o resto igual. Os exemplos abaixo usam dados **fictícios**." },
      { id: "ev-a1", titulo: "AE-Equipamento A1 Cadeia V10 (antigo SSL EV A1)", icone: "i-certificado", markdown: L(
        "Atenção: este usa **SHA-512**.",
        "",
        CODIGO("bash", 'openssl req -sha512 -newkey rsa:2048 -keyout exemplo.key -out exemplo.csr -subj /CN="exemplo.com.br"/O="EMPRESA EXEMPLO S.A."/L="Sao Paulo"/ST="SP"/C="BR"/')) },
      { id: "ov", titulo: "SSL OV (e OV Wildcard)", icone: "i-certificado", markdown: L(
        CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo.key -out exemplo.csr -subj /CN="www.exemplo.com.br"/OU="Tecnologia"/O="EMPRESA EXEMPLO S.A."/L="Sao Paulo"/ST="SP"/C="BR"/'),
        "",
        "**Variação para OV Wildcard** (muda só o CN):",
        "",
        CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo.key -out exemplo.csr -subj /CN="*.exemplo.com.br"/OU="Tecnologia"/O="EMPRESA EXEMPLO S.A."/L="Sao Paulo"/ST="SP"/C="BR"/')) },
      { id: "dv", titulo: "SSL DV (e DV Wildcard)", icone: "i-certificado", markdown: L(
        "O comando é o **mesmo do OV**:",
        "",
        CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo.key -out exemplo.csr -subj /CN="www.exemplo.com.br"/OU="Tecnologia"/O="EMPRESA EXEMPLO S.A."/L="Sao Paulo"/ST="SP"/C="BR"/'),
        "",
        "**Variação para DV Wildcard:**",
        "",
        CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo.key -out exemplo.csr -subj /CN="*.exemplo.com.br"/OU="Tecnologia"/O="EMPRESA EXEMPLO S.A."/L="Sao Paulo"/ST="SP"/C="BR"/')) },
      { id: "ev", titulo: "SSL EV (cadeia internacional) — não tem Wildcard", icone: "i-certificado", markdown: CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo.key -out exemplo.csr -subj /CN="www.exemplo.com.br"/OU="Tecnologia"/O="EMPRESA EXEMPLO S.A."/L="Sao Paulo"/ST="SP"/C="BR"/') },
      { id: "code-signing", titulo: "Code Signing", icone: "i-certificado", markdown: L(
        "Aqui o **CN** e o **O** são a **razão social** de quem publica o software:",
        "",
        CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout exemplo_chave.key -out exemplo.csr -subj /C="BR"/ST="SP"/L="Sao Paulo"/O="EMPRESA EXEMPLO LTDA"/CN="EMPRESA EXEMPLO LTDA"')) },
      { id: "epj", titulo: "e-PJ de 2 anos em HSM", icone: "i-certificado", markdown: CODIGO("bash", 'openssl req -sha256 -newkey rsa:2048 -keyout chave_EPJ_HSM.key -out CSR_EPJ_HSM.csr -subj /CN="ORGAO EXEMPLO"/OU="Secretaria da Receita Federal do Brasil - RFB"/O="ORGAO EXEMPLO"/L="SAO PAULO"/ST="SAO PAULO"/C="BR"/') },
      { id: "open-finance", titulo: "Open Finance (BRSEAL e BRCAC)", icone: "i-certificado", markdown: "Os comandos e a explicação de cada campo estão na aula [Open Finance: BRSEAL e BRCAC](#sg-open-finance)." },
      { id: "multi", titulo: "Multi-domínio", icone: "i-lista", markdown: L(
        "O comando é igual ao dos SSL internacionais (DV, OV e EV), com `-addext \"subjectAltName=...\"` no fim:",
        "",
        CODIGO("bash", 'openssl req -new -newkey rsa:2048 -keyout private.key -out csr.csr -subj "/C=BR/ST=Sao Paulo/L=Sao Paulo/O=EMPRESA EXEMPLO LTDA/OU=TI/CN=exemplo.com" -addext "subjectAltName=DNS:exemplo.com,DNS:www.exemplo.com"'),
        "",
        "- Em `DNS:exemplo.com,DNS:www.exemplo.com` vão os domínios e subdomínios desejados. Para cada nome novo, acrescente `,DNS:nome` **na mesma linha**, separado por vírgula: `DNS:exemplo.com,DNS:www.exemplo.com,DNS:loja.exemplo.com`.",
        "- Coloque o nome do **CN** também na lista do SAN.",
        "- Ao decodificar a CSR (por exemplo no [CertLogik Decoder](https://certlogik.com/decoder/)), os nomes aparecem no campo **SANS**.",
        "",
        CAIXA("atencao", "Use aspas retas",
          "Copie o comando com aspas retas (`\"`). Aspas “curvas”, que o Word e o Outlook colocam sozinhos, fazem o OpenSSL não reconhecer o `-addext`. O `-addext` exige OpenSSL 1.1.1 ou mais novo.")) },
      TERMOS("sg-openssl, sg-preenchimento, sg-wildcard-multidominio, sg-comandos-financeiro, sg-open-finance, OpenSSL, Wildcard, Multi-domínio")
    ]),

  aula("sg-comandos-financeiro", "csr", 5, "Avançado", "Comandos do mercado financeiro (Teste e Produção)",
    "Os modelos de CSR de R2C3, CMP, C3, CTC, COMPE, ECO, SCC, SCG, SEC, SELTEC, SILOC, SILOC BB e SPB, cada um em Teste e Produção.",
    ["comando", "produção", "teste", "homologação", "r2c3", "cmp", "c3", "ctc", "compe", "eco", "scc", "scg", "sec", "seltec", "siloc", "siloc bb", "spb", "ispb", "sisbacen", "icp-brasil"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O comando da CSR de **Teste** e de **Produção** é o mesmo: muda só a **letra** no campo do produto — **T** para teste e **P** para produção. Os exemplos abaixo usam dados **fictícios**: troque CN, cadastro (8 dígitos), razão social, cidade e estado pelos do cliente." },
      { id: "r2c3", titulo: "R2C3 (sigla RRC)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("exemplo_r2c3", "servidor.exemplo.com.br", "RRC T002", "EMPRESA EXEMPLO DE PAGAMENTOS SA"),
        CSR_CIP("exemplo_r2c3", "servidor.exemplo.com.br", "RRC P002", "EMPRESA EXEMPLO DE PAGAMENTOS SA")) },
      { id: "cmp", titulo: "CMP (sigla CMP)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("exemplo_cmp", "servidor.exemplo.com.br", "CMP T002", "EMPRESA EXEMPLO SOCIEDADE DE CREDITO SA"),
        CSR_CIP("exemplo_cmp", "servidor.exemplo.com.br", "CMP P002", "EMPRESA EXEMPLO SOCIEDADE DE CREDITO SA")) },
      { id: "c3", titulo: "C3 (sigla CCC)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("exemplo_c3", "srv-hml.exemplo.com.br", "CCC T002", "EMPRESA EXEMPLO CREDITO FINANCIAMENTO E INVESTIMENTO SA"),
        CSR_CIP("exemplo_c3", "srv-prd.exemplo.com.br", "CCC P002", "EMPRESA EXEMPLO CREDITO FINANCIAMENTO E INVESTIMENTO SA"),
        "Repare que, no exemplo, o **CN** também muda: o servidor de homologação e o de produção são diferentes.") },
      { id: "ctc", titulo: "CTC (sigla CTC)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("chave_teste", "cip-teste.exemplo.com.br", "CTC T003", "SOCIEDADE DE CREDITO EXEMPLO SA"),
        CSR_CIP("chave_prod", "cip-prod.exemplo.com.br", "CTC P003", "SOCIEDADE DE CREDITO EXEMPLO SA")) },
      { id: "compe", titulo: "COMPE", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        'openssl req -sha256 -newkey rsa:2048 -keyout exemplo_compe_teste.key -out exemplo_compe_teste.csr -subj /CN="0000-BANCO EXEMPLO SA"/OU="IF-12345678"/OU="COMPE-T000000001"/O="ICP-Brasil"/C="BR"/',
        'openssl req -sha256 -newkey rsa:2048 -keyout exemplo_compe_prod.key -out exemplo_compe_prod.csr -subj /CN="0000-BANCO EXEMPLO SA"/OU="IF-12345678"/OU="COMPE-P000000001"/O="ICP-Brasil"/C="BR"/',
        CAIXA("nota", "Corrigido em relação ao material original", "Na página de origem, os exemplos de Teste e Produção do COMPE estavam trocados. Aqui seguem a regra de todos os produtos: **T** = teste e **P** = produção.")) },
      { id: "eco", titulo: "ECO (sigla CBC)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("exemplo_eco", "srv10.exemplo.com.br", "CBC H465", "EMPRESA EXEMPLO SOCIEDADE DE CREDITO DIRETO SA"),
        CSR_CIP("exemplo_eco", "srv10.exemplo.com.br", "CBC P465", "EMPRESA EXEMPLO SOCIEDADE DE CREDITO DIRETO SA"),
        "**Obs.:** o campo `OU=\"CBC P465\"` ou `OU=\"CBC H465\"` pode ser preenchido só com os números: `OU=\"465\"`.") },
      { id: "scc", titulo: "SCC (sigla SCC)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("exemplo_scc", "scc-t001.exemplo.coop.br", "SCC T004", "COOPERATIVA DE CREDITO EXEMPLO"),
        CSR_CIP("exemplo_scc", "scc-p001.exemplo.coop.br", "SCC P004", "COOPERATIVA DE CREDITO EXEMPLO"),
        "No exemplo original do SCC, o campo **O** aparece como `ICP BRASIL` (sem hífen); o modelo de preenchimento pede `ICP-Brasil`.") },
      { id: "scg", titulo: "SCG (sigla SCG)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("chave_teste", "scg.exemplo.com.br", "SCG T001", "EMPRESA EXEMPLO CARTOES SA"),
        CSR_CIP("chave_prod", "scg.exemplo.com.br", "SCG P001", "EMPRESA EXEMPLO CARTOES SA")) },
      { id: "sec", titulo: "SEC (sigla SEC)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("exemplo_sec", "hml.exemplo.com.br", "SEC T002", "EMPRESA EXEMPLO SOCIEDADE DE CREDITO FINANCIAMENTO E INVEST"),
        CSR_CIP("exemplo_sec", "prod.exemplo.com.br", "SEC P002", "EMPRESA EXEMPLO SOCIEDADE DE CREDITO FINANCIAMENTO E INVEST")) },
      { id: "seltec", titulo: "SELTEC", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("exemplo_seltec", "www.exemplo.com.br", "SLC T004", "EMPRESA EXEMPLO SA"),
        CSR_CIP("exemplo_seltec", "www.exemplo.com.br", "SLC P004", "EMPRESA EXEMPLO SA"),
        CONFIRMAR("O exemplo do SELTEC usa a sigla `SLC` (a mesma do SILOC), mas o modelo de preenchimento indica `SEC`.")) },
      { id: "siloc", titulo: "SILOC (sigla SLC)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("exemplo_siloc", "slc.t001.exemplo.com.br", "SLC T004", "BANCO EXEMPLO SA BANCO MULTIPLO"),
        CSR_CIP("exemplo_siloc", "slc.p001.exemplo.com.br", "SLC P004", "BANCO EXEMPLO SA BANCO MULTIPLO")) },
      { id: "siloc-bb", titulo: "SILOC BB (sigla SLN)", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        CSR_CIP("chave_teste", "sln.exemplo.com.br", "SLN T004", "EMPRESA EXEMPLO SOCIEDADE DE CREDITO DIRETO S.A"),
        CSR_CIP("chave_prod", "sln.exemplo.com.br", "SLN P004", "EMPRESA EXEMPLO SOCIEDADE DE CREDITO DIRETO S.A")) },
      { id: "spb", titulo: "SPB", icone: "i-certificado", markdown: TESTE_PRODUCAO(
        'openssl req -sha256 -newkey rsa:2048 -keyout EXEMPLO_T001.key -out EXEMPLO_T001.csr -subj /CN="COOPERATIVA DE CREDITO EXEMPLO T001"/OU="ISPB-12345678"/OU="SISBACEN-12345"/O="ICP-Brasil"/L="Sao Paulo"/ST="SP"/C="BR"/',
        'openssl req -sha256 -newkey rsa:2048 -keyout EXEMPLO_P001.key -out EXEMPLO_P001.csr -subj /CN="COOPERATIVA DE CREDITO EXEMPLO P001"/OU="ISPB-12345678"/OU="SISBACEN-12345"/O="ICP-Brasil"/L="Sao Paulo"/ST="SP"/C="BR"/',
        "No SPB, a letra **P/T** e o número de cadastro vão no fim do **CN**.") },
      { id: "dica", titulo: "Dica: um nome de arquivo para cada ambiente", icone: "i-lampada", markdown: CAIXA("dica", "Não sobrescreva a chave do outro ambiente",
        "Se gerar a CSR de Teste e a de Produção na mesma pasta, use nomes diferentes em `-keyout` e `-out` (ex.: `chave_teste.key` / `csr_teste.csr` e `chave_prod.key` / `csr_prod.csr`). Com o mesmo nome, a segunda CSR **apaga a chave da primeira** — e aí o certificado de teste não pode mais ser instalado.") },
      TERMOS("sg-mercado-financeiro, sg-preenchimento, sg-openssl, sg-comandos-ssl, SPB, CIP, ISPB")
    ]),

  /* ---------------- Módulo 4 · Arquivos e conversões ---------------- */
  aula("sg-formatos", "arquivos", 1, "Intermediário", "Formatos de arquivo: PEM, DER, CER, KEY, PFX e P7B",
    "Como reconhecer cada arquivo do certificado, o que tem dentro e quais podem ser enviados por e-mail.",
    ["pem", "der", "base64", "cer", "crt", "key", "pfx", "p12", "p7b", "pkcs#7", "pkcs#12", "formato", "begin certificate"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O certificado pode estar em **texto** (PEM/Base64) ou em **binário** (DER); a chave privada fica num `.key` ou dentro de um **PFX** junto com o certificado." },
      { id: "tabela", titulo: "Os arquivos", icone: "i-tabela", markdown: L(
        "| Arquivo | O que tem dentro | Formato | Pode enviar por e-mail? |",
        "| --- | --- | --- | --- |",
        "| `.csr` | O pedido do certificado (dados + chave pública) | Texto (PEM) | ✅ Sim |",
        "| `.cer` / `.crt` | O certificado (só a parte pública) | **PEM** (texto) ou **DER** (binário) — a extensão não diz qual | ✅ Sim |",
        "| `.pem` | Certificado, cadeia e/ou chave em texto | Texto | ⚠️ Só se não tiver a chave |",
        "| `.key` | A **chave privada** | Texto (PEM), protegida pela PEM pass phrase | ❌ Nunca |",
        "| `.pfx` / `.p12` | Certificado **+ chave privada** (+ cadeia), protegidos por senha | Binário (PKCS#12) | ❌ Só com cuidado: tem a chave |",
        "| `.p7b` | Certificado e/ou cadeia, **sem chave** | PKCS#7 | ✅ Sim |",
        "{tabela: listrada largura=total cabecalho=laranja}") },
      { id: "reconhecer", titulo: "Como saber se é PEM (Base64) ou DER", icone: "i-busca", markdown: L(
        "Abra o arquivo no **Bloco de Notas**:",
        "",
        "- **PEM / Base64:** aparece texto legível entre linhas como estas:",
        "",
        CODIGO("texto", "-----BEGIN CERTIFICATE-----", "MIIGxTCCBK2gAwIBAgIQ...", "-----END CERTIFICATE-----"),
        "",
        "- **DER:** aparecem caracteres “estranhos” (é binário).",
        "",
        "Outras primeiras linhas que ajudam: `BEGIN CERTIFICATE REQUEST` (CSR), `BEGIN ENCRYPTED PRIVATE KEY` (chave com senha), `BEGIN PRIVATE KEY` / `BEGIN RSA PRIVATE KEY` (chave sem senha).") },
      { id: "quando", titulo: "Quando cada formato é pedido", icone: "i-info", markdown: L(
        "- **Apache, Nginx** e a maioria dos servidores Linux: certificado e cadeia em **PEM** + o `.key`.",
        "- **IIS / Windows**: **PFX** (ou concluir a solicitação no IIS, se a CSR foi gerada lá).",
        "- **Java (Tomcat, JBoss)**: keystore, geralmente montada a partir de um **PFX**.",
        "- Alguns sistemas e portais pedem o `.cer` em **DER**; outros, em **Base64** — veja [Converter DER e Base64](#sg-converter).") },
      TERMOS("sg-converter, sg-pfx, anatomia-certificado, PEM, DER, PFX, X.509")
    ]),

  aula("sg-converter", "arquivos", 2, "Básico", "Converter DER e Base64 (PEM)",
    "Converter o certificado de DER para Base64 e de Base64 para DER, pelo OpenSSL ou direto pelo Windows (Copiar para Arquivo).",
    ["converter", "conversão", "der", "base64", "pem", "x.509", "copiar para arquivo", "assistente para exportação", "cer"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "Dá para trocar o formato do `.cer` entre **DER** (binário) e **Base64/PEM** (texto) com **um comando do OpenSSL** ou pelo **assistente de exportação do Windows** — o certificado é o mesmo, muda só a “embalagem”." },
      { id: "der-pem-openssl", titulo: "DER → Base64 (PEM) pelo OpenSSL", icone: "i-ferramenta", markdown: L(
        CODIGO("bash", "openssl x509 -inform DER -in C:\\certificados\\exemplo.cer -outform PEM -out C:\\certificados\\exemplo-base64.cer"),
        "",
        CAIXA("nota", "Use um nome de saída diferente", "Na página de origem, a entrada e a saída tinham o mesmo nome. Gere um arquivo novo (ex.: `exemplo-base64.cer`) para não perder o original se algo der errado.")) },
      { id: "pem-der-openssl", titulo: "Base64 (PEM) → DER pelo OpenSSL", icone: "i-ferramenta", markdown: L(
        CODIGO("bash", "openssl x509 -outform der -in certificate.pem -out certificate.der"),
        "",
        "ou, se o arquivo for `.cer`:",
        "",
        CODIGO("bash", "openssl x509 -outform der -in certificate.cer -out certificate.der")) },
      { id: "windows-base64", titulo: "DER → Base64 direto pelo Windows", icone: "i-imagem", markdown: L(
        "1. Clique duas vezes no certificado (`.cer`), abra a aba **Detalhes** e clique em **Copiar para Arquivo…**",
        "",
        IMG("certificado-detalhes-copiar.png", "Janela Certificado, aba Detalhes, com o botão Copiar para Arquivo destacado"),
        "",
        "2. No **Assistente para Exportação de Certificados**, clique em **Avançar**.",
        "",
        IMG("assistente-boas-vindas.png", "Tela de boas-vindas do Assistente para Exportação de Certificados com o botão Avançar destacado"),
        "",
        "3. Selecione a **segunda opção**, **X.509 codificado na base 64 (*.cer)**, e clique em **Avançar**.",
        "",
        IMG("assistente-formato-base64.png", "Formato do Arquivo de Exportação com a opção X.509 codificado na base 64 selecionada"),
        "",
        "4. Defina um **nome** para o certificado, clique em **Avançar** e depois em **Concluir**.",
        "",
        IMG("assistente-nome-arquivo.webp", "Tela Arquivo a Ser Exportado com o campo Nome do arquivo preenchido")) },
      { id: "windows-der", titulo: "Base64 → DER direto pelo Windows", icone: "i-imagem", markdown: L(
        "Mesmo caminho, mudando só o formato:",
        "",
        "1. Clique duas vezes no certificado › aba **Detalhes** › **Copiar para Arquivo…** › **Avançar**.",
        "2. Selecione a **primeira opção**, **X.509 binário codificado por DER (*.cer)**, e clique em **Avançar**.",
        "",
        IMG("assistente-formato-der.webp", "Formato do Arquivo de Exportação com a opção X.509 binário codificado por DER selecionada"),
        "",
        "3. Defina um **nome**, clique em **Avançar** e em **Concluir**.") },
      { id: "duvidas", titulo: "Dúvidas comuns", icone: "i-ajuda", markdown: L(
        "### A conversão muda o certificado?",
        "Não. O conteúdo é o mesmo (mesmo número de série, mesma validade); muda só a forma de gravar o arquivo.",
        "",
        "### A opção PFX aparece cinza no assistente. Por quê?",
        "Porque o Windows não tem a **chave privada** desse certificado (só o `.cer`). Para gerar um PFX, veja [Montar e conferir o PFX](#sg-pfx).") },
      TERMOS("sg-formatos, sg-pfx, PEM, DER, Base64, OpenSSL")
    ]),

  aula("sg-pfx", "arquivos", 3, "Intermediário", "Montar e conferir o PFX",
    "Juntar o certificado emitido com a chave privada num PFX, conferir se chave e certificado combinam e extrair de volta.",
    ["pfx", "p12", "pkcs12", "montar pfx", "juntar chave", "chave privada", "modulus", "legacy", "openssl 3", "cadeia", "extrair"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "O **PFX** junta o certificado emitido (`.cer`) com a **chave privada** (`.key`) que nasceu junto com a CSR — sem essa chave não existe PFX." },
      { id: "conferir", titulo: "1. Conferir se a chave combina com o certificado", icone: "i-check", markdown: L(
        "Os três comandos abaixo precisam mostrar **o mesmo resultado**. Se o do certificado for diferente, ele foi emitido para outra CSR (outra chave):",
        "",
        CODIGO("bash",
          "openssl x509 -noout -modulus -in certificado.cer | openssl md5",
          "openssl rsa -noout -modulus -in exemplo.key | openssl md5",
          "openssl req -noout -modulus -in exemplo.csr | openssl md5"),
        "",
        "O comando da chave pede a **PEM pass phrase**.") },
      { id: "montar", titulo: "2. Montar o PFX", icone: "i-ferramenta", markdown: L(
        CODIGO("bash", "openssl pkcs12 -export -out certificado.pfx -inkey exemplo.key -in certificado.cer -certfile cadeia.cer"),
        "",
        "- `-inkey`: a chave privada (pede a PEM pass phrase).",
        "- `-in`: o certificado emitido.",
        "- `-certfile`: a cadeia (intermediárias), quando houver — deixa o PFX completo.",
        "- No fim, o OpenSSL pede a **senha do PFX** (export password), que será usada para importar.",
        "",
        "Se o certificado estiver em DER, converta antes para Base64 (veja [Converter DER e Base64](#sg-converter)).") },
      { id: "legacy", titulo: "O Windows não importa o PFX?", icone: "i-alerta", markdown: L(
        "O **OpenSSL 3** protege o PFX com um algoritmo moderno que versões antigas do Windows (ex.: Windows Server 2016 e anteriores) não conseguem abrir: aparece erro de senha incorreta mesmo com a senha certa. Gere de novo com `-legacy`:",
        "",
        CODIGO("bash", "openssl pkcs12 -export -legacy -out certificado.pfx -inkey exemplo.key -in certificado.cer -certfile cadeia.cer")) },
      { id: "extrair", titulo: "Extrair do PFX", icone: "i-download", markdown: L(
        "Para separar de novo (por exemplo, para levar a um servidor Linux):",
        "",
        CODIGO("bash",
          "openssl pkcs12 -in certificado.pfx -clcerts -nokeys -out certificado.cer",
          "openssl pkcs12 -in certificado.pfx -nocerts -out exemplo.key",
          "openssl pkcs12 -in certificado.pfx -cacerts -nokeys -out cadeia.cer"),
        "",
        "(Para um PFX antigo no OpenSSL 3, acrescente `-legacy`.)") },
      SUPORTE(
        "- **Cliente perdeu a chave privada:** não dá para recuperar nem montar o PFX. O caminho é gerar uma **CSR nova** e pedir a reemissão.",
        "- O PFX tem a chave privada: **não peça** que o cliente envie o PFX para a Valid.",
        "- No IIS, quem gerou a CSR pelo próprio IIS não precisa montar PFX: basta **concluir a solicitação** no mesmo servidor (veja [O que é a CSR](#sg-csr))."),
      TERMOS("sg-formatos, sg-converter, sg-csr, PFX, Chave privada, PEM pass phrase")
    ]),

  /* ---------------- Módulo 5 · No atendimento ---------------- */
  aula("sg-checklist", "atendimento", 1, "Intermediário", "Checklist e erros comuns",
    "O que conferir antes de enviar a CSR e os erros que já apareceram no atendimento de SSL, com a causa e o que fazer.",
    ["checklist", "erro", "sha-512", "sha-256", "rsa 4096", "rsa 2048", "caracteres especiais", "chave perdida", "domínio primário", "redefinição de senha", "ssl labs", "s_client", "cadeia incompleta"], [
      { id: "frase", titulo: "Em uma frase", icone: "i-lampada", markdown: "A maior parte dos problemas de SSL nasce na **CSR**: produto errado, algoritmo errado, campo com caractere especial ou letra P/T trocada. Confira antes de enviar." },
      { id: "checklist", titulo: "Antes de enviar a CSR", icone: "i-check", markdown: L(
        "- [ ] O comando é o **do produto comprado** ([SSL](#sg-comandos-ssl) ou [mercado financeiro](#sg-comandos-financeiro))?",
        "- [ ] **Algoritmo certo**: `-sha512` no AE-Equipamento A1 Cadeia V10; `-sha256` nos demais modelos.",
        "- [ ] Chave **RSA 2048** (`-newkey rsa:2048`).",
        "- [ ] **CN** certo: domínio, `*.domínio` (Wildcard) ou razão social (Code Signing, COMPE, SPB, BRSEAL).",
        "- [ ] Razão social **sem abreviações** e sem acentos ou caracteres especiais.",
        "- [ ] Letra **P** (produção) ou **T** (teste) certa e números do cadastro com a quantidade de dígitos pedida.",
        "- [ ] CSR conferida num decodificador ou com `openssl req -in exemplo.csr -noout -text`.",
        "- [ ] CSR enviada para o lugar certo: **agente de registro** (cadeia Brasil) ou **consultor comercial** (internacional).",
        "- [ ] O `.key` e a PEM pass phrase **ficaram com o cliente**.") },
      { id: "erros", titulo: "Erros já registrados pelo time", icone: "i-erro", markdown: L(
        "| Situação | Causa | O que fazer |",
        "| --- | --- | --- |",
        "| Erro na validação do **SSL EV A1** | CSR gerada com **SHA-256**, mas a categoria do produto usa **SHA-512** | Gerar a CSR de novo com `-sha512` |",
        "| Emissão recusada com chave **RSA 4096** | O sistema de emissão não aceitava 4096 | Gerar com `rsa:2048` |",
        "| Certificado internacional parado antes da validação | Falta a Sectigo definir o **domínio primário** | Enviar para a Sectigo definir o domínio primário |",
        "| Redefinição de senha do produto SSL não funciona | Pedido feito por quem não é o responsável | Fazer pelo **responsável pelo CNPJ** |",
        "| Cliente pede EV **Wildcard** | Não existe EV Wildcard | Oferecer **Multi-domínio** ou OV/DV Wildcard |",
        "| `-addext` não reconhecido no Multi-domínio | Aspas curvas copiadas do Word/Outlook, ou OpenSSL antigo | Aspas retas; OpenSSL 1.1.1 ou mais novo |",
        "| Certificado não instala / “sem chave privada” | Instalado longe da chave (outro servidor, chave apagada ou sobrescrita) | Usar o `.key` original ou concluir no IIS onde a CSR nasceu; sem a chave, nova CSR |",
        "{tabela: listrada largura=total cabecalho=laranja}",
        "",
        CONFIRMAR("Esses registros vêm das anotações do time e podem ter mudado: confirmar se continuam valendo (especialmente o limite de RSA 2048).")) },
      { id: "site", titulo: "Conferir um certificado já instalado no site", icone: "i-globo", markdown: L(
        "- **SSL Labs** ([ssllabs.com/ssltest](https://www.ssllabs.com/ssltest/)): mostra o certificado, a **cadeia** (avisa se falta intermediária), as versões de TLS e uma nota.",
        "- **OpenSSL**, para ver a cadeia que o servidor entrega:",
        "",
        CODIGO("bash", "openssl s_client -connect www.exemplo.com.br:443 -servername www.exemplo.com.br -showcerts"),
        "",
        "Se o navegador avisa “conexão não é particular”, veja as causas na aula [HTTPS](#https).") },
      { id: "faq", titulo: "Perguntas frequentes", icone: "i-ajuda", markdown: L(
        "### O cliente pode reaproveitar a CSR antiga na renovação?",
        "O recomendado é gerar **CSR e chave novas** a cada emissão: a chave é renovada junto com o certificado.",
        "",
        CONFIRMAR("Se a Sectigo e a cadeia Brasil aceitam reaproveitar a mesma CSR na renovação ou na reemissão."),
        "",
        "### Posso gerar a CSR pelo cliente?",
        "Não é o recomendado: quem gera a CSR fica com a chave privada. O ideal é o cliente gerar no próprio servidor (pode ser com o passo a passo de [Gerar a CSR com o OpenSSL](#sg-openssl)).",
        "",
        "### Qual a diferença entre a senha PEM e a senha do PFX?",
        "A **PEM pass phrase** protege o `.key` e nasce na geração da CSR. A **senha do PFX** é criada ao montar o PFX e é a que o servidor pede na importação. Podem ser iguais ou diferentes.") },
      TERMOS("sg-openssl, sg-comandos-ssl, sg-comandos-financeiro, sg-pfx, sg-validacao, https, CSR, Sectigo")
    ])
];

/* Termos novos do glossário (os já publicados com o mesmo nome mantêm a definição) */
export const GLOSSARIO_SSL = [
  { termo: "Wildcard", definicao: "Certificado SSL “curinga” (*.dominio.com) que protege subdomínios ilimitados de um nível do mesmo domínio. Existe em DV e OV, não em EV.", tema: "sg-wildcard-multidominio" },
  { termo: "Multi-domínio", definicao: "Certificado SSL que protege uma lista de nomes (domínios e subdomínios, inclusive de domínios diferentes), informados no campo SAN.", tema: "sg-wildcard-multidominio" },
  { termo: "FQDN", definicao: "Fully Qualified Domain Name: o nome completo de um servidor na internet, como servidor.exemplo.com.br. É o que se informa no Equipamento A1 e no Infoconv, que não têm CSR.", tema: "sg-servidor-outros" },
  { termo: "OpenSSL", definicao: "Ferramenta gratuita de linha de comando para gerar chaves e CSR, conferir e converter certificados.", tema: "sg-openssl" },
  { termo: "PEM pass phrase", definicao: "Senha da chave privada (.key) criada pelo cliente ao gerar a CSR no OpenSSL. Não pode ser esquecida: sem ela a chave não abre.", tema: "sg-openssl" },
  { termo: "PEM", definicao: "Formato de texto (Base64) de certificados, chaves e CSR, entre linhas -----BEGIN ...----- e -----END ...-----.", tema: "sg-formatos" },
  { termo: "DER", definicao: "Formato binário do certificado X.509. A extensão .cer pode ser DER ou PEM.", tema: "sg-formatos" },
  { termo: "Base64", definicao: "Forma de escrever dados binários só com letras, números, + e /. O formato PEM é o certificado em Base64.", tema: "sg-converter" },
  { termo: "P7B", definicao: "Arquivo PKCS#7 com certificado e/ou cadeia, sem a chave privada.", tema: "sg-formatos" },
  { termo: "Sectigo", definicao: "Autoridade Certificadora internacional dos certificados SSL DV, OV e EV vendidos pela Valid. A CSR desses produtos vai para o consultor comercial que fez o pedido junto à Sectigo.", tema: "sg-validacao" },
  { termo: "Code Signing", definicao: "Certificado de assinatura de código: prova quem publicou um programa (.exe, .dll, .msi, Applet Java…) e que ele não foi alterado.", tema: "sg-servidor-outros" },
  { termo: "S/MIME", definicao: "Certificado para assinar e criptografar e-mails.", tema: "sg-servidor-outros" },
  { termo: "SPB", definicao: "Sistema de Pagamentos Brasileiro. O certificado SPB (e o SPB PIX) identifica a instituição nos serviços do Banco Central.", tema: "sg-mercado-financeiro" },
  { termo: "CIP", definicao: "Câmara Interbancária de Pagamentos. Os certificados CIP (C3, CTC, SCC, SCG, SEC, SELTEC, SILOC…) protegem a troca de arquivos entre as instituições e a CIP.", tema: "sg-mercado-financeiro" },
  { termo: "ISPB", definicao: "Código de 8 dígitos que identifica a instituição no Sistema de Pagamentos Brasileiro; vai na CSR do SPB (OU=ISPB-00000000).", tema: "sg-preenchimento" },
  { termo: "Open Finance", definicao: "Sistema de compartilhamento de dados e serviços financeiros entre instituições. Usa dois certificados ICP-Brasil: BRCAC (transporte) e BRSEAL (assinatura).", tema: "sg-open-finance" },
  { termo: "BRCAC", definicao: "Certificado de transporte do Open Finance Brasil (cadeia V10): autentica a conexão entre as instituições.", tema: "sg-open-finance" },
  { termo: "BRSEAL", definicao: "Certificado de assinatura do Open Finance Brasil (cadeia V5): assina as mensagens trocadas.", tema: "sg-open-finance" }
];
