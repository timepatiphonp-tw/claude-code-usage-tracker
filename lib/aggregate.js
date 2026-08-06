'use strict';

// Reads a Root's session transcripts and aggregates them into daily and
// per-model rows. This is the whole measurement logic; everything else in the
// project is plumbing.
//
// Two non-obvious rules, both measured against real transcripts (ADR-0005):
//
//   1. One assistant response is written as SEVERAL JSONL lines, one per content
//      block, each repeating an identical `usage` payload. Summing lines inflates
//      tokens ~2.19x and turns ~1.75x. So responses are grouped by
//      (file, message.id) and counted once.
//
//   2. `promptId` — the frequency unit — lives only on `user` records, which
//      carry no model. So Prompts are a (date, person) fact and cannot be
//      attributed to a model. Hence two row sets rather than one.

const fs = require('fs');
const path = require('path');

const TOKEN_FIELDS = [
  ['input_tokens', 'input'],
  ['output_tokens', 'output'],
  ['cache_creation_input_tokens', 'cache_creation'],
  ['cache_read_input_tokens', 'cache_read'],
];

function listTranscripts(root) {
  const base = path.join(root, 'projects');
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
    }
  };
  walk(base);
  return files.sort();
}

// Later Claude Code versions win, compared numerically — "2.1.10" is newer than
// "2.1.9", which a string comparison gets backwards.
function newerVersion(a, b) {
  if (!a) return b;
  if (!b) return a;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? a : b;
  }
  return a;
}

function emptyDay() {
  return { prompts: new Set(), sessions: new Set(), ccVersion: null };
}

// `date` and `model` are carried on the bucket rather than parsed back out of
// the Map key. Composite keys that get split again are a bug factory — the first
// version keyed on `${date}\0${model}` and split on a space, silently producing
// rows whose date field held the model name.
function emptyModel(date, model) {
  return {
    date,
    model,
    turns: 0,
    subagent_turns: 0,
    main: { input: 0, output: 0, cache_creation: 0, cache_read: 0 },
    subagent: { input: 0, output: 0, cache_creation: 0, cache_read: 0 },
  };
}

const SEP = '\u0000'; // Cannot occur in a path, id, date or model name.

/**
 * @param {object} opts
 * @param {string} opts.root       Config dir to read.
 * @param {string} [opts.since]    ISO date; records before it are ignored (install_date).
 * @returns {{days: Map, models: Map, stats: object}}
 */
function aggregate({ root, since }) {
  const days = new Map(); // date -> emptyDay()
  const models = new Map(); // `date\u0000model` -> emptyModel()
  const responses = new Map(); // `file\u0000id` -> record, largest output wins
  const stats = { files: 0, lines: 0, unparsable: 0, excludedSdk: 0, duplicates: 0 };

  const dayFor = (date) => {
    if (!days.has(date)) days.set(date, emptyDay());
    return days.get(date);
  };

  for (const file of listTranscripts(root)) {
    stats.files++;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      stats.lines++;

      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        stats.unparsable++;
        continue;
      }

      const date = (rec.timestamp || '').slice(0, 10);
      if (!date) continue;
      if (since && date < since) continue;

      // SDK-driven runs are scripts, not a person using Claude Code. A single
      // looping script would otherwise register hundreds of Prompts in a day.
      if (typeof rec.entrypoint === 'string' && rec.entrypoint.startsWith('sdk-')) {
        stats.excludedSdk++;
        continue;
      }

      if (rec.sessionId) dayFor(date).sessions.add(rec.sessionId);
      if (rec.version) {
        const day = dayFor(date);
        day.ccVersion = newerVersion(day.ccVersion, rec.version);
      }

      // Frequency: distinct promptId on main-chain user records. Subagent user
      // records repeat the parent's promptId, so they are excluded to keep the
      // count to things a person actually asked for.
      if (rec.type === 'user' && !rec.isSidechain && rec.promptId) {
        dayFor(date).prompts.add(rec.promptId);
        continue;
      }

      if (rec.type !== 'assistant') continue;
      const usage = rec.message && rec.message.usage;
      if (!usage) continue;

      // Dedupe key. requestId is the fallback for records carrying no
      // message.id; ids never span files, so the file is part of the key.
      const id = (rec.message && rec.message.id) || rec.requestId;
      if (!id) {
        // Nothing to dedupe against — count it as its own response.
        applyResponse(rec, models);
        continue;
      }

      const key = file + SEP + id;
      const existing = responses.get(key);
      if (!existing) {
        responses.set(key, rec);
      } else {
        stats.duplicates++;
        // Duplicates normally repeat an identical payload; where they differ it
        // looks like a streaming update, so the largest output wins.
        const a = existing.message.usage.output_tokens || 0;
        const b = usage.output_tokens || 0;
        if (b > a) responses.set(key, rec);
      }
    }
  }

  for (const rec of responses.values()) applyResponse(rec, models);

  return { days, models, stats };
}

function applyResponse(rec, models) {
  const date = (rec.timestamp || '').slice(0, 10);
  const model = rec.message && rec.message.model;
  if (!date || !model) return;

  const key = date + SEP + model;
  if (!models.has(key)) models.set(key, emptyModel(date, model));
  const bucket = models.get(key);

  const side = rec.isSidechain ? 'subagent' : 'main';
  if (rec.isSidechain) bucket.subagent_turns++;
  else bucket.turns++;

  const usage = rec.message.usage;
  for (const [src, dest] of TOKEN_FIELDS) {
    bucket[side][dest] += usage[src] || 0;
  }
}

module.exports = { aggregate, listTranscripts, newerVersion };
