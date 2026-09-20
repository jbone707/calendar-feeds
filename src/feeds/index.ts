import type { ExternalCalendar, Feed } from '../core/model.ts';
import { ufc } from './ufc/index.ts';

/**
 * Calendars this project builds. To add one: create src/feeds/<id>/ with a Feed (see src/core/model.ts and
 * docs/ADDING_A_FEED.md), add it here, and add tests. Each feed gets public/<id>.ics and data/<id>/.
 */
export const feeds: Feed[] = [ufc];

/**
 * Calendars someone else already publishes well. Check for one of these BEFORE building a feed:
 * an official feed is more accurate and needs no upkeep.
 */
export const externalCalendars: ExternalCalendar[] = [
  {
    name: 'San Francisco 49ers',
    note: 'The 49ers publish their own free calendar, so nothing here rebuilds it. It comes straight from 49ers.com and the team keeps it current.',
    host: 'www.49ers.com',
    path: '/api/addToCalendar/ag/s',
  },
];
