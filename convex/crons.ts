import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "process due letters",
  { minutes: 15 },
  internal.letters.processDue,
);

export default crons;
