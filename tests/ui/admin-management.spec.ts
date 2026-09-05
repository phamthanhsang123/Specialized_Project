import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("sentinel.access-token", "mock");
    localStorage.setItem("sentinel.language", "vi");
  });
  const date = "2026-09-01T09:30:00";
  const admin = {
    id: "admin",
    role: "admin",
    email: "admin@example.com",
    fullName: "Quản trị viên",
    isActive: true,
  };
  const users = Array.from({ length: 12 }, (_, i) => ({
    id: "u" + i,
    role: "developer",
    email: "dev" + i + "@example.com",
    fullName: i === 0 ? "Nguyễn Ánh" : "Developer " + i,
    isActive: true,
    mustChangePassword: false,
    projectCount: 1,
    issueCount: 2,
    createdAt: date,
    updatedAt: date,
  }));
  const projects = [
    {
      id: "p1",
      name: "Thanh toán an toàn",
      ownerName: users[0].fullName,
      ownerId: "u0",
      language: "Python",
      version: "v2",
      updatedAt: date,
      issueCount: 2,
    },
  ];
  const events = [
    {
      id: "e1",
      action: "USER_UPDATED",
      actorName: admin.fullName,
      actorId: "admin",
      projectName: null,
      createdAt: date,
      detail: {
        email: users[0].email,
        full_name: users[0].fullName,
        previous_email: "old@example.com",
      },
    },
  ];
  const writes: { path: string; data: Record<string, unknown> }[] = [];
  const queries: URLSearchParams[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace("/api", ""),
      method = route.request().method();
    if (method !== "GET")
      writes.push({ path, data: route.request().postDataJSON() || {} });
    if (path === "/auth/me") return route.fulfill({ json: admin });
    if (path === "/admin/overview")
      return route.fulfill({
        json: { users, projects, activities: [], metrics: {} },
      });
    if (path === "/admin/projects/p1")
      return route.fulfill({
        json: {
          ...projects[0],
          createdAt: date,
          latestTest: {
            version: "v1",
            status: "PASS",
            total: 8,
            passed: 8,
            failed: 0,
            errors: 0,
            createdAt: date,
          },
        },
      });
    if (path === "/admin/activities") {
      queries.push(url.searchParams);
      return route.fulfill({
        json: {
          items: events,
          total: 1,
          page: 1,
          pageSize: 10,
          actors: [{ id: "admin", name: admin.fullName }],
          actions: ["USER_UPDATED", "PASSWORD_RESET"],
        },
      });
    }
    if (path === "/admin/users/u0/profile") {
      const data = route.request().postDataJSON();
      if (data.email === users[1].email)
        return route.fulfill({
          status: 409,
          json: { detail: "Email đã được sử dụng" },
        });
      Object.assign(users[0], data);
      return route.fulfill({ json: users[0] });
    }
    if (path === "/admin/users/u0/reset-password") {
      users[0].mustChangePassword = true;
      return route.fulfill({ json: users[0] });
    }
    if (path === "/admin/users/u0") {
      users[0].isActive = route.request().postDataJSON().isActive;
      return route.fulfill({ json: users[0] });
    }
    throw Error("Unexpected route " + method + " " + path);
  });
  return { errors, writes, queries };
}

test("user pagination, details and duplicate email validation", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/admin");
  await expect(page.locator(".admin-name-link")).toHaveCount(10);
  await page.getByRole("button", { name: "Trang sau", exact: true }).click();
  await expect(page.locator(".admin-name-link")).toHaveCount(2);
  await page.getByLabel("Tìm Developer").fill("Nguyễn");
  await expect(page.locator(".admin-name-link")).toHaveCount(1);
  await page.getByRole("button", { name: "Xem tài khoản Nguyễn Ánh" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("Ngày tạo");
  await drawer
    .getByRole("button", { name: "Chỉnh sửa tài khoản", exact: true })
    .click();
  await drawer.getByLabel("Email", { exact: true }).fill("dev1@example.com");
  await drawer
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await expect(drawer.getByRole("alert")).toHaveText("Email đã được sử dụng");
  await drawer.getByLabel("Email", { exact: true }).fill("anh@example.com");
  await drawer.getByLabel("Họ và tên", { exact: true }).fill("Nguyễn Ánh Mới");
  await drawer
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await expect(drawer).toHaveCount(0);
  await expect(
    page.getByText("anh@example.com", { exact: true }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("lock can be cancelled; reset validates confirmation and flags next login", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/admin");
  const row = page.locator(".user-row").filter({ hasText: "Nguyễn Ánh" });
  await row.getByRole("button", { name: "Khóa", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("dev0@example.com");
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Xem tài khoản Nguyễn Ánh" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đặt lại mật khẩu", exact: true })
    .click();
  await page.getByLabel("Mật khẩu tạm", { exact: true }).fill("temporary-123");
  await page
    .getByLabel("Xác nhận mật khẩu tạm", { exact: true })
    .fill("different-123");
  await page
    .getByRole("button", { name: "Xác nhận đặt lại mật khẩu", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Mật khẩu xác nhận không khớp",
  );
  expect(state.writes).toHaveLength(0);
  await page
    .getByLabel("Xác nhận mật khẩu tạm", { exact: true })
    .fill("temporary-123");
  await page
    .getByRole("button", { name: "Xác nhận đặt lại mật khẩu", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Cần đổi mật khẩu", { exact: true }),
  ).toBeVisible();
  expect(state.writes[0].data).toEqual({ temporaryPassword: "temporary-123" });
  await row.getByRole("button", { name: "Khóa", exact: true }).click();
  await page.getByLabel("Lý do (không bắt buộc)").fill("Tạm ngừng");
  await page
    .getByRole("button", { name: "Xác nhận khóa", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mở khóa", exact: true }),
  ).toBeVisible();
  expect(state.writes[1].data).toEqual({
    isActive: false,
    reason: "Tạm ngừng",
  });
  expect(state.errors).toEqual([]);
});

test("project filters and read-only details fit mobile in both languages", async ({
  page,
}) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Dự án", exact: true })
    .click();
  await page.getByLabel("Tìm dự án").fill("no match");
  await expect(page.getByText("Không tìm thấy dự án phù hợp.")).toBeVisible();
  await page.getByLabel("Tìm dự án").clear();
  await page.getByLabel("Chủ sở hữu", { exact: true }).selectOption("u0");
  await page.locator(".admin-project-button").click();
  await expect(page.getByRole("dialog")).toContainText("8 / 8");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/admin-project-mobile-new.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.getByLabel("Ngôn ngữ").selectOption("en");
  await page.locator(".admin-project-button").click();
  await expect(
    page.getByRole("heading", { name: "Project details", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Latest test");
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("activity filters reach server and show readable event details", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/admin");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Nhật ký hoạt động" })
    .click();
  await page
    .getByLabel("Người thực hiện", { exact: true })
    .selectOption("admin");
  await page
    .getByLabel("Hành động", { exact: true })
    .selectOption("USER_UPDATED");
  await page.getByLabel("Từ ngày").fill("2026-09-01");
  await page.getByLabel("Đến ngày").fill("2026-09-02");
  await expect(page.locator(".admin-activity-button")).toBeVisible();
  await expect.poll(() => state.queries.at(-1)?.get("date_to")).toBeTruthy();
  expect(state.queries.at(-1)?.get("actor_id")).toBe("admin");
  expect(state.queries.at(-1)?.get("action")).toBe("USER_UPDATED");
  await page.locator(".admin-activity-button").click();
  await expect(page.getByRole("dialog")).toContainText("old@example.com");
  await page.keyboard.press("Escape");
  await page.getByLabel("Từ ngày").fill("2026-09-03");
  await expect(page.locator("#activities").getByRole("alert")).toHaveText(
    "Khoảng ngày không hợp lệ",
  );
  await page.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
  await expect(page.locator(".admin-activity-button")).toBeVisible();
  await page.screenshot({
    path: "test-results/admin-activities-new.png",
    fullPage: true,
  });
  expect(state.errors).toEqual([]);
});

test("temporary password redirects to mandatory change before workspace access", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("sentinel.access-token", "temp");
    localStorage.setItem("sentinel.language", "vi");
  });
  let submissions = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: "u1",
          role: "developer",
          email: "dev@example.com",
          fullName: "Developer",
          isActive: true,
          mustChangePassword: true,
        },
      });
    if (path === "/api/auth/change-password") {
      submissions++;
      expect(route.request().postDataJSON()).toEqual({
        currentPassword: "temporary-123",
        newPassword: "private-123",
      });
      return route.fulfill({ json: { message: "ok" } });
    }
    throw Error("No project requests are allowed: " + path);
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/change-password$/);
  await page
    .getByLabel("Mật khẩu hiện tại", { exact: true })
    .fill("temporary-123");
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill("private-123");
  await page
    .getByLabel("Xác nhận mật khẩu mới", { exact: true })
    .fill("wrong-123");
  await page
    .getByRole("button", { name: "Lưu mật khẩu mới", exact: true })
    .click();
  await expect(page.locator(".password-card").getByRole("alert")).toHaveText(
    "Mật khẩu xác nhận không khớp",
  );
  expect(submissions).toBe(0);
  await page
    .getByLabel("Xác nhận mật khẩu mới", { exact: true })
    .fill("private-123");
  await page
    .getByRole("button", { name: "Lưu mật khẩu mới", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đã đổi mật khẩu", exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("sentinel.access-token")),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Đăng nhập lại", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test("live admin metadata and activity API connect to the UI (opt-in)", async ({
  page,
}) => {
  test.skip(process.env.UI_LIVE_SMOKE !== "1", "Requires seeded local backend");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill("admin@sentinel.local");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Người dùng", exact: true }),
  ).toBeVisible();
  await page.locator(".admin-name-link").first().click();
  await expect(page.getByRole("dialog")).toContainText("Ngày tạo");
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Dự án", exact: true })
    .click();
  await page.locator(".admin-project-button").first().click();
  await expect(page.getByRole("dialog")).toContainText("Kiểm thử gần nhất");
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Nhật ký hoạt động", exact: true })
    .click();
  await expect(page.locator("#activities .admin-pagination")).toBeVisible();
  await expect(page.locator("#activities .admin-inline-error")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/admin-live-activities.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "↪ Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(errors).toEqual([]);
});
