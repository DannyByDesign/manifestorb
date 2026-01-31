# Amodel

AI-powered email management and automation platform with a stunning 3D visual interface.

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

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │  components/  │  │     lib/      │  │   shaders/    │        │
│  │  React + R3F  │  │ Stores/Hooks  │  │     GLSL      │        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      app/ (Next.js)                              │
│  ┌───────────────────────┐    ┌───────────────────────┐         │
│  │   Pages (*.tsx)       │    │   API Routes          │         │
│  │   React components    │    │   app/api/**          │         │
│  │   rendered on client  │    │   runs on server      │         │
│  └───────────────────────┘    └───────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                  │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │    server/    │  │ integrations/ │  │   services/   │        │
│  │   db, utils   │  │ Google, AI    │  │ Business logic│        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                           │
│  PostgreSQL │ Gmail API │ Outlook API │ AI Providers │ Redis    │
└─────────────────────────────────────────────────────────────────┘
```

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
# Edit .env with your credentials

# Run database migrations
bunx prisma migrate dev

# Start development server
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

---

## Key Features

- **Agentic Tools** - Direct AI manipulation of email and calendar
- **Email Automation** - AI-powered rules to manage your inbox
- **Reply Drafting** - Generate contextual replies with AI
- **Meeting Briefings** - Get context before meetings
- **Smart Categorization** - Auto-organize senders
- **One-click Unsubscribe** - Clean up unwanted emails
- **Multi-provider Support** - Gmail and Outlook
- **Beautiful 3D UI** - GPU-accelerated visual experience

---

## Environment Variables

Required for basic functionality:

```bash
DATABASE_URL              # PostgreSQL connection
GOOGLE_CLIENT_ID          # Google OAuth
GOOGLE_CLIENT_SECRET      # Google OAuth  
EMAIL_ENCRYPT_SECRET      # Token encryption
EMAIL_ENCRYPT_SALT        # Token encryption
GOOGLE_PUBSUB_TOPIC_NAME  # Gmail webhooks
INTERNAL_API_KEY          # Server-to-server auth
NEXT_PUBLIC_BASE_URL      # App URL
```

See `src/env.ts` for the complete list with validation.
