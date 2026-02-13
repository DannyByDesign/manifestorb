export interface RuntimeSkill {
  id: string;
  path: string;
  title: string;
  body: string;
  tags: string[];
}

export interface RuntimeSkillSnapshot {
  selectedSkillIds: string[];
  promptSection: string;
}
