export interface ToolEmailAccount {
  id: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  email: string;
}

export interface EmailChanges {
  archive?: boolean;
  trash?: boolean;
  read?: boolean;
  labels?: {
    add?: string[];
    remove?: string[];
  };
  unsubscribe?: boolean;
  tracking?: boolean;
  followUp?: "enable" | "disable";
  bulk_archive_senders?: boolean;
  bulk_trash_senders?: boolean;
  bulk_label_senders?: string;
  targetFolderId?: string;
}

export interface DraftParams {
  type: "new" | "reply" | "forward";
  parentId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
}
