export function focusInspector(id) {
  document.dispatchEvent(new Event('rickmusic:inspector'));
  document.getElementById(id).focus();
}

// Keep the score available while exposing the full desktop tools on touch screens.
export function setupResponsive(renderScore) {
  const $ = id => document.getElementById(id);
  const narrow = matchMedia('(max-width: 900px)');
  let panel = null;
  function showPanel(name, restoreFocus = false) {
    const previous = panel;
    panel = narrow.matches ? name : null;
    document.body.dataset.panel = panel || '';
    $('panel-backdrop').hidden = !panel;
    for (const key of ['tools', 'inspector']) {
      $('toggle-' + key).setAttribute('aria-expanded', String(panel === key));
    }
    if (restoreFocus && previous) $('toggle-' + previous).focus();
  }
  for (const key of ['tools', 'inspector']) {
    $('toggle-' + key).onclick = () => {
      showPanel(panel === key ? null : key);
      if (panel) $(key === 'tools' ? 'tool-panel' : 'document-panel').querySelector('[data-close-panel]').focus();
    };
  }
  $('panel-backdrop').onclick = () => showPanel(null, true);
  document.querySelectorAll('[data-close-panel]').forEach(button => {
    button.onclick = () => showPanel(null, true);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel && !$('dialog').open) showPanel(null, true);
  });
  $('tool-panel').addEventListener('click', event => {
    if (!event.target.closest('#tool-palette button, .basic-tools button')) return;
    showPanel($('document-panel').contains(document.activeElement) ? 'inspector' : null);
  });
  document.addEventListener('focusin', event => {
    if (narrow.matches && $('document-panel').contains(event.target)) showPanel('inspector');
  });
  document.addEventListener('rickmusic:inspector', () => {
    if (narrow.matches) showPanel('inspector');
  });
  $('fit-score').onclick = () => {
    $('zoom').value = 'fit';
    renderScore();
    $('canvas').scrollLeft = 0;
    showPanel(null);
  };
  if (narrow.matches) $('zoom').value = 'fit';
  narrow.addEventListener('change', () => showPanel(null));
  let width = 0;
  new ResizeObserver(entries => {
    const next = entries[0].contentRect.width;
    if (Math.abs(next - width) < 1) return;
    width = next;
    if ($('zoom').value === 'fit') requestAnimationFrame(renderScore);
  }).observe($('canvas'));
}
