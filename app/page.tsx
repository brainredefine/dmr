// /app/page.tsx
"use client";

import { useState } from "react";

type DebugResp = {
  ok: boolean;
  invoiceName?: string;
  overrule?: boolean;
  missing?: string[];
  dataPreview?: Record<string, string>;
  error?: string;
};

export default function Page() {
  const [suffix, setSuffix] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [invoiceName, setInvoiceName] = useState<string | null>(null);

  async function fetchJSON<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as unknown as T;
    if (!res.ok) {
      const errText = (j as unknown as { error?: string }).error || `HTTP ${res.status}`;
      throw new Error(errText);
    }
    return j;
  }

  async function downloadDoc(overrule: boolean): Promise<void> {
    const res = await fetch(`/api/dmr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suffix, overrule }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
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
      const dbg = await fetchJSON<DebugResp>("/api/dmr?debug=1", { suffix });
      setInvoiceName(dbg.invoiceName ?? null);
      const miss = dbg.missing ?? [];
      if (miss.length === 0) {
        await downloadDoc(true);
      } else {
        setMissing(miss);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function onOverrule() {
    try {
      setLoading(true);
      setError(null);
      await downloadDoc(true);
      setMissing(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur";
      setError(message);
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
            Invoice&apos;s 5 last numbers (Re.:/2025/xxxxx)
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
            {loading ? "Checking the information..." : "Generate the DMR"}
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
              Some fields are missing. You can{" "}
              <span className="font-semibold">cancel</span> to add or correct the data in Odoo
              , or <span className="font-semibold">force</span> the word
              generation (missing fields will just be empty).
            </p>

            <div>
              <p className="text-sm font-medium mb-1">Missing fields :</p>
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
                className="flex-1 border rounded-lg py-2"
                disabled={loading}
              >
                Overrule
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
