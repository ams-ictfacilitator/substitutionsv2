# T-006 — Analytics PDF

**Branch:** `feat/t006-analytics-pdf` · **Depends on:** T-005 (merged) · **Spec:** RFC-002 §9

## Goal
Render the analytics model as a printable PDF, file it to Drive, index it in `📄 Reports`.

## Files
| File | Change |
|---|---|
| `AnalyticsRender.js` | new — model → HTML |
| `Analytics.js` | new — orchestration, menu handlers |
| `Code.js` | menu entries |
| `test/analytics-render.test.js` | new |

## Specification
- **Compute nothing.** Every figure comes from the T-005 model. If something is missing,
  that is a T-005 bug — raise it, do not patch around it in the renderer.
- Structure: headline equity figures → the three cohorts → ranked comparative table of
  every teacher (duties, weight, fair share, deficit, variety, max repeat) → outlier
  profiles (capped at 12) → cross-tabs → class-side monotony → gap analysis.
- Outlier selection: never called, then furthest below share, then lowest overall variety.
- **Rendering constraints are identical to `ReportRender.js`** and non-negotiable: Apps
  Script's HTML→PDF converter has no flexbox, no CSS grid, no web fonts. Table-based
  layout, inline styles, the light `RC` palette, `@page` A4. Read `ReportRender.js` and
  match it exactly — reuse `hbar_`, `miniCard_`, `sectionTitle_`, `panel_`, `zebraStyle_`.
- No signature block — this is an analysis, not a return.
- Filing: reuse `resolveReportsFolder_()` and `recordReport_()` from `Reports.js`. The
  file name must be clearly distinguishable from the weekly report.
- Menu: add under the existing `📄 Weekly report` submenu or a sibling — your judgement,
  but follow the established `addItem` style and add a preview that opens the same HTML in
  a modal, as `previewWeeklyReport()` does.

## Acceptance
1. Generates a PDF, files it, and adds a row to `📄 Reports` distinguishable from weekly rows.
2. Preview renders the same HTML in a modal.
3. An empty log renders a valid document rather than throwing.
4. Source workbook unreachable → renders with a notice, weights omitted.
5. No `undefined`/`NaN` in output; `<table>`/`</table>` balanced.
6. `node test/run.js` fully green, including every pre-existing check.

## Out of scope
The sheet tab (T-007). Changing any T-005 metric.
