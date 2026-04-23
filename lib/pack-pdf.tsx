// ---------------------------------------------------------------------------
// Negotiation Pack — PDF document (HANDOFF §20.3 export path).
//
// Renders the same PackPayload that the web view at /pack/[shareToken] uses,
// so the PDF cannot ever drift from what the investor previewed before
// downloading. Layout target: 1–2 pages, agent-friendly formatting.
//
// We use @react-pdf/renderer (not html2pdf or puppeteer) because:
//   - It runs in Node/edge with no Chrome — works on Vercel.
//   - Output is real, selectable text + a stable wide layout.
//   - The component model maps 1:1 with the web view, so the section
//     ordering and copy stay in sync via shared PackPayload typing.
//
// This module is server-only (it imports from a Node lib). Exporting a
// React component that consumes PackPayload keeps the PDF route handler
// thin (just: fetch row, render document, stream).
// ---------------------------------------------------------------------------

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import type { PackPayload } from "./negotiation-pack";
import {
  formatCurrency,
  formatPercent,
  type VerdictTier,
} from "./calculations";

// ---------------------------------------------------------------------------
// Styles — kept inline so the PDF builds in the route handler's runtime
// without needing a separate CSS pipeline.
// ---------------------------------------------------------------------------

const COLORS = {
  text: "#0a0a0a",
  muted: "#525252",
  border: "#e5e5e5",
  bgSubtle: "#fafafa",
  accent: "#0a0a0a",
};

const TIER_COLOR: Record<VerdictTier, string> = {
  excellent: "#15803d",
  good: "#0369a1",
  fair: "#a16207",
  poor: "#c2410c",
  avoid: "#b91c1c",
};

const TIER_LABEL: Record<VerdictTier, string> = {
  excellent: "STRONG BUY",
  good: "GOOD DEAL",
  fair: "BORDERLINE",
  poor: "PASS",
  avoid: "AVOID",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLORS.text,
    lineHeight: 1.45,
  },
  // --- Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  title: {
    marginTop: 6,
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
  },
  headerMeta: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginRight: 8,
  },
  headerSub: {
    fontSize: 9,
    color: COLORS.muted,
  },
  divider: {
    marginTop: 12,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  // --- Section
  sectionTitle: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: COLORS.muted,
  },

  // --- Headline metrics block
  metricsRow: {
    flexDirection: "row",
    backgroundColor: COLORS.bgSubtle,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  metricCell: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 7,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },

  // --- Weak assumption
  assumptionItem: {
    marginBottom: 10,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#d4d4d4",
  },
  assumptionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  assumptionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
  },
  severityTag: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  assumptionGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 4,
  },
  assumptionField: { flex: 1 },
  assumptionFieldLabel: {
    fontSize: 7,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  assumptionFieldValue: {
    fontSize: 9,
  },
  assumptionReason: {
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 2,
  },
  assumptionGap: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    marginTop: 2,
  },

  // --- Comp evidence
  compsGrid: {
    flexDirection: "row",
    gap: 14,
  },
  compsCol: { flex: 1 },
  compsColTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: COLORS.muted,
    marginBottom: 4,
  },
  compCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 3,
    padding: 6,
    marginBottom: 6,
  },
  compAddress: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  compFacts: {
    flexDirection: "row",
    flexWrap: "wrap",
    fontSize: 8,
    marginTop: 2,
  },
  compFact: { marginRight: 8 },
  compWhy: {
    fontSize: 8,
    color: COLORS.muted,
    marginTop: 4,
  },

  // --- Stress table
  table: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  tableHeader: {
    flexDirection: "row",
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 6,
  },
  colScenario: { flex: 3 },
  colCash: { flex: 1.4, textAlign: "right" },
  colDscr: { flex: 1, textAlign: "right" },
  colVerdict: { flex: 1.6, textAlign: "right" },
  scenarioTitle: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  scenarioDesc: { fontSize: 8, color: COLORS.muted, marginTop: 1 },
  flippedTag: {
    marginTop: 2,
    fontSize: 7,
    color: "#a16207",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  // --- Counteroffer
  counterBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgSubtle,
    borderRadius: 4,
    padding: 12,
  },
  counterPara: { fontSize: 10, marginBottom: 8 },

  // --- Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: COLORS.muted,
    textAlign: "center",
  },
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PackDocument({
  payload,
  fallbackAddress,
}: {
  payload: PackPayload;
  fallbackAddress?: string;
}) {
  const tier = payload.headline.tier;
  const tierColor = TIER_COLOR[tier];
  const generatedDate = new Date(payload.generatedAt).toLocaleDateString(
    undefined,
    { month: "long", day: "numeric", year: "numeric" },
  );
  const address = fallbackAddress ?? payload.address;

  return (
    <Document
      title={`Negotiation Pack — ${address}`}
      author="RealVerdict"
      subject="Real estate negotiation analysis"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <Text>Negotiation Pack</Text>
          <Text>{generatedDate}</Text>
        </View>
        <Text style={styles.title}>{address}</Text>
        <View style={styles.headerMeta}>
          <Text style={[styles.pill, { backgroundColor: tierColor }]}>
            {TIER_LABEL[tier]}
          </Text>
          <Text style={styles.headerSub}>
            List: {formatCurrency(payload.headline.listPrice, 0)}
            {payload.headline.walkAwayPrice != null
              ? `   ·   Walk-away: ${formatCurrency(
                  payload.headline.walkAwayPrice,
                  0,
                )}`
              : ""}
          </Text>
        </View>
        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>Headline</Text>
        <Text>{payload.headline.framing}</Text>
        {payload.headline.deltaDollars != null &&
          payload.headline.deltaPercent != null && (
            <View style={styles.metricsRow}>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>List price</Text>
                <Text style={styles.metricValue}>
                  {formatCurrency(payload.headline.listPrice, 0)}
                </Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>Walk-away</Text>
                <Text style={styles.metricValue}>
                  {payload.headline.walkAwayPrice != null
                    ? formatCurrency(payload.headline.walkAwayPrice, 0)
                    : "—"}
                </Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>Gap</Text>
                <Text style={styles.metricValue}>
                  {formatCurrency(payload.headline.deltaDollars, 0)} (
                  {payload.headline.deltaPercent.toFixed(1)}%)
                </Text>
              </View>
            </View>
          )}

        <Text style={styles.sectionTitle}>
          Three weakest assumptions in the seller&apos;s pro forma
        </Text>
        {payload.weakAssumptions.length === 0 ? (
          <Text style={{ color: COLORS.muted }}>
            The listing inputs check out against the comp pool — no material
            gaps to flag. The ask is simply higher than the cash flow / DSCR
            math supports.
          </Text>
        ) : (
          payload.weakAssumptions.map((a, i) => (
            <View key={i} style={styles.assumptionItem} wrap={false}>
              <View style={styles.assumptionHeader}>
                <Text style={styles.assumptionTitle}>
                  {i + 1}. {a.field}
                </Text>
                <Text
                  style={[
                    styles.severityTag,
                    severityStyle(a.severity),
                  ]}
                >
                  {a.severity} impact
                </Text>
              </View>
              <View style={styles.assumptionGrid}>
                <View style={styles.assumptionField}>
                  <Text style={styles.assumptionFieldLabel}>
                    Listing implies
                  </Text>
                  <Text style={styles.assumptionFieldValue}>{a.current}</Text>
                </View>
                <View style={styles.assumptionField}>
                  <Text style={styles.assumptionFieldLabel}>Realistic</Text>
                  <Text style={styles.assumptionFieldValue}>{a.realistic}</Text>
                </View>
              </View>
              <Text style={styles.assumptionReason}>{a.reason}</Text>
              <Text style={styles.assumptionGap}>Gap: {a.gap}</Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Comp evidence</Text>
        <View style={styles.compsGrid}>
          <CompColumnPdf
            title="Sale comps"
            comps={payload.compEvidence.sale}
            kind="sale"
          />
          <CompColumnPdf
            title="Rent comps"
            comps={payload.compEvidence.rent}
            kind="rent"
          />
        </View>

        <Text style={styles.sectionTitle}>Stress scenarios</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colScenario}>Scenario</Text>
            <Text style={styles.colCash}>Cash flow</Text>
            <Text style={styles.colDscr}>DSCR</Text>
            <Text style={styles.colVerdict}>Verdict</Text>
          </View>
          {payload.stressScenarios.map((s, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <View style={styles.colScenario}>
                <Text style={styles.scenarioTitle}>{s.label}</Text>
                <Text style={styles.scenarioDesc}>{s.description}</Text>
              </View>
              <Text style={styles.colCash}>
                {formatCurrency(s.monthlyCashFlowAfter, 0)}/mo
              </Text>
              <Text style={styles.colDscr}>
                {isFinite(s.dscrAfter) ? s.dscrAfter.toFixed(2) : "∞"}
              </Text>
              <View style={styles.colVerdict}>
                <Text
                  style={{
                    color: TIER_COLOR[s.verdictAfter],
                    fontFamily: "Helvetica-Bold",
                    fontSize: 9,
                  }}
                >
                  {TIER_LABEL[s.verdictAfter]}
                </Text>
                {s.flippedFromBase && (
                  <Text style={styles.flippedTag}>flipped</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Counteroffer script</Text>
        <View style={styles.counterBox}>
          {payload.counteroffer.paragraphs.map((para, i) => (
            <Text key={i} style={styles.counterPara}>
              {para}
            </Text>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Snapshot at generation</Text>
        <View style={[styles.metricsRow, { flexWrap: "wrap" }]}>
          <SnapshotCellPdf
            label="Purchase price"
            value={formatCurrency(payload.snapshot.purchasePrice, 0)}
          />
          <SnapshotCellPdf
            label="Monthly rent"
            value={formatCurrency(payload.snapshot.monthlyRent, 0)}
          />
          <SnapshotCellPdf
            label="Cash flow"
            value={formatCurrency(payload.snapshot.monthlyCashFlow, 0)}
          />
          <SnapshotCellPdf
            label="Cap rate"
            value={formatPercent(payload.snapshot.capRate)}
          />
          <SnapshotCellPdf
            label="DSCR"
            value={
              isFinite(payload.snapshot.dscr)
                ? payload.snapshot.dscr.toFixed(2)
                : "∞"
            }
          />
          <SnapshotCellPdf
            label="IRR"
            value={
              isFinite(payload.snapshot.irr)
                ? formatPercent(payload.snapshot.irr)
                : "—"
            }
          />
        </View>
        <Text style={{ fontSize: 8, color: COLORS.muted, marginTop: 4 }}>
          Comp confidence: {payload.snapshot.compsConfidence.toUpperCase()}
        </Text>

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Powered by RealVerdict  ·  realverdictroi.com  ·  Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

function CompColumnPdf({
  title,
  comps,
  kind,
}: {
  title: string;
  comps: PackPayload["compEvidence"]["sale"];
  kind: "sale" | "rent";
}) {
  return (
    <View style={styles.compsCol}>
      <Text style={styles.compsColTitle}>{title}</Text>
      {comps.length === 0 ? (
        <Text style={{ fontSize: 8, color: COLORS.muted }}>
          No {kind} comps survived the scoring filters.
        </Text>
      ) : (
        comps.map((c, i) => (
          <View key={i} style={styles.compCard} wrap={false}>
            <Text style={styles.compAddress}>{c.address}</Text>
            <View style={styles.compFacts}>
              {c.beds != null && (
                <Text style={styles.compFact}>{c.beds}bd</Text>
              )}
              {c.baths != null && (
                <Text style={styles.compFact}>{c.baths}ba</Text>
              )}
              {c.sqft != null && (
                <Text style={styles.compFact}>
                  {c.sqft.toLocaleString()} sqft
                </Text>
              )}
              {c.price != null && (
                <Text
                  style={[styles.compFact, { fontFamily: "Helvetica-Bold" }]}
                >
                  {kind === "sale"
                    ? formatCurrency(c.price, 0)
                    : `${formatCurrency(c.price, 0)}/mo`}
                </Text>
              )}
            </View>
            <Text style={styles.compWhy}>{c.why}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function SnapshotCellPdf({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        width: "33%",
        marginBottom: 4,
      }}
    >
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function severityStyle(severity: "high" | "medium" | "low"): {
  color: string;
  backgroundColor: string;
} {
  switch (severity) {
    case "high":
      return { color: "#b91c1c", backgroundColor: "#fef2f2" };
    case "medium":
      return { color: "#a16207", backgroundColor: "#fefce8" };
    case "low":
      return { color: "#525252", backgroundColor: "#f5f5f5" };
  }
}

// react-pdf is unused here at module-load when this file is imported but
// not rendered; suppressing the unused warning is the simplest and most
// honest thing — Font is reserved for a future custom font register call.
void Font;
