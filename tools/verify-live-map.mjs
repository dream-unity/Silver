import fs from 'node:fs';

const targetPath = process.env.TARGET_JSON || '/tmp/silver-live/target.json';
const outputDirectory = process.env.OUTPUT_DIR || '/tmp/silver-live';
const targetUrl = process.env.TARGET_URL || '';

if (typeof WebSocket !== 'function') {
  throw new Error(`Node ${process.version} does not expose the WebSocket API required for Chrome verification.`);
}

const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
if (!target.webSocketDebuggerUrl) {
  throw new Error('Chrome did not expose a page debugging endpoint.');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
const logErrors = [];
let sequence = 0;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools.')), 10_000);
  socket.addEventListener('open', () => {
    clearTimeout(timeout);
    resolve();
  }, { once: true });
  socket.addEventListener('error', () => {
    clearTimeout(timeout);
    reject(new Error('Chrome DevTools WebSocket connection failed.'));
  }, { once: true });
});

socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    clearTimeout(operation.timeout);
    if (message.error) operation.reject(new Error(`${operation.method}: ${message.error.message}`));
    else operation.resolve(message.result || {});
    return;
  }

  if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params?.exceptionDetails || message.params);
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
    consoleErrors.push(
      message.params.args?.map(argument => argument.value || argument.description).join(' ') || 'console.error',
    );
  } else if (message.method === 'Log.entryAdded' && ['error', 'fatal'].includes(message.params?.entry?.level)) {
    logErrors.push(message.params.entry);
  }
});

function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}.`));
    }, 20_000);
    pending.set(id, { resolve, reject, timeout, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Browser evaluation failed.',
    );
  }
  return result.result?.value;
}

async function waitFor(expression, predicate, description, attempts = 160, delay = 250) {
  let value = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      value = await evaluate(expression);
      if (predicate(value)) return value;
    } catch {
      // Navigation and iframe creation can replace execution contexts while polling.
    }
    await sleep(delay);
  }
  throw new Error(`${description}. Last state: ${JSON.stringify(value)}`);
}

async function screenshot(name) {
  const result = await command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(`${outputDirectory}/${name}.png`, Buffer.from(result.data, 'base64'));
}

await command('Page.enable');
await command('Runtime.enable');
await command('Log.enable');
await command('Page.bringToFront');

const readinessExpression = `(() => {
  const text = document.body?.innerText || '';
  const journal = document.querySelector('[data-journal-id="journal-personal"]');
  const mapButton = document.querySelector('[data-action="open-mind-map"]');
  const prompt = document.querySelector('.prompt-card');
  const mapRect = mapButton?.getBoundingClientRect();
  const promptRect = prompt?.getBoundingClientRect();
  return {
    title: document.title,
    readyState: document.readyState,
    journalReady: Boolean(journal),
    todayReady: text.includes('Your latest entries'),
    mapButtonReady: mapButton?.tagName === 'BUTTON',
    mapButtonTitle: mapButton?.getAttribute('title') || '',
    mapButtonAria: mapButton?.getAttribute('aria-label') || '',
    mapButtonText: mapButton?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    oldMemoryMessagePresent: text.includes('Your memories will return here'),
    mapIsRightOfPrompt: Boolean(mapRect && promptRect && mapRect.left > promptRect.left),
    fatal: text.includes('Silver could not open'),
    viewLength: document.querySelector('#viewRoot')?.innerText?.length || 0,
    bodyExcerpt: text.slice(0, 1400)
  };
})()`;

const readiness = await waitFor(
  readinessExpression,
  value => value?.journalReady && value?.todayReady && value?.mapButtonReady && value?.viewLength > 0,
  'Silver did not finish initializing with Map Your Mind',
);
if (readiness.fatal) throw new Error(`Silver rendered its fatal state: ${readiness.bodyExcerpt}`);
if (readiness.mapButtonTitle !== 'Map Your Mind') {
  throw new Error(`Unexpected Map Your Mind title: ${readiness.mapButtonTitle}`);
}
if (readiness.mapButtonAria !== 'Map Your Mind') {
  throw new Error(`Unexpected Map Your Mind accessible name: ${readiness.mapButtonAria}`);
}
if (!readiness.mapButtonText.includes('Map Your Mind')) {
  throw new Error(`Unexpected Map Your Mind text: ${readiness.mapButtonText}`);
}
if (readiness.oldMemoryMessagePresent) {
  throw new Error('The replaced memory placeholder is still visible.');
}
if (!readiness.mapIsRightOfPrompt) {
  throw new Error('Map Your Mind is not in the Today view upper-right card position.');
}
await screenshot('silver-before-map');

await evaluate(`(() => {
  document.querySelector('#newEntryButton')?.click();
  return true;
})()`);

await waitFor(
  `Boolean(document.querySelector('#entryDialog')?.open)`,
  Boolean,
  'The live New entry control did not open the editor',
  60,
  100,
);

const editorViewport = await evaluate(`(() => {
  const dialog = document.querySelector('#entryDialog');
  const footer = document.querySelector('.editor-footer');
  const rect = dialog?.getBoundingClientRect();
  const footerRect = footer?.getBoundingClientRect();
  return {
    dialogOpen: Boolean(dialog?.open),
    dialogWithinWidth: Boolean(rect && rect.left >= -1 && rect.right <= innerWidth + 1),
    dialogWithinHeight: Boolean(rect && rect.top >= -1 && rect.bottom <= innerHeight + 1),
    footerVisible: Boolean(footerRect && footerRect.top < innerHeight && footerRect.bottom <= innerHeight + 1)
  };
})()`);
if (!editorViewport.dialogOpen || !editorViewport.dialogWithinWidth || !editorViewport.dialogWithinHeight || !editorViewport.footerVisible) {
  throw new Error(`Silver's existing 100% zoom editor regressed: ${JSON.stringify(editorViewport)}`);
}

await evaluate(`(() => {
  const setValue = (selector, value) => {
    const control = document.querySelector(selector);
    if (!control) throw new Error('Missing control: ' + selector);
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setValue('#entryTitle', 'Live deployment verification');
  setValue('#entryBody', 'Silver preserved this entry before and after opening the isolated mind-map application.');
  document.querySelector('#saveEntryButton')?.click();
  return true;
})()`);

const saved = await waitFor(
  `(() => {
    const text = document.body?.innerText || '';
    return {
      editorOpen: Boolean(document.querySelector('#entryDialog')?.open),
      entryVisible: text.includes('Live deployment verification'),
      cardCount: document.querySelectorAll('.entry-card').length,
      fatal: text.includes('Silver could not open')
    };
  })()`,
  value => !value?.editorOpen && value?.entryVisible && value?.cardCount > 0,
  'The Silver entry did not save and render',
);
if (saved.fatal) throw new Error('Silver entered its fatal state while saving the verification entry.');

await evaluate(`(() => {
  document.querySelector('[data-action="open-mind-map"]')?.click();
  return true;
})()`);

const mapStart = await waitFor(
  `(() => {
    const dialog = document.querySelector('#mindMapDialog');
    const frame = document.querySelector('#mindMapFrame');
    const dialogRect = dialog?.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    let frameText = '';
    let frameReady = false;
    let frameUrl = '';
    try {
      frameText = frame?.contentDocument?.body?.innerText || '';
      frameReady = frame?.contentDocument?.readyState === 'complete';
      frameUrl = frame?.contentWindow?.location?.href || '';
    } catch {}
    return {
      dialogOpen: Boolean(dialog?.open),
      dialogFillsViewport: Boolean(dialogRect && dialogRect.width >= innerWidth - 2 && dialogRect.height >= (visualViewport?.height || innerHeight) - 2),
      frameFillsDialog: Boolean(frameRect && dialogRect && frameRect.width >= dialogRect.width - 2 && frameRect.height >= dialogRect.height - 2),
      returnControlVisible: Boolean(document.querySelector('#closeMindMapButton')?.getBoundingClientRect().width),
      frameReady,
      frameUrl,
      hasStartMenu: frameText.includes('Your maps'),
      hasBlankMapControl: frameText.includes('Create blank map'),
      frameText: frameText.slice(0, 1400)
    };
  })()`,
  value => value?.dialogOpen && value?.frameReady && value?.hasStartMenu && value?.hasBlankMapControl,
  'The copied Theory application did not open inside Silver',
);
if (!mapStart.frameUrl.includes('/Silver/mind-map/')) {
  throw new Error(`Theory loaded from the wrong location: ${mapStart.frameUrl}`);
}
if (!mapStart.dialogFillsViewport || !mapStart.frameFillsDialog || !mapStart.returnControlVisible) {
  throw new Error(`Map Your Mind did not fill the available viewport: ${JSON.stringify(mapStart)}`);
}
await screenshot('map-your-mind-start');

await evaluate(`(() => {
  const frame = document.querySelector('#mindMapFrame');
  const win = frame?.contentWindow;
  const doc = frame?.contentDocument;
  const input = doc?.querySelector('.start-create input');
  if (!win || !input) throw new Error('Theory new-map input was not available.');
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(input, 'Silver Mind Map Verification');
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(150);
await evaluate(`(() => {
  const doc = document.querySelector('#mindMapFrame')?.contentDocument;
  const submit = doc?.querySelector('.start-create button[type="submit"]');
  if (!submit) throw new Error('Theory create-map button was not available.');
  submit.click();
  return true;
})()`);

const mapOpen = await waitFor(
  `(() => {
    const doc = document.querySelector('#mindMapFrame')?.contentDocument;
    const text = doc?.body?.innerText || '';
    return {
      brainShell: Boolean(doc?.querySelector('.brain-shell')),
      normal: text.includes('Normal'),
      outline: text.includes('Outline'),
      mindMap: text.includes('Mind Map'),
      cards: text.includes('Cards'),
      title: text.includes('Silver Mind Map Verification')
    };
  })()`,
  value => value?.brainShell && value?.normal && value?.outline && value?.mindMap && value?.cards && value?.title,
  'Theory did not create and open a blank mind map',
);

await evaluate(`(() => {
  const frame = document.querySelector('#mindMapFrame');
  const win = frame?.contentWindow;
  if (!win) throw new Error('Theory window was not available.');
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'F6', code: 'F6', bubbles: true }));
  return true;
})()`);

await waitFor(
  `Boolean(document.querySelector('#mindMapFrame')?.contentDocument?.querySelector('.composer input'))`,
  Boolean,
  'Theory did not open its linked-thought composer',
  80,
  100,
);

await evaluate(`(() => {
  const frame = document.querySelector('#mindMapFrame');
  const win = frame?.contentWindow;
  const input = frame?.contentDocument?.querySelector('.composer input');
  if (!win || !input) throw new Error('Theory linked-thought composer was not available.');
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(input, 'Verification Thought');
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(150);
await evaluate(`(() => {
  const doc = document.querySelector('#mindMapFrame')?.contentDocument;
  const submit = doc?.querySelector('.composer button[type="submit"]');
  if (!submit) throw new Error('Theory linked-thought Create button was not available.');
  submit.click();
  return true;
})()`);

const mapCreated = await waitFor(
  `(() => {
    const frame = document.querySelector('#mindMapFrame');
    const doc = frame?.contentDocument;
    const text = doc?.body?.innerText || '';
    let library = null;
    try {
      library = JSON.parse(frame?.contentWindow?.localStorage?.getItem('dream-unity-library-v1') || 'null');
    } catch {}
    return {
      thoughtVisible: text.includes('Verification Thought'),
      thoughtButtons: [...(doc?.querySelectorAll('button') || [])].some(button => button.textContent?.includes('Verification Thought')),
      libraryItems: library?.items?.length || 0,
      activeMap: Boolean(library?.activeId),
      dialogOpen: Boolean(document.querySelector('#mindMapDialog')?.open),
      silverEntryRetained: (document.body?.innerText || '').includes('Live deployment verification')
    };
  })()`,
  value => value?.thoughtVisible && value?.thoughtButtons && value?.libraryItems > 0 && value?.activeMap,
  'Theory did not create and persist a linked thought',
);
if (!mapCreated.dialogOpen) throw new Error('The mind-map dialog closed during Theory interaction.');
if (!mapCreated.silverEntryRetained) {
  throw new Error('Silver content disappeared while the isolated map was open.');
}
await sleep(400);
await screenshot('map-your-mind-working');

await evaluate(`(() => {
  document.querySelector('#closeMindMapButton')?.click();
  return true;
})()`);

const returned = await waitFor(
  `(() => {
    const text = document.body?.innerText || '';
    return {
      dialogOpen: Boolean(document.querySelector('#mindMapDialog')?.open),
      bodyLocked: document.body?.classList.contains('mind-map-open'),
      mapButtonReady: Boolean(document.querySelector('[data-action="open-mind-map"]')),
      entryVisible: text.includes('Live deployment verification'),
      todayReady: text.includes('Your latest entries')
    };
  })()`,
  value => !value?.dialogOpen && !value?.bodyLocked && value?.mapButtonReady && value?.entryVisible && value?.todayReady,
  'Silver did not restore correctly after leaving Map Your Mind',
);
await screenshot('silver-after-map');

await evaluate(`document.querySelector('[data-action="open-mind-map"]')?.click()`);
const reopened = await waitFor(
  `(() => {
    const frame = document.querySelector('#mindMapFrame');
    const text = frame?.contentDocument?.body?.innerText || '';
    return {
      dialogOpen: Boolean(document.querySelector('#mindMapDialog')?.open),
      thoughtRetained: text.includes('Verification Thought'),
      correctFrame: (frame?.contentWindow?.location?.href || '').includes('/Silver/mind-map/')
    };
  })()`,
  value => value?.dialogOpen && value?.thoughtRetained && value?.correctFrame,
  'The integrated Theory map did not remain available when reopened',
);
await evaluate(`document.querySelector('#closeMindMapButton')?.click()`);

const html = await evaluate('document.documentElement.outerHTML');
fs.writeFileSync(`${outputDirectory}/dom.html`, html);
const evidence = {
  url: targetUrl,
  checkedAt: new Date().toISOString(),
  readiness,
  editorViewport,
  saved,
  mapStart,
  mapOpen,
  mapCreated,
  returned,
  reopened,
  exceptions,
  consoleErrors,
  logErrors,
};
fs.writeFileSync(
  `${outputDirectory}/browser-evidence.json`,
  JSON.stringify(evidence, null, 2),
);

if (exceptions.length || consoleErrors.length) {
  throw new Error(
    `The live app reported browser errors: ${JSON.stringify({ exceptions, consoleErrors })}`,
  );
}

console.log('PASS: Silver initialized and retained its existing journal behavior.');
console.log('PASS: The existing editor remained visible at 100% zoom.');
console.log('PASS: Map Your Mind replaced the upper-right memory placeholder.');
console.log('PASS: The copied Theory app opened from /Silver/mind-map/.');
console.log('PASS: A blank map and linked thought were created and persisted.');
console.log('PASS: Returning to Silver restored the unchanged journal interface.');
console.log('PASS: Reopening retained the Theory mind map.');
socket.close();
