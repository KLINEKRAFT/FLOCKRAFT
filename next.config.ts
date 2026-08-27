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
  /**
   * Resolve Human to its browser build.
   *
   * The package's `exports` map lists a `node` condition first, so both the
   * server pass and the SSR pass resolve `human.node.js`, which `require`s the
   * native `@tensorflow/tfjs-node`. Its subpath keys are also written without
   * the leading `./` that the exports specification requires, so importing the
   * ESM file by path is not exported at all and silently fails to resolve.
   *
   * Aliasing the package is the one lever that fixes both: every import of it,
   * in every pass, lands on the browser bundle. Human is only ever loaded
   * inside a dynamic import from client code, so there is no server path that
   * legitimately wants the Node build.
   */
  turbopack: {
    resolveAlias: {
      // A filesystem path, not a package specifier: the specifier form would be
      // resolved through the same broken exports map this is working around.
      '@vladmandic/human': './node_modules/@vladmandic/human/dist/human.esm.js',
    },
  },
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
