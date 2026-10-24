/** T-010: Register I/O stays header-driven and key columns are append-only. */
const { load, DEFAULT_FILES } = require('./harness');

const headers = [
  'Staff Code', 'Teacher', 'Unknown', 'Date', 'Day', 'Week', 'Timestamp',
  'Department', 'Team', 'Absence Type', 'Periods Away', 'Periods Scheduled',
  'Periods To Cover', 'Covered', 'Uncovered', 'Cover Reassigned', 'Run ID', 'Marked By',
  'Staff Email',
];
const row = [
  '', 'Staff A', 'must stay blank', '2026-10-23', 'Friday', '2026-W43', new Date(2026, 9, 23),
  'Teaching', 'Team A', 'Leave - Full day', '1-3', 3, 3, 2, 1, 0, 'run-1', 'staff.a@example.test',
  '',
];

const ctx = load(DEFAULT_FILES, `
var __mode = 'io';
var __headers = ${JSON.stringify(headers)};
var __rows = [${JSON.stringify(row)}];
var __rules = [];
var __notes = {};
var __ruleRanges = [];
function __chain() {
  return {
    setValue: function (v) { this._value = v; return this; },
    setValues: function (v) { this._values = v; return this; },
    setBackground: function () { return this; }, setFontColor: function () { return this; },
    setFontWeight: function () { return this; }, setFontSize: function () { return this; },
    setBackgrounds: function () { return this; }, setFontColors: function () { return this; },
    setBorder: function () { return this; }, setDataValidation: function () { return this; },
    setNote: function (n) { __notes[this.column] = n; return this; },
    getNote: function () { return __notes[this.column] || ''; }
  };
}
var __sheet = {
  getLastRow: function () { return 2 + __rows.length; },
  getLastColumn: function () { return __headers.length; },
  getMaxColumns: function () { return __headers.length; },
  getMaxRows: function () { return 100; },
  getRange: function (r, c, nr, nc) {
    var out = __chain();
    out.row = r; out.column = c; out.numRows = nr || 1; out.numColumns = nc || 1;
    out.getValues = function () {
      if (r === 2) return [__headers.slice(c - 1, c - 1 + (nc || 1))];
      if (r >= 3) return __rows.slice(r - 3, r - 3 + nr).map(function (x) {
        return x.slice(c - 1, c - 1 + nc);
      });
      return [['']];
    };
    out.setValues = function (values) {
      if (r === 2) {
        for (var h = 0; h < values[0].length; h++) __headers[c - 1 + h] = values[0][h];
        return out;
      }
      for (var i = 0; i < values.length; i++) {
        while (__rows.length <= r - 3 + i) __rows.push([]);
        for (var j = 0; j < values[i].length; j++) __rows[r - 3 + i][c - 1 + j] = values[i][j];
      }
      return out;
    };
    out.setValue = function (value) {
      if (r === 2) __headers[c - 1] = value;
      return out;
    };
    return out;
  },
  getConditionalFormatRules: function () { return __rules.slice(); },
  setConditionalFormatRules: function (rules) { __rules = rules.slice(); },
  insertColumnAfter: function () { __headers.push(''); },
  setColumnWidth: function () {}, setFrozenRows: function () {},
  clear: function () {}, clearConditionalFormatRules: function () {},
};
SpreadsheetApp.getActiveSpreadsheet = function () {
  return { getSheetByName: function () { return __sheet; } };
};
SpreadsheetApp.newConditionalFormatRule = function () {
  var formula = '';
  var ranges = [];
  var rule = {
    whenFormulaSatisfied: function (v) { formula = v; return rule; },
    setBackground: function () { return rule; },
    setRanges: function (v) { ranges = v; __ruleRanges.push(v); return rule; },
    build: function () {
      return { getBooleanCondition: function () {
        return { getCriteriaValues: function () { return [formula]; } };
      }, getRanges: function () { return ranges; }};
    }
  };
  return rule;
};
function ensureTab_(name, writer) { return __sheet; }
function ensureRows_() {}
`);
const run = ctx.run;

const parsed = run('clearCache(); readAbsenceRows_()[0]');
check('reader resolves shuffled Register headers by name',
  parsed.teacher === 'Staff A' && parsed.dateStr === '2026-10-23' && parsed.toCover === 3 && parsed.uncovered === 1 &&
  parsed.staffEmail === '' && parsed.staffCode === '',
  JSON.stringify(parsed));

run(`appendToAbsenceRegister_({dateStr:'2026-10-24',day:'Saturday',weekKey:'2026-W43',runId:'run-2',markedBy:'staff.a@example.test'}, [{
  teacher:'Staff A', department:'Teaching', team:'Team A', scope:'LEAVE_FULL', periodsAway:'1',
  scheduled:1, toCover:1, covered:1, uncovered:0, reassignedAway:0
}]);`);
const written = run('__rows[1]');
const writtenMap = run('absenceHeaderMap_(__headers)');
check('writer places fields by shuffled header name',
  written[writtenMap.TEACHER] === 'Staff A' && written[writtenMap.DATE] === '2026-10-24' &&
  written[writtenMap['STAFF EMAIL']] === '' && written[writtenMap['STAFF CODE']] === '' &&
  written[writtenMap.UNKNOWN] === '');

var rowsBeforeMissingHeader = JSON.stringify(run('__rows'));
run(`__headers = ${JSON.stringify(headers.filter(function (h) { return h !== 'Run ID'; }))};`);
var missingHeaderError = run(`(function () {
  try {
    appendToAbsenceRegister_({dateStr:'2026-10-25',day:'Sunday',weekKey:'2026-W43',runId:'run-3'}, [{teacher:'Staff A'}]);
    return '';
  } catch (e) { return e.message; }
})()`);
check('writer rejects a missing required header before writing rows',
  missingHeaderError.indexOf('Run ID') >= 0 && JSON.stringify(run('__rows')) === rowsBeforeMissingHeader,
  missingHeaderError + ' / ' + JSON.stringify(run('__rows')));

run(`__headers = ${JSON.stringify(headers.filter(function (h) { return h !== 'Staff Code' && h !== 'Staff Email'; }))}; __rules = [];`);
run('refreshAbsenceRegisterChrome_(); refreshAbsenceRegisterChrome_(); refreshAbsenceRegisterChrome_();');
const refreshed = run('({ headers: __headers, rules: __rules.length })');
check('refreshLabels append is idempotent and ordered',
  refreshed.headers.length === 19 && refreshed.headers[17] === 'Staff Email' && refreshed.headers[18] === 'Staff Code' &&
  refreshed.headers.filter(function (h) { return h === 'Staff Email'; }).length === 1 &&
  refreshed.headers.filter(function (h) { return h === 'Staff Code'; }).length === 1,
  JSON.stringify(refreshed));
check('blank key conditional formats are installed once per key', refreshed.rules === 2, refreshed.rules);
const cfSpan = run('__ruleRanges[0][0]');
check('blank key conditional formats are sized to the real grid (getMaxRows), never past it',
  cfSpan && cfSpan.row === 3 && cfSpan.numRows === 98,
  JSON.stringify(cfSpan));

run(`var __emptySheet = {
  getLastColumn: function () { return 0; }, getMaxColumns: function () { return 0; },
  getConditionalFormatRules: function () { return []; }, setConditionalFormatRules: function () {},
  getMaxRows: function () { return 100; }
};
SpreadsheetApp.getActiveSpreadsheet = function () {
  return { getSheetByName: function () { return __emptySheet; } };
};`);
const emptyRefresh = run('refreshAbsenceRegisterChrome_()');
check('refresh skips a register tab with no headers',
  JSON.stringify(emptyRefresh) === '[]', JSON.stringify(emptyRefresh));


// ── review fixes ─────────────────────────────────────────────
run(`SpreadsheetApp.getActiveSpreadsheet = function () {
  return { getSheetByName: function () { return __sheet; } };
};`);

// 1. title row + BLANK row 2 (width > 0): refresh must not stamp headers into it
run(`__headers = ['', '', '']; __rules = [];`);
const blankRefresh = run('({ done: refreshAbsenceRegisterChrome_(), headers: __headers.slice() })');
check('refresh leaves a blank row 2 untouched (no Staff Email/Code stamped)',
  JSON.stringify(blankRefresh.headers) === '["","",""]' && blankRefresh.done.length === 0,
  JSON.stringify(blankRefresh));

// 4. CF idempotent, widens narrower rule, never exceeds the grid
run(`__headers = ${JSON.stringify(headers)}; __rules = []; __ruleRanges = [];
 var __grid = 100; __sheet.getMaxRows = function () { return __grid; };`);
run('applyAbsenceKeyConditionalFormats_(__sheet);');
run('__grid = 500; applyAbsenceKeyConditionalFormats_(__sheet);');
run('applyAbsenceKeyConditionalFormats_(__sheet); applyAbsenceKeyConditionalFormats_(__sheet);');
const cfAfter = run('__rules.map(function (r) { return { f: r.getBooleanCondition().getCriteriaValues()[0], n: r.getRanges()[0].numRows, row: r.getRanges()[0].row }; })');
check('CF: still exactly two amber rules after repeated runs and a grid growth',
  cfAfter.length === 2 && new Set(cfAfter.map(x => x.f)).size === 2, JSON.stringify(cfAfter));
check('CF: narrower existing rule is widened to the grown grid, never past it',
  cfAfter.every(x => x.row === 3 && x.n === 498), JSON.stringify(cfAfter));
run('__grid = 100;');

// appender re-applies CF after ensureRows_ grows the grid
run(`__rules = []; __grid = 100;
 ensureRows_ = function () { __grid = 300; };`);
run(`appendToAbsenceRegister_({dateStr:'2026-10-26',day:'Monday',weekKey:'2026-W44',runId:'run-4'}, [{teacher:'Staff A'}]);`);
const cfGrown = run('__rules.map(function (r) { return r.getRanges()[0].numRows; })');
check('appender re-runs the amber rule after the grid grows',
  cfGrown.length === 2 && cfGrown.every(n => n === 298), JSON.stringify(cfGrown));
run('ensureRows_ = function () {}; __grid = 100;');

// 3. removeAbsenceRows_ throws on missing Date/Teacher instead of silently deleting nothing
run(`__headers = ${JSON.stringify(headers.filter(h => h !== 'Teacher'))};`);
const rmErr = run(`(function () {
  try { clearCache(); removeAbsenceRows_('2026-10-23', null); return ''; } catch (e) { return e.message; }
})()`);
check('removeAbsenceRows_ throws naming the missing Teacher header',
  rmErr.indexOf('Teacher') >= 0, rmErr);

// 2. commitPlan pre-flight: renamed required header -> throw before ANY side effect
run(`__headers = ${JSON.stringify(headers.filter(h => h !== 'Run ID'))};
 var __calls = [];
 removeForCommit_ = function () { __calls.push('remove'); };
 sendNotifications_ = function () { __calls.push('notify'); return true; };
 appendToLog_ = function () { __calls.push('log'); };
 refreshDashboards_ = function () { __calls.push('dash'); };
 activeEmail_ = function () { return 'x@example.test'; };`);
const commitErr = run(`(function () {
  try {
    commitPlan({ok:true, dateStr:'2026-10-27', day:'Tuesday', weekKey:'2026-W44', assignments:[],
      absences:[{teacher:'Staff A'}], summary:{assigned:0, unassigned:0, reassigned:0}}, 'x@example.test');
    return '';
  } catch (e) { return e.message; }
})()`);
check('commitPlan throws on a missing required header before any side effect',
  commitErr.indexOf('Run ID') >= 0 && JSON.stringify(run('__calls')) === '[]',
  commitErr + ' / ' + JSON.stringify(run('__calls')));
const noAbsence = run(`(function () {
  commitPlan({ok:true, dateStr:'2026-10-27', day:'Tuesday', weekKey:'2026-W44', assignments:[],
    absences:[], summary:{assigned:0, unassigned:0, reassigned:0}}, 'x@example.test');
  return __calls;
})()`);
check('commitPlan pre-flight is skipped when there are no absences',
  JSON.stringify(noAbsence) === '["remove","notify","log","dash"]', JSON.stringify(noAbsence));
const assignSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'Assign.js'), 'utf8');
const body = assignSrc.slice(assignSrc.indexOf('function commitPlan('));
check('source order: assertAbsenceRegisterReady_ precedes removeForCommit_ in commitPlan',
  body.indexOf('assertAbsenceRegisterReady_(') > 0 &&
  body.indexOf('assertAbsenceRegisterReady_(') < body.indexOf('removeForCommit_('));

// ── Codex review fixes ───────────────────────────────────────
// 1. reader validates required headers
run(`__headers = ${JSON.stringify(headers.filter(h => h !== 'Date'))};`);
const readErr = run(`(function () { try { clearCache(); readAbsenceRows_(); return ''; } catch (e) { return e.message; } })()`);
check('readAbsenceRows_ throws naming the missing Date header (no silent blank rows)',
  readErr.indexOf('Date') >= 0 && readErr.indexOf('missing required') >= 0, readErr);

// 2. one normaliser: double space / NBSP / case do not hide a header
run(`__headers = ${JSON.stringify(headers.filter(h => h !== 'Staff Code' && h !== 'Staff Email'))}.concat(['Staff  Email', 'staff\u00a0code ']); __rules = []; __notes = {};`);
run('refreshAbsenceRegisterChrome_(); refreshAbsenceRegisterChrome_();');
const normH = run('__headers.slice()');
check('whitespace variants of the key headers are recognised, no duplicate column appended',
  normH.length === 19 && run("absenceHeaderIndex_(absenceHeaderMap_(__headers), 'Staff Email')") === 17,
  JSON.stringify(normH));

// 3. header notes: set on append, restored if missing, idempotent
run(`__headers = ${JSON.stringify(headers.filter(h => h !== 'Staff Code' && h !== 'Staff Email'))}; __rules = []; __notes = {};`);
run('refreshAbsenceRegisterChrome_();');
const n1 = run('JSON.stringify(__notes)');
const notes = run('__notes');
check('key header notes are set when the headers are appended',
  notes[18] && notes[19] && notes[18].indexOf('join key') >= 0 && notes[18].indexOf('Amber') >= 0 &&
  notes[18].indexOf('Never edit') >= 0, n1);
run('delete __notes[19]; refreshAbsenceRegisterChrome_(); refreshAbsenceRegisterChrome_();');
check('a missing key note is restored on refresh, and refresh is idempotent',
  run('__notes')[19] && run('JSON.stringify(__notes)') === n1);

// ── round 3: malformed EMPTY register ────────────────────────
run(`var __lastRow = 2; __sheet.getLastRow = function () { return __lastRow; };
 __headers = ${JSON.stringify(headers.filter(h => h !== 'Teacher'))};`);
const emptyBad = run(`(function () { try { clearCache(); readAbsenceRows_(); return ''; } catch (e) { return e.message; } })()`);
check('readAbsenceRows_ throws on a set-up Register with a missing header and no data rows',
  emptyBad.indexOf('Teacher') >= 0, emptyBad);
run(`__headers = ['', '', ''];`);
const emptyBlank = run(`(function () { clearCache(); return readAbsenceRows_(); })()`);
check('readAbsenceRows_ returns [] for a completely blank tab (fresh workbook)',
  JSON.stringify(emptyBlank) === '[]', JSON.stringify(emptyBlank));
run(`__headers = ${JSON.stringify(headers)}; clearCache();`);
check('readAbsenceRows_ returns [] for a valid Register with no data rows',
  JSON.stringify(run('readAbsenceRows_()')) === '[]');
