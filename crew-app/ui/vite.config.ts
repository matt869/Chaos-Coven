import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Served by the game server at /daemonwatch/ once built.
  base: '/daemonwatch/',
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:4000' } },
  test: { environment: 'jsdom', include: ['test/**/*.test.tsx'] },
} as never);
