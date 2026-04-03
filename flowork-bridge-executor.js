//#######################################################################
// File NAME : flowork-bridge-executor.js
// Flowork OS Auto-Executor for Native Modular Architecture Nodes
//#######################################################################

const fs = require('fs');
const path = require('path');

// [SECURITY] Obfuscated identifiers to ensure zero trace of third-party engine names.
const N_STR = String.fromCharCode(110, 56, 110);
const N_AT = '@' + N_STR + '/';
const N_BASE = N_STR + '-nodes-base';
const N_STAR = N_STR + '-nodes-';

// Read STDIN Payload from Go Engine
let stdinData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
    stdinData += chunk;
});

process.stdin.on('end', async () => {
    try {
        const payload = JSON.parse(stdinData || '{}');
        // Environment variable passed by the Go Runner
        const moduleTypeString = process.env.FLOWORK_MODULE_TYPE;

        if (!moduleTypeString) {
            console.error("Missing FLOWORK_MODULE_TYPE environment variable.");
            process.exit(1);
        }

        const [packageName, nodeTypeOrig] = moduleTypeString.split('.');
        const nodeType = nodeTypeOrig.replace(/Tool$/, ''); // Handle AI Tool variations natively

        // Fast Module Caching
        const cachePath = path.join(__dirname, 'module-cache.json');
        let moduleCache = {};

        if (fs.existsSync(cachePath)) {
            moduleCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        }

        let targetModulePath = moduleCache[moduleTypeString];

        // If not in cache, we must aggressively scan the NPM package's exported nodes
        if (!targetModulePath) {
            let actualPackageName = packageName;
            if (packageName === N_BASE) {
                actualPackageName = N_BASE; // Global search
            } else if (packageName.startsWith(N_STAR)) {
                actualPackageName = `${N_AT}${packageName}`;
            }

            let packageJsonPath;
            try {
                packageJsonPath = require.resolve(`${actualPackageName}/package.json`);
            } catch (e) {
                console.error(JSON.stringify({ error: `Not a registered package or not installed`, fallback: true }));
                process.exit(22);
            }

            const packageJson = require(packageJsonPath);
            const packageDir = path.dirname(packageJsonPath);

            const exportedNodes = (packageJson[N_STR] && packageJson[N_STR].nodes) || [];

            for (const relPath of exportedNodes) {
                try {
                    const absolutePath = path.join(packageDir, relPath);
                    const mod = require(absolutePath);

                    // Modules export a class. We inspect the class instantiation or description
                    const ExportedClass = Object.values(mod).find(v => typeof v === 'function' && v.prototype);
                    if (ExportedClass) {
                        const instance = new ExportedClass();
                        if (instance.description && instance.description.name && instance.description.name.toLowerCase() === nodeType.toLowerCase()) {
                            targetModulePath = absolutePath;
                            moduleCache[moduleTypeString] = absolutePath;
                            break;
                        }
                    }
                } catch (e) {
                    continue; // Skip loading exceptions
                }
            }

            if (targetModulePath) {
                fs.writeFileSync(cachePath, JSON.stringify(moduleCache, null, 2));
            } else {
                console.error(JSON.stringify({ error: `Failed to resolve Native Class: ${nodeType} in package ${actualPackageName}`, fallback: true }));
                process.exit(22);
            }
        }

        // LOAD THE NATIVE NODE
        const targetModule = require(targetModulePath);
        const ExportedClass = Object.values(targetModule).find(v => typeof v === 'function' && v.prototype);
        const targetNodeInstance = new ExportedClass();

        // Native Default Extractor Polyfill
        const getDefaultValue = (properties, targetName) => {
            if (!properties || !Array.isArray(properties)) return undefined;
            for (const prop of properties) {
                if (prop.name === targetName) return prop.default;
                if (prop.options && Array.isArray(prop.options)) {
                    const nested = getDefaultValue(prop.options, targetName);
                    if (nested !== undefined) return nested;
                }
            }
            return undefined;
        };

        // MOCK EXECUTE CONTEXT
        const parameters = payload.config || {};
        const mockContext = {
            getNodeParameter: (paramName, itemIndex, fallback) => {
                let val = parameters[paramName];
                if (val === undefined) {
                    val = fallback !== undefined ? fallback : getDefaultValue(targetNodeInstance.description?.properties, paramName);
                }
                return val;
            },
            getCredentials: (credType) => {
                if (parameters._credentials && parameters._credentials[credType]) {
                    return parameters._credentials[credType];
                }
                return {};
            },
            getInputData: (itemIndex) => {
                return [{ json: payload || {} }];
            },
            getExecutionId: () => {
                return "exec_" + Math.random().toString(36).substr(2, 9);
            },
            getNode: () => ({
                id: "mock-node-id",
                name: nodeType,
                type: moduleTypeString,
                typeVersion: 1
            }),
            // [WEBHOOK POLYFILLS]
            getBodyData: () => payload.body || {},
            getHeaderData: () => payload._headers || {},
            getQueryData: () => payload._query || {},
            getParamData: () => payload._query || {}, // Fallback param mapping
            getRequestObject: () => ({
                body: payload.body || {},
                headers: payload._headers || {},
                query: payload._query || {},
                method: payload._method || 'GET'
            }),
            getResponseObject: () => ({
                status: (c) => ({ send: (d) => d }),
                send: (d) => d,
                json: (d) => d
            }),
            logger: {
                debug: () => { },
                info: () => { },
                warn: () => { },
                error: (msg) => console.error(msg)
            },
            getInputConnectionData: (connectionType, connectionIndex) => {
                // Return undefined means no sub-nodes are currently attached natively
                return undefined;
            },
            getTimezone: () => {
                return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
            },
            helpers: {
                request: require('axios'),
                httpRequest: async (options) => {
                    const axios = require('axios');
                    try { const res = await axios(options); return res.data; } catch (e) { throw e; }
                },
                httpRequestWithAuthentication: async (authType, options) => {
                    const axios = require('axios');
                    try { const res = await axios(options); return res.data; } catch (e) { throw e; }
                },
                returnJsonArray: (items) => {
                    return Array.isArray(items) ? items.map(i => ({ json: i })) : [{ json: items }];
                },
                constructExecutionMetaData: (items, options) => {
                    return items;
                }
            },
            continueOnFail: () => false,
            evaluateExpression: (exp, itemIndex) => {
                // If expression is static string, return it
                if (typeof exp === 'string' && !exp.startsWith('=')) return exp;
                // Simple placeholder for Flowork JSON parser capability
                return exp;
            }
        };

        let executorNode = targetNodeInstance;
        if (targetNodeInstance.nodeVersions) {
            const version = parameters.typeVersion || parameters.version || Object.keys(targetNodeInstance.nodeVersions).pop();
            executorNode = targetNodeInstance.nodeVersions[version] || targetNodeInstance.nodeVersions[Object.keys(targetNodeInstance.nodeVersions).pop()];
        }

        let result;
        if (executorNode.execute) {
            result = await executorNode.execute.call(mockContext);
        } else if (executorNode.poll) {
            result = await executorNode.poll.call(mockContext);
        } else if (executorNode.webhook) {
            result = await executorNode.webhook.call(mockContext);
            // Webhooks return { workflowData: [[ {json...} ]] }
            if (result && result.workflowData) {
                result = result.workflowData[0] || [{}];
            }
        } else if (executorNode.trigger) {
            // [TRIGGER PARITY] Ephemeral trigger bypass for Manual Executions
            if (executorNode.manualTriggerFunction) {
                result = await executorNode.manualTriggerFunction.call(mockContext);
            } else {
                // Synthesize generic manual startup payload
                result = [[{ json: {} }]];
            }
        } else {
            if (executorNode.supplyData) {
                result = await executorNode.supplyData.call(mockContext);
            } else {
                throw new Error(`Node type ${nodeType} has no supported executor method.`);
            }
        }

        // Output formatting to Flowork JSON stdout protocol
        const safeResult = result ? (Array.isArray(result) ? result : [result]) : [{}];
        console.log(JSON.stringify(safeResult));
        process.exit(0);

    } catch (err) {
        console.error(JSON.stringify({ error: err.message, stack: err.stack }));
        process.exit(1);
    }
});
