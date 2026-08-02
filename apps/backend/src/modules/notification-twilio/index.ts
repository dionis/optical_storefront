import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import { TwilioNotificationService } from "./service";

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [TwilioNotificationService],
});
