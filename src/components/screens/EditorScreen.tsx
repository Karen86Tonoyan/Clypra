import React, { useEffect } from "react";
// @ts-ignore - react-dnd types issue
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { EditorLayout } from "../editor/EditorLayout";
import { SettingsModal } from "../ui/SettingsModal";
import { SuccessToast } from "../ui/SuccessToast";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { usePlaybackStore } from "../../store/playbackStore";
import { useProjectStore } from "../../store/projectStore";
import { useUIStore } from "../../store/uiStore";
import { useRenderEngineStore } from "../../store/renderEngineStore";

export const EditorScreen: React.FC = () => {
  const { toastMessage } = useKeyboardShortcuts();
  const { setDuration } = usePlaybackStore();
  const { project } = useProjectStore();
  const { showSettingsModal, toggleSettingsModal } = useUIStore();
  const { initRuntime, destroyRuntime } = useRenderEngineStore();

  useEffect(() => {
    if (project) {
      setDuration(project.duration);
      initRuntime(project.id);
    }

    return () => {
      destroyRuntime();
    };
  }, [project, setDuration, initRuntime, destroyRuntime]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="w-full h-full p-1.5 overflow-hidden">
        <EditorLayout />
        <SettingsModal isOpen={showSettingsModal} onClose={toggleSettingsModal} />
        <SuccessToast message={toastMessage} />
      </div>
    </DndProvider>
  );
};
