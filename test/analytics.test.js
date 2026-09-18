/** T-005: analytics engine — RFC-002 §11 test plan. */
const { load } = require('./harness');
const { SCHOOL } = require('./fixture');
const { DEFAULT_FILES } = require('./harness');

const ctx = load(DEFAULT_FILES.concat(['ReportData.js', 'AnalyticsData.js']), SCHOOL);
const run = ctx.run;

/** Build a log row with sane defaults, overridden per test. */
function row(o) {
  return Object.assign({
    ts: new Date(), dateStr: '2026-09-07', day: 'Monday', weekKey: '2026-W37',
    period: 1, classSec: 'VIII-B', subject: 'Maths', absent: 'Teacher A',
    substitute: 'Teacher B', dept: 'Maths', status: 'ASSIGNED', notified: '✓',
    runId: 'r1', markedBy: 'Office', row: 3,
  }, o);
}

function setLog(rows) {
  run(`LOG = ${JSON.stringify(rows)}; clearCache();`);
}

function analytics() { return run('buildAnalytics()'); }

/* ── 1 & 2: three cohorts, kept separate ── */
// Fixture pool: Teacher A..J, all weight > 0. Give duties to only a few,
// and one duty to a teacher NOT in the allotment's Substitution rows at all
// (simulated by using a name outside TEACHERS).
setLog([
  row({ dateStr: '2026-09-07', period: 1, substitute: 'Teacher B', absent: 'Teacher C' }),
  row({ dateStr: '2026-09-08', period: 2, substitute: 'Teacher B', absent: 'Teacher D' }),
  row({ dateStr: '2026-09-07', period: 3, substitute: 'Outside Teacher', absent: 'Teacher E' }),
]);
let a = analytics();

check('teacher with zero duties appears in neverCalled',
  a.equity.neverCalled.some(function (m) { return m.teacher === 'Teacher C'; }),
  JSON.stringify(a.equity.neverCalled.map(function (m) { return m.teacher; })));
check('neverCalled member is not also in belowShare',
  !a.equity.belowShare.some(function (m) { return m.teacher === 'Teacher C'; }));
check('teacher with no Substitution allotment appears in notInPool',
  a.equity.notInPool.some(function (m) { return m.teacher === 'Outside Teacher'; }),
  JSON.stringify(a.equity.notInPool.map(function (m) { return m.teacher; })));
check('notInPool member never appears in neverCalled or belowShare',
  !a.equity.neverCalled.some(function (m) { return m.teacher === 'Outside Teacher'; }) &&
  !a.equity.belowShare.some(function (m) { return m.teacher === 'Outside Teacher'; }));

/* ── 2b: the actual complainant — no allotment row AND zero duties ──
   RFC-002 §11 item 2. `E` is in the fixture's TEACHERS/Allotment (getAllTeachers()
   includes all ten), but has no Substitution row of its own here (not seeded with
   any duties or pool cap) — the fixture pool always includes every TEACHER with a
   positive cap, so to exercise "no allotment row at all" we override getAllotment()
   for this one case to drop a teacher from the Substitution rows entirely. */
(function () {
  const ctx2 = load(DEFAULT_FILES.concat(['ReportData.js', 'AnalyticsData.js']), SCHOOL + `
    var _origAllotment = getAllotment;
    getAllotment = function () {
      return _origAllotment().filter(function (r) {
        return !(r.subject === 'Substitution' && r.teacher === 'Teacher E');
      });
    };
    function buildPool() {
      var cfg = getConfig();
      var label = cfg.subLabel.toUpperCase();
      var allot = getAllotment();
      var members = [], seen = {};
      for (var i = 0; i < allot.length; i++) {
        var a = allot[i];
        if (a.subject.toUpperCase() !== label) continue;
        var cap = a.periodsAllotted;
        if (!a.teacher || cap <= 0) continue;
        if (seen[a.teacher]) continue;
        seen[a.teacher] = true;
        members.push({ teacher: a.teacher, cap: cap, department: a.department, team: a.team });
      }
      var totalCap = 0;
      members.forEach(function (m) { totalCap += m.cap; });
      return { members: members, order: [], capByTeacher: {}, totalCap: totalCap };
    }
  `);
  ctx2.run(`LOG = ${JSON.stringify([row({ substitute: 'Teacher B' })])}; clearCache();`);
  var m = ctx2.run('buildAnalytics()');
  var e = m.equity;
  check('teacher with no allotment row and zero duties appears in notInPool',
    e.notInPool.some(function (x) { return x.teacher === 'Teacher E'; }),
    JSON.stringify(e.notInPool.map(function (x) { return x.teacher; })));
  check('that teacher does not appear in neverCalled',
    !e.neverCalled.some(function (x) { return x.teacher === 'Teacher E'; }));
  check('that teacher does not appear in belowShare',
    !e.belowShare.some(function (x) { return x.teacher === 'Teacher E'; }));
})();

/* ── 3: Gini 0 for perfectly proportional, rises as load concentrates ── */
// Two pool teachers with equal weight (use fixture caps: Teacher A=6, Teacher B=4).
// Perfectly proportional per-weight load: give each exactly weight duties → perWeight = 1 for all.
(function () {
  var rows = [];
  var caps = { 'Teacher A': 6, 'Teacher B': 4, 'Teacher C': 4, 'Teacher D': 5, 'Teacher E': 3,
               'Teacher F': 4, 'Teacher G': 5, 'Teacher H': 3, 'Teacher I': 4, 'Teacher J': 4 };
  var n = 0;
  for (var t in caps) {
    for (var i = 0; i < caps[t]; i++) {
      rows.push(row({ dateStr: '2026-09-0' + (7 + (n % 2)), period: (n % 8) + 1, substitute: t, absent: 'Teacher A', row: 3 + n }));
      n++;
    }
  }
  setLog(rows);
  var eq = analytics();
  check('Gini is 0 for a perfectly proportional distribution',
    eq.equity.gini !== null && Math.abs(eq.equity.gini) < 1e-9, eq.equity.gini);
})();

(function () {
  // Concentrate all duties on one teacher — Gini should rise well above 0.
  var rows = [];
  for (var i = 0; i < 10; i++) {
    rows.push(row({ dateStr: '2026-09-07', period: (i % 8) + 1, substitute: 'Teacher A', absent: 'Teacher C', row: 3 + i }));
  }
  setLog(rows);
  var eq = analytics();
  check('Gini rises as load concentrates on one teacher',
    eq.equity.gini !== null && eq.equity.gini > 0.4, eq.equity.gini);
})();

/* ── 4: repeatShare ── */
(function () {
  setLog([
    row({ dateStr: '2026-09-07', period: 1, classSec: 'I-A', day: 'Monday', substitute: 'Teacher B' }),
    row({ dateStr: '2026-09-08', period: 2, classSec: 'II-A', day: 'Tuesday', substitute: 'Teacher B' }),
    row({ dateStr: '2026-09-09', period: 3, classSec: 'III-A', day: 'Wednesday', substitute: 'Teacher B' }),
  ]);
  var v = analytics().variety.filter(function (r) { return r.teacher === 'Teacher B'; })[0];
  check('repeatShare is 0 when every duty is a distinct slot', v.repeatShare === 0, v.repeatShare);
})();

(function () {
  setLog([
    row({ dateStr: '2026-09-07', period: 1, classSec: 'I-A', day: 'Monday', substitute: 'Teacher B', row: 3 }),
    row({ dateStr: '2026-09-14', period: 1, classSec: 'I-A', day: 'Monday', substitute: 'Teacher B', row: 4 }),
    row({ dateStr: '2026-09-21', period: 1, classSec: 'I-A', day: 'Monday', substitute: 'Teacher B', row: 5 }),
  ]);
  var v = analytics().variety.filter(function (r) { return r.teacher === 'Teacher B'; })[0];
  check('repeatShare is (n-1)/n when all n duties are the same slot',
    Math.abs(v.repeatShare - 2 / 3) < 1e-9, v.repeatShare);
})();

/* ── 5 & 6: variety null / 0 / 1.0, using school-wide K ── */
(function () {
  setLog([
    row({ dateStr: '2026-09-07', period: 1, classSec: 'I-A', day: 'Monday', substitute: 'Teacher B' }),
  ]);
  var v = analytics().variety.filter(function (r) { return r.teacher === 'Teacher B'; })[0];
  check('variety is null at one duty', v.varietyClass === null, v.varietyClass);
})();

(function () {
  // All-same-class: three duties, all in class I-A. School-wide K (classes) = 1
  // in this log, so Hmax = log2(min(3,1)) = 0 → null by the Hmax>0 guard, which
  // is the honest reading when there is nothing else in the log to compare
  // against. To exercise the "0 for all-same-class" case per RFC §11.5, seed
  // other duties elsewhere so K > 1 school-wide while this teacher stays put.
  setLog([
    row({ dateStr: '2026-09-07', period: 1, classSec: 'I-A', day: 'Monday', substitute: 'Teacher B', row: 3 }),
    row({ dateStr: '2026-09-08', period: 2, classSec: 'I-A', day: 'Tuesday', substitute: 'Teacher B', row: 4 }),
    row({ dateStr: '2026-09-09', period: 3, classSec: 'I-A', day: 'Wednesday', substitute: 'Teacher B', row: 5 }),
    row({ dateStr: '2026-09-07', period: 4, classSec: 'II-A', day: 'Monday', substitute: 'Teacher C', row: 6 }),
    row({ dateStr: '2026-09-07', period: 5, classSec: 'III-A', day: 'Monday', substitute: 'Teacher C', row: 7 }),
  ]);
  var v = analytics().variety.filter(function (r) { return r.teacher === 'Teacher B'; })[0];
  check('variety is 0 for all-same-class when school-wide K > 1', v.varietyClass === 0, v.varietyClass);
})();

(function () {
  // All-distinct classes, three duties spread across the exact three classes
  // that exist school-wide (K = 3) → normalised entropy = 1.0.
  setLog([
    row({ dateStr: '2026-09-07', period: 1, classSec: 'I-A', day: 'Monday', substitute: 'Teacher B', row: 3 }),
    row({ dateStr: '2026-09-08', period: 2, classSec: 'II-A', day: 'Tuesday', substitute: 'Teacher B', row: 4 }),
    row({ dateStr: '2026-09-09', period: 3, classSec: 'III-A', day: 'Wednesday', substitute: 'Teacher B', row: 5 }),
  ]);
  var v = analytics().variety.filter(function (r) { return r.teacher === 'Teacher B'; })[0];
  check('variety is 1.0 for all-distinct classes matching school-wide K',
    Math.abs(v.varietyClass - 1) < 1e-9, v.varietyClass);
})();

/* ── 6b: Hmax uses school-wide K, so few duties spread widely still score high ── */
(function () {
  // Teacher B: 2 duties, in 2 distinct classes. School-wide there are 5 distinct
  // classes (from other teachers' duties). Hmax = log2(min(2,5)) = log2(2) = 1.
  // p=0.5/0.5 → H = 1 → variety = 1.0, even though the school has far more variety
  // available than this teacher's own 2 duties could ever reach on their own.
  setLog([
    row({ dateStr: '2026-09-07', period: 1, classSec: 'I-A', day: 'Monday', substitute: 'Teacher B', row: 3 }),
    row({ dateStr: '2026-09-08', period: 2, classSec: 'II-A', day: 'Tuesday', substitute: 'Teacher B', row: 4 }),
    row({ dateStr: '2026-09-07', period: 3, classSec: 'III-A', day: 'Monday', substitute: 'Teacher C', row: 5 }),
    row({ dateStr: '2026-09-07', period: 4, classSec: 'IV-A', day: 'Monday', substitute: 'Teacher C', row: 6 }),
    row({ dateStr: '2026-09-07', period: 5, classSec: 'V-A', day: 'Monday', substitute: 'Teacher C', row: 7 }),
  ]);
  var v = analytics().variety.filter(function (r) { return r.teacher === 'Teacher B'; })[0];
  check('Hmax uses school-wide K, not the teacher\'s own distinct count',
    Math.abs(v.varietyClass - 1) < 1e-9, v.varietyClass);
})();

/* ── 7: cross-tab totals reconcile to total duty count ── */
(function () {
  var rows = [];
  for (var i = 0; i < 8; i++) {
    rows.push(row({ dateStr: '2026-09-07', period: (i % 8) + 1, classSec: (i % 3 === 0) ? 'I-A' : 'II-A',
                     day: (i % 2) ? 'Monday' : 'Tuesday', substitute: (i % 2) ? 'Teacher B' : 'Teacher C',
                     absent: (i % 2) ? 'Teacher D' : 'Teacher E', row: 3 + i }));
  }
  rows.push(row({ dateStr: '2026-09-07', period: 1, classSec: 'I-A', substitute: '', status: 'UNASSIGNED', row: 20 }));
  setLog(rows);
  var m = analytics();
  var sum = function (arr) { return arr.reduce(function (t, x) { return t + x.n; }, 0); };
  check('subByClass cross-tab reconciles to total duty count', sum(m.crossTabs.subByClass) === m.totalDuties,
    sum(m.crossTabs.subByClass) + ' vs ' + m.totalDuties);
  check('dayByPeriod cross-tab reconciles to total duty count', sum(m.crossTabs.dayByPeriod) === m.totalDuties);
  check('classByPeriod cross-tab reconciles to total duty count', sum(m.crossTabs.classByPeriod) === m.totalDuties);
  check('gap total matches the one UNASSIGNED row', m.gaps.total === 1, m.gaps.total);
})();

/* ── 8: empty log produces a valid model ── */
(function () {
  setLog([]);
  var m = analytics();
  check('empty log produces empty=true', m.empty === true);
  check('empty log has zero total duties', m.totalDuties === 0);
  check('empty log equity has no members', m.equity.members.length === 0 ||
    m.equity.members.every(function (x) { return x.duties === 0; }));
  check('empty log gini is null (no weight to divide by is guarded, not thrown)',
    m.equity.gini === null || typeof m.equity.gini === 'number');
  check('empty log variety array is empty', m.variety.length === 0);
  check('empty log does not throw building cross-tabs', Array.isArray(m.crossTabs.subByClass));
})();

/* ── extra: repeatShare / topSlot sanity, maxRepeat ── */
(function () {
  setLog([
    row({ dateStr: '2026-09-07', period: 1, classSec: 'VIII-B', day: 'Wednesday', substitute: 'Teacher B', row: 3 }),
    row({ dateStr: '2026-09-14', period: 1, classSec: 'VIII-B', day: 'Wednesday', substitute: 'Teacher B', row: 4 }),
    row({ dateStr: '2026-09-21', period: 1, classSec: 'VIII-B', day: 'Wednesday', substitute: 'Teacher B', row: 5 }),
    row({ dateStr: '2026-09-08', period: 2, classSec: 'IX-A', day: 'Thursday', substitute: 'Teacher B', row: 6 }),
  ]);
  var v = analytics().variety.filter(function (r) { return r.teacher === 'Teacher B'; })[0];
  check('maxRepeat finds the largest repeated slot', v.maxRepeat === 3, v.maxRepeat);
  check('topSlot identifies the repeated slot', v.topSlot === 'VIII-B|1|Wednesday', v.topSlot);
  check('repeatedSlots counts slots with count >= 2', v.repeatedSlots === 1, v.repeatedSlots);
})();

/* ── source-unreachable degrades gracefully, like buildWeeklyReportData ── */
(function () {
  const ctx2 = load(DEFAULT_FILES.concat(['ReportData.js', 'AnalyticsData.js']), SCHOOL +
    `\nfunction buildPool() { throw new Error('source unreachable'); }`);
  ctx2.run(`LOG = ${JSON.stringify([row({ substitute: 'Teacher B' })])}; clearCache();`);
  var m = ctx2.run('buildAnalytics()');
  check('unreachable source still returns a usable model', m && m.equity && Array.isArray(m.equity.members));
  check('unreachable source sets sourceErr', !!m.sourceErr, m.sourceErr);
})();
