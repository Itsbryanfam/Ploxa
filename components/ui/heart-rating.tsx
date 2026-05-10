"use client";

import { useState } from "react";
import { HeartFull, HeartHalf, HeartEmpty } from "@/components/pixel";
import { cn } from "@/lib/utils";

interface HeartRatingProps {
  value?: number;
  onChange?: (value: number) => void;
  size?: number;
  disabled?: boolean;
  className?: string;
}

const HEART_COUNT = 10;

export function HeartRating({
  value = 0,
  onChange,
  size = 20,
  disabled = false,
  className,
}: HeartRatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;

  const handleClick = (heartIndex: number, half: "left" | "right") => {
    if (disabled || !onChange) return;
    const newValue = heartIndex + (half === "left" ? 0.5 : 1);
    onChange(newValue);
  };

  const handleHover = (heartIndex: number, half: "left" | "right") => {
    if (disabled) return;
    setHover(heartIndex + (half === "left" ? 0.5 : 1));
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (disabled || !onChange) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(10, value + 0.5));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(0, value - 0.5));
    }
  };

  return (
    <div
      role="slider"
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={value}
      aria-valuetext={`${value} out of 10`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKey}
      onMouseLeave={() => setHover(null)}
      className={cn(
        "inline-flex gap-[2px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-sm p-1",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      aria-label={`Rating: ${value} of 10`}
    >
      {Array.from({ length: HEART_COUNT }, (_, i) => {
        const heartValue = i + 1;
        const isFull = display >= heartValue;
        const isHalf = !isFull && display >= heartValue - 0.5;
        const Heart = isFull ? HeartFull : isHalf ? HeartHalf : HeartEmpty;

        return (
          <span key={i} className="relative inline-flex" style={{ width: size, height: size }}>
            <Heart size={size} />
            {!disabled && (
              <>
                <button
                  type="button"
                  onClick={() => handleClick(i, "left")}
                  onMouseEnter={() => handleHover(i, "left")}
                  className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <button
                  type="button"
                  onClick={() => handleClick(i, "right")}
                  onMouseEnter={() => handleHover(i, "right")}
                  className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                  aria-hidden="true"
                  tabIndex={-1}
                />
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
