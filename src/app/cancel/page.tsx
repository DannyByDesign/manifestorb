import Link from "next/link";

export const metadata = {
  title: "No letters sealed — ManifestOrb",
};

export default function CancelPage() {
  return (
    <main className="relative isolate flex min-h-[100svh] w-full items-center justify-center overflow-hidden bg-[var(--base-lilac)] px-6 py-16">
      <div className="stage-backdrop absolute inset-0 -z-10" />
      <div className="w-full max-w-[28rem] text-center">
        <h1 className="font-serif text-[clamp(2.2rem,7.5vw,3rem)] font-normal leading-[1.05] tracking-[-0.012em] text-[#37285d]">
          Nothing was sealed.
        </h1>
        <p className="mx-auto mt-6 max-w-[22rem] text-[1.05rem] leading-[1.5] text-[#64567f]/88 sm:text-[1.12rem]">
          Your answers are still here when you&apos;re ready. No charge was made.
        </p>
        <div className="mt-10 flex justify-center">
          <Link
            href="/"
            className="orb-cta inline-flex h-12 items-center justify-center rounded-full px-7 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white outline-none"
          >
            Try again
          </Link>
        </div>
      </div>
    </main>
  );
}
