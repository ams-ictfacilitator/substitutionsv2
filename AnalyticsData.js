/**
 * ============================================================
 * AnalyticsData.gs — Aggregate the whole 🗂️ Log into an analytics model.
 *
 * Pure computation, one pass over the log (RFC-002 §8): builds every equity,
 * variety, cross-tab, class-side and gap figure together, then returns a
 * single object. No sheet writes, no rendering, no side effects. Feeds both
 * the filed PDF (T-006) and the live 🔎 Analytics tab (T-007) — neither may
 * compute anything of its own, so every figure they need lives here.
 * ============================================================
 */

/**
 * Build the full analytics model over all recorded history.
 * @return {Object} analytics model
 */
function buildAnalytics() {
  var cfg = getConfig();
  var log = readLogRows_();

  // Pool / teacher metadata need the source workbook — degrade quietly without it,
  // same policy as buildWeeklyReportData().
  var pool = null, meta = {}, allTeachers = null, sourceErr = '';
  try { pool = buildPool(); meta = getTeacherMeta(); allTeachers = getAllTeachers(); }
  catch (e) { sourceErr = e.message; }

  var d = {
    cfg: cfg,
    sourceErr: sourceErr,
    empty: log.length === 0,
    totalRows: log.length,
  };

  var assigned = log.filter(isAssigned_);
  var unassigned = log.filter(function (r) { return !isAssigned_(r); });
  d.totalDuties = assigned.length;

  /* ── school-wide category counts, for Hmax's K (RFC §4.1) ──
     Computed once over the WHOLE log so no teacher is normalised against
     their own footprint — that would let everyone with few duties look
     perfectly varied. */
  var kClasses = distinct_(assigned.map(pick_('classSec'))).length;
  var kPeriods = distinct_(assigned.map(pick_('period'))).length;
  var kDays = distinct_(assigned.map(pick_('day'))).length;
  d.schoolWide = { distinctClasses: kClasses, distinctPeriods: kPeriods, distinctDays: kDays };

  var latestDate = '';
  log.forEach(function (r) { if (r.dateStr > latestDate) latestDate = r.dateStr; });
  d.latestDate = latestDate || null;

  /* ── ONE pass over the assigned duties, building every substitute-side map ──
     RFC §8: all maps built together in a single loop, not one pass per metric. */
  var subs = {}; // teacher -> accumulator
  function subOf_(name) {
    if (!subs[name]) {
      subs[name] = {
        teacher: name, duties: 0,
        classCounts: {}, periodCounts: {}, dayCounts: {}, subjectCounts: {}, absenteeCounts: {},
        slotCounts: {}, firstDuty: null, lastDuty: null,
      };
    }
    return subs[name];
  }

  // Cross-tabs (RFC §5) and class-side view (RFC §6), same single pass.
  var subByClass = {};      // substitute -> class -> count
  var absentBySub = {};     // absentTeacher -> substitute -> count
  var dayByPeriod = {};     // day -> period -> count
  var classByPeriod = {};   // class -> period -> count
  var byWeek = {};          // weekKey -> { need, covered }
  var classAgg = {};        // class -> { total, subCounts:{} }

  log.forEach(function (r) {
    if (!byWeek[r.weekKey]) byWeek[r.weekKey] = { weekKey: r.weekKey, need: 0, covered: 0 };
    byWeek[r.weekKey].need++;
    if (isAssigned_(r)) byWeek[r.weekKey].covered++;
  });

  assigned.forEach(function (r) {
    var s = subOf_(r.substitute);
    s.duties++;
    s.classCounts[r.classSec] = (s.classCounts[r.classSec] || 0) + 1;
    s.periodCounts[r.period] = (s.periodCounts[r.period] || 0) + 1;
    s.dayCounts[r.day] = (s.dayCounts[r.day] || 0) + 1;
    if (r.subject) s.subjectCounts[r.subject] = (s.subjectCounts[r.subject] || 0) + 1;
    if (r.absent) s.absenteeCounts[r.absent] = (s.absenteeCounts[r.absent] || 0) + 1;

    var slotKey = r.classSec + '|' + r.period + '|' + r.day;
    s.slotCounts[slotKey] = (s.slotCounts[slotKey] || 0) + 1;

    if (!s.firstDuty || r.dateStr < s.firstDuty) s.firstDuty = r.dateStr;
    if (!s.lastDuty || r.dateStr > s.lastDuty) s.lastDuty = r.dateStr;

    if (!subByClass[r.substitute]) subByClass[r.substitute] = {};
    subByClass[r.substitute][r.classSec] = (subByClass[r.substitute][r.classSec] || 0) + 1;

    if (r.absent) {
      if (!absentBySub[r.absent]) absentBySub[r.absent] = {};
      absentBySub[r.absent][r.substitute] = (absentBySub[r.absent][r.substitute] || 0) + 1;
    }

    if (!dayByPeriod[r.day]) dayByPeriod[r.day] = {};
    dayByPeriod[r.day][r.period] = (dayByPeriod[r.day][r.period] || 0) + 1;

    if (!classByPeriod[r.classSec]) classByPeriod[r.classSec] = {};
    classByPeriod[r.classSec][r.period] = (classByPeriod[r.classSec][r.period] || 0) + 1;

    if (!classAgg[r.classSec]) classAgg[r.classSec] = { key: r.classSec, total: 0, subCounts: {} };
    classAgg[r.classSec].total++;
    classAgg[r.classSec].subCounts[r.substitute] = (classAgg[r.classSec].subCounts[r.substitute] || 0) + 1;
  });

  // Gap analysis (RFC §7) — UNASSIGNED rows only.
  var gapByClass = {}, gapByPeriod = {}, gapByDay = {}, gapByAbsent = {};
  unassigned.forEach(function (r) {
    gapByClass[r.classSec] = (gapByClass[r.classSec] || 0) + 1;
    gapByPeriod[r.period] = (gapByPeriod[r.period] || 0) + 1;
    gapByDay[r.day] = (gapByDay[r.day] || 0) + 1;
    if (r.absent) gapByAbsent[r.absent] = (gapByAbsent[r.absent] || 0) + 1;
  });

  /* ── equity (RFC §3) ── */
  d.equity = buildEquity_(subs, pool, meta, allTeachers, log.length ? d.totalDuties : 0, latestDate);

  /* ── variety (RFC §4) ── */
  d.variety = buildVariety_(subs, kClasses, kPeriods, kDays);

  /* ── cross-tabs (RFC §5) ── */
  d.crossTabs = {
    subByClass: matrixToRows_(subByClass, d.totalDuties),
    absentBySub: matrixToRows_(absentBySub, d.totalDuties),
    dayByPeriod: matrixToRows_(dayByPeriod, d.totalDuties),
    classByPeriod: matrixToRows_(classByPeriod, d.totalDuties),
    byWeek: values_(byWeek).sort(function (a, b) { return a.weekKey.localeCompare(b.weekKey); })
      .map(function (w) {
        return { weekKey: w.weekKey, duties: w.covered, need: w.need,
                 coverage: w.need ? pct_(w.covered, w.need) : 100 };
      }),
  };

  /* ── class-side view (RFC §6) ── */
  d.classView = values_(classAgg).map(function (c) {
    var top = topOf_(c.subCounts);
    return {
      classSec: c.key, total: c.total,
      distinctSubstitutes: Object.keys(c.subCounts).length,
      topSubstitute: top.key, topCount: top.count,
      monotony: c.total ? pct_(top.count, c.total) : 0,
    };
  }).sort(function (a, b) { return b.total - a.total || a.classSec.localeCompare(b.classSec); });

  /* ── gap analysis (RFC §7) ── */
  d.gaps = {
    total: unassigned.length,
    coverageRate: log.length ? pct_(d.totalDuties, log.length) : 100,
    byClass: countMapToRows_(gapByClass),
    byPeriod: countMapToRows_(gapByPeriod),
    byDay: countMapToRows_(gapByDay),
    byAbsent: countMapToRows_(gapByAbsent),
    trend: values_(byWeek).sort(function (a, b) { return a.weekKey.localeCompare(b.weekKey); })
      .map(function (w) {
        return { weekKey: w.weekKey, uncovered: w.need - w.covered,
                 coverage: w.need ? pct_(w.covered, w.need) : 100 };
      }),
  };

  return d;
}

/* ───────── equity (RFC §3) ───────── */

function buildEquity_(subs, pool, meta, allTeachers, totalDuties, latestDate) {
  var members = [], seen = {};
  var neverCalled = [], belowShare = [], notInPool = [];
  var totalWeight = pool ? poolTotalWeight_(pool) : 0;

  if (pool) {
    pool.members.forEach(function (m) {
      seen[m.teacher] = true;
      var s = subs[m.teacher];
      members.push(equityRow_(m.teacher, m.cap, m.department, m.team, s, totalDuties,
                               totalWeight, latestDate, true));
    });
  }

  // Seed the FULL teacher universe from the Allotment (§3, §11.2) — this is what
  // surfaces the actual complainant: a teacher with no Substitution row and zero
  // duties. Seeding only from `subs` (who has duties) can never contain them,
  // since by definition they have none.
  if (allTeachers) {
    allTeachers.forEach(function (name) {
      if (seen[name]) return;
      seen[name] = true;
      var row = equityRow_(name, 0, metaOf_(meta, name, 'department'), metaOf_(meta, name, 'team'),
                            subs[name], totalDuties, totalWeight, latestDate, false);
      members.push(row);
    });
  }

  // Fallback: anyone who has duties in the log but wasn't reached above (no
  // source workbook, or a substitute who somehow isn't in the Allotment at
  // all) is still surfaced rather than silently dropped.
  for (var name in subs) {
    if (seen[name]) continue;
    var row2 = equityRow_(name, 0, metaOf_(meta, name, 'department'), metaOf_(meta, name, 'team'),
                           subs[name], totalDuties, totalWeight, latestDate, false);
    members.push(row2);
  }

  members.forEach(function (m) {
    if (!m.inPool) { notInPool.push(m); return; }
    if (m.neverCalled) { neverCalled.push(m); return; }
    if (m.deficit < -1) { belowShare.push(m); }
  });

  var weighted = members.filter(function (m) { return m.inPool && m.weight > 0; })
    .sort(function (a, b) { return a.perWeight - b.perWeight; });
  var gini = giniOf_(weighted.map(pick_('perWeight')));

  return {
    members: members.sort(function (a, b) { return b.duties - a.duties || a.teacher.localeCompare(b.teacher); }),
    neverCalled: neverCalled.sort(function (a, b) { return a.teacher.localeCompare(b.teacher); }),
    belowShare: belowShare.sort(function (a, b) { return a.deficit - b.deficit; }),
    notInPool: notInPool.sort(function (a, b) { return a.teacher.localeCompare(b.teacher); }),
    gini: gini,
    giniBand: giniBand_(gini),
    poolSize: pool ? pool.members.length : 0,
  };
}

function poolTotalWeight_(pool) { return pool.totalCap; }

function equityRow_(teacher, weight, dept, team, s, totalDuties, totalWeight, latestDate, inPool) {
  var duties = s ? s.duties : 0;
  var fairShare = totalWeight > 0 ? (weight * totalDuties / totalWeight) : 0;
  var firstDuty = s ? s.firstDuty : null;
  var lastDuty = s ? s.lastDuty : null;
  var daysSinceLast = null;
  if (lastDuty && latestDate) daysSinceLast = daysBetween_(lastDuty, latestDate);
  return {
    teacher: teacher, weight: weight, dept: dept || '', team: team || '',
    duties: duties, fairShare: fairShare, deficit: duties - fairShare,
    perWeight: weight > 0 ? (duties / weight) : 0,
    firstDuty: firstDuty, lastDuty: lastDuty, daysSinceLast: daysSinceLast,
    neverCalled: duties === 0, inPool: inPool,
  };
}

function daysBetween_(fromStr, toStr) {
  var a = parseIsoDate_(fromStr), b = parseIsoDate_(toStr);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function parseIsoDate_(s) {
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

/** Gini over `x` (already sorted ascending by the caller). RFC §3 formula. */
function giniOf_(x) {
  var n = x.length;
  if (!n) return null;
  var total = sum_(x);
  if (total === 0) return null;
  var weighted = 0;
  for (var i = 0; i < n; i++) weighted += (i + 1) * x[i];
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

function giniBand_(g) {
  if (g === null) return 'n/a';
  if (g <= 0.2) return 'even';
  if (g <= 0.4) return 'moderate';
  return 'uneven';
}

/* ───────── variety (RFC §4) ───────── */

function buildVariety_(subs, kClasses, kPeriods, kDays) {
  var rows = [];
  for (var name in subs) {
    var s = subs[name];
    var duties = s.duties;

    var top = topOf_(s.slotCounts);
    var repeatedSlots = 0, repeatSum = 0;
    for (var k in s.slotCounts) {
      var c = s.slotCounts[k];
      if (c >= 2) repeatedSlots++;
      repeatSum += (c - 1);
    }

    var vClass = entropyScore_(s.classCounts, duties, kClasses);
    var vPeriod = entropyScore_(s.periodCounts, duties, kPeriods);
    var vDay = entropyScore_(s.dayCounts, duties, kDays);

    var comps = [vClass, vPeriod, vDay].filter(function (v) { return v !== null; });
    var overall = comps.length ? (sum_(comps) / comps.length) : null;

    rows.push({
      teacher: name, duties: duties,
      distinctClasses: Object.keys(s.classCounts).length,
      distinctPeriods: Object.keys(s.periodCounts).length,
      distinctDays: Object.keys(s.dayCounts).length,
      distinctSubjects: Object.keys(s.subjectCounts).length,
      distinctAbsentees: Object.keys(s.absenteeCounts).length,
      slotCounts: s.slotCounts,
      maxRepeat: top.count,
      topSlot: top.key,
      repeatedSlots: repeatedSlots,
      repeatShare: duties ? (repeatSum / duties) : 0,
      varietyClass: vClass, varietyPeriod: vPeriod, varietyDay: vDay,
      overallVariety: overall,
      herfindahlClass: herfindahl_(s.classCounts, duties),
    });
  }
  rows.sort(function (a, b) {
    var av = a.overallVariety === null ? -1 : a.overallVariety;
    var bv = b.overallVariety === null ? -1 : b.overallVariety;
    return av - bv || b.duties - a.duties || a.teacher.localeCompare(b.teacher);
  });
  return rows;
}

/**
 * Normalised Shannon entropy for one dimension (RFC §4.1).
 * K is the school-wide category count for this dimension — never the
 * teacher's own — so a teacher with few duties spread widely still scores
 * fairly against what was actually available.
 */
function entropyScore_(counts, duties, K) {
  if (duties <= 1) return null;
  var H = 0;
  for (var k in counts) {
    var p = counts[k] / duties;
    if (p > 0) H -= p * log2_(p);
  }
  var hmax = log2_(Math.min(duties, K));
  return hmax > 0 ? (H / hmax) : null;
}

function herfindahl_(counts, duties) {
  if (!duties) return null;
  var s = 0;
  for (var k in counts) { var p = counts[k] / duties; s += p * p; }
  return s;
}

function log2_(x) { return Math.log(x) / Math.LN2; }

/* ───────── shared small helpers ───────── */

/** Largest-count entry in a {key: count} map, as {key, count} (key '' / count 0 if empty). */
function topOf_(map) {
  var bestKey = '', bestCount = 0;
  for (var k in map) {
    if (map[k] > bestCount) { bestKey = k; bestCount = map[k]; }
  }
  return { key: bestKey, count: bestCount };
}

/** {row: {col: n}} → sorted array of {row, col, n, pct}, for cross-tab display. */
function matrixToRows_(matrix, total) {
  var out = [];
  for (var row in matrix) {
    for (var col in matrix[row]) {
      var n = matrix[row][col];
      out.push({ row: row, col: col, n: n, pct: pct_(n, total) });
    }
  }
  return out.sort(function (a, b) { return b.n - a.n || a.row.localeCompare(b.row) || String(a.col).localeCompare(String(b.col)); });
}

/** {key: count} → sorted array of {key, n}, largest first. */
function countMapToRows_(map) {
  var out = [];
  for (var k in map) out.push({ key: k, n: map[k] });
  return out.sort(function (a, b) { return b.n - a.n || a.key.localeCompare(b.key); });
}
