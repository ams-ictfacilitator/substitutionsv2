/**
 * ============================================================
 * AbsenceRegister.gs — 🗓️ Absence Register
 *
 * One row per (date, absent teacher). This is what makes absence itself
 * reportable: the 🗂️ Log only records periods that needed cover, so an
 * absence with no substitutable periods left no trace at all, and the
 * absence TYPE (Leave / Permission / OD, and its window) was never persisted.
 *
 * Written by commitPlan() alongside the log, and removed by the same
 * idempotency rules, so re-marking a teacher replaces her row.
 * ============================================================
 */

const ABSENCE_HEADERS = ['Timestamp', 'Date', 'Day', 'Week', 'Teacher', 'Department', 'Team',
                         'Absence Type', 'Periods Away', 'Periods Scheduled', 'Periods To Cover',
                         'Covered', 'Uncovered', 'Cover Reassigned', 'Run ID', 'Marked By'];
const ABSENCE_TYPE_COL = 8;   // 'Absence Type' — the column the migration rewrites
const ABSENCE_DATA_START = 3; // row 1 = title, row 2 = headers

/**
 * Read the whole register into structured objects (cached per execution).
 * Returns [] when the tab does not exist yet (sheets built before this feature).
 */
function readAbsenceRows_() {
  return memo('absenceRows', function () {
    var sheet = sheet_(SS.ABSENCE);
    if (!sheet || sheet.getLastRow() < ABSENCE_DATA_START) return [];
    var n = sheet.getLastRow() - ABSENCE_DATA_START + 1;
    var width = Math.min(ABSENCE_HEADERS.length, sheet.getLastColumn());
    var data = sheet.getRange(ABSENCE_DATA_START, 1, n, width).getValues();
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!norm_(r[1]) && !norm_(r[4])) continue;
      out.push({
        ts: r[0], dateStr: normDateCell_(r[1]), day: norm_(r[2]), weekKey: norm_(r[3]),
        teacher: norm_(r[4]), dept: norm_(r[5]), team: norm_(r[6]),
        type: absenceType_(r[7]).label, category: absenceType_(r[7]).category,
        periodsAway: norm_(r[8]),
        scheduled: toInt_(r[9], 0), toCover: toInt_(r[10], 0),
        covered: toInt_(r[11], 0), uncovered: toInt_(r[12], 0),
        reassignedAway: toInt_(r[13], 0),
        runId: norm_(r[14]), markedBy: norm_(r[15]),
        row: ABSENCE_DATA_START + i,
      });
    }
    return out;
  });
}

/**
 * Append one row per absent teacher. `meta` = {dateStr, day, weekKey, runId, markedBy}.
 */
function appendToAbsenceRegister_(meta, absences) {
  if (!absences || !absences.length) return;
  var sheet = ensureTab_(SS.ABSENCE, writeAbsenceRegisterTab_);
  if (!sheet) return;

  var rows = [];
  for (var i = 0; i < absences.length; i++) {
    var L = absences[i];
    rows.push([
      new Date(), meta.dateStr, meta.day, meta.weekKey, L.teacher,
      L.department || '', L.team || '', absenceType_(L.scope).label, L.periodsAway,
      L.scheduled, L.toCover, L.covered, L.uncovered, L.reassignedAway,
      meta.runId, meta.markedBy || '',
    ]);
  }
  var start = Math.max(sheet.getLastRow() + 1, ABSENCE_DATA_START);
  ensureRows_(sheet, start + rows.length - 1);
  sheet.getRange(start, 1, rows.length, ABSENCE_HEADERS.length).setValues(rows);
  styleAbsenceRows_(sheet, start, rows);
  clearCache();
}

/** Status colouring on freshly written register rows (batched by run). */
function styleAbsenceRows_(sheet, start, rows) {
  var bg = [], fg = [];
  for (var i = 0; i < rows.length; i++) {
    var uncovered = rows[i][12] > 0;
    var band = uncovered ? C.BAD_BG : (i % 2 === 0 ? C.WHITE : C.PAPER);
    var rowBg = [], rowFg = [];
    for (var c = 0; c < ABSENCE_HEADERS.length; c++) { rowBg.push(band); rowFg.push(C.INK); }
    rowFg[12] = uncovered ? C.ROSE : C.SUBTLE;
    rowFg[11] = C.GREEN;
    bg.push(rowBg); fg.push(rowFg);
  }
  var range = sheet.getRange(start, 1, rows.length, ABSENCE_HEADERS.length);
  range.setBackgrounds(bg).setFontColors(fg)
    .setBorder(null, null, true, null, null, null, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * Delete register rows for a date, for the given teachers (all teachers when
 * `teachers` is falsy). Rows are collected first and deleted bottom-up.
 */
function removeAbsenceRows_(dateStr, teachers) {
  var sheet = sheet_(SS.ABSENCE);
  if (!sheet || sheet.getLastRow() < ABSENCE_DATA_START) return 0;
  var set = null;
  if (teachers) { set = {}; teachers.forEach(function (t) { set[norm_(t)] = true; }); }

  var rows = readAbsenceRows_();
  var del = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].dateStr !== dateStr) continue;
    if (set && !set[rows[i].teacher]) continue;
    del.push(rows[i].row);
  }
  deleteRowsBatched_(sheet, del);
  clearCache();
  return del.length;
}

/* ───────── the tab ───────── */

function writeAbsenceRegisterTab_() {
  var sheet = sheet_(SS.ABSENCE);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  titleBand_(sheet, '🗓️ Absence Register', ABSENCE_HEADERS.length);
  sheet.getRange(2, 1, 1, ABSENCE_HEADERS.length).setValues([ABSENCE_HEADERS])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
  var widths = [140, 90, 80, 70, 175, 120, 120, 90, 110, 90, 90, 70, 80, 95, 90, 160];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(2);
  sheet.getRange('A1').setNote(
    'One row per teacher per day of absence — including absences that needed no cover.\n' +
    'Feeds the absence analysis in the weekly Principal report. Row 1 title, row 2 headers, data from row 3.\n' +
    'Absence Type is one of: ' + absenceTypeLabels_().join(' · '));
  sheet.getRange(3, ABSENCE_TYPE_COL, Math.max(1, sheet.getMaxRows() - 2), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(absenceTypeLabels_(), true)
      .setAllowInvalid(true).build());
  trimColumnsOnly_(sheet, ABSENCE_HEADERS.length);
}

/* ───────── migration from the pre-OD vocabulary ───────── */

/**
 * Bring an in-service workbook up to the Absence vocabulary. Safe to re-run;
 * returns a list of what it actually changed (empty when already current).
 *
 *   1. rename 📝 Mark Leave     → 📝 Mark Absence      (keeps the sheet, and its data)
 *   2. rename 🗓️ Leave Register → 🗓️ Absence Register
 *   3. header  'Leave Scope'    → 'Absence Type'
 *   4. values  'Full day' → 'Leave - Full day', and so on
 *
 * Renaming rather than recreating matters: a new tab would leave every
 * historical row stranded on an orphaned sheet and invisible to the report.
 */
function migrateAbsenceVocabulary_() {
  var ss = ss_(), done = [];

  var renames = [['📝 Mark Leave', SS.MARK_ABSENCE], ['🗓️ Leave Register', SS.ABSENCE]];
  for (var i = 0; i < renames.length; i++) {
    var oldSheet = ss.getSheetByName(renames[i][0]);
    if (!oldSheet) continue;
    if (ss.getSheetByName(renames[i][1])) continue;   // already migrated; never clobber
    oldSheet.setName(renames[i][1]);
    done.push('tab renamed: "' + renames[i][0] + '" → "' + renames[i][1] + '"');
  }

  var sheet = sheet_(SS.ABSENCE);
  if (!sheet) return done;

  if (norm_(sheet.getRange(1, 1).getValue()) !== '🗓️ Absence Register') {
    sheet.getRange(1, 1).setValue('🗓️ Absence Register');
    done.push('🗓️ Absence Register — title updated');
  }
  sheet.getRange('A1').setNote(
    'One row per teacher per day of absence — including absences that needed no cover.\n' +
    'Feeds the absence analysis in the weekly Principal report. Row 1 title, row 2 headers, data from row 3.\n' +
    'Absence Type is one of: ' + absenceTypeLabels_().join(' · '));

  var head = sheet.getRange(2, ABSENCE_TYPE_COL);
  if (norm_(head.getValue()) !== 'Absence Type') {
    head.setValue('Absence Type');
    done.push('🗓️ Absence Register — column renamed to "Absence Type"');
  }

  var last = sheet.getLastRow();
  if (last >= ABSENCE_DATA_START) {
    var n = last - ABSENCE_DATA_START + 1;
    var range = sheet.getRange(ABSENCE_DATA_START, ABSENCE_TYPE_COL, n, 1);
    var vals = range.getValues(), changed = 0;
    for (var r = 0; r < vals.length; r++) {
      var raw = norm_(vals[r][0]);
      if (!raw) continue;
      var label = absenceType_(raw).label;
      if (label !== raw && label !== UNKNOWN_ABSENCE_TYPE.label) { vals[r][0] = label; changed++; }
    }
    if (changed) {
      range.setValues(vals);
      done.push('🗓️ Absence Register — ' + changed + ' recorded absence(s) converted to the new vocabulary');
    }
    range.setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(absenceTypeLabels_(), true).setAllowInvalid(true).build());
  }

  if (done.length) clearCache();
  return done;
}

/** True when anything still needs migrating (used to decide on a backup first). */
function absenceMigrationNeeded_() {
  var ss = ss_();
  if (ss.getSheetByName('📝 Mark Leave') || ss.getSheetByName('🗓️ Leave Register')) return true;
  var sheet = sheet_(SS.ABSENCE);
  if (!sheet) return false;
  if (norm_(sheet.getRange(1, 1).getValue()) !== '🗓️ Absence Register') return true;
  if (norm_(sheet.getRange(2, ABSENCE_TYPE_COL).getValue()) !== 'Absence Type') return true;
  var last = sheet.getLastRow();
  if (last < ABSENCE_DATA_START) return false;
  var vals = sheet.getRange(ABSENCE_DATA_START, ABSENCE_TYPE_COL, last - ABSENCE_DATA_START + 1, 1).getValues();
  for (var r = 0; r < vals.length; r++) {
    var raw = norm_(vals[r][0]);
    if (raw && absenceType_(raw).label !== raw && absenceType_(raw).label !== UNKNOWN_ABSENCE_TYPE.label) return true;
  }
  return false;
}
