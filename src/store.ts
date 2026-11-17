import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DownloadItem {
  id: string;
  url: string;
  name: string;
  type: string;
  format: 'mp4' | 'mp3' | 'm4a' | 'webm';
  quality: '4k' | '1080p' | '720p' | '480p' | '360p' | '144p' | 'audio-only';
  status: 'downloading' | 'completed' | 'failed' | 'paused' | 'queued';
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  dateAdded: number;
  tags: string[];
  filename?: string;
  playUrl?: string;
  errorMessage?: string;
  segments?: number;
  engine?: string;
}

const ARABIC_ORDINALS = [
  'الأول',
  'الثاني',
  'الثالث',
  'الرابع',
  'الخامس',
  'السادس',
  'السابع',
  'الثامن',
  'التاسع',
  'العاشر',
];

export function formatUntitledVideoName(index: number, isRTL: boolean): string {
  if (!isRTL) {
    return `Video ${index}`;
  }
  if (index >= 1 && index <= ARABIC_ORDINALS.length) {
    return `الفيديو ${ARABIC_ORDINALS[index - 1]}`;
  }
  return `الفيديو رقم ${index}`;
}

interface AppState {
  // Settings
  language: string;
  setLanguage: (lang: string) => void;
  safeModeTouchId: boolean;
  setSafeModeTouchId: (enabled: boolean) => void;
  downloadsFolder: string;
  setDownloadsFolder: (folder: string) => void;
  autoDownload: boolean;
  setAutoDownload: (enabled: boolean) => void;
  concurrentDownloads: number;
  setConcurrentDownloads: (num: number) => void;
  speedLimit: string;
  setSpeedLimit: (limit: string) => void;
  notifySound: boolean;
  notifyComplete: boolean;
  notifyFailed: boolean;
  alertSound: string;
  setNotificationsSettings: (settings: Partial<AppState>) => void;
  theme: 'dark' | 'light' | 'auto';
  setTheme: (theme: 'dark' | 'light' | 'auto') => void;
  dynamicColors: boolean;
  setDynamicColors: (enabled: boolean) => void;

  // Naming counter
  untitledCounter: number;
  consumeUntitledName: (isRTL: boolean) => string;

  // Data
  downloads: DownloadItem[];
  addDownload: (item: DownloadItem) => void;
  updateDownload: (id: string, data: Partial<DownloadItem>) => void;
  removeDownload: (id: string) => void;
  clearHistory: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      language: 'ar',
      setLanguage: (language) => set({ language }),
      safeModeTouchId: false,
      setSafeModeTouchId: (safeModeTouchId) => set({ safeModeTouchId }),
      downloadsFolder: 'default',
      setDownloadsFolder: (downloadsFolder) => set({ downloadsFolder }),
      autoDownload: false,
      setAutoDownload: (autoDownload) => set({ autoDownload }),
      concurrentDownloads: 2,
      setConcurrentDownloads: (concurrentDownloads) => set({ concurrentDownloads }),
      speedLimit: 'unlimited',
      setSpeedLimit: (speedLimit) => set({ speedLimit }),
      notifySound: true,
      notifyComplete: true,
      notifyFailed: true,
      alertSound: 'default',
      setNotificationsSettings: (settings) => set((state) => ({ ...state, ...settings })),
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      dynamicColors: false,
      setDynamicColors: (dynamicColors) => set({ dynamicColors }),

      untitledCounter: 0,
      consumeUntitledName: (isRTL) => {
        const next = get().untitledCounter + 1;
        set({ untitledCounter: next });
        return formatUntitledVideoName(next, isRTL);
      },

      downloads: [],
      addDownload: (item) => set((state) => ({ downloads: [item, ...state.downloads] })),
      updateDownload: (id, data) => set((state) => ({
        downloads: state.downloads.map((d) => (d.id === id ? { ...d, ...data } : d)),
      })),
      removeDownload: (id) => set((state) => ({
        downloads: state.downloads.filter((d) => d.id !== id),
      })),
      clearHistory: () => set({ downloads: [] }),
    }),
    {
      name: 'downloader-storage',
    }
  )
);
