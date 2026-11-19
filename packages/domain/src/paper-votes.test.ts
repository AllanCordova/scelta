import { describe, expect, it } from "vitest";
import { validatePaperTally } from "./paper-votes.js";

describe("validatePaperTally", () => {
  const validCandidateIds = ["cand-1", "cand-2"];

  it("accepts a consistent single-mark paper tally", () => {
    const result = validatePaperTally(
      {
        ballotCount: 5,
        blankVotes: 1,
        nullVotes: 1,
        candidateVotes: { "cand-1": 2, "cand-2": 1 },
      },
      { paperVotersCount: 6, validCandidateIds },
    );

    expect(result).toEqual({ valid: true });
  });

  it("accepts zero ballots when no paper votes were cast", () => {
    const result = validatePaperTally(
      {
        ballotCount: 0,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { "cand-1": 0, "cand-2": 0 },
      },
      { paperVotersCount: 3, validCandidateIds },
    );

    expect(result).toEqual({ valid: true });
  });

  it("rejects negative or non-integer counts", () => {
    expect(
      validatePaperTally(
        {
          ballotCount: -1,
          blankVotes: 0,
          nullVotes: 0,
          candidateVotes: {},
        },
        { paperVotersCount: 3, validCandidateIds },
      ),
    ).toMatchObject({ valid: false, code: "invalid_paper_tally_value" });

    expect(
      validatePaperTally(
        {
          ballotCount: 2,
          blankVotes: 0.5,
          nullVotes: 0,
          candidateVotes: { "cand-1": 1 },
        },
        { paperVotersCount: 3, validCandidateIds },
      ),
    ).toMatchObject({ valid: false, code: "invalid_paper_tally_value" });

    expect(
      validatePaperTally(
        {
          ballotCount: 2,
          blankVotes: 0,
          nullVotes: 0,
          candidateVotes: { "cand-1": -1 },
        },
        { paperVotersCount: 3, validCandidateIds },
      ),
    ).toMatchObject({ valid: false, code: "invalid_paper_tally_value" });
  });

  it("rejects positive votes for unknown candidates while ignoring zero-vote unknown keys", () => {
    expect(
      validatePaperTally(
        {
          ballotCount: 2,
          blankVotes: 0,
          nullVotes: 0,
          candidateVotes: { "cand-1": 1, unknown: 1 },
        },
        { paperVotersCount: 3, validCandidateIds },
      ),
    ).toMatchObject({ valid: false, code: "invalid_paper_candidate" });

    expect(
      validatePaperTally(
        {
          ballotCount: 2,
          blankVotes: 0,
          nullVotes: 0,
          candidateVotes: { "cand-1": 2, unknown: 0 },
        },
        { paperVotersCount: 3, validCandidateIds },
      ),
    ).toEqual({ valid: true });
  });

  it("rejects ballotCount greater than paperVotersCount", () => {
    const result = validatePaperTally(
      {
        ballotCount: 4,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { "cand-1": 4 },
      },
      { paperVotersCount: 3, validCandidateIds },
    );

    expect(result).toMatchObject({ valid: false, code: "paper_ballots_exceed_voters" });
  });

  it("rejects blankVotes + nullVotes exceeding ballotCount", () => {
    const result = validatePaperTally(
      {
        ballotCount: 3,
        blankVotes: 2,
        nullVotes: 2,
        candidateVotes: {},
      },
      { paperVotersCount: 5, validCandidateIds },
    );

    expect(result).toMatchObject({ valid: false, code: "paper_marks_exceed_ballots" });
  });

  it("rejects candidate marks mismatching valid ballots when maxMarksPerBallot is 1", () => {
    const under = validatePaperTally(
      {
        ballotCount: 4,
        blankVotes: 1,
        nullVotes: 0,
        candidateVotes: { "cand-1": 2 },
      },
      { paperVotersCount: 5, validCandidateIds },
    );
    expect(under).toMatchObject({ valid: false, code: "paper_marks_mismatch_ballots" });

    const over = validatePaperTally(
      {
        ballotCount: 4,
        blankVotes: 1,
        nullVotes: 0,
        candidateVotes: { "cand-1": 3, "cand-2": 1 },
      },
      { paperVotersCount: 5, validCandidateIds },
    );
    expect(over).toMatchObject({ valid: false, code: "paper_marks_mismatch_ballots" });
  });

  it("allows up to maxMarksPerBallot * validBallots when maxMarksPerBallot > 1", () => {
    const validUndervote = validatePaperTally(
      {
        ballotCount: 4,
        blankVotes: 1,
        nullVotes: 1,
        candidateVotes: { "cand-1": 2, "cand-2": 1 },
      },
      { paperVotersCount: 5, validCandidateIds, maxMarksPerBallot: 2 },
    );
    expect(validUndervote).toEqual({ valid: true });

    const tooManyMarks = validatePaperTally(
      {
        ballotCount: 4,
        blankVotes: 1,
        nullVotes: 1,
        candidateVotes: { "cand-1": 3, "cand-2": 2 },
      },
      { paperVotersCount: 5, validCandidateIds, maxMarksPerBallot: 2 },
    );
    expect(tooManyMarks).toMatchObject({ valid: false, code: "paper_marks_exceed_ballots" });
  });
});
