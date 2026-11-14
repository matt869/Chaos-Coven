import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Crew page: an ES library at dist/index.mjs whose default export is the page.
// The host provides React, the SDK and lucide-react, so they stay external.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/crew/index.tsx', formats: ['es'], fileName: () => 'index.mjs' },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react', /^@kirocrew\/app-sdk/],
    },
  },
});
