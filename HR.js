/**
 * ============================================================
 * HR.gs — Map teacher name -> email / Chat user id
 * Reads the 👥 importHR tab (you can IMPORTRANGE your HR database into it).
 *
 * resolveContact_(name) is the ONLY way notifications find a person's
 * email or Chat user id (PRD D7). Roster first, then importHR by EXACT name.
 * There is no prefix or substring matching anywhere in this file.
 * ============================================================
 */

function hrKey_(name) { return String(name).trim().toLowerCase().replace(/\s+/g, ' '); }

/**
 * Column (1-based) of a header in the importHR header row: the exact header key
 * (case and space folded). Only when `allowPrefix` is true (the Chat User ID header,
 * which carries a suffix such as "(users/123…)") the left-most header that starts with
 * it is also accepted. Teacher Name and Email never prefix-match, so "Email Verified"
 * is not an address column. 0 when absent.
 */
function hrFindHeader_(at, name, allowPrefix) {
  var k = rosterHeaderKey_(name);
  if (at[k]) return at[k];
  if (!allowPrefix) return 0;
  var best = 0;
  for (var h in at) if (h.indexOf(k) === 0 && (!best || at[h] < best)) best = at[h];
  return best;
}

/**
 * Every 👥 importHR row as { name, key, email, chatId, row }, read ONCE per run
 * (header row and data in one getValues). Columns are found by header name
 * (Teacher Name / Email / Chat User ID). Only if one of those headers cannot be
 * found are the ⚙️ Config column numbers (HR Col: Name / Email / Chat User ID)
 * used instead, and then usedFallback is true with the reason in `fallbackReason`.
 *
 * Returns { ok, reason, rows, byKey: {hrKey: [rec]}, byEmail: {email: [rec]},
 *           usedFallback, fallbackReason }.
 */
function readImportHrContacts_() {
  return memo('importHrContacts', function () {
    var out = { ok: false, reason: '', rows: [], byKey: Object.create(null), byEmail: Object.create(null),
                usedFallback: false, fallbackReason: '', missingHeaders: [] };
    var sheet = sheet_(SS.IMPORT_HR);
    if (!sheet || sheet.getLastRow() < 3) { out.reason = '👥 importHR is missing or empty'; return out; }   // row 1 title, row 2 headers, data row 3+
    var lastCol = Math.max(1, sheet.getLastColumn());
    var grid = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    var at = rosterHeaderCols_(grid[0]);
    var cName = hrFindHeader_(at, 'Teacher Name'), cEmail = hrFindHeader_(at, 'Email'), cChat = hrFindHeader_(at, 'Chat User ID', true);
    if (!cName || !cEmail || !cChat) {
      var missing = [['Teacher Name', cName], ['Email', cEmail], ['Chat User ID', cChat]]
        .filter(function (h) { return !h[1]; }).map(function (h) { return h[0]; });
      var cfg = getConfig();
      cName = cfg.hrNameCol; cEmail = cfg.hrEmailCol; cChat = cfg.hrChatCol;
      out.usedFallback = true;
      out.missingHeaders = missing;
      out.fallbackReason = 'importHR read by column position: header "' + missing.join('", "') + '" not found in row 2, so the Config column numbers were used for all three.';
    }
    var ph = readRosterSettings_().placeholders;
    var cell = function (r, c) { return c >= 1 && c <= lastCol ? r[c - 1] : ''; };
    for (var i = 1; i < grid.length; i++) {
      var name = norm_(cell(grid[i], cName));
      if (!name) continue;
      var emailRaw = norm_(cell(grid[i], cEmail)), chatRaw = norm_(cell(grid[i], cChat));
      var rec = { name: name, key: hrKey_(name),
                  email: isPlaceholder_(emailRaw, ph) ? '' : emailRaw.toLowerCase(),
                  chatId: isPlaceholder_(chatRaw, ph) ? '' : chatRaw, row: i + 2 };
      out.rows.push(rec);
      (out.byKey[rec.key] = out.byKey[rec.key] || []).push(rec);
      if (rec.email) (out.byEmail[rec.email] = out.byEmail[rec.email] || []).push(rec);
    }
    out.ok = true;
    return out;
  });
}

/**
 * The importHR account for `name`, by EXACT normalised name only: the single
 * non-excluded row with that name. Returns { rec, ambiguous, reason }; rec is null
 * unless exactly one account qualifies. `S` is the roster settings (exclusion rules).
 */
function hrNameMatch_(hr, name, S) {
  var none = function (why, amb) { return { rec: null, ambiguous: !!amb, reason: why }; };
  if (!hr.ok) return none(hr.reason);
  var list = hr.byKey[hrKey_(name)] || [];
  if (!list.length) return none('no exact name match in 👥 importHR');
  var people = [], why = '';
  list.forEach(function (r) {
    var ex = matchExclusion({ name: r.name, email: r.email }, S);
    if (ex) why = ex.reason || ex.rule; else people.push(r);
  });
  if (!people.length) return none('the only 👥 importHR account with this name looks like a shared or device account (' + why + ')');
  if (people.length > 1) return none(people.length + ' accounts in 👥 importHR share this name', true);
  return { rec: people[0], ambiguous: false, reason: '' };
}

/**
 * Resolve a person's contact for a notification (PRD D7, R14). Order:
 *   1. the roster row's CONFIRMED Email (never a candidate); the Chat id is then
 *      the importHR account with that exact email;
 *   2. otherwise the single non-excluded importHR row whose normalised name is
 *      EXACTLY this name;
 *   3. otherwise nothing.
 * A name-only category (Resource Person) and a duplicated roster name resolve to
 * nothing. Reads importHR once per run; results are memoised per name.
 *
 * Returns { email, chatId, source: 'roster' | 'importHR' | 'none', ambiguous, reason,
 *           columnFallback }. `reason` says why source is 'none' (or why there is no Chat id);
 *           `columnFallback` is true when importHR was read by Config column numbers.
 */
function resolveContact_(name) {
  var nm = norm_(name);
  return memo('contact:' + nm, function () {
    var hr = readImportHrContacts_();
    var res = { email: '', chatId: '', source: 'none', ambiguous: false, reason: '', columnFallback: hr.usedFallback };
    var rk = rosterJoinKeys_(nm);
    if (rk.found && rk.ambiguous) {
      res.ambiguous = true; res.reason = 'this name is on more than one roster row';
      return res;
    }
    if (rk.found && rk.nameOnly) {
      res.reason = rk.category + ' has no email or Chat id by design';
      return res;
    }
    if (rk.found && rk.staffEmail) {
      res.email = rk.staffEmail; res.source = 'roster';
      var same = (hr.ok && hr.byEmail[String(rk.staffEmail).toLowerCase()]) || [];
      var ids = [];
      same.forEach(function (r) { if (r.chatId && ids.indexOf(r.chatId) < 0) ids.push(r.chatId); });
      if (ids.length === 1) res.chatId = ids[0];
      else res.reason = ids.length ? 'the email is on several 👥 importHR accounts with different Chat ids' : 'no Chat id in 👥 importHR for the confirmed email';
      return res;
    }
    var m = hrNameMatch_(hr, nm, readRosterSettings_());
    if (!m.rec) { res.ambiguous = m.ambiguous; res.reason = (rk.found ? 'no confirmed email on the roster, and ' : 'not on the roster, and ') + m.reason; return res; }
    if (!m.rec.email && !m.rec.chatId) { res.reason = 'the 👥 importHR row has no email and no Chat id'; return res; }
    res.email = m.rec.email; res.chatId = m.rec.chatId; res.source = 'importHR';
    return res;
  });
}
