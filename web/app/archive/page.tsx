import type { Metadata } from "next";
import Link from "next/link";
import { Tags } from "@/components/StoryCard";
import { ARCHIVE_PAGE_SIZE, searchStories, type Story } from "@/lib/data";
import { CATEGORIES, REGIONS, formatDate } from "@/lib/labels";

export const metadata: Metadata = { title: "Archive" };

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function ArchivePage({ searchParams }: PageProps<"/archive">) {
  const sp = await searchParams;
  // Only accept known values, so the URL can't be used to send arbitrary filters to the database.
  const category = Object.hasOwn(CATEGORIES, param(sp.category)) ? param(sp.category) : "";
  const region = Object.hasOwn(REGIONS, param(sp.region)) ? param(sp.region) : "";
  const q = param(sp.q).slice(0, 80);
  const page = Math.max(0, Number.parseInt(param(sp.page), 10) || 0);

  const { stories, total } = await searchStories({ category, region, q, page });

  // Group results by brief date for easy scanning.
  const days = new Map<string, Story[]>();
  for (const s of stories) days.set(s.brief_date, [...(days.get(s.brief_date) ?? []), s]);

  const link = (p: number) => {
    const params = new URLSearchParams({ ...(category && { category }), ...(region && { region }), ...(q && { q }) });
    if (p > 0) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/archive?${qs}` : "/archive";
  };
  const filtered = Boolean(category || region || q);

  return (
    <main>
      <h1>Archive</h1>
      <p className="subtitle">Every past brief. Filter by category or region, or search.</p>
      <p className="search-help">
        Tips: <code>&quot;interest rates&quot;</code> for an exact phrase, <code>oil OR gas</code> for either,{" "}
        <code>bank -UBS</code> to leave a word out. For the latest news on any topic, use <Link href="/search">Search</Link>.
      </p>

      {/* A plain GET form: filters live in the URL, so a filtered view can be bookmarked or shared. */}
      <form className="filters" action="/archive">
        <input className="search" type="search" name="q" defaultValue={q} placeholder="Search stories…" aria-label="Search" />
        <select name="category" defaultValue={category} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="region" defaultValue={region} aria-label="Region">
          <option value="">All regions</option>
          {Object.entries(REGIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit">Apply</button>
        {filtered && (
          <Link className="clear" href="/archive">
            Clear filters
          </Link>
        )}
      </form>

      <p className="result-count">
        {total} {total === 1 ? "story" : "stories"}
        {filtered && " match"}
      </p>

      {[...days.entries()].map(([date, items]) => (
        <section key={date}>
          <h2 className="archive-day">{formatDate(date)}</h2>
          {items.map((s) => (
            <Link key={s.id} href={`/story/${s.id}`} className="archive-item">
              <div className="headline">
                {s.is_top_story && "★ "}
                {s.headline}
              </div>
              <Tags story={s} linked={false} />
            </Link>
          ))}
        </section>
      ))}

      <div className="pager">
        {page > 0 ? <Link href={link(page - 1)}>← Newer</Link> : <span />}
        {(page + 1) * ARCHIVE_PAGE_SIZE < total && <Link href={link(page + 1)}>Older →</Link>}
      </div>
    </main>
  );
}
