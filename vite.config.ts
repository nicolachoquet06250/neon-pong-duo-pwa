import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  test: { include: ['**/*.test.ts'], environment: 'node' },
});
