"use client";

import type { FormEvent } from "react";
import { PudleButton, PudlePrivacyNotice } from "./PudlePrimitives";

interface Credentials {
  email: string;
  password: string;
}

interface AuthPanelProps {
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (credentials: Credentials) => void;
  disabled?: boolean;
  loading?: boolean;
  errorMessage?: string;
}

export function PudleSignInPanel(props: AuthPanelProps) {
  return (
    <AuthPanel
      {...props}
      title="Welcome back"
      description="Sign in to see your saved Pudle preferences."
      submitLabel="Sign in"
      autoComplete="current-password"
    />
  );
}

export interface PudleCreateAccountPanelProps extends AuthPanelProps {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
}

export function PudleCreateAccountPanel({
  displayName,
  onDisplayNameChange,
  ...props
}: PudleCreateAccountPanelProps) {
  return (
    <AuthPanel
      {...props}
      title="Create your Pudle account"
      description="Keep your settings together without sharing camera frames or raw audio."
      submitLabel="Create account"
      autoComplete="new-password"
      extraField={
        <label className="pudle-field">
          <span>Name</span>
          <input
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            name="name"
            autoComplete="name"
            required
          />
        </label>
      }
    />
  );
}

function AuthPanel({
  title,
  description,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  disabled = false,
  loading = false,
  errorMessage,
  submitLabel,
  autoComplete,
  extraField,
}: AuthPanelProps & {
  title: string;
  description: string;
  submitLabel: string;
  autoComplete: "current-password" | "new-password";
  extraField?: React.ReactNode;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ email, password });
  }

  return (
    <section className="pudle-card pudle-auth" aria-labelledby="pudle-auth-title">
      <p className="pudle-eyebrow">Pudle account</p>
      <h1 id="pudle-auth-title">{title}</h1>
      <p>{description}</p>
      <form onSubmit={handleSubmit}>
        {extraField}
        <label className="pudle-field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            autoComplete="email"
            inputMode="email"
            required
          />
        </label>
        <label className="pudle-field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoComplete={autoComplete}
            required
          />
        </label>
        {errorMessage ? (
          <p className="pudle-form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <PudleButton type="submit" fullWidth disabled={disabled} loading={loading}>
          {submitLabel}
        </PudleButton>
      </form>
      <PudlePrivacyNotice>
        Full recordings and recording audio stay in this browser. Separately enabled cloud
        analysis can send periodic compressed frames, and foreground voice can use your browser
        vendor&apos;s speech service.
      </PudlePrivacyNotice>
    </section>
  );
}
