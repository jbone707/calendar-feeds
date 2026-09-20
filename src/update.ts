import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { checkIcs, renderCalendar } from './core/calendar.ts';
import { emptyMeta } from './core/model.ts';
import type { Feed, FeedEvent, PageCheck, RunMeta } from './core/model.ts';
import { reconcileEvents } from './core/reconcile.ts';
import { renderStatusPage } from './core/status.ts';
import type { FeedStatus } from './core/status.ts';
import { validateUpdate } from './core/validate.ts';
import { externalCalendars, feeds } from './feeds/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PAGE_CHECKS = 3;
const HEARTBEAT_MS = 24 * 3_600_000;

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

    const icsProblem = checkIcs(renderCalendar(feed, result.events), result.events.filter((e) => e.localEventDate).length);
    if (icsProblem) return keep(`Calendar failed its own check: ${icsProblem}`);

    return { ok: true, error: null, events: result.events, report: result.report, warnings: [...fetched.problems, ...result.warnings] };
  } catch (e) {
    return keep(`Could not read ${feed.sourceName}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  const renderOnly = process.argv.includes('--render-only');
  const only = process.argv.includes('--feed') ? process.argv[process.argv.indexOf('--feed') + 1] : null;
  if (only && !feeds.some((f) => f.id === only)) throw new Error(`No feed called "${only}". Known: ${feeds.map((f) => f.id).join(', ')}`);
  const now = new Date();
  const statuses: FeedStatus[] = [];

  // Feeds are independent: one failing never blocks or alters another.
  for (const feed of feeds) {
    const statePath = join(ROOT, 'data', feed.id, 'state.json');
    const metaPath = join(ROOT, 'data', feed.id, 'run.json');
    const previous = readJson<{ version: 1; events: FeedEvent[] }>(statePath, { version: 1, events: [] }).events;
    const meta = readJson<RunMeta>(metaPath, emptyMeta());
    let events = previous;
    let live = meta;

    if (!renderOnly && (!only || only === feed.id)) {
      const outcome = await attemptRefresh(feed, previous, { now: () => new Date() });
      events = outcome.events;
      live = {
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: outcome.ok ? now.toISOString() : meta.lastSuccessAt,
        lastError: outcome.error,
        lastChangeReport: outcome.ok && outcome.report.length ? outcome.report : meta.lastChangeReport,
        warnings: outcome.ok ? outcome.warnings : meta.warnings,
      };
      for (const line of outcome.report) console.log(`[${feed.id}] ${line}`);
      for (const w of live.warnings) console.log(`[${feed.id}] note: ${w}`);
      if (!outcome.ok) {
        console.error(`[${feed.id}] REFRESH FAILED, keeping the last good calendar: ${outcome.error}`);
        process.exitCode = 2;
      } else console.log(`[${feed.id}] Refresh OK: ${events.length} events in state.`);

      // Event state is rewritten only when it differs, so git history shows real schedule changes.
      const nextState = `${JSON.stringify({ version: 1, events }, null, 2)}\n`;
      if (!existsSync(statePath) || readFileSync(statePath, 'utf8') !== nextState) writeAtomic(statePath, nextState);

      // Run details are committed about once a day unless something other than the clock changed.
      const strip = ({ lastAttemptAt: _a, lastSuccessAt: _s, ...rest }: RunMeta) => JSON.stringify(rest);
      const heartbeatDue = !meta.lastSuccessAt || now.getTime() - Date.parse(meta.lastSuccessAt) > HEARTBEAT_MS;
      if (strip(meta) !== strip(live) || (live.lastError === null && heartbeatDue)) writeAtomic(metaPath, `${JSON.stringify(live, null, 2)}\n`);
    }

    // The calendar is always rendered from the last valid state, so a failed run republishes identical bytes.
    const ics = renderCalendar(feed, events);
    const problem = checkIcs(ics, events.filter((e) => e.localEventDate).length);
    if (problem) throw new Error(`[${feed.id}] Refusing to publish: ${problem}`);
    writeAtomic(join(ROOT, 'public', `${feed.id}.ics`), ics);
    statuses.push({ feed, events, meta: live });
  }

  writeAtomic(join(ROOT, 'public/index.html'), renderStatusPage(statuses, externalCalendars, now));
  writeAtomic(join(ROOT, 'public/.nojekyll'), '');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
