"use client";

import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Crown,
  Eye,
  GitMerge,
  GitPullRequest,
  GitPullRequestArrow,
  History,
  Hourglass,
  Loader2,
  List,
  Minus,
  MoreHorizontal,
  RefreshCw,
  Search,
  Timer,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
  XCircle
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LeaderboardEntry } from "@/lib/reports";

type CandidateStage = "submitted" | "queued" | "benchmarking" | "judging" | "policy";
type CandidateEntry = {
  id: string;
  contributor: LeaderboardEntry["contributor"];
  progress: number;
  pullRequest: LeaderboardEntry["pullRequest"];
  repository: string;
  stage: CandidateStage;
  submittedAt: string;
};
type MockCandidateSeed = {
  login: string;
  name: string;
  number: number;
  progress: number;
  stage: CandidateStage;
  submittedAgoMs: number;
  title: string;
};
type HistoryFilter = "all" | "merged" | "closed" | "requirements" | "violation";
type RefreshStatus = "live" | "updating" | "stale";

const POLL_INTERVAL_MS = 8000;
const HISTORY_PAGE_SIZES = [4, 8, 12] as const;

const historyFilters: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
  { id: "requirements", label: "Requirements met" },
  { id: "violation", label: "Rule violation" }
];

const pipelineStages: Array<{ id: CandidateStage; label: string }> = [
  { id: "submitted", label: "Submitted" },
  { id: "queued", label: "Queued" },
  { id: "benchmarking", label: "Benchmarking" },
  { id: "judging", label: "Judging" },
  { id: "policy", label: "Policy" }
];

// UI-only candidates keep the active evaluation states visible until the benchmark API exposes them.
const mockCandidateSeeds: MockCandidateSeed[] = [
  {
    login: "sindresorhus",
    name: "Sindre Sorhus",
    number: 71,
    progress: 68,
    stage: "benchmarking",
    submittedAgoMs: 8 * 60 * 1000,
    title: "feat: retain subject fidelity across image refinements"
  },
  {
    login: "antfu",
    name: "Anthony Fu",
    number: 72,
    progress: 24,
    stage: "queued",
    submittedAgoMs: 3 * 60 * 1000,
    title: "fix: stabilize composition feedback for dense prompts"
  },
  {
    login: "shadcn",
    name: "shadcn",
    number: 73,
    progress: 86,
    stage: "judging",
    submittedAgoMs: 14 * 60 * 1000,
    title: "feat: improve style consistency for editorial image prompts"
  },
  {
    login: "leerob",
    name: "Lee Robinson",
    number: 74,
    progress: 96,
    stage: "policy",
    submittedAgoMs: 17 * 60 * 1000,
    title: "fix: add safer typography handling for generated posters"
  },
  {
    login: "addyosmani",
    name: "Addy Osmani",
    number: 75,
    progress: 7,
    stage: "submitted",
    submittedAgoMs: 1 * 60 * 1000,
    title: "feat: preserve product proportions during visual revisions"
  },
  {
    login: "kentcdodds",
    name: "Kent C. Dodds",
    number: 76,
    progress: 54,
    stage: "benchmarking",
    submittedAgoMs: 22 * 60 * 1000,
    title: "feat: strengthen composition planning for campaign assets"
  },
  {
    login: "t3-oss",
    name: "Theo Browne",
    number: 77,
    progress: 31,
    stage: "queued",
    submittedAgoMs: 5 * 60 * 1000,
    title: "fix: normalize color intent in iterative generation flows"
  },
  {
    login: "vercel",
    name: "Vercel",
    number: 78,
    progress: 79,
    stage: "judging",
    submittedAgoMs: 26 * 60 * 1000,
    title: "feat: improve hero subject separation in benchmark scenes"
  },
  {
    login: "microsoft",
    name: "Microsoft",
    number: 79,
    progress: 12,
    stage: "submitted",
    submittedAgoMs: 2 * 60 * 1000,
    title: "feat: add structured feedback for image composition retries"
  },
  {
    login: "openai",
    name: "OpenAI",
    number: 80,
    progress: 92,
    stage: "policy",
    submittedAgoMs: 31 * 60 * 1000,
    title: "fix: tighten policy checks for product-label generation"
  },
  {
    login: "github",
    name: "GitHub",
    number: 81,
    progress: 61,
    stage: "benchmarking",
    submittedAgoMs: 35 * 60 * 1000,
    title: "feat: retain material details in close-up product imagery"
  },
  {
    login: "octocat",
    name: "The Octocat",
    number: 82,
    progress: 39,
    stage: "queued",
    submittedAgoMs: 10 * 60 * 1000,
    title: "fix: balance background density for branded visual prompts"
  }
];

function listMockCandidates(now = new Date()): CandidateEntry[] {
  return mockCandidateSeeds.map((candidate) => ({
    id: `ui-candidate-${candidate.number}`,
    contributor: {
      avatar_url: `https://github.com/${candidate.login}.png?size=96`,
      html_url: `https://github.com/${candidate.login}`,
      login: candidate.login,
      name: candidate.name,
      source: "derived"
    },
    progress: candidate.progress,
    pullRequest: {
      closed_at: null,
      html_url: null,
      merged_at: null,
      number: candidate.number,
      source: "derived",
      state: "open",
      title: candidate.title
    },
    repository: "gittensor-agent-forge/gt-imagent",
    stage: candidate.stage,
    submittedAt: new Date(now.getTime() - candidate.submittedAgoMs).toISOString()
  }));
}

export function LeaderboardBoard({ entries }: { entries: LeaderboardEntry[] }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState(() => listMockCandidates());
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState<number>(HISTORY_PAGE_SIZES[0]);
  const [query, setQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);
  const [mounted, setMounted] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>("live");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => new Date().toISOString());
  const [lastRefreshAt, setLastRefreshAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const refreshInFlightRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);

  const refreshLeaderboard = useCallback(() => {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    setRefreshStatus("updating");

    router.refresh();
    refreshTimerRef.current = window.setTimeout(() => {
      const refreshedAt = Date.now();
      setCandidates(listMockCandidates(new Date(refreshedAt)));
      setLastUpdatedAt(new Date(refreshedAt).toISOString());
      setLastRefreshAt(refreshedAt);
      setNow(refreshedAt);
      setRefreshStatus("live");
      refreshInFlightRef.current = false;
      refreshTimerRef.current = null;
    }, 220);
  }, [router]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        refreshLeaderboard();
      }
    }, POLL_INTERVAL_MS);

    function handleVisibilityChange() {
      if (!document.hidden) {
        refreshLeaderboard();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshLeaderboard]);

  useEffect(() => {
    if (refreshStatus === "updating") {
      return;
    }

    const stale = now - lastRefreshAt > POLL_INTERVAL_MS * 3;
    if (stale) {
      setRefreshStatus("stale");
    }
  }, [lastRefreshAt, now, refreshStatus]);

  const king = useMemo(() => getCurrentKing(entries), [entries]);
  const filteredHistoryEntries = useMemo(
    () => buildHistory(entries, historyFilter, query, king),
    [entries, historyFilter, query, king]
  );
  const historyPageCount = Math.max(1, Math.ceil(filteredHistoryEntries.length / historyPageSize));
  const activeHistoryPage = Math.min(historyPage, historyPageCount);
  const historyEntries = useMemo(() => {
    const start = (activeHistoryPage - 1) * historyPageSize;
    return filteredHistoryEntries.slice(start, start + historyPageSize);
  }, [activeHistoryPage, filteredHistoryEntries, historyPageSize]);
  const openEntryDetails = useCallback((entry: LeaderboardEntry, trigger: HTMLElement) => {
    modalTriggerRef.current = trigger;
    setSelectedEntry(entry);
  }, []);
  const closeEntryDetails = useCallback(() => {
    setSelectedEntry(null);
  }, []);

  return (
    <>
      <section className="leaderboard-live-shell leaderboard-state-shell" aria-label="Live PR benchmark">
        <h1 className="leaderboard-page-title">Live PR Benchmark</h1>

        <div className="leaderboard-state-priority">
          <CandidateQueue
            candidates={candidates}
            lastUpdatedAt={lastUpdatedAt}
            now={now}
            onRefresh={refreshLeaderboard}
            refreshStatus={refreshStatus}
          />
          <KingCard entry={king} onOpenDetails={openEntryDetails} />
        </div>

        <HistoryPanel
          entries={historyEntries}
          filter={historyFilter}
          king={king}
          now={now}
          onFilterChange={(nextFilter) => {
            setHistoryFilter(nextFilter);
            setHistoryPage(1);
          }}
          onOpenDetails={openEntryDetails}
          onPageChange={setHistoryPage}
          onPageSizeChange={(nextPageSize) => {
            setHistoryPageSize(nextPageSize);
            setHistoryPage(1);
          }}
          onQueryChange={(nextQuery) => {
            setQuery(nextQuery);
            setHistoryPage(1);
          }}
          page={activeHistoryPage}
          pageCount={historyPageCount}
          pageSize={historyPageSize}
          query={query}
          totalEntries={filteredHistoryEntries.length}
        />
      </section>
      {mounted && selectedEntry ? (
        <PrDetailModal
          entry={selectedEntry}
          king={king}
          now={now}
          onClose={closeEntryDetails}
          trigger={modalTriggerRef.current}
        />
      ) : null}
    </>
  );
}

function KingCard({
  entry,
  onOpenDetails
}: {
  entry: LeaderboardEntry | null;
  onOpenDetails: (entry: LeaderboardEntry, trigger: HTMLElement) => void;
}) {
  if (!entry) {
    return (
      <section className="leaderboard-king-panel leaderboard-king-panel-empty">
        <div className="leaderboard-king-empty">
          <span><Crown size={24} /></span>
          <div>
            <strong>No King Yet</strong>
            <p>The first completed benchmark will set the current king.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="leaderboard-king-panel" aria-label="Current benchmark king">
      <div className="leaderboard-king-head">
        <span className="leaderboard-king-title"><Crown size={15} />King</span>
        <div className="leaderboard-king-head-actions">
          <span className="leaderboard-king-state">
            <CheckCircle2 size={13} />
            {entry.pullRequest.state === "merged" ? "Merged" : entry.improvement.mergeEligible ? "Eligible" : "Evaluated"}
          </span>
          <button
            aria-label="View current king details"
            className="leaderboard-king-report-icon"
            onClick={(event) => onOpenDetails(entry, event.currentTarget)}
            title="View PR details"
            type="button"
          >
            <Eye size={15} />
          </button>
        </div>
      </div>

      <div className="leaderboard-king-main">
        <div className="leaderboard-king-identity">
          <Avatar contributor={entry.contributor} className="king" />
          <div className="leaderboard-king-copy">
            <h2>{pullRequestLabel(entry)}</h2>
            <p className="leaderboard-king-pr-title" title={entry.pullRequest.title}>{entry.pullRequest.title}</p>
            <div className="leaderboard-king-meta">
              <span>@{entry.contributor.login}</span>
            </div>
          </div>
        </div>

        <div className="leaderboard-king-score">
          <span>Benchmark Score</span>
          <strong>{entry.score.toFixed(2)}</strong>
          <em className={`leaderboard-delta ${deltaTone(entry.improvement.delta)}`}>
            {deltaIcon(entry.improvement.delta)}
            {formatDelta(entry.improvement.delta)}
          </em>
        </div>
      </div>

      <div className="leaderboard-king-detail-grid">
        <KingDetailMetric icon={<Timer size={14} />} label="P95 latency" value={`${entry.latencyP95Ms.toFixed(0)} ms`} />
        <KingDetailMetric icon={<WalletCards size={14} />} label="Run cost" value={`$${entry.costUsd.toFixed(5)}`} />
        <KingDetailMetric icon={<Activity size={14} />} label="Benchmark" value={formatBenchmarkVersion(entry.benchmarkVersion)} />
      </div>

      <div className="leaderboard-king-model-grid">
        <KingModelDetail label="Generation Model" model={entry.generationModel} />
        <KingModelDetail label="Evaluation Model" model={entry.judgeModel} />
      </div>

      <div className="leaderboard-king-detail-section leaderboard-king-dimensions">
        <span>Benchmark Profile</span>
        {entry.dimensions.length ? (
          <div className="leaderboard-king-dimension-list">
            {entry.dimensions.slice(0, 5).map((dimension) => (
              <div className="leaderboard-king-dimension" key={dimension.name}>
                <div>
                  <span>{formatDimension(dimension.name)}</span>
                  <strong>{dimension.score.toFixed(0)}</strong>
                </div>
                <i><b style={{ width: scoreWidth(dimension.score) }} /></i>
              </div>
            ))}
          </div>
        ) : (
          <small>Dimension scores are unavailable for this report.</small>
        )}
      </div>

    </section>
  );
}

function CandidateQueue({
  candidates,
  lastUpdatedAt,
  onRefresh,
  refreshStatus,
  now
}: {
  candidates: CandidateEntry[];
  lastUpdatedAt: string;
  onRefresh: () => void;
  refreshStatus: RefreshStatus;
  now: number;
}) {
  return (
    <section className="leaderboard-candidate-region" aria-label="Candidate PR queue">
      <section className="leaderboard-candidate-panel">
        <div className="leaderboard-candidate-head">
          <PanelHeader inlineValue icon={<GitPullRequestArrow size={15} />} title="Candidate Queue" value={String(candidates.length)} />
          <div className="leaderboard-candidate-actions">
            <span
              className={`leaderboard-candidate-live ${refreshStatus}`}
              title={`Last updated ${formatRelativeTime(lastUpdatedAt, now)}`}
            >
              {refreshStatus === "updating" ? <Loader2 className="spin" size={13} /> : <CircleDot size={13} />}
              {statusLabel(refreshStatus)}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshStatus === "updating"}
              aria-label="Refresh candidate queue"
              title="Refresh candidate queue"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        {candidates.length ? (
          <>
            <div className="leaderboard-candidate-columns" aria-hidden="true">
              <span>Candidate</span>
              <span>Stage</span>
              <span>Progress</span>
            </div>
            <div className="leaderboard-candidate-list custom-scrollbar" role="list">
              {candidates.map((candidate) => (
                <CandidateCard candidate={candidate} key={candidate.id} now={now} />
              ))}
            </div>
          </>
        ) : (
          <div className="leaderboard-candidate-empty">
            <div className="leaderboard-candidate-empty-copy">
              <span><Hourglass size={22} /></span>
              <div>
                <strong>Queue is clear</strong>
                <p>Listening for the next submitted pull request.</p>
              </div>
              <span className="leaderboard-candidate-listening"><CircleDot size={13} /> Live intake</span>
            </div>
            <ol className="leaderboard-pipeline-preview" aria-label="Candidate evaluation pipeline">
              {pipelineStages.map((stage, index) => (
                <li key={stage.id}>
                  <i>{index + 1}</i>
                  <span>{stage.label}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
    </section>
  );
}

function CandidateCard({
  candidate,
  now
}: {
  candidate: CandidateEntry;
  now: number;
}) {
  return (
    <article className="leaderboard-candidate-card" role="listitem">
      <div className="leaderboard-candidate-identity" aria-hidden="true">
        <Avatar contributor={candidate.contributor} className="candidate" />
        <span className="leaderboard-candidate-pr-mark"><GitPullRequest size={10} /></span>
      </div>
      <div className="leaderboard-candidate-main">
        <div className="leaderboard-candidate-title">
          <strong>{pullRequestText(candidate.pullRequest)}</strong>
        </div>
        <p title={candidate.pullRequest.title}>{candidate.pullRequest.title}</p>
        <small className="leaderboard-candidate-byline" title={`@${candidate.contributor.login} · submitted ${formatRelativeTime(candidate.submittedAt, now)}`}>
          <span>@{candidate.contributor.login}</span>
          <span>submitted {formatRelativeTime(candidate.submittedAt, now)}</span>
        </small>
      </div>
      <StageBadge stage={candidate.stage} />
      <div
        className="leaderboard-candidate-progress"
        role="progressbar"
        aria-label={`${candidate.progress}% complete`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(candidate.progress)}
      >
        <span><strong>{Math.round(candidate.progress)}%</strong></span>
        <i><b style={{ width: `${Math.max(2, Math.min(100, candidate.progress))}%` }} /></i>
      </div>
    </article>
  );
}

function HistoryPanel({
  entries,
  filter,
  king,
  now,
  onFilterChange,
  onOpenDetails,
  onPageChange,
  onPageSizeChange,
  onQueryChange,
  page,
  pageCount,
  pageSize,
  query,
  totalEntries
}: {
  entries: LeaderboardEntry[];
  filter: HistoryFilter;
  king: LeaderboardEntry | null;
  now: number;
  onFilterChange: (filter: HistoryFilter) => void;
  onOpenDetails: (entry: LeaderboardEntry, trigger: HTMLElement) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onQueryChange: (query: string) => void;
  page: number;
  pageCount: number;
  pageSize: number;
  query: string;
  totalEntries: number;
}) {
  return (
    <section className="leaderboard-history-panel" aria-label="Merged and closed PR history">
      <div className="leaderboard-history-head">
        <PanelHeader inlineValue icon={<History size={15} />} title="Resolved PR History" value={String(totalEntries)} />
        <label className="leaderboard-history-search">
          <Search size={15} />
          <input
            aria-label="Search evaluated PR history"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search PR, agent, contributor"
          />
        </label>
      </div>

      <div className="leaderboard-history-filters" aria-label="History filters">
        {historyFilters.map((item) => (
          <button
            className={filter === item.id ? "active" : ""}
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="leaderboard-history-list custom-scrollbar">
        {entries.length ? entries.map((entry) => (
          <HistoryItem
            entry={entry}
            key={entry.runId}
            king={king}
            now={now}
            onOpenDetails={onOpenDetails}
          />
        )) : (
          <div className="leaderboard-history-empty">
            <History size={20} />
            <strong>No Resolved PRs</strong>
            <p>No merged or closed pull requests match this view.</p>
          </div>
        )}
      </div>
      <HistoryPagination
        currentPage={page}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        pageCount={pageCount}
        pageSize={pageSize}
        totalEntries={totalEntries}
      />
    </section>
  );
}

function HistoryItem({
  entry,
  king,
  now,
  onOpenDetails
}: {
  entry: LeaderboardEntry;
  king: LeaderboardEntry | null;
  now: number;
  onOpenDetails: (entry: LeaderboardEntry, trigger: HTMLElement) => void;
}) {
  const result = historyResult(entry, king);
  const stateTone = result.label === "Merged" ? "merged" : "closed";

  return (
    <button
      aria-label={`View details for ${pullRequestText(entry.pullRequest)}`}
      className="leaderboard-history-item"
      onClick={(event) => onOpenDetails(entry, event.currentTarget)}
      type="button"
    >
      <div className="leaderboard-history-identity" aria-hidden="true">
        <Avatar contributor={entry.contributor} className="history" />
        <span className={`leaderboard-history-marker ${result.tone} state-${stateTone}`}>{result.icon}</span>
      </div>
      <div className="leaderboard-history-main">
        <div className="leaderboard-history-title">
          <strong>{pullRequestText(entry.pullRequest)}</strong>
          <span className={`leaderboard-history-result ${result.tone} state-${stateTone}`}>{result.label}</span>
        </div>
        <p title={entry.pullRequest.title}>{entry.pullRequest.title}</p>
        <div className="leaderboard-history-meta">
          <span className={`leaderboard-history-disposition ${result.tone}`}>{result.reason}</span>
          <span>@{entry.contributor.login}</span>
          <span>{formatRelativeTime(entry.completedAt, now)}</span>
          <span>{formatShortSha(entry.commitSha)}</span>
        </div>
      </div>
      <div className="leaderboard-history-score">
        <strong>{entry.score.toFixed(2)}</strong>
        <span className={`leaderboard-delta ${deltaTone(entry.improvement.delta)}`}>
          {deltaIcon(entry.improvement.delta)}
          {formatDelta(entry.improvement.delta)}
        </span>
      </div>
    </button>
  );
}

function PrDetailModal({
  entry,
  king,
  now,
  onClose,
  trigger
}: {
  entry: LeaderboardEntry;
  king: LeaderboardEntry | null;
  now: number;
  onClose: () => void;
  trigger: HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const result = historyResult(entry, king);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>("button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
      (firstFocusable || dialogRef.current)?.focus({ preventScroll: true });
    }, 0);

    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;
      const focusableElements = dialog ? getModalFocusableElements(dialog) : [];
      if (!focusableElements.length) {
        event.preventDefault();
        dialog?.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (!dialog?.contains(activeElement) || activeElement === firstElement)) {
        event.preventDefault();
        lastElement.focus({ preventScroll: true });
      } else if (!event.shiftKey && (!dialog?.contains(activeElement) || activeElement === lastElement)) {
        event.preventDefault();
        firstElement.focus({ preventScroll: true });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      trigger?.focus({ preventScroll: true });
    };
  }, [onClose, trigger]);

  return createPortal(
    <div
      className="leaderboard-pr-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby="leaderboard-pr-modal-title"
        aria-modal="true"
        className="leaderboard-pr-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
          <header>
            <div className="leaderboard-pr-modal-title-group">
              <span className={`leaderboard-pr-modal-icon ${result.tone}`}><GitPullRequest size={20} /></span>
              <div>
                <div className="leaderboard-pr-modal-kicker">
                  <span>{pullRequestText(entry.pullRequest)}</span>
                  <span className={result.tone}>{result.label}</span>
                </div>
                <h2 id="leaderboard-pr-modal-title">{entry.pullRequest.title}</h2>
              </div>
            </div>
            <button aria-label="Close PR details" className="leaderboard-pr-modal-close" onClick={onClose} type="button">
              <X size={17} />
            </button>
          </header>

          <div className="leaderboard-pr-modal-body custom-scrollbar">
            <section className="leaderboard-pr-modal-summary">
              <div className="leaderboard-pr-modal-contributor">
                <Avatar className="modal" contributor={entry.contributor} />
                <div>
                  <strong>@{entry.contributor.login}</strong>
                  <span>{result.reason} · {formatRelativeTime(entry.completedAt, now)}</span>
                </div>
              </div>
              <div className="leaderboard-pr-modal-score">
                <span>Benchmark Score</span>
                <strong>{entry.score.toFixed(2)}</strong>
                <em className={`leaderboard-delta ${deltaTone(entry.improvement.delta)}`}>
                  {deltaIcon(entry.improvement.delta)}
                  {formatDelta(entry.improvement.delta)}
                </em>
              </div>
            </section>

            <div className="leaderboard-pr-modal-metrics">
              <PrModalMetric icon={<Activity size={14} />} label="Benchmark" value={formatBenchmarkVersion(entry.benchmarkVersion)} />
              <PrModalMetric icon={<GitPullRequest size={14} />} label="Commit" value={formatShortSha(entry.commitSha)} />
              <PrModalMetric icon={<Timer size={14} />} label="P95 latency" value={`${entry.latencyP95Ms.toFixed(0)} ms`} />
              <PrModalMetric icon={<WalletCards size={14} />} label="Run cost" value={`$${entry.costUsd.toFixed(5)}`} />
              <PrModalMetric icon={<Activity size={14} />} label="Generation model" value={formatModelName(entry.generationModel)} />
              <PrModalMetric icon={<History size={14} />} label="Evaluation model" value={formatModelName(entry.judgeModel)} />
            </div>

            <section className="leaderboard-pr-modal-dimensions">
              <span>Dimension Scores</span>
              {entry.dimensions.length ? (
                <div>
                  {entry.dimensions.slice(0, 6).map((dimension) => (
                    <div className="leaderboard-pr-modal-dimension" key={dimension.name}>
                      <div>
                        <span>{formatDimension(dimension.name)}</span>
                        <strong>{dimension.score.toFixed(0)}</strong>
                      </div>
                      <i><b style={{ width: scoreWidth(dimension.score) }} /></i>
                    </div>
                  ))}
                </div>
              ) : <small>Dimension scores are unavailable for this benchmark.</small>}
            </section>
          </div>
      </section>
    </div>,
    document.body
  );
}

function PrModalMetric({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="leaderboard-pr-modal-metric">
      <span>{icon}{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function getModalFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )
  ).filter((element) => element.getClientRects().length > 0);
}

function HistoryPageSizeMenu({
  pageSize,
  onPageSizeChange
}: {
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const selectedIndex = Math.max(
    0,
    HISTORY_PAGE_SIZES.indexOf(pageSize as (typeof HISTORY_PAGE_SIZES)[number])
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const openFromTrigger = (direction: "first" | "last" | "selected") => {
    setIsOpen(true);

    window.requestAnimationFrame(() => {
      if (direction === "first") {
        focusOption(0);
        return;
      }

      if (direction === "last") {
        focusOption(HISTORY_PAGE_SIZES.length - 1);
        return;
      }

      focusOption(selectedIndex);
    });
  };

  const selectPageSize = (size: number) => {
    onPageSizeChange(size);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      className={`leaderboard-history-page-size${isOpen ? " is-open" : ""}`}
      onBlur={() => {
        window.setTimeout(() => {
          if (!menuRef.current?.contains(document.activeElement)) {
            setIsOpen(false);
          }
        }, 0);
      }}
      ref={menuRef}
    >
      <span className="leaderboard-history-page-size-label">
        <List aria-hidden="true" size={13} />
        Per page
      </span>
      <div className="leaderboard-history-page-size-control">
        <button
          aria-controls={menuId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={`Rows per history page: ${pageSize}`}
          className="leaderboard-history-page-size-trigger"
          onClick={() => setIsOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              openFromTrigger("first");
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              openFromTrigger("last");
            }
          }}
          ref={triggerRef}
          type="button"
        >
          <span>{pageSize} rows</span>
          <ChevronDown aria-hidden="true" size={13} />
        </button>
        {isOpen ? (
          <div className="leaderboard-history-page-size-menu" id={menuId} role="listbox" aria-label="Rows per history page">
            {HISTORY_PAGE_SIZES.map((size, index) => {
              const selected = size === pageSize;

              return (
                <button
                  aria-selected={selected}
                  className={selected ? "is-selected" : ""}
                  key={size}
                  onClick={() => selectPageSize(size)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusOption((index + 1) % HISTORY_PAGE_SIZES.length);
                    }

                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusOption((index - 1 + HISTORY_PAGE_SIZES.length) % HISTORY_PAGE_SIZES.length);
                    }

                    if (event.key === "Home") {
                      event.preventDefault();
                      focusOption(0);
                    }

                    if (event.key === "End") {
                      event.preventDefault();
                      focusOption(HISTORY_PAGE_SIZES.length - 1);
                    }
                  }}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                  type="button"
                >
                  <span>{size} rows</span>
                  {selected ? <Check aria-hidden="true" size={14} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HistoryPagination({
  currentPage,
  onPageChange,
  onPageSizeChange,
  pageCount,
  pageSize,
  totalEntries
}: {
  currentPage: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageCount: number;
  pageSize: number;
  totalEntries: number;
}) {
  if (!totalEntries) {
    return null;
  }

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalEntries, currentPage * pageSize);
  const pages = historyPageTokens(pageCount, currentPage);

  return (
    <footer className="leaderboard-history-pagination">
      <div className="leaderboard-history-pagination-summary">
        <p>
          Showing <strong>{start}-{end}</strong> of <strong>{totalEntries}</strong>
        </p>
        <HistoryPageSizeMenu pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
      </div>
      {pageCount > 1 ? (
        <nav aria-label="Resolved PR history pages">
          <button
            aria-label="Previous history page"
            disabled={currentPage === 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            title="Previous page"
            type="button"
          >
            <ChevronLeft size={15} />
          </button>
          {pages.map((token, index) => token === "ellipsis" ? (
            <span className="leaderboard-history-page-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">
              <MoreHorizontal size={15} />
            </span>
          ) : (
            <button
              aria-current={token === currentPage ? "page" : undefined}
              className={token === currentPage ? "active" : ""}
              key={token}
              onClick={() => onPageChange(token)}
              type="button"
            >
              {token}
            </button>
          ))}
          <button
            aria-label="Next history page"
            disabled={currentPage === pageCount}
            onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
            title="Next page"
            type="button"
          >
            <ChevronRight size={15} />
          </button>
        </nav>
      ) : null}
    </footer>
  );
}

function StageBadge({ stage }: { stage: CandidateStage }) {
  return (
    <span className={`leaderboard-stage-badge ${stage}`}>
      {stage === "benchmarking" || stage === "judging" ? <Loader2 className="spin" size={13} /> : <CircleDot size={13} />}
      {stageLabel(stage)}
    </span>
  );
}

function PanelHeader({
  icon,
  inlineValue = false,
  title,
  value
}: {
  icon: ReactNode;
  inlineValue?: boolean;
  title: string;
  value: string;
}) {
  return (
    <header className={`leaderboard-panel-head${inlineValue ? " leaderboard-panel-head--inline-value" : ""}`}>
      <span>{icon}{title}</span>
      <strong>{value}</strong>
    </header>
  );
}

function KingDetailMetric({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="leaderboard-king-detail-metric">
      <span>{icon}{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function KingModelDetail({
  label,
  model
}: {
  label: string;
  model: string | null;
}) {
  const displayName = formatModelName(model);
  const sourceName = model || "Model metadata unavailable";

  return (
    <div className="leaderboard-king-model-cell">
      <span>{label}</span>
      <strong title={sourceName}>{displayName}</strong>
    </div>
  );
}

function Avatar({
  className = "",
  contributor
}: {
  className?: string;
  contributor: LeaderboardEntry["contributor"];
}) {
  const label = contributor.login.slice(0, 2).toUpperCase();
  const source = contributor.avatar_url || githubAvatarUrl(contributor.login);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = failedSource !== source;

  return (
    <span className={`leaderboard-avatar ${className}`.trim()} title={`GitHub profile for @${contributor.login}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt="" onError={() => setFailedSource(source)} />
      ) : label}
    </span>
  );
}

function githubAvatarUrl(login: string) {
  return `https://github.com/${encodeURIComponent(login)}.png?size=96`;
}

function buildHistory(
  entries: LeaderboardEntry[],
  filter: HistoryFilter,
  query: string,
  king: LeaderboardEntry | null
) {
  const normalizedQuery = query.trim().toLowerCase();

  return [...entries]
    .filter((entry) => {
      const outcome = historyOutcome(entry, king);
      const matchesFilter =
        filter === "all" ||
        (filter === "merged" && outcome === "merged") ||
        (filter === "closed" && outcome !== "merged") ||
        (filter === "requirements" && outcome === "requirements") ||
        (filter === "violation" && outcome === "violation");

      if (!matchesFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        entry.agentName,
        entry.benchmarkVersion,
        entry.commitSha,
        entry.contributor.login,
        entry.contributor.name,
        entry.generationModel,
        entry.improvement.label,
        entry.judgeModel,
        entry.pullRequest.number === null ? "" : String(entry.pullRequest.number),
        entry.pullRequest.title,
        entry.repository,
        entry.runId
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
}

function getCurrentKing(entries: LeaderboardEntry[]) {
  return mostRecent(
    entries.filter((entry) => entry.status === "pass" && entry.improvement.mergeEligible && entry.pullRequest.state === "merged")
  ) ?? mostRecent(
    entries.filter((entry) => entry.status === "pass" && entry.improvement.mergeEligible)
  ) ?? mostRecent(entries.filter((entry) => entry.status === "pass")) ?? mostRecent(entries);
}

function mostRecent(entries: LeaderboardEntry[]) {
  return [...entries].sort((left, right) => {
    const leftTimestamp = parseTimestamp(left.pullRequest.merged_at || left.completedAt) ?? 0;
    const rightTimestamp = parseTimestamp(right.pullRequest.merged_at || right.completedAt) ?? 0;
    return rightTimestamp - leftTimestamp;
  })[0] ?? null;
}

function isEligible(entry: LeaderboardEntry) {
  return entry.status === "pass" && entry.improvement.mergeEligible;
}

function historyOutcome(
  entry: LeaderboardEntry,
  king: LeaderboardEntry | null
): "merged" | "requirements" | "violation" | "closed" {
  if (entry.runId === king?.runId) {
    return "merged";
  }
  if (entry.status === "fail") {
    return "violation";
  }
  if (isEligible(entry)) {
    return "requirements";
  }
  return "closed";
}

function historyResult(entry: LeaderboardEntry, king: LeaderboardEntry | null): {
  icon: ReactNode;
  label: string;
  reason: string;
  tone: "merged" | "requirements" | "violation" | "closed";
} {
  const outcome = historyOutcome(entry, king);

  if (outcome === "merged") {
    return { icon: <GitMerge size={14} />, label: "Merged", reason: "Selected benchmark baseline", tone: "merged" };
  }
  if (outcome === "violation") {
    return { icon: <XCircle size={14} />, label: "Closed", reason: "Rule violation", tone: "violation" };
  }
  if (outcome === "requirements") {
    return { icon: <CheckCircle2 size={14} />, label: "Closed", reason: "Requirements met", tone: "requirements" };
  }
  return { icon: <Minus size={14} />, label: "Closed", reason: "Requirements not met", tone: "closed" };
}

function historyPageTokens(pageCount: number, currentPage: number): Array<number | "ellipsis"> {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const selectedPages = new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
  const pages = Array.from(selectedPages)
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
  const tokens: Array<number | "ellipsis"> = [];

  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous && page - previous > 1) {
      tokens.push("ellipsis");
    }
    tokens.push(page);
  });

  return tokens;
}

function statusLabel(status: RefreshStatus) {
  if (status === "updating") {
    return "Updating";
  }
  if (status === "stale") {
    return "Stale";
  }
  return "Live";
}

function stageLabel(stage: CandidateStage) {
  if (stage === "benchmarking") {
    return "Benchmarking";
  }
  if (stage === "judging") {
    return "Judging";
  }
  if (stage === "policy") {
    return "Policy Check";
  }
  if (stage === "queued") {
    return "Queued";
  }
  return "Submitted";
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

function deltaTone(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || Math.abs(value) < 0.005) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function deltaIcon(value: number | null) {
  const tone = deltaTone(value);
  if (tone === "positive") {
    return <TrendingUp size={13} />;
  }
  if (tone === "negative") {
    return <TrendingDown size={13} />;
  }
  return <Minus size={13} />;
}

function pullRequestLabel(entry: LeaderboardEntry) {
  return entry.pullRequest.number === null ? "No PR" : `#${entry.pullRequest.number}`;
}

function pullRequestText(pullRequest: LeaderboardEntry["pullRequest"]) {
  return pullRequest.number === null ? "No PR" : `#${pullRequest.number}`;
}

function formatShortSha(value: string) {
  return value.length > 7 ? value.slice(0, 7) : value;
}

function formatBenchmarkVersion(value: string) {
  return value
    .replace(/^openrouter-vision-judge-/, "")
    .replace(/^imagent-/, "")
    .replace(/-/g, " ");
}

function formatDimension(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatModelName(value: string | null) {
  if (!value) {
    return "Unknown";
  }
  if (value === "google/gemini-3.1-flash-image") {
    return "Gemini 3.1 Flash Image";
  }
  return value.split("/").pop()?.replace(/[-_]+/g, " ") || value;
}

function scoreWidth(value: number) {
  return `${Math.max(2, Math.min(100, value))}%`;
}

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatRelativeTime(value: string, referenceTime: number) {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return "pending";
  }

  const seconds = Math.max(0, Math.round((referenceTime - timestamp) / 1000));
  if (seconds < 10) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
