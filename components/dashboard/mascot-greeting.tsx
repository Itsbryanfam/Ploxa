"use client";

import { useEffect, useState } from "react";
import { Mascot } from "@/components/mascot/mascot";
import { dashboardGreeting, type GreetingContext } from "@/lib/mascot/copy";

export function MascotGreeting({ context }: { context: GreetingContext }) {
  const [mood, setMood] = useState<"waving" | "idle">("waving");
  const message = dashboardGreeting(context);

  useEffect(() => {
    // Wave for 1.5s on mount, then settle to idle. Not a state-sync loop —
    // the timer is one-shot and cleared on unmount.
    const t = setTimeout(() => setMood("idle"), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex items-center gap-6">
      <Mascot size="xl" mood={mood} message={message} />
    </div>
  );
}
