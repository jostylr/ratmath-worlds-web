// The greeting for the three worlds whose pages are their own (the
// Mandelbulb, the Library of Babel and the art gallery): what the world is,
// the ways in, and the stops of its tour to go straight to. The pages drawn
// by src/worlds/engine.js have the same card built in, with rides.

const escapeHTML = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Shows the card if the visitor arrived with no place in mind.
 * `stops` are the tour's stop titles; `showStop(index)` opens the tour there.
 */
export function greet({ title, summary, stops, showStop, canvas }) {
  const query = new URLSearchParams(location.search);
  if (location.hash.length > 1 || ['tourStep', 'explorer', 'studio', 'plain'].some(key => query.has(key))) { return; }

  const card = document.createElement('article');
  card.id = 'welcomeCard';
  card.className = 'panel';
  card.innerHTML = `
    <header><p class="eyebrow">Welcome</p>
      <button class="plain" data-close aria-label="Close">✕</button></header>
    <h2>${escapeHTML(title)}</h2>
    <div class="body"><p>${escapeHTML(summary)}</p></div>
    <div class="welcome-actions">
      <button class="prominent" data-stop="0">▶ Guided tour</button>
      <button data-close>Explore on my own</button>
    </div>
    <p class="caption">Or go straight to a stop of the tour:</p>
    <div class="sights">${stops.slice(0, -1).map((stop, index) =>
      `<button class="small" data-stop="${index}">${escapeHTML(stop)}</button>`).join('')}</div>`;
  document.body.append(card);

  // The picture is left clear: the controls are put away while the card is
  // up, and come back, where there is room, for someone exploring alone.
  const controls = document.getElementById('controls');
  const toggle = document.getElementById('controlsToggle');
  const modes = document.getElementById('modeButtons');
  const putAway = controls && toggle && !controls.hidden;
  if (putAway) { toggle.click(); }
  const hidModes = modes && !modes.hidden;
  if (hidModes) { modes.hidden = true; }

  const tourCard = document.getElementById('tourCard');
  const close = explore => {
    if (hidModes && (!tourCard || tourCard.hidden)) { modes.hidden = false; }
    if (explore === true && putAway && controls.hidden && !matchMedia('(max-width: 700px)').matches) { toggle.click(); }
    card.remove();
    watcher.disconnect();
    canvas.removeEventListener('pointerdown', close);
    removeEventListener('hashchange', close);
  };
  card.addEventListener('click', event => {
    const stop = event.target.closest('[data-stop]');
    if (stop) { close(); showStop(Number(stop.dataset.stop)); }
    const closing = event.target.closest('[data-close]');
    if (closing) { close(closing.textContent.startsWith('Explore')); }
  });
  // Taking hold of the picture, or starting the tour some other way, is
  // answer enough.
  canvas.addEventListener('pointerdown', close);
  addEventListener('hashchange', close);
  const watcher = new MutationObserver(() => { if (tourCard && !tourCard.hidden) { close(); } });
  if (tourCard) { watcher.observe(tourCard, { attributes: true, attributeFilter: ['hidden'] }); }
}
