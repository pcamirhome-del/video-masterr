import { useEffect, useState } from 'react';
import { useAppStore } from '../store';

export interface RealStorageInfo {
  usedBytes: number;
  availableBytes: number;
  totalBytes: number;
  percentUsed: number;
  supported: boolean;
  loading: boolean;
}

export function formatStorageSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

export function useRealStorage(): RealStorageInfo {
  const downloadsLength = useAppStore((s) => s.downloads.length);
  const [info, setInfo] = useState<RealStorageInfo>({
    usedBytes: 0,
    availableBytes: 0,
    totalBytes: 0,
    percentUsed: 0,
    supported: typeof navigator !== 'undefined' && !!navigator.storage?.estimate,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    const readEstimate = async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          const usage = est.usage ?? 0;
          const quota = est.quota ?? 0;
          const available = Math.max(0, quota - usage);
          const percent = quota > 0 ? Math.min(100, Math.round((usage / quota) * 1000) / 10) : 0;
          if (active) {
            setInfo({
              usedBytes: usage,
              availableBytes: available,
              totalBytes: quota,
              percentUsed: percent,
              supported: true,
              loading: false,
            });
          }
        } else if (active) {
          setInfo((prev) => ({ ...prev, supported: false, loading: false }));
        }
      } catch {
        if (active) {
          setInfo((prev) => ({ ...prev, supported: false, loading: false }));
        }
      }
    };

    readEstimate();
    return () => {
      active = false;
    };
  }, [downloadsLength]);

  return info;
}
