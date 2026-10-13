import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requestEmailUnsubscribe, type UnsubscribeOutcome } from "@/lib/emailUnsubscribe";

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = (params.get("token") ?? "").trim();
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<UnsubscribeOutcome | null>(
    token ? null : { status: "missing_token" },
  );

  useEffect(() => {
    if (!token) {
      setOutcome({ status: "missing_token" });
      return;
    }
    let cancelled = false;
    setOutcome(null);
    requestEmailUnsubscribe(token).then((result) => {
      if (!cancelled) setOutcome(result);
    });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const title = outcome?.status === "success"
    ? "You're unsubscribed"
    : outcome?.status === "error"
      ? "We couldn't unsubscribe you"
      : outcome?.status === "missing_token"
        ? "This link doesn't work"
        : "Unsubscribing";

  return (
    <>
      <SEOHead
        title={`${title} | TidyWise`}
        description="Unsubscribe from TidyWise marketing email."
        canonical="/unsubscribe"
        noIndex
      />
      <div
        className="portal-v2 portal-v2-scroll min-h-screen bg-background flex items-center justify-center p-4"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <Card className="max-w-md w-full">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            {outcome === null ? (
              <>
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <h1 className="text-2xl font-bold text-foreground">Unsubscribing</h1>
                <p className="text-muted-foreground">One moment.</p>
              </>
            ) : outcome.status === "success" ? (
              <>
                <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
                  <Check className="w-8 h-8 text-success" />
                </div>
                <h1 className="text-2xl font-bold text-foreground">You're unsubscribed</h1>
                <p className="text-muted-foreground">{outcome.detail}</p>
                <p className="text-sm text-muted-foreground">You can close this page.</p>
              </>
            ) : outcome.status === "missing_token" ? (
              <>
                <h1 className="text-2xl font-bold text-foreground">This link doesn't work</h1>
                <p className="text-muted-foreground">
                  This unsubscribe link is missing a token. Open the link from the email again.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-foreground">We couldn't unsubscribe you</h1>
                <p className="text-muted-foreground">{outcome.detail}</p>
                <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
