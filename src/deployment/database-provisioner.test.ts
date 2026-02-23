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

describe("provisionNeonDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when NEON_API_KEY is missing", async () => {
    mockLoad.mockReturnValue(null);

    const { provisionNeonDatabase } = await import("./database-provisioner.js");
    const result = provisionNeonDatabase({ projectName: "test-app" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("NEON_API_KEY not found");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("creates project and returns connection string on success", async () => {
    mockLoad.mockReturnValue("neon-api-key-123");
    mockExecFileSync
      .mockReturnValueOnce(JSON.stringify({ project: { id: "proj-abc" } }))
      .mockReturnValueOnce("postgresql://user:pass@host/db?sslmode=require\n");

    const { provisionNeonDatabase } = await import("./database-provisioner.js");
    const result = provisionNeonDatabase({ projectName: "test-app" });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe("proj-abc");
    expect(result.connectionString).toBe("postgresql://user:pass@host/db?sslmode=require");
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it("passes region when specified", async () => {
    mockLoad.mockReturnValue("key");
    mockExecFileSync
      .mockReturnValueOnce(JSON.stringify({ project: { id: "proj-1" } }))
      .mockReturnValueOnce("postgresql://conn\n");

    const { provisionNeonDatabase } = await import("./database-provisioner.js");
    provisionNeonDatabase({ projectName: "app", region: "aws-us-east-2" });

    const firstCallArgs = mockExecFileSync.mock.calls[0]![1] as string[];
    expect(firstCallArgs).toContain("--region-id");
    expect(firstCallArgs).toContain("aws-us-east-2");
  });

  it("returns error when neonctl fails", async () => {
    mockLoad.mockReturnValue("key");
    mockExecFileSync.mockImplementation(() => {
      throw new Error("command not found: neonctl");
    });

    const { provisionNeonDatabase } = await import("./database-provisioner.js");
    const result = provisionNeonDatabase({ projectName: "app" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Neon provisioning failed");
  });

  it("returns error when project ID cannot be parsed", async () => {
    mockLoad.mockReturnValue("key");
    mockExecFileSync.mockReturnValueOnce(JSON.stringify({ unexpected: "data" }));

    const { provisionNeonDatabase } = await import("./database-provisioner.js");
    const result = provisionNeonDatabase({ projectName: "app" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to parse project ID");
  });
});

describe("setVercelEnvVar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs vercel env add and returns success", async () => {
    mockExecFileSync.mockReturnValue("");

    const { setVercelEnvVar } = await import("./database-provisioner.js");
    const result = setVercelEnvVar("DATABASE_URL", "postgresql://...", "/tmp/project");

    expect(result.success).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledOnce();
    const cmd = mockExecFileSync.mock.calls[0]![0] as string;
    const args = mockExecFileSync.mock.calls[0]![1] as string[];
    expect(cmd).toBe("npx");
    expect(args).toContain("vercel");
    expect(args).toContain("env");
    expect(args).toContain("add");
    expect(args).toContain("DATABASE_URL");
    expect(args).toContain("production");
    expect(args).toContain("preview");
    expect(args).toContain("development");
  });

  it("returns error on failure", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("Vercel CLI not found");
    });

    const { setVercelEnvVar } = await import("./database-provisioner.js");
    const result = setVercelEnvVar("DATABASE_URL", "pg://...", "/tmp/project");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to set Vercel env var");
  });
});
