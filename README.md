# Amodel

AI-powered email management and automation platform with a stunning 3D visual interface.

---

## Capabilities

The system is powered by an **Agentic AI** (`src/server/integrations/ai`) that interacts with your data through a set of polymorphic tools. Below are the verified capabilities implemented in the codebase:

### 1. Email Management ("The Hands")
-   **Drafting & Replies**: The Agent can create drafts (`create.ts`) and implicitly gathering historical context for replies (`reply-context-collector.ts`).
-   **Bulk Actions**: Supports bulk archiving, trashing, and labeling of specific senders (`modify.ts`).
-   **Reply Tracking**: Can monitor threads for replies and update status (`AWAITING_REPLY` via `modify.ts`).
-   **Unsubscribe**: One-click unsubscribe functionality that handles the logic server-side (`modify.ts`).
-   **Cleanup**: AI-powered suggestions for cleaning up the inbox (`analyze.ts` -> `aiClean`).
-   **Categorization**: Intelligent sender categorization (`analyze.ts` -> `aiCategorizeSenders`).

### 2. Calendar Intelligence ("The Brain")
-   **Meeting Briefings**: Generates detailed briefings for upcoming events by analyzing related emails and documents (`analyze.ts` -> `gatherMeetingContext`).
-   *(Note: Calendar features not built out fully).*

### 3. File System ("The Archivist")
-   **Document Filing**: Automatically processes email attachments, analyzes them, and files them to Google Drive (`create.ts` -> `processAttachment`).
-   **Search**: Natural language search for files in Google Drive & OneDrive (`query.ts` -> `searchFiles`).
-   **Management**: Create folders and move files to organize your cloud storage (`create.ts`, `modify.ts`).

### 4. Contacts System ("The Network")
-   **Search**: Find people across Google Contacts and Outlook (`query.ts` -> `searchContacts`).
-   **Management**: Create new contacts directly from conversation context (`create.ts` -> `createContact`).

### 4. Notifications & Approvals ("The Guardrails")
-   **Smart Notifications**: Generates and sends context-aware push notifications to the user (`create.ts` -> `generateNotification`).
-   **Approvals**: Manages sensitive actions via an approval system. The Agent can list, view, and execute decisions on approval requests (`modify.ts` -> `ApprovalService`).

### 5. Automation ("The Second Brain")
-   **Pattern Detection**: Analyzes email history to detect recurring patterns and suggest new rules (`analyze.ts` -> `aiDetectRecurringPattern`).
-   **Rule Engine**: Deterministic rules that act as guardrails for the AI, ensuring consistent behavior (`tools/providers/automation.ts`).

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Runtime** | Bun | Fast JavaScript runtime & package manager |
| **Framework** | Next.js 16 (App Router) | Full-stack React framework |
| **Frontend** | React 19, React Three Fiber, Three.js | UI & 3D graphics |
| **Styling** | Tailwind CSS 4 | Utility-first CSS |
| **Animation** | GSAP | Smooth animations |
| **State** | Zustand | Lightweight state management |
| **Database** | PostgreSQL + Prisma | Data persistence & ORM |
| **Auth** | Better Auth | OAuth authentication |
| **AI** | Anthropic, OpenAI, Google, Groq, OpenRouter | Multi-provider AI |
| **Queue** | Upstash QStash | Background job processing |
| **Cache** | Upstash Redis | Caching & rate limiting |
| **Email** | Resend, Loops | Transactional & marketing email |
| **Analytics** | Tinybird, PostHog | Event tracking & analytics |
| **Payments** | Stripe | Subscription billing |

---

## Directory Structure

```
amodel/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API routes (BACKEND)
│   │   │   ├── ai/             # AI endpoints
│   │   │   ├── google/         # Google OAuth & webhooks
│   │   │   ├── clean/          # Email cleanup
│   │   │   └── resend/         # Email sending
│   │   ├── page.tsx            # Main page (FRONTEND)
│   │   ├── layout.tsx          # Root layout
│   │   └── globals.css         # Global styles
│   │
│   ├── components/             # React components (FRONTEND)
│   │   └── experience/         # 3D experience
│   │       ├── Scene.tsx       # Main canvas setup
│   │       ├── Orb.tsx         # Raymarched glass orb
│   │       ├── Sparkles.tsx    # GPU particle system
│   │       ├── Effects.tsx     # Post-processing
│   │       └── HaloDust.tsx    # Particle halo
│   │
│   ├── lib/                    # Frontend utilities (FRONTEND)
│   │   ├── stores/             # Zustand state stores
│   │   │   ├── qualityStore.ts # Quality tier management
│   │   │   └── shapeStore.ts   # Shape morphing state
│   │   ├── audio.ts            # Web Audio API
│   │   ├── capabilities.ts     # WebGL detection
│   │   └── particleCompute.ts  # GPU particle simulation
│   │
│   ├── shaders/                # GLSL shaders (FRONTEND)
│   │   ├── lib/                # Shader utilities
│   │   │   ├── common.glsl     # Math functions
│   │   │   ├── noise.glsl      # Noise functions
│   │   │   └── sdf.glsl        # SDF primitives
│   │   ├── orb.vert/frag       # Orb shaders
│   │   ├── sparkles.vert/frag  # Particle shaders
│   │   └── sim/                # Simulation shaders
│   │
│   ├── server/                 # Server-only code (BACKEND)
│   │   ├── auth/               # Authentication
│   │   ├── db/                 # Database
│   │   │   ├── client.ts       # Prisma client
│   │   │   └── encryption.ts   # Token encryption
│   │   ├── integrations/       # External services
│   │   │   ├── ai/             # AI features
│   │   │   │   ├── assistant/  # Chat assistant
│   │   │   │   ├── reply/      # Reply drafting
│   │   │   │   ├── rule/       # Rule generation
│   │   │   │   ├── tools/      # Agentic tools & providers
│   │   │   │   └── ...
│   │   │   ├── google/         # Gmail, Calendar, Drive
│   │   │   ├── microsoft/      # Outlook
│   │   │   └── qstash/         # Queue
│   │   ├── services/           # Business logic
│   │   │   ├── email/          # Email operations
│   │   │   └── unsubscriber/   # Server actions
│   │   ├── packages/           # Standalone packages
│   │   │   ├── cli/            # CLI tool
│   │   │   ├── resend/         # Email templates
│   │   │   └── tinybird/       # Analytics
│   │   ├── types/              # TypeScript types
│   │   └── utils/              # Server utilities
│   │
│   ├── enterprise/             # Premium features (BACKEND)
│   │   └── billing/
│   │       ├── stripe/         # Stripe integration

│   │
│   ├── __tests__/              # Test files
│   └── env.ts                  # Environment config
│
├── prisma/                     # Prisma schema & migrations (source of truth)
│   ├── schema.prisma           # Database schema
│   └── migrations/             # Database migrations
├── generated/                  # Auto-generated code (don't edit)
│   └── prisma/                 # Generated Prisma types
├── public/                     # Static assets
├── docs/                       # Documentation
│   ├── 01-FEATURES.md          # Feature list & status
├── scripts/                    # Utility scripts
├── surfaces/                   # Sidecar service (Slack/Discord/Telegram)
└── .env                        # Environment variables
```

---

## Frontend vs Backend Quick Reference

| I want to... | Look in... |
|--------------|------------|
| Edit the 3D orb | `src/components/experience/Orb.tsx` |
| Change particle behavior | `src/lib/particleCompute.ts` |
| Modify shaders | `src/shaders/` |
| Add a React component | `src/components/` |
| Add client-side state | `src/lib/stores/` |
| Create an API endpoint | `src/app/api/` |
| Add email automation logic | `src/server/integrations/ai/` |
| Modify Agentic Tools | `src/server/integrations/ai/tools/` |
| Modify Gmail integration | `src/server/integrations/google/` |
| Change database schema | `prisma/schema.prisma` |
| Add a server action | `src/server/services/unsubscriber/` |
| Modify billing | `src/enterprise/stripe/` |

---

## Path Aliases

Import paths are configured in `tsconfig.json`:

```typescript
// Frontend
import { Scene } from "@/components/experience/Scene";
import { useQuality } from "@/lib/stores/qualityStore";

// Backend  
import { prisma } from "@/server/db/client";
import { aiGenerateReply } from "@/server/integrations/ai/reply/draft-reply";
import { createAgentTools } from "@/server/integrations/ai/tools";

// Packages
import { sendEmail } from "@amodel/resend";

// Enterprise
import { syncStripe } from "@/enterprise/stripe";
```

---

## Getting Started

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env

# Run database migrations
bunx prisma migrate dev

# Start development server
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.
