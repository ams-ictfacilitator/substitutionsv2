/**
 * ============================================================
 * MatchEngine.gs — pure roster matching (PRD-roster §5, D9–D11).
 *
 * No SpreadsheetApp, no CacheService, no clock. Everything comes in as
 * plain objects and goes out as plain objects, so the node harness can
 * test it. Two targets share one ladder:
 *
 *   • matchEmailLinks()      roster row  -> 👥 importHR account (Email)
 *   • matchStaffCodeLinks()  roster row  -> HR Database record (Staff Code)
 *   • matchProposeAdds()     HR record   -> "Propose add" (non-teaching)
 *
 * Rules, honorifics, placeholders, the Staff Code pattern and the category
 * mapping are a SETTINGS object read from 🧭 Roster Settings by the caller
 * (R11). MATCH_DEFAULTS is only the seed data for T-011 and the fallback for
 * keys the caller leaves undefined.
 *
 * Settings shape (all optional; undefined falls back to MATCH_DEFAULTS):
 *   exclusions    [{type, value, reason, enabled}]      §5.2 (incl. 'Honorific' and 'Allow email' rows)
 *   allow         [string | {email, reason}]            Allow list
 *   categories    [{name, teaching, joinKey, emailRequired}]   (joinKey 'Staff Code' | 'Name only')
 *   hrCategoryMap [{hr, roster}]
 *   placeholders  [string]                              D10 (blank is always a placeholder)
 *   statusFilter  [string]                              HR Database Status filter
 *   staffCodePattern string                             regex source
 *
 * Input row shapes:
 *   roster row   {displayName, category, email, staffCode, matchStatus, active, replacedBy, row}
 *   importHR row {name, email, row}
 *   HR record    {status, name, category, teamRole, department, staffCode, officialEmail, row}
 *                (HR_DB_FIELDS; nothing else is read)
 * ============================================================
 */

var MATCH_DEFAULTS = {
  exclusions: [
    { type: 'Local part contains', value: 'admin, office, lab, device, print, scan, noreply, no-reply, info, account, library, classroom, room, kiosk, chromebook, ipad, cart, test, support, helpdesk, reception, exam, bus, transport, store, sports, ict, it.', reason: 'Shared or device mailbox', enabled: true },
    { type: 'Local part matches regex', value: '\\d{2,}', reason: 'Digits in the local part (device or batch account)', enabled: true },
    { type: 'Local part matches regex', value: '^[a-z]{1,3}$', reason: 'Local part of 1-3 letters', enabled: true },
    { type: 'Name contains', value: 'Lab, Room, Device, Printer, Admin, Office, Account, Class, Block, Desk, Team, Group, Shared', reason: 'Name looks like a place or group', enabled: true },
    { type: 'Name is single token', value: 'TRUE', reason: 'Single-word name', enabled: true },
    { type: 'Domain is', value: '', reason: '', enabled: true },
    { type: 'Exact email', value: '', reason: '', enabled: true },
    { type: 'Honorific', value: 'Mr, Mrs, Ms, Miss, Dr, Rev, Sr, Fr, Prof', reason: 'Stripped from the start of names', enabled: true }
  ],
  allow: [],
  categories: [
    { name: 'Teaching',        teaching: true,  joinKey: 'Staff Code', emailRequired: true },
    { name: 'Admin',           teaching: false, joinKey: 'Staff Code', emailRequired: true },
    { name: 'Support Staff',   teaching: false, joinKey: 'Staff Code', emailRequired: false },
    { name: 'Resource Person', teaching: false, joinKey: 'Name only',  emailRequired: false }
  ],
  hrCategoryMap: [
    { hr: 'Teaching staff',  roster: 'Teaching' },
    { hr: 'Administration',  roster: 'Admin' },
    { hr: 'Support staff',   roster: 'Support Staff' },
    { hr: 'Resource Person', roster: 'Resource Person' }
  ],
  placeholders: ['', 'N/A', 'NA', 'n/a', '-', 'none', 'nil', 'TBD'],
  statusFilter: ['Current'],
  staffCodePattern: '^[SW]0[0-9]{3}$'
};

// ---------- settings --------------------------------------------------

function matchLc_(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
function matchTrim_(v) { return String(v == null ? '' : v).trim(); }
function matchBool_(v, dflt) {
  if (v === true || v === false) return v;
  var s = matchLc_(v);
  if (s === 'true' || s === 'yes' || s === 'y' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === 'n' || s === '0') return false;
  return dflt;
}
function matchList_(v) {
  return String(v == null ? '' : v).split(',').map(matchTrim_).filter(function (x) { return x !== ''; });
}
function matchPick_(raw, key) { return raw && raw[key] !== undefined ? raw[key] : MATCH_DEFAULTS[key]; }

/**
 * Compile a raw settings object (or nothing) into lookup structures.
 * Idempotent: a prepared object is returned as-is.
 */
function matchPrepareSettings(raw) {
  if (raw && raw._matchPrepared) return raw;
  var S = { _matchPrepared: true };
  S.placeholderSet = {};
  S.placeholderSet[''] = true;
  matchPick_(raw, 'placeholders').forEach(function (p) { S.placeholderSet[matchLc_(p)] = true; });

  S.honorSet = {};
  S.allowSet = {};
  S.rules = [];
  matchPick_(raw, 'exclusions').forEach(function (r) {
    if (!r || matchBool_(r.enabled, true) === false) return;
    var type = matchLc_(r.type), val = matchTrim_(r.value), reason = matchTrim_(r.reason);
    if (type === 'honorific') { matchList_(val).forEach(function (h) { S.honorSet[matchLc_(h).replace(/\./g, '')] = true; }); return; }
    if (type === 'allow email') { matchList_(val).forEach(function (e) { S.allowSet[matchLc_(e)] = true; }); return; }
    if (type === 'local part contains') {
      var vs = matchList_(val).map(matchLc_);
      if (vs.length) S.rules.push({ kind: 'localContains', values: vs, reason: reason, label: 'Local part contains ' + val });
    } else if (type === 'local part matches regex') {
      if (!val) return;
      try { S.rules.push({ kind: 'localRegex', re: new RegExp(val, 'i'), reason: reason, label: 'Local part matches /' + val + '/' }); } catch (e) { /* a bad regex row is ignored; Check roster reports it */ }
    } else if (type === 'name contains') {
      var ns = matchList_(val).map(matchLc_);
      if (ns.length) S.rules.push({ kind: 'nameContains', values: ns, reason: reason, label: 'Name contains ' + val });
    } else if (type === 'name is single token') {
      if (matchBool_(val === '' ? true : val, true)) S.rules.push({ kind: 'singleToken', reason: reason, label: 'Name is a single word' });
    } else if (type === 'domain is') {
      var ds = matchList_(val).map(function (d) { return matchLc_(d).replace(/^@/, ''); });
      if (ds.length) S.rules.push({ kind: 'domain', values: ds, reason: reason, label: 'Domain is ' + val });
    } else if (type === 'exact email') {
      var es = matchList_(val).map(matchLc_);
      if (es.length) S.rules.push({ kind: 'exactEmail', values: es, reason: reason, label: 'Exact email ' + val });
    }
  });
  matchPick_(raw, 'allow').forEach(function (a) {
    var e = matchLc_(a && typeof a === 'object' ? a.email : a);
    if (e) S.allowSet[e] = true;
  });

  // Device-like signal (never excludes): seed 'Local part contains' tokens of 3+ letters, matched anywhere.
  S.deviceTokens = [];
  S.rules.forEach(function (r) {
    if (r.kind !== 'localContains') return;
    r.values.forEach(function (v) {
      v = v.replace(/[.\s]+$/, '');
      if (v.length >= 3 && S.deviceTokens.indexOf(v) < 0) S.deviceTokens.push(v);
    });
  });

  S.categories = {};
  matchPick_(raw, 'categories').forEach(function (c) {
    if (!c || !matchTrim_(c.name)) return;
    S.categories[matchLc_(c.name)] = {
      name: matchTrim_(c.name),
      teaching: matchBool_(c.teaching, false),
      nameOnly: matchLc_(c.joinKey) === 'name only',
      emailRequired: matchBool_(c.emailRequired, true)
    };
  });
  S.hrCategoryMap = {};
  matchPick_(raw, 'hrCategoryMap').forEach(function (m) {
    if (m && matchLc_(m.hr)) S.hrCategoryMap[matchLc_(m.hr)] = matchTrim_(m.roster);
  });
  S.statusSet = {};
  matchPick_(raw, 'statusFilter').forEach(function (s) { S.statusSet[matchLc_(s)] = true; });
  S.codePatternSource = matchTrim_(matchPick_(raw, 'staffCodePattern'));
  try { S.codeRe = S.codePatternSource ? new RegExp(S.codePatternSource) : null; S.codePatternBad = false; }
  catch (e) { S.codeRe = null; S.codePatternBad = true; }
  return S;
}

/** D10: true for blank and for any value on the Placeholder list. */
function matchIsPlaceholder(v, settings) {
  return matchPrepareSettings(settings).placeholderSet[matchLc_(v)] === true;
}
/** Trimmed value, or '' when it is a placeholder. */
function matchClean(v, settings) {
  return matchIsPlaceholder(v, settings) ? '' : matchTrim_(v);
}
function matchCleanEmail_(v, S) { var c = matchClean(v, S); return c ? c.toLowerCase() : ''; }
function matchCleanCode_(v, S) { var c = matchClean(v, S); return c ? c.toUpperCase() : ''; }

// ---------- normalisation ---------------------------------------------

/** §5.3: NFKC + lower-case, . , ' - _ to spaces, strip leading honorifics, collapse. */
function matchTokens(name, settings) {
  var S = matchPrepareSettings(settings);
  var s = String(name == null ? '' : name);
  if (s.normalize) s = s.normalize('NFKC');
  s = s.toLowerCase().replace(/[.,'’\-_]/g, ' ');
  var toks = s.split(/\s+/).filter(function (t) { return t !== ''; });
  var i = 0;
  while (i < toks.length - 1 && S.honorSet[toks[i]] === true) i++;
  return toks.slice(i);
}
function matchNormName(name, settings) { return matchTokens(name, settings).join(' '); }

// ---------- exclusions (§5.2) -----------------------------------------

function matchSplitEmail_(email) {
  var e = matchLc_(email), at = e.lastIndexOf('@');
  return at < 0 ? { local: e, domain: '' } : { local: e.slice(0, at), domain: e.slice(at + 1) };
}

/**
 * 'Local part contains' matches a whole dot/underscore/hyphen-delimited segment, optionally followed
 * by digits (lab, lab2, ipad3). A bare substring test would exclude 'asha.example' because of 'exam'.
 * A trailing '.' on the setting value ('it.') is ignored.
 */
function matchSegmentHas_(local, value) {
  var v = value.replace(/[.\s]+$/, '');
  if (!v) return false;
  var re = new RegExp('(^|[._\\-])' + v.replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&') + '[0-9]*($|[._\\-])');
  return re.test(local);
}

/**
 * Is this importHR row a non-person account? Returns null (a person) or
 * {rule, reason}. An email on the Allow list is never excluded.
 */
function matchExclusion(row, settings) {
  var S = matchPrepareSettings(settings);
  var email = matchCleanEmail_(row && row.email, S);
  if (email && S.allowSet[email]) return null;
  var parts = matchSplitEmail_(email), toks = matchTokens(row && row.name, S);
  for (var i = 0; i < S.rules.length; i++) {
    var r = S.rules[i], hit = false;
    if (r.kind === 'localContains') {
      hit = parts.local !== '' && r.values.some(function (v) { return matchSegmentHas_(parts.local, v); });
    } else if (r.kind === 'localRegex') {
      hit = parts.local !== '' && r.re.test(parts.local);
    } else if (r.kind === 'nameContains') {
      hit = toks.some(function (t) { return r.values.indexOf(t) > -1; });   // whole word, not substring
    } else if (r.kind === 'singleToken') {
      hit = toks.length === 1;
    } else if (r.kind === 'domain') {
      hit = parts.domain !== '' && r.values.indexOf(parts.domain) > -1;
    } else if (r.kind === 'exactEmail') {
      hit = email !== '' && r.values.indexOf(email) > -1;
    }
    if (hit) return { rule: r.label, reason: r.reason };
  }
  return null;
}

// ---------- categories, codes ------------------------------------------

/** {name, teaching, nameOnly, emailRequired}; an unknown category requires email and a code. */
function matchCategoryInfo(name, settings) {
  var S = matchPrepareSettings(settings);
  return S.categories[matchLc_(name)] ||
    { name: matchTrim_(name), teaching: false, nameOnly: false, emailRequired: true, unknown: true };
}

/** HR Database category -> {roster:'Admin'} or {unmapped:true, value}. Never guessed. */
function matchMapHrCategory(hrCategory, settings) {
  var S = matchPrepareSettings(settings);
  var m = S.hrCategoryMap[matchLc_(hrCategory)];
  return m ? { roster: m } : { unmapped: true, value: matchTrim_(hrCategory) };
}

/** status 'none' (blank/placeholder), 'ok', or 'warning' (fails the pattern). Placeholders are never errors. */
function matchCodeCheck(code, settings) {
  var S = matchPrepareSettings(settings);
  var c = matchCleanCode_(code, S);
  if (!c) return { status: 'none', code: '' };
  if (!S.codeRe) return { status: S.codePatternBad ? 'warning' : 'ok', code: c };
  return { status: S.codeRe.test(c) ? 'ok' : 'warning', code: c };
}

function matchStatusOk_(rec, S) { return S.statusSet[matchLc_(rec && rec.status)] === true; }

/**
 * Staff Codes shared by two or more Status-filter-passing HR records.
 * Placeholders are excluded. Returns [{code, rows:[HR row numbers or indexes]}].
 */
function matchDuplicateCodes(hrRecords, settings) {
  var S = matchPrepareSettings(settings), by = new Map();
  (hrRecords || []).forEach(function (r, i) {
    if (!matchStatusOk_(r, S)) return;
    var c = matchCleanCode_(r.staffCode, S);
    if (!c) return;
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(r.row != null ? r.row : i);
  });
  var out = [];
  by.forEach(function (rows, code) { if (rows.length > 1) out.push({ code: code, rows: rows }); });
  return out;
}

// ---------- the ladder (§5.4) -------------------------------------------

function matchEntry_(S, src, key, name, email) {
  var toks = matchTokens(name, S);
  var words = toks.filter(function (t) { return t.length > 1; });
  var wordSet = {}, uniq = [];
  words.forEach(function (w) { if (!wordSet[w]) { wordSet[w] = true; uniq.push(w); } });
  var local = email ? matchSplitEmail_(email).local : '';
  return {
    src: src, key: key, i: 0, email: email, tokens: toks, norm: toks.join(' '),
    words: uniq, first: toks.length && toks[0].length > 1 ? toks[0] : '',
    local: local
  };
}

function matchIdxAdd_(map, k, e) { var a = map.get(k); if (a) a.push(e); else map.set(k, [e]); }

function matchBuildIndex_(entries) {
  var ix = { byName: new Map(), byLocal: new Map(), byToken: new Map(), byFirst: new Map() };
  entries.forEach(function (e, i) {
    e.i = i;
    if (e.norm) matchIdxAdd_(ix.byName, e.norm, e);
    if (e.local) matchIdxAdd_(ix.byLocal, e.local, e);
    e.words.forEach(function (w) { matchIdxAdd_(ix.byToken, w, e); });
    if (e.first) matchIdxAdd_(ix.byFirst, e.first, e);
  });
  return ix;
}

/** R2 forms: f.l, fl, f_l, f.l1, f1.l, l.f; with 3+ words, first + each later word. */
function matchLocalForms(name, settings) {
  return matchFormsOf_(matchEntry_(matchPrepareSettings(settings), null, '', name, '').words);
}
function matchFormsOf_(w) {
  var forms = [], seen = {};
  function add(f) { if (!seen[f]) { seen[f] = true; forms.push(f); } }
  for (var i = 1; i < w.length; i++) {
    var f = w[0], l = w[i];
    add(f + '.' + l); add(f + l); add(f + '_' + l);
    add(f + '.' + l.charAt(0)); add(f.charAt(0) + '.' + l); add(l + '.' + f);
  }
  return forms;
}

function matchRestLetters_(toks) { return toks.slice(1).map(function (t) { return t.charAt(0); }); }
function matchInitialsAgree_(q, e) {
  var qi = q.tokens.slice(1).filter(function (t) { return t.length === 1; });
  var ei = e.tokens.slice(1).filter(function (t) { return t.length === 1; });
  var qr = matchRestLetters_(q.tokens), er = matchRestLetters_(e.tokens);
  var qIn = qi.length > 0 && qi.every(function (c) { return er.indexOf(c) > -1; });
  var eIn = ei.length > 0 && ei.every(function (c) { return qr.indexOf(c) > -1; });
  return qIn || eIn;
}

/** Collect distinct (by key) entries, ordered by index. */
function matchDistinct_(list) {
  var seen = {}, out = [];
  list.forEach(function (e) { if (!seen[e.key]) { seen[e.key] = true; out.push(e); } });
  out.sort(function (a, b) { return a.i - b.i; });
  return out;
}

/** First rung that yields a result wins. Returns {rung, hits}. */
function matchLadder_(S, ix, q, stats, r1Only) {
  var hits = matchDistinct_(ix.byName.get(q.norm) || []);
  stats.examined += hits.length;
  if (q.norm && hits.length) return { rung: 'R1', hits: hits };
  if (r1Only) return { rung: '', hits: [] };      // D11: name-only categories join on the exact normalised name

  var forms = matchFormsOf_(q.words), r2 = [];
  forms.forEach(function (f) { var a = ix.byLocal.get(f); if (a) { stats.examined += a.length; r2 = r2.concat(a); } });
  hits = matchDistinct_(r2);
  if (hits.length) return { rung: 'R2', hits: hits };

  var counts = new Map(), r3 = [];
  q.words.forEach(function (w) {
    var a = ix.byToken.get(w);
    if (!a) return;
    stats.examined += a.length;
    a.forEach(function (e) { counts.set(e, (counts.get(e) || 0) + 1); });
  });
  counts.forEach(function (n, e) { if (n >= 2) r3.push(e); });
  var firstList = q.first ? (ix.byFirst.get(q.first) || []) : [];
  stats.examined += firstList.length;
  firstList.forEach(function (e) { if (matchInitialsAgree_(q, e)) r3.push(e); });
  hits = matchDistinct_(r3);
  hits.sort(function (a, b) { return ((counts.get(b) || 0) - (counts.get(a) || 0)) || (a.i - b.i); });
  if (hits.length) return { rung: 'R3', hits: hits };

  hits = matchDistinct_(firstList);
  if (hits.length) return { rung: 'R4', hits: hits };
  return { rung: '', hits: [] };
}

var MATCH_RULE_LABELS = { R1: 'R1 Exact name', R2: 'R2 Email local part', R3: 'R3 Token set', R4: 'R4 Weak (first name only)' };

function matchClassOf_(rung, n) {
  if (!rung) return 'Unmatched';
  if (n > 1 || rung === 'R4') return 'Ambiguous';
  return rung === 'R1' ? 'Confirmed-exact' : 'Candidate';
}

function matchQuery_(S, displayName) {
  var e = matchEntry_(S, null, '', displayName, '');
  return e;
}

/**
 * Device-like signal (never excludes). Rule: take the address local part, REMOVE every word of the matched
 * roster person's own normalised name: split the local part into alphabetic runs (digits and punctuation are
 * boundaries) and drop each WHOLE run that equals a name word or a concatenation of consecutive name words
 * ('example', 'ashaexample'). Never a substring inside a longer run: 'cart' is kept for 'Art Teacher'. A seed
 * token of 3+ letters flags the address when a run equals it, starts with it or ends with it, so 'ipadcart1' -> run
 * 'ipadcart' -> 'ipad', and 'lab2' -> 'lab', but 'asha.example.alt' for Asha Example leaves only 'alt', and
 * 'labanya.example' for Labanya Example leaves nothing. Returns the token or ''.
 */
function matchRunHasToken_(run, t) {
  return run === t || run.indexOf(t) === 0 || (run.length > t.length && run.lastIndexOf(t) === run.length - t.length);
}
function matchDeviceToken_(local, nameWords, S) {
  if (!local || !S.deviceTokens.length) return '';
  var own = {};                                     // the person's name words and runs of consecutive words ('ashaexample')
  for (var i = 0; i < nameWords.length; i++) for (var j = i, cat = ''; j < nameWords.length; j++) { cat += nameWords[j]; own[cat] = true; }
  var runs = (local.match(/[a-z]+/g) || []).filter(function (r) { return own[r] !== true; });   // whole runs only, never a substring
  for (var k = 0; k < runs.length; k++)
    for (var d = 0; d < S.deviceTokens.length; d++)
      if (matchRunHasToken_(runs[k], S.deviceTokens[d])) return S.deviceTokens[d];
  return '';
}

/** 'r***@domain': enough to recognise, never the full address. */
function matchMaskEmail_(e) {
  var p = matchSplitEmail_(e);
  return (p.local ? p.local.charAt(0) : '') + '***' + (p.domain ? '@' + p.domain : '');
}

function matchActive_(r) { return !(r && (r.active === false || matchLc_(r.active) === 'false' || matchLc_(r.active) === 'no')); }

/** An older row with Active=FALSE (Left On is informational, D2) whose Replaced By names the other row's Display Name, or the reverse. */
function matchChained_(a, b) {
  function link(old, nw) {
    return !!old && !!nw && !matchActive_(old) &&
      matchTrim_(old.replacedBy) !== '' && matchLc_(old.replacedBy) === matchLc_(nw.displayName);
  }
  return link(a, b) || link(b, a);
}
/** True when any two of these rows are different people (only a rename chain makes two rows one person). */
function matchConflict_(rows) {
  for (var i = 0; i < rows.length; i++) for (var j = i + 1; j < rows.length; j++) if (!matchChained_(rows[i], rows[j])) return true;
  return false;
}

function matchCounts_(results) {
  var c = {};
  results.forEach(function (r) { c[r.class] = (c[r.class] || 0) + 1; });
  return c;
}

// ---------- Email target: roster -> importHR ---------------------------

/**
 * Match roster rows to importHR accounts.
 * @param {Object[]} rosterRows
 * @param {Object[]} importHrRows  {name, email, row}
 * @param {Object}   settings
 * @return {{results:Object[], excluded:Object[], counts:Object, duplicateEmails:string[], stats:Object}}
 *   results[i] lines up with rosterRows[i]:
 *   {link:'Email', displayName, category, row, class, rung, rule, candidates:[{name,email,row}] (max 3),
 *    candidateCount, excludedBy, note, demoted, prefill:'Accept'|''}
 *   class: 'Confirmed-exact' | 'Candidate' | 'Ambiguous' | 'Unmatched' | 'No email expected'
 *          | 'Already confirmed' | 'Name only'
 */
function matchEmailLinks(rosterRows, importHrRows, settings) {
  var S = matchPrepareSettings(settings), stats = { examined: 0 };
  var entries = [], excludedByName = new Map(), excluded = [], emailSeen = {}, dupEmails = {};
  (importHrRows || []).forEach(function (r, idx) {
    var email = matchCleanEmail_(r && r.email, S);
    if (!email) return;                                  // no address: cannot be a candidate
    if (emailSeen[email]) dupEmails[email] = true; else emailSeen[email] = true;
    var ex = matchExclusion(r, S);
    if (ex) {
      excluded.push({ name: r.name, email: email, row: r.row, rule: ex.rule, reason: ex.reason });
      var en = matchNormName(r.name, S);
      if (en) matchIdxAdd_(excludedByName, en, { rule: ex.rule, name: r.name, email: email, row: r.row });
      return;
    }
    entries.push(matchEntry_(S, r, email, r.name, email));   // key = email: one account, however many rows
  });
  var ix = matchBuildIndex_(entries);

  var results = (rosterRows || []).map(function (r) {
    var cat = matchCategoryInfo(r.category, S);
    var res = { link: 'Email', displayName: r.displayName, category: r.category, row: r.row, class: '', rung: '', rule: '',
      candidates: [], candidateCount: 0, excludedBy: '', note: '', deviceLike: false, heldDifferent: false, writeEmail: true, demoted: false, prefill: '', proposedEmail: '' };
    if (cat.nameOnly) { res.class = 'Name only'; res.note = 'Name-match-only category: no email is taken from any source'; return res; }
    if (matchLc_(r.matchStatus) === 'confirmed') { res.class = 'Already confirmed'; return res; }
    var q = matchQuery_(S, r.displayName);
    if (!q.norm) { res.class = 'Unmatched'; res.note = 'Blank Display Name'; return res; }
    var lad = matchLadder_(S, ix, q, stats);
    res.rung = lad.rung;
    res.rule = MATCH_RULE_LABELS[lad.rung] || '';
    res.candidateCount = lad.hits.length;
    res.candidates = lad.hits.slice(0, 3).map(function (e) { return { name: e.src.name, email: e.email, row: e.src.row }; });
    res.class = matchClassOf_(lad.rung, lad.hits.length);
    var devHits = [];
    lad.hits.slice(0, 3).forEach(function (e, k) {
      e.devTok = matchDeviceToken_(e.local, q.words, S);
      res.candidates[k].deviceLike = e.devTok !== '';
      if (e.devTok) devHits.push(e);
    });
    if (devHits.length) {
      res.deviceLike = true;
      res.note = 'Device-like address (contains "' + devHits[0].devTok + '"): confirm by hand';
      if (res.class === 'Confirmed-exact') res.class = 'Candidate';
    }
    if (lad.rung !== 'R1') {
      var ex = excludedByName.get(q.norm);
      if (ex) {                                           // exact name, but only as an excluded account
        res.class = 'Ambiguous';
        res.excludedBy = ex[0].rule;
        res.note = 'Only exact name match is an excluded account (' + ex[0].rule + ')';
        if (!lad.rung) res.rule = 'R1 Exact name (excluded account)';
      }
    }
    if (res.class === 'Unmatched' && !cat.emailRequired) { res.class = 'No email expected'; }
    if ((res.class === 'Confirmed-exact' || res.class === 'Candidate') && lad.hits.length === 1) res.proposedEmail = lad.hits[0].email;
    var own = matchCleanEmail_(r.email, S);
    if (res.proposedEmail && own && own !== res.proposedEmail) {      // R9: never overwrite a different email
      res.heldDifferent = true; res.writeEmail = false;
      if (res.class === 'Confirmed-exact') res.class = 'Candidate';
      res.note = (res.note ? res.note + '; ' : '') + 'Row already has a different email (' + matchMaskEmail_(own) + '): confirm by hand';
    }
    return res;
  });

  // Uniqueness pass. (1) An email already on an Active roster row (any Match Status) cannot be proposed to another row.
  // (2) One email proposed for two or more Active rows conflicts. Only a rename chain makes two rows one person.
  var rows = rosterRows || [], held = new Map();
  rows.forEach(function (r, i) {
    var e = matchCleanEmail_(r.email, S);
    if (e && matchActive_(r)) matchIdxAdd_(held, e, i);          // any Match Status: a typed email is held
  });
  results.forEach(function (res, i) {
    if (!res.proposedEmail || !matchActive_(rows[i])) return;
    var holders = (held.get(res.proposedEmail) || []).filter(function (j) { return j !== i && !matchChained_(rows[i], rows[j]); });
    if (holders.length) {
      res.class = 'Ambiguous'; res.demoted = true; res.writeEmail = false;
      res.note = 'Email already held by ' + holders.map(function (j) { return rows[j].displayName; }).join(', ');
    }
  });
  var byEmail = new Map();
  results.forEach(function (res, i) {
    if (!res.proposedEmail || !matchActive_(rows[i])) return;
    matchIdxAdd_(byEmail, res.proposedEmail, i);
  });
  byEmail.forEach(function (idxs, email) {
    if (idxs.length < 2) return;
    if (!matchConflict_(idxs.map(function (i) { return rows[i]; }))) return;
    var names = idxs.map(function (i) { return rows[i].displayName; }).join(', ');
    idxs.forEach(function (i) {
      results[i].class = 'Ambiguous'; results[i].demoted = true; results[i].writeEmail = false;
      results[i].note = 'Same email proposed for ' + idxs.length + ' rows: ' + names;
    });
  });
  results.forEach(function (res) { if (res.class === 'Confirmed-exact') res.prefill = 'Accept'; });

  return { results: results, excluded: excluded, counts: matchCounts_(results),
    duplicateEmails: Object.keys(dupEmails).sort(), stats: stats };
}

// ---------- Staff Code target: roster -> HR Database (§5.8) ------------

/**
 * Match roster rows to HR Database records.
 * @param {Object[]} rosterRows
 * @param {Object[]} hrRecords   output of readHrDatabase_() (whitelisted fields)
 * @param {Object}   settings
 * @param {Object}   [opts]  {emailByName: {displayName: email}}  the roster's confirmed Email or the importHR
 *                           candidate chosen for the row; default is row.email when Match Status = Confirmed.
 * @return {{results:Object[], counts:Object, duplicateCodes:Object[], stats:Object}}
 *   results[i]: {link:'Staff Code', displayName, category, row, class, rung, rule,
 *     candidates:[{name, staffCode, hrCategory, rosterCategory, unmappedCategory, department, teamRole, row,
 *                  codeStatus:'ok'|'pattern warning'|'No code in HR Database'|'Name only'|'Code already on another row',
 *                  corroboration:''|'Corroborated'|'Conflict', categoryConflict, evidence}] (max 3),
 *     candidateCount, hitIndexes (indexes into hrRecords, R1-R3 hits), evidence, note, demoted,
 *     writeCode (false for name-only rows and rows that already hold a code), prefill:'Accept'|''}
 */
function matchStaffCodeLinks(rosterRows, hrRecords, settings, opts) {
  var S = matchPrepareSettings(settings), stats = { examined: 0 };
  var emailByName = (opts && opts.emailByName) || {};
  var recs = hrRecords || [], entries = [];
  var dups = matchDuplicateCodes(recs, S), dupSet = {};
  dups.forEach(function (d) { dupSet[d.code] = true; });
  recs.forEach(function (r, idx) {
    if (!r || !matchStatusOk_(r, S)) return;              // R30: only Status-filter rows are used
    entries.push(matchEntry_(S, r, 'h' + idx, r.name, matchCleanEmail_(r.officialEmail, S)));
    entries[entries.length - 1].idx = idx;
  });
  var ix = matchBuildIndex_(entries);

  var rows = rosterRows || [], codeHolders = new Map();
  rows.forEach(function (r, i) { var c = matchCleanCode_(r.staffCode, S); if (c) matchIdxAdd_(codeHolders, c, i); });

  var results = rows.map(function (r, ri) {
    var cat = matchCategoryInfo(r.category, S);
    var ownCode = matchCleanCode_(r.staffCode, S);
    var res = { link: 'Staff Code', displayName: r.displayName, category: r.category, row: r.row, class: '', rung: '', rule: '',
      candidates: [], candidateCount: 0, hitIndexes: [], evidence: '', note: '', demoted: false,
      writeCode: !cat.nameOnly && !ownCode, prefill: '', _hrIdx: -1 };
    var q = matchQuery_(S, r.displayName);
    if (!q.norm) { res.class = 'Unmatched'; res.note = 'Blank Display Name'; return res; }
    var lad = matchLadder_(S, ix, q, stats, cat.nameOnly);
    res.rung = lad.rung;
    res.rule = MATCH_RULE_LABELS[lad.rung] || '';
    res.candidateCount = lad.hits.length;
    res.class = matchClassOf_(lad.rung, lad.hits.length);
    if (lad.rung && lad.rung !== 'R4') res.hitIndexes = lad.hits.map(function (e) { return e.idx; });
    if (lad.hits.length === 1 && lad.rung !== 'R4') res._hrIdx = lad.hits[0].idx;
    var rosterEmail = matchCleanEmail_(emailByName[r.displayName] !== undefined ? emailByName[r.displayName]
      : (matchLc_(r.matchStatus) === 'confirmed' ? r.email : ''), S);

    res.candidates = lad.hits.slice(0, 3).map(function (e) {
      var rec = e.src, map = matchMapHrCategory(rec.category, S), chk = matchCodeCheck(rec.staffCode, S);
      var c = { name: rec.name, staffCode: cat.nameOnly ? '' : chk.code, hrCategory: matchTrim_(rec.category),
        rosterCategory: map.roster || '', unmappedCategory: !!map.unmapped,
        department: matchClean(rec.department, S), teamRole: matchClean(rec.teamRole, S), row: rec.row,
        codeStatus: '', corroboration: '', categoryConflict: false, evidence: '' };
      var ev = [];
      if (cat.nameOnly) { c.codeStatus = 'Name only'; }
      else if (chk.status === 'none') { c.codeStatus = 'No code in HR Database'; ev.push(c.codeStatus); }
      else if (chk.status === 'warning') { c.codeStatus = 'pattern warning'; ev.push('Pattern warning'); }
      else { c.codeStatus = 'ok'; }
      if (!cat.nameOnly && chk.code) {
        var holders = (codeHolders.get(chk.code) || []).filter(function (i) { return i !== ri && !matchChained_(r, rows[i]); });
        if (holders.length) { c.codeStatus = 'Code already on another row'; ev.push('Code already on another roster row'); }
        if (dupSet[chk.code]) ev.push('Code shared by several HR Database rows');
      }
      if (!cat.nameOnly && rosterEmail && e.email) {
        c.corroboration = e.email === rosterEmail ? 'Corroborated' : 'Conflict';
        ev.push(c.corroboration);
      }
      if (map.unmapped) ev.push('Unmapped category: ' + map.value);
      else if (matchLc_(map.roster) !== matchLc_(r.category)) { c.categoryConflict = true; ev.push('Category conflict (HR: ' + map.roster + ')'); }
      c.evidence = ev.join('; ');
      return c;
    });
    if (res.candidates.length === 1 || (res.candidates.length && res.class !== 'Ambiguous')) res.evidence = res.candidates[0].evidence;
    return res;
  });

  // Uniqueness pass: one HR row proposed for 2+ distinct people, or a shared Staff Code, demotes everyone involved.
  var byHr = new Map();
  results.forEach(function (res, i) {
    if (res._hrIdx < 0 || !matchActive_(rows[i])) return;
    matchIdxAdd_(byHr, res._hrIdx, i);
  });
  function demote_(i, note) { var x = results[i]; x.class = 'Ambiguous'; x.demoted = true; x.note = note; }
  byHr.forEach(function (idxs, hrIdx) {
    if (idxs.length >= 2 && matchConflict_(idxs.map(function (i) { return rows[i]; }))) {
      var names = idxs.map(function (i) { return rows[i].displayName; }).join(', ');
      idxs.forEach(function (i) { demote_(i, 'Same HR Database row proposed for ' + idxs.length + ' rows: ' + names); });
    }
  });
  // A proposed code already held by another roster row (any status) is a conflict, unless a rename chain links them.
  results.forEach(function (res, i) {
    if (res._hrIdx < 0 || res.demoted || matchCategoryInfo(rows[i].category, S).nameOnly) return;
    var code = matchCleanCode_(recs[res._hrIdx].staffCode, S);
    if (!code) return;
    var holders = (codeHolders.get(code) || []).filter(function (j) { return j !== i && !matchChained_(rows[i], rows[j]); });
    if (holders.length) demote_(i, 'Staff Code ' + code + ' already held by ' + holders.map(function (j) { return rows[j].displayName; }).join(', '));
  });
  var byCode = new Map();
  results.forEach(function (res, i) {
    if (res._hrIdx < 0 || !matchActive_(rows[i]) || res.demoted) return;
    var code = matchCleanCode_(recs[res._hrIdx].staffCode, S);
    if (code && !matchCategoryInfo(rows[i].category, S).nameOnly) matchIdxAdd_(byCode, code, i);
  });
  results.forEach(function (res, i) {
    if (res._hrIdx < 0 || res.demoted || matchCategoryInfo(rows[i].category, S).nameOnly) return;   // every roster row, Active or not
    var code = matchCleanCode_(recs[res._hrIdx].staffCode, S);
    if (code && dupSet[code]) demote_(i, 'Staff Code ' + code + ' is shared by several HR Database rows');
  });
  byCode.forEach(function (idxs, code) {
    if (idxs.length < 2) return;
    if (!matchConflict_(idxs.map(function (i) { return rows[i]; }))) return;
    idxs.forEach(function (i) { if (!results[i].demoted) demote_(i, 'Staff Code ' + code + ' proposed for ' + idxs.length + ' rows'); });
  });

  results.forEach(function (res) {
    var c = res.candidates[0];
    if (res.class === 'Confirmed-exact' && res.writeCode && c &&
        c.codeStatus !== 'pattern warning' && c.codeStatus !== 'Code already on another row' &&
        c.corroboration !== 'Conflict' && !c.categoryConflict && !c.unmappedCategory && !dupSet[c.staffCode]) res.prefill = 'Accept';
    if (!res.writeCode && !res.note) res.note = res.category && matchCategoryInfo(res.category, S).nameOnly
      ? 'Name-match-only category: no code is taken' : 'Staff Code already set (blank-only writes)';
    delete res._hrIdx;
  });

  var counts = matchCounts_(results);
  var warn = 0, corr = 0;
  results.forEach(function (res) {
    var c = res.candidates[0];
    if (c && c.codeStatus === 'pattern warning') warn++;
    if (c && c.corroboration === 'Corroborated' && res.class !== 'Ambiguous') corr++;
  });
  counts.patternWarnings = warn; counts.corroborated = corr;
  return { results: results, counts: counts, duplicateCodes: dups, stats: stats };
}

// ---------- Propose add (D4, D11, R32) ----------------------------------

/**
 * HR records that pass the Status filter, map to a NON-teaching category and link to no roster row.
 * Linked = appears among the R1-R3 hits of any roster row's Staff Code result (weak first-name-only
 * hits do not hide a genuinely new person). Name-match-only categories never carry a code or email,
 * even when the HR record has one.
 * @param {Object[]} hrRecords
 * @param {Object[]} staffCodeResults  matchStaffCodeLinks(...).results
 * @param {Object}   settings
 * @return {{proposals:Object[], unmapped:string[], counts:Object}}
 *   proposals[i]: {link:'Propose add', displayName, hrName, category, department, teamRole, staffCode,
 *     officialEmail, codeStatus, nameOnly, flags:[string], row, hrIndex}
 */
function matchProposeAdds(hrRecords, staffCodeResults, settings) {
  var S = matchPrepareSettings(settings), linked = {}, recs = hrRecords || [];
  (staffCodeResults || []).forEach(function (res) { (res.hitIndexes || []).forEach(function (i) { linked[i] = true; }); });
  var dupSet = {};
  matchDuplicateCodes(recs, S).forEach(function (d) { dupSet[d.code] = true; });
  var out = [], unmapped = {}, byCat = {}, nameCount = {};
  recs.forEach(function (rec, idx) {
    if (!rec || !matchStatusOk_(rec, S) || linked[idx]) return;
    var map = matchMapHrCategory(rec.category, S);
    if (map.unmapped) { unmapped[map.value] = true; return; }
    var cat = matchCategoryInfo(map.roster, S);
    if (cat.teaching) return;                              // Teaching rows come only from the Allotment
    var nameOnly = cat.nameOnly, chk = matchCodeCheck(rec.staffCode, S), flags = [], status = 'ok';
    if (nameOnly) status = 'Name only';
    else if (chk.status === 'none') { status = 'No code in HR Database'; flags.push(status); }
    else if (chk.status === 'warning') { status = 'pattern warning'; flags.push('Pattern warning'); }
    if (!nameOnly && chk.code && dupSet[chk.code]) flags.push('Code shared by several HR Database rows');
    var name = matchTrim_(rec.name);
    var p = { link: 'Propose add', displayName: name, hrName: name, category: cat.name,
      department: matchClean(rec.department, S), teamRole: matchClean(rec.teamRole, S),
      staffCode: nameOnly ? '' : chk.code, officialEmail: nameOnly ? '' : matchCleanEmail_(rec.officialEmail, S),
      codeStatus: status, nameOnly: nameOnly, flags: flags, row: rec.row, hrIndex: idx };
    out.push(p);
    byCat[cat.name] = (byCat[cat.name] || 0) + 1;
    var nk = matchNormName(name, S);
    nameCount[nk] = (nameCount[nk] || 0) + 1;
  });
  out.forEach(function (p) {
    if (nameCount[matchNormName(p.hrName, S)] > 1) p.flags.push('Name shared with another proposed row: give one a distinguishing Display Name');
  });
  return { proposals: out, unmapped: Object.keys(unmapped).sort(), counts: byCat };
}
