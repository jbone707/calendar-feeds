import type { Feed } from '../../core/model.ts';
import { enrichUfc, ufcFacts } from './details.ts';
import { checkEventPage, fetchSchedule } from './source.ts';

const CRAWL_DELAY_MS = 15_000; // ufc.com robots.txt: crawl-delay 15

export const ufc: Feed = {
  id: 'ufc',
  name: 'UFC Events',
  description: 'UFC numbered events and Fight Nights. Starts at the main card. Updated automatically.',
  about:
    'Start times come from the main-card time UFC.com publishes for each card. Prelim times are in each entry\'s notes. The end time is a three-hour estimate. A card with a date but no published time appears as an all-day entry marked time TBD, and becomes a timed entry later without creating a duplicate. Contender Series, Road to UFC, The Ultimate Fighter, and UFC BJJ are left out.',
  sourceName: 'UFC.com',
  startLabel: 'Main card',
  durationHours: 3,
  dateTimeZone: 'America/New_York', // UFC advertises cards by their US Eastern date
  extraTimesPrecedeStart: true, // prelims always come before the main card
  crawlDelayMs: CRAWL_DELAY_MS,
  fetch: fetchSchedule,
  checkPage: checkEventPage,
  enrich: (events, details, now) => enrichUfc(events, details, now, CRAWL_DELAY_MS),
  facts: ufcFacts,
  writerBrief:
    'The readers are two casual UFC fans who have started watching much more often and want to become knowledgeable over time. Explain what is at stake in the headline fights, who the fighters are in one phrase each (champion, former champion, rising prospect, veteran, striker or grappler), and any storyline such as a rematch, a rivalry, a comeback, or a title shot on the line. Where a fighter appeared on one of the recent cards listed, say so, so the readers connect it to what they have already watched. Define any jargon the first time in a few words. Never mention betting odds.',
};
