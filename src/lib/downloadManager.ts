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
    // Step 1: Extract clean direct + proxy URLs from stateless REST /api/extract
    const extractRes = await axios.post(
      '/api/extract',
      {
        url: item.url,
        quality: item.quality,
        format: item.format,
      },
      { signal: controller.signal }
    );

    const extractData = extractRes.data;
    const downloadEndpoint: string = extractData.proxyDownloadUrl;
    const playEndpoint: string = extractData.proxyPlayUrl;
    const resolvedTitle: string =
      (extractData.title && extractData.title !== 'video' ? extractData.title : '') || item.name;
    const ext: string = extractData.ext || item.format || 'mp4';
    const finalFileName = `${resolvedTitle}.${ext}`;

    updateDownload(item.id, {
      name: resolvedTitle,
      filename: finalFileName,
      engine: extractData.provider || 'proxy',
      playUrl: playEndpoint,
    });

    // Step 2: Download file as Blob via Axios with live onDownloadProgress tracking
    let lastTime = Date.now();
    let lastLoaded = 0;

    const response = await axios({
      url: downloadEndpoint,
      method: 'GET',
      responseType: 'blob',
      signal: controller.signal,
      onDownloadProgress: (progressEvent) => {
        const { loaded, total } = progressEvent;

        if (total) {
          const percentCompleted = Math.round((loaded * 100) / total);
          callbacks.onProgress?.(percentCompleted);
        }

        const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
        callbacks.onDownloadedMB?.(loadedMB);

        const currentTime = Date.now();
        const timeDiff = (currentTime - lastTime) / 1000;
        let speedBps = 0;
        if (timeDiff >= 0.5) {
          speedBps = (loaded - lastLoaded) / timeDiff;
          const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
          callbacks.onSpeed?.(speedMBps);
          lastTime = currentTime;
          lastLoaded = loaded;
        }

        updateDownload(item.id, {
          downloadedBytes: loaded,
          totalBytes: total || loaded,
          ...(speedBps > 0 ? { speedBytesPerSec: speedBps } : {}),
          status: 'downloading',
        });
      },
    });

    const contentTypeHeader = response.headers['content-type'];
    const blob = new Blob([response.data], {
      type:
        typeof contentTypeHeader === 'string' && contentTypeHeader
          ? contentTypeHeader
          : item.type === 'audio'
          ? 'audio/mpeg'
          : 'video/mp4',
    });

    if (blob.size < 512) {
      throw new Error('Downloaded file was empty or blocked by source');
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
    const axErr = err as AxiosError<{ error?: string }>;
    const msg = axErr?.response?.data?.error || err?.message || 'حدث خطأ أثناء التحميل';
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
