// =========================================================================
// FLOWORK OS — Brain IDE Bridge Module
// Connect to external IDEs (VS Code, etc.) via WebSocket.
// Enables bi-directional communication for code intelligence.
// =========================================================================

(function() {
    'use strict';

    let bridgeWs = null;
    let bridgePort = 9876;
    let isConnected = false;

    function start(input) {
        if (isConnected) return { result: '🔗 IDE Bridge already connected and running.' };

        const port = input.port || bridgePort;
        bridgePort = port;

        try {
            const ws = new WebSocket(`ws://localhost:${port}`);
            let connectTimeout = null;

            ws.onopen = () => {
                clearTimeout(connectTimeout);
                isConnected = true;
                bridgeWs = ws;
                console.log(`[IDEBridge] ✅ Connected to IDE on port ${port}`);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'context') {
                        window._ideContext = msg.data;
                    }
                } catch(e) {}
            };

            ws.onerror = (err) => {
                console.warn(`[IDEBridge] ⚠️ Connection error on port ${port}.`);
            };

            ws.onclose = () => {
                isConnected = false;
                bridgeWs = null;
                // Auto-retry after 10 seconds if it was previously connected
                if (input.auto_retry !== false) {
                    setTimeout(() => {
                        if (!isConnected) {
                            console.log('[IDEBridge] 🔄 Auto-retrying connection...');
                            start({ port, auto_retry: false }); // One retry only
                        }
                    }, 10000);
                }
            };

            // Timeout: if not connected in 3 seconds, give helpful feedback
            connectTimeout = setTimeout(() => {
                if (!isConnected) {
                    console.log('[IDEBridge] ⏰ Connection attempt timed out');
                }
            }, 3000);

            return {
                result: `🔗 IDE Bridge connecting to ws://localhost:${port}...\n` +
                        `If no IDE extension is running, the connection will retry automatically.\n\n` +
                        `Setup instructions:\n` +
                        `  1. Install "Flowork Bridge" extension in VS Code\n` +
                        `  2. Open command palette → "Flowork: Start Bridge Server"\n` +
                        `  3. Extension listens on port ${port}\n\n` +
                        `Alternative: Start a WebSocket server on port ${port} that sends { type: "context", data: {...} } messages.`
            };
        } catch(e) {
            return { error: `Failed to start IDE Bridge: ${e.message}` };
        }
    }

    function stop(input) {
        if (bridgeWs) {
            bridgeWs.close();
            bridgeWs = null;
        }
        isConnected = false;
        return { result: '🔌 IDE Bridge disconnected.' };
    }

    function status(input) {
        return {
            result: JSON.stringify({
                connected: isConnected,
                port: bridgePort,
                ideContext: window._ideContext || null,
            }, null, 2)
        };
    }

    function getContext(input) {
        if (!isConnected || !bridgeWs) {
            return { result: 'IDE Bridge not connected. Use bridge_start first.' };
        }

        // Request context from IDE
        bridgeWs.send(JSON.stringify({ type: 'get_context', data: {} }));

        // Return cached context if available
        if (window._ideContext) {
            return {
                result: JSON.stringify({
                    file: window._ideContext.file,
                    line: window._ideContext.line,
                    selection: window._ideContext.selection,
                    language: window._ideContext.language,
                }, null, 2)
            };
        }

        return { result: 'Context requested from IDE. Check again in a moment.' };
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkBridge = { start, stop, status, getContext };

    console.log('[Brain] ✅ IDE Bridge module loaded');
})();
