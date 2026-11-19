/**
 * The AMD settings group's validation, as a library (06 T-2-d, fixtures C-01..C-03).
 *
 * docs/03 section 5 says these checks live in the provider Config schema: saving is the
 * gate, and a rejected value makes the form's set() return false. This module is that
 * gate's body, kept out of the DSH plugin wrapper for one reason -- the fixtures can run
 * it without a live profile, and the wrapper becomes a few lines that cannot get the
 * numbers wrong on their own.
 *
 * Three rules, each with its source:
 *
 *   C-01 concurrency and rpm above what AMD publishes are refused, at save time argued
 *        with the sentence that refuses them (docs/02 sections 1.1 and 1.4).
 *   C-02 a key that is not an rc- key is refused, not warned about: docs/02 section 1.2
 *        says a rejected key must not enter the catalogue or the scheduler. The
 *        instance service in section 1.9 is refused the same way, as a host rule.
 *   C-03 baseUrl is read-only. There is no code path that saves a different one, which
 *        is why this file has no setter to override rather than a setter that throws.
 */

import type { ProviderId } from './contract.js'

/** Every provider's base URL as docs/02 publishes it. C-03: display only, never editable. */
export const PROVIDER_BASE_URLS: Readonly<Partial<Record<ProviderId, string>>> = {
  amd: 'https://developer.amd.com.cn/radeon/api/v1',
  sensenova: 'https://token.sensenova.cn/v1',
  nim: 'https://integrate.api.nvidia.com/v1',
  agnes: 'https://apihub.agnes-ai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
}

/**
 * Where a setting's bound came from. C-01 requires the refusal to carry this, not just
 * the number: a bare "max 8" invites the user to assume it is our opinion.
 */
export interface Citation {
  readonly doc: string
  readonly quote: string
  readonly retrievedOn: string
}

export interface Bound {
  readonly value: number
  readonly source: 'doc'
  readonly citation: Citation
}

/**
 * AMD's published bounds. The citation text is copied from docs/02 sections 1.1 and 1.4
 * on 2026-10-19; a doc edit that changes the numbers must change this table too, which is
 * why the two numbers a user may raise live here and not in a schema default.
 */
export const AMD_BOUNDS = {
  concurrencyPerKey: {
    value: 8,
    source: 'doc',
    citation: {
      doc: 'docs/02-CONSTRAINTS.md section 1.1',
      quote:
        'platform admission checks every API key separately: 30 requests per minute, 8 concurrent requests',
      retrievedOn: '2026-10-19',
    },
  },
  rpmPerKey: {
    value: 30,
    source: 'doc',
    citation: {
      doc: 'docs/02-CONSTRAINTS.md section 1.1',
      quote: 'each API key has 30 requests per minute of platform admission',
      retrievedOn: '2026-10-19',
    },
  },
  rpmAccount: {
    value: 20,
    source: 'doc',
    citation: {
      doc: 'docs/02-CONSTRAINTS.md section 1.4',
      quote: 'the gateway bills its account 20 requests per minute over a 60 second sliding window',
      retrievedOn: '2026-10-19',
    },
  },
} as const satisfies Record<string, Bound>

export interface Rejection {
  readonly field: string
  /** Which fixture this refusal answers to: C-01, C-02 or C-03. */
  readonly rule: 'C-01' | 'C-02' | 'C-03'
  /** The bound that was broken, so a form can render the number without re-reading the doc. */
  readonly bound?: Bound
  readonly reason: string
  /** One sentence the form shows verbatim, with the citation attached by the renderer. */
  readonly message: string
  readonly citation?: Citation
}

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly rejection: Rejection }

export interface BudgetDraft {
  /** Requests the plugin lets itself send at once. Hard cap is AMD's published number. */
  readonly concurrency?: number
  /** Per-account requests per minute the plugin admits. */
  readonly rpm?: number
}

function reject(
  field: string,
  rule: Rejection['rule'],
  reason: string,
  message: string,
  bound?: Bound,
): Validation<never> {
  return { ok: false, rejection: { field, rule, reason, message, ...(bound === undefined ? {} : { bound, citation: bound.citation }) } }
}

/**
 * Concurrency may be lowered by any amount but never raised past the platform's number.
 * Six is the shipped admit value and is allowed; nine is what C-01 reports on.
 */
export function validateConcurrency(value: number | undefined, bound: Bound = AMD_BOUNDS.concurrencyPerKey): Validation<number> {
  if (value === undefined) return { ok: true, value: bound.value }
  if (!Number.isInteger(value) || value < 1) return reject('concurrency', 'C-01', 'not a positive integer', 'concurrency must be a whole number from 1 to ' + String(bound.value))
  if (value > bound.value) {
    return reject(
      'concurrency',
      'C-01',
      'above the platform limit',
      'concurrency ' + String(value) + ' is above the platform limit of ' + String(bound.value) + ' per API key',
      bound,
    )
  }
  return { ok: true, value }
}

/** Same shape for RPM; C-01 reports 21 against AMD's 20 per account. */
export function validateRpm(value: number | undefined, bound: Bound = AMD_BOUNDS.rpmAccount): Validation<number> {
  if (value === undefined) return { ok: true, value: bound.value }
  if (!Number.isInteger(value) || value < 1) return reject('rpm', 'C-01', 'not a positive integer', 'rpm must be a whole number from 1 to ' + String(bound.value))
  if (value > bound.value) {
    return reject(
      'rpm',
      'C-01',
      'above the account limit',
      'rpm ' + String(value) + ' is above the account limit of ' + String(bound.value) + ' per minute',
      bound,
    )
  }
  return { ok: true, value }
}

/**
 * Anything that names a key outside AMD's grammar. docs/02 section 1.2 says the check
 * against this list must reject the whole provider, not merely warn, so this returns a
 * rejection rather than ok:true with a flag.
 */
export const AMD_REJECTED_KEY_PREFIX = ['sk-'] as const
export const AMD_REJECTED_HOST_FRAGMENT = ['jupyter.anruicloud.com'] as const

/**
 * C-02. The instance-service mistake is the one worth spelling out, because a key and a
 * URL from section 1.9 both look plausible and both mean "billing by the hour".
 * Returns the rejection including the sentence the form shows.
 */
export function validateAmdKey(raw: string): Validation<string> {
  const key = raw.trim()
  if (key.length === 0) {
    return reject('key', 'C-02', 'empty', 'a key is required; Token Factory issues keys beginning with rc-')
  }
  for (const prefix of AMD_REJECTED_KEY_PREFIX) {
    if (key.startsWith(prefix)) {
      return reject(
        'key',
        'C-02',
        'instance service key prefix ' + prefix,
        'this looks like an ' + prefix + ' key from the GPU instance inference service, not a Token Factory rc- key (docs/02 section 1.9)',
      )
    }
  }
  for (const host of AMD_REJECTED_HOST_FRAGMENT) {
    if (key.includes(host)) {
      return reject(
        'key',
        'C-02',
        'instance service host',
        'this is the GPU instance inference service address, not Token Factory (docs/02 section 1.9)',
      )
    }
  }
  if (!key.startsWith('rc-')) {
    return reject(
      'key',
      'C-02',
      'not an rc- key',
      'this looks like it belongs to another provider: Token Factory keys begin with rc- (docs/02 section 1.2)',
    )
  }
  if (key.length <= 3) {
    return reject('key', 'C-02', 'empty after prefix', 'the key carries no characters after its rc- prefix')
  }
  return { ok: true, value: key }
}

/**
 * C-03. A base URL may only ever be the published one for its provider. Providers with
 * no published URL -- none in the current set -- take no custom address either: the
 * absence of a documented address is not permission to guess one (docs/00 rule 1).
 */
export function baseUrlIsReadOnly(providerId: ProviderId, supplied: string | undefined): Validation<string> {
  const published = PROVIDER_BASE_URLS[providerId]
  const given = supplied === undefined ? published : supplied.trim()
  if (published === undefined || given !== published) {
    return reject(
      'baseUrl',
      'C-03',
      'not the published address',
      'the base URL for this provider is fixed; trusting another endpoint would count requests against no quota we have read.',
    )
  }
  return { ok: true, value: published }
}
