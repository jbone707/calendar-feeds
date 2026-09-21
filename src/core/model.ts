/** A labelled extra time that belongs in an entry's notes, e.g. "Prelims". Never used as the start. */
export type ExtraTime = { label: string; utc: string };

/**
 * One event as a feed read it from its source, already filtered and titled by that feed.
 * Everything source-specific (what counts, how it is named) is decided before this point.
 */
export type SourceRecord = {
  key: string; // the feed's durable identity key, e.g. "numbered:332". Must not depend on date or title.
  sourceId: string; // the id the source uses today (may change upstream)
  title: string;
  matchHint: string; // short text that survives an upstream rename, e.g. the headline bout. '' when unknown.
  startUtc: string | null; // ISO instant of the moment the entry should start. Null means not published.
  fallbackDate: string | null; // YYYY-MM-DD to use only when no time of any kind is published
  extraTimes: ExtraTime[];
  location: string | null;
  url: string;
  flag?: string; // a note for the status page when the feed is unsure this event belongs
};

export type FeedEvent = {
  key: string;
  uid: string; // assigned once at first discovery, never derived from title or time
  sourceId: string;
  aliases: string[]; // every upstream id this event has been known by
  title: string;
  matchHint: string;
  localEventDate: string | null; // YYYY-MM-DD in the feed's display time zone
  startUtc: string | null;
  extraTimes: ExtraTime[];
  location: string | null;
  url: string;
  provenance: Record<string, string>; // field -> where the value came from
  status: 'scheduled' | 'cancelled' | 'completed';
  missingStrikes: number; // consecutive runs where the source said this event's own page is gone
  sequence: number;
  createdAt: string;
  lastModified: string; // changes only when something a person would see changes
};

export type PageCheck = { kind: 'exists' } | { kind: 'gone' } | { kind: 'moved'; sourceId: string } | { kind: 'unknown'; detail: string };

export type FetchResult = {
  records: SourceRecord[];
  itemsSeen: number; // raw items on the page before filtering; 0 means the page is broken or blocked
  itemsRead: number; // raw items that could be parsed
  problems: string[]; // notes for the status page
};

/** Everything a schedule source has to provide. Add a folder under src/feeds and register it in src/feeds/index.ts. */
export type Feed = {
  id: string; // file name stem and state folder: public/<id>.ics, data/<id>/
  name: string; // calendar name shown on the phone
  description: string;
  about: string; // one paragraph for the status page: what is included and where times come from
  sourceName: string; // e.g. "UFC.com"
  startLabel: string; // what the start time means, e.g. "Main card"
  durationHours: number; // estimate used for the end time
  dateTimeZone: string; // zone used to decide which calendar day an event belongs to
  extraTimesPrecedeStart: boolean; // if true, an extra time after the start means labels are wrong: reject the run
  crawlDelayMs: number;
  fetch: () => Promise<FetchResult>;
  /** Optional: ask whether one event's own page still exists. Without it, events are never auto-cancelled. */
  checkPage?: (sourceId: string) => Promise<PageCheck>;
  /**
   * Optional: gather extra details per event (e.g. the bout list) into `details`, keyed by event key.
   * Must be polite: honour crawlDelayMs and skip anything fetched recently. Returns notes for the status page.
   */
  enrich?: (events: FeedEvent[], details: Record<string, unknown>, now: Date) => Promise<string[]>;
  /** Pure: turn one event plus its stored details into facts. */
  facts: (event: FeedEvent, detail: unknown) => EventFacts;
  /** One paragraph telling the write-up step who the readers are and what to explain for this sport. */
  writerBrief: string;
};

/** What a feed can say about one event beyond its time and place. Built by rules from the feed's own stored details. */
export type EventFacts = {
  badge: string; // short prefix for the title, e.g. an emoji for the sport
  level: string | null; // one plain line on how big this event is, or null when there is nothing to say
  lines: string[]; // bullet facts, plain English, for someone new to the sport
  updatedAt: string | null; // when these facts last changed
  forWriter: Record<string, unknown>; // structured facts handed to the write-up step
};

/** A short AI-written explanation for one event. Optional: entries are complete without it. */
export type EventNote = { why: string; know: string; generatedAt: string; factsHash: string; model: string };

/** A calendar made by merging several feeds, e.g. one "Sports" calendar for the household. */
export type CombinedCalendar = { id: string; name: string; description: string; feedIds: string[] };

/** A calendar someone else already publishes well. Listed on the status page, nothing is built for it. */
export type ExternalCalendar = { name: string; note: string; host: string; path: string };

export type RunMeta = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastChangeReport: string[];
  warnings: string[];
};

export const emptyMeta = (): RunMeta => ({ lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastChangeReport: [], warnings: [] });

export const RETENTION_DAYS = 90;
export const CANCEL_STRIKES = 3;
