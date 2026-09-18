# RFC-001 — Free-period guard

**Status:** Accepted · **Author:** ICT Facilitator · **Date:** 2026-09-18
**Implements:** PRD §5 · **Tickets:** T-001 … T-004

---

## 1. Summary

Add a rule type that caps a teacher's substitutions for a day based on how many free
periods her timetable gives her that day. It plugs into the existing rules framework as a
**hard candidate filter**, alongside floor limits.

## 2. Why a rule, not a Config setting

Config holds settings that apply to the whole system. This is a *policy* — it may later
need to apply to one team, exclude senior staff, or expire at the end of a term. The
`⚖️ Rules` tab already gives all of that (Enabled, Until, Priority, Scope) for free, and
the compile-once/lookup-many architecture keeps it off the hot path.

## 3. The rule type

Added to `RULE_TYPES` in `Constants.js`:

```js
{
  id: 'FREE_PERIOD_GUARD',
  label: 'Protect teachers with few free periods',
  who:  'All  (or a team name, or one teacher name)',
  then: 'Ladder of free periods : maximum substitutions, e.g. 1:0, 2:1',
  hint: '...'
}
```

### Tab semantics

| Column | Value |
|---|---|
| Rule | `Protect teachers with few free periods` |
| Who / What | `All`, or a team name, or a single teacher name |
| Then | `1:0, 2:1` — free-period count : max substitutions |
| Until | optional expiry |
| Notes / Reason | free text |

A free-period count absent from the ladder is unconstrained. `3:2` may be added later with
no code change.

## 4. Compilation

`buildRuleContext_()` gains:

```js
freeGuards: [           // ordered; first match wins
  { all: true, teams: {}, teachers: {}, ladder: { 1: 0, 2: 1 } }
]
```

Ladder parsing accepts `n:m` pairs separated by commas or semicolons, whitespace
tolerated. A pair that does not parse to two non-negative integers makes the **whole rule**
invalid: it is pushed to `ctx.problems` and skipped. Never partially applied.

## 5. Free-period computation

A new memoised map, built once per plan:

```js
freeByTeacher[dayIndex][teacherName] = <count of periods with no lesson and no duty>
```

Derived from `getTimetable()` and `getStaffDuties()` — **not** from the engine's `busy`
map, because `busy` also absorbs substitutions already committed for the date. Using
`busy` would shrink the count with every assignment and make the cap self-defeating
(PRD §5.3).

One pass over the timetable and the duty list, both already loaded. Cost is O(timetable),
comparable to the existing `buildHomeBlocks_` pass, and only incurred when a guard rule is
active.

```
freeCount(T, D) = cfg.periods
                − |{ p : T has a lesson at (D,p) }|
                − |{ p : T has a staff duty at (D,p), and no lesson at (D,p) }|
```

Clamped to `[0, cfg.periods]`.

## 6. Engine integration

Inside `scanCandidates_()` in `Assign.js`, alongside the existing floor-limit check and
before the fairness scoring:

```js
if (st.rules && st.rules.any) {
  var cap = freeGuardCap_(st.rules, name, st.dayIndex, m);   // Infinity when unguarded
  if (((st.dayUsed[name] || 0) + run) >= cap) { blockedByFreeGuard++; continue; }
}
```

- **Hard in both passes.** Like floor limits, and unlike the dedicated-substitute
  preference. A dedicated substitute who is guard-capped is skipped, and the dedicated rule
  falls back to normal rotation — which is already its defined behaviour.
- **Composes with `Max Substitutions Per Day`.** Both are `continue` guards, so the
  effective ceiling is the lower.
- `st.dayIndex` must be threaded into the scan state; it is already computed in
  `computePlan()`.

## 7. Reporting the reason

`scanCandidates_()` returns a new counter `blockedByFreeGuard`, and
`noCandidateReason_()` gains a clause:

```
No substitute free — 3 protected by the free-period guard, 2 already teaching or covering
```

This flows unchanged into the side panel, the Mark Absence cell note, the Chat card and
the report's uncovered risk register, all of which already render `reason`.

## 8. Validation

`checkRules()` gains, for this type:

- ladder parses, and every value is a non-negative integer;
- `max subs` is not greater than the free-period count it is keyed to (a warning — it is
  legal but pointless);
- when the source workbook is reachable, a **pool-impact estimate**: how many pool members
  would be fully blocked (cap 0) on each working day. Warn above 50 %.

## 9. Alternatives considered

| Option | Why not |
|---|---|
| `max = freePeriods − 1` as a formula | Implies 7 substitutions at 8 free periods — meaningless, and not what was asked. A ladder states policy explicitly. |
| A `Min Free Periods To Remain` Config number | Cannot express `1→0, 2→1` as distinct policy points, and cannot be scoped or expired. |
| Soft penalty in the fairness score | The requirement is absolute ("should not be assigned"), not a preference. |
| Store free-period counts on the log | Needs a schema change to a tab holding two months of live data. Recomputable from the timetable at no real cost. |

## 10. Test plan

Harness-based, in the session scratchpad pattern already used by `ruletest.js`:

1. Teacher with exactly 1 free period receives 0 substitutions.
2. Teacher with exactly 2 receives at most 1.
3. Teacher with 3+ is unaffected versus baseline.
4. Assigning cover does not reduce her free-period count mid-run.
5. A guard-capped dedicated substitute is skipped and the fallback engages.
6. Uncovered reason names the guard.
7. Unparseable ladder → rule skipped, recorded in `ctx.problems`, plan still produced.
8. Disabled and expired rules restore baseline behaviour exactly.
9. Benchmark: ≤ 1 ms added per plan at 60 teachers / 40 classes; 15 rules ≈ 3 rules.
