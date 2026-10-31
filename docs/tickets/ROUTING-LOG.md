# Routing log

Cross-review rule: Sonnet reviews Codex, Codex reviews Sonnet. Codex and Antigravity ran out of quota partway through (2026-10-24 to 2026-10-26), so from T-014 onward builds went to `sonnet-worker` and reviews were done by a separate Sonnet instance. That is a weaker check than a second vendor; every review used a written "bar" (data loss, wrong write, PRD violation) and mutation-checked the key safety tests in a scratch copy.

| Ticket | Rule | Worker | Fell back? | Attempts | Tests after | Review | Result |
|---|---|---|---|---|---|---|---|
| T-009 One Way contract | Q3 code | codex, then sonnet | no | codex x2, sonnet x1 | 130 | codex PASS after fixes; caught a Register width defect | merged #18 |
| T-010 Register header-name I/O | Q3 code | codex, then sonnet | no | codex x2, sonnet x2 | 152 | sonnet then codex; 4 rounds; added commitPlan pre-flight | merged #20 |
| T-011 Roster tabs, sync, Staff Code lock | Q2 identity | sonnet | no | 3 rounds | 316 | codex, 3 rounds; 18 defects fixed | merged #21 |
| T-012 Matching engine | Q2 identity | sonnet | no | 6 rounds | 257 | codex, 6 rounds (device accounts, held emails/codes, rename chains, Resource Persons) | merged #19 |
| T-014 Markable teachers | Q3 code | sonnet (codex quota) | codex quota | 1 | 512 | sonnet PASS | merged #22 |
| T-016 Join keys at mark time | Q3 code | sonnet (codex quota) | codex quota | 1 | 505 | sonnet PASS | merged #23 |
| T-020 HR Database reader | Q2 PII | sonnet | review: codex + agy quota | 1 | 556 | sonnet PASS; mutation-checked PII sentinel | merged #24 |
| T-015 Contact resolution | Q2 DM risk | sonnet | review: codex + agy quota | 2 | 670 | sonnet FAIL then PASS | merged #25 |
| T-018 Non-Teaching tab | Q3 code | sonnet (codex quota) | codex quota | 2 | 732 | sonnet FAIL (Date text, key carry-over, placeholder) then PASS | merged #26 |
| T-017 Backfill | Q2 live-data write | sonnet | no | 1 (resumed after rate limit) | 863 | sonnet PASS; mutation-checked | merged #27 |
| T-013 Review and Apply | Q2 identity | sonnet | no | 2 (resumed after rate limit) | 1006 | sonnet FAIL (rebased decision, wiped rows on outage) then PASS | merged #28 |
| T-019 Docs | Q4 | haiku | no | 1 | 1006 | not cross-reviewed (docs) | this PR |
| T-021 Category default, unmapped info rows, dropdown refresh | Q2 roster data | sonnet | no | 1 (worker died when the machine slept; edits intact) | 1018 | sonnet PASS; revert-checked | merged (live-rollout finding 2026-10-30) |

## Known issues carried forward (not blocking)
- T-010: `ensureAbsenceKeyNotes_` does per-cell note calls for two header cells.
- T-015: no test runs `commitPlan` to prove the new result fields are passed through; the Sidebar check is a source regex.
- T-017: the formula-cell guard and the `used[]` guard have no tests; a whitespace-only cell counts as blank.
- T-018: multi-column paste rewrites the span between touched columns; sheet-side validations/formulas are tested only against a mock.
- T-020: header names are editable on Roster Settings (so protect that tab); the record loop has no outer try/catch.
- Everything: no run against a live Sheet has happened.
