# Collect the minimum: no cost, no project paths, no backfill, one Root

Four deliberate omissions, recorded together because they share one rationale and a future
reader will otherwise try to "complete" the dataset.

## Context

No one has asked for this data — it exists for visibility, not to serve a decision. Every
row lands in a repo the whole team can read, so anything collected is effectively published
about a colleague, permanently and irreversibly. With no consumer, the burden of proof runs
the other way: a field is included only if it answers "how often" or "how much".

## The omissions

- **No cost.** Out of scope, and it would mean owning a per-model pricing table. See
  ADR-0001 — this is also the only reason OpenTelemetry was not adopted.
- **No `cwd` or `gitBranch`.** The transcripts carry both, giving a free per-project
  breakdown. Excluded: directory names publish what every teammate works on and when,
  leaking unreleased codenames, client names and personal projects under `~`. Neither
  "how often" nor "how much" needs to know which folder.
- **No backfill.** Setup records the install date; earlier transcripts are ignored, so
  nobody's pre-consent history is published. "Tracking started when you installed it" is
  also a cleaner line to state at rollout.
- **One Root per Person.** Setup lists discovered Roots with each one's email and
  organisation, with nothing pre-selected, and the Person picks exactly one.

## Consequences

- Root selection is a human decision with no automatic guard. A machine can hold both a
  work and a personal account — on the author's, `~/.claude` is a personal Stripe-billed
  account and `~/.claude-jetstar` is the Jetstar org — so a wrong pick publishes personal
  usage into a work repo, irreversibly. An `organizationUuid` filter was considered and
  rejected in favour of explicit choice; **this is an accepted risk, not a solved problem.**
  Mitigations: no default value, email and org shown next to every option, and the selected
  Root echoed on every run so a wrong pick surfaces early.
- The mirror-image failure: a Person genuinely using two *work* Roots under-reports, and
  nothing detects it.
- Adding project attribution later is possible, but historical rows would lack it.
