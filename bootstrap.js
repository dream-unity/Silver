const assets = {
  shell: './src/shell.html',
  styles: './src/styles.css',
  app: './src/app.js'
};

async function fetchText(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Silver could not load ${path} (${response.status}).`);
  return response.text();
}

async function boot() {
  const [markup, styles] = await Promise.all([
    fetchText(assets.shell),
    fetchText(assets.styles)
  ]);

  document.getElementById('silverStyles').textContent = styles;
  document.getElementById('boot').outerHTML = markup;
  await import(new URL(assets.app, import.meta.url).href);
}

boot().catch(error => {
  console.error(error);
  const target = document.getElementById('boot') || document.body;
  const message = String(error.message || error).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  target.innerHTML = `<div class="boot-error"><div class="boot-mark">S</div><h1>Silver could not open</h1><p>${message}</p><button type="button" onclick="location.reload()">Try again</button></div>`;
});
