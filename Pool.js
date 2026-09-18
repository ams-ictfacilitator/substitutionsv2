/**
 * ============================================================
 * Pool.gs — The substitute rotation
 *
 * Requirement #1: map the full list & order of available substitutes
 * from the Allotment. Each teacher's "Substitution" allotment is their
 * WEEKLY cap. Teachers are interleaved by weight so a teacher allotted 4
 * appears twice as often as one allotted 2, spread evenly:
 *      A=2, B=4  →  B, A, B, B, A, B   (evenly distributed)
 * ============================================================
 */

/**
 * Build the substitution pool from the allotment.
 * Returns {
 *   members: [{teacher, cap, department, team, rank}],   // rank = position in rotation
 *   order:   ['B','A','B','B','A','B', ...],              // the interleaved sequence
 *   capByTeacher: { teacher: cap },
 *   totalCap: number
 * }
 */
function buildPool() {
  return memo('pool', function () {
    var cfg = getConfig();
    var label = cfg.subLabel.toUpperCase();
    var allot = getAllotment();

    var members = [];
    var seen = {};
    for (var i = 0; i < allot.length; i++) {
      var a = allot[i];
      if (a.subject.toUpperCase() !== label) continue;
      var cap = a.periodsAllotted;
      if (!a.teacher || cap <= 0) continue;
      if (seen[a.teacher]) { continue; }     // one substitution row per teacher
      seen[a.teacher] = true;
      members.push({ teacher: a.teacher, cap: cap, department: a.department, team: a.team });
    }

    var order = interleaveByWeight_(members);

    // Assign each member a rotation rank = index of its FIRST appearance.
    var firstSeen = {};
    for (var j = 0; j < order.length; j++) {
      if (!(order[j] in firstSeen)) firstSeen[order[j]] = j;
    }
    var capByTeacher = {}, totalCap = 0;
    for (var m = 0; m < members.length; m++) {
      members[m].rank = (members[m].teacher in firstSeen) ? firstSeen[members[m].teacher] : 9999;
      capByTeacher[members[m].teacher] = members[m].cap;
      totalCap += members[m].cap;
    }
    members.sort(function (x, y) { return x.rank - y.rank; });

    return { members: members, order: order, capByTeacher: capByTeacher, totalCap: totalCap };
  });
}

/**
 * Evenly interleave members by their cap using credit (stride) scheduling.
 * Every step each teacher earns cap/total credit; the teacher with the most
 * credit (who still has occurrences left) is emitted and pays 1 credit. This
 * spreads each teacher's occurrences uniformly across the whole sequence —
 * a teacher allotted 4 lands twice as often as one allotted 2, with even gaps.
 *   A=2, B=4  →  B, A, B, B, A, B
 */
function interleaveByWeight_(members) {
  var total = 0, i;
  for (i = 0; i < members.length; i++) total += members[i].cap;
  if (total === 0) return [];

  var state = members.map(function (m, idx) {
    return { teacher: m.teacher, cap: m.cap, rate: m.cap / total, credit: 0, left: m.cap, idx: idx };
  });

  var order = [];
  for (var s = 0; s < total; s++) {
    var best = null;
    for (i = 0; i < state.length; i++) {
      var st = state[i];
      if (st.left <= 0) continue;
      st.credit += st.rate;
      if (best === null) { best = st; continue; }
      // most credit wins; ties → larger cap, then earlier original order
      if (st.credit > best.credit + 1e-9 ||
          (Math.abs(st.credit - best.credit) <= 1e-9 && (st.cap > best.cap || (st.cap === best.cap && st.idx < best.idx)))) {
        best = st;
      }
    }
    best.credit -= 1;
    best.left -= 1;
    order.push(best.teacher);
  }
  return order;
}

/**
 * Count substitutions already assigned, per teacher, for a given ISO-week key.
 * Source of truth = the 🗂️ Log tab. Only ASSIGNED rows count.
 * Returns { teacher: count }.
 */
function weekUsageByTeacher(weekKey) {
  var rows = readLogRows_();
  var usage = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.weekKey !== weekKey) continue;
    if (r.status !== 'ASSIGNED') continue;
    usage[r.substitute] = (usage[r.substitute] || 0) + 1;
  }
  return usage;
}

/**
 * Count substitutions assigned to each teacher on a specific date string.
 * Used to enforce the optional per-day cap. Returns { teacher: count }.
 */
function dayUsageByTeacher(dateStr) {
  var rows = readLogRows_();
  var usage = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].dateStr !== dateStr) continue;
    if (rows[i].status !== 'ASSIGNED') continue;
    usage[rows[i].substitute] = (usage[rows[i].substitute] || 0) + 1;
  }
  return usage;
}

/**
 * Term totals per teacher (all ASSIGNED rows). Returns { teacher: count }.
 */
function termUsageByTeacher() {
  var rows = readLogRows_();
  var usage = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].status !== 'ASSIGNED') continue;
    usage[rows[i].substitute] = (usage[rows[i].substitute] || 0) + 1;
  }
  return usage;
}
