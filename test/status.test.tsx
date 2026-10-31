import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('10 ok · 4 retry · 1 fail');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('7 ok · 0 retry · 0 fail');

    for (const night of ['2026-10-28', '2026-10-27']) {
      const digest = await createApp(config).request(`/digest/${night}`);
      expect(digest.status).toBe(200);
    }
  });

  it('shows no nights for empty or missing run directories', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'rig-status-'));
    const emptyDir = join(temp, 'empty');
    mkdirSync(emptyDir);
    try {
      for (const runsDir of [emptyDir, join(temp, 'missing')]) {
        const res = await createApp({ ...config, runsDir }).request('/');
        const html = await res.text();
        expect(res.status).toBe(200);
        expect(html).toContain('nothing in runs/');
        expect(html).not.toContain('/digest/');
      }

      writeFileSync(join(emptyDir, '2026-10-30.jsonl'), '');
      const emptyNight = await createApp({ ...config, runsDir: emptyDir }).request('/');
      const html = await emptyNight.text();
      expect(html).toContain('<a href="/digest/2026-10-30">2026-10-30</a>');
      expect(html).toContain('0 ok · 0 retry · 0 fail');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('health answers with the lane id', async () => {
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-07' });
  });
});
