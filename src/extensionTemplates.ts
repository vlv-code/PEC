/**
 * Source templates for extension files that are generated at build time.
 * Decomposed into modular templates under src/templates/:
 * - backgroundTemplate.ts
 * - managedSchemaTemplate.ts
 * - translations.ts
 * - popupHtmlTemplate.ts
 * - popupJsTemplate.ts
 *
 * This entrypoint preserves 100% backward compatibility for existing callers.
 */

export * from "./templates/index.js";
