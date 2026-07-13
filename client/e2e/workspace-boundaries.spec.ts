import { expect, test, type Route } from "@playwright/test";

const API_BASE = process.env["MERIDIAN_BACKEND_URL"] ?? "http://localhost:3000";
const NOW = "2026-01-01T00:00:00.000Z";

const user = {
  id: "user-1",
  email: "member@example.com",
  displayName: "Workspace Member",
  avatarUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  const origin = route.request().headers()["origin"];
  await route.fulfill({
    status,
    contentType: "application/json",
    headers:
      origin !== undefined
        ? {
            "access-control-allow-origin": origin,
            "access-control-allow-credentials": "true",
          }
        : undefined,
    body: JSON.stringify(body),
  });
}

test("a workspace deep link selects that workspace and clears demo tabs when it is empty", async ({
  page,
}) => {
  const requestedTrees: string[] = [];

  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === "GET" && path === "/auth/me") {
      await fulfillJson(route, user);
      return;
    }
    if (request.method() === "GET" && path === "/workspaces") {
      await fulfillJson(route, [
        { id: "other-workspace", name: "Meridian Default", ownerId: user.id, createdAt: NOW, updatedAt: NOW },
        { id: "empty-workspace", name: "Empty Workspace", ownerId: user.id, createdAt: NOW, updatedAt: NOW },
      ]);
      return;
    }
    if (request.method() === "GET" && path === "/workspaces/empty-workspace/members") {
      await fulfillJson(route, [
        {
          id: "member-1",
          workspaceId: "empty-workspace",
          userId: user.id,
          role: "OWNER",
          createdAt: NOW,
        },
      ]);
      return;
    }
    if (request.method() === "GET" && path === "/workspaces/empty-workspace/documents/tree") {
      requestedTrees.push("empty-workspace");
      await fulfillJson(route, []);
      return;
    }

    await route.abort("connectionrefused");
  });

  await page.goto("/workspace/empty-workspace");
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
  );

  expect(requestedTrees).toEqual(["empty-workspace"]);
  await expect(page.getByText("No files", { exact: true })).toBeVisible();
  await expect(
    page.locator("#main-content").getByText("No file open", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("auth.ts", { exact: true })).toHaveCount(0);
});

test("invite acceptance opens the workspace returned by the backend", async ({ page }) => {
  const inviteId = "invite-token";
  const acceptedWorkspaceId = "accepted-workspace";

  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === "GET" && path === `/invites/${inviteId}`) {
      await fulfillJson(route, {
        token: inviteId,
        workspaceName: "Invited Workspace",
        role: "EDITOR",
        invitedByName: "Workspace Owner",
        expiresAt: "2027-01-01T00:00:00.000Z",
        expired: false,
      });
      return;
    }
    if (request.method() === "GET" && path === "/auth/me") {
      await fulfillJson(route, user);
      return;
    }
    if (request.method() === "POST" && path === `/invites/${inviteId}/accept`) {
      await fulfillJson(route, {
        workspaceId: acceptedWorkspaceId,
        workspaceName: "Invited Workspace",
        role: "EDITOR",
        alreadyMember: false,
      });
      return;
    }
    if (request.method() === "GET" && path === "/workspaces") {
      await fulfillJson(route, [
        {
          id: acceptedWorkspaceId,
          name: "Invited Workspace",
          ownerId: "owner-1",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      return;
    }
    if (
      request.method() === "GET" &&
      path === `/workspaces/${acceptedWorkspaceId}/members`
    ) {
      await fulfillJson(route, [
        {
          id: "member-1",
          workspaceId: acceptedWorkspaceId,
          userId: user.id,
          role: "EDITOR",
          createdAt: NOW,
        },
      ]);
      return;
    }
    if (
      request.method() === "GET" &&
      path === `/workspaces/${acceptedWorkspaceId}/documents/tree`
    ) {
      await fulfillJson(route, []);
      return;
    }

    await route.abort("connectionrefused");
  });

  await page.goto(`/invite/${inviteId}`);
  await expect(page.getByRole("heading", { name: 'Join "Invited Workspace"' })).toBeVisible();
  await page.getByRole("button", { name: /Accept & Open Workspace/ }).click();

  await expect(page).toHaveURL(`/workspace/${acceptedWorkspaceId}`);
  await page.waitForSelector(
    '[data-testid="workspace-root"][data-backend-status="available"]',
  );
});
