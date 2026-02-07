/**
 * Proactive context: items requiring user attention for AI to surface.
 */

export interface AttentionItem {
  id: string;
  type:
    | "unanswered_email"
    | "upcoming_meeting"
    | "overdue_task"
    | "pending_approval"
    | "follow_up_due";
  urgency: "high" | "medium" | "low";
  title: string;
  description: string;
  actionable: boolean;
  suggestedAction?: string;
  relatedEntityId: string;
  relatedEntityType: "email" | "calendar" | "task" | "approval";
  detectedAt: Date;
}
