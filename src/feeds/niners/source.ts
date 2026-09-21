import nodeIcal from 'node-ical';
import { USER_AGENT } from '../../config.ts';
import type { EventFacts, FeedEvent, FetchResult, SourceRecord } from '../../core/model.ts';

/** The 49ers' own published calendar subscription. Reading it is what it is for. */
export const TEAM_CALENDAR_URL = 'https://www.49ers.com/api/addToCalendar/ag/s';
const TEAM = 'San Francisco 49ers';
const DIVISION_RIVALS = ['Los Angeles Rams', 'Seattle Seahawks', 'Arizona Cardinals'];

export type Matchup = { opponent: string; home: boolean };

/** "Miami Dolphins at San Francisco 49ers" -> opponent Dolphins, home game. */
export function parseMatchup(summary: string): Matchup | null {
  const m = /^(.+?)\s+(?:at|vs\.?|@)\s+(.+?)(?:\s*\(preseason\))?$/i.exec(summary.trim());
  if (!m) return null;
  const [away, home] = [m[1].trim(), m[2].trim()];
  if (home === TEAM) return { opponent: away, home: true };
  if (away === TEAM) return { opponent: home, home: false };
  return null;
}

const nickname = (team: string) => team.split(' ').slice(-1)[0];

const pacificMonth = (iso: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'numeric' }).format(new Date(iso)));

/**
 * 49ers.com issues a fresh id for every event on every request, so the match hint is what actually identifies a
 * game from one run to the next, and two games must never share one. A team can be visited twice in a year, once
 * in preseason and once in the season (in 2026, at the Chargers in August and again in December), and both read
 * "San Francisco 49ers at Los Angeles Chargers". August games are preseason, so saying so keeps the hints apart.
 */
export function matchHintFor(summary: string, startIso: string | null): string {
  return startIso && pacificMonth(startIso) === 8 ? `${summary} (preseason)` : summary;
}

export function parseTeamCalendar(ics: string): FetchResult {
  const problems: string[] = [];
  const records: SourceRecord[] = [];
  let itemsSeen = 0;
  let itemsRead = 0;
  if (!ics.trimStart().startsWith('BEGIN:VCALENDAR')) return { records, itemsSeen: 0, itemsRead: 0, problems: ['The 49ers address did not return a calendar.'] };

  type Item = { type?: string; summary?: unknown; uid?: unknown; start?: unknown; location?: unknown; datetype?: string };
  for (const item of Object.values(nodeIcal.sync.parseICS(ics)) as Item[]) {
    if (!item || item.type !== 'VEVENT') continue;
    itemsSeen += 1;
    const summary = String(item.summary ?? '').trim();
    const uid = String(item.uid ?? '').trim();
    const start = item.start instanceof Date && !Number.isNaN(item.start.getTime()) ? item.start : null;
    if (!uid || !summary) {
      problems.push('A 49ers entry had no id or name and was skipped.');
      continue;
    }
    itemsRead += 1;
    const m = parseMatchup(summary);
    if (!m) {
      problems.push(`Left out "${summary}": it does not look like a game.`);
      continue;
    }
    const allDay = item.datetype === 'date';
    records.push({
      key: `niners:${uid}`,
      sourceId: uid,
      title: m.home ? `49ers vs ${nickname(m.opponent)}` : `49ers at ${nickname(m.opponent)}`,
      matchHint: matchHintFor(summary, start ? start.toISOString() : null),
      startUtc: start && !allDay ? start.toISOString() : null,
      fallbackDate: start && allDay ? start.toISOString().slice(0, 10) : null,
      extraTimes: [],
      location: item.location ? String(item.location).trim() : null,
      url: 'https://www.49ers.com/schedule/',
    });
  }
  return { records, itemsSeen, itemsRead, problems };
}

export async function fetchTeamCalendar(): Promise<FetchResult> {
  const res = await fetch(TEAM_CALENDAR_URL, { headers: { 'user-agent': USER_AGENT, accept: 'text/calendar' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`49ers.com calendar answered HTTP ${res.status}`);
  return parseTeamCalendar(await res.text());
}

const pacificParts = (iso: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', hour: 'numeric', hour12: false, month: 'numeric' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: get('weekday'), hour: Number(get('hour')) % 24, month: Number(get('month')) };
};

/** Rules only, from the matchup and kickoff time. Standings and playoff stakes come from the write-up step. */
export function ninersFacts(event: FeedEvent): EventFacts {
  const m = parseMatchup(event.matchHint);
  const lines: string[] = [];
  let level: string | null = null;
  const forWriter: Record<string, unknown> = { sport: 'NFL football', team: TEAM };

  if (m) {
    forWriter.opponent = m.opponent;
    forWriter.home = m.home;
    lines.push(m.home ? `Home game against the ${m.opponent}.` : `Away game at the ${m.opponent}.`);
    const rival = DIVISION_RIVALS.includes(m.opponent);
    forWriter.divisionGame = rival;
    if (rival) lines.push(`Division game. The ${nickname(m.opponent)} share the NFC West with the 49ers, so these count extra: they play twice a year and the division winner is guaranteed a playoff spot.`);
  }
  if (event.startUtc) {
    const t = pacificParts(event.startUtc);
    const preseason = t.month === 8;
    forWriter.preseason = preseason;
    if (preseason) {
      level = 'Preseason: a practice game that does not count';
      lines.push('Preseason games are warm-ups. Starters play little and the result does not affect the standings.');
    } else {
      const primeTime = t.weekday === 'Monday' || t.weekday === 'Thursday' || t.hour >= 17;
      forWriter.primeTime = primeTime;
      if (primeTime) {
        lines.push(`${t.weekday}${t.hour >= 16 ? ' night' : ''} game, shown nationally. The league puts its most watchable matchups in these slots.`);
        level = 'Prime-time game';
      }
      if (m && DIVISION_RIVALS.includes(m.opponent)) level = level ? `${level}, against a division rival` : 'Division rival game';
    }
  }
  return { badge: '🏈', level, lines, updatedAt: null, forWriter };
}
