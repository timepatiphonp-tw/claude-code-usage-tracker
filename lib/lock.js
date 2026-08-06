'use strict';

// Serialises git operations in the hook's clone.
//
// The DATA needs no protection: two concurrent Scrapes read the same transcripts
// and compute identical rows, and writes are atomic renames. The WORKING TREE
// does — overlapping pull --rebase / commit / push can leave the clone stuck
// mid-rebase, which persists and makes every later Scrape fail.
//
// The lock therefore has to fail open. A run killed mid-flight (sleep, crash,
// kill -9) leaves the file behind, and a naive lock would then block every future
// Scrape silently, forever — the same silent death by another route. So a lock is
// ignored when its process is gone or when it is simply too old.

const fs = require('fs');

const STALE_AFTER_MS = 5 * 60 * 1000;

function processAlive(pid) {
  try {
    process.kill(pid, 0); // Signal 0 tests existence without touching the process.
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // Alive, just owned by someone else.
  }
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @returns {{acquired: boolean, release?: () => void, heldBy?: object, reason?: string}}
 */
function acquire(file, { now = Date.now() } = {}) {
  fs.mkdirSync(require('path').dirname(file), { recursive: true }); // hooks/ may not exist on a first install.

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // wx fails if the file exists — the atomic part.
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }));
      fs.closeSync(fd);
      return {
        acquired: true,
        release: () => {
          try {
            fs.unlinkSync(file);
          } catch {
            /* already gone */
          }
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      const held = readLock(file);
      const age = held && held.at ? now - Date.parse(held.at) : Infinity;
      const dead = !held || !held.pid || !processAlive(held.pid);
      const tooOld = !(age >= 0) || age > STALE_AFTER_MS;

      if (dead || tooOld) {
        // Break it and retry once.
        try {
          fs.unlinkSync(file);
        } catch {
          /* someone else broke it first */
        }
        continue;
      }
      return { acquired: false, heldBy: held, reason: 'another scrape is running' };
    }
  }
  return { acquired: false, reason: 'could not take the lock after breaking a stale one' };
}

module.exports = { acquire, STALE_AFTER_MS };
