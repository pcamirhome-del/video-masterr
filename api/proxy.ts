export const config = {
  runtime: 'edge',
};

const ANDROID_VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
      },
    });
  }

  const reqUrl = new URL(req.url);
  const targetUrl = reqUrl.searchParams.get('url') || '';
  const forceDownload = reqUrl.searchParams.get('download') === '1';
  const rawFilename = (reqUrl.searchParams.get('filename') || 'video.mp4')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 140) || 'video.mp4';

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return Response.json({ error: 'Invalid protocol' }, { status: 400 });
    }
    if (isBlockedHost(parsed.hostname)) {
      return Response.json({ error: 'Blocked host' }, { status: 403 });
    }
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const headers: Record<string, string> = {
    'User-Agent': parsed.hostname.includes('googlevideo.com')
      ? ANDROID_VR_UA
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Encoding': 'identity',
  };

  const range = req.headers.get('range');
  if (range) headers.Range = range;

  if (parsed.hostname.includes('tiktok')) {
    headers.Referer = 'https://www.tiktok.com/';
  } else if (parsed.hostname.includes('savetube')) {
    headers.Referer = 'https://yt.savetube.me/';
  } else if (parsed.hostname.includes('rapidcdn')) {
    headers.Referer = 'https://viddown.io/';
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers,
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return Response.json({ error: `Upstream error (${upstream.status})` }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    const lowerCt = contentType.toLowerCase();
    if (
      lowerCt.includes('text/html') ||
      lowerCt.includes('application/json') ||
      lowerCt.includes('text/plain')
    ) {
      return Response.json({ error: 'الرابط يعيد صفحة ويب وليس فيديو' }, { status: 422 });
    }

    const contentLength = upstream.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) === 0) {
      return Response.json({ error: 'الملف القادم من المصدر فارغ (0 بايت)' }, { status: 502 });
    }

    const resHeaders = new Headers();
    resHeaders.set('Content-Type', contentType);
    resHeaders.set('Cache-Control', 'no-store');
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges, Content-Type'
    );
    resHeaders.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    if (contentLength && !upstream.headers.get('content-encoding')) {
      resHeaders.set('Content-Length', contentLength);
    }
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) {
      resHeaders.set('Content-Range', contentRange);
    }
    if (forceDownload) {
      const asciiFallback = rawFilename.replace(/[^\x20-\x7E]/g, '_') || 'video.mp4';
      resHeaders.set(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(rawFilename)}`
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || 'Proxy stream failed' }, { status: 502 });
  }
}
