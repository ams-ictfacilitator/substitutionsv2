# T-005 — Analytics engine

**Branch:** `feat/t005-analytics-engine` · **Depends on:** — · **Spec:** `docs/rfc/RFC-002-substitution-analytics.md` §2–§8

## Goal
`AnalyticsData.js` — one pure function, `buildAnalytics()`, returning the whole model.
No rendering, no sheet writes, no side effects.

## Files
| File | Change |
|---|---|
| `AnalyticsData.js` | new |
| `test/analytics.test.js` | new |

## Specification
RFC-002 §3–§7 define every metric precisely. Implement them exactly — the formulas are
the contract. Particular care:
- **Variety normalisation** (§4.1): `Hmax = log2(min(duties, K))` where `K` is the
  school-wide count of that dimension, not the teacher's own. Getting this wrong makes
  everyone with few duties look varied.
- **`null`, not `0`**, for variety at `duties <= 1`. A teacher called once has no
  measurable variety and must never be rendered as "0 variety".
- **Three cohorts** (§3) must be separate arrays: `neverCalled`, `belowShare`, `notInPool`.
  A teacher with no `Substitution` allotment belongs only in `notInPool`.
- **Gini** (§3): guard `Σx = 0` and return null rather than dividing by zero.
- Only `ASSIGNED` rows are duties; `UNASSIGNED` rows feed §7 gap analysis.

## Patterns to follow
- `ReportData.js` `buildWeeklyReportData()` is the model to copy: read once via
  `readLogRows_()`, degrade gracefully when the source workbook is unreachable (wrap
  `buildPool()` / `getTeacherMeta()` in try/catch and set a `sourceErr`), return one
  plain object.
- Reuse the existing helpers in `ReportData.js` — `distinct_`, `sum_`, `pct_`, `values_`,
  `pick_`, `isAssigned_`, `parseClassPart_`, `parseSectionPart_`. Do not duplicate them.
- One pass over the log building all maps together (§8). Do not loop the log per metric.

## Acceptance
RFC-002 §11 items 1–8. All must be covered by tests.

## Tests — `test/analytics.test.js`
Follow `test/rules.test.js` (global `check(label, cond, detail)` from `test/run.js`).
Load with `harness.load(DEFAULT_FILES.concat(['ReportData.js','AnalyticsData.js']), SCHOOL)`.
Build small purpose-made log arrays inline — you need precise control of duty
distributions to assert on entropy and Gini, so do not rely on the shared fixture's log.

## Out of scope
Rendering (T-006), the sheet tab (T-007), documentation (T-008). Do not create them.
