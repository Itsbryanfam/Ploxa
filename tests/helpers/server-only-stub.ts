// Replacement for the `server-only` package when Vitest imports modules
// that start with `import "server-only"`. The real package throws on
// import unless it's running in an RSC server context; that throw is
// useful in app code (catches accidental client-component imports) but
// blocks Vitest from loading anything server-side. In Node tests we're
// already on the server side, so a no-op is fine.
//
// Aliased via vitest.config.ts → resolve.alias["server-only"].
export {};
