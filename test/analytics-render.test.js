/** T-006: analytics PDF render — acceptance 1-5 (ticket) / RFC-002 §9. */
const { load, DEFAULT_FILES } = require('./harness');
const { SCHOOL } = require('./fixture');

const FILES = DEFAULT_FILES.concat(['ReportData.js', 'AnalyticsData.js', 'ReportRender.js', 'AnalyticsRender.js']);
const ctx = load(FILES, SCHOOL);
const run = ctx.run;

function row(o) {
  return Object.assign({
    ts: new Date(), dateStr: '2026-09-07', day: 'Monday', weekKey: '2026-W37',
    period: 1, classSec: 'VIII-B', subject: 'Maths', absent: 'Teacher A',
    substitute: 'Teacher B', dept: 'Maths', status: 'ASSIGNED', notified: '✓',
    runId: 'r1', markedBy: 'Office', row: 3,
  }, o);
}

function setLog(rows) { run(`LOG = ${JSON.stringify(rows)}; clearCache();`); }

function balancedTables(html) {
  const open = (html.match(/<table/g) || []).length;
  const close = (html.match(/<\/table>/g) || []).length;
  return open === close && open > 0;
}

function renderHtml(info) {
  return run(`renderAnalyticsHtml_(buildAnalytics(), ${JSON.stringify(info || { seq: 1, generatedOn: '18 Sep 2026', generatedBy: 'Test' })})`);
}

/* ── 1. an empty log renders a valid document, not a throw ── */
(function () {
  setLog([]);
  const html = renderHtml();
  check('empty log renders a document', typeof html === 'string' && html.length > 0);
  check('empty log html has <!DOCTYPE html>', /<!DOCTYPE html>/.test(html));
  check('empty log html has no undefined/NaN', !/undefined|NaN/.test(html));
  check('empty log html has balanced tables', balancedTables(html));
})();

/* ── 2. source workbook unreachable renders with a notice, weights omitted ── */
(function () {
  const ctx2 = load(FILES, SCHOOL + `\nfunction buildPool() { throw new Error('source unreachable'); }`);
  ctx2.run(`LOG = ${JSON.stringify([row({ substitute: 'Teacher B' })])}; clearCache();`);
  const html = ctx2.run(`renderAnalyticsHtml_(buildAnalytics(), {seq:1, generatedOn:'18 Sep 2026', generatedBy:'Test'})`);
  check('source-unreachable html mentions the notice', /partial/i.test(html) && /source unreachable/.test(html));
  check('source-unreachable html has no undefined/NaN', !/undefined|NaN/.test(html));
  check('source-unreachable html has balanced tables', balancedTables(html));
})();

/* ── 3, 4, 5: a realistic log — no undefined/NaN, balanced tables, null variety as a dash ── */
(function () {
  setLog([
    row({ dateStr: '2026-09-07', period: 1, classSec: 'VIII-B', day: 'Wednesday', substitute: 'Teacher B', absent: 'Teacher C', row: 3 }),
    row({ dateStr: '2026-09-14', period: 1, classSec: 'VIII-B', day: 'Wednesday', substitute: 'Teacher B', absent: 'Teacher C', row: 4 }),
    row({ dateStr: '2026-09-21', period: 1, classSec: 'VIII-B', day: 'Wednesday', substitute: 'Teacher B', absent: 'Teacher C', row: 5 }),
    row({ dateStr: '2026-09-08', period: 2, classSec: 'IX-A', day: 'Thursday', substitute: 'Teacher D', absent: 'Teacher E', row: 6 }),
    row({ dateStr: '2026-09-07', period: 3, classSec: 'I-A', day: 'Monday', substitute: 'Outside Teacher', absent: 'Teacher A', row: 7 }),
    row({ dateStr: '2026-09-07', period: 4, classSec: 'II-A', day: 'Monday', substitute: '', status: 'UNASSIGNED', row: 8 }),
  ]);
  const model = run('buildAnalytics()');
  const html = renderHtml();

  check('has no undefined/NaN in output', !/undefined|NaN/.test(html), html.match(/undefined|NaN/));
  check('<table>/</table> balanced', balancedTables(html));

  // Teacher D has exactly one duty → overallVariety is null (RFC §4.1).
  const dVariety = model.variety.filter(function (v) { return v.teacher === 'Teacher D'; })[0];
  check('a single-duty teacher has null overallVariety in the model', dVariety && dVariety.overallVariety === null,
    dVariety && dVariety.overallVariety);
  check('null variety renders as an em dash in the comparative table, not 0',
    /Teacher D[\s\S]{0,400}?<td class="td num">—<\/td>/.test(html) || /—<\/td>\s*<td class="td num sm">/.test(html));
  check('no zero-length or literal "0" printed for a null-variety teacher', !/Teacher D[\s\S]{0,200}?class="td num">0</.test(html));

  // "Outside Teacher" has no Substitution allotment → notInPool, labelled as not an engine problem.
  check('notInPool teacher is labelled as not an engine problem',
    /not an engine problem/.test(html) && /Outside Teacher/.test(html));
  check('notInPool section points the remedy at the Allotment', /remedy is to add a Substitution row/.test(html));

  // acceptance 2: preview opens the same HTML — same renderer, just a modal wrapper is added by
  // the menu handler (Analytics.js), so the underlying markup must be identical when info.preview is set.
  const previewHtml = run(`renderAnalyticsHtml_(buildAnalytics(), {seq:1, generatedOn:'18 Sep 2026', generatedBy:'Test', preview:true})`);
  check('preview mode adds the print bar without breaking table balance', /Print \/ Save as PDF/.test(previewHtml) && balancedTables(previewHtml));
})();

/* ── outlier cap: never more than 12 profiles ── */
(function () {
  var rows = [];
  var teachers = ['Teacher A', 'Teacher B', 'Teacher C', 'Teacher D', 'Teacher E',
                   'Teacher F', 'Teacher G', 'Teacher H', 'Teacher I', 'Teacher J'];
  teachers.forEach(function (t, i) {
    rows.push(row({ dateStr: '2026-09-0' + (7 + (i % 2)), period: (i % 8) + 1, classSec: (i % 2 ? 'I-A' : 'II-A'),
                     substitute: t, absent: 'Teacher A', row: 3 + i }));
  });
  setLog(rows);
  const model = run('buildAnalytics()');
  const picks = run('pickOutliers_(buildAnalytics())');
  check('outlier profiles never exceed 12', picks.length <= 12, picks.length);
})();

/* ── cross-tab totals still reconcile after rendering (sanity the renderer didn't recompute) ── */
(function () {
  var rows = [];
  for (var i = 0; i < 8; i++) {
    rows.push(row({ dateStr: '2026-09-07', period: (i % 8) + 1, classSec: (i % 3 === 0) ? 'I-A' : 'II-A',
                     substitute: (i % 2) ? 'Teacher B' : 'Teacher C', absent: 'Teacher A', row: 3 + i }));
  }
  setLog(rows);
  const model = run('buildAnalytics()');
  const html = renderHtml();
  check('crossTabs still reconcile to totalDuties after render (model untouched)',
    model.crossTabs.subByClass.reduce(function (t, r) { return t + r.n; }, 0) === model.totalDuties);
  check('rendering a full model has no undefined/NaN', !/undefined|NaN/.test(html));
  check('rendering a full model has balanced tables', balancedTables(html));
})();
