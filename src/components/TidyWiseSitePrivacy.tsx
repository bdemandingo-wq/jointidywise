import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { TidyWiseCookieNotice } from '@/components/TidyWiseCookieNotice';
import { loadPrivacyChoice, persistPrivacyChoice, subscribePrivacyChoice } from '@/lib/tidywisePrivacyStore';
import { isProductTourActive, subscribeProductTourActive } from '@/lib/productTourGate';
import {
  isTagHostnameAllowed,
  shouldShowCookieNotice,
  tagHostOptionsFromEnv,
  type PrivacyChoice,
} from '@/lib/tidywiseSitePrivacy';
import { detectNativePlatform, revokeTidyWiseTags, syncTidyWiseTags } from '@/lib/tidywiseTags';

/**
 * Cookie notice plus TidyWise-owned tags. Mounted once inside the router.
 * Org TrackingPixels on booking pages are a separate component and are not
 * mounted here.
 *
 * The footer opt-out link is the DoNotSellShareLink component rendered by
 * each marketing footer, including SiteFooter. This file does not inject
 * nodes into those footers.
 */
export function TidyWiseSitePrivacy() {
  const { pathname } = useLocation();
  const [choice, setChoice] = useState<PrivacyChoice | null>(() => loadPrivacyChoice());
  const [native] = useState(() => detectNativePlatform());
  const [tourActive, setTourActive] = useState(() => isProductTourActive());
  const [holdingNotice, setHoldingNotice] = useState(false);
  const [hostnameAllowed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isTagHostnameAllowed(
      window.location.hostname,
      tagHostOptionsFromEnv({
        PROD: import.meta.env.PROD === true,
        VITE_TIDYWISE_TAG_TEST_HOSTS: import.meta.env.VITE_TIDYWISE_TAG_TEST_HOSTS,
      }),
    );
  });

  useEffect(() => subscribePrivacyChoice(() => setChoice(loadPrivacyChoice())), []);
  useEffect(() => subscribeProductTourActive(() => setTourActive(isProductTourActive())), []);

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

  const showBanner =
    holdingNotice ||
    shouldShowCookieNotice({ pathname, native, choice, hostnameAllowed, tourActive });

  return showBanner ? (
    <TidyWiseCookieNotice
      onAcknowledge={() => {
        setHoldingNotice(true);
        persistPrivacyChoice('acknowledged');
      }}
      onOptOut={() => {
        setHoldingNotice(true);
        const stored = persistPrivacyChoice('opted_out');
        revokeTidyWiseTags();
        return stored;
      }}
      onClosed={() => setHoldingNotice(false)}
    />
  ) : null;
}
