/**
 * T-011: roster tabs, Allotment sync, Active, Staff Code lock, cache, Check roster.
 * Spec: docs/PRD-roster.md R1-R6 (+ D3, D10, D11). Placeholder data only: the repo is public.
 */
const fs = require('fs');
const path = require('path');
const { load, DEFAULT_FILES, ROOT } = require('./harness');
const { MOCK } = require('./sheetmock');

const FILES = DEFAULT_FILES.concat(['Reports.js', 'ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'AnalyticsTab.js',
  'HR.js', 'Setup.js', 'MarkAbsenceTab.js', 'Code.js', 'RosterTabs.js', 'Roster.js']);

const J = JSON.stringify;
const eq = (a, b) => J(a) === J(b);

/** A fresh vm with the mock, a placeholder Allotment, and the roster tabs built. */
function fresh(opts) {
  opts = opts || {};
  const allot = opts.allot || ['Staff A', 'Staff C', 'Staff D'];
  const meta = opts.meta || { 'Staff A': { department: 'Maths', team: 'High School' }, 'Staff C': { department: 'Science', team: 'High School' },
    'Staff D': { department: 'Arts', team: 'Middle School' }, 'Staff E': { department: 'Maths', team: 'Middle School' } };
  const over = `
    var ALLOT = ${J(allot)}, META = ${J(meta)}, ALLOT_FAILS = false;
    function getAllTeachers() { if (ALLOT_FAILS) throw new Error('source not connected'); return ALLOT.slice(); }
    function getTeacherMeta() { return META; }
    function getConfig() { return defaultConfig_(); }
    var __ops = [];
    function notifyOpsFailure_(what, msg) { __ops.push([what, msg]); }
    function toast_() {}
  `;
  const ctx = load(FILES, MOCK + over);
  const run = ctx.run;
  const api = { ctx, run };
  api.build = () => run('ensureRosterTabs_()');
  api.put = (tab, headerRow, startRow, rows) => run(`__put(${J(tab)}, ${headerRow}, ${startRow}, ${J(rows)})`);
  api.roster = rows => api.put('🪪 Teachers', 2, 3, rows);
  api.hr = emails => {
    run(`(function(){ var sh = __ss.insertSheet(SS.IMPORT_HR); })()`);
    api.put('👥 importHR', 2, 2, [{ 'Teacher Name': '', Email: '' }]);
  };
  api.snap = tabs => run(`__snapshot(${J(tabs || null)})`);
  api.cell = (tab, r, c) => run(`__cell(${J(tab)}, ${r}, ${c})`);
  api.rows = () => { run('clearRosterCache_()'); return run('readRosterRows_()').rows; };
  api.stats = () => run('({ setValues: __stats.setValues, setValue: __stats.setValue, cells: __stats.cells })');
  api.resetStats = () => run('__resetStats()');
  api.alerts = () => run('__ui.alerts');
  api.logRows = () => {
    const n = run('sheet_(SS.ROSTER_LOG).getLastRow()');
    const out = [];
    for (let r = 3; r <= n; r++) out.push(ROSTER_LOG_COLS.map((h, i) => api.cell('🪪 Roster Log', r, i + 1)));
    return out;
  };
  if (!opts.nobuild) api.build();
  return api;
}
const ROSTER_LOG_COLS = ['Timestamp', 'User', 'Display Name', 'Field', 'Old', 'New', 'Reason', 'Source'];
const T = '🪪 Teachers', SET = '🧭 Roster Settings', PREV = '🧾 Sync Preview', LOG = '🪪 Roster Log';
const row = (name, o) => Object.assign({ 'Display Name': name, Category: 'Teaching', Active: true }, o || {});
const throws = fn => { try { fn(); return false; } catch (e) { return true; } };

/* ───────── R1: builders ───────── */
{
  const t = fresh();
  const names = t.run('__book.order');
  check('R1 builds the roster tabs (the four of T-011, then 🪪 Roster Review from T-013)', eq(names, [SET, T, PREV, LOG, '🪪 Roster Review']), J(names));
  check('tab-name constants are the frozen names',
    t.run('SS.ROSTER') === T && t.run('SS.ROSTER_SETTINGS') === SET && t.run('SS.SYNC_PREVIEW') === PREV && t.run('SS.ROSTER_LOG') === LOG);
  check('roster tab names do not clash with any other tab constant',
    t.run('Object.keys(SS).length === Object.keys(SS).map(function(k){return SS[k]}).filter(function(v,i,a){return a.indexOf(v)===i}).length'));
  check('🪪 Teachers headers are the 15 frozen headers in order',
    eq([...Array(15).keys()].map(i => t.cell(T, 2, i + 1)), t.run('ROSTER_HEADERS')) && t.run('ROSTER_HEADERS.length') === 15);
  check('Staff Code (Locked) is hidden; the hidden preview and log tabs are hidden when unused; the roster is not',
    eq(t.run('__book.sheets[SS.ROSTER].hiddenCols'), [15]) && t.run('__book.sheets[SS.SYNC_PREVIEW].hidden') &&
    t.run('__book.sheets[SS.ROSTER_LOG].hidden') && !t.run('__book.sheets[SS.ROSTER].hidden'));
  check('frozen headers on every roster tab', ['ROSTER', 'ROSTER_SETTINGS', 'SYNC_PREVIEW', 'ROSTER_LOG']
    .every((k, i) => t.run(`__book.sheets[SS.${k}].frozenRows`) === (k === 'ROSTER_SETTINGS' ? 1 : 2)));
  check('Display Name, Staff Code and the code-owned columns are warning-only protected',
    t.run('__book.sheets[SS.ROSTER].prot.length') === 7 && t.run('__book.sheets[SS.ROSTER].prot.every(function(p){return p.warn})'));
  check('status colours are conditional formats; missing, duplicate, changed Staff Code are covered',
    t.run('__book.sheets[SS.ROSTER].cf.length') === 7);
  check('Active is a checkbox and Staff Code is plain text',
    t.run('__book.sheets[SS.ROSTER].validations.some(function(v){return v.c===4 && v.v.kind==="requireCheckbox"})') &&
    t.run('__book.sheets[SS.ROSTER].formats.some(function(f){return f.c===2 && f.f==="@"})'));
  check('the roster Log source column is a list of the five sources',
    eq(t.run('__book.sheets[SS.ROSTER_LOG].validations.filter(function(v){return v.c===8})[0].v.list'), ['Sync', 'Apply', 'HR Database', 'Correction', 'First set']));
}

/* builders are idempotent and keep entered rows */
{
  const t = fresh();
  t.roster([row('Staff A', { Notes: 'SENTINEL-NOTE', 'Staff Code': 'S0001' })]);
  t.put(PREV, 2, 3, [{ 'Display Name': 'Staff A', Change: 'Add', Decision: 'Skip' }]);
  t.put(LOG, 2, 3, [{ Field: 'SENTINEL-LOG' }]);
  check('R1 a second ensureRosterTabs_ creates nothing', eq(t.build(), []));
  t.run('__book.sheets[SS.SYNC_PREVIEW].hidden = false; __book.sheets[SS.ROSTER_LOG].hidden = false;');
  const before2 = t.snap();
  t.run('writeSyncPreviewTab_(); writeRosterLogTab_(); writeRosterTab_(); writeRosterSettingsTab_();');
  check('re-running every builder changes no cell, protection, colour rule or validation', t.snap() === before2);
  check('a tab in use is not hidden by a builder re-run', !t.run('__book.sheets[SS.SYNC_PREVIEW].hidden') && !t.run('__book.sheets[SS.ROSTER_LOG].hidden'));
  check('a builder re-run keeps the entered roster row', t.cell(T, 3, 14) === 'SENTINEL-NOTE' && t.cell(T, 3, 2) === 'S0001');
}

/* ───────── 🧭 Roster Settings ───────── */
{
  const t = fresh();
  const S = t.run('readRosterSettings_()');
  check('Categories are seeded with a Join key column', eq(S.categories.map(c => [c.name, c.teaching, c.joinKey, c.emailRequired]), [
    ['Teaching', true, 'Staff Code', true], ['Admin', false, 'Staff Code', true],
    ['Support Staff', false, 'Staff Code', false], ['Resource Person', false, 'Name only', false]]), J(S.categories));
  check('the Categories header names the Join key column', t.cell(SET, 4, 3) === 'Join key (Staff Code / Name only)');
  check('Staff Code pattern defaults to ^[SW]0[0-9]{3}$', S.hrSource.staffCodePattern === '^[SW]0[0-9]{3}$');
  check('HR source defaults: tab CurrentStaff, header row 1, filter Current, no workbook ID',
    S.hrSource.tab === 'CurrentStaff' && S.hrSource.headerRow === 1 && eq(S.hrSource.statusFilter, ['Current']) && S.hrSource.workbookId === '');
  check('HR_DB_FIELDS is a frozen list of the 7 whitelisted fields',
    t.run('Object.isFrozen(HR_DB_FIELDS) && HR_DB_FIELDS.every(Object.isFrozen)') &&
    eq(t.run('HR_DB_FIELDS.map(function(f){return f.field})'),
      ['status', 'name', 'category', 'teamRole', 'department', 'staffCode', 'officialEmail']));
  check('HR header names are generated from HR_DB_FIELDS',
    eq(S.hrHeaders, { status: 'Status', name: 'Name of the Staff', category: 'Category', teamRole: 'Team / Role', department: 'Department',
      staffCode: 'Staff Code', officialEmail: 'Official email ID' }), J(S.hrHeaders));
  check('HR Category mapping is seeded', eq(S.hrCategoryMap.map(m => m.hrCategory + '>' + m.rosterCategory),
    ['Teaching staff>Teaching', 'Administrative staff>Admin', 'Support staff>Support Staff', 'Resource Person>Resource Person']));
  check('placeholder list is seeded (blank is implicit)', eq(S.placeholders, ['n/a', 'na', 'n/a', '-', 'none', 'nil', 'tbd']));
  check('exclusions and honorifics are seeded for the matching engine', S.exclusions.length === 8 &&
    S.exclusions.some(e => e.type === 'Honorific' && /Mr/.test(e.value)));

  const ph = (v) => t.run(`isPlaceholder_(${J(v)}, readRosterSettings_().placeholders)`);
  check('placeholders: blank, N/A, n/a, NA, -, none, nil, TBD all mean no value',
    ['', '  ', 'N/A', 'n/a', ' NA ', '-', 'None', 'nil', 'TBD'].every(ph));
  check('a real code is not a placeholder', !ph('S0001'));

  // a typed edit is never overwritten; a missing section is appended without touching the rest
  const colA = t.run('(function(){var o=[];var sh=__book.sheets[SS.ROSTER_SETTINGS];for(var r=1;r<=sh.getLastRow();r++)o.push(sh.cells[r+",1"]);return o;})()');
  const patRow = colA.indexOf('Staff Code Pattern') + 1;
  const srcHeader = colA.indexOf('▸ HR Database source') + 2;
  t.run(`__put(SS.ROSTER_SETTINGS, ${srcHeader}, ${patRow}, [{ Value: '^X[0-9]$' }])`);
  check('a user edit to the pattern is read back', t.run('readRosterSettings_().hrSource.staffCodePattern') === '^X[0-9]$' ||
    (t.run('clearRosterCache_()'), t.run('readRosterSettings_().hrSource.staffCodePattern') === '^X[0-9]$'));
  const bandRow = colA.indexOf('▸ Placeholder values') + 1;
  const lastBefore = t.run('sheet_(SS.ROSTER_SETTINGS).getLastRow()');
  t.run(`__book.sheets[SS.ROSTER_SETTINGS].cells["${bandRow},1"] = '▸ renamed'`);
  t.run('writeRosterSettingsTab_()');
  check('a missing section is re-appended at the bottom, leaving every other section alone',
    t.run('sheet_(SS.ROSTER_SETTINGS).getLastRow()') > lastBefore && t.cell(SET, patRow, 2) === '^X[0-9]$' && t.cell(SET, bandRow, 1) === '▸ renamed');

  t.run('clearRosterCache_()');
  t.run(`__put(SS.ROSTER_SETTINGS, ${srcHeader}, ${patRow}, [{ Value: '([' }])`);
  const S2 = t.run('readRosterSettings_()');
  check('an invalid pattern falls back to the default and is reported',
    S2.hrSource.staffCodePattern === '^[SW]0[0-9]{3}$' && S2.problems.some(p => /Pattern/i.test(p)));
}

/* an HR header row typed by hand for a non-whitelisted field is ignored and reported */
{
  const t = fresh();
  const colA = t.run('(function(){var o=[];var sh=__book.sheets[SS.ROSTER_SETTINGS];for(var r=1;r<=sh.getLastRow();r++)o.push(sh.cells[r+",1"]);return o;})()');
  const band = colA.indexOf('▸ HR Database headers') + 1;
  t.run(`__put(SS.ROSTER_SETTINGS, ${band + 1}, ${band + 2 + 7}, [{ Field: 'mobile', 'Header Name': 'Mobile Number' }])`);
  t.run('clearRosterCache_()');
  const S = t.run('readRosterSettings_()');
  check('an extra HR field typed on Settings is ignored (the whitelist is fixed by code)',
    !('mobile' in S.hrHeaders) && eq(S.ignoredHrFields, ['mobile']) && Object.keys(S.hrHeaders).length === 7);
  const res = t.run('computeRosterCheck_({rows:[],settings:readRosterSettings_(),allotment:null,directory:null,loggedAdds:null})');
  check('Check roster reports the ignored HR field', res.findings.some(f => f.kind === 'hr-field-ignored'));
}

/* ───────── reading by header name, defaults and placeholders ───────── */
{
  const t = fresh();
  // shuffle: swap the Email and Notes header positions on the sheet
  t.run(`(function(){var c=__book.sheets[SS.ROSTER].cells; var e=c["2,5"], n=c["2,14"]; c["2,5"]=n; c["2,14"]=e;})()`);
  t.roster([row('Staff A', { Notes: 'a note', Email: 'x@example.test' })]);
  // after the swap, the header 'Email' lives in column 14 and 'Notes' in column 5; __put follows the headers
  const r = t.rows()[0];
  check('columns are located by header name, not position', r.email === 'x@example.test' && r.notes === 'a note', J(r));
}
{
  const t = fresh();
  t.roster([
    row('Staff A', { Active: '', Email: ' Staff.A@Example.Test ', 'Staff Code': 's0001', 'Staff Code (Locked)': 'S0001' }),
    row('Staff B', { Active: false, 'Staff Code': 'N/A', Email: 'n/a' }),
    row('Staff C', { Active: 'FALSE' }),
    { 'Display Name': 'Consultant R', Category: 'Resource Person', 'Staff Code': 'TBD' },
  ]);
  const rows = t.rows();
  check('a blank Active means TRUE (fail open); an unticked one is FALSE', rows[0].active === true && rows[1].active === false && rows[2].active === false);
  check('email is trimmed and lower-cased; code is trimmed and upper-cased', rows[0].email === 'staff.a@example.test' && rows[0].staffCode === 'S0001');
  check('a hand-typed placeholder in Staff Code or Email reads as blank', rows[1].staffCode === '' && rows[1].email === '' && rows[1].staffCodeRaw === 'N/A');
}

/* ───────── cache ───────── */
{
  const t = fresh();
  t.roster([row('Staff A', { Notes: 'v1' })]);
  const a = t.run('getRoster_()');
  check('getRoster_ reads the tab', a.rows.length === 1 && a.rows[0].notes === 'v1');
  const put = t.run('__cache.puts');
  check('getRoster_ caches under roster:v1 for 300 seconds', put.length === 1 && put[0].k === 'roster:v1' && put[0].ttl === 300);
  t.roster([row('Staff A', { Notes: 'v2' })]);
  t.run('clearCache()');   // a new execution
  check('within the TTL a new execution is served from CacheService', t.run('getRoster_().rows[0].notes') === 'v1');
  t.run('clearRosterCache_()');
  check('clearRosterCache_ makes the next read fresh', t.run('getRoster_().rows[0].notes') === 'v2');
  t.run('__cache.throwing = true; clearCache();');
  t.roster([row('Staff A', { Notes: 'v3' })]);
  check('fail-soft: a throwing cache falls back to reading the tab', t.run('getRoster_().rows[0].notes') === 'v3');
  check('fail-soft: clearing a throwing cache does not throw', !throws(() => t.run('clearRosterCache_()')));
  t.run('__cache.throwing = false; clearRosterCache_();');
  t.roster([row('Staff A', { Notes: 'x'.repeat(95 * 1024) })]);
  t.run('__cache.puts = []; clearCache();');
  t.run('getRoster_()');
  check('an entry over 90 KB is not cached', t.run('__cache.puts.length') === 0);
}

/* ───────── R2/R3: the sync ───────── */
function syncFixture() {
  const t = fresh({ allot: ['Staff A', 'Staff C', 'Staff D', 'Staff E'] });
  t.run(`__ss.insertSheet(SS.IMPORT_HR)`);
  t.put('👥 importHR', 0, 0, []);   // no-op, keeps API symmetrical
  t.run(`(function(){var c=__book.sheets[SS.IMPORT_HR].cells; c["2,1"]='Teacher Name'; c["2,2"]='Email'; c["2,3"]='Chat User ID (users/123…)';
    c["3,1"]='Someone'; c["3,2"]='staff.a@example.test'; c["4,1"]='Other'; c["4,2"]='staff.c@example.test';})()`);
  t.roster([
    row('Staff A', { Email: 'staff.a@example.test', 'Match Status': 'Confirmed', Notes: 'keep-me', Department: 'Old', Team: 'Old', 'Left On': '', 'Replaced By': 'Staff C' }),
    row('Staff B', { Email: 'staff.b@example.test', Notes: 'gone', 'Staff Code': 'S0002', 'Staff Code (Locked)': 'S0002' }),       // removed from the Allotment, email also gone
    row('Staff  C', { Email: 'staff.c@example.test', Notes: 'edited' }),                                                              // edited spelling of "Staff C"
    row('Staff E', { Email: 'staff.e@example.test', 'Match Status': 'Confirmed', Department: 'Maths', Team: 'Middle School' }),      // in the Allotment; email missing from the directory
    { 'Display Name': 'Admin P', Category: 'Admin', Active: true, Department: 'Office' },
    { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
  ]);
  return t;
}
{
  const t = syncFixture();
  const before = t.snap([T, SET, LOG]);
  const plan = t.run('previewRosterSync_()');
  const by = c => plan.changes.filter(x => x.change === c).map(x => x.name);
  check('R2 one new, one removed, one edited name give +1 Add, 1 deactivation proposal, 1 probable edit',
    eq(by('Add'), ['Staff D']) && eq(by('Not in Allotment'), ['Staff B']) && eq(by('Probable edited Display Name'), ['Staff  C']), J(plan.changes));
  check('the edited name is not also proposed as an Add or a deactivation', !by('Add').includes('Staff C') && !by('Not in Allotment').includes('Staff  C'));
  check('non-teaching rows are never proposed for deactivation or addition',
    !plan.changes.some(c => /Admin P|Consultant R/.test(c.name)));
  check('R3 an email missing from importHR on a teacher still in the Allotment is information only',
    eq(by('Email not in directory'), ['Staff E']) &&
    plan.changes.filter(c => c.change === 'Email not in directory').every(c => c.decision === '—' && c.proposed === 'No change'));
  check('the removed row is pre-ticked Apply and names its evidence', plan.changes.find(c => c.name === 'Staff B').decision === 'Apply' &&
    /No longer in the Allotment/.test(plan.changes.find(c => c.name === 'Staff B').evidence));
  check('information and edit rows are never pre-ticked', plan.changes.filter(c => c.decision !== 'Apply').length === 2);
  check('Preview writes only 🧾 Sync Preview', t.snap([T, SET, LOG]) === before);
  check('Preview shows the tab, with a Data as of time', !t.run('__book.sheets[SS.SYNC_PREVIEW].hidden') && /Data as of \d{4}-\d\d-\d\d \d\d:\d\d/.test(t.cell(PREV, 1, 1)));
  check('Preview rows: Display Name, Change, Evidence, Proposed, Decision', t.cell(PREV, 3, 1) === 'Staff D' && t.cell(PREV, 3, 2) === 'Add' && t.cell(PREV, 3, 5) === 'Apply');

  const a = t.snap([PREV]);
  t.run('previewRosterSync_()');
  check('Preview is idempotent', t.snap([PREV]).replace(/Data as of [^"]*/, '') === a.replace(/Data as of [^"]*/, ''));
  // a decision the user changed survives a re-preview
  t.put(PREV, 2, 4, [{ Decision: 'Skip' }]);
  t.run('previewRosterSync_()');
  check('a decision the user changed is kept on re-preview', t.cell(PREV, 4, 5) === 'Skip');
  t.put(PREV, 2, 4, [{ Decision: 'Apply' }]);
}

{
  const t = syncFixture();
  t.run('previewRosterSync_()');
  const before = t.rows();
  const human = r => [r.name, r.staffCode, r.category, r.email, r.matchStatus, r.leftOn, r.replacedBy, r.confirmedBy, r.confirmedOn, r.notes].join('|');
  const humanBefore = before.map(human);
  const res = t.run('applyRosterSync_()');
  const after = t.rows();
  check('R2 Apply adds one row, deactivates one, and reports it', res.added === 1 && res.deactivated === 1, J(res));
  check('Apply never deletes or reorders a row', after.length === before.length + 1 && eq(after.slice(0, before.length).map(r => r.name), before.map(r => r.name)));
  check('every human-owned cell on the existing rows is unchanged', eq(after.slice(0, before.length).map(human), humanBefore));
  check('only the accepted Not in Allotment row got Active = FALSE',
    eq(after.filter(r => !r.active).map(r => r.name), ['Staff B']));
  check('an information-only email signal did not touch Active (R3)', after.find(r => r.name === 'Staff E').active === true);
  const added = after.find(r => r.name === 'Staff D');
  check('the new row is a Teaching row: Active, Unreviewed, no code or email, Allotment mirror, In Allotment TRUE',
    added.category === 'Teaching' && added.active && added.matchStatus === 'Unreviewed' && added.staffCode === '' && added.email === '' &&
    added.department === 'Arts' && added.team === 'Middle School' && added.inAllotment === true, J(added));
  check('the edited-name row was not touched', after.find(r => r.name === 'Staff  C').notes === 'edited' && after.find(r => r.name === 'Staff  C').active);
  check('derived columns refreshed: Department and Team mirror the Allotment on Teaching rows only',
    after.find(r => r.name === 'Staff A').department === 'Maths' && after.find(r => r.name === 'Staff A').team === 'High School' &&
    after.find(r => r.name === 'Admin P').department === 'Office');
  check('In Allotment: TRUE in the Allotment, FALSE for the removed row, blank for non-teaching rows',
    after.find(r => r.name === 'Staff A').inAllotment === true && after.find(r => r.name === 'Staff B').inAllotment === false &&
    after.find(r => r.name === 'Consultant R').inAllotment === null);
  check('the departed teacher keeps her Department and Team (no Allotment data to mirror)', after.find(r => r.name === 'Staff B').staffCode === 'S0002');
  check('Apply does not fill Left On', after.every(r => r.leftOn === ''));

  const log = t.logRows();
  check('every change is logged with user, time, source and reason',
    log.length > 3 && log.every(l => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(l[0]) && l[1] === 'ict.facilitator@example.test' && l[7] === 'Sync' && l[6]));
  check('the deactivation is logged as Active TRUE -> FALSE with the apply date',
    log.some(l => l[2] === 'Staff B' && l[3] === 'Active' && l[4] === 'TRUE' && l[5] === 'FALSE' && /applied \d{4}-\d\d-\d\d/.test(l[6])));
  check('the added row is logged as a Row addition', log.some(l => l[2] === 'Staff D' && l[3] === 'Row'));
  check('the Result column records each outcome', t.cell(PREV, 3, 6) === 'Added' && t.cell(PREV, 4, 6) === 'Active set to FALSE');
  check('timestamps use Asia/Kolkata', t.run('__tzSeen.every(function(z){return z==="Asia/Kolkata"})') && t.run('ROSTER_TZ') === 'Asia/Kolkata');
  check('Apply invalidates the roster cache: the next read is fresh', t.run('(clearCache(), getRoster_().rows.length)') === after.length);

  // idempotent
  const snap = t.snap();
  const res2 = t.run('applyRosterSync_()');
  check('R2 Apply twice changes nothing', res2.added === 0 && res2.deactivated === 0 && res2.refreshed === 0 && t.snap() === snap, J(res2));
  t.run('previewRosterSync_()');
  const res3 = t.run('applyRosterSync_()');
  check('a fresh Preview then Apply also changes nothing', res3.added === 0 && res3.deactivated === 0 && res3.refreshed === 0);
}

{
  const t = syncFixture();
  t.run('previewRosterSync_()');
  t.put(PREV, 2, 4, [{ Decision: 'Skip' }]);
  const res = t.run('applyRosterSync_()');
  check('a row set to Skip is not applied', res.deactivated === 0 && t.rows().find(r => r.name === 'Staff B').active === true && t.cell(PREV, 4, 6) === 'Skipped by you');
}
{
  const t = syncFixture();
  check('Apply with no preview is refused, with nothing changed', throws(() => t.run('applyRosterSync_()')));
  t.run('previewRosterSync_()');
  t.run('ALLOT_FAILS = true');
  const before = t.snap([T, LOG]);
  check('an unreadable Allotment stops Apply and Preview before any row is touched',
    throws(() => t.run('applyRosterSync_()')) && throws(() => t.run('previewRosterSync_()')) && t.snap([T, LOG]) === before);
  t.run('ALLOT_FAILS = false; ALLOT = []');
  check('an empty Allotment never proposes to deactivate everyone', throws(() => t.run('previewRosterSync_()')));
}
{
  // a row decided Apply that is no longer true when Apply runs is skipped, not applied blindly
  const t = syncFixture();
  t.run('previewRosterSync_()');
  t.run('ALLOT.push("Staff B")');          // Staff B came back into the Allotment after the preview
  const res = t.run('applyRosterSync_()');
  check('Apply re-validates against live data: a returned teacher is not deactivated', res.deactivated === 0 &&
    t.rows().find(r => r.name === 'Staff B').active === true && t.cell(PREV, 4, 6) === 'Skipped: no longer needed', J(res));
}

{ // batching: constant writes however many rows are added
  const mk = n => {
    const allot = ['Staff A'].concat(Array.from({ length: n }, (_, i) => 'New ' + i));
    const t = fresh({ allot, meta: {} });
    t.roster([row('Staff A')]);
    t.run('previewRosterSync_()');
    t.resetStats();
    t.run('applyRosterSync_()');
    return t.stats();
  };
  const s2 = mk(2), s9 = mk(9);
  check('no per-cell writes: setValues calls do not grow with the number of rows', s2.setValues === s9.setValues && s9.setValue === 0, J([s2, s9]));
}

/* R4: Active is written by exactly one function */
{
  const src = ['Roster.js', 'RosterTabs.js', 'Code.js', 'MarkAbsenceTab.js', 'Setup.js', 'Assign.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const writers = src.match(/rosterColumnUpdate_\([^)]*\['Active'\]/g) || [];
  const fnStart = src.indexOf('function applyRosterSync_()'), fnEnd = src.indexOf('/* ───────── 🧪 Check roster');
  const inside = (src.slice(fnStart, fnEnd).match(/state\.cols\['Active'\]/g) || []).length;
  const all = (src.match(/cols\['Active'\]/g) || []).length;
  check('R4 the Active column is written only inside applyRosterSync_', writers.length === 1 && inside >= 1 && all === inside, J({ writers: writers.length, inside, all }));
  check('R4 no other file writes the Active column', !/'Active'/.test(['Code.js', 'MarkAbsenceTab.js', 'Assign.js', 'Setup.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('')));
}

/* ───────── R5: Staff Code lock, edit and correction ───────── */
function codeFixture() {
  const t = fresh({ allot: ['Staff A', 'Staff C'] });
  t.roster([
    row('Staff A', { Email: 'staff.a@example.test', 'Match Status': 'Confirmed' }),
    row('Staff C'),
    { 'Display Name': 'Admin P', Category: 'Admin', Active: true },
    { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
  ]);
  return t;
}
{
  const t = codeFixture();
  t.roster([row('Staff A', { 'Staff Code': 'S0001' })]);
  const res = t.run('lockNewStaffCodes_()');
  check('R5 the first set is locked into the hidden column', eq(res.locked, ['Staff A']) && t.rows()[0].locked === 'S0001');
  check('R5 the first set is logged as First set', eq(t.logRows().map(l => [l[2], l[3], l[4], l[5], l[7]]), [['Staff A', 'Staff Code', '', 'S0001', 'First set']]));
  check('the join keys use the locked code, and email only when Confirmed', eq(
    (({ staffCode, staffEmail, codeState }) => ({ staffCode, staffEmail, codeState }))(t.run('rosterJoinKeys_("Staff A")')),
    { staffCode: 'S0001', staffEmail: 'staff.a@example.test', codeState: 'ok' }));
  check('an unconfirmed email is not offered as a join key', t.run('rosterJoinKeys_("Admin P")').staffEmail === '');
  check('locking twice logs nothing more', t.run('lockNewStaffCodes_()').locked.length === 0 && t.logRows().length === 1);

  // R5 an edited code is flagged and blocks that person's code write
  t.roster([row('Staff A', { 'Staff Code': 'S0009' })]);
  t.run('clearRosterCache_()');
  const k = t.run('rosterJoinKeys_("Staff A")');
  check('R5 an edit after the lock is flagged and blocks the code write', k.codeState === 'changed' && k.staffCode === '');
  check('the lock is not overwritten by the edit', t.run('lockNewStaffCodes_()').locked.length === 0 && t.rows()[0].locked === 'S0001');
  const chk = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:["Staff A","Staff C"],directory:null,loggedAdds:null})');
  check('Check roster names the unlocked change as an error', chk.findings.some(f => f.kind === 'code-changed' && f.level === 'error' && f.name === 'Staff A'));
  const blanked = (() => { t.roster([row('Staff A', { 'Staff Code': '' })]); t.run('clearRosterCache_()'); return t.run('rosterJoinKeys_("Staff A")'); })();
  check('blanking a locked code is also a change that blocks the write', blanked.codeState === 'changed' && blanked.staffCode === '');
}
{
  const t = codeFixture();
  t.roster([row('Staff A', { 'Staff Code': 'S0001' }), row('Staff C', { 'Staff Code': 'S0002' })]);
  t.run('lockNewStaffCodes_()');
  const log0 = t.logRows().length;
  const bad = (n, c, r) => t.run(`correctStaffCode_(${J(n)}, ${J(c)}, ${J(r)})`);
  check('R5 Correct rejects a duplicate code', !bad('Staff C', 's0001', 'typo').ok && /already belongs to Staff A/.test(bad('Staff C', 's0001', 'typo').error));
  check('Correct rejects a missing reason, a placeholder, an unknown name, no change',
    !bad('Staff C', 'S0003', ' ').ok && !bad('Staff C', 'N/A', 'x').ok && !bad('Nobody', 'S0003', 'x').ok && !bad('Staff C', 'S0002', 'x').ok);
  check('Correct refuses a name-match-only row (R36)', !bad('Consultant R', 'S0004', 'x').ok && /never has a Staff Code/.test(bad('Consultant R', 'S0004', 'x').error));
  check('a rejected correction changes and logs nothing', t.logRows().length === log0 && t.rows().find(r => r.name === 'Staff C').staffCode === 'S0002');
  const ok = bad('Staff C', ' s0010 ', 'Typed wrongly at first set');
  const c = t.rows().find(r => r.name === 'Staff C');
  check('R5 Correct updates both columns', ok.ok && c.staffCode === 'S0010' && c.locked === 'S0010');
  const lg = t.logRows().pop();
  check('R5 Correct is logged with old, new, reason and Source Correction', eq([lg[2], lg[3], lg[4], lg[5], lg[6], lg[7]], ['Staff C', 'Staff Code', 'S0002', 'S0010', 'Typed wrongly at first set', 'Correction']), J(lg));
  check('after a correction the join key is the new code', t.run('(clearRosterCache_(), rosterJoinKeys_("Staff C").staffCode)') === 'S0010');
  const w = bad('Staff C', 'S0011x', 'pattern check');
  check('a code outside the pattern is allowed on an explicit correction, with a warning, logged', w.ok && /pattern/.test(w.warning) && /pattern warning/.test(t.logRows().pop()[6]));
}
{ // rename chain: the new row may take the old row's code; any other reuse is refused
  const t2 = codeFixture();
  t2.roster([row('Staff A', { 'Staff Code': 'S0001', Active: false }), row('Staff C')]);
  t2.run('lockNewStaffCodes_()');
  check('a code on an inactive row cannot be given to a different person', !t2.run('correctStaffCode_("Staff C", "S0001", "reuse")').ok);
  const t3 = codeFixture();
  t3.roster([row('Staff A', { 'Staff Code': 'S0001', Active: false, 'Replaced By': 'Staff C' }), row('Staff C')]);
  t3.run('lockNewStaffCodes_()');
  check('a rename chain (old inactive, Replaced By the new row) may share the code', t3.run('correctStaffCode_("Staff C", "S0001", "renamed upstream")').ok);
  const chk = t3.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:null,directory:null,loggedAdds:null})');
  check('a legitimate rename chain is not reported as a duplicate', !chk.findings.some(f => f.kind === 'code-duplicate'));
}
{ // duplicate outside a chain, name-only rows, placeholders
  const t = codeFixture();
  t.roster([row('Staff A', { 'Staff Code': 'S0001' }), row('Staff C', { 'Staff Code': 's0001' })]);
  const res = t.run('lockNewStaffCodes_()');
  check('R5 a duplicate outside a rename chain is not locked, on either row', res.locked.length === 0 && res.refused.length === 2);
  const chk = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:null,directory:null,loggedAdds:null})');
  check('R5 the duplicate is reported once', chk.findings.filter(f => f.kind === 'code-duplicate').length === 1);
  check('and blocks the join write for both people', t.run('rosterJoinKeys_("Staff A")').staffCode === '' && t.run('rosterJoinKeys_("Staff C")').staffCode === '');
}
{
  const t = codeFixture();
  t.roster([{ 'Display Name': 'Consultant S', Category: 'Resource Person', 'Staff Code': 'S0777', Email: 'r@example.test' }, row('Staff C', { 'Staff Code': 'N/A' })]);
  const res = t.run('lockNewStaffCodes_()');
  check('R36 a code typed on a name-match-only row is refused, not locked, and never used', res.locked.length === 0 && res.refused.length === 1 &&
    t.rows().find(r => r.name === 'Consultant S').locked === '' && t.run('rosterJoinKeys_("Consultant S")').staffCode === '');
  check('a name-only row never yields a code or email key', eq(
    (({ staffCode, staffEmail, nameOnly }) => ({ staffCode, staffEmail, nameOnly }))(t.run('rosterJoinKeys_("Consultant S")')), { staffCode: '', staffEmail: '', nameOnly: true }));
  check('a placeholder typed into Staff Code is never locked', t.rows().find(r => r.name === 'Staff C').locked === '');
  const chk = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:null,directory:null,loggedAdds:null})');
  check('Check roster reports the manual code on the Resource Person and the typed placeholder',
    chk.findings.some(f => f.kind === 'nameonly-code' && f.name === 'Consultant S') && chk.findings.some(f => f.kind === 'code-placeholder' && f.name === 'Staff C') &&
    chk.findings.some(f => f.kind === 'nameonly-email'));
}
{ // the onEdit hook
  const t = codeFixture();
  t.roster([row('Staff A', { 'Staff Code': 'S0001' })]);
  t.run('getRoster_()');
  t.run(`onEditInstallable({ range: { getSheet: function () { return sheet_(SS.ROSTER); }, getRow: function () { return 3; }, getColumn: function () { return 2; } } })`);
  check('an edit on 🪪 Teachers clears the cache and locks the new code', t.rows()[0].locked === 'S0001' && t.run('__cache.removes') >= 1);
  t.run('__cache.removes = 0');
  t.run(`onEditInstallable({ range: { getSheet: function () { return sheet_(SS.ROSTER_SETTINGS); } } })`);
  check('an edit on 🧭 Roster Settings clears the cache', t.run('__cache.removes') >= 1);
}
{ // the menu path
  const t = codeFixture();
  t.roster([row('Staff A', { 'Staff Code': 'S0001' })]);
  t.run('lockNewStaffCodes_()');
  t.run('__ui.prompts = ["Staff A", "S0050", "Wrong digit at first set"]');
  t.run('correctStaffCode()');
  check('Correct Staff Code… prompts for name, code and reason, then logs a Correction',
    t.rows()[0].locked === 'S0050' && t.logRows().pop()[7] === 'Correction' && t.alerts().pop().title === '✅ Staff Code corrected');
  t.run('__ui.prompts = ["Staff A"]');
  const n = t.logRows().length;
  t.run('correctStaffCode()');
  check('cancelling the Correct Staff Code prompts changes nothing', t.logRows().length === n && t.rows()[0].locked === 'S0050');
}

/* ───────── R6: Check roster ───────── */
function kinds(res, name) { return res.findings.filter(f => !name || f.name === name).map(f => f.kind).sort(); }
{
  const t = fresh({ allot: ['Staff A', 'Staff B'] });
  t.roster([
    row('Staff A', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001', Email: 'staff.a@example.test', 'Match Status': 'Confirmed' }),
    { 'Display Name': 'Support P', Category: 'Support Staff', Active: true, 'Staff Code': 'W0001', 'Staff Code (Locked)': 'W0001' },
    { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
    { 'Display Name': 'Admin Q', Category: 'Admin', Active: true, 'Staff Code': 'S0003', 'Staff Code (Locked)': 'S0003' },
  ]);
  t.run('writeRosterLogTab_()');
  t.put(LOG, 2, 3, [{ 'Display Name': 'Staff A', Field: 'Row', Source: 'Sync' }]);
  const res = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:["Staff A","Staff B"],directory:{ok:true,emails:{"staff.a@example.test":true}},loggedAdds:{"Staff A":true}})');
  check('R6 a Support Staff row with no email produces no finding', kinds(res, 'Support P').length === 0, J(kinds(res, 'Support P')));
  check('R6/R36 a Resource Person with no code and no email produces no finding', kinds(res, 'Consultant R').length === 0);
  check('R6 blank email is reported only where the category requires email', eq(kinds(res, 'Admin Q'), ['email-missing']));
  check('R6 an Allotment teacher missing from the roster is reported', res.findings.some(f => f.kind === 'allotment-missing' && /Staff B/.test(f.text)));
  check('Check roster summary counts errors and warnings', res.counts.error === 0 && res.counts.warn === 2, J(res.counts));
}
{
  const t = fresh({ allot: ['Staff A', 'Staff B', 'Staff Z'] });
  t.roster([
    row('Staff A', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001', Email: 'dup@example.test' }),
    row('Staff A', { 'Staff Code': 'S0002', 'Staff Code (Locked)': 'S0002', Email: 'dup@example.test' }),
    row('Staff B'),                                              // no code
    row('Staff B2', { 'Staff Code': 'S12', 'Staff Code (Locked)': 'S12', Email: 'typed@example.test', 'Match Status': 'Needs review' }),
    row('Staff Gone', { 'Staff Code': 'S0005', 'Staff Code (Locked)': 'S0005', Email: 'gone@example.test' }),
    row('Staff Q', { Active: false }),                           // inactive, no code: not flagged
    { 'Display Name': 'Staff Z', Category: 'Admin', Active: true, 'Staff Code': 'S0006', 'Staff Code (Locked)': 'S0006', Email: 'z@example.test' },  // collides with Teaching name Staff Z
    { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
    { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
    { 'Display Name': 'Mystery', Category: 'Nonsense', Active: true, 'Staff Code': 'S0008', 'Staff Code (Locked)': 'S0008', Email: 'm@example.test' },
    row('Replaced Row', { Active: false, 'Replaced By': 'Nobody Here' }),
  ]);
  const dir = { ok: true, emails: { 'dup@example.test': true, 'gone@example.test': true } };
  const res = t.run(`computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:["Staff A","Staff B","Staff Z"],directory:${J(dir)},loggedAdds:{"Staff A":true,"Staff B":true}})`);
  const has = (k, n) => res.findings.some(f => f.kind === k && (!n || f.name === n));
  check('R6 duplicate Display Names are errors', has('name-duplicate', 'Staff A'));
  check('R6 a duplicate Resource Person name is called out specifically', has('name-duplicate-resource', 'Consultant R'));
  check('R6 duplicate Active emails', has('email-duplicate'));
  check('R6 a missing Staff Code (Active row, code-required category)', has('code-missing', 'Staff B'));
  check('R6 an inactive row without a code is not flagged', !has('code-missing', 'Staff Q'));
  check('R6 a code failing the pattern is a warning', res.findings.find(f => f.kind === 'code-pattern' && f.name === 'Staff B2').level === 'warn');
  check('R6 a hand-typed email not in importHR (not Confirmed)', has('email-unknown', 'Staff B2'));
  check('R6 an Active Teaching row not in the Allotment', has('teaching-not-in-allotment', 'Staff Gone'));
  check('R6 a hand-added Teaching row (no sync log entry)', has('teaching-hand-added', 'Staff Gone') && !has('teaching-hand-added', 'Staff A'));
  check('R6 a non-teaching name colliding with a Teaching name', has('nonteaching-collision', 'Staff Z'));
  check('R6 an unknown category is an error', has('category-unknown', 'Mystery'));
  check('R6 Replaced By must be a Display Name on the tab', has('replaced-by', 'Replaced Row'));
  const t2 = fresh();
  t2.run(`(function(){var s=readRosterSettings_(); s.categories.push({name:'Extra',teaching:true,joinKey:'Staff Code',emailRequired:true});
    globalThis.__r = computeRosterCheck_({rows:[],settings:s,allotment:null,directory:null,loggedAdds:null}); })()`);
  check('R6 a Categories table without exactly one Teaching? row is an error',
    t2.run('__r.findings.some(function(f){return f.kind==="categories-teaching-count" && f.level==="error"})'));
}
{
  const t = fresh({ allot: ['Staff A'] });
  t.roster([row('Staff A', { 'Staff Code': 'N/A' }), { 'Display Name': 'Consultant R', Category: 'Resource Person', 'Staff Code': 'n/a', Email: '-' }]);
  const res = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:["Staff A"],directory:null,loggedAdds:null})');
  check('R35 placeholders never count as duplicates or pattern errors', !res.findings.some(f => f.kind === 'code-duplicate' || f.kind === 'code-pattern'));
}
{
  const t = syncFixture();
  t.run('previewRosterSync_()');
  const before = t.snap();
  t.run('__ui.alerts = []');
  t.run('checkRoster()');
  const alert = t.alerts().pop();
  check('Check roster (menu) shows a summary and writes nothing', /Roster check/.test(alert.title) && /Nothing was changed/.test(alert.body) && t.snap() === before, alert.body.slice(0, 200));
}

/* ───────── R1: upgradeTabs / setupAllTabs ───────── */
{
  // existing data tabs hold a sentinel; roster tabs are missing: upgradeTabs creates them and touches nothing else
  const ctx = load(FILES, MOCK + `
    function getConfig() { return defaultConfig_(); }
    function absenceMigrationNeeded_() { return false; }
    function addMissingConfigRows_() { return []; }
    function refreshLabels_() { return []; }
    function ensureAbsenceTrigger_() {} function ensureReportTrigger_() {}
  `);
  const run = ctx.run;
  ['CONSOLE', 'CONFIG', 'MARK_ABSENCE', 'POOL', 'DASHBOARD', 'ANALYTICS', 'LOG', 'ABSENCE', 'RULES', 'BLOCKS', 'REPORTS', 'IMPORT_HR', 'HELP'].forEach(k => {
    run(`(function(){ var s = __ss.insertSheet(SS.${k}); s.cells["5,1"] = "SENTINEL-${k}"; s.cells["6,2"] = "SENTINEL-B-${k}"; })()`);
  });
  const dataBefore = run('__snapshot()');
  run('upgradeTabs()');
  const names = run('__book.order');
  check('R1 upgradeTabs creates the roster tabs', [SET, T, PREV, LOG, '🪪 Roster Review'].every(n => names.includes(n)));
  const unchanged = run('__book.order').filter(n => ![SET, T, PREV, LOG, '🪪 Roster Review', '🗓️ Non-Teaching Absence', '🧾 Backfill Preview'].includes(n));   // T-018, T-017 and T-013 tabs are new too
  const after = JSON.parse(run(`__snapshot(${J(unchanged)})`)), before = JSON.parse(dataBefore);
  check('R1 upgradeTabs leaves every existing tab untouched (sentinels survive; Config, Log, importHR, Reports rows)',
    unchanged.every(n => J(after[n]) === J(before[n])) && run('__book.sheets[SS.LOG].cells["5,1"]') === 'SENTINEL-LOG' &&
    run('__book.sheets[SS.IMPORT_HR].cells["6,2"]') === 'SENTINEL-B-IMPORT_HR');
  const snap = run('__snapshot()');
  run('upgradeTabs()');
  check('R1 a second upgradeTabs makes no change at all', run('__snapshot()') === snap);

  // roster tabs that already hold data are skipped entirely
  run('__put(SS.ROSTER, 2, 3, [{ "Display Name": "Staff A", Notes: "KEEP" }])');
  run('__book.sheets[SS.ROSTER_LOG].cells["3,3"] = "KEEP-LOG"');
  run('upgradeTabs()');
  check('R1 an existing 🪪 Teachers or 🪪 Roster Log is not touched', run('__cell(SS.ROSTER, 3, 14)') === 'KEEP' && run('__cell(SS.ROSTER_LOG, 3, 3)') === 'KEEP-LOG');
}
{
  // the destructive path never wipes the roster tabs
  const ctx = load(FILES, MOCK + `
    function getConfig() { return defaultConfig_(); }
    function describeDataAtRisk_() { return ['x']; }
    ['writeConfigTab_','writeConsoleTab_','writeMarkAbsenceTab_','writeLogTab_','writeAbsenceRegisterTab_','writeRulesTab_','writeBlocksTab_',
     'writeReportsTab_','writeImportHrTab_','writeHelpTab_','renderPool_','renderFairness_','renderAnalyticsTab_','ensureAbsenceTrigger_','ensureReportTrigger_']
      .forEach(function (n) { globalThis[n] = function () {}; });
    function backupWorkbook_() { return { getName: function () { return 'b'; } }; }
  `);
  const run = ctx.run;
  run('ensureRosterTabs_()');
  run('__put(SS.ROSTER, 2, 3, [{ "Display Name": "Staff A", Notes: "SENTINEL" }])');
  run('__book.sheets[SS.ROSTER_LOG].cells["3,3"] = "SENTINEL-LOG"');
  run('__book.sheets[SS.ROSTER_SETTINGS].cells["30,1"] = "SENTINEL-SET"');
  const before = run(`__snapshot(${J([T, SET, LOG, PREV])})`);
  run('__ui.answer = "YES"; setupAllTabs()');
  check('setupAllTabs (the guarded destructive path) does not wipe or rewrite the roster tabs', run(`__snapshot(${J([T, SET, LOG, PREV])})`) === before &&
    run('__book.sheets[SS.ROSTER].cleared + __book.sheets[SS.ROSTER_LOG].cleared + __book.sheets[SS.ROSTER_SETTINGS].cleared') === 0);
}

/* ───────── menu ───────── */
{
  const all = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  const ctx = load(all, MOCK);
  ctx.run('onOpen()');
  const items = ctx.run('__ui.items');
  const missing = items.filter(i => ctx.run(`typeof ${i.fn}`) !== 'function').map(i => i.fn);
  check('every menu handler exists as a function', missing.length === 0 && items.length > 30, J(missing));
  const rosterFns = ['openRosterTab', 'openRosterSettings', 'previewRosterSync', 'applyRosterSync', 'correctStaffCode', 'checkRoster', 'openRosterLog'];
  check('the Roster menu is wired in Code.js', rosterFns.every(f => items.some(i => i.fn === f)));
  const names = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
  // a duplicate top-level name silently overwrites in the shared namespace
  const decl = {};
  names.forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    (src.match(/^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm) || []).forEach(m => {
      const n = m.replace(/^(function|const|let|var)\s+/, '');
      (decl[n] = decl[n] || []).push(f);
    });
  });
  const dups = Object.keys(decl).filter(n => decl[n].length > 1 && decl[n].some(f => /^Roster/.test(f)));
  check('no roster function or constant shadows another file', dups.length === 0, J(dups));
}

/* N5: a failing menu action tells the user and pings Ops with the error class only */
{
  const t = fresh();
  t.run('__book.sheets[SS.SYNC_PREVIEW].cells = {}');
  t.run('delete __book.sheets[SS.SYNC_PREVIEW]; __book.order = __book.order.filter(function(n){return n!==SS.SYNC_PREVIEW})');
  t.run('previewRosterSync()');
  const ops = t.run('__ops');
  check('N5 a failing menu action alerts the user plainly', t.alerts().some(a => /Upgrade tabs/.test(a.body)));
  check('N5 and notifies Ops with the function name and error class only', ops.length === 1 && /Roster: /.test(ops[0][0]) && ops[0][1] === 'Error');
}

/* no real data, no code generation */
{
  const src = ['Roster.js', 'RosterTabs.js', 'test/roster.test.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const addrs = (src.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).filter(a => !/@example\.test$|@school\.example$/i.test(a));
  check('N3 only placeholder addresses appear in the roster code and tests', addrs.length === 0, J(addrs));
  check('N3 no HR Database workbook ID or URL in the roster code', !/spreadsheets\/d\/|openById/.test(fs.readFileSync(path.join(ROOT, 'Roster.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'RosterTabs.js'), 'utf8')));
  check('R36 no code path invents a Staff Code', !/nextCode|generateCode|newStaffCode|codeSequence|Math\.random/.test(src.replace(/test\/roster\.test\.js[\s\S]*/, '')));
  const roster = fs.readFileSync(path.join(ROOT, 'Roster.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'RosterTabs.js'), 'utf8');
  check('no per-cell Sheets calls inside a loop in the roster code', !/for \([^)]*\)[^{]*\{[^}]*\.getRange\([^)]*\)\.(getValue|setValue)\(/.test(roster));
  check('the roster log is never cleared or deleted by code', !/ROSTER_LOG[^;]*(clear\(|clearContent|deleteRows)/.test(roster));
  check('the roster HR reads nothing from the HR Database', !/readHrDatabase_\s*\(/.test(roster));
}

/* ───────── cross-review fixes (T-011 review items 2-7) ───────── */

{ // 2: Add never lands on a row that holds anything, even without a Display Name
  const t = fresh({ allot: ['Staff A', 'Staff D'] });
  t.roster([row('Staff A'), { 'Staff Code': 'S0042', Notes: 'ORPHAN-NOTE' }]);
  t.run('previewRosterSync_()');
  t.run('applyRosterSync_()');
  check('review 2: an unnamed row holding a code and a note is not overwritten by an Add',
    t.cell(T, 4, 2) === 'S0042' && t.cell(T, 4, 14) === 'ORPHAN-NOTE' && t.cell(T, 4, 1) === '' && t.cell(T, 5, 1) === 'Staff D');
  const u = fresh();
  u.roster([row('Staff A')]);
  u.run('(function(){ var real = sheet_(SS.ROSTER); var g = real.getRange; real.getLastRow = function(){ return 3; }; })()');
  u.run('__book.sheets[SS.ROSTER].cells["4,2"]="HIDDEN"');   // content the last-row scan was told not to see
  check('review 2: rosterAppendRows_ refuses to write over a non-empty target', throws(() => u.run(
    'rosterAppendRows_(sheet_(SS.ROSTER), readRosterRows_().cols, [{"Display Name":"N"}])')));
}

{ // 3: duplicate Display Names are ambiguous, never resolved to the first row
  const t = fresh({ allot: ['Staff A', 'Staff C'] });
  t.roster([row('Staff A', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001', Email: 'a1@example.test', 'Match Status': 'Confirmed' }),
            row('Staff A', { 'Staff Code': 'S0002', 'Staff Code (Locked)': 'S0002' })]);
  const k = t.run('rosterJoinKeys_("Staff A")');
  check('review 3: rosterJoinKeys_ on a duplicate name gives no keys and says duplicate name',
    k.found && k.codeState === 'duplicate name' && k.staffCode === '' && k.staffEmail === '' && k.ambiguous === true, J(k));
  check('review 3: Correct Staff Code refuses a duplicate Display Name', !t.run('correctStaffCode_("Staff A", "S0099", "x")').ok &&
    /More than one row/.test(t.run('correctStaffCode_("Staff A", "S0099", "x")').error));
  t.roster([row('Staff A', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001' }), row('Staff A', { 'Staff Code': 'S0002', 'Staff Code (Locked)': '' })]);
  check('review 3: the first-set lock refuses a duplicate Display Name', t.run('lockNewStaffCodes_()').refused.length === 1 && t.rows()[1].locked === '');
  const chk = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:null,directory:null,loggedAdds:null})');
  check('review 3: Check roster flags the duplicate name as an error', chk.findings.some(f => f.kind === 'name-duplicate' && f.level === 'error'));
  // a duplicated removed teacher is not deactivated
  const u = fresh({ allot: ['Staff A'] });
  u.roster([row('Staff A'), row('Gone'), row('Gone')]);
  u.run('previewRosterSync_()');
  const res = u.run('applyRosterSync_()');
  check('review 3: Apply does not deactivate one of two rows with the same name', res.deactivated === 0 && u.rows().every(r => r.active) &&
    /duplicate Display Name/.test(u.cell(PREV, 3, 6)), J(res) + u.cell(PREV, 3, 6));
}

{ // 4: importHR Email is found by header name only
  const t = fresh({ allot: ['Staff A'] });
  t.run(`(function(){var sh=__ss.insertSheet(SS.IMPORT_HR); var c=sh.cells; c["2,1"]='Teacher Name'; c["2,2"]='Mail address'; c["2,3"]='Chat User ID';
    c["3,1"]='X'; c["3,2"]='staff.a@example.test'; c["3,3"]='users/1';})()`);
  t.roster([row('Staff A', { Email: 'staff.a@example.test' })]);
  const d = t.run('readImportHrEmails_()');
  check('review 4: no Email header means evidence unavailable, never a positional guess', d.ok === false && eq(d.emails, {}) && /no "Email" header/.test(d.reason), J(d));
  const plan = t.run('previewRosterSync_()');
  check('review 4: the preview reports it and proposes nothing from email', plan.changes.some(c => c.change === 'Email evidence unavailable') &&
    !plan.changes.some(c => c.change === 'Email not in directory'));
  check('review 4: the source no longer falls back to the configured column', !/hrEmailCol/.test(fs.readFileSync(path.join(ROOT, 'Roster.js'), 'utf8')));
}

{ // 5: rename chains are acyclic and end at exactly one Active row
  const t = fresh({ allot: ['Staff A'] });
  const R = (name, active, by) => ({ row: 0, name, active, replacedBy: by });
  const chain = l => t.run(`rosterIsRenameChain_(${J(l)})`);
  check('review 5: inactive A->B plus active B is a valid chain', chain([R('A', false, 'B'), R('B', true, '')]));
  check('review 5: a cycle (A->B, B->A) plus an active C is not a chain', !chain([R('A', false, 'B'), R('B', false, 'A'), R('C', true, '')]));
  check('review 5: a pure cycle is not a chain', !chain([R('A', false, 'B'), R('B', false, 'A')]));
  check('review 5: two Active rows sharing a code are a conflict', !chain([R('A', true, ''), R('B', true, '')]));
  check('review 5: a chain whose end is inactive is not valid', !chain([R('A', false, 'B'), R('B', false, '')]));
  t.roster([row('Staff A', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001', Active: false, 'Replaced By': 'Staff B' }),
            row('Staff B', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001', Active: false, 'Replaced By': 'Staff A' }),
            row('Staff C', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001' })]);
  const conf = t.run('rosterCodeConflicts_(readRosterRows_().rows)');
  check('review 5: one code on a cycle plus an active row is a reported conflict, and blocks the join key',
    conf.S0001 && conf.S0001.ok === false && t.run('rosterJoinKeys_("Staff C")').staffCode === '');
}

{ // 6: a "tab missing" answer is never cached
  const t = fresh({ nobuild: true });
  t.run('__book.sheets = {}; __book.order = [];');
  check('review 6: before the tab exists the roster reads as missing', t.run('getRoster_().exists') === false);
  check('review 6: a missing-tab answer is not written to the cache', t.run('__cache.puts.length') === 0);
  t.run('__cache.store["roster:v1"] = JSON.stringify({exists:false, rows:[], cols:{}})');
  t.run('ensureRosterTabs_()');
  check('review 6: creating the roster tabs clears the cache, so the very next read sees the tab',
    t.run('getRoster_().exists') === true && t.run('"roster:v1" in __cache.store') === true ? t.run('getRoster_().cols["Display Name"]') === 1 : false);
}

{ // 7: Apply validates every header and writes nothing when one is missing
  const t = syncFixture();
  t.run('previewRosterSync_()');
  t.run('delete __book.sheets[SS.ROSTER].cells["2,7"]');   // the Department header
  const snap = t.snap([T, LOG, PREV]);
  check('review 7: a missing derived header stops Apply before any write', throws(() => t.run('applyRosterSync_()')) && t.snap([T, LOG, PREV]) === snap);
  let msg = ''; try { t.run('applyRosterSync_()'); } catch (e) { msg = e.message; }
  check('review 7: and says which header is missing', /Nothing was applied/.test(msg) && /Department/.test(msg), msg);
  const u = syncFixture();
  u.run('previewRosterSync_()');
  u.run('delete __book.sheets[SS.ROSTER_LOG].cells["2,7"]');   // the Reason header on the log
  const s2 = u.snap([T, LOG, PREV]);
  check('review 7: a damaged log header also stops Apply with nothing written', throws(() => u.run('applyRosterSync_()')) && u.snap([T, LOG, PREV]) === s2);
}

/* ───────── cross-review round 3 ───────── */

{ // 1: branching rename chains are conflicts
  const t = fresh({ allot: ['Staff A'] });
  const R = (name, active, by) => ({ row: 0, name, active, replacedBy: by });
  const chain = l => t.run(`rosterIsRenameChain_(${J(l)})`);
  check('round3-1: a linear chain A->B->C (C active) is valid', chain([R('A', false, 'B'), R('B', false, 'C'), R('C', true, '')]));
  check('round3-1: two inactive rows both replaced by one active row is a branch, so a conflict',
    !chain([R('A', false, 'C'), R('B', false, 'C'), R('C', true, '')]));
  t.roster([row('Staff A', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001', Active: false, 'Replaced By': 'Staff C' }),
            row('Staff B', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001', Active: false, 'Replaced By': 'Staff C' }),
            row('Staff C', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001' })]);
  const conf = t.run('rosterCodeConflicts_(readRosterRows_().rows)');
  check('round3-1: the shared code is reported and blocks the join key', conf.S0001.ok === false && t.run('rosterJoinKeys_("Staff C")').staffCode === '');
}

{ // 2: Staff Code writes validate first, log first, and write nothing on failure
  const mk = () => {
    const t = fresh({ allot: ['Staff A', 'Staff C'] });
    t.roster([row('Staff A', { 'Staff Code': 'S0001' }), row('Staff C', { 'Staff Code': 'S0002', 'Staff Code (Locked)': 'S0002' })]);
    return t;
  };
  let t = mk();
  t.run('delete __book.sheets[SS.ROSTER_LOG].cells["2,7"]');   // damage the log's Reason header
  let snap = t.snap([T, LOG]);
  check('round3-2: the first-set lock writes nothing when the log header is damaged', throws(() => t.run('lockNewStaffCodes_()')) && t.snap([T, LOG]) === snap);
  let res = t.run('correctStaffCode_("Staff C", "S0010", "fix")');
  check('round3-2: Correct writes nothing when the log header is damaged, and says so',
    !res.ok && /Nothing was corrected/.test(res.error) && t.snap([T, LOG]) === snap && t.rows()[1].staffCode === 'S0002');
  t = mk();
  t.run('delete __book.sheets[SS.ROSTER].cells["2,15"]');      // the locked-code header
  snap = t.snap([T, LOG]);
  res = t.run('correctStaffCode_("Staff C", "S0010", "fix")');
  check('round3-2: a missing locked-code header stops Correct before any write', !res.ok && /Staff Code \(Locked\)/.test(res.error) && t.snap([T, LOG]) === snap);
  check('round3-2: a missing locked-code header stops the lock before any write', throws(() => t.run('lockNewStaffCodes_()')) && t.snap([T, LOG]) === snap);
  t = mk();
  t.run('correctStaffCode_("Staff C", "S0010", "fix")');
  const src = fs.readFileSync(path.join(ROOT, 'Roster.js'), 'utf8');
  const fn = src.slice(src.indexOf('function correctStaffCode_'), src.indexOf('/** Installable onEdit hook'));
  check('round3-2: Correct appends the log before it writes either code column',
    fn.indexOf('appendRosterLog_(') > -1 && fn.indexOf('appendRosterLog_(') < fn.indexOf("rosterColumnUpdate_(sheet, state.cols['Staff Code']"));
}

{ // 3: no teaching category configured -> Apply refuses
  const t = syncFixture();
  t.run('previewRosterSync_()');
  t.run(`(function(){ var sh = __book.sheets[SS.ROSTER_SETTINGS]; for (var r = 1; r <= sh.getLastRow(); r++) if (sh.cells[r+",2"] === 'TRUE' && sh.cells[r+",1"] === 'Teaching') sh.cells[r+",2"] = 'FALSE'; })()`);
  t.run('clearRosterCache_()');
  const snap = t.snap([T, LOG, PREV]);
  let msg = ''; try { t.run('applyRosterSync_()'); } catch (e) { msg = e.message; }
  check('round3-3: Apply refuses with no teaching category and writes nothing',
    /Nothing was applied: Roster Settings has no teaching category/.test(msg) && t.snap([T, LOG, PREV]) === snap, msg);
  const u = syncFixture();
  u.run('previewRosterSync_()'); u.run('applyRosterSync_()');
  check('round3-3: with a teaching category configured the Add uses its name', u.rows().find(r => r.name === 'Staff D').category === 'Teaching');
}

{ // 4: Code prefix column and the Check roster warning
  const t = fresh({ allot: ['Staff A'] });
  check('round3-4: Categories are seeded with Code prefix S, S, W, blank',
    eq(t.run('readRosterSettings_().categories.map(function(c){return c.codePrefix})'), ['S', 'S', 'W', '']) && t.cell(SET, 4, 5) === 'Code prefix');
  t.roster([{ 'Display Name': 'Support P', Category: 'Support Staff', Active: true, 'Staff Code': 'S0123', 'Staff Code (Locked)': 'S0123' },
            { 'Display Name': 'Support Q', Category: 'Support Staff', Active: true, 'Staff Code': 'W0124', 'Staff Code (Locked)': 'W0124' },
            row('Staff A', { 'Staff Code': 'S0001', 'Staff Code (Locked)': 'S0001', Email: 'a@example.test' })]);
  const res = t.run('computeRosterCheck_({rows:readRosterRows_().rows,settings:readRosterSettings_(),allotment:["Staff A"],directory:null,loggedAdds:null})');
  const w = res.findings.filter(f => f.kind === 'code-prefix');
  check('round3-4: a Support Staff row holding an S code is a WARNING (never an error)', w.length === 1 && w[0].name === 'Support P' && w[0].level === 'warn');
  check('round3-4: the matching W code and the S teacher are not flagged', !res.findings.some(f => f.kind === 'code-prefix' && f.name !== 'Support P'));
  check('round3-4: a prefix mismatch does not block the join key', t.run('rosterJoinKeys_("Support P")').staffCode === 'S0123');

  // migration of an older Settings tab: header added, blanks filled, user values and later blanks kept
  const u = fresh({ allot: ['Staff A'] });
  u.run(`(function(){ var sh = __book.sheets[SS.ROSTER_SETTINGS]; for (var r = 4; r <= 9; r++) delete sh.cells[r+",5"]; sh.maxCols = 4; sh.cells["6,5"]; })()`);
  u.run(`__book.sheets[SS.ROSTER_SETTINGS].cells["6,5"] = undefined; delete __book.sheets[SS.ROSTER_SETTINGS].cells["6,5"]`);
  u.run(`__book.sheets[SS.ROSTER_SETTINGS].cells["5,1"] = 'Teaching'`);
  u.run('clearRosterCache_(); writeRosterSettingsTab_();');
  check('round3-4: an older Categories table gains the header and the default prefixes', u.cell(SET, 4, 5) === 'Code prefix' && u.cell(SET, 5, 5) === 'S' && u.cell(SET, 7, 5) === 'W');
  u.run(`__book.sheets[SS.ROSTER_SETTINGS].cells["5,5"] = 'T'; delete __book.sheets[SS.ROSTER_SETTINGS].cells["6,5"]`);
  u.run('writeRosterSettingsTab_()');
  check('round3-4: re-running keeps a user edit and a deliberate blank', u.cell(SET, 5, 5) === 'T' && u.cell(SET, 6, 5) === '');
}

{ // 5: a formula that evaluates to blank still counts as content
  const t = fresh({ allot: ['Staff A', 'Staff D'] });
  t.roster([row('Staff A')]);
  t.run('__book.sheets[SS.ROSTER].formulas["4,3"] = \'=IF(1=2,"x","")\'');   // unnamed row, value blank, formula present
  t.run('previewRosterSync_()');
  t.run('applyRosterSync_()');
  check('round3-5: an Add lands below a row whose only content is a blank-valued formula',
    t.run('__book.sheets[SS.ROSTER].formulas["4,3"]') === '=IF(1=2,"x","")' && t.cell(T, 4, 1) === '' && t.cell(T, 5, 1) === 'Staff D');
  const u = fresh();
  u.roster([row('Staff A')]);
  u.run('__book.sheets[SS.ROSTER].formulas["4,2"] = "=A3"; __book.sheets[SS.ROSTER].getLastRow = function(){ return 3; }');
  check('round3-5: the target check also refuses a formula cell', throws(() => u.run('rosterAppendRows_(sheet_(SS.ROSTER), readRosterRows_().cols, [{"Display Name":"N"}])')));
}
