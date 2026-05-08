import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  root: '.',
  base: '/bytheword/',
  publicDir: false,
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'words/*wordcount.js', dest: 'words' },
        { src: 'fonts/*', dest: 'fonts' },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 8080,
    open: true,
  },
});
