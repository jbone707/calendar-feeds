// Builds pages in the markup observed on ufc.com/events on 2026-09-19 (class names and data attributes copied from the live page).
export type Card = {
  slug: string;
  headline: string;
  main?: number | null; // unix seconds
  prelims?: number | null;
  early?: number | null;
  venue?: string;
  city?: string;
  region?: string;
  country?: string;
};

const ts = (n: number | null | undefined) => (n == null ? '' : String(n));

export function cardHtml(c: Card): string {
  return `<article class="c-card-event--result">
 <div class="c-card-event--result__logo"><a href="/event/${c.slug}"></a></div>
 <div class="c-card-event--result__info">
  <h3 class="c-card-event--result__headline"><a href="/event/${c.slug}">${c.headline}</a></h3>
  <div class="c-card-event--result__date tz-change-data" data-locale="en" data-format="D, M j / g:i A T" data-main-card="" data-main-card-timestamp="${ts(c.main)}" data-prelims-card="" data-prelims-card-timestamp="${ts(c.prelims)}" data-early-card="" data-early-card-timestamp="${ts(c.early)}" data-card-event-title="Main Card">
   <a href="/event/${c.slug}#1234">whatever text</a>
  </div>
 </div>
 <div class="e-p--small c-card-event--result__location"> <div class="field field--name-venue"><div class="taxonomy-term"> <div> <div class="field"><h5> ${c.venue ?? ''} </h5> </div> <div class="field field--name-location"><p class="address" translate="no"><span class="locality">${c.city ?? ''}</span>, ${c.region ? `<span class="administrative-area">${c.region}</span>` : ''}<br> <span class="country">${c.country ?? ''}</span></p></div> </div> </div> </div> </div>
</article>`;
}

export function pageHtml(upcoming: Card[], past: Card[] = []): string {
  return `<!doctype html><html><body>
<details id="events-list-upcoming"><div class="althelete-total">${upcoming.length} Events</div>${upcoming.map(cardHtml).join('\n')}</details>
<details id="events-list-past">${past.map(cardHtml).join('\n')}</details>
</body></html>`;
}

export const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
