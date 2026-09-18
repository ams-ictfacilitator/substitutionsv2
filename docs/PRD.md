# PRD — Weekly Substitution System

**Status:** Living · **Owner:** ICT Facilitator · **Last revised:** 2026-09-18 (rev 2)
**Repo:** `ams-ictfacilitator/substitutionsv2` · **Runtime:** Google Apps Script (V8), container-bound

---

## 1. Purpose

When a teacher is absent, someone must stand in front of their class. Doing that by hand
costs a coordinator 30–45 minutes every morning, produces uneven workloads, and leaves no
record anyone can audit.

This system turns that into a two-minute task: mark who is away, and it works out who
covers each lost period — fairly, without double-booking, and within the rules the school
has set. It then tells everyone, and files the evidence.

## 2. Users

| Who | Uses it for | Device |
|---|---|---|
| Leave coordinator | marking absences, previewing and committing cover | phone and desktop |
| Office staff | the same, via the in-sheet grid | desktop |
| Substitute teachers | receiving their duties | phone (Google Chat) |
| Principal & leadership | the weekly report | printed PDF, phone |
| ICT facilitator | configuration, rules, maintenance | desktop |

Most users are non-technical. Nothing may require opening the script editor in normal use.

## 3. Context and constraints

- **Satellite, not master.** The main Timetable Management System is read-only to us
  (`SpreadsheetApp.openById`). We never write to it.
- **The sheet is the interface.** Configuration, rules and reference data are editable
  tabs, not code constants.
- **Apps Script limits.** 6-minute execution ceiling; sheet I/O dominates runtime.
- **Timezone** pinned `Asia/Kolkata`; dates stored `yyyy-MM-dd`.
- **Estate house style** applies in full — see `CLAUDE.md` at the estate root.

## 4. Current capability

| Area | State |
|---|---|
| Marking absences | Side panel, in-sheet grid, typed quick-mark — one engine behind all three |
| Absence types | Eight: Leave (full/AM/PM), Permission, OD (full/AM/PM/periods) |
| Assignment | Weighted rotation + proportional fair-share scoring; conflict-free |
| Cascading re-assignment | A substitute who becomes absent has her cover re-assigned |
| Rules | `⚖️ Rules` tab: dedicated team substitute · floor limits · block affinity |
| Notification | Google Chat card; optional email; optional 1:1 DM |
| Records | `🗂️ Log` (per period) and `🗓️ Absence Register` (per teacher-day) |
| Reporting | Weekly PDF for the Principal, filed to Drive, indexed in `📄 Reports` |

## 5. The requirement — free-period protection

### 5.1 Problem

A teacher with almost no free periods can still be picked as a substitute, because the
engine only checks that she is *free at that moment*. The result is a teacher who teaches
seven periods and covers the eighth, with no break in the day. Coordinators currently
prevent this by remembering who to avoid — which does not scale and is not auditable.

### 5.2 Requirement

Cap a teacher's substitutions for a day according to how many free periods her timetable
gives her that day.

The school's stated intent:

| Free periods that day | Maximum substitutions |
|---:|---:|
| 1 | 0 |
| 2 | 1 |

Both numbers must be editable, and the ladder must extend to further rows (3, 4, …)
without a code change.

### 5.3 Definition of "free"

> A teacher's **free periods** on a day are the periods in which her own timetable gives
> her neither a lesson nor a staff duty.

Explicitly: free periods are a property of the **timetable**, not of the plan. Cover
already assigned that day does **not** reduce the count. If it did, each assignment would
lower the cap and the rule would fight itself.

### 5.4 Behaviour

- The cap is **hard**. It is never relaxed, including when cover is short and including
  when the teacher is a dedicated team substitute.
- It composes with the existing per-day ceiling (`Max Substitutions Per Day`); the
  effective limit is the lower of the two.
- A free-period count not listed in the ladder is unconstrained.
- When the guard is the reason a period could not be covered, the plan must say so.

### 5.5 Out of scope

- Weekly free-period budgets (this is per-day only).
- Adjusting the fairness model. The guard removes candidates; it does not re-weight them.
- Back-filling the guard onto substitutions already recorded in the log.

## 6. Non-functional requirements

| # | Requirement | Measure |
|---|---|---|
| N1 | No perceptible slowdown | ≤ 1 ms added per plan in the node harness at 60 teachers / 40 classes |
| N2 | Rule count is free | 15 rules cost no more than 3 |
| N3 | No new sheet reads per candidate | rules compile once per plan into lookup maps |
| N4 | Marking absences unaffected | no change to the mark → preview path cost |
| N5 | Data safety | no schema change to `🗂️ Log`, `⚙️ Config` or `👥 importHR` |
| N6 | Graceful failure | a malformed rule is skipped and reported, never thrown |
| N7 | No secrets in source | webhook read from Script Properties |

## 7. Acceptance criteria

1. A `⚖️ Rules` row of type **Free-period guard** with `Then = 1:0, 2:1` causes:
   - a teacher with exactly 1 free period that day to receive **no** substitutions;
   - a teacher with exactly 2 free periods to receive **at most one**;
   - a teacher with 3+ free periods to be unaffected.
2. Cover already assigned earlier the same day does not change a teacher's free-period
   count.
3. The guard applies to a dedicated team substitute as well — she is skipped and the
   dedicated rule falls back to normal rotation.
4. An uncovered period whose cause was the guard reports it, e.g.
   *"No substitute free — 3 protected by the free-period guard"*.
5. `🧪 Check rules` rejects an unparseable ladder and warns when a guard would remove more
   than half the pool on a normal day.
6. Disabling the rule, or letting its `Until` date pass, restores previous behaviour
   exactly.
7. All existing harness tests continue to pass unchanged.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Guard reduces coverage; more uncovered periods | Reason is surfaced everywhere; `Check rules` warns at >50 % pool loss |
| Coordinators do not understand why someone was skipped | Per-assignment reason in panel, grid note, and report |
| Ladder mis-typed (`1-0` instead of `1:0`) | Validation in `Check rules`; unparseable rule is skipped, not guessed |
| Interaction with dedicated-substitute rule surprises users | Documented; covered by acceptance criterion 3 |

## 9. Delivery

Tickets under `docs/tickets/`, design under `docs/rfc/`. Each ticket is a branch and a
pull request reviewed before merge.

### 9.1 Free-period guard — delivered 2026-09-18

| Ticket | Scope | Depends on |
|---|---|---|
| T-001 | Core: rule type, free-period computation, engine integration, unit tests | — |
| T-002 | Diagnostics: `Check rules` validation, uncovered-reason attribution, UI surfacing | T-001 |
| T-003 | Reporting: guard in the weekly report's rules panel | T-001 |
| T-004 | Documentation: README, Help tab, rule reference | T-001 |

### 9.2 Substitution analytics — in progress

| Ticket | Scope | Depends on |
|---|---|---|
| T-005 | Analytics engine: equity, variety and cross-tab aggregation over the whole log | — |
| T-006 | PDF report + Drive filing + `📄 Reports` indexing | T-005 |
| T-007 | Live `🔎 Analytics` tab | T-005 |
| T-008 | Documentation | T-005 |

---

## 10. Requirement — substitution analytics

### 10.1 Problem

Two complaints have been raised by staff, and neither can currently be answered with
evidence:

1. **"Some teachers never get substitutions."**
2. **"Some teachers get the same class, in the same period, on the same weekday, over
   and over."**

The weekly report answers *what happened this week*. Neither complaint is a weekly
question — both are about the shape of the whole history. The system records everything
needed to settle them and has never been asked to.

### 10.2 The second complaint is probably structural

The engine scores fairness on **how many** duties a teacher has, never **which** ones. A
teacher who is the only one free in a recurring slot will be chosen for that slot every
week, and the fairness model will keep choosing her, because from its point of view she
is simply below her share. There is no memory of "you already did this".

This PRD does **not** change that. The decision (2026-09-18) is to measure first: the
report will show whether repetition is concentrated on a few people or endemic, and the
remedy can then be chosen against evidence rather than intuition.

### 10.3 Requirement

A comprehensive analytics report over all recorded substitution history, delivered **both**
as a filed PDF and as a live sheet tab, sharing one analytics engine.

It must distinguish three populations, because conflating them misdirects the fix:

| Population | Meaning | Where the fix lies |
|---|---|---|
| In the pool, never called | has a `Substitution` allotment, zero duties | the engine or their availability |
| In the pool, far below share | called, but well under weighted fair share | the engine |
| Not in the pool | no `Substitution` allotment, weight 0 | the Allotment, not the engine |

### 10.4 Scope

All rows in the `🗂️ Log`, with the current term distinguished. Not a date-range prompt —
there must be one canonical document that can be circulated.

Depth: one ranked comparative table covering every teacher, plus a detailed profile for
outliers only — never called, furthest below share, or lowest variety.

### 10.5 Out of scope

- Any change to assignment behaviour. Diagnostic only, by decision.
- Any change to the `🗂️ Log`, `⚙️ Config` or `👥 importHR` schema.
- Analysis of absence itself — that is the weekly report's job.
