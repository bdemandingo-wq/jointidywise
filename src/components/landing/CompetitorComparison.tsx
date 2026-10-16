import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { PUBLIC_TIERS } from "@/lib/publicPlans";

/** Features we actually ship. No competitor column: those claims had no source. */
const OUR_FEATURES = [
  "Online Booking Form",
  "Recurring Bookings",
  "Staff Portal & App",
  "Client Portal (Self-Service)",
  "GPS Check-ins",
  "Stripe Payments",
  "SMS Notifications",
  "Loyalty Tiers & Rewards",
  "Client Self-Cancellation",
  "Lead Management",
  "Quote Generator",
  "Invoicing & Auto-Reminders",
  "Drag & Drop Scheduler",
  "Payroll Management",
  "Expense Tracking",
  "Task Management",
  "Automated Email Campaigns",
  "Client Feedback Collection",
  "Automation Center (Workflows)",
  "Tip & Deposit Collection",
  "Referral Program",
  "Data Import / Migration Wizard",
  "Email Template Builder",
  "Extras/Add-on Pricing",
  "Operations Tracker",
  "Inventory Tracking",
  "Photo Documentation",
  "Review Requests",
  "Multi-location",
  "Custom Checklists",
  "P&L Reports",
  "Revenue Forecasting",
  "Platform Activity Analytics",
  "AI Business Intelligence",
  "Coupon Codes",
  "Sales Tax Automation",
  "Bed/Bath + SqFt Pricing",
  "Home Condition Pricing",
  "Demo/Test Mode",
  "Offline Mode",
  "In-App SMS Inbox",
];

export function CompetitorComparison() {
  const navigate = useNavigate();
  const custom = PUBLIC_TIERS.find((tier) => tier.id === "custom");
  const customPrice = custom ? `$${custom.monthlyPrice}/mo` : "";

  return (
    <section id="comparison" className="py-20 px-4 sm:px-6 lg:px-8 bg-secondary/30">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Plans built for cleaning businesses
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {`Basic, Pro, and Custom. Custom is ${customPrice}.`}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {PUBLIC_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`rounded-2xl p-6 ${
                tier.highlight
                  ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                  : "bg-card border border-border"
              }`}
            >
              <div className="text-center mb-6">
                <h3 className={`text-xl font-bold ${tier.highlight ? "" : "text-foreground"}`}>
                  {tier.name}
                </h3>
                <p className={`text-sm ${tier.highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                  {tier.tagline}
                </p>
              </div>

              <div className={`p-6 rounded-lg text-center ${tier.highlight ? "bg-primary-foreground/10" : "bg-muted"}`}>
                <p className={`text-4xl font-bold ${tier.highlight ? "" : "text-foreground"}`}>
                  {`$${tier.monthlyPrice}/mo`}
                </p>
                <p className={`text-sm mt-2 font-medium ${tier.highlight ? "text-primary-foreground/90" : "text-muted-foreground"}`}>
                  Unlimited users · cancel anytime
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-6 border-b border-border">
            <h3 className="text-xl font-semibold text-foreground">What TidyWise includes</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Features on our own plans. Which ones are on Basic, Pro, or Custom is on the pricing page.
            </p>
          </div>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 p-6">
            {OUR_FEATURES.map((name) => (
              <li key={name} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-success" />
                <span>{name}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-center mt-12">
          <Button size="lg" onClick={() => navigate("/pricing")}>
            See TIDYWISE Plans
          </Button>
          <p className="text-sm text-muted-foreground mt-3">
            Built for cleaning businesses
          </p>
        </div>
      </div>
    </section>
  );
}
