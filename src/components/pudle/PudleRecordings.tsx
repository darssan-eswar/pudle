"use client";

import { PudleButton, PudleEmptyState, PudleStatusBadge } from "./PudlePrimitives";
import type { RecordingItem } from "./types";

const statusCopy = {
  local: { label: "On this device", tone: "neutral" },
  uploading: { label: "Uploading", tone: "accent" },
  analyzed: { label: "Analysis ready", tone: "positive" },
  failed: { label: "Action needed", tone: "danger" },
} as const;

export interface PudleRecordingsLibraryProps {
  recordings: RecordingItem[];
  onOpen: (recording: RecordingItem) => void;
  onDelete?: (recording: RecordingItem) => void;
  emptyAction?: React.ReactNode;
}

export function PudleRecordingsLibrary({
  recordings,
  onOpen,
  onDelete,
  emptyAction,
}: PudleRecordingsLibraryProps) {
  return (
    <section className="pudle-section" aria-labelledby="pudle-recordings-title">
      <div className="pudle-section__heading">
        <div>
          <p className="pudle-eyebrow">Private by default</p>
          <h1 id="pudle-recordings-title">Recordings</h1>
        </div>
      </div>
      {recordings.length ? (
        <ul className="pudle-recording-list">
          {recordings.map((recording) => {
            const status = statusCopy[recording.status];
            return (
              <li className="pudle-recording" key={recording.id}>
                <button
                  className="pudle-recording__open"
                  type="button"
                  onClick={() => onOpen(recording)}
                >
                  <span className="pudle-recording__art" aria-hidden="true">
                    ≋
                  </span>
                  <span className="pudle-recording__copy">
                    <strong>{recording.title}</strong>
                    <span>
                      <time dateTime={recording.recordedAt}>
                        {recording.recordedAtLabel}
                      </time>
                      {" · "}
                      {recording.durationLabel}
                    </span>
                    {recording.summary ? <span>{recording.summary}</span> : null}
                  </span>
                  <PudleStatusBadge tone={status.tone}>{status.label}</PudleStatusBadge>
                </button>
                {onDelete ? (
                  <PudleButton
                    variant="quiet"
                    aria-label={`Delete ${recording.title}`}
                    onClick={() => onDelete(recording)}
                  >
                    Delete
                  </PudleButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <PudleEmptyState
          title="No recordings yet"
          description="Recordings you choose to save will appear here."
          action={emptyAction}
        />
      )}
    </section>
  );
}
