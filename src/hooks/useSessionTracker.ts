import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of inactivity = idle
const UPDATE_INTERVAL_MS = 30 * 1000; // Update session every 30 seconds
const SESSION_RESUME_WINDOW_MS = 30 * 60 * 1000; // Resume sessions started within last 30 minutes

// One patch for the life of the page. Re-wrapping pushState on every effect
// run stacked listeners, so a single navigation recorded several page views
// and printed [SESSION_TRACKER] once per wrap.
let historyPatched = false;
let pageTracker: (() => void) | null = null;

function ensureHistoryPatch() {
  if (historyPatched) return;
  historyPatched = true;
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args: Parameters<History['pushState']>) {
    origPush(...args);
    pageTracker?.();
  };
  history.replaceState = function (...args: Parameters<History['replaceState']>) {
    origReplace(...args);
    pageTracker?.();
  };
}

export function useSessionTracker() {
  const { user } = useAuth();
  const lastPathRef = useRef<string>('');
  const sessionIdRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const sessionStartRef = useRef<number>(Date.now());
  const isIdleRef = useRef<boolean>(false);
  const activeTimeRef = useRef<number>(0);
  const creatingRef = useRef<boolean>(false);

  // Reset activity timer on user interaction
  const handleActivity = useCallback(() => {
    const now = Date.now();
    
    // If we were idle, don't count the idle time
    if (!isIdleRef.current) {
      activeTimeRef.current += now - lastActivityRef.current;
    }
    
    lastActivityRef.current = now;
    isIdleRef.current = false;
  }, []);

  // Check for idle state
  const checkIdle = useCallback(() => {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityRef.current;
    
    if (timeSinceActivity >= IDLE_TIMEOUT_MS && !isIdleRef.current) {
      isIdleRef.current = true;
    }
  }, []);

  // Try to resume an existing active session, or create a new one
  const createSession = useCallback(async () => {
    if (!user || creatingRef.current || sessionIdRef.current) return;
    creatingRef.current = true;
    
    try {
      // First, try to find a recent active session for this user to resume
      const resumeAfter = new Date(Date.now() - SESSION_RESUME_WINDOW_MS).toISOString();
      const { data: existingSession } = await supabase
        .from('user_sessions')
        .select('id, duration_seconds, session_start')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .gte('session_start', resumeAfter)
        .order('session_start', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSession) {
        // Resume existing session
        sessionIdRef.current = existingSession.id;
        activeTimeRef.current = (existingSession.duration_seconds ?? 0) * 1000;
        lastActivityRef.current = Date.now();
        sessionStartRef.current = new Date(existingSession.session_start).getTime();
      } else {
        // Create brand new session
        const { data, error } = await supabase
          .from('user_sessions')
          .insert({
            user_id: user.id,
            user_email: user.email,
            session_start: new Date().toISOString(),
            is_active: true,
            duration_seconds: 0,
          })
          .select('id')
          .single();

        if (error) throw error;
        sessionIdRef.current = data.id;
        sessionStartRef.current = Date.now();
        activeTimeRef.current = 0;
        lastActivityRef.current = Date.now();
      }
    } catch (err) {
      console.error('[SESSION_TRACKER] createSession failed', { userId: user.id, err });
    } finally {
      creatingRef.current = false;
    }
  }, [user]);

  // Update session duration
  const updateSession = useCallback(async () => {
    if (!sessionIdRef.current || !user) return;
    
    // Check for idle before updating
    checkIdle();
    
    // Only count active time
    if (!isIdleRef.current) {
      const now = Date.now();
      activeTimeRef.current += now - lastActivityRef.current;
      lastActivityRef.current = now;
    }
    
    const durationSeconds = Math.floor(activeTimeRef.current / 1000);
    
    try {
      const { error } = await supabase
        .from('user_sessions')
        .update({
          duration_seconds: durationSeconds,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionIdRef.current);

      if (error) throw error;
    } catch (err) {
      console.error('[SESSION_TRACKER] updateSession failed', {
        sessionId: sessionIdRef.current,
        durationSeconds,
        err,
      });
    }
  }, [user, checkIdle]);

  // End the session
  const endSession = useCallback(async () => {
    if (!sessionIdRef.current) return;
    
    // Final activity check
    if (!isIdleRef.current) {
      const now = Date.now();
      activeTimeRef.current += now - lastActivityRef.current;
    }
    
    const durationSeconds = Math.floor(activeTimeRef.current / 1000);
    
    try {
      const { error } = await supabase
        .from('user_sessions')
        .update({
          session_end: new Date().toISOString(),
          duration_seconds: durationSeconds,
          is_active: false,
        })
        .eq('id', sessionIdRef.current);

      if (error) throw error;
    } catch (err) {
      console.error('[SESSION_TRACKER] endSession failed', {
        sessionId: sessionIdRef.current,
        durationSeconds,
        err,
      });
    }
    
    sessionIdRef.current = null;
  }, []);

  // Track page views using window.location (works outside Router)
  useEffect(() => {
    if (!user) return;

    const trackPage = () => {
      const pagePath = window.location.pathname;
      if (pagePath === lastPathRef.current || !sessionIdRef.current) return;
      lastPathRef.current = pagePath;
      const pageTitle = pagePath === '/' ? 'Home' : pagePath.split('/').filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')).join(' > ');

      supabase.from('user_page_views').insert({
        user_id: user.id,
        user_email: user.email,
        session_id: sessionIdRef.current,
        page_path: pagePath,
        page_title: pageTitle,
      }).then(({ error }) => {
        if (error) console.error('[SESSION_TRACKER] page view insert failed', error);
      });
    };

    // Track initial page
    trackPage();

    pageTracker = trackPage;
    ensureHistoryPatch();
    window.addEventListener('popstate', trackPage);

    return () => {
      if (pageTracker === trackPage) pageTracker = null;
      window.removeEventListener('popstate', trackPage);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // Start or resume session
    createSession();

    // Activity event listeners
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Visibility change handler
    const handleVisibilityChange = () => {
      if (document.hidden) {
        isIdleRef.current = true;
        updateSession();
      } else {
        handleActivity();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Update interval
    const updateInterval = setInterval(updateSession, UPDATE_INTERVAL_MS);

    // Idle check interval
    const idleCheckInterval = setInterval(checkIdle, 10000);

    // Cleanup on unmount or user change
    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(updateInterval);
      clearInterval(idleCheckInterval);
      // Don't end session on unmount - just update it so it can be resumed
      updateSession();
    };
  }, [user, createSession, handleActivity, updateSession, endSession, checkIdle]);

  // Handle page unload (actual close/navigate away) - this truly ends the session
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (sessionIdRef.current) {
        // Final active time calculation
        if (!isIdleRef.current) {
          activeTimeRef.current += Date.now() - lastActivityRef.current;
        }
        const durationSeconds = Math.floor(activeTimeRef.current / 1000);
        
        try {
          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_sessions?id=eq.${sessionIdRef.current}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify({
                session_end: new Date().toISOString(),
                duration_seconds: durationSeconds,
                is_active: false,
              }),
              keepalive: true,
            }
          );
        } catch {
          // Silently fail on unload
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
}
