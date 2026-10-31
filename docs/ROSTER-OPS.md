# Staff roster: operations guide

For the office and the ICT facilitator who run the roster, and for the One Way team and developers who depend on it.

Spec: [PRD-roster.md](PRD-roster.md). Where this guide and the PRD disagree, the code is what runs, and §9 says where that happens.

> **Public repo.** Every name, code and address here is a placeholder: `Asha Example`, `staff.a@example.test`, `S0001` (Teaching or Admin), `W0001` (Support Staff). Never paste real names, codes, emails, workbook IDs or HR data into this repo, a ticket, a chat or an email.

Menu paths below are `🔁 Substitutions → 🪪 Roster → …` unless stated otherwise.

---

## 1. What the roster is

The roster (`🪪 Teachers`) is an **identity overlay**. It says who each name really is: the Staff Code, the confirmed Workspace email, and the category. It does not say who teaches.

- **The Allotment decides who teaches.** The `📋 Allotment` tab in the timetable workbook is the authority. Teaching rows come only from the Allotment, through Preview sync and Apply sync.
- **Active only hides a name from the dropdown.** Untick it for long leave, or when someone leaves mid-term before the timetable is updated. It never changes whether the person exists, and their history still joins.
- **Staff Code is the primary join key.** Email is second. Name is used only for Resource Persons, who never get a code or an email.
- **Resource Persons are name-only.** Their Display Name is their key, so it must be unique and it can never change.
- **Non-teaching staff** (Admin, Support Staff, Resource Person) go on the `🗓️ Non-Teaching Absence` tab. Nothing on that tab feeds cover, the Log, the weekly report or analytics.
- **Nothing is guessed.** A missing Staff Code or email is left blank and shown amber. The system never makes up a code.

---

## 2. The tabs

Seven tabs are new. The Register is an existing tab that gained two columns.

| Tab | Purpose | You edit by hand | Code owns (do not type here) |
|---|---|---|---|
| `🪪 Teachers` | One row per person: the roster | Display Name (only when adding a non-teaching person), Category (non-teaching rows), **Active**, Staff Code (first set, only for people not in the HR Database), Left On, Replaced By, Notes, Department and Team (non-teaching rows) | In Allotment, Match Status, Confirmed By, Confirmed On, the hidden Staff Code (Locked). Email is set by Apply decisions, though a human can type one, which then reads as Needs review. Department and Team on Teaching rows are mirrors of the Allotment, set by sync. |
| `🧭 Roster Settings` | Categories, HR Database source (Workbook ID, tab, header row, Status filter, Staff Code pattern), HR Database header names, HR Category mapping, Placeholder values, Allow list, Exclusions | Everything on the tab. Add rows only inside a block's blank space. | Nothing. The Field column of the HR Database headers block is fixed by code. |
| `🧾 Sync Preview` | What Preview sync found, with a Decision for each row | **Decision** (Apply or Skip) | Display Name, Change, Evidence, Proposed, Result |
| `🪪 Roster Review` | Email, Staff Code and Propose add candidates from Preview matches | **Decision**, Manual Email / Code, Display Name override (Propose add rows only), Notes | Everything else, including Result. Key, Basis and Prefilled are hidden. |
| `🪪 Roster Log` | Append-only audit trail of every roster change | Nothing. Do not edit. | Everything |
| `🧾 Backfill Preview` | Every Register and Non-Teaching row, and what the backfill would fill | Nothing | Everything |
| `🗓️ Non-Teaching Absence` | One row per non-teaching absence | Date, Teacher (dropdown), Absence Type (dropdown), Periods Away, Notes | Staff Code, Category, Staff Email, Timestamp and Marked By, filled automatically from the roster when Teacher is entered |
| `🗓️ Absence Register` (existing) | The cover register that One Way reads | Nothing new | Staff Email and Staff Code (the two new columns, at the end). Written when a teacher is marked. Blank cells are filled only by the backfill. |

Four of the new tabs (`🧾 Sync Preview`, `🪪 Roster Log`, `🪪 Roster Review`, `🧾 Backfill Preview`) are hidden when first built and shown when you use them. The roster tabs are protected with warning-only protection, so a warning on some edits is expected. Click through it only if the edit is one you mean to make.

---

## 3. Day-to-day tasks

### 3.1 Add a new teacher

The teacher must come from the Allotment. Do not type a Teaching row by hand; Check roster flags one.

1. The person who maintains the Allotment adds the teacher to `📋 Allotment` in the timetable workbook.
2. `🔁 Substitutions → 🪪 Roster → 👁 Preview sync`. On `🧾 Sync Preview` the teacher is an **Add** row with Decision **Apply**. Set it to **Skip** if you do not want it yet. Nothing on `🪪 Teachers` has changed.
3. `🪪 Roster → ✅ Apply sync`. A Teaching row is added, Active is ticked, and the change is logged. Apply sync takes no backup (see §4, step 3).
4. `🪪 Roster → 🔗 Preview matches`, then `🪪 Roster → 🪪 Open Roster Review`. Confirmed matches are pre-filled **Accept**. Check the Email and Staff Code rows and change any Decision you disagree with.
5. `🪪 Roster → ✅ Apply decisions`. The backup is taken first.
6. `🪪 Roster → 🧪 Check roster`. If the teacher still has no code, they are not in the HR Database link. Enter the code by hand on `🪪 Teachers` (see §4, step 5), then check again.

Until step 3, the teacher is still offered in the Mark Absence dropdown, with a banner that says they are not on the roster yet.

### 3.2 A teacher leaves, or goes on long leave

**Long leave (still in the Allotment):** on `🪪 Teachers`, untick **Active**. The name leaves the dropdown. The Allotment does not change. Tick Active again when they return.

**Leaving the school:**
1. The Allotment maintainer removes the person from `📋 Allotment`.
2. `🔁 Substitutions → 🪪 Roster → 👁 Preview sync`. The person is a **Not in Allotment** row with Decision **Apply**. Set it to **Skip** if you disagree.
3. `🪪 Roster → ✅ Apply sync`. Active becomes FALSE on that row. No human column is changed, and nothing is deleted.
4. Optionally type the last working day in **Left On** (`yyyy-mm-dd`). It is for information and the audit trail only.

Their Staff Code and Email stay on the row, so their history still joins.

### 3.3 A name changes in the Allotment

Display Names are never edited by a tool, and an edited name is flagged as "probable edited Display Name".

1. `🪪 Roster → 👁 Preview sync`. The new spelling is an **Add** row, and the old spelling is a **Not in Allotment** row.
2. `🪪 Roster → ✅ Apply sync`. The new Teaching row is added, and the old row becomes Active FALSE.
3. On the **old** row in `🪪 Teachers`, type the **new** Display Name in **Replaced By**. It must match a Display Name on the tab exactly.
4. `🪪 Roster → ✏️ Correct Staff Code…`. Enter the **new** Display Name, the **same** code as the old row, and a reason such as "renamed in Allotment". The code is accepted because the old row is inactive and Replaced By points at the new row. Do step 3 first, or the code is refused.
5. `🪪 Roster → 🔗 Preview matches`, then decide and Apply decisions, so the new row gets its Email.
6. `🪪 Roster → 🧪 Check roster`. There should be no duplicate code and no "probable edited Display Name".

### 3.4 Add an Admin, Support Staff or Resource Person

**If the person is in the HR Database (preferred):**
1. `🔁 Substitutions → 🪪 Roster → 🔗 Preview matches`. People who are Current in the HR Database, map to a non-teaching category, and are not on the roster appear as **Propose add** rows.
2. Check the category and the Display Name. For a Resource Person, make sure the name is unique: it is their only key, and it cannot be changed later. If two people share a name, type a distinguishing name in **Display Name override** (for example, an initial).
3. Type **Accept** in Decision, then `🪪 Roster → ✅ Apply decisions`.
4. The new row is written with Category, Department and Team. An Admin or Support Staff row also gets the HR Database code, if it is valid and not already in use. **Resource Person rows never get a code or an email**, even if the HR Database holds one.
5. The Non-Teaching Absence Teacher dropdown is refreshed by Apply, so the new person can be picked straight away.

**HR Category mapping must match the HR sheet's spelling.** `🧭 Roster Settings → HR Category mapping` links each HR Category value to a roster category. The shipped default for admin staff is `Administrative staff` (it was `Administration` before; existing sheets keep whatever they already have, so check yours). Case and extra spaces do not matter, but the words must. A Current HR person whose category is not in the mapping cannot be proposed. After Preview matches, each such category shows as an information row on `🪪 Roster Review` (Link Propose add, Class Unmapped category) with a count and no names. Add a mapping row for it and Preview again; the information row goes away. An information row cannot be applied.

**If the person is not in the HR Database:**
1. Add a row on `🪪 Teachers`: Display Name (unique, spelled exactly as you will type it on the Non-Teaching tab), Category (Admin, Support Staff or Resource Person), Active ticked.
2. Admin needs a confirmed Email. Get one with Preview matches. Support Staff does not need one.
3. For Admin and Support Staff only, type the Staff Code in the **Staff Code** cell. It is locked on the next edit to `🪪 Teachers`. Use a real code the school has issued. Never make one up.
4. Run `🧪 Check roster`.

### 3.5 Record a non-teaching absence

1. Open the `🗓️ Non-Teaching Absence` tab.
2. Type the **Date** as `yyyy-mm-dd`, for example `2026-10-26`.
3. Pick **Teacher** from the dropdown. It lists Active Admin, Support Staff and Resource Person rows. The dropdown refuses any other name. If a name gets in anyway (for example by paste), its keys stay blank and no Timestamp is written.
4. Pick **Absence Type** from the dropdown.
5. Type **Periods Away** if you need to. It is optional.
6. The **Staff Code**, **Category**, **Staff Email**, **Timestamp** and **Marked By** fill in by themselves.
   - Amber **Marked By**: the system could not see who you are. Type your email in that cell.
   - Amber **Staff Code** or **Staff Email**: the roster row is missing it. Tell the ICT facilitator.
   - Grey **Staff Code** on a Resource Person is normal. They are matched on name only.
7. A **red** row is a duplicate: the same Date and Staff Code, or the same Date and Teacher when there is no code. The system never deletes it. If it is a genuine mistake, clear the extra row yourself and tell the ICT facilitator.

Non-teaching absences are never covered, never counted in fairness, and never appear in the weekly report or analytics.

### 3.6 Correct a Staff Code

Use this only when a code is wrong, not when it is blank.

1. `🔁 Substitutions → 🪪 Roster → ✏️ Correct Staff Code…`.
2. Enter the Display Name exactly as it appears on `🪪 Teachers`, the new code, and a reason. The reason is written to the log.
3. The tool checks that the name is unique, that the code is not already held by another row, and that the category takes codes. It updates both the Staff Code and the hidden locked copy, and logs the change with Source **Correction**.

A correction does **not** rewrite codes already written into `🗓️ Absence Register` or `🗓️ Non-Teaching Absence` rows. Those keep the old code. Read `🪪 Roster Log` to see what changed and when.

---

## 4. First-time rollout on the live workbook

Each step needs the ICT facilitator's go-ahead. Check the step's result before you go on. Never run `🛠️ Rebuild all tabs (ERASES data)`. It is the destructive rebuild and is not part of this rollout.

Each step says what it writes, what it never touches, and how to undo it.

**Step 0. Code deploy (developer, not the office).** The code is merged and pushed by a developer, after a `clasp pull` diff (see §10.4). The manifest does not change: no new OAuth scope is needed. Live rows are not changed by the deploy itself.

**Step 1. Back up.** `🔁 Substitutions → 💾 Back up this workbook now`.
- Writes: a copy of the whole workbook in the **Backups** folder inside the reports folder, named "… — backup yyyy-mm-dd HHmm (manual)".
- Never touches: the workbook.
- Check: the copy exists in Drive.
- Undo: keep the copy. It is your rollback for steps 2 to 9.

**Step 2. Upgrade tabs, safe mode.** `🔁 Substitutions → 🔧 Upgrade tabs (safe — keeps data)`. Only this item.
- Writes: creates the seven tabs (`🧭 Roster Settings`, `🪪 Teachers`, `🧾 Sync Preview`, `🪪 Roster Log`, `🪪 Roster Review`, `🗓️ Non-Teaching Absence`, `🧾 Backfill Preview`). Appends the headers **Staff Email** and **Staff Code** to the Register's row 2, in columns 17 and 18. It also rebuilds the Console and Help tabs (instructions only), refreshes the chrome of Mark Absence and the Register, and re-installs the triggers. If an older absence-type migration is still pending, it takes its own backup first.
- Never touches: existing data rows, the Register's columns 1 to 16, Config values, `🗂️ Log`, `👥 importHR`, `📄 Reports`.
- Check: Register headers 1 to 16 are unchanged, and the next One Way read still succeeds.
- Undo: delete the seven new tabs and clear the two new Register header cells. This loses anything typed on the new tabs, so restore from the step 1 copy if there is any work to keep.

**Step 2a. Type the HR Database settings, then a dry run.**
1. On `🧭 Roster Settings`, under **HR Database source**, type the **Workbook ID** of the HR Database. Check **Tab** and **Header Row**. Under **HR Database headers**, check that the **Header Name** for Staff Code and Official email ID matches the HR sheet.
2. `🔁 Substitutions → 🪪 Roster → 🧪 Test HR Database read`.
- Writes: only the settings you typed. The read writes nothing to any tab.
- Never touches: the HR Database, which is read only.
- Check: the dialog shows rows read, Current rows, headers found and missing, placeholders, codes failing the pattern, duplicate codes, and unmapped categories. The sample shows initials and a masked code only. Every required header is found. Seven of seven fields are whitelisted.
- Undo: clear the Workbook ID cell.

**Step 3. Sync the roster to the Allotment.**
1. `🔁 Substitutions → 🪪 Roster → 👁 Preview sync`.
2. Review `🧾 Sync Preview`. Set each row to Apply or Skip.
3. `🪪 Roster → ✅ Apply sync`.
- Writes: `🪪 Teachers` (new Teaching rows, Active FALSE on accepted Not in Allotment rows, In Allotment, and Department and Team on Teaching rows) and `🪪 Roster Log`.
- Never touches: any human column, the Register, the Log, `👥 importHR`, the HR Database.
- Takes **no backup**. Step 1 is the rollback.
- Check: the number of Teaching rows equals the number of Allotment teachers. Check roster reports only missing codes and emails.
- Undo: in `🪪 Roster Log`, find the rows with Source **Sync**. Clear each "Added" row, and set each Active FALSE back to TRUE.

**Step 4. Match emails, codes and new people.**
1. `🔁 Substitutions → 🪪 Roster → 🔗 Preview matches (Email · Staff Code · Propose add)`.
2. `🪪 Roster → 🪪 Open Roster Review`. Read the summary. Set each Decision: **Accept** (pre-filled for confirmed exact matches), **Pick 2**, **Pick 3**, **Enter email**, **Enter code**, **No email**, or **Ignore**.
3. `🪪 Roster → ✅ Apply decisions`. The backup is taken first. If the backup fails, you are asked whether to continue without one. Only an explicit **Yes** continues. Any other answer stops, and nothing is applied.
- Writes: `🪪 Roster Review` (Result column), then `🪪 Teachers` (Email with Match Status Confirmed, Staff Code with the locked copy, Category, and Department and Team on non-teaching rows, plus new non-teaching rows for Propose add), and `🪪 Roster Log`.
- Never touches: the HR Database (read only), a non-empty Email or Staff Code (refused, never overwritten), the Register, the Log, `👥 importHR`.
- Check: summary counts. Check roster reports no duplicate code and no duplicate email on Active rows. Spot-check that no value you did not expect is on the tabs.
- Undo: restore the affected cells from the step 4 backup (§7.2), or clear Email, Match Status, Confirmed By, Confirmed On, Staff Code and Staff Code (Locked) on the rows the log lists, and delete any non-teaching rows the log says were added.

**Step 5. Enter codes for people who are still blank.** Only for people who are **not** in the HR Database, or whose HR code cell is a placeholder.
- Type the code in the **Staff Code** cell of `🪪 Teachers`. The hidden locked copy is set on the next edit to that tab, and the change is logged as **First set**.
- Writes: `🪪 Teachers` Staff Code, then the locked copy, and `🪪 Roster Log`.
- Check: `🧪 Check roster` shows no "no Staff Code" warnings for Admin, Teaching or Support Staff rows. Resource Persons never need one.
- Undo: clear the Staff Code cell and its hidden Staff Code (Locked) copy. Unhide the column first.

**Step 6. Re-run the match for anything left.** Repeat step 4 for remaining rows. Ambiguous and Unmatched rows that you do not resolve are deliberate. Leave them.

**Step 7. New marks carry keys.** Automatic from the first Mark Absence commit after the code is live. A blank key is the honest default, and it shows amber.
- Undo: none needed.

**Step 8. Contact-switch check.** `🪪 Roster → 🧪 Check roster` lists "Contact change" lines where the roster email differs from `👥 importHR`. Information only. The roster email is the one used for notifications. The ICT facilitator decides whether each one is right.
- Writes: nothing.

**Step 9. Backfill the existing rows.**
1. `🪪 Roster → 👁 Preview backfill`. Review `🧾 Backfill Preview`, especially the **Action** column. Check the count of **Will fill**.
2. `🪪 Roster → ✅ Apply backfill`. Run it outside 07:30 to 10:00, when nobody is marking absences. The dialog reminds you.
3. Preview again. The Will fill count must be 0.
- Writes: only the blank Staff Code and Staff Email cells in `🗓️ Absence Register` and `🗓️ Non-Teaching Absence`, and `🪪 Roster Log`. Each column is written separately, in chunks.
- Never touches: any other column, and any cell that already has a value.
- Takes a backup first. A preview more than 24 hours old is refused.
- Undo: see §7.3.

**Step 10. One Way switches its join.** One Way moves to Staff Code, then Staff Email, then name. This is One Way's own change. Their side.

**Never touched by any step:** `⚙️ Config` rows, `🗂️ Log`, `👥 importHR`, `📄 Reports`, Register columns 1 to 16, and the HR Database.

---

## 5. The HR Database

### 5.1 What it is and what it is read for

The HR Database is a separate Google Sheet, held by the school. It is **sensitive**: it holds personal data about staff. It is the school's source for:

- **Staff Codes**, linked to roster rows, which a human then accepts;
- **Category**, for proposing new non-teaching people;
- **Department** and **Team / Role**, for non-teaching rows;
- **Official email**, used only as corroboration. It is never written as the roster email. The roster email still comes from `👥 importHR`.

The reader is `readHrDatabase_()`. It is the only code that opens the HR Database. It runs only when a person clicks a roster menu item, as that person. No trigger reads it, and nothing is cached.

### 5.2 The seven fields it reads

These are the only columns the code ever reads. The list is fixed in code.

| Field | Default header | Required |
|---|---|---|
| status | `Status` | yes |
| name | `Name of the Staff` | yes |
| category | `Category` | yes |
| teamRole | `Team / Role` | no |
| department | `Department` | no |
| staffCode | `Staff Code` | yes (the column must exist; cells may be placeholders) |
| officialEmail | `Official email ID` | no (without it, email corroboration is reported as unavailable) |

Header names are matched ignoring case and extra spaces. A required header that is missing is reported by name, never guessed by position.

### 5.3 What is never read

**No other column is ever read.** Family names, contact numbers, personal IDs, addresses and any other column stay in the HR Database. The reader reads the **header row**, which gives column names only, then one single-column read for each of the seven fields. Values from other columns never reach memory, a sheet, a log, a Chat message or a backup.

### 5.4 Header mapping and placeholders on Roster Settings

- **HR Database source** block: the Workbook ID, Tab (default `CurrentStaff`), Header Row (default `1`), Status Filter (default `Current`) and Staff Code Pattern (default `^[SW]0[0-9]{3}$`, meaning one letter S or W, a zero, and three digits).
- **HR Database headers** block: the Field column is fixed. Change only the **Header Name** when the HR Database renames a column. Do not add rows. Any extra row is ignored and reported.
- **Placeholder values** block: a value here means "no value" in a Staff Code or Email cell. The default list is blank, `N/A`, `NA`, `n/a`, `-`, `none`, `nil` and `TBD`. A blank cell is always a placeholder. Case and surrounding spaces are ignored.
  - A placeholder is never written to the roster, the Register or the non-teaching tab.
  - It is never counted as a duplicate, never a pattern error, and never a match.
  - To add a value, type it on a new row in the block.

If a header is renamed in the HR Database: update the **Header Name** on Roster Settings, then run `🧪 Test HR Database read`. Do not work around it by moving columns.

### 5.5 Who needs access

The reader uses the **Drive access of the person who clicks the menu**. That person must be able to open the HR Database. If they cannot, they see a friendly message and no data. Email matching still works. A person with access (the ICT facilitator, or an HR-office colleague they trust) runs the Staff Code step.

### 5.6 PII rules

- **Do not widen the header mapping.** Do not add a field, or point an existing field at another column, to pull in more data. A new field needs a code change, and the minimisation test (`test/hrdb-minimisation.test.js`) must still pass.
- **Keep the Workbook ID on Roster Settings only.** Never paste it into a chat, a ticket, an email, a document, a test fixture or the repo.
- **Protect Roster Settings.** The code does not protect this tab. The ICT facilitator should restrict who can edit it in Sheets (Data → Protect sheets and ranges).
- **Never paste HR data anywhere.** That includes names, codes and emails copied from the HR Database. In any written example, use placeholders.
- **Messages show counts only.** The Test read and the logs show counts, initials and masked codes. The ops alert sends the function name and error class only.
- **The review tab shows some HR data.** `🪪 Roster Review` shows the HR category, department, team and official email of the people being matched. These are whitelisted, but they are still personal data. Share the workbook only with the people who need it.
- **Backups copy this workbook only.** Because only whitelisted values reach this workbook, its backups hold only those values.

---

## 6. The One Way contract

For the One Way team. These names and layouts are frozen. Changing any of them needs One Way's sign-off first. `test/oneway-contract.test.js` fails if one changes.

| Item | Contract |
|---|---|
| Register tab | Name contains `Absence Register` (currently `🗓️ Absence Register`). Match on the substring, ignoring the emoji prefix. |
| Non-teaching tab | Name contains `Non-Teaching Absence` (currently `🗓️ Non-Teaching Absence`). |
| Header row and data | Row 2 is the header. Data starts at row 3. On both tabs. |
| Register headers | 18 columns, in this order: `Timestamp, Date, Day, Week, Teacher, Department, Team, Absence Type, Periods Away, Periods Scheduled, Periods To Cover, Covered, Uncovered, Cover Reassigned, Run ID, Marked By, Staff Email, Staff Code`. Columns 1 to 16 are unchanged. Column 17 is Staff Email and column 18 is Staff Code. |
| Register fields One Way reads | `Date`, `Teacher`, `Absence Type`, `Periods Away`, `Marked By`, `Run ID`, `Staff Email`, `Staff Code`. Read by header name, never position. |
| Non-teaching headers | In order: `Date, Teacher, Absence Type, Periods Away, Marked By, Staff Email, Staff Code, Category, Timestamp, Notes`. |
| Date | `yyyy-MM-dd`, stored as text. |
| Absence Type | One of the eight labels: `Leave - Full day`, `Leave - Morning`, `Leave - Afternoon`, `Permission`, `OD - Full day`, `OD - Morning`, `OD - Afternoon`, `OD - Periods`. Historical rows may say `Unknown`. |
| Match order | 1. `Staff Code`, 2. `Staff Email`, 3. `Teacher` name. A blank key means "not known; do not guess". Fall through to the next key. |
| Staff Code | Plain text, compared exactly after trimming. Never a placeholder such as `N/A`. Blank means no code. |
| Staff Email | Lower-case address, or blank. |
| Resource Persons | Category is `Resource Person`. They never have a Staff Code or Email, by design, and that is not an error. Join them on the exact `Teacher` name, which equals the roster Display Name. The name is unique and never changes. |
| Non-teaching rows | There is no Run ID. Duplicates are shown red and never deleted. |
| Row identity | **Not stable.** Re-marking a teacher deletes her Register row and appends a new one with a new Run ID. Row numbers and Run IDs change. Key on `(Date, Staff Code)`, then fall back through the match order. Do not key on row number or Run ID. |
| Backfilled rows | The backfill fills blank keys in existing rows. A row read before a backfill may later have keys, so re-read it rather than caching the blanks. |

Column positions are not part of the contract. Header names are. The contract test also checks the first six Register positions and the full 18-column list.

---

## 7. Rollback

### 7.1 What each Apply writes, and how to undo it

| Action | Rows written to 🪪 Roster Log (Source) | Backup first? | Where the backup reference is | How to undo |
|---|---|---|---|---|
| Upgrade tabs (safe) | None | Only if an absence migration is pending | The dialog after the migration | Step 2 undo (§4) |
| Apply sync | **Sync**: Active FALSE, In Allotment, Department and Team, and "Added" rows | **No** | Roster Log only | Set Active back to TRUE on the rows logged. Clear the rows logged as "Added". |
| First-set lock (any edit to 🪪 Teachers) | **First set** | No | Roster Log | Step 5 undo (§4) |
| Correct Staff Code | **Correction**: old and new code, and reason | No | Roster Log | Correct again to the old code, if no other row holds it |
| Apply decisions | **Apply** and **HR Database**: Email, Match Status, Staff Code, Category, Department, Team, Row added | **Yes**, "before roster decisions" | The result dialog shows the backup name. It is in the Backups folder. | §7.2 |
| Apply backfill | **Backfill backup** (backup name and id), then **Backfill cells** (one per tab and column) | **Yes**, "before staff-key backfill" | `↩️ Backfill rollback info` | §7.3 |

Roster Log is append-only. Undo means a new, deliberate change, not deleting the log.

### 7.2 Restoring cells from a backup (Apply decisions)

Do **not** restore the whole workbook. That would also roll back the Register and everything else since the backup.

1. In Drive, open the Backups folder inside the reports folder. Open the file named "… backup yyyy-mm-dd HHmm (before roster decisions)".
2. In `🪪 Roster Log`, find the rows written by that Apply, and note the rows and fields they touched.
3. On the backup copy, copy only those cells from `🪪 Teachers`.
4. In the live workbook, paste as **values only** (Edit → Paste special → Values only) into the same cells.

### 7.3 The backfill rollback

`🔁 Substitutions → 🪪 Roster → ↩️ Backfill rollback info` shows the backup name, its id, and how many cells changed since.

- The two key columns held nothing before a backfill, because it fills blank cells only. To undo, clear **only** the cells that `🪪 Roster Log` lists as **Backfill cells**.
- Clearing those cells also removes any key written by a live mark since the backfill. Check the log and the Register before you clear.
- To restore the whole backup instead, do so only after the ICT facilitator agrees. Every change made since the backup is lost.

---

## 8. Troubleshooting

Messages are quoted as the code shows them. The grid status and the side panel use the same wording.

| Symptom (message) | Usually means | Fix |
|---|---|---|
| "not on the 🪪 Teachers roster yet" / "not on the 🪪 Teachers roster (run 🪪 Sync roster)" | An Allotment name has no roster row. The teacher can still be marked. | `Preview sync`, then `Apply sync`. There is no menu item called "Sync roster". Use Preview sync and Apply sync. |
| "without a Staff Code" / check roster: "no Staff Code" | The code is not linked yet. | `Preview matches`, then Accept the Staff Code. Or enter it by hand if the person is not in the HR Database. |
| "Staff Code changed without a correction (locked X, now Y)" | Someone edited a locked code. | Put the locked value back. If it is really wrong, use `Correct Staff Code…`. |
| "Staff Code X is not locked yet" | A typed code has not been locked. | Make any edit on `🪪 Teachers` and check `🪪 Roster Log` for First set. If it stays unlocked, the installable trigger is missing. Run `🔧 Upgrade tabs (safe)`, which re-installs it. |
| "Staff Code X is held by more than one person" / "already belongs to …" | A code is on two rows, outside a rename chain. | Find the other row. If it is a rename, set Replaced By (§3.3). Otherwise correct the wrong row. A code is never reused. |
| "Staff Code X does not match the pattern …" | The code is not `S0###` or `W0###`. | Check the HR Database value. The check is a warning. Apply accepts it with an explicit Accept, logged as "[pattern warning]". Change the pattern only if the school changes its format. |
| "does not start with S/W…" | The prefix does not match the category on Roster Settings. | Check the category, and the code, against the school's records. Warning only. |
| "… is a placeholder and is treated as blank" | `N/A` or similar is typed in a code or email cell. | Clear the cell. |
| "… is the Display Name of N rows" | Two rows share a Display Name. | Names must be unique. Display Names are never edited by a tool, so agree the fix with the ICT facilitator. |
| "… is an Active Teaching row that is not in the Allotment" | The teacher was removed from the Allotment, or the name differs. | Preview sync. If the Allotment spelling is different, see the next row. |
| "probable edited Display Name; the Allotment spells it …" | The name was typed differently from the Allotment. | Set it back to the Allotment spelling, or follow §3.3 if the Allotment really changed. |
| "… has no email, and … needs one" | An Admin or Teaching row has no confirmed email. | `Preview matches`, then Accept or Enter email. |
| "the typed email … is not in 👥 importHR" | The address is not a Workspace account. | Check the spelling. The address must exist in `👥 importHR`. |
| "Refused: that account is excluded as a non-person" | The account looks like a shared or device account. | If it is a real person, add the address to the Allow list on Roster Settings. |
| "Refused: this row already has a Staff Code … never overwritten" | A code is already set. | Use `Correct Staff Code…` (§3.6). |
| "Refused: this row already has a different email" | An email is already set and differs. | If the old value is wrong, clear the Email cell by hand, then run Preview matches and Apply decisions again. |
| "Refused: more than one row has this key (duplicate Display Name)" | A name is duplicated. | Fix the duplicate name first. |
| "Stale: that code is no longer on a current HR Database row" / "Changed since you decided: re-check" | The HR Database or roster changed after the preview. | Run Preview matches again. |
| "Refused: the HR Database could not be read just now" | A read failed. | Try again. Check that you have access. |
| "You don't have access to the HR Database …" | The person clicking cannot open it. | Ask the HR office to share it, or ask someone with access to run it. Email matching still works. |
| "The HR Database is missing the required column header …" | A header was renamed. | Update the Header Name on Roster Settings, then run Test HR Database read. |
| "The HR Database has no tab with the name set …" | The tab was renamed. | Update Tab on Roster Settings. |
| "No HR Database is set …" | Workbook ID is blank. | Type it on Roster Settings. Nowhere else. |
| "Nothing was changed. [tab] is missing header(s): …" | A tab's header row was edited. | Run `🔧 Upgrade tabs (safe)`. It appends missing headers and keeps the data. |
| "The 🪪 Teachers tab is missing. Run 🔧 Upgrade tabs (safe) first." | The tab does not exist. | Run `🔧 Upgrade tabs (safe)`. |
| "Another roster change is running. Wait a minute and try again." | Another roster write holds the lock. | Wait, then try again. |
| "Nothing to apply. Run Preview backfill first." / "The preview is more than 24 hours old." | No preview, or it is stale. | Run Preview backfill again. |
| Backfill action "Conflict (differs)" | The cell holds a different value from the roster. | Not overwritten. Decide by hand which is right. |
| Backfill action "No roster match" | The Teacher name is not on the roster. | Add or sync the person. |
| Backfill action "Duplicate name" | The name is duplicated or ambiguous. | Fix the roster names. |
| Backfill action "Code not locked" / "Email not confirmed" | The roster value is not yet locked or confirmed. | Fix that first (Check roster, Preview matches). |
| Register: "Saved. N teacher(s) are missing Staff Code / email, so One Way can't match them exactly" | Keys are blank for those teachers. | Fix the roster. The key stays blank until it is fixed, then backfill fills it. |
| Non-teaching: Marked By amber | The editor could not be identified. | Type your email. |
| Non-teaching: Staff Code or Email amber | The roster row is missing it. | Tell the ICT facilitator. |
| Non-teaching: red row | A duplicate Date and Staff Code (or Date and Teacher). | Check it. Clear it yourself if it is a mistake. |
| Non-teaching: keys do not fill in | The installable trigger is missing. | `🔧 Upgrade tabs (safe)`, or `🔁 Substitutions → 📝 Mark-Absence tab → ⚡ Enable tick-to-run`. |
| Non-teaching: a name is missing from the dropdown | The person is not Active, is not on the roster, or is in the Teaching category. | Check the roster row. |
| Review: an "Unmapped category" information row | Current HR people have a category that is not in the HR Category mapping, so they are never proposed. | Add a mapping row on `🧭 Roster Settings` using the HR sheet's exact spelling, then Preview matches again. |
| "Could not save a backup" / "the backup could not be saved" | Drive could not save the copy. | Nothing was changed. Try again later, or take the backup by hand first. |
| "Roster Settings has no teaching category" / "exactly one row with Teaching? = TRUE" | The Categories table lost its Teaching row. | Restore the row, with Teaching? TRUE for Teaching only. |
| "Category X is not in the Categories table" | A category is misspelt or blank. | Pick the category from the dropdown. |
| "Staff Code Pattern is not a valid expression; the default is used" | The pattern on Settings is broken. | Fix the pattern on Roster Settings. |
| "The Allotment could not be read, so the checks against it were skipped." | The source workbook is not connected. | `🩺 Check source connection` (Substitutions menu). |

---

## 9. Known limitations

Only things that are true of the code and the workbook.

1. **Not yet run on a live Sheet.** The formulas, validations, conditional formats and protections are tested against a mock (`test/sheetmock.js`), not a real Sheet. The first live run should be on a copy, or watched closely.
2. **The Staff Code pattern is a warning, not a block.** A code that does not match is flagged, and Apply writes it only on an explicit Accept, logged as "[pattern warning]".
3. **The HR Database header names and pattern are defaults.** They have not been checked against the live HR Database. The first `🧪 Test HR Database read` is that check.
4. **Apply sync takes no backup.** Take one first (rollout step 1).
5. **Default Decisions on sync rows are Apply.** The Add and Not in Allotment rows on `🧾 Sync Preview` default to Apply. Nothing changes until you press Apply sync, but set the row to Skip to refuse it.
6. **Non-teaching keys are overwritten, not filled, when Teacher is changed.** The PRD says "fill blank cells only". The code overwrites Staff Code, Category and Staff Email every time Teacher is edited, so a key cannot carry over to another person. A typed name that is not on the roster blanks those keys. Timestamp and Marked By fill only when blank.
7. **Hand-typed codes lock on the next edit,** not on entry. Until then the code is "not locked yet", and no Register row takes it.
8. **Correct Staff Code does not change history.** Old Register and non-teaching rows keep the old code. The backfill fills only blank cells, so it does not fix them either. The PRD leaves a history correction as a later job.
9. **A wrong message names a menu item that does not exist.** The grid status and the side panel say "run 🪪 Sync roster". Use Preview sync, then Apply sync.
10. **Register Date format is not set by the code.** The Register writes `yyyy-MM-dd` as a string, and the code does not set that column to plain text. Confirm on a copy that One Way reads it as text.
11. **The Roster Settings tab has no protection set by the code.** See §5.6.
12. **Roster tabs are warning-protected as a whole.** The Roster Review and Roster Log tabs are protected as a whole sheet, so typing in your own columns can show a warning. That is expected. Click through when the edit is yours.
13. **Display Names are permanent in practice.** No tool edits them. A mistake in a Display Name must be fixed by hand, and it must match the Allotment, Timetable, Staff Duties and Log spellings, or the engine and fairness will split one person into two (PRD §3.3).
14. **Resource Person duplicates must be prevented at onboarding.** Name is their only key, and Check roster reports a duplicate but does not stop it.
15. **The backfill is chunked and must be re-run.** Apply stops starting new chunks after about 4.5 minutes, to stay inside the 6-minute script limit, and says how many lines remain. Run it again. The 07:30 to 10:00 window is advice in the dialog. The code does not enforce it.
16. **The mark-absence commit has no script lock.** The roster tools take one (`withRosterLock_`). The commit path still does not (README §15.2).
17. **Non-teaching duplicates are never deleted by the code.** A duplicate stays red until a person clears it.

---

## 10. Developer section

### 10.1 File map

| File | Responsibility |
|---|---|
| `Constants.js` | `SS` tab names, frozen by the contract test. Never rename an existing tab. |
| `RosterTabs.js` | Headers for the roster tabs (`ROSTER_HEADERS`, `SYNC_PREVIEW_HEADERS`, `ROSTER_LOG_HEADERS`, `REVIEW_HEADERS`), `HR_DB_FIELDS` (the frozen whitelist), `ROSTER_SETTINGS_DEFAULTS`, the Settings reader `readRosterSettings_()`, the builders (`writeRosterTab_`, `writeRosterSettingsTab_`, `writeSyncPreviewTab_`, `writeRosterLogTab_`, `writeRosterReviewTab_`, `writeNonTeachingTab_`, `writeBackfillPreviewTab_`), and the non-teaching dropdown refresh. |
| `Roster.js` | Roster read and cache (`getRoster_`, 300-second `CacheService`, not cached above 90 KB), `getMarkableTeachers_()`, `rosterWarnings_()`, the first-set lock and `correctStaffCode_()`, `rosterOnEdit_()` and `nonTeachingOnEdit_()`, Allotment sync (`planRosterSync_`, `previewRosterSync_`, `applyRosterSync_`), `computeRosterCheck_()` (Check roster), and the menu entry points for these. |
| `RosterReview.js` | Preview matches (`previewRosterMatches_`, `buildRosterReview_`), and Apply decisions (`planRosterDecisions_`, `applyRosterDecisions_`). |
| `MatchEngine.js` | Pure matching: normalisation, exclusions, the R1 to R4 ladder, email links (`matchEmailLinks`), Staff Code links (`matchStaffCodeLinks`), Propose add (`matchProposeAdds`). No Sheets calls. |
| `HrDatabase.js` | `readHrDatabase_()`, the only reader of the HR Database; `testHrDatabaseRead()`; the friendly error text. |
| `HR.js` | `readImportHrContacts_()` (once per run, by header name) and `resolveContact_()`, the only way notifications find a contact. No prefix matching. |
| `Backfill.js` | Backfill preview and apply, the classify rules, and rollback info. |
| `AbsenceRegister.js` | `ABSENCE_HEADERS` (18), `NON_TEACHING_HEADERS`, the Register writer, the join-key block at commit time, and the key notes. |
| `MarkAbsenceTab.js` | `onEditInstallable()` (dispatches roster and non-teaching edits), and the Mark Absence teacher dropdown. |
| `Chat.js` | Notifications, which call `resolveContact_()`. |
| `Setup.js` | `upgradeTabs()` (safe), `refreshLabels()`, and `setupAllTabs()` (destructive and guarded). Do not run the last on a live workbook. |
| `Reports.js` | `backupWorkbook_()`, which copies this workbook into the Backups folder. |
| `Code.js` | `onOpen()` (the menu), `uiBootstrap()` (the side panel). |
| `appsscript.json` | Unchanged by the roster work. No new scope. |
| `test/` | Node tests. `run.js` runs every `*.test.js`. Key files: `oneway-contract.test.js`, `hrdb-minimisation.test.js`, `roster.test.js`, `roster-review.test.js`, `backfill.test.js`, `contact.test.js`, `nonteaching.test.js`, `markable.test.js`, `join-keys-at-mark.test.js`, `match.test.js`, `absence-register-io.test.js`. Support: `harness.js`, `fixture.js`, `sheetmock.js`. |

Because all `.js` files share one global namespace, grep before you add a top-level name. A duplicate silently overwrites the first.

### 10.2 Tests

```bash
node test/run.js
```

At the time of writing this guide, the suite reports **1006 passed, 0 failed**. Run it before every push. The roster and backfill tests check that every menu handler is defined.

Syntax check, if you want one: `for f in *.js; do node --check "$f"; done`.

### 10.3 The `.claspignore` rule

`.claspignore` keeps the Node harness and the repo files out of the Apps Script project: `test/**`, `docs/**`, `*.md`, `.git/**`, `.claude/**`, `node_modules/**`, and the local config files. Do not remove these lines. Without them the project fails to load, because the test files use `require()`.

`.clasp.json` is local and gitignored. Create it from `.clasp.json.example` and fill in the script ID on your own machine. Never commit it.

### 10.4 Pushing to the live script (house rule)

The estate rule in the root `CLAUDE.md` applies. Do not push without the user's go-ahead.

1. Pull the live script into a **temporary folder outside the repo**, not into the working tree: `clasp pull` run in that folder, using a copy of `.clasp.json`.
2. Diff that folder against the repo's `.js` and `Sidebar.html` files. Confirm that every difference is one you expect. If an editor has changed the live script, stop and ask the ICT facilitator before you overwrite anything.
3. Ask the user for approval, showing the list of changed files.
4. Only after approval, `clasp push`. Do not run `clasp deploy` without a separate instruction.
5. Afterwards, run through rollout step 2 (safe upgrade) and check the Register headers.

### 10.5 Frozen items

- Tab names in `Constants.js` (`SS`), and their substrings: `Absence Register`, `Non-Teaching Absence`. One Way matches on them.
- The 16 positional Register headers and the two appended columns (§6).
- `HR_DB_FIELDS`: a change needs the minimisation test updated, and a review of the PII rules.
- `setupAllTabs()` is never run on a live workbook.

### 10.6 Where the code differs from the PRD

Kept as built. Each is in §9 as well.

- The non-teaching onEdit overwrites derived cells on each Teacher change. The PRD says blank cells only (PRD D5).
- Apply sync takes no backup. PRD §10 asks for a backup before each Apply. Apply decisions and the backfill take one; Apply sync and Correct Staff Code do not.
- Backfill action names are `No roster match`, `Duplicate name`, `Code not locked`, `Email not confirmed` and `Conflict (differs)`. The PRD's `Teacher not on roster` is not used.
- The Categories table has a **Code prefix** column that the PRD does not list. A prefix mismatch is a warning (`code-prefix` in Check roster).
- The Roster Log and Roster Review tabs are warning-protected as whole sheets, not only the owned columns.
- The panel and grid text says "run 🪪 Sync roster". No such menu item exists.
- `hrLookup_()` no longer exists. `resolveContact_()` replaced it (PRD D7), and README §15.3 is marked fixed.
