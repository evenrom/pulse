import bcrypt from "bcryptjs";

export function validatePin(pin: string): boolean {
  if (!pin) {
    throw new Error("PIN is required for validation.");
  }

  if (typeof pin !== "string") {
    throw new Error("PIN must be a string.");
  }

  // Ensure it's exactly 4 digits
  if (!/^\d{4}$/.test(pin)) {
    return false;
  }

  const appPinCode = process.env.APP_PIN_CODE;

  if (!appPinCode) {
    throw new Error("APP_PIN_CODE environment variable is missing.");
  }

  return bcrypt.compareSync(pin, appPinCode);
}
