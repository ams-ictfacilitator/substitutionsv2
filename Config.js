/**
 * ============================================================
 * Config.gs — Read every setting from the ⚙️ Config tab
 * Everything in this system is variabilised here.
 * ============================================================
 */

/**
 * Return the full, structured configuration object (cached per execution).
 */
function getConfig() {
  return memo('config', function () {
    var sheet = sheet_(SS.CONFIG);
    var cfg = defaultConfig_();
    if (!sheet) return cfg;

    var data = sheet.getDataRange().getValues();
    var coordinators = [];      // {team, name, email}
    var timings = {};           // period -> "9:00–9:40"
    var inCoordSection = false;

    for (var i = 0; i < data.length; i++) {
      var key = norm_(data[i][0]);
      var val = data[i][1];
      var v = norm_(val);

      // Team-coordinator table is captured row-by-row
      if (key.toUpperCase() === 'TEAM COORDINATORS') { inCoordSection = true; continue; }
      if (inCoordSection) {
        if (key === 'Team' || key === '') { if (key === '' && v === '') inCoordSection = false; continue; }
        coordinators.push({ team: key, name: v, email: norm_(data[i][2]) });
        continue;
      }

      var tm = key.match(/^Period\s+(\d+)\s+Timing$/i);
      if (tm) { timings[parseInt(tm[1], 10)] = v; continue; }

      switch (key) {
        case 'Academic Year':            cfg.academicYear = v || cfg.academicYear; break;
        case 'School Name':              cfg.schoolName = v || cfg.schoolName; break;
        case 'Term Label':               cfg.termLabel = v || cfg.termLabel; break;

        case 'Source Spreadsheet URL':   cfg.sourceUrl = v; break;
        case 'Allotment Tab Name':       cfg.allotmentTab = v || cfg.allotmentTab; break;
        case 'Timetable Tab Name':       cfg.timetableTab = v || cfg.timetableTab; break;
        case 'Staff Duties Tab Name':    cfg.dutiesTab = v || cfg.dutiesTab; break;
        case 'Allotment Data Start Row': cfg.allotmentStartRow = toInt_(v, cfg.allotmentStartRow); break;
        case 'Timetable Data Start Row': cfg.timetableStartRow = toInt_(v, cfg.timetableStartRow); break;
        case 'Staff Duties Data Start Row': cfg.dutiesStartRow = toInt_(v, cfg.dutiesStartRow); break;

        case 'Days':                     cfg.days = csvList_(v).length ? csvList_(v) : cfg.days; break;
        case 'Periods Per Day':          cfg.periods = toInt_(v, cfg.periods); break;
        case 'Break After Periods':      cfg.breaksAfter = csvList_(v).map(Number); break;
        case 'First Afternoon Period':   cfg.firstAfternoonPeriod = toInt_(v, cfg.firstAfternoonPeriod); break;

        case 'Col: Class':               cfg.col.class = toInt_(v, cfg.col.class); break;
        case 'Col: Section':             cfg.col.section = toInt_(v, cfg.col.section); break;
        case 'Col: Subject':             cfg.col.subject = toInt_(v, cfg.col.subject); break;
        case 'Col: Teacher':             cfg.col.teacher = toInt_(v, cfg.col.teacher); break;
        case 'Col: Department':          cfg.col.department = toInt_(v, cfg.col.department); break;
        case 'Col: Team':                cfg.col.team = toInt_(v, cfg.col.team); break;
        case 'Col: Periods Allotted':    cfg.col.periodsAllotted = toInt_(v, cfg.col.periodsAllotted); break;
        case 'Col: Total Periods':       cfg.col.totalPeriods = toInt_(v, cfg.col.totalPeriods); break;
        case 'Substitution Subject Label': cfg.subLabel = v || cfg.subLabel; break;

        case 'Non-Substitutable Subjects': cfg.nonSubSubjects = csvList_(v); break;
        case 'Prefer Same Department':   cfg.preferDept = isTrue_(v); break;
        case 'Prefer Same Team':         cfg.preferTeam = isTrue_(v); break;
        case 'Prefer Continuity':        cfg.preferContinuity = isTrue_(v); break;
        case 'Fairness Basis':           cfg.fairnessBasis = /week/i.test(v) ? 'Week' : 'Term'; break;
        case 'Max Substitutions Per Day': cfg.maxPerDay = toInt_(v, 0); break;
        case 'Max Substitutions Per Week': cfg.maxPerWeek = toInt_(v, 0); break;
        case 'Week Starts On':           cfg.weekStartsOn = v || cfg.weekStartsOn; break;

        case 'Google Chat Webhook URL':  cfg.chatWebhook = v; break;
        case 'Send Chat Card':           cfg.sendChatCard = isTrue_(v); break;
        case 'Send Email To Substitutes': cfg.sendEmail = isTrue_(v); break;
        case 'Send Direct Messages':     cfg.sendDm = isTrue_(v); break;
        case 'This Sheet Link':          cfg.sheetLink = v; break;
        case 'Test Chat User ID':        cfg.testChatUserId = v; break;

        case 'Report File Prefix':       cfg.reportPrefix = v || cfg.reportPrefix; break;
        case 'Auto Generate Weekly Report': cfg.reportAuto = isTrue_(v); break;
        case 'Auto Report Day':          cfg.reportAutoDay = v || cfg.reportAutoDay; break;
        case 'Auto Report Hour':         cfg.reportAutoHour = toInt_(v, cfg.reportAutoHour); break;
        case 'Post Report To Chat':      cfg.postReportToChat = isTrue_(v); break;
        case 'Reports Folder ID':        cfg.reportsFolderId = v; break;

        case 'HR Source URL':            cfg.hrUrl = v; break;
        case 'HR Col: Name':             cfg.hrNameCol = toInt_(v, cfg.hrNameCol); break;
        case 'HR Col: Email':            cfg.hrEmailCol = toInt_(v, cfg.hrEmailCol); break;
        case 'HR Col: Chat User ID':     cfg.hrChatCol = toInt_(v, cfg.hrChatCol); break;
      }
    }

    cfg.coordinators = coordinators;
    cfg.periodTimings = timings;
    return cfg;
  });
}

function defaultConfig_() {
  return {
    academicYear: DEF.ACADEMIC_YEAR,
    schoolName: DEF.SCHOOL_NAME,
    termLabel: DEF.TERM_LABEL,

    sourceUrl: DEF.SOURCE_URL,
    allotmentTab: DEF.ALLOTMENT_TAB,
    timetableTab: DEF.TIMETABLE_TAB,
    dutiesTab: DEF.DUTIES_TAB,
    allotmentStartRow: DEF.ALLOTMENT_START_ROW,
    timetableStartRow: DEF.TIMETABLE_START_ROW,
    dutiesStartRow: DEF.DUTIES_START_ROW,

    days: DEF.DAYS.slice(),
    periods: DEF.PERIODS,
    breaksAfter: DEF.BREAKS_AFTER.slice(),
    firstAfternoonPeriod: DEF.FIRST_AFTERNOON_PERIOD,

    col: JSON.parse(JSON.stringify(DEF.COL)),
    subLabel: DEF.SUB_SUBJECT_LABEL,

    nonSubSubjects: DEF.NON_SUB_SUBJECTS.slice(),
    preferDept: DEF.PREFER_SAME_DEPT,
    preferTeam: DEF.PREFER_SAME_TEAM,
    preferContinuity: DEF.PREFER_CONTINUITY,
    fairnessBasis: DEF.FAIRNESS_BASIS,
    maxPerDay: DEF.MAX_SUBS_PER_DAY,
    maxPerWeek: DEF.MAX_SUBS_PER_WEEK,
    weekStartsOn: DEF.WEEK_STARTS_ON,

    chatWebhook: DEF.CHAT_WEBHOOK,
    sendChatCard: DEF.SEND_CHAT_CARD,
    sendEmail: DEF.SEND_EMAIL,
    sendDm: DEF.SEND_DM,
    sheetLink: DEF.SHEET_LINK,
    testChatUserId: DEF.TEST_CHAT_USER_ID,

    reportPrefix: DEF.REPORT_PREFIX,
    reportAuto: DEF.REPORT_AUTO,
    reportAutoDay: DEF.REPORT_AUTO_DAY,
    reportAutoHour: DEF.REPORT_AUTO_HOUR,
    postReportToChat: DEF.POST_REPORT_CHAT,
    reportsFolderId: DEF.REPORTS_FOLDER_ID,

    hrUrl: '',
    hrNameCol: DEF.HR_NAME_COL,
    hrEmailCol: DEF.HR_EMAIL_COL,
    hrChatCol: DEF.HR_CHATID_COL,

    coordinators: [],
    periodTimings: {},
  };
}

/* ───────── parse helpers ───────── */
function toInt_(v, fallback) { var n = parseInt(v, 10); return isNaN(n) ? fallback : n; }
function isTrue_(v) {
  var s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1' || s === '✓' || s === 'ON';
}

/**
 * Write a value back into column B of the Config tab for a given key. Returns true if found.
 */
function setConfigValue_(key, value) {
  var sheet = sheet_(SS.CONFIG);
  if (!sheet || sheet.getLastRow() < 1) return false;
  var keys = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (norm_(keys[i][0]) === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      clearCache();
      return true;
    }
  }
  return false;
}

/**
 * Extract a spreadsheet ID from a full URL or a bare ID.
 */
function extractSpreadsheetId_(urlOrId) {
  var s = norm_(urlOrId);
  if (!s) return '';
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}
