/**
 * ============================================================
 * Setup.gs — One-click build of every tab in this workbook.
 * Run setupAllTabs() once after pasting the code.
 * ============================================================
 */

/**
 * The Chat webhook is a SECRET and never lives in source.
 *
 *   Apps Script editor → Project Settings → Script Properties
 *   → add  CHAT_WEBHOOK_URL  =  https://chat.googleapis.com/v1/spaces/…
 *
 * It is only ever read to SEED the ⚙️ Config cell when the tab is first built.
 * After that the Config cell is the working value, so an existing workbook is
 * unaffected whether or not the property is set.
 */
function prefilledWebhook_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK_URL') || '';
  } catch (e) {
    return '';
  }
}

/**
 * ============================================================
 * upgradeTabs() — SAFE. Adds whatever is missing and touches nothing else.
 *
 * Use this after pulling new code into a workbook that is already in service.
 * It never calls sheet.clear(): existing tabs keep every row, every Config
 * value, every HR row. setupAllTabs() is the destructive rebuild.
 * ============================================================
 */
function upgradeTabs() {
  var ui = SpreadsheetApp.getUi();
  var ss = ss_();
  var added = [], notes = [];

  // 0. RENAME BEFORE CREATING. The vocabulary migration renames the old
  //    "Leave" tabs in place. If the create-missing-tabs loop ran first it
  //    would make an empty 🗓️ Absence Register beside the populated
  //    🗓️ Leave Register, and every historical row would vanish from reports.
  if (absenceMigrationNeeded_()) {
    var backup = null;
    try { backup = backupWorkbook_('before absence migration'); }
    catch (e) {
      var go = ui.alert('Could not save a backup',
        'The absence migration renames tabs and rewrites the absence-type column.\n\n' +
        'A backup copy could not be saved: ' + e.message + '\n\nContinue anyway?',
        ui.ButtonSet.YES_NO);
      if (go !== ui.Button.YES) { toast_('Upgrade cancelled. Nothing was changed.', '✅', 6); return; }
    }
    if (backup) notes.push('backup saved: ' + backup.getName());
  }

  // 1. create any tab that does not exist yet, and build only that tab
  var builders = [
    [SS.CONSOLE, writeConsoleTab_], [SS.CONFIG, writeConfigTab_],
    [SS.MARK_ABSENCE, writeMarkAbsenceTab_], [SS.POOL, function () {}],
    [SS.DASHBOARD, function () {}], [SS.ANALYTICS, function () {}], [SS.LOG, writeLogTab_],
    [SS.ABSENCE, writeAbsenceRegisterTab_], [SS.RULES, writeRulesTab_],
    [SS.BLOCKS, writeBlocksTab_], [SS.REPORTS, writeReportsTab_],
    [SS.IMPORT_HR, writeImportHrTab_], [SS.HELP, writeHelpTab_],
  ];
  for (var i = 0; i < builders.length; i++) {
    if (ss.getSheetByName(builders[i][0])) continue;
    ss.insertSheet(builders[i][0]);
    try { builders[i][1](); } catch (e) { Logger.log('build ' + builders[i][0] + ': ' + e.message); }
    added.push(builders[i][0]);
  }

  // 2. add missing ⚙️ Config keys in place — existing values are never rewritten
  var cfgAdded = addMissingConfigRows_();
  if (cfgAdded.length) notes.push(cfgAdded.length + ' new setting(s) added to ⚙️ Config');

  // 3. lift the old 200-row ceiling on tabs that grow
  var grown = [];
  [SS.LOG, SS.ABSENCE, SS.REPORTS, SS.IMPORT_HR].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    if (sh.getMaxRows() < sh.getLastRow() + 200) { ensureRows_(sh, sh.getLastRow() + 200); grown.push(name); }
  });
  if (grown.length) notes.push('row ceiling lifted on ' + grown.length + ' tab(s)');

  // 3b. existing tabs keep their original chrome — bring it up to date
  refreshLabels_().forEach(function (c) { notes.push(c); });

  // 4. triggers are idempotent
  try { ensureAbsenceTrigger_(); } catch (e) { notes.push('tick-to-run trigger: ' + e.message); }
  try { ensureReportTrigger_(); } catch (e) { notes.push('auto-report trigger: ' + e.message); }

  ui.alert('✅ Upgrade complete — nothing was erased',
    (added.length ? 'New tabs:\n  • ' + added.join('\n  • ') + '\n\n' : 'No new tabs were needed.\n\n') +
    (notes.length ? notes.join('\n') + '\n\n' : '') +
    'Your ⚙️ Config values, 🗂️ Log, 👥 importHR and every other existing row were left untouched.',
    ui.ButtonSet.OK);
}

/**
 * ============================================================
 * refreshLabels() — bring an EXISTING workbook's wording, headers and
 * dropdowns up to the current version, without touching collected data.
 *
 * upgradeTabs() only BUILDS tabs that are missing, so a workbook already in
 * service keeps whatever its original builder wrote — stale headers, an old
 * dropdown, out-of-date help text. This closes that gap.
 *
 *   REBUILT   ▶️ Console · 📖 Help          — pure instructions, hold no data
 *   REFRESHED 📝 Mark Absence · 🗓️ Absence Register
 *                                          — chrome only: titles, headers,
 *                                            notes, dropdowns. Rows untouched.
 *   RE-RENDERED 🔁 Pool · 📊 Fairness · 🔎 Analytics
 *                                          — derived from the log anyway
 *   NEVER TOUCHED ⚙️ Config · 🗂️ Log · 👥 importHR · 📄 Reports
 *                                          — your two months of data. Their
 *                                            layout carries no absence
 *                                            vocabulary, so nothing is due.
 * ============================================================
 */
function refreshLabels() {
  var ui = SpreadsheetApp.getUi();
  var done = refreshLabels_();
  ui.alert('✅ Labels & dropdowns refreshed',
    (done.length ? done.join('\n') : 'Everything was already up to date.') +
    '\n\nUntouched, as always: ⚙️ Config · 🗂️ Log · 👥 importHR · 📄 Reports.\n' +
    'No recorded row was read or written.',
    ui.ButtonSet.OK);
}

/** The work itself, so upgradeTabs() can reuse it. Returns what changed. */
function refreshLabels_() {
  var ss = ss_(), done = [];

  // chrome-only refreshes on tabs that DO hold data
  try { done = done.concat(migrateAbsenceVocabulary_()); } catch (e) { done.push('⚠️ absence register: ' + e.message); }
  try { done = done.concat(refreshMarkAbsenceChrome_()); } catch (e) { done.push('⚠️ mark absence: ' + e.message); }

  // rule tabs: reapply dropdowns and help text without touching the rows
  var rulesSheet = ss.getSheetByName(SS.RULES);
  if (rulesSheet) {
    try {
      applyRulesValidation_(rulesSheet);
      rulesSheet.getRange('A1').setNote(rulesHelpText_());
      done.push(SS.RULES + ' — rule list and help text refreshed');
    } catch (e) { done.push('⚠️ ' + SS.RULES + ': ' + e.message); }
  }
  var blocksSheet = ss.getSheetByName(SS.BLOCKS);
  if (blocksSheet) {
    try { applyBlocksValidation_(blocksSheet); done.push(SS.BLOCKS + ' — floor list refreshed'); }
    catch (e) { done.push('⚠️ ' + SS.BLOCKS + ': ' + e.message); }
  }

  // full rebuilds, safe because these tabs are instructions only
  var prose = [[SS.CONSOLE, writeConsoleTab_], [SS.HELP, writeHelpTab_]];
  for (var i = 0; i < prose.length; i++) {
    if (!ss.getSheetByName(prose[i][0])) continue;
    try { prose[i][1](); done.push(prose[i][0] + ' — rebuilt (instructions only, no data)'); }
    catch (e) { done.push('⚠️ ' + prose[i][0] + ': ' + e.message); }
  }

  clearCache();
  try { renderPool_(); renderFairness_(); done.push('🔁 Pool and 📊 Fairness re-rendered'); }
  catch (e) { /* source not connected — leave them as they are */ }
  try { renderAnalyticsTab_(); done.push('🔎 Analytics re-rendered'); }
  catch (e) { done.push('⚠️ 🔎 Analytics: ' + e.message); }
  return done;
}

/**
 * Insert any ⚙️ Config key this version needs but the sheet does not have.
 * New keys go ABOVE the TEAM COORDINATORS block — anything below it is
 * swallowed by the coordinator parser. Returns the keys added.
 */
function addMissingConfigRows_() {
  var sheet = sheet_(SS.CONFIG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var spec = [
    ['Auto Generate Weekly Report', 'TRUE', 'builds the Principal report for the week just finished'],
    ['Auto Report Day', DEF.REPORT_AUTO_DAY, 'day the automatic report runs'],
    ['Auto Report Hour', DEF.REPORT_AUTO_HOUR, '0–23, school timezone'],
    ['Post Report To Chat', 'TRUE', 'summary card + a link to the PDF'],
    ['Report File Prefix', DEF.REPORT_PREFIX, 'file name before the sequence number'],
    ['Reports Folder ID', '', 'filled in automatically on the first report — leave blank'],
  ];

  var keys = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  var at = {};
  for (var i = 0; i < keys.length; i++) {
    var k = norm_(keys[i][0]);
    if (k && !(k in at)) at[k] = i + 1;
  }

  var missing = spec.filter(function (r) { return !(r[0] in at); });
  if (!missing.length) return [];

  var block = [];
  if (!('WEEKLY REPORT' in at)) block.push(['WEEKLY REPORT', '', '']);
  block = block.concat(missing);
  block.push(['', '', '']);

  var anchor = at['HR / EMAIL LOOKUP'] || at['TEAM COORDINATORS'] || (sheet.getLastRow() + 1);
  sheet.insertRowsBefore(anchor, block.length);
  sheet.getRange(anchor, 1, block.length, 3).setValues(block);

  // match the surrounding styling
  sheet.getRange(anchor, 1, block.length, 3).setVerticalAlignment('middle').setFontColor(C.INK).setFontSize(10);
  sheet.getRange(anchor, 3, block.length, 1).setFontColor(C.SUBTLE).setFontStyle('italic').setFontSize(9);
  for (var b = 0; b < block.length; b++) {
    var row = anchor + b, key = block[b][0];
    if (key === 'WEEKLY REPORT') {
      sheet.getRange(row, 1, 1, 3).merge().setBackground(C.HEAD_BAND).setFontColor(C.HEAD_DARK)
        .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');
      sheet.setRowHeight(row, 26);
    } else if (key === 'Auto Generate Weekly Report' || key === 'Post Report To Chat') {
      sheet.getRange(row, 2).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(['TRUE', 'FALSE'], true).build());
    } else if (key === 'Auto Report Day') {
      sheet.getRange(row, 2).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], true).build());
    }
  }
  clearCache();
  return missing.map(function (r) { return r[0]; });
}

/**
 * DESTRUCTIVE. Rebuilds every tab from scratch — every write*Tab_() begins
 * with sheet.clear(). Takes a full backup copy of the workbook first, and
 * will not proceed without an explicit confirmation naming what is at risk.
 * For an existing workbook you almost always want upgradeTabs().
 */
function setupAllTabs() {
  var ui = SpreadsheetApp.getUi();
  var ss = ss_();

  var risk = describeDataAtRisk_();
  if (risk.length) {
    var proceed = ui.alert('⚠️ This ERASES data — are you sure?',
      'Rebuilding clears and recreates every tab. You are about to lose:\n\n  • ' +
      risk.join('\n  • ') +
      '\n\nIf you only pulled new code, choose NO and run\n' +
      '🔁 Substitutions → 🔧 Upgrade (safe) instead — it adds what is missing\n' +
      'and keeps every row.\n\nA backup copy of this workbook will be saved first.\n\n' +
      'Continue with the full rebuild?',
      ui.ButtonSet.YES_NO);
    if (proceed !== ui.Button.YES) { toast_('Rebuild cancelled. Nothing was changed.', '✅', 6); return; }

    var backup = null;
    try { backup = backupWorkbook_('before rebuild'); }
    catch (e) {
      var anyway = ui.alert('Backup failed',
        'Could not save a backup copy:\n' + e.message +
        '\n\nRebuild anyway and lose the data listed above?', ui.ButtonSet.YES_NO);
      if (anyway !== ui.Button.YES) { toast_('Rebuild cancelled.', '✅', 6); return; }
    }
    if (backup) toast_('Backup saved: ' + backup.getName(), '💾', 8);
  }

  // Create tabs in a tidy order
  var order = [SS.CONSOLE, SS.CONFIG, SS.MARK_ABSENCE, SS.RULES, SS.BLOCKS, SS.POOL,
               SS.DASHBOARD, SS.ANALYTICS, SS.LOG, SS.ABSENCE, SS.REPORTS, SS.IMPORT_HR, SS.HELP];
  for (var i = 0; i < order.length; i++) {
    var sh = ss.getSheetByName(order[i]) || ss.insertSheet(order[i]);
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  }
  // Remove a stray default sheet
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > order.length) ss.deleteSheet(def);

  writeConfigTab_();
  writeConsoleTab_();
  writeMarkAbsenceTab_();
  writeLogTab_();
  writeAbsenceRegisterTab_();
  writeRulesTab_();
  writeBlocksTab_();
  writeReportsTab_();
  writeImportHrTab_();
  writeHelpTab_();
  clearCache();
  try { renderPool_(); renderFairness_(); renderAnalyticsTab_(); } catch (e) { /* source not connected yet */ }
  ensureAbsenceTrigger_();   // enable tick-to-run on the Mark Leave tab
  try { ensureReportTrigger_(); } catch (e) { Logger.log('Report trigger: ' + e.message); }

  ss.setActiveSheet(ss.getSheetByName(SS.CONSOLE));
  ui.alert('✅ Substitution System rebuilt',
    'All tabs are ready.\n\nNext:\n1. Open ⚙️ Config and paste the main Timetable sheet URL in "Source Spreadsheet URL".\n2. Run 🔁 Substitutions → Check source connection.\n3. Mark absences from the side panel (Mark Absence) or the 📝 Mark Leave tab.\n\nThe weekly Principal report builds itself every Monday morning — or run it any time from 🔁 Substitutions → 📄 Weekly report.',
    ui.ButtonSet.OK);
}

/* ───────── ⚙️ Config ───────── */

function writeConfigTab_() {
  var sheet = sheet_(SS.CONFIG);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  var rows = [];
  var R = function (a, b, c) { rows.push([a, b == null ? '' : b, c == null ? '' : c]); };

  R('⚙️ SUBSTITUTION SYSTEM — CONFIGURATION', '', '');
  R('', '', '');
  R('GENERAL', '', '');
  R('School Name', DEF.SCHOOL_NAME, '');
  R('Academic Year', DEF.ACADEMIC_YEAR, '');
  R('Term Label', DEF.TERM_LABEL, 'shown on cards & emails');
  R('This Sheet Link', '', 'paste THIS workbook URL → adds a button on the Chat card');
  R('', '', '');

  R('SOURCE DATA', '', '');
  R('Source Spreadsheet URL', '', '← PASTE the main Timetable Management System URL here');
  R('Allotment Tab Name', DEF.ALLOTMENT_TAB, '');
  R('Timetable Tab Name', DEF.TIMETABLE_TAB, '');
  R('Staff Duties Tab Name', DEF.DUTIES_TAB, '');
  R('Allotment Data Start Row', DEF.ALLOTMENT_START_ROW, 'first data row in Allotment');
  R('Timetable Data Start Row', DEF.TIMETABLE_START_ROW, 'first data row in Timetable');
  R('Staff Duties Data Start Row', DEF.DUTIES_START_ROW, '');
  R('', '', '');

  R('SCHEDULE', '', '');
  R('Days', DEF.DAYS.join(', '), 'working days, comma-separated');
  R('Periods Per Day', DEF.PERIODS, '');
  R('Break After Periods', DEF.BREAKS_AFTER.join(', '), '');
  R('First Afternoon Period', DEF.FIRST_AFTERNOON_PERIOD, 'half-day split: this period & later = afternoon (the rest = morning)');
  R('', '', '');

  R('PERIOD TIMINGS', '', '');
  for (var p = 1; p <= DEF.PERIODS; p++) R('Period ' + p + ' Timing', '', 'optional — e.g. 9:00–9:40, shown on cards');
  R('', '', '');

  R('ALLOTMENT COLUMN MAPPING', '', '');
  R('Col: Total Periods', DEF.COL.totalPeriods, '');
  R('Col: Class', DEF.COL.class, '');
  R('Col: Section', DEF.COL.section, '');
  R('Col: Subject', DEF.COL.subject, '');
  R('Col: Teacher', DEF.COL.teacher, '');
  R('Col: Department', DEF.COL.department, '');
  R('Col: Team', DEF.COL.team, '');
  R('Col: Periods Allotted', DEF.COL.periodsAllotted, 'weekly substitution cap lives here');
  R('Substitution Subject Label', DEF.SUB_SUBJECT_LABEL, 'rows whose Subject = this set the cap');
  R('', '', '');

  R('SUBSTITUTION RULES', '', '');
  R('Fairness Basis', 'Term', 'Term = balance on cumulative term load, never resets (recommended) · Week = reset each week');
  R('Non-Substitutable Subjects', DEF.NON_SUB_SUBJECTS.join(', '), 'these periods are skipped (never need a sub)');
  R('Prefer Same Department', 'TRUE', 'favour a subject-matched substitute');
  R('Prefer Same Team', 'TRUE', 'favour a substitute from the same team');
  R('Prefer Continuity', 'TRUE', 'keep the same sub across adjacent periods of a class');
  R('Max Substitutions Per Day', 0, '0 = no daily ceiling');
  R('Max Substitutions Per Week', 0, '0 = no extra weekly ceiling (Term basis: a teacher may exceed their allotment in a heavy week)');
  R('Week Starts On', 'Monday', '');
  R('', '', '');

  R('NOTIFICATIONS', '', '');
  R('Google Chat Webhook URL', prefilledWebhook_(),
    'posts the plan card to your space · seeded from the CHAT_WEBHOOK_URL script property');
  R('Send Chat Card', 'TRUE', '');
  R('Send Email To Substitutes', 'FALSE', 'needs emails in 👥 importHR');
  R('Send Direct Messages', 'FALSE', 'needs a Chat bot — see 📖 Help');
  R('Test Chat User ID', '', 'your users/NNN — used by 💬 Test Chat DM');
  R('', '', '');

  R('WEEKLY REPORT', '', '');
  R('Auto Generate Weekly Report', 'TRUE', 'builds the Principal report for the week just finished');
  R('Auto Report Day', DEF.REPORT_AUTO_DAY, 'day the automatic report runs');
  R('Auto Report Hour', DEF.REPORT_AUTO_HOUR, '0–23, school timezone');
  R('Post Report To Chat', 'TRUE', 'summary card + a link to the PDF');
  R('Report File Prefix', DEF.REPORT_PREFIX, 'file name before the sequence number');
  R('Reports Folder ID', '', 'filled in automatically on the first report — leave blank');
  R('', '', '');

  R('HR / EMAIL LOOKUP', '', '');
  R('HR Source URL', '', 'optional — IMPORTRANGE this into 👥 importHR');
  R('HR Col: Name', DEF.HR_NAME_COL, 'column in importHR with the teacher name');
  R('HR Col: Email', DEF.HR_EMAIL_COL, '');
  R('HR Col: Chat User ID', DEF.HR_CHATID_COL, 'format users/123… (for DMs)');
  R('', '', '');

  R('TEAM COORDINATORS', '', '');
  R('Team', 'Coordinator', 'Email');
  var teams = ['Pre-primary', 'Junior Primary', 'Lower Primary', 'Senior Primary', 'Middle School', 'High School', 'Higher Secondary'];
  for (var t = 0; t < teams.length; t++) R(teams[t], '', '');

  sheet.getRange(1, 1, rows.length, 3).setValues(rows);

  // widths & base style
  sheet.setColumnWidth(1, 270);
  sheet.setColumnWidth(2, 430);
  sheet.setColumnWidth(3, 320);
  sheet.getRange(1, 1, rows.length, 3).setVerticalAlignment('middle').setFontColor(C.INK).setFontSize(10);
  sheet.getRange(1, 3, rows.length, 1).setFontColor(C.SUBTLE).setFontStyle('italic').setFontSize(9);

  // title band
  sheet.getRange(1, 1, 1, 3).merge().setBackground(C.HEAD_DARK).setFontColor(C.WHITE)
    .setFontSize(14).setFontWeight('bold').setHorizontalAlignment('left');
  sheet.setRowHeight(1, 40);

  // section bands + boolean dropdowns
  var boolKeys = { 'Send Chat Card': 1, 'Send Email To Substitutes': 1, 'Send Direct Messages': 1,
                   'Prefer Same Department': 1, 'Prefer Same Team': 1, 'Prefer Continuity': 1,
                   'Auto Generate Weekly Report': 1, 'Post Report To Chat': 1 };
  var boolRule = SpreadsheetApp.newDataValidation().requireValueInList(['TRUE', 'FALSE'], true).build();
  for (var i = 1; i < rows.length; i++) {   // skip row 0 = title band
    var key = rows[i][0];
    if (key && key === key.toUpperCase() && key.length > 4 && rows[i][1] === '') {
      sheet.getRange(i + 1, 1, 1, 3).merge().setBackground(C.HEAD_BAND).setFontColor(C.HEAD_DARK)
        .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('left');
      sheet.setRowHeight(i + 1, 26);
    }
    if (boolKeys[key]) sheet.getRange(i + 1, 2).setDataValidation(boolRule);
    if (key === 'Fairness Basis') {
      sheet.getRange(i + 1, 2).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(['Term', 'Week'], true).build());
    }
    if (key === 'Auto Report Day') {
      sheet.getRange(i + 1, 2).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], true).build());
    }
  }
  // highlight the must-fill source URL row
  for (var j = 0; j < rows.length; j++) {
    if (rows[j][0] === 'Source Spreadsheet URL') {
      sheet.getRange(j + 1, 2).setBackground(C.AMBER_50).setBorder(true, true, true, true, false, false, C.AMBER, SpreadsheetApp.BorderStyle.SOLID_THICK);
    }
  }
  sheet.setFrozenRows(1);
  trimColumns_(sheet, 3);
}

/* ───────── ▶️ Console (landing page) ───────── */

function writeConsoleTab_() {
  var sheet = sheet_(SS.CONSOLE);
  sheet.clear();
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, 40, 8).setBackground(C.WHITE);

  card_(sheet, 2, 2, 7, '🔁  Weekly Substitution System',
        'Mark a teacher absent and the system auto-assigns fair, conflict-free cover — then posts a card to your Google Chat space.', C.HEAD_DARK, C.WHITE);

  steps_(sheet, 11, [
    ['1', 'Open the panel', 'Menu  🔁 Substitutions → Mark Absence (panel)'],
    ['2', 'Pick the date & teacher(s)', 'Search and select one or more absent teachers.'],
    ['3', 'Preview the plan', 'See every period and its assigned substitute before saving.'],
    ['4', 'Assign & notify', 'Saves to the 🗂️ Log and posts the card to Chat.'],
  ]);

  sheet.getRange(20, 2, 1, 6).merge()
    .setValue('Tip:  use 🔁 Substitutions → Check source connection first, after pasting the main sheet URL in ⚙️ Config.')
    .setBackground(C.TEAL_50).setFontColor(C.TEAL).setFontSize(10).setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(20, 34);

  sheet.setColumnWidth(1, 24);
  for (var c = 2; c <= 7; c++) sheet.setColumnWidth(c, 130);
  trimColumns_(sheet, 8);
  sheet.setFrozenRows(0);
}

/* ───────── 🗂️ Log ───────── */

function writeLogTab_() {
  var sheet = sheet_(SS.LOG);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  titleBand_(sheet, '🗂️ Substitution Log', LOG_HEADERS.length);
  sheet.getRange(2, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
  var widths = [140, 90, 80, 70, 55, 90, 130, 170, 170, 120, 90, 70, 90, 160];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(2);
  sheet.getRange('A1').setNote('Every saved assignment — the source of truth for caps & fairness. Row 1 = title, Row 2 = headers, data starts row 3. Safe to filter/sort.');
  trimColumnsOnly_(sheet, LOG_HEADERS.length);
}

/* ───────── 👥 importHR ───────── */

function writeImportHrTab_() {
  var sheet = sheet_(SS.IMPORT_HR);
  sheet.clear();
  titleBand_(sheet, '👥 HR Import', 3);
  sheet.getRange(2, 1, 1, 3).setValues([['Teacher Name', 'Email', 'Chat User ID (users/123…)']])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
  sheet.setColumnWidth(1, 240); sheet.setColumnWidth(2, 300); sheet.setColumnWidth(3, 240);
  sheet.setFrozenRows(2);
  sheet.getRange('A1').setNote('Fill the easy way: 🔁 Substitutions → Import HR from Directory.\nOr paste =IMPORTRANGE("HR_URL","Staff!A2:C") in A3, or type rows. Data starts row 3.');
  trimColumnsOnly_(sheet, 3);
}

/* ───────── 📖 Help ───────── */

function writeHelpTab_() {
  var sheet = sheet_(SS.HELP);
  sheet.clear();
  sheet.setHiddenGridlines(true);
  card_(sheet, 2, 2, 7, '📖  How it works',
    'A quick reference for coordinators and admins.', C.HEAD_DARK, C.WHITE);

  var blocks = [
    ['Three ways to mark an absence', 'Use whichever is fastest: the side panel (Mark Absence), the 📝 Mark Absence tab (pick date + teachers, set Action → “Assign & notify”), or Quick mark (typed). All share one engine. You can mark more teachers later the same day — already-absent teachers are never picked as substitutes and no substitute is double-booked across marks.'],
    ['Absence types', 'Eight types, in three families. Leave — Full day / Morning / Afternoon — is personal absence. Permission is a short personal absence on specific periods. OD is official school duty — Full day / Morning / Afternoon / Periods. Half-days split at the “First Afternoon Period” in ⚙️ Config; Permission and OD - Periods need the exact period numbers, e.g. 7,8. Only periods inside that window are substituted. The type changes nothing about how a substitute is chosen — it is what lets the Principal’s report separate personal absence from school business.'],
    ['Re-assignment', 'If a teacher who was already substituting becomes absent herself, the periods she was covering are automatically re-assigned to someone else (shown as ↻ Re-assigned) — limited to her own absence window.'],
    ['The substitute pool', 'Every teacher\'s "Substitution" row in the Allotment is their WEIGHT. The 🔁 Pool tab shows the weighted rotation: a teacher allotted 4 is drawn twice as often as one allotted 2, evenly spread.'],
    ['Assigning cover', 'Only TEACHING periods are covered — staff duties are never substituted. A substitute must be genuinely free (not teaching, not on duty, not already pulled elsewhere). For each period the teacher whose load is furthest below their fair share is chosen, then rotation order, with small boosts for same department / team / staying on an adjacent period.'],
    ['Fairness is over the whole term (no weekly reset)', 'With "Fairness Basis = Term" (default) the system balances on each teacher\'s CUMULATIVE term load ÷ their weight. It never resets, so the entire pool cycles over the term — nobody at the bottom of the rotation is starved. Switch to "Week" in ⚙️ Config to instead cap each teacher at their allotment per ISO week. Optional hard ceilings: Max Substitutions Per Day / Per Week. The 🗂️ Log is the source of truth.'],
    ['Notifications', 'A rich card is posted to your Chat space webhook. Optionally email each substitute (add emails in 👥 importHR) or send 1:1 DMs (needs a Chat bot — see below).'],
    ['Direct messages (advanced)', 'Webhooks only post to the space, not DMs. For 1:1 messages: link a Cloud project, enable the Google Chat API, add the "Google Chat API" service (Services ➕), and make sure appsscript.json oauthScopes include …/chat.spaces and …/chat.messages — then RE-RUN and approve the new permissions (a missing scope is the usual cause of "permissions are not sufficient"). DMs are sent AS the account running the script, so run it as your automations account. Put Chat IDs in importHR col C, set "Send Direct Messages" = TRUE, and test with 💬 Test Chat DM.'],
    ['Getting Chat user IDs', 'A Chat user ID (users/123…) IS the person\'s Workspace Directory id. Your own: 🔁 Substitutions → 🆔 Show my Chat ID (People API, no admin). Everyone at once: 👥 Import HR from Directory (Workspace admin) fills the importHR tab with name + email + Chat id. Both need their advanced service added once (Services ➕): People API / Admin SDK API. Then run 💬 Test Chat DM.'],
    ['Re-running a day', 'Re-marking the same teacher on the same date replaces their earlier rows. Use 🔁 Substitutions → Clear a date\'s assignments to wipe a date entirely.'],
    ['"No substitute free — protected by the free-period guard"', 'A ⚖️ Rules row can protect teachers with few free periods from being loaded up with cover, e.g. someone with only 1 free period that day gets 0 substitutions. It looks at her timetable and duty roster for the day, not at cover already given out, so it can\'t be dodged by assigning her first. It\'s a hard limit, same as a floor limit — if it leaves nobody free, the period shows as uncovered and the reason names the guard.'],
    ['A teacher says they never get substitutions', 'Run the substitution analytics report (🔁 Substitutions menu, or check the 🔎 Analytics tab) and look them up in the equity table. If they show "Not in pool", they have no "Substitution" row in the Allotment — add one and give it a weight; that is the fix, not a code change. If they show "Never called" or "Below share" while in the pool, that is genuine under-use to look into. The report is diagnostic only — it does not change how substitutes are chosen, and it also shows each teacher\'s variety score, which speaks to the separate "always the same slot" complaint.'],
  ];
  var row = 10;
  for (var i = 0; i < blocks.length; i++) {
    sheet.getRange(row, 2, 1, 6).merge().setValue(blocks[i][0])
      .setFontWeight('bold').setFontColor(C.INDIGO).setFontSize(12).setVerticalAlignment('middle');
    sheet.setRowHeight(row, 24);
    sheet.getRange(row + 1, 2, 1, 6).merge().setValue(blocks[i][1])
      .setFontColor(C.INK).setFontSize(10).setWrap(true).setVerticalAlignment('top');
    sheet.setRowHeight(row + 1, 44);
    row += 3;
  }
  sheet.setColumnWidth(1, 24);
  for (var c = 2; c <= 7; c++) sheet.setColumnWidth(c, 130);
  trimColumns_(sheet, 8);
}

/** Human summary of the data a rebuild would erase. Empty on a fresh workbook. */
function describeDataAtRisk_() {
  var out = [], ss = ss_();
  var count = function (name, start, label) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var n = sh.getLastRow() - start + 1;
    if (n > 0) out.push(n + ' row(s) in ' + name + (label ? ' — ' + label : ''));
  };
  count(SS.LOG, LOG_DATA_START, 'every saved assignment, and all fairness history');
  count(SS.ABSENCE, ABSENCE_DATA_START, 'the absence register');
  count(SS.IMPORT_HR, 3, 'names, emails and Chat IDs');
  count(SS.REPORTS, REPORT_DATA_START, 'links to generated reports');
  count(SS.RULES, RULE_DATA_START, 'your substitution rules');
  count(SS.BLOCKS, BLOCK_DATA_START, 'the class block/floor map');

  var cfg = sheet_(SS.CONFIG);
  if (cfg && cfg.getLastRow() > 1) {
    var filled = [];
    try {
      var c = getConfig();
      if (c.sourceUrl) filled.push('the source spreadsheet URL');
      if (c.chatWebhook) filled.push('the Chat webhook');
      if (c.reportsFolderId) filled.push('the reports folder link');
      if (c.coordinators.length) filled.push('team coordinators');
    } catch (e) { filled.push('your settings'); }
    if (filled.length) out.push('⚙️ Config — including ' + filled.join(', '));
  }
  return out;
}

/* ───────── shared setup helpers ───────── */

/** Title-only band on row 1 (use when row 2 holds column headers). */
function titleBand_(sheet, title, cols) {
  sheet.getRange(1, 1, 1, cols).merge().setValue(title)
    .setBackground(C.HEAD_DARK).setFontColor(C.WHITE).setFontSize(14).setFontWeight('bold')
    .setVerticalAlignment('middle').setHorizontalAlignment('left');
  sheet.setRowHeight(1, 38);
}

function card_(sheet, row, col, span, title, subtitle, bg, fg) {
  sheet.getRange(row, col, 1, span).merge().setBackground(bg)
    .setValue(title).setFontColor(fg).setFontSize(18).setFontWeight('bold')
    .setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(row, 36);
  sheet.getRange(row + 1, col, 2, span).merge().setBackground(bg)
    .setValue(subtitle).setFontColor(fg).setFontSize(11).setWrap(true).setVerticalAlignment('top');
}

function steps_(sheet, startRow, items) {
  for (var i = 0; i < items.length; i++) {
    var r = startRow + i;
    sheet.getRange(r, 2).setValue(items[i][0]).setBackground(C.INDIGO).setFontColor(C.WHITE)
      .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.getRange(r, 3, 1, 5).merge().setVerticalAlignment('middle');
    var cell = sheet.getRange(r, 3);
    cell.setValue(items[i][1] + '  —  ' + items[i][2]).setFontColor(C.INK).setFontSize(11);
    sheet.setRowHeight(r, 30);
  }
}

/**
 * Trim unused columns only. Use for tabs that GROW — the log, the leave
 * register, the reports index, the HR import. trimColumns_ also caps the
 * sheet at 200 rows, which silently becomes a hard write ceiling.
 */
function trimColumnsOnly_(sheet, keep) {
  var maxc = sheet.getMaxColumns();
  if (maxc > keep) sheet.deleteColumns(keep + 1, maxc - keep);
}

/** Grow the grid so a write ending at `lastRow` always fits. */
function ensureRows_(sheet, lastRow) {
  var have = sheet.getMaxRows();
  if (lastRow > have) sheet.insertRowsAfter(have, lastRow - have + 50);
}

/** Delete a list of row numbers bottom-up, collapsing consecutive runs. */
function deleteRowsBatched_(sheet, rows) {
  if (!rows || !rows.length) return 0;
  var v = rows.slice().sort(function (a, b) { return b - a; });
  var removed = 0, i = 0;
  while (i < v.length) {
    var end = v[i], start = end;
    while (i + 1 < v.length && v[i + 1] === start - 1) { start = v[++i]; }
    sheet.deleteRows(start, end - start + 1);
    removed += end - start + 1;
    i++;
  }
  return removed;
}

/** Layout tabs only — also caps the sheet at 200 rows. */
function trimColumns_(sheet, keep) {
  var maxc = sheet.getMaxColumns();
  if (maxc > keep) sheet.deleteColumns(keep + 1, maxc - keep);
  var maxr = sheet.getMaxRows();
  if (maxr > 200) sheet.deleteRows(201, maxr - 200);
}
