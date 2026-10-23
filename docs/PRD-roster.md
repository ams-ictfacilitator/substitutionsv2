# PRD — Staff Roster, Staff Code and Staff Email Join Keys

**Status:** Final design (rev 5). No open questions. · **Owner:** ICT Facilitator · **Revised:** 2026-10-23
**Repo:** `ams-ictfacilitator/substitutionsv2` (PUBLIC) · **Runtime:** Google Apps Script (V8), container-bound to the
`[TIMETABLE 26-27] Substitutions` workbook

**Scope of this document:** design only. No code, and no live-data change until the user approves each preview.

> **Public-repo rule.** Every name, code and address in this document is a placeholder.
> "Edith Christopher" / `edith.christopher@school.example` / `AMS-0000` stand in for any real person.

**Rev 2 changes (user decisions of 2026-10-23):**
- Staff Code becomes the primary join key.
- Category replaces Role.
- Active is human-only, with sync proposing changes.
- `Left On` column added.
- Tab names frozen, and One Way matches them by substring.
- Marked By is left blank and flagged amber when the editor is unknown.
- The backfill covers every row.
- Email is optional for some non-teaching categories.

**Rev 3 changes:**
- Staff Codes are not in `👥 importHR`. The school's separate HR Database workbook (tab `CurrentStaff`) holds them.
- That workbook becomes a **third read-only source** for Staff Code, Category and (for non-teaching staff) Department, Team/Role and official email.
- Reads from it are strictly data-minimised (D9).
- Staff Codes and Categories from it are linked through the same deterministic ladder and are written only after a human accepts them.
- A default Staff Code pattern was added (changed again in rev 5).
- New ticket T-020. Existing tickets are not renumbered.

**Rev 4 changes:**
- HR Database default headers are now exactly `Staff Code` and `Official email ID`, so email corroboration is on by default.
- Placeholder values such as `N/A` are treated as "no value" (D10).
- Resource Persons appear in the HR Database **without** a Staff Code or email (superseded by rev 5).

**Rev 5 changes (school decision):**
- Resource Persons will **never** be issued Staff Codes and have no email, so they get no Chat DMs.
- `Resource Person` becomes a **name-match-only** category: no code or email is required, flagged or counted as missing, and they join on exact Display Name (D11).
- The pattern is now `^[SW]0[0-9]{3}$`.
- The "awaiting code" / "No Staff Code" concept is removed.
- There are no open questions left.

---

## 1. Problem and users

### 1.1 Problem

**One Way** is a separate attendance system. Every day it reads `🗓️ Absence Register` by header name and has to work out *who* each row is about.

Today the only identity in a row is `Teacher`, which is the timetable's spelling of a name. About 20 of the 75 names used so far do not match the Workspace directory exactly. For example, the Register says "Edith Christopher", the directory says "Edith Prameela B", and the mailbox is `edith.christopher@…`. One Way has to guess, and a wrong guess marks the wrong person absent.

The school already gives every staff member a unique **Staff Code** when they join. Nothing in this workbook records it, and `👥 importHR` (the Workspace directory) has no Staff Code. The codes live in the school's separate **HR Database** workbook, on the tab `CurrentStaff`. That workbook is a **sensitive** HR record: it holds family names, phone numbers, personal IDs and addresses. The names in it differ from the timetable spellings in the same ways the directory names do.

There are other gaps too:
- `hrLookup_()` guesses an email and Chat ID from the name. It uses prefix matching over about 2,400 directory accounts and takes the first hit, so duty emails and DMs can go to the wrong person.
- Non-teaching staff (about 30–40 people) have nowhere to record absence. Many of them have no email, and One Way will soon need them.

### 1.2 Users

| Who | Uses it for | Device | How often |
|---|---|---|---|
| Leave coordinator | Marking absences (flow unchanged). Sees a warning when a teacher has no Staff Code or email. | Phone (grid tab) and desktop (side panel) | Daily |
| Office staff | Recording non-teaching staff absence | Desktop, sometimes phone | A few times a week |
| ICT facilitator | Roster sync, filling Staff Codes, reviewing email matches, approving previews | Desktop | At rollout, then about once a term and whenever the Allotment changes |
| One Way (another system) | Reads `🗓️ Absence Register` and `🗓️ Non-Teaching Absence` by header name | Server | Daily |

---

## 2. Goals and non-goals

### 2.1 Goals

1. **One editable roster** (`🪪 Teachers`) for all staff. Each row links the exact timetable spelling of a name to a **Staff Code** (mandatory, unique, immutable) and, where the person has one, a confirmed Workspace **Email**.
2. **Exact join keys in every absence row.** Every new Register row and every non-teaching absence row carries `Staff Code` and `Staff Email`. Existing Register rows are backfilled, but only after a preview has been approved.
3. **A record of non-teaching absence** that One Way can read. It stays outside cover logic by construction.
4. **No guessing.** Directory matching gives every row a confidence class, and a human confirms every fuzzy or ambiguous match. A missing Staff Code or Email is left blank and flagged. It is never inferred.
5. **Stop the prefix-match mis-delivery** in email and Chat DM lookups.
6. **The live workbook stays safe.** Back up first, preview every write, use `upgradeTabs()` only, and give every step a rollback.
7. **Staff Codes come from the HR Database, not from typing.** Codes and categories are linked from `CurrentStaff`, and a human confirms each one. Current non-teaching staff can be *proposed* from it, so the ~30–40 people need not be typed in by hand.
8. **Data minimisation.** Only a fixed whitelist of HR Database columns is ever read. Nothing outside that whitelist reaches memory, a sheet, a log, a backup or Chat (D9).

### 2.2 Non-goals

- **The roster does not decide who teaches.** `📋 Allotment` (in the source workbook) stays the authority. The roster never drives the engine, pool, fairness, rules or analytics.
- **No renames.** Display Names are never edited. Names in the Allotment, Timetable, Staff Duties, `🗂️ Log` or `⚖️ Rules` are never rewritten (see §3.3).
- **Active is never changed automatically.**
- **No change to the schema or rows of `⚙️ Config`, `🗂️ Log`, `👥 importHR` or `📄 Reports`.**
- **No change to the Register's existing layout** beyond appending two columns at the end.
- **No cover for non-teaching staff.** Their absences are never covered, never counted in fairness, and never shown in the weekly report or analytics.
- **No new codes.** The workbook does not issue or generate Staff Codes. It only records codes the school has already issued.
- **This work never writes to the HR Database.** It also never copies any HR Database column outside the whitelist, and never runs the HR read from a time-driven or installable trigger.
- **The HR Database workbook ID is not stored in code or in the repo.**
- **Out of scope:** writing to the Workspace directory, One Way's own code, and `LockService` around `commitPlan()` (README §15.2). The backfill (§7.5) does take its own lock.

---

## 3. Current state (verified in code, 2026-10-23)

### 3.1 Where the teacher list comes from

There is **no hardcoded teacher list**. The list is already sheet-driven, but it comes from the *source* workbook:

| Consumer | Call |
|---|---|
| `📝 Mark Absence` grid dropdown | `MarkAbsenceTab.js:84` `refreshAbsenceTabTeacherList_()` → `getAllTeachers()` (`requireValueInList`, `setAllowInvalid(true)`) |
| Side panel search | `Code.js:93` `uiBootstrap()` → `Sidebar.html` `TEACHERS` |
| `🧪 Check rules` | `Rules.js:398` |
| Analytics cohort | `AnalyticsData.js:24` |
| `checkSourceConnection()` | `Code.js:294` |

How the lookups work:
- `getAllTeachers()` (`DataSource.js:142`) returns the sorted, de-duplicated values of Allotment column 5, from row 4 down.
- `getTeacherMeta()` returns department and team from the same rows.
- `Pool.js` builds the pool from Allotment rows whose subject is `Substitution`.
- Caching is per execution only (`memo()`). **Nothing uses `CacheService` today.**

### 3.2 HR lookup

- `getHrMap()` (`HR.js`) reads `👥 importHR` from row 3, **by column position** taken from config (`hrNameCol` / `hrEmailCol` / `hrChatCol`).
  - Headers in row 2: `Teacher Name | Email | Chat User ID (users/123…)`.
- `populateHrFromDirectory()` writes every **non-suspended** account in the Workspace (about 2,400 rows). That includes device, shared and role accounts. Suspended users are skipped, so "suspended" shows up in importHR as **absent**.
- **Bug (README §15.3):** `hrLookup_()` tries an exact key, then falls back to a prefix match in either direction over all keys, and the first hit wins. The result feeds `emailSubstitutes_()` (`Chat.js:169`) and `dmSubstitutes_()` (`Chat.js:218`).

### 3.3 Six stores depend on the exact spelling of a name

None of these stores updates itself when the spelling changes elsewhere. That is why the **Display Name must never change and must be byte-equal to the Allotment spelling**.

| Store | What a rename breaks |
|---|---|
| `📋 Allotment` | Nothing. It *is* the spelling. |
| `📅 Timetable` teacher cells | The engine's busy map: the teacher looks free, so she can be **double-booked**. |
| `👩‍🏫 Staff Duties` col A | The free-period guard and duty availability miscount. |
| `🗂️ Log` Teacher / Substitute | Term fairness counters reset, so the renamed teacher is **flooded** with cover. Fairness and Analytics split one person into two. |
| `⚖️ Rules` Who / Then | `DEDICATED_SUB`, `FLOOR_LIMIT` and `FREE_PERIOD_GUARD` silently stop matching. This is caught only when `🧪 Check rules` is run. |
| `👥 importHR` name | Email or DM goes to the wrong person, or to no one. |

### 3.4 Absence Register I/O

**Layout**
- `SS.ABSENCE = '🗓️ Absence Register'`. Row 1 is a title, row 2 holds the headers, and data starts at row 3.
- `ABSENCE_HEADERS` has 16 columns: `Timestamp, Date, Day, Week, Teacher, Department, Team, Absence Type, Periods Away, Periods Scheduled, Periods To Cover, Covered, Uncovered, Cover Reassigned, Run ID, Marked By`.

**Writer**
- `appendToAbsenceRegister_()` builds positional arrays and writes `setValues` over 16 columns.
- Appending columns does not break it, but it cannot fill a new column until it is converted to a header-name map.

**Positional readers**
- `readAbsenceRows_()` (`r[0]…r[15]`)
- `styleAbsenceRows_()` (indices 11 and 12)
- `migrateAbsenceVocabulary_()` and `absenceMigrationNeeded_()` (`ABSENCE_TYPE_COL = 8`)
- `ReportData.js:19` consumes `readAbsenceRows_()`.

**Row churn**
- Re-marking a teacher **deletes** her row and appends a new one with a **new Run ID**. Row numbers and Run IDs are therefore not stable identifiers.

**Clearing**
- `writeAbsenceRegisterTab_()` starts with `sheet.clear()`. It runs only when the tab is missing, or from the guarded `setupAllTabs()`.

### 3.5 Setup paths

- `upgradeTabs()` is **safe**: it creates missing tabs and runs `refreshLabels_()`. It is the only setup path used on the live workbook.
- `setupAllTabs()` is **destructive and guarded**. Never run it on the live workbook.
- `backupWorkbook_(reason)` (`Reports.js:400`) saves a dated Drive copy.
- The webhook URL is in Script Properties. The timezone is `Asia/Kolkata`.
- **No new OAuth scope is needed.** `CacheService` and `LockService` require none. `appsscript.json` stays unchanged.

### 3.6 The HR Database (external, read-only, sensitive)

- This is a separate Google Sheet, "[HR] Database", with the tab `CurrentStaff`.
- These are the approximate headers seen so far. They are **not** confirmed exactly, which is why every header is configurable:
  - `Status` (e.g. `Current`)
  - `All four names accurate`
  - `Category` (e.g. `Teaching staff`, `Administration`, `Support staff`)
  - `Title`
  - `Name of the Staff`
  - `Team / Role`
  - `Department`
  - `Mobile Number`
  - `Official email ID`
  - `Gender`
  - `Father's Name`, `Mother's Name`
  - `Personal ID`
  - address fields
  - `Staff Code`, further right
  - Resource Persons appear here, with placeholders such as `N/A` in `Staff Code` and `Official email ID`. They will never have either (D11).
- **Scope.** `SpreadsheetApp.openById()` on another spreadsheet is covered by the `https://www.googleapis.com/auth/spreadsheets` scope that is **already declared**. **No new scope is needed, and the manifest does not change.**
- **Who can read it.** Access is the *running user's* Drive access. The reader runs only from menu items, as the person clicking, so a user without access gets a friendly error (R29).

### 3.7 Summary of the three sources

| Source | Authority for | Read how |
|---|---|---|
| `📋 Allotment` (source workbook) | **Who teaches**; Display Name spelling; Teaching Department/Team | Existing `getAllotment()` |
| `👥 importHR` (this workbook) | Workspace email and Chat ID | One batch read, by header name |
| HR Database `CurrentStaff` (external) | **Staff Code**; Category; non-teaching Department and Team/Role; official email (corroboration) | Whitelisted columns only, by header name (D9) |

---

## 4. Design decisions

### D1. The roster is an identity overlay, not a membership source

The Allotment answers *who teaches*. The roster answers *who this name really is*.

| Failure mode | Risk if the roster were the membership source | Design response |
|---|---|---|
| **In the Allotment, not on the roster** (new teacher) | She vanishes from the dropdown and her classes go uncovered, **silently**. | **Fail open.** She is still offered, with a warning (D2). Sync proposes adding her. |
| **On the roster, not in the Allotment** (leaver, upstream rename, typo) | Marking her absent finds no timetable. The result is "nothing to cover", which looks like success. | Flagged `In Allotment = FALSE`. Not offered as a teacher. Sync *proposes* `Active = FALSE` (D2). Her Staff Code and Email stay, so her history still joins. |
| **Both edited by hand** | Two truths drift apart. | Teaching rows are created **only by sync**. Humans add only non-teaching rows. `🧪 Check roster` flags a hand-added Teaching row. |

**Column ownership.** Every column has exactly one owner (§6.1).
- Sync may refresh **derived** columns on existing rows: `In Allotment`, plus `Department` and `Team` on Teaching rows.
- Sync never writes a human-owned column.

**No override of Department or Team.** `getTeacherMeta()` drives same-department scoring and team rules. A roster override would create a second source of truth for engine inputs. On Teaching rows these columns are therefore read-only mirrors given to One Way for convenience. On non-teaching rows a human enters them.

**Upstream renames.** Suppose the Allotment changes a teacher's spelling.
1. Sync proposes the new spelling as a new row, and flags the old row `In Allotment = FALSE` with a proposed deactivation.
2. The ICT facilitator applies the deactivation, then fills `Replaced By` on the old row.
3. The new row is given the **same Staff Code** through `Correct Staff Code` (§4 D3), which writes a log entry. The new row also gets the same confirmed Email.

Old and new Register rows then join to one person in One Way.

### D2. Active is a human decision, never automatic

**What Active controls.** Active decides only whether a name is **offered** in a dropdown. It never decides whether the person exists. Deactivating a person hides her name; it does not break her history. Her rows keep their Staff Code and Email, and `Replaced By` covers renames.

**Teacher dropdown and panel (fail-open).** The names offered are the Allotment teachers, **minus** roster rows marked `Active = FALSE`.
- An Allotment name with no roster row is still offered. The panel shows a banner and the grid status cell repeats it: "3 teachers are not on the 🪪 Teachers roster yet. Run 🪪 Sync roster."
- An Allotment name with no Staff Code or no confirmed Email is offered with an amber marker.
- A roster row that is not in the Allotment is never offered as a teacher.
- The grid keeps `setAllowInvalid(true)`. Typing an inactive Allotment name still produces a plan, and the status cell shows a warning.

Because the dropdown fails open to the Allotment, **Active matters only for people who are still in the Allotment but gone or away**: long leave, or someone who left mid-term before the timetable was updated. For everyone else, leaving the Allotment already removes the name from the dropdown.

**Departure signals.** The sync preview shows these in order of authority:

| Signal | Strength | What sync does |
|---|---|---|
| (a) The name is gone from the Allotment (a leaver is removed from the timetable) | **Authoritative** | Lists the row with **proposed `Active = FALSE`**, pre-ticked. The user applies it. |
| (b) The roster Email is missing from importHR (deleted or suspended account) | **Weak, secondary** | Shown as evidence only. **Never sufficient on its own**: it never pre-ticks a deactivation. With (a), it strengthens the proposal. Without (a), it appears as "check: email not in directory". |
| Manual | — | The ICT facilitator unticks `Active` directly, for example for long leave or a mid-term departure before the Allotment is updated. |

**Left On** (optional date). A human fills it when deactivating a leaver. It is informational, for One Way and the audit trail; no code logic depends on it. When sync applies a proposed deactivation it does not fill `Left On`; it notes the apply date in the Roster Log instead.

**Code paths.**
- `getAllTeachers()` keeps its current meaning: all Allotment teachers, for rules, analytics and the pool.
- A new `getMarkableTeachers_()` feeds only the grid dropdown and `uiBootstrap()`.

### D3. Staff Code is the primary join key

| Property | Rule |
|---|---|
| Source | **The HR Database** (`CurrentStaff`), linked through the matching ladder (§5.8). It is written to the roster **only after a human Accepts it** in `🪪 Roster Review`. Hand entry, through the same first-set path and checks, is only for a code-required person whose HR Database cell is a placeholder. **Name-match-only categories (Resource Person) never hold a code** (D11). |
| Required | On every roster row whose category has `Join key = Staff Code`. A blank code there is shown amber and listed by Check roster. In a **name-match-only** category (Resource Person) the code is never required, never flagged and never counted as missing; Apply and onEdit refuse to write one. The system never generates or guesses a code. |
| Unique | One code per person. The only permitted repeat is a **rename chain**: the old row is inactive and its `Replaced By` points to the row holding the same code. Any other duplicate is red, and Apply and backfill refuse to use it. |
| Immutable once set | A blank → value change is the first set, and it is logged. After that the column has warning-only protection. A code-owned hidden column, `Staff Code (Locked)`, records the accepted value. A difference between the two is flagged as "Staff Code changed without a correction". Join writes use the **locked** value and refuse the row until the difference is resolved. |
| Corrections | Only through the menu `🪪 Roster → Correct Staff Code…`. It prompts for Display Name, new code and reason, checks uniqueness, updates both columns, and appends to `🪪 Roster Log`. It never rewrites Staff Codes already written into Register or non-teaching rows. If historical rows need it, a backfill-style preview and apply would handle that later (out of scope). |
| Never reused | A code belonging to an inactive row cannot be given to a different person. Check roster flags a code that appears on rows not linked by `Replaced By`. |
| Format | Non-blank, unique, plain text (`@`) so leading zeros survive. Must match the editable pattern on `🧭 Roster Settings` (default `^[SW]0[0-9]{3}$`: S = Teaching/Admin, W = Support Staff). A pattern or letter/Category mismatch is a warning. The same check runs on codes **from the HR Database**: in `🪪 Roster Review`, a code that fails the pattern is shown with a warning and is **never** pre-filled `Accept`, even on an exact name match. A code that is already held by another roster row, or by two HR Database `Current` rows, is **refused** at Apply. |

Roster setup leaves the column blank. Codes are filled by accepting HR Database links (§5.8). Check roster lists every row still without a code, and only those are entered by hand.

**One Way match order:** `Staff Code`, then `Staff Email`, then `Teacher` name (§8).

### D4. Category replaces Role

`Category` is a dropdown. Its values come from an editable list on `🧭 Roster Settings`:

| Category | Teaching? | Join key | Email required? | Seed note |
|---|---|---|---|---|
| Teaching | TRUE | Staff Code | TRUE | Created only by sync; Allotment-backed |
| Admin | FALSE | Staff Code | TRUE | About 11–12 people, all with email |
| Support Staff | FALSE | Staff Code | FALSE | About 18–20 people, no email; One Way onboarding soon |
| Resource Person | FALSE | **Name only** | FALSE | No code and no email, ever; no Chat DMs (D11) |

- Exactly one category may have `Teaching? = TRUE`. Check roster enforces this.
- `Email required? = FALSE` means:
  - a blank Email is **not** an error and is shown grey ("none expected"), not amber;
  - email matching still runs for these rows if the user asks, but `Unmatched` reads "No email expected";
  - the person joins **solely on Staff Code**.
- Non-teaching rows have no Allotment counterpart. `buildPool()`, `computePlan()` and the busy map can never see them, so they are kept out of cover by construction.
- A non-teaching Display Name is typed by a human and must not collide with any Teaching Display Name.
- If a Resource Person *does* appear in the Allotment, sync creates a Teaching-category row for them, with the Allotment as the authority (not expected: no Resource Person is in the Allotment).

**Category from the HR Database.** An editable mapping on `🧭 Roster Settings` translates HR Database `Category` values to roster categories. Matching ignores case and surrounding spaces.

| HR Database value (default) | Roster Category |
|---|---|
| Teaching staff | Teaching |
| Administration | Admin |
| Support staff | Support Staff |
| Resource Person | Resource Person |

- An unmapped value is shown as "Unmapped category: …". It is never guessed, and that row is not proposed.
- On a Teaching roster row, the Allotment still decides membership. If the linked HR row maps to a non-Teaching category, the review shows a conflict and nothing changes.

**Proposed additions.** HR Database rows that pass the Status filter, map to a **non-teaching** category, and link to no roster row appear in `🪪 Roster Review` as **`Propose add`**. Each shows the HR name, Category, Department, Team/Role, Staff Code and official email.

- The reviewer may type a different Display Name before accepting. It must be unique, and it becomes immutable once added.
- Rows are added **only on Accept, never automatically**. This replaces most hand entry of the ~30–40 non-teaching staff.
- HR rows that map to Teaching are never proposed. Teaching rows come only from the Allotment.

### D5. Non-teaching absence is entered directly in the tab, with onEdit enrichment

A menu dialog was rejected as the primary path, because Sheets on a phone has no custom menus, dialogs or sidebars. Staff type rows into `🗓️ Non-Teaching Absence` using dropdowns.

The existing installable `onEditInstallable` gains one branch. When a `Teacher` cell on that tab is edited, it fills **only blank** cells:
- `Staff Code` and `Category` from the roster;
- `Staff Email` from the roster (confirmed only);
- `Timestamp`;
- `Marked By` from `e.user`.

If the editor cannot be identified, `Marked By` is left **blank and shown amber**, and the person can type it. The branch never calls `computePlan()`.

### D6. Join-key values come only from the roster, never guessed

Wherever a join key is written (at mark time, at backfill, and in the non-teaching tab):
- `Staff Code` is the roster's **locked** code;
- `Staff Email` is the roster Email only if `Match Status = Confirmed`.

Otherwise the cell is blank and amber. Nothing falls back to importHR or name similarity.

### D7. Contact resolution for email and DM: roster first, exact only

`resolveContact_(name)` replaces `hrLookup_()`, in this order:
1. The roster row has a confirmed Email. The Chat ID is then taken from importHR by **exact** email match.
2. Otherwise, use an importHR row only if it is the single non-excluded row whose normalised name matches exactly.
3. Otherwise, use nothing, and list the name under "not notified: no confirmed contact".

**Prefix matching is removed.**

### D8. Matching settings live on a sheet, not in `⚙️ Config`

The memory rule forbids touching Config rows, and `addMissingConfigRows_()` inserts rows. So these all live on `🧭 Roster Settings`:
- the Categories table;
- exclusion signals;
- the allow list;
- honorifics.

The tab is seeded only when it is created. Later runs never overwrite user edits.

The HR Database settings live here too: workbook ID, tab name, header row, Status filter, header-name mapping, Category mapping and Staff Code pattern (§6.2). **The workbook ID is typed into the live sheet by the user. It never appears in code, fixtures, the repo, logs or Chat messages.**

### D9. HR Database reader: whitelist only, data minimisation is a hard requirement

The reader is a single function, `readHrDatabase_()`. It is the **only** code that opens the HR Database.

1. **Open.** `SpreadsheetApp.openById(<ID from Settings>)`, then `getSheetByName(<tab from Settings>)`. If either fails (no access, wrong ID, tab renamed), it returns `{ ok: false, error: 'friendly text' }` and **never throws to the user**. For example: "You don't have access to the HR Database set on 🧭 Roster Settings. Ask the HR office to share it with you, or ask someone who has access to run this." Matching then carries on **without** HR Database data: email matching still works, and Staff Code links are simply unavailable. The friendly text never includes the ID or any cell values.
2. **Locate.** The reader reads the **header row only** (configurable, default row 1). It resolves each **whitelisted logical field** to a column index through the header-name mapping on Settings:

   | Logical field | Default header | Required? |
   |---|---|---|
   | `status` | `Status` | yes |
   | `name` | `Name of the Staff` | yes |
   | `category` | `Category` | yes |
   | `teamRole` | `Team / Role` | no |
   | `department` | `Department` | no |
   | `staffCode` | `Staff Code` | yes (the column must exist; individual cells may be placeholders) |
   | `officialEmail` | `Official email ID` | no (if the header is missing, corroboration is reported as unavailable) |

   Header matching ignores case and collapses spaces. If a required header is missing, the reader returns a friendly error naming the **missing header**, not the cell contents.
3. **Read only those columns.** The reader makes one `getRange(firstDataRow, col, n, 1).getValues()` per whitelisted column, at most seven batch reads. It never reads the full row width or the data range, so **non-whitelisted columns never enter memory**. This is batch I/O per column, not per cell.
4. **Filter.** The reader keeps only rows whose `status` is in the Status filter list (default `Current`; case-insensitive). It then normalises values: Staff Code is trimmed and upper-cased, and email is lower-cased. **Placeholders become empty** (D10) in the reader itself, so no later code ever sees `N/A` as a value.
5. **Output.** The reader returns plain objects that hold **only** the whitelisted fields, plus a source row number used for review display. Nothing is cached in `CacheService` or written to Script/Document Properties.

**Where HR Database data may appear:** only `🪪 Roster Review`, `🪪 Teachers` (accepted values only) and `🪪 Roster Log`, and only whitelisted fields.

**Where it must never appear:**
- `Logger` / `console` (counts only);
- the Ops Alerts Chat card (`notifyOpsFailure_` gets function name and error class only);
- `🧾 Sync Preview`;
- `🧾 Backfill Preview`;
- any Register column other than Staff Code.

Backups (`backupWorkbook_`) copy only *this* workbook, which by construction holds whitelisted fields only.

**Enforcement and tests.**
- The whitelist is a frozen constant, `HR_DB_FIELDS`.
- `test/hrdb-minimisation.test.js` builds a fake HR sheet. Each non-whitelisted column holds a sentinel string (e.g. `PII-SENTINEL-MOBILE`).
- The test asserts that:
  - every `getRange` call either targets the header row or covers exactly one whitelisted column;
  - no sentinel appears in the returned objects, in any fake sheet written by preview or apply, in captured `Logger` / `console` output, or in captured Chat payloads;
  - adding a field to `HR_DB_FIELDS` without updating the test fails the test.


### D10. Placeholders mean "no value"

`🧭 Roster Settings` holds an editable **Placeholder values** list. The default is: *(blank)*, `N/A`, `NA`, `n/a`, `-`, `none`, `nil`, `TBD`.

- Matching ignores case and surrounding spaces after trimming. `n/a` and `N/A` are both listed for readability.
- It applies to the HR Database `Staff Code` and `Official email ID` cells. The same list also applies to anything hand-typed into a roster Staff Code or Email cell.

A placeholder:
- is **never written** to the roster, the Register or `🗓️ Non-Teaching Absence`;
- is **never counted as a duplicate**, even though many rows share `N/A`;
- **never fails the Staff Code pattern** as an error. The row is simply "no code in the HR Database";
- **never matches** anything. It is not an R2 email local part, not corroboration evidence, and not a join key.

`readHrDatabase_()` converts placeholders to empty strings. Its counts report how many placeholders it found, by field. A hand-typed placeholder in a roster Staff Code cell is treated as blank (amber "missing"), and Check roster says so.

### D11. Resource Persons are name-match-only

The school will **never** issue Staff Codes to Resource Persons, and they have no email. `Resource Person` is therefore a **name-match-only** category (`Join key = Name only` on Settings).

1. **Onboarding.** They arrive through `Propose add`, by Category mapping from the HR Database, and a human accepts each one. No code and no email are written; placeholders such as `N/A` are ignored (D10).
2. **Recording absence.** They appear in the `🗓️ Non-Teaching Absence` dropdown like other Active non-teaching staff. Their rows carry `Teacher` and `Category`. `Staff Code` and `Staff Email` are left blank and shown neutral grey ("not applicable"), **never amber**.
3. **No flags.** Check roster never reports their code or email as missing. The backfill skips them (action `Name only`). They get no Chat DMs, because there is no address.
4. **Their name is their key.** The Display Name is therefore:
   - **immutable**, like every Display Name (warning protection plus detection);
   - **unique across the whole roster**. Check roster flags any duplicate Display Name, and specifically any name shared between a Resource Person and anyone else.

   If two Resource Persons share a real name, the reviewer gives one of them a distinguishing Display Name at `Propose add` (for example, adding an initial). It can never be changed afterwards.
5. **Codes are never invented** for anyone. There is no sequence, no hash and no "next free" code. Apply, onEdit and Correct Staff Code refuse to give a name-match-only row a code (R36).

---

## 5. Matching roster rows to importHR (Email) and the HR Database (Staff Code)

§5.1–5.7 describe linking to `👥 importHR` for Email. §5.8 applies the **same ladder and classes** to the HR Database for Staff Code and Category. Staff Code is never inferred from names: it is copied from the linked HR Database row, and only after a human Accepts the link.

### 5.1 Inputs and performance

- importHR is read **once** with a single `getValues()`. Columns are found **by header name** (`Teacher Name`, `Email`, the header starting `Chat User ID`). If a header is missing, the config column numbers are used and the preview shows a warning.
- The roster and Settings are read in one batch each.
- In-memory indexes: normalised name → rows, email local part → rows, and token → rows (inverted index).
- Target: under 3 s for about 2,500 HR rows × about 100 roster rows, with **no per-row Sheets calls**.
- Matching is written as pure functions, so it can be tested in the node harness.

### 5.2 Excluding non-person accounts

An importHR row is **excluded** if any enabled rule on `🧭 Roster Settings` matches it, unless its email is on the Allow list. These are the seeded defaults, all editable:

| Signal type | Seed values |
|---|---|
| `Local part contains` | `admin, office, lab, device, print, scan, noreply, no-reply, info, account, library, classroom, room, kiosk, chromebook, ipad, cart, test, support, helpdesk, reception, exam, bus, transport, store, sports, ict, it.` |
| `Local part matches regex` | `\d{2,}`, `^[a-z]{1,3}$` |
| `Name contains` | `Lab, Room, Device, Printer, Admin, Office, Account, Class, Block, Desk, Team, Group, Shared` |
| `Name is single token` | `TRUE` |
| `Domain is` / `Exact email` | empty |
| `Allow email` | empty (overrides every exclusion) |
| `Honorific` | `Mr, Mrs, Ms, Miss, Dr, Rev, Sr, Fr, Prof` |

Exclusions are **reported, never hidden**. If the only exact name match for a roster row is an excluded account, the row is marked `Ambiguous` and the rule that excluded the account is named.

### 5.3 Normalisation

`normName(s)`:
1. Apply NFKC and lower-case.
2. Turn `. , ' - _` into spaces.
3. Strip leading honorifics.
4. Collapse whitespace.

Tokens of length 1 are treated as initials.

### 5.4 The ladder (deterministic; the first rung that yields a result wins)

The ladder runs only over non-excluded HR rows, and only for roster rows without `Match Status = Confirmed`. Confirmed rows are never re-matched.

| Rung | Test | 1 hit | 2 or more hits |
|---|---|---|---|
| R1 Exact name | `normName` is equal | **Confirmed-exact** | Ambiguous |
| R2 Email local part | The local part equals one of the forms `f.l`, `fl`, `f_l`, `f.l1`, `f1.l`, `l.f`, built from the non-initial tokens. With three or more tokens, first + each later token is also tried. | **Candidate** | Ambiguous |
| R3 Token set | At least 2 non-initial tokens are shared, **or** the first token is shared and the remaining initials agree | **Candidate** | Ambiguous |
| R4 Weak | Only the first token is shared | — | Ambiguous (up to 3 shown) |
| — | Nothing found | **Unmatched**, or "No email expected" when the category has `Email required? = FALSE` | — |

**Uniqueness pass.** If one email is proposed for two or more rows that would both be Active and do not share a Staff Code, every one of those rows is set to `Ambiguous`.

**Worked example.** For "Edith Christopher", R1 finds nothing. R2 builds `edith.christopher` and finds one account, `edith.christopher@school.example`, whose directory name is "Edith Prameela B". The row becomes a **Candidate**, and a human types `Accept`.

### 5.5 Confidence classes

| Class | Default Decision | Written without a human? |
|---|---|---|
| **Confirmed-exact** | **Pre-filled `Accept`** (a human can change it) | **No.** It is written only by `Apply decisions`, after the preview has been seen. |
| **Candidate** | Blank | No |
| **Ambiguous** | Blank | No |
| **Unmatched / No email expected** | Blank | No |

### 5.6 Review workflow (`🪪 Roster Review`)

**Preview email matches** writes nothing to `🪪 Teachers`. It rebuilds the derived columns and **keeps the Decision, Manual Email and Notes** already typed against the same Display Name.

The tab has one row per (roster row or proposed addition) **per link kind**. The `Link` column is `Email`, `Staff Code` or `Propose add`.

| Column | Owner |
|---|---|
| Link · Display Name · Category · Class · Rule | Code |
| Candidate 1/2/3 Name · Candidate 1/2/3 Email *or* Staff Code | Code |
| HR Category · HR Department · HR Team/Role · Evidence (`Corroborated` / `Conflict` / pattern warning) | Code; Staff Code and Propose add rows only; whitelisted fields only |
| **Decision**: `Accept` · `Pick 2` · `Pick 3` · `Enter email` / `Enter code` · `No email` · `Ignore` | Human |
| **Manual Email / Code** · **Display Name override** (Propose add only) · **Notes** | Human |
| Result | Code (written by Apply) |

Apply re-reads the HR Database (still whitelist-only) and re-validates each Staff Code decision. The code must:
- still belong to a `Current` row;
- be unique across the roster;
- be blank on the target roster row (**never overwritten**; changes go through `Correct Staff Code…`).

A pattern mismatch is allowed only on an explicit `Accept` and is logged as a warning.

`Propose add` Accept appends a non-teaching roster row with Display Name, Category, Staff Code (locked), Department and Team.

**Apply decisions** works as follows.
1. Take a script lock and back up the workbook. If the backup fails, ask before continuing; the default answer is No.
2. Re-read the roster, the review tab and importHR. Re-validate each decided row:
   - the email exists **exactly** in importHR;
   - it is not excluded, unless it is on the allow list;
   - it is not on another Active row, unless that row shares the Staff Code through a rename chain;
   - the roster Email is blank or already equal (**never overwritten**).
3. Write in one batch per column: `Email` (lower-case), `Match Status = Confirmed`, `Confirmed By`, `Confirmed On`.
   - `No email` writes `Match Status = No email`. It is allowed only for categories with `Email required? = FALSE`.
   - `Ignore` writes `Match Status = Ignored`.
4. Write the Result column, clear the cache, and show a summary.

Apply is idempotent.

### 5.7 Preview summary format

```
🪪 Match preview — 2026-10-23 16:40 (Data as of importHR 2026-10-20 · HR Database read 16:40)
Roster rows: 75 (75 Teaching) · Propose add from HR Database: 34 (12 Admin · 19 Support Staff · 3 Resource Person)
EMAIL      Confirmed-exact 52 · Candidate 14 · Ambiguous 6 · Unmatched 3
STAFF CODE Confirmed-exact 48 · Candidate 19 · Ambiguous 4 · Unmatched 4 · pattern warnings 2 · corroborated by email 41
importHR rows: 2,412 (excluded as non-person: 1,903) · HR Database rows read: 160 (Current: 118) · columns read: 7 of 7 whitelisted
Nothing has been written to 🪪 Teachers. Review 🪪 Roster Review, type decisions, then Apply.
```

The summary shows counts only. It never shows HR Database values other than whitelisted fields, and only those appear on the review tab.

### 5.8 Linking to the HR Database (Staff Code, Category)

- **Input.** The output of `readHrDatabase_()` (D9): only `Current` rows, only whitelisted fields.
- **Ladder.** The same R1–R4 ladder (§5.4) runs, comparing the roster Display Name with the HR `name`.
  - R2 (email local part) uses the HR row's `officialEmail`, which is read by default from `Official email ID`. It is skipped for rows where that cell is a placeholder.
  - Exclusion signals (§5.2) do **not** apply: the HR Database lists people, not accounts.
- **Classes.** The same as §5.5. **Confirmed-exact is pre-filled `Accept`**, except where the Staff Code fails the pattern or the HR Category conflicts. Candidate, Ambiguous and Unmatched rows need a typed decision.
- **Uniqueness pass.** An HR row proposed for two roster rows, or two HR `Current` rows sharing one Staff Code, demotes every row involved to `Ambiguous`.
- **Corroboration** is evidence only, never a reason to auto-accept. The review row shows `Corroborated` when the HR row's `officialEmail` equals:
  - the roster's confirmed Email, or
  - the importHR candidate chosen for the same row.

  It shows **`Conflict`** when the two point at different addresses. Conflicting rows are never pre-filled.
- **What Accept writes.**
  - `Staff Code`: blank only. It becomes the locked value, and the Roster Log records Source `HR Database`.
  - `Category`: only on non-teaching rows or `Propose add` rows.
  - `Department` and `Team`: from HR `department` and `teamRole`, on **non-teaching rows only**. Teaching rows keep the Allotment mirror.
  - The HR official email is **not** written as the roster Email. It only corroborates. The roster Email still comes from importHR, because DMs need a Workspace account.
- **Placeholders.** An HR row whose Staff Code is a placeholder can still be *linked*: its Category, Department and Team/Role are useful. Accept then writes **no** code. A code-required row stays amber; a Resource Person row is complete without one (D11). The review shows `No code in HR Database` instead of a pattern warning. Placeholder rows are excluded from the code uniqueness pass.
- **Without access.** If the reader returns `ok: false`, the Staff Code section of the review shows the friendly error once. Email matching proceeds as normal.

---

## 6. Data

### 6.1 `🪪 Teachers` (new; layout owned by code, rows curated by hand)

Row 1 is a title, row 2 holds the headers, and data starts at row 3. Every column is located **by header name**. New columns are only ever appended.

| # | Header | Owner | Validation / format |
|---|---|---|---|
| 1 | Display Name | **Sync** (Teaching) or human (others) | Unique. Warning-only protection. **Never edited.** |
| 2 | Staff Code | Apply (accepted HR Database link), or a human for people not in the HR Database. First set only; corrections only through the menu. | **Required.** Unique (except rename chains). Plain-text format. Warning-only protection once set. |
| 3 | Category | Sync sets Teaching. A human sets the others. | List from Settings |
| 4 | Active | **Human only.** Sync applies only proposals the user has accepted. | Checkbox, default TRUE |
| 5 | Email | Apply, or typed by a human | Lower-case and a valid address. Unique among Active rows (except rename chains). Optional when the category does not require email. |
| 6 | Match Status | Apply / Check roster | `Unreviewed`, `Confirmed`, `Needs review`, `No email`, `Ignored`. A hand-typed Email stays `Needs review` until it is confirmed. |
| 7 | Department | Sync (Teaching) or human | Mirror only, never fed back to the engine |
| 8 | Team | Sync (Teaching) or human | Same as Department |
| 9 | In Allotment | Sync | Read-only. FALSE on a Teaching row is shown amber. |
| 10 | Left On | Human, optional | Date, stored as `yyyy-MM-dd` |
| 11 | Replaced By | Human | Must be another Display Name on the tab |
| 12 | Confirmed By · 13 Confirmed On | Apply | Audit columns |
| 14 | Notes | Human | — |
| 15 | Staff Code (Locked) | **Code**, hidden | The accepted code (D3) |

**Visual layer** (from an idempotent setup):
- Frozen headers.
- Columns owned by code are tinted grey.
- Status colours, always paired with text:
  - missing Staff Code: amber;
  - duplicate or unlocked-changed Staff Code: red;
  - Match Status `Confirmed`: green;
  - `Needs review` or `Unreviewed` on an email-required row: amber;
  - blank Email where none is expected: grey;
  - `In Allotment = FALSE` on an Active Teaching row: amber.

**Protection** is warning-only (`setWarningOnly(true)`) on Display Name, Staff Code and the columns owned by code. Hard protection would lock the coordinator out. The real guard is detection:
- An edited Teaching Display Name stops matching the Allotment, so Check roster reports it as a "probable edited Display Name".
- An edited Staff Code no longer equals the locked value.

### 6.2 `🧭 Roster Settings` (new)

The tab holds these plain ranges, seeded once and never overwritten afterwards:

| Range | Columns | Seed |
|---|---|---|
| **Categories** | `Category \| Teaching? \| Join key (Staff Code / Name only) \| Email required?` | §4 D4 |
| **Exclusions** | `Signal Type \| Value \| Reason \| Enabled` | §5.2 |
| **Allow list** | `Email \| Reason` | empty |
| **HR Database source** | `Key \| Value` | `Workbook ID` = *(blank; the user types it in the live sheet)* · `Tab` = `CurrentStaff` · `Header Row` = `1` · `Status Filter` = `Current` · `Staff Code Pattern` = `^[SW]0[0-9]{3}$` |
| **HR Database headers** | `Field \| Header Name` | The rows are the whitelist and are fixed by code; only the header names are editable. Defaults are in D9 step 2 (`Staff Code`, `Official email ID`, …). Matching ignores case and spacing. |
| **HR Category mapping** | `HR Category \| Roster Category` | §4 D4 |
| **Placeholder values** | `Value` | blank, `N/A`, `NA`, `n/a`, `-`, `none`, `nil`, `TBD` (D10) |

The HR Database headers range **cannot add fields**. Its rows are generated from the frozen `HR_DB_FIELDS`. A row typed by hand for any other field is ignored, and Check roster reports it.

### 6.3 `🪪 Roster Review` (new)

See §5.6. It is derived, except for the human columns, which are preserved by Display Name.

### 6.4 `🧾 Sync Preview` (new; derived plus one decision column)

Columns: `Display Name | Change | Evidence | Proposed | Decision | Result`.

| Change | Proposed | Decision default |
|---|---|---|
| `Add` (Allotment name has no row) | New Teaching row | `Apply` |
| `Not in Allotment` (Active Teaching row) | `Active = FALSE` | `Apply` |
| `Email not in directory` (row still in the Allotment) | No change | `—` (information only) |
| `Probable edited Display Name` | No change; fix by hand | `—` |

**Apply sync** applies only rows set to `Apply`, and appends each one to `🪪 Roster Log`. Derived columns are refreshed on every apply. Running it twice changes nothing.

### 6.5 `🪪 Roster Log` (new; append-only)

Columns: `Timestamp | User | Display Name | Field | Old | New | Reason | Source (Sync / Apply / HR Database / Correction / First set)`.

Only roster fields are logged. Those are whitelisted values, never other HR Database content.

Code only appends rows. Humans are warned off editing the tab with warning-only protection.

### 6.6 `🧾 Backfill Preview` (new; derived only)

Columns: `Tab | Row | Date | Teacher | Run ID (Register only) | Current Staff Code | Proposed Staff Code | Current Staff Email | Proposed Staff Email | Action`.

Each column gets its own Action: `Will fill`, `Already filled`, `No code on roster`, `No confirmed email`, `Conflict (differs)`, `Teacher not on roster` or `Name only` (Resource Persons; nothing to fill, D11). The preview covers both `🗓️ Absence Register` and `🗓️ Non-Teaching Absence`.

### 6.7 `🗓️ Absence Register` (existing): two appended columns

- Append `Staff Email`, then `Staff Code`, after the last non-empty header in row 2. If the grid has been trimmed, call `insertColumnAfter` first. Never insert, reorder or rename a column.
- `ABSENCE_HEADERS` gains `'Staff Email'` at position 17 and `'Staff Code'` at position 18.
- Values: Staff Email is lower-case or blank. Staff Code is the locked code or blank, stored as plain text.
- Conditional format: if `Teacher` is non-blank and the Staff Code or Staff Email cell is blank, that cell is amber, with a note.

### 6.8 `🗓️ Non-Teaching Absence` (new)

Headers, in this order:

`Date | Teacher | Absence Type | Periods Away | Marked By | Staff Email | Staff Code | Category | Timestamp | Notes`

| Header | Entry | Validation |
|---|---|---|
| Date | Human | Date, stored as `yyyy-MM-dd` text |
| Teacher | Human | Roster names that are non-teaching **and** Active. `allowInvalid` is FALSE. |
| Absence Type | Human | The eight `ABSENCE_TYPES` labels |
| Periods Away | Human, optional | Free text |
| Marked By | onEdit (`e.user`), or typed | **Blank and amber** when the editor cannot be identified |
| Staff Email | onEdit, confirmed only | Blank is amber only if the category requires email; otherwise grey |
| Staff Code | onEdit, locked code | Blank is amber for code-required categories. For **Resource Persons** it is always blank and grey ("not applicable"), never amber (D11). |
| Category | onEdit | — |
| Timestamp · Notes | onEdit · human | — |

There is **no Run ID**, because these rows do not come from an engine run. Duplicate `(Date, Staff Code)` rows are shown red and never deleted. No engine, report or analytics code reads this tab.

### 6.9 Where configuration lives, and caching

| Item | Location |
|---|---|
| Categories, exclusions, allow list, honorifics | `🧭 Roster Settings` |
| HR Database workbook ID, tab, header row, Status filter, header names, Category mapping, Staff Code pattern | `🧭 Roster Settings`. **Never in code or the repo.** |
| HR Database whitelist (`HR_DB_FIELDS`) | Code constant, frozen by the minimisation test |
| Source workbook, Allotment tab | `⚙️ Config` (read-only to this work) |
| Tab names, frozen headers | `Constants.js`, asserted by the contract test |
| Cache TTL (300 s), cache key version | Code constants |

**Caching**
- `getRoster_()` uses `CacheService.getScriptCache()`, key `roster:v1`, **TTL 300 s**, wrapped in `memo()`.
- If the JSON is over 90 KB it is not cached; the tab is read directly instead.
- The cache entry is removed by:
  - `onEditInstallable` on `🪪 Teachers` or `🧭 Roster Settings`;
  - Apply sync;
  - Apply decisions;
  - Correct Staff Code.
- importHR is not cached.
- HR Database data is **never** cached, in CacheService, Properties or anywhere else. It is read fresh on each preview and apply.

---

## 7. Requirements (numbered, testable)

### 7.1 Roster, sync, Active, Staff Code

- **R1** `upgradeTabs()` creates `🪪 Teachers`, `🧭 Roster Settings`, `🪪 Roster Review`, `🧾 Sync Preview`, `🪪 Roster Log`, `🧾 Backfill Preview` and `🗓️ Non-Teaching Absence` if they are missing. If they exist, it does nothing to them.
  - *Test:* run it twice; the second run makes no changes.
- **R2** Preview sync writes only `🧾 Sync Preview`. Apply sync:
  - appends only accepted `Add` rows;
  - sets `Active = FALSE` only on accepted `Not in Allotment` rows;
  - refreshes `In Allotment`, plus `Department` and `Team` on Teaching rows;
  - logs every change;
  - **never deletes a row or writes any other human-owned column.**

  *Test:* a fixture with one new, one removed and one edited name gives +1 row, 1 deactivation proposal and 1 probable-edit report. Every human cell is unchanged.
- **R3** An email missing from importHR **never** pre-ticks a deactivation on its own.
  - *Test:* an Allotment-present teacher with a missing email gets an information-only row.
- **R4** No code path sets `Active` except Apply sync, acting on a row the user has accepted.
  - *Test:* grep-style test plus fixture.
- **R5** Staff Code is checked against D3:
  - the first set is locked and logged;
  - an unlocked change is flagged and blocks join writes for that row;
  - `Correct Staff Code` rejects a duplicate code, updates both columns and logs the change;
  - a duplicate outside a rename chain is reported.

  *Test:* each case.
- **R6** `🧪 Check roster` reports, without writing anything:
  - missing Staff Codes, **only for `Join key = Staff Code` categories** (Resource Persons are never counted);
  - duplicate or reused Staff Codes;
  - Staff Code differing from the locked value;
  - duplicate Display Names;
  - duplicate Active Emails;
  - **blank Email only on rows whose category requires email**;
  - Active Teaching rows not in the Allotment;
  - non-teaching names that collide with Teaching names;
  - hand-added Teaching rows;
  - hand-typed Emails not found in importHR;
  - Allotment teachers missing from the roster;
  - a Categories table without exactly one `Teaching? = TRUE` row;
  - **duplicate Display Names**, called out specifically when a Resource Person's name is shared, because their name is their only key;
  - a Staff Code or Email present on a name-match-only (Resource Person) row, which should never happen;
  - a placeholder typed into a roster Staff Code or Email cell.

  *Test:* a Support Staff row with no email produces no error.

### 7.2 Matching and review

- **R7** Matching is pure and deterministic.
  - *Test:* a fixture of about 30 names × 200 HR rows, including the Edith example, a device account, two staff sharing a first name, and a duplicate email.
- **R8** Confirmed-exact rows are pre-filled `Accept`. No row reaches `Confirmed` except through Apply with a Decision present.
  - *Test:* clearing every Decision and applying writes nothing.
- **R9** Apply never overwrites a different existing Email, never writes an email that is not in importHR, and never gives one email to two unrelated Active rows. `No email` is refused for categories that require email.
- **R10** Re-running Preview keeps the human columns.
- **R11** Exclusion rules and categories come only from `🧭 Roster Settings`.

### 7.3 Consumers

- **R12** `getMarkableTeachers_()` returns the Allotment teachers minus `Active = FALSE`. It feeds the grid dropdown and `uiBootstrap()`. `getAllTeachers()` is unchanged.
  - *Test:* an inactive teacher is hidden, a teacher with no roster row is shown, and a roster-only name is not shown.
- **R13** `uiBootstrap()` returns `rosterWarnings`: missing-from-roster, no Staff Code and no confirmed email. The panel and the grid status show them.
- **R14** `resolveContact_()` follows D7, with no prefix matching.
  - *Test:* the README §15.3 "Anita" case.
- **R15** The plan result lists "not notified: no confirmed contact".

### 7.4 Join keys in the Register

- **R16** The Register writer and readers locate columns by header name. Unknown headers are left blank in new rows.
  - *Test:* a shuffled-header fixture. Existing report and analytics tests still pass unchanged.
- **R17** At commit, each row's `Staff Code` is the locked roster code and its `Staff Email` is the confirmed roster Email. Anything else is left blank.
  - *Test:* one commit containing a fully keyed teacher, one with no code and one with no email.
- **R18** When any key is blank, the panel and grid show "Saved. N teacher(s) are missing Staff Code / email, so One Way can't match them exactly: …".
- **R19** `refreshLabels_()` appends `Staff Email` and `Staff Code` idempotently.
  - *Test:* three runs leave each header once, at columns 17 and 18.

### 7.5 Backfill (every Register row)

- **R20** `previewStaffKeyBackfill()` covers **every** Register row. It resolves each `Teacher` to a roster row by exact Display Name, including inactive and rename-chain rows. It writes only `🧾 Backfill Preview`.
- **R21** `applyStaffKeyBackfill()`:
  - takes a lock and backs up the workbook;
  - re-matches rows by `(Date, Teacher, Run ID)`;
  - fills **only blank** `Staff Code` and `Staff Email` cells, each column independently;
  - writes one `setValues` per column per chunk of 2,000 rows, so it can resume;
  - refuses if there is no preview or the preview is more than 24 h old;
  - refuses rows whose roster Staff Code is unlocked-changed or duplicated.

  *Test:* a second apply fills 0. A row deleted between preview and apply is skipped and reported.
- **R22** The backfill writes no Register column other than these two.
- **R22a** **Non-teaching backfill.** The same preview and apply also cover `🗓️ Non-Teaching Absence`. Rows are matched by `(Date, Teacher)`. Only blank `Staff Code` and `Staff Email` cells are filled, from the person's roster row, and only for code-required categories (e.g. an Admin row recorded before the code was accepted). Resource Person rows are skipped with the action `Name only`. No other column is written.
  - *Test:* an Admin row recorded before the code was accepted gets filled, and a second apply fills 0. A Resource Person row is untouched and listed as `Name only`.

### 7.6 Non-teaching absence

- **R23** The Teacher dropdown lists only Active non-teaching roster rows. It refreshes after sync, Apply and roster edits.
- **R24** onEdit fills Staff Code, Category, Staff Email (confirmed only), Timestamp and Marked By, in blank cells only. If the editor is unknown, Marked By stays blank and is shown amber. For a Resource Person, Staff Code and Staff Email stay blank and grey, never amber (D11).
  - *Test:* recording a Resource Person's absence leaves both key cells blank with no amber flag.
- **R25** No engine, report or analytics function reads `🗓️ Non-Teaching Absence`.

### 7.7 One Way contract

- **R26** `test/oneway-contract.test.js` asserts:
  - `SS.ABSENCE === '🗓️ Absence Register'` and `SS.NON_TEACHING === '🗓️ Non-Teaching Absence'`, as exact code points;
  - each name contains its contract substring (`'Absence Register'`, `'Non-Teaching Absence'`), and neither substring matches any other tab constant;
  - `ABSENCE_HEADERS.slice(0, 16)` equals the snapshot, `[16] === 'Staff Email'` and `[17] === 'Staff Code'`;
  - the non-teaching headers equal the snapshot;
  - the header row is 2 and data starts at row 3;
  - the eight Absence Type labels are unchanged.

  The test file names the One Way team as the people to tell before changing any of this.

### 7.8 HR Database source

- **R27** `readHrDatabase_()` reads only the header row and one single-column range for each field in `HR_DB_FIELDS`, located by the header names on Settings.
  - *Test:* a spy on `getRange` sees only the header row and whitelisted single columns.
- **R28** **Data minimisation.** No value from a non-whitelisted column reaches:
  - memory output;
  - any sheet (`🪪 Teachers`, `🪪 Roster Review`, `🧾 Sync Preview`, `🪪 Roster Log`, `🧾 Backfill Preview`, the Register, `🗓️ Non-Teaching Absence`);
  - `Logger` / `console`;
  - Chat payloads;
  - CacheService or Properties.

  *Test:* `test/hrdb-minimisation.test.js` with sentinel values, as in D9. Changing `HR_DB_FIELDS` without updating the test makes it fail.
- **R29** If the workbook cannot be opened, the tab is missing, or a required header is missing, the reader returns a friendly error that names the setting or the header, never the ID or a cell value. Preview continues without HR Database data, and nothing is thrown to the user.
  - *Test:* one fixture for each failure.
- **R30** Only rows whose Status is in the Status filter are used.
  - *Test:* a non-`Current` row is never proposed or linked.
- **R31** A Staff Code reaches the roster only through Apply on an accepted `Staff Code` or `Propose add` row (or hand entry for people not in the HR Database), and only into a blank cell. Confirmed-exact rows are pre-filled `Accept` unless they carry a pattern warning or a Category or corroboration conflict.
  - *Test:* clearing all decisions and applying writes no code. A pattern-failing exact match is not pre-filled.
- **R32** `Propose add` lists only `Current` HR rows that map to a non-teaching category and link to no roster row. Nothing is added without Accept.
  - *Test:* an HR row with an unmapped category is not proposed; a Teaching-category HR row is never proposed.
- **R33** **Dry-run read.** `🪪 Roster → Test HR Database read` writes nothing. Its dialog shows counts only:
  - rows read, and `Current` rows;
  - which whitelisted headers were found or are missing;
  - codes failing the pattern;
  - duplicate codes;
  - unmapped categories (category values are listed, since they are whitelisted).
- **R34** The HR read runs only from menu entry points, as the clicking user. No trigger calls it.
  - *Test:* a grep-style test.
- **R35** **Placeholders (D10).** Placeholder values from Settings are treated as empty in the HR Database `Staff Code` and `Official email ID` and in hand-typed roster cells. They are never written, never counted as duplicates, never reported as pattern errors, and never matched.
  - *Regression test:* a fixture with **several `N/A` rows** (plus `n/a`, `-`, `TBD` and blank), including Resource Persons. Expected:
    - zero duplicate-code reports;
    - zero pattern errors;
    - no `N/A` written to any output tab;
    - no R2 or corroboration hit on a placeholder email;
    - `Propose add` rows created with a blank code.
- **R36** **No invented codes; name-match-only respected (D11).** No code path writes a Staff Code that did not come from an accepted HR Database value or a human first-set or correction. No path writes a code or email to a name-match-only row.
  - *Test:* a grep-style test plus fixture. A Resource Person with `N/A` values ends a full preview and apply with a blank code and email, and produces zero Check roster findings and zero backfill writes. A manual code typed on that row is reported by Check roster and never used.

### 7.9 Non-functional

- **N1** A commit adds at most one cached roster read.
- **N2** A matching preview takes under 3 s at 2,500 × 100.
- **N3** No secrets and no real names, codes or emails in the repo.
- **N4** Dates are `yyyy-MM-dd` in `Asia/Kolkata`.
- **N5** Every menu entry point has a try/catch and calls `notifyOpsFailure_()` on failure.
- **N6** `node test/run.js` is green after every ticket.

---

## 8. One Way compatibility contract

| Frozen item | Value |
|---|---|
| Register tab | `🗓️ Absence Register`. **One Way must match by substring `Absence Register`**, tolerating the emoji prefix. |
| Non-teaching tab | `🗓️ Non-Teaching Absence`. **Matched by substring `Non-Teaching Absence`**. |
| Where these are frozen | `Constants.js` plus the contract test (R26). Renaming either tab requires One Way's sign-off. |
| Header row / first data row | Row 2 / row 3 on both tabs |
| Register headers One Way reads | `Date`, `Teacher`, `Absence Type`, `Periods Away`, `Marked By`, `Run ID`, `Staff Email` (new), `Staff Code` (new) |
| Non-teaching headers | `Date`, `Teacher`, `Absence Type`, `Periods Away`, `Marked By`, `Staff Email`, `Staff Code`, `Category`, `Timestamp`, `Notes` |
| **Match order** | **1. `Staff Code` → 2. `Staff Email` → 3. `Teacher` name.** A blank key means "not known; do not guess". Fall through to the next key. |
| `Date` | `yyyy-MM-dd` text |
| `Absence Type` | The eight labels. Historical rows may say `Unknown`. |
| `Staff Code` | Plain text, compared exactly after trimming. Never a placeholder such as `N/A`: a blank means no code. |
| **Resource Persons (name-match-only)** | They **never** have a Staff Code or email; the school will not issue them. **One Way must join them on the exact `Teacher` name (= roster Display Name) only.** Their `Staff Code` and `Staff Email` cells are always blank, by design and not as an error, and `Category` = `Resource Person` identifies them. The name is unique across the roster and never changes. |
| `Staff Email` | Lower-case address, or blank |
| Row identity | **Not stable.** Re-marking deletes the row and re-appends it with a new Run ID. Key on `(Date, Staff Code)`, falling back through the match order. |

Column positions are **not** part of the contract. Only header names are.

---

## 9. Rollout on the live workbook

Every step needs the user's go-ahead, and each step is verified before the next one starts.

| # | Step | Writes to | Verify | Rollback |
|---|---|---|---|---|
| 0 | Merge. `clasp pull` into a temp folder and diff. Push only after approval. | Script | Diff shows only intended changes; manifest unchanged | `clasp push` the previous tag |
| 1 | `💾 Backup workbook now` | Drive | Backup exists | — |
| 2 | `🔧 Upgrade tabs (safe)` | Creates 7 tabs; appends 2 Register headers (columns empty) | The first 16 Register headers are unchanged; One Way's next read succeeds | Delete the 7 tabs; clear the two new header cells |
| 2a | User types the HR Database settings on `🧭 Roster Settings` (workbook ID, confirmed Staff Code header). Then **`Test HR Database read` (dry run)**. | Settings (user-typed) only; the dry run writes nothing | Counts look right; every required header found; 7 of 7 columns whitelisted; pattern failures and duplicates listed | Clear the settings values |
| 3 | `🪪 Preview sync` → user reviews → `Apply sync` | `🪪 Teachers`, `🪪 Roster Log` | Row count = number of Allotment teachers; Check roster is clean apart from missing codes | Clear data rows on both tabs |
| 4 | `Preview matches` (Email, Staff Code and `Propose add`) → decisions → `Apply decisions` | `🪪 Roster Review`; `🪪 Teachers` Email, Staff Code (+ locked), Category, non-teaching Department/Team, new non-teaching rows, audit columns, log | Summary counts; Check roster: no duplicate codes or emails; no non-whitelisted value anywhere (spot check) | Restore the columns from the step-4 backup (taken by Apply), or clear Email, Match Status and both Staff Code columns, and delete the added non-teaching rows |
| 5 | Hand-enter codes only for rows still blank (people not in the HR Database) | `🪪 Teachers` Staff Code (+ locked, log) | Check roster: 0 missing | Clear those cells |
| 6 | Re-run `Preview matches` for anything left; Apply | As step 4 | Remaining Ambiguous and Unmatched rows are deliberate | As step 4 |
| 7 | New commits and non-teaching rows carry keys (live since step 0; values appear once 4–6 are done) | New Register rows | The next real commit shows both keys, with blanks in amber | None needed; a blank is the honest default |
| 8 | Contact-switch check: Check roster lists DM/email targets that would change | None | User accepts | Revert T-015 and push |
| 9 | `Preview backfill` → user approves → `Apply backfill` | Register `Staff Code` and `Staff Email` columns, blank cells only | A second preview shows 0 `Will fill` | Clear the values in those two columns, which hold nothing else, or restore from the step-9 backup |
| 10 | One Way switches to the Staff Code → Email → name join; Support Staff onboarded | One Way | Their reconciliation | Their side |

**Never touched by any step:** `⚙️ Config` rows, `🗂️ Log`, `👥 importHR`, `📄 Reports`, Register columns 1–16, and the **HR Database**, which is read-only and whitelisted. `setupAllTabs()` is never run.

---

## 10. Risks and estate rules

| Risk | Mitigation |
|---|---|
| A wrong email is confirmed and One Way marks the wrong person absent | Staff Code is matched **first**; fuzzy matches are never auto-accepted; email uniqueness; audit columns |
| A Staff Code is mistyped when first entered | Uniqueness check; the first set is logged; `Correct Staff Code` keeps a trail; One Way sees a blank rather than a guess while a row is unresolved |
| A Staff Code is edited by hand on a phone | Locked hidden column; mismatches block join writes and are reported |
| Staff Codes stay blank for a long time | Amber flags, Check roster list, a panel warning at mark time; Email and name still work as fallbacks |
| A Display Name is edited by hand | Sync detection; the engine uses the Allotment, so cover is unaffected |
| A new Allotment teacher has no roster row | Fail-open dropdown and banner |
| A teacher who has left keeps being offered | Sync proposes deactivation; manual toggle |
| An email-only departure signal wrongly deactivates someone | It never pre-ticks a deactivation (R3) |
| Removing prefix matching stops some DMs | Step 8 list; DM and email are off by default |
| Appended columns break One Way | One Way reads by header name; contract test; step 2 is checked against One Way's next read |
| A positional reader is missed | R16, shuffled-header fixture |
| The backfill races a live commit | Lock; matching by `(Date, Teacher, Run ID)`; blank-only writes; run outside 07:30–10:00 |
| Exclusion rules hide a real person | Excluded-only matches become Ambiguous; an allow list |
| Marked By can't be identified | Left blank, shown amber, typeable |
| Seven new tabs add clutter | Preview, Review and Log tabs are hidden when idle |
| **PII exposure from the HR Database** (family names, phones, personal IDs, addresses) | Single reader; frozen whitelist; per-column reads, so other columns never enter memory; no caching; counts-only logs and errors; minimisation test with sentinels (R28); this workbook holds whitelisted fields only, so its backups do too |
| The user lacks access to the HR Database | Friendly error, no crash; Email matching still works; a person with access runs the Staff Code step (R29) |
| HR Database headers drift (renamed or moved columns) | Lookup by header name only; header names editable on Settings; a missing required header is a named error, never a positional guess; the dry run (step 2a) is repeated before each termly preview |
| The HR Database ID leaks into the public repo | Stored only on the live Settings tab; never in fixtures or code; N3 review |
| An HR Database name links to the wrong person | Same ladder; fuzzy matches never auto-accepted; email corroboration or conflict shown; Staff Code uniqueness |
| HR Database Category disagrees with the Allotment | The Allotment wins for Teaching; the conflict is shown and nothing is written |
| `N/A` placeholders treated as real codes or emails (false duplicates, false matches, `N/A` written as a key) | Editable placeholder list; normalised to empty inside the reader; regression test with several `N/A` rows (R35) |
| Resource Persons can be matched by name only | A deliberate category rule (D11), stated in the contract; Display Names are unique and immutable; Check roster flags duplicates; `Category` tells One Way which rows are name-keyed |
| Someone types a made-up code for a Resource Person | Refused by Apply, onEdit and Correct Staff Code; any such code is reported by Check roster (R36) |
| Two Resource Persons share a display name, so a name-only key is ambiguous | Display Names are unique on the roster (a human disambiguates when accepting `Propose add`); the backfill matches the exact Display Name |

**Estate rules that apply:**
- **Secrets:** none added.
- **Header-name lookup:** R16, §5.1.
- **Batch I/O:** §5.1, R21.
- **Idempotent setup, including visuals:** R1, §6.1.
- **Config as sheet data, 5-minute cache:** D8, §6.9.
- **Server-side auth and actor recorded:** every write runs server-side and records `activeEmail_()`.
- **No silent failure:** N5, plus blank-and-flag instead of guessing.
- **Idempotent reruns:** R2, R8, R19, R21.
- **Honest state:** blank keys count as pending and show amber; previews carry "Data as of".
- **Regeneration keeps entered data:** R10.
- **Backups:** before Apply and before the backfill.
- **Time and dates:** `Asia/Kolkata`, `yyyy-MM-dd`.
- **Quotas:** no Directory API calls are added. The HR Database read is at most 8 range reads per run.
- **Auth and scopes:** the HR read uses the existing `spreadsheets` scope and the clicking user's own Drive access. The manifest is unchanged.

---

## 11. Acceptance criteria (feature level)

1. On a copy of the live workbook, `upgradeTabs()` creates the 7 tabs and the 2 Register headers, and no other cell changes (value diff per sheet).
2. After the sync, codes, matching and apply steps on the copy:
   - every Active row has a Staff Code;
   - every Active row whose category requires email has a `Confirmed` Email, or is listed as needing work;
   - no two unrelated Active rows share a code or an email.
3. Marking a fully keyed teacher absent writes both keys. A missing key is left blank and amber, and the coordinator is warned.
4. A teacher in the Allotment but not on the roster can still be marked absent.
5. A non-teaching person never appears in a teacher dropdown, a plan or a report. A Support Staff person with no email produces no Check roster error and joins on Staff Code.
6. No code path changes `Active` without a user-accepted proposal.
7. An approved backfill fills only blank cells in every Register row. A second apply fills 0.
8. The One Way contract test passes, and fails if any frozen item changes.
9. `node test/run.js` is green, and no real name, code or email appears in the repo.
10. The HR Database dry run writes nothing. After a full preview and apply on the copy, no non-whitelisted HR Database value appears in any tab of this workbook. This is checked by searching the copy for a sample of known sensitive values, done by the user and never recorded in the repo.
11. A user without access to the HR Database gets a friendly message, and Email matching still completes.
12. Several HR rows with `N/A` codes and emails produce no duplicate or pattern errors, and no `N/A` reaches any tab.
13. A Resource Person is onboarded through `Propose add` and appears in the non-teaching dropdown. Recording their absence leaves Staff Code and Email blank with no amber flag. Check roster and the backfill report nothing missing for them, and a duplicate Resource Person name is flagged.

---

## 12. Ops README outline (T-019, `docs/ROSTER-OPS.md`)

1. What the roster is: an overlay; the Allotment decides who teaches; Staff Code is the primary key and Email the secondary one.
2. Termly routine: Test HR Database read, then Preview sync, then Apply, then Preview matches (Email, Staff Code, Propose add), then decide, then Apply, then Check roster, then hand-enter any remaining codes.
2a. The HR Database: what is read (the whitelist) and what never is; who needs access; what to do when a header is renamed. Never paste the workbook ID anywhere but `🧭 Roster Settings`.
3. Staff Codes: required, unique, never reused; how to use `Correct Staff Code…`; reading `🪪 Roster Log`.
4. Making someone inactive: the departure signals, long leave, `Left On`, and why history stays joinable.
5. Renames upstream: the `Replaced By` chain and sharing a code.
6. Adding Admin, Support Staff and Resource Persons via `Propose add`. Email is optional where the category says so. Resource Persons are **name-match-only**: no code or email, ever, so choose their Display Name carefully, because it is permanent and must be unique. **Never make up a code** for anyone.
6a. Placeholder values (`N/A` and similar): what they mean and how to edit the list.
7. Confidence classes and Decisions.
8. Editing the categories, exclusions and allow list.
9. The backfill: preview, approve, apply, verify.
10. **Rollback per step** (the §9 table, in plain words).
11. The One Way contract (§8): substring tab match and match order. Tell the One Way team before changing any of it.
12. What is never touched.

---

## 13. Suggested ticket breakdown

The worker tags follow the four-question rule and are suggestions for the dispatcher to confirm.

- **Cross-review:** Sonnet reviews Codex's code, and Codex reviews Sonnet's.
- **Tests:** `haiku-worker` runs `node test/run.js` on every ticket.

| Ticket | Delivers | Depends on | Acceptance | Worker |
|---|---|---|---|---|
| **T-009** One Way contract | `test/oneway-contract.test.js`; `SS.NON_TEACHING` and `NON_TEACHING_HEADERS` (with Staff Code and Category); snapshots for both tab names, substrings and the two new Register headers | — | R26; a scratch rename makes the test fail | Codex |
| **T-010** Register header-map I/O | Register writer and readers by header name; idempotent append of `Staff Email` and `Staff Code` in `refreshLabels_()`; both written blank for now; amber CF on blank keys | T-009 | R16, R19; shuffled-header fixture; existing tests unchanged | Codex |
| **T-011** Roster tabs, sync, Active, Staff Code | Builders for `🪪 Teachers`, `🧭 Roster Settings` (with Categories, HR Database source, HR Database headers generated from `HR_DB_FIELDS`, and HR Category mapping), `🧾 Sync Preview` and `🪪 Roster Log`; Preview/Apply sync with deactivation proposals and the HR evidence signal; Staff Code lock plus `Correct Staff Code…`; `getRoster_()` with cache; `🧪 Check roster`; menu | T-009 | R1–R6; fixtures for the new, removed and edited name cases, an email-only signal, a code edit and a correction | sonnet-worker (identity keys, new-system structure) |
| **T-012** Matching engine (pure) | Normalisation, exclusions, ladder, uniqueness pass, classes, category-aware "No email expected". Also the HR Database target (§5.8): the ladder over T-020's whitelisted records; Staff Code pattern and uniqueness checks; Category mapping; corroboration/conflict evidence (skipped on placeholder emails); `Propose add` selection, including name-match-only Resource Persons (no code or email taken, even if present); placeholder rows excluded from the uniqueness and pattern checks | — (HR inputs are plain objects shaped like T-020's output, so it can run in parallel) | R7, R11, N2, R30–R32 (matching parts), R35 (matching parts) | sonnet-worker |
| **T-013** Review and Apply | `🪪 Roster Review` with `Link` kinds Email, Staff Code and Propose add; Preview that keeps decisions, with Confirmed-exact pre-filled `Accept` (except on pattern or conflict warnings); Apply with lock, backup, re-read of the HR Database through T-020, re-validation, blank-only Staff Code writes plus lock and log, `Propose add` row creation (Resource Persons added without code or email; Display Name uniqueness enforced), never writing a placeholder, and the `No email` rule | T-011, T-012, T-020 | R8–R10, R31, R32, R36; R28 sentinel check and R35 `N/A` fixture over the review and apply outputs | sonnet-worker |
| **T-014** Markable teachers and warnings | `getMarkableTeachers_()`; dropdown and `uiBootstrap()`; `rosterWarnings` covering missing roster row, code and email | T-011 | R12, R13 | Codex |
| **T-015** Contact resolution | `resolveContact_()` replaces `hrLookup_()`; header-name importHR read; "not notified" list; contact-change list in Check roster | T-011 | R14, R15 | sonnet-worker |
| **T-016** Join keys at mark time | The commit path writes the locked Staff Code and confirmed Email; R18 warnings in panel and grid | T-010, T-011 | R17, R18 | Codex |
| **T-017** Backfill (every row) | `🧾 Backfill Preview`; preview over all Register rows **and all `🗓️ Non-Teaching Absence` rows**; resumable, locked apply that fills blank Staff Code and Staff Email via name → roster row (Register keyed `(Date, Teacher, Run ID)`, non-teaching keyed `(Date, Teacher)`); Resource Person rows skipped as `Name only` | T-010, T-011, T-018 | R20–R22, R22a | sonnet-worker |
| **T-018** Non-Teaching Absence tab | Builder with the frozen headers; dropdowns; CF for duplicates and blank keys; onEdit fill-in (code, category, email, timestamp, Marked By, or blank and amber); Resource Person rows with blank, grey (not amber) key cells | T-009, T-011 | R23–R25 (including the R24 Resource Person case) | Codex |
| **T-019** Docs | `docs/ROSTER-OPS.md` (§12, including the HR Database section and the PII rules); README §5, §11 and §15.3 marked fixed; rollout and rollback; Help-tab wording handed to T-018 | T-013, T-017, T-018, T-020 | Review against this PRD; no real data, IDs or headers beyond the defaults | haiku-worker |
| **T-020** HR Database reader | `readHrDatabase_()` and frozen `HR_DB_FIELDS`; header-name mapping, header row, Status filter and source settings read from `🧭 Roster Settings` (T-011 seeds those ranges); per-column whitelisted reads; friendly access, tab and header errors; counts-only logging; placeholder normalisation from the Settings list (with counts per field); default headers `Staff Code` and `Official email ID`; `Test HR Database read` dry-run menu item; `test/hrdb-minimisation.test.js` with sentinel PII columns; `N/A` regression fixture including Resource Person rows; default pattern `^[SW]0[0-9]{3}$` | T-011 (Settings ranges, including Placeholder values and the Categories `Join key` column) | R27–R30, R33, R34, R35 (reader parts) | sonnet-worker (identity / PII) |

**Order:** T-009, then T-010, T-011 and T-012 in parallel, then T-020, then T-013, T-014, T-015, T-016 and T-018, then T-017 (now also after T-018), then T-019.

**Numbering:** no existing ticket was renumbered. The HR Database reader is appended as **T-020**, so T-009 to T-020 is contiguous and every number given earlier still means the same ticket.

---

## 14. Open questions

None. All questions are answered, and the decisions are recorded below.

### Decisions of record (answered earlier)

A1. **Staff Code format (answered).** `S0###` for Teaching and Admin staff, `W0###` for Support Staff: one letter, a zero, three digits. Resource Persons have no code. Implemented as an editable regex on `🧭 Roster Settings` (default `^[SW]0[0-9]{3}$`), never in code. The letter should agree with Category (S = Teaching/Admin, W = Support Staff); a disagreement is a **warning** in Check roster, not a block. The pattern was stated by the school and has **not** yet been checked against live data; Check roster's first run reports every code that fails it, which doubles as that check. Codes stay plain text.
A2. **Resource Persons and the Allotment (answered).** None are in the Allotment (consultants, not on payroll). They never go through Allotment sync. They **are** in the HR Database, with `N/A` code and email, and arrive via `Propose add`.

A5. **Resource Persons never get codes (answered, school decision).** They have no Staff Code and no email, ever. They are name-match-only (D11).

A4. **HR Database headers (answered).** `Staff Code` and `Official email ID`, editable on Settings, matched ignoring case and spacing.
A3. **Absence types for non-teaching staff (answered).** The same eight labels, so One Way sees one vocabulary. **Out of scope:** the school allots non-teaching staff *different quotas*. This PRD only records absences; quota tracking is a separate future feature and would be read from the Non-Teaching tab.
