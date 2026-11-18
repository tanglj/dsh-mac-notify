window.__ModuleLoader__.load({
  id: '@local/dsh-mac-notify',
  factory(require) {
    const React = require('react')

    /** 文案命名空间：通知正文与设置行都跟随界面语言。 */
    const NS = 'mac-notify'

    /** 宿主补丁里的行 id，也是设置服务里的命名空间名。 */
    const ENTRY_ID = 'mac-notify'

    const zh = {
      'notify.approval': '工具 {tool} 需要你的授权',
      'notify.approval.plain': '有工具需要你的授权',
      'notify.question': '有问题等你回答',
      'notify.question.withText': '有问题等你回答：{text}',
      'notify.plan': '有一份计划等你确认',
      'notify.interaction': '需要你确认后才能继续',
      'notify.completed': '任务已完成',
      'notify.completed.folder': '任务已完成 · {folder}',
      'notify.failed': '任务出错：{reason}',
      'notify.failed.plain': '任务出错',
      'notify.aborted': '任务已中止',
      'notify.aborted.user': '任务已中止 · 手动停止',
      'notify.aborted.parent': '任务已中止 · 上级会话结束',
      'notify.aborted.disposed': '任务已中止 · 会话已关闭',
      'notify.aborted.hook': '任务已中止 · {reason}',
      'notify.maxTokens': '任务中断 · 输出达到上限',
      'notify.blocked': '任务被阻塞，需要你处理',
      'notify.interrupted': '任务中断 · 上次运行未正常结束',
      'title.fallback': 'DSH 任务提醒',
      'settings.completion.title': '任务结束提醒',
      'settings.completion.description': '任务停下来时弹系统通知，按真实原因区分完成、出错与中断。',
      'settings.completion.label': '任务结束提醒开关',
      'settings.attention.title': '待确认提醒',
      'settings.attention.description': '工具请求授权、有问题待回答或方案待确认时弹系统通知。',
      'settings.attention.label': '待确认提醒开关',
      'settings.saveFailed': '没能保存这个开关，请稍后再试。',
    }

    const en = {
      'notify.approval': 'Tool {tool} needs your approval',
      'notify.approval.plain': 'A tool needs your approval',
      'notify.question': 'A question is waiting for you',
      'notify.question.withText': 'A question is waiting for you: {text}',
      'notify.plan': 'A plan is waiting for your confirmation',
      'notify.interaction': 'Your confirmation is required to continue',
      'notify.completed': 'Task finished',
      'notify.completed.folder': 'Task finished · {folder}',
      'notify.failed': 'Task failed: {reason}',
      'notify.failed.plain': 'Task failed',
      'notify.aborted': 'Task stopped',
      'notify.aborted.user': 'Task stopped · cancelled by you',
      'notify.aborted.parent': 'Task stopped · parent session ended',
      'notify.aborted.disposed': 'Task stopped · session closed',
      'notify.aborted.hook': 'Task stopped · {reason}',
      'notify.maxTokens': 'Task interrupted · output token limit reached',
      'notify.blocked': 'Task is blocked and needs you',
      'notify.interrupted': 'Task interrupted · the previous run did not finish cleanly',
      'title.fallback': 'DSH task reminder',
      'settings.completion.title': 'Task finish notifications',
      'settings.completion.description': 'Notify when a task stops, naming the real reason: finished, failed, or interrupted.',
      'settings.completion.label': 'Task finish notifications',
      'settings.attention.title': 'Confirmation notifications',
      'settings.attention.description': 'Notify when a tool asks for approval, a question waits, or a plan needs review.',
      'settings.attention.label': 'Confirmation notifications',
      'settings.saveFailed': 'Could not save this switch. Try again later.',
    }

    /**
     * 设置行样式。
     *
     * DSH 不向第三方插件导出设置行组件，因此这里按宿主「设置 › 通用」的
     * 尺寸与主题变量重绘：标签在左、开关在右、行间用一条细分隔线。
     */
    const styles = {
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        padding: '16px 0',
        borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
      },
      text: { minWidth: 0 },
      title: { fontSize: 14, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
      description: { marginTop: 4, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      error: { marginTop: 4, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' },
      switch: (checked, disabled) => ({
        display: 'inline-flex',
        alignItems: 'center',
        flex: '0 0 auto',
        boxSizing: 'border-box',
        width: 36,
        height: 20,
        padding: 2,
        border: 0,
        borderRadius: 999,
        background: checked
          ? 'var(--dsw-alias-brand-primary)'
          : 'var(--dsw-alias-border-l3)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.12s ease',
      }),
      thumb: (checked) => ({
        display: 'block',
        boxSizing: 'border-box',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: checked
          ? 'var(--dsw-alias-label-primary-foreground)'
          : 'var(--dsw-alias-switch-thumb)',
        transform: checked ? 'translate(16px)' : 'none',
        transition: 'transform 0.12s ease',
      }),
    }

    /**
     * 通用开关行组件。
     *
     * @param props.t 界面语言翻译函数。
     * @param props.useValue 读取当前开关值的订阅钩子。
     * @param props.setValue 写入开关值，返回是否被接受。
     * @param props.titleKey 标题文案键。
     * @param props.descriptionKey 说明文案键。
     * @param props.labelKey 开关可访问名称文案键。
     */
    function SwitchRow(props) {
      const t = props.t
      const checked = props.useValue(props.selectValue)
      const [writing, setWriting] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      const change = () => {
        setFailed(false)
        setWriting(true)
        void Promise.resolve(props.setValue(!checked)).then((accepted) => {
          if (accepted === false) setFailed(true)
        }).catch(() => { setFailed(true) }).finally(() => { setWriting(false) })
      }

      return React.createElement('div', { style: styles.row }, [
        React.createElement('div', { key: 'text', style: styles.text }, [
          React.createElement('div', { key: 'title', style: styles.title }, t(props.titleKey)),
          React.createElement('div', { key: 'description', style: styles.description }, t(props.descriptionKey)),
          failed
            ? React.createElement('div', { key: 'error', role: 'alert', style: styles.error }, t('settings.saveFailed'))
            : null,
        ]),
        React.createElement('button', {
          key: 'switch',
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': t(props.labelKey),
          disabled: writing,
          style: styles.switch(checked, writing),
          onClick: change,
        }, React.createElement('span', { style: styles.thumb(checked) })),
      ])
    }

    /**
     * 在渲染进程弹出任务相关的系统通知。
     *
     * 三类提醒：
     * 1. 需要你介入——工具请求授权、有问题待回答、计划待确认；
     * 2. 任务停下来——回合结束，按 `turn/end` 记录的原因区分完成、出错、中止等；
     * 3. 其余无法归因的停下——退回 Host 转发的错误或按完成处理。
     *
     * Electron 渲染进程的 Notification 由主进程转发给系统通知中心，
     * 所以通知来源就是「DeepSeek Harness」应用本身；点击通知会聚焦窗口并切回该会话。
     */
    return {
      inject: ['remote', 'sessions', 'uiSession', 'uiWorkspace', 'locale'],
      apply(ctx) {
        // 环境没有通知能力时静默跳过，不影响会话本身。
        if (typeof Notification === 'undefined') return

        // 词典注册为插件资源，卸载时随 Cordis 上下文一起回收。
        if (ctx.locale !== undefined) {
          ctx.effect(
            () => ctx.locale.register(NS, { zh, en }),
            'mac-notify: dictionaries',
          )
        }

        /** 没有 locale 服务时的兜底翻译：只用中文词典，并支持占位符替换。 */
        const fallbackTranslate = (key, params) => {
          const template = zh[key] ?? key
          if (params === undefined) return template
          return template.replace(/\{(\w+)\}/g, (match, name) => (
            name in params ? String(params[name]) : match
          ))
        }

        /** 翻译入口：优先走界面语言，缺失时回退中文词典。 */
        const t = ctx.locale === undefined ? fallbackTranslate : ctx.locale.bind(NS)

        /** 设置表单；设置服务可用后才会赋值，缺失时一律按默认值处理。 */
        let settingsForm

        /**
         * 读取一个开关的当前值。
         *
         * @param {string} field 配置字段名。
         * @returns {boolean} 开关值，读不到时为 true（默认开启）。
         */
        const preference = (field) => {
          try {
            return settingsForm?.getSnapshot().value?.[field] ?? true
          } catch {
            return true
          }
        }

        /** 用户是否正看着应用：可见且窗口聚焦时不打扰。 */
        const isWatching = () => document.visibilityState === 'visible' && document.hasFocus()

        /** 读取会话摘要；快照不可读时返回 undefined。 */
        const summaryOf = (sessionId) => {
          try {
            return ctx.sessions.list.getSnapshot().byId[sessionId]
          } catch {
            return undefined
          }
        }

        /**
         * 该会话是否正显示在主视图里。
         *
         * 主视图的保留计数由工作区维护，是客户端唯一可读的「当前看的是哪个会话」。
         * 读不到时按否处理，宁可多提醒一次。
         *
         * @param {string} sessionId 目标会话。
         * @returns {boolean} 是否是主视图会话。
         */
        const isMainView = (sessionId) => {
          try {
            return (summaryOf(sessionId)?.retainedBy?.mainView ?? 0) > 0
          } catch {
            return false
          }
        }

        /** 读取会话目录的最后一段名称。 */
        const folderName = (cwd) => {
          if (typeof cwd !== 'string' || cwd === '') return ''
          const parts = cwd.split('/').filter(Boolean)
          return parts.length === 0 ? '' : parts[parts.length - 1]
        }

        /** 截断过长文本，避免通知正文被系统省略成一句话的开头。 */
        const shorten = (text, limit = 60) => {
          const line = String(text ?? '').replace(/\s+/g, ' ').trim()
          return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
        }

        /**
         * 正在显示、尚未关闭的通知。
         *
         * 保留引用，否则通知对象可能被回收，点击回调随之失效。
         */
        const live = new Set()

        /**
         * 弹出一条通知，点击后聚焦应用并切回对应会话。
         *
         * @param {string} sessionId 目标会话。
         * @param {string} body 通知正文。
         * @returns {boolean} 是否真的弹出了通知。
         */
        const announce = (sessionId, body) => {
          const summary = summaryOf(sessionId)
          // 子 Agent 会话不打扰用户。
          if (summary?.origin === 'subagent') return false
          // 前台且正看着这个会话时不打扰；看着别的会话仍然提醒。
          if (isWatching() && isMainView(sessionId)) return false
          const title = summary?.displayTitle ?? t('title.fallback')
          try {
            const notification = new Notification(title, { body, tag: sessionId })
            live.add(notification)
            notification.onclose = () => { live.delete(notification) }
            notification.onerror = () => { live.delete(notification) }
            notification.onclick = () => {
              live.delete(notification)
              window.focus()
              ctx.uiWorkspace.openSession(sessionId)
            }
            return true
          } catch {
            // 通知被系统拒绝时不打断会话流程。
            return false
          }
        }

        /** 把待确认项翻译成通知正文。 */
        const confirmationBody = (pending) => {
          switch (pending?.kind) {
            case 'approval': {
              const tool = shorten(pending.toolName, 40)
              return tool === '' ? t('notify.approval.plain') : t('notify.approval', { tool })
            }
            case 'question': {
              const first = pending.questions?.[0]?.question
              const text = shorten(first, 48)
              return text === '' ? t('notify.question') : t('notify.question.withText', { text })
            }
            case 'plan-review':
              return t('notify.plan')
            default:
              return t('notify.interaction')
          }
        }

        /**
         * 读取该会话事件窗口里最近一条 `turn/end` 的原因。
         *
         * 只对仍被客户端持有的会话有窗口可读；从尾部向前扫到上一个 `turn/start`
         * 就停，避免把更早回合的结束原因当成这一次的。
         *
         * @param {string} sessionId 目标会话。
         * @returns {object|undefined} 回合结束原因，读不到时为 undefined。
         */
        const latestTurnEnd = (sessionId) => {
          let entries
          try {
            const binding = ctx.sessions.binding(sessionId)
            entries = binding?.eventSource.getSnapshot().entries
          } catch {
            return undefined
          }
          if (entries === undefined) return undefined
          const from = Math.max(0, entries.length - 64)
          for (let index = entries.length - 1; index >= from; index -= 1) {
            const entry = entries[index]
            if (entry?.type !== 'event') continue
            const event = entry.event
            if (event.type === 'turn/start') return undefined
            if (event.type === 'turn/end') return event.data?.reason
          }
          return undefined
        }

        /**
         * 把回合结束原因翻译成通知正文。
         *
         * @param {string} sessionId 目标会话。
         * @param {object|undefined} reason `turn/end` 记录的原因。
         * @param {string|undefined} failure Host 报告的失败信息。
         * @returns {string} 通知正文。
         */
        const endBody = (sessionId, reason, failure) => {
          const folder = folderName(summaryOf(sessionId)?.cwd)
          const completion = folder === ''
            ? t('notify.completed')
            : t('notify.completed.folder', { folder })

          switch (reason?.kind) {
            case 'error': {
              const message = shorten(reason.error?.message ?? failure, 80)
              return message === '' ? t('notify.failed.plain') : t('notify.failed', { reason: message })
            }
            case 'aborted': {
              const cause = reason.reason?.kind
              if (cause === 'user') return t('notify.aborted.user')
              if (cause === 'parent') return t('notify.aborted.parent')
              if (cause === 'disposed') return t('notify.aborted.disposed')
              if (cause === 'hook') {
                const detail = shorten(reason.reason?.reason, 40)
                return detail === '' ? t('notify.aborted') : t('notify.aborted.hook', { reason: detail })
              }
              return t('notify.aborted')
            }
            case 'max-tokens':
              return t('notify.maxTokens')
            case 'blocked':
              return t('notify.blocked')
            case 'interrupted':
              return t('notify.interrupted')
            case 'completed':
              return completion
            default: {
              // 窗口还没读到这次回合时，退回 Host 报告的失败，否则按完成处理。
              const message = shorten(failure, 80)
              return message === '' ? completion : t('notify.failed', { reason: message })
            }
          }
        }

        /** 本轮结束后记录的失败信息，用于缺少回合结束时兜底。 */
        const lastError = new Map()
        /** 已经提醒过的待确认请求，避免同一请求重复弹窗。 */
        const announced = new Set()
        /** 上一次的会话状态快照，用于比较出状态变化。 */
        let previous = new Map()

        // 失败信息由 Host 转发；它发生在回合之外，状态变化里看不到原因。
        ctx.remote.$on('api-session/error', (sessionId, message) => {
          lastError.set(sessionId, shorten(message, 80))
        })

        if (Notification.permission === 'default') {
          void Notification.requestPermission().catch(() => {})
        }

        const status = ctx.uiSession.sessionStatus
        previous = new Map(status.getSnapshot())

        /**
         * 补发提醒：窗口失去焦点或隐藏时，重新检查仍然等着的请求。
         *
         * 前台看着某张授权卡片时不会弹窗，等用户切走以后就应该补一次，
         * 否则这个请求会一直安静地等着。
         */
        const remindPending = () => {
          if (!preference('notifyAttention')) return
          let snapshot
          try {
            snapshot = status.getSnapshot()
          } catch {
            return
          }
          for (const [sessionId, current] of snapshot) {
            const pending = current.pendingInteraction
            if (pending === undefined || announced.has(pending.key)) continue
            if (announce(sessionId, confirmationBody(pending))) announced.add(pending.key)
          }
        }

        // 离开应用时补发；事件名由窗口和文档各自提供，缺一个也不影响另一个。
        if (typeof window.addEventListener === 'function') {
          ctx.effect(() => {
            window.addEventListener('blur', remindPending)
            document.addEventListener?.('visibilitychange', remindPending)
            return () => {
              window.removeEventListener('blur', remindPending)
              document.removeEventListener?.('visibilitychange', remindPending)
            }
          }, 'mac-notify: away reminders')
        }

        ctx.effect(() => status.subscribe(() => {
          const next = status.getSnapshot()
          const pendingKeys = new Set()

          for (const [sessionId, current] of next) {
            const before = previous.get(sessionId)

            // 一、需要你介入：新的待确认请求出现。
            const pending = current.pendingInteraction
            if (pending !== undefined) {
              pendingKeys.add(pending.key)
              const isNew = pending.key !== before?.pendingInteraction?.key
                && !announced.has(pending.key)
              if (isNew && preference('notifyAttention')) {
                if (announce(sessionId, confirmationBody(pending))) announced.add(pending.key)
              }
            }

            // 二、任务停下来：运行中转为空闲。
            if (before?.running === true && current.running === false) {
              // 失败信息只消费一次，避免影响下一次结束的文案。
              const failure = lastError.get(sessionId)
              lastError.delete(sessionId)
              if (preference('notifyCompletion')) {
                const reason = latestTurnEnd(sessionId)
                announce(sessionId, endBody(sessionId, reason, failure))
              }
            }
          }

          // 请求一旦结束就允许它下次重新提醒，同时不让集合无限增长。
          for (const key of [...announced]) {
            if (!pendingKeys.has(key)) announced.delete(key)
          }
          previous = new Map(next)
        }), 'mac-notify: session status')

        // 设置行：设置服务与插槽都可用时才出现，缺失时插件照常提醒。
        ctx.inject(['slots', 'configForms'], (scope) => {
          try {
            settingsForm = scope.configForms.get(ENTRY_ID)
          } catch {
            return
          }
          if (settingsForm === undefined) return

          /** 把表单包成插槽可用的只读订阅源。 */
          const source = {
            getSnapshot: () => settingsForm.getSnapshot(),
            subscribe: (listener) => settingsForm.subscribe(listener),
          }

          /**
           * 注册一条开关行。
           *
           * @param {string} id 行 id。
           * @param {number} order 行顺序。
           * @param {string} field 配置字段名。
           * @param {string} preferenceKey 文案键前缀。
           */
          const registerRow = (id, order, field, preferenceKey) => {
            scope.slots.inject('settings.general.item', () => scope.slots.register({
              name: 'settings.general.item',
              id,
              order,
              locale: NS,
              inject: () => ({
                hooks: { value: source },
                selectValue: (snapshot) => snapshot.value?.[field] ?? true,
                setValue: (next) => settingsForm.set(field, next),
                titleKey: `settings.${preferenceKey}.title`,
                descriptionKey: `settings.${preferenceKey}.description`,
                labelKey: `settings.${preferenceKey}.label`,
              }),
            }, SwitchRow))
          }

          registerRow('mac-notify-completion', 18, 'notifyCompletion', 'completion')
          registerRow('mac-notify-attention', 19, 'notifyAttention', 'attention')
        })
      },
    }
  },
})
