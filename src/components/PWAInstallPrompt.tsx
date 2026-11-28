import React, { useState } from 'react';
import { CheckCircle2, Download, PlusSquare, Share, WifiOff, X } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall.ts';

function InstallInstructionsModal({
  isAr,
  isIOS,
  onClose,
}: {
  isAr: boolean;
  isIOS: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[#0D131F] border border-[#D4AF37]/40 p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/icon-192.png"
              alt="MouriTrading"
              className="w-10 h-10 rounded-xl object-cover shrink-0 border border-[#D4AF37]/40"
            />
            <div>
              <h3 className="text-sm font-bold text-[#F8FAFC]">
                {isIOS
                  ? isAr
                    ? 'تثبيت MouriTrading على آيفون'
                    : 'Install MouriTrading on iOS'
                  : isAr
                    ? 'تثبيت تطبيق MouriTrading'
                    : 'Install MouriTrading App'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isAr
                  ? 'يعمل كتطبيق مستقل على الشاشة الرئيسية'
                  : 'Standalone app without browser toolbar'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isIOS ? (
          <ol className="space-y-2.5 text-xs text-slate-200 leading-relaxed">
            <li className="flex items-start gap-2.5 p-3 rounded-xl bg-[#070A0F] border border-white/8">
              <Share className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
              <span>
                {isAr
                  ? '1. اضغط على زر المشاركة (مربع وبداخله سهم للأعلى) في شريط السفاري.'
                  : '1. Tap the Share button (square with upward arrow) in the Safari bar.'}
              </span>
            </li>
            <li className="flex items-start gap-2.5 p-3 rounded-xl bg-[#070A0F] border border-white/8">
              <PlusSquare className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
              <span>
                {isAr
                  ? '2. اختر "إضافة إلى الصفحة الرئيسية" (Add to Home Screen).'
                  : '2. Choose "Add to Home Screen".'}
              </span>
            </li>
          </ol>
        ) : (
          <div className="rounded-xl bg-[#070A0F] border border-white/8 p-3.5 text-xs text-slate-200 leading-relaxed">
            {isAr
              ? 'افتح قائمة المتصفح (⋮) ← اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية".'
              : 'Open your browser menu (⋮) → select "Install app" or "Add to Home screen".'}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[42px] rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] text-xs font-bold cursor-pointer"
        >
          {isAr ? 'إغلاق' : 'Close'}
        </button>
      </div>
    </div>
  );
}

export function PWAInstallBanner() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const {
    isStandalone,
    justInstalled,
    isIOS,
    dismissed,
    dismissBanner,
    install,
  } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // Never show banner if already launched as an installed standalone PWA
  if (isStandalone || (dismissed && !justInstalled)) {
    return null;
  }

  const handleInstallClick = async () => {
    if (justInstalled) return;
    if (isIOS) {
      setShowGuide(true);
      return;
    }
    const result = await install();
    if (result === 'unavailable') {
      setShowGuide(true);
    }
  };

  return (
    <>
      <div className="bg-[#0D131F] border-b border-[#D4AF37]/25 px-4 lg:px-6 py-2.5">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/icon-192.png"
              alt="MouriTrading"
              className="w-9 h-9 rounded-xl object-cover shrink-0 border border-[#D4AF37]/40"
            />
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#F8FAFC] truncate">
                {justInstalled
                  ? isAr
                    ? 'تم تثبيت تطبيق MouriTrading بنجاح'
                    : 'MouriTrading Installed Successfully'
                  : isAr
                    ? 'تثبيت تطبيق MouriTrading'
                    : 'Install MouriTrading App'}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {justInstalled
                  ? isAr
                    ? 'يمكنك فتح التطبيق الآن مباشرة من شاشتك الرئيسية'
                    : 'Launch directly from your home screen'
                  : isAr
                    ? 'تجربة مستقلة سريعة بدون شريط المتصفح'
                    : 'Fast standalone experience without browser bar'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={justInstalled}
              onClick={handleInstallClick}
              className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                justInstalled
                  ? 'bg-[#10B981]/20 border border-[#10B981]/40 text-[#10B981] cursor-default'
                  : 'bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] cursor-pointer'
              }`}
            >
              {justInstalled ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isAr ? 'مثبّت' : 'Installed'}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تثبيت التطبيق' : 'Install App'}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={dismissBanner}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 cursor-pointer"
              aria-label={isAr ? 'إغلاق' : 'Dismiss'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {showGuide && (
        <InstallInstructionsModal
          isAr={isAr}
          isIOS={isIOS}
          onClose={() => setShowGuide(false)}
        />
      )}
    </>
  );
}

export function PWAProfileInstallCard() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const { isStandalone, justInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isStandalone) {
    return null;
  }

  const handleInstall = async () => {
    if (justInstalled) return;
    if (isIOS) {
      setShowGuide(true);
      return;
    }
    const result = await install();
    if (result === 'unavailable') {
      setShowGuide(true);
    }
  };

  return (
    <>
      <div className="bg-[#0D131F] border border-[#D4AF37]/30 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <img
            src="/icon-192.png"
            alt="MouriTrading"
            className="w-10 h-10 rounded-xl object-cover shrink-0 border border-[#D4AF37]/40"
          />
          <div className="space-y-0.5">
            <h2 className="text-sm font-bold text-[#F8FAFC]">
              {isAr ? 'تثبيت التطبيق على الهاتف' : 'Install App on Phone'}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {justInstalled
                ? isAr
                  ? 'تم تثبيت MouriTrading على جهازك كتطبيق مستقل.'
                  : 'MouriTrading is installed on your device.'
                : isAr
                  ? 'ثبّت MouriTrading بضغطة واحدة ليعمل كتطبيق مستقل على Android و iOS بدون شريط المتصفح.'
                  : 'Install MouriTrading in one tap to run standalone on Android & iOS without the browser bar.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={justInstalled}
          onClick={handleInstall}
          className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shrink-0 transition-colors ${
            justInstalled
              ? 'bg-[#10B981]/20 border border-[#10B981]/40 text-[#10B981] cursor-default'
              : 'bg-[#D4AF37] hover:bg-[#E5C158] text-[#070A0F] cursor-pointer'
          }`}
        >
          {justInstalled ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>{isAr ? 'مثبّت' : 'Installed'}</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>{isAr ? 'تثبيت التطبيق' : 'Install App'}</span>
            </>
          )}
        </button>
      </div>

      {showGuide && (
        <InstallInstructionsModal
          isAr={isAr}
          isIOS={isIOS}
          onClose={() => setShowGuide(false)}
        />
      )}
    </>
  );
}

export function OfflineIndicator() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-16 lg:bottom-4 start-4 z-50 flex items-center gap-2 rounded-xl bg-[#0D131F] border border-[#D4AF37]/45 px-3 py-2 text-xs font-medium text-[#E5C158] shadow-xl">
      <WifiOff className="w-3.5 h-3.5 text-[#D4AF37]" />
      <span>
        {isAr ? 'وضع عدم الاتصال — يتم استخدام الملفات المخزنة مؤقتاً' : 'Offline Mode — Cached shell active'}
      </span>
    </div>
  );
}
