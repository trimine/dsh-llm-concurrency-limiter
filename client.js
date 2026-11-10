/**
 * Client module for LLM Concurrency Limiter.
 *
 * Implements:
 * 1. Global visual settings panel in the left sidebar (`sidebar.panellist` -> `main`).
 *    - Automatically shows active/configured providers.
 *    - Allows adding mainstream providers via dropdown or adding custom providers.
 * 2. Per-session quick concurrency setting in conversation composer bar (`conversation.input.left`).
 */
window.__ModuleLoader__.load({
  id: 'dsh-llm-concurrency-limiter',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    const PANEL_ID = 'concurrency-limiter'
    const ROUTE_GET_CONFIG = '/api/llm-concurrency/config'
    const ROUTE_UPDATE_CONFIG = '/api/llm-concurrency/config/update'
    const ROUTE_SESSION_OVERRIDE = '/api/llm-concurrency/session-override'

    const CSS = `
.dsh-cl-page { height: 100%; overflow-y: auto; padding: 28px 24px 48px; box-sizing: border-box; }
.dsh-cl-page-inner { max-width: 840px; margin: 0 auto; font-family: system-ui, -apple-system, sans-serif; }
.dsh-cl-title { font-size: 22px; font-weight: 600; margin: 0 0 8px; color: var(--dsw-alias-label-primary); }
.dsh-cl-desc { font-size: 13px; color: var(--dsw-alias-label-secondary); margin: 0 0 24px; line-height: 1.5; }

.dsh-cl-card {
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px; padding: 20px; margin-bottom: 20px;
}
.dsh-cl-card-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-cl-card-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--dsw-alias-label-primary); }
.dsh-cl-card-subtitle { font-size: 12px; color: var(--dsw-alias-label-secondary); margin: 4px 0 0; }

.dsh-cl-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
.dsh-cl-table th {
  text-align: left; font-size: 12px; color: var(--dsw-alias-label-secondary);
  padding: 8px 10px; font-weight: 500; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-cl-table td { padding: 10px; font-size: 13px; border-bottom: 1px solid var(--dsw-alias-border-l1); vertical-align: middle; }
.dsh-cl-table tr:last-child td { border-bottom: 0; }

.dsh-cl-tag {
  display: inline-block; padding: 2px 7px; border-radius: 4px;
  font-size: 11px; font-weight: 500; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); margin-left: 6px;
}
.dsh-cl-tag-active {
  background: rgba(16, 185, 129, 0.12); color: #10b981;
}

.dsh-cl-input {
  width: 75px; padding: 6px 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-input, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-primary); font-size: 13px; text-align: right;
  font-family: inherit;
}
.dsh-cl-input:focus { outline: 2px solid var(--dsw-alias-brand-primary); }

.dsh-cl-text-input {
  padding: 6px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-size: 13px; font-family: inherit;
}

.dsh-cl-select {
  padding: 6px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-size: 13px; font-family: inherit; outline: none;
}

.dsh-cl-btn {
  padding: 8px 18px; border-radius: 6px; border: 0;
  background: var(--dsw-alias-brand-primary, #0066cc);
  color: #fff; font-size: 13px; font-weight: 500; cursor: pointer;
  transition: opacity 120ms;
}
.dsh-cl-btn:hover { opacity: 0.9; }
.dsh-cl-btn-secondary {
  padding: 6px 12px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.dsh-cl-btn-secondary:hover { background: var(--dsw-alias-bg-layer-3); }

.dsh-cl-btn-danger {
  padding: 3px 8px; border-radius: 4px; border: 0;
  background: transparent; color: #ef4444; font-size: 12px; cursor: pointer;
}
.dsh-cl-btn-danger:hover { background: rgba(239, 68, 68, 0.1); }

.dsh-cl-quick-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px; font-weight: 500; cursor: pointer;
}
.dsh-cl-quick-btn:hover { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }

.dsh-cl-dialog-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center;
}
.dsh-cl-dialog {
  width: 330px; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px; padding: 20px; box-shadow: 0 16px 40px rgba(0,0,0,0.32);
}
`

    /**
     * Sidebar Icon component:
     * High-clarity vector SVG gauge. No HTML wrapper box to eliminate jitter/blur on click.
     */
    function LimiterPanelIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: {
            display: 'block',
            margin: 'auto',
            opacity: props?.active === true ? 1 : 0.85
          }
        },
        // Gauge/Meter arch
        h('path', { d: 'M12 4a8 8 0 0 0-7.9 6.8c-.2 1.4.1 2.8.8 4A7.9 7.9 0 0 0 12 19a7.9 7.9 0 0 0 7.1-4.2c.7-1.2 1-2.6.8-4A8 8 0 0 0 12 4z' }),
        // Center hub
        h('circle', { cx: 12, cy: 14, r: 2, fill: 'currentColor' }),
        // Indicator needle
        h('path', { d: 'M12 14l3.2-5.2' }),
        // Dial ticks
        h('path', { d: 'M12 6.5v1.5' }),
        h('path', { d: 'M7.5 9l1 1' }),
        h('path', { d: 'M16.5 9l-1 1' })
      )
    }

    /**
     * Global Configuration & Management Page
     */
    function LimiterSettingsPage() {
      const [stats, setStats] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [saving, setSaving] = React.useState(false)
      const [savedNotice, setSavedNotice] = React.useState(false)

      const [activeProviders, setActiveProviders] = React.useState([])
      const [mainstreamList, setMainstreamList] = React.useState([])
      const [providersConfig, setProvidersConfig] = React.useState({})
      const [modelsConfig, setModelsConfig] = React.useState({})
      const [defaultLimit, setDefaultLimit] = React.useState(5)
      const [globalLimit, setGlobalLimit] = React.useState('')

      // Selection state for adding provider from dropdown
      const [selectedMainstream, setSelectedMainstream] = React.useState('')
      const [mainstreamLimit, setMainstreamLimit] = React.useState(3)

      // State for adding custom provider
      const [customProviderName, setCustomProviderName] = React.useState('')
      const [customProviderLimit, setCustomProviderLimit] = React.useState(3)

      // State for adding custom model
      const [newModelName, setNewModelName] = React.useState('')
      const [newModelLimit, setNewModelLimit] = React.useState(1)

      const loadConfig = () => {
        setLoading(true)
        fetch(ROUTE_GET_CONFIG)
          .then((r) => r.json())
          .then((res) => {
            if (res.ok && res.data) {
              setStats(res.data)
              const c = res.data.config || {}
              setActiveProviders(res.data.activeProviders || [])
              setMainstreamList(res.data.mainstreamProviders || [])
              setProvidersConfig(c.providers || {})
              setModelsConfig(c.models || {})
              setDefaultLimit(c.defaultProviderConcurrency ?? 5)
              setGlobalLimit(c.globalConcurrency !== undefined && c.globalConcurrency !== null ? String(c.globalConcurrency) : '')
            }
          })
          .catch(() => {})
          .finally(() => setLoading(false))
      }

      React.useEffect(() => {
        loadConfig()
        let cancelled = false
        let timer
        const controller = new AbortController()
        const refreshStats = async () => {
          try {
            const response = await fetch(ROUTE_GET_CONFIG, { signal: controller.signal })
            const result = await response.json()
            if (!cancelled && result.ok) {
              setStats(result.data)
              setActiveProviders(result.data.activeProviders || [])
              setMainstreamList(result.data.mainstreamProviders || [])
            }
          } catch { if (!cancelled) setStats(null) }
          finally { if (!cancelled) timer = setTimeout(refreshStats, 1500) }
        }
        timer = setTimeout(refreshStats, 1500)
        return () => { cancelled = true; clearTimeout(timer); controller.abort() }
      }, [])

      const handleSave = () => {
        setSaving(true)
        const payload = {
          defaultProviderConcurrency: Number(defaultLimit) > 0 ? Number(defaultLimit) : 5,
          globalConcurrency: globalLimit.trim() !== '' && Number(globalLimit) > 0 ? Number(globalLimit) : null,
          providers: providersConfig,
          models: modelsConfig
        }

        fetch(ROUTE_UPDATE_CONFIG, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then((r) => r.json())
          .then((res) => {
            if (res.ok) {
              setSavedNotice(true)
              setTimeout(() => setSavedNotice(false), 2500)
              loadConfig()
            } else { throw new Error(res.error || '保存失败') }
          })
          .catch(err => window.alert(`配置未保存：${err.message}`))
          .finally(() => setSaving(false))
      }

      const updateProviderVal = (p, val) => {
        if (val === '' || isNaN(val)) {
          const next = { ...providersConfig }
          delete next[p]
          setProvidersConfig(next)
        } else {
          setProvidersConfig({ ...providersConfig, [p]: Math.max(1, Number(val)) })
        }
      }

      const addMainstreamProvider = () => {
        const p = selectedMainstream.trim()
        if (!p) return
        setProvidersConfig({ ...providersConfig, [p]: Math.max(1, Number(mainstreamLimit)) })
        setSelectedMainstream('')
      }

      const addCustomProvider = () => {
        const name = customProviderName.trim()
        if (!name) return
        setProvidersConfig({ ...providersConfig, [name]: Math.max(1, Number(customProviderLimit)) })
        setCustomProviderName('')
      }

      const removeProvider = (p) => {
        const next = { ...providersConfig }
        delete next[p]
        setProvidersConfig(next)
      }

      const updateModelVal = (m, val) => {
        if (val === '' || isNaN(val)) {
          const next = { ...modelsConfig }
          delete next[m]
          setModelsConfig(next)
        } else {
          setModelsConfig({ ...modelsConfig, [m]: Math.max(1, Number(val)) })
        }
      }

      const addCustomModel = () => {
        const name = newModelName.trim()
        if (!name) return
        setModelsConfig({ ...modelsConfig, [name]: Math.max(1, Number(newModelLimit)) })
        setNewModelName('')
      }

      const removeModel = (m) => {
        const next = { ...modelsConfig }
        delete next[m]
        setModelsConfig(next)
      }

      // Displayed providers:
      // ONLY those currently configured by the user OR actively registered/running in DSH.
      // Unused providers never clutter this list!
      const visibleProviders = Array.from(new Set([...activeProviders, ...Object.keys(providersConfig)])).sort()

      // Mainstream dropdown options that are NOT already in the visible list
      const dropdownOptions = mainstreamList.filter(item => !visibleProviders.includes(item.id))

      return h(
        'div',
        { className: 'dsh-cl-page' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dsh-cl-page-inner' },
          h('h1', { className: 'dsh-cl-title' }, 'LLM并发限制器'),
          h('p', { className: 'dsh-cl-desc' }, '为每一个正在使用的 AI 服务提供商或特定模型分别设定最大并发数。对超出并发上限的请求排队；并发控制不等于请求数或 Token 速率控制，不能保证消除 429。'),

          // Card 1: Active & Configured Providers
          h(
            'div',
            { className: 'dsh-cl-card' },
            h(
              'div',
              { className: 'dsh-cl-card-header' },
              h('div', null,
                h('h2', { className: 'dsh-cl-card-title' }, '服务提供商并发限制 (Provider Limits)'),
                h('div', { className: 'dsh-cl-card-subtitle' }, '仅展示当前已开启运行或已设定限制的提供商。未使用的提供商不会在此冗余展示。')
              )
            ),
            h(
              'table',
              { className: 'dsh-cl-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, '服务提供商 (Provider)'),
                  h('th', { style: { width: '140px' } }, '当前运行状态'),
                  h('th', { style: { width: '110px', textAlign: 'right' } }, '并发限制'),
                  h('th', { style: { width: '50px' } }, '')
                )
              ),
              h(
                'tbody',
                null,
                visibleProviders.length === 0
                  ? h('tr', null, h('td', { colSpan: 4, style: { textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', padding: '16px' } }, '暂无活跃服务商，可从下方添加'))
                  : visibleProviders.map((p) => {
                      const stat = stats?.providers?.[p]
                      const isActiveInDsh = activeProviders.includes(p)
                      const hasCustom = providersConfig[p] !== undefined

                      return h(
                        'tr',
                        { key: p },
                        h(
                          'td',
                          null,
                          h('strong', null, p),
                          isActiveInDsh
                            ? h('span', { className: 'dsh-cl-tag dsh-cl-tag-active', title: 'DSH 运行时检测到该服务商已接入' }, '已接入')
                            : null,
                          hasCustom
                            ? h('span', { className: 'dsh-cl-tag' }, '已设上限')
                            : h('span', { className: 'dsh-cl-tag' }, `默认 (${defaultLimit})`)
                        ),
                        h(
                          'td',
                          null,
                          stat && stat.active > 0
                            ? h('span', { style: { fontSize: '12px', color: '#10b981', fontWeight: 600 } }, `${stat.active}/${stat.limit} 活跃 · ${stat.queued} 排队`)
                            : h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '就绪 / 空闲')
                        ),
                        h(
                          'td',
                          { style: { textAlign: 'right' } },
                          h('input', {
                            type: 'number',
                            min: 1,
                            max: 100,
                            className: 'dsh-cl-input',
                            value: hasCustom ? providersConfig[p] : '',
                            placeholder: String(defaultLimit),
                            onChange: (e) => updateProviderVal(p, e.target.value)
                          })
                        ),
                        h(
                          'td',
                          { style: { textAlign: 'center' } },
                          hasCustom ? h('button', { className: 'dsh-cl-btn-danger', title: '移除自定义配置', onClick: () => removeProvider(p) }, '移除') : null
                        )
                      )
                    })
              )
            ),

            // Add Provider Actions (Dropdown + Custom)
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed var(--dsw-alias-border-l1)' } },
              
              // 1. Add Mainstream Provider via Dropdown
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', minWidth: '110px' } }, '从主流服务商添加:'),
                h(
                  'select',
                  {
                    className: 'dsh-cl-select',
                    style: { width: '210px' },
                    value: selectedMainstream,
                    onChange: (e) => setSelectedMainstream(e.target.value)
                  },
                  h('option', { value: '' }, '-- 选择主流服务商 --'),
                  dropdownOptions.map(opt => h('option', { key: opt.id, value: opt.id }, `${opt.name} (${opt.id})`))
                ),
                h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '并发:'),
                h('input', {
                  type: 'number',
                  min: 1,
                  max: 50,
                  className: 'dsh-cl-input',
                  style: { width: '55px' },
                  value: mainstreamLimit,
                  onChange: (e) => setMainstreamLimit(e.target.value)
                }),
                h('button', { type: 'button', className: 'dsh-cl-btn-secondary', disabled: !selectedMainstream, onClick: addMainstreamProvider }, '添加到列表')
              ),

              // 2. Add Custom Provider
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', minWidth: '110px' } }, '新增自定义服务商:'),
                h('input', {
                  type: 'text',
                  placeholder: '输入服务商 ID (如: chatflowsai)',
                  className: 'dsh-cl-text-input',
                  style: { width: '210px' },
                  value: customProviderName,
                  onChange: (e) => setCustomProviderName(e.target.value)
                }),
                h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '并发:'),
                h('input', {
                  type: 'number',
                  min: 1,
                  max: 50,
                  className: 'dsh-cl-input',
                  style: { width: '55px' },
                  value: customProviderLimit,
                  onChange: (e) => setCustomProviderLimit(e.target.value)
                }),
                h('button', { type: 'button', className: 'dsh-cl-btn-secondary', disabled: !customProviderName.trim(), onClick: addCustomProvider }, '添加并配置')
              )
            ),

            // Default Concurrency Setting
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
              h('div', null,
                h('div', { style: { fontSize: '13px', fontWeight: 500 } }, '其他未单独限制服务商的默认并发'),
                h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, '未单独配置的服务商将统一使用此默认并发')
              ),
              h('input', {
                type: 'number',
                min: 1,
                max: 50,
                className: 'dsh-cl-input',
                value: defaultLimit,
                onChange: (e) => setDefaultLimit(e.target.value)
              })
            )
          ),

          // Card 2: Model Specific Limits
          h(
            'div',
            { className: 'dsh-cl-card' },
            h(
              'div',
              { className: 'dsh-cl-card-header' },
              h('div', null,
                h('h2', { className: 'dsh-cl-card-title' }, '特定重度模型并发限制 (Model Limits)'),
                h('div', { className: 'dsh-cl-card-subtitle' }, '对高耗算力模型（如 deepseek-reasoner / R1 推理模型）设定单独的上限，避免单模型并发耗尽额度。')
              )
            ),
            h(
              'table',
              { className: 'dsh-cl-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, '模型名称 (Model ID)'),
                  h('th', { style: { width: '140px' } }, '当前运行状态'),
                  h('th', { style: { width: '110px', textAlign: 'right' } }, '并发限制'),
                  h('th', { style: { width: '50px' } }, '')
                )
              ),
              h(
                'tbody',
                null,
                Object.keys(modelsConfig).length === 0
                  ? h('tr', null, h('td', { colSpan: 4, style: { textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', padding: '16px' } }, '暂无单独限制的模型规则'))
                  : Object.keys(modelsConfig).map((m) => {
                      const stat = stats?.models?.[m]
                      return h(
                        'tr',
                        { key: m },
                        h('td', null, h('strong', null, m)),
                        h(
                          'td',
                          null,
                          stat
                            ? h('span', { style: { fontSize: '12px', color: stat.active > 0 ? '#10b981' : 'var(--dsw-alias-label-secondary)' } },
                                `${stat.active}/${stat.limit} 活跃 · ${stat.queued} 排队`
                              )
                            : h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '空闲')
                        ),
                        h(
                          'td',
                          { style: { textAlign: 'right' } },
                          h('input', {
                            type: 'number',
                            min: 1,
                            max: 20,
                            className: 'dsh-cl-input',
                            value: modelsConfig[m],
                            onChange: (e) => updateModelVal(m, e.target.value)
                          })
                        ),
                        h(
                          'td',
                          { style: { textAlign: 'center' } },
                          h('button', { className: 'dsh-cl-btn-danger', onClick: () => removeModel(m) }, '删除')
                        )
                      )
                    })
              )
            ),
            // Add Custom Model Bar
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed var(--dsw-alias-border-l1)' } },
              h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '添加特定模型规则:'),
              h('input', {
                type: 'text',
                placeholder: '例如: deepseek-reasoner, o3-mini',
                className: 'dsh-cl-text-input',
                style: { width: '220px' },
                value: newModelName,
                onChange: (e) => setNewModelName(e.target.value)
              }),
              h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '并发:'),
              h('input', {
                type: 'number',
                min: 1,
                max: 20,
                className: 'dsh-cl-input',
                style: { width: '55px' },
                value: newModelLimit,
                onChange: (e) => setNewModelLimit(e.target.value)
              }),
              h('button', { type: 'button', className: 'dsh-cl-btn-secondary', disabled: !newModelName.trim(), onClick: addCustomModel }, '添加模型规则')
            )
          ),

          // Card 3: Global Concurrency
          h(
            'div',
            { className: 'dsh-cl-card' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
              h('div', null,
                h('h2', { className: 'dsh-cl-card-title' }, '全局并发总量控制 (Global Limit)'),
                h('div', { className: 'dsh-cl-card-subtitle' }, '整个 DSH 实例发出的 LLM 请求总并发上限（留空表示不限制总上限）。')
              ),
              h('input', {
                type: 'number',
                min: 0,
                max: 200,
                placeholder: '不限',
                className: 'dsh-cl-input',
                value: globalLimit,
                onChange: (e) => setGlobalLimit(e.target.value)
              })
            )
          ),

          // Bottom Action
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '14px', marginTop: '8px' } },
            h('button', { className: 'dsh-cl-btn', onClick: handleSave, disabled: saving }, saving ? '保存中...' : '保存统一配置'),
            savedNotice ? h('span', { style: { fontSize: '13px', color: '#10b981', fontWeight: 500 } }, '✓ 配置已成功更新并实时生效') : null
          )
        )
      )
    }

    /**
     * Per-Session Quick Concurrency Control in Composer Toolbar
     */
    function SessionConcurrencyControl(props) {
      const sessionId = props?.session?.id || props?.sessionId
      const [isOpen, setIsOpen] = React.useState(false)
      const [currentLimit, setCurrentLimit] = React.useState('')
      const [inputVal, setInputVal] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [sessionProvider, setSessionProvider] = React.useState('')
      const [providerConfigLimit, setProviderConfigLimit] = React.useState(null)
      const [providerRunningStat, setProviderRunningStat] = React.useState(null)

      React.useEffect(() => {
        if (!sessionId) return
        let cancelled = false
        let timer
        let first = true
        const controller = new AbortController()
        const refresh = () => fetch(`${ROUTE_GET_CONFIG}?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal })
          .then((r) => r.json())
          .then((res) => {
            if (!cancelled && res.ok && res.data) {
              const data = res.data
              const override = data.sessionOverrides?.[sessionId]
              if (override !== undefined && override !== null) {
                setCurrentLimit(String(override))
                if (first) setInputVal(String(override))
              } else {
                setCurrentLimit('')
                if (first) setInputVal('')
              }

              // Detect provider for current session
              const p = data.effectiveProvider || ''
              setSessionProvider(p)

              // Check if provider has specific limit configured in settings
              const provLimit = data.config?.providers?.[p] ?? data.config?.defaultProviderConcurrency ?? 5
              setProviderConfigLimit(provLimit)

              // Check running status of this provider
              const stat = data.providers?.[p]
              setProviderRunningStat(stat || null)
              first = false
            }
          })
          .catch(() => { if (!cancelled) setProviderRunningStat(null) })
          .finally(() => {
            if (!cancelled && isOpen) timer = setTimeout(refresh, 1500)
          })
        refresh()
        return () => { cancelled = true; clearTimeout(timer); controller.abort() }
      }, [sessionId, isOpen])

      const handleSave = () => {
        setSaving(true)
        const limitNum = inputVal.trim() === '' || Number(inputVal) <= 0 ? null : Number(inputVal)
        fetch(ROUTE_SESSION_OVERRIDE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, limit: limitNum })
        })
          .then((r) => r.json())
          .then((res) => {
            if (res.ok) {
              setCurrentLimit(res.limit ? String(res.limit) : '')
              setIsOpen(false)
            } else { throw new Error(res.error || '保存失败') }
          })
          .catch(err => window.alert(`会话配置未保存：${err.message}`))
          .finally(() => setSaving(false))
      }

      const labelText = currentLimit ? `并发: ${currentLimit}` : '并发限制'

      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-cl-quick-btn',
            title: '并发限制（该处设置仅针对当前对话生效）',
            onClick: () => setIsOpen(true),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-2)',
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: '11px',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              height: '24px'
            }
          },
          h(
            'svg',
            { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
            h('circle', { cx: 12, cy: 12, r: 8 }),
            h('path', { d: 'M12 8v4l2 2' })
          ),
          h('span', { style: { fontWeight: 500 } }, labelText)
        ),

        isOpen
          ? createPortal(h(
              'div',
              {
                className: 'dsh-cl-dialog-overlay',
                onClick: (e) => {
                  if (e.target === e.currentTarget) setIsOpen(false)
                }
              },
              h(
                'div',
                { className: 'dsh-cl-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '当前对话并发限制', onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); setIsOpen(false) } } },
                h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: 'var(--dsw-alias-label-primary)' } }, '当前对话独立并发限制'),
                h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '12px', lineHeight: 1.4 } }, '该处设置仅针对当前对话生效。切换或新建对话后依然继承统一配置。'),

                // Provider synchronization banner
                sessionProvider
                  ? h(
                      'div',
                      {
                        style: {
                          padding: '8px 10px',
                          borderRadius: '6px',
                          background: 'var(--dsw-alias-bg-layer-2)',
                          border: '1px solid var(--dsw-alias-border-l1)',
                          marginBottom: '14px',
                          fontSize: '12px'
                        }
                      },
                      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } },
                        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '检测到当前服务商:'),
                        h('strong', null, sessionProvider)
                      ),
                      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } },
                        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '菜单中统一配置:'),
                        h('span', { style: { color: '#10b981', fontWeight: 500 } }, `${providerConfigLimit} 并发`)
                      ),
                      h('div', { style: { display: 'flex', justifyContent: 'space-between' } },
                        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '服务商运行状态:'),
                        h('span', { style: { color: providerRunningStat?.active > 0 ? '#10b981' : 'var(--dsw-alias-label-secondary)' } }, providerRunningStat
                          ? `${providerRunningStat.active}/${providerRunningStat.limit} 活跃 · ${providerRunningStat.queued} 排队`
                          : '就绪 / 空闲'
                        )
                      )
                    )
                  : null,

                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' } },
                  h('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, '本会话特定上限:'),
                  h('input', {
                    type: 'number',
                    min: 0,
                    max: 50,
                    placeholder: String(providerConfigLimit || '全局默认'),
                    style: { width: '80px', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'inherit', textAlign: 'right' },
                    value: inputVal,
                    onChange: (e) => setInputVal(e.target.value)
                  })
                ),
                h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
                  h('button', {
                    type: 'button',
                    style: { padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
                    onClick: () => setIsOpen(false)
                  }, '取消'),
                  h('button', {
                    type: 'button',
                    className: 'dsh-cl-btn',
                    style: { padding: '6px 14px' },
                    onClick: handleSave,
                    disabled: saving
                  }, saving ? '保存中' : '确定')
                )
              )
            ), document.body)
          : null
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 1. Sidebar icon for Concurrency configuration
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 45,
              label: 'LLM并发限制器'
            },
            LimiterPanelIcon
          )
        )

        // 2. Main page opening when sidebar icon is clicked
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, LimiterSettingsPage)
        )

        // 3. Quick session concurrency settings in the bottom composer tool row
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'concurrency-session-override',
              order: 15,
              label: 'LLM并发限制器'
            },
            SessionConcurrencyControl
          )
        )
      }
    }
  }
})
