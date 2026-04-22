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
    default: "RealVerdict — Know the max to offer before a deal goes bad",
    template: "%s · RealVerdict",
  },
  description:
    "Paste any Zillow URL and get the verdict — cash flow, cap rate, DSCR, IRR — plus the exact maximum offer price before the deal stops being a good one.",
  openGraph: {
    type: "website",
    siteName: "RealVerdict",
    title: "RealVerdict — Know the max to offer before a deal goes bad",
    description:
      "An honest, AI-powered verdict on any rental property. With the one number no other analyzer gives you: the walk-away price.",
    images: ["/api/og"],
  },
  twitter: {
    card: "summary_large_image",
    title: "RealVerdict — Know the max to offer before a deal goes bad",
    description:
      "An honest, AI-powered verdict on any rental property. With the walk-away price built in.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
