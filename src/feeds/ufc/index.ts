import type { Feed } from '../../core/model.ts';
import { checkEventPage, fetchSchedule } from './source.ts';

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
  crawlDelayMs: 15_000, // ufc.com robots.txt: crawl-delay 15
  fetch: fetchSchedule,
  checkPage: checkEventPage,
};
