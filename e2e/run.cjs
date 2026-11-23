/* End-to-end check against the production build (vite preview).
 * Usage: npm run build && npm run e2e   (needs Playwright + Chromium available) */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const FIX = path.join(__dirname, 'fixtures');
const URL = 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) failures++; };
const step = (s) => console.log('\n# ' + s);

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(URL); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

(async () => {
  if (!fs.existsSync(path.join(FIX, '01-tilted.jpg'))) throw new Error('run: python3 e2e/make_fixtures.py e2e/fixtures');
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    await waitServer();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: 'zh-CN' });
    // Use plain downloads instead of the native save picker.
    await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
    const remote = [];
    ctx.on('request', (r) => { if (!r.url().startsWith(URL) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) remote.push(r.url()); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

    step('first load + offline readiness');
    await page.goto(URL);
    await page.getByTestId('offline-badge').filter({ hasText: '离线可用' }).waitFor({ timeout: 15000 });
    ok(true, 'badge shows 离线可用 after precache check');
    await shot('01-empty-album');

    step('batch import 20 files incl. corrupt + HEIC');
    await page.click('nav >> text=扫描');
    const files = fs.readdirSync(FIX).filter((f) => !f.endsWith('.py')).sort().map((f) => path.join(FIX, f));
    ok(files.length === 20, `fixture count ${files.length}`);
    await page.getByTestId('file-input').setInputFiles(files);
    await page.locator('text=保存并继续').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('[data-testid=queue-title]')?.textContent.includes('20 待处理'), null, { timeout: 20000 }).catch(() => {});
    ok((await page.locator('[data-testid=queue-title]').innerText()).includes('20 待处理'), 'queue holds 20 items');
    await page.waitForTimeout(400);
    await shot('02-workbench');
    ok(await page.locator('text=未自动找到边缘').count() === 0, 'auto edge found on tilted 12 MP photo');

    const timings = [];
    const pendingCount = async () => {
      const el = page.locator('[data-testid=queue-title]');
      if (!(await el.count())) return 0;
      const m = (await el.innerText()).match(/(\d+) 待处理/);
      return m ? +m[1] : 0;
    };
    async function saveOne() {
      const t0 = Date.now();
      const before = await pendingCount();
      await page.click('text=保存并继续');
      await page.waitForFunction((n) => {
        const t = document.querySelector('[data-testid=queue-title]')?.textContent ?? '';
        const m = t.match(/(\d+) 待处理/);
        return !m || +m[1] < n;
      }, before, { timeout: 30000 });
      timings.push(Date.now() - t0);
    }
    await saveOne(); // 01-tilted
    // tag year on the next (exif6) before saving
    await page.locator('text=保存并继续').waitFor();
    await page.fill('input[aria-label="年份"]', '1988');
    await saveOne(); // 02-exif6
    await saveOne(); // 03-portrait.png
    // corrupt + heic should fail automatically and the editor moves on
    await page.locator('.queue li.failed').nth(1).waitFor({ timeout: 15000 });
    const failText = await page.locator('.queue li.failed').allInnerTexts();
    ok(failText.some((t) => t.includes('04-corrupt') && t.includes('损坏')), 'corrupt file marked failed with reason');
    ok(failText.some((t) => t.includes('HEIC')), 'HEIC file marked failed with HEIC guidance');
    await shot('03-queue-failures');
    await saveOne();
    await saveOne();

    step('kill & reopen mid-batch');
    const savedBefore = 5;
    await page.reload();
    await page.click('nav >> text=扫描');
    await page.locator('text=保存并继续').waitFor({ timeout: 20000 });
    const q = +(await page.locator('[data-testid=queue-title]').innerText()).match(/(\d+) 待处理/)[1] + 2; // + 2 failed
    ok(q === 20 - savedBefore, `queue resumes with ${q} remaining (expected ${20 - savedBefore})`);
    while ((await pendingCount()) > 0) { await page.locator('text=保存并继续').waitFor(); await saveOne(); }
    timings.sort((a, b) => a - b);
    console.log(`  save timings ms: p50=${timings[timings.length >> 1]} max=${timings[timings.length - 1]} (n=${timings.length}, desktop chromium)`);
    await page.click('nav >> text=相册');
    await page.locator('.grid li').first().waitFor();
    ok(await page.locator('.grid li').count() === 18, `album shows 18 photos (no duplicates)`);
    await shot('04-album');

    step('master orientation for EXIF 6');
    // find the photo with year 1988 (the exif6 one)
    await page.click('text=按年份');
    await page.click('text=1980 年代');
    await page.locator('.grid a').first().click();
    await page.click('text=文件信息');
    const info = await page.locator('details').innerText();
    const m = info.match(/扫描母版：(\d+) × (\d+)/);
    ok(m && +m[2] > +m[1], `EXIF-6 master is portrait (${m && m[1]}×${m && m[2]})`);
    const exifPhotoUrl = page.url();

    step('family tree: 3 generations, single parent, same names, cycle rejection');
    await page.click('nav >> text=家庭树');
    await page.click('button:has-text("从「我」开始")');
    const addRel = async (kind, name, extra = {}) => {
      await page.click(`.chip:has-text("＋ ${kind}")`);
      await page.fill('input[placeholder^="例如：外婆"]', name);
      if (extra.birth) await page.fill('input[placeholder="1950"]', extra.birth);
      await page.click('.sheet >> button:has-text("添加")');
      await page.locator('.sheet').waitFor({ state: 'detached' });
    };
    await addRel('父母', '妈妈');
    await addRel('兄弟姐妹', '妹妹');
    await addRel('子女', '小明', { birth: '2015' });
    await addRel('伴侣', '爱人');
    await page.click('.node:has-text("妈妈")');
    await addRel('父母', '外婆');
    await addRel('父母', '外公');
    await page.click('.node:has-text("外婆")');
    await addRel('伴侣', '外公', { birth: '1940' }); // second person also called 外公 (same name, different id)
    await page.click('.node:has-text("妈妈")');
    // cycle: make 小明 (grandchild) a parent of 妈妈
    await page.click('.chip:has-text("＋ 父母")');
    await page.click('.sheet >> text=选择已有人物');
    const opt = await page.locator('.sheet select option', { hasText: '小明' }).getAttribute('value');
    await page.selectOption('.sheet select', opt);
    await page.click('.sheet >> button:has-text("添加")');
    ok(await page.locator('.sheet [role=alert]').innerText().then((t) => t.includes('祖先')), 'ancestor cycle rejected');
    await page.click('.sheet >> [aria-label=关闭]');
    // add a few more to reach 10 people
    await page.click('.node:has-text("妈妈")');
    await addRel('伴侣', '爸爸');
    await page.click('text=添加家人'); await page.fill('input[placeholder^="例如：外婆"]', '表哥'); await page.click('.sheet >> text=保存');
    await page.locator('.sheet').waitFor({ state: 'detached' });
    const people = await page.locator('h2:has-text("全部人物")').innerText();
    ok(/全部人物（10）/.test(people), people);
    await page.click('.chip:has-text("我")');
    await shot('05-family');

    step('tag a group photo with 3 people');
    await page.goto(exifPhotoUrl);
    await page.click('text=＋ 添加或新增人物');
    for (const n of ['我', '妈妈', '外婆']) await page.click(`.sheet .chip:has-text("${n}") >> nth=0`);
    await page.click('.sheet >> text=完成');
    ok(await page.locator('.chip.static').count() === 3, 'photo has 3 people');
    await page.fill('input[placeholder="例如：小时候的合影"]', '小时候的合影');
    await page.keyboard.press('Enter');
    for (const n of ['我', '妈妈', '外婆']) {
      await page.goto(URL + '#/family');
      await page.click(`.chips .chip:has-text("${n}") >> nth=0`);
      const c = await page.locator('text=/\\d+ 张照片/').first().innerText();
      ok(c.startsWith('1'), `${n} card shows the shared photo (${c})`);
    }
    await shot('06-person-card');

    step('templates: story card export');
    await page.goto(exifPhotoUrl);
    await page.click('text=导出 JPEG');
    await page.click('.sheet >> text=故事卡');
    await page.locator('.tpl-preview img').waitFor();
    await shot('07-template');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sheet >> button.primary:has-text("导出 JPEG")')]);
    const jpg = fs.readFileSync(await dl.path());
    ok(jpg[0] === 0xff && jpg[1] === 0xd8 && /^jiaying-1988-story-.*\.jpg$/.test(dl.suggestedFilename()), `exported JPEG ${dl.suggestedFilename()}`);
    ok(!jpg.subarray(0, 4096).includes(Buffer.from('Exif')), 'export has no EXIF');
    await page.click('.sheet >> [aria-label=关闭]');

    step('delete person keeps photos');
    await page.goto(URL + '#/family');
    await page.click('.chips .chip:has-text("外婆") >> nth=0');
    await page.click('text=编辑资料');
    await page.click('.sheet >> text=删除人物');
    await page.click('.dialog button:has-text("删除人物")');
    await page.goto(exifPhotoUrl);
    await page.waitForTimeout(300);
    await shot('10-after-person-delete');
    ok(await page.locator('.chip.static').count() === 2, `tag removed, photo still opens (${await page.locator('.chip.static').count()})`);

    step('trash + restore');
    await page.click('button.danger-text:text-is("删除")');
    await page.click('.dialog button:has-text("移到回收站")');
    await page.waitForURL(/#\/album$/);
    await page.goto(URL + '#/trash');
    await page.locator('.trash-item').first().waitFor({ timeout: 5000 }).catch(() => {});
    await shot('11-trash');
    ok(await page.locator('.trash-item').count() === 1, 'photo in trash');
    await page.click('.trash-item >> text=恢复');
    await page.goto(URL + '#/album');
    await page.click('[role=tab]:has-text("全部")');
    ok(await page.locator('.grid li').count() === 18, 'restored from trash');

    step('backup export');
    await page.goto(URL + '?smallvolumes#/backup');
    await page.selectOption('select', String(1024 * 1024));
    await page.click('text=生成家庭档案备份');
    await page.locator('.vols li').first().waitFor();
    const nVols = await page.locator('.vols li').count();
    ok(nVols >= 3, `${nVols} volumes at 1 MB cap`);
    const backups = [];
    for (let i = 0; i < nVols; i++) {
      const [d] = await Promise.all([page.waitForEvent('download'), page.locator('.vols li').nth(i).locator('button:has-text("保存")').click()]);
      const p = path.join(OUT, d.suggestedFilename());
      await d.saveAs(p);
      backups.push(p);
      await page.locator('.vols li').nth(i).locator('text=我已确认存好').click();
    }
    ok(fs.statSync(backups[0]).size > 5e5, `backup size ${(fs.statSync(backups[0]).size / 1e6).toFixed(1)} MB`);
    await shot('08-backup');

    step('offline: airplane mode, close and reopen');
    await ctx.setOffline(true);
    await page.close();
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(URL).catch((e) => console.log('  goto offline:', e.message));
    await p2.waitForTimeout(1500);
    await p2.screenshot({ path: path.join(OUT, '12-offline.png') });
    await p2.locator('.grid li').first().waitFor({ timeout: 10000 });
    ok(await p2.locator('.grid li').count() === 18, 'app + archive open offline');
    // offline scan
    await p2.click('nav >> text=扫描');
    await p2.getByTestId('file-input').setInputFiles([path.join(FIX, '01-tilted.jpg')]);
    await p2.locator('text=保存并继续').click();
    await p2.locator('text=开始扫描').or(p2.locator('text=继续拍照')).waitFor();
    ok(true, 'scanned + saved while offline');

    step('restore: corrupted backup is rejected, archive untouched');
    const bad = Buffer.from(fs.readFileSync(backups[0]));
    bad[Math.floor(bad.length / 2)] ^= 0xff;
    const badPath = path.join(OUT, 'corrupted.zip');
    fs.writeFileSync(badPath, bad);
    await p2.goto(URL + '#/backup');
    await p2.getByTestId('restore-input').setInputFiles([badPath, ...backups.slice(1)]);
    await p2.locator('[data-testid=restore-summary], [role=alert]').first().waitFor();
    await p2.locator('label.check input').check().catch(() => {});
    if (await p2.locator('button:has-text("替换并恢复")').isEnabled()) {
      await p2.click('button:has-text("替换并恢复")');
      await p2.locator('[role=alert]').waitFor({ timeout: 30000 });
    }
    const alert = await p2.locator('[role=alert]').innerText();
    ok(/校验|CRC|损坏/.test(alert) && alert.includes('原档案未受影响'), 'corruption reported: ' + alert.slice(0, 80));
    await p2.goto(URL + '#/album');
    ok(await p2.locator('.grid li').count() === 19, 'original archive still has 19 photos');

    step('restore: missing volume / then full restore offline');
    await p2.goto(URL + '#/backup');
    await p2.getByTestId('restore-input').setInputFiles([backups[0]]);
    await p2.locator('[data-testid=restore-summary]').waitFor();
    ok((await p2.locator('[data-testid=restore-summary]').innerText()).includes('还缺少第 2'), 'missing volumes reported');
    ok(await p2.locator('button:has-text("替换并恢复")').isDisabled(), 'restore blocked while volumes missing');
    await p2.click('button:has-text("清空")');
    await p2.getByTestId('restore-input').setInputFiles(backups);
    await p2.locator('[data-testid=restore-summary]').waitFor();
    await shot.call(null, '09-restore-summary').catch(() => {});
    await p2.screenshot({ path: path.join(OUT, '09-restore-summary.png'), fullPage: true });
    const summary = await p2.locator('[data-testid=restore-summary]').innerText();
    ok(summary.includes('18') && summary.includes('9'), 'summary shows 18 photos, 9 persons');
    ok(await p2.locator('button:has-text("替换并恢复")').isDisabled(), 'replace requires explicit confirmation');
    await p2.locator('label.check input').check();
    await p2.click('button:has-text("替换并恢复")');
    await p2.waitForURL(/.*/, { timeout: 5000 }).catch(() => {});
    await p2.waitForLoadState('load');
    await p2.waitForTimeout(1500);
    await p2.goto(URL + '#/album');
    await p2.locator('.grid li').first().waitFor({ timeout: 20000 });
    ok(await p2.locator('.grid li').count() === 18, 'restored archive has 18 photos (offline-scanned one replaced)');
    await p2.goto(URL + '#/family');
    ok(/全部人物（9）/.test(await p2.locator('h2:has-text("全部人物")').innerText()), 'restored 9 persons');
    await p2.goto(exifPhotoUrl);
    ok(await p2.locator('.chip.static').count() === 2, 'restored tags');
    ok((await p2.locator('h1').innerText()).includes('小时候的合影'), 'restored title');
    const dbs = await p2.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    ok(dbs.filter((n) => n.startsWith('jiaying-archive-')).length === 1, `old archive removed (${dbs.join(', ')})`);

    step('privacy');
    ok(remote.length === 0, `no requests to other origins (${remote.length})`);
    ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
