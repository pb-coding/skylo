#!/usr/bin/env node
/** Browser integration checks against running Vite + backend, with no extra npm dependencies.
 * SKYLO_BROWSER_URL=http://127.0.0.1:5173 node scripts/browser-check.mjs
 * Optional CHROMIUM_PATH and SKYLO_VERIFICATION_DIR.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.SKYLO_BROWSER_URL || 'http://127.0.0.1:5173';
const artifacts = process.env.SKYLO_VERIFICATION_DIR || path.join(root, '..', 'skylo-verification');
const profile = path.join(artifacts, `chromium-${Date.now()}`);
const checks = [];
const pageErrors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(artifacts, { recursive: true });
await mkdir(profile, { recursive: true });
const browser = spawn(process.env.CHROMIUM_PATH || '/usr/bin/chromium', [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let browserLog = '';
browser.stderr.on('data', chunk => { browserLog = (browserLog + chunk).slice(-50_000); });

async function until(test, message, timeout = 12_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try { const result = await test(); if (result) return result; } catch (error) { lastError = error; }
    await delay(60);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

class CDP {
  constructor(websocket) {
    this.websocket = websocket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = [];
    websocket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.websocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async page() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
    await this.send('Page.navigate', { url }, sessionId);
    const page = {
      sessionId,
      evaluate: async (fn, argument) => {
        const result = await this.send('Runtime.evaluate', {
          expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`, awaitPromise: true, returnByValue: true,
        }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      screenshot: async name => {
        const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        await writeFile(path.join(artifacts, name), Buffer.from(data, 'base64'));
      },
      viewport: async (width, height) => this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sessionId),
    };
    await page.viewport(1366, 1000);
    await until(() => page.evaluate(() => !!document.querySelector('#session-name')), 'Lobby did not load');
    await page.evaluate(async () => {
      const { socket } = await import('/src/socket.ts');
      window.__skyloCheck = { socket, session: null, game: null, messages: [], revisions: [] };
      socket.on('session-state', session => { window.__skyloCheck.session = session; });
      socket.on('game-update', game => {
        window.__skyloCheck.game = game;
        if (game) window.__skyloCheck.revisions.push(game.revision);
      });
      socket.on('message', message => window.__skyloCheck.messages.push(message));
    });
    await until(() => page.evaluate(() => window.__skyloCheck.socket.connected), 'Socket did not connect');
    return page;
  }
}

async function reveal(page, target) {
  return page.evaluate(({ selector, label }) => {
    const element = selector ? document.querySelector(selector)
      : [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label);
    if (!element) return false;
    const ancestors = [];
    let parent = element.parentElement;
    while (parent) { if (parent.tagName === 'DETAILS') ancestors.unshift(parent); parent = parent.parentElement; }
    for (const details of ancestors) if (!details.open) details.querySelector('summary').click();
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const foreground = document.elementFromPoint(x, y);
    return !element.disabled && rect.width > 0 && rect.height > 0 && x >= 0 && x < innerWidth && y >= 0 && y < innerHeight
      && !!foreground && (foreground === element || element.contains(foreground)) ? { x, y } : false;
  }, target);
}
async function click(page, label) {
  const point = await until(() => reveal(page, { label }), `Button not visible/reachable: ${label}`);
  await clickPoint(page, point);
}
async function clickSelector(page, selector) {
  const point = await until(() => reveal(page, { selector }), `Control not visible/reachable: ${selector}`);
  await clickPoint(page, point);
}
async function clickPoint(page, point) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }, page.sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, page.sessionId);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, page.sessionId);
}
async function input(page, selector, value) {
  await until(() => reveal(page, { selector }), `Input not visible/reachable: ${selector}`);
  return page.evaluate(({ selector, value }) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing input ${selector}`);
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value: String(value) });
}
async function join(page, sessionId, role, name) {
  await until(() => page.evaluate(() => !!document.querySelector('#player-name') && !document.querySelector('#session-name').disabled), 'Join form is not ready');
  await input(page, '#player-name', name);
  await input(page, '#session-name', sessionId);
  await clickSelector(page, `input[name="join-role"][value="${role}"]`);
  await click(page, 'Session beitreten');
  await until(() => page.evaluate(sessionId => window.__skyloCheck.session?.sessionId === sessionId, sessionId), 'Session join failed');
}
const state = page => page.evaluate(() => ({ session: window.__skyloCheck.session, game: window.__skyloCheck.game }));
async function ack(page, event, payload) {
  return page.evaluate(({ event, payload }) => new Promise((resolve, reject) => {
    window.__skyloCheck.socket.timeout(8000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result));
  }), { event, payload });
}
function checked(name, detail) { checks.push({ name, detail, passed: true }); process.stdout.write(`PASS ${name}\n`); }

let cdp;
try {
  const [port, websocketPath] = await until(async () => (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'), 'Chromium did not start');
  const websocket = new WebSocket(`ws://127.0.0.1:${port}${websocketPath}`);
  await new Promise((resolve, reject) => { websocket.addEventListener('open', resolve, { once: true }); websocket.addEventListener('error', reject, { once: true }); });
  cdp = new CDP(websocket);
  cdp.listeners.push(message => {
    if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts, eventsEnabled: true });
  const host = await cdp.page();
  const botSession = `browser-bots-${Date.now()}`;
  await join(host, botSession, 'spectator', 'Browser-Gastgeber');
  assert.equal((await state(host)).session.canControl, true);
  for (let count = 1; count <= 8; count++) {
    await click(host, 'Bot hinzufügen');
    await until(async () => (await state(host)).session.players.length === count, 'Bot was not added');
  }
  await input(host, 'select[aria-label="Strategie für Bot 1"]', 'random');
  await until(async () => (await state(host)).session.players[0].botConfig.strategyId === 'random', 'Bot strategy did not update');
  assert.equal(await host.evaluate(() => document.querySelector('select[aria-label="Schwierigkeit für Bot 1"]').disabled), true);
  await input(host, 'select[aria-label="Schwierigkeit für Bot 2"]', 'hard');
  await until(async () => (await state(host)).session.players[1].botConfig.difficulty === 'hard', 'Bot difficulty did not update');
  await input(host, '#match-seed', 'browser-repeatable-seed');
  assert.equal(await host.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Bot hinzufügen').disabled), true);
  await host.screenshot('01-lobby-eight-bots.png');
  checked('Viewer host configures eight bots', 'Strategy settings, player limit and reproducible seed input');

  await click(host, 'Partie starten');
  await until(async () => !!(await state(host)).game, 'Game did not start');
  await click(host, 'Pause');
  await until(async () => (await state(host)).game.playback.paused, 'Pause was not applied');
  let before = (await state(host)).game;
  assert.equal(before.players.length, 8);
  assert.equal(before.ownPlayerId, null);
  assert.deepEqual(before.legalActions, []);
  for (const player of before.players) player.deck.forEach((column, columnIndex) => column.forEach((card, cardIndex) => {
    if (!player.knownCardPositions[columnIndex][cardIndex]) assert.equal(card, null);
  }));
  assert(before.cardStack.cards.every(card => card === null));
  await delay(180);
  assert.equal((await state(host)).game.revision, before.revision);
  checked('Pause and spectator privacy', 'Paused game stays still; observer has no actions or hidden cards');

  const viewer = await cdp.page();
  await join(viewer, botSession, 'spectator', 'Browser-Zuschauer');
  await until(async () => !!(await state(viewer)).game, 'Mid-game spectator did not receive snapshot');
  assert.equal((await state(viewer)).game.matchId, before.matchId);
  assert.equal((await state(viewer)).session.canControl, false);
  assert.equal(await viewer.evaluate(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Fortsetzen')), false);
  await viewer.evaluate(() => [...document.querySelectorAll('summary')].find(summary => summary.textContent.trim() === 'Bot-Tempo').click());
  assert.equal(await viewer.evaluate(() => document.querySelector('#bot-tempo').disabled), true);
  assert.equal(await ack(viewer, 'playback-control', { sessionId: botSession, command: { type: 'resume' } }), 'error:host');
  assert.equal(await ack(viewer, 'game-action', { sessionId: botSession, matchId: before.matchId, requestId: 'viewer-action', decisionId: 'invalid', action: { type: 'draw' } }), 'error:membership');
  checked('Mid-game viewer join and permissions', 'Current snapshot arrives; only host controls playback; viewers cannot act');

  await click(host, 'Nächste Aktion');
  await until(async () => (await state(host)).game.revision === before.revision + 1, 'Action step did not apply exactly once');
  await delay(150);
  const afterAction = (await state(host)).game;
  assert.equal(afterAction.revision, before.revision + 1);
  assert.equal(afterAction.playback.paused, true);
  await click(host, 'Nächster Zug');
  await until(async () => !(await state(host)).game.playback.stepping, 'Turn step did not settle');
  const afterTurn = (await state(host)).game;
  assert(afterTurn.revision > afterAction.revision);
  assert.equal(afterTurn.playback.paused, true);
  checked('Single action and turn steps', 'Actions apply once and return to pause');

  await input(host, '#bot-tempo', 3000); // 2000 ms between actions.
  await until(async () => (await state(host)).game.playback.delayMs === 2000, 'Live tempo change did not apply');
  await click(host, 'Fortsetzen');
  await until(async () => !(await state(host)).game.playback.paused, 'Resume did not apply');
  await input(host, '#bot-tempo', 5000);
  await until(async () => (await state(host)).game.playback.delayMs === 0, 'Maximum tempo did not apply');
  await until(async () => (await state(host)).game.phase !== 'reveal two cards', 'Bots did not finish initial reveals');
  await click(host, 'Pause');
  await until(async () => (await state(host)).game.playback.paused, 'Fast game did not pause');
  const game = (await state(host)).game;
  await input(host, '.camera-focus-field select', game.players[7].id);
  assert.equal(await host.evaluate(() => document.querySelector('.camera-focus-field select').value), game.players[7].id);
  await host.evaluate(() => document.querySelectorAll('details[open]').forEach(details => details.querySelector('summary').click()));
  await host.screenshot('02-eight-bots-viewer-desktop.png');
  await viewer.viewport(390, 844);
  await viewer.screenshot('03-eight-bots-viewer-mobile.png');
  assert.equal(await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  checked('Live tempo, camera focus and mobile layout', 'Room-wide delay changes while game runs; all eight decks and accessible cards remain available');

  await click(host, 'Partie beenden');
  await until(async () => (await state(host)).game.phase === 'game ended' && (await state(host)).session.hasExport, 'Game did not stop/export');
  const priorDownloads = new Set(await readdir(artifacts));
  await click(host, 'Partieprotokoll herunterladen');
  const filename = await until(async () => (await readdir(artifacts)).find(filename => filename.endsWith('.json') && filename.startsWith('skylo-') && !priorDownloads.has(filename)), 'Export download did not complete');
  const record = JSON.parse(await readFile(path.join(artifacts, filename), 'utf8'));
  assert(record && typeof record === 'object');
  const verify = spawn(process.execPath, ['--require', 'ts-node/register', 'scripts/replay.cjs', path.join(artifacts, filename)], { cwd: path.join(root, 'apps/backend'), stdio: ['ignore', 'pipe', 'pipe'] });
  let verificationLog = '';
  verify.stdout.on('data', chunk => { verificationLog += chunk; });
  verify.stderr.on('data', chunk => { verificationLog += chunk; });
  const verifyCode = await new Promise(resolve => verify.on('exit', resolve));
  assert.equal(verifyCode, 0, verificationLog);
  await writeFile(path.join(artifacts, 'replay-check.log'), verificationLog);
  await host.screenshot('04-completed-export.png');
  checked('Terminal export and replay validation', verificationLog.trim());
  const previousMatch = (await state(host)).game.matchId;
  await click(host, 'Lobby öffnen');
  await until(() => host.evaluate(() => !!document.querySelector('#match-seed')), 'Terminal lobby did not open');
  await click(host, 'Partie starten');
  await until(async () => (await state(host)).game.matchId !== previousMatch, 'Restart did not create fresh match');
  await click(host, 'Partie beenden');
  await click(host, 'Session verlassen');
  await click(viewer, 'Session verlassen');
  checked('Terminal lobby and restart', 'Bots can be configured again and a fresh match can start');

  const human = await cdp.page();
  const mixedSession = `browser-mixed-${Date.now()}`;
  await join(human, mixedSession, 'player', 'Browser-Mensch');
  await click(human, 'Bot hinzufügen');
  await until(async () => (await state(human)).session.players.length === 2, 'Mixed lobby bot did not appear');
  await click(human, 'Partie starten');
  await until(async () => (await state(human)).game?.legalActions.some(action => action.type === 'reveal'), 'Initial human actions missing');
  await clickSelector(human, 'button[aria-label*="Aufdecken"]');
  await until(async () => {
    const view = (await state(human)).game;
    return view.players.find(player => player.id === view.ownPlayerId)?.knownCardPositions.flat().filter(Boolean).length === 1;
  }, 'Human reveal did not apply');
  await clickSelector(human, 'button[aria-label*="Aufdecken"]');
  await click(human, 'Maximales Tempo');
  await until(async () => (await state(human)).game.phase !== 'reveal two cards', 'Mixed initial phase did not finish');
  let humanActions = 0;
  while (humanActions < 4) {
    const view = await until(async () => {
      const view = (await state(human)).game;
      return view.legalActions.length ? view : false;
    }, 'Human did not receive next actions');
    const oldRevision = view.revision;
    const plainAction = view.legalActions.find(action => action.type === 'draw' || action.type === 'discard' || action.type === 'next-round');
    if (plainAction) await click(human, { draw: 'Karte ziehen', discard: 'Gezogene Karte abwerfen', 'next-round': 'Nächste Runde starten' }[plainAction.type]);
    else await clickSelector(human, 'button[aria-label*="Tauschen"], button[aria-label*="Aufdecken"]');
    await until(async () => (await state(human)).game.revision > oldRevision, 'Human action did not apply');
    humanActions++;
  }
  await human.screenshot('05-human-against-bot.png');
  await click(human, 'Partie beenden');
  await click(human, 'Session verlassen');
  checked('Human against bot uses same action path', 'Two start cards and four additional human actions completed through real UI');

  const naturalSession = `browser-natural-${Date.now()}`;
  await join(human, naturalSession, 'spectator', 'Browser-Gastgeber');
  for (let count = 1; count <= 2; count++) {
    await click(human, 'Bot hinzufügen');
    await until(async () => (await state(human)).session.players.length === count, 'Natural match bot was not added');
  }
  await input(human, 'select[aria-label="Schwierigkeit für Bot 1"]', 'easy');
  await until(async () => (await state(human)).session.players[0].botConfig.difficulty === 'easy', 'Easy bot setting did not apply');
  await input(human, 'select[aria-label="Schwierigkeit für Bot 2"]', 'hard');
  await until(async () => (await state(human)).session.players[1].botConfig.difficulty === 'hard', 'Hard bot setting did not apply');
  await click(human, 'Partie starten');
  await until(async () => (await state(human)).game?.phase !== 'game ended' && !!(await state(human)).game, 'Natural match did not start');
  await click(human, 'Maximales Tempo');
  await until(async () => (await state(human)).game?.phase === 'game ended' && (await state(human)).session.hasExport, 'Pure bots did not finish naturally', 45_000);
  const completed = (await state(human)).game;
  assert.equal(completed.endReason, 'point-limit');
  assert(completed.round > 1, 'Expected automatic transition into subsequent rounds');
  assert(completed.players.some(player => player.place === 1));
  await human.screenshot('06-natural-bot-match-ended.png');
  const exported = await ack(human, 'export-match', { sessionId: naturalSession });
  assert.equal(exported.code, 'success');
  const naturalFile = path.join(artifacts, 'natural-completed-match.json');
  await writeFile(naturalFile, JSON.stringify(exported.record, null, 2));
  const naturalVerify = spawn(process.execPath, ['--require', 'ts-node/register', 'scripts/replay.cjs', naturalFile], { cwd: path.join(root, 'apps/backend'), stdio: ['ignore', 'pipe', 'pipe'] });
  let naturalLog = '';
  naturalVerify.stdout.on('data', chunk => { naturalLog += chunk; });
  naturalVerify.stderr.on('data', chunk => { naturalLog += chunk; });
  assert.equal(await new Promise(resolve => naturalVerify.on('exit', resolve)), 0, naturalLog);
  await writeFile(path.join(artifacts, 'natural-replay-check.log'), naturalLog);
  await click(human, 'Session verlassen');
  checked('Two bots complete rounds and match naturally', `Finished ${completed.round} rounds at point limit; ${naturalLog.trim()}`);

  assert.deepEqual(pageErrors, [], 'Unexpected browser errors');
  checked('No uncaught browser errors', 'All checked pages rendered and interacted without uncaught exceptions');
  await writeFile(path.join(artifacts, 'browser-report.json'), JSON.stringify({ url, passed: true, checks, pageErrors }, null, 2));
  process.stdout.write(`Artifacts: ${artifacts}\n`);
} catch (error) {
  await writeFile(path.join(artifacts, 'browser-report.json'), JSON.stringify({ url, passed: false, checks, pageErrors, error: error.stack }, null, 2));
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(artifacts, 'chromium.log'), browserLog);
  cdp?.websocket.close();
  browser.kill('SIGTERM');
  await delay(200);
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
