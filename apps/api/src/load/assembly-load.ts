/**
 * Simulates an assembly: many voters hit the API at the same time.
 *
 * Checks that every voter can vote and that all of them see the same screen
 * in the three states the voter page renders: início, voto and resultado.
 *
 *   pnpm --filter @scelta/api load:assembly
 *   pnpm --filter @scelta/api load:assembly -- --users=40
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
  candidates?: Array<{ id: string; displayName: string }>;
  round?: {
    id: string;
    status: string;
    outcome: string | null;
    tally?: {
      outcome: string;
      winnerName: string | null;
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
  error?: string;
};

const POLL_WAVES = 5;

async function main() {
  const users = readUsers(process.argv.slice(2));
  const started = performance.now();
  const server = await startServer();
  const problems: string[] = [];
  const samples = {
    entrar: [] as Sample[],
    início: [] as Sample[],
    voto: [] as Sample[],
    cédula: [] as Sample[],
    resultado: [] as Sample[],
  };

  try {
    const cookie = await login(server.baseUrl);
    const room = await createAssembly(server.baseUrl, cookie, users);
    const voters = await loadVoters(server.baseUrl, cookie, room.id, users);

    const joined = await wave(voters, (voter) => joinRoom(server.baseUrl, room.token, voter));
    samples.entrar = joined;
    const present = joined.filter((item) => item.ok).length;
    if (present !== users) {
      problems.push(`Entrada: ${present} de ${users} conseguiram entrar.`);
    }
    const presence = await readPresence(server.baseUrl, cookie, room.id);
    if (presence !== users) {
      problems.push(`Depois da entrada a sala tinha ${presence ?? "?"} presentes, e não ${users}.`);
    }

    const startScreens = await pollPhase(server.baseUrl, room.token, voters, samples.início);
    problems.push(...expectPhase(startScreens, "início", "início"));

    const opened = await openRound(server.baseUrl, cookie, room.id);
    if (!opened.ok) {
      problems.push(`Não foi possível abrir o escrutínio: ${opened.error}`);
    } else {
      const voteScreens = await pollPhase(server.baseUrl, room.token, voters, samples.voto);
      problems.push(...expectPhase(voteScreens, "voto", "voto"));
      const candidateIds = await listCandidateIds(server.baseUrl, room.token, voters[0]!);
      if (candidateIds.length === 0) {
        problems.push("A cédula aberta não trouxe candidatos.");
      }

      const cast = await wave(voters, (voter, index) =>
        castVote(
          server.baseUrl,
          room.token,
          voter,
          candidateIds[index % Math.max(candidateIds.length, 1)] ?? "",
        ),
      );
      samples.cédula = cast;
      const accepted = cast.filter((item) => item.ok).length;
      if (accepted !== users) {
        const reasons = countBy(cast.filter((item) => !item.ok).map((item) => item.error ?? `http ${item.status}`));
        problems.push(`Votos aceitos: ${accepted} de ${users}. Falhas: ${formatCounts(reasons)}.`);
      }

      const stillVoting = await pollPhase(server.baseUrl, room.token, voters, samples.voto);
      problems.push(...expectPhase(stillVoting, "voto", "voto durante a apuração"));

      const closed = await closeRound(server.baseUrl, cookie, room.id, opened.roundId);
      if (!closed.ok) {
        problems.push(`Não foi possível encerrar o escrutínio: ${closed.error}`);
      } else {
        const resultScreens = await pollPhase(server.baseUrl, room.token, voters, samples.resultado);
        problems.push(...expectPhase(resultScreens, "resultado", "resultado"));
        const expectedVotes = accepted;
        const seenVotes = resultScreens.find((item) => item.screen.phase === "resultado");
        if (seenVotes?.screen.phase === "resultado" && !seenVotes.screen.tally.includes(`total=${expectedVotes}`)) {
          problems.push(`O resultado não mostra ${expectedVotes} votos. Tela: ${seenVotes.screen.tally}.`);
        }
      }
    }
  } finally {
    await server.close();
  }

  const elapsed = Math.round(performance.now() - started);
  printReport(users, elapsed, samples, problems);
  if (problems.length > 0) {
    process.exitCode = 1;
  }
}

function readUsers(argv: string[]): number {
  const flag = argv.find((item) => item.startsWith("--users="));
  const raw = flag?.slice("--users=".length) ?? process.env.LOAD_USERS ?? "40";
  const users = Number(raw);
  if (!Number.isInteger(users) || users < 2 || users > 200) {
    throw new Error("Informe --users com um inteiro entre 2 e 200.");
  }
  return users;
}

async function startServer() {
  const [{ createPgliteDatabase }, { buildApp }, { createDrizzleRoomRepository }, { createDrizzleUserRepository }, { ensureBootstrapAdmin }] =
    await Promise.all([
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

async function createAssembly(baseUrl: string, cookie: string, users: number) {
  const lines = ["nome,comungante,sexo,data_nascimento"];
  for (let index = 1; index <= users; index += 1) {
    lines.push(`Votante ${String(index).padStart(3, "0")},sim,M,1990-01-01`);
  }
  const imported = await fetch(`${baseUrl}/v1/admin/members/import`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ csv: lines.join("\n") }),
  });
  if (!imported.ok) {
    throw new Error(`Importação do rol falhou (${imported.status}).`);
  }

  const created = await fetch(`${baseUrl}/v1/admin/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: `Carga ${users} votantes`,
      roomType: "custom",
      rulesPreset: "custom",
      status: "open",
      quorumValue: 1,
      quorumUnit: "absolute",
      eligibleCount: users,
      candidates: ["Ana Costa", "Bruno Lima", "Carla Dias"],
    }),
  });
  const createdBody = (await created.json()) as { room?: { id: string; inviteToken: string }; error?: string };
  if (!created.ok || !createdBody.room) {
    throw new Error(`Criação da sala falhou (${created.status} ${createdBody.error ?? ""}).`);
  }
  return { id: createdBody.room.id, token: createdBody.room.inviteToken };
}

async function loadVoters(baseUrl: string, cookie: string, roomId: string, users: number): Promise<Voter[]> {
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
  if (active.length < users) {
    throw new Error(`Só ${active.length} códigos ativos para ${users} votantes.`);
  }
  return active.slice(0, users).map((item, index) => ({
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
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: response.ok, status: response.status, error: body.error };
  });
  if (!timed.value) {
    return { ok: false, ms: timed.ms, status: 0, error: "sem resposta" };
  }
  return sampleOf(timed.ms, timed.value.ok, timed.value.status, timed.value.error);
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

async function listCandidateIds(baseUrl: string, token: string, voter: Voter): Promise<string[]> {
  const response = await fetch(`${baseUrl}/v1/join/${token}/ballot`, {
    headers: { "x-scelta-join-key": voter.joinKey },
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as { candidates?: Array<{ id: string }> };
  return (body.candidates ?? []).map((candidate) => candidate.id);
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
      bucket.push(sampleOf(timed.ms, timed.value.ok, timed.value.status, timed.value.error));
      return { name: voter.name, screen: timed.value.screen };
    });
    seen.push(...waveResult);
  }
  return seen;
}

async function readBallot(baseUrl: string, token: string, voter: Voter): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  screen: Screen;
}> {
  try {
    const response = await fetch(`${baseUrl}/v1/join/${token}/ballot`, {
      headers: { "x-scelta-join-key": voter.joinKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `http ${response.status}`, screen: { phase: "desconhecida" } };
    }
    const body = (await response.json()) as BallotBody;
    return { ok: true, status: response.status, screen: screenOf(body) };
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
    const standings = round.tally.standings.map((item) => `${item.displayName}:${item.votes}`).join(", ");
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

async function castVote(baseUrl: string, token: string, voter: Voter, candidateId: string): Promise<Sample> {
  const timed = await time(async () => {
    const response = await fetch(`${baseUrl}/v1/join/${token}/ballot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ joinKey: voter.joinKey, candidateId }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { response, error: body.error };
  });
  if (!timed.value) {
    return { ok: false, ms: timed.ms, status: 0, error: "sem resposta" };
  }
  return sampleOf(timed.ms, timed.value.response.ok, timed.value.response.status, timed.value.error);
}

async function closeRound(baseUrl: string, cookie: string, roomId: string, roundId: string) {
  const response = await fetch(`${baseUrl}/v1/admin/rooms/${roomId}/rounds/${roundId}/close`, {
    method: "POST",
    headers: { cookie },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string; votedCount?: number; presentCount?: number };
  if (!response.ok) {
    const extra =
      body.votedCount !== undefined ? ` (votos ${body.votedCount}, presentes ${body.presentCount})` : "";
    return { ok: false as const, error: `${body.error ?? response.status}${extra}` };
  }
  return { ok: true as const };
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

function sampleOf(ms: number, ok: boolean, status: number, error?: string): Sample {
  return { ok, ms, status, ...(error ? { error } : {}) };
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
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function printReport(users: number, elapsedMs: number, samples: Record<string, Sample[]>, problems: string[]) {
  console.log("");
  console.log(`Assembleia simulada: ${users} pessoas ao mesmo tempo`);
  console.log(`Duração: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log("");
  console.log("Etapa        pedidos  ok   erros  p50    p95    máximo");
  for (const [name, rows] of Object.entries(samples)) {
    const ok = rows.filter((row) => row.ok).length;
    const times = rows.map((row) => row.ms);
    console.log(
      `${name.padEnd(12)} ${String(rows.length).padStart(7)}  ${String(ok).padStart(3)}  ${String(rows.length - ok).padStart(5)}  ${fmt(percentile(times, 50))}  ${fmt(percentile(times, 95))}  ${fmt(percentile(times, 100))}`,
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
