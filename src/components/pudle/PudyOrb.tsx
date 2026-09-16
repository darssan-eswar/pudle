import type { PudyState } from "./types";

const stateCopy: Record<PudyState, string> = {
  idle: "Pudy is ready",
  listening: "Pudy is listening through this device only",
  thinking: "Pudy is thinking",
  speaking: "Pudy is speaking",
  error: "Pudy needs your attention",
};

export interface PudyOrbProps {
  state?: PudyState;
  label?: string;
  showMicDisclosure?: boolean;
  size?: "small" | "medium" | "large";
}

export function PudyOrb({
  state = "idle",
  label,
  showMicDisclosure = state === "listening",
  size = "medium",
}: PudyOrbProps) {
  const accessibleLabel = label ?? stateCopy[state];

  return (
    <figure
      className={`pudle-pudy pudle-pudy--${state} pudle-pudy--${size}`}
      aria-label={accessibleLabel}
    >
      <div className="pudle-pudy__orb" aria-hidden="true">
        <span className="pudle-pudy__face">
          <span className="pudle-pudy__eye" />
          <span className="pudle-pudy__eye" />
          <span className="pudle-pudy__mouth" />
        </span>
      </div>
      <figcaption>
        <span>{accessibleLabel}</span>
        {showMicDisclosure ? (
          <small>Mic audio is used in the foreground and is not stored.</small>
        ) : null}
      </figcaption>
    </figure>
  );
}
