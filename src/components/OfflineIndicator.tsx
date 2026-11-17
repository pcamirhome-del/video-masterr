import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useAppStore } from '../store';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const language = useAppStore((s) => s.language);
  const isRTL = language === 'ar';

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      {isRTL ? 'وضع عدم الاتصال — يتم استخدام البيانات المحفوظة' : 'Offline Mode — Cached data is being used.'}
    </div>
  );
};
