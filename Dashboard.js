/**
 * ============================================================
 * Dashboard.gs — Render the 🔁 Substitution Pool and 📊 Fairness tabs.
 * ============================================================
 */

/** Re-render both live views. Called after any commit. */
function refreshDashboards_() {
  clearCache();
  try { renderPool_(); } catch (e) { Logger.log('Pool render: ' + e.message); }
  try { renderFairness_(); } catch (e) { Logger.log('Fairness render: ' + e.message); }
  try { refreshAbsenceTabTeacherList_(); } catch (e) { Logger.log('Absence list: ' + e.message); }
}

/** Menu entry: rebuild dashboards on demand. */
function refreshPoolAndFairness() {
  toast_('Refreshing pool & fairness…', '🔁', 8);
  refreshDashboards_();
  toast_('Done.', '✅');
}

/**
 * 🔁 Substitution Pool — the weighted rotation + live weekly usage.
 */
function renderPool_() {
  var sheet = sheet_(SS.POOL);
  if (!sheet) return;

  var cfg = getConfig();
  var pool = buildPool();                 // may throw if source unset — absences tab intact
  var today = new Date();
  var wk = weekKey_(today);
  var weekUsed = weekUsageByTeacher(wk);
  var termUsed = termUsageByTeacher();
  var basis = cfg.fairnessBasis === 'Week' ? 'Week' : 'Term';

  sheet.clear();
  sheet.clearConditionalFormatRules();
  bandTitle_(sheet, '🔁 Substitution Pool',
    'Weighted rotation from the allotment · fairness basis: ' + basis +
    (basis === 'Term' ? ' (cumulative, never resets)' : ' (resets each ISO week)') + ' · current week ' + wk, 7);

  // Rotation sequence strip (the starting / tie-break order; the engine then balances by load)
  var SHOW = 48;
  var head = pool.order.slice(0, SHOW).map(function (t) { return abbrev_(t); }).join('  →  ');
  var seq = pool.order.length > SHOW ? head + '  →  … (+' + (pool.order.length - SHOW) + ' more)' : head;
  sheet.getRange(3, 1, 1, 7).merge()
    .setValue('Rotation order:  ' + (seq || '(no substitutes with allotment > 0)'))
    .setBackground(C.INDIGO_50).setFontColor(C.INK).setFontSize(10)
    .setWrap(true).setVerticalAlignment('middle');
  sheet.setRowHeight(3, 46);

  // Table
  var headRow = 5;
  var headers = ['#', 'Substitute', 'Department', 'Team', 'Weight', 'This week', 'Term total'];
  writeHeader_(sheet, headRow, headers);

  var rows = [];
  for (var i = 0; i < pool.members.length; i++) {
    var m = pool.members[i];
    rows.push([i + 1, m.teacher, m.department, m.team, m.cap, weekUsed[m.teacher] || 0, termUsed[m.teacher] || 0]);
  }
  if (rows.length) {
    sheet.getRange(headRow + 1, 1, rows.length, headers.length).setValues(rows);
    zebra_(sheet, headRow + 1, rows.length, headers.length);
    sheet.getRange(headRow + 1, 5, rows.length, 3).setHorizontalAlignment('center');
    sheet.getRange(headRow + 1, 7, rows.length, 1).setFontWeight('bold').setFontColor(C.INDIGO);
  }

  var widths = [40, 230, 150, 150, 80, 90, 90];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(headRow);
  cleanGrid_(sheet, headers.length);
}

/**
 * 📊 Fairness — weekly + term load per substitute, with balance bars.
 */
function renderFairness_() {
  var sheet = sheet_(SS.DASHBOARD);
  if (!sheet) return;

  var cfg = getConfig();
  var pool = buildPool();                 // may throw if source unset — absences tab intact
  var today = new Date();
  var wk = weekKey_(today);
  var weekUsed = weekUsageByTeacher(wk);
  var termUsed = termUsageByTeacher();

  var basis = cfg.fairnessBasis === 'Week' ? 'Week' : 'Term';
  var totalCap = pool.totalCap;
  var totalTerm = sumValues_(termUsed), totalWeek = sumValues_(weekUsed);

  sheet.clear();
  sheet.clearConditionalFormatRules();
  bandTitle_(sheet, '📊 Fairness Dashboard',
    cfg.termLabel + ' · basis: ' + basis + ' · " Fair share" = each teacher\'s weight × total subs ÷ total weight · current week ' + wk, 7);

  // KPI strip
  kpi_(sheet, 3, 1, 'This week', totalWeek, C.INDIGO, C.INDIGO_50);
  kpi_(sheet, 3, 3, 'This term', totalTerm, C.TEAL, C.TEAL_50);
  kpi_(sheet, 3, 5, 'Active substitutes', pool.members.length, C.VIOLET, C.VIOLET_50);

  var headRow = 6;
  var headers = ['Substitute', 'Team', 'Weight', 'This week', 'Term total', 'Fair share', 'Distribution'];
  writeHeader_(sheet, headRow, headers);

  var members = pool.members.slice().sort(function (a, b) { return (termUsed[b.teacher] || 0) - (termUsed[a.teacher] || 0) || a.teacher.localeCompare(b.teacher); });
  var maxTerm = 1;
  members.forEach(function (m) { maxTerm = Math.max(maxTerm, termUsed[m.teacher] || 0); });

  var rows = [];
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    var tt = termUsed[m.teacher] || 0;
    var expected = totalCap > 0 ? Math.round(m.cap * totalTerm / totalCap) : 0;
    rows.push([m.teacher, m.team, m.cap, weekUsed[m.teacher] || 0, tt, expected, barText_(tt, maxTerm)]);
  }
  if (rows.length) {
    sheet.getRange(headRow + 1, 1, rows.length, headers.length).setValues(rows);
    zebra_(sheet, headRow + 1, rows.length, headers.length);
    sheet.getRange(headRow + 1, 3, rows.length, 4).setHorizontalAlignment('center');
    sheet.getRange(headRow + 1, 5, rows.length, 1).setFontWeight('bold').setFontColor(C.TEAL);
    sheet.getRange(headRow + 1, 7, rows.length, 1).setFontColor(C.TEAL).setFontFamily('Roboto Mono');
  }

  var widths = [230, 150, 80, 90, 90, 90, 150];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(headRow);
  cleanGrid_(sheet, headers.length);
}

/* ───────── shared rendering helpers ───────── */

function bandTitle_(sheet, title, subtitle, cols) {
  sheet.getRange(1, 1, 1, cols).merge().setValue(title)
    .setBackground(C.HEAD_DARK).setFontColor(C.WHITE).setFontSize(15).setFontWeight('bold')
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sheet.setRowHeight(1, 40);
  sheet.getRange(2, 1, 1, cols).merge().setValue(subtitle)
    .setBackground(C.HEAD_BAND).setFontColor(C.SUBTLE).setFontSize(10).setVerticalAlignment('middle');
  sheet.setRowHeight(2, 24);
}

function writeHeader_(sheet, row, headers) {
  sheet.getRange(row, 1, 1, headers.length).setValues([headers])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10)
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sheet.setRowHeight(row, 28);
}

function zebra_(sheet, startRow, count, cols) {
  for (var r = 0; r < count; r++) {
    sheet.getRange(startRow + r, 1, 1, cols)
      .setBackground(r % 2 === 0 ? C.WHITE : C.PAPER).setFontColor(C.INK)
      .setBorder(null, null, true, null, null, null, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID);
  }
}

function kpi_(sheet, row, col, label, value, fg, bg) {
  sheet.getRange(row, col, 1, 2).merge().setBackground(bg)
    .setBorder(true, true, true, true, false, false, bg, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(row, col).setValue(label + '\n' + value)
    .setFontColor(fg).setFontWeight('bold').setVerticalAlignment('middle')
    .setHorizontalAlignment('center').setWrap(true);
  sheet.setRowHeight(row, 48);
}

function barText_(used, cap) {
  if (cap <= 0) return '';
  var filled = Math.min(used, cap);
  var width = Math.min(cap, 12);
  var on = Math.round((filled / cap) * width);
  return repeat_('█', on) + repeat_('░', Math.max(0, width - on));
}

function cleanGrid_(sheet, cols) {
  var maxCols = sheet.getMaxColumns();
  if (maxCols > cols + 1) sheet.deleteColumns(cols + 2, maxCols - cols - 1);
  sheet.getDataRange().setVerticalAlignment('middle');
}

function abbrev_(name) {
  var parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[1].charAt(0) + '.';
}
function repeat_(ch, n) { var s = ''; for (var i = 0; i < n; i++) s += ch; return s; }
function sumValues_(obj) { var t = 0; for (var k in obj) t += obj[k]; return t; }
