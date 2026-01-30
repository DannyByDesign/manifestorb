# Amodel

> AI-powered email management and automation platform with a stunning 3D visual interface.

---

## What is Amodel?

Amodel is an intelligent email assistant that helps you take control of your inbox through AI-powered automation, smart organization, and contextual insights. Connect your Gmail or Outlook account and let Amodel learn your patterns to automate repetitive tasks, draft replies, and keep you focused on what matters.

### Key Features

**Intelligent Email Automation**
- Create automation rules using natural language (e.g., "Archive all marketing emails older than 7 days")
- AI automatically matches incoming emails to your rules
- Execute actions: archive, label, reply, forward, draft, and more

**AI-Powered Reply Drafting**
- Generate contextual replies based on email thread history
- Learns your writing style for personalized responses
- Integrates calendar availability for scheduling

**Smart Inbox Organization**
- Auto-categorize senders (Newsletter, Marketing, Support, etc.)
- One-click unsubscribe from unwanted senders
- Bulk cleanup tools for old emails

**Meeting Intelligence**
- Receive AI-generated briefings before meetings
- Context about attendees pulled from email history
- Calendar integration for availability

**Document Management**
- Auto-file email attachments to Google Drive
- AI suggests appropriate folders based on content
- Track filed documents

---

## Architecture Overview

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Bun |
| **Framework** | Next.js 16 (App Router) |
| **Frontend** | React 19, React Three Fiber, Three.js, Tailwind CSS |
| **Database** | PostgreSQL + Prisma ORM |
| **Authentication** | Better Auth (Google/Microsoft OAuth) |
| **AI Providers** | Anthropic, OpenAI, Google, Groq, OpenRouter, Ollama |
| **Queue** | Upstash QStash |
| **Cache** | Upstash Redis |
| **Analytics** | Tinybird |
| **Email Sending** | Resend |
| **Payments** | Stripe, Lemon Squeezy |

### Project Structure

```
amodel/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API routes
│   │   ├── page.tsx            # Main page
│   │   └── layout.tsx          # Root layout
│   │
│   ├── components/             # React components (3D experience)
│   ├── shaders/                # GLSL shaders
│   ├── lib/                    # Frontend utilities
│   │
│   ├── server/                 # Backend code
│   │   ├── auth/               # Authentication
│   │   ├── db/                 # Database (Prisma)
│   │   ├── integrations/       # External services
│   │   │   ├── ai/             # AI features
│   │   │   ├── google/         # Gmail/Calendar/Drive
│   │   │   ├── microsoft/      # Outlook
│   │   │   └── qstash/         # Queue
│   │   ├── services/           # Business logic
│   │   ├── packages/           # Standalone packages
│   │   └── utils/              # Utilities
│   │
│   ├── ee/                     # Enterprise features (billing)
│   └── __tests__/              # Tests
│
├── generated/                  # Prisma generated types
├── public/                     # Static assets
└── docs/                       # Documentation
```

---

## Core Capabilities

### 1. Email Provider Integration

**Gmail**
- Full read/write access via Gmail API
- Real-time sync via Pub/Sub webhooks
- Label management, filters, signatures
- Thread-based conversation handling

**Outlook**
- Microsoft Graph API integration
- Subscription-based notifications
- Folder and category management
- Calendar and contacts access

### 2. Automation Rules Engine

Rules can be configured with:

**Conditions**
- Static filters (from, to, subject, body - regex supported)
- AI-powered natural language matching
- Sender group membership
- Category filters

**Actions**
```
ARCHIVE       - Remove from inbox
LABEL         - Apply label/category
REPLY         - Send automatic reply
SEND_EMAIL    - Send new email
FORWARD       - Forward to recipient
DRAFT_EMAIL   - Create draft for review
MARK_SPAM     - Mark as spam
CALL_WEBHOOK  - Trigger external webhook
MARK_READ     - Mark as read
DIGEST        - Add to digest email
MOVE_FOLDER   - Move to folder
```

**System Rules (Built-in)**
- Newsletter detection
- Marketing email handling
- Calendar invites
- Receipts
- Notifications
- Cold email filtering
- Reply tracking (Awaiting Reply, To Reply, FYI)

### 3. AI Features

| Feature | Description |
|---------|-------------|
| **Rule Generation** | Convert natural language to automation rules |
| **Reply Drafting** | Generate contextual email replies |
| **Follow-up Drafts** | Auto-create follow-up drafts |
| **Meeting Briefings** | Context about meeting attendees |
| **Email Summarization** | Summaries for digest emails |
| **Sender Categorization** | Auto-categorize senders |
| **Writing Style Learning** | Learn user's writing patterns |
| **Document Filing** | Auto-file attachments to Drive |
| **Compose Autocomplete** | Real-time composition suggestions |

### 4. Organization & Teams

- Multi-account support (multiple email accounts per user)
- Team workspaces with role-based access (admin/member)
- SSO integration for enterprise
- Invitation system with email notifications

### 5. Analytics & Reporting

- Email behavior analysis
- Response time tracking
- Executive summaries via AI
- Usage statistics and trends

---

## Data Models

### Core Entities

| Model | Description |
|-------|-------------|
| `User` | User account with settings |
| `EmailAccount` | Connected email account (Gmail/Outlook) |
| `Rule` | Automation rule with conditions and actions |
| `Action` | Action to perform when rule matches |
| `ExecutedRule` | Log of rule executions |
| `Group` | Sender group for rule matching |
| `Category` | Sender category (Newsletter, Marketing, etc.) |
| `Label` | Gmail/Outlook label/folder |
| `Knowledge` | User knowledge base for AI |
| `Chat` | AI assistant conversation |

### Supporting Entities

| Model | Description |
|-------|-------------|
| `Organization` | Team workspace |
| `Member` | Organization membership |
| `Invitation` | Pending invitations |
| `CalendarConnection` | Calendar OAuth connection |
| `DriveConnection` | Drive OAuth connection |
| `MeetingBriefing` | Generated meeting context |
| `DocumentFiling` | Filed document record |
| `Digest` | Email digest |
| `Premium` | Subscription status |
| `Payment` | Payment history |

---

## API Routes

### AI Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/api/ai/analyze-sender-pattern` | POST | Analyze sender patterns |
| `/api/ai/compose-autocomplete` | POST | Autocomplete suggestions |
| `/api/ai/digest` | POST | Generate digest summary |
| `/api/ai/models` | GET | List available AI models |
| `/api/ai/summarise` | POST | Summarize email content |

### Email Operations

| Route | Method | Description |
|-------|--------|-------------|
| `/api/clean` | POST | Process cleanup jobs |
| `/api/clean/gmail` | POST | Execute Gmail cleanup |
| `/api/clean/history` | GET | Get cleanup history |

### Google Integration

| Route | Method | Description |
|-------|--------|-------------|
| `/api/google/calendar/auth-url` | GET | Calendar OAuth URL |
| `/api/google/calendar/callback` | GET | Calendar OAuth callback |
| `/api/google/contacts` | GET | Search contacts |
| `/api/google/drive/auth-url` | GET | Drive OAuth URL |
| `/api/google/drive/callback` | GET | Drive OAuth callback |
| `/api/google/watch/renew` | POST | Renew Gmail watch |
| `/api/google/webhook` | POST | Gmail push notifications |

### Notifications

| Route | Method | Description |
|-------|--------|-------------|
| `/api/resend/digest` | GET/POST | Send digest email |
| `/api/resend/summary` | GET/POST | Send summary email |

---

## Environment Variables

### Required

```bash
# Database
DATABASE_URL=postgresql://...

# Auth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
EMAIL_ENCRYPT_SECRET=...
EMAIL_ENCRYPT_SALT=...

# AI Provider (at least one)
ANTHROPIC_API_KEY=...
# or OPENAI_API_KEY, GOOGLE_API_KEY, etc.

# Gmail Push Notifications
GOOGLE_PUBSUB_TOPIC_NAME=...

# Internal
INTERNAL_API_KEY=...
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### Optional

```bash
# Microsoft/Outlook
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...

# Queue & Cache
UPSTASH_REDIS_URL=...
QSTASH_TOKEN=...

# Analytics
TINYBIRD_TOKEN=...
POSTHOG_API_SECRET=...

# Payments
STRIPE_SECRET_KEY=...
LEMON_SQUEEZY_API_KEY=...

# Email Sending
RESEND_API_KEY=...
```

See `src/env.ts` for the complete list with validation schemas.

---

## Getting Started

### Prerequisites

- Bun 1.2.2+
- PostgreSQL database
- Google Cloud project with Gmail API enabled

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd amodel

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your values

# Run database migrations
bunx prisma migrate dev

# Start development server
bun dev
```

### Development

```bash
# Run dev server
bun dev

# Run tests
bun test

# Generate Prisma client
bunx prisma generate

# Database studio
bunx prisma studio
```

---

## Frontend Architecture

### 3D Visual Experience

The frontend features a GPU-accelerated 3D interactive experience built with:

- **React Three Fiber** - React renderer for Three.js
- **Custom Shaders** - Raymarched SDF volumetric glass orb
- **GPU Particles** - 25,000 particles with physics simulation
- **Adaptive Quality** - Automatic quality tiers based on device

### Key Components

| Component | Description |
|-----------|-------------|
| `Scene` | Main canvas and quality detection |
| `Orb` | Raymarched glass orb with shape morphing |
| `Sparkles` | GPU-computed particle system |
| `Effects` | Post-processing (vignette, noise) |

### Shader System

```
shaders/
├── lib/
│   ├── common.glsl    # Math utilities
│   ├── noise.glsl     # Simplex noise
│   └── sdf.glsl       # SDF primitives
├── orb.vert/frag      # Orb shaders
├── sparkles.vert/frag # Particle shaders
└── sim/               # Fluid simulation (future)
```

---

## Premium Tiers

| Tier | Features |
|------|----------|
| **Free** | Basic automation, limited AI credits |
| **Basic** | More rules, increased AI credits |
| **Pro** | Advanced features, higher limits |
| **Business** | Team features, SSO |
| **Business Plus** | Enterprise features |
| **Copilot** | Full AI assistant access |
| **Lifetime** | Perpetual access |

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

---

## License

[License information to be added]

---

## Support

For support, contact: [support email to be added]
