import { Scene } from "@/components/experience/Scene";
import { AuthConnectionPanel } from "@/components/landing/AuthConnectionPanel";

export default function Page() {
  return (
    <main className="relative h-screen w-full">
      <Scene />
      <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-4 md:p-6">
        <div className="pointer-events-auto">
          <AuthConnectionPanel />
        </div>
      </div>
    </main>
  );
}
