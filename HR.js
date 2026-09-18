/**
 * ============================================================
 * HR.gs — Map teacher name -> email / Chat user id
 * Reads the 👥 importHR tab (you can IMPORTRANGE your HR database into it).
 * ============================================================
 */

/**
 * Build { normalisedName: { email, chatId } } from the importHR tab.
 */
function getHrMap() {
  return memo('hrMap', function () {
    var cfg = getConfig();
    var sheet = sheet_(SS.IMPORT_HR);
    var map = {};
    if (!sheet || sheet.getLastRow() < 3) return map;   // row 1 title, row 2 headers, data row 3+

    var nCols = Math.max(cfg.hrNameCol, cfg.hrEmailCol, cfg.hrChatCol);
    var n = sheet.getLastRow() - 2;
    var data = sheet.getRange(3, 1, n, nCols).getValues();
    for (var i = 0; i < data.length; i++) {
      var name = norm_(data[i][cfg.hrNameCol - 1]);
      if (!name) continue;
      map[hrKey_(name)] = {
        email: norm_(data[i][cfg.hrEmailCol - 1]),
        chatId: norm_(data[i][cfg.hrChatCol - 1]),
      };
    }
    return map;
  });
}

function hrKey_(name) { return String(name).trim().toLowerCase().replace(/\s+/g, ' '); }

/** Look up an email for a teacher name (exact, then loose match). */
function lookupEmail_(name) {
  var rec = hrLookup_(name);
  return rec ? rec.email : '';
}

/** Look up a Chat user id ("users/NNN") for a teacher name. */
function lookupChatUserId_(name) {
  var rec = hrLookup_(name);
  return rec ? rec.chatId : '';
}

function hrLookup_(name) {
  var map = getHrMap();
  var key = hrKey_(name);
  if (map[key]) return map[key];
  // loose: ignore double spaces / trailing initials punctuation already handled by key
  for (var k in map) {
    if (k.indexOf(key) === 0 || key.indexOf(k) === 0) return map[k];
  }
  return null;
}
