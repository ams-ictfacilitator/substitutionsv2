/**
 * ============================================================
 * Rules.gs — the ⚖️ Rules tab and its supporting 🏫 Blocks & Floors table.
 *
 * Rule INSTANCES are rows the office can edit; rule TYPES are declared in
 * Constants.js. Everything is compiled ONCE per execution into plain lookup
 * maps, so the assignment loop only ever does object lookups — no parsing,
 * no scanning, no sheet reads per candidate.
 * ============================================================
 */

const RULE_HEADERS = ['Enabled', 'Rule', 'Who / What', 'Then', 'Scope', 'Until', 'Priority', 'Notes / Reason'];
const RULE_DATA_START = 3;

const BLOCK_HEADERS = ['Class', 'Section', 'Block', 'Floor', 'Room / Notes'];
const BLOCK_DATA_START = 3;

/* ───────── reading ───────── */

/** Raw rule rows, cached per execution. Disabled and expired rows are dropped. */
function readRules_() {
  return memo('rules', function () {
    var sheet = sheet_(SS.RULES);
    if (!sheet || sheet.getLastRow() < RULE_DATA_START) return [];
    var n = sheet.getLastRow() - RULE_DATA_START + 1;
    var width = Math.min(RULE_HEADERS.length, sheet.getLastColumn());
    var data = sheet.getRange(RULE_DATA_START, 1, n, width).getValues();
    var today = stripTime_(new Date());
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var type = ruleType_(r[1]);
      if (!type) continue;
      var until = parseDate_(r[5]);
      out.push({
        enabled: isTrue_(r[0]), type: type,
        who: norm_(r[2]), then: norm_(r[3]), scope: norm_(r[4]),
        until: until, expired: !!(until && until < today),
        priority: toInt_(r[6], 100), notes: norm_(r[7]),
        row: RULE_DATA_START + i,
      });
    }
    out.sort(function (a, b) { return a.priority - b.priority; });
    return out;
  });
}

/** Only the rules actually in force right now. */
function activeRules_() {
  return readRules_().filter(function (r) { return r.enabled && !r.expired; });
}

/** Class/section → {block, floor}, cached per execution. */
function readBlocks_() {
  return memo('blocks', function () {
    var sheet = sheet_(SS.BLOCKS);
    var map = {};
    if (!sheet || sheet.getLastRow() < BLOCK_DATA_START) return map;
    var n = sheet.getLastRow() - BLOCK_DATA_START + 1;
    var data = sheet.getRange(BLOCK_DATA_START, 1, n, BLOCK_HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      var cls = norm_(data[i][0]);
      if (!cls) continue;
      map[classKey_(cls, data[i][1])] = {
        block: norm_(data[i][2]), floor: norm_(data[i][3]),
        blockKey: up_(data[i][2]), floorKey: up_(data[i][3]),
      };
    }
    return map;
  });
}

function classKey_(cls, section) { return up_(cls) + '|' + up_(section); }

/** Exact class+section, else the same class with no section. */
function blockFor_(blocks, cls, section) {
  return blocks[classKey_(cls, section)] || blocks[classKey_(cls, '')] || null;
}

/* ───────── compilation ───────── */

/**
 * Compile every active rule into flat lookup maps. Called once per plan.
 * A malformed rule is skipped and reported rather than thrown, so one bad
 * row can never stop the school's substitutions being assigned.
 */
function buildRuleContext_() {
  return memo('ruleCtx', function () {
    var ctx = {
      dedicatedByTeam: {},     // 'PRE-PRIMARY' -> ['A Teacher', …] in priority order
      dedicatedTeamLabel: {},  // 'PRE-PRIMARY' -> 'Pre-primary' (for messages)
      floorsByTeacher: {},     // 'ANITA MARY'  -> { GROUND: true }
      blockBonus: 0,
      blocks: readBlocks_(),
      teamByClass: {},
      homeBlock: {},
      problems: [],
      active: [],
      any: false,
    };

    var rules = activeRules_();
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      try {
        if (r.type.id === 'DEDICATED_SUB') {
          var team = up_(r.who);
          var names = csvList_(r.then);
          if (!team || !names.length) { ctx.problems.push(ruleProblem_(r, 'needs a team and at least one teacher')); continue; }
          ctx.dedicatedByTeam[team] = (ctx.dedicatedByTeam[team] || []).concat(names);
          ctx.dedicatedTeamLabel[team] = r.who;
          ctx.active.push({ label: r.type.label, detail: r.who + ' → ' + names.join(', ') });

        } else if (r.type.id === 'FLOOR_LIMIT') {
          var who = norm_(r.who);
          var floors = csvList_(r.then);
          if (!who || !floors.length) { ctx.problems.push(ruleProblem_(r, 'needs a teacher and at least one floor')); continue; }
          var set = ctx.floorsByTeacher[up_(who)] || {};
          floors.forEach(function (f) { set[up_(f)] = true; });
          ctx.floorsByTeacher[up_(who)] = set;
          ctx.active.push({ label: r.type.label, detail: who + ' → ' + floors.join(', ') + ' only' });

        } else if (r.type.id === 'BLOCK_AFFINITY') {
          var strength = r.then === '' ? DEFAULT_BLOCK_BONUS : parseFloat(r.then);
          if (isNaN(strength) || strength < 0) strength = DEFAULT_BLOCK_BONUS;
          ctx.blockBonus = strength;
          ctx.active.push({ label: r.type.label, detail: 'strength ' + strength });
        }
      } catch (e) {
        ctx.problems.push(ruleProblem_(r, e.message));
      }
    }

    ctx.any = ctx.active.length > 0;
    if (ctx.any) {
      try { ctx.teamByClass = getClassTeamLookup(); } catch (e) { ctx.problems.push({ row: 0, text: e.message }); }
      if (ctx.blockBonus > 0) {
        try { ctx.homeBlock = buildHomeBlocks_(ctx.blocks); } catch (e) { ctx.problems.push({ row: 0, text: e.message }); }
      }
    }
    return ctx;
  });
}

function ruleProblem_(r, text) { return { row: r.row, rule: r.type.label, text: text }; }

/**
 * Where each teacher does most of their teaching. Derived from the timetable,
 * so nobody has to maintain another list. One pass, cached.
 */
function buildHomeBlocks_(blocks) {
  var tally = {};
  var tt = getTimetable();
  for (var i = 0; i < tt.length; i++) {
    var e = tt[i];
    if (!e.teacher) continue;
    var info = blockFor_(blocks, e.class, e.section);
    if (!info || !info.blockKey) continue;
    var k = up_(e.teacher);
    if (!tally[k]) tally[k] = {};
    tally[k][info.blockKey] = (tally[k][info.blockKey] || 0) + 1;
  }
  var home = {};
  for (var t in tally) {
    var best = '', n = -1;
    for (var b in tally[t]) if (tally[t][b] > n) { n = tally[t][b]; best = b; }
    home[t] = best;
  }
  return home;
}

/* ───────── evaluation (called from the assignment loop) ───────── */

/** The dedicated substitutes for a slot, or null. Pure lookups. */
function dedicatedForSlot_(ctx, slot) {
  if (!ctx.any) return null;
  var team = up_(ctx.teamByClass[classKey_(slot.class, slot.section)] || slot.team || '');
  if (!team) return null;
  var names = ctx.dedicatedByTeam[team];
  return names && names.length ? { names: names, team: ctx.dedicatedTeamLabel[team] || team } : null;
}

/** Hard check: may this teacher be sent to this slot's room? */
function floorAllows_(ctx, teacher, slot) {
  var limit = ctx.floorsByTeacher[up_(teacher)];
  if (!limit) return true;
  var info = blockFor_(ctx.blocks, slot.class, slot.section);
  if (!info || !info.floorKey) return true;      // unmapped class — never block on missing data
  return !!limit[info.floorKey];
}

/** Soft bonus: is this teacher's home block the slot's block? */
function blockBonusFor_(ctx, teacher, slot) {
  if (!ctx.blockBonus) return 0;
  var info = blockFor_(ctx.blocks, slot.class, slot.section);
  if (!info || !info.blockKey) return 0;
  return ctx.homeBlock[up_(teacher)] === info.blockKey ? ctx.blockBonus : 0;
}

/* ───────── the tabs ───────── */

function writeRulesTab_() {
  var sheet = sheet_(SS.RULES);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  titleBand_(sheet, '⚖️ Rules', RULE_HEADERS.length);
  sheet.getRange(2, 1, 1, RULE_HEADERS.length).setValues([RULE_HEADERS])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
  var widths = [80, 235, 205, 235, 150, 95, 70, 300];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(2);
  applyRulesValidation_(sheet);
  sheet.getRange('A1').setNote(rulesHelpText_());
  sheet.getRange(2, 3).setNote('What the rule keys off — a team name, a teacher name, or "All".');
  sheet.getRange(2, 4).setNote('What the rule does — a teacher name, a list of floors, or a strength.');
  sheet.getRange(2, 6).setNote('Optional. After this date the rule stops applying, with no need to remember to delete it.');
  sheet.getRange(2, 7).setNote('Lower runs first when two rules could both apply. Default 100.');
  trimColumnsOnly_(sheet, RULE_HEADERS.length);
}

/** Dropdowns on the rules grid. Split out so refreshLabels can reapply them. */
function applyRulesValidation_(sheet) {
  var rows = Math.max(1, sheet.getMaxRows() - RULE_DATA_START + 1);
  sheet.getRange(RULE_DATA_START, 1, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['TRUE', 'FALSE'], true).build());
  sheet.getRange(RULE_DATA_START, 2, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ruleTypeLabels_(), true).setAllowInvalid(true).build());
  sheet.getRange(RULE_DATA_START, 6, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build());
}

function rulesHelpText_() {
  var lines = ['One row per rule. Untick Enabled to switch a rule off without losing it.', ''];
  for (var i = 0; i < RULE_TYPES.length; i++) {
    var t = RULE_TYPES[i];
    lines.push(t.label);
    lines.push('   Who / What: ' + t.who);
    lines.push('   Then:       ' + t.then);
    lines.push('   ' + t.hint);
    lines.push('');
  }
  lines.push('Run ⚖️ Check rules after editing — it catches misspelt names before they cost you cover.');
  return lines.join('\n');
}

function writeBlocksTab_() {
  var sheet = sheet_(SS.BLOCKS);
  sheet.clear();
  sheet.clearConditionalFormatRules();
  titleBand_(sheet, '🏫 Blocks & Floors', BLOCK_HEADERS.length);
  sheet.getRange(2, 1, 1, BLOCK_HEADERS.length).setValues([BLOCK_HEADERS])
    .setBackground(C.INK).setFontColor(C.WHITE).setFontWeight('bold').setFontSize(10);
  var widths = [110, 90, 130, 130, 260];
  for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  sheet.setFrozenRows(2);
  applyBlocksValidation_(sheet);
  sheet.getRange('A1').setNote(
    'Where each class sits. One row per class-section — about 17 rows.\n\n' +
    'Floor drives the "Limit a teacher to certain floors" rule.\n' +
    'Block drives the "Prefer a substitute from the same block" rule.\n\n' +
    'Leave Section blank to cover every section of a class.\n' +
    'A class that is not listed here is never blocked — rules only ever act on what you have filled in.');
  trimColumnsOnly_(sheet, BLOCK_HEADERS.length);
  try { seedBlocksFromTimetable_(); } catch (e) { /* source not connected yet */ }
}

function applyBlocksValidation_(sheet) {
  var rows = Math.max(1, sheet.getMaxRows() - BLOCK_DATA_START + 1);
  sheet.getRange(BLOCK_DATA_START, 4, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(FLOOR_NAMES, true).setAllowInvalid(true).build());
}

/**
 * Pre-fill the class/section rows from the live timetable so the office only
 * has to type Block and Floor. Never overwrites rows that already exist.
 */
function seedBlocksFromTimetable_() {
  var sheet = sheet_(SS.BLOCKS);
  if (!sheet) return 0;
  var have = readBlocks_();
  var seen = {}, add = [];
  var tt = getTimetable();
  for (var i = 0; i < tt.length; i++) {
    var k = classKey_(tt[i].class, tt[i].section);
    if (seen[k] || have[k]) continue;
    seen[k] = true;
    add.push([tt[i].class, tt[i].section, '', '', '']);
  }
  if (!add.length) return 0;
  add.sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });
  var start = Math.max(sheet.getLastRow() + 1, BLOCK_DATA_START);
  ensureRows_(sheet, start + add.length - 1);
  sheet.getRange(start, 1, add.length, BLOCK_HEADERS.length).setValues(add);
  clearCache();
  return add.length;
}

/* ───────── diagnostics ───────── */

/**
 * Validate every rule against live data. A misspelt teacher name is the
 * failure mode that silently costs cover, so this is worth running after
 * any edit.
 */
function checkRules() {
  var ui = SpreadsheetApp.getUi();
  clearCache();

  var teachers = {}, teamNames = {}, sourceErr = '';
  try {
    getAllTeachers().forEach(function (t) { teachers[up_(t)] = t; });
    var lk = getClassTeamLookup();
    for (var k in lk) if (lk[k]) teamNames[up_(lk[k])] = lk[k];
  } catch (e) { sourceErr = e.message; }

  var blocks = readBlocks_();
  var floorsSeen = {}, mappedClasses = 0;
  for (var b in blocks) { mappedClasses++; if (blocks[b].floorKey) floorsSeen[blocks[b].floorKey] = true; }

  var all = readRules_(), lines = [], warn = 0;
  if (!all.length) lines.push('No rules defined yet — the system uses its normal logic.');

  for (var i = 0; i < all.length; i++) {
    var r = all[i], issues = [];
    if (r.type.id === 'DEDICATED_SUB') {
      if (!sourceErr && !teamNames[up_(r.who)]) issues.push('team "' + r.who + '" is not used by any class in the Allotment');
      csvList_(r.then).forEach(function (n) {
        if (!sourceErr && !teachers[up_(n)]) issues.push('teacher "' + n + '" is not in the Allotment');
      });
    } else if (r.type.id === 'FLOOR_LIMIT') {
      if (!sourceErr && !teachers[up_(r.who)]) issues.push('teacher "' + r.who + '" is not in the Allotment');
      csvList_(r.then).forEach(function (f) {
        if (!floorsSeen[up_(f)]) issues.push('no class is marked as being on floor "' + f + '"');
      });
      if (!mappedClasses) issues.push('🏫 Blocks & Floors is empty, so this rule can never apply');
    } else if (r.type.id === 'BLOCK_AFFINITY') {
      if (r.then !== '' && isNaN(parseFloat(r.then))) issues.push('strength "' + r.then + '" is not a number');
      if (!mappedClasses) issues.push('🏫 Blocks & Floors is empty, so this rule can never apply');
    }

    var state = !r.enabled ? '⏸ disabled' : r.expired ? '⌛ expired ' + isoDate_(r.until) : '✅ active';
    if (issues.length && r.enabled && !r.expired) warn++;
    lines.push((issues.length && r.enabled && !r.expired ? '⚠️ ' : '') + 'Row ' + r.row + '  ' + state + '  ·  ' + r.type.label);
    lines.push('        ' + r.who + '  →  ' + r.then);
    issues.forEach(function (x) { lines.push('        ⚠️ ' + x); });
  }

  var ctx = buildRuleContext_();
  ctx.problems.forEach(function (p) { lines.push('⚠️ Row ' + p.row + ': ' + p.text); warn += 1; });

  ui.alert('⚖️ Rule check',
    (sourceErr ? '⚠️ Names could not be checked — the timetable workbook is unreachable.\n' + sourceErr + '\n\n' : '') +
    'Classes mapped on 🏫 Blocks & Floors: ' + mappedClasses +
    (mappedClasses ? '  (floors: ' + Object.keys(floorsSeen).join(', ') + ')' : '') + '\n\n' +
    lines.join('\n') + '\n\n' +
    (warn ? '⚠️ ' + warn + ' rule(s) need attention. A rule with a bad name is skipped, not guessed at.'
          : '✅ Everything checks out.'),
    ui.ButtonSet.OK);
}

/** Pre-fill the block table from the timetable, on demand. */
function seedBlocks() {
  try {
    var n = seedBlocksFromTimetable_();
    ss_().setActiveSheet(sheet_(SS.BLOCKS));
    toast_(n ? 'Added ' + n + ' class row(s) — now fill in Block and Floor.' : 'Every class is already listed.', '🏫', 8);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Could not read the class list', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
