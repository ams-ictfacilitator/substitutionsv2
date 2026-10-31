/**
 * T-013: 🪪 Roster Review — settings adapter, Preview matches, Apply decisions.
 * Spec: docs/PRD-roster.md D2, D3, D6, D9-D11, §5.5-5.8, §6.3, R8-R10, R28, R31, R32, R35, R36.
 * Placeholder data only: the repo is public. The fake HR workbook carries SENTINEL PII in every
 * non-whitelisted column, and `N/A` placeholders in the code and email columns.
 */
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./harness');
const { MOCK } = require('./sheetmock');

const FILES = ['Constants.js', 'Config.js', 'Dates.js', 'Chat.js', 'Log.js', 'AbsenceRegister.js', 'Pool.js', 'Rules.js', 'DataSource.js', 'Assign.js',
  'Reports.js', 'ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'AnalyticsTab.js', 'HR.js', 'Setup.js', 'MarkAbsenceTab.js', 'Code.js',
  'RosterTabs.js', 'Roster.js', 'MatchEngine.js', 'HrDatabase.js', 'RosterReview.js'];
const J = JSON.stringify;
const eq = (a, b) => J(a) === J(b);

const OVER = `
var __hr = { spans: [], opens: 0, logs: [], failOpen: false, noTab: false, failRead: false };
Logger.log = function (m) { __hr.logs.push(String(m)); };
function __hrBuild(grid) {
  var sh = __newSheet('CurrentStaff');
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
  __hr.opens++;
  if (__hr.failOpen) throw new Error('No item with the given ID could be found. ' + id);
  return { getSheetByName: function (n) { return __hr.noTab || n !== 'CurrentStaff' ? null : __hrSheet; } };
};
var __ops = [];
function notifyOpsFailure_(what, msg) { __ops.push([what, msg]); }
function toast_(m, t) { __hr.logs.push('TOAST ' + m); }
function getConfig() { return defaultConfig_(); }
var __backups = { n: 0, fail: false, reasons: [] };
function backupWorkbook_(reason) {
  if (__backups.fail) throw new Error('Drive is full');
  __backups.n++; __backups.reasons.push(reason);
  return { getName: function () { return 'Backup copy'; } };
}
function __setHrSource(id, kv) {
  var sh = sheet_(SS.ROSTER_SETTINGS), n = sh.getLastRow(), at = -1;
  for (var r = 1; r <= n; r++) if (String(sh.cells[r + ',1'] || '').indexOf('HR Database source') > -1) at = r;
  for (var r = at; r <= n; r++) if (sh.cells[r + ',1'] === 'Workbook ID') { if (id) sh.cells[r + ',2'] = id; else delete sh.cells[r + ',2']; }
  kv = kv || {};
  for (var k in kv) for (var r = at; r <= n; r++) if (sh.cells[r + ',1'] === k) sh.cells[r + ',2'] = kv[k];
  _C = {};
}
function __addSettingRow(title, vals) {
  var sh = sheet_(SS.ROSTER_SETTINGS), sp = rosterSettingsSpan_(sh, title);
  for (var r = sp.first; r <= sh.maxRows; r++) {
    if (String(sh.cells[r + ',1'] || '').indexOf('▸ ') === 0) break;
    var blank = true;
    for (var c = 1; c <= 5; c++) if (sh.cells[r + ',' + c] != null && sh.cells[r + ',' + c] !== '') blank = false;
    if (blank) { vals.forEach(function (v, i) { sh.cells[r + ',' + (i + 1)] = v; }); _C = {}; return r; }
  }
  throw new Error('no spare row in ' + title);
}
function __setSettingCell(title, firstColValue, col, v) {
  var sh = sheet_(SS.ROSTER_SETTINGS), sp = rosterSettingsSpan_(sh, title);
  for (var r = sp.first; r <= sp.last; r++) if (sh.cells[r + ',1'] === firstColValue) { sh.cells[r + ',' + col] = v; _C = {}; return r; }
  throw new Error('no row ' + firstColValue);
}
function __reviewCol(h) {
  var sh = sheet_(SS.ROSTER_REVIEW);
  for (var c = 1; c <= sh.maxCols; c++) if (sh.cells['2,' + c] === h) return c;
  throw new Error('no review header ' + h);
}
function __reviewRowOf(prefix) {
  var sh = sheet_(SS.ROSTER_REVIEW), kc = __reviewCol('Key'), n = sh.getLastRow();
  for (var r = 3; r <= n; r++) if (String(sh.cells[r + ',' + kc] || '').indexOf(prefix) === 0) return r;
  throw new Error('no review row ' + prefix);
}
function __decide(prefix, o) {
  var r = __reviewRowOf(prefix), sh = sheet_(SS.ROSTER_REVIEW);
  for (var h in o) { var c = __reviewCol(h); if (o[h] === '' ) delete sh.cells[r + ',' + c]; else sh.cells[r + ',' + c] = o[h]; }
}
function __rv(prefix, h) { return sheet_(SS.ROSTER_REVIEW).cells[__reviewRowOf(prefix) + ',' + __reviewCol(h)] || ''; }
`;

const SENT = ['PII-SENTINEL-MOBILE', 'PII-SENTINEL-FATHER', 'PII-SENTINEL-MOTHER', 'PII-SENTINEL-PERSONALID', 'PII-SENTINEL-ADDRESS', 'PII-SENTINEL-GENDER'];
const ID = 'ID-PLACEHOLDER-NOT-REAL';
const HEADERS = ['Mobile Number', 'Name of the Staff', 'Father\'s Name', 'Status', 'Personal ID', 'Category', 'Address Line 1',
                 'Department', 'Mother\'s Name', 'Team / Role', 'Gender', 'Official email ID', 'Staff Code'];
const hrRow = o => [SENT[0], o.name, SENT[1], o.status || 'Current', SENT[3], o.cat, SENT[4], o.dept || '', SENT[2], o.team || '', SENT[5], o.email || '', o.code || ''];

const IMP = [['Staff A', 'staff.a@example.test'], ['Asha E Kumar', 'asha.example@example.test'], ['C Person', 'c.person@example.test'],
             ['Front Desk Person', 'front.desk@example.test']];
const ROSTER = [
  { 'Display Name': 'Staff A', Category: 'Teaching', Active: true },
  { 'Display Name': 'Asha Example', Category: 'Teaching', Active: true },
  { 'Display Name': 'Staff C', Category: 'Admin', Active: true },
  { 'Display Name': 'Staff D', Category: 'Support Staff', Active: true },
  { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
  { 'Display Name': 'Staff M', Category: 'Support Staff', Active: true },
];
const HR = [
  { name: 'Staff A', cat: 'Teaching staff', code: 'S0001', email: 'staff.a@example.test', dept: 'Maths', team: 'High School' },
  { name: 'Asha Example', cat: 'Teaching staff', code: 's0003', email: 'Asha.Example@example.test', dept: 'Science', team: 'High School' },
  { name: 'Staff C', cat: 'Administrative staff', code: 'S0004', email: 'N/A', dept: 'Office', team: 'Front desk' },
  { name: 'Staff D', cat: 'Support staff', code: 'W0005', email: '', dept: 'Transport', team: 'Drivers' },
  { name: 'Consultant R', cat: 'Resource Person', code: 'N/A', email: 'n/a', dept: 'Arts', team: 'Visiting' },
  { name: 'Staff M', cat: 'Support staff', code: 'X123', email: '-', dept: 'Garden', team: 'Grounds' },
  // not on the roster
  { name: 'Staff E', cat: 'Support staff', code: 'W0006', email: '', dept: 'Garden', team: 'Grounds' },
  { name: 'Staff F', cat: 'Administrative staff', code: 'N/A', email: 'N/A', dept: 'Office', team: 'Accounts' },
  { name: 'Consultant G', cat: 'Resource Person', code: 'N/A', email: 'N/A', dept: 'Arts' },
  { name: 'Consultant H', cat: 'Resource Person', code: 'W0099', email: 'consultant.h@example.test' },
  { name: 'Staff J', cat: 'Mystery', code: 'S0100' },
  { name: 'Staff K', status: 'Former', cat: 'Support staff', code: 'W0101' },
  { name: 'Staff L', cat: 'Teaching staff', code: 'S0102' },
];

function mk(o) {
  o = o || {};
  const ctx = load(FILES, MOCK + OVER);
  const run = ctx.run;
  run('ensureRosterTabs_()');
  const t = { ctx, run };
  t.put = (tab, hdr, start, rows) => run(`__put(${J(tab)}, ${hdr}, ${start}, ${J(rows)})`);
  t.hrSet = rows => run(`__hrSheet = __hrBuild(${J([HEADERS].concat(rows.map(hrRow)))})`);
  t.impSet = rows => run(`(function(){ var s = sheet_(SS.IMPORT_HR) || __ss.insertSheet(SS.IMPORT_HR);
    Object.keys(s.cells).forEach(function (k) { delete s.cells[k]; }); s.maxRows = 200; s.cells['2,1'] = 'Teacher Name'; s.cells['2,2'] = 'Email'; s.cells['2,3'] = 'Chat User ID (users/123…)';
    ${J(rows)}.forEach(function (r, i) { s.cells[(3 + i) + ',1'] = r[0]; s.cells[(3 + i) + ',2'] = r[1]; }); })()`);
  t.impSet(o.imp || IMP);
  t.put('🪪 Teachers', 2, 3, o.roster || ROSTER);
  t.hrSet(o.hr || HR);
  if (!o.noId) run(`__setHrSource(${J(ID)})`);
  t.preview = () => run('previewRosterMatches_()');
  t.apply = (opts) => run(`applyRosterDecisions_(${opts ? '{continueWithoutBackup: function(){ return true; }}' : ''})`);
  t.decide = (prefix, d, manual, override, notes) => {
    const x = { Decision: d };
    if (manual !== undefined) x['Manual Email / Code'] = manual;
    if (override !== undefined) x['Display Name override'] = override;
    if (notes !== undefined) x.Notes = notes;
    run(`__decide(${J(prefix)}, ${J(x)})`);
  };
  t.rv = (prefix, h) => run(`__rv(${J(prefix)}, ${J(h)})`);
  t.rows = () => { run('clearRosterCache_()'); return run('readRosterRows_()').rows; };
  t.row = name => t.rows().find(r => r.name === name);
  t.tab = name => J(run(`Object.keys(__book.sheets[${J(name)}].cells).sort().map(function(k){return [k, __book.sheets[${J(name)}].cells[k]]})`));
  t.snap = tabs => run(`__snapshot(${J(tabs || null)})`);
  t.log = () => {
    const n = run('sheet_(SS.ROSTER_LOG).getLastRow()'), out = [];
    for (let r = 3; r <= n; r++) out.push([3, 4, 5, 6, 8, 7].map(c => run(`__cell(SS.ROSTER_LOG, ${r}, ${c})`)));
    return out;
  };
  t.result = prefix => t.rv(prefix, 'Result');
  t.alerts = () => run('__ui.alerts');
  return t;
}
const TEACH = '🪪 Teachers', REV = '🪪 Roster Review', LOGT = '🪪 Roster Log', SET = '🧭 Roster Settings';

/* ───────── the settings adapter: the matcher must use the SHEET's values ───────── */
{
  const t = mk({ hr: HR.concat([
    { name: 'Staff N', cat: 'Helpers', code: 'W0200' },
    { name: 'Staff O', status: 'Contract', cat: 'Support staff', code: 'W0201' },
    { name: 'Staff P', cat: 'Support staff', code: 'pending' },
    { name: 'Staff Q', cat: 'Support staff', code: 'X123' }]) });
  const before = t.preview().summary;
  const absent = n => { try { t.run(`__reviewRowOf('Propose add|${n}|')`); return false; } catch (e) { return true; } };
  check('adapter: with the seeded sheet values "Helpers" is unmapped and a Contract row is not read',
    before.unmapped.indexOf('Helpers') > -1 && absent('Staff N') && absent('Staff O'), J(before.unmapped));
  check('adapter: with the seeded sheet values X123 fails the pattern and "pending" counts as a code',
    before.patternWarnings >= 1 && t.rv('Propose add|Staff P|', 'Candidate 1 Value') === 'PENDING');

  t.run(`__addSettingRow('HR Category mapping', ['Helpers', 'Support Staff'])`);
  t.run(`__setSettingCell('HR Database source', 'Status Filter', 2, 'Current, Contract')`);
  t.run(`__setSettingCell('HR Database source', 'Staff Code Pattern', 2, '^[SWX][0-9]{3,4}$')`);
  t.run(`__addSettingRow('Placeholder values', ['pending'])`);
  const after = t.preview();
  const rvTab = t.tab(REV);
  check('adapter: the sheet\'s Category mapping is used (Helpers is now proposed as Support Staff, no longer unmapped)',
    after.summary.unmapped.indexOf('Helpers') < 0 && t.rv('Propose add|Staff N', 'Category') === 'Support Staff');
  check('adapter: the sheet\'s Status filter is used (the Contract row is now read and proposed)', t.rv('Propose add|Staff O', 'Category') === 'Support Staff');
  check('adapter: the sheet\'s pattern is used (X123 is no longer a warning)', after.summary.patternWarnings === 0 && !/pattern warning/i.test(t.rv('Staff Code|Staff M', 'Evidence')));
  check('adapter: the sheet\'s Placeholder list is used ("pending" is no code: nothing offered, evidence says so)',
    t.rv('Propose add|Staff P', 'Candidate 1 Value') === '' && /No code in HR Database/.test(t.rv('Propose add|Staff P', 'Evidence')));

  // exclusions, allow list, honorifics straight from the sheet
  const ms = (() => t.run('matchSettingsFromRoster_(readRosterSettings_())'))();
  check('adapter: translated key names (hr/roster, statusFilter, staffCodePattern, allow)', ms.hrCategoryMap.some(m => m.hr === 'Helpers' && m.roster === 'Support Staff') &&
    eq(ms.statusFilter, ['Current', 'Contract']) && ms.staffCodePattern === '^[SWX][0-9]{3,4}$' && ms.placeholders.indexOf('pending') > -1 && Array.isArray(ms.allow));
  const ex = e => t.run(`matchExclusion({ name: 'Some Person', email: ${J(e)} }, matchSettingsFromRoster_(readRosterSettings_()))`);
  check('adapter: an exclusion row typed on the sheet excludes the account; the Allow list overrides it',
    (t.run(`__addSettingRow('Exclusions', ['Exact email', 'x.person@example.test', 'typed by hand', 'TRUE'])`), ex('x.person@example.test') !== null) &&
    (t.run(`__addSettingRow('Allow list', ['x.person@example.test', 'real person'])`), ex('x.person@example.test') === null));
  t.run(`__addSettingRow('Exclusions', ['Honorific', 'Shri', 'typed by hand', 'TRUE'])`);
  check('adapter: a honorific typed on the sheet is stripped', t.run(`matchNormName('Shri Staff A', matchSettingsFromRoster_(readRosterSettings_()))`) === 'staff a');
  t.run(`__setSettingCell('Categories', 'Support Staff', 3, 'Name only')`);
  check('adapter: the sheet\'s Categories table is used (Support Staff made name-only)',
    t.run(`matchCategoryInfo('Support Staff', matchSettingsFromRoster_(readRosterSettings_())).nameOnly`) === true);
  check('adapter: with no Settings tab the matcher falls back to the seed exclusions, not to "none"',
    t.run(`matchSettingsFromRoster_({ exists: false, exclusions: [], categories: [], hrCategoryMap: [], placeholders: [], hrSource: {} }).exclusions`) === undefined);
}

/* ───────── the builder ───────── */
{
  const t = mk();
  check('the review tab is built by ensureRosterTabs_ / upgradeTabs and registered', t.run('SS.ROSTER_REVIEW') === REV && t.run('__book.order.indexOf(SS.ROSTER_REVIEW)') > -1 &&
    t.run('rosterTabBuilders_().some(function(b){return b[0]===SS.ROSTER_REVIEW})'));
  check('headers are the frozen REVIEW_HEADERS in row 2, hidden when unused, Key/Basis/Prefilled hidden',
    eq([...Array(24).keys()].map(i => t.run(`__cell(SS.ROSTER_REVIEW, 2, ${i + 1})`)), t.run('REVIEW_HEADERS')) && t.run('__book.sheets[SS.ROSTER_REVIEW].hidden') &&
    eq(t.run('__book.sheets[SS.ROSTER_REVIEW].hiddenCols'), [22, 23, 24]));
  check('a second ensureRosterTabs_ makes nothing; re-running the builder changes no cell', eq(t.run('ensureRosterTabs_()'), []));
  t.preview();
  t.run('writeRosterReviewTab_()');
  const s1 = t.snap();
  t.run('writeRosterReviewTab_()');
  check('the builder is non-destructive on a tab in use, and a tab in use is not hidden', t.snap() === s1 && !t.run('__book.sheets[SS.ROSTER_REVIEW].hidden'));
  check('the Decision column has the decision list', eq(t.run('__book.sheets[SS.ROSTER_REVIEW].validations.filter(function(v){return v.c===17})[0].v.list'),
    ['Accept', 'Pick 2', 'Pick 3', 'Enter email', 'Enter code', 'No email', 'Ignore']));
}

/* ───────── Preview: writes only the review tab; classes, prefill (R8, R31, R32) ───────── */
{
  const t = mk();
  const others = ['🪪 Teachers', SET, LOGT, '🧾 Sync Preview', '👥 importHR'];
  const before = t.snap(others);
  t.run('__resetStats()');
  const res = t.preview();
  check('Preview writes ONLY 🪪 Roster Review (every other tab byte-identical)', t.snap(others) === before);
  check('Preview writes the review in one write per column (batch I/O)', t.run('__stats.setValues') <= 24 + 1 && t.run('__stats.setValue') <= 1, J(t.run('__stats')));
  check('Preview opens the review tab', !t.run('__book.sheets[SS.ROSTER_REVIEW].hidden'));

  check('R8 an Email Confirmed-exact row is pre-filled Accept', t.rv('Email|Staff A', 'Class') === 'Confirmed-exact' && t.rv('Email|Staff A', 'Decision') === 'Accept' &&
    t.rv('Email|Staff A', 'Candidate 1 Value') === 'staff.a@example.test');
  check('R8 a Candidate (R2 worked example) is never pre-filled', t.rv('Email|Asha Example', 'Class') === 'Candidate' && t.rv('Email|Asha Example', 'Decision') === '' &&
    t.rv('Email|Asha Example', 'Candidate 1 Name') === 'Asha E Kumar');
  check('R8 an Ambiguous (weak first-name) match is never pre-filled', t.rv('Email|Staff C', 'Class') === 'Ambiguous' && t.rv('Email|Staff C', 'Decision') === '');
  check('R31 Staff Code Confirmed-exact (no warning) is pre-filled Accept, with corroboration shown',
    t.rv('Staff Code|Staff A', 'Decision') === 'Accept' && /Corroborated/.test(t.rv('Staff Code|Staff A', 'Evidence')) && t.rv('Staff Code|Staff A', 'Candidate 1 Value') === 'S0001');
  check('R31 the lower-case HR code is shown normalised', t.rv('Staff Code|Asha Example', 'Candidate 1 Value') === 'S0003' && t.rv('Staff Code|Asha Example', 'Decision') === 'Accept');
  check('R31 a pattern-failing exact match is NOT pre-filled and carries the warning',
    t.rv('Staff Code|Staff M', 'Class') === 'Confirmed-exact' && t.rv('Staff Code|Staff M', 'Decision') === '' && /Pattern warning/.test(t.rv('Staff Code|Staff M', 'Evidence')));
  check('D11 a Resource Person exact match is shown but not pre-filled, and offers no code', t.rv('Staff Code|Consultant R', 'Decision') === '' && t.rv('Staff Code|Consultant R', 'Candidate 1 Value') === '');
  check('D11 a Resource Person has no Email row', (() => { try { t.run(`__reviewRowOf('Email|Consultant R')`); return false; } catch (e) { return true; } })());
  check('HR Category / Department / Team shown on a Staff Code row', t.rv('Staff Code|Staff C', 'HR Department') === 'Office' && t.rv('Staff Code|Staff C', 'HR Team/Role') === 'Front desk' &&
    t.rv('Staff Code|Staff C', 'HR Category') === 'Administrative staff');
  check('R32 Propose add lists Current non-teaching people not on the roster',
    ['Staff E', 'Staff F', 'Consultant G', 'Consultant H'].every(n => t.run(`__reviewRowOf('Propose add|${n}|')`) > 0));
  check('R32 an unmapped category, a Former row and a Teaching HR row are never proposed',
    ['Staff J', 'Staff K', 'Staff L'].every(n => { try { t.run(`__reviewRowOf('Propose add|${n}|')`); return false; } catch (e) { return true; } }) && res.summary.unmapped.indexOf('Mystery') > -1);
  check('R32 a Propose add row is never pre-filled', ['Staff E', 'Staff F', 'Consultant G', 'Consultant H'].every(n => t.rv(`Propose add|${n}|`, 'Decision') === ''));
  check('R35 Propose add shows a blank code for N/A and for a Resource Person even when HR has one',
    t.rv('Propose add|Staff F|', 'Candidate 1 Value') === '' && t.rv('Propose add|Consultant H|', 'Candidate 1 Value') === '' &&
    t.rv('Propose add|Consultant H|', 'HR Email') === '' && t.rv('Propose add|Staff E|', 'Candidate 1 Value') === 'W0006');
  const text = t.run('rosterReviewSummaryText_(previewRosterMatches_().summary)');
  check('the summary follows §5.7 and counts only', /Roster rows: 6/.test(text) && /Propose add from HR Database: 4/.test(text) && /EMAIL /.test(text) && /STAFF CODE /.test(text) &&
    /columns read: 7 of 7/.test(text) && /Nothing has been written to 🪪 Teachers/.test(text) && !/S0001|staff\.a@/.test(text), text);
  check('Preview left 🪪 Teachers exactly as it was (no email, code or row)', t.rows().every(r => !r.email && !r.staffCode && !r.locked) && t.rows().length === 6);
}

/* ───────── R10: re-preview keeps what a human typed ───────── */
{
  const t = mk();
  t.preview();
  t.decide('Email|Asha Example', 'Accept', undefined, undefined, 'checked with HR');
  t.decide('Email|Staff C', 'Enter email', 'c.person@example.test');
  t.decide('Propose add|Staff E|', 'Accept', undefined, 'Staff E Garden');
  t.decide('Staff Code|Staff M', 'Ignore');
  t.decide('Email|Staff A', 'Ignore');                       // a human overrides a pre-fill
  t.preview();
  check('R10 a typed Decision, Manual text, override and Notes survive a re-preview',
    t.rv('Email|Asha Example', 'Decision') === 'Accept' && t.rv('Email|Asha Example', 'Notes') === 'checked with HR' &&
    t.rv('Email|Staff C', 'Decision') === 'Enter email' && t.rv('Email|Staff C', 'Manual Email / Code') === 'c.person@example.test' &&
    t.rv('Propose add|Staff E|', 'Display Name override') === 'Staff E Garden' && t.rv('Staff Code|Staff M', 'Decision') === 'Ignore');
  check('R10 a human choice over a pre-fill is kept (Ignore beats the pre-filled Accept)', t.rv('Email|Staff A', 'Decision') === 'Ignore');
  check('R10 an untouched pre-fill is re-derived, not "kept"', t.rv('Staff Code|Staff A', 'Decision') === 'Accept');
  t.preview();
  check('R10 a second re-preview is stable', t.rv('Email|Asha Example', 'Decision') === 'Accept' && t.rv('Email|Staff C', 'Manual Email / Code') === 'c.person@example.test');

  // a machine pre-fill must not outlive the evidence that justified it
  const u = mk();
  u.preview();
  check('before: Staff Code for Staff A is pre-filled', u.rv('Staff Code|Staff A', 'Decision') === 'Accept');
  u.hrSet(HR.map(h => h.name === 'Staff A' ? Object.assign({}, h, { code: 'BAD1' }) : h));
  u.preview();
  check('R31 a pre-filled Accept is dropped when the data changes to a pattern warning (it was never typed by a human)',
    u.rv('Staff Code|Staff A', 'Decision') === '' && /Pattern warning/.test(u.rv('Staff Code|Staff A', 'Evidence')));
}

/* ───────── re-preview never rebases a candidate decision onto new evidence ───────── */
{
  const t = mk();
  t.preview();
  t.decide('Email|Asha Example', 'Accept', 'keep this text', undefined, 'my note');
  t.decide('Email|Staff C', 'Enter email', 'c.person@example.test');
  t.impSet(IMP.concat([['Asha Example', 'asha.example2@example.test']]));      // an exact-name account appears
  t.preview();
  check('a typed Accept is DROPPED when the candidate list changed, with a visible flag; no pre-fill replaces it',
    t.rv('Email|Asha Example', 'Decision') === '' && /Changed since you decided: re-check/.test(t.rv('Email|Asha Example', 'Evidence')) &&
    t.rv('Email|Asha Example', 'Candidate 1 Value') === 'asha.example2@example.test');
  check('Manual text and Notes survive, and a candidate-independent decision (Enter email) is kept',
    t.rv('Email|Asha Example', 'Notes') === 'my note' && t.rv('Email|Asha Example', 'Manual Email / Code') === 'keep this text' && t.rv('Email|Staff C', 'Decision') === 'Enter email');
  t.apply();
  check('Apply never writes the address the reviewer did not decide on', t.row('Asha Example').email === '' && !t.log().some(l => /asha\.example2/.test(l[3])));
}

/* ───────── an unreadable source never wipes what a human typed against it ───────── */
{
  const t = mk();
  t.preview();
  t.decide('Staff Code|Staff D', 'Enter code', 'S0555', undefined, 'code note');
  t.decide('Propose add|Staff E|', 'Accept', undefined, 'Staff E Garden', 'add note');
  t.run('__hr.failOpen = true');
  t.preview();
  check('HR unreadable: the Staff Code and Propose add rows are retained as typed and marked',
    t.rv('Staff Code|Staff D', 'Decision') === 'Enter code' && t.rv('Staff Code|Staff D', 'Manual Email / Code') === 'S0555' && t.rv('Staff Code|Staff D', 'Notes') === 'code note' &&
    t.rv('Propose add|Staff E|', 'Decision') === 'Accept' && t.rv('Propose add|Staff E|', 'Display Name override') === 'Staff E Garden' &&
    /source unavailable at last preview/.test(t.rv('Staff Code|Staff D', 'Evidence')) && t.rv('Staff Code|(unavailable)', 'Class') === 'Unavailable');
  t.preview();
  check('a repeated unavailable preview does not stack the marker', t.rv('Staff Code|Staff D', 'Evidence').split('source unavailable').length === 2);
  t.run('__hr.failOpen = false');
  t.preview();
  check('HR restored: every typed value is still there and the marker is gone',
    t.rv('Staff Code|Staff D', 'Decision') === 'Enter code' && t.rv('Staff Code|Staff D', 'Manual Email / Code') === 'S0555' && t.rv('Staff Code|Staff D', 'Notes') === 'code note' &&
    t.rv('Propose add|Staff E|', 'Decision') === 'Accept' && t.rv('Propose add|Staff E|', 'Display Name override') === 'Staff E Garden' && t.rv('Propose add|Staff E|', 'Notes') === 'add note' &&
    !/source unavailable/.test(t.rv('Staff Code|Staff D', 'Evidence')) && !/\(unavailable\)/.test(t.tab(REV)));
  t.impSet([]);
  t.run('(function(){ delete __book.sheets[SS.IMPORT_HR]; __book.order = __book.order.filter(function(n){return n!==SS.IMPORT_HR}); })()');
  t.decide('Email|Staff C', 'Enter email', 'c.person@example.test', undefined, 'email note');
  t.preview();
  check('importHR unreadable: the Email rows are retained too', t.rv('Email|Staff C', 'Decision') === 'Enter email' && t.rv('Email|Staff C', 'Notes') === 'email note' && /source unavailable/.test(t.rv('Email|Staff C', 'Evidence')));
}

/* ───────── Apply: accepted rows only, blank-only, locked, logged (R8, R9, R31) ───────── */
{
  const t = mk();
  t.preview();
  t.decide('Email|Asha Example', 'Accept');
  t.decide('Email|Staff C', 'Enter email', 'c.person@example.test');
  t.decide('Email|Staff D', 'No email');
  const staffM = t.row('Staff M');
  t.run('__resetStats()');
  const res = t.apply();
  const A = t.row('Staff A'), asha = t.row('Asha Example'), C = t.row('Staff C'), D = t.row('Staff D');
  check('Apply takes the lock, backs up once, and reports', res.nothing === false && t.run('__backups.n') === 1 && /before roster decisions/.test(t.run('__backups.reasons[0]')) && t.run('__lockHeld') === false);
  check('Email: a pre-filled Accept writes the email lower-case, Confirmed, with audit columns',
    A.email === 'staff.a@example.test' && A.matchStatus === 'Confirmed' && A.confirmedBy === 'ict.facilitator@example.test' && /^\d{4}-\d{2}-\d{2}$/.test(A.confirmedOn));
  check('Email: a typed Accept on a Candidate and an Enter email both write', asha.email === 'asha.example@example.test' && asha.matchStatus === 'Confirmed' && C.email === 'c.person@example.test');
  check('Staff Code: the pre-filled Accept writes the code AND its locked copy; the key is joinable',
    A.staffCode === 'S0001' && A.locked === 'S0001' && asha.staffCode === 'S0003' && asha.locked === 'S0003' &&
    t.run('rosterJoinKeys_("Staff A")').staffCode === 'S0001' && t.run('rosterJoinKeys_("Staff A")').staffEmail === 'staff.a@example.test');
  check('Staff Code on a non-teaching row also fills a BLANK Department and Team from HR', C.staffCode === 'S0004' && C.department === 'Office' && C.team === 'Front desk' && D.staffCode === 'W0005' && D.team === 'Drivers');
  check('Teaching rows keep their Allotment-mirror Department/Team (never written from HR)', A.department === '' && A.team === '');
  check('No email is written only where the category allows it', D.matchStatus === 'No email' && D.email === '');
  check('Rows with no decision, and the pattern-warning row, were NOT written', staffM.staffCode === '' && t.row('Staff M').staffCode === '' && t.row('Staff M').email === '' && t.row('Consultant R').staffCode === '' && t.row('Consultant R').email === '');
  check('Every change is logged to 🪪 Roster Log (Email, Match Status, Staff Code from HR Database)',
    t.log().some(l => l[0] === 'Staff A' && l[1] === 'Email' && l[3] === 'staff.a@example.test' && l[4] === 'Apply') &&
    t.log().some(l => l[0] === 'Staff A' && l[1] === 'Staff Code' && l[3] === 'S0001' && l[4] === 'HR Database') &&
    t.log().some(l => l[0] === 'Staff D' && l[1] === 'Match Status' && l[3] === 'No email'));
  check('Each decided row has a Result; undecided rows have none', /^Written/.test(t.result('Email|Staff A')) && /^Written/.test(t.result('Staff Code|Staff C')) && t.result('Staff Code|Staff M') === '' && t.result('Email|Staff C') !== '');
  check('the roster cache was cleared after the writes', t.run('__cache.removes') > 0 && t.run('getRoster_().rows.length') === 6 && t.run('getRoster_().rows[0].email') === 'staff.a@example.test');
  check('writes are batched per column, never per cell', t.run('__stats.setValue') === 0);

  // idempotence
  const snap = t.snap();
  const logN = t.log().length;
  const res2 = t.apply();
  check('a second Apply changes nothing, takes no backup and logs nothing', res2.nothing === true && t.snap() === snap && t.run('__backups.n') === 1 && t.log().length === logN);
  t.preview();
  const res3 = t.apply();
  check('after a re-preview the spent decisions are gone, so Apply still has nothing to do (no row is reopened)', res3.nothing === true && t.row('Staff A').email === 'staff.a@example.test');
}

/* ───────── R8 / R31: no decision, no write ───────── */
{
  const t = mk();
  t.preview();
  ['Email|Staff A', 'Staff Code|Staff A', 'Staff Code|Asha Example', 'Staff Code|Staff C', 'Staff Code|Staff D'].forEach(k => t.decide(k, ''));
  const before = t.snap(['🪪 Teachers', LOGT]);
  const res = t.apply();
  check('R8/R31 clearing every Decision and applying writes no email, no code, no row, no log, and takes no backup',
    res.nothing === true && t.snap(['🪪 Teachers', LOGT]) === before && t.run('__backups.n') === 0 && t.rows().every(r => !r.email && !r.staffCode && r.matchStatus !== 'Confirmed'));
}

/* ───────── R9: an existing value is never overwritten; email guards ───────── */
{
  const t = mk({ roster: ROSTER.map(r => r['Display Name'] === 'Staff A' ? Object.assign({}, r, { Email: 'other.address@example.test', 'Match Status': 'Needs review' }) : r) });
  t.preview();
  check('R9 a different typed email makes the proposal a Candidate (never pre-filled) with the reason', t.rv('Email|Staff A', 'Class') === 'Candidate' && t.rv('Email|Staff A', 'Decision') === '' && /different email/.test(t.rv('Email|Staff A', 'Evidence')));
  t.decide('Email|Staff A', 'Accept');
  t.decide('Email|Staff A', 'Accept');
  t.apply();
  check('R9 Accept over a different existing email is refused with a reason; the cell is untouched', /^Refused.*different email/.test(t.result('Email|Staff A')) && t.row('Staff A').email === 'other.address@example.test' && t.row('Staff A').matchStatus === 'Needs review');
  const u = mk({ roster: ROSTER.map(r => r['Display Name'] === 'Staff A' ? Object.assign({}, r, { Email: 'staff.a@example.test', 'Match Status': 'Needs review' }) : r) });
  u.preview();
  u.decide('Email|Asha Example', 'Enter email', 'staff.a@example.test');
  u.apply();
  check('R9 an email already on another Active row is refused (Enter email too)', /^Refused.*already on Staff A/.test(u.result('Email|Asha Example')) && u.row('Asha Example').email === '');
}
{
  const t = mk();
  t.preview();
  t.decide('Email|Staff A', 'Enter email', 'not.in.directory@example.test');
  t.decide('Email|Asha Example', 'Enter email', 'front.desk@example.test');
  t.decide('Email|Staff C', 'Enter email', 'N/A');
  t.decide('Email|Staff D', 'Accept');                          // no candidate 1 ... Staff D has weak candidate only
  t.decide('Email|Staff M', 'Pick 3');                          // candidate 3 does not exist
  t.apply();
  check('R9 an address that is not in importHR exactly is refused', /^Refused.*not in 👥 importHR/.test(t.result('Email|Staff A')) && t.row('Staff A').email === '');
  check('R9 an excluded (non-person) account is refused and the Allow list is named', /^Refused.*excluded/.test(t.result('Email|Asha Example')) && /Allow list/.test(t.result('Email|Asha Example')));
  check('R35 a placeholder typed as the email is refused, never written', /^Refused.*placeholder/.test(t.result('Email|Staff C')) && t.row('Staff C').email === '');
  check('a missing candidate is refused', /^Refused.*no candidate 3/.test(t.result('Email|Staff M')));
  const t2 = mk({ roster: ROSTER.map(r => r['Display Name'] === 'Staff C' ? Object.assign({}, r, { Email: 'c.person@example.test', 'Match Status': 'Needs review' }) : r) });
  t2.preview();
  t2.decide('Email|Staff C', 'Enter email', 'c.person@example.test');
  t2.apply();
  check('an existing email that already equals the choice is confirmed without being rewritten', t2.row('Staff C').email === 'c.person@example.test' && t2.row('Staff C').matchStatus === 'Confirmed' &&
    !t2.log().some(l => l[0] === 'Staff C' && l[1] === 'Email'));
  const t3 = mk();
  t3.preview();
  t3.decide('Email|Staff C', 'No email');
  t3.decide('Email|Asha Example', 'Ignore');
  t3.apply();
  check('R9 No email is refused for a category that requires email', /^Refused.*No email is only for/.test(t3.result('Email|Staff C')) && t3.row('Staff C').matchStatus !== 'No email');
  check('Ignore writes Match Status = Ignored and nothing else', t3.row('Asha Example').matchStatus === 'Ignored' && t3.row('Asha Example').email === '');

  // two rows accepted for the same address: both refused, order does not matter
  const t4 = mk();
  t4.preview();
  t4.decide('Email|Asha Example', 'Enter email', 'c.person@example.test');
  t4.decide('Email|Staff C', 'Enter email', 'c.person@example.test');
  t4.apply();
  check('R9 one email accepted for two unrelated rows refuses BOTH', /^Refused.*same email/.test(t4.result('Email|Asha Example')) && /^Refused.*same email/.test(t4.result('Email|Staff C')) && !t4.row('Asha Example').email && !t4.row('Staff C').email);
}

/* ───────── stale rows: data changed since the preview ───────── */
{
  const t = mk();
  t.preview();
  t.decide('Email|Asha Example', 'Accept');
  t.decide('Staff Code|Staff C', 'Accept');                     // pre-filled
  t.hrSet(HR.map(h => h.name === 'Staff C' ? Object.assign({}, h, { code: 'S0555' }) : h));   // the HR code changed
  t.impSet(IMP.filter(r => r[0] !== 'Asha E Kumar'));            // and the account is gone
  t.apply();
  check('a Staff Code row whose HR code changed since the preview is refused as stale; nothing written', /^Stale/.test(t.result('Staff Code|Staff C')) && t.row('Staff C').staffCode === '' && t.row('Staff C').department === '');
  check('an Email row whose account disappeared is refused as stale', /^Stale/.test(t.result('Email|Asha Example')) && t.row('Asha Example').email === '');
  check('rows whose data did not change still apply in the same run', t.row('Staff A').staffCode === 'S0001' && t.row('Staff A').email === 'staff.a@example.test');
  t.preview();
  check('a stale row is not settled: a re-preview offers it again, a typed candidate decision is dropped and flagged, the Result is clear',
    t.rv('Email|Asha Example', 'Class') !== 'Candidate' && t.rv('Email|Asha Example', 'Decision') === '' && /Changed since you decided/.test(t.rv('Email|Asha Example', 'Evidence')) && t.result('Email|Asha Example') === '' && t.rv('Staff Code|Staff C', 'Decision') === 'Accept');
}
{
  const t = mk();
  t.preview();
  t.decide('Email|Staff A', 'Accept');
  t.put('🪪 Teachers', 2, 3, [{ 'Display Name': 'Staff A', Email: 'typed.after@example.test' }]);   // a human typed something after the preview
  t.decide('Staff Code|Staff A', 'Accept');
  t.put('🪪 Teachers', 2, 3, [{ 'Display Name': 'Staff A', 'Staff Code': 'S0777' }]);
  t.apply();
  check('R9 a value typed into the roster after the preview makes the row stale; the typed value is never overwritten',
    /^Stale/.test(t.result('Email|Staff A')) && /^Stale/.test(t.result('Staff Code|Staff A')) && t.row('Staff A').email === 'typed.after@example.test' && t.row('Staff A').staffCode === 'S0777');
}
{
  const t = mk();
  t.preview();
  t.decide('Staff Code|Staff A', 'Accept');
  t.run('__book.sheets[SS.ROSTER_REVIEW].cells[__reviewRowOf("Staff Code|Staff A") + "," + __reviewCol("Candidate 1 Value")] = "S9999"');   // someone edits the displayed candidate
  t.apply();
  check('R31 a code is taken from LIVE HR data, never from the cell on the review tab (a doctored candidate cell changes nothing)', t.row('Staff A').staffCode === 'S0001');
}

/* ───────── Staff Code rules ───────── */
{
  // a code already held by another row is refused; a duplicate HR code is refused; Enter code is a first set
  const t = mk({ roster: ROSTER.concat([{ 'Display Name': 'Staff Z', Category: 'Support Staff', Active: true, 'Staff Code': 'W0005', 'Staff Code (Locked)': 'W0005' }]) });
  t.preview();
  check('a code held by another roster row is never pre-filled', t.rv('Staff Code|Staff D', 'Decision') === '' && /Code already on another roster row|already held/i.test(t.rv('Staff Code|Staff D', 'Evidence') + t.rv('Staff Code|Staff D', 'Class')));
  t.decide('Staff Code|Staff D', 'Accept');
  t.decide('Staff Code|Staff M', 'Accept');                      // pattern warning: allowed on an explicit Accept, logged
  t.decide('Staff Code|Consultant R', 'Enter code', 'W0300');
  t.decide('Staff Code|Staff C', 'Enter code', 'N/A');
  t.apply();
  check('a code held by another row is refused at Apply', /^(Refused|Stale)/.test(t.result('Staff Code|Staff D')) && t.row('Staff D').staffCode === '');
  check('a pattern mismatch is allowed only on an explicit Accept and is logged as a warning',
    t.row('Staff M').staffCode === 'X123' && t.row('Staff M').locked === 'X123' && t.log().some(l => l[0] === 'Staff M' && l[1] === 'Staff Code' && l[3] === 'X123' && /pattern warning/.test(l[5])));
  check('R36 Enter code on a name-match-only row is refused; nothing written', /^Refused.*never has a Staff Code/.test(t.result('Staff Code|Consultant R')) && t.row('Consultant R').staffCode === '' && t.row('Consultant R').locked === '');
  check('R35 a placeholder typed as a code is refused', /^Refused.*placeholder/.test(t.result('Staff Code|Staff C')) && t.row('Staff C').staffCode === '');
}
{
  const t = mk({ hr: HR.concat([{ name: 'Staff Y', cat: 'Support staff', code: 'W0005' }]) });
  t.preview();
  check('two Current HR rows sharing a code demote the link (Ambiguous, not pre-filled)', t.rv('Staff Code|Staff D', 'Class') === 'Ambiguous' && t.rv('Staff Code|Staff D', 'Decision') === '');
  t.decide('Staff Code|Staff D', 'Accept');
  t.apply();
  check('a code shared by two HR rows is refused at Apply', /^Refused.*shared by several/.test(t.result('Staff Code|Staff D')) && t.row('Staff D').staffCode === '');
}
{
  // an existing code is never overwritten, even though the row is on the tab
  const t = mk({ roster: ROSTER.map(r => r['Display Name'] === 'Consultant R' ? Object.assign({}, r, { 'Staff Code': 'S0777' }) : r) });
  t.preview();
  t.decide('Staff Code|Consultant R', 'Accept');
  t.apply();
  check('R36 a name-match-only row never receives a code via Accept (a typed one stays, reported by Check roster, never used)',
    t.row('Consultant R').staffCode === 'S0777' && t.row('Consultant R').locked === '' && t.run('rosterJoinKeys_("Consultant R")').staffCode === '');
}
{
  // Teaching row whose HR record is a non-teaching category: conflict, nothing changes
  const t = mk({ hr: HR.map(h => h.name === 'Staff A' ? Object.assign({}, h, { cat: 'Support staff' }) : h) });
  t.preview();
  check('a Category conflict on a Teaching row is shown and not pre-filled', t.rv('Staff Code|Staff A', 'Decision') === '' && /Category conflict/.test(t.rv('Staff Code|Staff A', 'Evidence')));
  t.decide('Staff Code|Staff A', 'Accept');
  t.apply();
  check('a Category conflict on a Teaching row is refused at Apply: nothing changes', /^Refused.*conflicts/.test(t.result('Staff Code|Staff A')) && t.row('Staff A').staffCode === '');
}
{
  // HR placeholder code: linked for Category/Department/Team only; no code written
  const t = mk({ hr: HR.map(h => h.name === 'Staff C' ? Object.assign({}, h, { code: 'N/A' }) : h) });
  t.preview();
  check('R35 a placeholder code shows "No code in HR Database", never a pattern warning', /No code in HR Database/.test(t.rv('Staff Code|Staff C', 'Evidence')) && !/Pattern/.test(t.rv('Staff Code|Staff C', 'Evidence')) && t.rv('Staff Code|Staff C', 'Candidate 1 Value') === '');
  t.decide('Staff Code|Staff C', 'Accept');
  t.apply();
  check('R35 accepting it writes no code (the row stays code-less) but fills the blank Department/Team',
    t.row('Staff C').staffCode === '' && t.row('Staff C').locked === '' && t.row('Staff C').department === 'Office' && /^Written/.test(t.result('Staff Code|Staff C')));
}

/* ───────── Propose add (R32, R36, D11) ───────── */
{
  const t = mk();
  t.preview();
  t.decide('Propose add|Staff E|', 'Accept');
  t.decide('Propose add|Staff F|', 'Accept');
  t.decide('Propose add|Consultant G|', 'Accept');
  t.decide('Propose add|Consultant H|', 'Accept', undefined, 'Consultant H Arts');
  t.apply();
  const rows = t.rows();
  const E = rows.find(r => r.name === 'Staff E'), F = rows.find(r => r.name === 'Staff F'), G = rows.find(r => r.name === 'Consultant G'), H = rows.find(r => r.name === 'Consultant H Arts');
  check('Propose add appends a row with the HR Category mapped, Active, Unreviewed, Department/Team', rows.length === 10 && E.category === 'Support Staff' && E.active === true &&
    E.matchStatus === 'Unreviewed' && E.department === 'Garden' && E.team === 'Grounds');
  check('Propose add writes the Staff Code and its locked copy for a code-required person', E.staffCode === 'W0006' && E.locked === 'W0006' && E.email === '');
  check('R35 an HR placeholder code is added as a BLANK code, never N/A', F.staffCode === '' && F.locked === '' && F.category === 'Admin' && F.email === '');
  check('D11/R36 Resource Persons are added name-only: no code, no email, even though HR has them for one', G.staffCode === '' && G.email === '' && H.staffCode === '' && H.locked === '' && H.email === '' && H.category === 'Resource Person');
  check('the reviewer\'s Display Name override is the name added', !!H && !rows.some(r => r.name === 'Consultant H'));
  check('Propose add is logged (Row, and Staff Code for Staff E)', t.log().some(l => l[0] === 'Staff E' && l[1] === 'Row' && /Added \(Support Staff\)/.test(l[3])) && t.log().some(l => l[0] === 'Staff E' && l[1] === 'Staff Code' && l[3] === 'W0006'));
  check('Check roster reports nothing missing for an added Resource Person', (() => {
    const chk = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:null,directory:null,loggedAdds:null})');
    return !chk.findings.some(f => f.name === 'Consultant G' || f.name === 'Consultant H Arts');
  })());
  const again = t.apply();
  check('applying again adds nothing (idempotent, no duplicate rows)', again.nothing === true && t.rows().length === 10);
  t.preview();
  check('after the add, those people are no longer proposed', !t.run(`(function(){ try { __reviewRowOf('Propose add|Staff E|'); return true; } catch (e) { return false; } })()`));
}
{
  // Display Name uniqueness: an existing name, a spacing/case variant of one, and a placeholder
  const t = mk();
  t.preview();
  t.decide('Propose add|Staff E|', 'Accept', undefined, 'staff  d');
  t.decide('Propose add|Staff F|', 'Accept', undefined, 'Staff A');
  t.decide('Propose add|Consultant G|', 'Accept', undefined, 'Consultant G Visiting');
  t.apply();
  check('Display Name uniqueness is enforced: an existing name (also case/spacing-insensitively) is refused',
    /^Refused.*already on the roster/.test(t.result('Propose add|Staff E|')) && /^Refused.*already on the roster/.test(t.result('Propose add|Staff F|')));
  check('a distinguishing override is added; nothing from a refused proposal reached the roster', t.rows().length === 7 && !!t.row('Consultant G Visiting') && !t.rows().some(r => r.name === 'staff  d'));
}
{
  const t = mk();
  t.preview();
  t.decide('Propose add|Staff E|', 'Accept', undefined, 'New Person');
  t.decide('Propose add|Staff F|', 'Accept', undefined, 'new person');
  t.apply();
  check('two proposals that would get one name are BOTH refused (order does not decide)', /^Refused.*same Display Name/.test(t.result('Propose add|Staff E|')) && /^Refused.*same Display Name/.test(t.result('Propose add|Staff F|')) && t.rows().length === 6);
}
{
  // two HR people with one real name: flagged at preview, refused if both accepted unchanged
  const t = mk({ hr: HR.concat([{ name: 'Consultant G', cat: 'Resource Person', code: 'N/A' }]) });
  t.preview();
  check('two proposals with one name are flagged at preview', /Name shared with another proposed row/.test(t.rv('Propose add|Consultant G|', 'Evidence')));
  t.run(`(function(){ var sh = sheet_(SS.ROSTER_REVIEW), kc = __reviewCol('Key'); for (var r = 3; r <= sh.getLastRow(); r++) if (String(sh.cells[r + ',' + kc]).indexOf('Propose add|Consultant G|') === 0) sh.cells[r + ',' + __reviewCol('Decision')] = 'Accept'; })()`);
  t.apply();
  check('two proposals with the same name, both accepted, are BOTH refused (the reviewer must disambiguate)', /^Refused.*same Display Name/.test(t.run(`(function(){ var sh = sheet_(SS.ROSTER_REVIEW), kc = __reviewCol('Key'), out = []; for (var r = 3; r <= sh.getLastRow(); r++) if (String(sh.cells[r + ',' + kc]).indexOf('Propose add|Consultant G|') === 0) out.push(sh.cells[r + ',' + __reviewCol('Result')] || ''); return out[0]; })()`)) && t.rows().length === 6);
}
{
  // a proposal that mirrors a blank / placeholder override, and Ignore
  const t = mk();
  t.preview();
  t.decide('Propose add|Staff E|', 'Accept', undefined, 'N/A');
  t.decide('Propose add|Staff F|', 'Ignore');
  t.decide('Propose add|Consultant G|', 'Pick 2');
  t.apply();
  check('R35 a placeholder as the Display Name override is refused', /^Refused.*placeholder/.test(t.result('Propose add|Staff E|')));
  check('Propose add takes Accept or Ignore only; Ignore adds nothing', /^Refused.*Accept or Ignore only/.test(t.result('Propose add|Consultant G|')) && /^Recorded/.test(t.result('Propose add|Staff F|')) && t.rows().length === 6);
}

/* ───────── R35 / R28 end to end over the review and apply outputs ───────── */
{
  const t = mk({ hr: HR.concat([
    { name: 'Staff R1', cat: 'Support staff', code: 'N/A', email: 'N/A' }, { name: 'Staff R2', cat: 'Support staff', code: 'n/a', email: 'n/a' },
    { name: 'Staff R3', cat: 'Support staff', code: '-', email: '-' }, { name: 'Staff R4', cat: 'Support staff', code: 'TBD', email: 'TBD' },
    { name: 'Consultant R5', cat: 'Resource Person', code: 'N/A', email: 'N/A' }, { name: 'Consultant R6', cat: 'Resource Person', code: 'N/A', email: 'N/A' }]) });
  t.run('__hr.logs = []');
  const sum = t.preview().summary;
  check('R35 several N/A rows give zero duplicate-code reports and zero pattern errors', t.run('readHrDatabase_().diagnostics.duplicateCodes') === 0 && t.run('readHrDatabase_().diagnostics.patternFailures') === 1 &&
    sum.patternWarnings === 1);   // only the genuine X123
  // accept everything the tool proposes (and every Propose add)
  t.run(`(function(){ var sh = sheet_(SS.ROSTER_REVIEW), kc = __reviewCol('Key'), dc = __reviewCol('Decision');
    for (var r = 3; r <= sh.getLastRow(); r++) { var k = String(sh.cells[r + ',' + kc] || ''); if (k.indexOf('Propose add|') === 0) sh.cells[r + ',' + dc] = 'Accept'; } })()`);
  t.apply();
  const rows = t.rows();
  const cells = JSON.parse(t.run(`JSON.stringify(Object.keys(__book.sheets).map(function(n){ return Object.keys(__book.sheets[n].cells).map(function(k){ return [n, String(__book.sheets[n].cells[k])]; }); }))`)).flat();
  const bad = cells.filter(([n, v]) => [TEACH, REV, LOGT].includes(n) && /^(n\/a|na|-|none|nil|tbd)$/i.test(v.trim()));
  check('R35 no placeholder value reached 🪪 Teachers, 🪪 Roster Review or 🪪 Roster Log', bad.length === 0, J(bad));
  check('R35 Propose add rows were created with a blank code and email for every placeholder row', ['Staff R1', 'Staff R2', 'Staff R3', 'Staff R4', 'Consultant R5', 'Consultant R6', 'Staff F', 'Consultant G'].every(n => {
    const r = rows.find(x => x.name === n); return r && r.staffCode === '' && r.locked === '' && r.email === '';
  }));
  check('R35 a placeholder email/code is never an R2 or corroboration hit', !/Corroborated|Conflict/.test(t.rv('Staff Code|Staff C', 'Evidence')) && !/Corroborated|Conflict/.test(t.rv('Staff Code|Consultant R', 'Evidence')));
  const chk = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:null,directory:null,loggedAdds:null})');
  check('R35/R36 Check roster reports no duplicate code and nothing about any Resource Person', !chk.findings.some(f => f.kind === 'code-duplicate') &&
    !chk.findings.some(f => /Consultant/.test(f.name)), J(chk.findings.filter(f => /Consultant|duplicate/.test(f.name + f.kind)).map(f => f.text)));
  check('R36 the pre-existing Resource Person ends review and apply with a blank code and email', t.row('Consultant R').staffCode === '' && t.row('Consultant R').email === '');

  // R28: no sentinel anywhere a review/apply output could land
  const alerts = J(t.alerts()), logs = J(t.run('__hr.logs')), ops = J(t.run('__ops')), cache = J(t.run('__cache.store'));
  const all = J(cells) + alerts + logs + ops + cache;
  const leaked = SENT.filter(s => all.indexOf(s) > -1);
  check('R28 no non-whitelisted HR value (sentinel) in any tab, alert, log line, Ops payload or cache entry after preview + apply', leaked.length === 0, J(leaked));
  const noSettings = J(cells.filter(([n]) => n !== SET)) + alerts + logs + ops + cache;
  check('R28 the workbook ID (typed only on 🧭 Roster Settings) appears in no other tab, alert, log line, Ops payload or cache entry', noSettings.indexOf(ID) < 0);
  const spans = t.run('__hr.spans');
  check('R27/R28 the HR sheet was only ever read: the header row and single whitelisted columns', spans.every(s => s.row === 1 ? s.nr === 1 : s.nc === 1));
}

/* ───────── R29: HR Database unavailable degrades (email matching still works) ───────── */
{
  const t = mk({ noId: true });
  const res = t.preview();
  check('R29 with no HR Database set, Preview still matches emails and says the Staff Code source was unavailable',
    t.rv('Email|Staff A', 'Decision') === 'Accept' && /unavailable/.test(rosterReview(t)) && res.summary.hr.ok === false && /No HR Database is set/.test(res.summary.hr.error));
  function rosterReview(t) { return t.run('rosterReviewSummaryText_(previewRosterMatches_().summary)'); }
  check('R29 exactly one information row stands in for Staff Code and Propose add; no Staff Code row, no Propose add row',
    t.rv('Staff Code|(unavailable)', 'Class') === 'Unavailable' && /No HR Database is set/.test(t.rv('Staff Code|(unavailable)', 'Evidence')) &&
    t.rv('Staff Code|(unavailable)', 'Decision') === '' && !t.run(`(function(){ try { __reviewRowOf('Propose add|'); return true; } catch (e) { return false; } })()`));
  t.decide('Staff Code|(unavailable)', 'Accept');
  t.apply();
  check('R29 an Email Accept still applies; a decision on the information row is refused', t.row('Staff A').email === 'staff.a@example.test' && /^Refused.*information only/.test(t.result('Staff Code|(unavailable)')));
  check('R29 nothing about the workbook ID or any cell value is in the message', !/ID-PLACEHOLDER/.test(J(t.alerts()) + t.rv('Staff Code|(unavailable)', 'Evidence')));
}
{
  // HR fails between the preview and the Apply: Staff Code rows are refused with the reason, Email rows apply
  const t = mk();
  t.preview();
  t.decide('Staff Code|Staff C', 'Accept');
  t.run('__hr.failOpen = true');
  t.apply();
  check('an HR failure at Apply refuses the Staff Code and Propose add rows (reason shown) and writes nothing for them',
    /^Refused.*HR Database could not be read/.test(t.result('Staff Code|Staff C')) && t.row('Staff C').staffCode === '' && t.row('Staff A').email === 'staff.a@example.test');
  const u = mk({ imp: [] });
  u.run('(function(){ delete __book.sheets[SS.IMPORT_HR]; __book.order = __book.order.filter(function(n){return n!==SS.IMPORT_HR}); })()');
  const r = u.preview();
  check('importHR missing: Staff Code matching still works and the summary says email matching was unavailable', u.rv('Staff Code|Staff A', 'Decision') === 'Accept' && /unavailable/.test(u.run('rosterReviewSummaryText_(previewRosterMatches_().summary)')) && r.summary.importHr.ok === false);
}

/* ───────── backup, lock, failure discipline ───────── */
{
  const t = mk();
  t.preview();
  t.run('__backups.fail = true');
  let err = '';
  try { t.apply(); } catch (e) { err = e.message; }
  check('a failed backup stops the Apply by default; nothing is written', /Nothing was applied: the backup could not be saved/.test(err) && t.rows().every(r => !r.email) && t.log().length === 0 && t.result('Email|Staff A') === '');
  const res = t.apply(true);
  check('the caller may choose to continue without a backup', res.nothing === false && /none/.test(res.backup) && t.row('Staff A').email === 'staff.a@example.test');
}
{
  const t = mk();
  t.preview();
  t.run('__lockHeld = true');
  let err = '';
  try { t.apply(); } catch (e) { err = e.message; }
  check('Apply needs the script lock (another change in progress is refused)', /Another roster change is running/.test(err) && t.rows().every(r => !r.email) && t.run('__backups.n') === 0);
}
{
  // failure midway writes nothing: a header every write needs is missing, the log is unusable, the log throws
  const header = (t, h) => t.run(`(function(){ var sh = sheet_(SS.ROSTER); for (var c = 1; c <= sh.maxCols; c++) if (sh.cells['2,' + c] === ${J(h)}) delete sh.cells['2,' + c]; })()`);
  const arm = () => { const t = mk(); t.preview(); t.decide('Email|Asha Example', 'Accept'); t.decide('Propose add|Staff E|', 'Accept'); return t; };
  const attempt = (t) => { let e = ''; try { t.apply(); } catch (x) { e = x.message; } return e; };
  const stable = t => [t.tab(TEACH), t.tab(LOGT), t.tab(REV)].join('|');

  let t = arm(); header(t, 'Confirmed By');
  let before = stable(t), e = attempt(t);
  check('failure discipline: a missing roster header stops the Apply before the first write (roster, log and review untouched)', /Nothing was applied/.test(e) && /Confirmed By/.test(e) && stable(t) === before);

  t = arm(); t.run('(function(){ var sh = sheet_(SS.ROSTER_LOG); for (var c = 1; c <= 8; c++) if (sh.cells["2," + c] === "Reason") delete sh.cells["2," + c]; })()');
  before = stable(t); e = attempt(t);
  check('failure discipline: an unusable 🪪 Roster Log stops the Apply before the first write', /Nothing was/.test(e) && stable(t) === before);

  t = arm(); t.run('(function(){ var sh = sheet_(SS.ROSTER_REVIEW); for (var c = 1; c <= 24; c++) if (sh.cells["2," + c] === "Result") delete sh.cells["2," + c]; })()');
  before = stable(t); e = attempt(t);
  check('failure discipline: a review tab without its Result header is refused outright, nothing written', /missing header/.test(e) && stable(t) === before);

  t = arm(); t.run('appendRosterLog_ = function () { throw new Error("log failed"); }');
  before = stable(t); e = attempt(t);
  check('failure discipline: the audit trail is written first, so a log failure leaves no roster change and no Result', /log failed/.test(e) && stable(t) === before && t.run('__lockHeld') === false);

  t = arm(); t.run('delete __book.sheets[SS.ROSTER_LOG]; __book.order = __book.order.filter(function(n){return n!==SS.ROSTER_LOG})');
  before = [t.tab(TEACH), t.tab(REV)].join('|'); e = attempt(t);
  check('failure discipline: a missing 🪪 Roster Log tab stops the Apply, the lock is released', /Run 🔧 Upgrade tabs/.test(e) && [t.tab(TEACH), t.tab(REV)].join('|') === before && t.run('__lockHeld') === false);
}

/* ───────── the menu ───────── */
{
  const t = mk();
  t.preview();
  const all = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const ctx = load(all, MOCK);
  ctx.run('onOpen()');
  const items = ctx.run('__ui.items');
  const fns = ['previewRosterMatches', 'applyRosterDecisions', 'openRosterReview'];
  check('the three review handlers are on the 🪪 Roster menu and are defined functions', fns.every(f => items.some(i => i.fn === f) && ctx.run(`typeof ${f}`) === 'function'));
  check('every menu handler on the whole menu is defined', items.every(i => ctx.run(`typeof ${i.fn}`) === 'function'));

  const u = mk();
  u.run('previewRosterMatches()');
  check('the Preview handler shows the counts summary and changes only the review tab', u.alerts().some(a => /Match preview/.test(a.title) && /Roster rows: 6/.test(a.body)) && u.row('Staff A').email === '');
  u.run('__ui.alerts = []; __ui.answer = "NO"; applyRosterDecisions()');
  check('declining the confirmation changes nothing and takes no backup', u.row('Staff A').email === '' && u.run('__backups.n') === 0);
  u.run('__ui.alerts = []; __ui.answer = "YES"; applyRosterDecisions()');
  const titles = u.alerts().map(a => a.title);
  check('Apply handler confirms, applies and summarises (counts only)', u.row('Staff A').email === 'staff.a@example.test' && titles.indexOf('✅ Decisions applied') > -1 &&
    /Emails confirmed: 1/.test(u.alerts().pop().body) && u.run('__backups.n') === 1);
  u.run('__ui.alerts = []; applyRosterDecisions()');
  check('running Apply again from the menu has nothing to apply', u.alerts().some(a => /Nothing to apply/.test(a.title)));

  const v = mk({ roster: [] });
  v.run('delete __book.sheets[SS.ROSTER_REVIEW]; __book.order = __book.order.filter(function(n){return n!==SS.ROSTER_REVIEW})');
  v.run('previewRosterMatches()');
  check('N5 a failing handler alerts plainly and pings Ops with the error class only', v.alerts().some(a => /Upgrade tabs/.test(a.body)) && v.run('__ops').length === 1 && v.run('__ops[0][1]') === 'Error');
}


/* ───────── T-021: unmapped-category information rows, and the Non-Teaching dropdown refresh ───────── */
{
  const UK = 'Propose add|(unmapped category)|';
  const hr2 = HR.concat([{ name: 'Staff Q', cat: 'Mystery', code: 'S0301' }, { name: 'Staff R', cat: 'Interns', code: 'S0302' }]);
  const t = mk({ hr: hr2 });
  t.preview();
  check('T-021 one info row per distinct unmapped category value, with the count',
    /^2 current HR people have the category "Mystery"/.test(t.rv(UK + 'Mystery', 'Evidence')) &&
    /^1 current HR person has the category "Interns"/.test(t.rv(UK + 'Interns', 'Evidence')) &&
    t.rv(UK + 'Mystery', 'Display Name') === '(unmapped HR category)' && t.rv(UK + 'Mystery', 'Decision') === '');
  const tab = t.tab(REV);
  check('T-021 the info rows carry the category value and NO person data',
    !/Staff J|Staff Q|Staff R|S0100|S0301|S0302/.test(t.rv(UK + 'Mystery', 'Evidence') + t.rv(UK + 'Interns', 'Evidence')) &&
    !/S0301|S0302/.test(tab) && SENT.every(x => tab.indexOf(x) < 0));
  t.preview(); t.preview();
  const n = k => (t.tab(REV).match(new RegExp(k.replace(/[|()]/g, '\\$&') + '"', 'g')) || []).length;
  check('T-021 re-preview does not stack the info rows', n(UK + 'Mystery') === 1 && n(UK + 'Interns') === 1);
  t.run('__hr.failOpen = true');
  t.preview();
  check('T-021 when the HR Database is unreadable the stale info rows are dropped, not retained',
    !/\(unmapped category\)/.test(t.tab(REV)) && t.rv('Staff Code|(unavailable)', 'Class') === 'Unavailable');
  t.run('__hr.failOpen = false');
  t.preview();
  t.decide(UK + 'Mystery', 'Accept');
  t.apply();
  check('T-021 an info row cannot be applied', /^Refused.*information only/.test(t.result(UK + 'Mystery')));
  t.run(`__addSettingRow('HR Category mapping', ['Mystery', 'Support Staff'])`);
  t.preview();
  check('T-021 a mapped category removes its info row (and proposes the person); the other stays',
    (() => { try { t.run(`__reviewRowOf(${J(UK + 'Mystery')})`); return false; } catch (e) { return true; } })() &&
    t.run(`__reviewRowOf('Propose add|Staff Q|')`) > 0 && /"Interns"/.test(t.rv(UK + 'Interns', 'Evidence')));
}
{
  const NTV = `(function(){ var sh = __book.sheets[SS.NON_TEACHING], tc = 0; for (var c = 1; c <= sh.maxCols; c++) if (sh.cells['2,' + c] === 'Teacher') tc = c; var x = sh.validations.filter(function(e){ return e.c === tc && e.v && e.v.list; }); return x.length ? x[0].v.list : []; })()`;
  const HOOK = `var __rf = 0, __rfOrig = refreshNonTeachingTeacherList_; refreshNonTeachingTeacherList_ = function () { __rf++; return __rfOrig(); };`;
  const t = mk();
  t.run('ensureNonTeachingTab_()'); t.run('refreshNonTeachingTeacherList_()');
  t.preview();
  check('T-021 before Apply the new person is not in the Teacher dropdown', t.run(NTV).indexOf('Staff E') < 0);
  t.run(HOOK);
  t.decide('Propose add|Staff E|', 'Accept');
  t.apply();
  check('T-021 Apply of a Propose add refreshes the dropdown once and it now lists the new person',
    t.run('__rf') === 1 && t.run(NTV).indexOf('Staff E') > -1, J(t.run(NTV)));
  const u = mk();
  u.run('ensureNonTeachingTab_()'); u.preview();
  u.run(`(function(){ var sh = sheet_(SS.ROSTER_REVIEW), c = __reviewCol('Decision'); for (var r = 3; r <= sh.getLastRow(); r++) delete sh.cells[r + ',' + c]; })()`);   // drop the pre-filled Accepts
  u.run(HOOK);
  u.decide('Propose add|Staff E|', 'Ignore');
  u.decide('Email|Staff C', 'Enter email', 'not.in.directory@example.test');   // refused
  const ures = u.apply();
  check('T-021 no refresh when nothing was written (Ignore + refused rows)', u.run('__rf') === 0, J(ures.counts) + J(ures.results));
  const w = mk();
  w.run('ensureNonTeachingTab_()'); w.preview();
  w.run(`refreshNonTeachingTeacherList_ = function () { throw new Error('boom'); };`);
  w.decide('Propose add|Staff E|', 'Accept');
  let failed = false, res = null;
  try { res = w.apply(); } catch (e) { failed = true; }
  check('T-021 a refresh failure does not fail the apply (row added, logged)',
    !failed && !!w.row('Staff E') && /^Added/.test(w.result('Propose add|Staff E|')) && res && res.counts.added === 1 &&
    w.run('__hr.logs').some(l => /non-teaching list: boom/.test(l)));
}

/* ───────── R34 / R36 / hygiene (grep-style) ───────── */
{
  const src = fs.readFileSync(path.join(ROOT, 'RosterReview.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('R34 only previewRosterMatches_ and applyRosterDecisions_ read the HR Database, and only the menu handlers call them', (() => {
    const all = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).join('\n');
    const callers = fn => (all.match(new RegExp('[\\w]+(?=[^\\n]*' + fn + '\\s*\\()', 'g')) || []);
    const onEdit = /function onEditInstallable[\s\S]*?\n}/.exec(all);
    return (code.match(/readHrDatabase_\(/g) || []).length === 2 && !/previewRosterMatches_|applyRosterDecisions_|readHrDatabase_/.test(onEdit ? onEdit[0] : '') &&
      (all.match(/previewRosterMatches_\(/g) || []).length === 2 && (all.match(/applyRosterDecisions_\(/g) || []).length === 2;
  })());
  check('R36 nothing in the review code invents a code', !/nextCode|generateCode|newStaffCode|codeSequence|Math\.random|Date\.now/.test(code));
  check('no per-cell Sheets calls (getValue/setValue) in the review code', !/\.(getValue|setValue)\(/.test(code));
  check('no HR Database workbook ID, URL or real-looking address in the review code or its test', (() => {
    const text = src + fs.readFileSync(__filename, 'utf8');
    const addrs = (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).filter(a => !/@example\.test$/i.test(a));
    return addrs.length === 0 && !/spreadsheets\/d\/|openById/.test(src);
  })());
  check('the review code never reads a non-whitelisted HR field', !/Mobile|Father|Mother|Personal ID|Address Line/i.test(code));
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const decl = {};
  files.forEach(f => {
    (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm) || []).forEach(m => {
      const n = m.replace(/^(function|const|let|var)\s+/, ''); (decl[n] = decl[n] || []).push(f);
    });
  });
  const dups = Object.keys(decl).filter(n => decl[n].length > 1);
  check('no duplicate top-level names across the root files (RosterReview.js added)', dups.length === 0 && files.includes('RosterReview.js'), J(dups));
}
