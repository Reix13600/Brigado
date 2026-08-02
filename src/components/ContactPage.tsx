import React, { useState } from "react";
import { ArrowLeft, Send, CheckCircle2 } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { LandingLang } from "../utils/landingCopy";
import Footer from "./Footer";
import MarketingBackground from "./MarketingBackground";
import LoginModal from "./LoginModal";
import logoFull from "../assets/logo-full.png";

type Reason = "general" | "support" | "billing" | "feature_request" | "partnership" | "other";

const REASON_LABELS: Record<Reason, { fr: string; en: string }> = {
  general: { fr: "Question générale", en: "General question" },
  support: { fr: "Support / problème technique", en: "Support / technical issue" },
  billing: { fr: "Facturation", en: "Billing" },
  feature_request: { fr: "Demande de fonctionnalité", en: "Feature request" },
  partnership: { fr: "Partenariat", en: "Partnership" },
  other: { fr: "Autre", en: "Other" },
};

export default function ContactPage() {
  const [lang, setLang] = useState<LandingLang>("fr");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState<Reason>("general");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim() || !message.trim()) return;
    setSending(true);
    setError(false);
    try {
      const submit = httpsCallable(functions, "submitContactForm");
      await submit({
        name: name.trim(),
        email: email.trim(),
        reason,
        reasonLabel: REASON_LABELS[reason][lang],
        message: message.trim(),
      });
      setSent(true);
    } catch (err) {
      console.error(err);
      setError(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <MarketingBackground />
      <div className="max-w-lg mx-auto px-6 pt-12 pb-20 flex-1 w-full">
        <div className="flex items-center justify-between mb-12">
          <a href="/" className="flex items-center gap-2 text-sm font-normal text-slate-400 hover:text-lime-400 transition-colors">
            <ArrowLeft size={16} strokeWidth={1.5} /> {lang === "fr" ? "Retour à l'accueil" : "Back to home"}
          </a>
          <div className="flex items-center gap-3">
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
          </div>
        </div>

        <img src={logoFull} alt="Brigado" className="h-8 w-auto mb-8" />
        <h1 className="text-2xl font-extrabold mb-2">{lang === "fr" ? "Contactez-nous" : "Contact us"}</h1>
        <p className="text-sm font-normal text-slate-500 mb-6">
          {lang === "fr" ? "Une question, un problème, une idée ? Écrivez-nous." : "A question, an issue, an idea? Write to us."}
        </p>

        {sent ? (
          <div className="bg-slate-900 border border-lime-400/30 rounded-2xl p-8 text-center space-y-3">
            <CheckCircle2 className="text-lime-400 mx-auto" size={32} strokeWidth={1.5} />
            <p className="text-sm font-normal text-slate-300">
              {lang === "fr" ? "Message envoyé — nous vous répondrons rapidement." : "Message sent — we'll get back to you soon."}
            </p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                {lang === "fr" ? "Nom" : "Name"}
              </label>
              <input
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                {lang === "fr" ? "E-mail" : "Email"}
              </label>
              <input
                type="email"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-lime-400/50"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                {lang === "fr" ? "Raison du contact" : "Reason for contact"}
              </label>
              <select
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm focus:outline-none"
                value={reason}
                onChange={e => setReason(e.target.value as Reason)}
              >
                {(Object.keys(REASON_LABELS) as Reason[]).map(r => (
                  <option key={r} value={r}>{REASON_LABELS[r][lang]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                {lang === "fr" ? "Message" : "Message"}
              </label>
              <textarea
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm h-28 resize-none focus:outline-none focus:border-lime-400/50"
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
            </div>

            {error && (
              <p className="text-xs font-normal text-rose-400">
                {lang === "fr" ? "Échec de l'envoi — réessayez ou écrivez à " : "Failed to send — try again or email "}
                <a href="mailto:info@brigado.solutions" className="underline">info@brigado.solutions</a>
              </p>
            )}

            <button
              className="w-full py-3 bg-lime-400 text-slate-950 font-bold rounded-xl hover:bg-lime-300 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              onClick={handleSubmit}
              disabled={sending || !name.trim() || !email.trim() || !message.trim()}
            >
              <Send size={15} strokeWidth={1.5} /> {sending ? "..." : (lang === "fr" ? "Envoyer" : "Send")}
            </button>
          </div>
        )}
      </div>
      <Footer lang={lang} />
      {showLogin && <LoginModal lang={lang} onClose={() => setShowLogin(false)} />}
    </div>
  );
}
