#!/usr/bin/env node
'use strict';

// The SessionEnd hook entry point.
//
// Scrapes the configured Root, rewrites this Person's two CSVs in the hook's own
// clone, and pushes. Every path fails QUIETLY — a tracker must never break
// someone's session — so the log file is the only record of what happened, and
// the only way to tell a broken install from an unused one.
//
// Correctness rests on the Scrape being idempotent: rows are recomputed from the
// transcripts and replaced, so a failed push, a lost race or a sleeping laptop is
// corrected by the next run. Nothing is queued and nothing is lost.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { paths } = require('./lib/paths');
const { aggregate } = require('./lib/aggregate');
const { buildRows } = require('./lib/rows');
const csv = require('./lib/csv');
const { git } = require('./lib/git');
const { acquire } = require('./lib/lock');

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function loadConfig() {
  // The config sits one level up from the installed code.
  const configPath = path.join(__dirname, '..', 'usage-tracker.config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function appendLog(file, fields) {
  const line =
    [new Date().toISOString(), ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)].join(' ') + '\n';
  try {
    fs.appendFileSync(file, line);
  } catch {
    /* nothing left to do if even the log fails */
  }
}

function main() {
  const config = loadConfig();
  const p = paths(config.root);

  const lock = acquire(p.lock);
  if (!lock.acquired) {
    // Another Scrape is mid-flight. It recomputes the whole day anyway, so this
    // session's data is covered — there is nothing to defer.
    appendLog(p.log, { result: 'skipped', reason: 'locked' });
    return;
  }

  try {
    const started = Date.now();
    const result = aggregate({ root: config.root, since: config.install_date });
    const rows = buildRows(result, {
      team: config.team,
      personName: config.person_name,
      personEmail: config.person_email,
    });

    const base = slug(config.person_name);
    const logsDir = path.join(p.repo, 'logs');
    const dailyFile = path.join(logsDir, `${base}.daily.csv`);
    const modelFile = path.join(logsDir, `${base}.models.csv`);

    // Rebase before writing, so the write lands on top of teammates' commits and
    // the push is a fast-forward. Failure here is not fatal: the push below may
    // still succeed, and if it does not, the next run retries from scratch.
    const pull = git(p.repo, ['pull', '--rebase'], { allowFailure: true });

    const a = csv.writeRows(dailyFile, csv.DAILY_COLUMNS, rows.daily, csv.dailyKey);
    const b = csv.writeRows(modelFile, csv.MODEL_COLUMNS, rows.models, csv.modelKey);

    // Only ever stage our own two files. Never `git add -A`.
    const toAdd = [dailyFile, modelFile].filter((f) => fs.existsSync(f)).map((f) => path.relative(p.repo, f));
    if (!toAdd.length) {
      appendLog(p.log, { result: 'ok', rows: 0, note: 'no-activity-since-install' });
      return;
    }
    git(p.repo, ['add', '--', ...toAdd], { allowFailure: true });

    const commit = git(
      p.repo,
      ['commit', '-m', `usage: ${config.person_name} ${new Date().toISOString().slice(0, 10)}`, '--', ...toAdd],
      { allowFailure: true }
    );
    // "nothing to commit" is success: the day's numbers were already current.
    const nothingToCommit = !commit.ok && /nothing to commit|no changes added/i.test(commit.stdout + commit.stderr);

    // Push unconditionally, never only when a commit was just made. An earlier
    // run may have committed and then failed to push; if push were gated on a
    // fresh commit, that commit would sit unpushed until new activity happened to
    // produce another one — recomputed correctly, but never leaving the machine.
    // With nothing to send, git exits 0 with "Everything up-to-date".
    const push = git(p.repo, ['push'], { allowFailure: true });

    // Surfaced in the log so a clone stuck ahead of its remote is visible rather
    // than hiding behind result=ok.
    const ahead = git(p.repo, ['rev-list', '--count', '@{upstream}..HEAD'], { allowFailure: true });

    const unpushed = Number(ahead.stdout) || 0;

    appendLog(p.log, {
      result: !push.ok ? 'push-failed' : unpushed ? 'unpushed' : 'ok',
      unpushed,
      days: rows.daily.length,
      prompts: rows.daily.reduce((n, r) => n + r.prompts, 0),
      model_rows: rows.models.length,
      daily: `${a.replaced}/${a.total}`,
      models: `${b.replaced}/${b.total}`,
      deduped: result.stats.duplicates,
      excluded_sdk: result.stats.excludedSdk,
      committed: commit.ok ? 'yes' : nothingToCommit ? 'unchanged' : 'failed',
      pulled: pull.ok ? 'yes' : 'no',
      ms: Date.now() - started,
      ...(push.ok ? {} : { error: JSON.stringify(push.stderr.split('\n')[0]) }),
      ...(commit.ok || nothingToCommit ? {} : { commit_error: JSON.stringify(commit.stderr.split('\n')[0]) }),
    });
  } catch (err) {
    appendLog(p.log, { result: 'error', error: JSON.stringify(String(err.message || err)) });
  } finally {
    lock.release();
  }
}

// Detach for real.
//
// SessionEnd runs while the session is closing, and Claude Code cancels a hook
// that does not return promptly — "SessionEnd hook failed: Hook cancelled". The
// work here is ~7s, nearly all of it a git round-trip to the remote, so it cannot
// be done inline. The hook invocation therefore re-spawns this same file as a
// detached worker and exits immediately; the worker outlives the session.
function spawnWorker() {
  const child = spawn(process.execPath, [__filename, '--worker'], {
    detached: true, // New process group, so it survives the session's exit.
    stdio: 'ignore', // No pipes, or the parent would wait on them.
  });
  child.unref(); // Let this process exit without waiting for the child.
}

try {
  if (process.argv.includes('--worker')) main();
  else spawnWorker();
} catch (err) {
  // Last resort: a tracker must never fail a session exit.
  if (process.env.USAGE_TRACKER_DEBUG) console.error(err);
}
process.exitCode = 0;

