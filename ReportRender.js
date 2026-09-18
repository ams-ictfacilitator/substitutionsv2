/**
 * ============================================================
 * ReportRender.gs — Turn a report model into printable HTML.
 *
 * Constraints that shape this file:
 *   • Apps Script's HTML→PDF converter has no flexbox/grid and no web
 *     fonts, so every layout is a table and every bar is a table cell.
 *   • Light palette only — tinted panels, coloured figures, hairline
 *     rules. No dark bands anywhere.
 *   • A4 portrait with explicit page breaks; the same HTML is used for
 *     the on-screen preview, where .noprint controls are shown.
 * ============================================================
 */

/* Light report palette (deliberately separate from the sheet palette C). */
const RC = {
  ink: '#1F2933', body: '#3E4C59', subtle: '#7B8794', faint: '#9AA5B1',
  hair: '#E4E7EB', rule: '#D6DBE1', paper: '#F9FAFC', white: '#FFFFFF',
  indigo: '#4C5FD5', ind50: '#EEF0FB', ind100: '#DFE3F7', ind200: '#CBD2F0', ind300: '#B4BEE9',
  teal: '#0E8C7D', teal50: '#E3F5F2', teal100: '#CBEAE4',
  green: '#2A9160', green50: '#E5F4EC',
  amber: '#A9761B', amber50: '#FBF1DF',
  rose: '#D3455C', rose50: '#FBE7EB', rose100: '#F6D2D9',
  violet: '#7C4DEE', violet50: '#F1ECFE',
};

var RF = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
var RS = "Georgia, 'Times New Roman', serif";

/**
 * Render the whole report.
 * @param {Object} d      model from buildWeeklyReportData()
 * @param {Object} info   {seq, generatedOn, generatedBy, preview}
 */
function renderReportHtml_(d, info) {
  info = info || {};
  var cfg = d.cfg;
  var h = [];

  h.push('<!DOCTYPE html><html><head><meta charset="utf-8">');
  h.push('<title>' + esc_(reportTitle_(d, info)) + '</title>');
  h.push(reportCss_());
  h.push('</head><body><div class="page">');

  if (info.preview) {
    h.push('<div class="noprint bar">'
      + '<span>Preview — nothing has been saved yet.</span>'
      + '<button onclick="window.print()">Print / Save as PDF</button></div>');
  }

  h.push(masthead_(d, info));

  if (d.empty) {
    h.push(panel_(RC.ind50, RC.indigo,
      'No absences were recorded for this week. Nothing was lost to leave, and no substitute was called.'));
    h.push(signature_(d, info));
    h.push('</div></body></html>');
    return h.join('');
  }

  if (d.sourceErr) {
    h.push(panel_(RC.amber50, RC.amber,
      '<b>Fairness figures are partial.</b> The main timetable workbook could not be read, '
      + 'so substitute weights are unavailable. ' + esc_(d.sourceErr)));
  }
  if (d.absencesSynthesised) {
    h.push(panel_(RC.ind50, RC.indigo,
      '<b>Absence detail reconstructed.</b> This week predates the Absence Register, so absences were '
      + 'rebuilt from cover records. Absence type and absences that needed no cover are not shown.'));
  }

  /* ─── page 1: the bird's-eye view ─── */
  h.push(kpiStrip_(d));
  h.push(categorySplit_(d));
  h.push(callouts_(d));
  h.push(sectionTitle_('01', 'Week at a glance', 'Periods needing cover, by day and period. Rose cells contain a period no substitute could take.'));
  h.push(heatGrid_(d));
  h.push(sectionTitle_('02', 'How this week compares', 'Periods lost per week across the term to date.'));
  h.push(trendChart_(d));

  /* ─── page 2: absences ─── */
  h.push('<div class="brk"></div>');
  h.push(sectionTitle_('03', 'Who was absent', 'Every teacher-day of absence recorded this week, heaviest first.'));
  h.push(absenceTable_(d));
  h.push(twoUp_(scopeMix_(d), teamMix_(d)));

  /* ─── page 3: cover & fairness ─── */
  h.push('<div class="brk"></div>');
  h.push(sectionTitle_('04', 'Who carried the cover', 'Load against each teacher\'s substitution weight. Fair share = weight × total cover ÷ total weight.'));
  h.push(fairnessTable_(d));
  h.push(idleTable_(d));

  /* ─── page 4: risk, disruption, quality ─── */
  h.push('<div class="brk"></div>');
  h.push(sectionTitle_('05', 'Uncovered periods', 'Classes left without a teacher. This is the action list.'));
  h.push(uncoveredTable_(d));
  h.push(twoUp_(classTable_(d), subjectTable_(d)));
  h.push(sectionTitle_('06', 'Pressure through the day', 'Which periods repeatedly needed cover.'));
  h.push(peakTable_(d));
  h.push(sectionTitle_('07', 'Cover quality and audit trail', ''));
  h.push(qualityPanel_(d));
  h.push(rulesPanel_(d));
  h.push(signature_(d, info));

  h.push('</div></body></html>');
  return h.join('');
}

function reportTitle_(d, info) {
  return (d.cfg.schoolName || 'School') + ' — Weekly Substitution Report '
    + (info.seq ? pad3_(info.seq) + ' ' : '') + '(' + d.span.label + ')';
}

/* ───────── chrome ───────── */

function reportCss_() {
  return '<style>'
    + '@page{size:A4 portrait;margin:13mm 12mm 12mm}'
    + '*{box-sizing:border-box}'
    + 'body{margin:0;background:' + RC.white + ';color:' + RC.body + ';font-family:' + RF + ';font-size:9.5pt;line-height:1.45}'
    + '.page{max-width:190mm;margin:0 auto;padding:0}'
    + 'table{border-collapse:collapse;width:100%}'
    + 'td,th{vertical-align:middle}'
    + '.brk{page-break-before:always;height:0}'
    + '.avoid{page-break-inside:avoid}'
    + 'h1,h2,h3{margin:0;font-weight:normal}'
    + '.mast-t{font-family:' + RS + ';font-size:21pt;color:' + RC.ink + ';letter-spacing:-.3px}'
    + '.mast-s{font-size:8pt;letter-spacing:1.6px;text-transform:uppercase;color:' + RC.indigo + '}'
    + '.mast-d{font-size:10pt;color:' + RC.body + '}'
    + '.meta{font-size:7.5pt;color:' + RC.faint + ';line-height:1.6}'
    + '.sec{margin:16px 0 7px}'
    + '.sec-n{font-family:' + RS + ';font-size:8pt;color:' + RC.ind300 + ';letter-spacing:1px}'
    + '.sec-t{font-family:' + RS + ';font-size:13pt;color:' + RC.ink + '}'
    + '.sec-d{font-size:8pt;color:' + RC.subtle + ';margin-top:1px}'
    + '.th{background:' + RC.paper + ';color:' + RC.subtle + ';font-size:7.5pt;letter-spacing:.7px;'
    +   'text-transform:uppercase;font-weight:bold;padding:6px 7px;text-align:left;border-bottom:1px solid ' + RC.rule + '}'
    + '.td{padding:5.5px 7px;border-bottom:1px solid ' + RC.hair + ';font-size:9pt}'
    + '.num{text-align:center;font-variant-numeric:tabular-nums}'
    + '.nm{font-weight:bold;color:' + RC.ink + '}'
    + '.mut{color:' + RC.subtle + '}'
    + '.sm{font-size:8pt}'
    + '.chip{display:inline-block;padding:1px 6px;border-radius:9px;font-size:7.5pt;font-weight:bold}'
    + '.noprint button{font-family:' + RF + ';font-size:9pt;padding:6px 14px;border:1px solid ' + RC.indigo + ';'
    +   'background:' + RC.indigo + ';color:#fff;border-radius:7px;cursor:pointer}'
    + '.bar{background:' + RC.ind50 + ';color:' + RC.indigo + ';padding:9px 12px;border-radius:8px;'
    +   'margin-bottom:14px;font-size:9pt;display:block}'
    + '.bar span{padding-right:12px}'
    + '@media print{.noprint{display:none!important}}'
    + '</style>';
}

function masthead_(d, info) {
  var cfg = d.cfg;
  return '<table class="avoid" style="margin-bottom:14px"><tr>'
    + '<td style="border-bottom:2.5px solid ' + RC.indigo + ';padding-bottom:9px">'
    +   '<div class="mast-s">' + esc_(cfg.schoolName) + ' &middot; ' + esc_(cfg.termLabel) + '</div>'
    +   '<div class="mast-t">Weekly Substitution Report</div>'
    +   '<div class="mast-d">' + esc_(d.span.label) + ' &middot; <span class="mut">' + esc_(d.weekKey) + '</span></div>'
    + '</td>'
    + '<td width="150" style="border-bottom:2.5px solid ' + RC.indigo + ';padding-bottom:9px;text-align:right" class="meta">'
    +   (info.seq ? '<div style="font-family:' + RS + ';font-size:15pt;color:' + RC.indigo + '">No. ' + pad3_(info.seq) + '</div>' : '')
    +   '<div>Generated ' + esc_(info.generatedOn || prettyDate_(new Date())) + '</div>'
    +   (info.generatedBy ? '<div>by ' + esc_(info.generatedBy) + '</div>' : '')
    +   '<div>For the Principal</div>'
    + '</td></tr></table>';
}

function sectionTitle_(n, title, desc) {
  return '<div class="sec avoid"><span class="sec-n">' + n + '</span> '
    + '<span class="sec-t">' + esc_(title) + '</span>'
    + (desc ? '<div class="sec-d">' + esc_(desc) + '</div>' : '') + '</div>';
}

function panel_(bg, fg, html) {
  return '<table class="avoid" style="margin:8px 0"><tr><td style="background:' + bg + ';color:' + fg
    + ';padding:9px 12px;border-radius:7px;font-size:8.5pt">' + html + '</td></tr></table>';
}

/* ───────── page 1 ───────── */

function kpiStrip_(d) {
  var k = d.kpi;
  var covOk = k.uncovered === 0;
  var tiles = [
    ['Teacher-days absent', k.teacherDays, k.teachers + ' teacher' + s_(k.teachers) + ' · ' + k.daysAffected + ' day' + s_(k.daysAffected), RC.indigo, RC.ind50],
    ['Periods lost', k.periodsLost, 'to absence this week', RC.violet, RC.violet50],
    ['Periods covered', k.covered, 'by ' + k.substitutes + ' substitute' + s_(k.substitutes), RC.green, RC.green50],
    ['Left uncovered', k.uncovered, covOk ? 'nothing missed' : 'needs attention', covOk ? RC.teal : RC.rose, covOk ? RC.teal50 : RC.rose50],
    ['Coverage rate', k.coverage + '%', 'of lost periods filled', covOk ? RC.teal : RC.amber, covOk ? RC.teal50 : RC.amber50],
    ['Load balance', d.fairness.balance + '%', 'evenness of cover', balColor_(d.fairness.balance), balTint_(d.fairness.balance)],
  ];
  var cells = tiles.map(function (t) {
    return '<td width="16.6%" style="padding:0 4px 0 0">'
      + '<table><tr><td style="background:' + t[4] + ';border-radius:8px;padding:9px 9px 8px;text-align:center">'
      + '<div style="font-size:6.8pt;letter-spacing:.6px;text-transform:uppercase;color:' + t[3] + ';font-weight:bold">' + esc_(t[0]) + '</div>'
      + '<div style="font-family:' + RS + ';font-size:21pt;color:' + t[3] + ';line-height:1.15">' + t[1] + '</div>'
      + '<div style="font-size:7pt;color:' + RC.subtle + '">' + esc_(t[2]) + '</div>'
      + '</td></tr></table></td>';
  }).join('');
  return '<table class="avoid" style="margin-bottom:10px"><tr>' + cells + '</tr></table>';
}

function callouts_(d) {
  if (!d.callouts.length) return '';
  var cells = d.callouts.map(function (c) {
    return '<td width="33.3%" style="padding:0 4px 0 0"><table><tr><td style="border:1px solid ' + RC.hair
      + ';border-left:2.5px solid ' + RC.ind200 + ';border-radius:6px;padding:8px 10px">'
      + '<div style="font-size:7pt;letter-spacing:.5px;text-transform:uppercase;color:' + RC.faint + '">' + esc_(c.label) + '</div>'
      + '<div class="nm" style="font-size:10.5pt">' + esc_(c.value) + '</div>'
      + '<div class="sm mut">' + esc_(c.note) + '</div>'
      + '</td></tr></table></td>';
  }).join('');
  return '<table class="avoid" style="margin-bottom:4px"><tr>' + cells + '</tr></table>';
}

function heatGrid_(d) {
  var g = d.grid;
  var head = '<td class="th" width="74">Period</td>'
    + g.days.map(function (day) {
        return '<td class="th" style="text-align:center">' + esc_(day.name.slice(0, 3))
          + '<div style="font-weight:normal;letter-spacing:0;text-transform:none;color:' + RC.faint + '">'
          + Utilities.formatDate(day.date, Session.getScriptTimeZone(), 'dd MMM') + '</div></td>';
      }).join('')
    + '<td class="th" style="text-align:center" width="52">Total</td>';

  var body = g.rows.map(function (row) {
    var rowTotal = 0;
    var cells = row.cells.map(function (c) {
      rowTotal += c.need;
      var bg = c.uncovered ? RC.rose50 : heatTint_(c.need, g.max);
      var fg = c.uncovered ? RC.rose : (c.need ? RC.indigo : RC.hair);
      var txt = c.need ? (c.need + (c.uncovered ? ' <span style="font-size:7pt">✕' + c.uncovered + '</span>' : '')) : '·';
      return '<td class="td num" style="background:' + bg + ';color:' + fg + ';font-weight:bold;border-bottom:2px solid '
        + RC.white + ';border-right:2px solid ' + RC.white + '">' + txt + '</td>';
    }).join('');
    return '<tr><td class="td sm" style="color:' + RC.subtle + '"><b style="color:' + RC.ink + '">P' + row.period + '</b>'
      + (row.timing ? ' <span style="font-size:7pt">' + esc_(row.timing) + '</span>' : '') + '</td>'
      + cells
      + '<td class="td num" style="color:' + RC.ink + ';font-weight:bold">' + (rowTotal || '·') + '</td></tr>';
  }).join('');

  var foot = '<tr><td class="td sm mut">Day total</td>'
    + d.byDay.map(function (day) {
        return '<td class="td num" style="font-weight:bold;color:' + (day.uncovered ? RC.rose : RC.ink) + '">'
          + (day.need || '·') + '</td>';
      }).join('')
    + '<td class="td num" style="font-weight:bold;color:' + RC.indigo + '">' + d.kpi.periodsLost + '</td></tr>';

  var legend = '<div class="sm mut" style="margin-top:5px">'
    + swatch_(RC.ind50) + ' light &nbsp;' + swatch_(RC.ind200) + ' heavy &nbsp;'
    + swatch_(RC.rose50) + ' contains an uncovered period (✕ marks how many)</div>';

  return '<table class="avoid"><tr>' + head + '</tr>' + body + foot + '</table>' + legend;
}

function trendChart_(d) {
  var t = d.trend;
  if (!t.series.length) return '<div class="sm mut">No history yet.</div>';
  var H = 84;
  var cols = t.series.map(function (w) {
    var totalH = Math.max(3, Math.round(w.need / t.max * H));
    var unH = w.need ? Math.round(w.uncovered / w.need * totalH) : 0;
    var covH = Math.max(0, totalH - unH);
    return '<td style="vertical-align:bottom;text-align:center;padding:0 2px">'
      + '<div style="font-size:7pt;color:' + (w.current ? RC.indigo : RC.faint) + ';font-weight:bold">' + w.need + '</div>'
      + (unH ? '<div style="height:' + unH + 'px;background:' + RC.rose100 + ';margin:0 auto;width:26px"></div>' : '')
      + '<div style="height:' + covH + 'px;background:' + (w.current ? RC.indigo : RC.ind200) + ';margin:0 auto;width:26px"></div>'
      + '<div style="font-size:6.8pt;color:' + (w.current ? RC.indigo : RC.faint) + ';padding-top:4px;'
      +   (w.current ? 'font-weight:bold' : '') + '">' + esc_(w.label) + '</div>'
      + '<div style="font-size:6.5pt;color:' + RC.faint + '">' + w.coverage + '%</div>'
      + '</td>';
  }).join('');

  var note = 'Average ' + t.avg + ' periods lost per week over ' + t.weeks + ' week' + s_(t.weeks) + '.'
    + (t.delta === null ? '' : (t.delta > 0 ? '  This week ran ' + t.delta + ' above average.'
      : t.delta < 0 ? '  This week ran ' + Math.abs(t.delta) + ' below average.' : '  This week sat on the average.'));

  return '<table class="avoid" style="border:1px solid ' + RC.hair + ';border-radius:7px"><tr><td style="padding:10px 12px 8px">'
    + '<table><tr>' + cols + '</tr></table>'
    + '<div class="sm mut" style="margin-top:7px;border-top:1px solid ' + RC.hair + ';padding-top:6px">'
    +   swatch_(RC.ind200) + ' covered &nbsp;' + swatch_(RC.rose100) + ' uncovered &nbsp;&nbsp;' + esc_(note) + '</div>'
    + '</td></tr></table>';
}

/* ───────── page 2: absences ───────── */

function absenceTable_(d) {
  if (!d.absences.length) return '<div class="sm mut">No absences recorded.</div>';
  var rows = d.absences.map(function (a, i) {
    var scopes = [];
    for (var k in a.scopes) scopes.push(a.scopes[k] > 1 ? a.scopes[k] + '× ' + k : k);
    return '<tr' + zebraStyle_(i) + '>'
      + '<td class="td nm">' + esc_(a.teacher) + '</td>'
      + '<td class="td sm mut">' + esc_(a.dept || '—') + '</td>'
      + '<td class="td sm mut">' + esc_(a.team || '—') + '</td>'
      + '<td class="td num">' + a.days + '</td>'
      + '<td class="td sm">' + esc_(scopes.join(' · ') || '—') + '</td>'
      + '<td class="td num">' + a.need + '</td>'
      + '<td class="td num" style="color:' + RC.green + ';font-weight:bold">' + a.covered + '</td>'
      + '<td class="td num" style="color:' + (a.uncovered ? RC.rose : RC.faint) + ';font-weight:bold">' + (a.uncovered || '—') + '</td>'
      + '<td class="td num mut">' + (a.reassigned || '—') + '</td></tr>';
  }).join('');
  var k = d.kpi;
  return '<table style="table-layout:fixed"><tr>'
    + '<td class="th" width="17%">Teacher</td><td class="th" width="10%">Department</td>'
    + '<td class="th" width="11%">Team</td>'
    + '<td class="th num" width="5%">Days</td><td class="th" width="24%">Absence type</td>'
    + '<td class="th num" width="8%">Periods</td><td class="th num" width="9%">Covered</td>'
    + '<td class="th num" width="8%">Uncov.</td>'
    + '<td class="th num" width="8%">Churn</td></tr>' + rows
    + '<tr><td class="td nm" colspan="3" style="border-top:1.5px solid ' + RC.rule + '">Total</td>'
    + '<td class="td num nm" style="border-top:1.5px solid ' + RC.rule + '">' + k.teacherDays + '</td>'
    + '<td class="td" style="border-top:1.5px solid ' + RC.rule + '"></td>'
    + '<td class="td num nm" style="border-top:1.5px solid ' + RC.rule + '">' + k.periodsLost + '</td>'
    + '<td class="td num nm" style="border-top:1.5px solid ' + RC.rule + ';color:' + RC.green + '">' + k.covered + '</td>'
    + '<td class="td num nm" style="border-top:1.5px solid ' + RC.rule + ';color:' + (k.uncovered ? RC.rose : RC.faint) + '">' + k.uncovered + '</td>'
    + '<td class="td num nm" style="border-top:1.5px solid ' + RC.rule + '">' + k.reassigned + '</td></tr></table>'
    + '<div class="sm mut" style="margin-top:5px">“Churn” counts periods this teacher had been due to cover for someone '
    + 'else, which her own absence forced the system to hand to a third teacher.</div>';
}

/** Leave = indigo family · Permission = violet · OD = teal family. */
function typeTints_() {
  return { 'Leave - Full day': RC.ind300, 'Leave - Morning': RC.ind200, 'Leave - Afternoon': RC.ind100,
           'Permission': RC.violet50,
           'OD - Full day': RC.teal100, 'OD - Morning': RC.teal50, 'OD - Afternoon': RC.teal50,
           'OD - Periods': RC.teal50, 'Unknown': RC.hair };
}
function typeInks_() {
  return { 'Leave - Full day': RC.indigo, 'Leave - Morning': RC.indigo, 'Leave - Afternoon': RC.indigo,
           'Permission': RC.violet,
           'OD - Full day': RC.teal, 'OD - Morning': RC.teal, 'OD - Afternoon': RC.teal,
           'OD - Periods': RC.teal, 'Unknown': RC.subtle };
}

/**
 * The Leave / Permission / OD strip, directly under the headline tiles.
 * Total disruption first, then how much of it was avoidable.
 */
function categorySplit_(d) {
  if (!d.byCategory.length) return '';
  var colour = { 'Leave': [RC.indigo, RC.ind50], 'Permission': [RC.violet, RC.violet50],
                 'OD': [RC.teal, RC.teal50], 'Unknown': [RC.subtle, RC.paper] };
  var note = { 'Leave': 'personal absence', 'Permission': 'short personal absence',
               'OD': 'school business — not personal leave', 'Unknown': 'recorded before absence types' };
  var w = Math.floor(100 / d.byCategory.length);
  var cells = d.byCategory.map(function (c) {
    var col = colour[c.category] || colour.Unknown;
    return '<td width="' + w + '%" style="padding:0 4px 0 0"><table><tr><td style="background:' + col[1]
      + ';border-radius:8px;padding:8px 10px">'
      + '<div style="font-size:6.8pt;letter-spacing:.6px;text-transform:uppercase;color:' + col[0]
      +   ';font-weight:bold">' + esc_(c.category === 'OD' ? 'On Duty (OD)' : c.category) + '</div>'
      + '<div style="font-family:' + RS + ';font-size:16pt;color:' + col[0] + ';line-height:1.2">'
      +   c.days + ' <span style="font-size:8.5pt;font-family:' + RF + '">teacher-day' + s_(c.days) + '</span></div>'
      + '<div style="font-size:7.5pt;color:' + RC.body + '"><b>' + c.need + '</b> period' + s_(c.need)
      +   ' lost · ' + c.coverage + '% covered'
      +   (c.uncovered ? ' · <span style="color:' + RC.rose + '">' + c.uncovered + ' uncovered</span>' : '') + '</div>'
      + '<div style="font-size:6.8pt;color:' + RC.faint + '">' + esc_(note[c.category] || '') + '</div>'
      + '</td></tr></table></td>';
  }).join('');
  return '<table class="avoid" style="margin-bottom:10px"><tr>' + cells + '</tr></table>';
}

function scopeMix_(d) {
  if (!d.scopeMix.length) return '';
  var tint = typeTints_(), ink = typeInks_();
  var rows = d.scopeMix.map(function (m) {
    return '<tr><td class="td sm nm" width="80">' + esc_(m.scope) + '</td>'
      + '<td class="td" style="width:auto">' + (d.scopeMix.length > 1 ? hbar_(m.pct, tint[m.scope] || RC.ind200) : '') + '</td>'
      + '<td class="td num sm" width="58" style="color:' + (ink[m.scope] || RC.ink) + ';font-weight:bold">'
      +   m.n + ' <span class="mut" style="font-weight:normal">(' + m.pct + '%)</span></td></tr>';
  }).join('');
  return miniCard_('Absence type mix', '<table>' + rows + '</table>');
}

function teamMix_(d) {
  if (!d.byTeam.length) return '';
  var max = d.byTeam[0].weight || 1;
  var rows = d.byTeam.slice(0, 7).map(function (t) {
    return '<tr><td class="td sm nm" width="110">' + esc_(t.key) + '</td>'
      + '<td class="td">' + hbar_(Math.round(t.weight * 100 / max), RC.ind200) + '</td>'
      + '<td class="td num sm nm" width="34">' + t.weight + '</td></tr>';
  }).join('');
  return miniCard_('Periods lost by team', '<table>' + rows + '</table>');
}

/* ───────── page 3: fairness ───────── */

function fairnessTable_(d) {
  var f = d.fairness;
  if (!f.members.length) return '<div class="sm mut">No cover was assigned this week.</div>';
  var max = Math.max(1, f.maxActual);

  var rows = f.members.map(function (m, i) {
    var dev = Math.round(m.dev * 10) / 10;
    var chip;
    if (Math.abs(dev) < 0.5) chip = '<span class="chip" style="background:' + RC.paper + ';color:' + RC.subtle + '">on target</span>';
    else if (dev > 0) chip = '<span class="chip" style="background:' + RC.amber50 + ';color:' + RC.amber + '">+' + dev + '</span>';
    else chip = '<span class="chip" style="background:' + RC.teal50 + ';color:' + RC.teal + '">' + dev + '</span>';
    return '<tr' + zebraStyle_(i) + '>'
      + '<td class="td nm">' + esc_(m.teacher) + (m.inPool ? '' : ' <span class="chip" style="background:' + RC.violet50 + ';color:' + RC.violet + '">not in pool</span>') + '</td>'
      + '<td class="td sm mut">' + esc_(m.team || '—') + '</td>'
      + '<td class="td num sm">' + (m.weight || '—') + '</td>'
      + '<td class="td" width="150">' + hbar_(Math.round(m.actual * 100 / max), RC.ind200) + '</td>'
      + '<td class="td num nm" style="color:' + RC.indigo + '">' + m.actual + '</td>'
      + '<td class="td num sm mut">' + (Math.round(m.fair * 10) / 10) + '</td>'
      + '<td class="td num">' + chip + '</td>'
      + '<td class="td num sm" style="color:' + RC.teal + ';font-weight:bold">' + m.termTotal + '</td></tr>';
  }).join('');

  var verdict = f.balance >= 90 ? 'Cover was spread very evenly against allotted weights.'
    : f.balance >= 75 ? 'Cover was reasonably even; a few teachers carried more than their share.'
    : 'Cover was concentrated on a minority of the pool this week.';
  var extra = '';
  if (f.over && f.over.dev > 0.5) extra += ' Heaviest above share: ' + f.over.teacher + ' (+' + (Math.round(f.over.dev * 10) / 10) + ').';
  if (f.under && f.under.dev < -0.5) extra += ' Furthest below: ' + f.under.teacher + ' (' + (Math.round(f.under.dev * 10) / 10) + ').';

  return '<table><tr>'
    + '<td class="th">Substitute</td><td class="th">Team</td><td class="th num">Weight</td>'
    + '<td class="th">This week</td><td class="th num">Subs</td><td class="th num">Fair share</td>'
    + '<td class="th num">Variance</td><td class="th num">Term</td></tr>' + rows + '</table>'
    + panel_(balTint_(f.balance), balColor_(f.balance),
        '<b>Load balance ' + f.balance + '%.</b> ' + esc_(verdict + extra)
        + ' <span style="color:' + RC.subtle + '">Basis: ' + esc_(d.cfg.fairnessBasis) + '. '
        + 'A teacher\'s fair share is their substitution weight as a proportion of the whole pool\'s weight.</span>');
}

function idleTable_(d) {
  var idle = d.fairness.idle;
  if (!idle.length) return '';
  var names = idle.slice(0, 24).map(function (m) {
    return esc_(m.teacher) + ' <span class="mut">(' + m.termTotal + ')</span>';
  }).join(' &nbsp;·&nbsp; ');
  var more = idle.length > 24 ? ' … and ' + (idle.length - 24) + ' more' : '';
  return miniCard_('In the pool but not called this week — ' + idle.length + ' of ' + d.fairness.poolSize,
    '<div class="sm">' + names + more + '</div>'
    + '<div class="sm mut" style="margin-top:4px">Bracketed figure is their term total, so a low number here two weeks running is worth a look.</div>');
}

/* ───────── page 4: risk, disruption, quality ───────── */

function uncoveredTable_(d) {
  if (!d.uncovered.length) {
    return panel_(RC.green50, RC.green, '<b>Every lost period was covered this week.</b> No class was left without a teacher.');
  }
  var rows = d.uncovered.map(function (u, i) {
    return '<tr' + zebraStyle_(i) + '>'
      + '<td class="td sm">' + esc_(u.day) + ' <span class="mut">' + esc_(u.dateStr) + '</span></td>'
      + '<td class="td num sm nm">P' + u.period + '</td>'
      + '<td class="td nm">' + esc_(u.classSec) + '</td>'
      + '<td class="td sm">' + esc_(u.subject) + '</td>'
      + '<td class="td sm mut">' + esc_(u.absent) + '</td></tr>';
  }).join('');
  return '<table><tr><td class="th">Day</td><td class="th num">Period</td><td class="th">Class</td>'
    + '<td class="th">Subject</td><td class="th">Teacher away</td></tr>' + rows + '</table>'
    + panel_(RC.rose50, RC.rose, '<b>' + d.uncovered.length + ' period' + s_(d.uncovered.length)
        + ' went uncovered.</b> Every substitute was either teaching, on duty, or already covering elsewhere.');
}

function classTable_(d) {
  if (!d.byClass.length) return '';
  var max = d.byClass[0].need || 1;
  var rows = d.byClass.slice(0, 10).map(function (c) {
    return '<tr><td class="td sm nm" width="70">' + esc_(c.key) + '</td>'
      + '<td class="td">' + hbar_(Math.round(c.need * 100 / max), c.uncovered ? RC.rose100 : RC.ind200) + '</td>'
      + '<td class="td num sm nm" width="52">' + c.need
      + (c.uncovered ? ' <span style="color:' + RC.rose + '">✕' + c.uncovered + '</span>' : '') + '</td></tr>';
  }).join('');
  return miniCard_('Most disrupted classes', '<table>' + rows + '</table>'
    + (d.byClass.length > 10 ? '<div class="sm mut">' + (d.byClass.length - 10) + ' further classes affected.</div>' : ''));
}

function subjectTable_(d) {
  if (!d.bySubject.length) return '';
  var max = d.bySubject[0].need || 1;
  var rows = d.bySubject.slice(0, 10).map(function (c) {
    return '<tr><td class="td sm nm" width="90">' + esc_(c.key) + '</td>'
      + '<td class="td">' + hbar_(Math.round(c.need * 100 / max), RC.teal50) + '</td>'
      + '<td class="td num sm nm" width="30">' + c.need + '</td></tr>';
  }).join('');
  return miniCard_('Teaching time lost by subject', '<table>' + rows + '</table>');
}

function peakTable_(d) {
  var max = Math.max(1, d.peakMax);
  var cells = d.peak.map(function (p) {
    var hgt = p.need ? Math.max(4, Math.round(p.need / max * 56)) : 0;
    var unH = p.need ? Math.round(p.uncovered / p.need * hgt) : 0;
    return '<td style="vertical-align:bottom;text-align:center;padding:0 3px">'
      + '<div style="font-size:7.5pt;color:' + RC.indigo + ';font-weight:bold">' + (p.need || '&nbsp;') + '</div>'
      + (unH ? '<div style="height:' + unH + 'px;background:' + RC.rose100 + ';margin:0 auto;width:30px"></div>' : '')
      + (hgt - unH > 0 ? '<div style="height:' + (hgt - unH) + 'px;background:' + RC.ind200 + ';margin:0 auto;width:30px"></div>' : '')
      + '<div style="font-size:7.5pt;color:' + RC.ink + ';padding-top:4px;font-weight:bold">P' + p.period + '</div>'
      + (p.timing ? '<div style="font-size:6.2pt;color:' + RC.faint + '">' + esc_(p.timing) + '</div>' : '')
      + '</td>';
  }).join('');
  return '<table class="avoid" style="border:1px solid ' + RC.hair + ';border-radius:7px"><tr><td style="padding:10px 12px 8px">'
    + '<table><tr>' + cells + '</tr></table></td></tr></table>';
}

function qualityPanel_(d) {
  var q = d.quality, a = d.audit;
  var items = [
    ['Subject-matched cover', q.matchPct === null ? '—' : q.matchPct + '%',
     q.matchPct === null ? 'needs the timetable workbook' : q.matched + ' of ' + q.judged + ' assignments went to the same department'],
    ['Blocks held together', q.doublesPct + '%',
     q.doubles + ' of ' + q.assigned + ' periods sat next to the same substitute in the same class'],
    ['Notifications delivered', a.notified + '%', 'of cover rows were confirmed sent'],
    ['Marking runs', a.runs, distinct_(a.markedBy.map(pick_('key'))).join(', ') || '—'],
  ];
  var cells = items.map(function (t) {
    return '<td width="25%" style="padding:0 4px 0 0"><table><tr><td style="background:' + RC.paper
      + ';border-radius:7px;padding:8px 10px">'
      + '<div style="font-size:6.8pt;letter-spacing:.5px;text-transform:uppercase;color:' + RC.faint + ';font-weight:bold">' + esc_(t[0]) + '</div>'
      + '<div style="font-family:' + RS + ';font-size:15pt;color:' + RC.indigo + ';line-height:1.25">' + t[1] + '</div>'
      + '<div style="font-size:7pt;color:' + RC.subtle + '">' + esc_(String(t[2])) + '</div>'
      + '</td></tr></table></td>';
  }).join('');
  return '<table class="avoid"><tr>' + cells + '</tr></table>';
}

/** Which substitution rules were in force, and whether the dedicated ones held. */
function rulesPanel_(d) {
  var r = d.rules;
  if (!r || (!r.active.length && !r.problems.length)) return '';

  var rows = r.active.map(function (a) {
    return '<tr><td class="td sm nm" width="45%">' + esc_(a.label) + '</td>'
      + '<td class="td sm mut">' + esc_(a.detail) + '</td></tr>';
  }).join('');

  var held = r.dedicated.map(function (x) {
    var ok = x.pct >= 90;
    return '<tr><td class="td sm nm" width="45%">' + esc_(x.team) + ' periods covered by ' + esc_(x.names) + '</td>'
      + '<td class="td sm" style="color:' + (ok ? RC.teal : RC.amber) + ';font-weight:bold">'
      + x.held + ' of ' + x.total + ' (' + x.pct + '%)'
      + (ok ? '' : ' <span class="mut" style="font-weight:normal">— the rest fell back to normal rotation</span>')
      + '</td></tr>';
  }).join('');

  var problems = r.problems.length
    ? '<div class="sm" style="color:' + RC.rose + ';margin-top:6px">⚠️ ' + r.problems.length
      + ' rule(s) were skipped as unusable. Run ⚖️ Check rules.</div>'
    : '';

  return miniCard_('Substitution rules in force',
    '<table>' + rows + held + '</table>' + problems);
}

/* ───────── signature ───────── */

function signature_(d, info) {
  var line = 'border-bottom:1px solid ' + RC.rule + ';height:30px';
  return '<table class="avoid" style="margin-top:20px">'
    + '<tr><td colspan="2" style="border-top:2px solid ' + RC.indigo + ';padding-top:10px">'
    +   '<div style="font-family:' + RS + ';font-size:11pt;color:' + RC.ink + '">Remarks / action required</div></td></tr>'
    + '<tr><td colspan="2" style="padding:6px 0 16px">'
    +   '<table><tr><td style="border:1px solid ' + RC.hair + ';border-radius:6px;height:70px;'
    +     'background:' + RC.paper + '">&nbsp;</td></tr></table></td></tr>'
    + '<tr>'
    +   '<td width="48%" style="padding-right:6%">'
    +     '<div style="' + line + '"></div>'
    +     '<div class="sm nm" style="padding-top:4px">Prepared by</div>'
    +     '<div class="sm mut">' + esc_(info.generatedBy || '—') + ' &middot; '
    +       esc_(info.generatedOn || prettyDate_(new Date())) + '</div>'
    +   '</td>'
    +   '<td width="46%">'
    +     '<div style="' + line + '"></div>'
    +     '<div class="sm nm" style="padding-top:4px">Principal &mdash; signature &amp; date</div>'
    +     '<div class="sm mut">' + esc_(d.cfg.schoolName) + '</div>'
    +   '</td>'
    + '</tr>'
    + '<tr><td colspan="2" class="meta" style="padding-top:14px;border-top:1px solid ' + RC.hair + ';margin-top:10px">'
    +   'Generated automatically from the Weekly Substitution System. '
    +   'Figures are drawn from the substitution log and absence register for ' + esc_(d.weekKey) + '.'
    + '</td></tr></table>';
}

/* ───────── markup helpers ───────── */

/** A horizontal bar built from table cells — survives any HTML→PDF renderer. */
function hbar_(pct, color) {
  var p = Math.max(0, Math.min(100, pct || 0));
  var left = p > 0 ? '<td width="' + p + '%" style="background:' + color + ';height:8px;font-size:1px;border-radius:4px">&nbsp;</td>' : '';
  var right = p < 100 ? '<td style="background:' + RC.paper + ';height:8px;font-size:1px">&nbsp;</td>' : '';
  return '<table style="width:100%"><tr>' + left + right + '</tr></table>';
}

function miniCard_(title, inner) {
  return '<table class="avoid" style="border:1px solid ' + RC.hair + ';border-radius:7px;margin-top:8px">'
    + '<tr><td style="padding:9px 11px">'
    + '<div style="font-size:7.5pt;letter-spacing:.6px;text-transform:uppercase;color:' + RC.faint
    +   ';font-weight:bold;margin-bottom:4px">' + esc_(title) + '</div>'
    + inner + '</td></tr></table>';
}

/** Two cards side by side, each already a full table. */
function twoUp_(a, b) {
  if (!a && !b) return '';
  if (!a || !b) return a || b;
  return '<table class="avoid"><tr>'
    + '<td width="50%" style="vertical-align:top;padding-right:6px">' + a + '</td>'
    + '<td width="50%" style="vertical-align:top">' + b + '</td></tr></table>';
}

function swatch_(color) {
  return '<span style="display:inline-block;width:9px;height:9px;background:' + color
    + ';border-radius:2px;vertical-align:middle"></span>';
}

function zebraStyle_(i) { return i % 2 ? ' style="background:' + RC.paper + '"' : ''; }

/** Light indigo ramp for the pressure grid. */
function heatTint_(n, max) {
  if (!n) return RC.white;
  var t = max ? n / max : 0;
  if (t <= 0.25) return RC.ind50;
  if (t <= 0.50) return RC.ind100;
  if (t <= 0.75) return RC.ind200;
  return RC.ind300;
}

function balColor_(b) { return b >= 90 ? RC.teal : b >= 75 ? RC.indigo : RC.amber; }
function balTint_(b)  { return b >= 90 ? RC.teal50 : b >= 75 ? RC.ind50 : RC.amber50; }
function pad3_(n) { return ('00' + n).slice(-3); }
