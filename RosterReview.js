/**
 * ============================================================
 * RosterReview.gs — 🪪 Roster Review: preview matches, apply decisions (T-013).
 *
 * The ONLY code that writes an Email, a Staff Code or a new person into the
 * roster from a match (PRD D2, D3, D6, D9-D11, §5.5-5.8, §6.3, R8-R10, R31,
 * R32, R35, R36). Everything else about matching is the pure MatchEngine.js.
 *
 *   matchSettingsFromRoster_()   the ONE adapter: 🧭 Roster Settings -> matcher settings
 *   buildRosterReview_()         pure: roster + importHR + HR Database -> review items
 *   previewRosterMatches_()      writes ONLY 🪪 Roster Review; keeps typed decisions
 *   planRosterDecisions_()       pure: decisions + LIVE data -> writes or a reason for each row
 *   applyRosterDecisions_()      lock, backup, re-read, re-validate, write accepted rows only
 *
 * Safety model:
 *   - The review tab is a PROPOSAL. Apply never trusts its cells: it rebuilds the
 *     review from live data and writes values from THAT. A row whose basis differs
 *     (anything it was derived from changed since the preview) is refused as stale.
 *   - Blank-only writes for Staff Code and Email; an existing value is never overwritten.
 *   - A placeholder (N/A ...) is never written; a name-match-only row never gets a code or email.
 *   - Prepare and validate everything first; write nothing if any needed header is missing.
 *   - Every change is logged to 🪪 Roster Log; every row gets a Result; a row with a Result is
 *     finished, so a second Apply changes nothing.
 *   - HR Database data reaches only this tab, 🪪 Teachers and 🪪 Roster Log, whitelisted fields only.
 *     readHrDatabase_() is called from the two menu handlers' paths only, never a trigger.
 * ============================================================
 */

/* ───────── the settings adapter ───────── */

/**
 * readRosterSettings_() and the matcher grew apart: the sheet reader names things
 * {hrCategory, rosterCategory}, hrSource.statusFilter, hrSource.staffCodePattern, allowList;
 * the matcher wants {hr, roster}, statusFilter, staffCodePattern, allow. This is the one
 * place that translates, so nothing silently falls back to MATCH_DEFAULTS.
 * Exclusions (honorifics are rows of type Honorific) are passed through as read; if the
 * Settings tab does not exist at all they are left undefined so the seed rules apply.
 */
function matchSettingsFromRoster_(rs) {
  rs = rs || {};
  var src = rs.hrSource || {};
  return {
    exclusions: rs.exists === false ? undefined : (rs.exclusions || []).map(function (e) {
      return { type: e.type, value: e.value, reason: e.reason, enabled: e.enabled };
    }),
    allow: (rs.allowList || []).map(function (a) { return { email: a.email, reason: a.reason }; }),
    categories: (rs.categories || []).map(function (c) {
      return { name: c.name, teaching: c.teaching, joinKey: c.joinKey, emailRequired: c.emailRequired };
    }),
    hrCategoryMap: (rs.hrCategoryMap || []).map(function (m) { return { hr: m.hrCategory, roster: m.rosterCategory }; }),
    placeholders: (rs.placeholders || []).slice(),
    statusFilter: (src.statusFilter || []).slice(),
    staffCodePattern: src.staffCodePattern,
  };
}

/* ───────── reading ───────── */

/**
 * 👥 importHR as matcher rows {name, email, row}, found by header name (one read).
 * If a header is missing the ⚙️ Config column numbers are used and `warning` says so.
 * Returns { ok, rows, reason?, warning }.
 */
function readImportHrRows_() {
  var sheet = sheet_(SS.IMPORT_HR);
  if (!sheet || sheet.getLastRow() < 3) return { ok: false, rows: [], reason: '👥 importHR is missing or empty', warning: '' };
  var lastCol = Math.max(1, sheet.getLastColumn());
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, lastCol).getValues()[0]);
  var cName = rosterFindCol_(at, 'Teacher Name'), cEmail = at[rosterHeaderKey_('Email')] || 0, warning = '';
  if (!cName || !cEmail) {
    var cfg = getConfig();
    cName = cName || cfg.hrNameCol; cEmail = cEmail || cfg.hrEmailCol;
    warning = '👥 importHR has no "Teacher Name" / "Email" header in row 2, so the column numbers in ⚙️ Config were used';
  }
  if (cName > lastCol || cEmail > lastCol) return { ok: false, rows: [], reason: '👥 importHR has no usable Name / Email columns', warning: warning };
  var data = sheet.getRange(3, 1, sheet.getLastRow() - 2, lastCol).getValues(), rows = [];
  data.forEach(function (r, i) {
    var name = norm_(r[cName - 1]), email = norm_(r[cEmail - 1]);
    if (name || email) rows.push({ name: name, email: email, row: 3 + i });
  });
  return { ok: true, rows: rows, warning: warning };
}

/** The matcher's view of a roster row. staffCode is the typed or locked code, so a held code is never offered twice. */
function rosterReviewMatchRow_(r) {
  return { displayName: r.name, category: r.category, email: r.email, staffCode: r.staffCode || r.locked,
           matchStatus: r.matchStatus, active: r.active, replacedBy: r.replacedBy, row: r.row };
}

/** Two 32-bit hashes joined: enough to notice any change; stores no readable value. */
function rosterReviewHash_(s) {
  var a = 5381, b = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    a = ((a << 5) + a + c) | 0;
    b = (Math.imul(b, 31) + c) | 0;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function rosterReviewCands_(list, valueKey) {
  return (list || []).slice(0, 3).map(function (c) { return { name: c.name || '', value: c[valueKey] || '', row: c.row || 0 }; });
}

function rosterReviewBasis_(it) {
  var parts = [it.link, it.displayName, it.class, it.rule, it.rosterState || ''];
  it.cands.forEach(function (c) { parts.push(c.name + '|' + c.value + '|' + c.row); });
  if (it.proposal) {
    var p = it.proposal;
    parts.push([p.category, p.department, p.teamRole, p.staffCode, p.row].join('|'));
  }
  return rosterReviewHash_(parts.join('␟'));
}

function rosterReviewRosterState_(r) {
  return [r.row, r.name, r.email, r.staffCode, r.locked, r.matchStatus, r.category, r.active, r.department, r.team].join('|');
}

/**
 * Pure. Build the review items.
 *   input { rows: roster rows (readRosterRows_), settings: readRosterSettings_(),
 *           importHr: {ok, rows, reason?, warning?}, hr: readHrDatabase_() result }
 * Returns { items, summary }. Each item carries what the sheet shows plus what Apply needs
 * ({key, link, displayName, category, class, rule, cands[{name,value,row}], hrCategory, hrDepartment,
 *   hrTeamRole, hrEmail, evidence, prefill, basis, rosterRow, res, proposal, info}).
 * If the HR Database could not be read, Staff Code and Propose add are replaced by ONE information
 * row and email matching carries on (R29).
 */
function buildRosterReview_(input) {
  var ms = matchPrepareSettings(matchSettingsFromRoster_(input.settings));
  var rows = (input.rows || []).filter(function (r) { return r.name; });
  var mrows = rows.map(rosterReviewMatchRow_);
  var dupNames = rosterNameCounts_(rows);
  var hr = input.hr || { ok: false, records: [], error: '' };
  var imp = input.importHr || { ok: false, rows: [] };
  var items = [];
  var summary = { rosterRows: rows.length, email: {}, staffCode: {}, patternWarnings: 0, corroborated: 0,
                  propose: { total: 0, byCategory: {} }, unmapped: [], prefilled: 0,
                  importHr: { ok: !!imp.ok, rows: imp.rows ? imp.rows.length : 0, excluded: 0, reason: imp.reason || '', warning: imp.warning || '' },
                  hr: { ok: !!hr.ok, error: hr.error || '', rowsRead: 0, currentRows: 0, columnsRead: 0, columnsWhitelisted: HR_DB_FIELDS.length } };
  if (hr.diagnostics) {
    summary.hr.rowsRead = hr.diagnostics.rowsRead; summary.hr.currentRows = hr.diagnostics.currentRows;
    summary.hr.columnsRead = (hr.diagnostics.headersFound || []).length;
  }
  var dupNote = function (name) { return dupNames[name] > 1 ? 'More than one roster row has this Display Name: fix it first (Apply refuses it)' : ''; };
  var join = function (a) { return a.filter(function (x) { return x; }).join('; '); };

  // Email: roster -> importHR
  var em = null;
  if (imp.ok) {
    em = matchEmailLinks(mrows, imp.rows, ms);
    summary.email = em.counts;
    summary.importHr.excluded = em.excluded.length;
    em.results.forEach(function (res, i) {
      if (res.class === 'Already confirmed' || res.class === 'Name only') return;
      var r = rows[i];
      items.push({ key: 'Email|' + r.name, link: 'Email', displayName: r.name, category: r.category, class: res.class, rule: res.rule,
        cands: rosterReviewCands_(res.candidates, 'email'), hrCategory: '', hrDepartment: '', hrTeamRole: '', hrEmail: '',
        evidence: join([res.note, dupNote(r.name)]), prefill: dupNames[r.name] > 1 ? '' : res.prefill,
        rosterRow: r.row, rosterState: rosterReviewRosterState_(r), res: res });
    });
  } else {
    items.push(rosterReviewInfo_('Email', '👥 importHR could not be read: ' + (imp.reason || 'unknown reason') + '. No email matching was done.'));
  }

  // Staff Code and Propose add: roster / HR Database
  if (hr.ok) {
    var emailByName = {};
    if (em) em.results.forEach(function (res) { if (res.proposedEmail) emailByName[res.displayName] = res.proposedEmail; });
    var sc = matchStaffCodeLinks(mrows, hr.records, ms, { emailByName: emailByName });
    summary.staffCode = sc.counts;
    summary.patternWarnings = sc.counts.patternWarnings || 0;
    summary.corroborated = sc.counts.corroborated || 0;
    sc.results.forEach(function (res, i) {
      var r = rows[i];
      var cat = rosterCategoryInfo_(input.settings, r.category);
      if (!res.writeCode && !(cat.nameOnly && res.candidates.length)) return;   // nothing a human could decide here
      var top = res.candidates[0] || null;
      items.push({ key: 'Staff Code|' + r.name, link: 'Staff Code', displayName: r.name, category: r.category, class: res.class, rule: res.rule,
        cands: rosterReviewCands_(res.candidates, 'staffCode'),
        hrCategory: top ? top.hrCategory : '', hrDepartment: top ? top.department : '', hrTeamRole: top ? top.teamRole : '', hrEmail: '',
        evidence: join([res.evidence, res.note, dupNote(r.name)]), prefill: dupNames[r.name] > 1 ? '' : res.prefill,
        rosterRow: r.row, rosterState: rosterReviewRosterState_(r), res: res });
    });
    var pa = matchProposeAdds(hr.records, sc.results, ms);
    summary.unmapped = pa.unmapped;
    summary.propose = { total: pa.proposals.length, byCategory: pa.counts };
    var taken = {};
    rows.forEach(function (r) { taken[rosterLooseKey_(r.name)] = true; });
    pa.proposals.forEach(function (p) {
      var rec = hr.records[p.hrIndex] || {};
      var flags = p.flags.slice();
      if (taken[rosterLooseKey_(p.displayName)]) flags.push('A roster row already has this name: type a different Display Name in the override column');
      items.push({ key: 'Propose add|' + p.hrName + '|' + p.row, link: 'Propose add', displayName: p.displayName, category: p.category,
        class: 'Not on roster', rule: '', cands: [{ name: p.hrName, value: p.staffCode, row: p.row }],
        hrCategory: rec.category || '', hrDepartment: p.department, hrTeamRole: p.teamRole, hrEmail: p.officialEmail,
        evidence: flags.join('; '), prefill: '', rosterRow: 0, rosterState: '', proposal: p });
    });
  } else {
    items.push(rosterReviewInfo_('Staff Code', hr.error || 'The HR Database could not be read. Staff Code links and Propose add are unavailable.'));
  }

  items.forEach(function (it) {
    it.basis = it.info ? '' : rosterReviewBasis_(it);
    if (it.prefill) summary.prefilled++;
  });
  return { items: items, summary: summary };
}

function rosterReviewInfo_(link, text) {
  return { key: link + '|(unavailable)', link: link, displayName: '(source unavailable)', category: '', class: 'Unavailable', rule: '',
           cands: [], hrCategory: '', hrDepartment: '', hrTeamRole: '', hrEmail: '', evidence: text, prefill: '',
           rosterRow: 0, rosterState: '', info: true, basis: '' };
}

/* ───────── the review tab ───────── */

const REVIEW_CHANGED_NOTE = 'Changed since you decided: re-check';
const REVIEW_UNAVAILABLE_NOTE = 'source unavailable at last preview';

/** Results that end a row (its decision is spent). Anything else may be retried after a re-preview. */
function rosterReviewSettled_(result) { return /^(Written|Added|Recorded)/.test(norm_(result)); }

/** Review rows as objects, found by header name. Returns { cols, rows }. */
function readRosterReviewRows_(sheet) {
  var lastCol = Math.max(1, sheet.getLastColumn());
  var at = rosterHeaderCols_(sheet.getRange(2, 1, 1, lastCol).getValues()[0]);
  var cols = {};
  REVIEW_HEADERS.forEach(function (h) { cols[h] = at[rosterHeaderKey_(h)] || 0; });
  var out = { cols: cols, rows: [] };
  if (sheet.getLastRow() < REVIEW_DATA_START || !cols['Key']) return out;
  var data = sheet.getRange(REVIEW_DATA_START, 1, sheet.getLastRow() - REVIEW_DATA_START + 1, lastCol).getValues();
  data.forEach(function (r, i) {
    var g = function (h) { return cols[h] ? norm_(r[cols[h] - 1]) : ''; };
    if (!g('Key')) return;
    var cells = {};
    REVIEW_HEADERS.forEach(function (h) { cells[h] = cols[h] ? r[cols[h] - 1] : ''; });
    out.rows.push({ row: REVIEW_DATA_START + i, key: g('Key'), link: g('Link'), cells: cells, displayName: g('Display Name'),
      decision: g('Decision'), manual: g('Manual Email / Code'), override: g('Display Name override'), notes: g('Notes'),
      result: g('Result'), basis: g('Basis'), prefilled: g('Prefilled') });
  });
  return out;
}

function rosterReviewRequireCols_(cols) {
  var missing = REVIEW_HEADERS.filter(function (h) { return !cols[h]; });
  if (missing.length) {
    throw new Error('Nothing was changed. ' + SS.ROSTER_REVIEW + ' is missing header(s): ' + missing.join(', ') +
      '. Restore them (row 2), or delete the tab and run 🔧 Upgrade tabs (safe) to rebuild it.');
  }
}

function rosterReviewCell_(it, h, kept) {
  if (it.retained) return it.cells[h] == null ? '' : it.cells[h];
  var k = kept || {};
  switch (h) {
    case 'Link': return it.link;
    case 'Display Name': return it.displayName;
    case 'Category': return it.category;
    case 'Class': return it.class;
    case 'Rule': return it.rule;
    case 'Candidate 1 Name': return it.cands[0] ? it.cands[0].name : '';
    case 'Candidate 1 Value': return it.cands[0] ? it.cands[0].value : '';
    case 'Candidate 2 Name': return it.cands[1] ? it.cands[1].name : '';
    case 'Candidate 2 Value': return it.cands[1] ? it.cands[1].value : '';
    case 'Candidate 3 Name': return it.cands[2] ? it.cands[2].name : '';
    case 'Candidate 3 Value': return it.cands[2] ? it.cands[2].value : '';
    case 'HR Category': return it.hrCategory;
    case 'HR Department': return it.hrDepartment;
    case 'HR Team/Role': return it.hrTeamRole;
    case 'HR Email': return it.hrEmail;
    case 'Evidence': return it.evidence;
    case 'Decision': return it.info ? '' : (k.decision || it.prefill || '');
    case 'Manual Email / Code': return k.manual || '';
    case 'Display Name override': return k.override || '';
    case 'Notes': return k.notes || '';
    case 'Result': return '';
    case 'Key': return it.key;
    case 'Basis': return it.basis;
    case 'Prefilled': return it.prefill || '';
    default: return '';
  }
}

/**
 * Compare and write the answer to 🪪 Roster Review, and nothing else. A decision a human typed
 * (Decision, Manual, override, Notes) is kept against the same key; a decision that is only the
 * code's own pre-fill is not "typed" and is re-derived; a finished row's decision is spent.
 * Returns { summary, written }.
 */
function previewRosterMatches_() {
  var sheet = rosterNeedTab_(SS.ROSTER_REVIEW);
  clearRosterCache_();
  var state = readRosterRows_();
  if (!state.exists) throw new Error('The ' + SS.ROSTER + ' tab is missing. Run 🔧 Upgrade tabs (safe) first.');
  var old = readRosterReviewRows_(sheet);
  rosterReviewRequireCols_(old.cols);
  var model = buildRosterReview_({ rows: state.rows, settings: readRosterSettings_(), importHr: readImportHrRows_(), hr: readHrDatabase_() });

  var kept = {};
  old.rows.forEach(function (o) {
    if (rosterReviewSettled_(o.result)) return;
    var machine = o.decision !== '' && o.decision === o.prefilled;
    var k = { decision: machine ? '' : o.decision, manual: o.manual, override: o.override, notes: o.notes, basis: o.basis };
    if (k.decision || k.manual || k.override || k.notes) kept[o.key] = k;
  });

  // A decision that points at "candidate 1/2/3" is only meaningful against the candidates the reviewer saw.
  // If the row's basis changed, drop it (and its pre-fill) and say so; never rebase it onto new evidence.
  // Decisions that do not depend on the candidate list (Enter email/code, No email, Ignore) stay.
  model.items.forEach(function (it) {
    var k = kept[it.key], d = k && k.decision ? rosterReviewDecision_(k.decision) : null;
    if (!k || it.info || !d || (d.kind !== 'accept' && d.kind !== 'pick') || k.basis === it.basis) return;
    kept[it.key] = { decision: '', manual: k.manual, override: k.override, notes: k.notes, basis: it.basis };
    it.prefill = '';
    it.evidence = (it.evidence ? it.evidence + '; ' : '') + REVIEW_CHANGED_NOTE;
  });

  // A source that could not be read must not wipe what a human typed against it: keep those rows as they were.
  var down = {};
  if (!model.summary.importHr.ok) down['Email'] = true;
  if (!model.summary.hr.ok) { down['Staff Code'] = true; down['Propose add'] = true; }
  var items = model.items.slice();
  old.rows.forEach(function (o) {
    if (!down[o.link] || /\(unavailable\)$/.test(o.key)) return;
    var c = Object.assign({}, o.cells), ev = norm_(c['Evidence']);
    if (ev.indexOf(REVIEW_UNAVAILABLE_NOTE) < 0) c['Evidence'] = (ev ? ev + '; ' : '') + REVIEW_UNAVAILABLE_NOTE;
    items.push({ retained: true, cells: c, key: o.key });
  });
  model = { items: items, summary: model.summary };

  var oldCount = sheet.getLastRow() >= REVIEW_DATA_START ? sheet.getLastRow() - REVIEW_DATA_START + 1 : 0;
  var total = Math.max(model.items.length, oldCount);
  if (total) {
    ensureRows_(sheet, REVIEW_DATA_START + total);
    REVIEW_HEADERS.forEach(function (h) {      // one write per column: columns a human added are never touched
      var vals = [];
      for (var i = 0; i < total; i++) vals.push([i < model.items.length ? rosterReviewCell_(model.items[i], h, kept[model.items[i].key]) : '']);
      sheet.getRange(REVIEW_DATA_START, old.cols[h], total, 1).setValues(vals);
    });
  }
  titleBand_(sheet, '🪪 Roster Review — Data as of ' + rosterClock_(), REVIEW_HEADERS.length);
  try { sheet.showSheet(); ss_().setActiveSheet(sheet); } catch (e) { /* cosmetic */ }
  return { summary: model.summary, written: model.items.length };
}

/** PRD §5.7: counts only. Never an HR Database value other than whitelisted Category names. */
function rosterReviewSummaryText_(s) {
  var c = function (o, k) { return o && o[k] ? o[k] : 0; };
  var cls = function (o) {
    return 'Confirmed-exact ' + c(o, 'Confirmed-exact') + ' · Candidate ' + c(o, 'Candidate') + ' · Ambiguous ' + c(o, 'Ambiguous') +
           ' · Unmatched ' + (c(o, 'Unmatched') + c(o, 'No email expected'));
  };
  var cats = Object.keys(s.propose.byCategory).map(function (k) { return s.propose.byCategory[k] + ' ' + k; }).join(' · ');
  var lines = ['🪪 Match preview — ' + rosterClock_(),
    'Roster rows: ' + s.rosterRows + ' · Propose add from HR Database: ' + s.propose.total + (cats ? ' (' + cats + ')' : '')];
  lines.push(s.importHr.ok ? 'EMAIL      ' + cls(s.email) : 'EMAIL      unavailable: ' + s.importHr.reason);
  lines.push(s.hr.ok
    ? 'STAFF CODE ' + cls(s.staffCode) + ' · pattern warnings ' + s.patternWarnings + ' · corroborated by email ' + s.corroborated
    : 'STAFF CODE unavailable: ' + s.hr.error);
  lines.push('importHR rows: ' + s.importHr.rows + ' (excluded as non-person: ' + s.importHr.excluded + ')' +
    (s.hr.ok ? ' · HR Database rows read: ' + s.hr.rowsRead + ' (Current: ' + s.hr.currentRows + ') · columns read: ' +
      s.hr.columnsRead + ' of ' + s.hr.columnsWhitelisted + ' whitelisted' : ''));
  if (s.importHr.warning) lines.push('⚠️ ' + s.importHr.warning);
  if (s.unmapped.length) lines.push('Unmapped HR categories (never proposed): ' + s.unmapped.join(', '));
  lines.push('Pre-filled Accept: ' + s.prefilled + ' (Confirmed-exact without a warning).');
  lines.push('', 'Nothing has been written to 🪪 Teachers. Review 🪪 Roster Review, type decisions, then Apply decisions.');
  return lines.join('\n');
}

/* ───────── deciding what each typed decision means ───────── */

function rosterReviewDecision_(text) {
  var s = norm_(text).toLowerCase().replace(/\s+/g, ' ');
  if (s === 'accept') return { kind: 'accept', n: 1 };
  var m = /^pick ([23])$/.exec(s);
  if (m) return { kind: 'pick', n: Number(m[1]) };
  if (s === 'enter email') return { kind: 'enter', what: 'email' };
  if (s === 'enter code') return { kind: 'enter', what: 'code' };
  if (s === 'no email') return { kind: 'noemail' };
  if (s === 'ignore') return { kind: 'ignore' };
  return null;
}

/**
 * Pure. Decide every pending review row against LIVE data.
 *   input { pending: review rows with a Decision and no Result, live: buildRosterReview_(...),
 *           state: readRosterRows_(), settings, importHr, hr, today, user }
 * Returns { outcomes: [{row, result}], edits: {header: {rosterRow: value}}, newRows: [...], log: [...],
 *           counts: {...} }. A refused row contributes no edit, no new row and no log entry.
 * Uniqueness is checked against the roster AND among the rows accepted in this same run: when two
 * accepted rows would end up with the same email or code, BOTH are refused (no order dependence).
 */
function planRosterDecisions_(input) {
  var S = input.settings, ms = matchPrepareSettings(matchSettingsFromRoster_(S));
  var rows = input.state.rows, byRow = {};
  rows.forEach(function (r) { byRow[r.row] = r; });
  var nameCount = rosterNameCounts_(rows);
  var liveByKey = {}, liveDup = {}, pendCount = {};
  input.live.items.forEach(function (it) { if (liveByKey[it.key]) liveDup[it.key] = true; liveByKey[it.key] = it; });
  input.pending.forEach(function (p) { pendCount[p.key] = (pendCount[p.key] || 0) + 1; });
  var impByEmail = {};
  (input.importHr.rows || []).forEach(function (r) {
    var e = matchClean(r.email, ms).toLowerCase();
    if (e && !impByEmail[e]) impByEmail[e] = r;
  });
  var hrDup = {};
  matchDuplicateCodes(input.hr.records || [], ms).forEach(function (d) { hrDup[d.code] = true; });
  var hrCodes = {};
  (input.hr.records || []).forEach(function (r) { if (r.staffCode) hrCodes[r.staffCode] = true; });
  var codeRe = staffCodeRegex_(S);
  var looseTaken = {};
  rows.forEach(function (r) { looseTaken[rosterLooseKey_(r.name)] = true; });

  var plans = input.pending.map(function (p) {
    var plan = { p: p, refuse: '', record: '', statusRow: 0, email: null, code: null, status: null, fills: [], newRow: null, name: '' };
    plan.refuse = rosterReviewEval_(plan, p);
    return plan;
  });

  function rosterReviewEval_(plan, p) {
    var d = rosterReviewDecision_(p.decision);
    if (!d) return 'Refused: "' + p.decision.slice(0, 30) + '" is not a decision. Use Accept, Pick 2, Pick 3, Enter email, Enter code, No email or Ignore.';
    if (pendCount[p.key] > 1 || liveDup[p.key]) return 'Refused: more than one row has this key (duplicate Display Name). Nothing was written.';
    var it = liveByKey[p.key];
    if (!it) {
      if (p.link !== 'Email' && !input.hr.ok) return 'Refused: the HR Database could not be read just now (' + (input.hr.error || 'unknown') + '). Nothing was written for this row.';
      if (p.link === 'Email' && !input.importHr.ok) return 'Refused: 👥 importHR could not be read just now. Nothing was written for this row.';
      return 'Stale: this row no longer applies to the live data. Run Preview matches again.';
    }
    if (it.info) return 'Refused: information only; there is nothing to apply.';
    if (it.basis !== p.basis) return 'Stale: the roster, 👥 importHR or the HR Database changed since the preview. Run Preview matches again.';
    if (p.link === 'Email') return rosterReviewEvalEmail_(plan, p, d, it);
    if (p.link === 'Staff Code') return rosterReviewEvalCode_(plan, p, d, it);
    if (p.link === 'Propose add') return rosterReviewEvalAdd_(plan, p, d, it);
    return 'Refused: unknown link "' + p.link + '".';
  }

  function chainedTo_(a, b) { return matchChained_(rosterReviewMatchRow_(a), rosterReviewMatchRow_(b)); }

  function rosterReviewEvalEmail_(plan, p, d, it) {
    var t = byRow[it.rosterRow];
    if (!t) return 'Stale: the roster row is gone. Run Preview matches again.';
    if (nameCount[t.name] > 1) return 'Refused: more than one roster row has the Display Name "' + t.name + '".';
    var info = rosterCategoryInfo_(S, t.category);
    if (d.kind === 'ignore') {
      plan.name = t.name;
      if (t.matchStatus === 'Ignored') { plan.record = 'Recorded: already Ignored; nothing to change'; return ''; }
      plan.status = 'Ignored'; plan.statusRow = t.row; plan.record = 'Written: Match Status set to Ignored';
      return '';
    }
    if (d.kind === 'noemail') {
      if (info.nameOnly) return 'Refused: a ' + t.category + ' has no email to record.';
      if (info.emailRequired) return 'Refused: No email is only for categories that do not need one (this one does, on 🧭 Roster Settings).';
      if (t.email) return 'Refused: this row already holds an email.';
      plan.status = 'No email'; plan.statusRow = t.row; plan.name = t.name; plan.record = 'Written: Match Status set to No email';
      return '';
    }
    if (d.kind === 'enter' && d.what !== 'email') return 'Refused: this is an Email row. Use Enter email.';
    var email;
    if (d.kind === 'enter') {
      email = matchClean(p.manual, ms).toLowerCase();
      if (!email) return 'Refused: type the address in Manual Email / Code (blank or a placeholder is not an email).';
    } else {
      var c = it.cands[d.n - 1];
      if (!c || !c.value) return 'Refused: there is no candidate ' + d.n + ' on this row.';
      email = c.value;
    }
    if (info.nameOnly) return 'Refused: a ' + t.category + ' never has an email.';
    var imp = impByEmail[email];
    if (!imp) return 'Refused: that address is not in 👥 importHR exactly.';
    var ex = matchExclusion(imp, ms);
    if (ex) return 'Refused: that account is excluded as a non-person (' + ex.rule + '). Add it to the Allow list on 🧭 Roster Settings if it is a real person.';
    if (t.email && t.email !== email) return 'Refused: this row already has a different email; an existing value is never overwritten.';
    var holders = rows.filter(function (o) { return o.row !== t.row && o.active && o.email === email && !chainedTo_(t, o); });
    if (holders.length) return 'Refused: that email is already on ' + holders.map(function (o) { return o.name; }).join(', ') + '.';
    plan.email = { row: t.row, value: email, set: t.email !== email };
    plan.status = 'Confirmed';
    plan.record = 'Written: Email ' + (t.email === email ? 'confirmed' : 'set') + ', Match Status = Confirmed';
    plan.name = t.name; plan.rule = it.rule;
    return '';
  }

  function rosterReviewEvalCode_(plan, p, d, it) {
    var t = byRow[it.rosterRow];
    if (!t) return 'Stale: the roster row is gone. Run Preview matches again.';
    if (nameCount[t.name] > 1) return 'Refused: more than one roster row has the Display Name "' + t.name + '".';
    if (d.kind === 'ignore') { plan.record = 'Recorded: ignored; nothing written'; return ''; }
    if (d.kind === 'noemail') return 'Refused: No email belongs on the Email row, not here.';
    if (d.kind === 'enter' && d.what !== 'code') return 'Refused: this is a Staff Code row. Use Enter code.';
    var info = rosterCategoryInfo_(S, t.category);
    var code = '', source = 'HR Database', cand = null, fillOk = false, why = '';
    if (d.kind === 'enter') {
      if (info.nameOnly) return 'Refused: a ' + t.category + ' never has a Staff Code.';
      code = matchClean(p.manual, ms).toUpperCase();
      if (!code) return 'Refused: type the code in Manual Email / Code (blank or a placeholder is not a code).';
      source = 'First set';
      why = 'Typed in 🪪 Roster Review';
    } else {
      cand = it.cands[d.n - 1];
      if (!cand) return 'Refused: there is no candidate ' + d.n + ' on this row.';
      var rc = it.res.candidates[d.n - 1] || {};
      code = info.nameOnly ? '' : cand.value;
      if (rc.codeStatus === 'Code already on another row') return 'Refused: that code is already on another roster row.';
      if (code && hrDup[code]) return 'Refused: that code is shared by several HR Database rows, so it cannot be trusted.';
      if (rc.categoryConflict && info.teaching) return 'Refused: the HR Database category conflicts with this Teaching row; nothing changes.';
      fillOk = !rc.categoryConflict && !rc.unmappedCategory && !info.teaching;
      if (fillOk) {
        if (rc.department && !t.department) plan.fills.push({ header: 'Department', row: t.row, value: rc.department });
        if (rc.teamRole && !t.team) plan.fills.push({ header: 'Team', row: t.row, value: rc.teamRole });
      }
      why = 'Accepted HR Database link in 🪪 Roster Review (' + (it.rule || 'manual') + ')';
    }
    if (code) {
      if (info.nameOnly) return 'Refused: a ' + t.category + ' never has a Staff Code.';
      if (t.staffCode || t.locked) return 'Refused: this row already has a Staff Code; it is never overwritten (use Correct Staff Code…).';
      if (source === 'HR Database' && !hrCodes[code]) return 'Stale: that code is no longer on a current HR Database row. Run Preview matches again.';
      var free = rosterCodeAvailable_(rows, t, code);
      if (!free.ok) return 'Refused: ' + code + ' already belongs to ' + free.with.join(', ') + '. A code is never reused.';
      plan.code = { row: t.row, value: code, source: source,
                    reason: why + (codeRe.test(code) ? '' : ' [pattern warning]') };
    } else if (!plan.fills.length) {
      plan.record = 'Recorded: nothing to write (' + (info.nameOnly ? 'a name-match-only row takes no code' : 'the HR Database has no code for this person') + ')';
    }
    plan.name = t.name; plan.fillReason = why;
    return '';
  }

  function rosterReviewEvalAdd_(plan, p, d, it) {
    if (d.kind === 'ignore') { plan.record = 'Recorded: ignored; nothing added'; return ''; }
    if (d.kind !== 'accept') return 'Refused: a Propose add row takes Accept or Ignore only.';
    var pr = it.proposal;
    var name = norm_(p.override) || pr.displayName;
    if (!name || isPlaceholder_(name, S.placeholders)) return 'Refused: type a real Display Name in the override column (a blank or placeholder is not one).';
    if (looseTaken[rosterLooseKey_(name)]) return 'Refused: the Display Name "' + name + '" is already on the roster. Type a distinguishing name in the override column.';
    var info = rosterCategoryInfo_(S, pr.category);
    if (!info.known || info.teaching) return 'Refused: ' + pr.category + ' is not a non-teaching category on 🧭 Roster Settings; Teaching rows come only from the Allotment.';
    var code = info.nameOnly ? '' : pr.staffCode;
    if (code) {
      if (hrDup[code]) return 'Refused: that code is shared by several HR Database rows, so it cannot be trusted.';
      if (!hrCodes[code]) return 'Stale: that code is no longer on a current HR Database row. Run Preview matches again.';
      var free = rosterCodeAvailable_(rows, { row: -1, name: name, active: true, replacedBy: '', staffCode: code, locked: code }, code);
      if (!free.ok) return 'Refused: ' + code + ' already belongs to ' + free.with.join(', ') + '. A code is never reused.';
      plan.code = { row: 0, value: code, source: 'HR Database', newName: name,
                    reason: 'Proposed addition accepted in 🪪 Roster Review' + (codeRe.test(code) ? '' : ' [pattern warning]') };
    }
    plan.newRow = { 'Display Name': name, 'Staff Code': code, 'Staff Code (Locked)': code, 'Category': pr.category, 'Active': true,
                    'Match Status': 'Unreviewed', 'Department': pr.department, 'Team': pr.teamRole, 'In Allotment': '' };
    plan.name = name; plan.category = pr.category;
    plan.record = 'Added: new ' + pr.category + ' row' + (code ? ' with a Staff Code' : ' (no code, no email)');
    return '';
  }

  // Cross-row uniqueness among the rows accepted in THIS run: refuse every row involved.
  var live = plans.filter(function (pl) { return !pl.refuse; });
  var group = function (keyFn) {
    var by = {};
    live.forEach(function (pl) { var k = keyFn(pl); if (k) (by[k] = by[k] || []).push(pl); });
    return by;
  };
  var byEmail = group(function (pl) { return pl.email ? pl.email.value : ''; });
  Object.keys(byEmail).forEach(function (e) {
    var g = byEmail[e];
    if (g.length > 1 && matchConflict_(g.map(function (pl) { return rosterReviewMatchRow_(byRow[pl.email.row]); }))) {
      g.forEach(function (pl) { pl.refuse = 'Refused: the same email was accepted for ' + g.length + ' rows, so none was written.'; });
    }
  });
  var byCode = group(function (pl) { return pl.code ? pl.code.value : ''; });
  Object.keys(byCode).forEach(function (c) {
    var g = byCode[c];
    if (g.length > 1) g.forEach(function (pl) { pl.refuse = 'Refused: the same Staff Code was accepted for ' + g.length + ' rows, so none was written.'; });
  });
  var byName = group(function (pl) { return pl.newRow ? rosterLooseKey_(pl.name) : ''; });
  Object.keys(byName).forEach(function (n) {
    var g = byName[n];
    if (g.length > 1) g.forEach(function (pl) { pl.refuse = 'Refused: two proposed additions would get the same Display Name; give one a distinguishing name.'; });
  });

  // Collect the writes of the rows that survived.
  var edits = { 'Email': {}, 'Match Status': {}, 'Confirmed By': {}, 'Confirmed On': {}, 'Staff Code': {}, 'Staff Code (Locked)': {},
                'Department': {}, 'Team': {} };
  var newRows = [], log = [], outcomes = [];
  var counts = { emails: 0, noEmail: 0, ignored: 0, codes: 0, added: 0, filled: 0, refused: 0, stale: 0, recorded: 0 };
  plans.forEach(function (pl) {
    if (pl.refuse) {
      outcomes.push({ row: pl.p.row, result: pl.refuse });
      if (/^Stale/.test(pl.refuse)) counts.stale++; else counts.refused++;
      return;
    }
    if (pl.email) {
      var e = pl.email;
      if (e.set) { edits['Email'][e.row] = e.value; }
      edits['Match Status'][e.row] = 'Confirmed'; edits['Confirmed By'][e.row] = input.user; edits['Confirmed On'][e.row] = input.today;
      if (e.set) log.push({ name: pl.name, field: 'Email', old: '', now: e.value, source: 'Apply', reason: 'Accepted in 🪪 Roster Review (' + (pl.rule || 'manual') + ')' });
      log.push({ name: pl.name, field: 'Match Status', old: byRow[e.row].matchStatus, now: 'Confirmed', source: 'Apply', reason: 'Accepted in 🪪 Roster Review' });
      counts.emails++;
    } else if (pl.status) {
      var row = pl.statusRow;
      edits['Match Status'][row] = pl.status;
      if (pl.status === 'No email') { edits['Confirmed By'][row] = input.user; edits['Confirmed On'][row] = input.today; }
      log.push({ name: pl.name, field: 'Match Status', old: byRow[row].matchStatus, now: pl.status,
                 source: 'Apply', reason: 'Decided in 🪪 Roster Review' });
      if (pl.status === 'No email') counts.noEmail++; else counts.ignored++;
    }
    if (pl.code && pl.code.row) {
      edits['Staff Code'][pl.code.row] = pl.code.value; edits['Staff Code (Locked)'][pl.code.row] = pl.code.value;
      log.push({ name: pl.name, field: 'Staff Code', old: '', now: pl.code.value, source: pl.code.source, reason: pl.code.reason });
      counts.codes++;
    }
    pl.fills.forEach(function (f) {
      edits[f.header][f.row] = f.value;
      log.push({ name: pl.name, field: f.header, old: '', now: f.value, source: 'HR Database', reason: pl.fillReason });
      counts.filled++;
    });
    if (pl.newRow) {
      newRows.push(pl.newRow);
      log.push({ name: pl.name, field: 'Row', old: '', now: 'Added (' + pl.category + ')', source: 'HR Database', reason: 'Proposed addition accepted in 🪪 Roster Review' });
      if (pl.code) log.push({ name: pl.name, field: 'Staff Code', old: '', now: pl.code.value, source: 'HR Database', reason: pl.code.reason });
      counts.added++;
    }
    if (!pl.newRow && !pl.email && !pl.status && !(pl.code && pl.code.row) && !pl.fills.length) counts.recorded++;
    outcomes.push({ row: pl.p.row, result: rosterReviewResultText_(pl) });
  });
  return { outcomes: outcomes, edits: edits, newRows: newRows, log: log, counts: counts };
}

function rosterReviewResultText_(pl) {
  if (pl.newRow || pl.email || pl.status) return pl.record;
  var bits = [];
  if (pl.code && pl.code.row) bits.push('Staff Code set and locked');
  if (pl.fills.length) bits.push(pl.fills.map(function (f) { return f.header; }).join(' and ') + ' filled');
  return bits.length ? 'Written: ' + bits.join('; ') : pl.record;
}

/* ───────── Apply ───────── */

/**
 * Apply the decisions on 🪪 Roster Review.
 *   1. script lock; nothing decided = nothing done (no backup either)
 *   2. back the workbook up (opts.continueWithoutBackup(err) -> true to go on without one; default: stop)
 *   3. re-read the roster, 👥 importHR and the HR Database NOW
 *   4. plan every pending row against that live data (refusals carry a reason)
 *   5. validate every header the writes need, then write: log, new rows, one write per column, Results
 * Returns { nothing?, backup, counts, results }.
 */
function applyRosterDecisions_(opts) {
  opts = opts || {};
  return withRosterLock_(function () {
    var roster = rosterNeedTab_(SS.ROSTER), review = rosterNeedTab_(SS.ROSTER_REVIEW);
    rosterNeedTab_(SS.ROSTER_LOG);
    var rv = readRosterReviewRows_(review);
    rosterReviewRequireCols_(rv.cols);
    var pending = rv.rows.filter(function (p) { return p.decision && !p.result; });
    if (!pending.length) return { nothing: true, backup: '', counts: {}, results: [] };

    var backup = '';
    try { backup = backupWorkbook_('before roster decisions').getName(); }
    catch (e) {
      if (!(opts.continueWithoutBackup && opts.continueWithoutBackup(e))) {
        throw new Error('Nothing was applied: the backup could not be saved (' + ((e && e.message) || 'unknown error') + ').');
      }
      backup = '(none: you chose to continue without a backup)';
    }

    clearRosterCache_();
    var state = readRosterRows_(), settings = readRosterSettings_();
    var importHr = readImportHrRows_(), hr = readHrDatabase_();
    var live = buildRosterReview_({ rows: state.rows, settings: settings, importHr: importHr, hr: hr });
    var plan = planRosterDecisions_({ pending: pending, live: live, state: state, settings: settings, importHr: importHr, hr: hr,
                                       today: isoDate_(new Date()), user: activeEmail_() });

    // VALIDATE before the first write: every header the planned writes need, the log, the Result column.
    var needed = ['Display Name'];
    Object.keys(plan.edits).forEach(function (h) { if (Object.keys(plan.edits[h]).length) needed.push(h); });
    if (plan.newRows.length) needed = needed.concat(['Staff Code', 'Staff Code (Locked)', 'Category', 'Active', 'Match Status', 'Department', 'Team', 'In Allotment']);
    if (plan.log.length || needed.length > 1) rosterRequireReady_(state.cols, needed, 'applied');
    if (!rv.cols['Result']) throw new Error('Nothing was applied. Missing header: ' + SS.ROSTER_REVIEW + ': "Result".');

    // WRITE: the audit trail first, so nothing is ever applied without a log entry.
    appendRosterLog_(plan.log);
    rosterAppendRows_(roster, state.cols, plan.newRows);
    Object.keys(plan.edits).forEach(function (h) {
      if (Object.keys(plan.edits[h]).length) rosterColumnUpdate_(roster, state.cols[h], ROSTER_DATA_START, plan.edits[h]);
    });
    var results = {};
    plan.outcomes.forEach(function (o) { results[o.row] = o.result; });
    rosterColumnUpdate_(review, rv.cols['Result'], REVIEW_DATA_START, results);
    clearRosterCache_();
    return { nothing: false, backup: backup, counts: plan.counts, results: plan.outcomes };
  });
}

/** Decisions waiting on 🪪 Roster Review, by kind. Reads the tab only. */
function rosterReviewPending_() {
  var rv = readRosterReviewRows_(rosterNeedTab_(SS.ROSTER_REVIEW));
  var pend = rv.rows.filter(function (p) { return p.decision && !p.result; });
  var n = function (link) { return pend.filter(function (p) { return p.link === link; }).length; };
  return { total: pend.length, email: n('Email'), staffCode: n('Staff Code'), add: n('Propose add') };
}

/* ───────── menu entry points (each guarded: N5) ───────── */

function openRosterReview() { rosterOpenTab_(SS.ROSTER_REVIEW); }

function previewRosterMatches() {
  rosterRun_('preview the roster matches', function () {
    toast_('Matching the roster to 👥 importHR and the HR Database…', '🪪', 10);
    var res = previewRosterMatches_();
    SpreadsheetApp.getUi().alert('🪪 Match preview', rosterReviewSummaryText_(res.summary), SpreadsheetApp.getUi().ButtonSet.OK);
  });
}

function applyRosterDecisions() {
  rosterRun_('apply the roster decisions', function () {
    var ui = SpreadsheetApp.getUi();
    var pend = rosterReviewPending_();
    if (!pend.total) {
      ui.alert('Nothing to apply', 'No row on 🪪 Roster Review has a Decision without a Result. Run Preview matches, type decisions, then try again.', ui.ButtonSet.OK);
      return;
    }
    var go = ui.alert('Apply the decisions?',
      'Decisions waiting: ' + pend.total + ' (Email ' + pend.email + ' · Staff Code ' + pend.staffCode + ' · Propose add ' + pend.add + ')\n\n' +
      'A backup copy is saved first. Every row is re-checked against live data; only blank cells are filled, nothing is ever overwritten, ' +
      'and every change is logged to 🪪 Roster Log.', ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) { toast_('Nothing was changed.', '✅', 5); return; }
    var res = applyRosterDecisions_({
      continueWithoutBackup: function (err) {
        return ui.alert('Backup failed', 'The backup copy could not be saved: ' + ((err && err.message) || 'unknown error') +
          '\n\nContinue WITHOUT a backup?', ui.ButtonSet.YES_NO) === ui.Button.YES;
      },
    });
    if (res.nothing) { ui.alert('Nothing to apply', 'There was nothing left to apply.', ui.ButtonSet.OK); return; }
    var c = res.counts;
    ui.alert('✅ Decisions applied',
      'Emails confirmed: ' + c.emails + '\nStaff Codes set: ' + c.codes + '\nRows added: ' + c.added +
      '\nDepartment / Team filled: ' + c.filled + '\nNo email / Ignored: ' + c.noEmail + ' / ' + c.ignored +
      '\nRefused: ' + c.refused + '   Stale: ' + c.stale + '\n\nBackup: ' + res.backup +
      '\nSee the Result column on 🪪 Roster Review for every row.', ui.ButtonSet.OK);
  });
}
