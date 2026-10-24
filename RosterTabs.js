/**
 * ============================================================
 * RosterTabs.gs — the roster's tabs, headers and settings (T-011).
 *
 *   🪪 Teachers          the roster: one row per person, joined on Staff Code
 *   🧭 Roster Settings   Categories, HR Database source, header names,
 *                        Category mapping, placeholders, allow list, exclusions
 *   🧾 Sync Preview      derived, plus one human column (Decision)
 *   🪪 Roster Log        append-only audit trail
 *
 * Spec: docs/PRD-roster.md §4 (D1–D4, D8, D10, D11), §6.1, §6.2, §6.4, §6.5.
 *
 * Every builder here is NON-DESTRUCTIVE. Unlike the older write*Tab_()
 * builders none of them calls sheet.clear(): a builder re-run only rewrites
 * chrome (title, headers, formats, validation, colours, protection) and
 * appends whatever is missing. Entered rows are never touched, which is what
 * lets upgradeTabs() and setupAllTabs() stay away from them (README §17).
 *
 * Nothing here reads the HR Database. HR_DB_FIELDS below is only the
 * whitelist, so the Settings tab can show the header names; the reader is T-020.
 * ============================================================
 */

const ROSTER_HEADERS = ['Display Name', 'Staff Code', 'Category', 'Active', 'Email', 'Match Status',
                        'Department', 'Team', 'In Allotment', 'Left On', 'Replaced By',
                        'Confirmed By', 'Confirmed On', 'Notes', 'Staff Code (Locked)'];
const ROSTER_DATA_START = 3;          // row 1 = title, row 2 = headers
const ROSTER_MATCH_STATUSES = ['Unreviewed', 'Confirmed', 'Needs review', 'No email', 'Ignored'];

const SYNC_PREVIEW_HEADERS = ['Display Name', 'Change', 'Evidence', 'Proposed', 'Decision', 'Result'];
const SYNC_DATA_START = 3;
const SYNC_DECISIONS = ['Apply', 'Skip', '—'];

const ROSTER_LOG_HEADERS = ['Timestamp', 'User', 'Display Name', 'Field', 'Old', 'New', 'Reason', 'Source'];
const ROSTER_LOG_DATA_START = 3;
const ROSTER_LOG_SOURCES = ['Sync', 'Apply', 'HR Database', 'Correction', 'First set'];

/**
 * The HR Database whitelist (PRD D9). FROZEN: these seven logical fields are
 * the only columns of the HR workbook that code may ever read. T-020's reader
 * and its minimisation test import this constant. `header` is the default
 * header name, which the Settings tab lets the user edit; `required` says
 * whether the reader must find that header.
 */
const HR_DB_FIELDS = Object.freeze([
  Object.freeze({ field: 'status',        header: 'Status',            required: true  }),
  Object.freeze({ field: 'name',          header: 'Name of the Staff', required: true  }),
  Object.freeze({ field: 'category',      header: 'Category',          required: true  }),
  Object.freeze({ field: 'teamRole',      header: 'Team / Role',       required: false }),
  Object.freeze({ field: 'department',    header: 'Department',        required: false }),
  Object.freeze({ field: 'staffCode',     header: 'Staff Code',        required: true  }),
  Object.freeze({ field: 'officialEmail', header: 'Official email ID', required: false }),
]);

/** Defaults used to seed 🧭 Roster Settings and when it is missing or blank. */
const ROSTER_SETTINGS_DEFAULTS = Object.freeze({
  categories: Object.freeze([
    Object.freeze({ name: 'Teaching',        teaching: true,  joinKey: 'Staff Code', emailRequired: true,  codePrefix: 'S' }),
    Object.freeze({ name: 'Admin',           teaching: false, joinKey: 'Staff Code', emailRequired: true,  codePrefix: 'S' }),
    Object.freeze({ name: 'Support Staff',   teaching: false, joinKey: 'Staff Code', emailRequired: false, codePrefix: 'W' }),
    Object.freeze({ name: 'Resource Person', teaching: false, joinKey: 'Name only',  emailRequired: false, codePrefix: '' }),
  ]),
  hrTab: 'CurrentStaff',
  hrHeaderRow: 1,
  hrStatusFilter: 'Current',
  staffCodePattern: '^[SW]0[0-9]{3}$',
  hrCategoryMap: Object.freeze([
    Object.freeze({ hrCategory: 'Teaching staff', rosterCategory: 'Teaching' }),
    Object.freeze({ hrCategory: 'Administration', rosterCategory: 'Admin' }),
    Object.freeze({ hrCategory: 'Support staff',  rosterCategory: 'Support Staff' }),
    Object.freeze({ hrCategory: 'Resource Person', rosterCategory: 'Resource Person' }),
  ]),
  // A blank cell is ALWAYS a placeholder; these are the written ones (PRD D10).
  placeholders: Object.freeze(['N/A', 'NA', 'n/a', '-', 'none', 'nil', 'TBD']),
});

const ROSTER_JOIN_KEYS = ['Staff Code', 'Name only'];
const ROSTER_SETTINGS_COLS = 5;
const ROSTER_SECTION_MARK = '▸ ';

/** Signal types the exclusion table understands (PRD §5.2). Used by T-012. */
const ROSTER_SIGNAL_TYPES = ['Local part contains', 'Local part matches regex', 'Name contains',
                             'Name is single token', 'Domain is', 'Exact email', 'Honorific'];

/* ───────── 🧭 Roster Settings: the section layout ───────── */

/**
 * One entry per plain range on the tab. `spare` blank rows are left under the
 * seeded rows so the user can add to a list without running into the next one.
 * Order matters only for layout: the reader finds each section by its title.
 */
function rosterSettingsSections_() {
  var D = ROSTER_SETTINGS_DEFAULTS;
  return [
    {
      key: 'categories', title: 'Categories', spare: 6,
      headers: ['Category', 'Teaching?', 'Join key (Staff Code / Name only)', 'Email required?', 'Code prefix'],
      rows: D.categories.map(function (c) {
        return [c.name, c.teaching ? 'TRUE' : 'FALSE', c.joinKey, c.emailRequired ? 'TRUE' : 'FALSE', c.codePrefix];
      }),
      lists: { 'Teaching?': ['TRUE', 'FALSE'], 'Join key': ROSTER_JOIN_KEYS, 'Email required?': ['TRUE', 'FALSE'] },
      text: [],
      note: 'The values of the Category dropdown on 🪪 Teachers.\n' +
            'Exactly one row may be Teaching? = TRUE (rows for it come only from the Allotment sync).\n' +
            'Join key = Name only means the person never has a Staff Code or email and is matched on Display Name.\n' +
            'Code prefix: the letter(s) a Staff Code for this category should start with (comma-separated if several). ' +
            'A code that starts differently is a warning in 🧪 Check roster, never a block. Blank = no check.',
    },
    {
      key: 'hrSource', title: 'HR Database source', spare: 0,
      headers: ['Key', 'Value'],
      rows: [['Workbook ID', ''], ['Tab', D.hrTab], ['Header Row', String(D.hrHeaderRow)],
             ['Status Filter', D.hrStatusFilter], ['Staff Code Pattern', D.staffCodePattern]],
      lists: {}, text: ['Value'],
      note: 'Where the HR Database is. The Workbook ID is typed here, in the live sheet, by the ICT facilitator. ' +
            'It must never be pasted into code, a ticket, a document or a Chat message.\n' +
            'Status Filter: comma-separated Status values that count as current staff.',
    },
    {
      key: 'hrHeaders', title: 'HR Database headers', spare: 0,
      headers: ['Field', 'Header Name', 'Required?'],
      rows: HR_DB_FIELDS.map(function (f) { return [f.field, f.header, f.required ? 'Yes' : 'No']; }),
      lists: {}, text: ['Header Name'],
      note: 'The only HR Database columns that are ever read. The Field column is fixed by code: add no rows. ' +
            'Edit Header Name if the HR workbook renames a column; case and spacing are ignored.',
    },
    {
      key: 'hrCategoryMap', title: 'HR Category mapping', spare: 6,
      headers: ['HR Category', 'Roster Category'],
      rows: D.hrCategoryMap.map(function (m) { return [m.hrCategory, m.rosterCategory]; }),
      lists: {}, text: ['HR Category'],
      note: 'Translates the HR Database Category value to a roster Category. Case and surrounding spaces are ignored. ' +
            'A value not listed here is reported as unmapped, never guessed.',
    },
    {
      key: 'placeholders', title: 'Placeholder values', spare: 6,
      headers: ['Value'],
      rows: D.placeholders.map(function (v) { return [v]; }),
      lists: {}, text: ['Value'],
      note: 'Values that mean "no value" in a Staff Code or Email cell (a blank cell always does). ' +
            'Case and surrounding spaces are ignored. A placeholder is never written to the roster, never a duplicate, never a match.',
    },
    {
      key: 'allowList', title: 'Allow list', spare: 10,
      headers: ['Email', 'Reason'],
      rows: [], lists: {}, text: ['Email'],
      note: 'Directory accounts that look like devices or shared mailboxes but are real people. An address here overrides every exclusion.',
    },
    {
      key: 'exclusions', title: 'Exclusions', spare: 12,
      headers: ['Signal Type', 'Value', 'Reason', 'Enabled'],
      rows: rosterExclusionSeeds_(),
      lists: { 'Signal Type': ROSTER_SIGNAL_TYPES, 'Enabled': ['TRUE', 'FALSE'] },
      text: ['Value'],
      note: 'Directory accounts that are not people. Values are comma-separated, except the two regex rows. ' +
            'Used by the matching engine (PRD §5.2).',
    },
  ];
}

/** PRD §5.2 seed values. All editable. */
function rosterExclusionSeeds_() {
  var R = function (type, value, reason) { return [type, value, reason, 'TRUE']; };
  return [
    R('Local part contains',
      'admin, office, lab, device, print, scan, noreply, no-reply, info, account, library, classroom, room, ' +
      'kiosk, chromebook, ipad, cart, test, support, helpdesk, reception, exam, bus, transport, store, sports, ict, it.',
      'looks like a shared or device mailbox'),
    R('Local part matches regex', '\\d{2,}', 'digits in the address'),
    R('Local part matches regex', '^[a-z]{1,3}$', 'very short address'),
    R('Name contains', 'Lab, Room, Device, Printer, Admin, Office, Account, Class, Block, Desk, Team, Group, Shared',
      'name of a place or group'),
    R('Name is single token', 'TRUE', 'a real person has at least two name parts'),
    R('Domain is', '', 'e.g. a domain used only for devices'),
    R('Exact email', '', 'one address to exclude'),
    R('Honorific', 'Mr, Mrs, Ms, Miss, Dr, Rev, Sr, Fr, Prof', 'stripped from the front of a name before comparing'),
  ];
}

/* ───────── header helpers (columns are always found by name) ───────── */

/** Case-, space- and punctuation-insensitive header key. */
function rosterHeaderKey_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** { headerKey: 1-based column } from one header row's values. First wins. */
function rosterHeaderCols_(headerRow) {
  var at = {};
  for (var i = 0; i < headerRow.length; i++) {
    var k = rosterHeaderKey_(headerRow[i]);
    if (k && !(k in at)) at[k] = i + 1;
  }
  return at;
}

/** Column for `name`: exact key, else the first header that starts with it. 0 when absent. */
function rosterFindCol_(at, name) {
  var k = rosterHeaderKey_(name);
  if (at[k]) return at[k];
  for (var h in at) if (h.indexOf(k) === 0) return at[h];
  return 0;
}

/**
 * Make sure `headers` exist in `row`. Existing headers stay exactly where the
 * user left them; missing ones are appended after the last used column.
 * Returns { headerKey: column }. Writes nothing when nothing is missing.
 */
function ensureHeaderRow_(sheet, row, headers) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var current = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  var at = rosterHeaderCols_(current);
  var used = 0;
  for (var i = 0; i < current.length; i++) if (norm_(current[i])) used = i + 1;
  var missing = headers.filter(function (h) { return !at[rosterHeaderKey_(h)]; });
  if (missing.length) {
    var firstNew = used + 1, lastNew = used + missing.length;
    if (lastNew > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), lastNew - sheet.getMaxColumns());
    sheet.getRange(row, firstNew, 1, missing.length).setValues([missing]);
    for (var m = 0; m < missing.length; m++) at[rosterHeaderKey_(missing[m])] = firstNew + m;
  }
  return at;
}

function rosterStyleHeader_(sheet, row, firstCol, count) {
  sheet.getRange(row, firstCol, 1, count)
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
}

/**
 * Warning-only protection on a range (or, with a null range, the whole tab).
 * Replaces our own earlier one by description so re-runs don't stack.
 */
function rosterProtect_(sheet, range, description) {
  var type = range ? SpreadsheetApp.ProtectionType.RANGE : SpreadsheetApp.ProtectionType.SHEET;
  var existing = sheet.getProtections(type);
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getDescription() === description) existing[i].remove();
  }
  (range ? range.protect() : sheet.protect()).setDescription(description).setWarningOnly(true);
}

/** Hide a tab that holds nothing yet. A tab that is in use is never hidden. */
function rosterHideIfUnused_(sheet, dataStart) {
  if (sheet.getLastRow() >= dataStart) return;
  try { sheet.hideSheet(); } catch (e) { /* the only visible/active tab cannot be hidden */ }
}

/* ───────── 🧭 Roster Settings ───────── */

/**
 * Build the Settings tab, or add whatever sections it is missing. A section
 * that exists is never rewritten, so the user's edits survive every re-run.
 */
function writeRosterSettingsTab_() {
  var sheet = sheet_(SS.ROSTER_SETTINGS);
  if (!sheet) return;
  if (sheet.getLastRow() < 1) {
    titleBand_(sheet, '🧭 Roster Settings', ROSTER_SETTINGS_COLS);
    sheet.getRange('A1').setNote('Settings for 🪪 Teachers. Seeded once; later runs never overwrite your edits. ' +
      'Each block is a plain range found by its ▸ title, so add rows inside the blank space under a block, not elsewhere.');
    sheet.setColumnWidth(1, 230); sheet.setColumnWidth(2, 300);
    sheet.setColumnWidth(3, 300); sheet.setColumnWidth(4, 130);
    sheet.setFrozenRows(1);
  }

  var colA = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues() : [];
  var have = {};
  for (var i = 0; i < colA.length; i++) have[norm_(colA[i][0])] = true;

  var next = Math.max(sheet.getLastRow() + 2, 3);
  var secs = rosterSettingsSections_();
  for (var s = 0; s < secs.length; s++) {
    if (have[ROSTER_SECTION_MARK + secs[s].title]) continue;
    next = appendRosterSettingsSection_(sheet, secs[s], next);
  }
  ensureCodePrefixColumn_(sheet);
  trimColumnsOnly_(sheet, ROSTER_SETTINGS_COLS);
  delete _C.rosterSettings;
}

/**
 * Older Settings tabs have no `Code prefix` column on the Categories table. Add the
 * header, and fill the prefix for the seeded categories ONLY where the cell is blank
 * and only on the run that adds the header; a user's own values and later deliberate
 * blanks are never touched. Idempotent.
 */
function ensureCodePrefixColumn_(sheet) {
  var span = rosterSettingsSpan_(sheet, 'Categories');
  if (!span) return;
  var hdrRow = span.first - 1;
  var width = Math.max(sheet.getLastColumn(), ROSTER_SETTINGS_COLS);
  if (width > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  var at = rosterHeaderCols_(sheet.getRange(hdrRow, 1, 1, width).getValues()[0]);
  if (at[rosterHeaderKey_('Code prefix')]) return;
  var col = 0, hdr = sheet.getRange(hdrRow, 1, 1, width).getValues()[0];
  for (var i = 0; i < hdr.length; i++) if (norm_(hdr[i])) col = i + 1;
  col += 1;
  if (col > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
  sheet.getRange(hdrRow, col).setValue('Code prefix');
  rosterStyleHeader_(sheet, hdrRow, col, 1);
  var n = span.last - span.first + 1;
  var cats = sheet.getRange(span.first, 1, n, 1).getValues(), have = sheet.getRange(span.first, col, n, 1).getValues();
  var fills = ROSTER_SETTINGS_DEFAULTS.categories, changed = false;
  for (var r = 0; r < n; r++) {
    var name = rosterHeaderKey_(cats[r][0]);
    if (!name || norm_(have[r][0]) !== '') continue;
    for (var k = 0; k < fills.length; k++) {
      if (rosterHeaderKey_(fills[k].name) === name && fills[k].codePrefix) { have[r][0] = fills[k].codePrefix; changed = true; }
    }
  }
  if (changed) sheet.getRange(span.first, col, n, 1).setNumberFormat('@').setValues(have);
}

/** Lay out one section at `row`; returns the row where the next one starts. */
function appendRosterSettingsSection_(sheet, sec, row) {
  var W = ROSTER_SETTINGS_COLS;
  var pad = function (arr) { var o = arr.slice(); while (o.length < W) o.push(''); return o; };
  var body = sec.rows.concat([]);
  for (var b = 0; b < sec.spare; b++) body.push([]);
  var block = [pad([ROSTER_SECTION_MARK + sec.title]), pad(sec.headers)];
  body.forEach(function (r) { block.push(pad(r)); });
  var total = block.length;
  ensureRows_(sheet, row + total + 1);
  sheet.getRange(row, 1, total, W).setNumberFormat('@').setValues(block);

  sheet.getRange(row, 1, 1, W).merge().setBackground(C.HEAD_BAND).setFontColor(C.HEAD_DARK)
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');
  sheet.setRowHeight(row, 26);
  sheet.getRange(row, 1).setNote(sec.note);
  rosterStyleHeader_(sheet, row + 1, 1, sec.headers.length);

  var dataRows = body.length;
  if (dataRows) {
    var firstData = row + 2;
    for (var key in sec.lists) {
      var col = rosterFindCol_(rosterHeaderCols_(sec.headers), key);
      if (!col) continue;
      sheet.getRange(firstData, col, dataRows, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(sec.lists[key], true).setAllowInvalid(true).build());
    }
  }
  return row + total + 1;
}

/** Row span { first, last } of a section's data rows on the live tab, or null. */
function rosterSettingsSpan_(sheet, title) {
  if (!sheet || sheet.getLastRow() < 1) return null;
  var colA = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  var start = -1, end = colA.length;
  for (var i = 0; i < colA.length; i++) {
    var v = norm_(colA[i][0]);
    if (start < 0) { if (v === ROSTER_SECTION_MARK + title) start = i; }
    else if (v.indexOf(ROSTER_SECTION_MARK) === 0) { end = i; break; }
  }
  return start < 0 ? null : { first: start + 3, last: end };   // 1-based; band, header, then data
}

/**
 * Read 🧭 Roster Settings into one object, found by section title and column
 * header name (never position). Anything missing falls back to the seeded
 * default, and `problems` lists what could not be used. Cached per execution.
 */
function readRosterSettings_() {
  return memo('rosterSettings', function () {
    var D = ROSTER_SETTINGS_DEFAULTS;
    var out = {
      exists: false, problems: [],
      categories: D.categories.map(function (c) { return Object.assign({}, c); }),
      hrSource: { workbookId: '', tab: D.hrTab, headerRow: D.hrHeaderRow,
                  statusFilter: csvList_(D.hrStatusFilter), staffCodePattern: D.staffCodePattern },
      hrHeaders: {}, ignoredHrFields: [],
      hrCategoryMap: D.hrCategoryMap.map(function (m) { return Object.assign({}, m); }),
      placeholders: D.placeholders.map(function (v) { return v.toLowerCase(); }),
      allowList: [], exclusions: [],
    };
    HR_DB_FIELDS.forEach(function (f) { out.hrHeaders[f.field] = f.header; });

    var sheet = sheet_(SS.ROSTER_SETTINGS);
    if (!sheet || sheet.getLastRow() < 1) return out;
    out.exists = true;
    var grid = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(1, sheet.getLastColumn())).getValues();

    var table = function (title) {
      var start = -1, end = grid.length;
      for (var i = 0; i < grid.length; i++) {
        var v = norm_(grid[i][0]);
        if (start < 0) { if (v === ROSTER_SECTION_MARK + title) start = i; }
        else if (v.indexOf(ROSTER_SECTION_MARK) === 0) { end = i; break; }
      }
      if (start < 0 || start + 1 >= grid.length) return null;
      return { at: rosterHeaderCols_(grid[start + 1]), rows: grid.slice(start + 2, end) };
    };
    var cell = function (row, at, name) {
      var c = rosterFindCol_(at, name);
      return c ? norm_(row[c - 1]) : '';
    };

    var t = table('Categories');
    if (t) {
      var cats = [], seen = {};
      t.rows.forEach(function (r) {
        var name = cell(r, t.at, 'Category');
        if (!name) return;
        var jk = /name/i.test(cell(r, t.at, 'Join key')) ? 'Name only' : 'Staff Code';
        cats.push({ name: name, teaching: isTrue_(cell(r, t.at, 'Teaching?')), joinKey: jk,
                    emailRequired: isTrue_(cell(r, t.at, 'Email required?')),
                    codePrefix: cell(r, t.at, 'Code prefix').toUpperCase() });
      });
      if (cats.length) out.categories = cats; else out.problems.push('Categories table is empty');
    }

    t = table('HR Database source');
    if (t) {
      var kv = {};
      t.rows.forEach(function (r) { var k = rosterHeaderKey_(cell(r, t.at, 'Key')); if (k) kv[k] = cell(r, t.at, 'Value'); });
      if (kv['workbook id']) out.hrSource.workbookId = kv['workbook id'];
      if (kv['tab']) out.hrSource.tab = kv['tab'];
      if (kv['header row']) out.hrSource.headerRow = Math.max(1, toInt_(kv['header row'], D.hrHeaderRow));
      if (kv['status filter']) out.hrSource.statusFilter = csvList_(kv['status filter']);
      if (kv['staff code pattern']) out.hrSource.staffCodePattern = kv['staff code pattern'];
    }
    try { new RegExp(out.hrSource.staffCodePattern); }
    catch (e) {
      out.problems.push('Staff Code Pattern is not a valid expression; the default is used');
      out.hrSource.staffCodePattern = D.staffCodePattern;
    }

    t = table('HR Database headers');
    if (t) {
      var known = {};
      HR_DB_FIELDS.forEach(function (f) { known[f.field] = true; });
      t.rows.forEach(function (r) {
        var field = cell(r, t.at, 'Field'), header = cell(r, t.at, 'Header Name');
        if (!field) return;
        if (!known[field]) { out.ignoredHrFields.push(field); return; }   // the whitelist is fixed by code
        if (header) out.hrHeaders[field] = header;
      });
    }

    t = table('HR Category mapping');
    if (t) {
      var map = [];
      t.rows.forEach(function (r) {
        var a = cell(r, t.at, 'HR Category'), b = cell(r, t.at, 'Roster Category');
        if (a && b) map.push({ hrCategory: a, rosterCategory: b });
      });
      out.hrCategoryMap = map;
    }

    t = table('Placeholder values');
    if (t) {
      var ph = [];
      t.rows.forEach(function (r) { var v = cell(r, t.at, 'Value'); if (v) ph.push(v.toLowerCase()); });
      out.placeholders = ph;
    }

    t = table('Allow list');
    if (t) {
      t.rows.forEach(function (r) {
        var e = cell(r, t.at, 'Email').toLowerCase();
        if (e) out.allowList.push({ email: e, reason: cell(r, t.at, 'Reason') });
      });
    }

    t = table('Exclusions');
    if (t) {
      t.rows.forEach(function (r) {
        var type = cell(r, t.at, 'Signal Type');
        if (!type) return;
        out.exclusions.push({ type: type, value: cell(r, t.at, 'Value'), reason: cell(r, t.at, 'Reason'),
                              enabled: isTrue_(cell(r, t.at, 'Enabled')) });
      });
    }
    return out;
  });
}

/** True for a blank cell or any value on the Placeholder list (PRD D10). */
function isPlaceholder_(value, placeholders) {
  var s = norm_(value).toLowerCase();
  if (!s) return true;
  var list = placeholders || ROSTER_SETTINGS_DEFAULTS.placeholders.map(function (v) { return v.toLowerCase(); });
  return list.indexOf(s) > -1;
}

/** The compiled Staff Code pattern from Settings (default if none or invalid). */
function staffCodeRegex_(settings) {
  var p = settings && settings.hrSource ? settings.hrSource.staffCodePattern : ROSTER_SETTINGS_DEFAULTS.staffCodePattern;
  try { return new RegExp(p); } catch (e) { return new RegExp(ROSTER_SETTINGS_DEFAULTS.staffCodePattern); }
}

/** Resolve a Category name (case/space-insensitive) against the Settings table. */
function rosterCategoryInfo_(settings, name) {
  var key = rosterHeaderKey_(name);
  for (var i = 0; i < settings.categories.length; i++) {
    var c = settings.categories[i];
    if (rosterHeaderKey_(c.name) === key && key) {
      return { known: true, name: c.name, teaching: c.teaching, joinKey: c.joinKey, codePrefix: c.codePrefix || '',
               nameOnly: c.joinKey === 'Name only', emailRequired: c.emailRequired && c.joinKey !== 'Name only' };
    }
  }
  // Unknown or blank: fail toward flagging, so a typo can never hide a missing key.
  return { known: false, name: norm_(name), teaching: false, joinKey: 'Staff Code', nameOnly: false, emailRequired: true, codePrefix: '' };
}

/* ───────── 🪪 Teachers ───────── */

function writeRosterTab_() {
  var sheet = sheet_(SS.ROSTER);
  if (!sheet) return;
  var H = ROSTER_HEADERS, n = H.length;
  titleBand_(sheet, '🪪 Teachers', n);
  var at = ensureHeaderRow_(sheet, 2, H);
  var col = function (h) { return at[rosterHeaderKey_(h)]; };
  var width = 0;
  H.forEach(function (h) { width = Math.max(width, col(h)); });
  rosterStyleHeader_(sheet, 2, 1, width);

  var widths = { 'Display Name': 200, 'Staff Code': 100, 'Category': 130, 'Active': 60, 'Email': 250, 'Match Status': 110,
                 'Department': 130, 'Team': 120, 'In Allotment': 90, 'Left On': 95, 'Replaced By': 170,
                 'Confirmed By': 160, 'Confirmed On': 100, 'Notes': 260, 'Staff Code (Locked)': 110 };
  H.forEach(function (h) { sheet.setColumnWidth(col(h), widths[h]); });
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(1);

  var rows = Math.max(1, sheet.getMaxRows() - ROSTER_DATA_START + 1);
  var dv = function (h) { return sheet.getRange(ROSTER_DATA_START, col(h), rows, 1); };
  var settings = readRosterSettings_();
  dv('Category').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(settings.categories.map(function (c) { return c.name; }), true).setAllowInvalid(true).build());
  dv('Active').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  dv('Match Status').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(ROSTER_MATCH_STATUSES, true).setAllowInvalid(true).build());
  dv('Left On').setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build());
  dv('Left On').setNumberFormat('yyyy-mm-dd');
  dv('Confirmed On').setNumberFormat('yyyy-mm-dd');
  // Plain text so a leading zero survives (S0123 is not a number, but be explicit).
  dv('Staff Code').setNumberFormat('@');
  dv('Staff Code (Locked)').setNumberFormat('@');

  // Code-owned columns are tinted grey; the locked copy is hidden.
  ['In Allotment', 'Match Status', 'Confirmed By', 'Confirmed On', 'Staff Code (Locked)'].forEach(function (h) {
    dv(h).setBackground(C.BUSY_BG);
  });
  sheet.hideColumns(col('Staff Code (Locked)'));

  // Warning-only: a hard lock would shut the coordinator out. Detection is the real guard.
  ['Display Name', 'Staff Code', 'In Allotment', 'Match Status', 'Confirmed By', 'Confirmed On', 'Staff Code (Locked)']
    .forEach(function (h) { rosterProtect_(sheet, dv(h), '🪪 Roster — ' + h + ' is owned by the roster tools'); });

  applyRosterColours_(sheet, at, rows);
  sheet.getRange('A1').setNote(
    'One row per person. Display Name is the Allotment spelling and is never edited.\n' +
    'Staff Code comes from the HR Database, is unique, and is locked once set: correct it only with\n' +
    '🔁 Substitutions → 🪪 Roster → Correct Staff Code…\n' +
    'Active is a human decision; sync only proposes.\n\n' +
    'Colours (always with text in the cell or in 🧪 Check roster):\n' +
    '  amber  missing Staff Code · email awaiting confirmation · not in the Allotment\n' +
    '  red    duplicate Staff Code · Staff Code changed without a correction\n' +
    '  green  email confirmed        grey  nothing expected here');
  trimColumnsOnly_(sheet, width);
}

/** Status colours as conditional formats, so they follow the data. Idempotent: replaces the set. */
function applyRosterColours_(sheet, at, rows) {
  var set = sheet_(SS.ROSTER_SETTINGS);
  var cat = rosterSettingsSpan_(set, 'Categories') || { first: 5, last: 14 };
  var q = "'" + SS.ROSTER_SETTINGS + "'!";
  var rng = function (c) { return q + '$' + c + '$' + cat.first + ':$' + c + '$' + cat.last; };
  var key = function (h) { var c = at[rosterHeaderKey_(h)]; return c; };
  var L = function (h) { return String.fromCharCode(64 + key(h)); };
  var look = function (settingsCol, fallback) {
    return 'IFERROR(INDEX(' + rng(settingsCol) + ',MATCH($' + L('Category') + '3,' + rng('A') + ',0)),"' + fallback + '")';
  };
  var codeRequired = look('C', 'Staff Code') + '="Staff Code"';
  var emailRequired = 'UPPER(' + look('D', 'TRUE') + '&"")="TRUE"';
  var name = '$' + L('Display Name') + '3<>""';
  var code = '$' + L('Staff Code') + '3', lock = '$' + L('Staff Code (Locked)') + '3';
  var active = '$' + L('Active') + '3', status = '$' + L('Match Status') + '3';
  var email = '$' + L('Email') + '3', inAllot = '$' + L('In Allotment') + '3';
  var teachingName = 'IFERROR(INDEX(' + rng('A') + ',MATCH("TRUE",INDEX(UPPER(' + rng('B') + '&""),0),0)),"Teaching")';

  var rule = function (h, formula, bg) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=' + formula).setBackground(bg)
      .setRanges([sheet.getRange(ROSTER_DATA_START, key(h), rows, 1)]).build();
  };
  sheet.setConditionalFormatRules([
    rule('Staff Code', 'AND(' + name + ',' + code + '="",' + codeRequired + ')', C.AMBER_50),
    rule('Staff Code', 'AND(' + code + '<>"",COUNTIFS($' + L('Staff Code') + '$3:$' + L('Staff Code') + ',' + code +
         ',$' + L('Active') + '$3:$' + L('Active') + ',TRUE)>1)', C.ROSE_50),
    rule('Staff Code', 'AND(' + lock + '<>"",' + code + '<>' + lock + ')', C.ROSE_50),
    rule('Match Status', 'AND(' + name + ',' + status + '="Confirmed")', C.GREEN_50),
    rule('Match Status', 'AND(' + name + ',' + emailRequired + ',OR(' + status + '="Needs review",' + status +
         '="Unreviewed",' + status + '=""))', C.AMBER_50),
    rule('Email', 'AND(' + name + ',' + email + '="",NOT(' + emailRequired + '))', C.BUSY_BG),
    rule('In Allotment', 'AND(' + name + ',ISLOGICAL(' + inAllot + '),NOT(' + inAllot + '),' + active +
         '<>FALSE,$' + L('Category') + '3=' + teachingName + ')', C.AMBER_50),
  ]);
}

/* ───────── 🧾 Sync Preview ───────── */

function writeSyncPreviewTab_() {
  var sheet = sheet_(SS.SYNC_PREVIEW);
  if (!sheet) return;
  var H = SYNC_PREVIEW_HEADERS;
  titleBand_(sheet, '🧾 Sync Preview', H.length);
  var at = ensureHeaderRow_(sheet, 2, H);
  var width = 0;
  H.forEach(function (h) { width = Math.max(width, at[rosterHeaderKey_(h)]); });
  rosterStyleHeader_(sheet, 2, 1, width);
  var widths = { 'Display Name': 210, 'Change': 170, 'Evidence': 300, 'Proposed': 200, 'Decision': 90, 'Result': 220 };
  H.forEach(function (h) { sheet.setColumnWidth(at[rosterHeaderKey_(h)], widths[h]); });
  sheet.setFrozenRows(2);
  var rows = Math.max(1, sheet.getMaxRows() - SYNC_DATA_START + 1);
  sheet.getRange(SYNC_DATA_START, at[rosterHeaderKey_('Decision')], rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SYNC_DECISIONS, true).setAllowInvalid(true).build());
  sheet.getRange('A1').setNote(
    'Derived from the Allotment and 🪪 Teachers by 🪪 Roster → Preview sync. Only the Decision column is yours:\n' +
    'Apply = do it, Skip = leave it, — = information only (nothing to apply).\n' +
    'Apply sync adds missing names and deactivates only the rows you leave on Apply. It never edits or deletes a row.');
  trimColumnsOnly_(sheet, width);
  rosterHideIfUnused_(sheet, SYNC_DATA_START);
}

/* ───────── 🪪 Roster Log (append-only) ───────── */

function writeRosterLogTab_() {
  var sheet = sheet_(SS.ROSTER_LOG);
  if (!sheet) return;
  var H = ROSTER_LOG_HEADERS;
  titleBand_(sheet, '🪪 Roster Log', H.length);
  var at = ensureHeaderRow_(sheet, 2, H);
  var width = 0;
  H.forEach(function (h) { width = Math.max(width, at[rosterHeaderKey_(h)]); });
  rosterStyleHeader_(sheet, 2, 1, width);
  var widths = { 'Timestamp': 140, 'User': 200, 'Display Name': 200, 'Field': 110, 'Old': 130, 'New': 130, 'Reason': 320, 'Source': 100 };
  H.forEach(function (h) { sheet.setColumnWidth(at[rosterHeaderKey_(h)], widths[h]); });
  sheet.setFrozenRows(2);
  var rows = Math.max(1, sheet.getMaxRows() - ROSTER_LOG_DATA_START + 1);
  ['Old', 'New'].forEach(function (h) { sheet.getRange(ROSTER_LOG_DATA_START, at[rosterHeaderKey_(h)], rows, 1).setNumberFormat('@'); });
  sheet.getRange(ROSTER_LOG_DATA_START, at[rosterHeaderKey_('Source')], rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ROSTER_LOG_SOURCES, true).setAllowInvalid(true).build());
  rosterProtect_(sheet, null, '🪪 Roster Log — append-only, written by the roster tools');
  sheet.getRange('A1').setNote('Append-only audit trail of roster changes. Code only ever adds rows here; do not edit or sort it. ' +
    'Row 1 title, row 2 headers, data from row 3. Roster fields only; nothing else from the HR Database is ever logged.');
  trimColumnsOnly_(sheet, width);
  rosterHideIfUnused_(sheet, ROSTER_LOG_DATA_START);
}

/**
 * The roster tabs, in the shape upgradeTabs() loops over: [name, builder].
 * Settings first, because the Teachers colours point at the Categories block.
 * Missing tabs only: this list is never used to rebuild an existing tab.
 */
function rosterTabBuilders_() {
  return [
    [SS.ROSTER_SETTINGS, writeRosterSettingsTab_],
    [SS.ROSTER, writeRosterTab_],
    [SS.SYNC_PREVIEW, writeSyncPreviewTab_],
    [SS.ROSTER_LOG, writeRosterLogTab_],
  ];
}

/** Create any roster tab that does not exist (and only that tab). Returns the names created. */
function ensureRosterTabs_() {
  var ss = ss_(), made = [], list = rosterTabBuilders_();
  for (var i = 0; i < list.length; i++) {
    if (ss.getSheetByName(list[i][0])) continue;
    ss.insertSheet(list[i][0]);
    try { list[i][1](); } catch (e) { Logger.log('build ' + list[i][0] + ': ' + e.message); }
    made.push(list[i][0]);
  }
  if (made.length) clearRosterCache_();   // a cached "tab missing" answer must not outlive the tab
  return made;
}
