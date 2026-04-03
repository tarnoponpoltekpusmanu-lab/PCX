/**
 * ============================================================
 *  FLOWORKOS™ MCP Protocol Client
 *  FLOWORKOS™ native MCP protocol client
 * ============================================================
 *  Logic: Model Context Protocol (MCP) client implementation.
 *  Connects to MCP servers to extend agent capabilities with
 *  external tools, resources, and prompts.
 *
 *  Supports: stdio transport, SSE transport, WebSocket transport
 * ============================================================
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  const _servers = new Map();    // serverId → MCPServerConnection
  const _tools = new Map();      // toolName → { serverId, schema }
  const _resources = new Map();  // uri → { serverId, resource }

  /**
   * @typedef {Object} MCPServerConnection
   * @property {string} id
   * @property {string} name
   * @property {string} transport - 'stdio' | 'sse' | 'ws'
   * @property {string} status - 'connecting' | 'ready' | 'error' | 'closed'
   * @property {Object} capabilities
   * @property {Object[]} tools
   * @property {Object[]} resources
   * @property {number} connectedAt
   */

  // ── JSON-RPC ───────────────────────────────────────────────
  let _requestId = 0;

  function createRequest(method, params) {
    return {
      jsonrpc: '2.0',
      id: ++_requestId,
      method,
      params: params || {},
    };
  }

  function createNotification(method, params) {
    return {
      jsonrpc: '2.0',
      method,
      params: params || {},
    };
  }

  // ── Server Connection ──────────────────────────────────────

  /**
   * Connect to an MCP server via SSE (browser-compatible)
   */
  async function connectSSE(config) {
    const serverId = config.id || 'mcp_' + Date.now().toString(36);
    const url = config.url;

    const server = {
      id: serverId,
      name: config.name || serverId,
      transport: 'sse',
      status: 'connecting',
      capabilities: {},
      tools: [],
      resources: [],
      connectedAt: Date.now(),
      _url: url,
      _eventSource: null,
      _pendingRequests: new Map(),
    };

    _servers.set(serverId, server);

    try {
      // Initialize with SSE
      const es = new EventSource(`${url}/sse`);
      server._eventSource = es;

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('MCP SSE connection timeout'));
        }, 10000);

        es.onopen = async () => {
          clearTimeout(timeout);
          server.status = 'ready';

          // Send initialize
          const initResult = await _sendRequest(serverId, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
              roots: { listChanged: true },
            },
            clientInfo: {
              name: 'FLOWORKOS',
              version: '1.0.0',
            },
          });

          if (initResult?.capabilities) {
            server.capabilities = initResult.capabilities;
          }

          // Send initialized notification
          _sendNotification(serverId, 'notifications/initialized');

          // Discover tools
          await _discoverTools(serverId);
          await _discoverResources(serverId);

          console.log(`[FLOWORKOS MCP] ✅ Connected to ${server.name} (${server.tools.length} tools)`);
          resolve({ status: 'ok', serverId, tools: server.tools.length });
        };

        es.onerror = (err) => {
          clearTimeout(timeout);
          server.status = 'error';
          reject(new Error('MCP SSE connection failed'));
        };

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            _handleResponse(serverId, data);
          } catch {}
        };
      });
    } catch (err) {
      server.status = 'error';
      throw err;
    }
  }

  /**
   * Connect to an MCP server via WebSocket
   */
  async function connectWS(config) {
    const serverId = config.id || 'mcp_' + Date.now().toString(36);
    const url = config.url;

    const server = {
      id: serverId,
      name: config.name || serverId,
      transport: 'ws',
      status: 'connecting',
      capabilities: {},
      tools: [],
      resources: [],
      connectedAt: Date.now(),
      _ws: null,
      _pendingRequests: new Map(),
    };

    _servers.set(serverId, server);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      server._ws = ws;

      const timeout = setTimeout(() => {
        reject(new Error('MCP WebSocket connection timeout'));
      }, 10000);

      ws.onopen = async () => {
        clearTimeout(timeout);
        server.status = 'ready';

        // Initialize
        const initResult = await _sendRequest(serverId, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { roots: { listChanged: true } },
          clientInfo: { name: 'FLOWORKOS', version: '1.0.0' },
        });

        if (initResult?.capabilities) {
          server.capabilities = initResult.capabilities;
        }

        _sendNotification(serverId, 'notifications/initialized');
        await _discoverTools(serverId);
        await _discoverResources(serverId);

        console.log(`[FLOWORKOS MCP] ✅ Connected to ${server.name} via WS (${server.tools.length} tools)`);
        resolve({ status: 'ok', serverId, tools: server.tools.length });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          _handleResponse(serverId, data);
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        server.status = 'error';
        reject(new Error('MCP WebSocket connection failed'));
      };

      ws.onclose = () => {
        server.status = 'closed';
      };
    });
  }

  /**
   * Register a "virtual" MCP server (no transport — tools defined inline)
   */
  function registerVirtualServer(config) {
    const serverId = config.id || 'virtual_' + Date.now().toString(36);

    const server = {
      id: serverId,
      name: config.name || serverId,
      transport: 'virtual',
      status: 'ready',
      capabilities: config.capabilities || {},
      tools: config.tools || [],
      resources: config.resources || [],
      connectedAt: Date.now(),
      _handlers: config.handlers || {},
    };

    _servers.set(serverId, server);

    // Register tools
    for (const tool of server.tools) {
      _tools.set(tool.name, { serverId, schema: tool });
    }

    console.log(`[FLOWORKOS MCP] ✅ Virtual server "${server.name}" (${server.tools.length} tools)`);
    return { status: 'ok', serverId };
  }

  // ── Tool Invocation ────────────────────────────────────────

  /**
   * Call a tool on an MCP server
   */
  async function callTool(toolName, args) {
    const toolInfo = _tools.get(toolName);
    if (!toolInfo) return { error: `MCP tool "${toolName}" not found` };

    const server = _servers.get(toolInfo.serverId);
    if (!server) return { error: `MCP server "${toolInfo.serverId}" not found` };
    if (server.status !== 'ready') return { error: `MCP server "${server.name}" not ready (${server.status})` };

    // Virtual server: call handler directly
    if (server.transport === 'virtual' && server._handlers?.[toolName]) {
      try {
        const result = await server._handlers[toolName](args);
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
      } catch (err) {
        return { error: err.message, isError: true };
      }
    }

    // Remote server: JSON-RPC call
    try {
      const result = await _sendRequest(toolInfo.serverId, 'tools/call', {
        name: toolName,
        arguments: args || {},
      });
      return result;
    } catch (err) {
      return { error: err.message, isError: true };
    }
  }

  /**
   * Read a resource from an MCP server
   */
  async function readResource(uri) {
    const resInfo = _resources.get(uri);
    if (!resInfo) return { error: `Resource "${uri}" not found` };

    try {
      const result = await _sendRequest(resInfo.serverId, 'resources/read', { uri });
      return result;
    } catch (err) {
      return { error: err.message };
    }
  }

  // ── Discovery ──────────────────────────────────────────────

  async function _discoverTools(serverId) {
    try {
      const result = await _sendRequest(serverId, 'tools/list', {});
      const server = _servers.get(serverId);
      if (result?.tools) {
        server.tools = result.tools;
        for (const tool of result.tools) {
          _tools.set(tool.name, { serverId, schema: tool });
        }
      }
    } catch {}
  }

  async function _discoverResources(serverId) {
    try {
      const result = await _sendRequest(serverId, 'resources/list', {});
      const server = _servers.get(serverId);
      if (result?.resources) {
        server.resources = result.resources;
        for (const res of result.resources) {
          _resources.set(res.uri, { serverId, resource: res });
        }
      }
    } catch {}
  }

  // ── Transport ──────────────────────────────────────────────

  async function _sendRequest(serverId, method, params) {
    const server = _servers.get(serverId);
    if (!server) throw new Error('Server not found');

    const req = createRequest(method, params);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server._pendingRequests?.delete(req.id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, 30000);

      if (server._pendingRequests) {
        server._pendingRequests.set(req.id, { resolve, reject, timeout });
      }

      const payload = JSON.stringify(req);

      if (server.transport === 'ws' && server._ws) {
        server._ws.send(payload);
      } else if (server.transport === 'sse') {
        // For SSE, send via HTTP POST
        fetch(`${server._url}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(reject);
      } else {
        clearTimeout(timeout);
        reject(new Error(`Unsupported transport: ${server.transport}`));
      }
    });
  }

  function _sendNotification(serverId, method, params) {
    const server = _servers.get(serverId);
    if (!server) return;

    const notification = createNotification(method, params);
    const payload = JSON.stringify(notification);

    if (server.transport === 'ws' && server._ws) {
      server._ws.send(payload);
    } else if (server.transport === 'sse') {
      fetch(`${server._url}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {});
    }
  }

  function _handleResponse(serverId, data) {
    const server = _servers.get(serverId);
    if (!server?._pendingRequests) return;

    if (data.id && server._pendingRequests.has(data.id)) {
      const pending = server._pendingRequests.get(data.id);
      server._pendingRequests.delete(data.id);
      clearTimeout(pending.timeout);

      if (data.error) {
        pending.reject(new Error(data.error.message || 'MCP error'));
      } else {
        pending.resolve(data.result);
      }
    }
  }

  // ── Status ─────────────────────────────────────────────────

  function listServers() {
    const servers = [];
    for (const [id, server] of _servers) {
      servers.push({
        id, name: server.name, transport: server.transport,
        status: server.status, tools: server.tools.length,
        resources: server.resources.length,
      });
    }
    return servers;
  }

  function listAllTools() {
    const tools = [];
    for (const [name, info] of _tools) {
      tools.push({
        name,
        serverId: info.serverId,
        description: info.schema.description || '',
      });
    }
    return tools;
  }

  function disconnect(serverId) {
    const server = _servers.get(serverId);
    if (!server) return { error: 'Not found' };

    if (server._ws) server._ws.close();
    if (server._eventSource) server._eventSource.close();

    // Remove tools
    for (const tool of server.tools) {
      _tools.delete(tool.name);
    }
    for (const res of server.resources) {
      _resources.delete(res.uri);
    }

    _servers.delete(serverId);
    return { status: 'ok' };
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_MCP = {
    connectSSE,
    connectWS,
    registerVirtualServer,
    callTool,
    readResource,
    listServers,
    listAllTools,
    disconnect,
  };

  console.log('[FLOWORKOS] ✅ MCP Protocol Client loaded');
})();
