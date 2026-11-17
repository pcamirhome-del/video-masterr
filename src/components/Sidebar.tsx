import React from 'react';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import {
  Link,
  Download,
  History,
  ShieldCheck,
  Settings,
  Bell,
  Palette,
  Wifi,
  Info,
} from 'lucide-react';
import { useAppStore } from '../store';
import { useRealStorage, formatStorageSize } from '../hooks/useRealStorage';

interface SidebarProps {
  isOpen: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ isOpen, activeTab, setActiveTab }: SidebarProps) {
  const { t } = useTranslation();
  const { language } = useAppStore();
  const storage = useRealStorage();

  const isRTL = language === 'ar';

  const menuItems = [
    { id: 'links', label: t('Links'), icon: Link },
    { id: 'downloads', label: t('Downloads'), icon: Download },
    { id: 'history', label: t('History'), icon: History },
    { id: 'security', label: t('Security'), icon: ShieldCheck },
    { id: 'general', label: t('General'), icon: Settings },
    { id: 'notifications', label: t('Notifications'), icon: Bell },
    { id: 'appearance', label: t('Appearance'), icon: Palette },
    { id: 'connection', label: t('Connection Test'), icon: Wifi },
    { id: 'about', label: t('About'), icon: Info },
  ];

  return (
    <div
      className={cn(
        'fixed md:absolute top-0 w-[280px] h-[100dvh] bg-slate-50 dark:bg-slate-800 border-l md:border-r dark:border-slate-700 shadow-xl z-30 transition-transform duration-300 ease-in-out font-sans flex flex-col p-4',
        // On mobile: ALWAYS on the right side
        'right-0',
        isRTL ? 'md:right-0 md:left-auto' : 'md:left-0 md:right-auto',
        isOpen
          ? 'translate-x-0'
          : 'translate-x-full md:translate-x-0'
      )}
      onClick={(e) => e.stopPropagation()}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="mb-4 flex items-center justify-center md:justify-start shrink-0">
        <div className="bg-blue-500 rounded-xl p-2 mr-3 rtl:ml-3 rtl:mr-0">
          <Download className="text-white w-6 h-6" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">D-Master</h1>
      </div>

      {/* Scrollable area with visible vertical scrollbar so all menu & storage items are reachable */}
      <div className="flex-1 min-h-0 sidebar-scroll pr-1 rtl:pl-1 rtl:pr-0">
        <ul className="space-y-1.5">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <button
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    'w-full flex items-center px-4 py-2.5 rounded-xl text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-blue-500 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-900'
                  )}
                >
                  <Icon
                    className={cn(
                      'w-5 h-5 shrink-0',
                      isRTL ? 'ml-3' : 'mr-3',
                      isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'
                    )}
                  />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 bg-blue-600 text-white p-3.5 rounded-xl text-xs space-y-1.5">
          <div className="flex items-center gap-2 mb-1 text-sm">
            <span className="text-base">☁️🚫</span>
            <b>{t('Security Note')}</b>
          </div>
          <p className="opacity-90 leading-relaxed font-medium">
            {t('Storage Note')}. {t('Privacy Note')}.
          </p>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-700 pb-4">
          <div className="flex justify-between text-[11px] mb-1 font-medium text-slate-700 dark:text-slate-300">
            <span>{t('Storage Info')}</span>
            <span>{storage.supported ? `${storage.percentUsed}%` : '--'}</span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden my-2">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${Math.max(storage.percentUsed, storage.usedBytes > 0 ? 2 : 0)}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">
            {storage.supported ? (
              <>
                {t('Used')}: {formatStorageSize(storage.usedBytes)} | {t('Available')}:{' '}
                {formatStorageSize(storage.availableBytes)}
              </>
            ) : (
              <span>{isRTL ? 'غير متاح في هذا المتصفح' : 'Unavailable'}</span>
            )}
          </div>
          <div className="text-[11px] mt-3 text-slate-500 dark:text-slate-400 leading-snug">
            {t('Greetings')}
            <br />
            {t('Made in Egypt')} 🇪🇬 v2.5.0
          </div>
        </div>
      </div>
    </div>
  );
}
