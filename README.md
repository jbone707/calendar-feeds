# Calendar Feeds

Calendar subscriptions for schedules that keep changing. Subscribe once on a phone and the entries stay current. UFC is the first feed; the project is built so more can be added.

- Status page and subscribe buttons: https://jbone707.github.io/calendar-feeds/
- UFC calendar: `https://jbone707.github.io/calendar-feeds/ufc.ics`

Each feed is its own calendar, so it can be shown or hidden on its own. Entries are marked free and have no alerts.

## Two Kinds of Calendar

1. **Feeds built here** (`src/feeds/<id>/`). Used when nobody publishes a good free calendar. Currently: `ufc`.
2. **Calendars someone else already publishes** (`externalCalendars` in `src/feeds/index.ts`). Only listed on the status page. Currently: the 49ers' own calendar from 49ers.com.

Always look for the second kind first. An official calendar is more accurate and needs no upkeep. See `docs/ADDING_A_FEED.md`.

## How It Runs

A GitHub Actions workflow (`.github/workflows/refresh.yml`) runs four times a day. For every feed it reads the source once, reconciles it with `data/<id>/state.json`, checks the result, and publishes `<id>.ics` plus one status page to GitHub Pages. Nothing runs on a personal computer.

Feeds are independent. If one source is down, that calendar keeps its last good data and says so on the status page; the others update normally.

Apple Calendar decides how often a phone fetches a subscribed calendar, so a change can take hours to appear.

## Layout

```
src/config.ts            where the site is published (one place to change)
src/core/                shared engine: model, reconcile, validate, calendar, status page
src/feeds/index.ts       the list of feeds and of outside calendars
src/feeds/ufc/           UFC: page parser, what counts as a UFC card, feed settings
src/update.ts            runs every feed and writes public/
data/<id>/state.json     each feed's events and their permanent UIDs. Never delete.
data/<id>/run.json       last refresh result per feed
tests/<id>/              failure-mode tests per feed
```

## Rules Every Feed Gets From the Engine

- Each event gets a random UID once. Title, date, venue, time and even the source's own id can change without creating a duplicate.
- `SEQUENCE` and `LAST-MODIFIED` change only when something visible changes. An unchanged run produces a byte-identical calendar.
- No time is ever invented. An event with a date but no published start is an all-day entry marked "time TBD", and later becomes a timed entry with the same UID.
- A time or venue that goes blank at the source does not erase what was known.
- Missing from the list is not a cancellation. An event is marked cancelled only when the feed can check the event's own page and it is gone on three runs in a row. It then stays in the calendar as cancelled.
- Finished and cancelled events are kept for 90 days, then dropped. Finished events are frozen.
- A refresh is rejected, and the previous calendar kept, when the page has no events, none that the feed tracks, more than half the upcoming events vanish at once, a time is implausible, time labels look swapped, or a UID would change.

## UFC Feed

Source: `https://www.ufc.com/events`. Start times come from the attributes UFC labels `data-main-card-timestamp`, `data-prelims-card-timestamp` and `data-early-card-timestamp`. They are exact instants, so time zones and daylight saving need no guessing. The entry starts at the main card; prelim times go in the notes; the end is a three-hour estimate.

- robots.txt allows the events pages and asks for a 15-second crawl delay, which is honoured. A normal run makes one request. A card that disappears from the list triggers one extra request for its own page, three at most per run.
- UFC's Terms of Use prohibit automated access without permission. James chose to accept that for a personal, low-volume feed on 2026-09-19. UFC may block it at any time. If that happens the calendar keeps its last good data and the status page says so.
- A card postponed with no new date usually keeps its page, so it stays on its old date until UFC changes it. Known limit.

What is included is decided from the structure of UFC's page address (`src/feeds/ufc/classify.ts`):

| Address looks like | Result |
| --- | --- |
| `ufc-332`, `cryptocom-ufc-331` | Numbered event |
| `ufc-fight-night-...` | Fight Night |
| other `ufc-...` | Special card: included and flagged on the status page |
| Contender Series, Road to UFC, The Ultimate Fighter, UFC BJJ, weigh-ins, press conferences | Left out |
| anything else | Left out and reported on the status page |

## Commands

```
npm ci
npm test                      # all feeds' failure-mode tests
npm run refresh               # every feed: fetch, reconcile, validate, write public/ and data/
npm run refresh -- --feed ufc # one feed only
npm run render                # rebuild public/ from saved state without fetching
```

Manual refresh: GitHub, Actions, "Refresh calendars", Run workflow.

## Recovery

- A run failed: the last good calendars were republished. Open the failed run and read the "Refresh all feeds" step; each line starts with the feed's id. GitHub emails the repo owner about failed scheduled runs.
- A source changed its page layout: update that feed's parser in `src/feeds/<id>/source.ts` and the markup in `tests/<id>/helpers.ts`.
- Bad data got published: revert the offending commit to `data/<id>/state.json`, then run the workflow. Never delete a `state.json`; it holds the UIDs, and losing it makes every event appear twice on subscribed devices.
- The repo gets renamed: every subscription address changes and phones must resubscribe. Avoid it. If it must happen, change `src/config.ts`.
- GitHub pauses scheduled workflows after 60 days with no repository activity. The workflow commits `data/<id>/run.json` about once a day, which counts as activity. If it is ever paused, GitHub emails first, and one click in the Actions tab re-enables it.

## Cost

Free. Public repositories get unlimited standard Actions minutes, and each run takes about a minute. GitHub Pages allows 100 GB of bandwidth a month; each calendar is a few kilobytes.
