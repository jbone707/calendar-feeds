import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeIcal from 'node-ical';
import { renderCalendar, checkIcs } from '../../src/core/calendar.ts';
import type { FeedEvent, FetchResult, PageCheck } from '../../src/core/model.ts';
import { reconcileEvents } from '../../src/core/reconcile.ts';
import { renderStatusPage } from '../../src/core/status.ts';
import { combined, externalCalendars, feeds } from '../../src/feeds/index.ts';
import { classifySlug } from '../../src/feeds/ufc/classify.ts';
import { ufc } from '../../src/feeds/ufc/index.ts';
import { parseEventsPage } from '../../src/feeds/ufc/source.ts';
import { attemptRefresh } from '../../src/update.ts';
import { pageHtml, unix } from './helpers.ts';
import type { Card } from './helpers.ts';

const NOW = new Date('2026-09-20T12:00:00Z');
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

const ufc332: Card = { slug: 'ufc-332', headline: 'Silva vs Wang', main: unix('2026-10-04T00:00:00Z'), prelims: unix('2026-10-03T22:00:00Z'), early: unix('2026-10-03T20:00:00Z'), venue: 'Delta Center', city: 'Salt Lake City', region: 'UT', country: 'United States' };
const fnOct10: Card = { slug: 'ufc-fight-night-october-10-2026', headline: 'Allen vs Duncan', main: unix('2026-10-11T00:00:00Z'), prelims: unix('2026-10-10T21:00:00Z'), venue: 'Meta APEX', city: 'Las Vegas', region: 'NV', country: 'United States' };
const fnOct17: Card = { slug: 'ufc-fight-night-october-17-2026', headline: 'Buckley vs Malott', main: unix('2026-10-18T00:00:00Z'), prelims: unix('2026-10-17T21:00:00Z'), venue: 'Rogers Place', city: 'Edmonton', region: 'AB', country: 'Canada' };
const abuDhabi: Card = { slug: 'ufc-333', headline: 'Volkanovski vs Evloev', main: unix('2026-10-24T18:00:00Z'), prelims: unix('2026-10-24T16:00:00Z'), venue: 'Etihad Arena', city: 'Abu Dhabi', country: 'United Arab Emirates' };
const BASE = [ufc332, fnOct10, fnOct17, abuDhabi];

const records = (cards: Card[], past: Card[] = []) => parseEventsPage(pageHtml(cards, past)).records;
const run = (prev: FeedEvent[], cards: Card[], now = NOW, checks?: Map<string, PageCheck>) => reconcileEvents(ufc, prev, records(cards), now, checks);
const bySlug = (events: FeedEvent[], slug: string) => events.find((e) => e.aliases.includes(slug))!;
const render = (events: FeedEvent[]) => renderCalendar(ufc, events.map((event) => ({ feed: ufc, event, facts: null, note: null })));
const parseIcs = (ics: string) => Object.values(nodeIcal.sync.parseICS(ics)).filter((c: any) => c.type === 'VEVENT') as any[];

test('1. numbered and Fight Night cards are included; other programming is not', () => {
  const extra: Card[] = [
    { slug: 'dwcs-season-10-week-6', headline: 'Contender A vs Contender B', main: unix('2026-10-07T00:00:00Z') },
    { slug: 'road-to-ufc-season-5-semifinals', headline: 'Maheshate vs Flowers', main: unix('2026-10-08T10:00:00Z') },
    { slug: 'ufc-bjj-4', headline: 'Grappler vs Grappler', main: unix('2026-10-09T01:00:00Z') },
    { slug: 'the-ultimate-fighter-season-35-finale-episode', headline: 'TUF', main: unix('2026-10-09T02:00:00Z') },
    { slug: 'pfl-world-championship', headline: 'Someone vs Someone', main: unix('2026-10-09T03:00:00Z') },
    { slug: 'cryptocom-ufc-340', headline: 'Sponsor vs Prefix', main: unix('2026-12-13T03:00:00Z') },
    { slug: 'ufc-freedom-250', headline: 'A vs B', main: unix('2026-11-01T00:00:00Z') },
  ];
  const r = run([], [...BASE, ...extra]);
  const cats = Object.fromEntries(r.events.map((e) => [e.sourceId, e.key.startsWith('numbered:') ? 'numbered' : e.sourceId.startsWith('ufc-fight-night') ? 'fight_night' : 'special']));
  assert.deepEqual(cats, {
    'ufc-332': 'numbered',
    'ufc-fight-night-october-10-2026': 'fight_night',
    'ufc-fight-night-october-17-2026': 'fight_night',
    'ufc-333': 'numbered',
    'ufc-freedom-250': 'special',
    'cryptocom-ufc-340': 'numbered',
  });
  assert.equal(bySlug(r.events, 'ufc-332').title, 'UFC 332: Silva vs Wang');
  assert.equal(bySlug(r.events, 'ufc-fight-night-october-10-2026').title, 'UFC Fight Night: Allen vs Duncan');
  // "ufc" inside another word or promotion must not sneak in, and BJJ must not read as numbered
  assert.equal(classifySlug('ufc-bjj-4').include, false);
  assert.equal(classifySlug('road-to-ufc-5').include, false);
  assert.ok(parseEventsPage(pageHtml([...BASE, ...extra])).problems.some((w) => w.includes('pfl-world-championship')), 'unknown types are reported, not silently dropped');
  assert.ok(r.warnings.some((w) => w.includes('UFC Freedom 250')), 'special cards are flagged for a human look');
});

test('2. the same data twice changes nothing and the feed is byte-identical', () => {
  const first = run([], BASE);
  const second = run(first.events, BASE, later(1));
  assert.deepEqual(second.report, []);
  assert.equal(JSON.stringify(second.events), JSON.stringify(first.events), 'saved state is identical too, so an unchanged run commits nothing');
  const legacy = first.events.map((e) => ({ ...e, lastSeenAt: NOW.toISOString() }));
  assert.equal(JSON.stringify(run(legacy, BASE, later(1)).events), JSON.stringify(first.events), 'the old lastSeenAt field is dropped from saved state');
  assert.equal(render(second.events), render(first.events));
  assert.equal(new Set(second.events.map((e) => e.uid)).size, 4);
  for (const e of second.events) assert.equal(e.sequence, 0);
});

test('3. date, title, venue and start-time changes keep the UID and raise the sequence', () => {
  const first = run([], BASE);
  const uid = bySlug(first.events, 'ufc-332').uid;
  const moved: Card = { ...ufc332, headline: 'Silva vs Replacement', main: unix('2026-10-11T02:00:00Z'), prelims: unix('2026-10-11T00:00:00Z'), early: null, venue: 'T-Mobile Arena', city: 'Las Vegas', region: 'NV' };
  const second = run(first.events, [moved, fnOct10, fnOct17, abuDhabi], later(1));
  const e = bySlug(second.events, 'ufc-332');
  assert.equal(e.uid, uid);
  assert.equal(e.sequence, 1);
  assert.equal(e.title, 'UFC 332: Silva vs Replacement');
  assert.equal(e.localEventDate, '2026-10-10');
  assert.match(e.location!, /T-Mobile Arena, Las Vegas/);
  assert.equal(e.lastModified, later(1).toISOString());
  assert.equal(bySlug(second.events, 'ufc-333').lastModified, NOW.toISOString(), 'untouched events are not re-stamped');

  // UFC renames a Fight Night page when it moves the date: still the same calendar entry
  const fnUid = bySlug(first.events, fnOct10.slug).uid;
  const renamed: Card = { ...fnOct10, slug: 'ufc-fight-night-october-09-2026', main: unix('2026-10-10T00:00:00Z'), prelims: unix('2026-10-09T21:00:00Z') };
  const third = run(first.events, [ufc332, renamed, fnOct17, abuDhabi], later(1));
  assert.equal(third.events.length, 4, 'no duplicate created');
  assert.equal(bySlug(third.events, renamed.slug).uid, fnUid);

  // Sponsor prefix appearing on a numbered card's address
  const sponsored = run(first.events, [{ ...ufc332, slug: 'cryptocom-ufc-332' }, fnOct10, fnOct17, abuDhabi], later(1));
  assert.equal(bySlug(sponsored.events, 'cryptocom-ufc-332').uid, uid);
});

test('4. an all-day TBD placeholder becomes a timed event with the same UID', () => {
  const tbd: Card = { slug: 'ufc-fight-night-november-21-2026', headline: 'TBD vs TBD', main: null, prelims: null };
  const first = run([], [...BASE, tbd]);
  const e1 = bySlug(first.events, tbd.slug);
  assert.equal(e1.startUtc, null, 'no time is invented');
  assert.equal(e1.localEventDate, '2026-11-21');
  assert.equal(e1.title, 'UFC Fight Night');
  const v1 = parseIcs(render(first.events)).find((v) => v.uid === e1.uid);
  assert.equal(v1.datetype, 'date');
  assert.match(v1.summary, /time TBD/);
  assert.equal((v1.end.getTime() - v1.start.getTime()) / 86_400_000, 1, 'all-day end is exclusive next day');

  // prelim time published before main-card time: still not used as the start
  const prelimOnly = run(first.events, [...BASE, { ...tbd, prelims: unix('2026-11-21T21:00:00Z') }], later(1));
  assert.equal(bySlug(prelimOnly.events, tbd.slug).startUtc, null);

  const timed = run(prelimOnly.events, [...BASE, { ...tbd, headline: 'Real vs Fighters', main: unix('2026-11-22T01:00:00Z'), prelims: unix('2026-11-21T22:00:00Z') }], later(2));
  const e3 = bySlug(timed.events, tbd.slug);
  assert.equal(e3.uid, e1.uid);
  assert.ok(e3.sequence > e1.sequence);
  const v3 = parseIcs(render(timed.events)).find((v) => v.uid === e1.uid);
  assert.equal(v3.datetype, 'date-time');
  assert.equal(v3.start.toISOString(), '2026-11-22T01:00:00.000Z');
});

test('5. daylight-saving boundaries and international cards keep the correct instant and Eastern date', () => {
  const cards: Card[] = [
    { slug: 'ufc-fight-night-october-31-2026', headline: 'A vs B', main: unix('2026-11-01T00:00:00Z') }, // 8 PM EDT, night before clocks change
    { slug: 'ufc-fight-night-november-07-2026', headline: 'C vs D', main: unix('2026-11-07T22:00:00Z') }, // 5 PM EST
    { slug: 'ufc-335', headline: 'E vs F', main: unix('2027-02-07T03:00:00Z') }, // Sydney card: Sunday locally, Saturday 10 PM EST
    abuDhabi,
  ];
  const r = run([], cards);
  assert.equal(bySlug(r.events, 'ufc-fight-night-october-31-2026').localEventDate, '2026-10-31');
  assert.equal(bySlug(r.events, 'ufc-fight-night-november-07-2026').localEventDate, '2026-11-07');
  assert.equal(bySlug(r.events, 'ufc-335').localEventDate, '2027-02-06');
  const ics = render(r.events);
  // Written on the household's clock with a declared zone, not in UTC, so Apple Calendar shows one time, not two.
  assert.match(ics, /DTSTART;TZID=America\/Los_Angeles:20261031T170000\r\n/, '5 PM PDT, the night before clocks change');
  assert.match(ics, /DTSTART;TZID=America\/Los_Angeles:20261107T140000\r\n/, '2 PM PST, the week after');
  assert.match(ics, /DTSTART;TZID=America\/Los_Angeles:20261024T110000\r\n/);
  assert.match(ics, /DTEND;TZID=America\/Los_Angeles:20261031T200000\r\n/);
  assert.ok(!/^DT(START|END):\d{8}T\d{6}Z/m.test(ics), 'no event time is left in UTC');
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/, 'bookkeeping stamps stay in UTC as the standard requires');
  assert.equal((ics.match(/BEGIN:VTIMEZONE/g) ?? []).length, 1);
  assert.ok(ics.indexOf('BEGIN:VTIMEZONE') < ics.indexOf('BEGIN:VEVENT'));
  // An independent parser, using the zone rules in the file, lands on the exact same instants.
  const starts = parseIcs(ics).map((v) => v.start.toISOString()).sort();
  assert.deepEqual(starts, ['2026-10-24T18:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-07T22:00:00.000Z', '2027-02-07T03:00:00.000Z']);
  const desc = parseIcs(ics).find((v) => v.summary.startsWith('UFC Fight Night: C vs D')).description;
  assert.match(desc, /Main card: Sat, Nov 7, 2:00 PM PST/, 'Pacific rendering after the clock change');
  const before = parseIcs(ics).find((v) => v.summary.startsWith('UFC Fight Night: A vs B')).description;
  assert.match(before, /Main card: Sat, Oct 31, 5:00 PM PDT/);
});

const refresh = (prev: FeedEvent[], fetchImpl: () => Promise<FetchResult>, check: PageCheck = { kind: 'exists' }, now = later(1)) =>
  attemptRefresh({ ...ufc, fetch: fetchImpl, checkPage: async () => check }, prev, { now: () => now, delayMs: 0 });
const fetched = (cards: Card[]): FetchResult => parseEventsPage(pageHtml(cards));

test('6. missing rows, network errors and broken pages keep the prior events and feed', async () => {
  const prev = run([], BASE).events;
  const feedBefore = render(prev);

  // one row missing but its page still exists (rolling window): nothing changes
  const oneMissing = await refresh(prev, async () => fetched([ufc332, fnOct10, fnOct17]));
  assert.equal(oneMissing.ok, true);
  assert.equal(render(oneMissing.events), feedBefore);

  const network = await refresh(prev, async () => { throw new Error('getaddrinfo ENOTFOUND'); });
  assert.equal(network.ok, false);
  assert.equal(network.events, prev);

  const blockPage = await refresh(prev, async () => parseEventsPage('<html><body>Access denied</body></html>'));
  assert.equal(blockPage.ok, false);
  assert.match(blockPage.error!, /no events on it/);

  const truncated = await refresh(prev, async () => fetched([ufc332]), { kind: 'gone' });
  assert.equal(truncated.ok, false, 'three of four upcoming cards vanishing at once is treated as a bad page');
  assert.match(truncated.error!, /vanished at once/);

  const onlyContender = await refresh(prev, async () => fetched([{ slug: 'dwcs-season-10-week-6', headline: 'x vs y', main: unix('2026-10-07T00:00:00Z') }]));
  assert.equal(onlyContender.ok, false);

  const mislabeled = await refresh(prev, async () => fetched([{ ...ufc332, main: ufc332.prelims, prelims: ufc332.main }, fnOct10, fnOct17, abuDhabi]));
  assert.equal(mislabeled.ok, false, 'prelims after main card means the labels cannot be trusted');
});

test('7. cancellation needs repeated evidence, is published as cancelled, retained, then dropped', async () => {
  let events = run([], BASE).events;
  const uid = bySlug(events, fnOct17.slug).uid;
  const without = [ufc332, fnOct10, abuDhabi];

  for (let i = 1; i <= 2; i++) {
    const o = await refresh(events, async () => fetched(without), { kind: 'gone' }, later(i));
    assert.equal(o.ok, true);
    events = o.events;
    assert.equal(bySlug(events, fnOct17.slug).status, 'scheduled', `still scheduled after ${i} check(s)`);
  }
  // an inconclusive check does not count as evidence
  events = (await refresh(events, async () => fetched(without), { kind: 'unknown', detail: 'HTTP 503' }, later(2.5))).events;
  assert.equal(bySlug(events, fnOct17.slug).status, 'scheduled');

  events = (await refresh(events, async () => fetched(without), { kind: 'gone' }, later(3))).events;
  const cancelled = bySlug(events, fnOct17.slug);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.uid, uid);
  const v = parseIcs(render(events)).find((x) => x.uid === uid);
  assert.equal(v.status, 'CANCELLED');
  assert.match(v.summary, /^Cancelled: /);

  // still there two months later, gone after the retention window
  assert.ok(bySlug(run(events, without, later(60)).events, fnOct17.slug));
  assert.equal(run(events, without, later(140)).events.some((e) => e.uid === uid), false);

  // if UFC puts it back, the same entry returns to scheduled
  const back = run(events, BASE, later(4));
  assert.equal(bySlug(back.events, fnOct17.slug).status, 'scheduled');
  assert.equal(bySlug(back.events, fnOct17.slug).uid, uid);
});

test('8. the feed parses independently with awkward characters, CRLF and folded UTF-8', () => {
  const nasty: Card = { slug: 'ufc-fight-night-december-05-2026', headline: 'Błachowicz vs Procházka; "The Rematch", Part 2', main: unix('2026-12-06T01:00:00Z'), prelims: unix('2026-12-05T22:00:00Z'), venue: 'Arène de Genève, Hall 1; Niveau 2', city: 'Genève', country: 'Suisse' };
  const r = run([], [...BASE, nasty]);
  const ics = render(r.events);
  assert.equal(checkIcs(ics, 5), null);
  assert.ok(!/[^\r]\n/.test(ics), 'CRLF only');
  const v = parseIcs(ics).find((x) => x.summary.includes('Błachowicz'));
  assert.equal(v.summary, 'UFC Fight Night: Błachowicz vs Procházka; "The Rematch", Part 2');
  assert.equal(v.location, 'Arène de Genève, Hall 1; Niveau 2, Genève, Suisse');
  assert.match(v.description, /Prelims: Sat, Dec 5, 2:00 PM PST/);
  assert.equal(v.transparency, 'TRANSPARENT');
  assert.equal((v.end.getTime() - v.start.getTime()) / 3_600_000, 3);
  assert.match(ics, /METHOD:PUBLISH/);
  assert.ok(!/BEGIN:VALARM|ATTENDEE/.test(ics));
});

test('completed cards are frozen and events already over are never added fresh', () => {
  const pastCard: Card = { slug: 'ufc-330', headline: 'Old vs Card', main: unix('2026-08-16T02:00:00Z') };
  const r = reconcileEvents(ufc, [], parseEventsPage(pageHtml(BASE, [pastCard])).records, NOW);
  assert.equal(r.events.length, 4);
  const afterwards = run(r.events, [fnOct10, fnOct17, abuDhabi, { ...ufc332, headline: 'Edited After The Fact' }], later(30));
  const done = bySlug(afterwards.events, 'ufc-332');
  assert.equal(done.status, 'completed');
  assert.equal(done.title, 'UFC 332: Silva vs Wang');
  assert.equal(done.sequence, 0);
});

test('a blanked upstream time or venue does not erase what was known', () => {
  const first = run([], BASE);
  const second = run(first.events, [{ ...ufc332, main: null, venue: '', city: '', region: '', country: '' }, fnOct10, fnOct17, abuDhabi], later(1));
  const e = bySlug(second.events, 'ufc-332');
  assert.equal(e.startUtc, '2026-10-04T00:00:00.000Z');
  assert.match(e.location!, /Delta Center/);
});

test('the early-prelim slot disappears from the notes when UFC drops it on a rescheduled card', () => {
  const first = run([], BASE);
  const moved: Card = { ...ufc332, main: unix('2026-10-11T02:00:00Z'), prelims: unix('2026-10-11T00:00:00Z'), early: null };
  const e = bySlug(run(first.events, [moved, fnOct10, fnOct17, abuDhabi], later(1)).events, 'ufc-332');
  assert.deepEqual(e.extraTimes.map((t) => t.label), ['Prelims']);
});

test('feeds are isolated and the status page lists every calendar, including ones published by others', async () => {
  assert.equal(new Set(feeds.map((f) => f.id)).size, feeds.length, 'feed ids are unique');
  for (const f of feeds) assert.match(f.id, /^[a-z0-9-]+$/, 'feed id is safe as a file name');

  const good = run([], BASE).events;
  const broken = await attemptRefresh({ ...ufc, id: 'other', fetch: async () => { throw new Error('boom'); } }, [], { now: () => NOW, delayMs: 0 });
  assert.equal(broken.ok, false);
  const okMeta = { lastAttemptAt: NOW.toISOString(), lastSuccessAt: NOW.toISOString(), lastError: null, lastChangeReport: [], warnings: [] };
  const entries = good.map((event) => ({ feed: ufc, event, facts: ufc.facts(event, undefined), note: null }));
  const html = renderStatusPage(
    [
      { feed: ufc, entries, meta: okMeta },
      { feed: { ...ufc, id: 'other', name: 'Other <Feed>' }, entries: [], meta: { ...okMeta, lastSuccessAt: null, lastError: broken.error } },
    ],
    combined,
    [{ name: 'Some Team', note: 'Published by the team.', host: 'example.com', path: '/cal.ics' }],
    { enabled: false, lastWrittenAt: null, lastError: null },
    NOW,
  );
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  assert.match(html, /webcal:\/\/jbone707\.github\.io\/calendar-feeds\/ufc\.ics/);
  assert.match(html, /webcal:\/\/jbone707\.github\.io\/calendar-feeds\/other\.ics/);
  assert.match(html, /webcal:\/\/jbone707\.github\.io\/calendar-feeds\/sports\.ics/);
  assert.match(html, /webcal:\/\/example\.com\/cal\.ics/);
  assert.match(html, /Write-ups are off/);
  assert.equal(externalCalendars.length, 0);
  assert.match(html, /Other &lt;Feed&gt;/, 'names are escaped');
  assert.match(html, /UFC 332: Silva vs Wang/);
  assert.match(html, /Could not read UFC\.com: boom/);
  assert.ok(!html.includes('\u2014'), 'no em dashes in copy');
});
