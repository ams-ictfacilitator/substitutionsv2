/**
 * ============================================================
 * HrDatabase.gs — the HR Database reader (T-020).
 *
 * readHrDatabase_() is the ONLY code that opens the HR workbook. It is
 * data-minimised by construction (PRD D9, R27-R30, R33-R35):
 *   - the workbook ID, tab, header row, header names and Status filter all come
 *     from 🧭 Roster Settings, never from code;
 *   - it reads the header row, then ONE single-column range per field in the
 *     frozen HR_DB_FIELDS whitelist, so no other column ever enters memory;
 *   - placeholders (D10) become '' inside the reader;
 *   - it logs counts only, caches nothing, writes nothing, and its errors never
 *     contain the workbook ID or a cell value;
 *   - it is called from menu handlers only, as the clicking user. No trigger.
 *
 * Spec: docs/PRD-roster.md D9, D10, D11, §5.8, §6.2, §7.8.
 * ============================================================
 */

/** Friendly text per failure; none of it ever includes the workbook ID or a cell value. */
const HRDB_ERRORS = Object.freeze({
  noId:     'No HR Database is set. Type its Workbook ID into "HR Database source" on 🧭 Roster Settings. Email matching still works without it.',
  noAccess: 'You don\'t have access to the HR Database set on 🧭 Roster Settings (or its Workbook ID is wrong). Ask the HR office to share it with you, or ask someone who has access to run this. Email matching still works without it.',
  noTab:    'The HR Database has no tab with the name set under "HR Database source" on 🧭 Roster Settings. Check the Tab setting. Email matching still works without it.',
  readFail: 'The HR Database could not be read just now. Try again, or ask someone with access to run this. Email matching still works without it.',
});

/**
 * Read the HR Database (whitelisted columns only).
 *
 * @return {{ok:boolean, error?:string, code?:string, records:Object[], diagnostics:Object}}
 *   Never throws. On ok:false, `records` is [] so a caller can carry on with
 *   email matching (see hrDbRecordsOrEmpty_).
 *   records[i] = {status, name, category, teamRole, department, staffCode, officialEmail, row}
 *     for rows whose Status is in the Status filter. staffCode is trimmed and
 *     upper-cased, officialEmail lower-cased, both '' for a placeholder; `row` is
 *     the 1-based source row, for review display.
 *   diagnostics (counts only, plus whitelisted Category values):
 *     {rowsRead, currentRows, recordsKept, headersFound[], headersMissing[],
 *      placeholders:{staffCode, officialEmail}, patternFailures, duplicateCodes,
 *      unmappedCategories[]}
 */
function readHrDatabase_() {
  var fail = function (code, text, diag) {
    Logger.log('HR Database read failed: ' + code);
    return { ok: false, code: code, error: text, records: [], diagnostics: diag || hrDbEmptyDiag_() };
  };
  var settings;
  try { settings = readRosterSettings_(); } catch (e) { return fail('settings', HRDB_ERRORS.readFail); }
  var src = settings.hrSource;
  if (!norm_(src.workbookId)) return fail('no-id', HRDB_ERRORS.noId);

  var sheet;
  try {
    var book = SpreadsheetApp.openById(norm_(src.workbookId));
    sheet = book.getSheetByName(norm_(src.tab));
  } catch (e) { return fail('no-access', HRDB_ERRORS.noAccess); }
  if (!sheet) return fail('no-tab', HRDB_ERRORS.noTab);

  var headerRow = Math.max(1, src.headerRow || 1);
  var at, lastRow;
  try {
    var lastCol = Math.max(1, sheet.getLastColumn());
    at = rosterHeaderCols_(sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0]);   // header row only
    lastRow = sheet.getLastRow();
  } catch (e) { return fail('read-failed', HRDB_ERRORS.readFail); }

  // Locate each whitelisted field by header name (exact after case/space folding; no prefix guessing).
  var colOf = {}, found = [], missing = [], missingRequired = [];
  HR_DB_FIELDS.forEach(function (f) {
    var header = settings.hrHeaders[f.field] || f.header;
    var c = at[rosterHeaderKey_(header)] || 0;
    if (c) { colOf[f.field] = c; found.push(f.field); }
    else { missing.push(f.field); if (f.required) missingRequired.push(header); }
  });
  var diag = hrDbEmptyDiag_();
  diag.headersFound = found;
  diag.headersMissing = missing;
  if (missingRequired.length) {
    return fail('header-missing', 'The HR Database is missing the required column header' + (missingRequired.length > 1 ? 's' : '') +
      ': ' + missingRequired.map(function (h) { return '"' + h + '"'; }).join(', ') +
      '. Fix the header names under "HR Database headers" on 🧭 Roster Settings. Email matching still works without it.', diag);
  }

  // One single-column batch read per found field. Nothing else is read.
  var first = headerRow + 1, n = Math.max(0, lastRow - headerRow), cols = {};
  try {
    HR_DB_FIELDS.forEach(function (f) {
      if (!colOf[f.field]) return;
      cols[f.field] = n > 0 ? sheet.getRange(first, colOf[f.field], n, 1).getValues() : [];
    });
  } catch (e) { return fail('read-failed', HRDB_ERRORS.readFail, diag); }

  var statusOk = {};
  src.statusFilter.forEach(function (s) { statusOk[norm_(s).toLowerCase()] = true; });
  var cell = function (field, i) { return cols[field] ? cols[field][i][0] : ''; };

  var records = [], ph = { staffCode: 0, officialEmail: 0 };
  for (var i = 0; i < n; i++) {
    diag.rowsRead++;
    if (!statusOk[norm_(cell('status', i)).toLowerCase()]) continue;
    diag.currentRows++;
    var name = norm_(cell('name', i));
    if (!name) continue;
    var code = matchClean(cell('staffCode', i), settings);
    var email = matchClean(cell('officialEmail', i), settings);
    if (cols.staffCode && !code) ph.staffCode++;
    if (cols.officialEmail && !email) ph.officialEmail++;
    records.push({
      status: norm_(cell('status', i)), name: name,
      category: norm_(cell('category', i)), teamRole: norm_(cell('teamRole', i)), department: norm_(cell('department', i)),
      staffCode: code.toUpperCase(), officialEmail: email.toLowerCase(), row: first + i,
    });
  }
  diag.placeholders = ph;
  diag.recordsKept = records.length;
  hrDbFillChecks_(records, settings, diag);
  Logger.log('HR Database read: rows=' + diag.rowsRead + ' current=' + diag.currentRows + ' kept=' + diag.recordsKept +
    ' placeholderCodes=' + ph.staffCode + ' placeholderEmails=' + ph.officialEmail);
  return { ok: true, records: records, diagnostics: diag };
}

function hrDbEmptyDiag_() {
  return { rowsRead: 0, currentRows: 0, recordsKept: 0, headersFound: [], headersMissing: [],
           placeholders: { staffCode: 0, officialEmail: 0 }, patternFailures: 0, duplicateCodes: 0, unmappedCategories: [] };
}

/** Pattern failures, duplicate codes and unmapped categories. Placeholders ('') are never counted (D10). */
function hrDbFillChecks_(records, settings, diag) {
  var re = staffCodeRegex_(settings), seen = {}, mapped = {}, unmapped = {};
  settings.hrCategoryMap.forEach(function (m) { mapped[rosterHeaderKey_(m.hrCategory)] = true; });
  records.forEach(function (r) {
    if (r.staffCode) {
      if (!re.test(r.staffCode)) diag.patternFailures++;
      seen[r.staffCode] = (seen[r.staffCode] || 0) + 1;
    }
    var k = rosterHeaderKey_(r.category);
    if (k && !mapped[k]) unmapped[r.category] = true;
  });
  diag.duplicateCodes = Object.keys(seen).filter(function (c) { return seen[c] > 1; }).length;
  diag.unmappedCategories = Object.keys(unmapped).sort();
}

/** What a caller passes to the matcher: the records, or none when the read failed (email matching carries on). */
function hrDbRecordsOrEmpty_(result) {
  return result && result.ok ? result.records : [];
}

/** 'Staff A' -> 'SA'. Initials only; never a full name. */
function hrDbInitials_(name) {
  return norm_(name).split(/\s+/).filter(Boolean).map(function (t) { return t.charAt(0).toUpperCase(); }).join('');
}
/** 'S0123' -> 'A9999'; '' -> '(none)'. Letters and digits are masked, so no real code is shown. */
function hrDbMaskCode_(code) {
  return code ? code.replace(/[A-Z]/g, 'A').replace(/[0-9]/g, '9').replace(/[^A9]/g, '?') : '(none)';
}

/** 🪪 Roster → Test HR Database read. Dry run: writes nothing; counts and a masked sample only (R33). */
function testHrDatabaseRead() {
  rosterRun_('test the HR Database read', function () {
    var ui = SpreadsheetApp.getUi();
    var res = readHrDatabase_();
    var d = res.diagnostics;
    if (!res.ok) {
      var lines = [res.error];
      if (res.code === 'header-missing') lines.push('', 'Headers found: ' + (d.headersFound.join(', ') || 'none'));
      ui.alert('🧪 Test HR Database read', lines.join('\n') + '\n\nNothing was changed.', ui.ButtonSet.OK);
      return;
    }
    var sample = res.records.slice(0, 5).map(function (r) {
      return '  ' + hrDbInitials_(r.name) + '   code ' + hrDbMaskCode_(r.staffCode);
    });
    var body = [
      'Rows read: ' + d.rowsRead + '   Current rows: ' + d.currentRows + '   Kept: ' + d.recordsKept,
      'Headers found: ' + (d.headersFound.join(', ') || 'none'),
      'Headers missing: ' + (d.headersMissing.join(', ') || 'none') + (d.headersMissing.indexOf('officialEmail') > -1 ? '  (email corroboration unavailable)' : ''),
      'Placeholders treated as empty: Staff Code ' + d.placeholders.staffCode + ', Official email ' + d.placeholders.officialEmail,
      'Codes failing the pattern: ' + d.patternFailures,
      'Duplicate codes: ' + d.duplicateCodes,
      'Unmapped categories: ' + (d.unmappedCategories.length ? d.unmappedCategories.join(', ') : 'none'),
      '',
      'Sample (initials and masked code only):',
    ].concat(sample.length ? sample : ['  (no rows)'], ['', 'Nothing was changed.']);
    ui.alert('🧪 Test HR Database read', body.join('\n'), ui.ButtonSet.OK);
  });
}
