import * as cheerio from 'cheerio';
import { USER_AGENT } from '../../config.ts';
import type { ExtraTime, FetchResult, PageCheck, SourceRecord } from '../../core/model.ts';
import { buildTitle, classifySlug, isTbdHeadline } from './classify.ts';

export const EVENTS_URL = 'https://www.ufc.com/events';

const toIso = (unixSeconds: string | undefined): string | null => {
  if (!unixSeconds || !/^\d{9,11}$/.test(unixSeconds.trim())) return null;
  return new Date(Number(unixSeconds) * 1000).toISOString();
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function dateFromSlug(slug: string): string | null {
  const m = new RegExp(`(${MONTHS.join('|')})-(\\d{1,2})-(\\d{4})$`).exec(slug);
  if (!m) return null;
  return `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * Parse the public events page. Start times come only from the attributes UFC itself labels
 * data-main-card-timestamp / data-prelims-card-timestamp / data-early-card-timestamp.
 * A missing attribute stays empty: we never substitute a "usual" time or the prelim time.
 */
export function parseEventsPage(html: string): FetchResult {
  const $ = cheerio.load(html);
  const problems: string[] = [];
  const bySlug = new Map<string, SourceRecord>();
  const cards = $('article.c-card-event--result');
  let itemsRead = 0;

  cards.each((_, el) => {
    const card = $(el);
    const link = card.find('.c-card-event--result__headline a').first();
    const m = /\/event\/([a-z0-9-]+)/i.exec(link.attr('href') ?? '');
    if (!m) {
      problems.push('A card had no /event/ link and was skipped.');
      return;
    }
    itemsRead += 1;
    const slug = m[1].toLowerCase();
    const headline = clean(link.text());
    const c = classifySlug(slug);
    if (!c.include) {
      if (c.reason === 'unrecognised event type') problems.push(`Left out "${headline}" (${slug}): ${c.reason}.`);
      return;
    }

    const date = card.find('.c-card-event--result__date').first();
    if (date.length === 0) problems.push(`${slug}: no date block found.`);

    const venue = clean(card.find('.c-card-event--result__location h5').first().text());
    const place = ['.locality', '.administrative-area', '.country']
      .map((sel) => clean(card.find(`.c-card-event--result__location ${sel}`).first().text()))
      .filter(Boolean)
      .join(', ');

    const extraTimes: ExtraTime[] = [];
    const prelims = toIso(date.attr('data-prelims-card-timestamp'));
    const early = toIso(date.attr('data-early-card-timestamp'));
    if (prelims) extraTimes.push({ label: 'Prelims', utc: prelims });
    if (early) extraTimes.push({ label: 'Early prelims', utc: early });

    const title = buildTitle(c, slug, headline);
    bySlug.set(slug, {
      key: c.key,
      sourceId: slug,
      title,
      matchHint: isTbdHeadline(headline) ? '' : headline,
      startUtc: toIso(date.attr('data-main-card-timestamp')),
      fallbackDate: dateFromSlug(slug),
      extraTimes,
      location: [venue, place].filter(Boolean).join(', ') || null,
      url: `https://www.ufc.com/event/${slug}`,
      flag: c.category === 'special' ? `"${title}" has an unusual name and was included as a special card. Check it belongs.` : undefined,
    });
  });

  return { records: [...bySlug.values()], itemsSeen: cards.length, itemsRead, problems };
}

async function get(url: string, redirect: RequestRedirect = 'follow'): Promise<Response> {
  return fetch(url, { redirect, headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(30_000) });
}

export async function fetchSchedule(): Promise<FetchResult> {
  const res = await get(EVENTS_URL);
  if (!res.ok) throw new Error(`ufc.com/events answered HTTP ${res.status}`);
  return parseEventsPage(await res.text());
}

/** Ask whether one event's own official page still exists. Used only for cards that vanished from the list. */
export async function checkEventPage(slug: string): Promise<PageCheck> {
  try {
    const res = await get(`https://www.ufc.com/event/${slug}`, 'manual');
    if (res.status === 404 || res.status === 410) return { kind: 'gone' };
    if (res.status >= 300 && res.status < 400) {
      const m = /\/event\/([a-z0-9-]+)/i.exec(res.headers.get('location') ?? '');
      if (m && m[1].toLowerCase() !== slug) return { kind: 'moved', sourceId: m[1].toLowerCase() };
      return { kind: 'unknown', detail: `redirect ${res.status}` };
    }
    if (res.ok) return { kind: 'exists' };
    return { kind: 'unknown', detail: `HTTP ${res.status}` };
  } catch (e) {
    return { kind: 'unknown', detail: String(e) };
  }
}
