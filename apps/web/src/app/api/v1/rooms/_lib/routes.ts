import { getIdentityService } from "../../auth/_lib/runtime";
import { createRoomHandlers } from "./handlers";
import { getRoomService } from "./runtime";
export const roomHandlers = () => createRoomHandlers(getIdentityService(), getRoomService());
