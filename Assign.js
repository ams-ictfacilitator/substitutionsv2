/**
 * ============================================================
 * Assign.gs — The substitution engine.
 *
 *  computePlan()  : pure calculation, no side effects (used for preview)
 *  commitPlan()   : writes to the Log + fires notifications
 *
 * Rules honoured:
 *   • Only TEACHING periods are covered (staff duties are never substituted).
 *   • A substitute must be genuinely free that period (not teaching, not on
 *     duty, not already pulled into another class this run).
 *   • Each teacher's weekly cap = their "Substitution" allotment.
 *   • Load is balanced by utilisation, then by the interleaved rotation order,
 *     with optional same-department / same-team / continuity preferences.
 * ============================================================
 */

/**
 * Compute a substitution plan WITHOUT saving anything.
 * @param {string|Date} dateInput
 * @param {string[]} absentTeachers
 * @param {Object} [opts]  { periodFilter: { teacher: [periods...] } }
 * @return {Object} plan
 */
function computePlan(dateInput, absentTeachers, opts) {
  clearCache();
  opts = opts || {};
  var cfg = getConfig();

  var date = parseDate_(dateInput);
  if (!date) return planError_('That date could not be read. Use DD/MM/YYYY.');
  var dayIndex = dayIndexForDate_(date);
  if (dayIndex < 0) return planError_(prettyDate_(date) + ' is not a working day.');

  absentTeachers = (absentTeachers || []).map(norm_).filter(function (t) { return t.length > 0; });
  if (!absentTeachers.length) return planError_('Pick at least one absent teacher.');

  var dateStr = isoDate_(date);
  var weekKey = weekKey_(date);
  var day = dayName_(dayIndex);

  var absentSet = {};
  absentTeachers.forEach(function (t) { absentSet[t] = true; });

  // ── live data ──
  var timetable = getTimetable();
  var duties = getStaffDuties();
  var rules = buildRuleContext_();      // compiled once; the loop only does lookups
  var pool = buildPool();
  var meta = getTeacherMeta();
  var subjDept = getSubjectDeptLookup();

  // busy[teacher|period] for THIS day (teaching + staff duty)
  var busy = {};
  for (var i = 0; i < timetable.length; i++) {
    var e = timetable[i];
    if (e.dayIndex === dayIndex && e.teacher) busy[e.teacher + '|' + e.period] = true;
  }
  for (var d = 0; d < duties.length; d++) {
    if (duties[d].dayIndex === dayIndex) busy[duties[d].teacher + '|' + duties[d].period] = true;
  }

  // ── the absent teachers' teaching slots to cover (respecting each one's absence window) ──
  // pf[teacher] = [periods] limits cover to those periods (half-day / permission).
  // No entry = full day. scopeHas_ centralises the check.
  var nonSub = {};
  cfg.nonSubSubjects.forEach(function (s) { nonSub[s.toUpperCase()] = true; });
  var pf = opts.periodFilter || {};

  var slots = [];
  for (var t = 0; t < timetable.length; t++) {
    var s = timetable[t];
    if (s.dayIndex !== dayIndex) continue;
    if (!absentSet[s.teacher]) continue;
    if (!s.subject) continue;
    if (nonSub[s.subject.toUpperCase()]) continue;
    if (!scopeHas_(pf, s.teacher, s.period)) continue;     // outside this teacher's absence window
    slots.push({
      absent: s.teacher, class: s.class, section: s.section,
      classSec: s.section ? (s.class + '-' + s.section) : s.class,
      subject: s.subject, period: s.period,
      dept: subjDept[up_(s.class) + '|' + up_(s.section) + '|' + up_(s.subject)] || (meta[s.teacher] && meta[s.teacher].department) || '',
    });
  }

  // ── prior assignments already saved for THIS date ──
  // • OTHER absentees: still absent → never a candidate, and their cover is busy.
  // • A teacher we're marking now who was ALSO substituting earlier today → those periods
  //   (within her absence window) are ORPHANED and must be re-assigned to someone else.
  // Usage tallies drive fairness (termUsed never resets); rows being replaced are excluded.
  var logRows = readLogRows_();
  var termUsed = {}, weekUsed = {}, dayUsed = {}, dayAbsent = {};
  for (var L = 0; L < logRows.length; L++) {
    var r = logRows[L];
    var sameDate = (r.dateStr === dateStr);

    // orphaned: a now-absent teacher's own earlier substitution duty, within her window
    if (sameDate && r.status === 'ASSIGNED' &&
        absentSet[r.substitute] && !absentSet[r.absent] && scopeHas_(pf, r.substitute, r.period)) {
      slots.push({
        absent: r.absent, class: parseClassPart_(r.classSec), section: parseSectionPart_(r.classSec),
        classSec: r.classSec, subject: r.subject, period: r.period, dept: r.dept,
        reassigned: true, previousSub: r.substitute,
      });
      continue;   // do NOT tally this cover — it's being removed/reassigned
    }

    if (sameDate && !absentSet[r.absent]) {
      if (r.absent) dayAbsent[r.absent] = true;                                       // still absent today
      if (r.status === 'ASSIGNED' && r.substitute) busy[r.substitute + '|' + r.period] = true; // already covering
    }

    if (r.status !== 'ASSIGNED') continue;
    if (sameDate && absentSet[r.absent]) continue;   // own cover being recomputed this run
    termUsed[r.substitute] = (termUsed[r.substitute] || 0) + 1;
    if (r.weekKey === weekKey) weekUsed[r.substitute] = (weekUsed[r.substitute] || 0) + 1;
    if (sameDate) dayUsed[r.substitute] = (dayUsed[r.substitute] || 0) + 1;
  }

  slots.sort(function (a, b) { return a.period - b.period || a.absent.localeCompare(b.absent); });

  // candidate-exclusion set = teachers absent in THIS run ∪ already absent today
  var excludeSet = {};
  for (var ax in absentSet) excludeSet[ax] = true;
  for (var dx in dayAbsent) excludeSet[dx] = true;

  // ── per-run state ──
  var weekBasis = cfg.fairnessBasis === 'Week';
  var basisUsedMap = weekBasis ? weekUsed : termUsed;
  var basisTotal = 0; for (var bt in basisUsedMap) basisTotal += basisUsedMap[bt];
  var totalCap = pool.totalCap || 1;

  var runUsed = {};                 // increments within this run (delta for term/week/day)
  var runCount = 0;                 // total assigned this run (advances the fair-share target)
  var assignedBusy = {};            // teacher|period locked this run
  var coverByTeacher = {};          // teacher -> { period: classKey } for continuity

  var assignments = [];
  for (var k = 0; k < slots.length; k++) {
    var slot = slots[k];
    var pick = chooseSubstitute_(slot, pool, {
      absentSet: excludeSet, busy: busy, assignedBusy: assignedBusy,
      termUsed: termUsed, weekUsed: weekUsed, dayUsed: dayUsed, runUsed: runUsed,
      weekBasis: weekBasis, basisTotal: basisTotal, runCount: runCount, totalCap: totalCap,
      coverByTeacher: coverByTeacher, meta: meta, cfg: cfg, rules: rules,
      absentTeam: (meta[slot.absent] && meta[slot.absent].team) || '',
    });

    if (pick && pick.teacher) {
      var who = pick.teacher;
      assignedBusy[who + '|' + slot.period] = true;
      runUsed[who] = (runUsed[who] || 0) + 1;
      runCount++;
      if (!coverByTeacher[who]) coverByTeacher[who] = {};
      coverByTeacher[who][slot.period] = slot.classSec;
      assignments.push(extend_(slot, { substitute: who, status: 'ASSIGNED', reason: pick.reason || '',
        termTotal: (termUsed[who] || 0) + runUsed[who] }));
    } else {
      assignments.push(extend_(slot, { substitute: '', status: 'UNASSIGNED',
        reason: (pick && pick.reason) || 'No substitute free' }));
    }
  }

  // ── one record per absent teacher, for the 🗓️ Absence Register ──
  // This is what makes an absence visible even when it needed no cover at all.
  var scopeBy = opts.scopeByTeacher || {};
  var absences = absentTeachers.map(function (t) {
    var win = pf[t] || null;
    var scheduled = 0;
    for (var i = 0; i < timetable.length; i++) {
      var e = timetable[i];
      if (e.dayIndex !== dayIndex || e.teacher !== t || !e.subject) continue;
      if (!scopeHas_(pf, t, e.period)) continue;
      scheduled++;
    }
    var own = assignments.filter(function (a) { return !a.reassigned && a.absent === t; });
    var covered = own.filter(function (a) { return a.status === 'ASSIGNED'; }).length;
    return {
      teacher: t,
      department: (meta[t] && meta[t].department) || '',
      team: (meta[t] && meta[t].team) || '',
      scope: scopeBy[t] || deriveScopeLabel_(cfg, win),
      category: absenceType_(scopeBy[t] || deriveScopeLabel_(cfg, win)).category,
      periodsAway: win ? formatPeriodList_(win) : formatPeriodList_(rangePeriods_(1, cfg.periods)),
      scheduled: scheduled,
      toCover: own.length,
      covered: covered,
      uncovered: own.length - covered,
      reassignedAway: assignments.filter(function (a) { return a.reassigned && a.previousSub === t; }).length,
    };
  });

  return buildPlanSummary_({
    ok: true, dateStr: dateStr, prettyDate: prettyDate_(date), day: day,
    weekKey: weekKey, absentTeachers: absentTeachers, assignments: assignments,
    poolSize: pool.members.length, periodFilter: pf, absences: absences,
    rules: rules.active, ruleProblems: rules.problems,
  });
}

/**
 * Choose a substitute for one slot, honouring the ⚖️ Rules tab.
 *
 * Two passes. The first restricts candidates to the slot's dedicated
 * substitutes when a rule names them; if none of them can take it, the second
 * pass runs normal logic and the plan records that the dedicated substitute
 * was unavailable. Floor limits are hard in BOTH passes — a mobility
 * restriction is a physical constraint, not a preference.
 *
 * Returns {teacher, reason} — teacher is '' when nothing could be assigned.
 */
function chooseSubstitute_(slot, pool, st) {
  var ded = st.rules ? dedicatedForSlot_(st.rules, slot) : null;

  if (ded) {
    var only = {};
    ded.names.forEach(function (n) { only[up_(n)] = true; });
    var first = scanCandidates_(slot, pool, st, only);
    if (first.best) {
      return { teacher: first.best, reason: joinReason_('Dedicated ' + ded.team + ' substitute', first.bonusReason) };
    }
    var open = scanCandidates_(slot, pool, st, null);
    if (open.best) {
      return { teacher: open.best,
               reason: joinReason_('No dedicated ' + ded.team + ' substitute free — normal rotation', open.bonusReason) };
    }
    return { teacher: '', reason: noCandidateReason_(open, ded) };
  }

  var only2 = scanCandidates_(slot, pool, st, null);
  return only2.best
    ? { teacher: only2.best, reason: only2.bonusReason }
    : { teacher: '', reason: noCandidateReason_(only2, null) };
}

/**
 * The scoring loop. `restrictTo` is a set of UPPERCASED names, or null.
 * Everything a rule needs is a precompiled lookup, so this stays O(pool).
 */
function scanCandidates_(slot, pool, st, restrictTo) {
  var best = null, bestScore = -Infinity, bestRank = Infinity, bestBlock = false;
  var blockedByFloor = 0, blockedByCap = 0, blockedByBusy = 0;
  var weekBasis = st.weekBasis;
  // fair-share target after this assignment, in subs: cap × (assignedSoFar + 1) ÷ totalWeight
  var targetK = (st.basisTotal + st.runCount + 1) / st.totalCap;

  for (var i = 0; i < pool.members.length; i++) {
    var m = pool.members[i];
    var name = m.teacher;
    if (st.absentSet[name]) continue;
    if (restrictTo && !restrictTo[up_(name)]) continue;
    if (st.busy[name + '|' + slot.period] || st.assignedBusy[name + '|' + slot.period]) { blockedByBusy++; continue; }

    // hard rule: floor limits are never overridden
    if (st.rules && st.rules.any && !floorAllows_(st.rules, name, slot)) { blockedByFloor++; continue; }

    var run = st.runUsed[name] || 0;

    // weekly ceiling: Week basis caps at the allotment; an optional hard cap may also apply.
    var weeklyLimit = weekBasis ? m.cap : Infinity;
    if (st.cfg.maxPerWeek > 0) weeklyLimit = Math.min(weeklyLimit, st.cfg.maxPerWeek);
    if (((st.weekUsed[name] || 0) + run) >= weeklyLimit) { blockedByCap++; continue; }
    // optional per-day ceiling
    if (st.cfg.maxPerDay > 0 && ((st.dayUsed[name] || 0) + run) >= st.cfg.maxPerDay) { blockedByCap++; continue; }

    // fairness: pick the teacher furthest BELOW their proportional fair share (largest
    // deficit, in subs). This balances cumulative load ∝ weight and is cap-aware, so the
    // whole pool cycles over the term. Preferences add a small, uniform sub-bonus that
    // only breaks near-ties — a preferred teacher is pulled at most ~1 sub past fair share.
    var used = (weekBasis ? (st.weekUsed[name] || 0) : (st.termUsed[name] || 0)) + run;
    var deficit = (m.cap * targetK) - used;
    if (st.cfg.preferDept && slot.dept && m.department && eqi_(m.department, slot.dept)) deficit += 0.5;
    if (st.cfg.preferTeam && st.absentTeam && m.team && eqi_(m.team, st.absentTeam)) deficit += 0.25;
    if (st.cfg.preferContinuity && hasAdjacentCover_(st.coverByTeacher[name], slot)) deficit += 0.75;

    var blockBonus = st.rules ? blockBonusFor_(st.rules, name, slot) : 0;
    deficit += blockBonus;

    if (deficit > bestScore + 1e-9 || (Math.abs(deficit - bestScore) <= 1e-9 && m.rank < bestRank)) {
      best = name; bestScore = deficit; bestRank = m.rank; bestBlock = blockBonus > 0;
    }
  }

  return { best: best, bonusReason: bestBlock ? 'same block' : '',
           blockedByFloor: blockedByFloor, blockedByCap: blockedByCap, blockedByBusy: blockedByBusy };
}

/** Say WHY nothing could be assigned — otherwise a rule looks like a bug. */
function noCandidateReason_(scan, ded) {
  var bits = [];
  if (ded) bits.push('no dedicated ' + ded.team + ' substitute free');
  if (scan.blockedByFloor) bits.push(scan.blockedByFloor + ' blocked by floor limits');
  if (scan.blockedByCap) bits.push(scan.blockedByCap + ' at their cap');
  if (scan.blockedByBusy) bits.push(scan.blockedByBusy + ' already teaching or covering');
  return bits.length ? 'No substitute free — ' + bits.join(', ') : 'No substitute free';
}

function joinReason_(a, b) { return b ? a + ' · ' + b : a; }

/** True if this teacher already covers the same class in an adjacent period this run. */
function hasAdjacentCover_(cover, slot) {
  if (!cover) return false;
  return cover[slot.period - 1] === slot.classSec || cover[slot.period + 1] === slot.classSec;
}

/**
 * Persist a plan and notify. `markedBy` = coordinator email.
 * Removes any prior log rows for the same (date, absent teacher) before writing,
 * so re-marking the same teacher on the same day is idempotent.
 */
function commitPlan(plan, markedBy) {
  if (!plan || !plan.ok) return { ok: false, error: (plan && plan.error) || 'No plan to commit.' };

  // replace prior rows: this run's own cover + any cover the now-absent teachers were
  // providing (orphaned, within their leave window) — those are reassigned in this plan.
  removeForCommit_(plan);

  var runId = 'R' + new Date().getTime().toString(36).toUpperCase();
  var meta = { dateStr: plan.dateStr, day: plan.day, weekKey: plan.weekKey, runId: runId, markedBy: markedBy || activeEmail_() };

  var notified = false;
  try { notified = sendNotifications_(plan); } catch (e) { plan.notifyError = e.message; }

  appendToLog_(meta, plan.assignments, notified);
  appendToAbsenceRegister_(meta, plan.absences);
  refreshDashboards_();

  return { ok: true, runId: runId, notified: notified, notifyError: plan.notifyError || '',
           assigned: plan.summary.assigned, unassigned: plan.summary.unassigned,
           reassigned: plan.summary.reassigned };
}

/**
 * Remove the log rows this commit will replace, for plan.dateStr:
 *   • own cover    — rows whose Absent teacher is in this run (any period)
 *   • orphaned     — rows whose Substitute is a now-absent teacher, within their leave window
 */
function removeForCommit_(plan) {
  var sheet = sheet_(SS.LOG);
  if (!sheet || sheet.getLastRow() < LOG_DATA_START) return;
  var absentSet = {}; plan.absentTeachers.forEach(function (t) { absentSet[t] = true; });
  var pf = plan.periodFilter || {};
  var rows = readLogRows_();
  var del = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.dateStr !== plan.dateStr) continue;
    var own = absentSet[r.absent];
    var orphan = absentSet[r.substitute] && !absentSet[r.absent] && scopeHas_(pf, r.substitute, r.period);
    if (own || orphan) del.push(r.row);
  }
  deleteRowsBatched_(sheet, del);
  removeAbsenceRows_(plan.dateStr, plan.absentTeachers);
  clearCache();
}

/* ───────── plan helpers ───────── */

function planError_(msg) { return { ok: false, error: msg, assignments: [], summary: { total: 0, assigned: 0, unassigned: 0 } }; }

function buildPlanSummary_(plan) {
  var byTeacher = {}, assigned = 0, unassigned = 0, reassigned = 0;
  for (var i = 0; i < plan.assignments.length; i++) {
    var a = plan.assignments[i];
    if (a.reassigned) reassigned++;
    if (a.status === 'ASSIGNED') {
      assigned++;
      if (!byTeacher[a.substitute]) byTeacher[a.substitute] = [];
      byTeacher[a.substitute].push(a);
    } else unassigned++;
  }
  plan.summary = { total: plan.assignments.length, assigned: assigned, unassigned: unassigned,
                   reassigned: reassigned, byTeacher: byTeacher };
  return plan;
}

function extend_(base, extra) {
  var o = {}; for (var k in base) o[k] = base[k]; for (var j in extra) o[j] = extra[j]; return o;
}
function eqi_(a, b) { return String(a).trim().toUpperCase() === String(b).trim().toUpperCase(); }
function activeEmail_() { try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } }

/* ───────── leave-scope helpers (half-day / permission) ───────── */

/** True if `period` is within `teacher`'s leave window. pf[teacher] absent = full day. */
function scopeHas_(pf, teacher, period) {
  var s = pf[teacher];
  return !s || s.indexOf(period) >= 0;
}

/**
 * Turn an absence type + optional period list into the periods to substitute.
 * The window comes from ABSENCE_TYPES, so the eight types stay defined in
 * exactly one place. null means the whole working day.
 */
function resolveScopePeriods_(cfg, type, periods) {
  switch (absenceType_(type).window) {
    case 'AM':      return rangePeriods_(1, cfg.firstAfternoonPeriod - 1);
    case 'PM':      return rangePeriods_(cfg.firstAfternoonPeriod, cfg.periods);
    case 'PERIODS': return normalizePeriods_(periods, cfg.periods);
    default:        return null;   // FULL
  }
}

/** Canonical stored label for any absence-type value. */
function normalizeScopeLabel_(v) { return absenceType_(v).label; }

/** {teacher: 'Leave - Morning'} for one type applied to every listed teacher. */
function buildScopeMap_(teachers, type) {
  var label = absenceType_(type).label, m = {};
  (teachers || []).forEach(function (t) { m[norm_(t)] = label; });
  return m;
}

/**
 * Infer a type back from a resolved period window. Only reachable when a
 * caller supplied periods but no type, so it can only ever return a Leave
 * variant — OD is never guessed at.
 */
function deriveScopeLabel_(cfg, periods) {
  if (!periods || !periods.length) return 'Leave - Full day';
  if (sameSet_(periods, rangePeriods_(1, cfg.firstAfternoonPeriod - 1))) return 'Leave - Morning';
  if (sameSet_(periods, rangePeriods_(cfg.firstAfternoonPeriod, cfg.periods))) return 'Leave - Afternoon';
  if (sameSet_(periods, rangePeriods_(1, cfg.periods))) return 'Leave - Full day';
  return 'Permission';
}

function sameSet_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** [1,2,3,7,8] → "P1–P3, P7–P8". */
function formatPeriodList_(arr) {
  if (!arr || !arr.length) return '';
  var v = arr.slice().sort(function (x, y) { return x - y; });
  var out = [], start = v[0], prev = v[0];
  for (var i = 1; i <= v.length; i++) {
    if (i < v.length && v[i] === prev + 1) { prev = v[i]; continue; }
    out.push(start === prev ? 'P' + start : 'P' + start + '–P' + prev);
    if (i < v.length) { start = v[i]; prev = v[i]; }
  }
  return out.join(', ');
}

/** Build a per-teacher period filter from one scope applied to all teachers. */
function buildPeriodFilter_(teachers, scope, periods) {
  var sp = resolveScopePeriods_(getConfig(), scope, periods);
  if (!sp) return null;
  var f = {};
  (teachers || []).forEach(function (t) { f[norm_(t)] = sp; });
  return f;
}

function rangePeriods_(a, b) {
  var o = []; for (var p = Math.max(1, a); p <= b; p++) o.push(p); return o.length ? o : null;
}

/** Accept an array of period numbers or a string like "7,8" / "3-4" / "P1". */
function normalizePeriods_(input, maxP) {
  if (typeof input === 'string') return parsePeriodsList_(input, maxP);
  if (!input || !input.length) return null;
  var seen = {}, o = [];
  for (var i = 0; i < input.length; i++) {
    var n = parseInt(input[i], 10);
    if (n >= 1 && n <= maxP && !seen[n]) { seen[n] = true; o.push(n); }
  }
  o.sort(function (a, b) { return a - b; });
  return o.length ? o : null;
}

function parsePeriodsList_(str, maxP) {
  var seen = {}, o = [];
  String(str || '').split(',').forEach(function (tok) {
    tok = tok.trim().replace(/^p/i, '');
    if (!tok) return;
    var m = tok.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) { for (var a = +m[1]; a <= +m[2]; a++) addP_(o, seen, a, maxP); }
    else if (/^\d+$/.test(tok)) addP_(o, seen, +tok, maxP);
  });
  o.sort(function (a, b) { return a - b; });
  return o.length ? o : null;
}
function addP_(o, seen, n, maxP) { if (n >= 1 && n <= maxP && !seen[n]) { seen[n] = true; o.push(n); } }

/** Split a stored "Class" cell ("VIII-B" / "LKG") back into class + section. */
function parseClassPart_(cs) { var i = String(cs).lastIndexOf('-'); return i < 0 ? String(cs || '') : String(cs).slice(0, i); }
function parseSectionPart_(cs) { var i = String(cs).lastIndexOf('-'); return i < 0 ? '' : String(cs).slice(i + 1); }
