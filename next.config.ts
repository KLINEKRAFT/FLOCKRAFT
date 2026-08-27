import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * The camera and geolocation Permissions-Policy must allow `self` — FLOCKRAFT is
 * fundamentally a camera application and a restrictive default would silently
 * break `getUserMedia` on some browsers. Everything else is denied.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The service worker must never be cached, or clients pin an old shell.
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
