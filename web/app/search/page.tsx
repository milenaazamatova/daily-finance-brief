import type { Metadata } from "next";
import Link from "next/link";
import { Tags } from "@/components/StoryCard";
import { searchStories } from "@/lib/data";
import { formatDate } from "@/lib/labels";
import { PERIODS, searchNews, type NewsItem, type Period } from "@/lib/news";

export const metadata: Metadata = { title: "Search" };

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const q = param(sp.q).slice(0, 100);
  const period: Period = Object.hasOwn(PERIODS, param(sp.period)) ? (param(sp.period) as Period) : "7d";

  // Both searches run at the same time. If the live news search fails, the archive results still show.
  const [archive, news] = q
    ? await Promise.all([
        searchStories({ q, page: 0 }),
        searchNews(q, period).then(
          (items) => ({ items, failed: false }),
          () => ({ items: [] as NewsItem[], failed: true }),
        ),
      ])
    : [null, null];

  return (
    <main>
      <h1>Search any topic</h1>
      <p className="subtitle">Type anything (a country, company, commodity, theme) and get the latest finance news on it.</p>

      <form className="filters" action="/search">
        <input className="search" type="search" name="q" defaultValue={q} placeholder="e.g. Uzbekistan gold, Aramco, copper prices" aria-label="Topic" />
        <select name="period" defaultValue={period} aria-label="Time period">
          {Object.entries(PERIODS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit">Search</button>
      </form>

      {archive && archive.total > 0 && (
        <section className="section">
          <h2>
            From your briefs <span className="count">{archive.total}</span>
          </h2>
          {archive.stories.slice(0, 5).map((s) => (
            <Link key={s.id} href={`/story/${s.id}`} className="archive-item">
              <div className="headline">{s.headline}</div>
              <div className="topic-meta">{formatDate(s.brief_date, false)}</div>
              <Tags story={s} linked={false} />
            </Link>
          ))}
          {archive.total > 5 && (
            <Link href={`/archive?q=${encodeURIComponent(q)}`}>See all {archive.total} in the Archive →</Link>
          )}
        </section>
      )}

      {news && (
        <section className="section">
          <h2>
            News <span className="count">{news.items.length}</span>
          </h2>
          {news.failed && <p className="quiet">The live news search isn&apos;t responding right now. Please try again in a minute.</p>}
          {!news.failed && news.items.length === 0 && (
            <p className="quiet">No finance news found for “{q}” in this period. Try a longer period or different words.</p>
          )}
          <ul className="news-results">
            {news.items.map((n) => (
              <li key={n.url}>
                <a href={n.url} target="_blank" rel="noopener noreferrer">
                  {n.title}
                </a>
                <span className="outlet">
                  {n.source}
                  {n.publishedAt && ` · ${when(n.publishedAt)}`}
                </span>
              </li>
            ))}
          </ul>
          {news.items.length > 0 && <p className="search-note">From Google News, most relevant first, finance-focused. Links open the original article.</p>}
        </section>
      )}
    </main>
  );
}
