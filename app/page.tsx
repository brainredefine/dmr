// /app/page.tsx
"use client";

import { useState } from "react";

type DebugResp = {
  ok: boolean;
  invoiceName?: string;
  overrule?: boolean;
  missing?: string[];
  dataPreview?: Record<string, string>;
  notes?: string;
  error?: string;
};

export default function Page() {
  const [suffix, setSuffix] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [invoiceName, setInvoiceName] = useState<string | null>(null);

  async function fetchJSON<T>(url: string, body: any): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new Error((j as any).error || `HTTP ${res.status}`);
    return j;
  }

  async function downloadDoc(overrule: boolean) {
    const res = await fetch(`/api/dmr${overrule ? "" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suffix, overrule }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filename = invoiceName
      ? `DMR_${invoiceName.replaceAll("/", "-")}.docx`
      : `DMR_${suffix}.docx`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMissing(null);
    setInvoiceName(null);

    try {
      // 1) Diagnostic: on récupère missing + invoiceName
      const dbg = await fetchJSON<DebugResp>("/api/dmr?debug=1", { suffix });
      setInvoiceName(dbg.invoiceName || null);
      const miss = dbg.missing || [];
      if (miss.length === 0) {
        // 2) Rien ne manque → on génère direct
        await downloadDoc(true);
      } else {
        // 2) Il manque des champs → on affiche les boutons
        setMissing(miss);
      }
    } catch (err: any) {
      setError(err.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  async function onOverrule() {
    setLoading(true);
    setError(null);
    try {
      await downloadDoc(true);
      setMissing(null); // reset après succès
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  function onCancel() {
    setMissing(null);
    setError(null);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border p-6 shadow-sm"
        >
          <label className="block text-sm font-medium">
            5 derniers chiffres (Re.:/2025/xxxxx)
          </label>
          <input
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            inputMode="numeric"
            maxLength={5}
            placeholder="00008"
            className="w-full border rounded-lg px-3 py-2"
          />
          <button
            type="submit"
            disabled={loading || suffix.length !== 5}
            className="w-full bg-black text-white rounded-lg py-2 disabled:opacity-50"
          >
            {loading ? "Vérification..." : "Générer le document"}
          </button>
        </form>

        {error && (
          <div className="text-sm text-red-600 border border-red-200 bg-red-50 p-3 rounded-lg">
            {error}
          </div>
        )}

        {missing && (
          <div className="rounded-2xl border p-6 space-y-4">
            <p className="text-sm">
              Des champs Odoo manquent. Tu peux{" "}
              <span className="font-semibold">annuler</span> pour corriger les
              données, ou <span className="font-semibold">forcer</span> la
              génération (les zones manquantes seront vides).
            </p>

            <div>
              <p className="text-sm font-medium mb-1">Champs manquants :</p>
              <ul className="list-disc pl-5 text-sm">
                {missing.map((m) => (
                  <li key={m}>[{m}]</li>
                ))}
              </ul>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 border rounded-lg py-2"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={onOverrule}
                className="flex-1 bg-black text-white rounded-lg py-2"
                disabled={loading}
              >
                Overrule (faire quand même)
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
