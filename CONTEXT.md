# Claude Code Usage Tracker

Collects how often and how heavily a team uses Claude Code, by reading the session
transcripts Claude Code already writes to disk, and aggregating them into per-person
CSV files in a shared git repo.

## Language

### Identity

**Root**:
One Claude Code configuration directory (`~/.claude`, or any path in `CLAUDE_CONFIG_DIR`).
A single machine can hold several, each authenticated as a different account in a
different organisation. Exactly one Root is tracked per Person.
_Avoid_: config dir, home, install

**Person**:
One authenticated Claude Code account, identified by the `emailAddress` of the chosen
Root. This is the join key for every rollup.
_Avoid_: user, member, developer, dev

**Person Name**:
The human-readable label a Person types at setup. Display only — never a join key, so
inconsistent spellings are cosmetic.
_Avoid_: name, username, handle

**Team**:
A named group a Person selects at setup, from a predefined list. A label for grouping
rows, not an authorisation boundary — everyone with repo access reads every Team's rows.
_Avoid_: squad, group, org

### Activity

**Prompt**:
One request a Person made, identified by a distinct `promptId`. The unit of "how often" —
this is the only count that tracks human interaction rather than machine work.
_Avoid_: turn, message, exchange, query

**Turn**:
One deduplicated assistant response in the main conversation — a single API round-trip
inside the agentic loop, of which one Prompt typically produces several. Secondary detail:
it measures how much machinery a Prompt took, never how much someone used the tool.
_Avoid_: message, exchange, prompt, response, interaction

**Subagent Turn**:
One Turn produced inside a subagent rather than the main conversation. Counted separately,
because it reflects work a Person delegated rather than requested directly.
_Avoid_: sidechain, child turn, agent message

**Session**:
One Claude Code conversation, identified by its transcript file. A Session can span
several calendar dates, so it is never itself a unit of reporting.
_Avoid_: conversation, run, chat

**Active Day**:
One calendar date on which a Person issued at least one Prompt. The primary measure of
how frequently Claude Code is used.
_Avoid_: usage day, working day

### Measurement

**Headline Usage**:
`main_output_tokens + subagent_output_tokens` — the measure quoted whenever a single "usage"
number is wanted. Chosen because cache traffic dominates the raw token total and tracks
context size rather than work done.
_Avoid_: usage, tokens, total tokens, volume

**Cache Traffic**:
`cache_creation_tokens` and `cache_read_tokens`. Recorded but never headlined; roughly
99% of raw token totals, and driven by repository size more than by activity.
_Avoid_: cached tokens, cache usage

**Scrape**:
One execution that reads a Root's transcripts, deduplicates assistant records, recomputes
each affected date's rows, and replaces them. Idempotent by design, so a Scrape is always
safe to repeat.
_Avoid_: sync, collect, upload, run
