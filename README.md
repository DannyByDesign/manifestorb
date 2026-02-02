# Amodel

**Your AI-powered email command center.**

Amodel is an intelligent email assistant that lives wherever you work—web, Slack, Discord, or Telegram. It understands your inbox, drafts responses, organizes files, and automates the mundane, while keeping you in control of every action that matters.

---

## What Makes Amodel Different

### AI That Assists, Not Replaces
Unlike traditional automation, Amodel uses an agentic AI that understands context. Ask it to *"draft a follow-up to Sarah about the Q3 report"* and it will compose a contextual response. But **the AI never sends emails directly**—you review, edit, and send. Human judgment stays in the loop.

### One AI, Every Platform
The same AI assistant works across:
- **Web App** — Full dashboard with 3D visual interface
- **Slack** — Manage email without leaving your workspace
- **Discord** — For teams that live in Discord
- **Telegram** — Mobile-friendly access anywhere

Ask *"show me my rules"* in Slack, get the same answer in the web app.

### Rules + AI = Smart Automation
Create rules using natural language:
- *"Archive newsletters unless they mention product updates"*
- *"Notify me when my boss emails me"*
- *"Label emails from @company.com as Work"*

Rules combine static conditions (from/to/subject) with AI-powered instructions—automation that actually understands your intent.

### User-Controlled Notifications
You decide what deserves a push notification. No hardcoded spam. Tell the AI *"remind me when this client responds"* and it creates a rule. Your inbox, your rules.

---

## Core Capabilities

| Feature | Description |
|---------|-------------|
| **Email Management** | Draft, reply, archive, label, trash—all through conversation |
| **Document Filing** | Auto-file attachments to Google Drive with AI categorization |
| **Smart Rules** | Natural language automation with AI + static conditions |
| **Cold Email Detection** | Identify and handle unsolicited emails |
| **Newsletter Management** | Categorize and control subscription emails |
| **Thread Tracking** | Monitor conversations for replies |
| **Daily Digest** | Summarized email updates on your schedule |
| **Contacts** | Search and create contacts from context |

### Coming Soon
| Feature | Status |
|---------|--------|
| **Google Calendar** | Integration in progress |
| **Microsoft Outlook** | On roadmap |
| **Microsoft Calendar** | On roadmap |

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                        USER                                 │
│   Web App  ·  Slack  ·  Discord  ·  Telegram               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    UNIFIED AI AGENT                         │
│   • Same personality across all platforms                   │
│   • Tool-calling architecture (read, draft, organize)       │
│   • Human-in-the-loop for sensitive actions                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     INTEGRATIONS                            │
│   Gmail · Google Drive · Google Calendar (soon)            │
│   Outlook · OneDrive · Microsoft Calendar (roadmap)         │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Philosophy

1. **AI Never Sends Directly** — Drafts require explicit user approval
2. **Approval Workflows** — Destructive actions (delete, modify) need confirmation
3. **Prompt Injection Protection** — Guardrails against malicious email content
4. **User-Controlled Notifications** — No unsolicited push notifications
5. **OAuth Standard** — Secure, revocable access to email providers

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
