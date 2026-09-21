import type { CombinedCalendar, ExternalCalendar, Feed } from '../core/model.ts';
import { niners } from './niners/index.ts';
import { ufc } from './ufc/index.ts';

/**
 * Calendars this project builds. To add one: create src/feeds/<id>/ with a Feed (see src/core/model.ts and
 * docs/ADDING_A_FEED.md), add it here, and add tests. Each feed gets public/<id>.ics and data/<id>/.
 */
export const feeds: Feed[] = [ufc, niners];

/**
 * Calendars made by merging feeds. "sports" is the household one: a single calendar, so it is one colour and one
 * switch on a phone, and one address for a shared display such as a Skylight.
 */
export const combined: CombinedCalendar[] = [
  {
    id: 'sports',
    name: 'Sports',
    description: 'UFC cards and 49ers games in one calendar, with plain-English notes on why each one matters.',
    feedIds: ['ufc', 'niners'],
  },
];

/**
 * Calendars someone else already publishes well and that need nothing added. Check for one of these BEFORE
 * building a feed. (The 49ers started here; they became a feed only so their games could carry notes and join "sports".)
 */
export const externalCalendars: ExternalCalendar[] = [];
