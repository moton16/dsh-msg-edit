// dsh-msg-edit host half (Cordis node-side plugin, loaded via the bundle's
// cordis.patch.yml row `name: '@moton16/dsh-msg-edit'`).
//
// Provides HTTP RPCs backing message edit / rewrite / regenerate in the DSH Web GUI:
//   POST /api/msg-edit/rewrite-message  { sessionId, messageId, text?, reasoning? }
//   POST /api/msg-edit/edit-message     { sessionId, seq, text }
//   POST /api/msg-edit/regenerate       { sessionId, messageId }
//   POST /api/msg-edit/get-message      { sessionId, messageId }
//
// Mechanism: append a surface-replace copy event (surfaceOp {op:'replace',...} +
// sourceEventSeqs) onto the append-only session log, then cancel any running
// turn and followup the user message so the model regenerates.
//
// Runtime requirement: this feature appends surface-replace copy events that the
// bundled token meter (0.1.0-rc.6) cannot replay (`assistant/message at seq N has
// no matching step/start event`, breaking /compact). Until the official
// dsh-token-meter ships replay support for replace copies, apply the small
// community patch documented in README ("Known limitations") on the install side.
export const inject = ['sessions', 'agents', 'webServer']

export function apply(ctx) {
  const sessionsSvc = ctx.get('sessions')
  const agentsSvc = ctx.get('agents')
  const webServer = ctx.get('webServer')
  if (sessionsSvc === undefined || agentsSvc === undefined || webServer === undefined) return

  const deepFreeze = (value) => {
    if (value === null || typeof value !== 'object') return value
    for (const key of Object.keys(value)) deepFreeze(value[key])
    return Object.freeze(value)
  }

  // Resolve {agent, session} for a sessionId; business errors as {ok:false}.
  const resolveSession = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return { ok: false, error: { code: 'bad-request', message: 'missing sessionId' } }
    const session = sessionsSvc.get(sessionId)
    if (session === undefined) return { ok: false, error: { code: 'session-not-found', message: `session "${sessionId}" is not loaded` } }
    const agent = agentsSvc.get(sessionId)
    if (agent === undefined) return { ok: false, error: { code: 'agent-not-found', message: `no agent for session "${sessionId}"` } }
    return { ok: true, agent, session }
  }

  // Map an assistant messageId to its event seq on the session log.
  const seqOfMessageId = (session, messageId) => {
    if (typeof messageId !== 'string' || messageId.length === 0) return undefined
    const found = session.events.find((e) => e.type === 'assistant/message' && e.data?.message?.id === messageId)
    return found === undefined ? undefined : found.seq
  }

  // -- rewrite one assistant message's text / reasoning blocks, keep the tail --
  async function rewriteMessage(args) {
    const { sessionId, messageId, text, reasoning } = args || {}
    if (text === undefined && reasoning === undefined) return { ok: false, error: { code: 'bad-request', message: 'rewrite requires text or reasoning' } }
    const resolved = resolveSession(sessionId)
    if (!resolved.ok) return resolved
    const { session, agent } = resolved
    const seq = typeof args.seq === 'number' ? args.seq : seqOfMessageId(session, messageId)
    if (seq === undefined) return { ok: false, error: { code: 'target-not-found', message: `no assistant/message for messageId "${messageId}"` } }
    const target = session.events.find((e) => e.type === 'assistant/message' && e.seq === seq)
    if (target === undefined) return { ok: false, error: { code: 'target-not-found', message: `session "${sessionId}" has no assistant/message at seq ${seq}` } }
    const message = target.data.message
    if (!Array.isArray(message?.content) || message.content.some((block) => block?.type === 'tool-call')) {
      return { ok: false, error: { code: 'rewrite-unsupported', message: 'only text-only assistant messages can be rewritten' } }
    }
    const content = message.content.map((block) => {
      if (block.type === 'text' && text !== undefined) return { ...block, text }
      if (block.type === 'reasoning' && reasoning !== undefined) return { ...block, text: reasoning }
      return block
    })
    if (text !== undefined && !content.some((block) => block.type === 'text')) content.push({ type: 'text', text })
    if (reasoning !== undefined && !content.some((block) => block.type === 'reasoning')) content.push({ type: 'reasoning', text: reasoning })
    try {
      const appended = session.append('assistant/message', {
        ...target.data,
        message: deepFreeze({ ...message, content }),
      }, {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
      return { ok: true, accepted: true, seq: appended.seq }
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: `failed to rewrite message at seq ${seq}: ${error instanceof Error ? error.message : String(error)}` } }
    }
  }

  // -- edit a user message in place and truncate everything after it, then regenerate --
  async function editMessage(args) {
    const { sessionId, seq, text } = args || {}
    if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, error: { code: 'bad-request', message: 'edit requires non-blank text' } }
    const resolved = resolveSession(sessionId)
    if (!resolved.ok) return resolved
    const { session, agent } = resolved
    const target = session.events.find((e) => e.type === 'user/message' && e.seq === seq)
    if (target === undefined) return { ok: false, error: { code: 'target-not-found', message: `session "${sessionId}" has no user/message at seq ${seq}` } }
    const message = target.data
    if (!Array.isArray(message?.content) || message.content.some((block) => block?.type === 'image')) {
      return { ok: false, error: { code: 'edit-unsupported', message: 'only text-only user messages can be edited' } }
    }
    if (!session.surface.nodes.includes(seq)) return { ok: false, error: { code: 'target-not-found', message: `session "${sessionId}" has no surface node at seq ${seq}` } }
    const shadowed = session.surface.nodes.filter((node) => node >= seq)
    if (shadowed.length === 0) return { ok: false, error: { code: 'target-not-found', message: `session "${sessionId}" has no surface node at or after seq ${seq}` } }
    const edited = deepFreeze({ ...message, content: [{ type: 'text', text }] })
    try {
      if (agent.status !== 'idle') agent.cancel({ kind: 'user' }, { keepInbox: true })
      const appended = session.append('user/message', edited, {
        surfaceOp: { op: 'replace', start: seq, end: shadowed[shadowed.length - 1] },
        sourceEventSeqs: shadowed,
      })
      agent.followup(edited)
      return { ok: true, accepted: true, seq: appended.seq }
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: `failed to edit message at seq ${seq}: ${error instanceof Error ? error.message : String(error)}` } }
    }
  }

  // -- regenerate the reply belonging to the user prompt that owns a message --
  async function regenerate(args) {
    const { sessionId, messageId } = args || {}
    const resolved = resolveSession(sessionId)
    if (!resolved.ok) return resolved
    const { session, agent } = resolved
    let seq = typeof args.seq === 'number' ? args.seq : seqOfMessageId(session, messageId)
    if (seq === undefined) return { ok: false, error: { code: 'target-not-found', message: `no assistant/message for messageId "${messageId}"` } }
    const nodes = session.surface.nodes
    let targetIndex = nodes.indexOf(seq)
    if (targetIndex === -1) {
      // messageId may belong to a shadowed (replaced) message; fall back to the
      // newest surface assistant/message.
      let fallback = -1
      for (let i = nodes.length - 1; i >= 0; i--) {
        const e = session.events.find((c) => c.seq === nodes[i])
        if (e?.type === 'assistant/message') { fallback = i; break }
      }
      if (fallback === -1) return { ok: false, error: { code: 'target-not-found', message: `session "${sessionId}" has no assistant surface node for messageId "${messageId}"` } }
      seq = nodes[fallback]
      targetIndex = fallback
    }
    // Walk back from the requested node to the latest real user prompt it belongs
    // to. Context-injection cards (AGENTS.md, system prompt, skill catalog, ...)
    // are also user/message surface nodes, so skip any source that is not the
    // user's own message — otherwise regenerate would truncate from a context
    // card and resubmit injected content, and the turn would be deduped into a
    // silent no-op.
    const userPromptAt = (index) => {
      const event = session.events.find((candidate) => candidate.seq === nodes[index])
      return event !== undefined && event.type === 'user/message' && event.data?.source?.kind === 'user' ? event : undefined
    }
    let anchorIndex = targetIndex
    let anchor = userPromptAt(anchorIndex)
    while (anchor === undefined && anchorIndex > 0) {
      anchorIndex -= 1
      anchor = userPromptAt(anchorIndex)
    }
    if (anchor === undefined) return { ok: false, error: { code: 'target-not-found', message: `session "${sessionId}" has no user/message at or before seq ${seq}` } }
    const anchorSeq = nodes[anchorIndex]
    const after = nodes.slice(anchorIndex + 1)
    if (after.length === 0) return { ok: false, error: { code: 'regenerate-tail', message: 'the message is already the last surface node' } }
    const shadowed = [anchorSeq, ...after]
    const lastSeq = after[after.length - 1]
    const message = anchor.data
    if (!Array.isArray(message?.content) || message.content.some((block) => block?.type === 'image')) {
      return { ok: false, error: { code: 'edit-unsupported', message: 'only text-only user messages can be regenerated' } }
    }
    try {
      if (agent.status !== 'idle') agent.cancel({ kind: 'user' }, { keepInbox: true })
      const appended = session.append('user/message', message, {
        surfaceOp: { op: 'replace', start: anchorSeq, end: lastSeq },
        sourceEventSeqs: shadowed,
      })
      agent.followup(message)
      return { ok: true, accepted: true, seq: appended.seq }
    } catch (error) {
      return { ok: false, error: { code: 'internal', message: `failed to regenerate at seq ${seq}: ${error instanceof Error ? error.message : String(error)}` } }
    }
  }

  // -- read one assistant message's current text/reasoning blocks (edit prefill) --
  async function getMessage(args) {
    const { sessionId, messageId } = args || {}
    const resolved = resolveSession(sessionId)
    if (!resolved.ok) return resolved
    const { session } = resolved
    const seq = typeof args.seq === 'number' ? args.seq : seqOfMessageId(session, messageId)
    if (seq === undefined) return { ok: false, error: { code: 'target-not-found', message: `no assistant/message for messageId "${messageId}"` } }
    const target = session.events.find((e) => e.type === 'assistant/message' && e.seq === seq)
    if (target === undefined) return { ok: false, error: { code: 'target-not-found', message: `no assistant/message at seq ${seq}` } }
    const content = target.data.message?.content ?? []
    let text = '', reasoning = ''
    for (const block of content) {
      if (block?.type === 'text') text = block.text
      else if (block?.type === 'reasoning') reasoning = block.text
    }
    return { ok: true, seq, text, reasoning }
  }

  const handlers = { 'rewrite-message': rewriteMessage, 'edit-message': editMessage, regenerate, 'get-message': getMessage }
  const readBody = async (req) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!raw) return {}
    try { return JSON.parse(raw) } catch { return {} }
  }
  for (const [name, fn] of Object.entries(handlers)) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/msg-edit/' + name,
      handler: async (req, res) => {
        try {
          const args = await readBody(req)
          const result = await fn(args)
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(result))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, code: 'HANDLER_ERR', message: String((e && e.message) || e) }))
        }
      },
    }))
  }
}
