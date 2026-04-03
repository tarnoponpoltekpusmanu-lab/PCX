/**
 * pack-nodes.js — Encrypt raw node folders into .nflow files
 * Uses EXACT SAME algorithm as Flowork Engine's internal/packer/packer.go:
 *   1. ZIP folder contents (schema.json + main.js)
 *   2. AES-256-GCM encrypt with MasterKey
 *   3. Output: [nonce (12 bytes)] + [ciphertext + authTag (16 bytes)]
 * 
 * Run: node pack-nodes.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver') || null;

// MUST match Go packer.go: fl0w0rk_0s_s3cr3t_m4st3rk3y_256b
const MASTER_KEY = Buffer.from('fl0w0rk_0s_s3cr3t_m4st3rk3y_256b', 'utf8');
const NONCE_SIZE = 12; // GCM standard

const nodesDir = path.join(__dirname, 'nodes');

// Manual ZIP implementation — no external deps needed
// We use Node.js built-in zlib for deflate, and manually construct ZIP format
function createZipBuffer(folderPath) {
  return new Promise((resolve, reject) => {
    const files = [];
    
    function walkDir(dir, prefix) {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relPath = prefix ? prefix + '/' + entry : entry;
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && !entry.startsWith('.') && entry !== 'libs') {
          files.push({ relPath, fullPath, size: stat.size });
        } else if (stat.isDirectory() && entry !== 'libs' && entry !== 'node_modules') {
          walkDir(fullPath, relPath);
        }
      }
    }
    
    walkDir(folderPath, '');
    
    // Build ZIP manually using stored (no compression) method for simplicity
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;
    
    for (const file of files) {
      const content = fs.readFileSync(file.fullPath);
      const nameBytes = Buffer.from(file.relPath, 'utf8');
      const crc = crc32(content);
      
      // Local file header
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);  // signature
      localHeader.writeUInt16LE(20, 4);           // version needed
      localHeader.writeUInt16LE(0x0800, 6);       // flags (UTF-8)
      localHeader.writeUInt16LE(0, 8);            // compression: stored
      localHeader.writeUInt16LE(0, 10);           // mod time
      localHeader.writeUInt16LE(0, 12);           // mod date
      localHeader.writeUInt32LE(crc, 14);         // crc32
      localHeader.writeUInt32LE(content.length, 18); // compressed size
      localHeader.writeUInt32LE(content.length, 22); // uncompressed size
      localHeader.writeUInt16LE(nameBytes.length, 26); // file name length
      localHeader.writeUInt16LE(0, 28);           // extra field length
      
      localHeaders.push(Buffer.concat([localHeader, nameBytes, content]));
      
      // Central directory header
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);  // signature
      centralHeader.writeUInt16LE(0x033F, 4);      // version made by
      centralHeader.writeUInt16LE(20, 6);          // version needed
      centralHeader.writeUInt16LE(0x0800, 8);      // flags
      centralHeader.writeUInt16LE(0, 10);          // compression
      centralHeader.writeUInt16LE(0, 12);          // mod time
      centralHeader.writeUInt16LE(0, 14);          // mod date
      centralHeader.writeUInt32LE(crc, 16);        // crc32
      centralHeader.writeUInt32LE(content.length, 20);
      centralHeader.writeUInt32LE(content.length, 24);
      centralHeader.writeUInt16LE(nameBytes.length, 28);
      centralHeader.writeUInt16LE(0, 30);          // extra
      centralHeader.writeUInt16LE(0, 32);          // comment
      centralHeader.writeUInt16LE(0, 34);          // disk
      centralHeader.writeUInt16LE(0, 36);          // internal attrs
      centralHeader.writeUInt32LE(0, 38);          // external attrs
      centralHeader.writeUInt32LE(offset, 42);     // relative offset
      
      centralHeaders.push(Buffer.concat([centralHeader, nameBytes]));
      offset += 30 + nameBytes.length + content.length;
    }
    
    const centralDirStart = offset;
    const centralDirBuf = Buffer.concat(centralHeaders);
    
    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);           // signature
    eocd.writeUInt16LE(0, 4);                    // disk
    eocd.writeUInt16LE(0, 6);                    // disk with central dir
    eocd.writeUInt16LE(files.length, 8);         // entries on disk
    eocd.writeUInt16LE(files.length, 10);        // total entries
    eocd.writeUInt32LE(centralDirBuf.length, 12); // central dir size
    eocd.writeUInt32LE(centralDirStart, 16);     // central dir offset
    eocd.writeUInt16LE(0, 20);                   // comment length
    
    resolve(Buffer.concat([...localHeaders, centralDirBuf, eocd]));
  });
}

// CRC32 table
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

async function packNode(nodeId) {
  const nodeDir = path.join(nodesDir, nodeId);
  const schemaPath = path.join(nodeDir, 'schema.json');
  const mainPath = path.join(nodeDir, 'main.js');
  
  if (!fs.existsSync(schemaPath) || !fs.existsSync(mainPath)) {
    console.log(`⚠️ Skipping ${nodeId}: missing schema.json or main.js`);
    return false;
  }
  
  // Step 1: Create ZIP buffer
  const zipBuffer = await createZipBuffer(nodeDir);
  
  // Step 2: AES-256-GCM encrypt (matching Go packer.go)
  const nonce = crypto.randomBytes(NONCE_SIZE);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, nonce);
  const encrypted = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Step 3: Output: nonce + encrypted + authTag
  const output = Buffer.concat([nonce, encrypted, authTag]);
  
  const outputPath = path.join(nodesDir, nodeId + '.nflow');
  fs.writeFileSync(outputPath, output);
  
  console.log(`🔐 Packed: ${nodeId}.nflow (${output.length} bytes)`);
  return true;
}

async function packAutoNode(autoSlug) {
  const autoDir = path.join(nodesDir, 'auto', autoSlug);
  const schemaPath = path.join(autoDir, 'schema.json');
  const mainPath = path.join(autoDir, 'main.js');
  
  if (!fs.existsSync(schemaPath) || !fs.existsSync(mainPath)) {
    return false;
  }
  
  // Step 1: Create ZIP buffer from auto node folder
  const zipBuffer = await createZipBuffer(autoDir);
  
  // Step 2: AES-256-GCM encrypt (matching Go packer.go)
  const nonce = crypto.randomBytes(NONCE_SIZE);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, nonce);
  const encrypted = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Step 3: Output to nodes root as auto-{slug}.nflow
  const output = Buffer.concat([nonce, encrypted, authTag]);
  const outputPath = path.join(nodesDir, 'auto-' + autoSlug + '.nflow');
  fs.writeFileSync(outputPath, output);
  
  return true;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Flowork Node Packer — AES-256-GCM Encryption');
  console.log('═══════════════════════════════════════════════\n');
  
  // ─── Phase 1: Pack existing top-level engine nodes ───
  console.log('─── Phase 1: Packing Extended Engine Nodes ───');
  const entries = fs.readdirSync(nodesDir);
  let count = 0;
  
  for (const entry of entries) {
    const fullPath = path.join(nodesDir, entry);
    if (fs.statSync(fullPath).isDirectory() && !entry.startsWith('.') && entry !== 'auto') {
      if (await packNode(entry)) count++;
    }
  }
  console.log(`✅ Extended nodes packed: ${count}`);
  
  // ─── Phase 2: Pack auto nodes from nodes/auto/ ───
  console.log('\n─── Phase 2: Packing Auto Modules (Offline) ───');
  const autoDir = path.join(nodesDir, 'auto');
  let autoCount = 0;
  let autoSkipped = 0;
  
  if (fs.existsSync(autoDir)) {
    const autoEntries = fs.readdirSync(autoDir);
    
    for (const autoEntry of autoEntries) {
      const autoFullPath = path.join(autoDir, autoEntry);
      if (fs.statSync(autoFullPath).isDirectory() && !autoEntry.startsWith('.')) {
        if (await packAutoNode(autoEntry)) {
          autoCount++;
          if (autoCount % 50 === 0) {
            console.log(`  [Progress] ${autoCount} auto nodes packed...`);
          }
        } else {
          autoSkipped++;
        }
      }
    }
  }
  
  console.log(`✅ Auto nodes packed: ${autoCount} (skipped: ${autoSkipped})`);
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  📦 Total: ${count + autoCount} nodes encrypted to .nflow`);
  console.log(`═══════════════════════════════════════════════`);
}

main().catch(console.error);
