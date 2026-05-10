import { z } from "zod";
import { RESERVED_USERNAMES } from "./reserved-usernames";

export const usernameSchema = z
  .string()
  .regex(/^[a-z0-9_]{3,24}$/, "must be 3–24 chars; lowercase letters, digits, or _")
  .refine((v) => !RESERVED_USERNAMES.has(v), "this name is reserved");
