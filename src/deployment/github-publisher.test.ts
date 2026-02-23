import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockExecFileSync, mockExecSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExecSync: vi.fn(),
}));

const { mockLoad } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
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
    // Should not attempt any git commands
    expect(mockExecSync).not.toHaveBeenCalled();
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
    // gh --version succeeds
    mockExecFileSync
      .mockReturnValueOnce("gh version 2.40.0\n")
      // gh repo create succeeds
      .mockReturnValueOnce("https://github.com/user/my-app\n");

    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecSync
      // git remote get-url origin — no origin yet
      .mockImplementationOnce(() => {
        throw new Error("fatal: No such remote 'origin'");
      })
      // git branch --format
      .mockReturnValueOnce("main\nepic-1\nepic-2\n")
      // git push main
      .mockReturnValueOnce("Everything up-to-date\n")
      // git push epic-1
      .mockReturnValueOnce("branch epic-1 set up\n")
      // git push epic-2
      .mockReturnValueOnce("branch epic-2 set up\n")
      // git remote get-url origin (final)
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

    // Verify gh repo create was called with correct args
    const createCall = mockExecFileSync.mock.calls[1]!;
    expect(createCall[0]).toBe("gh");
    expect(createCall[1]).toContain("--private");
    expect(createCall[1]).toContain("--description");
  });

  it("skips repo creation when origin already exists", async () => {
    mockExecFileSync.mockReturnValueOnce("gh version 2.40.0\n");
    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecSync
      // git remote get-url origin — exists
      .mockReturnValueOnce("https://github.com/user/my-app.git\n")
      // git branch --format
      .mockReturnValueOnce("main\n")
      // git push main
      .mockReturnValueOnce("Everything up-to-date\n")
      // git remote get-url origin (final)
      .mockReturnValueOnce("https://github.com/user/my-app.git\n");

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("origin remote already exists");
    // gh repo create should NOT have been called (only gh --version)
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("handles gh repo create failure gracefully", async () => {
    mockExecFileSync
      .mockReturnValueOnce("gh version 2.40.0\n")
      .mockImplementationOnce(() => {
        throw new Error("HTTP 422: name already exists");
      });

    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecSync.mockImplementationOnce(() => {
      throw new Error("No such remote");
    });

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("gh repo create failed");
    expect(result.error).toContain("name already exists");
  });

  it("continues when one branch push fails", async () => {
    mockExecFileSync
      .mockReturnValueOnce("gh version 2.40.0\n")
      .mockReturnValueOnce("https://github.com/user/my-app\n");

    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecSync
      // git remote get-url origin — no origin
      .mockImplementationOnce(() => {
        throw new Error("No such remote");
      })
      // git branch --format
      .mockReturnValueOnce("main\nbroken-branch\n")
      // git push main
      .mockReturnValueOnce("done\n")
      // git push broken-branch — fails
      .mockImplementationOnce(() => {
        throw new Error("rejected: non-fast-forward");
      })
      // git remote get-url origin (final)
      .mockReturnValueOnce("https://github.com/user/my-app.git\n");

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Pushed main");
    expect(result.output).toContain("Warning: failed to push broken-branch");
  });

  it("normalizes SSH URLs to HTTPS", async () => {
    mockExecFileSync
      .mockReturnValueOnce("gh version 2.40.0\n")
      .mockReturnValueOnce("git@github.com:user/my-app.git\n");

    mockLoad.mockReturnValue("ghp_test_token_12345678");

    mockExecSync
      // git remote get-url origin — no origin
      .mockImplementationOnce(() => {
        throw new Error("No such remote");
      })
      // git branch --format
      .mockReturnValueOnce("main\n")
      // git push main
      .mockReturnValueOnce("done\n")
      // git remote get-url origin (final) — SSH URL
      .mockReturnValueOnce("git@github.com:user/my-app.git\n");

    const { publishToGitHub } = await import("./github-publisher.js");
    const result = publishToGitHub({ projectDir: "/tmp/test", repoName: "my-app" });

    expect(result.success).toBe(true);
    expect(result.repoUrl).toBe("https://github.com/user/my-app");
  });
});
