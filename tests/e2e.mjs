import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSessionServer } from '../server/server.ts';
import { cookingPlans } from '../src/shared.ts';

// Two isolated storage/permission contexts stand in for two devices. No real camera is used.
const app = await createSessionServer({ port: 0 });
await app.listen();
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'chrome', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [], unexpected = [], bodies = [], checks = [];
const adultContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const childContext = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
const adult = await adultContext.newPage(), child = await childContext.newPage();
for (const page of [adult, child]) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => {
    if (!req.url().startsWith(base + '/')) unexpected.push(req.url());
    if (req.method() === 'POST') bodies.push(req.postDataJSON());
  });
}
await child.addInitScript(() => {
  Math.random = () => .5; // Fall in the middle, so actual collision and result transport are deterministic.
  navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic camera denial', 'NotAllowedError'); };
});
const click = (page, action) => page.locator(`[data-action="${action}"]`).click();
const visible = (page, text) => page.getByText(text, { exact: false }).first().waitFor();
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
const screenshot = (page, name) => page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
const layout = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'horizontal overflow');
await mkdir('test-results', { recursive: true });
try {
  await Promise.all([adult.goto(base), child.goto(base)]);
  await screenshot(adult, '01-adult-entry'); await layout(adult);
  await click(adult, 'entry-adult'); await click(adult, 'create');
  const code = (await adult.locator('.pair-code').innerText()).trim();
  assert.match(code, /^\d{6}$/);
  assert.equal(await adult.locator('[data-action="start-demo"]').isDisabled(), true);
  await click(child, 'entry-child');
  await child.locator('#room-code').fill(code); await child.locator('#join-form button').click();
  await visible(child, 'つながったよ'); await visible(adult, 'つながりました');
  check('pairing across independent phone/tablet contexts; start blocked before pairing');
  await click(adult, 'start-demo'); await child.locator('[data-game="start"]').click();
  await visible(adult, 'どんな食材が');
  await child.locator('[data-game="pause"]').click(); await visible(adult, 'ひとやすみ');
  await child.locator('[data-game="resume"]').click();
  await childContext.setOffline(true); await visible(child, '再接続しています');
  await child.locator('.game-overlay').waitFor();
  assert.equal(await child.locator('.game-overlay h2').innerText(), 'ひとやすみ');
  await childContext.setOffline(false); await visible(child, 'つながっています');
  await visible(adult, 'ひとやすみ');
  await child.locator('[data-game="resume"]').click();
  check('pause status, connection-loss pause and automatic reconnect without remounting the game');
  await screenshot(child, '02-child-game'); await layout(child);
  await adult.getByText('今日、気になった食材。', { exact: true }).waitFor({ timeout: 50000 });
  await visible(child, 'どのごはんに');
  const counts = await adult.locator('.food-choice small').allTextContents();
  assert.ok(counts.some(text => !text.startsWith('0こ')), 'real canvas catch reaches adult');
  check('30-second game, real catches and result sharing; child waits for adult');
  await screenshot(adult, '03-adult-review');
  const selected = adult.locator('[data-select="egg"]');
  await selected.setChecked(!await selected.isChecked());
  await adult.waitForFunction(() => !document.querySelector('[data-select="egg"]').disabled);
  const selectedValue = await adult.locator('[data-select="egg"]').isChecked();
  await adult.reload(); await adult.locator('[data-select="egg"]').waitFor();
  assert.equal(await adult.locator('[data-select="egg"]').isChecked(), selectedValue);
  check('adult selection adjustment and reload restore the same server state');
  await click(adult, 'recipes');
  await adult.locator('.recipe-details summary').first().click();
  await adult.locator('[data-action="choose-recipe"]').first().click();
  await adult.locator('.step-list').waitFor();
  const firstId = await adult.locator('[data-action="activate-step"]').first().getAttribute('data-step');
  const recipeId = firstId.slice(0, firstId.lastIndexOf('-'));
  await visible(child, 'つぎのおてつだい');
  for (const step of cookingPlans[recipeId]) {
    await adult.locator(`[data-action="activate-step"][data-step="${step.id}"]`).click();
    if (step.role === 'child') {
      await child.getByRole('heading', { name: step.title, exact: true }).waitFor();
      assert.equal(await adult.locator('[data-action="complete-step"]').count(), 0, 'cannot confirm before child reports');
      await screenshot(adult, '04-adult-supervise'); await screenshot(child, '05-child-task');
      await layout(adult); await layout(child);
      await child.setViewportSize({ width: 1180, height: 820 }); await layout(child);
      await screenshot(child, '06-child-landscape');
      await child.setViewportSize({ width: 820, height: 1180 });
      if (step === cookingPlans[recipeId].find(s => s.role === 'child')) {
        await childContext.setOffline(true); await visible(child, '再接続しています');
        assert.equal(await child.locator('[data-action="child-done"]').isDisabled(), true);
        await childContext.setOffline(false); await visible(child, 'つながっています');
        await child.reload(); await child.getByRole('heading', { name: step.title, exact: true }).waitFor();
      }
      await click(child, 'child-done'); await visible(child, 'できたを送ったよ');
      await adult.locator(`[data-action="complete-step"][data-step="${step.id}"]`).waitFor();
    }
    await adult.locator(`[data-action="complete-step"][data-step="${step.id}"]`).click();
  }
  await visible(adult, 'ふたりで、できました'); await visible(child, 'いっしょに、できたね');
  check('all adult/child steps, prerequisites, report then confirmation, reconnect and reload during cooking, both completion screens');
  await screenshot(adult, '07-adult-complete'); await screenshot(child, '08-child-complete');
  await click(adult, 'back-review');
  await adult.locator('.replay-options summary').click(); await click(adult, 'start-camera');
  await child.locator('[data-game="prepare-camera"]').click();
  await visible(child, 'カメラが許可されていません');
  assert.equal(await child.locator('[data-game="start"]').isDisabled(), true);
  check('local MediaPipe initialization and synthetic camera denial; real camera never opened');
  await click(adult, 'cancel-game'); await visible(child, 'つながったよ');
  await click(adult, 'start-demo'); await child.locator('[data-game="start"]').click();
  await childContext.setOffline(true); await visible(child, '再接続しています');
  await child.locator('[data-game="finish"]').click();
  await visible(child, '送れませんでした');
  await childContext.setOffline(false); await visible(child, 'つながっています');
  await child.locator('[data-game="retry-result"]').click();
  await visible(adult, '今日、気になった食材');
  await child.reload(); await visible(child, 'どのごはんに');
  check('camera cancellation, mode switch, early zero-catch finish, failed result retry and child reload');
  adult.once('dialog', dialog => dialog.accept()); await click(adult, 'close');
  await visible(child, '部屋は終了しました'); await click(child, 'leave');
  await visible(child, '今日のごはんを');
  check('adult room close propagates to child and permits a new session');
  assert.deepEqual(errors, [], 'browser runtime errors'); assert.deepEqual(unexpected, [], 'external app requests');
  for (const body of bodies) assert.ok(!/video|image|landmark|skeleton|data:|base64/i.test(JSON.stringify(body)), 'camera data in payload');
  check('no runtime errors, external requests, camera frames or landmark uploads in observed app traffic');
  await writeFile('test-results/e2e-report.json', JSON.stringify({ passed: checks.length, checks, browser: 'Chromium (installed Chrome)', viewports: ['390x844', '820x1180', '1180x820'], realDevices: false, realCamera: false, externalRequests: unexpected.length, runtimeErrors: errors.length }, null, 2));
} finally {
  await browser.close(); app.server.closeAllConnections();
  await new Promise(resolve => app.server.close(resolve));
}
