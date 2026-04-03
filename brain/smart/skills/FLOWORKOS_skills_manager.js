/**
 * ============================================================
 *  FLOWORKOS™ Skills System & Marketplace
 *  FLOWORKOS™ native skills & marketplace engine
 * ============================================================
 *  Logic: Modular plugin system for AI agent capabilities.
 *  Features:
 *  - Register/unregister skills dynamically
 *  - Skills have: name, description, system prompt addon, tool schemas
 *  - Marketplace: browse, install, uninstall community skills
 *  - Skill isolation: each skill gets scoped context
 * ============================================================
 */

(function () {
  'use strict';

  // ── Registry ───────────────────────────────────────────────
  const _installedSkills = new Map();  // skillId → SkillDefinition
  const _activeSkills = new Set();     // Set of skillIds currently active
  const _skillErrors = new Map();      // skillId → last error

  /**
   * @typedef {Object} SkillDefinition
   * @property {string} id - Unique skill identifier
   * @property {string} name - Display name
   * @property {string} description - What the skill does
   * @property {string} version - Semver version
   * @property {string} author - Creator name
   * @property {string[]} tags - Searchable tags
   * @property {string} systemPromptAddon - Added to system prompt when active
   * @property {Object} toolSchemas - Tool definitions this skill provides
   * @property {Function} [onActivate] - Called when skill is activated
   * @property {Function} [onDeactivate] - Called when skill is deactivated
   * @property {Object} [config] - Skill-specific configuration
   */

  // ── Built-in Skills ────────────────────────────────────────
  const BUILTIN_SKILLS = {
    'web-search': {
      id: 'web-search',
      name: 'Web Search',
      description: 'Search the web for real-time information',
      version: '1.0.0',
      author: 'FLOWORKOS',
      tags: ['search', 'web', 'research'],
      systemPromptAddon: 'You can search the web for current information using the web_search tool.',
      toolSchemas: {
        web_search: {
          description: 'Search the web for information',
          props: { query: 'string' },
          required: ['query'],
        },
      },
    },
    'code-analysis': {
      id: 'code-analysis',
      name: 'Code Analysis',
      description: 'Deep code analysis with AST parsing and metrics',
      version: '1.0.0',
      author: 'FLOWORKOS',
      tags: ['code', 'analysis', 'lint', 'metrics'],
      systemPromptAddon: 'You can analyze code quality, complexity, and dependencies using code analysis tools.',
      toolSchemas: {
        analyze_code: {
          description: 'Analyze code for quality, complexity, and issues',
          props: { file_path: 'string', analysis_type: 'string' },
          required: ['file_path'],
        },
      },
    },
    'image-generation': {
      id: 'image-generation',
      name: 'Image Generation',
      description: 'Generate images using AI models',
      version: '1.0.0',
      author: 'FLOWORKOS',
      tags: ['image', 'art', 'generation', 'ai'],
      systemPromptAddon: 'You can generate images using AI image generation tools.',
      toolSchemas: {
        generate_image: {
          description: 'Generate an image from a text prompt',
          props: { prompt: 'string', size: 'string', style: 'string' },
          required: ['prompt'],
        },
      },
    },
    'git-operations': {
      id: 'git-operations',
      name: 'Git Operations',
      description: 'Advanced Git operations: blame, diff, log, stash',
      version: '1.0.0',
      author: 'FLOWORKOS',
      tags: ['git', 'version-control', 'diff', 'blame'],
      systemPromptAddon: 'You can perform Git operations like blame, detailed diffs, history analysis.',
      toolSchemas: {
        git_operation: {
          description: 'Execute a Git operation',
          props: { operation: 'string', args: 'string', path: 'string' },
          required: ['operation'],
        },
      },
    },
    'database-query': {
      id: 'database-query',
      name: 'Database Query',
      description: 'Query databases (SQLite, PostgreSQL, MySQL)',
      version: '1.0.0',
      author: 'FLOWORKOS',
      tags: ['database', 'sql', 'query'],
      systemPromptAddon: 'You can query databases using the database_query tool. Always use parameterized queries.',
      toolSchemas: {
        database_query: {
          description: 'Execute a database query',
          props: { query: 'string', database: 'string', params: 'array' },
          required: ['query'],
        },
      },
    },
  };

  // ── Skill Management ───────────────────────────────────────

  /**
   * Install a skill
   */
  function installSkill(skill) {
    if (!skill || !skill.id) return { error: 'Skill must have an id' };
    if (_installedSkills.has(skill.id)) return { error: `Skill "${skill.id}" already installed` };

    const validated = _validateSkill(skill);
    if (validated.error) return validated;

    _installedSkills.set(skill.id, {
      ...skill,
      installedAt: Date.now(),
    });

    console.log(`[FLOWORKOS Skills] 📦 Installed "${skill.name}" v${skill.version}`);
    return { status: 'ok', id: skill.id };
  }

  /**
   * Uninstall a skill
   */
  function uninstallSkill(skillId) {
    if (!_installedSkills.has(skillId)) return { error: `Skill "${skillId}" not found` };
    deactivateSkill(skillId);
    _installedSkills.delete(skillId);
    _skillErrors.delete(skillId);
    console.log(`[FLOWORKOS Skills] 🗑️ Uninstalled "${skillId}"`);
    return { status: 'ok' };
  }

  /**
   * Activate a skill (include in agent's capabilities)
   */
  function activateSkill(skillId) {
    const skill = _installedSkills.get(skillId);
    if (!skill) return { error: `Skill "${skillId}" not installed` };
    if (_activeSkills.has(skillId)) return { status: 'already_active' };

    try {
      if (typeof skill.onActivate === 'function') skill.onActivate();
    } catch (err) {
      _skillErrors.set(skillId, err.message);
      return { error: `Activation failed: ${err.message}` };
    }

    _activeSkills.add(skillId);

    // Register tool schemas
    if (skill.toolSchemas && window.toolSchemas) {
      for (const [toolName, schema] of Object.entries(skill.toolSchemas)) {
        window.toolSchemas[toolName] = schema;
      }
    }

    console.log(`[FLOWORKOS Skills] ✅ Activated "${skill.name}"`);
    return { status: 'ok' };
  }

  /**
   * Deactivate a skill
   */
  function deactivateSkill(skillId) {
    const skill = _installedSkills.get(skillId);
    if (!skill || !_activeSkills.has(skillId)) return { status: 'not_active' };

    try {
      if (typeof skill.onDeactivate === 'function') skill.onDeactivate();
    } catch (err) { /* ignore deactivation errors */ }

    _activeSkills.delete(skillId);

    // Remove tool schemas
    if (skill.toolSchemas && window.toolSchemas) {
      for (const toolName of Object.keys(skill.toolSchemas)) {
        delete window.toolSchemas[toolName];
      }
    }

    return { status: 'ok' };
  }

  // ── Query ──────────────────────────────────────────────────

  /**
   * Get system prompt addons from all active skills
   */
  function getActivePromptAddons() {
    const addons = [];
    for (const skillId of _activeSkills) {
      const skill = _installedSkills.get(skillId);
      if (skill?.systemPromptAddon) {
        addons.push(`[Skill: ${skill.name}] ${skill.systemPromptAddon}`);
      }
    }
    return addons.join('\n');
  }

  /**
   * List all installed skills
   */
  function listSkills() {
    const skills = [];
    for (const [id, skill] of _installedSkills) {
      skills.push({
        id, name: skill.name, version: skill.version,
        description: skill.description, author: skill.author,
        active: _activeSkills.has(id),
        tags: skill.tags,
        error: _skillErrors.get(id) || null,
      });
    }
    return skills;
  }

  /**
   * Search marketplace (placeholder — would connect to a remote API)
   */
  function searchMarketplace(query) {
    query = (query || '').toLowerCase();
    const results = [];

    // Search built-in skills
    for (const [id, skill] of Object.entries(BUILTIN_SKILLS)) {
      const searchText = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase();
      if (searchText.includes(query) || !query) {
        results.push({
          id, name: skill.name, description: skill.description,
          version: skill.version, author: skill.author,
          tags: skill.tags, installed: _installedSkills.has(id),
          source: 'builtin',
        });
      }
    }

    return results;
  }

  /**
   * Install a skill from marketplace
   */
  function installFromMarketplace(skillId) {
    const skill = BUILTIN_SKILLS[skillId];
    if (!skill) return { error: `Skill "${skillId}" not found in marketplace` };
    return installSkill(skill);
  }

  // ── Validation ─────────────────────────────────────────────

  function _validateSkill(skill) {
    if (!skill.name) return { error: 'Skill must have a name' };
    if (!skill.description) return { error: 'Skill must have a description' };
    if (!skill.version) skill.version = '0.0.0';
    if (!skill.author) skill.author = 'unknown';
    if (!skill.tags) skill.tags = [];
    return { valid: true };
  }

  // ── Install built-in skills at boot ────────────────────────
  for (const [id, skill] of Object.entries(BUILTIN_SKILLS)) {
    _installedSkills.set(id, { ...skill, installedAt: Date.now() });
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Skills = {
    installSkill,
    uninstallSkill,
    activateSkill,
    deactivateSkill,
    getActivePromptAddons,
    listSkills,
    searchMarketplace,
    installFromMarketplace,
    BUILTIN_SKILLS,
  };

  console.log(`[FLOWORKOS] ✅ Skills System loaded (${Object.keys(BUILTIN_SKILLS).length} built-in)`);
})();
