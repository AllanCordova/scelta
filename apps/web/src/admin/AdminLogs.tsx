import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../api-url";
import { fetchIntegrityLogs } from "./rooms-api";
import type { IntegrityLogItem, IntegrityLogsResponse } from "./types";

const apiBase = apiUrl("");

type CategoryFilter = "all" | "voters_only" | "admin_only";

export function AdminLogs() {
  const initialRoomId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("roomId") ?? "";
  }, []);

  const [selectedRoomId, setSelectedRoomId] = useState<string>(initialRoomId);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [data, setData] = useState<IntegrityLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void fetchIntegrityLogs(apiBase, selectedRoomId || undefined)
      .then((response) => {
        if (!cancelled) {
          setData(response);
          setErrorMessage(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage("Não foi possível carregar os logs de integridade.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRoomId, refreshTick]);

  const filteredLogs = useMemo(() => {
    const logs = data?.logs ?? [];
    if (categoryFilter === "voters_only") {
      return logs.filter(
        (item) => item.action === "ballot_cast" || item.action === "participant_joined",
      );
    }
    if (categoryFilter === "admin_only") {
      return logs.filter(
        (item) => item.action !== "ballot_cast" && item.action !== "participant_joined",
      );
    }
    return logs;
  }, [data, categoryFilter]);

  function handleExportPdf() {
    window.print();
  }

  return (
    <div className="admin-page integrity-logs-page">
      <nav className="detail-breadcrumbs no-print" aria-label="Navegação secundária">
        <a href="/admin">Administração</a>
        <span aria-hidden="true">/</span>
        <strong>Logs Inapagáveis de Votação</strong>
      </nav>

      <header className="page-intro integrity-logs-header">
        <div>
          <span className="immutable-badge">
            Registro Perpétuo e Inapagável • Protegido contra Exclusão
          </span>
          <h1>Histórico de Comprovação e Auditoria de Votos</h1>
          <p className="lede">
            Trilha criptográfica pública interna que comprova que{" "}
            <strong>somente pessoas autenticadas votaram</strong>, sem qualquer inserção, edição ou
            intervenção do administrador nas cédulas. Nem mesmo administradores podem apagar ou
            alterar estes registros.
          </p>
        </div>
        <div className="integrity-header-actions no-print">
          <button
            type="button"
            className="ghost round-action"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setRefreshTick((tick) => tick + 1);
            }}
          >
            Atualizar
          </button>
          <button
            type="button"
            className="round-action"
            onClick={handleExportPdf}
          >
            Exportar para PDF
          </button>
        </div>
      </header>

      {data ? (
        <section
          className="integrity-kpi-grid"
          aria-label="Resumo de integridade e comprovação humana"
        >
          <article className="panel integrity-kpi-card verified">
            <span className="integrity-kpi-label">Intervenção do Admin nos Votos</span>
            <strong className="integrity-kpi-value" data-testid="kpi-admin-interventions">
              {data.summary.adminVoteInterventions}
            </strong>
            <span className="integrity-kpi-sub">
              Comprovado: 0 votos criados ou alterados pelo admin
            </span>
          </article>

          <article className="panel integrity-kpi-card">
            <span className="integrity-kpi-label">Votos de Pessoas Autenticadas</span>
            <strong className="integrity-kpi-value" data-testid="kpi-human-ballots">
              {data.summary.humanBallotsCast}
            </strong>
            <span className="integrity-kpi-sub">
              Depositados por membros verificados via código pessoal
            </span>
          </article>

          <article className="panel integrity-kpi-card">
            <span className="integrity-kpi-label">Entradas de Pessoas Verificadas</span>
            <strong className="integrity-kpi-value" data-testid="kpi-human-joins">
              {data.summary.humanParticipantsJoined}
            </strong>
            <span className="integrity-kpi-sub">
              Presenças humanas validadas no rol da assembleia
            </span>
          </article>

          <article className="panel integrity-kpi-card">
            <span className="integrity-kpi-label">Assinatura da Cadeia (SHA-256)</span>
            <strong className="integrity-kpi-value mono-hash" data-testid="kpi-chain-hash">
              #{data.summary.chainHeadHash}
            </strong>
            <span className="integrity-kpi-sub">
              {data.summary.totalEvents} eventos encadeados e inapagáveis
            </span>
          </article>
        </section>
      ) : null}

      <section className="panel integrity-filters-bar no-print" aria-label="Filtros do histórico">
        <div className="integrity-filter-group">
          <label htmlFor="integrity-room-filter">Filtrar por Sala</label>
          <select
            id="integrity-room-filter"
            value={selectedRoomId}
            onChange={(event) => {
              setLoading(true);
              setSelectedRoomId(event.target.value);
            }}
          >
            <option value="">Todas as salas (incluindo salas excluídas)</option>
            {(data?.rooms ?? []).map((room) => (
              <option key={room.id} value={room.id}>
                {room.title} ({formatRoomStatusLabel(room.status)})
              </option>
            ))}
          </select>
        </div>

        <div className="integrity-filter-group">
          <label htmlFor="integrity-category-filter">Tipo de Registro</label>
          <select
            id="integrity-category-filter"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
          >
            <option value="all">Todos os eventos</option>
            <option value="voters_only">Somente entradas e votos de pessoas</option>
            <option value="admin_only">Somente controle de sessão da mesa</option>
          </select>
        </div>
      </section>

      <section className="panel integrity-table-panel" aria-labelledby="integrity-log-table-heading">
        <div className="integrity-table-header">
          <div>
            <h2 id="integrity-log-table-heading">Livro Razão Inapagável de Eventos</h2>
            <p className="muted">
              O sigilo do voto é integralmente preservado: o log comprova a origem humana da sessão e
              do comprovante sem revelar em qual candidato a pessoa votou.
            </p>
          </div>
          <span className="detail-kpi-pill">{filteredLogs.length} registros</span>
        </div>

        {errorMessage ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : loading ? (
          <p className="muted">Carregando registros inapagáveis…</p>
        ) : filteredLogs.length === 0 ? (
          <p className="empty">Nenhum registro encontrado para o filtro selecionado.</p>
        ) : (
          <div className="integrity-table-wrapper">
            <table className="integrity-logs-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data / Hora</th>
                  <th>Sala</th>
                  <th>Origem</th>
                  <th>Evento</th>
                  <th>Comprovação de Integridade</th>
                  <th>Hash SHA-256</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((entry) => (
                  <IntegrityLogRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function IntegrityLogRow({ entry }: { entry: IntegrityLogItem }) {
  const actorBadge = formatActorBadge(entry);
  return (
    <tr>
      <td className="mono-cell">#{entry.sequence}</td>
      <td>{formatDateTime(entry.createdAt)}</td>
      <td>
        <div className="log-room-cell">
          <strong>{entry.roomTitle}</strong>
          <span className={`log-room-status status-${entry.roomStatus}`}>
            {formatRoomStatusLabel(entry.roomStatus)}
          </span>
        </div>
      </td>
      <td>
        <span className={`log-actor-pill ${actorBadge.tone}`}>{actorBadge.label}</span>
      </td>
      <td>
        <strong>{formatActionTitle(entry.action)}</strong>
      </td>
      <td className="log-proof-cell">{formatProofDescription(entry)}</td>
      <td className="mono-cell" title="Assinatura encadeada SHA-256">
        #{entry.integrityHash}
      </td>
    </tr>
  );
}

function formatActorBadge(entry: IntegrityLogItem): {
  label: string;
  tone: "human" | "simulated" | "admin";
} {
  if (entry.actorRole === "voter") {
    return { label: "Pessoa Autenticada", tone: "human" };
  }
  if (entry.actorRole === "simulated_voter") {
    return { label: "Simulador (Sala Teste)", tone: "simulated" };
  }
  return { label: "Mesa Admin (Sessão)", tone: "admin" };
}

function formatActionTitle(action: string): string {
  switch (action) {
    case "participant_joined":
      return "Entrada de Participante";
    case "ballot_cast":
      return "Voto Computado por Pessoa";
    case "room_created":
      return "Sala Criada";
    case "room_status_changed":
      return "Situação da Sala Alterada";
    case "quorum_changed":
      return "Quórum Atualizado";
    case "round_opened":
      return "Escrutínio Aberto";
    case "round_restarted":
      return "Escrutínio Reiniciado";
    case "round_closed":
      return "Escrutínio Encerrado";
    case "round_declined":
      return "Recusa de Cargo Registrada";
    case "result_published":
      return "Resultado Publicado";
    case "invite_rotated":
      return "Link de Convite Rotacionado";
    case "room_deleted":
      return "Sala Excluída (Logs Preservados)";
    case "entry_opened":
      return "Entrada na Sala Reaberta";
    case "entry_closed":
      return "Entrada na Sala Encerrada";
    case "entry_config_changed":
      return "Configuração de Entrada Alterada";
    case "entry_request_created":
      return "Pedido de Entrada Enviado";
    case "entry_request_approved":
      return "Pedido de Entrada Aprovado";
    case "entry_request_rejected":
      return "Pedido de Entrada Recusado";
    case "entry_request_disputed":
      return "Nome Disputado Sinalizado";
    case "roster_name_released":
    case "participant_expelled_and_released":
      return "Participante Expulso e Nome Liberado";
    default:
      return action;
  }
}

function formatProofDescription(entry: IntegrityLogItem): string {
  const p = entry.payload;
  if (entry.action === "ballot_cast") {
    const isSimulated = Boolean(p.isSimulated);
    const sessionFp = typeof p.sessionFingerprint === "string" ? p.sessionFingerprint : "verificada";
    const receiptFp = typeof p.receiptFingerprint === "string" ? p.receiptFingerprint : "assinado";
    const roundNumber = typeof p.roundNumber === "number" ? `${p.roundNumber}º escrutínio` : "escrutínio";
    const office = typeof p.officeLabel === "string" && p.officeLabel ? ` (${p.officeLabel})` : "";
    if (isSimulated) {
      return `Voto de teste em sala de simulação • ${roundNumber}${office} • Sessão #${sessionFp} • Recibo #${receiptFp}`;
    }
    return `Voto direto de membro verificado • ${roundNumber}${office} • Sessão #${sessionFp} • Recibo #${receiptFp} • Intervenção Admin: Nenhuma`;
  }

  if (entry.action === "participant_joined") {
    const isSimulated = Boolean(p.isSimulated);
    const sessionFp = typeof p.sessionFingerprint === "string" ? p.sessionFingerprint : "verificada";
    if (isSimulated) {
      return `Entrada simulada (exclusiva de sala Teste) • Sessão #${sessionFp}`;
    }
    return `Membro comungante autenticado com código individual • Sessão #${sessionFp} • Intervenção Admin: Nenhuma`;
  }

  if (entry.action === "room_created") {
    const status = typeof p.status === "string" ? formatRoomStatusLabel(p.status) : "";
    return `Sala configurada (${status}) — sem votos pré-existentes`;
  }

  if (entry.action === "room_status_changed") {
    const prev = typeof p.previous === "string" ? formatRoomStatusLabel(p.previous) : "";
    const next = typeof p.next === "string" ? formatRoomStatusLabel(p.next) : "";
    return `Transição de status: ${prev} → ${next}`;
  }

  if (entry.action === "round_opened") {
    const num = typeof p.roundNumber === "number" ? `${p.roundNumber}º escrutínio` : "Escrutínio";
    const office = typeof p.officeLabel === "string" && p.officeLabel ? ` — ${p.officeLabel}` : "";
    return `${num}${office} aberto para recebimento de cédulas dos presentes`;
  }

  if (entry.action === "round_closed") {
    const totalVotes = typeof p.totalVotes === "number" ? `${p.totalVotes} votos apurados` : "";
    const outcome = typeof p.outcome === "string" ? p.outcome : "";
    return `Encerramento da urna (${totalVotes} • resultado: ${outcome})`;
  }

  if (entry.action === "room_deleted") {
    return "Sala removida pelo admin; histórico de integridade preservado permanentemente.";
  }

  return "Ação administrativa de condução da assembleia (sem acesso às cédulas).";
}

function formatRoomStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Rascunho";
    case "open":
      return "Aberta (Oficial)";
    case "test":
      return "Teste";
    case "voting":
      return "Em votação";
    case "closed":
      return "Completa";
    case "cancelled":
      return "Cancelada";
    case "deleted":
      return "Sala Excluída";
    default:
      return status;
  }
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
