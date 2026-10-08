/**
 * HubSpot connector. (Implementation pending.)
 */
import type { BusinessConnector } from "./types";

export const hubspotConnector: BusinessConnector = {
  provider: "HUBSPOT",
  async sync() {
    throw new Error("HubSpot sync is not implemented yet");
  },
};
