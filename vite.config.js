import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: process.env.APP_BASE_PATH || '/', plugins: [react()], build: { sourcemap: false } });
