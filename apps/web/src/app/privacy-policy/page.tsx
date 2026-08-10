import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { TermsSection } from "@/components/terms-section";

export const metadata: Metadata = {
  title: "隐私政策",
  description: "PULSE 收集、使用、保存和管理手机端用户数据的说明。",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b rule">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-8">
          <BrandMark />
          <Link href="/login" className="text-sm font-bold hover:underline">返回登录</Link>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-8 sm:py-16">
        <p className="eyebrow">PRIVACY POLICY · 2026-08-07</p>
        <h1 className="display mt-3 text-4xl font-bold sm:text-5xl">隐私政策</h1>
        <p className="mt-4 max-w-3xl leading-7 text-[var(--muted)]">
          本政策说明 PULSE 在手机浏览器或添加到主屏幕后会处理哪些信息、处理目的，以及你可以如何撤销授权或清除数据。
        </p>

        <div className="mt-10">
          <TermsSection number="01" title="登录时自动记录的信息">
            <p>当你主动勾选登录页的隐私授权并登录成功后，系统会把本次设备快照与账户关联保存：浏览器和操作系统标识、设备平台与可用设备型号提示、屏幕和视口尺寸、像素密度、颜色深度、语言、时区、触控点、逻辑核心数、可用内存档位、联网状态、网络质量估算、省流量设置、Cookie 与 Do Not Track 状态、横竖屏状态、是否以主屏幕应用方式运行。</p>
            <p>系统也会保存主题、字体、深色模式、减少动态效果、对比度、通知授权状态、偏好赛事，以及本次页面加载类型和大致耗时。这些字段是否可用取决于你的手机和浏览器，不可用的字段不会强行读取。</p>
          </TermsSection>
          <TermsSection number="02" title="账户、安全与使用数据">
            <p>为了登录、会话安全、反滥用和故障排查，系统还会处理账户 ID、用户名、登录时间、会话状态、IP 地址、User-Agent、安全事件，以及你在产品内主动产生的房间、好友、赛事、竞猜、积分账本与互动记录。</p>
            <p>这些信息用于提供核心功能、保持账户安全、适配手机界面、分析兼容性问题和改进产品体验，不用于建立跨应用广告画像。</p>
          </TermsSection>
          <TermsSection number="03" title="照片和位置">
            <p>登录页的基础授权不会让网页静默读取手机相册或精确位置。只有在你主动使用需要照片或位置的功能时，页面才会说明用途，并由手机系统或浏览器再次显示权限或文件选择界面。</p>
            <p>你没有选择照片、没有拍照，或拒绝位置权限时，系统不会获得对应内容。位置授权停止后不会继续获取新的坐标。</p>
          </TermsSection>
          <TermsSection number="04" title="不会读取的信息">
            <p>PULSE 当前不会读取通讯录、短信、通话记录、麦克风录音、其他应用列表、剪贴板内容、健康数据、支付卡信息或持续后台位置；也不会生成广告标识符或利用设备字段建立跨站追踪指纹。</p>
          </TermsSection>
          <TermsSection number="05" title="保存、访问与保护">
            <p>已收集记录保存在服务端数据库，并与当前账户关联。只有你本人和具备用户安全查看权限的运营角色可以查看隐私中心数据；管理员访问受角色权限控制。</p>
            <p>照片内容不会出现在隐私列表摘要中。会话凭证使用 HttpOnly Cookie；密码和恢复码不会以明文保存。</p>
          </TermsSection>
          <TermsSection number="06" title="撤销、清除与账户删除">
            <p>登录后可进入“隐私与授权中心”撤销后续设备或偏好收集。撤销只停止后续收集，不会自动删除历史记录；你可以在同一页面单独清除已收集数据。</p>
            <p>手机系统授予的网站位置或相机权限需要在浏览器的网站设置中管理。账户删除或匿名化请求可从账户安全流程提交，并按账本完整性、安全审计和适用规则处理。</p>
          </TermsSection>
          <TermsSection number="07" title="政策更新">
            <p>如收集的数据类型、用途或共享方式发生实质变化，登录前的说明与本政策会同步更新；需要重新取得授权时，系统不会把关闭页面或继续浏览视为同意。</p>
          </TermsSection>
        </div>

        <div className="mt-10 flex flex-wrap gap-4 border-t rule pt-6 text-sm font-bold">
          <Link href="/login" className="underline underline-offset-2">返回登录</Link>
          <Link href="/terms" className="underline underline-offset-2">查看使用规则</Link>
        </div>
        <p className="mt-5 text-xs leading-5 text-[var(--muted)]">版本：privacy-2026-08-07</p>
      </main>
    </div>
  );
}
