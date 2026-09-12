"use client";

import type { ReactNode } from "react";
import { PudleButton, PudleEmptyState, PudleStatusBadge } from "./PudlePrimitives";
import type { DriveControl, NearbyRoadEvent } from "./types";

const confidenceCopy = {
  high: { label: "High confidence", tone: "positive" },
  medium: { label: "Moderate confidence", tone: "accent" },
  low: { label: "Low confidence", tone: "warning" },
  unknown: { label: "Confidence unavailable", tone: "neutral" },
} as const;

export interface PudleDriveLayoutProps {
  camera: ReactNode;
  cameraStatus?: ReactNode;
  controls: DriveControl[];
  nearbyEvents?: NearbyRoadEvent[];
  nearbyStatus?: ReactNode;
  assistant?: ReactNode;
  guidance?: ReactNode;
  onEventSelect?: (event: NearbyRoadEvent) => void;
}

export function PudleDriveLayout({
  camera,
  cameraStatus,
  controls,
  nearbyEvents = [],
  nearbyStatus,
  assistant,
  guidance,
  onEventSelect,
}: PudleDriveLayoutProps) {
  return (
    <div className="pudle-drive">
      <section className="pudle-camera" aria-label="Drive camera">
        <div className="pudle-camera__viewport">{camera}</div>
        {cameraStatus ? <div className="pudle-camera__status">{cameraStatus}</div> : null}
        <div className="pudle-drive-controls" aria-label="Drive controls">
          {controls.map((control) => (
            <PudleButton
              key={control.id}
              variant={control.pressed ? "primary" : "secondary"}
              aria-pressed={control.pressed}
              disabled={control.disabled}
              loading={control.loading}
              onClick={control.onPress}
            >
              {control.icon ? (
                <span className="pudle-button__icon" aria-hidden="true">
                  {control.icon}
                </span>
              ) : null}
              {control.label}
            </PudleButton>
          ))}
        </div>
      </section>

      {guidance ?? <DriveSafetyGuidance />}
      {assistant}

      <section className="pudle-section" aria-labelledby="pudle-nearby-heading">
        <div className="pudle-section__heading">
          <div>
            <p className="pudle-eyebrow">Within 2 miles · last 30 minutes</p>
            <h2 id="pudle-nearby-heading">Nearby road activity</h2>
          </div>
          {nearbyStatus}
        </div>
        {nearbyEvents.length ? (
          <div className="pudle-event-list">
            {nearbyEvents.map((event) => (
              <NearbyEventCard
                event={event}
                key={event.id}
                onSelect={onEventSelect}
              />
            ))}
          </div>
        ) : (
          <PudleEmptyState
            title="The road looks quiet"
            description="No recent community observations are available nearby."
          />
        )}
      </section>
    </div>
  );
}

export function DriveSafetyGuidance() {
  return (
    <aside className="pudle-safety" aria-label="Driving safety">
      <strong>Set up before moving.</strong>
      <span>Review details and replay recordings only when parked.</span>
    </aside>
  );
}

export function NearbyEventCard({
  event,
  onSelect,
}: {
  event: NearbyRoadEvent;
  onSelect?: (event: NearbyRoadEvent) => void;
}) {
  const confidence = confidenceCopy[event.confidence];
  const body = (
    <>
      <div className="pudle-event-card__topline">
        <PudleStatusBadge tone={confidence.tone}>{confidence.label}</PudleStatusBadge>
        <span>{event.distanceLabel}</span>
      </div>
      <h3>{event.title}</h3>
      <p>{event.description}</p>
      {event.uncertaintyLabel ? (
        <p className="pudle-event-card__uncertainty">{event.uncertaintyLabel}</p>
      ) : null}
      <footer>
        <span>{event.sourceLabel}</span>
        <time dateTime={event.observedAt}>{event.observedAtLabel}</time>
      </footer>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className="pudle-event-card pudle-event-card--interactive"
        onClick={() => onSelect(event)}
      >
        {body}
      </button>
    );
  }

  return <article className="pudle-event-card">{body}</article>;
}
