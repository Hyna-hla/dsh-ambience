/**
 * dsh-ambience build: host stub (ESM) + single-file web client (CJS in the
 * window.__ModuleLoader__ handshake). The client is plain JSX-less JS; react
 * and @deepseek-ai/dsh-* stay external (the app provides them).
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const pluginId = pkg.name

mkdirSync('lib', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  sourcemap: true,
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*'],
  logLevel: 'info',
})

await build({
  entryPoints: ['src/client/index.jsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*', 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  banner: {
    js: `window.__ModuleLoader__.load({ id: '${pluginId}', factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'info',
})

execFileSync(process.execPath, [join('node_modules', 'typescript', 'lib', 'tsc.js'), '-p', 'tsconfig.json'], { stdio: 'inherit' })
