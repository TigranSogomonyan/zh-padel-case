import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(rootDir, 'artifacts');
const html = await readFile(join(rootDir, 'index.html'));

await mkdir(outputDir, { recursive: true });

// Serve the exact deployed HTML without rebuilding or modifying it.
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname !== '/' && pathname !== '/index.html') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(html);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const origin = 'http://127.0.0.1:' + server.address().port;
const configurations = [
  {
    name: 'desktop',
    options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  },
  {
    name: 'mobile',
    options: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    },
  },
];

let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });

  for (const { name, options } of configurations) {
    const context = await browser.newContext({
      ...options,
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      const response = await page.goto(origin + '/', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      assert.equal(response?.status(), 200, name + ': page did not load');

      // Allow the software-rendered scene to initialize.
      await page.waitForTimeout(3000);

      const state = await page.evaluate(() => ({
        title: document.title,
        bodyTextLength: document.body?.innerText?.trim().length || 0,
        canvasCount: document.querySelectorAll('canvas').length,
        horizontalOverflowPx: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
      }));

      // Keep the checks independent of styling and unstable CSS selectors.
      assert.ok(state.title.trim(), name + ': empty document title');
      assert.ok(state.bodyTextLength > 40, name + ': page content is missing');
      assert.ok(state.canvasCount > 0, name + ': 3D canvas is missing');

      const screenshot = join(outputDir, 'zh-' + name + '.png');
      await page.screenshot({ path: screenshot, fullPage: true, timeout: 60_000 });

      assert.deepEqual(pageErrors, [], name + ': uncaught JavaScript errors');
      results.push({ viewport: name, ...state, screenshot });
      console.log(name + ': OK; canvas=' + state.canvasCount
        + ', horizontal overflow=' + state.horizontalOverflowPx + 'px');
    } finally {
      await context.close();
    }
  }

  await writeFile(
    join(outputDir, 'report.json'),
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n'
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
