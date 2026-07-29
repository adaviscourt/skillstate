export type InstallMode = "symlink" | "copy";

export interface DesiredSource {
  source: string;
  displaySource: string;
  ref?: string;
  skills: readonly string[] | "*";
}

export interface DesiredState {
  schema: 1;
  agents: readonly string[];
  mode: InstallMode;
  sources: readonly DesiredSource[];
  manifestPath: string;
  projectRoot: string;
}

export interface LockEntry {
  name: string;
  manageable?: boolean | undefined;
  source: string;
  sourceUrl?: string | undefined;
  sourceType: string;
  ref?: string | undefined;
  skillPath?: string | undefined;
  computedHash: string;
}

export interface InstalledState {
  version: 1;
  path: string;
  entries: readonly LockEntry[];
  observed: Readonly<Record<string, readonly ObservedSkill[]>>;
}

export interface ObservedSkill {
  name: string;
  path: string;
}

export type ActionKind = "install" | "restore" | "remove" | "noop" | "warning";

export interface PlanAction {
  kind: ActionKind;
  source?: string;
  ref?: string;
  skills: readonly string[];
  agents: readonly string[];
  mode: InstallMode;
  reason: string;
  args?: readonly string[];
  destructive: boolean;
}

export interface Plan {
  actions: readonly PlanAction[];
  changes: number;
  installs: number;
  restores: number;
  removals: number;
  warnings: number;
}

export interface InvocationOverrides {
  agents?: readonly string[];
  mode?: InstallMode;
  prune?: boolean;
}

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;
export const EXIT_CONFIG = 2;
export const EXIT_DRIFT = 3;
export const EXIT_BACKEND = 4;
