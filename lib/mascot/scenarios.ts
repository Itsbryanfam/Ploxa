export type MascotScenario =
  // Palette
  | "palette.idle"
  | "palette.no-results"
  | "palette.searching"
  // Log
  | "log.success.completed-high" // rating >= 8.5
  | "log.success.completed-mid" // rating 5-8
  | "log.success.completed-low" // rating < 5
  | "log.success.playing"
  | "log.success.backlog"
  | "log.success.wishlist"
  | "log.success.dropped"
  | "log.success.on_hold"
  // Empty states — keyed by `library.empty.${filter}` where filter is
  // LogStatus | "all"; library-list/library-shelf compute the key at
  // runtime, so every LogStatus value must have a matching scenario.
  | "library.empty.all"
  | "library.empty.playing"
  | "library.empty.completed"
  | "library.empty.backlog"
  | "library.empty.wishlist"
  | "library.empty.dropped"
  | "library.empty.on_hold"
  // Dashboard
  | "dashboard.greeting.morning"
  | "dashboard.greeting.afternoon"
  | "dashboard.greeting.evening"
  | "dashboard.greeting.night"
  | "dashboard.greeting.long-absence"
  | "dashboard.greeting.actively-playing"
  // Errors
  | "error.404";
