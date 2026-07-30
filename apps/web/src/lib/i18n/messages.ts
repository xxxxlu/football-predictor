export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];


const zhCN = {
  "skipToContent": "跳到主要内容",
  "nav.primary": "主要导航",
  "nav.mobile": "移动端导航",
  "nav.account": "账户",
  "nav.matches": "赛事",
  "nav.rooms": "房间",
  "nav.history": "战绩",
  "nav.leaderboard": "排行榜",
  "nav.accountLabel": "账户",
  "nav.rank": "排行",
  "nav.me": "我的",
  "auth.sessionPending": "确认会话中…",
  "auth.enterRoom": "进入房间",
  "auth.login": "登录",
  "auth.register": "创建账户",
  "footer.disclaimer": "仅使用虚拟积分，不支持充值、提现或兑换。18 岁以上用户可使用。",
  "footer.shortDisclaimer": "虚拟积分不可充值、提现或兑换 · 仅限 18+",
  "language.switcher": "切换语言",
  "language.zh": "中文",
  "language.en": "English",
  "language.current": "当前语言",
  "page.section.events": "赛事",
  "page.section.f1": "F1",
  "auth.backHome": "返回首页",
  "auth.username": "用户名",
  "auth.password": "密码",
  "auth.newPassword": "新密码",
  "auth.recoveryCode": "恢复码",
  "auth.usernameHint": "3–32 个字符",
  "auth.passwordHint": "12–128 个字符",
  "auth.recoveryHint": "输入保存的完整恢复码",
  "auth.rules": "使用规则确认",
  "auth.ageConfirm": "我确认已满 18 岁。",
  "auth.nonCashConfirm": "我理解本服务仅使用虚拟积分，不支持充值、提现或兑换。",
  "auth.processing": "正在安全处理…",
  "auth.resetPassword": "重置密码并轮换恢复码",
  "auth.failed": "未能完成",
  "auth.networkError": "网络连接失败。你的账户和积分没有发生变化，请检查网络后重试。",
} as const;

export type MessageKey = keyof typeof zhCN;

const en = {
  "skipToContent": "Skip to main content",
  "nav.primary": "Primary navigation",
  "nav.mobile": "Mobile navigation",
  "nav.account": "Account",
  "nav.matches": "Matches",
  "nav.rooms": "Groups",
  "nav.history": "History",
  "nav.leaderboard": "Leaderboard",
  "nav.accountLabel": "Account",
  "nav.rank": "Rank",
  "nav.me": "Me",
  "auth.sessionPending": "Confirming session…",
  "auth.enterRoom": "Open groups",
  "auth.login": "Log in",
  "auth.register": "Create account",
  "footer.disclaimer": "Virtual points only. No deposits, withdrawals, or exchanges. For users aged 18+.",
  "footer.shortDisclaimer": "Virtual points only · No deposits, withdrawals, or exchanges · 18+",
  "language.switcher": "Change language",
  "language.zh": "中文",
  "language.en": "English",
  "language.current": "Current language",
  "page.section.events": "EVENTS",
  "page.section.f1": "F1",
  "auth.backHome": "Back to home",
  "auth.username": "Username",
  "auth.password": "Password",
  "auth.newPassword": "New password",
  "auth.recoveryCode": "Recovery code",
  "auth.usernameHint": "3–32 characters",
  "auth.passwordHint": "12–128 characters",
  "auth.recoveryHint": "Enter the complete recovery code you saved",
  "auth.rules": "Rules confirmation",
  "auth.ageConfirm": "I confirm that I am at least 18 years old.",
  "auth.nonCashConfirm": "I understand that this service uses virtual points only and does not support deposits, withdrawals, or exchanges.",
  "auth.processing": "Processing securely…",
  "auth.resetPassword": "Reset password and rotate recovery code",
  "auth.failed": "Could not complete",
  "auth.networkError": "Network connection failed. Your account and points have not changed. Please check your connection and try again.",
} as const;

export const messages = {
  "zh-CN": zhCN,
  en,
} as const satisfies Record<Locale, Record<MessageKey, string>>;

export const sharedAuthCopy: Record<string, { eyebrow: string; title: string; description: string }> = {
  "继续你的赛事": { eyebrow: "Welcome back", title: "Continue your matchday", description: "Log in to return to your private groups, picks, points, and ledger." },
  "从一张空白账本开始": { eyebrow: "Create account", title: "Start with a blank ledger", description: "No phone number or email required. After registration you receive a recovery code shown only once." },
  "换一把新钥匙": { eyebrow: "Account recovery", title: "Get a new key", description: "Use your username and valid recovery code to set a new password. Your old code and existing sessions will be invalidated." },
  "修改初始密码": { eyebrow: "Security step", title: "Change the initial password", description: "A provisioned super administrator must change the initial password before accessing administrative functions." },
};

/**
 * Existing route metadata is passed to the shared client shell from server
 * pages. Keeping this adapter here lets the shell become bilingual without
 * turning every route into a client component.
 */
export const sharedPageCopy: Record<string, { title: string; description: string }> = {
  "我的房间": { title: "My groups", description: "Create or join a private group. Every group keeps its own points, picks, and ledger." },
  "长期档案": { title: "Long-term record", description: "Review settled picks across groups by event and season, with settlement versions and ledger audit trails." },
  "房间赛事": { title: "Group event", description: "Manage members and invitations. Before submission, points, data freshness, and the actual lock state are checked again." },
  "成员提交状态": { title: "Member submission status", description: "Hosts can only see who has submitted. No one’s selections or stakes are visible before the market locks." },
  "我的账户": { title: "My account", description: "Review balances, picks, and point movements for each group, and manage your profile." },
  "比赛中心": { title: "Match centre", description: "Only event data held in the product cache is shown here. Stale or unavailable data is explicitly marked." },
  "F1 赛程": { title: "F1 schedule", description: "Browse by race weekend. Predictions lock at the start of each session and settle automatically after official results are recorded." },
  "房间排行榜": { title: "Group leaderboard", description: "Rankings are calculated only within the current private group and never mix points from other groups." },
  "房间治理": { title: "Group governance", description: "Review reports, restrict or close groups, and verify the operation audit trail." },
  "治理收件箱": { title: "Governance inbox", description: "Handle the reports your duty covers, with only the context each decision needs, then restrict, hide, mute or dismiss with a recorded reason." },
  "用户状态管理": { title: "User status", description: "Super administrators can suspend or restore regular users; sensitive operations require fresh confirmation." },
  "系统状态": { title: "System status", description: "A read-only health view of supplier quotas, cached product data, automated settlement, and background jobs." },
  "运营总览": { title: "Operations overview", description: "Supplier, settlement and job health, the reports and account risks waiting on someone, and a filterable permission audit." },
  "F1 场次详情": { title: "F1 session detail", description: "Driver standings and point multipliers come from data published by the platform. No picks are accepted after lock." },
  "积分账本": { title: "Points ledger", description: "Explains every grant, hold, settlement, reversal, and debt offset." },
  "比赛详情": { title: "Match detail", description: "Lineups and event information below come from the product cache. Pending or stale data is clearly marked; no fictional players are shown." },
  "F1 车手档案": { title: "F1 driver profile", description: "Season results come only from confirmed official results. Photo and team-mark assets are tracked in the in-product licence register." },
  "F1 车队档案": { title: "F1 team profile", description: "Team points and results come only from confirmed official results. Photo and team-mark assets are tracked in the in-product licence register." },
};
