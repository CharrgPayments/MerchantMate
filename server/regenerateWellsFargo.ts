/**
 * One-shot ops script: regenerates the Wells Fargo MPA form fields.
 *
 * Run with:  TARGET_DB=development tsx server/regenerateWellsFargo.ts
 *
 * Routes through the Drizzle ORM (`getActiveDb`) so the script honours the
 * data-tier abstraction — no direct `pool.query` calls. The target environment
 * is selected via the TARGET_DB env var; unspecified ⇒ production (matches
 * the static fallback in db.ts).
 */
import { getActiveDb, getDynamicDatabase, runWithDb } from "./db";
import { pdfFormFields } from "@shared/schema";
import { getWellsFargoMPAForm } from "./wellsFargoMPA";

async function regenerateFormFields() {
  try {
    const formSections = getWellsFargoMPAForm();
    const formId = 1;
    const totalFields = formSections.reduce((acc, s) => acc + s.fields.length, 0);

    console.log(`Regenerating Wells Fargo form with ${totalFields} fields`);

    const db = getActiveDb();
    for (const section of formSections) {
      for (const field of section.fields) {
        await db.insert(pdfFormFields).values({
          formId,
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          fieldLabel: field.fieldLabel,
          isRequired: field.isRequired,
          options: field.options ?? null,
          defaultValue: field.defaultValue ?? null,
          validation: field.validation ?? null,
          position: field.position,
          section: section.title ?? null,
        } as any);
      }
    }

    console.log("Form fields regenerated successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error regenerating form fields:", error);
    process.exit(1);
  }
}

const targetEnv = process.env.TARGET_DB || "production";
runWithDb(getDynamicDatabase(targetEnv), regenerateFormFields);
