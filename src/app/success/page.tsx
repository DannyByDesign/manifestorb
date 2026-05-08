import Link from "next/link";

export const metadata = {
  title: "Sealed — ManifestOrb",
};

export default function SuccessPage() {
  return (
    <main className="relative isolate flex min-h-[100svh] w-full items-center justify-center overflow-hidden bg-[var(--base-lilac)] px-6 py-16">
      <div className="stage-backdrop absolute inset-0 -z-10" />
      <div className="w-full max-w-[28rem] text-center">
        <h1 className="font-serif text-[clamp(2.6rem,9vw,3.6rem)] font-normal leading-[1] tracking-[-0.012em] text-[#37285d]">
          Sealed.
        </h1>
        <p className="mx-auto mt-6 max-w-[22rem] text-[1.05rem] leading-[1.5] text-[#64567f]/88 sm:text-[1.12rem]">
          Your first letter from five-years-you is on its way. Watch your inbox
          over the next few minutes — and over the next five years.
        </p>
        <p className="mt-3 text-[0.85rem] leading-[1.5] text-[#64567f]/72">
          You can close this tab. We&apos;ll do the rest.
        </p>
        <div className="mt-10 flex justify-center">
          <Link
            href="/"
            className="orb-cta inline-flex h-12 items-center justify-center rounded-full px-7 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white outline-none"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
