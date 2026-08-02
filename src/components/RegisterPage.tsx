import React, { useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { ensureAnonymousSession } from "../utils/auth";
import { ArrowLeft } from "lucide-react";
import { L, LandingLang } from "../utils/landingCopy";
import Footer from "./Footer";
import MarketingBackground from "./MarketingBackground";
import logoFull from "../assets/logo-full.png";

// Both are live: 7-day free trial (card required), then billed automatically.
const STRIPE_PAYMENT_LINKS = {
  monthly: "https://buy.stripe.com/aFabJ14py8T96376kTfnO0b", // €39/month
  yearly: "https://buy.stripe.com/fZu00j3luedt63738HfnO0c",  // €390/year
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function RegisterPage() {
  const [lang, setLang] = useState<LandingLang>("fr");
  const [restaurantName, setRestaurantName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [postcode, setPostcode] = useState("");
  const [checking, setChecking] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle" | "available" | "taken" | "invalid">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");

  const t = (key: Parameters<typeof L>[1]) => L(lang, key);
  const effectiveSlug = slugTouched ? slug : slugify(restaurantName);

  const checkSlugAvailability = async () => {
    const candidate = effectiveSlug;
    if (!candidate || candidate.length < 2) {
      setSlugStatus("invalid");
      return;
    }
    setChecking(true);
    try {
      await ensureAnonymousSession();
      const snap = await getDoc(doc(db, "restaurants", candidate));
      setSlugStatus(snap.exists() ? "taken" : "available");
    } catch (err) {
      console.error(err);
      setSlugStatus("invalid");
    } finally {
      setChecking(false);
    }
  };

  const handleContinueToPayment = async () => {
    if (slugStatus !== "available" || !email.trim() || !restaurantName.trim() || !contactName.trim() || !phone.trim()) return;
    setSubmitting(true);
    try {
      const url = new URL(STRIPE_PAYMENT_LINKS[plan]);
      url.searchParams.set("prefilled_email", email.trim());
      const ref = [effectiveSlug, restaurantName.trim(), contactName.trim(), phone.trim(), postcode.trim()]
        .map(encodeURIComponent)
        .join("|");
      url.searchParams.set("client_reference_id", ref);
      window.location.href = url.toString();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
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
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-5xl mx-auto px-6 py-16 sm:py-20 w-full">
        <a href="/" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-lime-400 transition-colors mb-10">
          <ArrowLeft size={14} strokeWidth={1.5} /> {lang === "fr" ? "Retour à l'accueil" : "Back to home"}
        </a>

        <div className="text-center mb-10">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t("pricingTitle")}</h1>
          <p className="text-sm font-normal text-slate-500 mt-2">{t("pricingSub")}</p>
        </div>

        <div className="max-w-md mx-auto">
          <div className="backdrop-blur-md bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl transition-colors hover:border-lime-400/20 hover:shadow-lime-400/[0.06]">
            <h3 className="text-base font-bold text-center">{t("registerTitle")}</h3>

            {/* PLAN SELECTOR */}
            <div className="flex bg-slate-950/60 border border-slate-800 rounded-xl p-1">
              <button
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${plan === "monthly" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`}
                onClick={() => setPlan("monthly")}
              >
                €39<span className="opacity-70 font-normal">{lang === "fr" ? "/mois" : "/mo"}</span>
              </button>
              <button
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all relative ${plan === "yearly" ? "bg-lime-400 text-slate-950" : "text-slate-400"}`}
                onClick={() => setPlan("yearly")}
              >
                €390<span className="opacity-70 font-normal">{lang === "fr" ? "/an" : "/yr"}</span>
                <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${plan === "yearly" ? "bg-slate-950 text-lime-400" : "bg-lime-400/10 text-lime-400"}`}>
                  {t("planSave")}
                </span>
              </button>
            </div>
            <p className="text-[11px] font-normal text-slate-500 text-center -mt-2">{t("trialNote")}</p>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("restaurantName")}</label>
              <input
                className="w-full mt-1 bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
                placeholder="La Vague"
                value={restaurantName}
                onChange={e => { setRestaurantName(e.target.value); setSlugStatus("idle"); }}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("webAddress")}</label>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs font-normal text-slate-600 whitespace-nowrap">{window.location.host}/</span>
                <input
                  className="flex-1 bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
                  value={effectiveSlug}
                  onChange={e => { setSlug(slugify(e.target.value)); setSlugTouched(true); setSlugStatus("idle"); }}
                />
                <button
                  className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                  onClick={checkSlugAvailability}
                  disabled={checking || !effectiveSlug}
                >
                  {checking ? "..." : t("checkBtn")}
                </button>
              </div>
              {slugStatus === "available" && <p className="text-[11px] font-normal text-lime-400 mt-1">{t("available")}</p>}
              {slugStatus === "taken" && <p className="text-[11px] font-normal text-rose-400 mt-1">{t("taken")}</p>}
              {slugStatus === "invalid" && <p className="text-[11px] font-normal text-rose-400 mt-1">{t("invalidSlug")}</p>}
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("emailLabel")}</label>
              <input
                type="email"
                className="w-full mt-1 bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
                placeholder="you@restaurant.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("contactNameLabel")}</label>
              <input
                className="w-full mt-1 bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
                value={contactName}
                onChange={e => setContactName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("phoneLabel")}</label>
                <input
                  type="tel"
                  className="w-full mt-1 bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
                  placeholder="06 12 34 56 78"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t("postcodeLabel")}</label>
                <input
                  className="w-full mt-1 bg-slate-950/60 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
                  placeholder="13600"
                  value={postcode}
                  onChange={e => setPostcode(e.target.value)}
                />
              </div>
            </div>

            <button
              className="w-full py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all disabled:opacity-40"
              onClick={handleContinueToPayment}
              disabled={slugStatus !== "available" || !email.trim() || !restaurantName.trim() || !contactName.trim() || !phone.trim() || submitting}
            >
              {submitting ? "..." : `${t("continueToPayment")} — ${plan === "monthly" ? `€39${lang === "fr" ? "/mois" : "/mo"}` : `€390${lang === "fr" ? "/an" : "/yr"}`}`}
            </button>

          </div>
        </div>
      </div>

      <Footer lang={lang} />
    </div>
  );
}
