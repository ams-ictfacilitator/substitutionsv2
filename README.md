# Weekly Substitution System (v2)

Google Apps Script, container-bound to a standalone Google Sheet.
Script ID: `1kS8JBfnxfSLXVkRaocM-GgzPpINyTweCWArO9laXV-91ipXiKzpT5T_h`

Mark a teacher absent → the system finds every teaching period they lose, picks a
genuinely-free substitute for each one using a weighted fairness model, writes the
result to an audit log, and posts a card to a Google Chat space.

**It is a read-only satellite of the main Timetable Management System.** It opens the
main workbook with `SpreadsheetApp.openById()` and never writes to it. All of its own
state lives in its own workbook, in the `🗂️ Log` tab.

---

## 1. At a glance

| | |
|---|---|
| Runtime | Apps Script V8, container-bound |
| Timezone | `Asia/Kolkata` (pinned in `appsscript.json`) |
| Advanced services | Chat v1, People v1, Admin SDK directory_v1 — **all declared in `appsscript.json`** |
| OAuth scopes | sheets · external requests · container UI · user info · send mail · chat.spaces · chat.messages · drive · script.scriptapp · admin.directory.user.readonly |
| Source of truth | the `🗂️ Log` tab — nothing else persists assignment state |
| External reads | main Timetable workbook (Allotment / Timetable / Staff Duties tabs) |
| External writes | Google Chat webhook, optional email, optional Chat DM |
| Users | leave coordinators and office staff, from a Sheet |

---

## 2. File map

| File | Lines | Responsibility |
|---|---:|---|
| `Constants.js` | 127 | Tab names, colour palette, `DEF` fallback config, per-execution cache, tiny helpers |
| `Config.js` | 175 | Parse the `⚙️ Config` tab into a structured object; write values back |
| `DataSource.js` | 187 | Read Allotment / Timetable / Staff Duties from the main workbook; derived lookups |
| `Pool.js` | 140 | Build the weighted substitute rotation; usage tallies from the log |
| `Dates.js` | 72 | Date parsing, working-day mapping, ISO-week keys, formatting |
| `Assign.js` | 354 | **The engine.** `computePlan()` / `commitPlan()`, scoring, leave scopes |
| `Log.js` | 99 | Read/append/delete log rows; log schema |
| `AbsenceRegister.js` | 210 | 🗓️ Absence Register — one row per teacher-day, plus the vocabulary migration |
| `Rules.js` | 330 | ⚖️ Rules and 🏫 Blocks & Floors — reading, compiling and checking substitution rules |
| `AbsenceRegister.js` | 152 | 🗓️ Absence Register — one row per teacher-day of absence, with scope |
| `ReportData.js` | 360 | Weekly report analytics — aggregates a week into one model |
| `ReportRender.js` | 400 | Weekly report HTML — light, table-based, A4, print-ready |
| `Reports.js` | 340 | Report orchestration: Drive folder, PDF, Reports tab, Chat card, trigger |
| `AnalyticsData.js` | 381 | `buildAnalytics()` — one pass over the whole log → one analytics model (§14) |
| `AnalyticsRender.js` | 409 | Analytics HTML → filed PDF, reusing `ReportRender.js`'s chrome |
| `Analytics.js` | 130 | Analytics orchestration: preview, build → PDF → Drive → 📄 Reports |
| `AnalyticsTab.js` | 216 | Renders the live `🔎 Analytics` tab from the same model |
| `Chat.js` | 253 | Chat card, email, DM channels |
| `HR.js` | 56 | Teacher name → email / Chat ID from the `👥 importHR` tab |
| `HRDirectory.js` | 104 | Pull Chat IDs from People API (self) or Admin SDK (everyone) |
| `Dashboard.js` | 189 | Render the `🔁 Substitution Pool` and `📊 Fairness` tabs |
| `MarkAbsenceTab.js` | 239 | The in-sheet marking grid + its installable `onEdit` trigger |
| `Setup.js` | 294 | `setupAllTabs()` — idempotent build of every tab |
| `Code.js` | 215 | Menu, sidebar bridge (`ui*` functions), typed flow, diagnostics |
| `Sidebar.html` | 300 | The coordinator side panel (self-contained HTML/CSS/JS) |

---

## 3. Data flow

```
   MAIN TIMETABLE WORKBOOK  (read-only, openById)
   ├── 📋 Allotment      → who teaches what, + each teacher's Substitution WEIGHT
   ├── 📅 Timetable      → who is teaching in which period (busy map + slots to cover)
   └── 👩‍🏫 Staff Duties  → who is on duty in which period (busy map only)
                │
                ▼
   ┌────────────────────────────────────────────────────┐
   │  computePlan(date, absentTeachers, {periodFilter})  │   pure, no side effects
   │    1. resolve day index + ISO week key              │
   │    2. build busy[teacher|period] from timetable+duty │
   │    3. collect slots to cover (within leave window)  │
   │    4. read 🗂️ Log → term/week/day usage, orphans    │
   │    5. per slot: chooseSubstitute_() by fair-share   │
   └────────────────────────────────────────────────────┘
                │  plan  (preview stops here)
                ▼
   ┌────────────────────────────────────────────────────┐
   │  commitPlan(plan, markedBy)                         │
   │    1. removeForCommit_()  — delete rows superseded  │
   │    2. sendNotifications_() — Chat / email / DM      │
   │    3. appendToLog_()                                │
   │    4. refreshDashboards_()                          │
   └────────────────────────────────────────────────────┘
```

Three UIs feed the same two functions — there is exactly one engine:

| Entry point | File | Builds the period filter via |
|---|---|---|
| Side panel "Mark Absence" | `Sidebar.html` → `uiPreview` / `uiCommit` | `buildPeriodFilter_()` — **one scope applied to all selected teachers** |
| `📝 Mark Absence` tab | `MarkAbsenceTab.js` → `runLeaveTab_()` | per-row `resolveScopePeriods_()` — **a different scope per teacher** |
| `✍️ Quick mark` prompt | `Code.js` → `quickMark()` | always `'FULL'` |

---

## 4. External data contract

This is the fragile boundary. If the main workbook's layout changes, these break.

### 📋 Allotment (columns configurable in `⚙️ Config`)

Read from `Allotment Data Start Row` (default 4) to the last row. Column numbers are
1-based and every one is remappable.

| Default col | Config key | Meaning |
|---:|---|---|
| 1 | `Col: Total Periods` | read into the range width only |
| 2 | `Col: Class` | e.g. `VIII` |
| 3 | `Col: Section` | e.g. `B` |
| 4 | `Col: Subject` | subject, **or the literal `Substitution`** |
| 5 | `Col: Teacher` | teacher name — the join key for everything |
| 6 | `Col: Department` | used for subject-match preference |
| 7 | `Col: Team` | used for same-team preference |
| 8 | `Col: Periods Allotted` | **on a `Substitution` row this is the teacher's weight** |

A row is skipped if both Teacher and Subject are blank.

### 📅 Timetable (layout is HARDCODED, not configurable)

Read from `Timetable Data Start Row` (default 4). Zero-based indices into the row:

```
idx 0  (col A)  — ignored (serial no.)
idx 1  (col B)  — Class
idx 2  (col C)  — Section
idx 3+ (col D+) — repeating pairs, day-major then period:
                  subCol = 3 + (dayIndex * periods * 2) + ((period - 1) * 2)
                  [subCol] = Subject, [subCol + 1] = Teacher
```

For 5 days × 8 periods that is 3 + 80 = **83 columns**, A → CE.
Note the class/section positions are *not* driven by the `Col:` config keys — those
apply to the Allotment only.

### 👩‍🏫 Staff Duties (layout is HARDCODED, optional)

Read from `Staff Duties Data Start Row` (default 4). If the tab is missing, duties are
simply treated as empty — the run still succeeds.

```
idx 0  (col A)  — Teacher
idx 1+ (col B+) — one cell per day/period, day-major:
                  col = 1 + (dayIndex * periods) + (period - 1)
                  non-empty cell = that teacher is on duty (never substituted, but busy)
```

---

## 5. Tabs in this workbook

Built idempotently by `setupAllTabs()` in the order below.

| Tab | Built by | Purpose |
|---|---|---|
| `▶️ Console` | `writeConsoleTab_()` | Static landing page — 4-step instructions. No controls. |
| `⚙️ Config` | `writeConfigTab_()` | Every setting. Key in col A, value in col B, hint in col C. |
| `📝 Mark Absence` | `writeMarkLeaveTab_()` | In-sheet marking grid (see §7). |
| `🔁 Substitution Pool` | `renderPool_()` | The weighted rotation + live week/term usage. Regenerated on every commit. |
| `📊 Fairness` | `renderFairness_()` | KPI strip + per-teacher load vs fair share, with text bars. Regenerated on every commit. |
| `🗂️ Log` | `writeLogTab_()` | **Source of truth for cover.** Row 1 title, row 2 headers, data from row 3. |
| `🗓️ Absence Register` | `writeLeaveRegisterTab_()` | **Source of truth for leave.** One row per teacher-day, including absences that needed no cover. |
| `📄 Reports` | `writeReportsTab_()` | Index of generated weekly reports, newest first, each linking to its PDF. Also indexes the analytics PDF (§14). |
| `🔎 Analytics` | `renderAnalyticsTab_()` | Live analytics over the whole log (§14). Rebuilt on demand only, never on a trigger. |
| `👥 importHR` | `writeImportHrTab_()` | Name / Email / Chat ID. Row 1 title, row 2 headers, data from row 3. |
| `📖 Help` | `writeHelpTab_()` | Nine prose blocks for coordinators. |

`setupAllTabs()` is safe to re-run for `⚙️ Config`, `▶️ Console`, `📝 Mark Absence`,
`👥 importHR` and `📖 Help` **only in the sense that it rebuilds them from scratch —
it calls `sheet.clear()` first.** Re-running it wipes anything typed into Config and
any HR rows. The `🗂️ Log` tab is also cleared. See §12.

---

## 6. The assignment engine

### 6.1 Building the pool (`Pool.js`)

Every teacher who has a row in the Allotment whose Subject equals the
`Substitution Subject Label` (default `Substitution`) and whose `Periods Allotted > 0`
joins the pool. That number is their **weight** — nominally their weekly cap.

`interleaveByWeight_()` spreads members into a rotation using credit/stride scheduling:
each step every member earns `cap / total` credit, the member with the most credit who
still has occurrences left is emitted and pays 1 credit. This distributes each teacher
*evenly* rather than in blocks:

```
A cap=2, B cap=4   →   B, A, B, B, A, B
```

A member's `rank` is the index of their first appearance in that sequence. Rank is only
used as a **tie-break** — the actual pick is driven by fairness.

### 6.2 Availability

A candidate is skipped if any of these hold:

1. They are absent in this run, or already marked absent on this date (`excludeSet`).
2. `busy[name|period]` — they are teaching that period, or on a staff duty.
3. `assignedBusy[name|period]` — already pulled into another class *in this same run*.
4. `busy` also includes substitutions already committed for this date by earlier runs.
5. Weekly ceiling reached (see below).
6. `Max Substitutions Per Day` reached, if set > 0.

Slots to cover exclude any subject listed in `Non-Substitutable Subjects` — by default
`Substitution, SF, TC, ICT, Digital Duties, Other Duties, Coaching Morning,
Coaching Evening, Resource Room, Viceprincipal`. Staff duties are never covered at all.

### 6.3 Fairness scoring (`chooseSubstitute_`)

The core idea: **pick whoever is furthest below their proportional fair share.**

```
targetK  = (basisTotal + runCount + 1) / totalCap
deficit  = (m.cap * targetK) - used
```

- `basisTotal` — total subs already assigned on the chosen basis (term or week)
- `runCount` — subs assigned so far in this run
- `totalCap` — sum of all pool weights
- `used` — this teacher's subs on that basis, plus their count in this run

The teacher with the **largest deficit** wins; ties break on rotation `rank`.

Preferences add small uniform bonuses that only break near-ties — a preferred teacher
can be pulled at most ~1 sub past fair share:

| Preference | Bonus | Condition |
|---|---:|---|
| `Prefer Same Department` | +0.50 | candidate's dept matches the slot's subject dept |
| `Prefer Continuity` | +0.75 | candidate already covers the same class in period ±1 *this run* |
| `Prefer Same Team` | +0.25 | candidate's team matches the absent teacher's team |

### 6.4 Fairness basis — Term vs Week

| Basis | Behaviour |
|---|---|
| **`Term`** (default) | Balances on **cumulative** load ÷ weight. Never resets. No weekly ceiling unless `Max Substitutions Per Week > 0`. The whole pool cycles across the term, so nobody at the tail of the rotation is starved. A teacher may exceed their allotment in a heavy week. |
| `Week` | Balances within the current ISO week and **hard-caps each teacher at their allotment** for that week. Resets every Monday. |

ISO week keys look like `2026-W25` (`weekKey_()`). Note that `Week Starts On` in Config
is *not* consulted — weeks are always ISO (Monday-start).

### 6.5 Absence types

`ABSENCE_TYPES` in `Constants.js` is the **single source of truth**. It drives the
Mark Absence dropdown, the side panel's grouped select, the register's validation, the
substitution window, and every grouping in the weekly report. Add a type there and it
appears everywhere.

| Type | `id` | Category | Window |
|---|---|---|---|
| Leave - Full day | `LEAVE_FULL` | Leave | all periods |
| Leave - Morning | `LEAVE_AM` | Leave | 1 … `First Afternoon Period` − 1 |
| Leave - Afternoon | `LEAVE_PM` | Leave | `First Afternoon Period` … last |
| Permission | `PERMISSION` | Permission | **explicit list required** |
| OD - Full day | `OD_FULL` | OD | all periods |
| OD - Morning | `OD_AM` | OD | 1 … `First Afternoon Period` − 1 |
| OD - Afternoon | `OD_PM` | OD | `First Afternoon Period` … last |
| OD - Periods | `OD_PERIODS` | OD | **explicit list required** |

Two dimensions flattened into one list: **category** (what kind of absence, for
reporting) and **window** (which periods get substituted). The category changes nothing
about how a substitute is chosen — it is what lets the report separate personal absence
from school business.

`absenceType_(v)` resolves an id, a label, or a legacy value to a type object.
`absenceNeedsPeriods_(v)` is true for the two `PERIODS` types. Blank resolves to
`Leave - Full day`, matching what the system did before types existed. An unrecognised
non-empty value becomes `Unknown` — never guessed at.

Explicit period lists accept an array or a string: `7,8` · `3-4` · `P1` · `1, 3-5`.
Parsed by `parsePeriodsList_()`, deduped and sorted.

`scopeHas_(pf, teacher, period)` is the single check — no entry in `pf` means full day.

### 6.6 Substitution rules

Rule **types** are declared in `RULE_TYPES` (`Constants.js`); rule **instances** are rows
on the `⚖️ Rules` tab. Adding a rule is a row; adding a *kind* of rule is one registry
entry plus a branch in `buildRuleContext_()`.

| Type | Who / What | Then | Hard or soft |
|---|---|---|---|
| Dedicated substitute for a team | team name | teacher(s), best first | **first refusal**, then falls back |
| Limit a teacher to certain floors | teacher | floor name(s) | **hard — never overridden** |
| Prefer a substitute from the same block | `All` | strength (default 1.5) | soft, competes with fairness |
| Protect teachers with few free periods | `All`, a team, or a teacher | ladder, e.g. `1:0, 2:1` | **hard — never overridden** |

Every rule row also has `Enabled`, `Until` (auto-expiry), `Priority` and `Notes / Reason`.

**Compilation.** `buildRuleContext_()` turns the active rules into flat maps *once per
plan*:

```js
dedicatedByTeam: { 'PRE-PRIMARY': ['Jeevitha P'] }
floorsByTeacher: { 'ANITA MARY': { GROUND: true } }
blocks:          { 'VIII|B': {block:'A', floor:'Ground'} }
homeBlock:       { 'JEEVITHA P': 'A' }     // derived from the timetable
```

The assignment loop then does object lookups only. A malformed rule is recorded in
`ctx.problems` and skipped — one bad row can never stop substitutions being assigned.

**Two-pass selection** (`chooseSubstitute_`). When a rule names dedicated substitutes
for the slot's team, pass one considers only them. If none can take it, pass two runs
normal logic and the plan records *"No dedicated Pre-primary substitute free — normal
rotation"*. Floor limits are hard in **both** passes: a mobility restriction is a
physical constraint, not a preference.

**A period belongs to a team by its class**, read from the Allotment's Team column
(`getClassTeamLookup()`), not by who was teaching it. That is what lets a Pre-primary
teacher's non-Pre-primary periods fall through to normal logic.

**Why a substitute was chosen** rides on each assignment as `reason`, shown in the side
panel, as a cell note on the Mark Absence tab, and — for uncovered periods — as the
specific cause (`3 blocked by floor limits`, `no dedicated Pre-primary substitute free`).

**The free-period guard** caps how many substitutions a teacher can take on a day, keyed
to how many free periods she has that day — a ladder of `free periods : max
substitutions` in the `Then` column, e.g. `1:0, 2:1`. A count left off the ladder is
unconstrained, so `3:2` can be added later with no code change. "Free" is read from the
timetable and duty roster for the day, **not** from cover already assigned — using cover
already given out would shrink the count with every assignment and make the cap
self-defeating. Like floor limits, it is **hard in both passes**: a guard-capped
dedicated substitute is skipped and the dedicated rule falls back to normal rotation. It
composes with `Max Substitutions Per Day` in `⚙️ Config` — both are ceilings on the same
count, so the lower one wins. Full rationale and the compilation/engine details are in
`docs/rfc/RFC-001-free-period-guard.md`.

### 6.7 Performance

Measured on a 60-teacher, 40-class, 8-period estate with 1,530 log rows, 6 teachers
absent:

| | ms per plan |
|---|---:|
| no rules | 2.06 |
| free-period guard only | 2.68 |
| dedicated + floor + block affinity | 3.47 |
| all four rule types | 3.81 |
| **15 rules** | **3.78** |

Rule *count* is free — 15 rules cost no more than 4, because compilation is O(rules)
once and the loop is O(1) per effect. Almost all the overhead is two single passes over
the timetable: one deriving home blocks, one counting free periods. Both are lazy, so a
workbook pays for a pass only when a rule that needs it is active. Scaling with absentees
stays gentle: 30 absentees / 91 slots ≈ 6.3 ms. The real cost of a plan remains the sheet
reads, to which rules add two, both cached.

### 6.8 Cascading re-assignment

The interesting case: **a teacher who was already assigned as a substitute today now
goes on leave.** Her cover is orphaned and must be handed to someone else.

In the log scan, a row qualifies as orphaned when all of:

```js
sameDate && r.status === 'ASSIGNED'
  && absentSet[r.substitute]      // the substitute is going absent now
  && !absentSet[r.absent]         // but the original absentee is not part of this run
  && scopeHas_(pf, r.substitute, r.period)   // within her new leave window
```

Such rows are pushed back into `slots` flagged `reassigned: true` with `previousSub`
recorded, and are deliberately **not** tallied into usage (they are being removed).
They surface as `↻` in the panel, the tab and the Chat card.

### 6.9 Idempotency

`removeForCommit_()` runs before every write and deletes, for `plan.dateStr` only:

- **own cover** — every row whose *Absent Teacher* is in this run, any period
- **orphaned cover** — rows whose *Substitute* is now absent, within her leave window

So re-marking the same teacher on the same date replaces her earlier rows rather than
duplicating them. Deletions run bottom-up.

---

## 7. The `📝 Mark Absence` tab

Cell geometry is defined in the `ML` object at the top of `MarkAbsenceTab.js`:

| | Cell(s) | Contents |
|---|---|---|
| Date | `B4` | date validation, defaults to today |
| Action | `B5` | dropdown: `—` · `Preview plan` · `Assign & notify` |
| Status | `E4:I5` (merged) | live status message, colour-coded |
| Input grid | `A8:C27` (20 rows) | Teacher · Leave type · Periods |
| Results | `E8:I27` | Period · Class · Subject · Absent · Substitute |

Setting the Action cell fires `onEditInstallable`, which immediately resets the cell to
`—` (so the same action can be picked again; the reset edit re-fires the trigger but
matches neither branch and stops) and calls `runLeaveTab_('preview' | 'commit')`.

The trigger is installed idempotently by `ensureAbsenceTrigger_()`, called from
`setupAllTabs()`, `openMarkLeaveTab()` and the `⚡ Enable tick-to-run` menu item. If
installation fails, the menu path (`📝 Mark-Leave tab → Preview / Assign & notify`)
still works.

Teacher dropdowns are refreshed from the live allotment by
`refreshLeaveTabTeacherList_()`, with `setAllowInvalid(true)` so a name that has drifted
from the allotment can still be typed.

---

## 8. `⚙️ Config` reference

Parsed by `getConfig()` — key in column A, value in column B, comment in column C.
Cached per execution via `memo()`. Booleans accept `TRUE`/`YES`/`1`/`✓`/`ON`.

### General
| Key | Default | Notes |
|---|---|---|
| `School Name` | `Methodist School` | on cards & emails |
| `Academic Year` | `2026-27` | *parsed, never used* |
| `Term Label` | `Term 1` | on cards & emails |
| `This Sheet Link` | — | adds an "Open Substitution Sheet" button to the Chat card |

### Source data
| Key | Default | Notes |
|---|---|---|
| `Source Spreadsheet URL` | — | **must be set.** Full URL or bare ID |
| `Allotment Tab Name` | `📋 Allotment` | |
| `Timetable Tab Name` | `📅 Timetable` | |
| `Staff Duties Tab Name` | `👩‍🏫 Staff Duties` | optional tab |
| `Allotment Data Start Row` | 4 | |
| `Timetable Data Start Row` | 4 | |
| `Staff Duties Data Start Row` | 4 | |

### Schedule
| Key | Default | Notes |
|---|---|---|
| `Days` | `Monday…Friday` | comma-separated; index order defines `dayIndex` |
| `Periods Per Day` | 8 | |
| `Break After Periods` | `2, 4, 6` | *parsed, never used* |
| `First Afternoon Period` | 5 | the AM/PM half-day split |
| `Period N Timing` | — | matched by regex `^Period\s+(\d+)\s+Timing$`; shown on cards/emails/DMs |

### Allotment column mapping
`Col: Total Periods` · `Col: Class` · `Col: Section` · `Col: Subject` · `Col: Teacher` ·
`Col: Department` · `Col: Team` · `Col: Periods Allotted` · `Substitution Subject Label`

### Substitution rules
| Key | Default | Notes |
|---|---|---|
| `Fairness Basis` | `Term` | `Term` or `Week` (dropdown) |
| `Non-Substitutable Subjects` | see §6.2 | comma-separated, matched case-insensitively |
| `Prefer Same Department` | TRUE | +0.5 |
| `Prefer Same Team` | TRUE | +0.25 |
| `Prefer Continuity` | TRUE | +0.75 |
| `Max Substitutions Per Day` | 0 | 0 = no ceiling |
| `Max Substitutions Per Week` | 0 | 0 = no extra ceiling |
| `Week Starts On` | `Monday` | *parsed, never used* — weeks are always ISO |

### Notifications
| Key | Default | Notes |
|---|---|---|
| `Google Chat Webhook URL` | pre-filled | posts the plan card to the space |
| `Send Chat Card` | TRUE | |
| `Send Email To Substitutes` | FALSE | needs emails in `👥 importHR` |
| `Send Direct Messages` | FALSE | needs the Chat API + a bot |
| `Test Chat User ID` | — | `users/NNN`, written by `showMyChatId()` |

### Weekly report
| Key | Default | Notes |
|---|---|---|
| `Auto Generate Weekly Report` | TRUE | installs the time trigger |
| `Auto Report Day` | `Monday` | dropdown |
| `Auto Report Hour` | 7 | 0–23, school timezone |
| `Post Report To Chat` | TRUE | summary card + link to the PDF |
| `Report File Prefix` | `Substitution Report` | file name before the sequence number |
| `Reports Folder ID` | — | written automatically on the first report; leave blank |

### HR lookup
`HR Source URL` (*parsed, never used*) · `HR Col: Name` (1) · `HR Col: Email` (2) ·
`HR Col: Chat User ID` (3)

### Team coordinators
A special block. The literal key `TEAM COORDINATORS` switches the parser into
section mode; subsequent rows are read as `{team, name, email}` from columns A/B/C
until a fully blank row. Parsed into `cfg.coordinators` — **currently never consumed.**

> ⚠️ Because section mode only exits on a fully blank row and this block is written
> last, **any new `Key: Value` row added below `TEAM COORDINATORS` will be silently
> swallowed as a coordinator entry.** Add new keys above it.

---

## 9. `🗂️ Log` schema

Row 1 = title band, row 2 = headers, data from row 3 (`LOG_DATA_START = 3`).

| # | Header | Written from |
|---:|---|---|
| 1 | Timestamp | `new Date()` at append time |
| 2 | Date | `yyyy-MM-dd` |
| 3 | Day | working-day name |
| 4 | Week | ISO key, e.g. `2026-W25` |
| 5 | Period | integer |
| 6 | Class | `classSec`, e.g. `VIII-B` (split back by `parseClassPart_`/`parseSectionPart_`) |
| 7 | Subject | |
| 8 | Absent Teacher | |
| 9 | Substitute | name, or `—` when unassigned |
| 10 | Department | slot dept |
| 11 | Status | `ASSIGNED` / `UNASSIGNED` |
| 12 | Notified | `✓` / `—` |
| 13 | Run ID | `R` + base-36 epoch ms, uppercased |
| 14 | Marked By | active user email |

Only `ASSIGNED` rows count toward usage tallies. `readLogRows_()` skips a row when both
Date and Substitute are blank, and normalises the Date cell whether it holds a Date or
a string.

---

## 10. Notifications (`Chat.js`)

`sendNotifications_()` returns `true` if the *primary* channel (Chat card or email)
succeeded; DM failures are logged and swallowed. Any throw is caught in `commitPlan()`
and surfaced as `plan.notifyError` — **the log is written either way**, so a failed
notification never loses the assignment.

### Chat card (`cardsV2`, default on)
Sections, in order:
1. `ABSENT` — one row per absent teacher with a period count
2. `SUBSTITUTION PLAN` (single absentee) or `COVER · <NAME>` per absentee
3. `RE-ASSIGNED COVER` — only when orphaned periods were reassigned
4. `WHO COVERS WHAT` — per-substitute summary
5. Footer — counts, week key, pool size, optional sheet button

Header icon swaps between a green check and a red busy icon depending on whether
anything is unassigned. Plain-text `text` fallback is always set.

### Email (opt-in)
`MailApp.sendEmail` per substitute, HTML table of their periods, `from` name set to
`<School> Substitutions`. Requires an email in `👥 importHR`. Silently skips anyone
without one.

### Chat DM (opt-in, advanced)
`sendChatDm_(target, text)` accepts `users/NNN`, a bare numeric ID, or `spaces/XXXX`.
For a user ID it resolves the DM space via `Chat.Spaces.findDirectMessage()`.

Requirements: the **Google Chat API** advanced service added in the editor, the Chat API
enabled on a linked Cloud project, a configured Chat app, and the `chat.spaces` /
`chat.messages` scopes approved. Messages send **as the account running the script** —
you cannot DM yourself this way.

---

## 11. HR / Chat ID lookup

`getHrMap()` builds `{ normalisedKey: {email, chatId} }` from `👥 importHR` (data from
row 3). Keys are lowercased with runs of whitespace collapsed.

`hrLookup_()` tries an exact key, then falls back to a **prefix match in either
direction** (`k.startsWith(key) || key.startsWith(k)`). See §15 — this is loose enough
to mis-route.

Two ways to populate the tab (`HRDirectory.js`):

| Function | Menu item | Needs |
|---|---|---|
| `showMyChatId()` | `🆔 Show my Chat ID` | People API advanced service. Any user. Offers to save to Config. |
| `populateHrFromDirectory()` | `👥 Import HR from Directory` | Admin SDK service + directory rights. Probes several access strategies, then pages 500 at a time (max 40 pages), skipping suspended users. **Overwrites all data rows.** |
| `diagnoseDirectory()` | `🩺 Diagnose directory access` | Shows what each strategy returned. Use when the import fails. |

**Directory access strategies**, tried in order until one probes clean:

| # | Request | Needs |
|---|---|---|
| 1 | `customer: my_customer` + `orderBy` + `viewType: admin_view` | full Workspace admin |
| 2 | `customer: my_customer` | admin, tolerates domains that reject `orderBy`/`admin_view` |
| 3 | `domain: <the user's domain>` | admin rights scoped to the domain |
| 4 | `domain: …` + `viewType: domain_public` | no admin rights; public fields only |

`directoryParams_()` **never sends `pageToken: null`** — passing an explicit null on the
first request is what produced the opaque `API call to directory.users.list failed with
error: Unknown Error`. Only include the token once there is one.

A Chat user ID is simply `users/` + the Workspace Directory ID.

---

## 12. Setup & first run

1. `clasp push` (or paste the files into the bound script).
2. Reload the Sheet → `🔁 Substitutions` menu appears (`onOpen`).
   **Re-authorisation is required** the first time after this change: `drive` (create the
   reports folder and PDFs) and `script.scriptapp` (install triggers) are new scopes.
   `script.scriptapp` was missing before, which is why `ensureAbsenceTrigger_()` had a
   silent-failure fallback — tick-to-run on the Mark Absence tab should now install cleanly.
3. `🛠️ Build / rebuild all tabs` → `setupAllTabs()`.
4. Open `⚙️ Config`, paste the main Timetable workbook URL into
   **Source Spreadsheet URL** (highlighted amber).
5. `🩺 Check source connection` → confirms teacher count, pool size, total weekly capacity.
6. Mark an absence from the panel, the tab, or the typed prompt.

> **`setupAllTabs()` is destructive on re-run.** Every `write*Tab_()` function begins
> with `sheet.clear()`. Rebuilding wipes the Config values you typed, the HR rows, and
> the entire Log. Export the Log first if you ever need to re-run it on a live sheet.

### Menu map (`onOpen`)

```
🔁 Substitutions
├── ▶️  Mark Absence (panel)          openConsole
├── 📝  Mark Absence (tab)              openMarkLeaveTab
├── ✍️  Quick mark (typed)            quickMark
├── 📝  Mark-Leave tab ▸
│   ├── 👁  Preview                   leaveTabPreview
│   ├── ✅  Assign & notify           leaveTabAssign
│   ├── ⚡  Enable tick-to-run        enableTabMarking
│   └── 🔄  Refresh teacher list      refreshLeaveTeachers
├── 📄  Weekly report ▸
│   ├── 👁  Preview last week          previewWeeklyReport
│   ├── 👁  Preview this week (so far) previewThisWeekReport
│   ├── 📄  Generate for last week     generateLastWeekReport
│   ├── 📄  Generate for this week     generateThisWeekReport
│   ├── 🗓️  Generate for a chosen week generateReportForWeekPrompt
│   ├── 📂  Open Reports folder        openReportsFolder
│   └── ⏰  Enable / refresh auto       enableWeeklyReportTrigger
├── ⚖️  Rules ▸
│   ├── ⚖️  Open the Rules tab        openRulesTab
│   ├── 🏫  Open Blocks & Floors      openBlocksTab
│   ├── 🧪  Check rules               checkRules
│   └── 🏫  Fill in the class list    seedBlocks
├── 🔁  Refresh Pool & Fairness       refreshPoolAndFairness
├── ↩️  Clear a date's assignments    clearDatePrompt
├── 🆔  Show my Chat ID               showMyChatId
├── 👥  Import HR from Directory      populateHrFromDirectory
├── 🧪  Test Chat webhook             testChatWebhook
├── 💬  Test Chat DM (to my ID)       testChatDm
├── 🩺  Check source connection       checkSourceConnection
├── 🔌  Check services & permissions  checkServices
├── 🩺  Diagnose directory access     diagnoseDirectory
├── 💾  Back up this workbook now     backupWorkbookNow
├── 🔧  Upgrade tabs (safe)           upgradeTabs
├── 🔄  Refresh labels & dropdowns    refreshLabels
├── 🛠️  Rebuild all tabs (ERASES)     setupAllTabs
└── 📖  Help                          openHelp
```

### Sidebar server API (`google.script.run`)

| Function | Signature | Returns |
|---|---|---|
| `uiBootstrap()` | — | teachers, today, school/term, `sourceErr`, periods, firstAfternoon, channel flags |
| `uiPreview()` | `(dateStr, absentTeachers, scope, periods)` | a plan object |
| `uiCommit()` | `(dateStr, absentTeachers, scope, periods)` | `{ok, runId, notified, assigned, unassigned, reassigned, plan}` |
| `uiClearDate()` | `(dateStr)` | `{ok, removed}` |

All four catch their own exceptions and return an error shape rather than throwing.

---

## 13. The weekly Principal report

A one-click (and once-a-week automatic) PDF for school leadership: a bird's-eye page,
full detail behind it, and a signature block at the foot.

### 13.1 The pipeline

```
buildWeeklyReportData(weekKey)      ReportData.js   pure — reads Log + Absence Register (+ pool)
        │  model
renderReportHtml_(model, info)      ReportRender.js pure — light, table-based, A4 HTML
        │  html
Utilities.newBlob(...).getAs('application/pdf')
        │  blob
folder.createFile(blob)             Reports.js      the "… REPORTS]" Drive folder
        │
recordReport_()                     Reports.js      row in 📄 Reports, newest first
        │
postChatCard_()                     Chat.js         summary card + button to the PDF
```

### 13.2 Where the PDF goes

The reports folder is a **sibling** of the folder this workbook lives in: the parent
folder's name has its closing bracket reopened.

```
Substitutions [2026-27]   →   Substitutions [2026-27 REPORTS]
```

A name without a trailing `]` simply gets ` REPORTS` appended. The folder is found or
created once, and its id is written back to `Reports Folder ID` in `⚙️ Config`, so a
later rename of either folder cannot strand the reports.

File names are sequential and dated:

```
Substitution Report 007 — 15 Jun-19 Jun 2026 (2026-W25).pdf
```

The sequence lives in the `📄 Reports` tab. **Regenerating a week keeps its number**,
trashes the old PDF and updates the existing row rather than adding a second one.

### 13.3 What the report contains

**Page 1 — the bird's-eye view**

| Block | Content |
|---|---|
| KPI strip | teacher-days absent · periods lost · covered · uncovered · coverage % · load balance % |
| Category split | Leave / Permission / OD side by side — teacher-days, periods lost, coverage %. Total disruption first, then how much of it was avoidable. |
| Call-outs | most disrupted class · most periods lost · who carried the most cover |
| Week at a glance | day × period grid, light indigo ramp by pressure; rose cells hold an uncovered period, marked `✕n` |
| How this week compares | stacked bar per week, term to date, current week highlighted, with the running average |

**Pages 2–4 — the detail**

- **Who was absent** — per teacher: department, team, days out, leave-type mix, periods lost, covered, uncovered, and *churn* (periods this teacher had been due to cover for someone else, which her own leave forced onto a third teacher)
- **Absence type mix** and **periods lost by team**
- **Who carried the cover** — per substitute: weight, load bar, subs, fair share, signed variance chip, term total; plus a **load balance** verdict and who sat furthest above and below share
- **In the pool but not called** — idle substitutes with their term totals
- **Uncovered periods** — the action list: day, period, class, subject, teacher away
- **Most disrupted classes** and **teaching time lost by subject**
- **Pressure through the day** — which periods repeatedly needed cover
- **Cover quality and audit trail** — subject-matched cover %, blocks held together %, notification delivery %, marking runs and who made them
- **Remarks box**, then **Prepared by** and **Principal — signature & date**

### 13.4 The balance score

```
fair share(teacher) = weight × total cover this week ÷ total pool weight
balance = 100 × (1 − Σ|actual − fair| ÷ (2 × total cover))
```

That inner term is the total variation distance between the actual distribution of
cover and a perfectly proportional one. 100 % means every substitute took exactly their
weighted share; lower means the week's cover was concentrated on fewer people. It is
reported alongside a plain-English verdict so leadership never has to read the formula.

### 13.5 Graceful degradation

| Situation | Behaviour |
|---|---|
| No absences that week | A single calm panel: nothing was lost to leave. Signature block still renders. |
| Source workbook unreachable | Amber notice; every section except weights and departments still renders. |
| Week predates the Absence Register | Absences are rebuilt from the log (`synthesiseAbsences_`) with an indigo notice; leave type and zero-cover absences are unavailable. |
| Chat post fails | The PDF is still saved and recorded; the failure is logged and toasted, never thrown. |

### 13.6 Rendering constraints

Apps Script's HTML→PDF converter has **no flexbox, no grid and no web fonts**. So:

- every layout is a `<table>`; every bar is a table cell with a percentage width
- fonts are Georgia (headings) and Arial (data) — both always available
- `@page { size: A4 portrait }` with `page-break-before` on `.brk` and
  `page-break-inside: avoid` on each block
- the same HTML powers the on-screen preview, where `.noprint` reveals a Print button

### 13.7 The Monday trigger

`ensureReportTrigger_()` deletes any existing `runWeeklyReportTrigger` trigger and
recreates it from `Auto Report Day` / `Auto Report Hour`, so editing Config and running
`⏰ Enable / refresh auto-report` is always safe. The handler reports on
`lastCompleteWeekKey_()` — the ISO week that finished before today — and routes any
failure to `notifyOpsFailure_()`, which posts to the Chat space.

---

## 14. Substitution analytics

### 14.1 Why this exists

Two complaints reached leadership and neither could be answered with evidence:

1. "Some teachers never get substitutions."
2. "Some teachers get the same class, in the same period, on the same weekday, over and
   over."

The weekly report (§13) answers *what happened this week*. Neither complaint is a weekly
question — both are about the shape of the whole history, and the `🗂️ Log` has always
recorded everything needed to settle them, it just had never been asked. PRD §10 and
RFC-002 record the decision behind this feature: **measure first**, so any fix is chosen
against evidence rather than intuition. See RFC-002 for the full metric definitions —
this section explains what the two outputs are and how to read them, not the formulas.

### 14.2 One engine, two presentations

```
AnalyticsData.js   buildAnalytics()      pure — one pass over the whole 🗂️ Log → one model
      ├── AnalyticsRender.js             model → printable HTML → PDF → Drive → 📄 Reports
      └── AnalyticsTab.js                model → the live 🔎 Analytics tab
```

`Analytics.js` is the thin orchestration layer over the pair — preview on screen, or
build → render → file, mirroring `Reports.js`'s weekly pipeline (§13.1) but over all
history and keyed by a pseudo week (`ANALYTICS`) so regenerating replaces the same row and
file rather than piling up duplicates.

Neither presentation computes anything of its own. Every figure — equity, variety,
cross-tabs, class-side view, gaps — is built once in `buildAnalytics()` and both the PDF
and the tab only display it. This is deliberate, not incidental: since both read the same
model, the PDF that gets filed and the tab a coordinator is looking at **cannot disagree**.
If a figure looks wrong, the bug is in `AnalyticsData.js`, never in one presentation only.

### 14.3 The three populations

The single most important thing to get right when reading this report is that "how much
cover has this person done" is not one question — it is three, and answering the wrong
one sends the fix to the wrong place (PRD §10.3, RFC-002 §3):

| Population | Meaning | Where the fix lies |
|---|---|---|
| In the pool, never called | has a `Substitution` allotment row, zero duties recorded | the engine, or their availability |
| In the pool, far below share | has duties, but well under their weighted fair share | the engine |
| Not in the pool at all | **no** `Substitution` allotment row, weight 0 | the Allotment, not the engine |

The third row is the one to hold onto. A teacher with no `Substitution` row in the
Allotment has a weight of 0, and weight 0 means **zero duties by design** — the pool
(`Pool.js`, §6.1) never draws from anyone it doesn't know has a weight. That teacher is
not being skipped by a bug, and no code change makes it fairer. If someone in this group
is the one who complained "I never get substitutions", the remedy is a row in the
Allotment giving them a `Substitution` weight, not a change to `Assign.js`. Both the PDF
and the `🔎 Analytics` tab report this cohort separately and label it accordingly
precisely so it is never mistaken for an engine problem.

### 14.4 Reading the variety score and the Gini coefficient

Two scores appear throughout the report and neither means anything without a scale to
read it against.

**Variety score** (0–1, per teacher) answers the second complaint directly: how spread
out a teacher's duties are across classes, periods and weekdays, normalised against what
was actually available school-wide (RFC-002 §4.1) — so someone with only three duties can
still score 1.0 if those three landed in three different classes.

| Value | Reading |
|---|---:|
| 1.0 | duties spread as widely as what was actually available |
| toward 0 | duties concentrated in the same slot — the "again and again" complaint |
| `—` | not 0 — see below |

A teacher called only once has no variety to measure: one duty cannot be "spread out" or
"concentrated". The model returns `null` for that case (RFC-002 §4.1) and both
presentations render it as an em dash, `—`, never as `0`. Showing 0 would read as "this
teacher's cover is entirely repetitive", which is not something a single data point can
support and would defame someone who was simply called once.

**Gini coefficient** (0–1, one number for the whole pool) answers the first complaint at
the population level: how evenly load is spread across the pool relative to each
teacher's allotment weight.

| Band | Value | Reading |
|---|---:|---|
| Even | ≤ 0.20 | everyone is carrying close to their weighted share |
| Moderate | ≤ 0.40 | some concentration, worth a look |
| Uneven | > 0.40 | load is concentrated on a few people |

0 means every teacher carries exactly their weighted share; 1 would mean one teacher
carries everything. Both the PDF and the tab report the number to two decimals alongside
its band, so nobody has to memorise the thresholds to read a headline figure.

### 14.5 Repetition is a known, unfixed structural property

The fairness engine (§6.3) scores duties by **how many** a teacher has, never **which**
ones. A teacher who is the only one free in a recurring slot — same class, same period,
same weekday — will keep being chosen for it, because from the engine's point of view she
is simply below her share; there is no memory of "you already did this slot". PRD §10.2
records this as the probable structural cause of the second complaint.

**This has been measured, not changed.** T-005–T-008 are diagnostic only, by decision —
the analytics report exists to show whether repetition is concentrated on a few people or
endemic across the pool, so that if the assignment engine is changed later, it is changed
against evidence. Nothing in `Assign.js` was touched to build this feature, and reading
this section should not leave the impression that the repetition complaint has been
resolved — it has been measured and left exactly as it was.

### 14.6 Where to find it

| Output | Menu / location | Cadence |
|---|---|---|
| Filed PDF | `🔁 Substitutions` menu → generate, saved to the same Drive reports folder as the weekly report (§13.2), indexed in `📄 Reports` | on demand |
| `🔎 Analytics` tab | rebuilt from the menu | on demand only — never on a trigger |

Full metric definitions, formulas and the cross-tabulations both outputs share live in
[`docs/rfc/RFC-002-substitution-analytics.md`](docs/rfc/RFC-002-substitution-analytics.md);
this section is deliberately a plain-language companion to it, not a restatement.

---

## 15. Known issues, gotchas & tech debt

Ordered roughly by how likely they are to bite.

### 15.1 ~~The Log tab is capped at ~198 data rows~~ — FIXED
`writeLogTab_()` used to end with `trimColumns_()`, which also trimmed the sheet to 200
rows; `appendToLog_()` writes at `getLastRow() + 1`, so once that passed 200 the range
went out of bounds and the commit threw — *after* notifications had already gone out.

Now: growing tabs (`🗂️ Log`, `🗓️ Absence Register`, `📄 Reports`, `👥 importHR`) use
`trimColumnsOnly_()`, which never touches rows, and every append calls `ensureRows_()`
to grow the grid first. `trimColumns_()` is retained for fixed-size layout tabs only.
**An existing sheet still carries the old 200-row cap** until `🛠️ Build / rebuild all
tabs` is run — but `ensureRows_()` now grows it on the next write regardless.

### 15.2 No `LockService` anywhere
Two coordinators committing at the same moment can interleave: both read the same log
snapshot, both compute against stale usage, both delete-and-append. Result: double
bookings or lost rows. `commitPlan()` is the natural place for a script lock.

### 15.3 `hrLookup_()` prefix matching can mis-route email and DMs
The fallback matches in both directions, so a short directory name is a prefix of many
allotment names (and vice versa). `"Anita"` will match whichever of `"Anita Mary"` /
`"Anita Sharma"` the object happens to iterate first. Since this decides who receives
a duty email or DM, it should be tightened to exact + explicit alias mapping.

### 15.4 Row-at-a-time Sheets I/O — partly addressed
`removeForCommit_()` and `clearLogForDate_()` now use `deleteRowsBatched_()`, which
collapses consecutive rows into single `deleteRows()` calls, and the Absence Register
styles a whole run with one `setBackgrounds`/`setFontColors` pair. Still per-row:
- `styleLogRows_()` makes ~3 range calls per appended row
- `zebra_()` in `Dashboard.js` styles one row at a time
- `populateHrFromDirectory()` styles each imported row individually

### 15.5 `refreshDashboards_()` fully re-renders two tabs on every commit
Each call does `sheet.clear()` plus a full rebuild of `🔁 Substitution Pool` and
`📊 Fairness`, and re-reads the whole log. Fine at today's scale, wasteful as the log
grows.

### 15.6 Config keys parsed but never consumed
`academicYear`, `breaksAfter`, `weekStartsOn`, `hrUrl`, `coordinators`. Either wire
them up or drop the rows so the Config tab stops promising behaviour that does not
exist. `Week Starts On` is the misleading one — weeks are hardcoded ISO/Monday.

### 15.7 Adding a Config key below `TEAM COORDINATORS` silently breaks it
See §8. The coordinator section only ends on a fully blank row.

### 15.8 Timetable and Duties layouts are hardcoded
The `Col:` config keys cover the Allotment only. Class/Section at indices 1 and 2 and
the day-major period stride are baked into `DataSource.js`. A layout change in the
main system means a code change here.

### 15.9 `setupAllTabs()` destroys entered data — GUARDED
Still destructive by design: every `write*Tab_()` opens with `sheet.clear()`. What
changed is that it can no longer happen by accident.

- **`upgradeTabs()` is the safe path** and is now the one to use on a live workbook.
  It creates only missing tabs, inserts only missing Config keys (above the
  `TEAM COORDINATORS` block), lifts the old row ceiling, and re-installs triggers.
  It never calls `sheet.clear()`.
- `setupAllTabs()` now calls `describeDataAtRisk_()` and refuses to run without an
  explicit YES against a list naming the exact rows and settings at stake, then takes
  a full `backupWorkbook_()` copy first. If the backup fails it asks again.
- `backupWorkbookNow()` is on the menu, and drops a dated copy into a `Backups`
  subfolder of the reports folder.

The underlying `write*Tab_()` functions are still clear-and-rebuild; a genuine
read-preserve-rewrite for the Config tab remains worth doing.

### 15.10 No Ops Alerts escalation — partly addressed
`notifyOpsFailure_()` posts to the Chat space, but only the weekly-report trigger calls
it. Still silent: `refreshDashboards_`, `dmSubstitutes_`, `emailSubstitutes_`,
`ensureLeaveTrigger_` — all still `Logger.log()` and swallow. A broken DM channel
remains invisible. Wiring the existing helper into those paths is the obvious next step.

### 15.11 Retry / backoff missing on external calls
`postChatCard_()` fetches once and throws on non-2xx. No backoff, no deterministic
fallback.

### 15.12 Advanced services are easy to lose
`enabledAdvancedServices` in `appsscript.json` is authoritative and `clasp push`
replaces the file wholesale. Anything added through the editor's Services panel
survives only until the next push. The three services this project needs
(`Chat`, `People`, `AdminDirectory`) are now declared locally; any future one must be
added there too, not in the editor.

### 15.13 Minor
- `dayUsageByTeacher()` and `titleCase_()` are dead code.
- The Chat card's `ABSENT` count uses `countFor_(assignments, 'absent', who)`, which
  also counts re-assigned rows belonging to a *different* original absentee — the
  "periods to cover" figure can read high.
- `getSubjectDeptLookup()` calls `getConfig()` inside its loop.
- Card header icons are hotlinked from `fonts.gstatic.com`.
- The `▶️ Console` tab is purely decorative — it has no controls despite being the
  landing tab and being named "Console".
- The side panel has no entry point to the weekly report; it lives on the menu only.
- `readReportRows_()` re-reads the `📄 Reports` tab on each call and is not memoised
  (it is called two or three times per generation).

---

## 16. Migrating an in-service workbook

### 16.0 Two menu items, two jobs

| Item | Does | Touches |
|---|---|---|
| `🔧 Upgrade tabs (safe)` | creates missing tabs, adds missing Config keys, lifts row ceilings, reinstalls triggers — **and calls the refresh below** | creates only |
| `🔄 Refresh labels & dropdowns` | brings an existing workbook's wording, headers and dropdowns up to the current version | chrome only |

`upgradeTabs()` only ever **builds tabs that are missing**. A workbook already in
service keeps whatever its original builder wrote — stale headers, an old dropdown,
out-of-date help text — because those tabs already exist. `refreshLabels()` closes that
gap, and is safe to run on its own at any time.

| Tab | What refreshLabels does |
|---|---|
| `▶️ Console`, `📖 Help` | **rebuilt** — instructions only, hold no data |
| `📝 Mark Absence` | **chrome refreshed** — title, banner, headers, notes, the type dropdown, column widths. Typed rows are kept, and legacy values in the type column are converted in place. |
| `🗓️ Absence Register` | **chrome refreshed** — title band, `Absence Type` header, dropdown validation; the type column's values are converted. Every other column is untouched. |
| `🔁 Pool`, `📊 Fairness` | re-rendered from the log, as they are after any commit |
| `⚙️ Config`, `🗂️ Log`, `👥 importHR`, `📄 Reports` | **never touched.** Their layout carries no absence vocabulary, so nothing is due. |



`upgradeTabs()` runs `migrateAbsenceVocabulary_()` **before** it creates any missing
tab, and takes a backup copy first. Order matters: the migration *renames* the old tabs
in place. If the create-missing-tabs loop ran first it would build an empty
`🗓️ Absence Register` beside the populated `🗓️ Leave Register`, and every historical
row would be stranded on an orphaned sheet, invisible to every report.

| Step | Action |
|---|---|
| 1 | `📝 Mark Leave` → `📝 Mark Absence` (`setName`, so the sheet and its data survive) |
| 2 | `🗓️ Leave Register` → `🗓️ Absence Register` |
| 3 | Header `Leave Scope` → `Absence Type`, and the column gets the eight-value dropdown |
| 4 | `Full day` → `Leave - Full day`, `Morning` → `Leave - Morning`, `Afternoon` → `Leave - Afternoon`. `Permission` and `Unknown` are left alone. |

OD did not exist when those rows were written, so converting them to `Leave - …` is
safe. Nothing else in the row is touched. The migration is idempotent, and **refuses to
rename when a sheet with the target name already exists** rather than risk clobbering it.

Trigger handler names — `onEditInstallable` and `runWeeklyReportTrigger` — are
deliberately **unchanged**. Installed triggers bind by function name; renaming either
would leave a live trigger pointing at a function that no longer exists, throwing on
every edit.

---

## 17. Local development

```bash
clasp status          # list tracked files
clasp pull            # overwrite local from the script project
clasp push            # overwrite the script project from local
```

`.clasp.json` pins the script ID and `rootDir: ""` — sources sit flat in this folder.
`.js` files map to `.gs` in the editor; `Sidebar.html` stays HTML.

Not a git repository yet. Worth `git init`-ing before substantial changes, since
`clasp push` overwrites the remote with no undo.

**Folder permissions** are `drwxrwsr-x` (owner `anitamethodist`, group `staff`, setgid)
to match the sibling projects under `AnitaMethodist/`, with an inherited `christwood`
ACL from the parent.
