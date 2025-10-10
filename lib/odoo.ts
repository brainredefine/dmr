// /lib/odoo.ts
import xmlrpc from "xmlrpc";

const {
  ODOO_URL = "",
  ODOO_DB = "",
  ODOO_USER = "",
  ODOO_API = "",
} = process.env;

function makeUrl(path: string) {
  // Odoo XML-RPC endpoints: /xmlrpc/2/common and /xmlrpc/2/object
  const base = ODOO_URL.replace(/\/+$/, "");
  return `${base}${path}`;
}

async function xmlrpcCall(url: string, method: string, params: any[]) {
  return new Promise((resolve, reject) => {
    const client = xmlrpc.createSecureClient({ url }); // https endpoint
    client.methodCall(method, params, (err: any, value: any) => {
      if (err) return reject(err);
      resolve(value);
    });
  });
}

export async function getUid() {
  const url = makeUrl("/xmlrpc/2/common");
  const uid = await xmlrpcCall(url, "authenticate", [ODOO_DB, ODOO_USER, ODOO_API, {}]);
  if (!uid) throw new Error("Odoo auth failed");
  return uid as number;
}

export async function execute_kw(
  model: string,
  method: string,
  args: any[] = [],
  kwargs: Record<string, any> = {}
) {
  const uid = await getUid();
  const url = makeUrl("/xmlrpc/2/object");
  return xmlrpcCall(url, "execute_kw", [ODOO_DB, uid, ODOO_API, model, method, args, kwargs]);
}

// remplace ENTIEREMENT la fonction search_read existante
export async function search_read(
  model: string,
  domain: any[],
  fields: string[],
  limit = 1
) {
  // args => [domain]
  // kwargs => { fields, limit }
  return execute_kw(model, "search_read", [domain], { fields, limit }) as Promise<any[]>;
}


export async function read(model: string, ids: number[] | number, fields: string[]) {
  const list = Array.isArray(ids) ? ids : [ids];
  const res = await execute_kw(model, "read", [list, fields]);
  return res as any[];
}
