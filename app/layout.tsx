import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Analytics from "./_components/Analytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// metadataBase lets relative OG / Twitter image URLs resolve to absolute ones.
// Override via NEXT_PUBLIC_SITE_URL in production.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "RealVerdict — Walk-away price for buy-and-hold rental investors",
    template: "%s · RealVerdict",
  },
  description:
    "Underwrite a rental listing in one pass: verdict, cash flow, cap rate, DSCR, IRR — and the maximum offer where the deal still clears your bar. Optional Negotiation Pack when you are ready to go to contract.",
  openGraph: {
    type: "website",
    siteName: "RealVerdict",
    title:
      "RealVerdict — Walk-away price for buy-and-hold rental investors",
    description:
      "Numbers-first underwriting for residential rentals you would hold and lease. Verdict plus walk-away price; live comps when you opt in.",
    images: ["/api/og"],
  },
  twitter: {
    card: "summary_large_image",
    title:
      "RealVerdict — Walk-away price for buy-and-hold rental investors",
    description:
      "Underwrite the rental before you fall in love with the listing. Walk-away price built in.",
    images: ["/api/og"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
