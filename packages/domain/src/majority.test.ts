import { describe, expect, it } from "vitest";
import { hasAbsoluteMajority, selectTopCandidates, tallyRoundVotes } from "./majority.js";

describe("hasAbsoluteMajority", () => {
  it("requires more than half of votes", () => {
    const result = hasAbsoluteMajority([
      { candidateId: "a", votes: 6 },
      { candidateId: "b", votes: 5 },
    ]);

    expect(result.threshold).toBe(6);
    expect(result.winnerIds).toEqual(["a"]);
    expect(result.remainingVacancies).toBe(0);
    expect(result.lastVacancyTieCandidateIds).toEqual([]);
  });

  it("returns no winner on tie below threshold", () => {
    const result = hasAbsoluteMajority([
      { candidateId: "a", votes: 5 },
      { candidateId: "b", votes: 5 },
    ]);

    expect(result.threshold).toBe(6);
    expect(result.winnerIds).toEqual([]);
    expect(result.remainingVacancies).toBe(1);
    expect(result.lastVacancyTieCandidateIds).toEqual([]);
  });

  it("handles 5-vacancy majority scenarios using totalBallots as the base", () => {
    // 100 ballots -> threshold = 51
    const allFiveElected = hasAbsoluteMajority(
      [
        { candidateId: "c1", votes: 80 },
        { candidateId: "c2", votes: 75 },
        { candidateId: "c3", votes: 70 },
        { candidateId: "c4", votes: 60 },
        { candidateId: "c5", votes: 51 },
        { candidateId: "c6", votes: 50 },
      ],
      5,
      0,
      100,
    );
    expect(allFiveElected.threshold).toBe(51);
    expect(allFiveElected.winnerIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(allFiveElected.remainingVacancies).toBe(0);
    expect(allFiveElected.lastVacancyTieCandidateIds).toEqual([]);

    // 4 of 5 elected (5th got exactly 50%, not strictly > 50%)
    const fourOfFive = hasAbsoluteMajority(
      [
        { candidateId: "c1", votes: 80 },
        { candidateId: "c2", votes: 75 },
        { candidateId: "c3", votes: 70 },
        { candidateId: "c4", votes: 55 },
        { candidateId: "c5", votes: 50 },
        { candidateId: "c6", votes: 40 },
      ],
      5,
      0,
      100,
    );
    expect(fourOfFive.winnerIds).toEqual(["c1", "c2", "c3", "c4"]);
    expect(fourOfFive.remainingVacancies).toBe(1);
    expect(fourOfFive.lastVacancyTieCandidateIds).toEqual([]);

    // More than 5 reach majority without a tie at 5th place -> top 5 elected
    const sixQualifiedNoTie = hasAbsoluteMajority(
      [
        { candidateId: "c1", votes: 90 },
        { candidateId: "c2", votes: 85 },
        { candidateId: "c3", votes: 80 },
        { candidateId: "c4", votes: 75 },
        { candidateId: "c5", votes: 70 },
        { candidateId: "c6", votes: 65 },
      ],
      5,
      0,
      100,
    );
    expect(sixQualifiedNoTie.winnerIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(sixQualifiedNoTie.remainingVacancies).toBe(0);
    expect(sixQualifiedNoTie.lastVacancyTieCandidateIds).toEqual([]);

    // More than 5 reach majority WITH a tie on the 5th vacancy -> top 4 elected, 2 tied go to runoff
    const tieOnFifthVacancy = hasAbsoluteMajority(
      [
        { candidateId: "c1", votes: 80 },
        { candidateId: "c2", votes: 80 },
        { candidateId: "c3", votes: 80 },
        { candidateId: "c4", votes: 80 },
        { candidateId: "c5", votes: 60 },
        { candidateId: "c6", votes: 60 },
      ],
      5,
      0,
      100,
    );
    expect(tieOnFifthVacancy.winnerIds).toEqual(["c1", "c2", "c3", "c4"]);
    expect(tieOnFifthVacancy.remainingVacancies).toBe(1);
    expect(tieOnFifthVacancy.lastVacancyTieCandidateIds).toEqual(["c5", "c6"]);

    // 4-way tie across the last 2 vacancies -> top 3 elected, 4 tied go to runoff for 2 vacancies
    const tieAcrossLastTwo = hasAbsoluteMajority(
      [
        { candidateId: "c1", votes: 90 },
        { candidateId: "c2", votes: 85 },
        { candidateId: "c3", votes: 80 },
        { candidateId: "c4", votes: 60 },
        { candidateId: "c5", votes: 60 },
        { candidateId: "c6", votes: 60 },
        { candidateId: "c7", votes: 60 },
      ],
      5,
      0,
      100,
    );
    expect(tieAcrossLastTwo.winnerIds).toEqual(["c1", "c2", "c3"]);
    expect(tieAcrossLastTwo.remainingVacancies).toBe(2);
    expect(tieAcrossLastTwo.lastVacancyTieCandidateIds).toEqual(["c4", "c5", "c6", "c7"]);
  });
});

describe("tallyRoundVotes", () => {
  const candidates = [
    { id: "cand-1", displayName: "Paulo" },
    { id: "cand-2", displayName: "Silas" },
  ];

  it("elects a candidate who reaches strictly more than 50% of votes", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2", "cand-1"]);
    expect(tally).toEqual({
      totalVotes: 3,
      nullVotes: 0,
      threshold: 2,
      outcome: "elected",
      winnerId: "cand-1",
      winnerName: "Paulo",
      vacancies: 1,
      winnerIds: ["cand-1"],
      winnerNames: ["Paulo"],
      remainingVacancies: 0,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 2 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1 },
      ],
    });
  });

  it("reports no_majority when votes are split 50/50 or no ballots were cast", () => {
    const split = tallyRoundVotes(candidates, ["cand-1", "cand-2"]);
    expect(split).toEqual({
      totalVotes: 2,
      nullVotes: 0,
      threshold: 2,
      outcome: "no_majority",
      winnerId: null,
      winnerName: null,
      vacancies: 1,
      winnerIds: [],
      winnerNames: [],
      remainingVacancies: 1,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 1 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1 },
      ],
    });

    const empty = tallyRoundVotes(candidates, []);
    expect(empty.outcome).toBe("no_majority");
    expect(empty.winnerId).toBeNull();
    expect(empty.winnerIds).toEqual([]);
    expect(empty.totalVotes).toBe(0);
    expect(empty.nullVotes).toBe(0);
    expect(empty.remainingVacancies).toBe(1);
  });

  it("counts null/blank votes in totalVotes and threshold", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-1", null, null]);
    expect(tally).toEqual({
      totalVotes: 4,
      nullVotes: 2,
      threshold: 3,
      outcome: "no_majority",
      winnerId: null,
      winnerName: null,
      vacancies: 1,
      winnerIds: [],
      winnerNames: [],
      remainingVacancies: 1,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 2 },
        { candidateId: "cand-2", displayName: "Silas", votes: 0 },
      ],
    });
  });

  it("throws when a ballot references an unknown candidate or marks the same candidate twice", () => {
    expect(() => tallyRoundVotes(candidates, ["unknown"])).toThrow(
      "Ballot references an unknown candidate",
    );
    expect(() => tallyRoundVotes(candidates, [["cand-1", "cand-1"]])).toThrow(
      "Ballot marks the same candidate more than once",
    );
  });

  it("breaks a 3rd-round tie automatically in favor of the oldest candidate when birth dates are available", () => {
    const candidatesWithAge = [
      { id: "cand-young", displayName: "Jovem", birthDate: "2008-05-10" },
      { id: "cand-old", displayName: "Veterano", birthDate: "2005-02-01" },
    ];
    const tally = tallyRoundVotes(candidatesWithAge, ["cand-young", "cand-old"], {
      roundNumber: 3,
    });
    expect(tally).toEqual({
      totalVotes: 2,
      nullVotes: 0,
      threshold: 2,
      outcome: "elected",
      winnerId: "cand-old",
      winnerName: "Veterano",
      vacancies: 1,
      winnerIds: ["cand-old"],
      winnerNames: ["Veterano"],
      remainingVacancies: 0,
      standings: [
        { candidateId: "cand-young", displayName: "Jovem", votes: 1 },
        { candidateId: "cand-old", displayName: "Veterano", votes: 1 },
      ],
      tieBreakReason: "age",
    });
  });

  it("marks tieBreakRequired in 3rd round when tied candidates lack birthDate or have equal birthDate", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2"], { roundNumber: 3 });
    expect(tally).toEqual({
      totalVotes: 2,
      nullVotes: 0,
      threshold: 2,
      outcome: "no_majority",
      winnerId: null,
      winnerName: null,
      vacancies: 1,
      winnerIds: [],
      winnerNames: [],
      remainingVacancies: 1,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 1 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1 },
      ],
      tieBreakRequired: true,
      tiedCandidates: [
        { id: "cand-1", displayName: "Paulo", birthDate: null },
        { id: "cand-2", displayName: "Silas", birthDate: null },
      ],
    });
  });

  it("honors winnerOverrideId when admin resolves a 3rd-round tie", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2"], {
      roundNumber: 3,
      winnerOverrideId: "cand-2",
      tieBreakReason: "admin_tiebreak",
    });
    expect(tally).toEqual({
      totalVotes: 2,
      nullVotes: 0,
      threshold: 2,
      outcome: "elected",
      winnerId: "cand-2",
      winnerName: "Silas",
      vacancies: 1,
      winnerIds: ["cand-2"],
      winnerNames: ["Silas"],
      remainingVacancies: 0,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 1 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1 },
      ],
      tieBreakReason: "admin_tiebreak",
    });
  });

  it("combines online ballots and paper tally with voteOrigin breakdown and paper-adjusted majority", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2", null], {
      paperTally: {
        ballotCount: 5,
        blankVotes: 1,
        nullVotes: 1,
        candidateVotes: { "cand-1": 3, "cand-2": 0 },
      },
    });

    // Majority base = 3 online ballots + 3 paper valid + 1 paper blank = 7 -> threshold = 4
    expect(tally).toEqual({
      totalVotes: 7,
      nullVotes: 3,
      threshold: 4,
      outcome: "elected",
      winnerId: "cand-1",
      winnerName: "Paulo",
      vacancies: 1,
      winnerIds: ["cand-1"],
      winnerNames: ["Paulo"],
      remainingVacancies: 0,
      standings: [
        { candidateId: "cand-1", displayName: "Paulo", votes: 4, onlineVotes: 1, paperVotes: 3 },
        { candidateId: "cand-2", displayName: "Silas", votes: 1, onlineVotes: 1, paperVotes: 0 },
      ],
      voteOrigin: {
        online: { ballots: 3, candidateVotes: 2, blankVotes: 1 },
        paper: { ballots: 5, candidateVotes: 3, blankVotes: 1, nullVotes: 1 },
      },
    });
  });

  it("elects a winner from paper votes even when online ballots are split or empty", () => {
    const tally = tallyRoundVotes(candidates, ["cand-1", "cand-2"], {
      paperTally: {
        ballotCount: 2,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { "cand-2": 2 },
      },
    });

    expect(tally.outcome).toBe("elected");
    expect(tally.winnerId).toBe("cand-2");
    expect(tally.winnerIds).toEqual(["cand-2"]);
    expect(tally.totalVotes).toBe(4);
    expect(tally.threshold).toBe(3);
  });

  describe("multi-vacancy (5 vacancies)", () => {
    const sevenCandidates = [
      { id: "c1", displayName: "André" },
      { id: "c2", displayName: "Barnabé" },
      { id: "c3", displayName: "Carlos" },
      { id: "c4", displayName: "Davi" },
      { id: "c5", displayName: "Estevão" },
      { id: "c6", displayName: "Filipe" },
      { id: "c7", displayName: "Gabriel" },
    ];

    it("elects all 5 candidates when all 5 exceed 50% of ballots (including blank ballots)", () => {
      // 10 online ballots (including 1 blank) -> majority base = 10 -> threshold = 6
      const ballots: readonly (readonly string[])[] = [
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c6"],
        ["c3", "c6"],
        ["c6", "c7"],
        [], // blank ballot counts toward majority base
      ];

      const tally = tallyRoundVotes(sevenCandidates, ballots, { vacancies: 5 });

      expect(tally.totalVotes).toBe(10);
      expect(tally.nullVotes).toBe(1);
      expect(tally.threshold).toBe(6);
      expect(tally.outcome).toBe("elected");
      expect(tally.vacancies).toBe(5);
      expect(tally.winnerIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
      expect(tally.winnerNames).toEqual(["André", "Barnabé", "Carlos", "Davi", "Estevão"]);
      expect(tally.winnerId).toBe("c1");
      expect(tally.winnerName).toBe("André, Barnabé, Carlos, Davi, Estevão");
      expect(tally.remainingVacancies).toBe(0);
      expect(tally.partialElection).toBeUndefined();
      expect(tally.lastVacancyTieCandidateIds).toBeUndefined();
    });

    it("elects 4 of 5 when only 4 exceed 50% of ballots and leaves 1 remaining vacancy", () => {
      // 10 ballots (2 blank) -> threshold = 6. c1..c4 get 6+, c5 gets 5 (not > 50%).
      const ballots: readonly (readonly string[])[] = [
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c6"],
        ["c1", "c2", "c6"],
        ["c7"],
        [],
        [],
      ];

      const tally = tallyRoundVotes(sevenCandidates, ballots, { vacancies: 5 });

      expect(tally.totalVotes).toBe(10);
      expect(tally.nullVotes).toBe(2);
      expect(tally.threshold).toBe(6);
      expect(tally.outcome).toBe("elected");
      expect(tally.winnerIds).toEqual(["c1", "c2", "c3", "c4"]);
      expect(tally.remainingVacancies).toBe(1);
      expect(tally.partialElection).toBe(true);
      expect(tally.lastVacancyTieCandidateIds).toBeUndefined();
    });

    it("elects top 5 when 6 candidates exceed 50% of ballots without a tie at 5th place", () => {
      // 10 ballots -> threshold = 6
      // c1: 9, c2: 9, c3: 8, c4: 8, c5: 7, c6: 6, c7: 1
      const ballots: readonly (readonly string[])[] = [
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c6"],
        ["c1", "c2", "c3", "c4", "c6"],
        ["c1", "c2", "c3", "c5", "c6"],
        ["c1", "c2", "c4", "c5", "c6"],
        ["c1", "c2", "c3", "c4", "c6"],
        ["c5", "c6", "c7"],
      ];

      const tally = tallyRoundVotes(sevenCandidates, ballots, { vacancies: 5 });

      expect(tally.totalVotes).toBe(10);
      expect(tally.threshold).toBe(6);
      expect(tally.outcome).toBe("elected");
      expect(tally.winnerIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
      expect(tally.remainingVacancies).toBe(0);
      expect(tally.partialElection).toBeUndefined();
      expect(tally.lastVacancyTieCandidateIds).toBeUndefined();
    });

    it("elects top 4 and flags a tie on the 5th vacancy when 6 reach majority and 5th & 6th tie", () => {
      // 10 ballots -> threshold = 6
      // c1..c4: 8 votes each; c5: 6 votes; c6: 6 votes; c7: 0
      const ballots: readonly (readonly string[])[] = [
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c6"],
        ["c1", "c2", "c3", "c4", "c6"],
        ["c1", "c2", "c3", "c4", "c6"],
        ["c1", "c2", "c3", "c4", "c6"],
        ["c5", "c6"],
        ["c5", "c6"],
      ];

      const tally = tallyRoundVotes(sevenCandidates, ballots, { vacancies: 5 });

      expect(tally.totalVotes).toBe(10);
      expect(tally.threshold).toBe(6);
      expect(tally.outcome).toBe("elected");
      expect(tally.winnerIds).toEqual(["c1", "c2", "c3", "c4"]);
      expect(tally.remainingVacancies).toBe(1);
      expect(tally.partialElection).toBe(true);
      expect(tally.lastVacancyTieCandidateIds).toEqual(["c5", "c6"]);
    });

    it("returns no_majority with lastVacancyTieCandidateIds when all qualified candidates tie at cutoff", () => {
      // 2 vacancies, 6 ballots -> threshold = 4; c1, c2, c3 all get 4 votes
      const ballots: readonly (readonly string[])[] = [
        ["c1", "c2"],
        ["c1", "c2"],
        ["c1", "c3"],
        ["c1", "c3"],
        ["c2", "c3"],
        ["c2", "c3"],
      ];

      const tally = tallyRoundVotes(sevenCandidates.slice(0, 3), ballots, { vacancies: 2 });

      expect(tally.outcome).toBe("no_majority");
      expect(tally.winnerIds).toEqual([]);
      expect(tally.remainingVacancies).toBe(2);
      expect(tally.lastVacancyTieCandidateIds).toEqual(["c1", "c2", "c3"]);
    });

    it("combines multi-mark online ballots with multi-mark paper ballots (blanks in base, paper nulls excluded)", () => {
      // Online: 6 ballots (5 marked + 1 blank)
      // Paper: 6 ballots (4 valid + 1 blank + 1 null) -> paper majority base = 5
      // Total majority base = 6 + 5 = 11 -> threshold = 6
      const onlineBallots: readonly (readonly string[])[] = [
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3", "c4", "c5"],
        ["c1", "c2", "c3"],
        ["c1", "c2"],
        [],
      ];

      const tally = tallyRoundVotes(sevenCandidates, onlineBallots, {
        vacancies: 5,
        paperTally: {
          ballotCount: 6,
          blankVotes: 1,
          nullVotes: 1,
          // validBallots = 4; total marks = 16 <= 5*4 = 20
          candidateVotes: { c1: 4, c2: 4, c3: 3, c4: 3, c5: 2 },
        },
      });

      // Totals: c1=9, c2=9, c3=7, c4=6, c5=5 (c5 misses threshold=6)
      expect(tally.totalVotes).toBe(11);
      expect(tally.nullVotes).toBe(3); // 1 online blank + 1 paper blank + 1 paper null
      expect(tally.threshold).toBe(6);
      expect(tally.outcome).toBe("elected");
      expect(tally.winnerIds).toEqual(["c1", "c2", "c3", "c4"]);
      expect(tally.remainingVacancies).toBe(1);
      expect(tally.partialElection).toBe(true);
      expect(tally.voteOrigin).toEqual({
        online: { ballots: 6, candidateVotes: 20, blankVotes: 1 },
        paper: { ballots: 6, candidateVotes: 16, blankVotes: 1, nullVotes: 1 },
      });
    });
  });
});

describe("selectTopCandidates", () => {
  it("returns the highest vote getters", () => {
    expect(
      selectTopCandidates(
        [
          { candidateId: "a", votes: 3 },
          { candidateId: "b", votes: 9 },
          { candidateId: "c", votes: 5 },
        ],
        2,
      ),
    ).toEqual(["b", "c"]);
  });
});
