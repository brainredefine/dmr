// /middleware.ts
import { NextResponse, NextRequest } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="DMR"' },
  });
}

export async function middleware(req: NextRequest) {
  // Laisse passer assets et Next internals
  const p = req.nextUrl.pathname;
  if (
    p.startsWith("/_next/") ||
    p.startsWith("/favicon.ico") ||
    p.startsWith("/public/")
  ) {
    return NextResponse.next();
  }

  // Si pas de PASSWORD défini -> auth désactivée (pratique en dev local)
  const PASSWORD = process.env.PASSWORD;
  if (!PASSWORD) return NextResponse.next();

  // Vérifie l’en-tête Authorization: Basic xxx
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  // Décodage Basic (username:password) — on ne checke que le password
  const b64 = auth.split(" ")[1]!;
  const [/*user*/, pass = ""] = atob(b64).split(":");

  if (pass !== PASSWORD) return unauthorized();

  return NextResponse.next();
}

export const config = {
  // protège toutes les routes
  matcher: ["/:path*"],
};
