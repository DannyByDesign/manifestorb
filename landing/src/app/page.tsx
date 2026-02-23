import { Scene } from "@/components/experience/Scene";
import { EmailCaptureOverlay } from "@/components/landing/EmailCaptureOverlay";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const body = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

export default function Page() {
  return (
    <main className={`relative h-screen w-full ${display.variable} ${body.variable}`}>
      <Scene />
      <EmailCaptureOverlay />
    </main>
  );
}
