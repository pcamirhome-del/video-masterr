import React, { useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useAppStore } from '../store';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const language = useAppStore((s) => s.language);
  const isRTL = language === 'ar';
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs sm:text-sm font-semibold shadow-sm transition active:scale-95 whitespace-nowrap"
        title={isRTL ? 'تثبيت التطبيق على الهاتف' : 'Install App on Phone'}
      >
        <Smartphone className="w-4 h-4 shrink-0" />
        <span>{isRTL ? 'تثبيت' : 'Install'}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isRTL ? 'تثبيت التطبيق على الهاتف' : 'Install Downloader Master'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {isIOS ? (
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {isRTL ? (
                  <>
                    1. اضغط على زر <strong>المشاركة (Share)</strong> في شريط متصفح Safari.<br />
                    2. مرر للأسفل واضغط على <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
                  </>
                ) : (
                  <>
                    1. Tap the <strong>Share</strong> button in Safari toolbar.<br />
                    2. Scroll down and tap <strong>Add to Home Screen</strong>.
                  </>
                )}
              </p>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {isRTL ? (
                  <>
                    افتح قائمة المتصفح (⋮) ثم اختر <strong>تثبيت التطبيق</strong> أو <strong>الإضافة إلى الشاشة الرئيسية</strong>.
                  </>
                ) : (
                  <>
                    Open the browser menu (⋮) and select <strong>Install App</strong> or <strong>Add to Home Screen</strong>.
                  </>
                )}
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-4 w-full rounded-xl bg-blue-600 hover:bg-blue-700 py-2 text-sm font-semibold text-white transition"
            >
              {isRTL ? 'حسناً' : 'OK'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
