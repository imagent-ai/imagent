import { Activity, ArrowUpRight, Crown, GitMerge, ImageIcon, Medal, ShieldCheck, Timer, TrendingUp, WalletCards } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LandingBackgroundFx } from "@/app/components/EffectCard";
import { LeaderboardBoard } from "@/app/components/LeaderboardBoard";
import { ScrollReveal } from "@/app/components/ScrollReveal";
import { IMAGENT_GENERATION_MODEL_NAME } from "@/lib/models";
import { type LeaderboardEntry, listLeaderboardEntries } from "@/lib/reports";

export const metadata: Metadata = {
  title: "Leaderboard | Imagent",
  description: "Live Imagent benchmark leaderboard for Gittensor-powered image-agent PR rounds.",
  alternates: {
    canonical: "/leaderboard"
  },
  openGraph: {
    title: "Leaderboard | Imagent",
    description: "Live Imagent benchmark leaderboard for Gittensor-powered image-agent PR rounds.",
    url: "/leaderboard"
  }
};

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const entries = await listLeaderboardEntries();
  const topThree = entries.slice(0, 3);
  const merged = entries.filter((entry) => entry.pullRequest.state === "merged").length;
  const failed = entries.filter((entry) => entry.status === "fail").length;
  const averageScore = entries.length
    ? entries.reduce((total, entry) => total + entry.score, 0) / entries.length
    : 0;
  const topScore = entries[0]?.score ?? 0;
  const fastest = entries.length ? Math.min(...entries.map((entry) => entry.latencyP95Ms)) : 0;
  const totalCost = entries.reduce((total, entry) => total + entry.costUsd, 0);
  const leader = entries[0];
  const chronological = [...entries].sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt));
  const latestReport = chronological[chronological.length - 1] ?? null;
  const projectBaseline = leader?.improvement.baselineScore ?? null;
  const projectDelta = leader?.improvement.delta ?? null;
  const eligible = entries.filter((entry) => entry.improvement.mergeEligible).length;
  const bestImprovement = entries.reduce<LeaderboardEntry | null>((best, entry) => {
    if (entry.improvement.delta === null) {
      return best;
    }
    if (!best || best.improvement.delta === null || entry.improvement.delta > best.improvement.delta) {
      return entry;
    }
    return best;
  }, null);
  const latestFive = chronological.slice(-5).reverse();

  return (
    <div className="imagent-landing leaderboard-page">
      <LandingBackgroundFx />
      <ScrollReveal />
      <section className="leaderboard-hero" data-reveal="fade-up">
        <div className="leaderboard-hero-copy">
          <span className="page-kicker">
            <Activity size={13} />
            Gittensor · subnet 74 · official eval
          </span>
          <h1>
            Image miners compete on <span>live benchmark improvement.</span>
          </h1>
          <p>
            Every report is ranked by score, PR outcome, baseline delta, latency, cost, and judge dimensions.
            {" "}Generation is fixed to {IMAGENT_GENERATION_MODEL_NAME} through OpenRouter.
          </p>
          <div className="leaderboard-hero-signal" aria-label="Round signal">
            <span>
              <strong>{entries.length}</strong>
              <small>Reports scored</small>
            </span>
            <span>
              <strong>{eligible}</strong>
              <small>Merge eligible</small>
            </span>
            <span>
              <strong>{formatDelta(projectDelta)}</strong>
              <small>Project delta</small>
            </span>
          </div>
        </div>
        {leader ? <ChampionCard leader={leader} /> : null}
      </section>

      <section className="leaderboard-stats" data-reveal="fade-up" data-reveal-delay="1">
        <HeroStat icon={<Medal size={18} />} label="Top score" value={topScore.toFixed(2)} />
        <HeroStat icon={<TrendingUp size={18} />} label="Project delta" value={formatDelta(projectDelta)} />
        <HeroStat icon={<ShieldCheck size={18} />} label="Merge eligible" value={String(eligible)} />
        <HeroStat icon={<ImageIcon size={18} />} label="Avg score" value={averageScore.toFixed(1)} />
        <HeroStat icon={<Timer size={18} />} label="Fastest p95" value={`${fastest.toFixed(0)} ms`} />
        <HeroStat icon={<WalletCards size={18} />} label="Total cost" value={`$${totalCost.toFixed(4)}`} />
      </section>

      <section className="improvement-board" aria-label="Project improvement summary" data-reveal="fade-up">
        <div className="improvement-board-copy">
          <span className="live-chip"><Activity size={13} /> Live benchmark feed</span>
          <h2>{formatDelta(projectDelta)} project improvement</h2>
          <p>
            Compared against {projectBaseline === null ? "the recorded baseline once benchmark ranking metadata is available" : `baseline ${projectBaseline.toFixed(2)}`}.
            {" "}Latest report {latestReport ? `finished ${formatDate(latestReport.completedAt)}` : "has not been imported yet"}.
          </p>
        </div>
        <div className="improvement-metrics">
          <ProjectMetric
            label="Current frontier"
            value={leader ? leader.score.toFixed(2) : "0.00"}
            detail={leader ? `@${leader.contributor.login} · ${leader.improvement.label}` : "waiting for reports"}
          />
          <ProjectMetric
            label="Best PR uplift"
            value={bestImprovement ? formatDelta(bestImprovement.improvement.delta) : "N/A"}
            detail={bestImprovement ? `@${bestImprovement.contributor.login} · ${pullRequestLabel(bestImprovement)}` : "baseline unavailable"}
          />
          <ProjectMetric
            label="Merged proof"
            value={String(merged)}
            detail={`${failed} failed or closed`}
          />
          <ProjectMetric
            label="Latest score"
            value={latestReport ? latestReport.score.toFixed(2) : "0.00"}
            detail={latestReport ? latestReport.improvement.label : "no run yet"}
          />
        </div>
        {latestFive.length > 0 ? (
          <div className="improvement-timeline custom-scrollbar" aria-label="Latest benchmark reports">
            {latestFive.map((entry) => (
              <a href={`/reports/${entry.runId}`} key={entry.runId}>
                <span className={`timeline-dot ${deltaTone(entry.improvement.delta)}`} />
                <strong>{entry.score.toFixed(1)}</strong>
                <small>{formatDelta(entry.improvement.delta)}</small>
              </a>
            ))}
          </div>
        ) : null}
      </section>

      <section className="podium-grid" aria-label="Top ranked miners" data-reveal="fade-up">
        {topThree.map((entry, index) => (
          <a className={`podium-card rank-${index + 1}`} href={`/reports/${entry.runId}`} key={entry.runId}>
            <div className="podium-rank">{index === 0 ? <Crown size={20} /> : `#${index + 1}`}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={entry.contributor.avatar_url || ""} alt="" />
            <div>
              <h2>{entry.contributor.name || entry.contributor.login}</h2>
              <p>@{entry.contributor.login}</p>
            </div>
            <strong>{entry.score.toFixed(2)}</strong>
            <span>{entry.pullRequest.state} · {pullRequestLabel(entry)}</span>
            <small>{formatDelta(entry.improvement.delta)} · {entry.improvement.label}</small>
          </a>
        ))}
      </section>

      <LeaderboardBoard entries={entries} />
    </div>
  );
}

function HeroStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="hero-stat">
      {icon}
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function ChampionCard({ leader }: { leader: LeaderboardEntry }) {
  const topDimensions = [...leader.dimensions].sort((a, b) => b.score - a.score).slice(0, 3);

  return (
    <aside className="champion-card" aria-label="Current champion">
      <div className="champion-glow" aria-hidden="true" />
      <div className="champion-top">
        <span className="champion-crown"><Crown size={16} /> Reigning champion</span>
        <span className="champion-rank">#{leader.rank}</span>
      </div>
      <div className="champion-identity">
        <span className="champion-avatar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={leader.contributor.avatar_url || ""} alt="" />
        </span>
        <div>
          <strong>{leader.contributor.name || leader.contributor.login}</strong>
          <span>@{leader.contributor.login}</span>
        </div>
      </div>
      <div className="champion-score">
        <strong>{leader.score.toFixed(2)}</strong>
        <span className={`delta-badge ${deltaTone(leader.improvement.delta)}`}>
          <TrendingUp size={13} />
          {formatDelta(leader.improvement.delta)}
        </span>
      </div>
      {topDimensions.length > 0 ? (
        <div className="champion-dimensions">
          {topDimensions.map((dimension) => (
            <span key={dimension.name}>
              <small>{dimension.name.replace(/[_-]+/g, " ")}</small>
              <i><b style={{ width: `${Math.max(4, Math.min(100, dimension.score))}%` }} /></i>
              <em>{dimension.score.toFixed(0)}</em>
            </span>
          ))}
        </div>
      ) : null}
      <a className="champion-link" href={`/reports/${leader.runId}`}>
        <GitMerge size={14} />
        {leader.pullRequest.number === null ? "View winning report" : `PR #${leader.pullRequest.number} · view report`}
        <ArrowUpRight size={14} />
      </a>
    </aside>
  );
}

function ProjectMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="project-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function pullRequestLabel(entry: LeaderboardEntry) {
  return entry.pullRequest.number === null ? "report metadata" : `PR #${entry.pullRequest.number}`;
}

function formatDelta(value: number | null) {
  if (value === null) {
    return "N/A";
  }
  if (Math.abs(value) < 0.005) {
    return "+0.00";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }).format(date);
}

function deltaTone(value: number | null) {
  if (value === null || Math.abs(value) < 0.005) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}
