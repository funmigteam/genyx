// Project source: https://github.com/funmigteam
"use client";
import "./dashboard-compact.css";
import { SharedProfile } from "./shared-profile";
import { HomeReferrals } from "./home-referrals";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { WalletVerification } from "./wallet-verification";
import { CommunityPanel, EntryGate, Terms } from "./community-panel";
import { ProfileEditor } from "./profile-editor";
import { BinarySummary } from "./binary-summary";
import { WithdrawalPanel } from "./withdrawal-panel";
import { WalletTopup } from "./user-wallet";
import { WalletPanel } from "./wallet-panel";
import { ProfileEarnings } from "./profile-earnings";
import { MemberMenu, SupportPanel, NotificationsPanel } from "./member-menu";
import { Leaderboard } from "./leaderboard";
import { XpBoostStatus } from "./xp-boost-status";
import { FinancialFlows } from "./financial-flows";
import { init as initTelegramSdk, retrieveRawInitData } from "@tma.js/sdk";
import "./payment.css";
import "./registration.css";
import "./task-profile.css";

type Tab =
  | "home"
  | "tasks"
  | "team"
  | "shop"
  | "lottery"
  | "profile"
  | "recharge"
  | "wallet"
  | "support"
  | "notifications"
  | "leaderboard";
type Task = {
  id: string;
  title: string;
  description?: string | null;
  kind: string;
  actionUrl?: string | null;
  pending?: boolean;
  targetValue?: number;
  rewardUsdt?: number;
  rewardGen: number;
  rewardXp: number;
  isDaily: boolean;
  dayNumber?: number | null;
  startsAt: string;
  locked: boolean;
  claimed: boolean;
};
type ShopItem = {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  genPrice: number;
  voucherPrice: number;
  usdtPrice?: string;
  rewardGen?: number;
  rewardVouchers?: number;
  durationMinutes: number;
  imageKey: string;
};
type Channel = {
  id: string;
  title: string;
  inviteUrl: string;
  verified: boolean;
};
type LotteryRound = {
  id: string;
  title: string;
  description?: string | null;
  entryGen: number;
  prizeGen: number;
  startsAt: string;
  endsAt: string;
  status: "OPEN" | "DRAWN";
  entered: boolean;
  _count: { entries: number };
};
type PackageIntent = {
  id: string;
  packageCode: string;
  amountUsdc: string;
  treasuryAddress: string;
  jettonMasterAddress: string;
  expiresAt: string;
};
type Bootstrap = {
  user: {
    telegramId: string;
    username?: string | null;
    firstName?: string | null;
    displayName?: string | null;
    photoUrl?: string | null;
    avatarStyle?: string;
    profileStyles?: string[];
    language: string;
    languageChosen: boolean;
    role: string;
    referralCode: string;
    package?: string | null;
    vouchers: number;
    genSpent: string;
    totalDeposited: string;
    totalWithdrawn: string;
    level: { level: number; current: string; required: string };
  };
  balances: { gen: string; usdc: string };
  season: { progress: number; currentDay?: number; eligibleSeasonTwo: boolean };
  tasks: Task[];
  shopItems: ShopItem[];
  channels: Channel[];
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
type PackageDetails = {
  title?: string;
  regularUsdc?: string;
  appliedDiscountPercent?: number;
  maxCapUsdt?: string;
  description?: string;
  features?: string[];
  terms?: string;
};
type PackageCard = readonly [string, number, number, PackageDetails];
const nav: { id: Tab; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "grid" },
  { id: "tasks", label: "Tasks", icon: "bolt" },
  { id: "team", label: "Team", icon: "users" },
  { id: "shop", label: "Shop", icon: "bag" },
  { id: "lottery", label: "Lottery", icon: "ticket" },
  { id: "wallet", label: "Wallet", icon: "wallet" },
  { id: "leaderboard", label: "Leaderboard", icon: "users" },
];
const packageCycles: Record<string, number> = {
  BRONZE: 1,
  SILVER: 3,
  GOLD: 10,
  PLATINUM: 30,
  DIAMOND: 100,
};
const icons: Record<string, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  bolt: "m13 2-9 12h7l-1 8 9-12h-7z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  bag: "M6 8h12l1 13H5zM9 8a3 3 0 0 1 6 0",
  ticket:
    "M3 8a2 2 0 0 0 0 4v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0 0-4V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2zM13 5v2M13 11v2M13 17v2",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0 0 0-10 5 5 0 0 0 0 10",
  lock: "M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5z",
  info: "M12 17v-5M12 8h.01",
  gift: "M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 2.5-2.5C10 6 12 7 12 7zm0 0h4.5A2.5 2.5 0 1 0 14 4.5C14 6 12 7 12 7z",
  copy: "M9 9h11v11H9zM4 4h11v11H4z",
  check: "m5 12 4 4L19 6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  wallet: "M3 7h17v13H3zM3 7V5a2 2 0 0 1 2-2h13v4M16 13h3",
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name] ?? icons.grid} />
    </svg>
  );
}
function Info({ children }: { children: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="info info-trigger"
        aria-label="Show section information"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="info" size={16} />
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="info-dialog"
            aria-label="Section information"
            onClose={() => setOpen(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) dialog.current?.close();
            }}
          >
            <h2>Section information</h2>
            <p>{children}</p>
            <button
              autoFocus
              type="button"
              onClick={() => dialog.current?.close()}
            >
              Close
            </button>
          </dialog>,
          document.body,
        )}
    </>
  );
}
const fmt = (n: string | number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(
    Number(n),
  );

export default function Home() {
  const [tab, setTab] = useState<Tab>("shop"),
    [token, setToken] = useState(""),
    [data, setData] = useState<Bootstrap | null>(null),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<PackageCard | null>(null),
    [tour, setTour] = useState(false);
  const [entryReady, setEntryReady] = useState(false);
  const [sharedCode, setSharedCode] = useState<string | null>(null);
  const [packs, setPacks] = useState<PackageCard[]>([]);
  const [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${apiUrl}/v1/packages`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Package catalog unavailable.");
        const items = await response.json();
        if (!Array.isArray(items)) throw new Error("Invalid package catalog.");
        if (!cancelled) {
          setPacks(
            items.map(
              (item) =>
                [
                  item.code,
                  Number(item.economicUsdc),
                  Number(item.gen),
                  {
                    title: item.title,
                    regularUsdc: item.regularUsdc,
                    appliedDiscountPercent: item.appliedDiscountPercent,
                    maxCapUsdt: item.maxCapUsdt,
                    description: item.description,
                    features: item.features,
                    terms: item.terms,
                  },
                ] as const,
            ),
          );
          setCatalogError("");
        }
      } catch (error) {
        if (!cancelled)
          setCatalogError(
            error instanceof Error ? error.message : "Catalog unavailable",
          );
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);
  const [lottery, setLottery] = useState<LotteryRound[]>([]);
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reference =
        typeof body.requestId === "string"
          ? ` (Reference: ${body.requestId})`
          : "";
      throw new Error(`${body.error ?? "Request failed"}${reference}`);
    }
    return body;
  };
  const refresh = async () => {
    if (!token) return;
    try {
      const next = await request<Bootstrap>("/v1/app/bootstrap");
      setData(next);
      if (next.user.package && !localStorage.getItem("genyx-tour"))
        setTour(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Live data unavailable.");
    }
  };
  useEffect(() => {
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposeTelegramSdk: VoidFunction | undefined;
    const connectTelegram = () => {
      const t = (
        window as Window & {
          Telegram?: {
            WebApp?: {
              initData?: string;
              initDataUnsafe?: { start_param?: string };
              ready?: () => void;
              expand?: () => void;
            };
          };
        }
      ).Telegram?.WebApp;
      t?.ready?.();
      t?.expand?.();
      let sdkInitData = "";
      try {
        disposeTelegramSdk ??= initTelegramSdk();
        sdkInitData = retrieveRawInitData() ?? "";
      } catch {
        /* Telegram's native global remains a valid alternate path. */
      }
      const launchParams = new URLSearchParams(
        location.hash.startsWith("#") ? location.hash.slice(1) : location.hash,
      );
      const query = new URLSearchParams(location.search);
      const start =
        t?.initDataUnsafe?.start_param ??
        launchParams.get("tgWebAppStartParam") ??
        query.get("tgWebAppStartParam") ??
        query.get("startapp") ??
        query.get("start");
      const referralFromButton = query.get("ref");
      const referralCode = start?.startsWith("ref_")
        ? start.slice(4)
        : (referralFromButton ?? undefined);
      if (start?.startsWith("profile_")) {
        setSharedCode(start.slice(8));
        setTab("profile");
      }
      if (start === "admin") {
        location.replace(`/admin${location.search}${location.hash}`);
        return;
      }
      // Telegram Desktop can inject WebApp data a fraction after the React app hydrates.
      const initData = t?.initData || sdkInitData;
      if (!initData) {
        if (attempts++ < 16 && !stopped) {
          retryTimer = setTimeout(connectTelegram, 250);
          return;
        }
        setNotice(
          t
            ? "Telegram opened the app but did not send signed account data. Close it, then reopen with the bot Menu button."
            : "Telegram WebApp SDK did not load. Check your connection, close the Mini App, and open it again from the bot Menu button.",
        );
        return;
      }
      fetch(`${apiUrl}/v1/auth/telegram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, referralCode }),
      })
        .then(async (r) => ({ ok: r.ok, b: await r.json() }))
        .then((x) => {
          if (!x.ok) throw new Error(x.b.error);
          setToken(x.b.token);
        })
        .catch((error: unknown) =>
          setNotice(
            error instanceof Error
              ? `Telegram authentication failed: ${error.message}`
              : "Telegram authentication failed.",
          ),
        );
    };
    connectTelegram();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      disposeTelegramSdk?.();
    };
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [token]);
  const isAdmin = Boolean(data?.user.role && data.user.role !== "USER");
  const active = Boolean(data?.user.package) || isAdmin,
    gated = !active && tab !== "shop";
  const claim = async (id: string, groupChatId?: string) => {
    try {
      const result = await request<{ settledAt: string | null }>(
        `/v1/tasks/${id}/claim`,
        {
          method: "POST",
          body: JSON.stringify(groupChatId ? { groupChatId } : {}),
        },
      );
      setNotice(
        result.settledAt
          ? "Reward was recorded to your ledger."
          : "Task submitted; verification is pending.",
      );
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Claim failed.");
    }
  };
  const buy = async (id: string, method: "GEN" | "VOUCHER" | "USDT") => {
    try {
      await request(`/v1/shop/${id}/purchase`, {
        method: "POST",
        body: JSON.stringify({ method }),
      });
      setNotice("Shop purchase completed.");
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Purchase failed.");
    }
  };
  const verify = async (c: Channel) => {
    window.open(c.inviteUrl, "_blank", "noopener,noreferrer");
    try {
      const r = await request<{ verified: boolean }>(
        `/v1/channels/${c.id}/verify`,
        { method: "POST" },
      );
      setNotice(
        r.verified
          ? "Channel membership verified."
          : "Join the channel, then verify again.",
      );
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Verification unavailable.");
    }
  };
  const enterLottery = async (id: string) => {
    try {
      await request(`/v1/lottery/${id}/enter`, { method: "POST" });
      setNotice("Lottery entry recorded in your GEN ledger.");
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Lottery entry failed.");
    }
  };
  return (
    <main className="app lion-app">
      <div className="lion-watermark" aria-hidden="true">
        <svg viewBox="0 0 420 580">
          <path d="M209 47c-86 0-151 73-151 170 0 58 20 104 53 140-9 38-40 77-40 123 33-18 63-39 87-66 16 8 33 12 51 12 20 0 39-5 55-13 22 28 53 50 86 68-4-47-30-85-40-124 33-36 54-83 54-141 0-96-69-169-155-169Zm-64 123c14-31 42-50 64-50 24 0 50 20 65 50l-24 1c-13-13-27-19-41-19-15 0-30 7-42 19Zm-16 56c15 19 34 28 55 28 20 0 39-9 54-28l-12 57c-6 30-19 47-42 47-22 0-36-17-42-47Zm-44 86c23 34 57 57 99 57 42 0 77-22 100-57-19 52-56 86-100 86-43 0-80-34-99-86Z" />
        </svg>
      </div>
      <div className="ambient a" />
      <div className="ambient b" />
      <header className="top">
        <MemberMenu
          name={
            data?.user.firstName || data?.user.displayName || "GENYX Member"
          }
          photo={data?.user.photoUrl}
          go={setTab}
        />
        <button
          className="brand"
          onClick={() => setTab(active ? "home" : "shop")}
        >
          <i>G</i>
          <span>
            <b>GENYX</b>
            <small>ACTIVITY · REWARDS · RISE</small>
          </span>
        </button>
        <div className="top-stats">
          <span>
            <i /> LIVE LEDGER
          </span>
          <b>{data ? `${fmt(data.balances.gen)} GEN` : "— GEN"}</b>
          <WalletPanel />
        </div>
      </header>
      <aside>
        <p>NAVIGATION</p>
        {nav.map((n) => (
          <button
            key={n.id}
            className={tab === n.id ? "active" : ""}
            onClick={() => setTab(n.id)}
          >
            <Icon name={n.icon} />
            <span>{n.label}</span>
            {!active && n.id !== "shop" && n.id !== "profile" && (
              <Icon name="lock" size={13} />
            )}
          </button>
        ))}
        <div className="aside-foot">
          <span>SEASON 01</span>
          <b>{Math.round(data?.season.progress ?? 0)}%</b>
          <div>
            <i style={{ width: `${data?.season.progress ?? 0}%` }} />
          </div>
        </div>
      </aside>
      <section className="content">
        <header className="heading">
          <span>
            {active
              ? `LEVEL ${data?.user.level.level ?? 1}`
              : "ACCOUNT ACTIVATION"}
          </span>
          <h1>
            {tab === "shop"
              ? "GENYX Shop"
              : (nav.find((n) => n.id === tab)?.label ??
                (
                  {
                    profile: "Profile",
                    recharge: "Recharge account",
                    wallet: "Wallet",
                    support: "Support",
                    notifications: "Notifications",
                  } as Record<string, string>
                )[tab])}
          </h1>
          <p>Balances and activity are retrieved from the GENYX API.</p>
        </header>
        {data && sharedCode ? (
          <SharedProfile
            code={sharedCode}
            request={request}
            close={() => setSharedCode(null)}
          />
        ) : data && tab === "support" ? (
          <SupportPanel request={request} />
        ) : data && tab === "notifications" ? (
          <NotificationsPanel request={request} />
        ) : data && tab === "wallet" ? (
          <>
            <WalletPanel detailed />
            <WalletTopup
              request={request}
              changed={refresh}
              balance={data.balances.usdc}
            />
            <WalletVerification request={request} />
            <WithdrawalPanel request={request} changed={refresh} />
          </>
        ) : data && !entryReady && !isAdmin ? (
          <EntryGate
            initialChannels={data.channels}
            request={request}
            name={data.user.displayName || data.user.firstName || "GENYX"}
            languageChosen={data.user.languageChosen}
            done={() => {
              setEntryReady(true);
              void refresh();
            }}
          />
        ) : !active && !(tab === "profile" && data) ? (
          <Registration
            data={data}
            packs={packs}
            error={catalogError}
            select={setSelected}
          />
        ) : (
          <>
            {tab === "home" && (
              <>
                <HomeReferrals request={request} />
                <Dashboard data={data} go={setTab} />
                <BinarySummary request={request} />
                <WithdrawalPanel request={request} changed={refresh} />
              </>
            )}
            {tab === "tasks" && (
              <>
                <XpBoostStatus request={request} />
                <Tasks data={data} claim={claim} request={request} />
              </>
            )}
            {tab === "team" && <CommunityPanel request={request} />}
            {tab === "leaderboard" && <Leaderboard request={request} />}
            {tab === "shop" && (
              <>
                <XpBoostStatus request={request} />
                <Shop
                  data={data}
                  packs={packs}
                  select={setSelected}
                  buy={buy}
                  verify={verify}
                />
              </>
            )}
            {tab === "recharge" && (
              <Registration
                data={data}
                packs={packs}
                error={catalogError}
                select={setSelected}
              />
            )}
            {tab === "lottery" && (
              <FinancialFlows
                token={token}
                userId={
                  (
                    data?.user as
                      (Bootstrap["user"] & { id?: string }) | undefined
                  )?.id
                }
                mode="auctions"
                onWithdraw={() => setTab("wallet")}
                changed={refresh}
              />
            )}
            {tab === "profile" && (
              <>
                <Profile
                  data={data}
                  save={async (value) => {
                    await request("/v1/me/profile", {
                      method: "PATCH",
                      body: JSON.stringify(value),
                    });
                    await refresh();
                  }}
                  equip={async (style) => {
                    await request("/v1/me/profile-style", {
                      method: "PATCH",
                      body: JSON.stringify({ style }),
                    });
                    await refresh();
                  }}
                />
                <ProfileEarnings request={request} />
                <WalletVerification request={request} />
                <WithdrawalPanel request={request} changed={refresh} />
                <Terms request={request} />
              </>
            )}
          </>
        )}
      </section>
      <nav className="bottom">
        {nav.map((n) => (
          <button
            key={n.id}
            className={tab === n.id ? "active" : ""}
            onClick={() => setTab(n.id)}
          >
            <Icon name={n.icon} />
            <small>{n.label}</small>
          </button>
        ))}
      </nav>
      {selected && (
        <PackageModal
          item={selected}
          request={request}
          done={async (message) => {
            setNotice(message);
            setSelected(null);
            await refresh();
          }}
          close={() => setSelected(null)}
        />
      )}
      {tour && (
        <Tour
          close={() => {
            localStorage.setItem("genyx-tour", "1");
            setTour(false);
          }}
        />
      )}
      {notice && (
        <div className="toast">
          {notice}
          <button onClick={() => setNotice("")}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </main>
  );
}

function Registration({
  data,
  packs,
  error,
  select,
}: {
  data: Bootstrap | null;
  packs: PackageCard[];
  error: string;
  select: (item: PackageCard) => void;
}) {
  return (
    <section className="registration">
      <ol className="registration-steps" aria-label="Account setup">
        <li aria-current={!data ? "step" : undefined}>
          01 · Telegram identity
        </li>
        <li aria-current={data ? "step" : undefined}>02 · Choose package</li>
        <li>03 · Confirm payment</li>
      </ol>
      <h2>Welcome to GENYX</h2>
      <p>
        Your Telegram account is your sign-in. Choose a package below to
        activate your account after payment confirmation.
      </p>
      <div className="registration-identity">
        <label>
          Account name
          <input
            readOnly
            value={data?.user.firstName ?? ""}
            placeholder="Waiting for Telegram verification"
          />
        </label>
        <label>
          Telegram ID
          <input
            readOnly
            value={data?.user.telegramId ?? ""}
            placeholder="Not verified yet"
          />
        </label>
      </div>
      <p role="status">
        {data
          ? "Telegram identity verified. You can choose a package."
          : "Open from the Telegram bot to verify your identity. Purchases remain disabled until verification."}
      </p>
      <h3>Choose your package</h3>
      <p>
        Swipe horizontally or use the keyboard to browse all packages. Prices
        are in USDT on TON.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !packs.length ? (
        <p role="status">Loading packages…</p>
      ) : (
        <div
          className="registration-packages"
          tabIndex={0}
          role="region"
          aria-label="Available packages, scroll horizontally"
        >
          {packs.map((p) => (
            <article key={p[0]}>
              <span>{p[3].title || p[0]}</span>
              <h3>
                {fmt(p[1])} <small>USDT</small>
              </h3>
              <p>{fmt(p[2])} GEN</p>
              <PackageDescription item={p} />
              <p>
                Activation requires confirmed payment. Network fees are
                separate.
              </p>
              <button
                className="primary"
                disabled={!data}
                onClick={() => select(p)}
              >
                Continue with this package <Icon name="arrow" />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PackageDescription({ item }: { item: PackageCard }) {
  const details = item[3];
  return (
    <div className="package-description">
      <p>
        <strong>
          {packageCycles[item[0]] ?? 0} Cycle
          {packageCycles[item[0]] === 1 ? "" : "s"}
        </strong>
      </p>
      <p>
        {details.description ||
          "Choose this package to activate your account. Review the payment amount before confirming in your wallet."}
      </p>
      {Boolean(details.features?.length) && (
        <ul>
          {details.features!.map((feature, index) => (
            <li key={index}>{feature}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>Payment conditions</summary>
        <p>
          {details.terms ||
            "Pay in USDT on TON. Activation requires server confirmation. Wallet network fees are separate from the package price."}
        </p>
      </details>
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  info,
}: {
  label: string;
  value: string;
  icon: string;
  info: string;
}) {
  return (
    <article className="metric">
      <div>
        <span>{label}</span>
        <Info>{info}</Info>
      </div>
      <b>{value}</b>
      <Icon name={icon} />
    </article>
  );
}
function Dashboard({
  data,
  go,
}: {
  data: Bootstrap | null;
  go: (t: Tab) => void;
}) {
  const s = data?.season.progress ?? 0,
    l = data?.user.level;
  return (
    <>
      <section className="hero-grid">
        <article className="season-card">
          <span>SEASON PROGRESS</span>
          <h2>Build your activity cycle.</h2>
          <div className="season-track">
            <div className="track">
              <i style={{ width: `${s}%` }} />
            </div>
            <b>{Math.round(s)}%</b>
          </div>
          <p>
            Completed season days. Next-season purchases have no percentage
            requirement.
          </p>
        </article>
        <article className="lion-card">
          <span>
            LEVEL {l?.level ?? 1} / 30{" "}
            <Info>XP requirements increase at every level.</Info>
          </span>
          <b>
            {fmt(l?.current ?? 0)} <small>/ {fmt(l?.required ?? 250)} XP</small>
          </b>
          <div className="track">
            <i
              style={{
                width: `${Math.min(100, (Number(l?.current ?? 0) / Number(l?.required ?? 250)) * 100)}%`,
              }}
            />
          </div>
          <button onClick={() => go("tasks")}>
            Earn activity XP <Icon name="arrow" />
          </button>
        </article>
      </section>
      <div className="metrics">
        <Metric
          label="GEN balance"
          value={`${fmt(data?.balances.gen ?? 0)} GEN`}
          icon="bolt"
          info="Spend GEN in the Shop for boosts, time windows and profile options."
        />
        <Metric
          label="Vouchers"
          value={fmt(data?.user.vouchers ?? 0)}
          icon="ticket"
          info="Voucher counts are held on your account."
        />
        <Metric
          label="Daily tasks"
          value={`${data?.tasks.filter((t) => t.isDaily && t.claimed).length ?? 0} / 5`}
          icon="check"
          info="Five fixed daily tasks reset on the GENYX server."
        />
        <Metric
          label="Season progress"
          value={`${Math.round(s)}%`}
          icon="gift"
          info="Percentage of completed days; rewards appear only after server confirmation."
        />
      </div>
      <section className="quick">
        <button onClick={() => go("tasks")}>
          <Icon name="bolt" />
          <span>
            <b>Daily activity</b>
            <small>Five fixed tasks + changing missions</small>
          </span>
          <Icon name="arrow" />
        </button>
        <button onClick={() => go("shop")}>
          <Icon name="bag" />
          <span>
            <b>Spend GEN</b>
            <small>Boost time, profile and activity</small>
          </span>
          <Icon name="arrow" />
        </button>
        <button onClick={() => go("team")}>
          <Icon name="users" />
          <span>
            <b>Referral network</b>
            <small>Share your tracked invite link</small>
          </span>
          <Icon name="arrow" />
        </button>
      </section>
    </>
  );
}
function Tasks({
  data,
  claim,
  request,
}: {
  data: Bootstrap | null;
  claim: (id: string, groupChatId?: string) => Promise<void>;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({}),
    [linkError, setLinkError] = useState("");
  const currentDay = data?.season.currentDay ?? 0;
  const groups = new Map<number | null, Task[]>();
  for (const task of data?.tasks ?? []) {
    if (
      task.dayNumber !== null &&
      task.dayNumber !== undefined &&
      (task.dayNumber < currentDay || task.dayNumber > currentDay + 1)
    )
      continue;
    const key = task.dayNumber ?? null;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const dayGroups = [...groups.entries()].sort(([first], [second]) => {
    if (first === null) return 1;
    if (second === null) return -1;
    return first - second;
  });
  const groupTitle = (day: number | null) => {
    if (day === null) return "OTHER MISSIONS";
    if (day === currentDay) return `DAY ${day} · AVAILABLE NOW`;
    if (day > currentDay) return `DAY ${day} · LOCKED UNTIL THIS DAY`;
    return `DAY ${day} · TIME EXPIRED`;
  };
  return (
    <>
      <section className="task-note">
        <Icon name="info" />
        <p>
          Open the mission link, then return here to claim. Channel membership
          and XP / level requirements are checked on the server. External videos
          do not require viewing verification.
        </p>
      </section>
      <p role="status">{linkError}</p>
      {dayGroups.map(([day, tasks]) => (
        <section className="task-day-group" key={day ?? "general"}>
          <header>
            <span>{groupTitle(day)}</span>
            {day !== null && day > currentDay && (
              <small>Complete the current day first</small>
            )}
            {day !== null && day < currentDay && (
              <small>Rewards are no longer available</small>
            )}
          </header>
          <div className="task-list">
            {tasks.map((t) => {
              const futureTask =
                t.dayNumber !== null &&
                t.dayNumber !== undefined &&
                t.dayNumber > currentDay;
              const expiredTask =
                t.dayNumber !== null &&
                t.dayNumber !== undefined &&
                t.dayNumber < currentDay;
              return (
                <article
                  key={t.id}
                  className={t.locked ? "locked" : t.claimed ? "claimed" : ""}
                >
                  <div className="task-icon">
                    <Icon
                      name={t.locked ? "lock" : t.claimed ? "check" : "bolt"}
                    />
                  </div>
                  <div>
                    <span>
                      {t.isDaily ? "DAILY MISSION" : "MISSION"} ·{" "}
                      {t.kind.replaceAll("_", " ")}
                    </span>
                    <h3>{t.title}</h3>
                    <p>{t.description}</p>
                    {[
                      "XP_REACHED",
                      "LEVEL_REACHED",
                      "GAME_PLAYED",
                      "LOTTERY_BID_COUNT",
                    ].includes(t.kind) && (
                      <p>
                        Required: {t.targetValue}{" "}
                        {t.kind === "XP_REACHED"
                          ? "total XP"
                          : t.kind === "LEVEL_REACHED"
                            ? "level"
                            : t.kind === "LOTTERY_BID_COUNT"
                              ? "registered lottery bids"
                              : "verified rounds"}
                      </p>
                    )}
                    <small>
                      Base reward: {t.rewardGen} GEN · {t.rewardXp} XP ·{" "}
                      {(Number(t.rewardUsdt ?? 0) / 1_000_000).toFixed(2)} USDT.
                      Package multipliers apply.
                    </small>
                    {t.actionUrl?.startsWith("https://") && !t.locked && (
                      <p>
                        <a
                          className="mission-link-button"
                          href={t.actionUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            void request("/v1/tasks/" + t.id + "/open", {
                              method: "POST",
                            })
                              .then(() =>
                                setOpened((current) => ({
                                  ...current,
                                  [t.id]: true,
                                })),
                              )
                              .catch((error) => setLinkError(error.message));
                          }}
                        >
                          {t.kind === "CHANNEL_JOIN"
                            ? "Join channel"
                            : "Open mission link"}{" "}
                          ↗
                        </a>
                      </p>
                    )}
                  </div>
                  {t.claimed ? (
                    <b className="state">Reward received</b>
                  ) : t.locked ? (
                    <b className="state">
                      {futureTask
                        ? "Locked for a later day"
                        : expiredTask
                          ? "Time expired"
                          : "Locked"}
                    </b>
                  ) : t.pending && t.kind === "MANUAL_REVIEW" ? (
                    <b className="state">Awaiting review</b>
                  ) : (
                    <button
                      disabled={
                        busy !== null || Boolean(t.actionUrl && !opened[t.id])
                      }
                      title={
                        t.actionUrl && !opened[t.id]
                          ? "Open the mission link first"
                          : undefined
                      }
                      onClick={async () => {
                        if (busy) return;
                        setBusy(t.id);
                        try {
                          const groupChatId =
                            t.kind === "GROUP_OWNER_MEMBER_COUNT"
                              ? window
                                  .prompt(
                                    "Enter your Telegram group ID (for example -100…):",
                                  )
                                  ?.trim()
                              : undefined;
                          if (
                            t.kind === "GROUP_OWNER_MEMBER_COUNT" &&
                            !groupChatId
                          ) {
                            setBusy(null);
                            return;
                          }
                          await claim(t.id, groupChatId);
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {busy === t.id
                        ? "Checking…"
                        : t.kind === "CHANNEL_JOIN"
                          ? "Check membership & claim"
                          : "Claim"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
function Team({ data }: { data: Bootstrap | null }) {
  const code =
    data?.user.referralCode ||
    (data?.user.telegramId ? `GEN-${data.user.telegramId}` : "GENYX");
  const link = `https://t.me/smartgenyx_bot?startapp=ref_${code}`;
  return (
    <>
      <section className="ref-card">
        <div>
          <span>YOUR REFERRAL CODE</span>
          <strong className="referral-code">{code}</strong>
          <span>YOUR TRACKED REFERRAL LINK</span>
          <code>{link}</code>
          <p>
            Open this link in Telegram. GENYX opens directly and registers the
            referral.
          </p>
        </div>
        <button onClick={() => navigator.clipboard?.writeText(link)}>
          <Icon name="copy" /> Copy link
        </button>
      </section>
      <div className="metrics three">
        <Metric
          label="Direct referrals"
          value="0"
          icon="users"
          info="Counts appear after Telegram-linked activation."
        />
        <Metric
          label="Matchable volume"
          value="0 Cycles"
          icon="grid"
          info="The weaker lane determines matchable volume per cycle."
        />
        <Metric
          label="Team GEN"
          value="Not applicable"
          icon="bolt"
          info="GEN belongs to the individual account, not a team."
        />
      </div>
      <section className="empty-card">
        <Icon name="users" size={34} />
        <h2>Your network will appear here.</h2>
        <p>
          Commissions and placement use backend records after confirmed
          payments.
        </p>
      </section>
    </>
  );
}
function Shop({
  data,
  packs,
  select,
  buy,
  verify,
}: {
  data: Bootstrap | null;
  packs: PackageCard[];
  select: (p: PackageCard) => void;
  buy: (id: string, m: "GEN" | "VOUCHER" | "USDT") => void;
  verify: (c: Channel) => void;
}) {
  const [category, setCategory] = useState("PACKAGE");
  return (
    <>
      <div
        className="shop-categories"
        role="group"
        aria-label="Shop categories"
      >
        {[
          ["BOOST", "XP Boost"],
          ["PACKAGE", "Packages"],
          ["PROFILE", "Custom profile"],
          ["TIME", "24-hour task time"],
          ["LOTTERY", "Lottery packs"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="shop-balance">
        <div>
          <span>AVAILABLE TO SPEND</span>
          <b>
            {fmt(data?.balances.gen ?? 0)} <small>GEN</small>
          </b>
          <p>
            {fmt(data?.user.vouchers ?? 0)} vouchers ·{" "}
            {fmt(Number(data?.balances.usdc ?? 0) / 1_000_000)} USDT in wallet.
          </p>
        </div>
        <div>
          <span>SHOP RULE</span>
          <p>
            First daily shop purchase can use GEN. A second may require vouchers
            under the active policy.
          </p>
        </div>
      </section>
      {(data?.channels.length ?? 0) > 0 && (
        <section className="channel-panel">
          <div>
            <Icon name="users" />
            <span>
              <b>Required membership</b>
              <small>Join official channels before task verification.</small>
            </span>
          </div>
          {data!.channels.map((c) => (
            <button key={c.id} onClick={() => verify(c)}>
              {c.verified ? (
                <>
                  <Icon name="check" /> Verified
                </>
              ) : (
                <>
                  Join & verify <Icon name="arrow" />
                </>
              )}
            </button>
          ))}
        </section>
      )}
      {category === "PACKAGE" && (
        <>
          <h2 className="section-title">
            Activate your account{" "}
            <Info>
              Any 6, 18 or 60 USDT package can be your first purchase. Higher
              packages require one confirmed opening package.
            </Info>
          </h2>
          <div className="packs">
            {packs.map((p) => (
              <article key={p[0]}>
                <span>{p[3].title || p[0]}</span>
                <small>
                  {["BRONZE", "SILVER", "GOLD"].includes(p[0])
                    ? "Available as a first package"
                    : "Requires one confirmed 6, 18 or 60 USDT package"}
                </small>
                {Boolean(p[3].appliedDiscountPercent) && (
                  <small>
                    <s>{fmt(p[3].regularUsdc ?? 0)} USDT</s> ·{" "}
                    {p[3].appliedDiscountPercent}% off non-owner share
                  </small>
                )}
                <b>
                  {fmt(p[1])} <small>USDT</small>
                </b>
                <p>Max cap: {fmt(p[3].maxCapUsdt ?? 0)} USDT</p>
                <p>{fmt(p[2])} GEN</p>
                <PackageDescription item={p} />
                <button className="primary" onClick={() => select(p)}>
                  Choose package <Icon name="arrow" />
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      <h2 className="section-title">
        Spend GEN in the Shop{" "}
        <Info>
          GEN and voucher balances are debited by the API after validation.
        </Info>
      </h2>
      <div className="shop-grid">
        {(data?.shopItems ?? [])
          .filter((i) => i.category === category)
          .map((i) => (
            <article key={i.id}>
              <div className="shop-icon">
                <Icon
                  name={
                    i.imageKey === "clock"
                      ? "bolt"
                      : i.imageKey === "frame"
                        ? "user"
                        : "gift"
                  }
                />
              </div>
              <span>{i.category}</span>
              <h3>{i.title}</h3>
              <p>{i.description}</p>
              <small>
                {i.durationMinutes
                  ? `${i.durationMinutes} min activity window`
                  : "Permanent account option"}
              </small>
              {i.rewardGen || i.rewardVouchers ? (
                <small>
                  Includes {i.rewardGen ? `${i.rewardGen} GEN` : ""}
                  {i.rewardGen && i.rewardVouchers ? " · " : ""}
                  {i.rewardVouchers ? `${i.rewardVouchers} voucher` : ""}
                </small>
              ) : null}
              <div className="shop-actions">
                <button onClick={() => buy(i.id, "GEN")}>
                  Buy · {i.genPrice} GEN
                </button>
                {i.voucherPrice > 0 && (
                  <button onClick={() => buy(i.id, "VOUCHER")}>
                    {i.voucherPrice} voucher
                  </button>
                )}
                {Number(i.usdtPrice ?? 0) > 0 && (
                  <button onClick={() => buy(i.id, "USDT")}>
                    {fmt(Number(i.usdtPrice) / 1_000_000)} USDT
                  </button>
                )}
              </div>
            </article>
          ))}
      </div>
    </>
  );
}
function Lottery({
  data,
  rounds,
  enter,
}: {
  data: Bootstrap | null;
  rounds: LotteryRound[];
  enter: (id: string) => void;
}) {
  return (
    <>
      <section className="lottery-hero">
        <div>
          <span>GEN LOTTERY</span>
          <h2>Enter only with earned GEN.</h2>
          <p>
            Entries, prizes and the winner are stored in the server ledger. A
            round can only be drawn after it ends.
          </p>
        </div>
        <Icon name="ticket" size={46} />
      </section>
      {rounds.length ? (
        <div className="lottery-grid">
          {rounds.map((round) => {
            const open =
              round.status === "OPEN" &&
              new Date(round.startsAt) <= new Date() &&
              new Date(round.endsAt) > new Date();
            return (
              <article key={round.id}>
                <span>
                  {round.status} · {round._count.entries} ENTRIES
                </span>
                <b>{fmt(round.prizeGen)} GEN</b>
                <p>
                  {round.description ?? "Ledger-backed prize pool."}
                  <br />
                  Entry {round.entryGen} GEN · balance{" "}
                  {fmt(data?.balances.gen ?? 0)} GEN
                  <br />
                  Ends {new Date(round.endsAt).toLocaleString()}
                </p>
                <button
                  disabled={round.entered || !open}
                  onClick={() => enter(round.id)}
                >
                  {round.entered
                    ? "Entry recorded"
                    : open
                      ? `Enter for ${round.entryGen} GEN`
                      : round.status === "DRAWN"
                        ? "Winner drawn"
                        : "Not open yet"}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="empty-card">
          <Icon name="ticket" size={34} />
          <h2>No lottery is open.</h2>
          <p>
            Rounds are created, funded and opened from the administrator
            console.
          </p>
        </section>
      )}
      <section className="transparency">
        <Icon name="info" />
        <p>
          The administrator must fund a prize reserve before drawing. Winner
          selection uses server-side cryptographic randomness.
        </p>
      </section>
    </>
  );
}
function Profile({
  data,
  save,
  equip,
}: {
  data: Bootstrap | null;
  save: (value: { displayName: string; language: string }) => Promise<void>;
  equip: (style: string) => Promise<void>;
}) {
  const u = data?.user;
  return (
    <>
      <section className="profile-card">
        <div className={`avatar avatar-style-${(u?.avatarStyle ?? "lion").replace(/[^a-zA-Z0-9_-]/g, "")}`}>
          {u?.photoUrl ? (
            <img
              src={u.photoUrl}
              alt="Telegram profile"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            (u?.displayName || u?.firstName || "G").slice(0, 1).toUpperCase()
          )}
        </div>
        <div>
          <span>TELEGRAM ACCOUNT</span>
          <h2>{u?.displayName || u?.firstName || "GENYX Member"}</h2>
          <p>
            {u?.username ? "@" + u.username : "No Telegram username"} · ID{" "}
            {u?.telegramId ?? "—"}
          </p>
        </div>
      </section>
      <div className="profile-stats profile-mini-stats">
        <Metric
          label="GEN spent"
          value={fmt(u?.genSpent ?? 0) + " GEN"}
          icon="bag"
          info="Recorded GEN spending."
        />
        <Metric
          label="Funds in"
          value={fmt(Number(u?.totalDeposited ?? 0) / 1_000_000) + " USDT"}
          icon="wallet"
          info="Confirmed deposits."
        />
        <Metric
          label="Withdrawn"
          value={fmt(Number(u?.totalWithdrawn ?? 0) / 1_000_000) + " USDT"}
          icon="arrow"
          info="Recorded completed withdrawals."
        />
      </div>
      {u && (
        <ProfileEditor
          name={u.displayName || u.firstName || "GENYX Member"}
          language={u.language}
          save={save}
        />
      )}
      {u && (
        <section className="profile-settings">
          <h2>Profile collection</h2>
          <p>
            Buy profile styles in Shop, then equip one here. You can change or
            remove it at any time.
          </p>
          <div className="shop-actions">
            {(u.profileStyles ?? ["lion"]).map((style) => (
              <button
                key={style}
                type="button"
                aria-pressed={u.avatarStyle === style}
                onClick={() => void equip(style)}
              >
                {u.avatarStyle === style ? "Equipped · " : ""}
                {style}
              </button>
            ))}
          </div>
        </section>
      )}
      <WalletPanel detailed />
    </>
  );
}
function PackageModal({
  item,
  request,
  done,
  close,
}: {
  item: PackageCard;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  done: (message: string) => void;
  close: () => void;
}) {
  const [intent, setIntent] = useState<PackageIntent | null>(null),
    [txHash, setTxHash] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const packageCode = item[0];
  const createIntent = async () => {
    setBusy(true);
    setError("");
    try {
      setIntent(
        await request<PackageIntent>("/v1/payments/package-intents", {
          method: "POST",
          body: JSON.stringify({ packageCode }),
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not create payment intent.",
      );
    } finally {
      setBusy(false);
    }
  };
  const payInTonkeeper = () => {
    if (!intent) return;
    const amount = Math.round(Number(intent.amountUsdc) * 1_000_000);
    const url = `https://app.tonkeeper.com/transfer/${encodeURIComponent(intent.treasuryAddress)}?jetton=${encodeURIComponent(intent.jettonMasterAddress)}&amount=${amount}&text=${encodeURIComponent(`GENYX:${intent.id}`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const submitHash = async () => {
    if (!intent || txHash.trim().length < 16)
      return setError("Paste the on-chain transaction hash from Tonkeeper.");
    setBusy(true);
    setError("");
    try {
      await request(`/v1/payments/${intent.id}/transaction`, {
        method: "POST",
        body: JSON.stringify({ txHash: txHash.trim() }),
      });
      done(
        "Payment transaction submitted. Activation happens after the server confirms the USDT transfer.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not submit transaction.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal">
      <section>
        <button className="close" onClick={close}>
          <Icon name="close" />
        </button>
        <span>USDT PACKAGE PAYMENT</span>
        <h2>{item[3].title || item[0]}</h2>
        <PackageDescription item={item} />
        <b>
          {fmt(item[1])} <small>USDT on TON</small>
        </b>
        {!intent ? (
          <>
            <p>
              Create a unique server payment intent first. Its amount, recipient
              and expiry are recorded before Tonkeeper opens.
            </p>
            <button className="primary" disabled={busy} onClick={createIntent}>
              {busy ? "Creating secure intent…" : "Create payment intent"}
            </button>
          </>
        ) : (
          <>
            <p>
              Send exactly <b>{fmt(intent.amountUsdc)} USDT</b> to the
              registered treasury, then paste the resulting transaction hash for
              confirmation.
            </p>
            <div className="secure">
              <Icon name="wallet" />
              <span>
                <b>Recipient</b>
                <br />
                {intent.treasuryAddress}
                <br />
                <small>
                  Expires {new Date(intent.expiresAt).toLocaleString()}
                </small>
              </span>
            </div>
            <button className="primary" onClick={payInTonkeeper}>
              Open Tonkeeper payment <Icon name="arrow" />
            </button>
            <label className="tx-hash">
              Transaction hash
              <input
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                placeholder="Paste TON transaction hash"
                autoComplete="off"
              />
            </label>
            <button className="primary" disabled={busy} onClick={submitHash}>
              {busy ? "Submitting…" : "Submit for confirmation"}
            </button>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  );
}
function Tour({ close }: { close: () => void }) {
  const [s, setS] = useState(0);
  const slides = [
    [
      "Welcome to GENYX",
      "Your package is active. This guide introduces every live area.",
    ],
    [
      "Earn with activity",
      "Complete fixed daily and changing scheduled tasks.",
    ],
    [
      "Spend with intent",
      "Use GEN and vouchers in the Shop for approved options.",
    ],
    [
      "Track every result",
      "Balances and activity are backed by the server ledger.",
    ],
  ];
  return (
    <div className="modal onboarding">
      <section>
        <span>{String(s + 1).padStart(2, "0")} / 04 · GUIDED TOUR</span>
        <div className="tour-visual">
          <Icon name={["grid", "bolt", "bag", "wallet"][s]} size={42} />
        </div>
        <h2>{slides[s][0]}</h2>
        <p>{slides[s][1]}</p>
        <div className="tour-dots">
          {slides.map((_, i) => (
            <i key={i} className={i === s ? "on" : ""} />
          ))}
        </div>
        <button
          className="primary"
          onClick={() => (s === 3 ? close() : setS(s + 1))}
        >
          {s === 3 ? "Enter dashboard" : "Continue"} <Icon name="arrow" />
        </button>
      </section>
    </div>
  );
}
