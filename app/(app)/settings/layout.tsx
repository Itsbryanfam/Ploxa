import type { ReactNode } from "react";
import { SettingsSidebarNav } from "@/components/settings/sidebar-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container mx-auto px-4 py-8 grid grid-cols-12 gap-8">
      <aside className="col-span-12 md:col-span-3">
        <h1 className="text-2xl font-semibold mb-6">Settings</h1>
        <SettingsSidebarNav />
      </aside>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}
