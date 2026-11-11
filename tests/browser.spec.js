import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
// Every world page there is: all the HTML files but the two library pages.
const worlds = readdirSync(new URL('..', import.meta.url)).filter(name => name.endsWith('.html'))
  .map(name => name.slice(0, -5)).filter(name => name !== 'index' && name !== 'flat');
async function ready(page) {
  await expect(page.locator('#view')).toHaveAttribute('data-graphics', 'ready');
  await expect(page.locator('#controls .site-tools')).toBeAttached();
  await expect(page.locator('#graphics-status')).toHaveCount(0);
  await expect(page.locator('#error').first()).toBeHidden();
}
for (const world of worlds) {
  test(`${world}: draws, starts a tour, and leaves it without errors`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/${world}.html`);
    await ready(page);
    await expect.poll(() => page.locator('#view').evaluate(canvas => canvas.width)).toBeGreaterThan(300);
    await page.getByRole('button', { name: 'Guided tour' }).first().click();
    await expect(page.locator('#tourCard')).toBeVisible();
    await page.getByRole('button', { name: 'End tour', exact: true }).click();
    await expect(page.locator('#tourCard')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('Mandelbulb keeps edited parameters and rejects fractional tour arguments', async ({ page }) => {
  await page.goto('/mandelbulb.html?tourStep=0.5'); await ready(page);
  await page.getByLabel('Power', { exact: true }).press('End');
  await expect(page).toHaveURL(/#scene=/);
  await page.reload(); await ready(page);
  await expect(page.getByLabel('Power', { exact: true })).toHaveValue('12');
  await expect(page.locator('#tourCard')).toBeHidden();
});

test('phone books start in original layout and Reader mode wraps and scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/babel.html#borges:0:1.1.1.1'); await ready(page);
  await expect(page.locator('#reader')).not.toHaveClass(/reading/);
  const text = await page.locator('#page').textContent();
  await page.getByRole('button', { name: 'Reader mode', exact: true }).click();
  await expect(page.locator('#reader')).toHaveClass(/reading/);
  expect(await page.locator('#page').textContent()).toBe(text);
  expect(await page.locator('#page').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(17);
  expect(await page.locator('#cover').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('#pageLabel')).toHaveText('page 2 of 410');
  await expect(page.locator('#reader')).toHaveClass(/reading/);
  await expect(page).toHaveURL(/\.2~/);
  await page.reload(); await ready(page);
  await expect(page.locator('#reader')).not.toHaveClass(/reading/);
  await expect(page.locator('#pageLabel')).toHaveText('page 2 of 410');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('empty Babel shelf disables page changes', async ({ page }) => {
  await page.goto('/babel.html#a2.p2.l1.c1:1:1.1.1.1'); await ready(page);
  await expect(page.locator('#page')).toContainText('No book stands here');
  for (const id of ['previous', 'next', 'pageSlider', 'readerMode']) { await expect(page.locator('#' + id)).toBeDisabled(); }
});

test('shared zoom wins over launch arguments in Babel and gallery', async ({ page }) => {
  for (const [world, address, zoom] of [['babel', 'borges:0~0,1,0,0,0.65', '1.5×'], ['gallery', 'gallery:0,0,9~0,1,0,0,0.35', '2.9×']]) {
    await page.goto(`/${world}.html?tourStep=2#${address}`); await ready(page);
    await expect(page.locator('#tourCard')).toBeHidden();
    await expect(page.locator('#zoomValue')).toHaveText(zoom);
    await expect(page).not.toHaveURL(/tourStep/);
    await page.reload(); await ready(page);
    await expect(page.locator('#zoomValue')).toHaveText(zoom);
  }
});

test('formula diagnostics and keyboard movement work', async ({ page }) => {
  await page.goto('/gallery.html#gallery:0,0,9~0,1,0,0,1'); await ready(page);
  await page.getByLabel('Formula', { exact: true }).fill('+');
  await expect(page.locator('#formulaStatus')).toContainText('needs 2 values');
  await expect(page.locator('#formula')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Formula', { exact: true }).fill('xy*4*s');
  await expect(page.locator('#formula')).toHaveAttribute('aria-invalid', 'false');
  await expect(page).toHaveURL(/1\.0000$/);
  const before = page.url();
  await page.getByRole('button', { name: 'Forward', exact: true }).press('Enter');
  await expect(page).not.toHaveURL(before);
});

for (const world of ['menger', 'mandelbulb', 'babel', 'gallery', 'eversion']) {
  test(`${world}: restores a real WebGL context`, async ({ page }) => {
    await page.goto(`/${world}.html`); await ready(page);
    await page.evaluate(() => {
      window.lossTest = document.querySelector('#view').getContext('webgl2').getExtension('WEBGL_lose_context');
      window.lossTest.loseContext();
    });
    await expect(page.locator('#graphics-status')).toContainText('interrupted');
    await expect(page.locator('#view')).toHaveAttribute('data-graphics', 'interrupted');
    await page.evaluate(() => window.lossTest.restoreContext());
    await ready(page);
  });
}

test('bookmarks retain a view in this browser', async ({ page }) => {
  await page.goto('/menger.html'); await ready(page);
  await page.getByRole('button', { name: 'Explore on my own', exact: true }).click();
  await page.getByRole('button', { name: 'Bookmark view', exact: true }).click();
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Menger sponge', exact: true })).toBeVisible();
});

test('Mandelbrot ride moves by itself, pauses for a drag, and ends cleanly', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mandelbrot.html'); await ready(page);
  // The welcome card offers the ride on arrival.
  await page.locator('#welcomeRide').click();
  await expect(page.locator('#tourCard')).toBeVisible();
  await expect(page.locator('#rideCaption')).not.toBeEmpty();
  await expect.poll(() => page.locator('#rideZoom').textContent()).not.toBe('1.00×');
  const view = page.locator('#view');
  const box = await view.boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7 + 40, box.y + 140, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#ridePause')).toHaveText('▶ Carry on');
  await page.locator('#ridePause').click();
  await expect(page.locator('#ridePause')).toHaveText('⏸ Pause');
  await page.getByRole('button', { name: 'End ride', exact: true }).click();
  await expect(page.locator('#tourCard')).toBeHidden();
  await expect(page.locator('#ridePill')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a world greets a visitor, rides to a sight, and a double click dives without choosing', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mandelbrot.html'); await ready(page);
  await expect(page.locator('#tourCard')).toContainText('Welcome');
  await expect(page.locator('#controls')).toBeHidden();
  await page.locator('[data-sight="4"]').click();
  await expect(page.locator('#tourCard')).toContainText('Ride · 5 of');
  await page.getByRole('button', { name: 'End ride', exact: true }).click();
  await expect(page.locator('#sightsPill')).toBeVisible();
  // A link to a place opens it as it is, with no greeting.
  await page.goto('/mandelbrot.html?plain'); await ready(page);
  await expect(page.locator('#tourCard')).toBeHidden();
  const view = await page.locator('#view').boundingBox();
  await page.mouse.dblclick(view.x + view.width * 0.3, view.y + view.height * 0.3);
  await expect(page).toHaveURL(/#v=/);
  // The dive moved the centre and left c (values 3 and 4) at its defaults.
  const values = decodeURIComponent(new URL(page.url()).hash).match(/v=([^&]*)/)[1].split(',').map(Number);
  expect(values[3] ?? -0.12).toBeCloseTo(-0.12, 6);
  expect(values[4] ?? 0.75).toBeCloseTo(0.75, 6);
  expect(errors).toEqual([]);
});

test('a knot opened fully relaxed catches up by itself', async ({ page }) => {
  await page.goto('/knots.html#v=2,1'); await ready(page);
  const crossings = page.locator('.readout', { hasText: 'Crossings seen' }).locator('.value');
  await expect(crossings).toHaveText('3');
  // Relaxing takes 3,000 steps, a few hundred to a frame, and the picture
  // must keep going until they are done: afterwards, prodding it by changing
  // the colouring and back finds nothing left to do.
  await page.waitForTimeout(1500);
  const settled = await page.locator('#view').screenshot();
  await page.locator('#palette').selectOption('1');
  await page.locator('#palette').selectOption('0');
  await page.waitForTimeout(500);
  expect(Buffer.compare(settled, await page.locator('#view').screenshot())).toBe(0);
});

test('the Mandelbrot explorer follows a tapped number and works a step out', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mandelbrot.html?plain'); await ready(page);
  await page.locator('#explorerPill').click();
  await expect(page.locator('#explorer')).toBeVisible();
  // The explorer starts on c, which is in the bulb of three.
  await expect(page.locator('#explorerReport .verdict-title')).toHaveText('Stays: settles into a cycle of 3');
  // A number far outside escapes at once, and its row shows the squaring.
  await page.getByLabel('real value', { exact: true }).fill('1.2');
  await page.getByLabel('real value', { exact: true }).press('Tab');
  await expect(page.locator('#explorerReport .verdict-title')).toContainText('Escapes at step');
  await page.locator('#explorerReport [data-row="1"]').click();
  await expect(page.locator('#explorerReport')).toContainText('Step 1, worked');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('real value', { exact: true })).not.toHaveValue('1.2000');
  await page.getByRole('button', { name: 'Close explorer', exact: true }).click();
  await expect(page.locator('#explorer')).toBeHidden();
  await expect(page.locator('#explorerPill')).toBeVisible();
  expect(errors).toEqual([]);
});

// Every world with an explorer: it opens, gives a verdict, and closes.
for (const world of ['logistic', 'newton', 'newton-lab', 'henon', 'chaos-game', 'pendulum', 'penrose', 'apollonian', 'flatland',
  'menger', 'attractors', 'recursive-room', 'lorentz', 'knots', 'geodesics', 'spherical-space', 'escher', 'topology', 'eversion']) {
  test(`${world}: the explorer opens with a verdict and closes`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/${world}.html?plain`); await ready(page);
    await page.locator('#explorerPill').click();
    await expect(page.locator('#explorerReport .verdict-title')).not.toBeEmpty();
    const box = await page.locator('#view').boundingBox();
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.6);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#explorerReport .verdict-title')).not.toBeEmpty();
    await page.getByRole('button', { name: 'Close explorer', exact: true }).click();
    await expect(page.locator('#explorer')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
