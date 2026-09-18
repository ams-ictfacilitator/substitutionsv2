# T-003 — Free-period guard: weekly report

**Branch:** `feat/t003-guard-reporting` · **Depends on:** T-001 (merged) · **Spec:** RFC-001 §7

## Goal
Show leadership that the guard is in force and what it costs.

## Files
| File | Change |
|---|---|
| `ReportData.js` | `buildRulesSummary_()` — add guard detail |
| `ReportRender.js` | `rulesPanel_()` — render it |

## Specification
- The existing `rulesPanel_()` already lists active rules from `ctx.active`; a guard rule
  will appear there automatically once T-001 pushes it. Confirm that, then add substance:
- For each working day of the reported week, compute how many pool members the guard caps
  at 0. This is derivable from the timetable and the rule alone — **no log column, and no
  schema change to `🗂️ Log`** (PRD N5).
- Render as one extra row in the rules card: e.g.
  `Free-period guard · 2–4 teachers held back per day`.
- Light palette only, table-based markup, consistent with the rest of `ReportRender.js`.
  No flexbox, no web fonts — the HTML→PDF converter supports neither.

## Acceptance
1. A week with an active guard shows it in the report's rules card with the per-day figure.
2. A week with no guard rule renders exactly as before.
3. No change to `LOG_HEADERS` or any tab schema.
4. `node test/run.js` green.

## Out of scope
Per-assignment attribution in the log. Deliberately not done — see RFC-001 §9.
