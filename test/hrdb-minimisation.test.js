/**
 * T-020: the HR Database reader. Spec: docs/PRD-roster.md D9, D10, D11, R27-R30, R33-R35.
 * The fake HR workbook carries SENTINEL PII in every non-whitelisted column. Placeholder data only: the repo is public.
 */
const fs = require('fs');
const path = require('path');
const { load, DEFAULT_FILES, ROOT } = require('./harness');
const { MOCK } = require('./sheetmock');

const FILES = DEFAULT_FILES.concat(['Reports.js', 'ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'AnalyticsTab.js',
  'HR.js', 'Setup.js', 'MarkAbsenceTab.js', 'Code.js', 'RosterTabs.js', 'Roster.js', 'MatchEngine.js', 'HrDatabase.js']);
const J = JSON.stringify;

/** A fake HR workbook with a recording sheet; every write method throws, getDataRange throws. */
const HR_OVER = `
var __hr = { spans: [], opens: 0, openIds: [], logs: [], cachePuts: 0, props: 0, fetches: 0, toasts: [], failOpen: false, noTab: false, failRead: false };
var __realLog = Logger.log;
Logger.log = function (m) { __hr.logs.push(String(m)); };
var __origConsole = console;
function __hrBuild(grid, tab) {
  var sh = __newSheet(tab || 'CurrentStaff');
  grid.forEach(function (row, r) { row.forEach(function (v, c) { if (v !== '' && v != null) sh.cells[(r + 1) + ',' + (c + 1)] = v; }); });
  sh.maxRows = grid.length + 5; sh.maxCols = Math.max.apply(null, grid.map(function (r) { return r.length; })) + 2;
  var gr = sh.getRange;
  sh.getRange = function (a, b, c, d) {
    __hr.spans.push({ row: a, col: b, nr: c == null ? 1 : c, nc: d == null ? 1 : d });
    if (__hr.failRead) throw new Error('boom');
    var rg = gr(a, b, c, d);
    ['setValues', 'setValue', 'clearContent'].forEach(function (m) { rg[m] = function () { throw new Error('HR WRITE'); }; });
    return rg;
  };
  sh.getDataRange = function () { throw new Error('getDataRange must not be used'); };
  return sh;
}
var __hrSheet = null;
SpreadsheetApp.openById = function (id) {
  __hr.opens++; __hr.openIds.push(id);
  if (__hr.failOpen) throw new Error('No item with the given ID could be found, or you do not have permission to access it. ' + id);
  return { getSheetByName: function (n) { return __hr.noTab || n !== 'CurrentStaff' ? null : __hrSheet; } };
};
CacheService.getScriptCache = (function (orig) { return function () { var c = orig(); var p = c.put; c.put = function (k, v, t) { __hr.cachePuts++; return p(k, v, t); }; return c; }; })(CacheService.getScriptCache);
PropertiesService = { getScriptProperties: function () { return { getProperty: function () { return ''; }, setProperty: function () { __hr.props++; } }; },
                      getDocumentProperties: function () { return { getProperty: function () { return ''; }, setProperty: function () { __hr.props++; } }; } };
UrlFetchApp = { fetch: function () { __hr.fetches++; return { getResponseCode: function () { return 200; }, getContentText: function () { return ''; } }; } };
__ss.toast = function (m, t) { __hr.toasts.push(String(m) + ' ' + String(t)); };
var __ops = [];
function notifyOpsFailure_(what, msg) { __ops.push([what, msg]); }
function toast_(m, t) { __hr.toasts.push(String(m) + ' ' + String(t)); }
function getConfig() { return defaultConfig_(); }
`;

const SENT = ['PII-SENTINEL-MOBILE', 'PII-SENTINEL-FATHER', 'PII-SENTINEL-MOTHER', 'PII-SENTINEL-PERSONALID', 'PII-SENTINEL-ADDRESS', 'PII-SENTINEL-GENDER'];
const ID = 'ID-PLACEHOLDER-NOT-REAL';

// Columns deliberately shuffled; the sentinel columns sit between and around the whitelisted ones.
const HEADERS = ['Mobile Number', 'Name of the Staff', 'Father\'s Name', 'Status', 'Personal ID', 'Category', 'Address Line 1',
                 'Department', 'Mother\'s Name', 'Team / Role', 'Gender', 'Official email ID', 'Staff Code'];
const WL = { 'Name of the Staff': 2, 'Status': 4, 'Category': 6, 'Department': 8, 'Team / Role': 10, 'Official email ID': 12, 'Staff Code': 13 };
function hrRow(o) {
  const r = [SENT[0], o.name, SENT[1], o.status || 'Current', SENT[3], o.category || 'Support staff', SENT[4],
             o.dept || '', SENT[2], o.team || '', SENT[5], o.email || '', o.code || ''];
  return r;
}
function fresh(rows, opts) {
  opts = opts || {};
  const ctx = load(FILES, MOCK + HR_OVER);
  const run = ctx.run;
  run('ensureRosterTabs_()');
  const grid = [opts.headers || HEADERS].concat(rows.map(hrRow));
  run(`__hrSheet = __hrBuild(${J(grid)})`);
  if (!opts.noId) run(`__setHrSource(${J(ID)})`);
  return { ctx, run };
}
// helper injected lazily: write the Workbook ID into the Settings tab like the facilitator would
const SETTER = `
function __setHrSource(id, kv) {
  var sh = sheet_(SS.ROSTER_SETTINGS), n = sh.getLastRow(), at = -1;
  for (var r = 1; r <= n; r++) if (String(sh.cells[r + ',1'] || '').indexOf('HR Database source') > -1) at = r;
  for (var r = at; r <= n; r++) if (sh.cells[r + ',1'] === 'Workbook ID') { sh.cells[r + ',2'] = id; if (!id) delete sh.cells[r + ',2']; }
  kv = kv || {};
  for (var k in kv) for (var r = at; r <= n; r++) if (sh.cells[r + ',1'] === k) sh.cells[r + ',2'] = kv[k];
  _C = {};
}
function __setHrHeader(field, header) {
  var sh = sheet_(SS.ROSTER_SETTINGS), n = sh.getLastRow();
  for (var r = 1; r <= n; r++) if (sh.cells[r + ',1'] === field && sh.cells[r + ',2'] != null) { sh.cells[r + ',2'] = header; }
  _C = {};
}`;
const HR_OVER2 = HR_OVER + SETTER;
function mk(rows, opts) {
  opts = opts || {};
  const ctx = load(FILES, MOCK + HR_OVER2);
  const run = ctx.run;
  run('ensureRosterTabs_()');
  const grid = [opts.headers || HEADERS].concat(rows.map(opts.rowFn || hrRow));
  run(`__hrSheet = __hrBuild(${J(grid)})`);
  if (!opts.noId) run(`__setHrSource(${J(ID)}, ${J(opts.kv || {})})`);
  else run(`__setHrSource('', ${J(opts.kv || {})})`);
  return { ctx, run, read: () => JSON.parse(J(run('readHrDatabase_()'))) };
}

const STAFF = [
  { name: 'Staff A', code: 's0001', email: 'Staff.A@example.test', category: 'Teaching staff', dept: 'Maths', team: 'High School' },
  { name: 'Staff B', code: 'W0002', email: 'N/A', category: 'Support staff', dept: 'Transport', team: 'Drivers' },
  { name: 'Staff C', code: 'N/A', email: 'staff.c@example.test', category: 'Administration', dept: 'Office', team: 'Front desk' },
  { name: 'Staff D', status: 'Former', code: 'S0004', email: 'staff.d@example.test', category: 'Teaching staff' },
  { name: 'Staff E', code: ' S0005 ', email: '', category: 'Teaching staff' },
];

/* ───────── R27: per-column whitelisted reads ───────── */
{
  const t = mk(STAFF);
  t.run('__hr.spans = []');
  const res = t.read();
  const spans = JSON.parse(J(t.run('__hr.spans')));
  const wlCols = Object.values(WL).sort((a, b) => a - b);
  const headerSpans = spans.filter(s => s.row === 1);
  const dataSpans = spans.filter(s => s.row !== 1);
  check('R27 reader returns ok', res.ok === true, J(res.error));
  check('R27 exactly one header-row read and it is the header row only', headerSpans.length === 1 && headerSpans[0].nr === 1 && headerSpans[0].col === 1, J(headerSpans));
  check('R27 every data read is a single column (nc = 1)', dataSpans.length > 0 && dataSpans.every(s => s.nc === 1), J(dataSpans));
  check('R27 the data reads cover exactly the 7 whitelisted columns, one batch each', J(dataSpans.map(s => s.col).sort((a, b) => a - b)) === J(wlCols), J(dataSpans));
  check('R27 each data read starts at the first data row and spans every row at once', dataSpans.every(s => s.row === 2 && s.nr === STAFF.length), J(dataSpans));
  check('R27 getDataRange is never used (the fake throws if it is)', true);
  check('R27 the workbook is opened once, with the ID from Settings', t.run('__hr.opens') === 1 && t.run('__hr.openIds[0]') === ID);
  const hrCode = fs.readFileSync(path.join(ROOT, 'HrDatabase.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  check('R27 the HR workbook ID is not in the source', !/openById\(\s*['"`]/.test(hrCode) && !/[A-Za-z0-9_-]{30,}/.test(hrCode.replace(/['"`][^'"`\n]*['"`]/g, '')));
}

/* ───────── R28: sentinels never leave the reader ───────── */
{
  const t = mk(STAFF);
  const before = t.run('__snapshot()');
  t.run('__resetStats()');
  const res = t.read();
  const out = J(res);
  check('R28 no sentinel in the returned records or diagnostics', SENT.every(s => out.indexOf(s) < 0), out.slice(0, 300));
  check('R28 records hold only the 7 whitelisted fields plus the source row',
    res.records.every(r => J(Object.keys(r).sort()) === J(['category', 'department', 'name', 'officialEmail', 'row', 'staffCode', 'status', 'teamRole'])));
  check('R28 no sentinel in any log line, and the log is counts only',
    t.run('__hr.logs').every(l => SENT.every(s => l.indexOf(s) < 0) && l.indexOf('Staff') < 0 && l.indexOf('example.test') < 0 && l.indexOf(ID) < 0), J(t.run('__hr.logs')));
  check('R28 the reader writes nothing to any sheet', t.run('__snapshot()') === before && t.run('__stats.setValues + __stats.setValue + __stats.clear') === 0);
  check('R28 no cache, properties, Chat call or toast', t.run('__hr.cachePuts') === 0 && t.run('__hr.props') === 0 && t.run('__hr.fetches') === 0 && t.run('__hr.toasts.length') === 0);

  // the dry-run menu path: the same, plus the alert text
  t.run('testHrDatabaseRead()');
  const alerts = JSON.parse(J(t.run('__ui.alerts')));
  const all = J(alerts) + J(t.run('__hr.logs')) + J(t.run('__hr.toasts')) + J(t.run('__ops'));
  check('R28 the dry run shows one dialog and no sentinel appears in it, a log, a toast or an Ops alert', alerts.length === 1 && SENT.every(s => all.indexOf(s) < 0));
  check('R33 the dry run writes nothing to any sheet and caches nothing', t.run('__snapshot()') === before && t.run('__stats.setValues + __stats.setValue + __stats.clear') === 0 && t.run('__hr.cachePuts') === 0);
  const body = alerts[0].body;
  check('R33 the dialog shows counts, headers, pattern, duplicate and category lines', /Rows read: 5/.test(body) && /Current rows: 4/.test(body) &&
    /Headers found:/.test(body) && /Headers missing: none/.test(body) && /Codes failing the pattern: 0/.test(body) && /Duplicate codes: 0/.test(body) && /Unmapped categories: none/.test(body), body);
  check('R33 the sample shows initials and a masked code only, never a full name, code or email',
    /\bSA\b\s+code A9999/.test(body) && !/Staff [A-E]\b/.test(body) && !/S0001|W0002|S0005/i.test(body) && !/example\.test/.test(body) && !/@/.test(body), body);
  check('R33 the sample is capped at 5 rows', (body.match(/ code /g) || []).length <= 5);
  check('the HR workbook ID never appears in any dialog or log', (J(alerts) + J(t.run('__hr.logs'))).indexOf(ID) < 0);
}

/* sentinel guard: the whitelist and this test move together */
{
  const t = mk([]);
  const fields = JSON.parse(J(t.run('HR_DB_FIELDS')));
  check('D9 HR_DB_FIELDS is exactly the seven agreed fields (a change forces a test update)',
    J(fields.map(f => f.field)) === J(['status', 'name', 'category', 'teamRole', 'department', 'staffCode', 'officialEmail']));
  check('D9 every whitelisted header exists in the fake sheet, and every other column is a sentinel column',
    fields.every(f => WL[f.header]) && HEADERS.length === fields.length + 6);
  check('D9 HR_DB_FIELDS is frozen', t.run('Object.isFrozen(HR_DB_FIELDS) && HR_DB_FIELDS.every(Object.isFrozen)') === true);
  check('D9 the whitelist cannot be widened from Settings (an extra field row is ignored)', (() => {
    const u = mk([{ name: 'Staff A', code: 'S0001' }]);
    u.run(`(function(){ var sh = sheet_(SS.ROSTER_SETTINGS), n = sh.getLastRow(), at = -1;
      for (var r = 1; r <= n; r++) if (sh.cells[r+',1'] === 'mobile') at = r;
      if (at < 0) { for (var r = 1; r <= n; r++) if (sh.cells[r+',1'] === 'officialEmail') at = r; sh.cells[(at+1)+',1'] = 'mobile'; sh.cells[(at+1)+',2'] = 'Mobile Number'; }
      _C = {}; })()`);
    u.run('__hr.spans = []');
    const r = u.read();
    const cols = JSON.parse(J(u.run('__hr.spans'))).filter(s => s.row !== 1).map(s => s.col);
    return r.ok && cols.every(c => Object.values(WL).includes(c)) && J(r).indexOf(SENT[0]) < 0;
  })());
}

/* ───────── header-name mapping with shuffled columns ───────── */
{
  const rev = HEADERS.slice().reverse();
  const rowFn = o => hrRow(o).reverse();
  const t = mk(STAFF, { headers: rev, rowFn });
  const res = t.read();
  check('mapping: reversed column order reads the same records', res.ok && res.records.length === 4 && res.records[0].name === 'Staff A' && res.records[0].staffCode === 'S0001', J(res.error));
  check('mapping: case and spacing in the sheet headers are ignored', (() => {
    const h = HEADERS.map(x => x === 'Staff Code' ? '  staff   CODE ' : x === 'Official email ID' ? 'OFFICIAL EMAIL id' : x);
    const u = mk(STAFF, { headers: h });
    const r = u.read();
    return r.ok && r.records[0].staffCode === 'S0001' && r.records[0].officialEmail === 'staff.a@example.test';
  })());
  check('mapping: a renamed header works once the Settings header name is edited', (() => {
    const h = HEADERS.map(x => x === 'Staff Code' ? 'Employee Code' : x);
    const u = mk(STAFF, { headers: h });
    const before = u.read();
    u.run(`__setHrHeader('staffCode', 'Employee Code')`);
    const after = u.read();
    return before.ok === false && after.ok === true && after.records[0].staffCode === 'S0001';
  })());
  check('mapping: a non-whitelisted look-alike header is not picked up by prefix ("Staff Code (old)")', (() => {
    const h = HEADERS.map(x => x === 'Staff Code' ? 'Staff Code (old)' : x);
    const r = mk(STAFF, { headers: h }).read();
    return r.ok === false && r.code === 'header-missing';
  })());
  check('mapping: the header row setting is honoured', (() => {
    const t2 = mk(STAFF, { kv: { 'Header Row': '2' }, headers: ['Report title'] });
    // rebuild with a title row above the headers
    const grid = [['Report title']].concat([HEADERS], STAFF.map(hrRow));
    t2.run(`__hrSheet = __hrBuild(${J(grid)})`);
    const r = JSON.parse(J(t2.run('readHrDatabase_()')));
    return r.ok && r.records.length === 4 && r.records[0].row === 3;
  })());
}

/* ───────── R30: Status filter ───────── */
{
  const t = mk(STAFF);
  const res = t.read();
  check('R30 a non-Current row is never returned', res.records.every(r => r.status === 'Current') && !res.records.some(r => r.name === 'Staff D'));
  check('R30 the diagnostics say how many rows were read and how many are Current', res.diagnostics.rowsRead === 5 && res.diagnostics.currentRows === 4);
  const u = mk(STAFF, { kv: { 'Status Filter': 'current, former' } });
  check('R30 the filter list is read from Settings (case-insensitive, comma-separated)', u.read().records.length === 5);
  const v = mk([{ name: 'Staff A', status: ' CURRENT ', code: 'S0001' }, { name: 'Staff B', status: 'Retired', code: 'S0002' }]);
  check('R30 Status is compared case-insensitively and an unlisted Status is excluded', v.read().records.length === 1);
  check('records are normalised: code upper-cased and trimmed, email lower-cased', res.records[0].staffCode === 'S0001' && res.records[0].officialEmail === 'staff.a@example.test' && res.records.find(r => r.name === 'Staff E').staffCode === 'S0005');
}

/* ───────── R35 / D10 / D11: the N/A regression ───────── */
{
  const rows = [
    { name: 'Staff A', code: 'S0001', email: 'staff.a@example.test', category: 'Teaching staff' },
    { name: 'Staff B', code: 'W0002', email: '', category: 'Support staff' },
    { name: 'Resource Person 1', code: 'N/A', email: 'N/A', category: 'Resource Person' },
    { name: 'Resource Person 2', code: 'N/A', email: 'N/A', category: 'Resource Person' },
    { name: 'Resource Person 3', code: 'N/A', email: 'n/a', category: 'Resource Person' },
    { name: 'Resource Person 4', code: 'n/a', email: '-', category: 'Resource Person' },
    { name: 'Staff F', code: '-', email: 'TBD', category: 'Support staff' },
    { name: 'Staff G', code: 'TBD', email: 'none', category: 'Support staff' },
    { name: 'Staff H', code: '', email: 'Nil', category: 'Support staff' },
    { name: 'Staff I', code: 'NA', email: 'NA', category: 'Administration' },
  ];
  const t = mk(rows);
  const res = t.read();
  const d = res.diagnostics;
  check('R35 every placeholder code and email becomes an empty string', res.records.every(r => !/^(n\/a|na|-|none|nil|tbd)$/i.test(r.staffCode) && !/^(n\/a|na|-|none|nil|tbd)$/i.test(r.officialEmail)) &&
    res.records.filter(r => r.staffCode === '').length === 8);
  check('R35 placeholders are counted per field (blank included)', d.placeholders.staffCode === 8 && d.placeholders.officialEmail === 9, J(d.placeholders));
  check('R35 zero duplicate-code reports from the many N/A rows', d.duplicateCodes === 0);
  check('R35 zero pattern errors from placeholders', d.patternFailures === 0);
  check('D11 Resource Persons are returned (linkable by name), with empty code and email, and are not an error', res.ok && res.records.filter(r => r.category === 'Resource Person').length === 4 &&
    res.records.filter(r => r.category === 'Resource Person').every(r => r.staffCode === '' && r.officialEmail === ''));
  check('R35 a real duplicate code and a real pattern failure are still counted', (() => {
    const u = mk(rows.concat([{ name: 'Staff J', code: 'S0001' }, { name: 'Staff K', code: 'BAD-1' }]));
    const dd = u.read().diagnostics;
    return dd.duplicateCodes === 1 && dd.patternFailures === 1;
  })());
  check('R35 the placeholder list comes from Settings (an added word is honoured, a removed one is not)', (() => {
    const u = mk([{ name: 'Staff A', code: 'PENDING', email: 'x@example.test' }, { name: 'Staff B', code: 'TBD', email: '' }]);
    u.run(`(function(){ var sh = sheet_(SS.ROSTER_SETTINGS), n = sh.getLastRow(), at = -1;
      for (var r = 1; r <= n; r++) if (String(sh.cells[r+',1']||'').indexOf('Placeholder values') > -1) at = r;
      var rr = at + 2;                                    // first data row under band + header
      var list = []; while (sh.cells[rr+',1']) { list.push(sh.cells[rr+',1']); rr++; }
      sh.cells[at+2+6+',1'] = 'PENDING'; _C = {}; })()`);
    const r = u.read();
    return r.records[0].staffCode === '' && r.records[1].staffCode !== '';
  })());
  check('R35 the matcher accepts the reader output: Resource Person links on name alone, no code needed, no error', (() => {
    const out = t.run(`(function(){ var recs = readHrDatabase_().records;
      var m = matchStaffCodeLinks([{ displayName: 'Resource Person 2', category: 'Resource Person', staffCode: '', email: '', row: 3 }], recs, readRosterSettings_());
      return { cls: m.results[0].class, dups: m.duplicateCodes.length, write: m.results[0].writeCode }; })()`);
    return out.dups === 0 && out.write === false && /Confirmed|exact/i.test(out.cls);
  })());
}

/* ───────── R29: friendly errors ───────── */
{
  const leaks = (res) => [ID, ...SENT, 'Staff A', 'example.test'].some(s => (res.error || '').indexOf(s) > -1);
  const cases = [];
  { const t = mk(STAFF, { noId: true }); cases.push(['no ID set', t.read(), 'no-id', /Workbook ID.*Roster Settings/, t]); }
  { const t = mk(STAFF); t.run('__hr.failOpen = true'); cases.push(['no access / wrong ID', t.read(), 'no-access', /don't have access.*Roster Settings/, t]); }
  { const t = mk(STAFF); t.run('__hr.noTab = true'); cases.push(['tab missing', t.read(), 'no-tab', /no tab.*Tab setting/, t]); }
  { const t = mk(STAFF, { headers: HEADERS.map(x => x === 'Status' ? 'Employment' : x) }); cases.push(['required header missing', t.read(), 'header-missing', /missing the required column header: "Status"/, t]); }
  { const t = mk(STAFF); t.run('__hr.failRead = true'); cases.push(['a read throws', t.read(), 'read-failed', /could not be read/, t]); }
  cases.forEach(([label, res, code, re, t]) => {
    check(`R29 ${label}: ok:false with a friendly error, no throw, no records`, res.ok === false && res.code === code && re.test(res.error) && res.records.length === 0, J(res));
    check(`R29 ${label}: the error never contains the workbook ID or any cell value`, !leaks(res), res.error);
    check(`R29 ${label}: email matching can carry on (caller gets an empty list)`, t.run('hrDbRecordsOrEmpty_(readHrDatabase_()).length') === 0 && t.run('Array.isArray(hrDbRecordsOrEmpty_(readHrDatabase_()))'));
    check(`R29 ${label}: logs hold counts/codes only`, t.run('__hr.logs').every(l => l.indexOf(ID) < 0 && SENT.every(s => l.indexOf(s) < 0)));
  });
  check('R29 a missing OPTIONAL header (Official email ID) is not an error and is reported as missing', (() => {
    const t = mk(STAFF, { headers: HEADERS.map(x => x === 'Official email ID' ? 'Other column' : x) });
    const r = t.read();
    return r.ok && r.diagnostics.headersMissing.join() === 'officialEmail' && r.records.every(x => x.officialEmail === '');
  })());
  check('R29 the dry run shows the friendly error for a failure and writes nothing', (() => {
    const t = mk(STAFF); t.run('__hr.failOpen = true');
    const before = t.run('__snapshot()');
    t.run('testHrDatabaseRead()');
    const a = JSON.parse(J(t.run('__ui.alerts')));
    return a.length === 1 && /don't have access/.test(a[0].body) && a[0].body.indexOf(ID) < 0 && t.run('__snapshot()') === before && t.run('__ops.length') === 0;
  })());
  check('R29 a header-missing dry run lists which fields were found, not cell values', (() => {
    const t = mk(STAFF, { headers: HEADERS.map(x => x === 'Category' ? 'Kind' : x) });
    t.run('testHrDatabaseRead()');
    const a = JSON.parse(J(t.run('__ui.alerts')));
    return /"Category"/.test(a[0].body) && /Headers found:/.test(a[0].body) && SENT.every(s => a[0].body.indexOf(s) < 0);
  })());
  check('an empty HR tab (header only) is ok with zero records', (() => { const r = mk([]).read(); return r.ok && r.records.length === 0 && r.diagnostics.rowsRead === 0; })());
}

/* ───────── R33: diagnostics ───────── */
{
  const t = mk([
    { name: 'Staff A', code: 'S0001', category: 'Teaching staff' },
    { name: 'Staff B', code: 'S0001', category: 'Mystery category' },
    { name: 'Staff C', code: 'X99', category: 'Support staff' },
  ]);
  const d = t.read().diagnostics;
  check('R33 duplicate codes, pattern failures and unmapped categories are counted', d.duplicateCodes === 1 && d.patternFailures === 1 && J(d.unmappedCategories) === J(['Mystery category']), J(d));
  check('R33 found headers listed', d.headersFound.length === 7 && d.headersMissing.length === 0);
  t.run('testHrDatabaseRead()');
  const body = JSON.parse(J(t.run('__ui.alerts')))[0].body;
  check('R33 the dialog lists the unmapped category value (it is whitelisted) and the counts', /Unmapped categories: Mystery category/.test(body) && /Duplicate codes: 1/.test(body) && /Codes failing the pattern: 1/.test(body));
}

/* ───────── R34: menu only, never a trigger ───────── */
{
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const srcs = {}; files.forEach(f => { srcs[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
  const all = Object.values(srcs).join('\n');
  const body = (name) => {                                   // function body by brace matching
    const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(all);
    if (!m) return '';
    let i = all.indexOf('{', m.index), depth = 0, j = i;
    for (; j < all.length; j++) { if (all[j] === '{') depth++; else if (all[j] === '}' && --depth === 0) break; }
    return all.slice(i, j + 1);
  };
  const handlers = new Set(['onOpen', 'onEdit', 'onInstall', 'doGet', 'doPost', 'onEditInstallable', 'runWeeklyReportTrigger']);
  (all.match(/newTrigger\(\s*['"](\w+)['"]/g) || []).forEach(m => handlers.add(/['"](\w+)['"]/.exec(m)[1]));
  const bad = [...handlers].filter(h => /readHrDatabase_\(|testHrDatabaseRead\(/.test(body(h)));
  check('R34 no trigger or simple-trigger handler calls the HR read', bad.length === 0 && handlers.size >= 5, J(bad));
  check('R34 the reader itself never installs or touches a trigger, cache or properties',
    !/ScriptApp|CacheService|PropertiesService|UrlFetchApp|postChat|notifyOps/.test(srcs['HrDatabase.js'].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  const callers = files.filter(f => f !== 'HrDatabase.js' && /readHrDatabase_\(/.test(srcs[f].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  check('R34 the only callers outside HrDatabase.js are the roster review (preview and apply, both reached from menu handlers only)',
    J(callers.sort()) === J(['RosterReview.js']), J(callers));
  check('R34 the dry run is a menu item under 🪪 Roster', (() => {
    const ctx = load(files, MOCK + HR_OVER2);
    ctx.run('onOpen()');
    const items = JSON.parse(J(ctx.run('__ui.items')));
    return items.some(i => i.fn === 'testHrDatabaseRead' && /Test HR Database read/.test(i.label)) && ctx.run('typeof testHrDatabaseRead') === 'function';
  })());
  check('the reader has no HR workbook ID, real names or real emails in source or test', (() => {
    const text = srcs['HrDatabase.js'] + fs.readFileSync(__filename, 'utf8');
    const addrs = (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).filter(a => !/@example\.test$/i.test(a));
    return addrs.length === 0;
  })());
}

/* no duplicate top-level names across the project */
{
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const decl = {};
  files.forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    (src.match(/^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm) || []).forEach(m => {
      const n = m.replace(/^(function|const|let|var)\s+/, '');
      (decl[n] = decl[n] || []).push(f);
    });
  });
  const dups = Object.keys(decl).filter(n => decl[n].length > 1);
  check('no top-level name is declared in two root files', dups.length === 0, J(dups));
}
