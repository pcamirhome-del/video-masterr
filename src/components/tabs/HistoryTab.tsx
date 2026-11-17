import React, { useState } from 'react';
import { useTranslation } from '../../i18n';
import { useAppStore, DownloadItem } from '../../store';
import { FileDown, Calendar, Trash2, X, Music } from 'lucide-react';
import { cn } from '../../lib/utils';
import { resolvePlayableUrl } from '../../lib/downloadManager';

export default function HistoryTab() {
  const { t } = useTranslation();
  const { downloads, clearHistory, language } = useAppStore();
  const isRTL = language === 'ar';
  const [playingFile, setPlayingFile] = useState<{ url: string; type: string; name?: string } | null>(null);

  const exportCSV = () => {
    const BOM = '\uFEFF';
    const header = 'Name,URL,Type,Format,Quality,Status,Date\n';
    const rows = downloads
      .map((d) => {
        const date = new Date(d.dateAdded).toLocaleString(isRTL ? 'ar-EG' : 'en-US');
        return `"${d.filename || d.name}","${d.url}","${d.type}","${d.format}","${d.quality}","${d.status}","${date}"`;
      })
      .join('\n');

    const csvContent = BOM + header + rows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'downloads_history.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  return (
    <div className="animate-fade-in relative max-w-4xl pb-10 overflow-x-hidden">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('History')}</h2>

        <div className="flex gap-2">
          {downloads.length > 0 && (
            <>
              <button
                onClick={clearHistory}
                className="flex items-center px-4 py-2 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition text-sm"
              >
                <Trash2 className={cn('w-4 h-4', isRTL ? 'ml-2' : 'mr-2')} />
                {isRTL ? 'مسح السجل' : 'Clear History'}
              </button>
              <button
                onClick={exportCSV}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
              >
                <FileDown className={cn('w-4 h-4', isRTL ? 'ml-2' : 'mr-2')} />
                {t('Export CSV')}
              </button>
            </>
          )}
        </div>
      </div>

      {downloads.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-12 text-center text-slate-500">
          <Calendar className="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-600" />
          <p>{isRTL ? 'لا توجد تنزيلات سابقة' : 'No previous downloads'}</p>
        </div>
      ) : (
        <>
          {/* Mobile View: ONLY Name, URL, and Date in ONE single row without horizontal scroll */}
          <div className="md:hidden bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-3 py-2.5 text-[11px] font-bold uppercase text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
              <div className="col-span-5 truncate">{t('Name')}</div>
              <div className="col-span-4 truncate">{isRTL ? 'الرابط' : 'URL'}</div>
              <div className="col-span-3 text-end truncate">{t('Date')}</div>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {downloads.map((d) => (
                <div
                  key={d.id}
                  onClick={() => handlePlayClick(d)}
                  className="grid grid-cols-12 gap-2 px-3 py-3 items-center text-xs hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                >
                  <div
                    className="col-span-5 font-medium text-slate-900 dark:text-white truncate"
                    title={d.filename || d.name}
                  >
                    {d.filename || d.name}
                  </div>
                  <div
                    className="col-span-4 text-slate-500 dark:text-slate-400 truncate"
                    dir="ltr"
                    title={d.url}
                  >
                    {d.url}
                  </div>
                  <div className="col-span-3 text-slate-500 dark:text-slate-400 text-[10px] text-end whitespace-nowrap">
                    {new Date(d.dateAdded).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Desktop View: Full table */}
          <div className="hidden md:block bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left rtl:text-right text-slate-500 dark:text-slate-400">
                <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                  <tr>
                    <th scope="col" className="px-6 py-3">{t('Name')}</th>
                    <th scope="col" className="px-6 py-3">URL</th>
                    <th scope="col" className="px-6 py-3">{t('Status')}</th>
                    <th scope="col" className="px-6 py-3">{t('Type')}</th>
                    <th scope="col" className="px-6 py-3">{t('Date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {downloads.map((d) => (
                    <tr
                      key={d.id}
                      className="bg-white border-b dark:bg-slate-800 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                      onClick={() => handlePlayClick(d)}
                    >
                      <td
                        className="px-6 py-4 font-medium text-slate-900 whitespace-nowrap dark:text-white max-w-[200px] truncate"
                        title={d.filename || d.name}
                      >
                        {d.filename || d.name}
                      </td>
                      <td className="px-6 py-4 max-w-[200px] truncate" title={d.url}>
                        {d.url}
                      </td>
                      <td className="px-6 py-4">{d.status.toUpperCase()}</td>
                      <td className="px-6 py-4">
                        <span className="bg-blue-100 text-blue-800 text-xs font-medium mr-2 rtl:ml-2 rtl:mr-0 px-2.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300">
                          {d.format.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {new Date(d.dateAdded).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {playingFile && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
          <button
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
