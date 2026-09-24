// Kept as a compatibility entry point. Fixed passwords are no longer supported.
console.error(
  "Use npm run bootstrap:admin -- your-email@example.com. The command prompts for a password; no production password is stored in source.",
);
process.exitCode = 1;
