import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Builds the Pip contact sheet (scripts/brand/sheet) into the directory given by SHEET_OUT. Not part of the app build.
export default defineConfig({
  root: resolve(__dirname, 'sheet'),
  base: './',
  plugins: [react()],
  build: { outDir: process.env.SHEET_OUT ?? resolve(__dirname, '../../.sheet'), emptyOutDir: true },
})
