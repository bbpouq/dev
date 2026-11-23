/* Restores e2e/out/big-500.zip (python3 e2e/make_big_backup.py e2e/out/big-500.zip 500)
 * into an empty archive, then measures album first-screen time. Run after npm run build. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const URL = 'http://localhost:4173/';
(async () => {
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  try {
    await p.goto(URL + '#/backup');
    await p.getByTestId('restore-input').setInputFiles(path.join(__dirname, 'out', 'big-500.zip'));
    await p.locator('[data-testid=restore-summary]').waitFor({ timeout: 60000 });
    console.log((await p.locator('[data-testid=restore-summary]').innerText()).split('\n').slice(0, 3).join(' | '));
    const t0 = Date.now();
    await p.click('button:has-text("开始恢复")');
    await p.waitForFunction(() => !document.querySelector('[data-testid=restore-summary]'), null, { timeout: 600000 });
    console.log(`restore 500 photos: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await p.waitForTimeout(1000);
    const counts = await p.evaluate(async () => {
      const dbs = (await indexedDB.databases()).filter((d) => d.name.startsWith('jiaying-archive-'));
      const db = await new Promise((r) => { const q = indexedDB.open(dbs[0].name); q.onsuccess = () => r(q.result); });
      const c = (s) => new Promise((r) => { const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => r(q.result); });
      return { archives: dbs.length, photos: await c('photos'), assets: await c('assets'), tags: await c('photoPersons') };
    });
    console.log('db', JSON.stringify(counts));
    for (let i = 0; i < 3; i++) {
      const t1 = Date.now();
      await p.goto(URL + '?r=' + i + '#/album');
      await p.locator('.grid li img').first().waitFor({ timeout: 20000 });
      const ready = Date.now() - t1;
      const imgs = await p.locator('.grid li img').count();
      console.log(`album first screen with thumbnails: ${ready} ms (grid items ${await p.locator('.grid li').count()}, decoded imgs ${imgs})`);
    }
  } finally { await b.close(); server.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
