const assets = {
  shell: './shell.html.gz',
  styles: './styles.css.gz',
  appParts: ['./app.source.1.b64', './app.source.2.b64', './app.source.3.b64']
};

function requireStreams() {
  if (!('DecompressionStream' in globalThis)) {
    throw new Error('Silver needs a current browser with gzip stream support. Update Chrome, Edge, Firefox or Safari, then reload.');
  }
}

async function decompressResponse(path) {
  requireStreams();
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok || !response.body) throw new Error(`Silver could not load ${path} (${response.status}).`);
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();
}

async function decompressBase64Parts(paths) {
  requireStreams();
  const responses = await Promise.all(paths.map(path => fetch(path, { cache: 'no-cache' })));
  const failed = responses.find(response => !response.ok);
  if (failed) throw new Error(`Silver could not load its journal engine (${failed.status}).`);
  const encoded = (await Promise.all(responses.map(response => response.text()))).join('');
  const binary = atob(encoded.trim());
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

async function boot() {
  const [markup, styles, sourceText] = await Promise.all([
    decompressResponse(assets.shell),
    decompressResponse(assets.styles),
    decompressBase64Parts(assets.appParts)
  ]);

  document.getElementById('silverStyles').textContent = styles;
  document.getElementById('boot').outerHTML = markup;

  const dbUrl = new URL('./db.js', import.meta.url).href;
  const archiveUrl = new URL('./archive.js', import.meta.url).href;
  const source = sourceText
    .replaceAll("'./db.js'", JSON.stringify(dbUrl))
    .replaceAll("'./archive.js'", JSON.stringify(archiveUrl));
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

boot().catch(error => {
  console.error(error);
  const target = document.getElementById('boot') || document.body;
  const message = String(error.message || error).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  target.innerHTML = `<div class="boot-error"><div class="boot-mark">S</div><h1>Silver could not open</h1><p>${message}</p><button type="button" onclick="location.reload()">Try again</button></div>`;
});
