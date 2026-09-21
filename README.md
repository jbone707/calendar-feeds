# Calendar Feeds

Calendar subscriptions for schedules that keep changing. Subscribe once on a phone and the entries stay current. UFC is the first feed; the project is built so more can be added.

- Status page and subscribe buttons: https://jbone707.github.io/calendar-feeds/
- **Sports** (UFC and 49ers together, the household calendar): `https://jbone707.github.io/calendar-feeds/sports.ics`
- UFC only: `https://jbone707.github.io/calendar-feeds/ufc.ics`
- 49ers only: `https://jbone707.github.io/calendar-feeds/niners.ics`

Subscribe to Sports **or** to the single-sport calendars, not both, or every event shows twice.

Each feed is its own calendar, so it can be shown or hidden on its own. Entries are marked free and have no alerts.

## Two Kinds of Calendar

1. **Feeds built here** (`src/feeds/<id>/`). Currently `ufc` (read from UFC.com) and `niners` (read from the calendar the 49ers publish themselves, with context added).
2. **Calendars someone else already publishes** (`externalCalendars` in `src/feeds/index.ts`). Only listed on the status page, nothing built. Currently none.

Feeds can be merged into one calendar (`combined` in `src/feeds/index.ts`). `sports` merges `ufc` and `niners`, so the household has one calendar, one colour, and one address for a shared display.

Always look for the second kind first. An official calendar is more accurate and needs no upkeep. See `docs/ADDING_A_FEED.md`.

## How It Runs

A GitHub Actions workflow (`.github/workflows/refresh.yml`) runs once a day, at about 6 AM Pacific (`cron: '17 13 * * *'`). James chose daily on 2026-09-20: schedules rarely change within a day, and it keeps requests to the sources low. For every feed it reads the source once, reconciles it with `data/<id>/state.json`, checks the result, and publishes `<id>.ics` plus one status page to GitHub Pages. Nothing runs on a personal computer.

Feeds are independent. If one source is down, that calendar keeps its last good data and says so on the status page; the others update normally.

Apple Calendar decides how often a phone fetches a subscribed calendar, so a change can take hours to appear.

## What Each Entry Says

Every entry has up to three layers, most useful first:

1. **A level line and the facts**, worked out by rules on every run, free. UFC: title fights, champion or vacant belt, rankings of the headliners, how many ranked matchups, numbered card or Fight Night, each explained in a few words for a newer fan. 49ers: home or away, division rival and why that matters, prime-time games, preseason. Title fights get a trophy in the title.
2. **A short write-up** for events in the next eight days: why it matters, and one thing worth knowing that builds a newer fan's knowledge. Written by Claude (Anthropic API, with web search to check current records, rankings and standings). For the 49ers it is told to state playoff stakes bluntly only when they are real.
3. **Times and source**, as before.

The write-up is optional and strictly additive. With no `ANTHROPIC_API_KEY` secret, or if that step fails, entries show layers 1 and 3. A write-up can never change a time, a title or an event's identity. Write-ups are refreshed every four days, when the facts change (a bout is swapped), and once more the day before. Each must pass a filter: short plain text, no links, no markup, no betting talk. Entries with a write-up say it was written by AI and can contain mistakes.

Settings: repository secret `ANTHROPIC_API_KEY`; optional repository variable `NOTES_MODEL` (default `claude-sonnet-5`). To switch write-ups off, delete the secret.

## Layout

```
src/config.ts            where the site is published (one place to change)
src/core/                shared engine: model, reconcile, validate, calendar, status page
src/feeds/index.ts       the list of feeds and of outside calendars
src/feeds/ufc/           UFC: page parser, what counts as a UFC card, bout lists and rules, feed settings
src/feeds/niners/        49ers: reads the team's own calendar, matchup rules
src/core/notes.ts        the optional AI write-up step
src/update.ts            runs every feed and writes public/
data/<id>/state.json     each feed's events and their permanent UIDs. Never delete.
data/<id>/run.json       last refresh result per feed
data/<id>/details.json   extra details per event (UFC bout lists)
data/notes.json          current write-ups, keyed by event UID
tests/<id>/              failure-mode tests per feed
```

## Rules Every Feed Gets From the Engine

- Each event gets a random UID once. Title, date, venue, time and even the source's own id can change without creating a duplicate.
- Event times are written in the household's zone (`HOME_TZ` in `src/config.ts`, America/Los_Angeles) with the zone's rules included, not in UTC. Same instants; it stops Apple Calendar printing a second "(1AM GMT)" time on every entry. A phone elsewhere still converts correctly and shows the Pacific time as the second one.
- `SEQUENCE` and `LAST-MODIFIED` change only when something visible changes. An unchanged run produces a byte-identical calendar.
- No time is ever invented. An event with a date but no published start is an all-day entry marked "time TBD", and later becomes a timed entry with the same UID.
- A time or venue that goes blank at the source does not erase what was known.
- Missing from the list is not a cancellation. An event is marked cancelled only when the feed can check the event's own page and it is gone on three runs in a row (three days, at one run a day). It then stays in the calendar as cancelled.
- Finished and cancelled events are kept for 90 days, then dropped. Finished events are frozen.
- A refresh is rejected, and the previous calendar kept, when the page has no events, none that the feed tracks, more than half the upcoming events vanish at once, a time is implausible, time labels look swapped, or a UID would change.

## UFC Feed

Source: `https://www.ufc.com/events`. Start times come from the attributes UFC labels `data-main-card-timestamp`, `data-prelims-card-timestamp` and `data-early-card-timestamp`. They are exact instants, so time zones and daylight saving need no guessing. The entry starts at the main card; prelim times go in the notes; the end is a three-hour estimate.

- robots.txt allows the events pages and asks for a 15-second crawl delay, which is honoured. The daily run makes one request for the events list, then reads each upcoming card's own page for its bout list (about ten requests a day in total, 15 seconds apart). A card that disappears from the list triggers one extra request for its own page, three at most per run.
- UFC's Terms of Use prohibit automated access without permission. James chose to accept that for a personal, low-volume feed on 2026-09-19. UFC may block it at any time. If that happens the calendar keeps its last good data and the status page says so.
- UFC's events page shows about eight upcoming cards before its "Load more" button, and the feed reads only that first page to stay at one request per run. Cards further out appear on their own as nearer ones pass. Verified 2026-09-20: 8 shown of 10 announced. Known limit.
- A card postponed with no new date usually keeps its page, so it stays on its old date until UFC changes it. Known limit.

What is included is decided from the structure of UFC's page address (`src/feeds/ufc/classify.ts`):

| Address looks like | Result |
| --- | --- |
| `ufc-332`, `cryptocom-ufc-331` | Numbered event |
| `ufc-fight-night-...` | Fight Night |
| other `ufc-...` | Special card: included and flagged on the status page |
| Contender Series, Road to UFC, The Ultimate Fighter, UFC BJJ, weigh-ins, press conferences | Left out |
| anything else | Left out and reported on the status page |

## 49ers Feed

Source: `https://www.49ers.com/api/addToCalendar/ag/s`, the subscription calendar the team publishes. One request per run. Kickoff times, including flexed ones, follow the team. A game the league has not scheduled yet (usually the final week) is absent until the team lists it. 49ers.com issues a fresh id for every event on every request (seen 2026-09-21), so its ids are ignored. A game is identified by season, phase (preseason, season, playoffs), home or away, and opponent, which is what keeps its UID stable and the saved state from growing. An empty calendar in the off-season is treated as normal.

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

Hosting is free. Write-ups are the only cost: roughly sixteen short Anthropic API calls a month, each with up to three web searches. Estimated at a few dollars a month at most; not yet measured. Set a monthly spend limit in the Anthropic Console. Public repositories get unlimited standard Actions minutes, and each run takes about a minute. GitHub Pages allows 100 GB of bandwidth a month; each calendar is a few kilobytes.
