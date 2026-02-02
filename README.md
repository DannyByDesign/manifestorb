# Amodel

AI-powered email management and automation platform with a stunning 3D visual interface.

---

## Capabilities

The system is powered by an **Agentic AI** that interacts with your data through a set of polymorphic tools. Below are the verified capabilities:

### 1. Email Management
- **Drafting & Replies**: Create drafts and contextual replies
- **Bulk Actions**: Archive, trash, and label operations
- **Reply Tracking**: Monitor threads for responses
- **Cleanup**: AI-powered inbox cleanup suggestions
- **Categorization**: Intelligent sender categorization

### 2. Calendar Intelligence
- **Meeting Briefings**: Generate briefings by analyzing related emails
- *(Note: Calendar features still in development)*

### 3. File System
- **Document Filing**: Auto-file attachments to Google Drive
- **Search**: Natural language search for files
- **Management**: Create folders and organize storage

### 4. Contacts System
- **Search**: Find people across Google/Outlook contacts
- **Management**: Create contacts from conversation context

### 5. Notifications & Approvals
- **Omnichannel Delivery**: Notifications across Web, Slack, Discord, Telegram
- **Approvals**: Human-in-the-loop approval system for sensitive actions

### 6. Multi-Channel AI Agent
- **Unified Agent**: Same AI personality across Web, Slack, Discord, and Telegram
- **Draft Review**: AI creates drafts, users review and send via interactive buttons
- **Interactive Surfaces**: Rich previews with Send/Edit/Discard actions

### 7. Automation
- **Pattern Detection**: Suggest automation rules from email patterns
- **Rule Engine**: Deterministic rules as guardrails for AI

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Runtime** | Bun | Fast JavaScript runtime & package manager |
| **Framework** | Next.js (App Router) | Full-stack React framework |
| **Frontend** | React, React Three Fiber, Three.js | UI & 3D graphics |
| **Styling** | Tailwind CSS | Utility-first CSS |
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
│   │   ├── api/                # API routes
│   │   ├── (dashboard)/        # Dashboard pages
│   │   └── page.tsx            # Main page
│   │
│   ├── components/             # React components
│   │   └── experience/         # 3D experience (Orb, Sparkles, etc.)
│   │
│   ├── lib/                    # Frontend utilities
│   │   ├── stores/             # Zustand state stores
│   │   ├── audio.ts            # Web Audio API
│   │   └── capabilities.ts     # WebGL detection
│   │
│   ├── shaders/                # GLSL shaders
│   │   ├── lib/                # Shader utilities
│   │   └── sim/                # Simulation shaders
│   │
│   ├── hooks/                  # React hooks
│   │
│   ├── server/                 # Server-only code
│   │   ├── actions/            # Server actions (next-safe-action)
│   │   ├── auth/               # Authentication (better-auth)
│   │   ├── db/                 # Database (Prisma client)
│   │   ├── features/           # Feature modules
│   │   │   ├── ai/             # AI orchestration & tools
│   │   │   ├── web-chat/       # Web UI chat assistant
│   │   │   ├── surfaces/       # Multi-channel agent (Slack/Discord/Telegram)
│   │   │   ├── email/          # Email provider abstraction
│   │   │   ├── calendar/       # Calendar integration
│   │   │   ├── drive/          # Drive integration
│   │   │   ├── rules/          # Automation rules
│   │   │   ├── approvals/      # Human-in-the-loop approvals
│   │   │   └── ...             # Other features
│   │   ├── integrations/       # External API clients
│   │   │   ├── google/         # Gmail, Calendar, Drive
│   │   │   ├── microsoft/      # Outlook, Graph API
│   │   │   └── qstash/         # Queue service
│   │   ├── lib/                # Server utilities
│   │   ├── packages/           # Internal packages (@amodel/*)
│   │   ├── scripts/            # Utility scripts
│   │   └── types/              # TypeScript types
│   │
│   ├── enterprise/             # Premium features
│   │
│   └── __tests__/              # Test files
│
├── generated/                  # Auto-generated code
│   └── prisma/                 # Prisma types
│
├── surfaces/                   # Sidecar service (Slack/Discord/Telegram)
│
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md         # Codebase architecture (source of truth)
│   ├── 01-FEATURES.md          # Feature list
│   └── ...
│
└── scripts/                    # Root-level scripts
```

---

## Quick Reference

| I want to... | Look in... |
|--------------|------------|
| Edit the 3D orb | `src/components/experience/Orb.tsx` |
| Modify shaders | `src/shaders/` |
| Add a React component | `src/components/` |
| Add client-side state | `src/lib/stores/` |
| Create an API endpoint | `src/app/api/` |
| Add AI logic | `src/server/features/ai/` |
| Modify email integration | `src/server/integrations/google/` or `microsoft/` |
| Add server action | `src/server/actions/` |
| Change database schema | `generated/prisma/` (schema in Prisma Studio) |
| Add a new feature | `src/server/features/[feature-name]/` |

---

## Path Aliases

Import paths are configured in `tsconfig.json`:

```typescript
// Frontend
import { Scene } from "@/components/experience/Scene";
import { useQuality } from "@/lib/stores/qualityStore";

// Backend
import prisma from "@/server/db/client";
import { createAgentTools } from "@/features/ai/tools";
import { createRuleManagementTools } from "@/features/ai/rule-tools";

// Features
import { aiProcessAssistantChat } from "@/features/web-chat/ai/chat";
import { runOneShotAgent } from "@/features/surfaces/executor";

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

---

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** - Codebase organization and conventions
- **[Features](docs/01-FEATURES.md)** - Complete feature list with implementation status
- **[Issues](docs/04-ISSUES.md)** - Known issues and their status
