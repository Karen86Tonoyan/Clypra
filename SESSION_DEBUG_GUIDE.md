# ProjectSession Debug Guide

Quick reference for debugging session-related issues.

---

## Console Commands

### Check Active Session

```javascript
// Get active session (throws if none)
const session = window.__DEBUG_getActiveSession();
console.log(session);

// Get active session (returns null if none)
const session = window.__DEBUG_getActiveSessionOrNull();
console.log(session);
```

### Check Session Health

```javascript
// Get detailed health status
const health = window.__DEBUG_getRuntimeHealth();
console.log(health);

// Expected output when session active:
{
  hasActiveSession: true,
  sessionId: "session-project-123-1234567890",
  projectId: "project-123",
  state: "active",
  playbackState: "paused",
  pendingJobs: 0,
  videoElements: 2,
  asyncTasks: 0,
  rafLoops: 1
}

// Expected output when no session:
{
  hasActiveSession: false,
  sessionId: null,
  projectId: null,
  state: null,
  playbackState: null,
  pendingJobs: 0,
  videoElements: 0,
  asyncTasks: 0,
  rafLoops: 0
}
```

### Manual Session Control

```javascript
// Create new session
await window.__DEBUG_createSession("test-project-id");

// Dispose active session
await window.__DEBUG_disposeSession();

// Switch sessions
await window.__DEBUG_switchSession("new-project-id");
```

---

## Common Issues

### Issue: State persists across project switches

**Symptoms:**

- Playhead doesn't reset to 0
- Clips from previous project visible
- Timeline duration incorrect

**Debug:**

```javascript
// Check if session was disposed
const health = window.__DEBUG_getRuntimeHealth();
console.log("Session active?", health.hasActiveSession);
console.log("Session state:", health.state);

// Check if new session was created
console.log("Project ID:", health.projectId);
```

**Fix:**

- Ensure `disposeProjectRuntime()` called before loading new project
- Ensure `initializeProjectRuntime()` called after loading new project
- Check `projectStore.ts` `loadProject()` method

---

### Issue: Video elements not cleaning up

**Symptoms:**

- Memory grows over time
- Video elements remain in DOM after project close
- Audio plays from closed project

**Debug:**

```javascript
// Check video element count
const health = window.__DEBUG_getRuntimeHealth();
console.log("Video elements:", health.videoElements);

// Check DOM directly
const videos = document.querySelectorAll("video");
console.log("Videos in DOM:", videos.length);

// List all registered video elements
const session = window.__DEBUG_getActiveSessionOrNull();
if (session) {
  console.log("Registered videos:", session._videoElements);
}
```

**Fix:**

- Ensure PreviewPanel registers video elements with session
- Ensure cleanup function in useEffect runs
- Check that `session.dispose()` calls `_releaseMediaResources()`

---

### Issue: Async tasks survive project switch

**Symptoms:**

- Console errors after project close
- Thumbnails generating for closed project
- Network requests for old project

**Debug:**

```javascript
// Check async task count
const health = window.__DEBUG_getRuntimeHealth();
console.log("Async tasks:", health.asyncTasks);

// List all registered tasks
const session = window.__DEBUG_getActiveSessionOrNull();
if (session) {
  console.log("Registered tasks:", session._asyncTasks);
}
```

**Fix:**

- Register AbortController with session: `session.registerAsyncTask(controller)`
- Unregister when complete: `session.unregisterAsyncTask(controller)`
- Ensure cleanup in useEffect return function

---

### Issue: RAF loops continue after project close

**Symptoms:**

- High CPU usage after closing project
- Console logs from render loop
- Canvas updates for closed project

**Debug:**

```javascript
// Check RAF loop count
const health = window.__DEBUG_getRuntimeHealth();
console.log("RAF loops:", health.rafLoops);

// List all registered RAF IDs
const session = window.__DEBUG_getActiveSessionOrNull();
if (session) {
  console.log("Registered RAF IDs:", session._rafIds);
}
```

**Fix:**

- Register RAF ID with session: `session.registerRAF(rafId)`
- Unregister when cancelled: `session.unregisterRAF(rafId)`
- Ensure cleanup in useEffect return function

---

### Issue: Multiple sessions active

**Symptoms:**

- Playback controls affect wrong project
- Timeline shows mixed clips
- Unpredictable behavior

**Debug:**

```javascript
// Check session count (should always be 0 or 1)
const health = window.__DEBUG_getRuntimeHealth();
console.log("Has active session?", health.hasActiveSession);

// Try to create second session (should dispose first)
await window.__DEBUG_createSession("test-2");
// First session should be disposed automatically
```

**Fix:**

- SessionRegistry automatically disposes previous session
- If issue persists, check for direct PlaybackClock/FrameScheduler instantiation
- All subsystems should be created via ProjectSession

---

### Issue: Session state stuck in "disposing"

**Symptoms:**

- Cannot create new session
- Operations fail with "session disposing" error
- UI frozen

**Debug:**

```javascript
const health = window.__DEBUG_getRuntimeHealth();
console.log("Session state:", health.state);

// Check if disposal is hanging
const session = window.__DEBUG_getActiveSessionOrNull();
if (session) {
  console.log("Disposal promise:", session._disposePromise);
}
```

**Fix:**

- Check for async operations that don't resolve
- Check for video elements that fail to release
- Add timeout to disposal operations
- Force dispose: `session._state = 'disposed'` (emergency only)

---

## Logging

### Enable Session Lifecycle Logging

Session lifecycle is already logged to console:

```
[ProjectSession] Initializing session: session-project-123-1234567890
[ProjectSession] Session initialized: session-project-123-1234567890
[ProjectSession] Disposing session: session-project-123-1234567890
[ProjectSession] Session disposed: session-project-123-1234567890
```

### Enable Runtime Manager Logging

Runtime manager logs are already enabled:

```
[ProjectRuntimeManager] Initializing runtime for project: project-123
[ProjectRuntimeManager] Disposing runtime for project: project-123
[ProjectRuntimeManager] Switching to project: project-456
```

### Add Custom Logging

```javascript
// Subscribe to session events
const session = window.__DEBUG_getActiveSessionOrNull();
if (session) {
  session.subscribe((event) => {
    console.log("[SessionEvent]", event.type, event.session.sessionId);
    if (event.error) {
      console.error("[SessionEvent] Error:", event.error);
    }
  });
}
```

---

## Performance Monitoring

### Memory Usage

```javascript
// Before project switch
const before = performance.memory.usedJSHeapSize;

// Switch project
await window.__DEBUG_switchSession("new-project");

// After project switch
const after = performance.memory.usedJSHeapSize;
const delta = after - before;

console.log("Memory delta:", (delta / 1024 / 1024).toFixed(2), "MB");
// Should be near 0 (slight increase is normal)
```

### Disposal Time

```javascript
const start = performance.now();
await window.__DEBUG_disposeSession();
const duration = performance.now() - start;

console.log("Disposal time:", duration.toFixed(2), "ms");
// Should be < 100ms typically
```

### Initialization Time

```javascript
const start = performance.now();
await window.__DEBUG_createSession("test-project");
const duration = performance.now() - start;

console.log("Initialization time:", duration.toFixed(2), "ms");
// Should be < 100ms typically
```

---

## Testing Scenarios

### Scenario 1: Clean Project Switch

```javascript
// 1. Create project A
await window.__DEBUG_createSession("project-a");
const healthA = window.__DEBUG_getRuntimeHealth();
console.log("Project A session:", healthA.sessionId);

// 2. Switch to project B
await window.__DEBUG_switchSession("project-b");
const healthB = window.__DEBUG_getRuntimeHealth();
console.log("Project B session:", healthB.sessionId);

// 3. Verify different sessions
console.assert(healthA.sessionId !== healthB.sessionId, "Sessions should be different");

// 4. Verify project A disposed
console.assert(healthB.hasActiveSession === true, "Should have active session");
console.assert(healthB.projectId === "project-b", "Should be project B");
```

### Scenario 2: Resource Cleanup

```javascript
// 1. Create session with resources
await window.__DEBUG_createSession("test-project");
const session = window.__DEBUG_getActiveSession();

// 2. Register fake resources
const controller = new AbortController();
session.registerAsyncTask(controller);
const rafId = requestAnimationFrame(() => {});
session.registerRAF(rafId);

// 3. Check resources registered
let health = window.__DEBUG_getRuntimeHealth();
console.log("Before disposal:", health.asyncTasks, health.rafLoops);

// 4. Dispose session
await window.__DEBUG_disposeSession();

// 5. Verify resources cleaned
health = window.__DEBUG_getRuntimeHealth();
console.assert(health.asyncTasks === 0, "Async tasks should be 0");
console.assert(health.rafLoops === 0, "RAF loops should be 0");
```

### Scenario 3: Disposal Idempotency

```javascript
// 1. Create session
await window.__DEBUG_createSession("test-project");

// 2. Dispose multiple times (should be safe)
await window.__DEBUG_disposeSession();
await window.__DEBUG_disposeSession();
await window.__DEBUG_disposeSession();

// 3. Verify no errors and no active session
const health = window.__DEBUG_getRuntimeHealth();
console.assert(health.hasActiveSession === false, "Should have no active session");
```

---

## Adding Debug Helpers

Add these to your app for easier debugging:

```typescript
// In src/App.tsx or main entry point
if (import.meta.env.DEV) {
  // Expose debug helpers
  (window as any).__DEBUG_getActiveSession = () => {
    const { getActiveSession } = require("./core/runtime/ProjectSession");
    return getActiveSession();
  };

  (window as any).__DEBUG_getActiveSessionOrNull = () => {
    const { getActiveSessionOrNull } = require("./core/runtime/ProjectSession");
    return getActiveSessionOrNull();
  };

  (window as any).__DEBUG_getRuntimeHealth = () => {
    const { getRuntimeHealthStatus } = require("./core/runtime/ProjectRuntimeManager");
    return getRuntimeHealthStatus();
  };

  (window as any).__DEBUG_createSession = async (projectId: string) => {
    const { createProjectSession } = require("./core/runtime/ProjectSession");
    return await createProjectSession(projectId);
  };

  (window as any).__DEBUG_disposeSession = async () => {
    const { disposeActiveSession } = require("./core/runtime/ProjectSession");
    return await disposeActiveSession();
  };

  (window as any).__DEBUG_switchSession = async (projectId: string) => {
    const { switchProjectRuntime } = require("./core/runtime/ProjectRuntimeManager");
    return await switchProjectRuntime(projectId);
  };

  console.log("[Debug] Session debug helpers available:");
  console.log("  - __DEBUG_getActiveSession()");
  console.log("  - __DEBUG_getActiveSessionOrNull()");
  console.log("  - __DEBUG_getRuntimeHealth()");
  console.log("  - __DEBUG_createSession(projectId)");
  console.log("  - __DEBUG_disposeSession()");
  console.log("  - __DEBUG_switchSession(projectId)");
}
```

---

## Troubleshooting Checklist

When debugging session issues, check:

- [ ] Session is created when project loads
- [ ] Session is disposed when project closes
- [ ] Only one session active at a time
- [ ] Video elements registered with session
- [ ] Video elements unregistered on cleanup
- [ ] Async tasks registered with session
- [ ] Async tasks cancelled on disposal
- [ ] RAF loops registered with session
- [ ] RAF loops cancelled on disposal
- [ ] Playback clock accessed via session
- [ ] Frame scheduler accessed via session
- [ ] Stores reset on session disposal
- [ ] No console errors during disposal
- [ ] Memory stable across project switches
- [ ] CPU usage drops after project close

---

**Last Updated**: 2026-05-12 **Phase**: 2 (Disposable ProjectSession Architecture)
