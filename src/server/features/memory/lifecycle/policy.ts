export interface MemoryRetentionPolicy {
  key: string;
  retentionDays: number;
  hardDelete: boolean;
}

export const MEMORY_RETENTION_POLICIES: MemoryRetentionPolicy[] = [
  {
    key: "memory_fact_inactive",
    retentionDays: 180,
    hardDelete: true,
  },
  {
    key: "memory_access_audit",
    retentionDays: 90,
    hardDelete: true,
  },
  {
    key: "relationship_assertion_active",
    retentionDays: 365,
    hardDelete: false,
  },
  {
    key: "commitment_closed",
    retentionDays: 365,
    hardDelete: false,
  },
];
