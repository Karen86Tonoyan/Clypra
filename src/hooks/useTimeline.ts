import { useTimelineStore } from '../store/timelineStore'
import { useProjectStore } from '../store/projectStore'
import type { Clip, MediaAsset } from '../types'
import { createClipFromAsset } from '../lib/timelineClip'
import { autoAdaptSequenceForFirstVisualClip } from '../lib/sequenceAutoAspect'
import { DEFAULT_PLACEMENT_POLICY, resolveDefaultFitModeForAsset } from '../lib/placementPolicy'

export const useTimeline = () => {
  const { tracks, clips, zoomLevel, scrollLeft, pixelsPerSecond, addClip, removeClip, updateClip, moveClip, setZoom, setScrollLeft } = useTimelineStore()
  const { mediaAssets, project, updateProject } = useProjectStore()

  const addClipFromAsset = (asset: MediaAsset, trackId: string, startTime: number) => {
    if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
      autoAdaptSequenceForFirstVisualClip({
        project,
        existingClips: clips,
        asset,
        updateProject,
      })
    }
    const nextProject = useProjectStore.getState().project

    const clip: Clip = createClipFromAsset({
      asset,
      trackId,
      startTime,
      width: nextProject?.canvasWidth || project?.canvasWidth || 1920,
      height: nextProject?.canvasHeight || project?.canvasHeight || 1080,
      fitMode: resolveDefaultFitModeForAsset(asset),
    })
    addClip(clip)
  }

  const getClipsForTrack = (trackId: string) => {
    return clips.filter((c) => c.trackId === trackId)
  }

  const getMediaAsset = (mediaId: string) => {
    return mediaAssets.find((a) => a.id === mediaId)
  }

  return {
    tracks,
    clips,
    zoomLevel,
    scrollLeft,
    pixelsPerSecond,
    addClip,
    removeClip,
    updateClip,
    moveClip,
    setZoom,
    setScrollLeft,
    addClipFromAsset,
    getClipsForTrack,
    getMediaAsset,
  }
}
