import type { Metadata, Viewport } from 'next';
import PwaInstallButton from '@/components/PwaInstallButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'Akash Enterprises | Workforce Portal',
  description: 'Workforce management and attendance portal for Akash Enterprises.',
  applicationName: 'Akash Attendance',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Akash Attendance',
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#123523',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaInstallButton />
      </body>
    </html>
  );
}
