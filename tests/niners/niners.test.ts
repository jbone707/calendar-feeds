import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCalendar } from '../../src/core/calendar.ts';
import type { FeedEvent } from '../../src/core/model.ts';
import { reconcileEvents } from '../../src/core/reconcile.ts';
import { niners } from '../../src/feeds/niners/index.ts';
import { ninersFacts, parseMatchup, parseTeamCalendar } from '../../src/feeds/niners/source.ts';
import { attemptRefresh } from '../../src/update.ts';

// Shape copied from https://www.49ers.com/api/addToCalendar/ag/s on 2026-09-20 (ical.net output, UTC times, UUID UIDs).
type G = { uid: string; summary: string; start: string; location?: string };
const teamIcs = (games: G[]) =>
  ['BEGIN:VCALENDAR', 'PRODID:-//github.com/ical-org/ical.net//NONSGML ical.net 4.0//EN', 'VERSION:2.0',
    ...games.flatMap((g) => ['BEGIN:VEVENT', `DTEND:${g.start.replace('T', 'T').slice(0, 9)}235900Z`, 'DTSTAMP:20260920T050000Z', `DTSTART:${g.start}`,
      `LOCATION:${(g.location ?? "Levi's® Stadium, Santa Clara").replace(/,/g, '\\,')}`, 'SEQUENCE:0', `SUMMARY:${g.summary}`, `UID:${g.uid}`, 'END:VEVENT']),
    'END:VCALENDAR', ''].join('\r\n');

const NOW = new Date('2026-09-20T12:00:00Z');
const GAMES: G[] = [
  { uid: 'pre-1', summary: 'Tennessee Titans at San Francisco 49ers', start: '20260814T010000Z' },
  { uid: 'g-dolphins', summary: 'Miami Dolphins at San Francisco 49ers', start: '20260920T202500Z' },
  { uid: 'g-cards', summary: 'Arizona Cardinals at San Francisco 49ers', start: '20260927T200500Z' },
  { uid: 'g-seahawks', summary: 'San Francisco 49ers at Seattle Seahawks', start: '20261011T202500Z', location: 'Lumen Field, Seattle' },
  { uid: 'g-commanders', summary: 'Washington Commanders at San Francisco 49ers', start: '20261020T001500Z' },
  { uid: 'g-falcons', summary: 'San Francisco 49ers at Atlanta Falcons', start: '20261025T170000Z', location: 'Mercedes-Benz Stadium, Atlanta' },
];
const find = (events: FeedEvent[], uid: string) => events.find((e) => e.sourceId === uid)!;

test('reads the team calendar: titles, home and away, location, exact kickoff instants', () => {
  const r = parseTeamCalendar(teamIcs(GAMES));
  assert.equal(r.itemsSeen, 6);
  const events = reconcileEvents(niners, [], r.records, NOW).events;
  assert.equal(events.length, 5, 'a preseason game already played is not added');
  assert.equal(find(events, 'g-dolphins').title, '49ers vs Dolphins');
  assert.equal(find(events, 'g-seahawks').title, '49ers at Seahawks');
  assert.equal(find(events, 'g-seahawks').location, 'Lumen Field, Seattle');
  assert.equal(find(events, 'g-commanders').startUtc, '2026-10-20T00:15:00.000Z');
  assert.equal(find(events, 'g-commanders').localEventDate, '2026-10-19', 'Monday night in California, even though it is Tuesday in UTC');
  assert.deepEqual(parseMatchup('Bye Week'), null);
  assert.ok(parseTeamCalendar(teamIcs([{ uid: 'x', summary: 'Draft Party', start: '20270425T000000Z' }])).problems.some((p) => p.includes('Draft Party')));
});

test('a flexed kickoff updates the same entry; a regenerated upstream id does not duplicate the game', () => {
  const first = reconcileEvents(niners, [], parseTeamCalendar(teamIcs(GAMES)).records, NOW).events;
  const uid = find(first, 'g-falcons').uid;
  const flexed = GAMES.map((g) => (g.uid === 'g-falcons' ? { ...g, start: '20261026T002000Z' } : g));
  const second = reconcileEvents(niners, first, parseTeamCalendar(teamIcs(flexed)).records, new Date('2026-09-21T12:00:00Z')).events;
  const e = find(second, 'g-falcons');
  assert.equal(e.uid, uid);
  assert.equal(e.sequence, 1);
  assert.equal(e.startUtc, '2026-10-26T00:20:00.000Z');

  const reissued = GAMES.map((g) => (g.uid === 'g-falcons' ? { ...g, uid: 'brand-new-id' } : g));
  const third = reconcileEvents(niners, first, parseTeamCalendar(teamIcs(reissued)).records, new Date('2026-09-21T12:00:00Z')).events;
  assert.equal(third.length, first.length);
  assert.equal(find(third, 'brand-new-id').uid, uid);
});

test('a preseason and a season visit to the same team stay two entries, run after run', () => {
  // 2026 really is like this: at the Chargers in August, then at the Chargers again in December. 49ers.com
  // reissues every event id on every request, so both runs fall back to matching on the hint.
  const twice: G[] = [
    { uid: 'pre-chargers', summary: 'San Francisco 49ers at Los Angeles Chargers', start: '20260821T020000Z', location: 'SoFi Stadium, Inglewood' },
    ...GAMES.slice(1),
    { uid: 'reg-chargers', summary: 'San Francisco 49ers at Los Angeles Chargers', start: '20261218T011500Z', location: 'SoFi Stadium, Inglewood' },
  ];
  const parsed = parseTeamCalendar(teamIcs(twice));
  const hints = parsed.records.map((r) => r.matchHint);
  assert.equal(new Set(hints).size, hints.length, 'no two games share a match hint');

  const first = reconcileEvents(niners, [], parsed.records, NOW).events;
  const december = first.filter((e) => e.title === '49ers at Chargers');
  assert.equal(december.length, 1, 'the August game is already played, so only the December one is added');
  assert.equal(december[0].localEventDate, '2026-12-17');
  const uid = december[0].uid;

  // Every id regenerated, as 49ers.com does on each request.
  const reissued = twice.map((g, i) => ({ ...g, uid: `fresh-${i}` }));
  let events = first;
  for (let run = 1; run <= 3; run++) {
    events = reconcileEvents(niners, events, parseTeamCalendar(teamIcs(reissued)).records, new Date(`2026-09-2${run}T12:00:00Z`)).events;
    const chargers = events.filter((e) => e.title === '49ers at Chargers');
    assert.equal(chargers.length, 1, `run ${run}: the December game is not duplicated`);
    assert.equal(chargers[0].uid, uid, `run ${run}: the December game keeps its UID`);
    assert.equal(chargers[0].localEventDate, '2026-12-17', `run ${run}: the August game never overwrites the December one`);
  }
});

test('rules: division rival, prime time, home and away, preseason, all explained for a newcomer', () => {
  const events = reconcileEvents(niners, [], parseTeamCalendar(teamIcs(GAMES)).records, new Date('2026-08-01T00:00:00Z')).events;
  const cards = ninersFacts(find(events, 'g-cards'));
  assert.equal(cards.badge, '🏈');
  assert.equal(cards.level, 'Division rival game');
  assert.ok(cards.lines.some((l) => /share the NFC West/.test(l) && /guaranteed a playoff spot/.test(l)));
  assert.ok(cards.lines.includes('Home game against the Arizona Cardinals.'));

  const monday = ninersFacts(find(events, 'g-commanders'));
  assert.equal(monday.level, 'Prime-time game');
  assert.ok(monday.lines.some((l) => l.startsWith('Monday night game, shown nationally')));

  const early = ninersFacts(find(events, 'g-falcons'));
  assert.equal(early.level, null, 'an ordinary Sunday morning game gets no hype');
  assert.ok(early.lines.includes('Away game at the Atlanta Falcons.'));

  const pre = ninersFacts(find(events, 'pre-1'));
  assert.match(pre.level!, /Preseason/);
  assert.equal(pre.forWriter.preseason, true);
});

test('an empty off-season calendar is normal, but a broken one mid-season keeps the games', async () => {
  const season = reconcileEvents(niners, [], parseTeamCalendar(teamIcs(GAMES)).records, NOW).events;
  const broken = await attemptRefresh({ ...niners, fetch: async () => parseTeamCalendar('<html>Service unavailable</html>') }, season, { now: () => NOW, delayMs: 0 });
  assert.equal(broken.ok, false);
  assert.equal(broken.events, season);

  const february = new Date('2027-02-20T12:00:00Z');
  const offSeason = await attemptRefresh({ ...niners, fetch: async () => parseTeamCalendar(teamIcs([])) }, season, { now: () => february, delayMs: 0 });
  assert.equal(offSeason.ok, true, 'nothing upcoming to protect, so an empty source is not an error');
});

test('the entry reads well in a calendar', () => {
  const events = reconcileEvents(niners, [], parseTeamCalendar(teamIcs(GAMES)).records, NOW).events;
  const e = find(events, 'g-seahawks');
  const ics = renderCalendar(niners, [{ feed: niners, event: e, facts: ninersFacts(e), note: null }]);
  assert.match(ics, /SUMMARY:🏈 49ers at Seahawks/);
  assert.match(ics.replace(/\r\n /g, ''), /Division rival game\\n\\nTHE FACTS\\n• Away game at the Seattle Seahawks\./);
  assert.match(ics.replace(/\r\n /g, ''), /Kickoff: Sun\\, Oct 11\\, 1:25 PM PDT \(per 49ers\.com\)/);
});
