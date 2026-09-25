"use client";
import { useEffect, useRef, useState } from "react";
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Task = {
  id: string;
  title: string;
  status: string;
  dayNumber?: number | null;
  kind?: string;
  description?: string | null;
  actionUrl?: string | null;
  channelChatId?: string | null;
  gameKey?: string | null;
  targetValue?: number;
  rewardGen?: number;
  rewardXp?: number;
  rewardUsdt?: string | number;
};
type Claim = {
  id: string;
  taskId: string;
  userId: string;
  quotedGen: string | number;
  quotedXp: string | number;
  quotedUsdt: string | number;
};
export function TaskManagement({
  request,
  tasks,
  changed,
}: {
  request: Request;
  tasks: Task[];
  changed: () => Promise<void>;
}) {
  const [claims, setClaims] = useState<Claim[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const pending = useRef(false);
  const refresh = async () => {
    try {
      setClaims(await request<Claim[]>("/v1/admin/task-claims"));
    } catch {
      setMessage("دریافت صف بررسی ناموفق بود. دوباره تلاش کنید.");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  async function mutate(path: string, method: string, body?: unknown) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await request(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setMessage("عملیات ثبت شد.");
      await changed();
      await refresh();
    } catch (e) {
      setMessage(
        `عملیات انجام نشد: ${e instanceof Error ? e.message : "خطای ارتباط"}`,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const listedTasks = tasks
    .filter(
      (task) =>
        task.status !== "ARCHIVED" &&
        `${task.title} ${task.id}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (first, second) =>
        (first.dayNumber ?? 99) - (second.dayNumber ?? 99) ||
        first.title.localeCompare(second.title),
    );
  return (
    <section className="admin-card admin-wide" aria-busy={busy}>
      <h2>کنترل انتشار و بررسی تسک‌ها</h2>
      <button
        type="button"
        className="admin-danger"
        disabled={busy}
        onClick={() => {
          if (
            window.confirm(
              "تسک‌های دیفالت اولیه آرشیو شوند؟ سوابق پاداش حفظ می‌شود.",
            )
          )
            void mutate("/v1/admin/tasks/archive-defaults", "POST");
        }}
      >
        حذف تسک‌های دیفالت
      </button>
      <p>
        آرشیو، سوابق دریافت پاداش را حذف نمی‌کند. عنوان تسک برای کاربران نمایش
        داده می‌شود؛ آن را انگلیسی وارد کنید.
      </p>
      <p role="status">{message}</p>
      <label>
        جست‌وجوی عنوان یا شناسه
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      {listedTasks.map((t, index) => (
        <>
          {(!index || listedTasks[index - 1].dayNumber !== t.dayNumber) && (
            <h3 className="admin-task-day-heading">
              {t.dayNumber
                ? `تسک‌های روز ${t.dayNumber}`
                : "تسک‌های بدون روز مشخص"}
            </h3>
          )}
          <div key={t.id} className="admin-task-row">
            <details>
              <summary>
                {t.title} —{" "}
                {{
                  DRAFT: "پیش‌نویس",
                  PUBLISHED: "منتشرشده",
                  ARCHIVED: "آرشیوشده",
                }[t.status] ?? t.status}
              </summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void mutate(`/v1/admin/tasks/${t.id}`, "PATCH", {
                    title: f.get("title"),
                    status: f.get("status"),
                    description: f.get("description"),
                    kind: f.get("kind"),
                    actionUrl: f.get("actionUrl") || null,
                    channelChatId: f.get("channelChatId") || null,
                    gameKey: f.get("gameKey") || null,
                    targetValue: Number(f.get("targetValue")),
                    dayNumber: f.get("dayNumber")
                      ? Number(f.get("dayNumber"))
                      : null,
                    rewardGen: Number(f.get("rewardGen")),
                    rewardXp: Number(f.get("rewardXp")),
                    rewardUsdt: Math.round(
                      Number(f.get("rewardUsdt")) * 1000000,
                    ),
                  });
                }}
              >
                <label>
                  عنوان انگلیسی
                  <input
                    name="title"
                    defaultValue={t.title}
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  توضیحات انگلیسی
                  <textarea
                    name="description"
                    defaultValue={t.description ?? ""}
                    maxLength={600}
                  />
                </label>
                <label>
                  روش بررسی
                  <select name="kind" defaultValue={t.kind ?? "EXTERNAL_LINK"}>
                    <option value="EXTERNAL_LINK">لینک بدون بررسی تماشا</option>
                    <option value="CHANNEL_JOIN">عضویت کانال</option>
                    <option value="GROUP_OWNER_MEMBER_COUNT">
                      مالک گروه + حداقل اعضا
                    </option>
                    <option value="XP_REACHED">حداقل XP</option>
                    <option value="LEVEL_REACHED">حداقل لول</option>
                    <option value="LOTTERY_BID_COUNT">
                      تعداد پیشنهاد لاتاری
                    </option>
                    <option value="TEAM_COUNT">تعداد کل تیم فعال</option>
                    <option value="GAME_PLAYED">تعداد بازی</option>
                    <option value="DAILY_CHECKIN">حضور روزانه</option>
                    <option value="MANUAL_REVIEW">بررسی مدیر</option>
                    <option value="BINARY_AMOUNT">باینری دریافتی (USDT)</option>
                    <option value="SHOP_BOOST_COUNT">تعداد خرید XP بوست</option>
                    <option value="SHOP_PROFILE_COUNT">
                      تعداد خرید کاستوم پروفایل
                    </option>
                    <option value="SHOP_TIME_COUNT">
                      تعداد خرید وقت اضافه
                    </option>
                    <option value="DIRECT_COUNT">تعداد رفرال مستقیم</option>
                    <option value="MAX_CAP_REACHED">مکس کپ کل (USDT)</option>
                    <option value="USED_CAP_REACHED">
                      مکس کپ مصرفی (USDT)
                    </option>
                    <option value="SEASON_REACHED">شماره فصل</option>
                    <option value="CYCLES_REACHED">تعداد سایکل نقدی</option>
                    <option value="VOUCHERS_REACHED">تعداد ووچر موجود</option>
                    <option value="GEN_SPENT">GEN خرج‌شده</option>
                    <option value="DAY_REACHED">روز فعلی فصل</option>
                  </select>
                </label>
                <label>
                  لینک HTTPS
                  <input
                    name="actionUrl"
                    type="url"
                    pattern="https://.*"
                    defaultValue={t.actionUrl ?? ""}
                  />
                </label>
                <label>
                  شناسه کانال
                  <input
                    name="channelChatId"
                    defaultValue={t.channelChatId ?? ""}
                  />
                </label>
                <label>
                  شناسه بازی
                  <input
                    name="gameKey"
                    defaultValue={t.gameKey ?? ""}
                    pattern="[a-zA-Z0-9_-]{1,64}"
                  />
                </label>
                <label>
                  هدف شرط (لول حداکثر ۳۰)
                  <input
                    name="targetValue"
                    type="number"
                    required
                    min={1}
                    max={1000000000}
                    defaultValue={t.targetValue ?? 1}
                  />
                </label>
                <label>
                  روز کاربر
                  <select name="dayNumber" defaultValue={t.dayNumber ?? ""}>
                    <option value="">بدون روز مشخص (حفظ تنظیم قبلی)</option>
                    {Array.from({ length: 30 }, (_, i) => (
                      <option value={i + 1} key={i}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  پاداش GEN
                  <input
                    name="rewardGen"
                    type="number"
                    min={0}
                    max={1000000}
                    required
                    defaultValue={t.rewardGen ?? 0}
                  />
                </label>
                <label>
                  پاداش XP
                  <input
                    name="rewardXp"
                    type="number"
                    min={0}
                    max={1000000}
                    required
                    defaultValue={t.rewardXp ?? 0}
                  />
                </label>
                <label>
                  پاداش USDT
                  <input
                    name="rewardUsdt"
                    type="number"
                    min={0}
                    max={1000}
                    step="0.000001"
                    required
                    defaultValue={Number(t.rewardUsdt ?? 0) / 1000000}
                  />
                </label>
                <p>
                  انتخاب روز مشخص، تسک را روزانه می‌کند. درخواست‌های پاداش قبلی
                  مبلغ ثبت‌شده خود را حفظ می‌کنند.
                </p>
                <label>
                  وضعیت
                  <select name="status" defaultValue={t.status}>
                    <option value="DRAFT">پیش‌نویس</option>
                    <option value="PUBLISHED">منتشرشده</option>
                    <option value="ARCHIVED">آرشیوشده</option>
                  </select>
                </label>
                <button disabled={busy} className="admin-primary">
                  ذخیره تغییرات
                </button>
              </form>
            </details>
            <button
              type="button"
              className="admin-danger"
              disabled={busy || t.status === "ARCHIVED"}
              onClick={() => {
                if (
                  window.confirm(
                    `تسک «${t.title}» حذف/آرشیو شود؟ سوابق پاداش حفظ می‌شوند.`,
                  )
                )
                  void mutate(`/v1/admin/tasks/${t.id}`, "DELETE");
              }}
            >
              {t.status === "ARCHIVED" ? "آرشیو شده" : "حذف تسک"}
            </button>
          </div>
        </>
      ))}
      <h3>صف درخواست‌های بررسی‌نشده</h3>
      <button disabled={busy} onClick={refresh}>
        به‌روزرسانی صف
      </button>
      {!claims.length && <p>درخواستی برای بررسی در فهرست دریافت‌شده نیست.</p>}
      {claims.map((c) => (
        <article key={c.id}>
          <h4>{tasks.find((t) => t.id === c.taskId)?.title ?? c.taskId}</h4>
          <p>
            کاربر: <bdi>{c.userId}</bdi>
          </p>
          <p>
            {String(c.quotedGen)} GEN · {String(c.quotedXp)} XP ·{" "}
            {Number(c.quotedUsdt) / 1000000} USDT
          </p>
          <button
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "انجام تسک را بررسی کرده‌اید؟ تأیید می‌تواند پاداش حساب را ثبت کند.",
                )
              )
                void mutate(`/v1/admin/task-claims/${c.id}/approve`, "POST");
            }}
          >
            تأیید انجام و ثبت پاداش
          </button>
        </article>
      ))}
    </section>
  );
}
