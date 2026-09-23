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
  await page.getByRole("tab", { name: /Quản lý trường hợp kiểm thử/ }).click();
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
  await page.getByRole("tab", { name: /Quản lý trường hợp kiểm thử/ }).click();
  await expect(editor).toHaveValue("def test_draft(): assert 42");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".test-case-form select").selectOption("test_saved.py");
  await expect(editor).toHaveValue("def test_saved(): assert True");
  await expect(page.getByText("Chưa lưu", { exact: true })).toHaveCount(0);
});

test("applied action plus failed refresh locks edits without resubmitting", async ({
  page,
}) => {
  await workspace(page);
  let applied = 0,
    failRefresh = false;
  await page.route("**/api/projects/p1/apply", async (route) => {
    applied++;
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
  await page.getByRole("button", { name: /Áp dụng 1/ }).click();
  await expect(page.locator(".recovery-banner")).toContainText(
    "Thao tác đã được lưu",
  );
  await expect(
    page.getByRole("button", { name: "Tải lại dữ liệu", exact: true }),
  ).toBeVisible();
  expect(applied).toBe(1);
  failRefresh = false;
  await page
    .getByRole("button", { name: "Tải lại dữ liệu", exact: true })
    .click();
  expect(applied).toBe(1);
  await expect(page.locator(".recovery-banner")).toHaveCount(0);
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
  await page
    .getByRole("button", { name: "Phân tích mã nguồn", exact: true })
    .click();
  await page.getByRole("button", { name: "Dừng chờ", exact: true }).click();
  await expect(page.locator(".recovery-banner")).toContainText(
    "Chưa xác định kết quả",
  );
  await expect(
    page.getByRole("button", { name: "Phân tích mã nguồn", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Tải lại dữ liệu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Phân tích mã nguồn", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(1);
});

test("logout leaves immediately when API stalls and notice stays Vietnamese", async ({
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
  await expect(signedOut.locator(".login-message")).toContainText(
    "Phiên đăng nhập đã hết hạn",
  );
  await expect(signedOut.locator("html")).toHaveAttribute("lang", "vi");
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
  await page.getByRole("dialog").getByLabel("Tên dự án").fill("Dự án mới");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tạo dự án", exact: true })
    .click();
  await expect(page.locator(".source-workspace")).toBeVisible();
  await expect(page.locator(".breadcrumbs")).toContainText("Dự án mới");
  await page.route("**/api/projects/p1/scan", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Analysis service temporarily unavailable" },
    }),
  );
  await page
    .getByRole("button", { name: "Phân tích mã nguồn", exact: true })
    .click();
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
  await expect(page.locator(".proposal-title-line .status")).toHaveText(
    "Đã từ chối",
  );
  await expect(page.locator(".apply-section")).toBeHidden();
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
  await page.getByRole("tab", { name: /Quản lý trường hợp kiểm thử/ }).click();
  await page
    .getByLabel("Nội dung pytest", { exact: true })
    .fill("def test_ok():\n    assert True");
  const saved = page.waitForRequest(
    (request) =>
      request.url().endsWith("/test-cases") && request.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Lưu trường hợp kiểm thử", exact: true })
    .click();
  expect((await saved).postDataJSON().code).toContain("assert True");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Đã lưu trường hợp kiểm thử vào dự án." }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/tests-vi.png", fullPage: true });
  expect(result.errors).toEqual([]);
});

test("web preview sends runtime settings and shows before and after", async ({
  page,
}) => {
  const result = await workspace(page, "developer", "JavaScript");
  await page.route("**/api/capabilities", (route) =>
    route.fulfill({
      json: {
        aiConfigured: false,
        analysisModes: ["static"],
        aiProviders: [],
        defaultAiProvider: null,
        sandboxImage: "sentinel-test-runner:local",
        previewConfigured: true,
        previewProvider: "Daytona",
        previewTtlMinutes: 30,
      },
    }),
  );
  await page.route("https://preview.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<main><h1>Ứng dụng đang chạy</h1></main>",
    }),
  );
  let payload: Record<string, unknown> | undefined;
  let stopped = false;
  await page.route("**/api/projects/p1/preview-comparisons", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        sessionId: "preview-1",
        provider: "Daytona",
        expiresAt: "2026-09-05T08:30:00Z",
        before: {
          label: "before",
          version: "v1",
          url: "https://preview.example/before",
        },
        after: {
          label: "after",
          version: "v2",
          url: "https://preview.example/after",
        },
      },
    });
  });
  await page.route(
    "**/api/projects/p1/preview-comparisons/preview-1",
    async (route) => {
      stopped = true;
      await route.fulfill({ status: 204, body: "" });
    },
  );

  await page.goto("/");
  await page.locator(".project-card").click();
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Kiểm thử/ })
    .click();
  await page.getByRole("tab", { name: /Xem trước giao diện/ }).click();
  await page.getByRole("button", { name: "Chạy xem trước/sau" }).click();

  await expect(page.locator(".preview-frame-card iframe")).toHaveCount(2);
  expect(payload).toEqual({
    runtime: "javascript",
    installCommand: "npm install",
    startCommand: "npm run dev -- --host 0.0.0.0",
    port: 3000,
  });
  await expect(
    page.getByRole("link", { name: "Mở toàn màn hình" }),
  ).toHaveCount(2);
  await expect(page.getByText("Nếu Daytona hiện cảnh báo")).toBeVisible();
  await page.screenshot({
    path: "test-results/preview-comparison.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Dừng bản xem trước" }).click();
  await expect(page.locator(".preview-frame-card")).toHaveCount(0);
  expect(stopped).toBe(true);
  expect(result.errors).toEqual([]);
});

test("JavaScript opens interface preview instead of pytest", async ({
  page,
}) => {
  const result = await workspace(page, "developer", "JavaScript");
  await page.goto("/");
  await page.locator(".project-card").click();
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Kiểm thử/ })
    .click();

  await expect(
    page.getByRole("tab", { name: /Xem trước giao diện/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Chạy kiểm thử", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: /Quản lý trường hợp kiểm thử/ }),
  ).toHaveCount(0);
  await expect(page.getByText("Kiểm tra dự án web")).toBeVisible();
  await expect(page.getByLabel("Môi trường chạy")).toHaveValue("javascript");
  expect(result.errors).toEqual([]);
});

test("source page fits the viewport and long code scrolls inside its panel", async ({
  page,
}) => {
  const result = await workspace(page);
  const longSource = Array.from(
    { length: 300 },
    (_, index) => `value_${index + 1} = ${index + 1}`,
  ).join("\n");
  await page.route("**/api/projects/p1/files/content*", (route) =>
    route.fulfill({
      json: { path: "payment.py", content: longSource },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/");
  await page.locator(".project-card").click();
  await expect(page.locator(".code-line")).toHaveCount(300);
  await expect(
    page.getByText("Kết quả phân tích sẽ xuất hiện trong Vấn đề & bản sửa."),
  ).toHaveCount(0);

  const analyzeButton = await page
    .getByRole("button", { name: "Phân tích mã nguồn" })
    .boundingBox();
  const uploadButton = await page
    .getByText("Tải tệp", { exact: true })
    .boundingBox();
  expect(analyzeButton).not.toBeNull();
  expect(uploadButton).not.toBeNull();
  expect(Math.abs(analyzeButton!.y - uploadButton!.y)).toBeLessThanOrEqual(1);

  const metrics = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".content");
    const code = document.querySelector<HTMLElement>(".code-view");
    if (!content || !code) throw new Error("Missing source layout");
    return {
      contentClientHeight: content.clientHeight,
      contentScrollHeight: content.scrollHeight,
      codeClientHeight: code.clientHeight,
      codeScrollHeight: code.scrollHeight,
      contentOverflowY: getComputedStyle(content).overflowY,
      codeOverflowY: getComputedStyle(code).overflowY,
    };
  });
  expect(metrics.contentOverflowY).toBe("hidden");
  expect(metrics.contentScrollHeight).toBeLessThanOrEqual(
    metrics.contentClientHeight + 1,
  );
  expect(metrics.codeOverflowY).toBe("auto");
  expect(metrics.codeScrollHeight).toBeGreaterThan(metrics.codeClientHeight);
  await page.screenshot({
    path: "test-results/source-fits-viewport.png",
    fullPage: true,
  });
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

test("quét AI dùng nhà cung cấp mặc định của backend", async ({ page }) => {
  await workspace(page);
  let requestedProvider: string | null = null;
  await page.route("**/api/capabilities", (route) =>
    route.fulfill({
      json: {
        aiConfigured: true,
        analysisModes: ["static", "ai"],
        aiProviders: [
          {
            id: "gemini",
            name: "Google Gemini",
            model: "gemini-3.5-flash-lite",
            configured: true,
            freeTier: true,
          },
          {
            id: "openai",
            name: "OpenAI",
            model: "gpt-5.6-luna",
            configured: true,
            freeTier: false,
          },
        ],
        defaultAiProvider: "gemini",
        sandboxImage: "sentinel-test-runner:local",
      },
    }),
  );
  await page.route("**/api/projects/p1/ai-scan*", (route) => {
    requestedProvider = new URL(route.request().url()).searchParams.get(
      "provider",
    );
    return route.fulfill({ json: { projectId: "p1", issues: [] } });
  });
  await page.goto("/");
  await page.locator(".project-card").click();
  await page.addStyleTag({
    content: ".source-workspace .code-panel { height: 1800px !important; }",
  });
  await expect(page.getByLabel("Chế độ phân tích")).toHaveCount(0);
  await expect(page.getByLabel("Nhà cung cấp AI")).toHaveCount(0);
  await page.getByRole("button", { name: "Phân tích mã nguồn" }).click();
  await expect(page.locator(".ai-scan-stage.scanning")).toContainText(
    "AI đang phân tích mã nguồn",
  );
  await expect(page.locator(".source-workspace")).toBeHidden();
  const scanViewport = await page.locator(".content").evaluate((element) => {
    const content = element as HTMLElement;
    content.scrollTop = 9999;
    return {
      clientHeight: content.clientHeight,
      scrollHeight: content.scrollHeight,
      scrollTop: content.scrollTop,
      overflowY: getComputedStyle(content).overflowY,
    };
  });
  expect(scanViewport.overflowY).toBe("hidden");
  expect(scanViewport.scrollTop).toBe(0);
  expect(scanViewport.scrollHeight).toBeLessThanOrEqual(
    scanViewport.clientHeight + 1,
  );
  const scanStage = await page.locator(".ai-scan-stage.scanning").boundingBox();
  expect(scanStage).not.toBeNull();
  expect(scanStage!.height).toBeLessThanOrEqual(
    (page.viewportSize()?.height ?? 720) - 95,
  );
  await expect.poll(() => requestedProvider).toBeNull();
  await expect(page.locator(".ai-scan-stage.success")).toContainText(
    "Phân tích hoàn tất",
  );
  await expect(page.locator(".review-workspace")).toBeVisible();
});

// API fixtures are intercepted: UI tests never overwrite the user's projects.
async function workspace(
  page: Page,
  role = "developer",
  language = "Python 3.12",
) {
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
    language,
    version: "v1",
    lastScannedVersion: "v1",
    sourceFileCount: 1,
    issueCount: 1,
    pendingIssueCount: 1,
    latestTestStatus: null,
    updatedAt: now,
  };
  let projects = [project];
  let deletedProjects: Array<typeof project & { deletedAt: string }> = [];
  let state = "PENDING";
  let uploaded = false;
  let projectLoadCount = 0;
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
      result = {
        aiConfigured: false,
        analysisModes: ["static"],
        aiProviders: [
          {
            id: "gemini",
            name: "Google Gemini",
            model: "gemini-3.5-flash-lite",
            configured: false,
            freeTier: true,
          },
        ],
        defaultAiProvider: null,
        sandboxImage: "sentinel-test-runner:local",
        previewConfigured: false,
        previewProvider: "Daytona",
        previewTtlMinutes: 30,
      };
    else if (path === "/projects" && method === "GET") result = projects;
    else if (path === "/projects/deleted" && method === "GET")
      result = deletedProjects;
    else if (path === "/projects" && method === "POST") {
      project.name = route.request().postDataJSON().name;
      projects = [project];
      result = project;
    } else if (path === "/projects/p1" && method === "PATCH") {
      project.name = route.request().postDataJSON().name;
      result = project;
    } else if (path === "/projects/p1" && method === "DELETE") {
      deletedProjects = [{ ...project, deletedAt: now }];
      projects = [];
      result = {};
    } else if (path === "/projects/p1/restore" && method === "POST") {
      projects = [project];
      deletedProjects = [];
      result = { ...project, deletedAt: null };
    } else if (path === "/projects/p1/permanent" && method === "DELETE") {
      deletedProjects = [];
      result = {};
    } else if (path === "/projects/p1") {
      projectLoadCount += 1;
      result = project;
    } else if (path.endsWith("/files/content"))
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
    else if (path.endsWith("/versions/v0/diff"))
      result = {
        version: "v0",
        comparedWith: null,
        changedFiles: [{ path: "payment.py", change: "ADDED" }],
        diff: "--- a/payment.py\n+++ b/payment.py",
      };
    else if (path.endsWith("/versions"))
      result = [
        {
          id: "v2",
          version: project.version,
          createdAt: now,
          reason: "FIX_APPLIED",
          fileCount: 1,
          changedFileCount: 1,
          createdBy: user.id,
        },
        {
          id: "v0",
          version: "v0",
          createdAt: now,
          reason: "INITIAL",
          fileCount: 1,
          changedFileCount: 1,
        },
      ];
    else if (path.endsWith("/accept")) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      state = "ACCEPTED";
      result = { issue: issue() };
    } else if (path.endsWith("/reject")) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      state = "REJECTED";
      result = { issue: issue() };
    } else if (path.endsWith("/apply")) {
      state = "APPLIED";
      project.version = "v2";
    } else if (path.endsWith("/upload")) {
      uploaded = true;
      project.version = "v2";
      project.lastScannedVersion = "v1";
    } else if (path.endsWith("/rollback")) project.version = "v3";
    else if (path.endsWith("/scan"))
      project.lastScannedVersion = project.version;
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
  return {
    errors,
    uploaded: () => uploaded,
    projectLoads: () => projectLoadCount,
  };
}

test("quick demo login sends the correct account for each role", async ({
  page,
}) => {
  for (const role of ["developer", "admin"] as const) {
    const user = {
      id: role,
      role,
      email: `${role}@sentinel.local`,
      fullName: role === "admin" ? "System Admin" : "Demo Developer",
      isActive: true,
      mustChangePassword: false,
    };
    let credentials: Record<string, string> | undefined;
    await page.route("**/api/auth/login", async (route) => {
      credentials = route.request().postDataJSON();
      await route.fulfill({ json: { token: "demo-token", user } });
    });
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({ json: user }),
    );
    await page.goto(role === "admin" ? "/admin/login" : "/login");
    const quickButton = page.getByRole("button", {
      name:
        role === "admin"
          ? "Vào nhanh bằng tài khoản quản trị mẫu"
          : "Vào nhanh bằng tài khoản lập trình viên mẫu",
    });
    const destination = role === "admin" ? /\/admin$/ : /\/$/;
    const navigated = page.waitForURL(destination);
    await quickButton.click();
    const thinkingButton = page.locator(".demo-login-button");
    await expect(thinkingButton).toBeDisabled();
    await expect(thinkingButton).toContainText("Đang suy nghĩ…");
    await expect(thinkingButton.locator(".thinking-spinner")).toBeVisible();
    await navigated;
    expect(credentials).toEqual({
      email: `${role}@sentinel.local`,
      password: "password",
    });
    await page.evaluate(() => localStorage.clear());
    await page.unroute("**/api/auth/login");
    await page.unroute("**/api/auth/me");
  }
});

test("interface stays Vietnamese even when an old English preference exists", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("sentinel.language", "en");
  });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Đăng nhập không gian làm việc" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.getByLabel("Ngôn ngữ")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Đăng nhập không gian làm việc" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await page.screenshot({ path: "test-results/login-vi.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("developer can rename an owned project from its card", async ({
  page,
}) => {
  const result = await workspace(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Đổi tên dự án Payment API" }).click();
  const dialog = page.locator(".swal2-popup");
  await expect(dialog).toContainText("Đổi tên dự án");
  const input = dialog.locator("#swal2-input");
  await expect(input).toHaveValue("Payment API");

  await dialog
    .getByRole("button", { name: "Lưu tên mới", exact: true })
    .click();
  await expect(dialog).toContainText("Tên mới phải khác tên hiện tại.");

  await input.fill("Payment Gateway");
  await dialog
    .getByRole("button", { name: "Lưu tên mới", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".project-card-title")).toHaveText(
    "Payment Gateway",
  );
  await expect(
    page.getByText("Đã đổi tên dự án thành Payment Gateway."),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/project-renamed-vi.png",
    fullPage: true,
  });
  expect(result.errors).toEqual([]);
});

test("developer deletes a project only after SweetAlert2 confirmation", async ({
  page,
}) => {
  const result = await workspace(page);
  await page.goto("/");
  const deleteButton = page.getByRole("button", {
    name: "Xóa dự án Payment API",
  });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Xóa dự án?");
  await expect(dialog).toContainText("Payment API");
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "test-results/project-delete-confirmation-vi.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(page.locator(".project-card")).toHaveCount(1);

  await deleteButton.click();
  await dialog.getByRole("button", { name: "Xóa dự án", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Đã xóa dự án Payment API.")).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Tạo dự án đầu tiên" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Đã xóa gần đây" }).click();
  await expect(dialog).toContainText("Dự án đã xóa gần đây");
  await expect(dialog).toContainText("Payment API");
  await page.screenshot({
    path: "test-results/recently-deleted-projects-vi.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Khôi phục", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Đã khôi phục dự án Payment API.")).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(1);

  await deleteButton.click();
  await page
    .locator(".swal2-popup")
    .getByRole("button", { name: "Xóa dự án", exact: true })
    .click();
  await page.getByRole("button", { name: "Đã xóa gần đây" }).click();
  await page
    .getByRole("dialog", { name: "Dự án đã xóa gần đây" })
    .getByRole("button", { name: "Xóa vĩnh viễn", exact: true })
    .click();
  const permanentDialog = page.locator(".swal2-popup");
  await expect(permanentDialog).toContainText("Xóa vĩnh viễn dự án?");
  await permanentDialog
    .getByRole("button", { name: "Xóa vĩnh viễn", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Đã xóa vĩnh viễn dự án Payment API."),
  ).toBeVisible();
  expect(result.errors).toEqual([]);
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
  await expect(page.locator(".page-heading")).toHaveCount(0);
  await expect(
    page.locator('.workflow-step[aria-current="step"]'),
  ).toContainText("Mã nguồn");
  await expect(page.locator(".workflow-step.next-ready")).toContainText(
    "Vấn đề & bản sửa",
  );
  await expect(page.locator(".review-workspace")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Phân tích mã nguồn", exact: true })
    .click();
  await expect(page.locator(".review-workspace")).toBeVisible();
  await expect(
    page.locator('.workflow-step[aria-current="step"]'),
  ).toContainText("Vấn đề & bản sửa");
  await expect(page.locator(".workflow-step.next-ready")).toContainText(
    "Kiểm thử",
  );
  await expect(page.locator(".issue-card p")).toHaveCount(0);
  await expect(page.locator(".issue-card-meta")).toBeVisible();
  await expect(page.locator(".issue-overview-blocks")).toBeVisible();
  await expect(page.locator(".apply-section")).toBeHidden();
  await expect(page.locator(".issue-summary-bar")).toHaveCount(0);
  await page.getByLabel("Lọc mức độ lỗi").selectOption("HIGH");
  await expect(page.locator(".issue-card")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/review-compact-vi.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Bản sửa" }).click();
  await expect(page.locator(".diff")).toBeVisible();
  await page.getByRole("tab", { name: "Mã nguồn", exact: true }).click();
  await expect(page.locator(".review-workspace")).toBeVisible();
  await expect(page.locator(".source-workspace")).toHaveCount(0);
  await expect(page.locator(".issue-source-view")).toContainText(
    "def charge(amount):",
  );
  await page.getByRole("tab", { name: "Bản sửa" }).click();
  const loadsBeforeReview = result.projectLoads();
  const panelHeightBeforeReview = (
    await page.locator(".proposal-panel").boundingBox()
  )?.height;
  await page
    .getByRole("button", { name: "Chấp nhận bản sửa", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Đang chấp nhận...", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(
    page.locator('.workflow-step[aria-current="step"]'),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Đã chấp nhận", exact: true }),
  ).toBeVisible();
  const panelHeightAfterReview = (
    await page.locator(".proposal-panel").boundingBox()
  )?.height;
  expect(panelHeightAfterReview).toBe(panelHeightBeforeReview);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 940, height: 800 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (originalViewport) await page.setViewportSize(originalViewport);
  expect(result.projectLoads()).toBe(loadsBeforeReview);
  await expect(
    page.getByText("Đã chấp nhận đề xuất. Nhấn Áp dụng để thay đổi source.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Bỏ duyệt", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Duyệt lại bản sửa", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Duyệt lại bản sửa", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Đã chấp nhận", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Áp dụng 1/ })).toBeEnabled();
  await page.getByRole("button", { name: /Áp dụng 1/ }).click();
  await expect(page.locator(".testing-workspace")).toBeVisible();
  await expect(page.locator(".review-workspace")).toHaveCount(0);
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Lịch sử/ })
    .click();
  await expect(page.locator(".history-workspace")).toBeVisible();
  await page.getByRole("button", { name: "Xem thay đổi" }).last().click();
  await expect(page.getByRole("dialog")).toContainText("payment.py");
  await page.screenshot({
    path: "test-results/history-diff-vi.png",
    fullPage: true,
  });
  await page.getByRole("dialog").getByRole("button", { name: "Đóng" }).click();
  await page.getByRole("button", { name: /Khôi phục nội dung v0/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Hủy" }).click();
  // Reopening the same project must not leave a blank workspace.
  await page.locator(".breadcrumbs").getByRole("button").click();
  await page.locator(".project-card").click();
  await expect(page.locator(".source-workspace")).toBeVisible();
  await expect(page.locator(".page-heading")).toHaveCount(0);
  await page
    .locator(".workflow-tabs")
    .getByRole("button", { name: /Vấn đề & bản sửa/ })
    .click();
  await expect(page.getByLabel("Tìm vấn đề", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/review-vi.png", fullPage: true });
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
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
    .getByLabel("Tải một hoặc nhiều tệp mã nguồn, hoặc một tệp ZIP")
    .setInputFiles([
      {
        name: "package.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"scripts":{"dev":"vite"}}'),
      },
      {
        name: "main.js",
        mimeType: "text/javascript",
        buffer: Buffer.from("document.body.textContent = 'Sentinel';"),
      },
    ]);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("package.json");
  await expect(page.getByRole("dialog")).toContainText("main.js");
  await page.getByRole("button", { name: "Tải và thay mã nguồn" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(result.uploaded()).toBe(true);
  const workflow = page.locator(".workflow-rail");
  await expect(workflow.locator(".workflow-step")).toHaveCount(4);
  await expect(workflow.locator(".workflow-connector")).toHaveCount(3);
  await expect(workflow.locator(".workflow-step").first()).toHaveClass(
    /complete/,
  );
  await expect(workflow.locator(".workflow-step").nth(2)).toBeDisabled();
  await expect(
    workflow.getByRole("button", { name: /1\. Mã nguồn/ }),
  ).toHaveAttribute("aria-current", "step");
  await page.screenshot({
    path: "test-results/workflow-real-state.png",
    fullPage: true,
  });
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
  for (const step of await workflow.locator(".workflow-step").all()) {
    await expect(step).toBeInViewport();
  }
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
  await page.getByLabel("Tìm lập trình viên").fill("unmatched");
  await expect(
    page.getByText("Không tìm thấy tài khoản phù hợp."),
  ).toBeVisible();
  await page.getByLabel("Tìm lập trình viên").clear();
  await page.getByRole("button", { name: "＋ Thêm lập trình viên" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/admin-vi.png", fullPage: true });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Dự án", exact: true })
    .click();
  await expect(page.locator("#users")).not.toBeVisible();
  await expect(page.locator("#projects")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Nhật ký hoạt động" })
    .click();
  await expect(page.locator("#projects")).not.toBeVisible();
  await expect(page.locator("#activities")).toBeVisible();
  expect(result.errors).toEqual([]);
});
