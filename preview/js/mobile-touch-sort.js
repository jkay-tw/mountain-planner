// Issue #10: touch-first sorting for rest / manual-location rows in Preview.
// The existing day reorder callback remains responsible for re-normalizing routes.
export function dropSlotAtY(rects, y) {
  if (!rects.length) return 0;
  for (const rect of rects) {
    if (y < (rect.top + rect.bottom) / 2) return rect.index;
  }
  return rects[rects.length - 1].index + 1;
}

export function insertionIndex(from, slot, count) {
  if (!Number.isInteger(from) || !Number.isInteger(slot) || from < 0 ||
      from >= count || slot < 0 || slot > count) return null;
  return Math.max(0, Math.min(count - 1, slot - (from < slot ? 1 : 0)));
}

export function bindMobileTouchSort(card, dayIndex, onDrop) {
  const rows = [...card.querySelectorAll('.timeline .it-row[data-index]')];
  const sources = rows.filter(row => row.querySelector('.drag-handle'));
  if (!sources.length) return;
  let gesture = null;
  let holdTimer = null;
  let autoFrame = null;
  let ghost = null;

  const findTouch = (list, id) => [...list].find(t => t.identifier === id);
  const clearMarkers = () => rows.forEach(row =>
    row.classList.remove('touch-drop-before', 'touch-drop-after'));

  function clear() {
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    if (autoFrame !== null) cancelAnimationFrame(autoFrame);
    autoFrame = null;
    clearMarkers();
    if (gesture) gesture.row.classList.remove('touch-dragging');
    if (ghost) ghost.remove();
    ghost = null;
    gesture = null;
  }

  function slotForY(y) {
    const rects = rows.map(row => {
      const rect = row.getBoundingClientRect();
      return {index: Number(row.dataset.index), top: rect.top, bottom: rect.bottom};
    });
    return dropSlotAtY(rects, y);
  }

  function mark(slot) {
    clearMarkers();
    const next = rows.find(row => Number(row.dataset.index) === slot);
    if (next) next.classList.add('touch-drop-before');
    else rows[rows.length - 1]?.classList.add('touch-drop-after');
  }

  function update(y) {
    if (!gesture?.active) return;
    gesture.lastY = y;
    gesture.slot = slotForY(y);
    mark(gesture.slot);
    if (ghost) ghost.style.top = Math.max(8, Math.min(window.innerHeight - 50, y - 23)) + 'px';
  }

  function edgeSpeed(y) {
    const boundary = Math.min(90, window.innerHeight * 0.16);
    if (y < boundary) return -Math.max(3, Math.round(14 * (boundary - y) / boundary));
    if (y > window.innerHeight - boundary)
      return Math.max(3, Math.round(14 * (y - window.innerHeight + boundary) / boundary));
    return 0;
  }

  function scrollFrame() {
    autoFrame = null;
    if (!gesture?.active) return;
    const speed = edgeSpeed(gesture.lastY);
    if (speed) {
      window.scrollBy(0, speed);
      update(gesture.lastY);
    }
    autoFrame = requestAnimationFrame(scrollFrame);
  }

  function activate() {
    if (!gesture || gesture.active) return;
    gesture.active = true;
    gesture.row.classList.add('touch-dragging');
    const rect = gesture.row.getBoundingClientRect();
    const label = gesture.row.querySelector('.manual-name')?.value ||
                  gesture.row.querySelector('.place-name')?.textContent?.trim() ||
                  '行程項目';
    ghost = document.createElement('div');
    ghost.className = 'mobile-drag-ghost';
    ghost.textContent = '⋮⋮ ' + label;
    ghost.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 190)) + 'px';
    ghost.style.width = Math.min(250, window.innerWidth - 20) + 'px';
    document.body.appendChild(ghost);
    update(gesture.lastY);
    autoFrame = requestAnimationFrame(scrollFrame);
  }

  for (const row of sources) {
    row.classList.add('touch-sortable');
    row.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) { clear(); return; }
      if (gesture) clear();
      const target = event.target;
      const handle = target.closest('.drag-handle');
      if (!handle && target.closest('input, textarea, select, button, a, summary, .row-menu, [contenteditable]')) return;
      const touch = event.touches[0];
      gesture = {
        row, from: Number(row.dataset.index), id: touch.identifier,
        startX: touch.clientX, startY: touch.clientY, lastY: touch.clientY,
        active: false, slot: null
      };
      if (handle) {
        // Suppress native drag/selection only on the handle, not on the row.
        event.preventDefault();
        activate();
      } else {
        holdTimer = setTimeout(activate, 380);
      }
    }, {passive: false});

    row.addEventListener('touchmove', event => {
      if (!gesture || gesture.row !== row) return;
      const touch = findTouch(event.touches, gesture.id);
      if (!touch) { clear(); return; }
      if (!gesture.active) {
        if (Math.hypot(touch.clientX - gesture.startX,
                       touch.clientY - gesture.startY) > 10) clear();
        return; // Ordinary vertical scrolling remains browser-controlled.
      }
      if (event.cancelable) event.preventDefault();
      update(touch.clientY);
    }, {passive: false});

    row.addEventListener('touchend', event => {
      if (!gesture || gesture.row !== row ||
          !findTouch(event.changedTouches, gesture.id)) return;
      const wasActive = gesture.active;
      const from = gesture.from;
      const slot = gesture.slot;
      if (wasActive && event.cancelable) event.preventDefault();
      clear();
      if (wasActive && slot !== null && insertionIndex(from, slot, rows.length) !== from)
        onDrop(dayIndex, from, slot);
    }, {passive: false});
    row.addEventListener('touchcancel', clear);
    row.addEventListener('contextmenu', event => {
      if (gesture?.row === row && gesture.active) event.preventDefault();
    });
  }
}
