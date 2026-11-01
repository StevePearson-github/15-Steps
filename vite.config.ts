import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built app also works when opened from a folder or wrapped for desktop.
  base: './',
  test: { include: ['tests/**/*.test.{ts,tsx}'] },
});
