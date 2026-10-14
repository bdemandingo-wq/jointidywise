import { Link } from 'react-router-dom';
import { DO_NOT_SELL_LABEL, DO_NOT_SELL_PATH } from '@/lib/tidywiseSitePrivacy';

/** Persistent opt-out entry. Does not itself record a choice — the page does. */
export function DoNotSellShareLink({ className }: { className?: string }) {
  return (
    <Link to={DO_NOT_SELL_PATH} data-tw-do-not-sell="" className={className ?? 'tw-dns-footer-anchor'}>
      {DO_NOT_SELL_LABEL}
    </Link>
  );
}
