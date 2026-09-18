/**
 * ============================================================
 * AnalyticsTab.gs — Render the 🔎 Analytics sheet tab.
 *
 * Pure presentation over buildAnalytics() (AnalyticsData.js, T-005). Computes
 * nothing of its own (RFC-002 §9) — every figure comes straight off the
 * model, so this tab and the filed PDF (T-006) can never disagree.
 *
 * DERIVED OUTPUT, not data: rebuilt on demand only (never on a trigger),
 * safe to clear and rebuild at any time. It belongs alongside 🔁 Pool and
 * 📊 Fairness in refreshLabels_()'s re-render list, and describeDataAtRisk_()
 * must never warn about it — see Setup.js.
 * ============================================================
 */

/** Menu entry: rebuild the analytics tab on demand. */
function refreshAnalyticsTab() {
  toast_('Building analytics…', '🔎', 8);
  try {
    renderAnalyticsTab_();
    toast_('Done.', '✅');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Could not build 🔎 Analytics', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/** Total columns the widest table on this tab needs. */
var ANALYTICS_COLS = 11;

/**
 * 🔎 Analytics — every RFC-002 figure, laid out as sortable/filterable
 * tables one below the other. Batch I/O throughout: one setValues() and
 * (where a table needs status colour) one setBackgrounds() per table.
 */
function renderAnalyticsTab_() {
  var sheet = sheet_(SS.ANALYTICS);
  if (!sheet) return;

  var m = buildAnalytics();

  sheet.clear();
  sheet.clearConditionalFormatRules();
  bandTitle_(sheet, '🔎 Analytics', analyticsSubtitle_(m), ANALYTICS_COLS);

  var row = 3;

  if (m.empty) {
    sheet.getRange(row, 1, 1, ANALYTICS_COLS).merge()
      .setValue('No substitution history yet — figures will appear once the 🗂️ Log has assigned rows.')
      .setBackground(C.PAPER).setFontColor(C.SUBTLE).setFontStyle('italic').setVerticalAlignment('middle');
    sheet.setRowHeight(row, 28);
    row += 2;
  } else {
    row = writeAnalyticsKpiStrip_(sheet, row, m);
    row = writeEquitySection_(sheet, row, m);
    row = writeVarietySection_(sheet, row, m);
    row = writeTable_(sheet, row, 'Cross-tab — Substitute × Class',
      ['Substitute', 'Class', 'Count', '%'], crossTabRows_(m.crossTabs.subByClass));
    row = writeTable_(sheet, row, 'Cross-tab — Absent Teacher × Substitute',
      ['Absent teacher', 'Substitute', 'Count', '%'], crossTabRows_(m.crossTabs.absentBySub));
    row = writeTable_(sheet, row, 'Cross-tab — Weekday × Period',
      ['Weekday', 'Period', 'Count', '%'], crossTabRows_(m.crossTabs.dayByPeriod));
    row = writeTable_(sheet, row, 'Cross-tab — Class × Period',
      ['Class', 'Period', 'Count', '%'], crossTabRows_(m.crossTabs.classByPeriod));
    row = writeTable_(sheet, row, 'Weekly trend',
      ['Week', 'Duties', 'Need', 'Coverage %'],
      m.crossTabs.byWeek.map(function (w) { return [w.weekKey, w.duties, w.need, w.coverage]; }));
    row = writeClassViewSection_(sheet, row, m);
    row = writeGapsSection_(sheet, row, m);
  }

  var widths = [230, 130, 130, 90, 90, 90, 90, 90, 110, 110, 110];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(2);
  trimColumnsOnly_(sheet, ANALYTICS_COLS);
}

function analyticsSubtitle_(m) {
  if (m.empty) return 'Diagnostic only — no change to how substitutes are chosen.';
  var s = m.totalDuties + ' duties across ' + m.totalRows + ' log row(s) · data as of ' + (m.latestDate || '—');
  if (m.sourceErr) s += ' · ⚠️ source unavailable — teacher/department metadata degraded (' + m.sourceErr + ')';
  return s;
}

/* ───────── KPI strip ───────── */

function writeAnalyticsKpiStrip_(sheet, row, m) {
  var giniText = m.equity.gini === null ? 'n/a' : round2_(m.equity.gini) + ' (' + m.equity.giniBand + ')';
  kpi_(sheet, row, 1, 'Total duties', m.totalDuties, C.INDIGO, C.INDIGO_50);
  kpi_(sheet, row, 3, 'Coverage', m.gaps.coverageRate + '%', C.TEAL, C.TEAL_50);
  kpi_(sheet, row, 5, 'Gini (perWeight)', giniText, C.VIOLET, C.VIOLET_50);
  kpi_(sheet, row, 7, 'Never called', m.equity.neverCalled.length, C.ROSE, C.ROSE_50);
  kpi_(sheet, row, 9, 'Not in pool', m.equity.notInPool.length, C.SUBTLE, C.PAPER);
  return row + 2;
}

/* ───────── Equity (RFC §3) ───────── */

function writeEquitySection_(sheet, row, m) {
  var title = 'Equity — 🔴 Never called · 🟠 Below share (deficit < −1) · ⚪ Not in pool ' +
    '(no Substitution allotment row — the remedy is in the Allotment, not this engine)';
  var headers = ['Teacher', 'Department', 'Team', 'Weight', 'Duties', 'Fair share',
                 'Deficit', 'Per weight', 'Last duty', 'Days since last', 'Status'];

  var rows = [], statusColors = [];
  m.equity.members.forEach(function (r) {
    var status = equityStatus_(r);
    rows.push([
      r.teacher, r.dept, r.team, r.weight, r.duties,
      round2_(r.fairShare), round2_(r.deficit), round2_(r.perWeight),
      r.lastDuty || '—', r.daysSinceLast === null ? '—' : r.daysSinceLast, status.text,
    ]);
    statusColors.push(status.bg);
  });

  var headRow = row + 1;
  sectionBand_(sheet, row, title, headers.length);
  writeHeader_(sheet, headRow, headers);
  if (rows.length) {
    ensureRows_(sheet, headRow + rows.length);
    sheet.getRange(headRow + 1, 1, rows.length, headers.length).setValues(rows);
    zebra_(sheet, headRow + 1, rows.length, headers.length);
    var bgGrid = statusColors.map(function (bg) { return [bg]; });
    sheet.getRange(headRow + 1, headers.length, rows.length, 1).setBackgrounds(bgGrid).setFontWeight('bold');
  }
  return headRow + 1 + rows.length + 1;
}

function equityStatus_(r) {
  if (!r.inPool) return { text: '⚪ Not in pool', bg: C.BUSY_BG };
  if (r.neverCalled) return { text: '🔴 Never called', bg: C.BAD_BG };
  if (r.deficit < -1) return { text: '🟠 Below share', bg: C.WARN_BG };
  return { text: '🟢 On track', bg: C.OK_BG };
}

/* ───────── Variety (RFC §4) ───────── */

function writeVarietySection_(sheet, row, m) {
  var headers = ['Teacher', 'Duties', 'Variety: class', 'Variety: period', 'Variety: day',
                 'Overall variety', 'Top slot', 'Max repeat', 'Repeated slots', 'Repeat share'];
  var rows = m.variety.map(function (v) {
    return [
      v.teacher, v.duties,
      fmtVariety_(v.varietyClass), fmtVariety_(v.varietyPeriod), fmtVariety_(v.varietyDay),
      fmtVariety_(v.overallVariety),
      v.topSlot ? v.topSlot.replace(/\|/g, ' · ') + ' × ' + v.maxRepeat : '—',
      v.maxRepeat, v.repeatedSlots, round2_(v.repeatShare),
    ];
  });
  return writeTable_(sheet, row,
    'Variety — a single duty has no measurable variety and shows "—", never 0',
    headers, rows);
}

/** null → em dash, RFC §4.1: a single duty must never be shown as a 0. */
function fmtVariety_(v) { return v === null ? '—' : round2_(v); }

/* ───────── Cross-tabs (RFC §5) ─────────
 * The tab is explicitly allowed to show more than the capped PDF (RFC §5),
 * so every row computed by the model is shown, sorted largest first. */
function crossTabRows_(list) {
  return list.map(function (x) { return [x.row, x.col, x.n, x.pct]; });
}

/* ───────── Class-side view (RFC §6) ───────── */

function writeClassViewSection_(sheet, row, m) {
  var headers = ['Class', 'Total sub periods', 'Distinct substitutes', 'Most frequent substitute',
                 'Their count', 'Monotony %'];
  var rows = m.classView.map(function (c) {
    return [c.classSec, c.total, c.distinctSubstitutes, c.topSubstitute || '—', c.topCount, c.monotony];
  });
  return writeTable_(sheet, row, 'Class-side view — which class keeps seeing the same face', headers, rows);
}

/* ───────── Gap analysis (RFC §7) ───────── */

function writeGapsSection_(sheet, row, m) {
  row = writeTable_(sheet, row,
    'Gaps — ' + m.gaps.total + ' uncovered period(s), coverage rate ' + m.gaps.coverageRate + '%',
    ['Class', 'Uncovered'], m.gaps.byClass.map(function (x) { return [x.key, x.n]; }));
  row = writeTable_(sheet, row, 'Gaps by period',
    ['Period', 'Uncovered'], m.gaps.byPeriod.map(function (x) { return [x.key, x.n]; }));
  row = writeTable_(sheet, row, 'Gaps by weekday',
    ['Weekday', 'Uncovered'], m.gaps.byDay.map(function (x) { return [x.key, x.n]; }));
  row = writeTable_(sheet, row, 'Gaps by absent teacher',
    ['Absent teacher', 'Uncovered'], m.gaps.byAbsent.map(function (x) { return [x.key, x.n]; }));
  row = writeTable_(sheet, row, 'Gap trend by week',
    ['Week', 'Uncovered', 'Coverage %'], m.gaps.trend.map(function (w) { return [w.weekKey, w.uncovered, w.coverage]; }));
  return row;
}

/* ───────── shared table writer ─────────
 * One band row + one header row + at most one setValues() and one zebra_()
 * pass per table (RFC §9 / CLAUDE.md rule 3). Returns the next free row. */
function writeTable_(sheet, row, title, headers, rows) {
  sectionBand_(sheet, row, title, headers.length);
  var headRow = row + 1;
  writeHeader_(sheet, headRow, headers);
  if (rows.length) {
    ensureRows_(sheet, headRow + rows.length);
    sheet.getRange(headRow + 1, 1, rows.length, headers.length).setValues(rows);
    zebra_(sheet, headRow + 1, rows.length, headers.length);
  }
  return headRow + 1 + rows.length + 1;
}

/** A slim section band, distinct from the page-level bandTitle_. */
function sectionBand_(sheet, row, title, cols) {
  sheet.getRange(row, 1, 1, cols).merge().setValue(title)
    .setBackground(C.HEAD_BAND).setFontColor(C.HEAD_DARK).setFontWeight('bold').setFontSize(11)
    .setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(row, 24);
}

function round2_(n) { return Math.round(n * 100) / 100; }
