export default function AccountsPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Account connected</h1>
        <p className="text-sm text-gray-600">
          Your Google account is linked. Continue to connect Calendar.
        </p>
        <a
          href="/connect"
          className="w-fit rounded bg-blue-600 px-4 py-2 text-white"
        >
          Go to connections
        </a>
      </div>
    </main>
  );
}
