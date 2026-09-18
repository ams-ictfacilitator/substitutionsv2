/**
 * ============================================================
 * Reports.gs — Weekly Principal report: generate, file, record, announce.
 *
 *   previewWeeklyReport()          — on-screen, nothing saved
 *   generateLastWeekReport()       — the usual manual run
 *   generateReportForWeekPrompt()  — any week, by date
 *   runWeeklyReportTrigger()       — Monday-morning time trigger
 *
 * The PDF lands in a sibling Drive folder named after the folder this
 * workbook lives in, with the closing bracket reopened:
 *      "Substitutions [2026-27]"  →  "Substitutions [2026-27 REPORTS]"
 * ============================================================
 */

const REPORT_HEADERS = ['#', 'Week', 'Period covered', 'Generated', 'By', 'Absences',
                        'Periods lost', 'Covered', 'Uncovered', 'Coverage %', 'Balance %',
                        'Report', 'File ID'];
const REPORT_LINK_COL = 12;
const REPORT_FILEID_COL = 13;
const REPORT_DATA_START = 3;

/* ───────── menu entry points ───────── */

/** Preview the last completed week on screen. Nothing is written. */
function previewWeeklyReport() {
  previewReportForWeek_(lastCompleteWeekKey_());
}

/** Preview the week currently in progress. */
function previewThisWeekReport() {
  previewReportForWeek_(weekKey_(new Date()));
}

function previewReportForWeek_(weekKey) {
  clearCache();
  var d = buildWeeklyReportData(weekKey);
  var html = renderReportHtml_(d, {
    seq: nextSequenceFor_(weekKey),
    generatedOn: prettyDate_(new Date()),
    generatedBy: activeEmail_(),
    preview: true,
  });
  var out = HtmlService.createHtmlOutput(html).setWidth(920).setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(out, '📄 Weekly Report — ' + d.span.label);
}

/** Generate and file the report for the last completed week. */
function generateLastWeekReport() {
  runReportGeneration_(lastCompleteWeekKey_(), false);
}

/** Generate and file the report for the week in progress (partial). */
function generateThisWeekReport() {
  runReportGeneration_(weekKey_(new Date()), false);
}

/** Ask for any date, report on the week containing it. */
function generateReportForWeekPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('📄 Weekly report',
    'Enter any date inside the week you want (DD/MM/YYYY):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var d = parseDate_(res.getResponseText());
  if (!d) { toast_('Unreadable date.', '⚠️'); return; }
  runReportGeneration_(weekKey_(d), false);
}

/** Time-trigger handler: the week that ended yesterday. */
function runWeeklyReportTrigger() {
  try {
    generateWeeklyReport_(lastCompleteWeekKey_(), true);
  } catch (e) {
    Logger.log('Weekly report trigger failed: ' + e.message);
    notifyOpsFailure_('Weekly report', e.message);
  }
}

/* ───────── orchestration ───────── */

function runReportGeneration_(weekKey, silent) {
  var ui = SpreadsheetApp.getUi();
  toast_('Building the report for ' + weekKey + '…', '📄', 20);
  try {
    var out = generateWeeklyReport_(weekKey, silent);
    ss_().setActiveSheet(sheet_(SS.REPORTS));
    ui.alert('📄 Report ' + pad3_(out.seq) + ' ready',
      out.span + '\n\n' +
      out.kpi.teacherDays + ' teacher-day(s) absent · ' + out.kpi.periodsLost + ' period(s) lost\n' +
      out.kpi.covered + ' covered · ' + out.kpi.uncovered + ' uncovered · ' + out.kpi.coverage + '% coverage\n\n' +
      (out.replaced ? 'This week already had a report — it was replaced.\n\n' : '') +
      'Saved to: ' + out.folderName + '\n' +
      (out.chatPosted ? 'A summary card was posted to the Chat space.\n' : '') +
      '\nThe link is in the 📄 Reports tab.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Could not generate the report', e.message, ui.ButtonSet.OK);
  }
}

/**
 * Build → render → PDF → Drive → Reports tab → Chat.
 * Regenerating a week reuses its number and replaces its file.
 */
function generateWeeklyReport_(weekKey, silent) {
  // Resolve Drive first: it may write the folder id back to Config, which
  // clears the execution cache. Everything after this reads a clean cache.
  var folder = resolveReportsFolder_();

  clearCache();
  var cfg = getConfig();
  var data = buildWeeklyReportData(weekKey);
  var existing = findReportRow_(weekKey);
  var seq = existing ? existing.seq : nextSequenceFor_(weekKey);
  var generatedOn = prettyDate_(new Date());
  var by = activeEmail_();

  var html = renderReportHtml_(data, { seq: seq, generatedOn: generatedOn, generatedBy: by });
  var baseName = reportFileName_(cfg, seq, data);
  var blob = Utilities.newBlob(html, 'text/html', baseName + '.html')
    .getAs('application/pdf').setName(baseName + '.pdf');

  // replace the previous file for this week, if any
  if (existing && existing.fileId) {
    try { DriveApp.getFileById(existing.fileId).setTrashed(true); } catch (e) { /* already gone */ }
  }
  var file = folder.createFile(blob);
  file.setDescription(cfg.schoolName + ' — weekly substitution report for ' + data.span.label +
                      ' (' + weekKey + '), generated ' + generatedOn + '.');

  recordReport_({
    seq: seq, weekKey: weekKey, span: data.span.label, generatedOn: generatedOn, by: by,
    kpi: data.kpi, balance: data.fairness.balance, url: file.getUrl(), fileId: file.getId(),
    row: existing ? existing.row : null,
  });

  var chatPosted = false;
  if (cfg.postReportToChat && cfg.chatWebhook) {
    try { postChatCard_(cfg.chatWebhook, buildReportCard_(data, cfg, seq, file.getUrl())); chatPosted = true; }
    catch (e) {
      Logger.log('Report Chat post failed: ' + e.message);
      if (!silent) toast_('Report saved, but the Chat post failed: ' + e.message, '⚠️', 10);
    }
  }

  return { seq: seq, weekKey: weekKey, span: data.span.label, kpi: data.kpi,
           url: file.getUrl(), fileId: file.getId(), folderName: folder.getName(),
           replaced: !!existing, chatPosted: chatPosted };
}

/* ───────── Drive ───────── */

/**
 * Find (or create once) the reports folder, as a SIBLING of the folder this
 * workbook lives in. The resolved id is cached in ⚙️ Config so a later rename
 * of either folder cannot strand the reports.
 */
function resolveReportsFolder_() {
  var cfg = getConfig();
  var saved = norm_(cfg.reportsFolderId);
  if (saved) {
    try {
      var f = DriveApp.getFolderById(saved);
      if (!f.isTrashed()) return f;
    } catch (e) { /* fall through and re-derive */ }
  }

  var sheetFolder = null;
  try {
    var parents = DriveApp.getFileById(ss_().getId()).getParents();
    if (parents.hasNext()) sheetFolder = parents.next();
  } catch (e) {
    throw new Error('Could not read this workbook\'s Drive folder. ' + e.message);
  }

  var baseName = sheetFolder ? sheetFolder.getName() : (cfg.schoolName + ' Substitutions');
  var targetName = reportsFolderName_(baseName);

  var container = null;
  if (sheetFolder) {
    var gp = sheetFolder.getParents();
    if (gp.hasNext()) container = gp.next();
  }

  var found = container ? container.getFoldersByName(targetName) : DriveApp.getFoldersByName(targetName);
  var folder = found.hasNext() ? found.next()
    : (container ? container.createFolder(targetName) : DriveApp.createFolder(targetName));

  setConfigValue_('Reports Folder ID', folder.getId());
  return folder;
}

/** "Substitutions [2026-27]" → "Substitutions [2026-27 REPORTS]". */
function reportsFolderName_(name) {
  var s = norm_(name);
  if (!s) return 'Substitution REPORTS';
  return /\]\s*$/.test(s) ? s.replace(/\s*\]\s*$/, '') + ' REPORTS]' : s + ' REPORTS';
}

/** "Substitution Report 007 — 15 Jun-19 Jun 2026 (2026-W25)" */
function reportFileName_(cfg, seq, data) {
  return norm_(cfg.reportPrefix) + ' ' + pad3_(seq) + ' — ' + data.span.fileLabel + ' (' + data.weekKey + ')';
}

/* ───────── 📄 Reports tab ───────── */

/** Create a tab if it is missing, then run its builder. Returns the sheet. */
function ensureTab_(name, writer) {
  var sheet = sheet_(name);
  if (!sheet) { ss_().insertSheet(name); writer(); sheet = sheet_(name); }
  return sheet;
}

function writeReportsTab_() {
  var sheet = sheet_(SS.REPORTS);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  titleBand_(sheet, '📄 Reports', REPORT_HEADERS.length);
  sheet.getRange(2, 1, 1, REPORT_HEADERS.length).setValues([REPORT_HEADERS])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
  var widths = [46, 84, 190, 130, 190, 80, 90, 78, 88, 90, 84, 230, 60];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(2);
  sheet.getRange('A1').setNote('Newest report first. Each row links to the PDF in the Drive reports folder.\n' +
    'Regenerating a week replaces its PDF and updates its row — the number never changes.');
  trimColumnsOnly_(sheet, REPORT_HEADERS.length);
}

/** Existing row for a week, or null. */
function findReportRow_(weekKey) {
  var rows = readReportRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i].weekKey === weekKey) return rows[i];
  return null;
}

function readReportRows_() {
  var sheet = sheet_(SS.REPORTS);
  if (!sheet || sheet.getLastRow() < REPORT_DATA_START) return [];
  var n = sheet.getLastRow() - REPORT_DATA_START + 1;
  var data = sheet.getRange(REPORT_DATA_START, 1, n, REPORT_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    if (!norm_(data[i][1])) continue;
    out.push({ seq: toInt_(data[i][0], 0), weekKey: norm_(data[i][1]),
               fileId: norm_(data[i][REPORT_FILEID_COL - 1]),
               row: REPORT_DATA_START + i });
  }
  return out;
}

function nextSequenceFor_(weekKey) {
  var rows = readReportRows_();
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].weekKey === weekKey) return rows[i].seq;
    max = Math.max(max, rows[i].seq);
  }
  return max + 1;
}

/** Insert (newest first) or update the row for this week. */
function recordReport_(r) {
  var sheet = ensureTab_(SS.REPORTS, writeReportsTab_);
  if (!sheet) return;
  var row = r.row;
  if (!row) {
    ensureRows_(sheet, REPORT_DATA_START);
    if (sheet.getLastRow() >= REPORT_DATA_START) sheet.insertRowsAfter(REPORT_DATA_START - 1, 1);
    row = REPORT_DATA_START;
  }
  var values = [[
    r.seq, r.weekKey, r.span, r.generatedOn, r.by,
    r.kpi.teacherDays, r.kpi.periodsLost, r.kpi.covered, r.kpi.uncovered,
    r.kpi.coverage / 100, r.balance / 100, '', r.fileId,
  ]];
  sheet.getRange(row, 1, 1, REPORT_HEADERS.length).setValues(values);
  sheet.getRange(row, REPORT_LINK_COL)
    .setFormula('=HYPERLINK("' + r.url + '","📄 Open report ' + pad3_(r.seq) + '")');
  sheet.getRange(row, REPORT_FILEID_COL).setFontColor(C.HAIRLINE).setFontSize(7);
  sheet.getRange(row, 10, 1, 2).setNumberFormat('0.0%');
  sheet.getRange(row, 1, 1, REPORT_HEADERS.length)
    .setBackground(C.WHITE).setFontColor(C.INK)
    .setBorder(null, null, true, null, null, null, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(row, 1).setFontWeight('bold').setFontColor(C.INDIGO).setHorizontalAlignment('center');
  sheet.getRange(row, 6, 1, 6).setHorizontalAlignment('center');
  sheet.getRange(row, 9).setFontColor(r.kpi.uncovered ? C.ROSE : C.SUBTLE).setFontWeight('bold');
  sheet.getRange(row, 10).setFontColor(r.kpi.uncovered ? C.AMBER : C.GREEN).setFontWeight('bold');
  clearCache();
}

/* ───────── Chat announcement ───────── */

function buildReportCard_(d, cfg, seq, url) {
  var k = d.kpi;
  var clean = k.uncovered === 0;
  var widgets = [
    { decoratedText: { startIcon: { knownIcon: 'PERSON' },
      topLabel: 'Absence',
      text: '<b>' + k.teacherDays + '</b> teacher-day' + s_(k.teacherDays) + ' · <b>' + k.periodsLost + '</b> period' + s_(k.periodsLost) + ' lost',
      wrapText: true } },
    { decoratedText: { startIcon: { knownIcon: 'CONFIRMATION_NUMBER_ICON' },
      topLabel: 'Cover',
      text: '<b>' + k.covered + '</b> covered by ' + k.substitutes + ' substitute' + s_(k.substitutes)
        + (clean ? '  ·  <font color="#2A9160">all covered 🎉</font>'
                 : '  ·  <font color="#D3455C"><b>' + k.uncovered + '</b> uncovered</font>'),
      wrapText: true } },
    { decoratedText: { startIcon: { knownIcon: 'DESCRIPTION' },
      topLabel: 'Balance',
      text: 'Coverage <b>' + k.coverage + '%</b>  ·  load balance <b>' + d.fairness.balance + '%</b>',
      bottomLabel: 'Fairness basis: ' + cfg.fairnessBasis,
      wrapText: true } },
  ];
  if (d.callouts.length) {
    widgets.push({ decoratedText: { startIcon: { knownIcon: 'STAR' },
      topLabel: d.callouts[0].label, text: '<b>' + esc_(d.callouts[0].value) + '</b>',
      bottomLabel: d.callouts[0].note, wrapText: true } });
  }
  widgets.push({ buttonList: { buttons: [{ text: 'Open the report (PDF)',
    onClick: { openLink: { url: url } } }] } });

  return {
    text: '📄 Weekly Substitution Report ' + pad3_(seq) + ' — ' + d.span.label + ' · '
      + k.periodsLost + ' periods lost, ' + k.covered + ' covered, ' + k.uncovered + ' uncovered.',
    cardsV2: [{ cardId: 'report-' + d.weekKey, card: {
      header: { title: 'Weekly Substitution Report ' + pad3_(seq),
                subtitle: d.span.label + '  ·  ' + cfg.termLabel,
                imageUrl: 'https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/lab_profile/default/48px.svg',
                imageType: 'CIRCLE' },
      sections: [{ widgets: widgets }],
    }}],
  };
}

/* ───────── the Monday trigger ───────── */

/** Install / refresh the weekly time trigger from ⚙️ Config. Idempotent. */
function ensureReportTrigger_() {
  var cfg = getConfig();
  var trs = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trs.length; i++) {
    if (trs[i].getHandlerFunction() === 'runWeeklyReportTrigger') ScriptApp.deleteTrigger(trs[i]);
  }
  if (!cfg.reportAuto) return false;
  ScriptApp.newTrigger('runWeeklyReportTrigger').timeBased()
    .onWeekDay(weekDayConst_(cfg.reportAutoDay))
    .atHour(Math.max(0, Math.min(23, cfg.reportAutoHour)))
    .create();
  return true;
}

function enableWeeklyReportTrigger() {
  var cfg = getConfig();
  try {
    var on = ensureReportTrigger_();
    toast_(on ? 'Auto-report set for ' + cfg.reportAutoDay + ' around ' + cfg.reportAutoHour + ':00.'
              : 'Auto-report is switched off in ⚙️ Config ("Auto Generate Weekly Report").', on ? '✅' : '⚠️', 10);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Could not set the trigger', e.message +
      '\n\nRe-open the sheet and approve permissions, then try again.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function weekDayConst_(name) {
  var map = { MONDAY: ScriptApp.WeekDay.MONDAY, TUESDAY: ScriptApp.WeekDay.TUESDAY,
              WEDNESDAY: ScriptApp.WeekDay.WEDNESDAY, THURSDAY: ScriptApp.WeekDay.THURSDAY,
              FRIDAY: ScriptApp.WeekDay.FRIDAY, SATURDAY: ScriptApp.WeekDay.SATURDAY,
              SUNDAY: ScriptApp.WeekDay.SUNDAY };
  return map[up_(name)] || ScriptApp.WeekDay.MONDAY;
}

/* ───────── misc ───────── */

/** The ISO week that finished before today. */
function lastCompleteWeekKey_() {
  return weekKey_(addDays_(mondayOf_(new Date()), -7));
}

/** Show the reports folder link (Apps Script cannot open Drive directly). */
function openReportsFolder() {
  try {
    var folder = resolveReportsFolder_();
    var html = HtmlService.createHtmlOutput(
      '<div style="font-family:Arial,sans-serif;font-size:13px;padding:14px;color:#1F2933">' +
      '<div style="color:#7B8794;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Reports folder</div>' +
      '<div style="font-weight:bold;font-size:15px;margin:4px 0 12px">' + esc_(folder.getName()) + '</div>' +
      '<a href="' + folder.getUrl() + '" target="_blank" style="display:inline-block;background:#4C5FD5;color:#fff;' +
      'text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:bold">Open in Drive</a></div>')
      .setWidth(380).setHeight(160);
    SpreadsheetApp.getUi().showModalDialog(html, '📂 Reports folder');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Could not open the folder', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Save a dated copy of this whole workbook into a Backups subfolder of the
 * reports folder. Used before any destructive rebuild, and available on the
 * menu. Returns the Drive file.
 */
function backupWorkbook_(reason) {
  var parent = resolveReportsFolder_();
  var subs = parent.getFoldersByName('Backups');
  var folder = subs.hasNext() ? subs.next() : parent.createFolder('Backups');
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');
  var name = ss_().getName() + ' — backup ' + stamp + (reason ? ' (' + reason + ')' : '');
  return DriveApp.getFileById(ss_().getId()).makeCopy(name, folder);
}

/** Menu: take a backup right now. */
function backupWorkbookNow() {
  var ui = SpreadsheetApp.getUi();
  toast_('Saving a backup copy…', '💾', 20);
  try {
    var f = backupWorkbook_('manual');
    ui.alert('💾 Backup saved', f.getName() + '\n\nIt is in the Backups folder inside your reports folder.',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Backup failed', e.message, ui.ButtonSet.OK);
  }
}

/** Best-effort failure notice to the Chat space. Never throws. */
function notifyOpsFailure_(what, message) {
  try {
    var cfg = getConfig();
    if (!cfg.chatWebhook) return;
    postChatCard_(cfg.chatWebhook, {
      text: '⚠️ *' + what + ' failed* — ' + message,
      cardsV2: [{ cardId: 'ops-fail', card: {
        header: { title: what + ' failed', subtitle: cfg.schoolName },
        sections: [{ widgets: [{ decoratedText: { startIcon: { knownIcon: 'DESCRIPTION' },
          text: esc_(message), wrapText: true } }] }],
      }}],
    });
  } catch (e) { Logger.log('Ops alert failed: ' + e.message); }
}
