import React, { useState } from 'react';
import { useTranslation } from '../../i18n';
import { useAppStore, DownloadItem } from '../../store';
import {
  Folder,
  DownloadCloud,
  HardDrive,
  AlertCircle,
  Download,
  Trash,
  Play,
  Pause,
  Video,
  Music,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { useRealStorage, formatStorageSize } from '../../hooks/useRealStorage';
import {
  startClientDownload,
  pauseClientDownload,
  cancelClientDownload,
  deleteMediaBlob,
  resolvePlayableUrl,
  triggerBrowserSave,
} from '../../lib/downloadManager';

export default function DownloadsTab() {
  const { t } = useTranslation();
  const {
    downloadsFolder,
    setDownloadsFolder,
    autoDownload,
    setAutoDownload,
    concurrentDownloads,
    setConcurrentDownloads,
    speedLimit,
    setSpeedLimit,
    language,
    downloads,
    updateDownload,
    removeDownload,
  } = useAppStore();
  const isRTL = language === 'ar';
  const [showWarning, setShowWarning] = useState(false);
  const [pendingConcurrent, setPendingConcurrent] = useState(concurrentDownloads);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'video' | 'mp3'>('all');
  const [playingFile, setPlayingFile] = useState<{ url: string; type: string; name?: string } | null>(null);

  const storage = useRealStorage();

  const handleConcurrentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseInt(e.target.value);
    if (val > 2) {
      setPendingConcurrent(val);
      setShowWarning(true);
    } else {
      setConcurrentDownloads(val);
    }
  };

  const confirmConcurrentChange = () => {
    setConcurrentDownloads(pendingConcurrent);
    setShowWarning(false);
  };

  const usedGB = storage.usedBytes / (1024 * 1024 * 1024);
  const availableGB = storage.availableBytes / (1024 * 1024 * 1024);

  const storageData = [
    { name: t('Used'), value: Math.max(usedGB, 0.001), color: '#3b82f6' },
    { name: t('Available'), value: Math.max(availableGB, 0.001), color: '#e5e7eb' },
  ];

  const filteredDownloads = downloads.filter((dl) => {
    if (mediaFilter === 'video') {
      return dl.type !== 'audio' && dl.format !== 'mp3' && dl.format !== 'm4a';
    }
    if (mediaFilter === 'mp3') {
      return dl.type === 'audio' || dl.format === 'mp3' || dl.format === 'm4a';
    }
    return true;
  });

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

  const handleStartOrResume = (dl: DownloadItem) => {
    updateDownload(dl.id, { status: 'downloading', downloadedBytes: 0, errorMessage: undefined });
    void startClientDownload(dl);
  };

  const handleSaveFile = async (dl: DownloadItem) => {
    const fileUrl = await resolvePlayableUrl(dl);
    if (fileUrl) {
      triggerBrowserSave(fileUrl, dl.filename || `${dl.name}.${dl.format}`);
    }
  };

  return (
    <div className="max-w-2xl animate-fade-in pb-10 overflow-x-hidden">
      {/* Header with Videos / MP3 filter choices */}
      <div className="flex items-center justify-between gap-2 mb-6 flex-wrap">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('Downloads')}</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMediaFilter(mediaFilter === 'video' ? 'all' : 'video')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition border flex items-center gap-1',
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
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition border flex items-center gap-1',
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

      {/* Downloaded & Active Files List (1 single row on mobile: Name + Download/Start + Delete) */}
      {filteredDownloads.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-3 sm:p-4 mb-6 space-y-2">
          {filteredDownloads.map((dl) => (
            <div
              key={dl.id}
              onClick={() => handlePlayClick(dl)}
              className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900 rounded-xl p-2.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/60 transition"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {dl.type === 'audio' || dl.format === 'mp3' || dl.format === 'm4a' ? (
                  <Music className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <Video className="w-4 h-4 text-blue-500 shrink-0" />
                )}
                <span className="text-xs sm:text-sm font-medium text-slate-900 dark:text-white truncate">
                  {dl.filename || dl.name}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                {dl.status === 'downloading' && (
                  <button
                    type="button"
                    onClick={() => pauseClientDownload(dl.id)}
                    className="p-1.5 text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg"
                    title={isRTL ? 'إيقاف' : 'Pause'}
                  >
                    <Pause className="w-4 h-4" />
                  </button>
                )}
                {(dl.status === 'paused' || dl.status === 'queued' || dl.status === 'failed') && (
                  <button
                    type="button"
                    onClick={() => handleStartOrResume(dl)}
                    className="p-1.5 text-green-600 bg-green-50 dark:bg-green-900/20 rounded-lg"
                    title={isRTL ? 'تحميل' : 'Start'}
                  >
                    <Play className="w-4 h-4" />
                  </button>
                )}
                {dl.status === 'completed' && (
                  <button
                    type="button"
                    onClick={() => void handleSaveFile(dl)}
                    className="p-1.5 text-blue-500 bg-blue-50 dark:bg-blue-900/20 rounded-lg"
                    title={isRTL ? 'تنزيل' : 'Download'}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (dl.status === 'downloading' || dl.status === 'paused') {
                      cancelClientDownload(dl.id);
                    }
                    void deleteMediaBlob(dl.id);
                    removeDownload(dl.id);
                  }}
                  className="p-1.5 text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg"
                  title={isRTL ? 'حذف' : 'Delete'}
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-6">
        {/* Save Folder & Auto Download */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
          <div className="mb-6">
            <h3 className="text-lg font-semibold dark:text-white flex items-center mb-4">
              <Folder className={cn('w-5 h-5', isRTL ? 'ml-2' : 'mr-2')} />
              {t('Save Folder')}
            </h3>
            <button
              className="w-full flex justify-between items-center px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              onClick={async () => {
                if ('showDirectoryPicker' in window) {
                  try {
                    // @ts-ignore
                    const dirHandle = await window.showDirectoryPicker();
                    setDownloadsFolder(dirHandle.name);
                  } catch (err: any) {
                    console.error(err);
                    if (err.name === 'SecurityError' || (err.message && err.message.includes('sub frames'))) {
                      const folderName = prompt(
                        'Directory picker disabled in preview iframe. Enter a folder name to simulate selection:',
                        'My Downloads'
                      );
                      if (folderName) {
                        setDownloadsFolder(folderName);
                      }
                    } else if (err.name !== 'AbortError') {
                      alert('Could not open directory picker: ' + err.message);
                    }
                  }
                } else {
                  alert('Directory picker not supported in this preview environment. You can assume it opens standard dialog.');
                }
              }}
            >
              <span className="text-slate-700 dark:text-slate-300 truncate">
                {downloadsFolder === 'default'
                  ? isRTL
                    ? 'مجلد الفيديوهات والصوتيات (الافتراضي)'
                    : 'Device Video/Audio Folders (Default)'
                  : downloadsFolder}
              </span>
              <Folder className="w-5 h-5 text-slate-400 shrink-0" />
            </button>
          </div>

          <div className="flex justify-between items-center py-3 border-t border-slate-200 dark:border-slate-700">
            <span className="font-medium dark:text-white">{t('Start Download Automatically')}</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={autoDownload}
                onChange={(e) => setAutoDownload(e.target.checked)}
              />
              <div
                className={cn(
                  "w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600",
                  isRTL ? 'after:right-[2px] peer-checked:after:-translate-x-full' : 'after:left-[2px]'
                )}
              />
            </label>
          </div>
        </div>

        {/* Concurrent Downloads & Speed */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
          <div className="mb-6">
            <h3 className="text-lg font-semibold dark:text-white flex items-center mb-4">
              <DownloadCloud className={cn('w-5 h-5', isRTL ? 'ml-2' : 'mr-2')} />
              {t('Concurrent Downloads')}
            </h3>
            <select
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-3"
              value={showWarning ? pendingConcurrent : concurrentDownloads}
              onChange={handleConcurrentChange}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                <option key={num} value={num}>
                  {num}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-2">
            <h3 className="text-lg font-semibold dark:text-white mb-4">{t('Speed Limit')}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { val: 'unlimited', label: t('Unlimited') },
                { val: '256000', label: '256 KB/s' },
                { val: '512000', label: '512 KB/s' },
                { val: '1048576', label: '1 MB/s' },
                { val: '2097152', label: '2 MB/s' },
                { val: '5242880', label: '5 MB/s' },
                { val: '10485760', label: '10 MB/s' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => setSpeedLimit(opt.val)}
                  className={cn(
                    'px-4 py-2 text-sm rounded-xl border font-medium transition-colors',
                    speedLimit === opt.val
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Real Device Storage Info */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 flex items-center flex-col sm:flex-row">
          <div className="flex-1 w-full mb-6 sm:mb-0">
            <h3 className="text-lg font-semibold dark:text-white flex items-center mb-2">
              <HardDrive className={cn('w-5 h-5', isRTL ? 'ml-2' : 'mr-2')} />
              {t('Storage Info')}
            </h3>
            {storage.supported ? (
              <div className="flex flex-col space-y-2 mt-4">
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-slate-600 dark:text-slate-400">
                    {t('Used')}:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {formatStorageSize(storage.usedBytes)}
                    </strong>
                  </span>
                </div>
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <div className="w-3 h-3 rounded-full bg-slate-200 dark:bg-slate-600" />
                  <span className="text-slate-600 dark:text-slate-400">
                    {t('Available')}:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {formatStorageSize(storage.availableBytes)}
                    </strong>
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {isRTL ? 'الإجمالي المتاح للتطبيق:' : 'Total Quota:'}{' '}
                  {formatStorageSize(storage.totalBytes)}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 mt-3">
                {isRTL ? 'معلومات التخزين الفعلية غير مدعومة في هذا المتصفح' : 'Device storage API unavailable in this browser'}
              </p>
            )}
          </div>
          <div className="w-48 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={storageData}
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {storageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Concurrent warning modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 max-w-sm w-full shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-500 mb-4 mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-center mb-2 dark:text-white">{t('Concurrent Warning')}</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-6">{t('Concurrent Warning')}</p>
            <div className="flex space-x-3 rtl:space-x-reverse">
              <button
                onClick={() => {
                  setShowWarning(false);
                  setPendingConcurrent(concurrentDownloads);
                }}
                className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                No
              </button>
              <button
                onClick={confirmConcurrentChange}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
              >
                {t('OK')}
              </button>
            </div>
          </div>
        </div>
      )}

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
