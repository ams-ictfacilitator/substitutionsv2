/**
 * ============================================================
 * HrDirectory.gs — Get Google Chat user IDs the easy way.
 *
 * A Chat user id ("users/NNN") is just the user's Google Workspace
 * Directory id. So we can fetch them straight from Google instead of
 * hunting for each one by hand.
 *
 *   • showMyChatId()           — your own id (People API, no admin needed)
 *   • populateHrFromDirectory()— everyone's id (Admin SDK, Workspace admin)
 *
 * Both advanced services are OFF until you add them:
 *   editor → Services (➕) → "People API" and/or "Admin SDK API".
 * ============================================================
 */

/**
 * Show YOUR own Chat user id and offer to save it for the DM test.
 * Uses the People API ("people/me") — any signed-in user can run this.
 */
function showMyChatId() {
  var ui = SpreadsheetApp.getUi();
  if (typeof People === 'undefined') {
    ui.alert('Add the People API',
      'Editor → Services (➕) → add "People API", then run 🆔 Show my Chat ID again.',
      ui.ButtonSet.OK);
    return;
  }
  try {
    var me = People.People.get('people/me', { personFields: 'names,emailAddresses' });
    var id = String(me.resourceName || '').replace('people/', '');
    if (!id) { ui.alert('Could not read your id from the People API.'); return; }
    var chatId = 'users/' + id;
    var email = (me.emailAddresses && me.emailAddresses[0] && me.emailAddresses[0].value) || activeEmail_();

    var ans = ui.alert('🆔 Your Chat user id',
      chatId + '\n(' + email + ')\n\nSave this to ⚙️ Config → "Test Chat User ID" so 💬 Test Chat DM can use it?',
      ui.ButtonSet.YES_NO);
    if (ans === ui.Button.YES) {
      setConfigValue_('Test Chat User ID', chatId);
      toast_('Saved. Now run 💬 Test Chat DM to confirm it works.', '✅', 8);
    }
  } catch (e) {
    ui.alert('Could not read your id', e.message +
      '\n\nMake sure the People API advanced service is added and authorised.', ui.ButtonSet.OK);
  }
}

/* ───────── directory access strategies ───────── */

/**
 * Ways to ask for the user list, most complete first. The Directory API is
 * fussy: `viewType: 'admin_view'` needs full admin rights, `customer:
 * 'my_customer'` only resolves for an admin, and `orderBy` is rejected in
 * some domain configurations. We probe each in turn rather than guess.
 */
function directoryStrategies_() {
  var domain = String(activeEmail_() || '').split('@')[1] || '';
  var list = [
    { name: 'Admin view, whole customer, sorted',
      params: { customer: 'my_customer', projection: 'basic', orderBy: 'familyName', viewType: 'admin_view' } },
    { name: 'Admin view, whole customer',
      params: { customer: 'my_customer', projection: 'basic' } },
  ];
  if (domain) {
    list.push({ name: 'Admin view, domain ' + domain,
      params: { domain: domain, projection: 'basic' } });
    list.push({ name: 'Domain-public view, ' + domain + ' (no admin rights needed)',
      params: { domain: domain, projection: 'basic', viewType: 'domain_public' } });
  }
  return list;
}

/** Merge params and page size without ever sending a null pageToken. */
function directoryParams_(params, size, token) {
  var p = {};
  for (var k in params) p[k] = params[k];
  p.maxResults = size;
  if (token) p.pageToken = token;      // sending pageToken:null is what caused "Unknown Error"
  return p;
}

/** One-row probe. Returns {ok:true} or {ok:false, error:'…'}. */
function probeDirectory_(params) {
  try {
    AdminDirectory.Users.list(directoryParams_(params, 1, null));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** Page the full list with a strategy already known to work. */
function fetchDirectoryUsers_(params) {
  var rows = [], token = null, pages = 0;
  do {
    var res = AdminDirectory.Users.list(directoryParams_(params, 500, token));
    (res.users || []).forEach(function (u) {
      if (u.suspended) return;
      var name = (u.name && u.name.fullName) || u.primaryEmail;
      if (!name || !u.id) return;
      rows.push([name, u.primaryEmail, 'users/' + u.id]);
    });
    token = res.nextPageToken;
  } while (token && ++pages < 40);
  return rows;
}

/** Try each strategy until one probes clean. Returns {strategy, attempts}. */
function pickDirectoryStrategy_() {
  var attempts = [], strategies = directoryStrategies_();
  for (var i = 0; i < strategies.length; i++) {
    var r = probeDirectory_(strategies[i].params);
    attempts.push({ name: strategies[i].name, ok: r.ok, error: r.error || '' });
    if (r.ok) return { strategy: strategies[i], attempts: attempts };
  }
  return { strategy: null, attempts: attempts };
}

/* ───────── the import ───────── */

/**
 * Fill 👥 importHR with Name / Email / Chat user id for the whole Workspace.
 * Requires the AdminDirectory advanced service (declared in appsscript.json)
 * and enough directory rights on the account running the script.
 */
function populateHrFromDirectory() {
  var ui = SpreadsheetApp.getUi();
  if (typeof AdminDirectory === 'undefined') {
    ui.alert('Admin SDK service not available',
      'The "AdminDirectory" service did not load. It must be declared in\n' +
      'appsscript.json — adding it in the editor is undone by the next\n' +
      'clasp push, which overwrites that file.\n\n' +
      'Expected entry under dependencies.enabledAdvancedServices:\n' +
      '  { "userSymbol": "AdminDirectory",\n' +
      '    "version": "directory_v1",\n' +
      '    "serviceId": "admin" }\n\n' +
      'Run 🔌 Check services & permissions to see what did load.',
      ui.ButtonSet.OK);
    return;
  }
  var sheet = sheet_(SS.IMPORT_HR);
  if (!sheet) { ui.alert('Run 🔧 Upgrade tabs (safe) first.'); return; }

  toast_('Reading your Workspace directory…', '👥', 25);
  var picked = pickDirectoryStrategy_();
  if (!picked.strategy) {
    ui.alert('Directory read failed', directoryFailureText_(picked.attempts), ui.ButtonSet.OK);
    return;
  }

  var rows;
  try { rows = fetchDirectoryUsers_(picked.strategy.params); }
  catch (e) {
    ui.alert('Directory read failed part-way',
      'The first page read fine using "' + picked.strategy.name + '", but a later page failed:\n\n' +
      (e.message || e) + '\n\nTry again; if it repeats, tell your admin the paging call is failing.',
      ui.ButtonSet.OK);
    return;
  }

  writeHrRows_(sheet, rows);
  ss_().setActiveSheet(sheet);
  ui.alert('✅ Imported ' + rows.length + ' people',
    'Name, email and Chat user id are now in 👥 importHR.\n' +
    'Read using: ' + picked.strategy.name + '\n\n' +
    'Heads-up: directory names can differ slightly from the allotment (initials, spelling). ' +
    'The system matches loosely, but spot-check a few teachers, then run 💬 Test Chat DM.',
    ui.ButtonSet.OK);
}

/** Overwrite the data rows (row 3 down), keeping title + header. Batched. */
function writeHrRows_(sheet, rows) {
  if (sheet.getLastRow() >= 3) sheet.getRange(3, 1, sheet.getLastRow() - 2, 3).clearContent();
  if (!rows.length) { clearCache(); return; }
  ensureRows_(sheet, 2 + rows.length);
  sheet.getRange(3, 1, rows.length, 3).setValues(rows);

  var bg = [];
  for (var r = 0; r < rows.length; r++) {
    var band = r % 2 ? C.PAPER : C.WHITE;
    bg.push([band, band, band]);
  }
  sheet.getRange(3, 1, rows.length, 3).setBackgrounds(bg)
    .setBorder(null, null, true, null, null, null, C.HAIRLINE, SpreadsheetApp.BorderStyle.SOLID);
  clearCache();
}

/**
 * Menu: show exactly what each strategy returned. Use when the import fails —
 * the Directory API's "Unknown Error" says nothing on its own.
 */
function diagnoseDirectory() {
  var ui = SpreadsheetApp.getUi();
  if (typeof AdminDirectory === 'undefined') {
    ui.alert('Admin SDK service not available',
      'Declare AdminDirectory in appsscript.json, push, then reload.', ui.ButtonSet.OK);
    return;
  }
  toast_('Probing the directory…', '🩺', 20);
  var picked = pickDirectoryStrategy_();
  var lines = picked.attempts.map(function (a) {
    return (a.ok ? '✅  ' : '❌  ') + a.name + (a.ok ? '' : '\n        ' + a.error);
  }).join('\n');
  ui.alert('🩺 Directory access probe',
    'Running as: ' + (activeEmail_() || 'unknown') + '\n\n' + lines + '\n\n' +
    (picked.strategy
      ? 'Import will use: ' + picked.strategy.name
      : directoryFailureText_(picked.attempts)),
    ui.ButtonSet.OK);
}

/** Turn a set of failed attempts into something a person can act on. */
function directoryFailureText_(attempts) {
  var all = attempts.map(function (a) { return a.error; }).join(' ').toLowerCase();
  var lines = attempts.map(function (a) { return '❌  ' + a.name + '\n        ' + a.error; }).join('\n');

  var hint;
  if (/not authorized|forbidden|403|insufficient/.test(all)) {
    hint = 'Every attempt was refused.\n\n' +
      '• The account running this script (' + (activeEmail_() || 'unknown') + ') is probably\n' +
      '  not a Workspace admin, or lacks the "Users > Read" admin privilege.\n' +
      '• Ask an admin to run this once, or to grant that privilege.\n' +
      '• A non-admin can still work if your domain allows the domain-public view.';
  } else if (/unknown error|internal|backend/.test(all)) {
    hint = 'The API returned no detail. Usual causes, in order:\n\n' +
      '1. The Admin SDK API is not enabled in the linked Cloud project.\n' +
      '   Project Settings → link a standard Google Cloud project, then enable\n' +
      '   "Admin SDK API" in that project\'s API Library.\n' +
      '2. The account is not a Workspace admin (admin_view is refused).\n' +
      '3. Your domain restricts directory access entirely.';
  } else if (/not found|404|domain/.test(all)) {
    hint = 'The customer or domain could not be resolved.\n\n' +
      '• Confirm you are signed in with a school account, not a personal one.\n' +
      '• Ask your admin whether directory access is restricted.';
  } else {
    hint = 'Checklist:\n' +
      '• The account running this is a Workspace admin.\n' +
      '• The Admin SDK API is enabled in the linked Cloud project.\n' +
      '• Directory access is not restricted for your domain.';
  }

  return lines + '\n\n──────────────\n' + hint + '\n\n' +
    'You can skip this entirely: type Name / Email / Chat ID into 👥 importHR by hand,\n' +
    'or paste an IMPORTRANGE from your HR sheet. Only DMs need the Chat ID column.';
}
