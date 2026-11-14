# Relatório da importação — OneNote da Paula → caderno "Registro da Paulinha"

Gerado em 20/10/2026.

Este relatório tem duas partes: a primeira importação (seção SUPORTE N2, logo abaixo) e a segunda importação (seção "Segunda importação — demais seções", no fim), com as outras seções do OneNote.

## Resumo

- **Origem:** caderno OneNote "Paula @ Valid Soluções e Serviços em Meios de Pagamentos", **somente a seção SUPORTE N2**.
- **Como foi copiado:** página por página no OneNote para a Web (selecionar tudo e copiar), depois de rolar a página inteira para o OneNote carregar todas as imagens. Nada foi digitado de memória nem resumido.
- **Arquivo gerado:** `importacao/registro-paulinha.json` (cerca de 21,6 MB).
  - 1 pasta: **SUPORTE N2**
  - **26 notas**: as 27 páginas da seção, menos 1 que está vazia
  - **140 imagens**, todas embutidas no arquivo; nenhuma depende de link do SharePoint
- **Nada foi gravado direto no Firestore.** A importação é feita por uma administradora pelo próprio site.
- **Conferência de fidelidade:** comparei, página por página, todas as palavras do texto copiado do OneNote com o texto das notas. Não falta nenhuma palavra. As únicas diferenças são os itens removidos listados abaixo e os números das listas numeradas.

## Como importar

1. Entre no site com uma conta de administradora.
2. Abra o caderno **Registro da Paulinha**.
3. Clique em **Importar do OneNote / Word** e vá na aba **JSON**.
4. Escolha o arquivo `importacao/registro-paulinha.json`.
5. Confira a prévia (1 pasta, 26 notas, 140 imagens), escolha o destino (raiz do caderno) e clique em **Importar**.

A importação demora alguns minutos, porque cada imagem é comprimida e gravada separadamente. Se ela for interrompida, rode de novo com a opção **"Pular existentes"**.

Cada nota leva duas propriedades:

- **criadoOneNote:** a data e a hora que o OneNote mostra embaixo do título.
- **origem:** o caminho no OneNote.

## Dados sensíveis removidos do TEXTO

Cada caso foi trocado por `[REMOVIDO NA IMPORTAÇÃO: <tipo> — consultar a Paula]`. Os valores originais não aparecem neste relatório.

### CONHECIMENTO N2 - TECNICO

- **CPF (6 ocorrências do mesmo número):**
  - no log "SearchByCPF Request", nos campos `cpf=` (2 vezes);
  - no endereço "startBio" do VC IVS, nos parâmetros `cpfRAOperator=` e `cpf=`, que aparecem no texto e no link (4 vezes).
  - O link "startBio" virou texto simples, para o endereço não ficar quebrado.
- **CPF** na linha "CPF: …", logo depois de "Aracert > passou o contato do N2 para o cliente final."
- **Nome e CPF** em "ERRO ACESSO SIG: … do CPF …".
- **Telefone e nome** de contato logo antes do link do Callbox.
- **Nome completo do AGR** no log da NuVidio ("Buscando atendente no banco {AG… …}"). O código AG foi mantido.

### ACESSOS MAC IOS

Logo depois do link "LINUX":

- 2 IDs de acesso remoto (TeamViewer ou telefone);
- 4 senhas.

### RESPOSTAS RAPIDAS - TRF3

- **PIN, 2 ocorrências**, na frase "O PIN padrão é … (caso não tenha sido alterado)".
- Esse é o PIN de fábrica do token. Foi removido seguindo a regra para PINs; a Paula decide se ele volta para a nota.

### ORIENTAÇÕES N2

- **Senha** do webmail da Locaweb na linha "Usuário: … Senha: …". O usuário (e-mail do suporte corporativo) foi mantido.

### Legendas automáticas de imagens

O OneNote gera essas legendas sozinho, lendo o texto que aparece dentro da imagem.

- **SERASA, imagem 1:** a legenda trazia o CPF, o nome, a data de nascimento e o e-mail do cliente, além do número de série do certificado. A legenda foi apagada; a imagem continua na nota.
- **CONHECIMENTO N2 - TECNICO, imagem 43:** a legenda era só a palavra "undefined". Foi apagada.

## Imagens com dados de clientes ou dados pessoais

Por decisão do usuário, **todas as imagens foram incluídas**, porque fazem parte do registro. As imagens abaixo mostram dados pessoais e devem ser tratadas com cuidado. Se for preciso, dá para apagar alguma delas no caderno depois da importação.

### CONHECIMENTO N2 - TECNICO

Esta página tem muitas capturas de tela, entre elas:

- tabela de busca de clientes com nome, CPF, e-mail e telefone;
- tela de validação DigiForte com nome do agente, CNPJ e razão social da empresa, e nome e CPF do responsável;
- resultado de consulta SQL da NuVidio com nome e e-mail do AGR;
- conversa do Teams;
- busca de ticket com nome e CPF do cliente;
- dados do certificado e da assinatura da própria Paula;
- tela de videoconferência com nome, telefone, e-mail e CPF do cliente;
- tela do DXSAFE com nome do titular do certificado;
- IDs de dispositivo e de produto de máquinas;
- uma foto de rosto.

### Outras páginas

- **SERASA:** tela com CPF, nome, data de nascimento e e-mail do cliente, e número de série do certificado.
- **ERRO COMBO:** nome, CPF e data de nascimento de cliente.
- **AASP.:** nomes de pessoas da equipe.
- **API e INTEGRA ICP:** nome e CNPJ do cliente no sistema da cardsinova (GFSIS) e nome de usuário de login.
- **CONHECIMENTO VAREJO:** tela da EFD-Reinf com a razão social de uma empresa cliente.

## O que foi mantido de propósito

- **Números de ticket e de chamado** (SAR, JIRA, GLPI, SAP). Exemplos: os tickets das páginas ERRO COMBO, AASP. e SCRIPTS PARA ACIONAMENTOS.
- **Números longos que não são CPF.** Os números das páginas "Configuração de maquina" e "AASP." (depois de "Ajuste de skin manager") foram testados com o dígito verificador de CPF e **não** são CPF válidos, então ficaram.
- **Pessoas da equipe interna:** nomes de colegas (por exemplo nas atas de reunião e em "LUCAS E MATHEUS") e nomes de usuário do Windows dentro de caminhos de pasta (por exemplo `C:\Users\…\AppData`).
- **Dados de infraestrutura:** endereços IP, servidores NTP, ramal e o código de usuário de sistema que aparece no log.
- O texto de exemplo "ID do AGR: 00000000".
- **Nomes de empresas** em CONHECIMENTO VAREJO e em outras páginas. São dados de empresa, não de pessoa.
- **Dados técnicos da máquina** em ERRO - LEITORA: nome do dispositivo, ID do dispositivo, ID do produto e número de série das leitoras.

## Páginas e anexos que não entraram

- **"Untitled Page"** (quinta-feira, 5 de fevereiro de 2026 11:17) **está vazia** no OneNote, então não foi criada nota para ela.
- **Anexos de arquivo em CONHECIMENTO N2 - TECNICO.** O OneNote mostra esses anexos como ícones e eles não vêm na cópia. Nas notas, só o nome do arquivo aparece, como texto:
  - "Cert _ Validação Simplificada _ Implantação-040825-170738.pdf"
  - "SafeSign_Windows_x64_3.5.0.0_ADMIN 1.exe"
  - "Safenet+10.8+64bits_valid 2.msi"
  - "Manual de Apoio - Safenet 5.pdf"

  Se forem necessários, os arquivos precisam ser baixados do OneNote pela Paula.
- **Nada ficou ilegível.** O texto foi copiado direto do OneNote, sem leitura de imagem.

## Observações de formatação

- No OneNote para a Web, os itens de lista vêm com parágrafos e sublistas "dentro" do item. Em "API e INTEGRA ICP", isso fazia o importador do site perder trechos e trocar a ordem do texto. Por isso o arquivo JSON foi gerado com uma correção só nessa parte, a conversão de listas. O texto ficou completo e na ordem do original.
- Os exemplos de código em "API e INTEGRA ICP" (Node.js e Python) ficaram como parágrafos, um por linha, sem o recuo original.
- Links internos do OneNote: nenhum encontrado nesta seção.

## Segunda importação — demais seções

Feita em 20/10/2026, do mesmo jeito que a primeira: cópia página por página no OneNote para a Web, conferência palavra por palavra e importação pelo próprio site.

### Resumo

- **Seções copiadas:** CONHECIMENTOS GERAIS, MELHORIAS, Prod. Bancarios, Nova Seção 3, SKIN, Rewiew do CORE, CIN + vidaaS, Nova Seção 1, Nova Seção 4, Criação de produto JUS e NUVIDIO.
- **Arquivo gerado:** `importacao/registro-paulinha-restante.json` (cerca de 1,4 MB).
  - **11 pastas**, uma por seção, na raiz do caderno, ao lado de SUPORTE N2;
  - **13 notas**;
  - **18 imagens**, todas embutidas no arquivo.
- **Já importado.** A importação foi feita no site com a conta da Lays (aba JSON, destino "Raiz do caderno", opção "Pular existentes"). A pasta SUPORTE N2 não foi mexida.
- **Conferido depois da importação:** as 13 notas aparecem no caderno, as imagens carregam e as propriedades "Criado no OneNote" e "Origem" estão preenchidas.
- **Conferência de fidelidade:** não falta nenhuma palavra em nenhuma página. A única diferença é que a nota NUVIDIO tem os números da lista numerada (1 a 6), que o OneNote não manda como texto.

### Notas criadas

| Pasta | Nota | Imagens |
| --- | --- | --- |
| CONHECIMENTOS GERAIS | Temas diversos. | 10 |
| MELHORIAS | Migração de atendimento virtual x presencial | 0 |
| MELHORIAS | Novo fluxo CV 05.04 | 3 |
| Prod. Bancarios | (sem título) https://cryptoid.com.br/… | 1 |
| Nova Seção 3 | COFECON - Conselho Federal de Economia | 0 |
| SKIN | Dúvidas sobre Renovação do Certificado Digital Valid – validcertificadora | 0 |
| Rewiew do CORE | Rewiew CORE | 0 |
| CIN + vidaaS | CIN + vidaaS | 2 |
| Nova Seção 1 | (sem título) REPASSE INDIVIDUAL > Lays | 0 |
| Nova Seção 4 | (sem título) Cenário anterior: | 0 |
| Criação de produto JUS | (sem título) Quando criar um produto cadeia JUS | 0 |
| NUVIDIO | NUVIDIO | 0 |
| NUVIDIO | Reunião time de DEV (vcert e Nuvidio) | 2 |

### Títulos

- **Páginas sem título no OneNote:** as de Prod. Bancarios, Nova Seção 1, Nova Seção 4 e Criação de produto JUS. O nome da nota é "(sem título)" seguido do começo do texto da página, o mesmo que o OneNote mostra na lista de páginas.
- **SKIN:** o título da página no OneNote inclui dois links (a página de FAQ e a de documentos necessários). O nome da nota ficou só com a parte em texto, e os dois links foram para o começo da nota, para nada se perder.
- A data de "Novo fluxo CV 05.04" está em inglês porque é assim que o OneNote mostra.

### Dados sensíveis removidos do TEXTO

Mesma marcação da primeira importação: `[REMOVIDO NA IMPORTAÇÃO: <tipo> — consultar a Paula]`. Os valores não aparecem neste relatório.

**CIN + vidaaS (12 trocas):**

- No payload do SCDA ("Payload que a certificadora busca do SCDA"):
  - CPF do cliente (`cpf`);
  - CPF do operador (`operatorCpf`);
  - data de nascimento (`birthdayDate`);
  - nome completo (`name`);
  - e-mail, 2 vezes (`mail` e `mailConfirm`);
  - número de telefone (`phoneNumber`). O DDD foi mantido;
  - nome do cliente que aparecia dentro do nome do arquivo de foto (`foto_…`).
- No bloco PROD:
  - CPF e data de nascimento do "Agente eletronico Vcert";
  - código SAT (linha "Codsat").
- No bloco HML: código SAT (linha "COD SAT").
- **Mantidos:** transactionId, sku, idCertificateOffice, id_certificate_office, números de pedido, códigos RD, nomes das localidades e o e-mail genérico do agente eletrônico.

**Rewiew do CORE (1 troca):**

- O número de 11 dígitos no fim da página passa no teste do dígito verificador de CPF, então foi removido.
- Os outros números de 11 dígitos da página (os 3 "Ticket:" e o número logo depois de "Emissão simplificada") **não** são CPF válidos e ficaram.

**Legendas automáticas de imagens:** nenhuma das 18 imagens tem legenda, então não havia nada para limpar.

### Imagens com dados de clientes ou dados pessoais

Todas as imagens foram incluídas, como na primeira importação.

- **CONHECIMENTOS GERAIS › Temas diversos.:**
  - captura do Postman (LoadOrder) com CNPJ, razão social e e-mail de contato de um cliente empresa;
  - propriedades de um certificado com o domínio e o CNPJ de um órgão público cliente.
- **NUVIDIO › Reunião time de DEV:**
  - exemplo de JSON do webhook com um bloco "customer". Os valores parecem de exemplo ("Cliente", "email@gmail.com"), mas há um campo de CPF preenchido;
  - tela do painel V/Cert com o nome de um colaborador interno.
- **CIN + vidaaS:** as 2 imagens são modelos de e-mail da skin com campos de exemplo (como `cpfTitularCertificado`), sem dado real.

### Páginas e anexos que não entraram

- **Anotações Rápidas:** a única página ("Untitled Page", quinta-feira, 8 de janeiro de 2026 13:08) **está vazia** no OneNote. Copiar a página não trouxe nada, então a seção não virou pasta.
- **Anexo em MELHORIAS › Novo fluxo CV 05.04:** o e-mail "Valid Informa_Melhorias Sistêmicas" tinha o PDF "Melhorias Sistêmicas - Match PSBio e Datavalid.pdf" anexado. Na nota aparece só o nome do arquivo; se for preciso, o PDF tem que ser baixado do OneNote pela Paula.

### Observações de formatação

- Em "Novo fluxo CV 05.04", o e-mail colado no OneNote veio como tabela. O cabeçalho do e-mail (Assunto, De, Enviados, Anexos) ficou como tabela, e o corpo do e-mail ficou dentro de uma célula, com os parágrafos separados por "·", que é como o importador do site junta parágrafos dentro de tabelas.
- O payload JSON de "CIN + vidaaS" ficou como parágrafos, um por linha, sem o recuo original.

## Arquivos de trabalho

A pasta `importacao/onenote-paula/` guarda a cópia bruta de cada página (`.html` e `.txt`), com uma subpasta por seção (SUPORTE N2 e as demais). Essa cópia **ainda contém os dados sensíveis sem máscara**, como senhas e CPFs.

- O site não publica a pasta `importacao/`: ela está fora da hospedagem no `firebase.json`.
- Mesmo assim, o recomendado é **apagar `importacao/onenote-paula/` depois de confirmar a importação**.
