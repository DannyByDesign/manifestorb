import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import type { RuntimeSkill } from "@/server/features/ai/skills/types";

function walkSkillFiles(root: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSkillFiles(absolute));
      continue;
    }
    if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(absolute);
    }
  }
  return files;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/u);
  if (!match) return {};
  const lines = match[1].split("\n");
  const out: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function removeFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/u, "").trim();
}

function parseTags(frontmatter: Record<string, string>): string[] {
  const raw = frontmatter.tags;
  if (!raw) return [];
  return raw
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export function loadRuntimeSkills(): RuntimeSkill[] {
  const skillsRoot = path.join(process.cwd(), "skills");
  let files: string[] = [];
  try {
    if (!statSync(skillsRoot).isDirectory()) return [];
    files = walkSkillFiles(skillsRoot);
  } catch {
    return [];
  }

  const skills: RuntimeSkill[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const frontmatter = parseFrontmatter(content);
    if (frontmatter.runtime !== "agent") continue;

    const id = frontmatter.name || path.basename(path.dirname(file));
    const title = frontmatter.title || id;
    const body = removeFrontmatter(content);
    const tags = parseTags(frontmatter);

    skills.push({
      id,
      path: file,
      title,
      body,
      tags,
    });
  }

  return skills;
}
