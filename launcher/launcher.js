'use strict';
(() => {
  const status = document.querySelector('#status'), detail = document.querySelector('#detail');
  const progress = document.querySelector('#progress'), fill = document.querySelector('#progress-fill');
  const label = document.querySelector('#progress-label'), version = document.querySelector('#version');
  const operation = document.querySelector('#operation'), steps = [...document.querySelectorAll('[data-step]')];
  const order = { checking: 0, downloading: 1, verifying: 2, extracting: 2, starting: 3, fallback: 3 };
  const descriptions = {
    checking: 'Neue Versionen werden automatisch geladen. Danach startet dein Spiel.',
    downloading: 'Das Update lädt im Hintergrund. Gleich geht es automatisch weiter.',
    verifying: 'Die heruntergeladenen Dateien werden geprüft.',
    extracting: 'Deine neue Version wird vorbereitet. Dein Spielstand bleibt erhalten.',
    starting: 'Alles bereit. Dein Spiel öffnet sich automatisch.',
    fallback: 'Du kannst mit der vorhandenen Version spielen. Beim nächsten Start prüfen wir erneut.'
  };
  const megabytes = value => (value / 1024 ** 2).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  function update(event = {}) {
    const phase = Object.hasOwn(order, event.phase) ? event.phase : 'checking';
    const percent = Number.isFinite(event.percent) ? Math.max(0, Math.min(100, event.percent)) : null;
    document.body.dataset.phase = phase;
    status.textContent = typeof event.message === 'string' ? event.message : 'Updates werden geprüft';
    detail.textContent = phase === 'downloading' && Number.isFinite(event.bytes) && Number.isFinite(event.total)
      ? `${megabytes(event.bytes)} / ${megabytes(event.total)} MB · Gleich geht es automatisch weiter.` : descriptions[phase];
    if (typeof event.version === 'string') version.textContent = `VERSION ${event.version}`;
    operation.textContent = phase === 'fallback' ? 'UPDATE NICHT VERFÜGBAR' : phase === 'starting' ? 'EINSATZ BEREIT' : 'EINSATZ WIRD VORBEREITET';
    const complete = phase === 'starting' || phase === 'fallback';
    progress.classList.toggle('indeterminate', percent === null && !complete);
    fill.style.width = `${complete ? 100 : percent ?? 28}%`;
    if (percent === null && !complete) progress.removeAttribute('aria-valuenow');
    else progress.setAttribute('aria-valuenow', String(complete ? 100 : Math.round(percent)));
    progress.setAttribute('aria-valuetext', status.textContent);
    label.textContent = complete ? 'BEREIT' : percent === null ? '···' : `${Math.floor(percent)} %`;
    for (const step of steps) {
      const index = order[step.dataset.step];
      step.classList.toggle('active', index === order[phase]);
      step.classList.toggle('done', index < order[phase]);
    }
  }
  update();
  const unsubscribe = window.launcher?.onProgress(update);
  window.addEventListener('pagehide', () => unsubscribe?.(), { once: true });
})();
