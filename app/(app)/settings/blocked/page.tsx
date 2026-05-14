import { permanentRedirect } from "next/navigation";

// 308 (Next App Router permanentRedirect) — old URL retained for inbound
// notification-email deep links. Blocked-users management lives at
// /settings/privacy#blocked since T8.
export default function BlockedRedirect() {
  permanentRedirect("/settings/privacy#blocked");
}
