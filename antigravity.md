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

3. **Rodada Obrigatória de Revisão pós-implementação**:
   - Ao concluir a implementação das tasks de uma etapa:
     - Rodar verificação independente com `gemini-4-hydrogen-high` / `gemini-4-hydrogen-medium` cobrindo **Código/Padrões** (`agents/code-standards.md`), **Segurança/Sigilo do Voto** (`agents/security.md`) e **Testes** (`agents/testing.md`).
     - Executar a bateria de validação (`build`, `typecheck`, `lint`, `test`, `test:feature`, `test:e2e`).
     - Corrigir qualquer apontamento antes de dar a etapa como concluída.

4. **Atualização do Quadro Kanban (GitHub Projects + Docs)**:
   - Atualizar o quadro Kanban do GitHub Projects (`https://github.com/users/AllanCordova/projects/8/views/1`) e manter [`docs/backlog.md`](docs/backlog.md) e [`docs/plano-v2.md`](docs/plano-v2.md) sincronizados com o que foi implementado na etapa.
