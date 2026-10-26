/**
 * T-014: getMarkableTeachers_(), rosterWarnings_(), uiBootstrap rosterWarnings, Mark Absence wiring.
 * Spec: docs/PRD-roster.md D1, D2, R12, R13. Placeholder data only: the repo is public.
 */
const fs = require('fs');
const path = require('path');
const { load, DEFAULT_FILES } = require('./harness');
const { MOCK } = require('./sheetmock');

const FILES = DEFAULT_FILES.concat(['Reports.js', 'ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'AnalyticsTab.js',
  'HR.js', 'Setup.js', 'MarkAbsenceTab.js', 'Code.js', 'RosterTabs.js', 'Roster.js']);
const J = JSON.stringify;
const T = '🪪 Teachers';

function fresh(allot, opts) {
  opts = opts || {};
  const over = `
    var ALLOT = ${J(allot)}, ALLOT_FAILS = false;
    function getAllTeachers() { if (ALLOT_FAILS) throw new Error('source not connected'); return ALLOT.slice(); }
    function getTeacherMeta() { return {}; }
    function getConfig() { return defaultConfig_(); }
    function notifyOpsFailure_() {}
    function toast_() {}
    var __rr = 0, __origRead = readRosterRows_;
    readRosterRows_ = function () { __rr++; return __origRead(); };
  `;
  const ctx = load(FILES, MOCK + over);
  const t = { ctx, run: ctx.run };
  if (!opts.nobuild) t.run('ensureRosterTabs_()');
  t.roster = rows => t.run(`__put(${J(T)}, 2, 3, ${J(rows)})`);
  t.fresh = () => t.run('clearRosterCache_()');
  return t;
}
const row = (name, o) => Object.assign({ 'Display Name': name, Category: 'Teaching', Active: true }, o || {});
const full = (name, code, o) => row(name, Object.assign({ 'Staff Code': code, 'Staff Code (Locked)': code, Email: name.toLowerCase().replace(/ /g, '.') + '@example.test', 'Match Status': 'Confirmed' }, o || {}));

{ // inactive hidden, fail-open, order kept
  const t = fresh(['Staff A', 'Staff C', 'Staff D']);
  t.roster([full('Staff A', 'S0001'), full('Staff C', 'S0002', { Active: false })]);
  t.fresh();
  const m = t.run('getMarkableTeachers_()');
  check('T-014: an Active=FALSE teacher is hidden', !m.includes('Staff C'));
  check('T-014: a teacher missing from the roster is still offered (fail-open)', m.includes('Staff D') && m.includes('Staff A'));
  check('T-014: Allotment order is kept', J(m) === J(['Staff A', 'Staff D']));
  check('T-014: getAllTeachers is unchanged by the roster', J(t.run('getAllTeachers()')) === J(['Staff A', 'Staff C', 'Staff D']));
}

{ // a blank Active cell defaults to active; a duplicated name is hidden only if all rows inactive
  const t = fresh(['Staff A', 'Staff C']);
  t.roster([row('Staff A', { Active: '' }), row('Staff C', { Active: false }), row('Staff C', { Active: true })]);
  t.fresh();
  check('T-014: blank Active and a half-active duplicate stay offered', J(t.run('getMarkableTeachers_()')) === J(['Staff A', 'Staff C']));
}

{ // roster missing / unreadable => full Allotment list
  const t = fresh(['Staff A', 'Staff C'], { nobuild: true });
  check('T-014: roster tab missing => plain Allotment list', J(t.run('getMarkableTeachers_()')) === J(['Staff A', 'Staff C']));
  check('T-014: roster tab missing => warnings unavailable, no throw', t.run('rosterWarnings_().available') === false);
  const u = fresh(['Staff A', 'Staff C']);
  u.run('getRoster_ = function () { throw new Error("boom"); }');
  check('T-014: unreadable roster => plain Allotment list, no throw', J(u.run('getMarkableTeachers_()')) === J(['Staff A', 'Staff C']));
  check('T-014: unreadable roster => warnings unavailable, no throw', u.run('rosterWarnings_().available') === false);
  const v = fresh(['Staff A']);
  v.run('ALLOT_FAILS = true');
  check('T-014: an Allotment failure still surfaces (uiBootstrap reports it)', v.run('(function(){ try { getMarkableTeachers_(); return false; } catch (e) { return e.message; } })()') === 'source not connected');
  check('T-014: uiBootstrap reports the source error and still returns', v.run('uiBootstrap().sourceErr') === 'source not connected');
}

{ // name-only and non-teaching never appear (not in the Allotment); warnings content
  const t = fresh(['Staff A', 'Staff B', 'Staff C', 'Staff D', 'Staff E', 'Staff F']);
  t.roster([
    full('Staff A', 'S0001'),
    row('Staff B', { 'Staff Code': 'S0002', 'Staff Code (Locked)': 'S0002' }),   // no confirmed email
    full('Staff C', 'S0003', { 'Staff Code': '', 'Staff Code (Locked)': '' }),   // no code
    full('Staff E', 'S0005'), full('Staff E', 'S0006'),                          // duplicate name
    { 'Display Name': 'Resource R', Category: 'Resource Person', Active: true }, // name-only, not an Allotment teacher
    { 'Display Name': 'Support P', Category: 'Support Staff', Active: true, 'Staff Code': 'S0900', 'Staff Code (Locked)': 'S0900' },
    full('Staff F', 'S0007', { Active: false }),
  ]);
  t.fresh();
  const m = t.run('getMarkableTeachers_()');
  check('T-014: roster-only names (name-only, non-teaching) never appear as teachers', !m.includes('Resource R') && !m.includes('Support P'));
  const w = t.run('rosterWarnings_()');
  check('T-014: warnings available', w.available === true);
  check('T-014: Staff D is missing from the roster', J(w.missingFromRoster) === J({ count: 1, names: ['Staff D'] }));
  check('T-014: Staff C has no Staff Code', J(w.missingCode) === J({ count: 1, names: ['Staff C'] }));
  check('T-014: Staff B has no confirmed email', J(w.missingEmail) === J({ count: 1, names: ['Staff B'] }));
  check('T-014: Staff E is a duplicate name and is not also counted for code/email', J(w.duplicateNames) === J({ count: 1, names: ['Staff E'] }) && !w.missingCode.names.includes('Staff E'));
  check('T-014: an inactive teacher is not in the warnings (not offered)', !JSON.stringify(w).includes('Staff F'));
  check('T-014: warnings carry no codes or emails', !/S0\d{3}|example\.test/.test(JSON.stringify(w)));
  const txt = t.run('rosterWarningText_(rosterWarnings_())');
  check('T-014: status text names the counts', /1 not on the/.test(txt) && /1 without a Staff Code/.test(txt) && /1 without a confirmed email/.test(txt) && /duplicate/.test(txt));
  check('T-014: no warnings => empty text', t.run('rosterWarningText_({available:true,missingFromRoster:{count:0,names:[]},missingCode:{count:0,names:[]},missingEmail:{count:0,names:[]},duplicateNames:{count:0,names:[]}})') === '');
}

{ // name-only teacher in the Allotment: no code/email warning (D11)
  const t = fresh(['Resource R']);
  t.roster([{ 'Display Name': 'Resource R', Category: 'Resource Person', Active: true, 'Staff Code': 'N/A', Email: 'N/A' }]);
  t.fresh();
  const w = t.run('rosterWarnings_()');
  check('T-014: a name-only person is never flagged for code or email (D11)', w.missingCode.count === 0 && w.missingEmail.count === 0 && w.missingFromRoster.count === 0);
}

{ // uiBootstrap + single read + dropdown
  const t = fresh(['Staff A', 'Staff C', 'Staff D']);
  t.roster([full('Staff A', 'S0001'), full('Staff C', 'S0002', { Active: false })]);
  t.fresh(); t.run('__rr = 0');
  const b = t.run('uiBootstrap()');
  check('T-014: uiBootstrap teachers exclude the inactive one', J(b.teachers) === J(['Staff A', 'Staff D']));
  check('T-014: uiBootstrap carries rosterWarnings', b.rosterWarnings && b.rosterWarnings.missingFromRoster.names[0] === 'Staff D');
  check('T-014: one roster read for the whole bootstrap', t.run('__rr') === 1);

  t.run('(function(){ var sh = sheet_(SS.MARK_ABSENCE) || ss_().insertSheet(SS.MARK_ABSENCE); })()');
  t.run(`(function(){ var sh = sheet_(SS.MARK_ABSENCE); var orig = sh.getRange;
    sh.getRange = function () { var rg = orig.apply(sh, arguments); rg.setDataValidation = function (rule) { __dv = rule; return rg; }; return rg; };
    refreshAbsenceTabTeacherList_(); })()`.replace('(function', 'var __dv; (function'));
  const dv = t.run('typeof __dv === "undefined" ? null : (__dv && (__dv.list || __dv.values || __dv))');
  check('T-014: the grid dropdown is fed the markable list', dv && J(dv).includes('Staff D') && !J(dv).includes('Staff C'), J(dv));
}

{ // typing an inactive name still works and yields a visible warning
  const t = fresh(['Staff A', 'Staff C']);
  t.roster([full('Staff A', 'S0001'), full('Staff C', 'S0002', { Active: false })]);
  t.fresh();
  check('T-014: rosterInactiveAmong_ finds the typed inactive name', J(t.run('rosterInactiveAmong_(["Staff A","Staff C"])')) === J(['Staff C']));
  const src = fs.readFileSync(path.join(__dirname, '..', 'MarkAbsenceTab.js'), 'utf8');
  check('T-014: the grid keeps setAllowInvalid(true)', /setAllowInvalid\(true\)/.test(src));
  check('T-014: the run path appends the inactive warning without blocking', /Marked Inactive on the roster/.test(src) && /writeAbsenceResults_\(sheet, plan, mode, res, notes/.test(src));
  const html = fs.readFileSync(path.join(__dirname, '..', 'Sidebar.html'), 'utf8');
  check('T-014: Sidebar renders rosterWarnings', /renderRosterWarn\(b\.rosterWarnings\)/.test(html) && /id="rosterWarn"/.test(html));
}
