/**
 * Capture-phase Escape guard.
 *
 * Radix Dialog/Sheet closes on Escape by bubbling. When the user is actively
 * typing in an INPUT, TEXTAREA, or contenteditable element the Escape should
 * clear the field (or do nothing), not dismiss the dialog and cascade into
 * signOut. This listener sits at the capture phase — before Radix sees the
 * event — and stops propagation when focus is in a text entry element.
 *
 * It does NOT stop Escape when focus is on a button or the document body, so
 * dialogs still close normally when the user is not typing.
 *
 * Call installEscapeGuard() once at app bootstrap (before React mounts).
 */
export function installEscapeGuard(): void {
  window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
        event.stopPropagation();
      }
    },
    true, // capture phase
  );
}
