/**
 * An in-memory Sheets / Cache / Lock / UI mock for the roster tests (T-011).
 *
 * Exported as source text, because it must run INSIDE the vm where the project's
 * own globals (SS, C, …) live. It is faithful where bugs hide:
 *   - setValues rejects a block whose shape differs from the range;
 *   - reading or writing outside the grid (maxRows × maxCols) throws, as Sheets does;
 *   - every write is counted in __stats so a test can prove batching.
 * Everything else (colours, merges, widths) is accepted and ignored.
 */
module.exports.MOCK = `
var __stats = { setValues: 0, setValue: 0, cells: 0, clear: 0 };
var __book = { sheets: {}, order: [], active: null };
var __cache = { store: {}, puts: [], removes: 0, throwing: false };
var __ui = { alerts: [], prompts: [], answer: 'YES', menus: [], items: [] };
var __tzSeen = [];

Utilities.formatDate = function (d, tz, p) {
  __tzSeen.push(tz);
  var off = tz === 'Asia/Kolkata' ? 330 : 0;
  var t = new Date(d.getTime() + off * 60000);
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  return p.replace(/EEE|yyyy|MMM|MM|dd|HH|mm|ss/g, function (m) {
    switch (m) {
      case 'EEE': return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][t.getUTCDay()];
      case 'yyyy': return '' + t.getUTCFullYear();
      case 'MMM': return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][t.getUTCMonth()];
      case 'MM': return pad(t.getUTCMonth() + 1);
      case 'dd': return pad(t.getUTCDate());
      case 'HH': return pad(t.getUTCHours());
      case 'mm': return pad(t.getUTCMinutes());
      default: return pad(t.getUTCSeconds());
    }
  });
};
Session = { getScriptTimeZone: function () { return 'Asia/Kolkata'; },
            getActiveUser: function () { return { getEmail: function () { return 'ict.facilitator@example.test'; } }; } };

CacheService = { getScriptCache: function () {
  return {
    get: function (k) { if (__cache.throwing) throw new Error('cache down'); return k in __cache.store ? __cache.store[k] : null; },
    put: function (k, v, ttl) { if (__cache.throwing) throw new Error('cache down'); __cache.store[k] = v; __cache.puts.push({ k: k, ttl: ttl, len: v.length }); },
    remove: function (k) { if (__cache.throwing) throw new Error('cache down'); delete __cache.store[k]; __cache.removes++; },
  };
} };
var __lockHeld = false;
LockService = { getScriptLock: function () {
  return { tryLock: function () { if (__lockHeld) return false; __lockHeld = true; return true; },
           releaseLock: function () { __lockHeld = false; } };
} };

function __a1(s) {
  var m = /^([A-Z]+)(\\d+)$/.exec(s), c = 0;
  for (var i = 0; i < m[1].length; i++) c = c * 26 + m[1].charCodeAt(i) - 64;
  return { r: +m[2], c: c };
}

function __newSheet(name) {
  var cells = {};
  var formulas = {};
  var s = { _name: name, formulas: formulas, hidden: false, maxRows: 1000, maxCols: 26, cf: [], prot: [], notes: {}, formats: [],
            validations: [], hiddenCols: [], frozenRows: 0, frozenCols: 0, cells: cells, cleared: 0 };
  var key = function (r, c) { return r + ',' + c; };
  var blank = function (v) { return v === '' || v == null; };
  var inBounds = function (r, c, nr, nc) {
    if (r < 1 || c < 1 || r + nr - 1 > s.maxRows || c + nc - 1 > s.maxCols) {
      throw new Error('The coordinates or dimensions of the range are invalid: ' + name + ' r' + r + ' c' + c + ' ' + nr + 'x' + nc +
        ' (grid ' + s.maxRows + 'x' + s.maxCols + ')');
    }
  };
  s.getName = function () { return name; };
  s.getLastRow = function () { var m = 0; for (var k in cells) if (!blank(cells[k])) m = Math.max(m, +k.split(',')[0]); for (var f in formulas) m = Math.max(m, +f.split(',')[0]); return m; };
  s.getLastColumn = function () { var m = 0; for (var k in cells) if (!blank(cells[k])) m = Math.max(m, +k.split(',')[1]); for (var f in formulas) m = Math.max(m, +f.split(',')[1]); return m; };
  s.getMaxRows = function () { return s.maxRows; };
  s.getMaxColumns = function () { return s.maxCols; };
  s.insertRowsAfter = function (after, n) { s.maxRows += n; return s; };
  s.insertColumnsAfter = function (after, n) { s.maxCols += n; return s; };
  s.deleteColumns = function (start, n) { s.maxCols = Math.max(0, s.maxCols - n); return s; };
  s.deleteRows = function (start, n) { s.maxRows = Math.max(0, s.maxRows - n); return s; };
  ['setColumnWidth', 'setRowHeight', 'setHiddenGridlines'].forEach(function (m) { s[m] = function () { return s; }; });
  s.setFrozenRows = function (n) { s.frozenRows = n; return s; };
  s.setFrozenColumns = function (n) { s.frozenCols = n; return s; };
  s.hideColumns = function (c) { s.hiddenCols.push(c); return s; };
  s.hideSheet = function () { s.hidden = true; return s; };
  s.showSheet = function () { s.hidden = false; return s; };
  s.isSheetHidden = function () { return s.hidden; };
  s.setConditionalFormatRules = function (r) { s.cf = r.slice(); return s; };
  s.getConditionalFormatRules = function () { return s.cf.slice(); };
  s.clearConditionalFormatRules = function () { s.cf = []; return s; };
  s.clear = function () { for (var k in cells) delete cells[k]; s.cleared++; __stats.clear++; return s; };
  s.getProtections = function (type) { return s.prot.filter(function (p) { return p.type === type; }); };
  var makeProt = function (type) {
    var p = { type: type, desc: '', warn: false, removed: false };
    p.setDescription = function (d) { p.desc = d; return p; };
    p.getDescription = function () { return p.desc; };
    p.setWarningOnly = function (w) { p.warn = w; return p; };
    p.remove = function () { p.removed = true; s.prot = s.prot.filter(function (x) { return x !== p; }); };
    s.prot.push(p);
    return p;
  };
  s.protect = function () { return makeProt('SHEET'); };
  s.getDataRange = function () { return s.getRange(1, 1, Math.max(1, s.getLastRow()), Math.max(1, s.getLastColumn())); };

  s.getRange = function (a, b, c, d) {
    var r, col, nr, nc;
    if (typeof a === 'string') { var p = __a1(a); r = p.r; col = p.c; nr = 1; nc = 1; }
    else { r = a; col = b; nr = c == null ? 1 : c; nc = d == null ? 1 : d; }
    var rg = {};
    ['setBackground', 'setFontColor', 'setFontWeight', 'setFontSize', 'setFontStyle', 'setVerticalAlignment',
     'setHorizontalAlignment', 'setWrap', 'merge', 'setBorder', 'setFontFamily'].forEach(function (m) { rg[m] = function () { return rg; }; });
    rg.setNote = function (t) { s.notes[key(r, col)] = t; return rg; };
    rg.setNumberFormat = function (f) { s.formats = s.formats.filter(function (x) { return !(x.r === r && x.c === col && x.nr === nr && x.nc === nc); }); s.formats.push({ r: r, c: col, nr: nr, nc: nc, f: f }); return rg; };
    rg.setDataValidation = function (v) { s.validations = s.validations.filter(function (x) { return !(x.r === r && x.c === col && x.nr === nr && x.nc === nc); }); s.validations.push({ r: r, c: col, nr: nr, nc: nc, v: v }); return rg; };
    rg.protect = function () { return makeProt('RANGE'); };
    rg.getNumRows = function () { return nr; };
    rg.getNumColumns = function () { return nc; };
    rg.getRow = function () { return r; };
    rg.getColumn = function () { return col; };
    rg.getSheet = function () { return s; };
    rg.getValues = function () {
      inBounds(r, col, nr, nc);
      var out = [];
      for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) { var v = cells[key(r + i, col + j)]; row.push(v == null ? '' : v); } out.push(row); }
      return out;
    };
    rg.getFormulas = function () {
      inBounds(r, col, nr, nc);
      var out = [];
      for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(formulas[key(r + i, col + j)] || ''); out.push(row); }
      return out;
    };
    rg.getValue = function () { return rg.getValues()[0][0]; };
    rg.setValues = function (vals) {
      __checkDims(vals, nr, nc);
      inBounds(r, col, nr, nc);
      __stats.setValues++; __stats.cells += nr * nc;
      for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) {
        var v = vals[i][j];
        if (v === '' || v == null) delete cells[key(r + i, col + j)]; else cells[key(r + i, col + j)] = v;
      }
      return rg;
    };
    rg.setValue = function (v) { inBounds(r, col, 1, 1); __stats.setValue++; if (blank(v)) delete cells[key(r, col)]; else cells[key(r, col)] = v; return rg; };
    rg.clearContent = function () {
      for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) delete cells[key(r + i, col + j)];
      return rg;
    };
    return rg;
  };
  return s;
}

var __ss = {
  getId: function () { return 'test-workbook'; },
  getName: function () { return 'Test workbook'; },
  getSheetByName: function (n) { return __book.sheets[n] || null; },
  getSheets: function () { return __book.order.map(function (n) { return __book.sheets[n]; }); },
  insertSheet: function (n) {
    if (__book.sheets[n]) throw new Error('A sheet with the name "' + n + '" already exists.');
    var sh = __newSheet(n); __book.sheets[n] = sh; __book.order.push(n); __book.active = n; return sh;
  },
  setActiveSheet: function (sh) { __book.active = sh.getName(); return sh; },
  getActiveSheet: function () { return __book.sheets[__book.active]; },
  moveActiveSheet: function () {},
  deleteSheet: function (sh) { delete __book.sheets[sh.getName()]; __book.order = __book.order.filter(function (n) { return n !== sh.getName(); }); },
  toast: function () {},
};

SpreadsheetApp.getActiveSpreadsheet = function () { return __ss; };
SpreadsheetApp.ProtectionType = { RANGE: 'RANGE', SHEET: 'SHEET' };
SpreadsheetApp.newDataValidation = function () {
  var o = { _kind: '', _list: null, _allow: true, _formula: null, _help: '' };
  ['requireCheckbox', 'requireDate', 'requireValueInList', 'requireFormulaSatisfied', 'setAllowInvalid', 'setHelpText'].forEach(function (m) {
    o[m] = function (v) {
      if (m === 'requireValueInList') o._list = v;
      if (m === 'requireFormulaSatisfied') o._formula = v;
      if (m === 'setAllowInvalid') o._allow = v; else if (m === 'setHelpText') o._help = v; else o._kind = m;
      return o;
    };
  });
  o.build = function () { return { kind: o._kind, list: o._list, allowInvalid: o._allow, formula: o._formula, help: o._help }; };
  return o;
};
SpreadsheetApp.newConditionalFormatRule = function () {
  var o = { f: '', bg: '', ranges: [] };
  o.whenFormulaSatisfied = function (f) { o.f = f; return o; };
  o.setBackground = function (b) { o.bg = b; return o; };
  o.setRanges = function (r) { o.ranges = r; return o; };
  o.build = function () { return { formula: o.f, bg: o.bg }; };
  return o;
};
var __btn = { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' };
SpreadsheetApp.getUi = function () {
  var menu = function (title) {
    var m = { title: title };
    m.addItem = function (label, fn) { __ui.items.push({ menu: title, label: label, fn: fn }); return m; };
    m.addSubMenu = function () { return m; };
    m.addSeparator = function () { return m; };
    m.addToUi = function () { return m; };
    return m;
  };
  return {
    Button: __btn, ButtonSet: { OK: 'OK', YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
    alert: function (title, body) { __ui.alerts.push({ title: title, body: body || '' }); return __btn[__ui.answer]; },
    prompt: function (title, text) {
      var a = __ui.prompts.length ? __ui.prompts.shift() : null;
      return { getSelectedButton: function () { return a === null ? __btn.CANCEL : __btn.OK; }, getResponseText: function () { return a; } };
    },
    createMenu: menu,
  };
};

/** Write rows (objects keyed by header) under a tab's header row, as a human would: not counted. */
function __put(tab, headerRow, startRow, objs) {
  var sh = __book.sheets[tab], at = {};
  for (var c = 1; c <= sh.maxCols; c++) { var h = sh.cells[headerRow + ',' + c]; if (h != null && h !== '') at[String(h).toLowerCase()] = c; }
  objs.forEach(function (o, i) {
    for (var k in o) {
      var col = at[k.toLowerCase()];
      if (!col) throw new Error('no header ' + k + ' on ' + tab);
      var v = o[k];
      if (v === '' || v == null) delete sh.cells[(startRow + i) + ',' + col]; else sh.cells[(startRow + i) + ',' + col] = v;
    }
  });
  while (startRow + objs.length > sh.maxRows) sh.maxRows += 50;
}
function __cell(tab, r, c) { var v = __book.sheets[tab].cells[r + ',' + c]; return v == null ? '' : v; }
function __snapshot(tabs) {
  var out = {};
  (tabs || __book.order).forEach(function (n) {
    var s = __book.sheets[n];
    if (s) out[n] = { cells: s.cells, hidden: s.hidden, prot: s.prot.length, cf: s.cf.length, v: s.validations.length, f: s.formats.length };
  });
  return JSON.stringify(out);
}
function __resetStats() { __stats.setValues = 0; __stats.setValue = 0; __stats.cells = 0; __stats.clear = 0; }
`;
