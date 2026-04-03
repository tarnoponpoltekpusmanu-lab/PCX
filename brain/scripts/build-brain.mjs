// scripts/build-brain.mjs
// Compiles brain/legacy-brain/ TypeScript → brain/dist/brain_flowork_bundle.js

import * as esbuild from 'esbuild'
import { resolve, dirname } from 'node:path'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dir, '..')
const BRAIN_SRC = resolve(ROOT, 'legacy-brain')

const watch = process.argv.includes('--watch')
const minify = process.argv.includes('--minify')

const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'child_process', 'http', 'https',
  'net', 'tls', 'url', 'util', 'stream', 'events', 'buffer',
  'querystring', 'readline', 'zlib', 'assert', 'tty', 'worker_threads',
  'perf_hooks', 'async_hooks', 'dns', 'dgram', 'cluster',
  'string_decoder', 'module', 'vm', 'constants', 'domain',
  'console', 'process', 'v8', 'inspector',
])

// CJS stub content — esbuild can't statically check CJS exports,
// so any named import from a stub just becomes undefined (not an error)
const STUB_CJS = `
var noop = function(){};
var noopAsync = function(){ return Promise.resolve({}); };
var identity = function(x){ return x; };
var base = {
  __esModule: true,
  default: {},
  createElement: noop, Fragment: 'div', useState: function(v){ return [v, noop]; },
  useEffect: noop, useRef: function(v){ return {current:v}; }, useCallback: identity,
  useMemo: function(fn){ return fn(); }, useContext: function(){ return {}; }, memo: identity,
  forwardRef: identity, createContext: function(){ return {Provider:noop, Consumer:noop}; },
  jsx: noop, jsxs: noop, jsxDEV: noop, c: noop,
};
var handler = {
  get: function(t, k) { return k in t ? t[k] : noop; }
};
module.exports = typeof Proxy !== 'undefined' ? new Proxy(base, handler) : base;
`

// ── Plugin: resolve 'src/' imports ──
const srcResolverPlugin = {
  name: 'src-resolver',
  setup(build) {
    build.onResolve({ filter: /^src\// }, (args) => {
      const rel = args.path.replace(/^src\//, '')
      const base = resolve(BRAIN_SRC, rel)
      if (existsSync(base)) return { path: base }
      const noExt = base.replace(/\.(js|jsx)$/, '')
      for (const e of ['.ts', '.tsx', '.js', '.jsx']) {
        if (existsSync(noExt + e)) return { path: noExt + e }
      }
      for (const e of ['.ts', '.tsx', '.js', '.jsx']) {
        const c = resolve(base.replace(/\.(js|jsx)$/, ''), 'index' + e)
        if (existsSync(c)) return { path: c }
      }
      return { path: args.path, namespace: 'stub-ns' }
    })
  },
}

// ── Plugin: universal stub ──
const stubPlugin = {
  name: 'stub',
  setup(build) {
    // @ant/* internal packages
    build.onResolve({ filter: /^@ant\// }, () => ({
      path: resolve(BRAIN_SRC, 'brain_flowork_shims/ant-stub.ts'),
    }))

    // @floworkos-ai/sdk → stub
    build.onResolve({ filter: /^@floworkos-ai\// }, () => ({
      path: 'sdk', namespace: 'stub-ns',
    }))

    // React family → stub  
    build.onResolve({ filter: /^react$|^react\/|^react-dom|^react-reconciler/ }, () => ({
      path: 'react', namespace: 'stub-ns',
    }))

    // Bare module catch-all (skip builtins & installed packages)
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('node:') || args.path === 'bun:bundle') return undefined
      const name = args.path.startsWith('@')
        ? args.path.split('/').slice(0, 2).join('/')
        : args.path.split('/')[0]
      if (NODE_BUILTINS.has(name)) return undefined
      if (existsSync(resolve(ROOT, 'node_modules', name))) return undefined
      return { path: args.path, namespace: 'stub-ns' }
    })

    // Missing relative imports
    build.onResolve({ filter: /^\./ }, (args) => {
      const dir = dirname(args.importer)
      const raw = resolve(dir, args.path)
      if (existsSync(raw)) return undefined
      if (args.path.endsWith('.js') || args.path.endsWith('.jsx')) {
        const noExt = raw.replace(/\.(js|jsx)$/, '')
        for (const e of ['.ts', '.tsx', '.js', '.jsx']) {
          if (existsSync(noExt + e)) return undefined
        }
        for (const e of ['.ts', '.tsx', '.js', '.jsx']) {
          if (existsSync(resolve(noExt, 'index' + e))) return undefined
        }
      }
      // Also try without extension for extensionless imports
      for (const e of ['.ts', '.tsx', '.js', '.jsx']) {
        if (existsSync(raw + e)) return undefined
      }
      for (const e of ['.ts', '.tsx', '.js', '.jsx']) {
        if (existsSync(resolve(raw, 'index' + e))) return undefined
      }
      return { path: args.path, namespace: 'stub-ns' }
    })

    // CJS stub loader — prevents "no matching export" errors
    build.onLoad({ filter: /.*/, namespace: 'stub-ns' }, (args) => ({
      contents: `/* stub: ${args.path} */\n${STUB_CJS}`,
      loader: 'js',
    }))
  },
}

const buildOptions = {
  entryPoints: [resolve(BRAIN_SRC, 'brain_flowork_query_engine.ts')],
  bundle: true,
  platform: 'node',
  target: ['es2022'],
  format: 'esm',
  outdir: resolve(ROOT, 'dist'),
  outExtension: { '.js': '.js' },
  splitting: false,
  plugins: [srcResolverPlugin, stubPlugin],
  tsconfig: resolve(ROOT, 'tsconfig.json'),
  alias: {
    'bun:bundle': resolve(BRAIN_SRC, 'brain_flowork_shims/bun-bundle.ts'),
  },
  external: [...NODE_BUILTINS, ...[...NODE_BUILTINS].map(b => `node:${b}`),
    'fsevents', 'sharp', 'node-pty', 'better-sqlite3',
  ],
  jsx: 'automatic',
  sourcemap: 'external',
  minify,
  treeShaking: true,
  define: {
    'MACRO.VERSION': '"1.0.0"',
    'MACRO.PACKAGE_URL': '"@floworkos/brain-engine"',
    'MACRO.ISSUES_EXPLAINER': '"report issues at floworkos.com"',
    'process.env.USER_TYPE': '"external"',
    'process.env.NODE_ENV': minify ? '"production"' : '"development"',
  },
  resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
  logLevel: 'warning',
  metafile: true,
}

async function main() {
  console.log('🧠 Building Flowork Brain Engine...')
  mkdirSync(resolve(ROOT, 'dist'), { recursive: true })

  if (watch) {
    const ctx = await esbuild.context(buildOptions)
    await ctx.watch()
    console.log('👀 Watching...')
  } else {
    const start = Date.now()
    const result = await esbuild.build(buildOptions)
    if (result.errors.length > 0) {
      console.error(`❌ ${result.errors.length} errors`)
      for (const e of result.errors.slice(0, 10)) {
        console.error(`  ${e.location?.file}:${e.location?.line} — ${e.text}`)
      }
      process.exit(1)
    }
    if (result.metafile) {
      for (const [f, i] of Object.entries(result.metafile.outputs)) {
        if (f.endsWith('.js')) console.log(`  📦 ${f}: ${(i.bytes/1024/1024).toFixed(2)} MB`)
      }
      console.log(`  ⏱️  ${Date.now()-start}ms | ⚠️ ${result.warnings.length} warnings`)
      writeFileSync(resolve(ROOT, 'dist/meta.json'), JSON.stringify(result.metafile))
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
