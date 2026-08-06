# One repo and one branch; `scrape.js` is copied to the Root at setup

Code, `teams.json` and `logs/` all live in this repo on one branch. `setup.js` copies
`scrape.js` into the chosen Root's `hooks/` directory, and the `SessionEnd` hook executes
that copy — never the file in the clone.

## Context

To push a row, the scraper must `git pull --rebase` in its clone. Because the hook must be
able to push without review, that branch cannot have branch protection. If the executed
code lived on the same branch as the data, the pull needed to push rows would also update
the code — so any push, including an accidental one, would run on every teammate's machine
within one session with no review step available.

Copying at setup breaks that link: pulling data never changes what executes.

## Considered Options

- **Two repos** (gated code, open data) — the original design, and the strongest access
  control. Rejected in favour of ease of use.
- **Run from the clone with `git pull`** — instant fix propagation, no re-setup ever.
  Rejected: the realistic hazard is not a malicious colleague but an accidental one, and a
  bad glob or runaway loop reaches every laptop within a session.
- **Run from the clone without pulling code** — considered and found incoherent. The data
  pull *is* a code pull when both share a branch.
- **Protected `main` plus an unprotected `data` branch** — a real gate while staying
  single-repo, but needs a second checkout or worktree just to push, which reproduces the
  two-repo split under a different name.

## The update path has a cache trap

Install is `pnpx github:timepatiphonp-tw/claude-code-usage-tracker`, and re-running it is the
update mechanism. But `pnpm dlx` caches a `github:` spec for 24 hours by default (`dlxCacheMaxAge`),
so **a plain re-run can reinstall the old code while appearing to succeed.** Verified: with
`c4f095f` on `main`, a re-run served the previously cached `43510a7` — the fetched copy had no
`.git` and none of the new code.

That is the worst shape of failure for this project: a fix that seems to have propagated and has
not. Updating therefore requires either a forced fetch
(`pnpm --config.dlxCacheMaxAge=0 dlx github:…`) or a pinned commit/tag spec
(`…#<commit-or-tag>`), which is a different cache key and always fresh. Both were confirmed to
serve the new code. A first install is unaffected — nothing is cached yet.

If the tool starts changing often, tagging releases and installing by tag is the durable answer:
it is cache-safe by construction and makes `tracker_version` in each row correspond to something
nameable.

## Consequences

- Updates require people to re-run setup; nothing propagates on its own.
- Version skew is therefore expected. `tracker_version` is stored on every row so staleness
  is visible in the data itself rather than needing to be surveyed.
- Anyone with push access can still alter the code in the repo — this decision removes
  *automatic execution*, not the ability to commit.
