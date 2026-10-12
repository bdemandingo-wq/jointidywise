/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1";
import { BRAND, styles } from "./_brand.ts";
import { Logo } from "./_logo.tsx";
import { Footer } from "./_footer.tsx";

export interface CleanerRow {
  name: string;
  jobs: number;
  revenue: number;
  payout: number;
  hours: number;
  payoutChangePct: number | null; // null = no prior-period data
}

export interface PayrollReportProps {
  orgName: string;
  periodLabel: string;
  totals: {
    revenue: number;
    payroll: number;
    profit: number;
    laborPct: number; // 0–100
    jobs: number;
    cleanersWorked: number;
  };
  changeVsPrevious: {
    revenuePct: number;
    payrollPct: number;
    jobsPct: number;
  } | null;
  cleaners: CleanerRow[];
  standouts: {
    topEarner?: { name: string; payout: number };
    mostJobs?: { name: string; jobs: number };
    highestAvg?: { name: string; avgPayout: number };
  } | null;
  warnings: {
    idleCleaners: string[];
    noStripeCleaners: string[];
    negativeMarginBookings: number;
    zeroPayBookings: number;
  };
  ctaUrl: string;
}

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const fmtUsdCents = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtPct = (n: number) =>
  `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const local = {
  hero: {
    backgroundColor: "#f8f9ff",
    border: `1px solid ${BRAND.border}`,
    borderRadius: "12px",
    padding: "24px",
    margin: "0 0 24px",
    textAlign: "center" as const,
  },
  heroOrg: {
    fontSize: "13px",
    color: BRAND.muted,
    margin: "0 0 4px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  heroPeriod: {
    fontSize: "16px",
    color: BRAND.body,
    fontWeight: 600 as const,
    margin: "0 0 12px",
  },
  heroAmount: {
    fontSize: "36px",
    fontWeight: 700 as const,
    color: BRAND.primary,
    margin: 0,
    letterSpacing: "-0.02em",
  },
  heroLabel: {
    fontSize: "13px",
    color: BRAND.muted,
    margin: "4px 0 0",
  },
  sectionTitle: {
    fontSize: "13px",
    fontWeight: 700 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: BRAND.muted,
    margin: "24px 0 12px",
  },
  statCard: {
    border: `1px solid ${BRAND.border}`,
    borderRadius: "10px",
    padding: "12px 8px",
    textAlign: "center" as const,
  },
  statValue: {
    fontSize: "18px",
    fontWeight: 700 as const,
    color: BRAND.body,
    margin: 0,
  },
  statLabel: {
    fontSize: "11px",
    color: BRAND.muted,
    margin: "4px 0 0",
    lineHeight: "1.3",
  },
  statChange: {
    fontSize: "11px",
    margin: "2px 0 0",
  },
  changeUp: { color: BRAND.accent },
  changeDown: { color: "#dc2626" },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    margin: "0 0 12px",
  },
  th: {
    fontSize: "11px",
    fontWeight: 700 as const,
    color: BRAND.muted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    padding: "8px 6px",
    borderBottom: `1px solid ${BRAND.border}`,
    textAlign: "left" as const,
  },
  thRight: {
    fontSize: "11px",
    fontWeight: 700 as const,
    color: BRAND.muted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    padding: "8px 6px",
    borderBottom: `1px solid ${BRAND.border}`,
    textAlign: "right" as const,
  },
  td: {
    fontSize: "13px",
    color: BRAND.body,
    padding: "10px 6px",
    borderBottom: `1px solid ${BRAND.border}`,
    textAlign: "left" as const,
  },
  tdRight: {
    fontSize: "13px",
    color: BRAND.body,
    padding: "10px 6px",
    borderBottom: `1px solid ${BRAND.border}`,
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums" as const,
  },
  tdPayout: {
    fontSize: "13px",
    color: BRAND.body,
    padding: "10px 6px",
    borderBottom: `1px solid ${BRAND.border}`,
    textAlign: "right" as const,
    fontWeight: 600 as const,
    fontVariantNumeric: "tabular-nums" as const,
  },
  standoutCard: {
    border: `1px solid ${BRAND.border}`,
    borderRadius: "10px",
    padding: "12px",
    backgroundColor: "#f9fafb",
  },
  standoutLabel: {
    fontSize: "11px",
    color: BRAND.muted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    margin: "0 0 4px",
  },
  standoutName: {
    fontSize: "14px",
    fontWeight: 600 as const,
    color: BRAND.body,
    margin: "0 0 2px",
  },
  standoutValue: {
    fontSize: "13px",
    color: BRAND.accent,
    fontWeight: 600 as const,
    margin: 0,
  },
  warnBox: {
    border: "1px solid #fbbf24",
    backgroundColor: "#fffbeb",
    borderRadius: "10px",
    padding: "14px 16px",
    margin: "0 0 10px",
  },
  warnTitle: {
    fontSize: "13px",
    fontWeight: 700 as const,
    color: "#92400e",
    margin: "0 0 4px",
  },
  warnText: {
    fontSize: "13px",
    color: "#92400e",
    margin: 0,
    lineHeight: "1.5",
  },
};

export const PayrollPeriodReport = ({
  orgName,
  periodLabel,
  totals,
  changeVsPrevious,
  cleaners,
  standouts,
  warnings,
  ctaUrl,
}: PayrollReportProps) => {
  const hasWarnings =
    warnings.idleCleaners.length > 0 ||
    warnings.noStripeCleaners.length > 0 ||
    warnings.negativeMarginBookings > 0 ||
    warnings.zeroPayBookings > 0;

  const containerStyle = { ...styles.container, maxWidth: "640px" };

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Payroll report for {orgName} — {fmtUsd(totals.payroll)} across {totals.jobs} jobs
      </Preview>
      <Body style={styles.main}>
        <Container style={containerStyle}>
          <Logo />

          {/* Hero */}
          <Section style={local.hero}>
            <Text style={local.heroOrg}>{orgName}</Text>
            <Text style={local.heroPeriod}>Payroll · {periodLabel}</Text>
            <Heading as="h1" style={local.heroAmount}>
              {fmtUsd(totals.payroll)}
            </Heading>
            <Text style={local.heroLabel}>Total payroll owed this period</Text>
          </Section>

          {/* Stats grid — 3-up row, then 3-up row */}
          <Text style={local.sectionTitle}>This period at a glance</Text>
          <Row>
            <Column style={{ width: "33%", paddingRight: "6px" }}>
              <Section style={local.statCard}>
                <Text style={local.statValue}>{fmtUsd(totals.revenue)}</Text>
                <Text style={local.statLabel}>Revenue</Text>
                {changeVsPrevious && (
                  <Text
                    style={{
                      ...local.statChange,
                      ...(changeVsPrevious.revenuePct >= 0
                        ? local.changeUp
                        : local.changeDown),
                    }}
                  >
                    {fmtPct(changeVsPrevious.revenuePct)} vs prev
                  </Text>
                )}
              </Section>
            </Column>
            <Column style={{ width: "33%", padding: "0 3px" }}>
              <Section style={local.statCard}>
                <Text style={local.statValue}>{fmtUsd(totals.payroll)}</Text>
                <Text style={local.statLabel}>Payroll</Text>
                {changeVsPrevious && (
                  <Text
                    style={{
                      ...local.statChange,
                      ...(changeVsPrevious.payrollPct <= 0
                        ? local.changeUp
                        : local.changeDown),
                    }}
                  >
                    {fmtPct(changeVsPrevious.payrollPct)} vs prev
                  </Text>
                )}
              </Section>
            </Column>
            <Column style={{ width: "33%", paddingLeft: "6px" }}>
              <Section style={local.statCard}>
                <Text style={local.statValue}>{fmtUsd(totals.profit)}</Text>
                <Text style={local.statLabel}>Gross profit</Text>
                <Text style={local.statLabel}>{totals.laborPct.toFixed(0)}% labor</Text>
              </Section>
            </Column>
          </Row>

          <Section style={{ height: "8px" }} />

          <Row>
            <Column style={{ width: "50%", paddingRight: "6px" }}>
              <Section style={local.statCard}>
                <Text style={local.statValue}>{totals.jobs}</Text>
                <Text style={local.statLabel}>Jobs completed</Text>
                {changeVsPrevious && (
                  <Text
                    style={{
                      ...local.statChange,
                      ...(changeVsPrevious.jobsPct >= 0
                        ? local.changeUp
                        : local.changeDown),
                    }}
                  >
                    {fmtPct(changeVsPrevious.jobsPct)} vs prev
                  </Text>
                )}
              </Section>
            </Column>
            <Column style={{ width: "50%", paddingLeft: "6px" }}>
              <Section style={local.statCard}>
                <Text style={local.statValue}>{totals.cleanersWorked}</Text>
                <Text style={local.statLabel}>Cleaners who worked</Text>
              </Section>
            </Column>
          </Row>

          {/* Per-cleaner table */}
          {cleaners.length > 0 && (
            <>
              <Text style={local.sectionTitle}>Cleaner breakdown</Text>
              <table style={local.table}>
                <thead>
                  <tr>
                    <th style={local.th}>Cleaner</th>
                    <th style={local.thRight}>Jobs</th>
                    <th style={local.thRight}>Revenue</th>
                    <th style={local.thRight}>Payout</th>
                    <th style={local.thRight}>vs Prev</th>
                  </tr>
                </thead>
                <tbody>
                  {cleaners.map((c) => (
                    <tr key={c.name}>
                      <td style={local.td}>{c.name}</td>
                      <td style={local.tdRight}>{c.jobs}</td>
                      <td style={local.tdRight}>{fmtUsd(c.revenue)}</td>
                      <td style={local.tdPayout}>{fmtUsdCents(c.payout)}</td>
                      <td
                        style={{
                          ...local.tdRight,
                          ...(c.payoutChangePct == null
                            ? { color: BRAND.muted }
                            : c.payoutChangePct >= 0
                              ? local.changeUp
                              : local.changeDown),
                        }}
                      >
                        {c.payoutChangePct == null ? "—" : fmtPct(c.payoutChangePct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Standouts */}
          {standouts &&
            (standouts.topEarner || standouts.mostJobs || standouts.highestAvg) && (
              <>
                <Text style={local.sectionTitle}>Standouts</Text>
                <Row>
                  {standouts.topEarner && (
                    <Column style={{ width: "33%", paddingRight: "6px" }}>
                      <Section style={local.standoutCard}>
                        <Text style={local.standoutLabel}>Top earner</Text>
                        <Text style={local.standoutName}>
                          {standouts.topEarner.name}
                        </Text>
                        <Text style={local.standoutValue}>
                          {fmtUsdCents(standouts.topEarner.payout)}
                        </Text>
                      </Section>
                    </Column>
                  )}
                  {standouts.mostJobs && (
                    <Column style={{ width: "33%", padding: "0 3px" }}>
                      <Section style={local.standoutCard}>
                        <Text style={local.standoutLabel}>Most jobs</Text>
                        <Text style={local.standoutName}>{standouts.mostJobs.name}</Text>
                        <Text style={local.standoutValue}>
                          {standouts.mostJobs.jobs} jobs
                        </Text>
                      </Section>
                    </Column>
                  )}
                  {standouts.highestAvg && (
                    <Column style={{ width: "33%", paddingLeft: "6px" }}>
                      <Section style={local.standoutCard}>
                        <Text style={local.standoutLabel}>Highest avg/job</Text>
                        <Text style={local.standoutName}>
                          {standouts.highestAvg.name}
                        </Text>
                        <Text style={local.standoutValue}>
                          {fmtUsdCents(standouts.highestAvg.avgPayout)}
                        </Text>
                      </Section>
                    </Column>
                  )}
                </Row>
              </>
            )}

          {/* Warnings / Action items */}
          {hasWarnings && (
            <>
              <Text style={local.sectionTitle}>Action items</Text>
              {warnings.noStripeCleaners.length > 0 && (
                <Section style={local.warnBox}>
                  <Text style={local.warnTitle}>
                    Stripe Connect not set up ({warnings.noStripeCleaners.length})
                  </Text>
                  <Text style={local.warnText}>
                    {warnings.noStripeCleaners.join(", ")} — these cleaners can't
                    receive direct payouts until they finish onboarding.
                  </Text>
                </Section>
              )}
              {warnings.idleCleaners.length > 0 && (
                <Section style={local.warnBox}>
                  <Text style={local.warnTitle}>
                    Idle cleaners — possible churn ({warnings.idleCleaners.length})
                  </Text>
                  <Text style={local.warnText}>
                    {warnings.idleCleaners.join(", ")} worked in at least one of the
                    prior 2 periods but had zero jobs this period.
                  </Text>
                </Section>
              )}
              {warnings.negativeMarginBookings > 0 && (
                <Section style={local.warnBox}>
                  <Text style={local.warnTitle}>
                    Negative-margin bookings ({warnings.negativeMarginBookings})
                  </Text>
                  <Text style={local.warnText}>
                    Labor cost exceeded revenue on {warnings.negativeMarginBookings}{" "}
                    booking{warnings.negativeMarginBookings === 1 ? "" : "s"} —
                    review pricing or wage configuration.
                  </Text>
                </Section>
              )}
              {warnings.zeroPayBookings > 0 && (
                <Section style={local.warnBox}>
                  <Text style={local.warnTitle}>
                    $0 cleaner pay ({warnings.zeroPayBookings})
                  </Text>
                  <Text style={local.warnText}>
                    {warnings.zeroPayBookings} completed booking
                    {warnings.zeroPayBookings === 1 ? " has" : "s have"} no cleaner
                    pay configured. Pay these manually or set a wage on the
                    cleaner / service.
                  </Text>
                </Section>
              )}
            </>
          )}

          <Section style={styles.buttonWrap}>
            <Button href={ctaUrl} style={styles.button}>
              Process payroll in TidyWise
            </Button>
          </Section>

          <Hr style={styles.divider} />
          <Text style={styles.hint}>
            You're getting this because automatic payroll reports are enabled for{" "}
            {orgName}. Turn them off in Settings → Payroll → Email reports.
          </Text>

          <Footer />
        </Container>
      </Body>
    </Html>
  );
};

export default PayrollPeriodReport;
