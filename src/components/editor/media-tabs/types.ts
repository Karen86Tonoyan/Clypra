export type TabType = "media" | "audio" | "text" | "stickers" | "effects" | "transitions" | "captions";

export interface TabProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
  className?: string;
}

export interface MediaTabProps {
  onAddToTimeline?: (item: any, type: TabType) => void;
  initialTab?: TabType;
}
