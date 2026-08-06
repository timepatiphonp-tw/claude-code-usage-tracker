# Dedupe assistant records on `message.id`, and count Prompts as the frequency unit

Naively summing every `type: "assistant"` transcript line double-counts, and the obvious
"turn" count answers the wrong question. Both were found by measuring real transcripts, and
both are invisible to anyone reading the JSONL casually.

## The duplication

Claude Code writes one assistant *response* as several JSONL lines — one per content block
(`thinking`, `text`, `tool_use`) — and **every line carries an identical copy of the same
`usage` payload**:

```
message.id msg_016ZWw12HKMNUqkfP3xzdPf2, twice in one file:
  blocks=['thinking']  output_tokens=265  cache_read=25274
  blocks=['tool_use']  output_tokens=265  cache_read=25274
```

Measured on one Root: 957 of 1,613 unique `message.id`s are duplicated. Summing every line
inflates `output_tokens` by **2.19×** and turn counts by **1.75×**.

A Scrape therefore groups by `(transcript file, message.id)` and counts each response once.
Where the duplicates carry *differing* usage (64 cases — streaming updates), the record with
the largest `output_tokens` wins. 154 records carry no `message.id`; those fall back to
`requestId`, which duplicates identically. Ids do not span files, so the file is part of the
key.

## Prompts, not turns

Main-chain stop reasons on the same Root: `tool_use` 2,315 against `end_turn` 342. Nearly
every assistant response is one hop inside an agentic loop, not an interaction with a person.

| Unit | Count |
| --- | --- |
| distinct `promptId` | 324 |
| user prompts (excluding `tool_result` carriers) | 372 |
| deduped assistant responses | 1,517 |

So `prompts` (distinct `promptId`) is the headline frequency number, with `turns` and
`subagent_turns` kept as secondary detail. Turns still earn their place — they show how much
machinery a request took — but they are a poor proxy for how much someone uses the tool,
because a more agentic model or a tool-heavy task inflates them without anyone doing more.

## Consequences

- **This forces two files per Person.** `promptId` appears only on `user` records, and those
  carry no `model`, so a Prompt cannot be attributed to a model — and attributing one via the
  `parentUuid` chain would double-count any Prompt answered by two models, reintroducing the
  bug above. Prompts and Sessions therefore live in a `(date, person)` file and tokens/turns
  in a `(date, person, model)` file, joined on `(date, person_email)`.
- The two numbers can diverge and that is informative, not a bug: rising turns per prompt
  means tasks are getting more agentic, not that usage grew.
- Every metric depends on an undocumented record layout. If Claude Code stops duplicating
  per content block, the dedupe becomes a harmless no-op; if it changes the id fields,
  numbers break loudly rather than silently. `cc_version` on each row dates any break.
- **Any row written before this fix is roughly double.** There are none yet, but a
  re-Scrape rewrites history correctly because rows are idempotent (ADR-0001).
