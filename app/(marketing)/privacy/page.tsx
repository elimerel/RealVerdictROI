import type { Metadata } from "next";

const LAST_REVISED = "April 30, 2026";

export const metadata: Metadata = {
  title: "Privacy Policy — RealVerdict",
  description:
    "How RealVerdict collects, uses, and protects your data. The short version: we collect what we need to run the product, nothing else.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">

      <main className="flex-1">
        <article className="legal-doc mx-auto w-full max-w-2xl px-6 py-16 sm:py-20 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          <p className="text-xs uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-500">
            Last revised {LAST_REVISED}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Privacy Policy</h1>

          <p>
            This Privacy Policy explains what data RealVerdict (the
            &ldquo;Service&rdquo;) collects when you use it, how we use that
            data, and the choices you have. It should read like a colleague
            telling you what&rsquo;s actually going on, not a legal document.
            If something is unclear, email{" "}
            <a href="mailto:privacy@realverdict.app">privacy@realverdict.app</a>{" "}
            and we&rsquo;ll fix it.
          </p>

          <h2>1. The short version</h2>
          <ul>
            <li>We collect the minimum needed to run the product: your
              account info, the deals you save, and basic operational logs.</li>
            <li>We do <strong>not</strong> store property photos, full
              listing descriptions, the HTML of pages you analyze, or any
              third-party tracking pixels.</li>
            <li>We do <strong>not</strong> sell your data to anyone.</li>
            <li>You can export, correct, or delete your data at any time.</li>
          </ul>

          <h2>2. What we collect</h2>
          <h3>Account data</h3>
          <p>
            When you sign up we collect your email address, a hashed password,
            and (if you sign in with Google) a unique Google account
            identifier. Authentication is handled by Supabase on our behalf.
          </p>

          <h3>Saved deals</h3>
          <p>For every deal you save we store:</p>
          <ul>
            <li>The property address, city, state, and zip;</li>
            <li>Structured property facts: beds, baths, square footage,
              year built, lot size, asking price, taxes, HOA, property type;</li>
            <li>Your editable assumption inputs (down payment, interest rate,
              vacancy, opex, rent override, etc.);</li>
            <li>Derived calculations (DSCR, cash flow, cap rate, IRR, monthly
              breakdown);</li>
            <li>The source URL and the source site identifier (e.g.
              &ldquo;zillow&rdquo;);</li>
            <li>A short AI-written one-sentence summary (the
              &ldquo;take&rdquo;) and a small set of short factual risk tags
              (e.g. &ldquo;flood zone&rdquo;, &ldquo;high HOA&rdquo;);</li>
            <li>Timestamps and your user ID.</li>
          </ul>

          <h3>Usage data</h3>
          <p>
            We collect basic operational data necessary to run the Service:
            web request logs (Vercel), error reports (Sentry), and Stripe
            payment metadata. These contain IP addresses, browser identifiers,
            and timestamps, but no payment-card numbers (those are handled
            entirely by Stripe and never reach our servers).
          </p>

          <h2>3. What we deliberately do <em>not</em> collect</h2>
          <ul>
            <li>Photos of properties (URLs or binaries).</li>
            <li>Full listing descriptions verbatim. We only store short
              factual data; never the marketing copy from the source page.</li>
            <li>Browsing history outside of listings you explicitly analyze.
              The embedded browser does not log the URLs you visit anywhere
              outside the active analysis surface.</li>
            <li>Third-party tracking pixels, advertising cookies, or
              session-replay scripts.</li>
            <li>Page HTML or DOM snapshots.</li>
          </ul>

          <h2>4. How we use the data</h2>
          <ul>
            <li>To provide the Service: extract structured facts from pages
              you analyze, compute and display analyses, and remember the
              deals you save.</li>
            <li>To communicate with you: account confirmations, billing
              receipts, security notices, and (if you opt in) product
              updates.</li>
            <li>To debug and improve the Service: aggregated, deidentified
              metrics on which extractor paths succeed and which fail.</li>
            <li>To enforce these terms and prevent abuse.</li>
          </ul>

          <h2>5. Sub-processors</h2>
          <p>
            We use a small set of third-party services (&ldquo;sub-
            processors&rdquo;) to operate RealVerdict. Each processes data on
            our behalf and is contractually required to keep it confidential.
          </p>
          <table>
            <thead>
              <tr><th>Provider</th><th>Purpose</th></tr>
            </thead>
            <tbody>
              <tr><td>Supabase</td><td>Authentication and database hosting</td></tr>
              <tr><td>Vercel</td><td>Web hosting and edge delivery</td></tr>
              <tr><td>Anthropic</td><td>AI extraction (page-text → structured facts)</td></tr>
              <tr><td>OpenAI</td><td>AI extraction fallback (when used)</td></tr>
              <tr><td>Stripe</td><td>Subscription billing and payment processing</td></tr>
              <tr><td>Sentry</td><td>Error reporting and debugging</td></tr>
              <tr><td>RentCast</td><td>Rent estimates (when used)</td></tr>
            </tbody>
          </table>
          <p>
            Page text submitted to Anthropic and OpenAI is used only to
            produce your extraction result. Per their published policies, your
            content is not used to train their general-purpose models.
          </p>

          <h2>6. Data retention</h2>
          <p>
            Saved deals persist until you delete them or close your account.
            On account closure, all of your account data is deleted from our
            production database within 30 days. Backups are rotated on a
            90-day cycle, after which residual copies are also purged.
          </p>
          <p>
            Operational logs (request logs, error reports, billing metadata)
            are retained per the standard retention policies of our
            sub-processors (typically 30&ndash;90 days).
          </p>

          <h2>7. Your rights</h2>
          <p>You can:</p>
          <ul>
            <li>Export all data we have about you;</li>
            <li>Correct inaccuracies;</li>
            <li>Delete your account and all associated data;</li>
            <li>Object to or restrict processing in narrow cases.</li>
          </ul>
          <p>
            Email <a href="mailto:privacy@realverdict.app">privacy@realverdict.app</a>{" "}
            with the email address on your account and we&rsquo;ll respond
            within 30 days. If you are in the EU, UK, or California, you have
            additional rights under GDPR / UK GDPR / CCPA respectively; the
            same email handles those requests.
          </p>

          <h2>8. Cookies</h2>
          <p>
            We use session cookies that are strictly necessary for
            authentication. We do not use marketing or analytics cookies. If
            we ever add analytics, we will update this policy and ask for your
            consent where required by law.
          </p>

          <h2>9. International transfers</h2>
          <p>
            We are based in the United States. Some of our sub-processors
            operate in other countries. By using the Service, you consent to
            the transfer of your data to the United States and to the
            countries in which our sub-processors operate, subject to
            appropriate safeguards under applicable law.
          </p>

          <h2>10. Children</h2>
          <p>
            The Service is not intended for users under 18. We do not
            knowingly collect data from children. If you believe we have
            inadvertently collected data from a child, contact{" "}
            <a href="mailto:privacy@realverdict.app">privacy@realverdict.app</a>{" "}
            and we will delete it.
          </p>

          <h2>11. Security</h2>
          <p>
            We use industry-standard technical and organizational measures to
            protect your data, including TLS in transit, encryption at rest
            via our hosting providers, and least-privilege access controls. No
            system is perfectly secure. If we ever experience a breach
            affecting your data, we will notify you as required by law.
          </p>

          <h2>12. Changes to this Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Material
            changes will be announced by email or in-app notice prior to
            taking effect. The &ldquo;Last revised&rdquo; date at the top of
            this page reflects the most recent change.
          </p>

          <h2>13. Contact</h2>
          <p>
            Questions about this Privacy Policy or how we handle your data?
            Email <a href="mailto:privacy@realverdict.app">privacy@realverdict.app</a>.
          </p>
        </article>
      </main>

    </div>
  );
}
