// How Windows builds are Authenticode-signed: Azure Artifact Signing (formerly Trusted Signing),
// through `artifact-signing-cli` (`cargo install artifact-signing-cli`), the tool Tauri documents
// for it. Microsoft holds the key and issues a short-lived certificate per signature, so there is
// no certificate file or hardware token to keep; an Azure app registration allowed to sign with
// the account's certificate profile is the whole credential. docs/desktop-releases.md has the setup.

export interface WindowsSigning {
  tool: string;
  /** Everything before the file to sign, which the caller appends. */
  args: string[];
}

/** The app registration, read by the tool itself, and where the certificate profile lives. */
export const WINDOWS_SIGNING_VARIABLES = [
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "AZURE_ARTIFACT_SIGNING_ACCOUNT",
  "AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE",
] as const;

/**
 * The signing command, `null` when nothing is configured (an unsigned local build), or an error
 * naming what is missing when only part of it is: a half-configured release would otherwise
 * publish unsigned without anyone deciding it should.
 */
export function windowsSigning(env: NodeJS.ProcessEnv): WindowsSigning | null {
  const missing = WINDOWS_SIGNING_VARIABLES.filter((name) => !env[name]?.trim());
  if (missing.length === WINDOWS_SIGNING_VARIABLES.length) return null;
  if (missing.length)
    throw new Error(`Windows signing is partly configured; missing ${missing.join(", ")}.`);
  const value = (name: (typeof WINDOWS_SIGNING_VARIABLES)[number]) => env[name]?.trim() ?? "";
  return {
    tool: "artifact-signing-cli",
    args: [
      "-e",
      value("AZURE_ARTIFACT_SIGNING_ENDPOINT"),
      "-a",
      value("AZURE_ARTIFACT_SIGNING_ACCOUNT"),
      "-c",
      value("AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE"),
      // Shown as the program's name where Windows describes a signed file.
      "-d",
      "Concors",
    ],
  };
}

/**
 * Whether a Windows executable or library already carries an Authenticode signature: its PE
 * header's certificate table is not empty. Reads the header alone, so it needs no Windows tools.
 * `null` for anything that is not a PE file.
 */
export function hasAuthenticodeSignature(header: Buffer): boolean | null {
  if (header.length < 0x40 || header.toString("latin1", 0, 2) !== "MZ") return null;
  const pe = header.readUInt32LE(0x3c);
  if (pe + 24 > header.length || header.toString("latin1", pe, pe + 4) !== "PE\0\0") return null;
  const optional = pe + 24;
  const magic = header.readUInt16LE(optional);
  // The data directories follow the fixed part of the optional header, whose size depends on
  // whether the image is 32- or 64-bit; the certificate table is the fifth of them.
  const directories = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : NaN);
  const certificates = directories + 4 * 8;
  if (Number.isNaN(directories) || certificates + 8 > header.length) return null;
  return header.readUInt32LE(certificates + 4) > 0;
}
