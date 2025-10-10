export const runtime = "nodejs";
export const dynamic = "force-dynamic";           // pas de caching
export const preferredRegion = ["fra1","cdg1"];   // EU (Frankfurt/Paris)
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { search_read, read } from "@/lib/odoo";

/* ========== Helpers ========== */
function fmtMoney(n: any) {
  const v = Number(n);
  if (!isFinite(v)) return "";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}
function fmtDateJJMMYYYY(s: any) {
  if (!s) return "";
  const d = new Date(String(s));
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
function m2oLabel(v: any): string {
  return Array.isArray(v) && v.length >= 2 ? String(v[1] ?? "") : "";
}
function m2oId(v: any): number | null {
  return Array.isArray(v) && v.length >= 1 ? Number(v[0]) : null;
}
function safeJoin(parts: Array<string | null | undefined>, sep = " ") {
  return parts.filter(Boolean).map((x) => String(x)).join(sep).trim();
}
function parseTenancyUnit(label: string) {
  const parts = label.split("-").map((p) => p.trim());
  if (parts.length >= 2) return `${parts[0]} - ${parts[1]}`.trim();
  return parts[0] || "";
}
function splitTypeAndPct(label: string) {
  const m = label.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (m) return { type: m[1].trim(), pct: m[2].trim() };
  return { type: label.trim(), pct: "" };
}
function isEmpty(v: any) {
  return v === null || v === undefined || v === "";
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const overruleQS = url.searchParams.get("overrule") === "1";
  const diag: any = { ok: false, steps: {} };

  try {
    const body = await req.json().catch(() => ({}));
    const suffix = String(body?.suffix ?? "").trim();
    const overruleBody = Boolean(body?.overrule);
    const overrule = overruleBody || overruleQS;

    if (!/^\d{5}$/.test(suffix)) {
      return NextResponse.json(
        { ok: false, error: "Suffix invalide (5 chiffres requis)." },
        { status: 400 }
      );
    }

    const invoiceName = `Re.:/2025/${suffix}`;
    diag.steps.invoiceName = invoiceName;

    // 1️⃣ account.move
    const moves = await search_read(
      "account.move",
      [["name", "=", invoiceName]],
      ["id", "name", "tenancy_id", "period_date_start", "invoice_date"],
      1
    );
    if (!moves.length) {
      return NextResponse.json(
        { ok: false, error: `Facture introuvable: ${invoiceName}` },
        { status: 404 }
      );
    }

    const move = moves[0];
    const moveName = typeof move.name === "string" ? move.name : m2oLabel(move.name);
    const tenancyLabel = m2oLabel(move.tenancy_id);
    const tenancyId = m2oId(move.tenancy_id);
    if (!tenancyId) {
      return NextResponse.json(
        { ok: false, error: "Facture sans tenancy_id." },
        { status: 400 }
      );
    }

    // 2️⃣ property.tenancy
    const [tenancy] = await read("property.tenancy", tenancyId, [
      "id",
      "name",
      "partner_id",
      "current_rent",
      "current_ancillary_costs",
      "ancillary_cost_type_id",
      "total_current_rent_gross",
      "main_property_id",
    ]);
    if (!tenancy) {
      return NextResponse.json(
        { ok: false, error: `Tenancy introuvable (${tenancyId})` },
        { status: 404 }
      );
    }

    // 3️⃣ Contact
    const contactId = m2oId(tenancy.partner_id);
    let contact: any = null;
    if (contactId) {
      const r = await read("res.partner", contactId, ["id", "name", "street", "zip", "city"]);
      contact = Array.isArray(r) ? r[0] : null;
    }

    // 4️⃣ property.property
    const mainPropId = m2oId(tenancy.main_property_id);
    let mainProp: any = null;
    if (mainPropId) {
      const r = await read("property.property", mainPropId, [
        "id",
        "entity_id",
        "sales_person_id",
      ]);
      mainProp = Array.isArray(r) ? r[0] : null;
    }

    // 5️⃣ Entity
    const entityId = m2oId(mainProp?.entity_id);
    const entityLabel = m2oLabel(mainProp?.entity_id);
    let entity: any = null;
    if (entityId) {
      const r = await read("res.partner", entityId, ["id", "name", "vat", "street", "zip", "city"]);
      entity = Array.isArray(r) ? r[0] : null;
    }

    // 6️⃣ Salesperson
    const salesmanLabel = m2oLabel(mainProp?.sales_person_id);

    // 7️⃣ Ancillary
    const ancillaryLabel = m2oLabel(tenancy.ancillary_cost_type_id);
    const { type: typeneben, pct: taxpct } = splitTypeAndPct(ancillaryLabel);

    // 8️⃣ Montants
    const currentRent = Number(tenancy.current_rent ?? 0);
    const currentNeben = Number(tenancy.current_ancillary_costs ?? 0);
    const totalRent = Number(tenancy.total_current_rent_gross ?? 0);

    const tax = currentRent * 0.19;
    const taxNeben = Number((currentNeben * 0.19).toFixed(2));
    const total1 = currentRent + tax;
    const total2 = currentNeben + taxNeben;

    // 9️⃣ Adresses
    const contactAddress = contact?.street || "";
    const contactZipCity = safeJoin([contact?.zip, contact?.city], " ");
    const contactTotalAddress = safeJoin(
      [contactAddress, contactZipCity ? `, ${contactZipCity}` : ""],
      ""
    );

    // 👉 Ajout virgule entre rue et zip/city pour entityaddress
    const entityAddress = entity?.street
      ? `${entity.street}${entity.zip || entity.city ? ", " : ""}${safeJoin(
          [entity?.zip, entity?.city],
          " "
        )}`
      : safeJoin([entity?.zip, entity?.city], " ");

    // 🔟 Dates + unité
    const timeStart = fmtDateJJMMYYYY(move.period_date_start);
    const invDate = fmtDateJJMMYYYY(move.invoice_date);
    const tenancyUnit = parseTenancyUnit(tenancyLabel);

    // 🔢 Données Word
    const data = {
      contactname: contact?.name || "",
      address: contactAddress,
      zipcity: contactZipCity,
      timestart: timeStart,
      totaladdress: contactTotalAddress,
      tenancyunit: tenancyUnit,
      invoiceid: moveName,
      entityid: entityLabel,
      ustid: entity?.vat || "",
      entityaddress: entityAddress,
      salesman: salesmanLabel,
      date: invDate,
      currentrent: fmtMoney(currentRent),
      tax: fmtMoney(tax),
      typeneben,
      taxpct,
      currentneben: fmtMoney(currentNeben),
      totalrent: fmtMoney(totalRent),
      total1: fmtMoney(total1),
      total2: fmtMoney(total2),
      taxneben: fmtMoney(total2 - currentNeben),
    };

    // ✅ Check missing
    const missing: string[] = [];
    const keys = Object.keys(data);
    for (const k of keys) {
      if (isEmpty((data as any)[k])) missing.push(k);
    }

    if (debug) {
      return NextResponse.json(
        {
          ok: true,
          invoiceName,
          overrule,
          missing,
          dataPreview: data,
          notes:
            missing.length > 0
              ? "Des tokens sortiront vides. Utilise {overrule:true} pour générer quand même."
              : "Tout est prêt.",
        },
        { status: 200 }
      );
    }

    if (missing.length && !overrule) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Champs manquants détectés. Ajoute {overrule:true} ou ?overrule=1 pour générer quand même.",
          missing,
        },
        { status: 422 }
      );
    }

    // 🧩 Word
    const tplPath = path.join(process.cwd(), "public", "dmr.docx");
    if (!fs.existsSync(tplPath)) {
      return NextResponse.json(
        { ok: false, error: "Template introuvable: public/dmr.docx" },
        { status: 500 }
      );
    }

    const tplBuffer = fs.readFileSync(tplPath);
    const zip = new PizZip(tplBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "[", end: "]" },
      nullGetter: () => "",
      parser: (tag) => ({ get: (scope: any) => scope[tag] }),
    });

    doc.render(data);

    const nodeBuffer = doc.getZip().generate({ type: "nodebuffer" });
    const blob = new Blob([nodeBuffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const fileName = `DMR_${invoiceName.replaceAll("/", "-")}.docx`;
    return new NextResponse(blob, {
      status: 200,
      headers: { "Content-Disposition": `attachment; filename="${fileName}"` },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Erreur serveur" },
      { status: 500 }
    );
  }
}
