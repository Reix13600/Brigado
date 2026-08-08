// Pushes the final content of the 5-email cold-outreach drip into the Brevo
// templates created by brevo-setup-sequence.ts, and renames them to match the
// day-based sequence. Idempotent: matches templates by old or new name.
//
//   npx tsx scripts/brevo-update-templates.ts
import { brevo, SENDER } from "./brevo";

const CTA_URL = "https://brigado.solutions/";
const LOGO_URL = "https://brigado.solutions/logo-email.png";

interface SequenceEmail {
  oldName: string;
  name: string;
  subject: string;
  preview: string;
  paragraphs: string[];
  cta: string;
}

const EMAILS: SequenceEmail[] = [
  {
    oldName: "Brigado - Email 1 - Intro",
    name: "Brigado - Email 1 - Intro (J0)",
    subject: "Gérer votre équipe sans tableur ni prise de tête",
    preview: "Planning, pointage, avances — tout en un endroit",
    paragraphs: [
      "Bonjour,",
      "Brigado est un outil pensé pour les restaurants et l'hôtellerie en France : planning en glisser-déposer, pointage, paie et avances sur salaire, conforme à la convention HCR.",
      "Créé avec un restaurant à La Ciotat, il est aujourd'hui ouvert à d'autres établissements.",
      "Essai gratuit de 7 jours, sans engagement.",
    ],
    cta: "Essayer gratuitement →",
  },
  {
    oldName: "Brigado - Email 2 - Follow-up (not opened)",
    name: "Brigado - Email 2 - Planning (J+3)",
    subject: "Le planning de la semaine vous prend encore 2h ?",
    preview: "Glissez-déposez, c'est fait",
    paragraphs: [
      "Beaucoup de restaurateurs passent encore des heures sur Excel chaque semaine pour organiser leur équipe.",
      "Avec Brigado, le planning se fait en glisser-déposer, chaque salarié voit ses horaires depuis son téléphone, et les modifications sont instantanées.",
      "Vous pouvez tester gratuitement pendant 7 jours.",
    ],
    cta: "Découvrir le planning →",
  },
  {
    oldName: "Brigado - Email 3 - Follow-up (opened, no click)",
    name: "Brigado - Email 3 - Paie & avances (J+7)",
    subject: "Vos salariés demandent une avance ? Simplifiez ça",
    preview: "Gestion des avances intégrée à la paie",
    paragraphs: [
      "Brigado centralise aussi les avances sur salaire et la préparation de la paie, avec les règles de la convention HCR déjà intégrées.",
      "Moins d'allers-retours, moins d'erreurs, une équipe qui gagne du temps.",
      "Toujours accessible en essai gratuit, 7 jours.",
    ],
    cta: "Voir comment ça marche →",
  },
  {
    oldName: "Brigado - Email 4 - Social proof (clicked, no convert)",
    name: "Brigado - Email 4 - Rappel essai (J+12)",
    subject: "Votre essai gratuit vous attend",
    preview: "7 jours pour tester Brigado, sans carte bancaire",
    paragraphs: [
      "Un rappel simple : vous pouvez essayer Brigado gratuitement pendant 7 jours, sans engagement.",
      "Planning, pointage, paie, avances — tout est prêt à l'emploi dès la création de votre compte.",
    ],
    cta: "Démarrer mon essai →",
  },
  {
    oldName: "Brigado - Email 5 - Last touch",
    name: "Brigado - Email 5 - Dernier message (J+18)",
    subject: "On arrête de vous écrire — mais Brigado reste dispo",
    preview: "Dernier message de notre part",
    paragraphs: [
      "Ce sera notre dernier message pour l'instant.",
      "Si la gestion de planning, de paie ou d'avances devient un jour un vrai casse-tête, Brigado sera là.",
      "Essai gratuit toujours accessible, 7 jours, sans engagement.",
    ],
    cta: "Essayer Brigado →",
  },
];

function renderHtml(email: SequenceEmail): string {
  const paragraphs = email.paragraphs
    .map((p) => `<p style="margin:0 0 16px 0;">${p}</p>`)
    .join("\n        ");
  return `<div style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <!-- preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${email.preview}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
    <tr>
      <td style="background:#020617;padding:20px 24px;text-align:center;">
        <a href="${CTA_URL}" style="text-decoration:none;">
          <img src="${LOGO_URL}" alt="Brigado" width="220" style="max-width:220px;height:auto;border:0;" />
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 28px 8px 28px;color:#1f2937;font-size:15px;line-height:1.65;">
        ${paragraphs}
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 36px 28px;text-align:center;">
        <a href="${CTA_URL}" style="display:inline-block;background:#aee42d;color:#020617;font-weight:bold;font-size:15px;padding:13px 28px;border-radius:8px;text-decoration:none;">${email.cta}</a>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.6;">
        Brigado — planning, pointage et paie pour la restauration (convention HCR).<br/>
        <a href="https://brigado.solutions" style="color:#6b7280;">brigado.solutions</a> · <a href="mailto:info@brigado.solutions" style="color:#6b7280;">info@brigado.solutions</a><br/>
        Vous recevez cet email car votre établissement figure dans notre liste de contacts professionnels.
        <a href="{{ unsubscribe }}" style="color:#6b7280;">Se désinscrire</a>
      </td>
    </tr>
  </table>
</div>`;
}

async function main(): Promise<void> {
  const existing = await brevo.transactionalEmails.getSmtpTemplates({ limit: 200 });
  const byName = new Map(
    (existing.templates ?? []).map((t) => [t.name, t.id] as const),
  );
  for (const email of EMAILS) {
    const id = byName.get(email.name) ?? byName.get(email.oldName);
    if (id === undefined) {
      console.error(`NOT FOUND: no template named "${email.name}" or "${email.oldName}" — skipped`);
      continue;
    }
    await brevo.transactionalEmails.updateSmtpTemplate({
      templateId: id,
      templateName: email.name,
      subject: email.subject,
      sender: SENDER,
      replyTo: SENDER.email,
      htmlContent: renderHtml(email),
      tag: "brigado-cold-sequence",
      isActive: true,
    });
    console.log(`updated template ${id}: "${email.name}" — "${email.subject}"`);
  }
  console.log("\nDone. Review them in Brevo → Campagnes → Modèles, then wire the drip (J0/J+3/J+7/J+12/J+18) in Automations.");
}

main().catch((err) => {
  console.error("Update failed:", err);
  process.exit(1);
});
