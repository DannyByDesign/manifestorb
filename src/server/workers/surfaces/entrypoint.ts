import { startSurfacesWorker } from "./index";

if (process.env.NODE_ENV !== "test") {
  void startSurfacesWorker();
}
