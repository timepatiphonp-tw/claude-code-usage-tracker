'use strict';

const { execFileSync } = require('child_process');

// Thin wrapper so every git call is explicit about its working directory and
// never inherits a shell.
function git(cwd, args, { allowFailure = false } = {}) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // Never block on a credential prompt.
    });
    return { ok: true, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    if (!allowFailure) throw new Error(`git ${args.join(' ')} failed: ${(err.stderr || err.message).trim()}`);
    return {
      ok: false,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || err.message || '').trim(),
      status: err.status,
    };
  }
}

const remoteUrl = (cwd) => git(cwd, ['remote', 'get-url', 'origin'], { allowFailure: true }).stdout || null;

// A repo created empty has a checkout with no commit, where pull --rebase errors
// and push needs -u. Better to say so at setup time than to fail in a hook.
const hasCommits = (cwd) => git(cwd, ['rev-parse', 'HEAD'], { allowFailure: true }).ok;

module.exports = { git, remoteUrl, hasCommits };
