import test from 'node:test'
import assert from 'node:assert/strict'
import { groupConversationTurns } from './conversation.ts'

const user = (id) => ({ id, role: 'user', content: 'hi', createdAt: 0 })
const assistant = (id, content, toolCalls = 0) => ({
  id,
  role: 'assistant',
  content,
  reasoning: '',
  toolCalls: Array.from({ length: toolCalls }, (_, index) => ({ id: `${id}-c${index}`, name: 'read_file', args: {} })),
  round: 0,
  createdAt: 0,
})
const tool = (id) => ({ id, role: 'tool', call: { id: `${id}-call`, name: 'read_file', args: {} }, status: 'done', round: 0, createdAt: 0 })

test('tool rounds with no answer collapse into one Used group', () => {
  const turns = groupConversationTurns([
    user('u1'),
    assistant('a1', '', 1),
    tool('t1'),
    assistant('a2', '', 1),
    tool('t2'),
    assistant('a3', 'done'),
  ])
  assert.equal(turns.length, 1)
  assert.deepEqual(
    turns[0].segments.map((segment) => segment.kind),
    ['tools', 'assistant'],
  )
  assert.deepEqual(
    turns[0].segments[0].tools.map((entry) => entry.id),
    ['t1', 't2'],
  )
  assert.equal(turns[0].segments[1].message.id, 'a3')
})

test('answering closes the Used group and a later tool round opens a new one', () => {
  const turns = groupConversationTurns([
    user('u1'),
    assistant('a1', '', 1),
    tool('t1'),
    assistant('a2', 'first answer'),
    assistant('a3', '', 1),
    tool('t2'),
    assistant('a4', 'second answer'),
  ])
  assert.deepEqual(
    turns[0].segments.map((segment) => segment.kind),
    ['tools', 'assistant', 'tools', 'assistant'],
  )
  assert.deepEqual(turns[0].segments[2].tools.map((entry) => entry.id), ['t2'])
})

test('every user message starts a new turn and an unanswered run keeps its turn', () => {
  const turns = groupConversationTurns([user('u1'), assistant('a1', 'one'), user('u2'), assistant('a2', '', 1), tool('t1')])
  assert.deepEqual(turns.map((turn) => turn.id), ['u1', 'u2'])
  assert.deepEqual(turns[1].segments.map((segment) => segment.kind), ['tools'])
})

test('a truly empty answer is kept so the empty-response notice still renders', () => {
  const turns = groupConversationTurns([user('u1'), assistant('a1', '')])
  assert.deepEqual(turns[0].segments.map((segment) => segment.kind), ['assistant'])
})
