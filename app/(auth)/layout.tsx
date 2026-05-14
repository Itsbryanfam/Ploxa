import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="glow-bg flex min-h-screen flex-col">
      <header className="border-b border-[var(--border-soft)]">
        <div className="mx-auto flex max-w-6xl items-center px-6 py-4">
          <Link href="/" className="flex items-center" aria-label="Ploxa home">
            <Image
              src="/logo/logo.png"
              alt="Ploxa"
              width={160}
              height={48}
              priority
              className="pixelated h-12 w-auto"
            />
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">{children}</main>
    </div>
  );
}
