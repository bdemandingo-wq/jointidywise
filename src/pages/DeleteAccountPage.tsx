import { useState } from "react";
import { Link } from "react-router-dom";
import { SEOHead } from '@/components/SEOHead';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, Trash2, Mail, CheckCircle2 } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";
import { SUPPORT_EMAIL } from "@/lib/supportEmail";

export default function DeleteAccountPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error("Please provide your name and email.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("account_deletion_requests" as any)
        .insert({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          organization_name: orgName.trim() || null,
          reason: reason.trim() || null,
        } as any);

      if (error) throw error;

      // Also fire the edge function to email support
      await supabase.functions.invoke("send-deletion-request-email", {
        body: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          organizationName: orgName.trim() || "N/A",
          reason: reason.trim() || "Not provided",
        },
      });

      setSubmitted(true);
      toast.success("Your deletion request has been submitted.");
    } catch (err) {
      console.error("Deletion request error:", err);
      toast.error(`Something went wrong. Please email ${SUPPORT_EMAIL} directly.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SEOHead
        title="Delete Your TidyWise Account | Data Deletion Request"
        description={`Request deletion of your TidyWise account and all associated data. Email ${SUPPORT_EMAIL} — processed within 7 business days.`}
        canonical="/delete-account"
        noIndex
      />

      <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
        {/* Header */}
        <header className="border-b bg-card">
          <div className="container max-w-3xl mx-auto px-4 py-6">
            <div className="flex items-center gap-3">
              <img src="/images/tidywise-logo.webp" alt="TidyWise" className="h-8 w-auto" width={1024} height={1024} loading="lazy" />
              <span className="text-xl font-bold text-foreground">TidyWise</span>
            </div>
          </div>
        </header>

        <main className="container max-w-3xl mx-auto px-4 py-10 space-y-8">
          {/* Title */}
          <div className="space-y-3">
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <Trash2 className="h-8 w-8 text-destructive" />
              Delete Your TidyWise Account
            </h1>
            <p className="text-muted-foreground text-lg">
              You can request deletion of your TidyWise account and all associated data.
              This page is provided for Google Play Store data safety compliance.
            </p>
          </div>

          {/* Instructions */}
          <Card>
            <CardHeader>
              <h2 className="flex items-center gap-2 text-sm md:text-xl font-semibold leading-none tracking-tight">
                <Mail className="h-5 w-5 text-primary" />
                How to Request Deletion
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                To request deletion of your account and all associated data, you can either fill out the form below or email us directly at:
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-block text-primary font-semibold hover:underline text-lg"
              >
                {SUPPORT_EMAIL}
              </a>
              <p className="text-muted-foreground text-sm">
                Please include the following information:
              </p>
              <ul className="list-disc list-inside text-muted-foreground text-sm space-y-1">
                <li>Account email</li>
                <li>Business name or organization name</li>
                <li>Request to delete account</li>
              </ul>
              <p className="text-sm font-medium text-foreground mt-4">
                Once verified, all associated account data will be permanently deleted within 7 business days.
              </p>
            </CardContent>
          </Card>

          {/* Data Handling */}
          <Card>
            <CardHeader>
              <h2 className="flex items-center gap-2 text-sm md:text-xl font-semibold leading-none tracking-tight">
                <Shield className="h-5 w-5 text-primary" />
                What Data Will Be Deleted
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground font-medium">The following data will be permanently deleted:</p>
              <ul className="list-disc list-inside text-muted-foreground text-sm space-y-1">
                <li>User profile information</li>
                <li>Business information</li>
                <li>Booking history</li>
                <li>Client records</li>
                <li>Payment tokens stored for billing</li>
              </ul>

              <p className="text-sm text-muted-foreground font-medium mt-4">
                The following may be retained for legal or financial compliance:
              </p>
              <ul className="list-disc list-inside text-muted-foreground text-sm space-y-1">
                <li>Payment transaction records required by payment processors</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-4">
                For details on how we handle your data while your account is active,
                see our <Link to="/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link>.
                If you'd rather pause your subscription instead of deleting,{" "}
                <Link to="/login" className="text-primary hover:underline">sign in to your dashboard</Link> to manage your plan,
                or visit the <Link to="/pricing" className="text-primary hover:underline">pricing page</Link> to compare options.
                Not a customer yet but considering one? Browse our{" "}
                <Link to="/blog" className="text-primary hover:underline">cleaning business resources</Link> or{" "}
                <Link to="/cleaning-business-software" className="text-primary hover:underline">learn what TidyWise offers</Link>.
              </p>
            </CardContent>
          </Card>

          {/* Form */}
          {submitted ? (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-10 flex flex-col items-center text-center gap-4">
                <CheckCircle2 className="h-12 w-12 text-primary" />
                <h2 className="text-xl font-semibold text-foreground">Request Submitted</h2>
                <p className="text-muted-foreground max-w-md">
                  Your account deletion request has been received. We will verify your identity and process the request within 7 business days.
                  You will receive a confirmation email at <strong>{email}</strong>.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <h2 className="text-sm md:text-xl font-semibold leading-none tracking-tight">Submit a Deletion Request</h2>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      required
                      maxLength={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Your account email"
                      required
                      maxLength={255}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="orgName">Organization Name</Label>
                    <Input
                      id="orgName"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Your business or organization name"
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reason">Reason for Deletion (optional)</Label>
                    <Textarea
                      id="reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Let us know why you'd like to delete your account"
                      maxLength={1000}
                      rows={3}
                    />
                  </div>
                  <Button type="submit" variant="destructive" className="w-full" disabled={submitting}>
                    {submitting ? "Submitting…" : "Submit Deletion Request"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

        </main>

        <SiteFooter />
      </div>
    </>
  );
}
