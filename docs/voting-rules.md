# Voting rules (IPB reference)

> Domain reference for Scelta. Sources are official IPB documents. Local church statutes and society guides may vary — the product should make quorum, majority, and round rules **configurable per room**, with presets for common IPB cases.

## Sources

| Document | Relevance |
| --- | --- |
| [CI/IPB](https://www.executivaipb.com.br/site/constituicao/constituicao.pdf) arts. 9, 25 §2, 110–112 | Who votes / who may be elected for Pastor, Elder, Deacon |
| [Modelo de Estatuto — Igreja Local](https://www.executivaipb.com.br/arquivos/estatuto_igreja.pdf) arts. 16–21 | Quorum and majority for local extraordinary assembly |
| [Manual Presbiteriano](https://www.executivaipb.com.br/arquivos/manual_presbiteriano_2025.pdf) (notes on arts. 110–112) | Secret ballot recommended for officer elections |
| [GTSI UPA (2022)](https://upa.org.br/wp-content/uploads/2023/09/GTSI-Aprovado-em-2022.pdf) arts. 12, 114, 120 | Quorum and multi-round rules for UPA board elections |
| SAF Guia do Trabalho Feminino | Similar absolute-majority + third-round pattern for society boards |

## A. Local church — Pastor, Elder (Presbítero), Deacon (Diácono)

### Who may vote and be voted (CI/IPB)

- **Voters and candidates** in the local assembly: members in **full communion** whose names are on the roll organized by the Session/Council (CI/IPB art. 112).
- For **church offices** (Pastor / Elder / Deacon): only **men**, over **18**, civilly capable may be voted (CI/IPB art. 25 §2).
- The Council calls the assembly, sets how many officers to elect, may suggest names, and issues election instructions (art. 111). Pastor instructs the church ≥ 30 days before (art. 111 sole paragraph).

### Quorum — extraordinary assembly (Modelo de Estatuto art. 19 §1)

| Call | Minimum presence |
| --- | --- |
| **1st call** | At least **1/3** of communicant members enrolled at the **seat** (sede) |
| **2nd call** | **Any number**, at least **7 days** after the first call |

Convocation must be at least **7 days** in advance.

### Majority and rounds (Modelo de Estatuto art. 21)

- Decisions require a majority representing **more than 50%** of the votes of communicant members **present** (absolute majority of votes cast among those present — commonly described in practice as “half + 1”).
- **§1** — More than one ballot (*escrutínio*) may be held to reach that majority.
- **§2** — In elections for Pastor / Elder / Deacon, when there are **more candidates than vacancies** and the majority is **not** reached on the **second** ballot, the assembly **may** finish by limiting further ballots to the **most voted** candidates.
- **§3** — Electronic or hybrid assemblies are allowed, **provided vote secrecy is ensured** (CE-2021).

### Secrecy

- Secret ballot is the recommended practice for officer elections (SC-1954 note in Manual Presbiteriano on art. 111).
- Electronic/hybrid mode explicitly requires secrecy (Estatuto art. 21 §3).

### Product mapping (preset: `ipb_local_officers`)

| Setting | Default suggestion |
| --- | --- |
| Quorum | Configurable; preset **1/3 of eligible roll** (1st call) |
| Win threshold | **> 50%** of valid votes in the round |
| Rounds | Up to 2 open rounds; then optional runoff limited to top N (N = vacancies or admin choice) |
| Ballot | Secret; one vote per eligible voter per round |
| Candidate pool | Communicant members; filter men ≥ 18 for elder/deacon |

---

## B. Internal societies — UPA (and similar: SAF)

### Quorum (GTSI UPA)

- Ordinary plenary: **more than half** of members on 1st call; 2nd call 15 minutes later with those present (art. 12 §1).
- Plenary **called for election**: must have **more than half** of members; cannot run below that (art. 12 §2; art. 114).

### Election procedure (GTSI UPA art. 120)

- Annual; **secret** ballot; **office by office**.
- Only **active** members vote.
- Candidates: active members who have been UPA members for **more than six months** (plus other art. 6 prerequisites).
- If on the **1st and 2nd** ballots nobody reaches **absolute majority**, a **3rd** ballot is held with the **two** most voted candidates.
- Elected = candidate with **more than half** of the votes.

### SAF (same pattern)

- Election plenary: more than half of members.
- Secret vote, office by office.
- If absolute majority not reached in 1st and 2nd ballots → continue with the **two** most voted until absolute majority.

### Product mapping (preset: `ipb_society_board`)

| Setting | Default suggestion |
| --- | --- |
| Quorum | **> 50%** of eligible society members |
| Win threshold | Absolute majority (**> 50%**) |
| Rounds | 1 → 2 → **runoff of top 2** |
| Ballot | Secret; one vote per eligible voter per round / office |
| Candidate pool | Society members meeting eligibility rules |

---

## C. Shared product rules (Scelta)

Independent of preset, every voting room should support:

1. **Admin-defined quorum** (absolute count or percentage of an eligible list).
2. **Quorum gate** before a result can be published (see section D). Opening a round does not require quorum; closing one does.
3. **Anonymous ballots** (system knows *that* a person voted, not *for whom*).
4. **One vote per person per round** (and per office when electing office-by-office).
5. **Start / pause / restart** controlled by admin (restart only with audit trail).
6. **Automatic tally** and clear winner / runoff / failed-quorum outcomes.
7. **Join via QR code** (or short link) into the room.
8. Optional **controlled reactions** (emojis) that must not leak ballot intent.

## D. Quorum gate

The checkpoint is the moment an admin closes a round. Presence is the number of participants with `is_present`. The required count is:

- **Absolute:** `quorum_value`. `eligible_count` does not change the threshold.
- **Percent:** `ceil(eligible_count * quorum_value / 100)`. If `eligible_count` is 0, the required count is 0 and quorum is **not** met. An empty eligible list must not look like a full room.

Closing while presence is below that count sets `rounds.outcome` to `failed_quorum` and closes the round. The product does not elect a winner and does not treat the people who showed up as a sufficient assembly.

Closing at or above quorum sets `outcome` to null. A later tally may set `elected` or `no_majority`. Closing does not choose a winner.

Publishing a winner is rejected until the latest **closed** round has outcome `elected`. `failed_quorum`, `no_majority`, a null outcome, or no closed round all fail closed. A later round may be opened while the room is `open` or `voting`. That does not clear a previous `failed_quorum`: publish stays rejected until a closed round is actually `elected`, or the room is reconfigured and a new round meets quorum.

## Open legal / product questions

- Confirm each local church’s adopted statute vs the national model (quorum % may differ).
- Confirm whether blank / null votes count in the denominator for “> 50%”.
- Tie-breaking when two candidates share “most voted” seats for runoff.
- Whether restart clears only the current round or the whole election.
- How communicant / society rolls are imported (CSV, manual, church system API).
