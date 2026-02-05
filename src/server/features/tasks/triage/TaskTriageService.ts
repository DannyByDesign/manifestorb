import { z } from "zod";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildTaskTriageContext } from "./context";

const triageSchema = z.object({
  ranked: z.array(
    z.object({
      taskId: z.string(),
      rank: z.number().int().min(1),
      reason: z.string(),
      suggestedAction: z.string().optional(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  followUpQuestions: z.array(z.string()).optional(),
});

type TriageTask = {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number | null;
  priority: string | null;
  energyLevel: string | null;
  preferredTime: string | null;
  dueDate: Date | null;
  startDate: Date | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  scheduleScore: number | null;
  reschedulePolicy: string | null;
};

function computeHeuristicScore(task: TriageTask) {
  let score = 0;
  const now = new Date();

  if (task.dueDate) {
    const daysToDue = (task.dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (daysToDue < 0) score += 4;
    else if (daysToDue <= 1) score += 3;
    else if (daysToDue <= 3) score += 2;
    else if (daysToDue <= 7) score += 1;
  }

  if (task.priority === "HIGH") score += 2;
  if (task.priority === "MEDIUM") score += 1;
  if (task.priority === "LOW") score += 0.5;

  if (task.scheduledStart) {
    const hoursToStart = (task.scheduledStart.getTime() - now.getTime()) / (60 * 60 * 1000);
    if (hoursToStart <= 2) score += 2;
    else if (hoursToStart <= 24) score += 1.5;
  }

  if (task.startDate && task.startDate < now) score += 1;
  if (typeof task.scheduleScore === "number") score += Math.min(task.scheduleScore / 100, 1);

  return score;
}

function selectCandidateTasks(tasks: TriageTask[], limit = 15) {
  const scored = tasks.map((task) => ({
    task,
    score: computeHeuristicScore(task),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.task);
}

export async function triageTasks(params: {
  userId: string;
  emailAccountId: string;
  logger: Logger;
  messageContent?: string;
}) {
  const { userId, emailAccountId, logger, messageContent } = params;
  const context = await buildTaskTriageContext({
    userId,
    emailAccountId,
    logger,
    messageContent,
  });

  if (context.tasks.length === 0) {
    return {
      ranked: [],
      followUpQuestions: ["You have no open tasks. Want to add one?"],
      meta: { candidateCount: 0, openTaskCount: 0 },
    };
  }

  const candidates = selectCandidateTasks(context.tasks);

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
  });
  if (!emailAccount) {
    throw new Error("Email account not found for task triage");
  }

  const generateObject = createGenerateObject({
    emailAccount,
    label: "task-triage",
    modelOptions: getModel("chat"),
  });

  const prompt = `You are a task triage assistant. Rank tasks and explain why.\n\nReturn JSON only. Do not include any extra keys or commentary.\n\nTasks:\n${candidates
    .map((task) => {
      return `- id: ${task.id}\n  title: ${task.title}\n  description: ${task.description ?? ""}\n  dueDate: ${task.dueDate?.toISOString() ?? "none"}\n  durationMinutes: ${task.durationMinutes ?? "unknown"}\n  priority: ${task.priority ?? "NONE"}\n  energyLevel: ${task.energyLevel ?? "unknown"}\n  preferredTime: ${task.preferredTime ?? "unknown"}\n  scheduledStart: ${task.scheduledStart?.toISOString() ?? "none"}\n  scheduledEnd: ${task.scheduledEnd?.toISOString() ?? "none"}\n  reschedulePolicy: ${task.reschedulePolicy ?? "unknown"}`;
    })
    .join("\n")}\n\nUser context summary:\n${context.memory.summary ?? "None"}\n\nUser facts:\n${context.memory.facts
    .map((fact) => `- ${fact.key}: ${fact.value}`)
    .join("\n") || "None"}\n\nRecent completions:\n${context.recentCompletions
    .map((task) => `- ${task.title} (${task.completedAt.toISOString()})`)
    .join("\n") || "None"}\n\nCalendar busy periods (next 7 days): ${context.availability.busyPeriods.length}\n\nOutput JSON schema:\n{\n  \"ranked\": [\n    {\n      \"taskId\": \"string\",\n      \"rank\": 1,\n      \"reason\": \"string\",\n      \"suggestedAction\": \"optional string\",\n      \"confidence\": 0.0\n    }\n  ],\n  \"followUpQuestions\": [\"string\"]\n}\n\nRules:\n- Use only task IDs from the provided list.\n- Rank at most 5 tasks.\n- Prefer tasks that are due soon, blocked by meetings, or match available time.\n- If critical info is missing (e.g., due date or duration), ask 1-2 follow-up questions.\n- If no follow-up questions are needed, return an empty array.\n`;

  const aiResponse = await generateObject({
    system: "Return valid JSON only.",
    prompt,
    schema: triageSchema,
  } as any);

  return {
    ...aiResponse.object,
    meta: { candidateCount: candidates.length, openTaskCount: context.tasks.length },
  };
}
