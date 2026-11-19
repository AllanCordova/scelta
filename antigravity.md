# Antigravity Rules — Scelta (`antigravity.md`)

> See also [`AGENTS.md`](AGENTS.md) (automatically loaded by Antigravity) and [`agents/README.md`](agents/README.md).

## Regras de Orquestração e Execução (Antigravity)

1. **Orquestrador Exclusivo (`Gemini 4 Argon`)**:
   - O **Gemini 4 Argon** atua **exclusivamente como orquestrador e planejador** (`coordinator`).
   - **Regra Estrita**: **NUNCA** instancie outro agente `Argon` para implementar código. O Argon sempre planeja, quebra o escopo e distribui as tarefas para agentes **Hydrogen** e **Flash**.

2. **Seleção de Modelos por Tipo de Tarefa**:
   - **Implementação de Tarefas Médias e Complexas + Revisões (`Gemini 4 Hydrogen`)**:
     - Modelos: `gemini-4-hydrogen-medium` (tarefas médias) e `gemini-4-hydrogen-high` (tarefas mais densas de banco/domínio/apuração e revisão com contexto limpo).
     - Escopo: Implementação de migrações, regras de domínio, rotas da API, guardas de estado, componentes React, rate-limiting, auditoria encadeada e agentes de revisão (Code Review, Security Review, Test Review).
   - **Tarefas Fáceis / Consultas / Edições Simples / Kanban (`Gemini 3.8 Flash`)**:
     - Modelos: `gemini-3.8-flash-medium` / `gemini-3.8-flash-low` (e `Model: "flash"` em subagentes).
     - Escopo: Consultas rápidas no código, ajustes de CI (`T0.10`), limpeza de código morto e docs (`T0.11`), navegação web e atualização do quadro Kanban.

3. **Rodada Obrigatória de Revisão e Testes Playwright pós-implementação**:
   - **Novos testes E2E (Playwright)**: Toda nova funcionalidade visível ao usuário deve vir acompanhada de novos testes E2E em `apps/web/e2e/*.spec.ts` cobrindo o fluxo completo.
   - Ao concluir a implementação das tasks de uma etapa:
     - Rodar verificação independente com `gemini-4-hydrogen-high` / `gemini-4-hydrogen-medium` cobrindo **Código/Padrões** (`agents/code-standards.md`), **Segurança/Sigilo do Voto** (`agents/security.md`) e **Testes** (`agents/testing.md`).
     - Executar **obrigatoriamente** toda a bateria de validação local, incluindo a suíte completa do **Playwright** (`pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:feature` e `pnpm test:e2e`), validando tanto os novos cenários quanto a ausência de regressões.
     - Corrigir qualquer apontamento ou falha de teste antes de dar a etapa como concluída.

4. **Atualização Obrigatória do Quadro Kanban após cada Etapa (GitHub Projects + Docs)**:
   - **Regra obrigatória pós-etapa**: Assim que a implementação, a rodada de revisão e os testes da etapa passarem, **atualizar imediatamente**:
     1. O quadro Kanban local em [`docs/backlog.md`](docs/backlog.md) e [`docs/plano-v2.md`](docs/plano-v2.md).
     2. O quadro Kanban do GitHub Projects (`https://github.com/users/AllanCordova/projects/8/views/1`), movendo as tasks da etapa para `Done`.
   - **Sem navegador para GitHub**: **NÃO** abrir o GitHub pelo navegador para consultar ou atualizar o quadro. Usar sempre o **MCP do GitHub** ou o **`gh` CLI**; caso nenhum dos dois esteja disponível/autenticado no ambiente, avisar o usuário.
