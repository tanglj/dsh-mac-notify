/**
 * 客户端半的链路测试：伪造浏览器环境与 Client 上下文，校验两类通知的触发与文案。
 *
 * 运行：node test/client.test.mjs
 */

import assert from 'node:assert/strict'

/** 记录客户端模块注册的定义。 */
let definition

/** 记录弹窗调用。 */
const shown = []

/** 被点击会话的导航记录。 */
const opened = []

/** 当前伪造的会话快照。 */
let sessions = { ids: [], byId: {} }

/** 当前伪造的会话事件窗口，键为会话 id。 */
const bindings = new Map()

/** 伪造的设置值，键为配置字段名。 */
let settingsValues = {}

/** 伪造的设置写入记录。 */
const settingsWrites = []

/** 已经注册的设置行。 */
const settingsRows = []

/** 伪造的客户端 configForms 服务。 */
const fakeConfigForms = {
  get() {
    return {
      getSnapshot: () => ({
        status: 'ready',
        value: settingsValues,
        base: undefined,
        user: undefined,
        revision: 1,
        writable: true,
      }),
      subscribe: () => () => {},
      set: async (field, value) => {
        settingsWrites.push([field, value])
        settingsValues = { ...settingsValues, [field]: value }
        return true
      },
    }
  },
}

/** 伪造的插槽注册表。 */
const fakeSlots = {
  inject(name, register) {
    return register()
  },
  register(options, component) {
    settingsRows.push({ options, component })
    return () => {}
  },
}

/** 伪造的可见性状态。 */
let watching = false

// —— 伪造浏览器环境 ——

/** 最近注册的「离开应用」回调，模拟窗口失焦或页面隐藏。 */
let away = () => {}

globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
  focus() {
    globalThis.__focused = true
  },
  addEventListener(type, handler) {
    if (type === 'blur') away = handler
  },
  removeEventListener() {},
}
globalThis.__focused = false

globalThis.document = {
  get visibilityState() {
    return watching ? 'visible' : 'hidden'
  },
  hasFocus() {
    return watching
  },
  addEventListener(type, handler) {
    if (type === 'visibilitychange') away = handler
  },
  removeEventListener() {},
}

/** 模拟用户切走：窗口失焦并重新评估待确认请求。 */
const leaveApp = () => {
  watching = false
  away()
}

/** 伪造的系统通知：只记录参数与交互回调。 */
class FakeNotification {
  static permission = 'granted'

  static async requestPermission() {
    return 'granted'
  }

  constructor(title, options) {
    this.title = title
    this.options = options
    this.onclick = undefined
    this.onclose = undefined
    this.onerror = undefined
    shown.push(this)
  }
}

globalThis.Notification = FakeNotification

/** 已注册的界面语言词典，键为命名空间。 */
const dictionaries = new Map()

/** 当前界面语言。 */
let activeLocale = 'zh'

/** 伪造的客户端 locale 服务：注册留档，按当前语言取文案。 */
const fakeLocale = {
  register(ns, dicts) {
    dictionaries.set(ns, dicts)
    return () => dictionaries.delete(ns)
  },
  bind(ns) {
    return (key, params) => {
      const dict = dictionaries.get(ns)?.[activeLocale] ?? {}
      let text = dict[key] ?? key
      if (params !== undefined) {
        text = text.replace(/\{(\w+)\}/g, (match, name) => (
          name in params ? String(params[name]) : match
        ))
      }
      return text
    }
  },
}

// —— 载入客户端模块 ——

await import('../client.js')
assert.ok(definition !== undefined, 'client.js 必须通过 __ModuleLoader__ 注册')
assert.equal(definition.id, '@local/dsh-mac-notify', '客户端模块 id 应为包名')

const clientModule = definition.factory(() => {})
for (const name of ['remote', 'sessions', 'uiSession', 'uiWorkspace', 'locale']) {
  assert.ok(clientModule.inject.includes(name), `必须注入 ${name}`)
}

/** 一回合结束的事件项。 */
const turnEnd = (reason, seq = 1) => ({
  type: 'event',
  event: { type: 'turn/end', seq, time: 0, data: { turn: 1, reason } },
})

/** 下一回合开始的事件项。 */
const turnStart = (seq = 2) => ({
  type: 'event',
  event: { type: 'turn/start', seq, time: 0, data: { turn: 2 } },
})

/**
 * 构造假 Client 上下文。
 *
 * @returns {object} ctx、状态推送口、错误推送口。
 */
function createClientContext() {
  const statusListeners = new Set()
  let snapshot = new Map()
  let errorHandler

  const ctx = {
    locale: fakeLocale,
    sessions: {
      list: { getSnapshot: () => sessions },
      binding: (id) => (bindings.has(id)
        ? {
          sessionId: id,
          eventSource: {
            getSnapshot: () => ({
              entries: bindings.get(id),
              hasMore: false,
              revision: 1,
              change: { kind: 'append', entries: [] },
            }),
          },
        }
        : undefined),
    },
    remote: {
      $on(name, handler) {
        if (name === 'api-session/error') errorHandler = handler
      },
    },
    uiSession: {
      sessionStatus: {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          statusListeners.add(listener)
          return () => statusListeners.delete(listener)
        },
      },
    },
    uiWorkspace: {
      openSession(id) {
        opened.push(id)
      },
    },
    effect(run) {
      return run()
    },
    inject(services, callback) {
      if (!services.includes('slots') || !services.includes('configForms')) return
      callback({ ...ctx, slots: fakeSlots, configForms: fakeConfigForms })
    },
  }

  /** 推入一版新的会话状态并通知订阅者。 */
  const push = (entries) => {
    snapshot = new Map(entries)
    for (const listener of statusListeners) listener()
  }

  return {
    ctx,
    push,
    setError: (id, message) => errorHandler(id, message),
  }
}

/**
 * 组装一条会话状态。
 *
 * @param {object} overrides 覆盖字段。
 * @returns {object} 状态值。
 */
const stateOf = (overrides = {}) => ({
  running: false,
  pendingInteraction: undefined,
  completionUnread: false,
  ...overrides,
})

/** 只有一个会话的默认摘要表。 */
const singleSession = (id, displayTitle, cwd) => ({
  ids: [id],
  byId: { [id]: { id, displayTitle, cwd, running: false } },
})

// —— 用例 ——

// 用例一：运行中 → 空闲且窗口读不到回合结束，弹出「任务已完成」。
{
  shown.length = 0
  bindings.clear()
  sessions = singleSession('s1', '修复登录超时', '/Users/me/project-a')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s1', stateOf({ running: true })]])
  push([['s1', stateOf({ running: false })]])

  assert.equal(shown.length, 1, '应弹出一条完成通知')
  assert.equal(shown[0].title, '修复登录超时', '标题使用会话名')
  assert.equal(shown[0].options.body, '任务已完成 · project-a', '正文包含目录名')
  console.log('用例一通过：任务结束提醒')
}

// 用例二：工具请求授权 → 弹出授权提醒，点击回到该会话。
{
  shown.length = 0
  opened.length = 0
  globalThis.__focused = false
  sessions = singleSession('s2', '重构代理层', '/Users/me/project-b')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s2', stateOf({ running: true })]])

  const approval = { key: 'approval:1', kind: 'approval', sessionId: 's2', toolName: 'Bash' }
  push([['s2', stateOf({ running: true, pendingInteraction: approval })]])

  assert.equal(shown.length, 1, '应弹出授权提醒')
  assert.equal(shown[0].options.body, '工具 Bash 需要你的授权', '正文点明工具名')

  shown[0].onclick()
  assert.equal(globalThis.__focused, true, '点击应聚焦窗口')
  assert.deepEqual(opened, ['s2'], '点击应切回对应会话')
  console.log('用例二通过：授权提醒与点击回跳')
}

// 用例三：同一待确认请求不重复提醒，消失后可再次提醒。
{
  shown.length = 0
  sessions = singleSession('s3', '排查构建失败', '/tmp/c')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)

  const question = {
    key: 'question:1',
    kind: 'question',
    sessionId: 's3',
    questions: [{ id: 'q1', question: '要继续覆盖配置吗？' }],
  }
  push([['s3', stateOf({ running: true, pendingInteraction: question })]])
  push([['s3', stateOf({ running: true, pendingInteraction: question })]])
  assert.equal(shown.length, 1, '同一请求只提醒一次')
  assert.equal(shown[0].options.body, '有问题等你回答：要继续覆盖配置吗？', '正文带问题摘要')

  // 回答后请求消失，再次出现同一 key 视为新请求。
  push([['s3', stateOf({ running: true })]])
  push([['s3', stateOf({ running: true, pendingInteraction: question })]])
  assert.equal(shown.length, 2, '请求结束后再次出现应重新提醒')
  console.log('用例三通过：待确认请求去重与复现')
}

// 用例四：计划确认类的文案。
{
  shown.length = 0
  sessions = singleSession('s4', '规划迁移', '/tmp/p')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s4', stateOf({
    running: true,
    pendingInteraction: { key: 'plan:1', kind: 'plan-review', sessionId: 's4' },
  })]])
  assert.equal(shown[0].options.body, '有一份计划等你确认', '计划确认文案')
  console.log('用例四通过：计划确认提醒')
}

// 用例五：Host 报告失败后，结束文案变成「任务出错」且只消费一次。
{
  shown.length = 0
  bindings.clear()
  sessions = singleSession('s5', '调用接口', '/tmp/e')
  const { ctx, push, setError } = createClientContext()
  clientModule.apply(ctx)
  push([['s5', stateOf({ running: true })]])
  setError('s5', '连接超时')
  push([['s5', stateOf({ running: false })]])

  assert.equal(shown.length, 1)
  assert.equal(shown[0].options.body, '任务出错：连接超时', '失败文案带原因')

  // 下一次正常结束应回到「任务已完成」。
  push([['s5', stateOf({ running: true })]])
  push([['s5', stateOf({ running: false })]])
  assert.equal(shown[1].options.body, '任务已完成 · e', '失败信息只消费一次')
  console.log('用例五通过：失败与完成分流')
}

// 用例六：正看着该会话、子 Agent 会话都不打扰；前台但看的是别的会话仍提醒。
{
  shown.length = 0
  watching = true
  sessions = {
    ids: ['s6'],
    byId: {
      s6: { id: 's6', displayTitle: '前台会话', cwd: '/tmp/w', running: false, retainedBy: { mainView: 1 } },
    },
  }
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s6', stateOf({ running: true })]])
  push([['s6', stateOf({ running: false })]])
  assert.equal(shown.length, 0, '正看着该会话时不提醒')

  // 前台但主视图是另一个会话：这次结束没被看到，仍然提醒。
  sessions = {
    ids: ['s6', 's6b'],
    byId: {
      s6: { id: 's6', displayTitle: '前台会话', cwd: '/tmp/w', running: false, retainedBy: { mainView: 1 } },
      s6b: { id: 's6b', displayTitle: '后台会话', cwd: '/tmp/bg', running: false },
    },
  }
  const background = createClientContext()
  clientModule.apply(background.ctx)
  background.push([['s6b', stateOf({ running: true })]])
  background.push([['s6b', stateOf({ running: false })]])
  assert.equal(shown.length, 1, '前台看别的会话时应提醒')
  assert.equal(shown[0].options.body, '任务已完成 · bg', '提醒的是那个后台会话')
  watching = false

  sessions = {
    ids: ['s7'],
    byId: { s7: { id: 's7', displayTitle: '子任务', cwd: '/tmp/s', running: false, origin: 'subagent' } },
  }
  const second = createClientContext()
  clientModule.apply(second.ctx)
  second.push([['s7', stateOf({ running: true })]])
  second.push([['s7', stateOf({ running: false })]])
  assert.equal(shown.length, 1, '子 Agent 会话不提醒')
  console.log('用例六通过：前台、后台与子 Agent 的打扰策略')
}

// 用例七：首次快照只作基线，不产生通知；通知失败不影响状态推送。
{
  shown.length = 0
  sessions = singleSession('s8', '既有会话', '/tmp/b')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s8', stateOf({ running: false })]])
  assert.equal(shown.length, 0, '基线不触发通知')

  const Throwing = class {
    constructor() {
      throw new Error('通知被系统拒绝')
    }
  }
  const original = globalThis.Notification
  globalThis.Notification = Throwing
  try {
    const third = createClientContext()
    clientModule.apply(third.ctx)
    third.push([['s8', stateOf({ running: true })]])
    assert.doesNotThrow(() => third.push([['s8', stateOf({ running: false })]]), '通知失败不得打断推送')
  } finally {
    globalThis.Notification = original
  }
  console.log('用例七通过：基线与通知失败安全')
}

// 用例八：回合正常完成时按完成提醒，并保留目录名。
{
  shown.length = 0
  bindings.clear()
  bindings.set('s9', [turnEnd({ kind: 'completed' })])
  sessions = singleSession('s9', '整理索引', '/tmp/index')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s9', stateOf({ running: true })]])
  push([['s9', stateOf({ running: false })]])
  assert.equal(shown[0].options.body, '任务已完成 · index', '完成文案带目录名')
  console.log('用例八通过：turn/end 完成原因')
}

// 用例九：回合以出错结束时，用回合结束记录的原因，而不是更早的 Host 错误。
{
  shown.length = 0
  bindings.clear()
  bindings.set('s10', [turnEnd({ kind: 'error', error: { message: '模型返回 500', code: 'UNKNOWN' } })])
  sessions = singleSession('s10', '部署服务', '/tmp/deploy')
  const { ctx, push, setError } = createClientContext()
  clientModule.apply(ctx)
  push([['s10', stateOf({ running: true })]])
  setError('s10', '旧错误')
  push([['s10', stateOf({ running: false })]])
  assert.equal(shown[0].options.body, '任务出错：模型返回 500', '回合结束原因优先于 Host 错误')
  console.log('用例九通过：出错原因取自 turn/end')
}

// 用例十：被手动中止的回合不再显示成「任务已完成」。
{
  shown.length = 0
  bindings.clear()
  bindings.set('s11', [turnEnd({ kind: 'aborted', reason: { kind: 'user' } })])
  sessions = singleSession('s11', '长任务', '/tmp/long')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s11', stateOf({ running: true })]])
  push([['s11', stateOf({ running: false })]])
  assert.equal(shown[0].options.body, '任务已中止 · 手动停止', '中止文案区分原因')
  console.log('用例十通过：中止原因')
}

// 用例十一：输出达到上限、被阻塞、未正常结束各有自己的文案。
{
  shown.length = 0
  bindings.clear()
  const cases = [
    ['s12', { kind: 'max-tokens' }, '任务中断 · 输出达到上限'],
    ['s13', { kind: 'blocked' }, '任务被阻塞，需要你处理'],
    ['s14', { kind: 'interrupted' }, '任务中断 · 上次运行未正常结束'],
    ['s15', { kind: 'aborted', reason: { kind: 'parent' } }, '任务已中止 · 上级会话结束'],
  ]
  for (const [id, reason, expected] of cases) {
    bindings.set(id, [turnEnd(reason)])
  }
  sessions = {
    ids: cases.map(([id]) => id),
    byId: Object.fromEntries(cases.map(([id]) => [id, { id, displayTitle: id, cwd: `/tmp/${id}`, running: false }])),
  }
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  for (const [index, [id, , expected]] of cases.entries()) {
    const before = shown.length
    push(cases.slice(0, index + 1).map(([other]) => [other, stateOf({ running: true })]))
    push(cases.slice(0, index + 1).map(([other]) => [other, stateOf({ running: other !== id })]))
    assert.equal(shown.length, before + 1, `${id} 应弹出一条提醒`)
    assert.equal(shown[shown.length - 1].options.body, expected, `${id} 文案`)
  }
  console.log('用例十一通过：其余结束原因文案')
}

// 用例十二：事件窗口尾部已开新回合时，不把旧回合的原因安到这次结束上。
{
  shown.length = 0
  bindings.clear()
  bindings.set('s16', [turnEnd({ kind: 'aborted', reason: { kind: 'user' } }), turnStart()])
  sessions = singleSingle('s16')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s16', stateOf({ running: true })]])
  push([['s16', stateOf({ running: false })]])
  assert.equal(shown[0].options.body, '任务已完成 · s16', '旧回合原因不得复用')
  console.log('用例十二通过：只看本次回合')
}

// 用例十三：英文界面下通知文案走英文词典，不再写死中文。
{
  shown.length = 0
  bindings.clear()
  bindings.set('s17', [turnEnd({ kind: 'aborted', reason: { kind: 'user' } })])
  sessions = singleSession('s17', 'Long task', '/tmp/en')
  activeLocale = 'en'
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s17', stateOf({ running: true })]])
  push([['s17', stateOf({ running: false })]])
  assert.equal(shown[0].options.body, 'Task stopped · cancelled by you', '英文中止文案')

  const approval = { key: 'approval:en', kind: 'approval', sessionId: 's17', toolName: 'Bash' }
  push([['s17', stateOf({ running: true, pendingInteraction: approval })]])
  assert.equal(shown[1].options.body, 'Tool Bash needs your approval', '英文授权文案')
  activeLocale = 'zh'
  console.log('用例十三通过：文案跟随界面语言')
}

// 用例十四：通知对象保留引用并带清理回调，点击后不重复导航。
{
  shown.length = 0
  opened.length = 0
  sessions = singleSession('s18', '保活检查', '/tmp/keep')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s18', stateOf({ running: true })]])
  push([['s18', stateOf({ running: false })]])
  const notification = shown[0]
  assert.equal(typeof notification.onclose, 'function', '关闭回调用于释放引用')
  assert.equal(typeof notification.onerror, 'function', '失败回调用于释放引用')
  notification.onclick()
  assert.deepEqual(opened, ['s18'], '点击只导航一次')
  console.log('用例十四通过：通知保活与清理')
}

// 用例十五：前台看着待确认卡片时不弹窗，切走后补一次提醒且不重复。
{
  shown.length = 0
  watching = true
  bindings.clear()
  sessions = {
    ids: ['s19'],
    byId: {
      s19: { id: 's19', displayTitle: '等待授权', cwd: '/tmp/away', running: false, retainedBy: { mainView: 1 } },
    },
  }
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s19', stateOf({ running: true })]])

  const approval = { key: 'approval:away', kind: 'approval', sessionId: 's19', toolName: 'Bash' }
  push([['s19', stateOf({ running: true, pendingInteraction: approval })]])
  assert.equal(shown.length, 0, '正看着这张卡片时不弹窗')

  leaveApp()
  assert.equal(shown.length, 1, '切走后应补发提醒')
  assert.equal(shown[0].options.body, '工具 Bash 需要你的授权', '补发的是同一个请求')

  leaveApp()
  assert.equal(shown.length, 1, '同一请求不重复补发')
  console.log('用例十五通过：离开应用时补发待确认提醒')
}

// 用例十六：关掉结束提醒后，任务停下不再弹窗，但待确认仍然提醒。
{
  shown.length = 0
  settingsValues = { notifyCompletion: false }
  bindings.clear()
  sessions = singleSession('s20', '安静结束', '/tmp/quiet')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s20', stateOf({ running: true })]])
  push([['s20', stateOf({ running: false })]])
  assert.equal(shown.length, 0, '关掉结束提醒后不弹完成通知')

  const approval = { key: 'approval:quiet', kind: 'approval', sessionId: 's20', toolName: 'Bash' }
  push([['s20', stateOf({ running: true, pendingInteraction: approval })]])
  assert.equal(shown.length, 1, '待确认提醒不受影响')
  settingsValues = {}
  console.log('用例十六通过：单独关闭结束提醒')
}

// 用例十七：关掉待确认提醒后，授权不再弹窗，但结束仍然提醒。
{
  shown.length = 0
  settingsValues = { notifyAttention: false }
  bindings.clear()
  sessions = singleSession('s21', '只看结束', '/tmp/only-done')
  const { ctx, push } = createClientContext()
  clientModule.apply(ctx)
  push([['s21', stateOf({ running: true })]])
  push([['s21', stateOf({
    running: true,
    pendingInteraction: { key: 'approval:muted', kind: 'approval', sessionId: 's21', toolName: 'Bash' },
  })]])
  assert.equal(shown.length, 0, '关掉待确认提醒后不弹授权通知')

  push([['s21', stateOf({ running: false })]])
  assert.equal(shown.length, 1, '结束提醒不受影响')
  assert.equal(shown[0].options.body, '任务已完成 · only-done', '结束文案照旧')
  settingsValues = {}
  console.log('用例十七通过：单独关闭待确认提醒')
}

// 用例十八：两条设置行注册到位，注入面能读当前值并写回对应字段。
{
  settingsRows.length = 0
  settingsWrites.length = 0
  settingsValues = {}
  watching = true
  sessions = singleSession('s22', '设置行', '/tmp/settings')
  const { ctx } = createClientContext()
  clientModule.apply(ctx)
  watching = false

  assert.equal(settingsRows.length, 2, '应注册两条设置行')
  const completion = settingsRows.find(row => row.options.id === 'mac-notify-completion')
  const attention = settingsRows.find(row => row.options.id === 'mac-notify-attention')
  assert.ok(completion !== undefined && attention !== undefined, '两条行都按 id 注册')
  assert.equal(completion.options.name, 'settings.general.item', '注册到「通用」设置插槽')
  assert.equal(completion.options.locale, 'mac-notify', '文案走插件自己的命名空间')
  assert.ok(completion.options.order < attention.options.order, '结束提醒排在待确认提醒之前')

  const face = completion.options.inject()
  assert.equal(face.selectValue({ value: {} }), true, '没有保存值时默认开启')
  assert.equal(face.selectValue({ value: { notifyCompletion: false } }), false, '保存值优先')
  assert.equal(face.titleKey, 'settings.completion.title', '标题文案键')
  assert.equal(await face.setValue(false), true, '写入被接受')
  assert.deepEqual(settingsWrites.at(-1), ['notifyCompletion', false], '写入对应字段')

  const attentionFace = attention.options.inject()
  await attentionFace.setValue(false)
  assert.deepEqual(settingsWrites.at(-1), ['notifyAttention', false], '第二个开关写入自己的字段')
  settingsValues = {}
  console.log('用例十八通过：设置行注册与读写')
}

/**
 * 单会话摘要表：目录名与会话 id 相同，便于断言兜底文案。
 *
 * @param {string} id 会话 id。
 * @returns {object} 摘要表。
 */
function singleSingle(id) {
  return singleSession(id, id, `/tmp/${id}`)
}

console.log('\n全部用例通过')
