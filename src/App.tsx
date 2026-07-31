import React, { useState, useEffect } from "react";
import { AppData } from "./types";
import { fetchAppData } from "./utils/api";
import { ensureAnonymousSession } from "./utils/auth";
import { getTranslation, LangType } from "./utils/translations";
import StaffDashboard from "./components/StaffDashboard";
import ManagerDashboard from "./components/ManagerDashboard";
import Landing from "./components/Landing";
import LegalPage from "./components/LegalPage";
import ContactPage from "./components/ContactPage";
import Features from "./components/Features";
import { getSlugFromUrl, setRestaurantId } from "./firebase";
import logoFull from "./assets/logo-full.png";
import { Clock, Users, Sun, Moon } from "lucide-react";

// Static marketing/legal pages live at these paths — never treated as a
// restaurant slug, even though they're single top-level path segments
// just like a slug would be.
const STATIC_PAGES: Record<string, "mentions" | "cgv" | "privacy" | "contact" | "features"> = {
  "mentions-legales": "mentions",
  "cgv": "cgv",
  "confidentialite": "privacy",
  "contact": "contact",
  "features": "features",
};

export default function App() {
  const [view, setView] = useState<"staff" | "manager">("staff");
  const [lang, setLang] = useState<LangType>("fr");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [appData, setAppData] = useState<AppData | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const staticPage = STATIC_PAGES[getSlugFromUrl() ?? ""] ?? null;

  // Resolved exactly once per page load, before anything else runs.
  // null means "root path" (or a static page) — no restaurant context,
  // show the public landing/registration page instead of the app.
  const [restaurantSlug] = useState<string | null>(() => {
    if (staticPage) return null;
    const slug = getSlugFromUrl();
    if (slug) setRestaurantId(slug);
    return slug;
  });

  const t = (k: string) => getTranslation(lang, k);

  // Captured once per real page load (not on internal tab switches).
  // Only set when the URL that loaded this page included ?src=qr — i.e.
  // the printed QR poster, not a bookmarked/typed bare URL. Used to flag
  // hour entries submitted without a fresh scan (see StaffDashboard).
  const [qrSessionAt] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("src") === "qr" ? Date.now() : null;
  });

  const triggerRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  useEffect(() => {
    // Load active language from localStorage if available
    const savedLang = localStorage.getItem("app_lang");
    if (savedLang === "fr" || savedLang === "en") {
      setLang(savedLang);
    }
    const savedTheme = localStorage.getItem("app_theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    if (!restaurantSlug) {
      setLoading(false);
      return;
    }
    setLoading(true);
    ensureAnonymousSession()
      .then(fetchAppData)
      .then(data => {
        setAppData(data);
        setError(null);
      })
      .catch(err => {
        console.error("Failed to load app data:", err);
        setError(err?.message === "RESTAURANT_NOT_FOUND" ? "RESTAURANT_NOT_FOUND" : "Error communicating with Firebase");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [refreshTrigger, restaurantSlug]);

  const handleSetLang = (newLang: LangType) => {
    setLang(newLang);
    localStorage.setItem("app_lang", newLang);
  };

  if (staticPage === "contact") {
    return <ContactPage />;
  }
  if (staticPage === "features") {
    return <Features />;
  }
  if (staticPage) {
    return <LegalPage type={staticPage} />;
  }

  if (!restaurantSlug) {
    return <Landing />;
  }

  if (loading && !appData) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 ${theme === "light" ? "theme-light bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
        <img src={logoFull} alt="Brigado" className="h-8 w-auto mb-6" />
        <div className="w-12 h-12 rounded-full border-4 border-lime-400 border-t-transparent animate-spin mb-4" />
        <p className="text-sm text-slate-400">Loading staff hours application...</p>
      </div>
    );
  }

  if (error === "RESTAURANT_NOT_FOUND") {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 text-center space-y-4 ${theme === "light" ? "theme-light bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
        <div className="text-4xl">🔍</div>
        <p className="text-sm text-slate-400 max-w-sm">
          No restaurant found at "/{restaurantSlug}". Double check the link, or {" "}
          <a href="/" className="text-lime-400 underline">register a new restaurant</a>.
        </p>
      </div>
    );
  }

  if (error || !appData) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 text-center space-y-4 ${theme === "light" ? "theme-light bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
        <div className="text-4xl text-rose-500">⚠️</div>
        <p className="text-sm text-slate-400">{error || "Failed to load database config"}</p>
        <button 
          className="px-4 py-2 bg-lime-400 text-slate-950 font-bold rounded-lg text-xs"
          onClick={triggerRefresh}
        >
          Retry Connection
        </button>
      </div>
    );
  }

  if (appData.suspended) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 text-center space-y-4 ${theme === "light" ? "theme-light bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
        <div className="text-4xl">⏸️</div>
        <p className="text-sm text-slate-400 max-w-sm">
          This restaurant's subscription is currently inactive. Your data is safe — contact support to reactivate.
        </p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen font-sans flex flex-col transition-colors duration-200 ${theme === "light" ? "theme-light bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
      {/* GLOBAL MODE BAR */}
      <div className="bg-slate-900 border-b border-slate-800/60 sticky top-0 z-40 select-none print:hidden">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 h-12 text-xs">
          <div className="flex items-center gap-1 font-bold text-lime-400">
            <img src={logoFull} alt="Brigado" className="h-6 w-auto" />
          </div>
          
          <div className="flex items-center gap-3">
            {/* Theme Toggle Button */}
            <button
              onClick={() => {
                const nextTheme = theme === "dark" ? "light" : "dark";
                setTheme(nextTheme);
                localStorage.setItem("app_theme", nextTheme);
              }}
              className="p-1.5 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center gap-1.5 shadow-sm"
              title={theme === "dark" ? "Switch to High-Contrast Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? (
                <>
                  <Sun size={13} className="text-amber-400" />
                  <span className="text-[10px] font-semibold text-slate-300 hidden sm:inline">{lang === "fr" ? "Clair" : "Light"}</span>
                </>
              ) : (
                <>
                  <Moon size={13} className="text-indigo-400" />
                  <span className="text-[10px] font-semibold text-slate-700 hidden sm:inline">{lang === "fr" ? "Sombre" : "Dark"}</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-1 bg-slate-950 rounded-xl p-1 border border-slate-800/80">
              <button
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${view === "staff" ? "bg-lime-400 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-200"}`}
                onClick={() => setView("staff")}
              >
                <Clock size={13} />
                {lang === "fr" ? "Saisir heures" : "Staff View"}
              </button>
              <button
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${view === "manager" ? "bg-lime-400 text-slate-950 font-bold" : "text-slate-400 hover:text-slate-200"}`}
                onClick={() => setView("manager")}
              >
                <Users size={13} />
                {lang === "fr" ? "Gérant" : "Manager View"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SCREEN ROUTING */}
      <div className="flex-1 pb-16">
        {view === "staff" ? (
          <StaffDashboard 
            appData={appData} 
            lang={lang} 
            setLang={handleSetLang} 
            onRefresh={triggerRefresh} 
            theme={theme}
            qrSessionAt={qrSessionAt}
          />
        ) : (
          <ManagerDashboard 
            appData={appData} 
            lang={lang} 
            setLang={handleSetLang} 
            onRefresh={triggerRefresh} 
            theme={theme}
          />
        )}
      </div>
    </div>
  );
}
