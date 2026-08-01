import React, { useState } from "react";
import {
  ArrowLeft, Clock, ShieldCheck, BarChart3, MessageSquare, Zap, Globe, Check,
} from "lucide-react";
import { LandingLang } from "../utils/landingCopy";
import { FEATURE_CATEGORIES } from "../utils/featuresCopy";
import Footer from "./Footer";
import MarketingBackground from "./MarketingBackground";
import logoFull from "../assets/logo-full.png";

const ICONS: Record<string, any> = { Clock, ShieldCheck, BarChart3, MessageSquare, Zap, Globe };

export default function Features() {
  const [lang, setLang] = useState<LandingLang>("fr");

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans">
      <MarketingBackground />

      {/* TOP BAR */}
      <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-slate-900">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <img src={logoFull} alt="Brigado" className="h-6 w-auto" />
          </a>
          <div className="flex items-center gap-3">
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[10px] font-bold">
              <button className={`px-2 py-1 rounded ${lang === "fr" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`} onClick={() => setLang("fr")}>FR</button>
              <button className={`px-2 py-1 rounded ${lang === "en" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`} onClick={() => setLang("en")}>EN</button>
            </div>
            <a href="/register" className="px-3.5 py-1.5 bg-lime-400 text-slate-950 rounded-lg text-xs font-bold hover:bg-lime-300 transition-all">
              {lang === "fr" ? "S'inscrire" : "Sign up"}
            </a>
          </div>
        </div>
      </div>

      {/* HEADER */}
      <div className="max-w-4xl mx-auto px-6 pt-16 pb-12 text-center">
        <a href="/" className="inline-flex items-center gap-2 text-xs font-normal text-slate-500 hover:text-lime-400 transition-colors mb-6">
          <ArrowLeft size={14} strokeWidth={1.5} /> {lang === "fr" ? "Retour à l'accueil" : "Back to home"}
        </a>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">
          {lang === "fr" ? "Tout ce que fait Brigado" : "Everything Brigado does"}
        </h1>
        <p className="text-slate-400 font-normal text-sm sm:text-base max-w-xl mx-auto">
          {lang === "fr"
            ? "Une vue complète, honnête, de chaque fonctionnalité — y compris ce qui est optionnel et désactivable."
            : "A complete, honest view of every feature — including what's optional and can be turned off."}
        </p>
        <div className="mx-auto mt-6 h-px w-16 bg-gradient-to-r from-transparent via-lime-400/60 to-transparent" />
      </div>

      {/* CATEGORIES */}
      <div className="max-w-4xl mx-auto px-6 pb-24 space-y-12">
        {FEATURE_CATEGORIES.map((cat, i) => {
          const Icon = ICONS[cat.icon] ?? Zap;
          return (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-lime-400/10 border border-lime-400/30 flex items-center justify-center flex-shrink-0">
                  <Icon size={18} strokeWidth={1.5} className="text-lime-400" />
                </div>
                <h2 className="text-lg font-bold text-slate-100">{lang === "fr" ? cat.titleFr : cat.titleEn}</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {cat.items.map((item, j) => (
                  <div key={j} className="flex gap-2.5">
                    <Check size={15} strokeWidth={1.5} className="text-lime-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">{lang === "fr" ? item.titleFr : item.titleEn}</h3>
                      <p className="text-xs font-normal text-slate-500 mt-0.5 leading-relaxed">{lang === "fr" ? item.descFr : item.descEn}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* CTA */}
        <div className="text-center pt-6">
          <a href="/register" className="inline-block px-6 py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all text-sm">
            {lang === "fr" ? "Essayer Brigado gratuitement pendant 7 jours" : "Try Brigado free for 7 days"}
          </a>
        </div>
      </div>

      <Footer lang={lang} />
    </div>
  );
}
