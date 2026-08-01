import React from "react";
import { L, LandingLang } from "../utils/landingCopy";
import logoIcon from "../assets/logo-icon.png";

interface FooterProps {
  lang: LandingLang;
}

export default function Footer({ lang }: FooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer className="relative border-t border-slate-800 bg-slate-950">
      <div className="max-w-5xl mx-auto px-6 py-14 grid grid-cols-2 sm:grid-cols-4 gap-8">
        <div className="col-span-2 sm:col-span-1">
          <div className="flex items-center gap-2 mb-2">
            <img src={logoIcon} alt="Brigado" className="h-6 w-6" />
            <span className="font-bold text-slate-200">Brigado</span>
          </div>
          <p className="text-xs font-normal text-slate-500 leading-relaxed">{L(lang, "footerTagline")}</p>
        </div>

        <div>
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            {lang === "fr" ? "Produit" : "Product"}
          </h4>
          <ul className="space-y-1.5 text-xs font-normal text-slate-500">
            <li><a href="/features" className="hover:text-lime-400 transition-colors">{lang === "fr" ? "Fonctionnalités" : "Features"}</a></li>
          </ul>
        </div>

        <div>
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{L(lang, "footerLegal")}</h4>
          <ul className="space-y-1.5 text-xs font-normal text-slate-500">
            <li><a href="/mentions-legales" className="hover:text-lime-400 transition-colors">{L(lang, "footerMentions")}</a></li>
            <li><a href="/cgv" className="hover:text-lime-400 transition-colors">{L(lang, "footerCGV")}</a></li>
            <li><a href="/confidentialite" className="hover:text-lime-400 transition-colors">{L(lang, "footerPrivacy")}</a></li>
          </ul>
        </div>

        <div>
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{L(lang, "footerContact")}</h4>
          <ul className="space-y-1.5 text-xs font-normal text-slate-500">
            <li><a href="/contact" className="hover:text-lime-400 transition-colors">{L(lang, "footerContact")}</a></li>
            <li><a href="mailto:info@brigado.solutions" className="hover:text-lime-400 transition-colors">info@brigado.solutions</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-900 py-4 text-center text-[10px] font-normal text-slate-600">
        © {year} Brigado. {L(lang, "footerRights")}
      </div>
    </footer>
  );
}
