import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rawQuery, state } = vi.hoisted(() => ({ rawQuery: vi.fn(), state: { fail: false } }));
vi.mock('@/lib/prisma', () => ({
  default: {
    rawQuery: async (...args: unknown[]) => {
      if (state.fail) throw new Error('private database detail');
      return rawQuery(...args);
    },
  },
}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

import { GET } from './route';

describe('public blog counters', () => {
  beforeEach(() => {
    rawQuery.mockReset();
    state.fail = false;
  });
  it('only exposes numeric aggregates for the fixed blog and exact decoded article path', async () => {
    rawQuery
      .mockResolvedValueOnce([{ pv: 8n, uv: 3n }])
      .mockResolvedValueOnce([{ pv: 2n, uv: 1n }]);
    const path = '/en/2025/08/15/中文/';
    const response = await GET(
      new Request(`https://stats.example/api/public/blog-stats?path=${encodeURIComponent(path)}`),
    );
    expect(await response.json()).toEqual({
      source: 'umami-self-hosted',
      site: { pv: 8, uv: 3 },
      page: { pv: 2, uv: 1 },
    });
    expect(rawQuery.mock.calls[1][1]).toEqual({
      websiteId: '7ae63952-76fc-4a90-a5b7-aedd93fb56c9',
      path,
    });
    expect(rawQuery.mock.calls[1][0]).toContain('url_path = {{path}}');
    expect(response.headers.get('cache-control')).toContain('s-maxage=60');
  });
  it('accepts empty statistics without manufacturing visits', async () => {
    rawQuery.mockResolvedValue([{ pv: 0n, uv: 0n }]);
    const response = await GET(new Request('https://stats.example/api/public/blog-stats'));
    expect((await response.json()).site).toEqual({ pv: 0, uv: 0 });
    expect(rawQuery).toHaveBeenCalledTimes(1);
  });
  it('accepts public HKUST resource-document paths', async () => {
    rawQuery
      .mockResolvedValueOnce([{ pv: 8n, uv: 3n }])
      .mockResolvedValueOnce([{ pv: 2n, uv: 1n }]);
    const path = '/resources/hkust-exam-papers/blockchain/final-exam-2023/';
    const response = await GET(
      new Request(`https://stats.example/api/public/blog-stats?path=${encodeURIComponent(path)}`),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).page).toEqual({ pv: 2, uv: 1 });
    expect(rawQuery.mock.calls[1][1]).toEqual({
      websiteId: '7ae63952-76fc-4a90-a5b7-aedd93fb56c9',
      path,
    });
  });
  it.each([
    '?path=/resume/',
    '?path=//other.example/',
    '?websiteId=other',
    '?path=%25broken',
    '?path=/&path=/',
  ])('rejects unsupported selectors: %s', async query => {
    const response = await GET(new Request(`https://stats.example/api/public/blog-stats${query}`));
    expect(response.status).toBe(400);
    expect(rawQuery).not.toHaveBeenCalled();
  });
  it('hides database errors and never caches failures', async () => {
    state.fail = true;
    const response = await GET(new Request('https://stats.example/api/public/blog-stats'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('private');
  });
});
