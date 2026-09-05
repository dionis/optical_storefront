import FrameMediaModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const FRAME_MEDIA_MODULE = "frameMedia";

export default Module(FRAME_MEDIA_MODULE, {
  service: FrameMediaModuleService,
});
