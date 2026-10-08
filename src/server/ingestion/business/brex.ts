/**
 * Brex connector. (Implementation pending.)
 */
import type { BusinessConnector } from "./types";

export const brexConnector: BusinessConnector = {
  provider: "BREX",
  async sync() {
    throw new Error("Brex sync is not implemented yet");
  },
};
