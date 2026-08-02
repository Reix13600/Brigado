import React, { useState } from "react";
import { X, LogIn } from "lucide-react";
import { signInManagerWithEmail, signInManagerWithGoogle, getManagerRestaurantId } from "../utils/auth";
import { LandingLang } from "../utils/landingCopy";
import logoFull from "../assets/logo-full.png";

interface LoginModalProps {
  lang: LandingLang;
  onClose: () => void;
}

// Manager login from the public marketing pages. On success we look up the
// manager's restaurant and do a FULL page navigation to /{slug} — App.tsx
// resolves the restaurant context exactly once per page load, so a
// client-side state change alone would land on a page with no context.
export default function LoginModal({ lang, onClose }: LoginModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResetInfo, setShowResetInfo] = useState(false);

  const fr = lang === "fr";

  const errorMessage = (code: string): string => {
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
      case "auth/invalid-email":
        return fr ? "E-mail ou mot de passe incorrect." : "Wrong email or password.";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return fr ? "Connexion annulée." : "Sign-in was cancelled.";
      case "auth/too-many-requests":
        return fr ? "Trop de tentatives — réessayez dans quelques minutes." : "Too many attempts — try again in a few minutes.";
      default:
        return fr ? "Échec de la connexion — réessayez." : "Sign-in failed — please try again.";
    }
  };

  const finishLogin = async (uid: string) => {
    const restaurantId = await getManagerRestaurantId(uid);
    if (restaurantId) {
      window.location.href = "/" + restaurantId;
      return;
    }
    setError(fr
      ? "Ce compte n'est lié à aucun restaurant. Contactez info@brigado.solutions si vous pensez qu'il s'agit d'une erreur."
      : "This account isn't linked to any restaurant. Contact info@brigado.solutions if you think this is a mistake.");
  };

  const handleEmailLogin = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const user = await signInManagerWithEmail(email.trim(), password);
      await finishLogin(user.uid);
    } catch (err: any) {
      console.error(err);
      setError(errorMessage(err?.code ?? ""));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await signInManagerWithGoogle();
      await finishLogin(user.uid);
    } catch (err: any) {
      console.error(err);
      setError(errorMessage(err?.code ?? ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="backdrop-blur-md bg-slate-900/80 border border-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl shadow-lime-400/[0.04] animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <img src={logoFull} alt="Brigado" className="h-6 w-auto mb-3" />
            <h3 className="text-base font-bold text-slate-100">{fr ? "Connexion gérant" : "Manager log in"}</h3>
            <p className="text-xs font-normal text-slate-500 mt-1">
              {fr ? "Retrouvez votre restaurant sans retenir son adresse exacte." : "Get back to your restaurant without remembering its exact address."}
            </p>
          </div>
          <button className="p-1 text-slate-500 hover:text-slate-200 transition-colors" onClick={onClose} aria-label={fr ? "Fermer" : "Close"}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">E-mail</label>
            <input
              type="email"
              className="w-full bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
              placeholder="you@restaurant.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              {fr ? "Mot de passe" : "Password"}
            </label>
            <input
              type="password"
              className="w-full bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-sm text-slate-200 focus:outline-none focus:border-lime-400/50"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleEmailLogin(); }}
            />
          </div>

          {error && <p className="text-xs font-normal text-rose-400 leading-relaxed">{error}</p>}

          <button
            className="w-full py-2.5 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all disabled:opacity-40 text-sm flex items-center justify-center gap-2"
            onClick={handleEmailLogin}
            disabled={busy || !email.trim() || !password}
          >
            <LogIn size={15} strokeWidth={1.5} /> {busy ? "..." : (fr ? "Se connecter" : "Log in")}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-800" />
            <span className="text-[10px] text-slate-600">{fr ? "ou" : "or"}</span>
            <div className="flex-1 h-px bg-slate-800" />
          </div>

          <button
            className="w-full py-2.5 bg-slate-950/60 border border-slate-800 hover:border-slate-700 text-slate-200 font-semibold rounded-xl transition-all disabled:opacity-40 text-sm flex items-center justify-center gap-2"
            onClick={handleGoogleLogin}
            disabled={busy}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            {fr ? "Continuer avec Google" : "Sign in with Google"}
          </button>

          <button
            className="text-[11px] font-semibold text-slate-500 hover:text-lime-400 underline decoration-slate-700 hover:decoration-lime-400 underline-offset-2 transition-all"
            onClick={() => setShowResetInfo(v => !v)}
          >
            {fr ? "Mot de passe oublié ?" : "Forgot password?"}
          </button>
          {showResetInfo && (
            <p className="text-[11px] font-normal text-slate-400 leading-relaxed bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              {fr
                ? "La réinitialisation du mot de passe n'est pas encore disponible — écrivez à info@brigado.solutions et nous vous aiderons à le réinitialiser."
                : "Password reset isn't available yet — email info@brigado.solutions and we'll help you reset it."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
