/**
 * LLM Concurrency Limiter - Host Service & Management API
 * 
 * Intercepts LLM calls at the `llm/stream` waterfall boundary to enforce
 * concurrency limits per AI service provider, per model, and per session.
 */
export const inject = ['llm', 'webServer']

export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是对象')
  const allowed = ['globalConcurrency','defaultProviderConcurrency','providers','models','maxQueueSize','queueTimeoutMs','verbose']
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`未知配置字段: ${key}`)
  const result = { ...value }
  for (const key of ['defaultProviderConcurrency','maxQueueSize','queueTimeoutMs','globalConcurrency']) {
    const n = result[key]
    if (key === 'globalConcurrency' && (n == null || n === 0)) { result[key] = null; continue }
    if (n === undefined) continue
    const min = key === 'maxQueueSize' || key === 'queueTimeoutMs' ? 0 : 1
    if (!Number.isSafeInteger(n) || n < min || n > 2147483647) throw new Error(`${key} 必须为有效整数`)
  }
  for (const key of ['providers','models']) {
    const rules = result[key]
    if (rules === undefined) continue
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new Error(`${key} 必须是规则对象`)
    result[key] = Object.fromEntries(Object.entries(rules).map(([id, limit]) => {
      if (!id.trim() || ['__proto__','constructor','prototype'].includes(id) || !Number.isSafeInteger(limit) || limit < 1) throw new Error(`无效规则: ${id}`)
      return [id, limit]
    }))
  }
  if (result.verbose !== undefined && typeof result.verbose !== 'boolean') throw new Error('verbose 必须为布尔值')
  return result
}

class ConcurrencyLlmError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'LlmError'
    this.code = code
  }
}

const ROUTE_GET_CONFIG = '/api/llm-concurrency/config'
const ROUTE_UPDATE_CONFIG = '/api/llm-concurrency/config/update'
const ROUTE_SESSION_OVERRIDE = '/api/llm-concurrency/session-override'

/**
 * Common / mainstream LLM providers directory
 */
const MAINSTREAM_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek (官方)' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'google', name: 'Google (Gemini)' },
  { id: 'azure', name: 'Azure OpenAI' },
  { id: 'groq', name: 'Groq' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'mistral', name: 'Mistral AI' },
  { id: 'together', name: 'Together AI' },
  { id: 'fireworks', name: 'Fireworks AI' },
  { id: 'cerebras', name: 'Cerebras' },
  { id: 'moonshotai', name: 'Moonshot AI (月之暗面)' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'qwen-token-plan', name: '通义千问 (Qwen)' },
  { id: 'xai', name: 'xAI (Grok)' },
  { id: 'ollama', name: 'Ollama (本地)' }
]

/**
 * Asynchronous Semaphore with FIFO queue, timeout, and cancellation (AbortSignal) support.
 */
export class AsyncSemaphore {
  constructor(name, limit, options = {}) {
    this.name = name
    this.limit = limit
    this.maxQueueSize = options.maxQueueSize ?? 100
    this.queueTimeoutMs = options.queueTimeoutMs ?? 300000
    this.logger = options.logger
    this.verbose = options.verbose ?? true

    this.active = 0
    this.queue = []
    this.totalAcquired = 0
    this.totalQueued = 0
  }

  updateLimit(newLimit) {
    if (typeof newLimit === 'number' && newLimit > 0 && newLimit !== this.limit) {
      this.limit = newLimit
      this._drain()
    }
  }

  get queueLength() {
    return this.queue.length
  }

  acquire(signal) {
    if (this.disposed) return Promise.reject(new ConcurrencyLlmError('插件已卸载', 'LIMITER_DISPOSED'))
    if (signal?.aborted) {
      return Promise.reject(signal.reason || new Error(`Aborted while acquiring concurrency slot for ${this.name}`))
    }

    if (this.active < this.limit) {
      this.active++
      this.totalAcquired++
      return Promise.resolve()
    }

    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(
        new ConcurrencyLlmError(
          `Concurrency queue capacity reached for ${this.name} (${this.queue.length}/${this.maxQueueSize}). Request rejected.`,
          'QUEUE_FULL'
        )
      )
    }

    return new Promise((resolve, reject) => {
      const queuedAt = Date.now()
      this.totalQueued++

      const item = {
        resolve,
        reject,
        signal,
        queuedAt,
        timeoutTimer: null,
        abortListener: null
      }

      if (this.verbose && this.logger) {
        this.logger.info(
          `[concurrency-limiter] ${this.name} active slots (${this.active}/${this.limit}) full. Request queued (pos: ${this.queue.length + 1}).`
        )
      }

      if (signal) {
        item.abortListener = () => {
          this._remove(item)
          this._cleanup(item)
          reject(signal.reason || new Error(`Aborted in queue for ${this.name}`))
        }
        signal.addEventListener('abort', item.abortListener, { once: true })
      }

      if (this.queueTimeoutMs > 0) {
        item.timeoutTimer = setTimeout(() => {
          this._remove(item)
          this._cleanup(item)
          reject(new ConcurrencyLlmError(`Concurrency queue wait timeout for ${this.name}`, 'TIMEOUT'))
        }, this.queueTimeoutMs)
      }

      this.queue.push(item)
    })
  }

  release() {
    if (this.active <= 0) throw new Error(`Unbalanced release: ${this.name}`)
    this.active--
    this._drain()
  }

  _drain() {
    while (this.queue.length > 0 && this.active < this.limit) {
      const item = this.queue.shift()
      if (!item) break

      if (item.signal?.aborted) {
        this._cleanup(item)
        item.reject(item.signal.reason || new Error(`Aborted in queue for ${this.name}`))
        continue
      }

      this._cleanup(item)
      const waitedMs = Date.now() - item.queuedAt
      if (this.verbose && this.logger && waitedMs > 50) {
        this.logger.info(`[concurrency-limiter] ${this.name} queued request acquired slot after ${waitedMs}ms.`)
      }

      this.active++
      this.totalAcquired++
      item.resolve()
    }
  }

  _remove(item) {
    const idx = this.queue.indexOf(item)
    if (idx >= 0) this.queue.splice(idx, 1)
  }

  _cleanup(item) {
    if (item.timeoutTimer) {
      clearTimeout(item.timeoutTimer)
      item.timeoutTimer = null
    }
    if (item.signal && item.abortListener) {
      item.signal.removeEventListener('abort', item.abortListener)
      item.abortListener = null
    }
  }

  dispose() {
    this.disposed = true
    for (const item of this.queue.splice(0)) {
      this._cleanup(item)
      item.reject(new ConcurrencyLlmError('插件已卸载，排队请求已取消', 'LIMITER_DISPOSED'))
    }
  }

  stats() {
    return {
      name: this.name,
      limit: this.limit,
      active: this.active,
      queued: this.queue.length,
      totalAcquired: this.totalAcquired,
      totalQueued: this.totalQueued
    }
  }
}

class ConcurrencyLimiterManager {
  constructor(ctx, initialConfig) {
    this.ctx = ctx
    this.config = {
      globalConcurrency: undefined,
      defaultProviderConcurrency: 5,
      providers: { deepseek: 3, openai: 5, anthropic: 3 },
      models: { 'deepseek/deepseek-reasoner': 1, 'deepseek-reasoner': 1 },
      maxQueueSize: 100,
      queueTimeoutMs: 300000,
      verbose: true,
      ...initialConfig
    }

    this.providerSemaphores = new Map()
    this.modelSemaphores = new Map()
    this.sessionSemaphores = new Map() // sessionId -> AsyncSemaphore
    this.sessionOverrides = new Map()  // sessionId -> number
    this.sessionProviders = new Map()  // sessionId -> provider
    this.globalSemaphore = null

    this._syncConfig()
  }

  recordSessionProvider(sessionId, provider) {
    if (sessionId && provider) {
      this.sessionProviders.set(sessionId, provider)
    }
  }

  getSessionEffectiveProvider(sessionId) {
    if (!sessionId) return null
    const agent = this.ctx.get('agents')?.get(sessionId)
    return agent?.model.current()?.provider ?? null
  }

  _syncConfig() {
    const globalLimit = this.config.globalConcurrency
    if (typeof globalLimit === 'number' && globalLimit > 0) {
      if (!this.globalSemaphore) {
        this.globalSemaphore = new AsyncSemaphore('Global', globalLimit, {
          maxQueueSize: this.config.maxQueueSize,
          queueTimeoutMs: this.config.queueTimeoutMs,
          logger: this.ctx.logger,
          verbose: this.config.verbose
        })
      } else {
        this.globalSemaphore.updateLimit(globalLimit)
      }
    } else {
      this.globalSemaphore = null
    }

    for (const [provider, limit] of Object.entries(this.config.providers || {})) {
      const sem = this.providerSemaphores.get(provider)
      if (sem) sem.updateLimit(limit)
    }

    for (const [model, limit] of Object.entries(this.config.models || {})) {
      const sem = this.modelSemaphores.get(model)
      if (sem) sem.updateLimit(limit)
    }
  }

  setSessionOverride(sessionId, limit) {
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 256) throw new Error('无效会话 ID')
    if (limit !== null && limit !== 0 && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('会话上限必须是正整数，或使用 null 恢复继承')
    const existing = this.sessionSemaphores.get(sessionId)
    if (existing && (existing.active > 0 || existing.queueLength > 0)) throw new Error('当前会话有在途请求，请空闲后修改限制')
    if (typeof limit === 'number' && limit > 0) {
      this.sessionOverrides.set(sessionId, limit)
      let sem = this.sessionSemaphores.get(sessionId)
      if (!sem) {
        sem = new AsyncSemaphore(`Session:${sessionId.slice(-8)}`, limit, {
          maxQueueSize: this.config.maxQueueSize,
          queueTimeoutMs: this.config.queueTimeoutMs,
          logger: this.ctx.logger,
          verbose: this.config.verbose
        })
        this.sessionSemaphores.set(sessionId, sem)
      } else {
        sem.updateLimit(limit)
      }
    } else {
      this.sessionOverrides.delete(sessionId)
      this.sessionSemaphores.delete(sessionId)
    }
  }

  getSessionOverride(sessionId) {
    return this.sessionOverrides.get(sessionId) ?? null
  }

  updateConfig(newConfig) {
    this.config = validateConfig({ ...this.config, ...newConfig })
    this._syncConfig()
  }

  getProviderSemaphore(provider) {
    if (!provider) return null
    const limit = this.config.providers?.[provider] ?? this.config.defaultProviderConcurrency
    if (typeof limit !== 'number' || limit <= 0) return null

    let sem = this.providerSemaphores.get(provider)
    if (!sem) {
      sem = new AsyncSemaphore(`Provider:${provider}`, limit, {
        maxQueueSize: this.config.maxQueueSize,
        queueTimeoutMs: this.config.queueTimeoutMs,
        logger: this.ctx.logger,
        verbose: this.config.verbose
      })
      this.providerSemaphores.set(provider, sem)
    } else {
      sem.updateLimit(limit)
    }
    return sem
  }

  getModelSemaphore(provider, model) {
    const fullKey = `${provider}/${model}`
    let limit = this.config.models?.[fullKey] ?? this.config.models?.[model]
    if (typeof limit !== 'number' || limit <= 0) return null

    const key = this.config.models?.[fullKey] !== undefined ? fullKey : model
    let sem = this.modelSemaphores.get(key)
    if (!sem) {
      sem = new AsyncSemaphore(`Model:${key}`, limit, {
        maxQueueSize: this.config.maxQueueSize,
        queueTimeoutMs: this.config.queueTimeoutMs,
        logger: this.ctx.logger,
        verbose: this.config.verbose
      })
      this.modelSemaphores.set(key, sem)
    } else {
      sem.updateLimit(limit)
    }
    return sem
  }

  resolveSemaphores(sessionId, provider, model) {
    const list = []
    if (this.globalSemaphore) list.push(this.globalSemaphore)

    // Check session-level override
    if (sessionId) {
      const sessionSem = this.sessionSemaphores.get(sessionId)
      if (sessionSem) list.push(sessionSem)
    }

    const providerSem = this.getProviderSemaphore(provider)
    if (providerSem) list.push(providerSem)

    const modelSem = this.getModelSemaphore(provider, model)
    if (modelSem) list.push(modelSem)

    return list
  }

  /**
   * Get actively registered providers in the current DSH instance.
   */
  getActiveRegisteredProviders() {
    const active = []
    try {
      if (this.ctx.llm && typeof this.ctx.llm.listProviders === 'function') {
        const list = this.ctx.llm.listProviders()
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.id) active.push(item.id)
          }
        }
      }
    } catch {}
    return Array.from(new Set(active)).sort()
  }

  getStats(forSessionId) {
    const currentDefaultProvider = this.getSessionEffectiveProvider(forSessionId)
    return {
      config: this.config,
      activeProviders: this.getActiveRegisteredProviders(),
      mainstreamProviders: MAINSTREAM_PROVIDERS,
      sessionOverrides: Object.fromEntries(this.sessionOverrides.entries()),
      sessionProviders: Object.fromEntries(this.sessionProviders.entries()),
      effectiveProvider: currentDefaultProvider,
      global: this.globalSemaphore?.stats() ?? null,
      providers: Object.fromEntries(
        Array.from(this.providerSemaphores.entries()).map(([k, v]) => [k, v.stats()])
      ),
      models: Object.fromEntries(
        Array.from(this.modelSemaphores.entries()).map(([k, v]) => [k, v.stats()])
      ),
      sessions: Object.fromEntries(
        Array.from(this.sessionSemaphores.entries()).map(([k, v]) => [k, v.stats()])
      )
    }
  }
}

export function apply(ctx, config) {
  const manager = new ConcurrencyLimiterManager(ctx, validateConfig(config || {}))
  let savingConfig = false
  let disposed = false
  let outstanding = 0
  ctx.effect(() => () => {
    disposed = true
    const all = [manager.globalSemaphore, ...manager.providerSemaphores.values(), ...manager.modelSemaphores.values(), ...manager.sessionSemaphores.values()]
    for (const sem of all) sem?.dispose()
  })

  // Register llm/stream waterfall hook to control actual model calls
  ctx.on('llm/stream', async function* (options, next) {
    if (disposed) throw new ConcurrencyLlmError('插件已卸载', 'LIMITER_DISPOSED')
    if (savingConfig) throw new ConcurrencyLlmError('配置正在保存，请稍后重试', 'CONFIG_UPDATING')
    outstanding++
    try {
    const provider = options.provider
    const model = options.model
    const signal = options.signal
    const sessionId = options.sessionId

    if (sessionId && provider) {
      manager.recordSessionProvider(sessionId, provider)
    }

    const neededSemaphores = manager.resolveSemaphores(sessionId, provider, model)

    if (neededSemaphores.length === 0) {
      for await (const chunk of next()) {
        yield chunk
      }
      return
    }

    const acquired = []
    try {
      for (const sem of neededSemaphores) {
        await sem.acquire(signal)
        acquired.push(sem)
      }
    } catch (error) {
      while (acquired.length > 0) {
        acquired.pop().release()
      }
      throw error
    }

    try {
      for await (const chunk of next()) {
        yield chunk
      }
    } finally {
      while (acquired.length > 0) {
        acquired.pop().release()
      }
    }
    } finally { outstanding-- }
  })

  // This legacy HTTP surface is deliberately local-only; remote access requires
  // a future authenticated DSH action transport, not an unauthenticated route.
  function admit(req, res, method) {
    const address = req.socket?.remoteAddress
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) {
      sendJson(res, 403, { ok: false, error: '仅允许本机访问' }); return false
    }
    if (req.method !== method) {
      sendJson(res, 405, { ok: false, error: `需要 ${method}` }); return false
    }
    const host = req.headers.host || ''
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) {
      sendJson(res, 403, { ok: false, error: '无效 Host' }); return false
    }
    const origin = req.headers.origin
    if (origin) {
      try {
        const url = new URL(origin)
        if (!['http:', 'https:'].includes(url.protocol) || url.host !== host) throw new Error()
      } catch { sendJson(res, 403, { ok: false, error: '禁止跨源访问' }); return false }
    }
    if (req.headers['sec-fetch-site'] === 'cross-site' || (method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))) {
      sendJson(res, 403, { ok: false, error: '需要同源 JSON 请求' }); return false
    }
    return true
  }

  // HTTP Helper: read json body safely
  async function readJson(request) {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 65536) throw new Error('Body too large')
      chunks.push(chunk)
    }
    const str = Buffer.concat(chunks).toString('utf8')
    return str.length > 0 ? JSON.parse(str) : {}
  }

  function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    })
    response.end(JSON.stringify(data))
  }

  // Register HTTP routes with ctx.effect so Cordis cleanly unloads them on restart/reload
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_GET_CONFIG,
      handler: async (req, res) => {
        if (!admit(req, res, 'GET')) return
        let sid = undefined
        try {
          const url = new URL(req.url, 'http://127.0.0.1')
          sid = url.searchParams.get('sessionId') || undefined
        } catch {}
        const stats = manager.getStats(sid)
        stats.mainstreamProviders = MAINSTREAM_PROVIDERS
        sendJson(res, 200, { ok: true, data: stats })
      }
    }),
    'concurrency-limiter: get-config route'
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_UPDATE_CONFIG,
      handler: async (req, res) => {
        if (!admit(req, res, 'POST')) return
        try {
          const body = await readJson(req)
          if (body && typeof body === 'object') {
            const nextConfig = validateConfig({ ...manager.config, ...validateConfig(body) })
            const busy = outstanding > 0
            if (busy) {
              sendJson(res, 409, { ok: false, error: '当前有请求执行或排队；请待空闲后保存统一配置，以免配置重载丢失在途计数。' })
              return
            }
            const editor = ctx.get('configEditor')
            const entry = ctx.fiber.entry
            if (!editor || !entry) throw new Error('当前环境不支持持久化配置，未保存')
            if (savingConfig) throw new Error('已有配置保存请求正在处理')
            savingConfig = true
            try { await editor.edit(entry, () => nextConfig) }
            finally { savingConfig = false }
            sendJson(res, 200, { ok: true, saved: true })
          } else {
            sendJson(res, 400, { ok: false, error: 'Invalid config payload' })
          }
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err.message })
        }
      }
    }),
    'concurrency-limiter: update-config route'
  )

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_SESSION_OVERRIDE,
      handler: async (req, res) => {
        if (!admit(req, res, 'POST')) return
        try {
          const body = await readJson(req)
          const { sessionId, limit } = body || {}
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: 'Missing sessionId' })
            return
          }
          manager.setSessionOverride(sessionId, limit)
          sendJson(res, 200, {
            ok: true,
            sessionId,
            limit: manager.getSessionOverride(sessionId),
            stats: manager.getStats()
          })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err.message })
        }
      }
    }),
    'concurrency-limiter: session-override route'
  )

  ctx.logger.info('[dsh-llm-concurrency-limiter] Host service active and routes registered.')
}
