# Guia da Mesa — Dia da Assembleia

> Manual prático e operacional para os membros da mesa diretora e administradores do **Scelta** durante a condução de eleições da igreja local (Pastor, Presbítero, Diácono) e de sociedades internas (UPA, UMP, SAF).

---

## Sumário

1. [Preparação e Configuração da Sala](#1-prepara%C3%A7%C3%A3o-e-configura%C3%A7%C3%A3o-da-sala)
2. [Impressão e Entrega de Cartões](#2-impress%C3%A3o-e-entrega-de-cart%C3%B5es)
3. [Como Ajudar Quem Não Consegue Entrar](#3-como-ajudar-quem-n%C3%A3o-consegue-entrar)
4. [Liberar Sessão (Troca de Aparelho / Erro de Código em Uso)](#4-liberar-sess%C3%A3o-troca-de-aparelho--erro-de-c%C3%B3digo-em-uso)
5. [Lançar a Urna de Papel (Voto Híbrido)](#5-lan%C3%A7ar-a-urna-de-papel-voto-h%C3%ADbrido)
6. [Encerrar Escrutínio com Pendentes](#6-encerrar-escrut%C3%ADnio-com-pendentes)
7. [Operação do Telão / Projetor](#7-opera%C3%A7%C3%A3o-do-tel%C3%A3o--projetor)
8. [Plano de Contingência — Se o Sistema ou a Internet Caírem](#8-plano-de-conting%C3%AAncia--se-o-sistema-ou-a-internet-ca%C3%ADrem)

---

## 1. Preparação e Configuração da Sala

A preparação acontece na aba **Preparar** da tela da sala.

### Importação da Planilha de Membros (Cadastro Geral)

Antes de criar ou abrir as salas, importe o rol no menu **Membros** (`/admin/membros`):
- O arquivo deve ser um CSV com o cabeçalho: `nome,comungante,sexo,data_nascimento,upa_ativo,upa_ingresso,ump_ativo,ump_ingresso`.
- **Regras de Elegibilidade**:
  - **Eleições de Oficiais (Presbíteros, Diáconos, Pastor, Mesa do Conselho)**: somente membros **comungantes** (`comungante=sim`) são elegíveis para votar e ser votados (conforme CI/IPB art. 112).
  - **Sociedades Internas (UPA e UMP)**: basta ser **sócio ativo** (`upa_ativo=sim` ou `ump_ativo=sim`). Membros que ainda não são comungantes mas são sócios ativos votam normalmente na assembleia da sua respectiva sociedade, mas **não** votam nas eleições gerais de Oficiais.

### Criação da Sala

1. Clique em **Nova Sala** e preencha:
   - **Título**: Ex.: *"Eleição de Diáconos 2026"* ou *"Diretoria UPA 2026"*.
   - **Tipo da Sala**: Escolha o cargo (`Diácono`, `Presbítero`, `Diretoria UPA`, etc.).
   - **Regimento / Regras**: O sistema pré-configura a maioria absoluta (> 50%) e as regras de escrutínio.
   - **Número de Vagas ($N$)**: Para Presbíteros e Diáconos, informe o número de vagas abertas pelo Conselho (ex.: 3 ou 5). Para sociedades e pastor, o padrão é 1 vaga por cargo.
   - **Quórum**: Escolha quórum absoluto (ex.: 50 pessoas) ou percentual (ex.: 34% para oficiais ou > 50% para plenárias de sociedade).
2. **Modo de Entrada**:
   - **Cartão com código**: Recomendado para assembleias onde os cartões foram impressos e recortados previamente.
   - **Aprovação da mesa**: Recomendado para entrada espontânea via QR Code/link onde o eleitor busca seu nome no rol e a mesa aprova o acesso em tempo real.

---

## 2. Impressão e Entrega de Cartões

Quando o modo de entrada for **Cartão com código**:

1. Acesse a aba **Preparar** e clique em **Imprimir Cartões**:
   - O sistema gera folhas A4 padronizadas com 8 cartões por página (`.print-sheet`).
   - Cada cartão contém o QR Code SVG legível, URL curta `/s/:codigoSala?c=:codigo` e código alfanumérico em fonte grande destacada.
   - **Dica de Impressão**: no diálogo de impressão do navegador, desmarque *"Cabeçalhos e rodapés"* e configure margens como *"Nenhuma"* ou *"Padrão"*. Os cartões já possuem quebras de página automáticas (`break-after: page`) e não sofrem cortes.
2. **Cartão Avulso / Eleitor Adicionado de Última Hora**:
   - Se um visitante ou membro for adicionado ao rol durante a assembleia através do botão *"Adicionar do cadastro"* ou *"Adicionar avulso"*, clique no ícone da impressora ao lado do nome dele no painel do rol para imprimir um **cartão avulso individual**, sem precisar reimprimir todo o lote.

---

## 3. Como Ajudar Quem Não Consegue Entrar

Problemas comuns de conexão e entrada dos eleitores:

### O celular abriu o link dentro do WhatsApp / Instagram / Câmera
- Aplicativos de mensagem usam WebViews embutidas que frequentemente apagam cookies ou não suportam conexões seguras WebSocket.
- O Scelta exibe automaticamente um aviso destacado na tela do eleitor: *"Abra no seu navegador padrão (Chrome ou Safari)"*.
- **Instrução para a mesa**: Peça para o eleitor tocar nos 3 pontinhos (`...` ou botão de compartilhar) no canto superior da tela do celular e escolher **"Abrir no Chrome"** (Android) ou **"Abrir no Safari"** (iPhone).

### O leitor de QR Code não lê ou a câmera está ruim
- O eleitor não precisa de QR Code.
- Basta abrir o navegador e digitar o endereço da igreja (ex.: `votacao.igreja.com.br`) ou a URL curta informada no telão/cartão (ex.: `/s/ABC123`).
- Na página inicial do Scelta, há o campo **"Entrar com código da sala"**, onde basta digitar os 6 caracteres da sala.

### No Modo "Aprovação da Mesa"
- O eleitor acessa a sala, pesquisa seu nome no rol e confirma seu dia e mês de nascimento (caso cadastrado).
- O pedido entra instantaneamente na **Fila de Aprovação** na aba **Conduzir** da mesa.
- A mesa confere a presença física da pessoa no salão e clica em **Aprovar** (ou **Aprovar Todos**).
- **Alerta de Nome Disputado**: Se outra pessoa tentar pedir entrada usando o nome de alguém que já está aprovado ou online, o painel da mesa exibe um badge de alerta vermelho: *"Tentativa disputada"*. A mesa pode identificar a pessoa no plenário, recusar o pedido indevido ou expulsar o dispositivo errado.

---

## 4. Liberar Sessão (Troca de Aparelho / Erro de Código em Uso)

Por segurança contra voto duplicado, o Scelta vincula estritamente cada código/eleitor a um único dispositivo móvel.

### Cenário:
O eleitor tentou entrar, mas a bateria do celular acabou, o navegador foi fechado acidentalmente ou ele pegou o celular do cônjuge emprestado. Ao tentar colocar o código no novo aparelho, o sistema avisa:  
> **"Este código já está em uso neste escrutínio. Se você trocou de aparelho ou fechou o navegador, procure a mesa para liberar seu acesso."**

### Passo a passo para a mesa liberar o acesso:
1. Abra a tela da sala na aba **Conduzir**.
2. No painel de **Presença / Eleitores Conectados**, localize o nome do eleitor.
3. Clique no botão **"Liberar sessão"** ao lado do nome dele.
4. O sistema encerra a conexão anterior, registra o evento seguro no log de auditoria e limpa o hash do dispositivo antigo.
5. Peça para o eleitor tentar entrar novamente no novo aparelho (lendo o cartão ou digitando o código). A entrada será autorizada imediatamente.
6. *Nota de Sigilo*: Se o eleitor já houver depositado seu voto naquele escrutínio antes de sair, o comprovante de voto permanece registrado e ele não poderá votar duas vezes na mesma rodada.

---

## 5. Lançar a Urna de Papel (Voto Híbrido)

O Scelta suporta assembleias plenamente híbridas, integrando a urna física de papel com a votação eletrônica em tempo real.

### Passo 1: Marcar quem vota no papel
- Na recepção ou na aba **Conduzir** (painel do Rol), localize os irmãos que não utilizam celular ou optaram pela cédula física.
- Ative a opção **"Vota no papel"** ao lado do nome do eleitor.
- O sistema revoga qualquer código ou sessão online dessa pessoa e contabiliza sua presença no quórum com a etiqueta `"Papel"`.

### Passo 2: Lançamento dos votos da urna física
1. Enquanto o escrutínio estiver **Aberto**, a mesa faz a contagem das cédulas físicas da urna.
2. Na aba **Conduzir**, localize o painel **"Lançamento da Urna de Papel"**.
3. Preencha os campos:
   - **Total de Cédulas Físicas Coletadas**: deve ser menor ou igual ao número de eleitores marcados para voto em papel.
   - **Votos em Branco**: contam no quórum e compõem a base da maioria absoluta.
   - **Votos Nulos**: cédulas rasuradas.
   - **Votos por Candidato**: informe a quantidade de marcas recebidas por cada candidato no papel.
   - *Validação de N Vagas*: O sistema impede erros de digitação verificando se $\text{Total de Marcas} \le N \times \text{Cédulas}$.
4. Clique em **"Salvar contagem da urna"**.
5. A contagem é consolidada atomicamente com os votos online depositados pelos celulares.

---

## 6. Encerrar Escrutínio com Pendentes

Quando a votação estiver em andamento e a mesa constatar que todos os presentes que desejavam votar já concluíram o processo:

1. Na aba **Conduzir**, clique em **"Encerrar escrutínio"**.
2. **Eleitores Online que não votaram**:
   - Se ainda houver pessoas conectadas que não confirmaram seu voto, o Scelta abre um diálogo de proteção:  
     > *"Há N eleitores com voto pendente. Deseja encerrar mesmo assim?"*
   - Ao confirmar, o sistema encerra a rodada e categoriza os ausentes como **"Não votaram: N"**.
   - Esses eleitores continuam contando para a verificação do quórum de presença, mas suas abstenções não compõem a base de votos da maioria.
3. **Trava de Urna de Papel**:
   - Se houver eleitores marcados como *"Vota no papel"*, o sistema exige que a mesa tenha lançado a urna física ou clique na confirmação explícita *"Confirmar que não houve cédulas de papel depositadas"*.
4. **Encerramento de Vagas Remanescentes**:
   - Em eleições de Oficiais com múltiplas vagas (ex.: 5 diáconos), se apenas 3 atingirem mais de 50%, a mesa pode clicar em **"Abrir próximo escrutínio (2 vagas)"** ou, se a assembleia deliberar não preencher as vagas restantes, clicar em **"Encerrar eleição com vagas em aberto"**.

---

## 7. Operação do Telão / Projetor

O modo telão foi desenvolvido para ser projetado no salão principal, mantendo total transparência visual sem jamais revelar os votos individuais de ninguém.

1. **Abrir o Telão**:
   - No computador conectado ao projetor/segunda tela, acesse o painel admin e clique no botão **"Abrir Telão"** (ou navegue diretamente para `/telao/:salaId`).
   - Pressione **F11** para colocar o navegador em tela cheia.
2. **Fases do Telão**:
   - **Antes da votação (Recepção)**: exibe o QR Code em tamanho gigante e o código da sala de 6 letras para os irmãos entrarem enquanto chegam.
   - **Durante o Escrutínio Aberto**: exibe o cargo em disputa, o total de eleitores presentes e o termômetro de participação: *"Votaram X de Y eleitores"*.
   - **Parcial por Candidato (Opcional)**: caso a mesa queira mostrar as barras parciais de votação em tempo real, ative o switch *"Mostrar parcial por candidato no telão"* na aba Conduzir. O telão atualizará instantaneamente via WebSocket.
3. **Momento da Revelação**:
   - Quando a mesa encerra o escrutínio, o telão entra no modo de suspense: *"Aguardando a mesa autorizar a revelação do resultado"*.
   - Quando o Pastor ou Presidente da mesa autorizar, clique no botão **"Revelar resultado"**.
   - O telão aciona a animação festiva de confetes e destaca o(s) candidato(s) eleito(s) em tamanho grande.

---

## 8. Plano de Contingência — Se o Sistema ou a Internet Caírem

O Scelta foi arquitetado com mecanismos de alta tolerância a falhas para garantir que nenhum voto seja perdido.

| Ocorrência | O que acontece no sistema | Ação imediata da mesa |
| --- | --- | --- |
| **Queda de Wi-Fi ou internet nos celulares dos membros** | O aplicativo no celular preserva o estado da sessão localmente em `localStorage`. | Oriente os membros a aguardarem a internet restabelecer ou usarem seus dados móveis 4G/5G. Nenhuma sessão é desconectada. |
| **Queda de energia ou reinício do computador da mesa** | Todos os dados residem no banco de dados com transações atômicas seguras. As cédulas já depositadas e comprovantes de voto estão intactos. | Ligue o computador novamente e reabra a página da sala. O escrutínio continuará no mesmo segundo em que parou. |
| **Suspeita de irregularidade ou problema no escrutínio** | O Scelta permite reiniciar o escrutínio atual sem apagar o histórico. | Clique no botão **"Reiniciar escrutínio"** na aba Conduzir. O escrutínio anterior é arquivado com status `anulado` no livro de auditoria, e uma nova votação limpa para o mesmo cargo é aberta imediatamente. |
| **Impossibilidade total de continuar no modo eletrônico** | A eleição pode transitar 100% para voto em papel. | Distribua cédulas físicas de papel para o plenário, marque os eleitores como *"Vota no papel"* e utilize o painel de lançamento da urna para apurar os votos no sistema. |
| **Auditoria Pós-Assembleia** | Toda a trilha de eventos é imutável e assinada criptograficamente por SHA-256 encadeado (`integrity_hash`). | Na aba **Resultado**, clique em **"Auditoria"** e gere o relatório completo de verificação para leitura em plenário e anexo na ata do Conselho. |