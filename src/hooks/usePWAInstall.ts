import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    deferredPrompt?: BeforeInstallPromptEvent | null;
  }
}

const BANNER_DISMISSED_KEY = 'mour_pwa_banner_dismissed';

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mq || iosStandalone);
}

function detectIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isAppleMobile = /iphone|ipad|ipod/.test(ua);
  const isIPadOS =
    window.navigator.platform === 'MacIntel' && (window.navigator.maxTouchPoints || 0) > 1;
  return isAppleMobile || isIPadOS;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.deferredPrompt || null : null,
  );
  const [isStandalone, setIsStandalone] = useState<boolean>(() => detectStandalone());
  const [justInstalled, setJustInstalled] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(() => detectIOS());
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(BANNER_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    setIsStandalone(detectStandalone());
    setIsIOS(detectIOS());
    if (window.deferredPrompt) {
      setDeferredPrompt(window.deferredPrompt);
    }

    const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => {
      setIsStandalone(detectStandalone());
    };
    mediaQuery?.addEventListener?.('change', onDisplayChange);

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.deferredPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const onPromptReady = () => {
      if (window.deferredPrompt) {
        setDeferredPrompt(window.deferredPrompt);
      }
    };

    const onAppInstalled = () => {
      window.deferredPrompt = null;
      setDeferredPrompt(null);
      setJustInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('mour-pwa-prompt-ready', onPromptReady);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      mediaQuery?.removeEventListener?.('change', onDisplayChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('mour-pwa-prompt-ready', onPromptReady);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const activePrompt = deferredPrompt || window.deferredPrompt;
    if (!activePrompt) return 'unavailable';

    try {
      await activePrompt.prompt();
      const { outcome } = await activePrompt.userChoice;
      if (outcome === 'accepted') {
        window.deferredPrompt = null;
        setDeferredPrompt(null);
        setJustInstalled(true);
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    }
  }, [deferredPrompt]);

  const dismissBanner = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(BANNER_DISMISSED_KEY, '1');
    } catch {
      // Ignore sandboxed storage restriction
    }
  }, []);

  return {
    isInstallable: Boolean(deferredPrompt || (typeof window !== 'undefined' && window.deferredPrompt)),
    isStandalone,
    isInstalled: isStandalone || justInstalled,
    justInstalled,
    isIOS,
    dismissed,
    dismissBanner,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}
