import type { APIRequestContext } from "@playwright/test";

type LocaleHooks = Pick<
  typeof import("@playwright/test").test,
  "beforeEach" | "afterEach"
>;

type SavedPreference = {
  expectedUserId: string;
  locale: string | null;
};

async function readJson(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  if (!response.ok()) {
    throw new Error(`Locale fixture request failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

/**
 * These UI tests intentionally change the signed-in account language. Keep that
 * real server persistence while preventing a test's Danish selection from
 * changing the starting language of a later test in the same browser shard.
 */
export function registerEnglishAccountLocaleIsolation(test: LocaleHooks) {
  let original: SavedPreference | undefined;

  test.beforeEach(async ({ request }) => {
    const session = await readJson(await request.get("/api/auth/get-session"));
    const expectedUserId = session?.user?.id;
    if (typeof expectedUserId !== "string") {
      original = undefined;
      return;
    }

    const preferences = await readJson(
      await request.get(
        `/api/auth/preferences?expectedUserId=${encodeURIComponent(expectedUserId)}`,
      ),
    );
    original = { expectedUserId, locale: preferences.locale ?? null };
    await readJson(
      await request.patch("/api/auth/preferences", {
        data: { expectedUserId, locale: "en" },
      }),
    );
  });

  test.afterEach(async ({ request }) => {
    if (!original) return;
    await readJson(
      await request.patch("/api/auth/preferences", {
        data: { expectedUserId: original.expectedUserId, locale: original.locale },
      }),
    );
    original = undefined;
  });
}
