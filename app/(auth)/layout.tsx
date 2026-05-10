import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="glow-bg flex min-h-screen flex-col">
      <header className="border-b border-[var(--border-soft)]">
        <div className="mx-auto flex max-w-6xl items-center px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="font-mono text-xs tracking-[0.2em] text-[var(--pixel)]">
              ▓ L4G ▓
            </span>
            <span className="text-[var(--text-dim)]">Letterboxd for Games</span>
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">{children}</main>
    </div>
  );
}
