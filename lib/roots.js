'use strict';

// Discovery of Claude Code config directories (Roots) and the account each one
// is authenticated as. See CONTEXT.md for the definition of a Root.

const fs = require('fs');
const os = require('os');
const path = require('path');

// A Root is a config dir containing a projects/ tree. Candidates are ~/.claude*
// plus $CLAUDE_CONFIG_DIR, because a machine can hold several — on one real
// machine ~/.claude is a personal account and ~/.claude-jetstar a work one.
function discoverRoots() {
  const home = os.homedir();
  const candidates = new Set();

  for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.claude')) {
      candidates.add(path.join(home, entry.name));
    }
  }
  if (process.env.CLAUDE_CONFIG_DIR) {
    candidates.add(path.resolve(process.env.CLAUDE_CONFIG_DIR));
  }

  return [...candidates]
    .filter((dir) => fs.existsSync(path.join(dir, 'projects')))
    .sort()
    .map((dir) => ({ root: dir, ...readAccount(dir) }));
}

// The authenticated identity for a Root. `email` is the join key for every
// rollup; `organizationUuid` is what tells a work account from a personal one,
// which is why setup surfaces it in the prompt.
function readAccount(root) {
  for (const file of accountFilesFor(root)) {
    try {
      const account = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount;
      if (account && account.emailAddress) {
        return {
          email: account.emailAddress,
          organizationUuid: account.organizationUuid || null,
          billingType: account.billingType || null,
          accountFile: file,
        };
      }
    } catch {
      // Missing or unreadable: try the next candidate.
    }
  }
  return { email: null, organizationUuid: null, billingType: null, accountFile: null };
}

// The default root keeps its account file OUTSIDE the directory, at
// ~/.claude.json; a root named by CLAUDE_CONFIG_DIR keeps it inside. The
// sibling fallback is deliberately scoped to the default root only — a general
// "look in the parent directory" fallback would hand a work root the personal
// account's identity whenever its own file was missing, which is precisely the
// misattribution ADR-0004 is about.
function accountFilesFor(root) {
  const candidates = [path.join(root, '.claude.json')];
  if (path.basename(root) === '.claude') {
    candidates.push(path.join(path.dirname(root), '.claude.json'));
  }
  return candidates;
}

function describeRoot({ root, email, organizationUuid, billingType }) {
  const org = organizationUuid ? organizationUuid.slice(0, 8) + '…' : 'unknown org';
  const bits = [email || 'not signed in', `org ${org}`];
  if (billingType) bits.push(billingType);
  return `${root}  —  ${bits.join('  —  ')}`;
}

module.exports = { discoverRoots, readAccount, describeRoot };
