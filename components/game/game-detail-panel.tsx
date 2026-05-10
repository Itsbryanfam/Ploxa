"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export function GameDetailPanel({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") router.back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={() => router.back()}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        transition={{ type: "spring", damping: 32, stiffness: 280 }}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto bg-[var(--bg)] shadow-[var(--shadow-elev)] md:border-l md:border-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex justify-between items-center px-6 py-3 border-b border-[var(--border-soft)] bg-[var(--bg)]/80 backdrop-blur">
          <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">
            Game detail
          </span>
          <button
            onClick={() => router.back()}
            className="text-[var(--text-dim)] hover:text-[var(--text)] text-2xl leading-none"
            aria-label="Close panel"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-6">{children}</div>
      </motion.div>
    </>
  );
}
