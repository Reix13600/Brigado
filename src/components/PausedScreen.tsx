import React from "react";
import { LangType } from "../utils/translations";
import logoFull from "../assets/logo-full.png";
import { PauseCircle } from "lucide-react";

// Shown instead of the app when subscriptionStatus === "paused".
//
// Same blocking mechanism as TrialExpiredScreen (App.tsx gates before
// either dashboard mounts, and firestore.rules denies the tenant's
// subcollections), but deliberately DIFFERENT copy:
//
//   - No deletion date. A pause has no countdown — it stays paused until
//     an admin resumes or deletes it. Showing a date here would be a lie.
//   - No billing-portal reactivation button. That flow is Stripe-specific
//     and cannot lift an admin pause; only an admin can. Offering it
//     would send people into a payment screen that changes nothing.
//
// So the only call to action is contacting support, which is the honest
// one: the customer genuinely cannot resolve this themselves.

interface Props {
  lang: LangType;
  setLang: (lang: LangType) => void;
  theme: "light" | "dark";
}

export default function PausedScreen({ lang, setLang, theme }: Props) {
  const fr = lang === "fr";

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
          {fr ? "Votre compte est en pause" : "Your account is paused"}
        </h1>

        <p className="text-sm text-slate-400">
          {fr
            ? "L'accès à Brigado est temporairement suspendu pour ce restaurant — gérants comme personnel."
            : "Access to Brigado is temporarily suspended for this restaurant — managers and staff alike."}
        </p>

        <p className="text-sm text-slate-400">
          {fr
            ? "Vos données sont conservées intactes. Contactez-nous pour rétablir l'accès."
            : "Your data is kept fully intact. Contact us to restore access."}
        </p>

        <div className={`rounded-2xl border p-4 ${theme === "light" ? "border-slate-200 bg-white" : "border-slate-800 bg-slate-900"}`}>
          <a
            href="mailto:info@brigado.solutions"
            className="text-sm font-bold text-lime-400 underline"
          >
            info@brigado.solutions
          </a>
        </div>
      </div>
    </div>
  );
}
