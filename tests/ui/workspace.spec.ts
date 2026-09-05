import { test, expect, type Page } from "@playwright/test";

test("unsaved test is protected on selection, project switch, and logout", async ({
  page,
}) => {
  await workspace(page);
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: [
        { id: "p1", name: "One", language: "Python", version: "v1" },
        { id: "p2", name: "Two", language: "Python", version: "v1" },
      ],
    }),
  );
  await page.route("**/api/projects/p1/test-cases", (route) =>
    route.fulfill({
      json: [
        {
          id: "t1",
          name: "test_saved.py",
          code: "def test_saved(): assert True",
        },
      ],
    }),
  );
  await page.goto("/");
  await page.locator(".project-card").first().click();
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Kiểm thử/ })
    .click();
  const editor = page.locator(".test-case-form textarea");
  await editor.fill("def test_draft(): assert 42");
  await expect(page.getByText("Chưa lưu", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator(".test-case-form select").selectOption("test_saved.py");
  await expect(editor).toHaveValue("def test_draft(): assert 42");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.locator(".breadcrumbs").getByRole("button").click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator(".project-card").filter({ hasText: "Two" }).click();
  await expect(
    page.getByRole("heading", { name: "Dự án của tôi", exact: true }),
  ).toBeVisible();
  await page.locator(".project-card").first().click();
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Kiểm thử/ })
    .click();
  await expect(editor).toHaveValue("def test_draft(): assert 42");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".test-case-form select").selectOption("test_saved.py");
  await expect(editor).toHaveValue("def test_saved(): assert True");
  await expect(page.getByText("Chưa lưu", { exact: true })).toHaveCount(0);
});

test("saved action plus failed refresh locks edits without resubmitting", async ({
  page,
}) => {
  await workspace(page);
  let accepted = 0,
    failRefresh = false;
  await page.route("**/api/issues/i1/accept", async (route) => {
    accepted++;
    failRefresh = true;
    await route.fallback();
  });
  await page.route("**/api/projects/p1/files", async (route) => {
    if (failRefresh)
      await route.fulfill({
        status: 503,
        json: { detail: "Read unavailable" },
      });
    else await route.fallback();
  });
  await page.goto("/");
  await page.locator(".project-card").click();
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Vấn đề & bản sửa/ })
    .click();
  await page
    .getByRole("button", { name: "Chấp nhận bản sửa", exact: true })
    .click();
  await expect(page.locator(".recovery-banner")).toContainText(
    "Thao tác đã được lưu",
  );
  await expect(
    page.getByRole("button", { name: "Chấp nhận bản sửa", exact: true }),
  ).toBeDisabled();
  expect(accepted).toBe(1);
  failRefresh = false;
  await page
    .getByRole("button", { name: "Tải lại dữ liệu", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /Áp dụng 1/ })).toBeEnabled();
  expect(accepted).toBe(1);
  await page.getByRole("button", { name: /Áp dụng 1/ }).click();
  const heading = page.getByRole("heading", { name: "Kiểm thử", exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  expect(await page.locator(".content").evaluate((el) => el.scrollTop)).toBe(0);
});

test("stop waiting and timeout never automatically repeat mutations", async ({
  page,
}) => {
  await workspace(page);
  let calls = 0;
  await page.route("**/api/projects/p1/scan", () => {
    calls++;
  });
  await page.goto("/");
  await page.locator(".project-card").click();
  await page.getByRole("button", { name: "Quét source", exact: true }).click();
  await page.getByRole("button", { name: "Dừng chờ", exact: true }).click();
  await expect(page.locator(".recovery-banner")).toContainText(
    "Chưa xác định kết quả",
  );
  await expect(
    page.getByRole("button", { name: "Quét source", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Tải lại dữ liệu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Quét source", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(1);
});

test("logout leaves immediately when API stalls; login notice follows language", async ({
  page,
}) => {
  await workspace(page);
  await page.route("**/api/auth/logout", () => {});
  await page.goto("/");
  await expect(page.locator(".project-card")).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 3000 });
  expect(
    await page.evaluate(() => localStorage.getItem("sentinel.access-token")),
  ).toBeNull();
  const signedOut = await page.context().newPage();
  await signedOut.goto("http://localhost:3000/login?expired=1");
  await signedOut.getByLabel("Ngôn ngữ").selectOption("en");
  await expect(signedOut.locator(".login-message")).toContainText(
    "Your session has expired",
  );
  await signedOut.getByLabel("Language").selectOption("vi");
  await expect(signedOut.locator(".login-message")).toContainText(
    "Phiên đăng nhập đã hết hạn",
  );
  await signedOut.close();
});

test("admin locks edits until saved data can be refreshed", async ({
  page,
}) => {
  await workspace(page, "admin");
  let fail = false,
    writes = 0;
  await page.route("**/api/admin/users/u1", async (route) => {
    writes++;
    fail = true;
    await route.fallback();
  });
  await page.route("**/api/admin/overview", async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        json: { detail: "Read unavailable" },
      });
    else await route.fallback();
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Khóa", exact: true }).click();
  await page
    .getByRole("button", { name: "Xác nhận khóa", exact: true })
    .click();
  await expect(page.locator(".recovery-banner")).toContainText(
    "Thao tác đã được lưu",
  );
  await expect(
    page.getByRole("button", { name: "Khóa", exact: true }),
  ).toBeDisabled();
  fail = false;
  await page
    .getByRole("button", { name: "Tải lại dữ liệu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mở khóa", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(1);
});

test("live backend sign-in and role routing (opt-in)", async ({ page }) => {
  test.skip(
    process.env.UI_LIVE_SMOKE !== "1",
    "Requires locally seeded demo accounts.",
  );
  for (const role of ["developer", "admin"]) {
    await page.goto(role === "admin" ? "/admin/login" : "/login");
    await page
      .getByLabel("Email", { exact: true })
      .fill(role + "@sentinel.local");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("password");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: role === "admin" ? "Người dùng" : "Dự án của tôi",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Đăng xuất/ }).click();
    await expect(page).toHaveURL(
      role === "admin" ? /\/admin\/login$/ : /\/login$/,
    );
  }
});

test("create, reject and error feedback preserve user control", async ({
  page,
}) => {
  const result = await workspace(page);
  await page.goto("/");
  await page.getByRole("button", { name: "＋ Tạo dự án" }).click();
  await page.getByRole("dialog").getByLabel("Tên project").fill("Dự án mới");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tạo project", exact: true })
    .click();
  await expect(page.locator(".source-workspace")).toBeVisible();
  await expect(page.locator(".breadcrumbs")).toContainText("Dự án mới");
  await page.route("**/api/projects/p1/scan", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Analysis service temporarily unavailable" },
    }),
  );
  await page.getByRole("button", { name: "Quét source", exact: true }).click();
  await expect(page.locator(".toast-error")).toContainText(
    "Analysis service temporarily unavailable",
  );
  await expect(page.locator(".source-workspace")).toBeVisible();
  await page
    .getByRole("button", { name: "Tải lại dữ liệu", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "Đã kiểm tra kết quả, mở lại thao tác",
      exact: true,
    })
    .click();
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Vấn đề & bản sửa/ })
    .click();
  await page.getByRole("button", { name: "Từ chối", exact: true }).click();
  await expect(page.locator(".decision")).toHaveText("Đã từ chối");
  await expect(page.getByRole("button", { name: /Áp dụng 0/ })).toBeDisabled();
  expect(result.errors).toEqual([]);
});

test("test comparison and save test use backend data; admin and login fit mobile", async ({
  page,
}) => {
  const result = await workspace(page);
  await page.route("**/api/projects/p1/test-runs", (route) =>
    route.fulfill({
      json: [
        {
          id: "r2",
          version: "v2",
          status: "PASS",
          total: 3,
          passed: 3,
          failed: 0,
          errors: 0,
          duration: "1s",
          createdAt: "2026-09-05T10:00:00Z",
        },
        {
          id: "r1",
          version: "v1",
          status: "FAIL",
          total: 3,
          passed: 2,
          failed: 1,
          errors: 0,
          duration: "2s",
          createdAt: "2026-09-05T09:00:00Z",
        },
      ],
    }),
  );
  await page.goto("/");
  await page.locator(".project-card").click();
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Kiểm thử/ })
    .click();
  await expect(page.locator(".comparison-cards article")).toHaveCount(2);
  await expect(page.locator(".comparison-cards article").last()).toContainText(
    "3/3 đạt",
  );
  await page
    .getByLabel("Nội dung pytest", { exact: true })
    .fill("def test_ok():\n    assert True");
  const saved = page.waitForRequest(
    (request) =>
      request.url().endsWith("/test-cases") && request.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Lưu test case", exact: true })
    .click();
  expect((await saved).postDataJSON().code).toContain("assert True");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Đã lưu test case vào project." }),
  ).toBeVisible();
  await page.getByLabel("Ngôn ngữ").selectOption("en");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Test case saved to the project." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/tests-en.png", fullPage: true });
  expect(result.errors).toEqual([]);
});

test("admin and login remain readable at mobile width", async ({ page }) => {
  await workspace(page, "admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Người dùng", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/admin-mobile.png",
    fullPage: true,
  });
  const lock = page.getByRole("button", { name: "Khóa", exact: true });
  await lock.scrollIntoViewIfNeeded();
  await expect(lock).toBeInViewport({ ratio: 1 });
  await page.getByRole("button", { name: /Đăng xuất/ }).click();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập quản trị" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/login-mobile.png",
    fullPage: true,
  });
});

// API fixtures are intercepted: UI tests never overwrite the user's projects.
async function workspace(page: Page, role = "developer") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem("sentinel.access-token", "ui-test-token"),
  );
  const now = "2026-09-05T08:00:00Z";
  const user = {
    id: "u1",
    fullName: "Nguyễn Văn An",
    email: "an@example.com",
    role,
    isActive: true,
  };
  const project = {
    id: "p1",
    name: "Payment API",
    language: "Python 3.12",
    version: "v1",
    updatedAt: now,
  };
  let projects = [project];
  let state = "PENDING";
  let uploaded = false;
  const issue = () => ({
    id: "i1",
    filePath: "payment.py",
    lineStart: 2,
    lineEnd: 2,
    ruleCode: "SEC-001",
    type: "Unsafe input",
    description: "Input needs validation.",
    explanation: "Validate the amount before processing.",
    impact: "Unexpected values may fail.",
    confidence: null,
    severity: "HIGH",
    status: state,
  });
  const developer = {
    ...user,
    role: "developer",
    projectCount: 1,
    issueCount: 1,
    updatedAt: now,
    createdAt: now,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api", "");
    const method = route.request().method();
    let result: unknown = {};
    if (path === "/auth/me") result = user;
    else if (path === "/capabilities")
      result = { aiConfigured: false, analysisModes: ["static"] };
    else if (path === "/projects" && method === "GET") result = projects;
    else if (path === "/projects" && method === "POST") {
      project.name = route.request().postDataJSON().name;
      projects = [project];
      result = project;
    } else if (path === "/projects/p1") result = project;
    else if (path.endsWith("/files/content"))
      result = {
        path: "payment.py",
        content: "# Tiếng Việt\ndef charge(amount):\n    return amount / 0",
      };
    else if (path.endsWith("/files"))
      result = [
        { id: "f1", path: "payment.py", sizeBytes: 80, updatedAt: now },
      ];
    else if (path.endsWith("/issues")) result = [issue()];
    else if (path === "/issues/i1")
      result = {
        issue: issue(),
        proposal: {
          issueId: "i1",
          originalCode: "return amount / 0",
          replacementCode: "return amount",
          reason: "Avoid division by zero.",
        },
      };
    else if (path.endsWith("/test-runs")) result = [];
    else if (path.endsWith("/test-cases")) result = [];
    else if (path.endsWith("/versions"))
      result = [
        { id: "v2", version: project.version, createdAt: now },
        { id: "v0", version: "v0", createdAt: now },
      ];
    else if (path.endsWith("/accept")) state = "ACCEPTED";
    else if (path.endsWith("/reject")) state = "REJECTED";
    else if (path.endsWith("/apply")) {
      state = "APPLIED";
      project.version = "v2";
    } else if (path.endsWith("/upload")) {
      uploaded = true;
      project.version = "v2";
    } else if (path.endsWith("/rollback")) project.version = "v3";
    else if (path === "/admin/overview")
      result = {
        users: [developer],
        projects: [
          {
            ...project,
            ownerName: user.fullName,
            ownerId: user.id,
            issueCount: 1,
          },
        ],
        activities: [
          {
            id: "a1",
            actorName: user.fullName,
            action: "Created project",
            projectName: project.name,
            createdAt: now,
          },
        ],
        metrics: {},
      };
    else if (path === "/admin/activities")
      result = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        actors: [],
        actions: [],
      };
    else if (path === "/admin/users/u1" && method === "PATCH")
      developer.isActive = route.request().postDataJSON().isActive;
    else if (
      ![
        "/auth/logout",
        "/projects/p1/scan",
        "/projects/p1/test",
        "/admin/users",
      ].includes(path)
    ) {
      throw new Error("Unexpected API route: " + method + " " + path);
    }
    await route.fulfill({ json: result });
  });
  return { errors, uploaded: () => uploaded };
}

test("language toggle translates login immediately and persists after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Đăng nhập không gian làm việc" }),
  ).toBeVisible();
  await page.getByLabel("Ngôn ngữ").selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/login-en.png", fullPage: true });
  await page.getByLabel("Language").selectOption("vi");
  await expect(
    page.getByRole("heading", { name: "Đăng nhập không gian làm việc" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("projects first, separate steps, review and apply, filtering and logout", async ({
  page,
}) => {
  const result = await workspace(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Dự án của tôi" }),
  ).toBeVisible();
  await expect(page.locator(".source-workspace")).toHaveCount(0);
  await page.locator(".project-card").click();
  await expect(page.locator(".source-workspace")).toBeVisible();
  await expect(page.locator(".review-workspace")).toHaveCount(0);
  await page.getByRole("button", { name: "Quét source", exact: true }).click();
  await expect(page.locator(".review-workspace")).toBeVisible();
  await page.getByRole("tab", { name: "So sánh bản sửa" }).click();
  await expect(page.locator(".diff")).toBeVisible();
  await page
    .getByRole("button", { name: "Chấp nhận bản sửa", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /Áp dụng 1/ })).toBeEnabled();
  await page.getByRole("button", { name: /Áp dụng 1/ }).click();
  await expect(page.locator(".testing-workspace")).toBeVisible();
  await expect(page.locator(".review-workspace")).toHaveCount(0);
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Lịch sử/ })
    .click();
  await expect(page.locator(".history-workspace")).toBeVisible();
  await page.getByRole("button", { name: /Khôi phục nội dung v0/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Hủy" }).click();
  // Reopening the same project must not leave a blank workspace.
  await page.locator(".breadcrumbs").getByRole("button").click();
  await page.locator(".project-card").click();
  await expect(page.locator(".source-workspace")).toBeVisible();
  await page.getByLabel("Ngôn ngữ").selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Source code", exact: true }),
  ).toBeVisible();
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Issues & fixes/ })
    .click();
  await page.getByLabel("Filter by severity").selectOption("HIGH");
  await expect(page.locator(".issue-card")).toHaveCount(1);
  await expect(page.locator(".severity")).toHaveText("High");
  await page
    .getByLabel("Search issues", { exact: true })
    .fill("no matching issue");
  await expect(page.locator(".issue-card")).toHaveCount(0);
  await expect(page.locator(".proposal-panel h2")).toHaveCount(0);
  await page.getByLabel("Search issues", { exact: true }).clear();
  await page.screenshot({ path: "test-results/review-en.png", fullPage: true });
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(result.errors).toEqual([]);
});

test("upload confirmation, modal keyboard, fixed sidebar and narrow viewport", async ({
  page,
}) => {
  const result = await workspace(page);
  await page.goto("/");
  await page.getByRole("button", { name: "＋ Tạo dự án" }).click();
  await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".project-card").click();
  await page
    .getByLabel("Tải một hoặc nhiều tệp Python, hoặc một tệp ZIP")
    .setInputFiles({
      name: "payment.py",
      mimeType: "text/x-python",
      buffer: Buffer.from("# Mã nguồn tiếng Việt\nx = 1"),
    });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Tải và thay source" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(result.uploaded()).toBe(true);
  const before = await page.locator(".sidebar").boundingBox();
  await page.locator(".content").evaluate((el) => {
    el.scrollTop = 10000;
  });
  const after = await page.locator(".sidebar").boundingBox();
  expect(after?.y).toEqual(before?.y);
  await expect(
    page.getByRole("button", { name: "Đăng xuất", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: "test-results/source-vi.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".source-workspace")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile-vi.png", fullPage: true });
  expect(result.errors).toEqual([]);
});

test("admin only displays chosen section, can filter and lock users", async ({
  page,
}) => {
  const result = await workspace(page, "admin");
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Người dùng", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".admin-stats")).toHaveCount(0);
  await expect(page.locator("#projects")).not.toBeVisible();
  await page.getByRole("button", { name: "Khóa", exact: true }).click();
  await page
    .getByRole("button", { name: "Xác nhận khóa", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mở khóa", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Tìm Developer").fill("unmatched");
  await expect(
    page.getByText("Không tìm thấy tài khoản phù hợp."),
  ).toBeVisible();
  await page.getByLabel("Tìm Developer").clear();
  await page.getByLabel("Ngôn ngữ").selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "＋ Add developer" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/admin-en.png", fullPage: true });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await expect(page.locator("#users")).not.toBeVisible();
  await expect(page.locator("#projects")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Activity log" })
    .click();
  await expect(page.locator("#projects")).not.toBeVisible();
  await expect(page.locator("#activities")).toBeVisible();
  expect(result.errors).toEqual([]);
});
