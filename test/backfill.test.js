/**
 * T-017: Backfill (every row). Spec: docs/PRD-roster.md D3, D6, D11, §6.6, §6.7, §7.5 (R20-R22a), §9 step 9, §10.
 * Placeholder data only: the repo is public.
 */
const fs = require('fs');
const path = require('path');
const { load, DEFAULT_FILES, ROOT } = require('./harness');
const { MOCK } = require('./sheetmock');

const FILES = DEFAULT_FILES.concat(['Reports.js', 'ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'AnalyticsTab.js',
  'HR.js', 'Setup.js', 'MarkAbsenceTab.js', 'Code.js', 'RosterTabs.js', 'Roster.js', 'Backfill.js']);
const J = JSON.stringify;
const eq = (a, b) => J(a) === J(b);
const REG = '🗓️ Absence Register', NT = '🗓️ Non-Teaching Absence', T = '🪪 Teachers', LOG = '🪪 Roster Log', PV = '🧾 Backfill Preview';
const NT_HEAD = ['Date', 'Teacher', 'Absence Type', 'Periods Away', 'Marked By', 'Staff Email', 'Staff Code', 'Category', 'Timestamp', 'Notes'];
const SENT = 'SENTINEL-PII';

const OVER = `
  function getAllTeachers() { return ['Staff A']; }
  function getTeacherMeta() { return {}; }
  function getConfig() { return defaultConfig_(); }
  var __ops = []; function notifyOpsFailure_(w, m) { __ops.push([w, m]); }
  function toast_() {}
  var BACKUP_FAILS = false, __backups = [];
  function backupWorkbook_(why) {
    if (BACKUP_FAILS) throw new Error('drive is down');
    __backups.push({ why: why, regCells: JSON.stringify(sheet_(SS.ABSENCE).cells), ntCells: JSON.stringify(sheet_(SS.NON_TEACHING).cells) });
    return { getName: function () { return 'Backup copy ' + __backups.length; }, getId: function () { return 'BKP-ID-' + __backups.length; } };
  }
  var CHUNK = 2000, STOP_AT_CHECK = -1, __timeChecks = 0;
  function backfillChunkSize_() { return CHUNK; }
  function backfillOutOfTime_() { __timeChecks++; return STOP_AT_CHECK >= 0 && __timeChecks >= STOP_AT_CHECK; }
`;

/** What the roster says about each name (an independent restatement of the fixture, not of the code under test). */
const KEYS = {
  'Staff A': { kind: 'ok', code: 'S0001', email: 'staff.a@example.test' },
  'Staff B': { kind: 'ok', code: 'S0002', email: '' },                       // email Needs review
  'Staff C': { kind: 'ok', code: '', email: 'staff.c@example.test' },       // no code on the roster
  'Staff D': { kind: 'ok', code: '', email: '' },                           // N/A placeholders
  'Staff Unlocked': { kind: 'ok', code: '', email: 'staff.u@example.test' },// typed code, never locked
  'Admin P': { kind: 'ok', code: 'S0101', email: 'admin.p@example.test' },
  'Support Q': { kind: 'ok', code: 'W0201', email: '' },
  'Admin Unconfirmed': { kind: 'ok', code: 'S0103', email: '' },
  'Left Admin': { kind: 'ok', code: 'S0102', email: '' },                   // inactive: still resolved (R20)
  'Dup X': { kind: 'dup' },
  'Consultant R': { kind: 'nameonly' },
};
const WHO = ['Staff A', 'Staff B', 'Staff C', 'Staff D', 'Dup X', 'Staff Unlocked', 'Ghost Nobody', 'Admin P'];

/** Independent mirror of the classification, for the expected counts. */
function expectAction(teacher, code, email) {
  const k = KEYS[teacher] || { kind: 'none' };
  const col = (cur, prop, unresolved) => {
    if (cur !== '') return prop && prop.toLowerCase() !== cur.toLowerCase() ? 'Conflict (differs)' : 'Already filled';
    if (k.kind === 'none') return 'No roster match';
    if (k.kind === 'dup') return 'Duplicate name';
    if (k.kind === 'nameonly') return 'Name only';
    return prop ? 'Will fill' : unresolved;
  };
  const c = col(code, k.code, 'Code not locked'), e = col(email, k.email, 'Email not confirmed');
  const has = a => c === a || e === a;
  for (const a of ['Will fill', 'No roster match', 'Duplicate name', 'Name only']) if (has(a)) return a;
  if (c === 'Code not locked') return c;
  if (e === 'Email not confirmed') return e;
  if (has('Conflict (differs)')) return 'Conflict (differs)';
  return 'Already filled';
}

function registerData(n, clean) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const teacher = WHO[i % WHO.length];
    const r = { Timestamp: '2026-08-01 07:00:00', Date: `2026-0${1 + (i % 9)}-${10 + (i % 18)}`, Day: 'Monday', Week: '2026-W30', Teacher: teacher,
      Department: 'Maths', Team: 'High School', 'Absence Type': 'Leave - Full day', 'Periods Away': 'All day', 'Periods Scheduled': 6,
      'Periods To Cover': 4, Covered: 4, Uncovered: 0, 'Cover Reassigned': 0, 'Run ID': 'RUN-' + i, 'Marked By': 'marker.one@example.test' };
    if (clean) { /* every key blank: how the historical rows really are */ }
    else if (i % 11 === 0) { r['Staff Code'] = 'KEEP-' + i; r['Staff Email'] = 'keep.' + i + '@example.test'; }       // already filled (maybe differing)
    else if (i % 13 === 0) r['Staff Code'] = 'S0001';                                                            // only the code filled
    rows.push(r);
  }
  return rows;
}

const SHUFFLED = ['Run ID', 'Staff Code', 'Teacher', 'Notes', 'Date', 'Marked By', 'Absence Type', 'Extra A', 'Staff Email', 'Timestamp', 'Day', 'Week',
  'Department', 'Team', 'Periods Away', 'Periods Scheduled', 'Periods To Cover', 'Covered', 'Uncovered', 'Cover Reassigned'];

function fixture(opts) {
  opts = opts || {};
  const ctx = load(FILES, MOCK + OVER);
  const run = ctx.run;
  const t = { ctx, run };
  t.put = (tab, hr, sr, rows) => run(`__put(${J(tab)}, ${hr}, ${sr}, ${J(rows)})`);
  t.cells = tab => J(run(`__book.sheets[${J(tab)}].cells`));
  t.cell = (tab, r, c) => run(`__cell(${J(tab)}, ${r}, ${c})`);
  t.snap = () => run('__snapshot()');
  t.stats = () => run('({ setValues: __stats.setValues, setValue: __stats.setValue })');
  t.alerts = () => run('__ui.alerts');
  t.backups = () => run('__backups');
  run('ensureRosterTabs_()');
  t.put(T, 2, 3, [
    { 'Display Name': 'Staff A', Category: 'Teaching', Active: true, 'Staff Code': 'S0001', Email: 'staff.a@example.test', 'Match Status': 'Confirmed', Notes: SENT, Department: SENT },
    { 'Display Name': 'Staff B', Category: 'Teaching', Active: true, 'Staff Code': 'S0002', Email: 'staff.b@example.test', 'Match Status': 'Needs review' },
    { 'Display Name': 'Staff C', Category: 'Teaching', Active: true, Email: 'staff.c@example.test', 'Match Status': 'Confirmed' },
    { 'Display Name': 'Staff D', Category: 'Teaching', Active: true, 'Staff Code': 'N/A', Email: 'N/A', 'Match Status': 'Confirmed' },
    { 'Display Name': 'Dup X', Category: 'Teaching', Active: true, 'Staff Code': 'S0010' },
    { 'Display Name': 'Dup X', Category: 'Teaching', Active: true, 'Staff Code': 'S0011' },
    { 'Display Name': 'Admin P', Category: 'Admin', Active: true, 'Staff Code': 'S0101', Email: 'admin.p@example.test', 'Match Status': 'Confirmed' },
    { 'Display Name': 'Admin Unconfirmed', Category: 'Admin', Active: true, 'Staff Code': 'S0103', Email: 'admin.u@example.test', 'Match Status': 'Needs review' },
    { 'Display Name': 'Support Q', Category: 'Support Staff', Active: true, 'Staff Code': 'W0201' },
    { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
    { 'Display Name': 'Left Admin', Category: 'Admin', Active: false, 'Staff Code': 'S0102' },
  ]);
  run('lockNewStaffCodes_()');
  t.put(T, 2, 14, [{ 'Display Name': 'Staff Unlocked', Category: 'Teaching', Active: true, 'Staff Code': 'S0050', Email: 'staff.u@example.test', 'Match Status': 'Confirmed' }]);
  run('clearRosterCache_()');

  // 🗓️ Absence Register in the requested layout
  const n = opts.rows == null ? 230 : opts.rows;
  if (opts.layout === 'old') {
    run('__ss.insertSheet(SS.ABSENCE)');
    run(`(function(){ var h = ABSENCE_HEADERS.slice(0, 16); h.forEach(function (x, i) { sheet_(SS.ABSENCE).cells["2," + (i + 1)] = x; }); })()`);
  } else if (opts.layout === 'shuffled') {
    run('__ss.insertSheet(SS.ABSENCE)');
    SHUFFLED.forEach((h, i) => run(`__book.sheets[SS.ABSENCE].cells["2,${i + 1}"] = ${J(h)}`));
  } else run('__ss.insertSheet(SS.ABSENCE); writeAbsenceRegisterTab_()');
  const data = registerData(n, opts.clean);
  if (opts.layout === 'shuffled') data.forEach((r, i) => { r.Notes = SENT; r['Extra A'] = 'extra-' + i; });
  if (opts.layout === 'old') data.forEach(r => { delete r['Staff Code']; delete r['Staff Email']; });
  t.put(REG, 2, 3, data);
  t.data = data;

  run('ensureNonTeachingTab_()');
  const nt = [
    { Date: '2026-08-03', Teacher: 'Admin P', 'Absence Type': 'Leave - Full day', 'Marked By': 'marker.one@example.test', Category: 'Admin', Notes: SENT },
    { Date: '2026-08-04', Teacher: 'Admin P', 'Absence Type': 'Leave - Full day', 'Staff Code': 'S0101', Category: 'Admin' },
    { Date: '2026-08-05', Teacher: 'Admin P', 'Absence Type': 'Leave - Full day', Category: 'Admin' },   // Date replaced by a real Date below
    { Date: '2026-08-06', Teacher: 'Support Q', 'Absence Type': 'Leave - Full day', Category: 'Support Staff' },
    { Date: '2026-08-07', Teacher: 'Support Q', 'Absence Type': 'Leave - Full day', Category: 'Support Staff', 'Staff Code': 'W0201' },
    { Date: '2026-08-03', Teacher: 'Consultant R', 'Absence Type': 'Leave - Full day', Category: 'Resource Person' },
    { Date: '2026-08-04', Teacher: 'Consultant R', 'Absence Type': 'Leave - Full day', Category: 'Resource Person', Notes: SENT },
    { Date: '2026-08-05', Teacher: 'Admin Unconfirmed', 'Absence Type': 'Leave - Full day', Category: 'Admin' },
    { Date: '2026-08-05', Teacher: 'Left Admin', 'Absence Type': 'Leave - Full day', Category: 'Admin' },
    { Date: '2026-08-08', Teacher: 'Ghost Nobody', 'Absence Type': 'Leave - Full day' },
    { Date: '2026-08-09', Teacher: 'Admin P', 'Absence Type': 'Leave - Full day', 'Staff Code': 'KEEP-NT', 'Staff Email': 'keep.nt@example.test', Category: 'Admin' },
    { Date: '2026-08-10', Teacher: 'Staff A', 'Absence Type': 'Leave - Full day', 'Staff Email': '', 'Staff Code': '' },
  ];
  t.put(NT, 2, 3, nt);
  run(`__book.sheets[${J(NT)}].cells["5,1"] = new Date(Date.UTC(2026, 7, 5, 6, 0, 0))`);   // a real Date cell for 2026-08-05
  t.nt = nt;
  run('clearRosterCache_(); clearCache(); __resetStats(); __cache.puts = []');
  t.preview = () => run('previewStaffKeyBackfill_()');
  t.apply = () => run('applyStaffKeyBackfill_()');
  t.pv = () => {
    const last = run(`sheet_(${J(PV)}).getLastRow()`), head = run(`BACKFILL_PREVIEW_HEADERS`), out = [];
    for (let r = 3; r <= last; r++) { const o = { _row: r }; head.forEach((h, i) => { o[h] = t.cell(PV, r, i + 1); }); out.push(o); }
    return out;
  };
  t.logRows = () => {
    const last = run(`sheet_(${J(LOG)}).getLastRow()`), out = [];
    for (let r = 3; r <= last; r++) out.push(['Timestamp', 'User', 'Display Name', 'Field', 'Old', 'New', 'Reason', 'Source'].map((h, i) => t.cell(LOG, r, i + 1)));
    return out;
  };
  /** Cells of a tab, as { 'r,c': value } minus nothing: for before/after diffs. */
  t.cellMap = tab => JSON.parse(t.cells(tab));
  return t;
}
const canon = m => J(Object.keys(m).sort().map(k => [k, m[k]]));
const diffTabs = (a, b) => { a = JSON.parse(a); b = JSON.parse(b); return Object.keys(b).filter(n => J(a[n]) !== J(b[n])); };
const diff = (a, b) => { const keys = new Set(Object.keys(a).concat(Object.keys(b))); return [...keys].filter(k => J(a[k]) !== J(b[k])); };
const colOf = (t, tab, name) => { const w = t.run(`sheet_(${J(tab)}).getLastColumn()`); for (let c = 1; c <= w; c++) if (t.cell(tab, 2, c) === name) return c; return 0; };

/* ───────── the tab: safe path, derived, idempotent, hidden when unused ───────── */
{
  const t = fixture({ rows: 5 });
  check('SS.BACKFILL_PREVIEW is the frozen name', t.run('SS.BACKFILL_PREVIEW') === PV);
  check('the tab does not exist until the safe upgrade path (or ensure) creates it', t.run(`!ss_().getSheetByName(${J(PV)})`));
  check('Preview refuses, naming the safe upgrade, when the tab is missing', (() => { try { t.preview(); return false; } catch (e) { return /Upgrade tabs \(safe\)/.test(e.message); } })());
  check('ensureBackfillPreviewTab_ creates it once', t.run('ensureBackfillPreviewTab_()') === true && t.run('ensureBackfillPreviewTab_()') === false);
  check('headers are the §6.6 columns plus per-column actions and Result', eq(t.run('BACKFILL_PREVIEW_HEADERS').map((h, i) => t.cell(PV, 2, i + 1)), t.run('BACKFILL_PREVIEW_HEADERS')) &&
    eq(t.run('BACKFILL_PREVIEW_HEADERS').slice(0, 10), ['Tab', 'Row', 'Date', 'Teacher', 'Run ID (Register only)', 'Current Staff Code', 'Proposed Staff Code', 'Current Staff Email', 'Proposed Staff Email', 'Action']));
  check('empty, the tab is hidden', t.run(`__book.sheets[${J(PV)}].hidden`) === true && t.run(`__book.sheets[${J(PV)}].frozenRows`) === 2);
  t.preview();
  check('a preview shows it', t.run(`__book.sheets[${J(PV)}].hidden`) === false);
  const before = t.snap();
  t.run('writeBackfillPreviewTab_(); writeBackfillPreviewTab_()');
  check('the builder is idempotent and non-destructive (nothing cleared, content kept, in-use tab not re-hidden)', t.snap() === before && t.run(`__book.sheets[${J(PV)}].cleared`) === 0);
  const u = fixture({ rows: 5 });
  u.run('__ui.answer = "YES"; upgradeTabs()');
  check('the safe upgrade path creates the tab', u.run('__book.order').includes(PV));
  const snap = u.snap();
  u.run('upgradeTabs()');
  check('a second upgrade changes nothing (the Register conditional-format chrome is an existing mock artefact, excluded)', diffTabs(snap, u.snap()).filter(n => n !== REG).length === 0 && !diffTabs(snap, u.snap()).includes(PV));
  const src = fs.readFileSync(path.join(ROOT, 'Setup.js'), 'utf8');
  const setupBody = src.slice(src.indexOf('function setupAllTabs'), src.indexOf('/* ───────── ⚙️ Config'));
  check('setupAllTabs (destructive path) never builds or touches it', !/BACKFILL|Backfill/.test(setupBody));
}

/* ───────── R20: preview scans EVERY row, classifies, writes only the preview ───────── */
for (const layout of ['standard', 'shuffled']) {
  const t = fixture({ layout });
  t.run('ensureBackfillPreviewTab_()');
  const other = [REG, NT, T, LOG, '🧭 Roster Settings'];
  const before = other.map(n => t.cells(n));
  const s = t.preview();
  check(`[${layout}] R20 scans every Register row (230) and every non-teaching row (12)`, s.scanned['Absence Register'] === 230 && s.scanned['Non-Teaching Absence'] === 12, J(s.scanned));
  check(`[${layout}] R20 the preview wrote NOTHING outside 🧾 Backfill Preview (no tab, no log, no roster)`, other.every((n, i) => t.cells(n) === before[i]));

  const expected = {};
  t.run('BACKFILL_ACTIONS').forEach(a => { expected[a] = 0; });
  t.data.forEach(r => { expected[expectAction(r.Teacher, r['Staff Code'] || '', r['Staff Email'] || '')]++; });
  t.nt.forEach((r, i) => {
    const code = r['Staff Code'] || '', email = r['Staff Email'] || '';
    expected[expectAction(r.Teacher, code, email)]++;
  });
  check(`[${layout}] every row lands in exactly one class and the counts match the roster`, eq(s.counts, expected) &&
    Object.values(s.counts).reduce((a, b) => a + b, 0) === 242, J({ got: s.counts, expected }));
  check(`[${layout}] all eight classes occur in this fixture`, t.run('BACKFILL_ACTIONS').every(a => s.counts[a] > 0), J(s.counts));

  const rows = t.pv();
  check(`[${layout}] Already filled rows are counted, not listed; the rest are listed with their exact cells`,
    rows.length === 242 - s.counts['Already filled'] && rows.every(r => r.Action !== 'Already filled'));
  const byAct = a => rows.filter(r => r.Action === a);
  check(`[${layout}] Duplicate name is skipped with no proposal; so is No roster match`,
    byAct('Duplicate name').concat(byAct('No roster match')).every(r => r['Proposed Staff Code'] === '' && r['Proposed Staff Email'] === '') && byAct('Duplicate name').length > 0);
  check(`[${layout}] Name only (Resource Person) never proposes a code or email`, byAct('Name only').length === 2 &&
    byAct('Name only').every(r => r.Teacher === 'Consultant R' && r['Proposed Staff Code'] === '' && r['Proposed Staff Email'] === ''));
  const a1 = rows.find(r => r.Teacher === 'Staff A' && r.Action === 'Will fill' && r['Current Staff Code'] === '');
  check(`[${layout}] a Will fill line carries the locked code and confirmed email, tab, row and Run ID`,
    a1 && a1['Proposed Staff Code'] === 'S0001' && a1['Proposed Staff Email'] === 'staff.a@example.test' && a1.Tab === 'Absence Register' && /^RUN-\d+$/.test(a1['Run ID (Register only)']) && a1.Row >= 3);
  const b1 = rows.find(r => r.Teacher === 'Staff B' && r.Action === 'Will fill');
  check(`[${layout}] Email not confirmed: Staff B gets the code only, email class shown`, b1['Proposed Staff Code'] === 'S0002' && b1['Proposed Staff Email'] === '' && b1['Email Action'] === 'Email not confirmed');
  const c1 = rows.find(r => r.Teacher === 'Staff C' && r.Tab === 'Absence Register' && r['Current Staff Code'] === '' && r['Current Staff Email'] === '');
  check(`[${layout}] Code not locked / no code: Staff C gets the email only; Staff Unlocked likewise (typed code never used)`,
    c1['Proposed Staff Code'] === '' && c1['Code Action'] === 'Code not locked' && c1['Proposed Staff Email'] === 'staff.c@example.test' &&
    rows.filter(r => r.Teacher === 'Staff Unlocked' && r['Current Staff Code'] === '').every(r => r['Proposed Staff Code'] === '' && r['Code Action'] === 'Code not locked'), J([c1, rows.filter(r => r.Teacher === 'Staff Unlocked').slice(0,2)]));
  const d1 = rows.filter(r => r.Teacher === 'Staff D');
  check(`[${layout}] R35 N/A on the roster is "no value": nothing proposed, class Code not locked`, d1.length > 0 &&
    d1.every(r => r['Proposed Staff Code'] === '' && r['Proposed Staff Email'] === '' && /^(Code not locked|Email not confirmed)$/.test(r.Action)));
  check(`[${layout}] a differing existing value is shown as Conflict (differs), never proposed over`, byAct('Conflict (differs)').length > 0 &&
    byAct('Conflict (differs)').every(r => r['Current Staff Code'] !== '' && r['Proposed Staff Code'] === ''));
  check(`[${layout}] the inactive roster row (Left Admin) is still resolved by name (R20)`, rows.some(r => r.Teacher === 'Left Admin' && r['Proposed Staff Code'] === 'S0102'));
  check(`[${layout}] the real Date cell on the non-teaching tab is previewed as yyyy-MM-dd text`, rows.some(r => r.Tab === 'Non-Teaching Absence' && r.Teacher === 'Admin P' && r.Date === '2026-08-05'));
  const title = t.cell(PV, 1, 1);
  check(`[${layout}] the title carries Data as of, rows scanned, counts per class and cells to write`, /Data as of \d{4}-\d\d-\d\d \d\d:\d\d/.test(title) &&
    /Absence Register 230/.test(title) && /Non-Teaching Absence 12/.test(title) && /Will fill \d+/.test(title) && /cells to write: Staff Code \d+, Staff Email \d+/.test(title) && /Backfill rollback info/.test(title), title);
  const again = t.snap();
  t.preview();
  t.preview();
  check(`[${layout}] a second preview is stable`, eq(t.pv().map(r => r.Action), rows.map(r => r.Action)) && again !== '');
}

/* ───────── old layout: no key columns -> refuse, name the header, write nothing ───────── */
{
  const t = fixture({ layout: 'old', rows: 20 });
  t.run('ensureBackfillPreviewTab_()');
  const before = t.snap();
  let msg = '';
  try { t.preview(); } catch (e) { msg = e.message; }
  check('old Register layout (no Staff Code / Staff Email): preview refuses, names the headers, writes nothing', /Staff Code/.test(msg) && /Staff Email/.test(msg) && /Upgrade tabs \(safe\)/.test(msg) && t.snap() === before, msg);
}

/* ───────── R21: apply fills blanks only ───────── */
for (const layout of ['standard', 'shuffled']) {
  const t = fixture({ layout });
  t.run('ensureBackfillPreviewTab_()');
  const s = t.preview();
  const regBefore = t.cellMap(REG), ntBefore = t.cellMap(NT), teachBefore = t.cells(T);
  t.run('__resetStats()');
  const r = t.apply();
  const regAfter = t.cellMap(REG), ntAfter = t.cellMap(NT);
  const codeC = colOf(t, REG, 'Staff Code'), emailC = colOf(t, REG, 'Staff Email');
  const regChanged = diff(regBefore, regAfter), ntChanged = diff(ntBefore, ntAfter);
  check(`[${layout}] R22 only the two key columns of the Register change`, regChanged.length > 0 && regChanged.every(k => +k.split(',')[1] === codeC || +k.split(',')[1] === emailC), J(regChanged.slice(0, 5)));
  const ntCode = colOf(t, NT, 'Staff Code'), ntEmail = colOf(t, NT, 'Staff Email');
  check(`[${layout}] R22a only the two key columns of the non-teaching tab change`, ntChanged.length > 0 && ntChanged.every(k => +k.split(',')[1] === ntCode || +k.split(',')[1] === ntEmail), J(ntChanged));
  check(`[${layout}] blank cells only: every changed cell was empty before`, regChanged.every(k => regBefore[k] == null || regBefore[k] === '') && ntChanged.every(k => ntBefore[k] == null || ntBefore[k] === ''));
  check(`[${layout}] existing values (KEEP-*, the differing S0001 sentinel rows) are untouched`, Object.keys(regBefore).filter(k => /^KEEP-|keep\./.test(String(regBefore[k]))).every(k => regAfter[k] === regBefore[k]) &&
    ntAfter['13,7'] === 'KEEP-NT' && ntAfter['13,6'] === 'keep.nt@example.test');
  check(`[${layout}] cells written == cells previewed (code ${s.cells.code}, email ${s.cells.email})`, regChanged.length + ntChanged.length === s.cells.code + s.cells.email && r.code === s.cells.code && r.email === s.cells.email, J({ r, s: s.cells, n: regChanged.length + ntChanged.length }));
  const v = k => regAfter[k];
  let right = true;
  t.data.forEach((row, i) => {
    const k = KEYS[row.Teacher], rr = 3 + i;
    if (!k || k.kind !== 'ok') { if (!row['Staff Code'] && (v(rr + ',' + codeC) || v(rr + ',' + emailC))) right = false; return; }
    if (!row['Staff Code'] && v(rr + ',' + codeC) !== (k.code || undefined)) right = false;
    if (!row['Staff Email'] && v(rr + ',' + emailC) !== (k.email || undefined)) right = false;
  });
  check(`[${layout}] every filled cell is the roster's locked code / confirmed email for that row's own teacher; no match/dup/unresolved cell is written`, right);
  check(`[${layout}] R35 no placeholder is ever written (no N/A on either tab)`, !/N\/A/i.test(t.cells(REG).replace(/[^]*/, m => m)) && !Object.values(regAfter).concat(Object.values(ntAfter)).some(x => /^n\/?a$/i.test(String(x))));
  check(`[${layout}] D11 Resource Person rows stay blank on both keys`, [5, 6].every(r => t.cell(NT, 3 + r, ntCode) === '' && t.cell(NT, 3 + r, ntEmail) === ''));
  check(`[${layout}] non-teaching: Admin row filled (also the one with a real Date cell), Support Q gets the code only`,
    t.cell(NT, 3, ntCode) === 'S0101' && t.cell(NT, 3, ntEmail) === 'admin.p@example.test' && t.cell(NT, 5, ntCode) === 'S0101' && t.cell(NT, 5, ntEmail) === 'admin.p@example.test' &&
    t.cell(NT, 6, ntCode) === 'W0201' && t.cell(NT, 6, ntEmail) === '' && t.cell(NT, 4, ntEmail) === 'admin.p@example.test');
  check(`[${layout}] the roster tab is never written`, t.cells(T) === teachBefore);
  const st = t.stats();
  check(`[${layout}] batched: contiguous blocks, not cells (here keys are interleaved with filled rows on purpose)`, st.setValues < (regChanged.length + ntChanged.length) / 3 && st.setValue <= 2, J(st));
  const bk = t.backups();
  check(`[${layout}] a backup was taken exactly once, BEFORE any write (Register and non-teaching still pristine at that moment)`, bk.length === 1 &&
    bk[0].regCells === J(regBefore) && bk[0].ntCells === J(ntBefore) && /backfill/.test(bk[0].why));
  const log = t.logRows().filter(l => l[2] === '(backfill)');
  const backupRow = log.find(l => l[3] === 'Backfill backup');
  check(`[${layout}] the Roster Log records the backup name and id first`, backupRow && backupRow[5] === 'Backup copy 1' && /id BKP-ID-1/.test(backupRow[6]) && log.indexOf(backupRow) === 0);
  const cellRows = log.filter(l => /^Backfill cells /.test(l[3]));
  const loggedCells = cellRows.reduce((n, l) => n + Number(/^(\d+) cell/.exec(l[5])[1]), 0);
  check(`[${layout}] the log lists the changed cells (row ranges per tab and column) and their total matches`, cellRows.length >= 3 && loggedCells === regChanged.length + ntChanged.length && cellRows.every(l => /^rows [\d,-]+;/.test(l[6])), J(cellRows.map(l => l.slice(3, 6))));
  check(`[${layout}] a summary line is logged (complete, counts)`, log.some(l => l[3] === 'Backfill summary' && /complete/.test(l[6])) && log.every(l => l[7] === 'Apply') && t.logRows().filter(l => l[7] === 'First set').length > 0);
  const rb = t.run('backfillRollbackInfo_()');
  check(`[${layout}] Backfill rollback info = backup reference + changed-cell count`, rb.backupName === 'Backup copy 1' && rb.backupId === 'BKP-ID-1' && rb.cells === loggedCells, J(rb));
  check(`[${layout}] the preview title now shows the rollback info`, /Backfill rollback info: backup "Backup copy 1"/.test(t.cell(PV, 1, 1)) && /Data as of/.test(t.cell(PV, 1, 1)));
  check(`[${layout}] every Will fill line has a Result`, t.pv().filter(p => p.Action === 'Will fill').every(p => /^Filled /.test(p.Result)));

  // idempotent: a second run, and a fresh preview + apply, change nothing at all
  const snap = t.snap();
  const r2 = t.apply();
  check(`[${layout}] a second Apply changes nothing (no write, no backup, no log) and reports 0`, t.snap() === snap && t.backups().length === 1 && r2.code === 0 && r2.email === 0 && r2.complete === true);
  const s2 = t.preview();
  check(`[${layout}] a fresh preview then shows 0 Will fill (§9 step 9 verify)`, s2.counts['Will fill'] === 0 && t.pv().every(p => p.Action !== 'Will fill'));
  const snap2 = JSON.stringify([t.cells(REG), t.cells(NT), t.cells(T), t.cells(LOG)]);
  const r3 = t.apply();
  check(`[${layout}] Apply after that preview is a no-op`, r3.code + r3.email === 0 && JSON.stringify([t.cells(REG), t.cells(NT), t.cells(T), t.cells(LOG)]) === snap2 && t.backups().length === 1);
}

/* ───────── resumable: two chunks equal one run ───────── */
{
  const one = fixture();
  one.run('ensureBackfillPreviewTab_()'); one.preview(); one.apply();

  const two = fixture();
  two.run('ensureBackfillPreviewTab_()'); two.preview();
  two.run('CHUNK = 40; STOP_AT_CHECK = 1');
  const part = two.apply();
  const mid = two.cellMap(REG);
  check('resume: the first run stops at the time limit with work left and says so', part.complete === false && part.remaining > 0 && part.code + part.email > 0, J(part));
  check('resume: the chunk written is a prefix only (not everything yet), and a backup exists already', diff(two.cellMap(REG), one.cellMap(REG)).length > 0 && two.backups().length === 1);
  check('resume: the log says the run stopped, with lines left', two.logRows().some(l => l[3] === 'Backfill summary' && /stopped at the time limit; \d+ line/.test(l[6])));
  two.run('STOP_AT_CHECK = -1');
  const fin = two.apply();
  check('resume: the second run completes', fin.complete === true && fin.remaining === 0);
  check('resume: Register and non-teaching cells equal a single full run', canon(two.cellMap(REG)) === canon(one.cellMap(REG)) && canon(two.cellMap(NT)) === canon(one.cellMap(NT)));
  check('resume: still exactly one backup (the resumed run reuses the recorded one)', two.backups().length === 1 && fin.backup && fin.backup.name === 'Backup copy 1');
  check('resume: rollback info totals both runs', two.run('backfillRollbackInfo_()').cells === one.run('backfillRollbackInfo_()').cells);
  const snap = two.snap();
  two.apply();
  check('resume: a third run changes nothing', two.snap() === snap);
  check('resume: nothing overwritten in the earlier chunk by the later one', Object.keys(mid).every(k => two.cellMap(REG)[k] === mid[k]));
}

/* ───────── stale / changed rows are refused with a reason ───────── */
{
  const t = fixture();
  t.run('ensureBackfillPreviewTab_()'); t.preview();
  const rows = t.pv();
  const lineOf = (teacher, pred) => rows.find(r => r.Tab === 'Absence Register' && r.Teacher === teacher && r.Action === 'Will fill' && (!pred || pred(r)));
  const A = lineOf('Staff A'), A2 = rows.filter(r => r.Tab === 'Absence Register' && r.Teacher === 'Staff A' && r.Action === 'Will fill')[1],
    B = lineOf('Staff B'), B2 = rows.filter(r => r.Tab === 'Absence Register' && r.Teacher === 'Staff B' && r.Action === 'Will fill')[1];
  const codeC = colOf(t, REG, 'Staff Code'), emailC = colOf(t, REG, 'Staff Email'), teacherC = colOf(t, REG, 'Teacher');
  // (a) the Teacher of one row was edited since the preview: identity gone
  t.run(`__book.sheets[SS.ABSENCE].cells["${A.Row}," + ${teacherC}] = "Staff B"`);
  // (b) somebody typed the code by hand into another Will fill row
  t.run(`__book.sheets[SS.ABSENCE].cells["${A2.Row}," + ${codeC}] = "HAND-TYPED"`);
  // (c) the roster email of Staff B changed after the preview (Staff B's code line must still fill? email was not proposed, so it does)
  // (d) Staff C's confirmed email on the roster is withdrawn: its email line is stale
  const C = rows.find(r => r.Tab === 'Absence Register' && r.Teacher === 'Staff C' && r.Action === 'Will fill');
  t.run(`__put(SS.ROSTER, 2, 5, [{ "Match Status": "Needs review" }]); clearRosterCache_();`);
  const rBefore = t.cellMap(REG);
  const res = t.apply();
  const after = t.cellMap(REG), pv = t.pv();
  const resOf = r => pv.find(p => p._row === r._row).Result;
  check('stale: a row whose identity changed is refused (not found), and its cells stay blank', /^Refused: row not found/.test(resOf(A)) && after[`${A.Row},${codeC}`] == null && after[`${A.Row},${emailC}`] == null);
  check('stale: a cell filled by hand meanwhile is never overwritten (Skipped: already filled)', after[`${A2.Row},${codeC}`] === 'HAND-TYPED' && /already filled/.test(resOf(A2)) && after[`${A2.Row},${emailC}`] != null);
  check('stale: a roster change since the preview refuses the line (email withdrawn)', /^Refused: roster changed/.test(resOf(C)) && after[`${C.Row},${emailC}`] == null);
  check('stale: unaffected lines still fill', after[`${B.Row},${codeC}`] === 'S0002' && /^Filled/.test(resOf(B)) && res.refused >= 2);
  check('stale: refusals are counted in the result', res.refused >= 2, J(res));
  check('stale: the summary log line records the refusals', t.logRows().some(l => l[3] === 'Backfill summary' && /refused [1-9]/.test(l[6])));
  check('stale: only blank cells changed', diff(rBefore, after).every(k => rBefore[k] == null));
}
{ // rows moved (two rows inserted above): matched by identity, not by row number
  const t = fixture({ rows: 60 });
  t.run('ensureBackfillPreviewTab_()'); t.preview();
  const first = t.pv().find(p => p.Tab === 'Absence Register' && p.Action === 'Will fill');
  t.run(`(function () { var c = __book.sheets[SS.ABSENCE].cells, m = {};
    Object.keys(c).forEach(function (k) { var p = k.split(','), r = +p[0]; m[(r >= 3 ? r + 2 : r) + ',' + p[1]] = c[k]; });
    Object.keys(c).forEach(function (k) { delete c[k]; }); Object.keys(m).forEach(function (k) { c[k] = m[k]; });
    __book.sheets[SS.ABSENCE].maxRows += 5; })()`);
  const codeC = colOf(t, REG, 'Staff Code'), runC = colOf(t, REG, 'Run ID');
  t.apply();
  const run = first['Run ID (Register only)'];
  const live = [...Array(70).keys()].map(i => i + 1).find(r => t.cell(REG, r, runC) === run);
  check('moved rows: the line is applied to the row now carrying its (Date, Teacher, Run ID), not the old row number', live === first.Row + 2 && (t.cell(REG, live, codeC) !== '' || t.cell(REG, live, colOf(t, REG, 'Staff Email')) !== ''));
  check('moved rows: every row ended with exactly its own teacher\'s keys (or what it already held)', (() => {
    const teacherC = colOf(t, REG, 'Teacher'), emailC = colOf(t, REG, 'Staff Email');
    for (let i = 0; i < 60; i++) {
      const row = t.data[i], r = 5 + i, k = KEYS[row.Teacher];
      const wantCode = row['Staff Code'] || (k && k.kind === 'ok' ? k.code : '');
      const wantEmail = row['Staff Email'] || (k && k.kind === 'ok' ? k.email : '');
      if (t.cell(REG, r, teacherC) !== row.Teacher || t.cell(REG, r, codeC) !== wantCode || t.cell(REG, r, emailC) !== wantEmail) return false;
    }
    return true;
  })());
  // a duplicated identity AND a moved row: refused, never guessed
  const u = fixture({ rows: 60 });
  u.run('ensureBackfillPreviewTab_()'); u.preview();
  const f2 = u.pv().find(p => p.Tab === 'Absence Register' && p.Action === 'Will fill');
  const runC2 = colOf(u, REG, 'Run ID'), codeC2 = colOf(u, REG, 'Staff Code'), dateC = colOf(u, REG, 'Date'), tC = colOf(u, REG, 'Teacher');
  u.run(`(function () { var c = __book.sheets[SS.ABSENCE].cells, m = {};
    Object.keys(c).forEach(function (k) { var p = k.split(','), r = +p[0]; m[(r >= 3 ? r + 2 : r) + ',' + p[1]] = c[k]; });
    Object.keys(c).forEach(function (k) { delete c[k]; }); Object.keys(m).forEach(function (k) { c[k] = m[k]; });
    var s = __book.sheets[SS.ABSENCE]; s.maxRows += 5;
    // a second row (row 1000-ish free slot) with the same identity
    var src = ${f2.Row + 2}, dst = 66;
    for (var col = 1; col <= 18; col++) if (c[src + ',' + col] != null) c[dst + ',' + col] = c[src + ',' + col]; })()`);
  u.apply();
  check('duplicate identity after a move: the line is refused (row not unique) and neither copy is written', /^Refused: row not unique/.test(u.pv().find(p => p._row === f2._row).Result) &&
    u.cell(REG, f2.Row + 2, codeC2) === '' && u.cell(REG, 66, codeC2) === '');
}
{ // a hand-edited preview can never widen what is written
  const t = fixture({ rows: 30 });
  t.run('ensureBackfillPreviewTab_()'); t.preview();
  const rows = t.pv();
  const nameOnly = rows.find(r => r.Action === 'Name only'), dup = rows.find(r => r.Action === 'Duplicate name');
  const cols = h => t.run('BACKFILL_PREVIEW_HEADERS').indexOf(h) + 1;
  [nameOnly, dup].forEach(r => {
    t.run(`__book.sheets[SS.BACKFILL_PREVIEW].cells["${r._row}," + ${cols('Action')}] = "Will fill"`);
    t.run(`__book.sheets[SS.BACKFILL_PREVIEW].cells["${r._row}," + ${cols('Code Action')}] = "Will fill"`);
    t.run(`__book.sheets[SS.BACKFILL_PREVIEW].cells["${r._row}," + ${cols('Proposed Staff Code')}] = "S9999"`);
  });
  const ntCode = colOf(t, NT, 'Staff Code'), regCode = colOf(t, REG, 'Staff Code');
  t.apply();
  const pv = t.pv();
  check('tampered preview: a Resource Person / duplicate-name line set to Will fill with a made-up code is refused and writes nothing',
    pv.filter(p => p._row === nameOnly._row || p._row === dup._row).every(p => /^Refused: roster changed/.test(p.Result)) &&
    t.cell(nameOnly.Tab === 'Non-Teaching Absence' ? NT : REG, nameOnly.Row, nameOnly.Tab === 'Non-Teaching Absence' ? ntCode : regCode) === '' &&
    !t.cells(REG).includes('S9999') && !t.cells(NT).includes('S9999'));
}

/* ───────── no preview / old preview / failure before the first write ───────── */
{
  const t = fixture({ rows: 40 });
  t.run('ensureBackfillPreviewTab_()');
  const before = t.snap();
  const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
  check('Apply with no preview refuses and writes nothing', /Preview backfill first/.test(err(() => t.apply())) && t.snap() === before && t.backups().length === 0);
  t.preview();
  const snapPv = t.snap();
  t.run(`__book.sheets[SS.BACKFILL_PREVIEW].cells["1,1"] = __book.sheets[SS.BACKFILL_PREVIEW].cells["1,1"].replace(/Data as of \\d{4}-\\d\\d-\\d\\d/, "Data as of 2020-01-01")`);
  const stale = t.snap();
  check('R21 a preview older than 24 h is refused; nothing written, no backup', /more than 24 hours old/.test(err(() => t.apply())) && t.snap() === stale && t.backups().length === 0 && snapPv !== '');
}
{
  const mk = () => { const t = fixture({ rows: 60 }); t.run('ensureBackfillPreviewTab_()'); t.preview(); return t; };
  const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
  let t = mk(), before = t.snap();
  t.run(`__book.sheets[SS.NON_TEACHING].cells["2,6"] = "Staff Email (renamed)"`);   // Staff Email header gone on the 2nd tab
  before = t.snap();
  let m = err(() => t.apply());
  check('validation: a missing header on the SECOND tab is found before the Register is written; nothing changes, no backup, no log', /Staff Email/.test(m) && t.snap() === before && t.backups().length === 0, m);

  t = mk();
  t.run(`__book.sheets[SS.BACKFILL_PREVIEW].cells["2,13"] = "Outcome"`);   // Result header missing
  before = t.snap();
  m = err(() => t.apply());
  check('validation: the preview must still have its Result header', /Result/.test(m) && t.snap() === before && t.backups().length === 0, m);

  t = mk();
  t.run(`delete __book.sheets[SS.ROSTER_LOG].cells["2,5"]`);   // the log lost its Old header
  before = t.snap();
  m = err(() => t.apply());
  check('validation: the Roster Log headers are checked before any write', /Old/.test(m) && t.snap() === before && t.backups().length === 0, m);

  t = mk();
  t.run('__ss.deleteSheet(sheet_(SS.NON_TEACHING))');
  before = t.snap();
  m = err(() => t.apply());
  check('validation: a missing tab is a clear error and writes nothing', /Non-Teaching Absence tab is missing/.test(m) && t.snap() === before && t.backups().length === 0, m);

  t = mk();
  t.run('BACKUP_FAILS = true');
  before = t.snap();
  m = err(() => t.apply());
  check('a backup that cannot be saved stops the run before any write or log entry', /backup could not be saved/.test(m) && t.snap() === before, m);

  t = mk();
  t.run('(function(){ var c = __book.sheets[SS.ROSTER].cells; for (var k in c) delete c[k]; })(); clearRosterCache_(); clearCache()');
  const regBefore = t.cells(REG);
  const res = t.apply();
  check('a roster that vanished since the preview: every line is refused, no key is guessed, no backup (nothing to write)', res.code + res.email === 0 && res.refused > 0 &&
    t.cells(REG) === regBefore && t.backups().length === 0, J(res));
}

/* ───────── the real shape: historical rows all blank -> a handful of writes ───────── */
{
  const t = fixture({ clean: true, rows: 300 });
  t.run('ensureBackfillPreviewTab_()'); t.preview(); t.run('__resetStats()');
  const r = t.apply();
  const st = t.stats();
  check('batched: 300 blank historical rows + the other tab are filled with a handful of setValues, not per cell', r.code + r.email > 200 && st.setValues <= 12 && st.setValue <= 2, J({ st, r }));
}

/* ───────── menus, N5, PII ───────── */
{
  const all = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const ctx = load(all, MOCK);
  ctx.run('onOpen()');
  const items = ctx.run('__ui.items');
  const fns = ['previewStaffKeyBackfill', 'applyStaffKeyBackfill', 'showBackfillRollbackInfo'];
  check('the Roster menu carries Preview backfill, Apply backfill and rollback info, all defined', fns.every(f => items.some(i => i.fn === f) && ctx.run(`typeof ${f}`) === 'function'));
  check('every menu handler is defined', items.every(i => ctx.run(`typeof ${i.fn}`) === 'function'));
  const decl = {};
  all.forEach(f => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm) || [])
    .forEach(m => { const n = m.replace(/^(function|const|let|var)\s+/, ''); (decl[n] = decl[n] || []).push(f); }));
  const dups = Object.keys(decl).filter(n => decl[n].length > 1);
  check('no duplicate top-level name across the root *.js files', dups.length === 0, J(dups));
}
{
  const t = fixture({ layout: 'shuffled' });
  t.run('ensureBackfillPreviewTab_()');
  t.run('previewStaffKeyBackfill()');
  check('menu Preview: tells the user what it found and that nothing was changed', t.alerts().some(a => /Backfill preview ready/.test(a.title) && /Nothing has been changed/.test(a.body) && /Will fill: \d+/.test(a.body)));
  t.run('__ui.answer = "NO"');
  const snap = t.snap();
  t.run('applyStaffKeyBackfill()');
  check('menu Apply: answering No changes nothing', t.snap() === snap && t.backups().length === 0);
  t.run('__ui.answer = "YES"; applyStaffKeyBackfill()');
  check('menu Apply: Yes applies and reports counts and the backup', t.alerts().some(a => /Backfill applied/.test(a.title) && /Backup: Backup copy 1/.test(a.body)) && t.backups().length === 1);
  t.run('showBackfillRollbackInfo()');
  check('menu rollback info shows the backup and the changed-cell count', t.alerts().some(a => /rollback/i.test(a.title) && /Backup copy 1/.test(a.body) && /Cells changed since: [1-9]/.test(a.body)));

  // PII: only names, codes, emails, row refs and counts appear in anything the backfill writes
  const pvText = t.cells(PV), logText = t.cells(LOG);
  check('PII: no sentinel from Notes / Department / Extra columns reaches the preview or the log', !pvText.includes(SENT) && !logText.includes(SENT) &&
    !t.alerts().some(a => (a.title + a.body).includes(SENT)));
  check('PII: nothing from Marked By or Periods Away reaches the preview or the log', !/marker\.one|All day/.test(pvText + logText));
  const logRows = t.logRows().filter(l => l[2] === '(backfill)');
  check('PII: backfill log rows hold only counts, row ranges and the backup reference (no name, code or email)', logRows.length >= 3 &&
    logRows.every(l => !/@|S0\d{3}|W0\d{3}/.test([l[3], l[4], l[5], l[6]].join('|').replace(/preview \d{4}-\d\d-\d\d \d\d:\d\d/, ''))));
  check('no secrets: the new tests and code carry only example.test addresses', ['Backfill.js', 'test/backfill.test.js'].every(f =>
    (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).every(a => /@example\.test$/.test(a))));
}
{ // N5: a failing entry point tells the user and pings Ops with the class only
  const t = fixture({ rows: 5 });   // the tab is deliberately missing
  t.run('previewStaffKeyBackfill()');
  check('N5 a failing Preview alerts plainly and notifies Ops with the error class only', t.alerts().some(a => /Could not preview the backfill/.test(a.title)) &&
    t.run('__ops').length === 1 && t.run('__ops')[0][1] === 'Error' && /Backfill|backfill/.test(t.run('__ops')[0][0]));
  t.run('__ui.answer = "YES"; applyStaffKeyBackfill()');
  check('N5 a failing Apply (tab missing) also alerts and writes nothing', t.run('__ops').length === 2 && t.backups().length === 0);
}
{ // static: the apply path never writes anything but the two key columns, the preview Result and the log
  const src = fs.readFileSync(path.join(ROOT, 'Backfill.js'), 'utf8');
  check('no per-cell write: Backfill.js never calls setValue( or setFormula', !/\.setValue\(|\.setFormula|\.clear\(|\.deleteRows|\.deleteColumns|appendRow/.test(src));
  check('no clasp, trigger or network use', !/UrlFetchApp|ScriptApp|MailApp|ChatApp/.test(src));
  check('R25 the engine, Log, report and analytics files still never mention the tab', ['Assign.js', 'Log.js', 'Reports.js', 'ReportData.js', 'Analytics.js', 'Dashboard.js', 'Chat.js', 'Code.js']
    .every(f => !/Non-Teaching|NON_TEACHING/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
}
