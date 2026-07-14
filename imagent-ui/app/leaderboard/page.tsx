import type { Metadata } from "next";
import { LeaderboardBoard } from "@/app/components/LeaderboardBoard";
import { LandingBackgroundFx } from "@/app/components/LandingBackgroundFx";
import { listLeaderboardEntries } from "@/lib/reports";

export const metadata: Metadata = {
  title: "Leaderboard | Imagent",
  description: "Live Imagent PR benchmark state with the current king, active candidates, and evaluated PR history.",
  alternates: {
    canonical: "/leaderboard"
  },
  openGraph: {
    title: "Leaderboard | Imagent",
    description: "Live Imagent PR benchmark state with the current king, active candidates, and evaluated PR history.",
    url: "/leaderboard"
  }
};

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const entries = await listLeaderboardEntries();

  return (
    <div className="imagent-landing leaderboard-live-page">
      <LandingBackgroundFx />
      <LeaderboardBoard entries={entries} />
    </div>
  );
}
