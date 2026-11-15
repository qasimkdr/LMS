import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/toast';

export const metadata: Metadata = {
  title: 'School Management System',
  description: 'School management and learning platform',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f63e0' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
