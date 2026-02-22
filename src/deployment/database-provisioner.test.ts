import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

const { mockLoad } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
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
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("creates project and returns connection string on success", async () => {
    mockLoad.mockReturnValue("neon-api-key-123");
    mockExecSync
      .mockReturnValueOnce(JSON.stringify({ project: { id: "proj-abc" } }))
      .mockReturnValueOnce("postgresql://user:pass@host/db?sslmode=require\n");

    const { provisionNeonDatabase } = await import("./database-provisioner.js");
    const result = provisionNeonDatabase({ projectName: "test-app" });

    expect(result.success).toBe(true);
    expect(result.projectId).toBe("proj-abc");
    expect(result.connectionString).toBe("postgresql://user:pass@host/db?sslmode=require");
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it("passes region when specified", async () => {
    mockLoad.mockReturnValue("key");
    mockExecSync
      .mockReturnValueOnce(JSON.stringify({ project: { id: "proj-1" } }))
      .mockReturnValueOnce("postgresql://conn\n");

    const { provisionNeonDatabase } = await import("./database-provisioner.js");
    provisionNeonDatabase({ projectName: "app", region: "aws-us-east-2" });

    const firstCall = mockExecSync.mock.calls[0]![0] as string;
    expect(firstCall).toContain("--region-id");
    expect(firstCall).toContain("aws-us-east-2");
  });

  it("returns error when neonctl fails", async () => {
    mockLoad.mockReturnValue("key");
    mockExecSync.mockImplementation(() => {
      throw new Error("command not found: neonctl");
    });

    const { provisionNeonDatabase } = await import("./database-provisioner.js");
    const result = provisionNeonDatabase({ projectName: "app" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Neon provisioning failed");
  });

  it("returns error when project ID cannot be parsed", async () => {
    mockLoad.mockReturnValue("key");
    mockExecSync.mockReturnValueOnce(JSON.stringify({ unexpected: "data" }));

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
    mockExecSync.mockReturnValue("");

    const { setVercelEnvVar } = await import("./database-provisioner.js");
    const result = setVercelEnvVar("DATABASE_URL", "postgresql://...", "/tmp/project");

    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledOnce();
    const cmd = mockExecSync.mock.calls[0]![0] as string;
    expect(cmd).toContain("vercel env add DATABASE_URL");
    expect(cmd).toContain("production preview development");
  });

  it("returns error on failure", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("Vercel CLI not found");
    });

    const { setVercelEnvVar } = await import("./database-provisioner.js");
    const result = setVercelEnvVar("DATABASE_URL", "pg://...", "/tmp/project");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to set Vercel env var");
  });
});
