/// <reference lib="dom" />
import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER:", error.message));
  await page.goto("/");
  await page.locator("#auth-page-email").fill("browser@example.com");
  await page.locator("#auth-page-password").fill("TestPassword123!");
  await page
    .locator("#auth-page-form")
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator("#ticket-page")).toContainText("105");
});
test("paginates all tickets and searches older records without executable filename attributes", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("pageerror", (error) => violations.push(error.message));
  await page.locator("#ticket-next").click();
  await expect(page.locator("#ticket-page")).toContainText("2 / 7");
  await page.locator("#search-bar").focus();
  await page.locator("#search-bar").fill("Oldest searchable");
  await expect(page.locator("#ticket-page")).toContainText("(1)");
  await page
    .getByText("Oldest searchable request", { exact: true })
    .first()
    .click();
  await expect(page.locator(".attachment-name")).toContainText("window.__xss");
  expect(
    await page.evaluate(() => Reflect.get(window, "__xss")),
  ).toBeUndefined();
  expect(await page.locator("[onclick],[onchange],[onsubmit]").count()).toBe(0);
  expect(violations).toEqual([]);
});
test("keeps drafts across navigation and provides keyboard dialog focus", async ({
  page,
}) => {
  await page.getByText("Browser ticket 104", { exact: true }).click();
  await page.locator("#reply-text").fill("Draft for ticket 104");
  await page.getByText("Browser ticket 103", { exact: true }).click();
  await expect(page.locator("#reply-text")).toHaveValue("");
  await page.getByText("Browser ticket 104", { exact: true }).click();
  await expect(page.locator("#reply-text")).toHaveValue("Draft for ticket 104");
  await page.locator('[data-ui-click="a16"]').click();
  await expect(page.locator('#modal-new-ticket [role="dialog"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal-new-ticket")).not.toBeVisible();
});

test("cancel and Escape return from role creation to the roles panel", async ({
  page,
}) => {
  await page.locator('[data-ui-click="a85"]').click();
  await page.locator('[data-ui-click="a87"]').click();
  await expect(page.locator("#modal-admin")).toBeVisible();
  await expect(page.locator("#tab-btn-roles")).toHaveClass(/active/);

  await page.locator("#btn-add-role").click();
  await expect(page.locator("#modal-new-role")).toBeVisible();
  await page.locator('#modal-new-role [data-ui-click="a65"]').click();
  await expect(page.locator("#modal-new-role")).not.toBeVisible();
  await expect(page.locator("#modal-admin")).toBeVisible();
  await expect(page.locator("#tab-btn-roles")).toHaveClass(/active/);

  await page.locator("#btn-add-role").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal-new-role")).not.toBeVisible();
  await expect(page.locator("#modal-admin")).toBeVisible();
});

test("mailbox action buttons follow the selected language", async ({ page }) => {
  await page.locator('[data-ui-click="a85"]').click();
  await page.locator('[data-ui-click="a88"]').click();
  await page.locator("#btn-add-mailbox").click();
  const modal = page.locator("#modal-new-mailbox");
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-ui-click="a76"]')).toHaveText("Отмена");
  await expect(modal.locator('[data-ui-click="a77"]')).toHaveText("Подключить и сохранить");
  await expect(modal.locator("#btn-test-conn")).toHaveText("Проверить подключение");

  await page.evaluate(() => Reflect.get(window, "setLanguage")("KZ"));
  await expect(modal.locator('[data-ui-click="a76"]')).toHaveText("Бас тарту");
  await expect(modal.locator('[data-ui-click="a77"]')).toHaveText("Қосып, сақтау");
  await expect(modal.locator("#btn-provider-imap")).toContainText("Кәдімгі IMAP / SMTP");
  await modal.locator("#btn-provider-imap").click();
  await expect(modal.locator("#mb-test-status")).toHaveText("Сақтау алдында қосылымды тексеріңіз");

  await page.evaluate(() => Reflect.get(window, "setLanguage")("EN"));
  await expect(modal.locator('[data-ui-click="a76"]')).toHaveText("Cancel");
  await expect(modal.locator('[data-ui-click="a77"]')).toHaveText("Connect & Save");
  await expect(modal.locator("#btn-test-conn")).toHaveText("Test connection");
  await expect(modal.locator("#mb-test-status")).toHaveText("Test the connection before saving");
});

test("reports detail server failures accurately and allows reopening the ticket", async ({
  page,
}) => {
  await page.evaluate(() => Reflect.get(window, "setLanguage")("RU"));
  await page.route(/\/api\/tickets\/[0-9a-f-]+$/, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Internal server error" }),
    }),
  );
  await page.getByText("Browser ticket 104", { exact: true }).click();
  await expect(page.locator("#ticket-error")).toContainText(
    "Не удалось загрузить заявку",
  );
  await expect(page.locator("#ticket-error")).toContainText("500");
  await expect(page.locator("#ticket-content")).not.toBeVisible();
  await page.unroute(/\/api\/tickets\/[0-9a-f-]+$/);
  await page.getByText("Browser ticket 104", { exact: true }).click();
  await expect(page.locator("#d-subject")).toHaveText("Browser ticket 104");
  await expect(page.locator("#d-thread .msg-body").first()).not.toBeEmpty();
  await expect(page.locator("#ticket-error")).not.toBeVisible();
});
test("keeps an in-flight upload and reply bound to the original ticket", async ({
  page,
}) => {
  await page.getByText("Browser ticket 104", { exact: true }).click();
  await expect(page.locator("#d-subject")).toHaveText("Browser ticket 104");
  await page.locator("#reply-text").fill("Reply belongs to 104");
  await page.locator("#reply-file-input").setInputFiles({
    name: "file.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(800000, 65),
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/uploads", async (route) => {
    await gate;
    await route.continue();
  });
  const upload = page.waitForRequest((r) => r.url().endsWith("/uploads"));
  await page.locator("#btn-send-reply").click();
  const original = (await upload).url().replace("/uploads", "/replies");
  await page.getByText("Browser ticket 103", { exact: true }).click();
  await expect(page.locator("#d-subject")).toHaveText("Browser ticket 103");
  await page.locator("#reply-text").fill("Keep this separate draft");
  const sent = page.waitForResponse(
    (r) => r.url() === original && r.request().method() === "POST",
  );
  release();
  expect((await sent).status()).toBe(201);
  await expect(page.locator("#reply-text")).toHaveValue(
    "Keep this separate draft",
  );
});
test("supports all interface languages on a small screen and handles an expired session", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const language of ["EN", "RU", "KZ"]) {
    await page.evaluate(
      (lang) => Reflect.get(window, "setLanguage")(lang),
      language,
    );
    const expected = { EN: "Next", RU: "Далее", KZ: "Келесі" }[language];
    await expect(page.locator("#ticket-next")).toHaveText(expected!);
  }
  await page.route("**/api/tickets?**", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Expired" }),
    }),
  );
  await page.locator("#search-bar").focus();
  await page.locator("#search-bar").fill("expired");
  await expect(page.locator("#auth-screen")).toBeVisible();
});
test("opens a single-use invitation even when another account was signed in", async ({
  page,
}) => {
  const email = "invited-" + Date.now() + "@example.com";
  const invite = await page.evaluate(async (email) => {
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + sessionStorage.getItem("hd_token"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Invited staff", email, role: "HelpDesk" }),
    });
    if (!response.ok) throw new Error("Invitation creation failed");
    return response.json();
  }, email);
  await page.goto(
    "/#invite=" +
      invite.invitationToken +
      "&email=" +
      encodeURIComponent(email),
  );
  await expect(page.locator("#auth-screen")).toBeVisible();
  await expect(page.locator("#auth-page-email")).toHaveValue(email);
  expect(page.url()).not.toContain(invite.invitationToken);
  await page.locator("#auth-page-password").fill("FreshPassword123!");
  await page
    .locator("#auth-page-form")
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator("#auth-screen")).not.toBeVisible();
  const replay = await page.request.post("/api/auth/setup-password", {
    data: {
      email,
      token: invite.invitationToken,
      password: "FreshPassword123!",
    },
  });
  expect(replay.status()).toBe(401);
});
