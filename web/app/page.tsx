import StoryCard from "@/components/StoryCard";
import { getLatestBrief } from "@/lib/data";
import { REGIONS, formatDate } from "@/lib/labels";

// Rebuild this page at most every 10 minutes, so the 07:00 brief appears without redeploying.
export const revalidate = 600;

export default async function TodayPage() {
  const brief = await getLatestBrief();
  if (!brief) {
    return (
      <main>
        <h1>No brief yet</h1>
        <p className="subtitle">The first brief appears after the pipeline&apos;s next run (07:00 Dubai time).</p>
      </main>
    );
  }

  const top = brief.stories.filter((s) => s.is_top_story);
  // Stories already in Top Stories aren't repeated in the regional sections.
  const sections = Object.entries(REGIONS).map(([region, label]) => ({
    region,
    label,
    stories: brief.stories.filter((s) => !s.is_top_story && s.region === region),
  }));

  return (
    <main>
      <h1>{formatDate(brief.date)}</h1>
      <p className="subtitle">
        {brief.stories.length} stories · Top Stories, then by region
      </p>

      <nav className="section-nav" aria-label="Jump to section">
        <a href="#top">Top Stories</a>
        {sections.map((s) => (
          <a key={s.region} href={`#${s.region}`}>
            {s.label}
          </a>
        ))}
      </nav>

      <section className="section" id="top">
        <h2>
          Top Stories <span className="count">{top.length}</span>
        </h2>
        {top.length === 0 && <p className="quiet">No top stories today.</p>}
        {top.map((s) => (
          <StoryCard key={s.id} story={s} />
        ))}
      </section>

      {sections.map((section) => (
        <section className="section" id={section.region} key={section.region}>
          <h2>
            {section.label} <span className="count">{section.stories.length}</span>
          </h2>
          {section.stories.length === 0 && (
            <p className="quiet">Quiet day: no other major {section.label} stories.</p>
          )}
          {section.stories.map((s) => (
            <StoryCard key={s.id} story={s} />
          ))}
        </section>
      ))}
    </main>
  );
}
