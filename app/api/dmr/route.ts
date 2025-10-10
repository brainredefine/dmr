// /app/api/dmr/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { search_read, read } from "@/lib/odoo";

/* ===== Types ===== */
type M2O = [number, string];

interface AccountMove {
  id: number;
  name: string | M2O;
  tenancy_id: M2O | false | null;
  period_date_start?: string | null;
  invoice_date?: string | null;
}

interface Tenancy {
  id: number;
  name: string;
  partner_id: M2O | false | null;
  current_rent?: number | string | null;
  current_ancillary_costs?: number | string | null;
  ancillary_cost_type_id?: M2O | false | null;
  total_current_rent_gross?: number | string | null;
  main_property_id?: M2O | false | null;
}

interface ResPartner {
  id: number;
  name?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  vat?: string | null;
}

interface PropertyProperty {
  id: number;
  entity_id?: M2O | false | null;
  sales_person_id?: M2O | false | null;
}

/* ===== Helpers ===== */
function fmtMoney(n: unknown): string {
  const v = Number(n);
  if (!isFinite(v)) return "";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}
function fmtDateJJMMYYYY(s: unknown): string {
  if (!s) return "";
  const d = new Date(String(s));
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
function m2oLabel(v: unknown): string {
  return Array.isArray(v) && v.length >= 2 ? String((v as M2O)[1] ?? "") : "";
}
function m2oId(v: unknown): number | null {
  return Array.isArray(v) && v.length >= 1 ? Number((v as M2O)[0]) : null;
}
function safeJoin(parts: Array<string | null | undefined>, sep = " "): string {
  return parts.filter(Boolean).map((x) => String(x)).join(sep).trim();
}
function parseTenancyUnit(label: string): string {
  const parts = label.split("-").map((p) => p.trim());
  if (parts.length >= 2) return `${parts[0]} - ${parts[1]}`.trim();
  return parts[0] || "";
}
function splitTypeAndPct(label: string): { type: string; pct: string } {
  const m = label.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (m) return { type: m[1].trim(), pct: m[2].trim() };
  return { type: label.trim(), pct: "" };
}
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/* ===== Handler ===== */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const overruleQS = url.searchParams.get("overrule") === "1";

  try {
    const body = (await req.json().catch(() => ({}))) as { suffix?: unknown; overrule?: unknown };
    const suffix = String(body?.suffix ?? "").trim();
    const overrule = Boolean(body?.overrule) || overruleQS;

    if (!/^\d{5}$/.test(suffix)) {
      return NextResponse.json(
        { ok: false, error: "Suffix invalide (5 chiffres requis)." },
        { status: 400 }
      );
    }

    const invoiceName = `Re.:/2025/${suffix}`;

    // 1) account.move
    const moves = await search_read<AccountMove>(
      "account.move",
      [["name", "=", invoiceName]],
      ["id", "name", "tenancy_id", "period_date_start", "invoice_date"],
      1
    );
    if (moves.length === 0) {
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
      return NextResponse.json({ ok: false, error: "Facture sans tenancy_id." }, { status: 400 });
    }

    // 2) tenancy
    const tenancyArr = await read<Tenancy>("property.tenancy", tenancyId, [
      "id",
      "name",
      "partner_id",
      "current_rent",
      "current_ancillary_costs",
      "ancillary_cost_type_id",
      "total_current_rent_gross",
      "main_property_id",
    ]);
    const tenancy = tenancyArr[0];
    if (!tenancy) {
      return NextResponse.json(
        { ok: false, error: `Tenancy introuvable (${tenancyId})` },
        { status: 404 }
      );
    }

    // 3) contact
    const contactId = m2oId(tenancy.partner_id);
    let contact: ResPartner | null = null;
    if (contactId) {
      const r = await read<ResPartner>("res.partner", contactId, ["id", "name", "street", "zip", "city"]);
      contact = Array.isArray(r) ? r[0] : null;
    }

    // 4) property.property
    const mainPropId = m2oId(tenancy.main_property_id);
    let mainProp: PropertyProperty | null = null;
    if (mainPropId) {
      const r = await read<PropertyProperty>("property.property", mainPropId, [
        "id",
        "entity_id",
        "sales_person_id",
      ]);
      mainProp = Array.isArray(r) ? r[0] : null;
    }

    // 5) entity
    const entityId = m2oId(mainProp?.entity_id);
    const entityLabel = m2oLabel(mainProp?.entity_id);
    let entity: ResPartner | null = null;
    if (entityId) {
      const r = await read<ResPartner>("res.partner", entityId, ["id", "name", "vat", "street", "zip", "city"]);
      entity = Array.isArray(r) ? r[0] : null;
    }

    // 6) salesperson
    const salesmanLabel = m2oLabel(mainProp?.sales_person_id);

    // 7) ancillary
    const { type: typeneben, pct: taxpct } = splitTypeAndPct(m2oLabel(tenancy.ancillary_cost_type_id));

    // 8) montants
    const currentRent = Number(tenancy.current_rent ?? 0);
    const currentNeben = Number(tenancy.current_ancillary_costs ?? 0);
    const totalRent = Number(tenancy.total_current_rent_gross ?? 0);

    const tax = currentRent * 0.19;
    const taxNeben = Number((currentNeben * 0.19).toFixed(2));
    const total1 = currentRent + tax;
    const total2 = currentNeben + taxNeben;

    // 9) adresses
    const contactAddress = contact?.street ?? "";
    const contactZipCity = safeJoin([contact?.zip ?? "", contact?.city ?? ""], " ");
    const contactTotalAddress = safeJoin(
      [contactAddress, contactZipCity ? `, ${contactZipCity}` : ""],
      ""
    );

    // virgule entre street et zip/city
    const entityAddress = entity?.street
      ? `${entity.street}${entity.zip || entity.city ? ", " : ""}${safeJoin(
          [entity?.zip ?? "", entity?.city ?? ""],
          " "
        )}`
      : safeJoin([entity?.zip ?? "", entity?.city ?? ""], " ");

    // dates + unité
    const timeStart = fmtDateJJMMYYYY(move.period_date_start ?? "");
    const invDate = fmtDateJJMMYYYY(move.invoice_date ?? "");
    const tenancyUnit = parseTenancyUnit(tenancyLabel);

    // data pour docx
    const data: Record<string, string> = {
      contactname: contact?.name ?? "",
      address: contactAddress,
      zipcity: contactZipCity,
      timestart: timeStart,
      totaladdress: contactTotalAddress,
      tenancyunit: tenancyUnit,
      invoiceid: moveName,
      entityid: entityLabel,
      ustid: entity?.vat ?? "",
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
      taxneben: fmtMoney(total2 - currentNeben), // TVA côté charges = total2 - currentneben
    };

    // missing
    const missing = Object.entries(data)
      .filter(([, v]) => isEmpty(v))
      .map(([k]) => k);

    if (debug) {
      return NextResponse.json(
        { ok: true, invoiceName, overrule, missing, dataPreview: data },
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

    // génération docx (Uint8Array -> ArrayBuffer -> Response)
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
      parser: (tag: string) => ({
        get: (scope: Record<string, string>) => scope[tag] ?? "",
      }),
    });

    doc.render(data);

    // -> Uint8Array
    const u8 = doc.getZip().generate({ type: "uint8array" }) as Uint8Array;
    // -> ArrayBuffer slice correct
    const arrayBuffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

    const fileName = `DMR_${invoiceName.replaceAll("/", "-")}.docx`;
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur serveur";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
