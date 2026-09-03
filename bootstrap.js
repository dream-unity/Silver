const BUILD = '20260903-deleted-memories-1';
const versioned = path => `${path}?v=${BUILD}`;

const assets = {
  shell: versioned('./src/shell.html'),
  styles: versioned('./src/styles.css'),
  app: versioned('./src/app.js')
};

let viewportFrame = 0;
function syncVisualViewport() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const visualHeight = Math.max(1, Math.round(globalThis.visualViewport?.height || globalThis.innerHeight || document.documentElement.clientHeight));
    document.documentElement.style.setProperty('--silver-visual-viewport-height', `${visualHeight}px`);
  });
}

syncVisualViewport();
globalThis.addEventListener('resize', syncVisualViewport, { passive: true });
globalThis.addEventListener('orientationchange', syncVisualViewport, { passive: true });
globalThis.visualViewport?.addEventListener('resize', syncVisualViewport, { passive: true });
globalThis.visualViewport?.addEventListener('scroll', syncVisualViewport, { passive: true });

aSyncBoot();

async function fetchText(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Silver could not load ${path} (${response.status}).`);
  return response.text();
}

async function aSyncBoot() {
  try {
    const [markup, styles] = await Promise.all([
      fetchText(assets.shell),
      fetchText(assets.styles)
    ]);

    document.getElementById('silverStyles').textContent = styles;
    document.getElementById('boot').outerHTML = markup;
    await import(new URL(assets.app, import.meta.url).href);
    syncVisualViewport();
  } catch (error) {
    console.error(error);
    const target = document.getElementById('boot') || document.body;
    const message = String(error.message || error).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
    target.innerHTML = `<div class="boot-error"><div class="boot-mark">S</div><h1>Silver could not open</h1><p>${message}</p><button type="button" onclick="location.reload()">Try again</button></div>`;
  }
}
