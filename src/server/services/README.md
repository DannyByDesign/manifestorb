# Services Layer (`src/server/services/`)

The Services layer contains the core business logic of the application. It is designed to be provider-agnostic where possible, handling domain operations independent of the mechanism (API, AI) that triggered them.

## Modules

### 1. `email/`
Abstracts email operations.
- **Provider Factory**: `provider.ts` selects between Gmail and Outlook implementations.
- **Threading**: Logic for grouping messages into threads.

### 2. `unsubscriber/`
The "Ferrari" engine for automation rules and bulk actions.
- **Rules**: CRUD operations for automation rules (`rule.ts`).
- **Execution**: Bulk processing logic (`execute.ts`).
- **Reporting**: Analytical data for Unsubscriber reports (`report.ts`).
- **Knowledge**: Knowledge base management (`knowledge/`).

### 3. `notification/`
Handles user alerts and approvals.
- **Push**: Web push notification logic.
- **Approvals**: Secure token generation for actionable notifications.

### 4. `billing/`
Stripe integration and subscription management.
