import type { Feed, FeedEvent, FetchResult } from './model.ts';
import type { ReconcileResult } from './reconcile.ts';

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Decide whether a proposed update is trustworthy enough to publish. If not, the prior calendar stays. */
export function validateUpdate(
  feed: Pick<Feed, 'sourceName' | 'extraTimesPrecedeStart'>,
  previous: FeedEvent[],
  result: ReconcileResult,
  fetched: Pick<FetchResult, 'itemsSeen' | 'itemsRead'>,
  now: Date,
): Verdict {
  if (fetched.itemsSeen === 0) return { ok: false, reason: `${feed.sourceName} returned a page with no events on it (layout change or block page).` };
  if (fetched.itemsRead < fetched.itemsSeen / 2) return { ok: false, reason: `Only ${fetched.itemsRead} of ${fetched.itemsSeen} items could be read.` };
  if (result.stats.incoming === 0 && previous.length > 0)
    return { ok: false, reason: 'None of the events this calendar tracks were found on a page that normally has several.' };

  const { previousFuture, previousFutureMissing } = result.stats;
  if (previousFuture >= 3 && previousFutureMissing / previousFuture > 0.5)
    return { ok: false, reason: `${previousFutureMissing} of ${previousFuture} upcoming events vanished at once, which looks like a truncated page.` };

  const uids = new Set<string>();
  const keys = new Set<string>();
  for (const e of result.events) {
    if (uids.has(e.uid) || keys.has(e.key)) return { ok: false, reason: `Duplicate identity for ${e.title}.` };
    uids.add(e.uid);
    keys.add(e.key);
    for (const t of [e.startUtc, ...e.extraTimes.map((x) => x.utc)]) {
      if (!t) continue;
      const ms = Date.parse(t);
      const years = Math.abs(ms - now.getTime()) / (365 * 86_400_000);
      if (Number.isNaN(ms) || years > 2) return { ok: false, reason: `Implausible time ${t} for ${e.title}.` };
    }
    if (feed.extraTimesPrecedeStart && e.startUtc && e.status === 'scheduled') {
      const late = e.extraTimes.find((x) => Date.parse(x.utc) > Date.parse(e.startUtc!));
      if (late) return { ok: false, reason: `${e.title}: "${late.label}" is listed after the start, so the time labels cannot be trusted.` };
    }
  }
  // UIDs are forever.
  for (const p of previous) {
    const n = result.events.find((e) => e.key === p.key);
    if (n && n.uid !== p.uid) return { ok: false, reason: `UID changed for ${p.title}.` };
  }
  return { ok: true };
}
