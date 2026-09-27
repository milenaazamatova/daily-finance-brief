"use client";

// Shown if a page fails to load (e.g. the database is unreachable).
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p className="subtitle">The brief couldn&apos;t be loaded right now.</p>
      <button className="theme-toggle" style={{ width: "auto", padding: "0 16px" }} onClick={reset}>
        Try again
      </button>
    </main>
  );
}
