import { test, expect } from "@playwright/test";

test("incomplete auth forms explain the problem and focus the field without a request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/auth/")) requests.push(request.url());
  });
  await page.goto("/");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-error")).toContainText("valid email");
  await expect(page.getByLabel("Email Address")).toBeFocused();
  await expect(page.getByLabel("Email Address")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Email Address").fill("person@example.com");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await expect(page.getByTestId("auth-error")).toContainText("Enter your password");
  await page.getByTestId("switch-to-signup").click();
  await page.getByLabel("Full Name").fill("   ");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByLabel("Full Name")).toBeFocused();
  await expect(page.getByTestId("auth-error")).toContainText("Enter your name");
  expect(requests).toEqual([]);
});

test("email survives signup and recovery transitions, while passwords clear", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email Address").fill("person@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Private@123!");
  await page.getByTestId("switch-to-signup").click();
  await expect(page.getByLabel("Email Address")).toHaveValue("person@example.com");
  await expect(page.getByLabel("Password", { exact: true })).toBeEmpty();
  await page.getByTestId("switch-to-login").click();
  await page.getByTestId("forgot-password-link").click();
  await page.getByLabel("Email Address").fill("updated@example.com");
  await page.getByTestId("back-to-login").click();
  await expect(page.getByLabel("Email Address")).toHaveValue("updated@example.com");
  await page.getByTestId("forgot-password-link").click();
  await page.getByLabel("Email Address").fill("header-return@example.com");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByLabel("Email Address")).toHaveValue("header-return@example.com");
});

test("password visibility works on login, signup and reset without changing the value", async ({ page }) => {
  await page.goto("/");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("Private@123!");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("Private@123!");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByTestId("switch-to-signup").click();
  await page.getByLabel("Confirm Password", { exact: true }).fill("Private@123!");
  await page.getByRole("button", { name: "Show confirm password", exact: true }).click();
  await expect(page.getByLabel("Confirm Password", { exact: true })).toHaveAttribute("type", "text");
  await page.goto("/reset-password/preview-token");
  await page.getByLabel("New Password", { exact: true }).fill("Updated@123!");
  await page.getByRole("button", { name: "Show new password", exact: true }).click();
  await expect(page.getByLabel("New Password", { exact: true })).toHaveValue("Updated@123!");
  await expect(page.getByLabel("New Password", { exact: true })).toHaveAttribute("type", "text");
});

test("slow login prevents duplicate submissions and mode changes, then allows retry", async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/auth/login", async (route) => {
    calls += 1;
    await waiting;
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Invalid credentials" }) });
  });
  await page.goto("/");
  await page.getByLabel("Email Address").fill("person@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Private@123!");
  await page.getByTestId("auth-submit").click();
  try {
    await expect(page.getByTestId("auth-submit")).toBeDisabled();
    await expect(page.getByTestId("switch-to-signup")).toBeDisabled();
    await expect(page.getByTestId("forgot-password-link")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByTestId("auth-error")).toContainText("Invalid email or password");
  await expect(page.getByTestId("auth-submit")).toBeEnabled();
  expect(calls).toBe(1);
});

test("signup keeps its action visible on laptops and scrolls cleanly on small phones", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByTestId("switch-to-signup").click();
  await expect(page.getByTestId("auth-submit")).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.getByTestId("switch-to-signup").click();
  await page.getByLabel("Password", { exact: true }).fill("a");
  await expect(page.getByLabel("Password", { exact: true })).toHaveCSS("font-size", "16px");
  await page.getByTestId("auth-submit").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("auth-submit")).toBeInViewport();
  const dimensions = await page.getByTestId("account-layout").evaluate((el) => ({ width: el.clientWidth, content: el.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width);
});
