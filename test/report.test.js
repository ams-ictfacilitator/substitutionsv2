/** T-003: free-period guard cost surfaced in the weekly report's rules card. */
const { load } = require('./harness');
const { SCHOOL } = require('./fixture');

const REPORT_FILES = require('./harness').DEFAULT_FILES.concat(['ReportData.js', 'ReportRender.js']);

const ctx = load(REPORT_FILES, SCHOOL);
const run = ctx.run;
const setRules = js => run(`RULES = ${js}; clearCache();`);
const R = (type, who, then) => `{enabled:true,expired:false,until:null,scope:'',priority:100,notes:'',row:3,` +
  `type:ruleType_('${type}'),who:${JSON.stringify(who)},then:${JSON.stringify(then)}}`;

// Monday of a real week, matching the fixture timetable (dayIndex 0).
const MONDAY = run('new Date(2026,8,7)');
const WEEK_KEY = run('weekKey_(new Date(2026,8,7))');

/** A handful of log rows for that Monday — enough to make the report non-empty. */
function seedLog() {
  run(`LOG = [
    { ts: new Date(), dateStr: '2026-09-07', day: 'Monday', weekKey: ${JSON.stringify(WEEK_KEY)},
      period: 1, classSec: 'LKG-A', subject: 'Maths', absent: 'Teacher A', substitute: 'Teacher B',
      dept: 'Maths', status: 'ASSIGNED', notified: '✓', runId: 'r1', markedBy: 'Office', row: 3 },
    { ts: new Date(), dateStr: '2026-09-07', day: 'Monday', weekKey: ${JSON.stringify(WEEK_KEY)},
      period: 2, classSec: 'UKG-A', subject: 'Maths', absent: 'Teacher A', substitute: '',
      dept: 'Maths', status: 'UNASSIGNED', notified: '', runId: 'r1', markedBy: 'Office', row: 4 },
  ]; clearCache();`);
}

function balancedTables(html) {
  const open = (html.match(/<table/g) || []).length;
  const close = (html.match(/<\/table>/g) || []).length;
  return open === close && open > 0;
}

/* ── 1. active guard shows the per-day figure ── */
setRules(`[${R('FREE_PERIOD_GUARD', 'All', '1:0, 2:1, 3:2')}]`);
seedLog();
const withGuard = run(`buildWeeklyReportData(${JSON.stringify(WEEK_KEY)})`);

check('active guard is reported as an active rule', withGuard.rules.active.length === 1,
  JSON.stringify(withGuard.rules.active));
check('guard cost is computed', !!withGuard.rules.guard, JSON.stringify(withGuard.rules));
check('guard cost is a sane range', withGuard.rules.guard &&
  withGuard.rules.guard.min >= 0 && withGuard.rules.guard.max >= withGuard.rules.guard.min,
  JSON.stringify(withGuard.rules.guard));

const htmlWithGuard = run(`renderReportHtml_(buildWeeklyReportData(${JSON.stringify(WEEK_KEY)}), {seq:1, generatedOn:new Date(), generatedBy:'Test'})`);
check('rendered report mentions the free-period guard', /Free-period guard/.test(htmlWithGuard));
check('rendered report shows "held back per day"', /held back per day/.test(htmlWithGuard));
check('rendered guard html has no undefined/NaN', !/undefined|NaN/.test(htmlWithGuard));
check('rendered guard html has balanced tables', balancedTables(htmlWithGuard));

/* ── 2. no guard rule → unchanged behaviour ── */
setRules('[]');
seedLog();
const noGuard = run(`buildWeeklyReportData(${JSON.stringify(WEEK_KEY)})`);
check('no rules active when none are configured', noGuard.rules.active.length === 0);
check('guard field is null with no guard rule', noGuard.rules.guard === null);

const htmlNoGuard = run(`renderReportHtml_(buildWeeklyReportData(${JSON.stringify(WEEK_KEY)}), {seq:1, generatedOn:new Date(), generatedBy:'Test'})`);
check('no rules card at all when nothing is active', !/Substitution rules in force/.test(htmlNoGuard));
check('no guard text when no guard rule is set', !/Free-period guard/.test(htmlNoGuard));
check('rendered no-guard html has no undefined/NaN', !/undefined|NaN/.test(htmlNoGuard));
check('rendered no-guard html has balanced tables', balancedTables(htmlNoGuard));

/* ── 3. a non-guard rule still renders exactly as before (no stray guard row) ── */
setRules(`[${R('BLOCK_AFFINITY', 'All', '')}]`);
seedLog();
const otherRule = run(`buildWeeklyReportData(${JSON.stringify(WEEK_KEY)})`);
check('non-guard rule leaves guard field null', otherRule.rules.guard === null);
const htmlOtherRule = run(`renderReportHtml_(buildWeeklyReportData(${JSON.stringify(WEEK_KEY)}), {seq:1, generatedOn:new Date(), generatedBy:'Test'})`);
check('non-guard rule card has no free-period guard row', !/Free-period guard/.test(htmlOtherRule));
check('non-guard rule html has no undefined/NaN', !/undefined|NaN/.test(htmlOtherRule));
check('non-guard rule html has balanced tables', balancedTables(htmlOtherRule));
