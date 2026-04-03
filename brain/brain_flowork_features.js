// =========================================================================
// FLOWORK OS — Brain Feature Flags Module
// Enable/disable AI capabilities at runtime.
// =========================================================================

(function () {
    'use strict';

    const STORAGE_KEY = 'flowork_features';
    const MIGRATION_KEY = 'flowork_features_version';
    const CURRENT_VERSION = 6;  // v6: Phase 12 — Complete Body (gateway bridge, team v2, real-time ears, streaming TTS, video gen)

    // Default feature flags — ALL ENABLED (Phase 10: Full Autonomy)
    const DEFAULT_FLAGS = {
        vision: true,               // Screenshot/image analysis
        selfHeal: true,             // Auto-debug from crashes
        evolution: true,            // Self-create tools/rules
        planMode: true,             // Planning mode
        costTracking: true,         // Track API costs
        analytics: true,            // Tool usage analytics
        permissions: true,          // Permission system
        multiAgent: true,           // Multi-agent coordination ✅
        mcp: true,                  // MCP integration (basic) ✅
        voice: true,                // Voice input ✅
        lsp: true,                  // Code intelligence ✅
        plugins: true,              // Plugin system ✅
        thinking: true,             // Extended thinking mode ✅
        autoMemory: true,           // Auto-memory between sessions
        smartCompact: true,         // Smart compaction
        dream: true,                // Dream analysis
        webSearch: true,            // Web search capability
        browserAutomation: true,    // Full browser control
        tts: true,                  // Text-to-Speech output (Mouth) ✅
        ears: true,                 // Whisper + file watch + webhook (Ears) ✅
        crawler: true,              // Smart web crawling (Legs) ✅
        imagegen: true,             // Image generation (Creativity) ✅
        audiogen: true,             // Audio/sound generation (Creativity) ✅
        daemon: true,               // Background tasks + cron (Reflexes) ✅
        // ── Self-Heal Upgrades (Phase 11) ──
        selfHealCircuitBreaker: true,  // Circuit breaker for failing tools/modules ✅
        selfHealCheckpoint: true,      // State checkpoint & restore ✅
        selfHealAutoRetry: true,       // Auto-retry transient failures ✅
        // ── Daemon Upgrades (Phase 11) ──
        daemonCronExpr: true,          // Standard cron expression support ✅
        daemonPersistent: true,        // Persistent jobs (survive restart) ✅
        daemonHooks: true,             // Event-driven hook triggers ✅
        daemonDelivery: true,          // Result delivery (file, webhook, gateway) ✅
        // ── Agent Upgrades (Phase 11) ──
        agentDepthTracking: true,      // Max depth limit for nested agents ✅
        agentOrphanRecovery: true,     // Auto-detect & recover orphan agents ✅
        agentMessaging: true,          // Inter-agent broadcast & collect ✅
        agentTimeout: true,            // Auto-timeout stuck agents (5min) ✅
        // ── Smart Module Bridges (Phase 2) ──
        gateway: true,              // Multi-channel messaging (Discord, Telegram, WhatsApp, Slack) ✅
        subagentsPro: true,         // Advanced sub-agent system (depth tracking, orphan recovery) ✅
        sessions: true,             // Session persistence & restore ✅
        skills: true,               // Skills marketplace & management ✅
        contextGuard: true,         // Context window monitoring & auto-trim ✅
        mcpSmart: true,             // MCP Protocol Client (SSE, WS, Virtual servers) ✅
        redaction: true,            // Payload redaction engine (API keys, secrets) ✅
        mediaPipeline: true,        // Media processing pipeline ✅
        // ── Phase 12: Complete Body Upgrades ──
        gatewayBridge: true,           // Gateway ↔ Brain auto-reply bridge ✅
        teamRoles: true,               // Team roles (PM, Dev, QA, Researcher, Designer) ✅
        teamStrategies: true,          // Team execution strategies (sequential, parallel, pipeline) ✅
        teamTemplates: true,           // Agent template save/load ✅
        teamPersistent: true,          // Persistent teams survive restart ✅
        realtimeMic: true,             // Real-time mic → Whisper streaming ✅
        wakeWord: true,                // "Hey Flowork" wake word detection ✅
        continuousListening: true,     // Always-on speech recognition ✅
        streamingTTS: true,            // Sentence-by-sentence progressive TTS ✅
        ttsLLMHook: true,              // TTS hooked to LLM streaming output ✅
        videogen: true,                // AI video generation (Luma, Runway, Replicate) ✅
        screenRecording: true,         // Screen capture recording ✅
        animationGen: true,            // CSS/Lottie animation generation ✅
        musicGen: true,                // Music generation (Suno, MusicGen) ✅
        voiceClone: true,              // Voice cloning (ElevenLabs) ✅
        audioMix: true,                // Audio mixing/layering ✅
    };

    let flags = { ...DEFAULT_FLAGS };

    // Migration logic: force-update old cached flags to new defaults
    try {
        const savedVersion = parseInt(localStorage.getItem(MIGRATION_KEY) || '0');
        const saved = localStorage.getItem(STORAGE_KEY);

        if (savedVersion < CURRENT_VERSION) {
            // Migration needed — apply new defaults, preserve user overrides for flags that existed before
            if (saved) {
                const parsed = JSON.parse(saved);
                // Only preserve flags the user explicitly changed AFTER they were available
                // For newly enabled flags, force the new default (true)
                const newlyEnabled = ['multiAgent', 'mcp', 'voice', 'lsp', 'plugins', 'thinking', 'tts', 'ears', 'crawler', 'imagegen', 'audiogen', 'daemon', 'gateway', 'subagentsPro', 'sessions', 'skills', 'contextGuard', 'mcpSmart', 'redaction', 'mediaPipeline', 'selfHealCircuitBreaker', 'selfHealCheckpoint', 'selfHealAutoRetry', 'daemonCronExpr', 'daemonPersistent', 'daemonHooks', 'daemonDelivery', 'agentDepthTracking', 'agentOrphanRecovery', 'agentMessaging', 'agentTimeout'];
                flags = { ...DEFAULT_FLAGS };
                for (const [key, val] of Object.entries(parsed)) {
                    if (!newlyEnabled.includes(key)) {
                        flags[key] = val;  // Preserve user's existing preference
                    }
                    // For newly enabled flags: always use DEFAULT (true), ignore old false
                }
            }
            localStorage.setItem(MIGRATION_KEY, String(CURRENT_VERSION));
            console.log(`[Features] 🔄 Migrated feature flags to v${CURRENT_VERSION} — all advanced features ENABLED`);
        } else if (saved) {
            const parsed = JSON.parse(saved);
            flags = { ...DEFAULT_FLAGS, ...parsed };
        }
    } catch (e) { }

    function _save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(flags)); } catch (e) { }
    }

    // ─── Tool Handlers ──────────────────────────────────────────────────

    function featureEnable(input) {
        const name = input.name || input.feature;
        if (!name) return { result: 'Missing feature name. Use feature_list to see available features.' };
        if (!(name in flags)) {
            return { result: `Unknown feature: "${name}". Use feature_list to see available features.` };
        }
        const was = flags[name];
        flags[name] = true;
        _save();

        // Wire special features
        if (name === 'thinking' && window.thinkingMode !== undefined) {
            window.thinkingMode = true;
        }

        console.log(`[Features] ✅ ${name}: ${was} → true`);
        return { result: `✅ Feature "${name}" ENABLED (was: ${was})` };
    }

    function featureDisable(input) {
        const name = input.name || input.feature;
        if (!name) return { result: 'Missing feature name.' };
        if (!(name in flags)) {
            return { result: `Unknown feature: "${name}".` };
        }
        const was = flags[name];
        flags[name] = false;
        _save();

        if (name === 'thinking' && window.thinkingMode !== undefined) {
            window.thinkingMode = false;
        }

        console.log(`[Features] ❌ ${name}: ${was} → false`);
        return { result: `❌ Feature "${name}" DISABLED (was: ${was})` };
    }

    function featureList(input) {
        let report = `🏁 FEATURE FLAGS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        const entries = Object.entries(flags);
        const enabled = entries.filter(([_, v]) => v);
        const disabled = entries.filter(([_, v]) => !v);

        report += `\n✅ ENABLED (${enabled.length}):\n`;
        for (const [name] of enabled) {
            report += `  • ${name}\n`;
        }

        report += `\n❌ DISABLED (${disabled.length}):\n`;
        for (const [name] of disabled) {
            report += `  • ${name}\n`;
        }

        return { result: report };
    }

    function enableThinking(input) {
        flags.thinking = true;
        if (window.thinkingMode !== undefined) window.thinkingMode = true;
        _save();
        return { result: '🧠 Extended thinking mode ENABLED. AI will use deeper reasoning.' };
    }

    function disableThinking(input) {
        flags.thinking = false;
        if (window.thinkingMode !== undefined) window.thinkingMode = false;
        _save();
        return { result: '💨 Thinking mode DISABLED. AI will use faster responses.' };
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkFeatures = {
        featureEnable,
        featureDisable,
        featureList,
        enableThinking,
        disableThinking,
        isEnabled: (name) => flags[name] === true,
        getFlags: () => ({ ...flags }),
    };

    console.log(`[Brain] ✅ Feature Flags loaded (${Object.values(flags).filter(v => v).length}/${Object.keys(flags).length} enabled)`);

})();
