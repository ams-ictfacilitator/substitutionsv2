# T-001 — Free-period guard: core

**Branch:** `feat/t001-free-period-guard` · **Depends on:** — · **Spec:** `docs/rfc/RFC-001-free-period-guard.md`

## Goal
Add the `FREE_PERIOD_GUARD` rule type and enforce it in the assignment engine.

## Files
| File | Change |
|---|---|
| `Constants.js` | add the rule type to `RULE_TYPES` |
| `Rules.js` | ladder parsing, compilation, free-period map, `freeGuardCap_()` |
| `Assign.js` | thread `dayIndex` into scan state; add the guard check in `scanCandidates_()` |
| `test/freeguard.test.js` | new |

## Specification
Read RFC-001 §3–§6 in full. In short:
- Tab row: `Then = 1:0, 2:1` → `{1:0, 2:1}`. Counts not listed are unconstrained.
- Free periods come from **`getTimetable()` + `getStaffDuties()` only** — never from the
  engine's `busy` map, which already absorbs committed cover (RFC §5). Getting this wrong
  makes the cap shrink with every assignment.
- The check is **hard**, placed next to the existing floor-limit check in
  `scanCandidates_()`, and applies in both the dedicated and fallback passes.
- Add a `blockedByFreeGuard` counter to the object `scanCandidates_()` returns.

## Patterns to follow
- `FLOOR_LIMIT` in `Rules.js` is the closest analogue: registry entry → compile in
  `buildRuleContext_()` → hard check in `scanCandidates_()`. Mirror its shape.
- `buildHomeBlocks_()` shows the one-pass-over-the-timetable, memoised-in-context idiom.
- A malformed rule must go to `ctx.problems` and be skipped — never throw (PRD N6).

## Acceptance
1. 1 free period → 0 substitutions; 2 → at most 1; 3+ → unchanged from baseline.
2. Assigning cover does not change a teacher's free-period count within a run.
3. A guard-capped dedicated substitute is skipped and the dedicated rule falls back.
4. Unparseable ladder → recorded in `ctx.problems`, rule skipped, plan still produced.
5. Disabled / expired rule → behaviour identical to baseline.
6. `node test/run.js` fully green, including the existing 14 checks.

## Tests to write — `test/freeguard.test.js`
Follow `test/rules.test.js`. The fixture exposes `fixtureFreeCount(name)` and a mutable
`DUTIES` array you can push to in order to manufacture a teacher with exactly N free
periods. Cover acceptance 1–5 plus the uncovered-reason counter being incremented.

## Out of scope
Diagnostics wording (T-002), report surfacing (T-003), docs (T-004).
