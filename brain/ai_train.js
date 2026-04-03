// =========================================================================
// FLOWORK OS - AI TRAIN PAGE (MOCK UI)
// FILE: brain/ai_train.js
// DESKRIPSI: Industry-standard AI Training Dashboard mock.
//            - Mode Selection (from agent_mode_router.js)
//            - Training Data Management (mock)
//            - Playground / Test (mock)
//            - Resource Monitoring (mock)
// =========================================================================

(function () {
    'use strict';

    const AITRAIN_MODES = [
        {
            id: 'app_builder', label: '🔨 App Builder', color: '#06d6a0',
            desc: 'Build, edit, and deploy Flowork apps',
            stats: { tools: 64, accuracy: '94.2%', lastTrained: '2 days ago' }
        },
        {
            id: 'browser_automation', label: '🌐 Browser AI', color: '#00f0ff',
            desc: 'Control and automate browser tabs',
            stats: { tools: 38, accuracy: '91.8%', lastTrained: '5 hours ago' }
        },
        {
            id: 'node_builder', label: '🧩 Node Builder', color: '#ffd166',
            desc: 'Create and edit workflow nodes',
            stats: { tools: 28, accuracy: '96.1%', lastTrained: '1 day ago' }
        },
        {
            id: 'main', label: '🤖 Main AI', color: '#ff0066',
            desc: 'Full-power AI with all capabilities',
            stats: { tools: 'ALL', accuracy: '89.5%', lastTrained: '3 hours ago' }
        },
        {
            id: 'plan', label: '📋 Plan Mode', color: '#8b5cf6',
            desc: 'AI shows execution plan before acting',
            stats: { tools: 22, accuracy: '97.3%', lastTrained: '1 day ago' }
        }
    ];

    const MOCK_TRAINING_DATA = [
        { name: 'browser_actions_v3.jsonl', records: 12480, size: '4.2 MB', status: 'ready', quality: 98 },
        { name: 'app_builder_flows.jsonl', records: 8340, size: '2.8 MB', status: 'ready', quality: 95 },
        { name: 'node_schemas_v2.jsonl', records: 3210, size: '1.1 MB', status: 'processing', quality: 88 },
        { name: 'user_feedback_apr.jsonl', records: 1560, size: '0.5 MB', status: 'validating', quality: 72 },
    ];

    const MOCK_RUNS = [
        { id: 'run-042', mode: 'Browser AI', epochs: 5, loss: 0.0234, status: 'completed', date: '2026-04-02' },
        { id: 'run-041', mode: 'App Builder', epochs: 3, loss: 0.0312, status: 'completed', date: '2026-04-01' },
        { id: 'run-040', mode: 'Main AI', epochs: 8, loss: 0.0189, status: 'completed', date: '2026-03-30' },
    ];

    function renderAITrainView() {
        const view = document.getElementById('aitrain-view');
        if (!view) return;

        view.innerHTML = `
            <div style="padding:15px 20px; border-bottom:1px solid rgba(0,240,255,0.12); display:flex; align-items:center; justify-content:space-between; background:rgba(6,214,160,0.03); flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="font-weight:700; font-size:15px; font-family:'Orbitron','Inter',sans-serif; letter-spacing:2px; background:linear-gradient(135deg,#06d6a0,#00f0ff); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;">
                        🧠 AI TRAINING CENTER
                    </div>
                    <div style="font-size:10px; color:#3a4d6a; background:rgba(6,214,160,0.08); padding:3px 10px; border-radius:20px; border:1px solid rgba(6,214,160,0.15);">
                        v2.0 • ${AITRAIN_MODES.length} Modes
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="font-size:10px;color:#06d6a0;" id="aitrain-active-mode">Active: 🤖 Main AI</div>
                    <div style="width:8px;height:8px;border-radius:50%;background:#06d6a0;box-shadow:0 0 8px #06d6a0;animation:pulse 2s infinite;"></div>
                </div>
            </div>

            <div style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:24px;">

                <!-- ROW 1: STATUS BAR -->
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px;">
                    ${_renderStatCard('Total Training Runs', '42', '#00f0ff', '📊')}
                    ${_renderStatCard('Active Model', 'flowork-v2.8', '#06d6a0', '🧠')}
                    ${_renderStatCard('Training Data', '25,590 records', '#ffd166', '📁')}
                    ${_renderStatCard('Avg. Accuracy', '93.8%', '#ff0066', '🎯')}
                </div>

                <!-- ROW 2: MODE SELECTION -->
                <div>
                    <div style="font-size:12px; font-weight:700; color:#8a9aaa; letter-spacing:2px; text-transform:uppercase; margin-bottom:12px;">
                        AI Mode Selection
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px;">
                        ${AITRAIN_MODES.map(m => _renderModeCard(m)).join('')}
                    </div>
                </div>

                <!-- ROW 3: TRAINING DATA + RECENT RUNS -->
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
                    <!-- Training Data -->
                    <div style="background:rgba(0,240,255,0.02); border:1px solid rgba(0,240,255,0.08); border-radius:10px; padding:16px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
                            <div style="font-size:12px; font-weight:700; color:#00f0ff; letter-spacing:1px;">📁 TRAINING DATASETS</div>
                            <button onclick="alert('Upload coming soon')" style="font-size:10px; padding:4px 12px; background:rgba(6,214,160,0.12); color:#06d6a0; border:1px solid rgba(6,214,160,0.2); border-radius:6px; cursor:pointer; font-weight:700;">+ Upload</button>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${MOCK_TRAINING_DATA.map(d => _renderDatasetRow(d)).join('')}
                        </div>
                    </div>

                    <!-- Recent Runs -->
                    <div style="background:rgba(0,240,255,0.02); border:1px solid rgba(0,240,255,0.08); border-radius:10px; padding:16px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
                            <div style="font-size:12px; font-weight:700; color:#8b5cf6; letter-spacing:1px;">🔄 RECENT TRAINING RUNS</div>
                            <button onclick="alert('New run coming soon')" style="font-size:10px; padding:4px 12px; background:rgba(255,0,102,0.12); color:#ff0066; border:1px solid rgba(255,0,102,0.2); border-radius:6px; cursor:pointer; font-weight:700;">▶ New Run</button>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${MOCK_RUNS.map(r => _renderRunRow(r)).join('')}
                        </div>
                    </div>
                </div>

                <!-- ROW 4: PLAYGROUND -->
                <div style="background:rgba(0,240,255,0.02); border:1px solid rgba(0,240,255,0.08); border-radius:10px; padding:16px;">
                    <div style="font-size:12px; font-weight:700; color:#ffd166; letter-spacing:1px; margin-bottom:12px;">🧪 PLAYGROUND — Test Your Model</div>
                    <div style="display:flex; gap:12px; align-items:flex-start;">
                        <textarea id="aitrain-playground-input" placeholder="Type a test prompt here..." 
                            style="flex:1; height:70px; background:rgba(0,0,0,0.3); color:#c8d6e5; border:1px solid rgba(0,240,255,0.12); border-radius:8px; padding:10px; font-family:'JetBrains Mono',monospace; font-size:12px; resize:none; outline:none;"></textarea>
                        <button onclick="document.getElementById('aitrain-playground-output').textContent='[Mock] I would execute the browser_automation tools to navigate to the target URL, capture a screenshot, and extract the relevant DOM elements...'" 
                            style="padding:10px 20px; background:linear-gradient(135deg,rgba(0,240,255,0.15),rgba(255,0,102,0.08)); color:#00f0ff; border:1px solid rgba(0,240,255,0.2); border-radius:8px; cursor:pointer; font-weight:700; font-size:12px; white-space:nowrap;">
                            ▶ Run Test
                        </button>
                    </div>
                    <div id="aitrain-playground-output" 
                        style="margin-top:10px; padding:12px; background:rgba(0,0,0,0.2); border:1px solid rgba(0,240,255,0.06); border-radius:8px; font-family:'JetBrains Mono',monospace; font-size:11px; color:#3a4d6a; min-height:40px; line-height:1.6;">
                        Output will appear here...
                    </div>
                </div>

                <!-- ROW 5: RESOURCE MONITOR -->
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">
                    ${_renderResourceBar('GPU Usage', 34, '#06d6a0')}
                    ${_renderResourceBar('Memory', 62, '#ffd166')}
                    ${_renderResourceBar('API Cost (today)', 18, '#00f0ff')}
                </div>
            </div>
        `;

        // Update active mode indicator
        if (window.activeAIMode) {
            const mode = AITRAIN_MODES.find(m => m.id === window.activeAIMode);
            const indicator = document.getElementById('aitrain-active-mode');
            if (indicator && mode) indicator.textContent = 'Active: ' + mode.label;
        }
    }

    function _renderStatCard(label, value, color, icon) {
        return `<div style="background:rgba(0,0,0,0.25); border:1px solid ${color}22; border-radius:10px; padding:14px; text-align:center;">
            <div style="font-size:20px; margin-bottom:4px;">${icon}</div>
            <div style="font-size:16px; font-weight:700; color:${color}; font-family:'Orbitron',sans-serif;">${value}</div>
            <div style="font-size:10px; color:#3a4d6a; margin-top:4px; letter-spacing:1px;">${label}</div>
        </div>`;
    }

    function _renderModeCard(mode) {
        const isActive = window.activeAIMode === mode.id;
        const borderStyle = isActive ? `2px solid ${mode.color}` : `1px solid ${mode.color}22`;
        const bgStyle = isActive ? `rgba(${_hexToRgb(mode.color)},0.08)` : 'rgba(0,0,0,0.2)';
        return `<div onclick="if(window.setAIMode)window.setAIMode('${mode.id}');setTimeout(()=>{if(window.FW_UI._renderAITrain)window.FW_UI._renderAITrain()},100);"
            style="background:${bgStyle}; border:${borderStyle}; border-radius:10px; padding:14px; cursor:pointer; transition:all 0.2s; position:relative;"
            onmouseover="this.style.borderColor='${mode.color}';this.style.boxShadow='0 0 15px ${mode.color}22';"
            onmouseout="this.style.borderColor='${isActive ? mode.color : mode.color + '22'}';this.style.boxShadow='none';">
            ${isActive ? `<div style="position:absolute;top:8px;right:8px;font-size:8px;padding:2px 8px;background:${mode.color}22;color:${mode.color};border-radius:10px;font-weight:700;letter-spacing:1px;">ACTIVE</div>` : ''}
            <div style="font-size:14px; font-weight:700; color:${mode.color}; margin-bottom:4px;">${mode.label}</div>
            <div style="font-size:10px; color:#8a9aaa; line-height:1.5; margin-bottom:10px;">${mode.desc}</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <span style="font-size:9px; padding:2px 8px; background:rgba(255,255,255,0.04); border-radius:4px; color:#8a9aaa;">🔧 ${mode.stats.tools} tools</span>
                <span style="font-size:9px; padding:2px 8px; background:rgba(255,255,255,0.04); border-radius:4px; color:#8a9aaa;">🎯 ${mode.stats.accuracy}</span>
                <span style="font-size:9px; padding:2px 8px; background:rgba(255,255,255,0.04); border-radius:4px; color:#8a9aaa;">⏱ ${mode.stats.lastTrained}</span>
            </div>
        </div>`;
    }

    function _renderDatasetRow(d) {
        const statusColors = { ready: '#06d6a0', processing: '#ffd166', validating: '#00f0ff' };
        const clr = statusColors[d.status] || '#8a9aaa';
        return `<div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(0,0,0,0.15); border-radius:6px; font-size:11px;">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="color:#8a9aaa;">📄</span>
                <span style="color:#c8d6e5; font-weight:600;">${d.name}</span>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="color:#3a4d6a;">${d.records.toLocaleString()} rows</span>
                <span style="color:#3a4d6a;">${d.size}</span>
                <div style="width:40px; height:4px; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden;">
                    <div style="width:${d.quality}%; height:100%; background:${clr}; border-radius:2px;"></div>
                </div>
                <span style="color:${clr}; font-weight:700; text-transform:uppercase; font-size:9px; letter-spacing:1px;">${d.status}</span>
            </div>
        </div>`;
    }

    function _renderRunRow(r) {
        return `<div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(0,0,0,0.15); border-radius:6px; font-size:11px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="color:#8b5cf6; font-weight:700; font-family:'JetBrains Mono',monospace;">${r.id}</span>
                <span style="color:#c8d6e5;">${r.mode}</span>
            </div>
            <div style="display:flex;align-items:center;gap:14px;">
                <span style="color:#3a4d6a;">${r.epochs} epochs</span>
                <span style="color:#06d6a0; font-family:'JetBrains Mono',monospace;">loss: ${r.loss}</span>
                <span style="color:#3a4d6a;">${r.date}</span>
                <span style="color:#06d6a0; font-size:9px; font-weight:700; letter-spacing:1px;">✓ ${r.status.toUpperCase()}</span>
            </div>
        </div>`;
    }

    function _renderResourceBar(label, pct, color) {
        return `<div style="background:rgba(0,0,0,0.25); border:1px solid ${color}22; border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:10px; color:#8a9aaa; letter-spacing:1px;">${label}</span>
                <span style="font-size:12px; font-weight:700; color:${color}; font-family:'Orbitron',sans-serif;">${pct}%</span>
            </div>
            <div style="width:100%; height:6px; background:rgba(255,255,255,0.04); border-radius:3px; overflow:hidden;">
                <div style="width:${pct}%; height:100%; background:linear-gradient(90deg,${color},${color}88); border-radius:3px; transition:width 1s ease;"></div>
            </div>
        </div>`;
    }

    function _hexToRgb(hex) {
        const h = hex.replace('#', '');
        return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)].join(',');
    }

    // Expose
    window.FW_UI = window.FW_UI || {};
    window.FW_UI._renderAITrain = renderAITrainView;

    console.log('[Flowork OS] ✅ AI Train page loaded');
})();
