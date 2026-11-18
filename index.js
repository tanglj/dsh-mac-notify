/**
 * DSH 任务通知插件（宿主半）。
 *
 * 通知本身由客户端半（`client.js`）在渲染进程里发出：Electron 渲染进程的
 * Notification 会由主进程转发给系统通知中心，因此通知来源是「DeepSeek Harness」
 * 应用本身，点击后还能直接切回对应的会话。
 *
 * 宿主半只需声明可编辑的偏好项，并关掉按 schema 自动生成的配置页，
 * 因为设置项由客户端半自带的一行开关呈现。
 */

import z from '@deepseek-ai/schemastery'

/**
 * 通知开关。
 *
 * `.volatile()` 让设置页的改动立即生效：值通过 Host 设置服务投影给浏览器，
 * 客户端半读取后马上改变行为，不需要重启插件。
 */
export const Config = z.object({
  /** 任务结束时是否提醒。 */
  notifyCompletion: z.boolean().default(true).volatile(),
  /** 需要你介入（授权、提问、方案确认）时是否提醒。 */
  notifyAttention: z.boolean().default(true).volatile(),
  /** Dock 图标上是否显示未读会话数量。 */
  dockBadge: z.boolean().default(true).volatile(),
})

/**
 * 插件入口。
 *
 * 这里刻意不注册任何会话监听：宿主进程用 osascript 发通知会让通知归属脚本宿主，
 * 且无法携带「回到哪个会话」的信息，所以全部行为都放在客户端半。
 *
 * @param ctx 宿主上下文。
 */
export function apply(ctx) {
  // 本插件自带设置行，避免设置页再按 schema 自动生成一份。
  ctx.inject(['settings'], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      'mac-notify: settings page policy',
    )
  })
}
