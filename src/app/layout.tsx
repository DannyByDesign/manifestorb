import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Magic Orb",
  description:
    "A whimsical, boldly colored interface prototype built around a luminous interactive orb.",
  applicationName: "Magic Orb",
  keywords: [
    "Magic Orb",
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
    title: "Magic Orb",
    description:
      "A whimsical, boldly colored interface prototype built around a luminous interactive orb.",
    siteName: "Magic Orb",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Magic Orb",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
