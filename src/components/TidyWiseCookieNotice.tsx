import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BANNER_BODY, DO_NOT_SELL_LABEL, DO_NOT_SELL_PATH } from '@/lib/tidywiseSitePrivacy';

const FADE_MS = 180;

/**
 * Notice bar for TidyWise's own marketing and signup pages.
 * OK stores acknowledged. The Do Not Sell link stores opted_out and opens
 * the opt-out page. There is no dismiss X.
 */
export function TidyWiseCookieNotice({
  onAcknowledge,
  onOptOut,
}: {
  onAcknowledge: () => void;
  onOptOut: () => void;
}) {
  const navigate = useNavigate();
  const barRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closed = useRef(false);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty('--tw-cookie-bar-height', `${el.offsetHeight}px`);
      document.documentElement.classList.add('tw-cookie-notice-open');
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--tw-cookie-bar-height');
      document.documentElement.classList.remove('tw-cookie-notice-open');
    };
  }, []);

  const finish = (action: () => void) => {
    if (closed.current) return;
    closed.current = true;
    setClosing(true);
    window.setTimeout(action, FADE_MS);
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
              event.preventDefault();
              finish(() => {
                onOptOut();
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
          onClick={() => finish(onAcknowledge)}
        >
          OK
        </button>
      </div>
    </div>
  );
}
