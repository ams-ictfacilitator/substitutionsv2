# RFC-002 — Substitution analytics

**Status:** Accepted · **Author:** ICT Facilitator · **Date:** 2026-09-18
**Implements:** PRD §10 · **Tickets:** T-005 … T-008

---

## 1. Summary

One aggregation engine over the whole `🗂️ Log`, feeding two presentations: a filed PDF
and a live `🔎 Analytics` tab. Diagnostic only — no change to how substitutes are chosen.

```
AnalyticsData.js   buildAnalytics()      pure; one pass over the log → one model
      ├── AnalyticsRender.js             model → printable HTML → PDF → Drive → 📄 Reports
      └── AnalyticsTab.js                model → 🔎 Analytics sheet tab
```

Neither presentation may compute anything of its own. If a figure is needed, it belongs
in the model, so the tab and the PDF can never disagree.

## 2. Vocabulary

| Term | Definition |
|---|---|
| **duty** | one `ASSIGNED` row in the log — a substitute covering one period |
| **slot** | the triple `class · period · weekday`, e.g. `VIII-B · P3 · Wednesday` |
| **pool member** | a teacher with a `Substitution` row in the Allotment and weight > 0 |
| **weight** | that row's `Periods Allotted` |

Only `ASSIGNED` rows count as duties. `UNASSIGNED` rows are analysed separately as gaps.

## 3. Equity metrics

Answering *"some teachers never get substitutions"*.

Per pool member:

| Field | Definition |
|---|---|
| `duties` | count of `ASSIGNED` rows where `substitute` = them |
| `weight` | allotment weight |
| `fairShare` | `weight × totalDuties ÷ totalWeight` |
| `deficit` | `duties − fairShare`; negative means under-used |
| `perWeight` | `duties ÷ weight` — load per unit of allotment |
| `firstDuty`, `lastDuty` | dates, or null |
| `daysSinceLast` | from `lastDuty` to the latest date in the log; null if never |
| `neverCalled` | `duties === 0` |

Three cohorts must be reported separately (PRD §10.3): **never called**, **below share**
(`deficit < −1`), and **not in the pool** — teachers who appear in the Allotment but have
no `Substitution` row. The third is not an engine problem and must not be presented as one.

**Gini coefficient** over `perWeight` across pool members with weight > 0, sorted
ascending:

```
G = ( 2·Σ(i · x_i) ) / ( n · Σx_i )  −  (n + 1) / n        i = 1…n, x sorted ascending
```

0 = every teacher carries exactly their weighted share; 1 = one teacher carries
everything. Report to two decimals with a plain-English band (≤0.2 even · ≤0.4 moderate ·
>0.4 uneven). If `Σx = 0`, report as not applicable rather than dividing by zero.

## 4. Variety metrics

Answering *"the same class, same period, same day, again and again"*.

Per substitute, over their duties:

| Field | Definition |
|---|---|
| `distinctClasses`, `distinctPeriods`, `distinctDays`, `distinctSubjects`, `distinctAbsentees` | cardinality of each dimension |
| `slotCounts` | map of `class\|period\|weekday` → count |
| `maxRepeat` | the largest value in `slotCounts` |
| `topSlot` | the slot achieving it, for display as `VIII-B · P3 · Wed × 6` |
| `repeatedSlots` | number of slots with count ≥ 2 |
| `repeatShare` | `Σ(count − 1) ÷ duties` — the proportion of duties that repeated a slot already done. 0 = never repeated; approaching 1 = almost always the same slot |

### 4.1 Variety score

Normalised Shannon entropy, per dimension:

```
H      = − Σ pᵢ · log2(pᵢ)                pᵢ = countᵢ ÷ duties
Hmax   = log2( min(duties, K) )           K = categories available school-wide
variety = Hmax > 0 ? H / Hmax : null
```

`K` is the number of distinct classes (or periods, or weekdays) that exist across the
**whole log**, not just this teacher's. Normalising by `min(duties, K)` is what makes the
score fair to someone with few duties: three duties across three classes scores 1.0, and
three duties in one class scores 0.

`null` when `duties ≤ 1` — a single duty has no variety to measure, and must be shown as
"—", never as 0, which would defame someone who was called once.

Report `varietyClass`, `varietyPeriod`, `varietyDay`, and an `overallVariety` as their
unweighted mean over the non-null components.

**Herfindahl index** on classes, `Σ pᵢ²`, as a concentration cross-check.

## 5. Cross-tabulations

| Table | Rows × columns | Answers |
|---|---|---|
| Substitute × class | counts | who keeps landing in the same room |
| Absent teacher × substitute | counts | who always covers for whom |
| Weekday × period | counts | when the pressure falls |
| Class × period | counts | which lessons are most disrupted |
| Week × duties, coverage % | trend | is it getting better or worse |

Each cross-tab is capped for display (top 15 rows by total, remainder folded into an
"others" line) but computed in full, so the tab can show more than the PDF.

## 6. Class-side view

The mirror of the variety complaint — a class that keeps seeing the same face:

- per class: total sub periods, distinct substitutes, most frequent substitute and their share
- `monotony` = share of that class's covered periods taken by its single most frequent substitute

## 7. Gap analysis

`UNASSIGNED` rows by class, period, weekday and absent teacher, plus the overall coverage
rate and its trend by week.

## 8. Performance

One pass over the log building all maps simultaneously — O(N) in log rows, O(1) sheet
reads. At a year of data (~10,000 rows) this is still trivial; the 6-minute ceiling is not
in play. The model is memoised per execution so the PDF and the tab can be produced from
one build.

The PDF must stay bounded: outlier profiles only, capped at 12, and cross-tabs truncated
for display.

## 9. Presentation

**PDF** — reuses `ReportRender.js`'s conventions exactly: light `RC` palette, table-based
markup, no flexbox, no web fonts, A4, signature-free (this is an analysis, not a return).
Filed to the same Drive reports folder and indexed in `📄 Reports` alongside the weekly
reports, distinguished by name.

**`🔎 Analytics` tab** — rebuilt on demand, never on a trigger. Frozen headers, the
estate status vocabulary for colour, and every table a plain range so it can be sorted and
filtered. Built with batch writes, one `setValues` per table.

## 10. Alternatives considered

| Option | Why not |
|---|---|
| Extend the weekly report | Different question, different cadence, and it would double the weekly PDF's length for no weekly benefit. |
| Tab only | Cannot be circulated or handed to a teacher who is complaining. |
| PDF only | Cannot be interrogated; every follow-up question needs a regeneration. |
| Add a `variety` column to the log | Schema change to live data, and it is derivable. Rejected on the same grounds as RFC-001 §9. |

## 11. Test plan

1. Equity: a teacher with zero duties appears in `neverCalled`, not in `belowShare`.
2. A teacher with no `Substitution` allotment appears in `notInPool`, never in the other two.
3. Gini is 0 for a perfectly proportional distribution and rises as load concentrates.
4. `repeatShare` is 0 when every duty is a distinct slot, and `(n−1)/n` when all `n` are the same slot.
5. Variety is `null` at one duty, 0 for all-same-class, 1.0 for all-distinct-classes.
6. `Hmax` uses school-wide `K`, so few duties spread widely still score high.
7. Cross-tab totals reconcile to the total duty count.
8. An empty log produces a valid model and both presentations render without error.
9. The tab and the PDF report identical figures for the same input.
