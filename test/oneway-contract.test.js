/** T-009: the frozen One Way tab and header contract (PRD R26). */
const vm = require('vm');
const { load, DEFAULT_FILES } = require('./harness');

const ctx = load(DEFAULT_FILES.concat(['ReportData.js', 'AnalyticsData.js', 'Dashboard.js', 'Setup.js']));
const run = ctx.run;

const registerName = '🗓️ Absence Register';
const nonTeachingName = '🗓️ Non-Teaching Absence';
const registerHeaders = [
  'Timestamp', 'Date', 'Day', 'Week', 'Teacher', 'Department', 'Team',
  'Absence Type', 'Periods Away', 'Periods Scheduled', 'Periods To Cover',
  'Covered', 'Uncovered', 'Cover Reassigned', 'Run ID', 'Marked By',
];
const nonTeachingHeaders = [
  'Date', 'Teacher', 'Absence Type', 'Periods Away', 'Marked By',
  'Staff Email', 'Staff Code', 'Category', 'Timestamp', 'Notes',
];
const absenceLabels = [
  'Leave - Full day', 'Leave - Morning', 'Leave - Afternoon', 'Permission',
  'OD - Full day', 'OD - Morning', 'OD - Afternoon', 'OD - Periods',
];

check('One Way Register tab name is frozen', run('SS.ABSENCE') === registerName);
check('One Way non-teaching tab name is frozen', run('SS.NON_TEACHING') === nonTeachingName);
check('Register tab contains its contract substring', run("SS.ABSENCE.indexOf('Absence Register') > -1"));
check('non-teaching tab contains its contract substring', run("SS.NON_TEACHING.indexOf('Non-Teaching Absence') > -1"));
check('Register substring is unique among tab constants', run("Object.keys(SS).filter(function (k) { return k !== 'ABSENCE' && SS[k].indexOf('Absence Register') > -1; }).length === 0"));
check('non-teaching substring is unique among tab constants', run("Object.keys(SS).filter(function (k) { return k !== 'NON_TEACHING' && SS[k].indexOf('Non-Teaching Absence') > -1; }).length === 0"));
check('Register headers keep the frozen first six columns in place',
  JSON.stringify(run('ABSENCE_HEADERS.slice(0, 6)')) === JSON.stringify(registerHeaders.slice(0, 6)));
check('Register headers remain the original sixteen-column width',
  run('ABSENCE_HEADERS.length') === 16 && JSON.stringify(run('ABSENCE_HEADERS')) === JSON.stringify(registerHeaders));
// T-010 appends Staff Email, Staff Code: then update to length 18 and assert [16]=Staff Email, [17]=Staff Code (R26)
check('non-teaching headers keep their frozen order',
  JSON.stringify(run('NON_TEACHING_HEADERS')) === JSON.stringify(nonTeachingHeaders));
check('Register data starts at row 3', run('ABSENCE_DATA_START') === 3);
check('non-teaching data starts at row 3 (headers in row 2)', run('NON_TEACHING_DATA_START') === 3);

// Run the real Register builder against a recording sheet: headers must land in row 2.
ctx.__writes = [];
vm.runInContext(`
var __sheet = {
  clear: function () { return __sheet; }, clearConditionalFormatRules: function () { return __sheet; },
  getRange: function (r, c, nr, nc) {
    if (typeof r !== 'number') return __makeCheckedRange();
    return __makeCheckedRange(nr == null ? 1 : nr, nc == null ? 1 : nc, function (v) { __writes.push({ row: r, col: c, values: v }); });
  },
  setRowHeight: function () { return __sheet; }, setColumnWidth: function () { return __sheet; },
  setFrozenRows: function () { return __sheet; }, getMaxColumns: function () { return 26; },
  deleteColumns: function () { return __sheet; }, getMaxRows: function () { return 1000; },
  insertRowsAfter: function () { return __sheet; }, getLastRow: function () { return 1000; },
};
SpreadsheetApp.getActiveSpreadsheet = function () { return { getSheetByName: function () { return __sheet; } }; };
writeAbsenceRegisterTab_();
`, ctx);
const headerWrite = ctx.__writes.find(w => w.row === 2);
check('writeAbsenceRegisterTab_ writes ABSENCE_HEADERS into row 2, column 1',
  !!headerWrite && headerWrite.col === 1 && JSON.stringify(headerWrite.values) === JSON.stringify([registerHeaders]));
check('writeAbsenceRegisterTab_ writes nothing into data rows (row 3+)', ctx.__writes.every(w => w.row <= 2));

// The checked-range mock must reject a mismatched setValues and accept a matching one.
const throws = fn => { try { fn(); return false; } catch (e) { return true; } };
check('checked range rejects setValues with wrong row count',
  throws(() => run('__makeCheckedRange(2, 2).setValues([[1, 2]])')));
check('checked range rejects setValues with wrong column count',
  throws(() => run('__makeCheckedRange(1, 3).setValues([[1, 2]])')));
check('checked range accepts matching setValues',
  !throws(() => run('__makeCheckedRange(2, 2).setValues([[1, 2], [3, 4]])')));
check('absence type labels stay frozen',
  JSON.stringify(run('absenceTypeLabels_()')) === JSON.stringify(absenceLabels));

// Tell the One Way team before changing any frozen item above.
