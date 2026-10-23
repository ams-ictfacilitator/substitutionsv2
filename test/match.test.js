/** Matching engine (PRD-roster §5): pure functions, placeholder data only. */
const { load } = require('./harness');

const ctx = load(['MatchEngine.js']);
const run = ctx.run;
const call = (fn, ...args) => { ctx.__a = args; return run(`${fn}.apply(null, __a)`); };
const D = () => JSON.parse(JSON.stringify(run('MATCH_DEFAULTS')));   // fresh copy of the seed data
const S = D();

const T = (name, norm) => check('normName ' + JSON.stringify(name), call('matchNormName', name, S) === norm, call('matchNormName', name, S));

// ── normalisation, placeholders ────────────────────────────────────────
T("Dr. Asha  E-Kumar", 'asha e kumar');
T("MR  O'Neil_Example", 'o neil example');
T("Mrs. Ms Asha Example", 'asha example');
T("Miss", 'miss');                                   // never strips down to nothing
T("Ａｓｈａ Example", 'asha example');                // NFKC
check('tokens: initials are length 1', JSON.stringify(call('matchTokens', 'Asha E Kumar', S)) === '["asha","e","kumar"]');
['', ' ', 'N/A', 'na', 'n/a', ' - ', 'None', 'NIL', 'tbd', null, undefined].forEach(v =>
  check('placeholder ' + JSON.stringify(v), call('matchIsPlaceholder', v, S) === true));
check('real value is not a placeholder', call('matchIsPlaceholder', 'S0101', S) === false);
check('matchClean blanks placeholders only', call('matchClean', 'N/A', S) === '' && call('matchClean', ' S0101 ', S) === 'S0101');
check('placeholder list is settings-driven (R11)', (() => { const s = D(); s.placeholders = ['pending']; return call('matchIsPlaceholder', 'pending', s) && !call('matchIsPlaceholder', 'N/A', s); })());
check('local part forms for a 2-word name', JSON.stringify(call('matchLocalForms', 'Asha Example', S)) ===
  JSON.stringify(['asha.example', 'ashaexample', 'asha_example', 'asha.e', 'a.example', 'example.asha']));
check('3 words: first + each later word', call('matchLocalForms', 'Asha E Kumar Example', S).indexOf('asha.example') > -1 &&
  call('matchLocalForms', 'Asha Kumar Example', S).indexOf('asha.kumar') > -1 && call('matchLocalForms', 'Asha', S).length === 0);

// ── exclusions ─────────────────────────────────────────────────────────
const X = (name, email, s) => call('matchExclusion', { name, email }, s || S);
check('person is not excluded', X('Asha Example', 'asha.example@school.example') === null);
check('device local part excluded', /device/.test((X('Some Account', 'dev.device@school.example') || {}).rule));
check('digits regex excluded', X('Room Seven', 'class7a@school.example') !== null);
check('short local part excluded', /\^\[a-z\]/.test((X('Hr Team', 'hr@school.example') || {}).rule));
check('name keyword excluded (whole word)', /Name contains/.test((X('Chemistry Lab', 'chemistry.a@school.example') || {}).rule));
check('name keyword is not a substring match', X('Labanya Example', 'labanya.example@school.example') !== null ? /Local part contains/.test(X('Labanya Example', 'labanya.example@school.example').rule) : true);
check('single-token name excluded', /single/.test((X('Reception', 'frontx@school.example') || {}).rule));
check('allow list overrides', X('Chemistry Lab', 'chem.lab@school.example', Object.assign(D(), { allow: ['Chem.Lab@school.example'] })) === null);
check('disabled rule ignored', (() => { const s = D(); s.exclusions.forEach(r => r.enabled = false); return X('Chemistry Lab', 'chem.lab@school.example', s) === null; })());
check('Domain is / Exact email rules', (() => {
  const s = D(); s.exclusions.push({ type: 'Domain is', value: 'bots.example.test', reason: 'bots', enabled: true },
    { type: 'Exact email', value: 'boss.one@school.example', reason: 'x', enabled: true });
  return X('Asha Example', 'asha.example@bots.example.test', s) !== null && X('Boss One', 'boss.one@school.example', s) !== null;
})());
check('rules come only from settings (R11): empty rules exclude nothing', (() => {
  const s = D(); s.exclusions = []; return X('Chemistry Lab', 'chem.lab@school.example', s) === null;
})());
check('placeholder email is not a local part', X('Asha Example', 'N/A') === null);

// ── code check, categories, mapping ────────────────────────────────────
check('code ok / warning / none', call('matchCodeCheck', 'S0101', S).status === 'ok' && call('matchCodeCheck', 'x12', S).status === 'warning' &&
  call('matchCodeCheck', 'N/A', S).status === 'none' && call('matchCodeCheck', 's0101', S).code === 'S0101');
check('pattern is settings-driven', call('matchCodeCheck', 'X12', Object.assign(D(), { staffCodePattern: '^X[0-9]+$' })).status === 'ok');
check('category info', call('matchCategoryInfo', 'resource person', S).nameOnly === true && call('matchCategoryInfo', 'Support Staff', S).emailRequired === false &&
  call('matchCategoryInfo', 'Teaching', S).teaching === true);
check('HR category mapping ignores case/space', call('matchMapHrCategory', '  administration ', S).roster === 'Admin' &&
  call('matchMapHrCategory', 'Volunteers', S).unmapped === true);
check('duplicate codes ignore placeholders and non-Current', (() => {
  const recs = [
    { status: 'Current', staffCode: 'N/A' }, { status: 'Current', staffCode: 'N/A' }, { status: 'Current', staffCode: '-' }, { status: 'Current', staffCode: '' },
    { status: 'Current', staffCode: 's0300', row: 8 }, { status: 'Current', staffCode: 'S0300', row: 9 }, { status: 'Left', staffCode: 'S0400' }, { status: 'Current', staffCode: 'S0400' }];
  const d = call('matchDuplicateCodes', recs, S);
  return d.length === 1 && d[0].code === 'S0300' && d[0].rows.join() === '8,9';
})());

// ── Email ladder: ~30 roster names x ~200 importHR rows (R7) ───────────
const alpha = n => { let s = ''; n++; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const hrRow = (name, email) => ({ name, email, row: 0 });
const importHR = [
  hrRow('Asha E Kumar', 'asha.example@school.example'),           // worked example (R2)
  hrRow('Ravi Sample', 'ravi.sample@school.example'),               // exact
  hrRow('Meera Sample', 'meera.sample.device@school.example'),      // only exact match is an excluded account
  hrRow('Chemistry Lab', 'chem.lab@school.example'),                // device
  hrRow('Ipad Cart', 'ipad.cart1@school.example'),                   // device
  hrRow('Priya One', 'priya.one@school.example'),                   // same first name
  hrRow('Priya Two', 'priya.two@school.example'),
  hrRow('T Example', 'tara.example@school.example'),                // wanted by two roster rows
  hrRow('Dev Dup', 'dev.dup@school.example'),                       // duplicate email, two rows
  hrRow('D Dup', 'dev.dup@school.example'),
  hrRow('Sam Example', 'sam.example@school.example'),               // exact after honorific
  hrRow('Nobody Listed', 'N/A'), hrRow('Also Listed', 'n/a'), hrRow('Blank Mail', ''),   // N/A rows
  hrRow('Ana Sample Token', 'ana.token@school.example'),            // R3 two shared tokens
  hrRow('Leo Q Example', 'leo.qe@school.example'),                  // R3 first token + initial
  hrRow('Latha Example', 'latha.example@school.example'),           // exact; roster row already Confirmed elsewhere
];
for (let i = 0; i < 183; i++) importHR.push(hrRow(cap(alpha(i)) + ' ' + cap(alpha(i + 40)) + 'son', alpha(i) + '.' + alpha(i + 40) + 'son@school.example'));
check('importHR fixture has ~200 rows', importHR.length >= 195, String(importHR.length));

const R = (displayName, category, extra) => Object.assign({ displayName, category: category || 'Teaching', email: '', staffCode: '', matchStatus: '', active: true }, extra || {});
const roster = [
  R('Asha Example'), R('Ravi Sample'), R('Meera Sample'), R('Priya One'), R('Priya Two'), R('Priya Three'),
  R('Tara Example'), R('Tara Example Two'), R('Dr Sam Example'), R('Ana Sample'), R('Leo Q'), R('Zed Nowhere'),
  R('Latha Example', 'Teaching', { matchStatus: 'Confirmed', email: 'latha.example@school.example' }),
  R('Wanda Support', 'Support Staff'), R('Ravi Consultant', 'Resource Person'), R('Dev Dup'),
];
for (let i = 0; i < 14; i++) roster.push(R(cap(alpha(i)) + ' ' + cap(alpha(i + 40)) + 'son'));   // exact fillers -> 30 names
check('roster fixture has ~30 rows', roster.length === 30, String(roster.length));

ctx.__imp = importHR; ctx.__roster = roster; ctx.__S = S;
const E = run('matchEmailLinks(__roster, __imp, __S)');
const er = n => E.results[roster.findIndex(r => r.displayName === n)];

check('worked example: Asha Example -> Candidate via R2', er('Asha Example').class === 'Candidate' && er('Asha Example').rung === 'R2' &&
  er('Asha Example').candidates[0].email === 'asha.example@school.example' && er('Asha Example').prefill === '');
check('exact name -> Confirmed-exact, pre-filled Accept', er('Ravi Sample').class === 'Confirmed-exact' && er('Ravi Sample').prefill === 'Accept');
check('honorific stripped before exact match', er('Dr Sam Example').class === 'Confirmed-exact');
check('only exact match is an excluded account -> Ambiguous naming the rule', er('Meera Sample').class === 'Ambiguous' &&
  /device/.test(er('Meera Sample').excludedBy) && er('Meera Sample').prefill === '');
check('device accounts are excluded and reported', E.excluded.some(x => x.email === 'chem.lab@school.example') && E.excluded.some(x => x.email === 'ipad.cart1@school.example'));
check('device accounts are never candidates', E.results.every(r => r.candidates.every(c => !/chem\.lab|ipad\.cart/.test(c.email))));
check('two staff sharing a first name each get their own exact match', er('Priya One').class === 'Confirmed-exact' && er('Priya Two').candidates[0].email === 'priya.two@school.example');
check('first-name-only is Ambiguous, up to 3 shown, never accepted', er('Priya Three').class === 'Ambiguous' && er('Priya Three').rung === 'R4' &&
  er('Priya Three').candidates.length === 2 && er('Priya Three').prefill === '');
check('uniqueness pass: one email for two Active rows -> both Ambiguous', er('Tara Example').class === 'Ambiguous' && er('Tara Example Two').class === 'Ambiguous' &&
  er('Tara Example').demoted && /tara\.example@/.test(er('Tara Example').candidates[0].email));
check('R3 two shared tokens -> Candidate', er('Ana Sample').class === 'Candidate' && er('Ana Sample').rung === 'R3');
check('R3 first token + agreeing initial -> Candidate', er('Leo Q').class === 'Candidate' && er('Leo Q').rung === 'R3');
check('nothing found -> Unmatched', er('Zed Nowhere').class === 'Unmatched');
check('Confirmed rows are never re-matched', er('Latha Example').class === 'Already confirmed' && er('Latha Example').candidates.length === 0);
check('category with Email required = FALSE -> No email expected', er('Wanda Support').class === 'No email expected');
check('Resource Person is name-only: no email taken', er('Ravi Consultant').class === 'Name only' && er('Ravi Consultant').candidates.length === 0);
check('duplicate email in the directory counts as one account', er('Dev Dup').class === 'Confirmed-exact' && E.duplicateEmails.join() === 'dev.dup@school.example');
check('N/A and blank importHR emails never match or count', E.results.every(r => r.candidates.every(c => c.email && c.email !== 'n/a')) &&
  !E.results.some(r => r.candidates.some(c => /Nobody Listed|Also Listed|Blank Mail/.test(c.name))));
check('filler names all match exactly', E.results.slice(16).every(r => r.class === 'Confirmed-exact'));
check('counts summarise classes', E.counts['Confirmed-exact'] >= 17 && E.counts.Candidate === 3 && E.counts.Unmatched === 1);
check('deterministic (R7): same input, same output', JSON.stringify(run('matchEmailLinks(__roster, __imp, __S)')) === JSON.stringify(E));
check('inactive duplicate does not trigger the uniqueness pass', (() => {
  const r2 = roster.map(r => Object.assign({}, r)); r2.find(r => r.displayName === 'Tara Example Two').active = false; ctx.__r2 = r2;
  const e = run('matchEmailLinks(__r2, __imp, __S)'); return e.results[6].class === 'Candidate';
})());
check('two Active unrelated rows sharing a Staff Code stay a conflict (no rename-chain bypass)', (() => {
  const r2 = roster.map(r => Object.assign({}, r)); r2[6].staffCode = 'S0500'; r2[7].staffCode = 'S0500'; ctx.__r2 = r2;
  const e = run('matchEmailLinks(__r2, __imp, __S)'); return e.results[6].class === 'Ambiguous' && e.results[7].class === 'Ambiguous' && e.results[6].prefill === '';
})());
check('Replaced By on an Active row does not bypass the conflict', (() => {
  const r2 = roster.map(r => Object.assign({}, r)); r2[6].replacedBy = 'Tara Example Two'; ctx.__r2 = r2;
  const e = run('matchEmailLinks(__r2, __imp, __S)'); return e.results[6].class === 'Ambiguous' && e.results[7].class === 'Ambiguous';
})());

// ── regression: device-like addresses (Codex review defects 1, re-review 1) ──
{
  const imp = [hrRow('Lia Example', 'ipadcart1@school.example'), hrRow('Mo Sample', 'frontkiosk@school.example'), hrRow('Mira Example', 'mira.example@school.example'),
    hrRow('Asha Example', 'asha.example.alt@school.example'), hrRow('Labanya Example', 'labanya.example@school.example'), hrRow('Gus Example', 'lab2@school.example'),
    hrRow('Ipad Cart', 'ipad.cart@school.example')];
  const allow = Object.assign(D(), { allow: ['lab2@school.example', 'ipad.cart@school.example'] });
  ctx.__d = imp; ctx.__rd = [R('Lia Example'), R('Mo Sample'), R('Mira Example'), R('Asha Example'), R('Labanya Example'), R('Gus Example'), R('Ipad Cart')]; ctx.__al = allow;
  const d = run('matchEmailLinks(__rd, __d, __al)').results;
  check('glued device address with a trailing digit (ipadcart1) is not pre-filled, class >= Candidate, reason shown', d[0].class === 'Candidate' && d[0].prefill === '' &&
    d[0].deviceLike === true && /Device-like/.test(d[0].note) && d[0].candidates[0].deviceLike === true);
  check('device-like address without digits (frontkiosk) is held back', d[1].prefill === '' && d[1].class === 'Candidate' && d[1].deviceLike);
  check('device-like signal never excludes outright (candidate still listed)', d[0].candidates.length === 1 && d[0].excludedBy === '');
  check('person-form address containing a seed token (exam in example) is still Confirmed-exact', d[2].class === 'Confirmed-exact' && d[2].prefill === 'Accept' && d[2].deviceLike === false);
  check("'asha.example.alt@' for Asha Example stays Confirmed-exact and pre-filled", d[3].class === 'Confirmed-exact' && d[3].prefill === 'Accept' && !d[3].deviceLike);
  check("'labanya.example@' for Labanya Example is not flagged", d[4].class === 'Confirmed-exact' && d[4].prefill === 'Accept' && !d[4].deviceLike);
  check("'lab2@' is flagged (once allowed through the exclusion rules)", d[5].deviceLike === true && d[5].prefill === '' && d[5].class === 'Candidate');
  check('prefix-only glued run (ipadzz1) is flagged', (() => { ctx.__p = [hrRow('Nia Example', 'ipadzz1@school.example')]; ctx.__pr = [R('Nia Example')];
    return run('matchEmailLinks(__pr, __p, __al)').results[0].deviceLike === true; })());
  check("whole-run removal only: allow-listed 'cart.teacher@' for Art Teacher is device-like, no pre-fill", (() => {
    const s = Object.assign(D(), { allow: ['cart.teacher@school.example'] }); ctx.__s4 = s;
    ctx.__p4 = [hrRow('Art Teacher', 'cart.teacher@school.example')]; ctx.__r4 = [R('Art Teacher')];
    const r = run('matchEmailLinks(__r4, __p4, __s4)').results[0];
    return r.deviceLike === true && r.prefill === '' && r.class === 'Candidate'; })());
  check("a concatenated own name ('ashaexample@') is removed as a whole run", (() => {
    ctx.__p5 = [hrRow('Asha Example', 'ashaexample@school.example')]; ctx.__r5 = [R('Asha Example')];
    const r = run('matchEmailLinks(__r5, __p5, __S)').results[0]; return r.class === 'Confirmed-exact' && r.prefill === 'Accept'; })());
  check("'lab2@' is excluded outright by default", call('matchExclusion', { name: 'Gus Example', email: 'lab2@school.example' }, S) !== null);
  check("a person's own name is never a device signal (Ipad Cart at ipad.cart@)", d[6].class === 'Confirmed-exact' && !d[6].deviceLike);
  check('device-like signal tokens come from settings (R11)', (() => {
    const s = D(); s.exclusions = s.exclusions.filter(x => x.type === 'Honorific'); ctx.__s3 = s;
    return run('matchEmailLinks(__rd, __d, __s3)').results[0].prefill === 'Accept'; })());
}

// ── regression: emails already held (Codex review defect 2) ────────────
{
  const rh = [R('Ravi Sample'), R('Holder Row', 'Teaching', { matchStatus: 'Confirmed', email: 'Ravi.Sample@school.example' })];
  ctx.__rh = rh;
  const h = run('matchEmailLinks(__rh, __imp, __S)').results[0];
  check('email held by a confirmed Active row: proposal demoted, no pre-fill, holder named by Display Name', h.class === 'Ambiguous' && h.demoted && h.prefill === '' && /Holder Row/.test(h.note) && !/school\.example/.test(h.note));
  rh[1].active = false;
  check('held by an inactive row: no longer a holder', run('matchEmailLinks(__rh, __imp, __S)').results[0].prefill === 'Accept');
  rh[1].active = true; rh[1].replacedBy = 'Ravi Sample';
  check('Active holder with Replaced By is still a conflict', run('matchEmailLinks(__rh, __imp, __S)').results[0].prefill === '');
  rh[1].active = false;
  check('rename chain: older inactive row whose Replaced By names the new row is exempt', run('matchEmailLinks(__rh, __imp, __S)').results[0].prefill === 'Accept');
  ['Needs review', 'Ignored', 'No email', ''].forEach(st => {
    ctx.__rh3 = [R('Ravi Sample'), R('Holder Row', 'Teaching', { matchStatus: st, email: 'ravi.sample@school.example' })];
    const r = run('matchEmailLinks(__rh3, __imp, __S)').results[0];
    check('email typed on an Active row with Match Status ' + JSON.stringify(st) + ' is held: demoted, no pre-fill, holder named', r.class === 'Ambiguous' && r.demoted && r.prefill === '' && /Holder Row/.test(r.note));
  });
  ['Needs review', 'Ignored', ''].forEach(st => {
    ctx.__rh4 = [R('Ravi Sample', 'Teaching', { matchStatus: st, email: 'old@school.example' })];
    const r = run('matchEmailLinks(__rh4, __imp, __S)').results[0];
    check('Active row holding a DIFFERENT email (status ' + JSON.stringify(st) + '): Candidate, no pre-fill, no write flag, masked note', r.class === 'Candidate' && r.prefill === '' &&
      r.writeEmail === false && r.heldDifferent === true && /confirm by hand/.test(r.note) && /o\*\*\*@school\.example/.test(r.note) && !/old@school\.example/.test(r.note));
  });
  check('a held email equal to the proposal is unchanged (still pre-filled)', (() => { ctx.__rh5 = [R('Ravi Sample', 'Teaching', { matchStatus: 'Needs review', email: 'RAVI.sample@school.example' })];
    const r = run('matchEmailLinks(__rh5, __imp, __S)').results[0]; return r.prefill === 'Accept' && r.writeEmail === true && !r.heldDifferent; })());
  check('a placeholder email on the row is not a held email', (() => { ctx.__rh6 = [R('Ravi Sample', 'Teaching', { email: 'N/A' })];
    const r = run('matchEmailLinks(__rh6, __imp, __S)').results[0]; return r.prefill === 'Accept' && !r.heldDifferent; })());
  check('a row\'s own held email is not a conflict', (() => { ctx.__rh2 = [R('Ravi Sample', 'Teaching', { email: 'ravi.sample@school.example' })];
    return run('matchEmailLinks(__rh2, __imp, __S)').results[0].prefill === 'Accept'; })());
}

check('exclusion rules come from settings (R11): none -> device account becomes a candidate', (() => {
  const s = D(); s.exclusions = s.exclusions.filter(x => x.type === 'Honorific'); ctx.__s2 = s;
  ctx.__r3 = [R('Chemistry Lab')]; return run('matchEmailLinks(__r3, __imp, __s2)').results[0].class === 'Confirmed-exact';
})());

// ── performance (N2): 2,400-row directory x 120 roster names ─────────
{
  const big = [], bigRoster = [];
  const surnames = []; for (let i = 0; i < 30; i++) surnames.push(cap(alpha(i + 100)) + 'ar');
  for (let i = 0; i < 2400; i++) { const f = cap(alpha(i)) + 'a', l = surnames[i % 30]; big.push({ name: f + ' ' + l, email: f.toLowerCase() + '.' + l.toLowerCase() + '@school.example', row: i + 2 }); }
  for (let i = 0; i < 120; i++) bigRoster.push(R(i % 3 === 0 ? 'Unlisted' + alpha(i) + ' Nomatch' : big[i * 17].name));
  ctx.__big = big; ctx.__bigR = bigRoster;
  const t0 = Date.now();
  const B = run('matchEmailLinks(__bigR, __big, __S)');
  const ms = Date.now() - t0;
  check('2,400 x 120 completes well under 3 s (N2)', ms < 3000, ms + ' ms');
  check('exact rungs read postings, not the whole directory (no O(n*m))', B.stats.examined < 2400 * 120 / 20, 'examined ' + B.stats.examined);
  const exactOk = B.results.filter((r, i) => i % 3 !== 0).every(r => r.class === 'Confirmed-exact');
  check('big run: exact names matched, non-matches Unmatched', exactOk && B.results.filter((r, i) => i % 3 === 0).every(r => r.class === 'Unmatched'));
}

// ── Staff Code target (§5.8, D9-D11) ───────────────────────────────────
const H = (status, name, category, staffCode, officialEmail, extra) =>
  Object.assign({ status, name, category, teamRole: 'Role X', department: 'Dept X', staffCode, officialEmail, row: 0 }, extra || {});
const hr = [
  H('Current', 'Asha Example', 'Teaching staff', 'S0101', 'asha.example@school.example'),     // corroborated
  H('Current', 'Ravi Sample', 'Teaching staff', 'S0102', 'ravi.other@school.example'),         // corroboration conflict
  H('Current', 'Tara Example', 'Administration', 'X12', 'N/A'),                                // pattern failure
  H('Current', 'Wanda Support', 'Support staff', 'W0201', 'n/a'),
  H('Current', 'Sita Example', 'Support staff', 'N/A', 'N/A'),                                  // placeholder code
  H('Current', 'Gita Example', 'Support staff', 'n/a', '-'),
  H('Current', 'Rita Example', 'Support staff', 'TBD', ''),
  H('Current', 'Nila Example', 'Administration', '-', 'N/A'),
  H('Current', 'Ravi Consultant', 'Resource Person', 'S0999', 'ravi.consultant@school.example'),   // has a code: never taken
  H('Current', 'Uma Consultant', 'Resource Person', 'N/A', 'N/A'),
  H('Current', 'Vik Consultant', 'Resource Person', 'N/A', 'N/A'),
  H('Left', 'Old Admin', 'Administration', 'S0777', ''),                                         // not Current
  H('Current', 'Odd Category', 'Volunteers', 'S0888', ''),                                       // unmapped
  H('Current', 'Teach Only', 'Teaching staff', 'S0555', ''),                                     // teaching: never proposed
  H('Current', 'Dup One', 'Administration', 'S0300', ''),
  H('Current', 'Dup Two', 'Administration', 'S0300', ''),
  H('Current', 'Priya One', 'Teaching staff', 'S0601', ''),
  H('Current', 'Priya Two', 'Teaching staff', 'S0602', ''),
  H('Current', 'Priya Four', 'Teaching staff', 'S0604', ''),
  H('Current', 'Hana Kumar', 'Administration', 'S0701', ''),                                     // roster has two rows that hit it
];
hr.forEach((r, i) => r.row = i + 2);
const roster2 = [
  R('Asha Example', 'Teaching', { email: 'asha.example@school.example', matchStatus: 'Confirmed' }),
  R('Ravi Sample', 'Teaching', { email: 'ravi.sample@school.example', matchStatus: 'Confirmed' }),
  R('Tara Example', 'Admin'), R('Wanda Support', 'Support Staff'), R('Sita Example', 'Support Staff'),
  R('Ravi Consultant', 'Resource Person'), R('Priya Three', 'Teaching'), R('Priya One', 'Teaching', { staffCode: 'S0601' }),
  R('Dup One', 'Admin'), R('Zed Nowhere', 'Teaching'), R('Odd Category', 'Admin'),
  R('Hana Kumar', 'Admin'), R('Hana K', 'Admin'), R('Teach Only', 'Admin'),
];
ctx.__hr = hr; ctx.__ro2 = roster2;
const C = run('matchStaffCodeLinks(__ro2, __hr, __S)');
const cr = n => C.results[roster2.findIndex(r => r.displayName === n)];

check('exact + corroborated by the confirmed roster Email -> pre-filled Accept', cr('Asha Example').class === 'Confirmed-exact' &&
  cr('Asha Example').candidates[0].corroboration === 'Corroborated' && cr('Asha Example').candidates[0].staffCode === 'S0101' &&
  cr('Asha Example').evidence === 'Corroborated' && cr('Asha Example').prefill === 'Accept');
check('corroboration Conflict is never pre-filled', cr('Ravi Sample').class === 'Confirmed-exact' && cr('Ravi Sample').evidence === 'Conflict' && cr('Ravi Sample').prefill === '');
check('pattern-failing exact match is not pre-filled (R31)', cr('Tara Example').class === 'Confirmed-exact' && /Pattern warning/.test(cr('Tara Example').evidence) && cr('Tara Example').prefill === '');
check('plain exact match is pre-filled', cr('Wanda Support').prefill === 'Accept' && cr('Wanda Support').candidates[0].codeStatus === 'ok');
check('placeholder email: no corroboration or conflict evidence', cr('Wanda Support').candidates[0].corroboration === '' && cr('Tara Example').candidates[0].corroboration === '');
check('placeholder code links but offers no code, no pattern error, names the state', cr('Sita Example').class === 'Confirmed-exact' &&
  cr('Sita Example').candidates[0].staffCode === '' && cr('Sita Example').candidates[0].codeStatus === 'No code in HR Database' && !/Pattern/.test(cr('Sita Example').evidence) &&
  cr('Sita Example').candidates[0].department === 'Dept X');
check('Resource Person row: linked by name, but no code is ever taken', cr('Ravi Consultant').class === 'Confirmed-exact' && cr('Ravi Consultant').candidates[0].staffCode === '' &&
  cr('Ravi Consultant').writeCode === false && cr('Ravi Consultant').prefill === '');
check('row that already holds a code is never offered a write', cr('Priya One').writeCode === false && cr('Priya One').prefill === '');
check('first-name-only HR hit is Ambiguous', cr('Priya Three').class === 'Ambiguous' && cr('Priya Three').rung === 'R4');
check('unmatched stays Unmatched (no "No email expected" for codes)', cr('Zed Nowhere').class === 'Unmatched');
check('shared Staff Code among HR Current rows demotes the linked row', cr('Dup One').class === 'Ambiguous' && cr('Dup One').demoted && cr('Dup One').prefill === '');
check('HR row proposed for two roster rows -> both Ambiguous', cr('Hana Kumar').class === 'Ambiguous' && cr('Hana K').class === 'Ambiguous' && cr('Hana K').demoted);
check('unmapped HR category blocks pre-fill and is shown', cr('Odd Category').prefill === '' && /Unmapped category: Volunteers/.test(cr('Odd Category').evidence));
check('category conflict (Admin row vs HR Teaching) blocks pre-fill', /Category conflict/.test(cr('Teach Only').evidence) && cr('Teach Only').prefill === '');
check('non-Current HR rows are never linked (R30)', C.results.every(r => r.candidates.every(c => c.name !== 'Old Admin')) &&
  call('matchStaffCodeLinks', [R('Old Admin', 'Admin')], hr, S).results[0].class === 'Unmatched');
check('duplicate codes reported without placeholders', C.duplicateCodes.length === 1 && C.duplicateCodes[0].code === 'S0300');
check('N/A rows: zero duplicate reports, zero pattern errors (R35)', (() => {
  const only = hr.filter(r => /^(N\/A|n\/a|-|TBD|)$/.test(r.staffCode)); ctx.__o = only;
  const r = call('matchStaffCodeLinks', only.map(h => R(h.name, 'Support Staff')), only, S);
  return r.duplicateCodes.length === 0 && r.counts.patternWarnings === 0 && r.results.every(x => !/Pattern/.test(x.evidence));
})());
check('code already on another roster row is flagged, not pre-filled', (() => {
  const r = call('matchStaffCodeLinks', [R('Wanda Support', 'Support Staff'), R('Other Person', 'Support Staff', { staffCode: 'W0201' })], hr, S);
  return r.results[0].prefill === '' && r.results[0].candidates[0].codeStatus === 'Code already on another row';
})());
check('emailByName option supplies the chosen importHR candidate', (() => {
  const r = call('matchStaffCodeLinks', [R('Asha Example')], hr, S, { emailByName: { 'Asha Example': 'asha.example@school.example' } });
  return r.results[0].candidates[0].corroboration === 'Corroborated';
})());
check('counts: pattern warnings and corroborated', C.counts.patternWarnings >= 1 && C.counts.corroborated >= 1);

// ── regression: code held / shared (Codex review defects 2-3) ─────────
{
  const w = [R('Wanda Support', 'Support Staff')];
  const withHolder = h => call('matchStaffCodeLinks', w.concat([h]), hr, S).results[0];
  const a = withHolder(R('Other Person', 'Support Staff', { staffCode: 'w0201' }));
  check('code held by an Active unrelated row: demoted, no pre-fill, holder named', a.class === 'Ambiguous' && a.demoted && a.prefill === '' && /Other Person/.test(a.note));
  check('code held by an inactive unrelated row is still held (never reused)', (() => { const r = withHolder(R('Old Person', 'Support Staff', { staffCode: 'W0201', active: false })); return r.class === 'Ambiguous' && r.prefill === ''; })());
  check('inactive holder whose Replaced By names someone else is still a conflict', withHolder(R('Old Person', 'Support Staff', { staffCode: 'W0201', active: false, replacedBy: 'Somebody Else' })).prefill === '');
  check('Active holder with Replaced By is not a rename chain', withHolder(R('Old Person', 'Support Staff', { staffCode: 'W0201', replacedBy: 'Wanda Support' })).prefill === '');
  const ok = withHolder(R('Old Person', 'Support Staff', { staffCode: 'W0201', active: false, replacedBy: 'Wanda Support' }));
  check('rename chain (inactive older row naming the newer) is exempt', ok.class === 'Confirmed-exact' && ok.prefill === 'Accept');
  check('Left On alone is informational: an Active row with Left On is not a rename chain (D2)', withHolder(R('Old Person', 'Support Staff', { staffCode: 'W0201', leftOn: '2026-08-01', replacedBy: 'Wanda Support' })).prefill === '');
  check('two Active unrelated rows proposed the same HR row stay a conflict even if they share a Staff Code', (() => {
    const rr = call('matchStaffCodeLinks', [R('Hana Kumar', 'Admin', { staffCode: 'S0701' }), R('Hana K', 'Admin', { staffCode: 'S0701' })], hr, S).results;
    return rr.every(x => x.class === 'Ambiguous' && x.prefill === ''); })());
}

// ── regression: shared HR code applies to inactive roster rows too (round 3) ──
{
  const inactive = call('matchStaffCodeLinks', [R('Dup One', 'Admin', { active: false })], hr, S).results[0];
  check('inactive row + code shared by two Current HR rows: Ambiguous, no pre-fill', inactive.class === 'Ambiguous' && inactive.demoted && inactive.prefill === '' && /shared by several/.test(inactive.note));
  const active = call('matchStaffCodeLinks', [R('Dup One', 'Admin')], hr, S).results[0];
  check('active row + shared HR code: still Ambiguous, no pre-fill', active.class === 'Ambiguous' && active.prefill === '');
  const fine = call('matchStaffCodeLinks', [R('Wanda Support', 'Support Staff', { active: false })], hr, S).results[0];
  check('inactive row with an unshared code is unaffected', fine.class === 'Confirmed-exact' && fine.prefill === 'Accept');
}

// ── regression: name-only categories join on the exact name only (re-review 3) ──
{
  const rp = R('Uma Consultant K', 'Resource Person');                 // near-name of HR 'Uma Consultant' (two shared words)
  const c = call('matchStaffCodeLinks', [rp], hr, S).results[0];
  check('Resource Person: near-name HR row is not a link (no R2/R3/R4)', c.class === 'Unmatched' && c.candidates.length === 0 && c.hitIndexes.length === 0);
  const p = call('matchProposeAdds', hr, [c], S).proposals;
  check('Resource Person near-name does not suppress the correct Propose add', p.some(x => x.hrName === 'Uma Consultant'));
  const ctrl = call('matchStaffCodeLinks', [R('Wanda Support K', 'Support Staff')], hr, S).results[0];
  check('control: a code-required category still gets the fuzzy rungs', ctrl.class === 'Candidate' && ctrl.rung === 'R3');
  const ex = call('matchStaffCodeLinks', [R('Ravi Consultant', 'Resource Person')], hr, S).results[0];
  check('Resource Person exact name still links, with no code or email on the candidate', ex.class === 'Confirmed-exact' && ex.rung === 'R1' &&
    ex.candidates[0].staffCode === '' && ex.candidates[0].corroboration === '' && !('officialEmail' in ex.candidates[0]) && ex.prefill === '');
}

// ── Propose add (R32, D11, R35) ────────────────────────────────────────
const P = run('matchProposeAdds(__hr, matchStaffCodeLinks(__ro2, __hr, __S).results, __S)');
const P0 = run('matchProposeAdds(__hr, [], __S)');   // nothing linked
const pn = n => P.proposals.find(p => p.hrName === n);
const pn0 = n => P0.proposals.find(p => p.hrName === n);
check('Propose add: linked HR rows are not proposed', !pn('Asha Example') && !pn('Wanda Support') && !pn('Ravi Consultant') && !pn('Tara Example'));
check('Propose add: Teaching-category HR rows never proposed', !pn('Teach Only') && !pn('Priya Four') && P.proposals.every(p => p.category !== 'Teaching'));
check('Propose add: non-Current never proposed (R30)', !pn('Old Admin'));
check('Propose add: unmapped category not proposed, listed', !pn0('Odd Category') && P0.unmapped.join() === 'Volunteers');
check('Propose add: placeholder-code rows proposed with a blank code, no N/A anywhere (R35)', pn('Nila Example') && pn('Nila Example').staffCode === '' &&
  pn('Nila Example').codeStatus === 'No code in HR Database' && pn('Rita Example').staffCode === '' && pn('Gita Example').staffCode === '' &&
  !JSON.stringify(P.proposals).match(/N\/A|"n\/a"|TBD/));
check('Propose add: Resource Persons carry no code or email even if present', pn('Uma Consultant') && pn('Uma Consultant').nameOnly && pn('Uma Consultant').staffCode === '' && pn('Uma Consultant').officialEmail === '' &&
  (() => { const r = call('matchProposeAdds', [H('Current', 'Rana Consultant', 'Resource Person', 'S0998', 'rana@example.test')], [], S).proposals[0]; return r.staffCode === '' && r.officialEmail === '' && r.codeStatus === 'Name only'; })());
check('Propose add: Admin keeps code, dept, team, official email', (() => {
  const r = call('matchProposeAdds', [H('Current', 'Nia Example', 'Administration', 's0123', 'Nia@Example.Test')], [], S).proposals[0];
  return r.staffCode === 'S0123' && r.officialEmail === 'nia@example.test' && r.department === 'Dept X' && r.teamRole === 'Role X' && r.category === 'Admin' && r.link === 'Propose add';
})());
check('Propose add: shared codes and pattern failures are flagged', pn('Dup Two') && /shared/.test(pn('Dup Two').flags.join()) &&
  /Pattern/.test(call('matchProposeAdds', [H('Current', 'Pat Example', 'Administration', 'Z1', '')], [], S).proposals[0].flags.join()));
check('Propose add: two Resource Persons with one name are flagged', (() => {
  const r = call('matchProposeAdds', [H('Current', 'Sam Consult', 'Resource Person', 'N/A', 'N/A'), H('Current', 'Sam Consult', 'Resource Person', 'N/A', 'N/A')], [], S);
  return r.proposals.length === 2 && r.proposals.every(p => /shared with another/.test(p.flags.join()));
})());
check('Propose add: category mapping comes from settings (R11)', (() => {
  const s = D(); s.hrCategoryMap = [{ hr: 'Administration', roster: 'Teaching' }];
  return call('matchProposeAdds', [H('Current', 'Nia Example', 'Administration', 'S0123', '')], [], s).proposals.length === 0;
})());
check('Propose add: Status filter comes from settings', (() => {
  const s = D(); s.statusFilter = ['Current', 'Probation'];
  return call('matchProposeAdds', [H('Probation', 'Nia Example', 'Administration', 'S0123', '')], [], s).proposals.length === 1;
})());
check('Propose add counts by category', P0.counts['Support Staff'] === 4 && P0.counts['Resource Person'] === 3 && P0.counts.Admin === 5);
check('Resource Person full pass: blank code and email, zero write offers (R36)', (() => {
  const rp = [R('Uma Consultant', 'Resource Person')];
  const c = call('matchStaffCodeLinks', rp, hr, S), e = call('matchEmailLinks', rp, importHR, S);
  return c.results[0].writeCode === false && c.results[0].candidates[0].staffCode === '' && e.results[0].candidates.length === 0 &&
    call('matchProposeAdds', hr, c.results, S).proposals.every(p => p.hrName !== 'Uma Consultant');
})());

// ── performance, HR side ───────────────────────────────────────────────
{
  const big = []; for (let i = 0; i < 2400; i++) big.push(H('Current', cap(alpha(i)) + 'a ' + cap(alpha(i % 40 + 200)) + 'ar', 'Support staff', 'W' + String(1000 + i).slice(0, 4), ''));
  const rr = []; for (let i = 0; i < 120; i++) rr.push(R(big[i * 19].name, 'Support Staff'));
  ctx.__bigH = big; ctx.__bigRR = rr;
  const t0 = Date.now(), B = run('matchStaffCodeLinks(__bigRR, __bigH, __S)');
  check('HR Database 2,400 x 120 under 3 s, postings only', Date.now() - t0 < 3000 && B.stats.examined < 2400 * 120 / 20, (Date.now() - t0) + ' ms, examined ' + B.stats.examined);
}

// ── purity ──────────────────────────────────────────────────────────────
check('engine source has no Apps Script service calls', !/SpreadsheetApp|CacheService|PropertiesService|UrlFetchApp|Logger\./.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'MatchEngine.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
