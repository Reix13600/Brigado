import React, { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { signInManagerWithEmail, signInManagerWithGoogle, signOutManager, watchAuthState } from "../utils/auth";
import logoFull from "../assets/logo-full.png";
import {
  Building2, Ticket, ShieldCheck, Search, PauseCircle, PlayCircle,
  Trash2, StickyNote, Plus, RefreshCw, LogOut, AlertTriangle, X,
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

type Tab = "businesses" | "codes" | "admins";

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

export default function AdminDashboard() {
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("businesses");

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
        {tab === "businesses" && <BusinessesTab />}
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

// ── BUSINESSES ────────────────────────────────────────────────────────

function BusinessesTab() {
  const [rows, setRows] = useState<Business[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [pausing, setPausing] = useState<Business | null>(null);
  const [deleting, setDeleting] = useState<Business | null>(null);
  const [noting, setNoting] = useState<Business | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await call<{ businesses: Business[] }>("adminListBusinesses")({});
      setRows(res.data.businesses);
    } catch (e) {
      setErr((e as Error).message || "Failed to load");
      setRows([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const planBucket = (p: string) => (p.startsWith("Comped") ? "comped" : p === "Trial" ? "trial" : "paid");

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter(b => {
      if (needle && !b.name.toLowerCase().includes(needle) && !b.slug.toLowerCase().includes(needle)) return false;
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (planFilter !== "all" && planBucket(b.plan) !== planFilter) return false;
      return true;
    });
  }, [rows, q, statusFilter, planFilter]);

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
        <button onClick={load} aria-label="Refresh" className="p-2 rounded-xl border border-slate-800 text-slate-400 hover:text-lime-400">
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
                  <button onClick={async () => { await call("adminResumeBusiness")({ slug: b.slug }); load(); }}
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

      {pausing && <PauseDialog business={pausing} onClose={() => setPausing(null)} onDone={() => { setPausing(null); load(); }} />}
      {deleting && <DeleteDialog business={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); load(); }} />}
      {noting && <NotesDialog business={noting} onClose={() => setNoting(null)} onDone={() => { setNoting(null); load(); }} />}
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
