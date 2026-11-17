import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n';
import { useAppStore, DownloadItem } from '../../store';
import {
  Download,
  ClipboardPaste,
  Play,
  Loader2,
  Youtube,
  Facebook,
  Instagram,
  Twitter,
  Music,
  Video,
  Pause,
  StopCircle,
  Trash,
  X,
  ListVideo,
  Zap,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { PWAInstallButton } from '../PWAInstallButton';
import {
  startClientDownload,
  pauseClientDownload,
  cancelClientDownload,
  deleteMediaBlob,
  resolvePlayableUrl,
  triggerBrowserSave,
} from '../../lib/downloadManager';

interface AvailableQualityOption {
  quality: '4k' | '1080p' | '720p' | '480p' | '360p' | '144p' | 'audio-only';
  format: 'mp4' | 'webm' | 'mp3' | 'm4a';
  label: string;
  sizeBytes?: number;
}

interface PlaylistVideoItem {
  id: string;
  title: string;
  url: string;
  duration: string;
  thumbnail: string;
  author: string;
}

function isYouTubePlaylistUrl(input: string): boolean {
  const lower = input.toLowerCase();
  return (
    (lower.includes('youtube.com') || lower.includes('youtu.be')) &&
    (lower.includes('list=') || lower.includes('/playlist'))
  );
}

export default function LinksTab() {
  const { t } = useTranslation();
  const {
    addDownload,
    updateDownload,
    removeDownload,
    downloads,
    concurrentDownloads,
    language,
    consumeUntitledName,
  } = useAppStore();
  const isRTL = language === 'ar';

  const inputRef = useRef<HTMLInputElement>(null);
  const pasteBoxRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [pasteHint, setPasteHint] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [quality, setQuality] = useState<'4k' | '1080p' | '720p' | '480p' | '360p' | '144p' | 'audio-only'>('1080p');
  const [format, setFormat] = useState<'mp4' | 'mp3' | 'm4a' | 'webm'>('mp4');
  const [resolvingQualities, setResolvingQualities] = useState(false);
  const [resolvedTitle, setResolvedTitle] = useState('');
  const [availableQualities, setAvailableQualities] = useState<AvailableQualityOption[]>([]);
  const [playingFile, setPlayingFile] = useState<{ url: string; type: string; name?: string } | null>(null);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'video' | 'mp3'>('all');
  const [listSortMode, setListSortMode] = useState<string>('date');

  const [progress, setProgress] = useState(0);
  const [downloadedMB, setDownloadedMB] = useState('0.0');
  const [speed, setSpeed] = useState('0.00');
  const [downloadError, setDownloadError] = useState('');

  // Playlist state
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [playlistItems, setPlaylistItems] = useState<PlaylistVideoItem[]>([]);
  const [playlistError, setPlaylistError] = useState('');

  const fetchPlaylist = async (targetUrl: string) => {
    setPlaylistLoading(true);
    setPlaylistError('');
    try {
      const res = await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load playlist');
      }
      setPlaylistTitle(data.title || (isRTL ? 'قائمة تشغيل يوتيوب' : 'YouTube Playlist'));
      setPlaylistItems(Array.isArray(data.items) ? data.items : []);
    } catch (err: any) {
      setPlaylistError(err?.message || (isRTL ? 'تعذر جلب قائمة التشغيل' : 'Failed to fetch playlist'));
      setPlaylistItems([]);
    } finally {
      setPlaylistLoading(false);
    }
  };

  const resolveUrlQualities = async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setAvailableQualities([]);
      setResolvedTitle('');
      return;
    }
    setResolvingQualities(true);
    try {
      const res = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setResolvedTitle(data.title || '');
      const list: AvailableQualityOption[] = Array.isArray(data.qualities) ? data.qualities : [];
      setAvailableQualities(list);
      if (list.length > 0) {
        setQuality(list[0].quality);
        setFormat(list[0].format);
      }
    } catch {
      // ignore transient network errors
    } finally {
      setResolvingQualities(false);
    }
  };

  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setAvailableQualities([]);
      setResolvedTitle('');
      return;
    }
    const timer = setTimeout(() => {
      resolveUrlQualities(trimmed);
    }, 450);
    return () => clearTimeout(timer);
  }, [url]);

  const applyPastedUrl = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setUrl(clean);
    setShowPasteBox(false);
    setPasteHint('');
    if (isYouTubePlaylistUrl(clean)) {
      fetchPlaylist(clean);
    }
    resolveUrlQualities(clean);
  };

  const handlePaste = async () => {
    setPasteHint('');
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          applyPastedUrl(text);
          return;
        }
      }
    } catch {
      // Clipboard readText may be blocked in embedded iframe
    }

    // Fallback 1: Try execCommand('paste') on focused input
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      try {
        const ok = document.execCommand('paste');
        if (ok && inputRef.current.value && inputRef.current.value.trim()) {
          applyPastedUrl(inputRef.current.value);
          return;
        }
      } catch {
        // ignore
      }
    }

    // Fallback 2: Show 1-tap inline paste box so user can paste immediately in restricted iframes
    setShowPasteBox(true);
    setPasteHint(
      isRTL
        ? 'اضغط مطولاً داخل المربع واختر "لصق" (أو اضغط Ctrl+V)'
        : 'Long-press inside the box and tap Paste (or press Ctrl+V)'
    );
    setTimeout(() => pasteBoxRef.current?.focus(), 50);
  };

  const activeDownloadsCount = downloads.filter((d) => d.status === 'downloading').length;

  const runAxiosDownload = (item: DownloadItem) => {
    setProgress(0);
    setDownloadedMB('0.0');
    setSpeed('0.00');
    setDownloadError('');
    void startClientDownload(item, {
      onProgress: setProgress,
      onDownloadedMB: setDownloadedMB,
      onSpeed: setSpeed,
      onError: setDownloadError,
    });
  };

  const enqueueAndStart = (targetUrl: string, customTitle?: string) => {
    if (!targetUrl) return;

    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const fallbackName = consumeUntitledName(isRTL);
    const displayName = customTitle && customTitle.trim() ? customTitle.trim() : fallbackName;

    const isAudioOnly = quality === 'audio-only' || format === 'mp3' || format === 'm4a';
    const finalFormat =
      quality === 'audio-only'
        ? format === 'mp4' || format === 'webm'
          ? 'mp3'
          : format
        : format;

    const shouldStartNow = activeDownloadsCount < concurrentDownloads;

    const newDownload: DownloadItem = {
      id,
      url: targetUrl,
      name: displayName,
      type: isAudioOnly ? 'audio' : 'video',
      format: finalFormat,
      quality,
      status: shouldStartNow ? 'downloading' : 'queued',
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      dateAdded: Date.now(),
      tags: [],
    };

    addDownload(newDownload);

    if (shouldStartNow) {
      runAxiosDownload(newDownload);
    }
  };

  const startDownload = () => {
    if (!url.trim()) return;
    if (isYouTubePlaylistUrl(url) && !url.includes('watch?v=')) {
      fetchPlaylist(url.trim());
      return;
    }
    enqueueAndStart(url.trim(), resolvedTitle || undefined);
    setUrl('');
    setAvailableQualities([]);
    setResolvedTitle('');
  };

  const handleManualStartItem = (dl: DownloadItem) => {
    if (dl.status === 'paused' || dl.status === 'queued' || dl.status === 'failed') {
      updateDownload(dl.id, { status: 'downloading', downloadedBytes: 0, errorMessage: undefined });
      runAxiosDownload(dl);
    }
  };

  const handleDeleteItem = (dl: DownloadItem) => {
    if (dl.status === 'downloading' || dl.status === 'paused') {
      cancelClientDownload(dl.id);
    }
    void deleteMediaBlob(dl.id);
    removeDownload(dl.id);
  };

  const handlePlayClick = async (dl: DownloadItem) => {
    if (dl.status === 'completed') {
      const fileUrl = await resolvePlayableUrl(dl);
      if (!fileUrl) return;
      if (dl.type === 'audio' || dl.format === 'mp3' || dl.format === 'm4a') {
        setPlayingFile({ url: fileUrl, type: 'audio/mpeg', name: dl.filename || dl.name });
      } else {
        setPlayingFile({ url: fileUrl, type: 'video/mp4', name: dl.filename || dl.name });
      }
    }
  };

  const handleSaveFile = async (dl: DownloadItem) => {
    const fileUrl = await resolvePlayableUrl(dl);
    if (fileUrl) {
      triggerBrowserSave(fileUrl, dl.filename || `${dl.name}.${dl.format}`);
    }
  };

  const filteredDownloads = downloads
    .filter((dl) => {
      if (mediaFilter === 'video') {
        return dl.type !== 'audio' && dl.format !== 'mp3' && dl.format !== 'm4a';
      }
      if (mediaFilter === 'mp3') {
        return dl.type === 'audio' || dl.format === 'mp3' || dl.format === 'm4a';
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (listSortMode === 'name') {
        return (a.filename || a.name).localeCompare(b.filename || b.name);
      }
      if (listSortMode === 'type') {
        return a.format.localeCompare(b.format);
      }
      if (listSortMode === 'size') {
        return (a.totalBytes || 0) - (b.totalBytes || 0);
      }
      if (listSortMode === 'date_asc') {
        return a.dateAdded - b.dateAdded;
      }
      return b.dateAdded - a.dateAdded;
    });

  return (
    <div className="w-full max-w-4xl mx-auto animate-fade-in pb-10 overflow-x-hidden">
      {/* Platform Icons + PWA Install Button */}
      <div className="flex justify-center items-center flex-wrap gap-3 sm:gap-4 mb-6">
        <div className="flex items-center gap-3 sm:gap-4 opacity-70 text-slate-600 dark:text-slate-300">
          <Youtube className="w-6 h-6 sm:w-7 sm:h-7" />
          <Facebook className="w-6 h-6 sm:w-7 sm:h-7" />
          <Twitter className="w-6 h-6 sm:w-7 sm:h-7" />
          <Instagram className="w-6 h-6 sm:w-7 sm:h-7" />
          <svg className="w-6 h-6 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="currentColor" aria-label="TikTok">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
          </svg>
        </div>
        <PWAInstallButton />
      </div>

      {/* Main Link Input Card */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-3 sm:p-5 mb-6">
        <div className="flex flex-col md:flex-row gap-2.5 mb-3 bg-slate-50 dark:bg-slate-900 p-2 rounded-2xl border-2 border-slate-200 dark:border-slate-700">
          <div className="relative flex-1 flex items-center min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (pasteHint) setPasteHint('');
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData?.getData('text') || '';
                if (pasted && isYouTubePlaylistUrl(pasted)) {
                  fetchPlaylist(pasted);
                }
              }}
              placeholder={t('Paste Link Here')}
              className="w-full min-w-0 bg-transparent border-0 text-slate-900 dark:text-white focus:ring-0 block px-3 py-2 text-base outline-none"
              dir="ltr"
            />
            <button
              type="button"
              onClick={handlePaste}
              className="p-2 text-slate-600 dark:text-slate-200 hover:text-white bg-slate-200 dark:bg-slate-800 hover:bg-blue-600 rounded-xl transition border border-slate-300 dark:border-slate-600 shrink-0 ml-1.5 rtl:mr-1.5 flex items-center gap-1"
              title={t('Paste Link')}
            >
              <ClipboardPaste className="w-5 h-5" />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startDownload}
              disabled={!url}
              className="flex-1 md:flex-initial bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white font-semibold py-2.5 px-5 rounded-xl transition-all flex items-center justify-center whitespace-nowrap"
            >
              <Download className={cn('w-5 h-5', isRTL ? 'ml-2' : 'mr-2')} />
              {t('Download')}
            </button>
            {isYouTubePlaylistUrl(url) && (
              <button
                type="button"
                onClick={() => fetchPlaylist(url.trim())}
                disabled={playlistLoading}
                className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all flex items-center justify-center whitespace-nowrap"
                title={isRTL ? 'جلب قائمة التشغيل' : 'Load Playlist'}
              >
                {playlistLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ListVideo className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>

        {showPasteBox && (
          <div className="mb-3 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 flex items-center gap-2">
            <input
              ref={pasteBoxRef}
              type="text"
              autoFocus
              placeholder={pasteHint}
              onPaste={(e) => {
                const txt = e.clipboardData?.getData('text') || '';
                if (txt) {
                  e.preventDefault();
                  applyPastedUrl(txt);
                }
              }}
              onChange={(e) => {
                if (e.target.value.trim()) {
                  applyPastedUrl(e.target.value);
                }
              }}
              className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-blue-300 dark:border-blue-700 rounded-lg px-3 py-2 text-base text-slate-900 dark:text-white outline-none"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => {
                setShowPasteBox(false);
                setPasteHint('');
              }}
              className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {(resolvingQualities || resolvedTitle) && (
          <div className="mb-2 px-1 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
            {resolvingQualities && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            <span className="truncate font-medium">
              {resolvingQualities
                ? isRTL
                  ? 'جاري جلب الجودات المتاحة من الموقع...'
                  : 'Fetching available qualities...'
                : resolvedTitle}
            </span>
          </div>
        )}

        {/* Quality & Format ALWAYS in 1 single row on mobile without horizontal overflow */}
        <div className="grid grid-cols-2 gap-2 mt-3 w-full">
          <div className="flex items-center gap-1.5 min-w-0">
            <label className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">
              {t('Quality')}:
            </label>
            <select
              value={availableQualities.length > 0 ? `${quality}|${format}` : quality}
              onChange={(e) => {
                const val = e.target.value;
                if (val.includes('|')) {
                  const [q, f] = val.split('|') as [AvailableQualityOption['quality'], AvailableQualityOption['format']];
                  setQuality(q);
                  setFormat(f);
                } else {
                  setQuality(val as any);
                }
              }}
              className="w-full min-w-0 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-base md:text-sm text-slate-900 dark:text-white outline-none truncate"
            >
              {availableQualities.length > 0 ? (
                availableQualities.map((opt, i) => (
                  <option key={`${opt.quality}-${opt.format}-${i}`} value={`${opt.quality}|${opt.format}`}>
                    {opt.label}
                  </option>
                ))
              ) : (
                <option value={quality}>
                  {resolvingQualities
                    ? isRTL
                      ? 'جاري الفحص...'
                      : 'Checking...'
                    : isRTL
                    ? 'ضع الرابط أولاً'
                    : 'Paste link first'}
                </option>
              )}
            </select>
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <label className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">
              {isRTL ? 'الصيغة:' : 'Format:'}
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as any)}
              className="w-full min-w-0 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-base md:text-sm text-slate-900 dark:text-white outline-none truncate"
            >
              {availableQualities.length > 0 ? (
                Array.from(new Set<AvailableQualityOption['format']>(availableQualities.map((q) => q.format))).map((fmt) => (
                  <option key={fmt} value={fmt}>
                    {fmt.toUpperCase()}
                  </option>
                ))
              ) : (
                <>
                  <option value="mp4">MP4</option>
                  <option value="mp3">MP3</option>
                  <option value="m4a">M4A</option>
                  <option value="webm">WEBM</option>
                </>
              )}
            </select>
          </div>
        </div>

        {(downloadError || activeDownloadsCount > 0) && (
          <div className="mt-2.5 flex items-center justify-between gap-2 text-xs px-1">
            {downloadError ? (
              <span className="text-red-500 font-medium truncate">{downloadError}</span>
            ) : (
              <span className="text-blue-600 dark:text-blue-400 font-medium">
                {progress}% • {downloadedMB} MB • {speed} MB/s
              </span>
            )}
          </div>
        )}
      </div>

      {/* YouTube Playlist Panel */}
      {(playlistLoading || playlistError || playlistItems.length > 0) && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-purple-200 dark:border-purple-900/50 p-4 mb-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <ListVideo className="w-5 h-5 text-purple-500 shrink-0" />
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                {playlistLoading
                  ? isRTL
                    ? 'جاري جلب فيديوهات القائمة...'
                    : 'Loading playlist videos...'
                  : playlistTitle}
              </h3>
              {playlistItems.length > 0 && (
                <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full shrink-0">
                  {playlistItems.length}
                </span>
              )}
            </div>
            {playlistItems.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setPlaylistItems([]);
                  setPlaylistTitle('');
                }}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {playlistError && <p className="text-sm text-red-500">{playlistError}</p>}

          {playlistItems.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {playlistItems.map((item, idx) => (
                <div
                  key={item.id + idx}
                  className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900 rounded-xl p-2 border border-slate-200 dark:border-slate-700"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {item.thumbnail && (
                      <img
                        src={item.thumbnail}
                        alt=""
                        className="w-12 h-8 object-cover rounded shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-medium text-slate-900 dark:text-white truncate">
                        {item.title}
                      </p>
                      {item.duration && (
                        <span className="text-[10px] text-slate-500">{item.duration}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => enqueueAndStart(item.url, item.title)}
                    className="shrink-0 bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isRTL ? 'تحميل' : 'Get'}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Downloads Header with Videos / MP3 Filter */}
      <div className="flex justify-between items-center gap-2 mb-4 relative z-10 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg sm:text-xl font-bold flex items-center text-slate-900 dark:text-white">
            {t('Downloads')}
            <span className="bg-blue-100 text-blue-800 text-xs sm:text-sm font-medium mx-2 px-2 py-0.5 rounded-full dark:bg-blue-900 dark:text-blue-300">
              {filteredDownloads.length}
            </span>
          </h3>

          {/* Two choices next to Downloads: Videos or MP3 */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMediaFilter(mediaFilter === 'video' ? 'all' : 'video')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-semibold transition border flex items-center gap-1',
                mediaFilter === 'video'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              )}
            >
              <Video className="w-3.5 h-3.5" />
              <span>{isRTL ? 'فيديوهات' : 'Videos'}</span>
            </button>
            <button
              type="button"
              onClick={() => setMediaFilter(mediaFilter === 'mp3' ? 'all' : 'mp3')}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-semibold transition border flex items-center gap-1',
                mediaFilter === 'mp3'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              )}
            >
              <Music className="w-3.5 h-3.5" />
              <span>MP3</span>
            </button>
          </div>
        </div>

        <div className="relative">
          <select
            value={listSortMode}
            onChange={(e) => setListSortMode(e.target.value)}
            aria-label={t('List')}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 outline-none max-w-[140px] sm:max-w-[180px] truncate"
          >
            <optgroup label={t('List')}>
              <option value="files">{t('Files')}</option>
              <option value="folders">{t('Folders')}</option>
              <option value="hidden">{t('Show Hidden Items')}</option>
            </optgroup>
            <optgroup label={t('Sort Ascending')}>
              <option value="name">{t('Name')}</option>
              <option value="type">{t('Type')}</option>
              <option value="date_asc">{t('Date')}</option>
              <option value="size">{t('Size')}</option>
              <option value="tags">{t('Tags')}</option>
            </optgroup>
          </select>
        </div>
      </div>

      {/* Downloads List - Mobile 1-Row layout (Name + Start/Pause/Download + Delete) */}
      <div className="space-y-2.5 relative z-0">
        {filteredDownloads.map((dl) => (
          <div
            key={dl.id}
            className="bg-slate-100 dark:bg-slate-900 rounded-xl p-2.5 sm:p-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition border border-slate-200/70 dark:border-slate-800"
            onClick={() => handlePlayClick(dl)}
          >
            <div className="flex items-center justify-between gap-2 w-full min-w-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    dl.type === 'audio' || dl.format === 'mp3' || dl.format === 'm4a'
                      ? 'bg-emerald-500/20 text-emerald-500'
                      : 'bg-slate-700 text-blue-400'
                  )}
                >
                  {dl.type === 'audio' || dl.format === 'mp3' || dl.format === 'm4a' ? (
                    <Music className="w-4 h-4" />
                  ) : (
                    <Video className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 truncate"
                      title={dl.filename || dl.name}
                    >
                      {dl.filename || dl.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] sm:text-xs mt-0.5">
                    {dl.status === 'completed' && (
                      <span className="text-green-500 font-medium">{isRTL ? 'إكتمل' : 'Completed'}</span>
                    )}
                    {dl.status === 'paused' && (
                      <span className="text-yellow-500 font-medium">{isRTL ? 'متوقف' : 'Paused'}</span>
                    )}
                    {dl.status === 'failed' && (
                      <span className="text-red-500 font-medium">{isRTL ? 'فشل' : 'Failed'}</span>
                    )}
                    {dl.status === 'queued' && (
                      <span className="text-amber-500 font-medium">{isRTL ? 'في الإنتظار' : 'Queued'}</span>
                    )}
                    {dl.status === 'downloading' && (
                      <span className="text-blue-500 font-medium flex items-center gap-1">
                        <span>
                          {dl.totalBytes > 0
                            ? `${Math.min(100, Math.round((dl.downloadedBytes / dl.totalBytes) * 100))}%`
                            : `${(dl.downloadedBytes / 1024 / 1024).toFixed(1)} MB`}
                        </span>
                        {dl.segments && dl.segments > 1 && (
                          <span className="inline-flex items-center text-[10px] text-amber-500">
                            <Zap className="w-2.5 h-2.5" />
                            {dl.segments}x
                          </span>
                        )}
                      </span>
                    )}
                    <span className="text-slate-400 uppercase">{dl.format}</span>
                  </div>
                </div>
              </div>

              {/* Action buttons on the same single row: Pause/Start/Download + Delete */}
              <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                {dl.status === 'downloading' && (
                  <button
                    type="button"
                    onClick={() => pauseClientDownload(dl.id)}
                    className="p-2 text-yellow-600 bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:hover:bg-yellow-900/40 rounded-lg transition"
                    title={isRTL ? 'إيقاف مؤقت' : 'Pause'}
                  >
                    <Pause className="w-4 h-4" />
                  </button>
                )}
                {(dl.status === 'paused' || dl.status === 'queued' || dl.status === 'failed') && (
                  <button
                    type="button"
                    onClick={() => handleManualStartItem(dl)}
                    className="p-2 text-green-600 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40 rounded-lg transition"
                    title={isRTL ? 'بدء التحميل' : 'Start Download'}
                  >
                    <Play className="w-4 h-4" />
                  </button>
                )}
                {(dl.status === 'downloading' || dl.status === 'queued' || dl.status === 'paused') && (
                  <button
                    type="button"
                    onClick={() => cancelClientDownload(dl.id)}
                    className="hidden sm:inline-flex p-2 text-red-500 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition"
                    title={isRTL ? 'إلغاء' : 'Cancel'}
                  >
                    <StopCircle className="w-4 h-4" />
                  </button>
                )}
                {dl.status === 'completed' && (
                  <button
                    type="button"
                    onClick={() => void handleSaveFile(dl)}
                    className="p-2 text-blue-500 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 rounded-lg transition"
                    title={isRTL ? 'حفظ الملف' : 'Save File'}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteItem(dl)}
                  className="p-2 text-red-500 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition"
                  title={isRTL ? 'حذف' : 'Delete'}
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>

            {dl.status === 'downloading' && (
              <div className="mt-2">
                <div className="w-full bg-slate-300 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-200',
                      dl.type === 'audio' ? 'bg-emerald-500' : 'bg-blue-500'
                    )}
                    style={{
                      width: `${dl.totalBytes > 0 ? Math.min(100, (dl.downloadedBytes / dl.totalBytes) * 100) : 25}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>
                    {(dl.downloadedBytes / 1024 / 1024).toFixed(1)} /{' '}
                    {dl.totalBytes > 0 ? (dl.totalBytes / 1024 / 1024).toFixed(1) : '?'} MB
                  </span>
                  <span>{(dl.speedBytesPerSec / 1024 / 1024).toFixed(2)} MB/s</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Studio Media Player Modal */}
      {playingFile && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => setPlayingFile(null)}
            className="absolute top-4 right-4 rtl:left-4 rtl:right-auto text-white bg-white/20 p-2 rounded-full hover:bg-white/40 z-50 transition"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="w-full max-w-4xl aspect-video bg-black rounded-lg overflow-hidden relative shadow-2xl">
            {playingFile.type.startsWith('video') ? (
              <video src={playingFile.url} controls autoPlay playsInline className="w-full h-full" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full w-full bg-slate-900 p-8 space-y-6">
                <Music className="w-24 h-24 text-blue-500 animate-pulse" />
                {playingFile.name && (
                  <p className="text-white text-sm font-medium text-center truncate max-w-md">{playingFile.name}</p>
                )}
                <audio src={playingFile.url} controls autoPlay className="w-full max-w-md" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
