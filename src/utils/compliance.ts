// Catalog of individual compliance rules a manager can toggle on/off.
// Sourced from Code du travail + the HCR (Hôtels-Cafés-Restaurants)
// national collective agreement, IDCC 1979. Each rule links to the
// primary legal source rather than relying on Brigado's own summary —
// managers should read the actual article for anything that matters.
//
// This catalog does NOT cover paid-leave accrual, DPAE filing, written
// contracts, or SMIC's exact figure fetching — those are either bigger
// features (leave balances) or administrative/paperwork items that
// aren't something a schedule can flag. See the disclaimer shown
// alongside this list in Settings.

export type ComplianceCategory = "hours" | "rest" | "overtime" | "night_sunday" | "minors";

export interface ComplianceRule {
  id: string;
  category: ComplianceCategory;
  labelEn: string;
  labelFr: string;
  descEn: string;
  descFr: string;
  article: string;
  link: string;
  defaultEnabled: boolean;
}

export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    id: "rest11h",
    category: "rest",
    labelEn: "Minimum 11h daily rest",
    labelFr: "Repos quotidien minimum de 11h",
    descEn: "At least 11 consecutive hours off between the end of one shift and the start of the next.",
    descFr: "Au moins 11 heures consécutives entre la fin d'un service et le début du suivant.",
    article: "Art. L3131-1, Code du travail",
    link: "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006072050/LEGISCTA000006160755/",
    defaultEnabled: true,
  },
  {
    id: "daily10h",
    category: "hours",
    labelEn: "Maximum 10h per day",
    labelFr: "Maximum 10h par jour",
    descEn: "A single day's total shift time shouldn't exceed 10 hours (extendable to 12h only under a specific collective agreement provision).",
    descFr: "Le temps de travail d'une journée ne devrait pas dépasser 10h (extensible à 12h seulement via un accord collectif spécifique).",
    article: "Art. L3121-18, Code du travail",
    link: "https://www.legifrance.gouv.fr/codes/id/LEGISCTA000033020451",
    defaultEnabled: true,
  },
  {
    id: "weekly48h",
    category: "hours",
    labelEn: "Maximum 48h per week",
    labelFr: "Maximum 48h par semaine",
    descEn: "Total scheduled hours for one staff member in a single week shouldn't exceed 48 hours.",
    descFr: "Le total des heures planifiées pour un employé sur une semaine ne devrait pas dépasser 48 heures.",
    article: "Art. L3121-20, Code du travail",
    link: "https://www.legifrance.gouv.fr/codes/id/LEGISCTA000033020451",
    defaultEnabled: true,
  },
  {
    id: "weeklyRest35h",
    category: "rest",
    labelEn: "35h consecutive weekly rest",
    labelFr: "Repos hebdomadaire de 35h consécutives",
    descEn: "Every week should include at least one 35-hour uninterrupted rest period (24h weekly rest + 11h daily rest), normally including Sunday.",
    descFr: "Chaque semaine devrait inclure au moins une période de repos ininterrompue de 35h (24h de repos hebdo + 11h de repos quotidien), incluant normalement le dimanche.",
    article: "Art. L3132-1 & L3132-2, Code du travail",
    link: "https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000006902581",
    defaultEnabled: true,
  },
  {
    id: "max6Days",
    category: "hours",
    labelEn: "No more than 6 working days per week",
    labelFr: "Pas plus de 6 jours travaillés par semaine",
    descEn: "A staff member shouldn't be scheduled more than 6 days in a single week.",
    descFr: "Un employé ne devrait pas être planifié plus de 6 jours dans une même semaine.",
    article: "Art. L3132-1, Code du travail",
    link: "https://travail-emploi.gouv.fr/le-repos-hebdomadaire-principe-et-derogations",
    defaultEnabled: false,
  },
  {
    id: "breakAfter6h",
    category: "rest",
    labelEn: "20-min break after 6h worked",
    labelFr: "Pause de 20 min après 6h de travail",
    descEn: "A shift running 6+ continuous hours without a recorded split should include a break.",
    descFr: "Un service de 6h ou plus sans coupure enregistrée devrait inclure une pause.",
    article: "Art. L3121-16, Code du travail",
    link: "https://www.service-public.gouv.fr/particuliers/vosdroits/F18205",
    defaultEnabled: false,
  },
  {
    id: "coupure2h",
    category: "rest",
    labelEn: "Split shift break capped at 2h (HCR)",
    labelFr: "Coupure limitée à 2h (convention HCR)",
    descEn: "The gap between two shifts on the same day (the \"coupure\") shouldn't exceed 2 hours, per the HCR collective agreement.",
    descFr: "L'écart entre deux services le même jour (la \"coupure\") ne devrait pas dépasser 2 heures, selon la convention collective HCR.",
    article: "Convention Collective HCR, IDCC 1979",
    link: "https://www.legifrance.gouv.fr/conv_coll/id/KALICONT000005635964/",
    defaultEnabled: false,
  },
  {
    id: "overtime43h",
    category: "overtime",
    labelEn: "Beyond 43rd weekly hour (+50% tier)",
    labelFr: "Au-delà de la 43e heure hebdo (majoration +50%)",
    descEn: "Hours worked beyond the 43rd in a week fall into the higher overtime surcharge tier — flagged as informational, Brigado doesn't calculate the pay itself.",
    descFr: "Les heures au-delà de la 43e dans la semaine relèvent du taux de majoration supérieur — signalé à titre informatif, Brigado ne calcule pas la paie.",
    article: "Art. L3121-22, Code du travail",
    link: "https://travail-emploi.gouv.fr/posted-workers-rights-en",
    defaultEnabled: false,
  },
  {
    id: "sundayWork",
    category: "night_sunday",
    labelEn: "Sunday shift (informational)",
    labelFr: "Service dominical (informatif)",
    descEn: "Sunday work is legal with the right derogation and compensation — flagged so you remember to check it applies.",
    descFr: "Le travail dominical est légal avec la dérogation et la compensation appropriées — signalé pour rappel de vérification.",
    article: "Art. L3132-3, Code du travail",
    link: "https://travail-emploi.gouv.fr/le-repos-hebdomadaire-principe-et-derogations",
    defaultEnabled: false,
  },
  {
    id: "holidayWork",
    category: "night_sunday",
    labelEn: "Public holiday shift (informational)",
    labelFr: "Service un jour férié (informatif)",
    descEn: "Public holidays worked usually require extra compensation (May 1st is always double pay).",
    descFr: "Les jours fériés travaillés nécessitent généralement une compensation supplémentaire (le 1er mai est toujours payé double).",
    article: "Art. L3133-4, Code du travail",
    link: "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006072050/",
    defaultEnabled: false,
  },
  {
    id: "minorNightWork",
    category: "minors",
    labelEn: "Minors: no night work (22:00–06:00)",
    labelFr: "Mineurs : pas de travail de nuit (22h-6h)",
    descEn: "Staff marked as minors shouldn't be scheduled between 22:00 and 06:00.",
    descFr: "Le personnel marqué mineur ne devrait pas être planifié entre 22h et 6h.",
    article: "Art. L3162-1, Code du travail",
    link: "https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006072050/",
    defaultEnabled: false,
  },
  {
    id: "minorMaxHours",
    category: "minors",
    labelEn: "Minors: max 8h/day, 35h/week",
    labelFr: "Mineurs : max 8h/jour, 35h/semaine",
    descEn: "Staff marked as minors shouldn't exceed 8 hours in a day or 35 hours in a week.",
    descFr: "Le personnel marqué mineur ne devrait pas dépasser 8h par jour ou 35h par semaine.",
    article: "Art. L3162-2, Code du travail",
    link: "https://travail-emploi.gouv.fr/la-duree-legale-du-travail",
    defaultEnabled: false,
  },
  {
    id: "minorDailyRest",
    category: "minors",
    labelEn: "Minors: longer daily rest (12h)",
    labelFr: "Mineurs : repos quotidien plus long (12h)",
    descEn: "Staff marked as minors need at least 12 consecutive hours of rest between shifts (simplified — under-16s legally need 14h, not distinguished separately here).",
    descFr: "Le personnel marqué mineur a besoin d'au moins 12h consécutives de repos entre les services (simplifié — les moins de 16 ans ont légalement besoin de 14h, non distingué séparément ici).",
    article: "Art. L3162-1, Code du travail",
    link: "https://www.service-public.gouv.fr/particuliers/vosdroits/F990",
    defaultEnabled: false,
  },
];

export function defaultComplianceRules(): Record<string, boolean> {
  return Object.fromEntries(COMPLIANCE_RULES.map(r => [r.id, r.defaultEnabled]));
}

export function isRuleEnabled(rules: Record<string, boolean> | undefined, id: string): boolean {
  if (!rules) return COMPLIANCE_RULES.find(r => r.id === id)?.defaultEnabled ?? false;
  return rules[id] ?? false;
}

// Real, legally relevant items that are NOT actively tracked or flagged
// by Brigado — shown for awareness only, so the toggle list above never
// implies broader coverage than it actually has.
export const NOT_TRACKED_EN: string[] = [
  "12-week rolling average of 44h/week (Art. L3121-21) — needs longer historical analysis than currently implemented",
  "Paid leave accrual & balance tracking (2.5 days/month, 5-week entitlement)",
  "DPAE prior-hiring declaration, written contracts, trial periods",
  "Night-worker status thresholds (270h/12mo or 2 nights/week)",
  "Exact SMIC/minimum-wage figure — manager-entered, not auto-updated",
];

export const NOT_TRACKED_FR: string[] = [
  "Moyenne glissante sur 12 semaines de 44h/semaine (Art. L3121-21) — nécessite une analyse historique plus poussée",
  "Accumulation et solde des congés payés (2,5 jours/mois, 5 semaines)",
  "Déclaration préalable à l'embauche (DPAE), contrats écrits, périodes d'essai",
  "Seuils du statut de travailleur de nuit (270h/12 mois ou 2 nuits/semaine)",
  "Montant exact du SMIC — saisi manuellement, non mis à jour automatiquement",
];
