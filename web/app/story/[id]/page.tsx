import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import StoryCard from "@/components/StoryCard";
import { getStory } from "@/lib/data";
import { formatDate } from "@/lib/labels";

// A story never changes after it's published, but it can be removed if a brief is re-run.
export const revalidate = 600;

// No pages are built in advance; each story page is built on its first visit, then cached for 10 minutes.
export async function generateStaticParams() {
  return [];
}

async function load(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const story = await getStory(id);
  if (!story) notFound();
  return story;
}

export async function generateMetadata({ params }: PageProps<"/story/[id]">): Promise<Metadata> {
  const story = await load(params);
  return { title: story.headline, description: story.what_happened };
}

export default async function StoryPage({ params }: PageProps<"/story/[id]">) {
  const story = await load(params);
  return (
    <main className="story-page">
      <Link className="back" href="/">
        ← Today
      </Link>
      <p className="subtitle">
        From the brief of {formatDate(story.brief_date)}
        {story.is_top_story && " · Top Story"}
      </p>
      <StoryCard story={story} asPage />
    </main>
  );
}
