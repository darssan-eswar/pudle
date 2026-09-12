"use client";

import type { FormEvent } from "react";
import { PudleButton, PudleEmptyState, PudleStatusBadge } from "./PudlePrimitives";
import type { RideMessage } from "./types";

export interface PudleRidePanelProps {
  rideName: string;
  memberCountLabel: string;
  connectionLabel?: string;
  messages: RideMessage[];
  message: string;
  onMessageChange: (value: string) => void;
  onSend: (message: string) => void;
  onLeave?: () => void;
  sending?: boolean;
  disabled?: boolean;
}

export function PudleRidePanel({
  rideName,
  memberCountLabel,
  connectionLabel,
  messages,
  message,
  onMessageChange,
  onSend,
  onLeave,
  sending = false,
  disabled = false,
}: PudleRidePanelProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (trimmedMessage) onSend(trimmedMessage);
  }

  return (
    <section className="pudle-card pudle-ride" aria-labelledby="pudle-ride-title">
      <header className="pudle-panel-header">
        <div>
          <p className="pudle-eyebrow">{memberCountLabel}</p>
          <h1 id="pudle-ride-title">{rideName}</h1>
        </div>
        {connectionLabel ? (
          <PudleStatusBadge tone="accent">{connectionLabel}</PudleStatusBadge>
        ) : null}
      </header>
      <p className="pudle-muted">
        Share short, observable road updates. Do not speculate about people or intent.
      </p>
      {messages.length ? (
        <ol className="pudle-messages" aria-label="Ride messages">
          {messages.map((item) => (
            <li
              key={item.id}
              className={item.isOwn ? "pudle-message pudle-message--own" : "pudle-message"}
            >
              <strong>{item.senderLabel}</strong>
              <p>{item.body}</p>
              <time dateTime={item.sentAt}>{item.sentAtLabel}</time>
            </li>
          ))}
        </ol>
      ) : (
        <PudleEmptyState
          title="No ride messages yet"
          description="Road updates from your group will appear here."
        />
      )}
      <form className="pudle-composer" onSubmit={handleSubmit}>
        <label className="pudle-field">
          <span>Message your ride</span>
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            maxLength={280}
            rows={2}
            disabled={disabled}
          />
        </label>
        <PudleButton
          type="submit"
          loading={sending}
          disabled={disabled || !message.trim()}
        >
          Send
        </PudleButton>
      </form>
      {onLeave ? (
        <PudleButton variant="quiet" onClick={onLeave} disabled={sending}>
          Leave ride
        </PudleButton>
      ) : null}
    </section>
  );
}
