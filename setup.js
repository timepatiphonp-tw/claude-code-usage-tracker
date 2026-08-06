#!/usr/bin/env node
'use strict';

// Installs the tracker into one Claude Code config directory (Root).
//
// Run it from a throwaway clone — this script makes its own clone at
// <root>/hooks/usage-repo/ and copies the code to <root>/hooks/usage-tracker/,
// so the directory you cloned into can be deleted afterwards.
//
// Re-running is the supported way to pick up a code update, change team, fix a
// name, or switch Root. See PLAN.md "Re-running setup" for the rules each step
// below exists to satisfy.
//
//   node setup.js
//   node setup.js --root=~/.claude-jetstar --team=platform --name="Alice Nguyen"

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const { discoverRoots, describeRoot, readAccount } = require('./lib/roots');
const { paths } = require('./lib/paths');
const { git, remoteUrl, hasCommits } = require('./lib/git');
const { registerHook } = require('./lib/settings');
const { acquire } = require('./lib/lock');

const HERE = __dirname;
const CODE_FILES = ['scrape.js', 'run-hook.js'];
const LIB_FILES = ['aggregate.js', 'csv.js', 'git.js', 'lock.js', 'paths.js', 'roots.js', 'rows.js', 'settings.js'];

const expand = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

async function choose(rl, label, options, { current } = {}) {
  console.log(`\n${label}`);
  options.forEach((opt, i) => {
    const mark = current !== undefined && opt.value === current ? '  ← currently configured' : '';
    console.log(`  ${i + 1}) ${opt.label}${mark}`);
  });
  // Deliberately no default: on a Root prompt, Enter-mashing must not select an
  // account. Picking the wrong Root can publish personal usage (ADR-0004).
  for (;;) {
    const answer = await ask(rl, `Choice [1-${options.length}]: `);
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
    console.log('Please enter one of the numbers listed.');
  }
}

// Read from the data-repo clone first, so adding a team is an ordinary commit
// rather than a new release. The package copy is only a fallback for the case
// where the clone has not happened yet.
function readTeams(repoDir) {
  const candidates = [repoDir && path.join(repoDir, 'teams.json'), path.join(HERE, 'teams.json')].filter(Boolean);
  for (const file of candidates) {
    let teams;
    try {
      teams = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(teams) || !teams.length || teams.some((t) => typeof t !== 'string')) {
      fail(`${file} must be a non-empty array of team-name strings.`);
    }
    return { teams, file };
  }
  fail(`Could not read teams.json (looked in ${candidates.join(', ')}).`);
}

// Run via `pnpx github:...` there is no clone to tidy up, so the closing advice
// must not tell people to delete one.
const ranFromGitClone = () => fs.existsSync(path.join(HERE, '.git'));

// Where to clone the data repo from. When run via `pnpx github:owner/repo` there
// is no local clone to read an origin from, so package.json is the source of
// truth; npm's `git+` prefix is not something git itself understands.
function resolveRepoUrl(explicit) {
  if (explicit) return explicit;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
    const url = pkg.repository && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url);
    if (url) return url.replace(/^git\+/, '');
  } catch {
    /* fall through */
  }
  return remoteUrl(HERE); // Running from a git clone.
}

const fail = (msg) => {
  console.error(`\nsetup failed: ${msg}`);
  process.exit(1);
};

function copyCode(installDir) {
  fs.mkdirSync(path.join(installDir, 'lib'), { recursive: true });
  for (const f of CODE_FILES) fs.copyFileSync(path.join(HERE, f), path.join(installDir, f));
  for (const f of LIB_FILES) fs.copyFileSync(path.join(HERE, 'lib', f), path.join(installDir, 'lib', f));
}

// Reuse an existing clone; never delete and re-clone. A clone can hold commits
// that failed to push, and rows are only recomputable inside the ~45-day
// transcript window — discarding an older unpushed row loses it for good.
function ensureRepo(repoDir, url) {
  if (fs.existsSync(repoDir)) {
    const found = remoteUrl(repoDir);
    if (!found) fail(`${repoDir} exists but is not a git clone. Move it aside and re-run.`);
    if (found !== url) {
      fail(`${repoDir} points at ${found}, not ${url}.\nMove it aside and re-run if you meant to change repo.`);
    }
    const pull = git(repoDir, ['pull', '--rebase'], { allowFailure: true });
    return { action: 'reused', pulled: pull.ok, note: pull.ok ? '' : pull.stderr.split('\n')[0] };
  }

  fs.mkdirSync(path.dirname(repoDir), { recursive: true });
  git(path.dirname(repoDir), ['clone', url, path.basename(repoDir)]);
  if (!hasCommits(repoDir)) {
    fail(
      `${url} has no commits, so the clone has no branch.\n` +
        'Push this project to it first — the hook cannot pull or push against an empty repo.'
    );
  }
  return { action: 'cloned', pulled: true, note: '' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = resolveRepoUrl(args['repo-url']);
  if (!url) fail('Could not determine the repo URL. Pass --repo-url=<url>.');

  const roots = discoverRoots();
  if (!roots.length) fail('No Claude Code config directories found (looked for ~/.claude* with a projects/ tree).');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // --- 1. Root -----------------------------------------------------------
    let root;
    if (args.root) {
      root = expand(args.root);
      if (!roots.some((r) => r.root === root)) {
        console.log(`Warning: ${root} was not auto-discovered. Continuing because you named it explicitly.`);
      }
    } else {
      const configuredElsewhere = roots.find((r) => fs.existsSync(paths(r.root).config));
      root = await choose(
        rl,
        'Which Claude Code config directory should be tracked?',
        roots.map((r) => ({ value: r.root, label: describeRoot(r) })),
        { current: configuredElsewhere && configuredElsewhere.root }
      );
    }

    const p = paths(root);
    if (!fs.existsSync(path.join(root, 'projects'))) {
      fail(`${root} has no projects/ directory — that is not a Claude Code config dir.`);
    }

    const account = readAccount(root);
    if (!account.email) {
      fail(`No authenticated account found for ${root}. Sign in to Claude Code there first.`);
    }

    // Setup writes files a running Scrape may be reading.
    const lock = acquire(p.lock);
    if (!lock.acquired) fail(`${lock.reason}. Wait a moment and re-run.`);

    try {
      const previous = fs.existsSync(p.config) ? JSON.parse(fs.readFileSync(p.config, 'utf8')) : null;

      // --- 2. Install the code and the data clone --------------------------
      // Done before the team prompt because teams.json is read from the clone,
      // so the roster is a commit away rather than a release away.
      copyCode(p.installDir);
      const repo = ensureRepo(p.repo, url);
      const { teams } = readTeams(p.repo);

      // --- 3. Team + 4. Name ----------------------------------------------
      const team =
        args.team ||
        (await choose(
          rl,
          'Which team are you on?',
          teams.map((t) => ({ value: t, label: t })),
          { current: previous && previous.team }
        ));
      if (!teams.includes(team)) fail(`"${team}" is not in teams.json (${teams.join(', ')}).`);

      let personName = args.name;
      while (!personName) {
        const suggested = (previous && previous.person_name) || '';
        personName = await ask(rl, `\nYour name${suggested ? ` [${suggested}]` : ''}: `) || suggested;
      }

      // install_date is written once. Resetting it on a re-run would make every
      // earlier date unscrapeable, so a day the hook failed could never be repaired.
      const installDate = (previous && previous.install_date) || new Date().toISOString().slice(0, 10);

      const config = {
        root,
        team,
        person_name: personName,
        person_email: account.email,
        organization_uuid: account.organizationUuid,
        install_date: installDate,
        repo: p.repo,
        repo_url: url,
        tracker_version: require('./lib/rows').TRACKER_VERSION,
        updated_at: new Date().toISOString(),
      };
      fs.writeFileSync(p.config, JSON.stringify(config, null, 2) + '\n');

      const hook = registerHook(p.settings, `node ${JSON.stringify(p.hookEntry)}`);

      // --- Report ----------------------------------------------------------
      console.log(`
Installed.

  root            ${root}
  person          ${personName} <${account.email}>
  team            ${team}
  install date    ${installDate}${previous ? '  (preserved from the previous install)' : ''}
  code            ${p.installDir}
  data clone      ${p.repo}  (${repo.action}${repo.pulled ? '' : ', pull failed: ' + repo.note})
  config          ${p.config}
  SessionEnd hook ${hook.action}${hook.otherHooks ? `, ${hook.otherHooks} unrelated SessionEnd hook(s) left alone` : ''}

${ranFromGitClone() ? 'The clone you ran this from is no longer needed — you can delete it.' : 'Nothing left behind: this ran from a temporary package cache.'}

Nothing is verified yet: your git identity, credentials and push permission are
first exercised when a session ends. Run a Claude Code session, then check:
  ${p.log}
  ${path.join(p.repo, 'logs')}
`);
    } finally {
      lock.release();
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => fail(err.message));
