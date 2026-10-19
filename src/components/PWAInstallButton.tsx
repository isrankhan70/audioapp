import React, { useState } from 'react';
import { Smartphone, X, Share, PlusSquare, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  lang: 'en' | 'bn';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ lang }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>{lang === 'bn' ? 'App Installed' : 'App Installed'}</span>
      </span>
    );
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuideModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        aria-label="Install Mobile App"
        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Smartphone className="w-4 h-4 text-amber-400 shrink-0" />
        <span>{lang === 'bn' ? 'Install App' : 'Install App'}</span>
      </button>

      {showGuideModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#111722] border border-slate-700 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Smartphone className="w-5 h-5" />
                </div>
                <h3
                  id="pwa-install-title"
                  className="text-base font-bold text-slate-100 font-display"
                >
                  {lang === 'bn'
                    ? 'Mobile App Hisebe Install Korun'
                    : 'Install SpliceLab Mobile App'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="Close install guide"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {lang === 'bn'
                ? 'SpliceLab-ke apnar phone-er Home Screen-e native mobile app hisebe add korun. Offline-eo 100% lossless audio merge korte parben:'
                : 'Add SpliceLab directly to your phone Home Screen as a standalone mobile app with full offline audio merging:'}
            </p>

            <div className="space-y-3 text-xs text-slate-200 bg-[#090D14] border border-slate-800 rounded-xl p-4">
              {isIOS ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <Share className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      1. Safari browser-er niche <strong>Share</strong> icon-e
                      tap korun.
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <PlusSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      2. Scroll kore <strong>Add to Home Screen</strong>-e tap
                      korun.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2.5">
                    <span className="font-mono font-bold text-amber-400">
                      01.
                    </span>
                    <span>
                      {lang === 'bn'
                        ? 'Android Chrome-er upore ডানপাশে 3-dot menu (⋮) অথবা Address bar-এর Install icon-এ ট্যাপ করুন।'
                        : 'Tap the browser menu (⋮) in Chrome or Safari and select "Install App" or "Add to Home Screen".'}
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="font-mono font-bold text-emerald-400">
                      02.
                    </span>
                    <span>
                      {lang === 'bn'
                        ? 'iPhone Safari-তে নিচের Share বাটনে ট্যাপ করে "Add to Home Screen" সিলেক্ট করুন।'
                        : 'Once added, launch SpliceLab anytime from your home screen with full-screen native touch controls.'}
                    </span>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors cursor-pointer"
            >
              {lang === 'bn' ? 'Bujhte Perechi (Got It)' : 'Got It'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
