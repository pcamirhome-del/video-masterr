import React, { useState, useEffect } from 'react';
import { useAppStore } from './store';
import { cn } from './lib/utils';
import Sidebar from './components/Sidebar';
import MainArea from './components/MainArea';
import { OfflineIndicator } from './components/OfflineIndicator';
import { Menu } from 'lucide-react';
import { io } from 'socket.io-client';

export const socket = io('/', { autoConnect: false });

export default function App() {
  const { theme, language, dynamicColors } = useAppStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('links');

  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark', 'glass-theme');

    let isDark = false;
    if (theme === 'auto') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(isDark ? 'dark' : 'light');
    } else {
      isDark = theme === 'dark';
      root.classList.add(theme);
    }

    if (isDark && dynamicColors) {
      root.classList.add('glass-theme');
    }
  }, [theme, dynamicColors]);

  return (
    <div className="flex h-[100dvh] w-full max-w-[100vw] bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-50 overflow-hidden overflow-x-hidden font-sans relative">
      {/* Mobile Backdrop Overlay - closes sidebar when clicked outside */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-20 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile header with menu button always on the right */}
      <div
        dir="ltr"
        className="md:hidden fixed top-0 left-0 right-0 w-full h-16 flex items-center justify-between px-4 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 z-10"
      >
        <h1 className="font-bold text-lg text-slate-900 dark:text-white truncate">
          Downloader Master
        </h1>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          aria-label="Toggle Menu"
        >
          <Menu className="w-6 h-6 text-slate-600 dark:text-slate-300" />
        </button>
      </div>

      <Sidebar
        isOpen={sidebarOpen}
        activeTab={activeTab}
        setActiveTab={(t) => {
          setActiveTab(t);
          setSidebarOpen(false);
        }}
      />

      <div
        className={cn(
          'flex-1 h-full overflow-y-auto overflow-x-hidden transition-all duration-300 pt-16 md:pt-0 w-full',
          language === 'ar' ? 'md:mr-[280px]' : 'md:ml-[280px]'
        )}
      >
        <MainArea activeTab={activeTab} />
      </div>

      <OfflineIndicator />
    </div>
  );
}
