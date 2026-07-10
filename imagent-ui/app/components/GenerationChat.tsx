"use client";

import { FormEvent, MouseEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  MessageCirclePlus,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Send,
  Settings,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { EffectCard, LandingBackgroundFx } from "@/app/components/EffectCard";
import { ScrollReveal } from "@/app/components/ScrollReveal";
import { IMAGENT_GENERATION_MODEL_NAME } from "@/lib/models";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

type ModalState =
  | { type: "settings" }
  | { type: "edit"; sessionId: string }
  | { type: "delete"; sessionId: string }
  | null;

type ApiKeyVerificationStatus = "idle" | "verifying" | "valid" | "invalid";

type ApiKeyVerification = {
  status: ApiKeyVerificationStatus;
  message: string;
};

type VerifyResponse = {
  verified?: boolean;
  key?: {
    label?: string;
    limit_remaining?: number | null;
  } | null;
  warning?: string;
  error?: string;
};

const SESSIONS_KEY = "imagent.chatSessions";
const ACTIVE_SESSION_KEY = "imagent.activeSession";
const SETTINGS_KEY = "imagent.generationSettings";
const levelOptions = ["auto", "low", "medium", "high"];

const templatePrompts = [
  "Plan a cinematic product launch visual for an AI image agent.",
  "Create a benchmark report graphic with a strong winner signal.",
  "Draft a visual direction for a Gittensor miner dashboard.",
  "Design an image prompt for explaining automated PR evaluation."
];

const emptySession: ChatSession = {
  id: "new-session",
  title: "New Session",
  createdAt: "",
  updatedAt: "",
  messages: []
};

export function GenerationChat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [level, setLevel] = useState("auto");
  const [draftLevel, setDraftLevel] = useState("auto");
  const [apiKey, setApiKey] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [apiKeyVerification, setApiKeyVerification] = useState<ApiKeyVerification>({
    status: "idle",
    message: "Enter key"
  });
  const [modal, setModal] = useState<ModalState>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedSessions = sanitizeSessions(readJson<ChatSession[]>(SESSIONS_KEY, []));
    const savedSettings = readJson<{ level?: string }>(SETTINGS_KEY, {});
    const initialSessions = savedSessions.length ? savedSessions : [newSession()];
    const savedActive = localStorage.getItem(ACTIVE_SESSION_KEY);
    const activeId = savedActive && initialSessions.some((session) => session.id === savedActive)
      ? savedActive
      : initialSessions[0].id;
    const initialLevel = isLevelOption(savedSettings.level) ? savedSettings.level : "auto";

    setSessions(initialSessions);
    setActiveSessionId(activeId);
    setLevel(initialLevel);
    setDraftLevel(initialLevel);
  }, []);

  useEffect(() => {
    if (sessions.length) {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ level }));
  }, [level]);

  useEffect(() => {
    if (!modal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modal]);

  useEffect(() => {
    if (modal?.type !== "settings") {
      return;
    }

    const key = draftApiKey.trim();
    if (!key) {
      setApiKeyVerification({ status: "idle", message: "Enter key" });
      return;
    }

    const controller = new AbortController();
    setApiKeyVerification({ status: "verifying", message: "Checking" });

    const verifyTimer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/openrouter/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: key }),
          signal: controller.signal
        });
        const data = (await response.json()) as VerifyResponse;

        if (!response.ok || data.error || !data.verified) {
          throw new Error(data.error || `Verification failed with HTTP ${response.status}`);
        }

        setApiKeyVerification({
          status: "valid",
          message: data.warning || data.key?.label || "Verified"
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setApiKeyVerification({
          status: "invalid",
          message: error instanceof Error ? error.message : "Invalid key"
        });
      }
    }, 650);

    return () => {
      controller.abort();
      window.clearTimeout(verifyTimer);
    };
  }, [draftApiKey, modal]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0] || emptySession,
    [activeSessionId, sessions]
  );
  const visibleSessions = sessions.length ? sessions : [emptySession];
  const hasMessages = Boolean(activeSession?.messages.length);
  const canSend = prompt.trim().length > 0;
  const modalSession = modal && "sessionId" in modal
    ? sessions.find((session) => session.id === modal.sessionId)
    : null;

  function createSession() {
    const session = newSession();
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setPrompt("");
    setSidebarCollapsed(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendPrompt(prompt);
  }

  function selectTemplate(template: string) {
    sendPrompt(template);
  }

  function sendPrompt(value: string) {
    const content = value.trim();
    if (!content) {
      return;
    }

    const now = new Date().toISOString();
    const sessionId = sessions.length ? activeSession.id : crypto.randomUUID();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: now
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "Agenda received. I will keep this session focused around that direction.",
      createdAt: now
    };

    if (!sessions.length) {
      setSessions([
        {
          id: sessionId,
          title: titleFromPrompt(content),
          createdAt: now,
          updatedAt: now,
          messages: [userMessage, assistantMessage]
        }
      ]);
      setActiveSessionId(sessionId);
      setPrompt("");
      return;
    }

    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        return {
          ...session,
          title: session.title === "New Session" ? titleFromPrompt(content) : session.title,
          updatedAt: now,
          messages: [...session.messages, userMessage, assistantMessage]
        };
      })
    );
    setPrompt("");
  }

  function openSettings() {
    setDraftLevel(level);
    setDraftApiKey(apiKey);
    setModal({ type: "settings" });
  }

  function updateLevel(value: string) {
    if (!isLevelOption(value)) {
      return;
    }
    setLevel(value);
    setDraftLevel(value);
    setLevelMenuOpen(false);
  }

  function openEditSession(session: ChatSession, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setDraftTitle(session.title);
    setModal({ type: "edit", sessionId: session.id });
  }

  function openDeleteSession(session: ChatSession, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setModal({ type: "delete", sessionId: session.id });
  }

  function closeModal() {
    setModal(null);
    setDraftTitle("");
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLevel(draftLevel);
    setApiKey(draftApiKey.trim());
    closeModal();
  }

  function saveSessionTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || modal.type !== "edit") {
      return;
    }

    const nextTitle = draftTitle.replace(/\s+/g, " ").trim() || "New Session";
    setSessions((current) =>
      current.map((session) =>
        session.id === modal.sessionId
          ? { ...session, title: titleFromPrompt(nextTitle), updatedAt: new Date().toISOString() }
          : session
      )
    );
    closeModal();
  }

  function deleteSession() {
    if (!modal || modal.type !== "delete") {
      return;
    }

    const remainingSessions = sessions.filter((session) => session.id !== modal.sessionId);
    if (!remainingSessions.length) {
      const replacement = newSession();
      setSessions([replacement]);
      setActiveSessionId(replacement.id);
      closeModal();
      return;
    }

    setSessions(remainingSessions);
    if (!remainingSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(remainingSessions[0].id);
    }
    closeModal();
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  }

  return (
    <div className="imagent-landing generation-shell generation-redesign">
      <LandingBackgroundFx />
      <ScrollReveal />

      <main
        className={sidebarCollapsed ? "generation-chat-layout session-collapsed" : "generation-chat-layout"}
        aria-label="Generation session workspace"
      >
        <div className="generation-workspace-surface">
          <aside className={sidebarCollapsed ? "generation-session-panel collapsed" : "generation-session-panel"} aria-label="Session history">
            <div className="generation-session-header">
              <button
                className="generation-icon-button"
                type="button"
                aria-label={sidebarCollapsed ? "Expand sessions" : "Collapse sessions"}
                title={sidebarCollapsed ? "Expand sessions" : "Collapse sessions"}
                onClick={() => setSidebarCollapsed((current) => !current)}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
              </button>
              {sidebarCollapsed ? null : <span>Sessions</span>}
              <button
                className="generation-icon-button primary"
                type="button"
                aria-label="New session"
                title="New session"
                onClick={createSession}
              >
                <MessageCirclePlus size={21} />
              </button>
            </div>

            {sidebarCollapsed ? (
              <div className="generation-session-rail custom-scrollbar">
                {visibleSessions.map((session) => (
                  <button
                    className={session.id === activeSession?.id ? "generation-rail-session active" : "generation-rail-session"}
                    type="button"
                    key={session.id}
                    aria-label={session.title}
                    title={session.title}
                    onClick={() => {
                      if (sessions.length) {
                        setActiveSessionId(session.id);
                      }
                    }}
                  >
                    <MessageSquareText size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="generation-session-list custom-scrollbar">
                {visibleSessions.map((session) => {
                  const active = session.id === activeSession?.id;
                  return (
                    <div className={active ? "generation-session-item active" : "generation-session-item"} key={session.id}>
                      <button
                        className="generation-session-select"
                        type="button"
                        onClick={() => {
                          if (sessions.length) {
                            setActiveSessionId(session.id);
                          }
                        }}
                      >
                        <MessageSquareText size={16} />
                        <span>{session.title}</span>
                      </button>
                      {sessions.length ? (
                        <div className="generation-session-actions" aria-label={`${session.title} actions`}>
                          <button type="button" aria-label="Edit session title" title="Edit" onClick={(event) => openEditSession(session, event)}>
                            <Pencil size={14} />
                          </button>
                          <button type="button" aria-label="Delete session" title="Delete" onClick={(event) => openDeleteSession(session, event)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>

          <section className="generation-chat-panel" aria-label="Chat">
            <header className="generation-chat-head">
              <div className="generation-model-row">
                <span className="generation-model-pill">
                  <Sparkles size={15} />
                  <strong>{IMAGENT_GENERATION_MODEL_NAME}</strong>
                </span>
                <div
                  className={levelMenuOpen ? "generation-level-menu open" : "generation-level-menu"}
                  onBlur={(event) => {
                    const nextFocus = event.relatedTarget as Node | null;
                    if (!event.currentTarget.contains(nextFocus)) {
                      setLevelMenuOpen(false);
                    }
                  }}
                >
                  <button
                    className="generation-level-trigger"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={levelMenuOpen}
                    onClick={() => setLevelMenuOpen((current) => !current)}
                  >
                    <span>{level}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {levelMenuOpen ? (
                    <div className="generation-level-menu-list" role="listbox" aria-label="Generation level">
                      {levelOptions.map((option) => (
                        <button
                          className={level === option ? "active" : ""}
                          type="button"
                          role="option"
                          aria-selected={level === option}
                          key={option}
                          onClick={() => updateLevel(option)}
                        >
                          <span>{option}</span>
                          {level === option ? <Check size={13} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                className="generation-icon-button generation-settings-trigger"
                type="button"
                aria-label="Open generation settings"
                title="Settings"
                onClick={openSettings}
              >
                <Settings size={17} />
              </button>
            </header>

            <div className="generation-chat-history custom-scrollbar">
              {hasMessages ? (
                activeSession.messages.map((message) => (
                  <article className={`generation-message ${message.role}`} key={message.id}>
                    <span>{message.role === "user" ? "You" : "Imagent"}</span>
                    <p>{message.content}</p>
                  </article>
                ))
              ) : (
                <div className="generation-empty-state">
                  <h1>What&apos;s your agent today?</h1>
                  <div className="generation-template-grid">
                    {templatePrompts.map((template) => (
                      <button type="button" key={template} onClick={() => selectTemplate(template)}>
                        {template}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <form className="generation-chat-input" onSubmit={submit}>
              <div className="generation-input-control">
                <input
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Type your agenda..."
                  type="text"
                />
                <button type="submit" disabled={!canSend} aria-label="Send agenda">
                  <Send size={17} />
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>

      {mounted && modal
        ? createPortal(
            <div className="generation-modal-backdrop" role="presentation" onMouseDown={handleBackdropMouseDown}>
              <EffectCard animated className={`generation-dialog-card${modal.type === "settings" ? " generation-settings-card" : ""}`} glareOpacity={0.16} radius={24}>
                {modal.type === "settings" ? (
                  <form className="generation-dialog generation-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="generation-settings-title" onSubmit={saveSettings}>
                    <header>
                      <span className="generation-dialog-icon settings">
                        <Settings size={20} />
                      </span>
                      <h2 id="generation-settings-title">Settings</h2>
                      <button className="generation-dialog-close" type="button" aria-label="Close settings" onClick={closeModal}>
                        <X size={17} />
                      </button>
                    </header>
                    <div className="generation-dialog-body">
                      <label className="generation-setting-row generation-api-key-field">
                        <span>OpenRouter API key</span>
                        <div className={`generation-api-key-control ${apiKeyVerification.status}`}>
                          <input
                            autoComplete="off"
                            onChange={(event) => setDraftApiKey(event.target.value)}
                            placeholder="sk-or-v1-..."
                            spellCheck={false}
                            type="password"
                            value={draftApiKey}
                          />
                          <span className={`generation-api-key-status ${apiKeyVerification.status}`} aria-live="polite">
                            {apiKeyVerification.status === "verifying" ? <Loader2 className="spin" size={14} /> : null}
                            {apiKeyVerification.status === "valid" ? <Check size={14} /> : null}
                            {apiKeyVerification.status === "invalid" ? <AlertTriangle size={14} /> : null}
                            {apiKeyVerification.status === "idle" ? <KeyRound size={14} /> : null}
                            <span>{apiKeyVerification.message}</span>
                          </span>
                        </div>
                      </label>
                      <div className="generation-setting-row">
                        <span>Model</span>
                        <strong>{IMAGENT_GENERATION_MODEL_NAME}</strong>
                      </div>
                      <div className="generation-setting-row level">
                        <span>Level</span>
                        <div className="generation-level-grid" role="radiogroup" aria-label="Generation level">
                          {levelOptions.map((option) => (
                            <button
                              className={draftLevel === option ? "active" : ""}
                              type="button"
                              role="radio"
                              aria-checked={draftLevel === option}
                              key={option}
                              onClick={() => setDraftLevel(option)}
                            >
                              <span>{option}</span>
                              {draftLevel === option ? <Check size={14} /> : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <footer>
                      <button className="generation-secondary-action" type="button" onClick={closeModal}>
                        Cancel
                      </button>
                      <button className="generation-primary-action" type="submit">
                        Save
                      </button>
                    </footer>
                  </form>
                ) : null}

                {modal.type === "edit" ? (
                  <form className="generation-dialog" role="dialog" aria-modal="true" aria-labelledby="generation-edit-title" onSubmit={saveSessionTitle}>
                    <header>
                      <span className="generation-dialog-icon">
                        <Pencil size={18} />
                      </span>
                      <div>
                        <h2 id="generation-edit-title">Edit session</h2>
                        <p>Rename this session in your local history.</p>
                      </div>
                      <button className="generation-dialog-close" type="button" aria-label="Close edit dialog" onClick={closeModal}>
                        <X size={17} />
                      </button>
                    </header>
                    <div className="generation-dialog-body">
                      <label className="generation-title-field">
                        <span>Session title</span>
                        <input
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          placeholder={modalSession?.title || "New Session"}
                          autoFocus
                        />
                      </label>
                    </div>
                    <footer>
                      <button className="generation-secondary-action" type="button" onClick={closeModal}>
                        Cancel
                      </button>
                      <button className="generation-primary-action" type="submit">
                        Save
                      </button>
                    </footer>
                  </form>
                ) : null}

                {modal.type === "delete" ? (
                  <section className="generation-dialog danger" role="dialog" aria-modal="true" aria-labelledby="generation-delete-title">
                    <header>
                      <span className="generation-dialog-icon danger">
                        <AlertTriangle size={18} />
                      </span>
                      <div>
                        <h2 id="generation-delete-title">Delete session</h2>
                        <p>{modalSession ? `Delete "${modalSession.title}" from this browser?` : "Delete this session from this browser?"}</p>
                      </div>
                      <button className="generation-dialog-close" type="button" aria-label="Close delete dialog" onClick={closeModal}>
                        <X size={17} />
                      </button>
                    </header>
                    <footer>
                      <button className="generation-secondary-action" type="button" onClick={closeModal}>
                        Cancel
                      </button>
                      <button className="generation-danger-action" type="button" onClick={deleteSession}>
                        Delete
                      </button>
                    </footer>
                  </section>
                ) : null}
              </EffectCard>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function newSession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "New Session",
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function sanitizeSessions(value: ChatSession[]): ChatSession[] {
  return value
    .filter((session) => session && typeof session.id === "string")
    .map((session) => ({
      id: session.id,
      title: session.title || "New Session",
      createdAt: session.createdAt || new Date().toISOString(),
      updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
      messages: Array.isArray(session.messages)
        ? session.messages
            .filter((message) => message && typeof message.content === "string")
            .map((message) => {
              const role: ChatMessage["role"] = message.role === "user" ? "user" : "assistant";
              return {
                id: message.id || crypto.randomUUID(),
                role,
                content: message.content,
                createdAt: message.createdAt || session.updatedAt || new Date().toISOString()
              };
            })
        : []
    }));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function titleFromPrompt(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  return title.length > 44 ? `${title.slice(0, 41)}...` : title || "New Session";
}

function isLevelOption(value: unknown): value is string {
  return typeof value === "string" && levelOptions.includes(value);
}
