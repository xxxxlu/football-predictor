import { privacyHandlers } from "../../../_lib/privacy-runtime";

export const runtime = "nodejs";

export const GET = (request: Request) => privacyHandlers().adminDataList(request);