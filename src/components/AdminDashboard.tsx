import React, { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { signInManagerWithEmail, signInManagerWithGoogle, signOutManager, watchAuthState } from "../utils/auth";
import logoFull from "../assets/logo-full.png";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  Building2, Ticket, ShieldCheck, Search, PauseCircle, PlayCircle,
  Trash2, StickyNote, Plus, RefreshCw, LogOut, AlertTriangle, X,
  LayoutDashboard,
} from "lucide-react";

// Platform-level Site Manager dashboard at /admin. NOT part of the
// slug-based tenant model — it is scoped to the platform, not to any one
// restaurant, which is why it lives in STATIC_PAGES and in
// RESERVED_SLUGS rather than being reachable at /{slug}/admin.
//
// SECURITY NOTE — read before changing anything here.
// Nothing in this file is a security boundary. The sign-in below and the
// isAdmin flag only decide what to RENDER. Every listed business, every
// pause/resume/delete and every bonus code goes through a callable that
// re-checks platformAdmins/{email} server-side on that specific call,
// and platformAdmins + bonusCodes are unreadable from the client
// entirely (firestore.rules). Someone who patches this component in
// their browser gets a dashboard shell full of failed calls.
//
// Admin UI is intentionally English-only: it has exactly two users, both
// of whom read English, and mirroring it into FR would double the
// surface for no benefit. Customer-facing copy stays bilingual.

type Tab = "overview" | "businesses" | "codes" | "admins";

/** A one-shot filter handed from the Overview tab's KPI cards to the
 * Businesses tab. `activity` is a filter dimension the Businesses tab did
 * not previously have — added here rather than as a parallel mechanism,
 * so all four filters (search / status / plan / activity) sit in the same
 * useMemo and compose with each other. */
export interface BusinessFilter {
  status?: string;
  plan?: string;
  activity?: "24h" | "7d";
}

interface Business {
  slug: string;
  name: string;
  city: string;
  signupEmail: string;
  status: string;
  plan: string;
  joinedAt: string | null;
  lastActiveAt: string | null;
  trialExpiredAt: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  compedUntil: string | null;
  compedVia: string | null;
  staffCount: number;
  adminNotes: string;
  hasStripe: boolean;
  deletionReason: string | null;
}

interface BonusCode {
  code: string;
  durationDays: number | null;
  maxRedemptions: number;
  redemptionCount: number;
  active: boolean;
  expiresAt: string | null;
  note: string;
  createdAt: string | null;
  createdBy: string | null;
}

const call = <T,>(name: string) => httpsCallable<Record<string, unknown>, T>(functions, name);

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** "3 days ago" style relative age, for lastActiveAt at a glance. */
function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms)) return "—";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-lime-400/10 text-lime-400 border-lime-400/30",
  comped: "bg-sky-400/10 text-sky-300 border-sky-400/30",
  paused: "bg-amber-400/10 text-amber-300 border-amber-400/30",
  trial_expired: "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

const DAY_MS = 86_400_000;

/** Whether a tenant's lastActiveAt falls inside the given window.
 *
 * NOTE this is RECENT ACTIVITY, not live presence. lastActiveAt is
 * written on app load and throttled to once per 30 minutes per tenant
 * (see App.tsx), so "active in last 24h" means "someone opened the app",
 * not "someone is online now". It also only started being written when
 * Phase 1 deployed (2026-08-13), so tenants that existed before that read
 * as inactive until someone next opens their app — expected, not a bug. */
function isActiveWithin(lastActiveAt: string | null, window: "24h" | "7d"): boolean {
  if (!lastActiveAt) return false;
  const ms = Date.parse(lastActiveAt);
  if (isNaN(ms)) return false;
  return Date.now() - ms <= (window === "24h" ? DAY_MS : 7 * DAY_MS);
}

/** True when this tenant is a paying customer: `active` AND linked to a
 * Stripe customer. A tenant with `active` and no Stripe customer is still
 * inside its trial (or a legacy pre-Stripe tenant like la-vague). */
const isPaying = (b: Business) => b.status === "active" && b.hasStripe;
/** `active` with no Stripe link — still trialing, hasn't converted yet. */
const isTrialing = (b: Business) => b.status === "active" && !b.hasStripe;

/** One tenant's trial outcome, with the date it happened.
 *
 * DELIBERATELY SHAPED AS PER-TENANT EVENTS, not a single aggregate count.
 * Step 3 of Phase 2 only renders a single current stat ("X of Y converted"),
 * but keeping the underlying data as dated events means a future
 * trend-over-time chart is a grouping change, not a rewrite: bucket these
 * by `completedAt` the same way the signups chart buckets by joinedAt.
 * The stat is simple ON PURPOSE right now — it is not half-finished. */
interface TrialOutcome {
  slug: string;
  converted: boolean;
  /** When the trial completed. Exact for expiries (trialExpiredAt);
   * DERIVED for conversions — Stripe's actual conversion moment is not
   * stored on the tenant doc, so this approximates it as signup + the
   * 7-day trial length. Good enough to bucket by month; do not present
   * it as a precise conversion timestamp. */
  completedAt: string | null;
}

const TRIAL_DAYS = 7;

/** Builds the per-tenant trial-completion event list.
 *
 * "Completed a trial" = the trial ended one way or the other:
 *   - converted    : now a paying customer (active + Stripe customer)
 *   - not converted: hit trial_expired without ever converting
 *
 * EXCLUDED from the denominator entirely:
 *   - comped tenants (arrived via bonus code, never had a trial to complete)
 *   - tenants still inside their trial (outcome not yet known)
 *   - paused tenants (outcome deferred, not decided)
 *   - trial_expired tenants whose deletionReason is "comped_expired"
 *     (their free comp ran out — again, never a trial)
 *
 * CAVEAT worth knowing: a trial_expired tenant with
 * deletionReason === "admin_delete" IS counted as "did not convert".
 * That's usually right (admins delete dead trials), but an admin deleting
 * a paying customer would also land here. At current volume that's
 * inspectable by hand; revisit if admin deletions ever become common. */
function trialOutcomes(rows: Business[]): TrialOutcome[] {
  const out: TrialOutcome[] = [];
  for (const b of rows) {
    if (isPaying(b)) {
      const joined = b.joinedAt ? Date.parse(b.joinedAt) : NaN;
      out.push({
        slug: b.slug,
        converted: true,
        completedAt: isNaN(joined) ? null : new Date(joined + TRIAL_DAYS * DAY_MS).toISOString(),
      });
    } else if (b.status === "trial_expired" && b.deletionReason !== "comped_expired") {
      out.push({ slug: b.slug, converted: false, completedAt: b.trialExpiredAt });
    }
  }
  return out;
}

export default function AdminDashboard() {
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  // Opens on the summary, not a list — dashboards conventionally do.
  const [tab, setTab] = useState<Tab>("overview");

  // ── Shared business data ─────────────────────────────────────────────
  // Lifted out of BusinessesTab so the Overview tab computes its KPIs and
  // charts from the SAME adminListBusinesses response rather than issuing
  // a second, duplicate query. Switching tabs no longer refetches either.
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [businessesErr, setBusinessesErr] = useState("");

  const loadBusinesses = useCallback(async () => {
    setBusinessesErr("");
    try {
      const res = await call<{ businesses: Business[] }>("adminListBusinesses")({});
      setBusinesses(res.data.businesses);
    } catch (e) {
      setBusinessesErr((e as Error).message || "Failed to load");
      setBusinesses([]);
    }
  }, []);

  // Only fetch once admin status is confirmed — an unauthorised caller
  // would just get permission-denied from the callable anyway.
  useEffect(() => {
    if (isAdmin) void loadBusinesses();
  }, [isAdmin, loadBusinesses]);

  // Set by the Overview tab's clickable KPI cards to jump into the
  // Businesses tab pre-filtered. Consumed once, then cleared, so it acts
  // as a one-shot instruction rather than a sticky filter the user can't
  // clear from inside the Businesses tab.
  const [pendingFilter, setPendingFilter] = useState<BusinessFilter | null>(null);
  const applyFilterAndShowBusinesses = useCallback((f: BusinessFilter) => {
    setPendingFilter(f);
    setTab("businesses");
  }, []);

  // Re-checks admin status against the server whenever the auth state
  // changes — including on first load, so a stale browser session cannot
  // keep the dashboard rendered after the account loses admin rights.
  useEffect(() => {
    return watchAuthState(async user => {
      setAuthReady(true);
      setSignedIn(!!user);
      if (!user) {
        setIsAdmin(null);
        setAdminEmail(null);
        return;
      }
      try {
        const res = await call<{ isAdmin: boolean; email: string | null }>("adminWhoAmI")({});
        setIsAdmin(res.data.isAdmin);
        setAdminEmail(res.data.email);
      } catch {
        setIsAdmin(false);
      }
    });
  }, []);

  if (!authReady) {
    return <Shell><div className="text-sm text-slate-500">Loading…</div></Shell>;
  }

  if (!signedIn) return <SignIn />;

  if (isAdmin === null) {
    return <Shell><div className="text-sm text-slate-500">Checking access…</div></Shell>;
  }

  if (!isAdmin) {
    return (
      <Shell>
        <div className="max-w-md text-center space-y-4">
          <AlertTriangle size={36} className="mx-auto text-rose-400" />
          <h1 className="text-lg font-bold">Not authorised</h1>
          <p className="text-sm text-slate-400">
            This account is not a platform admin. If that is unexpected, sign in with a different account.
          </p>
          <button onClick={() => signOutManager()} className="px-4 py-2 rounded-xl border border-slate-700 text-sm font-semibold text-slate-300">
            Sign out
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800 px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
        <img src={logoFull} alt="Brigado" className="h-6 w-auto" />
        <span className="text-xs font-bold uppercase tracking-wider text-lime-400">Site Manager</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-slate-500 hidden sm:inline">{adminEmail}</span>
          <button onClick={() => signOutManager()} aria-label="Sign out" className="text-slate-400 hover:text-rose-400">
            <LogOut size={16} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-slate-800 px-4 sm:px-6">
        {([
          ["overview", "Overview", LayoutDashboard],
          ["businesses", "Businesses", Building2],
          ["codes", "Bonus Codes", Ticket],
          ["admins", "Admins", ShieldCheck],
        ] as [Tab, string, typeof Building2][]).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === id ? "border-lime-400 text-lime-400" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            <Icon size={15} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </nav>

      <main className="p-4 sm:p-6">
        {tab === "overview" && (
          <OverviewTab
            rows={businesses}
            err={businessesErr}
            onRefresh={loadBusinesses}
            onDrillDown={applyFilterAndShowBusinesses}
          />
        )}
        {tab === "businesses" && (
          <BusinessesTab
            rows={businesses}
            err={businessesErr}
            onRefresh={loadBusinesses}
            incomingFilter={pendingFilter}
            onFilterConsumed={() => setPendingFilter(null)}
          />
        )}
        {tab === "codes" && <BonusCodesTab />}
        {tab === "admins" && <AdminsTab />}
      </main>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center p-4">
      <img src={logoFull} alt="Brigado" className="h-8 w-auto mb-6" />
      {children}
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = async (fn: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      // The auth listener in AdminDashboard takes it from here and runs
      // the server-side admin check.
    } catch {
      setError("Sign-in failed — check your credentials.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="w-full max-w-sm space-y-3">
        <div className="text-center mb-2">
          <div className="text-xs font-bold uppercase tracking-wider text-lime-400">Site Manager</div>
          <p className="text-xs text-slate-500 mt-1">Platform admin access only.</p>
        </div>
        <input
          className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm focus:outline-none focus:border-lime-400/50"
          type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
        />
        <input
          className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm focus:outline-none focus:border-lime-400/50"
          type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !busy) go(() => signInManagerWithEmail(email, password)); }}
        />
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <button
          disabled={busy || !email || !password}
          onClick={() => go(() => signInManagerWithEmail(email, password))}
          className="w-full px-4 py-2.5 bg-lime-400 text-slate-950 font-bold rounded-xl text-sm disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          disabled={busy}
          onClick={() => go(signInManagerWithGoogle)}
          className="w-full px-4 py-2.5 border border-slate-700 text-slate-300 font-semibold rounded-xl text-sm disabled:opacity-50"
        >
          Continue with Google
        </button>
      </div>
    </Shell>
  );
}

// ── OVERVIEW ──────────────────────────────────────────────────────────

/** Recharts styling to match StatsPage.tsx's dark-theme chart treatment —
 * the admin dashboard is dark-only, so these are constants rather than
 * theme-derived like StatsPage's equivalents. */
const CHART_GRID = "#1e293b";
const CHART_AXIS = "#64748b";
const TOOLTIP_STYLE = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, fontSize: 12 };
const TOOLTIP_LABEL = { color: "#e2e8f0", fontWeight: 700 };
const TOOLTIP_ITEM = { color: "#cbd5e1" };

/** Colours mirror STATUS_STYLES so a status reads the same in the chart
 * and in the Businesses list. */
const BREAKDOWN_COLORS: Record<string, string> = {
  Paying: "#a3e635",
  Trial: "#38bdf8",
  Comped: "#818cf8",
  Paused: "#fbbf24",
  "Pending deletion": "#f43f5e",
};

function KpiCard({ label, value, hint, tone, onClick }: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "warn" | "danger";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "danger" ? "text-rose-400" : tone === "warn" ? "text-amber-300" : "text-slate-100";
  const interactive = !!onClick;
  const Element = (interactive ? "button" : "div") as "button" | "div";
  return (
    <Element
      {...(interactive ? { onClick, type: "button" as const } : {})}
      className={`rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-left ${
        interactive ? "cursor-pointer transition-colors hover:border-lime-400/40 hover:bg-slate-900/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400" : ""
      }`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-600">{hint}</div>}
    </Element>
  );
}

function OverviewTab({ rows, err, onRefresh, onDrillDown }: {
  rows: Business[] | null;
  err: string;
  onRefresh: () => Promise<void> | void;
  onDrillDown: (f: BusinessFilter) => void;
}) {
  // Everything below is derived from the SAME rows the Businesses tab
  // renders — no extra query. useMemo keeps the derivation off the render
  // path for repeat renders; at realistic tenant counts (tens to low
  // thousands) these are trivial single passes over an in-memory array,
  // so this never blocks the dashboard's initial paint.
  const kpis = useMemo(() => {
    const r = rows ?? [];
    return {
      total: r.length,
      paying: r.filter(isPaying).length,
      trialing: r.filter(isTrialing).length,
      comped: r.filter(b => b.status === "comped").length,
      paused: r.filter(b => b.status === "paused").length,
      pendingDeletion: r.filter(b => b.status === "trial_expired").length,
      active24h: r.filter(b => isActiveWithin(b.lastActiveAt, "24h")).length,
      active7d: r.filter(b => isActiveWithin(b.lastActiveAt, "7d")).length,
    };
  }, [rows]);

  // Signups per MONTH over the last 12 months.
  //
  // Monthly (not weekly) is a deliberate choice for the current data
  // shape: production holds a single tenant dating from Jul 2026, so a
  // 12-week window would render one bar in eleven empty slots. Monthly
  // buckets stay readable while volume is low and remain sensible as it
  // grows; revisit to weekly once signups-per-week is routinely > 0.
  const signups = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; signups: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-GB", { month: "short" }),
        signups: 0,
      });
    }
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    let undated = 0;
    for (const b of rows ?? []) {
      if (!b.joinedAt) { undated++; continue; }
      const d = new Date(b.joinedAt);
      if (isNaN(d.getTime())) { undated++; continue; }
      const i = index.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      if (i !== undefined) buckets[i].signups++;
    }
    return { buckets, undated };
  }, [rows]);

  const breakdown = useMemo(() => {
    const r = rows ?? [];
    return [
      { name: "Paying", value: r.filter(isPaying).length },
      { name: "Trial", value: r.filter(isTrialing).length },
      { name: "Comped", value: r.filter(b => b.status === "comped").length },
      { name: "Paused", value: r.filter(b => b.status === "paused").length },
      { name: "Pending deletion", value: r.filter(b => b.status === "trial_expired").length },
    ].filter(s => s.value > 0);
  }, [rows]);

  const conversion = useMemo(() => {
    const outcomes = trialOutcomes(rows ?? []);
    const converted = outcomes.filter(o => o.converted).length;
    return { converted, completed: outcomes.length };
  }, [rows]);

  if (rows === null) return <p className="text-sm text-slate-500">Loading overview…</p>;

  return (
    <div className="space-y-6">
      {err && <p className="text-xs text-rose-400">{err}</p>}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-300">Platform overview</h2>
        <button onClick={() => { void onRefresh(); }} aria-label="Refresh"
          className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-lime-400">
          <RefreshCw size={15} strokeWidth={1.5} />
        </button>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total businesses" value={kpis.total} hint="all time" />
        <KpiCard label="Currently active" value={kpis.paying} hint="paying (Stripe linked)" />
        <KpiCard label="Currently on trial" value={kpis.trialing} hint="no Stripe customer yet" />
        <KpiCard label="Comped" value={kpis.comped} hint="free via bonus code" />
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Paused" value={kpis.paused} tone={kpis.paused ? "warn" : "default"} hint="admin-paused" />
        <KpiCard label="Pending deletion" value={kpis.pendingDeletion} tone={kpis.pendingDeletion ? "danger" : "default"} hint="in 30-day window" />
        <KpiCard
          label="Active in last 24h" value={kpis.active24h} hint="opened the app · click to filter"
          onClick={() => onDrillDown({ activity: "24h" })}
        />
        <KpiCard
          label="Active in last 7 days" value={kpis.active7d} hint="opened the app · click to filter"
          onClick={() => onDrillDown({ activity: "7d" })}
        />
      </div>

      {/* Conversion — a single current stat by design; see trialOutcomes(). */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Trial → paid conversion</div>
        {conversion.completed === 0 ? (
          <>
            <div className="mt-1 text-2xl font-bold text-slate-400">No completed trials yet</div>
            <p className="mt-1 text-[11px] text-slate-600">
              Counts a trial as complete once it either converts to a paying subscription or hits
              trial_expired. Comped and still-in-trial tenants are excluded.
            </p>
          </>
        ) : (
          <>
            <div className="mt-1 text-2xl font-bold text-lime-400">
              {conversion.converted} of {conversion.completed}
              <span className="ml-2 text-base font-semibold text-slate-400">
                ({Math.round((conversion.converted / conversion.completed) * 100)}%)
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-600">
              completed trials converted to paid. Comped and still-in-trial tenants excluded.
              {conversion.completed < 10 && " Small sample — read the raw counts, not the percentage."}
            </p>
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Signups — last 12 months
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={signups.buckets}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: CHART_AXIS }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: CHART_AXIS }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} cursor={{ fill: "#1e293b40" }} />
              <Bar dataKey="signups" fill="#a3e635" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {signups.undated > 0 && (
            <p className="mt-2 text-[11px] text-amber-300/80">
              {signups.undated} tenant{signups.undated === 1 ? "" : "s"} without a signup date, not shown.
              Run <code className="text-slate-400">scripts/backfill-created-at.mjs</code> to reconstruct.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Current status breakdown
          </div>
          {breakdown.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-600">No businesses yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {breakdown.map(s => <Cell key={s.name} fill={BREAKDOWN_COLORS[s.name] ?? "#64748b"} />)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {breakdown.map(s => (
              <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="h-2 w-2 rounded-full" style={{ background: BREAKDOWN_COLORS[s.name] ?? "#64748b" }} />
                {s.name} ({s.value})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── BUSINESSES ────────────────────────────────────────────────────────

function BusinessesTab({ rows, err, onRefresh, incomingFilter, onFilterConsumed }: {
  rows: Business[] | null;
  err: string;
  onRefresh: () => Promise<void> | void;
  incomingFilter: BusinessFilter | null;
  onFilterConsumed: () => void;
}) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState<"all" | "24h" | "7d">("all");
  const [pausing, setPausing] = useState<Business | null>(null);
  const [deleting, setDeleting] = useState<Business | null>(null);
  const [noting, setNoting] = useState<Business | null>(null);

  // Apply a filter handed over from an Overview KPI card, then clear it
  // upstream so it doesn't re-apply every time this tab re-renders (which
  // would make the filter dropdowns impossible to change by hand).
  useEffect(() => {
    if (!incomingFilter) return;
    setQ("");
    setStatusFilter(incomingFilter.status ?? "all");
    setPlanFilter(incomingFilter.plan ?? "all");
    setActivityFilter(incomingFilter.activity ?? "all");
    onFilterConsumed();
  }, [incomingFilter, onFilterConsumed]);

  const planBucket = (p: string) => (p.startsWith("Comped") ? "comped" : p === "Trial" ? "trial" : "paid");

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter(b => {
      if (needle && !b.name.toLowerCase().includes(needle) && !b.slug.toLowerCase().includes(needle)) return false;
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (planFilter !== "all" && planBucket(b.plan) !== planFilter) return false;
      if (activityFilter !== "all" && !isActiveWithin(b.lastActiveAt, activityFilter)) return false;
      return true;
    });
  }, [rows, q, statusFilter, planFilter, activityFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or slug…"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-lime-400/50"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="comped">Comped</option>
          <option value="paused">Paused</option>
          <option value="trial_expired">Pending deletion</option>
        </select>
        <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm">
          <option value="all">All plans</option>
          <option value="paid">Paid</option>
          <option value="trial">Trial</option>
          <option value="comped">Comped</option>
        </select>
        {/* Added with the Overview tab so its "Active in last 24h / 7d"
            cards have something to drill into. Also usable on its own. */}
        <select value={activityFilter} onChange={e => setActivityFilter(e.target.value as "all" | "24h" | "7d")}
          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm">
          <option value="all">Any activity</option>
          <option value="24h">Active last 24h</option>
          <option value="7d">Active last 7d</option>
        </select>
        <button onClick={() => { void onRefresh(); }} aria-label="Refresh" className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-lime-400">
          <RefreshCw size={15} strokeWidth={1.5} />
        </button>
      </div>

      {err && <p className="text-xs text-rose-400">{err}</p>}
      {rows === null && <p className="text-sm text-slate-500">Loading businesses…</p>}
      {rows !== null && filtered.length === 0 && <p className="text-sm text-slate-500">No businesses match.</p>}

      <div className="space-y-2">
        {filtered.map(b => (
          <div key={b.slug} className="border border-slate-800 rounded-2xl p-3 sm:p-4 bg-slate-900/40">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm">{b.name}</span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[b.status] ?? "bg-slate-800 text-slate-400 border-slate-700"}`}>
                    {b.status === "trial_expired" ? (b.deletionReason === "admin_delete" ? "deleting" : "expired") : b.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  /{b.slug}{b.city ? ` · ${b.city}` : ""} · {b.plan} · {b.staffCount} staff
                </div>
                <div className="text-[11px] text-slate-600 mt-0.5">
                  Joined {fmtDate(b.joinedAt)} · Active {fmtRelative(b.lastActiveAt)}
                  {b.pausedAt && ` · Paused ${fmtDate(b.pausedAt)}`}
                  {b.trialExpiredAt && ` · Deletes ${fmtDate(new Date(Date.parse(b.trialExpiredAt) + 30 * 86_400_000).toISOString())}`}
                </div>
                {b.pauseReason && <div className="text-[11px] text-amber-300/80 mt-1">Pause note: {b.pauseReason}</div>}
                {b.adminNotes && <div className="text-[11px] text-slate-400 mt-1 italic">{b.adminNotes}</div>}
              </div>

              <div className="flex items-center gap-1">
                <button onClick={() => setNoting(b)} aria-label="Notes" title="Admin notes"
                  className="p-2 rounded-lg border border-slate-800 text-slate-400 hover:text-lime-400">
                  <StickyNote size={14} strokeWidth={1.5} />
                </button>
                {b.status === "paused" ? (
                  <button onClick={async () => { await call("adminResumeBusiness")({ slug: b.slug }); void onRefresh(); }}
                    title="Resume" aria-label="Resume"
                    className="p-2 rounded-lg border border-slate-800 text-slate-400 hover:text-lime-400">
                    <PlayCircle size={14} strokeWidth={1.5} />
                  </button>
                ) : b.status !== "trial_expired" ? (
                  <button onClick={() => setPausing(b)} title="Pause" aria-label="Pause"
                    className="p-2 rounded-lg border border-slate-800 text-slate-400 hover:text-amber-400">
                    <PauseCircle size={14} strokeWidth={1.5} />
                  </button>
                ) : null}
                {b.status !== "trial_expired" && (
                  <button onClick={() => setDeleting(b)} title="Delete" aria-label="Delete"
                    className="p-2 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400">
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {pausing && <PauseDialog business={pausing} onClose={() => setPausing(null)} onDone={() => { setPausing(null); void onRefresh(); }} />}
      {deleting && <DeleteDialog business={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); void onRefresh(); }} />}
      {noting && <NotesDialog business={noting} onClose={() => setNoting(null)} onDone={() => { setNoting(null); void onRefresh(); }} />}
    </div>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PauseDialog({ business, onClose, onDone }: { business: Business; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Dialog title={`Pause ${business.name}?`} onClose={onClose}>
      <p className="text-xs text-slate-400 mb-3">
        Managers and staff will both be locked out immediately and shown a "contact us" screen.
        There is <b>no deletion countdown</b> — it stays paused until you resume it.
      </p>
      <input
        value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Reason (optional, for your reference)"
        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm mb-3 focus:outline-none focus:border-lime-400/50"
      />
      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl border border-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true); setErr("");
            try { await call("adminPauseBusiness")({ slug: business.slug, reason }); onDone(); }
            catch (e) { setErr((e as Error).message); setBusy(false); }
          }}
          className="flex-1 px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-50"
        >
          {busy ? "Pausing…" : "Pause"}
        </button>
      </div>
    </Dialog>
  );
}

function DeleteDialog({ business, onClose, onDone }: { business: Business; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const matches = typed.trim() === business.name.trim();
  return (
    <Dialog title={`Delete ${business.name}?`} onClose={onClose}>
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 mb-3 space-y-2">
        <p className="text-xs text-rose-300">
          This blocks the restaurant immediately and schedules permanent deletion of all
          its data in <b>30 days</b>. It enters the same retention pipeline as a real trial
          expiry — recoverable until then, irreversible after.
        </p>
        {business.hasStripe && (
          <p className="text-xs text-amber-300">
            ⚠ This business has a Stripe customer. The subscription is <b>not</b> cancelled
            automatically — cancel it in Stripe if billing should stop.
          </p>
        )}
      </div>
      <label className="text-[11px] text-slate-400">Type <b className="text-slate-200">{business.name}</b> to confirm</label>
      <input
        value={typed} onChange={e => setTyped(e.target.value)} autoFocus
        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm mt-1 mb-3 focus:outline-none focus:border-rose-400/50"
      />
      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl border border-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
        <button
          disabled={busy || !matches}
          onClick={async () => {
            setBusy(true); setErr("");
            try { await call("adminDeleteBusiness")({ slug: business.slug, confirmName: typed.trim() }); onDone(); }
            catch (e) { setErr((e as Error).message); setBusy(false); }
          }}
          className="flex-1 px-4 py-2 rounded-xl bg-rose-500 text-white text-sm font-bold disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </Dialog>
  );
}

function NotesDialog({ business, onClose, onDone }: { business: Business; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState(business.adminNotes || "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Notes — ${business.name}`} onClose={onClose}>
      <textarea
        value={notes} onChange={e => setNotes(e.target.value)} rows={5}
        placeholder="Private notes, only visible here."
        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm mb-3 focus:outline-none focus:border-lime-400/50"
      />
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); await call("adminSetNotes")({ slug: business.slug, notes }); onDone(); }}
        className="w-full px-4 py-2 rounded-xl bg-lime-400 text-slate-950 text-sm font-bold disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </Dialog>
  );
}

// ── BONUS CODES ───────────────────────────────────────────────────────

function BonusCodesTab() {
  const [codes, setCodes] = useState<BonusCode[] | null>(null);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<BonusCode | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await call<{ codes: BonusCode[] }>("adminListBonusCodes")({});
      setCodes(res.data.codes);
    } catch (e) { setErr((e as Error).message); setCodes([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-lime-400 text-slate-950 text-sm font-bold">
          <Plus size={15} strokeWidth={2} /> New code
        </button>
        <button onClick={load} aria-label="Refresh" className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-lime-400">
          <RefreshCw size={15} strokeWidth={1.5} />
        </button>
      </div>

      {err && <p className="text-xs text-rose-400">{err}</p>}
      {codes === null && <p className="text-sm text-slate-500">Loading codes…</p>}
      {codes !== null && codes.length === 0 && <p className="text-sm text-slate-500">No bonus codes yet.</p>}

      <div className="space-y-2">
        {(codes ?? []).map(c => {
          const exhausted = c.redemptionCount >= c.maxRedemptions;
          const expired = !!c.expiresAt && Date.parse(c.expiresAt) < Date.now();
          return (
            <div key={c.code} className="border border-slate-800 rounded-2xl p-3 sm:p-4 bg-slate-900/40 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-sm text-lime-400">{c.code}</span>
                  {!c.active && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-slate-800 text-slate-400 border-slate-700">inactive</span>}
                  {expired && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-rose-500/10 text-rose-400 border-rose-500/30">expired</span>}
                  {exhausted && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border bg-amber-400/10 text-amber-300 border-amber-400/30">used up</span>}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {c.durationDays === null ? "Permanent comp" : `${c.durationDays} days free`}
                  {" · "}{c.redemptionCount}/{c.maxRedemptions} redeemed
                  {c.expiresAt && ` · code expires ${fmtDate(c.expiresAt)}`}
                </div>
                {c.note && <div className="text-[11px] text-slate-600 mt-0.5 italic">{c.note}</div>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setViewing(c)} className="text-[11px] font-semibold text-slate-400 hover:text-lime-400 underline">
                  Redemptions
                </button>
                <button
                  onClick={async () => { await call("adminToggleBonusCode")({ code: c.code, active: !c.active }); load(); }}
                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold ${c.active ? "border-slate-700 text-slate-300" : "border-lime-400/40 text-lime-400"}`}
                >
                  {c.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {creating && <CreateCodeDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {viewing && <RedemptionsDialog code={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CreateCodeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [permanent, setPermanent] = useState(false);
  const [durationDays, setDurationDays] = useState("90");
  const [maxRedemptions, setMaxRedemptions] = useState("1");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  return (
    <Dialog title="New bonus code" onClose={onClose}>
      <div className="space-y-3">
        <input
          value={code} onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="CODE (A-Z 0-9 -)" autoFocus
          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm font-mono focus:outline-none focus:border-lime-400/50"
        />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={permanent} onChange={e => setPermanent(e.target.checked)} />
          Permanent (never expires for the restaurant)
        </label>
        {!permanent && (
          <input
            value={durationDays} onChange={e => setDurationDays(e.target.value)} inputMode="numeric"
            placeholder="Free days"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
          />
        )}
        <input
          value={maxRedemptions} onChange={e => setMaxRedemptions(e.target.value)} inputMode="numeric"
          placeholder="Max redemptions"
          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
        />
        <div>
          <label className="text-[11px] text-slate-500">Code stops working after (optional)</label>
          <input
            type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
          />
        </div>
        <input
          value={note} onChange={e => setNote(e.target.value)} placeholder="Note (e.g. which campaign)"
          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
        />
        {err && <p className="text-xs text-rose-400">{err}</p>}
        <button
          disabled={busy || code.trim().length < 3}
          onClick={async () => {
            setBusy(true); setErr("");
            try {
              await call("adminCreateBonusCode")({
                code: code.trim(),
                durationDays: permanent ? null : Number(durationDays),
                maxRedemptions: Number(maxRedemptions),
                note,
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              });
              onDone();
            } catch (e) { setErr((e as Error).message); setBusy(false); }
          }}
          className="w-full px-4 py-2 rounded-xl bg-lime-400 text-slate-950 text-sm font-bold disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create code"}
        </button>
      </div>
    </Dialog>
  );
}

function RedemptionsDialog({ code, onClose }: { code: BonusCode; onClose: () => void }) {
  const [rows, setRows] = useState<{ slug: string; redeemedAt: string | null; restaurantName: string }[] | null>(null);
  useEffect(() => {
    call<{ redemptions: { slug: string; redeemedAt: string | null; restaurantName: string }[] }>("adminListRedemptions")({ code: code.code })
      .then(r => setRows(r.data.redemptions))
      .catch(() => setRows([]));
  }, [code.code]);
  return (
    <Dialog title={`Redemptions — ${code.code}`} onClose={onClose}>
      {rows === null && <p className="text-sm text-slate-500">Loading…</p>}
      {rows?.length === 0 && <p className="text-sm text-slate-500">Not redeemed yet.</p>}
      <div className="space-y-2">
        {(rows ?? []).map(r => (
          <div key={r.slug} className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
            <div>
              <div className="font-semibold text-slate-200">{r.restaurantName}</div>
              <div className="text-slate-600">/{r.slug}</div>
            </div>
            <span className="text-slate-500">{fmtDate(r.redeemedAt)}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ── ADMINS ────────────────────────────────────────────────────────────

function AdminsTab() {
  const [admins, setAdmins] = useState<{ email: string; addedAt: string | null; addedBy: string | null }[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await call<{ admins: { email: string; addedAt: string | null; addedBy: string | null }[] }>("adminListAdmins")({});
      setAdmins(res.data.admins);
    } catch (e) { setErr((e as Error).message); setAdmins([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-xs text-slate-500">
        Platform admins can see and act on every business. Adding one grants full access
        immediately — there is no confirmation email.
      </p>
      <div className="flex gap-2">
        <input
          value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" type="email"
          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
        />
        <button
          disabled={busy || !email.includes("@")}
          onClick={async () => {
            setBusy(true); setErr("");
            try { await call("adminAddAdmin")({ email }); setEmail(""); load(); }
            catch (e) { setErr((e as Error).message); }
            finally { setBusy(false); }
          }}
          className="px-4 py-2 rounded-xl bg-lime-400 text-slate-950 text-sm font-bold disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <div className="space-y-2">
        {(admins ?? []).map(a => (
          <div key={a.email} className="border border-slate-800 rounded-xl p-3 bg-slate-900/40">
            <div className="text-sm font-semibold">{a.email}</div>
            <div className="text-[11px] text-slate-600">Added {fmtDate(a.addedAt)} by {a.addedBy ?? "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
