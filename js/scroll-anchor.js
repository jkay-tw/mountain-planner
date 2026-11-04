/**
 * Keep the visible day card at the same viewport position across itinerary
 * redraws. Replacing a focused subtree can make iOS WebKit scroll upward.
 */
export function captureScrollAnchor(container, viewport = window) {
  const scrollY = viewport.scrollY || 0;
  const height = viewport.innerHeight || 0;
  const cards = container?.querySelectorAll('.day-card') || [];
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom > 12 && rect.top < height - 12) {
      return { scrollY, dayId: card.dataset.dayId || null, top: rect.top };
    }
  }
  return { scrollY, dayId: null, top: null };
}

export function restoreScrollAnchor(anchor, container, viewport = window) {
  if (!anchor) return;
  let targetY = anchor.scrollY;
  if (anchor.dayId && Number.isFinite(anchor.top)) {
    const card = Array.from(container?.querySelectorAll('.day-card') || [])
      .find(el => el.dataset.dayId === anchor.dayId);
    if (card) {
      // The current rect already includes any browser-initiated scrolling.
      targetY = (viewport.scrollY || 0) + card.getBoundingClientRect().top - anchor.top;
    }
  }
  // Let the browser clamp naturally when removing content shortens the page.
  viewport.scrollTo(0, Math.max(0, Math.round(targetY)));
}
