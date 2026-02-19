export function suppressQuickAddPointerEvents(addInput) {
  if (!addInput || typeof addInput.addEventListener !== 'function') return;

  // Prevent row-level click handlers from firing when users click into quick-add inputs.
  addInput.addEventListener('mousedown', (event) => {
    if (!event || event.button !== 0) return;
    if (typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
  });

  addInput.addEventListener('click', (event) => {
    if (typeof event?.stopPropagation === 'function') {
      event.stopPropagation();
    }
  });
}
