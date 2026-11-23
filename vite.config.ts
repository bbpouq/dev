import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Generates dist/sw.js after the build: precaches every file in dist (the whole
 * app shell, templates, image algorithms and runtime) under a content-hashed version.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'jiaying-sw',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const n of readdirSync(d)) {
          const p = join(d, n);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js').sort();
      const h = createHash('sha256');
      for (const f of list) { h.update(f); h.update(readFileSync(join(outDir, f))); }
      const version = h.digest('hex').slice(0, 12);
      const urls = ['./', ...list.map((f) => './' + f)];
      const tpl = readFileSync('src/sw-template.js', 'utf8');
      writeFileSync(join(outDir, 'sw.js'),
        tpl.replace('__VERSION__', version).replace('[/*__PRECACHE__*/]', JSON.stringify(urls)));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), serviceWorker()],
  build: { target: 'es2020', assetsInlineLimit: 0, sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
