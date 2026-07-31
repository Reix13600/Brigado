export interface FeatureItem {
  titleFr: string;
  titleEn: string;
  descFr: string;
  descEn: string;
}

export interface FeatureCategory {
  titleFr: string;
  titleEn: string;
  icon: string; // lucide icon name, resolved in the component
  items: FeatureItem[];
}

export const FEATURE_CATEGORIES: FeatureCategory[] = [
  {
    titleFr: "Pointage & Planning",
    titleEn: "Clock In & Scheduling",
    icon: "Clock",
    items: [
      {
        titleFr: "Pointage en direct",
        titleEn: "Live clock in/out",
        descFr: "Vos employés pointent en temps réel depuis leur téléphone — pas d'heures approximatives saisies après coup.",
        descEn: "Staff clock in and out in real time from their phone — no more approximate hours entered after the fact.",
      },
      {
        titleFr: "Détection d'honnêteté",
        titleEn: "Honesty detection",
        descFr: "Signale discrètement (visible au gérant uniquement) toute saisie effectuée sans scan récent du QR code.",
        descEn: "Quietly flags (manager-only) any entry submitted without a recent QR code scan.",
      },
      {
        titleFr: "Planning glisser-déposer",
        titleEn: "Drag-and-drop rota planner",
        descFr: "Construisez le planning de la semaine visuellement, avec réaffectation facile en cas d'erreur.",
        descEn: "Build the week's schedule visually, with easy reassignment if a shift is put on the wrong person.",
      },
      {
        titleFr: "Jours fériés & week-ends mis en valeur",
        titleEn: "Weekends & holidays highlighted",
        descFr: "Samedis, dimanches et jours fériés français apparaissent visuellement distincts sur tout le planning.",
        descEn: "Saturdays, Sundays, and French public holidays are visually distinct throughout the schedule.",
      },
      {
        titleFr: "Affiche QR personnalisable",
        titleEn: "Customizable QR poster",
        descFr: "Générez et imprimez une affiche avec titre, sous-titre et note personnalisés — prête à coller au restaurant.",
        descEn: "Generate and print a poster with a custom title, subtitle, and note — ready to stick up in your restaurant.",
      },
    ],
  },
  {
    titleFr: "Conformité légale française",
    titleEn: "French Legal Compliance",
    icon: "ShieldCheck",
    items: [
      {
        titleFr: "Moteur de règles basé sur le Code du travail",
        titleEn: "Rule engine based on the actual Code du travail",
        descFr: "Chaque règle cite l'article réel (Code du travail, convention collective HCR) — pas une approximation générique.",
        descEn: "Every rule cites the real article (Code du travail, HCR collective agreement) — not a generic approximation.",
      },
      {
        titleFr: "Règles activables individuellement",
        titleEn: "Individually toggleable rules",
        descFr: "13 règles regroupées par catégorie — activez uniquement celles pertinentes pour votre établissement.",
        descEn: "13 rules grouped by category — turn on only what's relevant to your specific business.",
      },
      {
        titleFr: "Protections spécifiques aux mineurs",
        titleEn: "Minors' protections",
        descFr: "Interdiction de travail de nuit, horaires réduits, repos plus long — pour le personnel saisonnier de moins de 18 ans.",
        descEn: "No night work, shorter hours, longer rest — for seasonal staff under 18.",
      },
      {
        titleFr: "Vérification du SMIC",
        titleEn: "Minimum wage (SMIC) check",
        descFr: "Alerte visuelle si un taux horaire saisi est inférieur au SMIC en vigueur.",
        descEn: "Visual alert if an entered hourly rate falls below the current minimum wage.",
      },
      {
        titleFr: "Alertes en amont et rétroactives",
        titleEn: "Proactive and retroactive flagging",
        descFr: "Repérez les problèmes dès la planification, et aussi après coup sur les heures déjà enregistrées.",
        descEn: "Catch issues while scheduling, and retroactively on hours already logged.",
      },
      {
        titleFr: "Transparence totale",
        titleEn: "Full transparency",
        descFr: "Une liste claire de ce qui n'est PAS suivi (congés payés, DPAE, etc.) — jamais de fausse impression de conformité totale.",
        descEn: "A clear list of what is NOT tracked (paid leave accrual, DPAE, etc.) — never a false impression of total compliance.",
      },
    ],
  },
  {
    titleFr: "Paie & Rapports",
    titleEn: "Payroll & Reports",
    icon: "BarChart3",
    items: [
      {
        titleFr: "Tableau de paie détaillé",
        titleEn: "Detailed payroll table",
        descFr: "Brut, charges, net, avances — par employé et par période, avec heures supplémentaires calculées.",
        descEn: "Gross, deductions, net, advances — per employee and per period, with overtime automatically calculated.",
      },
      {
        titleFr: "Retenues multiples et nommées",
        titleEn: "Multiple, named deductions",
        descFr: "Ajoutez plusieurs cotisations (impôt, charges sociales...) affichées séparément, pas un seul pourcentage flou.",
        descEn: "Add several stacked deductions (tax, social charges...) shown separately, not one vague percentage.",
      },
      {
        titleFr: "Tableau de bord statistiques",
        titleEn: "Stats dashboard",
        descFr: "Tendance des heures, coût de la main-d'œuvre, répartition par poste, suivi des heures sup. — en graphiques.",
        descEn: "Hours trend, labor cost, role breakdown, overtime tracker — all in charts.",
      },
      {
        titleFr: "Export CSV complet",
        titleEn: "Full CSV export",
        descFr: "Toutes les données de paie exportées en un clic, prêtes pour Excel.",
        descEn: "All payroll data exported in one click, ready for Excel.",
      },
      {
        titleFr: "Export comptable épuré",
        titleEn: "Clean bookkeeper export",
        descFr: "Un second export dédié à votre comptable : heures et salaire brut uniquement, sans calculs fiscaux — CSV ou impression.",
        descEn: "A second export just for your bookkeeper: hours and gross pay only, no tax math — CSV or print.",
      },
      {
        titleFr: "Relevé d'heures imprimable",
        titleEn: "Printable timesheet",
        descFr: "Document par employé et par période, avec lignes de signature optionnelles (activables dans les paramètres).",
        descEn: "Per-employee, per-period document, with optional signature lines (toggle in Settings).",
      },
    ],
  },
  {
    titleFr: "Communication & Demandes",
    titleEn: "Communication & Requests",
    icon: "MessageSquare",
    items: [
      {
        titleFr: "Annonces & messages privés",
        titleEn: "Announcements & private messages",
        descFr: "Diffusez une annonce à toute l'équipe, ou discutez en privé avec un employé — fini les groupes WhatsApp.",
        descEn: "Broadcast an announcement to the whole team, or message a staff member privately — no more group texts.",
      },
      {
        titleFr: "Échanges de service",
        titleEn: "Shift cover requests",
        descFr: "Un employé propose son service à couvrir ; seuls les collègues du même poste le voient et peuvent le prendre.",
        descEn: "A staff member marks a shift as needing cover; only colleagues in the same role see and can claim it.",
      },
      {
        titleFr: "Demandes de congé",
        titleEn: "Time-off requests",
        descFr: "Avec calendrier visuel intégré pour le gérant — plus besoin de deviner quel jour de la semaine c'est.",
        descEn: "With a built-in visual calendar for the manager — no more guessing which day of the week it is.",
      },
      {
        titleFr: "Boîte de demandes unifiée",
        titleEn: "Unified requests inbox",
        descFr: "Congés, échanges et heures signalées regroupés en un seul endroit, avec possibilité de mettre en attente.",
        descEn: "Time off, cover requests, and flagged hours all in one place, with the option to put items on hold.",
      },
    ],
  },
  {
    titleFr: "Automatisation",
    titleEn: "Automation",
    icon: "Zap",
    items: [
      {
        titleFr: "Résumé hebdomadaire par e-mail",
        titleEn: "Weekly email digest",
        descFr: "Envoyé automatiquement chaque dimanche, ou à la demande d'un simple clic.",
        descEn: "Sent automatically every Sunday, or on demand with a single click.",
      },
      {
        titleFr: "Validation manager",
        titleEn: "Manager approval",
        descFr: "Chaque heure saisie passe par une validation avant de compter dans la paie.",
        descEn: "Every logged hour goes through approval before it counts toward payroll.",
      },
      {
        titleFr: "Archivage du personnel",
        titleEn: "Staff archiving",
        descFr: "Retirez un ancien employé du planning actif sans jamais perdre son historique d'heures et de paie.",
        descEn: "Remove a former employee from the active roster without ever losing their hours/payroll history.",
      },
    ],
  },
  {
    titleFr: "Accessible partout",
    titleEn: "Accessible Everywhere",
    icon: "Globe",
    items: [
      {
        titleFr: "Bilingue français / anglais",
        titleEn: "Bilingual French / English",
        descFr: "Toute l'application, y compris cette page, disponible dans les deux langues.",
        descEn: "The entire app, including this page, available in both languages.",
      },
      {
        titleFr: "Thème clair / sombre",
        titleEn: "Light / dark theme",
        descFr: "S'adapte à la préférence de chacun.",
        descEn: "Adapts to everyone's preference.",
      },
      {
        titleFr: "Fonctionne sur tous les téléphones",
        titleEn: "Works on any phone",
        descFr: "Aucune installation, aucune app à télécharger — juste un navigateur.",
        descEn: "No install, no app to download — just a browser.",
      },
      {
        titleFr: "Hébergement sécurisé",
        titleEn: "Secure hosting",
        descFr: "Infrastructure Firebase / Google Cloud pour l'hébergement, l'authentification et les données.",
        descEn: "Firebase / Google Cloud infrastructure for hosting, authentication, and data.",
      },
    ],
  },
];
