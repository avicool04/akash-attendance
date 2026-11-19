import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Akash Enterprises – Attendance',
  description: 'Employee attendance system with GPS and selfie verification',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
