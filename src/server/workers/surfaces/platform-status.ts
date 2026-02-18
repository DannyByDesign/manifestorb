export type PlatformName = "slack" | "discord" | "telegram";

export type PlatformStatus = {
  enabled: boolean;
  started: boolean;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
};

const statusStore: Record<PlatformName, PlatformStatus> = {
  slack: {
    enabled: false,
    started: false,
    lastConnectedAt: null,
    lastEventAt: null,
    lastError: null,
  },
  discord: {
    enabled: false,
    started: false,
    lastConnectedAt: null,
    lastEventAt: null,
    lastError: null,
  },
  telegram: {
    enabled: false,
    started: false,
    lastConnectedAt: null,
    lastEventAt: null,
    lastError: null,
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

export function setPlatformEnabled(platform: PlatformName, enabled: boolean): void {
  statusStore[platform].enabled = enabled;
}

export function setPlatformStarted(platform: PlatformName): void {
  statusStore[platform].started = true;
  statusStore[platform].lastConnectedAt = nowIso();
  statusStore[platform].lastError = null;
}

export function setPlatformError(platform: PlatformName, error: string): void {
  statusStore[platform].lastError = error;
}

export function touchPlatformEvent(platform: PlatformName): void {
  statusStore[platform].lastEventAt = nowIso();
}

export function getPlatformStatuses(): Record<PlatformName, PlatformStatus> {
  return {
    slack: { ...statusStore.slack },
    discord: { ...statusStore.discord },
    telegram: { ...statusStore.telegram },
  };
}
