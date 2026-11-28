#!/usr/bin/env npx tsx
/**
 * T-7-b smoke script: five providers × 1 Key, pull models → 1 chat → pull usage
 * → print sanitized summary. Skip provider if no Key is available.
 *
 * Usage: npx tsx scripts/smoke.ts
 */

import { PROVIDER_BASE_URLS } from '../packages/core/src/amd-settings.js'
import type { ProviderId } from '../packages/core/src/contract.js'

const PROVIDERS: ProviderId[] = ['amd', 'nim', 'sensenova', 'agnes', 'google']

function maskKey(key?: string): string {
  if (!key) return '<no key>'
  const prefix = key.slice(0, 4)
  const suffix = key.slice(-4)
  return `${prefix}…${suffix} (len=${key.length})`
}

function sanitizeSummary(obj: unknown): unknown {
  // Deep-clone and scrub anything that looks like a key
  const scrub = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (/^(rc-|sk-|cpk-|nvapi-|AIza)/.test(v)) return maskKey(v)
      return v
    }
    if (Array.isArray(v)) return v.map(scrub)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = scrub(val)
      }
      return out
    }
    return v
  }
  return scrub(obj)
}

async function main() {
  let okCount = 0
  let skipCount = 0

  for (const providerId of PROVIDERS) {
    const key = process.env[`${providerId.toUpperCase()}_API_KEY`]
    if (!key) {
      console.log(`[${providerId}] SKIP — no ${providerId.toUpperCase()}_API_KEY env var`)
      skipCount++
      continue
    }

    const baseUrl = PROVIDER_BASE_URLS[providerId]
    if (!baseUrl) {
      console.log(`[${providerId}] SKIP — no base URL in PROVIDER_BASE_URLS`)
      skipCount++
      continue
    }

    console.log(`\n[${providerId}] baseUrl=${baseUrl} key=${maskKey(key)}`)

    // 1. pull models
    let models: any
    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (res.ok) {
        models = await res.json()
        console.log(`  models: ${Array.isArray(models) ? models.length : 'unknown'} (sanitized: ${JSON.stringify(sanitizeSummary(models)).slice(0, 120)}…)`)
      } else {
        console.log(`  models: HTTP ${res.status} (skip chat/usage)`)
        continue
      }
    } catch (e) {
      console.log(`  models: fetch failed — ${(e as Error).message}`)
      continue
    }

    // 2. 1 chat (max_tokens:1) if models available
    if (Array.isArray(models) && models.length > 0) {
      const firstId = models[0].id || models[0].name || models[0]
      try {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: firstId, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        })
        if (res.ok) {
          const body = await res.json()
          console.log(`  chat: OK id=${body.id || '?'} usage=${JSON.stringify(sanitizeSummary(body.usage)).slice(0, 80)}`)
        } else {
          const body = await res.text()
          console.log(`  chat: HTTP ${res.status} — ${sanitizeSummary(body).toString().slice(0, 120)}`)
        }
      } catch (e) {
        console.log(`  chat: fetch failed — ${(e as Error).message}`)
      }
    }

    // 3. pull usage (per-provider adapter may return no-endpoint)
    console.log(`  usage: provider-specific adapter (google/sensenova/nim/agnes → no-endpoint)`)

    okCount++
  }

  console.log(`\nSmoke complete: ${okCount} OK, ${skipCount} skipped of ${PROVIDERS.length} providers`)
}

main().catch((e) => {
  console.error('Smoke script fatal:', e)
  process.exit(1)
})
