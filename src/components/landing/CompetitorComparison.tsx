import { Check, X, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { PUBLIC_TIERS } from "@/lib/publicPlans";

const basicMonthly = PUBLIC_TIERS.find((tier) => tier.id === "basic")?.monthlyPrice ?? 49;

interface Feature {
  name: string;
  tidywise: boolean | string;
  bookingKoala: boolean | string;
  jobber: boolean | string;
}

const features: Feature[] = [
  { name: "Online Booking Form", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Recurring Bookings", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Staff Portal & App", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Client Portal (Self-Service)", tidywise: true, bookingKoala: false, jobber: "Add-on" },
  { name: "GPS Check-ins", tidywise: true, bookingKoala: true, jobber: "Add-on" },
  { name: "Stripe Payments", tidywise: true, bookingKoala: true, jobber: true },
  { name: "SMS Notifications", tidywise: true, bookingKoala: "Add-on", jobber: "Add-on" },
  { name: "Loyalty Tiers & Rewards", tidywise: true, bookingKoala: true, jobber: false },
  { name: "Client Self-Cancellation", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Lead Management", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Quote Generator", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Invoicing & Auto-Reminders", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Drag & Drop Scheduler", tidywise: true, bookingKoala: false, jobber: true },
  { name: "Payroll Management", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Expense Tracking", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Task Management", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Automated Email Campaigns", tidywise: true, bookingKoala: "Premium", jobber: false },
  { name: "Client Feedback Collection", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Automation Center (Workflows)", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Tip & Deposit Collection", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Referral Program", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Data Import / Migration Wizard", tidywise: true, bookingKoala: false, jobber: true },
  { name: "Email Template Builder", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Extras/Add-on Pricing", tidywise: true, bookingKoala: true, jobber: false },
  { name: "Operations Tracker", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Inventory Tracking", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Photo Documentation", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Review Requests", tidywise: true, bookingKoala: "Premium", jobber: true },
  { name: "Multi-location", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Custom Checklists", tidywise: true, bookingKoala: true, jobber: true },
  { name: "P&L Reports", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Revenue Forecasting", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Platform Activity Analytics", tidywise: true, bookingKoala: false, jobber: false },
  { name: "AI Business Intelligence", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Coupon Codes", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Sales Tax Automation", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Bed/Bath + SqFt Pricing", tidywise: true, bookingKoala: true, jobber: false },
  { name: "Home Condition Pricing", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Demo/Test Mode", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Offline Mode", tidywise: true, bookingKoala: false, jobber: false },
  { name: "In-App SMS Inbox", tidywise: true, bookingKoala: false, jobber: false },
];

const pricingPlans = [
  {
    name: "TIDYWISE",
    tagline: "Built for cleaning businesses",
    // Was "$0/month" with "Plans from $49/mo" directly beneath it. As the
    // headline in a price comparison that read as "TidyWise is free", and the
    // subtitle contradicted it two lines down. The subtitle now carries the
    // real differentiator instead of repeating the number above it.
    price: "$49",
    priceNote: "/month",
    subtitle: "Unlimited users · cancel anytime",
    highlight: true,
  },
  {
    name: "Booking Koala",
    tagline: "General service booking",
    price: "$197",
    priceNote: "/month",
    subtitle: "14-day trial",
    highlight: false,
  },
  {
    name: "Jobber",
    tagline: "Field service management",
    price: "$349",
    priceNote: "/month",
    subtitle: "14-day trial",
    highlight: false,
  },
];

const renderFeatureValue = (value: boolean | string) => {
  if (value === true) {
    return <Check className="h-5 w-5 text-success mx-auto" />;
  }
  if (value === false) {
    return <X className="h-5 w-5 text-destructive/60 mx-auto" />;
  }
  return <span className="text-xs text-warning font-medium">{value}</span>;
};

export function CompetitorComparison() {
  const navigate = useNavigate();

  return (
    <section id="comparison" className="py-20 px-4 sm:px-6 lg:px-8 bg-secondary/30">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            TIDYWISE vs Booking Koala vs Jobber: Which Cleaning Software Wins?
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            {`Looking for Booking Koala alternatives or Jobber alternatives? Compare the best cleaning business software side by side. Plans from $${basicMonthly}/mo.`}
          </p>
        </div>

        {/* Pricing Comparison */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {pricingPlans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-6 ${
                plan.highlight
                  ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                  : "bg-card border border-border"
              }`}
            >
              <div className="text-center mb-6">
                <h3 className={`text-xl font-bold ${plan.highlight ? "" : "text-foreground"}`}>
                  {plan.name}
                </h3>
                <p className={`text-sm ${plan.highlight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                  {plan.tagline}
                </p>
              </div>

              <div className={`p-6 rounded-lg text-center ${plan.highlight ? "bg-primary-foreground/10" : "bg-muted"}`}>
                <div className="flex items-baseline justify-center gap-1">
                  <span className={`text-4xl font-bold ${plan.highlight ? "" : "text-foreground"}`}>
                    {plan.price}
                  </span>
                  <span className={`text-sm ${plan.highlight ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {plan.priceNote}
                  </span>
                </div>
                <p className={`text-sm mt-2 font-medium ${plan.highlight ? "text-primary-foreground/90" : "text-muted-foreground"}`}>
                  {plan.subtitle}
                </p>
              </div>

              {plan.highlight && (
                <Button
                  variant="secondary"
                  className="w-full mt-6"
                  onClick={() => navigate("/pricing")}
                >
                  See Plans
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Feature Comparison Table */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-6 border-b border-border">
            <h3 className="text-xl font-semibold text-foreground">Feature Comparison</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Every feature TIDYWISE offers compared to the competition
            </p>
          </div>

          <div className="overflow-x-auto -mx-px">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left p-3 sm:p-4 text-sm font-medium text-foreground">Feature</th>
                  <th className="text-center p-3 sm:p-4 text-sm font-semibold text-primary">TIDYWISE</th>
                  <th className="text-center p-3 sm:p-4 text-sm font-medium text-foreground">Booking Koala</th>
                  <th className="text-center p-3 sm:p-4 text-sm font-medium text-foreground">Jobber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {features.map((feature, index) => (
                  <tr key={feature.name} className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    <td className="p-3 sm:p-4 text-sm text-foreground">{feature.name}</td>
                    <td className="p-3 sm:p-4 text-center">{renderFeatureValue(feature.tidywise)}</td>
                    <td className="p-3 sm:p-4 text-center">{renderFeatureValue(feature.bookingKoala)}</td>
                    <td className="p-3 sm:p-4 text-center">{renderFeatureValue(feature.jobber)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sm:hidden text-xs text-muted-foreground text-center py-2 border-t border-border">
            Swipe to see all columns →
          </p>
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