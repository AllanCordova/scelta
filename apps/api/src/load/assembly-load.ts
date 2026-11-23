/**
 * Simulates a realistic assembly: up to 200 voters hit the API concurrently,
 * with candidate photos, paper voters, and multi-vacancy (N=5) ballots.
 *
 * Checks that every online voter can join, load photos, cast up to N marks,
 * and see the exact same screen in início, voto, and resultado (combined online + paper).
 *
 *   pnpm --filter @scelta/api load:assembly
 *   pnpm --filter @scelta/api load:assembly -- --users=200 --vacancies=5 --paper=10
 *
 * Uses an isolated PGlite database. It does not touch the running server.
 */
process.env.SCELTA_DB = "pglite";
process.env.SCELTA_LOG = "silent";
process.env.NODE_ENV = "development";
process.env.ADMIN_EMAIL = "load-admin@scelta.test";
process.env.ADMIN_PASSWORD = "load-admin-password";
process.env.ADMIN_NAME = "Mesa de carga";
process.env.CHURCH_NAME = "Igreja da carga";
process.env.CORS_ORIGIN = "http://127.0.0.1";
delete process.env.DATABASE_URL;

type BallotBody = {
  roomStatus?: string;
  viewerAccess?: string;
  candidates?: Array<{ id: string; displayName: string; photoUrl?: string | null }>;
  round?: {
    id: string;
    status: string;
    outcome: string | null;
    vacancies?: number;
    tally?: {
      outcome: string;
      winnerName: string | null;
      winnerIds?: string[];
      totalVotes: number;
      standings: Array<{ displayName: string; votes: number }>;
    };
  } | null;
};

type Screen =
  | { phase: "início"; roomStatus: string; roundStatus: string | null }
  | { phase: "voto"; roundId: string; candidates: string }
  | { phase: "resultado"; roundId: string; outcome: string; winner: string; tally: string }
  | { phase: "encerrada"; roomStatus: string }
  | { phase: "removido"; access: string }
  | { phase: "desconhecida" };

type Voter = {
  name: string;
  code: string;
  joinKey: string;
};

type Sample = {
  ok: boolean;
  ms: number;
  status: number;
  bytes?: number;
  error?: string;
};

type LoadConfig = {
  users: number;
  vacancies: number;
  paperVoters: number;
  withPhotos: boolean;
};

const POLL_WAVES = 5;
const CANDIDATE_NAMES = [
  "Diác. Abraão Silva",
  "Diác. Barnabé Souza",
  "Diác. Calebe Oliveira",
  "Diác. Daniel Santos",
  "Diác. Estêvão Pereira",
  "Diác. Filipe Costa",
  "Diác. Gideão Lima",
  "Diác. Henrique Rocha",
];

// Minimal valid 1x1 PNG padded with harmless trailing metadata (~4 KB) to exercise real photo serving.
const SAMPLE_PHOTO_DATA_URL = buildSamplePngDataUrl(4096);

async function main() {
  const config = readConfig(process.argv.slice(2));
  const onlineTarget = config.users - config.paperVoters;
  const started = performance.now();
  const server = await startServer();
  const problems: string[] = [];
  const samples: Record<string, Sample[]> = {
    entrar: [],
    início: [],
    fotos: [],
    voto: [],
    cédula: [],
    papel: [],
    resultado: [],
  };

  try {
    const cookie = await login(server.baseUrl);
    const room = await createAssembly(server.baseUrl, cookie, config);
    const voters = await loadOnlineVoters(server.baseUrl, cookie, room.id, onlineTarget);

    const joined = await wave(voters, (voter) => joinRoom(server.baseUrl, room.token, voter));
    samples.entrar = joined;
    const presentOnline = joined.filter((item) => item.ok).length;
    if (presentOnline !== onlineTarget) {
      const reasons = countBy(
        joined.filter((item) => !item.ok).map((item) => item.error ?? `http ${item.status}`),
      );
      problems.push(
        `Entrada: ${presentOnline} de ${onlineTarget} conseguiram entrar (${formatCounts(reasons)}).`,
      );
    }

    const presence = await readPresence(server.baseUrl, cookie, room.id);
    if (presence !== config.users) {
      problems.push(
        `Depois da entrada a sala tinha ${presence ?? "?"} presentes (online + papel), e não ${config.users}.`,
      );
    }

    const startScreens = await pollPhase(server.baseUrl, room.token, voters, samples.início!);
    problems.push(...expectPhase(startScreens, "início", "início"));

    const opened = await openRound(server.baseUrl, cookie, room.id);
    if (!opened.ok) {
      problems.push(`Não foi possível abrir o escrutínio: ${opened.error}`);
    } else {
      const voteScreens = await pollPhase(server.baseUrl, room.token, voters, samples.voto!);
      problems.push(...expectPhase(voteScreens, "voto", "voto"));

      const candidateDetails = await listCandidates(server.baseUrl, room.token, voters[0]!);
      if (candidateDetails.length === 0) {
        problems.push("A cédula aberta não trouxe candidatos.");
      }

      if (config.withPhotos) {
        const photoUrls = candidateDetails
          .map((c) => c.photoUrl)
          .filter((url): url is string => typeof url === "string" && url.length > 0);
        if (photoUrls.length === 0) {
          problems.push("Nenhum candidato retornou photoUrl na cédula.");
        } else {
          // Every online voter fetches candidate photos concurrently (1 photo per voter spread across all candidates)
          samples.fotos = await wave(voters, (_voter, index) =>
            fetchPhoto(server.baseUrl, photoUrls[index % photoUrls.length]!),
          );
          const photoOk = samples.fotos.filter((s) => s.ok).length;
          if (photoOk !== onlineTarget) {
            problems.push(`Fotos: ${photoOk} de ${onlineTarget} requisições tiveram sucesso.`);
          }
        }
      }

      const candidateIds = candidateDetails.map((c) => c.id);
      const cast = await wave(voters, (voter, index) => {
        const picks = pickBallotMarks(candidateIds, config.vacancies, index);
        return castVote(server.baseUrl, room.token, voter, picks);
      });
      samples.cédula = cast;
      const accepted = cast.filter((item) => item.ok).length;
      if (accepted !== onlineTarget) {
        const reasons = countBy(
          cast.filter((item) => !item.ok).map((item) => item.error ?? `http ${item.status}`),
        );
        problems.push(
          `Votos aceitos: ${accepted} de ${onlineTarget}. Falhas: ${formatCounts(reasons)}.`,
        );
      }

      if (config.paperVoters > 0) {
        const paperSample = await submitPaperTally(
          server.baseUrl,
          cookie,
          room.id,
          opened.roundId,
          config.paperVoters,
          config.vacancies,
          candidateIds,
        );
        samples.papel = [paperSample];
        if (!paperSample.ok) {
          problems.push(`Urna de papel falhou: ${paperSample.error ?? paperSample.status}`);
        }
      }

      const stillVoting = await pollPhase(server.baseUrl, room.token, voters, samples.voto!);
      problems.push(...expectPhase(stillVoting, "voto", "voto durante a apuração"));

      const closed = await closeRound(server.baseUrl, cookie, room.id, opened.roundId);
      if (!closed.ok) {
        problems.push(`Não foi possível encerrar o escrutínio: ${closed.error}`);
      } else {
        await revealRound(server.baseUrl, cookie, room.id, opened.roundId);
        const resultScreens = await pollPhase(
          server.baseUrl,
          room.token,
          voters,
          samples.resultado!,
        );
        problems.push(...expectPhase(resultScreens, "resultado", "resultado"));
        const expectedVotes = accepted + config.paperVoters;
        const seenVotes = resultScreens.find((item) => item.screen.phase === "resultado");
        if (
          seenVotes?.screen.phase === "resultado" &&
          !seenVotes.screen.tally.includes(`total=${expectedVotes}`)
        ) {
          problems.push(
            `O resultado não mostra ${expectedVotes} votos. Tela: ${seenVotes.screen.tally}.`,
          );
        }
      }
    }
  } finally {
    await server.close();
  }

  const elapsed = Math.round(performance.now() - started);
  printReport(config, elapsed, samples, problems);
  if (problems.length > 0) {
    process.exitCode = 1;
  }
}

function readConfig(argv: string[]): LoadConfig {
  const usersRaw = readArg(argv, "--users=") ?? process.env.LOAD_USERS ?? "200";
  const vacanciesRaw = readArg(argv, "--vacancies=") ?? process.env.LOAD_VACANCIES ?? "5";
  const paperRaw = readArg(argv, "--paper=") ?? process.env.LOAD_PAPER ?? "10";
  const photosRaw = readArg(argv, "--photos=") ?? process.env.LOAD_PHOTOS ?? "true";

  const users = Number(usersRaw);
  if (!Number.isInteger(users) || users < 2 || users > 250) {
    throw new Error("Informe --users com um inteiro entre 2 e 250.");
  }
  const vacancies = Number(vacanciesRaw);
  if (!Number.isInteger(vacancies) || vacancies < 1 || vacancies > 50) {
    throw new Error("Informe --vacancies com um inteiro entre 1 e 50.");
  }
  const requestedPaper = Number(paperRaw);
  if (!Number.isInteger(requestedPaper) || requestedPaper < 0) {
    throw new Error("Informe --paper com um inteiro >= 0.");
  }
  const paperVoters = Math.min(requestedPaper, Math.max(0, users - 2));
  const withPhotos = photosRaw !== "false";

  return { users, vacancies, paperVoters, withPhotos };
}

function readArg(argv: string[], prefix: string): string | undefined {
  const match = argv.find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function pickBallotMarks(candidateIds: string[], vacancies: number, voterIndex: number): string[] {
  if (candidateIds.length === 0) {
    return [];
  }
  // 5% blank votes, 15% partial (< N) votes, 80% full N marks — realistic officer ballot mix
  if (voterIndex % 20 === 0) {
    return [];
  }
  const markCount =
    voterIndex % 7 === 0
      ? Math.max(1, Math.min(candidateIds.length, Math.floor(vacancies / 2) || 1))
      : Math.min(candidateIds.length, vacancies);

  const selected: string[] = [];
  for (let offset = 0; offset < markCount; offset += 1) {
    const idx = (voterIndex + offset) % candidateIds.length;
    selected.push(candidateIds[idx]!);
  }
  return selected;
}

async function startServer() {
  const [
    { createPgliteDatabase },
    { buildApp },
    { createDrizzleRoomRepository },
    { createDrizzleUserRepository },
    { ensureBootstrapAdmin },
  ] = await Promise.all([
    import("@scelta/db"),
    import("../app.js"),
    import("../rooms/drizzle-room-repository.js"),
    import("../users/drizzle-user-repository.js"),
    import("../users/bootstrap-admin.js"),
  ]);

  const database = await createPgliteDatabase();
  const churchName = process.env.CHURCH_NAME ?? "Igreja da carga";
  const roomRepository = createDrizzleRoomRepository(database.db, churchName);
  const userRepository = createDrizzleUserRepository(database.db, churchName);
  await ensureBootstrapAdmin(userRepository, {
    name: process.env.ADMIN_NAME ?? "Mesa de carga",
    email: process.env.ADMIN_EMAIL ?? "load-admin@scelta.test",
    password: process.env.ADMIN_PASSWORD ?? "load-admin-password",
  });
  const app = await buildApp({ roomRepository, userRepository });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Não foi possível abrir a porta da API de carga.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  if (!response.ok) {
    throw new Error(`Login da mesa falhou (${response.status}).`);
  }
  const header = response.headers.get("set-cookie") ?? "";
  const match = /scelta_session=([^;]+)/.exec(header);
  if (!match?.[1]) {
    throw new Error("Login da mesa não devolveu sessão.");
  }
  return `scelta_session=${match[1]}`;
}

async function createAssembly(baseUrl: string, cookie: string, config: LoadConfig) {
  for (let i = 0; i < CANDIDATE_NAMES.length; i += 1) {
    const createdMember = await fetch(`${baseUrl}/v1/admin/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        fullName: CANDIDATE_NAMES[i],
        isCommunicant: true,
        isMale: true,
        birthDate: `1980-01-${String(i + 10).padStart(2, "0")}`,
        photoUrl: config.withPhotos ? SAMPLE_PHOTO_DATA_URL : null,
      }),
    });
    if (!createdMember.ok) {
      throw new Error(`Cadastro de candidato falhou (${createdMember.status}).`);
    }
  }

  const remainingVoters = Math.max(0, config.users - CANDIDATE_NAMES.length);
  if (remainingVoters > 0) {
    const lines = ["nome,comungante,sexo,data_nascimento"];
    for (let index = 1; index <= remainingVoters; index += 1) {
      lines.push(`Votante ${String(index).padStart(3, "0")},sim,M,1990-01-01`);
    }

    const imported = await fetch(`${baseUrl}/v1/admin/members/import`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ csv: lines.join("\n") }),
    });
    const importedBody = (await imported.json()) as {
      report?: { rejectedCount?: number };
      error?: string;
    };
    const rejectedCount = importedBody.report?.rejectedCount ?? 0;
    if (!imported.ok || rejectedCount > 0) {
      throw new Error(
        `Importação do rol falhou (${imported.status}, rejeitados=${rejectedCount}).`,
      );
    }
  }

  const created = await fetch(`${baseUrl}/v1/admin/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: `Carga ${config.users} votantes (${config.vacancies} vagas)`,
      roomType: "deacon",
      rulesPreset: "ipb_local_officers",
      status: "open",
      vacancies: config.vacancies,
      quorumValue: 34,
      quorumUnit: "percent",
      candidates: CANDIDATE_NAMES,
    }),
  });
  const createdBody = (await created.json()) as {
    room?: { id: string; inviteToken: string };
    error?: string;
  };
  if (!created.ok || !createdBody.room) {
    throw new Error(`Criação da sala falhou (${created.status} ${createdBody.error ?? ""}).`);
  }

  if (config.paperVoters > 0) {
    const rosterRes = await fetch(`${baseUrl}/v1/admin/rooms/${createdBody.room.id}/roster`, {
      headers: { cookie },
    });
    const rosterBody = (await rosterRes.json()) as { entries?: Array<{ id: string }> };
    const paperTargets = (rosterBody.entries ?? []).slice(0, config.paperVoters);
    for (const entry of paperTargets) {
      const marked = await fetch(
        `${baseUrl}/v1/admin/rooms/${createdBody.room.id}/roster/${entry.id}/paper-mode`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ votesOnPaper: true }),
        },
      );
      if (!marked.ok) {
        throw new Error(`Falha ao marcar eleitor em papel (${marked.status}).`);
      }
    }
  }

  return { id: createdBody.room.id, token: createdBody.room.inviteToken };
}

async function loadOnlineVoters(
  baseUrl: string,
  cookie: string,
  roomId: string,
  onlineCount: number,
): Promise<Voter[]> {
  const response = await fetch(`${baseUrl}/v1/admin/rooms/${roomId}/access-codes/generate`, {
    method: "POST",
    headers: { cookie },
  });
  const body = (await response.json()) as {
    accessCodes?: Array<{ displayName: string; code: string; revokedAt: string | null }>;
  };
  if (!response.ok || !body.accessCodes) {
    throw new Error(`Geração dos códigos falhou (${response.status}).`);
  }
  const active = body.accessCodes.filter((item) => item.revokedAt === null);
  if (active.length < onlineCount) {
    throw new Error(`Só ${active.length} códigos ativos para ${onlineCount} votantes online.`);
  }
  return active.slice(0, onlineCount).map((item, index) => ({
    name: item.displayName,
    code: item.code,
    joinKey: `load-key-${String(index + 1).padStart(4, "0")}-stable`,
  }));
}

async function joinRoom(baseUrl: string, token: string, voter: Voter): Promise<Sample> {
  const timed = await time(async () => {
    const response = await fetch(`${baseUrl}/v1/join/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: voter.code, joinKey: voter.joinKey }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const body = safeJsonParse(text) as { error?: string };
    return { ok: response.ok, status: response.status, bytes: text.length, error: body.error };
  });
  if (!timed.value) {
    return { ok: false, ms: timed.ms, status: 0, error: "sem resposta" };
  }
  return sampleOf(timed.ms, timed.value.ok, timed.value.status, timed.value.error, timed.value.bytes);
}

async function readPresence(baseUrl: string, cookie: string, roomId: string): Promise<number | null> {
  const response = await fetch(`${baseUrl}/v1/admin/rooms/${roomId}/presence`, {
    headers: { cookie },
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { presentCount?: number };
  return typeof body.presentCount === "number" ? body.presentCount : null;
}

async function listCandidates(
  baseUrl: string,
  token: string,
  voter: Voter,
): Promise<Array<{ id: string; photoUrl?: string | null }>> {
  const response = await fetch(`${baseUrl}/v1/join/${token}/ballot`, {
    headers: { "x-scelta-join-key": voter.joinKey },
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as {
    candidates?: Array<{ id: string; photoUrl?: string | null }>;
  };
  return body.candidates ?? [];
}

async function fetchPhoto(baseUrl: string, photoPath: string): Promise<Sample> {
  const url = photoPath.startsWith("http") ? photoPath : `${baseUrl}${photoPath}`;
  const timed = await time(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const buf = await response.arrayBuffer();
    return { ok: response.ok, status: response.status, bytes: buf.byteLength };
  });
  if (!timed.value) {
    return { ok: false, ms: timed.ms, status: 0, error: "sem resposta" };
  }
  return sampleOf(timed.ms, timed.value.ok, timed.value.status, undefined, timed.value.bytes);
}

async function pollPhase(baseUrl: string, token: string, voters: Voter[], bucket: Sample[]) {
  const seen: Array<{ name: string; screen: Screen }> = [];
  for (let waveIndex = 0; waveIndex < POLL_WAVES; waveIndex += 1) {
    const waveResult = await wave(voters, async (voter) => {
      const timed = await time(() => readBallot(baseUrl, token, voter));
      if (!timed.value) {
        bucket.push(sampleOf(timed.ms, false, 0, "sem resposta"));
        return { name: voter.name, screen: { phase: "desconhecida" as const } };
      }
      bucket.push(
        sampleOf(
          timed.ms,
          timed.value.ok,
          timed.value.status,
          timed.value.error,
          timed.value.bytes,
        ),
      );
      return { name: voter.name, screen: timed.value.screen };
    });
    seen.push(...waveResult);
  }
  return seen;
}

async function readBallot(
  baseUrl: string,
  token: string,
  voter: Voter,
): Promise<{
  ok: boolean;
  status: number;
  bytes?: number;
  error?: string;
  screen: Screen;
}> {
  try {
    const response = await fetch(`${baseUrl}/v1/join/${token}/ballot`, {
      headers: { "x-scelta-join-key": voter.joinKey },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        bytes: text.length,
        error: `http ${response.status}`,
        screen: { phase: "desconhecida" },
      };
    }
    const body = safeJsonParse(text) as BallotBody;
    return { ok: true, status: response.status, bytes: text.length, screen: screenOf(body) };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.name : "falha",
      screen: { phase: "desconhecida" },
    };
  }
}

function screenOf(body: BallotBody): Screen {
  const roomStatus = body.roomStatus ?? "";
  const joinable = roomStatus === "open" || roomStatus === "test";
  const round = body.round ?? null;
  const access = body.viewerAccess ?? "unknown";
  if (access === "absent" || access === "revoked" || access === "missing") {
    return { phase: "removido", access };
  }
  const hasTally = Boolean(round && round.status === "closed" && round.tally);
  if (!joinable && !hasTally) {
    return { phase: "encerrada", roomStatus };
  }
  if (joinable && round?.status === "open" && (body.candidates?.length ?? 0) > 0) {
    const candidates = (body.candidates ?? []).map((item) => item.displayName).join(", ");
    return { phase: "voto", roundId: round.id, candidates };
  }
  if (round?.tally) {
    const standings = round.tally.standings
      .map((item) => `${item.displayName}:${item.votes}`)
      .join(", ");
    return {
      phase: "resultado",
      roundId: round.id,
      outcome: round.tally.outcome,
      winner: round.tally.winnerName ?? "sem eleito",
      tally: `${standings}; total=${round.tally.totalVotes}`,
    };
  }
  return { phase: "início", roomStatus, roundStatus: round?.status ?? null };
}

function expectPhase(
  seen: Array<{ name: string; screen: Screen }>,
  phase: Screen["phase"],
  label: string,
): string[] {
  const problems: string[] = [];
  const wrong = seen.filter((item) => item.screen.phase !== phase);
  if (wrong.length > 0) {
    const kinds = countBy(wrong.map((item) => item.screen.phase));
    problems.push(
      `${label}: ${wrong.length} de ${seen.length} leituras não estavam em "${phase}" (${formatCounts(kinds)}).`,
    );
  }
  const fingerprints = new Set(seen.map((item) => JSON.stringify(item.screen)));
  if (fingerprints.size > 1) {
    problems.push(`${label}: ${fingerprints.size} telas diferentes ao mesmo tempo.`);
    for (const fingerprint of fingerprints) {
      const count = seen.filter((item) => JSON.stringify(item.screen) === fingerprint).length;
      problems.push(`  ${count} viram ${fingerprint}`);
    }
  }
  return problems;
}

async function openRound(baseUrl: string, cookie: string, roomId: string) {
  const response = await fetch(`${baseUrl}/v1/admin/rooms/${roomId}/rounds`, {
    method: "POST",
    headers: { cookie },
  });
  const body = (await response.json().catch(() => ({}))) as {
    round?: { id: string };
    error?: string;
  };
  if (!response.ok || !body.round) {
    return { ok: false as const, error: body.error ?? `http ${response.status}` };
  }
  return { ok: true as const, roundId: body.round.id };
}

async function castVote(
  baseUrl: string,
  token: string,
  voter: Voter,
  candidateIds: string[],
): Promise<Sample> {
  const timed = await time(async () => {
    const response = await fetch(`${baseUrl}/v1/join/${token}/ballot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinKey: voter.joinKey, candidateIds }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const body = safeJsonParse(text) as { error?: string };
    return { response, bytes: text.length, error: body.error };
  });
  if (!timed.value) {
    return { ok: false, ms: timed.ms, status: 0, error: "sem resposta" };
  }
  return sampleOf(
    timed.ms,
    timed.value.response.ok,
    timed.value.response.status,
    timed.value.error,
    timed.value.bytes,
  );
}

async function submitPaperTally(
  baseUrl: string,
  cookie: string,
  roomId: string,
  roundId: string,
  paperBallots: number,
  vacancies: number,
  candidateIds: string[],
): Promise<Sample> {
  const blankVotes = paperBallots >= 5 ? 1 : 0;
  const validBallots = paperBallots - blankVotes;
  const candidateVotes: Record<string, number> = {};
  const maxMarks = Math.min(candidateIds.length, vacancies);
  for (let i = 0; i < maxMarks; i += 1) {
    candidateVotes[candidateIds[i]!] = validBallots;
  }

  const timed = await time(async () => {
    const response = await fetch(
      `${baseUrl}/v1/admin/rooms/${roomId}/rounds/${roundId}/paper-tally`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          ballotCount: paperBallots,
          blankVotes,
          nullVotes: 0,
          candidateVotes,
        }),
      },
    );
    const text = await response.text();
    const body = safeJsonParse(text) as { error?: string };
    return { ok: response.ok, status: response.status, bytes: text.length, error: body.error };
  });
  if (!timed.value) {
    return { ok: false, ms: timed.ms, status: 0, error: "sem resposta" };
  }
  return sampleOf(timed.ms, timed.value.ok, timed.value.status, timed.value.error, timed.value.bytes);
}

async function closeRound(baseUrl: string, cookie: string, roomId: string, roundId: string) {
  const response = await fetch(`${baseUrl}/v1/admin/rooms/${roomId}/rounds/${roundId}/close`, {
    method: "POST",
    headers: { cookie },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    votedCount?: number;
    presentCount?: number;
  };
  if (!response.ok) {
    const extra =
      body.votedCount !== undefined
        ? ` (votos ${body.votedCount}, presentes ${body.presentCount})`
        : "";
    return { ok: false as const, error: `${body.error ?? response.status}${extra}` };
  }
  return { ok: true as const };
}

async function revealRound(baseUrl: string, cookie: string, roomId: string, roundId: string) {
  await fetch(`${baseUrl}/v1/admin/rooms/${roomId}/rounds/${roundId}/reveal`, {
    method: "POST",
    headers: { cookie },
  });
}

async function wave<T>(voters: Voter[], task: (voter: Voter, index: number) => Promise<T>): Promise<T[]> {
  return Promise.all(voters.map((voter, index) => task(voter, index)));
}

async function time<T>(task: () => Promise<T>): Promise<{ ms: number; value: T | undefined }> {
  const start = performance.now();
  try {
    const value = await task();
    return { ms: performance.now() - start, value };
  } catch {
    return {
      ms: performance.now() - start,
      value: undefined,
    };
  }
}

function sampleOf(
  ms: number,
  ok: boolean,
  status: number,
  error?: string,
  bytes?: number,
): Sample {
  return { ok, ms, status, ...(bytes !== undefined ? { bytes } : {}), ...(error ? { error } : {}) };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function buildSamplePngDataUrl(targetBytes: number): string {
  const minimalPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const padSize = Math.max(0, targetBytes - minimalPng.length);
  const padded = Buffer.concat([minimalPng, Buffer.alloc(padSize, 0x41)]);
  return `data:image/png;base64,${padded.toString("base64")}`;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()].map(([name, count]) => `${name} (${count})`).join(", ");
}

function percentile(samples: number[], percent: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function printReport(
  config: LoadConfig,
  elapsedMs: number,
  samples: Record<string, Sample[]>,
  problems: string[],
) {
  const totalRequests = Object.values(samples).reduce((sum, rows) => sum + rows.length, 0);
  const throughput = elapsedMs > 0 ? Math.round((totalRequests / elapsedMs) * 1000) : 0;

  console.log("");
  console.log(
    `Assembleia simulada: ${config.users} votantes (${config.users - config.paperVoters} online + ${config.paperVoters} papel), ${config.vacancies} vagas, fotos=${config.withPhotos ? "sim" : "nao"}`,
  );
  console.log(
    `Duração: ${(elapsedMs / 1000).toFixed(1)}s | Pedidos totais: ${totalRequests} (~${throughput} req/s)`,
  );
  console.log("");
  console.log("Etapa        pedidos    ok   erros    p50      p95     máximo   média bytes");
  for (const [name, rows] of Object.entries(samples)) {
    if (rows.length === 0) {
      continue;
    }
    const ok = rows.filter((row) => row.ok).length;
    const times = rows.map((row) => row.ms);
    const bytesList = rows
      .map((row) => row.bytes)
      .filter((value): value is number => typeof value === "number");
    const avgBytes =
      bytesList.length > 0
        ? Math.round(bytesList.reduce((acc, item) => acc + item, 0) / bytesList.length)
        : 0;
    console.log(
      `${name.padEnd(12)} ${String(rows.length).padStart(7)}  ${String(ok).padStart(4)}  ${String(rows.length - ok).padStart(5)}  ${fmt(percentile(times, 50))}  ${fmt(percentile(times, 95))}  ${fmt(percentile(times, 100))}  ${String(avgBytes).padStart(10)} B`,
    );
  }
  console.log("");
  if (problems.length === 0) {
    const slow = Object.values(samples)
      .flat()
      .some((row) => row.ms > 2000);
    console.log(
      slow
        ? "Resultado: todos votaram e viram a mesma tela nos três estados. Houve resposta acima de 2s — a sala funcionou, mas ficou lenta."
        : "Resultado: todos votaram e viram a mesma tela no início, no voto e no resultado. A API aguentou esta carga.",
    );
    return;
  }
  console.log("Resultado: a carga mostrou falhas.");
  for (const problem of problems) {
    console.log(`- ${problem}`);
  }
}

function fmt(ms: number): string {
  return `${Math.round(ms)}ms`.padStart(7);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
