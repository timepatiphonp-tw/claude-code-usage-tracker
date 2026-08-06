# Team is a column, not a directory

`logs/` is flat — `logs/<name>.daily.csv`, not `logs/<team>/<name>.daily.csv`. Team is a
column on each row.

## Context

Per-team folders were the original design and read better. They interact badly with two other
decisions, though, and the interaction is invisible until someone changes team.

A Scrape rewrites **every date still present in the transcripts** — roughly 45 days — because
that is what makes the system self-healing (ADR-0001). If the write path is derived from the
*currently configured* team, then re-running `setup.js` to pick a new team causes the next
Scrape to rewrite all ~45 days into the new team's folder, while the old folder still holds
its copies. Every one of those dates then exists twice:

```
logs/platform/patiphon-p.daily.csv   2026-08-01 … 2026-08-19
logs/data/patiphon-p.daily.csv       2026-08-01 … 2026-08-20   ← same dates again
```

Reading the tree gives 24 prompts for a 12-prompt day. Both files look entirely reasonable in
isolation, and nothing detects it.

## Considered Options

- **Per-date team lookup** — config keeps `[{team, from}]` and the Scrape resolves the folder
  per date. Correct, and keeps the folders, but adds config state and a lookup purely to
  support a directory layout.
- **Only rewrite today** — removes the duplication by removing the recomputation, which throws
  away self-healing. Rejected.
- **Dedupe when reporting** — leaves the CSVs wrong on their own terms.

## Consequences

- A team change is now a non-event: subsequent rows carry the new team, earlier rows keep the
  old one, and no file moves. Historical attribution stays correct for free.
- Team names can be renamed or re-cased without orphaning directories.
- Lost: the ability to hand someone a folder as "their team's data", and the option of splitting
  a team's folder into its own repository later. If per-team access isolation is ever a real
  requirement it needs separate repos anyway, since git permissions are repo-level.
- `models.csv` carries no `team`; it joins to `daily.csv` on `(date, person_email)`.
