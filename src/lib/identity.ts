import { invoke } from "@tauri-apps/api/core";
import type { IdentityConfig } from "../types/workingTree";

export type IdentityScope = "local" | "global";

export function getIdentityConfig(): Promise<IdentityConfig> {
  return invoke<IdentityConfig>("get_identity_config");
}

/** Set the commit identity at the given scope; returns the refreshed config. */
export function setIdentity(
  name: string,
  email: string,
  scope: IdentityScope,
): Promise<IdentityConfig> {
  return invoke<IdentityConfig>("set_identity", { name, email, global: scope === "global" });
}
