"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type {
  CloudAnalysisStatus,
  ConnectionStatus,
  RecordingStatus,
} from "./types";

type Tone = "neutral" | "positive" | "warning" | "danger" | "accent";

export interface PudleButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  loading?: boolean;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  fullWidth?: boolean;
}

export function PudleButton({
  children,
  loading = false,
  variant = "primary",
  fullWidth = false,
  disabled,
  className = "",
  type = "button",
  ...props
}: PudleButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`pudle-button pudle-button--${variant}${fullWidth ? " pudle-button--full" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="pudle-spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function PudleStatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`pudle-status pudle-status--${tone}`}>{children}</span>;
}

const recordingCopy: Record<RecordingStatus, { label: string; tone: Tone }> = {
  idle: { label: "Ready to record locally", tone: "neutral" },
  recording: { label: "Recording on this device", tone: "danger" },
  paused: { label: "Recording paused", tone: "warning" },
  saving: { label: "Saving on this device", tone: "accent" },
  saved: { label: "Saved on this device", tone: "positive" },
  failed: { label: "Could not save recording", tone: "danger" },
};

export function RecordingStatusBadge({ status }: { status: RecordingStatus }) {
  const item = recordingCopy[status];
  return <PudleStatusBadge tone={item.tone}>{item.label}</PudleStatusBadge>;
}

const cloudCopy: Record<CloudAnalysisStatus, { label: string; tone: Tone }> = {
  disabled: { label: "Cloud analysis off", tone: "neutral" },
  unconfigured: { label: "Cloud analysis not configured", tone: "warning" },
  uploading: { label: "Uploading for analysis", tone: "accent" },
  result: { label: "Cloud analysis available", tone: "positive" },
  failure: { label: "Cloud analysis failed", tone: "danger" },
};

export function CloudAnalysisStatusBadge({
  status,
}: {
  status: CloudAnalysisStatus;
}) {
  const item = cloudCopy[status];
  return <PudleStatusBadge tone={item.tone}>{item.label}</PudleStatusBadge>;
}

const connectionCopy: Record<ConnectionStatus, { label: string; tone: Tone }> = {
  online: { label: "Online", tone: "positive" },
  offline: { label: "Offline", tone: "warning" },
  reconnecting: { label: "Reconnecting", tone: "accent" },
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const item = connectionCopy[status];
  return (
    <PudleStatusBadge tone={item.tone}>
      <span className="pudle-status__dot" aria-hidden="true" />
      {item.label}
    </PudleStatusBadge>
  );
}

export function PudlePrivacyNotice({
  title = "Your media stays with you",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className="pudle-privacy-notice" aria-label="Privacy information">
      <span className="pudle-privacy-notice__mark" aria-hidden="true">
        ◌
      </span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </aside>
  );
}

export function PudleEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="pudle-empty">
      <span className="pudle-empty__orb" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
