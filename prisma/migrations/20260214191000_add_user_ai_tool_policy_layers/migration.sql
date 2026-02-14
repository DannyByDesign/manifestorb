ALTER TABLE "UserAIConfig"
  ADD COLUMN "toolProfile" TEXT,
  ADD COLUMN "toolAllow" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  ADD COLUMN "toolAlsoAllow" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  ADD COLUMN "toolDeny" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  ADD COLUMN "toolByProvider" JSONB,
  ADD COLUMN "toolByAgent" JSONB,
  ADD COLUMN "toolByGroup" JSONB,
  ADD COLUMN "toolSandboxPolicy" JSONB,
  ADD COLUMN "toolSubagentPolicy" JSONB;
