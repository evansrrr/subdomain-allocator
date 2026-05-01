# CF子域名分配

通过简单的邮箱验证区分用户，自动分配 CF 子域名，只能绑定 pages

邮箱验证码通过 Resend 发送

---

## 开始部署

后端：粘贴 `index.js` 到 Cloudflare Workers 并部署。

绑定：

```
D1数据库：DB

KV命名空间：KV
```

数据库初始化：

在 D1 数据库控制台发送：

```sql
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  used_records INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  subdomain TEXT NOT NULL,
  main_domain TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email, subdomain, main_domain)
);
```

环境变量：

```
ALLOWED_EMAIL_SUFFIX
允许的邮箱后缀，多个后缀用逗号分隔，例如
@example.com,@example.org

CLOUDFLARE_API_TOKEN
cfat_开头的密钥字符串
必须拥有编辑账户内所有域名DNS的权限（Zone DNS:Edit）

CLOUDFLARE_ZONE_MAP
{"example.com":"zoneid"}
json格式，域名及对应zoneid

JWT_SECRET
随机一串加密字符串即可

MAIN_DOMAINS
["example.com"]
提供的域名，可以多个

MAX_RECORDS_PER_USER
允许每个用户最多绑定的域名数量，例如
10

RESEND_API_KEY
re_开头的密钥字符串

RESEND_FROM_EMAIL
Resend发送邮件的邮箱，例如
noreply@mail.example.com
```

关于 Resend：

验证域名的时候留心他让你填的 dns 记录的值，如果你是托管在 cf 的二级域名，需要在他给的值（他会给根域名）里改成你的二级域名

---

前端：更改 `index.html` 里的两处 `你的后端域名` 。打包 `index.html` 为 `.zip` 文件并上传至 pages