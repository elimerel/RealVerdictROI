import type { Metadata } from "next";

// LAST_REVISED — bump when material terms change. We surface this date
// at the top of the rendered page so users know which version they
// agreed to. The "Changes to terms" clause below is what actually
// covers updates legally; this date is for transparency.
const LAST_REVISED = "April 30, 2026";

export const metadata: Metadata = {
  title: "Terms of Service — RealVerdict",
  description:
    "The terms governing your use of RealVerdict, the desktop and web app for underwriting any real-estate listing.",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-black dark:to-zinc-950">

      <main className="flex-1">
        <article className="legal-doc mx-auto w-full max-w-2xl px-6 py-16 sm:py-20 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          <p className="text-xs uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-500">
            Last revised {LAST_REVISED}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Terms of Service</h1>

          <p>
            These Terms of Service (the &ldquo;Terms&rdquo;) govern your use of
            RealVerdict (the &ldquo;Service&rdquo;), provided by RealVerdict
            (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). By creating
            an account or using the Service you agree to these Terms. If you do
            not agree, do not use the Service.
          </p>

          <h2>1. What RealVerdict is</h2>
          <p>
            RealVerdict is a tool that helps you underwrite real-estate listings
            you find on the public web. The Service may include a desktop
            application that embeds a standard browser, an analysis side panel
            that surfaces structured property data and derived calculations
            (DSCR, cash flow, cap rate, and similar), and a personal pipeline
            of saved analyses.
          </p>
          <p>
            <strong>RealVerdict is a calculator.</strong> It is not a
            brokerage, lender, advisor, or fiduciary. It does not represent you
            in any transaction.
          </p>

          <h2>2. Your responsibility for the pages you analyze</h2>
          <p>
            You certify that you have the right to access any web page you
            navigate to within RealVerdict, and that you are using the Service
            as a tool to assist your own analysis of pages you would otherwise
            be entitled to view in any web browser. RealVerdict acts on your
            behalf, at your direction, on pages that <em>you</em> have
            navigated to. You are solely responsible for your access to those
            pages and for complying with the terms of service of any third-
            party site you visit through the Service.
          </p>

          <h2>3. Personal use only — no commercial redistribution</h2>
          <p>
            Saved listings, analyses, exports, and any other data the Service
            extracts on your behalf are for your personal use. You agree not
            to:
          </p>
          <ul>
            <li>scrape, crawl, or otherwise systematically harvest data via
              the Service;</li>
            <li>republish, resell, or redistribute extracted data, analyses,
              or outputs to third parties;</li>
            <li>use the Service to build a competing dataset, listings index,
              or analytics product;</li>
            <li>circumvent technical measures (rate limits, CAPTCHA prompts,
              login walls) on third-party sites; or</li>
            <li>use the Service in any way that violates the terms of service
              of a site you access through it.</li>
          </ul>

          <h2>4. No warranties about source data</h2>
          <p>
            Property data displayed in RealVerdict is extracted from third-
            party listings and other public sources. We make no representations
            or warranties of any kind, express or implied, about the accuracy,
            completeness, timeliness, or reliability of any extracted data,
            calculations, or analyses. <strong>You are responsible for
            independently verifying any data before making a financial
            decision.</strong>
          </p>

          <h2>5. Not financial, legal, tax, or real-estate advice</h2>
          <p>
            RealVerdict is provided for informational and educational purposes
            only. Outputs are not investment advice, real-estate advice, legal
            advice, tax advice, or recommendations of any kind. You should
            consult licensed professionals (a real-estate attorney, CPA,
            broker, lender, and/or financial advisor as appropriate) before
            making any real-estate decision. We do not solicit or facilitate
            transactions.
          </p>

          <h2>6. Accounts</h2>
          <p>
            You must be at least 18 years old to create an account. You are
            responsible for safeguarding your credentials and for any activity
            that occurs under your account. Notify us promptly at{" "}
            <a href="mailto:support@realverdict.app">support@realverdict.app</a>{" "}
            if you suspect unauthorized use.
          </p>

          <h2>7. Subscriptions and payments</h2>
          <p>
            Some features require a paid subscription. By subscribing you
            authorize us (or our payment processor, Stripe) to charge your
            payment method on a recurring basis until you cancel. You may cancel
            at any time from the Settings page; cancellation takes effect at
            the end of the current billing period. Subject to applicable law,
            we offer a 7-day refund on initial subscription charges if
            requested in writing to{" "}
            <a href="mailto:support@realverdict.app">support@realverdict.app</a>{" "}
            within 7 days of the charge. Subsequent renewal charges are
            non-refundable.
          </p>

          <h2>8. Intellectual property and DMCA</h2>
          <p>
            The Service, its source code, design, and brand assets are owned by
            us or our licensors and are protected by intellectual-property
            laws. We do not claim ownership of third-party listing content
            displayed inside the Service&rsquo;s embedded browser; that content
            belongs to its respective owners.
          </p>
          <p>
            If you believe content displayed or stored by the Service infringes
            your copyright, please send a notice that satisfies the
            requirements of the Digital Millennium Copyright Act (17 U.S.C.
            §&nbsp;512) to{" "}
            <a href="mailto:dmca@realverdict.app">dmca@realverdict.app</a> or
            via the form at{" "}
            <a href="https://realverdict.app/report">realverdict.app/report</a>. We will
            respond to
            valid notices promptly.
          </p>

          <h2>9. Termination</h2>
          <p>
            You may stop using the Service and delete your account at any time
            from Settings. We may suspend or terminate your access at any time,
            with or without notice, if we believe you have violated these
            Terms, applicable law, or the legitimate rights of any third party.
            Sections 2, 3, 4, 5, 8, 10, 11, 12, and 13 survive termination.
          </p>

          <h2>10. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, the Service is provided
            &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without
            warranty of any kind. We disclaim all implied warranties,
            including merchantability, fitness for a particular purpose, and
            non-infringement.
          </p>
          <p>
            To the maximum extent permitted by law, our aggregate liability to
            you arising out of or related to the Service will not exceed the
            greater of (a) the total amount you paid us in the twelve (12)
            months preceding the claim, or (b) US$&nbsp;100. We are not liable
            for indirect, incidental, special, consequential, exemplary, or
            punitive damages, including lost profits, lost data, or lost
            opportunities.
          </p>

          <h2>11. Indemnification</h2>
          <p>
            You agree to indemnify and hold us harmless from any claim, loss,
            or demand (including reasonable attorneys&rsquo; fees) arising out
            of your use of the Service, your breach of these Terms, or your
            violation of any law or third-party right.
          </p>

          <h2>12. Governing law and dispute resolution</h2>
          <p>
            These Terms are governed by the laws of the State of New Jersey,
            without regard to its conflict-of-laws principles. Any dispute
            arising out of or related to the Service or these Terms will be
            resolved exclusively in the state or federal courts located in New
            Jersey, and you consent to the personal jurisdiction of those
            courts.
          </p>

          <h2>13. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. If we make material
            changes, we will notify you by email or by an in-app notice prior
            to the changes taking effect. Continued use of the Service after
            an update constitutes acceptance of the updated Terms. The
            &ldquo;Last revised&rdquo; date at the top of this page reflects
            the most recent change.
          </p>

          <h2>14. Contact</h2>
          <p>
            Questions about these Terms? Email{" "}
            <a href="mailto:support@realverdict.app">support@realverdict.app</a>.
          </p>
        </article>
      </main>

    </div>
  );
}
