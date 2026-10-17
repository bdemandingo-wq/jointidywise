import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bathroomOptions, bedroomOptions, homeConditionOptions } from "@/data/pricingData";
import {
  ADDON_OPTIONS,
  CALCULATOR_DESCRIPTION,
  CALCULATOR_FAQS,
  CALCULATOR_H1,
  CALCULATOR_INPUT_LABELS,
  CALCULATOR_PATH,
  CALCULATOR_TITLE,
  CLEAN_TYPE_OPTIONS,
  EXPLAINER_PARAGRAPHS,
  FORMULA_STEPS,
  FREQUENCY_OPTIONS,
  SEE_PLANS_LABEL,
  TRIAL_CTA_LABEL,
  calculatorJsonLd,
} from "@/lib/houseCleaningCalculatorContent";
import {
  addonHint,
  calculateHouseCleaningQuote,
  formatHours,
  formatUsd,
  type CalculatorAddonId,
  type CalculatorCleanType,
  type CalculatorFrequency,
} from "@/lib/houseCleaningPriceCalculator";

const controlClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function TrialActions() {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <Button asChild size="lg" className="h-auto whitespace-normal text-center">
        <Link to="/signup">{TRIAL_CTA_LABEL}</Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <Link to="/pricing">{SEE_PLANS_LABEL}</Link>
      </Button>
    </div>
  );
}

function parseOptional(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export default function HouseCleaningPriceCalculatorPage() {
  const [sizeMode, setSizeMode] = useState<"sqft" | "beds">("sqft");
  const [squareFeet, setSquareFeet] = useState("");
  const [bedrooms, setBedrooms] = useState(bedroomOptions[1] ?? "1");
  const [bathrooms, setBathrooms] = useState(bathroomOptions[0] ?? "1");
  const [cleanType, setCleanType] = useState<CalculatorCleanType>("standard_recurring");
  const [conditionId, setConditionId] = useState(2);
  const [frequency, setFrequency] = useState<CalculatorFrequency>("one_time");
  const [addons, setAddons] = useState<Record<CalculatorAddonId, boolean>>({
    oven: false,
    fridge: false,
    windows: false,
    laundry: false,
  });
  const [wage, setWage] = useState("");
  const [teamSize, setTeamSize] = useState("1");
  const [supplyCost, setSupplyCost] = useState("");
  const [overhead, setOverhead] = useState("");
  const [margin, setMargin] = useState("");

  const result = useMemo(() => {
    const feet = parseOptional(squareFeet);
    const size = sizeMode === "sqft"
      ? feet != null && feet > 0
        ? { mode: "sqft" as const, squareFeet: feet }
        : null
      : { mode: "beds" as const, bedrooms, bathrooms };
    if (!size) return null;

    const wageValue = parseOptional(wage);
    const marginValue = parseOptional(margin);
    const teamValue = parseOptional(teamSize);
    const supplyValue = supplyCost.trim() === "" ? 0 : parseOptional(supplyCost);
    const overheadValue = overhead.trim() === "" ? 0 : parseOptional(overhead);
    const costs = wageValue != null && wageValue > 0 &&
      marginValue != null && marginValue <= 100 &&
      teamValue != null && teamValue >= 1 &&
      supplyValue != null && overheadValue != null
      ? {
          hourlyWage: wageValue,
          teamSize: teamValue,
          supplyCostPerVisit: supplyValue,
          monthlyOverhead: overheadValue,
          marginPct: marginValue,
        }
      : null;

    return calculateHouseCleaningQuote({
      size,
      cleanType,
      conditionId,
      frequency,
      addons,
      costs,
    });
  }, [addons, bathrooms, bedrooms, cleanType, conditionId, frequency, margin, overhead, sizeMode, squareFeet, supplyCost, teamSize, wage]);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={CALCULATOR_TITLE}
        description={CALCULATOR_DESCRIPTION}
        canonical={CALCULATOR_PATH}
        schemaJson={calculatorJsonLd()}
      />
      <nav className="border-b border-border bg-background">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="font-bold text-xl text-foreground">TIDYWISE</Link>
          <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground">{SEE_PLANS_LABEL}</Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
        <header className="max-w-3xl space-y-4">
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground">{CALCULATOR_H1}</h1>
          <p className="text-lg text-muted-foreground">
            The price comes from the TidyWise rate sheet. Hours and profit use the wage, team, supplies, overhead, and margin you enter.
          </p>
        </header>

        <div className="grid lg:grid-cols-2 gap-8 items-start">
          <form className="space-y-8" onSubmit={(event) => event.preventDefault()}>
            <fieldset className="space-y-4">
              <legend className="text-sm font-medium text-foreground">Home size</legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="size-mode"
                    checked={sizeMode === "sqft"}
                    onChange={() => setSizeMode("sqft")}
                  />
                  {CALCULATOR_INPUT_LABELS.squareFootage}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="size-mode"
                    checked={sizeMode === "beds"}
                    onChange={() => setSizeMode("beds")}
                  />
                  Beds and baths
                </label>
              </div>
              <Field id="square-feet" label={CALCULATOR_INPUT_LABELS.squareFootage}>
                <Input
                  id="square-feet"
                  inputMode="decimal"
                  min={1}
                  type="number"
                  value={squareFeet}
                  disabled={sizeMode !== "sqft"}
                  onChange={(event) => setSquareFeet(event.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field id="bedrooms" label={CALCULATOR_INPUT_LABELS.bedrooms}>
                  <select
                    id="bedrooms"
                    className={controlClass}
                    value={bedrooms}
                    disabled={sizeMode !== "beds"}
                    onChange={(event) => setBedrooms(event.target.value)}
                  >
                    {bedroomOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Field>
                <Field id="bathrooms" label={CALCULATOR_INPUT_LABELS.bathrooms}>
                  <select
                    id="bathrooms"
                    className={controlClass}
                    value={bathrooms}
                    disabled={sizeMode !== "beds"}
                    onChange={(event) => setBathrooms(event.target.value)}
                  >
                    {bathroomOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">{CALCULATOR_INPUT_LABELS.cleanType}</legend>
              {CLEAN_TYPE_OPTIONS.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="clean-type"
                    checked={cleanType === option.id}
                    onChange={() => setCleanType(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <Field id="condition" label={CALCULATOR_INPUT_LABELS.homeCondition}>
              <select
                id="condition"
                className={controlClass}
                value={conditionId}
                onChange={(event) => setConditionId(Number(event.target.value))}
              >
                {homeConditionOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </Field>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">{CALCULATOR_INPUT_LABELS.frequency}</legend>
              {FREQUENCY_OPTIONS.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="frequency"
                    checked={frequency === option.id}
                    onChange={() => setFrequency(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-foreground">Add-ons</legend>
              {ADDON_OPTIONS.map((option) => (
                <label key={option.id} className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={addons[option.id]}
                    onCheckedChange={(checked) => setAddons((current) => ({ ...current, [option.id]: checked === true }))}
                  />
                  <span>
                    <span className="block text-foreground">{option.label}</span>
                    <span className="block text-muted-foreground">{addonHint(cleanType, option.id)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field id="wage" label={CALCULATOR_INPUT_LABELS.wage}>
                <Input id="wage" inputMode="decimal" min={0} step="0.01" type="number" value={wage} onChange={(event) => setWage(event.target.value)} />
              </Field>
              <Field id="team-size" label={CALCULATOR_INPUT_LABELS.teamSize}>
                <Input id="team-size" inputMode="numeric" min={1} step={1} type="number" value={teamSize} onChange={(event) => setTeamSize(event.target.value)} />
              </Field>
              <Field id="supplies" label={CALCULATOR_INPUT_LABELS.supplyCost} hint="Blank counts as zero.">
                <Input id="supplies" inputMode="decimal" min={0} step="0.01" type="number" value={supplyCost} onChange={(event) => setSupplyCost(event.target.value)} />
              </Field>
              <Field id="overhead" label={CALCULATOR_INPUT_LABELS.overhead} hint="Blank counts as zero.">
                <Input id="overhead" inputMode="decimal" min={0} step="0.01" type="number" value={overhead} onChange={(event) => setOverhead(event.target.value)} />
              </Field>
              <Field id="margin" label={CALCULATOR_INPUT_LABELS.margin} hint="Percent of the quote you want left after wages, supplies, and overhead.">
                <Input id="margin" inputMode="decimal" min={0} max={100} step="0.1" type="number" value={margin} onChange={(event) => setMargin(event.target.value)} />
              </Field>
            </div>
          </form>

          <section aria-live="polite" className="rounded-2xl border border-border bg-card p-6 space-y-6 lg:sticky lg:top-6">
            {result ? (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">Recommended price per clean</p>
                  <p className="text-4xl font-bold text-foreground tabular-nums" data-testid="quote-price">{formatUsd(result.quote)}</p>
                  <p className="text-sm text-muted-foreground mt-1">{result.frequencyLabel} · {result.serviceName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Price range</p>
                  <p className="text-xl font-semibold tabular-nums">{formatUsd(result.priceRange.low)} – {formatUsd(result.priceRange.high)}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Stat label="Estimated hours" value={result.economics?.estimatedHours == null ? "—" : formatHours(result.economics.estimatedHours)} />
                  <Stat label="Effective hourly rate" value={result.economics?.effectiveHourlyRate == null ? "—" : formatUsd(result.economics.effectiveHourlyRate, true)} />
                  <Stat label="Profit per job" value={result.economics?.profit == null ? "—" : formatUsd(result.economics.profit, true)} />
                </div>
                {result.economics?.shortfall != null ? (
                  <p className="text-sm text-destructive">
                    This quote is {formatUsd(result.economics.shortfall, true)} short of supplies, overhead, and your margin before any wages.
                  </p>
                ) : null}
                {result.economics == null ? (
                  <p className="text-sm text-muted-foreground">
                    Enter a cleaner hourly wage and a target profit margin to estimate hours, effective hourly rate, and profit.
                  </p>
                ) : null}
                {result.sizeNote ? <p className="text-sm text-muted-foreground">{result.sizeNote}</p> : null}
                <div>
                  <h2 className="text-base font-semibold mb-2">Suggested recurring discount ladder</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 font-medium">Frequency</th>
                        <th className="py-1 font-medium">Discount</th>
                        <th className="py-1 font-medium text-right">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.ladder.map((rung) => (
                        <tr key={rung.frequency} className={rung.frequency === frequency ? "text-foreground font-medium" : "text-muted-foreground"}>
                          <td className="py-1">{rung.label}</td>
                          <td className="py-1">{rung.discountPct}%</td>
                          <td className="py-1 text-right tabular-nums">{formatUsd(rung.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">Enter square footage, or switch to beds and baths, to see a price.</p>
            )}
            <TrialActions />
          </section>
        </div>

        <section className="space-y-4 max-w-3xl" id="formula">
          <h2 className="text-2xl font-bold text-foreground">Formula</h2>
          <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
            {(result ? result.formulaLines : FORMULA_STEPS).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>

        <article className="space-y-4 max-w-3xl" id="how-to-price">
          <h2 className="text-2xl font-bold text-foreground">How to price a house clean</h2>
          {EXPLAINER_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph.slice(0, 48)} className="text-muted-foreground leading-relaxed">{paragraph}</p>
          ))}
        </article>

        <section className="space-y-6 max-w-3xl" id="faq">
          <h2 className="text-2xl font-bold text-foreground">Frequently asked questions</h2>
          <dl className="space-y-6">
            {CALCULATOR_FAQS.map((faq) => (
              <div key={faq.question}>
                <dt className="font-semibold text-foreground">{faq.question}</dt>
                <dd className="mt-1 text-muted-foreground leading-relaxed">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <TrialActions />
      </main>
      <SiteFooter />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
