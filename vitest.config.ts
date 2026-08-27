import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests only — pure logic that runs without a DOM.
 *
 * Rendering and camera behaviour are verified against a real browser rather
 * than a simulated one; what belongs here is the logic where a silent mistake
 * is invisible in the interface, such as CSV escaping and cache invalidation.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
