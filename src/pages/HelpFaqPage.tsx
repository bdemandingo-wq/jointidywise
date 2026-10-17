import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEOHead } from "@/components/SEOHead";
import { SiteFooter } from "@/components/SiteFooter";
import { SUPPORT_EMAIL } from "@/lib/supportEmail";
import {
  HELP_FAQ_DESCRIPTION,
  HELP_FAQ_H1,
  HELP_FAQ_PATH,
  HELP_FAQ_SECTIONS,
  HELP_FAQ_TITLE,
  helpFaqIntroRuns,
  helpFaqJsonLd,
  type HelpFaqEntry,
} from "@/content/helpFaq";

type Run = string | { strong: string };

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, index) => {
        if (typeof run === "string") return <span key={index}>{run}</span>;
        if (run.strong === SUPPORT_EMAIL) {
          return (
            <strong key={index}>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
              >
                {SUPPORT_EMAIL}
              </a>
            </strong>
          );
        }
        return <strong key={index} className="font-semibold text-foreground">{run.strong}</strong>;
      })}
    </>
  );
}

function Answer({ entry }: { entry: HelpFaqEntry }) {
  return (
    <div className="space-y-4 pb-6 text-base leading-7 text-foreground">
      {entry.blocks.map((block, index) => {
        if (block.kind === "p") {
          return (
            <p key={index}>
              <Runs runs={block.runs} />
            </p>
          );
        }
        const ListTag = block.kind === "ol" ? "ol" : "ul";
        return (
          <ListTag
            key={index}
            className={
              block.kind === "ol"
                ? "list-decimal space-y-2 pl-5"
                : "list-disc space-y-2 pl-5 marker:text-primary"
            }
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Runs runs={item} />
              </li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}

export default function HelpFaqPage() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const intro = helpFaqIntroRuns();

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background text-foreground">
      <SEOHead
        title={HELP_FAQ_TITLE}
        description={HELP_FAQ_DESCRIPTION}
        canonical={HELP_FAQ_PATH}
        schemaJson={helpFaqJsonLd()}
      />

      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-foreground">TIDYWISE</span>
            </Link>
            <div className="hidden items-center gap-8 md:flex">
              <Link to={{ pathname: "/", hash: "features" }} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Features
              </Link>
              <Link to="/pricing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Pricing
              </Link>
              <Link to="/blog" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Blog
              </Link>
              <Button variant="ghost" onClick={() => navigate("/login")}>Log In</Button>
              <Button onClick={() => navigate("/signup")}>Get started</Button>
            </div>
            <button
              type="button"
              className="rounded-md p-2 md:hidden"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="border-t border-border py-4 md:hidden">
              <div className="flex flex-col gap-4">
                <Link to={{ pathname: "/", hash: "features" }} className="text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>
                  Features
                </Link>
                <Link to="/pricing" className="text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>
                  Pricing
                </Link>
                <Link to="/blog" className="text-muted-foreground hover:text-foreground" onClick={() => setMobileMenuOpen(false)}>
                  Blog
                </Link>
                <Button variant="ghost" className="justify-start" onClick={() => navigate("/login")}>Log In</Button>
                <Button onClick={() => navigate("/signup")}>Get started</Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      <main className="mx-auto w-full max-w-[720px] px-5 pb-24 pt-16 sm:px-6 sm:pt-20">
        <p className="inline-flex items-center rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
          Help
        </p>
        <h1 className="mt-5 text-2xl font-medium tracking-tight text-foreground sm:text-[1.75rem]">
          {HELP_FAQ_H1}
        </h1>
        <p className="mt-5 text-base leading-7 text-muted-foreground">
          <Runs runs={intro} />
        </p>

        <div className="mt-14 space-y-16">
          {HELP_FAQ_SECTIONS.map((section) => (
            <section key={section.id} aria-labelledby={section.id}>
              <h2
                id={section.id}
                className="border-t border-primary/25 pt-8 text-lg font-medium tracking-tight text-foreground"
              >
                {section.title}
              </h2>
              <div className="mt-2">
                {section.entries.map((entry) => (
                  <details key={entry.question} className="group border-b border-border/80">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-6 rounded-sm py-5 text-base font-medium leading-snug text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <span>{entry.question}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180"
                      />
                    </summary>
                    <Answer entry={entry} />
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
