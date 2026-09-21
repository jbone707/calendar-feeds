import type { Feed } from '../../core/model.ts';
import { fetchTeamCalendar, ninersFacts } from './source.ts';

export const niners: Feed = {
  id: 'niners',
  name: '49ers Games',
  description: 'San Francisco 49ers games, read from the team\'s own calendar, with plain-English context added.',
  about:
    'Games and kickoff times come from the calendar the 49ers publish on 49ers.com, so flexed game times follow the team. The end time is a three-hour estimate. Home or away, division rival, and prime-time notes are worked out from the matchup and kickoff time. A game the league has not scheduled yet does not appear until the team lists it.',
  sourceName: '49ers.com',
  startLabel: 'Kickoff',
  durationHours: 3,
  dateTimeZone: 'America/Los_Angeles',
  extraTimesPrecedeStart: false,
  crawlDelayMs: 0, // one request per run to a published calendar file
  fetch: fetchTeamCalendar,
  facts: ninersFacts,
  writerBrief:
    'The reader is new to football. In plain words, say what this game means for the 49ers season right now: their record and place in the NFC West, how good the opponent is, and what a win or a loss would do. Only when it is actually true, state playoff stakes bluntly, for example "win and they clinch a playoff spot" or "lose and they are eliminated". Early in the season, say honestly that no single game decides anything yet and explain what to watch for instead. Name one or two players worth watching and why, in a phrase each. Define any jargon in a few words. Never mention betting odds or point spreads.',
};
