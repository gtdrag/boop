/**
 * Security module for Boop.
 *
 * Provides credential management and security audit capabilities.
 */

export {
  createCredentialStore,
  containsCredential,
  scanFileForCredentials,
  getEnvVarName,
  getDefaultCredentialsDir,
  type CredentialStore,
  type CredentialKey,
  type CredentialPermissionResult,
} from "./credentials.js";

export {
  runSecurityAudit,
  formatAuditReport,
  type AuditCheck,
  type AuditCategory,
  type AuditReport,
  type AuditOptions,
} from "./audit-checklist.js";
