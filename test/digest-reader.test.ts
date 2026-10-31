import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const temporaryDirectories: string[] = [];

function fixture(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, `${night}.jsonl`), source);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('readNight', () => {
  it('reads the real night without changing its fixture', () => {
    const digest = readNight('runs', night);
    expect(digest).toMatchObject({ night, badLines: 1, counts: { ok: 10, retry: 4, fail: 1 } });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
      lastError: null, firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00', hasFailure: false,
    });
    expect(digest?.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', hasFailure: true });
  });

  it('distinguishes missing and invalid nights from empty and blank-only files', () => {
    const directory = fixture('');
    expect(readNight(directory, '2026-10-30')).toBeNull();
    expect(readNight(join(directory, 'absent'), night)).toBeNull();
    expect(readNight(directory, '../2026-10-28')).toBeNull();
    expect(readNight(directory, `${night}.jsonl`)).toBeNull();
    const empty = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
    expect(readNight(directory, night)).toEqual(empty);
    expect(readNight(fixture('  \r\n\n\t\n'), night)).toEqual(empty);
  });

  it('counts malformed JSON and shapes while retaining valid rows', () => {
    const valid = { at: '2026-10-29T03:00:00+01:00', job: 'job', status: 'ok', owner: null };
    const malformed = [
      null, [], 'text', 42, {}, { ...valid, at: 'not a timestamp' },
      { ...valid, at: '2026-10-29T03:00:00' }, { ...valid, job: ' ' },
      { ...valid, status: 'unknown' }, { ...valid, owner: 42 },
      { at: valid.at, job: 'job', status: 'ok' }, { ...valid, error: null },
    ];
    const source = [...malformed.map((line) => JSON.stringify(line)), '{broken', JSON.stringify(valid)].join('\r\n');
    const digest = readNight(fixture(source), night);
    expect(digest).toMatchObject({ badLines: 13, counts: { ok: 1, retry: 0, fail: 0 } });
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0].owner).toBeNull();
  });

  it('orders by instant across offsets, preserves strings and retains recovered failures', () => {
    const events = [
      { at: '2026-10-29T01:00:00Z', job: 'job', status: 'ok', owner: null },
      { at: '2026-10-29T00:30:00Z', job: 'job', status: 'retry', owner: 'new', error: 'latest error' },
      { at: '2026-10-29T02:00:00+02:00', job: 'job', status: 'fail', owner: 'old', error: 'first error' },
    ];
    expect(readNight(fixture(events.map((event) => JSON.stringify(event)).join('\n')), night)?.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-29T02:00:00+02:00', lastAt: '2026-10-29T01:00:00Z', hasFailure: true,
    }]);
  });

  it('breaks equal-time ties by file order and handles special job names', () => {
    const events = [
      { at: '2026-10-29T01:00:00+01:00', job: '__proto__', status: 'fail', owner: 'first', error: 'failed' },
      { at: '2026-10-29T00:00:00Z', job: '__proto__', status: 'ok', owner: 'last' },
    ];
    expect(readNight(fixture(events.map((event) => JSON.stringify(event)).join('\n')), night)?.rows).toEqual([{
      job: '__proto__', owner: 'last', runs: 2, retries: 0, lastStatus: 'ok', lastError: 'failed',
      firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T00:00:00Z', hasFailure: true,
    }]);
  });

  it('does not disguise other filesystem errors as a missing night', () => {
    const directory = fixture('');
    mkdirSync(join(directory, '2026-10-30.jsonl'));
    expect(() => readNight(directory, '2026-10-30')).toThrow();
  });
});
