/** Existing rule types: dedicated substitute, floor limit, block affinity. */
const { load } = require('./harness');
const { SCHOOL } = require('./fixture');

const ctx = load(undefined, SCHOOL);
const run = ctx.run;
const plan = absent => { run('clearCache()'); return run(`computePlan('2026-09-07', ${JSON.stringify(absent)}, {})`); };
const setRules = js => run(`RULES = ${js}; clearCache();`);
const R = (type, who, then, extra) => `{enabled:true,expired:false,until:null,scope:'',priority:100,notes:'',row:3,` +
  `type:ruleType_('${type}'),who:${JSON.stringify(who)},then:${JSON.stringify(then)}${extra || ''}}`;
const isPre = a => ['LKG', 'UKG'].indexOf(a.class) > -1;
const floorOf = a => (run(`readBlocks_()[${JSON.stringify(a.class.toUpperCase() + '|' + a.section.toUpperCase())}]`) || {}).floor;

setRules('[]');
const mixed = run(`(function(){var t={};TT.forEach(function(e){if(!t[e.teacher])t[e.teacher]={pre:0,other:0};
  if(['LKG','UKG'].indexOf(e.class)>-1)t[e.teacher].pre++;else t[e.teacher].other++;});
  for(var k in t) if(t[k].pre>0&&t[k].other>0&&k!=='Teacher A') return k; return '';})()`);
const base = plan([mixed]);
check('baseline assigns cover', base.summary.assigned > 0, JSON.stringify(base.summary));

setRules(`[${R('DEDICATED_SUB', 'Pre-primary', 'Teacher A')}]`);
let p = plan([mixed]);
const pre = p.assignments.filter(isPre), non = p.assignments.filter(a => !isPre(a));
check('dedicated sub takes all Pre-primary periods',
  pre.length > 0 && pre.every(a => a.substitute === 'Teacher A'),
  pre.map(a => a.substitute).join(', '));
check('reason names the dedicated rule', /Dedicated Pre-primary/.test(pre[0] && pre[0].reason));
check('non-Pre-primary falls to normal rotation',
  non.length > 0 && non.some(a => a.substitute !== 'Teacher A'));

p = plan([mixed, 'Teacher A']);
const pre2 = p.assignments.filter(a => isPre(a) && a.status === 'ASSIGNED');
check('dedicated sub absent → fallback covers it', pre2.length > 0);
check('fallback reason is explicit', /normal rotation/.test(pre2[0] && pre2[0].reason));

setRules('[]');
const absentees = ['Teacher C', 'Teacher D', 'Teacher E', 'Teacher F'];
const before = plan(absentees);
const counts = {};
before.assignments.filter(a => a.status === 'ASSIGNED').forEach(a => {
  counts[a.substitute] = counts[a.substitute] || { Ground: 0, First: 0 };
  counts[a.substitute][floorOf(a)]++;
});
const victim = Object.keys(counts).filter(k => counts[k].First > 0 && absentees.indexOf(k) < 0)[0];
setRules(`[${R('FLOOR_LIMIT', victim, 'Ground')}]`);
const after = plan(absentees);
const mine = after.assignments.filter(a => a.substitute === victim);
check('floor limit keeps ' + victim + ' on the ground floor',
  mine.every(a => floorOf(a) === 'Ground'), mine.map(floorOf).join(', '));
check('floor limit does not reduce total cover',
  after.summary.assigned === before.summary.assigned,
  after.summary.assigned + ' vs ' + before.summary.assigned);

run(`RULES=[{enabled:true,expired:true,until:new Date(2020,0,1),scope:'',priority:100,notes:'',row:3,
  type:ruleType_('FLOOR_LIMIT'),who:${JSON.stringify(victim)},then:'Ground'}]; clearCache();`);
check('expired rule is ignored', run('activeRules_().length') === 0);
run(`RULES=[{enabled:false,expired:false,until:null,scope:'',priority:100,notes:'',row:3,
  type:ruleType_('FLOOR_LIMIT'),who:${JSON.stringify(victim)},then:'Ground'}]; clearCache();`);
check('disabled rule is ignored', run('activeRules_().length') === 0);

setRules(`[${R('BLOCK_AFFINITY', 'All', '')}]`);
const rc = run('buildRuleContext_()');
check('home block derived for every teacher', Object.keys(rc.homeBlock).length === 10,
  Object.keys(rc.homeBlock).length + ' of 10');
check('block affinity strength defaults to 1.5', rc.blockBonus === 1.5);

setRules(`[${R('DEDICATED_SUB', '', '')}]`);
const bad = run('buildRuleContext_()');
check('malformed rule is recorded, not thrown', bad.problems.length === 1);
check('plan is still produced despite a bad rule', plan([mixed]).ok === true);
