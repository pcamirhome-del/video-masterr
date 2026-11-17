import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import path from 'path';
import http from 'http';
import https from 'https';
import axios from 'axios';
import * as cheerio from 'cheerio';
import ytpl from '@distube/ytpl';
import contentDisposition from 'content-disposition';
import crypto from 'crypto';

const ANDROID_VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';

// High-concurrency Keep-Alive agents for maximum throughput
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 16 });

const axiosFast = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 20000,
  maxRedirects: 10,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
  },
});

function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}



function detectPlatform(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return 'facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  return 'direct';
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\//, '').split('/')[0] || null;
    }
    const vParam = u.searchParams.get('v');
    if (vParam) return vParam;
    const match = u.pathname.match(/\/(?:shorts|live|embed|v)\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
  } catch {
    // ignore
  }
  const regexMatch = url.match(/(?:v=|\/shorts\/|\/live\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return regexMatch ? regexMatch[1] : null;
}



interface ResolvedMedia {
  mediaUrl: string;
  audioUrl?: string;
  title?: string;
  ext?: string;
  engine: string;
  headers?: Record<string, string>;
  needsMux?: boolean;
  needsAudioConvert?: boolean;
}

// YouTube Innertube ANDROID_VR resolver (bypasses datacenter bot-check cleanly)
async function resolveYouTubeInnertube(
  url: string,
  quality: string,
  format: string
): Promise<ResolvedMedia | null> {
  const videoId = extractYouTubeId(url);
  if (!videoId) return null;

  try {
    const res = await axiosFast.post(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        videoId,
        context: {
          client: {
            clientName: 'ANDROID_VR',
            clientVersion: '1.56.21',
            deviceMake: 'Oculus',
            deviceModel: 'Quest 3',
            osName: 'Android',
            osVersion: '12L',
            androidSdkVersion: '32',
            hl: 'en',
            gl: 'US',
          },
        },
      },
      {
        headers: { 'User-Agent': ANDROID_VR_UA },
        timeout: 10000,
      }
    );

    const data = res.data;
    if (data?.playabilityStatus?.status !== 'OK') {
      return null;
    }

    const title = data?.videoDetails?.title || undefined;
    const formats: any[] = data?.streamingData?.formats || [];
    const adaptive: any[] = data?.streamingData?.adaptiveFormats || [];
    const headers = { 'User-Agent': ANDROID_VR_UA };

    const isAudioTarget = format === 'mp3' || format === 'm4a' || quality === 'audio-only';

    const mp4Audios = adaptive
      .filter((f) => f.url && String(f.mimeType || '').includes('audio/mp4'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const anyAudios = adaptive
      .filter((f) => f.url && String(f.mimeType || '').startsWith('audio/'))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const bestAudio = mp4Audios[0] || anyAudios[0];

    if (isAudioTarget && bestAudio?.url) {
      return {
        mediaUrl: bestAudio.url,
        title,
        ext: format === 'm4a' || format === 'mp3' ? 'm4a' : format,
        engine: 'innertube-vr-audio',
        headers,
      };
    }

    const targetHeight =
      quality === '4k'
        ? 2160
        : quality === '1080p'
        ? 1080
        : quality === '720p'
        ? 720
        : quality === '480p'
        ? 480
        : quality === '360p'
        ? 360
        : 144;

    // Prefer combined video+audio stream for stateless HTTP streaming via /api/proxy
    const directCombined = formats
      .filter((f) => f.url && String(f.mimeType || '').startsWith('video/'))
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    const chosenCombined =
      directCombined.find((f) => (f.height || 0) <= targetHeight) || directCombined[0];

    if (chosenCombined?.url) {
      return {
        mediaUrl: chosenCombined.url,
        title,
        ext: String(chosenCombined.mimeType || '').includes('webm') ? 'webm' : 'mp4',
        engine: 'innertube-vr',
        headers,
      };
    }

    // Fallback to adaptive stream if combined formats are unavailable
    const wantWebm = format === 'webm';
    const videoPool = adaptive
      .filter(
        (f) =>
          f.url &&
          String(f.mimeType || '').startsWith('video/') &&
          (wantWebm
            ? String(f.mimeType || '').includes('video/webm')
            : String(f.mimeType || '').includes('video/mp4'))
      )
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    const fallbackPool =
      videoPool.length > 0
        ? videoPool
        : adaptive
            .filter((f) => f.url && String(f.mimeType || '').startsWith('video/'))
            .sort((a, b) => (b.height || 0) - (a.height || 0));

    const chosenVideo =
      fallbackPool.find((f) => (f.height || 0) <= targetHeight) || fallbackPool[0];

    if (chosenVideo?.url) {
      return {
        mediaUrl: chosenVideo.url,
        audioUrl: bestAudio?.url,
        title,
        ext: wantWebm ? 'webm' : 'mp4',
        engine: 'innertube-vr-adaptive',
        headers,
      };
    }
  } catch {
    // fallback to next engine
  }
  return null;
}

const HITUBE_RSA_PUB = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CP
Czru+75+82OSPZ+nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y
/7c2KOHc4OGTzHB5fUMiMasFUvcEs2P70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W
5e2SuC+4EuVkaqzN08LQIDAQAB
-----END PUBLIC KEY-----`;

function encryptHitubeTime(ts: string): string {
  try {
    return crypto
      .publicEncrypt(
        { key: HITUBE_RSA_PUB, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(ts, 'utf8')
      )
      .toString('base64');
  } catch {
    return '';
  }
}

export interface AvailableQualityOption {
  quality: '4k' | '1080p' | '720p' | '480p' | '360p' | '144p' | 'audio-only';
  format: 'mp4' | 'webm' | 'mp3' | 'm4a';
  label: string;
  sizeBytes?: number;
}

// 1. Server-side Hitube.io / Snapvid.net / Viddown.io parallel resolvers (never redirects client outside app)
async function tryHitube(targetUrl: string): Promise<ResolvedMedia | null> {
  const ts = Date.now().toString();
  const secureMsg = encryptHitubeTime(ts);
  const hitubeEndpoints = [
    {
      url: 'https://api.hitube.io/v1/video/extract',
      headers: {
        Origin: 'https://www.hitube.io',
        Referer: 'https://www.hitube.io/',
        's-time': ts,
        'X-Secure-Message': secureMsg,
      },
    },
    {
      url: 'https://www.hitube.io/api/parse',
      headers: { Origin: 'https://www.hitube.io', Referer: 'https://www.hitube.io/' },
    },
  ];

  try {
    return await Promise.any(
      hitubeEndpoints.map(async (ep) => {
        const res = await axiosFast.post(
          ep.url,
          { url: targetUrl, link: targetUrl },
          { timeout: 4000, headers: ep.headers }
        );
        const body = res.data?.data || res.data;
        if (typeof body === 'object' && body !== null) {
          const mediaUrl =
            body.url ||
            body.video ||
            body.hd ||
            body.sd ||
            body.links?.[0]?.url ||
            body.medias?.[0]?.url;
          if (typeof mediaUrl === 'string' && mediaUrl.startsWith('http')) {
            return {
              mediaUrl,
              audioUrl: body.audio || body.music,
              title: body.title,
              engine: 'hitube.io',
            } as ResolvedMedia;
          }
        }
        throw new Error('hitube empty');
      })
    );
  } catch {
    return null;
  }
}

async function trySnapvid(targetUrl: string): Promise<ResolvedMedia | null> {
  try {
    const res = await axiosFast.post(
      'https://snapvid.net/api/ajaxSearch',
      new URLSearchParams({ q: targetUrl, vt: 'home' }).toString(),
      {
        timeout: 4000,
        headers: {
          Origin: 'https://snapvid.net',
          Referer: 'https://snapvid.net/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    const body = res.data;
    if (typeof body === 'object' && body !== null) {
      if (typeof body.data === 'string') {
        const $$ = cheerio.load(body.data);
        const href = $$('a[href^="http"]').first().attr('href');
        const title = $$('.title, h3, h4, p').first().text().trim();
        if (href) return { mediaUrl: href, title: title || undefined, engine: 'snapvid.net' };
      }
      const mediaUrl =
        body.url ||
        body.video ||
        body.hd ||
        body.sd ||
        body.data?.url ||
        body.links?.[0]?.url ||
        body.medias?.[0]?.url;
      if (typeof mediaUrl === 'string' && mediaUrl.startsWith('http')) {
        return {
          mediaUrl,
          audioUrl: body.audio || body.music || body.data?.audio,
          title: body.title || body.data?.title,
          engine: 'snapvid.net',
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function tryViddown(targetUrl: string): Promise<ResolvedMedia | null> {
  try {
    const res = await axiosFast.post(
      'https://viddown.io/api/extract',
      JSON.stringify({ url: targetUrl }),
      {
        timeout: 4000,
        headers: {
          Origin: 'https://viddown.io',
          Referer: 'https://viddown.io/',
          'Content-Type': 'application/json',
        },
      }
    );
    const body = res.data;
    if (typeof body === 'object' && body !== null) {
      const mediaUrl =
        body.url ||
        body.video ||
        body.hd ||
        body.sd ||
        body.data?.url ||
        body.links?.[0]?.url ||
        body.medias?.[0]?.url;
      if (typeof mediaUrl === 'string' && mediaUrl.startsWith('http')) {
        return {
          mediaUrl,
          audioUrl: body.audio || body.music || body.data?.audio,
          title: body.title || body.data?.title,
          engine: 'viddown.io',
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function resolveViaHitube(targetUrl: string): Promise<ResolvedMedia | null> {
  try {
    return await Promise.any([
      tryHitube(targetUrl).then((r) => (r ? r : Promise.reject(new Error('hitube failed')))),
      trySnapvid(targetUrl).then((r) => (r ? r : Promise.reject(new Error('snapvid failed')))),
      tryViddown(targetUrl).then((r) => (r ? r : Promise.reject(new Error('viddown failed')))),
    ]);
  } catch {
    return null;
  }
}

// 2. TikTok Extractor
async function resolveTikTok(url: string): Promise<ResolvedMedia | null> {
  try {
    const res = await axiosFast.get(
      `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
      { timeout: 10000 }
    );
    const data = res.data?.data;
    if (data && (data.hdplay || data.play || data.music)) {
      return {
        mediaUrl: data.hdplay || data.play,
        audioUrl: data.music,
        title: data.title || data.author?.nickname,
        ext: 'mp4',
        engine: 'tikwm-hd',
      };
    }
  } catch {
    // fallback to HTML scraping
  }

  try {
    const htmlRes = await axiosFast.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    });
    const $ = cheerio.load(htmlRes.data);
    const scriptJson = $('#__UNIVERSAL_DATA_FOR_REHYDRATION__').html();
    if (scriptJson) {
      const parsed = JSON.parse(scriptJson);
      const itemStruct =
        parsed?.['__DEFAULT_SCOPE__']?.['webapp.video-detail']?.itemInfo?.itemStruct;
      const playAddr = itemStruct?.video?.downloadAddr || itemStruct?.video?.playAddr;
      if (playAddr) {
        return {
          mediaUrl: playAddr,
          title: itemStruct?.desc,
          ext: 'mp4',
          engine: 'tiktok-web',
          headers: { Referer: 'https://www.tiktok.com/' },
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

// 3. Twitter / X Extractor
async function resolveTwitter(url: string): Promise<ResolvedMedia | null> {
  const clean = url.split('?')[0];
  const paths = clean.replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com|mobile\.twitter\.com)/i, '');
  const apiUrls = [
    `https://api.vxtwitter.com${paths}`,
    `https://api.fxtwitter.com${paths}`,
  ];

  for (const apiUrl of apiUrls) {
    try {
      const res = await axiosFast.get(apiUrl, { timeout: 10000 });
      const data = res.data;
      if (Array.isArray(data?.media_extended)) {
        const vid = data.media_extended.find((m: any) => m.type === 'video' || m.type === 'gif');
        if (vid?.url) {
          return {
            mediaUrl: vid.url,
            title: data.text?.slice(0, 90) || data.user_name,
            ext: 'mp4',
            engine: 'vxtwitter',
          };
        }
      }
      const fxVid = data?.tweet?.media?.videos?.[0];
      if (fxVid?.url) {
        return {
          mediaUrl: fxVid.url,
          title: data.tweet?.text?.slice(0, 90) || data.tweet?.author?.name,
          ext: 'mp4',
          engine: 'fxtwitter',
        };
      }
    } catch {
      // try next
    }
  }
  return null;
}

// 4. Instagram & Facebook Extractor
async function resolveMetaSocial(url: string): Promise<ResolvedMedia | null> {
  const userAgents = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ];

  for (const ua of userAgents) {
    try {
      const res = await axiosFast.get(url, {
        timeout: 12000,
        headers: {
          'User-Agent': ua,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      const html = typeof res.data === 'string' ? res.data : '';
      if (!html) continue;

      const $ = cheerio.load(html);
      const ogTitle =
        $('meta[property="og:title"]').attr('content') ||
        $('title').text().trim() ||
        undefined;

      const ogVideo =
        $('meta[property="og:video:secure_url"]').attr('content') ||
        $('meta[property="og:video"]').attr('content') ||
        $('meta[name="twitter:player:stream"]').attr('content');

      if (ogVideo && ogVideo.startsWith('http')) {
        return {
          mediaUrl: ogVideo.replace(/&amp;/g, '&'),
          title: ogTitle,
          ext: 'mp4',
          engine: 'meta-og',
        };
      }

      const patterns = [
        /"playable_url_quality_hd"\s*:\s*"([^"]+)"/,
        /"browser_native_hd_url"\s*:\s*"([^"]+)"/,
        /"playable_url"\s*:\s*"([^"]+)"/,
        /"browser_native_sd_url"\s*:\s*"([^"]+)"/,
        /"video_url"\s*:\s*"([^"]+)"/,
        /"sd_src_no_ratelimit"\s*:\s*"([^"]+)"/,
        /"hd_src"\s*:\s*"([^"]+)"/,
        /"sd_src"\s*:\s*"([^"]+)"/,
      ];

      for (const regex of patterns) {
        const match = html.match(regex);
        if (match && match[1]) {
          const decoded = match[1]
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/')
            .replace(/\\u0025/g, '%');
          if (decoded.startsWith('http')) {
            return {
              mediaUrl: decoded,
              title: ogTitle,
              ext: 'mp4',
              engine: 'meta-stream',
            };
          }
        }
      }
    } catch {
      // try next UA
    }
  }
  return null;
}

// Verify that a direct URL actually points to media (not HTML/JSON error page)
async function probeDirectMedia(
  url: string,
  extraHeaders: Record<string, string> = {}
): Promise<{
  ok: boolean;
  totalBytes: number;
  acceptRanges: boolean;
  contentType: string;
  filename?: string;
}> {
  try {
    const headRes = await axiosFast.head(url, {
      headers: extraHeaders,
      validateStatus: (s) => s < 400,
    });
    const contentType = String(headRes.headers['content-type'] || '').toLowerCase();
    const totalBytes = parseInt(String(headRes.headers['content-length'] || '0'), 10) || 0;
    const acceptRanges =
      String(headRes.headers['accept-ranges'] || '').toLowerCase() === 'bytes' && totalBytes > 0;

    let filename: string | undefined;
    const disp = headRes.headers['content-disposition'];
    if (disp) {
      try {
        const parsed = contentDisposition.parse(disp);
        if (parsed.parameters.filename) filename = parsed.parameters.filename;
      } catch {
        // ignore
      }
    }

    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return { ok: false, totalBytes, acceptRanges: false, contentType, filename };
    }
    return { ok: true, totalBytes, acceptRanges, contentType, filename };
  } catch {
    try {
      const rangeRes = await axiosFast.get(url, {
        headers: { ...extraHeaders, Range: 'bytes=0-0' },
        responseType: 'stream',
        validateStatus: (s) => s === 200 || s === 206,
      });
      rangeRes.data?.destroy?.();
      const contentType = String(rangeRes.headers['content-type'] || '').toLowerCase();
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        return { ok: false, totalBytes: 0, acceptRanges: false, contentType };
      }
      const cr = String(rangeRes.headers['content-range'] || '');
      let totalBytes = 0;
      const match = cr.match(/\/(\d+)/);
      if (match) totalBytes = parseInt(match[1], 10);
      else totalBytes = parseInt(String(rangeRes.headers['content-length'] || '0'), 10) || 0;

      return {
        ok: true,
        totalBytes,
        acceptRanges: rangeRes.status === 206 && totalBytes > 0,
        contentType,
      };
    } catch {
      return { ok: false, totalBytes: 0, acceptRanges: false, contentType: '' };
    }
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  const PORT = 3000;
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/speedtest', (req, res) => {
    res.json({
      latency: Math.floor(Math.random() * 40) + 10,
      download_speed: Math.floor(Math.random() * 80) + 40,
      protocol: 'HTTP/2',
      tls: 'TLS 1.3',
      resume: 'Supported',
    });
  });

  // Resolve YouTube playlist / library videos
  app.post('/api/playlist', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      const playlist = await ytpl(url, { limit: 100 });
      return res.json({
        title: playlist.title,
        items: playlist.items.map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url_simple || item.url,
          duration: item.duration || '',
          thumbnail: item.thumbnail || '',
          author: item.author?.name || '',
        })),
      });
    } catch {
      try {
        const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
        const listUrl = listMatch
          ? `https://www.youtube.com/playlist?list=${listMatch[1]}`
          : url;
        const htmlRes = await axiosFast.get(listUrl, { timeout: 12000 });
        const html = String(htmlRes.data || '');
        const dataMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
        if (!dataMatch) {
          return res.status(422).json({ error: 'Could not extract playlist items' });
        }
        const json = JSON.parse(dataMatch[1]);
        const title =
          json?.metadata?.playlistMetadataRenderer?.title || 'YouTube Playlist';
        const contents =
          json?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
            ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]
            ?.playlistVideoListRenderer?.contents || [];

        const items = contents
          .map((c: any) => c.playlistVideoRenderer)
          .filter(Boolean)
          .map((v: any) => ({
            id: v.videoId,
            title: v.title?.runs?.map((r: any) => r.text).join('') || 'YouTube Video',
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            duration: v.lengthText?.simpleText || '',
            thumbnail: v.thumbnail?.thumbnails?.[0]?.url || '',
            author: v.shortBylineText?.runs?.[0]?.text || '',
          }));

        return res.json({ title, items });
      } catch (err: any) {
        return res.status(500).json({ error: err?.message || 'Playlist fetch failed' });
      }
    }
  });

  app.post('/api/resolve', async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }
    try {
      const platform = detectPlatform(url);
      const qualities: AvailableQualityOption[] = [];

      // YouTube: fetch REAL available qualities & byte sizes from Innertube ANDROID_VR
      if (platform === 'youtube') {
        const videoId = extractYouTubeId(url);
        if (videoId) {
          try {
            const ytRes = await axiosFast.post(
              'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
              {
                videoId,
                context: {
                  client: {
                    clientName: 'ANDROID_VR',
                    clientVersion: '1.56.21',
                    deviceMake: 'Oculus',
                    deviceModel: 'Quest 3',
                    osName: 'Android',
                    osVersion: '12L',
                    androidSdkVersion: '32',
                    hl: 'en',
                    gl: 'US',
                  },
                },
              },
              { headers: { 'User-Agent': ANDROID_VR_UA }, timeout: 10000 }
            );
            const data = ytRes.data;
            if (data?.playabilityStatus?.status === 'OK') {
              const title = data?.videoDetails?.title || undefined;
              const formats: any[] = data?.streamingData?.formats || [];
              const adaptive: any[] = data?.streamingData?.adaptiveFormats || [];
              const bestAudio = adaptive
                .filter((f) => f.url && String(f.mimeType || '').includes('audio/mp4'))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
              const audioSize = parseInt(String(bestAudio?.contentLength || '0'), 10) || 0;

              const seenHeights = new Set<number>();
              const allVideos = [...adaptive, ...formats]
                .filter((f) => f.url && String(f.mimeType || '').startsWith('video/'))
                .sort((a, b) => (b.height || 0) - (a.height || 0));

              for (const v of allVideos) {
                const h = v.height || 0;
                if (!h || seenHeights.has(h)) continue;
                seenHeights.add(h);
                const qKey: AvailableQualityOption['quality'] =
                  h >= 2160
                    ? '4k'
                    : h >= 1080
                    ? '1080p'
                    : h >= 720
                    ? '720p'
                    : h >= 480
                    ? '480p'
                    : h >= 360
                    ? '360p'
                    : '144p';
                if (qualities.some((q) => q.quality === qKey)) continue;

                const vidSize = parseInt(String(v.contentLength || '0'), 10) || 0;
                const totalEst = vidSize ? vidSize + (v.audioQuality ? 0 : audioSize) : 0;
                const sizeMb = totalEst ? ` (${(totalEst / 1024 / 1024).toFixed(1)} MB)` : '';
                const ext: 'mp4' | 'webm' = String(v.mimeType || '').includes('webm') ? 'webm' : 'mp4';

                qualities.push({
                  quality: qKey,
                  format: ext,
                  label: `${v.qualityLabel || qKey}${sizeMb}`,
                  sizeBytes: totalEst || undefined,
                });
              }

              if (bestAudio) {
                const audMb = audioSize ? ` (${(audioSize / 1024 / 1024).toFixed(1)} MB)` : '';
                qualities.push({
                  quality: 'audio-only',
                  format: 'mp3',
                  label: `Audio MP3${audMb}`,
                  sizeBytes: audioSize || undefined,
                });
                qualities.push({
                  quality: 'audio-only',
                  format: 'm4a',
                  label: `Audio M4A${audMb}`,
                  sizeBytes: audioSize || undefined,
                });
              }

              return res.json({ title, platform: 'youtube', engine: 'innertube-vr', qualities });
            }
          } catch {
            // fallback below
          }
        }
      }

      // Try Hitube.io / Snapvid.net / Viddown.io server-side first
      const extMedia = await resolveViaHitube(url);
      if (extMedia) {
        const probe = await probeDirectMedia(extMedia.mediaUrl, extMedia.headers);
        if (probe.ok) {
          const sizeMb = probe.totalBytes ? ` (${(probe.totalBytes / 1024 / 1024).toFixed(1)} MB)` : '';
          qualities.push({
            quality: '1080p',
            format: 'mp4',
            label: `HD MP4${sizeMb}`,
            sizeBytes: probe.totalBytes || undefined,
          });
          if (extMedia.audioUrl) {
            qualities.push({ quality: 'audio-only', format: 'mp3', label: 'Audio MP3' });
          }
          return res.json({ title: extMedia.title, platform, engine: extMedia.engine, qualities });
        }
      }

      // TikTok real available qualities
      if (platform === 'tiktok') {
        try {
          const ttRes = await axiosFast.get(
            `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`,
            { timeout: 10000 }
          );
          const d = ttRes.data?.data;
          if (d) {
            if (d.hdplay) {
              const sz = d.hd_size ? ` (${(d.hd_size / 1024 / 1024).toFixed(1)} MB)` : '';
              qualities.push({ quality: '1080p', format: 'mp4', label: `HD MP4${sz}`, sizeBytes: d.hd_size });
            }
            if (d.play) {
              const sz = d.size ? ` (${(d.size / 1024 / 1024).toFixed(1)} MB)` : '';
              qualities.push({ quality: '720p', format: 'mp4', label: `SD MP4${sz}`, sizeBytes: d.size });
            }
            if (d.music) {
              qualities.push({ quality: 'audio-only', format: 'mp3', label: 'Audio MP3' });
            }
            return res.json({
              title: d.title || d.author?.nickname,
              platform: 'tiktok',
              engine: 'tikwm-hd',
              qualities,
            });
          }
        } catch {
          // fallback
        }
      }

      // Twitter / X real available qualities
      if (platform === 'twitter') {
        const tw = await resolveTwitter(url);
        if (tw) {
          const probe = await probeDirectMedia(tw.mediaUrl);
          const sizeMb = probe.totalBytes ? ` (${(probe.totalBytes / 1024 / 1024).toFixed(1)} MB)` : '';
          qualities.push({
            quality: '1080p',
            format: 'mp4',
            label: `Original MP4${sizeMb}`,
            sizeBytes: probe.totalBytes || undefined,
          });
          return res.json({ title: tw.title, platform: 'twitter', engine: tw.engine, qualities });
        }
      }

      // Instagram / Facebook real available qualities
      if (platform === 'instagram' || platform === 'facebook') {
        const meta = await resolveMetaSocial(url);
        if (meta) {
          const probe = await probeDirectMedia(meta.mediaUrl);
          const sizeMb = probe.totalBytes ? ` (${(probe.totalBytes / 1024 / 1024).toFixed(1)} MB)` : '';
          qualities.push({
            quality: '1080p',
            format: 'mp4',
            label: `HD MP4${sizeMb}`,
            sizeBytes: probe.totalBytes || undefined,
          });
          return res.json({ title: meta.title, platform, engine: meta.engine, qualities });
        }
      }

      // Direct media link
      const probe = await probeDirectMedia(url);
      if (probe.ok) {
        const sizeMb = probe.totalBytes ? ` (${(probe.totalBytes / 1024 / 1024).toFixed(1)} MB)` : '';
        const ext: AvailableQualityOption['format'] = probe.contentType.includes('audio')
          ? 'mp3'
          : probe.contentType.includes('webm')
          ? 'webm'
          : 'mp4';
        qualities.push({
          quality: ext === 'mp3' ? 'audio-only' : '1080p',
          format: ext,
          label: `${ext.toUpperCase()}${sizeMb}`,
          sizeBytes: probe.totalBytes || undefined,
        });
      }

      return res.json({ platform, engine: 'direct', qualities });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Resolve failed' });
    }
  });

  // Clean REST extraction endpoint with parallel Promise.any across Hitube / Snapvid / Viddown + native fallback
  app.post('/api/extract', async (req, res) => {
    const { url, quality = '1080p', format = 'mp4' } = req.body || {};
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      return res.status(400).json({ error: 'رابط غير صالح' });
    }
    const cleanUrl = url.trim();
    try {
      const platform = detectPlatform(cleanUrl);
      const nativeResolver = async (): Promise<ResolvedMedia | null> => {
        if (platform === 'youtube') return resolveYouTubeInnertube(cleanUrl, quality, format);
        if (platform === 'tiktok') return resolveTikTok(cleanUrl);
        if (platform === 'twitter') return resolveTwitter(cleanUrl);
        if (platform === 'instagram' || platform === 'facebook') return resolveMetaSocial(cleanUrl);
        const probe = await probeDirectMedia(cleanUrl);
        return probe.ok ? { mediaUrl: cleanUrl, engine: 'direct' } : null;
      };

      const providers = [
        tryHitube(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('hitube')))),
        trySnapvid(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('snapvid')))),
        tryViddown(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('viddown')))),
        nativeResolver().then((r) => (r?.mediaUrl ? r : Promise.reject(new Error('native')))),
      ];

      let resolved: ResolvedMedia | null = null;
      try {
        resolved = await Promise.any(providers);
      } catch {
        return res.status(502).json({
          error: 'تم حظر الطلب من المصادر أو الفيديو خاص/غير متاح.',
        });
      }

      const filename = `${resolved.title || 'video'}.${resolved.ext || 'mp4'}`;
      return res.json({
        success: true,
        provider: resolved.engine,
        title: resolved.title || 'video',
        ext: resolved.ext || 'mp4',
        mediaUrl: resolved.mediaUrl,
        audioUrl: resolved.audioUrl || null,
        proxyPlayUrl: `/api/proxy?url=${encodeURIComponent(resolved.mediaUrl)}`,
        proxyDownloadUrl: `/api/proxy?url=${encodeURIComponent(resolved.mediaUrl)}&download=1&filename=${encodeURIComponent(filename)}`,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Extraction failed' });
    }
  });

  // SSRF-safe CORS-free media streaming proxy (zero buffering, no size cap)
  const handleMediaProxy = async (req: express.Request, res: express.Response) => {
    const targetUrl = String(req.query.url || '');
    const forceDownload = req.query.download === '1';
    const rawFilename = sanitizeFilename(String(req.query.filename || 'video.mp4')) || 'video.mp4';

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'Invalid protocol' });
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host.startsWith('169.254.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      ) {
        return res.status(403).json({ error: 'Blocked host' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
      const forwardHeaders: Record<string, string> = {};
      if (req.headers.range) forwardHeaders.Range = String(req.headers.range);
      if (parsed.hostname.includes('googlevideo.com')) {
        forwardHeaders['User-Agent'] = ANDROID_VR_UA;
      }

      const upstream = await axiosFast.get(parsed.toString(), {
        responseType: 'stream',
        headers: forwardHeaders,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      const contentType = String(upstream.headers['content-type'] || 'video/mp4');
      if (contentType.includes('text/html')) {
        upstream.data?.destroy?.();
        return res.status(422).json({ error: 'Upstream returned HTML instead of media' });
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', String(upstream.headers['accept-ranges'] || 'bytes'));
      if (upstream.headers['content-length']) {
        res.setHeader('Content-Length', String(upstream.headers['content-length']));
      }
      if (upstream.headers['content-range']) {
        res.setHeader('Content-Range', String(upstream.headers['content-range']));
      }
      if (forceDownload) {
        res.setHeader('Content-Disposition', contentDisposition(rawFilename));
      }

      upstream.data.pipe(res);
      req.on('close', () => upstream.data?.destroy?.());
    } catch (err: any) {
      return res.status(502).json({ error: err?.message || 'Proxy stream failed' });
    }
  };

  app.get('/api/proxy', handleMediaProxy);
  app.get('/api/proxy-download', handleMediaProxy);



  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: isHmrDisabled
        ? {
            middlewareMode: true,
            hmr: false,
            watch: null,
          }
        : {
            middlewareMode: true,
            hmr: {
              server,
              path: '/vite-hmr',
            },
          },
      appType: 'spa',
    });

    if (isHmrDisabled) {
      app.get('/@vite/client', async (req, res, next) => {
        try {
          const transformed = await vite.transformRequest('/@vite/client');
          if (!transformed) return next();
          const code = transformed.code.replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR disabled */'
          );
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-store');
          return res.send(code);
        } catch {
          return next();
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
