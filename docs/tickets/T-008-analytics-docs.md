# T-008 — Analytics documentation

**Branch:** `feat/t008-analytics-docs` · **Depends on:** T-005 (merged) · **Spec:** PRD §10, RFC-002

## Goal
Document the analytics for the three audiences: maintainer (README), coordinator (Help
tab), and leadership (a short "how to read this" note in the report itself is T-006's job,
not yours).

## Files
| File | Change |
|---|---|
| `README.md` | new section covering the analytics engine, the two outputs, and the metrics |
| `Setup.js` | `writeHelpTab_()` — one block |

## Specification
- README: a new numbered section after the weekly report section. Cover what the two
  complaints were, what the report measures, and — importantly — **how to read the variety
  score and the Gini coefficient in plain terms**, since a reader will otherwise not know
  whether 0.35 is good. Include the file map rows for the new files. Link to RFC-002
  rather than restating the formulas.
- Help tab: one `[title, body]` entry, coordinator-facing, explaining what the report
  answers and that it is diagnostic — the system's assignment behaviour has not changed.
- Match the README's existing register: prose with tables, not bullet soup.
- State plainly that repetition is a known structural property (PRD §10.2) and was
  deliberately measured before being changed. Do not imply it is fixed.

## Acceptance
1. README documents both outputs and explains both scores in plain language.
2. Help tab gains one block; `writeHelpTab_()` still renders with correct spacing.
3. No behaviour change. `node --check Setup.js` passes.
4. `node test/run.js` fully green.
