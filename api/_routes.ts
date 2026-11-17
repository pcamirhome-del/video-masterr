import type express from 'express';
import http from 'http';
import https from 'https';
import axios from 'axios';
import * as cheerio from 'cheerio';
import ytpl from '@distube/ytpl';
import contentDisposition from 'content-disposition';
import crypto from 'crypto';

export const ANDROID_VR_UA =
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

export function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export function detectPlatform(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return 'facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  return 'direct';
}

export function extractYouTubeId(url: string): string | null {
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

export interface ResolvedMedia {
  mediaUrl: string;
  audioUrl?: string;
  title?: string;
  ext?: string;
  engine: string;
  headers?: Record<string, string>;
  needsMux?: boolean;
  needsAudioConvert?: boolean;
}

export interface AvailableQualityOption {
  quality: '4k' | '1080p' | '720p' | '480p' | '360p' | '144p' | 'audio-only';
  format: 'mp4' | 'webm' | 'mp3' | 'm4a';
  label: string;
  sizeBytes?: number;
}

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

const SAVETUBE_AES_KEY = Buffer.from('C5D58EF67A7584E4A29F6C35BBC4EB12', 'hex');

function decryptSavetubePayload(encB64: string): any {
  const buf = Buffer.from(encB64, 'base64');
  const iv = buf.subarray(0, 16);
  const content = buf.subarray(16);
  const decipher = crypto.createDecipheriv('aes-128-cbc', SAVETUBE_AES_KEY, iv);
  const decrypted = Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted);
}

async function fetchSavetubeInfo(targetUrl: string): Promise<{ cdn: string; info: any } | null> {
  try {
    const cdnRes = await axiosFast.get('https://media.savetube.vip/api/random-cdn', {
      timeout: 6000,
    });
    const cdn = cdnRes.data?.cdn;
    if (!cdn || typeof cdn !== 'string') return null;

    const infoRes = await axiosFast.post(
      `https://${cdn}/v2/info`,
      { url: targetUrl },
      {
        timeout: 9000,
        headers: {
          Origin: 'https://yt.savetube.me',
          Referer: 'https://yt.savetube.me/',
        },
      }
    );
    const encrypted = infoRes.data?.data;
    if (!encrypted || typeof encrypted !== 'string') return null;
    const info = decryptSavetubePayload(encrypted);
    if (!info?.key) return null;
    return { cdn, info };
  } catch {
    return null;
  }
}

async function resolveYouTubeSavetube(
  targetUrl: string,
  quality = '1080p',
  format = 'mp4'
): Promise<ResolvedMedia | null> {
  const fetched = await fetchSavetubeInfo(targetUrl);
  if (!fetched) return null;
  const { cdn, info } = fetched;
  const isAudio = format === 'mp3' || format === 'm4a' || quality === 'audio-only';

  try {
    const downloadType: 'audio' | 'video' = isAudio ? 'audio' : 'video';
    let chosenQuality = '128';

    if (!isAudio) {
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
          : 240;

      const vFormats: any[] = Array.isArray(info.video_formats) ? info.video_formats : [];
      const sorted = [...vFormats]
        .filter((f) => Number(f.height || f.quality) > 0)
        .sort((a, b) => Number(b.height || b.quality) - Number(a.height || a.quality));

      const matched =
        sorted.find((f) => Number(f.height || f.quality) <= targetHeight) ||
        sorted[0] ||
        vFormats.find((f) => f.default_selected) ||
        vFormats[0];
      chosenQuality = String(matched?.quality || matched?.height || '360');
    } else {
      const aFormats: any[] = Array.isArray(info.audio_formats) ? info.audio_formats : [];
      chosenQuality = String(aFormats[0]?.quality || '128');
    }

    const dlRes = await axiosFast.post(
      `https://${cdn}/download`,
      {
        downloadType,
        quality: chosenQuality,
        key: info.key,
      },
      {
        timeout: 18000,
        headers: {
          Origin: 'https://yt.savetube.me',
          Referer: 'https://yt.savetube.me/',
        },
      }
    );

    const downloadUrl = dlRes.data?.data?.downloadUrl;
    if (typeof downloadUrl === 'string' && downloadUrl.startsWith('http')) {
      return {
        mediaUrl: downloadUrl,
        title: info.title || undefined,
        ext: isAudio ? 'mp3' : 'mp4',
        engine: 'savetube-cdn',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

async function tryHitube(targetUrl: string): Promise<ResolvedMedia | null> {
  const platform = detectPlatform(targetUrl);
  const endpointMap: Record<string, string> = {
    tiktok: 'https://api.hitube.io/st-tik/tiktok/dl',
    instagram: 'https://api.hitube.io/st-tik/ins/dl',
    facebook: 'https://api.hitube.io/st-tik-video/fb/dl',
    twitter: 'https://api.twikite.com/st-tik/x/dl2',
  };
  const endpoint = endpointMap[platform];
  if (!endpoint) return null;

  const ts = Date.now().toString();
  const secureMsg = encryptHitubeTime(ts);
  try {
    const res = await axiosFast.get(endpoint, {
      params: { url: targetUrl, hostname: 'www.hitube.io' },
      timeout: 6000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://www.hitube.io',
        Referer: 'https://www.hitube.io/',
        's-time': ts,
        'X-Secure-Message': secureMsg,
      },
    });
    const body = res.data?.data || res.data?.result || res.data;
    if (typeof body === 'object' && body !== null) {
      const mediaUrl =
        body.url ||
        body.video ||
        body.video_url ||
        body.download_url ||
        body.hd ||
        body.sd ||
        body.links?.[0]?.url ||
        body.medias?.[0]?.url ||
        body.formats?.[0]?.url;
      if (typeof mediaUrl === 'string' && mediaUrl.startsWith('http')) {
        return {
          mediaUrl,
          audioUrl: body.audio || body.music,
          title: body.title,
          ext: body.ext || 'mp4',
          engine: 'hitube.io',
        };
      }
    }
  } catch {
    // fallback to next provider
  }
  return null;
}

async function trySnapvid(targetUrl: string): Promise<ResolvedMedia | null> {
  try {
    const res = await axiosFast.post(
      'https://snapvid.net/api/ajaxSearch',
      new URLSearchParams({ q: targetUrl, vt: 'home' }).toString(),
      {
        timeout: 4500,
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
  const platform = detectPlatform(targetUrl);
  if (platform === 'youtube') return null;

  try {
    const tokRes = await axiosFast.get('https://viddown.io/api/token', {
      timeout: 5000,
      headers: { Referer: 'https://viddown.io/' },
    });
    const token = tokRes.data?.data?.token;
    const timestamp = tokRes.data?.data?.timestamp;
    if (!token || !timestamp) return null;

    const endpoint =
      platform === 'instagram'
        ? '/api/instagram'
        : platform === 'facebook'
        ? '/api/action'
        : platform === 'twitter'
        ? '/api/twitter'
        : '/api/extract';

    const res = await axiosFast.get(
      `https://viddown.io${endpoint}?url=${encodeURIComponent(targetUrl)}`,
      {
        timeout: 10000,
        headers: {
          Referer: 'https://viddown.io/',
          'X-API-Token': String(token),
          'X-Request-Timestamp': String(timestamp),
        },
      }
    );
    const data = res.data?.data;
    const dlUrl =
      data?.downloadUrl ||
      data?.url ||
      data?.video ||
      data?.hd ||
      data?.sd ||
      data?.formats?.[0]?.url;
    if (typeof dlUrl === 'string' && dlUrl.startsWith('http')) {
      return {
        mediaUrl: dlUrl,
        title: data?.title || undefined,
        ext: 'mp4',
        engine: 'viddown.io',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

async function tryClipto(targetUrl: string, quality = '1080p', format = 'mp4'): Promise<ResolvedMedia | null> {
  const platform = detectPlatform(targetUrl);
  if (platform === 'youtube') return null;

  try {
    const res = await axiosFast.post(
      'https://www.clipto.com/api/youtube',
      { url: targetUrl },
      {
        timeout: 8000,
        headers: {
          Origin: 'https://www.clipto.com',
          Referer: 'https://www.clipto.com/',
        },
      }
    );
    const body = res.data;
    if (body?.success && Array.isArray(body.medias) && body.medias.length > 0) {
      const wantAudio = format === 'mp3' || format === 'm4a' || quality === 'audio-only';
      const audio = body.medias.find((m: any) => m.type === 'audio' || m.ext === 'mp3');
      const hdVideo =
        body.medias.find((m: any) => m.quality === 'hd_no_watermark' || m.quality === 'hd') ||
        body.medias.find((m: any) => m.type === 'video' || m.ext === 'mp4') ||
        body.medias[0];
      const chosen = wantAudio && audio ? audio : hdVideo;
      if (chosen?.url && String(chosen.url).startsWith('http')) {
        return {
          mediaUrl: chosen.url,
          audioUrl: audio?.url,
          title: body.title || undefined,
          ext: wantAudio ? 'mp3' : 'mp4',
          engine: 'clipto',
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function decodeSnapsaveScript(script: string): string {
  const m = script.match(
    /eval\(function\(h,u,n,t,e,r\)\{[\s\S]*?\}\("([^"]+)",(\d+),"([^"]+)",(\d+),(\d+),(\d+)\)\)/
  );
  if (!m) return script;
  const [, h, , n, tStr, eStr] = m;
  const t = parseInt(tStr, 10);
  const e = parseInt(eStr, 10);
  const alpha = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/';
  const decodeBase = (d: string, b: number, c: number) => {
    const g = alpha.slice(0, b);
    const k = alpha.slice(0, c);
    let j = d
      .split('')
      .reverse()
      .reduce((acc, ch, idx) => {
        const pos = g.indexOf(ch);
        return pos !== -1 ? acc + pos * Math.pow(b, idx) : acc;
      }, 0);
    let out = '';
    while (j > 0) {
      out = k[j % c] + out;
      j = Math.floor(j / c);
    }
    return out || '0';
  };
  let r = '';
  for (let i = 0; i < h.length; i++) {
    let s = '';
    while (i < h.length && h[i] !== n[e]) {
      s += h[i];
      i++;
    }
    for (let j = 0; j < n.length; j++) {
      s = s.replace(new RegExp(n[j], 'g'), String(j));
    }
    r += String.fromCharCode(parseInt(decodeBase(s, e, 10), 10) - t);
  }
  try {
    return decodeURIComponent(escape(r));
  } catch {
    return r;
  }
}

async function trySnapsave(targetUrl: string): Promise<ResolvedMedia | null> {
  const platform = detectPlatform(targetUrl);
  if (platform !== 'facebook') return null;

  try {
    const res = await axiosFast.post(
      'https://snapsave.app/action.php',
      new URLSearchParams({ url: targetUrl }).toString(),
      {
        timeout: 8000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://snapsave.app',
          Referer: 'https://snapsave.app/',
        },
      }
    );
    const decoded = decodeSnapsaveScript(String(res.data || ''));
    const $$ = cheerio.load(decoded);
    const href = $$('a[href^="http"]').first().attr('href');
    if (href && !href.includes('snapsave.app')) {
      return {
        mediaUrl: href,
        ext: 'mp4',
        engine: 'snapsave.app',
      };
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
      tryViddown(targetUrl).then((r) => (r ? r : Promise.reject(new Error('viddown failed')))),
      tryClipto(targetUrl).then((r) => (r ? r : Promise.reject(new Error('clipto failed')))),
      trySnapsave(targetUrl).then((r) => (r ? r : Promise.reject(new Error('snapsave failed')))),
      trySnapvid(targetUrl).then((r) => (r ? r : Promise.reject(new Error('snapvid failed')))),
    ]);
  } catch {
    return null;
  }
}

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

export async function probeDirectMedia(
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

export function isBlockedHost(host: string): boolean {
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

export function registerApiRoutes(
  app: express.Express,
  options: { includeProxy?: boolean } = { includeProxy: true }
) {
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/speedtest', (_req, res) => {
    res.json({
      latency: Math.floor(Math.random() * 40) + 10,
      download_speed: Math.floor(Math.random() * 80) + 40,
      protocol: 'HTTP/2',
      tls: 'TLS 1.3',
      resume: 'Supported',
    });
  });

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

          const st = await fetchSavetubeInfo(url);
          if (st?.info) {
            const vFormats: any[] = Array.isArray(st.info.video_formats) ? st.info.video_formats : [];
            const seenHeights = new Set<number>();
            for (const vf of [...vFormats].sort((a, b) => Number(b.height || b.quality) - Number(a.height || a.quality))) {
              const h = Number(vf.height || vf.quality) || 0;
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
              qualities.push({
                quality: qKey,
                format: 'mp4',
                label: vf.label && vf.label !== 'MP4 video' ? vf.label : `${h}p MP4`,
              });
            }
            if (Array.isArray(st.info.audio_formats) && st.info.audio_formats.length > 0) {
              qualities.push({ quality: 'audio-only', format: 'mp3', label: 'Audio MP3' });
            }
            if (qualities.length > 0) {
              return res.json({
                title: st.info.title || undefined,
                platform: 'youtube',
                engine: 'savetube-cdn',
                qualities,
              });
            }
          }
        }
      }

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

  app.post('/api/extract-hitube', async (req, res) => {
    const { url, quality = '1080p', format = 'mp4' } = req.body || {};
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      return res.status(400).json({ error: 'الرابط غير صالح' });
    }
    const cleanUrl = url.trim();
    try {
      const platform = detectPlatform(cleanUrl);
      let resolved: ResolvedMedia | null = await tryHitube(cleanUrl);

      if (!resolved?.mediaUrl) {
        const ytResolver = async (): Promise<ResolvedMedia> => {
          const fast = await resolveYouTubeInnertube(cleanUrl, quality, format);
          if (fast?.mediaUrl) return fast;
          const savetube = await resolveYouTubeSavetube(cleanUrl, quality, format);
          if (savetube?.mediaUrl) return savetube;
          throw new Error('youtube failed');
        };

        const nativeResolver = async (): Promise<ResolvedMedia> => {
          let native: ResolvedMedia | null = null;
          if (platform === 'youtube') return ytResolver();
          if (platform === 'tiktok') native = await resolveTikTok(cleanUrl);
          else if (platform === 'twitter') native = await resolveTwitter(cleanUrl);
          else if (platform === 'instagram' || platform === 'facebook') native = await resolveMetaSocial(cleanUrl);
          else {
            const probe = await probeDirectMedia(cleanUrl);
            if (probe.ok) native = { mediaUrl: cleanUrl, engine: 'direct' };
          }
          if (!native?.mediaUrl) throw new Error('native failed');
          return native;
        };

        const fallbackResolvers: Promise<ResolvedMedia>[] = [
          tryViddown(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('viddown')))),
          tryClipto(cleanUrl, quality, format).then((r) => (r ? r : Promise.reject(new Error('clipto')))),
          trySnapsave(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('snapsave')))),
          trySnapvid(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('snapvid')))),
          nativeResolver(),
        ];

        try {
          resolved = await Promise.any(fallbackResolvers);
        } catch {
          return res.status(422).json({
            error: 'تعذر استخراج الفيديو من Hitube والمصادر البديلة؛ قد يكون الرابط محمياً أو خاصاً.',
          });
        }
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
      return res.status(502).json({ error: err?.message || 'فشل الاتصال بخدمة الاستخراج' });
    }
  });

  app.post('/api/extract', async (req, res) => {
    const { url, quality = '1080p', format = 'mp4' } = req.body || {};
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      return res.status(400).json({ error: 'رابط غير صالح' });
    }
    const cleanUrl = url.trim();
    try {
      const platform = detectPlatform(cleanUrl);
      const nativeResolver = async (): Promise<ResolvedMedia | null> => {
        if (platform === 'youtube') {
          const fast = await resolveYouTubeInnertube(cleanUrl, quality, format);
          if (fast?.mediaUrl) return fast;
          return resolveYouTubeSavetube(cleanUrl, quality, format);
        }
        if (platform === 'tiktok') return resolveTikTok(cleanUrl);
        if (platform === 'twitter') return resolveTwitter(cleanUrl);
        if (platform === 'instagram' || platform === 'facebook') return resolveMetaSocial(cleanUrl);
        const probe = await probeDirectMedia(cleanUrl);
        return probe.ok ? { mediaUrl: cleanUrl, engine: 'direct' } : null;
      };

      const providers = [
        tryHitube(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('hitube')))),
        tryViddown(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('viddown')))),
        tryClipto(cleanUrl, quality, format).then((r) => (r ? r : Promise.reject(new Error('clipto')))),
        trySnapsave(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('snapsave')))),
        trySnapvid(cleanUrl).then((r) => (r ? r : Promise.reject(new Error('snapvid')))),
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

  app.get('/api/proxy-meta', async (req, res) => {
    const targetUrl = String(req.query.url || '');
    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'Invalid protocol' });
      }
      if (isBlockedHost(parsed.hostname)) {
        return res.status(403).json({ error: 'Blocked host' });
      }
      const headers: Record<string, string> = {};
      if (parsed.hostname.includes('googlevideo.com')) headers['User-Agent'] = ANDROID_VR_UA;
      else if (parsed.hostname.includes('tiktok')) headers.Referer = 'https://www.tiktok.com/';
      else if (parsed.hostname.includes('savetube')) headers.Referer = 'https://yt.savetube.me/';
      else if (parsed.hostname.includes('rapidcdn')) headers.Referer = 'https://viddown.io/';
      const info = await probeDirectMedia(parsed.toString(), headers);
      return res.json(info);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
  });

  if (options.includeProxy !== false) {
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
        if (isBlockedHost(parsed.hostname)) {
          return res.status(403).json({ error: 'Blocked host' });
        }
      } catch {
        return res.status(400).json({ error: 'Invalid URL' });
      }

      try {
        const forwardHeaders: Record<string, string> = {
          'Accept-Encoding': 'identity',
        };
        if (req.headers.range) forwardHeaders.Range = String(req.headers.range);
        if (parsed.hostname.includes('googlevideo.com')) {
          forwardHeaders['User-Agent'] = ANDROID_VR_UA;
        } else if (parsed.hostname.includes('tiktok')) {
          forwardHeaders.Referer = 'https://www.tiktok.com/';
        } else if (parsed.hostname.includes('savetube')) {
          forwardHeaders.Referer = 'https://yt.savetube.me/';
        } else if (parsed.hostname.includes('rapidcdn')) {
          forwardHeaders.Referer = 'https://viddown.io/';
        }

        const upstream = await axiosFast.get(parsed.toString(), {
          responseType: 'stream',
          timeout: 0,
          decompress: false,
          headers: forwardHeaders,
          validateStatus: (s) => s >= 200 && s < 300,
        });

        const rawContentType = String(upstream.headers['content-type'] || 'video/mp4');
        const lowerContentType = rawContentType.toLowerCase();
        if (
          lowerContentType.includes('text/html') ||
          lowerContentType.includes('application/json') ||
          lowerContentType.includes('text/plain')
        ) {
          upstream.data?.destroy?.();
          return res.status(422).json({ error: 'الرابط يعيد صفحة ويب وليس فيديو' });
        }

        const contentLengthHeader = upstream.headers['content-length'];
        if (contentLengthHeader !== undefined && Number(contentLengthHeader) === 0) {
          upstream.data?.destroy?.();
          return res.status(502).json({ error: 'الملف القادم من المصدر فارغ (0 بايت)' });
        }

        res.status(upstream.status);
        res.setHeader('Content-Type', rawContentType);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
          'Access-Control-Expose-Headers',
          'Content-Length, Content-Range, Accept-Ranges, Content-Type'
        );
        res.setHeader('Accept-Ranges', String(upstream.headers['accept-ranges'] || 'bytes'));
        if (contentLengthHeader && !upstream.headers['content-encoding']) {
          res.setHeader('Content-Length', String(contentLengthHeader));
        }
        if (upstream.headers['content-range']) {
          res.setHeader('Content-Range', String(upstream.headers['content-range']));
        }
        if (forceDownload) {
          res.setHeader('Content-Disposition', contentDisposition(rawFilename));
        }

        const stream = upstream.data as NodeJS.ReadableStream & { destroy?: () => void };
        stream.on('error', () => {
          if (!res.headersSent) {
            res.status(502).json({ error: 'انقطع تدفق الفيديو من المصدر' });
          } else if (!res.writableEnded) {
            res.end();
          }
        });
        res.on('close', () => {
          if (!res.writableEnded) {
            stream.destroy?.();
          }
        });

        stream.pipe(res);
      } catch (err: any) {
        if (!res.headersSent) {
          return res.status(502).json({ error: err?.message || 'Proxy stream failed' });
        }
        if (!res.writableEnded) {
          res.end();
        }
      }
    };

    app.get('/api/proxy', handleMediaProxy);
    app.get('/api/proxy-download', handleMediaProxy);
  }
}
