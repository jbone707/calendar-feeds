import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { checkIcs, renderCalendar } from './core/calendar.ts';
import type { Entry } from './core/calendar.ts';
import { emptyMeta } from './core/model.ts';
import type { Feed, FeedEvent, PageCheck, RunMeta } from './core/model.ts';
import { DEFAULT_MODEL, emptyNotes, isUsable, updateNotes } from './core/notes.ts';
import type { NoteEntry, NotesFile } from './core/notes.ts';
import { reconcileEvents } from './core/reconcile.ts';
import { renderStatusPage } from './core/status.ts';
import type { FeedStatus } from './core/status.ts';
import { validateUpdate } from './core/validate.ts';
import { combined, externalCalendars, feeds } from './feeds/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PAGE_CHECKS = 3;
const HEARTBEAT_MS = 20 * 3_600_000; // runs are daily; a little under 24h so clock jitter never skips a day

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Write via a temp file and rename, so a crash never leaves a half-written calendar or state. */
function writeAtomic(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/** Rewrite a JSON file only when its content differs, so git history shows real changes. */
function writeJsonIfChanged(path: string, value: unknown) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (!existsSync(path) || readFileSync(path, 'utf8') !== next) writeAtomic(path, next);
}

export type RunOutcome = { ok: boolean; error: string | null; events: FeedEvent[]; report: string[]; warnings: string[] };
export type RunOptions = { now: () => Date; delayMs?: number };

/** One refresh attempt for one feed. Never throws; on any problem the previous events are returned untouched. */
export async function attemptRefresh(feed: Feed, previous: FeedEvent[], opts: RunOptions): Promise<RunOutcome> {
  const keep = (error: string): RunOutcome => ({ ok: false, error, events: previous, report: [], warnings: [] });
  try {
    const fetched = await feed.fetch();
    const now = opts.now();
    let result = reconcileEvents(feed, previous, fetched.records, now);
    if (result.needsPageCheck.length > 0 && feed.checkPage) {
      const checks = new Map<string, PageCheck>();
      for (const id of result.needsPageCheck.slice(0, MAX_PAGE_CHECKS)) {
        await sleep(opts.delayMs ?? feed.crawlDelayMs);
        checks.set(id, await feed.checkPage(id));
      }
      for (const id of result.needsPageCheck.slice(MAX_PAGE_CHECKS)) checks.set(id, { kind: 'unknown', detail: 'skipped to keep requests low' });
      result = reconcileEvents(feed, previous, fetched.records, now, checks);
    }
    const verdict = validateUpdate(feed, previous, result, fetched, now);
    if (!verdict.ok) return keep(verdict.reason);

    const bare = result.events.map((event) => ({ feed, event, facts: null, note: null }));
    const icsProblem = checkIcs(renderCalendar(feed, bare), result.events.filter((e) => e.localEventDate).length);
    if (icsProblem) return keep(`Calendar failed its own check: ${icsProblem}`);

    return { ok: true, error: null, events: result.events, report: result.report, warnings: [...fetched.problems, ...result.warnings] };
  } catch (e) {
    return keep(`Could not read ${feed.sourceName}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Pair each event with its feed, its rule-based facts and its write-up, ready to render. */
export function buildEntries(feed: Feed, events: FeedEvent[], details: Record<string, unknown>, notes: NotesFile): NoteEntry[] {
  return events.map((event) => ({ feed, event, facts: feed.facts(event, details[event.key]), note: isUsable(notes.notes[event.uid]) ? notes.notes[event.uid] : null }));
}

function publish(file: string, meta: { id: string; name: string; description: string }, entries: Entry[]) {
  const ics = renderCalendar(meta, entries);
  const problem = checkIcs(ics, entries.filter((x) => x.event.localEventDate).length);
  if (problem) throw new Error(`[${meta.id}] Refusing to publish: ${problem}`);
  writeAtomic(join(ROOT, 'public', file), ics);
}

async function main() {
  const renderOnly = process.argv.includes('--render-only');
  const only = process.argv.includes('--feed') ? process.argv[process.argv.indexOf('--feed') + 1] : null;
  if (only && !feeds.some((f) => f.id === only)) throw new Error(`No feed called "${only}". Known: ${feeds.map((f) => f.id).join(', ')}`);
  const now = new Date();
  const loaded: { feed: Feed; events: FeedEvent[]; details: Record<string, unknown>; meta: RunMeta }[] = [];

  // 1. Refresh each feed. Feeds are independent: one failing never blocks or alters another.
  for (const feed of feeds) {
    const dir = join(ROOT, 'data', feed.id);
    const previous = readJson<{ version: 1; events: FeedEvent[] }>(join(dir, 'state.json'), { version: 1, events: [] }).events;
    const meta = readJson<RunMeta>(join(dir, 'run.json'), emptyMeta());
    const details = readJson<Record<string, unknown>>(join(dir, 'details.json'), {});
    let events = previous;
    let live = meta;

    if (!renderOnly && (!only || only === feed.id)) {
      const outcome = await attemptRefresh(feed, previous, { now: () => new Date() });
      events = outcome.events;
      const warnings = outcome.ok ? [...outcome.warnings] : meta.warnings;

      // 2. Extra details (e.g. bout lists). Best effort: a failure here never fails the feed.
      if (outcome.ok && feed.enrich) {
        try {
          warnings.push(...(await feed.enrich(events, details, new Date())));
          writeJsonIfChanged(join(dir, 'details.json'), details);
        } catch (e) {
          warnings.push(`Extra details could not be updated (${e instanceof Error ? e.message : String(e)}).`);
        }
      }

      live = {
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: outcome.ok ? now.toISOString() : meta.lastSuccessAt,
        lastError: outcome.error,
        lastChangeReport: outcome.ok && outcome.report.length ? outcome.report : meta.lastChangeReport,
        warnings,
      };
      for (const line of outcome.report) console.log(`[${feed.id}] ${line}`);
      for (const w of live.warnings) console.log(`[${feed.id}] note: ${w}`);
      if (!outcome.ok) {
        console.error(`[${feed.id}] REFRESH FAILED, keeping the last good calendar: ${outcome.error}`);
        process.exitCode = 2;
      } else console.log(`[${feed.id}] Refresh OK: ${events.length} events in state.`);

      writeJsonIfChanged(join(dir, 'state.json'), { version: 1, events });
      // Run details are committed about once a day unless something other than the clock changed.
      const strip = ({ lastAttemptAt: _a, lastSuccessAt: _s, ...rest }: RunMeta) => JSON.stringify(rest);
      const heartbeatDue = !meta.lastSuccessAt || now.getTime() - Date.parse(meta.lastSuccessAt) > HEARTBEAT_MS;
      if (strip(meta) !== strip(live) || (live.lastError === null && heartbeatDue)) writeAtomic(join(dir, 'run.json'), `${JSON.stringify(live, null, 2)}\n`);
    }
    loaded.push({ feed, events, details, meta: live });
  }

  // 3. Optional AI write-ups for events coming up soon. No key, or any failure: entries just show the facts.
  const notesPath = join(ROOT, 'data', 'notes.json');
  let notes = readJson<NotesFile>(notesPath, emptyNotes());
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!renderOnly && !only && apiKey) {
    const all = loaded.flatMap((l) => buildEntries(l.feed, l.events, l.details, notes));
    const result = await updateNotes(all, notes, new Date(), { apiKey, model: process.env.NOTES_MODEL?.trim() || DEFAULT_MODEL });
    for (const line of result.log) console.log(`[notes] ${line}`);
    notes = result.file;
    writeJsonIfChanged(notesPath, notes);
  } else if (!renderOnly && !only) console.log('[notes] No ANTHROPIC_API_KEY set: write-ups are off, entries show facts only.');

  // 4. Publish. Every calendar is rendered from the last valid state, so a failed run republishes identical bytes.
  const statuses: FeedStatus[] = [];
  const entriesByFeed = new Map<string, NoteEntry[]>();
  for (const l of loaded) {
    const entries = buildEntries(l.feed, l.events, l.details, notes);
    entriesByFeed.set(l.feed.id, entries);
    publish(`${l.feed.id}.ics`, l.feed, entries);
    statuses.push({ feed: l.feed, entries, meta: l.meta });
  }
  for (const c of combined) publish(`${c.id}.ics`, c, c.feedIds.flatMap((id) => entriesByFeed.get(id) ?? []));

  writeAtomic(
    join(ROOT, 'public/index.html'),
    renderStatusPage(statuses, combined, externalCalendars, { enabled: !!apiKey, lastWrittenAt: notes.lastWrittenAt, lastError: notes.lastError }, now),
  );
  writeAtomic(join(ROOT, 'public/.nojekyll'), '');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
