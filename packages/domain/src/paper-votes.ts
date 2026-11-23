export type PaperTallyInput = {
  ballotCount: number;
  blankVotes: number;
  nullVotes: number;
  candidateVotes: Record<string, number>;
};

export type ValidatePaperTallyOptions = {
  paperVotersCount: number;
  validCandidateIds: readonly string[];
  maxMarksPerBallot?: number;
};

export type ValidatePaperTallyResult =
  | { valid: true }
  | { valid: false; code: string; message: string };

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function invalidValue(message: string): ValidatePaperTallyResult {
  return {
    valid: false,
    code: "invalid_paper_tally_value",
    message,
  };
}

/**
 * Validates aggregated paper ballot counts against the number of registered paper voters
 * and the eligible candidate pool for the round.
 */
export function validatePaperTally(
  input: PaperTallyInput,
  options: ValidatePaperTallyOptions,
): ValidatePaperTallyResult {
  if (!isNonNegativeInteger(options.paperVotersCount)) {
    return invalidValue("A contagem de eleitores em papel deve ser um número inteiro não negativo.");
  }

  const maxMarksPerBallot = options.maxMarksPerBallot ?? 1;
  if (!Number.isInteger(maxMarksPerBallot) || maxMarksPerBallot < 1) {
    return invalidValue("O limite de marcações por cédula deve ser um inteiro positivo.");
  }

  if (
    !isNonNegativeInteger(input.ballotCount) ||
    !isNonNegativeInteger(input.blankVotes) ||
    !isNonNegativeInteger(input.nullVotes)
  ) {
    return invalidValue(
      "Os totais de cédulas, votos em branco e votos nulos devem ser inteiros não negativos.",
    );
  }

  if (
    input.candidateVotes === null ||
    typeof input.candidateVotes !== "object" ||
    Array.isArray(input.candidateVotes)
  ) {
    return invalidValue("Os votos por candidato devem ser informados em um mapa válido.");
  }

  const validCandidateSet = new Set(options.validCandidateIds);
  let candidateMarks = 0;

  for (const [candidateId, votes] of Object.entries(input.candidateVotes)) {
    if (!isNonNegativeInteger(votes)) {
      return invalidValue("Os votos por candidato devem ser números inteiros não negativos.");
    }
    if (votes > 0 && !validCandidateSet.has(candidateId)) {
      return {
        valid: false,
        code: "invalid_paper_candidate",
        message: "Há votos em papel atribuídos a um candidato desconhecido ou inelegível.",
      };
    }
    candidateMarks += votes;
  }

  if (input.ballotCount > options.paperVotersCount) {
    return {
      valid: false,
      code: "paper_ballots_exceed_voters",
      message: "O total de cédulas de papel excede o número de eleitores marcados para voto em papel.",
    };
  }

  if (input.blankVotes + input.nullVotes > input.ballotCount) {
    return {
      valid: false,
      code: "paper_marks_exceed_ballots",
      message: "A soma de votos em branco e nulos excede o total de cédulas de papel.",
    };
  }

  const validBallots = input.ballotCount - input.blankVotes - input.nullVotes;
  if (maxMarksPerBallot === 1) {
    if (candidateMarks !== validBallots) {
      return {
        valid: false,
        code: "paper_marks_mismatch_ballots",
        message:
          "A soma dos votos nos candidatos deve ser igual ao número de cédulas válidas (cédulas menos brancos e nulos).",
      };
    }
  } else {
    if (candidateMarks > maxMarksPerBallot * validBallots) {
      return {
        valid: false,
        code: "paper_marks_exceed_ballots",
        message: "O total de marcações nos candidatos excede o limite permitido pelas cédulas válidas.",
      };
    }
    for (const votes of Object.values(input.candidateVotes)) {
      if (votes > validBallots) {
        return {
          valid: false,
          code: "paper_marks_exceed_ballots",
          message:
            "Um candidato não pode receber mais marcações em papel do que o número de cédulas válidas.",
        };
      }
    }
  }

  return { valid: true };
}
