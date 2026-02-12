import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { AuthConnectionPanel } from "@/components/landing/AuthConnectionPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function ConnectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?returnTo=/connect");
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Connect Integrations</h1>
        <p className="text-sm text-gray-600">
          Use this page to connect or reconnect Gmail, Calendar, and Drive.
        </p>
        <div className="rounded-xl bg-black p-4">
          <AuthConnectionPanel />
        </div>
      </div>
    </main>
  );
}
