import { unstable_cache } from 'next/cache';
import prisma from '@/lib/prisma';

// Only this blog's aggregate counters are public. No caller-selected website,
// date range, visitor details, or administrator credentials are accepted.
const websiteId = '7ae63952-76fc-4a90-a5b7-aedd93fb56c9';
const headers = { 'Access-Control-Allow-Origin': '*' };

const counters = unstable_cache(
  async (path: string) => {
    const rows = await prisma.rawQuery(
      `select count(*) as pv, count(distinct session_id) as uv
     from website_event
     where website_id = {{websiteId::uuid}} and event_type = 1
       and ({{path}} = '' or url_path = {{path}})`,
      { websiteId, path },
      'publicBlogCounters',
    );
    const value = { pv: Number(rows[0].pv), uv: Number(rows[0].uv) };
    if (
      !Number.isSafeInteger(value.pv) ||
      !Number.isSafeInteger(value.uv) ||
      value.uv < 0 ||
      value.pv < value.uv
    )
      throw new Error('Invalid counter values');
    return value;
  },
  ['public-blog-counters-v1', websiteId],
  { revalidate: 60 },
);

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  let path = query.get('path') || '';
  try {
    path = decodeURI(path);
  } catch {
    return Response.json({ error: 'Invalid path' }, { status: 400, headers });
  }
  // Article counters only; neither protected pages nor arbitrary filter queries.
  if (
    [...query.keys()].some(key => key !== 'path') ||
    query.getAll('path').length > 1 ||
    path.length > 500 ||
    (path && !/^\/(?:en\/)?\d{4}\/\d{2}\/\d{2}\/[^/?#\\\p{Cc}]+\/$/u.test(path))
  ) {
    return Response.json({ error: 'Invalid path' }, { status: 400, headers });
  }
  try {
    const [site, page] = await Promise.all([counters(''), path ? counters(path) : null]);
    return Response.json(
      { source: 'umami-self-hosted', site, page },
      {
        headers: { ...headers, 'Cache-Control': 'public, max-age=0, s-maxage=60' },
      },
    );
  } catch {
    return Response.json(
      { error: 'Statistics unavailable' },
      {
        status: 503,
        headers: { ...headers, 'Cache-Control': 'no-store' },
      },
    );
  }
}
