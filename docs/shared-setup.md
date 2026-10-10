# 共享版接入与发布

本分支已实现真实 Supabase SDK 与 SQL 接口，但正式云项目和验证码通道尚未配置。
现有公开网址仍为本机版；不能把本地模拟验证码测试当作真实短信收码或正式云同步。

## 后端

在自己的 Supabase 项目按顺序应用：

1. `supabase/migrations/202610100001_shared_journal.sql`
2. `supabase/migrations/202610100002_private_attachments.sql`

迁移创建三张有 RLS 的共享表、私密邀请与操作回执表、私密附件 bucket。
每个账号只加入一个档案，档案最多两人。邀请绑定已验证的手机号或邮箱，24 小时过期；只有创建者可以生成、撤销邀请。
所有写入经鉴权 RPC，比较实体版本后原子保存；重复操作 UUID 返回同一结果。记录移除保留删除状态，图片路径包含内容哈希且不可覆盖。

数据库及 Storage 不给匿名用户读取权限；客户端只放 publishable/anon key，绝不放 service_role、短信密钥或管理令牌。

## 验证码登录

手机：启用 Phone provider，配置支持目标号码地区的真实 SMS provider，实际验证两人的接收与登录。
若使用区域短信服务，可通过 Supabase Send SMS Hook 接入；本分支不包含尚未选定供应商的短信网关，也不声称已能给 +86 号码实际发码。

邮箱：配置自己的 SMTP 服务，将登录模板设置为显示 `{{ .Token }}`，确保返回 6 位验证码。
默认 Supabase 邮件仅发送到项目团队预授权邮箱，不能作为普通用户的正式邮箱验证码服务。

根据实际短信供应商设置服务端限流和消费限额；公开手机号入口在配置防滥发措施并完成收码验收后才开启。前端重发倒计时仅改善体验，不能替代服务端限流。
已接入可选 Cloudflare Turnstile 组件和 captchaToken 传递。项目使用 Turnstile 时，将公开 site key 配到 `TURNSTILE_SITE_KEY`（本地 `VITE_TURNSTILE_SITE_KEY`），secret 仅存 Supabase Auth 设置；实际挑战仍需正式域名联调。其他 CAPTCHA 服务尚未集成，不得关闭已有防护来绕过。

固定使用同一个手机号或邮箱登录。当前没有把两种登录方式自动合并为同一个账号。

## GitHub 配置

仓库变量：

- `SUPABASE_URL`：项目 HTTPS URL。
- `ENABLE_SMS_LOGIN`：实际短信登录验收通过后设为 `true`。
- `ENABLE_EMAIL_LOGIN`：实际邮箱登录验收通过后设为 `true`。

仓库 Secret：`SUPABASE_ANON_KEY`，只接受公开的 publishable/anon key。
这些值由 Actions 映射为 Vite 构建变量；只有发布通过检查的 main 才可更新 Pages。
不配置时保留本机功能，并明确显示“共享服务尚未开通”，不会出现假验证码成功或虚假的已同步状态。

本地从 `.env.example` 配置相同变量。需要 Node.js 24 与 pnpm 11.25.0：

```sh
pnpm install --frozen-lockfile
pnpm test
APP_BASE_PATH=/miao-growth-journal/ pnpm build
APP_BASE_PATH=/miao-growth-journal/ node scripts/check-build.mjs
APP_BASE_PATH=/miao-growth-journal/ pnpm preview --port 4175
```

`scripts/check-cloud-config.mjs` 拒绝不完整配置、生产 HTTP URL、service_role 与 secret key。

## 原手机记录迁移

1. 在已经录入资料的手机与原网址导出完整备份，包含照片和 PDF。
2. 共享版正式开通后，保持使用新的同一网址；需要时先把旧网址备份导入当前本机档案。
3. 登录并填写自己的称呼，创建共享档案时明确勾选上传本机记录。原 `state` 不被覆盖；共享缓存使用独立账号和档案键。
4. 等待待上传数量为零，再核对照片、花费和记录数量。
5. 邀请对方用指定手机号或邮箱登录加入。不要再创建第二份猫咪档案。

离线期间先在 IndexedDB 原子保存资料与待上传操作，联网后自动补传。页面可见时每 15 秒检查更新，回来或恢复联网时立即检查。
如果两人改同一条记录，保留本机修改并显示冲突，明确选择采用云端或保留本机后才继续上传。
退登录回到原本机档案；待上传队列保留在原账号缓存中，下次同一账号登录后继续。

## 发布验收

自动测试覆盖数据逻辑、离线队列、重试幂等、同时录入、旧表单冲突、同账号多页和真实 PostgreSQL RLS/RPC。
PGlite 测试的身份表与 Storage 基础表是本地夹具；浏览器联调的 OTP 交付与文件 HTTP API 也是本地夹具。
必须另外用正式项目的两个真实账号完成：真实发码、身份绑定邀请、共享照片、双向录入、离线补传、冲突选择和退出重登录。
通过后再启用相应登录标记并合并发布；真实手机相机、主屏幕安装与后台恢复另行实机检查。

参考：[Phone Auth](https://supabase.com/docs/guides/auth/phone-login)、[Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)、[SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
