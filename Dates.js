/**
 * ============================================================
 * Dates.gs — Date parsing, day mapping, and weekly bucketing
 * ============================================================
 */

/**
 * Parse a user-entered date. Accepts a Date object, DD/MM/YYYY, YYYY-MM-DD,
 * or DD-MM-YYYY. Returns a Date (local) or null.
 */
function parseDate_(input) {
  if (input instanceof Date && !isNaN(input.getTime())) return stripTime_(input);
  var s = norm_(input);
  if (!s) return null;

  var m;
  // YYYY-MM-DD
  if ((m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/))) {
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  // DD/MM/YYYY or DD-MM-YYYY
  if ((m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/))) {
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : stripTime_(d);
}

function stripTime_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/**
 * Map a Date to a 0-based index into the configured working days (Mon=0…).
 * Returns -1 if the date falls on a non-working day.
 */
function dayIndexForDate_(date) {
  var cfg = getConfig();
  var jsDay = date.getDay();            // 0=Sun … 6=Sat
  var name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][jsDay];
  for (var i = 0; i < cfg.days.length; i++) {
    if (cfg.days[i].toLowerCase() === name.toLowerCase()) return i;
  }
  return -1;
}

/**
 * ISO-week key like "2026-W25" — the bucket used for the weekly cap.
 * Weeks reset automatically when a date in a new week is entered.
 */
function weekKey_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var day = d.getUTCDay() || 7;          // Mon=1…Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + (weekNo < 10 ? '0' + weekNo : weekNo);
}

/** Human date: "Mon, 16 Jun 2026". */
function prettyDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEE, dd MMM yyyy');
}

/** Stable storage date string: "2026-06-16". */
function isoDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Day name for a 0-based working-day index. */
function dayName_(dayIndex) {
  var cfg = getConfig();
  return cfg.days[dayIndex] || 'Day ' + (dayIndex + 1);
}
