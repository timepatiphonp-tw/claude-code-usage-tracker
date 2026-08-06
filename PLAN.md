# PLAN.md — what is left

How the tracker works and what it writes is in [README.md](README.md); why it works that way is
in [docs/adr/](docs/adr/). This file is only the work still ahead, so that it stays short enough
to be true.

## Status

Working end to end on one machine, verified against a real `SessionEnd` and a real push:
`scrape.js`, `setup.js`, `run-hook.js`, `lib/`, `teams.json`.

Pilot so far: one person, five sessions in a day, six commits, one data row — recompute-and-
replace confirmed on the live repo.

## Next

1. **Commit and push the code.** The repo currently holds usage rows on top of `first commit`
   while every source file is local, so anyone cloning gets a `logs/` folder and no tracker.
2. **Second pilot person, on a different team.** Nothing has exercised two teams, and the whole
   `team`-as-a-column design (ADR-0006) is unproven with more than one value in play.
3. **Announce visibility before going wider.** Every person's name, email and daily activity
   lands in a repo the whole team reads. Say so first, not after.
4. **Roll out**, with the non-interactive form for anyone scripting it:
   `node setup.js --root=<path> --team=star --name="Alice Nguyen"`

## Not yet exercised

Sandbox-only, or not tested at all. Each is a real path in the live install:

- **Two sessions ending simultaneously.** The lock's skip path works in the sandbox; in the live
  install the two real exits happened 9s apart and never contended.
- **A second person pushing concurrently.** Rebase-on-disjoint-files works in the sandbox only.
- **A stale lock in the wild** — a laptop sleeping mid-Scrape, rather than a hand-written lock
  file with a dead PID.
- **Recovery after a genuinely failed push** (offline laptop, expired credentials), as opposed to
  a remote deliberately pointed at nothing.
- **`sdk-*` exclusion against a real SDK run.** Verified only against a synthetic record.
- **A session spanning midnight**, which should produce two dated rows from one Session.
- **An empty session** — opened and closed without a prompt. Expected: `sessions` increments and
  `prompts` stays flat, giving an Active Day with zero Prompts. Worth confirming that is what
  happens and deciding whether it should count.
- **Transcript pruning.** Nothing has yet aged past the retention window, so the "preserve rows
  the transcripts can no longer produce" path has only been tested by narrowing `--since`.

## Open knobs

1. **Reporting.** Deferred deliberately — the CSVs are the deliverable for now. When something is
   wanted: Active Days and Prompts per person per week, the same per team, headline output tokens
   alongside, and a "no rows for N days" flag, because a dead hook and genuine inactivity look
   identical.
2. **Health visibility.** The log is per-machine, so "is everyone's tracker working?" cannot be
   answered from the repo. Options: a heartbeat row, or accepting that it is asked in person.
   Fine at two people, awkward at ten.
3. **`cc_version` is duplicated** across both CSVs. Harmless; belongs in one.
4. **The differing-duplicate rule** (largest `output_tokens` wins) was inferred from 64 samples.
   Not verified as a rule.

## Settled — do not relitigate

- **No debounce.** Every `SessionEnd` scrapes; the lockfile is the only concurrency control. A
  time-based debounce silently defers the most recent session's data until the *next* session
  ends, which may be days later or never. Measured volume being suppressed: median 1 session per
  day, ~2 commits.
- **`person_email` stays plaintext.** Hashing it beside a `person_name` column and a named file
  protects nothing; repo privacy is the actual control.
- **Token columns split main vs subagent, explicitly prefixed.** Decided early because transcript
  pruning makes it the one choice that cannot be applied retroactively.
- **Setup does not verify git identity, credentials or push permission.** The first real session
  is the first test; the log file is the mitigation.
- **One Root per person**, chosen from a list with no default.
