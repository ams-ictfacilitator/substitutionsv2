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
                         'Covered', 'Uncovered', 'Cover Reassigned', 'Run ID', 'Marked By',
                         'Staff Email', 'Staff Code'];
const ABSENCE_REQUIRED_HEADERS = ABSENCE_HEADERS.slice(0, 16);
const NON_TEACHING_HEADERS = ['Date', 'Teacher', 'Absence Type', 'Periods Away', 'Marked By',
                              'Staff Email', 'Staff Code', 'Category', 'Timestamp', 'Notes'];
const NON_TEACHING_DATA_START = 3; // row 1 = title, row 2 = headers (same layout as the Register)
const ABSENCE_DATA_START = 3; // row 1 = title, row 2 = headers

const ABSENCE_KEY_NOTES = {
  'Staff Email': 'Staff Email: the staff member\'s Workspace email, one of the two join keys One Way reads.\n' +
    'Amber means this row\'s key is blank. Never edit by hand once set.',
  'Staff Code': 'Staff Code: the staff member\'s code, one of the two join keys One Way reads.\n' +
    'Amber means this row\'s key is blank. Never edit by hand once set.',
};

/** The ONE header normaliser: collapse any whitespace run (incl. NBSP), trim, uppercase. */
function absenceHeaderKey_(value) {
  return String(value == null ? '' : value).replace(/[\s\u00a0]+/g, ' ').trim().toUpperCase();
}

/** Set the explanatory note on a key header cell when it has none (idempotent). */
function ensureAbsenceKeyNotes_(sheet, headers) {
  var map = absenceHeaderMap_(headers);
  Object.keys(ABSENCE_KEY_NOTES).forEach(function (name) {
    var col = absenceHeaderIndex_(map, name);
    if (col < 0) return;
    var cell = sheet.getRange(2, col + 1);
    var existing = typeof cell.getNote === 'function' ? norm_(cell.getNote()) : '';
    if (!existing) cell.setNote(ABSENCE_KEY_NOTES[name]);
  });
}

/** Return the first column for each header, using the sheet's current order. */
function absenceHeaderMap_(headers) {
  var out = {};
  for (var i = 0; i < headers.length; i++) {
    var key = absenceHeaderKey_(headers[i]);
    if (key && !(key in out)) out[key] = i;
  }
  return out;
}

function absenceHeaderIndex_(map, name) {
  var key = absenceHeaderKey_(name);
  return key in map ? map[key] : -1;
}

/** Read the row-2 layout once for a Register operation. */
function absenceRegisterLayout_(sheet) {
  var width = sheet.getLastColumn();
  if (!width) return { width: 0, headers: [], map: {} };
  var headers = sheet.getRange(2, 1, 1, width).getValues()[0];
  return { width: width, headers: headers, map: absenceHeaderMap_(headers) };
}

function absenceCell_(row, map, name) {
  var col = absenceHeaderIndex_(map, name);
  return col < 0 ? '' : row[col];
}

function absenceRowValues_(record, layout) {
  var row = [];
  for (var i = 0; i < layout.width; i++) row.push('');
  var put = function (name, value) {
    var col = absenceHeaderIndex_(layout.map, name);
    if (col >= 0) row[col] = value == null ? '' : value;
  };
  put('Timestamp', record.ts);
  put('Date', record.dateStr);
  put('Day', record.day);
  put('Week', record.weekKey);
  put('Teacher', record.teacher);
  put('Department', record.department);
  put('Team', record.team);
  put('Absence Type', record.type);
  put('Periods Away', record.periodsAway);
  put('Periods Scheduled', record.scheduled);
  put('Periods To Cover', record.toCover);
  put('Covered', record.covered);
  put('Uncovered', record.uncovered);
  put('Cover Reassigned', record.reassignedAway);
  put('Run ID', record.runId);
  put('Marked By', record.markedBy);
  // Join keys remain blank until the roster and mark-time tickets supply them.
  put('Staff Email', '');
  put('Staff Code', '');
  return row;
}

/**
 * Read the whole register into structured objects (cached per execution).
 * Returns [] when the tab does not exist yet (sheets built before this feature).
 */
function readAbsenceRows_() {
  return memo('absenceRows', function () {
    var sheet = sheet_(SS.ABSENCE);
    if (!sheet) return [];
    var layout = absenceRegisterLayout_(sheet);
    var hasHeaders = layout.headers.some(function (h) { return norm_(h) !== ''; });
    // A set-up tab (any header present) must be valid even when it has no data rows yet.
    if (hasHeaders || sheet.getLastRow() >= ABSENCE_DATA_START) {
      requireAbsenceHeaders_(layout, ABSENCE_REQUIRED_HEADERS);
    }
    if (sheet.getLastRow() < ABSENCE_DATA_START) return [];
    var n = sheet.getLastRow() - ABSENCE_DATA_START + 1;
    var data = sheet.getRange(ABSENCE_DATA_START, 1, n, layout.width).getValues();
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!norm_(absenceCell_(r, layout.map, 'Date')) && !norm_(absenceCell_(r, layout.map, 'Teacher'))) continue;
      out.push({
        ts: absenceCell_(r, layout.map, 'Timestamp'),
        dateStr: normDateCell_(absenceCell_(r, layout.map, 'Date')),
        day: norm_(absenceCell_(r, layout.map, 'Day')),
        weekKey: norm_(absenceCell_(r, layout.map, 'Week')),
        teacher: norm_(absenceCell_(r, layout.map, 'Teacher')),
        dept: norm_(absenceCell_(r, layout.map, 'Department')),
        team: norm_(absenceCell_(r, layout.map, 'Team')),
        type: absenceType_(absenceCell_(r, layout.map, 'Absence Type')).label,
        category: absenceType_(absenceCell_(r, layout.map, 'Absence Type')).category,
        periodsAway: norm_(absenceCell_(r, layout.map, 'Periods Away')),
        scheduled: toInt_(absenceCell_(r, layout.map, 'Periods Scheduled'), 0),
        toCover: toInt_(absenceCell_(r, layout.map, 'Periods To Cover'), 0),
        covered: toInt_(absenceCell_(r, layout.map, 'Covered'), 0),
        uncovered: toInt_(absenceCell_(r, layout.map, 'Uncovered'), 0),
        reassignedAway: toInt_(absenceCell_(r, layout.map, 'Cover Reassigned'), 0),
        runId: norm_(absenceCell_(r, layout.map, 'Run ID')),
        markedBy: norm_(absenceCell_(r, layout.map, 'Marked By')),
        staffEmail: norm_(absenceCell_(r, layout.map, 'Staff Email')),
        staffCode: norm_(absenceCell_(r, layout.map, 'Staff Code')),
        row: ABSENCE_DATA_START + i,
      });
    }
    return out;
  });
}

/** Throw a clear error naming any of `names` absent from the layout's headers. */
function requireAbsenceHeaders_(layout, names) {
  var missing = names.filter(function (header) {
    return absenceHeaderIndex_(layout.map, header) < 0;
  });
  if (missing.length) {
    throw new Error('Absence Register is missing required header(s): ' + missing.join(', '));
  }
}

/**
 * Pre-flight for commitPlan: make sure the Register tab exists (built if missing)
 * and carries every required header, BEFORE any Log/Register/notification side
 * effect. Throws a clear Error otherwise. No-op when there are no absences.
 */
function assertAbsenceRegisterReady_(absences) {
  if (!absences || !absences.length) return null;
  var sheet = ensureTab_(SS.ABSENCE, writeAbsenceRegisterTab_);
  if (!sheet) throw new Error('Absence Register tab could not be created.');
  var layout = absenceRegisterLayout_(sheet);
  requireAbsenceHeaders_(layout, ABSENCE_REQUIRED_HEADERS);
  return layout;
}

/**
 * Append one row per absent teacher. `meta` = {dateStr, day, weekKey, runId, markedBy}.
 */
function appendToAbsenceRegister_(meta, absences) {
  if (!absences || !absences.length) return;
  var sheet = ensureTab_(SS.ABSENCE, writeAbsenceRegisterTab_);
  if (!sheet) return;

  var layout = absenceRegisterLayout_(sheet);
  requireAbsenceHeaders_(layout, ABSENCE_REQUIRED_HEADERS);
  var rows = [];
  for (var i = 0; i < absences.length; i++) {
    var L = absences[i];
    rows.push(absenceRowValues_({
      ts: new Date(), dateStr: meta.dateStr, day: meta.day, weekKey: meta.weekKey,
      teacher: L.teacher, department: L.department || '', team: L.team || '',
      type: absenceType_(L.scope).label, periodsAway: L.periodsAway,
      scheduled: L.scheduled, toCover: L.toCover, covered: L.covered,
      uncovered: L.uncovered, reassignedAway: L.reassignedAway,
      runId: meta.runId, markedBy: meta.markedBy || '',
    }, layout));
  }
  var start = Math.max(sheet.getLastRow() + 1, ABSENCE_DATA_START);
  ensureRows_(sheet, start + rows.length - 1);
  sheet.getRange(start, 1, rows.length, layout.width).setValues(rows);
  styleAbsenceRows_(sheet, start, rows);
  applyAbsenceKeyConditionalFormats_(sheet); // the grid may have just grown
  clearCache();
}

/** Status colouring on freshly written register rows (batched by run). */
function styleAbsenceRows_(sheet, start, rows) {
  var layout = absenceRegisterLayout_(sheet);
  if (!layout.width) return;
  var uncoveredCol = absenceHeaderIndex_(layout.map, 'Uncovered');
  var coveredCol = absenceHeaderIndex_(layout.map, 'Covered');
  var bg = [], fg = [];
  for (var i = 0; i < rows.length; i++) {
    var uncovered = uncoveredCol >= 0 && rows[i][uncoveredCol] > 0;
    var band = uncovered ? C.BAD_BG : (i % 2 === 0 ? C.WHITE : C.PAPER);
    var rowBg = [], rowFg = [];
    for (var c = 0; c < layout.width; c++) { rowBg.push(band); rowFg.push(C.INK); }
    if (uncoveredCol >= 0) rowFg[uncoveredCol] = uncovered ? C.ROSE : C.SUBTLE;
    if (coveredCol >= 0) rowFg[coveredCol] = C.GREEN;
    bg.push(rowBg); fg.push(rowFg);
  }
  var range = sheet.getRange(start, 1, rows.length, layout.width);
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
  requireAbsenceHeaders_(absenceRegisterLayout_(sheet), ['Date', 'Teacher']);
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
  var widths = [140, 90, 80, 70, 175, 120, 120, 90, 110, 90, 90, 70, 80, 95, 90, 160, 190, 110];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(2);
  sheet.getRange('A1').setNote(
    'One row per teacher per day of absence — including absences that needed no cover.\n' +
    'Feeds the absence analysis in the weekly Principal report. Row 1 title, row 2 headers, data from row 3.\n' +
    'Absence Type is one of: ' + absenceTypeLabels_().join(' · '));
  var layout = absenceRegisterLayout_(sheet);
  ensureAbsenceKeyNotes_(sheet, ABSENCE_HEADERS);
  var typeCol = absenceHeaderIndex_(layout.map, 'Absence Type');
  if (typeCol >= 0) sheet.getRange(3, typeCol + 1, Math.max(1, sheet.getMaxRows() - 2), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(absenceTypeLabels_(), true)
      .setAllowInvalid(true).build());
  trimColumnsOnly_(sheet, ABSENCE_HEADERS.length);
  applyAbsenceKeyConditionalFormats_(sheet);
}

/** Append the Register's join-key headers without moving or clearing any data. */
function refreshAbsenceRegisterChrome_() {
  var sheet = sheet_(SS.ABSENCE);
  if (!sheet) return [];

  var done = [];
  var required = ['Staff Email', 'Staff Code'];
  var width = sheet.getLastColumn();
  if (!width) return done;
  var headers = sheet.getRange(2, 1, 1, width).getValues()[0];
  var map = absenceHeaderMap_(headers);
  var missing = required.filter(function (header) { return absenceHeaderIndex_(map, header) < 0; });
  // Only extend a row 2 that is really the Register header row.
  var isRegisterHeader = absenceHeaderIndex_(map, 'Teacher') >= 0 && absenceHeaderIndex_(map, 'Date') >= 0;
  if (missing.length && isRegisterHeader) {
    var lastHeader = 0;
    for (var c = 0; c < headers.length; c++) if (norm_(headers[c])) lastHeader = c + 1;
    var target = lastHeader + 1;
    while (target + missing.length - 1 > sheet.getMaxColumns()) {
      sheet.insertColumnAfter(sheet.getMaxColumns());
    }
    sheet.getRange(2, target, 1, missing.length).setValues([missing])
      .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
    missing.forEach(function (header) {
      done.push('🗓️ Absence Register — appended "' + header + '"');
    });
  }
  if (isRegisterHeader) {
    ensureAbsenceKeyNotes_(sheet, sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]);
  }
  applyAbsenceKeyConditionalFormats_(sheet);
  return done;
}

/** Row/rows of a Range (real API getters, or plain properties on test doubles). */
function absenceRangeSpan_(range) {
  var row = typeof range.getRow === 'function' ? range.getRow() : range.row;
  var rows = typeof range.getNumRows === 'function' ? range.getNumRows() : range.numRows;
  var col = typeof range.getColumn === 'function' ? range.getColumn() : range.column;
  return { row: row, rows: rows, col: col };
}

/**
 * Amber only the two key cells when a populated row has a blank key.
 * The range is sized to the sheet's real grid (never past it). An existing
 * rule with the same formula but a narrower range is replaced, so re-running
 * after the grid grows widens it; re-running otherwise changes nothing.
 */
function applyAbsenceKeyConditionalFormats_(sheet) {
  if (!sheet || !sheet.getConditionalFormatRules || !sheet.setConditionalFormatRules ||
      !SpreadsheetApp.newConditionalFormatRule) return;

  var layout = absenceRegisterLayout_(sheet);
  var teacherCol = absenceHeaderIndex_(layout.map, 'Teacher');
  if (teacherCol < 0) return;
  var maxRows = sheet.getMaxRows() - ABSENCE_DATA_START + 1;
  if (maxRows < 1) return;
  var lastRow = ABSENCE_DATA_START + maxRows - 1;

  var teacherA1 = absenceColumnLetter_(teacherCol + 1);
  var wanted = {}; // formula -> key column (1-based)
  ['Staff Email', 'Staff Code'].forEach(function (header) {
    var keyCol = absenceHeaderIndex_(layout.map, header);
    if (keyCol < 0) return;
    var keyA1 = absenceColumnLetter_(keyCol + 1);
    wanted['=AND($' + teacherA1 + ABSENCE_DATA_START + '<>"",$' + keyA1 + ABSENCE_DATA_START + '="")'] = keyCol + 1;
  });

  var satisfied = {};
  var kept = [];
  (sheet.getConditionalFormatRules() || []).forEach(function (rule) {
    var formula = null;
    try {
      var condition = rule.getBooleanCondition();
      if (condition && condition.getCriteriaValues) {
        var values = condition.getCriteriaValues();
        if (values && values.length && values[0]) formula = String(values[0]);
      }
    } catch (e) { /* an older rule or test double may not expose its condition */ }
    if (formula === null || !(formula in wanted)) { kept.push(rule); return; }
    var covers = false;
    try {
      (rule.getRanges() || []).forEach(function (range) {
        var span = absenceRangeSpan_(range);
        if (span.col === wanted[formula] && span.row <= ABSENCE_DATA_START &&
            span.row + span.rows - 1 >= lastRow) covers = true;
      });
    } catch (e) { covers = false; }
    if (covers && !satisfied[formula]) { satisfied[formula] = true; kept.push(rule); }
    // else: narrower (or duplicate) rule — dropped and rebuilt at full size below
  });

  Object.keys(wanted).forEach(function (formula) {
    if (satisfied[formula]) return;
    kept.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula).setBackground(C.AMBER_50)
      .setRanges([sheet.getRange(ABSENCE_DATA_START, wanted[formula], maxRows, 1)]).build());
  });
  sheet.setConditionalFormatRules(kept);
}

function absenceColumnLetter_(column) {
  var out = '';
  while (column > 0) {
    var rem = (column - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    column = Math.floor((column - 1) / 26);
  }
  return out;
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

  var layout = absenceRegisterLayout_(sheet);
  var typeCol = absenceHeaderIndex_(layout.map, 'Absence Type');
  if (typeCol < 0) typeCol = absenceHeaderIndex_(layout.map, 'Leave Scope');
  if (typeCol >= 0 && norm_(layout.headers[typeCol]) !== 'Absence Type') {
    var head = sheet.getRange(2, typeCol + 1);
    head.setValue('Absence Type');
    done.push('🗓️ Absence Register — column renamed to "Absence Type"');
  }

  var last = sheet.getLastRow();
  if (last >= ABSENCE_DATA_START && typeCol >= 0) {
    var n = last - ABSENCE_DATA_START + 1;
    var range = sheet.getRange(ABSENCE_DATA_START, typeCol + 1, n, 1);
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
  var layout = absenceRegisterLayout_(sheet);
  var typeCol = absenceHeaderIndex_(layout.map, 'Absence Type');
  if (typeCol < 0) typeCol = absenceHeaderIndex_(layout.map, 'Leave Scope');
  if (typeCol < 0 || norm_(layout.headers[typeCol]) !== 'Absence Type') return true;
  var last = sheet.getLastRow();
  if (last < ABSENCE_DATA_START) return false;
  var vals = sheet.getRange(ABSENCE_DATA_START, typeCol + 1, last - ABSENCE_DATA_START + 1, 1).getValues();
  for (var r = 0; r < vals.length; r++) {
    var raw = norm_(vals[r][0]);
    if (raw && absenceType_(raw).label !== raw && absenceType_(raw).label !== UNKNOWN_ABSENCE_TYPE.label) return true;
  }
  return false;
}
