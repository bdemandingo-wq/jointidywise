import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';
import { TidyWiseCookieNotice } from '@/components/TidyWiseCookieNotice';
import { loadPrivacyChoice, persistPrivacyChoice, subscribePrivacyChoice } from '@/lib/tidywisePrivacyStore';
import {
  isTidyWiseMarketingOrSignupPath,
  shouldShowCookieNotice,
  type PrivacyChoice,
} from '@/lib/tidywiseSitePrivacy';
import { detectNativePlatform, syncTidyWiseTags } from '@/lib/tidywiseTags';

/**
 * Cookie notice plus TidyWise-owned tags. Mounted once inside the router.
 * Org TrackingPixels on booking pages are a separate component and are not
 * mounted here.
 */
export function TidyWiseSitePrivacy() {
  const { pathname } = useLocation();
  const [choice, setChoice] = useState<PrivacyChoice | null>(() => loadPrivacyChoice());
  const [native] = useState(() => detectNativePlatform());

  useEffect(() => subscribePrivacyChoice(() => setChoice(loadPrivacyChoice())), []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'tw-site-privacy-choice') setChoice(loadPrivacyChoice());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    syncTidyWiseTags(pathname);
  }, [pathname, choice]);

  const showBanner = shouldShowCookieNotice({ pathname, native, choice });

  return (
    <>
      {showBanner ? (
        <TidyWiseCookieNotice
          onAcknowledge={() => persistPrivacyChoice('acknowledged')}
          onOptOut={() => persistPrivacyChoice('opted_out')}
        />
      ) : null}
      <MarketingFooterOptOut pathname={pathname} native={native} />
    </>
  );
}

/**
 * Pages that ship their own footer (blog, compare, features) do not all use
 * SiteFooter. Drop the same opt-out link into any footer that does not
 * already render it, so it stays available after the bar is gone.
 */
function MarketingFooterOptOut({ pathname, native }: { pathname: string; native: boolean }) {
  const [slots, setSlots] = useState<HTMLElement[]>([]);
  const [fallback, setFallback] = useState(false);
  const show = !native && isTidyWiseMarketingOrSignupPath(pathname);

  useEffect(() => {
    if (!show) {
      setSlots([]);
      setFallback(false);
      return;
    }
    const created: HTMLElement[] = [];
    const attach = () => {
      const footers = document.querySelectorAll('footer:not(.tw-dns-fallback)');
      if (footers.length === 0) {
        setFallback(document.querySelector('[data-tw-do-not-sell]') == null);
        return;
      }
      setFallback(false);
      let added = false;
      for (const footer of footers) {
        if (footer.querySelector('[data-tw-do-not-sell]')) continue;
        const slot = document.createElement('div');
        slot.className = 'tw-dns-footer-link';
        slot.dataset.twDoNotSell = 'slot';
        footer.appendChild(slot);
        created.push(slot);
        added = true;
      }
      if (added) setSlots([...created]);
    };
    attach();
    // Lazy marketing pages mount their footer after the first paint. Watch
    // only for a footer being added — the homepage ticker mutates constantly,
    // and re-scanning on every one of those updates is wasted work.
    const observer = new MutationObserver((mutations) => {
      const addedFooter = mutations.some((mutation) =>
        [...mutation.addedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.tagName === 'FOOTER' || node.querySelector('footer') != null),
        ),
      );
      if (addedFooter) attach();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const slot of created) slot.remove();
      setSlots([]);
      setFallback(false);
    };
  }, [show, pathname]);

  if (!show) return null;
  return (
    <>
      {slots.map((slot) =>
        createPortal(<DoNotSellShareLink className="tw-dns-footer-anchor" />, slot),
      )}
      {fallback ? (
        <footer className="tw-dns-fallback">
          <DoNotSellShareLink className="tw-dns-footer-anchor" />
        </footer>
      ) : null}
    </>
  );
}
