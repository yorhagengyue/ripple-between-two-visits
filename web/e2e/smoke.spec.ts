import { expect, test } from "@playwright/test";

// Scaffold smoke test. Module builders add their acceptance flows next to this file.
test("home page answers 200", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
});

test("event stream refuses a request without a session", async ({ request }) => {
  const res = await request.get("/api/events");
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: "no_session" });
});
