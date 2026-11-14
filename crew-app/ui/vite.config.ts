import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Standalone page, served by the game server at /daemonwatch/.
// The Crew dashboard bundle is built separately by vite.crew.config.ts.
export default defineConfig({
  base: '/daemonwatch/',
  plugins: [react()],
  build: { outDir: 'dist/standalone', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:4000' } },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
    // The Crew host provides the SDK at runtime; tests resolve it to a stand-in.
    alias: [
      { find: /^@kirocrew\/app-sdk\/ui$/, replacement: new URL('./test/sdk-ui-stub.ts', import.meta.url).pathname },
      { find: /^@kirocrew\/app-sdk$/, replacement: new URL('./test/sdk-stub.ts', import.meta.url).pathname },
    ],
  },
} as never);
