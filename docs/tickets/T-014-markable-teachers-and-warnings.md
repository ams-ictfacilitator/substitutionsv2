# T-014 Markable teachers and warnings
Worker: codex     Rule: Codex
Folder: /Users/dan/Public/PROJECTS/AnitaMethodist/substitutionsv2 (work in your own git worktree/branch)
Depends on: T-011
## Context
Repo: /Users/dan/Public/PROJECTS/AnitaMethodist/substitutionsv2 (Apps Script V8; all .js files share one global namespace, so duplicate top-level names silently overwrite — grep before adding a name). Tests are a Node vm harness: `node test/run.js` (see test/harness.js, test/fixture.js). **Read `docs/PRD-roster.md` first**: the sections named below are the spec, and requirement ids (R1…R36, D1…D11) refer to it. Also read README.md §17 (local dev).
Estate rules: locate columns by header name never position; batched reads/writes (no per-cell calls in loops); idempotent code-owned setup; config is sheet data not code constants; timezone Asia/Kolkata, dates stored yyyy-MM-dd; never destroy entered data; secrets only in Script Properties; the repo is PUBLIC — no real staff names, emails, staff codes, workbook IDs or personal data anywhere (use obvious placeholders like 'Staff A', 'staff.a@example.test').
House style: match the surrounding code's comment density, naming and idiom. Keep new menu handlers defined (a test asserts every menu handler exists).
Spec: docs/PRD-roster.md — see §13 (this ticket's row), the decisions D1–D11 it touches, §6 (data layouts), §7 (requirements named below) and §8 (One Way contract).
## Task
`getMarkableTeachers_()`; dropdown and `uiBootstrap()`; `rosterWarnings` covering missing roster row, code and email
## Acceptance checks
Requirements: R12, R13
- `node test/run.js` → all tests pass, 0 failed (existing 113 plus your new ones).
- Every new function has a test using fixtures with placeholder data only.
- `for f in *.js; do node --check "$f"; done` passes (excluding test/).
## Out of scope
- `Assign.js` (the substitution engine) — do not change cover-assignment behaviour.
- `⚙️ Config`, `🗂️ Log`, `👥 importHR`, `📄 Reports` rows and the live workbook: this ticket changes code and tests only; never run anything against live data.
- `appsscript.json` scopes/services (no new scope is needed; if you think one is, stop and say so).
- Any file belonging to another ticket's scope, except where this ticket's task requires a minimal hook.
