/** FREE_PERIOD_GUARD — caps a teacher's substitutions by her free periods that day. */
const { load } = require('./harness');
const { SCHOOL } = require('./fixture');

const ctx = load(undefined, SCHOOL);
const run = ctx.run;
const plan = absent => { run('clearCache()'); return run(`computePlan('2026-09-07', ${JSON.stringify(absent)}, {})`); };
const setRules = js => run(`RULES = ${js}; clearCache();`);
const R = (type, who, then, extra) => `{enabled:true,expired:false,until:null,scope:'',priority:100,notes:'',row:3,` +
  `type:ruleType_('${type}'),who:${JSON.stringify(who)},then:${JSON.stringify(then)}${extra || ''}}`;

// Every fixture teacher starts with 4 free periods on Monday. Push staff duties into
// DUTIES to eat into a named teacher's free periods until exactly `target` remain.
function pinFreeCount(name, target) {
  run(`DUTIES.length = 0;`);
  const free = run(`fixtureFreeCount(${JSON.stringify(name)})`);
  const busyPeriods = run(`(function(){var b={};TT.forEach(function(e){if(e.teacher===${JSON.stringify(name)})b[e.period]=1;});return b;})()`);
  const toEat = free - target;
  if (toEat <= 0) { run('clearCache()'); return; }
  let eaten = 0;
  const pushes = [];
  for (let p = 1; p <= 8 && eaten < toEat; p++) {
    if (busyPeriods[p]) continue;
    pushes.push(`DUTIES.push({teacher:${JSON.stringify(name)},dayIndex:0,period:${p},duty:'Gate'});`);
    eaten++;
  }
  run(pushes.join(' '));
  run('clearCache()');
}

// ── acceptance 1: 1 free period → 0 substitutions; 2 → at most 1; 3+ → unchanged ──

pinFreeCount('Teacher J', 1);
setRules(`[${R('FREE_PERIOD_GUARD', 'Teacher J', '1:0, 2:1')}]`);
let p = plan(['Teacher C', 'Teacher D', 'Teacher E']);
let hits = p.assignments.filter(a => a.substitute === 'Teacher J');
check('1 free period → 0 substitutions for the guarded teacher', hits.length === 0, JSON.stringify(hits));

pinFreeCount('Teacher J', 2);
run('clearCache()');
p = plan(['Teacher C', 'Teacher D', 'Teacher E', 'Teacher F']);
hits = p.assignments.filter(a => a.substitute === 'Teacher J');
check('2 free periods → at most 1 substitution', hits.length <= 1, hits.length + '');

setRules('[]');
pinFreeCount('Teacher J', 4);
const baseline = plan(['Teacher C', 'Teacher D', 'Teacher E', 'Teacher F']);
const baseHits = baseline.assignments.filter(a => a.substitute === 'Teacher J').length;
setRules(`[${R('FREE_PERIOD_GUARD', 'Teacher J', '1:0, 2:1')}]`);
const guarded = plan(['Teacher C', 'Teacher D', 'Teacher E', 'Teacher F']);
const guardedHits = guarded.assignments.filter(a => a.substitute === 'Teacher J').length;
check('3+ free periods is unaffected versus baseline', guardedHits === baseHits, guardedHits + ' vs ' + baseHits);

// ── acceptance 2: assigning cover doesn't change the free-period count mid-run ──

pinFreeCount('Teacher J', 3);
setRules(`[${R('FREE_PERIOD_GUARD', 'Teacher J', '3:2')}]`);
p = plan(['Teacher C', 'Teacher D', 'Teacher E', 'Teacher F', 'Teacher G']);
hits = p.assignments.filter(a => a.substitute === 'Teacher J');
check('free count used for the cap does not shrink as the run assigns cover',
  hits.length <= 2, hits.length + '');

// ── acceptance 3: a guard-capped DEDICATED substitute is skipped, dedicated rule falls back ──

pinFreeCount('Teacher A', 1);
setRules(`[${R('DEDICATED_SUB', 'Pre-primary', 'Teacher A')},${R('FREE_PERIOD_GUARD', 'Teacher A', '1:0')}]`);
const mixed = run(`(function(){var t={};TT.forEach(function(e){if(!t[e.teacher])t[e.teacher]={pre:0,other:0};
  if(['LKG','UKG'].indexOf(e.class)>-1)t[e.teacher].pre++;else t[e.teacher].other++;});
  for(var k in t) if(t[k].pre>0&&k!=='Teacher A') return k; return '';})()`);
p = plan([mixed]);
const isPre = a => ['LKG', 'UKG'].indexOf(a.class) > -1;
const preAssigned = p.assignments.filter(a => isPre(a) && a.status === 'ASSIGNED');
check('guard-capped dedicated substitute is never chosen',
  preAssigned.every(a => a.substitute !== 'Teacher A'), preAssigned.map(a => a.substitute).join(', '));
check('dedicated rule falls back to normal rotation when its substitute is guard-capped',
  preAssigned.length === 0 || /normal rotation/.test(preAssigned[0].reason));

// ── acceptance 4: unparseable ladder → ctx.problems, rule skipped, plan still produced ──

pinFreeCount('Teacher J', 4);
setRules(`[${R('FREE_PERIOD_GUARD', 'Teacher J', 'not a ladder')}]`);
const rc = run('buildRuleContext_()');
check('unparseable ladder is recorded in ctx.problems', rc.problems.length === 1, JSON.stringify(rc.problems));
check('malformed guard rule is skipped (no freeGuards compiled)', rc.freeGuards.length === 0);
check('plan is still produced despite the bad rule', plan(['Teacher C']).ok === true);

// ── acceptance 5: disabled / expired rule → identical to baseline ──

setRules('[]');
pinFreeCount('Teacher J', 1);
const noRule = plan(['Teacher C', 'Teacher D', 'Teacher E']);
const noRuleHits = noRule.assignments.filter(a => a.substitute === 'Teacher J').length;

run(`RULES=[{enabled:false,expired:false,until:null,scope:'',priority:100,notes:'',row:3,
  type:ruleType_('FREE_PERIOD_GUARD'),who:'Teacher J',then:'1:0'}]; clearCache();`);
check('disabled guard rule is ignored', run('activeRules_().length') === 0);
const disabled = plan(['Teacher C', 'Teacher D', 'Teacher E']);
const disabledHits = disabled.assignments.filter(a => a.substitute === 'Teacher J').length;
check('disabled rule behaves exactly like baseline (no rule)', disabledHits === noRuleHits,
  disabledHits + ' vs ' + noRuleHits);

run(`RULES=[{enabled:true,expired:true,until:new Date(2020,0,1),scope:'',priority:100,notes:'',row:3,
  type:ruleType_('FREE_PERIOD_GUARD'),who:'Teacher J',then:'1:0'}]; clearCache();`);
check('expired guard rule is ignored', run('activeRules_().length') === 0);
const expired = plan(['Teacher C', 'Teacher D', 'Teacher E']);
const expiredHits = expired.assignments.filter(a => a.substitute === 'Teacher J').length;
check('expired rule behaves exactly like baseline (no rule)', expiredHits === noRuleHits,
  expiredHits + ' vs ' + noRuleHits);

// ── uncovered-reason counter ──

pinFreeCount('Teacher J', 1);
setRules(`[${R('FREE_PERIOD_GUARD', 'All', '1:0')}]`);
const scan = run(`(function(){
  clearCache();
  var cfgLocal = getConfig();
  var pool = buildPool();
  var rules = buildRuleContext_();
  var slot = { absent: 'Teacher J', class: 'I', section: 'A', classSec: 'I-A', subject: 'Maths', period: 1, dept: '' };
  var st = { absentSet: { 'TEACHER J': true }, busy: {}, assignedBusy: {}, termUsed: {}, weekUsed: {}, dayUsed: {},
             runUsed: {}, weekBasis: false, basisTotal: 0, runCount: 0, totalCap: pool.totalCap || 1,
             coverByTeacher: {}, meta: getTeacherMeta(), cfg: cfgLocal, rules: rules, dayIndex: 0, absentTeam: '' };
  return scanCandidates_(slot, pool, st, null);
})()`);
check('blockedByFreeGuard counter is populated', scan.blockedByFreeGuard > 0, JSON.stringify(scan));
const reason = run(`noCandidateReason_(${JSON.stringify(scan)}, null)`);
check('uncovered reason names the free-period guard', /free-period guard/.test(reason), reason);
