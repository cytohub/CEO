/**
 * QuickBooks Online connector. (Implementation pending.)
 */
import type { BusinessConnector } from "./types";

export const quickbooksConnector: BusinessConnector = {
  provider: "QUICKBOOKS",
  async sync() {
    throw new Error("QuickBooks Online sync is not implemented yet");
  },
};
