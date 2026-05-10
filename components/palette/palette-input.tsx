"use client";

import { forwardRef } from "react";

interface PaletteInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export const PaletteInput = forwardRef<HTMLInputElement, PaletteInputProps>(
  function PaletteInput({ value, onChange, placeholder = "Search games..." }, ref) {
    return (
      <input
        ref={ref}
        data-palette-input="true"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-transparent text-lg text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none border-none"
      />
    );
  },
);
