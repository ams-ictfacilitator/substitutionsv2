/**
 * ============================================================
 * Code.gs — Menu, entry points, sidebar bridge.
 *
 * NOTE FOR ANYONE EDITING IN THE APPS SCRIPT EDITOR:
 * this project is maintained in git and deployed with clasp. The repo also
 * holds a Node test harness under test/, which is excluded by .claspignore —
 * those files use require()/module.exports and would fail to compile here,
 * taking the whole project (and this menu) down with them. Never paste them in.
 * ============================================================
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🔁 Substitutions')
    .addItem('▶️  Mark Absence (panel)', 'openConsole')
    .addItem('📝  Mark Absence (tab)', 'openMarkAbsenceTab')
    .addItem('✍️  Quick mark (typed)', 'quickMark')
    .addSubMenu(ui.createMenu('📝  Mark-Absence tab')
      .addItem('👁  Preview', 'absenceTabPreview')
      .addItem('✅  Assign & notify', 'absenceTabAssign')
      .addItem('⚡  Enable tick-to-run', 'enableTabMarking')
      .addItem('🔄  Refresh teacher list', 'refreshAbsenceTeachers'))
    .addSeparator()
    .addSubMenu(ui.createMenu('📄  Weekly report')
      .addItem('👁  Preview last week', 'previewWeeklyReport')
      .addItem('👁  Preview this week (so far)', 'previewThisWeekReport')
      .addSeparator()
      .addItem('📄  Generate for last week', 'generateLastWeekReport')
      .addItem('📄  Generate for this week', 'generateThisWeekReport')
      .addItem('🗓️  Generate for a chosen week…', 'generateReportForWeekPrompt')
      .addSeparator()
      .addItem('📂  Open Reports folder', 'openReportsFolder')
      .addItem('⏰  Enable / refresh auto-report', 'enableWeeklyReportTrigger'))
    .addSubMenu(ui.createMenu('📊  Analytics')
      .addItem('👁  Preview', 'previewAnalyticsReport')
      .addItem('📊  Generate & file', 'generateAnalyticsReport'))
    .addSeparator()
    .addSubMenu(ui.createMenu('⚖️  Rules')
      .addItem('⚖️  Open the Rules tab', 'openRulesTab')
      .addItem('🏫  Open Blocks & Floors', 'openBlocksTab')
      .addSeparator()
      .addItem('🧪  Check rules', 'checkRules')
      .addItem('🏫  Fill in the class list', 'seedBlocks'))
    .addSeparator()
    .addItem('🔁  Refresh Pool & Fairness', 'refreshPoolAndFairness')
    .addItem('↩️  Clear a date\'s assignments', 'clearDatePrompt')
    .addSeparator()
    .addItem('🆔  Show my Chat ID', 'showMyChatId')
    .addItem('👥  Import HR from Directory', 'populateHrFromDirectory')
    .addSeparator()
    .addItem('🧪  Test Chat webhook', 'testChatWebhook')
    .addItem('💬  Test Chat DM (to my ID)', 'testChatDm')
    .addItem('🩺  Check source connection', 'checkSourceConnection')
    .addItem('🔌  Check services & permissions', 'checkServices')
    .addItem('🩺  Diagnose directory access', 'diagnoseDirectory')
    .addSeparator()
    .addItem('💾  Back up this workbook now', 'backupWorkbookNow')
    .addItem('🔧  Upgrade tabs (safe — keeps data)', 'upgradeTabs')
    .addItem('🔄  Refresh labels & dropdowns', 'refreshLabels')
    .addItem('🛠️  Rebuild all tabs (ERASES data)', 'setupAllTabs')
    .addItem('📖  Help', 'openHelp')
    .addToUi();
}

/** Open the coordinator side panel. */
function openConsole() {
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate().setTitle('Mark Absence').setWidth(420);
  SpreadsheetApp.getUi().showSidebar(html);
}

function openRulesTab() {
  var sheet = sheet_(SS.RULES);
  if (!sheet) { toast_('Run 🔧 Upgrade tabs (safe) first.', '⚠️'); return; }
  ss_().setActiveSheet(sheet);
}

function openBlocksTab() {
  var sheet = sheet_(SS.BLOCKS);
  if (!sheet) { toast_('Run 🔧 Upgrade tabs (safe) first.', '⚠️'); return; }
  ss_().setActiveSheet(sheet);
}

function openHelp() {
  var sheet = sheet_(SS.HELP);
  if (sheet) ss_().setActiveSheet(sheet);
}

/* ───────── Sidebar server API (called via google.script.run) ───────── */

function uiBootstrap() {
  var cfg = getConfig();
  var teachers = [];
  var sourceErr = '';
  try { teachers = getAllTeachers(); }
  catch (e) { sourceErr = e.message; }
  return {
    teachers: teachers,
    today: isoDate_(new Date()),
    schoolName: cfg.schoolName,
    termLabel: cfg.termLabel,
    sourceErr: sourceErr,
    periods: cfg.periods,
    firstAfternoon: cfg.firstAfternoonPeriod,
    absenceTypes: ABSENCE_TYPES,
    channels: {
      chat: cfg.sendChatCard && !!cfg.chatWebhook,
      email: cfg.sendEmail,
      dm: cfg.sendDm,
    },
  };
}

function uiPreview(dateStr, absentTeachers, scope, periods) {
  try {
    return computePlan(dateStr, absentTeachers, {
      periodFilter: buildPeriodFilter_(absentTeachers, scope, periods),
      scopeByTeacher: buildScopeMap_(absentTeachers, scope),
    });
  } catch (e) {
    return planError_(e.message);
  }
}

function uiCommit(dateStr, absentTeachers, scope, periods) {
  try {
    var plan = computePlan(dateStr, absentTeachers, {
      periodFilter: buildPeriodFilter_(absentTeachers, scope, periods),
      scopeByTeacher: buildScopeMap_(absentTeachers, scope),
    });
    if (!plan.ok) return { ok: false, error: plan.error };
    var res = commitPlan(plan, activeEmail_());
    res.plan = plan;
    return res;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function uiClearDate(dateStr) {
  var n = clearLogForDate_(dateStr);
  removeAbsenceRows_(dateStr, null);
  refreshDashboards_();
  return { ok: true, removed: n };
}

/* ───────── Typed (prompt) flow ───────── */

function quickMark() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('✍️ Quick mark absence',
    'Enter:  DD/MM/YYYY, Teacher Name [, Another Teacher]\nExample: 16/06/2026, Priya Sharma\n\n' +
    'Recorded as "' + ABSENCE_TYPES[0].label + '". For any other type use the panel or the 📝 Mark Absence tab.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var parts = res.getResponseText().split(',').map(function (s) { return s.trim(); }).filter(String);
  if (parts.length < 2) { toast_('Need a date and at least one teacher.', '⚠️'); return; }
  var dateStr = parts.shift();

  toast_('Computing substitutions…', '🔁', 10);
  var out = uiCommit(dateStr, parts, ABSENCE_TYPES[0].id, null);
  if (!out.ok) { ui.alert('Could not assign', out.error, ui.ButtonSet.OK); return; }
  toast_(out.assigned + ' assigned' + (out.unassigned ? ', ' + out.unassigned + ' unassigned' : '') +
         (out.notified ? ' · notified' : ''), '✅', 8);
}

function clearDatePrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('↩️ Clear assignments', 'Date to clear (DD/MM/YYYY):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var d = parseDate_(res.getResponseText());
  if (!d) { toast_('Unreadable date.', '⚠️'); return; }
  var out = uiClearDate(isoDate_(d));
  toast_('Removed ' + out.removed + ' row(s) for ' + prettyDate_(d) + '.', '✅');
}

/* ───────── Diagnostics ───────── */

function testChatWebhook() {
  var cfg = getConfig();
  if (!cfg.chatWebhook) { SpreadsheetApp.getUi().alert('No webhook set in ⚙️ Config.'); return; }
  try {
    postChatCard_(cfg.chatWebhook, {
      text: '✅ Substitution System connected.',
      cardsV2: [{ cardId: 'ping', card: {
        header: { title: 'Connection test', subtitle: cfg.schoolName + ' · ' + cfg.termLabel },
        sections: [{ widgets: [{ decoratedText: { startIcon: { knownIcon: 'STAR' },
          text: 'Your Substitution System can post to this space. 🎉', wrapText: true } }] }],
      }}],
    });
    toast_('Test card sent to the Chat space.', '✅');
  } catch (e) {
    SpreadsheetApp.getUi().alert('Webhook failed', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function testChatDm() {
  var ui = SpreadsheetApp.getUi();
  if (typeof Chat === 'undefined') {
    ui.alert('Google Chat API not available',
      'To send 1:1 DMs:\n\n' +
      '1. Declare it in appsscript.json (adding it in the editor is undone\n' +
      '   by the next clasp push, which overwrites that file).\n' +
      '2. Project Settings → link a Google Cloud project, and enable the Chat API there.\n' +
      '3. Configure a Chat app/bot for that project.\n\n' +
      'Then run this test again. (See 📖 Help for finding your Chat user ID.)',
      ui.ButtonSet.OK);
    return;
  }
  var cfg = getConfig();
  var saved = cfg.testChatUserId || '';
  var res = ui.prompt('💬 Test Chat DM',
    'Enter your Google Chat user ID  (e.g. users/123456789012345678),\n' +
    'a bare numeric id, or a DM space name (spaces/AAAA…).' +
    (saved ? '\n\nAbsence blank to use the saved ID: ' + saved : '\n\nTip: 📖 Help explains how to find your ID.'),
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var target = norm_(res.getResponseText()) || saved;
  if (!target) { toast_('No Chat ID provided.', '⚠️'); return; }

  try {
    sendChatDm_(target, '✅ *Substitution System — DM test*\nIf you can read this, 1:1 messages are working. ' +
      'You\'ll get your substitution duties here automatically.');
    ui.alert('✅ DM sent', 'A test message was dispatched to ' + target + ' from ' + (activeEmail_() || 'this account') +
      '.\nCheck your Google Chat.', ui.ButtonSet.OK);
  } catch (e) {
    var msg = e.message || String(e);
    var hint;
    if (/permission|scope|insufficient|PERMISSION_DENIED/i.test(msg)) {
      hint = 'This is a missing-permission (scope) error.\n\n' +
        '1. Project Settings → "Show appsscript.json".\n' +
        '2. Make sure oauthScopes includes:\n' +
        '     …/auth/chat.spaces\n     …/auth/chat.messages\n' +
        '   (paste the README\'s appsscript.json).\n' +
        '3. Run 💬 Test Chat DM again and APPROVE the new permissions when prompted.';
    } else if (/not.?found|NOT_FOUND|direct message/i.test(msg)) {
      hint = 'No direct-message space was found.\n\n' +
        '• Messages send AS the account running this script. You cannot DM yourself this way —\n' +
        '  run it while signed in as the automations account and target YOUR id, or test by\n' +
        '  sending to a colleague\'s id.\n' +
        '• The two accounts must be able to message each other in your domain.';
    } else {
      hint = '• Enable the Chat API in the linked Cloud project.\n' +
        '• Messages send as the account running this script; it must be able to DM the target.\n' +
        '• Check the ID format is users/NNN.';
    }
    ui.alert('DM failed', msg + '\n\n' + hint, ui.ButtonSet.OK);
  }
}

/**
 * Report which advanced services and scopes actually resolved at runtime.
 * The usual cause of a missing service is a `clasp push`: it overwrites
 * appsscript.json on the server, so anything added by hand in the editor
 * is removed unless it is also declared in the local file.
 */
function checkServices() {
  var svc = [
    ['Chat API', typeof Chat !== 'undefined', 'DMs (💬 Test Chat DM)'],
    ['People API', typeof People !== 'undefined', 'your own Chat ID (🆔 Show my Chat ID)'],
    ['Admin SDK (AdminDirectory)', typeof AdminDirectory !== 'undefined', 'directory import (👥 Import HR)'],
  ];
  var lines = svc.map(function (r) {
    return (r[1] ? '✅  ' : '❌  ') + r[0] + '\n        ' + (r[1] ? 'available' : 'NOT available') + ' — ' + r[2];
  }).join('\n');

  var drive = '❌  not granted';
  try { DriveApp.getRootFolder().getName(); drive = '✅  granted'; } catch (e) {}
  var triggers = '❌  not granted';
  try { ScriptApp.getProjectTriggers(); triggers = '✅  granted'; } catch (e) {}

  var missing = svc.filter(function (r) { return !r[1]; });
  SpreadsheetApp.getUi().alert('🔌 Services & permissions',
    lines +
    '\n\nDrive access (reports & backups):  ' + drive +
    '\nTrigger access (auto-report, tick-to-run):  ' + triggers +
    (missing.length
      ? '\n\n──────────────\nA missing service means it is not declared in appsscript.json.\n\n' +
        'Adding it in the editor works until the next clasp push, which\n' +
        'OVERWRITES appsscript.json from the local project folder. Declare it\n' +
        'in the local appsscript.json instead, push, then reload and approve.'
      : '\n\nEverything this project needs is available.'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function checkSourceConnection() {
  var ui = SpreadsheetApp.getUi();
  try {
    clearCache();
    var t = getAllTeachers().length;
    var pool = buildPool();
    ui.alert('🩺 Source connection OK',
      'Teachers found: ' + t + '\nSubstitutes in pool: ' + pool.members.length +
      '\nTotal weekly capacity: ' + pool.totalCap, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Source connection failed', e.message, ui.ButtonSet.OK);
  }
}

/** Allow Sidebar.html to pull in shared partials if needed. */
function include(file) { return HtmlService.createHtmlOutputFromFile(file).getContent(); }
