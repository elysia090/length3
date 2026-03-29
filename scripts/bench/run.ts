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
  const { lines } = await runCommand('pnpm', ['run', 'build'], { captureOutput: true });
  const durationMs = Math.round(performance.now() - started);
  const phases = parseBuildPhases(lines, durationMs);
  const postServerBuildMs =
    phases.timeline?.postBuildCompleteMs ??
    (phases.astroReportedTotalMs ? Math.max(0, durationMs - phases.astroReportedTotalMs) : null);

  return {
    durationMs,
    phases,
    postServerBuildMs,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const output = [];
    const lines = [];
    const startedAt = performance.now();
    const stdoutLines = createLineCollector(lines, startedAt);
    const stderrLines = createLineCollector(lines, startedAt);
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      stdio: options.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    if (options.captureOutput) {
      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        output.push(text);
        stdoutLines.push(text);
        process.stdout.write(text);
      });
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        output.push(text);
        stderrLines.push(text);
        process.stderr.write(text);
      });
    }

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      stdoutLines.finish();
      stderrLines.finish();
      if (code === 0) {
        resolvePromise({ output: output.join(''), lines });
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'null'}.`));
    });
  });
}

function createLineCollector(lines, startedAt) {
  let pending = '';

  return {
    push(text) {
      pending += text.replace(/\r(?!\n)/g, '\n');
      const parts = pending.split('\n');
      pending = parts.pop() ?? '';
      const atMs = Math.round(performance.now() - startedAt);

      for (const part of parts) {
        const line = stripAnsi(part).trimEnd();
        if (!line) continue;
        lines.push({ atMs, line });
      }
    },

    finish() {
      const line = stripAnsi(pending).trimEnd();
      if (!line) return;
      lines.push({
        atMs: Math.round(performance.now() - startedAt),
        line,
      });
      pending = '';
    },
  };
}

function stripAnsi(text) {
  return text.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
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
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript(() => {
    window.__benchWebVitals = {
      cls: 0,
      fcpMs: 0,
      fpMs: 0,
      inpMs: 0,
      lcpMs: 0,
      longTaskCount: 0,
      longTaskMaxMs: 0,
      longTaskTotalMs: 0,
    };
    window.__length3BenchProfile = {
      enabled: true,
      entries: [],
    };
    window.__benchLcpElement = null;

    const describeBenchElement = (element) => {
      if (!(element instanceof Element)) return null;

      const rect = element.getBoundingClientRect();
      const textSample = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        classes: [...element.classList].slice(0, 3),
        textSample: textSample ? textSample.slice(0, 80) : null,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__benchWebVitals.lcpMs = Math.round(entry.startTime);
          window.__benchLcpElement = describeBenchElement(entry.element);
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
          if (entry.name === 'first-paint') {
            window.__benchWebVitals.fpMs = Math.round(entry.startTime);
          }
          if (entry.name === 'first-contentful-paint') {
            window.__benchWebVitals.fcpMs = Math.round(entry.startTime);
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch {
      // Ignore metrics not supported by this browser build.
    }

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Math.round(entry.duration);
          window.__benchWebVitals.longTaskCount += 1;
          window.__benchWebVitals.longTaskTotalMs += duration;
          window.__benchWebVitals.longTaskMaxMs = Math.max(
            window.__benchWebVitals.longTaskMaxMs,
            duration,
          );
        }
      }).observe({ type: 'longtask', buffered: true });
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
  const initialResources = resources.slice();
  const initialRenderProfileEntries = await takeBenchProfileSnapshot(page);
  const initialWebVitals = await readBenchWebVitals(page);
  const initialChromeMetrics = await readChromePerformanceMetrics(cdp);
  const initialDomSnapshot = await readBenchDomSnapshot(page);
  const initialLcpElement = await readBenchLcpElement(page);
  await resetBenchInteractionMetrics(page);
  const interaction = await performInteraction(page, route);
  await page.waitForTimeout(100);
  const interactionResources = resources.slice(initialResources.length);
  const interactionProfileEntries = await takeBenchProfileSnapshot(page);
  const interactionWebVitals = await readBenchWebVitals(page);
  const interactionChromeMetrics = diffBenchMetrics(
    await readChromePerformanceMetrics(cdp),
    initialChromeMetrics,
  );
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
  page.off('response', onResponse);
  await cdp.detach().catch(() => {});
  await page.close();

  return {
    chromeMetrics: initialChromeMetrics,
    domSnapshot: initialDomSnapshot,
    initialRequestCount: initialResources.length,
    initialResourceBytesByType: sumBytesBy(initialResources, 'resourceType'),
    initialTotalBytes: initialResources.reduce((sum, resource) => sum + resource.bytes, 0),
    interaction,
    interactionChromeMetrics,
    interactionMainThread: {
      inpMs: interactionWebVitals.inpMs,
      longTaskCount: interactionWebVitals.longTaskCount,
      longTaskMaxMs: interactionWebVitals.longTaskMaxMs,
      longTaskTotalMs: interactionWebVitals.longTaskTotalMs,
    },
    interactionProfile: summarizeBenchProfileEntries(interactionProfileEntries),
    interactionRequestCount: interactionResources.length,
    interactionResourceBytesByType: sumBytesBy(interactionResources, 'resourceType'),
    interactionTotalBytes: interactionResources.reduce((sum, resource) => sum + resource.bytes, 0),
    lcpElement: initialLcpElement,
    route,
    renderProfile: summarizeBenchProfileEntries(initialRenderProfileEntries),
    totalDurationMs,
    navigation,
    requestCount: resources.length,
    totalBytes: resources.reduce((sum, resource) => sum + resource.bytes, 0),
    resourceBytesByType: sumBytesBy(resources, 'resourceType'),
    webVitals: {
      cls: Number(initialWebVitals.cls.toFixed(3)),
      fcpMs: initialWebVitals.fcpMs,
      fpMs: initialWebVitals.fpMs,
      inpMs: interactionWebVitals.inpMs,
      lcpMs: initialWebVitals.lcpMs,
      longTaskCount: initialWebVitals.longTaskCount,
      longTaskMaxMs: initialWebVitals.longTaskMaxMs,
      longTaskTotalMs: initialWebVitals.longTaskTotalMs,
    },
  };
}

async function measureSearch(browser, baseUrl) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__length3BenchProfile = {
      enabled: true,
      entries: [],
    };
  });
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
  await clearBenchProfile(page);

  const started = performance.now();
  await page.locator('#search-trigger').click();
  await page.locator('.pagefind-ui__search-input').waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  const openToReadyMs = Math.round(performance.now() - started);
  const profileEntries = await takeBenchProfileSnapshot(page);

  page.off('response', onResponse);
  await page.close();

  return {
    openToReadyMs,
    profile: summarizeBenchProfileEntries(profileEntries),
    requestCount: pagefindResponses.length,
    totalBytes: pagefindResponses.reduce((sum, resource) => sum + resource.bytes, 0),
    paths: pagefindResponses.map((resource) => resource.path),
  };
}

async function clearBenchProfile(page) {
  await page.evaluate(() => {
    if (window.__length3BenchProfile?.enabled) {
      window.__length3BenchProfile.entries = [];
    }
  });
}

async function readBenchDomSnapshot(page) {
  return page.evaluate(() => {
    const count = (selector) => document.querySelectorAll(selector).length;
    return {
      articleActionsElements: count('.article-actions *'),
      articleElements: count('article *'),
      articleListElements: count('.article-list *'),
      codeBlockCount: count('pre'),
      headingCount: count('article h2[id], article h3[id]'),
      mainElements: count('main *'),
      proseAreaElements: count('.prose-area *'),
      sidebarElements: count('.sidebar *'),
      tocElements: count('.toc *'),
      totalElements: document.getElementsByTagName('*').length,
    };
  });
}

async function readBenchLcpElement(page) {
  return page.evaluate(() => window.__benchLcpElement ?? null);
}

async function readBenchWebVitals(page) {
  return page.evaluate(() => ({
    cls: Number(window.__benchWebVitals?.cls ?? 0),
    fcpMs: Number(window.__benchWebVitals?.fcpMs ?? 0),
    fpMs: Number(window.__benchWebVitals?.fpMs ?? 0),
    inpMs: Number(window.__benchWebVitals?.inpMs ?? 0),
    lcpMs: Number(window.__benchWebVitals?.lcpMs ?? 0),
    longTaskCount: Number(window.__benchWebVitals?.longTaskCount ?? 0),
    longTaskMaxMs: Number(window.__benchWebVitals?.longTaskMaxMs ?? 0),
    longTaskTotalMs: Number(window.__benchWebVitals?.longTaskTotalMs ?? 0),
  }));
}

async function resetBenchInteractionMetrics(page) {
  await page.evaluate(() => {
    if (!window.__benchWebVitals) return;
    window.__benchWebVitals.inpMs = 0;
    window.__benchWebVitals.longTaskCount = 0;
    window.__benchWebVitals.longTaskMaxMs = 0;
    window.__benchWebVitals.longTaskTotalMs = 0;
  });
}

async function readChromePerformanceMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const byName = Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
  const toMs = (value) => Number((((value ?? 0) * 1000)).toFixed(1));

  return {
    documents: Math.round(byName.Documents ?? 0),
    eventListeners: Math.round(byName.JSEventListeners ?? 0),
    frames: Math.round(byName.Frames ?? 0),
    jsHeapTotalBytes: Math.round(byName.JSHeapTotalSize ?? 0),
    jsHeapUsedBytes: Math.round(byName.JSHeapUsedSize ?? 0),
    layoutCount: Math.round(byName.LayoutCount ?? 0),
    layoutDurationMs: toMs(byName.LayoutDuration),
    nodes: Math.round(byName.Nodes ?? 0),
    recalcStyleCount: Math.round(byName.RecalcStyleCount ?? 0),
    recalcStyleDurationMs: toMs(byName.RecalcStyleDuration),
    scriptDurationMs: toMs(byName.ScriptDuration),
    taskDurationMs: toMs(byName.TaskDuration),
  };
}

function diffBenchMetrics(after, before) {
  return Object.fromEntries(
    Object.entries(after).map(([key, value]) => [
      key,
      typeof value === 'number' ? Number((value - (before[key] ?? 0)).toFixed(1)) : value,
    ]),
  );
}

async function takeBenchProfileSnapshot(page) {
  return page.evaluate(() => {
    const entries = Array.isArray(window.__length3BenchProfile?.entries)
      ? window.__length3BenchProfile.entries.slice()
      : [];

    if (window.__length3BenchProfile?.enabled) {
      window.__length3BenchProfile.entries = [];
    }

    return entries;
  });
}

function summarizeBenchProfileEntries(entries) {
  const totalsByName = new Map();

  for (const entry of entries) {
    const current =
      totalsByName.get(entry.name) ?? {
        avgDurationMs: 0,
        count: 0,
        maxDurationMs: 0,
        name: entry.name,
        totalDurationMs: 0,
      };

    current.count += 1;
    current.maxDurationMs = Math.max(current.maxDurationMs, Number(entry.durationMs) || 0);
    current.totalDurationMs += Number(entry.durationMs) || 0;
    totalsByName.set(entry.name, current);
  }

  const summary = [...totalsByName.values()]
    .map((entry) => ({
      ...entry,
      avgDurationMs: Number((entry.totalDurationMs / Math.max(1, entry.count)).toFixed(3)),
      maxDurationMs: Number(entry.maxDurationMs.toFixed(3)),
      totalDurationMs: Number(entry.totalDurationMs.toFixed(3)),
    }))
    .sort((a, b) => b.totalDurationMs - a.totalDurationMs);

  return {
    entries,
    summary,
    totalDurationMs: Number(
      summary.reduce((sum, entry) => sum + entry.totalDurationMs, 0).toFixed(3),
    ),
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

function parseBuildPhases(lines, totalDurationMs) {
  const durationsMs = {};
  const wallDurationsMs = {};
  const viteBuildsMs = [];
  const markersMs = {};
  let astroReportedTotalMs = null;
  let activePhase = null;
  let inServerBuild = false;
  let reoptimizeCount = 0;

  const mark = (name, atMs) => {
    if (atMs === null || atMs === undefined) return;
    markersMs[name] = atMs;
  };

  const completeActivePhase = (atMs, phaseName = activePhase?.name) => {
    if (!activePhase || !phaseName) return;
    if (activePhase.startedAtMs !== null && activePhase.startedAtMs !== undefined) {
      wallDurationsMs[phaseName] = Math.max(0, atMs - activePhase.startedAtMs);
    }
    mark(`${phaseName}End`, atMs);
    activePhase = null;
  };

  for (const entry of lines) {
    const { atMs, line } = entry;
    if (line.includes('Re-optimizing dependencies because vite config has changed')) {
      reoptimizeCount += 1;
    }

    const typesMatch = line.match(/\[types\] Generated ([\d.]+(?:ms|s))/);
    if (typesMatch) {
      durationsMs.types = parseDurationMs(typesMatch[1]);
      mark('typesGenerated', atMs);
      continue;
    }

    if (line.includes('[build] Collecting build info')) {
      activePhase = { name: 'collectingBuildInfo', startedAtMs: atMs };
      mark('collectingBuildInfoStart', atMs);
      continue;
    }

    if (line.includes('[build] Building server entrypoints')) {
      completeActivePhase(atMs);
      activePhase = { name: 'buildingServerEntrypoints', startedAtMs: atMs };
      inServerBuild = true;
      mark('buildEnvironmentsStart', atMs);
      mark('buildingServerEntrypointsStart', atMs);
      continue;
    }

    if (line.includes('prerendering static routes')) {
      completeActivePhase(atMs);
      activePhase = { name: 'prerenderingRoutes', startedAtMs: atMs };
      inServerBuild = false;
      mark('prerenderingRoutesStart', atMs);
      continue;
    }

    if (line.includes('[build] Rearranging server assets')) {
      completeActivePhase(atMs);
      inServerBuild = false;
      mark('rearrangingServerAssetsLogged', atMs);
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
      durationsMs[activePhase.name] = parseDurationMs(phaseMatch[1]);
      completeActivePhase(atMs, activePhase.name);
    } else if (
      phaseMatch &&
      line.includes('[build]') &&
      markersMs.buildEnvironmentsStart !== undefined &&
      markersMs.buildEnvironmentsEnd === undefined
    ) {
      durationsMs.buildEnvironmentsTotal = parseDurationMs(phaseMatch[1]);
      mark('buildEnvironmentsEnd', atMs);
    }

    const totalMatch = line.match(/\[build\] Server built in ([\d.]+(?:ms|s))/);
    if (totalMatch) {
      astroReportedTotalMs = parseDurationMs(totalMatch[1]);
      mark('serverBuilt', atMs);
      completeActivePhase(atMs);
    }

    if (line.includes('[pagefind] Pagefind indexed')) {
      mark('pagefindIndexed', atMs);
    }

    if (line.includes('[pagefind] Pagefind wrote index')) {
      mark('pagefindWroteIndex', atMs);
    }

    if (line.includes('[build] Complete!')) {
      mark('buildComplete', atMs);
    }
  }

  const timeline = summarizeBuildTimeline(markersMs, totalDurationMs);

  return {
    astroReportedTotalMs,
    durationsMs,
    reoptimizeCount,
    viteBuildsMs,
    wallDurationsMs,
    markersMs,
    timeline,
  };
}

function summarizeBuildTimeline(markersMs, totalDurationMs) {
  const rearrangingServerAssetsLoggedAtMs = markersMs.rearrangingServerAssetsLogged ?? null;
  const buildEnvironmentsEndAtMs = markersMs.buildEnvironmentsEnd ?? null;
  const pagefindIndexedAtMs = markersMs.pagefindIndexed ?? null;
  const pagefindWroteIndexAtMs = markersMs.pagefindWroteIndex ?? null;
  const buildCompleteAtMs = markersMs.buildComplete ?? markersMs.serverBuilt ?? null;

  return {
    rearrangingServerAssetsLoggedAtMs,
    buildEnvironmentsEndAtMs,
    pagefindIndexedAtMs,
    pagefindWroteIndexAtMs,
    buildCompleteAtMs,
    afterRearrangingLogMs:
      rearrangingServerAssetsLoggedAtMs !== null && buildEnvironmentsEndAtMs !== null
        ? Math.max(0, buildEnvironmentsEndAtMs - rearrangingServerAssetsLoggedAtMs)
        : null,
    pagefindIndexingMs:
      buildEnvironmentsEndAtMs !== null && pagefindIndexedAtMs !== null
        ? Math.max(0, pagefindIndexedAtMs - buildEnvironmentsEndAtMs)
        : null,
    pagefindWriteMs:
      pagefindIndexedAtMs !== null && pagefindWroteIndexAtMs !== null
        ? Math.max(0, pagefindWroteIndexAtMs - pagefindIndexedAtMs)
        : null,
    postPagefindWriteMs:
      pagefindWroteIndexAtMs !== null && buildCompleteAtMs !== null
        ? Math.max(0, buildCompleteAtMs - pagefindWroteIndexAtMs)
        : null,
    postBuildCompleteMs:
      buildCompleteAtMs !== null ? Math.max(0, totalDurationMs - buildCompleteAtMs) : null,
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
  const slowestRenderPage = [...browserBench.pages].sort(
    (a, b) => (b.renderProfile?.totalDurationMs ?? 0) - (a.renderProfile?.totalDurationMs ?? 0),
  )[0] ?? null;
  const worstFcpPage = [...browserBench.pages].sort(
    (a, b) => (b.webVitals?.fcpMs ?? 0) - (a.webVitals?.fcpMs ?? 0),
  )[0] ?? null;
  const worstLcpPage = [...browserBench.pages].sort(
    (a, b) => (b.webVitals?.lcpMs ?? 0) - (a.webVitals?.lcpMs ?? 0),
  )[0] ?? null;
  const worstLongTaskPage = [...browserBench.pages].sort(
    (a, b) => (b.webVitals?.longTaskTotalMs ?? 0) - (a.webVitals?.longTaskTotalMs ?? 0),
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
    searchProfile: browserBench.search.profile,
    searchRequestCount: browserBench.search.requestCount,
    slowestPage,
    slowestRenderPage,
    serverBytes: assetInventory.serverBytes,
    worstClsPage,
    worstFcpPage,
    worstInpPage,
    worstLcpPage,
    worstLongTaskPage,
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
    if (build.phases.timeline?.afterRearrangingLogMs !== null) {
      console.log(`  - after 'Rearranging server assets' log to env-build complete: ${build.phases.timeline.afterRearrangingLogMs} ms`);
    }
    if (build.phases.timeline?.pagefindIndexingMs !== null) {
      console.log(`  - pagefind indexing after env-build complete: ${build.phases.timeline.pagefindIndexingMs} ms`);
    }
    if (build.phases.timeline?.pagefindWriteMs !== null) {
      console.log(`  - pagefind writeFiles: ${build.phases.timeline.pagefindWriteMs} ms`);
    }
    if (build.phases.timeline?.postPagefindWriteMs !== null) {
      console.log(`  - post-pagefind write to build complete: ${build.phases.timeline.postPagefindWriteMs} ms`);
    }
    if (build.postServerBuildMs !== null) {
      console.log(`  - post-build complete tail: ${build.postServerBuildMs} ms`);
    }
    console.log('  - note: Astro phase timers overlap; compare them individually, not as a sum');
  }
  console.log(`- dist/client bytes: ${formatBytes(assetInventory.clientBytes)}`);
  console.log(`- dist/server bytes: ${formatBytes(assetInventory.serverBytes)}`);
  console.log(`- orphaned dist/pagefind bytes: ${formatBytes(assetInventory.orphanedRootPagefindBytes)}`);
  console.log(
    `- Search bootstrap: ${criticalPath.searchOpenToReadyMs} ms across ${criticalPath.searchRequestCount} Pagefind request(s)`,
  );
  if (criticalPath.searchProfile?.summary?.length) {
    console.log(
      `  - search phases: ${formatBenchProfileSummary(criticalPath.searchProfile.summary, 4)}`,
    );
  }

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
      `  vitals: FP ${page.webVitals.fpMs} ms, FCP ${page.webVitals.fcpMs} ms, LCP ${page.webVitals.lcpMs} ms, CLS ${page.webVitals.cls.toFixed(3)} (${page.interaction})`,
    );
    console.log(
      `  render main thread: long tasks ${page.webVitals.longTaskCount}, total ${page.webVitals.longTaskTotalMs} ms, max ${page.webVitals.longTaskMaxMs} ms`,
    );
    if (page.renderProfile?.summary?.length) {
      console.log(`  render init: ${formatBenchProfileSummary(page.renderProfile.summary, 4)}`);
    }
    if (page.interactionProfile?.summary?.length || page.interactionMainThread?.longTaskCount || page.interactionMainThread?.inpMs) {
      console.log(
        `  interaction: INP ${page.interactionMainThread.inpMs} ms, long tasks ${page.interactionMainThread.longTaskCount}, total ${page.interactionMainThread.longTaskTotalMs} ms, max ${page.interactionMainThread.longTaskMaxMs} ms${page.interactionProfile?.summary?.length ? `, phases ${formatBenchProfileSummary(page.interactionProfile.summary, 3)}` : ''}`,
      );
    }
  }
}

function formatBenchProfileSummary(summary, limit) {
  return summary
    .slice(0, limit)
    .map((entry) => `${entry.name} ${entry.totalDurationMs} ms${entry.count > 1 ? ` x${entry.count}` : ''}`)
    .join(', ');
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
