#!/usr/bin/env node
// base64 roundtrip guard: prove a file survived the write channel codepoint-exact.
//
// The write channel (both the plain file writer and the bash heredoc path) has been
// observed to swap characters for unrelated CJK words and to drop single characters
// inside long ASCII strings. Diagnostics travel through base64 for that reason, and
// every payload is checked for a byte exact roundtrip before it is trusted.
//
// This script does not pick a transport. It only proves one is faithful.
// It is tracked in git so the check cannot quietly disappear.
//
// Usage:
//   node tools/roundtrip.mjs check <file> <b64>     exit 0 = identical, 1 = mismatch
//   node tools/roundtrip.mjs encode <file>         print JSON {path,base64,bytes,sha256}
//   node tools/roundtrip.mjs decode <b64>          print decoded text on stdout
//
// Exit codes: 0 ok, 1 mismatch or bad base64, 2 usage error.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function isBase64(s) {
  return typeof s === 'string' && s.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)
}

const argv = process.argv.slice(2)
const cmd = argv[0]

if (cmd === 'check') {
  if (argv.length !== 3) {
    console.log('0')
    process.exit(2)
  }
  const file = argv[1]
  const b64 = argv[2]
  let ok = false
  if (isBase64(b64)) {
    try {
      const want = Buffer.from(b64, 'base64')
      const got = Buffer.from(readFileSync(file))
      ok = want.equals(got)
    } catch {
      ok = false
    }
  }
  console.log(ok ? '1' : '0')
  process.exit(ok ? 0 : 1)
}

if (cmd === 'encode') {
  if (argv.length !== 2) {
    console.log('usage: encode <file>')
    process.exit(2)
  }
  const buf = Buffer.from(readFileSync(argv[1]))
  process.stdout.write(JSON.stringify({
    path: argv[1],
    base64: buf.toString('base64'),
    bytes: buf.length,
    sha256: sha256(buf)
  }))
  process.exit(0)
}

if (cmd === 'decode') {
  if (argv.length !== 2 || !isBase64(argv[1])) {
    console.log('usage: decode <base64>')
    process.exit(2)
  }
  process.stdout.write(Buffer.from(argv[1], 'base64').toString('utf8'))
  process.exit(0)
}

console.log('usage: roundtrip.mjs check <file> <b64> | encode <file> | decode <b64>')
process.exit(2)
