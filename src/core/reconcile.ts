import { randomUUID } from 'node:crypto';
import { uidDomain } from '../config.ts';
import { CANCEL_STRIKES, RETENTION_DAYS } from './model.ts';
import type { Feed, FeedEvent, PageCheck, SourceRecord } from './model.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Calendar date of an instant in a given zone, as YYYY-MM-DD. */
export function dateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** The moment after which we stop touching an event. */
function endOfInterest(e: Pick<FeedEvent, 'startUtc' | 'localEventDate'>): number | null {
  if (e.startUtc) return Date.parse(e.startUtc) + 6 * HOUR;
  if (e.localEventDate) return Date.parse(`${e.localEventDate}T00:00:00Z`) + 2 * DAY;
  return null;
}

const visibleKey = (e: FeedEvent) => JSON.stringify([e.title, e.localEventDate, e.startUtc, e.extraTimes, e.location, e.status]);

export type ReconcileResult = {
  events: FeedEvent[];
  report: string[]; // human-readable changes
  warnings: string[];
  needsPageCheck: string[]; // source ids of future events that vanished from the list
  stats: { previousFuture: number; previousFutureMissing: number; incoming: number };
};

type FeedShape = Pick<Feed, 'id' | 'dateTimeZone' | 'sourceName' | 'startLabel'>;

export function reconcileEvents(
  feed: FeedShape,
  previous: FeedEvent[],
  incoming: SourceRecord[],
  now: Date,
  pageChecks: Map<string, PageCheck> = new Map(),
): ReconcileResult {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const report: string[] = [];
  const warnings: string[] = [];
  const events: FeedEvent[] = previous.map((e) => ({ ...e, aliases: [...e.aliases], extraTimes: e.extraTimes.map((t) => ({ ...t })), provenance: { ...e.provenance } }));
  const wasKnown = new Set(previous.map((p) => p.uid));

  // An official redirect from an old id to a new one is recorded as an alias before matching.
  for (const e of events) {
    const check = pageChecks.get(e.sourceId);
    if (check?.kind === 'moved' && !e.aliases.includes(check.sourceId)) e.aliases.push(check.sourceId);
  }

  const matched = new Map<FeedEvent, SourceRecord>();
  const unmatched: SourceRecord[] = [];
  for (const r of incoming) {
    const hit =
      events.find((e) => e.key === r.key && !matched.has(e)) ?? events.find((e) => e.aliases.includes(r.sourceId) && !matched.has(e));
    if (hit) matched.set(hit, r);
    else unmatched.push(r);
  }

  // Renamed upstream: only accepted when exactly one vanished future event fits.
  const stillNew: SourceRecord[] = [];
  for (const r of unmatched) {
    const recDate = r.startUtc ? dateInZone(r.startUtc, feed.dateTimeZone) : r.fallbackDate;
    const candidates = events.filter((e) => {
      if (matched.has(e) || e.status === 'completed') return false;
      const end = endOfInterest(e);
      if (end !== null && end < nowMs) return false;
      const sameHint = !!r.matchHint && e.matchHint === r.matchHint;
      const sameDateAndPlace = !!recDate && e.localEventDate === recDate && !!r.location && e.location === r.location;
      return sameHint || sameDateAndPlace;
    });
    if (candidates.length === 1) {
      matched.set(candidates[0], r);
      report.push(`${candidates[0].title}: ${feed.sourceName} renamed its page to ${r.sourceId}; kept the same calendar entry.`);
    } else stillNew.push(r);
  }

  for (const [e, r] of matched) {
    e.lastSeenAt = nowIso;
    e.missingStrikes = 0;
    const finished = endOfInterest(e);
    if (e.status === 'completed' || (finished !== null && finished < nowMs)) continue; // history is frozen
    const before = visibleKey(e);
    if (!e.aliases.includes(r.sourceId)) e.aliases.push(r.sourceId);
    e.sourceId = r.sourceId; // identity (key, uid) never changes; what is displayed may
    e.url = r.url;
    e.title = r.title;
    e.matchHint = r.matchHint;
    applyTimes(feed, e, r);
    if (r.location) e.location = r.location; // a blank upstream venue never erases a known one
    if (e.status === 'cancelled') e.status = 'scheduled';
    if (before !== visibleKey(e)) {
      e.sequence += 1;
      e.lastModified = nowIso;
      report.push(`Updated ${e.title}.`);
    }
  }

  for (const r of stillNew) {
    const e: FeedEvent = {
      key: r.key,
      uid: `${randomUUID()}@${uidDomain(feed.id)}`,
      sourceId: r.sourceId,
      aliases: [r.sourceId],
      title: r.title,
      matchHint: r.matchHint,
      localEventDate: null,
      startUtc: null,
      extraTimes: [],
      location: r.location,
      url: r.url,
      provenance: {},
      status: 'scheduled',
      missingStrikes: 0,
      sequence: 0,
      createdAt: nowIso,
      lastModified: nowIso,
      lastSeenAt: nowIso,
    };
    applyTimes(feed, e, r);
    const end = endOfInterest(e);
    if (end !== null && end < nowMs) continue; // already over when first seen: not worth adding
    events.push(e);
    report.push(`Added ${e.title}.`);
    if (r.flag) warnings.push(r.flag);
  }

  // Events we knew about that are not on the list this time. Absence alone changes nothing.
  const needsPageCheck: string[] = [];
  let previousFuture = 0;
  let previousFutureMissing = 0;
  for (const e of events) {
    const end = endOfInterest(e);
    const over = end !== null && end < nowMs;
    if (over && e.status === 'scheduled') {
      e.status = 'completed'; // not a visible change: no sequence bump
      continue;
    }
    if (e.status !== 'scheduled' || over || !wasKnown.has(e.uid)) continue;
    previousFuture += 1;
    if (matched.has(e)) continue;

    previousFutureMissing += 1;
    const check = pageChecks.get(e.sourceId);
    if (!check) {
      needsPageCheck.push(e.sourceId);
      continue;
    }
    if (check.kind === 'gone') {
      e.missingStrikes += 1;
      if (e.missingStrikes >= CANCEL_STRIKES) {
        e.status = 'cancelled';
        e.sequence += 1;
        e.lastModified = nowIso;
        report.push(`Marked ${e.title} as cancelled: ${feed.sourceName} removed its official page (${CANCEL_STRIKES} checks in a row).`);
      } else {
        warnings.push(`${e.title} is off the ${feed.sourceName} list and its page is gone (check ${e.missingStrikes} of ${CANCEL_STRIKES}). Still shown as scheduled.`);
      }
    } else if (check.kind === 'exists' || check.kind === 'moved') {
      e.missingStrikes = 0;
    } else {
      warnings.push(`${e.title} is off the ${feed.sourceName} list and its page could not be checked (${check.detail}). Left unchanged.`);
    }
  }

  // Retention: drop long-finished and long-cancelled entries.
  const kept = events.filter((e) => {
    const end = endOfInterest(e);
    const ref = e.status === 'cancelled' ? Math.max(end ?? 0, Date.parse(e.lastModified)) : end;
    return ref === null || nowMs - ref < RETENTION_DAYS * DAY;
  });

  for (const e of kept) if (!e.localEventDate) warnings.push(`${e.title} has no date yet, so it is held back from the calendar.`);

  kept.sort((a, b) => (a.startUtc ?? a.localEventDate ?? '9').localeCompare(b.startUtc ?? b.localEventDate ?? '9'));
  return { events: kept, report, warnings, needsPageCheck, stats: { previousFuture, previousFutureMissing, incoming: incoming.length } };
}

function applyTimes(feed: FeedShape, e: FeedEvent, r: SourceRecord) {
  // A time that was known and is now blank upstream is kept; a source blanking a field is not evidence of a change.
  if (r.startUtc) {
    e.startUtc = r.startUtc;
    e.provenance.startUtc = `${feed.sourceName}, the time it labels "${feed.startLabel}"`;
  }
  if (r.startUtc) {
    // The source is publishing times for this event, so its set of extra times is the truth (a dropped early-prelim slot goes away).
    e.extraTimes = r.extraTimes.map((t) => ({ ...t }));
  } else {
    for (const t of r.extraTimes) {
      const existing = e.extraTimes.find((x) => x.label === t.label);
      if (existing) existing.utc = t.utc;
      else e.extraTimes.push({ ...t });
    }
  }
  e.extraTimes.sort((a, b) => b.utc.localeCompare(a.utc)); // closest to the start first

  if (e.startUtc) {
    e.localEventDate = dateInZone(e.startUtc, feed.dateTimeZone);
    e.provenance.localEventDate = `date of the start in ${feed.dateTimeZone}`;
  } else if (e.extraTimes.length > 0) {
    e.localEventDate = dateInZone(e.extraTimes[0].utc, feed.dateTimeZone);
    e.provenance.localEventDate = `date of "${e.extraTimes[0].label}" (start time not published)`;
  } else if (r.fallbackDate) {
    e.localEventDate = r.fallbackDate;
    e.provenance.localEventDate = `date given by ${feed.sourceName} without a time`;
  }
}
