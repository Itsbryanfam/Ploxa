"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useState } from "react";
import dynamic from "next/dynamic";

// Dev-only: `process.env.NODE_ENV` is a build-time constant in Next, so the
// production branch collapses to `null` and webpack DCE removes the
// `import("@tanstack/react-query-devtools")` reference entirely. Guarantees
// zero devtools bytes in production builds regardless of tree-shake heuristics.
const ReactQueryDevtools =
  process.env.NODE_ENV !== "production"
    ? dynamic(
        () =>
          import("@tanstack/react-query-devtools").then(
            (m) => m.ReactQueryDevtools,
          ),
        { ssr: false },
      )
    : null;

export function Providers({ children }: { children: React.ReactNode }) {
  // Per-render QueryClient via useState so it survives Next.js HMR cleanly
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30s default — tune per query
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          },
        }}
      />
      {ReactQueryDevtools && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
