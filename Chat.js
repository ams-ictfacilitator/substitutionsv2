/**
 * ============================================================
 * Chat.gs — Notifications
 *   • Beautiful Google Chat card to the space webhook (works out of the box)
 *   • Optional email to each substitute (HR email lookup)
 *   • Optional 1:1 Chat DM (requires Chat API bot — see README)
 * ============================================================
 */

/**
 * Fire all configured notification channels for a plan.
 * Returns true if the primary channel (Chat card / email) succeeded.
 */
function sendNotifications_(plan) {
  var cfg = getConfig();
  var ok = false;

  if (cfg.sendChatCard && cfg.chatWebhook) {
    postChatCard_(cfg.chatWebhook, buildPlanCard_(plan, cfg));
    ok = true;
  }
  if (cfg.sendEmail) {
    ok = emailSubstitutes_(plan, cfg) || ok;
  }
  if (cfg.sendDm) {
    try { dmSubstitutes_(plan, cfg); } catch (e) { Logger.log('DM failed: ' + e.message); }
  }
  return ok;
}

/** POST a cardsV2 payload to a Google Chat incoming webhook. */
function postChatCard_(webhookUrl, payload) {
  var res = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Chat webhook returned ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  return true;
}

/**
 * Build the rich cardsV2 message for a plan.
 */
function buildPlanCard_(plan, cfg) {
  var s = plan.summary;
  var accent = s.unassigned > 0 ? '#E2566B' : '#0E9F8E';
  var sections = [];

  // ── Absent teacher(s) banner ──
  var absentWidgets = [];
  for (var i = 0; i < plan.absentTeachers.length; i++) {
    var who = plan.absentTeachers[i];
    var n = countFor_(plan.assignments, 'absent', who);
    absentWidgets.push(decorated_('🚫', who, n + ' period' + (n === 1 ? '' : 's') + ' to cover', null));
  }
  sections.push({ header: 'ABSENT', widgets: absentWidgets });

  // ── Cover detail, grouped by absent teacher (own teaching periods only) ──
  for (var a = 0; a < plan.absentTeachers.length; a++) {
    var absent = plan.absentTeachers[a];
    var rows = plan.assignments.filter(function (x) { return x.absent === absent && !x.reassigned; })
      .sort(function (p, q) { return p.period - q.period; });
    var widgets = [];
    for (var r = 0; r < rows.length; r++) {
      var x = rows[r];
      var timing = cfg.periodTimings[x.period] ? ' · ' + cfg.periodTimings[x.period] : '';
      var top = 'P' + x.period + timing + '  ·  ' + x.classSec + '  ·  ' + x.subject;
      if (x.status === 'ASSIGNED') {
        widgets.push(decorated_('✅', '<b>' + esc_(x.substitute) + '</b>', top, null));
      } else {
        widgets.push(decorated_('⚠️', '<font color="#E2566B"><b>No substitute free</b></font>', top, null));
      }
    }
    if (!widgets.length) widgets.push(decorated_('•', '<font color="#7B8794">No teaching periods in this window</font>', null, null));
    if (plan.absentTeachers.length > 1) {
      sections.push({ header: 'COVER · ' + absent.toUpperCase(), collapsible: false, widgets: widgets });
    } else {
      sections.push({ header: 'SUBSTITUTION PLAN', widgets: widgets });
    }
  }

  // ── Re-assigned cover (periods the now-absent teacher was substituting) ──
  var reRows = plan.assignments.filter(function (x) { return x.reassigned; })
    .sort(function (p, q) { return p.period - q.period; });
  if (reRows.length) {
    var reWidgets = [];
    for (var rr = 0; rr < reRows.length; rr++) {
      var y = reRows[rr];
      var timing2 = cfg.periodTimings[y.period] ? ' · ' + cfg.periodTimings[y.period] : '';
      var top2 = 'P' + y.period + timing2 + '  ·  ' + y.classSec + '  ·  ' + y.subject + '  ·  for ' + y.absent
        + (y.previousSub ? ' (was ' + y.previousSub + ')' : '');
      if (y.status === 'ASSIGNED') reWidgets.push(decorated_('↻', '<b>' + esc_(y.substitute) + '</b>', top2, null));
      else reWidgets.push(decorated_('⚠️', '<font color="#E2566B"><b>No substitute free</b></font>', top2, null));
    }
    sections.push({ header: 'RE-ASSIGNED COVER', widgets: reWidgets });
  }

  // ── Per-substitute summary ──
  var subWidgets = [];
  var subs = Object.keys(s.byTeacher).sort();
  for (var t = 0; t < subs.length; t++) {
    var list = s.byTeacher[subs[t]];
    var label = list.map(function (l) { return 'P' + l.period + ' ' + l.classSec; }).join('  •  ');
    subWidgets.push(decorated_('🧑‍🏫', '<b>' + esc_(subs[t]) + '</b>', label, null));
  }
  if (subWidgets.length) sections.push({ header: 'WHO COVERS WHAT', widgets: subWidgets });

  // ── Footer / summary + button ──
  var footWidgets = [{
    decoratedText: {
      startIcon: { knownIcon: 'DESCRIPTION' },
      text: '<b>' + s.assigned + '</b> assigned' + (s.unassigned > 0 ? '   ·   <font color="#E2566B"><b>' + s.unassigned + '</b> unassigned</font>' : '   ·   all covered 🎉'),
      bottomLabel: plan.weekKey + ' · pool of ' + plan.poolSize + ' substitutes',
      wrapText: true,
    }
  }];
  if (cfg.sheetLink) {
    footWidgets.push({ buttonList: { buttons: [{
      text: 'Open Substitution Sheet',
      onClick: { openLink: { url: cfg.sheetLink } },
    }]}});
  }
  sections.push({ widgets: footWidgets });

  var fallback = '🔁 Substitutions — ' + plan.prettyDate + ' · Absent: ' + plan.absentTeachers.join(', ') +
    ' · ' + s.assigned + ' assigned' + (s.unassigned ? ', ' + s.unassigned + ' unassigned' : '');

  return {
    text: fallback,
    cardsV2: [{
      cardId: 'sub-' + plan.dateStr,
      card: {
        header: {
          title: 'Substitution Plan',
          subtitle: plan.prettyDate + '  ·  ' + cfg.termLabel,
          imageUrl: s.unassigned > 0
            ? 'https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/event_busy/default/48px.svg'
            : 'https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/check_circle/default/48px.svg',
          imageType: 'CIRCLE',
        },
        sections: sections,
      },
    }],
  };
}

/* ───────── small card helpers ───────── */
function decorated_(emoji, text, topLabel, bottomLabel) {
  var w = { decoratedText: { text: emoji + '  ' + text, wrapText: true } };
  if (topLabel) w.decoratedText.topLabel = topLabel;
  if (bottomLabel) w.decoratedText.bottomLabel = bottomLabel;
  return w;
}
function countFor_(arr, key, val) {
  var n = 0; for (var i = 0; i < arr.length; i++) if (arr[i][key] === val) n++; return n;
}
function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ───────── Email channel (optional) ───────── */
function emailSubstitutes_(plan, cfg) {
  var sent = false;
  var subs = plan.summary.byTeacher;
  for (var name in subs) {
    var email = lookupEmail_(name);
    if (!email) continue;
    var rows = subs[name];
    var html = buildEmailHtml_(plan, name, rows, cfg);
    try {
      MailApp.sendEmail({
        to: email,
        subject: '📅 Substitution duty — ' + plan.prettyDate + ' (' + rows.length + ' period' + (rows.length === 1 ? '' : 's') + ')',
        htmlBody: html,
        name: cfg.schoolName + ' Substitutions',
      });
      sent = true;
    } catch (e) { Logger.log('Email to ' + name + ' failed: ' + e.message); }
  }
  return sent;
}

function buildEmailHtml_(plan, name, rows, cfg) {
  var items = rows.map(function (x) {
    var timing = cfg.periodTimings[x.period] ? ' &middot; ' + cfg.periodTimings[x.period] : '';
    return '<tr><td style="padding:8px 12px;border-bottom:1px solid #E4E7EB;font-weight:600;color:#4C5FD5">P' + x.period + timing + '</td>' +
           '<td style="padding:8px 12px;border-bottom:1px solid #E4E7EB">' + esc_(x.classSec) + '</td>' +
           '<td style="padding:8px 12px;border-bottom:1px solid #E4E7EB;color:#7B8794">' + esc_(x.subject) + '</td>' +
           '<td style="padding:8px 12px;border-bottom:1px solid #E4E7EB;color:#7B8794">covering ' + esc_(x.absent) + '</td></tr>';
  }).join('');
  return '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;color:#1F2933">' +
    '<div style="background:#4C5FD5;color:#fff;padding:20px 24px;border-radius:14px 14px 0 0">' +
    '<div style="font-size:13px;opacity:.85;letter-spacing:.4px">' + esc_(cfg.schoolName).toUpperCase() + ' &middot; ' + esc_(cfg.termLabel) + '</div>' +
    '<div style="font-size:22px;font-weight:700;margin-top:4px">Substitution duty</div>' +
    '<div style="font-size:14px;opacity:.9;margin-top:2px">' + plan.prettyDate + '</div></div>' +
    '<div style="border:1px solid #E4E7EB;border-top:none;border-radius:0 0 14px 14px;padding:20px 24px">' +
    '<p style="margin:0 0 14px">Hi ' + esc_(name.split(' ')[0]) + ', you are assigned the following substitution period(s):</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px">' + items + '</table>' +
    '<p style="margin:16px 0 0;color:#7B8794;font-size:12px">Auto-generated by the Substitution System. Please reach the class on time.</p>' +
    '</div></div>';
}

/* ───────── DM channel (optional, needs Chat API bot) ───────── */
/**
 * Send each substitute a 1:1 Google Chat message. Requires:
 *   1. A Google Cloud project with the Google Chat API enabled.
 *   2. A Chat app/bot configured; users must be reachable by the bot.
 *   3. Chat user IDs (users/NNN) in the importHR tab, OR the Chat advanced
 *      service enabled with the bot's credentials.
 * This is best-effort and disabled by default (Config: "Send Direct Messages" = FALSE).
 */
function dmSubstitutes_(plan, cfg) {
  var subs = plan.summary.byTeacher;
  for (var name in subs) {
    var chatUserId = lookupChatUserId_(name); // e.g. "users/123456789"
    if (!chatUserId) continue;
    try { sendChatDm_(chatUserId, buildDmText_(plan, name, subs[name], cfg)); }
    catch (e) { Logger.log('DM to ' + name + ' failed: ' + e.message); }
  }
}

/**
 * Send a 1:1 Google Chat message. `target` may be a Chat user id ("users/NNN"),
 * a bare numeric id, or a DM space name ("spaces/XXXX"). Returns the API response.
 * Requires the "Google Chat API" advanced service + the Chat API enabled on the
 * linked Cloud project (see 📖 Help / README).
 */
function sendChatDm_(target, text) {
  if (typeof Chat === 'undefined') {
    throw new Error('Add the "Google Chat API" advanced service (editor → Services ➕) and enable the Chat API in the linked Google Cloud project.');
  }
  target = norm_(target);
  var spaceName;
  if (target.indexOf('spaces/') === 0) {
    spaceName = target;
  } else {
    var userId = target.indexOf('users/') === 0 ? target : 'users/' + target;
    spaceName = Chat.Spaces.findDirectMessage({ name: userId }).name;
  }
  return Chat.Spaces.Messages.create({ text: text }, spaceName);
}

function buildDmText_(plan, name, rows, cfg) {
  var lines = rows.map(function (x) {
    var timing = cfg.periodTimings[x.period] ? ' (' + cfg.periodTimings[x.period] + ')' : '';
    return '• *P' + x.period + '*' + timing + ' — ' + x.classSec + ' · ' + x.subject + '  _(for ' + x.absent + ')_';
  }).join('\n');
  return '🔁 *Substitution duty — ' + plan.prettyDate + '*\nHi ' + name.split(' ')[0] +
         ', you are covering:\n' + lines;
}
