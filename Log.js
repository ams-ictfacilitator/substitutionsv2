/**
 * ============================================================
 * Log.gs — The 🗂️ Log is the single source of truth for history,
 * weekly caps, and fairness. Every committed assignment lands here.
 * ============================================================
 */

const LOG_HEADERS = ['Timestamp', 'Date', 'Day', 'Week', 'Period', 'Class', 'Subject',
                     'Absent Teacher', 'Substitute', 'Department', 'Status', 'Notified',
                     'Run ID', 'Marked By'];
const LOG_DATA_START = 3; // row 1 = title, row 2 = headers

/**
 * Read all log rows into structured objects (cached per execution).
 */
function readLogRows_() {
  return memo('logRows', function () {
    var sheet = sheet_(SS.LOG);
    if (!sheet || sheet.getLastRow() < LOG_DATA_START) return [];
    var n = sheet.getLastRow() - LOG_DATA_START + 1;
    var data = sheet.getRange(LOG_DATA_START, 1, n, LOG_HEADERS.length).getValues();
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!norm_(r[1]) && !norm_(r[8])) continue;
      out.push({
        ts: r[0], dateStr: normDateCell_(r[1]), day: norm_(r[2]), weekKey: norm_(r[3]),
        period: toInt_(r[4], 0), classSec: norm_(r[5]), subject: norm_(r[6]),
        absent: norm_(r[7]), substitute: norm_(r[8]), dept: norm_(r[9]),
        status: up_(r[10]), notified: norm_(r[11]), runId: norm_(r[12]),
        markedBy: norm_(r[13]), row: LOG_DATA_START + i,
      });
    }
    return out;
  });
}

/** A date cell may be a Date or a string — normalise to "yyyy-MM-dd". */
function normDateCell_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return isoDate_(v);
  return norm_(v);
}

/**
 * Append committed assignments to the log. `meta` = {dateStr, day, weekKey, runId, markedBy}.
 * `assignments` come from the assignment engine.
 */
function appendToLog_(meta, assignments, notifiedFlag) {
  var sheet = sheet_(SS.LOG);
  if (!sheet) return;
  var rows = [];
  for (var i = 0; i < assignments.length; i++) {
    var a = assignments[i];
    rows.push([
      new Date(), meta.dateStr, meta.day, meta.weekKey, a.period,
      a.classSec, a.subject, a.absent,
      a.status === 'ASSIGNED' ? a.substitute : '—',
      a.dept || '', a.status, notifiedFlag ? '✓' : '—',
      meta.runId, meta.markedBy || '',
    ]);
  }
  if (!rows.length) return;
  var start = Math.max(sheet.getLastRow() + 1, LOG_DATA_START);
  ensureRows_(sheet, start + rows.length - 1);
  sheet.getRange(start, 1, rows.length, LOG_HEADERS.length).setValues(rows);
  styleLogRows_(sheet, start, rows.length, assignments);
  clearCache();
}

/** Light status colouring on freshly written log rows. */
function styleLogRows_(sheet, start, count, assignments) {
  for (var i = 0; i < count; i++) {
    var bad = assignments[i].status !== 'ASSIGNED';
    var bg = (i % 2 === 0) ? C.WHITE : C.PAPER;
    var range = sheet.getRange(start + i, 1, 1, LOG_HEADERS.length);
    range.setBackground(bad ? C.BAD_BG : bg).setFontColor(C.INK)
      .setBorder(null, null, true, null, null, null, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(start + i, 11).setFontColor(bad ? C.ROSE : C.GREEN).setFontWeight('bold');
  }
}

/**
 * Remove all log rows for a given date string (used when re-running a day).
 * Returns the number of rows removed.
 */
function clearLogForDate_(dateStr) {
  var sheet = sheet_(SS.LOG);
  if (!sheet || sheet.getLastRow() < LOG_DATA_START) return 0;
  var n = sheet.getLastRow() - LOG_DATA_START + 1;
  var data = sheet.getRange(LOG_DATA_START, 2, n, 1).getValues(); // col B = Date
  var del = [];
  for (var i = 0; i < data.length; i++) {
    if (normDateCell_(data[i][0]) === dateStr) del.push(LOG_DATA_START + i);
  }
  var removed = deleteRowsBatched_(sheet, del);
  clearCache();
  return removed;
}
