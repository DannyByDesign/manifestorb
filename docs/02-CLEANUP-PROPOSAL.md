# Codebase Cleanup & Organization Proposal

> Strategy for organizing the codebase after importing backend from open-source project, with clear separation between your frontend work and the imported backend.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Problems Identified](#problems-identified)
3. [Proposed Directory Structure](#proposed-directory-structure)
4. [Migration Plan](#migration-plan)
5. [Path Alias Configuration](#path-alias-configuration)
6. [File Deduplication](#file-deduplication)
7. [Import Standardization](#import-standardization)

---

## Current State Analysis

### Your Original Frontend Work

Located in scattered root-level directories:

```
src/
├── components/          # 5 files (Orb, Sparkles, Effects, Scene, HaloDust)
├── shaders/             # ~20 files (GLSL shaders, shader libs)
├── lib/                 # 5 files (audio, capabilities, stores)
└── app/
    ├── page.tsx         # Main 3D scene entry
    ├── layout.tsx       # Root layout
    └── globals.css      # Styling with CSS variables
```

**Total: ~35 files** - GPU-accelerated 3D UI with React Three Fiber

### Imported Backend

Dominates the `/server/` directory:

```
src/server/              # ~812 files
├── auth/                # Authentication (Better Auth)
├── db/                  # Prisma + 162 migrations
├── integrations/        # Google, Microsoft, AI, QStash (~127 files)
├── packages/            # CLI, Resend, Tinybird, Loops
├── services/            # Service layer (~50 files)
├── types/               # TypeScript types
└── utils/               # Utilities (~200+ files)
```

### Additional Imported Code

```
src/
├── app/api/             # ~40 API route files
├── ee/                  # Enterprise billing (Stripe, Lemon)
├── __tests__/           # Test files
└── env.ts               # Environment configuration
```

---

## Problems Identified

### 1. Code Duplication

Multiple identical files exist in different locations:

| File | Location 1 | Location 2 |
|------|------------|------------|
| `permissions.ts` | `server/utils/gmail/` | `server/integrations/google/` |
| `permissions.ts` | `server/utils/actions/` | `server/services/unsubscriber/` |
| `cold-email.validation.ts` | `server/utils/actions/` | `server/services/unsubscriber/` |
| `report.ts` | `server/utils/actions/` | `server/services/unsubscriber/` |

### 2. Inconsistent Import Paths

```typescript
// Pattern 1: 133+ files use this
import { prisma } from "@/utils/prisma";

// Pattern 2: 48+ files use this
import { prisma } from "@/server/db/client";

// Pattern 3: Mixed usage
import { logger } from "@/utils/logger";
import { logger } from "@/server/utils/logger";
```

### 3. Unclear Code Ownership

- Frontend code scattered in multiple root folders
- No clear boundary between "your code" and "imported code"
- Mixed concerns in `utils/` directory

### 4. Overlapping Directories

```
server/utils/actions/     # ~59 files
server/services/unsubscriber/  # ~50 files
                         # Significant overlap in functionality
```

### 5. Deep Nesting Issues

```
server/integrations/ai/choose-rule/  # Feature code
server/utils/ai/                     # Also AI code?
```

---

## Proposed Directory Structure

### New Structure

```
src/
├── app/                           # Next.js App Router
│   ├── (marketing)/               # Public pages (future)
│   │   └── page.tsx               # Landing page
│   │
│   ├── (experience)/              # Your 3D experience
│   │   └── page.tsx               # Current 3D scene
│   │
│   ├── (dashboard)/               # Email app pages (future)
│   │   ├── layout.tsx             # Dashboard layout
│   │   ├── inbox/                 # Inbox view
│   │   │   └── page.tsx
│   │   ├── rules/                 # Rules management
│   │   │   └── page.tsx
│   │   ├── settings/              # User settings
│   │   │   └── page.tsx
│   │   ├── analytics/             # Reports & stats
│   │   │   └── page.tsx
│   │   └── ...
│   │
│   ├── api/                       # API routes (keep structure)
│   │   ├── ai/
│   │   ├── clean/
│   │   ├── google/
│   │   └── resend/
│   │
│   ├── layout.tsx                 # Root layout
│   └── globals.css                # Global styles
│
├── frontend/                      # YOUR FRONTEND CODE
│   ├── components/                # React components
│   │   ├── experience/            # 3D experience components
│   │   │   ├── Orb.tsx
│   │   │   ├── Sparkles.tsx
│   │   │   ├── HaloDust.tsx
│   │   │   ├── Effects.tsx
│   │   │   └── Scene.tsx
│   │   ├── ui/                    # UI components (future)
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   └── ...
│   │   └── dashboard/             # Dashboard components (future)
│   │       ├── EmailList.tsx
│   │       ├── RuleEditor.tsx
│   │       └── ...
│   │
│   ├── shaders/                   # GLSL shaders
│   │   ├── lib/                   # Shader libraries
│   │   │   ├── common.glsl
│   │   │   ├── noise.glsl
│   │   │   └── sdf.glsl
│   │   ├── sim/                   # Simulation shaders
│   │   └── *.glsl                 # Component shaders
│   │
│   ├── lib/                       # Frontend utilities
│   │   ├── stores/                # Zustand stores
│   │   │   ├── quality.ts
│   │   │   └── shape.ts
│   │   ├── audio.ts
│   │   ├── capabilities.ts
│   │   └── particleCompute.ts
│   │
│   └── hooks/                     # Custom React hooks (future)
│       ├── useEmailAccount.ts
│       └── useRules.ts
│
├── backend/                       # IMPORTED BACKEND (renamed from server/)
│   ├── auth/                      # Authentication
│   │   └── index.ts
│   │
│   ├── db/                        # Database
│   │   ├── client.ts              # Prisma client
│   │   ├── encryption.ts
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   │
│   ├── integrations/              # External service integrations
│   │   ├── ai/                    # AI features (keep as-is)
│   │   │   ├── assistant/
│   │   │   ├── categorize-sender/
│   │   │   ├── choose-rule/
│   │   │   ├── clean/
│   │   │   ├── digest/
│   │   │   ├── document-filing/
│   │   │   ├── group/
│   │   │   ├── knowledge/
│   │   │   ├── mcp/
│   │   │   ├── meeting-briefs/
│   │   │   ├── reply/
│   │   │   ├── report/
│   │   │   ├── rule/
│   │   │   ├── snippets/
│   │   │   └── security.ts
│   │   │
│   │   ├── google/                # Gmail/Calendar/Drive
│   │   │   └── ... (keep as-is)
│   │   │
│   │   ├── microsoft/             # Outlook integration
│   │   │   └── ... (keep as-is)
│   │   │
│   │   └── qstash/                # Queue integration
│   │
│   ├── services/                  # Business logic (CONSOLIDATED)
│   │   ├── auth/                  # Auth services
│   │   ├── email/                 # Email operations
│   │   ├── rules/                 # Rule management
│   │   ├── calendar/              # Calendar operations
│   │   ├── drive/                 # Drive operations
│   │   ├── organization/          # Org management
│   │   ├── billing/               # Payment operations
│   │   └── actions/               # Server actions (from unsubscriber/)
│   │
│   ├── utils/                     # Pure utilities (DEDUPLICATED)
│   │   ├── email/                 # Email utilities
│   │   ├── parse/                 # Parsing utilities
│   │   ├── validation/            # Zod schemas
│   │   ├── redis/                 # Redis utilities
│   │   ├── queue/                 # Queue utilities
│   │   ├── logger.ts
│   │   ├── prisma.ts              # Re-export from db/client
│   │   └── middleware.ts
│   │
│   ├── packages/                  # Standalone packages (keep)
│   │   ├── cli/
│   │   ├── loops/
│   │   ├── resend/
│   │   └── tinybird/
│   │
│   └── types/                     # TypeScript types
│
├── ee/                            # Enterprise features (keep)
│   └── billing/
│       ├── stripe/
│       └── lemon/
│
├── shared/                        # Shared code
│   └── types/                     # Types used by both frontend/backend
│       ├── api.ts                 # API response types
│       └── models.ts              # Shared model types
│
├── __tests__/                     # Tests (keep structure)
│
└── env.ts                         # Environment config
```

---

## Migration Plan

### Phase 1: Create New Structure (Non-Breaking)

1. Create new directories without moving files yet:
   ```bash
   mkdir -p src/frontend/components/experience
   mkdir -p src/frontend/components/ui
   mkdir -p src/frontend/lib/stores
   mkdir -p src/frontend/hooks
   mkdir -p src/shared/types
   ```

2. Update `tsconfig.json` with new path aliases (see below)

### Phase 2: Move Frontend Code

1. Move your 3D components:
   ```
   src/components/*.tsx → src/frontend/components/experience/
   ```

2. Move shaders:
   ```
   src/shaders/ → src/frontend/shaders/
   ```

3. Move frontend utilities:
   ```
   src/lib/*.ts → src/frontend/lib/
   ```

4. Update imports in moved files

### Phase 3: Rename Backend Directory

1. Rename server to backend:
   ```
   src/server/ → src/backend/
   ```

2. Global find/replace for imports:
   ```
   @/server/ → @/backend/
   ```

### Phase 4: Deduplicate Code

1. Remove duplicate files (keep one canonical location)
2. Update all imports to use canonical paths
3. Create re-exports for backward compatibility if needed

### Phase 5: Consolidate Services

1. Merge `utils/actions/` into `services/`
2. Reorganize by domain (email, rules, calendar, etc.)
3. Keep `unsubscriber/` action files as `services/actions/`

---

## Path Alias Configuration

### Updated `tsconfig.json`

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      
      // Frontend aliases
      "@/frontend/*": ["./src/frontend/*"],
      "@/components/*": ["./src/frontend/components/*"],
      "@/shaders/*": ["./src/frontend/shaders/*"],
      "@/lib/*": ["./src/frontend/lib/*"],
      "@/hooks/*": ["./src/frontend/hooks/*"],
      
      // Backend aliases
      "@/backend/*": ["./src/backend/*"],
      "@/db/*": ["./src/backend/db/*"],
      "@/integrations/*": ["./src/backend/integrations/*"],
      "@/services/*": ["./src/backend/services/*"],
      "@/utils/*": ["./src/backend/utils/*"],
      
      // Shared aliases
      "@/shared/*": ["./src/shared/*"],
      
      // Legacy aliases (for gradual migration)
      "@/server/*": ["./src/backend/*"]
    }
  }
}
```

---

## File Deduplication

### Files to Deduplicate

#### 1. `permissions.ts`

**Keep:** `src/backend/integrations/google/permissions.ts`
**Remove:** `src/backend/utils/gmail/permissions.ts`

Update imports:
```typescript
// Before
import { hasPermission } from "@/utils/gmail/permissions";

// After
import { hasPermission } from "@/integrations/google/permissions";
```

#### 2. `permissions.ts` (actions)

**Keep:** `src/backend/services/actions/permissions.ts`
**Remove:** `src/backend/utils/actions/permissions.ts`

#### 3. `cold-email.validation.ts`

**Keep:** `src/backend/services/actions/cold-email.validation.ts`
**Remove:** `src/backend/utils/actions/cold-email.validation.ts`

#### 4. `report.ts`

**Merge:** Combine both files, remove duplicate `fetchGmailLabels` function
**Keep:** `src/backend/services/actions/report.ts`

---

## Import Standardization

### Prisma Client

**Standard pattern:**
```typescript
// Canonical import
import { prisma } from "@/db/client";

// Create re-export for legacy support
// src/backend/utils/prisma.ts
export { prisma } from "@/db/client";
```

### Logger

**Standard pattern:**
```typescript
import { logger } from "@/utils/logger";
```

### Email Provider

**Standard pattern:**
```typescript
import { getEmailProvider } from "@/integrations/google/provider";
// or
import { getEmailProvider } from "@/integrations/microsoft/provider";
```

---

## Cleanup Checklist

### Immediate (Before Building UI)

- [ ] Create `frontend/` directory structure
- [ ] Move 3D components to `frontend/components/experience/`
- [ ] Move shaders to `frontend/shaders/`
- [ ] Move lib files to `frontend/lib/`
- [ ] Update `tsconfig.json` with new aliases
- [ ] Update imports in moved files

### Short-term (During Development)

- [ ] Rename `server/` to `backend/`
- [ ] Update all `@/server/` imports to `@/backend/`
- [ ] Remove duplicate `permissions.ts` files
- [ ] Remove duplicate `cold-email.validation.ts`
- [ ] Merge duplicate `report.ts` functions
- [ ] Standardize Prisma imports

### Medium-term (Code Quality)

- [ ] Consolidate `utils/actions/` with `services/unsubscriber/`
- [ ] Reorganize services by domain
- [ ] Create barrel exports (index.ts files)
- [ ] Add missing types to `shared/types/`
- [ ] Remove unused/dead code

### Long-term (Maintenance)

- [ ] Add ESLint rules for import paths
- [ ] Document folder conventions
- [ ] Set up import sorting
- [ ] Consider monorepo structure if project grows

---

## Alternative: Minimal Changes Approach

If a full restructure is too disruptive, here's a minimal approach:

1. **Keep current structure** but add clear documentation
2. **Only move your frontend code** to `frontend/`
3. **Add path aliases** without renaming folders
4. **Deduplicate files** in place
5. **Standardize imports** gradually

This preserves the imported code structure while still clarifying ownership.

---

## Recommended Approach

**Start with Phase 1-2 only** (frontend reorganization):

1. Create `frontend/` directory
2. Move your 3D code there
3. Add path aliases
4. Leave backend as `server/` for now

This gives you:
- Clear separation of your code
- Minimal risk (backend unchanged)
- Foundation for future cleanup
- Ability to work on frontend without touching backend

Then tackle backend reorganization after initial frontend is built.
