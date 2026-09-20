import { httpsUrl, webcalUrl } from '../config.ts';
import { pacific } from './calendar.ts';
import type { ExternalCalendar, Feed, FeedEvent, RunMeta } from './model.ts';

export type FeedStatus = { feed: Feed; events: FeedEvent[]; meta: RunMeta };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pacificDay = (date: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));

const list = (items: string[]) => items.map((w) => `<li>${esc(w)}</li>`).join('\n');

function feedSection({ feed, events, meta }: FeedStatus): string {
  const file = `${feed.id}.ics`;
  const upcoming = events.filter((e) => e.status !== 'completed' && e.localEventDate);
  const rows = upcoming
    .map((e) => {
      const when = e.startUtc
        ? `<time datetime="${e.startUtc}" data-local>${esc(pacific(e.startUtc))}</time>`
        : `${esc(pacificDay(e.localEventDate!))}, time TBD`;
      const tag = e.status === 'cancelled' ? ' <span class="tag">Cancelled</span>' : '';
      return `<li><span class="t">${esc(e.title)}${tag}</span><span class="w">${when}</span>${e.location ? `<span class="l">${esc(e.location)}</span>` : ''}</li>`;
    })
    .join('\n');
  const failing = meta.lastError !== null;

  return `<section class="feed">
<h2>${esc(feed.name)}</h2>
<p class="mute">${esc(feed.description)}</p>
<div class="warn" data-stale ${failing ? '' : 'hidden'}>${
    failing ? `The last refresh did not succeed, so this calendar is showing the last good schedule. ${esc(meta.lastError ?? '')}` : ''
  }</div>
<a class="btn" href="${webcalUrl(file)}">Subscribe to ${esc(feed.name)}</a>
<code>${httpsUrl(file)}</code>
<p>Last successful refresh: ${
    meta.lastSuccessAt ? `<time datetime="${meta.lastSuccessAt}" data-local data-ok>${esc(pacific(meta.lastSuccessAt))}</time>` : 'never'
  }</p>
<h3>On the Calendar Now</h3>
<ul class="ev">
${rows || '<li>Nothing upcoming is listed yet.</li>'}
</ul>
${meta.warnings.length ? `<h3>Worth a Look</h3>\n<ul class="plain">\n${list(meta.warnings)}\n</ul>` : ''}
${meta.lastChangeReport.length ? `<h3>Latest Changes</h3>\n<ul class="plain">\n${list(meta.lastChangeReport)}\n</ul>` : ''}
<h3>How It Works</h3>
<p class="mute">${esc(feed.about)}</p>
</section>`;
}

function externalSection(c: ExternalCalendar): string {
  return `<section class="feed">
<h2>${esc(c.name)}</h2>
<p class="mute">${esc(c.note)}</p>
<a class="btn" href="webcal://${c.host}${c.path}">Subscribe to ${esc(c.name)}</a>
<code>https://${c.host}${c.path}</code>
</section>`;
}

export function renderStatusPage(feeds: FeedStatus[], external: ExternalCalendar[], now: Date): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Calendar Feeds</title>
<style>
:root{--bg:#f6f5f2;--fg:#1a1a1a;--mute:#5f5f5f;--card:#fff;--line:#e2e0da;--accent:#b3131b;--warn-bg:#fff4d6;--warn-fg:#5c4300}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ededed;--mute:#a3a3a3;--card:#1c1c1c;--line:#2e2e2e;--accent:#e5484d;--warn-bg:#3a2f0b;--warn-fg:#f3d98b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.6rem;margin:0 0 4px}
h2{font-size:1.3rem;margin:0 0 4px}
h3{font-size:1rem;margin:24px 0 8px}
p{margin:8px 0}
.mute{color:var(--mute)}
.feed{border-top:1px solid var(--line);margin-top:32px;padding-top:24px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none;margin:12px 0}
code{display:block;padding:12px;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow-wrap:anywhere;font-size:.9rem}
.warn{background:var(--warn-bg);color:var(--warn-fg);padding:12px 16px;border-radius:8px;margin:16px 0}
ul{list-style:none;padding:0;margin:0}
ul.ev li{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:8px 0;display:flex;flex-direction:column}
.t{font-weight:600}.w{font-variant-numeric:tabular-nums}.l{color:var(--mute);font-size:.9rem}
.tag{font-size:.75rem;border:1px solid currentColor;border-radius:4px;padding:0 6px;margin-left:6px;color:var(--accent)}
ul.plain li{padding:4px 0;border-bottom:1px solid var(--line)}
</style>
</head>
<body>
<main>
<h1>Calendar Feeds</h1>
<p class="mute">Schedules that keep themselves current. Subscribe to each one once on your phone. Each is a separate calendar you can show or hide.</p>
<p class="mute">If a button does nothing, copy the address under it into Calendar, then Calendars, then Add Calendar, then Add Subscription Calendar. Schedules are checked four times a day. Apple Calendar decides when your phone fetches them, so a change can take several hours to show up.</p>

${feeds.map(feedSection).join('\n\n')}

${external.map(externalSection).join('\n\n')}

<p class="mute" style="margin-top:32px">Page built ${esc(pacific(now.toISOString()))}. Not affiliated with any league, team, or promotion.</p>
</main>
<script>
document.querySelectorAll('time[data-local]').forEach(function(t){
  var d=new Date(t.getAttribute('datetime'));
  t.textContent=d.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
});
document.querySelectorAll('section.feed').forEach(function(s){
  var ok=s.querySelector('time[data-ok]'),stale=s.querySelector('[data-stale]');
  if(ok&&stale&&stale.hidden&&Date.now()-new Date(ok.getAttribute('datetime')).getTime()>36*3600*1000){
    stale.hidden=false;
    stale.textContent='This schedule has not refreshed in over a day and a half. The calendar still shows the last good data, but the updater needs attention.';
  }
});
</script>
</body>
</html>
`;
}
