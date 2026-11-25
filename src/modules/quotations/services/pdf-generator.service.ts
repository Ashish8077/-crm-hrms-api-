import { Injectable, Logger } from '@nestjs/common';
import type {
  ContentTable,
  TDocumentDefinitions,
  TableCell,
} from 'pdfmake/interfaces';
import { QuotationDocument } from '../schemas/quotation.schema';
import { QuotationLean } from '../repositories/quotation.repository';
import {
  fromMinorUnits,
  unscaleQuantity,
} from '../constants/quotation-financial.constant';

export interface PdfQuotationItemInput {
  name?: string;
  description?: string;
  sku?: string;
  quantityScaled?: number;
  unitPriceMinor?: number;
  discountMinor?: number;
  discountAmountMinor?: number;
  taxBasisPoints?: number;
  taxRateBps?: number;
  lineGrandTotalMinor?: number;
  totalMinor?: number;
}

export interface PdfQuotationInput {
  quoteNumber?: string;
  revisionNumber?: number;
  status?: string;
  title?: string | null;
  currency?: string;
  items: PdfQuotationItemInput[];
  subtotalMinor?: number;
  totalDiscountMinor?: number;
  taxableAmountMinor?: number;
  cgstAmountMinor?: number;
  cgstMinor?: number;
  sgstAmountMinor?: number;
  sgstMinor?: number;
  igstAmountMinor?: number;
  igstMinor?: number;
  totalTaxAmountMinor?: number;
  totalTaxMinor?: number;
  grandTotalMinor?: number;
  totalAmountMinor?: number;
  expiryDate?: Date | string | null;
  validUntil?: Date | string | null;
  createdAt?: Date | string | null;
  termsAndConditions?: string | null;
  notes?: string | null;
}

interface PdfMakeModule {
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  setLocalAccessPolicy(callback: (path: string) => boolean): void;
  fonts: Record<string, Record<string, string>>;
  createPdf(documentDefinitions: TDocumentDefinitions): {
    getBuffer(): Promise<Buffer>;
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfmake = require('pdfmake') as PdfMakeModule;

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);

  constructor() {
    // Configure standard PDFKit fonts without requiring external TTF files
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy(() => true);
    pdfmake.fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    };
  }

  async generatePdfBuffer(
    quotation: QuotationDocument | QuotationLean | PdfQuotationInput,
    companyName: string = 'Enterprise CRM',
  ): Promise<Buffer> {
    const q = quotation as PdfQuotationInput;
    const currency = q.currency || 'INR';

    const itemsTableBody: TableCell[][] = [
      [
        { text: '#', style: 'tableHeader', alignment: 'center' },
        { text: 'Description', style: 'tableHeader' },
        { text: 'Qty', style: 'tableHeader', alignment: 'right' },
        {
          text: `Unit Price (${currency})`,
          style: 'tableHeader',
          alignment: 'right',
        },
        { text: 'Discount', style: 'tableHeader', alignment: 'right' },
        { text: 'Tax Rate', style: 'tableHeader', alignment: 'right' },
        {
          text: `Total (${currency})`,
          style: 'tableHeader',
          alignment: 'right',
        },
      ],
    ];

    q.items.forEach((item, idx: number) => {
      const qtyStr = unscaleQuantity(item.quantityScaled ?? 1000).toString();
      const unitPriceStr = fromMinorUnits(
        item.unitPriceMinor ?? 0,
        currency,
      ).toString();
      const discountMinor = item.discountMinor ?? item.discountAmountMinor ?? 0;
      const discountStr = fromMinorUnits(discountMinor, currency).toString();
      const taxBps = item.taxBasisPoints ?? item.taxRateBps ?? 0;
      const taxRateStr = `${(taxBps / 100).toFixed(2)}%`;
      const lineTotalMinor = item.lineGrandTotalMinor ?? item.totalMinor ?? 0;
      const lineTotalStr = fromMinorUnits(lineTotalMinor, currency).toString();

      itemsTableBody.push([
        { text: (idx + 1).toString(), style: 'tableRow', alignment: 'center' },
        {
          stack: [
            { text: item.name || item.description || 'Item', bold: true },
            ...(item.sku
              ? [{ text: `SKU: ${item.sku}`, fontSize: 8, color: '#666666' }]
              : []),
          ],
          style: 'tableRow',
        },
        { text: qtyStr, style: 'tableRow', alignment: 'right' },
        { text: unitPriceStr, style: 'tableRow', alignment: 'right' },
        { text: discountStr, style: 'tableRow', alignment: 'right' },
        { text: taxRateStr, style: 'tableRow', alignment: 'right' },
        { text: lineTotalStr, style: 'tableRow', alignment: 'right' },
      ]);
    });

    const cgstMinor = q.cgstAmountMinor ?? q.cgstMinor ?? 0;
    const sgstMinor = q.sgstAmountMinor ?? q.sgstMinor ?? 0;
    const igstMinor = q.igstAmountMinor ?? q.igstMinor ?? 0;
    const totalTaxMinor = q.totalTaxAmountMinor ?? q.totalTaxMinor ?? 0;
    const grandTotalMinor = q.grandTotalMinor ?? q.totalAmountMinor ?? 0;

    const subtotalStr = fromMinorUnits(q.subtotalMinor ?? 0, currency);
    const discountStr = fromMinorUnits(q.totalDiscountMinor ?? 0, currency);
    const taxableStr = fromMinorUnits(q.taxableAmountMinor ?? 0, currency);
    const cgstStr = fromMinorUnits(cgstMinor, currency);
    const sgstStr = fromMinorUnits(sgstMinor, currency);
    const igstStr = fromMinorUnits(igstMinor, currency);
    const totalTaxStr = fromMinorUnits(totalTaxMinor, currency);
    const grandTotalStr = fromMinorUnits(grandTotalMinor, currency);

    const expiryDate = q.expiryDate || q.validUntil;
    const validUntilStr = expiryDate
      ? new Date(expiryDate).toISOString().split('T')[0]
      : 'N/A';

    const docDefinition: TDocumentDefinitions = {
      defaultStyle: {
        font: 'Helvetica',
        fontSize: 10,
        color: '#1a1a1a',
      },
      pageMargins: [40, 40, 40, 50],
      header: () => {
        return {
          columns: [
            {
              text: companyName,
              fontSize: 8,
              color: '#888888',
              margin: [40, 15, 0, 0],
            },
            {
              text: `Quotation #${q.quoteNumber ?? ''} (Rev ${q.revisionNumber ?? 1})`,
              fontSize: 8,
              color: '#888888',
              alignment: 'right',
              margin: [0, 15, 40, 0],
            },
          ],
        };
      },
      footer: (currentPage: number, pageCount: number) => {
        return {
          columns: [
            {
              text: 'Confidential & Proprietary',
              fontSize: 8,
              color: '#999999',
              margin: [40, 10, 0, 0],
            },
            {
              text: `Page ${currentPage} of ${pageCount}`,
              fontSize: 8,
              color: '#999999',
              alignment: 'right',
              margin: [0, 10, 40, 0],
            },
          ],
        };
      },
      content: [
        // Company & Document Title Header
        {
          columns: [
            {
              stack: [
                {
                  text: companyName,
                  fontSize: 18,
                  bold: true,
                  color: '#111827',
                },
                {
                  text: 'Commercial Quotation & Proposal',
                  fontSize: 12,
                  color: '#4B5563',
                  margin: [0, 3, 0, 0],
                },
              ],
            },
            {
              stack: [
                {
                  text: q.quoteNumber ?? '',
                  fontSize: 16,
                  bold: true,
                  alignment: 'right',
                  color: '#1E40AF',
                },
                {
                  text: `Status: ${q.status ?? ''} | Rev: v${q.revisionNumber ?? 1}`,
                  fontSize: 9,
                  alignment: 'right',
                  color: '#6B7280',
                  margin: [0, 3, 0, 0],
                },
                {
                  text: `Issue Date: ${new Date(q.createdAt || Date.now()).toISOString().split('T')[0]}`,
                  fontSize: 9,
                  alignment: 'right',
                  color: '#6B7280',
                  margin: [0, 2, 0, 0],
                },
                {
                  text: `Valid Until: ${validUntilStr}`,
                  fontSize: 9,
                  bold: true,
                  alignment: 'right',
                  color: '#DC2626',
                  margin: [0, 2, 0, 0],
                },
              ],
            },
          ],
        },
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 15,
              x2: 515,
              y2: 15,
              lineWidth: 1,
              lineColor: '#E5E7EB',
            },
          ],
        },
        { text: '', margin: [0, 0, 0, 15] },

        // Subject / Title
        {
          stack: [
            {
              text: 'Subject / Proposal Title:',
              fontSize: 9,
              color: '#6B7280',
            },
            {
              text: q.title ?? '',
              fontSize: 12,
              bold: true,
              margin: [0, 2, 0, 12],
            },
          ],
        },

        // Itemized Table
        {
          table: {
            headerRows: 1,
            widths: [20, '*', 35, 65, 55, 50, 70],
            body: itemsTableBody,
          },
          layout: {
            fillColor: (rowIndex: number) =>
              rowIndex === 0 ? '#F3F4F6' : null,
            hLineWidth: (i: number, node: ContentTable) =>
              i === 0 || i === 1 || i === node.table.body.length ? 0.75 : 0.5,
            vLineWidth: () => 0,
            hLineColor: () => '#E5E7EB',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 6,
            paddingBottom: () => 6,
          },
        },
        { text: '', margin: [0, 0, 0, 15] },

        // Summary Calculations (Right aligned)
        {
          columns: [
            { width: '*', text: '' },
            {
              width: 220,
              table: {
                widths: [120, 90],
                body: [
                  [
                    { text: 'Subtotal:', style: 'summaryLabel' },
                    {
                      text: `${currency} ${subtotalStr}`,
                      style: 'summaryValue',
                    },
                  ],
                  [
                    { text: 'Total Discount:', style: 'summaryLabel' },
                    {
                      text: `- ${currency} ${discountStr}`,
                      style: 'summaryValue',
                      color: '#059669',
                    },
                  ],
                  [
                    { text: 'Taxable Amount:', style: 'summaryLabel' },
                    {
                      text: `${currency} ${taxableStr}`,
                      style: 'summaryValue',
                    },
                  ],
                  ...(cgstMinor > 0
                    ? [
                        [
                          { text: 'CGST:', style: 'summaryLabel' },
                          {
                            text: `${currency} ${cgstStr}`,
                            style: 'summaryValue',
                          },
                        ],
                      ]
                    : []),
                  ...(sgstMinor > 0
                    ? [
                        [
                          { text: 'SGST:', style: 'summaryLabel' },
                          {
                            text: `${currency} ${sgstStr}`,
                            style: 'summaryValue',
                          },
                        ],
                      ]
                    : []),
                  ...(igstMinor > 0
                    ? [
                        [
                          { text: 'IGST:', style: 'summaryLabel' },
                          {
                            text: `${currency} ${igstStr}`,
                            style: 'summaryValue',
                          },
                        ],
                      ]
                    : []),
                  [
                    { text: 'Total Tax:', style: 'summaryLabel' },
                    {
                      text: `${currency} ${totalTaxStr}`,
                      style: 'summaryValue',
                    },
                  ],
                  [
                    { text: 'Grand Total:', style: 'summaryTotalLabel' },
                    {
                      text: `${currency} ${grandTotalStr}`,
                      style: 'summaryTotalValue',
                    },
                  ],
                ],
              },
              layout: 'noBorders',
            },
          ],
        },
        { text: '', margin: [0, 0, 0, 20] },

        // Terms and Conditions & Notes
        ...(q.termsAndConditions
          ? [
              { text: 'Terms & Conditions', style: 'sectionHeader' },
              { text: q.termsAndConditions, style: 'sectionContent' },
              {
                text: '',
                margin: [0, 0, 0, 10] as [number, number, number, number],
              },
            ]
          : []),
        ...(q.notes
          ? [
              { text: 'Notes', style: 'sectionHeader' },
              { text: q.notes, style: 'sectionContent' },
              {
                text: '',
                margin: [0, 0, 0, 10] as [number, number, number, number],
              },
            ]
          : []),

        // Signatures Block
        {
          margin: [0, 25, 0, 0],
          columns: [
            {
              width: 220,
              stack: [
                { text: 'Authorized Signatory', bold: true, fontSize: 9 },
                {
                  text: companyName,
                  fontSize: 8,
                  color: '#6B7280',
                  margin: [0, 2, 0, 30],
                },
                {
                  canvas: [
                    {
                      type: 'line',
                      x1: 0,
                      y1: 0,
                      x2: 180,
                      y2: 0,
                      lineWidth: 1,
                      lineColor: '#9CA3AF',
                    },
                  ],
                },
                {
                  text: 'Signature & Stamp',
                  fontSize: 8,
                  color: '#9CA3AF',
                  margin: [0, 4, 0, 0],
                },
              ],
            },
            { width: '*', text: '' },
            {
              width: 220,
              stack: [
                {
                  text: 'Client Acceptance',
                  bold: true,
                  fontSize: 9,
                  alignment: 'right',
                },
                {
                  text: 'Accepted & Confirmed by',
                  fontSize: 8,
                  color: '#6B7280',
                  alignment: 'right',
                  margin: [0, 2, 0, 30],
                },
                {
                  alignment: 'right',
                  canvas: [
                    {
                      type: 'line',
                      x1: 40,
                      y1: 0,
                      x2: 220,
                      y2: 0,
                      lineWidth: 1,
                      lineColor: '#9CA3AF',
                    },
                  ],
                },
                {
                  text: 'Date & Authorized Signature',
                  fontSize: 8,
                  color: '#9CA3AF',
                  alignment: 'right',
                  margin: [0, 4, 0, 0],
                },
              ],
            },
          ],
        },
      ],
      styles: {
        tableHeader: {
          bold: true,
          fontSize: 9,
          color: '#374151',
        },
        tableRow: {
          fontSize: 9,
          color: '#1F2937',
        },
        summaryLabel: {
          fontSize: 9,
          color: '#4B5563',
          alignment: 'right',
          margin: [0, 2, 8, 2],
        },
        summaryValue: {
          fontSize: 9,
          bold: true,
          color: '#111827',
          alignment: 'right',
          margin: [0, 2, 0, 2],
        },
        summaryTotalLabel: {
          fontSize: 11,
          bold: true,
          color: '#1E40AF',
          alignment: 'right',
          margin: [0, 6, 8, 2],
        },
        summaryTotalValue: {
          fontSize: 11,
          bold: true,
          color: '#1E40AF',
          alignment: 'right',
          margin: [0, 6, 0, 2],
        },
        sectionHeader: {
          fontSize: 10,
          bold: true,
          color: '#374151',
          margin: [0, 4, 0, 3],
        },
        sectionContent: {
          fontSize: 8.5,
          color: '#4B5563',
          lineHeight: 1.3,
        },
      },
    };

    return pdfmake.createPdf(docDefinition).getBuffer();
  }
}
