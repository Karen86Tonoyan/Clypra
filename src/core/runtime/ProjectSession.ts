/**
 * Project Session - Disposable Runtime Container
 *
 * OWNERSHIP: Ephemeral runtime resources (playback, scheduling, GPU, decoders)
 * PERSISTENCE: Non-persistent (all resources disposed on close)
 * MUTABILITY: Manages resource lifecycle, consumes domain state as immutable input
 *
 * Phase 2 Architecture: Explicit ownership boundaries.
 *
 * Key principles:
 * - Session references global singletons (clock, scheduler) for single-instance consistency
 * - Session CONSUMES timeline state, never mutates it
 * - Session resets ephemeral UI state (selections) on init/dispose
 * - Disposal is atomic and deterministic (stops playback, cancels jobs, releases refs)
 * - Actual singleton destruction handled by destroyRuntime()
 *
 * Responsibilities:
 * - Own playback clock (transport state)
 * - Own frame scheduler (render job queue)
 * - Track video elements, audio nodes, RAF loops for cleanup
 * - Reset ephemeral UI state (selections, preview mode)
 *
 * Does NOT:
 * - Own timeline data (timelineStore is source of truth)
 * - Mutate clips/tracks (only reads for playback/render)
 * - Persist anything (all resources are session-scoped)
 * - Reset timeline store (projectStore handles load/save)
 *
 * Architecture principle:
 * Runtime resources consume timeline state as immutable input.
 * Timeline state outlives runtime sessions and is managed by projectStore.
 * This separation enables:
 * - Deterministic undo/redo (timeline mutations are journaled)
 * - Collaborative editing (timeline is CRDT-compatible)
 * - Background rendering (snapshot timeline, render in worker)
 * - Crash recovery (timeline persists, runtime restarts)
 * - AI orchestration (timeline is deterministic operation target)
 *
 * This prevents:
 * - State leakage across projects
 * - Forgotten cleanup
 * - Async tasks surviving project switch
 * - Hidden global state
 * - Resource leaks
 * - Ghost state bugs (runtime silently mutating domain state)
 */

import { getPlaybackClock, PlaybackClock } from "../playback/PlaybackClock";
import { getFrameScheduler, FrameScheduler } from "../scheduler/FrameScheduler";

/**
 * Project Session State
 */
export type SessionState = "initializing" | "active" | "disposing" | "disposed";

/**
 * Session lifecycle events
 */
export type SessionEventType = "initialized" | "disposed" | "error";
export type SessionEventListener = (event: { type: SessionEventType; session: ProjectSession; error?: Error }) => void;

/**
 * Project Session - Disposable runtime container.
 *
 * Owns all project-scoped runtime state:
 * - Playback clock
 * - Frame scheduler
 * - Render caches
 * - Evaluation state
 * - Media resources
 * - UI selections
 *
 * Lifecycle:
 * 1. Create: new ProjectSession(projectId)
 * 2. Initialize: await session.initialize()
 * 3. Use: session.playback, session.scheduler, etc.
 * 4. Dispose: await session.dispose()
 */
export class ProjectSession {
  // Session identity
  public readonly projectId: string;
  public readonly sessionId: string;
  private _state: SessionState = "initializing";

  // Owned subsystems (created on initialize, destroyed on dispose)
  private _playback: PlaybackClock | null = null;
  private _scheduler: FrameScheduler | null = null;

  // Lifecycle tracking
  private _initializePromise: Promise<void> | null = null;
  private _disposePromise: Promise<void> | null = null;
  private _listeners = new Set<SessionEventListener>();

  // Resource tracking (for leak detection)
  private _videoElements = new Map<string, HTMLVideoElement>();
  private _asyncTasks = new Set<AbortController>();
  private _rafIds = new Set<number>();

  constructor(projectId: string) {
    this.projectId = projectId;
    this.sessionId = `session-${projectId}-${Date.now()}`;
  }

  // ─── Getters ────────────────────────────────────────────────────────────

  get state(): SessionState {
    return this._state;
  }

  get playback(): PlaybackClock {
    if (!this._playback) {
      throw new Error(`[ProjectSession] Playback not initialized. Call initialize() first.`);
    }
    return this._playback;
  }

  get scheduler(): FrameScheduler {
    if (!this._scheduler) {
      throw new Error(`[ProjectSession] Scheduler not initialized. Call initialize() first.`);
    }
    return this._scheduler;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize session and all owned subsystems.
   * Must be called before using session.
   */
  async initialize(): Promise<void> {
    if (this._initializePromise) {
      return this._initializePromise;
    }

    this._initializePromise = this._doInitialize();
    return this._initializePromise;
  }

  private async _doInitialize(): Promise<void> {
    if (this._state !== "initializing") {
      throw new Error(`[ProjectSession] Cannot initialize from state: ${this._state}`);
    }

    try {
      // Use global singletons (single clock/scheduler ensures no divergence)
      this._playback = getPlaybackClock();
      this._scheduler = getFrameScheduler();

      // Initialize stores (timeline, UI)
      await this._initializeStores();

      this._state = "active";
      this._notifyListeners({ type: "initialized", session: this });
    } catch (error) {
      this._state = "disposed";
      this._notifyListeners({ type: "error", session: this, error: error as Error });
      throw error;
    }
  }

  /**
   * Dispose session and all owned subsystems.
   * Idempotent - safe to call multiple times.
   */
  async dispose(): Promise<void> {
    if (this._disposePromise) {
      return this._disposePromise;
    }

    this._disposePromise = this._doDispose();
    return this._disposePromise;
  }

  private async _doDispose(): Promise<void> {
    if (this._state === "disposed" || this._state === "disposing") {
      return;
    }

    this._state = "disposing";

    try {
      // Deterministic teardown order (critical for avoiding race conditions)

      // 1. Cancel all async tasks (prevent new work)
      await this._cancelAsyncTasks();

      // 2. Stop playback (prevent time updates)
      if (this._playback) {
        this._playback.stop();
      }

      // 3. Cancel all pending render jobs
      if (this._scheduler) {
        this._scheduler.cancelAll();
      }

      // 4. Release media resources (video elements, audio nodes)
      await this._releaseMediaResources();

      // 5. Cancel all RAF loops
      this._cancelRAFLoops();

      // 6. Release references to global singletons (actual disposal handled by destroyRuntime)
      this._playback = null;
      this._scheduler = null;

      // 7. Reset stores
      await this._resetStores();

      this._state = "disposed";
      this._notifyListeners({ type: "disposed", session: this });
    } catch (error) {
      console.error(`[ProjectSession] Disposal error:`, error);
      this._state = "disposed"; // Mark as disposed even on error
      this._notifyListeners({ type: "error", session: this, error: error as Error });
    }
  }

  // ─── Resource Management ────────────────────────────────────────────────

  /**
   * Register video element for lifecycle management.
   */
  registerVideoElement(id: string, video: HTMLVideoElement): void {
    this._videoElements.set(id, video);
  }

  /**
   * Unregister video element.
   */
  unregisterVideoElement(id: string): void {
    this._videoElements.delete(id);
  }

  /**
   * Register async task for cancellation on dispose.
   */
  registerAsyncTask(controller: AbortController): void {
    this._asyncTasks.add(controller);
  }

  /**
   * Unregister async task (when completed normally).
   */
  unregisterAsyncTask(controller: AbortController): void {
    this._asyncTasks.delete(controller);
  }

  /**
   * Register RAF loop for cancellation on dispose.
   */
  registerRAF(rafId: number): void {
    this._rafIds.add(rafId);
  }

  /**
   * Unregister RAF loop (when cancelled normally).
   */
  unregisterRAF(rafId: number): void {
    this._rafIds.delete(rafId);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private async _initializeStores(): Promise<void> {
    const { useUIStore } = await import("../../store/uiStore");

    // Reset UI store (selection state, preview mode)
    // Timeline store is managed by projectStore - don't touch it here
    useUIStore.setState({
      selectedClipIds: [],
      selectedTrackId: null,
      previewMode: "program",
    });
  }

  private async _resetStores(): Promise<void> {
    // Same as initialize - reset to clean state
    await this._initializeStores();
  }

  private async _cancelAsyncTasks(): Promise<void> {
    // Cancel all registered async tasks
    for (const controller of this._asyncTasks) {
      controller.abort();
    }
    this._asyncTasks.clear();
  }

  private async _releaseMediaResources(): Promise<void> {
    // Pause and release all video elements
    for (const [id, video] of this._videoElements) {
      try {
        video.pause();
        video.src = "";
        video.load(); // Release decoder resources
      } catch (error) {
        console.warn(`[ProjectSession] Failed to release video ${id}:`, error);
      }
    }
    this._videoElements.clear();
  }

  private _cancelRAFLoops(): void {
    // Cancel all registered RAF loops
    for (const rafId of this._rafIds) {
      cancelAnimationFrame(rafId);
    }
    this._rafIds.clear();
  }

  // ─── Event System ───────────────────────────────────────────────────────

  /**
   * Subscribe to session lifecycle events.
   */
  subscribe(listener: SessionEventListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners(event: { type: SessionEventType; session: ProjectSession; error?: Error }): void {
    this._listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(`[ProjectSession] Listener error:`, error);
      }
    });
  }

  // ─── Debug ──────────────────────────────────────────────────────────────

  /**
   * Get session health status (for debugging).
   */
  getHealthStatus(): {
    sessionId: string;
    projectId: string;
    state: SessionState;
    playbackState: string | null;
    pendingJobs: number;
    videoElements: number;
    asyncTasks: number;
    rafLoops: number;
  } {
    return {
      sessionId: this.sessionId,
      projectId: this.projectId,
      state: this._state,
      playbackState: this._playback?.state ?? null,
      pendingJobs: this._scheduler?.getStats().active ?? 0,
      videoElements: this._videoElements.size,
      asyncTasks: this._asyncTasks.size,
      rafLoops: this._rafIds.size,
    };
  }
}

/**
 * Global session registry (single source of truth).
 * Tracks active session to prevent multiple sessions for same project.
 */
class SessionRegistry {
  private _activeSession: ProjectSession | null = null;

  /**
   * Get active session (if any).
   */
  getActiveSession(): ProjectSession | null {
    return this._activeSession;
  }

  /**
   * Set active session.
   * Automatically disposes previous session if exists.
   */
  async setActiveSession(session: ProjectSession | null): Promise<void> {
    if (this._activeSession && this._activeSession !== session) {
      await this._activeSession.dispose();
    }
    this._activeSession = session;
  }

  /**
   * Clear active session (dispose and remove).
   */
  async clearActiveSession(): Promise<void> {
    await this.setActiveSession(null);
  }
}

// Global registry instance
const sessionRegistry = new SessionRegistry();

/**
 * Get active project session.
 * Throws if no session is active.
 */
export function getActiveSession(): ProjectSession {
  const session = sessionRegistry.getActiveSession();
  if (!session) {
    throw new Error(`[ProjectSession] No active session. Create and initialize a session first.`);
  }
  return session;
}

/**
 * Get active project session (nullable).
 * Returns null if no session is active.
 */
export function getActiveSessionOrNull(): ProjectSession | null {
  return sessionRegistry.getActiveSession();
}

/**
 * Create and activate new project session.
 * Automatically disposes previous session if exists.
 */
export async function createProjectSession(projectId: string): Promise<ProjectSession> {
  const session = new ProjectSession(projectId);
  await session.initialize();
  await sessionRegistry.setActiveSession(session);
  return session;
}

/**
 * Dispose active project session.
 */
export async function disposeActiveSession(): Promise<void> {
  await sessionRegistry.clearActiveSession();
}
