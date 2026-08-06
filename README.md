# claude-code-usage-tracker

Tracks how often the team uses Claude Code, and how much output it produces, without anyone
pulling numbers by hand.

It works by reading the session transcripts Claude Code already writes to disk, aggregating
them per day, and pushing per-person CSVs into this repo. There is nothing to capture at
runtime, so nothing to lose.

**Not covered:** cost (out of scope) and claude.ai chat usage (no personal API). If cost ever
matters, read [ADR-0001](docs/adr/0001-scrape-transcripts-not-hooks.md) before writing any code —
Claude Code's built-in OpenTelemetry export is the better answer and would replace most of this.

Terms used here (Root, Person, Prompt, Turn, Session, Active Day, Scrape) are defined in
[CONTEXT.md](CONTEXT.md). Every CSV column is documented in [docs/schema.md](docs/schema.md).
Decisions and their trade-offs are in [docs/adr/](docs/adr/).

## Install

```bash
pnpx github:timepatiphonp-tw/claude-code-usage-tracker
```

(`npx github:timepatiphonp-tw/claude-code-usage-tracker` works identically. Nothing is
published to a registry — the package is fetched straight from this repo, over the git access you
already need in order to push usage rows.)

It asks three things: which Claude Code config directory to track, your team, and your name.
Everything it needs is copied into your config directory, so there is nothing left behind.

Working from a clone instead:

```bash
git clone git@github.com:timepatiphonp-tw/claude-code-usage-tracker.git
cd claude-code-usage-tracker && node setup.js
```

**The Root prompt has no default, deliberately.** A machine can hold more than one Claude Code
account — a work one and a personal one — and each option is shown with its email and
organisation so you pick the right one. Choosing a personal account would publish your own
out-of-hours usage into a team repo, irreversibly.

Non-interactive:

```bash
pnpx github:timepatiphonp-tw/claude-code-usage-tracker \
  --root=~/.claude-jetstar --team=star --name="Alice Nguyen"
```

Tracking starts from the day you install. Nothing from before is published.

**Team names come from `teams.json` in this repo**, read from the clone setup makes — so adding
a team is an ordinary commit, not a new release.

## Checking it works

Nothing is verified at install time — your git identity, credentials and push permission are
first exercised when a session ends. So after your first session:

```bash
cat ~/.claude/hooks/usage-tracker.log     # or your Root's path
```

A healthy line looks like:

```
2026-08-06T06:19:38.267Z result=ok unpushed=0 days=1 prompts=29 model_rows=2 \
  daily=1/1 models=2/2 deduped=196 excluded_sdk=0 committed=yes pulled=yes ms=6769
```

`result=push-failed` or `unpushed=` a non-zero number means rows are computed but not reaching
the repo. This log is the **only** way to tell a broken install from someone who has not used
Claude Code — both produce no rows.

## What gets written

Two files per person in `logs/`, because Prompts and models sit at different grains: `promptId`
appears only on user records, which carry no model, so a Prompt cannot be attributed to one.

**`logs/<name>.daily.csv`** — one row per person per day, key `(date, person_email)`:

```
date, team, person_name, person_email, cc_version, tracker_version, prompts, sessions
```

**`logs/<name>.models.csv`** — one row per person per day per model, key `(date, person_email, model)`:

```
date, person_email, model, turns, subagent_turns,
main_input_tokens,     main_output_tokens,     main_cache_creation_tokens,     main_cache_read_tokens,
subagent_input_tokens, subagent_output_tokens, subagent_cache_creation_tokens, subagent_cache_read_tokens
```

**[docs/schema.md](docs/schema.md) documents every column** — meaning and exact source field.
The essentials:

- **`date` is a UTC day.** Timestamps are UTC and are not converted, so for anyone east of UTC a
  working day can straddle two rows. Read it as a bucket, not as someone's Monday.
- **`prompts` is the frequency number.** Distinct `promptId` — what a person actually asked for.
- **`turns` is not.** It counts API round-trips inside the agentic loop, several per Prompt, and
  it inflates with tool-heavy tasks rather than with usage. Useful as "how much machinery did
  this take", misleading as "how much did they use it".
- **Active Days = row count of `daily.csv`.** The primary answer to "how often".
- **Headline volume is `main_output_tokens + subagent_output_tokens`.** Do **not** sum all
  the token columns: cache traffic is ~99% of the raw total and tracks repository size, not work
  done. ([ADR-0002](docs/adr/0002-output-tokens-as-headline-usage.md))
- **`team` is a column, not a folder**, so changing team needs no migration.
  ([ADR-0006](docs/adr/0006-team-is-a-column-not-a-directory.md))
- `person_email` is the join key across both files and across renames; `person_name` is a
  display label only.

No `cwd`, no `gitBranch`, no cost — see
[ADR-0004](docs/adr/0004-collect-the-minimum-that-answers-the-question.md) for why each is absent.

## Two counting rules that are easy to get wrong

Both were found by measuring real transcripts, and both are invisible to casual reading.
([ADR-0005](docs/adr/0005-dedupe-records-and-count-prompts.md))

1. **One assistant response is written as several JSONL lines**, one per content block, each
   repeating an identical `usage` payload. Summing lines inflates tokens ~2.19× and turns ~1.75×.
   Responses are grouped by `(file, message.id)` and counted once.
2. **Records with an `entrypoint` starting `sdk-` are dropped.** Those are scripts driving the
   SDK, not a person using Claude Code; one looping script would otherwise register hundreds of
   Prompts in a day. `cli` and `claude-vscode` both count.

## How it runs

A `SessionEnd` hook re-spawns itself as a detached worker and returns in ~400ms, then the worker
scrapes, rewrites the rows and pushes. It must detach: the work takes ~7s, nearly all of it the
git round-trip, and Claude Code cancels a hook that blocks session exit.

**Everything is recomputed, never appended.** Each Scrape rebuilds every date still present in
the transcripts (~30–45 days, after which Claude Code prunes them) and replaces those rows,
preserving older rows already in the file. So a failed push, a lost race, a sleeping laptop or a
cancelled hook all self-correct on the next run — the transcripts are the source of truth and
the CSV is a cache of them. A lockfile serialises git operations; it carries a PID and timestamp
so a crashed run cannot block every future one.

Installed into your Root:

```
<root>/hooks/usage-tracker/          code (a copy — a push to this repo never auto-runs)
<root>/hooks/usage-repo/             the hook's own clone, which it commits and pushes from
<root>/hooks/usage-tracker.config.json
<root>/hooks/usage-tracker.log
<root>/settings.json                 SessionEnd entry merged in; your other hooks untouched
```

## Updating, or changing team or name

Re-run the install command. That is also how a code fix propagates — nothing updates itself, by
design ([ADR-0003](docs/adr/0003-single-repo-with-code-copied-at-setup.md)), so a push to this repo
cannot execute on anyone's machine until they choose to re-run. `tracker_version` on each row
shows who is stale.

**To update, you must defeat the package-runner cache.** `pnpm dlx` caches a `github:` spec for
24 hours by default, so a plain re-run can silently reinstall the *old* code — the failure looks
exactly like the update having worked. Use either:

```bash
# force a fresh fetch of main
pnpm --config.dlxCacheMaxAge=0 dlx github:timepatiphonp-tw/claude-code-usage-tracker

# or pin an exact commit/tag, which is a different cache key and so always fresh
pnpx github:timepatiphonp-tw/claude-code-usage-tracker#<commit-or-tag>
```

A first-time install is unaffected — there is nothing cached yet.

Re-running preserves your original install date, reuses the existing clone, and replaces rather
than duplicates the hook entry.

## Inspecting without installing

```bash
node scrape.js --list-roots
node scrape.js --root=~/.claude-jetstar --team=star --name="Alice N."   # prints CSV, touches nothing
```

## Known limitations

- **Root selection is unguarded.** Picking a personal account publishes personal usage,
  irreversibly. Mitigated by showing email and organisation and having no default; not solved.
- **One Root per person**, so anyone genuinely using two work Roots under-reports silently.
- **A dead hook, a never-working install, and genuine inactivity are indistinguishable** in the
  repo — all three produce no rows. The log file distinguishes them, and it is on each person's
  machine, so it has to be asked for.
- **History is bounded by transcript retention** (~30–45 days). There is no route back to data
  from before rollout.
- **The transcript record shape is undocumented** and may change between Claude Code versions.
  `cc_version` on each row lets a break be dated.
- **Team and name are self-asserted.** `person_email` is authenticated, so nobody can impersonate
  a colleague, but they can put themselves in the wrong team. Treat team as reporting labelling.
- **Usage data is shared.** Anyone with repo access sees every person's rows, and the `team`
  column makes comparison trivial. That is a property of the design — say so before rolling out.
- **Everyone with push access can change the code**, since the branch the hook pushes to cannot
  be protected. ADR-0003 removes automatic execution of a bad push, not the push itself.
- **Requires git push access** for every person; the hook pushes under their own credentials.
