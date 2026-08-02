import React, { useState } from "react";
import { Clock, Users, BarChart3, ShieldCheck, MessageSquare, CalendarClock, ChevronDown, UserPlus, QrCode, Smartphone, ArrowRight } from "lucide-react";
import logoFull from "../assets/logo-full.png";
import { L, LandingLang } from "../utils/landingCopy";
import Footer from "./Footer";
import MarketingBackground from "./MarketingBackground";
import LoginModal from "./LoginModal";
import screenshotOverview from "../assets/screenshots/screenshot-overview.webp";
import screenshotStaff from "../assets/screenshots/screenshot-staff.webp";
import howItWorks from "../assets/how-it-works.webp";

export default function Landing() {
  const [lang, setLang] = useState<LandingLang>("fr");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  const t = (key: Parameters<typeof L>[1]) => L(lang, key);

  const features: [any, string, string][] = [
    [Clock, t("featServer"), t("featServerSub")],
    [CalendarClock, t("featRota"), t("featRotaSub")],
    [BarChart3, t("featPayroll"), t("featPayrollSub")],
    [MessageSquare, t("featRequests"), t("featRequestsSub")],
    [ShieldCheck, t("featApproval"), t("featApprovalSub")],
    [Users, t("featTeam"), t("featTeamSub")],
  ];

  const faqs: [string, string][] = [
    [t("faq1Q"), t("faq1A")],
    [t("faq2Q"), t("faq2A")],
    [t("faq3Q"), t("faq3A")],
    [t("faq4Q"), t("faq4A")],
    [t("faq5Q"), t("faq5A")],
    [t("faq6Q"), t("faq6A")],
  ];

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans">
      <MarketingBackground />

      {/* TOP BAR */}
      <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-slate-900">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <img src={logoFull} alt="Brigado" className="h-6 w-auto" />
          <div className="flex items-center gap-3">
            <a href="/features" className="hidden sm:block text-xs font-normal text-slate-400 hover:text-lime-400 transition-colors">
              {lang === "fr" ? "Fonctionnalités" : "Features"}
            </a>
            <button
              className="text-xs font-normal text-slate-400 hover:text-lime-400 transition-colors"
              onClick={() => setShowLogin(true)}
            >
              {lang === "fr" ? "Se connecter" : "Log in"}
            </button>
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[10px] font-bold">
              <button className={`px-2 py-1 rounded ${lang === "fr" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`} onClick={() => setLang("fr")}>FR</button>
              <button className={`px-2 py-1 rounded ${lang === "en" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`} onClick={() => setLang("en")}>EN</button>
            </div>
            <a href="/register" className="px-3.5 py-1.5 bg-lime-400 text-slate-950 rounded-lg text-xs font-bold hover:bg-lime-300 transition-all">
              {lang === "fr" ? "Commencer" : "Get started"}
            </a>
          </div>
        </div>
      </div>

      {/* HERO */}
      <div className="relative max-w-5xl mx-auto px-6 pt-20 pb-16 text-center overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-40"
          style={{ background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(163,230,53,0.12), transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, black, transparent)",
          }}
        />
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
          {t("heroTitle1")}<br className="hidden sm:block" /> {t("heroTitle2")}
        </h1>
        <p className="text-slate-400 font-normal max-w-xl mx-auto text-sm sm:text-base mb-6">
          {t("heroSub")}
        </p>
        <div className="inline-flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-4 py-2 text-xs mb-8">
          <span className="font-bold text-lime-400">€39{lang === "fr" ? "/mois" : "/mo"}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400 font-normal">{t("trialNote")}</span>
        </div>
        <div>
          <a
            href="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all text-sm"
          >
            {lang === "fr" ? "Démarrer l'essai gratuit" : "Start your free trial"}
            <ArrowRight size={16} strokeWidth={1.5} />
          </a>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="max-w-5xl mx-auto px-6 pb-20">
        {lang === "fr" ? (
          /* The illustration has French text baked in, so it's FR-only;
             English visitors get the text-based steps below instead.
             bg matches the artwork's own chalkboard black (#050607) so the
             image blends into its frame without a visible seam. */
          <div className="max-w-3xl mx-auto">
            <div className="bg-[#050607] border border-slate-800 rounded-2xl p-4 sm:p-6">
              <img
                src={howItWorks}
                alt="Trois étapes : configuration de l'équipe et affiche QR à scanner, pointage mobile depuis le navigateur avec demandes de congé, suivi des heures et coûts exportables pour votre comptable"
                className="w-full h-auto rounded-lg"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              [UserPlus, t("howStep1Title"), t("howStep1Sub")],
              [QrCode, t("howStep2Title"), t("howStep2Sub")],
              [Smartphone, t("howStep3Title"), t("howStep3Sub")],
            ].map(([Icon, title, body]: any, i) => (
              <div key={i} className="text-center">
                <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-3">
                  <Icon size={20} strokeWidth={1.5} className="text-lime-400" />
                </div>
                <div className="text-[10px] font-bold text-lime-500/70 mb-1">{String(i + 1).padStart(2, "0")}</div>
                <h3 className="text-sm font-bold text-slate-100">{title}</h3>
                <p className="text-xs font-normal text-slate-500 mt-1">{body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FEATURES */}
      <div className="max-w-5xl mx-auto px-6 grid grid-cols-1 sm:grid-cols-3 gap-4 pb-20">
        {features.map(([Icon, title, body], i) => (
          <div
            key={i}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5"
          >
            <Icon size={20} strokeWidth={1.5} className="text-lime-400 mb-2 drop-shadow-[0_0_6px_rgba(163,230,53,0.45)]" />
            <h3 className="text-sm font-bold text-slate-100">{title}</h3>
            <p className="text-xs font-normal text-slate-500 mt-1">{body}</p>
          </div>
        ))}
      </div>

      {/* SCREENSHOTS */}
      <div className="max-w-5xl mx-auto px-6 pb-24 space-y-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="order-2 md:order-1">
            <p className="text-[10px] font-bold text-lime-400 uppercase tracking-wider mb-2">
              {lang === "fr" ? "Vue Gérant" : "Manager View"}
            </p>
            <h3 className="text-lg font-bold text-slate-100 mb-2">
              {lang === "fr" ? "Toute votre équipe, en un coup d'œil" : "Your whole team, at a glance"}
            </h3>
            <p className="text-sm font-normal text-slate-500 leading-relaxed">
              {lang === "fr"
                ? "Coût net, heures totales, heures sup., absences — et les validations en attente, juste là où vous les voyez en premier."
                : "Net cost, total hours, overtime, absences — and pending approvals sitting right where you'll see them first."}
            </p>
          </div>
          <div className="order-1 md:order-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-lime-400/[0.03] overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-950/60 border-b border-slate-800">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
              </div>
              <img src={screenshotOverview} alt={lang === "fr" ? "Tableau de bord gérant Brigado" : "Brigado manager dashboard"} className="w-full h-auto" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-lime-400/[0.03] overflow-hidden max-w-sm mx-auto md:mx-0">
              <div className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-950/60 border-b border-slate-800">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-slate-700" />
              </div>
              <img src={screenshotStaff} alt={lang === "fr" ? "Vue employé Brigado" : "Brigado staff view"} className="w-full h-auto" />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-lime-400 uppercase tracking-wider mb-2">
              {lang === "fr" ? "Vue Employé" : "Staff View"}
            </p>
            <h3 className="text-lg font-bold text-slate-100 mb-2">
              {lang === "fr" ? "Simple pour votre équipe, depuis leur téléphone" : "Simple for your team, right from their phone"}
            </h3>
            <p className="text-sm font-normal text-slate-500 leading-relaxed">
              {lang === "fr"
                ? "Planning de la semaine, messages, demandes de congé et d'échange de service — sans rien installer."
                : "This week's schedule, messages, time-off and cover requests — nothing to install."}
            </p>
          </div>
        </div>
      </div>

      {/* COMPLIANCE CALLOUT */}
      <div className="max-w-5xl mx-auto px-6 pb-20">
        <div className="bg-lime-400/[0.04] border border-lime-400/20 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-start gap-4">
          <ShieldCheck className="text-lime-400 flex-shrink-0" strokeWidth={1.5} size={28} />
          <div>
            <h2 className="text-base font-bold text-slate-100 mb-1.5">{t("complianceTitle")}</h2>
            <p className="text-sm font-normal text-slate-400 leading-relaxed">{t("complianceBody")}</p>
          </div>
        </div>
      </div>

      {/* PRICING TEASER + CTA */}
      <div className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <h2 className="text-xl font-bold">{t("pricingTitle")}</h2>
        <p className="text-sm font-normal text-slate-500 mt-2">{t("pricingSub")}</p>
        <div className="inline-flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-4 py-2 text-xs mt-6 mb-8">
          <span className="font-bold text-lime-400">€39{lang === "fr" ? "/mois" : "/mo"}</span>
          <span className="text-slate-600">{lang === "fr" ? "ou" : "or"}</span>
          <span className="font-bold text-lime-400">€390{lang === "fr" ? "/an" : "/yr"}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400 font-normal">{t("trialNote")}</span>
        </div>
        <div>
          <a
            href="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all text-sm"
          >
            {lang === "fr" ? "Démarrer l'essai gratuit" : "Start your free trial"}
            <ArrowRight size={16} strokeWidth={1.5} />
          </a>
        </div>
      </div>

      {/* FAQ */}
      <div className="max-w-2xl mx-auto px-6 pb-24">
        <h2 className="text-xl font-bold text-center mb-6">{t("faqTitle")}</h2>
        <div className="space-y-2">
          {faqs.map(([q, a], i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 text-left text-sm font-semibold text-slate-200"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                {q}
                <ChevronDown size={16} strokeWidth={1.5} className={`text-slate-500 flex-shrink-0 transition-transform ${openFaq === i ? "rotate-180" : ""}`} />
              </button>
              {openFaq === i && (
                <div className="px-4 pb-4 text-xs font-normal text-slate-400 leading-relaxed">{a}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Footer lang={lang} />
      {showLogin && <LoginModal lang={lang} onClose={() => setShowLogin(false)} />}
    </div>
  );
}
