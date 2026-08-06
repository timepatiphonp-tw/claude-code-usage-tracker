#!/usr/bin/env node
'use strict';

// Standalone data collection. Reads a Root's transcripts and prints or writes
// the two CSVs. No git, no hook — those come later; this is the part that has to
// be right, so it is runnable and inspectable on its own.
//
//   node scrape.js --list-roots
//   node scrape.js --root=~/.claude-jetstar --team=platform --name="Alice N."
//   node scrape.js --root=... --team=... --name=... --since=2026-08-01 --out=logs

const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverRoots, readAccount, describeRoot } = require('./lib/roots');
const { aggregate } = require('./lib/aggregate');
const { buildRows, TRACKER_VERSION } = require('./lib/rows');
const csv = require('./lib/csv');

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
    else args._.push(arg);
  }
  return args;
}

const expand = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['list-roots']) {
    const roots = discoverRoots();
    if (!roots.length) {
      console.error('No Claude Code config directories found.');
      process.exit(1);
    }
    for (const r of roots) console.log(describeRoot(r));
    return;
  }

  if (!args.root) {
    console.error('usage: scrape.js --root=<dir> --team=<team> --name=<name> [--since=YYYY-MM-DD] [--out=<dir>]');
    console.error('       scrape.js --list-roots');
    process.exit(2);
  }

  const root = expand(args.root);
  if (!fs.existsSync(path.join(root, 'projects'))) {
    console.error(`Not a Claude Code config directory (no projects/): ${root}`);
    process.exit(1);
  }

  const account = readAccount(root);
  const personEmail = args.email || account.email;
  if (!personEmail) {
    console.error(`No authenticated account found in ${root}/.claude.json — pass --email to override.`);
    process.exit(1);
  }

  const team = args.team || '';
  const personName = args.name || personEmail;

  const started = Date.now();
  const result = aggregate({ root, since: args.since || null });
  const rows = buildRows(result, { team, personName, personEmail });
  const elapsed = Date.now() - started;

  const s = result.stats;
  const totals = rows.models.reduce(
    (acc, r) => {
      acc.turns += r.turns;
      acc.subagentTurns += r.subagent_turns;
      acc.output += r.main_output_tokens + r.subagent_output_tokens;
      return acc;
    },
    { turns: 0, subagentTurns: 0, output: 0 }
  );
  const prompts = rows.daily.reduce((n, r) => n + r.prompts, 0);

  console.error(
    [
      `root            ${root}`,
      `person          ${personName} <${personEmail}>${team ? `  team=${team}` : ''}`,
      `since           ${args.since || '(all dates)'}`,
      `transcripts     ${s.files} files, ${s.lines} lines, ${s.unparsable} unparsable`,
      `deduped         ${s.duplicates} duplicate response records collapsed`,
      `excluded        ${s.excludedSdk} sdk-* records`,
      `active days     ${rows.daily.length}`,
      `prompts         ${prompts}`,
      `turns           ${totals.turns} main, ${totals.subagentTurns} subagent`,
      `output tokens   ${totals.output.toLocaleString('en-US')}`,
      `model rows      ${rows.models.length}`,
      `elapsed         ${elapsed}ms   tracker ${TRACKER_VERSION}`,
    ].join('\n')
  );

  if (!args.out) {
    console.log(`# ${path.join('logs', `${slug(personName)}.daily.csv`)}`);
    console.log(csv.DAILY_COLUMNS.join(','));
    for (const r of rows.daily) console.log(csv.DAILY_COLUMNS.map((c) => csv.encodeField(r[c])).join(','));
    console.log(`\n# ${path.join('logs', `${slug(personName)}.models.csv`)}`);
    console.log(csv.MODEL_COLUMNS.join(','));
    for (const r of rows.models) console.log(csv.MODEL_COLUMNS.map((c) => csv.encodeField(r[c])).join(','));
    return;
  }

  const base = slug(personName);
  const dailyFile = path.join(expand(args.out), `${base}.daily.csv`);
  const modelFile = path.join(expand(args.out), `${base}.models.csv`);
  const a = csv.writeRows(dailyFile, csv.DAILY_COLUMNS, rows.daily, csv.dailyKey);
  const b = csv.writeRows(modelFile, csv.MODEL_COLUMNS, rows.models, csv.modelKey);
  console.error(
    `\nwrote ${dailyFile}  (${a.replaced} replaced, ${a.preserved} preserved, ${a.total} total)` +
      `\nwrote ${modelFile}  (${b.replaced} replaced, ${b.preserved} preserved, ${b.total} total)`
  );
}

main();
