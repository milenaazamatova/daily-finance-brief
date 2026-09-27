import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p className="subtitle">This story doesn&apos;t exist (it may have been replaced when a brief was re-run).</p>
      <Link href="/">← Back to today&apos;s brief</Link>
    </main>
  );
}
