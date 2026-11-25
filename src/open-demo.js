// Hosted pages use the source modules. A double-click loads the same scene
// from classic scripts, which browsers allow on a local file URL.
(() => {
  const entry = document.currentScript;
  function load(url, type = 'text/javascript') {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = type;
      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error('无法加载 ' + url));
      document.body.appendChild(script);
    });
  }

  async function open() {
    if (location.protocol !== 'file:') {
      await load(entry.dataset.module, 'module');
      return;
    }
    const root = new URL('../', entry.src);
    const name = entry.dataset.offline;
    await load(new URL('vendor/three.global.js', root));
    if (name === 'game') await load(new URL('vendor/vue.global.prod.js', root));
    await load(new URL('src/engine/bundle-' + name + '.js', root));
  }

  open().catch(error => {
    const message = document.createElement('p');
    message.className = 'js-errors';
    message.setAttribute('role', 'alert');
    message.textContent = error.message;
    document.body.appendChild(message);
  });
})();
