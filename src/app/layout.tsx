import type { Metadata, Viewport } from 'next';
import { Inter_Tight, Roboto_Mono } from 'next/font/google';
import '@/styles/globals.css';
import { AppShell } from '@/components/layout/AppShell';
import { ServiceWorkerRegistrar } from '@/components/layout/ServiceWorkerRegistrar';

/**
 * Typography.
 *
 * Inter Tight for interface hierarchy — a condensed grotesque that holds up at
 * the small sizes an instrumentation UI depends on. Roboto Mono for all
 * telemetry: identifiers, timestamps, coordinates and measurements. The split
 * is the core typographic rule of the system — if it is a number the machine
 * produced, it is monospace.
 *
 * `display: swap` so the shell renders immediately; the fallback stacks in
 * globals.css are metric-similar enough that the swap is not disruptive.
 */
const sans = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  display: 'swap',
  weight: ['400', '500', '600'],
});

const mono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-roboto-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'FLOCKRAFT',
  description:
    'Browser-based visual observation and memory system. Detect, track, describe and remember what the camera sees.',
  applicationName: 'FLOCKRAFT',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'FLOCKRAFT',
    // Black-translucent lets the camera feed run under the status bar when
    // installed to the home screen.
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false, address: false, email: false },
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  // An observation log is not something to be indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#07090a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // Zoom is left enabled: disabling it is an accessibility failure, and the
  // layout is built to tolerate it.
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only rounded-sm bg-tactical px-3 py-2 font-mono text-xs text-void focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
        >
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
