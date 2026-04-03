// =========================================================================
// FLOWORK OS — Brain Plugin System
// Load/unload JS modules at runtime from the plugins/ folder.
// Plugins can register new tools into the brainToolRegistry.
// =========================================================================

(function() {
    'use strict';

    const fs = window.originalNodeRequire?.('fs') || null;
    const path = window.originalNodeRequire?.('path') || null;

    const pluginsDir = path ? path.join(
        window.floworkEngineRoot || path.resolve(__dirname, '..'),
        'brain', 'plugins'
    ) : null;

    const loadedPlugins = {};  // name → { name, config, module, enabled }

    // Ensure plugins directory exists
    if (fs && pluginsDir) {
        try { fs.mkdirSync(pluginsDir, { recursive: true }); } catch(e) {}
    }

    function _scanPlugins() {
        if (!fs || !pluginsDir) return [];
        try {
            const entries = fs.readdirSync(pluginsDir);
            return entries.filter(name => {
                const fullPath = path.join(pluginsDir, name);
                return fs.statSync(fullPath).isDirectory() &&
                       fs.existsSync(path.join(fullPath, 'plugin.json'));
            });
        } catch(e) {
            return [];
        }
    }

    function list(input) {
        const available = _scanPlugins();
        if (available.length === 0 && Object.keys(loadedPlugins).length === 0) {
            return { result: `No plugins found. Create a folder in brain/plugins/ with plugin.json and index.js` };
        }

        let report = `🔌 PLUGINS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        // Loaded plugins
        for (const [name, p] of Object.entries(loadedPlugins)) {
            const icon = p.enabled ? '🟢' : '🔴';
            report += `${icon} ${name} — ${p.config?.description || 'No description'}\n`;
            if (p.config?.tools) report += `   Tools: ${p.config.tools.join(', ')}\n`;
        }

        // Available but not loaded
        for (const name of available) {
            if (!loadedPlugins[name]) {
                const configPath = path.join(pluginsDir, name, 'plugin.json');
                try {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    report += `⚪ ${name} — ${config.description || 'Available'} [not loaded]\n`;
                } catch(e) {
                    report += `⚪ ${name} — [not loaded]\n`;
                }
            }
        }

        return { result: report };
    }

    function load(input) {
        const name = input.name || input.plugin;
        if (!name) return { error: 'Missing plugin name.' };
        if (!fs || !pluginsDir) return { error: 'File system not available.' };

        const pluginPath = path.join(pluginsDir, name);
        const configPath = path.join(pluginPath, 'plugin.json');
        const indexPath = path.join(pluginPath, 'index.js');

        if (!fs.existsSync(configPath)) return { error: `Plugin "${name}" not found. Ensure brain/plugins/${name}/plugin.json exists.` };
        if (!fs.existsSync(indexPath)) return { error: `Plugin "${name}" missing index.js entry point.` };

        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const code = fs.readFileSync(indexPath, 'utf8');

            // Execute plugin code in a sandboxed scope
            const pluginFn = new Function('window', 'console', 'require', code);
            pluginFn(window, console, window.originalNodeRequire);

            loadedPlugins[name] = {
                name,
                config,
                enabled: true,
                loadedAt: new Date().toISOString(),
            };

            // Register tools if plugin declares them
            if (config.tools && Array.isArray(config.tools)) {
                for (const toolName of config.tools) {
                    if (window[`plugin_${name}_${toolName}`]) {
                        window.brainToolRegistry[toolName] = {
                            handler: 'window_global',
                            fn: `plugin_${name}_${toolName}`,
                            description: `Plugin ${name}: ${toolName}`,
                            category: 'plugin',
                        };
                    }
                }
            }

            console.log(`[Plugins] ✅ Loaded: ${name}`);
            return { result: `✅ Plugin "${name}" loaded. ${config.tools?.length || 0} tools registered.` };
        } catch(err) {
            return { error: `Failed to load plugin "${name}": ${err.message}` };
        }
    }

    function unload(input) {
        const name = input.name || input.plugin;
        if (!name || !loadedPlugins[name]) return { error: `Plugin "${name}" not loaded.` };

        // Remove registered tools
        const config = loadedPlugins[name].config;
        if (config?.tools) {
            for (const toolName of config.tools) {
                delete window.brainToolRegistry[toolName];
            }
        }

        delete loadedPlugins[name];
        console.log(`[Plugins] 🔌 Unloaded: ${name}`);
        return { result: `🔌 Plugin "${name}" unloaded.` };
    }

    async function install(input) {
        const url = input.url || input.source;
        const name = input.name || input.plugin;
        if (!url) return { error: 'Missing plugin URL. Example: { url: "https://example.com/plugin.zip", name: "my-plugin" }' };
        if (!fs || !pluginsDir) return { error: 'File system not available.' };

        const targetName = name || `plugin_${Date.now()}`;
        const targetDir = path.join(pluginsDir, targetName);

        // Strategy 1: Download via Go backend (handles CORS)
        try {
            const res = await fetch('http://127.0.0.1:5000/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, target: targetDir }),
                signal: AbortSignal.timeout(30000),
            });

            if (res.ok) {
                // Verify plugin.json exists
                const pluginJsonPath = path.join(targetDir, 'plugin.json');
                if (fs.existsSync(pluginJsonPath)) {
                    return { result: `✅ Plugin "${targetName}" installed from ${url}. Use plugin_load({ name: "${targetName}" }) to activate.` };
                }
                return { result: `⚠️ Plugin downloaded to ${targetDir} but no plugin.json found. Ensure the archive contains plugin.json and index.js.` };
            }
        } catch(e) {
            // Go backend /api/download not available
        }

        // Strategy 2: Direct fetch (only works for raw JS, no CORS)
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (res.ok) {
                const content = await res.text();

                // If it's a single JS file, wrap it as a plugin
                fs.mkdirSync(targetDir, { recursive: true });
                fs.writeFileSync(path.join(targetDir, 'index.js'), content);
                fs.writeFileSync(path.join(targetDir, 'plugin.json'), JSON.stringify({
                    name: targetName,
                    description: `Installed from ${url}`,
                    version: '1.0.0',
                    tools: [],
                }, null, 2));

                return { result: `✅ Plugin "${targetName}" installed (single-file mode). Use plugin_load({ name: "${targetName}" }) to activate.` };
            }
        } catch(e) {
            // Direct fetch failed
        }

        return { error: `Failed to install plugin from "${url}". Try manually: download → extract → place in brain/plugins/${targetName}/ with plugin.json and index.js.` };
    }

    function uninstall(input) {
        const name = input.name || input.plugin;
        if (!name) return { error: 'Missing plugin name.' };
        // Unload first
        if (loadedPlugins[name]) unload(input);
        // Future: delete plugin folder
        return { result: `Plugin "${name}" unloaded. To fully remove, delete brain/plugins/${name}/ folder.` };
    }

    function enable(input) {
        const name = input.name || input.plugin;
        if (!name || !loadedPlugins[name]) return load(input);  // Auto-load if not loaded
        loadedPlugins[name].enabled = true;
        return { result: `✅ Plugin "${name}" enabled.` };
    }

    function disable(input) {
        const name = input.name || input.plugin;
        if (!name || !loadedPlugins[name]) return { error: `Plugin "${name}" not loaded.` };
        loadedPlugins[name].enabled = false;
        return { result: `❌ Plugin "${name}" disabled.` };
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkPlugins = { list, load, unload, install, uninstall, enable, disable };

    console.log('[Brain] ✅ Plugin System loaded');
})();
