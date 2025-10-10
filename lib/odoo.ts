// /lib/odoo.ts
import xmlrpc from "xmlrpc";

const {
  ODOO_URL = "",
  ODOO_DB = "",
  ODOO_USER = "",
  ODOO_API = "",
} = process.env;

function makeUrl(path: string): string {
  const base = ODOO_URL.replace(/\/+$/, "");
  return `${base}${path}`;
}

function xmlrpcCall<T = unknown>(url: string, method: string, params: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const client = xmlrpc.createSecureClient({ url });
    // Types minimalistes, sans `any`
    client.methodCall(method, params, (err: unknown, value: unknown) => {
      if (err) return reject(err);
      resolve(value as T);
    });
  });
}

export async function getUid(): Promise<number> {
  const url = makeUrl("/xmlrpc/2/common");
  const uid = await xmlrpcCall<number>(url, "authenticate", [ODOO_DB, ODOO_USER, ODOO_API, {}]);
  if (!uid) throw new Error("Odoo auth failed");
  return uid;
}

export async function execute_kw<T = unknown>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  const uid = await getUid();
  const url = makeUrl("/xmlrpc/2/object");
  return xmlrpcCall<T>(url, "execute_kw", [ODOO_DB, uid, ODOO_API, model, method, args, kwargs]);
}

export async function search_read<
  T extends Record<string, unknown> = Record<string, unknown>
>(
  model: string,
  domain: unknown[],
  fields: string[],
  limit = 1
): Promise<T[]> {
  return execute_kw<T[]>(
    model,
    "search_read",
    [domain],
    { fields, limit }
  );
}

export async function read<
  T extends Record<string, unknown> = Record<string, unknown>
>(
  model: string,
  ids: number | number[],
  fields: string[]
): Promise<T[]> {
  const list = Array.isArray(ids) ? ids : [ids];
  return execute_kw<T[]>(model, "read", [list, fields]);
}
