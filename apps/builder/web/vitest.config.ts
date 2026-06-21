import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Web unit tests (spec 011 T7–T10). The units under test are pure (diff parser, markdown renderer,
// wire mappers, phase table); jsdom is the environment so future component tests can render Preact
// without reconfiguring.
export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
