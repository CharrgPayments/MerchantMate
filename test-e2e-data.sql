-- Create test prospect
INSERT INTO merchant_prospects (first_name, last_name, email, agent_id, status) 
VALUES ('John', 'TestUser', 'test@e2ecompany.com', 1, 'pending')
ON CONFLICT (email) DO NOTHING;

-- Create test application template for Wells Fargo
INSERT INTO acquirer_application_templates (
  acquirer_id, 
  template_name, 
  version, 
  is_active,
  field_configuration,
  pdf_mapping_configuration,
  required_fields,
  conditional_fields
) VALUES (
  1, -- Wells Fargo ID
  'Basic Business Application',
  '1.0',
  true,
  '[{"id":"business_name","type":"text","label":"Business Name","required":true},{"id":"contact_email","type":"email","label":"Contact Email","required":true},{"id":"phone","type":"tel","label":"Phone Number","required":true},{"id":"annual_revenue","type":"number","label":"Annual Revenue","required":true}]',
  '{"business_name":"Company Name","contact_email":"Email Address","phone":"Phone Number","annual_revenue":"Revenue"}',
  '["business_name","contact_email","phone","annual_revenue"]',
  '[]'
) ON CONFLICT DO NOTHING;