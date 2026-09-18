/**
 * ============================================================
 * Constants.gs — Shared constants, palette, sheet names
 * Weekly Substitution System (standalone Google Sheet)
 * ============================================================
 */

/* ───────── Sheet (tab) names in THIS substitution workbook ───────── */
const SS = {
  CONFIG:    '⚙️ Config',
  CONSOLE:   '▶️ Console',
  MARK_ABSENCE: '📝 Mark Absence',
  POOL:      '🔁 Substitution Pool',
  LOG:       '🗂️ Log',
  DASHBOARD: '📊 Fairness',
  ANALYTICS: '🔎 Analytics',
  ABSENCE:   '🗓️ Absence Register',
  RULES:     '⚖️ Rules',
  BLOCKS:    '🏫 Blocks & Floors',
  REPORTS:   '📄 Reports',
  IMPORT_HR: '👥 importHR',
  HELP:      '📖 Help',
};

/* ───────── Modern pastel palette ───────── */
const C = {
  INK:        '#1F2933',
  SUBTLE:     '#7B8794',
  HAIRLINE:   '#E4E7EB',
  WHITE:      '#FFFFFF',
  PAPER:      '#F7F8FA',

  // Brand / accents
  INDIGO:     '#4C5FD5',
  INDIGO_50:  '#EEF0FB',
  TEAL:       '#0E9F8E',
  TEAL_50:    '#E3F5F2',
  AMBER:      '#E8A33D',
  AMBER_50:   '#FBF1DF',
  ROSE:       '#E2566B',
  ROSE_50:    '#FBE7EB',
  GREEN:      '#2FA36B',
  GREEN_50:   '#E5F4EC',
  VIOLET:     '#8B5CF6',
  VIOLET_50:  '#F1ECFE',

  // Header bands
  HEAD_DARK:  '#2D3A6B',
  HEAD_BAND:  '#EEF0FB',

  // Status
  OK_BG:      '#E5F4EC',
  WARN_BG:    '#FBF1DF',
  BAD_BG:     '#FBE7EB',
  BUSY_BG:    '#F0F1F4',
};

/* ───────── Default configuration values ───────── */
const DEF = {
  ACADEMIC_YEAR: '2026-27',
  SCHOOL_NAME:   'Methodist School',
  TERM_LABEL:    'Term 1',

  DAYS:          ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  PERIODS:       8,
  BREAKS_AFTER:  [2, 4, 6],
  FIRST_AFTERNOON_PERIOD: 5, // periods from here are the afternoon half (after the ~12:30 split)

  // Source workbook (the main Timetable Management System)
  SOURCE_URL:    '',
  ALLOTMENT_TAB: '📋 Allotment',
  TIMETABLE_TAB: '📅 Timetable',
  DUTIES_TAB:    '👩‍🏫 Staff Duties',
  ALLOTMENT_START_ROW: 4,
  TIMETABLE_START_ROW: 4,
  DUTIES_START_ROW:    4,

  // Allotment column mapping (1-based, matches main system)
  COL: { totalPeriods: 1, class: 2, section: 3, subject: 4, teacher: 5, department: 6, team: 7, periodsAllotted: 8 },
  SUB_SUBJECT_LABEL: 'Substitution',

  // Subjects that never need a substitute (periods are skipped)
  NON_SUB_SUBJECTS: ['Substitution', 'SF', 'TC', 'ICT', 'Digital Duties', 'Other Duties',
                     'Coaching Morning', 'Coaching Evening', 'Resource Room', 'Viceprincipal'],

  // Assignment preferences
  PREFER_SAME_DEPT:   true,
  PREFER_SAME_TEAM:   true,
  PREFER_CONTINUITY:  true,
  FAIRNESS_BASIS:     'Term', // 'Term' = balance on cumulative term load (never resets, recommended)
                              // 'Week' = balance on this ISO week only (resets weekly)
  MAX_SUBS_PER_DAY:   0,      // 0 = no per-day ceiling
  MAX_SUBS_PER_WEEK:  0,      // 0 = no extra weekly ceiling (Week basis always caps at the allotment)
  WEEK_STARTS_ON:     'Monday',

  // Notifications
  CHAT_WEBHOOK:   '',
  SEND_CHAT_CARD: true,
  SEND_EMAIL:     false,
  SEND_DM:        false,
  SHEET_LINK:     '',
  TEST_CHAT_USER_ID: '',  // your own Chat user id (users/NNN) for the DM test

  // Weekly Principal report
  REPORT_PREFIX:      'Substitution Report',
  REPORT_AUTO:        true,
  REPORT_AUTO_DAY:    'Monday',
  REPORT_AUTO_HOUR:   7,
  POST_REPORT_CHAT:   true,
  REPORTS_FOLDER_ID:  '',

  // HR lookup
  HR_NAME_COL:    1,
  HR_EMAIL_COL:   2,
  HR_CHATID_COL:  3,
};

/* ───────── Absence vocabulary ─────────
 * The single source of truth. Drives the Mark Absence dropdown, the side
 * panel, the register column, the substitution window, and every grouping
 * in the weekly report. Add a type here and it appears everywhere.
 *
 *   category — what kind of absence it is, for reporting (Leave / Permission / OD)
 *   window   — which periods are substituted: FULL · AM · PM · PERIODS (explicit)
 */
const ABSENCE_TYPES = [
  { id: 'LEAVE_FULL', label: 'Leave - Full day',  category: 'Leave',      window: 'FULL'    },
  { id: 'LEAVE_AM',   label: 'Leave - Morning',   category: 'Leave',      window: 'AM'      },
  { id: 'LEAVE_PM',   label: 'Leave - Afternoon', category: 'Leave',      window: 'PM'      },
  { id: 'PERMISSION', label: 'Permission',        category: 'Permission', window: 'PERIODS' },
  { id: 'OD_FULL',    label: 'OD - Full day',     category: 'OD',         window: 'FULL'    },
  { id: 'OD_AM',      label: 'OD - Morning',      category: 'OD',         window: 'AM'      },
  { id: 'OD_PM',      label: 'OD - Afternoon',    category: 'OD',         window: 'PM'      },
  { id: 'OD_PERIODS', label: 'OD - Periods',      category: 'OD',         window: 'PERIODS' },
];

/** Categories in report order. */
const ABSENCE_CATEGORIES = ['Leave', 'Permission', 'OD'];

/** Anything recorded before the OD vocabulary existed was leave. */
const LEGACY_ABSENCE_TYPES = {
  'FULL': 'LEAVE_FULL', 'FULL DAY': 'LEAVE_FULL', 'LEAVE': 'LEAVE_FULL',
  'AM': 'LEAVE_AM', 'MORNING': 'LEAVE_AM',
  'PM': 'LEAVE_PM', 'AFTERNOON': 'LEAVE_PM',
  'CUSTOM': 'PERMISSION', 'PERIODS': 'PERMISSION',
};

/** Recorded but unrecognised — shown as its own bucket, never guessed at. */
const UNKNOWN_ABSENCE_TYPE = { id: 'UNKNOWN', label: 'Unknown', category: 'Unknown', window: 'FULL' };

/**
 * Resolve anything — id, label, or a legacy value — to a type object.
 * Blank means the coordinator left it empty: treat as a full day of leave,
 * which is what the system did before types existed.
 */
function absenceType_(v) {
  var s = norm_(v);
  if (!s) return ABSENCE_TYPES[0];
  var key = s.toUpperCase();
  var i;
  for (i = 0; i < ABSENCE_TYPES.length; i++) {
    if (ABSENCE_TYPES[i].id === key || ABSENCE_TYPES[i].label.toUpperCase() === key) return ABSENCE_TYPES[i];
  }
  if (LEGACY_ABSENCE_TYPES[key]) {
    for (i = 0; i < ABSENCE_TYPES.length; i++) {
      if (ABSENCE_TYPES[i].id === LEGACY_ABSENCE_TYPES[key]) return ABSENCE_TYPES[i];
    }
  }
  return UNKNOWN_ABSENCE_TYPE;
}

/** Labels for a dropdown, in declaration order. */
function absenceTypeLabels_() {
  return ABSENCE_TYPES.map(function (t) { return t.label; });
}

/** True when this type cannot be resolved without an explicit period list. */
function absenceNeedsPeriods_(v) { return absenceType_(v).window === 'PERIODS'; }

/* ───────── Substitution rules ─────────
 * Rule TYPES live here; rule INSTANCES live as rows on the ⚖️ Rules tab.
 * Adding a rule = a row. Adding a kind of rule = an entry here plus a
 * handler in Rules.js. The `who` / `then` hints are shown on the tab so
 * whoever fills it in knows what belongs in each column.
 */
const RULE_TYPES = [
  {
    id: 'DEDICATED_SUB',
    label: 'Dedicated substitute for a team',
    who:  'Team name, exactly as it appears in the Allotment (e.g. Pre-primary)',
    then: 'Teacher name(s), best first, comma-separated',
    hint: 'Periods belonging to this team go to the named teacher(s) first. If none of '
        + 'them is free, normal substitution logic takes over and the plan says so.',
  },
  {
    id: 'FLOOR_LIMIT',
    label: 'Limit a teacher to certain floors',
    who:  'Teacher name (one per row)',
    then: 'Floor name(s) they may be assigned, comma-separated (e.g. Ground)',
    hint: 'A hard limit — never overridden, including when cover is short. Needs the '
        + 'class floors filled in on 🏫 Blocks & Floors. Use "Until" so it expires by itself.',
  },
  {
    id: 'BLOCK_AFFINITY',
    label: 'Prefer a substitute from the same block',
    who:  'All  (or leave blank)',
    then: 'Strength — blank uses the default of ' + '1.5',
    hint: 'A preference, not a limit: it competes with fairness rather than overriding it. '
        + 'A teacher\'s home block is worked out from where they already teach most.',
  },
  {
    id: 'FREE_PERIOD_GUARD',
    label: 'Protect teachers with few free periods',
    who:  'All  (or a team name, or one teacher name)',
    then: 'Ladder of free periods : maximum substitutions, e.g. 1:0, 2:1',
    hint: 'A hard limit, like a floor limit. Free periods are counted from the timetable '
        + 'and duty roster for the day, not from cover already given out. A count left off '
        + 'the ladder is unconstrained.',
  },
];

const DEFAULT_BLOCK_BONUS = 1.5;
const FLOOR_NAMES = ['Ground', 'First', 'Second', 'Third'];

/** Resolve a rule label or id to its type object, or null. */
function ruleType_(v) {
  var key = up_(v);
  for (var i = 0; i < RULE_TYPES.length; i++) {
    if (RULE_TYPES[i].id === key || RULE_TYPES[i].label.toUpperCase() === key) return RULE_TYPES[i];
  }
  return null;
}
function ruleTypeLabels_() { return RULE_TYPES.map(function (t) { return t.label; }); }

/* ───────── Per-execution cache ───────── */
let _C = {};
function clearCache() { _C = {}; }
function memo(key, fn) {
  if (!(key in _C)) _C[key] = fn();
  return _C[key];
}

/* ───────── Tiny helpers ───────── */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { return ss_().getSheetByName(name); }
function toast_(msg, title, secs) {
  ss_().toast(msg, title || '🔁 Substitutions', secs || 5);
}
function norm_(v) { return String(v == null ? '' : v).trim(); }
function up_(v) { return norm_(v).toUpperCase(); }
function csvList_(v) {
  if (!v) return [];
  return String(v).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
}
function titleCase_(s) {
  return norm_(s).replace(/\w\S*/g, function (t) { return t.charAt(0).toUpperCase() + t.substr(1).toLowerCase(); });
}
