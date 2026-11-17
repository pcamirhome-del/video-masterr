import axios, { AxiosError } from 'axios';
import { DownloadItem, useAppStore } from '../store';

const DB_NAME = 'dmaster_media_cache';
const STORE_NAME = 'files';

function openMediaDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMediaBlob(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB may be unavailable in private browsing
  }
}

export async function getMediaBlobUrl(id: string): Promise<string | null> {
  const cached = memoryBlobUrls.get(id);
  if (cached) return cached;
  try {
    const db = await openMediaDB();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (blob instanceof Blob) {
      const url = URL.createObjectURL(blob);
      memoryBlobUrls.set(id, url);
      return url;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function deleteMediaBlob(id: string): Promise<void> {
  const existing = memoryBlobUrls.get(id);
  if (existing) {
    URL.revokeObjectURL(existing);
    memoryBlobUrls.delete(id);
  }
  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}

const memoryBlobUrls = new Map<string, string>();
const activeControllers = new Map<string, AbortController>();

export interface DownloadProgressCallbacks {
  onProgress?: (percent: number) => void;
  onDownloadedMB?: (mb: string) => void;
  onSpeed?: (mbps: string) => void;
  onError?: (message: string) => void;
}

export function triggerBrowserSave(blobUrl: string, fileName: string) {
  const link = document.createElement('a');
  link.href = blobUrl;
  link.setAttribute('download', fileName || 'video.mp4');
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function isTransientNetworkError(err: any): boolean {
  const axErr = err as AxiosError<any>;
  if (axios.isCancel(err) || err?.name === 'CanceledError') return false;
  if (!axErr?.response) return true;
  const st = axErr.response.status;
  return st === 502 || st === 503 || st === 504 || st === 408;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new axios.CanceledError('aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new axios.CanceledError('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function downloadWithChunkFallback(
  downloadEndpoint: string,
  rawMediaUrl: string,
  item: DownloadItem,
  controller: AbortController,
  callbacks: DownloadProgressCallbacks,
  onStoreProgress: (loaded: number, total: number, speedBps: number) => void
): Promise<{ blob: Blob; contentTypeStr: string }> {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB chunks stay safely under Cloud Run 32MB limit
  let totalBytes = 0;
  let supportsRange = false;
  let probedContentType = '';

  // Lightweight metadata probe (HEAD / aborted 1-byte Range) so we never accidentally buffer a 200 response
  if (rawMediaUrl) {
    try {
      const metaRes = await axios.get(
        `/api/proxy-meta?url=${encodeURIComponent(rawMediaUrl)}`,
        { signal: controller.signal, timeout: 10000 }
      );
      const meta = metaRes.data;
      const metaCt = typeof meta?.contentType === 'string' ? meta.contentType.toLowerCase() : '';
      if (
        metaCt.includes('text/html') ||
        metaCt.includes('application/json') ||
        metaCt.includes('text/plain')
      ) {
        throw new Error('الرابط يعيد صفحة ويب أو خطأ وليس ملف وسائط');
      }
      if (meta?.totalBytes > 0) totalBytes = Number(meta.totalBytes);
      if (meta?.acceptRanges) supportsRange = true;
      if (metaCt) {
        probedContentType = metaCt;
      }
    } catch (probeErr: any) {
      if (axios.isCancel(probeErr) || controller.signal.aborted) throw probeErr;
      if (probeErr?.message?.includes('صفحة ويب')) throw probeErr;
    }
  }

  // Use Range chunks when file > 16 MB and Range is supported
  if (supportsRange && totalBytes > 16 * 1024 * 1024) {
    const parts: BlobPart[] = [];
    let offset = 0;
    let lastTime = Date.now();
    let lastLoaded = 0;

    while (offset < totalBytes) {
      const end = Math.min(offset + CHUNK_SIZE - 1, totalBytes - 1);
      let chunkData: ArrayBuffer | null = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const chunkRes = await axios({
            url: downloadEndpoint,
            method: 'GET',
            headers: { Range: `bytes=${offset}-${end}` },
            responseType: 'arraybuffer',
            signal: controller.signal,
            timeout: 45000,
            onDownloadProgress: (ev) => {
              const currentLoaded = offset + ev.loaded;
              const pct = Math.min(99, Math.round((currentLoaded * 100) / totalBytes));
              callbacks.onProgress?.(pct);
              callbacks.onDownloadedMB?.((currentLoaded / (1024 * 1024)).toFixed(1));

              const now = Date.now();
              const dt = (now - lastTime) / 1000;
              let speedBps = 0;
              if (dt >= 0.5) {
                speedBps = Math.max(0, (currentLoaded - lastLoaded) / dt);
                callbacks.onSpeed?.((speedBps / (1024 * 1024)).toFixed(2));
                lastTime = now;
                lastLoaded = currentLoaded;
              }
              onStoreProgress(currentLoaded, totalBytes, speedBps);
            },
          });
          const ct = chunkRes.headers['content-type'];
          const ctStr = typeof ct === 'string' ? ct.toLowerCase() : '';
          if (ctStr.includes('text/html') || ctStr.includes('application/json')) {
            throw new Error('الرابط يعيد صفحة ويب أو خطأ وليس ملف وسائط');
          }
          if (ctStr) probedContentType = ctStr;
          chunkData = chunkRes.data as ArrayBuffer;
          break;
        } catch (err: any) {
          if (attempt < 2 && isTransientNetworkError(err)) {
            await sleep(700 * (attempt + 1), controller.signal);
            continue;
          }
          throw err;
        }
      }

      if (!chunkData) throw new Error('انقطع الاتصال أثناء تحميل أجزاء الملف');
      parts.push(chunkData);
      offset += chunkData.byteLength;
      if (chunkData.byteLength === 0) break;
    }

    const mime =
      probedContentType || (item.type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    return { blob: new Blob(parts, { type: mime }), contentTypeStr: mime };
  }

  // Standard single-stream download with automatic retry on transient Network Error
  let lastTime = Date.now();
  let lastLoaded = 0;
  let lastError: any;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios({
        url: downloadEndpoint,
        method: 'GET',
        responseType: 'blob',
        signal: controller.signal,
        timeout: 60000,
        onDownloadProgress: (progressEvent) => {
          const { loaded, total } = progressEvent;
          const effTotal = total || totalBytes || 0;

          if (effTotal > 0) {
            const percentCompleted = Math.min(100, Math.round((loaded * 100) / effTotal));
            callbacks.onProgress?.(percentCompleted);
          }

          const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
          callbacks.onDownloadedMB?.(loadedMB);

          const currentTime = Date.now();
          const timeDiff = (currentTime - lastTime) / 1000;
          let speedBps = 0;
          if (timeDiff >= 0.5) {
            speedBps = Math.max(0, (loaded - lastLoaded) / timeDiff);
            const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
            callbacks.onSpeed?.(speedMBps);
            lastTime = currentTime;
            lastLoaded = loaded;
          }

          onStoreProgress(loaded, effTotal || loaded, speedBps);
        },
      });

      const contentTypeHeader = response.headers['content-type'];
      const contentTypeStr =
        typeof contentTypeHeader === 'string' ? contentTypeHeader.toLowerCase() : '';

      // Reject HTML / JSON / plain-text responses before saving anything
      if (
        contentTypeStr.includes('text/html') ||
        contentTypeStr.includes('application/json') ||
        contentTypeStr.includes('text/plain')
      ) {
        let parsedError = '';
        if (response.data instanceof Blob) {
          try {
            const textBody = await response.data.text();
            if (contentTypeStr.includes('application/json')) {
              const json = JSON.parse(textBody);
              parsedError = json?.error || json?.message || '';
            }
          } catch {
            // ignore JSON parse errors
          }
        }
        throw new Error(parsedError || 'الرابط يعيد صفحة ويب أو خطأ وليس ملف وسائط');
      }

      const blob =
        response.data instanceof Blob
          ? new Blob([response.data], {
              type:
                contentTypeStr ||
                (item.type === 'audio' ? 'audio/mpeg' : 'video/mp4'),
            })
          : new Blob([response.data], {
              type: item.type === 'audio' ? 'audio/mpeg' : 'video/mp4',
            });

      return { blob, contentTypeStr };
    } catch (err: any) {
      lastError = err;
      if (attempt < 2 && isTransientNetworkError(err)) {
        lastLoaded = 0;
        lastTime = Date.now();
        await sleep(800 * (attempt + 1), controller.signal);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export async function startClientDownload(
  item: DownloadItem,
  callbacks: DownloadProgressCallbacks = {}
): Promise<void> {
  const { updateDownload } = useAppStore.getState();

  // Cancel any existing controller for this ID
  activeControllers.get(item.id)?.abort();
  const controller = new AbortController();
  activeControllers.set(item.id, controller);

  updateDownload(item.id, {
    status: 'downloading',
    errorMessage: undefined,
    speedBytesPerSec: 0,
  });

  try {
    // Step 1: Extract direct CDN URL via server-side Hitube endpoint (/api/extract-hitube) with transient retry
    let extractRes: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        extractRes = await axios.post(
          '/api/extract-hitube',
          {
            url: item.url,
            quality: item.quality,
            format: item.format,
          },
          { signal: controller.signal, timeout: 30000 }
        );
        break;
      } catch (err: any) {
        if (attempt === 0 && isTransientNetworkError(err)) {
          await sleep(700, controller.signal);
          continue;
        }
        throw err;
      }
    }

    const extractData = extractRes.data;
    const resolvedTitle: string =
      (extractData.title && extractData.title !== 'video' ? extractData.title : '') || item.name;
    const ext: string = extractData.ext || item.format || 'mp4';
    const finalFileName = `${resolvedTitle}.${ext}`;
    const downloadEndpoint: string =
      extractData.proxyDownloadUrl ||
      `/api/proxy?url=${encodeURIComponent(extractData.mediaUrl)}&download=1&filename=${encodeURIComponent(finalFileName)}`;
    const playEndpoint: string =
      extractData.proxyPlayUrl ||
      `/api/proxy?url=${encodeURIComponent(extractData.mediaUrl)}`;

    updateDownload(item.id, {
      name: resolvedTitle,
      filename: finalFileName,
      engine: extractData.provider || 'proxy',
      playUrl: playEndpoint,
    });

    // Step 2: Download file via Axios (with automatic Range-chunking > 16MB + retry)
    const { blob } = await downloadWithChunkFallback(
      downloadEndpoint,
      extractData.mediaUrl || '',
      item,
      controller,
      callbacks,
      (loaded, total, speedBps) => {
        updateDownload(item.id, {
          downloadedBytes: loaded,
          totalBytes: total,
          ...(speedBps > 0 ? { speedBytesPerSec: speedBps } : {}),
          status: 'downloading',
        });
      }
    );

    // Reject files smaller than 50 KB as corrupted/blocked stubs
    const MIN_VALID_MEDIA_BYTES = 50 * 1024;
    if (blob.size < MIN_VALID_MEDIA_BYTES) {
      let textSnippet = '';
      try {
        textSnippet = (await blob.slice(0, 512).text()).trim();
        if (textSnippet.startsWith('{')) {
          const parsed = JSON.parse(textSnippet);
          if (parsed?.error) {
            throw new Error(parsed.error);
          }
        }
      } catch (innerErr: any) {
        if (innerErr?.message && !innerErr.message.includes('JSON')) {
          throw innerErr;
        }
      }
      throw new Error('الملف المحمل تالف أو صغير جداً (أقل من 50 كيلوبايت)');
    }

    // Extra guard: inspect leading bytes in case upstream mislabeled an HTML/JSON error page
    const headPreview = (await blob.slice(0, 256).text()).trim().toLowerCase();
    if (
      headPreview.startsWith('<!doctype') ||
      headPreview.startsWith('<html') ||
      headPreview.startsWith('{"error"')
    ) {
      throw new Error('المصدر أعاد صفحة حماية أو خطأ بدلاً من الفيديو');
    }

    await saveMediaBlob(item.id, blob);
    const blobUrl = URL.createObjectURL(blob);
    memoryBlobUrls.set(item.id, blobUrl);

    // Save to user device immediately
    triggerBrowserSave(blobUrl, finalFileName);

    callbacks.onProgress?.(100);
    callbacks.onDownloadedMB?.((blob.size / (1024 * 1024)).toFixed(1));
    callbacks.onSpeed?.('0.00');

    updateDownload(item.id, {
      status: 'completed',
      filename: finalFileName,
      name: resolvedTitle,
      downloadedBytes: blob.size,
      totalBytes: blob.size,
      speedBytesPerSec: 0,
      playUrl: blobUrl,
    });
  } catch (err: any) {
    if (axios.isCancel(err) || err?.name === 'CanceledError' || controller.signal.aborted) {
      // Status already set by pause/cancel handler
      return;
    }

    const axErr = err as AxiosError<any>;
    let msg = err?.message || 'حدث خطأ أثناء التحميل';
    if (msg === 'Network Error') {
      msg = 'تعذر الاتصال بالخادم أو انقطع تدفق الملف؛ يرجى المحاولة مرة أخرى.';
    }

    // When Axios uses responseType: 'blob', HTTP error bodies arrive as a Blob
    const respData = axErr?.response?.data;
    if (respData instanceof Blob) {
      try {
        const blobText = await respData.text();
        try {
          const parsed = JSON.parse(blobText);
          if (parsed?.error) msg = parsed.error;
          else if (parsed?.message) msg = parsed.message;
        } catch {
          if (blobText && !blobText.trim().startsWith('<')) {
            msg = blobText.slice(0, 200);
          } else {
            msg = 'الرابط يعيد صفحة ويب وليس فيديو';
          }
        }
      } catch {
        // keep existing msg
      }
    } else if (respData instanceof ArrayBuffer) {
      try {
        const decoded = new TextDecoder().decode(respData);
        const parsed = JSON.parse(decoded);
        if (parsed?.error) msg = parsed.error;
      } catch {
        // keep existing msg
      }
    } else if (respData && typeof respData === 'object' && respData.error) {
      msg = String(respData.error);
    }

    console.error('حدث خطأ أثناء التحميل:', msg);
    callbacks.onError?.(msg);
    updateDownload(item.id, {
      status: 'failed',
      speedBytesPerSec: 0,
      errorMessage: msg,
    });
  } finally {
    if (activeControllers.get(item.id) === controller) {
      activeControllers.delete(item.id);
    }
  }
}

export function pauseClientDownload(id: string): void {
  const controller = activeControllers.get(id);
  if (controller) {
    controller.abort();
    activeControllers.delete(id);
  }
  useAppStore.getState().updateDownload(id, { status: 'paused', speedBytesPerSec: 0 });
}

export function cancelClientDownload(id: string): void {
  const controller = activeControllers.get(id);
  if (controller) {
    controller.abort();
    activeControllers.delete(id);
  }
  useAppStore.getState().updateDownload(id, { status: 'failed', speedBytesPerSec: 0 });
}

export async function resolvePlayableUrl(dl: DownloadItem): Promise<string | null> {
  const localUrl = await getMediaBlobUrl(dl.id);
  if (localUrl) return localUrl;
  if (dl.playUrl && !dl.playUrl.startsWith('blob:')) return dl.playUrl;
  return null;
}
