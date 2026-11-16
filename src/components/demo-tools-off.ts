// What `@/components/demo-tools` resolves to in a build made without
// DEMO_MODE=true (next.config.ts): the demo banner never shows there, so no
// page of it carries the demo's client code (docs/design-system.md,
// Performance budgets).
export function DemoAdminTools() {
  return null;
}

export function DemoRolePicker() {
  return null;
}
