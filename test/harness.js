/**
 * Test harness — loads the Apps Script sources into a Node vm with the
 * Google globals stubbed, so the pure logic (rules, assignment, reporting)
 * can be exercised without deploying.
 *
 * Usage:  const { load } = require('./harness');
 *         const ctx = load(['Constants.js', 'Assign.js', ...]);
 *         ctx.run('someFunction_()');
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const STUBS = `
var Logger = { log: function () {} };
var Session = { getScriptTimeZone: function () { return 'Asia/Kolkata'; } };
var Utilities = { formatDate: function (d, tz, p) {
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  return p.replace(/EEE|yyyy|MMM|dd|MM/g, function (m) {
    if (m === 'EEE') return ${JSON.stringify(DAY)}[d.getDay()];
    if (m === 'yyyy') return '' + d.getFullYear();
    if (m === 'MMM') return ${JSON.stringify(MON)}[d.getMonth()];
    if (m === 'MM') return pad(d.getMonth() + 1);
    return pad(d.getDate());
  });
} };
var SpreadsheetApp = {
  newDataValidation: function () {
    var L = null, o = {
      requireValueInList: function (v) { L = v; return o; },
      requireDate: function () { return o; },
      setAllowInvalid: function () { return o; },
      build: function () { return { list: L }; }
    };
    return o;
  },
  BorderStyle: { SOLID: 1, SOLID_THICK: 2 }
};
var PropertiesService = { getScriptProperties: function () {
  return { getProperty: function () { return ''; } }; } };
var DriveApp = {}, ScriptApp = { WeekDay: {} }, MailApp = {}, UrlFetchApp = {};
`;

const DEFAULT_FILES = [
  'Constants.js', 'Config.js', 'Dates.js', 'Chat.js', 'Log.js',
  'AbsenceRegister.js', 'Pool.js', 'Rules.js', 'DataSource.js', 'Assign.js',
];

/**
 * @param {string[]} [files]     project sources to load, in order
 * @param {string}   [overrides] JS appended after the sources, to replace
 *                               functions that would otherwise hit Sheets
 */
function load(files, overrides) {
  const list = files || DEFAULT_FILES;
  const src = STUBS
    + list.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
    + (overrides || '');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'bundle.js' });
  ctx.run = expr => vm.runInContext(expr, ctx);
  return ctx;
}

module.exports = { load, ROOT, DEFAULT_FILES };
