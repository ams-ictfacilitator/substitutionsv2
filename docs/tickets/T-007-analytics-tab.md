# T-007 — Live Analytics tab

**Branch:** `feat/t007-analytics-tab` · **Depends on:** T-005 (merged) · **Spec:** RFC-002 §9

## Goal
`🔎 Analytics` — a sheet tab rebuilt on demand from the same model, for digging around.

## Files
| File | Change |
|---|---|
| `AnalyticsTab.js` | new |
| `Constants.js` | add `SS.ANALYTICS` |
| `Setup.js` | tab order, `upgradeTabs()` builder list, `describeDataAtRisk_` if relevant |
| `Code.js` | menu entry |
| `test/analytics-tab.test.js` | new |

## Specification
- **Compute nothing** — same rule as T-006. Every figure from the T-005 model.
- The tab is **derived output, not data**. It is safe to clear and rebuild, so it belongs
  with `🔁 Pool` and `📊 Fairness` in `refreshLabels_()`'s re-render list, **not** in the
  never-touch list. Make sure `describeDataAtRisk_()` does not warn about it.
- Batch I/O is a house non-negotiable: one `setValues` per table, one `setBackgrounds` per
  table. No per-cell writes in loops. Read `Dashboard.js` `renderPool_()` and copy its
  shape — `bandTitle_`, `writeHeader_`, `zebra_`, `cleanGrid_`.
- Frozen headers; estate status vocabulary for colour, always paired with text not colour
  alone; every table a plain range so it can be sorted and filtered.
- Use `trimColumnsOnly_()`, never `trimColumns_()` — this tab can exceed 200 rows with 60
  teachers plus cross-tabs, and `trimColumns_` would cap the grid.
- Call `ensureRows_()` before any write that could exceed the current grid.

## Acceptance
1. Menu item builds the tab; running it twice is idempotent and does not duplicate rows.
2. Figures match the PDF exactly for the same input (RFC-002 §11 item 9).
3. Tab handles 60+ teachers without exceeding the grid.
4. `upgradeTabs()` creates it when missing and never warns it holds data at risk.
5. `node test/run.js` fully green.

## Out of scope
The PDF (T-006). Changing any T-005 metric.
