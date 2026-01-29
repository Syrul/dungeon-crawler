import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    allowedHosts: [
      'pale-collectors-diy-fastest.trycloudflare.com',
      'localhost',
      '127.0.0.1',
    ],
  },
});
