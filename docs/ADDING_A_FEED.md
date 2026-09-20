# Adding a Calendar

Work through these in order. Stop at the first step that solves it.

## Step 1. Look for a Calendar Someone Already Publishes

Teams, leagues, venues and schools often publish a free subscription calendar. It will be more accurate than anything built here and needs no upkeep. Look for "Add to Calendar", "Sync Schedule" or "Subscribe" on the official site.

It qualifies only if all of these hold:

- The address returns a real calendar (`text/calendar`, begins `BEGIN:VCALENDAR`), not a web page or a one-time download.
- No payment, account or email is needed.
- Times are exact instants (they end in `Z` or carry a time zone).
- Fetching it twice gives the same `UID` for each event, so changes update entries instead of duplicating them.
- It has no alerts or invitations baked in, or only ones James wants.

If it qualifies, add it to `externalCalendars` in `src/feeds/index.ts`. That puts a subscribe button on the status page. Nothing else is built. The 49ers calendar was added this way.

## Step 2. Choose a Source to Build From

Only if step 1 found nothing. Before writing code, record in the README:

- The exact page or API, and what each time on it means (doors, first game, main event, kickoff). Never guess a time's meaning.
- What robots.txt says and what the terms of use say. If the terms forbid automated access, that is James's decision to make, in writing, before building.
- The crawl delay to honour. One request per run is the goal.

Do not use paid feeds, anything behind a login, or anything that needs a CAPTCHA or bot check bypassed.

## Step 3. Build the Feed

Create `src/feeds/<id>/` with:

- `source.ts`: fetch the page and turn it into `SourceRecord`s (see `src/core/model.ts`). This is where the feed decides what is included and how it is titled.
- `index.ts`: a `Feed` object with the id, names, the label for what the start time means, the duration estimate, the time zone that decides an event's calendar day, the crawl delay, `fetch`, and optionally `checkPage`.

The rules that matter in `source.ts`:

- `key` must identify the event for its whole life. Use the source's own stable id. Never build it from the date or the title.
- `startUtc` is null unless the source publishes that exact time. Never fill in a usual time.
- Put secondary times (prelims, doors, qualifying) in `extraTimes`. They appear in the notes and are never used as the start.
- `itemsSeen` counts raw items on the page before filtering. It lets the engine tell "this page has none of our events today" from "this page is broken".
- Report anything left out for an unclear reason in `problems`, so it shows on the status page.
- Without `checkPage`, events are never auto-cancelled. That is the safe default.

Register it in `src/feeds/index.ts`. The engine then gives it identity, change tracking, validation, cancellation rules, retention, the calendar file and a status page section.

## Step 4. Test It

Copy `tests/ufc/` as a starting point. Build pages in the real markup of the source and cover at least: what is included and left out, a time TBD event becoming timed with the same UID, a date change keeping the UID, a broken or empty page keeping the old calendar, and awkward characters in names. Tests must describe behaviour, not mirror the parser.

## Step 5. Verify Live Before Subscribing

After the first hosted run: the calendar address returns `text/calendar`, every event matches the source's own page, and a second run changes nothing.
