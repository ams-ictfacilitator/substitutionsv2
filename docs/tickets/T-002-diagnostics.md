# T-002 — Free-period guard: diagnostics and surfacing

**Branch:** `feat/t002-guard-diagnostics` · **Depends on:** T-001 (merged) · **Spec:** RFC-001 §7–§8

## Goal
Make the guard explainable: validate it before it costs cover, and say when it is the
reason a period went uncovered.

## Files
| File | Change |
|---|---|
| `Assign.js` | `noCandidateReason_()` — add the free-guard clause |
| `Rules.js` | `checkRules()` — validate ladders, estimate pool impact |

## Specification
- `noCandidateReason_()` gains a clause using the `blockedByFreeGuard` counter T-001 added,
  e.g. `No substitute free — 3 protected by the free-period guard, 2 already teaching`.
  Keep the existing clause order and comma style.
- `checkRules()` for `FREE_PERIOD_GUARD`:
  - ladder parses; every key and value a non-negative integer;
  - warn (do not fail) if a `max subs` exceeds the free-period count it is keyed to;
  - when the source workbook is reachable, compute for each working day how many pool
    members would be capped at 0, and warn above 50 % of the pool.
- Follow the existing per-type `if (r.type.id === …)` branch style in `checkRules()`.

## Acceptance
1. An uncovered period caused by the guard names it in `reason`, visible in the side panel
   and as a Mark Absence cell note (both already render `reason` — no UI change needed).
2. `🧪 Check rules` flags `1-0` (wrong separator) as unusable.
3. `🧪 Check rules` warns when a guard would block more than half the pool.
4. `node test/run.js` green; add checks for 1–3 in `test/freeguard.test.js`.

## Out of scope
Changing how `reason` is rendered anywhere — it already flows through.
