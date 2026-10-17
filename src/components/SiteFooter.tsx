import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TermsOfServiceDialog } from "@/components/legal/TermsOfServiceDialog";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';
import { SUPPORT_EMAIL } from '@/lib/supportEmail';

// FooterAccordionSection — collapses on mobile, permanently expanded on md+.
// The grid-template-rows: 0fr → 1fr trick animates height smoothly. Children
// are ALWAYS in the DOM — collapsing only flips grid-rows + overflow, never
// unmounts. Google sees every <a href> on first paint regardless of mobile
// open state, so collapsed accordions stay crawlable.
interface FooterAccordionSectionProps {
  title: string;
  children: ReactNode;
  /** Outer-section utility classes (col-span etc). */
  className?: string;
}

function FooterAccordionSection({
  title,
  children,
  className,
}: FooterAccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();

  return (
    <section
      className={cn(
        // Border-b separates one accordion from the next on mobile.
        // Hidden on md+ where outer section borders take over.
        "border-b border-border md:border-b-0",
        className,
      )}
    >
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-controls={contentId}
          className={cn(
            "w-full flex items-center justify-between gap-3 text-left",
            "py-4 md:py-0 md:mb-4 md:cursor-default",
            "font-semibold text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm",
          )}
        >
          <span>{title}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "w-5 h-5 shrink-0 text-muted-foreground transition-transform duration-200 md:hidden",
              isOpen && "rotate-180",
            )}
          />
        </button>
      </h3>
      <div
        id={contentId}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          "md:grid-rows-[1fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden md:overflow-visible">
          <div className="pb-4 md:pb-0">{children}</div>
        </div>
      </div>
    </section>
  );
}

const linkClass =
  "text-sm text-muted-foreground hover:text-foreground transition-colors";

export function SiteFooter() {
  return (
    <footer className="py-10 px-4 sm:px-6 lg:px-8 border-t border-border bg-background">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col gap-y-8 md:gap-y-12">
          {/* ── 1. Brand + 5-column section row ───────────────────────── */}
          <section>
            <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-x-8 gap-y-0 md:gap-y-8">
              {/* Brand — always visible */}
              <div className="lg:col-span-1 mb-4 md:mb-0">
                <span className="font-bold text-xl text-foreground mb-3 block">
                  TIDYWISE
                </span>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The complete platform to grow your cleaning business.
                </p>
              </div>

              <FooterAccordionSection title="Product">
                <ul className="space-y-3">
                  <li><Link to="/" className={linkClass}>Home</Link></li>
                  <li><Link to={{ pathname: "/", hash: "#features" }} className={linkClass}>Features</Link></li>
                  <li><Link to="/pricing" className={linkClass}>Pricing</Link></li>
                  <li><Link to="/get-the-app" className={linkClass}>Get the app</Link></li>
                  <li><Link to="/blog" className={linkClass}>Blog</Link></li>
                  <li><Link to="/cleaning-business-software" className={linkClass}>By Location</Link></li>
                  <li><Link to={{ pathname: "/", hash: "#testimonials" }} className={linkClass}>Testimonials</Link></li>
                </ul>
              </FooterAccordionSection>

              <FooterAccordionSection title="Features">
                <ul className="space-y-3">
                  <li><Link to="/features/automated-dispatching" className={linkClass}>Automated Dispatching</Link></li>
                  <li><Link to="/features/scheduling-software" className={linkClass}>Scheduling Software</Link></li>
                  <li><Link to="/features/route-optimization" className={linkClass}>Route Optimization</Link></li>
                  <li><Link to="/features/payroll-software" className={linkClass}>Payroll Software</Link></li>
                  <li><Link to="/features/invoicing-software" className={linkClass}>Invoicing Software</Link></li>
                  <li><Link to="/features/payment-processing" className={linkClass}>Payment Processing</Link></li>
                  <li><Link to="/features/crm" className={linkClass}>CRM</Link></li>
                </ul>
              </FooterAccordionSection>

              <FooterAccordionSection title="Compare">
                <ul className="space-y-3">
                  <li><Link to="/compare/jobber" className={linkClass}>vs Jobber</Link></li>
                  <li><Link to="/compare/booking-koala" className={linkClass}>vs Booking Koala</Link></li>
                  <li><Link to="/compare/housecall-pro" className={linkClass}>vs Housecall Pro</Link></li>
                  <li><Link to="/compare/servicetitan" className={linkClass}>vs ServiceTitan</Link></li>
                  <li><Link to="/compare/zenmaid" className={linkClass}>vs ZenMaid</Link></li>
                  <li><Link to="/compare/launch27" className={linkClass}>vs Launch27</Link></li>
                </ul>
              </FooterAccordionSection>

              <FooterAccordionSection title="Resources">
                <ul className="space-y-3">
                  <li><Link to="/blog" className={linkClass}>Blog Home</Link></li>
                  <li><Link to="/blog/how-to-grow-cleaning-business-2025" className={linkClass}>How to Grow a Cleaning Business in 2025</Link></li>
                  <li><Link to="/blog/cleaning-business-management-software" className={linkClass}>Cleaning Business Management Software</Link></li>
                  <li><Link to="/blog/maid-service-software" className={linkClass}>Maid Service Software</Link></li>
                  <li><Link to="/blog/scheduling-software-for-cleaning-business" className={linkClass}>Scheduling Software for Cleaning Business</Link></li>
                  <li><Link to="/blog/invoicing-software-for-cleaning-business" className={linkClass}>Invoicing Software for Cleaning Business</Link></li>
                  <li><Link to="/blog/payroll-software-for-cleaning-businesses" className={linkClass}>Payroll Software for Cleaning Businesses</Link></li>
                  <li><Link to="/blog/gps-tracking-cleaning-business" className={linkClass}>GPS Tracking for Cleaning Business</Link></li>
                  <li><Link to="/blog/best-software-for-cleaning-business" className={linkClass}>Best Cleaning Software</Link></li>
                  <li><Link to="/blog/how-to-automate-cleaning-company" className={linkClass}>Automation Guide</Link></li>
                </ul>
              </FooterAccordionSection>

              <FooterAccordionSection title="Company">
                <ul className="space-y-3">
                  <li><Link to="/demo" className={linkClass}>Book a Demo</Link></li>
                  <li><Link to="/pricing" className={linkClass}>Pricing</Link></li>
                  <li><Link to="/contact" className={linkClass}>Contact</Link></li>
                  <li><Link to="/help" className={linkClass}>Help & FAQ</Link></li>
                  <li>
                    <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>{SUPPORT_EMAIL}</a>
                  </li>
                  <li><Link to="/privacy-policy" className={linkClass}>Privacy Policy</Link></li>
                  <li><Link to="/delete-account" className={linkClass}>Delete Account</Link></li>
                  <li>
                    <TermsOfServiceDialog>
                      <button type="button" className={linkClass}>Terms</button>
                    </TermsOfServiceDialog>
                  </li>
                </ul>
              </FooterAccordionSection>
            </div>
          </section>

          {/* ── 2. Bottom bar — copyright, always visible ─────────────── */}
          <div className="border-t border-border pt-8 text-center text-sm text-muted-foreground">
            <p>© <CopyrightYear /> TIDYWISE. All rights reserved.</p>
            <p className="mt-3">
              <DoNotSellShareLink />
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
