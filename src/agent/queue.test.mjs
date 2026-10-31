import test from 'node:test'
import assert from 'node:assert/strict'
import { createTurnQueue, historyUpTo, lastUserMessageId, turnHistory } from './queue.ts'

const u = (id) => ({ id, role: 'user', content: 'hi', createdAt: 0 })
const a = (id) => ({ id, role: 'assistant', content: '', reasoning: '', toolCalls: [], round: 0, createdAt: 0 })
const t = (id) => ({ id, role: 'tool', call: { id: `${id}-c`, name: 'read_file', args: {} }, status: 'done', round: 0, createdAt: 0 })

test('an answer cannot see a later user prompt', () => {
  const messages = [u('u1'), u('u2')]
  assert.deepEqual(historyUpTo(messages, 'u1')?.map((m) => m.id), ['u1'])
  assert.equal(historyUpTo(messages, 'gone'), null)
  assert.equal(lastUserMessageId(messages), 'u2')
})

test('turn history stops at the next user message but keeps later rounds', () => {
  const messages = [u('u1'), a('a1'), t('t1'), a('a2'), u('u2')]
  assert.deepEqual(turnHistory(messages, 'u1')?.map((m) => m.id), ['u1', 'a1', 't1', 'a2'])
  assert.deepEqual(turnHistory(messages, 'u2')?.map((m) => m.id), ['u1', 'a1', 't1', 'a2', 'u2'])
  assert.equal(turnHistory(messages, 'gone'), null)
})

test('queued turns run in submission order, never concurrently', async () => {
  const events = []
  let active = 0
  let peak = 0
  const queue = createTurnQueue(async (_sessionId, id) => {
    active += 1
    peak = Math.max(peak, active)
    events.push(`start:${id}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
    events.push(`end:${id}`)
    active -= 1
  })

  const first = queue.push('s', 'u1')
  const second = queue.push('s', 'u2')
  assert.equal(queue.isBusy('s'), true)
  await Promise.all([first, second])

  assert.deepEqual(events, ['start:u1', 'end:u1', 'start:u2', 'end:u2'])
  assert.equal(peak, 1)
  assert.equal(queue.isIdle(), true)
  assert.equal(queue.isBusy('s'), false)
})

test('separate sessions run independently and a failed turn still drains the queue', async () => {
  const done = []
  const queue = createTurnQueue(async (sessionId, id) => {
    if (id === 'bad') throw new Error('provider failed')
    done.push(`${sessionId}:${id}`)
  })

  await Promise.all([queue.push('a', 'bad'), queue.push('a', 'ok'), queue.push('b', 'ok')])
  assert.deepEqual(done.sort(), ['a:ok', 'b:ok'])
  assert.equal(queue.isIdle(), true)
})

test('stop settles the turn so the next queued prompt still runs', async () => {
  const ran = []
  const queue = createTurnQueue(async (_sessionId, id) => {
    if (id === 'stop') return
    ran.push(id)
  })
  await queue.push('s', 'stop')
  await queue.push('s', 'after')
  assert.deepEqual(ran, ['after'])
})

test('clear drops waiting turns but not the running one', async () => {
  const ran = []
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const queue = createTurnQueue(async (_sessionId, id) => {
    ran.push(id)
    if (id === 'first') await gate
  })

  const running = queue.push('s', 'first')
  await new Promise((resolve) => setTimeout(resolve, 0))
  const waiting = queue.push('s', 'second')
  queue.clear('s')
  release()
  await Promise.all([running, waiting])

  assert.deepEqual(ran, ['first'])
  assert.equal(queue.isIdle(), true)
})
