import { test } from 'node:test'
import assert from 'node:assert/strict'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
}

await import('../client.js')

const core = await import('../dist/index.js')
const fakeReact = {
  createElement: (type, props, kids) => ({ type, props, kids }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
}

function factory() {
  return captured.factory((name) => {
    if (name === 'react') return fakeReact
    return core
  })
}

test('loads one lazy factory named after the package', () => {
  assert.equal(captured.id, '@dsh-multipool/plugin-client')
})

test('registers the icon under sidebar.panellist through an effect', () => {
  const plugin = factory()
  const calls = []
  const ctx = {
    slots: {
      inject(name, fn) {
        calls.push(['inject', name])
        fn()
      },
      register(owner) {
        calls.push(['register', owner.name, owner.id])
        return () => {}
      },
    },
    effect(fn) {
      calls.push(['effect'])
      return fn()
    },
  }
  plugin.apply(ctx)
  assert.deepEqual(calls[0], ['inject', 'sidebar.panellist'])
  assert.deepEqual(calls[1], ['effect'])
  assert.deepEqual(calls[2], ['register', 'sidebar.panellist', 'dsh-multipool'])
  assert.deepEqual(plugin.inject, ['slots'])
})

test('paints grey with three dashes when no host channel exists', () => {
  delete globalThis.window['@dsh-multipool/plugin-client/view']
  const plugin = factory()
  let component = null
  const ctx = {
    slots: {
      inject(name, fn) { fn() },
      register(owner, comp) { component = comp },
    },
    effect(fn) { fn() },
  }
  plugin.apply(ctx)
  const tree = component({ size: 34, active: false })
  const lines = tree.props.title.split('\n')
  assert.equal(lines.length, 3)
  assert.ok(lines[0].includes('0/0'))
  assert.equal(tree.props['data-multipool-level'], 'grey')
})
