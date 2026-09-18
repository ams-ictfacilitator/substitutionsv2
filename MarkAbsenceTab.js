/**
 * ============================================================
 * MarkAbsenceTab.gs — Mark absences from a tab (no side panel).
 *
 * Grid: one row per absent teacher → Teacher | Absence type | Periods.
 *   Absence type: the eight values in ABSENCE_TYPES (Leave / Permission / OD)
 *   Periods     : only for Permission and OD - Periods, e.g. "7,8" or "3-4"
 * Choosing Action → “Assign & notify” runs the SAME engine as the side panel
 * (computePlan + commitPlan), respecting each teacher's leave window, cascading
 * re-assignments, and writing the plan inline.
 * ============================================================
 */

var ML = {
  DATE_R: 4, DATE_C: 2, ACTION_R: 5, ACTION_C: 2,
  STATUS_R: 4, STATUS_C: 5,                 // merged E4:I5
  HEAD_R: 7, FIRST_R: 8, ROWS: 20,
  TEACH_C: 1, TYPE_C: 2, PER_C: 3,
  RES_C: 5, RES_W: 5,                       // results E..I
};

/* ───────── build the tab ───────── */

function writeMarkAbsenceTab_() {
  var sheet = sheet_(SS.MARK_ABSENCE);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.setHiddenGridlines(true);

  titleBand_(sheet, '📝 Mark Absence', 9);
  sheet.getRange(2, 1, 1, 9).merge()
    .setValue(markAbsenceBanner_())
    .setBackground(C.HEAD_BAND).setFontColor(C.SUBTLE).setFontSize(10).setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(2, 30);

  // Date + Action controls (left)
  mlLabel_(sheet, ML.DATE_R, 1, 'Date');
  sheet.getRange(ML.DATE_R, ML.DATE_C)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build())
    .setValue(new Date()).setNumberFormat('ddd, dd mmm yyyy')
    .setBackground(C.WHITE).setFontWeight('bold')
    .setBorder(true, true, true, true, false, false, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID);

  mlLabel_(sheet, ML.ACTION_R, 1, 'Action');
  sheet.getRange(ML.ACTION_R, ML.ACTION_C)
    .setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['—', 'Preview plan', 'Assign & notify'], true).build())
    .setValue('—').setFontWeight('bold').setFontColor(C.INDIGO).setBackground(C.INDIGO_50)
    .setBorder(true, true, true, true, false, false, C.INDIGO, SpreadsheetApp.BorderStyle.SOLID);

  // Status panel (right of the controls)
  sheet.getRange(ML.STATUS_R, ML.STATUS_C, 2, ML.RES_W).merge().setBackground(C.PAPER)
    .setBorder(true, true, true, true, false, false, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID)
    .setVerticalAlignment('middle').setWrap(true).setFontSize(11);
  setAbsenceStatus_(sheet, 'Add teacher(s) + leave type, then set Action → “Assign & notify”.', C.SUBTLE);

  // Grid headers + results headers
  sheet.getRange(ML.HEAD_R, 1, 1, 3).setValues([MARK_ABSENCE_HEADERS])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10).setVerticalAlignment('middle');
  sheet.getRange(ML.HEAD_R, ML.RES_C, 1, ML.RES_W)
    .setValues([['Period', 'Class', 'Subject', 'Absent', 'Substitute']])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
  sheet.setRowHeight(ML.HEAD_R, 26);
  sheet.getRange(ML.HEAD_R, ML.PER_C).setNote(markPeriodsNote_());
  sheet.getRange(ML.HEAD_R, ML.TYPE_C).setNote(markTypeNote_());

  // Input cells: teacher (validated in refresh), leave type (static), periods (free text)
  sheet.getRange(ML.FIRST_R, 1, ML.ROWS, 3).setBackground(C.WHITE)
    .setBorder(true, true, true, true, true, true, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(ML.FIRST_R, ML.TYPE_C, ML.ROWS, 1).setDataValidation(absenceTypeRule_());

  var widths = [190, 132, 82, 16, 60, 84, 130, 148, 160];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(ML.HEAD_R);
  trimColumns_(sheet, 9);

  try { refreshAbsenceTabTeacherList_(); } catch (e) { /* source not connected yet */ }
}

/** Populate the teacher dropdowns from the live allotment. */
function refreshAbsenceTabTeacherList_() {
  var sheet = sheet_(SS.MARK_ABSENCE);
  if (!sheet) return;
  var teachers = getAllTeachers();              // throws if source not connected
  if (!teachers.length) return;
  sheet.getRange(ML.FIRST_R, ML.TEACH_C, ML.ROWS, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(teachers, true).setAllowInvalid(true).build());
}

/* ───────── triggers & menu entry points ───────── */

/** Installable onEdit — runs when the Action cell is set on the Mark Absence tab. */
function onEditInstallable(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== SS.MARK_ABSENCE) return;
    if (e.range.getRow() !== ML.ACTION_R || e.range.getColumn() !== ML.ACTION_C) return;
    var v = norm_(e.value);
    if (v === 'Preview plan')          { e.range.setValue('—'); runAbsenceTab_('preview'); }
    else if (v === 'Assign & notify')  { e.range.setValue('—'); runAbsenceTab_('commit'); }
  } catch (err) {
    try { toast_('⚠️ ' + err.message, '📝 Mark Leave', 8); } catch (_) {}
  }
}

function openMarkAbsenceTab() {
  var sheet = sheet_(SS.MARK_ABSENCE);
  if (!sheet) { toast_('Run 🛠️ Build / rebuild all tabs first.', '⚠️'); return; }
  ss_().setActiveSheet(sheet);
  try { refreshAbsenceTabTeacherList_(); }
  catch (e) { setAbsenceStatus_(sheet, '⚠️ Connect the main sheet in ⚙️ Config to load teacher names.', C.ROSE); }
  ensureAbsenceTrigger_();
}

function absenceTabPreview() { runAbsenceTab_('preview'); }
function absenceTabAssign()  { runAbsenceTab_('commit'); }
function refreshAbsenceTeachers() {
  try { refreshAbsenceTabTeacherList_(); toast_('Teacher list refreshed.', '✅'); }
  catch (e) { toast_('⚠️ ' + e.message, '', 8); }
}

function enableTabMarking() {
  if (ensureAbsenceTrigger_()) toast_('Tick-to-run enabled on the 📝 Mark Leave tab.', '✅', 8);
  else SpreadsheetApp.getUi().alert('Could not enable tick-to-run',
    'No problem — use 🔁 Substitutions → 📝 Mark-Leave tab → Preview / Assign & notify instead.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Install the onEdit trigger once (idempotent). Returns true on success. */
function ensureAbsenceTrigger_() {
  try {
    var trs = ScriptApp.getProjectTriggers();
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].getHandlerFunction() === 'onEditInstallable') return true;
    }
    ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss_()).onEdit().create();
    return true;
  } catch (e) {
    Logger.log('Leave trigger install failed: ' + e.message);
    return false;
  }
}

/* ───────── the run ───────── */

function runAbsenceTab_(mode) {
  var sheet = sheet_(SS.MARK_ABSENCE);
  if (!sheet) return;
  clearAbsenceResults_(sheet);
  setAbsenceStatus_(sheet, '⏳ Working…', C.SUBTLE);

  var cfg = getConfig();
  var date = parseDate_(sheet.getRange(ML.DATE_R, ML.DATE_C).getValue());
  if (!date) { setAbsenceStatus_(sheet, '⚠️ Enter a valid date in the Date cell.', C.ROSE); return; }

  var grid = sheet.getRange(ML.FIRST_R, 1, ML.ROWS, 3).getValues();
  var seen = {}, teachers = [], pf = {}, scopeBy = {}, needPeriods = [];
  for (var i = 0; i < grid.length; i++) {
    var name = norm_(grid[i][0]);
    if (!name || seen[name]) continue;
    var type = norm_(grid[i][1]);
    var per = norm_(grid[i][2]);
    var sp = resolveScopePeriods_(cfg, type, per);
    if (absenceNeedsPeriods_(type) && !sp) { needPeriods.push(name + ' (' + absenceType_(type).label + ')'); continue; }
    seen[name] = true;
    teachers.push(name);
    scopeBy[name] = absenceType_(type).label;
    if (sp) pf[name] = sp;
  }
  if (needPeriods.length) {
    setAbsenceStatus_(sheet, '⚠️ Add the period number(s) — e.g. 7,8 or 3-4 — for: ' + needPeriods.join(', '), C.ROSE);
    return;
  }
  if (!teachers.length) { setAbsenceStatus_(sheet, '⚠️ Add at least one absent teacher.', C.ROSE); return; }

  var plan;
  try { plan = computePlan(isoDate_(date), teachers, { periodFilter: pf, scopeByTeacher: scopeBy }); }
  catch (e) { setAbsenceStatus_(sheet, '⚠️ ' + e.message, C.ROSE); return; }
  if (!plan.ok) { setAbsenceStatus_(sheet, '⚠️ ' + plan.error, C.ROSE); return; }

  var res = null;
  if (mode === 'commit') {
    try { res = commitPlan(plan, activeEmail_()); }
    catch (e) { setAbsenceStatus_(sheet, '⚠️ ' + e.message, C.ROSE); }
  }
  writeAbsenceResults_(sheet, plan, mode, res);
}

function writeAbsenceResults_(sheet, plan, mode, res) {
  var rows = plan.assignments.slice().sort(function (a, b) {
    return a.period - b.period || a.absent.localeCompare(b.absent);
  });
  sheet.getRange(ML.FIRST_R, ML.RES_C, ML.ROWS, ML.RES_W).clearContent().setBackground(C.WHITE);

  var out = rows.map(function (a) {
    var sub = a.status === 'ASSIGNED' ? (a.reassigned ? '↻ ' : '') + a.substitute : '⚠️ none free';
    return ['P' + a.period, a.classSec, a.subject, a.absent, sub];
  });
  var why = rows.map(function (a) { return [a.reason || '']; });
  if (out.length) {
    sheet.getRange(ML.FIRST_R, ML.RES_C, out.length, ML.RES_W).setValues(out);
    for (var i = 0; i < out.length; i++) {
      var bad = rows[i].status !== 'ASSIGNED';
      sheet.getRange(ML.FIRST_R + i, ML.RES_C, 1, ML.RES_W)
        .setBackground(bad ? C.BAD_BG : (i % 2 ? C.PAPER : C.WHITE)).setFontColor(C.INK)
        .setBorder(null, null, true, null, null, null, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID);
      sheet.getRange(ML.FIRST_R + i, ML.RES_C).setFontWeight('bold');
      sheet.getRange(ML.FIRST_R + i, ML.RES_C + 4).setFontWeight('bold')
        .setFontColor(bad ? C.ROSE : (rows[i].reassigned ? C.VIOLET : C.GREEN));
      if (why[i][0]) sheet.getRange(ML.FIRST_R + i, ML.RES_C + 4).setNote(why[i][0]);
    }
  }

  var s = plan.summary, msg;
  if (mode === 'commit') {
    msg = (res && res.ok ? '✅ Saved · ' : '⚠️ ') + s.assigned + ' assigned'
      + (s.unassigned ? ' · ' + s.unassigned + ' unassigned' : '')
      + (s.reassigned ? ' · ' + s.reassigned + ' re-assigned' : '')
      + (res && res.notified ? ' · Chat notified' : (res ? ' · (no channel sent)' : ''));
  } else {
    msg = '👁 Preview · ' + s.assigned + ' assigned' + (s.unassigned ? ' · ' + s.unassigned + ' unassigned' : '')
      + (s.reassigned ? ' · ' + s.reassigned + ' re-assigned' : '')
      + ' — set Action → “Assign & notify” to save.';
  }
  setAbsenceStatus_(sheet, plan.prettyDate + ' · ' + plan.day + '\n' + msg, s.unassigned ? C.AMBER : C.GREEN);
}

function clearAbsenceResults_(sheet) {
  sheet.getRange(ML.FIRST_R, ML.RES_C, ML.ROWS, ML.RES_W).clearContent();
}

/* ───────── small helpers ───────── */

function mlLabel_(sheet, row, col, text) {
  sheet.getRange(row, col).setValue(text).setFontWeight('bold').setFontColor(C.INK)
    .setHorizontalAlignment('right').setVerticalAlignment('middle');
}

function setAbsenceStatus_(sheet, msg, color) {
  sheet.getRange(ML.STATUS_R, ML.STATUS_C).setValue(msg).setFontColor(color || C.INK);
}

/** Labels of the types that cannot be resolved without explicit periods. */
function periodTypeLabels_() {
  return ABSENCE_TYPES.filter(function (t) { return t.window === 'PERIODS'; })
    .map(function (t) { return t.label; });
}

/* ───────── chrome — shared by the builder and the in-place refresher ───────── */

var MARK_ABSENCE_HEADERS = ['Teacher', 'Absence type', 'Periods'];

function markAbsenceBanner_() {
  return 'Add absent teacher(s) below — choose the Absence type (Leave / Permission / OD), ' +
    'then set Action → “Assign & notify”. ' + periodTypeLabels_().join(' and ') +
    ' also need the period numbers. Same engine as the side panel.';
}
function markPeriodsNote_() {
  return 'Only for ' + periodTypeLabels_().join(' and ') + ' — the period(s) the teacher is away.\n' +
    'Examples: 1   ·   7,8   ·   3-4';
}
function markTypeNote_() {
  return 'Leave — personal absence\n' +
    'Permission — a short personal absence, on specific periods\n' +
    'OD — on official school duty\n\nBlank counts as "' + ABSENCE_TYPES[0].label + '".';
}
function absenceTypeRule_() {
  return SpreadsheetApp.newDataValidation().requireValueInList(absenceTypeLabels_(), true).build();
}

/**
 * Bring an EXISTING 📝 Mark Absence tab up to the current vocabulary without
 * rebuilding it. Only chrome is rewritten — title, banner, headers, notes,
 * the type dropdown and column widths. Anything typed into the grid stays,
 * and legacy type values already typed there are converted in place.
 *
 * Needed because upgradeTabs() only *builds* missing tabs: a tab that already
 * existed keeps whatever its original builder wrote.
 */
function refreshMarkAbsenceChrome_() {
  var sheet = sheet_(SS.MARK_ABSENCE);
  if (!sheet) return [];
  var done = [];

  if (norm_(sheet.getRange(1, 1).getValue()) !== '📝 Mark Absence') {
    sheet.getRange(1, 1).setValue('📝 Mark Absence');
    done.push('📝 Mark Absence — title updated');
  }
  if (norm_(sheet.getRange(2, 1).getValue()) !== markAbsenceBanner_()) {
    sheet.getRange(2, 1).setValue(markAbsenceBanner_());
    done.push('📝 Mark Absence — instructions updated');
  }

  var head = sheet.getRange(ML.HEAD_R, 1, 1, 3);
  if (norm_(head.getValues()[0][ML.TYPE_C - 1]) !== MARK_ABSENCE_HEADERS[ML.TYPE_C - 1]) {
    head.setValues([MARK_ABSENCE_HEADERS]);
    done.push('📝 Mark Absence — column headers updated');
  }
  sheet.getRange(ML.HEAD_R, ML.PER_C).setNote(markPeriodsNote_());
  sheet.getRange(ML.HEAD_R, ML.TYPE_C).setNote(markTypeNote_());

  // the dropdown itself — the part that was left stale
  sheet.getRange(ML.FIRST_R, ML.TYPE_C, ML.ROWS, 1).setDataValidation(absenceTypeRule_());
  done.push('📝 Mark Absence — type dropdown now offers all ' + ABSENCE_TYPES.length + ' absence types');

  // convert anything already typed into the grid
  var cells = sheet.getRange(ML.FIRST_R, ML.TYPE_C, ML.ROWS, 1);
  var vals = cells.getValues(), changed = 0;
  for (var i = 0; i < vals.length; i++) {
    var raw = norm_(vals[i][0]);
    if (!raw) continue;
    var label = absenceType_(raw).label;
    if (label !== raw && label !== UNKNOWN_ABSENCE_TYPE.label) { vals[i][0] = label; changed++; }
  }
  if (changed) {
    cells.setValues(vals);
    done.push('📝 Mark Absence — ' + changed + ' typed value(s) converted');
  }

  var widths = [190, 132, 82, 16, 60, 84, 130, 148, 160];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  return done;
}
