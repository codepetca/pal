import { NextRequest } from "next/server";
import { profileErasureHttp } from "@/lib/profile-erasure-http";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, context: { params: Promise<{ operation_id: string }> }) {
  return profileErasureHttp(req, (await context.params).operation_id);
}
export {
  erasureMethodNotAllowed as POST,
  erasureMethodNotAllowed as PUT,
  erasureMethodNotAllowed as PATCH,
  erasureMethodNotAllowed as DELETE,
  erasureMethodNotAllowed as HEAD,
  erasureMethodNotAllowed as OPTIONS,
} from "@/lib/profile-erasure-http";
