/**
 * The product tour and the cookie bar both want the bottom of the screen.
 * The tour holds the bar until it finishes instead of stacking on top of it.
 */
let active = false;
const listeners = new Set<() => void>();

export function isProductTourActive(): boolean {
  return active;
}

export function setProductTourActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener();
}

export function subscribeProductTourActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
