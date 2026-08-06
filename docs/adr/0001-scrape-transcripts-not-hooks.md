# Read usage from session transcripts, not from hook payloads or OpenTelemetry

Claude Code writes a JSONL transcript per session under `<root>/projects/**/*.jsonl`, and
every assistant record carries `message.usage` (four token counters), `model`, `sessionId`,
`timestamp` and `isSidechain`. We derive all metrics from those files rather than capturing
them as sessions run.

## Considered Options

- **Two hooks (`Stop` + `SessionEnd`) with a `/tmp` turn counter** — the original design.
  Rejected once we confirmed hook payloads carry `transcript_path` but no usage or cost
  data, so the counter was re-deriving, prospectively and unreliably, a number already
  durably on disk. It could only ever see sessions after install, and undercounted any
  session spanning a reboot.
- **OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`)** — the supported path, and better on
  every axis: real `cost.usage` in USD, authenticated `user.email`, org-wide enforcement via
  managed settings, zero per-person install. Rejected only because it requires an OTLP
  collector endpoint someone must own and MDM authority to push the env block, and because
  cost — its main advantage — is explicitly out of scope. **Revisit this first if the scope
  ever grows to include cost, or if a collector appears.**

## Consequences

- Turn counts are a row count; no counter state exists to corrupt or lose.
- A `Scrape` is idempotent, which makes the whole system self-healing: a failed push, a lost
  race or a sleeping laptop is corrected by the next run, because the transcripts are the
  source of truth and the CSV is only a cache of them. This is why no retry/backoff logic
  or `merge=union` fallback is needed.
- Cost is unavailable — the transcripts contain no cost field. Deriving it would mean
  maintaining a per-model pricing table. Out of scope by decision, not by accident.
- History is bounded by Claude Code's transcript retention. Observed on the author's machine:
  `stats-cache.json` records activity from 2026-06-09 while the oldest surviving transcript
  is 2026-06-23, so roughly 30–45 days is recoverable and anything older is gone.
- The transcript record shape is undocumented and may change between Claude Code versions.
  `cc_version` is stored on every row so a schema break can be dated.
