/**
 * A small but realistic school, as JS the harness can evaluate:
 *   10 teachers · 10 class-sections · 4 blocks · Ground and First floors
 *   8 periods, Monday. Half the classes have a lesson in each period and the
 *   teacher index is distinct within a period, so nobody is double-booked and
 *   everyone has free periods to be pulled into.
 *
 * Exported as a string because it must be evaluated inside the vm context,
 * where the project's own helpers (up_, isoDate_, …) are in scope.
 */
module.exports.SCHOOL = `
var CFG = defaultConfig_();
CFG.periods = 8; CFG.firstAfternoonPeriod = 5; CFG.fairnessBasis = 'Term';
function getConfig() { return CFG; }
function clearCache() { _C = {}; }

var CLASSES = [
  ['LKG','A','A','Ground','Pre-primary'], ['UKG','A','A','Ground','Pre-primary'],
  ['UKG','B','A','Ground','Pre-primary'], ['I','A','B','Ground','Lower Primary'],
  ['II','A','B','First','Lower Primary'],  ['VI','A','C','First','Middle School'],
  ['VII','A','C','First','Middle School'], ['VIII','B','D','First','High School'],
  ['IX','A','D','Ground','High School'],   ['X','C','D','First','High School']
];
var TEACHERS = ['Teacher A','Teacher B','Teacher C','Teacher D','Teacher E',
                'Teacher F','Teacher G','Teacher H','Teacher I','Teacher J'];
var CAPS  = [6,4,4,5,3,4,5,3,4,4];
var TEAMS = ['Pre-primary','Pre-primary','High School','Middle School','Lower Primary',
             'Middle School','High School','Lower Primary','Middle School','High School'];

function getAllotment() {
  var out = [];
  TEACHERS.forEach(function (t, i) {
    out.push({ class:'', section:'', subject:'Substitution', teacher:t,
               department:'Gen', team:TEAMS[i], periodsAllotted:CAPS[i] });
  });
  CLASSES.forEach(function (c) {
    TEACHERS.forEach(function (t) {
      out.push({ class:c[0], section:c[1], subject:'Maths', teacher:t,
                 department:'Maths', team:c[4], periodsAllotted:2 });
    });
  });
  return out;
}
function getTeacherMeta() {
  var o = {}; TEACHERS.forEach(function (t, i) { o[t] = { department:'Gen', team:TEAMS[i] }; }); return o;
}
function getAllTeachers() { return TEACHERS.slice(); }
function getSubjectDeptLookup() { return {}; }
function getClassTeamLookup() {
  var o = {};
  CLASSES.forEach(function (c) { o[up_(c[0]) + '|' + up_(c[1])] = c[4]; o[up_(c[0]) + '|'] = c[4]; });
  return o;
}
function getStaffDuties() { return DUTIES; }
var DUTIES = [];

var TT = [];
for (var p = 1; p <= 8; p++) {
  CLASSES.forEach(function (c, ci) {
    if (ci % 2 !== p % 2) return;
    TT.push({ class:c[0], section:c[1], dayIndex:0, period:p, subject:'Maths',
              teacher: TEACHERS[(ci * 2 + p * 3) % TEACHERS.length] });
  });
}
function getTimetable() { return TT; }

function readLogRows_() { return LOG; }
function readAbsenceRows_() { return []; }
var LOG = [];

var RULES = [], BLK = {};
CLASSES.forEach(function (c) {
  BLK[up_(c[0]) + '|' + up_(c[1])] =
    { block:c[2], floor:c[3], blockKey:up_(c[2]), floorKey:up_(c[3]) };
});
function readRules_() { return RULES; }
function readBlocks_() { return BLK; }

/** Free periods per teacher on Monday, straight from the fixture. */
function fixtureFreeCount(name) {
  var busy = {};
  TT.forEach(function (e) { if (e.teacher === name) busy[e.period] = 1; });
  DUTIES.forEach(function (d) { if (d.teacher === name) busy[d.period] = 1; });
  var n = 0; for (var p = 1; p <= CFG.periods; p++) if (!busy[p]) n++;
  return n;
}
`;
