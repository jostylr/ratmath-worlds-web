import { test, expect } from '@playwright/test';
const worlds = ['mandelbulb', 'menger', 'hyperbolic-plane', 'hyperbolic-space', 'recursive-room', 'escher', 'babel', 'gallery', 'four-d', 'quaternion-julia', 'topology', 'eversion', 'attractors', 'mandelbrot', 'logistic', 'flatland', 'newton', 'henon', 'chaos-game', 'pendulum'];
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
  await page.getByRole('button', { name: 'Bookmark view', exact: true }).click();
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Menger sponge', exact: true })).toBeVisible();
});
