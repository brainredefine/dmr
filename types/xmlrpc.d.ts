// types/xmlrpc.d.ts
declare module "xmlrpc" {
  export interface XmlRpcClient {
    methodCall(
      method: string,
      params: unknown[],
      callback: (err: unknown, value: unknown) => void
    ): void;
  }

  export function createClient(options: { url: string } | string): XmlRpcClient;
  export function createSecureClient(options: { url: string } | string): XmlRpcClient;

  const _default: {
    createClient: typeof createClient;
    createSecureClient: typeof createSecureClient;
  };
  export default _default;
}
