import React, { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { signInManagerWithEmail, signInManagerWithGoogle, isAuthorizedManager, signOutManager } from "../utils/auth";
import { LangType } from "../utils/translations";
import logoFull from "../assets/logo-full.png";
import { PauseCircle, Lock } from "lucide-react";

// Full-screen block shown instead of the app when the tenant's
// subscriptionStatus is "trial_expired" (see App.tsx). Nothing behind it
// is reachable — neither the staff PIN pad nor the manager dashboard
// mounts while this is on screen. The only interactive path is the
// reactivation sign-in below, which exists because the Stripe billing
// portal URL exposes billing details and therefore must only ever be
// created for a verified manager of THIS restaurant, never handed to
// whoever happens to know the slug.

const RETENTION_DAYS = 30;

interface Props {
  slug: string;
  trialExpiredAt?: string;
  lang: LangType;
  setLang: (lang: LangType) => void;
  theme: "light" | "dark";
}

export default function TrialExpiredScreen({ slug, trialExpiredAt, lang, setLang, theme }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fr = lang === "fr";

  const expiredMs = Date.parse(trialExpiredAt || "");
  const deletionDate = isNaN(expiredMs) ? null : new Date(expiredMs + RETENTION_DAYS * 86_400_000);
  const deletionDateLabel = deletionDate
    ? deletionDate.toLocaleDateString(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const openBillingPortal = async (signIn: () => Promise<{ uid: string }>) => {
    setError("");
    setBusy(true);
    try {
      const user = await signIn();
      if (!(await isAuthorizedManager(user.uid))) {
        await signOutManager();
        setError(fr ? "Ce compte n'est pas gérant de ce restaurant." : "This account is not a manager of this restaurant.");
        return;
      }
      const createSession = httpsCallable(functions, "createBillingPortalSession");
      const result = await createSession({ restaurantId: slug });
      window.location.href = (result.data as { url: string }).url;
    } catch (err) {
      console.error("Reactivation sign-in failed:", err);
      setError(fr ? "Connexion impossible — vérifiez vos identifiants." : "Sign-in failed — check your credentials.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center p-4 ${theme === "light" ? "theme-light bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
      <div className="w-full max-w-md space-y-5 text-center">
        <img src={logoFull} alt="Brigado" className="h-8 w-auto mx-auto" />

        <div className="flex justify-center gap-1 text-[11px]">
          <button onClick={() => setLang("fr")} className={`px-2 py-0.5 rounded ${fr ? "bg-lime-400 text-slate-950 font-bold" : "text-slate-500"}`}>FR</button>
          <button onClick={() => setLang("en")} className={`px-2 py-0.5 rounded ${!fr ? "bg-lime-400 text-slate-950 font-bold" : "text-slate-500"}`}>EN</button>
        </div>

        <PauseCircle size={40} className="mx-auto text-amber-400" />

        <h1 className="text-lg font-bold">
          {fr ? "Votre essai est terminé" : "Your trial has ended"}
        </h1>

        <p className="text-sm text-slate-400">
          {fr
            ? "L'essai gratuit de ce restaurant s'est terminé sans abonnement actif. L'accès est suspendu pour toute l'équipe — gérants comme personnel."
            : "This restaurant's free trial ended without an active subscription. Access is paused for everyone — managers and staff alike."}
        </p>

        <p className="text-sm text-slate-400">
          {fr
            ? <>Vos données (heures, plannings, personnel) sont conservées intactes pendant <b>{RETENTION_DAYS} jours</b>. Réactivez votre abonnement avant cette échéance et tout sera restauré immédiatement.</>
            : <>Your data (hours, schedules, staff records) is kept fully intact for <b>{RETENTION_DAYS} days</b>. Reactivate before then and everything is restored immediately.</>}
        </p>

        {deletionDateLabel && (
          <p className="text-sm font-semibold text-rose-400">
            {fr
              ? `Sans réactivation, toutes les données seront définitivement supprimées le ${deletionDateLabel}.`
              : `Without reactivation, all data will be permanently deleted on ${deletionDateLabel}.`}
          </p>
        )}

        <div className={`rounded-2xl border p-4 space-y-3 text-left ${theme === "light" ? "border-slate-200 bg-white" : "border-slate-800 bg-slate-900"}`}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Lock size={12} />
            {fr ? "Réactiver — connexion gérant" : "Reactivate — manager sign-in"}
          </div>
          <input
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 placeholder-slate-600"
            type="email"
            placeholder={fr ? "E-mail gérant" : "Manager email"}
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <input
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50 placeholder-slate-600"
            type="password"
            placeholder={fr ? "Mot de passe" : "Password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !busy) openBillingPortal(() => signInManagerWithEmail(email, password)); }}
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            className="w-full px-4 py-2.5 bg-lime-400 text-slate-950 font-bold rounded-xl text-sm disabled:opacity-50"
            disabled={busy || !email || !password}
            onClick={() => openBillingPortal(() => signInManagerWithEmail(email, password))}
          >
            {busy
              ? (fr ? "Ouverture du portail de paiement…" : "Opening billing portal…")
              : (fr ? "Gérer mon abonnement" : "Manage my subscription")}
          </button>
          <button
            className="w-full px-4 py-2.5 border border-slate-700 text-slate-300 font-semibold rounded-xl text-sm disabled:opacity-50"
            disabled={busy}
            onClick={() => openBillingPortal(signInManagerWithGoogle)}
          >
            {fr ? "Continuer avec Google" : "Continue with Google"}
          </button>
        </div>

        <p className="text-xs text-slate-500">
          {fr
            ? <>Un souci ? Écrivez-nous : <a href="mailto:info@brigado.solutions" className="text-lime-400 underline">info@brigado.solutions</a></>
            : <>Need help? Write to us: <a href="mailto:info@brigado.solutions" className="text-lime-400 underline">info@brigado.solutions</a></>}
        </p>
      </div>
    </div>
  );
}
