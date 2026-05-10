/**
 * Thrown by ensureMyProfile when the caller passes an explicit username that
 * is already taken (unique-constraint violation). The signup action catches
 * this and returns suggestion chips rather than silently using a different name.
 *
 * Kept in a separate file (not "use server") so it can be imported as a class
 * in both server-action files and client-adjacent action files without Next.js
 * rejecting it as a non-async export from a "use server" module.
 */
export class UsernameCollisionError extends Error {
  constructor(public username: string) {
    super(`Username ${username} is already taken`);
    this.name = "UsernameCollisionError";
  }
}
