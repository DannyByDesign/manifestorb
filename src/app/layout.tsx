import type { Metadata } from "next";
import { Newsreader } from "next/font/google";

import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";

const displaySerif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-display-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Manifestorb",
  description:
    "A whimsical, boldly colored interface prototype built around a luminous interactive orb.",
  applicationName: "Manifestorb",
  keywords: [
    "Manifestorb",
    "interactive UI",
    "orb interface",
    "motion design",
    "Next.js",
    "React Three Fiber",
  ],
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Manifestorb",
    description:
      "A whimsical, boldly colored interface prototype built around a luminous interactive orb.",
    siteName: "Manifestorb",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Manifestorb",
    description:
      "A whimsical, boldly colored interface prototype built around a luminous interactive orb.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={displaySerif.variable}>
      <body className="antialiased">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
