import { useEffect, useLayoutEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { purgeDemoQueries } from '@/lib/demo/cache';
import { isDemoScreen } from '@/lib/demo/screens';
import { endPublicDemo, isPublicDemoActive } from '@/lib/demo/session';

function insidePublicDemo(pathname: string, search: string) {
  if (pathname === '/demo' && isDemoScreen(new URLSearchParams(search).get('screen'))) return true;
  return pathname.startsWith('/dashboard')
    || pathname.startsWith('/admin')
    || pathname.startsWith('/book/')
    || pathname === '/choose-plan';
}

/**
 * The public preview is session-only. Leaving the sample screens drops it
 * so signup, login, and the booked walkthrough can write again.
 * A #demo-* hash scrolls to the matching data-tour-id once that screen mounts.
 */
export function PublicDemoBoundary() {
  const { pathname, hash, search } = useLocation();
  const queryClient = useQueryClient();

  useLayoutEffect(() => {
    if (!insidePublicDemo(pathname, search) && isPublicDemoActive()) {
      endPublicDemo();
      purgeDemoQueries(queryClient);
    }
  }, [pathname, search, queryClient]);

  useEffect(() => {
    const id = hash.replace('#', '');
    if (!id.startsWith('demo-')) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      tries += 1;
      if (el) {
        el.scrollIntoView({ block: 'center' });
        window.clearInterval(timer);
      } else if (tries > 20) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [pathname, hash]);

  return null;
}
