'use strict';

// Registers the SessionEnd hook in a Root's settings.json.
//
// Merged, never overwritten: the file holds the Person's own hooks and
// preferences. Our entry is matched by its command containing the marker and
// REPLACED — appending instead would add another entry on every update, and the
// scraper would run N times per session exit.

const fs = require('fs');

const MARKER = 'usage-tracker';
const EVENT = 'SessionEnd';

function readSettings(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const isOurs = (entry) =>
  Array.isArray(entry && entry.hooks) &&
  entry.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARKER));

/**
 * @returns {{action: 'added'|'replaced', otherHooks: number}}
 */
function registerHook(file, command) {
  const settings = readSettings(file);
  settings.hooks = settings.hooks || {};
  const existing = Array.isArray(settings.hooks[EVENT]) ? settings.hooks[EVENT] : [];

  const ours = { matcher: '', hooks: [{ type: 'command', command }] };
  const others = existing.filter((entry) => !isOurs(entry));
  const action = others.length === existing.length ? 'added' : 'replaced';

  settings.hooks[EVENT] = [...others, ours];

  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, file);

  return { action, otherHooks: others.length };
}

module.exports = { registerHook, readSettings, MARKER, EVENT };
