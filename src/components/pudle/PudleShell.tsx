"use client";

import type { ReactNode } from "react";
import type { PudleSection } from "./types";

const navItems: Array<{ id: PudleSection; label: string; glyph: string }> = [
  { id: "drive", label: "Drive", glyph: "◉" },
  { id: "recordings", label: "Recordings", glyph: "▤" },
  { id: "ride", label: "Ride", glyph: "⌁" },
  { id: "profile", label: "Privacy", glyph: "◌" },
];

export interface PudleShellProps {
  activeSection: PudleSection;
  onSectionChange: (section: PudleSection) => void;
  children: ReactNode;
  header?: ReactNode;
  navigationLabel?: string;
}

export function PudleShell({
  activeSection,
  onSectionChange,
  children,
  header,
  navigationLabel = "Pudle navigation",
}: PudleShellProps) {
  return (
    <div className="pudle-shell">
      <header className="pudle-shell__header">
        <a className="pudle-wordmark" href="#pudle-main" aria-label="Pudle home">
          <span aria-hidden="true">p</span>
          Pudle
        </a>
        {header}
      </header>
      <main className="pudle-shell__main" id="pudle-main" tabIndex={-1}>
        {children}
      </main>
      <nav className="pudle-nav" aria-label={navigationLabel}>
        {navItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className="pudle-nav__item"
            aria-current={activeSection === item.id ? "page" : undefined}
            onClick={() => onSectionChange(item.id)}
          >
            <span className="pudle-nav__glyph" aria-hidden="true">
              {item.glyph}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
