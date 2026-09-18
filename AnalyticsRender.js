/**
 * ============================================================
 * AnalyticsRender.gs — Turn the analytics model (AnalyticsData.js) into
 * printable HTML for the filed PDF (T-006, RFC-002 §9).
 *
 * Renders only. Every figure comes from buildAnalytics() — nothing here is
 * computed. If a number is missing from the model, that is a T-005 gap, not
 * something to patch around here (the tab, T-007, renders the same model and
 * the two must never disagree).
 *
 * Reuses ReportRender.js's chrome exactly: the same constraints apply
 * (Apps Script's HTML→PDF converter has no flexbox/grid, no web fonts —
 * table-based layout, inline styles, the light RC palette, @page A4).
 * `hbar_`, `miniCard_`, `sectionTitle_`, `panel_`, `zebraStyle_`, `twoUp_`,
 * `swatch_`, `pad3_`, `reportCss_`, `esc_`, `s_`, `pct_` all live in
 * ReportRender.js / ReportData.js and are reused as-is — never redefined
 * here, since Apps Script concatenates every file into one namespace and a
 * duplicate `function` would silently overwrite the original.
 * ============================================================
 */

/**
 * Render the whole analytics document.
 * @param {Object} d      model from buildAnalytics()
 * @param {Object} info   {seq, generatedOn, generatedBy, preview}
 */
function renderAnalyticsHtml_(d, info) {
  info = info || {};
  var cfg = d.cfg;
  var h = [];

  h.push('<!DOCTYPE html><html><head><meta charset="utf-8">');
  h.push('<title>' + esc_(analyticsTitle_(d, info)) + '</title>');
  h.push(reportCss_());
  h.push('</head><body><div class="page">');

  if (info.preview) {
    h.push('<div class="noprint bar">'
      + '<span>Preview — nothing has been saved yet.</span>'
      + '<button onclick="window.print()">Print / Save as PDF</button></div>');
  }

  h.push(analyticsMasthead_(d, info));

  if (d.empty) {
    h.push(panel_(RC.ind50, RC.indigo,
      'No substitution history has been recorded yet. Once cover has been logged, this report '
      + 'will show who is carrying it and how varied their duties are.'));
    h.push('</div></body></html>');
    return h.join('');
  }

  if (d.sourceErr) {
    h.push(panel_(RC.amber50, RC.amber,
      '<b>Equity figures are partial.</b> The main timetable workbook could not be read, so '
      + 'substitution weights, fair share and the three cohorts below are unavailable. '
      + esc_(d.sourceErr)));
  }

  h.push(howToReadPanel_(d));

  /* ─── headline equity ─── */
  h.push(sectionTitle_('01', 'Headline equity', 'Is the load spread across the pool in proportion to what each teacher has taken on?'));
  h.push(equityKpiStrip_(d));

  /* ─── three cohorts ─── */
  h.push(sectionTitle_('02', 'Three populations', 'Conflating these misdirects the fix (PRD §10.3) — each is reported separately.'));
  h.push(cohortNeverCalled_(d));
  h.push(cohortBelowShare_(d));
  h.push(cohortNotInPool_(d));

  /* ─── ranked comparative table ─── */
  h.push('<div class="brk"></div>');
  h.push(sectionTitle_('03', 'Every teacher, ranked', 'Duties, allotment weight, fair share, deficit, variety and their most-repeated slot — one row per teacher.'));
  h.push(comparativeTable_(d));

  /* ─── outlier profiles ─── */
  h.push('<div class="brk"></div>');
  h.push(sectionTitle_('04', 'Outlier profiles', 'Never called first, then furthest below fair share, then lowest measured variety — capped at 12.'));
  h.push(outlierProfiles_(d));

  /* ─── cross-tabs ─── */
  h.push('<div class="brk"></div>');
  h.push(sectionTitle_('05', 'Cross-tabulations', 'Who keeps landing where, and when the pressure falls. Top 15 by total; the rest folded into “others”.'));
  h.push(twoUp_(crossTabCard_('Substitute × class', d.crossTabs.subByClass, 'Substitute', 'Class'),
                crossTabCard_('Absent teacher × substitute', d.crossTabs.absentBySub, 'Absent teacher', 'Substitute')));
  h.push(twoUp_(crossTabCard_('Weekday × period', d.crossTabs.dayByPeriod, 'Day', 'Period'),
                crossTabCard_('Class × period', d.crossTabs.classByPeriod, 'Class', 'Period')));
  h.push(weekTrendCard_(d));

  /* ─── class-side monotony ─── */
  h.push('<div class="brk"></div>');
  h.push(sectionTitle_('06', 'Class-side monotony', 'The mirror complaint — a class that keeps seeing the same face.'));
  h.push(classMonotonyTable_(d));

  /* ─── gap analysis ─── */
  h.push('<div class="brk"></div>');
  h.push(sectionTitle_('07', 'Gap analysis', 'Periods that went uncovered, and whether coverage is improving.'));
  h.push(gapAnalysis_(d));

  h.push('<table class="avoid" style="margin-top:16px"><tr><td class="meta" style="padding-top:10px;border-top:1px solid ' + RC.hair + '">'
    + 'Generated automatically from the Substitution Analytics engine. Figures are drawn from every '
    + 'row in the substitution log' + (d.latestDate ? ' up to ' + esc_(d.latestDate) : '') + '. Diagnostic only — no assignment behaviour changes as a result of this report.'
    + '</td></tr></table>');

  h.push('</div></body></html>');
  return h.join('');
}

function analyticsTitle_(d, info) {
  return (d.cfg.schoolName || 'School') + ' — Substitution Analytics'
    + (info.seq ? ' ' + pad3_(info.seq) : '');
}

/* ───────── chrome ───────── */

function analyticsMasthead_(d, info) {
  var cfg = d.cfg;
  return '<table class="avoid" style="margin-bottom:14px"><tr>'
    + '<td style="border-bottom:2.5px solid ' + RC.indigo + ';padding-bottom:9px">'
    +   '<div class="mast-s">' + esc_(cfg.schoolName) + ' &middot; ' + esc_(cfg.termLabel) + '</div>'
    +   '<div class="mast-t">Substitution Analytics</div>'
    +   '<div class="mast-d">All recorded history' + (d.latestDate ? ' &middot; <span class="mut">as of ' + esc_(d.latestDate) + '</span>' : '') + '</div>'
    + '</td>'
    + '<td width="150" style="border-bottom:2.5px solid ' + RC.indigo + ';padding-bottom:9px;text-align:right" class="meta">'
    +   (info.seq ? '<div style="font-family:' + RS + ';font-size:15pt;color:' + RC.indigo + '">No. ' + pad3_(info.seq) + '</div>' : '')
    +   '<div>Generated ' + esc_(info.generatedOn || prettyDate_(new Date())) + '</div>'
    +   (info.generatedBy ? '<div>by ' + esc_(info.generatedBy) + '</div>' : '')
    +   '<div>Diagnostic report — no signature required</div>'
    + '</td></tr></table>';
}

/** Plain-English explainer for the two scores a reader will not otherwise be able to judge. */
function howToReadPanel_(d) {
  return panel_(RC.paper, RC.subtle,
    '<b>How to read this.</b> '
    + '<b>Variety score</b> (0–1) measures how spread out a teacher\'s duties are across classes, periods and '
    + 'weekdays, normalised against what was actually available school-wide. 1.0 means their duties were spread as '
    + 'widely as possible; 0 means every duty landed in the same slot. A teacher called only once has no variety to '
    + 'measure and is shown as “—”, never as 0. '
    + '<b>Gini coefficient</b> (0–1) measures how evenly load is spread across the pool relative to allotment weight: '
    + '0 means everyone carries exactly their weighted share, 1 means one teacher carries everything. '
    + '≤0.20 is even, ≤0.40 is moderate, above that is uneven.');
}

/* ─── headline equity ─── */

function equityKpiStrip_(d) {
  var e = d.equity;
  var giniTxt = e.gini === null ? '—' : (Math.round(e.gini * 100) / 100).toFixed(2);
  var giniColor = e.gini === null ? RC.subtle : (e.gini <= 0.2 ? RC.teal : e.gini <= 0.4 ? RC.amber : RC.rose);
  var giniTint = e.gini === null ? RC.paper : (e.gini <= 0.2 ? RC.teal50 : e.gini <= 0.4 ? RC.amber50 : RC.rose50);
  var tiles = [
    ['Pool size', e.poolSize, 'teachers with a Substitution allotment', RC.indigo, RC.ind50],
    ['Total duties', d.totalDuties, 'ASSIGNED rows in the whole log', RC.indigo, RC.ind50],
    ['Gini coefficient', giniTxt, e.giniBand, giniColor, giniTint],
    ['Never called', e.neverCalled.length, 'in the pool, zero duties', e.neverCalled.length ? RC.rose : RC.teal, e.neverCalled.length ? RC.rose50 : RC.teal50],
    ['Below fair share', e.belowShare.length, 'deficit worse than −1', e.belowShare.length ? RC.amber : RC.teal, e.belowShare.length ? RC.amber50 : RC.teal50],
    ['Not in the pool', e.notInPool.length, 'no Substitution allotment', RC.violet, RC.violet50],
  ];
  var cells = tiles.map(function (t) {
    return '<td width="16.6%" style="padding:0 4px 0 0">'
      + '<table><tr><td style="background:' + t[4] + ';border-radius:8px;padding:9px 9px 8px;text-align:center">'
      + '<div style="font-size:6.8pt;letter-spacing:.6px;text-transform:uppercase;color:' + t[3] + ';font-weight:bold">' + esc_(t[0]) + '</div>'
      + '<div style="font-family:' + RS + ';font-size:19pt;color:' + t[3] + ';line-height:1.15">' + t[1] + '</div>'
      + '<div style="font-size:7pt;color:' + RC.subtle + '">' + esc_(String(t[2])) + '</div>'
      + '</td></tr></table></td>';
  }).join('');
  return '<table class="avoid" style="margin-bottom:10px"><tr>' + cells + '</tr></table>';
}

/* ─── three cohorts ─── */

function cohortNeverCalled_(d) {
  var list = d.equity.neverCalled;
  if (!list.length) return panel_(RC.teal50, RC.teal, '<b>Nobody in the pool has gone uncalled.</b> Every teacher with a Substitution allotment has at least one duty on record.');
  var names = list.map(function (m) {
    return esc_(m.teacher) + (m.weight ? ' <span class="mut">(weight ' + m.weight + ')</span>' : '');
  }).join(' &nbsp;·&nbsp; ');
  return miniCard_('In the pool, never called — ' + list.length + ' teacher' + s_(list.length),
    '<div class="sm">' + names + '</div>'
    + '<div class="sm mut" style="margin-top:4px">Has a Substitution allotment but zero duties in the whole log. '
    + 'The fix, if any, lies with the engine or their availability — see RFC-002 §10.3.</div>');
}

function cohortBelowShare_(d) {
  var list = d.equity.belowShare;
  if (!list.length) return panel_(RC.teal50, RC.teal, '<b>Nobody in the pool is far below their fair share.</b> No teacher\'s deficit exceeds −1 period.');
  var rows = list.slice(0, 20).map(function (m, i) {
    return '<tr' + zebraStyle_(i) + '>'
      + '<td class="td nm">' + esc_(m.teacher) + '</td>'
      + '<td class="td sm mut">' + esc_(m.dept || '—') + '</td>'
      + '<td class="td num">' + m.duties + '</td>'
      + '<td class="td num sm mut">' + (Math.round(m.fairShare * 10) / 10) + '</td>'
      + '<td class="td num" style="color:' + RC.amber + ';font-weight:bold">' + (Math.round(m.deficit * 10) / 10) + '</td></tr>';
  }).join('');
  var more = list.length > 20 ? '<div class="sm mut" style="margin-top:4px">' + (list.length - 20) + ' further teacher(s) below share.</div>' : '';
  return miniCard_('In the pool, far below fair share — ' + list.length + ' teacher' + s_(list.length),
    '<table><tr><td class="th">Teacher</td><td class="th">Dept</td><td class="th num">Duties</td>'
    + '<td class="th num">Fair share</td><td class="th num">Deficit</td></tr>' + rows + '</table>' + more
    + '<div class="sm mut" style="margin-top:4px">Called, but well under their weighted fair share. The fix, if any, lies with the engine — see RFC-002 §10.3.</div>');
}

function cohortNotInPool_(d) {
  var list = d.equity.notInPool;
  if (!list.length) return panel_(RC.paper, RC.subtle, '<b>Every teacher on record has a Substitution allotment.</b> Nobody is missing from the pool.');
  var names = list.map(function (m) { return esc_(m.teacher); }).join(' &nbsp;·&nbsp; ');
  return panel_(RC.violet50, RC.violet,
    '<b>Not in the pool — ' + list.length + ' teacher' + s_(list.length) + ' — this is not an engine problem.</b> '
    + 'These teachers have no <b>Substitution</b> row in the Allotment, so their weight is 0 and they are '
    + '<i>correctly</i> never called — the engine has never had the option. If any of them should be receiving '
    + 'substitution duties, the remedy is to add a Substitution row for them in the Allotment, not to change this '
    + 'software. Listed: ' + names + '.');
}

/* ─── ranked comparative table ─── */

function varietyByTeacher_(d) {
  var m = {};
  d.variety.forEach(function (v) { m[v.teacher] = v; });
  return m;
}

function varietyCell_(v) {
  return v === null ? '—' : (Math.round(v * 100) / 100).toFixed(2);
}

function comparativeTable_(d) {
  var members = d.equity.members;
  if (!members.length) return '<div class="sm mut">No teachers on record.</div>';
  var vmap = varietyByTeacher_(d);
  var rows = members.map(function (m, i) {
    var v = vmap[m.teacher];
    var overall = v ? v.overallVariety : null;
    var maxRepeat = v ? v.maxRepeat : 0;
    var topSlot = v && v.topSlot ? slotLabel_(v.topSlot) + ' × ' + v.maxRepeat : '—';
    var deficitColor = m.deficit < -1 ? RC.amber : (m.deficit > 1 ? RC.indigo : RC.subtle);
    return '<tr' + zebraStyle_(i) + '>'
      + '<td class="td nm">' + esc_(m.teacher) + (m.inPool ? '' : ' <span class="chip" style="background:' + RC.violet50 + ';color:' + RC.violet + '">not in pool</span>') + '</td>'
      + '<td class="td sm mut">' + esc_(m.dept || '—') + '</td>'
      + '<td class="td num">' + m.duties + '</td>'
      + '<td class="td num sm mut">' + (m.weight || '—') + '</td>'
      + '<td class="td num sm mut">' + (m.inPool ? (Math.round(m.fairShare * 10) / 10) : '—') + '</td>'
      + '<td class="td num" style="color:' + deficitColor + ';font-weight:bold">' + (m.inPool ? (Math.round(m.deficit * 10) / 10) : '—') + '</td>'
      + '<td class="td num">' + varietyCell_(overall) + '</td>'
      + '<td class="td num sm">' + maxRepeat + '</td>'
      + '<td class="td sm mut">' + esc_(topSlot) + '</td></tr>';
  }).join('');
  return '<table style="table-layout:fixed"><tr>'
    + '<td class="th" width="19%">Teacher</td><td class="th" width="10%">Dept</td>'
    + '<td class="th num" width="8%">Duties</td><td class="th num" width="9%">Weight</td>'
    + '<td class="th num" width="10%">Fair share</td><td class="th num" width="9%">Deficit</td>'
    + '<td class="th num" width="10%">Variety</td><td class="th num" width="9%">Max repeat</td>'
    + '<td class="th" width="16%">Top slot</td></tr>' + rows + '</table>';
}

/* ─── outlier profiles ─── */

/** Never called, then furthest below share, then lowest measured (non-null) variety — capped at 12, no duplicates. */
function pickOutliers_(d) {
  var out = [], seen = {};
  function add(teacher, reason, detail) {
    if (seen[teacher] || out.length >= 12) return;
    seen[teacher] = true;
    out.push({ teacher: teacher, reason: reason, detail: detail });
  }
  d.equity.neverCalled.forEach(function (m) {
    add(m.teacher, 'Never called', 'Weight ' + m.weight + (m.dept ? ' · ' + m.dept : ''));
  });
  d.equity.belowShare.forEach(function (m) {
    add(m.teacher, 'Furthest below fair share', m.duties + ' duties vs fair share ' + (Math.round(m.fairShare * 10) / 10)
      + ' (deficit ' + (Math.round(m.deficit * 10) / 10) + ')');
  });
  d.variety
    .filter(function (v) { return v.overallVariety !== null; })
    .slice() // already ascending by overallVariety (AnalyticsData sort), safe to reuse order
    .forEach(function (v) {
      add(v.teacher, 'Lowest variety', 'Variety ' + varietyCell_(v.overallVariety) + ' over ' + v.duties + ' duties'
        + (v.topSlot ? ' · repeats ' + slotLabel_(v.topSlot) + ' × ' + v.maxRepeat : ''));
    });
  return out;
}

function outlierProfiles_(d) {
  var picks = pickOutliers_(d);
  if (!picks.length) return '<div class="sm mut">No outliers to profile — history is too thin, or evenly spread.</div>';
  var vmap = varietyByTeacher_(d);
  var emap = {};
  d.equity.members.forEach(function (m) { emap[m.teacher] = m; });

  var reasonTint = { 'Never called': [RC.rose, RC.rose50], 'Furthest below fair share': [RC.amber, RC.amber50],
                      'Lowest variety': [RC.violet, RC.violet50] };
  var cells = picks.map(function (p) {
    var m = emap[p.teacher];
    var v = vmap[p.teacher];
    var tint = reasonTint[p.reason] || [RC.indigo, RC.ind50];
    return '<td width="25%" style="padding:0 6px 6px 0">'
      + '<table class="avoid" style="border:1px solid ' + RC.hair + ';border-radius:7px"><tr><td style="padding:9px 10px">'
      + '<div style="font-size:6.8pt;letter-spacing:.5px;text-transform:uppercase;color:' + tint[0] + ';font-weight:bold">' + esc_(p.reason) + '</div>'
      + '<div class="nm" style="font-size:10.5pt;margin-top:2px">' + esc_(p.teacher) + '</div>'
      + '<div class="sm mut" style="margin-top:2px">' + esc_(p.detail) + '</div>'
      + (m ? '<div class="sm" style="margin-top:5px">Duties <b>' + m.duties + '</b> &nbsp; Variety <b>' + varietyCell_(v ? v.overallVariety : null) + '</b></div>' : '')
      + '</td></tr></table></td>';
  });
  var rows = [];
  for (var i = 0; i < cells.length; i += 4) rows.push('<tr>' + cells.slice(i, i + 4).join('') + '</tr>');
  return '<table class="avoid" style="width:100%">' + rows.join('') + '</table>';
}

/* ─── cross-tabs ─── */

function crossTabCard_(title, rows, rowLabel, colLabel) {
  if (!rows.length) return miniCard_(title, '<div class="sm mut">No data.</div>');
  var shown = rows.slice(0, 15);
  var rest = rows.slice(15);
  var restTotal = sum_(rest.map(pick_('n')));
  var max = shown[0].n || 1;
  var body = shown.map(function (r) {
    return '<tr><td class="td sm nm" width="58%">' + esc_(r.row) + ' <span class="mut">× ' + esc_(String(r.col)) + '</span></td>'
      + '<td class="td">' + hbar_(Math.round(r.n * 100 / max), RC.ind200) + '</td>'
      + '<td class="td num sm nm" width="30">' + r.n + '</td></tr>';
  }).join('') + (rest.length
    ? '<tr><td class="td sm mut">' + rest.length + ' other' + s_(rest.length) + '</td><td class="td"></td>'
      + '<td class="td num sm mut">' + restTotal + '</td></tr>'
    : '');
  return miniCard_(title, '<table>' + body + '</table>');
}

function weekTrendCard_(d) {
  var weeks = d.crossTabs.byWeek;
  if (!weeks.length) return '';
  var rows = weeks.map(function (w, i) {
    return '<tr' + zebraStyle_(i) + '><td class="td sm nm">' + esc_(w.weekKey) + '</td>'
      + '<td class="td num sm">' + w.duties + '</td><td class="td num sm mut">' + w.need + '</td>'
      + '<td class="td num sm" style="color:' + (w.coverage >= 90 ? RC.teal : w.coverage >= 75 ? RC.indigo : RC.rose) + ';font-weight:bold">' + w.coverage + '%</td></tr>';
  }).join('');
  return miniCard_('Duties and coverage by week',
    '<table><tr><td class="th">Week</td><td class="th num">Duties</td><td class="th num">Need</td>'
    + '<td class="th num">Coverage</td></tr>' + rows + '</table>');
}

/* ─── class-side monotony ─── */

function classMonotonyTable_(d) {
  var rows = d.classView;
  if (!rows.length) return '<div class="sm mut">No covered classes on record.</div>';
  var body = rows.slice(0, 30).map(function (c, i) {
    var color = c.monotony >= 60 ? RC.rose : c.monotony >= 40 ? RC.amber : RC.teal;
    return '<tr' + zebraStyle_(i) + '>'
      + '<td class="td nm">' + esc_(c.classSec) + '</td>'
      + '<td class="td num">' + c.total + '</td>'
      + '<td class="td num sm mut">' + c.distinctSubstitutes + '</td>'
      + '<td class="td sm">' + esc_(c.topSubstitute || '—') + ' <span class="mut">(' + c.topCount + ')</span></td>'
      + '<td class="td num" style="color:' + color + ';font-weight:bold">' + c.monotony + '%</td></tr>';
  }).join('');
  var more = rows.length > 30 ? '<div class="sm mut" style="margin-top:5px">' + (rows.length - 30) + ' further class(es) not shown.</div>' : '';
  return '<table><tr><td class="th">Class</td><td class="th num">Sub periods</td><td class="th num">Distinct subs</td>'
    + '<td class="th">Most frequent</td><td class="th num">Monotony</td></tr>' + body + '</table>' + more
    + '<div class="sm mut" style="margin-top:5px">Monotony is the share of that class\'s covered periods taken by its single most frequent substitute.</div>';
}

/* ─── gap analysis ─── */

function gapAnalysis_(d) {
  var g = d.gaps;
  var head = panel_(g.total ? RC.rose50 : RC.green50, g.total ? RC.rose : RC.green,
    '<b>' + g.total + ' period' + s_(g.total) + ' uncovered</b> across the whole log &nbsp;&middot;&nbsp; '
    + '<b>' + g.coverageRate + '%</b> overall coverage.');
  var body = twoUp_(
    gapMiniCard_('By class', g.byClass, 'class'),
    gapMiniCard_('By period', g.byPeriod, 'period'));
  var body2 = twoUp_(
    gapMiniCard_('By weekday', g.byDay, 'day'),
    gapMiniCard_('By absent teacher', g.byAbsent, 'teacher'));
  return head + body + body2 + weekGapTrend_(d);
}

function gapMiniCard_(title, rows, label) {
  if (!rows.length) return miniCard_(title, '<div class="sm mut">No gaps recorded.</div>');
  var shown = rows.slice(0, 10);
  var max = shown[0].n || 1;
  var body = shown.map(function (r) {
    return '<tr><td class="td sm nm" width="60%">' + esc_(r.key) + '</td>'
      + '<td class="td">' + hbar_(Math.round(r.n * 100 / max), RC.rose100) + '</td>'
      + '<td class="td num sm nm" width="30">' + r.n + '</td></tr>';
  }).join('');
  return miniCard_(title, '<table>' + body + '</table>');
}

function weekGapTrend_(d) {
  var t = d.gaps.trend;
  if (!t.length) return '';
  var rows = t.map(function (w, i) {
    return '<tr' + zebraStyle_(i) + '><td class="td sm nm">' + esc_(w.weekKey) + '</td>'
      + '<td class="td num sm" style="color:' + (w.uncovered ? RC.rose : RC.faint) + ';font-weight:bold">' + w.uncovered + '</td>'
      + '<td class="td num sm">' + w.coverage + '%</td></tr>';
  }).join('');
  return miniCard_('Coverage trend by week',
    '<table><tr><td class="th">Week</td><td class="th num">Uncovered</td><td class="th num">Coverage</td></tr>' + rows + '</table>');
}

/* ───────── small helpers local to this file ───────── */

/** "VIII-B|3|Wednesday" → "VIII-B · P3 · Wed" (RFC-002 §4 display form). */
function slotLabel_(slotKey) {
  var parts = String(slotKey).split('|');
  if (parts.length < 3) return String(slotKey);
  return parts[0] + ' · P' + parts[1] + ' · ' + parts[2].slice(0, 3);
}
