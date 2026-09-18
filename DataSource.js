/**
 * ============================================================
 * DataSource.gs — Read live data from the main Timetable workbook
 * Uses SpreadsheetApp.openById() (reliable, no IMPORTRANGE prompts).
 * ============================================================
 */

/**
 * Open the source (main Timetable Management System) spreadsheet.
 * Throws a friendly error if not configured / not accessible.
 */
function openSource_() {
  return memo('sourceSS', function () {
    var cfg = getConfig();
    var id = extractSpreadsheetId_(cfg.sourceUrl);
    if (!id) {
      throw new Error('No Source Spreadsheet URL set. Open ⚙️ Config and paste the main Timetable sheet URL.');
    }
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('Could not open the source spreadsheet. Check the URL in ⚙️ Config and that you have access. (' + e.message + ')');
    }
  });
}

/**
 * Allotment records from the source.
 * Each: {class, section, subject, teacher, department, team, periodsAllotted}
 */
function getAllotment() {
  return memo('allotment', function () {
    var cfg = getConfig();
    var src = openSource_();
    var sheet = src.getSheetByName(cfg.allotmentTab);
    if (!sheet) throw new Error('Allotment tab "' + cfg.allotmentTab + '" not found in source sheet.');

    var startRow = cfg.allotmentStartRow;
    var lastRow = sheet.getLastRow();
    if (lastRow < startRow) return [];

    var cm = cfg.col;
    var nCols = Math.max(cm.totalPeriods, cm.class, cm.section, cm.subject, cm.teacher, cm.department, cm.team, cm.periodsAllotted);
    var rows = sheet.getRange(startRow, 1, lastRow - startRow + 1, nCols).getValues();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var teacher = norm_(r[cm.teacher - 1]);
      var subject = norm_(r[cm.subject - 1]);
      if (!teacher && !subject) continue;
      out.push({
        class: norm_(r[cm.class - 1]),
        section: norm_(r[cm.section - 1]),
        subject: subject,
        teacher: teacher,
        department: norm_(r[cm.department - 1]),
        team: norm_(r[cm.team - 1]),
        periodsAllotted: toInt_(r[cm.periodsAllotted - 1], 0),
      });
    }
    return out;
  });
}

/**
 * Timetable entries from the source.
 * Each: {class, section, dayIndex, period, subject, teacher}
 */
function getTimetable() {
  return memo('timetable', function () {
    var cfg = getConfig();
    var src = openSource_();
    var sheet = src.getSheetByName(cfg.timetableTab);
    if (!sheet) throw new Error('Timetable tab "' + cfg.timetableTab + '" not found in source sheet.');

    var days = cfg.days, periods = cfg.periods;
    var startRow = cfg.timetableStartRow;
    var lastRow = sheet.getLastRow();
    if (lastRow < startRow) return [];

    var lastCol = sheet.getLastColumn();
    var data = sheet.getRange(startRow, 1, lastRow - startRow + 1, lastCol).getValues();
    var out = [];
    for (var r = 0; r < data.length; r++) {
      var cls = norm_(data[r][1]);
      var section = norm_(data[r][2]);
      if (!cls) continue;
      for (var d = 0; d < days.length; d++) {
        for (var p = 1; p <= periods; p++) {
          var subCol = 3 + (d * periods * 2) + ((p - 1) * 2); // 0-based
          var subject = norm_(data[r][subCol]);
          var teacher = norm_(data[r][subCol + 1]);
          if (subject || teacher) {
            out.push({ class: cls, section: section, dayIndex: d, period: p, subject: subject, teacher: teacher });
          }
        }
      }
    }
    return out;
  });
}

/**
 * Staff-duty entries from the source.
 * Each: {teacher, dayIndex, period, duty}
 */
function getStaffDuties() {
  return memo('duties', function () {
    var cfg = getConfig();
    var src = openSource_();
    var sheet = src.getSheetByName(cfg.dutiesTab);
    if (!sheet) return [];               // duties are optional for availability

    var days = cfg.days, periods = cfg.periods;
    var startRow = cfg.dutiesStartRow;
    var lastRow = sheet.getLastRow();
    if (lastRow < startRow) return [];

    var nCols = 1 + days.length * periods;
    var data = sheet.getRange(startRow, 1, lastRow - startRow + 1, nCols).getValues();
    var out = [];
    for (var r = 0; r < data.length; r++) {
      var teacher = norm_(data[r][0]);
      if (!teacher) continue;
      for (var d = 0; d < days.length; d++) {
        for (var p = 0; p < periods; p++) {
          var col = 1 + d * periods + p; // 0-based
          var duty = norm_(data[r][col]);
          if (duty) out.push({ teacher: teacher, dayIndex: d, period: p + 1, duty: duty });
        }
      }
    }
    return out;
  });
}

/* ───────── Derived lookups ───────── */

/**
 * Sorted list of all teacher names that appear in the allotment.
 */
function getAllTeachers() {
  return memo('allTeachers', function () {
    var seen = {}, list = [];
    var a = getAllotment();
    for (var i = 0; i < a.length; i++) {
      var t = a[i].teacher;
      if (t && !seen[t]) { seen[t] = true; list.push(t); }
    }
    list.sort();
    return list;
  });
}

/**
 * teacher -> {department, team}  (first non-empty wins).
 */
function getTeacherMeta() {
  return memo('teacherMeta', function () {
    var meta = {};
    var a = getAllotment();
    for (var i = 0; i < a.length; i++) {
      var t = a[i].teacher;
      if (!t) continue;
      if (!meta[t]) meta[t] = { department: '', team: '' };
      if (!meta[t].department && a[i].department) meta[t].department = a[i].department;
      if (!meta[t].team && a[i].team) meta[t].team = a[i].team;
    }
    return meta;
  });
}

/**
 * Map "CLASS|SECTION" -> team, from the Allotment. This is what decides that
 * a period *belongs to* Pre-primary, independently of who was teaching it.
 */
function getClassTeamLookup() {
  return memo('classTeam', function () {
    var lk = {};
    var a = getAllotment();
    for (var i = 0; i < a.length; i++) {
      if (!a[i].team) continue;
      var k = up_(a[i].class) + '|' + up_(a[i].section);
      if (!lk[k]) lk[k] = a[i].team;
      var loose = up_(a[i].class) + '|';
      if (!lk[loose]) lk[loose] = a[i].team;
    }
    return lk;
  });
}

/**
 * Map "CLASS|SECTION|SUBJECT" -> department (to score subject-matched subs).
 */
function getSubjectDeptLookup() {
  return memo('subjDept', function () {
    var lk = {};
    var a = getAllotment();
    for (var i = 0; i < a.length; i++) {
      if (a[i].subject.toUpperCase() === getConfig().subLabel.toUpperCase()) continue;
      var k = up_(a[i].class) + '|' + up_(a[i].section) + '|' + up_(a[i].subject);
      if (!lk[k] && a[i].department) lk[k] = a[i].department;
    }
    return lk;
  });
}
