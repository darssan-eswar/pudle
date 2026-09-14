"use client";

import type { ReactNode } from "react";
import { PudleButton, PudlePrivacyNotice } from "./PudlePrimitives";

export interface PudlePrivacyPreference {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export interface PudleProfilePanelProps {
  displayName: string;
  email?: string;
  preferences: PudlePrivacyPreference[];
  accountActions?: ReactNode;
  onSignOut?: () => void;
  signingOut?: boolean;
}

export function PudleProfilePanel({
  displayName,
  email,
  preferences,
  accountActions,
  onSignOut,
  signingOut = false,
}: PudleProfilePanelProps) {
  return (
    <div className="pudle-profile">
      <section className="pudle-card" aria-labelledby="pudle-profile-title">
        <p className="pudle-eyebrow">Profile</p>
        <h1 id="pudle-profile-title">{displayName}</h1>
        {email ? <p className="pudle-muted">{email}</p> : null}
        {accountActions}
        {onSignOut ? (
          <PudleButton variant="secondary" loading={signingOut} onClick={onSignOut}>
            Sign out
          </PudleButton>
        ) : null}
      </section>

      <section className="pudle-card" aria-labelledby="pudle-privacy-title">
        <p className="pudle-eyebrow">Your controls</p>
        <h2 id="pudle-privacy-title">Privacy</h2>
        <PudlePrivacyNotice title="Local media stays local">
          Pudle does not send camera frames or raw microphone audio off this device.
        </PudlePrivacyNotice>
        <div className="pudle-preferences">
          {preferences.map((preference) => (
            <label className="pudle-toggle" key={preference.id}>
              <span>
                <strong>{preference.label}</strong>
                <small>{preference.description}</small>
              </span>
              <input
                type="checkbox"
                checked={preference.checked}
                disabled={preference.disabled}
                onChange={(event) => preference.onChange(event.target.checked)}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
