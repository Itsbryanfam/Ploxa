import { permanentRedirect } from "next/navigation";

// 301 — old URL retained for any inbound notification-email deep links.
// Blocked-users management moves to /settings/privacy#blocked (ships in T8).
export default function BlockedRedirect() {
  permanentRedirect("/settings/privacy#blocked");
}
