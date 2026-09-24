export function userMessage(error: unknown): string {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "Unable to complete the request.";
  const allowed = [
    "Access denied",
    "Insufficient stock",
    "Concurrent session limit",
    "Session revoked",
    "Business suspended",
    "Tax configuration missing",
    "Open your register",
    "Invalid return quantity",
    "Product not found",
    "Store limit reached",
    "User limit reached",
    "Payment total",
    "Discount exceeds",
    "Explain the cash variance",
    "No open register",
    "Invalid transfer transition",
    "Reason required",
    "administrator email is already registered",
    "Unable to create the administrator login",
    "Unable to create the entity",
    "Unable to create the Entity Admin profile",
    "Invalid admin_",
    "Invalid new_password",
    "Invalid new_email",
    "No active Entity Admin account exists",
    "Unable to reset the Entity Admin login",
    "Unable to verify the new email address",
    "passwords do not match",
    "Assign at least one store",
    "user email is already registered",
    "Unable to create the user login",
    "Unable to assign the selected stores",
    "Unable to update the user login",
    "Unable to update the user profile",
    "Bulk product import is not enabled in this database",
    "Select at least one item",
    "Select a replacement product",
    "Invalid replacement quantity",
    "Daily registers close automatically",
  ];
  if (
    allowed.some((text) =>
      message.toLowerCase().includes(text.toLowerCase()),
    )
  )
    return message;
  if (message.includes("duplicate key"))
    return "This code or record already exists. Use a unique value.";
  if (message.includes("fetch") || message.includes("network"))
    return "Connection lost. Your cart is preserved; retry when connected.";
  if (message.includes("Invalid login credentials"))
    return "Incorrect email or password.";
  return "Unable to complete the request. Check your input, permissions and database setup.";
}
