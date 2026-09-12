import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: {target:'es2022',chunkSizeWarningLimit:1800}, server:{host:'127.0.0.1',port:5194,strictPort:true} });
