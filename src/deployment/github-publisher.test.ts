import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

const { mockLoad } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock("../security/credentials.js", () => ({
  createCredentialStore: () => ({
    load: mockLoad,
  }),
}));

describe("publishToGitHub", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    savedEnv.GH_TOKEN = process.env.GH_TOKEN;
    savedEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    process.env.GH_TOKEN = savedEnv.GH_TOKEN;
    process.env.GITHUB_TOKEN = savedEnv.GITHUB_TOKEN;
  });

  it("returns error when gh CLI is not installed", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("command not found: gh");
    });

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("gh CLI not found");
    // Only the gh --version call should have been made
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("returns error when GH_TOKEN is missing", async () => {
    // gh --version succeeds
    mockExecFileSync.mockReturnValueOnce("gh version 2.40.0\n");
    mockLoad.mockReturnValue(null);

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("GH_TOKEN not found");
  });

  it("creates repo and pushes all branches on success", async () => {
    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecFileSync
      // 1. gh --version
      .mockReturnValueOnce("gh version 2.40.0\n")
      // 2. git remote get-url origin — no origin yet
      .mockImplementationOnce(() => {
        throw new Error("fatal: No such remote 'origin'");
      })
      // 3. gh repo create
      .mockReturnValueOnce("https://github.com/user/my-app\n")
      // 4. git branch --format
      .mockReturnValueOnce("main\nepic-1\nepic-2\n")
      // 5. git push main
      .mockReturnValueOnce("Everything up-to-date\n")
      // 6. git push epic-1
      .mockReturnValueOnce("branch epic-1 set up\n")
      // 7. git push epic-2
      .mockReturnValueOnce("branch epic-2 set up\n")
      // 8. git remote get-url origin (final)
      .mockReturnValueOnce("https://github.com/user/my-app.git\n");

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({
      projectDir: "/tmp/test",
      repoName: "my-app",
      description: "Built by Boop",
    });

    expect(result.success).toBe(true);
    expect(result.repoUrl).toBe("https://github.com/user/my-app");
    expect(result.output).toContain("Pushed main");
    expect(result.output).toContain("Pushed epic-1");
    expect(result.output).toContain("Pushed epic-2");

    // Verify gh repo create was called with correct args (call index 2)
    const createCall = mockExecFileSync.mock.calls[2]!;
    expect(createCall[0]).toBe("gh");
    expect(createCall[1]).toContain("--private");
    expect(createCall[1]).toContain("--description");
  });

  it("skips repo creation when origin already exists", async () => {
    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecFileSync
      // 1. gh --version
      .mockReturnValueOnce("gh version 2.40.0\n")
      // 2. git remote get-url origin — exists
      .mockReturnValueOnce("https://github.com/user/my-app.git\n")
      // 3. git branch --format
      .mockReturnValueOnce("main\n")
      // 4. git push main
      .mockReturnValueOnce("Everything up-to-date\n")
      // 5. git remote get-url origin (final)
      .mockReturnValueOnce("https://github.com/user/my-app.git\n");

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("origin remote already exists");
    // gh --version + git remote (origin check) + git branch + git push + git remote (final) = 5
    // No gh repo create call
    expect(mockExecFileSync).toHaveBeenCalledTimes(5);
  });

  it("handles gh repo create failure gracefully", async () => {
    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecFileSync
      // 1. gh --version
      .mockReturnValueOnce("gh version 2.40.0\n")
      // 2. git remote get-url origin — no origin
      .mockImplementationOnce(() => {
        throw new Error("No such remote");
      })
      // 3. gh repo create — fails
      .mockImplementationOnce(() => {
        throw new Error("HTTP 422: name already exists");
      });

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("gh repo create failed");
    expect(result.error).toContain("name already exists");
  });

  it("continues when one branch push fails", async () => {
    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecFileSync
      // 1. gh --version
      .mockReturnValueOnce("gh version 2.40.0\n")
      // 2. git remote get-url origin — no origin
      .mockImplementationOnce(() => {
        throw new Error("No such remote");
      })
      // 3. gh repo create
      .mockReturnValueOnce("https://github.com/user/my-app\n")
      // 4. git branch --format
      .mockReturnValueOnce("main\nbroken-branch\n")
      // 5. git push main
      .mockReturnValueOnce("done\n")
      // 6. git push broken-branch — fails
      .mockImplementationOnce(() => {
        throw new Error("rejected: non-fast-forward");
      })
      // 7. git remote get-url origin (final)
      .mockReturnValueOnce("https://github.com/user/my-app.git\n");

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Pushed main");
    expect(result.output).toContain("Warning: failed to push broken-branch");
  });

  it("normalizes SSH URLs to HTTPS", async () => {
    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecFileSync
      // 1. gh --version
      .mockReturnValueOnce("gh version 2.40.0\n")
      // 2. git remote get-url origin — no origin
      .mockImplementationOnce(() => {
        throw new Error("No such remote");
      })
      // 3. gh repo create
      .mockReturnValueOnce("git@github.com:user/my-app.git\n")
      // 4. git branch --format
      .mockReturnValueOnce("main\n")
      // 5. git push main
      .mockReturnValueOnce("done\n")
      // 6. git remote get-url origin (final) — SSH URL
      .mockReturnValueOnce("git@github.com:user/my-app.git\n");

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(true);
    expect(result.repoUrl).toBe("https://github.com/user/my-app");
  });
});
