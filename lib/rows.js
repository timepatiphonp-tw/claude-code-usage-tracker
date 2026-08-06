'use strict';

// Turns the aggregate's Maps into the two row shapes that get written.

const TRACKER_VERSION = '0.1.0';

function buildRows({ days, models }, { team, personName, personEmail }) {
  const daily = [...days.entries()]
    .map(([date, day]) => ({
      date,
      team,
      person_name: personName,
      person_email: personEmail,
      cc_version: day.ccVersion || '',
      tracker_version: TRACKER_VERSION,
      prompts: day.prompts.size,
      sessions: day.sessions.size,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const modelRows = [...models.values()]
    .map((m) => {
      return {
        date: m.date,
        person_email: personEmail,
        model: m.model,
        turns: m.turns,
        subagent_turns: m.subagent_turns,
        main_input_tokens: m.main.input,
        main_output_tokens: m.main.output,
        main_cache_creation_tokens: m.main.cache_creation,
        main_cache_read_tokens: m.main.cache_read,
        subagent_input_tokens: m.subagent.input,
        subagent_output_tokens: m.subagent.output,
        subagent_cache_creation_tokens: m.subagent.cache_creation,
        subagent_cache_read_tokens: m.subagent.cache_read,
      };
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.model < b.model ? -1 : 1;
    });

  return { daily, models: modelRows };
}

module.exports = { buildRows, TRACKER_VERSION };
