import { getSupabase } from "./supabase";

export type Entity = { entity: string; impact: "positive" | "negative" | "mixed"; reason: string | null };
export type Source = { id: number; title: string; source: string; url: string; published_at: string | null };
export type Story = {
  id: number;
  headline: string;
  category: string;
  region: string;
  is_top_story: boolean;
  importance: number;
  what_happened: string;
  why_it_matters: string;
  concept_term: string | null;
  interview_question: string | null;
  entities: Entity[];
  sources: Source[];
  concept_explanation: string | null;
  brief_date: string;
};

// Columns are listed explicitly: on `articles` the anon key may only read these link columns.
const STORY_COLUMNS = `
  id, headline, category, region, is_top_story, importance, what_happened, why_it_matters,
  concept_term, interview_question,
  briefs!inner(brief_date),
  story_entities(entity, impact, reason),
  story_sources(articles(id, title, source, url, published_at))
`;

type StoryRow = Omit<Story, "entities" | "sources" | "concept_explanation" | "brief_date"> & {
  briefs: { brief_date: string };
  story_entities: Entity[];
  story_sources: { articles: Source | null }[];
};

function toStory(row: StoryRow, glossary: Map<string, string>): Story {
  const { briefs, story_entities, story_sources, ...rest } = row;
  return {
    ...rest,
    brief_date: briefs.brief_date,
    entities: story_entities,
    sources: story_sources.map((s) => s.articles).filter((a): a is Source => a !== null),
    concept_explanation: rest.concept_term ? glossary.get(rest.concept_term.toLowerCase()) ?? null : null,
  };
}

/** Explanations for these concept terms (glossary terms are unique, matched case-insensitively). */
async function glossaryFor(terms: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(terms.filter((t): t is string => !!t))];
  if (unique.length === 0) return new Map();
  // ilike without wildcards = case-insensitive equals. Escape the characters PostgREST/LIKE treat specially.
  const esc = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/"/g, '\\"');
  const { data, error } = await getSupabase()
    .from("glossary")
    .select("term, explanation")
    .or(unique.map((t) => `term.ilike."${esc(t)}"`).join(","));
  if (error) throw new Error(error.message);
  return new Map(data.map((g) => [g.term.toLowerCase(), g.explanation]));
}

async function withGlossary(rows: StoryRow[]): Promise<Story[]> {
  const glossary = await glossaryFor(rows.map((r) => r.concept_term));
  return rows.map((r) => toStory(r, glossary));
}

/** The most recent brief (before 07:00 Dubai that's still yesterday's) with all its stories in rank order. */
export async function getLatestBrief(): Promise<{ date: string; stories: Story[] } | null> {
  const supabase = getSupabase();
  const { data: brief, error } = await supabase
    .from("briefs")
    .select("id, brief_date")
    .order("brief_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!brief) return null;

  const { data, error: storiesError } = await supabase
    .from("stories")
    .select(STORY_COLUMNS)
    .eq("brief_id", brief.id)
    .order("id"); // stories are saved in Gemini's ranking order
  if (storiesError) throw new Error(storiesError.message);
  return { date: brief.brief_date, stories: await withGlossary(data as unknown as StoryRow[]) };
}

export async function getStory(id: number): Promise<Story | null> {
  const { data, error } = await getSupabase().from("stories").select(STORY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return (await withGlossary([data as unknown as StoryRow]))[0];
}

export const ARCHIVE_PAGE_SIZE = 40;

/** Past stories, newest first, optionally filtered by category / region / search text. */
export async function searchStories(opts: { category?: string; region?: string; q?: string; page: number }) {
  let query = getSupabase()
    .from("stories")
    .select(STORY_COLUMNS, { count: "exact" })
    .order("brief_id", { ascending: false }) // briefs are created one per day, so newest brief first
    .order("id"); // then each brief's stories in rank order
  if (opts.category) query = query.eq("category", opts.category);
  if (opts.region) query = query.eq("region", opts.region);
  if (opts.q) {
    // Keep only safe characters so the search text can't break the filter syntax.
    const q = opts.q.replace(/[^\p{L}\p{N} .&'$-]/gu, " ").trim();
    if (q) {
      const fields = ["headline", "what_happened", "why_it_matters", "concept_term"];
      query = query.or(fields.map((f) => `${f}.ilike."*${q}*"`).join(","));
    }
  }
  const from = opts.page * ARCHIVE_PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + ARCHIVE_PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { stories: await withGlossary(data as unknown as StoryRow[]), total: count ?? 0 };
}
