// Read the environment on every request so a newly added key shows up after a restart.
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="card space-y-3 p-6">
        <h2 className="font-medium">Claude API key</h2>
        {hasKey ? (
          <p className="text-sm">
            <span className="mr-2 inline-block size-2 rounded-full bg-accent" />
            A key is set. AI features will use your Anthropic account.
          </p>
        ) : (
          <p className="text-sm">
            <span className="mr-2 inline-block size-2 rounded-full bg-stone-400" />
            No key set. The app works without one, using simpler built-in suggestions.
          </p>
        )}
        <p className="text-xs text-muted">
          To add a key, put it in the <code>.env.local</code> file in the app folder (see the README),
          then stop and restart the app. The key never leaves your computer&apos;s server process.
        </p>
      </section>

      <section className="card space-y-2 p-6">
        <h2 className="font-medium">AI spending</h2>
        <p className="text-sm text-muted">
          A running tally of API costs will show here once AI features arrive in milestone 3.
        </p>
      </section>
    </main>
  );
}
