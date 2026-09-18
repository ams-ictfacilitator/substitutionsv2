/**
 * T-007: the 🔎 Analytics tab. Pure presentation over buildAnalytics() — no
 * new figures, so we mainly check the *rendering contract*: idempotency,
 * batched writes, the trimColumnsOnly_ requirement, and that a null variety
 * reaches the sheet as an em dash rather than a 0 (RFC-002 §4.1).
 */
const fs = require('fs');
const path = require('path');
const { load, DEFAULT_FILES } = require('./harness');
const { SCHOOL } = require('./fixture');

/** A minimal but faithful mock of the SpreadsheetApp Range/Sheet API, built
 * INSIDE the vm (as source text) so the harness's own globals (SS, C, …)
 * are in scope when it runs. `__calls` is left on the context so the Node
 * side can inspect what the code under test actually did. */
const MOCK_SHEET = `
var __calls = { setValues: 0, setBackgrounds: 0, valueGrids: [] };

function __makeRange() {
  var self = {
    setValues: function (v) { __calls.setValues++; __calls.valueGrids.push(v); return self; },
    setBackgrounds: function (v) { __calls.setBackgrounds++; return self; },
    setBackground: function () { return self; },
    setValue: function (v) { self._value = v; return self; },
    setFontColor: function () { return self; },
    setFontWeight: function () { return self; },
    setFontSize: function () { return self; },
    setFontStyle: function () { return self; },
    setVerticalAlignment: function () { return self; },
    setHorizontalAlignment: function () { return self; },
    setWrap: function () { return self; },
    merge: function () { return self; },
    setBorder: function () { return self; },
    setFontFamily: function () { return self; },
    setNote: function () { return self; },
  };
  return self;
}

function __makeMockSheet() {
  var maxRows = 1000, maxCols = 26;
  var sheet = {
    clear: function () { return sheet; },
    clearConditionalFormatRules: function () { return sheet; },
    getRange: function () { return __makeRange(); },
    setRowHeight: function () { return sheet; },
    setColumnWidth: function () { return sheet; },
    setFrozenRows: function () { return sheet; },
    getMaxColumns: function () { return maxCols; },
    deleteColumns: function (start, n) { maxCols = Math.max(0, maxCols - n); return sheet; },
    getMaxRows: function () { return maxRows; },
    insertRowsAfter: function (after, n) { maxRows += n; return sheet; },
    getLastRow: function () { return maxRows; },
    getDataRange: function () { return __makeRange(); },
  };
  return sheet;
}

var __analyticsSheet = __makeMockSheet();
SpreadsheetApp.getActiveSpreadsheet = function () {
  return {
    getSheetByName: function (name) {
      return name === SS.ANALYTICS ? __analyticsSheet : null;
    },
  };
};
`;

const FILES = DEFAULT_FILES.concat(['ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'Setup.js', 'AnalyticsTab.js']);
const ctx = load(FILES, SCHOOL + MOCK_SHEET);
const run = ctx.run;

function row(o) {
  return Object.assign({
    ts: new Date(), dateStr: '2026-09-07', day: 'Monday', weekKey: '2026-W37',
    period: 1, classSec: 'VIII-B', subject: 'Maths', absent: 'Teacher A',
    substitute: 'Teacher B', dept: 'Maths', status: 'ASSIGNED', notified: '✓',
    runId: 'r1', markedBy: 'Office', row: 3,
  }, o);
}

// A teacher with exactly one duty (null variety, RFC §4.1) plus enough other
// rows for cross-tabs / gaps / class-view to all be non-trivial.
const LOG_ROWS = [
  row({ dateStr: '2026-09-07', period: 1, classSec: 'VIII-B', day: 'Monday', substitute: 'Teacher C', absent: 'Teacher A', row: 3 }),
  row({ dateStr: '2026-09-08', period: 2, classSec: 'IX-A', day: 'Tuesday', substitute: 'Teacher B', absent: 'Teacher D', row: 4 }),
  row({ dateStr: '2026-09-08', period: 3, classSec: 'IX-A', day: 'Tuesday', substitute: 'Teacher B', absent: 'Teacher D', row: 5 }),
  row({ dateStr: '2026-09-09', period: 1, classSec: 'VIII-B', substitute: '', status: 'UNASSIGNED', row: 6 }),
];
run(`LOG = ${JSON.stringify(LOG_ROWS)}; clearCache();`);

/* ── source doesn't blow up ── */
check('renderAnalyticsTab_ runs without throwing', (function () {
  try { run('renderAnalyticsTab_()'); return true; }
  catch (e) { console.log('    threw: ' + e.message); return false; }
})());

/* ── never calls the row-capping trimColumns_ ── */
const src = fs.readFileSync(path.join(__dirname, '..', 'AnalyticsTab.js'), 'utf8');
check('AnalyticsTab.js never calls trimColumns_ (only trimColumnsOnly_)',
  !/[^_]trimColumns_\(/.test(src.replace(/trimColumnsOnly_/g, '')));
check('AnalyticsTab.js does call trimColumnsOnly_', /trimColumnsOnly_\(/.test(src));
check('AnalyticsTab.js calls ensureRows_ before a write that could exceed the grid',
  /ensureRows_\(/.test(src));

/* ── batched writes: bounded, not one per row ── */
run('__calls.setValues = 0; __calls.setBackgrounds = 0; __calls.valueGrids = [];');
run('renderAnalyticsTab_()');
const callsAfterOne = run('({ setValues: __calls.setValues, setBackgrounds: __calls.setBackgrounds })');
// writeHeader_ (copied from Dashboard.js) writes its header row with its own
// setValues([headers]) call, so each table contributes two calls (header +
// body) — still one call per table per row-group, never one per data row.
check('setValues is called a bounded number of times, not once per row',
  callsAfterOne.setValues > 0 && callsAfterOne.setValues < 40, JSON.stringify(callsAfterOne));
check('setBackgrounds is used (equity status colour) rather than per-cell colouring',
  callsAfterOne.setBackgrounds >= 1, JSON.stringify(callsAfterOne));

/* ── idempotent: running twice makes the same number of calls, no duplication ── */
run('__calls.setValues = 0; __calls.setBackgrounds = 0; __calls.valueGrids = [];');
run('renderAnalyticsTab_()');
const firstRun = run('({ setValues: __calls.setValues, setBackgrounds: __calls.setBackgrounds })');
run('__calls.setValues = 0; __calls.setBackgrounds = 0; __calls.valueGrids = [];');
run('renderAnalyticsTab_()');
const secondRun = run('({ setValues: __calls.setValues, setBackgrounds: __calls.setBackgrounds })');
check('running renderAnalyticsTab_ twice makes the same number of setValues calls (idempotent)',
  firstRun.setValues === secondRun.setValues, JSON.stringify({ firstRun, secondRun }));
check('running renderAnalyticsTab_ twice makes the same number of setBackgrounds calls (idempotent)',
  firstRun.setBackgrounds === secondRun.setBackgrounds, JSON.stringify({ firstRun, secondRun }));

/* ── a null variety reaches the sheet as a dash, never 0 ── */
const grids = run('__calls.valueGrids');
let sawDash = false, sawZeroForSingleDuty = false;
grids.forEach(function (grid) {
  grid.forEach(function (r) {
    // The variety table's row shape is [teacher, duties, varietyClass, ...].
    if (r[0] === 'Teacher C' && r[1] === 1) {
      if (r[2] === '—') sawDash = true;
      if (r[2] === 0) sawZeroForSingleDuty = true;
    }
  });
});
check('a teacher with one duty shows variety as an em dash', sawDash);
check('a teacher with one duty never shows variety as 0', !sawZeroForSingleDuty);

/* ── the equity table labels the "not in pool" cohort, not the engine ── */
let sawNotInPoolLabel = false;
grids.forEach(function (grid) {
  grid.forEach(function (r) {
    if (typeof r[r.length - 1] === 'string' && r[r.length - 1].indexOf('Not in pool') >= 0) sawNotInPoolLabel = true;
  });
});
// Fixture's full teacher roster all have Substitution rows, so this is a
// structural check that the label text exists in the source rather than
// requiring a notInPool member in this particular fixture.
check('the equity status vocabulary includes an explicit "Not in pool" label',
  /Not in pool/.test(src));

/* ── empty log still renders without throwing (RFC §11.8) ── */
run(`LOG = []; clearCache();`);
check('empty log renders the analytics tab without throwing', (function () {
  try { run('renderAnalyticsTab_()'); return true; }
  catch (e) { console.log('    threw: ' + e.message); return false; }
})());
