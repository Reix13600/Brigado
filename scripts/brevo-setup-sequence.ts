// One-off setup for the 5-email branching cold-outreach sequence.
// Idempotent: re-running skips attributes/templates that already exist.
//
//   npx tsx scripts/brevo-setup-sequence.ts
//
// Creates:
//   - Contact attributes: SEQUENCE_STAGE (text), LAST_EMAIL_SENT_DATE (date),
//     CONVERTED (boolean)
//   - 5 email templates (placeholder HTML — replace the content in the Brevo
//     dashboard or re-run with real HTML). Prints each template's ID.
//
// The branching workflow itself is built manually in the Brevo dashboard —
// Brevo does not expose automation workflows via API.
import { brevo, SENDER } from "./brevo";

const ATTRIBUTES = [
  { name: "SEQUENCE_STAGE", type: "text" },
  { name: "LAST_EMAIL_SENT_DATE", type: "date" },
  { name: "CONVERTED", type: "boolean" },
] as const;

const LOGO_URL = "https://brigado.solutions/logo-email.png";

function placeholderHtml(label: string): string {
  return `<!-- Placeholder généré automatiquement : remplacer par le contenu final -->
<div style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
    <tr>
      <td style="background:#020617;padding:24px;text-align:center;">
        <img src="${LOGO_URL}" alt="Brigado" width="240" style="max-width:240px;height:auto;" />
      </td>
    </tr>
    <tr>
      <td style="padding:32px 24px;color:#1f2937;font-size:15px;line-height:1.6;">
        <p>Bonjour {{ contact.RESTAURANT_NAME }},</p>
        <p><strong>[${label}]</strong> — contenu à venir.</p>
        <p style="color:#6b7280;font-size:13px;">Brigado — gestion des heures, plannings et paie pour la restauration.<br/>
        <a href="{{ unsubscribe }}" style="color:#6b7280;">Se désinscrire</a></p>
      </td>
    </tr>
  </table>
</div>`;
}

const TEMPLATES = [
  { name: "Brigado - Email 1 - Intro", subject: "Vos plannings et heures, sans tableurs — Brigado" },
  { name: "Brigado - Email 2 - Follow-up (not opened)", subject: "Brigado — 39 €/mois, équipe illimitée" },
  { name: "Brigado - Email 3 - Follow-up (opened, no click)", subject: "2 minutes pour voir Brigado en action ?" },
  { name: "Brigado - Email 4 - Social proof (clicked, no convert)", subject: "Comment des restaurants comme le vôtre utilisent Brigado" },
  { name: "Brigado - Email 5 - Last touch", subject: "Dernier message — l'essai gratuit Brigado reste ouvert" },
];

async function ensureAttributes(): Promise<void> {
  const existing = await brevo.contacts.getAttributes();
  const existingNames = new Set(
    (existing.attributes ?? []).map((a) => (a.name ?? "").toUpperCase()),
  );
  for (const attr of ATTRIBUTES) {
    if (existingNames.has(attr.name)) {
      console.log(`attribute ${attr.name}: already exists, skipped`);
      continue;
    }
    await brevo.contacts.createAttribute({
      attributeCategory: "normal",
      attributeName: attr.name,
      type: attr.type,
    });
    console.log(`attribute ${attr.name}: created (${attr.type})`);
  }
}

async function ensureTemplates(): Promise<void> {
  const existing = await brevo.transactionalEmails.getSmtpTemplates({ limit: 200 });
  const byName = new Map(
    (existing.templates ?? []).map((t) => [t.name, t.id] as const),
  );
  for (const tpl of TEMPLATES) {
    const existingId = byName.get(tpl.name);
    if (existingId !== undefined) {
      console.log(`template "${tpl.name}": already exists, ID ${existingId}`);
      continue;
    }
    const created = await brevo.transactionalEmails.createSmtpTemplate({
      templateName: tpl.name,
      subject: tpl.subject,
      sender: SENDER,
      replyTo: SENDER.email,
      htmlContent: placeholderHtml(tpl.name),
      tag: "brigado-cold-sequence",
      isActive: true,
    });
    console.log(`template "${tpl.name}": created, ID ${created.id}`);
  }
}

async function main(): Promise<void> {
  await ensureAttributes();
  await ensureTemplates();
  console.log("\nDone. Use the template IDs above when building the workflow in the Brevo dashboard.");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
