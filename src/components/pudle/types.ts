import type { ReactNode } from "react";

export type PudleSection = "drive" | "recordings" | "ride" | "profile";

export type PudyState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type RecordingStatus = "idle" | "recording" | "paused" | "saving" | "saved" | "failed";

export type CloudAnalysisStatus =
  | "disabled"
  | "unconfigured"
  | "uploading"
  | "result"
  | "failure";

export type ConnectionStatus = "online" | "offline" | "reconnecting";

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export interface PudleActionState {
  disabled?: boolean;
  loading?: boolean;
}

export interface NearbyRoadEvent {
  id: string;
  title: string;
  description: string;
  distanceLabel: string;
  observedAt: string;
  observedAtLabel: string;
  sourceLabel: string;
  confidence: ConfidenceLevel;
  uncertaintyLabel?: string;
}

export interface DriveControl {
  id: string;
  label: string;
  icon?: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}

export interface RecordingItem {
  id: string;
  title: string;
  recordedAt: string;
  recordedAtLabel: string;
  durationLabel: string;
  status: "local" | "uploading" | "analyzed" | "failed";
  summary?: string;
}

export interface RideMessage {
  id: string;
  senderLabel: string;
  body: string;
  sentAt: string;
  sentAtLabel: string;
  isOwn?: boolean;
}
