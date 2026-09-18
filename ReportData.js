/**
 * ============================================================
 * ReportData.gs — Aggregate one week into a report model.
 *
 * Pure computation: reads the 🗂️ Log, the 🗓️ Leave Register and (when the
 * source workbook is reachable) the substitute pool, and returns a single
 * object the renderer turns into HTML. No side effects, no writes.
 * ============================================================
 */

/**
 * Build the full analysis model for one ISO week.
 * @param {string} weekKey  e.g. "2026-W25"
 * @return {Object} report model
 */
function buildWeeklyReportData(weekKey) {
  var cfg = getConfig();
  var allLog = readLogRows_();
  var allAbsence = readAbsenceRows_();

  var span = weekSpan_(weekKey, cfg);
  var log = allLog.filter(function (r) { return r.weekKey === weekKey; });
  var leave = allAbsence.filter(function (r) { return r.weekKey === weekKey; });

  // Pool / teacher metadata need the source workbook — degrade quietly without it.
  var pool = null, meta = {}, sourceErr = '';
  try { pool = buildPool(); meta = getTeacherMeta(); }
  catch (e) { sourceErr = e.message; }

  // Weeks before the Absence Register existed: synthesise absences from the log
  // so historical reports still show who was away, minus the scope detail.
  var absencesSynthesised = false;
  if (!leave.length && log.length) { leave = synthesiseAbsences_(log); absencesSynthesised = true; }

  var d = {
    weekKey: weekKey,
    cfg: cfg,
    span: span,
    sourceErr: sourceErr,
    absencesSynthesised: absencesSynthesised,
    empty: log.length === 0 && leave.length === 0,
  };

  /* ── headline ── */
  var covered = log.filter(isAssigned_).length;
  d.kpi = {
    teacherDays:  leave.length,
    teachers:     distinct_(leave.map(pick_('teacher'))).length,
    periodsLost:  log.length,
    covered:      covered,
    uncovered:    log.length - covered,
    coverage:     log.length ? Math.round(covered * 1000 / log.length) / 10 : 100,
    substitutes:  distinct_(log.filter(isAssigned_).map(pick_('substitute'))).length,
    reassigned:   sum_(leave.map(pick_('reassignedAway'))),
    daysAffected: distinct_(log.map(pick_('dateStr'))).length,
  };

  /* ── day × period pressure grid ── */
  d.grid = buildGrid_(log, span, cfg);

  /* ── per-day totals ── */
  d.byDay = span.days.map(function (day) {
    var rows = log.filter(function (r) { return r.dateStr === day.dateStr; });
    var lv = leave.filter(function (r) { return r.dateStr === day.dateStr; });
    var c = rows.filter(isAssigned_).length;
    return { name: day.name, short: day.name.slice(0, 3), dateStr: day.dateStr,
             pretty: prettyDate_(day.date), absences: lv.length,
             need: rows.length, covered: c, uncovered: rows.length - c };
  });

  /* ── absences, per teacher ── */
  var absMap = {};
  leave.forEach(function (r) {
    var k = r.teacher;
    if (!absMap[k]) absMap[k] = { teacher: k, dept: r.dept || metaOf_(meta, k, 'department'),
                                  team: r.team || metaOf_(meta, k, 'team'), days: 0, scopes: {},
                                  categories: {}, scheduled: 0, need: 0, covered: 0, uncovered: 0,
                                  reassigned: 0, dates: [] };
    var a = absMap[k];
    a.days++;
    a.scopes[r.type] = (a.scopes[r.type] || 0) + 1;
    a.categories[r.category] = (a.categories[r.category] || 0) + 1;
    a.scheduled += r.scheduled; a.need += r.toCover; a.covered += r.covered;
    a.uncovered += r.uncovered; a.reassigned += r.reassignedAway;
    a.dates.push(r.dateStr);
  });
  d.absences = values_(absMap).sort(function (x, y) { return y.need - x.need || y.days - x.days || x.teacher.localeCompare(y.teacher); });

  /* ── absence type mix, in the canonical order ── */
  var typeMap = {};
  leave.forEach(function (r) { typeMap[r.type] = (typeMap[r.type] || 0) + 1; });
  d.scopeMix = absenceTypeLabels_().concat([UNKNOWN_ABSENCE_TYPE.label])
    .filter(function (t) { return typeMap[t]; })
    .map(function (t) { return { scope: t, n: typeMap[t], pct: pct_(typeMap[t], leave.length) }; });

  /* ── Leave / Permission / OD split — the headline breakdown ── */
  var catMap = {};
  leave.forEach(function (r) {
    if (!catMap[r.category]) catMap[r.category] = { category: r.category, days: 0, teachers: {},
                                                    need: 0, covered: 0, uncovered: 0 };
    var c = catMap[r.category];
    c.days++; c.teachers[r.teacher] = true;
    c.need += r.toCover; c.covered += r.covered; c.uncovered += r.uncovered;
  });
  d.byCategory = ABSENCE_CATEGORIES.concat(['Unknown'])
    .filter(function (name) { return catMap[name]; })
    .map(function (name) {
      var c = catMap[name];
      return { category: name, days: c.days, teachers: Object.keys(c.teachers).length,
               need: c.need, covered: c.covered, uncovered: c.uncovered,
               coverage: c.need ? Math.round(c.covered * 1000 / c.need) / 10 : 100,
               daysPct: pct_(c.days, leave.length), needPct: pct_(c.need, log.length) };
    });

  /* ── absence load by team / department ── */
  d.byTeam = groupCount_(leave, function (r) { return r.team || metaOf_(meta, r.teacher, 'team') || '—'; }, 'toCover');
  d.byDept = groupCount_(leave, function (r) { return r.dept || metaOf_(meta, r.teacher, 'department') || '—'; }, 'toCover');

  /* ── substitute load & fairness ── */
  d.fairness = buildFairness_(log, pool, meta, allLog);

  /* ── disruption by class and subject ── */
  d.byClass = buildDisruption_(log, pick_('classSec'));
  d.bySubject = buildDisruption_(log, pick_('subject'));

  /* ── uncovered risk register ── */
  d.uncovered = log.filter(function (r) { return !isAssigned_(r); })
    .map(function (r) {
      return { dateStr: r.dateStr, day: r.day, period: r.period, classSec: r.classSec,
               subject: r.subject, absent: r.absent, dept: r.dept };
    })
    .sort(function (a, b) { return a.dateStr.localeCompare(b.dateStr) || a.period - b.period; });

  /* ── peak pressure by period of day ── */
  var maxPeak = 0;
  d.peak = [];
  for (var p = 1; p <= cfg.periods; p++) {
    var rows = log.filter(function (r) { return r.period === p; });
    var c2 = rows.filter(isAssigned_).length;
    maxPeak = Math.max(maxPeak, rows.length);
    d.peak.push({ period: p, timing: cfg.periodTimings[p] || '', need: rows.length,
                  covered: c2, uncovered: rows.length - c2 });
  }
  d.peakMax = maxPeak;

  /* ── cover quality ── */
  d.quality = buildQuality_(log, meta);

  /* ── term-to-date trend ── */
  d.trend = buildTrend_(allLog, weekKey);

  /* ── audit ── */
  d.audit = {
    runs: distinct_(log.map(pick_('runId'))).length,
    markedBy: groupCount_(log, function (r) { return r.markedBy || '—'; }, null),
    notified: log.length ? pct_(log.filter(function (r) { return r.notified === '✓'; }).length, log.length) : 0,
  };

  /* ── rules in force, and how often the dedicated ones actually held ── */
  d.rules = buildRulesSummary_(log, meta);

  /* ── headline call-outs ── */
  d.callouts = buildCallouts_(d);

  return d;
}

/* ───────── section builders ───────── */

function buildGrid_(log, span, cfg) {
  var cells = {}, max = 0;
  log.forEach(function (r) {
    var k = r.dateStr + '|' + r.period;
    if (!cells[k]) cells[k] = { need: 0, uncovered: 0 };
    cells[k].need++;
    if (!isAssigned_(r)) cells[k].uncovered++;
    max = Math.max(max, cells[k].need);
  });
  var rows = [];
  for (var p = 1; p <= cfg.periods; p++) {
    var row = { period: p, timing: cfg.periodTimings[p] || '', cells: [] };
    span.days.forEach(function (day) {
      var c = cells[day.dateStr + '|' + p] || { need: 0, uncovered: 0 };
      row.cells.push({ need: c.need, uncovered: c.uncovered });
    });
    rows.push(row);
  }
  return { rows: rows, max: max, days: span.days };
}

/**
 * Load vs weight. Fair share for a teacher = weight x totalSubs / totalWeight.
 * Balance = 100 x (1 - total variation distance between actual and fair), so
 * 100 is a perfectly proportional week and lower means lumpier.
 */
function buildFairness_(log, pool, meta, allLog) {
  var assigned = log.filter(isAssigned_);
  var week = {}, term = {};
  assigned.forEach(function (r) { week[r.substitute] = (week[r.substitute] || 0) + 1; });
  allLog.filter(isAssigned_).forEach(function (r) { term[r.substitute] = (term[r.substitute] || 0) + 1; });

  var members = [], seen = {};
  if (pool) {
    pool.members.forEach(function (m) {
      seen[m.teacher] = true;
      members.push({ teacher: m.teacher, weight: m.cap, team: m.team, dept: m.department,
                     actual: week[m.teacher] || 0, termTotal: term[m.teacher] || 0, inPool: true });
    });
  }
  // anyone who covered this week but is not (or no longer) in the pool
  for (var name in week) {
    if (seen[name]) continue;
    members.push({ teacher: name, weight: 0, team: metaOf_(meta, name, 'team'),
                   dept: metaOf_(meta, name, 'department'),
                   actual: week[name], termTotal: term[name] || 0, inPool: false });
  }

  var totalWeight = sum_(members.map(pick_('weight')));
  var totalSubs = assigned.length;
  var absDev = 0, maxActual = 0;
  members.forEach(function (m) {
    m.fair = totalWeight > 0 ? (m.weight * totalSubs / totalWeight) : 0;
    m.dev = m.actual - m.fair;
    absDev += Math.abs(m.dev);
    maxActual = Math.max(maxActual, m.actual);
  });

  var balance = totalSubs > 0 ? Math.max(0, Math.round(100 * (1 - absDev / (2 * totalSubs)))) : 100;
  var ranked = members.slice().sort(function (a, b) { return b.actual - a.actual || b.termTotal - a.termTotal || a.teacher.localeCompare(b.teacher); });
  var byDev = members.slice().sort(function (a, b) { return b.dev - a.dev; });

  return {
    members: ranked,
    idle: members.filter(function (m) { return m.inPool && m.actual === 0; })
                 .sort(function (a, b) { return a.termTotal - b.termTotal || a.teacher.localeCompare(b.teacher); }),
    totalWeight: totalWeight, totalSubs: totalSubs, maxActual: maxActual,
    balance: balance,
    over: byDev.length ? byDev[0] : null,
    under: byDev.length ? byDev[byDev.length - 1] : null,
    poolSize: pool ? pool.members.length : 0,
  };
}

function buildDisruption_(log, keyFn) {
  var map = {};
  log.forEach(function (r) {
    var k = keyFn(r) || '—';
    if (!map[k]) map[k] = { key: k, need: 0, covered: 0, uncovered: 0 };
    map[k].need++;
    if (isAssigned_(r)) map[k].covered++; else map[k].uncovered++;
  });
  return values_(map).sort(function (a, b) { return b.need - a.need || a.key.localeCompare(b.key); });
}

/**
 * Subject-matched cover = the substitute's department equals the slot's department.
 * Doubles held = an assigned period whose neighbour period, same day, same class,
 * went to the same substitute — the class kept one adult across the block.
 */
function buildQuality_(log, meta) {
  var assigned = log.filter(isAssigned_);
  var matched = 0, judged = 0;
  assigned.forEach(function (r) {
    var subDept = metaOf_(meta, r.substitute, 'department');
    if (!r.dept || !subDept) return;
    judged++;
    if (eqi_(r.dept, subDept)) matched++;
  });

  var index = {};
  assigned.forEach(function (r) { index[r.dateStr + '|' + r.classSec + '|' + r.period + '|' + r.substitute] = true; });
  var doubles = 0;
  assigned.forEach(function (r) {
    if (index[r.dateStr + '|' + r.classSec + '|' + (r.period + 1) + '|' + r.substitute] ||
        index[r.dateStr + '|' + r.classSec + '|' + (r.period - 1) + '|' + r.substitute]) doubles++;
  });

  return {
    judged: judged, matched: matched, matchPct: judged ? pct_(matched, judged) : null,
    doubles: doubles, doublesPct: assigned.length ? pct_(doubles, assigned.length) : 0,
    assigned: assigned.length,
  };
}

function buildTrend_(allLog, weekKey) {
  var map = {};
  allLog.forEach(function (r) {
    if (!r.weekKey) return;
    if (r.weekKey > weekKey) return;               // never show weeks after the reported one
    if (!map[r.weekKey]) map[r.weekKey] = { weekKey: r.weekKey, need: 0, covered: 0 };
    map[r.weekKey].need++;
    if (isAssigned_(r)) map[r.weekKey].covered++;
  });
  var series = values_(map).sort(function (a, b) { return a.weekKey.localeCompare(b.weekKey); }).slice(-12);
  var max = 1, total = 0;
  series.forEach(function (w) {
    max = Math.max(max, w.need); total += w.need;
    w.uncovered = w.need - w.covered;
    w.coverage = w.need ? Math.round(w.covered * 100 / w.need) : 100;
    w.label = w.weekKey.replace(/^\d{4}-/, '');
    w.current = w.weekKey === weekKey;
  });
  var avg = series.length ? total / series.length : 0;
  var cur = series.filter(function (w) { return w.current; })[0];
  return {
    series: series, max: max, avg: Math.round(avg * 10) / 10,
    weeks: series.length,
    delta: (cur && series.length > 1) ? cur.need - Math.round(avg) : null,
  };
}

function buildCallouts_(d) {
  var out = [];
  if (d.byClass.length) {
    out.push({ label: 'Most disrupted class', value: d.byClass[0].key,
               note: d.byClass[0].need + ' period' + s_(d.byClass[0].need) + ' without their own teacher' });
  }
  if (d.absences.length) {
    out.push({ label: 'Most periods lost', value: d.absences[0].teacher,
               note: d.absences[0].days + ' day' + s_(d.absences[0].days) + ' out · ' + d.absences[0].need + ' period' + s_(d.absences[0].need) });
  }
  var od = d.byCategory.filter(function (c) { return c.category === 'OD'; })[0];
  if (od && od.need) {
    out.push({ label: 'On official duty', value: od.days + ' teacher-day' + s_(od.days),
               note: od.need + ' period' + s_(od.need) + ' lost to school business, not personal leave' });
  }
  if (d.fairness.members.length && d.fairness.members[0].actual > 0) {
    var top = d.fairness.members[0];
    out.push({ label: 'Carried the most cover', value: top.teacher,
               note: top.actual + ' period' + s_(top.actual) + ' this week · ' + top.termTotal + ' this term' });
  }
  return out.slice(0, 3);
}

/** Rebuild absence rows from the log, for weeks predating the Absence Register. */
function synthesiseAbsences_(log) {
  var map = {};
  log.forEach(function (r) {
    if (!r.absent) return;
    var k = r.dateStr + '|' + r.absent;
    if (!map[k]) map[k] = { dateStr: r.dateStr, day: r.day, weekKey: r.weekKey, teacher: r.absent,
                            dept: r.dept, team: '', type: UNKNOWN_ABSENCE_TYPE.label,
                            category: UNKNOWN_ABSENCE_TYPE.category, periodsAway: '',
                            scheduled: 0, toCover: 0, covered: 0, uncovered: 0,
                            reassignedAway: 0, runId: r.runId, markedBy: r.markedBy };
    map[k].toCover++;
    if (isAssigned_(r)) map[k].covered++; else map[k].uncovered++;
  });
  return values_(map);
}

/**
 * Which rules were in force, plus a derived check on the dedicated-substitute
 * ones: of the periods belonging to that team, how many the named teacher
 * actually took. Derived from the log — no per-assignment column needed.
 */
function buildRulesSummary_(log, meta) {
  var out = { active: [], problems: [], dedicated: [] };
  var ctx;
  try { ctx = buildRuleContext_(); } catch (e) { return out; }
  out.active = ctx.active || [];
  out.problems = ctx.problems || [];
  if (!ctx.any) return out;

  var teamByClass = ctx.teamByClass || {};
  for (var teamKey in ctx.dedicatedByTeam) {
    var names = {};
    ctx.dedicatedByTeam[teamKey].forEach(function (n) { names[n] = true; });
    var total = 0, held = 0;
    for (var i = 0; i < log.length; i++) {
      var r = log[i];
      var t = up_(teamByClass[up_(parseClassPart_(r.classSec)) + '|' + up_(parseSectionPart_(r.classSec))] || '');
      if (t !== teamKey) continue;
      total++;
      if (isAssigned_(r) && names[r.substitute]) held++;
    }
    if (total) {
      out.dedicated.push({
        team: ctx.dedicatedTeamLabel[teamKey] || teamKey,
        names: ctx.dedicatedByTeam[teamKey].join(', '),
        total: total, held: held, pct: pct_(held, total),
      });
    }
  }
  return out;
}

/* ───────── week arithmetic ───────── */

/** {year, week} from "2026-W25". */
function parseWeekKey_(weekKey) {
  var m = String(weekKey).match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  return { year: +m[1], week: +m[2] };
}

/** Monday of a given ISO year/week. */
function mondayOfIsoWeek_(year, week) {
  var jan4 = new Date(year, 0, 4);
  var dow = jan4.getDay() || 7;                       // Mon=1 … Sun=7
  return new Date(year, 0, 4 - (dow - 1) + (week - 1) * 7);
}

/** Monday of the ISO week containing `date`. */
function mondayOf_(date) {
  var dow = date.getDay() || 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (dow - 1));
}

function addDays_(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/**
 * The working days of a week key, in configured order, with real dates.
 * Handles six-day weeks or any other configured Days list.
 */
function weekSpan_(weekKey, cfg) {
  var wk = parseWeekKey_(weekKey);
  var monday = wk ? mondayOfIsoWeek_(wk.year, wk.week) : mondayOf_(new Date());
  var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var days = [];
  for (var i = 0; i < 7; i++) {
    var dt = addDays_(monday, i);
    var nm = names[dt.getDay()];
    for (var j = 0; j < cfg.days.length; j++) {
      if (cfg.days[j].toLowerCase() === nm.toLowerCase()) {
        days.push({ dayIndex: j, name: cfg.days[j], date: dt, dateStr: isoDate_(dt) });
        break;
      }
    }
  }
  days.sort(function (a, b) { return a.dayIndex - b.dayIndex; });
  var last = days.length ? days[days.length - 1].date : addDays_(monday, 4);
  var first = days.length ? days[0].date : monday;
  return {
    monday: monday, first: first, last: last, days: days,
    label: rangeLabel_(first, last),
    fileLabel: Utilities.formatDate(first, Session.getScriptTimeZone(), 'dd MMM') + '-' +
               Utilities.formatDate(last, Session.getScriptTimeZone(), 'dd MMM yyyy'),
  };
}

/** "15 – 19 Jun 2026", collapsing a shared month or year. */
function rangeLabel_(a, b) {
  var tz = Session.getScriptTimeZone();
  var f = function (d, p) { return Utilities.formatDate(d, tz, p); };
  if (f(a, 'yyyy') !== f(b, 'yyyy')) return f(a, 'dd MMM yyyy') + ' – ' + f(b, 'dd MMM yyyy');
  if (f(a, 'MMM') !== f(b, 'MMM')) return f(a, 'dd MMM') + ' – ' + f(b, 'dd MMM yyyy');
  return f(a, 'dd') + ' – ' + f(b, 'dd MMM yyyy');
}

/* ───────── tiny helpers ───────── */

function isAssigned_(r) { return r.status === 'ASSIGNED'; }
function pick_(k) { return function (o) { return o[k]; }; }
function sum_(arr) { var t = 0; for (var i = 0; i < arr.length; i++) t += (arr[i] || 0); return t; }
function distinct_(arr) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i];
    if (!v || seen[v]) continue;
    seen[v] = true; out.push(v);
  }
  return out;
}
function values_(obj) { var o = []; for (var k in obj) o.push(obj[k]); return o; }
function pct_(n, d) { return d ? Math.round(n * 1000 / d) / 10 : 0; }
function s_(n) { return n === 1 ? '' : 's'; }
function metaOf_(meta, name, field) { return (meta && meta[name] && meta[name][field]) || ''; }
function groupCount_(rows, keyFn, weightField) {
  var map = {};
  rows.forEach(function (r) {
    var k = keyFn(r) || '—';
    if (!map[k]) map[k] = { key: k, n: 0, weight: 0 };
    map[k].n++;
    if (weightField) map[k].weight += (r[weightField] || 0);
  });
  return values_(map).sort(function (a, b) { return (b.weight - a.weight) || (b.n - a.n) || a.key.localeCompare(b.key); });
}
