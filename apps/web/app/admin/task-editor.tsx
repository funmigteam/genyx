"use client";
import { FormEvent, useRef, useState } from "react";
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
export function TaskEditor({
  request,
  changed,
}: {
  request: Request;
  changed: () => Promise<void>;
}) {
  const [kind, setKind] = useState("EXTERNAL_LINK");
  const [dayNumber, setDayNumber] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await request("/v1/admin/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          kind,
          actionUrl: form.get("actionUrl") || null,
          channelChatId: form.get("channelChatId") || null,
          gameKey: form.get("gameKey") || null,
          targetValue: Number(form.get("targetValue") || 1),
          rewardGen: Number(form.get("rewardGen")),
          rewardXp: Number(form.get("rewardXp")),
          rewardUsdt: Math.round(Number(form.get("rewardUsdt")) * 1_000_000),
          isDaily: true,
          dayNumber: Number(form.get("dayNumber")),
          status: form.get("status"),
        }),
      });
      setMessage(
        "تسک ذخیره شد. هنگام باز شدن روز مربوطه برای کاربر، در فهرست تسک‌های آن روز قرار می‌گیرد.",
      );
      await changed();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "ذخیره تسک ناموفق بود.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <article className="admin-card admin-create" id="tasks">
      <span>شرایط تسک</span>
      <h2>ساخت تسک روزانه</h2>
      <form onSubmit={submit}>
        <label>
          عنوان
          <input name="title" required maxLength={120} />
        </label>
        <label>
          روش بررسی
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="CHANNEL_JOIN">عضویت کانال — بررسی تلگرام</option>
            <option value="GROUP_OWNER_MEMBER_COUNT">
              مالک گروه + حداقل اعضا
            </option>
            <option value="EXTERNAL_LINK">
              یوتیوب یا لینک — بدون بررسی تماشا
            </option>
            <option value="XP_REACHED">رسیدن به XP</option>
            <option value="LEVEL_REACHED">رسیدن به لول</option>
            <option value="LOTTERY_BID_COUNT">
              تعداد پیشنهاد ثبت‌شده در لاتاری
            </option>
            <option value="TEAM_COUNT">تعداد کل تیم فعال</option>
            <option value="GAME_PLAYED">تعداد بازی تأییدشده</option>
            <option value="DAILY_CHECKIN">حضور روزانه</option>
            <option value="MANUAL_REVIEW">بررسی مدیر</option>
            <option value="BINARY_AMOUNT">باینری دریافتی (USDT)</option>
            <option value="SHOP_BOOST_COUNT">تعداد خرید XP بوست</option>
            <option value="SHOP_PROFILE_COUNT">
              تعداد خرید کاستوم پروفایل
            </option>
            <option value="SHOP_TIME_COUNT">تعداد خرید وقت اضافه</option>
            <option value="DIRECT_COUNT">تعداد رفرال مستقیم</option>
            <option value="MAX_CAP_REACHED">مکس کپ کل (USDT)</option>
            <option value="USED_CAP_REACHED">مکس کپ مصرفی (USDT)</option>
            <option value="SEASON_REACHED">شماره فصل</option>
            <option value="CYCLES_REACHED">تعداد سایکل نقدی</option>
            <option value="VOUCHERS_REACHED">تعداد ووچر موجود</option>
            <option value="GEN_SPENT">GEN خرج‌شده</option>
            <option value="DAY_REACHED">روز فعلی فصل</option>
          </select>
        </label>
        <label>
          لینک انجام یا عضویت
          <input
            name="actionUrl"
            type="url"
            pattern="https://.*"
            required={["CHANNEL_JOIN", "EXTERNAL_LINK"].includes(kind)}
            placeholder="https://…"
          />
        </label>
        {kind === "CHANNEL_JOIN" && (
          <label>
            شناسه کانال
            <input
              name="channelChatId"
              required
              placeholder="@channel_name / -100…"
            />
            <small>
              بات باید مدیر کانال باشد. کاربر پس از عضویت، به مینی‌اپ برمی‌گردد
              و درخواست دریافت پاداش می‌دهد؛ عضویت توسط سرور بررسی می‌شود.
            </small>
          </label>
        )}
        {kind === "GROUP_OWNER_MEMBER_COUNT" && (
          <p className="admin-help">
            کاربر هنگام دریافت پاداش شناسه گروه خودش را وارد می‌کند. سرور بررسی
            می‌کند او مالک گروه است، بات GENYX مدیر است و حداقل عضو تعیین‌شده
            وجود دارد. در لینک بالا راهنمای ادمین‌کردن بات را وارد کنید.
          </p>
        )}
        {[
          "XP_REACHED",
          "LEVEL_REACHED",
          "GAME_PLAYED",
          "LOTTERY_BID_COUNT",
          "TEAM_COUNT",
          "GROUP_OWNER_MEMBER_COUNT",
          "BINARY_AMOUNT",
          "SHOP_BOOST_COUNT",
          "SHOP_PROFILE_COUNT",
          "SHOP_TIME_COUNT",
          "DIRECT_COUNT",
          "MAX_CAP_REACHED",
          "USED_CAP_REACHED",
          "SEASON_REACHED",
          "CYCLES_REACHED",
          "VOUCHERS_REACHED",
          "GEN_SPENT",
          "DAY_REACHED",
        ].includes(kind) && (
          <label>
            {kind === "XP_REACHED"
              ? "حداقل XP کل کاربر"
              : kind === "LEVEL_REACHED"
                ? "حداقل لول کاربر"
                : kind === "LOTTERY_BID_COUNT"
                  ? "تعداد کل پیشنهادهای ثبت‌شده در لاتاری"
                  : kind === "TEAM_COUNT"
                    ? "حداقل اعضای فعال کل تیم"
                    : kind === "GROUP_OWNER_MEMBER_COUNT"
                      ? "حداقل اعضای گروه"
                      : "مقدار هدف (تعداد یا USDT کامل طبق نوع انتخابی)"}
            <input
              name="targetValue"
              type="number"
              min={1}
              max={kind === "LEVEL_REACHED" ? 30 : 1_000_000_000}
              defaultValue={1}
              required
            />
          </label>
        )}
        {kind === "GAME_PLAYED" && (
          <label>
            شناسه بازی
            <input name="gameKey" required pattern="[a-zA-Z0-9_-]{1,64}" />
            <small>
              فقط نتیجه بازی ثبت‌شده و تأییدشده در سرور محاسبه می‌شود؛ باز کردن
              لینک بازی کافی نیست.
            </small>
          </label>
        )}
        <label>
          توضیحات
          <textarea name="description" maxLength={600} />
        </label>
        <div className="admin-two">
          <label>
            پاداش GEN
            <input
              name="rewardGen"
              type="number"
              min={0}
              max={1000000}
              defaultValue={0}
              required
            />
          </label>
          <label>
            پاداش XP
            <input
              name="rewardXp"
              type="number"
              min={0}
              max={1000000}
              defaultValue={20}
              required
            />
          </label>
        </div>
        <label>
          پاداش USDT
          <input
            name="rewardUsdt"
            type="number"
            min={0}
            max={1000}
            step="0.000001"
            defaultValue={0}
            required
          />
        </label>

        <fieldset className="season-day-picker">
          <legend>روز اجرای تسک در فصل</legend>
          <input type="hidden" name="dayNumber" value={dayNumber} />
          <p>
            تسک فقط در روز انتخاب‌شده از فصل ۳۰ روزه به کاربر نمایش داده می‌شود.
          </p>
          <div>
            {Array.from({ length: 30 }, (_, index) => {
              const day = index + 1;
              return (
                <button
                  key={day}
                  type="button"
                  className={dayNumber === day ? "selected" : ""}
                  aria-pressed={dayNumber === day}
                  onClick={() => setDayNumber(day)}
                >
                  روز {day}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label>
          وضعیت
          <select name="status">
            <option value="DRAFT">پیش‌نویس</option>
            <option value="PUBLISHED">منتشرشده</option>
          </select>
        </label>
        <button className="admin-primary" disabled={busy}>
          {busy ? "در حال ذخیره…" : "ذخیره تسک"}
        </button>
        <p role="status">{message}</p>
      </form>
    </article>
  );
}
