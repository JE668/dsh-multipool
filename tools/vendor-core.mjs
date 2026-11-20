#!/usr/bin/env node
/**
 * Make a package's tsc output load when it is the only package installed.
 *
 * This repo publishes one DSH bundle, but three packages inside it import each other by bare package
 * name. tsc resolves those names at compile time and writes them out unchanged; it has never rewritten
 * a module specifier, and `paths` does not make it. A bundle installed from git lands alone in one
 * profile, where pnpm strips the `file:` dependencies, so `from '@dsh-multipool/core'` resolves to
 * nothing and the install is dead on arrival.
 *
 * The fix is two moves per package: make its cross-package edges relative, and carry the target
 * under that package's own dist/. Each package keeps its own copy, under a name of its own choosing:
 *
 *   packages/client-ui/dist/                    packages/plugin-dsh/dist/
 *     index.js       -> ./vendor/core/...         index.js       -> ./vendor/core/...
 *     vendor/core/   (core + core's vendor/)      vendor/core/
 *     vendor/client-ui/ (client-ui + its vendor/)
 *
 * Every specifier starts with './', which is what makes this work: a specifier that starts with './'
 * is a path relative to the importing file, and it cannot climb out of the package. A copy is a whole
 * package, so it arrives with its own ./vendor/ and those paths still work inside it. Nesting it one
 * level down would only work if every specifier lost a level -- './vendor/core/index.js' becoming
 * 'vendor/core/index.js' is not a relative path.
 *
 * Within a package the edges are siblings (dist/vendor/core and dist/vendor/client-ui), so the host's
 * copy of client-ui needs client-ui's core edge to read './vendor/core/index.js' too. That is the same
 * specifier client-ui itself writes. One relative path, two depths, both pointing at a core beside them.
 *
 * Order is load-bearing: core, then client-ui, then plugin-dsh.
 * Re-running is safe: each copy prunes itself first, then the rewrite finds no bare specifier left.
 */

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const BARE_CORE = '@dsh-multipool/core'
const BARE_CLIENT = '@dsh-multipool/plugin-client'

/** package dir -> [bare specifier, relative target] pairs, for files this package emitted. */
const REWRITES = {
  core: [],
  'client-ui': [[BARE_CORE, './vendor/core/index.js']],
  'plugin-dsh': [
    [BARE_CORE, './vendor/core/index.js'],
    [BARE_CLIENT, './vendor/client-ui/index.js'],
  ],
}

/** package dir -> source package dirs to copy, in order. */
const VENDORED = {
  core: [],
  'client-ui': ['core'],
  'plugin-dsh': ['core', 'client-ui'],
}

/** Where each copy starts, so the relative specifiers written above still land on it. */
const TO_DIR = {
  'client-ui': { core: 'vendor/core' },
  'plugin-dsh': { core: 'vendor/core', 'client-ui': 'vendor/client-ui' },
}

/**
 * Rewrite a bare specifier only where it is the specifier of an import or export statement. The same
 * text can also appear inside a string -- the channel key is one -- and rewriting a string would
 * break the browser half, so the match is anchored on the `from` keyword.
 */
function rewriteModule(path, rewrites) {
  const source = readFileSync(path, 'utf8')
  let out = source
  for (const [bare, target] of rewrites) {
    const escaped = bare.replace(/[/.]/g, '\\$&')
    const pattern = new RegExp('(\\bfrom\\s*)([\'"])' + escaped + '\\2', 'g')
    out = out.replace(pattern, (_match, head, quote) => head + quote + target + quote)
  }
  if (out !== source) writeFileSync(path, out)
  return out !== source
}

function walkEmitted(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkEmitted(path, visit)
    else if (name.endsWith('.js')) visit(path)
  }
}
/**
 * Copy a package's dist/ beside this one, .js files only.
 *
 * A vendored copy is shipped for exactly one reason: Node has to load it. Types, declaration maps and
 * source maps are not loaded at import time, and the originals are still checked in one directory up,
 * where tsc finds them through the root node_modules link. Copying them would triple the file count in
 * dist/ -- 44 files become 176 -- for files nothing opens at runtime.
 */
function copyRuntime(from, to) {
  rmSync(to, { recursive: true, force: true })
  for (const name of readdirSync(from)) {
    const source = join(from, name)
    if (statSync(source).isDirectory()) copyRuntime(source, join(to, name))
    else if (name.endsWith('.js')) cpSync(source, join(to, name))
  }
}

/**
 * mkdir -p for a single entry, since npm's `files` is a copy list and not a build: a file only ships if
 * its list mentions it by name, so an empty vendor/ directory would arrive at the user as nothing.
 */
function ensureDir(path) {
  if (existsSync(path)) return
  ensureDir(dirname(path))
  mkdirSync(path)
}

function main() {
  const pkg = process.argv[2]
  if (pkg === undefined || !(pkg in REWRITES)) {
    throw new Error('usage: node tools/vendor-core.mjs <' + Object.keys(REWRITES).join('|') + '>')
  }
  const dist = join(repoRoot, 'packages', pkg, 'dist')
  if (!existsSync(dist)) throw new Error(relative(repoRoot, dist) + ' does not exist; run tsc first')

  let touched = 0
  walkEmitted(dist, (file) => {
    if (rewriteModule(file, REWRITES[pkg])) touched += 1
  })

  for (const from of VENDORED[pkg]) {
    const source = join(repoRoot, 'packages', from, 'dist')
    if (!existsSync(source)) throw new Error(relative(repoRoot, source) + ' does not exist; build it first')
    // A copy is a whole package, so it brings its own ./vendor/ along and its specifiers keep pointing
    // at that. Nesting it one level down would only work if every specifier lost a level -- and
    // './vendor/core/index.js' becoming 'vendor/core/index.js' is not a relative path.
    copyRuntime(source, join(dist, TO_DIR[pkg][from]))
  }

  console.log('rewrote ' + touched + ' file(s) under packages/' + pkg + '/dist')
}

main()
