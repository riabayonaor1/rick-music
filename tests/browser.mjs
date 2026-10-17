import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, extname} from 'node:path';
import {chromium, webkit} from 'playwright';

// Serve at a repository subpath, exactly as on GitHub Pages.
const dist = new URL('../dist/', import.meta.url);
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith('/rick-music/') || path.includes('..')) throw Error('404');
    const file = path.slice('/rick-music/'.length) || 'index.html';
    res.setHeader('Content-Type', {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'}[extname(file)] || 'application/octet-stream');
    res.end(await readFile(new URL(file, dist)));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = process.env.TEST_URL || `http://127.0.0.1:${server.address().port}/rick-music/`;
const temp = await mkdtemp(join(tmpdir(), 'rick-music-test-'));
const engines = [['Chromium', chromium]];
if (process.env.TEST_WEBKIT === '1') engines.push(['WebKit', webkit]);
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };

// Observe the actual browser audio graph without replacing its APIs or output.
// A parallel, muted branch keeps the analyser processing while notes stop.
function installAudioProbe() {
  const probes = [], byContext = new WeakMap();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...args) {
    const result = connect.call(this, destination, ...args);
    const probe = byContext.get(this.context);
    if (probe && destination === this.context.destination) {
      connect.call(this, probe.analyser, args[0] ?? 0, 0);
    }
    return result;
  };
  const wrappers = new Map();
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const NativeContext = window[name];
    if (!NativeContext) continue;
    if (!wrappers.has(NativeContext)) {
      wrappers.set(NativeContext, new Proxy(NativeContext, {
        construct(target, args) {
          const sessionTypeAtCreation = navigator.audioSession?.type ?? null;
          const context = Reflect.construct(target, args);
          const analyser = context.createAnalyser(), mute = context.createGain();
          analyser.fftSize = 2048;
          mute.gain.value = 0;
          connect.call(analyser, mute);
          connect.call(mute, context.destination);
          const probe = {context, analyser, samples:new Float32Array(analyser.fftSize), sessionTypeAtCreation};
          byContext.set(context, probe);
          probes.push(probe);
          return context;
        }
      }));
    }
    window[name] = wrappers.get(NativeContext);
  }
  window.__audioProbe = {
    sample() {
      const probe = probes.at(-1);
      if (!probe) return {state:null, rms:0, contexts:0};
      probe.analyser.getFloatTimeDomainData(probe.samples);
      const rms = Math.sqrt(probe.samples.reduce((sum, value) => sum + value * value, 0) / probe.samples.length);
      return {
        state:probe.context.state, rms, contexts:probes.length,
        hasAudioSession:!!navigator.audioSession,
        sessionType:navigator.audioSession?.type ?? null,
        sessionTypesAtCreation:probes.map(item => item.sessionTypeAtCreation)
      };
    }
  };
}

try {
  for (const [name, engine] of engines) {
    const browser = await engine.launch({headless:true, ...(name === 'Chromium' && process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
    try {
      for (const [width, height] of [[320,640],[390,844],[844,390],[768,1024],[1440,900]]) {
        const mobile = width <= 900;
        const context = await browser.newContext({viewport:{width,height}, isMobile:mobile, hasTouch:mobile, acceptDownloads:true});
        await context.addInitScript(installAudioProbe);
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        const activate = selector => page.locator(selector)[mobile ? 'tap' : 'click']();
        await page.goto(url);
        await page.waitForFunction(() => window.Partitura && document.querySelector('.sheet-wrap'));
        await page.waitForTimeout(80);
        const layout = await page.evaluate(() => {
          const canvas = document.getElementById('canvas').getBoundingClientRect();
          const sheet = document.querySelector('.sheet-wrap').getBoundingClientRect();
          return {width:innerWidth, scroll:document.documentElement.scrollWidth, canvas:canvas.width, height:canvas.height, sheet:sheet.width};
        });
        check(layout.scroll <= width + 1, `${name} ${width}: no horizontal page overflow`);
        check(layout.canvas >= (mobile ? width - 1 : 500) && layout.height > 40, `${name} ${width}: score has usable space`);
        if (mobile) {
          check(layout.sheet <= layout.canvas, `${name} ${width}: fit score`);
          await activate('#toggle-tools');
          check(await page.locator('#tool-panel').isVisible(), 'Touch tools open');
          check(await page.locator('[data-finale-tool]').count() === 36, 'Complete tool palette');
          await activate('[data-finale-tool="simple-entry"]');
          check(!await page.locator('#tool-panel').isVisible(), 'Choosing a tool restores the score');
          await activate('#toggle-inspector');
          await page.locator('#title').fill('Partitura móvil');
          await activate('#document-panel [data-close-panel]');
          check(await page.evaluate(() => Partitura.getScore().title) === 'Partitura móvil', 'Touch document editing');
          await page.locator('#zoom').selectOption('1');
          check(await page.locator('#canvas').evaluate(e => e.scrollWidth > e.clientWidth), 'Zoomed score scrolls');
          await activate('#fit-score');
          check(await page.locator('#zoom').inputValue() === 'fit', 'Fit restores responsive zoom');
          check(await page.locator('.white-key').first().evaluate(e => getComputedStyle(e).touchAction.includes('pan-x')), 'Piano permits touch scrolling between octaves');
          if (name === 'Chromium' && width === 390) {
            const session = await context.newCDPSession(page);
            const box = await page.locator('#piano').boundingBox();
            const y = box.y + 50;
            await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y}]});
            for (let x = 280; x >= 80; x -= 20) {
              await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
              await page.waitForTimeout(16);
            }
            await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
            check(await page.locator('#piano').evaluate(e => e.scrollLeft > 50), 'Native touch swipe reaches more piano keys');
            await page.waitForTimeout(300);
            await page.locator('#piano').evaluate(e => e.scrollLeft = 0);
            await session.detach();
          }
        }

        // Full editing/export checks on a phone and desktop; all other sizes exercise layout.
        if (width === 390 || width === 1440) {
          console.log(`  ${name} ${width}: editing`);
          await activate('#new');
          const dialogBox = await page.locator('#dialog').boundingBox();
          check(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= width + 1, 'Dialog fits viewport');
          await page.locator('[name="title"]').fill('Prueba web');
          await page.locator('[name="template"]').selectOption('solo');
          await page.locator('[name="measures"]').fill('4');
          await activate('#dialogform button[type="submit"]');
          await page.locator('.white-key').nth(0)[mobile ? 'tap' : 'click']({position:{x:8,y:50}});
          await activate('#chord-input');
          await page.locator('.white-key').nth(2)[mobile ? 'tap' : 'click']({position:{x:8,y:50}});
          check(await page.evaluate(() => JSON.stringify(Partitura.getScore().parts[0].measures[0].notes[0].pitches)) === '[48,52]', 'Onscreen chord entry');
          await activate('#chord-input');
          await activate('#undo');
          check(await page.evaluate(() => Partitura.getScore().parts[0].measures[0].notes[0].pitches.length) === 1, 'Undo');
          await activate('#redo');
          if (mobile) {
            await activate('#toggle-tools');
            await activate('[data-finale-tool="lyrics"]');
            check(await page.locator('#document-panel').isVisible(), 'Lyric tool opens document panel');
            await page.locator('#lyric').fill('Do');
            await activate('#document-panel [data-close-panel]');
            check(await page.evaluate(() => Partitura.getScore().parts[0].measures[0].notes[0].lyric) === 'Do', 'Touch lyric editing');
          }

          for (const [button, extension, signature] of [['save','.rickmusic','{'],['xml','.musicxml','<?xml'],['midi','.mid','MThd']]) {
            console.log(`  ${name} ${width}: ${extension} download/import`);
            const pending = page.waitForEvent('download');
            await activate('#' + button);
            const download = await pending;
            check(download.suggestedFilename().endsWith(extension), `Download ${extension}`);
            const path = join(temp, `${name}-${width}${extension}`);
            await download.saveAs(path);
            check((await readFile(path, 'utf8')).startsWith(signature), `Valid ${extension} content`);
            if (button === 'save') check(!await page.evaluate(() => Partitura.hasUnsavedChanges()), 'Browser save marks document saved');
            await page.locator('#file').setInputFiles(path);
            await page.waitForFunction(() => document.getElementById('file').value === '');
            check(await page.evaluate(() => Partitura.getScore().parts[0].measures[0].notes[0].pitches.length) === 2, `Import ${extension} preserves chord`);
          }
          await activate('#play');
          await page.waitForFunction(() => document.getElementById('play').textContent.includes('Detener'));
          check(await page.locator('#status').textContent() === 'Reproducción con síntesis local', 'Browser audio starts');
          await page.waitForFunction(() => {
            const audio = window.__audioProbe.sample();
            return audio.state === 'running' && audio.rms > 1e-4;
          });
          const audio = await page.evaluate(() => window.__audioProbe.sample());
          check(audio.contexts > 0 && audio.state === 'running' && audio.rms > 1e-4, 'Playback generates a nonzero audio signal');
          if (audio.hasAudioSession) {
            check(audio.sessionType === 'playback', 'Real audio session uses music playback');
            check(audio.sessionTypesAtCreation.every(type => type === 'playback'), 'Playback session is configured before creating audio contexts');
          }
          await activate('#stop');
          check((await page.locator('#play').textContent()).includes('Reproducir'), 'Browser audio stops');
          await page.waitForFunction(() => window.__audioProbe.sample().rms < 1e-5);
          check((await page.evaluate(() => window.__audioProbe.sample())).rms < 1e-5, 'Stopping playback silences the actual audio signal');

          const pending = page.waitForEvent('download');
          console.log(`  ${name} ${width}: MP3`);
          await activate('#mp3');
          await page.locator('[name="bitrate"]').selectOption('128');
          await activate('#dialogform button[type="submit"]');
          const download = await pending;
          const mp3Path = join(temp, `${name}-${width}.mp3`);
          await download.saveAs(mp3Path);
          const bytes = await readFile(mp3Path);
          check(bytes.subarray(0,3).toString() === 'ID3' && bytes.length > 20000, 'Actual MP3 audio downloads');

          if (mobile) {
            await activate('#toggle-tools');
            await activate('[data-finale-tool="hyperscribe"]');
          } else await activate('[data-finale-tool="hyperscribe"]');
          await activate('#dialogform button[type="submit"]');
          const key = page.locator('.white-key').nth(0);
          const before = await page.evaluate(() => Partitura.getScore().parts[0].measures[0].notes.length);
          await key.dispatchEvent('pointerdown', {pointerId:77,button:0,pointerType:'touch'});
          await page.waitForTimeout(140);
          await key.dispatchEvent('pointerup', {pointerId:77,button:0,pointerType:'touch'});
          await key.dispatchEvent('click');
          check(await page.evaluate(() => Partitura.getScore().parts[0].measures[0].notes.length) === before, 'Recording does not insert duplicate live notes');
          await activate('#record-stop');
          check(await page.evaluate(() => Partitura.getScore().parts[0].measures[0].notes.length) === 1, 'Touch performance transcribes exactly one note');

          if (mobile) {
            await page.evaluate(() => {
              const score = Partitura.getScore();
              score.tempo = 20;
              score.parts[0].measures = Array.from({length:26},(_,i)=>i ? {notes:[]} : score.parts[0].measures[0]);
              Partitura.setScore(score);
            });
            await activate('#mp3');
            await activate('#dialogform button[type="submit"]');
            check((await page.locator('#toast').textContent()).includes('5 minutos'), 'Long mobile exports fail before allocating large audio buffers');
            check(await page.locator('#mp3').isEnabled(), 'Export remains available after duration validation');
          }
          await page.evaluate(() => Partitura.markSaved());
          await page.reload();
          await page.waitForFunction(() => window.Partitura);
          check(await page.evaluate(() => Partitura.getScore().parts[0].measures[0].notes.length) === 1, 'Autosave survives reload');
        }
        check(errors.length === 0, `${name} ${width}: ${errors.join('; ')}`);
        console.log(`PASS ${name} ${width}×${height}`);
        await context.close();
      }
    } finally { await browser.close(); }
  }
  console.log(`${checks} browser checks passed.`);
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(temp, {recursive:true,force:true});
}
