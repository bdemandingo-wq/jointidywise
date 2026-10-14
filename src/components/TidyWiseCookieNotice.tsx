import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BANNER_BODY, DO_NOT_SELL_LABEL, DO_NOT_SELL_PATH } from '@/lib/tidywiseSitePrivacy';

const FADE_MS = 180;

function focusMainHeading(): void {
  const heading = document.querySelector('main h1') ?? document.querySelector('h1');
  if (!(heading instanceof HTMLElement)) return;
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function isModifiedClick(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

/** rgb()/rgba() with alpha 1. Translucent surfaces are not copied onto the bar. */
function opaqueBackground(node: Element | null): string | null {
  if (!node) return null;
  const value = getComputedStyle(node).backgroundColor;
  const match = value.match(/^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:[\s,/]+([\d.]+))?\s*\)$/);
  if (!match) return null;
  const alpha = match[1] === undefined ? 1 : Number(match[1]);
  return alpha >= 1 ? value : null;
}

function pageSurfaceColor(): string | null {
  return opaqueBackground(document.querySelector('.portal-v2'))
    ?? opaqueBackground(document.body);
}

/**
 * Notice bar for TidyWise's own marketing and signup pages.
 * OK stores acknowledged. The Do Not Sell link stores opted_out immediately,
 * before the fade, and still lets a modified click open a new tab.
 * There is no dismiss X. Closing unmounts the bar.
 */
export function TidyWiseCookieNotice({
  onAcknowledge,
  onOptOut,
  onClosed,
}: {
  onAcknowledge: () => void;
  /** Persists opted_out and revokes tags. Returns whether storage accepted the write. */
  onOptOut: () => boolean;
  onClosed: () => void;
}) {
  const navigate = useNavigate();
  const barRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closed = useRef(false);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () => {
      const surface = pageSurfaceColor();
      if (surface) el.style.backgroundColor = surface;
      document.documentElement.style.setProperty('--tw-cookie-bar-height', `${el.offsetHeight}px`);
      document.documentElement.classList.add('tw-cookie-notice-open');
    };
    apply();
    const resize = new ResizeObserver(apply);
    resize.observe(el);
    // The bar mounts before a lazy route paints its surface. Re-sample when
    // that page arrives so the fill matches the surface on screen.
    const root = document.getElementById('root');
    const mutations = new MutationObserver(apply);
    if (root) mutations.observe(root, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
      document.documentElement.style.removeProperty('--tw-cookie-bar-height');
      document.documentElement.classList.remove('tw-cookie-notice-open');
    };
  }, []);

  const finish = (action: () => void) => {
    if (closed.current) return;
    closed.current = true;
    setClosing(true);
    window.setTimeout(() => {
      action();
      onClosed();
    }, FADE_MS);
  };

  return (
    <div
      ref={barRef}
      className="tw-cookie-notice"
      data-closing={closing ? 'true' : 'false'}
      role="region"
      aria-label="Cookie notice"
    >
      <div className="tw-cookie-notice__row">
        <p className="tw-cookie-notice__copy">
          {BANNER_BODY}{' '}
          <Link
            to={DO_NOT_SELL_PATH}
            className="tw-cookie-notice__link"
            onClick={(event) => {
              // Save before the fade. A ctrl/cmd/middle click still opens the
              // browser's new tab; this page opts out either way.
              const stored = onOptOut();
              if (isModifiedClick(event)) {
                onClosed();
                return;
              }
              event.preventDefault();
              finish(() => {
                if (stored) {
                  window.location.assign(DO_NOT_SELL_PATH);
                  return;
                }
                navigate(DO_NOT_SELL_PATH);
              });
            }}
          >
            {DO_NOT_SELL_LABEL}
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/privacy-policy" className="tw-cookie-notice__link">
            Privacy Policy
          </Link>
        </p>
        <button
          type="button"
          className="tw-cookie-notice__ok"
          onClick={() => {
            onAcknowledge();
            finish(() => focusMainHeading());
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
