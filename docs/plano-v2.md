# Plano v2 — Scelta pronto para votações reais (UPA, UMP e Oficiais)

> Origem: teste na eleição da UPA, sugestões dos dois devs e análise do código em 16/11/2026.
> Pré-requisito: o PR #24 ("Show voters present instead of a quorum score") é mesclado antes deste plano.
> Toda task segue as regras em `agents/` (testes unitários, de feature e e2e quando houver tela; CI local antes do push).

## Como ler

Cada task traz:

- **Dificuldade (Size)**:
  - XS: menos de 1 h.
  - S: algumas horas.
  - M: cerca de 1 dia.
  - L: 2 a 3 dias.
  - XL: mais que isso.
- **Prioridade**:
  - P0: bloqueia uma votação real.
  - P1: necessária para o uso pretendido.
  - P2: melhoria.
- **Modelo sugerido**:
  - `haiku`: consultas, docs curtas, ajustes triviais.
  - `sonnet`: implementação com escopo claro.
  - `opus`: regras de apuração, mudanças de banco que atravessam várias camadas, decisões de desenho.
- **Depende de**: tasks que precisam estar prontas antes.

As etapas são em ordem. Dentro de uma etapa, tasks sem dependência entre si podem andar em paralelo.

## Decisões tomadas

1. **Voto em papel**:
   - O admin marca a pessoa do rol como "vota no papel", e o código dela é revogado.
   - Ela continua presente para o quórum e conta na base da maioria.
   - Antes de encerrar o escrutínio, o admin lança só os **totais** da urna de papel: votos por candidato, brancos e nulos.
2. **Novo modo de entrada** (o admin escolhe por sala: *cartão com código* ou *aprovação da mesa*):
   - No modo aprovação, a sala tem QR **e** código curto logo abaixo.
   - A pessoa busca o próprio nome no rol e confirma com dia e mês de nascimento, quando cadastrados.
   - O pedido cai numa fila da mesa, que aprova ou recusa.
   - Um nome já reivindicado fica travado. A mesa pode expulsar quem entrou com o nome errado e liberar o nome para a pessoa certa.
3. **Travas de entrada**:
   - Botão "encerrar entrada" e limite de pessoas, que por padrão é o tamanho do rol.
   - A entrada não fecha sozinha ao abrir o escrutínio.
4. **Uma sessão por código**:
   - O código fica vinculado ao primeiro navegador que entrar.
   - Outro navegador ou aparelho é bloqueado com "procure a mesa".
   - A mesa pode liberar a sessão para a pessoa entrar de novo.
   - Nunca há segundo voto no mesmo escrutínio.
5. **Cartão impresso**: QR com link curto, o link curto escrito por extenso e o código pessoal em letras grandes. Para voltar, a pessoa escaneia de novo ou digita o código no site.
6. **Oficiais (presbíteros e diáconos)**:
   - Cada eleitor marca até N nomes, sendo N o número de vagas.
   - É eleito todo candidato com mais de 50% das cédulas (online + papel, brancas incluídas).
   - Quem não atingir não é eleito.
   - Se mais de N atingirem, ficam os N mais votados; empate na última vaga vai a novo escrutínio só entre os empatados.
   - A mesa pode abrir novo escrutínio para as vagas que sobraram ou encerrar com vagas em aberto.
7. **Pendentes no encerramento**: a mesa pode encerrar com pendentes, que ficam como "não votou". Contam para o quórum, mas não entram na base da maioria.
8. **Reiniciar escrutínio** anula o atual, mas mantém o registro e nunca apaga escrutínios encerrados.
9. **Rol da sala**:
   - É uma cópia do cadastro feita na criação da sala.
   - Pode ser editado a qualquer momento: remover alguém revoga o código, mas mantém um voto que a pessoa já tenha dado.
   - O total de eleitores é calculado pelo rol.
   - Mudanças no cadastro geral não alteram salas encerradas.
10. **Telão**:
    - Na entrada, mostra QR e código da sala.
    - No escrutínio, mostra o cargo, "votaram X de Y" e a apuração geral.
    - A apuração por candidato durante o escrutínio só aparece se o admin ligar a opção (padrão: oculta).
    - O resultado aparece quando a mesa clicar em "revelar".
11. **Tela da sala**: abas **Preparar / Conduzir / Resultado**.
12. **Hospedagem**: ainda em aberto (local ou nuvem gratuita). O plano só torna o endereço público configurável e documenta as duas opções.

---

## Etapa 0 — Fundação e correções críticas

Corrige falhas que hoje podem travar ou distorcer uma votação. Vem antes de tudo porque as etapas seguintes mudam o banco.

### T0.1 — Migrações versionadas do banco
- **Size:** L · **Prioridade:** P0 · **Modelo:** opus · **Depende de:** —
- **Problema:** o esquema é aplicado por um script SQL que roda em toda inicialização (`packages/db/src/schema-sql.ts`). Várias restrições só existem nesse script, não em `schema.ts`. Não existe pasta de migrações (`packages/db/drizzle` está vazia).
- **Fazer:**
  - Adotar migrações do Drizzle Kit.
  - Gerar a migração inicial equivalente ao estado atual, incluindo índices parciais e CHECKs.
  - Rodar as migrações na subida da API e nos testes com PGlite.
  - Remover `SCHEMA_SQL`.
  - Documentar como criar uma migração.
- **Aceite:**
  - Banco novo e banco existente sobem sem erro.
  - `schema.ts` e o banco batem.
  - Os testes de feature e e2e passam.

### T0.2 — Guardas na mudança de status da sala
- **Size:** M · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** T0.1
- **Problema:** `PATCH /v1/admin/rooms/:id` (`apps/api/src/routes/rooms.ts:465-552`) aceita qualquer transição. Hoje é possível reabrir sala encerrada, fechar a sala com escrutínio aberto e mudar quórum ou total de eleitores no meio de um escrutínio. Os status `voting` e `cancelled` nunca são usados.
- **Fazer:**
  - Definir a máquina de estados no domínio (`packages/domain/src/room.ts`).
  - Bloquear: transições inválidas, alteração de quórum com escrutínio aberto, e encerramento da sala com escrutínio aberto.
  - Remover ou passar a usar os status mortos.
  - Corrigir a divergência `quorumValue < 1` vs mínimo 0.
- **Aceite:** testes de domínio para cada transição; a API responde 409 com mensagem clara.

### T0.3 — Reiniciar escrutínio sem apagar histórico
- **Size:** L · **Prioridade:** P0 · **Modelo:** opus · **Depende de:** T0.1
- **Problema:** o restart (`apps/api/src/rooms/drizzle-room-repository.ts:1126-1217`) apaga cédulas, comprovantes e escrutínios anteriores e renumera a rodada. Em sala de cargos, pode furar o limite de 3 escrutínios e o desempate por idade.
- **Fazer:**
  - Novo resultado `annulled` para o escrutínio reiniciado, mantendo os totais registrados.
  - Abrir um escrutínio novo com o próximo número.
  - Nunca tocar em escrutínios já encerrados.
  - A contagem de rodadas por cargo ignora os anulados de forma explícita.
  - Registrar no log os totais anulados.
- **Aceite:**
  - Teste: reiniciar o 2º escrutínio mantém o 1º intacto.
  - Teste: em sala de cargos, a regra dos 3 escrutínios continua valendo.

### T0.4 — Encerrar escrutínio com pendentes e corrigir corrida no fechamento
- **Size:** M · **Prioridade:** P0 · **Modelo:** opus · **Depende de:** T0.1
- **Problema:** hoje o fechamento exige votos = presentes, senão dá `voting_incomplete` ou `vote_count_mismatch` (`apps/api/src/routes/rounds.ts:253-269`). Isso trava a sala. Além disso, um voto pode chegar entre a leitura da apuração e o fechamento e ficar fora do resultado.
- **Fazer:**
  - Permitir encerrar com pendentes mediante confirmação. Pendentes viram "não votou": contam no quórum, mas não entram na base da maioria.
  - Se alguém que já votou foi removido, o voto continua valendo, e isso não é erro.
  - Travar a linha do escrutínio (`SELECT ... FOR UPDATE`) tanto no voto quanto no fechamento.
  - Mostrar "não votaram: N" no resultado.
- **Aceite:**
  - Testes de feature cobrindo: encerrar com pendentes, remover alguém que votou, e corrida entre voto e fechamento.

### T0.5 — Sigilo: desacoplar horário da cédula do comprovante
- **Size:** S · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** T0.1
- **Problema:** `ballots.created_at`, `vote_receipts.cast_at` e o evento `ballot_cast` usam o mesmo `now()` da transação. Quem tem acesso ao banco liga voto a pessoa. O evento também guarda `sessionFingerprint` e `receiptFingerprint`.
- **Fazer:**
  - Remover o horário da cédula, ou gravar só o horário de abertura do escrutínio.
  - Tirar as fingerprints do evento `ballot_cast`.
  - Remover o `ballotToken`, que não é usado.
  - Documentar a garantia de sigilo em `docs/data-model.md`.
- **Aceite:** um teste garante que nenhuma coluna da cédula permite ligar o voto ao comprovante.

### T0.6 — Limite de tentativas na entrada, no voto e no chat; corrigir bloqueio do admin
- **Size:** M · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** —
- **Problema:**
  - Não há limite de tentativas em `POST /v1/join/:token`, nas rotas de cédula nem no chat.
  - Respostas diferentes para código inválido e código revogado ajudam a adivinhar códigos.
  - 8 senhas erradas travam a conta do admin por 15 min para qualquer pessoa (`apps/api/src/auth/auth-attempts.ts`).
- **Fazer:**
  - Limite por IP e por sala na entrada e no voto.
  - Resposta única para código inválido ou revogado.
  - No login do admin, limitar por IP + e-mail, e não travar a conta para todos os IPs.
- **Aceite:** testes de feature que cobrem cada limite.

### T0.7 — Autenticar o canal em tempo real e a leitura do chat
- **Size:** M · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** —
- **Problema:** qualquer cliente que saiba o UUID da sala assina presença, estado do escrutínio e chat (`apps/api/src/realtime.ts:102-111`). O `GET` do chat não exige `joinKey`.
- **Fazer:**
  - No `room:join`, o admin é validado pelo cookie e o votante pelo `joinKey` + token.
  - O `GET` do chat passa a exigir `joinKey`.
- **Aceite:** uma conexão sem credencial não recebe eventos; testes cobrem isso.

### T0.8 — Log de auditoria realmente imutável
- **Size:** M · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T0.1
- **Problema:** o hash de integridade é recalculado na leitura (`rooms.ts:1080-1085`), e `immutable: true` está fixo no código. Nada no banco impede `UPDATE` ou `DELETE` em `audit_events`.
- **Fazer:**
  - Gravar um hash encadeado na inserção.
  - Trigger que bloqueia `UPDATE` e `DELETE`.
  - Endpoint de verificação da cadeia.
- **Aceite:** um teste mostra que alterar uma linha quebra a verificação.

### T0.9 — Aliviar o polling (imagens fora da consulta de 1 s)
- **Size:** M · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** —
- **Problema:** a consulta da cédula a cada 1 s devolve fotos e banners em base64, de até 12 MB cada (`apps/api/src/routes/ballots.ts:60-154`). O painel do admin consulta a cada 2 s e é ainda mais pesado.
- **Fazer:**
  - Servir as imagens por URL própria com cache e ETag.
  - O polling devolve só a URL.
  - Reduzir as consultas por chamada.
- **Aceite:** o teste de carga (`pnpm load:assembly`) com 150 votantes e fotos fica estável; o tamanho da resposta do polling cai.

### T0.10 — Typecheck no CI
- **Size:** XS · **Prioridade:** P1 · **Modelo:** haiku · **Depende de:** —
- **Fazer:** adicionar `pnpm typecheck` ao `.github/workflows/ci.yml`.
- **Aceite:** o CI falha com erro de tipo.

### T0.11 — Limpeza de código morto e documentação desatualizada
- **Size:** XS · **Prioridade:** P2 · **Modelo:** haiku · **Depende de:** T0.1
- **Fazer:**
  - Remover a tabela e o repositório de reações, que não têm rota, ou registrar a decisão de manter.
  - Alinhar `docs/voting-rules.md` com o código: o quórum de oficiais é 34%, e não 1/3 como diz o doc; brancos contam na base.
- **Aceite:** docs e código dizem a mesma coisa.

---

## Etapa 1 — Acesso confiável (QR, cartão e sessão)

Resolve "não consegui ler o QR", "saí do navegador e não voltei" e a impressão cortada.

### T1.1 — Endereço público configurável
- **Size:** S · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** —
- **Problema:** o link do QR usa o endereço do navegador do admin (`inviteUrl()` em `apps/web/src/admin/room-draft.ts:17`). Se o admin abrir por `localhost` ou IP local, os cartões saem com um endereço inacessível.
- **Fazer:**
  - Variável `PUBLIC_URL` exposta pela API (ex.: `GET /v1/config`), usada em todo link e QR.
  - Aviso no painel quando o endereço do admin for diferente do público.
- **Aceite:** com `PUBLIC_URL` definido, o QR sai correto mesmo com o admin em `localhost`.

### T1.2 — Código curto da sala e página "Entrar com código"
- **Size:** M · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** T0.1, T1.1
- **Problema:** o código pessoal de 6 letras só funciona depois de abrir o link longo de 43 caracteres. Não há como entrar digitando.
- **Fazer:**
  - Código curto da sala (6 caracteres, sem letras ambíguas).
  - Rota `/s/:codigoSala`.
  - Página inicial pública com os campos "código da sala" e "seu código".
  - O QR do cartão passa a ser `/s/:codigoSala?c=:codigo`.
  - Rotacionar o convite não invalida o código curto, só o link longo antigo.
- **Aceite:** e2e de entrada só digitando os dois códigos; o link antigo continua funcionando até ser rotacionado.

### T1.3 — QR legível no cartão
- **Size:** S · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** T1.2
- **Problema:** o QR é gerado com 120 px e exibido com 104 px (`apps/web/src/admin/AdminAccessCodes.tsx:92,225`), fica borrado, com margem 1, correção padrão e mais de 100 caracteres de conteúdo.
- **Fazer:**
  - Conteúdo curto.
  - Correção de erro Q.
  - Margem de 4 módulos.
  - Gerar em SVG ou em tamanho inteiro, com pelo menos 3 cm impresso.
- **Aceite:** teste manual com 3 celulares (Android, iPhone, um modelo antigo) lendo o cartão impresso.

### T1.4 — Impressão de cartões sem aviso por cima e sem QR cortado
- **Size:** S · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** T1.2
- **Problema:** o `<Toaster>` (`apps/web/src/App.tsx:9`) não é escondido na impressão. Os cartões em grade quebram entre páginas (`apps/web/src/styles.css:1707-1801`).
- **Fazer:**
  - Esconder `[data-sonner-toaster]` em `@media print`.
  - Paginar explicitamente: N cartões por folha A4, cada folha em um bloco com `break-after: page`.
  - Cartão com: nome, QR, link curto por extenso e código pessoal grande.
  - Aplicar o mesmo cuidado ao `ShareBoardPaper`.
- **Aceite:** imprimir 37 cartões em PDF não corta nenhum QR nem mostra aviso.

### T1.5 — Uma sessão por código, com liberação pela mesa
- **Size:** M · **Prioridade:** P0 · **Modelo:** opus · **Depende de:** T0.6
- **Problema:**
  - Hoje outra entrada com o mesmo código derruba silenciosamente a anterior (`drizzle-room-repository.ts:437-447`).
  - Uma falha de rede na entrada automática apaga o código salvo (`apps/web/src/join/JoinRoom.tsx:137`).
  - O `?code=` fica na barra de endereço.
- **Fazer:**
  - O código fica vinculado à primeira sessão. Outra sessão recebe "Este código já está em uso. Procure a mesa".
  - Ação da mesa "liberar sessão", que desvincula, registra no log e deixa a pessoa entrar de novo.
  - Não apagar a identidade salva em erro transitório; tentar de novo com espera crescente.
  - Remover `?c=` da URL após entrar (`history.replaceState`).
  - Nenhum caminho permite segundo voto no mesmo escrutínio.
- **Aceite:** testes de feature para: segunda sessão bloqueada, liberação, reentrada no mesmo navegador e falha de rede.

### T1.6 — Aviso para abrir no navegador
- **Size:** S · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T1.5
- **Problema:** com uma sessão por código, quem entra pelo navegador embutido da câmera ou do WhatsApp e depois troca de navegador fica bloqueado.
- **Fazer:**
  - Detectar navegador embutido (WhatsApp, Instagram, câmera) antes de vincular o código.
  - Pedir para abrir no Chrome ou Safari, com botão de copiar o link.
- **Aceite:** teste unitário da detecção; e2e simulando o user agent.

---

## Etapa 2 — Rol da sala

Resolve "não consegui adicionar ou remover pessoas depois de criar a sala".

### T2.1 — Rol próprio da sala
- **Size:** L · **Prioridade:** P0 · **Modelo:** opus · **Depende de:** T0.1
- **Problema:**
  - A sala não tem lista própria: os códigos são gerados do cadastro geral.
  - O total de eleitores (`eligible_count`) é digitado à mão.
  - Excluir um membro não revoga o código dele (`drizzle-room-repository.ts:1685-1709`).
- **Fazer:**
  - Tabela `room_roster` com uma cópia do membro na criação da sala: nome, foto, data de nascimento e elegibilidade.
  - Códigos e participantes ligados ao rol.
  - Total de eleitores calculado pelo rol (fim do campo manual).
  - Migração dos dados existentes.
- **Aceite:** o quórum percentual usa o rol; uma sala antiga migra sem perder dados.

### T2.2 — Adicionar e remover pessoas do rol com a sala criada
- **Size:** M · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** T2.1
- **Fazer:**
  - Na aba Preparar ou Conduzir: adicionar do cadastro, adicionar avulso e remover.
  - Remover revoga o código, tira a pessoa da presença e mantém o voto já dado.
  - Adicionar gera o código e permite imprimir só o cartão novo.
  - Tudo registrado no log.
- **Aceite:** e2e: remover um membro com a sala aberta, adicionar outro, imprimir só o cartão novo.

### T2.3 — Cadastro geral não altera salas encerradas
- **Size:** M · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T2.1
- **Problema:**
  - Editar um membro reescreve nome e foto de candidatos em todas as salas, inclusive encerradas (`drizzle-room-repository.ts:1654-1683`).
  - Mudar a data de nascimento muda desempates passados.
- **Fazer:**
  - Exclusão lógica de membro.
  - Ao excluir, revogar os códigos em salas abertas.
  - Candidatos e rol usam a cópia; a atualização só se propaga para salas que ainda não abriram escrutínio.
- **Aceite:** testes de feature cobrem editar e excluir com salas abertas e encerradas.

### T2.4 — Gerenciar candidatos antes do 1º escrutínio do cargo
- **Size:** S · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T2.1
- **Fazer:** adicionar e remover candidatos de um cargo enquanto ele não teve escrutínio; depois disso, bloquear.
- **Aceite:** testes de feature e da tela.

---

## Etapa 3 — Voto em papel

### T3.1 — Marcar votante como "vota no papel"
- **Size:** M · **Prioridade:** P0 · **Modelo:** sonnet · **Depende de:** T2.1, T0.4
- **Fazer:**
  - Ação no rol: "vota no papel" e desfazer.
  - Revoga o código e expulsa a sessão.
  - A pessoa sai dos pendentes online, mas conta como presente para o quórum.
  - Contador "papel: N" nos painéis.
  - Registrado no log.
- **Aceite:** com pessoas no papel, o escrutínio não mostra essas pessoas como pendentes.

### T3.2 — Lançar os totais da urna de papel
- **Size:** L · **Prioridade:** P0 · **Modelo:** opus · **Depende de:** T3.1
- **Fazer:**
  - Com o escrutínio aberto e antes de encerrar, formulário com votos por candidato, brancos, nulos e número de cédulas de papel.
  - Validar que cédulas ≤ votantes no papel, e que a soma das marcações cabe nas cédulas.
  - A apuração soma online + papel.
  - Editável até o encerramento, com cada alteração no log.
  - Se houver votantes no papel, o encerramento exige o lançamento (ou a confirmação explícita de "nenhuma cédula").
- **Aceite:** testes de domínio da soma e da validação; e2e de escrutínio com votos online e no papel.

### T3.3 — Resultado com origem dos votos
- **Size:** S · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T3.2
- **Fazer:** resultado, telão e compartilhamento mostram total, online e papel; o log mostra quem lançou e quando.
- **Aceite:** teste da tela.

---

## Etapa 4 — Entrada por aprovação da mesa

### T4.1 — Configuração do modo de entrada da sala
- **Size:** S · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T2.1
- **Fazer:**
  - Na sala: `entryMode` (`codigo` | `aprovacao`), entrada aberta/fechada e limite de pessoas (padrão: tamanho do rol).
  - Botão "encerrar entrada" e "reabrir".
- **Aceite:** testes de domínio e da API.

### T4.2 — Fluxo do votante: buscar nome e pedir entrada
- **Size:** L · **Prioridade:** P1 · **Modelo:** opus · **Depende de:** T4.1, T1.2, T1.5
- **Fazer:**
  - Pelo código ou QR da sala, a pessoa busca o nome no rol.
  - Confirma dia e mês de nascimento, se cadastrados.
  - O pedido fica "aguardando a mesa".
  - Nome já reivindicado fica bloqueado; uma nova tentativa é recusada e sinalizada para a mesa.
  - Aprovada, a sessão segue as regras de T1.5.
  - Limite de tentativas na busca e na confirmação.
- **Aceite:** e2e: pedir, aprovar e votar; segunda tentativa no mesmo nome sinalizada.

### T4.3 — Fila de aprovação da mesa
- **Size:** M · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T4.2
- **Fazer:**
  - Painel na aba Conduzir com os pedidos em tempo real.
  - Ações: aprovar, recusar, aprovar todos, expulsar e liberar o nome para nova entrada.
  - Alertas de nome disputado.
  - Tudo no log.
- **Aceite:** e2e: alguém entra com o nome errado, a mesa expulsa e a pessoa certa entra.

---

## Etapa 5 — Eleição de Oficiais (votar em até N nomes)

### T5.1 — Regras de domínio para N vagas
- **Size:** L · **Prioridade:** P1 · **Modelo:** opus · **Depende de:** T0.4
- **Fazer:** em `packages/domain`:
  - Cédula com até N marcas, sem marcar o mesmo candidato duas vezes.
  - Base da maioria = cédulas (online + papel, incluindo brancas).
  - É eleito quem tiver mais de 50% da base.
  - Se mais de N passarem, ficam os N mais votados; empate na última vaga vai a novo escrutínio entre os empatados.
  - Plano do próximo escrutínio: vagas restantes e só candidatos não eleitos.
  - A mesa pode encerrar com vagas em aberto.
- **Aceite:** testes de domínio com casos de 5 vagas: todos eleitos, 4 de 5 eleitos, mais de N com maioria e empate na última vaga.

### T5.2 — Banco e API para cédula com várias marcas
- **Size:** L · **Prioridade:** P1 · **Modelo:** opus · **Depende de:** T5.1, T0.5
- **Fazer:**
  - Tabela de marcas ligada à cédula, mantendo o sigilo de T0.5.
  - Número de vagas por escrutínio.
  - Apuração e escrutínios seguintes usando T5.1.
  - Salas UPA e UMP continuam com 1 vaga por cargo.
- **Aceite:** testes de feature de uma eleição de diáconos com 3 escrutínios.

### T5.3 — Cédula com múltipla escolha na tela do votante
- **Size:** M · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T5.2
- **Fazer:**
  - Selecionar até N nomes, com contador "3 de 5" e opção em branco.
  - Revisão antes de confirmar.
  - Acessível em celular pequeno.
- **Aceite:** e2e votando em N, em menos de N e em branco.

### T5.4 — Lançamento do papel para N vagas
- **Size:** S · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T5.2, T3.2
- **Fazer:** o formulário de papel aceita marcações por candidato e o número de cédulas, validando marcações ≤ N × cédulas.
- **Aceite:** testes de domínio e e2e.

---

## Etapa 6 — Tela da sala e modo telão

### T6.1 — Dividir a tela da sala em abas Preparar / Conduzir / Resultado
- **Size:** L · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T2.2, T3.1
- **Problema:** `apps/web/src/admin/AdminRoomDetail.tsx` tem 1.529 linhas, cerca de 12 blocos e 25 botões na mesma página, o convite em 3 lugares e contagens duplicadas.
- **Fazer:**
  - Quebrar em componentes por aba:
    - **Preparar**: regimento, banners, rol, convite/QR/cartões, modo de entrada e simulador.
    - **Conduzir**: controle do escrutínio, contadores, fila de aprovação, presença, papel e chat.
    - **Resultado**: apuração, desempate, compartilhar e auditoria.
  - A aba inicial segue o estado da sala.
  - O convite aparece em um só lugar.
  - Remover o painel "Fluxo de Presença", que duplica os KPIs.
- **Aceite:** testes atuais adaptados; nenhum arquivo de tela acima de cerca de 400 linhas.

### T6.2 — Modo telão
- **Size:** L · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T1.2, T6.1
- **Fazer:**
  - Rota `/telao/:salaId`, só para admin, aberta em outra janela e em tela cheia.
  - **Entrada:** QR grande e código da sala.
  - **Escrutínio:** cargo, "votaram X de Y" e apuração geral (cédulas, brancos, nulos).
  - **Resultado:** só após "revelar".
  - Tempo real. Nunca mostra quem votou nem em quem.
- **Aceite:** e2e: o telão acompanha a abertura, a votação e a revelação.

### T6.3 — Opção de mostrar apuração por candidato durante o escrutínio
- **Size:** S · **Prioridade:** P2 · **Modelo:** sonnet · **Depende de:** T6.2
- **Fazer:** opção na sala ("mostrar parcial por candidato no telão"), desligada por padrão, que pode ser alterada durante o escrutínio, com registro no log.
- **Aceite:** teste da tela.

---

## Etapa 7 — Qualidade e ensaio geral

### T7.1 — E2E de assembleia completa
- **Size:** M · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** Etapas 1 a 6
- **Fazer:**
  - Cenário UPA: cartões, uma pessoa no papel, remoção de membro e desempate.
  - Cenário Oficiais: aprovação da mesa, 5 vagas e um segundo escrutínio.
- **Aceite:** os dois cenários rodam no CI.

### T7.2 — Teste de carga realista
- **Size:** S · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T0.9, T5.2
- **Fazer:** estender `pnpm load:assembly` para 200 votantes, com fotos, papel e N vagas, medindo o tempo de resposta.
- **Aceite:** relatório com limites aceitáveis documentado em `docs/`.

### T7.3 — Guia da mesa para o dia da votação
- **Size:** S · **Prioridade:** P1 · **Modelo:** sonnet · **Depende de:** T7.1
- **Fazer:** `docs/guia-da-mesa.md` em português:
  - Preparação.
  - Impressão dos cartões.
  - Como ajudar quem não entra.
  - Liberar sessão.
  - Lançar o papel.
  - Encerrar com pendentes.
  - Telão.
  - O que fazer se o sistema cair.
- **Aceite:** revisão pelos dois devs.

### T7.4 — Hospedagem e backup
- **Size:** S · **Prioridade:** P2 · **Modelo:** sonnet · **Depende de:** T1.1
- **Fazer:** documentar e testar duas opções, uma máquina local com túnel e uma nuvem gratuita, cada uma com:
  - `PUBLIC_URL`.
  - Backup e restauração do Postgres antes e depois da votação.
  - Checklist de véspera.
- **Aceite:** passo a passo testado do zero.

---

## Resumo

| Etapa | Tasks | Foco |
|---|---|---|
| 0 | T0.1–T0.11 | Correções críticas e fundação |
| 1 | T1.1–T1.6 | QR, cartão, sessão |
| 2 | T2.1–T2.4 | Rol da sala |
| 3 | T3.1–T3.3 | Voto em papel |
| 4 | T4.1–T4.3 | Entrada por aprovação |
| 5 | T5.1–T5.4 | Oficiais com N vagas |
| 6 | T6.1–T6.3 | Tela da sala e telão |
| 7 | T7.1–T7.4 | Ensaio, carga, guia e hospedagem |

Modelos: `opus` para T0.1, T0.3, T0.4, T1.5, T2.1, T3.2, T4.2, T5.1 e T5.2; `haiku` para T0.10 e T0.11; `sonnet` para as demais.
