import { defineConfig } from 'vitest/config';
import path from 'node:path';

/*
 * No @vitejs/plugin-react here on purpose: vitest 2.x bundles its own copy of
 * vite, which makes its plugin-option type incompatible with the top-level
 * vite. JSX/TSX transforms in tests are handled by esbuild via the `esbuild`
 * options below, which is enough for component rendering with @testing-library.
 * If we ever need Fast Refresh in a test (we don't), revisit.
 */

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['tests/unit/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    setupFiles: ['./tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx'],
    },
  },
});
