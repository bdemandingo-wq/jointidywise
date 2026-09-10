import React, { Component, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { captureError } from 'sitepong';
import { AlertTriangle, RefreshCcw, Home, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import {
  isChunkLoadError,
  maybeReloadForStaleChunk,
  clearChunkReloadGuard,
} from '@/lib/chunkReload';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onRetry?: () => void;
  featureName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}


/**
 * Global Error Boundary - wraps features to catch render errors
 * Logs all caught errors to system_logs table for debugging
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  async componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Report to Sentry so in-session crashes are visible alongside the
    // top-level Sentry.ErrorBoundary reports.
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack } },
      tags: { feature: this.props.featureName || 'Unknown' },
    });

    // Report to SitePong alongside Sentry. Wrapped so a SitePong failure
    // can never break the error boundary itself.
    try {
      captureError(error, {
        tags: { feature: this.props.featureName || 'Unknown' },
      });
    } catch {
      // SitePong may not be initialized or may throw — never let it
      // interfere with the boundary's own error handling.
    }

    // Auto-recover from stale chunk errors after a deploy.
    // When index.html references new hashed chunks but the browser has an old
    // index.html cached, dynamic imports throw "Importing a module script failed"
    // / "Failed to fetch dynamically imported module". A one-time hard reload
    // pulls the fresh index.html and resolves it. We guard with sessionStorage
    // to avoid infinite reload loops if the issue is something else.
    // Web only, online only, once per chunk — see lib/chunkReload. On native
    // the assets are bundled, so a missing chunk is a damaged build rather than
    // a deploy race and must reach the panel instead of being reloaded away.
    if (maybeReloadForStaleChunk(error)) return;

    // Log to system_logs table
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Get organization_id from org_memberships
      let organizationId: string | null = null;
      if (user?.id) {
        const { data: membership } = await supabase
          .from('org_memberships')
          .select('organization_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();
        organizationId = membership?.organization_id || null;
      }

      await supabase.from('system_logs').insert({
        level: 'error',
        source: `ErrorBoundary:${this.props.featureName || 'Unknown'}`,
        message: error.message || 'Unknown error',
        details: {
          featureName: this.props.featureName,
          componentStack: errorInfo.componentStack,
          errorName: error.name,
          url: window.location.href,
        },
        user_id: user?.id || null,
        organization_id: organizationId,
        stack_trace: error.stack || null,
      });
    } catch (logError) {
      // Don't fail if logging fails - just log to console
      console.error('Failed to log error to system_logs:', logError);
    }
  }

  handleRetry = () => {
    // For chunk-load errors, a state reset isn't enough — the broken module
    // reference is still in the bundler graph. Force a hard reload instead.
    if (this.state.error && isChunkLoadError(this.state.error)) {
      if (typeof window !== 'undefined') {
        // An explicit retry always gets a fresh attempt, for every chunk.
        clearChunkReloadGuard();
        window.location.reload();
        return;
      }
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onRetry?.();
  };

  handleGoHome = () => {
    window.location.href = '/dashboard';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      /*
        A dropped connection is not a crash, and rendering it as one teaches
        people to distrust the app for something that was never its fault.

        The test is only `navigator.onLine === false` — the browser's own
        answer. A fetch that fails while online is a real failure (ours or the
        server's) and must not be excused as "you're offline", which would send
        someone to check their wifi while the actual problem went unlooked-at.
      */
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div
                className={`mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center ${
                  isOffline ? 'bg-muted' : 'bg-destructive/10'
                }`}
              >
                {isOffline
                  ? <WifiOff className="h-6 w-6 text-muted-foreground" />
                  : <AlertTriangle className="h-6 w-6 text-destructive" />}
              </div>
              <CardTitle>
                {isOffline ? "You're offline" : 'This part of TidyWise stopped working'}
              </CardTitle>
              <CardDescription>
                {isOffline
                  ? 'TidyWise will reconnect on its own. You may need to re-enter anything you were part-way through.'
                  : `The problem has been reported.${
                      this.props.featureName ? ` The rest of TidyWise is still fine.` : ''
                    }`}
              </CardDescription>
            </CardHeader>
            {/* A stack trace explains nothing about a dropped connection, and
                showing one makes an ordinary network blip look like a defect. */}
            {!isOffline && (
              <CardContent>
                <div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground">
                  <p className="font-medium mb-1">Error details:</p>
                  <p className="font-mono text-xs break-all">
                    {this.state.error?.message || 'Unknown error'}
                  </p>
                </div>
              </CardContent>
            )}
            <CardFooter className="flex gap-2 justify-center">
              <Button variant="outline" onClick={this.handleGoHome}>
                <Home className="h-4 w-4 mr-2" />
                Go to Dashboard
              </Button>
              <Button onClick={this.handleRetry}>
                <RefreshCcw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook for functional components to trigger error boundary
export function useErrorHandler() {
  const [, setError] = React.useState<Error | null>(null);

  return React.useCallback((error: Error) => {
    setError(() => {
      throw error;
    });
  }, []);
}
