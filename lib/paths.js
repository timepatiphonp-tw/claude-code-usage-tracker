'use strict';

// Every path the tracker owns inside a Root, in one place.

const path = require('path');

const INSTALL_DIR_NAME = 'usage-tracker';

function paths(root) {
  const hooks = path.join(root, 'hooks');
  return {
    root,
    hooks,
    // Installed copy of the code. Executed by the hook, never the clone the
    // Person ran setup from, so a push to the repo cannot run on their machine
    // until they deliberately re-run setup (ADR-0003).
    installDir: path.join(hooks, INSTALL_DIR_NAME),
    hookEntry: path.join(hooks, INSTALL_DIR_NAME, 'run-hook.js'),
    config: path.join(hooks, 'usage-tracker.config.json'),
    // The hook's own clone. Lives here rather than wherever the Person happened
    // to clone, so "clone it and forget it" is safe.
    repo: path.join(hooks, 'usage-repo'),
    log: path.join(hooks, 'usage-tracker.log'),
    lock: path.join(hooks, '.usage-tracker.lock'),
    // Set by every hook invocation, cleared by the worker before it starts a
    // round. If it reappears while a round is running, more fires arrived and the
    // worker goes again — so a burst collapses into one or two runs instead of
    // one per fire. In the IDE, SessionEnd fires on every chat switch.
    pending: path.join(hooks, '.usage-tracker.pending'),
    settings: path.join(root, 'settings.json'),
  };
}

module.exports = { paths, INSTALL_DIR_NAME };
