"use client";
import { Overview } from "./overview";
import { FinancePanel } from "./finance-panel";
import { AutomationPanel } from "./automation-panel";

import { FormEvent, useEffect, useState } from "react";
import "./admin.css";
import { TaskEditor } from "./task-editor";
import { TaskManagement } from "./task-management";
import { ProgressReset } from "./progress-reset";
import { MemberControls } from "./member-controls";
import { DatabaseReset } from "./database-reset";
import { SupportPanel } from "../member-menu";
import "./admin-enhanced.css";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type Task = {
  id: string;
  title: string;
  kind: string;
  dayNumber?: number;
  startsAt: string;
  status: string;
  _count?: { claims: number };
};
type User = {
  id: string;
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  displayName?: string | null;
  activePackageCode?: string | null;
  xp?: string;
  vouchers?: number;
  totalDeposited?: string;
  totalWithdrawn?: string;
  maxCap?: string;
  capConsumed?: string;
  botStarts: number;
  lastStartedAt?: string | null;
  role: string;
  createdAt: string;
  _count?: {
    referrals: number;
    shopPurchases: number;
    auctionEntryPasses: number;
  };
};
type Package = {
  code: string;
  active?: boolean;
  economicUsdc: string;
  gen: number;
  maxCapUsdt?: string;
  discountPercent?: number;
  title?: string;
  description?: string;
  features?: string[];
  terms?: string;
};
type ShopItem = {
  id: string;
  sku: string;
  title: string;
  description?: string | null;
  category: string;
  genPrice: number;
  voucherPrice: number;
  usdtPrice?: string;
  rewardGen?: number;
  rewardVouchers?: number;
  durationMinutes: number;
  imageKey?: string;
  active: boolean;
};
type Channel = {
  id: string;
  chatId: string;
  title: string;
  inviteUrl: string;
  active: boolean;
  _count?: { memberships: number };
};

export default function AdminPage() {
  const [savedToken, setSavedToken] = useState("");
  const [role, setRole] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [notice, setNotice] = useState(
    "برای دسترسی به مدیریت، هویت تلگرام را تأیید کنید.",
  );
  const [form, setForm] = useState({
    title: "",
    description: "",
    actionUrl: "",
    kind: "EXTERNAL_LINK",
    rewardGen: "0",
    rewardXp: "20",
    startsAt: new Date().toISOString().slice(0, 16),
    status: "PUBLISHED",
  });
  const [shopForm, setShopForm] = useState({
    sku: "",
    title: "",
    description: "",
    category: "BOOST",
    genPrice: "0",
    voucherPrice: "0",
    usdtPrice: "0",
    rewardGen: "0",
    rewardVouchers: "0",
    durationMinutes: "0",
    imageKey: "spark",
  });
  const [channelForm, setChannelForm] = useState({
    chatId: "",
    title: "",
    inviteUrl: "",
  });
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${savedToken}`);
    if (init?.body && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reference =
        typeof data.requestId === "string"
          ? ` (کد پیگیری: ${data.requestId})`
          : "";
      throw new Error(`${data.error ?? "Request failed"}${reference}`);
    }
    return data;
  };
  const authenticateWithTelegram = async () => {
    const initData = (
      window as typeof window & {
        Telegram?: { WebApp?: { initData?: string; ready?: () => void } };
      }
    ).Telegram?.WebApp?.initData;
    const launchParams = new URLSearchParams(
      location.hash.startsWith("#") ? location.hash.slice(1) : location.hash,
    );
    const verifiedInitData = initData || launchParams.get("tgWebAppData") || "";
    if (!verifiedInitData) {
      setNotice(
        "این صفحه را از مینی‌اپ بات GENYX باز کنید؛ هویت تلگرام برای ورود مدیر لازم است.",
      );
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/v1/auth/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: verifiedInitData }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          `${data.error ?? "Telegram authentication failed"}${typeof data.requestId === "string" ? ` (کد پیگیری: ${data.requestId})` : ""}`,
        );
      if (
        !["SUPER_ADMIN", "CONTENT_ADMIN", "FINANCE_ADMIN"].includes(
          data.user.role,
        )
      )
        throw new Error("حساب تلگرام شما دسترسی مدیریت ندارد.");
      setRole(data.user.role);
      setSavedToken(data.token);
      setNotice("هویت تأیید شد؛ در حال دریافت اطلاعات…");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Telegram authentication failed.",
      );
    }
  };
  const refresh = async () => {
    try {
      const [nextTasks, nextUsers, nextPackages, nextShop, nextChannels] =
        await Promise.all([
          request<Task[]>("/v1/admin/tasks"),
          request<User[]>("/v1/admin/users"),
          request<Package[]>("/v1/admin/package-catalog"),
          request<ShopItem[]>("/v1/admin/shop-items"),
          request<Channel[]>("/v1/admin/channels"),
        ]);
      setTasks(Array.isArray(nextTasks) ? nextTasks : []);
      setUsers(Array.isArray(nextUsers) ? nextUsers : []);
      setPackages(Array.isArray(nextPackages) ? nextPackages : []);
      setShopItems(Array.isArray(nextShop) ? nextShop : []);
      setChannels(Array.isArray(nextChannels) ? nextChannels : []);
      setNotice("اطلاعات مدیریت دریافت شد.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "دریافت اطلاعات مدیریت ناموفق بود.",
      );
    }
  };
  useEffect(() => {
    if (savedToken) void refresh();
  }, [savedToken]);
  const submitTask = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await request<Task>("/v1/admin/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          rewardGen: Number(form.rewardGen),
          rewardXp: Number(form.rewardXp),
          startsAt: new Date(form.startsAt).toISOString(),
        }),
      });
      setForm({ ...form, title: "", description: "", actionUrl: "" });
      setNotice(
        "Task saved. Future tasks are visible but remain locked until their start time.",
      );
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not save task.",
      );
    }
  };
  const savePackages = async () => {
    try {
      await request("/v1/admin/packages", {
        method: "PUT",
        body: JSON.stringify(
          packages.map((item) => ({
            ...item,
            features: item.features
              ?.map((feature) => feature.trim())
              .filter(Boolean),
          })),
        ),
      });
      setNotice(
        "پکیج‌ها ذخیره شدند. فروشگاه تا ۳۰ ثانیه به‌روز می‌شود؛ سفارش‌های جدید قیمت تازه دارند و سفارش‌های معتبر قبلی قیمت ثبت‌شده خود را حفظ می‌کنند.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not save prices.",
      );
    }
  };
  const shopPayload = (item: typeof shopForm | ShopItem) => ({
    ...item,
    sku: item.sku.toUpperCase(),
    genPrice: Number(item.genPrice),
    voucherPrice: Number(item.voucherPrice),
    usdtPrice: String(item.usdtPrice ?? "0"),
    rewardGen: Number(item.rewardGen ?? 0),
    rewardVouchers: Number(item.rewardVouchers ?? 0),
    durationMinutes: Number(item.durationMinutes),
    imageKey: item.imageKey ?? "spark",
  });
  const createShopItem = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await request("/v1/admin/shop-items", {
        method: "POST",
        body: JSON.stringify({
          ...shopPayload(shopForm),
          active: true,
          sortOrder: shopItems.length + 1,
        }),
      });
      setShopForm({
        sku: "",
        title: "",
        description: "",
        category: "BOOST",
        genPrice: "0",
        voucherPrice: "0",
        usdtPrice: "0",
        rewardGen: "0",
        rewardVouchers: "0",
        durationMinutes: "0",
        imageKey: "spark",
      });
      setNotice("آیتم فروشگاه ساخته شد.");
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not create shop item.",
      );
    }
  };
  const updateShopItem = async (item: ShopItem, form: HTMLFormElement) => {
    try {
      const f = new FormData(form);
      await request(`/v1/admin/shop-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...shopPayload({
            ...item,
            title: String(f.get("title")),
            description: String(f.get("description") || ""),
            category: String(f.get("category")),
            genPrice: Number(f.get("genPrice")),
            voucherPrice: Number(f.get("voucherPrice")),
            usdtPrice: String(f.get("usdtPrice")),
            rewardGen: Number(f.get("rewardGen")),
            rewardVouchers: Number(f.get("rewardVouchers")),
            durationMinutes: Number(f.get("durationMinutes")),
            imageKey: String(f.get("imageKey") || "spark"),
          }),
          active: f.get("active") === "on",
        }),
      });
      setNotice("آیتم فروشگاه ویرایش شد.");
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "ویرایش آیتم ناموفق بود.",
      );
    }
  };
  const createChannel = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await request("/v1/admin/channels", {
        method: "POST",
        body: JSON.stringify({
          ...channelForm,
          active: true,
          sortOrder: channels.length + 1,
        }),
      });
      setChannelForm({ chatId: "", title: "", inviteUrl: "" });
      setNotice("کانال ذخیره شد. برای بررسی عضویت، بات را مدیر کانال کنید.");
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not save channel.",
      );
    }
  };
  return (
    <main className="admin-shell" dir="rtl" lang="fa">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <b>G</b>
          <div>
            <strong>GENYX</strong>
            <small>پنل مدیریت</small>
          </div>
        </div>
        <nav>
          <span>نمای کلی</span>
          <a href="#dashboard">داشبورد</a>
          <span>عملیات</span>
          <a href="#tasks">تسک‌ها</a>
          <a href="#packages">پکیج‌ها</a>
          <a href="#shop">شاپ</a>
          <a href="#channels">کانال‌ها</a>
          <a href="#auction-rooms">مزایده</a>
          <a href="#users">کاربران</a>
          <a href="#finance">مالی</a>
        </nav>
      </aside>
      <section className="admin-main">
        <header className="admin-top" id="dashboard">
          <div>
            <span>GENYX CONTROL</span>
            <h1>پنل مدیریت GENYX</h1>
            <p>مدیریت پکیج‌ها، تسک‌های روزانه، شاپ و کانال‌ها</p>
          </div>
          <div className="admin-auth">
            <button onClick={authenticateWithTelegram}>
              {savedToken ? "هویت تأیید شد" : "ورود با تلگرام"}
            </button>
          </div>
        </header>
        <p className="admin-notice" role="status">
          {notice}
        </p>
        {savedToken && ["SUPER_ADMIN", "FINANCE_ADMIN"].includes(role) && (
          <FinancePanel token={savedToken} />
        )}
        {savedToken && (
          <Overview token={savedToken} superAdmin={role === "SUPER_ADMIN"} />
        )}
        {savedToken && role === "SUPER_ADMIN" && (
          <AutomationPanel token={savedToken} />
        )}
        {savedToken && ["SUPER_ADMIN", "CONTENT_ADMIN"].includes(role) && (
          <TaskManagement request={request} tasks={tasks} changed={refresh} />
        )}
        {savedToken && role === "SUPER_ADMIN" && (
          <ProgressReset request={request} />
        )}
        {savedToken && role === "SUPER_ADMIN" && (
          <DatabaseReset request={request} />
        )}
        {savedToken && role === "SUPER_ADMIN" && (
          <MemberControls request={request} />
        )}
        {savedToken && ["SUPER_ADMIN", "CONTENT_ADMIN"].includes(role) && (
          <SupportPanel request={request} admin />
        )}
        <fieldset
          disabled={!savedToken || role === "FINANCE_ADMIN"}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <section className="admin-grid">
            <TaskEditor request={request} changed={refresh} />
            <article className="admin-card" id="packages">
              <span>قیمت پکیج‌ها</span>
              <h2>قیمت و توضیحات فروشگاه</h2>
              <div className="admin-package-editor">
                {packages.map((item, index) => {
                  const update = (values: Partial<Package>) =>
                    setPackages((current) =>
                      current.map((entry, position) =>
                        position === index ? { ...entry, ...values } : entry,
                      ),
                    );
                  return (
                    <section key={item.code}>
                      <h3>{item.title || item.code}</h3>
                      <small>{item.code}</small>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.active !== false}
                          onChange={(e) => update({ active: e.target.checked })}
                        />
                        فعال برای خرید جدید
                      </label>
                      <label>
                        عنوان نمایشی
                        <input
                          maxLength={100}
                          value={item.title ?? ""}
                          onChange={(event) =>
                            update({ title: event.target.value })
                          }
                          placeholder={item.code}
                        />
                      </label>
                      <label>
                        مکس کپ USDT
                        <input
                          type="number"
                          min="0.000001"
                          step="0.000001"
                          value={item.maxCapUsdt ?? ""}
                          onChange={(e) =>
                            update({ maxCapUsdt: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        تخفیف سهم غیرمالک (درصد؛ خالی = افتتاحیه)
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={item.discountPercent ?? ""}
                          onChange={(e) =>
                            update({
                              discountPercent:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>{" "}
                      <div className="admin-two">
                        <label>
                          قیمت USDT
                          <input
                            type="number"
                            min="0.000001"
                            max="1000000"
                            step="0.000001"
                            value={item.economicUsdc}
                            onChange={(event) =>
                              update({ economicUsdc: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          مقدار GEN
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={item.gen}
                            onChange={(event) =>
                              update({ gen: Number(event.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        توضیحات کامل
                        <textarea
                          maxLength={4000}
                          value={item.description ?? ""}
                          onChange={(event) =>
                            update({ description: event.target.value })
                          }
                          placeholder="توضیحات دقیق پکیج را به انگلیسی وارد کنید."
                        />
                      </label>
                      <label>
                        امکانات — هر مورد در یک خط
                        <textarea
                          value={(item.features ?? []).join("\n")}
                          onChange={(event) =>
                            update({ features: event.target.value.split("\n") })
                          }
                          placeholder="هر مزیت به انگلیسی در یک خط"
                        />
                      </label>
                      <label>
                        شرایط
                        <textarea
                          maxLength={4000}
                          value={item.terms ?? ""}
                          onChange={(event) =>
                            update({ terms: event.target.value })
                          }
                          placeholder="شرایط و محدودیت‌ها به انگلیسی"
                        />
                      </label>
                    </section>
                  );
                })}
              </div>
              <button
                className="admin-primary"
                onClick={savePackages}
                disabled={role !== "SUPER_ADMIN"}
              >
                ذخیره پکیج‌ها
              </button>
            </article>
          </section>
        </fieldset>
        <fieldset
          disabled={!savedToken || role === "FINANCE_ADMIN"}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <section className="admin-grid">
            <article className="admin-card" id="shop">
              <span>فروشگاه</span>
              <h2>آیتم‌های قابل خرید و پاداش</h2>
              <form onSubmit={createShopItem}>
                <label>
                  SKU
                  <input
                    required
                    value={shopForm.sku}
                    onChange={(event) =>
                      setShopForm({ ...shopForm, sku: event.target.value })
                    }
                    placeholder="TASK_TIME_30"
                  />
                </label>
                <label>
                  عنوان
                  <input
                    required
                    value={shopForm.title}
                    onChange={(event) =>
                      setShopForm({ ...shopForm, title: event.target.value })
                    }
                    placeholder="30 minute task window"
                  />
                </label>
                <label>
                  توضیحات
                  <input
                    value={shopForm.description}
                    onChange={(event) =>
                      setShopForm({
                        ...shopForm,
                        description: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="admin-two">
                  <label>
                    قیمت GEN
                    <input
                      type="number"
                      min="0"
                      value={shopForm.genPrice}
                      onChange={(event) =>
                        setShopForm({
                          ...shopForm,
                          genPrice: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    قیمت ووچر
                    <input
                      type="number"
                      min="0"
                      value={shopForm.voucherPrice}
                      onChange={(event) =>
                        setShopForm({
                          ...shopForm,
                          voucherPrice: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    قیمت USDT (از کیف پول داخلی)
                    <input
                      type="number"
                      min="0"
                      step="0.000001"
                      value={shopForm.usdtPrice}
                      onChange={(event) =>
                        setShopForm({
                          ...shopForm,
                          usdtPrice: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="admin-two">
                  <label>
                    پاداش GEN پس از خرید
                    <input
                      type="number"
                      min="0"
                      value={shopForm.rewardGen}
                      onChange={(event) =>
                        setShopForm({
                          ...shopForm,
                          rewardGen: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    پاداش ووچر پس از خرید
                    <input
                      type="number"
                      min="0"
                      value={shopForm.rewardVouchers}
                      onChange={(event) =>
                        setShopForm({
                          ...shopForm,
                          rewardVouchers: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <label>
                  نوع آیتم
                  <select
                    value={shopForm.category}
                    onChange={(event) =>
                      setShopForm({ ...shopForm, category: event.target.value })
                    }
                  >
                    <option value="BOOST">XP Boost</option>
                    <option value="PROFILE">Custom profile</option>
                    <option value="TIME">Task time</option>
                    <option value="VOUCHER">Voucher</option>
                    <option value="GEN">GEN</option>
                    <option value="LOTTERY">Lottery pack</option>
                  </select>
                </label>
                <label>
                  کلید ظاهر/استایل
                  <input
                    value={shopForm.imageKey}
                    maxLength={30}
                    onChange={(event) =>
                      setShopForm({ ...shopForm, imageKey: event.target.value })
                    }
                    placeholder="frame-gold"
                  />
                </label>
                <label>
                  مدت (دقیقه)
                  <input
                    type="number"
                    min="0"
                    value={shopForm.durationMinutes}
                    onChange={(event) =>
                      setShopForm({
                        ...shopForm,
                        durationMinutes: event.target.value,
                      })
                    }
                  />
                </label>
                <button className="admin-primary">افزودن آیتم</button>
              </form>
              <div className="admin-table">
                {shopItems.map((item) => (
                  <details key={item.id}>
                    <summary>
                      <b>{item.title}</b> · {item.active ? "فعال" : "غیرفعال"}
                    </summary>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void updateShopItem(item, event.currentTarget);
                      }}
                    >
                      <label>
                        عنوان
                        <input
                          name="title"
                          required
                          defaultValue={item.title}
                        />
                      </label>
                      <label>
                        توضیحات
                        <input
                          name="description"
                          defaultValue={item.description ?? ""}
                        />
                      </label>
                      <label>
                        نوع
                        <select name="category" defaultValue={item.category}>
                          <option value="BOOST">XP Boost</option>
                          <option value="PROFILE">Custom profile</option>
                          <option value="TIME">Task time</option>
                          <option value="VOUCHER">Voucher</option>
                          <option value="GEN">GEN</option>
                          <option value="LOTTERY">Lottery pack</option>
                        </select>
                      </label>
                      <div className="admin-two">
                        <label>
                          GEN
                          <input
                            name="genPrice"
                            type="number"
                            min="0"
                            defaultValue={item.genPrice}
                          />
                        </label>
                        <label>
                          ووچر
                          <input
                            name="voucherPrice"
                            type="number"
                            min="0"
                            defaultValue={item.voucherPrice}
                          />
                        </label>
                        <label>
                          USDT
                          <input
                            name="usdtPrice"
                            type="number"
                            min="0"
                            step="0.000001"
                            defaultValue={
                              Number(item.usdtPrice ?? 0) / 1_000_000
                            }
                          />
                        </label>
                      </div>
                      <div className="admin-two">
                        <label>
                          پاداش GEN
                          <input
                            name="rewardGen"
                            type="number"
                            min="0"
                            defaultValue={item.rewardGen ?? 0}
                          />
                        </label>
                        <label>
                          پاداش ووچر
                          <input
                            name="rewardVouchers"
                            type="number"
                            min="0"
                            defaultValue={item.rewardVouchers ?? 0}
                          />
                        </label>
                      </div>
                      <label>
                        مدت دقیقه
                        <input
                          name="durationMinutes"
                          type="number"
                          min="0"
                          defaultValue={item.durationMinutes}
                        />
                      </label>
                      <label>
                        کلید ظاهر
                        <input
                          name="imageKey"
                          defaultValue={item.imageKey ?? "spark"}
                        />
                      </label>
                      <label>
                        <input
                          name="active"
                          type="checkbox"
                          defaultChecked={item.active}
                        />{" "}
                        فعال برای خرید
                      </label>
                      <button className="admin-primary">ذخیره تغییرات</button>
                    </form>
                  </details>
                ))}
              </div>
            </article>
            <article className="admin-card" id="channels">
              <span>کانال‌های اجباری</span>
              <h2>عضویت اجباری</h2>
              <form onSubmit={createChannel}>
                <label>
                  شناسه کانال
                  <input
                    required
                    value={channelForm.chatId}
                    onChange={(event) =>
                      setChannelForm({
                        ...channelForm,
                        chatId: event.target.value,
                      })
                    }
                    placeholder="@genyx_official or -100..."
                  />
                </label>
                <label>
                  نام کانال
                  <input
                    required
                    value={channelForm.title}
                    onChange={(event) =>
                      setChannelForm({
                        ...channelForm,
                        title: event.target.value,
                      })
                    }
                    placeholder="GENYX Official"
                  />
                </label>
                <label>
                  لینک عضویت
                  <input
                    required
                    type="url"
                    value={channelForm.inviteUrl}
                    onChange={(event) =>
                      setChannelForm({
                        ...channelForm,
                        inviteUrl: event.target.value,
                      })
                    }
                    placeholder="https://t.me/..."
                  />
                </label>
                <button className="admin-primary">ذخیره کانال</button>
              </form>
              <p className="admin-help">
                برای بررسی واقعی عضویت، بات باید مدیر هر کانال باشد.
              </p>
              <div className="admin-table">
                {channels.map((channel) => (
                  <article key={channel.id}>
                    <div>
                      <b>{channel.title}</b>
                      <small>
                        {channel.chatId} · {channel._count?.memberships ?? 0}{" "}
                        رکورد عضویت
                      </small>
                    </div>
                    <span className="status">
                      {channel.active ? "فعال" : "غیرفعال"}
                    </span>
                  </article>
                ))}
              </div>
            </article>
          </section>
          <section className="admin-card admin-wide">
            <span>تسک‌ها</span>
            <h2>مدیریت تسک‌های روزانه</h2>
            <div className="admin-table">
              {tasks.length === 0 ? (
                <p>هنوز تسکی ثبت نشده است.</p>
              ) : (
                tasks.map((task) => (
                  <article key={task.id}>
                    <div>
                      <b>{task.title}</b>
                      <small>
                        {task.kind.replaceAll("_", " ")} ·{" "}
                        {task.dayNumber
                          ? `روز ${task.dayNumber}`
                          : "روزانه / قدیمی"}
                      </small>
                    </div>
                    <span className={`status ${task.status.toLowerCase()}`}>
                      {task.status}
                    </span>
                    <small>{task._count?.claims ?? 0} claims</small>
                  </article>
                ))
              )}
            </div>
          </section>
          <section className="admin-card admin-wide">
            <span id="users">کاربران تلگرام</span>
            <h2>کاربران ثبت‌شده</h2>
            <div className="admin-table">
              {users.length === 0 ? (
                <p>کاربران پس از ورود تأییدشده تلگرام نمایش داده می‌شوند.</p>
              ) : (
                users.map((user) => (
                  <article key={user.id}>
                    <details>
                      <summary>
                        <b>
                          {user.displayName ??
                            user.firstName ??
                            "Telegram user"}{" "}
                          {user.username ? `@${user.username}` : ""}
                        </b>{" "}
                        · {user.role}
                      </summary>
                      <p>
                        Telegram ID: {user.telegramId} · Starts:{" "}
                        {user.botStarts} · Joined:{" "}
                        {new Date(user.createdAt).toLocaleDateString()}
                      </p>
                      <p>
                        Package: {user.activePackageCode ?? "ندارد"} · XP:{" "}
                        {user.xp ?? 0} · Vouchers: {user.vouchers ?? 0}
                      </p>
                      <p>
                        Deposit: {Number(user.totalDeposited ?? 0) / 1_000_000}{" "}
                        USDT · Withdrawn:{" "}
                        {Number(user.totalWithdrawn ?? 0) / 1_000_000} USDT
                      </p>
                      <p>
                        Max cap: {Number(user.capConsumed ?? 0) / 1_000_000} /{" "}
                        {Number(user.maxCap ?? 0) / 1_000_000} USDT
                      </p>
                      <p>
                        Direct referrals: {user._count?.referrals ?? 0} · Shop
                        purchases: {user._count?.shopPurchases ?? 0} · Lottery
                        passes: {user._count?.auctionEntryPasses ?? 0}
                      </p>
                    </details>
                  </article>
                ))
              )}
            </div>
          </section>
        </fieldset>
      </section>
    </main>
  );
}
