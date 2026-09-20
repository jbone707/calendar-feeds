export type Category = 'numbered' | 'fight_night' | 'special';

export type Classification =
  | { include: true; category: Category; key: string; number?: number }
  | { include: false; reason: string };

// Things UFC lists on the same page that are not UFC fight cards James wants.
const EXCLUDED: [RegExp, string][] = [
  [/(^|-)dwcs(-|$)|contender-series/, "Dana White's Contender Series"],
  [/(^|-)road-to-ufc(-|$)/, 'Road to UFC'],
  [/(^|-)tuf(-|$)|ultimate-fighter/, 'The Ultimate Fighter'],
  [/(^|-)bjj(-|$)/, 'UFC BJJ'],
  [/weigh-in|press-conference|ceremonial|fan-expo|hall-of-fame/, 'non-fight programming'],
];

/**
 * Classify by the structure of UFC.com's event slug, not by loose substring matches.
 *  - numbered:     "ufc-332", optionally with one sponsor prefix ("cryptocom-ufc-331")
 *  - fight night:  "ufc-fight-night-..."
 *  - special:      any other slug that starts with "ufc-" and is not on the excluded list
 *                  (a UFC-branded MMA card with an unconventional name). Included, and flagged
 *                  on the status page so a wrong call is visible.
 *  - everything else is excluded and reported.
 */
export function classifySlug(slug: string): Classification {
  const s = slug.toLowerCase();
  for (const [re, reason] of EXCLUDED) if (re.test(s)) return { include: false, reason };

  const numbered = /^(?:[a-z0-9]+-)?ufc-(\d{2,4})$/.exec(s);
  if (numbered) {
    const n = Number(numbered[1]);
    return { include: true, category: 'numbered', key: `numbered:${n}`, number: n };
  }
  if (/^ufc-fight-night(-|$)/.test(s)) {
    return { include: true, category: 'fight_night', key: `ufc.com:${s}` };
  }
  if (/^ufc-/.test(s)) return { include: true, category: 'special', key: `ufc.com:${s}` };
  return { include: false, reason: 'unrecognised event type' };
}

export const isTbdHeadline = (h: string) => !h || /^tb[ad]\b/i.test(h);

export function buildTitle(c: Extract<Classification, { include: true }>, slug: string, headline: string): string {
  const h = isTbdHeadline(headline) ? '' : headline.trim();
  let base: string;
  if (c.category === 'numbered') base = `UFC ${c.number}`;
  else if (c.category === 'fight_night') base = 'UFC Fight Night';
  else
    base = slug
      .split('-')
      .map((w) => (w === 'ufc' ? 'UFC' : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
  return h ? `${base}: ${h}` : base;
}
