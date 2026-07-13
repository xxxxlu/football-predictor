export function OfflineReadonlyNotice() {
  return <section aria-labelledby="offline-title" className="surface p-5"><p className="eyebrow">PWA / 离线规则</p><h2 id="offline-title" className="display mt-2 text-2xl font-bold">离线只能查看，不能提交</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">安装到桌面或主屏幕不会改变业务规则。应用可以保留静态外壳和最后成功读取的内容，但预测、加入房间、重置邀请等写操作必须在线完成。系统不会建立离线预测队列，也不会在恢复网络后自动重放。</p></section>;
}
