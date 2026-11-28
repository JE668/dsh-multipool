#!/usr/bin/env node

/**
 * This script rewrites the dsh-multipool commit hash in a profile's package.json
 * and lockfile to a new commit. Use when pnpm update doesn't pick up the new commit
 * because the lockfile satisfies supply-chain policies.
 *
 * Usage: node tools/rewrite-profile-commit.js <profile-dir> <new-commit-hash>
 * Example: node tools/rewrite-profile-commit.js ~/.dsh/profiles/desktop 35913c00c1a1392354a561b30ad870f0fbcd75e1
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'

const [,, profileDir, newCommit] = process.argv

if (!profileDir || !newCommit) {
  console.error('Usage: node tools/rewrite-profile-commit.js <profile-dir> <new-commit-hash>')
  process.exit(1)
}

const pkgPath = resolve(profileDir, 'package.json')
const lockPath = resolve(profileDir, 'pnpm-lock.yaml')

if (!existsSync(pkgPath)) {
  console.error(`package.json not found at ${pkgPath}`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const oldRef = pkg.dependencies?.['dsh-multipool'] ?? pkg.devDependencies?.['dsh-multipool']

if (!oldRef || !oldRef.includes('github:JE668/dsh-multipool#')) {
  console.error('dsh-multipool dependency not found or not a github reference')
  process.exit(1)
}

const newRef = oldRef.replace(/github:JE668\/dsh-multipool#[a-f0-9]+/, `github:JE668/dsh-multipool#${newCommit}`)
pkg.dependencies['dsh-multipool'] = newRef

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`Updated package.json: ${oldRef} -> ${newRef}`)

if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, 'utf-8')
  const oldHash = oldRef.match(/github:JE668\/dsh-multipool#([a-f0-9]+)/)?.[1]
  if (oldHash) {
    const newLock = lock.replace(new RegExp(oldHash, 'g'), newCommit)
    writeFileSync(lockPath, newLock)
    console.log(`Updated pnpm-lock.yaml: ${oldHash} -> ${newCommit}`)
  }
}

console.log('Done. Run pnpm install in the profile directory to apply.')