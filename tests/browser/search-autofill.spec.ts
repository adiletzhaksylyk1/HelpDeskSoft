/// <reference lib="dom" />
import { test, expect } from "@playwright/test";

test("ignores credential autofill while preserving intentional searches and clearing", async ({
  page,
}) => {
  await page.goto("/");
  const search = page.locator("#search-bar");
  // Simulate a password manager writing to the hidden search during login.
  await search.evaluate((input: HTMLInputElement) => {
    input.value = "browser@example.com";
  });
  await page.locator("#auth-page-email").fill("browser@example.com");
  await page.locator("#auth-page-password").fill("TestPassword123!");
  await page.locator("#auth-page-submit-btn").click();
  await expect(page.locator("#ticket-page")).toContainText("105");
  await expect(search).toHaveValue("");

  // Late autofill can dispatch input, or silently mutate the value before polling.
  await search.evaluate((input: HTMLInputElement) => {
    input.value = "browser@example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(search).toHaveValue("");
  await search.evaluate((input: HTMLInputElement) => {
    input.value = "browser@example.com";
  });
  const refresh = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/api/tickets",
  );
  await page.locator('[data-ui-click="a39"]').click();
  expect(new URL((await refresh).url()).searchParams.has("search")).toBe(false);
  await expect(search).toHaveValue("");

  // Keyboard focus unlocks editing; pasting and typing both generate input.
  await page.locator('[data-ui-click="a39"]').focus();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await search.fill("Oldest searchable");
  await expect(page.locator("#ticket-page")).toContainText("(1)");
  await page.locator('[data-ui-click="a39"]').click();
  await expect(search).toHaveValue("Oldest searchable");
  await page.locator("#search-clear-btn").click();
  await expect(page.locator("#ticket-page")).toContainText("105");
  await expect(search).toBeFocused();
  // Searching an email deliberately must remain possible.
  const typed = page.waitForRequest(
    (r) =>
      new URL(r.url()).searchParams.get("search") === "browser@example.com",
  );
  await search.pressSequentially("browser@example.com");
  await typed;
});
