import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Akash Enterprises | Workforce Portal',
  description: 'Workforce management and attendance portal for Akash Enterprises.',
  applicationName: 'Akash Attendance',
};

export const viewport: Viewport = {
  themeColor: '#12271f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
