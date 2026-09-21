import * as cheerio from 'cheerio';
import { setTimeout as sleep } from 'node:timers/promises';
import { USER_AGENT } from '../../config.ts';
import type { EventFacts, FeedEvent } from '../../core/model.ts';

export type Bout = {
  segment: 'main' | 'prelims' | 'early' | 'card'; // 'card' until UFC splits the bouts into segments
  weightClass: string; // e.g. "Women's Flyweight"
  titleBout: boolean;
  red: string;
  blue: string;
  redRank: string | null; // "C" for champion, "#3", or null when unranked
  blueRank: string | null;
};

export type UfcDetail = { fetchedAt: string; changedAt: string; bouts: Bout[] };

const REFETCH_AFTER_MS = 20 * 3_600_000; // at most about once a day per card
const MAX_FETCHES_PER_RUN = 10;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Parse one event page's bout list. Order on the page is top of the card first, so the first bout is the main event.
 * UFC labels the three segments only once it has assigned them. A card it has not split yet is a single "Fight Card"
 * list with none of those ids, so that list is read whole and every bout is marked 'card'.
 */
export function parseEventPage(html: string): Bout[] {
  const $ = cheerio.load(html);
  const bouts: Bout[] = [];
  const read = (selector: string, segment: Bout['segment']) => {
    $(selector).each((_, el) => {
      const f = $(el);
      const red = clean(f.find('.c-listing-fight__corner-name--red').first().text());
      const blue = clean(f.find('.c-listing-fight__corner-name--blue').first().text());
      if (!red || !blue) return;
      const cls = clean(f.find('.c-listing-fight__class-text').first().text());
      const ranks = f
        .find('.c-listing-fight__ranks-row')
        .first()
        .find('.c-listing-fight__corner-rank')
        .map((__, r) => clean($(r).text()))
        .get();
      const rank = (s: string | undefined) => (s && /^(C|#\d{1,2})$/i.test(s) ? s.toUpperCase() : null);
      bouts.push({
        segment,
        weightClass: clean(cls.replace(/\b(title\s+)?bout\b/gi, '')),
        titleBout: /\btitle\b/i.test(cls),
        red,
        blue,
        redRank: rank(ranks[0]),
        blueRank: rank(ranks[1]),
      });
    });
  };
  read('#main-card .c-listing-fight', 'main');
  read('#prelims-card .c-listing-fight', 'prelims');
  read('#early-prelims .c-listing-fight', 'early');
  if (bouts.length === 0) read('.c-listing-fight', 'card');
  return bouts;
}

/** Fetch bout lists for upcoming cards, politely: one page per card, about once a day, spaced by the crawl delay. */
export async function enrichUfc(events: FeedEvent[], details: Record<string, unknown>, now: Date, delayMs: number): Promise<string[]> {
  const problems: string[] = [];
  const due = events
    .filter((e) => e.status === 'scheduled')
    .filter((e) => {
      const d = details[e.key] as UfcDetail | undefined;
      return !d || now.getTime() - Date.parse(d.fetchedAt) > REFETCH_AFTER_MS;
    })
    .slice(0, MAX_FETCHES_PER_RUN);

  for (const e of due) {
    await sleep(delayMs);
    try {
      const res = await fetch(e.url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        problems.push(`Could not read the bout list for ${e.title} (HTTP ${res.status}). Kept what was known.`);
        continue;
      }
      const bouts = parseEventPage(await res.text());
      const prev = details[e.key] as UfcDetail | undefined;
      // An empty list from a page that used to have bouts is treated as a bad read, not as news.
      if (bouts.length === 0 && prev && prev.bouts.length > 0) {
        details[e.key] = { ...prev, fetchedAt: now.toISOString() };
        continue;
      }
      const changed = !prev || JSON.stringify(prev.bouts) !== JSON.stringify(bouts);
      details[e.key] = { fetchedAt: now.toISOString(), changedAt: changed ? now.toISOString() : prev!.changedAt, bouts };
    } catch (err) {
      problems.push(`Could not read the bout list for ${e.title} (${err instanceof Error ? err.message : String(err)}). Kept what was known.`);
    }
  }
  // Forget cards that are no longer in state.
  const live = new Set(events.map((e) => e.key));
  for (const k of Object.keys(details)) if (!live.has(k)) delete details[k];
  return problems;
}

const rankNum = (r: string | null) => (r === 'C' ? 0 : r ? Number(r.slice(1)) : 99);
const withRank = (name: string, r: string | null) => (r === 'C' ? `${name} (champion)` : r ? `${name} (${r})` : name);
const matchup = (b: Bout) => `${withRank(b.red, b.redRank)} vs ${withRank(b.blue, b.blueRank)}`;

/** Rules only. Uses nothing but the card type and the bout list, and explains each fact for someone new to the sport. */
export function ufcFacts(event: FeedEvent, detail: unknown): EventFacts {
  const d = detail as UfcDetail | undefined;
  const numbered = event.key.startsWith('numbered:');
  const bouts = d?.bouts ?? [];
  const titleBouts = bouts.filter((b) => b.titleBout);
  // The top of the card, whether or not UFC has split the segments yet.
  const topOfCard = bouts.filter((b) => b.segment === 'main' || b.segment === 'card');
  const main = topOfCard[0];
  const coMain = topOfCard[1];
  const rankedVsRanked = bouts.filter((b) => b.redRank && b.blueRank);
  const anyRanked = bouts.filter((b) => b.redRank || b.blueRank);
  const topFive = main ? Math.max(rankNum(main.redRank), rankNum(main.blueRank)) <= 5 : false;

  let level: string | null = null;
  if (titleBouts.length >= 2) level = `Huge night: ${titleBouts.length} title fights`;
  else if (titleBouts.length === 1) level = 'Big night: title fight';
  else if (bouts.length === 0) level = numbered ? 'Numbered event: the bigger kind of UFC card. Fights not announced yet.' : null;
  else if (topFive) level = 'Strong card: two top-five fighters headline';
  else if (numbered) level = 'Numbered event: the bigger kind of UFC card';
  else if (rankedVsRanked.length > 0) level = 'Solid Fight Night: ranked fighters on the card';
  else if (anyRanked.length > 0) level = 'Regular Fight Night: one or two ranked names';
  else level = 'Regular Fight Night: no ranked fighters, mostly up-and-comers';

  const lines: string[] = [];
  for (const b of titleBouts) {
    const champ = b.redRank === 'C' || b.blueRank === 'C';
    lines.push(
      `${b.weightClass} title fight: ${matchup(b)}. ${champ ? 'The champion is defending the belt.' : 'The belt is vacant, so the winner becomes champion.'}`,
    );
  }
  if (main && !main.titleBout) lines.push(`Main event: ${matchup(main)}, ${main.weightClass}.${main.redRank && main.blueRank ? ' Both are ranked, so the winner moves closer to a title shot.' : ''}`);
  if (coMain && !coMain.titleBout) lines.push(`Co-main event: ${matchup(coMain)}, ${coMain.weightClass}.`);
  if (rankedVsRanked.length > 0) lines.push(`${rankedVsRanked.length} ${rankedVsRanked.length === 1 ? 'fight has' : 'fights have'} two ranked fighters. Rankings run from champion, then #1 down to #15 in each weight class.`);
  const onMainCard = bouts.filter((b) => b.segment === 'main').length;
  if (bouts.length > 0)
    lines.push(
      onMainCard > 0
        ? `${bouts.length} fights in total, ${onMainCard} on the main card.`
        : `${bouts.length} ${bouts.length === 1 ? 'fight' : 'fights'} announced so far. UFC has not said yet which are on the main card.`,
    );
  lines.push(numbered ? 'Numbered event: UFC saves these for its biggest cards, usually with a title fight.' : 'Fight Night: a regular weekly card, often a chance to spot rising fighters.');

  return {
    badge: titleBouts.length > 0 ? '🏆' : '🥊',
    level,
    lines,
    updatedAt: d?.changedAt ?? null,
    forWriter: { sport: 'UFC (mixed martial arts)', cardType: numbered ? 'numbered event' : 'Fight Night', bouts },
  };
}
