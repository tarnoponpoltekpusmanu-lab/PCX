/**
 * hello_world — Flowork Test Tool
 * Auto-loaded by Universal Connector
 * This proves the hot-reload system works!
 */

async function execute(params) {
  const name = params.name || 'World';
  return {
    message: `Hello, ${name}! 🚀 This tool was auto-loaded by FLOWORKOS Connector.`,
    timestamp: new Date().toISOString(),
    runtime: 'node (direct)',
  };
}

module.exports = { execute };
