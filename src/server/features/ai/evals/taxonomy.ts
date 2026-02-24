export type PatternStatus = "full" | "partial" | "unsupported";

export interface TaxonomyOperation {
  tool: "query" | "get" | "create" | "modify" | "delete" | "workflow";
  resource?: string;
  description: string;
}

export interface TaxonomyPattern {
  id: string;
  category:
    | "email_reading"
    | "email_composing"
    | "email_managing"
    | "calendar_scheduling"
    | "calendar_management"
    | "combined_workflows";
  request: string;
  ambiguity: "clear" | "somewhat_vague" | "contextual" | "implicit" | "very_vague";
  complexity: "single_action" | "multi_step" | "conditional" | "dependent";
  scope: "individual";
  operations: TaxonomyOperation[];
  requirements: string[];
}

export interface PatternEvaluation {
  pattern: TaxonomyPattern;
  status: PatternStatus;
  blockers: string[];
  partials: string[];
}

export interface TaxonomyEvaluation {
  total: number;
  full: number;
  partial: number;
  unsupported: number;
  results: PatternEvaluation[];
  byCategory: Record<TaxonomyPattern["category"], { total: number; full: number; partial: number; unsupported: number }>;
  byRequirementGap: Array<{ requirement: string; count: number; status: Exclude<PatternStatus, "full"> }>;
}

const CAPABILITY_STATUS: Record<string, PatternStatus> = {
  email_query: "full",
  email_compose_draft: "full",
  email_send_on_approval: "full",
  email_manage_state: "full",
  email_bulk_actions: "full",
  calendar_create: "full",
  calendar_auto_schedule: "full",
  calendar_recurrence: "full",
  calendar_modify: "full",
  calendar_delete: "full",
  calendar_query: "full",
  task_create: "full",
  workflow_depends_on: "full",
  workflow_output_normalization: "full",
  workflow_step_approval: "full",
  workflow_compensation: "full",
  context_reference_resolution: "full",
  implicit_intent_resolution: "partial",
  conditional_execution: "full",
  very_vague_clarification: "full",
};

const firstNames = [
  "John",
  "Sarah",
  "Alex",
  "Maya",
  "Daniel",
  "Priya",
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
];

const domains = ["example.com", "acme.io", "contoso.com", "startup.dev"];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const timeSlots = ["9am", "10am", "11am", "1pm", "2pm", "3pm", "4pm"];
const subjects = [
  "Q1 planning",
  "budget review",
  "roadmap update",
  "contract renewal",
  "travel logistics",
  "board prep",
  "investor follow-up",
  "customer escalation",
];

function makeId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, "0")}`;
}

function buildEmailAddress(i: number): string {
  return `${firstNames[i % firstNames.length]!.toLowerCase()}@${domains[i % domains.length]}`;
}

function mkPattern(
  id: string,
  category: TaxonomyPattern["category"],
  request: string,
  ambiguity: TaxonomyPattern["ambiguity"],
  complexity: TaxonomyPattern["complexity"],
  operations: TaxonomyOperation[],
  requirements: string[]
): TaxonomyPattern {
  return {
    id,
    category,
    request,
    ambiguity,
    complexity,
    scope: "individual",
    operations,
    requirements,
  };
}

function buildEmailReadingPatterns(): TaxonomyPattern[] {
  const patterns: TaxonomyPattern[] = [];
  for (let i = 0; i < 45; i++) {
    const name = firstNames[i % firstNames.length]!;
    const email = buildEmailAddress(i);
    const day = weekdays[i % weekdays.length]!;
    const subject = subjects[i % subjects.length]!;
    const requestVariants = [
      `Show me unread emails from ${name}.`,
      `Find messages from ${email} about ${subject}.`,
      `What landed in my inbox since ${day}?`,
      `List emails with attachments from ${name}.`,
      `Search for "${subject}" in my inbox.`,
    ];
    patterns.push(
      mkPattern(
        makeId("ER", i + 1),
        "email_reading",
        requestVariants[i % requestVariants.length]!,
        "clear",
        "single_action",
        [
          {
            tool: "query",
            resource: "email",
            description: "Query emails with sender/subject/date filter",
          },
        ],
        ["email_query"]
      )
    );
  }
  return patterns;
}

function buildEmailComposingPatterns(): TaxonomyPattern[] {
  const patterns: TaxonomyPattern[] = [];
  for (let i = 0; i < 42; i++) {
    const email = buildEmailAddress(i);
    const subject = subjects[i % subjects.length]!;
    patterns.push(
      mkPattern(
        makeId("EC", i + 1),
        "email_composing",
        `Draft an email to ${email} about ${subject} and send when approved.`,
        "clear",
        "single_action",
        [
          {
            tool: "create",
            resource: "email",
            description: "Create draft email that is sent after approval workflow",
          },
        ],
        ["email_compose_draft", "email_send_on_approval"]
      )
    );
  }

  for (let i = 42; i < 45; i++) {
    patterns.push(
      mkPattern(
        makeId("EC", i + 1),
        "email_composing",
        `Tell them I can do ${timeSlots[i % timeSlots.length]} tomorrow.`,
        "implicit",
        "single_action",
        [
          {
            tool: "create",
            resource: "email",
            description: "Create a contextual reply draft",
          },
        ],
        ["email_compose_draft", "implicit_intent_resolution"]
      )
    );
  }
  return patterns;
}

function buildEmailManagingPatterns(): TaxonomyPattern[] {
  const patterns: TaxonomyPattern[] = [];
  for (let i = 0; i < 20; i++) {
    const email = buildEmailAddress(i);
    patterns.push(
      mkPattern(
        makeId("EM", i + 1),
        "email_managing",
        `Archive all emails from ${email}.`,
        "clear",
        "multi_step",
        [
          { tool: "query", resource: "email", description: "Find sender emails with fetchAll" },
          { tool: "modify", resource: "email", description: "Bulk archive by sender" },
        ],
        ["email_query", "email_manage_state", "email_bulk_actions"]
      )
    );
  }

  for (let i = 20; i < 25; i++) {
    patterns.push(
      mkPattern(
        makeId("EM", i + 1),
        "email_managing",
        `Mark that last thread as read and set follow-up mode off.`,
        "contextual",
        "dependent",
        [
          { tool: "modify", resource: "email", description: "Update read/followUp state by thread id" },
        ],
        ["email_manage_state", "context_reference_resolution"]
      )
    );
  }
  return patterns;
}

function buildCalendarSchedulingPatterns(): TaxonomyPattern[] {
  const patterns: TaxonomyPattern[] = [];
  for (let i = 0; i < 30; i++) {
    const name = firstNames[i % firstNames.length]!;
    const slot = timeSlots[i % timeSlots.length]!;
    patterns.push(
      mkPattern(
        makeId("CS", i + 1),
        "calendar_scheduling",
        `Schedule a 30-minute meeting with ${name} next ${weekdays[i % weekdays.length]} at ${slot}.`,
        "clear",
        "single_action",
        [
          { tool: "create", resource: "calendar", description: "Create timed event" },
        ],
        ["calendar_create"]
      )
    );
  }

  for (let i = 30; i < 49; i++) {
    patterns.push(
      mkPattern(
        makeId("CS", i + 1),
        "calendar_scheduling",
        `Find me time for ${subjects[i % subjects.length]} next week.`,
        "somewhat_vague",
        "single_action",
        [
          { tool: "create", resource: "calendar", description: "Auto-schedule with suggested slots" },
        ],
        ["calendar_create", "calendar_auto_schedule"]
      )
    );
  }

  for (let i = 49; i < 55; i++) {
    patterns.push(
      mkPattern(
        makeId("CS", i + 1),
        "calendar_scheduling",
        `If Friday afternoon is open, book my focus block; otherwise move it to Monday morning.`,
        "somewhat_vague",
        "conditional",
        [
          { tool: "workflow", resource: "calendar", description: "Conditional availability + scheduling flow" },
        ],
        ["calendar_query", "calendar_create", "conditional_execution"]
      )
    );
  }
  return patterns;
}

function buildCalendarManagementPatterns(): TaxonomyPattern[] {
  const patterns: TaxonomyPattern[] = [];
  for (let i = 0; i < 18; i++) {
    patterns.push(
      mkPattern(
        makeId("CM", i + 1),
        "calendar_management",
        `Move my ${timeSlots[i % timeSlots.length]} meeting to one hour later.`,
        "contextual",
        "single_action",
        [
          { tool: "modify", resource: "calendar", description: "Modify event time" },
        ],
        ["calendar_modify", "context_reference_resolution"]
      )
    );
  }

  for (let i = 18; i < 28; i++) {
    patterns.push(
      mkPattern(
        makeId("CM", i + 1),
        "calendar_management",
        `Cancel my meeting on ${weekdays[i % weekdays.length]} and free that slot.`,
        "clear",
        "single_action",
        [
          { tool: "delete", resource: "calendar", description: "Cancel event" },
        ],
        ["calendar_delete"]
      )
    );
  }

  for (let i = 28; i < 30; i++) {
    patterns.push(
      mkPattern(
        makeId("CM", i + 1),
        "calendar_management",
        `I can't make it tomorrow.`,
        "implicit",
        "single_action",
        [
          { tool: "modify", resource: "calendar", description: "Interpret implicit conflict and reschedule/cancel" },
        ],
        ["calendar_modify", "implicit_intent_resolution"]
      )
    );
  }
  return patterns;
}

function buildCombinedWorkflowPatterns(): TaxonomyPattern[] {
  const patterns: TaxonomyPattern[] = [];
  for (let i = 0; i < 5; i++) {
    const email = buildEmailAddress(i);
    patterns.push(
      mkPattern(
        makeId("WF", i + 1),
        "combined_workflows",
        `Reply to ${email} confirming the time and create a calendar event.`,
        "clear",
        "multi_step",
        [
          { tool: "workflow", description: "Create email draft + create calendar event in one chain" },
        ],
        [
          "workflow_depends_on",
          "workflow_output_normalization",
          "workflow_step_approval",
          "workflow_compensation",
          "email_compose_draft",
          "calendar_create",
        ]
      )
    );
  }

  for (let i = 5; i < 14; i++) {
    patterns.push(
      mkPattern(
        makeId("WF", i + 1),
        "combined_workflows",
        `If I'm free ${weekdays[i % weekdays.length]} afternoon, accept and schedule; otherwise suggest another slot.`,
        "somewhat_vague",
        "conditional",
        [
          { tool: "workflow", description: "Conditional email/calendar workflow" },
        ],
        [
          "workflow_depends_on",
          "workflow_output_normalization",
          "workflow_step_approval",
          "calendar_query",
          "conditional_execution",
        ]
      )
    );
  }

  for (let i = 14; i < 20; i++) {
    patterns.push(
      mkPattern(
        makeId("WF", i + 1),
        "combined_workflows",
        `Handle it for me.`,
        "very_vague",
        "dependent",
        [
          { tool: "workflow", description: "Underspecified autonomous action request" },
        ],
        ["very_vague_clarification"]
      )
    );
  }
  return patterns;
}

export function buildTaxonomyPatterns(): TaxonomyPattern[] {
  const patterns = [
    ...buildEmailReadingPatterns(),
    ...buildEmailComposingPatterns(),
    ...buildEmailManagingPatterns(),
    ...buildCalendarSchedulingPatterns(),
    ...buildCalendarManagementPatterns(),
    ...buildCombinedWorkflowPatterns(),
  ];

  if (patterns.length !== 220) {
    throw new Error(`Expected exactly 220 patterns, got ${patterns.length}`);
  }

  return patterns;
}

function evaluatePattern(pattern: TaxonomyPattern, capabilityStatus: Record<string, PatternStatus>): PatternEvaluation {
  const blockers: string[] = [];
  const partials: string[] = [];

  for (const requirement of pattern.requirements) {
    const status = capabilityStatus[requirement] ?? "unsupported";
    if (status === "unsupported") blockers.push(requirement);
    if (status === "partial") partials.push(requirement);
  }

  const status: PatternStatus = blockers.length > 0 ? "unsupported" : partials.length > 0 ? "partial" : "full";
  return { pattern, status, blockers, partials };
}

export function evaluateTaxonomy(
  patterns: TaxonomyPattern[] = buildTaxonomyPatterns(),
  capabilityStatus: Record<string, PatternStatus> = CAPABILITY_STATUS
): TaxonomyEvaluation {
  const results = patterns.map((p) => evaluatePattern(p, capabilityStatus));
  const full = results.filter((r) => r.status === "full").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const unsupported = results.filter((r) => r.status === "unsupported").length;

  const byCategory: TaxonomyEvaluation["byCategory"] = {
    email_reading: { total: 0, full: 0, partial: 0, unsupported: 0 },
    email_composing: { total: 0, full: 0, partial: 0, unsupported: 0 },
    email_managing: { total: 0, full: 0, partial: 0, unsupported: 0 },
    calendar_scheduling: { total: 0, full: 0, partial: 0, unsupported: 0 },
    calendar_management: { total: 0, full: 0, partial: 0, unsupported: 0 },
    combined_workflows: { total: 0, full: 0, partial: 0, unsupported: 0 },
  };

  for (const result of results) {
    const entry = byCategory[result.pattern.category];
    entry.total += 1;
    entry[result.status] += 1;
  }

  const requirementGaps = new Map<string, { count: number; status: Exclude<PatternStatus, "full"> }>();
  for (const result of results) {
    for (const req of result.blockers) {
      const existing = requirementGaps.get(req);
      requirementGaps.set(req, { count: (existing?.count ?? 0) + 1, status: "unsupported" });
    }
    for (const req of result.partials) {
      const existing = requirementGaps.get(req);
      if (!existing || existing.status !== "unsupported") {
        requirementGaps.set(req, { count: (existing?.count ?? 0) + 1, status: "partial" });
      }
    }
  }

  const byRequirementGap = [...requirementGaps.entries()]
    .map(([requirement, meta]) => ({ requirement, count: meta.count, status: meta.status }))
    .sort((a, b) => b.count - a.count);

  return {
    total: patterns.length,
    full,
    partial,
    unsupported,
    results,
    byCategory,
    byRequirementGap,
  };
}

export function hasMinimumCoverage(evaluation: TaxonomyEvaluation, minFull: number): boolean {
  return evaluation.full >= minFull;
}

export const TAXONOMY_TARGET_FULL = 190;
