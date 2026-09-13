import { NextRequest } from "next/server";
import { profileErasureHttp } from "@/lib/profile-erasure-http";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) { return profileErasureHttp(req); }
export {
  erasureMethodNotAllowed as GET,
  erasureMethodNotAllowed as PUT,
  erasureMethodNotAllowed as PATCH,
  erasureMethodNotAllowed as DELETE,
  erasureMethodNotAllowed as HEAD,
  erasureMethodNotAllowed as OPTIONS,
} from "@/lib/profile-erasure-http";
