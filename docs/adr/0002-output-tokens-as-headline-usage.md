# `output_tokens` is the headline usage number

All four token counters are stored per row, but summaries quote `output_tokens` as
"usage". Cache traffic is recorded and deliberately never headlined.

## Context

Measured across 54 real sessions on the author's machine: input 412,386, output 6,116,580,
cache-creation 36,887,594, cache-read 791,006,318. Input plus output is **0.78%** of the
four counters summed — the raw total is 99% cache traffic.

Cache volume tracks how large a repository's context is and how long sessions run, not how
much work a Person did. A single `tokens` column summing all four would rank someone
working in a large monorepo an order of magnitude above a heavier user on a small
repository, on identical effort, while looking authoritative.

## Consequences

- Nothing is discarded — all four counters are stored, so this can be revisited without
  re-collecting. Only the default framing is opinionated.
- Reports built on the headline are hard to change later once people have anchored on the
  numbers, which is why the choice is recorded here rather than left to the summariser.
- `Active Day` count, not tokens, is the primary answer to "how often is this used".
