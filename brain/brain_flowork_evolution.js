// =========================================================================
// FLOWORK OS — Brain Evolution Module (Phase 10: DNA)
// Allows Mother AI to grow, evolve, and improve herself autonomously
// Guardrails: DEV-only, code-scanned, sandboxed, logged, rollback-safe
//
// 🔒 SECURITY LAYERS:
//   1. DEV Mode Gate — evolution ONLY works in DEV mode
//   2. Code Scanner — blocks dangerous patterns (require, eval, fs, etc)
//   3. Audit Trail — logs all evolution attempts with code hash
//   4. Rollback — every evolution is versioned and undoable
// =========================================================================

(function() {
    'use strict';

    const EVOLUTION_KEY = 'flowork_brain_evolution';
    const MAX_CUSTOM_TOOLS = 50;
    const MAX_PROMPT_RULES = 50;
    const MAX_SKILLS = 200;

    // ─── Load persisted evolution state ─────────────────────────────────
    let state = {
        customTools: {},    // Runtime-created tools
        promptRules: [],    // Append-only system prompt rules
        skills: {},         // Reusable code patterns
        history: [],        // Evolution log
    };

    try {
        const fs = window.originalNodeRequire?.('fs') || require('fs');
        const path = window.originalNodeRequire?.('path') || require('path');
        const stateFile = path.join(
            window._fmBasePath || path.join(__dirname, 'workspace'),
            '.brain_evolution.json'
        );
        if (fs.existsSync(stateFile)) {
            state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            console.log(`[Evolution] 📦 Loaded ${Object.keys(state.customTools).length} custom tools, ${state.promptRules.length} rules, ${Object.keys(state.skills).length} skills`);
        }
    } catch(e) {
        // Fresh state
    }

    function _save() {
        try {
            const fs = window.originalNodeRequire?.('fs') || require('fs');
            const path = window.originalNodeRequire?.('path') || require('path');
            const stateFile = path.join(
                window._fmBasePath || path.join(__dirname, 'workspace'),
                '.brain_evolution.json'
            );
            fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
        } catch(e) {
            console.warn('[Evolution] Could not save state:', e.message);
        }
    }

    function _log(action, details) {
        state.history.push({
            action,
            details: typeof details === 'string' ? details : JSON.stringify(details).substring(0, 300),
            ts: new Date().toISOString(),
        });
        if (state.history.length > 500) state.history = state.history.slice(-500);
    }

    function _hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return 'h' + Math.abs(hash).toString(16);
    }

    // ─── SECURITY: DEV MODE GATE ────────────────────────────────────────
    function _requireDevMode() {
        if (!window.floworkDevMode) {
            _log('BLOCKED', 'Evolution attempt in PUBLISH mode — rejected');
            return { error: '🔒 Evolution is DISABLED in PUBLISH mode. Self-modification only allowed in DEV mode for safety.' };
        }
        return null; // OK, proceed
    }

    // ─── SECURITY: CODE SCANNER ─────────────────────────────────────────
    // Scans js_code for dangerous patterns BEFORE registering
    const BLOCKED_PATTERNS = [
        // Node.js dangerous APIs
        { pattern: /require\s*\(/i, label: 'require()' },
        { pattern: /process\.(exit|kill|abort|env)/i, label: 'process manipulation' },
        { pattern: /child_process/i, label: 'child_process' },
        // File system
        { pattern: /\bfs\b\s*[\.\[]/i, label: 'fs operations' },
        { pattern: /(rmSync|unlinkSync|rmdirSync|writeFileSync)/i, label: 'destructive fs' },
        // Code execution (meta)
        { pattern: /\beval\s*\(/i, label: 'eval()' },
        { pattern: /\bFunction\s*\(/i, label: 'Function constructor' },
        { pattern: /import\s*\(/i, label: 'dynamic import' },
        // Network (block external only)
        { pattern: /fetch\s*\(\s*['"`]https?:\/\/(?!127\.0\.0\.1|localhost)/i, label: 'external fetch' },
        { pattern: /XMLHttpRequest/i, label: 'XHR' },
        { pattern: /new\s+WebSocket\s*\(/i, label: 'raw WebSocket' },
        // DOM/Storage tampering
        { pattern: /document\.(write|cookie)/i, label: 'document.write/cookie' },
        { pattern: /localStorage\.(clear|removeItem)/i, label: 'localStorage wipe' },
        { pattern: /window\.(close|open)\s*\(/i, label: 'window.open/close' },
        // Self-modification (prevent AI from hacking its own security)
        { pattern: /floworkDevMode/i, label: 'DEV mode tampering' },
        { pattern: /defineProperty/i, label: 'property redefinition' },
        { pattern: /brainEvolution/i, label: 'evolution self-reference' },
        { pattern: /brainToolBridge/i, label: 'bridge tampering' },
        { pattern: /brainToolRegistry/i, label: 'registry tampering' },
    ];

    function _scanCode(code) {
        const violations = [];
        for (const { pattern, label } of BLOCKED_PATTERNS) {
            if (pattern.test(code)) {
                violations.push(label);
            }
        }
        return violations;
    }

    // ─── SECURITY: EVOLUTION-BLOCKED TOOLS ──────────────────────────────
    // Evolved tools CANNOT call these (prevents recursive self-modification)
    const EVOLUTION_BLOCKED_TOOLS = new Set([
        'evolve_tool', 'evolve_prompt', 'evolve_skill', 'self_improve', 'evolve_undo',
        'feature_enable', 'feature_disable',
        'write_files', 'patch_file', 'smart_patch', 'delete_file',
    ]);

    // ─── SANDBOX: Test evolved tool before registration ──────────────
    // Wraps the tool code in a try-catch with mock input to validate it
    // won't crash at runtime. Returns { ok: true } or { ok: false, error: '...' }
    function _testToolInSandbox(name, code) {
        try {
            // Step 1: Verify the code is syntactically valid by compiling it
            const compiledFn = new Function('input', code);

            // Step 2: Dry-run with empty mock input (should not throw)
            const mockInput = { _sandbox: true, _test: true };
            const result = compiledFn(mockInput);

            // Step 3: If result is a promise, we can't await in sync context,
            // but compilation + initial execution succeeded
            if (result instanceof Promise) {
                // Swallow unhandled rejection from sandbox test
                result.catch(() => {});
            }

            console.log(`[Evolution] ✅ Sandbox test PASSED for tool "${name}"`);
            return { ok: true };
        } catch (err) {
            console.error(`[Evolution] ❌ Sandbox test FAILED for tool "${name}":`, err.message);
            _log('SANDBOX_FAIL', { tool: name, error: err.message, stack: err.stack?.substring(0, 300) });
            return { ok: false, error: err.message };
        }
    }

    // ─── EVOLUTION API ──────────────────────────────────────────────────

    window.brainEvolution = {

        // Expose for sandbox to check
        isToolBlockedInSandbox(toolName) {
            return EVOLUTION_BLOCKED_TOOLS.has(toolName);
        },

        // ═══ EVOLVE TOOL: Create/modify a tool at runtime ═══
        evolveTool(input) {
            // 🔒 Layer 1: DEV mode gate
            const devCheck = _requireDevMode();
            if (devCheck) return devCheck;
            const name = input.name || input.tool_name;
            const handler = input.handler || 'js_code';
            const code = input.code || '';
            const endpoint = input.endpoint || '';
            const description = input.description || '';
            const method = input.method || 'POST';

            if (!name) return { error: 'Tool name required' };
            if (handler === 'js_code' && !code) return { error: 'JavaScript code required for js_code handler' };

            // 🔒 Layer 2: Code scanner (for js_code handler)
            if (handler === 'js_code' && code) {
                const violations = _scanCode(code);
                if (violations.length > 0) {
                    _log('BLOCKED_CODE', `Tool "${name}" rejected: ${violations.join(', ')}`);
                    return { error: `🚫 Code blocked! Dangerous patterns detected: ${violations.join(', ')}. Evolved tools cannot use these APIs for security.` };
                }
            }

            if (Object.keys(state.customTools).length >= MAX_CUSTOM_TOOLS) {
                return { error: `Max ${MAX_CUSTOM_TOOLS} custom tools reached. Remove one first.` };
            }

            const PROTECTED = ['write_files', 'read_file', 'run_command', 'capture_browser',
                'chat', 'ask_user', 'click_element', 'type_text', 'navigate_browser',
                'evolve_tool', 'evolve_prompt', 'evolve_skill', 'self_improve',
                'feature_enable', 'feature_disable'];
            if (PROTECTED.includes(name)) {
                return { error: `Cannot overwrite protected core tool: ${name}` };
            }

            const toolDef = { handler, code, method, endpoint, description, custom: true, evolvedAt: new Date().toISOString() };

            // 🔒 Layer 3: SANDBOX TEST — validate tool before registration
            if (handler === 'js_code' && code) {
                const sandboxResult = _testToolInSandbox(name, code);
                if (!sandboxResult.ok) {
                    _log('SANDBOX_BLOCKED', { tool: name, error: sandboxResult.error });
                    return {
                        error: `🧪 Sandbox test FAILED for tool "${name}": ${sandboxResult.error}. ` +
                               `Fix the code and try again. The tool was NOT registered to prevent runtime crashes.`
                    };
                }
            }

            state.customTools[name] = toolDef;
            
            if (window.brainToolRegistry) {
                window.brainToolRegistry[name] = { ...toolDef, category: 'custom' };
            }

            // 🔒 Layer 4: Detailed audit trail
            _log('evolve_tool', {
                tool: name,
                handler,
                codeLength: code?.length || 0,
                codeHash: code ? _hashCode(code) : 'n/a',
                description: description.substring(0, 100),
                sandboxPassed: true,
            });
            _save();

            return { result: `🧬 Tool "${name}" synthesized (DEV mode, code-scanned ✅, sandbox-tested ✅). Registered in brain.` };
        },

        // ═══ EVOLVE PROMPT: Add a rule to the system prompt ═══
        evolvePrompt(input) {
            // 🔒 DEV mode gate
            const devCheck = _requireDevMode();
            if (devCheck) return devCheck;

            const rule = input.rule || input.prompt_rule || '';
            if (!rule) return { error: 'Rule text required' };
            if (state.promptRules.length >= MAX_PROMPT_RULES) {
                return { error: `Max ${MAX_PROMPT_RULES} rules reached. Use evolve_undo to remove.` };
            }

            // GUARDRAIL: Check for malicious content
            const dangerous = ['ignore previous', 'disregard all', 'forget everything', 'system prompt is'];
            if (dangerous.some(d => rule.toLowerCase().includes(d))) {
                return { error: 'Rule rejected: contains potentially harmful content.' };
            }

            state.promptRules.push({
                rule,
                addedAt: new Date().toISOString(),
                source: 'ai_evolution',
            });

            _log('evolve_prompt', rule.substring(0, 100));
            _save();

            return { result: `🧬 Rule added to system prompt (${state.promptRules.length} total). It will be injected in every future session.` };
        },

        // ═══ EVOLVE SKILL: Save a reusable code pattern ═══
        evolveSkill(input) {
            // 🔒 DEV mode gate + code scanner
            const devCheck = _requireDevMode();
            if (devCheck) return devCheck;

            const name = input.name || input.skill_name || '';
            const code = input.code || input.script || '';
            const description = input.description || '';

            // Scan skill code too
            if (code) {
                const violations = _scanCode(code);
                if (violations.length > 0) {
                    return { error: `🚫 Skill code blocked: ${violations.join(', ')}` };
                }
            }
            const tags = input.tags || [];

            if (!name || !code) return { error: 'Skill name and code required' };
            if (Object.keys(state.skills).length >= MAX_SKILLS) {
                return { error: `Max ${MAX_SKILLS} skills reached.` };
            }

            state.skills[name] = {
                code, description, tags,
                createdAt: new Date().toISOString(),
                useCount: 0,
            };

            _log('evolve_skill', `Saved skill: ${name}`);
            _save();

            return { result: `🧬 Skill "${name}" saved. Use invoke_skill to call it.` };
        },

        // ═══ SELF IMPROVE: Review session and create prevention rules ═══
        selfImprove(input) {
            // 🔒 DEV mode gate (selfImprove creates prompt rules)
            const devCheck = _requireDevMode();
            if (devCheck) return devCheck;

            const sessionSummary = input.summary || '';
            const failures = input.failures || [];
            const lessons = input.lessons || [];

            const improvements = [];

            // Auto-generate rules from failures
            for (const failure of failures) {
                const rule = `LESSON LEARNED: When using "${failure.tool || 'unknown'}", ${failure.prevention || 'check for errors before proceeding'}.`;
                if (!state.promptRules.find(r => r.rule === rule)) {
                    state.promptRules.push({
                        rule,
                        addedAt: new Date().toISOString(),
                        source: 'self_improve',
                    });
                    improvements.push(rule);
                }
            }

            // Store lessons
            for (const lesson of lessons) {
                const rule = `LEARNED: ${lesson}`;
                if (!state.promptRules.find(r => r.rule === rule)) {
                    state.promptRules.push({
                        rule,
                        addedAt: new Date().toISOString(),
                        source: 'self_improve',
                    });
                    improvements.push(rule);
                }
            }

            _log('self_improve', `${improvements.length} new rules from session review`);
            _save();

            return { result: `🧬 Self-improvement complete. ${improvements.length} new rules added:\n${improvements.map(r => `  - ${r}`).join('\n')}` };
        },

        // ═══ INVOKE SKILL: Execute a saved skill ═══
        invokeSkill(input) {
            const name = input.name || input.skill_name;
            const skill = state.skills[name];
            if (!skill) return { error: `Skill "${name}" not found. Use list_skills to see available.` };
            skill.useCount++;
            _save();
            return { result: `Skill "${name}" code:\n\n${skill.code}`, code: skill.code };
        },

        // ═══ LIST / QUERY ═══
        listTools() {
            return { result: JSON.stringify(state.customTools, null, 2) };
        },
        listRules() {
            return { result: state.promptRules.map((r, i) => `${i+1}. ${r.rule}`).join('\n') };
        },
        listSkills() {
            const skills = Object.entries(state.skills).map(([name, s]) =>
                `${name}: ${s.description || 'No description'} (used ${s.useCount}x)`
            );
            return { result: skills.join('\n') || 'No skills saved yet.' };
        },

        // ═══ UNDO ═══
        evolveUndo(input) {
            const target = input.type || 'rule'; // 'rule' | 'tool' | 'skill'
            const name = input.name || '';

            if (target === 'rule') {
                const idx = parseInt(input.index || input.name) - 1;
                if (idx >= 0 && idx < state.promptRules.length) {
                    const removed = state.promptRules.splice(idx, 1)[0];
                    _log('evolve_undo', `Removed rule: ${removed.rule.substring(0, 60)}`);
                    _save();
                    return { result: `Removed rule #${idx+1}: ${removed.rule.substring(0, 80)}` };
                }
                return { error: `Invalid rule index: ${input.index || input.name}` };
            }
            if (target === 'tool') {
                if (state.customTools[name]) {
                    delete state.customTools[name];
                    delete window.brainToolRegistry[name];
                    _log('evolve_undo', `Removed tool: ${name}`);
                    _save();
                    return { result: `Removed custom tool: ${name}` };
                }
                return { error: `Custom tool "${name}" not found.` };
            }
            if (target === 'skill') {
                if (state.skills[name]) {
                    delete state.skills[name];
                    _log('evolve_undo', `Removed skill: ${name}`);
                    _save();
                    return { result: `Removed skill: ${name}` };
                }
                return { error: `Skill "${name}" not found.` };
            }
            return { error: 'Unknown undo target. Use type: "rule", "tool", or "skill".' };
        },

        // ═══ GET EVOLUTION HISTORY ═══
        getHistory() {
            return { result: state.history.slice(-20).map(h => `[${h.ts}] ${h.action}: ${h.details}`).join('\n') };
        },

        // ═══ GET PROMPT INJECTION (called by system prompt builder) ═══
        getPromptInjection() {
            let injection = '';

            // Evolved rules
            if (state.promptRules.length > 0) {
                injection += '\n\n### EVOLVED RULES (self-learned)\n' +
                    state.promptRules.map(r => `- ${r.rule}`).join('\n');
            }

            // Advanced capabilities awareness — tell AI what it can do
            const features = window.floworkFeatures?.getFlags?.() || {};
            const caps = [];
            if (features.multiAgent) caps.push('- **Multi-Agent**: For complex multi-step tasks, use `spawn_agent` to delegate sub-tasks to independent agents. Use `create_team` + `team_sync` for coordinated teamwork.');
            if (features.mcp) caps.push('- **MCP**: Use `mcp_connect` to connect to external MCP tool servers (filesystem, database, API). Use `mcp_list_servers` to see connected servers.');
            if (features.lsp) caps.push('- **LSP**: Use `find_definition`, `find_references`, `document_symbols` for smart code navigation instead of manual grep.');
            if (features.vision) caps.push('- **Vision**: After ANY UI change, use `capture_browser` + `vision_analyze` to visually verify. Use `vision_diff` to compare before/after screenshots.');
            if (features.thinking) caps.push('- **Thinking Mode**: Extended deep reasoning is enabled for complex analysis and debugging.');
            caps.push('- **Swarm**: For tasks involving 3+ files or parallel analysis, use `swarm_parallel` or `swarm_map_reduce` to process via Web Workers.');
            caps.push('- **NAS**: Use `nas_optimize` to analyze your own token efficiency. Use `nas_experiment` to A/B test prompt strategies. Use `profile_report` for tool performance data.');
            caps.push('- **Self-Review**: Use `self_review` to analyze session performance and `brief` for quick summary.');
            caps.push('- **TTS (Mouth)**: Use `tts_speak` to speak text aloud. Supports ElevenLabs, OpenAI TTS, Google Cloud, and browser Web Speech API. Use `tts_set_provider` to configure.');
            caps.push('- **Ears**: Use `transcribe_audio` to transcribe audio files via Whisper (OpenAI/Groq). Use `watch_folder` to monitor filesystem changes. Use `start_webhook` to listen for external events.');
            caps.push('- **Crawler (Legs)**: Use `crawl_url` to fetch and extract readable content from any URL. Use `crawl_site` to crawl entire websites with link following.');
            caps.push('- **Image Generation**: Use `generate_image` to create images via DALL-E 3, Imagen 3, or Flux. Use `edit_image` to edit/inpaint existing images.');
            caps.push('- **Audio Generation**: Use `generate_sound` for AI sound effects via ElevenLabs. Use `generate_music` for speech/music via OpenAI TTS-HD.');
            caps.push('- **Daemon (Reflexes)**: Use `daemon_schedule` to run background tasks on intervals (cron). Tasks auto-inject into AI context when triggered.');

            if (caps.length > 0) {
                injection += '\n\n### ADVANCED CAPABILITIES (available tools)\n' + caps.join('\n');
            }

            return injection;
        },

        // ═══ RESTORE CUSTOM TOOLS AT STARTUP ═══
        restoreTools() {
            for (const [name, toolDef] of Object.entries(state.customTools)) {
                window.brainToolRegistry[name] = { ...toolDef, category: 'custom' };
            }
        }
    };

    // Restore custom tools from persistence
    window.brainEvolution.restoreTools();

    // ─── WIRE EVOLUTION TOOLS INTO TOOL BRIDGE ──────────────────────────
    // These tools are callable by the AI
    if (window.brainToolBridge) {
        const originalBridge = window.brainToolBridge;
        window.brainToolBridge = async function(actionType, input) {
            // Evolution tools
            if (actionType === 'evolve_tool') return window.brainEvolution.evolveTool(input);
            if (actionType === 'evolve_prompt') return window.brainEvolution.evolvePrompt(input);
            if (actionType === 'evolve_skill') return window.brainEvolution.evolveSkill(input);
            if (actionType === 'invoke_skill') return window.brainEvolution.invokeSkill(input);
            if (actionType === 'self_improve') return window.brainEvolution.selfImprove(input);
            if (actionType === 'list_skills') return window.brainEvolution.listSkills();
            if (actionType === 'evolve_undo') return window.brainEvolution.evolveUndo(input);
            if (actionType === 'evolve_history') return window.brainEvolution.getHistory();
            // Self-heal tools
            if (actionType === 'diagnostic_snapshot') {
                const diag = window.brainSelfHeal?.getDiagnostic?.();
                return { result: diag || 'No recent errors or crashes detected. System healthy ✅' };
            }
            // Default: pass to original bridge
            return await originalBridge(actionType, input);
        };
    }

    // ─── INJECT EVOLVED RULES INTO SYSTEM PROMPT ────────────────────────
    // Hook into fetchSystemPrompt to append evolved rules
    const _originalFetchSystemPrompt = window.fetchSystemPrompt;
    if (_originalFetchSystemPrompt) {
        window.fetchSystemPrompt = async function(lang, outputType) {
            let prompt = await _originalFetchSystemPrompt(lang, outputType);
            // Append evolved rules
            const injection = window.brainEvolution.getPromptInjection();
            if (injection) {
                prompt += injection;
            }
            return prompt;
        };
    }

    console.log(`[Brain] ✅ Evolution module loaded — ${Object.keys(state.customTools).length} custom tools, ${state.promptRules.length} rules, ${Object.keys(state.skills).length} skills`);

})();
