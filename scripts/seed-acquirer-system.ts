#!/usr/bin/env tsx

import { getDynamicDatabase } from "../server/db.js";
import { acquirers, acquirerApplicationTemplates, campaigns } from "@shared/schema";
import { eq } from "drizzle-orm";

async function seedAcquirerSystem() {
  console.log("🌱 Starting acquirer system seeding...");
  
  try {
    // Use development database
    const db = getDynamicDatabase("dev");
    
    // First, let's try to create the tables if they don't exist
    console.log("📊 Creating acquirer tables...");
    
    try {
      // Create acquirers table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS "acquirers" (
          "id" serial PRIMARY KEY NOT NULL,
          "name" text NOT NULL UNIQUE,
          "display_name" text NOT NULL,
          "code" text NOT NULL UNIQUE,
          "description" text,
          "is_active" boolean DEFAULT true NOT NULL,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL
        );
      `);
      
      // Create acquirer_application_templates table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS "acquirer_application_templates" (
          "id" serial PRIMARY KEY NOT NULL,
          "acquirer_id" integer NOT NULL REFERENCES "acquirers"("id") ON DELETE CASCADE,
          "template_name" text NOT NULL,
          "version" text DEFAULT '1.0' NOT NULL,
          "is_active" boolean DEFAULT true NOT NULL,
          "field_configuration" jsonb NOT NULL,
          "pdf_mapping_configuration" jsonb,
          "required_fields" text[] DEFAULT ARRAY[]::text[] NOT NULL,
          "conditional_fields" jsonb,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL,
          CONSTRAINT "acquirer_application_templates_acquirer_id_template_name_version_unique" UNIQUE("acquirer_id", "template_name", "version")
        );
      `);
      
      // Create prospect_applications table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS "prospect_applications" (
          "id" serial PRIMARY KEY NOT NULL,
          "prospect_id" integer NOT NULL REFERENCES "merchant_prospects"("id") ON DELETE CASCADE,
          "acquirer_id" integer NOT NULL REFERENCES "acquirers"("id"),
          "template_id" integer NOT NULL REFERENCES "acquirer_application_templates"("id"),
          "template_version" text NOT NULL,
          "status" text DEFAULT 'draft' NOT NULL,
          "application_data" jsonb DEFAULT '{}' NOT NULL,
          "submitted_at" timestamp,
          "approved_at" timestamp,
          "rejected_at" timestamp,
          "rejection_reason" text,
          "generated_pdf_path" text,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL,
          CONSTRAINT "prospect_applications_prospect_id_acquirer_id_unique" UNIQUE("prospect_id", "acquirer_id")
        );
      `);
      
      // Add acquirer_id column to campaigns if it doesn't exist
      await db.execute(`
        ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "acquirer_id" integer REFERENCES "acquirers"("id");
      `);
      
      console.log("✅ Tables created successfully");
    } catch (tableError) {
      console.log("📋 Tables might already exist, continuing with seeding...");
    }
    
    // Check if acquirers already exist
    const existingAcquirers = await db.select().from(acquirers);
    
    if (existingAcquirers.length > 0) {
      console.log(`📊 Found ${existingAcquirers.length} existing acquirers, skipping acquirer seeding`);
      console.log("✅ Acquirer system seeding completed!");
      return;
    }
    
    // Seed initial acquirers
    console.log("🏦 Seeding acquirers...");
    
    const acquirerData = [
      {
        name: "Wells Fargo",
        displayName: "Wells Fargo Merchant Services",
        code: "WF",
        description: "Wells Fargo's merchant payment processing services offering competitive rates and comprehensive support.",
        isActive: true
      },
      {
        name: "Merrick Bank",
        displayName: "Merrick Bank Payment Solutions",
        code: "MB",
        description: "Merrick Bank's payment processing platform with flexible terms and innovative solutions.",
        isActive: true
      },
      {
        name: "Esquire Bank",
        displayName: "Esquire Bank Payment Services",
        code: "EB",
        description: "Esquire Bank's merchant services providing secure and reliable payment processing.",
        isActive: true
      }
    ];
    
    const insertedAcquirers = await db.insert(acquirers).values(acquirerData).returning();
    console.log(`✅ Created ${insertedAcquirers.length} acquirers`);
    
    // Seed application templates for each acquirer
    console.log("📋 Seeding application templates...");
    
    const templateData = [];
    
    // Wells Fargo templates
    templateData.push({
      acquirerId: insertedAcquirers[0].id,
      templateName: "Standard Application",
      version: "1.0",
      isActive: true,
      fieldConfiguration: {
        sections: [
          {
            id: "business_info",
            title: "Business Information",
            fields: [
              { id: "business_name", label: "Business Name", type: "text", required: true },
              { id: "dba_name", label: "DBA Name", type: "text", required: false },
              { id: "business_type", label: "Business Type", type: "select", required: true, options: ["Corporation", "LLC", "Partnership", "Sole Proprietorship"] },
              { id: "tax_id", label: "Tax ID/EIN", type: "text", required: true, pattern: "^\\d{2}-\\d{7}$" },
              { id: "business_phone", label: "Business Phone", type: "tel", required: true },
              { id: "business_address", label: "Business Address", type: "address", required: true }
            ]
          },
          {
            id: "owner_info",
            title: "Owner Information",
            fields: [
              { id: "owner_name", label: "Owner Name", type: "text", required: true },
              { id: "owner_ssn", label: "Owner SSN", type: "text", required: true, pattern: "^\\d{3}-\\d{2}-\\d{4}$", sensitive: true },
              { id: "owner_address", label: "Owner Address", type: "address", required: true },
              { id: "ownership_percentage", label: "Ownership %", type: "number", required: true, min: 0, max: 100 }
            ]
          },
          {
            id: "processing_info",
            title: "Processing Information",
            fields: [
              { id: "monthly_volume", label: "Monthly Processing Volume", type: "currency", required: true },
              { id: "average_ticket", label: "Average Ticket Size", type: "currency", required: true },
              { id: "business_model", label: "Business Model", type: "textarea", required: true }
            ]
          }
        ]
      },
      requiredFields: ["business_name", "business_type", "tax_id", "business_phone", "business_address", "owner_name", "owner_ssn", "owner_address", "ownership_percentage", "monthly_volume", "average_ticket", "business_model"],
      conditionalFields: {
        "business_type": {
          "Corporation": { show: ["articles_of_incorporation"] },
          "LLC": { show: ["operating_agreement"] }
        }
      }
    });
    
    // Merrick Bank templates
    templateData.push({
      acquirerId: insertedAcquirers[1].id,
      templateName: "Express Application",
      version: "1.0",
      isActive: true,
      fieldConfiguration: {
        sections: [
          {
            id: "basic_info",
            title: "Basic Information",
            fields: [
              { id: "business_name", label: "Business Name", type: "text", required: true },
              { id: "industry", label: "Industry", type: "select", required: true, options: ["Retail", "Restaurant", "E-commerce", "Professional Services", "Other"] },
              { id: "monthly_volume", label: "Monthly Volume", type: "currency", required: true },
              { id: "contact_email", label: "Contact Email", type: "email", required: true }
            ]
          },
          {
            id: "banking_info",
            title: "Banking Information",
            fields: [
              { id: "bank_name", label: "Bank Name", type: "text", required: true },
              { id: "account_number", label: "Account Number", type: "text", required: true, sensitive: true },
              { id: "routing_number", label: "Routing Number", type: "text", required: true, pattern: "^\\d{9}$" }
            ]
          }
        ]
      },
      requiredFields: ["business_name", "industry", "monthly_volume", "contact_email", "bank_name", "account_number", "routing_number"],
      conditionalFields: {}
    });
    
    // Esquire Bank templates
    templateData.push({
      acquirerId: insertedAcquirers[2].id,
      templateName: "Premium Application",
      version: "1.0",
      isActive: true,
      fieldConfiguration: {
        sections: [
          {
            id: "company_profile",
            title: "Company Profile",
            fields: [
              { id: "company_name", label: "Company Name", type: "text", required: true },
              { id: "years_in_business", label: "Years in Business", type: "number", required: true, min: 0 },
              { id: "annual_revenue", label: "Annual Revenue", type: "currency", required: true },
              { id: "employee_count", label: "Number of Employees", type: "number", required: true }
            ]
          },
          {
            id: "processing_details",
            title: "Processing Details", 
            fields: [
              { id: "card_present_percentage", label: "Card Present %", type: "number", required: true, min: 0, max: 100 },
              { id: "internet_percentage", label: "Internet/E-commerce %", type: "number", required: true, min: 0, max: 100 },
              { id: "keyed_percentage", label: "Keyed Entry %", type: "number", required: true, min: 0, max: 100 },
              { id: "seasonal_business", label: "Seasonal Business", type: "checkbox", required: false }
            ]
          }
        ]
      },
      requiredFields: ["company_name", "years_in_business", "annual_revenue", "employee_count", "card_present_percentage", "internet_percentage", "keyed_percentage"],
      conditionalFields: {
        "seasonal_business": {
          "true": { show: ["peak_months", "slow_months"] }
        }
      }
    });
    
    const insertedTemplates = await db.insert(acquirerApplicationTemplates).values(templateData).returning();
    console.log(`✅ Created ${insertedTemplates.length} application templates`);
    
    // Update existing campaigns to reference the first acquirer (Wells Fargo) if they don't have an acquirer_id
    console.log("🔧 Updating existing campaigns with acquirer references...");
    
    try {
      const campaignsToUpdate = await db.select().from(campaigns).where(eq(campaigns.acquirerId, null));
      
      if (campaignsToUpdate.length > 0) {
        await db.update(campaigns)
          .set({ acquirerId: insertedAcquirers[0].id })
          .where(eq(campaigns.acquirerId, null));
        console.log(`✅ Updated ${campaignsToUpdate.length} campaigns with Wells Fargo acquirer reference`);
      }
    } catch (campaignError) {
      console.log("⚠️ Could not update campaigns, acquirerId column might not exist yet");
    }
    
    console.log("✅ Acquirer system seeding completed!");
    console.log("\n📊 Summary:");
    console.log(`   • ${insertedAcquirers.length} acquirers created`);
    console.log(`   • ${insertedTemplates.length} application templates created`);
    console.log("   • Dynamic form system ready for use");
    
  } catch (error) {
    console.error("❌ Error seeding acquirer system:", error);
    throw error;
  }
}

// Run the seeding if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedAcquirerSystem()
    .then(() => {
      console.log("🎉 Seeding completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Seeding failed:", error);
      process.exit(1);
    });
}

export { seedAcquirerSystem };