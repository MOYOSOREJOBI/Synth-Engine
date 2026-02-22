import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'fs';

// Serve worklet + WASM from workspace packages during dev
function serveWorkspaceAssets(): Plugin {
  const assets: Record<string, { path: string; mime: string }> = {
    '/worklet/processor.js': {
      path: resolve(__dirname, '../../packages/worklet/dist/processor.js'),
      mime: 'application/javascript',
    },
    '/wasm/pulsesynth.wasm': {
      path: resolve(__dirname, '../../packages/wasm-dsp/dist/pulsesynth.wasm'),
      mime: 'application/wasm',
    },
  };

  return {
    name: 'serve-workspace-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const asset = assets[req.url ?? ''];
        if (asset && existsSync(asset.path)) {
          res.setHeader('Content-Type', asset.mime);
          res.end(readFileSync(asset.path));
          return;
        }
        next();
      });
    },
  };
}

// Copy workspace assets to public/ before build
function copyAssetsForBuild(): Plugin {
  return {
    name: 'copy-workspace-assets',
    buildStart() {
      const copies = [
        {
          src: resolve(__dirname, '../../packages/worklet/dist/processor.js'),
          dest: resolve(__dirname, 'public/worklet/processor.js'),
        },
        {
          src: resolve(__dirname, '../../packages/wasm-dsp/dist/pulsesynth.wasm'),
          dest: resolve(__dirname, 'public/wasm/pulsesynth.wasm'),
        },
      ];
      for (const { src, dest } of copies) {
        if (existsSync(src)) {
          mkdirSync(resolve(dest, '..'), { recursive: true });
          copyFileSync(src, dest);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [serveWorkspaceAssets(), copyAssetsForBuild()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2022',
  },
});
