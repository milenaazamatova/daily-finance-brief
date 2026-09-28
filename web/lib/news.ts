import "server-only";
import { XMLParser } from "fast-xml-parser";

// Live news search: asks Google News (free RSS, no API key) for the latest articles on any topic.
// Nothing is saved; results are only shown on the Search page.

export type NewsItem = { title: string; source: string; url: string; publishedAt: string | null };

export const PERIODS = { "1d": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" } as const;
export type Period = keyof typeof PERIODS;

// Added to every search so business and market coverage comes first ("finance-focused").
const FINANCE_TERMS =
  "(economy OR economic OR market OR markets OR investment OR investors OR bank OR banking OR stocks OR " +
  "shares OR bonds OR trade OR deal OR IPO OR oil OR inflation OR earnings OR finance)";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

type RssItem = { title?: string; link?: string; pubDate?: string; source?: string | { "#text"?: string } };

export async function searchNews(topic: string, period: Period): Promise<NewsItem[]> {
  const query = `${topic} ${FINANCE_TERMS} when:${period}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

  // Identical searches are reused for 15 minutes: instant repeats, and polite to Google.
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; DailyFinanceBrief/1.0)" },
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`News search failed (${res.status})`);

  const xml = parser.parse(await res.text());
  const raw = xml?.rss?.channel?.item ?? [];
  const items: RssItem[] = Array.isArray(raw) ? raw : [raw];

  const seen = new Set<string>();
  const results: NewsItem[] = [];
  for (const item of items) {
    const link = String(item.link ?? "");
    if (!/^https?:\/\//.test(link)) continue; // only ever link to real web pages
    const source = typeof item.source === "string" ? item.source : item.source?.["#text"] ?? "";
    // Google News titles end in " - Publisher"; the publisher is shown separately.
    let title = String(item.title ?? "").trim();
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const date = item.pubDate ? new Date(item.pubDate) : null;
    results.push({ title, source: source || "Google News", url: link, publishedAt: date && !isNaN(+date) ? date.toISOString() : null });
  }
  // Keep Google's order: it ranks by relevance (and favours recent articles) within the chosen period.
  return results.slice(0, 40);
}
