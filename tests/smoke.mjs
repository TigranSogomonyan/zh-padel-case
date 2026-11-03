import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(rootDir, 'artifacts');
const html = await readFile(join(rootDir, process.env.ZH_HTML || 'index.html'));

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
  ...[390, 375, 320].map((width) => ({
    name: 'mobile-' + width,
    options: {
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    },
  })),
];

let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}) });

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

      const state = await page.evaluate(() => {
        const visibleText = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const accessibleName = (el) => {
          const labelledBy = (el.getAttribute('aria-labelledby') || '')
            .split(/\s+/).filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent?.trim() || '').join(' ').trim();
          const explicitLabel = el.labels && Array.from(el.labels).map(visibleText).join(' ').trim();
          return el.getAttribute('aria-label') || labelledBy || explicitLabel ||
            (el.tagName === 'INPUT' && el.type === 'submit' ? el.value : '') ||
            visibleText(el) || el.getAttribute('title') || '';
        };
        const inputs = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')];
        const buttons = [...document.querySelectorAll('button, [role="button"]')];
        const images = [...document.querySelectorAll('img')];
        return {
          title: document.title,
          language: document.documentElement.lang,
          viewportMeta: document.querySelector('meta[name="viewport"]')?.content || null,
          bodyTextLength: document.body?.innerText?.trim().length || 0,
          canvasCount: document.querySelectorAll('canvas').length,
          horizontalOverflowPx: Math.max(
            0,
            document.documentElement.scrollWidth - document.documentElement.clientWidth
          ),
          headings: [...document.querySelectorAll('h1,h2,h3')].map((el) => ({
            level: el.tagName.toLowerCase(), text: visibleText(el)
          })).slice(0, 30),
          controls: {
            buttons: buttons.map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), text: visibleText(el), name: accessibleName(el) })).slice(0, 50),
            fields: inputs.map((el) => ({
              tag: el.tagName.toLowerCase(), type: el.type || null,
              name: accessibleName(el), placeholder: el.getAttribute('placeholder')
            })).slice(0, 40)
          },
          accessibilityAudit: {
            missingLanguage: !document.documentElement.lang,
            missingViewportMeta: !document.querySelector('meta[name="viewport"]'),
            unlabeledButtons: buttons.filter((el) => !accessibleName(el)).length,
            unlabeledFields: inputs.filter((el) => !accessibleName(el)).length,
            imagesWithoutAlt: images.filter((el) => !el.hasAttribute('alt')).length,
            smallTouchTargets: buttons.filter((el) => {
              const rect = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' &&
                rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
            }).slice(0, 30).map((el) => {
              const rect = el.getBoundingClientRect();
              return { name: accessibleName(el), width: Math.round(rect.width),
                height: Math.round(rect.height) };
            })
          }
        };
      });

      // Keep the checks independent of styling and unstable CSS selectors.
      assert.ok(state.title.trim(), name + ': empty document title');
      assert.ok(state.bodyTextLength > 40, name + ': page content is missing');
      assert.ok(state.canvasCount > 0, name + ': 3D canvas is missing');
      assert.ok(state.horizontalOverflowPx <= 1, name + ': horizontal overflow of '
        + state.horizontalOverflowPx + 'px');

      const screenshot = join(outputDir, 'zh-' + name + '.png');
      await page.screenshot({ path: screenshot, fullPage: true, timeout: 60_000 });

      // Verify that choosing a different leather colour changes the actual
      // rendered canvas, not just the selected swatch. The configured HTML
      // must provide a button accessible by its leather colour name.
      const canvas = page.locator('canvas').first();
      const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');
      const beforeColour = checksum(await canvas.screenshot());
      await page.getByRole('button', { name: 'Burgundy', exact: true }).click();
      await page.waitForTimeout(1500);
      const afterColour = checksum(await canvas.screenshot());
      assert.notEqual(beforeColour, afterColour,
        name + ': selecting Burgundy did not change the 3D canvas');
      await page.screenshot({
        path: join(outputDir, 'zh-' + name + '-burgundy.png'),
        fullPage: true,
        timeout: 60_000
      });
      console.log(name + ': leather colour change updated the 3D canvas');

      // Initials and camera switches should also affect the actual render.
      const beforeInitials = checksum(await canvas.screenshot());
      await page.locator('input[placeholder="AB"]').fill('ZH');
      await page.waitForTimeout(1000);
      const afterInitials = checksum(await canvas.screenshot());
      assert.notEqual(beforeInitials, afterInitials,
        name + ': changing initials did not change the 3D canvas');
      console.log(name + ': changing initials updated the 3D canvas');

      const beforeCamera = checksum(await canvas.screenshot());
      const backActivated = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('button, [role="button"]')];
        const back = controls.find((el) =>
          (el.innerText || el.textContent || '').trim().toLowerCase() === 'back'
        );
        if (!back) return false;
        back.click();
        return true;
      });
      assert.ok(backActivated, name + ': Back camera control was not found');
      await page.waitForTimeout(1200);
      const afterCamera = checksum(await canvas.screenshot());
      assert.notEqual(beforeCamera, afterCamera,
        name + ': selecting Back did not change the 3D canvas');
      await page.screenshot({
        path: join(outputDir, 'zh-' + name + '-back.png'),
        fullPage: true,
        timeout: 60_000
      });
      console.log(name + ': camera switch updated the 3D canvas');

      if (process.env.ZH_STAGE1) {
        assert.equal(state.accessibilityAudit.unlabeledFields, 0);
        assert.equal(state.accessibilityAudit.unlabeledButtons, 0);
        const targets = await page.locator('.sw, .views button').evaluateAll(elements => elements.map(el => {
          const r = el.getBoundingClientRect();
          return {name: el.getAttribute('aria-label') || el.textContent, x:r.x,y:r.y,w:r.width,h:r.height};
        }));
        if (options.isMobile) {
          for (const r of targets) assert.ok(r.w >= 44 && r.h >= 44, JSON.stringify(r));
          for (let i=0;i<targets.length;i++) for(let j=i+1;j<targets.length;j++) {
            const a=targets[i],b=targets[j];
            assert.ok(a.x+a.w<=b.x+.1 || b.x+b.w<=a.x+.1 || a.y+a.h<=b.y+.1 || b.y+b.h<=a.y+.1, 'Overlapping targets');
          }
          await page.locator('.order-jump').click();
          assert.equal(await page.locator('#orderTitle').evaluate(el => el===document.activeElement),true);
        }
        for (const label of ['Across','Along']) {
          const range=page.getByRole('slider',{name:label,exact:true});
          await range.focus();
          const previous=await range.inputValue();
          await page.keyboard.press('ArrowRight');
          assert.notEqual(await range.inputValue(),previous);
          assert.equal(await range.evaluate(el => getComputedStyle(el).outlineStyle),'solid');
        }
        const aqua=page.getByRole('button',{name:'Aqua',exact:true});
        await aqua.focus(); await page.keyboard.press('Enter');
        assert.equal(await aqua.getAttribute('aria-pressed'),'true');
        await page.getByRole('button',{name:'Burgundy',exact:true}).click();
        const downloadPromise=page.waitForEvent('download');
        await page.getByRole('button',{name:'Save preview',exact:true}).click();
        const download=await downloadPromise;
        const pngPath=join(outputDir,'preview-'+name+'.png');
        await download.saveAs(pngPath);
        const png=await readFile(pngPath);
        assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
        assert.ok(png.length>1000);
        await context.grantPermissions(['clipboard-read','clipboard-write']);
        await page.getByRole('button',{name:'Copy configuration',exact:true}).click();
        assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/leather: Burgundy/);
        assert.match(await page.locator('#ordStatus').innerText(),/Copying does not send a request/);
        await page.screenshot({path:join(outputDir,'zh-'+name+'-order.png'),fullPage:true});
        state.touchTargets=targets;
      }

      assert.deepEqual(pageErrors, [], name + ': uncaught JavaScript errors');
      results.push({ viewport: name, ...state, screenshot });
      console.log(name + ': OK; canvas=' + state.canvasCount
        + ', horizontal overflow=' + state.horizontalOverflowPx + 'px');
      console.log(name + ' UI: ' + JSON.stringify({
        headings: state.headings,
        controls: state.controls,
        accessibilityAudit: state.accessibilityAudit
      }));
    } finally {
      await context.close();
    }
  }

  await writeFile(
    join(outputDir, 'report.json'),
    JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n'
  );

  const summary = [
    '## ZH browser smoke test — responsive overview',
    '',
    '| Viewport | Horizontal overflow | Unlabeled fields | Small interactive targets (<44px) |',
    '| --- | ---: | ---: | ---: |',
    ...results.map((r) =>
      '| ' + r.viewport + ' | ' + r.horizontalOverflowPx + ' px | ' +
      r.accessibilityAudit.unlabeledFields + ' | ' +
      r.accessibilityAudit.smallTouchTargets.length + ' |'
    ),
    '',
    '### Touch targets needing review',
    '',
    ...results.flatMap((r) => {
      const items = r.accessibilityAudit.smallTouchTargets;
      return items.length
        ? ['**' + r.viewport + '**', ...items.map((item) =>
          '- ' + item.name + ': ' + item.width + ' × ' + item.height + ' px'), '']
        : ['**' + r.viewport + '**: no targets below 44px', ''];
    }),
    'These are geometric diagnostics, not a full accessibility audit.',
    'Screenshots and full JSON report are uploaded in the workflow artifact.',
    ''
  ].join('\n');
  await writeFile(join(outputDir, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
