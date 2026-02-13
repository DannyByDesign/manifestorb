# Amodel

**Your AI-powered email and calendar command center.**

Amodel is an intelligent assistant that lives wherever you work—web, Slack, Discord, or Telegram. It understands your inbox and calendar, drafts responses, schedules time, triages tasks, and automates the mundane—while keeping you in control of every action that matters. We're building an AI that eliminates coordination work for executives, EAs, and high-leverage professionals. Our product autonomously manages email correspondence and calendar scheduling—not by making people faster at these tasks, but by handling them entirely. The AI understands context across all communication channels, makes judgment calls within user-defined boundaries, negotiates meeting times, drafts contextually-aware responses, and surfaces only what genuinely requires human decision-making. Users set the strategy and handle exceptions; the AI executes everything else. Success means our customers reclaim 10-15 hours per week previously lost to inbox management and calendar Tetris, allowing them to focus exclusively on high-judgment work that actually moves their goals forward. We go radically deep on specific workflows—starting with executive assistants at tech companies—building something so tailored to their needs that horizontal competitors can't match our value even with better AI models.

---

## What Makes Amodel Different

### AI That Assists, Not Replaces
Amodel uses an agentic AI that understands context. Ask it to *"draft a follow-up to Sarah about the Q3 report"* or *"find 30 minutes this week for the proposal"* and it composes or proposes. **Sending email** is approval-gated: the AI can send only after explicit user approval (in-app or verbal). Human judgment stays in the loop.

### One AI, Every Platform
The same AI assistant works across:
- **Web App** — Dashboard, chat, and 3D experience (Orb)
- **Slack** — Manage email and calendar without leaving your workspace
- **Discord** — For teams that live in Discord
- **Telegram** — Mobile-friendly access anywhere

Ask *"show me my rules"* or *"what should I do next?"* in Slack—get the same answer in the web app.

### Rules + AI = Smart Automation
Create and manage rules via a single polymorphic **rules** tool and rules portal APIs:
- *"Archive newsletters unless they mention product updates"*
- *"Notify me when my boss emails me"*
- *"Label emails from @company.com as Work"*

Rules combine static conditions with AI-powered instructions. Reminders and notification preferences are managed through rules (app-first/sidecar flow).

### User-Controlled Notifications
You decide what deserves a push. Actionable approvals use **secure signed action tokens**; no unsolicited spam.

---

## Core Capabilities

| Feature | Description |
|---------|-------------|
| **Email Management** | Draft, reply, archive, label, trash—all through conversation; send only with explicit approval |
| **Google Calendar** | Event read/write (draft-first), free/busy, watch/webhooks, watch renewal cron, conflict resolution (schedule proposals + verbal selection) |
| **Tasks** | Task model, time-blocking, reschedule engine, **task triage** ("what should I do next?" with rationale + approval-backed actions), panel API |
| **Smart Rules** | Single polymorphic rules tool + rules portal APIs (`/api/rules`, `/api/rules/[id]`) |
| **Cold Email Detection** | Identify and handle unsolicited emails |
| **Newsletter Management** | Categorize and control subscription emails |
| **Thread Tracking** | Monitor conversations for replies |
| **Daily Digest** | Summarized email updates on your schedule |
| **Contacts** | Search and create contacts from context |
| **Actionable Approvals** | Secure action tokens for push/email approval links; triage and send approvals |

### Roadmap
| Feature | Status |
|---------|--------|
| **Daily Briefing** | Flagship (today: meetings + tasks + emails)—planned |
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
│   • Same system prompt across all platforms                 │
│   • Tools: query, get, analyze, create, modify, delete,     │
│     send (approval-gated), rules, triage                    │
│   • Human-in-the-loop for sensitive/DANGEROUS actions       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     INTEGRATIONS                            │
│   Gmail · Google Calendar (implemented)                      │
│   Outlook · Microsoft Calendar (roadmap)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Philosophy

1. **Send Only With Approval** — Email send is a DANGEROUS tool; requires explicit per-email approval (in-app or verbal).
2. **Approval Workflows** — Destructive actions (delete, modify) and triage/send need confirmation; **secure action tokens** for approval links.
3. **Prompt Injection Protection** — Guardrails against malicious email content.
4. **User-Controlled Notifications** — Rule-based reminders and preferences; no unsolicited push.
5. **OAuth Standard** — Secure, revocable access to email and calendar providers.

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
| **AI** | Google (Gemini), OpenAI (GPT/Embeddings) | AI inference + embeddings |
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
│   │   ├── api/                # API routes (chat, drafts, rules, tasks/triage, google/calendar/watch, etc.)
│   │   ├── (dashboard)/        # Dashboard pages
│   │   └── page.tsx            # Main page
│   │
│   ├── components/             # React components
│   │   └── experience/         # 3D experience (Orb, Sparkles, etc.)
│   │
│   ├── lib/                    # Frontend utilities (stores, audio, capabilities)
│   ├── shaders/                # GLSL shaders (orb, particles, sim)
│   ├── hooks/                  # React hooks (e.g. notification poll)
│   │
│   ├── server/                 # Server-only code
│   │   ├── actions/            # Server actions (next-safe-action)
│   │   ├── auth/               # Authentication (WorkOS AuthKit)
│   │   ├── db/                 # Database (Prisma client)
│   │   ├── features/           # Feature modules
│   │   │   ├── ai/             # AI orchestration, system prompt, tools (query, get, analyze, create, modify, delete, send, rules, triage)
│   │   │   ├── web-chat/       # Web UI chat assistant
│   │   │   ├── channels/       # Multi-channel executor (Slack/Discord/Telegram)
│   │   │   ├── calendar/       # Calendar integration (Google; watch, conflict resolution)
│   │   │   ├── tasks/          # Task triage, scheduling, context
│   │   │   ├── email/          # Email provider abstraction
│   │   │   ├── rules/          # Automation rules + AI matching
│   │   │   ├── approvals/      # Human-in-the-loop + secure action tokens
│   │   │   ├── notifications/  # In-app notifications, generator
│   │   │   ├── memory/         # RLM context, embeddings, summaries
│   │   │   └── ...             # reply-tracker, digest, clean, etc.
│   │   ├── integrations/       # External API clients (google, microsoft, qstash)
│   │   ├── lib/                # Server utilities
│   │   ├── packages/           # Internal packages (@amodel/*)
│   │   └── types/              # TypeScript types
│   │
│   ├── enterprise/             # Premium features (Stripe)
│   └── __tests__/              # Test files
│
├── prisma/                     # Schema and migrations
│   ├── schema.prisma
│   └── migrations/
│
├── surfaces/                   # Sidecar service (Slack/Discord/Telegram bots)
│
├── docs/                       # Documentation
│   ├── 01-FEATURES.md          # Feature list and launch prioritization
│   └── ...
│
├── ARCHITECTURE.md             # Codebase architecture (source of truth)
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
| Add or change AI skills/capabilities | `src/server/features/ai/skills/` and `src/server/features/ai/capabilities/` |
| Modify system prompt | `src/server/features/ai/system-prompt.ts` |
| Modify email integration | `src/server/integrations/google/` or `microsoft/` |
| Add server action | `src/server/actions/` |
| Change database schema | `prisma/schema.prisma` (migrate with `bunx prisma migrate dev`) |
| Add a new feature | `src/server/features/[feature-name]/` |
| Surfaces (Slack/Discord/Telegram) | `surfaces/` (sidecar) + `src/server/features/channels/` (executor) |

---

## Path Aliases

Import paths are configured in `tsconfig.json`:

```typescript
// Frontend
import { Scene } from "@/components/experience/Scene";
import { useQuality } from "@/lib/stores/qualityStore";

// Backend
import prisma from "@/server/db/client";
import { processMessage } from "@/features/ai/message-processor";

// Features (server code under src/server/features)
import { aiProcessAssistantChat } from "@/features/web-chat/ai/chat";
import { runOneShotAgent } from "@/features/channels/executor";

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

- **[Architecture](ARCHITECTURE.md)** - Codebase organization and conventions (root)
- **[Features](docs/01-FEATURES.md)** - Complete feature list with implementation status
- **[Issues](docs/04-ISSUES.md)** - Known issues and their status (if present)
