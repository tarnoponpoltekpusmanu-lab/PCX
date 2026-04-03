# Prompt 05: Environment Configuration & API Authentication

## Context

You are working in `/workspaces/flowork-engine`. The CLI needs an FloworkOS API key to function. The auth system supports multiple backends:
- **Direct API** (`FLOWORKOS_API_KEY`) — simplest
- **OAuth** (Claude.ai subscription) — complex browser flow
- **AWS Bedrock** — `AWS_*` env vars
- **Google Vertex AI** — GCP credentials
- **Azure Foundry** — `FLOWORKOS_FOUNDRY_API_KEY`

## Task

### Part A: Create `.env` file from the existing code

Search the codebase for all environment variables used. Key files to check:
- `src/entrypoints/cli.tsx` (reads env vars at top level)
- `src/services/api/client.ts` (API client construction)
- `src/utils/auth.ts` (authentication)
- `src/utils/config.ts` (config loading)
- `src/constants/` (any hardcoded config)
- `src/entrypoints/init.ts` (initialization reads)

Create a `.env.example` file (or update the existing one if it exists) with ALL discoverable env vars, organized by category, with documentation comments. At minimum include:

```env
# ─── Authentication ───
FLOWORKOS_API_KEY=           # Required: Your FloworkOS API key (sk-ant-...)

# ─── API Configuration ───
FLOWORKOS_BASE_URL=          # Custom API endpoint (default: https://api.floworkos.com)
FLOWORKOS_MODEL=             # Override default model (e.g., claude-sonnet-4-20250514)
FLOWORKOS_SMALL_FAST_MODEL=  # Model for fast/cheap operations (e.g., claude-haiku)

# ─── Feature Flags (used by bun:bundle shim) ───
FLOWORK_ENGINE_PROACTIVE=false
FLOWORK_ENGINE_BRIDGE_MODE=false
FLOWORK_ENGINE_COORDINATOR_MODE=false
FLOWORK_ENGINE_VOICE_MODE=false

# ─── Debug ───
FLOWORK_ENGINE_DEBUG_LOG_LEVEL=  # debug, info, warn, error
DEBUG=false
```

### Part B: Trace the API client setup

Read `src/services/api/client.ts` to understand how the FloworkOS SDK is initialized. Document:
1. What env vars it reads
2. How it selects between API backends (direct, Bedrock, Vertex, etc.)
3. Where the API key comes from (env var? keychain? OAuth token?)

Create a comment block at the top of `.env.example` explaining how auth works.

### Part C: Create a minimal auth test

Create `scripts/test-auth.ts`:
```ts
// scripts/test-auth.ts
// Quick test that the API key is configured and can reach FloworkOS
// Usage: bun scripts/test-auth.ts

import FloworkOS from '@floworkos-ai/sdk'

const client = new FloworkOS({
  apiKey: process.env.FLOWORKOS_API_KEY,
})

async function main() {
  try {
    const msg = await client.messages.create({
      model: process.env.FLOWORKOS_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
    })
    console.log('✅ API connection successful!')
    console.log('Response:', msg.content[0].type === 'text' ? msg.content[0].text : msg.content[0])
  } catch (err: any) {
    console.error('❌ API connection failed:', err.message)
    process.exit(1)
  }
}

main()
```

### Part D: Stub OAuth for development

The OAuth flow (`src/services/oauth/`) requires browser interaction and FloworkOS's OAuth endpoints. For development, we want to bypass it. 

Search for where the auth decision is made (likely in `src/utils/auth.ts` or `src/entrypoints/init.ts`). Document what would need to be stubbed to skip OAuth and use only `FLOWORKOS_API_KEY`.

Don't modify source files yet — just document findings in a comment at the bottom of `.env.example`.

## Verification

1. `.env.example` exists with comprehensive env var documentation
2. `scripts/test-auth.ts` exists
3. With a valid `FLOWORKOS_API_KEY` set: `bun scripts/test-auth.ts` prints success
4. Without an API key: `bun scripts/test-auth.ts` prints a clear error
