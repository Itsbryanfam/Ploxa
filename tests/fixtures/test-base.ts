import { test as base } from "@playwright/test";
import {
  createTestUser,
  type CreateUserOptions,
  type TestUser,
} from "./seed-test-users";

/**
 * Extended Playwright `test()` with fixtures that spin up Supabase
 * accounts per test and tear them down at the end. Use:
 *
 *   test("...", async ({ privateUser }) => { ... });
 *   test("...", async ({ publicUser }) => { ... });
 *
 * Each fixture builds a fresh user via the service-role admin API and
 * cleans up after the test body — including on assertion failure.
 */
type Fixtures = {
  privateUser: TestUser;
  publicUser: TestUser;
};

async function withTestUser(
  opts: CreateUserOptions,
  use: (u: TestUser) => Promise<void>,
) {
  const user = await createTestUser(opts);
  try {
    await use(user);
  } finally {
    await user.cleanup();
  }
}

export const test = base.extend<Fixtures>({
  privateUser: async ({}, use) => {
    await withTestUser({ isPublic: false }, use);
  },
  publicUser: async ({}, use) => {
    await withTestUser({ isPublic: true }, use);
  },
});

export { expect } from "@playwright/test";
