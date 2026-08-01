import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { LandingLang } from "../utils/landingCopy";
import Footer from "./Footer";
import MarketingBackground from "./MarketingBackground";
import logoFull from "../assets/logo-full.png";

// Static confirmation page — Stripe Payment Links redirect here after
// checkout. No payment-status verification needed client-side; the
// provisioning webhook (stripeWebhook) does the real work server-side.
export default function WelcomePage() {
  const [lang, setLang] = useState<LandingLang>("fr");

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <MarketingBackground />

      <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-slate-900">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <img src={logoFull} alt="Brigado" className="h-6 w-auto" />
          </a>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[10px] font-bold">
            <button className={`px-2 py-1 rounded ${lang === "fr" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`} onClick={() => setLang("fr")}>FR</button>
            <button className={`px-2 py-1 rounded ${lang === "en" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-lime-400/10 border border-lime-400/30 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="text-lime-400" size={32} strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">
            {lang === "fr" ? "Vous êtes prêt !" : "You're all set!"}
          </h1>
          <p className="text-sm font-normal text-slate-400 leading-relaxed mb-8">
            {lang === "fr"
              ? "Merci pour votre inscription. Vérifiez votre boîte mail — vous allez recevoir un lien pour créer votre mot de passe et accéder à votre espace gérant."
              : "Thanks for signing up. Check your inbox — you'll receive a link to set your password and access your manager dashboard."}
          </p>
          <a
            href="/"
            className="inline-block px-6 py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all text-sm"
          >
            {lang === "fr" ? "Retour à l'accueil" : "Back to home"}
          </a>
        </div>
      </div>

      <Footer lang={lang} />
    </div>
  );
}
