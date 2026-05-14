import Image from "next/image";
import Link from "next/link";
import { NavTabs } from "./nav-tabs";
import { MobileMenu } from "./mobile-menu";
import { ProfileDropdown } from "./profile-dropdown";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { HeaderUser } from "@/lib/profile/server-actions";

interface Props {
  user: HeaderUser;
  /** Search input slot — pass <HeaderSearchInput /> through the layout. */
  searchSlot?: React.ReactNode;
}

export function AppHeader({ user, searchSlot }: Props) {
  const profileHref = user.username ? `/u/${user.username}` : "/settings";
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-soft)] bg-[var(--bg)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <Link href="/home" className="flex items-center shrink-0" aria-label="Ploxa home">
          <Image
            src="/logo/logo.png"
            alt="Ploxa"
            width={120}
            height={36}
            priority
            className="pixelated h-9 w-auto"
          />
        </Link>
        {/* Desktop: tabs · search · profile dropdown */}
        <div className="hidden md:flex items-center gap-6 flex-1">
          <NavTabs profileHref={profileHref} />
          <div className="ml-auto flex items-center gap-3">
            {searchSlot}
            <NotificationBell />
            <ProfileDropdown user={user} />
          </div>
        </div>
        {/* Mobile: search · bell · hamburger */}
        <div className="flex md:hidden items-center gap-2 ml-auto">
          {searchSlot}
          <NotificationBell />
          <MobileMenu user={user} profileHref={profileHref} />
        </div>
      </div>
    </header>
  );
}
