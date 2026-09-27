import Link from "next/link";
import type { Story } from "@/lib/data";
import { CATEGORIES, IMPACT, REGIONS } from "@/lib/labels";

type TagProps = { href: string; className: string; linked: boolean; children: React.ReactNode };

function Tag({ href, className, linked, children }: TagProps) {
  return linked ? (
    <Link className={className} href={href}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** Category + region tags. `linked` = tags link to the filtered archive (off when inside another link). */
export function Tags({ story, linked = true }: { story: Story; linked?: boolean }) {
  return (
    <div className="tags">
      <Tag className="tag" linked={linked} href={`/archive?category=${story.category}`}>
        {CATEGORIES[story.category] ?? story.category}
      </Tag>
      <Tag className="tag region" linked={linked} href={`/archive?region=${story.region}`}>
        {REGIONS[story.region] ?? story.region}
      </Tag>
      <span className="importance" aria-label={`Importance ${story.importance} out of 5`}>
        {"●".repeat(story.importance)}
        {"○".repeat(5 - story.importance)}
      </span>
    </div>
  );
}

/** One story with everything the brief asks for. `asPage` = the full story page (headline not a link). */
export default function StoryCard({ story, asPage = false }: { story: Story; asPage?: boolean }) {
  const Heading = asPage ? "h1" : "h3";
  return (
    <article className="card">
      <Tags story={story} />
      <Heading>{asPage ? story.headline : <Link href={`/story/${story.id}`}>{story.headline}</Link>}</Heading>

      <div className="label">What happened</div>
      <p>{story.what_happened}</p>

      <div className="label">Why it matters</div>
      <p>{story.why_it_matters}</p>

      {story.entities.length > 0 && (
        <>
          <div className="label">Who is affected</div>
          <ul className="entities">
            {story.entities.map((e, i) => (
              <li key={i}>
                <span className="entity-head">
                  {e.entity}
                  {/* Colour AND text label, so impact is clear without relying on colour alone. */}
                  <span className={`impact ${e.impact}`}>
                    {IMPACT[e.impact]?.icon} {IMPACT[e.impact]?.label ?? e.impact}
                  </span>
                </span>
                {e.reason && <span className="entity-reason">{e.reason}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {story.concept_term && (
        <div className="box concept">
          <div className="label">Concept</div>
          <p>
            <span className="concept-term">{story.concept_term}</span>
            {story.concept_explanation && <>: {story.concept_explanation}</>}
          </p>
        </div>
      )}

      {story.interview_question && (
        <div className="box question">
          <div className="label">Interview question</div>
          <p>{story.interview_question}</p>
        </div>
      )}

      {story.sources.length > 0 && (
        <>
          <div className="label">Sources</div>
          <ul className="sources">
            {story.sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>{" "}
                <span className="outlet">· {s.source}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
