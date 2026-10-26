/**
 * T-015: resolveContact_() (PRD D7, R14, R15). Placeholder data only: the repo is public.
 * Roster first (Confirmed Email only), then importHR by EXACT name, read by header name.
 */
const { load, DEFAULT_FILES } = require('./harness');
const { MOCK } = require('./sheetmock');

const FILES = DEFAULT_FILES.concat(['Reports.js', 'ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'AnalyticsTab.js',
  'HR.js', 'Setup.js', 'MarkAbsenceTab.js', 'Code.js', 'MatchEngine.js', 'RosterTabs.js', 'Roster.js']);
const J = JSON.stringify;
const eq = (a, b) => J(a) === J(b);
const row = (name, o) => Object.assign({ 'Display Name': name, Category: 'Teaching', Active: true }, o || {});
const T = '🪪 Teachers';

/**
 * hr: array of [name, email, chat]; headers: row-2 header texts (default frozen set).
 * cfg: Config overrides (for the send flags and the column-number fallback).
 */
function fresh(o) {
  o = o || {};
  const over = `
    var __cfg = ${J(o.cfg || {})};
    function getConfig() { return Object.assign(defaultConfig_(), __cfg); }
    function getAllTeachers() { return []; }
    function getTeacherMeta() { return {}; }
    var __ops = [], __mail = [], __dms = [];
    function notifyOpsFailure_(w, m) { __ops.push([w, m]); }
    var __toasts = [], __status = [];
    function toast_(m) { __toasts.push(m); }
    function setAbsenceStatus_(sh, msg) { __status.push(msg); }
    MailApp.sendEmail = function (m) { __mail.push(m); };
    function sendChatDm_(t, text) { __dms.push([t, text]); }
  `;
  const ctx = load(FILES, MOCK + over);
  const run = ctx.run;
  run('ensureRosterTabs_()');
  const t = { ctx, run };
  t.roster = rows => run(`__put(${J(T)}, 2, 3, ${J(rows)})`);
  t.hr = (hr, headers) => {
    headers = headers || ['Teacher Name', 'Email', 'Chat User ID (users/123…)'];
    run(`(function(){ var sh = __ss.insertSheet(SS.IMPORT_HR); sh.maxRows = ${hr.length + 50}; var H = ${J(headers)}, D = ${J(hr)};
      for (var c = 0; c < H.length; c++) sh.cells['2,' + (c + 1)] = H[c];
      for (var i = 0; i < D.length; i++) for (var j = 0; j < D[i].length; j++) if (D[i][j] !== '') sh.cells[(i + 3) + ',' + (j + 1)] = D[i][j];
    })()`);
    // count every range read on importHR
    run(`(function(){ var sh = __book.sheets[SS.IMPORT_HR], g = sh.getRange; sh.__reads = 0;
      sh.getRange = function () { sh.__reads++; return g.apply(sh, arguments); }; })()`);
  };
  t.res = name => { run('clearCache()'); return run(`resolveContact_(${J(name)})`); };
  t.reads = () => run('__book.sheets[SS.IMPORT_HR].__reads');
  return t;
}
const HR = [
  ['Staff A', 'staff.a@example.test', 'users/101'],
  ['Staff B', 'staff.b@example.test', 'users/102'],
  ['Asha Example', 'asha.example@example.test', 'users/201'],
  ['Staff A Office', 'office.staffa@example.test', 'users/301'],
];

/* ── exact hit ── */
{
  const t = fresh(); t.hr(HR); t.roster([]);
  const r = t.res('Staff B');
  check('exact normalised name hit comes from importHR with email and Chat id',
    r.source === 'importHR' && r.email === 'staff.b@example.test' && r.chatId === 'users/102' && !r.ambiguous, J(r));
  const r2 = t.res('  staff   b ');
  check('the name is normalised (case and runs of spaces) before the exact comparison', r2.source === 'importHR' && r2.email === 'staff.b@example.test', J(r2));
}

/* ── prefix near-miss: the old code matched these; the new code must not ── */
{
  const t = fresh(); t.hr(HR); t.roster([]);
  const asha = t.res('Asha');
  check('regression: "Asha" no longer prefix-matches "Asha Example" (old code returned that account)',
    asha.source === 'none' && asha.email === '' && asha.chatId === '', J(asha));
  const longer = t.res('Asha Example Two');
  check('regression: "Asha Example Two" does not match "Asha Example" (the reverse-direction prefix)', longer.source === 'none' && longer.email === '', J(longer));
  const t2 = fresh(); t2.hr([['Staff A Office', 'office.staffa@example.test', 'users/301'], ['Staff B', 'staff.b@example.test', 'users/102']]); t2.roster([]);
  const mailbox = t2.res('Staff A');
  check('regression: "Staff A" never lands on the shared mailbox "Staff A Office"', mailbox.source === 'none' && mailbox.email === '', J(mailbox));
  check('a near-miss says why nothing was found', /no exact name match/.test(asha.reason), asha.reason);
  // the old algorithm, run against the same data, for contrast
  const old = (map, key) => { if (map[key]) return map[key]; for (const k in map) if (k.indexOf(key) === 0 || key.indexOf(k) === 0) return map[k]; return null; };
  const m = { 'asha example': 'x' };
  check('contrast: the removed prefix rule would have matched', old(m, 'asha') === 'x');
}

/* ── roster beats importHR ── */
{
  const t = fresh(); t.hr(HR);
  t.roster([row('Staff A', { Email: 'staff.a.new@example.test', 'Match Status': 'Confirmed' })]);
  const r = t.res('Staff A');
  check('roster Confirmed Email beats the importHR email for the same name',
    r.source === 'roster' && r.email === 'staff.a.new@example.test', J(r));
  check('with a roster email, the Chat id is taken from importHR by exact EMAIL (none here, so blank)', r.chatId === '' && /Chat id/.test(r.reason), J(r));
  const t2 = fresh(); t2.hr([['Someone Else', 'staff.a.new@example.test', 'users/777']]);
  t2.roster([row('Staff A', { Email: 'Staff.A.New@example.test', 'Match Status': 'Confirmed' })]);
  const r2 = t2.res('Staff A');
  check('the Chat id follows the roster email, case-insensitively, whatever name importHR holds', r2.source === 'roster' && r2.chatId === 'users/777', J(r2));
  const t3 = fresh(); t3.hr([['P', 'shared@example.test', 'users/1'], ['Q', 'shared@example.test', 'users/2']]);
  t3.roster([row('Staff A', { Email: 'shared@example.test', 'Match Status': 'Confirmed' })]);
  check('an email on two importHR accounts with different Chat ids gives no Chat id', t3.res('Staff A').chatId === '' && t3.res('Staff A').email === 'shared@example.test');
}

/* ── unconfirmed roster email is never used ── */
{
  const t = fresh(); t.hr(HR);
  t.roster([row('Staff A', { Email: 'typed@example.test', 'Match Status': 'Needs review' })]);
  const r = t.res('Staff A');
  check('an unconfirmed roster Email is never used; D7 step 2 (exact importHR name) applies',
    r.source === 'importHR' && r.email === 'staff.a@example.test', J(r));
}

/* ── duplicate roster names ── */
{
  const t = fresh(); t.hr(HR);
  t.roster([row('Staff A', { Email: 'one@example.test', 'Match Status': 'Confirmed' }), row('Staff A', { Email: 'two@example.test', 'Match Status': 'Confirmed' })]);
  const r = t.res('Staff A');
  check('duplicate roster names are ambiguous and resolve to none (importHR is not tried)',
    r.source === 'none' && r.ambiguous === true && r.email === '' && r.chatId === '', J(r));
  // duplicate importHR names
  const u = fresh(); u.hr([['Staff X', 'x1@example.test', 'users/1'], ['staff  x', 'x2@example.test', 'users/2']]); u.roster([]);
  const r2 = u.res('Staff X');
  check('two importHR accounts with one normalised name are ambiguous and resolve to none', r2.source === 'none' && r2.ambiguous === true && /2 accounts/.test(r2.reason), J(r2));
}

/* ── exclusion: a shared mailbox with the exact name is not a person ── */
{
  const t = fresh(); t.hr([['Front Desk Team', 'office@example.test', 'users/9'], ['Staff B', 'staff.b@example.test', 'users/102']]); t.roster([]);
  const r = t.res('Front Desk Team');
  check('an exact-name hit on a shared/device account is excluded, with the reason', r.source === 'none' && /shared or device/.test(r.reason), J(r));
}

/* ── name-only and no-email rows are none, not errors ── */
{
  const t = fresh(); t.hr(HR);
  t.roster([{ 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
            row('Staff B', { Email: 'staff.b@example.test', 'Match Status': 'Confirmed' }),
            row('Staff N')]);
  const rp = t.res('Consultant R');
  check('a Resource Person (name-only) resolves to none by design', rp.source === 'none' && rp.email === '' && /by design/.test(rp.reason) && !rp.ambiguous, J(rp));
  const n = t.res('Staff N');
  check('a roster row with no email and no importHR row resolves to none', n.source === 'none' && /no confirmed email/.test(n.reason), J(n));
  const t2 = fresh(); t2.hr([['Staff N', '', '']]); t2.roster([row('Staff N')]);
  check('an importHR row with no email and no Chat id resolves to none', t2.res('Staff N').source === 'none');
  const t3 = fresh(); t3.hr([['Staff N', 'N/A', 'users/5']]); t3.roster([]);
  const p = t3.res('Staff N');
  check('an N/A placeholder email is treated as blank', p.email === '' && p.chatId === 'users/5', J(p));
}

/* ── importHR is read by header name ── */
{
  const t = fresh();
  t.hr([['users/102', 'Staff B', 'staff.b@example.test', 'junk'], ['users/101', 'Staff A', 'staff.a@example.test', 'junk']],
       ['Chat User ID (users/123…)', 'Teacher Name', 'Email', 'Notes']);
  t.roster([]);
  const r = t.res('Staff A');
  check('shuffled importHR columns are found by header name', r.source === 'importHR' && r.email === 'staff.a@example.test' && r.chatId === 'users/101', J(r));
  check('no fallback is reported when the headers are found', r.columnFallback === false && t.run('readImportHrContacts_().usedFallback') === false);
  const u = fresh();
  u.hr([['Staff A', 'staff.a@example.test', 'users/101']], ['TEACHER NAME', ' email ', 'chat user id']);
  u.roster([]);
  check('headers are case and space insensitive', u.res('Staff A').email === 'staff.a@example.test');
}

/* ── fallback to Config column numbers, flagged ── */
{
  const t = fresh({ cfg: { hrNameCol: 2, hrEmailCol: 3, hrChatCol: 1 } });
  t.hr([['users/101', 'Staff A', 'staff.a@example.test']], ['Chat', 'Full name', 'Mail']);
  t.roster([]);
  const r = t.res('Staff A');
  check('with no recognisable headers the Config column numbers are used', r.source === 'importHR' && r.email === 'staff.a@example.test' && r.chatId === 'users/101', J(r));
  check('and the result says the fallback was used', r.columnFallback === true && /Config column numbers/.test(t.run('readImportHrContacts_().fallbackReason')), J(r));
  check('the fallback reason names the missing header', /Teacher Name/.test(t.run('readImportHrContacts_().fallbackReason')));
  const e = fresh(); e.roster([]);
  const none = e.res('Staff A');
  check('a missing importHR tab resolves to none with the reason, and does not throw', none.source === 'none' && /importHR/.test(none.reason), J(none));
}

/* ── no roster tab at all ── */
{
  const t = fresh({}); t.hr(HR);
  t.run(`__ss.deleteSheet(__book.sheets[SS.ROSTER]); clearRosterCache_(); clearCache();`);
  check('without a roster tab, an exact importHR name still resolves', t.res('Staff B').email === 'staff.b@example.test');
}

/* ── performance: one importHR read per run, 2,400 rows ── */
{
  const big = [];
  const nm = i => String.fromCharCode(97 + Math.floor(i / 676) % 26) + String.fromCharCode(97 + Math.floor(i / 26) % 26) + String.fromCharCode(97 + i % 26);   // aaa, aab, ... (digits in a local part are excluded as device accounts)
  for (let i = 0; i < 2400; i++) big.push(['Person ' + nm(i), 'person.' + nm(i) + 'x@example.test', 'users/' + (1000 + i)]);
  const t = fresh(); t.hr(big);
  t.roster([row('Person ' + nm(5), { Email: 'roster.five@example.test', 'Match Status': 'Confirmed' })]);
  t.run('clearCache()');
  const t0 = Date.now();
  const names = []; for (let i = 0; i < 40; i++) names.push('Person ' + nm(i * 50));
  names.push('Person ' + nm(5), 'Nobody Here', 'Person');
  const out = names.map(n => t.run(`resolveContact_(${J(n)})`));
  const ms = Date.now() - t0;
  check('43 lookups against 2,400 importHR rows read the sheet exactly once', t.reads() === 1, 'reads=' + t.reads());
  check('every exact hit resolved; the near-misses did not', out.slice(0, 40).every((r, i) => r.email === 'person.' + nm(i * 50) + 'x@example.test') &&
    out[40].source === 'roster' && out[41].source === 'none' && out[42].source === 'none');
  check('2,400 rows and 43 lookups run in well under a second', ms < 1000, ms + ' ms');
  check('a repeated lookup is memoised (same object)', t.run(`resolveContact_("Person ${nm(7)}") === resolveContact_("Person ${nm(7)}")`));
  check('the 2,400-row fixture is plain placeholder data', big.every(r => /@example\.test$/.test(r[1])));
}

/* ── sendNotifications_: email, DM and the not-notified list (R15) ── */
{
  const plan = byTeacher => ({ ok: true, dateStr: '2026-10-26', prettyDate: 'Mon 26 Oct', absentTeachers: ['Staff Z'], assignments: [],
    summary: { assigned: 0, unassigned: 0, reassigned: 0, byTeacher }, weekKey: 'W', poolSize: 1 });
  const rows = n => [{ period: 1, classSec: '5A', subject: 'Maths', absent: 'Staff Z' }];
  const t = fresh({ cfg: { sendEmail: true, sendDm: true, sendChatCard: false } });
  t.hr(HR);
  t.roster([{ 'Display Name': 'Consultant R', Category: 'Resource Person', Active: true },
            row('Staff A', { Email: 'staff.a.new@example.test', 'Match Status': 'Confirmed' })]);
  const p = plan({ 'Staff A': rows(), 'Staff B': rows(), 'Asha': rows(), 'Consultant R': rows() });
  t.ctx.__plan = p;
  t.run('clearCache()');
  t.run('sendNotifications_(__plan)');
  const nn = p.notNotified;
  check('not-notified lists exactly the people with no resolvable contact, sorted, with reasons',
    eq(nn.map(x => x.name), ['Asha', 'Consultant R']) && nn.every(x => x.reason), J(nn));
  check('the Resource Person is listed as expected (by design), not as an error', /by design/.test(nn[1].reason) && !p.contactError, J(nn));
  const mailTo = t.run('__mail.map(function(m){return m.to})');
  check('emails go to the roster email for Staff A and the exact importHR email for Staff B, and never to the prefix match',
    eq(mailTo.sort(), ['staff.a.new@example.test', 'staff.b@example.test']), J(mailTo));
  check('DMs go to Chat ids resolved by the same function (no prefix hit for Asha)', eq(t.run('__dms.map(function(d){return d[0]})').sort(), ['users/102']), J(t.run('__dms')));
  check('the Chat card carries a NOT NOTIFIED section naming them',
    (() => { const card = t.run('buildPlanCard_(__plan, getConfig())'); const s = J(card); return /NOT NOTIFIED/.test(s) && /Asha/.test(s) && /Consultant R/.test(s); })());
  check('a plan with everyone reachable adds no NOT NOTIFIED section', (() => {
    const q = plan({ 'Staff B': rows() }); t.ctx.__plan2 = q; t.run('clearCache(); sendNotifications_(__plan2)');
    return q.notNotified.length === 0 && !/NOT NOTIFIED/.test(J(t.run('buildPlanCard_(__plan2, getConfig())')));
  })());
  const only = fresh({ cfg: { sendEmail: false, sendDm: false, sendChatCard: false } });
  only.hr(HR); only.roster([]); only.ctx.__plan = plan({ Asha: rows() });
  only.run('sendNotifications_(__plan)');
  check('with email and DM both off nobody is "not notified" (no personal channel is on)', eq(only.ctx.__plan.notNotified, []));
  const dmOnly = fresh({ cfg: { sendEmail: false, sendDm: true, sendChatCard: false } });
  dmOnly.hr([['Staff B', 'staff.b@example.test', '']]); dmOnly.roster([]); dmOnly.ctx.__plan = plan({ 'Staff B': rows() });
  dmOnly.run('sendNotifications_(__plan)');
  check('DM-only: a person with an email but no Chat id is listed with that reason',
    dmOnly.ctx.__plan.notNotified.length === 1 && /Chat user ID/.test(dmOnly.ctx.__plan.notNotified[0].reason), J(dmOnly.ctx.__plan.notNotified));
  const fb = fresh({ cfg: { sendEmail: true, sendChatCard: false, hrNameCol: 1, hrEmailCol: 2, hrChatCol: 3 } });
  fb.hr([['Staff B', 'staff.b@example.test', 'users/102']], ['Name', 'Mail', 'Chat']); fb.roster([]); fb.ctx.__plan = plan({ 'Staff B': rows() });
  fb.run('sendNotifications_(__plan)');
  check('when the Config-column fallback was used the plan says so', /Config column numbers/.test(fb.ctx.__plan.contactFallback), fb.ctx.__plan.contactFallback);
}

/* ── Check roster: contact changes (info only) ── */
{
  const t = fresh();
  t.hr([['Staff A', 'staff.a.old@example.test', 'users/1'], ['Staff B', 'staff.b@example.test', 'users/2'], ['Staff C', 'staff.c@example.test', 'users/3']]);
  t.roster([row('Staff A', { Email: 'staff.a.new@example.test', 'Match Status': 'Confirmed' }),
            row('Staff B', { Email: 'staff.b@example.test', 'Match Status': 'Confirmed' }),
            row('Staff C', { Email: 'staff.c.new@example.test', 'Match Status': 'Needs review' })]);
  const run = withContacts => t.run(`(function(){ clearRosterCache_(); clearCache(); var s = readRosterRows_();
    return computeRosterCheck_({ rows: s.rows, settings: readRosterSettings_(), allotment: null, directory: null, loggedAdds: null
      ${withContacts ? ', contacts: readImportHrContacts_()' : ''} }); })()`);
  const base = run(false), withC = run(true);
  const ch = withC.findings.filter(f => f.kind === 'contact-change');
  check('a Confirmed roster email that differs from importHR is a contact-change warning', ch.length === 1 && ch[0].name === 'Staff A' && ch[0].level === 'warn', J(ch));
  check('the same email, and an unconfirmed email, are not contact changes', !ch.some(f => f.name === 'Staff B' || f.name === 'Staff C'));
  check('the contact change is information only: nothing else in the result changes',
    eq(withC.findings.filter(f => f.kind !== 'contact-change'), base.findings) && withC.counts.error === base.counts.error &&
    withC.counts.warn === base.counts.warn + 1);
  t.run('SpreadsheetApp.getUi().alert = function (t, b) { __ui.alerts.push({ title: t, body: b }); }');
  t.run('checkRoster()');
  const body = t.run('__ui.alerts[__ui.alerts.length - 1].body');
  check('Check roster shows a separate contact-changes section', /Contact changes/.test(body) && /staff\.a\.old@example\.test/.test(body), body);
}

/* ── no old lookups remain ── */
{
  const fs = require('fs'), path = require('path');
  const root = path.join(__dirname, '..');
  const src = fs.readdirSync(root).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]);
  const left = src.filter(([f, s]) => /\b(hrLookup_|lookupEmail_|lookupChatUserId_|getHrMap)\b/.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))).map(x => x[0]);
  check('no call site of hrLookup_, lookupEmail_, lookupChatUserId_ or getHrMap remains in the code', left.length === 0, J(left));
  const hr = src.find(x => x[0] === 'HR.js')[1].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  check('HR.js has no prefix or substring matching', !/indexOf\(key\)|startsWith|\.indexOf\(k\) === 0|\.substring|\.includes\(/.test(hr.replace(/h\.indexOf\(k\) === 0/, '')));
}

/* ── review round 1: fallback and contactError are visible everywhere, and Email never prefix-matches ── */
{
  // 3: "Email Verified" is not the address column
  const t = fresh();
  t.hr([['Staff A', 'yes', 'users/1']], ['Teacher Name', 'Email Verified', 'Chat User ID (users/123…)']);
  t.roster([]);
  const hr = t.run('clearCache(), readImportHrContacts_()');
  check('review 1.3: "Email Verified" is not read as the Email column (Email counts as missing, fallback used)',
    hr.usedFallback === true && eq(hr.missingHeaders, ['Email']), J(hr.missingHeaders));
  check('review 1.3: the fallback text says which header was missing', /header "Email" not found/.test(hr.fallbackReason) && /column position/.test(hr.fallbackReason), hr.fallbackReason);
  const u = fresh();
  u.hr([['Staff A', 'staff.a@example.test', 'users/1']], ['Name of teacher', 'Email Status', 'Chat User ID (users/123…)']); u.roster([]);
  check('review 1.3: Teacher Name does not prefix-match either', u.run('clearCache(), readImportHrContacts_()').missingHeaders.join() === 'Teacher Name,Email');
  const w = fresh();
  w.hr([['Staff A', 'staff.a@example.test', 'users/1']], ['Teacher Name', 'Email', 'Chat User ID (users/123…)']); w.roster([]);
  check('review 1.3: the Chat User ID header still matches with its suffix', w.res('Staff A').chatId === 'users/1' && !w.run('readImportHrContacts_().usedFallback'));

  // 1: Check roster surfaces the fallback
  t.roster([row('Staff A')]);
  const chk = t.run(`(function(){ clearRosterCache_(); clearCache(); var s = readRosterRows_();
    return computeRosterCheck_({ rows: s.rows, settings: readRosterSettings_(), allotment: null, directory: null, loggedAdds: null, contacts: readImportHrContacts_() }); })()`);
  const f = chk.findings.filter(x => x.kind === 'importhr-column-fallback');
  check('review 1.1: Check roster warns "importHR read by column position: header X not found"',
    f.length === 1 && f[0].level === 'warn' && /importHR read by column position: header "Email" not found/.test(f[0].text), J(f));
  t.run('SpreadsheetApp.getUi().alert = function (t, b) { __ui.alerts.push({ title: t, body: b }); }');
  t.run('checkRoster()');
  check('review 1.1: and the Check roster dialog shows it', /column position/.test(t.run('__ui.alerts[__ui.alerts.length - 1].body')));
  const ok = fresh(); ok.hr(HR); ok.roster([]);
  const chk2 = ok.run(`(function(){ clearRosterCache_(); clearCache(); return computeRosterCheck_({ rows: [], settings: readRosterSettings_(), allotment: null, directory: null, loggedAdds: null, contacts: readImportHrContacts_() }); })()`);
  check('review 1.1: no fallback finding when the headers are found', !chk2.findings.some(x => x.kind === 'importhr-column-fallback'));

  // 1 + 2: grid status line, quickMark, shared text
  const res = { ok: true, notified: true, notNotified: [{ name: 'Asha', reason: 'no match' }],
    contactFallback: 'importHR read by column position: header "Email" not found', contactError: 'boom' };
  const txt = t.run(`notifyNotesText_(${J(res)})`);
  check('review 1/2: the shared note names who, the fallback and the contact error',
    /not notified: Asha/.test(txt) && /column position/.test(txt) && /Could not work out who was not notified: boom/.test(txt), txt);
  check('review 1/2: nothing to say gives an empty note', t.run('notifyNotesText_({ ok: true })') === '' && t.run('notifyNotesText_(null)') === '');
  t.ctx.__res = res;
  t.run(`writeAbsenceResults_(sheet_(SS.ROSTER), { assignments: [], prettyDate: 'Mon 26 Oct', day: 'Mon', summary: { assigned: 0, unassigned: 0, reassigned: 0 } }, 'commit', __res)`);
  const st = t.run('__status[__status.length - 1]');
  check('review 1/2: the Mark Absence grid status line shows fallback and contactError',
    /column position/.test(st) && /Could not work out who was not notified: boom/.test(st) && /not notified: Asha/.test(st), st);
  t.run(`uiCommit = function () { return Object.assign({ assigned: 1, unassigned: 0 }, __res); };
    __ui.prompts = ['26/10/2026, Staff A']; quickMark();`);
  const toast = t.run('__toasts[__toasts.length - 1]');
  check('review 1/2: quickMark shows fallback and contactError',
    /column position/.test(toast) && /Could not work out who was not notified: boom/.test(toast), toast);
  const sb = require('fs').readFileSync(require('path').join(__dirname, '..', 'Sidebar.html'), 'utf8');
  check('review 1/2: the side panel shows both', /out\.contactFallback/.test(sb) && /Could not work out who was not notified/.test(sb));

  // 2: a throwing collectNotNotified_ still sets contactError (and the commit result carries it)
  const e = fresh({ cfg: { sendEmail: true, sendChatCard: false } });
  e.hr(HR); e.roster([]);
  e.run('collectNotNotified_ = function () { throw new Error("boom"); }');
  e.ctx.__plan = { absentTeachers: [], assignments: [], summary: { byTeacher: {} } };
  e.run('sendNotifications_(__plan)');
  check('review 1.2: a failing contact check sets contactError and an empty list', e.ctx.__plan.contactError === 'boom' && eq(e.ctx.__plan.notNotified, []));

  // small: roster email is lower-cased before the Chat id lookup
  const l = fresh(); l.hr([['Other', 'mixed@example.test', 'users/55']]);
  l.roster([row('Staff A', { Email: 'x@example.test', 'Match Status': 'Confirmed' })]);
  l.run('clearCache(); var __k = rosterJoinKeys_; rosterJoinKeys_ = function (n) { var r = __k(n); r.staffEmail = "Mixed@Example.test"; return r; }');
  check('review: a mixed-case roster email still finds its importHR Chat id', l.run('resolveContact_("Staff A")').chatId === 'users/55');
}
