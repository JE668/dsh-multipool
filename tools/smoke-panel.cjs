/*
 * Renders every component the page registers, the way DSH would.
 *
 * Why this exists: the panel came up blank on a real install while node --check
 * and node --test both passed. apply() was fine, the three exported helpers
 * were fine, and the component that actually paints the panel called a function
 * that is not in scope in a browser bundle. Nothing in this repo rendered a component.
 *
 * So: load client.js the way __ModuleLoader__ does, hand it a React that records
 * elements, call apply() with a slots stub, and then render each registered
 * component once. A component that throws here throws in the rail.
 */
const fs = require('fs')
const path = 'packages/client-ui/client.js'
const src = fs.readFileSync(path, 'utf8')

globalThis.window = { __ModuleLoader__: { load(spec) { globalThis.__spec = spec } } }
new Function('window', src)(globalThis.window)

const fakeReact = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => undefined],
  useEffect: () => undefined,
}
const plugin = globalThis.__spec.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error('client.js required "' + name + '", which the page does not serve')
})

const registered = []
const ctx = {
  slots: {
    inject(name, fn) {
      fn()
    },
    register(owner, component) {
      registered.push([owner.name, component])
      return () => undefined
    },
  },
  effect(fn) {
    return fn()
  },
}
plugin.apply(ctx)

let failed = 0
for (const [name, component] of registered) {
  try {
    component({})
    console.log('rendered', name)
  } catch (thrown) {
    failed += 1
    console.log('threw', name, thrown && thrown.message)
  }
}

console.log('components', String(registered.length), 'threw', String(failed))
process.exit(failed === 0 ? 0 : 1)
