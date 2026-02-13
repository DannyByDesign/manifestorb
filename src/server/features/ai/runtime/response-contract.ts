export type RuntimeStopReason =
  | "completed"
  | "needs_clarification"
  | "approval_pending"
  | "runtime_error"
  | "max_attempts";

export interface RuntimeLoopResult {
  text: string;
  stopReason: RuntimeStopReason;
  attempts: number;
}
