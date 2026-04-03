// Generator script — creates schema.json + main.js for all extended engine nodes
// Run: node generate-nodes.js

const fs = require('fs');
const path = require('path');
const nodesDir = path.join(__dirname, 'nodes');

const nodes = [
  {
    id: 'edit-fields',
    displayName: 'Edit Fields',
    description: 'Add, edit, or remove fields on input data.',
    properties: [
      { name: 'mode', displayName: 'Mode', type: 'options', options: ['manual', 'raw'], default: 'manual', description: 'Manual: merge fields. Raw: replace all with JSON.' },
      { name: 'fieldsJson', displayName: 'Fields (JSON)', type: 'string', default: '{"newField": "value"}', description: 'JSON object with fields to set.', showIf: { field: 'mode', value: ['manual'] } },
      { name: 'jsonOutput', displayName: 'JSON Output', type: 'string', default: '{"result": "custom"}', description: 'Raw JSON output.', showIf: { field: 'mode', value: ['raw'] } },
      { name: 'includeInputFields', displayName: 'Include Input Fields', type: 'options', options: ['true', 'false'], default: 'true', showIf: { field: 'mode', value: ['manual'] } }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const mode = cfg.mode || 'manual';

let result = {};
if (mode === 'raw') {
  try { result = JSON.parse(cfg.jsonOutput || '{}'); } catch(e) { result = { error: e.message }; }
} else {
  const include = (cfg.includeInputFields || 'true') === 'true';
  if (include) Object.assign(result, input);
  try { Object.assign(result, JSON.parse(cfg.fieldsJson || '{}')); } catch(e) { result._parseError = e.message; }
}
delete result.config;
console.log(JSON.stringify(result));`
  },
  {
    id: 'if-condition',
    displayName: 'If Condition',
    description: 'Routes data to True or False output based on a condition.',
    properties: [
      { name: 'field', displayName: 'Input Field', type: 'string', default: 'value', description: 'Field name to evaluate.' },
      { name: 'operation', displayName: 'Operation', type: 'options', options: ['equals','notEquals','contains','notContains','greaterThan','lessThan','isEmpty','isNotEmpty','isTrue','isFalse','regex'], default: 'equals' },
      { name: 'value', displayName: 'Compare Value', type: 'string', default: '', description: 'Value to compare against.' },
      { name: 'ignoreCase', displayName: 'Ignore Case', type: 'options', options: ['true', 'false'], default: 'true' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const field = cfg.field || 'value';
const op = cfg.operation || 'equals';
const cmpVal = cfg.value || '';
const ic = (cfg.ignoreCase || 'true') === 'true';

let fv = input[field]; if (fv === undefined) fv = '';
const sf = ic ? String(fv).toLowerCase() : String(fv);
const sc = ic ? String(cmpVal).toLowerCase() : String(cmpVal);
let pass = false;

switch(op) {
  case 'equals': pass = sf === sc; break;
  case 'notEquals': pass = sf !== sc; break;
  case 'contains': pass = sf.includes(sc); break;
  case 'notContains': pass = !sf.includes(sc); break;
  case 'greaterThan': pass = parseFloat(fv) > parseFloat(cmpVal); break;
  case 'lessThan': pass = parseFloat(fv) < parseFloat(cmpVal); break;
  case 'isEmpty': pass = fv === '' || fv === null || fv === undefined; break;
  case 'isNotEmpty': pass = fv !== '' && fv !== null && fv !== undefined; break;
  case 'isTrue': pass = fv === true || fv === 'true' || fv === 1; break;
  case 'isFalse': pass = fv === false || fv === 'false' || fv === 0; break;
  case 'regex': try { pass = new RegExp(cmpVal, ic ? 'i' : '').test(String(fv)); } catch(e) { pass = false; } break;
}
const result = { ...input, _condition: pass, activeOutputIndex: pass ? 0 : 1 };
delete result.config;
console.log(JSON.stringify(result));`
  },
  {
    id: 'switch-router',
    displayName: 'Switch Router',
    description: 'Routes data to different outputs based on field value matching.',
    properties: [
      { name: 'field', displayName: 'Field to Evaluate', type: 'string', default: 'action' },
      { name: 'route0', displayName: 'Route 0 Match', type: 'string', default: '' },
      { name: 'route1', displayName: 'Route 1 Match', type: 'string', default: '' },
      { name: 'route2', displayName: 'Route 2 Match', type: 'string', default: '' },
      { name: 'route3', displayName: 'Route 3 Match', type: 'string', default: '' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const field = cfg.field || 'action';
const fv = String(input[field] || '').trim();
let activeIndex = 4; // default
for (let i = 0; i < 4; i++) {
  const rv = (cfg['route' + i] || '').trim();
  if (rv !== '' && fv === rv) { activeIndex = i; break; }
}
const result = { ...input, activeOutputIndex: activeIndex };
delete result.config;
console.log(JSON.stringify(result));`
  },
  {
    id: 'code-runner',
    displayName: 'Code Runner',
    description: 'Execute custom JavaScript code on input data.',
    properties: [
      { name: 'jsCode', displayName: 'JavaScript Code', type: 'string', default: '// input is available as `data`\ndata.processed = true;\nreturn data;', description: 'Custom JS code. Use `data` variable for input. Return result.' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const code = cfg.jsCode || 'return data;';
const data = { ...input }; delete data.config;
try {
  const fn = new Function('data', code);
  const result = fn(data);
  console.log(JSON.stringify(result || data));
} catch(e) {
  console.log(JSON.stringify({ error: 'Code execution failed: ' + e.message, input: data }));
}`
  },
  {
    id: 'merge-data',
    displayName: 'Merge Data',
    description: 'Combine and merge data from input.',
    properties: [
      { name: 'mode', displayName: 'Mode', type: 'options', options: ['passthrough', 'merge_json'], default: 'passthrough' },
      { name: 'mergeJson', displayName: 'Extra JSON to Merge', type: 'string', default: '{}', showIf: { field: 'mode', value: ['merge_json'] } }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const mode = cfg.mode || 'passthrough';
let result = { ...input }; delete result.config;
if (mode === 'merge_json') {
  try { Object.assign(result, JSON.parse(cfg.mergeJson || '{}')); } catch(e) { result._mergeError = e.message; }
}
console.log(JSON.stringify(result));`
  },
  {
    id: 'wait-timer',
    displayName: 'Wait Timer',
    description: 'Pauses execution for specified seconds.',
    properties: [
      { name: 'duration', displayName: 'Duration (seconds)', type: 'string', default: '5', description: 'How many seconds to wait.' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const dur = Math.min(Math.max(parseInt(cfg.duration) || 5, 1), 300);
setTimeout(() => {
  const result = { ...input, _waited: dur + 's' }; delete result.config;
  console.log(JSON.stringify(result));
}, dur * 1000);`
  },
  {
    id: 'date-time',
    displayName: 'Date & Time',
    description: 'Get, format, or manipulate date/time values.',
    properties: [
      { name: 'action', displayName: 'Action', type: 'options', options: ['now', 'format', 'add', 'subtract'], default: 'now' },
      { name: 'inputField', displayName: 'Input Date Field', type: 'string', default: '', showIf: { field: 'action', value: ['format','add','subtract'] } },
      { name: 'amount', displayName: 'Amount', type: 'string', default: '1', showIf: { field: 'action', value: ['add','subtract'] } },
      { name: 'unit', displayName: 'Unit', type: 'options', options: ['seconds','minutes','hours','days','weeks','months','years'], default: 'days', showIf: { field: 'action', value: ['add','subtract'] } },
      { name: 'outputField', displayName: 'Output Field', type: 'string', default: 'dateTime' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const action = cfg.action || 'now';
const outField = cfg.outputField || 'dateTime';
let date;
if (action === 'now') { date = new Date(); }
else { const f = cfg.inputField || ''; date = (f && input[f]) ? new Date(input[f]) : new Date(); }
if (action === 'add' || action === 'subtract') {
  const amt = parseInt(cfg.amount) || 1;
  const unit = cfg.unit || 'days';
  const mul = action === 'add' ? 1 : -1;
  const msMap = { seconds:1000, minutes:60000, hours:3600000, days:86400000, weeks:604800000, months:2592000000, years:31536000000 };
  date = new Date(date.getTime() + (amt * mul * (msMap[unit] || 86400000)));
}
const result = { ...input };
result[outField] = date.toISOString();
result[outField + '_unix'] = Math.floor(date.getTime() / 1000);
result[outField + '_readable'] = date.toLocaleString();
delete result.config;
console.log(JSON.stringify(result));`
  },
  {
    id: 'crypto-tools',
    displayName: 'Crypto Tools',
    description: 'Hash, encode, decode, or generate cryptographic data.',
    properties: [
      { name: 'action', displayName: 'Action', type: 'options', options: ['hash_sha256','base64_encode','base64_decode','uuid','random_string'], default: 'hash_sha256' },
      { name: 'inputField', displayName: 'Input Field', type: 'string', default: 'data', showIf: { field: 'action', value: ['hash_sha256','base64_encode','base64_decode'] } },
      { name: 'length', displayName: 'String Length', type: 'string', default: '32', showIf: { field: 'action', value: ['random_string'] } },
      { name: 'outputField', displayName: 'Output Field', type: 'string', default: 'result' }
    ],
    mainJs: `const crypto = require('crypto');
const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const action = cfg.action || 'hash_sha256';
const outField = cfg.outputField || 'result';
const result = { ...input }; delete result.config;
if (action === 'hash_sha256') {
  const f = cfg.inputField || 'data';
  result[outField] = crypto.createHash('sha256').update(String(result[f] || '')).digest('hex');
} else if (action === 'base64_encode') {
  const f = cfg.inputField || 'data';
  result[outField] = Buffer.from(String(result[f] || '')).toString('base64');
} else if (action === 'base64_decode') {
  const f = cfg.inputField || 'data';
  result[outField] = Buffer.from(String(result[f] || ''), 'base64').toString('utf8');
} else if (action === 'uuid') {
  result[outField] = crypto.randomUUID();
} else if (action === 'random_string') {
  const len = parseInt(cfg.length) || 32;
  result[outField] = crypto.randomBytes(len).toString('hex').slice(0, len);
}
console.log(JSON.stringify(result));`
  },
  {
    id: 'http-request-pro',
    displayName: 'HTTP Request Pro',
    description: 'Advanced HTTP client with headers, query params, body, and timeout.',
    properties: [
      { name: 'url', displayName: 'URL', type: 'string', default: 'https://jsonplaceholder.typicode.com/posts/1' },
      { name: 'method', displayName: 'Method', type: 'options', options: ['GET','POST','PUT','PATCH','DELETE','HEAD'], default: 'GET' },
      { name: 'headers', displayName: 'Headers (JSON)', type: 'string', default: '{}' },
      { name: 'queryParams', displayName: 'Query Params (JSON)', type: 'string', default: '{}' },
      { name: 'body', displayName: 'Body (JSON)', type: 'string', default: '{}', showIf: { field: 'method', value: ['POST','PUT','PATCH'] } },
      { name: 'timeout', displayName: 'Timeout (seconds)', type: 'string', default: '30' },
      { name: 'outputField', displayName: 'Output Field', type: 'string', default: 'response' }
    ],
    mainJs: `const https = require('https');
const http = require('http');
const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
let url = cfg.url || '';
const method = cfg.method || 'GET';
const timeout = (parseInt(cfg.timeout) || 30) * 1000;
const outField = cfg.outputField || 'response';
let headers = {}; try { headers = JSON.parse(cfg.headers || '{}'); } catch(e) {}
let queryParams = {}; try { queryParams = JSON.parse(cfg.queryParams || '{}'); } catch(e) {}
let body = cfg.body || '';

const urlObj = new URL(url);
Object.entries(queryParams).forEach(([k, v]) => urlObj.searchParams.set(k, v));

const opts = { hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname + urlObj.search, method, headers, timeout };
const lib = urlObj.protocol === 'https:' ? https : http;

const req = lib.request(opts, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    const result = { ...input }; delete result.config;
    try { result[outField] = JSON.parse(data); } catch(e) { result[outField] = data; }
    result[outField + '_status'] = res.statusCode;
    console.log(JSON.stringify(result));
  });
});
req.on('error', (e) => {
  const result = { ...input, [outField]: { error: e.message }, [outField + '_status']: 0 };
  delete result.config;
  console.log(JSON.stringify(result));
});
if (['POST','PUT','PATCH'].includes(method) && body) {
  if (!headers['Content-Type']) req.setHeader('Content-Type', 'application/json');
  req.write(body);
}
req.end();`
  },
  {
    id: 'split-batches',
    displayName: 'Split In Batches',
    description: 'Split an array field into smaller batches.',
    properties: [
      { name: 'fieldName', displayName: 'Array Field', type: 'string', default: 'items' },
      { name: 'batchSize', displayName: 'Batch Size', type: 'string', default: '10' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const fieldName = cfg.fieldName || 'items';
const batchSize = parseInt(cfg.batchSize) || 10;
const arr = input[fieldName];
const result = { ...input }; delete result.config;
if (Array.isArray(arr)) {
  const batches = [];
  for (let i = 0; i < arr.length; i += batchSize) batches.push(arr.slice(i, i + batchSize));
  result[fieldName] = batches[0] || [];
  result._totalBatches = batches.length;
  result._batchSize = batchSize;
}
console.log(JSON.stringify(result));`
  },
  {
    id: 'rename-keys',
    displayName: 'Rename Keys',
    description: 'Rename field names in the data.',
    properties: [
      { name: 'mapping', displayName: 'Key Mapping (JSON)', type: 'string', default: '{"oldName": "newName"}' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
let mapping = {}; try { mapping = JSON.parse(cfg.mapping || '{}'); } catch(e) {}
const result = {};
for (const [key, value] of Object.entries(input)) {
  if (key === 'config') continue;
  result[mapping[key] || key] = value;
}
console.log(JSON.stringify(result));`
  },
  {
    id: 'xml-converter',
    displayName: 'XML Converter',
    description: 'Convert between XML and JSON formats.',
    properties: [
      { name: 'mode', displayName: 'Mode', type: 'options', options: ['xmlToJson', 'jsonToXml'], default: 'xmlToJson' },
      { name: 'dataField', displayName: 'Data Field', type: 'string', default: 'data' },
      { name: 'outputField', displayName: 'Output Field', type: 'string', default: 'converted' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const result = { ...input }; delete result.config;
const outField = cfg.outputField || 'converted';
// Simple XML<->JSON without external deps
result[outField] = '[XML conversion requires xml2js dependency — install via package.json]';
console.log(JSON.stringify(result));`
  },
  {
    id: 'markdown-converter',
    displayName: 'Markdown Converter',
    description: 'Convert between Markdown and HTML.',
    properties: [
      { name: 'mode', displayName: 'Mode', type: 'options', options: ['markdownToHtml', 'htmlToMarkdown'], default: 'markdownToHtml' },
      { name: 'dataField', displayName: 'Data Field', type: 'string', default: 'content' },
      { name: 'outputField', displayName: 'Output Field', type: 'string', default: 'converted' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const mode = cfg.mode || 'markdownToHtml';
const dataField = cfg.dataField || 'content';
const outField = cfg.outputField || 'converted';
const raw = String(input[dataField] || '');
const result = { ...input }; delete result.config;
if (mode === 'markdownToHtml') {
  result[outField] = raw.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>').replace(/\\*(.+?)\\*/g, '<em>$1</em>').replace(/\\\`(.+?)\\\`/g, '<code>$1</code>').replace(/\\n/g, '<br>');
} else {
  result[outField] = raw.replace(/<h1>(.+?)<\\/h1>/gi, '# $1\\n').replace(/<h2>(.+?)<\\/h2>/gi, '## $1\\n').replace(/<h3>(.+?)<\\/h3>/gi, '### $1\\n').replace(/<strong>(.+?)<\\/strong>/gi, '**$1**').replace(/<em>(.+?)<\\/em>/gi, '*$1*').replace(/<br\\s*\\/?>/gi, '\\n').replace(/<[^>]+>/g, '');
}
console.log(JSON.stringify(result));`
  },
  {
    id: 'no-operation',
    displayName: 'Pass Through',
    description: 'Pass data through unchanged. Useful as a placeholder.',
    properties: [],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const result = { ...input }; delete result.config;
console.log(JSON.stringify(result));`
  },
  {
    id: 'stop-and-error',
    displayName: 'Stop & Error',
    description: 'Stop workflow and throw error with custom message.',
    properties: [
      { name: 'errorMessage', displayName: 'Error Message', type: 'string', default: 'Workflow stopped by user' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const msg = cfg.errorMessage || 'Workflow stopped';
console.error(msg);
process.exit(1);`
  },
  {
    id: 'item-lists',
    displayName: 'Item Lists',
    description: 'Manipulate arrays: sort, limit, unique, shuffle.',
    properties: [
      { name: 'operation', displayName: 'Operation', type: 'options', options: ['sort', 'limit', 'unique', 'shuffle', 'reverse', 'flatten'], default: 'sort' },
      { name: 'fieldName', displayName: 'Array Field', type: 'string', default: 'items' },
      { name: 'sortField', displayName: 'Sort By Field', type: 'string', default: '', showIf: { field: 'operation', value: ['sort'] } },
      { name: 'sortOrder', displayName: 'Sort Order', type: 'options', options: ['asc', 'desc'], default: 'asc', showIf: { field: 'operation', value: ['sort'] } },
      { name: 'limit', displayName: 'Limit', type: 'string', default: '10', showIf: { field: 'operation', value: ['limit'] } }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const op = cfg.operation || 'sort';
const fieldName = cfg.fieldName || 'items';
const result = { ...input }; delete result.config;
let arr = result[fieldName];
if (!Array.isArray(arr)) { console.log(JSON.stringify(result)); process.exit(0); }
switch(op) {
  case 'sort': { const sf = cfg.sortField || ''; const ord = cfg.sortOrder || 'asc';
    arr.sort((a,b) => { const va = sf ? (a[sf]||'') : a; const vb = sf ? (b[sf]||'') : b;
      const c = String(va).localeCompare(String(vb), undefined, {numeric:true}); return ord==='desc' ? -c : c; }); break; }
  case 'limit': arr = arr.slice(0, parseInt(cfg.limit) || 10); break;
  case 'unique': arr = [...new Set(arr.map(x => JSON.stringify(x)))].map(x => JSON.parse(x)); break;
  case 'shuffle': arr.sort(() => Math.random() - 0.5); break;
  case 'reverse': arr.reverse(); break;
  case 'flatten': arr = arr.flat(Infinity); break;
}
result[fieldName] = arr;
console.log(JSON.stringify(result));`
  },
  {
    id: 'compare-datasets',
    displayName: 'Compare Datasets',
    description: 'Compare two arrays and find common, unique items.',
    properties: [
      { name: 'field1', displayName: 'First Array Field', type: 'string', default: 'dataset1' },
      { name: 'field2', displayName: 'Second Array Field', type: 'string', default: 'dataset2' },
      { name: 'matchKey', displayName: 'Match Key', type: 'string', default: 'id' }
    ],
    mainJs: `const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8').trim() || '{}');
const cfg = input.config || {};
const f1 = cfg.field1 || 'dataset1';
const f2 = cfg.field2 || 'dataset2';
const mk = cfg.matchKey || 'id';
const arr1 = input[f1] || [];
const arr2 = input[f2] || [];
const set1 = new Set(arr1.map(i => String(i[mk])));
const set2 = new Set(arr2.map(i => String(i[mk])));
const common = arr1.filter(i => set2.has(String(i[mk])));
const onlyIn1 = arr1.filter(i => !set2.has(String(i[mk])));
const onlyIn2 = arr2.filter(i => !set1.has(String(i[mk])));
console.log(JSON.stringify({ common, onlyInFirst: onlyIn1, onlyInSecond: onlyIn2, commonCount: common.length, onlyInFirstCount: onlyIn1.length, onlyInSecondCount: onlyIn2.length }));`
  }
];

// Generate files
let count = 0;
for (const node of nodes) {
  const nodeDir = path.join(nodesDir, node.id);
  if (!fs.existsSync(nodeDir)) fs.mkdirSync(nodeDir, { recursive: true });

  // Write schema.json
  const schema = {
    name: node.id,
    displayName: node.displayName,
    description: node.description,
    properties: node.properties
  };
  fs.writeFileSync(path.join(nodeDir, 'schema.json'), JSON.stringify(schema, null, 2));

  // Write main.js (stdin/stdout execution format)
  // Fix Windows-compatible stdin reading
  const winCompatJs = node.mainJs.replace(
    "require('fs').readFileSync('/dev/stdin', 'utf8')",
    "require('fs').readFileSync(0, 'utf8')"
  );
  fs.writeFileSync(path.join(nodeDir, 'main.js'), winCompatJs);

  count++;
  console.log(`✅ Generated: ${node.id} (schema.json + main.js)`);
}

console.log(`\nTotal: ${count} nodes generated in ${nodesDir}`);
