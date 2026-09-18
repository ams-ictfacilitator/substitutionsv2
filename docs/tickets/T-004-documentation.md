# T-004 — Free-period guard: documentation

**Branch:** `feat/t004-guard-docs` · **Depends on:** T-001 (merged) · **Spec:** PRD §5, RFC-001

## Goal
Document the guard where the three audiences will actually look: the README for whoever
maintains the code, the Help tab for coordinators, and the Rules tab note for whoever
fills the row in.

## Files
| File | Change |
|---|---|
| `README.md` | §6.6 rule table + a short subsection on the guard |
| `Setup.js` | `writeHelpTab_()` — a block explaining the guard in plain language |
| `Constants.js` | confirm the `hint` text on the rule type reads well on the tab |

## Specification
- README: add the row to the rule-type table in §6.6, then a short passage covering the
  ladder, the definition of "free" (timetable, not plan), and that it is hard in both
  passes. Match the existing register — prose with tables, not bullet soup.
- Help tab: one `[title, body]` entry in the `blocks` array in `writeHelpTab_()`, in the
  same voice as its neighbours. Aimed at a coordinator, not a developer.
- Do not restate RFC-001; link to it.

## Acceptance
1. README §6.6 table includes the new type with its hard/soft classification.
2. Help tab gains a block; `writeHelpTab_()` still renders (row spacing intact).
3. No behaviour change — documentation only.
4. `node test/run.js` green.
