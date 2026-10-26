/**
 * T-018: 🗓️ Non-Teaching Absence tab. Spec: docs/PRD-roster.md D5, D6, D11, §6.8, R23-R25.
 * Placeholder data only: the repo is public.
 */
const fs = require('fs');
const path = require('path');
const { load, DEFAULT_FILES, ROOT } = require('./harness');
const { MOCK } = require('./sheetmock');

const FILES = DEFAULT_FILES.concat(['Reports.js', 'ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'AnalyticsTab.js',
  'HR.js', 'Setup.js', 'MarkAbsenceTab.js', 'Code.js', 'RosterTabs.js', 'Roster.js']);
const J = JSON.stringify;
const eq = (a, b) => J(a) === J(b);
const NT = '🗓️ Non-Teaching Absence', T = '🪪 Teachers';
const HEAD = ['Date', 'Teacher', 'Absence Type', 'Periods Away', 'Marked By', 'Staff Email', 'Staff Code', 'Category', 'Timestamp', 'Notes'];
const C = h => HEAD.indexOf(h) + 1;

const OVER = `
  function getAllTeachers() { return ['Staff A']; }
  function getTeacherMeta() { return {}; }
  function getConfig() { return defaultConfig_(); }
  function notifyOpsFailure_() {}
  var __toasts = []; function toast_(m) { __toasts.push(m); }
`;

function fixture(opts) {
  opts = opts || {};
  const ctx = load(FILES, MOCK + OVER);
  const run = ctx.run;
  const t = { ctx, run };
  t.put = (tab, hr, sr, rows) => run(`__put(${J(tab)}, ${hr}, ${sr}, ${J(rows)})`);
  t.cell = (r, c) => run(`__cell(${J(NT)}, ${r}, ${c})`);
  t.row = r => HEAD.map((h, i) => t.cell(r, i + 1));
  run('ensureRosterTabs_()');
  t.put(T, 2, 3, [
    { 'Display Name': 'Staff A', Category: 'Teaching', Active: true, 'Staff Code': 'S0001' },
    { 'Display Name': 'Admin P', Category: 'Admin', Active: true, 'Staff Code': 'S0101', Email: 'admin.p@example.test', 'Match Status': 'Confirmed' },
    { 'Display Name': 'Admin Unconfirmed', Category: 'Admin', Active: true, 'Staff Code': 'S0103', Email: 'admin.u@example.test', 'Match Status': 'Needs review' },
    { 'Display Name': 'Support Q', Category: 'Support Staff', Active: true, 'Staff Code': 'W0201' },
    { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
    { 'Display Name': 'Left Admin', Category: 'Admin', Active: false, 'Staff Code': 'S0102' },
  ]);
  run('lockNewStaffCodes_(); clearRosterCache_()');
  if (!opts.nobuild) run('ensureNonTeachingTab_()');
  /** Simulate the Teacher cell being edited on a data row. */
  t.edit = (r, teacher, o) => {
    o = o || {};
    t.put(NT, 2, r, [{ Teacher: teacher }]);
    return run(`nonTeachingOnEdit_({ range: sheet_(SS.NON_TEACHING).getRange(${r}, ${C('Teacher')}),
      ${o.noUser ? '' : `user: { getEmail: function () { return ${J(o.user || 'editor.one@example.test')}; } },`}
      ${o.old ? `oldValue: ${J(o.old)},` : ''} value: ${J(teacher)} })`);
  };
  return t;
}
const sheetRun = (t, e) => t.run(`__book.sheets[${J(NT)}]${e}`);

/* ───────── builder ───────── */
{
  const t = fixture();
  check('builder: title in row 1, the ten frozen headers in row 2', t.cell(1, 1) !== '' && eq(HEAD.map((h, i) => t.cell(2, i + 1)), HEAD) &&
    eq(HEAD, t.run('NON_TEACHING_HEADERS')));
  check('builder: header frozen (2 rows) and data starts at row 3', sheetRun(t, '.frozenRows') === 2 && t.run('NON_TEACHING_DATA_START') === 3);
  check('builder: header notes explain the amber and grey key cells', /Amber/.test(sheetRun(t, '.notes["2,' + C('Staff Code') + '"]')) &&
    /Grey/.test(sheetRun(t, '.notes["2,' + C('Staff Email') + '"]')));

  // sentinel data and a human-reordered tab survive a re-run
  t.put(NT, 2, 3, [{ Date: '2026-01-05', Teacher: 'Admin P', Notes: 'SENTINEL' }, { Date: '2026-01-06', Teacher: 'Support Q', Notes: 'SENTINEL-2' }]);
  const cells = sheetRun(t, '.cells');
  const before = J(cells);
  t.run('writeNonTeachingTab_()');
  t.run('writeNonTeachingTab_()');
  check('builder is idempotent and non-destructive: sentinel rows survive, nothing cleared',
    J(sheetRun(t, '.cells')) === before && sheetRun(t, '.cleared') === 0 && t.cell(3, C('Notes')) === 'SENTINEL');
  check('builder keeps one dropdown per column, not stacked', sheetRun(t, '.validations').length === 3);
}
{ // header names are located by name: a reordered tab is respected, a missing header is appended
  const t = fixture({ nobuild: true });
  t.run('__ss.insertSheet(SS.NON_TEACHING)');
  const hdr = ['Teacher', 'Date', 'Notes'];
  hdr.forEach((h, i) => t.run(`__book.sheets[SS.NON_TEACHING].cells["2,${i + 1}"] = ${J(h)}`));
  t.run('__book.sheets[SS.NON_TEACHING].cells["3,1"] = "Admin P"');
  t.run('writeNonTeachingTab_()');
  const row2 = [...Array(12).keys()].map(i => t.cell(2, i + 1));
  check('builder finds headers by name: existing order kept, missing ones appended after', eq(row2.slice(0, 3), hdr) &&
    HEAD.every(h => row2.includes(h)) && t.cell(3, 1) === 'Admin P');
  const dv = sheetRun(t, '.validations').find(v => v.v.list && v.v.list.includes('Admin P'));
  check('Teacher validation lands on the Teacher column wherever it is', dv && dv.c === 1);
}

/* ───────── dropdowns ───────── */
{
  const t = fixture();
  const dvAt = c => sheetRun(t, '.validations').find(v => v.c === c).v;
  const teacher = dvAt(C('Teacher'));
  check('Teacher list: Active Admin, Support Staff and Resource Person only (sorted)',
    eq(teacher.list, ['Admin P', 'Admin Unconfirmed', 'Consultant R', 'Support Q']), J(teacher.list));
  check('Teacher list excludes teaching staff and inactive staff', !teacher.list.includes('Staff A') && !teacher.list.includes('Left Admin'));
  check('Teacher validation rejects other names (allowInvalid FALSE)', teacher.allowInvalid === false);
  const type = dvAt(C('Absence Type'));
  check('Absence Type is the eight labels and rejects others', eq(type.list, t.run('absenceTypeLabels_()')) && type.list.length === 8 && type.allowInvalid === false);
  const dv = dvAt(C('Date'));
  check('Date is yyyy-MM-dd TEXT: plain-text format and a REGEXMATCH rule on the real Date column, never requireDate',
    dv.kind === 'requireFormulaSatisfied' && dv.allowInvalid === false && /^=REGEXMATCH\(A3&"","\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$"\)$/.test(dv.formula) &&
    /yyyy-mm-dd/.test(dv.help) && sheetRun(t, '.formats').some(f => f.c === C('Date') && f.f === '@') &&
    !sheetRun(t, '.validations').some(v => v.v.kind === 'requireDate'), J(dv));
  check('Timestamp is plain text so Sheets keeps the stamp as text', sheetRun(t, '.formats').some(f => f.c === C('Timestamp') && f.f === '@'));

  // R23: the list follows roster edits (edit on the roster) without a rebuild
  t.put(T, 2, 9, [{ 'Display Name': 'Admin New', Category: 'Admin', Active: true, 'Staff Code': 'S0104' }]);
  t.run(`onEditInstallable({ range: { getSheet: function () { return sheet_(SS.ROSTER); }, getRow: function () { return 9; }, getColumn: function () { return 1; } } })`);
  check('R23 a roster edit refreshes the list', dvAt(C('Teacher')).list.includes('Admin New'));
  t.run(`__put(SS.ROSTER, 2, 6, [{ Active: false }])`);
  t.run(`onEditInstallable({ range: { getSheet: function () { return sheet_(SS.ROSTER); }, getRow: function () { return 6; }, getColumn: function () { return 4; } } })`);
  check('R23 deactivating a person drops them from the list', !dvAt(C('Teacher')).list.includes('Support Q'));
  check('no qualifying staff: the Teacher cell accepts nothing (no selectable fake entry)', (() => {
    const u = fixture({ nobuild: true });
    u.run('(function(){ var c = __book.sheets[SS.ROSTER].cells; for (var k in c) delete c[k]; })(); clearRosterCache_(); ensureNonTeachingTab_()');
    const v = u.run(`__book.sheets[${J(NT)}].validations`).find(x => x.c === C('Teacher')).v;
    return v.kind === 'requireFormulaSatisfied' && v.formula === '=FALSE' && !v.list && v.allowInvalid === false && /No active non-teaching staff/.test(v.help);
  })());
}

/* ───────── onEdit enrichment ───────── */
{
  const t = fixture();
  const r = t.edit(3, 'Admin P');
  check('Admin: Staff Code (locked), Category, confirmed Email, Timestamp and Marked By filled',
    eq([t.cell(3, C('Staff Code')), t.cell(3, C('Category')), t.cell(3, C('Staff Email')), t.cell(3, C('Marked By'))],
      ['S0101', 'Admin', 'admin.p@example.test', 'editor.one@example.test']) && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(t.cell(3, C('Timestamp'))), J(t.row(3)));
  check('timestamp is Asia/Kolkata', t.run('__tzSeen.indexOf("Asia/Kolkata") > -1'));

  t.edit(4, 'Support Q');
  check('Support Staff: code and category filled, email blank (none on roster)',
    t.cell(4, C('Staff Code')) === 'W0201' && t.cell(4, C('Category')) === 'Support Staff' && t.cell(4, C('Staff Email')) === '');

  t.edit(5, 'Consultant R');
  check('R24 Resource Person: Category filled, Staff Code and Staff Email stay blank',
    t.cell(5, C('Category')) === 'Resource Person' && t.cell(5, C('Staff Code')) === '' && t.cell(5, C('Staff Email')) === '' && t.cell(5, C('Marked By')) !== '');

  t.edit(6, 'Admin Unconfirmed');
  check('an unconfirmed email is never written (D6)', t.cell(6, C('Staff Email')) === '' && t.cell(6, C('Staff Code')) === 'S0103');
}
{ // Timestamp / Marked By typed by a human survive; unknown editor leaves Marked By blank
  const t = fixture();
  t.put(NT, 2, 3, [{ 'Marked By': 'Typed By', Timestamp: 'typed-ts' }]);
  t.edit(3, 'Admin P');
  check('typed Marked By and Timestamp are never overwritten', t.cell(3, C('Marked By')) === 'Typed By' && t.cell(3, C('Timestamp')) === 'typed-ts');
  const res = t.edit(4, 'Support Q', { noUser: true });
  check('R24 unknown editor: Marked By blank (amber by rule), a toast says so, other cells still filled',
    t.cell(4, C('Marked By')) === '' && res.unknownEditor && t.run('__toasts.length') === 1 && t.cell(4, C('Staff Code')) === 'W0201');
  check('an empty e.user email counts as unknown, never the script owner', (() => {
    const u = fixture();
    u.put(NT, 2, 3, [{ Teacher: 'Admin P' }]);
    u.run(`nonTeachingOnEdit_({ range: sheet_(SS.NON_TEACHING).getRange(3, ${C('Teacher')}), user: { getEmail: function () { return ''; } } })`);
    return u.cell(3, C('Marked By')) === '';
  })());
}
{ // one batched write; other columns and tabs untouched; other edits ignored
  const t = fixture();
  t.put(NT, 2, 3, [{ Date: '2026-01-05', 'Periods Away': '1,2', Notes: 'keep' }]);
  t.run('__resetStats()');
  t.edit(3, 'Admin P');
  const st = t.run('({ sv: __stats.setValues, s: __stats.setValue })');
  check('one batched write per edit (a single setValues, no per-cell setValue)', st.sv === 1 && st.s === 0, J(st));
  check('columns outside the fill are untouched', t.cell(3, C('Date')) === '2026-01-05' && t.cell(3, C('Periods Away')) === '1,2' && t.cell(3, C('Notes')) === 'keep');
  t.run('__resetStats()');
  const r1 = t.run(`nonTeachingOnEdit_({ range: sheet_(SS.NON_TEACHING).getRange(3, ${C('Notes')}), user: { getEmail: function () { return 'x@example.test'; } } })`);
  const r2 = t.run(`nonTeachingOnEdit_({ range: sheet_(SS.NON_TEACHING).getRange(2, ${C('Teacher')}) })`);
  check('an edit outside the Teacher column, or on the header row, writes nothing', r1.rows === 0 && r2.rows === 0 && t.run('__stats.setValues') === 0);

  // paste of several teachers: still one write
  t.put(NT, 2, 10, [{ Teacher: 'Support Q' }, { Teacher: 'Consultant R' }]);
  t.run('__resetStats()');
  t.run(`nonTeachingOnEdit_({ range: sheet_(SS.NON_TEACHING).getRange(10, ${C('Teacher')}, 2, 1), user: { getEmail: function () { return 'p@example.test'; } } })`);
  check('a multi-row paste fills each row in one write', t.run('__stats.setValues') === 1 && t.cell(10, C('Staff Code')) === 'W0201' &&
    t.cell(11, C('Category')) === 'Resource Person' && t.cell(11, C('Staff Code')) === '');
}
{ // join keys are DERIVED from Teacher: never carried to a different person
  const t = fixture();
  t.put(T, 2, 9, [{ 'Display Name': 'Dup Q', Category: 'Admin', Active: true, 'Staff Code': 'S0105' },
    { 'Display Name': 'Dup Q', Category: 'Admin', Active: true, 'Staff Code': 'S0106' }]);
  t.run('clearRosterCache_()');
  t.edit(3, 'Admin P');
  t.edit(3, 'Support Q', { old: 'Admin P' });
  check('replacing the Teacher re-derives code, category and email (no old code or email survives)',
    t.cell(3, C('Staff Code')) === 'W0201' && t.cell(3, C('Category')) === 'Support Staff' && t.cell(3, C('Staff Email')) === '');
  t.edit(3, 'Consultant R', { old: 'Support Q' });
  check('replacing with a Resource Person clears the previous code', t.cell(3, C('Staff Code')) === '' && t.cell(3, C('Category')) === 'Resource Person');

  t.edit(4, 'Admin P');
  const stampBefore = t.cell(4, C('Timestamp'));
  t.edit(4, '');   // delete the teacher
  check('clearing the Teacher blanks code, category and email', t.cell(4, C('Staff Code')) === '' && t.cell(4, C('Category')) === '' && t.cell(4, C('Staff Email')) === '');
  t.edit(4, 'Support Q');
  check('delete then pick another: only the new person\'s keys, no email carried over',
    t.cell(4, C('Staff Code')) === 'W0201' && t.cell(4, C('Staff Email')) === '' && stampBefore !== undefined);

  // typed keys on a row are replaced when the Teacher is (re)selected
  t.put(NT, 2, 5, [{ 'Staff Code': 'TYPED', Category: 'Typed Cat', 'Staff Email': 'typed@example.test' }]);
  t.edit(5, 'Admin P');
  check('keys are derived: a typed code or email is replaced by the roster values when Teacher is edited',
    t.cell(5, C('Staff Code')) === 'S0101' && t.cell(5, C('Category')) === 'Admin' && t.cell(5, C('Staff Email')) === 'admin.p@example.test');

  // multi-row paste over rows holding someone else's keys
  t.put(NT, 2, 6, [{ Teacher: 'Support Q', 'Staff Code': 'OLD1', 'Staff Email': 'old1@example.test' }, { Teacher: 'Consultant R', 'Staff Code': 'OLD2', 'Staff Email': 'old2@example.test' },
    { Teacher: 'Admin P', 'Staff Code': 'OLD3', 'Staff Email': 'old3@example.test' }]);
  t.run(`nonTeachingOnEdit_({ range: sheet_(SS.NON_TEACHING).getRange(6, ${C('Teacher')}, 3, 1), user: { getEmail: function () { return 'p@example.test'; } } })`);
  check('multi-row paste: every row re-derived, none keeps an old key',
    eq([6, 7, 8].map(r => [t.cell(r, C('Staff Code')), t.cell(r, C('Staff Email'))]),
      [['W0201', ''], ['', ''], ['S0101', 'admin.p@example.test']]));

  // duplicate roster name: ambiguous, so no keys
  t.put(NT, 2, 9, [{ 'Staff Code': 'OLD', 'Staff Email': 'old@example.test', Category: 'Admin' }]);
  t.edit(9, 'Dup Q');
  check('a duplicate roster name is ambiguous: keys blanked, never guessed',
    t.cell(9, C('Staff Code')) === '' && t.cell(9, C('Staff Email')) === '' && t.cell(9, C('Category')) === '');

  // unknown name: skipped entirely
  t.put(NT, 2, 10, [{ 'Staff Code': 'OLD', 'Staff Email': 'old@example.test', Category: 'Admin' }]);
  const u = t.edit(10, 'Nobody Z');
  check('a name not on the roster: keys blanked, no Timestamp, no Marked By, nothing counted',
    t.cell(10, C('Staff Code')) === '' && t.cell(10, C('Staff Email')) === '' && t.cell(10, C('Category')) === '' &&
    t.cell(10, C('Timestamp')) === '' && t.cell(10, C('Marked By')) === '' && u.rows === 0 && !u.unknownEditor);
  const tf = sheetRun(t, '.cf').filter(r => /Teacher|COUNTIF\(INDIRECT/.test(r.formula) && /COUNTIF\(INDIRECT\("'🪪 Teachers'/.test(r.formula));
  check('an amber "Teacher not on roster" rule keeps such rows visible', tf.length === 1 && tf[0].bg === t.run('C.AMBER_50') && /\)=0\)$/.test(tf[0].formula), J(tf));
}
{ // Date edits: Date objects/serials from a paste become yyyy-MM-dd text (Asia/Kolkata)
  const t = fixture();
  t.run(`__book.sheets[${J(NT)}].cells["3,${C('Date')}"] = new Date(Date.UTC(2026, 0, 4, 20, 0, 0))`);   // 2026-01-05 01:30 IST
  t.run('__resetStats()');
  t.run(`nonTeachingOnEdit_({ range: sheet_(SS.NON_TEACHING).getRange(3, ${C('Date')}) })`);
  check('a pasted Date object is rewritten as yyyy-MM-dd text in Asia/Kolkata, in one write', t.cell(3, C('Date')) === '2026-01-05' && t.run('__stats.setValues') === 1, J(t.cell(3, C('Date'))));
  t.run('__resetStats()');
  t.run(`nonTeachingOnEdit_({ range: sheet_(SS.NON_TEACHING).getRange(3, ${C('Date')}) })`);
  check('a text date edit writes nothing', t.run('__stats.setValues') === 0);
  // re-running the builder over existing Date objects leaves them and says so in the note
  t.run(`__book.sheets[${J(NT)}].cells["4,${C('Date')}"] = new Date(2026, 0, 6)`);
  t.run('writeNonTeachingTab_()');
  check('builder never converts existing dates; it notes them', t.run(`__book.sheets[${J(NT)}].cells["4,${C('Date')}"] instanceof Date`) &&
    /real dates/.test(sheetRun(t, '.notes["2,' + C('Date') + '"]')));
}
{ // routing: other tabs unchanged, the engine is never called
  const t = fixture();
  t.run('var __plan = 0; computePlan = function () { __plan++; };');
  t.put(NT, 2, 3, [{ Teacher: 'Admin P' }]);
  t.run(`onEditInstallable({ range: sheet_(SS.NON_TEACHING).getRange(3, ${C('Teacher')}), user: { getEmail: function () { return 'e@example.test'; } } })`);
  check('onEditInstallable routes the tab to the enrichment, never to the engine', t.cell(3, C('Staff Code')) === 'S0101' && t.run('__plan') === 0);
  t.run('__cache.removes = 0');
  t.run(`onEditInstallable({ range: { getSheet: function () { return sheet_(SS.ROSTER_SETTINGS); } } })`);
  check('roster tab routing is unchanged', t.run('__cache.removes') >= 1);
}

/* ───────── conditional formats ───────── */
{
  const t = fixture();
  const cf = sheetRun(t, '.cf');
  const by = (bg, re) => cf.filter(r => r.bg === bg && re.test(r.formula));
  check('eight rules: two duplicate, two code, two email, Marked By, Teacher not on roster', cf.length === 8);
  const dup = cf.filter(r => r.bg === t.run('C.ROSE_50'));
  check('duplicate (Date, Staff Code) is red', dup.length === 2 && /COUNTIFS\(\$A\$3:\$A,\$A3,\$G\$3:\$G,\$G3\)>1/.test(dup[0].formula), dup[0] && dup[0].formula);
  check('name-only people duplicate on (Date, Teacher), and only when the code is blank',
    /COUNTIFS\(\$A\$3:\$A,\$A3,\$B\$3:\$B,\$B3\)>1/.test(dup[1].formula) && /\$G3=""/.test(dup[1].formula));
  const grey = t.run('C.BUSY_BG'), amber = t.run('C.AMBER_50');
  const codeGrey = cf.filter(r => r.bg === grey && /\$G3=""/.test(r.formula))[0];
  const codeAmber = cf.filter(r => r.bg === amber && /\$G3=""/.test(r.formula))[0];
  check('Staff Code: grey when the category is name-only, amber only when it is not',
    /Name only"\)/.test(codeGrey.formula) && !/NOT\(/.test(codeGrey.formula) && /NOT\(IFERROR/.test(codeAmber.formula));
  const emailGrey = cf.filter(r => r.bg === grey && /\$F3=""/.test(r.formula))[0];
  const emailAmber = cf.filter(r => r.bg === amber && /\$F3=""/.test(r.formula))[0];
  check('Staff Email: amber only if the category requires email; otherwise grey',
    /^=AND\(\$B3<>"",\$F3="",NOT\(/.test(emailGrey.formula) && /^=AND\(\$B3<>"",\$F3="",AND\(NOT\(/.test(emailAmber.formula));
  check('Resource Person is never amber: name-only is excluded from both amber rules',
    /NOT\(IFERROR/.test(codeAmber.formula) && /AND\(NOT\(IFERROR/.test(emailAmber.formula));
  check('Marked By amber when blank', by(amber, /\$E3=""/).length === 1);
  check('cross-sheet Settings lookups go through INDIRECT', cf.filter(r => /Roster Settings/.test(r.formula)).every(r => /INDIRECT/.test(r.formula)));
  const rangesOk = t.run(`__book.sheets[${J(NT)}].cf.length`) === 8;
  t.run('writeNonTeachingTab_()');
  check('re-running the builder replaces the rule set, not appends', rangesOk && sheetRun(t, '.cf.length') === 8);

  // duplicate rows are flagged, never deleted
  t.edit(3, 'Admin P'); t.edit(4, 'Admin P');
  t.put(NT, 2, 3, [{ Date: '2026-01-05' }, { Date: '2026-01-05' }]);
  t.run('writeNonTeachingTab_()');
  check('duplicate rows are kept (nothing deletes them)', t.cell(3, C('Staff Code')) === 'S0101' && t.cell(4, C('Staff Code')) === 'S0101' && sheetRun(t, '.cleared') === 0);
}

/* ───────── upgradeTabs / setupAllTabs ───────── */
{
  const ctx = load(FILES, MOCK + `
    function getConfig() { return defaultConfig_(); }
    function absenceMigrationNeeded_() { return false; }
    function addMissingConfigRows_() { return []; }
    function refreshLabels_() { return []; }
    function ensureAbsenceTrigger_() {} function ensureReportTrigger_() {}
  `);
  const run = ctx.run;
  ['CONSOLE', 'CONFIG', 'MARK_ABSENCE', 'POOL', 'DASHBOARD', 'ANALYTICS', 'LOG', 'ABSENCE', 'RULES', 'BLOCKS', 'REPORTS', 'IMPORT_HR', 'HELP'].forEach(k => {
    run(`(function(){ var s = __ss.insertSheet(SS.${k}); s.cells["5,1"] = "SENTINEL-${k}"; })()`);
  });
  const others = run('__book.order').slice();
  const before = JSON.parse(run(`__snapshot(${J(others)})`));
  run('upgradeTabs()');
  const after = JSON.parse(run(`__snapshot(${J(others)})`));
  check('upgradeTabs creates 🗓️ Non-Teaching Absence exactly once, with its headers', run('__book.order').filter(n => n === NT).length === 1 &&
    eq(HEAD.map((h, i) => run(`__cell(${J(NT)}, 2, ${i + 1})`)), HEAD));
  check('upgradeTabs leaves every other existing tab untouched', others.every(n => J(after[n]) === J(before[n])));
  run(`__put(${J(NT)}, 2, 3, [{ Notes: "SENTINEL-NT" }])`);
  const snap = run('__snapshot()');
  run('upgradeTabs()');
  check('a second upgradeTabs changes nothing and keeps typed rows', run('__snapshot()') === snap && run(`__cell(${J(NT)}, 3, 10)`) === 'SENTINEL-NT');
  check('Help mentions the tab', fs.readFileSync(path.join(ROOT, 'Setup.js'), 'utf8').includes('Non-Teaching Absence tab'));
}
{
  const ctx = load(FILES, MOCK + `
    function getConfig() { return defaultConfig_(); }
    function describeDataAtRisk_() { return ['x']; }
    ['writeConfigTab_','writeConsoleTab_','writeMarkAbsenceTab_','writeLogTab_','writeAbsenceRegisterTab_','writeRulesTab_','writeBlocksTab_',
     'writeReportsTab_','writeImportHrTab_','writeHelpTab_','renderPool_','renderFairness_','renderAnalyticsTab_','ensureAbsenceTrigger_','ensureReportTrigger_']
      .forEach(function (n) { globalThis[n] = function () {}; });
    function backupWorkbook_() { return { getName: function () { return 'b'; } }; }
  `);
  const run = ctx.run;
  run('ensureRosterTabs_(); ensureNonTeachingTab_()');
  run(`__put(${J(NT)}, 2, 3, [{ Teacher: "Admin P", Notes: "SENTINEL" }])`);
  const snap = run(`__snapshot(${J([NT])})`);
  run('__ui.answer = "YES"; setupAllTabs()');
  check('setupAllTabs does not wipe or rewrite the tab', run(`__snapshot(${J([NT])})`) === snap && run(`__book.sheets[${J(NT)}].cleared`) === 0);
  check('ensureNonTeachingTab_ is create-if-missing only', run('ensureNonTeachingTab_()') === false);
}

/* ───────── R25: nothing else reads the tab ───────── */
{
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const readers = files.filter(f => /SS\.NON_TEACHING|NON_TEACHING_HEADERS|NON_TEACHING_DATA_START|Non-Teaching Absence/.test(src(f)));
  const allowed = ['Constants.js', 'AbsenceRegister.js', 'RosterTabs.js', 'Roster.js', 'Setup.js', 'MarkAbsenceTab.js', 'Backfill.js'];   // Backfill.js: T-017 reads the tab to fill blank keys (R22a)
  check('R25 only the definition, builder, onEdit and wiring files mention the tab', readers.every(f => allowed.includes(f)), J(readers));
  const engine = ['Assign.js', 'MatchEngine.js', 'Pool.js', 'Log.js', 'Rules.js', 'DataSource.js', 'Reports.js', 'ReportData.js', 'ReportRender.js',
    'Analytics.js', 'AnalyticsData.js', 'AnalyticsRender.js', 'AnalyticsTab.js', 'Dashboard.js', 'Chat.js', 'HR.js', 'HRDirectory.js', 'Config.js', 'Code.js'];
  check('R25 no engine, Log, report, analytics, dashboard or chat file references SS.NON_TEACHING',
    engine.every(f => !/NON_TEACHING|Non-Teaching/.test(src(f))));
  check('AbsenceRegister.js only declares the frozen headers (no read of the tab)', !/SS\.NON_TEACHING/.test(src('AbsenceRegister.js')));
  check('N3 only placeholder addresses appear in the new tests', (src('test/nonteaching.test.js').match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).every(a => /@example\.test$/.test(a)));
}
