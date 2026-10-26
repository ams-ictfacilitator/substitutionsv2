/**
 * ============================================================
 * Backfill.gs — fill blank Staff Code / Staff Email on EVERY historical row
 * of 🗓️ Absence Register and 🗓️ Non-Teaching Absence (T-017, PRD D3, D6, D11,
 * §6.6, §6.7, §7.5 R20-R22a, §9 step 9).
 *
 *   previewStaffKeyBackfill_()   writes ONLY 🧾 Backfill Preview (derived)
 *   applyStaffKeyBackfill_()     the only code that writes the two key columns of old rows
 *   backfillRollbackInfo_()      backup reference + changed-cell count, from 🪪 Roster Log
 *
 * Data-safety rules this file lives by:
 *   - names resolve to roster rows ONLY through rosterJoinKeys_ (locked code,
 *     confirmed email); nothing is guessed, a Resource Person never gets a key;
 *   - only BLANK cells are written, and only the cell the preview named;
 *   - a row is found by (Date, Teacher, Run ID) / (Date, Teacher), never by a row
 *     number alone, and is re-checked against live data at apply;
 *   - every tab and header is validated, and a backup taken, before the first write;
 *   - progress lives in the preview's Result column, so a re-run resumes and a
 *     second full run changes nothing.
 * Never touches any other column of the register tabs.
 * ============================================================
 */

const BACKFILL_CHUNK = 2000;                         // rows per chunk (one setValues per column per chunk, R21)
const BACKFILL_BUDGET_MS = 270000;                   // stop starting chunks after 4.5 min (6-min limit)
const BACKFILL_MAX_AGE_MS = 24 * 60 * 60 * 1000;     // R21: a preview older than 24 h is refused
const BACKFILL_ACTIONS = ['Will fill', 'Already filled', 'No roster match', 'Duplicate name', 'Name only',
  'Code not locked', 'Email not confirmed', 'Conflict (differs)'];
const BACKFILL_TAB_REGISTER = 'Absence Register';
const BACKFILL_TAB_NONTEACHING = 'Non-Teaching Absence';
const BACKFILL_LOG_NAME = '(backfill)';
const BACKFILL_FORMULA_MARK = '(formula)';

/* ───────── targets and reading ───────── */

/** The two tabs the backfill covers. Run ID exists on the Register only. */
function backfillTargets_() {
  return [
    { label: BACKFILL_TAB_REGISTER, sheetName: SS.ABSENCE, dataStart: ABSENCE_DATA_START, runId: true },
    { label: BACKFILL_TAB_NONTEACHING, sheetName: SS.NON_TEACHING, dataStart: NON_TEACHING_DATA_START, runId: false },
  ];
}

function backfillTarget_(label) {
  var list = backfillTargets_();
  for (var i = 0; i < list.length; i++) if (list[i].label === label) return list[i];
  return null;
}

/** Row identity: (Date, Teacher, Run ID) on the Register, (Date, Teacher) on the non-teaching tab. */
function backfillIdentity_(spec, date, teacher, runId) {
  return [date, teacher].concat(spec.runId ? [runId] : []).join('\u0001');
}

/**
 * Read one target tab in full (every row, header-name columns). Throws, naming the
 * header, if the tab or a needed header is missing: nothing may be previewed or
 * written against a layout we cannot read.
 */
function backfillReadTarget_(spec) {
  var sheet = sheet_(spec.sheetName);
  if (!sheet) throw new Error('The ' + spec.sheetName + ' tab is missing. Run 🔧 Upgrade tabs (safe) first.');
  var layout = absenceRegisterLayout_(sheet);
  var need = ['Date', 'Teacher', 'Staff Code', 'Staff Email'].concat(spec.runId ? ['Run ID'] : []);
  var missing = need.filter(function (h) { return absenceHeaderIndex_(layout.map, h) < 0; });
  if (missing.length) {
    throw new Error('Nothing was changed. ' + spec.sheetName + ' is missing header(s): ' + missing.join(', ') +
      '. Run 🔧 Upgrade tabs (safe) to add the join-key columns.');
  }
  var col = {
    date: absenceHeaderIndex_(layout.map, 'Date'), teacher: absenceHeaderIndex_(layout.map, 'Teacher'),
    runId: spec.runId ? absenceHeaderIndex_(layout.map, 'Run ID') : -1,
    code: absenceHeaderIndex_(layout.map, 'Staff Code'), email: absenceHeaderIndex_(layout.map, 'Staff Email'),
  };
  var t = { spec: spec, sheet: sheet, col: col, n: 0, data: [], fx: { code: [], email: [] }, rows: [], byId: {} };
  var last = sheet.getLastRow();
  if (last < spec.dataStart) return t;
  t.n = last - spec.dataStart + 1;
  t.data = sheet.getRange(spec.dataStart, 1, t.n, layout.width).getValues();
  ['code', 'email'].forEach(function (k) {
    t.fx[k] = sheet.getRange(spec.dataStart, col[k] + 1, t.n, 1).getFormulas().map(function (r) { return !!r[0]; });
  });
  for (var i = 0; i < t.data.length; i++) {
    var r = t.data[i];
    var date = normDateCell_(r[col.date]), teacher = norm_(r[col.teacher]);
    if (!date && !teacher) continue;                   // not a record
    var runId = col.runId >= 0 ? norm_(r[col.runId]) : '';
    var o = { row: spec.dataStart + i, i: i, date: date, teacher: teacher, runId: runId,
      code: norm_(r[col.code]) || (t.fx.code[i] ? BACKFILL_FORMULA_MARK : ''),
      email: norm_(r[col.email]) || (t.fx.email[i] ? BACKFILL_FORMULA_MARK : '') };
    var id = backfillIdentity_(spec, date, teacher, runId);
    (t.byId[id] = t.byId[id] || []).push(o);
    t.rows.push(o);
  }
  return t;
}

/* ───────── classification (pure) ───────── */

/**
 * Decide each key column for one row, given the roster keys for its Teacher.
 * Returns { action, codeAction, emailAction, proposedCode, proposedEmail }.
 * A non-blank cell is never a candidate for writing.
 */
function backfillClassify_(row, k) {
  var propCode = k.found && !k.nameOnly ? norm_(k.staffCode).toUpperCase() : '';
  var propEmail = k.found && !k.nameOnly ? norm_(k.staffEmail).toLowerCase() : '';
  var column = function (cur, prop, same, unresolved) {
    if (cur !== '') return prop && !same(cur, prop) ? 'Conflict (differs)' : 'Already filled';
    if (!k.found) return 'No roster match';
    if (k.ambiguous || k.codeState === 'duplicate name') return 'Duplicate name';
    if (k.nameOnly) return 'Name only';
    return prop ? 'Will fill' : unresolved;
  };
  var codeAction = column(row.code, propCode, function (a, b) { return a.toUpperCase() === b; }, 'Code not locked');
  var emailAction = column(row.email, propEmail, function (a, b) { return a.toLowerCase() === b; }, 'Email not confirmed');
  var acts = [codeAction, emailAction], has = function (a) { return acts.indexOf(a) >= 0; };
  var action = 'Already filled';
  if (has('Will fill')) action = 'Will fill';
  else if (has('No roster match')) action = 'No roster match';
  else if (has('Duplicate name')) action = 'Duplicate name';
  else if (has('Name only')) action = 'Name only';
  else if (codeAction === 'Code not locked') action = 'Code not locked';
  else if (emailAction === 'Email not confirmed') action = 'Email not confirmed';
  else if (has('Conflict (differs)')) action = 'Conflict (differs)';
  return { action: action, codeAction: codeAction, emailAction: emailAction,
           proposedCode: codeAction === 'Will fill' ? propCode : '', proposedEmail: emailAction === 'Will fill' ? propEmail : '' };
}

/** A name -> roster keys lookup that asks rosterJoinKeys_ once per name. */
function backfillKeyLookup_() {
  var seen = {};
  return function (name) {
    if (!(name in seen)) seen[name] = rosterJoinKeys_(name);
    return seen[name];
  };
}

/** The pure scan: every row of every target, classified. Reads the roster fresh. */
function backfillScan_() {
  clearRosterCache_(); clearCache();
  var roster = getRoster_();
  if (!roster || !roster.exists) throw new Error('The ' + SS.ROSTER + ' tab is missing. Run 🔧 Upgrade tabs (safe) first.');
  var tabs = backfillTargets_().map(backfillReadTarget_);   // validate every tab and header before reporting anything
  var keysOf = backfillKeyLookup_();
  var out = { entries: [], counts: {}, scanned: {}, cells: { code: 0, email: 0 } };
  BACKFILL_ACTIONS.forEach(function (a) { out.counts[a] = 0; });
  tabs.forEach(function (t) {
    out.scanned[t.spec.label] = t.rows.length;
    t.rows.forEach(function (r) {
      var c = backfillClassify_(r, keysOf(r.teacher));
      out.counts[c.action]++;
      if (c.codeAction === 'Will fill') out.cells.code++;
      if (c.emailAction === 'Will fill') out.cells.email++;
      if (c.action === 'Already filled') return;       // counted, not listed: nothing to review
      out.entries.push({ tab: t.spec.label, row: r.row, date: r.date, teacher: r.teacher, runId: r.runId,
        curCode: r.code, curEmail: r.email, c: c });
    });
  });
  return out;
}

/* ───────── 🧾 Backfill Preview: tab, reading, summary ───────── */

function backfillPreviewCols_(sheet) {
  var lastCol = Math.max(1, sheet.getLastColumn());
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, lastCol).getValues()[0]);
  var cols = {}, missing = [];
  BACKFILL_PREVIEW_HEADERS.forEach(function (h) {
    cols[h] = at[rosterHeaderKey_(h)] || 0;
    if (!cols[h]) missing.push(SS.BACKFILL_PREVIEW + ': "' + h + '"');
  });
  return { cols: cols, missing: missing, width: lastCol };
}

/** Rows of 🧾 Backfill Preview as objects. Throws when a header is missing. */
function readBackfillPreview_(sheet) {
  var pc = backfillPreviewCols_(sheet);
  if (pc.missing.length) {
    throw new Error('Nothing was changed. Missing header(s): ' + pc.missing.join(', ') + '. Run 👁 Preview backfill again, or 🔧 Upgrade tabs (safe).');
  }
  var title = String(sheet.getRange(1, 1).getValue() || '');
  var m = /Data as of (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(title);
  var out = { cols: pc.cols, stamp: m ? m[1] : '', rows: [] };
  if (sheet.getLastRow() < BACKFILL_DATA_START) return out;
  var data = sheet.getRange(BACKFILL_DATA_START, 1, sheet.getLastRow() - BACKFILL_DATA_START + 1, pc.width).getValues();
  data.forEach(function (r, i) {
    var g = function (h) { return norm_(r[pc.cols[h] - 1]); };
    if (!g('Tab') && !g('Teacher')) return;
    out.rows.push({ row: BACKFILL_DATA_START + i, tab: g('Tab'), hint: Number(g('Row')) || 0,
      date: normDateCell_(r[pc.cols['Date'] - 1]), teacher: g('Teacher'), runId: g('Run ID (Register only)'),
      propCode: g('Proposed Staff Code').toUpperCase(), propEmail: g('Proposed Staff Email').toLowerCase(),
      action: g('Action'), codeAction: g('Code Action'), emailAction: g('Email Action'), result: g('Result') });
  });
  return out;
}

function backfillStampMs_(stamp) { return new Date(stamp.replace(' ', 'T') + ':00+05:30').getTime(); }

/** One-line summary for the title band: counts per class, scanned rows, cells to write. */
function backfillSummaryText_(stamp, scan, rollback) {
  var parts = [];
  BACKFILL_ACTIONS.forEach(function (a) { if (scan.counts[a]) parts.push(a + ' ' + scan.counts[a]); });
  var scanned = Object.keys(scan.scanned).map(function (k) { return k + ' ' + scan.scanned[k]; }).join(', ');
  return '🧾 Backfill Preview — Data as of ' + stamp + ' — scanned ' + scanned + ' — ' + (parts.join(' · ') || 'nothing to list') +
    ' — cells to write: Staff Code ' + scan.cells.code + ', Staff Email ' + scan.cells.email +
    (rollback ? ' — ' + backfillRollbackText_(rollback) : '');
}

function backfillRollbackText_(rb) {
  if (!rb || !rb.backupName) return 'Backfill rollback info: no apply recorded yet';
  return 'Backfill rollback info: backup "' + rb.backupName + '" (id ' + rb.backupId + '), ' + rb.cells + ' cell(s) changed since';
}

/**
 * Compare and write the answer to 🧾 Backfill Preview. Writes NOTHING else, to any tab.
 * Returns { stamp, counts, scanned, cells, listed }.
 */
function previewStaffKeyBackfill_() {
  var sheet = rosterNeedTab_(SS.BACKFILL_PREVIEW);
  var pc = backfillPreviewCols_(sheet);
  if (pc.missing.length) throw new Error('Nothing was changed. Missing header(s): ' + pc.missing.join(', ') + '. Run 🔧 Upgrade tabs (safe).');
  var scan = backfillScan_();                       // throws before the preview is touched if any tab/header is unusable
  var cols = pc.cols, width = pc.width;

  if (sheet.getLastRow() >= BACKFILL_DATA_START) {
    sheet.getRange(BACKFILL_DATA_START, 1, sheet.getLastRow() - BACKFILL_DATA_START + 1, width).clearContent();
  }
  if (scan.entries.length) {
    ensureRows_(sheet, BACKFILL_DATA_START + scan.entries.length);
    var rows = scan.entries.map(function (e) {
      var arr = [];
      for (var i = 0; i < width; i++) arr.push('');
      var put = function (h, v) { arr[cols[h] - 1] = v; };
      put('Tab', e.tab); put('Row', e.row); put('Date', e.date); put('Teacher', e.teacher);
      put('Run ID (Register only)', e.runId);
      put('Current Staff Code', e.curCode); put('Proposed Staff Code', e.c.proposedCode);
      put('Current Staff Email', e.curEmail); put('Proposed Staff Email', e.c.proposedEmail);
      put('Action', e.c.action); put('Code Action', e.c.codeAction); put('Email Action', e.c.emailAction);
      return arr;
    });
    sheet.getRange(BACKFILL_DATA_START, 1, rows.length, width).setValues(rows);
  }
  var stamp = rosterClock_();
  titleBand_(sheet, backfillSummaryText_(stamp, scan, backfillRollbackInfo_()), BACKFILL_PREVIEW_HEADERS.length);
  try { sheet.showSheet(); ss_().setActiveSheet(sheet); } catch (e) { /* cosmetic */ }
  return { stamp: stamp, counts: scan.counts, scanned: scan.scanned, cells: scan.cells, listed: scan.entries.length };
}

/* ───────── rollback info (from 🪪 Roster Log) ───────── */

/** Rows of 🪪 Roster Log written by the backfill: [{field, now, reason}], oldest first. */
function backfillLogRows_() {
  var log = sheet_(SS.ROSTER_LOG);
  if (!log || log.getLastRow() < ROSTER_LOG_DATA_START) return [];
  var width = log.getLastColumn();
  var at = rosterHeaderCols_(log.getRange(2, 1, 1, width).getValues()[0]);
  var f = at[rosterHeaderKey_('Field')], n = at[rosterHeaderKey_('New')], r = at[rosterHeaderKey_('Reason')], d = at[rosterHeaderKey_('Display Name')];
  if (!f || !n || !r || !d) return [];
  var data = log.getRange(ROSTER_LOG_DATA_START, 1, log.getLastRow() - ROSTER_LOG_DATA_START + 1, width).getValues();
  var out = [];
  data.forEach(function (row) {
    if (norm_(row[d - 1]) !== BACKFILL_LOG_NAME) return;
    out.push({ field: norm_(row[f - 1]), now: norm_(row[n - 1]), reason: norm_(row[r - 1]) });
  });
  return out;
}

/** "3-9,14,40-44" for a list of row numbers. */
function backfillRowRanges_(rows) {
  var v = rows.slice().sort(function (a, b) { return a - b; }), out = [], i = 0;
  while (i < v.length) {
    var s = v[i], e = s;
    while (i + 1 < v.length && v[i + 1] === e + 1) e = v[++i];
    out.push(s === e ? String(s) : s + '-' + e);
    i++;
  }
  return out.join(',');
}

/**
 * Backup reference and changed-cell count of the most recent backfill, from the log:
 * { backupName, backupId, stamp, cells } (backupName '' when none recorded).
 */
function backfillRollbackInfo_() {
  var rows = backfillLogRows_(), at = -1, i;
  for (i = rows.length - 1; i >= 0; i--) if (rows[i].field === 'Backfill backup') { at = i; break; }
  if (at < 0) return { backupName: '', backupId: '', stamp: '', cells: 0 };
  var idm = /id (\S+?);/.exec(rows[at].reason + ';'), pm = /preview (\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(rows[at].reason);
  var cells = 0;
  for (i = at + 1; i < rows.length; i++) {
    if (!/^Backfill cells /.test(rows[i].field)) continue;
    cells += Number((/^(\d+) cell/.exec(rows[i].now) || [0, 0])[1]);
  }
  return { backupName: rows[at].now, backupId: idm ? idm[1] : '', stamp: pm ? pm[1] : '', cells: cells };
}

/** The backup already taken for THIS preview (a resumed run must not take another), or null. */
function backfillBackupFor_(stamp) {
  var rows = backfillLogRows_();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].field === 'Backfill backup' && rows[i].reason.indexOf('preview ' + stamp) >= 0) {
      var m = /id (\S+?);/.exec(rows[i].reason + ';');
      return { name: rows[i].now, id: m ? m[1] : '' };
    }
  }
  return null;
}

/* ───────── apply ───────── */

/** Test seam: rows per chunk and "out of time" check. */
function backfillChunkSize_() { return BACKFILL_CHUNK; }
function backfillOutOfTime_(startedMs) { return Date.now() - startedMs > BACKFILL_BUDGET_MS; }

/**
 * Re-validate one chunk of preview rows against LIVE data and build the edits.
 * Pure: writes nothing. Returns
 *   { edits: { label: { code: {row: v}, email: {row: v} } }, results: {previewRow: text}, tally }.
 */
function backfillPlanChunk_(chunk, reads, keysOf, used) {
  var plan = { edits: {}, results: {}, tally: { rows: 0, refused: 0, skipped: 0, code: 0, email: 0 } };
  chunk.forEach(function (p) {
    var refuse = function (why) { plan.results[p.row] = 'Refused: ' + why; plan.tally.refused++; };
    var spec = backfillTarget_(p.tab), t = spec && reads[spec.label];
    if (!t) return refuse('unknown tab "' + p.tab + '"');
    var cand = t.byId[backfillIdentity_(spec, p.date, p.teacher, p.runId)] || [];
    if (!cand.length) return refuse('row not found (changed or deleted since the preview)');
    var live = null;
    cand.forEach(function (c) { if (c.row === p.hint) live = c; });
    if (!live && cand.length === 1) live = cand[0];    // the row moved but is still unambiguous
    if (!live) return refuse('row not unique (same Date / Teacher' + (spec.runId ? ' / Run ID' : '') + ' more than once)');
    var useKey = spec.label + '#' + live.row;
    if (used[useKey]) return refuse('row already handled by another preview line');

    var cls = backfillClassify_(live, keysOf(live.teacher));
    var want = [['code', 'Staff Code', p.codeAction === 'Will fill' ? p.propCode : '', cls.proposedCode, live.code],
                ['email', 'Staff Email', p.emailAction === 'Will fill' ? p.propEmail : '', cls.proposedEmail, live.email]]
      .filter(function (w) { return w[2]; });
    if (!want.length) return refuse('nothing to fill on the preview line');
    var todo = [], full = [];
    for (var i = 0; i < want.length; i++) {
      var w = want[i];
      if (w[4] !== '') { full.push(w[1]); continue; }  // never overwrite a non-blank cell
      if (w[3] !== w[2]) return refuse('roster changed since the preview (' + w[1] + ')');
      todo.push(w);
    }
    used[useKey] = true;
    if (!todo.length) {
      plan.results[p.row] = 'Skipped: already filled'; plan.tally.skipped++;
      return;
    }
    var e = plan.edits[spec.label] = plan.edits[spec.label] || { code: {}, email: {} };
    todo.forEach(function (w) { e[w[0]][live.row] = w[2]; plan.tally[w[0]]++; });
    plan.tally.rows++;
    plan.results[p.row] = 'Filled ' + todo.map(function (w) { return w[1]; }).join(' + ') +
      (full.length ? ' (' + full.join(' + ') + ' already filled)' : '');
  });
  return plan;
}

/**
 * Write one key column: one setValues per contiguous run of target cells. A gap
 * between two targets joins the run only when every cell in it is exactly empty
 * (no value, no formula), so no other cell is ever rewritten. Returns the calls made.
 */
function backfillWriteColumn_(t, which, edits) {
  var rows = Object.keys(edits).map(Number).sort(function (a, b) { return a - b; });
  if (!rows.length) return 0;
  var c = t.col[which], ds = t.spec.dataStart, calls = 0;
  var empty = function (row) { var i = row - ds; return i >= 0 && i < t.n && t.data[i][c] === '' && !t.fx[which][i]; };
  var i = 0;
  while (i < rows.length) {
    var start = rows[i], end = start;
    while (i + 1 < rows.length) {
      var next = rows[i + 1], ok = true;
      for (var g = end + 1; g < next && ok; g++) ok = empty(g);
      if (!ok) break;
      end = next; i++;
    }
    var block = [];
    for (var r = start; r <= end; r++) block.push([edits[r] != null ? edits[r] : '']);
    t.sheet.getRange(start, c + 1, end - start + 1, 1).setValues(block);
    calls++; i++;
  }
  return calls;
}

/**
 * Apply the preview. Under the script lock: validates the preview, every needed tab and
 * every header, then per chunk re-reads the live tabs and roster, re-validates each
 * line, takes a backup before the FIRST write, logs, writes blank cells only, and
 * records each line's Result. Stops cleanly at the time budget; run it again to resume.
 *
 * Returns { complete, rows, code, email, refused, skipped, remaining, backup: {name,id}|null }.
 */
function applyStaffKeyBackfill_() {
  return withRosterLock_(function () {
    var started = Date.now();
    var preview = rosterNeedTab_(SS.BACKFILL_PREVIEW);
    var pv = readBackfillPreview_(preview);
    if (!pv.stamp) throw new Error('Nothing to apply. Run 🪪 Roster → Preview backfill first.');
    var pending = pv.rows.filter(function (p) { return p.action === 'Will fill' && !p.result; });
    var none = { complete: true, rows: 0, code: 0, email: 0, refused: 0, skipped: 0, remaining: 0, backup: backfillBackupFor_(pv.stamp) };
    if (!pending.length) return none;                  // second run: nothing left, nothing written
    var age = Date.now() - backfillStampMs_(pv.stamp);
    if (isNaN(age) || age > BACKFILL_MAX_AGE_MS) {
      throw new Error('The preview is more than 24 hours old. Run 👁 Preview backfill again, then apply.');
    }

    // VALIDATE every tab and header (target tabs, preview, log) before the first write.
    rosterRequireReady_({}, [], 'applied');
    var labels = {};
    pending.forEach(function (p) {
      if (!backfillTarget_(p.tab)) throw new Error('Nothing was changed. The preview names an unknown tab: "' + p.tab + '".');
      labels[p.tab] = true;
    });
    var readAll = function () {
      clearCache();
      var reads = {};
      Object.keys(labels).forEach(function (l) { reads[l] = backfillReadTarget_(backfillTarget_(l)); });
      return reads;
    };
    var reads = readAll();
    clearRosterCache_();
    var roster = getRoster_();
    if (!roster || !roster.exists) throw new Error('Nothing was changed. The ' + SS.ROSTER + ' tab is missing.');

    var size = backfillChunkSize_(), used = {};
    var total = { rows: 0, code: 0, email: 0, refused: 0, skipped: 0 };
    var backup = backfillBackupFor_(pv.stamp), complete = true, resultCol = pv.cols['Result'];
    for (var at = 0, ci = 0; at < pending.length; at += size, ci++) {
      if (ci > 0) {
        if (backfillOutOfTime_(started)) { complete = false; break; }
        reads = readAll();                             // re-read right before writing, every chunk
        clearRosterCache_();
      }
      var chunk = pending.slice(at, at + size);
      var plan = backfillPlanChunk_(chunk, reads, backfillKeyLookup_(), used);
      var writes = [];                                  // [label, which, edits]
      Object.keys(plan.edits).forEach(function (label) {
        ['code', 'email'].forEach(function (which) {
          if (Object.keys(plan.edits[label][which]).length) writes.push([label, which, plan.edits[label][which]]);
        });
      });

      if (writes.length) {
        var entries = [];
        if (!backup) {
          var file;
          try { file = backupWorkbook_('before staff-key backfill'); }
          catch (e) { throw new Error('Nothing was changed: the backup could not be saved (' + e.message + ').'); }
          backup = { name: file.getName(), id: typeof file.getId === 'function' ? file.getId() : '' };
          entries.push({ name: BACKFILL_LOG_NAME, field: 'Backfill backup', old: '', now: backup.name, source: 'Apply',
                         reason: 'id ' + backup.id + '; preview ' + pv.stamp + '; restore this copy to roll back' });
        }
        writes.forEach(function (w) {
          var rows = Object.keys(w[2]).map(Number);
          entries.push({ name: BACKFILL_LOG_NAME, field: 'Backfill cells ' + w[0] + ' / ' + (w[1] === 'code' ? 'Staff Code' : 'Staff Email'),
                         old: '', now: rows.length + ' cell(s)', source: 'Apply',
                         reason: 'rows ' + backfillRowRanges_(rows) + '; blank before; preview ' + pv.stamp });
        });
        appendRosterLog_(entries);                      // the audit trail first: nothing is written unlogged
        writes.forEach(function (w) { backfillWriteColumn_(reads[w[0]], w[1], w[2]); });
      }
      rosterColumnUpdate_(preview, resultCol, BACKFILL_DATA_START, plan.results);
      Object.keys(total).forEach(function (k) { total[k] += plan.tally[k]; });
    }

    var remaining = complete ? 0 : pending.length - at;   // `at` = first line of the chunk not yet run
    appendRosterLog_([{ name: BACKFILL_LOG_NAME, field: 'Backfill summary', old: '',
      now: (total.code + total.email) + ' cell(s) in ' + total.rows + ' row(s)', source: 'Apply',
      reason: (complete ? 'complete' : 'stopped at the time limit; ' + remaining + ' line(s) left') +
        '; refused ' + total.refused + '; already filled ' + total.skipped + '; preview ' + pv.stamp }]);
    clearRosterCache_(); clearCache();
    try {
      var rb = backfillRollbackInfo_();
      var pw = backfillPreviewCols_(preview).width;
      titleBand_(preview, '🧾 Backfill Preview — Data as of ' + pv.stamp + ' — applied ' + rosterClock_() + ' — ' +
        backfillRollbackText_(rb) + ' — see 🪪 Roster Log', Math.max(pw, BACKFILL_PREVIEW_HEADERS.length));
    } catch (e) { Logger.log('backfill title: ' + e.message); }
    return { complete: complete, rows: total.rows, code: total.code, email: total.email, refused: total.refused,
             skipped: total.skipped, remaining: remaining, backup: backup };
  });
}

/* ───────── menu entry points (each guarded: N5) ───────── */

function previewStaffKeyBackfill() {
  rosterRun_('preview the backfill', function () {
    toast_('Reading every absence row…', '🧾', 10);
    var s = previewStaffKeyBackfill_();
    var lines = BACKFILL_ACTIONS.filter(function (a) { return s.counts[a]; }).map(function (a) { return a + ': ' + s.counts[a]; });
    SpreadsheetApp.getUi().alert('🧾 Backfill preview ready',
      'Rows scanned: ' + Object.keys(s.scanned).map(function (k) { return k + ' ' + s.scanned[k]; }).join(', ') +
      '\n' + (lines.length ? lines.join('\n') : 'Nothing to list.') +
      '\n\nCells to write: Staff Code ' + s.cells.code + ', Staff Email ' + s.cells.email +
      '\n\nNothing has been changed on the absence tabs. Review 🧾 Backfill Preview, then choose Apply backfill.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  });
}

function applyStaffKeyBackfill() {
  rosterRun_('apply the backfill', function () {
    var ui = SpreadsheetApp.getUi();
    var pv = readBackfillPreview_(rosterNeedTab_(SS.BACKFILL_PREVIEW));
    var pending = pv.rows.filter(function (p) { return p.action === 'Will fill' && !p.result; });
    var go = ui.alert('Apply the backfill?',
      pending.length + ' line(s) on 🧾 Backfill Preview will have blank Staff Code / Staff Email cells filled.\n\n' +
      'A backup copy of the workbook is saved first. Cells that already hold a value are never changed, and no other column is touched.\n' +
      'Run it outside 07:30-10:00, when nobody is marking absences.', ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) { toast_('Nothing was changed.', '✅', 5); return; }
    var r = applyStaffKeyBackfill_();
    ui.alert(r.complete ? '✅ Backfill applied' : '⏸ Backfill paused',
      'Rows filled: ' + r.rows + '\nStaff Code cells: ' + r.code + '\nStaff Email cells: ' + r.email +
      '\nRefused (changed since the preview): ' + r.refused + '\nAlready filled: ' + r.skipped +
      (r.complete ? '' : '\n\nStopped at the time limit with ' + r.remaining + ' line(s) left. Choose Apply backfill again to continue.') +
      (r.backup ? '\n\nBackup: ' + r.backup.name : ''), ui.ButtonSet.OK);
  });
}

function showBackfillRollbackInfo() {
  rosterRun_('show the backfill rollback info', function () {
    var rb = backfillRollbackInfo_();
    SpreadsheetApp.getUi().alert('↩️ Backfill rollback info',
      rb.backupName
        ? 'Backup taken before the backfill:\n' + rb.backupName + '\n(id ' + rb.backupId + ')\n\nCells changed since: ' + rb.cells +
          '\nThe exact rows are listed in 🪪 Roster Log. To roll back, clear those cells (the two key columns held nothing before) or restore the backup.'
        : 'No backfill has been applied yet.', SpreadsheetApp.getUi().ButtonSet.OK);
  });
}
