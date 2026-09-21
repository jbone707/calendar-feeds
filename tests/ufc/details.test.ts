import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FeedEvent } from '../../src/core/model.ts';
import { parseEventPage, ufcFacts } from '../../src/feeds/ufc/details.ts';
import type { Bout } from '../../src/feeds/ufc/details.ts';

// Markup copied from a ufc.com event page on 2026-09-20 (class names and nesting as observed).
type B = { red: string; blue: string; cls: string; ranks?: [string, string] };
const fight = (b: B) => `<li class="l-listing__item"><div class="node node--type-fight"><div class="c-listing-fight" data-fmid="1" data-status="">
 <div class="c-listing-fight__class-text">${b.cls}</div>
 <div class="c-listing-fight__ranks-row"> <div class="js-listing-fight__corner-rank c-listing-fight__corner-rank"> ${b.ranks?.[0] ? `<span>${b.ranks[0]}</span>` : ''} </div> <div class="js-listing-fight__corner-rank c-listing-fight__corner-rank"> ${b.ranks?.[1] ? `<span>${b.ranks[1]}</span>` : ''} </div> </div>
 <div class="c-listing-fight__names-row"> <div class="c-listing-fight__corner-name c-listing-fight__corner-name--red"> <a href="/athlete/x"> <span class="c-listing-fight__corner-given-name">${b.red.split(' ')[0]}</span> <span class="c-listing-fight__corner-family-name">${b.red.split(' ').slice(1).join(' ')}</span> </a> </div> <div class="c-listing-fight__vs"> vs </div> <div class="c-listing-fight__corner-name c-listing-fight__corner-name--blue"> <a href="/athlete/y"> <span class="c-listing-fight__corner-given-name">${b.blue.split(' ')[0]}</span> <span class="c-listing-fight__corner-family-name">${b.blue.split(' ').slice(1).join(' ')}</span> </a> </div> </div>
 <div class="c-listing-fight__class-text">${b.cls}</div>
 <span class="c-listing-fight__odds-amount">-220</span>
</div></div></li>`;
const page = (main: B[], prelims: B[] = [], early: B[] = []) => `<html><body><div class="fight-card">
<div id="main-card" class="main-card"><ul>${main.map(fight).join('')}</ul></div>
<div id="prelims-card" class="fight-card-prelims"><ul>${prelims.map(fight).join('')}</ul></div>
<div id="early-prelims" class="fight-card-prelims-early"><ul>${early.map(fight).join('')}</ul></div></div></body></html>`;

// A card UFC has not split into segments yet: one "Fight Card" list, none of the three segment ids.
// Markup copied from https://www.ufc.com/event/ufc-333 on 2026-09-20.
const unsplitPage = (all: B[]) => `<html><body><div class="l-main__content"><div class="view view-event-fights">
<h3 class="l-listing__title">Fight Card</h3>
<section class="l-listing--stacked--full-width"><ul class="l-listing__group--bordered">${all.map(fight).join('')}</ul></section>
</div></div></body></html>`;

const event = (key: string, title: string): FeedEvent => ({
  key, uid: `${key}@x`, sourceId: key, aliases: [key], title, matchHint: '', localEventDate: '2026-10-03', startUtc: '2026-10-04T00:00:00.000Z',
  extraTimes: [], location: null, url: 'https://www.ufc.com/event/x', provenance: {}, status: 'scheduled', missingStrikes: 0, sequence: 0,
  createdAt: '2026-09-20T00:00:00.000Z', lastModified: '2026-09-20T00:00:00.000Z',
});
const detail = (bouts: Bout[]) => ({ fetchedAt: '2026-09-20T00:00:00.000Z', changedAt: '2026-09-20T00:00:00.000Z', bouts });

test('bout list: order, segment, title bouts, champion and numbered ranks, unranked, odds ignored', () => {
  const bouts = parseEventPage(
    page(
      [
        { red: 'Natalia Silva', blue: 'Wang Cong', cls: "Women's Flyweight Title Bout", ranks: ['#1', '#8'] },
        { red: 'Deiveson Figueiredo', blue: 'Payton Talbott', cls: 'Bantamweight Bout', ranks: ['#9', '#11'] },
      ],
      [{ red: 'King Green', blue: 'Esteban Ribovics', cls: 'Lightweight Bout' }],
      [{ red: 'Champ Person', blue: 'Some Challenger', cls: 'Heavyweight Title Bout', ranks: ['C', '#2'] }],
    ),
  );
  assert.equal(bouts.length, 4);
  assert.deepEqual(bouts[0], { segment: 'main', weightClass: "Women's Flyweight", titleBout: true, red: 'Natalia Silva', blue: 'Wang Cong', redRank: '#1', blueRank: '#8' });
  assert.equal(bouts[1].titleBout, false);
  assert.equal(bouts[1].weightClass, 'Bantamweight');
  assert.deepEqual([bouts[2].segment, bouts[2].redRank, bouts[2].blueRank], ['prelims', null, null]);
  assert.deepEqual([bouts[3].segment, bouts[3].redRank], ['early', 'C']);
  assert.ok(!JSON.stringify(bouts).includes('220'), 'betting odds never enter the data');
  assert.deepEqual(parseEventPage('<html><body>Access denied</body></html>'), []);
});

test('facts explain the night in plain words and rank nights differently', () => {
  const vacant = ufcFacts(event('numbered:332', 'UFC 332: Silva vs Wang'), detail(parseEventPage(page([
    { red: 'Natalia Silva', blue: 'Wang Cong', cls: "Women's Flyweight Title Bout", ranks: ['#1', '#8'] },
    { red: 'Deiveson Figueiredo', blue: 'Payton Talbott', cls: 'Bantamweight Bout', ranks: ['#9', '#11'] },
  ]))));
  assert.equal(vacant.badge, '🏆');
  assert.equal(vacant.level, 'Big night: title fight');
  assert.match(vacant.lines[0], /Women's Flyweight title fight: Natalia Silva \(#1\) vs Wang Cong \(#8\)\. The belt is vacant, so the winner becomes champion\./);
  assert.ok(vacant.lines.some((l) => /Co-main event: Deiveson Figueiredo \(#9\) vs Payton Talbott \(#11\), Bantamweight\./.test(l)));
  assert.ok(vacant.lines.some((l) => /Rankings run from champion/.test(l)), 'teaches what a ranking is');

  const defence = ufcFacts(event('numbered:340', 'UFC 340'), detail(parseEventPage(page([{ red: 'Champ Person', blue: 'Some Challenger', cls: 'Heavyweight Title Bout', ranks: ['C', '#2'] }]))));
  assert.match(defence.lines[0], /Champ Person \(champion\) vs Some Challenger \(#2\)\. The champion is defending the belt\./);

  const two = ufcFacts(event('numbered:341', 'UFC 341'), detail(parseEventPage(page([
    { red: 'A One', blue: 'B Two', cls: 'Lightweight Title Bout', ranks: ['C', '#1'] },
    { red: 'C Three', blue: 'D Four', cls: "Women's Strawweight Title Bout", ranks: ['C', '#3'] },
  ]))));
  assert.equal(two.level, 'Huge night: 2 title fights');

  const quiet = ufcFacts(event('ufc.com:ufc-fight-night-october-10-2026', 'UFC Fight Night: Allen vs Duncan'), detail(parseEventPage(page([{ red: 'Some Allen', blue: 'Other Duncan', cls: 'Middleweight Bout' }]))));
  assert.equal(quiet.badge, '🥊');
  assert.match(quiet.level!, /Regular Fight Night: no ranked fighters/);

  const topFive = ufcFacts(event('ufc.com:ufc-fight-night-x', 'UFC Fight Night: X vs Y'), detail(parseEventPage(page([{ red: 'X Ex', blue: 'Y Why', cls: 'Welterweight Bout', ranks: ['#2', '#5'] }]))));
  assert.match(topFive.level!, /two top-five fighters headline/);
  assert.ok(topFive.lines.some((l) => /winner moves closer to a title shot/.test(l)));

  const unknown = ufcFacts(event('numbered:334', 'UFC 334'), undefined);
  assert.match(unknown.level!, /Fights not announced yet/);
  assert.equal(unknown.updatedAt, null);
});

test('a card UFC has not split into segments yet is still read, in card order', () => {
  const bouts = parseEventPage(
    unsplitPage([
      { red: 'Alexander Volkanovski', blue: 'Movsar Evloev', cls: 'Featherweight Title Bout', ranks: ['C', '#1'] },
      { red: 'Petr Yan', blue: 'Merab Dvalishvili', cls: 'Bantamweight Title Bout', ranks: ['C', '#1'] },
      { red: 'Arnold Allen', blue: 'Aaron Pico', cls: 'Featherweight Bout', ranks: ['#7', '#12'] },
    ]),
  );
  assert.equal(bouts.length, 3, 'a page with no segment ids is not read as an empty card');
  assert.deepEqual(
    bouts.map((b) => b.segment),
    ['card', 'card', 'card'],
  );
  assert.deepEqual(bouts[0], { segment: 'card', weightClass: 'Featherweight', titleBout: true, red: 'Alexander Volkanovski', blue: 'Movsar Evloev', redRank: 'C', blueRank: '#1' });

  const facts = ufcFacts(event('numbered:333', 'UFC 333: Volkanovski vs Evloev'), detail(bouts));
  assert.equal(facts.badge, '🏆');
  assert.equal(facts.level, 'Huge night: 2 title fights');
  assert.match(facts.lines[0], /Featherweight title fight: Alexander Volkanovski \(champion\) vs Movsar Evloev \(#1\)\. The champion is defending the belt\./);
  // The top of the list is the main event, so it is not repeated as a separate main-event line.
  assert.ok(!facts.lines.some((l) => /^Main event:/.test(l)));
  assert.ok(facts.lines.some((l) => /3 fights announced so far\. UFC has not said yet which are on the main card\./.test(l)));
  assert.ok(!facts.lines.some((l) => /on the main card\.$/.test(l) && /fights in total/.test(l)));
});
