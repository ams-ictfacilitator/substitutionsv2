/**
 * ============================================================
 * Roster.gs — read the roster, sync it with the Allotment, lock Staff Codes,
 * check it (T-011).
 *
 * The roster (🪪 Teachers) is an IDENTITY OVERLAY, not a membership source:
 * 📋 Allotment still decides who teaches (PRD D1). Nothing here changes who
 * is offered cover or how a substitute is chosen.
 *
 *   getRoster_()              the roster, cached for 5 minutes
 *   previewRosterSync_()      writes only 🧾 Sync Preview
 *   applyRosterSync_()        the only code that adds a row or clears Active
 *   lockNewStaffCodes_()      first-set lock of hand-entered codes
 *   correctStaffCode_()       the only way to change a code once set
 *   rosterJoinKeys_()         the keys other code may write (locked code, confirmed email)
 *   getMarkableTeachers_()    Allotment teachers minus Active = FALSE, fail-open (T-014)
 *   rosterWarnings_()         counts + names of roster gaps among them, never blocking (T-014)
 *   computeRosterCheck_()     🧪 Check roster, pure
 *
 * Every write is under the script lock, batched (one call per column), and
 * logged to 🪪 Roster Log. Dates are yyyy-MM-dd; timestamps are Asia/Kolkata.
 * Nothing here ever reads the HR Database: that is T-020's single reader.
 * ============================================================
 */

const ROSTER_CACHE_KEY = 'roster:v1';
const ROSTER_CACHE_TTL = 300;            // seconds
const ROSTER_CACHE_MAX_CHARS = 90 * 1024; // CacheService limits a value to 100 KB
const ROSTER_TZ = 'Asia/Kolkata';

/* ───────── reading ───────── */

function rosterStamp_() { return Utilities.formatDate(new Date(), ROSTER_TZ, 'yyyy-MM-dd HH:mm:ss'); }
function rosterClock_() { return Utilities.formatDate(new Date(), ROSTER_TZ, 'yyyy-MM-dd HH:mm'); }

/** Trim and upper-case a Staff Code. A placeholder or blank becomes ''. */
function rosterCode_(v, placeholders) {
  return isPlaceholder_(v, placeholders) ? '' : norm_(v).toUpperCase();
}

/** Read the roster straight from the sheet (never cached). */
function readRosterRows_() {
  var sheet = sheet_(SS.ROSTER);
  var settings = readRosterSettings_();
  var out = { exists: !!sheet, rows: [], cols: {} };
  if (!sheet || sheet.getLastColumn() < 1) return out;

  var lastCol = sheet.getLastColumn();
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, lastCol).getValues()[0]);
  ROSTER_HEADERS.forEach(function (h) { out.cols[h] = at[rosterHeaderKey_(h)] || 0; });
  if (sheet.getLastRow() < ROSTER_DATA_START) return out;

  var n = sheet.getLastRow() - ROSTER_DATA_START + 1;
  var data = sheet.getRange(ROSTER_DATA_START, 1, n, lastCol).getValues();
  var ph = settings.placeholders;
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var g = function (h) { var c = out.cols[h]; return c ? r[c - 1] : ''; };
    var name = norm_(g('Display Name')), codeRaw = norm_(g('Staff Code')), emailRaw = norm_(g('Email'));
    var category = norm_(g('Category'));
    if (!name && !codeRaw && !emailRaw && !category) continue;
    var activeCell = g('Active'), inCell = g('In Allotment');
    out.rows.push({
      row: ROSTER_DATA_START + i,
      name: name,
      staffCodeRaw: codeRaw,
      staffCode: rosterCode_(codeRaw, ph),
      locked: rosterCode_(g('Staff Code (Locked)'), ph),
      category: category,
      // Blank means "never unticked", so default TRUE (PRD §6.1) and fail open (D1).
      active: norm_(activeCell) === '' ? true : isTrue_(activeCell),
      emailRaw: emailRaw,
      email: isPlaceholder_(emailRaw, ph) ? '' : emailRaw.toLowerCase(),
      matchStatus: norm_(g('Match Status')),
      department: norm_(g('Department')),
      team: norm_(g('Team')),
      inAllotment: norm_(inCell) === '' ? null : isTrue_(inCell),
      leftOn: normDateCell_(g('Left On')),
      replacedBy: norm_(g('Replaced By')),
      confirmedBy: norm_(g('Confirmed By')),
      confirmedOn: normDateCell_(g('Confirmed On')),
      notes: norm_(g('Notes')),
    });
  }
  return out;
}

/* ───────── cache ───────── */

function rosterCacheGet_() {
  try {
    var raw = CacheService.getScriptCache().get(ROSTER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }   // fail soft: a cache problem must never stop a mark
}

function rosterCachePut_(model) {
  try {
    var json = JSON.stringify(model);
    if (json.length > ROSTER_CACHE_MAX_CHARS) return;   // too big to cache: callers read the tab
    CacheService.getScriptCache().put(ROSTER_CACHE_KEY, json, ROSTER_CACHE_TTL);
  } catch (e) { /* fail soft */ }
}

/**
 * The roster as { exists, rows, cols }: 5-minute CacheService entry, and
 * memoised per execution. Call clearRosterCache_() after any write.
 */
function getRoster_() {
  return memo('roster', function () {
    var cached = rosterCacheGet_();
    if (cached && cached.rows) return cached;
    var fresh = readRosterRows_();
    if (fresh.exists) rosterCachePut_(fresh);   // never cache "tab missing": it goes stale the moment the tab is made
    return fresh;
  });
}

/** Drop the cached roster everywhere. Never throws. */
function clearRosterCache_() {
  delete _C.roster;
  delete _C.rosterKeyIndex;
  delete _C.rosterSettings;
  try { CacheService.getScriptCache().remove(ROSTER_CACHE_KEY); } catch (e) { /* fail soft */ }
}

/* ───────── Staff Code rules (PRD D3) ───────── */

/**
 * Is this group of rows (all holding one code) a legitimate rename chain?
 * Every row but one must be inactive and point, through Replaced By, at
 * another row in the group; the pointers must be acyclic and end at exactly
 * one ACTIVE row (the head). The chain must be LINEAR: a row replaced by two,
 * or two rows replaced by one (a branch), two Active rows, or a cycle is a conflict.
 */
function rosterIsRenameChain_(list) {
  var by = {};
  list.forEach(function (r) { by[r.name] = r; });
  var preds = {}, heads = 0, activeHead = false;
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    var next = r.replacedBy && r.replacedBy !== r.name ? by[r.replacedBy] : null;
    if (!next) { heads++; activeHead = r.active; continue; }
    if (r.active) return false;                       // only the end of the chain may be Active
    preds[next.name] = (preds[next.name] || 0) + 1;
    if (preds[next.name] > 1) return false;           // a branch: two rows replaced by one
  }
  if (heads !== 1 || !activeHead) return false;
  // acyclic: from every row the walk must reach the head within list.length steps
  for (var j = 0; j < list.length; j++) {
    var cur = list[j], steps = 0;
    while (cur.replacedBy && cur.replacedBy !== cur.name && by[cur.replacedBy]) {
      cur = by[cur.replacedBy];
      if (++steps > list.length) return false;
    }
  }
  return true;
}

/**
 * { code: { rows, ok } } for every code held (typed OR locked) by more than
 * one row. `ok` is true for a legitimate rename chain.
 */
function rosterCodeConflicts_(rows) {
  var by = {};
  rows.forEach(function (r) {
    var seen = {};
    [r.staffCode, r.locked].forEach(function (c) {
      if (!c || seen[c]) return;
      seen[c] = true;
      (by[c] = by[c] || []).push(r);
    });
  });
  var out = {};
  for (var code in by) if (by[code].length > 1) out[code] = { rows: by[code], ok: rosterIsRenameChain_(by[code]) };
  return out;
}

/** Could `row` hold `code`? Counts inactive rows too: a code is never reused. */
function rosterCodeAvailable_(rows, row, code) {
  var others = rows.filter(function (o) { return o.row !== row.row && (o.staffCode === code || o.locked === code); });
  if (!others.length) return { ok: true, with: [] };
  var sim = Object.assign({}, row, { staffCode: code, locked: code });
  return { ok: rosterIsRenameChain_(others.concat([sim])), with: others.map(function (o) { return o.name; }) };
}

/**
 * State of one row's Staff Code:
 *   name-only · missing · unlocked (typed, not yet locked) · changed (differs
 *   from the locked copy, or blanked) · duplicate · ok
 */
function rosterCodeState_(r, info, conflicts) {
  if (info.nameOnly) return (r.staffCode || r.locked) ? 'name-only-has-code' : 'name-only';
  if (!r.staffCode && !r.locked) return 'missing';
  if (r.locked && r.staffCode !== r.locked) return 'changed';
  if (!r.locked) return 'unlocked';
  var c = conflicts[r.staffCode];
  if (c && !c.ok) return 'duplicate';
  return 'ok';
}

/**
 * The keys other code may write for `displayName` (PRD D6): the LOCKED Staff
 * Code and the Email only when Match Status = Confirmed. A row whose code is
 * unlocked, changed or duplicated yields no code, so a mismatch blocks that
 * person's code write. Never falls back to importHR or a similar name.
 *
 * Returns { found, staffCode, staffEmail, codeState, category, nameOnly }.
 */
function rosterJoinKeys_(displayName) {
  var idx = memo('rosterKeyIndex', function () {
    var roster = getRoster_(), settings = readRosterSettings_();
    var conflicts = rosterCodeConflicts_(roster.rows);
    var map = {}, dupes = {}, seen = {};
    roster.rows.forEach(function (r) { if (r.name) { if (seen[r.name]) dupes[r.name] = true; seen[r.name] = true; } });
    roster.rows.forEach(function (r) {
      if (!r.name || map[r.name]) return;
      if (dupes[r.name]) {   // ambiguous: never guess which person is meant
        map[r.name] = { found: true, ambiguous: true, category: '', nameOnly: false, codeState: 'duplicate name', staffCode: '', staffEmail: '' };
        return;
      }
      var info = rosterCategoryInfo_(settings, r.category);
      var state = rosterCodeState_(r, info, conflicts);
      map[r.name] = {
        found: true, category: r.category, nameOnly: info.nameOnly, codeState: state,
        staffCode: state === 'ok' ? r.locked : '',
        staffEmail: (!info.nameOnly && r.matchStatus === 'Confirmed' && r.email) ? r.email : '',
      };
    });
    return map;
  });
  return idx[norm_(displayName)] ||
    { found: false, category: '', nameOnly: false, codeState: 'no row', staffCode: '', staffEmail: '' };
}

/** { name: how many rows carry it }. Lookups by name must never resolve a duplicate. */
function rosterNameCounts_(rows) {
  var n = {};
  rows.forEach(function (r) { if (r.name) n[r.name] = (n[r.name] || 0) + 1; });
  return n;
}

/* ───────── markable teachers and warnings (PRD D1, D2, R12, R13) ───────── */

/** { name: true } for every Allotment-style name whose roster rows are ALL Active = FALSE. */
function rosterInactiveNames_(rows) {
  var any = {}, active = {};
  rows.forEach(function (r) { if (r.name) { any[r.name] = true; if (r.active) active[r.name] = true; } });
  var out = {};
  Object.keys(any).forEach(function (n) { if (!active[n]) out[n] = true; });
  return out;
}

/**
 * The names the grid dropdown and the side panel offer: the Allotment teachers
 * (getAllTeachers(), the authority) minus roster rows marked Active = FALSE.
 * FAIL-OPEN: a teacher with no roster row is still offered, and a missing or
 * unreadable roster returns the plain Allotment list. A duplicated name is
 * hidden only if every row carrying it is inactive. Roster problems never
 * throw; an Allotment failure does (callers already report "source not connected").
 */
function getMarkableTeachers_() {
  var all = getAllTeachers();
  var inactive = {};
  try {
    var roster = getRoster_();
    if (roster && roster.exists && roster.rows) inactive = rosterInactiveNames_(roster.rows);
  } catch (e) { inactive = {}; }
  return all.filter(function (t) { return !inactive[norm_(t)]; });
}

/**
 * Roster gaps among `teachers` (default: the markable list), as counts and
 * names only (no codes, no emails):
 *   { available, missingFromRoster, missingCode, missingEmail, duplicateNames }
 * each { count, names }. Name-only categories (Resource Person) are never
 * counted for code or email (D11). Never throws; never blocks marking.
 */
function rosterWarnings_(teachers) {
  var empty = function () { return { count: 0, names: [] }; };
  var w = { available: false, missingFromRoster: empty(), missingCode: empty(), missingEmail: empty(), duplicateNames: empty() };
  var add = function (k, n) { w[k].names.push(n); w[k].count++; };
  try {
    var roster = getRoster_();
    if (!roster || !roster.exists || !roster.rows) return w;
    var list = teachers || getMarkableTeachers_();
    w.available = true;
    var settings = readRosterSettings_();
    var counts = rosterNameCounts_(roster.rows), byName = {};
    roster.rows.forEach(function (r) { if (r.name && !byName[r.name]) byName[r.name] = r; });
    list.forEach(function (t) {
      var n = norm_(t), r = byName[n];
      if (!r) { add('missingFromRoster', n); return; }
      if (counts[n] > 1) { add('duplicateNames', n); return; }   // ambiguous: never guess which row is meant
      var info = rosterCategoryInfo_(settings, r.category);
      if (info.nameOnly) return;
      if (!r.staffCode && !r.locked) add('missingCode', n);
      if (info.emailRequired && !(r.matchStatus === 'Confirmed' && r.email)) add('missingEmail', n);
    });
  } catch (e) { w.available = false; }
  return w;
}

/** One-line summary of warnings for the grid status cell ('' when there is nothing to say). */
function rosterWarningText_(w) {
  if (!w || !w.available) return '';
  var parts = [];
  if (w.missingFromRoster.count) parts.push(w.missingFromRoster.count + ' not on the 🪪 Teachers roster (use 🪪 Roster → Preview sync)');
  if (w.missingCode.count) parts.push(w.missingCode.count + ' without a Staff Code');
  if (w.missingEmail.count) parts.push(w.missingEmail.count + ' without a confirmed email');
  if (w.duplicateNames.count) parts.push(w.duplicateNames.count + ' with a duplicate roster name');
  return parts.length ? '🪪 Roster: ' + parts.join(' · ') + '.' : '';
}

/** Names among `typed` that are in the roster but Active = FALSE. Never throws. */
function rosterInactiveAmong_(typed) {
  try {
    var roster = getRoster_();
    if (!roster || !roster.exists || !roster.rows) return [];
    var inactive = rosterInactiveNames_(roster.rows);
    return typed.filter(function (t) { return inactive[norm_(t)]; });
  } catch (e) { return []; }
}

/* ───────── writing (all under the script lock) ───────── */

function withRosterLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another roster change is running. Wait a minute and try again.');
  try { return fn(); }
  finally { try { lock.releaseLock(); } catch (e) { /* already released */ } }
}

function rosterNeedTab_(name) {
  var sheet = sheet_(name);
  if (!sheet) throw new Error('The ' + name + ' tab is missing. Run 🔧 Upgrade tabs (safe) first.');
  return sheet;
}

/**
 * Set cells of ONE column in a single read and a single write.
 * `edits` is { sheetRow: value }. Writes nothing when no value differs.
 * Returns the number of cells changed. The column is found by header name.
 */
function rosterColumnUpdate_(sheet, col, dataStart, edits) {
  if (!col) throw new Error('A column this change needs is missing from ' + sheet.getName());
  var last = sheet.getLastRow();
  if (last < dataStart) return 0;
  var n = last - dataStart + 1;
  var vals = sheet.getRange(dataStart, col, n, 1).getValues();
  var changed = 0;
  for (var r in edits) {
    var i = Number(r) - dataStart;
    if (i < 0 || i >= n) continue;
    if (String(vals[i][0]) !== String(edits[r])) { vals[i][0] = edits[r]; changed++; }
  }
  if (changed) sheet.getRange(dataStart, col, n, 1).setValues(vals);
  return changed;
}

/** Throw 'Nothing was applied' if any named roster header is missing, or the log tab/headers are unusable. */
function rosterRequireReady_(cols, needed, what) {
  var missing = needed.filter(function (h) { return !cols[h]; }).map(function (h) { return SS.ROSTER + ': "' + h + '"'; });
  var log = rosterNeedTab_(SS.ROSTER_LOG);
  var at = rosterHeaderCols_(log.getRange(2, 1, 1, Math.max(1, log.getLastColumn())).getValues()[0]);
  ROSTER_LOG_HEADERS.forEach(function (h) { if (!at[rosterHeaderKey_(h)]) missing.push(SS.ROSTER_LOG + ': "' + h + '"'); });
  if (missing.length) throw new Error('Nothing was ' + (what || 'changed') + '. Missing header(s): ' + missing.join(', ') + '. Restore them, or run 🔧 Upgrade tabs (safe).');
}

/** Append whole rows ({header: value}) after the last named row, in one write. */
function rosterAppendRows_(sheet, cols, objs) {
  if (!objs.length) return 0;
  var width = sheet.getLastColumn();
  var last = sheet.getLastRow(), end = ROSTER_DATA_START - 1;
  if (last >= ROSTER_DATA_START) {
    // the last row holding ANY content (an unnamed row with a code or a note counts)
    var area = sheet.getRange(ROSTER_DATA_START, 1, last - ROSTER_DATA_START + 1, width);
    var grid = area.getValues(), fx = area.getFormulas();
    for (var i = 0; i < grid.length; i++) {
      for (var j = 0; j < grid[i].length; j++) if (norm_(grid[i][j]) !== '' || norm_(fx[i][j]) !== '') { end = ROSTER_DATA_START + i; break; }
    }
  }
  var first = end + 1;
  ensureRows_(sheet, first + objs.length);
  // belt and braces: never overwrite a value OR a formula (a formula can evaluate to blank)
  var tr = sheet.getRange(first, 1, objs.length, width), tv = tr.getValues(), tf = tr.getFormulas();
  if (tv.some(function (r, i) { return r.some(function (v, j) { return norm_(v) !== '' || norm_(tf[i][j]) !== ''; }); })) {
    throw new Error('The next free rows on ' + sheet.getName() + ' are not empty, so nothing was added.');
  }
  var rows = objs.map(function (o) {
    var arr = [];
    for (var c = 0; c < width; c++) arr.push('');
    ROSTER_HEADERS.forEach(function (h) { if (cols[h] && o[h] != null) arr[cols[h] - 1] = o[h]; });
    return arr;
  });
  sheet.getRange(first, 1, rows.length, width).setValues(rows);
  return rows.length;
}

/**
 * Append to 🪪 Roster Log. entries: [{name, field, old, now, reason, source}].
 * Append-only: this is the only writer, and it never clears or edits a row.
 */
function appendRosterLog_(entries) {
  if (!entries.length) return 0;
  var sheet = rosterNeedTab_(SS.ROSTER_LOG);
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0]);
  var width = sheet.getLastColumn(), stamp = rosterStamp_(), user = activeEmail_();
  var rows = entries.map(function (e) {
    if (ROSTER_LOG_SOURCES.indexOf(e.source) < 0) throw new Error('Unknown roster log source: ' + e.source);
    var arr = [];
    for (var c = 0; c < width; c++) arr.push('');
    var put = function (h, v) { var c2 = at[rosterHeaderKey_(h)]; if (c2) arr[c2 - 1] = v; };
    put('Timestamp', stamp); put('User', user); put('Display Name', e.name); put('Field', e.field);
    put('Old', e.old == null ? '' : String(e.old)); put('New', e.now == null ? '' : String(e.now));
    put('Reason', e.reason || ''); put('Source', e.source);
    return arr;
  });
  var first = Math.max(sheet.getLastRow() + 1, ROSTER_LOG_DATA_START);
  ensureRows_(sheet, first + rows.length);
  sheet.getRange(first, 1, rows.length, width).setValues(rows);
  return rows.length;
}

/* ───────── Staff Code: first-set lock and correction ───────── */

/**
 * Lock every hand-entered code that is not yet locked: copy it to the hidden
 * `Staff Code (Locked)` column and log "First set". Refuses (and reports) a
 * name-match-only row, which never holds a code, and a code another row
 * already holds outside a rename chain. Never edits the Staff Code cell.
 * Returns { locked: [names], refused: [text] }.
 */
function lockNewStaffCodes_() {
  return withRosterLock_(function () {
    var sheet = sheet_(SS.ROSTER);
    if (!sheet) return { locked: [], refused: [] };
    var state = readRosterRows_(), settings = readRosterSettings_();
    var conflicts = rosterCodeConflicts_(state.rows), re = staffCodeRegex_(settings);
    var edits = {}, log = [], locked = [], refused = [], nameCount = rosterNameCounts_(state.rows);
    state.rows.forEach(function (r) {
      if (!r.name || r.locked || !r.staffCode) return;
      if (nameCount[r.name] > 1) { refused.push(r.name + ': more than one row has this Display Name'); return; }
      var info = rosterCategoryInfo_(settings, r.category);
      if (info.nameOnly) { refused.push(r.name + ': ' + r.category + ' never has a Staff Code'); return; }
      var c = conflicts[r.staffCode];
      if (c && !c.ok) { refused.push(r.name + ': ' + r.staffCode + ' is already held by another row'); return; }
      edits[r.row] = r.staffCode;
      locked.push(r.name);
      log.push({ name: r.name, field: 'Staff Code', old: '', now: r.staffCode, source: 'First set',
                 reason: 'Hand entry' + (re.test(r.staffCode) ? '' : ' (does not match the Staff Code pattern)') });
    });
    if (locked.length) {
      rosterRequireReady_(state.cols, ['Display Name', 'Staff Code', 'Staff Code (Locked)'], 'locked');   // validate, then
      appendRosterLog_(log);                                                                              // log first,
      rosterColumnUpdate_(sheet, state.cols['Staff Code (Locked)'], ROSTER_DATA_START, edits);            // then write
    }
    clearRosterCache_();
    return { locked: locked, refused: refused };
  });
}

/**
 * Change a Staff Code that is already set. Updates the code and its locked
 * copy together and logs it. It never rewrites codes already written into
 * the Register or the non-teaching tab (PRD D3).
 * Returns { ok, error?, warning? }.
 */
function correctStaffCode_(displayName, newCode, reason) {
  return withRosterLock_(function () {
    var sheet = rosterNeedTab_(SS.ROSTER);
    var state = readRosterRows_(), settings = readRosterSettings_();
    var name = norm_(displayName);
    var row = null, matches = state.rows.filter(function (r) { return r.name === name; });
    if (matches.length > 1) return { ok: false, error: 'More than one row has the Display Name "' + name + '". Make the names unique first (🧪 Check roster lists them).' };
    row = matches[0] || null;
    if (!row) return { ok: false, error: 'No roster row has the Display Name "' + name + '". Spell it exactly as on 🪪 Teachers.' };
    var info = rosterCategoryInfo_(settings, row.category);
    if (info.nameOnly) return { ok: false, error: row.name + ' is a ' + row.category + ': that category never has a Staff Code.' };
    var code = rosterCode_(newCode, settings.placeholders);
    if (!code) return { ok: false, error: 'Enter a real Staff Code (a blank or a placeholder such as N/A is not one).' };
    if (!norm_(reason)) return { ok: false, error: 'Give a reason; it is written to 🪪 Roster Log.' };
    if (code === row.locked && code === row.staffCode) return { ok: false, error: row.name + ' already has ' + code + '.' };
    var free = rosterCodeAvailable_(state.rows, row, code);
    if (!free.ok) {
      return { ok: false, error: code + ' already belongs to ' + free.with.join(', ') +
        '. A code is never reused, except through a Replaced By rename chain (old row inactive).' };
    }
    var warn = staffCodeRegex_(settings).test(code) ? '' : code + ' does not match the Staff Code pattern on 🧭 Roster Settings.';
    var edits = {}; edits[row.row] = code;
    try { rosterRequireReady_(state.cols, ['Display Name', 'Staff Code', 'Staff Code (Locked)'], 'corrected'); }
    catch (e) { return { ok: false, error: e.message }; }       // validated before the first write
    appendRosterLog_([{ name: row.name, field: 'Staff Code', old: row.locked || row.staffCode, now: code,
                        reason: norm_(reason) + (warn ? ' [pattern warning]' : ''), source: 'Correction' }]);
    rosterColumnUpdate_(sheet, state.cols['Staff Code'], ROSTER_DATA_START, edits);
    rosterColumnUpdate_(sheet, state.cols['Staff Code (Locked)'], ROSTER_DATA_START, edits);
    clearRosterCache_();
    return { ok: true, warning: warn };
  });
}

/** Installable onEdit hook for the roster tabs (called from onEditInstallable). */
function rosterOnEdit_(e) {
  clearRosterCache_();
  var sheet = e && e.range ? e.range.getSheet() : null;
  if (!sheet) return;
  var name = sheet.getName();
  if (name === SS.ROSTER) {
    var res = lockNewStaffCodes_();
    if (res.refused.length) toast_(res.refused.join(' · '), '🪪 Staff Code not locked', 10);
  }
  // The Non-Teaching Teacher dropdown follows roster and category edits (R23).
  if (name === SS.ROSTER || name === SS.ROSTER_SETTINGS) {
    try { refreshNonTeachingTeacherList_(); } catch (err) { Logger.log('non-teaching list: ' + err.message); }
  }
}

/** The editor's email from an onEdit event, or '' when Sheets does not identify them. */
function nonTeachingUserEmail_(e) {
  try {
    var u = e && e.user;
    if (!u) return '';
    return norm_(typeof u === 'string' ? u : (typeof u.getEmail === 'function' ? u.getEmail() : u.email)).toLowerCase();
  } catch (err) { return ''; }
}

/**
 * onEdit for 🗓️ Non-Teaching Absence (PRD D5, D6, R24). Reads the roster only;
 * never calls the engine. One batched write per edit.
 *
 * Teacher column edited (single cell, paste, drag-fill or clear):
 *   Staff Code, Category and Staff Email are DERIVED from Teacher, so they are
 *   overwritten every time with the roster's values (locked code; confirmed
 *   email only) and left blank when the name is cleared, ambiguous or
 *   name-only. A join key can therefore never carry over to another person.
 *   A typed name that is not on the roster is skipped entirely: its keys are
 *   blanked, and no Timestamp or Marked By is written (amber rule keeps it visible).
 *   Timestamp and Marked By (e.user) fill only when blank; an unknown editor
 *   leaves Marked By blank (amber) with a toast.
 * Date column edited: a Date object or serial (paste) is rewritten as
 *   yyyy-MM-dd text in Asia/Kolkata, because One Way matches the Date as text.
 * Returns { rows, filled, unknownEditor } (for tests).
 */
function nonTeachingOnEdit_(e) {
  var out = { rows: 0, filled: 0, unknownEditor: false };
  if (!e || !e.range) return out;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SS.NON_TEACHING || sheet.getLastColumn() < 1) return out;
  var lastCol = sheet.getLastColumn();
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, lastCol).getValues()[0]);
  var col = function (h) { return at[rosterHeaderKey_(h)] || 0; };
  var tc = col('Teacher'), dc = col('Date');
  var r1 = e.range.getRow(), c1 = e.range.getColumn();
  var nr = typeof e.range.getNumRows === 'function' ? e.range.getNumRows() : 1;
  var nc = typeof e.range.getNumColumns === 'function' ? e.range.getNumColumns() : 1;
  var inEdit = function (c) { return c && c >= c1 && c <= c1 + nc - 1; };
  var doTeacher = inEdit(tc), doDate = inEdit(dc);
  if (!doTeacher && !doDate) return out;
  var first = Math.max(r1, NON_TEACHING_DATA_START), last = r1 + nr - 1;
  if (last < first) return out;
  var count = last - first + 1;

  var derived = ['Staff Code', 'Category', 'Staff Email'], stamped = ['Timestamp', 'Marked By'];
  var want = (doTeacher ? derived.concat(stamped) : []).concat(doDate ? ['Date'] : []);
  var cols = {}, lo = 0, hi = 0;
  want.forEach(function (h) {
    cols[h] = col(h);
    if (!cols[h]) return;
    lo = lo ? Math.min(lo, cols[h]) : cols[h];
    hi = Math.max(hi, cols[h]);
  });
  if (!lo) return out;

  var span = sheet.getRange(first, lo, count, hi - lo + 1);
  var vals = span.getValues();
  var forms = typeof span.getFormulas === 'function' ? span.getFormulas() : null;
  var teachers = doTeacher ? sheet.getRange(first, tc, count, 1).getValues() : null;
  var who = nonTeachingUserEmail_(e), stamp = rosterStamp_();
  var changed = false;
  var setCell = function (i, h, v) {
    if (!cols[h]) return;
    var j = cols[h] - lo;
    if (norm_(vals[i][j]) !== norm_(v) || (forms && forms[i][j])) { vals[i][j] = v; if (forms) forms[i][j] = ''; changed = true; out.filled++; }
  };
  var fillBlank = function (i, h, v) {
    if (!cols[h] || v === '') return;
    var j = cols[h] - lo;
    if (norm_(vals[i][j]) === '' && !(forms && forms[i][j])) { vals[i][j] = v; changed = true; out.filled++; }
  };

  for (var i = 0; i < count; i++) {
    if (doDate && cols['Date']) {
      var d = vals[i][cols['Date'] - lo];
      if (d instanceof Date && !isNaN(d.getTime())) { vals[i][cols['Date'] - lo] = Utilities.formatDate(d, ROSTER_TZ, 'yyyy-MM-dd'); changed = true; }
    }
    if (!doTeacher) continue;
    var teacher = norm_(teachers[i][0]);
    var keys = teacher ? rosterJoinKeys_(teacher) : null;
    var found = !!(keys && keys.found);
    var usable = found && !keys.ambiguous;
    derived.forEach(function (h) {
      var v = '';
      if (usable) v = h === 'Staff Code' ? keys.staffCode : h === 'Category' ? keys.category : keys.staffEmail;
      setCell(i, h, v);
    });
    if (!found) continue;   // blank or unknown name: no stamp, no Marked By
    out.rows++;
    fillBlank(i, 'Timestamp', stamp);
    if (cols['Marked By'] && norm_(vals[i][cols['Marked By'] - lo]) === '' && !(forms && forms[i][cols['Marked By'] - lo])) {
      if (who) fillBlank(i, 'Marked By', who); else out.unknownEditor = true;
    }
  }
  if (changed) span.setValues(vals.map(function (r, i) {
    return r.map(function (v, j) { return forms && forms[i][j] ? forms[i][j] : v; });
  }));
  if (out.unknownEditor) {
    try { toast_('Marked By could not be identified. Type your email in the amber cell.', '🗓️ Non-Teaching Absence', 8); } catch (err) { /* advisory only */ }
  }
  return out;
}

/* ───────── Allotment sync (PRD D1, D2, §6.4) ───────── */

/** Case-, spacing- and punctuation-insensitive key, for spotting an edited name. */
function rosterLooseKey_(s) {
  return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Pure. Compare the Allotment with the roster.
 *   input { names: [Allotment teachers], meta: {name: {department, team}},
 *           rows: roster rows, settings, directory: {ok, emails} | null }
 * Returns { changes: [{name, change, evidence, proposed, decision}], counts }.
 *
 *   Add                         Allotment name with no roster row      -> Apply
 *   Not in Allotment            Active Teaching row gone from Allotment -> Apply (Active = FALSE)
 *   Probable edited Display Name  a Teaching row that is the Allotment name, misspelt -> report only
 *   Email not in directory      row still in the Allotment             -> information only
 *
 * The email signal never proposes a deactivation on its own (R3).
 */
function planRosterSync_(input) {
  var names = input.names || [];
  if (!names.length) throw new Error('The Allotment returned no teachers, so nothing can be compared. Check the source connection.');
  var settings = input.settings, rows = input.rows;
  var dir = input.directory && input.directory.ok ? input.directory.emails : null;
  var allot = {};
  names.forEach(function (n) { allot[n] = true; });
  var byName = {};
  rows.forEach(function (r) { if (r.name && !byName[r.name]) byName[r.name] = r; });

  var loose = {};   // loose key -> Allotment name that has no exact roster row
  names.forEach(function (n) { if (!byName[n]) loose[rosterLooseKey_(n)] = n; });

  var consumed = {}, changes = [];
  var teachingRows = rows.filter(function (r) { return r.name && rosterCategoryInfo_(settings, r.category).teaching; });

  var deact = [], edited = [], infoRows = [];
  teachingRows.forEach(function (r) {
    var emailGone = !!(dir && r.email && !dir[r.email]);
    if (allot[r.name]) {
      if (r.active && emailGone) {
        infoRows.push({ name: r.name, change: 'Email not in directory',
          evidence: 'Still in the Allotment, but ' + r.email + ' is not in 👥 importHR. Check the account; nothing is proposed.',
          proposed: 'No change', decision: '—' });
      }
      return;
    }
    var twin = loose[rosterLooseKey_(r.name)];
    if (twin && twin !== r.name) {
      consumed[twin] = true;
      edited.push({ name: r.name, change: 'Probable edited Display Name',
        evidence: 'The Allotment spells this person "' + twin + '". Display Name must match it exactly.',
        proposed: 'No change; fix by hand', decision: '—' });
      return;
    }
    if (r.active) {
      deact.push({ name: r.name, change: 'Not in Allotment',
        evidence: 'No longer in the Allotment' + (emailGone ? ' · email not in directory (supporting evidence only)' : ''),
        proposed: 'Active = FALSE', decision: 'Apply' });
    }
  });

  var adds = [];
  names.forEach(function (n) {
    if (byName[n] || consumed[n]) return;
    var m = (input.meta && input.meta[n]) || {};
    adds.push({ name: n, change: 'Add',
      evidence: 'In the Allotment, not on the roster' + (m.department || m.team ? ' (' + [m.department, m.team].filter(String).join(' · ') + ')' : ''),
      proposed: 'New Teaching row', decision: 'Apply' });
  });

  var unavailable = [];
  if (input.directory && !input.directory.ok && input.directory.reason) {
    unavailable.push({ name: '(👥 importHR)', change: 'Email evidence unavailable',
      evidence: input.directory.reason + ', so no "email not in directory" signal was checked.',
      proposed: 'No change', decision: '—' });
  }
  changes = adds.concat(deact, edited, infoRows, unavailable);
  return { changes: changes, counts: { add: adds.length, deactivate: deact.length, edited: edited.length, emailInfo: infoRows.length,
                                       evidenceUnavailable: unavailable.length } };
}

/**
 * { ok, emails: {address: true}, reason? } read from 👥 importHR by header name
 * (one read). Header name only, never a configured column position: if the
 * Email header is missing the evidence is unavailable (ok = false, with a reason).
 */
function readImportHrEmails_() {
  var sheet = sheet_(SS.IMPORT_HR);
  if (!sheet || sheet.getLastRow() < 3) return { ok: false, emails: {}, reason: '👥 importHR is missing or empty' };
  var lastCol = Math.max(1, sheet.getLastColumn());
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, lastCol).getValues()[0]);
  var col = at[rosterHeaderKey_('Email')] || 0;
  if (!col) return { ok: false, emails: {}, reason: '👥 importHR has no "Email" header in row 2' };
  var vals = sheet.getRange(3, col, sheet.getLastRow() - 2, 1).getValues();
  var emails = {};
  vals.forEach(function (v) { var e = norm_(v[0]).toLowerCase(); if (e) emails[e] = true; });
  return { ok: true, emails: emails };
}

/** The Allotment teachers and their department/team, freshly read. Throws a friendly error. */
function readAllotmentForRoster_() {
  clearCache();
  var names = getAllTeachers();
  if (!names.length) throw new Error('The Allotment returned no teachers. Check the source connection.');
  return { names: names, meta: getTeacherMeta() };
}

function rosterSyncInput_() {
  var state = readRosterRows_();
  if (!state.exists) throw new Error('The ' + SS.ROSTER + ' tab is missing. Run 🔧 Upgrade tabs (safe) first.');
  var allot = readAllotmentForRoster_();
  return { state: state, input: { names: allot.names, meta: allot.meta, rows: state.rows,
           settings: readRosterSettings_(), directory: readImportHrEmails_() } };
}

/** Rows of 🧾 Sync Preview as objects, found by header name. */
function readSyncPreviewRows_(sheet) {
  var lastCol = Math.max(1, sheet.getLastColumn());
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, lastCol).getValues()[0]);
  var cols = {};
  SYNC_PREVIEW_HEADERS.forEach(function (h) { cols[h] = at[rosterHeaderKey_(h)] || 0; });
  var out = { cols: cols, rows: [] };
  if (sheet.getLastRow() < SYNC_DATA_START) return out;
  var data = sheet.getRange(SYNC_DATA_START, 1, sheet.getLastRow() - SYNC_DATA_START + 1, lastCol).getValues();
  data.forEach(function (r, i) {
    var g = function (h) { return cols[h] ? norm_(r[cols[h] - 1]) : ''; };
    if (!g('Display Name')) return;
    out.rows.push({ row: SYNC_DATA_START + i, name: g('Display Name'), change: g('Change'),
                    decision: g('Decision'), result: g('Result') });
  });
  return out;
}

/** Compare and write the answer to 🧾 Sync Preview. Writes nothing else. Returns the plan. */
function previewRosterSync_() {
  var sheet = rosterNeedTab_(SS.SYNC_PREVIEW);
  var ctx = rosterSyncInput_();
  var plan = planRosterSync_(ctx.input);

  var old = readSyncPreviewRows_(sheet), cols = old.cols;
  if (!cols['Display Name'] || !cols['Decision']) throw new Error(SS.SYNC_PREVIEW + ' is missing its Display Name or Decision header.');
  var kept = {};
  old.rows.forEach(function (p) { if (p.decision && !p.result) kept[p.change + '|' + p.name] = p.decision; });

  var width = sheet.getLastColumn();
  if (sheet.getLastRow() >= SYNC_DATA_START) {
    sheet.getRange(SYNC_DATA_START, 1, sheet.getLastRow() - SYNC_DATA_START + 1, width).clearContent();
  }
  if (plan.changes.length) {
    ensureRows_(sheet, SYNC_DATA_START + plan.changes.length);
    var rows = plan.changes.map(function (c) {
      var arr = [];
      for (var i = 0; i < width; i++) arr.push('');
      var put = function (h, v) { if (cols[h]) arr[cols[h] - 1] = v; };
      put('Display Name', c.name); put('Change', c.change); put('Evidence', c.evidence);
      put('Proposed', c.proposed);
      put('Decision', c.decision === 'Apply' && kept[c.change + '|' + c.name] ? kept[c.change + '|' + c.name] : c.decision);
      return arr;
    });
    sheet.getRange(SYNC_DATA_START, 1, rows.length, width).setValues(rows);
  }
  titleBand_(sheet, '🧾 Sync Preview — Data as of ' + rosterClock_(), SYNC_PREVIEW_HEADERS.length);
  try { sheet.showSheet(); ss_().setActiveSheet(sheet); } catch (e) { /* cosmetic */ }
  return plan;
}

/**
 * Apply the rows of 🧾 Sync Preview that are still set to Apply.
 *   - appends a row for each accepted Add (never edits or deletes a row);
 *   - sets Active = FALSE on each accepted Not in Allotment row, and nowhere else;
 *   - refreshes In Allotment, and Department/Team on Teaching rows still in the Allotment;
 *   - logs every change, records each outcome in the Result column.
 * Re-validates against the live data, and a row with a Result is never run again,
 * so a second run changes nothing.
 * Returns { added, deactivated, refreshed, skipped }.
 */
function applyRosterSync_() {
  return withRosterLock_(function () {
    var roster = rosterNeedTab_(SS.ROSTER), preview = rosterNeedTab_(SS.SYNC_PREVIEW);
    rosterNeedTab_(SS.ROSTER_LOG);
    var ctx = rosterSyncInput_(), state = ctx.state, settings = ctx.input.settings;
    var plan = planRosterSync_(ctx.input);
    var pv = readSyncPreviewRows_(preview);
    if (!pv.rows.length) throw new Error('Nothing to apply. Run 🪪 Roster → Preview sync first.');

    var planIdx = {};
    plan.changes.forEach(function (c) { planIdx[c.change + '|' + c.name] = c; });
    var adds = [], deacts = [], results = {}, skipped = 0;
    pv.rows.forEach(function (p) {
      if (p.result) return;                       // settled by an earlier run
      if (p.decision === 'Skip') { results[p.row] = 'Skipped by you'; skipped++; return; }
      if (p.decision !== 'Apply') return;
      var cur = planIdx[p.change + '|' + p.name];
      if (!cur) { results[p.row] = 'Skipped: no longer needed'; skipped++; return; }
      if (cur.change === 'Add') { adds.push(cur); results[p.row] = 'Added'; }
      else if (cur.change === 'Not in Allotment') { deacts.push(cur); results[p.row] = 'Active set to FALSE'; }
      else { results[p.row] = 'Information only; nothing applied'; }
    });

    var today = isoDate_(new Date());
    var log = [], byName = {}, nameCount = rosterNameCounts_(state.rows);
    state.rows.forEach(function (r) { if (r.name && !byName[r.name]) byName[r.name] = r; });

    // PREPARE everything first: nothing is written until every edit, log entry and
    // header it needs is known to be good, so a failure can never leave a half-applied sync.
    // 1. accepted deactivations: the only place Active is written
    var activeEdits = {};
    deacts = deacts.filter(function (c) {
      if (nameCount[c.name] > 1) {   // a duplicate Display Name is ambiguous: never guess which row
        pv.rows.forEach(function (p) { if (p.change === c.change && p.name === c.name && results[p.row]) results[p.row] = 'Skipped: duplicate Display Name'; });
        skipped++;
        return false;
      }
      return true;
    });
    deacts.forEach(function (c) {
      activeEdits[byName[c.name].row] = false;
      log.push({ name: c.name, field: 'Active', old: 'TRUE', now: 'FALSE', source: 'Sync',
                 reason: c.evidence + ' (applied ' + today + ')' });
    });

    // 2. derived columns, refreshed on every apply
    var allot = {};
    ctx.input.names.forEach(function (n) { allot[n] = true; });
    var edits = { 'In Allotment': {}, 'Department': {}, 'Team': {} }, refreshed = 0;
    state.rows.forEach(function (r) {
      if (!r.name) return;
      var teaching = rosterCategoryInfo_(settings, r.category).teaching;
      var want = teaching ? !!allot[r.name] : '';
      var have = r.inAllotment === null ? '' : r.inAllotment;
      if (String(want) !== String(have)) {
        edits['In Allotment'][r.row] = want; refreshed++;
        log.push({ name: r.name, field: 'In Allotment', old: have, now: want, source: 'Sync', reason: 'Derived from the Allotment' });
      }
      if (teaching && allot[r.name]) {
        var m = ctx.input.meta[r.name] || {};
        [['Department', r.department, m.department], ['Team', r.team, m.team]].forEach(function (d) {
          var next = norm_(d[2]);
          if (next !== d[1]) {
            edits[d[0]][r.row] = next; refreshed++;
            log.push({ name: r.name, field: d[0], old: d[1], now: next, source: 'Sync', reason: 'Mirrors the Allotment' });
          }
        });
      }
    });

    // 3. accepted additions
    var teachingCat = '';
    settings.categories.forEach(function (c) { if (c.teaching && !teachingCat) teachingCat = c.name; });
    if (!teachingCat) throw new Error('Nothing was applied: Roster Settings has no teaching category (set Teaching? = TRUE on one row of the Categories table).');
    var newRows = adds.map(function (c) {
      var m = ctx.input.meta[c.name] || {};
      log.push({ name: c.name, field: 'Row', old: '', now: 'Added (' + teachingCat + ')', source: 'Sync',
                 reason: 'Allotment name had no roster row' });
      return { 'Display Name': c.name, 'Category': teachingCat, 'Active': true, 'Match Status': 'Unreviewed',
               'Department': norm_(m.department), 'Team': norm_(m.team), 'In Allotment': true };
    });

    // VALIDATE every header the writes need (roster, log, preview) before the first write.
    rosterRequireReady_(state.cols, ['Display Name', 'Active', 'In Allotment', 'Department', 'Team', 'Category', 'Match Status'], 'applied');
    if (!pv.cols['Result']) throw new Error('Nothing was applied. Missing header: ' + SS.SYNC_PREVIEW + ': "Result".');

    // WRITE: the audit trail first, so nothing is ever applied without a log entry.
    appendRosterLog_(log);
    if (deacts.length) rosterColumnUpdate_(roster, state.cols['Active'], ROSTER_DATA_START, activeEdits);
    ['In Allotment', 'Department', 'Team'].forEach(function (h) {
      if (Object.keys(edits[h]).length) rosterColumnUpdate_(roster, state.cols[h], ROSTER_DATA_START, edits[h]);
    });
    rosterAppendRows_(roster, state.cols, newRows);
    rosterColumnUpdate_(preview, pv.cols['Result'], SYNC_DATA_START, results);
    clearRosterCache_();
    try { refreshNonTeachingTeacherList_(); } catch (err) { Logger.log('non-teaching list: ' + err.message); }
    return { added: adds.length, deactivated: deacts.length, refreshed: refreshed, skipped: skipped };
  });
}

/* ───────── 🧪 Check roster (PRD R6) ───────── */

/**
 * Pure. Every finding is { level: 'error' | 'warn' | 'info', kind, name, row, text }.
 * Join-key aware: a name-match-only category (Resource Person) is never
 * reported as missing a code or email, and a Support Staff row with no email
 * is not an error. Nothing is written.
 *
 *   input { rows, settings, allotment: [names] | null, directory: {ok, emails} | null,
 *           loggedAdds: {name: true} | null, contacts?: readImportHrContacts_() result }
 * With `contacts`, a Confirmed roster email that differs from the email of the
 * same person's exact-name 👥 importHR account is a 'contact-change' warning (information only).
 */
function computeRosterCheck_(input) {
  var rows = input.rows, S = input.settings, F = [];
  var add = function (level, kind, r, text) {
    F.push({ level: level, kind: kind, name: r ? r.name : '', row: r ? r.row : 0, text: text });
  };
  var where = function (r) { return 'Row ' + r.row + ' (' + (r.name || 'no name') + ')'; };
  var allot = input.allotment ? {} : null;
  if (allot) input.allotment.forEach(function (n) { allot[n] = true; });
  var dir = input.directory && input.directory.ok ? input.directory.emails : null;
  var re = staffCodeRegex_(S), ph = S.placeholders;

  S.problems.forEach(function (p) { add('error', 'settings', null, p); });
  S.ignoredHrFields.forEach(function (f) {
    add('warn', 'hr-field-ignored', null, '🧭 Roster Settings lists the HR field "' + f + '", which is not on the whitelist. It is ignored.');
  });

  // categories table
  var teachingCats = S.categories.filter(function (c) { return c.teaching; });
  if (teachingCats.length !== 1) {
    add('error', 'categories-teaching-count', null,
      'The Categories table must have exactly one row with Teaching? = TRUE (it has ' + teachingCats.length + ').');
  }
  var catSeen = {};
  S.categories.forEach(function (c) {
    var k = rosterHeaderKey_(c.name);
    if (catSeen[k]) add('error', 'category-duplicate', null, 'Category "' + c.name + '" is listed twice on 🧭 Roster Settings.');
    catSeen[k] = true;
  });

  var conflicts = rosterCodeConflicts_(rows);
  var infoOf = {};
  rows.forEach(function (r) { infoOf[r.row] = rosterCategoryInfo_(S, r.category); });

  // Display Name uniqueness: a name-match-only person's name is their only key
  var byName = {};
  rows.forEach(function (r) { if (r.name) (byName[r.name] = byName[r.name] || []).push(r); });
  for (var nm in byName) {
    var list = byName[nm];
    if (list.length < 2) continue;
    var hasNameOnly = list.some(function (r) { return infoOf[r.row].nameOnly; });
    add('error', hasNameOnly ? 'name-duplicate-resource' : 'name-duplicate', list[1],
      '"' + nm + '" is the Display Name of ' + list.length + ' rows (' + list.map(function (r) { return r.row; }).join(', ') + ')' +
      (hasNameOnly ? '. A Resource Person is matched on name alone, so the name must be unique: give one a distinguishing Display Name.' : '. Display Names must be unique.'));
  }

  var reported = {};
  rows.forEach(function (r) {
    var info = infoOf[r.row];
    if (!r.name) { add('warn', 'no-name', r, where(r) + ' has data but no Display Name.'); return; }
    if (!info.known) {
      add('error', 'category-unknown', r, where(r) + ': Category "' + r.category + '" is not in the Categories table' + (r.category ? '.' : ' (blank).'));
    }
    if (r.staffCodeRaw && isPlaceholder_(r.staffCodeRaw, ph)) {
      add('warn', 'code-placeholder', r, where(r) + ': "' + r.staffCodeRaw + '" in Staff Code is a placeholder and is treated as blank.');
    }
    if (r.emailRaw && isPlaceholder_(r.emailRaw, ph)) {
      add('warn', 'email-placeholder', r, where(r) + ': "' + r.emailRaw + '" in Email is a placeholder and is treated as blank.');
    }

    if (info.nameOnly) {
      if (r.staffCode || r.locked) {
        add('error', 'nameonly-code', r, where(r) + ': a ' + r.category + ' never has a Staff Code, but this row holds one. It is never used.');
      }
      if (r.email) add('error', 'nameonly-email', r, where(r) + ': a ' + r.category + ' has no email, but this row holds one.');
    } else {
      var state = rosterCodeState_(r, info, conflicts);
      if (state === 'missing' && r.active) {
        add('warn', 'code-missing', r, where(r) + ': no Staff Code (category ' + (r.category || 'blank') + ').');
      }
      if (state === 'unlocked') {
        add('warn', 'code-unlocked', r, where(r) + ': Staff Code ' + r.staffCode + ' is not locked yet, so it is not written to any absence row.');
      }
      if (state === 'changed') {
        add('error', 'code-changed', r, where(r) + ': Staff Code changed without a correction (locked ' + r.locked + ', now ' + (r.staffCode || 'blank') +
          '). Restore it, or use 🪪 Roster → Correct Staff Code…');
      }
      var codes = r.staffCode ? [r.staffCode] : [];
      if (r.locked && r.locked !== r.staffCode) codes.push(r.locked);
      codes.forEach(function (code) {
        var c = conflicts[code];
        if (c && !c.ok && !reported[code]) {
          reported[code] = true;
          add('warn', 'code-duplicate', r, 'Staff Code ' + code + ' is held by more than one person, outside a Replaced By rename chain: ' +
            c.rows.map(function (x) { return x.name + ' (row ' + x.row + ')'; }).join(', ') + '.');
        }
      });
      if (r.staffCode && !re.test(r.staffCode)) {
        add('warn', 'code-pattern', r, where(r) + ': Staff Code ' + r.staffCode + ' does not match the pattern ' + S.hrSource.staffCodePattern + '.');
      }
      if (r.staffCode && info.codePrefix) {
        var okPrefix = csvList_(info.codePrefix).some(function (p) { return r.staffCode.indexOf(p.toUpperCase()) === 0; });
        if (!okPrefix) {
          add('warn', 'code-prefix', r, where(r) + ': Staff Code ' + r.staffCode + ' does not start with ' + info.codePrefix + ', the prefix set for ' + r.category + ' on 🧭 Roster Settings.');
        }
      }
      if (info.emailRequired && r.active && !r.email) {
        add('warn', 'email-missing', r, where(r) + ': no email, and ' + (info.known ? r.category : 'this category') + ' needs one.');
      }
    }

    if (r.replacedBy && !byName[r.replacedBy]) {
      add('warn', 'replaced-by', r, where(r) + ': Replaced By "' + r.replacedBy + '" is not a Display Name on this tab.');
    }
    if (dir && r.email && r.matchStatus !== 'Confirmed' && !dir[r.email]) {
      add('warn', 'email-unknown', r, where(r) + ': the typed email ' + r.email + ' is not in 👥 importHR.');
    }
  });

  // one email, one active person
  var byEmail = {};
  rows.forEach(function (r) { if (r.active && r.email && !infoOf[r.row].nameOnly) (byEmail[r.email] = byEmail[r.email] || []).push(r); });
  for (var em in byEmail) {
    if (byEmail[em].length > 1) {
      add('warn', 'email-duplicate', byEmail[em][1], 'The email ' + em + ' is on ' + byEmail[em].length + ' Active rows: ' +
        byEmail[em].map(function (r) { return r.name; }).join(', ') + '.');
    }
  }

  // roster against the Allotment
  var rosterLoose = {};
  rows.forEach(function (r) { if (r.name) rosterLoose[rosterLooseKey_(r.name)] = true; });
  if (allot) {
    var looseAllot = {};
    input.allotment.forEach(function (n) { if (!byName[n]) looseAllot[rosterLooseKey_(n)] = n; });
    rows.forEach(function (r) {
      if (!r.name || !infoOf[r.row].teaching || allot[r.name]) return;
      var twin = looseAllot[rosterLooseKey_(r.name)];
      if (twin) {
        add('warn', 'teaching-edited-name', r, where(r) + ': probable edited Display Name; the Allotment spells it "' + twin + '".');
      } else if (r.active) {
        add('warn', 'teaching-not-in-allotment', r, where(r) + ' is an Active Teaching row that is not in the Allotment.');
      }
    });
    var missing = input.allotment.filter(function (n) { return !byName[n] && !rosterLoose[rosterLooseKey_(n)]; });
    if (missing.length) {
      add('warn', 'allotment-missing', null, missing.length + ' Allotment teacher(s) are not on the roster: ' + missing.slice(0, 10).join(', ') +
        (missing.length > 10 ? ', and ' + (missing.length - 10) + ' more' : '') + '. Run Preview sync.');
    }
  } else {
    add('info', 'allotment-unavailable', null, 'The Allotment could not be read, so the checks against it were skipped.');
  }
  var teachingKeys = {};
  rows.forEach(function (r) { if (r.name && infoOf[r.row].teaching) teachingKeys[rosterLooseKey_(r.name)] = true; });
  if (allot) input.allotment.forEach(function (n) { teachingKeys[rosterLooseKey_(n)] = true; });
  rows.forEach(function (r) {
    if (!r.name || infoOf[r.row].teaching) return;
    if (teachingKeys[rosterLooseKey_(r.name)]) {
      add('error', 'nonteaching-collision', r, where(r) + ': a non-teaching name that collides with a Teaching name.');
    }
  });
  if (input.loggedAdds) {
    rows.forEach(function (r) {
      if (r.name && infoOf[r.row].teaching && !input.loggedAdds[r.name]) {
        add('warn', 'teaching-hand-added', r, where(r) + ' is a Teaching row that sync did not add. Teaching rows come only from the Allotment.');
      }
    });
  }
  if (input.contacts && input.contacts.usedFallback) {
    add('warn', 'importhr-column-fallback', null, input.contacts.fallbackReason);
  }
  if (input.contacts && input.contacts.ok) {
    rosterContactChanges_(rows, input.contacts, S, infoOf).forEach(function (c) {
      add('warn', 'contact-change', c.row, 'Contact change: ' + c.row.name + ' has ' + c.rosterEmail + ' on the roster but ' + c.hrEmail +
        ' in 👥 importHR. Notifications use the roster email. Information only.');
    });
  }
  return { findings: F, counts: {
    error: F.filter(function (f) { return f.level === 'error'; }).length,
    warn: F.filter(function (f) { return f.level === 'warn'; }).length,
    info: F.filter(function (f) { return f.level === 'info'; }).length,
  } };
}

/**
 * Pure. [{ row, rosterEmail, hrEmail }] for Active, non-name-only roster rows whose
 * Confirmed email differs from the email of the single exact-name, non-excluded
 * 👥 importHR account. Duplicate roster names are skipped (ambiguous).
 */
function rosterContactChanges_(rows, hr, S, infoOf) {
  var counts = rosterNameCounts_(rows), out = [];
  rows.forEach(function (r) {
    if (!r.name || counts[r.name] > 1 || !r.active || r.matchStatus !== 'Confirmed' || !r.email) return;
    if (infoOf[r.row].nameOnly) return;
    var m = hrNameMatch_(hr, r.name, S);
    if (m.rec && m.rec.email && m.rec.email !== r.email) out.push({ row: r, rosterEmail: r.email, hrEmail: m.rec.email });
  });
  return out;
}

/** { name: true } for every Teaching row sync added, from 🪪 Roster Log; null when unreadable. */
function readRosterLoggedAdds_() {
  var sheet = sheet_(SS.ROSTER_LOG);
  if (!sheet) return null;
  var out = {};
  if (sheet.getLastRow() < ROSTER_LOG_DATA_START) return out;
  var lastCol = Math.max(1, sheet.getLastColumn());
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, lastCol).getValues()[0]);
  var cName = at[rosterHeaderKey_('Display Name')], cField = at[rosterHeaderKey_('Field')], cSrc = at[rosterHeaderKey_('Source')];
  if (!cName || !cField || !cSrc) return null;
  sheet.getRange(ROSTER_LOG_DATA_START, 1, sheet.getLastRow() - ROSTER_LOG_DATA_START + 1, lastCol).getValues()
    .forEach(function (r) { if (norm_(r[cField - 1]) === 'Row' && norm_(r[cSrc - 1]) === 'Sync') out[norm_(r[cName - 1])] = true; });
  return out;
}

/* ───────── menu entry points (each guarded: N5) ───────── */

/** Run a menu action; on failure tell the user plainly and ping Ops with the error CLASS only. */
function rosterRun_(label, fn) {
  try { return fn(); }
  catch (e) {
    notifyOpsFailure_('Roster: ' + label, (e && e.name) || 'Error');
    var ui = SpreadsheetApp.getUi();
    ui.alert('Could not ' + label, (e && e.message) || String(e), ui.ButtonSet.OK);
    return null;
  }
}

function rosterOpenTab_(name) {
  var sheet = sheet_(name);
  if (!sheet) { toast_('Run 🔧 Upgrade tabs (safe) first.', '⚠️'); return; }
  try { sheet.showSheet(); } catch (e) { /* already visible */ }
  ss_().setActiveSheet(sheet);
}
function openRosterTab() { rosterOpenTab_(SS.ROSTER); }
function openRosterSettings() { rosterOpenTab_(SS.ROSTER_SETTINGS); }
function openRosterLog() { rosterOpenTab_(SS.ROSTER_LOG); }

function previewRosterSync() {
  rosterRun_('preview the roster sync', function () {
    toast_('Comparing the Allotment with the roster…', '🪪', 10);
    var c = previewRosterSync_().counts;
    SpreadsheetApp.getUi().alert('🧾 Sync preview ready',
      'Add: ' + c.add + '\nNot in Allotment (proposed Active = FALSE): ' + c.deactivate +
      '\nProbable edited Display Name: ' + c.edited + '\nEmail not in directory (information): ' + c.emailInfo +
      '\n\nNothing has been changed on 🪪 Teachers. Review 🧾 Sync Preview, then choose Apply sync.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  });
}

function applyRosterSync() {
  rosterRun_('apply the roster sync', function () {
    var ui = SpreadsheetApp.getUi();
    var pending = readSyncPreviewRows_(rosterNeedTab_(SS.SYNC_PREVIEW)).rows.filter(function (p) { return p.decision === 'Apply' && !p.result; });
    var n = function (c) { return pending.filter(function (p) { return p.change === c; }).length; };
    var go = ui.alert('Apply the roster sync?',
      'Rows set to Apply on 🧾 Sync Preview:\n  add ' + n('Add') + ' new Teaching row(s)\n  set Active = FALSE on ' + n('Not in Allotment') +
      ' row(s)\n\nNo row is edited or deleted. Every change is logged to 🪪 Roster Log.', ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) { toast_('Nothing was changed.', '✅', 5); return; }
    var res = applyRosterSync_();
    ui.alert('✅ Roster sync applied',
      'Added: ' + res.added + '\nDeactivated: ' + res.deactivated + '\nDerived cells refreshed: ' + res.refreshed +
      '\nSkipped: ' + res.skipped, ui.ButtonSet.OK);
  });
}

function correctStaffCode() {
  rosterRun_('correct a Staff Code', function () {
    var ui = SpreadsheetApp.getUi();
    var ask = function (title, text) {
      var r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
      return r.getSelectedButton() === ui.Button.OK ? r.getResponseText() : null;
    };
    var name = ask('✏️ Correct Staff Code (1 of 3)', 'Display Name, exactly as on 🪪 Teachers:');
    if (name === null) return;
    var code = ask('✏️ Correct Staff Code (2 of 3)', 'The correct Staff Code:');
    if (code === null) return;
    var why = ask('✏️ Correct Staff Code (3 of 3)', 'Reason (written to 🪪 Roster Log):');
    if (why === null) return;
    var res = correctStaffCode_(name, code, why);
    if (!res.ok) { ui.alert('Staff Code not changed', res.error, ui.ButtonSet.OK); return; }
    ui.alert('✅ Staff Code corrected',
      norm_(name) + ' now has ' + rosterCode_(code, readRosterSettings_().placeholders) + '.' + (res.warning ? '\n\n⚠️ ' + res.warning : '') +
      '\n\nCodes already written into absence rows are not changed.', ui.ButtonSet.OK);
  });
}

function checkRoster() {
  rosterRun_('check the roster', function () {
    clearRosterCache_();
    var state = readRosterRows_();
    if (!state.exists) throw new Error('The ' + SS.ROSTER + ' tab is missing. Run 🔧 Upgrade tabs (safe) first.');
    var allotment = null;
    try { allotment = readAllotmentForRoster_().names; } catch (e) { allotment = null; }
    var res = computeRosterCheck_({ rows: state.rows, settings: readRosterSettings_(), allotment: allotment,
                                    directory: readImportHrEmails_(), loggedAdds: readRosterLoggedAdds_(),
                                    contacts: readImportHrContacts_() });
    var icon = { error: '❌ ', warn: '⚠️ ', info: 'ℹ️ ' };
    var changes = res.findings.filter(function (f) { return f.kind === 'contact-change'; });
    var others = res.findings.filter(function (f) { return f.kind !== 'contact-change'; });
    var lines = others.slice(0, 40).map(function (f) { return icon[f.level] + f.text; });
    if (others.length > 40) lines.push('…and ' + (others.length - 40) + ' more.');
    if (changes.length) {
      lines.push('', '📇 Contact changes (roster email differs from 👥 importHR):');
      changes.slice(0, 20).forEach(function (f) { lines.push(icon[f.level] + f.text); });
      if (changes.length > 20) lines.push('…and ' + (changes.length - 20) + ' more.');
    }
    SpreadsheetApp.getUi().alert('🧪 Roster check',
      state.rows.length + ' roster row(s) checked.\n\n' + (lines.length ? lines.join('\n') : '✅ Nothing to report.') +
      '\n\n' + res.counts.error + ' error(s), ' + res.counts.warn + ' warning(s). Nothing was changed.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  });
}
