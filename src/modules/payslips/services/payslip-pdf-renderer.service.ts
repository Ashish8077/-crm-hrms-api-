import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type {
  Column,
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import {
  PayslipRenderComponentLine,
  PayslipRenderData,
} from '../mappers/payslip.mapper';

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
export class PayslipPdfRendererService {
  private readonly logger = new Logger(PayslipPdfRendererService.name);

  constructor() {
    // Configure built-in PDFKit fonts without external network font downloads
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

  async renderPdfBuffer(data: PayslipRenderData): Promise<Buffer> {
    try {
      const docDefinition = this.buildDocumentDefinition(data);
      const buffer = await pdfmake.createPdf(docDefinition).getBuffer();

      if (!buffer || buffer.length === 0) {
        throw new Error('Rendered PDF buffer was empty');
      }

      return buffer;
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Payslip PDF generation failed: ${message}`);
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to generate payslip PDF document.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private buildDocumentDefinition(
    data: PayslipRenderData,
  ): TDocumentDefinitions {
    const headerColumns: Column[] = [];
    const companyLeftStack: Content[] = [];

    if (data.companyName) {
      companyLeftStack.push({
        text: data.companyName,
        fontSize: 15,
        bold: true,
        color: '#111827',
      });
    } else {
      companyLeftStack.push({
        text: 'PAYSLIP',
        fontSize: 16,
        bold: true,
        color: '#111827',
      });
    }

    if (data.companyAddress) {
      companyLeftStack.push({
        text: data.companyAddress,
        fontSize: 8.5,
        color: '#4B5563',
        margin: [0, 3, 0, 0],
      });
    }

    headerColumns.push(
      {
        width: '*',
        stack: companyLeftStack,
      },
      {
        width: 'auto',
        stack: [
          {
            text: data.companyName ? 'PAYSLIP' : data.periodCode,
            fontSize: 13,
            bold: true,
            color: '#1E3A8A',
            alignment: 'right',
          },
          {
            text: data.periodName,
            fontSize: 9.5,
            bold: true,
            color: '#374151',
            alignment: 'right',
            margin: [0, 2, 0, 0],
          },
          {
            text: `Period Code: ${data.periodCode}`,
            fontSize: 8,
            color: '#6B7280',
            alignment: 'right',
            margin: [0, 2, 0, 0],
          },
        ],
      },
    );

    const buildComponentRows = (
      title: string,
      lines: PayslipRenderComponentLine[],
      totalLabel: string,
      totalValue: string,
      emptyText: string,
    ): TableCell[][] => {
      const rows: TableCell[][] = [
        [
          { text: title, style: 'tableHeader' },
          {
            text: `Amount (${data.currency})`,
            style: 'tableHeader',
            alignment: 'right',
          },
        ],
      ];

      if (lines.length === 0) {
        rows.push([
          { text: emptyText, style: 'mutedRow', italics: true },
          {
            text: `0.${'0'.repeat(data.roundingPrecision)}`,
            style: 'mutedRow',
            alignment: 'right',
          },
        ]);
      } else {
        for (const line of lines) {
          rows.push([
            {
              text: line.prorationApplied
                ? `${line.componentName} (Prorated)`
                : line.componentName,
              style: 'tableRow',
            },
            { text: line.amount, style: 'tableRow', alignment: 'right' },
          ]);
        }
      }

      rows.push([
        { text: totalLabel, style: 'tableTotalLabel' },
        { text: totalValue, style: 'tableTotalValue', alignment: 'right' },
      ]);

      return rows;
    };

    const employeeMetaRows: TableCell[][] = [
      [
        { text: 'Employee Name', style: 'metaLabel' },
        { text: data.employeeName, style: 'metaValue' },
        { text: 'Pay Period', style: 'metaLabel' },
        { text: `${data.startDate} to ${data.endDate}`, style: 'metaValue' },
      ],
      [
        { text: 'Employee Code', style: 'metaLabel' },
        { text: data.employeeCode, style: 'metaValue' },
        { text: 'Payment Date', style: 'metaLabel' },
        { text: data.paymentDate ?? 'N/A', style: 'metaValue' },
      ],
      [
        { text: 'Department', style: 'metaLabel' },
        { text: data.departmentName ?? 'N/A', style: 'metaValue' },
        { text: 'Frequency / Currency', style: 'metaLabel' },
        {
          text: `${data.payrollFrequency} / ${data.currency}`,
          style: 'metaValue',
        },
      ],
      [
        { text: 'Designation', style: 'metaLabel' },
        { text: data.designationName ?? 'N/A', style: 'metaValue' },
        { text: 'Employment Status', style: 'metaLabel' },
        { text: data.employmentStatus.toUpperCase(), style: 'metaValue' },
      ],
      [
        { text: 'Branch', style: 'metaLabel' },
        { text: data.branchName ?? 'N/A', style: 'metaValue' },
        { text: 'Payable / Calendar Days', style: 'metaLabel' },
        {
          text: `${data.payableDays} / ${data.calendarDays} (LOP: ${data.totalLopDays})`,
          style: 'metaValue',
        },
      ],
    ];

    const content: Content[] = [
      {
        columns: headerColumns,
        margin: [0, 0, 0, 10],
      },
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 515,
            y2: 0,
            lineWidth: 1.5,
            lineColor: '#1E3A8A',
          },
        ],
        margin: [0, 0, 0, 12],
      },
      {
        text: 'Employee & Payroll Details',
        style: 'sectionTitle',
      },
      {
        table: {
          widths: [95, '*', 110, '*'],
          body: employeeMetaRows,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#E5E7EB',
          vLineColor: () => '#E5E7EB',
          paddingTop: () => 5,
          paddingBottom: () => 5,
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
        margin: [0, 0, 0, 14],
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Earnings', style: 'sectionTitle' },
              {
                table: {
                  widths: ['*', 85],
                  body: buildComponentRows(
                    'Earning Component',
                    data.earnings,
                    'Total Gross Earnings',
                    data.grossEarnings,
                    'No earnings recorded',
                  ),
                },
                layout: {
                  fillColor: (rowIndex: number, node) => {
                    const lastIdx = node.table.body.length - 1;
                    if (rowIndex === 0) return '#F3F4F6';
                    if (rowIndex === lastIdx) return '#EFF6FF';
                    return null;
                  },
                  hLineWidth: () => 0.5,
                  vLineWidth: () => 0.5,
                  hLineColor: () => '#D1D5DB',
                  vLineColor: () => '#E5E7EB',
                  paddingTop: () => 5,
                  paddingBottom: () => 5,
                  paddingLeft: () => 6,
                  paddingRight: () => 6,
                },
              },
            ],
          },
          { width: 12, text: '' },
          {
            width: '*',
            stack: [
              { text: 'Employee Deductions', style: 'sectionTitle' },
              {
                table: {
                  widths: ['*', 85],
                  body: buildComponentRows(
                    'Deduction Component',
                    data.deductions,
                    'Total Deductions',
                    data.totalDeductions,
                    'No employee deductions',
                  ),
                },
                layout: {
                  fillColor: (rowIndex: number, node) => {
                    const lastIdx = node.table.body.length - 1;
                    if (rowIndex === 0) return '#F3F4F6';
                    if (rowIndex === lastIdx) return '#FEF2F2';
                    return null;
                  },
                  hLineWidth: () => 0.5,
                  vLineWidth: () => 0.5,
                  hLineColor: () => '#D1D5DB',
                  vLineColor: () => '#E5E7EB',
                  paddingTop: () => 5,
                  paddingBottom: () => 5,
                  paddingLeft: () => 6,
                  paddingRight: () => 6,
                },
              },
            ],
          },
        ],
        margin: [0, 0, 0, 14],
      },
    ];

    if (data.employerContributions.length > 0) {
      content.push(
        {
          text: 'Employer Contributions (Informational — Not Deducted From Employee Pay)',
          style: 'sectionTitle',
        },
        {
          table: {
            widths: ['*', 110],
            body: buildComponentRows(
              'Employer Contribution Component',
              data.employerContributions,
              'Total Employer Contributions',
              data.totalEmployerContributions,
              'No employer contributions',
            ),
          },
          layout: {
            fillColor: (rowIndex: number, node) => {
              const lastIdx = node.table.body.length - 1;
              if (rowIndex === 0 || rowIndex === lastIdx) return '#F9FAFB';
              return null;
            },
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#D1D5DB',
            vLineColor: () => '#E5E7EB',
            paddingTop: () => 4,
            paddingBottom: () => 4,
            paddingLeft: () => 6,
            paddingRight: () => 6,
          },
          margin: [0, 0, 0, 14],
        },
      );
    }

    content.push({
      table: {
        widths: ['*', 130],
        body: [
          [
            { text: 'Gross Earnings', style: 'summaryLabel' },
            {
              text: `${data.currency} ${data.grossEarnings}`,
              style: 'summaryValue',
              alignment: 'right',
            },
          ],
          [
            { text: 'Total Employee Deductions', style: 'summaryLabel' },
            {
              text: `${data.currency} ${data.totalDeductions}`,
              style: 'summaryValue',
              alignment: 'right',
            },
          ],
          [
            { text: 'Net Salary Payable', style: 'netTotalLabel' },
            {
              text: `${data.currency} ${data.netSalary}`,
              style: 'netTotalValue',
              alignment: 'right',
            },
          ],
          [
            {
              text: `Amount in Words: ${data.netSalaryInWords}`,
              colSpan: 2,
              style: 'amountWords',
            },
            {},
          ],
        ],
      },
      layout: {
        fillColor: (rowIndex: number) =>
          rowIndex === 2 ? '#EFF6FF' : '#FFFFFF',
        hLineWidth: () => 0.75,
        vLineWidth: () => 0.5,
        hLineColor: () => '#BFDBFE',
        vLineColor: () => '#E5E7EB',
        paddingTop: () => 6,
        paddingBottom: () => 6,
        paddingLeft: () => 8,
        paddingRight: () => 8,
      },
      margin: [0, 0, 0, 16],
    });

    content.push({
      text: 'This is a computer-generated payslip from finalized payroll records and does not require a physical signature.',
      fontSize: 8,
      color: '#6B7280',
      alignment: 'center',
      margin: [0, 10, 0, 0],
    });

    return {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      info: {
        title: `Payslip ${data.periodCode} ${data.employeeCode}`,
        subject: `Payslip for ${data.periodName}`,
        creator: 'HRMS Payroll System',
        producer: 'HRMS Payroll System',
        creationDate: data.deterministicDate,
      },
      defaultStyle: {
        font: 'Helvetica',
        fontSize: 9,
        color: '#1F2937',
      },
      content,
      styles: {
        sectionTitle: {
          fontSize: 10,
          bold: true,
          color: '#1E3A8A',
          margin: [0, 0, 0, 5],
        },
        metaLabel: {
          fontSize: 8,
          bold: true,
          color: '#4B5563',
          fillColor: '#F9FAFB',
        },
        metaValue: {
          fontSize: 8.5,
          color: '#111827',
        },
        tableHeader: {
          fontSize: 8.5,
          bold: true,
          color: '#374151',
        },
        tableRow: {
          fontSize: 8.5,
          color: '#1F2937',
        },
        mutedRow: {
          fontSize: 8.5,
          color: '#6B7280',
        },
        tableTotalLabel: {
          fontSize: 8.5,
          bold: true,
          color: '#111827',
        },
        tableTotalValue: {
          fontSize: 8.5,
          bold: true,
          color: '#111827',
        },
        summaryLabel: {
          fontSize: 9,
          color: '#374151',
        },
        summaryValue: {
          fontSize: 9,
          bold: true,
          color: '#111827',
        },
        netTotalLabel: {
          fontSize: 11,
          bold: true,
          color: '#1E3A8A',
        },
        netTotalValue: {
          fontSize: 11,
          bold: true,
          color: '#1E3A8A',
        },
        amountWords: {
          fontSize: 8.5,
          italics: true,
          color: '#374151',
        },
      },
    };
  }
}
