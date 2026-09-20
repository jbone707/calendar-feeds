import ical, { ICalCalendarMethod, ICalEventStatus, ICalEventTransparency } from 'ical-generator';
import { httpsUrl } from '../config.ts';
import type { Feed, FeedEvent } from './model.ts';

type FeedShape = Pick<Feed, 'id' | 'name' | 'description' | 'sourceName' | 'startLabel' | 'durationHours'>;

export const pacific = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));

function describe(feed: FeedShape, e: FeedEvent): string {
  const lines: string[] = [];
  if (e.status === 'cancelled') lines.push(`${feed.sourceName} removed this from its schedule. It may have been cancelled or postponed.`, '');
  if (e.startUtc) {
    lines.push(`${feed.startLabel}: ${pacific(e.startUtc)} (per ${feed.sourceName})`);
    lines.push(`This entry starts at that time. The end time is a ${feed.durationHours}-hour estimate, not an official time.`);
  } else {
    lines.push('The start time has not been published yet. This all-day entry will become a timed one when it is.');
  }
  for (const t of e.extraTimes) lines.push(`${t.label}: ${pacific(t.utc)}`);
  lines.push('', 'Times shown in Pacific. Your calendar converts the entry itself to wherever you are.');
  lines.push(`Source: ${e.url}`);
  return lines.join('\n');
}

/** Deterministic: the same events always produce byte-identical output, so unchanged runs do not churn the calendar. */
export function renderCalendar(feed: FeedShape, events: FeedEvent[]): string {
  const cal = ical({
    name: feed.name,
    description: feed.description,
    prodId: { company: 'jbone707', product: `calendar-feeds-${feed.id}`, language: 'EN' },
    method: ICalCalendarMethod.PUBLISH,
    ttl: 6 * 3600,
    url: httpsUrl(''),
  });

  for (const e of events) {
    if (!e.localEventDate) continue; // no date at all: nothing honest to publish yet
    const cancelled = e.status === 'cancelled';
    const common = {
      id: e.uid,
      sequence: e.sequence,
      stamp: new Date(e.lastModified),
      created: new Date(e.createdAt),
      lastModified: new Date(e.lastModified),
      location: e.location ?? undefined,
      description: describe(feed, e),
      url: e.url,
      transparency: ICalEventTransparency.TRANSPARENT,
      status: cancelled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
    };
    if (e.startUtc) {
      const start = new Date(e.startUtc);
      cal.createEvent({
        ...common,
        summary: `${cancelled ? 'Cancelled: ' : ''}${e.title}`,
        start,
        end: new Date(start.getTime() + feed.durationHours * 3_600_000),
      });
    } else {
      const day = Date.parse(`${e.localEventDate}T00:00:00Z`);
      cal.createEvent({
        ...common,
        summary: `${cancelled ? 'Cancelled: ' : ''}${e.title} (time TBD)`,
        allDay: true,
        start: new Date(day),
        end: new Date(day + 86_400_000), // DTEND is exclusive for all-day entries: the day after
      });
    }
  }
  return cal.toString();
}

/** Cheap structural check run before every publish. */
export function checkIcs(ics: string, expectedEvents: number): string | null {
  if (!ics.startsWith('BEGIN:VCALENDAR') || !ics.trimEnd().endsWith('END:VCALENDAR')) return 'Calendar wrapper missing.';
  const count = (ics.match(/^BEGIN:VEVENT\r?$/gm) ?? []).length;
  if (count !== expectedEvents) return `Expected ${expectedEvents} entries, rendered ${count}.`;
  if (/[^\r]\n/.test(ics)) return 'Bare line feed found; iCalendar needs CRLF.';
  for (const line of ics.split('\r\n')) if (Buffer.byteLength(line, 'utf8') > 75) return 'A line exceeds 75 bytes unfolded.';
  const uids = ics.match(/^UID:.*$/gm) ?? [];
  if (new Set(uids).size !== uids.length) return 'Duplicate UID in output.';
  return null;
}
