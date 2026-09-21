import ical, { ICalCalendarMethod, ICalEventStatus, ICalEventTransparency } from 'ical-generator';
import { httpsUrl } from '../config.ts';
import type { EventFacts, EventNote, Feed, FeedEvent } from './model.ts';

type FeedShape = Pick<Feed, 'id' | 'sourceName' | 'startLabel' | 'durationHours'>;

/** One calendar entry: the event, the feed it came from, and whatever facts and write-up exist for it. */
export type Entry = { feed: FeedShape; event: FeedEvent; facts: EventFacts | null; note: EventNote | null };
export type CalendarMeta = { id: string; name: string; description: string };

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

export function describe({ feed, event: e, facts, note }: Entry): string {
  const lines: string[] = [];
  if (e.status === 'cancelled') lines.push(`${feed.sourceName} removed this from its schedule. It may have been cancelled or postponed.`, '');
  if (facts?.level) lines.push(facts.level, '');
  if (note && e.status !== 'cancelled') {
    lines.push('WHY IT MATTERS', note.why, '');
    if (note.know) lines.push('WORTH KNOWING', note.know, '');
  }
  if (facts && facts.lines.length > 0) lines.push('THE FACTS', ...facts.lines.map((l) => `• ${l}`), '');
  if (e.startUtc) {
    lines.push(`${feed.startLabel}: ${pacific(e.startUtc)} (per ${feed.sourceName})`);
    for (const t of e.extraTimes) lines.push(`${t.label}: ${pacific(t.utc)}`);
    lines.push(`The end time is a ${feed.durationHours}-hour estimate, not an official time.`);
  } else {
    lines.push('The start time has not been published yet. This all-day entry will become a timed one when it is.');
    for (const t of e.extraTimes) lines.push(`${t.label}: ${pacific(t.utc)}`);
  }
  lines.push('Times shown in Pacific. Your calendar converts the entry itself to wherever you are.', '', `Source: ${e.url}`);
  if (note && e.status !== 'cancelled')
    lines.push(`The write-up was written by AI from public information and can contain mistakes. Times and facts come from ${feed.sourceName}.`);
  return lines.join('\n');
}

const latest = (...isos: (string | null | undefined)[]) => isos.filter((x): x is string => !!x).sort().slice(-1)[0];

/** Deterministic: the same inputs always produce byte-identical output, so unchanged runs do not churn the calendar. */
export function renderCalendar(meta: CalendarMeta, entries: Entry[]): string {
  const cal = ical({
    name: meta.name,
    description: meta.description,
    prodId: { company: 'jbone707', product: `calendar-feeds-${meta.id}`, language: 'EN' },
    method: ICalCalendarMethod.PUBLISH,
    ttl: 6 * 3600,
    url: httpsUrl(''),
  });

  const sorted = [...entries].sort((a, b) =>
    (a.event.startUtc ?? a.event.localEventDate ?? '9').localeCompare(b.event.startUtc ?? b.event.localEventDate ?? '9') || a.event.uid.localeCompare(b.event.uid),
  );
  for (const entry of sorted) {
    const { feed, event: e, facts, note } = entry;
    if (!e.localEventDate) continue; // no date at all: nothing honest to publish yet
    const cancelled = e.status === 'cancelled';
    // Facts and write-ups change the notes without being a schedule change, so they move the timestamps but not SEQUENCE.
    const touched = new Date(latest(e.lastModified, facts?.updatedAt, note?.generatedAt));
    const title = `${cancelled ? 'Cancelled: ' : ''}${facts?.badge ? `${facts.badge} ` : ''}${e.title}`;
    const common = {
      id: e.uid,
      sequence: e.sequence,
      stamp: touched,
      created: new Date(e.createdAt),
      lastModified: touched,
      location: e.location ?? undefined,
      description: describe(entry),
      url: e.url,
      transparency: ICalEventTransparency.TRANSPARENT,
      status: cancelled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
    };
    if (e.startUtc) {
      const start = new Date(e.startUtc);
      cal.createEvent({ ...common, summary: title, start, end: new Date(start.getTime() + feed.durationHours * 3_600_000) });
    } else {
      const day = Date.parse(`${e.localEventDate}T00:00:00Z`);
      // DTEND is exclusive for all-day entries: the day after
      cal.createEvent({ ...common, summary: `${title} (time TBD)`, allDay: true, start: new Date(day), end: new Date(day + 86_400_000) });
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
