/**
 * useFilmstrip.test.ts — hook tests
 *
 * Tests epoch-reactivity, cancel semantics, artifact deduplication,
 * progressive best-tier selection, isFallback state, and unmount cleanup.
 *
 * Uses renderHook from @testing-library/react.
 * Mocks: renderEngine/transport, renderEngine/hooks, store/renderEngineStore
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SpatialTier, InteractionState } from '../renderEngine/types';
import type { RenderEpochId } from '../renderEngine/types';
import type { TransportArtifact, ProgressiveTierRequest } from '../renderEngine/transport';

/** Cast a plain string to the branded RenderEpochId type (test helper only). */
const eid = (s: string) => s as RenderEpochId;

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockRequestProgressiveTiers = vi.fn(() => vi.fn()); // returns cancel fn
const mockUseRenderState = vi.fn();
const mockUseRenderEngineStore = vi.fn();
const mockGenerateTimestampGrid = vi.fn(() => [1.0, 2.0, 3.0]);

vi.mock('../renderEngine/transport', () => ({
  requestProgressiveTiers: mockRequestProgressiveTiers,
}));

vi.mock('../renderEngine/hooks', () => ({
  useRenderState: mockUseRenderState,
}));

vi.mock('../../store/renderEngineStore', () => ({
  useRenderEngineStore: mockUseRenderEngineStore,
}));

vi.mock('../timelineUtils', () => ({
  generateTimestampGrid: mockGenerateTimestampGrid,
}));

// Import AFTER mocks are registered
const { useFilmstrip } = await import('../useFilmstrip');

// ─── Default render state ─────────────────────────────────────────────────────

function makeRenderState(overrides = {}) {
  return {
    epochId: eid('epoch-1'),
    currentTier: { spatialTier: SpatialTier.L1, temporalTier: 0 },
    interactionState: InteractionState.Idle,
    isFallback: false,
    ...overrides,
  };
}

function makeArtifact(timestampMs: number, spatialTier = SpatialTier.L0): TransportArtifact {
  return {
    frameId: `f-${timestampMs}`,
    contentHash: `h-${timestampMs}`,
    spatialTier,
    bitmap: { width: 80, height: 45, close: vi.fn() } as unknown as ImageBitmap,
    width: 80,
    height: 45,
    timestampMs,
    epochId: eid('epoch-1'),
    source: 'fresh-decode',
  };
}

function defaultOpts() {
  return {
    clipId: 'clip-1',
    videoPath: '/a.mp4',
    trimIn: 0,
    trimOut: 10,
    duration: 10,
    enabled: true,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useFilmstrip', () => {
  beforeEach(() => {
    mockUseRenderState.mockReturnValue(makeRenderState());
    // useRenderEngineStore is called as a selector: `s => s.runtime`
    // Mock it to call the selector with the store object
    mockUseRenderEngineStore.mockImplementation((selector: (s: { runtime: object | null }) => unknown) =>
      selector({ runtime: {} })
    );
    mockRequestProgressiveTiers.mockImplementation(() => vi.fn());
  });

  afterEach(() => vi.clearAllMocks());

  // ── Basic enable/disable ───────────────────────────────────────────────────

  it('does not call requestProgressiveTiers when enabled=false', () => {
    renderHook(() => useFilmstrip({ ...defaultOpts(), enabled: false }));
    expect(mockRequestProgressiveTiers).not.toHaveBeenCalled();
  });

  it('does not call requestProgressiveTiers when videoPath is empty', () => {
    renderHook(() => useFilmstrip({ ...defaultOpts(), videoPath: '' }));
    expect(mockRequestProgressiveTiers).not.toHaveBeenCalled();
  });

  it('does not call requestProgressiveTiers when duration is 0', () => {
    renderHook(() => useFilmstrip({ ...defaultOpts(), duration: 0 }));
    expect(mockRequestProgressiveTiers).not.toHaveBeenCalled();
  });

  it('does not call requestProgressiveTiers when runtime is null', () => {
    mockUseRenderEngineStore.mockImplementation(
      (selector: (s: { runtime: null }) => unknown) => selector({ runtime: null })
    );
    renderHook(() => useFilmstrip(defaultOpts()));
    expect(mockRequestProgressiveTiers).not.toHaveBeenCalled();
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it('starts with isFallback=true before any artifacts arrive', () => {
    const { result } = renderHook(() => useFilmstrip(defaultOpts()));
    expect(result.current.isFallback).toBe(true);
  });

  it('starts with empty artifacts array', () => {
    const { result } = renderHook(() => useFilmstrip(defaultOpts()));
    expect(result.current.artifacts).toHaveLength(0);
  });

  // ── Artifact delivery ──────────────────────────────────────────────────────

  it('sets isFallback=false after first artifact arrives', () => {
    let capturedOnArtifact: ((a: TransportArtifact) => void) | null = null;
    (mockRequestProgressiveTiers as unknown as { mockImplementation: (fn: (opts: ProgressiveTierRequest) => ReturnType<typeof vi.fn>) => void })
      .mockImplementation((opts: ProgressiveTierRequest) => {
        capturedOnArtifact = opts.onArtifact;
        return vi.fn();
      });

    const { result } = renderHook(() => useFilmstrip(defaultOpts()));

    act(() => {
      capturedOnArtifact?.(makeArtifact(1000));
    });

    expect(result.current.isFallback).toBe(false);
    expect(result.current.artifacts).toHaveLength(1);
  });

  it('artifacts are sorted by timestampMs ascending', () => {
    let capturedOnArtifact: ((a: TransportArtifact) => void) | null = null;
    (mockRequestProgressiveTiers as unknown as { mockImplementation: (fn: (opts: ProgressiveTierRequest) => ReturnType<typeof vi.fn>) => void })
      .mockImplementation((opts: ProgressiveTierRequest) => {
        capturedOnArtifact = opts.onArtifact;
        return vi.fn();
      });

    const { result } = renderHook(() => useFilmstrip(defaultOpts()));

    act(() => {
      // Deliver out-of-order
      capturedOnArtifact?.(makeArtifact(3000));
      capturedOnArtifact?.(makeArtifact(1000));
      capturedOnArtifact?.(makeArtifact(2000));
    });

    const times = result.current.artifacts.map(a => a.timestampMs);
    expect(times).toEqual([1000, 2000, 3000]);
  });

  it('higher-tier artifact replaces lower-tier for same timestamp', () => {
    let capturedOnArtifact: ((a: TransportArtifact) => void) | null = null;
    (mockRequestProgressiveTiers as unknown as { mockImplementation: (fn: (opts: ProgressiveTierRequest) => ReturnType<typeof vi.fn>) => void })
      .mockImplementation((opts: ProgressiveTierRequest) => {
        capturedOnArtifact = opts.onArtifact;
        return vi.fn();
      });

    const { result } = renderHook(() => useFilmstrip(defaultOpts()));

    act(() => {
      capturedOnArtifact?.(makeArtifact(1000, SpatialTier.L0)); // L0 first
      capturedOnArtifact?.(makeArtifact(1000, SpatialTier.L1)); // L1 replaces
    });

    // Still just one entry per timestamp
    expect(result.current.artifacts).toHaveLength(1);
    expect(result.current.artifacts[0].spatialTier).toBe(SpatialTier.L1);
  });

  // ── Epoch change ───────────────────────────────────────────────────────────

  it('cancels previous request when epoch changes', () => {
    const cancel = vi.fn();
    mockRequestProgressiveTiers.mockReturnValueOnce(cancel);

    const { rerender } = renderHook(
      ({ epochId }: { epochId: string }) => {
        mockUseRenderState.mockReturnValue(makeRenderState({ epochId: eid(epochId) }));
        return useFilmstrip(defaultOpts());
      },
      { initialProps: { epochId: 'epoch-1' } },
    );

    rerender({ epochId: 'epoch-2' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('issues new request when epoch changes', () => {
    mockRequestProgressiveTiers.mockReturnValue(vi.fn());

    const { rerender } = renderHook(
      ({ epochId }: { epochId: string }) => {
        mockUseRenderState.mockReturnValue(makeRenderState({ epochId: eid(epochId) }));
        return useFilmstrip(defaultOpts());
      },
      { initialProps: { epochId: 'epoch-1' } },
    );

    rerender({ epochId: 'epoch-2' });
    expect(mockRequestProgressiveTiers).toHaveBeenCalledTimes(2);
  });

  it('skips requestProgressiveTiers entirely when Scrubbing', () => {
    // The hook design: during Scrubbing, we do NOT request at all.
    // The ISM will transition to Converging → Idle, which bumps the epoch,
    // and the next epoch commit will trigger the actual request.
    mockUseRenderState.mockReturnValue(
      makeRenderState({ interactionState: InteractionState.Scrubbing }),
    );
    mockRequestProgressiveTiers.mockImplementation(() => vi.fn());

    renderHook(() => useFilmstrip(defaultOpts()));

    expect(mockRequestProgressiveTiers).not.toHaveBeenCalled();
  });

  it('uses committed spatialTier when Idle', () => {
    mockUseRenderState.mockReturnValue(
      makeRenderState({
        interactionState: InteractionState.Idle,
        currentTier: { spatialTier: SpatialTier.L2, temporalTier: 0 },
      }),
    );

    renderHook(() => useFilmstrip(defaultOpts()));

    expect(mockRequestProgressiveTiers).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (mockRequestProgressiveTiers.mock.calls as any[][])[0]?.[0] as ProgressiveTierRequest | undefined;
    expect(call?.startTier).toBe(SpatialTier.L0);
    expect(call?.targetTier).toBe(SpatialTier.L2);
  });

  // ── Unmount cleanup ────────────────────────────────────────────────────────

  it('calls cancel on unmount', () => {
    const cancel = vi.fn();
    mockRequestProgressiveTiers.mockReturnValue(cancel);

    const { unmount } = renderHook(() => useFilmstrip(defaultOpts()));
    unmount();

    expect(cancel).toHaveBeenCalledOnce();
  });
});
