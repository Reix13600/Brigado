import React, { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { LandingLang } from "../utils/landingCopy";
import Footer from "./Footer";
import logoFull from "../assets/logo-full.png";

interface LegalPageProps {
  type: "mentions" | "cgv" | "privacy";
}

const TITLES: Record<LegalPageProps["type"], { fr: string; en: string }> = {
  mentions: { fr: "Mentions légales", en: "Legal notice" },
  cgv: { fr: "Conditions générales de vente", en: "Terms of service" },
  privacy: { fr: "Politique de confidentialité", en: "Privacy policy" },
};

// Placeholder pages — real legal content to be added by the site owner.
// Kept intentionally simple and isolated so dropping in the final text
// later is a one-file edit, not a redesign.
export default function LegalPage({ type }: LegalPageProps) {
  const [lang, setLang] = useState<LandingLang>("fr");
  const title = TITLES[type][lang];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <div className="max-w-3xl mx-auto px-6 pt-10 pb-16 flex-1 w-full">
        <div className="flex items-center justify-between mb-10">
          <a href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-lime-400 transition-colors">
            <ArrowLeft size={16} /> {lang === "fr" ? "Retour à l'accueil" : "Back to home"}
          </a>
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[10px] font-bold">
            <button className={`px-2 py-1 rounded ${lang === "fr" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`} onClick={() => setLang("fr")}>FR</button>
            <button className={`px-2 py-1 rounded ${lang === "en" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`} onClick={() => setLang("en")}>EN</button>
          </div>
        </div>

        <img src={logoFull} alt="Brigado" className="h-8 w-auto mb-8" />
        <h1 className="text-2xl font-extrabold mb-6">{title}</h1>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-sm text-slate-400 leading-relaxed">
          <p>
            {lang === "fr"
              ? "Le contenu de cette page est en cours de rédaction et sera ajouté prochainement."
              : "This page's content is being finalized and will be added soon."}
          </p>
          <p className="mt-3">
            {lang === "fr"
              ? "Pour toute question en attendant, contactez-nous directement :"
              : "For any question in the meantime, contact us directly:"}{" "}
            <a href="mailto:info@brigado.solutions" className="text-lime-400 underline">info@brigado.solutions</a>
          </p>
        </div>
      </div>
      <Footer lang={lang} />
    </div>
  );
}
