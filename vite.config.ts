import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  // Two pages: the app at / and the recipe calorie calculator at /recipe-calories/, which shares the catalog and styles.
  build: { rollupOptions: { input: { main: 'index.html', recipe: 'recipe-calories/index.html' } } },
  test: { environment: 'jsdom' },
})
