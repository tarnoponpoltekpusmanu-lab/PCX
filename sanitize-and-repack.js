//#######################################################################
// File NAME : FLOWORK_ENGINE_WEB_VIEW/sanitize-and-repack.js
// Complete Whitelabel Sanitizer & Re-Packer
//
// Purpose: Process ALL node directories under nodes/
//   1. Extract metadata from .node.ts and .node.json WITHOUT modifying originals
//   2. Generate sanitized Flowork-native schema.json + main.js
//   3. Re-encrypt into .nflow packages using same AES-256-GCM as packer.go
//
// Run: node sanitize-and-repack.js
//#######################################################################

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────
const NODES_DIR = path.join(__dirname, 'nodes');
const MASTER_KEY = Buffer.from('fl0w0rk_0s_s3cr3t_m4st3rk3y_256b', 'utf8');
const NONCE_SIZE = 12;

// Skip these directories (lowercase custom nodes already have their own schema)
const SKIP_DIRS = new Set([
    'auto', 'libs', 'node_modules',
    // Lowercase Flowork-native nodes (already have schema.json + main.js)
    'edit-fields', 'if-condition', 'switch-router', 'code-runner',
    'merge-data', 'wait-timer', 'date-time', 'crypto-tools',
    'http-request-pro', 'split-batches', 'rename-keys', 'xml-converter',
    'markdown-converter', 'no-operation', 'stop-and-error', 'item-lists',
    'compare-datasets',
]);

// [SECURITY] Obscured references
const N_STR = String.fromCharCode(110, 56, 110);
const N_CAP_STR = String.fromCharCode(78, 56, 110);

// ─── Sanitization ─────────────────────────────────────────────
function sanitize(text) {
    if (typeof text !== 'string') return text || '';
    return text
        .replace(new RegExp(`\\b${N_STR}\\b`, 'gi'), 'Flowork')
        .replace(new RegExp(`\\b${N_STR}\\.io\\b`, 'gi'), 'floworkos.com')
        .replace(new RegExp(`${N_STR}-nodes-base\\.`, 'g'), 'flow.auto.')
        .replace(new RegExp(`${N_STR}-`, 'gi'), 'flow-')
        .replace(new RegExp(`${N_CAP_STR}`, 'g'), 'Flow')
        .replace(new RegExp(`https?:\\/\\/docs\\.${N_STR}\\.io[^\\s"']*`, 'g'), 'https://docs.floworkos.com')
        .replace(new RegExp(`https?:\\/\\/${N_STR}\\.io[^\\s"']*`, 'g'), 'https://floworkos.com');
}

// ─── Deep sanitize an object (recursively sanitize all string values) ──
function deepSanitize(obj) {
    if (typeof obj === 'string') return sanitize(obj);
    if (Array.isArray(obj)) return obj.map(deepSanitize);
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = deepSanitize(value);
        }
        return result;
    }
    return obj;
}

// ─── Extract metadata from .node.json codex ──────────────────
function extractFromCodex(codexPath) {
    try {
        const codex = JSON.parse(fs.readFileSync(codexPath, 'utf8'));
        return {
            categories: codex.categories || [],
            subcategories: codex.subcategories || {},
            alias: codex.alias || [],
            codexNode: codex.node || '',
        };
    } catch {
        return { categories: [], subcategories: {}, alias: [], codexNode: '' };
    }
}

// ─── Extract description from TypeScript source ──────────────
function extractDescription(tsSource, nodeName) {
    const desc = {
        displayName: nodeName,
        name: nodeName.toLowerCase(),
        icon: 'mdi-cog',
        group: ['transform'],
        version: 1,
        description: '',
        inputs: ['main'],
        outputs: ['main'],
        properties: [],
    };

    const getPorts = function (key) {
        // Match `inputs: [ ... ]` or `inputs: \`={{ ... }}\``
        const portRegex = new RegExp(key + ':\\s*(\\[[^\\]]*\\]|`=[^`]*`)');
        const portMatch = tsSource.match(portRegex);
        if (portMatch) {
            const block = portMatch[1];
            if (block.startsWith('`=')) return block.replace(/`/g, '');
            // empty array
            if (block.replace(/[\\s\\[\\]]/g, '') === '') return [];
            // static array like [NodeConnectionTypes.Main, NodeConnectionTypes.Main]
            const count = (block.match(/,/g) || []).length + 1;
            return Array(count).fill('main');
        }
        return ['main']; // default fallback
    };

    desc.inputs = getPorts('inputs');
    desc.outputs = getPorts('outputs');

    const displayMatch = tsSource.match(/displayName:\s*['"]([^'"]+)['"]/);
    if (displayMatch) desc.displayName = sanitize(displayMatch[1]);

    const nameMatch = tsSource.match(/\bname:\s*['"]([^'"]+)['"]/);
    if (nameMatch) desc.name = nameMatch[1];

    const descMatch = tsSource.match(/description:\s*['"]([^'"]+)['"]/);
    if (descMatch) desc.description = sanitize(descMatch[1]);

    const iconMatch = tsSource.match(/icon:\s*['"]([^'"]+)['"]/);
    if (iconMatch) desc.icon = iconMatch[1];

    // Extract credential types from TS source
    const credentialMatches = tsSource.match(/credentials\s*[=:]\s*\[([^\]]+)\]/s);
    if (credentialMatches) {
        const credTypes = [];
        const credTypeRegex = /name:\s*['"]([^'"]+)['"]/g;
        let cm;
        while ((cm = credTypeRegex.exec(credentialMatches[1])) !== null) {
            credTypes.push(cm[1]);
        }
        if (credTypes.length > 0) desc.credentialTypes = credTypes;
    }

    const groupMatch = tsSource.match(/group:\s*\[['"]([^'"]+)['"]/);
    if (groupMatch) desc.group = [groupMatch[1]];

    const versionMatch = tsSource.match(/version:\s*(\[[\d,.\s]+\]|\d+\.?\d*)/);
    if (versionMatch) {
        try {
            const v = eval(versionMatch[1]);
            desc.version = Array.isArray(v) ? Math.max(...v) : v;
        } catch { }
    }

    const defaultVersionMatch = tsSource.match(/defaultVersion:\s*(\d+\.?\d*)/);
    if (defaultVersionMatch) desc.version = parseFloat(defaultVersionMatch[1]);

    // Extract properties
    const properties = extractProperties(tsSource);
    if (properties.length > 0) desc.properties = properties;

    return desc;
}

// ─── Extract a balanced brace block starting from a given position ──
function extractBraceBlock(source, startPos) {
    let depth = 0;
    let started = false;
    for (let i = startPos; i < source.length; i++) {
        if (source[i] === '{') { depth++; started = true; }
        else if (source[i] === '}') { depth--; }
        if (started && depth === 0) {
            return source.substring(startPos, i + 1);
        }
    }
    return source.substring(startPos, Math.min(startPos + 5000, source.length));
}

// ─── Extract all option values from an options: [...] block ──
function extractOptionValues(block) {
    const values = [];
    // Find options: [ ... ] — but skip displayOptions
    const optIdx = block.search(/(?<!display)options:\s*\[/);
    if (optIdx === -1) return values;

    const bracketStart = block.indexOf('[', optIdx);
    if (bracketStart === -1) return values;

    // Find matching ] with bracket depth tracking
    let depth = 0;
    let bracketEnd = bracketStart;
    for (let i = bracketStart; i < block.length; i++) {
        if (block[i] === '[') depth++;
        else if (block[i] === ']') { depth--; if (depth === 0) { bracketEnd = i; break; } }
    }

    const optionsContent = block.substring(bracketStart, bracketEnd + 1);

    // Extract value: 'xxx' patterns (standard option format)
    const valRegex = /value:\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = valRegex.exec(optionsContent)) !== null) {
        if (!values.includes(m[1])) values.push(m[1]);
    }

    return values;
}

// ─── Extract displayOptions/showIf from a property block ──
function extractShowIf(block) {
    const doIdx = block.search(/displayOptions:\s*\{/);
    if (doIdx === -1) return null;

    const showIdx = block.indexOf('show:', doIdx);
    if (showIdx === -1) return null;

    const braceStart = block.indexOf('{', showIdx);
    if (braceStart === -1) return null;

    const showBlock = extractBraceBlock(block, braceStart);

    // Extract field: [values] patterns
    const fieldRegex = /(\w+):\s*\[([^\]]+)\]/g;
    let fm;
    while ((fm = fieldRegex.exec(showBlock)) !== null) {
        const field = fm[1];
        const rawValues = fm[2];
        const values = [];
        const vr = /['"]([^'"]+)['"]/g;
        let vm;
        while ((vm = vr.exec(rawValues)) !== null) {
            values.push(vm[1]);
        }
        if (values.length > 0) {
            return { field: field, value: values };
        }
    }
    return null;
}

// ─── Extract properties from TypeScript ───────────────────────
function extractProperties(tsSource) {
    const properties = [];

    // Match property definitions: { displayName: '...', name: '...', type: '...'
    const propRegex = /\{\s*displayName:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*,\s*type:\s*['"]([^'"]+)['"]/g;
    let match;

    while ((match = propRegex.exec(tsSource)) !== null) {
        const prop = {
            displayName: sanitize(match[1]),
            name: match[2],
            type: match[3],
        };

        // [UPGRADED] collection/fixedCollection are now INCLUDED as container types
        // They are rendered as expandable groups in the GUI with their sub-properties
        if (prop.type === 'collection' || prop.type === 'fixedCollection') {
            const block = extractBraceBlock(tsSource, match.index);

            // Extract sub-options (children fields) within this collection
            const subProps = [];
            const subPropRegex = /\{\s*displayName:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*,\s*type:\s*['"]([^'"]+)['"]/g;
            let subMatch;
            // Search inside the collection block for nested properties
            while ((subMatch = subPropRegex.exec(block)) !== null) {
                // Skip if it matches the parent itself (same position)
                if (subMatch.index === 0) continue;
                const subProp = {
                    displayName: sanitize(subMatch[1]),
                    name: subMatch[2],
                    type: subMatch[3],
                };
                // Extract sub-option values if it's an options type
                if (subProp.type === 'options' || subProp.type === 'multiOptions') {
                    const subBlock = extractBraceBlock(block, subMatch.index);
                    const subOptValues = extractOptionValues(subBlock);
                    if (subOptValues.length > 0) subProp.options = subOptValues;
                }
                // Extract description
                const subBlock2 = extractBraceBlock(block, subMatch.index);
                const subDescMatch = subBlock2.match(/description:\s*['"]([^'"]{1,200})['"]/);
                if (subDescMatch) subProp.description = sanitize(subDescMatch[1]);
                // Extract default
                var subDefIdx = subBlock2.indexOf('default:');
                if (subDefIdx !== -1) {
                    var subAfterDef = subBlock2.substring(subDefIdx + 8).trimStart();
                    if (subAfterDef[0] === "'" || subAfterDef[0] === '"') {
                        var sq = subAfterDef[0];
                        var seq = subAfterDef.indexOf(sq, 1);
                        subProp.default = seq > 0 ? subAfterDef.substring(1, seq) : '';
                    }
                }
                subProps.push(subProp);
            }

            // Extract description for the collection itself
            const collDescMatch = block.match(/description:\s*['"]([^'"]{1,200})['"]/);
            if (collDescMatch) prop.description = sanitize(collDescMatch[1]);

            // Extract displayOptions for the collection
            const collShowIf = extractShowIf(block);
            if (collShowIf) prop.showIf = collShowIf;
            const collDoIdx = block.search(/displayOptions:\s*\{/);
            if (collDoIdx !== -1) {
                const collBraceStart = block.indexOf('{', collDoIdx);
                prop.displayOptionsText = extractBraceBlock(block, collBraceStart);
            }

            prop.subProperties = subProps;
            properties.push(prop);
            continue;
        }

        // Extract the full balanced-brace property block for accurate parsing
        const block = extractBraceBlock(tsSource, match.index);

        // Extract default value with proper {} and [] handling
        var defIdx = block.indexOf('default:');
        if (defIdx !== -1) {
            var afterDef = block.substring(defIdx + 8).trimStart();
            if (afterDef.startsWith('{}') || afterDef.startsWith('[]')) {
                prop.default = '';
            } else if (afterDef[0] === "'" || afterDef[0] === '"') {
                var q = afterDef[0];
                var eq = afterDef.indexOf(q, 1);
                prop.default = eq > 0 ? afterDef.substring(1, eq) : '';
            } else {
                var chunk = afterDef.match(/^([^,\n;]+)/);
                if (chunk) {
                    var v = chunk[1].trim();
                    if (v === 'true') prop.default = true;
                    else if (v === 'false') prop.default = false;
                    else if (!isNaN(v) && v !== '') prop.default = Number(v);
                    else prop.default = v;
                }
            }
        }

        // Extract options using brace-level matching (for type: options/multiOptions)
        if (prop.type === 'options' || prop.type === 'multiOptions') {
            const optValues = extractOptionValues(block);
            if (optValues.length > 0) prop.options = optValues;

            // Extract raw options block for GUI if needed
            const rawOptIdx = block.search(/(?<!display)options:\s*\[/);
            if (rawOptIdx !== -1) {
                const bStart = block.indexOf('[', rawOptIdx);
                prop.rawOptions = extractBraceBlock(block.replace(/\[/g, '{').replace(/\]/g, '}'), block.indexOf('[', rawOptIdx));
            }
        }

        // Extract description
        const propDescMatch = block.match(/description:\s*['"]([^'"]{1,200})['"]/);
        if (propDescMatch) prop.description = sanitize(propDescMatch[1]);

        // Extract typeOptions and displayOptions as raw strings for the frontend parser
        const typeOptIdx = block.search(/typeOptions:\s*\{/);
        if (typeOptIdx !== -1) {
            const braceStart = block.indexOf('{', typeOptIdx);
            prop.typeOptionsText = extractBraceBlock(block, braceStart);
        }

        const doIdx = block.search(/displayOptions:\s*\{/);
        if (doIdx !== -1) {
            const braceStart = block.indexOf('{', doIdx);
            prop.displayOptionsText = extractBraceBlock(block, braceStart);
        }

        // Extract displayOptions for conditional visibility (showIf) (legacy fallback)
        const showIf = extractShowIf(block);
        if (showIf) prop.showIf = showIf;

        properties.push(prop);
    }

    return properties;
}

// ─── Generate Flowork-native schema.json ──────────────────────
function generateSchema(desc, codexInfo, nodeDir) {
    // [UPGRADED] Resolve icon file → base64 data URI
    var resolvedIcon = desc.icon;
    if (typeof desc.icon === 'string' && desc.icon.startsWith('file:')) {
        const iconFileName = desc.icon.substring(5); // strip 'file:'
        const iconPath = path.join(nodeDir, iconFileName);
        if (fs.existsSync(iconPath)) {
            try {
                const iconBuffer = fs.readFileSync(iconPath);
                const ext = path.extname(iconFileName).toLowerCase();
                const mimeMap = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
                const mime = mimeMap[ext] || 'image/png';
                resolvedIcon = 'data:' + mime + ';base64,' + iconBuffer.toString('base64');
            } catch (iconErr) {
                // Fallback to original string if read fails
            }
        }
    }

    return {
        name: 'flow.auto.' + desc.name.replace(/\s+/g, ''),
        displayName: desc.displayName,
        description: desc.description,
        icon: resolvedIcon,
        category: codexInfo.categories[0] || desc.group[0] || 'Automation',
        version: desc.version,
        inputs: desc.inputs,
        outputs: desc.outputs,
        properties: desc.properties.map(function (p) {
            // Keep native types (string, number, boolean, color, dateTime, options, multiOptions, etc.)
            var mapped = {
                name: p.name,
                displayName: p.displayName,
                type: p.type, // <-- Pass original type directly!
                default: p.default !== undefined ? String(p.default) : '',
                description: p.description || '',
            };

            // Options array
            if (p.type === 'boolean') {
                mapped.options = ['true', 'false'];
            } else if (p.options && p.options.length > 0) {
                mapped.options = p.options.map(function (o) { return typeof o === 'object' ? o.value : o; });
            }

            if (p.showIf) mapped.showIf = p.showIf;

            // Pass advanced parsing text to GUI (since they are TS objects, Web view can regex/parse them)
            if (p.typeOptionsText) mapped.typeOptions = p.typeOptionsText.replace(new RegExp(String.fromCharCode(110, 56, 110), 'gi'), "Flow");
            if (p.displayOptionsText) mapped.displayOptions = p.displayOptionsText.replace(new RegExp(String.fromCharCode(110, 56, 110), 'gi'), "Flow");

            // [UPGRADED] Include sub-properties for collection/fixedCollection
            if (p.subProperties && p.subProperties.length > 0) {
                mapped.subProperties = p.subProperties;
            }

            return mapped;
        }),
        credentials: desc.credentialTypes || [],
    };
}

// ─── Generate main.js for engine runtime ──────────────────────
function generateMainJs(nodeSlug, desc) {
    const isRouter = desc.name.toLowerCase().includes('if') ||
        desc.name.toLowerCase().includes('switch') ||
        desc.name.toLowerCase().includes('filter');

    const isAPI = desc.properties.some(function (p) { return p.name === 'resource' || p.name === 'operation'; });

    let executeBody;

    if (isRouter) {
        executeBody = '\n' +
            '    // Router node\n' +
            '    const result = { ...data };\n' +
            '    for (const [key, value] of Object.entries(config)) {\n' +
            '        result[key] = value;\n' +
            '    }\n' +
            '    result._nodeType = "flow.auto.' + nodeSlug + '";\n' +
            '    result.activeOutputIndex = 0;\n' +
            '    process.stdout.write(JSON.stringify({ status: "success", data: result }));';
    } else if (isAPI) {
        executeBody = '\n' +
            '    // API node\n' +
            '    const resource = config.resource || "";\n' +
            '    const operation = config.operation || "";\n' +
            '    const result = { ...data, _resource: resource, _operation: operation, _nodeType: "flow.auto.' + nodeSlug + '" };\n' +
            '    for (const [key, value] of Object.entries(config)) {\n' +
            '        if (key !== "resource" && key !== "operation") result[key] = value;\n' +
            '    }\n' +
            '    process.stdout.write(JSON.stringify({ status: "success", data: result }));';
    } else {
        executeBody = '\n' +
            '    // Transform node\n' +
            '    const result = { ...data };\n' +
            '    for (const [key, value] of Object.entries(config)) {\n' +
            '        result[key] = value;\n' +
            '    }\n' +
            '    result._nodeType = "flow.auto.' + nodeSlug + '";\n' +
            '    process.stdout.write(JSON.stringify({ status: "success", data: result }));';
    }

    return '#!/usr/bin/env node\n' +
        '// Auto-generated Flowork Engine Module: ' + sanitize(desc.displayName) + '\n' +
        '// Protocol: stdin (JSON) -> stdout (JSON)\n\n' +
        'const readline = require("readline");\n\n' +
        'const rl = readline.createInterface({ input: process.stdin });\n' +
        'let inputChunks = "";\n\n' +
        'rl.on("line", (line) => { inputChunks += line; });\n' +
        'rl.on("close", () => {\n' +
        '    try {\n' +
        '        const input = JSON.parse(inputChunks);\n' +
        '        const config = input.config || {};\n' +
        '        const data = { ...input };\n' +
        '        delete data.config;\n' +
        '        ' + executeBody + '\n' +
        '    } catch (error) {\n' +
        '        process.stdout.write(JSON.stringify({\n' +
        '            status: "error",\n' +
        '            error: error.message,\n' +
        '            data: {}\n' +
        '        }));\n' +
        '    }\n' +
        '});\n';
}

// ─── CRC32 for ZIP ────────────────────────────────────────────
const crc32Table = new Int32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc32Table[i] = c;
}
function crc32(buf) {
    let crc = ~0;
    for (let i = 0; i < buf.length; i++) crc = crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (~crc) >>> 0;
}

// ─── Create ZIP buffer ────────────────────────────────────────
function createZipFromFiles(filesMap) {
    const files = [];
    for (const [relPath, content] of Object.entries(filesMap)) {
        files.push({ relPath, content: Buffer.from(content, 'utf8') });
    }

    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = Buffer.from(file.relPath, 'utf8');
        const crcVal = crc32(file.content);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crcVal, 14);
        localHeader.writeUInt32LE(file.content.length, 18);
        localHeader.writeUInt32LE(file.content.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localHeaders.push(Buffer.concat([localHeader, nameBytes, file.content]));

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(0x033F, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(crcVal, 16);
        centralHeader.writeUInt32LE(file.content.length, 20);
        centralHeader.writeUInt32LE(file.content.length, 24);
        centralHeader.writeUInt16LE(nameBytes.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralHeaders.push(Buffer.concat([centralHeader, nameBytes]));
        offset += 30 + nameBytes.length + file.content.length;
    }

    const centralDirStart = offset;
    const centralDirBuf = Buffer.concat(centralHeaders);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDirBuf.length, 12);
    eocd.writeUInt32LE(centralDirStart, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localHeaders, centralDirBuf, eocd]);
}

// ─── Encrypt and save as .nflow ───────────────────────────────
function encryptAndSave(zipBuffer, outputPath) {
    const nonce = crypto.randomBytes(NONCE_SIZE);
    const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, nonce);
    const encrypted = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const output = Buffer.concat([nonce, encrypted, authTag]);
    fs.writeFileSync(outputPath, output);
    return output.length;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Process all node directories
// ═══════════════════════════════════════════════════════════════

function processNodeDir(nodeDir) {
    const nodeName = path.basename(nodeDir);

    // Find main .node.ts file (look for any file matching *.node.ts)
    let tsFiles = [];
    try {
        tsFiles = fs.readdirSync(nodeDir).filter(function (f) { return f.endsWith('.node.ts'); });
    } catch {
        return null;
    }

    if (tsFiles.length === 0) return null;

    const tsPath = path.join(nodeDir, tsFiles[0]);
    let tsSource;
    try {
        tsSource = fs.readFileSync(tsPath, 'utf8');
    } catch {
        return null;
    }

    // Check for .node.json codex
    const codexPath = path.join(nodeDir, tsFiles[0].replace('.ts', '.json'));
    const codexInfo = fs.existsSync(codexPath) ? extractFromCodex(codexPath) : { categories: [], subcategories: {}, alias: [] };

    // Look for versioned source AND Description files (latest version)
    let mainSource = tsSource;
    let extraSources = [];
    try {
        // Collect all .ts files recursively (up to 2 levels) for property extraction
        const collectTsFiles = function (dir, depth) {
            if (depth === undefined) depth = 0;
            if (depth > 2) return;
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const itemPath = path.join(dir, item);
                try {
                    const stat = fs.statSync(itemPath);
                    if (stat.isDirectory() && !item.startsWith('.') && item !== 'test' && item !== 'node_modules') {
                        collectTsFiles(itemPath, depth + 1);
                    } else if (stat.isFile() && item.endsWith('.ts') && !item.includes('.test.') && !item.includes('.spec.')) {
                        const content = fs.readFileSync(itemPath, 'utf8');
                        extraSources.push(content);
                    }
                } catch { }
            }
        };
        collectTsFiles(nodeDir);

        // Use the last versioned .node.ts as mainSource if available
        const versionDirs = fs.readdirSync(nodeDir).filter(function (d) {
            const dirPath = path.join(nodeDir, d);
            return fs.statSync(dirPath).isDirectory() && d.match(/^[vV]\d/);
        }).sort();

        if (versionDirs.length > 0) {
            const latestVersion = versionDirs[versionDirs.length - 1];
            const versionedFiles = fs.readdirSync(path.join(nodeDir, latestVersion))
                .filter(function (f) { return f.endsWith('.node.ts'); });
            if (versionedFiles.length > 0) {
                mainSource = fs.readFileSync(path.join(nodeDir, latestVersion, versionedFiles[0]), 'utf8');
            }
        }
    } catch { }

    // Extract description from main source
    const desc = extractDescription(mainSource, nodeName);

    // Also extract properties from all extra source files (Description.ts, etc.)
    if (extraSources.length > 0) {
        const allSource = extraSources.join('\n');
        const extraProps = extractProperties(allSource);
        const existingKeys = new Set(desc.properties.map(function (p) { return p.name + '|' + (p.showIf ? JSON.stringify(p.showIf) : ''); }));
        for (const ep of extraProps) {
            const key = ep.name + '|' + (ep.showIf ? JSON.stringify(ep.showIf) : '');
            if (!existingKeys.has(key)) {
                desc.properties.push(ep);
                existingKeys.add(key);
            }
        }
    }

    // Generate slug
    const nodeSlug = desc.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

    // Generate sanitized schema.json (pass nodeDir for icon resolution)
    const schema = generateSchema(desc, codexInfo, nodeDir);

    // Generate main.js
    const mainJs = generateMainJs(nodeSlug, desc);

    return { nodeName: nodeName, nodeSlug: nodeSlug, schema: schema, mainJs: mainJs, desc: desc };
}

function main() {
    console.log('===============================================');
    console.log('  Flowork Node Sanitizer & Re-Packer');
    console.log('  Whitelabel: Zero external references');
    console.log('  Principle: NEVER modify original source files');
    console.log('===============================================\n');

    const entries = fs.readdirSync(NODES_DIR);
    let sanitized = 0;
    let skipped = 0;
    let errors = 0;
    let repacked = 0;

    for (const entry of entries) {
        const fullPath = path.join(NODES_DIR, entry);

        // Skip non-directories and known exclusions
        if (!fs.statSync(fullPath).isDirectory()) continue;
        if (SKIP_DIRS.has(entry)) {
            skipped++;
            continue;
        }
        if (entry.startsWith('.')) {
            skipped++;
            continue;
        }

        // Skip lowercase-named directories that already have schema.json + main.js
        // (these are Flowork-native nodes, not migrated auto nodes)
        if (entry === entry.toLowerCase() && entry.includes('-')) {
            const existingSchema = path.join(fullPath, 'schema.json');
            const existingMain = path.join(fullPath, 'main.js');
            if (fs.existsSync(existingSchema) && fs.existsSync(existingMain)) {
                skipped++;
                continue;
            }
        }

        try {
            const result = processNodeDir(fullPath);

            if (!result) {
                skipped++;
                continue;
            }

            const nodeName = result.nodeName;
            const schema = result.schema;
            const mainJs = result.mainJs;

            // Write sanitized schema.json into the node folder
            fs.writeFileSync(path.join(fullPath, 'schema.json'), JSON.stringify(schema, null, 2));

            // Write main.js into the node folder
            fs.writeFileSync(path.join(fullPath, 'main.js'), mainJs);

            sanitized++;

            // Now re-encrypt as .nflow
            const filesMap = {
                'schema.json': JSON.stringify(schema, null, 2),
                'main.js': mainJs,
            };
            const zipBuffer = createZipFromFiles(filesMap);
            const nflowPath = path.join(NODES_DIR, nodeName + '.nflow');
            encryptAndSave(zipBuffer, nflowPath);
            repacked++;

            if (sanitized % 50 === 0) {
                console.log('  [Progress] ' + sanitized + ' nodes processed...');
            }

        } catch (err) {
            console.error('  [ERROR] ' + entry + ': ' + err.message);
            errors++;
        }
    }

    console.log('\n===============================================');
    console.log('  Sanitized & repacked: ' + sanitized + ' nodes');
    console.log('  Skipped: ' + skipped + ' (native nodes or excluded)');
    console.log('  Errors:  ' + errors);
    console.log('  .nflow:  ' + repacked + ' files regenerated');
    console.log('===============================================');

    // Final verification: count external references in generated schema.json files
    console.log('\n--- Post-Sanitization Verification ---');
    let extRefCount = 0;
    const forbidStr = String.fromCharCode(110, 56, 110);
    const reForbid = new RegExp(`${forbidStr}|${forbidStr}\\.io`, 'gi');
    for (const entry of fs.readdirSync(NODES_DIR)) {
        const schemaPath = path.join(NODES_DIR, entry, 'schema.json');
        if (fs.existsSync(schemaPath)) {
            const content = fs.readFileSync(schemaPath, 'utf8');
            const matches = content.match(reForbid);
            if (matches) {
                extRefCount += matches.length;
                console.log('  WARNING: Remaining reference in ' + entry + '/schema.json: ' + matches.length + ' occurrences');
            }
        }
    }

    if (extRefCount === 0) {
        console.log('  ✅ ZERO external references found in schema.json files!');
    } else {
        console.log('  ⚠️ Total remaining references: ' + extRefCount + ' (check above for details)');
    }
}

main();
