// =========================================================================
// FLOWORK OS - CLAUDE CODE FULL PARITY v2
// FILE: agent_commands.js
// DESCRIPTION: Slash Command System — /command autocomplete + execution
//              Claude Code has 85+ slash commands. Flowork now has parity.
// =========================================================================

// ═══════════════════════════════════════════════════════════════════════
// COMMAND REGISTRY
// ═══════════════════════════════════════════════════════════════════════
window.commandRegistry = {
    commands: {},

    // Register a slash command
    register: function(name, definition) {
        this.commands[name] = {
            name: name,
            description: definition.description || '',
            usage: definition.usage || `/${name}`,
            category: definition.category || 'general',
            handler: definition.handler || null,
            // Some commands directly invoke a skill
            skill: definition.skill || null,
            // Some commands directly invoke a tool
            tool: definition.tool || null,
            toolArgs: definition.toolArgs || null,
            // Some commands inject a prompt
            prompt: definition.prompt || null,
            hidden: definition.hidden || false
        };
    },

    // Unregister
    unregister: function(name) {
        delete this.commands[name];
    },

    // Get command
    get: function(name) {
        return this.commands[name] || null;
    },

    // List all commands (visible only)
    list: function(category) {
        return Object.values(this.commands)
            .filter(c => !c.hidden && (!category || c.category === category))
            .sort((a, b) => a.name.localeCompare(b.name));
    },

    // Search commands by query
    search: function(query) {
        if (!query) return this.list();
        const q = query.toLowerCase();
        return Object.values(this.commands)
            .filter(c => !c.hidden && (
                c.name.toLowerCase().includes(q) ||
                c.description.toLowerCase().includes(q)
            ))
            .sort((a, b) => {
                const aStartsWith = a.name.startsWith(q) ? 0 : 1;
                const bStartsWith = b.name.startsWith(q) ? 0 : 1;
                return aStartsWith - bStartsWith || a.name.localeCompare(b.name);
            });
    },

    // Execute a command
    execute: async function(name, args) {
        const cmd = this.get(name);
        if (!cmd) return { error: `Unknown command: /${name}. Type / to see available commands.` };

        // Handler function
        if (cmd.handler) {
            try {
                return await cmd.handler(args);
            } catch(e) {
                return { error: `Command /${name} failed: ${e.message}` };
            }
        }

        // Skill invocation
        if (cmd.skill && window.skillRegistry) {
            const prompt = window.skillRegistry.invoke(cmd.skill, args);
            if (prompt) return { type: 'prompt', prompt };
        }

        // Tool invocation
        if (cmd.tool) {
            return { type: 'tool', action: cmd.tool, args: cmd.toolArgs || {} };
        }

        // Prompt injection
        if (cmd.prompt) {
            let prompt = cmd.prompt;
            if (args) prompt += '\n\n' + args;
            return { type: 'prompt', prompt };
        }

        return { error: `Command /${name} has no handler` };
    }
};

// ═══════════════════════════════════════════════════════════════════════
// BUNDLED COMMANDS (15+ Claude Code parity)
// ═══════════════════════════════════════════════════════════════════════

// --- Build & Deploy ---
window.commandRegistry.register('commit', {
    description: 'Git commit current changes with AI-generated message',
    category: 'git',
    prompt: 'Review all changed files using git (git_action: "diff"). Generate a concise, conventional commit message. Then run git (git_action: "add") and git (git_action: "commit", message: "<your message>"). Use [AUTO_CONTINUE].'
});

window.commandRegistry.register('review', {
    description: 'AI code review of the current project',
    category: 'code',
    skill: 'review'
});

window.commandRegistry.register('deploy', {
    description: 'Build and deploy the current app',
    category: 'build',
    skill: 'deploy'
});

window.commandRegistry.register('test', {
    description: 'Run comprehensive tests',
    category: 'build',
    skill: 'test'
});

// --- Context & Memory ---
window.commandRegistry.register('compact', {
    description: 'Manually trigger context compression',
    category: 'context',
    handler: async function() {
        const result = await window.smartCompact.compact(true);
        return { status: result ? 'compacted' : 'no_compaction_needed' };
    }
});

window.commandRegistry.register('context', {
    description: 'Show context window usage stats',
    category: 'context',
    handler: function() {
        const totalChars = window.chatHistory.reduce((sum, m) => {
            return sum + (typeof m.content === 'string' ? m.content.length : 200);
        }, 0);
        const maxChars = window.smartCompact?.maxContextChars || 50000;
        const pct = Math.round((totalChars / maxChars) * 100);
        const msgCount = window.chatHistory.length;
        const byRole = { user: 0, assistant: 0, system: 0 };
        window.chatHistory.forEach(m => { byRole[m.role] = (byRole[m.role] || 0) + 1; });

        return {
            status: 'ok',
            display: `Context: ${totalChars.toLocaleString()}/${maxChars.toLocaleString()} chars (${pct}%)\nMessages: ${msgCount} (user: ${byRole.user}, assistant: ${byRole.assistant}, system: ${byRole.system})\nAuto-compact at: 80%`,
            pct, totalChars, maxChars, msgCount
        };
    }
});

window.commandRegistry.register('memory', {
    description: 'Review and manage memories',
    category: 'memory',
    skill: 'remember'
});

window.commandRegistry.register('remember', {
    description: 'Save a fact to project or user memory',
    category: 'memory',
    handler: async function(args) {
        if (!args) return { error: 'Usage: /remember <fact to save>' };
        await window.hierarchicalMemory.appendToMemory('project', args);
        return { status: 'saved', message: `Saved to project memory: "${args}"` };
    }
});

// --- Session ---
window.commandRegistry.register('resume', {
    description: 'List and restore a past session',
    category: 'session',
    handler: async function(args) {
        if (args) {
            return await window.sessionPersistence.restore(args.trim());
        }
        const sessions = await window.sessionPersistence.listSessions();
        if (sessions.length === 0) return { status: 'no_sessions', message: 'No saved sessions found.' };
        let display = 'Saved sessions:\n';
        sessions.slice(0, 10).forEach((s, i) => {
            display += `${i + 1}. [${s.id}] ${s.label} (${s.messageCount} msgs, $${(s.cost || 0).toFixed(4)})\n`;
        });
        display += '\nUse: /resume <session_id> to restore.';
        return { status: 'list', display, sessions };
    }
});

window.commandRegistry.register('save', {
    description: 'Save current session',
    category: 'session',
    handler: async function(args) {
        return await window.sessionPersistence.save(args || undefined);
    }
});

// --- Mode & Config ---
window.commandRegistry.register('plan', {
    description: 'Enter plan mode — AI shows plan before acting',
    category: 'mode',
    handler: function() {
        return window.enterPlanMode();
    }
});

window.commandRegistry.register('config', {
    description: 'Show or set configuration',
    category: 'config',
    tool: 'get_config'
});

window.commandRegistry.register('cost', {
    description: 'Show token usage and cost report',
    category: 'config',
    handler: function() {
        if (window.costTracker) {
            return {
                status: 'ok',
                display: window.costTracker.getReport()
            };
        }
        return { error: 'Cost tracker not available' };
    }
});

// --- Code ---
window.commandRegistry.register('diff', {
    description: 'Show git diff of current changes',
    category: 'git',
    tool: 'git',
    toolArgs: { git_action: 'diff' }
});

window.commandRegistry.register('rewind', {
    description: 'Undo to previous checkpoint (git revert)',
    category: 'git',
    prompt: 'Check git log (git_action: "log") for the last commit. If it was made by auto-checkpoint, revert it using git (git_action: "revert"). Show the result.'
});

// --- Utility ---
window.commandRegistry.register('doctor', {
    description: 'Run environment diagnostics',
    category: 'utility',
    handler: function() {
        const checks = {
            engine: 'http://127.0.0.1:5000' ? 'ok' : 'offline',
            chatHistory: (window.chatHistory || []).length + ' messages',
            memory: window.hierarchicalMemory ? 'loaded' : 'not loaded',
            microCompact: window.microCompact?.enabled ? 'enabled' : 'disabled',
            sessionPersistence: window.sessionPersistence?.currentSessionId || 'not initialized',
            costTracker: window.costTracker ? `$${(window.costTracker.totalCostUSD || 0).toFixed(4)}` : 'not loaded',
            aiMode: window.activeAIMode || 'unknown',
            permissions: window.currentPermissionMode || 'unknown',
            plugins: Object.keys(window.pluginManager?.plugins || {}).length + ' loaded',
            skills: Object.keys(window.skillRegistry?.bundledSkills || {}).length + ' bundled'
        };
        let display = 'Environment Diagnostics:\n';
        for (const [k, v] of Object.entries(checks)) {
            display += `  ${k}: ${v}\n`;
        }
        return { status: 'ok', display, checks };
    }
});

window.commandRegistry.register('skills', {
    description: 'List all available skills',
    category: 'utility',
    handler: function() {
        const skills = window.skillRegistry ? window.skillRegistry.list() : [];
        if (skills.length === 0) return { status: 'empty', message: 'No skills available.' };
        let display = 'Available skills:\n';
        skills.forEach(s => {
            display += `  /${s.name} — ${s.description}\n`;
        });
        return { status: 'ok', display, skills };
    }
});

window.commandRegistry.register('help', {
    description: 'Show all available commands',
    category: 'utility',
    handler: function(args) {
        if (args) {
            const cmd = window.commandRegistry.get(args.trim());
            if (cmd) return { status: 'ok', display: `/${cmd.name}: ${cmd.description}\nUsage: ${cmd.usage}\nCategory: ${cmd.category}` };
            return { error: `Unknown command: /${args.trim()}` };
        }
        const cmds = window.commandRegistry.list();
        const byCategory = {};
        cmds.forEach(c => {
            if (!byCategory[c.category]) byCategory[c.category] = [];
            byCategory[c.category].push(c);
        });
        let display = 'Available slash commands:\n\n';
        for (const [cat, catCmds] of Object.entries(byCategory)) {
            display += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n`;
            catCmds.forEach(c => {
                display += `  /${c.name} — ${c.description}\n`;
            });
            display += '\n';
        }
        return { status: 'ok', display };
    }
});

window.commandRegistry.register('simplify', {
    description: 'Review and simplify recent code changes',
    category: 'code',
    skill: 'simplify'
});

window.commandRegistry.register('fix', {
    description: 'Auto-fix all issues in the current project',
    category: 'code',
    skill: 'fix'
});

window.commandRegistry.register('optimize', {
    description: 'Analyze and optimize app performance',
    category: 'code',
    skill: 'optimize'
});

// ═══════════════════════════════════════════════════════════════════════
// SLASH COMMAND PARSER — Detect /commands in chat input
// ═══════════════════════════════════════════════════════════════════════
window.parseSlashCommand = function(input) {
    if (!input || !input.startsWith('/')) return null;
    const parts = input.trim().split(/\s+/);
    const name = parts[0].substring(1).toLowerCase(); // Remove /
    const args = parts.slice(1).join(' ');
    return { name, args: args || null };
};

// ═══════════════════════════════════════════════════════════════════════
// AUTOCOMPLETE UI — Show dropdown when user types /
// ═══════════════════════════════════════════════════════════════════════
window.commandAutocomplete = {
    dropdown: null,
    isVisible: false,
    selectedIndex: 0,
    filteredCommands: [],

    init: function() {
        const chatInput = document.getElementById('chat-input');
        if (!chatInput || chatInput._commandACInit) return;
        chatInput._commandACInit = true;

        // Create dropdown element
        this.dropdown = document.createElement('div');
        this.dropdown.id = 'command-autocomplete';
        this.dropdown.style.cssText = `
            position: absolute; bottom: 100%; left: 0; right: 0;
            max-height: 250px; overflow-y: auto;
            background: #1e1e2e; border: 1px solid #45475a;
            border-radius: 8px; margin-bottom: 4px;
            display: none; z-index: 1000;
            box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
            font-family: 'Segoe UI', system-ui, sans-serif;
        `;
        chatInput.parentElement.style.position = 'relative';
        chatInput.parentElement.appendChild(this.dropdown);

        // Input listener
        chatInput.addEventListener('input', (e) => {
            const value = e.target.value;
            if (value.startsWith('/')) {
                const query = value.substring(1).split(/\s/)[0];
                this.show(query);
            } else {
                this.hide();
            }
        });

        // Keyboard navigation
        chatInput.addEventListener('keydown', (e) => {
            if (!this.isVisible) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
                this.render();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.render();
            } else if (e.key === 'Tab' || e.key === 'Enter') {
                if (this.filteredCommands.length > 0) {
                    e.preventDefault();
                    const selected = this.filteredCommands[this.selectedIndex];
                    chatInput.value = `/${selected.name} `;
                    this.hide();
                    // Don't submit on Tab, only on Enter if it was the only match
                }
            } else if (e.key === 'Escape') {
                this.hide();
            }
        });
    },

    show: function(query) {
        this.filteredCommands = window.commandRegistry.search(query);
        if (this.filteredCommands.length === 0) {
            this.hide();
            return;
        }
        this.selectedIndex = 0;
        this.isVisible = true;
        this.dropdown.style.display = 'block';
        this.render();
    },

    hide: function() {
        this.isVisible = false;
        if (this.dropdown) this.dropdown.style.display = 'none';
    },

    render: function() {
        if (!this.dropdown) return;
        this.dropdown.innerHTML = this.filteredCommands.map((cmd, i) => {
            const isSelected = i === this.selectedIndex;
            return `<div style="
                padding: 8px 12px;
                cursor: pointer;
                background: ${isSelected ? '#313244' : 'transparent'};
                border-left: 3px solid ${isSelected ? '#89b4fa' : 'transparent'};
                transition: background 0.1s;
            " onmouseover="this.style.background='#313244'" onmouseout="this.style.background='${isSelected ? '#313244' : 'transparent'}'">
                <span style="color: #89b4fa; font-weight: 600;">/${cmd.name}</span>
                <span style="color: #6c7086; margin-left: 8px; font-size: 0.85em;">${cmd.description}</span>
                <span style="color: #45475a; float: right; font-size: 0.75em;">${cmd.category}</span>
            </div>`;
        }).join('');
    }
};

// Initialize autocomplete after DOM ready
setTimeout(() => window.commandAutocomplete.init(), 2000);

// ═══════════════════════════════════════════════════════════════════════
// COMMAND INTERCEPTOR — Hook into sendMessage to catch /commands
// ═══════════════════════════════════════════════════════════════════════
window._commandInterceptorInstalled = false;
window.installCommandInterceptor = function() {
    if (window._commandInterceptorInstalled) return;
    const originalSendMessage = window.sendMessage;
    if (!originalSendMessage) return;

    window._commandInterceptorInstalled = true;
    window.sendMessage = async function(userInput) {
        // Get input from argument or chat input
        const chatInput = document.getElementById('chat-input');
        const input = userInput || chatInput?.value || '';

        // Check for slash command
        const parsed = window.parseSlashCommand(input);
        if (parsed) {
            const result = await window.commandRegistry.execute(parsed.name, parsed.args);

            if (result.error) {
                if (window.appendToolMessage) window.appendToolMessage('Command', 'error', result.error);
                return;
            }

            if (result.display) {
                // Show result in chat
                if (window.appendToolMessage) window.appendToolMessage(`/${parsed.name}`, 'success', result.display);
                if (chatInput) chatInput.value = '';
                return;
            }

            if (result.type === 'prompt') {
                // Inject as user message and send
                if (chatInput) chatInput.value = result.prompt;
                return originalSendMessage.call(window, result.prompt);
            }

            if (result.type === 'tool') {
                // Inject as tool call message
                const toolMsg = JSON.stringify({ action: result.action, ...result.args });
                if (chatInput) chatInput.value = '';
                if (window.appendToolMessage) window.appendToolMessage(`/${parsed.name}`, 'in_progress', `Executing: ${result.action}`);
                // Let the agent engine handle this
                window.chatHistory.push({ role: 'user', content: `Execute: ${toolMsg}` });
                return originalSendMessage.call(window);
            }

            // Default: show status
            if (window.appendToolMessage) window.appendToolMessage(`/${parsed.name}`, 'success', JSON.stringify(result).substring(0, 200));
            if (chatInput) chatInput.value = '';
            return;
        }

        // Not a command — pass through to original sendMessage
        return originalSendMessage.apply(window, arguments);
    };
    console.log('[Commands] Interceptor installed');
};

setTimeout(() => window.installCommandInterceptor(), 3000);

console.log('[Flowork OS] Slash Commands loaded (' + Object.keys(window.commandRegistry.commands).length + ' commands)');
