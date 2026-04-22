/**
 * Shared Zod validators for write-side API endpoints.
 *
 * These were originally inlined inside `registerRoutes()` in
 * `server/routes.ts` (the validation pass added in Task #69). They are
 * lifted out here so the production routes AND the validation regression
 * tests in `server/__tests__/validation.routes.test.ts` import the *same*
 * schema instance — guaranteeing that any change to a schema is detected
 * by the test suite (no copy-paste drift).
 *
 * Each route still owns its 4xx error message text and which envelope key
 * (`errors` vs `details`) it uses; the schemas here are intentionally
 * scoped to "what is a valid request body" only.
 */
import { z } from "zod";
import { insertCampaignSchema } from "@shared/schema";

// POST /api/prospects/:id/messages  (and POST /api/portal/messages)
export const messageBodySchema = z.object({
  subject: z.string().optional(),
  message: z.string().min(1, "Message body required"),
});

// POST /api/prospects/:id/file-requests
export const fileRequestBodySchema = z.object({
  label: z.string().min(1, "Label required"),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

// POST /api/portal/file-requests/:id/upload
export const portalUploadBodySchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  fileData: z.string().min(1), // base64 fileData from client
});

// POST /api/signature-request
export const signatureRequestBodySchema = z.object({
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  companyName: z.string().min(1),
  ownershipPercentage: z.union([z.string(), z.number()]),
  requesterName: z.string().optional(),
  agentName: z.string().optional(),
  prospectId: z.union([z.number(), z.string()]).transform((v) => Number(v)),
});

// POST /api/signature-submit
export const signatureSubmitBodySchema = z.object({
  signatureToken: z.string().min(1),
  signature: z.string().min(1),
  signatureType: z.string().optional(),
});

// POST /api/prospects/:id/save-inline-signature
export const inlineSignatureBodySchema = z.object({
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1),
  signature: z.string().min(1),
  signatureType: z.string().min(1),
  ownershipPercentage: z.union([z.string(), z.number()]).optional(),
});

// POST /api/campaigns
export const campaignCreateBodySchema = insertCampaignSchema.extend({
  feeValues: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  equipmentIds: z.array(z.number()).optional(),
  templateId: z.union([z.number(), z.string()]).nullable().optional(),
});

// PUT /api/campaigns/:id
export const campaignUpdateBodySchema = insertCampaignSchema.partial().extend({
  feeValues: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  equipmentIds: z.array(z.number()).optional(),
  pricingTypeIds: z.array(z.number()).optional(),
  templateId: z.union([z.number(), z.string()]).nullable().optional(),
  selectedEquipment: z.array(z.number()).optional(),
});
