/**
 * T-016: join keys written at mark time (R17, R18; D6). Placeholder data only.
 * Staff Code = locked roster code; Staff Email = confirmed roster email; else blank.
 */
const fs = require('fs');
const path = require('path');
const { load, DEFAULT_FILES, ROOT } = require('./harness');
const { MOCK } = require('./sheetmock');

const FILES = DEFAULT_FILES.concat(['Reports.js', 'ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'AnalyticsTab.js',
  'HR.js', 'Setup.js', 'MarkAbsenceTab.js', 'Code.js', 'RosterTabs.js', 'Roster.js']);
const J = JSON.stringify;
const REG = '🗓️ Absence Register';
const T = '🪪 Teachers';
const row = (name, o) => Object.assign({ 'Display Name': name, Category: 'Teaching', Active: true }, o || {});

function fresh(rosterRows) {
  const over = `
    var __notified = [], __logged = [];
    function getAllTeachers() { return ['Staff A', 'Staff B', 'Staff C', 'Staff D', 'Staff E']; }
    function getTeacherMeta() { return {}; }
    function getConfig() { return defaultConfig_(); }
    function notifyOpsFailure_() {}
    function toast_() {}
    sendNotifications_ = function () { return false; };
    appendToLog_ = function () {};
    refreshDashboards_ = function () {};
    styleAbsenceRows_ = function () {};
    removeForCommit_ = function (plan) { removeAbsenceRows_(plan.dateStr, plan.absentTeachers); };
  `;
  const ctx = load(FILES, MOCK + over);
  const run = ctx.run;
  run('ensureRosterTabs_()');
  run(`__put(${J(T)}, 2, 3, ${J(rosterRows)})`);
  run('__ss.insertSheet(SS.ABSENCE); writeAbsenceRegisterTab_()');
  // the shared mock's deleteRows only shrinks the grid; make it really remove the rows
  run(`(function () {
    var sh = sheet_(SS.ABSENCE), cells = sh.cells;
    sh.deleteRows = function (start, n) {
      var moved = {};
      Object.keys(cells).forEach(function (k) {
        var p = k.split(','), r = +p[0];
        if (r >= start && r < start + n) return;
        moved[(r >= start + n ? r - n : r) + ',' + p[1]] = cells[k];
      });
      Object.keys(cells).forEach(function (k) { delete cells[k]; });
      Object.keys(moved).forEach(function (k) { cells[k] = moved[k]; });
      return sh;
    };
  })()`);
  run('clearRosterCache_(); clearCache();');
  return {
    run,
    headers: () => run(`sheet_(SS.ABSENCE).getRange(2, 1, 1, sheet_(SS.ABSENCE).getLastColumn()).getValues()[0]`),
    data: () => {
      const n = run('sheet_(SS.ABSENCE).getLastRow()');
      if (n < 3) return [];
      return run(`sheet_(SS.ABSENCE).getRange(3, 1, ${n - 2}, sheet_(SS.ABSENCE).getLastColumn()).getValues()`);
    },
    commit: names => run(`commitPlan({ok:true, dateStr:'2026-10-27', day:'Tuesday', weekKey:'2026-W44', assignments:[],
      absentTeachers:${J(names)}, absences:${J(names.map(n => ({ teacher: n, scope: 'LEAVE_FULL', periodsAway: 'all', scheduled: 2, toCover: 2, covered: 2, uncovered: 0, reassignedAway: 0 })))},
      summary:{assigned:0, unassigned:0, reassigned:0}}, 'coord@example.test')`),
  };
}
const find = (t, name) => {
  const h = t.headers();
  return t.data().filter(r => r[h.indexOf('Teacher')] === name).map(r => ({
    code: r[h.indexOf('Staff Code')], email: r[h.indexOf('Staff Email')] }));
};

const ROSTER = [
  row('Staff A', { 'Staff Code': 'S0001', Email: 'Staff.A@Example.Test', 'Match Status': 'Confirmed' }),
  row('Staff B', { 'Staff Code': 'S0002', Email: 'staff.b@example.test', 'Match Status': 'Suggested' }),
  row('Staff C', { 'Staff Code': 'S0003', Email: 'staff.c@example.test', 'Match Status': 'Confirmed' }),
  row('Staff C', { 'Staff Code': 'S0004', Email: 'staff.c2@example.test', 'Match Status': 'Confirmed' }),
  { 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
];
const setup = () => { const t = fresh(ROSTER); t.run('lockNewStaffCodes_()'); t.run('clearRosterCache_(); clearCache();'); return t; };
const text = w => w.map(x => x.teacher + ':' + x.missing.join('+')).join('|');

{ // found teacher, name-only, unconfirmed email, duplicate name, not on roster
  const t = setup();
  const res = t.commit(['Staff A', 'Staff B', 'Staff C', 'Consultant R', 'Staff Z']);
  check('commit succeeds with keys to resolve', res.ok === true);
  check('R17 a fully keyed teacher gets the locked code and the lower-case confirmed email',
    J(find(t, 'Staff A')) === J([{ code: 'S0001', email: 'staff.a@example.test' }]), J(find(t, 'Staff A')));
  check('R17 an unconfirmed email stays blank but the locked code is written',
    J(find(t, 'Staff B')) === J([{ code: 'S0002', email: '' }]), J(find(t, 'Staff B')));
  check('a duplicate roster name gets blanks (never guessed)', J(find(t, 'Staff C')) === J([{ code: '', email: '' }]));
  check('a name-only teacher gets blanks', J(find(t, 'Consultant R')) === J([{ code: '', email: '' }]));
  check('a teacher not on the roster gets blanks', J(find(t, 'Staff Z')) === J([{ code: '', email: '' }]));
  const w = res.keyWarnings;
  check('R18 warns for unconfirmed email, duplicate name and not-on-roster, and NOT for name-only',
    text(w) === 'Staff B:Staff Email|Staff C:Staff Code+Staff Email|Staff Z:Staff Code+Staff Email', text(w));
  check('R18 warning reasons are given',
    /email not confirmed/.test(w[0].reason) && /duplicate name/.test(w[1].reason) && /not on the roster/.test(w[2].reason), J(w));
  check('R18 text names the count, the teachers and the reasons',
    /^Saved\. 3 teacher\(s\) are missing Staff Code \/ email, so One Way can't match them exactly: /.test(res.keyWarningText) &&
    /Staff B/.test(res.keyWarningText) && !/Consultant R/.test(res.keyWarningText), res.keyWarningText);
}

{ // unlocked code: typed but not locked yet
  const t = fresh([row('Staff A', { 'Staff Code': 'S0001', Email: 'staff.a@example.test', 'Match Status': 'Confirmed' })]);
  const res = t.commit(['Staff A']);
  check('a typed-but-unlocked code is not written, with a "not confirmed/locked" warning',
    J(find(t, 'Staff A')) === J([{ code: '', email: 'staff.a@example.test' }]) && /not confirmed\/locked/.test(res.keyWarnings[0].reason), J(res.keyWarnings));
}

{ // no warnings -> empty text
  const t = setup();
  const res = t.commit(['Staff A']);
  check('no warning text when every key is present', res.keyWarnings.length === 0 && res.keyWarningText === '');
}

{ // roster missing / unreadable: commit still succeeds
  const t = setup();
  t.run(`getRoster_ = function () { throw new Error('boom'); };`);
  const res = t.commit(['Staff A', 'Staff B']);
  check('roster read failure does not block the commit', res.ok === true && t.data().length === 2);
  check('roster read failure writes blanks', J(find(t, 'Staff A')) === J([{ code: '', email: '' }]));
  check('roster read failure warns for every teacher', res.keyWarnings.length === 2 && /could not be read/.test(res.keyWarnings[0].reason), J(res.keyWarnings));
  const t2 = setup();
  t2.run(`getRoster_ = function () { return { exists: false, rows: [], cols: {} }; };`);
  const r2 = t2.commit(['Staff A']);
  check('roster tab missing: blank and warning, commit succeeds',
    r2.ok === true && J(find(t2, 'Staff A')) === J([{ code: '', email: '' }]) && /tab is missing/.test(r2.keyWarnings[0].reason));
}

{ // one roster read per run
  const t = setup();
  t.run(`var __reads = 0; var __orig = readRosterRows_; readRosterRows_ = function () { __reads++; return __orig(); };`);
  t.commit(['Staff A', 'Staff B', 'Staff C', 'Consultant R', 'Staff Z']);
  check('the roster is read once per run for all absent teachers', t.run('__reads') === 1, String(t.run('__reads')));
}

{ // re-mark keeps keys, no duplicate rows
  const t = setup();
  t.commit(['Staff A', 'Staff B']);
  t.commit(['Staff A']);
  check('re-marking replaces the row and keeps the correct keys',
    J(find(t, 'Staff A')) === J([{ code: 'S0001', email: 'staff.a@example.test' }]), J(find(t, 'Staff A')));
  check('re-marking one teacher leaves the other teacher\'s keys alone', J(find(t, 'Staff B')) === J([{ code: 'S0002', email: '' }]));
}

{ // the first 16 columns are unchanged by the key work
  const t = setup();
  t.commit(['Staff A']);
  const h = t.headers();
  const r = t.data()[0];
  check('Register still has the 18 headers, first 16 unchanged', h.length === 18 && h[15] === 'Marked By' && h[16] === 'Staff Email' && h[17] === 'Staff Code');
  const get = n => r[h.indexOf(n)];
  check('the original columns hold their values',
    get('Date') === '2026-10-27' && get('Day') === 'Tuesday' && get('Week') === '2026-W44' && get('Teacher') === 'Staff A' &&
    get('Periods Scheduled') === 2 && get('Periods To Cover') === 2 && get('Covered') === 2 && get('Uncovered') === 0 &&
    get('Run ID') !== '' && get('Marked By') === 'coord@example.test', J(r));
}

{ // surfaces: grid status line, panel, Assign.js untouched logic
  const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  check('grid status line shows the R18 warning and turns amber', /keyWarningText/.test(src('MarkAbsenceTab.js')) && /C\.AMBER/.test(src('MarkAbsenceTab.js').slice(src('MarkAbsenceTab.js').indexOf('keyWarningText'))));
  check('side panel shows the R18 warning', /out\.keyWarningText/.test(src('Sidebar.html')));
  const t = setup();
  const res = t.commit(['Staff B']);
  t.run(`var __sheet = { getRange: function () { var o = { v: null, setValue: function (v) { this.v = v; __last = v; return this; }, setFontColor: function () { return this; } }; return o; } }; var __last = '';`);
  t.run(`setAbsenceStatus_(__sheet, 'x', C.AMBER)`);
  check('commit result carries keyWarningText for the grid', typeof res.keyWarningText === 'string' && res.keyWarningText.length > 0);
}
