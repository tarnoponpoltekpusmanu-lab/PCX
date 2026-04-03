// brain_flowork_shims/bun-bundle.ts
// Replaces Bun's compile-time feature() with runtime config

const FEATURE_FLAGS: Record<string, boolean> = {
  // Core features we WANT enabled in Flowork
  COORDINATOR_MODE: true,    // Multi-agent coordination
  HISTORY_SNIP: true,        // Smart context compaction
  MCP_SKILLS: true,          // MCP protocol support
  WORKFLOW_SCRIPTS: true,    // Workflow automation
  BRIDGE_MODE: true,         // Bridge to Go backend
  
  // Features we DON'T need (disabled)
  PROACTIVE: false,
  KAIROS: false,
  KAIROS_BRIEF: false,
  KAIROS_GITHUB_WEBHOOKS: false,
  DAEMON: false,
  VOICE_MODE: false,
  AGENT_TRIGGERS: false,
  MONITOR_TOOL: false,
  ABLATION_BASELINE: false,
  DUMP_SYSTEM_PROMPT: false,
  BG_SESSIONS: false,
  CCR_REMOTE_SETUP: false,
  EXPERIMENTAL_SKILL_SEARCH: false,
  ULTRAPLAN: false,
  TORCH: false,
  UDS_INBOX: false,
  FORK_SUBAGENT: false,
  BUDDY: false,
  REACTIVE_COMPACT: false,
}

export function feature(name: string): boolean {
  return FEATURE_FLAGS[name] ?? false
}
