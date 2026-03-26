#!/usr/bin/env node

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const rootDir = resolve(scriptDir, '../..');
const clientDir = join(rootDir, 'dist/client');
const serverDir = join(rootDir, 'dist/server');
const reportDir = join(rootDir, '.cache/bench');
const reportPath = join(reportDir, 'latest.json');
const routes = [
  { label: 'home', route: '/' },
  { label: 'about', route: '/about' },
  { label: 'article', route: '/getting-started' },
  { label: 'tag', route: '/tags/astro' },
];
const shouldBuild = !process.argv.includes('--skip-build');

async function main() {
  const startedAt = new Date().toISOString();
  const build = shouldBuild ? await runBuild() : null;
  const assetInventory = await collectAssetInventory();
  const htmlBreakdown = await Promise.all(routes.map((page) => collectHtmlBreakdown(page)));
  const browserBench = await withStaticServer(clientDir, async (baseUrl) => {
    const browser = await chromium.launch();

    try {
      const pages = [];
      for (const page of routes) {
        pages.push(await measurePage(browser, baseUrl, page.route));
      }

      const search = await measureSearch(browser, baseUrl);
      return { baseUrl, pages, search };
    } finally {
      await browser.close();
    }
  });

  const report = {
    startedAt,
    build,
    assetInventory,
    htmlBreakdown,
    browserBench,
    criticalPath: summarizeCriticalPath({ assetInventory, browserBench, htmlBreakdown }),
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  printSummary(report);
  console.log(`\nSaved benchmark report to ${reportPath}`);
}

async function runBuild() {
  const started = performance.now();
  const { output } = await runCommand('pnpm', ['run', 'build'], { captureOutput: true });
  const durationMs = Math.round(performance.now() - started);
  const phases = parseBuildPhases(output);

  return {
    durationMs,
    phases,
    postServerBuildMs: phases.astroReportedTotalMs
      ? Math.max(0, durationMs - phases.astroReportedTotalMs)
      : null,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const output = [];
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      stdio: options.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    if (options.captureOutput) {
      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        output.push(text);
        process.stdout.write(text);
      });
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        output.push(text);
        process.stderr.write(text);
      });
    }

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise({ output: output.join('') });
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'null'}.`));
    });
  });
}

async function collectAssetInventory() {
  const clientBytes = await getDirectoryBytes(clientDir);
  const serverBytes = await getDirectoryBytes(serverDir);
  const rootPagefindDir = join(rootDir, 'dist/pagefind');
  const clientPagefindDir = join(clientDir, 'pagefind');

  return {
    clientBytes,
    clientPagefindBytes: await getDirectoryBytes(clientPagefindDir),
    orphanedRootPagefindBytes: await getDirectoryBytes(rootPagefindDir),
    serverBytes,
    topClientFiles: await listTopFiles(clientDir, 12),
    topServerFiles: await listTopFiles(serverDir, 5),
  };
}

async function listTopFiles(directory, limit) {
  try {
    const files = await walkFiles(directory);
    const stats = await Promise.all(
      files.map(async (path) => ({
        path: normalize(path.replace(`${rootDir}/`, '')),
        bytes: (await stat(path)).size,
      })),
    );

    return stats.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
  } catch {
    return [];
  }
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
      continue;
    }
    files.push(path);
  }

  return files;
}

async function getDirectoryBytes(directory) {
  try {
    const files = await walkFiles(directory);
    const sizes = await Promise.all(files.map(async (path) => (await stat(path)).size));
    return sizes.reduce((sum, size) => sum + size, 0);
  } catch {
    return 0;
  }
}

async function collectHtmlBreakdown(page) {
  const filePath = getPageFile(page.route);
  const html = await readFile(filePath, 'utf8');
  const inlineScriptBytes = matchBytes(html, /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
  const inlineStyleBytes = matchBytes(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi);
  const linkedScripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)]
    .map(([, href]) => href)
    .filter((href) => href.startsWith('/'));
  const linkedStylesheets = [
    ...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/gi),
  ]
    .map(([, href]) => href)
    .filter((href) => href.startsWith('/'));

  let linkedJsBytes = 0;
  let linkedCssBytes = 0;

  for (const href of linkedScripts) {
    const assetPath = join(clientDir, href.slice(1));
    try {
      linkedJsBytes += (await stat(assetPath)).size;
    } catch {
      // Ignore assets that are not emitted into dist/client.
    }
  }

  for (const href of linkedStylesheets) {
    const assetPath = join(clientDir, href.slice(1));
    try {
      linkedCssBytes += (await stat(assetPath)).size;
    } catch {
      // Ignore assets that are not emitted into dist/client.
    }
  }

  return {
    ...page,
    htmlBytes: Buffer.byteLength(html),
    inlineScriptBytes,
    inlineStyleBytes,
    linkedCssBytes,
    linkedJsBytes,
  };
}

function matchBytes(text, pattern) {
  let total = 0;
  for (const match of text.matchAll(pattern)) {
    total += Buffer.byteLength(match[1] ?? '');
  }
  return total;
}

function getPageFile(route) {
  if (route === '/') return join(clientDir, 'index.html');
  return join(clientDir, `${route.replace(/^\//, '')}.html`);
}

async function withStaticServer(root, callback) {
  const server = createServer(async (request, response) => {
    try {
      const filePath = resolveRequestPath(root, request.url ?? '/');
      const body = await readFile(filePath);
      response.writeHead(200, {
        'content-length': body.byteLength,
        'content-type': getContentType(filePath),
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`Not found: ${request.url}\n${String(error)}`);
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to acquire a benchmark server port.');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    });
  }
}

function resolveRequestPath(root, requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/') pathname = '/index.html';
  else if (!extname(pathname)) pathname = `${pathname}.html`;

  const resolved = resolve(root, `.${pathname}`);
  if (!resolved.startsWith(root)) {
    throw new Error(`Refused to serve path outside root: ${pathname}`);
  }
  return resolved;
}

function getContentType(path) {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.ts':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.woff2':
      return 'font/woff2';
    case '.woff':
      return 'font/woff';
    case '.ttf':
      return 'font/ttf';
    case '.pf_meta':
      return 'application/octet-stream';
    case '.pagefind':
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

async function measurePage(browser, baseUrl, route) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__benchWebVitals = {
      cls: 0,
      inpMs: 0,
      lcpMs: 0,
    };

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__benchWebVitals.lcpMs = Math.round(entry.startTime);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // Ignore metrics not supported by this browser build.
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__benchWebVitals.cls += entry.value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // Ignore metrics not supported by this browser build.
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__benchWebVitals.inpMs = Math.max(
            window.__benchWebVitals.inpMs,
            Math.round(entry.duration),
          );
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {
      // Ignore metrics not supported by this browser build.
    }
  });

  const resources = [];
  const onResponse = async (response) => {
    const url = response.url();
    if (!url.startsWith(baseUrl)) return;

    try {
      const body = await response.body();
      resources.push({
        bytes: body.byteLength,
        path: url.slice(baseUrl.length) || '/',
        resourceType: response.request().resourceType(),
        status: response.status(),
      });
    } catch {
      // Ignore responses that Playwright cannot materialize.
    }
  };

  page.on('response', onResponse);
  const started = performance.now();
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  const interaction = await performInteraction(page, route);
  await page.waitForTimeout(100);
  const totalDurationMs = Math.round(performance.now() - started);
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0];
    if (!(entry instanceof PerformanceNavigationTiming)) return null;

    return {
      domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
      loadMs: Math.round(entry.loadEventEnd),
      responseEndMs: Math.round(entry.responseEnd),
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
    };
  });
  const webVitals = await page.evaluate(() => ({
    cls: Number(window.__benchWebVitals?.cls ?? 0),
    inpMs: Number(window.__benchWebVitals?.inpMs ?? 0),
    lcpMs: Number(window.__benchWebVitals?.lcpMs ?? 0),
  }));
  page.off('response', onResponse);
  await page.close();

  return {
    interaction,
    route,
    totalDurationMs,
    navigation,
    requestCount: resources.length,
    totalBytes: resources.reduce((sum, resource) => sum + resource.bytes, 0),
    resourceBytesByType: sumBytesBy(resources, 'resourceType'),
    webVitals: {
      cls: Number(webVitals.cls.toFixed(3)),
      inpMs: webVitals.inpMs,
      lcpMs: webVitals.lcpMs,
    },
  };
}

async function measureSearch(browser, baseUrl) {
  const page = await browser.newPage();
  const pagefindResponses = [];
  const onResponse = async (response) => {
    const url = response.url();
    if (!url.startsWith(`${baseUrl}/pagefind/`)) return;

    try {
      const body = await response.body();
      pagefindResponses.push({
        bytes: body.byteLength,
        path: url.slice(baseUrl.length),
        status: response.status(),
      });
    } catch {
      // Ignore responses that Playwright cannot materialize.
    }
  };

  page.on('response', onResponse);
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');

  const started = performance.now();
  await page.locator('#search-trigger').click();
  await page.locator('.pagefind-ui__search-input').waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  const openToReadyMs = Math.round(performance.now() - started);

  page.off('response', onResponse);
  await page.close();

  return {
    openToReadyMs,
    requestCount: pagefindResponses.length,
    totalBytes: pagefindResponses.reduce((sum, resource) => sum + resource.bytes, 0),
    paths: pagefindResponses.map((resource) => resource.path),
  };
}

function sumBytesBy(resources, key) {
  return resources.reduce((acc, resource) => {
    acc[resource[key]] = (acc[resource[key]] ?? 0) + resource.bytes;
    return acc;
  }, {});
}

async function performInteraction(page, route) {
  if (route === '/') {
    await page.locator('#search-trigger').click();
    await page.locator('.pagefind-ui__search-input').waitFor({ state: 'visible' });
    return 'open search modal';
  }

  if (route === '/getting-started') {
    const tocLink = page.locator('.toc-link').first();
    if ((await tocLink.count()) > 0) {
      await tocLink.click();
      return 'click first toc link';
    }
  }

  await page.locator('body').click({ position: { x: 24, y: 24 } });
  return 'tap body';
}

function parseBuildPhases(output) {
  const durationsMs = {};
  const viteBuildsMs = [];
  let astroReportedTotalMs = null;
  let activePhase = null;
  let inServerBuild = false;
  let reoptimizeCount = 0;

  for (const line of output.split(/\r?\n/)) {
    if (line.includes('Re-optimizing dependencies because vite config has changed')) {
      reoptimizeCount += 1;
    }

    const typesMatch = line.match(/\[types\] Generated ([\d.]+(?:ms|s))/);
    if (typesMatch) {
      durationsMs.types = parseDurationMs(typesMatch[1]);
      continue;
    }

    if (line.includes('[build] Collecting build info')) {
      activePhase = 'collectingBuildInfo';
      continue;
    }

    if (line.includes('[build] Building server entrypoints')) {
      activePhase = 'buildingServerEntrypoints';
      inServerBuild = true;
      continue;
    }

    if (line.includes('prerendering static routes')) {
      activePhase = 'prerenderingRoutes';
      inServerBuild = false;
      continue;
    }

    if (line.includes('[build] Rearranging server assets')) {
      activePhase = 'rearrangingServerAssets';
      inServerBuild = false;
      continue;
    }

    const viteMatch = line.match(/\[vite\] ✓ built in ([\d.]+(?:ms|s))/);
    if (viteMatch) {
      const durationMs = parseDurationMs(viteMatch[1]);
      viteBuildsMs.push(durationMs);
      if (inServerBuild) {
        durationsMs.buildingServerEntrypoints =
          (durationsMs.buildingServerEntrypoints ?? 0) + durationMs;
      }
      continue;
    }

    const phaseMatch = line.match(/✓ Completed in ([\d.]+(?:ms|s))\./);
    if (phaseMatch && activePhase) {
      durationsMs[activePhase] = parseDurationMs(phaseMatch[1]);
      activePhase = null;
    }

    const totalMatch = line.match(/\[build\] Server built in ([\d.]+(?:ms|s))/);
    if (totalMatch) {
      astroReportedTotalMs = parseDurationMs(totalMatch[1]);
    }
  }

  return {
    astroReportedTotalMs,
    durationsMs,
    reoptimizeCount,
    viteBuildsMs,
  };
}

function parseDurationMs(value) {
  if (value.endsWith('ms')) return Math.round(Number.parseFloat(value));
  if (value.endsWith('s')) return Math.round(Number.parseFloat(value) * 1000);
  return Math.round(Number.parseFloat(value));
}

function summarizeCriticalPath({ assetInventory, browserBench, htmlBreakdown }) {
  const largestHtml = [...htmlBreakdown].sort((a, b) => b.htmlBytes - a.htmlBytes)[0] ?? null;
  const slowestPage = [...browserBench.pages].sort((a, b) => b.totalDurationMs - a.totalDurationMs)[0] ?? null;
  const worstLcpPage = [...browserBench.pages].sort(
    (a, b) => (b.webVitals?.lcpMs ?? 0) - (a.webVitals?.lcpMs ?? 0),
  )[0] ?? null;
  const worstInpPage = [...browserBench.pages].sort(
    (a, b) => (b.webVitals?.inpMs ?? 0) - (a.webVitals?.inpMs ?? 0),
  )[0] ?? null;
  const worstClsPage = [...browserBench.pages].sort(
    (a, b) => (b.webVitals?.cls ?? 0) - (a.webVitals?.cls ?? 0),
  )[0] ?? null;

  return {
    duplicatePagefindBytes: assetInventory.orphanedRootPagefindBytes,
    largestHtml,
    searchOpenToReadyMs: browserBench.search.openToReadyMs,
    searchRequestCount: browserBench.search.requestCount,
    slowestPage,
    serverBytes: assetInventory.serverBytes,
    worstClsPage,
    worstInpPage,
    worstLcpPage,
  };
}

function printSummary(report) {
  const { assetInventory, browserBench, build, criticalPath, htmlBreakdown } = report;
  console.log('\nBenchmark summary');
  console.log(`- Build duration: ${build ? `${build.durationMs} ms` : 'skipped'}`);
  if (build?.phases) {
    if (build.phases.astroReportedTotalMs) {
      console.log(`  - astro reported server build: ${build.phases.astroReportedTotalMs} ms`);
    }
    for (const [phase, durationMs] of Object.entries(build.phases.durationsMs)) {
      console.log(`  - ${phase}: ${durationMs} ms`);
    }
    console.log(`  - vite re-optimizations: ${build.phases.reoptimizeCount}`);
    if (build.postServerBuildMs !== null) {
      console.log(`  - post-build tail (pagefind/assets): ${build.postServerBuildMs} ms`);
    }
    console.log('  - note: Astro phase timers overlap; compare them individually, not as a sum');
  }
  console.log(`- dist/client bytes: ${formatBytes(assetInventory.clientBytes)}`);
  console.log(`- dist/server bytes: ${formatBytes(assetInventory.serverBytes)}`);
  console.log(`- orphaned dist/pagefind bytes: ${formatBytes(assetInventory.orphanedRootPagefindBytes)}`);
  console.log(
    `- Search bootstrap: ${criticalPath.searchOpenToReadyMs} ms across ${criticalPath.searchRequestCount} Pagefind request(s)`,
  );

  for (const page of htmlBreakdown) {
    console.log(
      `- ${page.route}: html ${formatBytes(page.htmlBytes)}, inline JS ${formatBytes(page.inlineScriptBytes)}, inline CSS ${formatBytes(page.inlineStyleBytes)}`,
    );
  }

  for (const page of browserBench.pages) {
    console.log(
      `- ${page.route} loaded ${formatBytes(page.totalBytes)} across ${page.requestCount} request(s) in ${page.totalDurationMs} ms`,
    );
    console.log(
      `  vitals: LCP ${page.webVitals.lcpMs} ms, INP ${page.webVitals.inpMs} ms, CLS ${page.webVitals.cls.toFixed(3)} (${page.interaction})`,
    );
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
