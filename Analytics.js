/**
 * ============================================================
 * Analytics.gs — Substitution analytics: preview, generate, file (T-006).
 *
 *   previewAnalyticsReport()   — on-screen, nothing saved
 *   generateAnalyticsReport()  — build → render → PDF → Drive → 📄 Reports
 *
 * Mirrors Reports.js's weekly-report orchestration exactly, but over the
 * whole log rather than one week, and keyed by a pseudo weekKey
 * ('ANALYTICS') so its row and file are always distinguishable from a real
 * week's ('2026-W37', …) and regenerating it replaces the same row/file
 * rather than piling up duplicates.
 * ============================================================
 */

var ANALYTICS_WEEKKEY = 'ANALYTICS';

/* ───────── menu entry points ───────── */

/** Preview the analytics report on screen. Nothing is written. */
function previewAnalyticsReport() {
  clearCache();
  var d = buildAnalytics();
  var html = renderAnalyticsHtml_(d, {
    seq: nextSequenceFor_(ANALYTICS_WEEKKEY),
    generatedOn: prettyDate_(new Date()),
    generatedBy: activeEmail_(),
    preview: true,
  });
  var out = HtmlService.createHtmlOutput(html).setWidth(920).setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(out, '📊 Substitution Analytics');
}

/** Generate and file the analytics report over all recorded history. */
function generateAnalyticsReport() {
  var ui = SpreadsheetApp.getUi();
  toast_('Building the analytics report…', '📊', 20);
  try {
    var out = generateAnalyticsReport_();
    ss_().setActiveSheet(sheet_(SS.REPORTS));
    ui.alert('📊 Analytics report ' + pad3_(out.seq) + ' ready',
      'Totals: ' + out.totalDuties + ' duties over ' + out.totalRows + ' log row(s)\n' +
      'Gini: ' + (out.gini === null ? 'n/a' : out.gini) + ' (' + out.giniBand + ')\n\n' +
      (out.replaced ? 'A previous analytics report existed — it was replaced.\n\n' : '') +
      'Saved to: ' + out.folderName + '\n\nThe link is in the 📄 Reports tab.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Could not generate the analytics report', e.message, ui.ButtonSet.OK);
  }
}

/* ───────── orchestration ───────── */

/**
 * Build → render → PDF → Drive → Reports tab.
 * Regenerating reuses the same pseudo-week's row/number and replaces its file,
 * exactly as generateWeeklyReport_() does for a real week.
 */
function generateAnalyticsReport_() {
  // Resolve Drive first: it may write the folder id back to Config, which
  // clears the execution cache. Everything after this reads a clean cache.
  var folder = resolveReportsFolder_();

  clearCache();
  var cfg = getConfig();
  var d = buildAnalytics();
  var existing = findReportRow_(ANALYTICS_WEEKKEY);
  var seq = existing ? existing.seq : nextSequenceFor_(ANALYTICS_WEEKKEY);
  var generatedOn = prettyDate_(new Date());
  var by = activeEmail_();

  var html = renderAnalyticsHtml_(d, { seq: seq, generatedOn: generatedOn, generatedBy: by });
  var baseName = analyticsFileName_(cfg, seq, d);
  var blob = Utilities.newBlob(html, 'text/html', baseName + '.html')
    .getAs('application/pdf').setName(baseName + '.pdf');

  // replace the previous analytics file, if any
  if (existing && existing.fileId) {
    try { DriveApp.getFileById(existing.fileId).setTrashed(true); } catch (e) { /* already gone */ }
  }
  var file = folder.createFile(blob);
  file.setDescription(cfg.schoolName + ' — substitution analytics over all recorded history'
    + (d.latestDate ? ' as of ' + d.latestDate : '') + ', generated ' + generatedOn + '.');

  recordReport_({
    seq: seq, weekKey: ANALYTICS_WEEKKEY,
    span: 'All history' + (d.latestDate ? ' — as of ' + d.latestDate : ''),
    generatedOn: generatedOn, by: by,
    kpi: analyticsKpiForRecord_(d),
    balance: d.equity.gini === null ? 0 : Math.round((1 - d.equity.gini) * 1000) / 10,
    url: file.getUrl(), fileId: file.getId(),
    row: existing ? existing.row : null,
  });

  return {
    seq: seq, totalDuties: d.totalDuties, totalRows: d.totalRows,
    gini: d.equity.gini === null ? null : Math.round(d.equity.gini * 100) / 100,
    giniBand: d.equity.giniBand,
    url: file.getUrl(), fileId: file.getId(), folderName: folder.getName(),
    replaced: !!existing,
  };
}

/**
 * Analytics has no direct equivalent of the weekly KPI block, but
 * recordReport_() (Reports.js) writes fixed columns, so the closest honest
 * mapping is used: total log rows stand in for "absences", total duties for
 * "periods lost"/"covered" (nothing was lost to analytics — every duty here
 * already happened), gap count for "uncovered", and the log-wide coverage
 * rate for "coverage %". This keeps the 📄 Reports tab's columns meaningful
 * without inventing a new figure — every value here already exists on `d`.
 */
function analyticsKpiForRecord_(d) {
  return {
    // The 📄 Reports tab's columns were designed for the weekly report. "Absences"
    // has no whole-history equivalent — total log rows is not a count of absences —
    // so leave it blank rather than put a wrong number under the label.
    teacherDays: '',
    periodsLost: d.totalDuties + d.gaps.total,
    covered: d.totalDuties,
    uncovered: d.gaps.total,
    coverage: d.gaps.coverageRate,
  };
}

/** "Substitution Analytics 003 — as of 2026-09-18" — distinguishable from a weekly report's filename. */
function analyticsFileName_(cfg, seq, d) {
  return norm_(cfg.reportPrefix) + ' Analytics ' + pad3_(seq)
    + (d.latestDate ? ' — as of ' + d.latestDate : '');
}
