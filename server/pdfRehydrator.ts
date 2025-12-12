import { PDFDocument, PDFForm, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, rgb } from 'pdf-lib';
import { objectStorageService, objectStorageClient } from './objectStorage';
import { ObjectAccessGroupType, ObjectPermission, setObjectAclPolicy, ObjectAclPolicy } from './objectAcl';

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");
  return { bucketName, objectName };
}

interface FieldMapping {
  fieldId: string;
  pdfFieldName: string;
  pdfFieldIds?: string[];
  extractionMethod?: string;
}

interface SectionMapping {
  sectionId: string;
  fieldMappings: FieldMapping[];
}

interface PdfMappingConfiguration {
  originalFileName: string;
  uploadedAt: string;
  totalFields: number;
  sectionsMapping: SectionMapping[];
}

interface SignatureGroup {
  roleKey: string;
  displayLabel: string;
  signerType: string;
  isRequired: boolean;
  orderPriority: number;
  sectionName: string;
  fieldMappings: {
    signerName?: string;
    signature?: string;
    initials?: string;
    email?: string;
    dateSigned?: string;
  };
  pdfMappings?: {
    signature?: { page: number; x: number; y: number; width: number; height: number };
    printedName?: { page: number; x: number; y: number; width: number; height: number };
    initials?: { page: number; x: number; y: number; width: number; height: number };
    email?: { page: number; x: number; y: number; width: number; height: number };
    dateSigned?: { page: number; x: number; y: number; width: number; height: number };
  };
}

export class PDFRehydrator {
  constructor() {}

  async rehydratePdf(
    sourcePdfPath: string,
    applicationData: Record<string, any>,
    pdfMappingConfiguration: PdfMappingConfiguration,
    signatureGroups?: SignatureGroup[]
  ): Promise<Buffer> {
    console.log(`[PDFRehydrator] Starting PDF rehydration from: ${sourcePdfPath}`);

    const pdfBuffer = await this.loadSourcePdf(sourcePdfPath);
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    console.log(`[PDFRehydrator] Loaded PDF with ${fields.length} form fields`);

    const allFieldMappings = pdfMappingConfiguration.sectionsMapping.flatMap(
      section => section.fieldMappings
    );

    let filledCount = 0;

    for (const mapping of allFieldMappings) {
      const value = this.getNestedValue(applicationData, mapping.fieldId);
      
      if (value !== undefined && value !== null && value !== '') {
        const pdfFieldNames = mapping.pdfFieldIds || [mapping.pdfFieldName];
        
        for (const pdfFieldName of pdfFieldNames) {
          try {
            const filled = this.fillField(form, pdfFieldName, value);
            if (filled) {
              filledCount++;
              console.log(`[PDFRehydrator] Filled field: ${pdfFieldName} = ${this.truncateValue(value)}`);
            }
          } catch (err) {
            console.warn(`[PDFRehydrator] Could not fill field ${pdfFieldName}:`, err);
          }
        }
      }
    }

    if (signatureGroups && signatureGroups.length > 0) {
      await this.embedSignatures(pdfDoc, form, applicationData, signatureGroups);
    }

    console.log(`[PDFRehydrator] Filled ${filledCount} fields successfully`);

    form.flatten();
    console.log('[PDFRehydrator] Flattened form (locked from editing)');

    const filledPdfBytes = await pdfDoc.save();
    return Buffer.from(filledPdfBytes);
  }

  private async loadSourcePdf(sourcePdfPath: string): Promise<Buffer> {
    const { bucketName, objectName } = parseObjectPath(sourcePdfPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);

    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Source PDF not found at path: ${sourcePdfPath}`);
    }

    const [buffer] = await file.download();
    console.log(`[PDFRehydrator] Downloaded source PDF: ${buffer.length} bytes`);
    return buffer;
  }

  private fillField(form: PDFForm, fieldName: string, value: any): boolean {
    try {
      const field = form.getField(fieldName);
      
      if (!field) {
        console.warn(`[PDFRehydrator] Field not found: ${fieldName}`);
        return false;
      }

      const fieldType = field.constructor.name;

      switch (fieldType) {
        case 'PDFTextField':
          const textField = field as PDFTextField;
          textField.setText(String(value));
          return true;

        case 'PDFCheckBox':
          const checkbox = field as PDFCheckBox;
          if (value === true || value === 'true' || value === 'yes' || value === 'on' || value === '1') {
            checkbox.check();
          } else {
            checkbox.uncheck();
          }
          return true;

        case 'PDFRadioGroup':
          const radioGroup = field as PDFRadioGroup;
          const options = radioGroup.getOptions();
          const matchingOption = options.find(opt => 
            opt.toLowerCase() === String(value).toLowerCase() ||
            opt.replace(/\s+/g, '_').toLowerCase() === String(value).toLowerCase()
          );
          if (matchingOption) {
            radioGroup.select(matchingOption);
            return true;
          }
          console.warn(`[PDFRehydrator] No matching radio option for value: ${value}`);
          return false;

        case 'PDFDropdown':
          const dropdown = field as PDFDropdown;
          const dropdownOptions = dropdown.getOptions();
          const matchingDropdownOption = dropdownOptions.find(opt =>
            opt.toLowerCase() === String(value).toLowerCase()
          );
          if (matchingDropdownOption) {
            dropdown.select(matchingDropdownOption);
            return true;
          }
          dropdown.select(String(value));
          return true;

        default:
          console.warn(`[PDFRehydrator] Unsupported field type: ${fieldType} for field: ${fieldName}`);
          return false;
      }
    } catch (err) {
      console.error(`[PDFRehydrator] Error filling field ${fieldName}:`, err);
      return false;
    }
  }

  private async embedSignatures(
    pdfDoc: PDFDocument,
    form: PDFForm,
    applicationData: Record<string, any>,
    signatureGroups: SignatureGroup[]
  ): Promise<void> {
    console.log(`[PDFRehydrator] Embedding ${signatureGroups.length} signature groups`);

    for (const sigGroup of signatureGroups) {
      const signerNameField = sigGroup.fieldMappings.signerName;
      const signatureField = sigGroup.fieldMappings.signature;
      const dateSignedField = sigGroup.fieldMappings.dateSigned;

      if (signerNameField) {
        const signerName = this.getNestedValue(applicationData, signerNameField);
        if (signerName) {
          const pdfMapping = sigGroup.pdfMappings?.printedName;
          if (pdfMapping) {
            const page = pdfDoc.getPage(pdfMapping.page - 1);
            page.drawText(String(signerName), {
              x: pdfMapping.x,
              y: page.getHeight() - pdfMapping.y - 12,
              size: 12,
              color: rgb(0, 0, 0),
            });
            console.log(`[PDFRehydrator] Embedded signer name for ${sigGroup.roleKey}`);
          }
        }
      }

      if (signatureField) {
        const signatureData = this.getNestedValue(applicationData, signatureField);
        if (signatureData && typeof signatureData === 'string' && signatureData.startsWith('data:image')) {
          const pdfMapping = sigGroup.pdfMappings?.signature;
          if (pdfMapping) {
            try {
              const base64Data = signatureData.split(',')[1];
              const imageBytes = Buffer.from(base64Data, 'base64');
              const pngImage = await pdfDoc.embedPng(imageBytes);
              const page = pdfDoc.getPage(pdfMapping.page - 1);
              
              page.drawImage(pngImage, {
                x: pdfMapping.x,
                y: page.getHeight() - pdfMapping.y - pdfMapping.height,
                width: pdfMapping.width,
                height: pdfMapping.height,
              });
              console.log(`[PDFRehydrator] Embedded signature image for ${sigGroup.roleKey}`);
            } catch (err) {
              console.error(`[PDFRehydrator] Failed to embed signature for ${sigGroup.roleKey}:`, err);
            }
          }
        }
      }

      if (dateSignedField) {
        const dateSigned = this.getNestedValue(applicationData, dateSignedField);
        if (dateSigned) {
          const pdfMapping = sigGroup.pdfMappings?.dateSigned;
          if (pdfMapping) {
            const page = pdfDoc.getPage(pdfMapping.page - 1);
            const dateStr = new Date(dateSigned).toLocaleDateString('en-US');
            page.drawText(dateStr, {
              x: pdfMapping.x,
              y: page.getHeight() - pdfMapping.y - 12,
              size: 10,
              color: rgb(0, 0, 0),
            });
            console.log(`[PDFRehydrator] Embedded date signed for ${sigGroup.roleKey}`);
          }
        }
      }
    }
  }

  private getNestedValue(obj: Record<string, any>, path: string): any {
    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  private truncateValue(value: any): string {
    const str = String(value);
    if (str.length > 50) {
      return str.substring(0, 47) + '...';
    }
    return str;
  }

  async saveRehydratedPdf(
    pdfBuffer: Buffer,
    prospectId: number,
    applicationId: number,
    ownerId?: string,
    agentUserId?: string
  ): Promise<string> {
    const storageKey = `applications/prospect_${prospectId}/application_${applicationId}/completed_application_${Date.now()}.pdf`;

    console.log(`[PDFRehydrator] Saving rehydrated PDF to: ${storageKey}`);

    await objectStorageService.saveBuffer(storageKey, pdfBuffer, {
      contentType: 'application/pdf',
      ownerId: ownerId,
      visibility: 'custom',
    });

    const { bucketName, objectName } = parseObjectPath(
      `${process.env.PRIVATE_OBJECT_DIR}/${storageKey}`
    );
    const file = objectStorageClient.bucket(bucketName).file(objectName);

    const aclPolicy: ObjectAclPolicy = {
      owner: ownerId || 'system',
      visibility: 'private',
      aclRules: [
        {
          group: { type: ObjectAccessGroupType.PROSPECT_OWNER, id: ownerId || '' },
          permission: ObjectPermission.READ,
        },
      ],
    };

    if (agentUserId) {
      aclPolicy.aclRules?.push({
        group: { type: ObjectAccessGroupType.ASSIGNED_AGENT, id: agentUserId },
        permission: ObjectPermission.READ,
      });
    }

    aclPolicy.aclRules?.push({
      group: { type: ObjectAccessGroupType.ADMIN, id: '*' },
      permission: ObjectPermission.READ,
    });

    await setObjectAclPolicy(file, aclPolicy);
    console.log(`[PDFRehydrator] Set ACL policy for prospect owner and agent access`);

    return storageKey;
  }
}

export const pdfRehydrator = new PDFRehydrator();
