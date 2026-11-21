/**
 * NEON//STACK — host half of the neon-tasks bundle.
 *
 * The Client module owns the widget; this half persists the task state. It
 * opens a `neon-tasks` storage domain (JSON backend mounted by dsh-base) and
 * exposes one exact HTTP route the browser widget reads and writes:
 *
 *   GET /api/neon-tasks/state  -> { updatedAt, tasks }
 *   PUT /api/neon-tasks/state  <- { updatedAt, tasks }   (validated, durable)
 *
 * The route is loopback-guarded: only requests whose Host and (when present)
 * Origin name a loopback authority are served. The desktop web GUI runs on
 * 127.0.0.1, so the widget's same-origin fetches pass; a page on any other
 * origin is rejected, which closes the CSRF-style hole an unauthenticated
 * localhost route would otherwise leave.
 *
 * This module deliberately imports nothing from the shipped storage packages:
 * the domain facility only needs the spec shape and a `valueSchema` whose
 * `parse` returns the value or throws, so the schema is validated by hand and
 * the plugin stays resolvable from the profile alone.
 */
export const inject = ['webServer', 'storageDomain']

const MAX_TASKS = 500
const MAX_BODY_BYTES = 256 * 1024

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseTask(value) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'task must be an object')
  assert(typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 64, 'task.id invalid')
  assert(typeof value.text === 'string' && value.text.length > 0 && value.text.length <= 400, 'task.text invalid')
  assert(typeof value.done === 'boolean', 'task.done invalid')
  assert([0, 1, 2, 3].includes(value.priority), 'task.priority invalid')
  assert(typeof value.createdAt === 'number' && Number.isFinite(value.createdAt), 'task.createdAt invalid')
  assert(value.completedAt === null || (typeof value.completedAt === 'number' && Number.isFinite(value.completedAt)), 'task.completedAt invalid')
  assert(value.due === undefined || value.due === null || (typeof value.due === 'number' && Number.isFinite(value.due)), 'task.due invalid')
  assert(value.killed === undefined || typeof value.killed === 'boolean', 'task.killed invalid')
  return {
    id: value.id,
    text: value.text,
    done: value.done,
    priority: value.priority,
    createdAt: value.createdAt,
    completedAt: value.completedAt,
    due: value.due ?? null,
    // First-kill marker: re-opening and re-completing a task must not farm xp.
    killed: value.killed ?? false,
  }
}

// Player progress is a decorated cache of completed work; every field is
// optional on read so a v1 record without it opens as a fresh level 1.
function parsePlayer(value) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'player must be an object')
  const num = (v) => typeof v === 'number' && Number.isFinite(v)
  assert(num(value.xp) && value.xp >= 0, 'player.xp invalid')
  assert(num(value.level) && value.level >= 1, 'player.level invalid')
  assert(num(value.combo) && value.combo >= 0, 'player.combo invalid')
  assert(num(value.comboAt) && value.comboAt >= 0, 'player.comboAt invalid')
  assert(num(value.best) && value.best >= 0, 'player.best invalid')
  assert(num(value.totalDone) && value.totalDone >= 0, 'player.totalDone invalid')
  return {
    xp: value.xp,
    level: value.level,
    combo: value.combo,
    comboAt: value.comboAt,
    best: value.best,
    totalDone: value.totalDone,
  }
}

// The record schema the domain facility validates every stored record with.
const stateValueSchema = {
  parse(value) {
    assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'state must be an object')
    assert(typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt), 'state.updatedAt invalid')
    assert(Array.isArray(value.tasks), 'state.tasks must be an array')
    assert(value.tasks.length <= MAX_TASKS, 'state.tasks too long')
    assert(value.player === undefined || value.player === null || typeof value.player === 'object', 'state.player invalid')
    const player = value.player ? parsePlayer(value.player) : { xp: 0, level: 1, combo: 0, comboAt: 0, best: 0, totalDone: 0 }
    return { updatedAt: value.updatedAt, tasks: value.tasks.map(parseTask), player: player }
  },
}

const domainSpec = {
  name: 'neon_tasks',
  version: 2,
  compatibleVersions: [1],
  tables: {
    // One record ('main') holds the whole list; a single durable write per
    // change keeps the browser half free of cross-record merge logic.
    lists: { valueSchema: stateValueSchema },
  },
}

// Host / Origin authorities a local widget may use. Node lowercases incoming
// header values already; the regex accepts the plain and bracketed spellings.
const LOOPBACK_AUTHORITY = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/

function isLoopbackAuthority(value) {
  try {
    return LOOPBACK_AUTHORITY.test(String(value).toLowerCase())
  } catch {
    return false
  }
}

export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(domainSpec)
  const table = domain.table('lists')

  const route = ctx.webServer.register({
    kind: 'exact',
    path: '/api/neon-tasks/state',
    handler: async (req, res) => {
      if (!isLoopbackAuthority(req.headers.host)) {
        res.writeHead(403)
        res.end()
        return
      }
      const origin = req.headers.origin
      if (origin !== undefined) {
        let originHost
        try {
          originHost = new URL(origin).host
        } catch {
          originHost = ''
        }
        if (!isLoopbackAuthority(originHost)) {
          res.writeHead(403)
          res.end()
          return
        }
      }
      // Belt and suspenders on top of the Origin check: refuse cross-site
      // navigations outright even when they send no Origin.
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403)
        res.end()
        return
      }

      if (req.method === 'GET') {
        const record = table.get('main') ?? { updatedAt: 0, tasks: [] }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(record))
        return
      }

      if (req.method === 'PUT') {
        // Accumulate Buffers and decode once: a multi-byte UTF-8 character
        // split across chunks is mangled by per-chunk string coercion.
        const chunks = []
        let bytes = 0
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > MAX_BODY_BYTES) {
            res.writeHead(413)
            res.end()
            return
          }
          chunks.push(chunk)
        }
        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'invalid-json' }))
          return
        }
        let parsed
        try {
          parsed = stateValueSchema.parse(body)
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'invalid-state' }))
          return
        }
        await table.put('main', parsed)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }

      res.writeHead(405, { allow: 'GET, PUT' })
      res.end()
    },
  })

  return async () => {
    route()
    await domain.close()
  }
}
