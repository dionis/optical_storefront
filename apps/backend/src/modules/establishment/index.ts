import EstablishmentModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

export const ESTABLISHMENT_MODULE = "establishment";

export default Module(ESTABLISHMENT_MODULE, {
  service: EstablishmentModuleService,
});
