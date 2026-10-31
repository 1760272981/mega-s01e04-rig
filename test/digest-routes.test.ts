import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-30';
const temporaryDirectories: string[] = [];

function runsDirectory(source?: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  temporaryDirectories.push(directory);
  if (source !== undefined) writeFileSync(join(directory, `${night}.jsonl`), source);
  return directory;
}

function appFor(runsDir: string) {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('digest routes', () => {
  it('returns 404 from both routes when the night file is absent', async () => {
    const app = appFor(runsDirectory());

    const [page, json] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);

    expect(page.status).toBe(404);
    expect(json.status).toBe(404);
  });

  it('serves an existing empty night as a page and an empty JSON digest', async () => {
    const app = appFor(runsDirectory(''));

    const [page, json] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const digest = await json.json() as NightDigest;

    expect(page.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(digest).toEqual({
      night,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps page and JSON rows aligned and displays invalid lines and notable row state', async () => {
    const events = [
      { at: '2026-10-30T01:00:00+02:00', job: '<alpha>', status: 'fail', owner: 'Mira', error: '<bad & noisy>' },
      { at: '2026-10-30T01:01:00+02:00', job: '<alpha>', status: 'retry', owner: 'Mira' },
      { at: '2026-10-30T01:02:00+02:00', job: '<alpha>', status: 'retry', owner: 'Mira' },
      { at: '2026-10-30T01:03:00+02:00', job: '<alpha>', status: 'retry', owner: 'Mira' },
      { at: '2026-10-30T00:00:00Z', job: 'beta', status: 'ok', owner: null },
      { at: '2026-10-30T03:00:00-04:00', job: 'gamma', status: 'fail', owner: 'Sam', error: 'quota exceeded' },
    ];
    const source = [
      ...events.map((event) => JSON.stringify(event)),
      '{not json',
      JSON.stringify({ at: '2026-10-30T04:00:00Z', job: 'invalid', status: 'done', owner: 'Sam' }),
    ].join('\n');
    const app = appFor(runsDirectory(source));

    const [page, json] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await page.text();
    const digest = await json.json() as NightDigest;

    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    expect(digest.badLines).toBe(2);
    expect(html).toContain('2 malformed lines skipped');
    expect(digest.rows.map((row) => row.job)).toEqual(['<alpha>', 'beta', 'gamma']);
    expect(digest.rows[1]).toMatchObject({ owner: null, firstAt: '2026-10-30T00:00:00Z' });
    expect(html.indexOf('&lt;alpha&gt;')).toBeLessThan(html.indexOf('>beta<'));
    expect(html.indexOf('>beta<')).toBeLessThan(html.indexOf('>gamma<'));
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('3 · high');
    expect(html).toContain('failure recorded');
    expect(html).toContain('<strong class="warn">fail</strong>');
    expect(html).toContain('&lt;bad &amp; noisy&gt;');
    expect(html).not.toContain('<bad & noisy>');
    expect(digest.rows.map((row) => [row.firstAt, row.lastAt])).toContainEqual([
      '2026-10-30T01:00:00+02:00',
      '2026-10-30T01:03:00+02:00',
    ]);
    expect(digest.rows[1]?.lastAt).toBe('2026-10-30T00:00:00Z');
    expect(digest.rows[2]?.lastAt).toBe('2026-10-30T03:00:00-04:00');
    for (const timestamp of [
      '2026-10-30T01:00:00+02:00',
      '2026-10-30T01:03:00+02:00',
      '2026-10-30T00:00:00Z',
      '2026-10-30T03:00:00-04:00',
    ]) expect(html).toContain(timestamp);
  });
});
