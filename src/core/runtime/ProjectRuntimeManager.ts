/**
 * Project Runtime Manager
 *
 * Phase 2: Disposable ProjectSession architecture.
 *
 * Centralized orchestration point for project-scoped runtime lifecycle.
 * Now delegates to ProjectSession for explicit ownership boundaries.
 *
 * Architecture principle:
 * - Project owns session
 * - Session owns all runtime subsystems
 * - Session dies atomically when project closes
 *
 * This prevents state leakage across project switches by enforcing
 * deterministic teardown order and explicit ownership boundaries.
 *
 * Migration from Phase 1:
 * - Phase 1: Manual reset functions (resetPlaybackClock, resetTimelineStore, etc.)
 * - Phase 2: Disposable ProjectSession container (session.dispose())
 */

import { createProjectSession, disposeActiveSession, getActiveSession, getActiveSessionOrNull } from "./ProjectSession";

/**
 * Initialize project runtime.
 * Creates and activates new ProjectSession for the project.
 *
 * Phase 2: Delegates to ProjectSession.
 */
export async function initializeProjectRuntime(projectId: string): Promise<void> {
  console.log(`[ProjectRuntimeManager] Initializing runtime for project: ${projectId}`);
  await createProjectSession(projectId);
}

/**
 * Dispose project runtime.
 * Disposes active ProjectSession and all owned subsystems.
 *
 * Phase 2: Delegates to ProjectSession.
 * Session handles deterministic teardown order internally.
 */
export async function disposeProjectRuntime(): Promise<void> {
  const session = getActiveSessionOrNull();
  if (session) {
    console.log(`[ProjectRuntimeManager] Disposing runtime for project: ${session.projectId}`);
    await disposeActiveSession();
  } else {
    console.log(`[ProjectRuntimeManager] No active session to dispose`);
  }
}

/**
 * Switch project runtime.
 * Disposes current session and creates new one.
 *
 * Phase 2: Atomic session switch.
 */
export async function switchProjectRuntime(newProjectId: string): Promise<void> {
  console.log(`[ProjectRuntimeManager] Switching to project: ${newProjectId}`);
  await disposeProjectRuntime();
  await initializeProjectRuntime(newProjectId);
}

/**
 * Get active project session.
 * Throws if no session is active.
 */
export function getProjectSession() {
  return getActiveSession();
}

/**
 * Get runtime health status (for debugging).
 * Reports on session state, leaked resources, and subsystem health.
 */
export function getRuntimeHealthStatus() {
  const session = getActiveSessionOrNull();
  if (!session) {
    return {
      hasActiveSession: false,
      sessionId: null,
      projectId: null,
      state: null,
      playbackState: null,
      pendingJobs: 0,
      videoElements: 0,
      asyncTasks: 0,
      rafLoops: 0,
    };
  }

  const health = session.getHealthStatus();
  return {
    hasActiveSession: true,
    ...health,
  };
}
