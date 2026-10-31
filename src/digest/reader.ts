import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'at' in value &&
    typeof value.at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at) &&
    Number.isFinite(Date.parse(value.at)) &&
    'job' in value &&
    typeof value.job === 'string' &&
    value.job.trim().length > 0 &&
    'status' in value &&
    (value.status === 'ok' || value.status === 'retry' || value.status === 'fail') &&
    'owner' in value &&
    (value.owner === null || typeof value.owner === 'string') &&
    (!('error' in value) || typeof value.error === 'string')
  );
}

export const readNight: ReadNight = (runsDir, night) => {
  // Route parameters never become paths outside the configured runs directory.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let source: string;
  try {
    source = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = {
    night,
    rows: [],
    badLines: 0,
    counts: { ok: 0, retry: 0, fail: 0 },
  };
  const events: RunEvent[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      digest.badLines += 1;
      continue;
    }
    if (!isRunEvent(value)) {
      digest.badLines += 1;
      continue;
    }
    events.push(value);
  }

  // Stable sorting retains file order when two events represent the same instant.
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = new Map<string, DigestRow>();
  for (const event of events) {
    digest.counts[event.status] += 1;
    let row = rows.get(event.job);
    if (!row) {
      row = {
        job: event.job,
        owner: event.owner,
        runs: 0,
        retries: 0,
        lastStatus: event.status,
        lastError: null,
        firstAt: event.at,
        lastAt: event.at,
        hasFailure: false,
      };
      rows.set(event.job, row);
    }
    row.owner = event.owner;
    row.runs += 1;
    row.retries += event.status === 'retry' ? 1 : 0;
    row.lastStatus = event.status;
    if (event.error !== undefined) row.lastError = event.error;
    row.lastAt = event.at;
    row.hasFailure ||= event.status === 'fail';
  }
  digest.rows = [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
