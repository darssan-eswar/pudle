import { HttpError } from './http';

export type DemoConfig = {
  DEMO_MODE?: string;
  DEMO_RESET_SECRET?: string;
  DEMO_DRIVER_PASSWORD?: string;
  DEMO_PASSENGER_PASSWORD?: string;
};

export function requireDemoReset(config: DemoConfig, providedSecret: string | null) {
  if (config.DEMO_MODE !== 'true') throw new HttpError(404, 'Not found.');
  if (!config.DEMO_RESET_SECRET || providedSecret !== config.DEMO_RESET_SECRET) {
    throw new HttpError(403, 'Demo reset is not allowed.');
  }
  if (!config.DEMO_DRIVER_PASSWORD || !config.DEMO_PASSENGER_PASSWORD) {
    throw new HttpError(503, 'Demo account passwords are not configured.');
  }
  return {
    driverPassword: config.DEMO_DRIVER_PASSWORD,
    passengerPassword: config.DEMO_PASSENGER_PASSWORD,
  };
}
