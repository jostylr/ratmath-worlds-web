// Small, shared browser affordances. The pages still need no build step.
export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function sceneURL(hash) {
  const query = new URLSearchParams(location.search);
  query.delete('tourStep');
  query.delete('explorer');
  return location.pathname + (query.size ? '?' + query : '') + hash;
}

export class RenderQuality {
  mode = 'auto';
  scale = 1;
  lastFrame = null;
  frameTime = 16;
  ratio(canvas, moving, now = performance.now()) {
    if (document.hidden) { this.lastFrame = null; }
    if (moving && this.lastFrame !== null && now > this.lastFrame) {
      this.frameTime = this.frameTime * 0.8 + Math.min(now - this.lastFrame, 100) * 0.2;
      if (this.frameTime > 36) { this.scale = Math.max(0.4, this.scale * 0.9); }
      else if (this.frameTime < 20) { this.scale = Math.min(1, this.scale * 1.03); }
    }
    this.lastFrame = moving ? now : null;
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
    const cap = this.mode === 'economy' ? 800 : this.mode === 'high' ? 2400 : coarse ? (moving ? 720 : 1280) : (moving ? 1200 : 2000);
    return Math.min(globalThis.devicePixelRatio || 1, 1.5, cap / Math.max(1, canvas.clientWidth, canvas.clientHeight))
      * (moving && this.mode === 'auto' ? this.scale : 1);
  }
}

const BOOKMARKS = 'ratmath-worlds.bookmarks.v1';
function readBookmarks() {
  try {
    const items = JSON.parse(localStorage.getItem(BOOKMARKS) || '[]');
    return Array.isArray(items) ? items.filter(item => typeof item.title === 'string' && typeof item.url === 'string' && item.url.startsWith(location.origin + '/')).slice(0, 100) : [];
  } catch { return []; }
}

export function mountTools(parent, { link, quality, invalidate = () => {} } = {}) {
  const box = document.createElement('section');
  box.className = 'site-tools';
  const buttons = document.createElement('div');
  buttons.className = 'row';
  const status = document.createElement('p');
  status.className = 'caption';
  status.setAttribute('role', 'status');
  const url = () => new URL(link ? link() : sceneURL(location.hash), location.origin).href;
  if (link) {
    const share = document.createElement('button');
    share.textContent = 'Share view';
    share.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url()); status.textContent = 'Link copied.'; }
      catch {
        status.replaceChildren();
        const fallback = document.createElement('input');
        fallback.type = 'text'; fallback.readOnly = true; fallback.value = url();
        fallback.setAttribute('aria-label', 'Link to this view');
        status.append('Copy this link: ', fallback); fallback.select();
      }
    });
    const save = document.createElement('button');
    save.textContent = 'Bookmark view';
    save.addEventListener('click', () => {
      const items = readBookmarks();
      const address = url();
      const title = document.title.replace('RatMath Worlds: ', '');
      const next = [{ title, url: address }, ...items.filter(item => item.url !== address)].slice(0, 100);
      try { localStorage.setItem(BOOKMARKS, JSON.stringify(next)); status.textContent = 'Saved in this browser. Open Bookmarks to return.'; }
      catch { status.textContent = 'This browser cannot save bookmarks. Use Share view to keep a link.'; }
    });
    buttons.append(share, save);
  }
  const browse = document.createElement('button');
  browse.textContent = 'Bookmarks';
  browse.addEventListener('click', () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'bookmark-dialog panel';
    const title = document.createElement('h2'); title.textContent = 'Saved views';
    const note = document.createElement('p'); note.className = 'caption'; note.textContent = 'Bookmarks stay in this browser.';
    const list = document.createElement('div'); list.className = 'stack';
    const items = readBookmarks();
    if (!items.length) { list.textContent = 'No saved views yet. Bookmark a view from its controls.'; }
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'row';
      const anchor = document.createElement('a'); anchor.href = item.url; anchor.textContent = item.title;
      const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.className = 'small';
      remove.setAttribute('aria-label', 'Remove bookmark for ' + item.title);
      remove.addEventListener('click', () => {
        try { localStorage.setItem(BOOKMARKS, JSON.stringify(readBookmarks().filter(saved => saved.url !== item.url))); row.remove(); }
        catch { note.textContent = 'This browser cannot change saved bookmarks.'; }
      });
      row.append(anchor, remove); list.append(row);
    }
    const close = document.createElement('button'); close.textContent = 'Close'; close.addEventListener('click', () => dialog.close());
    dialog.append(title, note, list, close); document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
  });
  buttons.append(browse); box.append(buttons);
  if (quality) {
    const label = document.createElement('label'); label.className = 'row'; label.append('Picture quality ');
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Picture quality');
    for (const [value, name] of [['auto', 'Auto'], ['economy', 'Economy'], ['high', 'High']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option);
    }
    select.addEventListener('change', () => { quality.mode = select.value; quality.lastFrame = null; invalidate(); });
    label.append(select); box.append(label);
  }
  box.append(status); parent.append(box);
}
