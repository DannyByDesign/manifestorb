import { initDataset, type Dataset } from "braintrust";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("braintrust");

// Used for evals. Not used in production.
export class Braintrust {
  private readonly dataset: any = null;

  constructor(dataset: string) {
    if (process.env.BRAINTRUST_API_KEY) {
      this.dataset = initDataset("amodel", { dataset });
    }
  }

  insertToDataset(data: { id: string; input: unknown; expected?: unknown }) {
    if (!this.dataset) return;

    try {
      this.dataset.insert(data);
    } catch (error) {
      logger.error("Error inserting to Braintrust dataset", { error });
    }
  }
}
