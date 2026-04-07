#!/usr/bin/env tsx

import { getDynamicDatabase } from "../server/db.js";
import { acquirerApplicationTemplates } from "@shared/schema";
import { eq } from "drizzle-orm";

async function updateApplicationTemplates() {
  console.log("🔄 Updating application templates with real PDF field configurations...");
  
  try {
    const db = getDynamicDatabase("dev");
    
    // Wells Fargo Standard Application Template (keeping as comprehensive baseline)
    const wellsForgoTemplate = {
      sections: [
        {
          id: "merchant_info",
          title: "Merchant Information",
          fields: [
            { id: "legal_business_name", label: "Legal Name of Business / IRS Filing Name (Must Match IRS Record)", type: "text", required: true },
            { id: "dba_name", label: "DBA (Doing Business As)", type: "text", required: false },
            { id: "location_address", label: "Location / Site Address", type: "text", required: true },
            { id: "location_city", label: "City", type: "text", required: true },
            { id: "location_state", label: "State", type: "text", required: true },
            { id: "location_zip", label: "ZIP Code", type: "text", required: true, pattern: "^\\d{5}(-\\d{4})?$" },
            { id: "mailing_address", label: "Mailing Address (if different from location)", type: "text", required: false },
            { id: "mailing_city", label: "Mailing City", type: "text", required: false },
            { id: "mailing_state", label: "Mailing State", type: "text", required: false },
            { id: "mailing_zip", label: "Mailing ZIP", type: "text", required: false },
            { id: "company_phone", label: "Company Phone #", type: "tel", required: true },
            { id: "descriptor_phone", label: "Descriptor Phone # (E-commerce or MOTO)", type: "tel", required: false },
            { id: "mobile_phone", label: "Mobile Phone #", type: "tel", required: false },
            { id: "fax_number", label: "Fax #", type: "tel", required: false },
            { id: "contact_name", label: "Contact Name", type: "text", required: true },
            { id: "contact_title", label: "Title", type: "text", required: true },
            { id: "tax_id", label: "Tax ID", type: "text", required: true, pattern: "^\\d{2}-\\d{7}$" },
            { id: "website_url", label: "Company Website Address (URL)", type: "url", required: false },
            { id: "company_email", label: "Company E-mail Address", type: "email", required: true },
            { id: "business_type", label: "Business Type", type: "select", required: true, options: ["Partnership", "Sole Proprietorship", "Public Corp.", "Private Corp.", "Tax Exempt Corp.", "Limited Liability Company"] },
            { id: "state_filed", label: "State Filed", type: "text", required: false },
            { id: "business_start_date", label: "Business Start Date", type: "date", required: true },
            { id: "terminated_merchant", label: "Has this business been terminated as a Visa/MC/Amex/Discover merchant?", type: "radio", required: true, options: ["Yes", "No"] },
            { id: "terminated_date", label: "Terminated Date", type: "date", required: false, conditional: { field: "terminated_merchant", value: "Yes" } },
            { id: "bankruptcy_filed", label: "Has merchant filed bankruptcy?", type: "radio", required: true, options: ["Yes", "No"] },
            { id: "bankruptcy_date", label: "Bankruptcy Date", type: "date", required: false, conditional: { field: "bankruptcy_filed", value: "Yes" } },
            { id: "currently_accept_cards", label: "Do you currently accept Visa/MC/Amex/Discover?", type: "radio", required: true, options: ["Yes", "No"] },
            { id: "previous_processor", label: "Previous Card Processor", type: "text", required: false, conditional: { field: "currently_accept_cards", value: "Yes" } },
            { id: "reason_to_change", label: "Reason to Change", type: "select", required: false, options: ["Rates", "Service", "Other"], conditional: { field: "currently_accept_cards", value: "Yes" } },
            { id: "merchant_sells", label: "Merchant Sells (specify product, service and/or information)", type: "textarea", required: true },
            { id: "third_party_storage", label: "Do you use any third party to store, process or transmit cardholder's data?", type: "radio", required: true, options: ["Yes", "No"] },
            { id: "third_party_company", label: "Third Party Company Name, Address and Phone", type: "textarea", required: false, conditional: { field: "third_party_storage", value: "Yes" } },
            { id: "refund_policy", label: "Refund Policy", type: "select", required: true, options: ["Refund will be granted to customer", "No refund. All sales final", "Store credit"] }
          ]
        },
        {
          id: "transaction_info",
          title: "Transaction Information",
          fields: [
            { id: "monthly_visa_mc_discover_volume", label: "Average Combined Monthly Visa/MC/Discover Volume", type: "currency", required: true },
            { id: "monthly_amex_volume", label: "Average Combined Monthly American Express Volume", type: "currency", required: true },
            { id: "average_ticket", label: "Average Visa/MC/Amex/Discover Network Ticket", type: "currency", required: true },
            { id: "highest_ticket", label: "Highest Ticket Amount", type: "currency", required: true },
            { id: "seasonal_business", label: "Seasonal Business?", type: "checkbox", required: false },
            { id: "highest_volume_months", label: "Highest Volume Months", type: "checkbox-group", required: false, options: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], conditional: { field: "seasonal_business", value: true } },
            { id: "merchant_type", label: "Merchant Type", type: "select", required: true, options: ["Retail Outlet", "Restaurant/Food", "Lodging", "Home Business, Trade Fairs", "Outside Sales/Service, Other, Etc.", "Mail/Telephone Order Only", "Internet", "Health Care"] },
            { id: "swiped_percentage", label: "Swiped Credit Cards %", type: "number", required: true, min: 0, max: 100 },
            { id: "keyed_percentage", label: "Keyed Credit Cards %", type: "number", required: true, min: 0, max: 100 },
            { id: "moto_percentage", label: "MO/TO %", type: "number", required: false, min: 0, max: 100 },
            { id: "internet_percentage", label: "Internet %", type: "number", required: false, min: 0, max: 100 },
            { id: "merchant_receives_imprint", label: "Merchant receives imprint on keyed transactions", type: "radio", required: false, options: ["Yes", "No"] }
          ]
        },
        {
          id: "moto_business_info",
          title: "Mail/Telephone Order/Business to Business Information",
          fields: [
            { id: "b2b_total_sales_percentage", label: "% of total sales represent business to business", type: "number", required: false, min: 0, max: 100 },
            { id: "b2c_total_sales_percentage", label: "% of total sales represent business to consumer", type: "number", required: false, min: 0, max: 100 },
            { id: "b2b_card_sales_percentage", label: "% of credit/debit card sales represent business to business", type: "number", required: false, min: 0, max: 100 },
            { id: "b2c_card_sales_percentage", label: "% of credit/debit card sales represent business to consumer", type: "number", required: false, min: 0, max: 100 },
            { id: "delivery_0_7_days", label: "% of orders delivered in 0-7 days", type: "number", required: false, min: 0, max: 100 },
            { id: "delivery_8_14_days", label: "% of orders delivered in 8-14 days", type: "number", required: false, min: 0, max: 100 },
            { id: "delivery_15_30_days", label: "% of orders delivered in 15-30 days", type: "number", required: false, min: 0, max: 100 },
            { id: "delivery_over_30_days", label: "% of orders delivered over 30 days", type: "number", required: false, min: 0, max: 100 },
            { id: "fulfillment_company", label: "Who performs product/service fulfillment?", type: "text", required: false },
            { id: "sales_deposited_on", label: "Sales are deposited on", type: "select", required: false, options: ["Date of Order", "Date of Delivery", "Other"] },
            { id: "own_product", label: "Do you own the product/inventory?", type: "radio", required: false, options: ["Yes", "No"] },
            { id: "product_stored_location", label: "Is the product stored at your business location?", type: "radio", required: false, options: ["Yes", "No"] },
            { id: "product_storage_location", label: "If no, where is it stored?", type: "text", required: false, conditional: { field: "product_stored_location", value: "No" } },
            { id: "product_shipped_by", label: "Product shipped by", type: "select", required: false, options: ["US Mail", "Other"] },
            { id: "delivery_receipt_requested", label: "Delivery receipt requested", type: "radio", required: false, options: ["Yes", "No"] },
            { id: "advertising_methods", label: "Advertising Method(s)", type: "checkbox-group", required: false, options: ["Newspapers", "Internet", "Magazine", "Radio", "Yellow Pages", "TV", "Other"] },
            { id: "telephone_orders_percentage", label: "% of products sold via telephone orders", type: "number", required: false, min: 0, max: 100 },
            { id: "mail_fax_orders_percentage", label: "% of products sold via mail/fax orders", type: "number", required: false, min: 0, max: 100 },
            { id: "internet_orders_percentage", label: "% of products sold via internet orders", type: "number", required: false, min: 0, max: 100 },
            { id: "other_orders_percentage", label: "% of products sold via other methods", type: "number", required: false, min: 0, max: 100 }
          ]
        },
        {
          id: "banking_info",
          title: "Credit/Debit Authorization",
          fields: [
            { id: "bank_name", label: "Bank Name", type: "text", required: true },
            { id: "bank_routing_number", label: "Bank Routing #", type: "text", required: true, pattern: "^\\d{9}$" },
            { id: "bank_account_number", label: "Bank Account #", type: "text", required: true, sensitive: true },
            { id: "voided_check_attached", label: "Voided check attached", type: "checkbox", required: true }
          ]
        },
        {
          id: "ownership_info",
          title: "Ownership Information",
          fields: [
            { id: "principal_1_name", label: "Principal 1 - Name (First, MI, Last)", type: "text", required: true },
            { id: "principal_1_title", label: "Principal 1 - Title", type: "text", required: true },
            { id: "principal_1_ownership", label: "Principal 1 - Ownership %", type: "number", required: true, min: 0, max: 100 },
            { id: "principal_1_dob", label: "Principal 1 - Date of Birth", type: "date", required: true },
            { id: "principal_1_home_address", label: "Principal 1 - Home Address", type: "text", required: true },
            { id: "principal_1_city", label: "Principal 1 - City", type: "text", required: true },
            { id: "principal_1_state", label: "Principal 1 - State", type: "text", required: true },
            { id: "principal_1_zip", label: "Principal 1 - ZIP Code", type: "text", required: true },
            { id: "principal_1_home_phone", label: "Principal 1 - Home Phone", type: "tel", required: true },
            { id: "principal_1_ssn", label: "Principal 1 - Social Security Number", type: "text", required: true, pattern: "^\\d{3}-\\d{2}-\\d{4}$", sensitive: true },
            { id: "principal_1_dl_number", label: "Principal 1 - Driver License #", type: "text", required: true },
            { id: "principal_1_dl_state_exp", label: "Principal 1 - DL State/Exp Date", type: "text", required: true },
            { id: "principal_1_email", label: "Principal 1 - Email", type: "email", required: true },
            { id: "principal_1_residence_type", label: "Principal 1 - Personal Residence", type: "select", required: true, options: ["Own", "Rent"] },
            { id: "principal_1_residence_years", label: "Principal 1 - For how long? (Years)", type: "number", required: true, min: 0 },
            { id: "principal_1_residence_months", label: "Principal 1 - For how long? (Months)", type: "number", required: true, min: 0, max: 11 }
          ]
        }
      ]
    };
    
    // Merrick Bank Express Application Template (streamlined)
    const merrickBankTemplate = {
      sections: [
        {
          id: "merchant_info",
          title: "Merchant Information",
          fields: [
            { id: "legal_business_name", label: "Legal Name of Business / IRS Filing Name", type: "text", required: true },
            { id: "dba_name", label: "DBA (Doing Business As)", type: "text", required: false },
            { id: "location_address", label: "Location / Site Address", type: "text", required: true },
            { id: "location_city", label: "City", type: "text", required: true },
            { id: "location_state", label: "State", type: "text", required: true },
            { id: "location_zip", label: "ZIP Code", type: "text", required: true },
            { id: "company_phone", label: "Company Phone #", type: "tel", required: true },
            { id: "contact_name", label: "Contact Name", type: "text", required: true },
            { id: "contact_title", label: "Title", type: "text", required: true },
            { id: "tax_id", label: "Tax ID", type: "text", required: true },
            { id: "website_url", label: "Company Website Address", type: "url", required: false },
            { id: "company_email", label: "Company E-mail Address", type: "email", required: true },
            { id: "business_type", label: "Business Type", type: "select", required: true, options: ["Partnership", "Sole Proprietorship", "Public Corp.", "Private Corp.", "Tax Exempt Corp.", "Limited Liability Company"] },
            { id: "business_start_date", label: "Business Start Date", type: "date", required: true },
            { id: "merchant_sells", label: "Merchant Sells", type: "textarea", required: true }
          ]
        },
        {
          id: "transaction_info",
          title: "Transaction Information", 
          fields: [
            { id: "monthly_visa_mc_discover_volume", label: "Average Monthly Visa/MC/Discover Volume", type: "currency", required: true },
            { id: "monthly_amex_volume", label: "Average Monthly American Express Volume", type: "currency", required: true },
            { id: "average_ticket", label: "Average Network Ticket", type: "currency", required: true },
            { id: "highest_ticket", label: "Highest Ticket Amount", type: "currency", required: true },
            { id: "merchant_type", label: "Merchant Type", type: "select", required: true, options: ["Retail Outlet", "Restaurant/Food", "Lodging", "Internet", "Mail/Telephone Order"] },
            { id: "swiped_percentage", label: "Swiped Credit Cards %", type: "number", required: true, min: 0, max: 100 },
            { id: "keyed_percentage", label: "Keyed Credit Cards %", type: "number", required: true, min: 0, max: 100 }
          ]
        },
        {
          id: "banking_info",
          title: "Banking Information",
          fields: [
            { id: "bank_name", label: "Bank Name", type: "text", required: true },
            { id: "bank_routing_number", label: "Bank Routing #", type: "text", required: true, pattern: "^\\d{9}$" },
            { id: "bank_account_number", label: "Bank Account #", type: "text", required: true, sensitive: true }
          ]
        },
        {
          id: "ownership_info",
          title: "Principal Information",
          fields: [
            { id: "principal_name", label: "Principal Name", type: "text", required: true },
            { id: "principal_title", label: "Title", type: "text", required: true },
            { id: "principal_ownership", label: "Ownership %", type: "number", required: true, min: 0, max: 100 },
            { id: "principal_dob", label: "Date of Birth", type: "date", required: true },
            { id: "principal_ssn", label: "Social Security Number", type: "text", required: true, sensitive: true },
            { id: "principal_address", label: "Home Address", type: "text", required: true },
            { id: "principal_phone", label: "Home Phone", type: "tel", required: true }
          ]
        }
      ]
    };
    
    // Esquire Bank Premium Application Template (comprehensive)
    const esquireBankTemplate = {
      sections: [
        {
          id: "merchant_info",
          title: "Merchant Information",
          fields: [
            { id: "legal_business_name", label: "Legal Name of Business / IRS Filing Name", type: "text", required: true },
            { id: "dba_name", label: "DBA (Doing Business As)", type: "text", required: false },
            { id: "location_address", label: "Location / Site Address", type: "text", required: true },
            { id: "location_city", label: "City", type: "text", required: true },
            { id: "location_state", label: "State", type: "text", required: true },
            { id: "location_zip", label: "ZIP Code", type: "text", required: true },
            { id: "mailing_address", label: "Mailing Address (if different)", type: "text", required: false },
            { id: "company_phone", label: "Company Phone #", type: "tel", required: true },
            { id: "descriptor_phone", label: "Descriptor Phone # (E-commerce or MOTO)", type: "tel", required: false },
            { id: "mobile_phone", label: "Mobile Phone #", type: "tel", required: false },
            { id: "fax_number", label: "Fax #", type: "tel", required: false },
            { id: "contact_name", label: "Contact Name", type: "text", required: true },
            { id: "contact_title", label: "Title", type: "text", required: true },
            { id: "tax_id", label: "Tax ID", type: "text", required: true },
            { id: "website_url", label: "Company Website Address", type: "url", required: false },
            { id: "company_email", label: "Company E-mail Address", type: "email", required: true },
            { id: "business_type", label: "Business Type", type: "select", required: true, options: ["Partnership", "Sole Proprietorship", "Public Corp.", "Private Corp.", "Tax Exempt Corp.", "Limited Liability Company"] },
            { id: "state_filed", label: "State Filed", type: "text", required: false },
            { id: "business_start_date", label: "Business Start Date", type: "date", required: true },
            { id: "terminated_merchant", label: "Has this business been terminated as a merchant?", type: "radio", required: true, options: ["Yes", "No"] },
            { id: "bankruptcy_filed", label: "Has merchant filed bankruptcy?", type: "radio", required: true, options: ["Yes", "No"] },
            { id: "currently_accept_cards", label: "Do you currently accept cards?", type: "radio", required: true, options: ["Yes", "No"] },
            { id: "merchant_sells", label: "Merchant Sells", type: "textarea", required: true },
            { id: "third_party_storage", label: "Third party data storage?", type: "radio", required: true, options: ["Yes", "No"] },
            { id: "refund_policy", label: "Refund Policy", type: "select", required: true, options: ["Refund will be granted", "No refund - all sales final", "Store credit"] }
          ]
        },
        {
          id: "transaction_info",
          title: "Transaction Information",
          fields: [
            { id: "monthly_visa_mc_discover_volume", label: "Average Monthly Visa/MC/Discover Volume", type: "currency", required: true },
            { id: "monthly_amex_volume", label: "Average Monthly American Express Volume", type: "currency", required: true },
            { id: "average_ticket", label: "Average Network Ticket", type: "currency", required: true },
            { id: "highest_ticket", label: "Highest Ticket Amount", type: "currency", required: true },
            { id: "seasonal_business", label: "Seasonal Business?", type: "checkbox", required: false },
            { id: "merchant_type", label: "Merchant Type", type: "select", required: true, options: ["Retail Outlet", "Restaurant/Food", "Lodging", "Home Business", "Outside Sales/Service", "Mail/Telephone Order Only", "Internet", "Health Care"] },
            { id: "swiped_percentage", label: "Swiped Credit Cards %", type: "number", required: true, min: 0, max: 100 },
            { id: "keyed_percentage", label: "Keyed Credit Cards %", type: "number", required: true, min: 0, max: 100 },
            { id: "moto_percentage", label: "MO/TO %", type: "number", required: false, min: 0, max: 100 },
            { id: "internet_percentage", label: "Internet %", type: "number", required: false, min: 0, max: 100 }
          ]
        },
        {
          id: "site_inspection",
          title: "Site Inspection & Business Info",
          fields: [
            { id: "zone_type", label: "Zone", type: "select", required: true, options: ["Commercial", "Industrial", "Residential"] },
            { id: "square_footage", label: "Approximate Size (Square Footage)", type: "select", required: true, options: ["0-500 SqFt", "501-2000 SqFt", "2001+ SqFt"] },
            { id: "merchant_location_type", label: "Merchant Location", type: "select", required: true, options: ["Shopping Center", "Office Building", "Separate Building", "Residence", "Mobile", "Other"] },
            { id: "property_ownership", label: "The merchant", type: "select", required: true, options: ["Owns", "Rents", "Leases"] },
            { id: "landlord_name", label: "Landlord Name", type: "text", required: false, conditional: { field: "property_ownership", value: "Rents" } },
            { id: "landlord_phone", label: "Landlord Phone", type: "tel", required: false, conditional: { field: "property_ownership", value: "Rents" } }
          ]
        },
        {
          id: "banking_info",
          title: "Credit/Debit Authorization",
          fields: [
            { id: "bank_name", label: "Bank Name", type: "text", required: true },
            { id: "bank_routing_number", label: "Bank Routing #", type: "text", required: true, pattern: "^\\d{9}$" },
            { id: "bank_account_number", label: "Bank Account #", type: "text", required: true, sensitive: true }
          ]
        },
        {
          id: "equipment_info",
          title: "Equipment Information",
          fields: [
            { id: "payment_gateway", label: "Payment Gateway", type: "text", required: false },
            { id: "software_application", label: "Software Application", type: "text", required: false },
            { id: "software_version", label: "Version #", type: "text", required: false },
            { id: "terminal_model", label: "Terminal Model", type: "text", required: false },
            { id: "third_party_processor", label: "3rd Party Processor", type: "text", required: false }
          ]
        },
        {
          id: "ownership_info",
          title: "Ownership Information",
          fields: [
            { id: "principal_1_name", label: "Principal 1 - Name", type: "text", required: true },
            { id: "principal_1_title", label: "Principal 1 - Title", type: "text", required: true },
            { id: "principal_1_ownership", label: "Principal 1 - Ownership %", type: "number", required: true, min: 0, max: 100 },
            { id: "principal_1_dob", label: "Principal 1 - Date of Birth", type: "date", required: true },
            { id: "principal_1_home_address", label: "Principal 1 - Home Address", type: "text", required: true },
            { id: "principal_1_ssn", label: "Principal 1 - Social Security Number", type: "text", required: true, sensitive: true },
            { id: "principal_1_dl_number", label: "Principal 1 - Driver License #", type: "text", required: true },
            { id: "principal_1_email", label: "Principal 1 - Email", type: "email", required: true },
            { id: "principal_1_residence_type", label: "Principal 1 - Residence", type: "select", required: true, options: ["Own", "Rent"] }
          ]
        }
      ]
    };
    
    // Update Wells Fargo template (acquirer_id = 1)
    await db.update(acquirerApplicationTemplates)
      .set({
        fieldConfiguration: wellsForgoTemplate,
        requiredFields: [
          "legal_business_name", "location_address", "location_city", "location_state", "location_zip",
          "company_phone", "contact_name", "contact_title", "tax_id", "company_email", "business_type",
          "business_start_date", "terminated_merchant", "bankruptcy_filed", "currently_accept_cards",
          "merchant_sells", "third_party_storage", "refund_policy", "monthly_visa_mc_discover_volume",
          "monthly_amex_volume", "average_ticket", "highest_ticket", "merchant_type", "swiped_percentage",
          "keyed_percentage", "bank_name", "bank_routing_number", "bank_account_number", "voided_check_attached",
          "principal_1_name", "principal_1_title", "principal_1_ownership", "principal_1_dob",
          "principal_1_home_address", "principal_1_city", "principal_1_state", "principal_1_zip",
          "principal_1_home_phone", "principal_1_ssn", "principal_1_dl_number", "principal_1_dl_state_exp",
          "principal_1_email", "principal_1_residence_type", "principal_1_residence_years", "principal_1_residence_months"
        ],
        updatedAt: new Date()
      })
      .where(eq(acquirerApplicationTemplates.acquirerId, 1));
    
    // Update Merrick Bank template (acquirer_id = 2)
    await db.update(acquirerApplicationTemplates)
      .set({
        fieldConfiguration: merrickBankTemplate,
        requiredFields: [
          "legal_business_name", "location_address", "location_city", "location_state", "location_zip",
          "company_phone", "contact_name", "contact_title", "tax_id", "company_email", "business_type",
          "business_start_date", "merchant_sells", "monthly_visa_mc_discover_volume", "monthly_amex_volume",
          "average_ticket", "highest_ticket", "merchant_type", "swiped_percentage", "keyed_percentage",
          "bank_name", "bank_routing_number", "bank_account_number", "principal_name", "principal_title",
          "principal_ownership", "principal_dob", "principal_ssn", "principal_address", "principal_phone"
        ],
        updatedAt: new Date()
      })
      .where(eq(acquirerApplicationTemplates.acquirerId, 2));
    
    // Update Esquire Bank template (acquirer_id = 3)
    await db.update(acquirerApplicationTemplates)
      .set({
        fieldConfiguration: esquireBankTemplate,
        requiredFields: [
          "legal_business_name", "location_address", "location_city", "location_state", "location_zip",
          "company_phone", "contact_name", "contact_title", "tax_id", "company_email", "business_type",
          "business_start_date", "terminated_merchant", "bankruptcy_filed", "currently_accept_cards",
          "merchant_sells", "third_party_storage", "refund_policy", "monthly_visa_mc_discover_volume",
          "monthly_amex_volume", "average_ticket", "highest_ticket", "merchant_type", "swiped_percentage",
          "keyed_percentage", "zone_type", "square_footage", "merchant_location_type", "property_ownership",
          "bank_name", "bank_routing_number", "bank_account_number", "principal_1_name", "principal_1_title",
          "principal_1_ownership", "principal_1_dob", "principal_1_home_address", "principal_1_ssn",
          "principal_1_dl_number", "principal_1_email", "principal_1_residence_type"
        ],
        updatedAt: new Date()
      })
      .where(eq(acquirerApplicationTemplates.acquirerId, 3));
    
    console.log("✅ Successfully updated all application templates with real PDF field configurations!");
    console.log("\n📋 Updated Templates:");
    console.log("   • Wells Fargo: Comprehensive 75+ field form");
    console.log("   • Merrick Bank: Streamlined express application");
    console.log("   • Esquire Bank: Premium application with site inspection");
    console.log("\n🔧 Key Features Added:");
    console.log("   • Conditional field logic");
    console.log("   • Field validation patterns");
    console.log("   • Sensitive data marking");
    console.log("   • Proper field types and constraints");
    
  } catch (error) {
    console.error("❌ Error updating application templates:", error);
    throw error;
  }
}

// Run the update if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateApplicationTemplates()
    .then(() => {
      console.log("🎉 Template update completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Template update failed:", error);
      process.exit(1);
    });
}

export { updateApplicationTemplates };