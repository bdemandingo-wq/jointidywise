import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { SEOHead } from '@/components/SEOHead';
import { Loader2 } from 'lucide-react';

export default function PortalResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const requestReset = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('request-client-portal-reset', {
        body: { email: email.trim() },
      });
      if (invokeError) {
        setError("We couldn't send a reset email right now. Ask the business to reset your password.");
        return;
      }
      setMessage(data?.message || 'If a client portal account exists for that email, a reset link is on its way.');
      setDone(true);
    } catch {
      setError("We couldn't send a reset email right now. Ask the business to reset your password.");
    } finally {
      setPending(false);
    }
  };

  const completeReset = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('complete-client-portal-reset', {
        body: { token, password },
      });
      if (invokeError || data?.ok === false) {
        setError(invokeError
          ? await readEdgeFunctionError(invokeError, 'This reset link is invalid or has expired. Request a new one.')
          : (data?.error || 'This reset link is invalid or has expired. Request a new one.'));
        return;
      }
      setDone(true);
      setMessage('Your password is updated. Sign in with the new one.');
    } catch {
      setError('This reset link is invalid or has expired. Request a new one.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="portal-v2 min-h-screen flex items-center justify-center bg-background p-4">
      <SEOHead title="Reset client portal password | TidyWise" description="Reset your TidyWise client portal password." canonical="/portal/reset-password" noIndex />
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-bold">{token ? 'Choose a new password' : 'Reset your password'}</h1>
          <CardDescription>
            {token
              ? 'This link is only for the client portal, not the staff or owner login.'
              : 'Enter the email on your client portal account. If we find it, we send a link.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done && message ? (
            <div className="space-y-4">
              <p className="text-sm" role="status">{message}</p>
              <Button asChild className="w-full"><Link to="/portal/login">Back to sign in</Link></Button>
            </div>
          ) : token ? (
            <form onSubmit={completeReset} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
              </div>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              <Button type="submit" className="w-full" disabled={pending || password.length < 8}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update password
              </Button>
            </form>
          ) : (
            <form onSubmit={requestReset} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              {message && <p className="text-sm" role="status">{message}</p>}
              <Button type="submit" className="w-full" disabled={pending || !email.includes('@')}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send reset link
              </Button>
            </form>
          )}
          {!done && (
            <p className="mt-4 text-center text-sm">
              <Link to="/portal/login" className="text-primary underline-offset-2 hover:underline">Back to sign in</Link>
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
