/**
 * ============================================================
 *  FLOWORKOS™ Universal Connector — "Netflix for AI Tools"
 * ============================================================
 *  The Connector auto-discovers, hot-loads, and executes tools
 *  written in ANY language: JS, Python, Go, C, EXE, WASM.
 *
 *  Key Features:
 *  - fs.watch: auto-detect new tools without restart
 *  - Hybrid runtime: JS direct load + subprocess for others
 *  - Write protection: AI can READ everything, WRITE only to tools/
 *  - JSON protocol: universal stdin/stdout communication
 *  - Evolution: AI extends itself by creating new tools
 * ============================================================
 */

(function () {
  'use strict';

  // ── Node.js APIs (Electron renderer) ───────────────────────
  let fs, path, childProcess;
  try {
    fs = require('fs');
    path = require('path');
    childProcess = require('child_process');
  } catch (e) {
    console.warn('[Connector] Node.js APIs not available — running in browser-only mode');
  }

  // ── Constants ──────────────────────────────────────────────
  const ENGINE_ROOT = (typeof __dirname !== 'undefined') ? path.resolve(__dirname, '..') : 'C:\\flowork\\ENGINE';
  const TOOLS_DIR = path.join(ENGINE_ROOT, 'tools');
  const REGISTRY_FILE = path.join(TOOLS_DIR, '_registry.json');
  const BRAIN_DIR = path.join(ENGINE_ROOT, 'brain');

  // Protected paths — AI CANNOT write here
  const PROTECTED_PATHS = [
    BRAIN_DIR,
    path.join(ENGINE_ROOT, '.env'),
    path.join(ENGINE_ROOT, '.env.example'),
    path.join(ENGINE_ROOT, 'ai-builder.html'),
    path.join(ENGINE_ROOT, 'index.html'),
  ];

  // Supported runtimes
  const RUNTIME_MAP = {
    '.js':   'node',
    '.mjs':  'node',
    '.py':   'python',
    '.go':   'go',
    '.exe':  'binary',
    '.sh':   'shell',
    '.bat':  'shell',
    '.ps1':  'powershell',
    '.wasm': 'wasm',
  };

  // ── State ──────────────────────────────────────────────────
  const _tools = new Map();          // name → tool object
  const _watchers = [];              // active fs.watch handles
  const _log = [];                   // setup/event log
  let _watchActive = false;
  let _toolsLoaded = 0;

  // ── Logging ────────────────────────────────────────────────
  function log(msg, level = 'info') {
    const entry = { time: new Date().toISOString(), message: msg, level };
    _log.push(entry);
    const prefix = '[FLOWORKOS Connector]';
    if (level === 'error') console.error(`${prefix} ❌ ${msg}`);
    else if (level === 'warn') console.warn(`${prefix} ⚠️ ${msg}`);
    else console.log(`${prefix} ${msg}`);
  }

  // ══════════════════════════════════════════════════════════
  //  WRITE PROTECTION — AI can READ everything, WRITE only new
  // ══════════════════════════════════════════════════════════

  /**
   * Check if a path is protected from AI writes
   * @param {string} targetPath - Path AI wants to write to
   * @returns {{ allowed: boolean, reason: string }}
   */
  function validateWrite(targetPath) {
    if (!targetPath) return { allowed: false, reason: 'No path provided' };

    const resolved = path.resolve(targetPath);

    // Rule 1: Brain directory is ALWAYS protected
    if (resolved.startsWith(BRAIN_DIR)) {
      return { allowed: false, reason: `🔒 Protected: brain/ directory is read-only. AI can create new tools in tools/ instead.` };
    }

    // Rule 2: Specific protected files
    for (const protectedPath of PROTECTED_PATHS) {
      if (resolved === path.resolve(protectedPath)) {
        return { allowed: false, reason: `🔒 Protected: ${path.basename(protectedPath)} is a system file.` };
      }
    }

    // Rule 3: Inside tools/ — only NEW files allowed
    if (resolved.startsWith(TOOLS_DIR)) {
      // Allow creating new files
      if (!fs.existsSync(resolved)) {
        return { allowed: true, reason: 'New file in tools/ — allowed' };
      }

      // Block editing existing files (except _registry.json which is auto-managed)
      if (resolved !== REGISTRY_FILE) {
        return { allowed: false, reason: `🔒 File already exists: ${path.basename(resolved)}. AI cannot edit existing tools. Create a new version instead.` };
      }
    }

    // Rule 4: Workspace files — allowed (apps, etc.)
    return { allowed: true, reason: 'Writable path' };
  }

  // ══════════════════════════════════════════════════════════
  //  TOOL DISCOVERY — Scan & Watch
  // ══════════════════════════════════════════════════════════

  /**
   * Initial scan of tools/ directory
   */
  function scanTools() {
    if (!fs || !fs.existsSync(TOOLS_DIR)) {
      log('Tools directory not found, creating...', 'warn');
      try { fs.mkdirSync(TOOLS_DIR, { recursive: true }); } catch {}
      return;
    }

    log('🔍 Scanning tools/ directory...');

    const entries = fs.readdirSync(TOOLS_DIR, { withFileTypes: true });
    let loaded = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

      try {
        const toolPath = path.join(TOOLS_DIR, entry.name);
        const result = loadTool(toolPath);
        if (result) loaded++;
      } catch (err) {
        log(`Failed to load tool "${entry.name}": ${err.message}`, 'error');
      }
    }

    _toolsLoaded = loaded;
    log(`📦 Scan complete: ${loaded} tool(s) loaded`);
    _saveRegistry();
  }

  /**
   * Start watching tools/ directory for changes (HOT-RELOAD)
   */
  function watchTools() {
    if (!fs || _watchActive) return;

    try {
      // Watch for new directories (tools)
      const watcher = fs.watch(TOOLS_DIR, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Debounce: ignore rapid-fire events
        if (watcher._debounce) clearTimeout(watcher._debounce);
        watcher._debounce = setTimeout(() => {
          _handleFileChange(eventType, filename);
        }, 300);
      });

      _watchers.push(watcher);
      _watchActive = true;
      log('👁️ File watcher active on tools/ — hot-reload enabled');
    } catch (err) {
      log(`Watcher failed: ${err.message}`, 'error');
    }
  }

  /**
   * Handle file system change in tools/
   */
  function _handleFileChange(eventType, filename) {
    // Extract tool name (first directory component)
    const parts = filename.split(path.sep);
    const toolName = parts[0];

    if (toolName.startsWith('_') || toolName.startsWith('.')) return;

    const toolPath = path.join(TOOLS_DIR, toolName);

    // Check if it's a directory (a tool folder)
    if (!fs.existsSync(toolPath) || !fs.statSync(toolPath).isDirectory()) return;

    // Check if already loaded
    if (_tools.has(toolName)) {
      log(`🔄 Tool "${toolName}" files changed (existing tool — not reloading)`);
      return;
    }

    // NEW TOOL DETECTED!
    log(`🔔 New tool detected: "${toolName}" — loading...`);

    try {
      const result = loadTool(toolPath);
      if (result) {
        _toolsLoaded++;
        _saveRegistry();
        log(`✅ Hot-loaded: "${toolName}" — ${result.capabilities.length} capability(s)`);

        // Notify UI
        if (window.appendToolMessage) {
          window.appendToolMessage('Connector', 'success',
            `🔌 New tool loaded: ${toolName} (${result.runtime})`);
        }
      }
    } catch (err) {
      log(`Failed to hot-load "${toolName}": ${err.message}`, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════
  //  TOOL LOADING — Read manifest, detect runtime, register
  // ══════════════════════════════════════════════════════════

  /**
   * Load a tool from its directory
   * @param {string} toolPath - Absolute path to tool directory
   * @returns {Object|null} Tool registration object
   */
  function loadTool(toolPath) {
    const toolName = path.basename(toolPath);

    // Read manifest.json (or auto-generate)
    const manifestPath = path.join(toolPath, 'manifest.json');
    let manifest;

    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } else {
      // Auto-detect: find entry file
      manifest = _autoDetectManifest(toolPath, toolName);
      if (!manifest) return null;
    }

    // Detect runtime
    const entryFile = path.join(toolPath, manifest.entry);
    if (!fs.existsSync(entryFile)) {
      log(`Entry file not found: ${manifest.entry} in ${toolName}`, 'warn');
      return null;
    }

    const ext = path.extname(manifest.entry).toLowerCase();
    const runtime = manifest.runtime === 'auto' ? (RUNTIME_MAP[ext] || 'binary') : manifest.runtime;

    // Create tool object
    const tool = {
      name: manifest.name || toolName,
      version: manifest.version || '1.0.0',
      description: manifest.description || '',
      runtime,
      entry: manifest.entry,
      entryPath: entryFile,
      toolPath,
      capabilities: manifest.capabilities || [toolName],
      inputSchema: manifest.input_schema || {},
      outputSchema: manifest.output_schema || {},
      permissions: manifest.permissions || [],
      trustLevel: manifest.trust_level || 'sandbox',
      author: manifest.author || 'unknown',
      loadedAt: new Date().toISOString(),

      // The execution function
      execute: (params) => executeTool(toolName, params),
    };

    // Register
    _tools.set(toolName, tool);

    log(`🔌 Loaded: "${toolName}" (${runtime}, ${manifest.entry})`);
    return tool;
  }

  /**
   * Auto-detect manifest when manifest.json is missing
   */
  function _autoDetectManifest(toolPath, toolName) {
    // Look for common entry files
    const candidates = [
      'index.js', 'main.js', 'tool.js',
      'index.py', 'main.py', 'tool.py',
      'main.go', 'main.exe', 'tool.exe',
      `${toolName}.js`, `${toolName}.py`, `${toolName}.exe`,
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(toolPath, candidate))) {
        log(`📝 Auto-detected entry: ${candidate} for "${toolName}"`);
        return {
          name: toolName,
          version: '1.0.0',
          runtime: 'auto',
          entry: candidate,
          capabilities: [toolName],
          trust_level: 'sandbox',
          author: 'ai-generated',
        };
      }
    }

    log(`No entry file found for "${toolName}"`, 'warn');
    return null;
  }

  // ══════════════════════════════════════════════════════════
  //  TOOL EXECUTION — Hybrid Runtime
  // ══════════════════════════════════════════════════════════

  /**
   * Execute a tool with the appropriate runtime
   * @param {string} name - Tool name
   * @param {Object} params - Input parameters
   * @returns {Promise<Object>} Execution result
   */
  async function executeTool(name, params = {}) {
    const tool = _tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);

    const startTime = Date.now();
    log(`▶️ Executing: "${name}" (${tool.runtime})`);

    let result;

    try {
      switch (tool.runtime) {
        case 'node':
          result = await _executeJS(tool, params);
          break;
        case 'python':
          result = await _executeSubprocess('python', [tool.entryPath], params);
          break;
        case 'go':
          result = await _executeSubprocess('go', ['run', tool.entryPath], params);
          break;
        case 'binary':
          result = await _executeSubprocess(tool.entryPath, [], params);
          break;
        case 'shell':
          const shell = tool.entry.endsWith('.ps1') ? 'powershell' : (process.platform === 'win32' ? 'cmd' : 'sh');
          const args = tool.entry.endsWith('.ps1') ? ['-File', tool.entryPath] : [tool.entry.endsWith('.bat') ? '/c' : '-c', tool.entryPath];
          result = await _executeSubprocess(shell, args, params);
          break;
        case 'powershell':
          result = await _executeSubprocess('powershell', ['-File', tool.entryPath], params);
          break;
        default:
          throw new Error(`Unsupported runtime: ${tool.runtime}`);
      }
    } catch (err) {
      result = { error: err.message, status: 'error' };
    }

    const elapsed = Date.now() - startTime;
    log(`✅ "${name}" completed in ${elapsed}ms`);

    return {
      tool: name,
      runtime: tool.runtime,
      elapsed,
      ...result,
    };
  }

  /**
   * Execute JavaScript tool (DIRECT — no subprocess, fastest)
   */
  async function _executeJS(tool, params) {
    try {
      // Clear require cache for fresh load
      const resolvedPath = require.resolve(tool.entryPath);
      if (require.cache[resolvedPath]) {
        delete require.cache[resolvedPath];
      }

      const module = require(tool.entryPath);

      // Convention: tool exports execute(params) or run(params) or default function
      const fn = module.execute || module.run || module.default || module;

      if (typeof fn !== 'function') {
        throw new Error(`Tool "${tool.name}" does not export a function`);
      }

      const result = await fn(params);
      return { result, status: 'ok' };
    } catch (err) {
      return { error: err.message, status: 'error' };
    }
  }

  /**
   * Execute tool via subprocess (Python, Go, EXE, etc.)
   * Communicates via STDIO JSON protocol
   */
  function _executeSubprocess(command, args, params) {
    return new Promise((resolve, reject) => {
      const timeout = 30000; // 30 second timeout

      try {
        const proc = childProcess.spawn(command, args, {
          cwd: path.dirname(args[args.length - 1] || '.'),
          env: { ...process.env, FLOWORK_TOOL_INPUT: JSON.stringify(params) },
          timeout,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        // Send params via stdin
        proc.stdin.write(JSON.stringify(params));
        proc.stdin.end();

        proc.on('close', (code) => {
          if (code !== 0) {
            resolve({ error: stderr || `Process exited with code ${code}`, status: 'error' });
            return;
          }

          // Try to parse JSON output
          try {
            const result = JSON.parse(stdout.trim());
            resolve({ result, status: 'ok' });
          } catch {
            // Return raw text if not JSON
            resolve({ result: stdout.trim(), status: 'ok' });
          }
        });

        proc.on('error', (err) => {
          resolve({ error: `Failed to start ${command}: ${err.message}`, status: 'error' });
        });
      } catch (err) {
        resolve({ error: err.message, status: 'error' });
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  TOOL TEMPLATE — AI creates properly structured tools
  // ══════════════════════════════════════════════════════════

  /**
   * Create a new tool scaffold
   * AI calls this to create a new tool with proper structure
   */
  function createToolScaffold(name, description, language = 'javascript') {
    if (!name || !name.match(/^[a-z0-9_-]+$/)) {
      return { error: 'Tool name must be lowercase alphanumeric with underscores/hyphens' };
    }

    const toolDir = path.join(TOOLS_DIR, name);

    if (fs.existsSync(toolDir)) {
      return { error: `Tool "${name}" already exists. Choose a different name.` };
    }

    // Create directory
    fs.mkdirSync(toolDir, { recursive: true });

    // Determine entry file
    const entryMap = {
      javascript: 'index.js',
      python: 'main.py',
      go: 'main.go',
    };
    const entry = entryMap[language] || 'index.js';
    const ext = path.extname(entry);

    // Write manifest
    const manifest = {
      name,
      version: '1.0.0',
      description: description || `Tool: ${name}`,
      runtime: 'auto',
      entry,
      capabilities: [name],
      input_schema: {},
      output_schema: {},
      permissions: [],
      trust_level: 'sandbox',
      author: 'ai-generated',
      created: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(toolDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    // Write entry file with boilerplate
    const boilerplate = _getBoilerplate(language, name, description);
    fs.writeFileSync(path.join(toolDir, entry), boilerplate, 'utf-8');

    log(`🛠️ Scaffold created: "${name}" (${language})`);

    return {
      status: 'ok',
      toolDir,
      entry,
      manifest,
      message: `Tool "${name}" scaffold created. Edit ${entry} to add your logic.`,
    };
  }

  function _getBoilerplate(language, name, description) {
    if (language === 'python') {
      return `#!/usr/bin/env python3
"""${description || name} — Flowork Tool"""
import json, sys

def execute(params):
    """Main tool logic. Receives params dict, returns result dict."""
    # TODO: Implement your tool logic here
    return {"message": f"Hello from ${name}!", "params": params}

if __name__ == "__main__":
    input_data = json.loads(sys.stdin.read()) if not sys.stdin.isatty() else {}
    result = execute(input_data)
    print(json.dumps(result))
`;
    }

    if (language === 'go') {
      return `package main

import (
\t"encoding/json"
\t"fmt"
\t"os"
)

// ${description || name} — Flowork Tool
func main() {
\tvar params map[string]interface{}
\tjson.NewDecoder(os.Stdin).Decode(&params)
\t
\t// TODO: Implement your tool logic here
\tresult := map[string]interface{}{
\t\t"message": "Hello from ${name}!",
\t\t"params":  params,
\t}
\t
\tjson.NewEncoder(os.Stdout).Encode(result)
}
`;
    }

    // Default: JavaScript
    return `/**
 * ${description || name} — Flowork Tool
 * Created by AI · Auto-loaded by Connector
 */

/**
 * Main execution function
 * @param {Object} params - Input parameters from AI
 * @returns {Object} Result to return to AI
 */
async function execute(params) {
  // TODO: Implement your tool logic here
  return {
    message: 'Hello from ${name}!',
    params,
  };
}

module.exports = { execute };
`;
  }

  // ══════════════════════════════════════════════════════════
  //  REGISTRY — Persistent tool catalog
  // ══════════════════════════════════════════════════════════

  function _saveRegistry() {
    try {
      const registry = {
        tools: Array.from(_tools.values()).map(t => ({
          name: t.name,
          version: t.version,
          description: t.description,
          runtime: t.runtime,
          entry: t.entry,
          capabilities: t.capabilities,
          trustLevel: t.trustLevel,
          author: t.author,
          loadedAt: t.loadedAt,
        })),
        lastScan: new Date().toISOString(),
        version: '1.0.0',
      };

      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
    } catch {}
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════

  function listTools() {
    return Array.from(_tools.values()).map(t => ({
      name: t.name,
      version: t.version,
      description: t.description,
      runtime: t.runtime,
      capabilities: t.capabilities,
      trustLevel: t.trustLevel,
    }));
  }

  function getTool(name) {
    return _tools.get(name) || null;
  }

  function getStats() {
    return {
      totalTools: _tools.size,
      watchActive: _watchActive,
      toolsDir: TOOLS_DIR,
      runtimes: [...new Set(Array.from(_tools.values()).map(t => t.runtime))],
      log: _log.slice(-20),
    };
  }

  function getEvolutionStatus() {
    const tools = listTools();
    return {
      hands: tools.filter(t => t.capabilities.some(c => !c.includes('vision') && !c.includes('think'))),
      eyes: tools.filter(t => t.capabilities.some(c => c.includes('vision') || c.includes('image') || c.includes('media'))),
      brain: tools.filter(t => t.capabilities.some(c => c.includes('think') || c.includes('reason') || c.includes('analyze'))),
      total: tools.length,
      message: `AI has evolved ${tools.length} custom capabilities`,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════

  function init() {
    if (!fs) {
      log('Running in browser-only mode — connector features limited', 'warn');
      return;
    }

    log('🚀 Initializing Universal Connector...');
    scanTools();
    watchTools();
    log(`✅ Connector ready: ${_tools.size} tool(s), hot-reload active`);
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Connector = {
    // Core
    init,
    scanTools,
    watchTools,

    // Tool management
    listTools,
    getTool,
    loadTool,
    executeTool,
    createToolScaffold,

    // Protection
    validateWrite,

    // Status
    getStats,
    getEvolutionStatus,
    getLog: () => [..._log],

    // Constants
    TOOLS_DIR,
    BRAIN_DIR,
    PROTECTED_PATHS,
  };

  // Auto-init on DOM ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 500);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  }

  console.log('[FLOWORKOS] ✅ Universal Connector loaded');
})();
