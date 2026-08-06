'use strict';

// CSV read/merge/write.
//
// A Scrape recomputes every date still present in the transcripts and replaces
// those rows. Rows for OLDER dates exist only in the file — transcripts are
// pruned after roughly 45 days — so writing means: read what is there, drop the
// rows whose key we recomputed, merge ours in, rewrite the file whole.
//
// Rewriting whole (rather than appending) is also what makes the header appear
// exactly once and makes a re-run byte-identical.

const fs = require('fs');
const path = require('path');

const DAILY_COLUMNS = [
  'date',
  'team',
  'person_name',
  'person_email',
  'cc_version',
  'tracker_version',
  'prompts',
  'sessions',
];

const MODEL_COLUMNS = [
  'date',
  'person_email',
  'model',
  'turns',
  'subagent_turns',
  'main_input_tokens',
  'main_output_tokens',
  'main_cache_creation_tokens',
  'main_cache_read_tokens',
  'subagent_input_tokens',
  'subagent_output_tokens',
  'subagent_cache_creation_tokens',
  'subagent_cache_read_tokens',
];

function encodeField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

// Returns rows as objects keyed by the file's own header, so a file written by
// an older tracker_version is read back without losing columns we do not know.
function readRows(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return []; // First run: no file yet.
  }
  // Strip CR as well as LF. On Windows, git's core.autocrlf rewrites these files
  // to CRLF on checkout, and splitting on \n alone leaves a trailing \r on the
  // LAST column — turning `sessions` into "1\r", which then never matches the
  // freshly computed value, so the file churns on every run.
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    header.forEach((name, i) => {
      row[name] = values[i] !== undefined ? values[i] : '';
    });
    return row;
  });
}

/**
 * Replace the rows whose key appears in `fresh`, keep everything else, sort, write.
 *
 * @param {string} file
 * @param {string[]} columns
 * @param {object[]} fresh      Rows this Scrape computed.
 * @param {(row: object) => string} keyOf
 */
function writeRows(file, columns, fresh, keyOf) {
  // Nothing computed and nothing on disk: do not create a header-only file. A
  // Person who installed but has not used Claude Code since should not produce a
  // commit at all.
  if (!fresh.length && !fs.existsSync(file)) {
    return { total: 0, replaced: 0, preserved: 0, skipped: true };
  }

  const replacing = new Set(fresh.map(keyOf));
  const kept = readRows(file).filter((row) => !replacing.has(keyOf(row)));

  const all = [...kept, ...fresh].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const body = all.map((row) => columns.map((c) => encodeField(row[c])).join(','));
  const text = [columns.join(','), ...body].join('\n') + '\n';

  fs.mkdirSync(path.dirname(file), { recursive: true }); // logs/ does not exist on a new repo.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file); // Atomic, so a concurrent reader never sees half a file.

  return { total: all.length, replaced: fresh.length, preserved: kept.length };
}

const dailyKey = (row) => `${row.date} ${row.person_email}`;
const modelKey = (row) => `${row.date} ${row.person_email} ${row.model}`;

module.exports = {
  DAILY_COLUMNS,
  MODEL_COLUMNS,
  readRows,
  writeRows,
  dailyKey,
  modelKey,
  encodeField,
  parseLine,
};
