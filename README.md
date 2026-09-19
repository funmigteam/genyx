# GENYX

> A Telegram-first growth platform with packages, binary rewards, internal wallets, task rewards, and on-chain USDT payments on TON.

[![Platform](https://img.shields.io/badge/platform-Telegram%20Mini%20App-26A5E4?logo=telegram&logoColor=white)](https://telegram.org/)
[![Network](https://img.shields.io/badge/network-TON-0098EA?logo=ton&logoColor=white)](https://ton.org/)
[![Stack](https://img.shields.io/badge/stack-Next.js%20%2B%20Fastify-black)](#technology)
[![Maintained by Funmig](https://img.shields.io/badge/maintained%20by-Funmig-181717?logo=github)](https://github.com/funmigteam)

**EN** · [فارسی](#فارسی)

## Overview

GENYX is a production-oriented Telegram Mini App for community growth and reward operations. It combines package activation, referral and binary-network logic, an auditable internal ledger, missions, lotteries, user wallets, and TON USDT payment reconciliation in one platform.

Financial state changes are performed on the server, recorded in an append-only double-entry ledger, and kept separate from the user interface.

## Highlights

- Telegram Mini App authentication with validated `initData`
- TON Connect checkout and automatic USDT payment reconciliation
- Package catalog, price settings, discounts, activation controls, and cycle-based presentation
- Referral tree and binary placement with 20% commission rules
- Internal USDT and GEN wallets with immutable ledger entries
- Manual withdrawal review workflow with audit history
- Lottery halls, internal-wallet entry fees, bids, winner awards, and automatic series progression
- Daily gifts, missions, claim verification, XP, and GEN rewards
- Role-based admin panel for users, tasks, packages, lotteries, payments, and settings
- PostgreSQL, Redis, Docker Compose, Caddy, and production deployment configuration

## Technology

| Layer | Tools |
| --- | --- |
| Web app | Next.js 15, React 19, TypeScript |
| API | Fastify 5, Zod, JWT |
| Database | PostgreSQL, Prisma |
| Cache / workers | Redis, in-process worker runner |
| TON | TON Connect, `@ton/ton`, TonAPI |
| Delivery | Docker Compose, Caddy |

## Repository layout

```text
apps/
├── api/                 # Fastify API, Prisma schema, payment and reward workers
│   ├── prisma/          # Database schema and migrations
│   └── src/
│       ├── domain/      # Business rules and financial policies
│       └── services/    # Ledger, payments, lotteries, withdrawals and API routes
└── web/                 # Telegram Mini App built with Next.js
deploy/                  # Server bootstrap and deployment notes
docs/                    # Operational documentation
docker-compose*.yml      # Local and production orchestration
```

## Quick start

### Requirements

- Node.js 22+
- Docker and Docker Compose
- A PostgreSQL-compatible environment
- Telegram bot token and TON configuration for live payments

### Local development

```bash
cp .env.example .env
npm install
npm run db:generate
docker compose up -d postgres redis
npm --workspace @genyx/api run prisma:migrate -- --name init
npm run dev:api
```

In a second terminal:

```bash
npm run dev:web
```

### Validate before deployment

```bash
npm run build
npm test
```

## Environment configuration

Never commit `.env`, `.env.production`, mnemonic files, bot tokens, API keys, database backups, or production exports.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | API session signing secret |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `APP_ORIGIN` | Public Mini App origin |
| `TONCONNECT_MANIFEST_URL` | Public TON Connect manifest URL |
| `TON_USDC_MASTER_ADDRESS` | USDT Jetton master address |
| `PLATFORM_TREASURY_ADDRESS` | Receiving treasury wallet |
| `TONAPI_KEY` | TonAPI key used for payment lookup |
| `AUTOMATION_ENABLED` | Enables payment reconciliation worker |
| `AUTOMATION_POLL_INTERVAL_MS` | Worker interval in milliseconds |

For mainnet, use a real TonAPI key, a funded treasury wallet, and the official USDT Jetton master address. Rotate any secret that has appeared in a screenshot, terminal capture, chat, commit, or public log.

## Payment lifecycle

1. The user opens a package or wallet top-up checkout.
2. The app creates a unique payment intent and TON Connect request.
3. The user signs the transfer in their wallet.
4. The worker verifies the exact USDT transfer, recipient Jetton wallet, amount, and invoice comment on TON.
5. The payment becomes `CONFIRMED` exactly once and its package or wallet credit is applied atomically.

The user does **not** need to paste a transaction hash. Payment confirmation depends on blockchain verification, not a browser claim.

## Financial design

- Monetary values are stored in atomic units; USDT uses six decimal places.
- Ledger updates are double-entry and append-only.
- User wallet balances are calculated from ledger entries.
- Package activation, rewards, commissions, lottery awards, and withdrawals are server-side operations.
- On-chain withdrawal is an operator-reviewed process unless an explicitly approved automated payout flow is enabled.

## Production deployment

From your development machine:

```bash
rsync -avz --progress \
  --exclude '.env' \
  --exclude '.env.production' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.git' \
  ./ root@YOUR_SERVER:/opt/genyx/
```

On the server:

```bash
cd /opt/genyx
docker compose --env-file .env.production \
  -f docker-compose.production.yml up -d --build
```

Check service health:

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml ps
```

## Operational notes

- Back up PostgreSQL before data resets or schema changes.
- Do not use destructive database commands without a verified backup.
- Keep payment automation enabled only after treasury address, USDT master address, and TonAPI credentials are verified.
- Review production logs and pending payments before changing wallet or payment settings.

## Security

- Do not expose bot tokens, TonAPI keys, wallet seed phrases, private keys, or database credentials.
- Validate Telegram `initData` only on the API server.
- Treat client-provided transaction hashes and amounts as untrusted data.
- Restrict admin Telegram IDs in production.
- Rotate exposed credentials immediately.

## Maintainer

Developed and maintained by [Funmig Team](https://github.com/funmigteam).

---

<a id="فارسی"></a>

# فارسی

> **GENYX** یک مینی‌اپ تلگرام برای رشد کامیونیتی، فروش پکیج، کیف پول داخلی، شبکه باینری، تسک، لاتاری و پرداخت USDT روی شبکه TON است.

## معرفی

GENYX یک پلتفرم عملیاتی برای مدیریت مسیر رشد کاربران در تلگرام است. تمام منطق‌های مالی، از جمله خرید پکیج، اعتبار کیف پول، پاداش، پورسانت، جوایز لاتاری و برداشت، در سمت سرور و با دفترکل حسابداری ثبت می‌شوند؛ بنابراین رابط کاربری به‌تنهایی نمی‌تواند موجودی یا وضعیت مالی را تغییر دهد.

## قابلیت‌ها

- ورود امن با Telegram Mini App و اعتبارسنجی `initData`
- پرداخت با Tonkeeper / TON Connect و تأیید خودکار پرداخت USDT
- پکیج‌های قابل تنظیم، تخفیف، فعال/غیرفعال‌سازی و نمایش بر اساس Cycle
- سیستم معرفی، درخت شبکه و باینری با منطق پورسانت ۲۰٪
- کیف پول داخلی USDT و GEN با دفترکل دوبل و قابل حسابرسی
- مدیریت برداشت به‌صورت دستی همراه با تاریخچه و بررسی ادمین
- لاتاری با هزینه ورود از کیف پول داخلی، ثبت پیشنهاد، جایزه و پیشروی خودکار اتاق‌ها
- تسک، دیلی گیفت، XP، GEN و سیستم Claim قابل بررسی
- پنل ادمین برای کاربران، پکیج‌ها، پرداخت‌ها، تسک‌ها، لاتاری، تنظیمات و گزارش‌ها
- آماده اجرا با PostgreSQL، Redis، Docker Compose و Caddy

## ساختار پروژه

```text
apps/api   API، منطق کسب‌وکار، Prisma، حسابداری و Workerها
apps/web   مینی‌اپ تلگرام با Next.js
deploy     فایل‌ها و راهنمای استقرار سرور
docs       مستندات عملیاتی
```

## اجرای محلی

```bash
cp .env.example .env
npm install
npm run db:generate
docker compose up -d postgres redis
npm --workspace @genyx/api run prisma:migrate -- --name init
npm run dev:api
```

برای اجرای رابط کاربری در ترمینال دوم:

```bash
npm run dev:web
```

## متغیرهای مهم محیطی

| متغیر | کاربرد |
| --- | --- |
| `DATABASE_URL` | اتصال دیتابیس PostgreSQL |
| `REDIS_URL` | اتصال Redis |
| `JWT_SECRET` | کلید امضای نشست API |
| `TELEGRAM_BOT_TOKEN` | توکن بات تلگرام |
| `APP_ORIGIN` | دامنه عمومی مینی‌اپ |
| `TONCONNECT_MANIFEST_URL` | آدرس Manifest مربوط به TON Connect |
| `TON_USDC_MASTER_ADDRESS` | آدرس Master جت‌تون USDT |
| `PLATFORM_TREASURY_ADDRESS` | ولت خزانه دریافت‌کننده |
| `TONAPI_KEY` | کلید TonAPI برای بررسی تراکنش‌ها |
| `AUTOMATION_ENABLED` | فعال‌سازی Worker تأیید پرداخت |
| `AUTOMATION_POLL_INTERVAL_MS` | فاصله بررسی پرداخت‌ها بر حسب میلی‌ثانیه |

فایل‌های `.env`، کلیدها، عبارت بازیابی، بکاپ دیتابیس و هرگونه Secret نباید در GitHub قرار بگیرند.

## روند تأیید پرداخت

1. کاربر برای خرید پکیج یا شارژ کیف پول، درخواست پرداخت ایجاد می‌کند.
2. مبلغ و شناسه پرداخت در Tonkeeper امضا و ارسال می‌شود.
3. Worker تراکنش USDT را روی TON بررسی می‌کند.
4. مبلغ، مقصد، جت‌تون‌ولت خزانه و شناسه پرداخت باید دقیقاً با فاکتور برابر باشند.
5. پرداخت فقط یک‌بار تأیید می‌شود و پکیج یا موجودی کاربر به‌صورت اتمیک ثبت می‌گردد.

کاربر نیازی به واردکردن هش تراکنش ندارد؛ تأیید از طریق بررسی مستقیم بلاکچین انجام می‌شود.

## استقرار روی سرور

از سیستم توسعه:

```bash
rsync -avz --progress \
  --exclude '.env' \
  --exclude '.env.production' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.git' \
  ./ root@YOUR_SERVER:/opt/genyx/
```

روی سرور:

```bash
cd /opt/genyx
docker compose --env-file .env.production \
  -f docker-compose.production.yml up -d --build
```

## اصول مالی و امنیتی

- USDT با واحد اتمیک شش اعشار ثبت می‌شود.
- تمام تغییرات مالی در دفترکل دوبل و تغییرناپذیر ذخیره می‌شوند.
- موجودی کیف پول از دفترکل محاسبه می‌شود.
- تأیید پرداخت، پاداش، پورسانت، لاتاری و برداشت در سمت سرور انجام می‌شود.
- هر Secret که در چت، اسکرین‌شات یا لاگ عمومی دیده شده باید فوراً تغییر کند.

## نگهداری

توسعه و نگهداری: [Funmig Team](https://github.com/funmigteam)
