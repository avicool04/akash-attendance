'use client';

import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function PwaInstallButton() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) {
      setInstalled(true);
      return;
    }
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setInstallEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) setVisible(true);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === 'accepted') setVisible(false);
      setInstallEvent(null);
      return;
    }
    setIosHelp(true);
  }

  if (installed || !visible) return null;

  return (
    <>
      <button
        type="button"
        onClick={install}
        aria-label="Install Akash Attendance app"
        style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 1000, display: 'inline-flex', alignItems: 'center', gap: 9, border: 0, borderRadius: 999, padding: '13px 18px', background: '#12271f', color: '#fff', fontWeight: 750, fontSize: 14, boxShadow: '0 8px 28px rgba(18,39,31,.25)', cursor: 'pointer' }}
      >
        <span aria-hidden="true">↓</span> Install app
      </button>
      {iosHelp && (
        <div role="dialog" aria-modal="true" aria-labelledby="pwa-help-title" onClick={() => setIosHelp(false)} style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(10,20,15,.55)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 360px)', background: '#fff', color: '#17231c', borderRadius: 18, padding: 22, boxShadow: '0 18px 60px rgba(0,0,0,.2)' }}>
            <h2 id="pwa-help-title" style={{ margin: '0 0 10px', fontSize: 19 }}>Install on your iPhone/iPad</h2>
            <p style={{ margin: '0 0 12px', lineHeight: 1.55 }}>Safari does not show an automatic install prompt. Tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>, and tap <strong>Add</strong>.</p>
            <button type="button" onClick={() => setIosHelp(false)} style={{ border: 0, borderRadius: 10, background: '#12271f', color: '#fff', padding: '10px 16px', fontWeight: 700 }}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}
