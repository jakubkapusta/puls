import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Writes dist/sw.js: precaches every built file (minus unused font subsets) for offline play. */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'puls-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js' && !/(cyrillic|greek|vietnamese)/.test(f) && !/\.woff$/.test(f));
      const hash = createHash('sha1');
      for (const f of list.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 10);
      const sw = readFileSync('src/sw.template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(['./', ...list.map((f) => './' + f)]));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2020', assetsInlineLimit: 0 },
  plugins: [serviceWorker()],
});
