import type { ReactNode } from "react";
import { SettingsSidebarNav } from "@/components/settings/sidebar-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <div className="grid grid-cols-12 gap-8">
        <aside className="col-span-12 md:col-span-3">
          <SettingsSidebarNav />
        </aside>
        <main className="col-span-12 md:col-span-9">{children}</main>
      </div>
    </div>
  );
}
